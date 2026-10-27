import { MCP_PLAN_LIMITS, fail, object, strictObject, text, number, triple } from "../plan-input.js";

function normalizeEdgeSignatures(edges, label) {
  if (!Array.isArray(edges) || !edges.length || edges.length > 512) fail(`${label} must contain 1 to 512 edge signatures`);
  return edges.map((edge, i) => {
    strictObject(edge, `${label}[${i}]`, ["index", "a", "b", "m", "n", "t"]);
    return {
      ...(edge.a === undefined ? {} : { a: triple(edge.a, `${label}[${i}].a`) }),
      ...(edge.b === undefined ? {} : { b: triple(edge.b, `${label}[${i}].b`) }),
      m: triple(edge.m, `${label}[${i}].m`),
      n: triple(edge.n, `${label}[${i}].n`),
      t: text(edge.t, `${label}[${i}].t`),
    };
  });
}

function normalizeModifier(raw, label) {
  const mod = object(raw, label);
  const type = text(mod.type, `${label}.type`);
  if (type === "fillet") {
    strictObject(mod, label, ["type", "radius", "edges", "chain"]);
    return { type, radius: number(mod.radius, `${label}.radius`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), edges: normalizeEdgeSignatures(mod.edges, `${label}.edges`), chain: mod.chain !== false };
  }
  if (type === "chamfer") {
    strictObject(mod, label, ["type", "distance", "edges", "chain"]);
    return { type, distance: number(mod.distance, `${label}.distance`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), edges: normalizeEdgeSignatures(mod.edges, `${label}.edges`), chain: mod.chain !== false };
  }
  if (type === "offset") {
    strictObject(mod, label, ["type", "distance", "faces"]);
    if (!Array.isArray(mod.faces) || !mod.faces.length || mod.faces.length > 256) fail(`${label}.faces must contain 1 to 256 face signatures`);
    const faces = mod.faces.map((face, i) => {
      const faceLabel = `${label}.faces[${i}]`;
      strictObject(face, faceLabel, ["c", "n", "t"]);
      const t = text(face.t, `${faceLabel}.t`);
      if (!["PLANE", "CYLINDRE", "SPHERE"].includes(t)) fail(`${faceLabel}.t must be PLANE, CYLINDRE, or SPHERE`);
      if (face.n !== undefined && t !== "PLANE") fail(`${faceLabel}.n is only supported for planar faces`);
      const signature = { c: triple(face.c, `${faceLabel}.c`), t };
      if (face.n !== undefined) {
        const n = triple(face.n, `${faceLabel}.n`);
        if (Math.hypot(...n) < 1e-9) fail(`${faceLabel}.n must not be zero`);
        signature.n = n;
      }
      return signature;
    });
    const distance = number(mod.distance, `${label}.distance`, { min: -MCP_PLAN_LIMITS.coordinate, max: MCP_PLAN_LIMITS.coordinate });
    if (distance === 0) fail(`${label}.distance must not be zero`);
    return { type, distance, faces };
  }
  if (type === "shell") {
    strictObject(mod, label, ["type", "thickness", "faces", "direction"]);
    if (mod.direction !== undefined && !["in", "out", "both"].includes(mod.direction)) fail(`${label}.direction must be in, out, or both`);
    if (!Array.isArray(mod.faces) || mod.faces.length > 256) fail(`${label}.faces must be an array of at most 256 face centers`);
    return { type, thickness: number(mod.thickness, `${label}.thickness`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }), faces: mod.faces.map((face, i) => ({ c: triple(strictObject(face, `${label}.faces[${i}]`, ["index", "c", "n", "t", "r", "ext", "o", "d", "ax"]).c, `${label}.faces[${i}].c`) })), direction: mod.direction ?? "in" };
  }
  if (type === "hole") {
    strictObject(mod, label, ["type", "at", "kind", "diameter", "through", "depth", "counterboreDiameter", "counterboreDepth", "countersinkDiameter", "countersinkAngle", "tip", "pitch", "clearance"]);
    if (!Array.isArray(mod.at) || !mod.at.length || mod.at.length > 64) fail(`${label}.at must contain 1 to 64 positions`);
    const kind = text(mod.kind, `${label}.kind`, "simple");
    if (!["simple", "cbore", "csink", "tapped"].includes(kind)) fail(`${label}.kind must be simple, cbore, csink, or tapped`);
    const through = mod.through !== false;
    return {
      type, kind: kind === "tapped" ? "simple" : kind,
      dia: number(mod.diameter, `${label}.diameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      through, depth: number(mod.depth ?? 10, `${label}.depth`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      cbDia: number(mod.counterboreDiameter ?? 8, `${label}.counterboreDiameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      cbDepth: number(mod.counterboreDepth ?? 3, `${label}.counterboreDepth`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      csDia: number(mod.countersinkDiameter ?? 9, `${label}.countersinkDiameter`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate }),
      csAngle: number(mod.countersinkAngle ?? 90, `${label}.countersinkAngle`, { min: 1, max: 179 }),
      tip: mod.tip === true, tapped: kind === "tapped",
      pitch: number(mod.pitch ?? 0.5, `${label}.pitch`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }),
      clear: number(mod.clearance ?? 0, `${label}.clearance`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }),
      at: mod.at.map((at, i) => {
        const point = strictObject(at, `${label}.at[${i}]`, ["p", "n"]);
        const n = triple(point.n, `${label}.at[${i}].n`);
        if (Math.hypot(...n) < 1e-9) fail(`${label}.at[${i}].n must not be zero`);
        return { p: triple(point.p, `${label}.at[${i}].p`), n };
      }),
    };
  }
  if (type === "thread") {
    strictObject(mod, label, ["type", "face", "pitch", "length", "flip", "left", "clearance"]);
    const face = strictObject(mod.face, `${label}.face`, ["index", "c", "t", "n", "r", "ext", "o", "d", "ax"]);
    if (face.t !== "CYLINDRE") fail(`${label}.face.t must be CYLINDRE`);
    return { type, face: { c: triple(face.c, `${label}.face.c`), t: "CYLINDRE" }, pitch: number(mod.pitch, `${label}.pitch`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }), length: number(mod.length ?? 0, `${label}.length`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }), flip: mod.flip === true, left: mod.left === true, clear: number(mod.clearance ?? 0, `${label}.clearance`, { min: 0, max: MCP_PLAN_LIMITS.coordinate }) };
  }
  if (type === "emboss") {
    strictObject(mod, label, ["type", "geo", "text", "font", "size", "depth", "mode", "angle"]);
    const geo = strictObject(mod.geo, `${label}.geo`, ["kind", "p", "n", "x"]);
    const kind = text(geo.kind, `${label}.geo.kind`);
    if (kind !== "plane") fail(`${label}.geo.kind must be plane for declarative embossing`);
    if (mod.mode !== undefined && !["emboss", "deboss"].includes(mod.mode)) fail(`${label}.mode must be emboss or deboss`);
    const n = triple(geo.n, `${label}.geo.n`), x = triple(geo.x, `${label}.geo.x`);
    if (Math.hypot(...n) < 1e-9 || Math.hypot(...x) < 1e-9) fail(`${label}.geo.n and geo.x must not be zero`);
    return { type, geo: { kind, p: triple(geo.p, `${label}.geo.p`), n, x }, text: text(mod.text, `${label}.text`), font: text(mod.font, `${label}.font`, "sans"), size: number(mod.size, `${label}.size`, { min: 0.5, max: MCP_PLAN_LIMITS.coordinate }), depth: number(mod.depth, `${label}.depth`, { min: 0.05, max: MCP_PLAN_LIMITS.coordinate }), mode: mod.mode ?? "emboss", angle: number(mod.angle ?? 0, `${label}.angle`, { min: -360, max: 360 }) };
  }
  if (type === "scale") {
    strictObject(mod, label, ["type", "factors", "offset"]);
    return { type, factors: triple(mod.factors, `${label}.factors`).map((value, i) => number(value, `${label}.factors[${i}]`, { min: 0.001, max: MCP_PLAN_LIMITS.coordinate })), offset: triple(mod.offset ?? [0, 0, 0], `${label}.offset`) };
  }
  fail(`${label}.type must be fillet, chamfer, offset, shell, hole, thread, emboss, or scale`);
}

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "target", "modifier"]);
  return { type, id, target: text(operation.target, `${label}.target`), modifier: normalizeModifier(operation.modifier, `${label}.modifier`) };
}

