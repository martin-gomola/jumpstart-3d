import test from "node:test";
import assert from "node:assert/strict";
import { createNativeParametricModel, reviseNativeParameters } from "../browser/native-parameters.js";

const fresh = () => ({seq: 0, bodies: [], sketches: [], params: []});
const plan = () => ({name: "Bracket", parameters: [{name: "w", expression: "60"}, {name: "h", expression: "w/2"}, {name: "t", expression: "8"}], rectangle: {id: "rectangle", widthExpression: "w", heightExpression: "h"}, extrude: {id: "bracket", distanceExpression: "t"}});

test("native bracket retains real dimension and feature bindings through revision", () => {
  const original = fresh();
  const compiled = createNativeParametricModel(original, plan());
  assert.deepEqual(original, fresh());
  assert.deepEqual(compiled.document.params.map(p => p.value), [60, 30, 8]);
  const dims = compiled.document.sketches[0].cons.filter(c => c.t === "dim");
  assert.deepEqual(dims.map(c => c.expr), ["w", "h"]);
  assert.ok(dims.every(c => /^d\d+$/.test(c.name)));
  assert.equal(compiled.document.bodies[0].node.exprs.dist, "t");
  const revised = reviseNativeParameters(compiled.document, {values: {w: 80, t: "10"}});
  assert.deepEqual(revised.document.params.map(p => p.value), [80, 40, 10]);
  assert.ok(Math.abs(revised.document.sketches[0].pts[2].x - 80) < 0.001);
  assert.ok(Math.abs(revised.document.sketches[0].pts[2].y - 40) < 0.001);
  assert.equal(revised.document.bodies[0].node.dist, 10);
  assert.deepEqual(revised.affectedBodyIds, compiled.createdBodyIds);
  assert.equal(compiled.document.params[0].value, 60);
  const smaller = reviseNativeParameters(compiled.document, {values: {w: 10}}).document;
  assert.ok(Math.abs(smaller.bodies[0].node.profiles[0].pt[0] - 5) < 0.001);
  assert.ok(Math.abs(smaller.bodies[0].node.profiles[0].pt[1] - 2.5) < 0.001);
});

test("native parameters reject invalid expressions, bounds and unknown payload keys", () => {
  for (const expression of ["unknown", "1/0", "20000", "w+1", "globalThis.alert()"] ) {
    const input = plan(); input.parameters[0].expression = expression;
    assert.throws(() => createNativeParametricModel(fresh(), input));
  }
  const invalid = plan(); invalid.rectangle.widthExpression = "-1";
  assert.throws(() => createNativeParametricModel(fresh(), invalid));
  assert.throws(() => createNativeParametricModel(fresh(), {...plan(), arbitrary: true}), /not supported/);
  const duplicate = plan(); duplicate.parameters.push({name: "W", expression: "5"});
  assert.throws(() => createNativeParametricModel(fresh(), duplicate), /already/);
  const reserved = plan(); reserved.parameters[0].name = "d1";
  assert.throws(() => createNativeParametricModel(fresh(), reserved), /dimension name/);
});

test("native revision failure is isolated and stale MCP model metadata is rejected", () => {
  const doc = createNativeParametricModel(fresh(), plan()).document;
  const saved = structuredClone(doc);
  for (const values of [{w: "missing"}, {w: -1}, {w: 20000}, {unknown: 4}, {t: 0}, {h: "h+1"}]) assert.throws(() => reviseNativeParameters(doc, {values}));
  assert.deepEqual(doc, saved);
  assert.throws(() => reviseNativeParameters({...doc, mcpModels: {old: {}}}, {values: {w: 80}}), /metadata/);
});


test("native plans provide editor metadata and creation is limited to an empty native geometry document", () => {
  const compiled = createNativeParametricModel(fresh(), plan());
  assert.equal(compiled.plan.name, "Bracket");
  assert.equal(compiled.plan.mode, "advanced");
  assert.equal(compiled.document.mode, "advanced");
  const revised = reviseNativeParameters(compiled.document, {values: {w: 80}});
  assert.equal(revised.plan.name, "Bracket");
  assert.equal(revised.plan.mode, "advanced");
  assert.throws(() => createNativeParametricModel(compiled.document, plan()), /no bodies or sketches/);
});

test("native parameter changes cannot mutate a locked body or its sketch", () => {
  const doc = createNativeParametricModel(fresh(), plan()).document;
  doc.bodies[0].locked = true;
  const before = structuredClone(doc);
  assert.throws(() => reviseNativeParameters(doc, {values: {t: 10}}), /locked body/);
  assert.throws(() => reviseNativeParameters(doc, {values: {w: 80}}), /locked body/);
  assert.deepEqual(doc, before);
});

test("native revision accepts an existing document at body capacity", () => {
  const doc = createNativeParametricModel(fresh(), plan()).document;
  const body = doc.bodies[0];
  for (let i = 1; i < 128; i++) doc.bodies.push({...structuredClone(body), id: `existing${i}`});
  assert.equal(reviseNativeParameters(doc, {values: {w: 80}}).document.bodies.length, 128);
});
