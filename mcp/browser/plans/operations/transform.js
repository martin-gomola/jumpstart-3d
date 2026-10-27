import { fail, strictObject, text, triple } from "../plan-input.js";
import { matrixMultiply, matrixForTransform } from "../plan-geometry.js";

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "target", "position", "rotation", "relative"]);
  if (operation.relative !== undefined && typeof operation.relative !== "boolean") fail(`${label}.relative must be a boolean`);
  return { type, id, target: text(operation.target, `${label}.target`), position: triple(operation.position ?? [0, 0, 0], `${label}.position`), rotation: triple(operation.rotation ?? [0, 0, 0], `${label}.rotation`), relative: operation.relative === true };
}

export function build(operation, ctx) {
  const { bodyList, remember, affectedBodyIds } = ctx;
  const targets = bodyList(operation.target);
  const transform = matrixForTransform(operation.position, operation.rotation);
  for (const body of targets) {
    body.m = operation.relative ? matrixMultiply(transform, body.m) : transform.slice();
    affectedBodyIds.add(body.id);
  }
  remember(operation.id, targets);
}
