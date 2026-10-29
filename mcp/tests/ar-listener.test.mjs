import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

test('one JumpStart process shares snapshots across local/private and public/read-only listeners', async () => {
  const localPort = await freePort(), publicPort = await freePort(), lanPort = await freePort();
  const child = spawn(process.execPath, ['mcp/server/server.mjs'], { env: { ...process.env, JUMPSTART_MCP_PORT: String(localPort), JUMPSTART_MCP_HOST: '127.0.0.1', JUMPSTART_MCP_HTTP_ONLY: '1', JUMPSTART_AR_PORT: String(publicPort), JUMPSTART_AR_HOST: '127.0.0.1', JUMPSTART_LAN_PORT: String(lanPort), JUMPSTART_LAN_HOST: '127.0.0.1', JUMPSTART_LAN_ORIGINS: `http://127.0.0.1:${lanPort},https://cad.home.example.com` }, stdio: 'ignore' });
  const local = `http://localhost:${localPort}`, publicOrigin = `http://127.0.0.1:${publicPort}`;
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { ready = (await fetch(publicOrigin)).status === 404; } catch {}
      if (ready) break; await delay(100);
    }
    assert.ok(ready, 'read-only listener started');
    const response = await fetch(local + '/__mcp/ar', { method: 'POST', headers: { 'Content-Type': 'model/vnd.usdz+zip' }, body: Buffer.from([0x50, 0x4b, 3, 4]) });
    assert.equal(response.status, 201); const { id } = await response.json();
    const page = await fetch(`${publicOrigin}/ar/${id}`); assert.equal(page.status, 200); assert.match(await page.text(), /rel="ar"/);
    assert.equal((await fetch(`${publicOrigin}/ar/${id}/model.usdz`)).status, 200);
    for (const path of ['/__mcp/ar', '/__mcp/rpc', '/app.js', '/']) assert.equal((await fetch(publicOrigin + path)).status, 404);
    assert.equal((await fetch(`${publicOrigin}/ar/${id}`, { method: 'POST' })).status, 405);
    const lan = `http://127.0.0.1:${lanPort}`;
    const editor = await fetch(lan + '/?mcp=1'); assert.equal(editor.status, 200);
    const shell = await editor.text();
    assert.doesNotMatch(shell, /<meta name="jumpstart-mcp-bridge"/);
    assert.match(shell, /<meta name="jumpstart-ar-sharing" content="1"/);
    assert.match(await (await fetch(local)).text(), /<meta name="jumpstart-mcp-bridge"/);
    assert.equal((await fetch(lan + '/app.js')).status, 200);
    assert.equal((await fetch(lan + '/__mcp/rpc', { method: 'POST' })).status, 404);
    assert.equal((await fetch(lan + '/__mcp/poll')).status, 404);
    const uploaded = await fetch(lan + '/__mcp/ar', { method: 'POST', headers: { Origin: lan, 'Content-Type': 'model/vnd.usdz+zip' }, body: Buffer.from([0x50, 0x4b, 3, 4]) });
    assert.equal(uploaded.status, 201);
    assert.equal((await fetch(lan + '/__mcp/ar', { method: 'POST', headers: { Origin: 'https://attacker.example' } })).status, 403);
    assert.equal((await fetch(lan + '/__mcp/ar', { method: 'POST' })).status, 403);
    const rejected = await fetch(local + '/__mcp/ar', { method: 'POST', headers: { Origin: 'https://ar.home.martingomola.com' } });
    assert.equal(rejected.status, 403);
  } finally {
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000); await exited; clearTimeout(timer);
  }
});
