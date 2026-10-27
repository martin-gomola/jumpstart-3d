import test from "node:test";
import assert from "node:assert/strict";
import { createDrawerPlanner, drawerStatus, numberValid } from "../browser/ui/drawer-planner.js";

const memoryStorage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };

test("number validity follows HTML min, max and step rules", () => {
  assert.equal(numberValid("", { min: 0 }), false);
  assert.equal(numberValid("0.2", { min: 0, max: 1, step: 0.1 }), true);
  assert.equal(numberValid("0.25", { min: 0, max: 1, step: 0.1 }), false);
  assert.equal(numberValid("881.99", { min: 42, max: 881.99 }), true);
  assert.equal(numberValid("13", { min: 14 }), false);
});

test("drawer planner edits a draft with undo, redo and placement checks without the DOM", () => {
  let renders = 0;
  const planner = createDrawerPlanner({ request: async () => { throw new Error("unused"); }, storage: memoryStorage() });
  planner.subscribe(() => renders++);
  planner.example();
  const { draft } = planner.getState();
  assert.deepEqual([draft.width, draft.depth, draft.height], [336, 252, 50]);
  assert.equal(drawerStatus(draft).fit, "8 × 6 grid · 336 × 252 mm. Spare space: 0.0 mm per side, 0.0 mm front/back.");

  planner.addBin();
  let state = planner.getState();
  assert.equal(state.draft.bins.length, 1);
  assert.equal(state.selectedId, "bin-1");
  assert.equal(state.measureOpen, false);

  assert.equal(planner.setDimension("width", 42), false);
  assert.equal(planner.getState().message.text, "Move or remove bins before making the drawer smaller.");
  assert.equal(planner.getState().draft.width, 336);

  assert.equal(planner.updateBin({ x: 7 }), false);
  assert.equal(planner.getState().draft.bins[0].x, 0);
  assert.equal(planner.updateBin({ x: 2 }), true);
  assert.equal(planner.getState().draft.bins[0].x, 2);

  planner.undo();
  state = planner.getState();
  assert.equal(state.draft.bins[0].x, 0);
  assert.equal(state.selectedId, null);
  planner.redo();
  assert.equal(planner.getState().draft.bins[0].x, 2);
  assert.ok(renders > 0);
});

test("drawer planner previews, applies and reloads through the MCP request contract", async () => {
  const calls = [];
  let layouts = [];
  const request = async (action, args) => {
    calls.push(action);
    if (action === "get_document") return { revision: calls.length, document: { id: "doc-1" }, drawerLayouts: layouts };
    if (action === "preview_model") return { valid: true, previewId: "p1", bodies: [{ id: "b1", name: "Baseplate", printFit: { rotation: 90 } }], images: [] };
    if (action === "inspect_geometry") return { meshValidation: { valid: true, disconnectedComponents: 1 } };
    if (action === "apply_model") { layouts = [{ editable: true, definition: { ...planner.getState().draft } }]; return {}; }
    throw new Error(action);
  };
  const busy = [];
  const planner = createDrawerPlanner({ request, onBusy: value => busy.push(value), storage: memoryStorage() });
  planner.example();
  await planner.preview();
  let state = planner.getState();
  assert.deepEqual(calls, ["get_document", "preview_model", "inspect_geometry"]);
  assert.equal(state.view, "preview");
  assert.deepEqual({ parts: state.preview.parts, rotated: state.preview.rotated, replaceExisting: state.preview.replaceExisting }, { parts: 1, rotated: 1, replaceExisting: false });
  assert.equal(state.message.text, "Preview ready. The document is unchanged.");

  planner.deactivate();
  assert.equal(planner.getState().cached, null);
  assert.equal(planner.getState().stale, true);
  await planner.preview();
  await planner.apply();
  state = planner.getState();
  assert.equal(state.continueVisible, true);
  assert.equal(state.savedLayouts.length, 1);
  assert.deepEqual(busy, [true, false, true, false, true, false]);

  const reopened = createDrawerPlanner({ request, storage: memoryStorage() });
  await reopened.refreshDocument({ document: { id: "doc-1" }, drawerLayouts: layouts });
  assert.equal(reopened.getState().draft.name, "Example drawer");
  assert.equal(reopened.getState().message.text, "Layout loaded. Changes need a new preview before updating the document.");
});

test("drawer planner keeps bin limits and printer area as browser preferences", () => {
  const storage = memoryStorage();
  const planner = createDrawerPlanner({ request: async () => ({}), storage });
  const area = { width: 256, depth: 256, height: 260, edgeMargin: 2 };
  assert.match(planner.setBinLimits({ columns: 3, rows: 3 }, area), /saved/);
  assert.deepEqual(JSON.parse(storage.getItem("jumpstart.gridfinity.binLimits")), { columns: 3, rows: 3 });
  const next = createDrawerPlanner({ request: async () => ({}), storage });
  assert.deepEqual(next.getBinLimits(), { columns: 3, rows: 3 });
  assert.equal(next.getPrintArea().width, 256);
});
