import { el } from "../../src/util.js";
import { BIN_SIDES, rotateOpenSides, binTotalHeight } from "../shared/gridfinity-walls.js";
import { wallControls } from "./wall-controls.js";
import { iconLabel } from "./pictograms.js";
import { dimensionGuide } from "./dimension-guide.js";
import { drawerMetrics, normalizeDrawerLayout, placementError, firstDrawerSpace, fillDrawerGaps, DRAWER_LIMITS, drawerBinBaseZ } from "../shared/drawer-layout.js";
import { normalizeMagnetPockets, magnetCarrierHeight } from "../shared/gridfinity-magnets.js";
import { magnetControls } from "./magnet-controls.js";
import { normalizeBinLimits } from "../shared/gridfinity-limits.js";
import { normalizeCornerSpacers, cornerSpacerParts } from "../shared/drawer-spacers.js";
import { normalizePrintArea, baseplateTileLimits, checkPrintFit } from "../shared/print-area.js";

const uuid = () => `drawer-${crypto.randomUUID()}`;
const copy = value => structuredClone(value);

export function initDrawerPanel({ root, request, subscribe, onBusy, createPreviewView }) {
  let preferredBinLimits = normalizeBinLimits();
  let preferredPrintArea = false;
  try { const saved = localStorage.getItem("jumpstart.gridfinity.printArea"); if (saved) preferredPrintArea = normalizePrintArea(JSON.parse(saved)); } catch { /* Browser preferences are optional. */ }
  try { const saved = localStorage.getItem("jumpstart.gridfinity.binLimits"); if (saved) preferredBinLimits = normalizeBinLimits(JSON.parse(saved)); } catch { /* Browser preferences are optional. */ }
  let previewView = null;
  const disposePreviewView = () => { previewView?.dispose(); previewView = null; };
  let draft, selectedId = null, documentId = null, savedLayouts = [], counter = 0, cached = null, busy = false, gesture = null, view = "layout";
  let undo = [], redo = [], measurementsCollapsed = false;
  const fresh = () => ({ type: "drawerLayout", id: "drawer", layoutId: uuid(), name: "Drawer layout", width: 0, depth: 0, height: 0, includeBaseplate: true, baseplateMagnets: false, printArea: copy(preferredPrintArea), binLimits: copy(preferredBinLimits), floor: 2, wall: 1.2, bins: [] });
  draft = fresh();
  const field = (name, label, initial = "", step = "any") => {
    const id = `drawer-${name}`, input = el("input", { id, type: "number", min: name === "height" ? 14 : 42, max: name === "height" ? 10000 : 881.99, step, value: initial, required: true, "aria-describedby": "drawer-message" });
    return { input, label: el("label", { class: "ai-template-field", for: id }, el("span", {}, label), input) };
  };
  const message = el("p", { id: "drawer-message", class: "ai-template-message", role: "status", "aria-live": "polite" });
  const announce = (text, error = false) => { message.textContent = text; if (error) message.dataset.error = "true"; else delete message.dataset.error; };
  const title = el("input", { id: "drawer-name", type: "text", maxlength: 80, value: draft.name });
  const nameLabel = el("label", { class: "ai-template-field", for: "drawer-name" }, el("span", {}, "Drawer name"), title);
  const width = field("width", "Inside width (mm)"), depth = field("depth", "Inside depth (mm)"), height = field("height", "Usable height (mm)");
  const measurements = el("div", { class: "ai-template-fields" }, width.label, depth.label, height.label);
  const example = el("button", { type: "button", class: "drawer-example" }, "Try a 336 × 252 mm example");
  const fit = el("p", { id: "drawer-fit", class: "ai-template-note", "aria-live": "polite" });
  const spacerToggle = el("input", { id: "drawer-corner-spacers", type: "checkbox" });
  const spacerClearance = field("spacer-clearance", "Outer-edge clearance (mm)", 0.2, 0.1);
  const spacerHeight = field("spacer-height", "Spacer height (mm)", 5, 0.5);
  const spacerLeg = field("spacer-leg", "Contact leg length (mm)", 20, 1);
  for (const [control, min, max] of [[spacerClearance.input, 0, 1], [spacerHeight.input, 1, 12], [spacerLeg.input, 5, 60]]) { control.min = min; control.max = max; }
  const spacerFields = el("div", { class: "ai-template-fields", hidden: true }, spacerClearance.label, spacerHeight.label, spacerLeg.label);
  const spacerNote = el("p", { class: "ai-template-note", role: "status" });
  const spacerGroup = el("div", { class: "ai-template-group" }, el("label", { class: "ai-template-field", for: spacerToggle.id }, spacerToggle, el("span", {}, "Corner spacers")), spacerFields, spacerNote);
  const changeSpacers = () => {
    if (busy) return;
    try {
      const value = spacerToggle.checked ? normalizeCornerSpacers({ clearance: Number(spacerClearance.input.value), height: Number(spacerHeight.input.value), legLength: Number(spacerLeg.input.value) }) : false;
      const next = copy(draft); next.cornerSpacers = value;
      if (value) cornerSpacerParts(next, drawerMetrics(next));
      commit(next);
    } catch (error) { spacerToggle.checked = !!draft.cornerSpacers; announce(error.message, true); }
  };
  spacerToggle.onchange = changeSpacers;
  for (const input of spacerFields.querySelectorAll("input")) { input.oninput = () => { invalidate(); previewButton.disabled = true; }; input.onchange = () => { if ([...spacerFields.querySelectorAll("input")].every(input => input.validity.valid)) changeSpacers(); }; }
  const baseplate = el("input", { id: "drawer-baseplate", type: "checkbox" }); baseplate.checked = true;
  const baseplateField = el("label", { class: "ai-template-field", for: baseplate.id }, baseplate, el("span", {}, "Include matching baseplates"));
  const saved = el("section", { class: "drawer-saved", hidden: true });
  const inspector = el("section", { class: "drawer-inspector", "aria-label": "Selected bin" });
  const undoButton = el("button", { type: "button", disabled: true }, "Undo layout"), redoButton = el("button", { type: "button", disabled: true }, "Redo");
  const addBin = el("button", { type: "button" }, "Add bin"), fill = el("button", { type: "button" }, "Fill gaps");
  const previewButton = el("button", { type: "button", class: "ai-template-primary" }, "Preview layout");
  const partsSummary = el("p", { id: "drawer-summary", class: "ai-template-note", "aria-live": "polite" });
  const advancedFloor = field("floor", "Floor thickness (mm)", 2), advancedWall = field("wall", "Wall thickness (mm)", 1.2);
  advancedFloor.input.min = 0.8; advancedFloor.input.max = 6; advancedWall.input.min = 0.8; advancedWall.input.max = 4;
  const construction = el("details", { class: "drawer-advanced" }, el("summary", {}, "Advanced construction"), el("div", { class: "ai-template-fields" }, advancedFloor.label, advancedWall.label));
  construction.append(baseplateField);
  const baseMagnets = magnetControls({ id: "drawer-baseplate-magnets", label: "Baseplate magnet pockets",
    onInput: () => { invalidate(); previewButton.disabled = true; },
    onChange: value => {
      invalidate();
      try { const next = copy(draft); next.baseplateMagnets = normalizeMagnetPockets(value); commit(next); }
      catch (error) { render(); announce(error.message, true); }
    } });
  const carrierNote = el("p", { class: "ai-template-note", hidden: true });
  construction.append(baseMagnets.element, carrierNote);
  const measureSummary = el("summary", {}, "Drawer measurements");
  const newDrawer = el("button", { type: "button", title: "Clear the draft and enter new drawer measurements. Undo layout restores the previous draft." }, "New drawer");
  iconLabel(newDrawer, "add");
  iconLabel(construction.querySelector("summary"), "sketch");
  for (const [button, name] of [[undoButton, "undo"], [redoButton, "redo"], [addBin, "add"], [fill, "pattern"], [previewButton, "eye"]]) iconLabel(button, name);
  const measureDetails = el("details", { class: "drawer-measurements", open: true }, measureSummary, el("div", { class: "drawer-measure-fields" }, measurements, nameLabel));
  const binActions = el("div", { class: "ai-template-actions drawer-bin-actions" }, addBin, fill);
  const settings = el("div", { class: "ai-controls drawer-settings" }, el("div", { class: "drawer-view-toolbar" }, iconLabel(el("h3", {}, "Your drawer"), "grid"), newDrawer), saved, measureDetails, fit, spacerGroup,
    inspector, construction, message);
  const settingsShell = el("div", { class: "ai-template-settings" }, settings, el("div", { class: "ai-template-submit" }, previewButton));
  const board = el("div", { id: "drawer-board", class: "drawer-board", role: "group", "aria-label": "Drawer layout. Drag empty cells to draw a bin; drag a bin to move it." });
  const measureGuide = dimensionGuide({ title: "Start with the inside measurements", note: "Measure the clear space inside your drawer. Leave enough height for it to close." });
  const empty = el("div", { class: "drawer-empty" }, measureGuide.element, example);
  const ghost = el("div", { class: "drawer-ghost", hidden: true, "aria-hidden": "true" });
  const front = el("p", { class: "drawer-front" }, "Front of drawer");
  const boardArea = el("div", { class: "drawer-board-area" }, empty, board, front);
  const layoutView = el("div", { class: "drawer-layout-view" }, boardArea, partsSummary,
    el("p", { class: "ai-template-note" }, "Drag to draw or move a bin. Arrow keys move the selected bin; Shift + arrows resize it."));
  const imageArea = el("section", { class: "ai-template-preview drawer-3d", tabindex: "-1", hidden: true, "aria-label": "Drawer 3D preview" });
  const stale = el("p", { class: "ai-template-stale", hidden: true, role: "status" }, "Out of date. Preview the layout again before adding.");
  const add = el("button", { type: "button", class: "ai-template-primary", disabled: true }, "Add layout to document");
  const cancel = el("button", { type: "button" }, "Cancel preview");
  const continueButton = el("button", { type: "button", class: "ai-template-primary", hidden: true }, "Continue in editor");
  continueButton.onclick = () => document.getElementById("ai-setup-close").click();
  const layoutTab = el("button", { type: "button", "aria-pressed": "true" }, "Layout"), imageTab = el("button", { type: "button", "aria-pressed": "false", disabled: true }, "3D preview");
  iconLabel(layoutTab, "grid"); iconLabel(imageTab, "box");
  const progress = el("ol", { class: "ai-flow", "aria-label": "Make a drawer organizer" }, ...["Measure", "Arrange", "Review"].map(text => el("li", {}, text)));
  const review = el("div", { class: "ai-template-review drawer-review" }, progress,
    el("div", { class: "drawer-view-toolbar" }, el("div", { class: "ai-template-shapes", role: "group", "aria-label": "Drawer view" }, layoutTab, imageTab), binActions, el("div", { class: "ai-template-actions" }, undoButton, redoButton)), layoutView, imageArea);
  root.append(settingsShell, review);

  function setView(next) {
    view = next;
    progress.querySelectorAll("li").forEach((step, index) => { if (index === (next === "preview" ? 2 : ready() ? 1 : 0)) step.setAttribute("aria-current", "step"); else step.removeAttribute("aria-current"); });
    layoutView.hidden = next !== "layout"; imageArea.hidden = next !== "preview";
    layoutTab.setAttribute("aria-pressed", String(next === "layout")); imageTab.setAttribute("aria-pressed", String(next === "preview"));
  }
  layoutTab.onclick = () => setView("layout"); imageTab.onclick = () => setView("preview");
  const invalidate = () => { cached = null; add.disabled = true; continueButton.hidden = true; previewButton.classList.add("ai-template-primary"); if (imageArea.childElementCount) stale.hidden = false; };
  newDrawer.onclick = () => {
    if (busy) return;
    selectedId = null; gesture = null; ghost.hidden = true;
    disposePreviewView(); imageArea.replaceChildren(); imageTab.disabled = true;
    commit(fresh(), "New drawer started. Undo layout restores the previous draft.");
    syncFields(); setView("layout"); width.input.focus();
  };
  function remember() { undo.push(copy(draft)); if (undo.length > 50) undo.shift(); redo = []; }
  function ready() { const m = drawerMetrics(draft); return m.columns > 0 && m.rows > 0 && m.columns <= 20 && m.rows <= 20 && Number.isFinite(draft.height) && draft.height >= 14; }
  function commit(next, text = "") {
    const newDrawer = next.layoutId !== draft.layoutId;
    remember(); draft = next;
    if (newDrawer) { measurementsCollapsed = false; measureDetails.open = true; }
    if (ready() && draft.bins.length && !measurementsCollapsed) { measureDetails.open = false; measurementsCollapsed = true; }
    invalidate(); announce(text); render();
  }
  const picked = () => draft.bins.find(bin => bin.id === selectedId);
  const focusBin = id => [...board.querySelectorAll("[data-bin-id]")].find(button => button.dataset.binId === id)?.focus();
  const nextBin = rect => ({ id: `bin-${++counter}`, label: `Bin ${counter}`, ...rect, heightUnits: Math.max(2, Math.min(3, Math.floor(Math.min(draft.height - drawerBinBaseZ(draft), normalizePrintArea(draft.printArea)?.height ?? Infinity) / 7))), kind: "bin", dividers: { x: 0, y: 0 }, lip: false, magnets: false });
  function updateBin(changes) {
    const bin = picked(); if (!bin || busy) return false;
    const candidate = { ...bin, ...changes }, next = copy(draft);
    if (JSON.stringify(candidate) === JSON.stringify(bin)) { render(); return true; }
    const error = placementError(draft, candidate, bin.id);
    if (error) { announce(error, true); return false; }
    next.bins[next.bins.findIndex(entry => entry.id === bin.id)] = candidate;
    try { normalizeDrawerLayout({ ...next, bins: [candidate] }); } catch (error) { announce(error.message, true); return false; }
    commit(next); return true;
  }
  function perform(action) { if (busy) return; try { action(); } catch (error) { announce(error.message, true); } }
  function addPart(rect) {
    if (draft.bins.length >= DRAWER_LIMITS.bins) throw new Error("This layout supports up to 16 bins.");
    const error = placementError(draft, rect); if (error) throw new Error(error);
    const next = copy(draft), bin = nextBin(rect); next.bins.push(bin); normalizeDrawerLayout(next); selectedId = bin.id; commit(next); revealInspector();
  }
  addBin.onclick = () => perform(() => {
    const size = firstDrawerSpace(draft, 2, 2) ? 2 : 1, space = firstDrawerSpace(draft, size, size);
    if (!space) throw new Error("No empty space remains. Resize or remove a bin first.");
    addPart({ ...space, columns: size, rows: size });
  });
  fill.onclick = () => perform(() => { const next = fillDrawerGaps(draft, nextBin); if (next.bins.length === draft.bins.length) return announce("The drawer grid is full."); selectedId = next.bins.at(-1).id; commit(next); revealInspector(); });
  undoButton.onclick = () => { if (!undo.length || busy) return; redo.push(copy(draft)); draft = undo.pop(); selectedId = null; invalidate(); syncFields(); render(); announce("Layout change undone."); };
  redoButton.onclick = () => { if (!redo.length || busy) return; undo.push(copy(draft)); draft = redo.pop(); selectedId = null; invalidate(); syncFields(); render(); announce("Layout change restored."); };
  root.addEventListener("keydown", event => {
    if (event.key === "Escape") return;
    const typing = ["INPUT", "TEXTAREA"].includes(event.target.tagName);
    if ((event.ctrlKey || event.metaKey) && !typing && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (event.key.toLowerCase() === "y" || event.shiftKey) redoButton.onclick(); else undoButton.onclick();
    }
    // Draft navigation must not nudge or undo selected native CAD bodies behind the panel.
    event.stopPropagation();
  });
  function syncFields() {
    counter = draft.bins.reduce((max, bin) => Math.max(max, Number(bin.id.match(/\d+$/)?.[0]) || 0), 0);
    title.value = draft.name; width.input.value = draft.width || ""; depth.input.value = draft.depth || ""; height.input.value = draft.height || "";
    baseplate.checked = draft.includeBaseplate; advancedFloor.input.value = draft.floor; advancedWall.input.value = draft.wall;
    baseMagnets.set(draft.baseplateMagnets || false);
    spacerToggle.checked = !!draft.cornerSpacers;
    const spacerOptions = normalizeCornerSpacers(draft.cornerSpacers || true);
    spacerClearance.input.value = spacerOptions.clearance; spacerHeight.input.value = spacerOptions.height; spacerLeg.input.value = spacerOptions.legLength;
    for (const input of [width.input, depth.input, height.input, advancedFloor.input, advancedWall.input]) {
      if (input.value) input.setAttribute("aria-invalid", String(!input.validity.valid)); else input.removeAttribute("aria-invalid");
    }
  }
  for (const [control, key] of [[width.input, "width"], [depth.input, "depth"], [height.input, "height"], [advancedFloor.input, "floor"], [advancedWall.input, "wall"]]) {
    control.onchange = () => {
      if (busy) return;
      const next = copy(draft); next[key] = Number(control.value);
      control.setAttribute("aria-invalid", String(!control.validity.valid));
      if (["width", "depth"].includes(key) && next.bins.some(bin => placementError(next, bin, bin.id))) {
        control.value = draft[key]; announce("Move or remove bins before making the drawer smaller.", true); return;
      }
      commit(next);
    };
  }
  title.onchange = () => { const next = copy(draft); next.name = title.value; commit(next); };
  baseplate.onchange = () => { const next = copy(draft); next.includeBaseplate = baseplate.checked; if (!next.includeBaseplate) { next.baseplateMagnets = false; next.cornerSpacers = false; spacerToggle.checked = false; baseMagnets.set(false); } commit(next); };
  example.onclick = () => { const next = fresh(); Object.assign(next, { width: 336, depth: 252, height: 50, name: "Example drawer" }); selectedId = null; commit(next); syncFields(); announce("Example size loaded. Replace it with your own inside measurements."); };

  function renderInspector() {
    const active = document.activeElement;
    const focus = inspector.contains(active) ? { id: active.id, label: active.getAttribute("aria-label"), text: active.textContent, group: active.closest('[role="group"]')?.getAttribute("aria-label") } : null;
    const moreOpen = inspector.dataset.selectedBinId === selectedId && inspector.querySelector("details.drawer-advanced")?.open;
    const wallsOpen = inspector.dataset.selectedBinId === selectedId ? inspector.querySelector(".drawer-wall-options")?.open : undefined;
    const compartmentsOpen = inspector.dataset.selectedBinId === selectedId ? inspector.querySelector(".drawer-compartment-options")?.open : undefined;
    inspector.replaceChildren();
    inspector.dataset.selectedBinId = selectedId || "";
    const bin = picked();
    const nextInspector = bin ? saved : construction;
    if (inspector.nextElementSibling !== nextInspector) settings.insertBefore(inspector, nextInspector);
    const nextMeasurements = bin ? inspector : fit;
    if (measureDetails.nextElementSibling !== nextMeasurements) settings.insertBefore(measureDetails, nextMeasurements);
    if (!bin) { inspector.append(el("h3", {}, "Make room for your things"), el("p", { class: "ai-template-note" }, draft.bins.length ? "Select a bin on the drawer to adjust it." : draft.includeBaseplate ? "Choose Add bin, or drag across the grid to draw one. You can also preview just the baseplates." : "Draw a rectangle on the grid or choose Add bin.")); return; }
    const label = el("input", { id: "drawer-bin-label", type: "text", maxlength: 80, value: bin.label, disabled: busy });
    label.onchange = () => updateBin({ label: label.value });
    const inspectorHeader = el("div", { class: "drawer-inspector-header" }, iconLabel(el("h3", {}, bin.label), "box"));
    inspector.append(inspectorHeader, el("label", { class: "ai-template-field", for: label.id }, el("span", {}, "Name"), label));
    const stepper = (key, title, mm) => {
      const minus = el("button", { type: "button", "aria-label": `Decrease ${title.toLowerCase()}`, disabled: busy || bin[key] <= 1 }, "−");
      let printable = true;
      try { checkPrintFit(draft.printArea, (bin.columns + (key === "columns" ? 1 : 0)) * 42 - 0.5, (bin.rows + (key === "rows" ? 1 : 0)) * 42 - 0.5, binTotalHeight({ ...bin, floor: draft.floor }), bin.label); } catch { printable = false; }
      const plus = el("button", { type: "button", "aria-label": `Increase ${title.toLowerCase()}`, disabled: busy || !printable || bin[key] >= normalizeBinLimits(draft.binLimits)[key] }, "+");
      minus.onclick = () => updateBin({ [key]: bin[key] - 1 }); plus.onclick = () => updateBin({ [key]: bin[key] + 1 });
      return el("div", { class: "drawer-stepper" }, el("span", {}, title), el("div", {}, minus, el("output", {}, `${bin[key]} cells`), plus), el("small", {}, `${mm.toFixed(1)} mm`));
    };
    inspector.append(el("div", { class: "ai-template-fields" }, stepper("columns", "Width", bin.columns * 42 - 0.5), stepper("rows", "Depth", bin.rows * 42 - 0.5)));
    const kinds = el("div", { class: "ai-template-shapes", role: "group", "aria-label": "Part type" });
    for (const [kind, text] of [["bin", "Storage bin"], ["insert", "Insert blank"]]) {
      const button = el("button", { type: "button", disabled: busy, "aria-pressed": String(bin.kind === kind) }, text);
      button.onclick = () => updateBin({ kind, ...(kind === "insert" ? { dividers: { x: 0, y: 0 }, lip: false, openSides: [] } : {}) }); kinds.append(button);
    }
    inspector.append(el("span", {}, "Height"));
    const heights = el("div", { class: "ai-template-shapes", role: "group", "aria-label": "Bin height" });
    for (const units of [...new Set([2, 3, 5, 7, bin.heightUnits])].sort((a, b) => a - b)) {
      const partHeight = binTotalHeight({ ...bin, heightUnits: units, floor: draft.floor });
      const total = partHeight + drawerBinBaseZ(draft);
      const button = el("button", { type: "button", disabled: busy || total > draft.height || partHeight > (normalizePrintArea(draft.printArea)?.height ?? Infinity), "aria-pressed": String(bin.heightUnits === units) }, `${units * 7} mm`);
      button.onclick = () => updateBin({ heightUnits: units }); heights.append(button);
    }
    inspector.append(heights);
    if (bin.kind === "bin") {
      const walls = wallControls({ value: bin.openSides, onChange: openSides => { if (!updateBin({ openSides })) render(); } });
      walls.setDisabled(busy); walls.element.querySelector("h4").remove();
      const names = (bin.openSides || []).map(side => side[0].toUpperCase() + side.slice(1));
      inspector.append(el("details", { class: "drawer-wall-options", open: wallsOpen ?? names.length > 0 }, iconLabel(el("summary", {}, names.length ? `Open sides: ${names.join(", ")}` : "Open sides"), "shell"), walls.element));
      const compartments = el("div", { class: "drawer-compartments" });
      for (const [axis, label] of [["x", "Across width"], ["y", "Along depth"]]) {
        const choices = el("div", { class: "ai-template-shapes", role: "group", "aria-label": `${label} compartments` });
        for (const count of [1, 2, 3]) {
          const button = el("button", { type: "button", disabled: busy, "aria-pressed": String(bin.dividers[axis] === count - 1) }, `${count}`);
          button.onclick = () => updateBin({ dividers: { ...bin.dividers, [axis]: count - 1 } }); choices.append(button);
        }
        compartments.append(el("span", {}, label), choices);
      }
      const divided = bin.dividers.x || bin.dividers.y;
      inspector.append(el("details", { class: "drawer-compartment-options", open: compartmentsOpen ?? !!divided }, iconLabel(el("summary", {}, divided ? `Compartments: ${bin.dividers.x + 1} × ${bin.dividers.y + 1}` : "Compartments"), "grid"), compartments));
    }
    const rotate = el("button", { type: "button", disabled: busy }, "Rotate"), duplicate = el("button", { type: "button", disabled: busy }, "Duplicate"), remove = el("button", { type: "button", class: "ai-template-remove", disabled: busy }, "Remove bin");
    rotate.onclick = () => updateBin({ columns: bin.rows, rows: bin.columns, dividers: { x: bin.dividers.y, y: bin.dividers.x }, openSides: rotateOpenSides(bin.openSides) });
    duplicate.onclick = () => perform(() => {
      const space = firstDrawerSpace(draft, bin.columns, bin.rows); if (!space) throw new Error("No space for another bin of that size.");
      if (draft.bins.length >= 16) throw new Error("This layout supports up to 16 bins.");
      const next = copy(draft), other = { ...copy(bin), id: `bin-${++counter}`, label: `${bin.label} copy`.slice(0, 80), ...space }; next.bins.push(other); normalizeDrawerLayout(next); selectedId = other.id; commit(next); revealInspector();
    });
    remove.onclick = () => { const next = copy(draft); next.bins = next.bins.filter(entry => entry.id !== bin.id); selectedId = null; commit(next, "Bin removed. Undo layout restores it."); addBin.focus(); };
    for (const [button, name] of [[rotate, "rotate"], [duplicate, "duplicate"], [remove, "del"]]) iconLabel(button, name);
    inspectorHeader.append(el("div", { class: "ai-template-actions" }, rotate, duplicate, remove));
    const binMagnets = magnetControls({ id: "drawer-bin-magnets", label: "Magnet pockets under this part",
      onInput: () => { invalidate(); previewButton.disabled = true; },
      onChange: value => { invalidate(); if (!updateBin({ magnets: value })) previewButton.disabled = true; } });
    binMagnets.set(bin.magnets || false); binMagnets.setDisabled(busy);
    const allMagnets = el("button", { type: "button", disabled: busy || !bin.magnets }, "Use this magnet fit in all bins");
    allMagnets.onclick = () => { const next = copy(draft); next.bins.forEach(part => { part.magnets = copy(bin.magnets); }); commit(next, "Magnet pockets enabled for all current bins."); };
    inspector.append(el("details", { class: "drawer-advanced", open: moreOpen || null }, el("summary", {}, "More bin options"), kinds, binMagnets.element, allMagnets));
    if (focus) {
      const target = focus.id ? document.getElementById(focus.id) : [...inspector.querySelectorAll("button")].find(button =>
        focus.label ? button.getAttribute("aria-label") === focus.label : button.textContent === focus.text && button.closest('[role="group"]')?.getAttribute("aria-label") === focus.group);
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  }
  function position(element, bin, metrics) {
    element.style.left = `${bin.x / metrics.columns * 100}%`; element.style.bottom = `${bin.y / metrics.rows * 100}%`;
    element.style.width = `${bin.columns / metrics.columns * 100}%`; element.style.height = `${bin.rows / metrics.rows * 100}%`;
  }
  function renderBoard() {
    board.replaceChildren(); const metrics = drawerMetrics(draft);
    board.hidden = !ready(); front.hidden = !ready(); empty.hidden = ready();
    if (!ready()) return;
    board.style.setProperty("--drawer-columns", metrics.columns); board.style.setProperty("--drawer-rows", metrics.rows); board.style.aspectRatio = `${metrics.columns} / ${metrics.rows}`;
    for (const bin of draft.bins) {
      const error = placementError(draft, bin, bin.id);
      const button = el("button", { type: "button", class: "drawer-bin", "data-bin-id": bin.id, "data-compact": String(bin.columns === 1 && bin.rows === 1), "aria-pressed": String(selectedId === bin.id), title: `${bin.label} · ${bin.columns} × ${bin.rows}`, "aria-label": `${bin.label}, ${bin.columns} by ${bin.rows} cells. Arrow keys move; Shift and arrows resize.`, disabled: busy }, el("span", { class: "drawer-bin-index" }, String(draft.bins.indexOf(bin) + 1)), el("strong", {}, bin.label), el("small", {}, `${bin.columns} × ${bin.rows}`));
      const openSides = bin.openSides || [];
      for (const side of BIN_SIDES) button.dataset[`open${side[0].toUpperCase() + side.slice(1)}`] = String(openSides.includes(side));
      button.dataset.openSides = String(openSides.length > 0);
      if (openSides.length) {
        button.title += `. Open sides: ${openSides.join(", ")}.`;
        button.setAttribute("aria-label", `${button.getAttribute("aria-label")} Open sides: ${openSides.join(", ")}.`);
      }
      position(button, bin, metrics); if (error) button.dataset.invalid = "true";
      if (selectedId === bin.id) button.append(el("span", { class: "drawer-resize", "data-resize": "true", "aria-hidden": "true" }));
      button.onkeydown = event => {
        if (busy) return;
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] }, direction = directions[event.key];
        if (direction) {
          event.preventDefault(); selectedId = bin.id;
          const change = event.shiftKey ? { columns: bin.columns + direction[0], rows: bin.rows + direction[1] } : { x: bin.x + direction[0], y: bin.y + direction[1] };
          updateBin(change); focusBin(bin.id);
        } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectedId = bin.id; renderInspector(); renderSelection(); revealInspector(); }
      };
      board.append(button);
    }
    board.append(ghost);
  }
  function renderSelection() { board.querySelectorAll("[data-bin-id]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.binId === selectedId))); }
  function revealInspector() {
    if (!picked()) return;
    measureDetails.open = false; measurementsCollapsed = true;
    settings.scrollTop = 0;
  }
  function render() {
    const validDimensions = ready(), m = drawerMetrics(draft);
    iconLabel(measureSummary, "dim", validDimensions ? `${draft.name} · ${draft.width} × ${draft.depth} × ${draft.height} mm` : "Drawer measurements");
    example.hidden = validDimensions;
    measureGuide.update({ width: draft.width, depth: draft.depth, height: draft.height, kind: "drawer" });
    inspector.hidden = !validDimensions; construction.hidden = !validDimensions; spacerGroup.hidden = !validDimensions; binActions.hidden = !validDimensions;
    progress.querySelectorAll("li").forEach((step, index) => { if (index === (view === "preview" ? 2 : validDimensions ? 1 : 0)) step.setAttribute("aria-current", "step"); else step.removeAttribute("aria-current"); });
    fit.textContent = validDimensions ? `${m.columns} × ${m.rows} grid · ${m.gridWidth} × ${m.gridDepth} mm. Spare space: ${(m.spareWidth / 2).toFixed(1)} mm per side, ${(m.spareDepth / 2).toFixed(1)} mm front/back.` : "Enter the drawer’s inside measurements in millimetres.";
    const magnetCount = draft.bins.reduce((sum, bin) => sum + (bin.magnets ? bin.columns * bin.rows * 4 : 0), 0) + (draft.includeBaseplate && draft.baseplateMagnets ? m.total * 4 : 0);
    partsSummary.textContent = validDimensions ? `${draft.bins.length} bins · ${m.occupied} of ${m.total} cells used (${m.fill}%).${draft.includeBaseplate ? " Matching baseplates included." : ""}${magnetCount ? ` ${magnetCount} magnet pockets.` : ""}` : "";
    if (validDimensions && !draft.bins.length && draft.includeBaseplate) partsSummary.textContent = `Baseplates only · ${m.total} grid cells.${magnetCount ? ` ${magnetCount} magnet pockets.` : ""}`;
    if (validDimensions && draft.bins.some(bin => bin.openSides?.length)) partsSummary.textContent += " Dashed edges are open.";
    let error; try { normalizeDrawerLayout(draft); } catch (failure) { error = failure.message; }
    spacerToggle.checked = !!draft.cornerSpacers; spacerToggle.disabled = busy || !draft.includeBaseplate || !validDimensions;
    spacerFields.hidden = !draft.cornerSpacers;
    for (const input of spacerFields.querySelectorAll("input")) input.disabled = busy || !draft.cornerSpacers;
    spacerNote.textContent = "";
    if (draft.cornerSpacers) {
      try { const parts = cornerSpacerParts(draft, m); spacerNote.textContent = parts.length ? `${parts.length} separate flat-bottom spacers, ${draft.cornerSpacers.height} mm tall. Test printed fit before making all four.` : "The grid fills the drawer; no spacers are needed."; }
      catch (failure) { error = failure.message; spacerNote.textContent = failure.message; }
    }
    baseMagnets.setDisabled(busy || !draft.includeBaseplate);
    carrierNote.hidden = !draft.baseplateMagnets;
    if (draft.baseplateMagnets) { const lift = magnetCarrierHeight(draft.baseplateMagnets); carrierNote.textContent = `Magnet carrier adds ${lift.toFixed(1)} mm. Baseplate height: ${(5 + lift).toFixed(1)} mm. Bin seating height is included in drawer-fit checks.`; }
    previewButton.classList.toggle("ai-template-primary", !cached && continueButton.hidden);
    previewButton.disabled = busy || !!error || !baseMagnets.valid() || !!draft.cornerSpacers && ![...spacerFields.querySelectorAll("input")].every(input => input.validity.valid); previewButton.title = error || "";
    addBin.disabled = busy || !validDimensions || draft.bins.length >= 16; fill.disabled = busy || !validDimensions;
    undoButton.disabled = busy || !undo.length; redoButton.disabled = busy || !redo.length;
    const supplied = [draft.width, draft.depth, draft.height].every(value => Number.isFinite(value) && value > 0);
    if ((draft.bins.length || supplied) && error) announce(error, true);
    renderInspector(); renderBoard();
  }
  const cell = event => {
    const rect = board.getBoundingClientRect(), m = drawerMetrics(draft);
    return { x: Math.floor((event.clientX - rect.left) / rect.width * m.columns), y: m.rows - 1 - Math.floor((event.clientY - rect.top) / rect.height * m.rows) };
  };
  function candidate(point) {
    const start = gesture.start, bin = gesture.bin;
    if (gesture.type === "draw") return { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), columns: Math.abs(start.x - point.x) + 1, rows: Math.abs(start.y - point.y) + 1 };
    if (gesture.type === "move") return { ...bin, x: bin.x + point.x - start.x, y: bin.y + point.y - start.y };
    return { ...bin, columns: Math.max(1, point.x - bin.x + 1), rows: Math.max(1, bin.y + bin.rows - point.y), y: Math.min(point.y, bin.y + bin.rows - 1) };
  }
  board.onpointerdown = event => {
    if (busy || event.button !== 0 || !ready()) return;
    const target = event.target.closest("[data-bin-id]"), bin = target && draft.bins.find(bin => bin.id === target.dataset.binId);
    if (bin) { selectedId = bin.id; renderInspector(); renderSelection(); }
    gesture = { pointerId: event.pointerId, start: cell(event), bin: bin && copy(bin), type: !bin ? "draw" : event.target.closest("[data-resize]") ? "resize" : "move" };
    board.setPointerCapture(event.pointerId); event.preventDefault();
  };
  board.onpointermove = event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const next = candidate(cell(event)), error = placementError(draft, next, gesture.bin?.id);
    position(ghost, next, drawerMetrics(draft)); ghost.hidden = false; ghost.dataset.invalid = String(!!error); ghost.textContent = error ? "Doesn’t fit" : `${next.columns} × ${next.rows}`;
  };
  board.onpointerup = event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const active = gesture, next = candidate(cell(event)); gesture = null; ghost.hidden = true;
    if (board.hasPointerCapture(event.pointerId)) board.releasePointerCapture(event.pointerId);
    if (active.type === "move" && next.x === active.bin.x && next.y === active.bin.y) { render(); revealInspector(); focusBin(selectedId); return; }
    perform(() => { if (active.type === "draw") addPart(next); else updateBin(next); });
    revealInspector(); focusBin(selectedId);
  };
  board.onpointercancel = () => { gesture = null; ghost.hidden = true; };

  function setBusy(active) {
    busy = active; onBusy(active); root.setAttribute("aria-busy", String(active));
    for (const input of settings.querySelectorAll("input,button")) input.disabled = active;
    add.disabled = active || !cached; cancel.disabled = active; iconLabel(previewButton, "eye", active ? "Building preview…" : "Preview layout");
    render();
  }
  previewButton.onclick = async () => {
    if (busy) return;
    invalidate(); setBusy(true);
    try {
      const definition = normalizeDrawerLayout(draft), current = await request("get_document", {});
      definition.replaceExisting = current.drawerLayouts?.some(layout => layout.layoutId === definition.layoutId) === true;
      const preview = await request("preview_model", { expectedRevision: current.revision, includeImage: true, plan: { name: definition.name, mode: "advanced", operations: [definition] } });
      if (!preview.valid) throw new Error(preview.errors.map(entry => entry.error).join(". "));
      for (const body of preview.bodies) {
        const inspection = await request("inspect_geometry", { previewId: preview.previewId, bodyId: body.id, mesh: true });
        if (!inspection.meshValidation?.valid || inspection.meshValidation.disconnectedComponents !== 1) throw new Error(`${body.name} did not form one valid connected part.`);
      }
      cached = preview; imageTab.disabled = false; stale.hidden = true;
      disposePreviewView();
      const reviewTitle = el("h3", { tabindex: "-1" }, "Review drawer layout");
      const previewContent = el("div", { class: "ai-preview-content" }, reviewTitle, stale);
      imageArea.replaceChildren(previewContent);
      const image = preview.images?.find(image => image.view === "isometric");
      try { previewView = createPreviewView(preview.previewId); previewContent.append(previewView.element); }
      catch { if (image) previewContent.append(el("img", { src: image.dataUrl, alt: "3D preview of the proposed drawer bins and baseplates" }), el("p", { class: "ai-template-note" }, "Interactive view unavailable. Showing the preview image.")); }
      const footer = el("div", { class: "ai-preview-footer" }, el("p", { class: "ai-template-note" }, `${preview.bodies.length} editable parts. Printed fit remains unverified.`), el("div", { class: "ai-template-actions" }, add, cancel, continueButton));
      imageArea.append(footer);
      const rotated = preview.bodies.filter(body => body.printFit?.rotation === 90);
      if (rotated.length) footer.prepend(el("p", { class: "ai-template-note" }, `${rotated.length} part(s) need a 90° turn on the print bed. Drawer assembly positions are unchanged.`));
      add.textContent = definition.replaceExisting ? "Update layout in document" : "Add layout to document";
      setView("preview"); reviewTitle.focus(); announce("Preview ready. The document is unchanged.");
    } catch (error) { announce(error.message, true); }
    finally { setBusy(false); }
  };
  add.onclick = async () => {
    if (!cached || busy) return;
    const preview = cached; setBusy(true);
    try { await request("apply_model", { previewId: preview.previewId }); cached = null; add.disabled = true; stale.hidden = true; await refreshDocument(await request("get_document", {}), false); continueButton.hidden = false; announce("Layout added. Save the project to keep it; Undo restores the previous document."); }
    catch (error) { invalidate(); announce(error.message, true); }
    finally { setBusy(false); }
  };
  cancel.onclick = () => { cached = null; add.disabled = true; disposePreviewView(); imageArea.replaceChildren(); imageTab.disabled = true; setView("layout"); previewButton.focus(); announce("Preview cancelled. The document is unchanged."); };
  async function refreshDocument(current, autoLoad = true) {
    const changedDocument = documentId !== current.document.id;
    documentId = current.document.id; savedLayouts = current.drawerLayouts || [];
    saved.replaceChildren(); saved.hidden = !savedLayouts.length;
    if (savedLayouts.length) saved.append(el("span", {}, "Saved drawer layouts"));
    const load = entry => {
      if (!entry.editable) return announce("This layout has native edits or missing parts. Keep those edits or start a new drawer.", true);
      draft = copy(entry.definition); selectedId = null; undo = []; redo = []; counter = draft.bins.reduce((max, bin) => Math.max(max, Number(bin.id.match(/\d+$/)?.[0]) || 0), 0);
      measureDetails.open = false; measurementsCollapsed = true;
      invalidate(); syncFields(); setView("layout"); render(); announce("Layout loaded. Changes need a new preview before updating the document.");
    };
    for (const entry of savedLayouts) { const button = el("button", { type: "button" }, entry.definition.name); button.onclick = () => load(entry); saved.append(button); }
    if (changedDocument) {
      disposePreviewView();
      cached = null; imageArea.replaceChildren(); imageTab.disabled = true;
      if (autoLoad && savedLayouts.length === 1 && savedLayouts[0].editable) load(savedLayouts[0]);
      else { draft = fresh(); selectedId = null; undo = []; redo = []; measureDetails.open = true; measurementsCollapsed = false; syncFields(); setView("layout"); render(); }
    }
  }
  subscribe(kind => { if (!["preview", "version"].includes(kind)) { invalidate(); } });
  render();
  return { refreshDocument, deactivate: invalidate,
    getBinLimits: () => normalizeBinLimits(draft.binLimits),
    getPrintArea: () => normalizePrintArea(draft.printArea),
    setBinLimits(value, printArea = draft.printArea) {
      if (busy) throw new Error("Wait for the current preview to finish.");
      const limits = normalizeBinLimits(value);
      if (draft.bins.some(bin => bin.columns > limits.columns || bin.rows > limits.rows)) throw new Error("Existing bins exceed these limits. Resize or remove them, or start a new drawer first.");
      const next = copy(draft); next.binLimits = limits; next.printArea = normalizePrintArea(printArea);
      if (next.includeBaseplate) baseplateTileLimits(next.printArea);
      for (const bin of next.bins) checkPrintFit(next.printArea, bin.columns * 42 - 0.5, bin.rows * 42 - 0.5, bin.kind === "bin" ? binTotalHeight({ ...bin, floor: next.floor }) : bin.heightUnits * 7, bin.label);
      if (ready() && (next.bins.length || next.includeBaseplate)) normalizeDrawerLayout(next);
      commit(next, "Settings updated. Preview again before applying."); preferredBinLimits = copy(limits); preferredPrintArea = copy(next.printArea);
      try { localStorage.setItem("jumpstart.gridfinity.binLimits", JSON.stringify(limits)); localStorage.setItem("jumpstart.gridfinity.printArea", JSON.stringify(next.printArea)); return "Settings saved for this drawer and new drawers in this browser."; }
      catch { return "Settings applied to this drawer. Browser preferences could not be saved."; }
    } };
}
