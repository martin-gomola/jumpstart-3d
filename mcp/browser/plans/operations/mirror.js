import { clone } from "../../../../src/util.js";
import { MCP_PLAN_LIMITS, fail, strictObject, text, triple } from "../plan-input.js";
import { IDENTITY, matrixInverse } from "../plan-geometry.js";

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "source", "plane", "behavior"]);
  const plane = strictObject(operation.plane, `${label}.plane`, ["origin", "normal"]);
  const normal = triple(plane.normal, `${label}.plane.normal`);
  const length = Math.hypot(...normal);
  if (length < 1e-12) fail(`${label}.plane.normal must not be zero`);
  const behavior = text(operation.behavior, `${label}.behavior`, "linked");
  if (!["linked", "join"].includes(behavior)) fail(`${label}.behavior must be linked or join`);
  return { type, id, source: text(operation.source, `${label}.source`), plane: { o: triple(plane.origin ?? [0, 0, 0], `${label}.plane.origin`), n: normal.map((value) => value / length) }, behavior };
}

export function build(operation, ctx) {
  const { doc, idFactory, addBody, bodyList, remember, affectedBodyIds } = ctx;
  const sources = bodyList(operation.source);
  for (const source of sources) {
    if (source.locked) fail(`Unlock body ${operation.source} before mirroring it`);
    if (!source.node || typeof source.node !== "object" || source.node.t === "mirror") fail(`Mirror ${operation.id} requires an editable body that is not itself a linked mirror`);
  }
  if (operation.behavior === "linked") {
    if (doc.bodies.length + sources.length > MCP_PLAN_LIMITS.bodies) fail(`Mirror ${operation.id} would exceed ${MCP_PLAN_LIMITS.bodies} document bodies`);
    const mirrors = sources.map((source) => {
      const mirror = addBody(`${source.name || "Body"} (mirror)`.slice(0, 80), { t: "mirror", srcBody: source.id, plane: clone(operation.plane), mods: [] }, IDENTITY.slice(), !!source.hole);
      if (source.color !== undefined) mirror.color = source.color;
      if (source.role !== undefined) mirror.role = source.role;
      return mirror;
    });
    remember(operation.id, mirrors);
  } else {
    for (const source of sources) {
      source.node.mods = source.node.mods || [];
      source.node.mods.push({ id: idFactory("f"), seq: ++doc.seq, t: "bool", op: "join", tool: { t: "mirror", src: clone(source.node), srcM: source.m.slice(), plane: clone(operation.plane), mods: [] }, m: matrixInverse(source.m) });
      affectedBodyIds.add(source.id);
    }
    remember(operation.id, sources);
  }
}
