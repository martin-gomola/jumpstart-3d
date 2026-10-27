import { BODY_ROLES } from "../../../../src/bodyRoles.js";
import { fail, strictObject, text } from "../plan-input.js";

export function normalize(operation, label, { type, id }) {
  strictObject(operation, label, ["id", "type", "target", "role"]);
  if (!BODY_ROLES.includes(operation.role)) fail(`${label}.role must be design, reference or hardware`);
  return { type, id, target: text(operation.target, `${label}.target`), role: operation.role };
}

export function build(operation, ctx) {
  const { bodyList, remember, affectedBodyIds } = ctx;
  const targets = bodyList(operation.target);
  for (const body of targets) {
    if (body.locked) fail(`Unlock body ${body.id} before changing its role`);
    body.role = operation.role;
    affectedBodyIds.add(body.id);
  }
  remember(operation.id, targets);
}
