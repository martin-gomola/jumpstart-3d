// Prepared native plans exercise MCP execution; they do not measure fresh agent reasoning.
export const NATIVE_TUTORIAL_CASES = [
  {
    id: "b-top",
    prompt: "Use the native Lathe to turn a 40 mm square, 70 mm long blank into a spinning top. Leave a 15 mm long, 8 mm diameter handle, a broad weighted middle and a blunt point. Save and export an STL.",
    tool: "jumpstart_preview_lathe",
    plan: { name: "Agent, Benchmark, Spinning Top", blank: { kind: "square", side: 40, length: 70 }, profile: [[0, 4], [15, 4], [20, 18], [40, 18], [55, 10], [70, 2]] },
  },
  {
    id: "a-cup",
    prompt: "Use the native Lathe to turn a 60 mm diameter, 90 mm long round blank into a tapered cup, 44 mm across at its base and 60 mm at its rim. Add a decorative V groove, hollow from the tail end with 3 mm walls and a 6 mm base, export 3MF, then scale uniformly by 1.1, save and export STL.",
    tool: "jumpstart_preview_lathe",
    plan: { name: "Agent, Benchmark, Turned Cup", blank: { kind: "round", diameter: 60, length: 90 }, profile: [[0, 22], [50, 26.45], [56, 27], [60, 23.3], [64, 27.7], [90, 30]], hollow: { wall: 3, base: 6, end: "tail", style: "follow" } },
    revisedScale: 1.1,
  },
  {
    id: "a-params",
    prompt: "Create a native parametric bracket: an origin-anchored XY rectangle dimensioned by parameters w=60 mm and h=w/2, extruded by t=8 mm. Verify 60 by 30 by 8 mm, then change only w to 80 and verify h follows to 40 while thickness stays 8. Preserve native parameter bindings, save and export STL.",
    tool: "jumpstart_preview_native_model",
    plan: { name: "Agent, Benchmark, Bracket", parameters: [{ name: "w", expression: "60" }, { name: "h", expression: "w/2" }, { name: "t", expression: "8" }], rectangle: { id: "plate-sketch", widthExpression: "w", heightExpression: "h", plane: "XY", origin: [0, 0, 0] }, extrude: { id: "plate", distanceExpression: "t" } },
  },
];

function requireValue(condition, message) { if (!condition) throw new Error(message); }
function near(actual, expected, tolerance = 0.05) { return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance; }

export function validateNativeBracket(document, width) {
  const parameters = new Map(document.nativeParameters.map(parameter => [parameter.name, parameter]));
  requireValue(near(parameters.get("w")?.value, width), "Native w parameter has the wrong value");
  requireValue(near(parameters.get("h")?.value, width / 2), "Native derived h parameter did not follow w");
  requireValue(parameters.get("h")?.expression === "w/2", "Native h expression was lost");
  const constraints = document.sketches.flatMap(sketch => sketch.constraints || []);
  requireValue(["w", "h"].every(expression => constraints.some(constraint => constraint.t === "dim" && constraint.expr === expression)), "Native sketch dimension bindings are missing");
  const body = document.bodies[0];
  requireValue(body?.featureTree?.exprs?.dist === "t", "Native extrude thickness expression was lost");
  requireValue(near(body.dimensions.x, width) && near(body.dimensions.y, width / 2) && near(body.dimensions.z, 8), "Generated bracket dimensions do not match its parameters");
}

async function inspectTurnedGeometry(scenario, body, revision, tool) {
  const axes = ["X", "Y", "Z"], dimensions = [body.dimensions.x, body.dimensions.y, body.dimensions.z];
  const scale = scenario.revisedScale || 1, length = scenario.plan.blank.length * scale;
  const axial = dimensions.findIndex(value => near(value, length, 0.15));
  requireValue(axial >= 0, "Lathe axial length does not match the requested blank and scale");
  const radial = (axial + 1) % 3;
  const fractions = scenario.id === "b-top" ? [0.1, 0.5, 0.96] : [0.08, 0.92, 60 / 90, 55 / 90, 65 / 90];
  const samples = fractions.map(fraction => {
    const point = body.bounds.center.slice();
    point[axial] = body.bounds.min[axial] + fraction * length;
    // Stay away from mesh vertices and the cavity's axial seam.
    point[(radial + 1) % 3 === axial ? (radial + 2) % 3 : (radial + 1) % 3] += 0.013;
    return { axis: axes[radial], point };
  });
  const measured = await tool("jumpstart_inspect_geometry", { bodyId: body.id, expectedRevision: revision, mesh: false, samples });
  const rows = measured.samples;
  requireValue(rows?.length === fractions.length && rows.every(row => !row.ambiguous && row.intervals.length), "Lathe cross-section samples are ambiguous or empty");
  const span = row => row.intervals.at(-1)[1] - row.intervals[0][0];
  if (scenario.id === "b-top") {
    requireValue(near(span(rows[0]), 8, 0.2), "Top handle is not 8 mm across");
    requireValue(span(rows[1]) > 32 && span(rows[2]) < span(rows[1]) * 0.45, "Top lacks a broad body and blunt narrow point");
  } else {
    requireValue(rows[1].intervals.length === 2, "Cup has no open central cavity near its rim");
    requireValue(span(rows[0]) < 50 * scale && span(rows[1]) > 54 * scale, "Cup does not taper from base to rim");
    requireValue(span(rows[2]) < (span(rows[3]) + span(rows[4])) / 2 - 3 * scale, "Cup decorative groove is missing in generated geometry");
    for (const interval of rows[1].intervals) requireValue(near(interval[1] - interval[0], 3 * scale, 0.3), "Cup generated wall thickness does not match the scaled 3 mm wall");
    const bottomPoint = body.bounds.center.slice(); bottomPoint[radial] += 0.123;
    const bottom = await tool("jumpstart_inspect_geometry", { bodyId: body.id, expectedRevision: revision, mesh: false, samples: [{ axis: axes[axial], point: bottomPoint }] });
    const requestedBottom = scenario.plan.hollow.base * scale;
    const axialStep = body.latheSampling?.axialStepMm;
    requireValue(Number.isFinite(axialStep) && axialStep > 0, "Native Lathe axial sampling metadata is missing");
    const samplingTolerance = axialStep * scale + 0.01;
    const sample = bottom.samples[0];
    const measuredBottom = sample.intervals.length === 1 ? sample.intervals[0][1] - sample.intervals[0][0] : NaN;
    // The native cavity begins at the first axial slice at or beyond the requested
    // base. Its discrete mesh can therefore leave up to one extra axial slice.
    requireValue(!sample.ambiguous && measuredBottom >= requestedBottom - 0.01 && measuredBottom <= requestedBottom + samplingTolerance, "Cup generated bottom thickness exceeds the native axial sampling tolerance");
    measured.bottom = { ...sample, requestedThicknessMm: requestedBottom, measuredThicknessMm: measuredBottom, samplingToleranceMm: samplingTolerance, sourceAxialStepMm: axialStep };
  }
  return { axialAxis: axes[axial], samples: rows, ...(measured.bottom ? { bottom: measured.bottom } : {}) };
}

