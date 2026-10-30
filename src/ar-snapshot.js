import * as THREE from 'three';
import { USDZExporter } from '../third_party/three/examples/jsm/exporters/USDZExporter.js';
import { selectExportBodies } from './bodyRoles.js';

// Snapshot only manufacturing bodies; editor highlights and construction aids never leave the app.
export function arScene(app) {
  if (app.scene.busy() || app.kernel.inflight || app.kernel.queue.size) throw new Error('Wait for the model to finish building.');
  const bodies = selectExportBodies(app.store.doc.bodies);
  const selected = bodies.filter(b => app.sel.includes(b.id));
  const scene = new THREE.Scene();
  let triangles = 0;
  try {
    for (const body of selected.length ? selected : bodies) {
      const view = app.scene.views.get(body.id);
      if (!view?.mesh || view.pending || app.scene.errors?.has(body.id)) throw new Error('Model geometry is not ready.');
      triangles += view.mesh.geometry.index.count / 3;
      if (triangles > 300000) throw new Error('AR preview supports up to 300,000 triangles.');
      const geometry = view.mesh.geometry.clone();
      geometry.applyMatrix4(view.group.matrix);
      if (view.group.matrix.determinant() < 0) {
        const index = geometry.index;
        for (let i = 0; i < index.count; i += 3) {
          const first = index.getX(i); index.setX(i, index.getX(i + 2)); index.setX(i + 2, first);
        }
      }
      geometry.rotateX(-Math.PI / 2);
      geometry.scale(0.001, 0.001, 0.001); // CAD millimetres to USD metres, Z-up to Y-up.
      geometry.clearGroups();
      scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: body.color || '#a7b0ba', roughness: 0.62, metalness: 0.04 })));
    }
    if (!scene.children.length) throw new Error('Add a visible printable body first.');
    const box = new THREE.Box3().setFromObject(scene);
    if (![...box.min, ...box.max].every(Number.isFinite)) throw new Error('Model has invalid dimensions.');
    const center = box.getCenter(new THREE.Vector3());
    for (const mesh of scene.children) mesh.geometry.translate(-center.x, -box.min.y, -center.z);
    scene.updateMatrixWorld(true);
    return scene;
  } catch (error) { disposeArScene(scene); throw error; }
}
export function disposeArScene(scene) {
  for (const mesh of scene.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
}
export async function arSnapshot(app) {
  const scene = arScene(app);
  try { return await new USDZExporter().parseAsync(scene, { quickLookCompatible: true }); }
  finally { disposeArScene(scene); }
}
export function shareBase(value) {
  const message = 'Enter a phone-accessible HTTPS address, such as https://cad.example.com.';
  let url;
  try { url = new URL(value); } catch { throw new Error(message); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error(message);
  return url.origin;
}
