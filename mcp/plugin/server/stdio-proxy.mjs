#!/usr/bin/env node

import { randomUUID } from "node:crypto";
const endpoint = process.env.JUMPSTART_MCP_HTTP_URL || "http://127.0.0.1:3210/__mcp/rpc";
const clientEndpoint = new URL("/__mcp/client", endpoint);
const clientId = randomUUID();
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PENDING = 32;
const configuredTimeout = Number(process.env.JUMPSTART_MCP_PROXY_TIMEOUT_MS || 70000);
const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(100, Math.min(configuredTimeout, 120000)) : 70000;
const safeTools = new Set([
  "jumpstart_list_editors", "jumpstart_get_document", "jumpstart_get_capabilities",
  "jumpstart_inspect_geometry", "jumpstart_get_tutorial_status",
]);
let stopped = false;
async function lease(state) {
  try { await fetch(clientEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, state }), signal: AbortSignal.timeout(2000) }); } catch { /* A disconnected proxy expires at the server. */ }
}
await lease("connect");
let renewing = null;
const leaseTimer = setInterval(() => { if (!stopped && !renewing) renewing = lease("heartbeat").finally(() => { renewing = null; }); }, 5000);
async function disconnect() { stopped = true; clearInterval(leaseTimer); await renewing; await lease("disconnect"); }
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { void disconnect().finally(() => process.exit(0)); });
const pending = new Set();
let inputBuffer = "";
let discarding = false;
const replyError = (id, code, message, data) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } })}\n`);
const hasId = (message) => Object.hasOwn(message, "id");
function mayRetry(message) {
  if (["initialize", "ping", "tools/list", "server/discover"].includes(message.method)) return true;
  if (message.method !== "tools/call") return false;
  const name = message.params?.name;
  return safeTools.has(name) || (typeof name === "string" && name.startsWith("jumpstart_preview_"));
}
async function forward(line) {
  let message;
  try { message = JSON.parse(line); }
  catch { replyError(null, -32700, "Invalid JSON"); return; }
  if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string") {
    replyError(message?.id ?? null, -32600, "Expected a JSON-RPC request"); return;
  }
  if (pending.size >= MAX_PENDING) {
    if (hasId(message)) replyError(message.id, -32000, "Too many pending MCP requests; wait for current requests to finish");
    return;
  }
  const retryable = mayRetry(message);
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; attempt < (retryable ? 2 : 1); attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(message), signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      if (!response.ok) throw new Error(`JumpStart MCP bridge returned HTTP ${response.status}`);
      if (!hasId(message)) return;
      // Bound response reads as well as input lines; geometry images can be large.
      let bytes = 0, chunks = [];
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024) throw new Error("MCP response exceeds 32 MiB");
        chunks.push(chunk);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (result.id !== message.id || result.jsonrpc !== "2.0") throw new Error("MCP response does not match request");
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    } catch (error) {
      if (retryable && attempt === 0 && Date.now() + 250 < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      if (hasId(message)) replyError(message.id, -32001, `JumpStart MCP connection failed: ${error.message}`, {
        outcome: retryable ? "unavailable" : "unknown",
        retrySafe: retryable,
        recovery: retryable ? "Check the local server and retry. If the client transport closed, reconnect MCP in the client." : "Do not replay automatically. Reconnect and inspect the document and edit history before retrying.",
      });
      return;
    }
  }
}
function accept(line) {
  if (!line.trim()) return;
  const task = forward(line);
  pending.add(task);
  task.finally(() => pending.delete(task));
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  // Discard an oversized line through its newline, then accept subsequent requests.
  for (const part of chunk.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const ended = part.endsWith("\n");
    if (!discarding) {
      inputBuffer += part;
      if (Buffer.byteLength(inputBuffer) > MAX_BYTES) {
        inputBuffer = ""; discarding = true;
        replyError(null, -32600, "MCP request exceeds 4 MiB");
      }
    }
    if (ended) {
      if (!discarding) accept(inputBuffer.trimEnd());
      inputBuffer = ""; discarding = false;
    }
  }
});
process.stdin.on("end", async () => {
  if (!discarding && inputBuffer.trim()) accept(inputBuffer);
  await Promise.allSettled([...pending]);
  await disconnect();
});
