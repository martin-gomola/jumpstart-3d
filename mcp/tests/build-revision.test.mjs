import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRevision } from '../../build-revision.mjs';
import { PRODUCT_NAME, STUDIO_VERSION, EDITOR_VERSION } from '../../src/product-info.js';

test('build identity accepts public Git revisions and reports unknown source honestly', async () => {
  assert.equal(buildRevision('.', { JUMPSTART_BUILD_REVISION: 'abcdef1234567890-dirty' }), 'abcdef12-dirty');
  assert.equal(buildRevision('.', { RENDER_GIT_COMMIT: 'abcdef1234567890' }), 'abcdef12');
  assert.equal(buildRevision('.', { GITHUB_SHA: '1234567890abcdef' }), '12345678');
  assert.throws(() => buildRevision('.', { JUMPSTART_BUILD_REVISION: '<script>wrong</script>' }), /Git hash/);
  const root = await mkdtemp(join(tmpdir(), 'jumpstart-source-'));
  try { assert.equal(buildRevision(root, {}), 'unversioned'); }
  finally { await rm(root, { recursive: true }); }
});

test('Studio release is separate from the editor core and agrees with the npm lockfile', async () => {
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(PRODUCT_NAME, 'JumpStart 3D Studio');
  assert.match(STUDIO_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(EDITOR_VERSION, '2.7.7');
  assert.notEqual(STUDIO_VERSION, EDITOR_VERSION);
  assert.equal(lock.version, STUDIO_VERSION); assert.equal(lock.packages[''].version, STUDIO_VERSION);
});
