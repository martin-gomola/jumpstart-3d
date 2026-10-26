import { buildGridfinity, normalizeGridfinity } from "./gridfinity.js";
import { drawerParts, normalizeDrawerLayout } from "../shared/drawer-layout.js";
import { checkPrintFit } from "../shared/print-area.js";

function partEditable(body, document) {
  const saved = body.mcpDrawerLayout;
  const signatures = body.mcpGridfinity?.sketchSignatures || body.mcpDrawerSpacer?.sketchSignatures || body.mcpBaseplateClip?.sketchSignatures;
  if (!signatures || typeof signatures !== "object") return false;
  if (body.locked || body.hidden || body.hole || saved.name !== body.name || saved.nodeSignature !== JSON.stringify(body.node) || saved.matrix !== JSON.stringify(body.m)) return false;
  return Object.entries(signatures).every(([id, signature]) => signature === JSON.stringify(document.sketches.find(sketch => sketch.id === id)));
}
export function summarizeDrawerLayouts(document) {
  const layouts = new Map();
  for (const body of document.bodies) {
    const record = body.mcpDrawerLayout;
    if (!record || record.version !== 1 || typeof record.layoutId !== "string" || !record.definition || typeof record.definition !== "object") continue;
    if (!layouts.has(record.layoutId)) layouts.set(record.layoutId, { layoutId: record.layoutId, definition: structuredClone(record.definition), bodyIds: [], editable: true });
    const entry = layouts.get(record.layoutId); entry.bodyIds.push(body.id);
    entry.editable &&= partEditable(body, document);
  }
  for (const entry of layouts.values()) {
    try {
      const expected = drawerParts(entry.definition).map(part => part.id);
      const parts = document.bodies.filter(body => entry.bodyIds.includes(body.id));
      entry.editable &&= expected.length === parts.length && expected.every(id => parts.filter(body => body.mcpDrawerLayout.partId === id).length === 1) && parts.every(body => JSON.stringify(body.mcpDrawerLayout.definition) === JSON.stringify(entry.definition));
    } catch { entry.editable = false; }
  }
  return [...layouts.values()];
}
export function buildDrawerLayout(raw, { document, addBody, idFactory, nextSeq, matrixForTransform }) {
  const op = normalizeDrawerLayout(raw);
  const previous = document.bodies.filter(body => body.mcpDrawerLayout?.layoutId === op.layoutId);
  if (previous.length && !op.replaceExisting) throw new Error("Drawer layout already exists; load it and explicitly replace it after preview");
  if (previous.length && !summarizeDrawerLayouts(document).find(layout => layout.layoutId === op.layoutId)?.editable) throw new Error("Drawer parts were edited, locked or removed; keep the native edits or create a new layout");
  const oldIds = new Set(previous.map(body => body.id)), oldSketchIds = new Set();
  for (const body of previous) for (const id of Object.keys(body.mcpGridfinity?.sketchSignatures || body.mcpDrawerSpacer?.sketchSignatures || body.mcpBaseplateClip?.sketchSignatures || {})) oldSketchIds.add(id);
  const unrelated = document.bodies.filter(body => !oldIds.has(body.id));
  const external = [unrelated.map(body => body.node), document.sketches.filter(sketch => !oldSketchIds.has(sketch.id)), document.planes || [], document.joints || []];
  if (external.some(value => [...oldIds, ...oldSketchIds].some(id => JSON.stringify(value).includes(JSON.stringify(id))))) throw new Error("Another native feature depends on this drawer; preserve it or create a new layout");
  document.bodies = unrelated;
  document.sketches = document.sketches.filter(sketch => !oldSketchIds.has(sketch.id));
  const definition = { ...op, replaceExisting: false }, created = [];
  const own = (body, spec) => {
    body.mcpDrawerLayout = { version: 1, layoutId: op.layoutId, partId: spec.id, name: body.name, definition, nodeSignature: JSON.stringify(body.node), matrix: JSON.stringify(body.m) };
    const old = previous.find(part => part.mcpDrawerLayout.partId === spec.id);
    if (old?.role !== undefined) body.role = old.role;
    if (old?.color !== undefined) body.color = old.color;
    created.push(body);
  };
  for (const { clipSlots, ...spec } of drawerParts(op)) {
    if (spec.type === "baseplateClip") {
      const node = { t: "prim", kind: "box", p: { w: spec.axis === "x" ? spec.length : spec.width, d: spec.axis === "x" ? spec.width : spec.length, h: spec.height, r: 0, c: 0 }, mods: [] };
      const body = addBody(spec.name, node, matrixForTransform(spec.position, [0, 0, 0]));
      body.mcpBaseplateClip = { axis: spec.axis, joint: spec.joint, clearance: spec.clearance, width: spec.width, length: spec.length, height: spec.height, sketchSignatures: {} };
      own(body, spec); continue;
    }
    if (spec.type === "drawerSpacer") {
      const node = { t: "group", mods: [], children: spec.rectangles.map(rect => ({
        node: { t: "prim", kind: "box", p: { w: rect.width, d: rect.depth, h: spec.height, r: 0, c: 0 }, mods: [] },
        m: matrixForTransform([rect.x, rect.y, 0], [0, 0, 0]), hole: false,
      })) };
      const body = addBody(spec.name, node, matrixForTransform(spec.position, [0, 0, 0]));
      body.mcpDrawerSpacer = { corner: spec.corner, clearance: spec.clearance, height: spec.height, legLength: spec.legLength, sketchSignatures: {} };
      if (op.printArea) body.mcpPrintFit = checkPrintFit(op.printArea, Math.max(...spec.rectangles.map(rect => rect.width)), Math.max(...spec.rectangles.map(rect => rect.depth)), spec.height, spec.name);
      body.mcpDrawerLayout = { version: 1, layoutId: op.layoutId, partId: spec.id, name: body.name, definition, nodeSignature: JSON.stringify(body.node), matrix: JSON.stringify(body.m) };
      const old = previous.find(part => part.mcpDrawerLayout.partId === spec.id);
      if (old?.role !== undefined) body.role = old.role;
      if (old?.color !== undefined) body.color = old.color;
      created.push(body); continue;
    }
    const normalized = normalizeGridfinity(spec);
    const built = buildGridfinity(normalized, { document, idFactory, nextSeq, clipSlots });
    const body = addBody(normalized.name, built.node, matrixForTransform(normalized.position, [0, 0, 0]));
    body.mcpGridfinity = built.recipe;
    if (op.printArea) body.mcpPrintFit = checkPrintFit(op.printArea, built.recipe.width, built.recipe.depth, built.recipe.totalHeight, normalized.name);
    body.mcpDrawerLayout = { version: 1, layoutId: op.layoutId, partId: spec.id, name: body.name, definition, nodeSignature: JSON.stringify(body.node), matrix: JSON.stringify(body.m) };
    const old = previous.find(part => part.mcpDrawerLayout.partId === spec.id);
    if (old?.role !== undefined) body.role = old.role;
    if (old?.color !== undefined) body.color = old.color;
    created.push(body);
  }
  return { bodies: created, removedBodyIds: [...oldIds] };
}