export async function runNativeTutorialCase(scenario, { tool, verifyStl, verify3mf }) {
  let edits = 0;
  const observations = [];
  const document = () => tool("jumpstart_get_document", { includeGeometry: true });
  const status = async stage => { const result = await tool("jumpstart_get_tutorial_status", {}); observations.push({ stage, ...result }); return result; };
  const commit = async (name, args) => {
    const before = await document();
    const proposed = await tool(name, { ...args, expectedRevision: before.revision, includeImage: true });
    requireValue(proposed.valid && proposed.previewId, `Native preview failed: ${JSON.stringify(proposed.errors)}`);
    requireValue(proposed.images?.length > 0 && !proposed.imageErrors?.length, "Native preview did not return complete viewport images");
    const applied = await tool("jumpstart_apply_model", { previewId: proposed.previewId });
    requireValue(applied.applied, "Native model was not applied"); edits++;
    return document();
  };
  try {
    const blank = await document();
    requireValue(!blank.bodies.length && !blank.sketches.length, "Native benchmark requires a fresh blank document");
    await tool("jumpstart_start_tutorial", { tutorialId: scenario.id, expectedRevision: blank.revision });
    let current = await commit(scenario.tool, { plan: scenario.plan });
    if (scenario.id === "a-params") validateNativeBracket(current, 60);
    await status("initial-model");
    let threeMf;
    if (scenario.id === "a-cup") {
      threeMf = await verify3mf(await tool("jumpstart_export_model", { format: "3mf", name: `tutorial-${scenario.id}` }));
      current = await commit(scenario.tool, { bodyId: current.bodies[0].id, plan: { ...scenario.plan, scale: scenario.revisedScale } });
    } else if (scenario.id === "a-params") {
      current = await commit("jumpstart_preview_native_parameters", { values: { w: 80 } });
      validateNativeBracket(current, 80);
    }
    const body = current.bodies[0];
    requireValue(current.bodies.length === 1 && !body.error && body.triangleCount > 0, "Native tutorial did not produce one valid body");
    const inspection = await tool("jumpstart_inspect_geometry", { bodyId: body.id, expectedRevision: current.revision, mesh: true });
    requireValue(inspection.meshValidation?.valid, `Generated native mesh failed validation: ${JSON.stringify(inspection.meshValidation)}`);
    const turnedGeometry = scenario.id === "a-params" ? undefined : await inspectTurnedGeometry(scenario, body, current.revision, tool);
    await status("revised-model");
    await tool("jumpstart_save_document", { expectedRevision: current.revision, versioned: true });
    const saved = await document();
    const reopened = await tool("jumpstart_reopen_document", { expectedRevision: saved.revision, documentId: saved.document.id });
    requireValue(reopened.reopened && (await document()).revision === saved.revision, "Native saved model did not reopen exactly");
    const stl = await verifyStl(await tool("jumpstart_export_model", { format: "stl", name: `tutorial-${scenario.id}` }));
    const final = await status("saved-and-exported");
    requireValue(final.tutorialId === scenario.id && final.complete === true && final.requiredChecksTotal > 0 && final.requiredChecksPassed === final.requiredChecksTotal, "Native tutorial did not report complete observed checks");
    const failed = final.steps.filter(step => step.passed === false);
    requireValue(!failed.length, `Native tutorial checks failed: ${failed.map(step => step.title).join(", ")}`);
    return { id: scenario.id, pass: true, source: "prepared native plan", savedAndReopened: true, nativeTutorialChecks: final.steps, observations, meshValidation: inspection.meshValidation, dimensions: body.dimensions, turnedGeometry, stl, ...(threeMf ? { threeMf } : {}) };
  } finally {
    while (edits-- > 0) { const current = await document(); await tool("jumpstart_undo", { expectedRevision: current.revision }); }
    const restored = await document();
    requireValue(!restored.bodies.length && !restored.sketches.length, "Native tutorial undo did not restore a blank document");
  }
}
