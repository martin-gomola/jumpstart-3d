import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

test('AR snapshot converts millimetres/Z-up, grounds the model and exports a valid USDZ package', async () => {
  const result = await build({ stdin: { contents: `
    import * as T from 'three';
    import { arScene, arSnapshot, disposeArScene, shareBase } from './src/ar-snapshot.js';
    import { unzipSync, strFromU8 } from './third_party/three/examples/jsm/libs/fflate.module.js';
    export { shareBase };
    export async function probe() {
      const geometry = new T.BoxGeometry(80, 60, 10);
      const app = { store: { doc: { bodies: [{ id: 'part', color: '#ff0000' }, { id: 'ref', role: 'reference' }] } }, sel: [], kernel: { queue: new Map() }, scene: { busy: () => false, views: new Map([['part', { mesh: new T.Mesh(geometry), group: { matrix: new T.Matrix4().makeTranslation(200, 100, 5) } }]]) } };
      const scene = arScene(app), box = new T.Box3().setFromObject(scene);
      const dimensions = [...box.getSize(new T.Vector3())], minY = box.min.y;
      disposeArScene(scene);
      const bytes = await arSnapshot(app), files = unzipSync(bytes);
      return { dimensions, minY, sourceWidth: geometry.parameters.width, files: Object.keys(files), text: strFromU8(files['model.usda']) };
    }
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node', alias: { three: resolve('third_party/three/build/three.module.js') } });
  const module = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
  const data = await module.probe();
  [0.08, 0.01, 0.06].forEach((expected, i) => assert.ok(Math.abs(data.dimensions[i] - expected) < 1e-6));
  assert.ok(Math.abs(data.minY) < 1e-6); assert.equal(data.sourceWidth, 80);
  assert.ok(data.files.some(name => name.startsWith('geometries/')));
  assert.match(data.text, /metersPerUnit = 1/);
  assert.throws(() => module.shareBase('https://localhost')); assert.throws(() => module.shareBase('http://example.com'));
  assert.equal(module.shareBase('https://cad.example.com'), 'https://cad.example.com');
});
