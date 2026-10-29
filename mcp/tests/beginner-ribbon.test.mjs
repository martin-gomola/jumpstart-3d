import test from "node:test";
import assert from "node:assert/strict";
import { BEGINNER_SECTIONS, foldedSections } from "../../src/beginner-ribbon-layout.js";

const widths = Object.fromEntries(BEGINNER_SECTIONS.map((s) => [s.id, 200]));

test("beginner ribbon folds the fewest sections, workshops and parts first, and never folds edit or combine", () => {
  assert.deepEqual([...foldedSections(BEGINNER_SECTIONS, widths, {}, 1600, 70)], []);
  assert.deepEqual([...foldedSections(BEGINNER_SECTIONS, widths, {}, 1500, 70)], ["workshops"]);
  assert.deepEqual([...foldedSections(BEGINNER_SECTIONS, widths, {}, 1350, 70)], ["workshops", "parts"]);
  assert.deepEqual([...foldedSections(BEGINNER_SECTIONS, widths, {}, 0, 70)].sort(), ["arrange", "check", "create", "modify", "parts", "workshops"]);
});

test("beginner ribbon reopens small sections when a larger fold made room", () => {
  const sized = { edit: 205, create: 213, parts: 300, combine: 200, arrange: 239, modify: 230, check: 150, workshops: 115 };
  assert.deepEqual([...foldedSections(BEGINNER_SECTIONS, sized, { workshops: 72, parts: 60, check: 57, modify: 57 }, 1200)], ["workshops", "parts", "modify"]);
});

test("every beginner tool appears in exactly one section", () => {
  const tools = BEGINNER_SECTIONS.flatMap((s) => s.tools);
  assert.equal(new Set(tools).size, tools.length);
  assert.equal(tools.length, 33);
});
