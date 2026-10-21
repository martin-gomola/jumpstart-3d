import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";

async function fixture(t, handle) {
  const server = createServer(async (req, res) => {
    if (req.url === "/__mcp/client") { req.resume(); res.end('{}'); return; }
    let body = ""; for await (const chunk of req) body += chunk;
    await handle(JSON.parse(body), req, res);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const child = spawn(process.execPath, ["mcp/server/stdio-proxy.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, JUMPSTART_MCP_HTTP_URL: `http://127.0.0.1:${server.address().port}/__mcp/rpc`, JUMPSTART_MCP_PROXY_TIMEOUT_MS: "400" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const queue = [], waiting = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line), next = waiting.shift();
    if (next) next(message); else queue.push(message);
  });
  t.after(() => { child.kill("SIGKILL"); server.closeAllConnections(); server.close(); });
  return (message) => {
    const response = queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiting.push(resolve));
    child.stdin.write(typeof message === "string" ? `${message}\n` : `${JSON.stringify(message)}\n`);
    return response;
  };
}

test("proxy returns bounded timeout errors and never replays an uncertain mutation", { timeout: 5000 }, async (t) => {
  let attempts = 0;
  const send = await fixture(t, async (message, req, res) => {
    attempts++;
    if (message.method === "ping") res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
  });
  const result = await send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "jumpstart_apply_model" } });
  assert.equal(result.id, 4); assert.equal(result.error.code, -32001);
  assert.equal(result.error.data.outcome, "unknown"); assert.equal(attempts, 1);
  assert.deepEqual((await send({ jsonrpc: "2.0", id: 5, method: "ping" })).result, {});
});

test("proxy retries read requests after a broken connection and stays usable", { timeout: 5000 }, async (t) => {
  let attempts = 0;
  const send = await fixture(t, async (message, req, res) => {
    if (++attempts === 1) { req.socket.destroy(); return; }
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [] } }));
  });
  const result = await send({ jsonrpc: "2.0", id: "read", method: "tools/list" });
  assert.deepEqual(result.result, { tools: [] }); assert.equal(attempts, 2);
  assert.equal((await send("{" )).error.code, -32700);
  assert.equal((await send({ jsonrpc: "2.0", id: 9, method: "ping" })).id, 9);
});

test("oversized input is discarded without killing the proxy", { timeout: 5000 }, async (t) => {
  const send = await fixture(t, async (message, req, res) => res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })));
  assert.equal((await send("x".repeat(4 * 1024 * 1024 + 1))).error.code, -32600);
  assert.equal((await send({ jsonrpc: "2.0", id: 10, method: "ping" })).id, 10);
});
