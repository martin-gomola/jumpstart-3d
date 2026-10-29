// Engineering drawing sheets from hidden-line projections: view layout, title block, dimensions,
// hole callouts and warnings, written as SVG or PDF. Paper coordinates are mm with y down; view
// coordinates are model mm with y up.
// dir points from the model towards the viewer; x is the sheet's right.
export const DRAWING_CAMERAS = {
  front: { dir: [0, -1, 0], x: [1, 0, 0] },
  top: { dir: [0, 0, 1], x: [1, 0, 0] },
  right: { dir: [1, 0, 0], x: [0, 1, 0] },
  iso: { dir: [1, -1, 1], x: [1, 1, 0] },
};
export const drawingCameras = (views) => views.map((view) => ({ view, ...DRAWING_CAMERAS[view], hidden: view !== "iso" }));
export const SHEETS = { A4: [297, 210], A3: [420, 297] };
export const DRAWING_VIEWS = ["front", "top", "right", "iso"];
export const DIMENSION_DIRECTIONS = ["horizontal", "vertical", "aligned", "diameter"];
const STANDARD_SCALES = [[10, 1], [5, 1], [2, 1], [1, 1], [1, 2], [1, 5], [1, 10], [1, 20], [1, 50], [1, 100]];
const BORDER = 10, INSET = 4, TITLE = [180, 32], GAP = 24, ROOM = 14, ISO_MIN = [50, 40];
const WIDTH = { visible: 0.5, hidden: 0.25, thin: 0.18, frame: 0.7 };
const DIM_TEXT = 3, LABEL_TEXT = 2.5, NOTE_TEXT = 2.5, ON_EDGE_MM = 0.02, MAX_CALLOUTS = 6;
const LABELS = { front: "FRONT", top: "TOP", right: "RIGHT", iso: "ISOMETRIC" };

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const n = Math.hypot(...a); return a.map((v) => v / n); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r3 = (v) => Math.round(v * 1000) / 1000;
const textWidth = (s, h) => String(s).length * h * 0.56;
export const formatMm = (v) => String(Math.round(v * 100) / 100 || 0);

export function projectPoint(view, p) {
  const { dir, x } = DRAWING_CAMERAS[view], n = unit(dir), u = unit(x), v = cross(n, u);
  return [dot(p, u), dot(p, v)];
}

export function parseScale(text) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(text));
  if (!match || !(+match[1] > 0 && +match[2] > 0)) throw new Error(`Drawing scale must look like 1:2 or 2:1, not ${text}`);
  return { label: `${match[1]}:${match[2]}`, k: +match[1] / +match[2] };
}

export function normalizeDrawing(drawing = {}) {
  const views = drawing.views?.length ? [...new Set(drawing.views)] : DRAWING_VIEWS;
  for (const view of views) if (!DRAWING_VIEWS.includes(view)) throw new Error(`Unknown drawing view ${view}`);
  const sheet = drawing.sheet || "A4", projection = drawing.projection || "third", scale = drawing.scale || "auto";
  if (!SHEETS[sheet]) throw new Error("Drawing sheet must be A4 or A3");
  if (!["third", "first"].includes(projection)) throw new Error("Drawing projection must be third or first");
  if (scale !== "auto") parseScale(scale);
  const dimensions = drawing.dimensions || [];
  dimensions.forEach((d, i) => {
    if (!DIMENSION_DIRECTIONS.includes(d.direction)) throw new Error(`Dimension ${i + 1} direction must be one of ${DIMENSION_DIRECTIONS.join(", ")}`);
    if (!views.includes(d.view) || d.view === "iso") throw new Error(`Dimension ${i + 1} must name a drawn front, top or right view`);
    for (const key of d.direction === "diameter" ? ["from"] : ["from", "to"]) if (!Array.isArray(d[key]) || d[key].length !== 3 || !d[key].every(Number.isFinite)) throw new Error(`Dimension ${i + 1} ${key} must be a world point [x, y, z]`);
  });
  const text = (value) => (value == null ? "" : String(value));
  return { title: text(drawing.title) || "Untitled", number: text(drawing.number), revision: text(drawing.revision), author: text(drawing.author), material: text(drawing.material), date: text(drawing.date), sheet, projection, scale, views, hiddenLines: drawing.hiddenLines !== false, autoDimensions: drawing.autoDimensions !== false, dimensions, notes: (drawing.notes || []).map(String) };
}

