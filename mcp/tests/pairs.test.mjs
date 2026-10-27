import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePairChecks } from "../shared/pairs.js";
import { validateRequirements, evaluateRequirements } from "../browser/inspection/preview-requirements.js";
import { inspectNativePairs } from "../browser/inspection/pair-inspection.js";
import { measureSolidPair, validatePairPlacement } from "../../src/pairGeometry.js";
import { KernelClient } from "../../src/kernelClient.js";

const measured = { status: "measured", distanceMm: 0.3, overlapVolumeMm3: 0, witnessPoints: { a: [0, 0, 0], b: [0.3, 0, 0] } };
const req = { pairs: [{ id: "fit", a: "base", b: "lid", minimumClearance: 0.3, maximumOverlapVolume: 0 }] };
const context = { document: { bodies: [] }, geometries: new Map(), beforeSignatures: new Map(), afterSignatures: new Map() };

test("pair acceptance uses explicit tolerances and never mistakes missing or invalid measurements for zero overlap", () => {
  validateRequirements(req);
  const placement = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  validatePairPlacement(placement);
  const scaled = placement.slice(); scaled[0] = 2;
  assert.throws(() => validatePairPlacement(scaled), /Nonuniform/);
  const shear = placement.slice(); shear[4] = 0.5;
  assert.throws(() => validatePairPlacement(shear), /unsupported/);
  const perspective = placement.slice(); perspective[3] = 0.1;
  assert.throws(() => validatePairPlacement(perspective), /Perspective/);
  assert.equal(evaluatePairChecks(measured, req.pairs[0]).status, "passed");
  assert.equal(evaluatePairChecks({ ...measured, distanceMm: 0.2999999999 }, req.pairs[0]).status, "passed");
  assert.equal(evaluatePairChecks({ ...measured, distanceMm: 0.1 }, req.pairs[0]).status, "failed");
  assert.equal(evaluatePairChecks({ ...measured, distanceMm: 0, overlapVolumeMm3: 1 }, { maximumOverlapVolume: 0 }).status, "failed");
  for (const result of [undefined, { status: "unknown" }, { ...measured, overlapVolumeMm3: NaN }, { ...measured, distanceMm: -1 }]) assert.equal(evaluatePairChecks(result, req.pairs[0]).status, "unknown");
  assert.equal(evaluateRequirements(req, { ...context, pairResults: [{ id: "fit", ...measured }] }).passed, true);
  assert.equal(evaluateRequirements(req, { ...context, pairResults: [] }).passed, false);
  for (const pairs of [[{ id: "same", a: "base", b: "base", minimumClearance: 0 }], [{ id: "empty", a: "base", b: "lid" }], Array.from({ length: 9 }, (_, i) => ({ ...req.pairs[0], id: String(i) }))]) assert.throws(() => validateRequirements({ pairs }));
  assert.throws(() => validateRequirements({ pairs: [{ ...req.pairs[0], minimumClearance: -1 }] }));
});

test("pair resolution rejects ambiguous, missing, identical and mesh operands before starting native work", async () => {
  const nativeBody = { node: { t: "prim" }, m: [] }, geometry = { nativeBody };
  const geometries = new Map([["base", geometry], ["lid", geometry], ["mesh", { nativeBody: { node: { t: "mesh" } } }]]);
  let calls = 0;
  const kernel = { inspectPairs: async () => { calls++; return [{ id: "fit", ...measured }]; } };
  const good = await inspectNativePairs(req.pairs, geometries, {}, kernel);
  assert.equal(good[0].status, "measured");
  assert.equal(good[0].error, undefined);
  for (const [a, b] of [["missing", "lid"], ["base", "base"], ["base", "mesh"], ["copies", "lid"]]) {
    const [result] = await inspectNativePairs([{ id: "x", a, b }], geometries, { copies: ["base", "lid"] }, kernel);
    assert.equal(result.status, "unknown");
    assert.equal(result.overlapVolumeMm3, null);
  }
  assert.equal(calls, 1);
  assert.equal((await inspectNativePairs(req.pairs, geometries, {}, { inspectPairs: async () => [] }))[0].status, "unknown");
  assert.equal((await inspectNativePairs(req.pairs, geometries, {}, { inspectPairs: async () => [{ id: "fit", status: "measured", overlapVolumeMm3: NaN }] }))[0].status, "unknown");
});

