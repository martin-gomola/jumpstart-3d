import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createArShares } from '../server/ar-shares.mjs';

test('AR shares protect uploads, serve only opaque temporary assets, and expire', async () => {
  let now = 0;
  const handle = createArShares({ now: () => now });
  const server = createServer((req, res) => void handle(req, res, req.url, req.headers['x-local'] === 'yes'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (body, local = true) => fetch(origin + '/__mcp/ar', { method: 'POST', headers: { 'Content-Type': 'model/vnd.usdz+zip', ...(local ? { 'x-local': 'yes' } : {}) }, body });
  try {
    assert.equal((await post('anything', false)).status, 403);
    assert.equal((await post('invalid')).status, 400);
    const bytes = Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3]);
    const response = await post(bytes); assert.equal(response.status, 201);
    const { id } = await response.json(); assert.match(id, /^[a-f0-9]{48}$/);
    const page = await (await fetch(origin + '/ar/' + id)).text();
    assert.match(page, /rel="ar"/); assert.match(page, /allowsContentScaling=0/);
    const asset = await fetch(`${origin}/ar/${id}/model.usdz`);
    assert.equal(asset.headers.get('content-type'), 'model/vnd.usdz+zip');
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), bytes);
    assert.equal((await fetch(`${origin}/ar/${id}/../server.mjs`)).status, 404);
    assert.equal((await fetch(`${origin}/ar/${id}`, { method: 'POST' })).status, 405);
    for (let i = 0; i < 7; i++) assert.equal((await post(bytes)).status, 201);
    assert.equal((await post(bytes)).status, 429);
    now = 30 * 60 * 1000;
    assert.equal((await fetch(origin + '/ar/' + id)).status, 404);
    assert.equal((await post(bytes)).status, 201);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
