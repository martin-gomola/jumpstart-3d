import test from "node:test";
import assert from "node:assert/strict";
import { focusCapabilities } from "../server/discovery.mjs";
import { evaluateRequirements, validateRequirements, comparePreviewBodies } from "../browser/preview-requirements.js";
import { failureGuidance } from "../shared/failure-guidance.js";
import { readFile, readdir } from "node:fs/promises";

const cube = { vertices: [0,0,0, 2,0,0, 2,2,0, 0,2,0, 0,0,2, 2,0,2, 2,2,2, 0,2,2], triangles: [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7] };
const state = (mesh = cube) => ({ document: { bodies: [{ id: "native" }, { id: "other" }] }, featureBodyIds: { block: "native", copies: ["native", "other"] }, geometries: new Map([["native", { mesh }]]), beforeSignatures: new Map([["other", "old"]]), afterSignatures: new Map([["other", "old"]]) });

test("focused discovery filters copies, rejects unknown names and keeps the full catalog compatible", () => {
  const variants = ["gear", "knurl"].map((type) => ({ properties: { type: { const: type } } }));
  const catalog = { toolSchemas: [{ name: "jumpstart_preview_model", title: "Preview", inputSchema: { properties: { plan: { properties: { operations: { items: { oneOf: variants } } } } } } }, { name: "jumpstart_get_document", title: "Read" }], units: "mm" };
  const original = JSON.stringify(catalog);
  const compact = focusCapabilities(catalog, { includeSchemas: false });
  assert.equal(compact.toolSchemas, undefined);
  assert.equal(compact.availableTools.length, 2);
  const focused = focusCapabilities(catalog, { operationTypes: ["knurl"] });
  assert.equal(focused.toolSchemas.length, 1);
  focused.toolSchemas[0].title = "Changed copy";
  assert.equal(focused.toolSchemas[0].inputSchema.properties.plan.properties.operations.items.oneOf.length, 1);
  assert.equal(JSON.stringify(catalog), original);
  assert.deepEqual(focusCapabilities(catalog), catalog);
  assert.throws(() => focusCapabilities(catalog, { toolNames: ["invented"] }), /Unknown/);
  assert.throws(() => focusCapabilities(catalog, { operationTypes: ["script"] }), /Unsupported/);
});

test("acceptance independently measures geometry, world bounds and component counts", () => {
  const requirements = { bodyCount: 2, preserveBodyIds: ["other"], bodies: [{ target: "block", checks: [{ id: "width", kind: "dimension", axis: "X", expected: 2 }, { id: "connected", kind: "components", expected: 1 }, { id: "side", kind: "bound", axis: "X", side: "max", expected: 2 }] }] };
  assert.equal(evaluateRequirements(requirements, state()).status, "passed");
  const moved = state({ ...cube, matrix: [1,0,0,0,0,1,0,0,0,0,1,0,10,0,0,1] });
  const failed = evaluateRequirements(requirements, moved);
  assert.equal(failed.status, "failed");
  assert.equal(failed.checks.find(({ id }) => id === "width").pass, true);
  assert.equal(failed.checks.find(({ id }) => id === "side").measured, 12);
  const two = { vertices: [...cube.vertices, ...cube.vertices.map((v, i) => v + (i % 3 === 0 ? 5 : 0))], triangles: [...cube.triangles, ...cube.triangles.map((i) => i + 8)] };
  assert.equal(evaluateRequirements(requirements, state(two)).checks.find(({ id }) => id === "connected").measured, 2);
  assert.equal(evaluateRequirements({ preserveBodyIds: ["other"] }, { ...state(), afterSignatures: new Map([["other", "changed"]]) }).passed, false);
  assert.equal(evaluateRequirements({ preserveBodyIds: ["missing"] }, state()).passed, false);
});