test("failed native intersection and distance queries throw rather than returning a successful zero", () => {
  const wrap = (name) => ({ name, delete() {} });
  let failDistance = false, failIntersection = true, invalidSolid = false, faceCount = 1, volumeCalls = 0;
  class Explorer {
    constructor(parent, kind) { this.parent = parent; this.kind = kind; this.at = 0; }
    More() { return this.kind === "solid" ? this.at === 0 : this.kind === "face" && this.at < faceCount; }
    Current() { return wrap("solid"); }
    Next() { this.at++; }
    delete() {}
  }
  const OC = {
    TopAbs_ShapeEnum: { TopAbs_SOLID: "solid", TopAbs_FACE: "face", TopAbs_SHAPE: "shape" },
    TopExp_Explorer: Explorer, TopoDS: { Solid: (x) => x },
    BRepCheck_Analyzer: class { IsValid() { return !invalidSolid; } delete() {} },
    BRepExtrema_DistShapeShape: class {
      LoadS1() {} LoadS2() {} Perform() {} IsDone() { return !failDistance; } NbSolution() { return 1; } Value() { return 0; }
      PointOnShape1() { return { X: () => 0, Y: () => 0, Z: () => 0, delete() {} }; }
      PointOnShape2() { return this.PointOnShape1(); } delete() {}
    },
    gp_Trsf: class { delete() {} },
    BRepBuilderAPI_Transform: class { IsDone() { return true; } Shape() { return wrap("copy"); } delete() {} },
    BRepAlgoAPI_Common: class { IsDone() { return !failIntersection; } Shape() { throw new Error("should not use failed result"); } delete() {} },
  };
  const R = { cast: (wrapped) => ({ wrapped, delete() {} }), measureVolume: () => { volumeCalls++; return 1; } };
  const shape = { wrapped: wrap("input") };
  assert.throws(() => measureSolidPair(shape, shape, OC, R), /Intersection query did not complete/);
  assert.equal(volumeCalls, 2);
  invalidSolid = true;
  assert.throws(() => measureSolidPair(shape, shape, OC, R), /failed native solid validation/);
  invalidSolid = false; faceCount = 2001;
  assert.throws(() => measureSolidPair(shape, shape, OC, R), /2000-face inspection limit/);
  faceCount = 1; failDistance = true;
  assert.throws(() => measureSolidPair(shape, shape, OC, R), /Closest-point query did not complete/);
});

test("native query timeout terminates only the analysis worker and keeps build state usable", async (t) => {
  const oldWorker = globalThis.Worker;
  t.after(() => { if (oldWorker === undefined) delete globalThis.Worker; else globalThis.Worker = oldWorker; });
  const created = [];
  globalThis.Worker = class {
    constructor() { created.push(this); this.stopped = false; }
    postMessage(message) { if (message.type === "init") queueMicrotask(() => this.onmessage({ data: { type: "ready" } })); }
    terminate() { this.stopped = true; }
  };
  const kernel = new KernelClient({ parts: [], workerUrl: "test-worker.js" });
  const editorWorker = { terminate: () => assert.fail("editor worker must survive analysis timeout") };
  kernel.worker = editorWorker;
  kernel.ready = true;
  kernel.meshes.set("existing", { ok: true });
  const result = await kernel.inspectPairs([{ id: "timeout", a: {}, b: {} }], { timeoutMs: 5 });
  assert.equal(result[0].status, "unknown");
  assert.match(result[0].error, /timed out/);
  assert.equal(result[0].overlapVolumeMm3, null);
  assert.equal(created[0].stopped, true);
  assert.equal(kernel.worker, editorWorker);
  assert.equal(kernel.ready, true);
  assert.deepEqual(kernel.meshes.get("existing"), { ok: true });
});
