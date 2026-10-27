import { fail } from "../plan-input.js";
import { normalizePocket, buildPocket } from "../pockets.js";

export const advanced = true;

export function normalize(operation, label) {
  return normalizePocket(operation, label);
}

export function build(operation, ctx) {
  const { doc, idFactory, bodyList, remember, affectedBodyIds } = ctx;
  const targets = bodyList(operation.target);
  if (targets.length !== 1) fail(`Pocket ${operation.id} requires one insert body`);
  const body = targets[0];
  if (body.locked) fail(`Unlock body ${body.id} before cutting a pocket`);
  buildPocket(operation, { document: doc, target: body, idFactory, nextSeq: () => ++doc.seq });
  affectedBodyIds.add(body.id);
  remember(operation.id, targets);
}
