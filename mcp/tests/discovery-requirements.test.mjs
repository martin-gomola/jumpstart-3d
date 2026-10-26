import test from "node:test";
import assert from "node:assert/strict";
import { focusCapabilities, publishTools } from "../server/discovery.mjs";
import { evaluateRequirements, validateRequirements, comparePreviewBodies } from "../browser/preview-requirements.js";
import { failureGuidance } from "../shared/failure-guidance.js";
import { validateToolInput } from "../shared/schema.js";
import { readFile, readdir } from "node:fs/promises";

const cube = { vertices: [0,0,0, 2,0,0, 2,2,0, 0,2,0, 0,0,2, 2,0,2, 2,2,2, 0,2,2], triangles: [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7] };
const state = (mesh = cube) => ({ document: { bodies: [{ id: "native" }, { id: "other" }] }, featureBodyIds: { block: "native", copies: ["native", "other"] }, geometries: new Map([["native", { mesh }]]), beforeSignatures: new Map([["other", "old"]]), afterSignatures: new Map([["other", "old"]]) });

test("focused discovery filters copies, rejects unknown names and keeps the full catalog compatible", () => {
  const typed = (...types) => types.map((type) => ({ properties: { type: { const: type } } }));
  const variants = [...typed("gear", "knurl"), { properties: { type: { const: "modifier" }, modifier: { oneOf: typed("fillet", "hole") } } }];
  const plan = { properties: { primitives: { items: { properties: { kind: { enum: ["box"] } } } }, sketches: { items: { properties: { profile: { oneOf: typed("circle") } } } }, features: { items: { properties: { type: { enum: ["extrude"] } } } }, operations: { items: { oneOf: variants } } } };
  const catalog = { toolSchemas: [{ name: "jumpstart_preview_model", title: "Preview", inputSchema: { properties: { plan } } }, { name: "jumpstart_get_document", title: "Read", inputSchema: { properties: {} } }], units: "mm" };
  const original = JSON.stringify(catalog);
  const compact = focusCapabilities(catalog, { includeSchemas: false });
  assert.equal(compact.toolSchemas, undefined);
  assert.equal(compact.availableTools.length, 2);
  assert.deepEqual(compact.planVocabulary, { primitiveKinds: ["box"], profileTypes: ["circle"], featureTypes: ["extrude"], operationTypes: ["gear", "knurl", "modifier"], modifierTypes: ["fillet", "hole"], guide: compact.planVocabulary.guide });
  assert.match(compact.planVocabulary.guide, /modifier/);
  const focused = focusCapabilities(catalog, { operationTypes: ["knurl"] });
  assert.equal(focused.toolSchemas.length, 1);
  focused.toolSchemas[0].title = "Changed copy";
  assert.equal(focused.toolSchemas[0].inputSchema.properties.plan.properties.operations.items.oneOf.length, 1);
  const expr = { type: "object", properties: { $expr: { type: "string" } } };
  const withExpr = { toolSchemas: [{ name: "jumpstart_preview_model", inputSchema: { properties: { plan, size: { oneOf: [{ type: "number" }, expr] } } } }] };
  const shared = focusCapabilities(withExpr, { toolNames: ["jumpstart_preview_model"] }).toolSchemas[0].inputSchema;
  assert.deepEqual(shared.$defs, { expr });
  assert.deepEqual(shared.properties.size.oneOf[1], { $ref: "#/$defs/expr" });
  assert.deepEqual(focusCapabilities(withExpr).toolSchemas[0].inputSchema.$defs, { expr });
  assert.equal(JSON.stringify(catalog), original);
  assert.deepEqual(focusCapabilities(catalog), catalog);
  assert.throws(() => focusCapabilities(catalog, { toolNames: ["invented"] }), /Unknown/);
  assert.throws(() => focusCapabilities(catalog, { operationTypes: ["script"] }), /Unsupported/);
  const fragments = focusCapabilities(catalog, { schemaPaths: ["plan.sketches.profile.circle", "plan.operations.modifier.hole"] });
  assert.equal(fragments.toolSchemas, undefined);
  assert.deepEqual(fragments.schemaFragments.map(({ tool, path, schema }) => [tool, path, schema]), [["jumpstart_preview_model", "plan.sketches.profile.circle", typed("circle")[0]], ["jumpstart_preview_model", "plan.operations.modifier.hole", typed("hole")[0]]]);
  assert.throws(() => focusCapabilities(catalog, { schemaPaths: ["plan.operations.script"] }), /available: gear, knurl, modifier/);
  assert.throws(() => focusCapabilities(catalog, { schemaPaths: ["plan"], operationTypes: ["knurl"] }), /one tool/);
  assert.equal(JSON.stringify(catalog), original);
});

