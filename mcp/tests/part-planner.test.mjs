import test from "node:test";
import assert from "node:assert/strict";
import { createPartPlanner, partState, partSummary, templatePlan } from "../browser/ui/part-planner.js";

test("part planner turns edited texts into the template plan without the DOM", () => {
  const planner = createPartPlanner({ request: async () => { throw new Error("unused"); } });
  planner.setKind("insert");
  planner.setField("columns", "3");
  const [pocket] = planner.getState().draft.pockets;
  planner.setPocket(pocket.index, { shape: "circle", product: "  Caliper  " });
  planner.applyReference(pocket.index, { id: "ref-1", name: "Battery", dimensions: { x: 18.25, y: 65.1 } });
  const state = planner.getState();
  assert.equal(state.message.text, "Envelope dimensions copied. Set the pocket's depth and orientation.");
  const plan = templatePlan(partState(state.draft));
  assert.equal(plan.name, "Gridfinity custom insert 3 x 3");
  const pocketOperation = plan.operations[1];
  assert.equal(pocketOperation.referenceBodyId, "ref-1");
  assert.deepEqual(pocketOperation.profile, { type: "circle", radius: { $expr: "pocket1Radius" } });
  assert.equal(plan.parameters.pocket1Radius.value, 18.25 / 2);
  assert.deepEqual(pocketOperation.sourceEvidence, { product: "Battery", kind: "model", units: "mm" });

  planner.setKind("bin");
  planner.setField("columns", "0");
  assert.equal(partSummary(planner.getState().draft).dimensions, "Enter a valid size to update the sizing guide.");
});

test("part planner previews, applies and discards on document changes", async () => {
  const calls = [];
  const request = async (method, params) => {
    calls.push(method);
    if (method === "get_document") return { revision: 4, bodies: [] };
    if (method === "preview_model") return { valid: true, previewId: "p1", bodies: [{ id: "b1", name: "Bin", dimensions: { x: 83.5, y: 125.5, z: 25.4 } }], images: [] };
    if (method === "inspect_geometry") return { meshValidation: { valid: true, disconnectedComponents: 1 } };
    if (method === "apply_model") { assert.equal(params.previewId, "p1"); return {}; }
    throw new Error(method);
  };
  const planner = createPartPlanner({ request });
  await planner.preview();
  let state = planner.getState();
  assert.equal(state.cached.previewId, "p1");
  assert.equal(state.preview.dimensions.x, 83.5);
  assert.equal(state.message.text, "Preview ready. The document is unchanged.");

  planner.setLip(false);
  assert.equal(planner.getState().cached, null);
  assert.ok(planner.getState().preview, "an edited preview stays visible as out of date");

  await planner.preview();
  await planner.apply();
  state = planner.getState();
  assert.deepEqual(calls.slice(-2), ["apply_model", "get_document"]);
  assert.equal(state.preview, null);
  assert.equal(state.success, 1);

  planner.documentChanged("edit");
  assert.equal(planner.getState().success, 0);
  assert.equal(planner.getState().message.text, "The document changed. Preview again before adding.");
});
