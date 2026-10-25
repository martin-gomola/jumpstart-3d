export const BIN_SIDES = Object.freeze(["left", "right", "front", "back"]);

export function normalizeOpenSides(value, label = "openSides") {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > BIN_SIDES.length || value.some(side => !BIN_SIDES.includes(side)) || new Set(value).size !== value.length) {
    throw new Error(`${label} must list unique sides: left, right, front or back.`);
  }
  return BIN_SIDES.filter(side => value.includes(side));
}

export function rotateOpenSides(value) {
  const clockwise = { left: "back", back: "right", right: "front", front: "left" };
  return normalizeOpenSides(normalizeOpenSides(value).map(side => clockwise[side]));
}

export function binTotalHeight({ heightUnits, floor, lip, openSides, dividers = {} }) {
  if (normalizeOpenSides(openSides).length === 4) return dividers.x || dividers.y ? heightUnits * 7 - 0.01 : 7 + floor;
  return heightUnits * 7 + (lip ? 4.4 : 0);
}
