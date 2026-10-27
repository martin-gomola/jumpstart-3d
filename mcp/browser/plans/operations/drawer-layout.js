import { normalizeDrawerLayout } from "../../../shared/drawer-layout.js";
import { matrixForTransform } from "../plan-geometry.js";
import { buildDrawerLayout } from "../drawer-layout.js";

export const advanced = true;

export function normalize(operation) {
  return normalizeDrawerLayout(operation);
}

export function build(operation, ctx) {
  const { doc, idFactory, addBody, remember, affectedBodyIds } = ctx;
  const result = buildDrawerLayout(operation, { document: doc, addBody, idFactory, nextSeq: () => ++doc.seq, matrixForTransform });
  for (const id of result.removedBodyIds) affectedBodyIds.add(id);
  remember(operation.id, result.bodies);
}