// projections: [{ view, visible, hidden, circles, box }] from the kernel, in view coordinates.
export function composeDrawing(projections, drawing) {
  const req = normalizeDrawing(drawing);
  const byView = new Map(projections.map((p) => [p.view, p]));
  const warnings = [], items = [], labels = [], report = { dimensions: [], holes: [] };
  const [W, H] = SHEETS[req.sheet];
  const frame = [BORDER, BORDER, W - BORDER, H - BORDER];
  const area = [frame[0] + INSET, frame[1] + INSET, frame[2] - INSET, frame[3] - TITLE[1] - INSET];
  const aw = area[2] - area[0], ah = area[3] - area[1];
  for (const view of req.views) if (!byView.get(view)?.box) warnings.push(`The ${view} view has no drawable geometry`);
  const ortho = req.views.filter((v) => v !== "iso" && byView.get(v)?.box);
  const has = (v) => ortho.includes(v);
  const size = (v) => { const b = byView.get(v).box; return [b[2] - b[0], b[3] - b[1]]; };
  const colA = Math.max(has("front") ? size("front")[0] : 0, has("top") ? size("top")[0] : 0);
  const colB = has("right") ? size("right")[0] : 0;
  const rowF = Math.max(has("front") ? size("front")[1] : 0, has("right") ? size("right")[1] : 0);
  const rowT = has("top") ? size("top")[1] : 0;
  const third = req.projection === "third";
  const block = (k) => {
    const cols = [colA, colB].filter((c) => c > 0), rows = [rowT, rowF].filter((r) => r > 0);
    return [k * cols.reduce((a, b) => a + b, 0) + GAP * Math.max(0, cols.length - 1) + 2 * ROOM, k * rows.reduce((a, b) => a + b, 0) + GAP * Math.max(0, rows.length - 1) + 2 * ROOM];
  };
  const fits = (k) => { const [bw, bh] = block(k); return bw <= aw + 1e-6 && bh <= ah + 1e-6; };
  const isoBox = req.views.includes("iso") ? byView.get("iso")?.box : null;
  // The isometric view takes the free quadrant or a strip beside or above the block, whichever fits it largest.
  const isoCell = (k) => {
    const [bw, bh] = block(k), bx = area[0], by = area[3] - bh;
    const cells = [[bx + bw, area[1], area[2], area[3]], [area[0], area[1], area[2], by]];
    if (colA && colB && rowT && rowF) cells.push([bx + ROOM + k * colA + GAP, area[1], area[2], by + ROOM + k * rowT + GAP / 2]);
    const iw = isoBox[2] - isoBox[0], ih = isoBox[3] - isoBox[1];
    let best = null;
    for (let [x0, y0, x1, y1] of cells) {
      if (!third) [x0, x1, y0, y1] = [area[0] + area[2] - x1, area[0] + area[2] - x0, area[1] + area[3] - y1, area[1] + area[3] - y0];
      if (x1 - x0 < ISO_MIN[0] || y1 - y0 < ISO_MIN[1]) continue;
      const fit = Math.min((x1 - x0 - 8) / iw, (y1 - y0 - 12) / ih);
      if (fit > 0 && (!best || fit > best.k)) best = { cell: [x0, y0, x1, y1], k: fit };
    }
    return best;
  };
  const candidates = req.scale === "auto" ? STANDARD_SCALES.map(([a, b]) => ({ label: `${a}:${b}`, k: a / b })) : [parseScale(req.scale)];
  let scale = null, iso = null;
  for (const c of candidates) if (fits(c.k) && (!isoBox || (iso = isoCell(c.k)))) { scale = c; break; }
  if (!scale && isoBox) {
    scale = candidates.find((c) => fits(c.k)) || null;
    iso = null;
    if (scale) warnings.push(`The isometric view was dropped: no room for it at ${scale.label}`);
  }
  if (!scale) { scale = candidates.at(-1); warnings.push(`The views do not fit the ${req.sheet} sheet at ${scale.label}; use a smaller scale or an A3 sheet`); }
  const k = scale.k, [bw, bh] = block(k);
  const bx = iso ? (third ? area[0] : area[2] - bw) : area[0] + (aw - bw) / 2;
  const by = iso ? (third ? area[3] - bh : area[1]) : area[1] + (ah - bh) / 2;
  const colX = {}, rowY = {};
  let cursor = bx + ROOM;
  for (const [key, w] of third ? [["A", colA], ["B", colB]] : [["B", colB], ["A", colA]]) if (w > 0) { colX[key] = cursor; cursor += k * w + GAP; }
  cursor = by + ROOM;
  for (const [key, h] of third ? [["T", rowT], ["F", rowF]] : [["F", rowF], ["T", rowT]]) if (h > 0) { rowY[key] = cursor; cursor += k * h + GAP; }
  const box = (v) => byView.get(v).box;
  const place = {};
  const minX = (...vs) => Math.min(...vs.filter(has).map((v) => box(v)[0]));
  const maxY = (...vs) => Math.max(...vs.filter(has).map((v) => box(v)[3]));
  if (has("front")) place.front = { x: colX.A, y: rowY.F, u0: minX("front", "top"), v1: maxY("front", "right"), k };
  if (has("top")) place.top = { x: colX.A, y: rowY.T, u0: minX("front", "top"), v1: box("top")[3], k };
  if (has("right")) place.right = { x: colX.B, y: rowY.F, u0: box("right")[0], v1: maxY("front", "right"), k };
  if (iso) {
    const [x0, y0, x1, y1] = iso.cell, b = isoBox;
    place.iso = { x: (x0 + x1) / 2 - (iso.k * (b[2] - b[0])) / 2, y: (y0 + y1) / 2 - 2 - (iso.k * (b[3] - b[1])) / 2, u0: b[0], v1: b[3], k: iso.k };
  }
  const paper = (view, [u, v]) => { const p = place[view]; return [r3(p.x + p.k * (u - p.u0)), r3(p.y + p.k * (p.v1 - v))]; };
  const paperBox = (view) => { const b = box(view), a = paper(view, [b[0], b[3]]), c = paper(view, [b[2], b[1]]); return [a[0], a[1], c[0], c[1]]; };

  const line = (a, b, w, dash) => items.push({ t: "line", a, b, w, dash });
  const text = (p, s, h, { anchor = "middle", rot = 0, bold = false, kind = "label", owner = null } = {}) => {
    items.push({ t: "text", p, s, h, anchor, rot, bold });
    const w = textWidth(s, h), dx = anchor === "middle" ? -w / 2 : anchor === "end" ? -w : 0;
    const c = Math.cos((rot * Math.PI) / 180), sn = Math.sin((rot * Math.PI) / 180);
    const corners = [[dx, 0], [dx + w, 0], [dx, h], [dx + w, h]].map(([x, y]) => [p[0] + x * c - y * sn, p[1] - x * sn - y * c]);
    const b = [Math.min(...corners.map((q) => q[0])), Math.min(...corners.map((q) => q[1])), Math.max(...corners.map((q) => q[0])), Math.max(...corners.map((q) => q[1]))];
    if (kind !== "title") labels.push({ s, box: b, kind, owner });
  };
  const arrow = (tip, from) => {
    const d = [tip[0] - from[0], tip[1] - from[1]], n = Math.hypot(...d) || 1, t = [d[0] / n, d[1] / n], base = [tip[0] - t[0] * 2.5, tip[1] - t[1] * 2.5];
    items.push({ t: "tri", pts: [tip, [base[0] - t[1] * 0.6, base[1] + t[0] * 0.6], [base[0] + t[1] * 0.6, base[1] - t[0] * 0.6]].map((q) => q.map(r3)) });
  };

  // views
  for (const view of Object.keys(place)) {
    const proj = byView.get(view);
    const draw = (lines, w, dash) => { for (const pl of lines) { const pts = []; for (let i = 0; i < pl.length; i += 2) pts.push(paper(view, [pl[i], pl[i + 1]])); items.push({ t: "poly", pts, w, dash }); } };
    if (req.hiddenLines && view !== "iso") draw(proj.hidden || [], WIDTH.hidden, "hidden");
    draw(proj.visible || [], WIDTH.visible);
    if (view !== "iso") for (const { c, r } of proj.circles || []) {
      const p = paper(view, c), rp = r * place[view].k, e = rp + 2;
      if (rp < 0.8) continue;
      line([r3(p[0] - e), p[1]], [r3(p[0] + e), p[1]], WIDTH.thin, e > 6 ? "center" : undefined);
      line([p[0], r3(p[1] - e)], [p[0], r3(p[1] + e)], WIDTH.thin, e > 6 ? "center" : undefined);
    }
  }

  const stacks = new Map();
  const nextSlot = (view, side) => { const n = stacks.get(`${view}:${side}`) || 0; stacks.set(`${view}:${side}`, n + 1); return n; };
  const linear = (view, a, b, direction, value, label, source, { side, offset } = {}) => {
    const pb = paperBox(view), pa = paper(view, a), pc = paper(view, b);
    let P1, P2;
    if (direction === "horizontal") {
      side ||= "above";
      const d = offset ?? 8 + 6 * nextSlot(view, side), y = side === "above" ? pb[1] - d : pb[3] + d;
      P1 = [pa[0], y]; P2 = [pc[0], y];
    } else if (direction === "vertical") {
      side ||= "right";
      const d = offset ?? 8 + 6 * nextSlot(view, side), x = side === "left" ? pb[0] - d : pb[2] + d;
      P1 = [x, pa[1]]; P2 = [x, pc[1]];
    } else {
      const t = [pc[0] - pa[0], pc[1] - pa[1]], n = Math.hypot(...t);
      let nrm = [-t[1] / n, t[0] / n];
      const mid = [(pa[0] + pc[0]) / 2, (pa[1] + pc[1]) / 2], centre = [(pb[0] + pb[2]) / 2, (pb[1] + pb[3]) / 2];
      if (nrm[0] * (mid[0] - centre[0]) + nrm[1] * (mid[1] - centre[1]) < 0) nrm = [-nrm[0], -nrm[1]];
      const d = offset ?? 8 + 6 * nextSlot(view, "aligned");
      P1 = [pa[0] + nrm[0] * d, pa[1] + nrm[1] * d]; P2 = [pc[0] + nrm[0] * d, pc[1] + nrm[1] * d];
    }
    P1 = P1.map(r3); P2 = P2.map(r3);
    for (const [q, P] of [[pa, P1], [pc, P2]]) {
      const e = [P[0] - q[0], P[1] - q[1]], n = Math.hypot(...e);
      if (n > 1.2) line([r3(q[0] + (e[0] / n) * 1), r3(q[1] + (e[1] / n) * 1)], [r3(P[0] + (e[0] / n) * 2), r3(P[1] + (e[1] / n) * 2)], WIDTH.thin);
    }
    line(P1, P2, WIDTH.thin);
    arrow(P1, P2); arrow(P2, P1);
    const dx = P2[0] - P1[0], dy = P2[1] - P1[1];
    let rot = (Math.atan2(-dy, dx) * 180) / Math.PI;
    if (rot > 90.001) rot -= 180; if (rot <= -89.999) rot += 180;
    const up = [-Math.sin((rot * Math.PI) / 180), -Math.cos((rot * Math.PI) / 180)];
    text([r3((P1[0] + P2[0]) / 2 + up[0]), r3((P1[1] + P2[1]) / 2 + up[1])], label, DIM_TEXT, { rot: r3(rot), kind: "dimension", owner: view });
    report.dimensions.push({ view, direction, value: r3(value), text: label, source });
  };
  const dimText = (value, d = {}) => `${d.prefix || ""}${formatMm(value)}${d.tolerance ? ` ${d.tolerance}` : ""}${d.suffix || ""}`;

  const callout = (view, circle, label) => {
    const pb = paperBox(view), c = paper(view, circle.c), rp = circle.r * place[view].k;
    const elbow = [r3(c[0] + rp * 0.7 + 4), r3(Math.min(pb[1] - 6 - 6 * nextSlot(view, "above"), c[1] - rp - 4))];
    const d = [elbow[0] - c[0], elbow[1] - c[1]], n = Math.hypot(...d);
    const start = [r3(c[0] + (d[0] / n) * rp), r3(c[1] + (d[1] / n) * rp)];
    line(start, elbow, WIDTH.thin);
    line(elbow, [r3(elbow[0] + 2), elbow[1]], WIDTH.thin);
    arrow(start, elbow);
    text([r3(elbow[0] + 3), r3(elbow[1] + DIM_TEXT * 0.35)], label, DIM_TEXT, { anchor: "start", kind: "dimension", owner: view });
  };

  if (req.autoDimensions) {
    const overall = (view, axis, direction, side, source) => {
      const b = box(view), a = [b[0], b[1]], e = axis === 0 ? [b[2], b[1]] : [b[0], b[3]];
      const value = axis === 0 ? b[2] - b[0] : b[3] - b[1];
      linear(view, a, e, direction, value, formatMm(value), source, { side });
    };
    const widthView = has("front") ? "front" : has("top") ? "top" : null;
    if (widthView) overall(widthView, 0, "horizontal", "below", "overall width (X)");
    const heightView = has("front") ? "front" : has("right") ? "right" : null;
    if (heightView) overall(heightView, 1, "vertical", "left", "overall height (Z)");
    if (has("right")) overall("right", 0, "horizontal", "below", "overall depth (Y)");
    else if (has("top")) overall("top", 1, "vertical", "left", "overall depth (Y)");
    const groups = new Map();
    for (const view of ["top", "front", "right"].filter(has)) for (const circle of byView.get(view).circles || []) {
      const key = circle.r.toFixed(3), group = groups.get(key) || new Map();
      group.set(view, [...(group.get(view) || []), circle]);
      groups.set(key, group);
    }
    const ordered = [...groups.entries()].sort((a, b) => +a[0] - +b[0]);
    ordered.slice(0, MAX_CALLOUTS).forEach(([key, group]) => {
      const [view, circles] = [...group.entries()].reduce((best, entry) => (entry[1].length > best[1].length ? entry : best));
      const target = circles.reduce((best, c) => { const p = paper(view, c.c), q = paper(view, best.c); return p[0] - p[1] > q[0] - q[1] ? c : best; });
      const diameter = 2 * +key, label = `${circles.length > 1 ? `${circles.length}X ` : ""}Ø${formatMm(diameter)}`;
      callout(view, target, label);
      report.holes.push({ view, diameter: r3(diameter), count: circles.length });
      report.dimensions.push({ view, direction: "diameter", value: r3(diameter), text: label, source: "auto" });
    });
    if (ordered.length > MAX_CALLOUTS) warnings.push(`${ordered.length - MAX_CALLOUTS} more circle diameters were not called out; add them as diameter dimensions`);
  }

  const distanceToEdges = (view, q) => {
    const proj = byView.get(view);
    let best = Infinity;
    for (const pl of [...(proj.visible || []), ...(proj.hidden || [])]) for (let i = 0; i + 3 < pl.length; i += 2) {
      const ax = pl[i], ay = pl[i + 1], dx = pl[i + 2] - ax, dy = pl[i + 3] - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(q[0] - ax - t * dx, q[1] - ay - t * dy));
    }
    for (const { c } of proj.circles || []) best = Math.min(best, Math.hypot(q[0] - c[0], q[1] - c[1]));
    return best;
  };
  req.dimensions.forEach((d, i) => {
    const name = `Dimension ${i + 1}`;
    if (!place[d.view]) { warnings.push(`${name} names the ${d.view} view, which is not drawn`); return; }
    const a = projectPoint(d.view, d.from);
    if (d.direction === "diameter") {
      const circles = (byView.get(d.view).circles || []).filter(({ c }) => Math.hypot(c[0] - a[0], c[1] - a[1]) <= 0.05);
      if (!circles.length) { warnings.push(`${name}: no circle in the ${d.view} view is centred at the from point`); return; }
      let circle = circles[0];
      if (d.to) { const b = projectPoint(d.view, d.to), r = Math.hypot(b[0] - a[0], b[1] - a[1]); circle = circles.reduce((best, c) => (Math.abs(c.r - r) < Math.abs(best.r - r) ? c : best)); }
      else if (circles.length > 1) { circle = circles.reduce((best, c) => (c.r < best.r ? c : best)); warnings.push(`${name}: concentric circles at the from point; the smallest was used. Give a point on the wanted circle as to`); }
      const label = dimText(2 * circle.r, { prefix: `Ø${d.prefix || ""}`, tolerance: d.tolerance, suffix: d.suffix });
      callout(d.view, circle, label);
      report.dimensions.push({ view: d.view, direction: "diameter", value: r3(2 * circle.r), text: label, source: "requested" });
      return;
    }
    const b = projectPoint(d.view, d.to);
    const value = d.direction === "horizontal" ? Math.abs(b[0] - a[0]) : d.direction === "vertical" ? Math.abs(b[1] - a[1]) : Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (value < 1e-6) { warnings.push(`${name} has zero length in the ${d.view} view; choose points that differ ${d.direction === "vertical" ? "vertically" : d.direction === "horizontal" ? "horizontally" : "in this view"}`); return; }
    for (const [which, q] of [["from", a], ["to", b]]) {
      const gap = distanceToEdges(d.view, q);
      if (gap > ON_EDGE_MM) warnings.push(`${name} ${which} point is ${formatMm(gap)} mm from any drawn edge or circle centre in the ${d.view} view; it measures blank paper`);
    }
    linear(d.view, a, b, d.direction, value, dimText(value, d), "requested", { side: d.side, offset: d.offset });
  });

  for (const view of Object.keys(place)) {
    const pb = paperBox(view), below = view !== "iso" && [...stacks.keys()].includes(`${view}:below`);
    text([r3((pb[0] + pb[2]) / 2), r3(pb[3] + (below ? 13 : 6))], LABELS[view], LABEL_TEXT, { owner: view });
  }

  // frame, title block and notes
  items.push({ t: "rect", box: frame, w: WIDTH.frame });
  const tb = [frame[2] - TITLE[0], frame[3] - TITLE[1], frame[2], frame[3]];
  items.push({ t: "rect", box: tb, w: WIDTH.visible });
  const rowA = tb[1] + 14, rowB = tb[1] + 23;
  line([tb[0], rowA], [tb[2], rowA], WIDTH.thin); line([tb[0], rowB], [tb[2], rowB], WIDTH.thin);
  line([tb[0] + 120, tb[1]], [tb[0] + 120, rowB], WIDTH.thin);
  for (const x of [30, 55, 95]) line([tb[0] + x, rowA], [tb[0] + x, rowB], WIDTH.thin);
  for (const x of [60, 120]) line([tb[0] + x, rowB], [tb[0] + x, tb[3]], WIDTH.thin);
  const cell = (x0, x1, y0, y1, caption, value, max = 3, bold = false) => {
    text([r3(x0 + 1.2), r3(y0 + 2.4)], caption, 1.8, { anchor: "start", kind: "title" });
    if (!value) return;
    const h = Math.min(max, (x1 - x0 - 2.4) / (String(value).length * 0.56));
    text([r3(x0 + 1.2), r3(y1 - 1.6)], value, r3(h), { anchor: "start", bold, kind: "title" });
  };
  cell(tb[0], tb[0] + 120, tb[1], rowA, "TITLE", req.title, 5, true);
  cell(tb[0] + 120, tb[2], tb[1], rowA, "DRAWING NO.", req.number);
  cell(tb[0], tb[0] + 30, rowA, rowB, "SCALE", ortho.length ? scale.label : "NTS");
  cell(tb[0] + 30, tb[0] + 55, rowA, rowB, "UNITS", "mm");
  cell(tb[0] + 55, tb[0] + 95, rowA, rowB, third ? "THIRD ANGLE" : "FIRST ANGLE", "");
  cell(tb[0] + 95, tb[0] + 120, rowA, rowB, "SHEET", req.sheet);
  cell(tb[0] + 120, tb[2], rowA, rowB, "REVISION", req.revision);
  cell(tb[0], tb[0] + 60, rowB, tb[3], "MATERIAL", req.material);
  cell(tb[0] + 60, tb[0] + 120, rowB, tb[3], "DRAWN BY", req.author);
  cell(tb[0] + 120, tb[2], rowB, tb[3], "DATE", req.date);
  // ISO 5456-2 projection symbol: a truncated cone and its end view
  const sy = (rowA + rowB) / 2 + 0.8, cone = third ? tb[0] + 76 : tb[0] + 86, ends = third ? tb[0] + 88 : tb[0] + 74;
  items.push({ t: "poly", pts: [[cone - 5, sy - 3], [cone + 5, sy - 1.8], [cone + 5, sy + 1.8], [cone - 5, sy + 3], [cone - 5, sy - 3]].map((q) => q.map(r3)), w: WIDTH.thin });
  items.push({ t: "circle", c: [ends, r3(sy)], r: 3, w: WIDTH.thin }, { t: "circle", c: [ends, r3(sy)], r: 1.8, w: WIDTH.thin });
  if (req.notes.length) {
    const nx = frame[0] + 3, width = tb[0] - nx - 3, perLine = Math.max(10, Math.floor(width / (NOTE_TEXT * 0.56)));
    const lines = [];
    req.notes.forEach((note, i) => {
      let current = `${i + 1}. `;
      for (const word of note.split(/\s+/)) {
        if (current.length + word.length > perLine && current.trim().length > 3) { lines.push(current.trimEnd()); current = `   ${word} `; } else current += `${word} `;
      }
      lines.push(current.trimEnd());
    });
    const room = Math.floor((TITLE[1] - 5) / (NOTE_TEXT * 1.4));
    if (lines.length > room) warnings.push(`The notes need ${lines.length} lines but only ${room} fit; shorten them`);
    text([nx, r3(tb[1] + 2.5)], "NOTES", NOTE_TEXT, { anchor: "start", bold: true, kind: "title" });
    lines.slice(0, room).forEach((s, i) => text([nx, r3(tb[1] + 2.5 + (i + 1) * NOTE_TEXT * 1.4)], s, NOTE_TEXT, { anchor: "start", kind: "title" }));
  }

  // overlaps: annotation text against other text, the drawn views, the frame and the title block
  const hit = (a, b, pad = 0.3) => a[0] < b[2] - pad && a[2] > b[0] + pad && a[1] < b[3] - pad && a[3] > b[1] + pad;
  const viewBoxes = Object.keys(place).map((view) => ({ view, box: paperBox(view) }));
  const reported = new Set();
  labels.forEach((l, i) => {
    const say = (message) => { if (!reported.has(message)) { reported.add(message); warnings.push(message); } };
    for (const other of labels.slice(i + 1)) if (hit(l.box, other.box)) say(`Annotation "${l.s}" overlaps "${other.s}"`);
    for (const { view, box: vb } of viewBoxes) if (hit(l.box, vb, 0.5)) say(`Annotation "${l.s}" overlaps the ${view} view`);
    if (l.box[0] < frame[0] || l.box[1] < frame[1] || l.box[2] > frame[2] || l.box[3] > frame[3] || hit(l.box, tb)) say(`Annotation "${l.s}" runs outside the drawing area`);
  });

  return {
    sheet: { size: req.sheet, width: W, height: H },
    items,
    report: {
      title: req.title, sheet: req.sheet, projection: req.projection, scale: ortho.length ? scale.label : "NTS",
      views: Object.keys(place).map((view) => { const b = box(view); return { view, scale: view === "iso" ? r3(place.iso.k) : k, modelSize: [r3(b[2] - b[0]), r3(b[3] - b[1])], paperBox: paperBox(view) }; }),
      dimensions: report.dimensions, holes: report.holes, warnings,
    },
  };
}

