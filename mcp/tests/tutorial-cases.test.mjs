import test from "node:test";
import assert from "node:assert/strict";
import { TUTORIAL_CASES } from "../benchmarks/tutorial-cases.mjs";
import { buildModelPlan } from "../browser/model-plan.js";

const edge = (m, t = "LINE", a = [0, 0, 0], b = [0, 100, 0]) => ({ a, b, m, n: [0.5, 0.5, 0.5], t });
const face = (c, t = "PLANE", extra = {}) => ({ c, t, n: [0, 0, 1], ...extra });

function fakePreview(plan) {
  const names = [
    ...(plan.primitives || []).map((item) => item.name || item.id),
    ...(plan.features || []).map((item) => item.name || item.id),
  ];
  const bodies = names.map((name) => ({
    name,
    geometrySelectors: {
      edges: [
        edge([0, 0, 6], "CIRCLE", [5, 0, 6], [5, 0, 6]),
        edge([25.86, 0, 14.14], "LINE", [40, -80, 0], [11.72, 80, 28.28]),
        edge([5, 0, 5], "LINE", [5, -10, 5], [5, 10, 5]),
        edge([20, 0, 20], "LINE", [20, -10, 20], [20, 10, 20]),
        edge([10, 0, 30], "LINE", [10, -10, 30], [10, 10, 30]),
        edge([0, 0, 60], "LINE", [0, -10, 60], [0, 10, 60]),
        edge([30, 0, 20], "LINE", [30, -10, 20], [30, 10, 20]),
        edge([75, 0, 15], "LINE", [75, -35, 15], [75, 35, 15]),
        edge([50, 0, 8], "LINE", [50, -35, 8], [50, 35, 8]),
        edge([40, -35, 25], "LINE", [40, -35, 0], [40, -35, 50]),
        edge([-40, -35, 25], "LINE", [-40, -35, 0], [-40, -35, 50]),
        edge([40, 35, 25], "LINE", [40, 35, 0], [40, 35, 50]),
        edge([-40, 35, 25], "LINE", [-40, 35, 0], [-40, 35, 50]),
        edge([0, 0, 48], "CIRCLE", [9, 0, 48], [9, 0, 48]),
        edge([0, 0, 34], "CIRCLE", [9, 0, 34], [9, 0, 34]),
        edge([0, 0, 5], "CIRCLE", [16, 0, 5], [16, 0, 5]),
      ],
      faces: [
        face([0, 0, 120]), face([0, 0, 0]), face([20, -35, 25]),
        face([25, 0, 14], "PLANE", { n: [0.707, 0, 0.707] }),
        face([0, 0, 66], "CYLINDRE", { r: 24, ext: true }),
        face([80, 0, 8], "CYLINDRE", { r: 22.4, ext: false }),
        face([100, 0, 43]),
      ],
    },
  }));
  return { valid: true, bodies };
}

test("all implemented MCP tutorial plans compile to the typed native model-plan DSL", async () => {
  assert.equal(TUTORIAL_CASES.length, 16);
  const empty = { id: "doc-test", name: "Untitled", mode: "beginner", seq: 0, sketches: [], bodies: [], planes: [], joints: [] };
  const seen = new Set();
  for (const scenario of TUTORIAL_CASES) {
    assert.ok(scenario.prompt.length > 30, `${scenario.id} should have a natural-language task`);
    assert.ok(!seen.has(scenario.id), `duplicate tutorial ${scenario.id}`);
    seen.add(scenario.id);
    const plan = scenario.buildPlan ? await scenario.buildPlan(async (candidate) => fakePreview(candidate)) : scenario.plan;
    const built = buildModelPlan(empty, plan, (() => { let i = 0; return (prefix) => `${prefix}-${++i}`; })());
    assert.ok(built.document.bodies.length > 0, `${scenario.id} should create bodies`);
    assert.ok(built.affectedBodyIds.length > 0, `${scenario.id} should report affected bodies`);
  }
});


test("native tutorial benchmark plans preserve distinct Lathe and native parameter workflows", async () => {
  const { NATIVE_TUTORIAL_CASES } = await import("../benchmarks/tutorial-native-cases.mjs");
  assert.deepEqual(NATIVE_TUTORIAL_CASES.map(item => item.id), ["b-top", "a-cup", "a-params"]);
  for (const scenario of NATIVE_TUTORIAL_CASES) assert.ok(scenario.prompt.length > 100);
  const [top, cup, bracket] = NATIVE_TUTORIAL_CASES;
  assert.equal(top.plan.blank.side, 40);
  assert.equal(top.plan.blank.length, 70);
  assert.equal(cup.plan.hollow.wall, 3);
  assert.equal(cup.plan.hollow.base, 6);
  assert.equal(cup.revisedScale, 1.1);
  assert.deepEqual(bracket.plan.parameters, [{ name: "w", expression: "60" }, { name: "h", expression: "w/2" }, { name: "t", expression: "8" }]);
  assert.equal(bracket.plan.rectangle.widthExpression, "w");
  assert.equal(bracket.plan.extrude.distanceExpression, "t");
});

test("native bracket assertions require actual bindings and regenerated dimensions", async () => {
  const { validateNativeBracket } = await import("../benchmarks/tutorial-native-cases.mjs");
  const document = {
    nativeParameters: [{ name: "w", value: 80 }, { name: "h", value: 40, expression: "w/2" }],
    sketches: [{ constraints: [{ t: "dim", expr: "w" }, { t: "dim", expr: "h" }] }],
    bodies: [{ featureTree: { exprs: { dist: "t" } }, dimensions: { x: 80, y: 40, z: 8 } }],
  };
  assert.doesNotThrow(() => validateNativeBracket(document, 80));
  assert.throws(() => validateNativeBracket({ ...document, nativeParameters: [] }, 80), /w parameter/);
  assert.throws(() => validateNativeBracket({ ...document, sketches: [] }, 80), /bindings/);
  assert.throws(() => validateNativeBracket({ ...document, bodies: [{ ...document.bodies[0], dimensions: { x: 60, y: 30, z: 8 } }] }, 80), /dimensions/);
});
