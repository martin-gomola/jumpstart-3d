import test from "node:test";
import assert from "node:assert/strict";
import { createParameterPlanner, parameterFields, parameterLabel, selectedModel } from "../browser/ui/parameter-planner.js";

const model = (parameters, extra = {}) => ({ id: "coaster", bodyIds: ["b1"], template: { name: "Named coaster" }, parameters, ...extra });
const PARAMETERS = {
  diameter: { value: 100, unit: "mm", min: 10, max: 500 },
  holeCount: { value: 4, unit: "count", min: 1, max: 12 },
  thickness: { expression: "floor + depth", unit: "mm", value: 6 },
};

test("parameter fields label names, keep bounds and mark derived values read-only", () => {
  assert.equal(parameterLabel("innerWidth"), "Inner width");
  assert.equal(parameterLabel("wall_thickness"), "Wall thickness");
  const fields = parameterFields(model(PARAMETERS));
  assert.deepEqual(fields.map((f) => [f.name, f.label, f.unit, f.derived]), [["diameter", "Diameter", "mm", false], ["holeCount", "Hole count", "", false], ["thickness", "Thickness", "mm", true]]);
  assert.deepEqual(fields[0].limits, { min: 10, max: 500, step: "any" });
  assert.equal(fields[1].limits.step, 1);
});

test("only a single model that owns the whole selection is offered", () => {
  const a = { id: "a", bodyIds: ["1", "2"] }, b = { id: "b", bodyIds: ["3"] };
  assert.equal(selectedModel([a, b], ["1"]), a);
  assert.equal(selectedModel([a, b], ["1", "2"]), a);
  assert.equal(selectedModel([a, b], ["1", "3"]), null);
  assert.equal(selectedModel([a, b], ["9"]), null);
  assert.equal(selectedModel([a, b], []), null);
});

function fakeEditor(parameters, extra) {
  const calls = [];
  let current = model(parameters, extra);
  const request = async (action, params) => {
    calls.push([action, params]);
    if (action === "get_document") return { revision: "r1", parametricModels: params.bodyIds.includes("b1") ? [structuredClone(current)] : [] };
    if (action === "preview_parameters") return { valid: true, previewId: "p1", bodies: [{ dimensions: { x: params.values.diameter, y: params.values.diameter, z: 6 } }] };
    if (action === "apply_model") { current = model({ ...current.parameters, diameter: { ...current.parameters.diameter, value: 120 } }); return {}; }
    throw new Error("unexpected " + action);
  };
  return { calls, request };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the planner previews only changed independent values, then applies and reloads the saved model", async () => {
  const editor = fakeEditor(PARAMETERS);
  const planner = createParameterPlanner({ request: editor.request, delay: 0 });
  planner.select(["b1"]);
  await settle();
  assert.equal(planner.getState().model.name, "Named coaster");
  assert.equal(planner.hasChanges(), false);

  planner.setText("diameter", "600");
  assert.match(planner.errors().diameter, /between 10 and 500 mm/);
  await planner.preview();
  assert.equal(editor.calls.some(([action]) => action === "preview_parameters"), false);
  assert.equal(planner.getState().message.error, true);

  planner.setText("diameter", "120");
  await planner.preview();
  const [, params] = editor.calls.find(([action]) => action === "preview_parameters");
  assert.deepEqual(params, { modelId: "coaster", values: { diameter: 120 }, expectedRevision: "r1", includeImage: false });
  assert.equal(planner.getState().preview.previewId, "p1");

  await planner.apply();
  assert.equal(planner.getState().fields[0].value, 120);
  assert.equal(planner.getState().texts.diameter, "120");
  assert.equal(planner.getState().preview, null);
  assert.match(planner.getState().message.text, /Updated/);
});

test("editing a value drops a stale preview, and leaving the model clears the card", async () => {
  const editor = fakeEditor(PARAMETERS);
  const planner = createParameterPlanner({ request: editor.request, delay: 0 });
  planner.select(["b1"]);
  await settle();
  planner.setText("diameter", "150");
  await planner.preview();
  planner.setText("diameter", "160");
  assert.equal(planner.getState().preview, null);
  planner.select(["other"]);
  await settle();
  assert.equal(planner.getState().model, null);
});

test("a model edited by hand is reported so its settings are not offered for regeneration", async () => {
  const editor = fakeEditor(PARAMETERS, { editedOutside: true });
  const planner = createParameterPlanner({ request: editor.request, delay: 0 });
  planner.select(["b1"]);
  await settle();
  assert.equal(planner.getState().model.editedOutside, true);
});
