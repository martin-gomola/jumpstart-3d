// Straight bars that join neighbouring baseplate tiles from below. Each bar sits
// in a slot cut up from the bed side, so the bin-seating profile stays intact.
export const BASEPLATE_CLIP = Object.freeze({ width: 2, length: 16, slotDepth: 2, maxPerJoint: 2 });

export function normalizeBaseplateClips(value) {
  if (value === undefined || value === false) return false;
  const input = value === true ? {} : value;
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "clearance")) throw new Error("Baseplate clips accept clearance only.");
  const clearance = input.clearance ?? 0.15;
  if (!Number.isFinite(clearance) || clearance < 0.05 || clearance > 0.4) throw new Error("Baseplate clip clearance must be between 0.05 and 0.4 mm.");
  return { clearance };
}

// Interior grid nodes on a joint carry a bar across the joint inside the wall
// between two cells; a one-cell joint has none, so its bar runs along the joint.
function jointClips(from, to) {
  const nodes = [];
  for (let i = from + 1; i < to; i++) nodes.push(i);
  if (!nodes.length) return [{ at: (from + to) / 2, across: false }];
  const picked = nodes.length <= BASEPLATE_CLIP.maxPerJoint ? nodes : [nodes[0], nodes.at(-1)];
  return picked.map(at => ({ at, across: true }));
}

export function baseplateClipLayout(drawer, metrics, tile) {
  const options = normalizeBaseplateClips(drawer.baseplateClips);
  if (!options) return { clips: [], slots: new Map() };
  if (!drawer.includeBaseplate) throw new Error("Baseplate clips require matching baseplates.");
  const { clearance } = options, clips = [], slots = new Map();
  const tileId = (x, y) => `baseplate-${x}-${y}`;
  const tileName = (x, y) => `Baseplate ${x / tile.columns + 1}, ${y / tile.rows + 1}`;
  const center = (x, y) => [(x + Math.min(tile.columns, metrics.columns - x) / 2) * 42 - metrics.gridWidth / 2, (y + Math.min(tile.rows, metrics.rows - y) / 2) * 42 - metrics.gridDepth / 2];
  const add = (a, b, world, axis) => {
    const n = clips.length + 1;
    clips.push({ id: `clip-${n}`, type: "baseplateClip", name: `Baseplate clip ${n}`, axis, joint: [tileName(...a), tileName(...b)], clearance,
      position: [world[0], world[1], 0], width: BASEPLATE_CLIP.width, length: BASEPLATE_CLIP.length - 2 * clearance, height: BASEPLATE_CLIP.slotDepth - clearance });
    for (const owner of [a, b]) {
      const [cx, cy] = center(...owner), id = tileId(...owner);
      if (!slots.has(id)) slots.set(id, []);
      slots.get(id).push({ x: world[0] - cx, y: world[1] - cy, axis, length: BASEPLATE_CLIP.length, width: BASEPLATE_CLIP.width + 2 * clearance, depth: BASEPLATE_CLIP.slotDepth });
    }
  };
  for (let x = tile.columns; x < metrics.columns; x += tile.columns) {
    for (let y = 0; y < metrics.rows; y += tile.rows) {
      for (const { at, across } of jointClips(y, Math.min(y + tile.rows, metrics.rows))) {
        add([x - tile.columns, y], [x, y], [x * 42 - metrics.gridWidth / 2, at * 42 - metrics.gridDepth / 2], across ? "x" : "y");
      }
    }
  }
  for (let y = tile.rows; y < metrics.rows; y += tile.rows) {
    for (let x = 0; x < metrics.columns; x += tile.columns) {
      for (const { at, across } of jointClips(x, Math.min(x + tile.columns, metrics.columns))) {
        add([x, y - tile.rows], [x, y], [at * 42 - metrics.gridWidth / 2, y * 42 - metrics.gridDepth / 2], across ? "y" : "x");
      }
    }
  }
  return { clips, slots };
}
