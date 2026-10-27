import test from "node:test";
import assert from "node:assert/strict";
import { partEnvelope, partPrintFit, usableDepthError } from "../shared/gridfinity-envelope.js";
import { magnetCarrierHeight } from "../shared/gridfinity-magnets.js";

const bin = changes => ({ kind: "bin", columns: 2, rows: 3, heightUnits: 3, floor: 2, lip: false, openSides: [], closeGaps: false, dividers: { x: 0, y: 0 }, magnets: false, ...changes });

test("part envelopes measure bins, inserts and baseplates", () => {
  assert.deepEqual(partEnvelope(bin()), { width: 83.5, depth: 125.5, height: 21 });
  assert.deepEqual(partEnvelope(bin({ kind: "insert", columns: 1, rows: 1, heightUnits: 4 })), { width: 41.5, depth: 41.5, height: 28 });
  assert.deepEqual(partEnvelope({ kind: "baseplate", columns: 4, rows: 2, magnets: false }), { width: 168, depth: 84, height: 5 });
});

test("a stacking lip adds 4.4 mm to a bin", () => {
  assert.equal(partEnvelope(bin({ lip: true })).height, 25.4);
});

test("four open sides leave the floor, or full-height dividers", () => {
  const open = ["front", "back", "left", "right"];
  assert.equal(partEnvelope(bin({ openSides: open })).height, 9);
  assert.equal(partEnvelope(bin({ openSides: open, dividers: { x: 1, y: 0 } })).height, 20.99);
});

test("closed gaps widen a bin towards its open sides", () => {
  assert.deepEqual(partEnvelope(bin({ columns: 1, rows: 1, openSides: ["left", "right"], closeGaps: true })), { width: 42, depth: 41.5, height: 21 });
});

test("a magnetic baseplate adds its carrier height", () => {
  assert.ok(magnetCarrierHeight(true) > 0);
  assert.equal(partEnvelope({ kind: "baseplate", columns: 1, rows: 1, magnets: true }).height, 5 + magnetCarrierHeight(true));
});

test("print fit turns a part that only fits rotated and rejects oversize parts", () => {
  const area = { width: 100, depth: 200, height: 100, edgeMargin: 0 };
  assert.equal(partPrintFit(bin({ columns: 4, rows: 1 }), area, "Long bin").rotation, 90);
  assert.equal(partPrintFit(bin({ columns: 1, rows: 1 }), area, "Small bin").rotation, 0);
  assert.throws(() => partPrintFit(bin({ columns: 5, rows: 5 }), area, "Huge bin"), /Huge bin .*exceeds the usable printer area/);
});

test("bins need at least 1 mm of usable depth above the floor", () => {
  assert.equal(usableDepthError(bin({ heightUnits: 2, floor: 6 }), "Bin"), null);
  assert.equal(usableDepthError(bin({ heightUnits: 2, floor: 6.5 }), "Bin"), "Bin: floor leaves less than 1 mm of usable bin depth");
  assert.equal(usableDepthError(bin({ kind: "insert", heightUnits: 2, floor: 6.5 }), "Insert"), null);
});