// ------------------------------------------------------------------ writers
const DASH = { hidden: [3, 1.5], center: [8, 1.5, 1.5, 1.5] };
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

export function drawingSVG({ sheet, items, report }) {
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}mm" height="${sheet.height}mm" viewBox="0 0 ${sheet.width} ${sheet.height}" font-family="Helvetica, Arial, sans-serif">`, `<title>${esc(report.title)}</title>`, `<rect x="0" y="0" width="${sheet.width}" height="${sheet.height}" fill="#fff"/>`, `<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">`];
  const stroke = (it) => `stroke-width="${it.w}"${it.dash ? ` stroke-dasharray="${DASH[it.dash].join(" ")}"` : ""}`;
  const texts = [];
  for (const it of items) {
    if (it.t === "line") out.push(`<line x1="${it.a[0]}" y1="${it.a[1]}" x2="${it.b[0]}" y2="${it.b[1]}" ${stroke(it)}/>`);
    else if (it.t === "poly") out.push(`<polyline points="${it.pts.map((p) => p.join(",")).join(" ")}" ${stroke(it)}/>`);
    else if (it.t === "rect") out.push(`<rect x="${it.box[0]}" y="${it.box[1]}" width="${r3(it.box[2] - it.box[0])}" height="${r3(it.box[3] - it.box[1])}" ${stroke(it)}/>`);
    else if (it.t === "circle") out.push(`<circle cx="${it.c[0]}" cy="${it.c[1]}" r="${it.r}" ${stroke(it)}/>`);
    else if (it.t === "tri") out.push(`<polygon points="${it.pts.map((p) => p.join(",")).join(" ")}" fill="#000" stroke="none"/>`);
    else if (it.t === "text") texts.push(`<text x="${it.p[0]}" y="${it.p[1]}" font-size="${it.h}" text-anchor="${it.anchor}"${it.bold ? ' font-weight="bold"' : ""}${it.rot ? ` transform="rotate(${-it.rot} ${it.p[0]} ${it.p[1]})"` : ""}>${esc(it.s)}</text>`);
  }
  out.push("</g>", `<g fill="#000">`, ...texts, "</g>", "</svg>");
  return out.join("\n");
}

