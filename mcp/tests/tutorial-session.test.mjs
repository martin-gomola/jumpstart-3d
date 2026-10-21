import test from "node:test";
import assert from "node:assert/strict";
import { tutorialSession } from "../browser/tutorial-session.js";
import { tutorialTools } from "../server/tutorial-contracts.mjs";
import { validateToolInput as validateInput } from "../shared/schema.js";

const validateToolInput = (schema, value) => validateInput(value, schema);

test("tutorial sessions retain observed native stages without certifying manual steps", () => {
  const doc = { id: "one", bodies: [], sketches: [] };
  let width = 60, started = false;
  const tutorial = { id: "bracket", title: "Bracket", steps: [
    { title: "Initial", check: () => width === 60 }, { title: "Revised", check: () => width === 80 }, { title: "Optional CSV" },
  ] };
  const session = tutorialSession({ tutorials: { list: [tutorial], T: {}, start: () => { started = true; } } }, () => doc);
  assert.equal(session.status().tutorialId, null);
  assert.throws(() => session.start("unknown"), /Unknown/);
  assert.equal(session.start("bracket").complete, false); assert(started);
  width = 80;
  const result = session.status(); assert(result.complete); assert(result.steps[0].passed); assert.equal(result.steps[0].passedNow, false); assert.equal(result.steps[2].passed, null);
  doc.bodies.push({ id: "body" }); assert.throws(() => session.start("bracket"), /blank/);
  doc.id = "changed"; assert.throws(() => session.status(), /changed/);
});

test("native tool contracts require revisions and reject unknown or oversized plans", () => {
  const schema = name => tutorialTools.find(tool => tool.name === name).inputSchema;
  const plan = { blank: { kind: "round", length: 90, diameter: 60 }, profile: [[0,22],[90,30]], hollow: { wall: 3, base: 6, end: "tail", style: "follow" } };
  assert.doesNotThrow(() => validateToolInput(schema("jumpstart_preview_lathe"), { expectedRevision: "one", plan }));
  assert.throws(() => validateToolInput(schema("jumpstart_preview_lathe"), { plan }));
  assert.throws(() => validateToolInput(schema("jumpstart_preview_lathe"), { expectedRevision: "one", plan: { ...plan, script: "bad" } }));
  assert.throws(() => validateToolInput(schema("jumpstart_preview_lathe"), { expectedRevision: "one", plan: { ...plan, profile: Array(129).fill([0,1]) } }));
  assert.throws(() => validateToolInput(schema("jumpstart_preview_native_parameters"), { expectedRevision: "one", values: { w: Infinity } }));
});
