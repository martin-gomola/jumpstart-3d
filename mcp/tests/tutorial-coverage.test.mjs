import test from "node:test";
import assert from "node:assert/strict";
import { tutorialCoverage } from "../benchmarks/coverage.mjs";

test("MCP tutorial coverage matches the author source baseline", () => {
  const coverage = tutorialCoverage();
  assert.equal(coverage.total, 18);
  assert.equal(coverage.implemented, 18);
  assert.deepEqual(coverage.missing.map(({ id }) => id), []);
  assert.deepEqual(coverage.obsolete, ["a-params"]);
});
