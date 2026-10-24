import * as THREE from "three";
import { el } from "../../src/util.js";

// Read-only view of cached preview meshes; never connects to the editor scene.
export function previewViewer(meshes) {
  const canvas = el("canvas", { tabindex: "0", role: "region", "aria-label": "Interactive 3D preview. Drag or use arrow keys to rotate. Scroll or use plus and minus to zoom. Press zero to reset." });
  const frame = el("div", { class: "ai-preview-canvas" }, canvas);
  const reset = el("button", { type: "button" }, "Reset view");
  const top = el("button", { type: "button" }, "Top view");
  const element = el("div", { class: "ai-preview-viewer" }, frame,
    el("div", { class: "ai-template-actions" }, reset, top),
    el("p", { class: "ai-template-note" }, "Drag to rotate. Scroll to zoom. X width · Y depth · Z up."));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera();
  camera.up.set(0, 0, 1);
  const material = new THREE.MeshStandardMaterial({ roughness: 1 });
  const edgeMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.45 });
  const resources = [];
  scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(1, -2, 4); scene.add(light);
  for (const mesh of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.vertices), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triangles), 1));
    geometry.applyMatrix4(new THREE.Matrix4().fromArray(mesh.matrix));
    geometry.computeVertexNormals();
    const edges = new THREE.EdgesGeometry(geometry, 25);
    resources.push(geometry, edges);
    scene.add(new THREE.Mesh(geometry, material), new THREE.LineSegments(edges, edgeMaterial));
  }
  const box = new THREE.Box3().setFromObject(scene), center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1);
  let yaw = -Math.PI / 4, pitch = 0.65, zoom = 1, drag = null, disposed = false;
  const draw = () => {
    if (disposed || !frame.clientWidth || !frame.clientHeight) return;
    const width = frame.clientWidth, height = frame.clientHeight, aspect = width / height;
    renderer.setSize(width, height, false);
    const span = radius * 1.15 * zoom / Math.min(aspect, 1);
    Object.assign(camera, { left: -span * aspect, right: span * aspect, top: span, bottom: -span, near: radius * 0.001, far: radius * 10 });
    camera.position.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch)).multiplyScalar(radius * 3).add(center);
    camera.up.set(0, Math.abs(pitch) === Math.PI / 2 ? 1 : 0, Math.abs(pitch) === Math.PI / 2 ? 0 : 1);
    camera.lookAt(center); camera.updateProjectionMatrix(); renderer.render(scene, camera);
  };
  const update = () => { pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)); zoom = Math.max(0.15, Math.min(6, zoom)); draw(); };
  const home = () => { yaw = -Math.PI / 4; pitch = 0.65; zoom = 1; update(); };
  reset.onclick = home;
  top.onclick = () => { pitch = Math.PI / 2; update(); };
  canvas.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); canvas.focus(); canvas.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY };
  };
  canvas.onpointermove = event => {
    if (!drag) return;
    yaw -= (event.clientX - drag.x) * 0.01; pitch += (event.clientY - drag.y) * 0.01;
    drag = { x: event.clientX, y: event.clientY }; update();
  };
  canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = () => { drag = null; };
  canvas.addEventListener("wheel", event => { event.preventDefault(); zoom *= Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * 0.002); update(); }, { passive: false });
  canvas.onkeydown = event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "0"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "0") return home();
    if (event.key === "ArrowLeft") yaw -= 0.15;
    if (event.key === "ArrowRight") yaw += 0.15;
    if (event.key === "ArrowUp") pitch += 0.15;
    if (event.key === "ArrowDown") pitch -= 0.15;
    if (["+", "="].includes(event.key)) zoom /= 1.15;
    if (event.key === "-") zoom *= 1.15;
    update();
  };
  const recolor = () => {
    const theme = getComputedStyle(document.documentElement);
    material.color.set(theme.getPropertyValue("--hole").trim());
    edgeMaterial.color.set(theme.getPropertyValue("--ink-2").trim()); draw();
  };
  const resize = new ResizeObserver(draw), theme = new MutationObserver(recolor);
  resize.observe(frame); theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui"] }); recolor();
  return { element, dispose() {
    if (disposed) return;
    disposed = true; resize.disconnect(); theme.disconnect();
    resources.forEach(resource => resource.dispose()); material.dispose(); edgeMaterial.dispose();
    renderer.dispose(); renderer.forceContextLoss(); element.remove();
  } };
}