test("published tool schemas share $expr and point non-model previews at full requirements", () => {
  const expr = { type: "object", additionalProperties: false, properties: { $expr: { type: "string" } }, required: ["$expr"] };
  const number = { oneOf: [{ type: "number" }, expr] };
  const requirements = { type: "object", additionalProperties: false, properties: { bodyCount: { type: "integer" } } };
  const tools = [
    { name: "jumpstart_preview_model", inputSchema: { type: "object", properties: { plan: { type: "object", properties: { a: number, b: { type: "array", items: number } } }, requirements } } },
    { name: "jumpstart_preview_lathe", inputSchema: { type: "object", properties: { requirements } } },
    { name: "jumpstart_inspect_geometry", inputSchema: { type: "object", properties: { requirements } } },
  ];
  const original = JSON.stringify(tools);
  const [model, lathe, inspect] = publishTools(tools);
  assert.equal(JSON.stringify(tools), original);
  assert.deepEqual(model.inputSchema.$defs, { expr });
  assert.deepEqual(model.inputSchema.properties.plan.properties.a.oneOf[1], { $ref: "#/$defs/expr" });
  const inline = (node) => node?.$ref ? expr : Array.isArray(node) ? node.map(inline) : node && typeof node === "object" ? Object.fromEntries(Object.entries(node).filter(([key]) => key !== "$defs").map(([key, value]) => [key, inline(value)])) : node;
  assert.deepEqual(inline(model.inputSchema), tools[0].inputSchema);
  assert.match(lathe.inputSchema.properties.requirements.description, /toolNames \["jumpstart_preview_lathe"\]/);
  assert.equal(lathe.inputSchema.$defs, undefined);
  assert.deepEqual(inspect.inputSchema, tools[2].inputSchema);
});

test("published preview_model defers domain generator fields to schemaPaths", () => {
  const knurl = { type: "object", additionalProperties: false, required: ["id", "type"], properties: { id: { type: "string" }, type: { const: "knurl" }, diameter: { type: "number" } } };
  const combine = { type: "object", additionalProperties: false, required: ["id", "type"], properties: { id: { type: "string" }, type: { const: "combine" } } };
  const tools = [{ name: "jumpstart_preview_model", inputSchema: { type: "object", properties: { plan: { type: "object", properties: { operations: { type: "array", items: { oneOf: [knurl, combine] } } } } } } }];
  const original = JSON.stringify(tools);
  const [stub, kept] = publishTools(tools)[0].inputSchema.properties.plan.properties.operations.items.oneOf;
  assert.equal(JSON.stringify(tools), original);
  assert.deepEqual(stub.properties, { type: { const: "knurl" } });
  assert.deepEqual(stub.required, ["id", "type"]);
  assert.match(stub.description, /schemaPaths \["plan\.operations\.knurl"\]/);
  assert.deepEqual(kept, combine);
  assert.match(failureGuidance(new Error("arguments.plan.operations[0]: unknown property x; allowed: id (does not match an allowed input shape for type knurl)")).nextChecks[0], /schemaPaths \["plan\.operations\.knurl"\]/);
  assert.match(failureGuidance(new Error("arguments.plan.operations[1].modifier: unknown property dept (does not match an allowed input shape for type hole)")).nextChecks[0], /schemaPaths \["plan\.operations\.modifier\.hole"\]/);
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

test("oneOf validation errors name the failing variant field or the expected types", () => {
  const expr = { type: "object", additionalProperties: false, required: ["$expr"], properties: { $expr: { type: "string" } } };
  const variants = { oneOf: [{ type: "object", additionalProperties: false, required: ["type", "center"], properties: { type: { const: "circle" }, center: { type: "array" }, radius: { oneOf: [{ type: "number" }, expr] } } }] };
  assert.throws(() => validateToolInput({ type: "circle", radius: 1 }, variants, "arguments.profile"), /^Error: arguments\.profile: missing center \(does not match an allowed input shape for type circle\)$/);
  assert.throws(() => validateToolInput({ type: "circle", center: [], radius: "1" }, variants, "arguments.profile"), /radius: does not match an allowed input shape: expected number or \{ "\$expr": "\.\.\." \}, got string/);
  assert.throws(() => validateToolInput({ type: "square" }, variants, "arguments.profile"), /type must be one of circle$/);
});

test("failure guidance distinguishes recovery actions without claiming a geometry diagnosis", () => {
  for (const [message, category] of [["editor timed out", "timeout"], ["inspection budget exceeded", "resource_limit"], ["document changed after preview", "stale_state"], ["operation unsupported", "unsupported"], ["Preview requirements did not pass", "acceptance"], ["CAD construction failed", "validation_or_execution"], ["arguments.requirements.bodies[0]: unknown property x", "invalid_arguments"]]) {
    if (category === "invalid_arguments") assert.match(failureGuidance(new Error(message)).nextChecks[0], /for example \["plan\.operations\.modifier\.hole"\]/);
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
  assert.equal(refs.length, 12);
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
