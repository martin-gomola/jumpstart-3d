import { matrixForTransform } from "../plan-geometry.js";
import { normalizeGridfinity, buildGridfinity } from "../gridfinity.js";

export const advanced = true;

export function normalize(operation, label) {
  return normalizeGridfinity(operation, label);
}

export function build(operation, ctx) {
  const { doc, idFactory, addBody, remember } = ctx;
  const built = buildGridfinity(operation, { document: doc, idFactory, nextSeq: () => ++doc.seq });
  const body = addBody(operation.name, built.node, matrixForTransform(operation.position, operation.rotation));
  body.mcpGridfinity = built.recipe;
  remember(operation.id, [body]);
}
