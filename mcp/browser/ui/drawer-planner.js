import { rotateOpenSides, binFootprint, binTotalHeight } from "../../shared/gridfinity-walls.js";
import { drawerMetrics, normalizeDrawerLayout, rotateDrawerLayout, placementError, firstDrawerSpace, fillDrawerGaps, DRAWER_LIMITS, drawerBinBaseZ } from "../../shared/drawer-layout.js";
import { normalizeMagnetPockets, magnetCarrierHeight } from "../../shared/gridfinity-magnets.js";
import { normalizeBinLimits } from "../../shared/gridfinity-limits.js";
import { normalizeCornerSpacers, cornerSpacerParts } from "../../shared/drawer-spacers.js";
import { normalizePrintArea, baseplateTileLimits, checkPrintFit } from "../../shared/print-area.js";
import { baseplateClipLayout } from "../../shared/baseplate-clips.js";

const uuid = () => `drawer-${crypto.randomUUID()}`;
const copy = value => structuredClone(value);
const binCounter = draft => draft.bins.reduce((max, bin) => Math.max(max, Number(bin.id.match(/\d+$/)?.[0]) || 0), 0);

// Mirrors HTML number-input validity so the view can enable actions without reading the DOM.
export function numberValid(text, { min = -Infinity, max = Infinity, step = "any" } = {}) {
  if (String(text).trim() === "") return false;
  const value = Number(text);
  if (!Number.isFinite(value) || value < min || value > max) return false;
  if (step === "any") return true;
  const steps = (value - (Number.isFinite(min) ? min : 0)) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-7;
}

export function drawerReady(draft) {
  const m = drawerMetrics(draft);
  return m.columns > 0 && m.rows > 0 && m.columns <= 20 && m.rows <= 20 && Number.isFinite(draft.height) && draft.height >= 14;
}

export function drawerStatus(draft) {
  const ready = drawerReady(draft), m = drawerMetrics(draft);
  let error; try { normalizeDrawerLayout(draft); } catch (failure) { error = failure.message; }
  let spacerNote = "";
  if (draft.cornerSpacers) {
    try { const parts = cornerSpacerParts(draft, m); spacerNote = parts.length ? `${parts.length} separate flat-bottom spacers, ${draft.cornerSpacers.height} mm tall. Test printed fit before making all four.` : "The grid fills the drawer; no spacers are needed."; }
    catch (failure) { error = failure.message; spacerNote = failure.message; }
  }
  let clipNote = "";
  if (draft.baseplateClips && ready) {
    try { const count = baseplateClipLayout(draft, m, baseplateTileLimits(draft.printArea, m)).clips.length; clipNote = count ? `${count} separate 2 × 16 mm clips press into slots under the tile joints. Test one joint before printing them all.` : "One baseplate tile covers the grid; no clips are needed."; }
    catch (failure) { clipNote = failure.message; }
  }
  let carrierNote = "";
  if (draft.baseplateMagnets) { const lift = magnetCarrierHeight(draft.baseplateMagnets); carrierNote = `Magnet carrier adds ${lift.toFixed(1)} mm. Baseplate height: ${(5 + lift).toFixed(1)} mm. Bin seating height is included in drawer-fit checks.`; }
  const fit = ready ? `${m.columns} × ${m.rows} grid · ${m.gridWidth} × ${m.gridDepth} mm. Spare space: ${(m.spareWidth / 2).toFixed(1)} mm per side, ${(m.spareDepth / 2).toFixed(1)} mm front/back.` : "Enter the drawer’s inside measurements in millimetres.";
  const magnetCount = draft.bins.reduce((sum, bin) => sum + (bin.magnets ? bin.columns * bin.rows * 4 : 0), 0) + (draft.includeBaseplate && draft.baseplateMagnets ? m.total * 4 : 0);
  let summary = ready ? `${draft.bins.length} bins · ${m.occupied} of ${m.total} cells used (${m.fill}%).${draft.includeBaseplate ? " Matching baseplates included." : ""}${magnetCount ? ` ${magnetCount} magnet pockets.` : ""}` : "";
  if (ready && !draft.bins.length && draft.includeBaseplate) summary = `Baseplates only · ${m.total} grid cells.${magnetCount ? ` ${magnetCount} magnet pockets.` : ""}`;
  if (ready && draft.bins.some(bin => bin.openSides?.length)) summary += " Dashed edges are open.";
  return { metrics: m, ready, error, spacerNote, clipNote, carrierNote, fit, summary };
}

