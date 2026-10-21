import test from "node:test";
import assert from "node:assert/strict";
import { agentStatus } from "../browser/ai-status.js";
import { clientPresence } from "../server/presence.mjs";

test("editor online is waiting, not proof of an AI client connection", () => {
  const waiting = agentStatus({ online: true });
  assert.equal(waiting.state, "waiting");
  assert.match(waiting.detail, /Follow the setup steps below/);
  assert.equal(agentStatus({ online: true, connected: true }).state, "connected");
  assert.equal(agentStatus({ online: true, recent: true }).state, "recent");
  assert.equal(agentStatus({ checking: true }).state, "checking");
  assert.equal(agentStatus({ online: false, connected: true }).state, "offline");
  assert.match(agentStatus({ online: false }).detail, /make up/);
});
test("reading, previewing, changing, completion and failures have distinct truthful labels", () => {
  const input = { online: true, connected: true };
  for (const action of ["get_document", "inspect_geometry", "select_geometry", "get_tutorial_status", "start_tutorial"]) assert.equal(agentStatus({ ...input, action }).state, "reading");
  for (const action of ["preview_model", "preview_parameters", "preview_new_document", "preview_native_model", "preview_native_parameters", "preview_lathe"]) assert.equal(agentStatus({ ...input, action }).state, "previewing");
  for (const action of ["apply_model", "undo", "reopen_document"]) assert.equal(agentStatus({ ...input, action }).state, "editing");
  assert.equal(agentStatus({ ...input, outcome: "apply_model" }).compact, "AI updated");
  assert.equal(agentStatus({ ...input, outcome: "no_change" }).compact, "AI unchanged");
  assert.equal(agentStatus({ ...input, error: "Invalid plan" }).state, "error");
  assert.match(agentStatus({ ...input, error: "Invalid plan" }).detail, /Invalid plan/);
});
test("presence distinguishes leases, stateless activity, disconnect and lease expiry", () => {
  let now = 0;
  const presence = clientPresence(() => now);
  assert.deepEqual(presence.status(), { clientConnected: false, recentClientActivity: false });
  presence.activity(); assert.deepEqual(presence.status(), { clientConnected: false, recentClientActivity: true });
  presence.lease("one", "connect"); assert.equal(presence.status().clientConnected, true);
  presence.lease("one", "disconnect"); assert.equal(presence.status().clientConnected, false);
  presence.lease("one", "connect"); now = 14000; presence.lease("one", "heartbeat"); now = 16000;
  assert.deepEqual(presence.status(), { clientConnected: true, recentClientActivity: false });
  now = 29000; assert.equal(presence.status().clientConnected, false);
  presence.stdioConnected(); assert.equal(presence.status().clientConnected, true);
});

test("every status has a visible AI label and an accessible state name", async () => {
  const { AI_STATUS_CSS } = await import("../browser/ai-status.js");
  const statuses = [
    agentStatus({ online: false }), agentStatus({ checking: true }), agentStatus({ online: true }),
    agentStatus({ online: true, connected: true }), agentStatus({ online: true, recent: true }),
    agentStatus({ online: true, action: "get_document" }), agentStatus({ online: true, action: "preview_model" }),
    agentStatus({ online: true, action: "apply_model" }), agentStatus({ online: true, action: "save_document" }),
    agentStatus({ online: true, action: "export_model" }), agentStatus({ online: true, outcome: "apply_model" }),
    agentStatus({ online: true, error: "Geometry unavailable" }),
  ];
  assert.ok(statuses.every(({ compact, label }) => compact.startsWith("AI ") && label.length > 0));
  assert.equal(new Set(statuses.map((status) => status.compact)).size, statuses.length);
  assert.doesNotMatch(AI_STATUS_CSS, /animation\s*:|transition\s*:/);
  assert.match(AI_STATUS_CSS, /focus-visible/);
  assert.match(AI_STATUS_CSS, /data-tooltip-dismissed/);
  assert.match(AI_STATUS_CSS, /\.ai-status-short \{ white-space: nowrap; \}/);
});
