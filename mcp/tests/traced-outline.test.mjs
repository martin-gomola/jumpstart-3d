import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOutline, outlinePocket } from "../shared/traced-outline.js";
import { normalizePocket } from "../browser/plans/pockets.js";
import { listManagedImports, resolveManagedImports, OUTLINE_FORMATS } from "../server/imports.mjs";

// The shape of Tracefinity's /files/tools/{id}/tool.svg: one outer polygon, then inner rings, in mm.
const circle = (r, n, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
const polygon = points => `<polygon points="${points.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(" ")}" fill="black" stroke="none"/>`;
const tracefinitySvg = (rings, width = "60mm") => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="60mm" viewBox="-30 -30 60 60">\n  ${rings.map(polygon).join("\n  ")}\n</svg>\n`;

test("a Tracefinity tool SVG becomes a pocket contour within its reported deviation", () => {
  const trace = circle(25, 400, 3, -2);
  const outline = parseOutline(tracefinitySvg([trace, circle(5, 40, 3, -2)]), "pliers.svg");
  assert.equal(outline.name, "pliers");
  assert.equal(outline.holes.length, 1);
  const pocket = outlinePocket(outline);
  const count = pocket.profile.segments.length;
  assert.ok(count <= 64 && count >= 48, `${count} segments`);
  assert.ok(Math.abs(pocket.width - 50) < 0.01 && Math.abs(pocket.depth - 50) < 0.01);
  assert.ok(pocket.deviation > 0 && pocket.deviation < 0.2, `deviation ${pocket.deviation}`);
  assert.ok(pocket.minimumClearance >= pocket.deviation);
  assert.equal(pocket.innerOutlinesIgnored, 1);
  const centre = pocket.profile.segments.reduce((sum, s) => [sum[0] + s.start[0], sum[1] + s.start[1]], [0, 0]).map(v => v / count);
  assert.ok(Math.hypot(...centre) < 0.5, "contour is centred on the outline");
  normalizePocket({ id: "tool", type: "pocket", target: "insert", profile: pocket.profile, depth: 10, clearance: 1, minimumFloor: 1, minimumWall: 1 });
});

test("SVG y is flipped, physical units are honoured, and curves or missing units are rejected", () => {
  const triangle = [[0, 0], [20, 0], [0, -10]];
  const mm = parseOutline(tracefinitySvg([triangle]));
  assert.deepEqual(mm.outer.map(([x, y]) => [x + 0, y + 0]), [[0, 0], [20, 0], [0, 10]]);
  const inch = parseOutline(tracefinitySvg([triangle], "2.3622in"));
  assert.ok(Math.abs(inch.outer[1][0] - 20) < 0.001);
  assert.throws(() => parseOutline('<svg width="60" height="60" viewBox="0 0 60 60"><polygon points="0,0 1,0 0,1"/></svg>'), /width in mm, cm or in/);
  assert.throws(() => parseOutline('<svg width="60mm" height="60mm" viewBox="0 0 60 60"><path d="M0 0 C 1 1 2 2 3 0 Z"/></svg>'), /curves are not supported/);
  assert.throws(() => parseOutline(tracefinitySvg([triangle, circle(3, 12, 50, 50)])), /separate outlines/);
  const path = parseOutline('<svg width="10mm" height="10mm" viewBox="0 0 10 10"><path d="M0 0 h 10 v 10 H 0 z"/></svg>');
  assert.equal(path.outer.length, 4);
});

test("tool JSON keeps finger holes as pocket profiles relative to the outline centre", () => {
  const tool = { name: "Screwdriver", points: [{ x: -80, y: -10 }, { x: 80, y: -10 }, { x: 80, y: 10 }, { x: -80, y: 10 }],
    finger_holes: [{ id: "f", x: 20, y: 10, radius: 12, shape: "circle" }, { id: "g", x: -40, y: 0, radius: 8, width: 30, height: 16, rotation: 90, shape: "filleted_rectangle" }] };
  const pocket = outlinePocket(parseOutline(JSON.stringify({ tool })));
  assert.equal(pocket.name, "Screwdriver");
  assert.equal(pocket.deviation, 0);
  assert.deepEqual(pocket.fingerHoles[0], { profile: { type: "circle", radius: 12 }, position: [20, -10], rotation: 0 });
  assert.deepEqual(pocket.fingerHoles[1], { profile: { type: "roundedRect", width: 30, height: 16, radius: 4 }, position: [-40, 0], rotation: -90 });
  assert.throws(() => outlinePocket(parseOutline(JSON.stringify(tool)), { maxSegments: 4 }), /maxSegments/);
});

test("outline files are listed as imports but only resolve for the outline reader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jumpstart-outlines-"));
  await writeFile(join(directory, "wrench.svg"), tracefinitySvg([circle(20, 30)]));
  const [asset] = (await listManagedImports(directory)).assets;
  assert.equal(asset.format, "svg");
  await assert.rejects(resolveManagedImports(directory, [asset.assetId]), /tool outline; read it with jumpstart_get_outline/);
  const [resolved] = await resolveManagedImports(directory, [asset.assetId], OUTLINE_FORMATS);
  assert.equal(parseOutline(Buffer.from(resolved.base64, "base64").toString("utf8"), resolved.name).name, "wrench");
});
