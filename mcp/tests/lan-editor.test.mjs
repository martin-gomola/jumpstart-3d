import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { createLanEditor } from '../server/lan-editor.mjs';

test('LAN listener serves configured CAD proxy host but never routes MCP, including spoofed local Host', async () => {
  let uploads = 0;
  const server = createLanEditor({ origins: ['https://cad.home.example.com'], serveStatic: (req, res, path, network) => { assert.equal(network, true); res.end('editor'); }, handleAr: (req, res, path, allowed) => { if (allowed) uploads++; res.end('AR'); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const call = (path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: { Host: 'cad.home.example.com', ...headers } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  try {
    assert.equal(await call('/?mcp=1'), 200);
    assert.equal(await call('/__mcp/rpc', {}, 'POST'), 404);
    assert.equal(await call('/__mcp/rpc', { Host: `localhost:${server.address().port}` }, 'POST'), 403);
    assert.equal(await call('/__mcp/ar', { Origin: 'https://cad.home.example.com' }, 'POST'), 200);
    assert.equal(uploads, 1);
    assert.equal(await call('/__mcp/ar', { Origin: 'https://attacker.example' }, 'POST'), 403);
    assert.equal(await call('/__mcp/ar', { Origin: 'https://cad.home.example.com', 'Sec-Fetch-Site': 'cross-site' }, 'POST'), 403);
    assert.equal(uploads, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