// WinAnsi covers the drawing symbols; anything else becomes "?".
const WIN_ANSI = { "±": 0xb1, "Ø": 0xd8, "ø": 0xf8, "°": 0xb0, "×": 0xd7, "µ": 0xb5 };
const pdfString = (s) => "(" + [...String(s)].map((c) => {
  if (c === "(" || c === ")" || c === "\\") return `\\${c}`;
  if (c >= " " && c <= "~") return c;
  return WIN_ANSI[c] ? `\\${WIN_ANSI[c].toString(8)}` : "?";
}).join("") + ")";

export function drawingPDF({ sheet, items, report }) {
  const pt = 72 / 25.4, H = sheet.height, f = (v) => r3(v * pt), X = (p) => f(p[0]), Y = (p) => f(H - p[1]);
  const c = ["0 0 0 RG 0 0 0 rg 1 J 1 j"];
  const style = (it) => c.push(`${f(it.w)} w ${it.dash ? `[${DASH[it.dash].map(f).join(" ")}] 0 d` : "[] 0 d"}`);
  for (const it of items) {
    if (it.t === "line") { style(it); c.push(`${X(it.a)} ${Y(it.a)} m ${X(it.b)} ${Y(it.b)} l S`); }
    else if (it.t === "poly") { style(it); c.push(`${X(it.pts[0])} ${Y(it.pts[0])} m ${it.pts.slice(1).map((p) => `${X(p)} ${Y(p)} l`).join(" ")} S`); }
    else if (it.t === "rect") { style(it); c.push(`${f(it.box[0])} ${f(H - it.box[3])} ${f(it.box[2] - it.box[0])} ${f(it.box[3] - it.box[1])} re S`); }
    else if (it.t === "circle") {
      style(it);
      const [cx, cy] = [X(it.c), Y(it.c)], r = f(it.r), q = r3(r * 0.5523);
      c.push(`${r3(cx + r)} ${cy} m ${r3(cx + r)} ${r3(cy + q)} ${r3(cx + q)} ${r3(cy + r)} ${cx} ${r3(cy + r)} c ${r3(cx - q)} ${r3(cy + r)} ${r3(cx - r)} ${r3(cy + q)} ${r3(cx - r)} ${cy} c ${r3(cx - r)} ${r3(cy - q)} ${r3(cx - q)} ${r3(cy - r)} ${cx} ${r3(cy - r)} c ${r3(cx + q)} ${r3(cy - r)} ${r3(cx + r)} ${r3(cy - q)} ${r3(cx + r)} ${cy} c S`);
    } else if (it.t === "tri") c.push(`${X(it.pts[0])} ${Y(it.pts[0])} m ${X(it.pts[1])} ${Y(it.pts[1])} l ${X(it.pts[2])} ${Y(it.pts[2])} l h f`);
    else if (it.t === "text") {
      const h = it.h * pt, w = textWidth(it.s, it.h) * pt, dx = it.anchor === "middle" ? -w / 2 : it.anchor === "end" ? -w : 0;
      const a = (it.rot * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a), x = X(it.p) + dx * cs, y = Y(it.p) + dx * sn;
      c.push(`BT /${it.bold ? "F2" : "F1"} ${r3(h)} Tf ${r3(cs)} ${r3(sn)} ${r3(-sn)} ${r3(cs)} ${r3(x)} ${r3(y)} Tm ${pdfString(it.s)} Tj ET`);
    }
  }
  const enc = new TextEncoder(), stream = c.join("\n"), font = (name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(sheet.width)} ${f(sheet.height)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    font("Helvetica"), font("Helvetica-Bold"),
    `<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`,
  ];
  const parts = [enc.encode("%PDF-1.4\n")], offsets = [];
  let length = parts[0].length;
  objs.forEach((o, i) => { const bytes = enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`); offsets.push(length); parts.push(bytes); length += bytes.length; });
  parts.push(enc.encode(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info << /Producer (JumpStart 3D) /Title ${pdfString(report.title)} >> >>\nstartxref\n${length}\n%%EOF\n`));
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
