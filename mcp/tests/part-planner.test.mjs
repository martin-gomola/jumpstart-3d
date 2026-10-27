import test from "node:test";
import assert from "node:assert/strict";
import { createPartPlanner, partFit, partState, partSummary, templatePlan } from "../browser/ui/part-planner.js";

test("part planner turns edited texts into the template plan without the DOM", () => {
  const planner = createPartPlanner();
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

test("part fit checks the overall size against the saved printer area", () => {
  const planner = createPartPlanner(), area = { width: 90, depth: 130, height: 100, edgeMargin: 2 };
  assert.deepEqual(partFit(planner.getState().draft, true, false), { rotated: false });
  assert.deepEqual(partFit(planner.getState().draft, true, area), { rotated: false });
  assert.deepEqual(partFit(planner.getState().draft, true, { ...area, width: 130, depth: 90 }), { rotated: true });
  assert.match(partFit(planner.getState().draft, true, { ...area, depth: 90 }).error, /^This part \(83\.5 × 125\.5 × [\d.]+ mm\) exceeds the usable printer area/);
  planner.setField("columns", "0");
  assert.deepEqual(partFit(planner.getState().draft, true, { ...area, depth: 90 }), { rotated: false });
  planner.setField("columns", "2");
  planner.showError(new Error("Too deep"));
  assert.deepEqual(planner.getState().message, { text: "Too deep", error: true });
  planner.setLip(false);
  assert.deepEqual(planner.getState().message, { text: "", error: false });
});