test("unmeasured, ambiguous, malformed, duplicate and excessive acceptance contracts cannot pass", () => {
  for (const target of ["missing", "copies"]) assert.equal(evaluateRequirements({ bodies: [{ target, checks: [{ id: "size", kind: "dimension", axis: "X", expected: 2 }] }] }, state()).status, "unknown");
  const unsupportedSection = { bodies: [{ target: "block", checks: [{ id: "channels", kind: "channels", axis: "Y", crossAt: 100, expected: { count: 2 } }] }] };
  assert.equal(evaluateRequirements(unsupportedSection, state()).status, "unknown");
  for (const malformed of [{}, { bodyCount: -1 }, { preserveBodyIds: ["a", "a"] }, { bodies: [{ target: "block", checks: [{ id: "run", kind: "script", expected: 1 }] }] }]) assert.throws(() => validateRequirements(malformed));
  assert.throws(() => validateRequirements({ bodies: Array.from({ length: 9 }, (_, i) => ({ target: `b${i}`, checks: Array.from({ length: 8 }, (_, j) => ({ id: `c${j}`, kind: "components", expected: 1 })) })) }), /64-check/);
  assert.throws(() => validateRequirements({ bodies: [{ target: "block", checks: [{ id: "same", kind: "components", expected: 1 }, { id: "same", kind: "components", expected: 1 }] }] }), /duplicates/);
});

test("change reports detect placement changes even when dimensions and volume match", () => {
  const before = new Map([["a", { dimensions: { x: 2, y: 2, z: 2 }, volume: 8, bounds: { min: [0,0,0], max: [2,2,2] } }]]);
  const after = new Map([["a", { ...before.get("a"), bounds: { min: [10,0,0], max: [12,2,2] } }]]);
  const changes = comparePreviewBodies(before, after, new Map([["a", "before"], ["kept", "same"]]), new Map([["a", "after"], ["kept", "same"]]));
  assert.deepEqual(changes.changed, ["a"]);
  assert.deepEqual(changes.unchanged, ["kept"]);
  assert.equal(changes.measurements[0].volumeDelta, 0);
  assert.deepEqual(changes.measurements[0].dimensionsDelta, { x: 0, y: 0, z: 0 });
  assert.equal(changes.measurements[0].after.bounds.min[0], 10);
});

test("failure guidance distinguishes recovery actions without claiming a geometry diagnosis", () => {
  for (const [message, category] of [["editor timed out", "timeout"], ["inspection budget exceeded", "resource_limit"], ["document changed after preview", "stale_state"], ["operation unsupported", "unsupported"], ["Preview requirements did not pass", "acceptance"], ["CAD construction failed", "validation_or_execution"]]) {
    const result = failureGuidance(new Error(message));
    assert.equal(result.category, category);
    assert.ok(result.nextChecks.length);
  }
  assert.match(failureGuidance("editor timed out").nextChecks.join(" "), /same preview id/);
});

test("the skill routes directly to focused references and packages no broken local links", async () => {
  const root = new URL("../plugin/skills/3d-model/", import.meta.url);
  const core = await readFile(new URL("SKILL.md", root), "utf8");
  assert.ok(core.split("\n").length <= 110);
  assert.match(core, /includeSchemas:false/);
  const refs = await readdir(new URL("references/", root));
  assert.equal(refs.length, 6);
  for (const ref of refs) assert.ok(core.includes(`references/${ref}`), `${ref} must be discoverable directly`);
  for (const file of ["SKILL.md", ...refs.map((file) => `references/${file}`)]) {
    const contents = await readFile(new URL(file, root), "utf8");
    for (const match of contents.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(match[1])) continue;
      await readFile(new URL(match[1], new URL(file, root)));
    }
    if (contents.split("\n").length > 100) assert.match(contents, /## Contents/);
  }
});


test("grounded skill instructions remain present after progressive-disclosure moves", async () => {
  const root = new URL("../plugin/skills/3d-model/", import.meta.url);
  const grounding = await readFile(new URL("grounding.yaml", root), "utf8");
  const rules = [...grounding.matchAll(/- instruction: ("[^\n]*")\n    skillFile: ([^\n]+)/g)];
  assert.ok(rules.length >= 19);
  for (const [, quoted, file] of rules) {
    const text = (await readFile(new URL(file, root), "utf8")).replace(/\s+/g, " ");
    assert.ok(text.includes(JSON.parse(quoted)), `${file} must contain ${quoted}`);
  }
});