export function build(operation, ctx) {
  const { doc, idFactory, bodyList, remember, affectedBodyIds, featureMods } = ctx;
  const targets = bodyList(operation.target);
  const { type, ...properties } = operation.modifier;
  for (const body of targets) {
    body.node.mods = body.node.mods || [];
    const mod = { id: idFactory("f"), seq: ++doc.seq, t: type };
    if (type === "fillet") Object.assign(mod, { r: properties.radius, edges: properties.edges, chain: properties.chain });
    else if (type === "chamfer") Object.assign(mod, { d: properties.distance, edges: properties.edges, chain: properties.chain });
    else if (type === "offset") Object.assign(mod, { d: properties.distance, faces: properties.faces });
    else if (type === "shell") Object.assign(mod, { th: properties.thickness, faces: properties.faces, ...(properties.direction === "in" ? {} : { dir: properties.direction }) });
    else if (type === "hole") Object.assign(mod, { dia: properties.dia, kind: properties.kind, through: properties.through, depth: properties.depth, cbDia: properties.cbDia, cbDepth: properties.cbDepth, csDia: properties.csDia, csAngle: properties.csAngle, tip: properties.tip, tapped: properties.tapped, pitch: properties.pitch, clear: properties.clear, at: properties.at });
    else if (type === "thread") Object.assign(mod, { face: properties.face, pitch: properties.pitch, length: properties.length, flip: properties.flip, left: properties.left, clear: properties.clear });
    else if (type === "emboss") Object.assign(mod, { ...properties.geo, str: properties.text, font: properties.font, size: properties.size, depth: properties.depth, mode: properties.mode, angle: properties.angle, along: false, mirror: false, reverse: false });
    else if (type === "scale") Object.assign(mod, { k: properties.factors, o: properties.offset });
    body.node.mods.push(mod);
    const refs = featureMods.get(operation.id) || [];
    refs.push({ bodyId: body.id, featureId: mod.id });
    featureMods.set(operation.id, refs);
    affectedBodyIds.add(body.id);
  }
  remember(operation.id, targets);
}
