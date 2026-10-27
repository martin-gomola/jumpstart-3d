import { binFootprint, binTotalHeight } from "./gridfinity-walls.js";
import { magnetCarrierHeight } from "./gridfinity-magnets.js";
import { checkPrintFit } from "./print-area.js";

// Overall printed size of a Gridfinity part. A spec is
// { kind, columns, rows, heightUnits, floor, lip, openSides, closeGaps, dividers, magnets }.
export function partEnvelope(spec) {
  if (spec.kind === "baseplate") return { width: spec.columns * 42, depth: spec.rows * 42, height: 5 + magnetCarrierHeight(spec.magnets) };
  const { width, depth } = binFootprint(spec);
  return { width, depth, height: spec.kind === "insert" ? spec.heightUnits * 7 : binTotalHeight(spec) };
}

export function partPrintFit(spec, area, name) {
  const { width, depth, height } = partEnvelope(spec);
  return checkPrintFit(area, width, depth, height, name);
}

export function usableDepthError(spec, label) {
  return spec.kind === "bin" && spec.heightUnits * 7 - 7 - spec.floor < 1 ? `${label}: floor leaves less than 1 mm of usable bin depth` : null;
}