export function createDrawerPlanner({ request, onBusy = () => {}, storage = globalThis.localStorage, notify = run => run() }) {
  let preferredBinLimits = normalizeBinLimits(), preferredPrintArea = false;
  try { const saved = storage?.getItem("jumpstart.gridfinity.printArea"); if (saved) preferredPrintArea = normalizePrintArea(JSON.parse(saved)); } catch { /* Browser preferences are optional. */ }
  try { const saved = storage?.getItem("jumpstart.gridfinity.binLimits"); if (saved) preferredBinLimits = normalizeBinLimits(JSON.parse(saved)); } catch { /* Browser preferences are optional. */ }
  const fresh = () => ({ type: "drawerLayout", id: "drawer", layoutId: uuid(), name: "Drawer layout", width: 0, depth: 0, height: 0, includeBaseplate: true, baseplateMagnets: false, printArea: copy(preferredPrintArea), binLimits: copy(preferredBinLimits), floor: 2, wall: 1.2, bins: [] });
  let counter = 0, previewSeq = 0;
  let state = {
    draft: fresh(), selectedId: null, undo: [], redo: [], busy: false, view: "layout",
    message: { text: "", error: false }, measureOpen: true, measurementsCollapsed: false,
    fieldsVersion: 0, cached: null, preview: null, stale: false, continueVisible: false,
    savedLayouts: [], documentId: null, editing: false, scrollSeq: 0,
  };
  const listeners = new Set();
  const put = patch => { state = { ...state, ...patch }; };
  const emit = () => notify(() => { for (const listener of listeners) listener(); });
  const act = fn => (...args) => { try { return fn(...args); } finally { emit(); } };

  const announce = (text, error = false) => put({ message: { text, error } });
  const invalidate = () => put({ cached: null, continueVisible: false, stale: state.preview ? true : state.stale });
  function refresh() {
    const { draft } = state, { error } = drawerStatus(draft);
    put({ editing: false });
    const supplied = [draft.width, draft.depth, draft.height].every(value => Number.isFinite(value) && value > 0);
    if ((draft.bins.length || supplied) && error) announce(error, true);
  }
  function syncFields() { counter = binCounter(state.draft); put({ fieldsVersion: state.fieldsVersion + 1 }); }
  function remember() { const undo = [...state.undo, copy(state.draft)]; if (undo.length > 50) undo.shift(); put({ undo, redo: [] }); }
  function commit(next, text = "") {
    const newDrawer = next.layoutId !== state.draft.layoutId;
    remember(); put({ draft: next });
    let { measureOpen, measurementsCollapsed } = state;
    if (newDrawer) { measurementsCollapsed = false; measureOpen = true; }
    if (drawerReady(next) && next.bins.length && !measurementsCollapsed) { measureOpen = false; measurementsCollapsed = true; }
    put({ measureOpen, measurementsCollapsed });
    invalidate(); announce(text); refresh();
  }
  const picked = () => state.draft.bins.find(bin => bin.id === state.selectedId);
  const nextBin = rect => ({ id: `bin-${++counter}`, label: `Bin ${counter}`, ...rect, heightUnits: Math.max(2, Math.min(3, Math.floor(Math.min(state.draft.height - drawerBinBaseZ(state.draft), normalizePrintArea(state.draft.printArea)?.height ?? Infinity) / 7))), kind: "bin", dividers: { x: 0, y: 0 }, lip: false, magnets: false });
  function updateBin(changes) {
    const bin = picked(); if (!bin || state.busy) return false;
    const candidate = { ...bin, ...changes }, next = copy(state.draft);
    if (JSON.stringify(candidate) === JSON.stringify(bin)) { refresh(); return true; }
    const error = placementError(state.draft, candidate, bin.id);
    if (error) { announce(error, true); return false; }
    next.bins[next.bins.findIndex(entry => entry.id === bin.id)] = candidate;
    try { normalizeDrawerLayout({ ...next, bins: [candidate] }); } catch (failure) { announce(failure.message, true); return false; }
    commit(next); return true;
  }
  function perform(action) { if (state.busy) return; try { action(); } catch (error) { announce(error.message, true); } }
  function revealInspector() {
    if (!picked()) return;
    put({ measureOpen: false, measurementsCollapsed: true, scrollSeq: state.scrollSeq + 1 });
  }
  function addPart(rect) {
    if (state.draft.bins.length >= DRAWER_LIMITS.bins) throw new Error("This layout supports up to 16 bins.");
    const error = placementError(state.draft, rect); if (error) throw new Error(error);
    const next = copy(state.draft), bin = nextBin(rect); next.bins.push(bin); normalizeDrawerLayout(next); put({ selectedId: bin.id }); commit(next); revealInspector();
  }
  function setBusy(active) { put({ busy: active }); onBusy(active); refresh(); }
  function load(entry) {
    if (!entry.editable) return announce("This layout has native edits or missing parts. Keep those edits or start a new drawer.", true);
    put({ draft: copy(entry.definition), selectedId: null, undo: [], redo: [], measureOpen: false, measurementsCollapsed: true });
    invalidate(); syncFields(); put({ view: "layout" }); refresh(); announce("Layout loaded. Changes need a new preview before updating the document.");
  }
  async function refreshDocument(current, autoLoad = true) {
    const changedDocument = state.documentId !== current.document.id;
    put({ documentId: current.document.id, savedLayouts: current.drawerLayouts || [] });
    if (changedDocument) {
      put({ cached: null, preview: null });
      if (autoLoad && state.savedLayouts.length === 1 && state.savedLayouts[0].editable) load(state.savedLayouts[0]);
      else { put({ draft: fresh(), selectedId: null, undo: [], redo: [], measureOpen: true, measurementsCollapsed: false }); syncFields(); put({ view: "layout" }); refresh(); }
    }
    emit();
  }

  const actions = {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refreshDocument,
    picked,
    status: () => drawerStatus(state.draft),
    deactivate: act(invalidate),
    markEditing: act(() => { invalidate(); put({ editing: true }); }),
    setView: act(view => put({ view })),
    setMeasureOpen: act(open => put({ measureOpen: open })),
    announce: act(announce),
    select: act((id, reveal = false) => { put({ selectedId: id }); if (reveal) revealInspector(); }),
    revealInspector: act(revealInspector),
    gestureEnd: act((type, rect) => {
      if (!type) { refresh(); revealInspector(); return; }
      perform(() => { if (type === "draw") addPart(rect); else updateBin(rect); });
      revealInspector();
    }),
    updateBin: act(updateBin),
    newDrawer: act(() => {
      if (state.busy) return false;
      put({ selectedId: null, preview: null });
      commit(fresh(), "New drawer started. Undo layout restores the previous draft.");
      syncFields(); put({ view: "layout" }); return true;
    }),
    swap: act(() => perform(() => {
      const open = state.measureOpen;
      commit(rotateDrawerLayout(state.draft), "Width and depth swapped. Layout rotated 90° clockwise; usable height is unchanged.");
      syncFields(); put({ measureOpen: open, view: "layout" });
    })),
    addBin: act(() => perform(() => {
      const size = firstDrawerSpace(state.draft, 2, 2) ? 2 : 1, space = firstDrawerSpace(state.draft, size, size);
      if (!space) throw new Error("No empty space remains. Resize or remove a bin first.");
      addPart({ ...space, columns: size, rows: size });
    })),
    fill: act(() => perform(() => {
      const next = fillDrawerGaps(state.draft, nextBin);
      if (next.bins.length === state.draft.bins.length) return announce("The drawer grid is full.");
      put({ selectedId: next.bins.at(-1).id }); commit(next); revealInspector();
    })),
    undo: act(() => {
      if (!state.undo.length || state.busy) return false;
      const undo = [...state.undo], draft = undo.pop();
      put({ undo, redo: [...state.redo, copy(state.draft)], draft, selectedId: null });
      invalidate(); syncFields(); refresh(); announce("Layout change undone."); return true;
    }),
    redo: act(() => {
      if (!state.redo.length || state.busy) return false;
      const redo = [...state.redo], draft = redo.pop();
      put({ redo, undo: [...state.undo, copy(state.draft)], draft, selectedId: null });
      invalidate(); syncFields(); refresh(); announce("Layout change restored."); return true;
    }),
    setDimension: act((key, value) => {
      if (state.busy) return true;
      const next = copy(state.draft); next[key] = value;
      if (["width", "depth"].includes(key) && next.bins.some(bin => placementError(next, bin, bin.id))) {
        announce("Move or remove bins before making the drawer smaller.", true); return false;
      }
      commit(next); return true;
    }),
    setName: act(name => { const next = copy(state.draft); next.name = name; commit(next); }),
    setBaseplate: act(include => {
      const next = copy(state.draft); next.includeBaseplate = include;
      if (!include) { next.baseplateMagnets = false; next.baseplateClips = false; next.cornerSpacers = false; }
      commit(next);
    }),
    setClips: act(enabled => { if (state.busy) return; const next = copy(state.draft); next.baseplateClips = enabled; commit(next); }),
    setBaseMagnets: act(value => {
      invalidate();
      try { const next = copy(state.draft); next.baseplateMagnets = normalizeMagnetPockets(value); commit(next); }
      catch (error) { refresh(); announce(error.message, true); }
    }),
    setSpacers: act(value => {
      if (state.busy) return;
      try {
        const spacers = value ? normalizeCornerSpacers(value) : false;
        const next = copy(state.draft); next.cornerSpacers = spacers;
        if (spacers) cornerSpacerParts(next, drawerMetrics(next));
        commit(next);
      } catch (error) { announce(error.message, true); }
    }),
    example: act(() => {
      const next = fresh(); Object.assign(next, { width: 336, depth: 252, height: 50, name: "Example drawer" });
      put({ selectedId: null }); commit(next); syncFields(); announce("Example size loaded. Replace it with your own inside measurements.");
    }),
    removeBin: act(() => {
      const bin = picked(); if (!bin) return;
      const next = copy(state.draft); next.bins = next.bins.filter(entry => entry.id !== bin.id);
      put({ selectedId: null }); commit(next, "Bin removed. Undo layout restores it.");
    }),
    rotateBin: act(() => { const bin = picked(); if (bin) updateBin({ columns: bin.rows, rows: bin.columns, dividers: { x: bin.dividers.y, y: bin.dividers.x }, openSides: rotateOpenSides(bin.openSides) }); }),
    duplicateBin: act(() => perform(() => {
      const bin = picked(), space = firstDrawerSpace(state.draft, bin.columns, bin.rows); if (!space) throw new Error("No space for another bin of that size.");
      if (state.draft.bins.length >= 16) throw new Error("This layout supports up to 16 bins.");
      const next = copy(state.draft), other = { ...copy(bin), id: `bin-${++counter}`, label: `${bin.label} copy`.slice(0, 80), ...space };
      next.bins.push(other); normalizeDrawerLayout(next); put({ selectedId: other.id }); commit(next); revealInspector();
    })),
    setBinMagnets: act(value => { invalidate(); if (!updateBin({ magnets: value })) put({ editing: true }); }),
    magnetsForAll: act(() => {
      const bin = picked(); if (!bin) return;
      const next = copy(state.draft); next.bins.forEach(part => { part.magnets = copy(bin.magnets); });
      commit(next, "Magnet pockets enabled for all current bins.");
    }),
    loadLayout: act(load),
    async preview() {
      if (state.busy) return;
      invalidate(); setBusy(true); emit();
      try {
        const definition = normalizeDrawerLayout(state.draft), current = await request("get_document", {});
        definition.replaceExisting = current.drawerLayouts?.some(layout => layout.layoutId === definition.layoutId) === true;
        const preview = await request("preview_model", { expectedRevision: current.revision, includeImage: true, plan: { name: definition.name, mode: "advanced", operations: [definition] } });
        if (!preview.valid) throw new Error(preview.errors.map(entry => entry.error).join(". "));
        for (const body of preview.bodies) {
          const inspection = await request("inspect_geometry", { previewId: preview.previewId, bodyId: body.id, mesh: true });
          if (!inspection.meshValidation?.valid || inspection.meshValidation.disconnectedComponents !== 1) throw new Error(`${body.name} did not form one valid connected part.`);
        }
        put({
          cached: preview, stale: false, view: "preview",
          preview: { seq: ++previewSeq, previewId: preview.previewId, parts: preview.bodies.length, replaceExisting: definition.replaceExisting,
            image: preview.images?.find(image => image.view === "isometric"), rotated: preview.bodies.filter(body => body.printFit?.rotation === 90).length },
        });
        announce("Preview ready. The document is unchanged.");
      } catch (error) { announce(error.message, true); }
      finally { setBusy(false); emit(); }
    },
    async apply() {
      if (!state.cached || state.busy) return;
      const preview = state.cached; setBusy(true); emit();
      try {
        await request("apply_model", { previewId: preview.previewId });
        put({ cached: null, stale: false });
        await refreshDocument(await request("get_document", {}), false);
        put({ continueVisible: true }); announce("Layout added. Save the project to keep it; Undo restores the previous document.");
      } catch (error) { invalidate(); announce(error.message, true); }
      finally { setBusy(false); emit(); }
    },
    cancelPreview: act(() => { put({ cached: null, preview: null, view: "layout" }); announce("Preview cancelled. The document is unchanged."); }),
    getBinLimits: () => normalizeBinLimits(state.draft.binLimits),
    getPrintArea: () => normalizePrintArea(state.draft.printArea),
    setBinLimits: act((value, printArea = state.draft.printArea) => {
      if (state.busy) throw new Error("Wait for the current preview to finish.");
      const limits = normalizeBinLimits(value), { draft } = state;
      if (draft.bins.some(bin => bin.columns > limits.columns || bin.rows > limits.rows)) throw new Error("Existing bins exceed these limits. Resize or remove them, or start a new drawer first.");
      const next = copy(draft); next.binLimits = limits; next.printArea = normalizePrintArea(printArea);
      if (next.includeBaseplate) baseplateTileLimits(next.printArea);
      for (const bin of next.bins) checkPrintFit(next.printArea, binFootprint(bin).width, binFootprint(bin).depth, bin.kind === "bin" ? binTotalHeight({ ...bin, floor: next.floor }) : bin.heightUnits * 7, bin.label);
      if (drawerReady(draft) && (next.bins.length || next.includeBaseplate)) normalizeDrawerLayout(next);
      commit(next, "Settings updated. Preview again before applying."); preferredBinLimits = copy(limits); preferredPrintArea = copy(next.printArea);
      try { storage.setItem("jumpstart.gridfinity.binLimits", JSON.stringify(limits)); storage.setItem("jumpstart.gridfinity.printArea", JSON.stringify(next.printArea)); return "Settings saved for this drawer and new drawers in this browser."; }
      catch { return "Settings applied to this drawer. Browser preferences could not be saved."; }
    }),
  };
  return actions;
}
