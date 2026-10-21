import { compileMcpModel } from './models.js';
import { validateToolInput } from '../shared/schema.js';
import { framePlanSchema } from '../server/frame-contracts.mjs';
import { inspectTriangleMesh, sampleSolidIntervals } from '../shared/geometry.js';

/** Compile a frame into existing primitives, boolean history and saved parameters. */
export function compileFramePlan(document, input) {
  validateToolInput(input, framePlanSchema);
  const { outerWidth, outerDepth, height, wall = 5 } = input;
  if (outerWidth - 2 * wall < 1 || outerDepth - 2 * wall < 1) throw new Error('Frame opening must be at least 1 mm in both directions');
  const dimensionSources = Object.fromEntries(['outerWidth', 'outerDepth', 'height', 'wall'].map(name => [name, { source: Object.hasOwn(input, name) ? 'supplied' : 'assumed', value: name === 'wall' ? wall : input[name], unit: 'mm' }]));
  const designContext = { preset: 'rectangular_frame', fit: 'unverified', dimensionSources, assumptions: [...(!Object.hasOwn(input, 'wall') ? ['Wall thickness defaults to 5 mm.'] : []), ...(input.assumptions || [])], limitations: ['Physical clearance and installation suitability have not been validated.'] };
  const parameter = (value, max) => ({ value, unit: 'mm', min: 0.1, max });
  const expr = value => ({ $expr: value });
  const template = {
    name: input.name || 'Rectangular spacer', ...(input.modelId ? { modelId: input.modelId } : {}),
    parameters: {
      outerWidth: parameter(outerWidth, 500), outerDepth: parameter(outerDepth, 500), height: parameter(height, 100), wall: parameter(wall, 249.5),
      openingWidth: { expression: 'outerWidth - 2 * wall', unit: 'mm', min: 1 }, openingDepth: { expression: 'outerDepth - 2 * wall', unit: 'mm', min: 1 },
    },
    primitives: [
      { id: 'outer', kind: 'box', parameters: { w: expr('outerWidth'), d: expr('outerDepth'), h: expr('height') } },
      { id: 'opening', kind: 'box', parameters: { w: expr('openingWidth'), d: expr('openingDepth'), h: expr('height + 2') }, position: [0, 0, -1] },
    ],
    operations: [{ id: 'frame', name: input.name || 'Rectangular spacer', type: 'group', operation: 'cut', members: ['outer', 'opening'] }],
  };
  const compiled = compileMcpModel(document, template);
  compiled.document.mcpModels.find(model => model.id === compiled.modelId).designContext = structuredClone(designContext);
  return { ...compiled, designContext };
}

/** Independent sampled checks of an axis-aligned, centred XY frame's generated mesh. */
export function inspectRectangularFrame(mesh, expected, tolerance = 0.01) {
  const report = inspectTriangleMesh(mesh);
  const { min, max, dimensions } = report.bounds;
  const center = min.map((v, i) => (v + max[i]) / 2);
  const x = sampleSolidIntervals(mesh, { axis: 'x', point: center });
  const y = sampleSolidIntervals(mesh, { axis: 'y', point: center });
  const z = sampleSolidIntervals(mesh, { axis: 'z', point: center });
  const opening = intervals => intervals.length === 2 ? intervals[1][0] - intervals[0][1] : null;
  const walls = intervals => intervals.map(([a, b]) => b - a);
  const measured = { outerWidth: dimensions[0], outerDepth: dimensions[1], height: dimensions[2], openingWidth: opening(x.intervals), openingDepth: opening(y.intervals), walls: [...walls(x.intervals), ...walls(y.intervals)], openCentre: !z.ambiguous && z.intervals.length === 0 };
  const checks = {
    dimensions: ['outerWidth', 'outerDepth', 'height'].every(name => Math.abs(measured[name] - expected[name]) <= tolerance),
    opening: measured.openingWidth !== null && measured.openingDepth !== null && Math.abs(measured.openingWidth - (expected.outerWidth - 2 * expected.wall)) <= tolerance && Math.abs(measured.openingDepth - (expected.outerDepth - 2 * expected.wall)) <= tolerance,
    walls: measured.walls.length === 4 && measured.walls.every(wall => Math.abs(wall - expected.wall) <= tolerance),
    openCentre: measured.openCentre, unambiguous: !x.ambiguous && !y.ambiguous && !z.ambiguous,
  };
  return { measured, checks, passed: Object.values(checks).every(Boolean), fit: 'unverified', limitations: ['Axis-aligned centreline samples do not certify the entire opening or physical fit.'] };
}
