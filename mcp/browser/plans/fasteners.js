const IN = 25.4;

const METRIC = {
  M2_5: [2.5, 0.45, 5, 1.7, 5, 2],
  M3: [3, 0.5, 5.5, 2, 5.5, 2.4],
  M4: [4, 0.7, 7, 2.8, 7, 3.2],
  M5: [5, 0.8, 8, 3.5, 8, 4.7],
  M6: [6, 1, 10, 4, 10, 5.2],
  M8: [8, 1.25, 13, 5.3, 13, 6.8],
  M10: [10, 1.5, 16, 6.4, 16, 8.4],
  M12: [12, 1.75, 18, 7.5, 18, 10.8],
};

const INCH = {
  "#6-32": [0.138, 32, 0.25, 0.093, 0.3125, 0.109],
  "#8-32": [0.164, 32, 0.25, 0.11, 0.344, 0.125],
  "#10-24": [0.19, 24, 0.3125, 0.12, 0.375, 0.125],
  "#10-32": [0.19, 32, 0.3125, 0.12, 0.375, 0.125],
  "1/4-20": [0.25, 20, 0.4375, 0.172, 0.4375, 0.219],
  "1/4-28": [0.25, 28, 0.4375, 0.172, 0.4375, 0.219],
  "5/16-18": [0.3125, 18, 0.5, 0.219, 0.5, 0.266],
  "5/16-24": [0.3125, 24, 0.5, 0.219, 0.5, 0.266],
  "3/8-16": [0.375, 16, 0.5625, 0.25, 0.5625, 0.328],
  "3/8-24": [0.375, 24, 0.5625, 0.25, 0.5625, 0.328],
  "1/2-13": [0.5, 13, 0.75, 0.344, 0.75, 0.438],
  "1/2-20": [0.5, 20, 0.75, 0.344, 0.75, 0.438],
};

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const metricKey = (size) => size.replace(".", "_");
const nameFor = (type, size, length) => type === "nut" ? `${size} nut` : `${size}×${length} mm ${type === "rod" ? "threaded rod" : type === "cutter" ? "tap cutter" : "bolt"}`;

function dimensions(size) {
  const metric = METRIC[metricKey(size)];
  if (metric) return { d: metric[0], pitch: metric[1], boltAcrossFlats: metric[2], boltHeadHeight: metric[3], nutAcrossFlats: metric[4], nutThickness: metric[5] };
  const inch = INCH[size];
  if (!inch) throw new Error(`Unknown fastener size "${size}". Supported sizes: ${[...Object.keys(METRIC).map((key) => key.replace("_", ".")), ...Object.keys(INCH)].join(", ")}`);
  return { d: +(inch[0] * IN).toFixed(4), pitch: +(IN / inch[1]).toFixed(5), boltAcrossFlats: +(inch[2] * IN).toFixed(3), boltHeadHeight: +(inch[3] * IN).toFixed(3), nutAcrossFlats: +(inch[4] * IN).toFixed(3), nutThickness: +(inch[5] * IN).toFixed(3) };
}

const hex = (acrossFlats, height) => ({ t: "prim", kind: "prism", p: { w: +((acrossFlats * 2) / Math.sqrt(3)).toFixed(3), d: +((acrossFlats * 2) / Math.sqrt(3)).toFixed(3), h: height, sides: 6, r: 0, c: 0 }, mods: [] });
const cylinder = (diameter, height) => ({ t: "prim", kind: "cylinder", p: { w: diameter, d: diameter, h: height, r: 0, c: 0 }, mods: [] });

export function createFastener(operation, { idFactory, nextSeq, matrixForTransform }) {
  const { d, pitch, boltAcrossFlats, boltHeadHeight, nutAcrossFlats, nutThickness } = dimensions(operation.size);
  const bodySeq = nextSeq();
  const length = operation.length ?? 0;
  if (operation.fastenerType !== "nut") {
    if (length < 3 * pitch - 1e-9) throw new Error(`Fastener ${operation.id} length must be at least ${(3 * pitch).toFixed(3)} mm for ${operation.size}`);
    if (Math.round(length / pitch) > 150) throw new Error(`Fastener ${operation.id} exceeds the 150-thread-turn limit`);
  }

  const { fastenerType: type, clearance, left } = operation;
  const thread = (z, clear = clearance) => ({ id: idFactory("f"), seq: nextSeq(), t: "thread", face: { c: [0, 0, z], t: "CYLINDRE" }, pitch, length: 0, flip: false, left, clear });
  let node;
  let isHole = false;
  if (type === "bolt") {
    const shank = identity();
    shank[14] = boltHeadHeight;
    node = { t: "group", children: [
      { node: hex(boltAcrossFlats, boltHeadHeight), m: identity(), hole: false, name: "head" },
      { node: cylinder(d, length), m: shank, hole: false, name: "shank" },
    ], mods: [thread(boltHeadHeight + length / 2)] };
  } else if (type === "nut") {
    node = hex(nutAcrossFlats, nutThickness);
    node.mods.push({ id: idFactory("f"), seq: nextSeq(), t: "hole", kind: "simple", dia: +(d - 1.0825 * pitch).toFixed(3), through: true, depth: nutThickness + 1, tapped: false, pitch: 0, clear: 0, tip: false, size: "", at: [{ p: [0, 0, nutThickness], n: [0, 0, 1] }] });
    node.mods.push(thread(nutThickness / 2));
  } else {
    const grow = type === "cutter" ? 4 * Math.min(Math.abs(clearance), 0.3 * pitch) : 0;
    node = cylinder(+(d + grow).toFixed(4), length);
    node.mods.push(thread(length / 2, type === "cutter" ? 0 : clearance));
    isHole = type === "cutter";
  }

  return {
    body: { id: idFactory("b"), name: operation.name || nameFor(type, operation.size, length), seq: bodySeq, color: "#9fb1c4", hole: isHole, hidden: false, m: matrixForTransform(operation.position, operation.rotation), node },
    dimensions: { majorDiameter: d, pitch, length, acrossFlats: type === "nut" ? nutAcrossFlats : boltAcrossFlats, headHeight: boltHeadHeight, nutThickness },
  };
}
