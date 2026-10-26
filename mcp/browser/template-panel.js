import { el } from "../../src/util.js";
import { wallControls } from "./wall-controls.js";
import { binFootprint, binTotalHeight } from "../shared/gridfinity-walls.js";
import { iconLabel } from "./pictograms.js";
import { dimensionGuide } from "./dimension-guide.js";
import { initDrawerPanel } from "./drawer-panel.js";
import { magnetControls } from "./magnet-controls.js";
import { magnetCarrierHeight } from "../shared/gridfinity-magnets.js";
import { GRIDFINITY_LIMITS } from "../shared/gridfinity-limits.js";
import { PRINT_AREA_PRESETS, normalizePrintArea, baseplateTileLimits, checkPrintFit } from "../shared/print-area.js";

const TEMPLATES = [
  ["insert", "Custom insert", "A solid blank with measured pockets"],
  ["bin", "Bin", "Open storage with optional dividers"],
  ["baseplate", "Baseplate", "A matching grid for your drawer"],
];
const value = input => Number(input.value);
const revealInvalid = form => {
  const invalid = [...form.querySelectorAll("input")].find(input => !input.disabled && !input.validity.valid);
  if (invalid) {
    for (let parent = invalid.parentElement; parent && parent !== form; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
    invalid.setAttribute("aria-invalid", "true");
  }
  return form.reportValidity();
};

export function templatePlan(state) {
  const parameters = {};
  const number = (name, amount, unit = "mm") => {
    parameters[name] = { value: amount, unit };
    return { $expr: name };
  };
  const grid = {
    id: "base", type: "gridfinity", kind: state.kind,
    columns: number("columns", state.columns, "count"), rows: number("rows", state.rows, "count"),
  };
  if (state.kind !== "baseplate") {
    grid.heightUnits = number("heightUnits", state.heightUnits, "count");
    grid.floor = number("floor", state.floor);
    grid.wall = number("wall", state.wall);
  }
  if (state.kind === "bin") {
    grid.openSides = state.openSides || [];
    grid.closeGaps = state.closeGaps === true;
    grid.lip = state.lip;
    grid.dividers = { x: number("dividersX", state.dividersX, "count"), y: number("dividersY", state.dividersY, "count") };
  }
  if (state.magnets) grid.magnets = { diameter: number("magnetPocketDiameter", state.magnets.diameter), depth: number("magnetPocketDepth", state.magnets.depth) };
  const operations = [grid];
  if (state.kind === "insert") for (const [index, pocket] of state.pockets.entries()) {
    const prefix = `pocket${index + 1}`;
    const profile = { type: pocket.shape };
    if (pocket.shape === "circle") profile.radius = number(`${prefix}Radius`, pocket.width / 2);
    else if (pocket.shape === "capsule") {
      profile.length = number(`${prefix}Length`, pocket.width);
      profile.width = number(`${prefix}Width`, pocket.height);
    } else {
      profile.width = number(`${prefix}Width`, pocket.width);
      profile.height = number(`${prefix}Length`, pocket.height);
      profile.radius = number(`${prefix}Radius`, pocket.radius);
    }
    operations.push({ id: prefix, type: "pocket", target: "base", profile,
      position: [number(`${prefix}X`, pocket.x), number(`${prefix}Y`, pocket.y)],
      rotation: number(`${prefix}Angle`, pocket.rotation, "deg"), depth: number(`${prefix}Depth`, pocket.depth),
      clearance: number(`${prefix}Clearance`, pocket.clearance),
      minimumFloor: number(`${prefix}Floor`, state.floor), minimumWall: number(`${prefix}Wall`, state.wall),
      merge: pocket.merge,
      ...(pocket.referenceBodyId ? { referenceBodyId: pocket.referenceBodyId } : {}),
      sourceEvidence: { product: pocket.product || "Pocket dimensions", kind: pocket.evidenceKind || "estimate", units: pocket.sourceUnits || "mm", ...(pocket.url ? { url: pocket.url } : {}) },
    });
  }
  return { name: `Gridfinity ${state.kind === "insert" ? "custom insert" : state.kind} ${state.columns} x ${state.rows}`, mode: "advanced", parameters, operations };
}

function illustration(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 40 40"); svg.setAttribute("aria-hidden", "true");
  const paths = { insert: "M5 9h30v24H5z M11 16h11v11H11z M29 18v7", bin: "M5 9h30v24H5z M5 15h30 M20 15v18", baseplate: "M5 7h30v28H5z M20 7v28 M5 21h30" };
  const path = document.createElementNS(svg.namespaceURI, "path");
  for (const [name, val] of Object.entries({ d: paths[kind], fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linejoin": "round" })) path.setAttribute(name, val);
  svg.append(path); return svg;
}

export function initTemplatePanel({ request, subscribe, createPreviewView }) {
  const root = document.getElementById("ai-templates-panel");
  const tabs = [...document.querySelectorAll('.ai-workspace-tabs [role="tab"]')];
  if (!root || !tabs.length) return;
  for (const [id, name] of [["ai-templates-tab", "add"], ["ai-connection-tab", "plug"]]) iconLabel(document.getElementById(id), name);
  let kind = "bin", busy = false, cached = null, editorDocument = null, pocketCounter = 0;
  const cards = new Map(), controls = {}, pocketForms = [];
  const modeButtons = new Map();
  const form = el("form", { class: "ai-template-form", novalidate: true });
  const fieldset = el("fieldset", { class: "ai-template-group" });
  const message = el("p", { class: "ai-template-message", role: "status", "aria-live": "polite", id: "ai-template-message" });
  const previewArea = el("section", { id: "ai-template-preview", class: "ai-template-preview", tabindex: "-1", hidden: true, "aria-label": "Template preview" });
  let previewView = null;
  const guide = dimensionGuide({ title: "Your part, at a glance", note: "This sizing sketch updates as you edit. Select Preview to build and check the actual 3D model." });
  const emptyPreview = guide.element;
  const stalePreview = el("p", { class: "ai-template-stale", hidden: true, role: "status" }, "Out of date. Select Preview to update this model.");
  const previewButton = el("button", { type: "submit", class: "ai-template-primary" }, "Preview");
  iconLabel(previewButton, "eye");
  const addButton = el("button", { type: "button", class: "ai-template-primary", disabled: true }, "Add to document");
  const cancelButton = el("button", { type: "button" }, "Cancel preview");
  const continueButton = el("button", { type: "button", class: "ai-template-primary" }, "Continue in editor");
  continueButton.onclick = () => document.getElementById("ai-setup-close").click();
  const success = el("section", { class: "ai-template-success", hidden: true, tabindex: "-1", "aria-label": "Part added" }, el("h3", { tabindex: "-1" }, "Your part is in the document"), el("p", { class: "ai-template-note" }, "Continue in the editor to save your project or export the part for your slicer."), continueButton);
  const invalidate = (text, { discard = false } = {}) => {
    cached = null; addButton.disabled = true; success.hidden = true;
    if (discard) { previewArea.hidden = true; previewView?.dispose(); previewView = null; }
    stalePreview.hidden = previewArea.hidden;
    emptyPreview.hidden = !previewArea.hidden;
    message.textContent = typeof text === "string" ? text : "";
    delete message.dataset.error;
    previewButton.classList.add("ai-template-primary");
  };
  const setBusy = (active, label) => {
    busy = active; fieldset.disabled = active; previewButton.disabled = active;
    cards.forEach(button => { button.disabled = active; });
    modeButtons.forEach(button => { button.disabled = active; });
    root.setAttribute("aria-busy", String(active));
    addButton.disabled = active || !cached; cancelButton.disabled = active;
    iconLabel(previewButton, "eye", active ? label : "Preview");
    previewButton.classList.toggle("ai-template-primary", !cached && success.hidden);
  };
  const showError = error => { message.textContent = error.message || String(error); message.dataset.error = "true"; };
  function numberField(parent, name, label, initial, min, max, step = "any") {
    const id = `ai-template-${name}`;
    const input = el("input", { id, name, type: "number", value: initial, min, max, step, required: true, "aria-describedby": "ai-template-message" });
    input.addEventListener("input", () => { if (input.validity.valid) input.removeAttribute("aria-invalid"); });
    parent.append(el("label", { class: "ai-template-field", for: id }, el("span", {}, label), input));
    return input;
  }
  function checkbox(parent, name, label, checked = false) {
    const input = el("input", { id: `ai-template-${name}`, type: "checkbox" }); input.checked = checked;
    parent.append(el("label", { class: "ai-template-field", for: input.id }, input, el("span", {}, label)));
    return input;
  }
  const partDescription = el("p", { class: "ai-template-note" }, "Open storage with optional dividers");
  const list = el("div", { class: "ai-template-list", "aria-label": "Gridfinity templates" });
  for (const [key, title, detail] of TEMPLATES) {
    const button = el("button", { type: "button", class: "ai-template-choice", "aria-pressed": key === kind ? "true" : "false", "data-template": key, "aria-label": `${title} ${detail}` }, illustration(key), el("span", {}, el("strong", {}, title), el("small", {}, detail)));
    button.onclick = () => {
      kind = key; cards.forEach((entry, id) => entry.setAttribute("aria-pressed", String(id === key)));
      heightFields.hidden = key === "baseplate"; constructionFields.hidden = key === "baseplate"; binFields.hidden = key !== "bin"; pocketSection.hidden = key !== "insert";
      for (const group of [heightFields, constructionFields, binFields, pocketSection]) for (const input of group.querySelectorAll("input")) input.disabled = group.hidden || input.closest("label")?.hidden === true;
      walls.setDisabled(key !== "bin"); magnets.setDisabled(false); partDescription.textContent = detail; invalidate(); updateDimensions();
    };
    list.append(button); cards.set(key, button);
  }
  const basic = el("div", { class: "ai-template-fields" });
  controls.columns = numberField(basic, "columns", "Width (cells)", 2, 1, GRIDFINITY_LIMITS.columns, 1);
  controls.rows = numberField(basic, "rows", "Depth (cells)", 3, 1, GRIDFINITY_LIMITS.rows, 1);
  const dimensions = el("p", { class: "ai-template-note", "aria-live": "polite" });
  const heightFields = el("div", { class: "ai-template-group" });
  const exactHeight = el("details", {}, el("summary", {}, "More heights"));
  controls.heightUnits = numberField(exactHeight, "heightUnits", "Height (7 mm steps)", 3, 2, 12, 1);
  const heightChoices = el("div", { class: "ai-template-shapes", role: "group", "aria-label": "Part body height" });
  for (const units of [2, 3, 5, 7]) {
    const button = el("button", { type: "button", "data-height": units, "aria-pressed": String(units === 3) }, `${units * 7} mm`);
    button.onclick = () => { controls.heightUnits.value = units; controls.heightUnits.dispatchEvent(new Event("input", { bubbles: true })); };
    heightChoices.append(button);
  }
  const heightNote = el("p", { class: "ai-template-note" });
  heightFields.append(el("h4", {}, "Body height"), heightChoices, heightNote, exactHeight);
  const constructionFields = el("div", { class: "ai-template-fields" });
  controls.floor = numberField(constructionFields, "floor", "Bottom thickness (mm)", 2, 0.8, 6);
  controls.wall = numberField(constructionFields, "wall", "Wall thickness (mm)", 1.2, 0.8, 4);
  const binFields = el("details", { class: "ai-template-group" }, iconLabel(el("summary", {}, "Compartments & stacking"), "grid"));
  controls.lip = checkbox(binFields, "lip", "Stackable rim", true);
  const dividerFields = el("div", { class: "ai-template-fields" });
  controls.dividersX = numberField(dividerFields, "dividersX", "Width dividers", 0, 0, 6, 1);
  controls.dividersY = numberField(dividerFields, "dividersY", "Depth dividers", 0, 0, 6, 1);
  const walls = wallControls({ onChange: () => { invalidate(); updateDimensions(); }, onCloseGaps: () => { invalidate(); updateDimensions(); } });
  binFields.append(dividerFields, walls.element);
  const magnets = magnetControls({ id: "ai-template-magnets", onChange: () => { invalidate(); updateDimensions(); } });
  const construction = el("details", { class: "ai-template-group" }, iconLabel(el("summary", {}, "Construction & magnets"), "magnet"), constructionFields, magnets.element);
  const pockets = el("div", { class: "ai-template-pockets" });
  const addPocket = el("button", { type: "button" }, "Add pocket");
  const pocketSection = el("section", { class: "ai-template-group", hidden: true }, el("h3", {}, "Pockets"), el("p", { class: "ai-template-note" }, "Clearance is per side. Suggested values need a fit test on your printer."), pockets, addPocket);
  const updateDimensions = () => {
    const footprint = binFootprint({ columns: value(controls.columns), rows: value(controls.rows), closeGaps: kind === "bin" && walls.getCloseGaps(), openSides: walls.get() });
    const width = kind === "baseplate" ? value(controls.columns) * 42 : footprint.width;
    const depth = kind === "baseplate" ? value(controls.rows) * 42 : footprint.depth;
    let magneticHeight = "";
    if (kind === "baseplate" && magnets.valid()) magneticHeight = ` Baseplate height ${(5 + magnetCarrierHeight(magnets.get())).toFixed(1)} mm.`;
    if (magnets.get() && magnets.valid()) magneticHeight += ` ${value(controls.columns) * value(controls.rows) * 4} magnet pockets, ${kind === "baseplate" ? "open from the top of the carrier" : "open underneath"}.`;
    const height = kind === "baseplate" ? 5 + (magnets.get() && magnets.valid() ? magnetCarrierHeight(magnets.get()) : 0) : kind === "bin" ? binTotalHeight({ heightUnits: value(controls.heightUnits), floor: value(controls.floor), lip: controls.lip.checked, openSides: walls.get(), dividers: { x: value(controls.dividersX), y: value(controls.dividersY) } }) : value(controls.heightUnits) * 7;
    heightNote.textContent = kind === "bin" && walls.get().length === 4 ? "All sides are open. Only the floor and any dividers remain." : kind === "bin" && controls.lip.checked ? "The stackable rim adds 4.4 mm to the body height." : "Heights increase in 7 mm steps to match the grid system.";
    const validSize = controls.columns.validity.valid && controls.rows.validity.valid && (kind === "baseplate" || controls.heightUnits.validity.valid && controls.floor.validity.valid && controls.wall.validity.valid) && magnets.valid();
    dimensions.textContent = validSize ? `${width} × ${depth} × ${height.toFixed(1)} mm overall. One grid cell is 42 mm.${magneticHeight}` : "Enter a valid size to update the sizing guide.";
    guide.update({ ...(validSize ? { width, depth, height } : {}), kind, columns: value(controls.columns), rows: value(controls.rows) });
    for (const input of [controls.columns, controls.rows]) {
      const buttons = input.parentElement.querySelectorAll("button");
      if (buttons.length) { buttons[0].disabled = value(input) <= Number(input.min); buttons[1].disabled = value(input) >= Number(input.max); }
    }
    heightChoices.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.height) === value(controls.heightUnits))));
  };
  function addPocketForm() {
    if (pocketForms.length >= 8) return;
    const index = ++pocketCounter, fields = {}, pocket = { fields, shape: "roundedRect", referenceBodyId: null };
    const title = el("h4", {}, `Pocket ${index}`), remove = el("button", { type: "button", class: "ai-template-remove", "aria-label": `Remove pocket ${index}` }, "Remove");
    const group = el("section", { class: "ai-template-pocket", "aria-labelledby": `ai-pocket-title-${index}` });
    title.id = `ai-pocket-title-${index}`;
    const shapeButtons = el("div", { class: "ai-template-shapes", "aria-label": `Pocket ${index} shape` });
    const measurementFields = el("div", { class: "ai-template-fields" });
    fields.width = numberField(measurementFields, `${index}-width`, "Width / diameter (mm)", 40, 1, 1000);
    fields.height = numberField(measurementFields, `${index}-height`, "Length (mm)", 30, 1, 1000);
    fields.radius = numberField(measurementFields, `${index}-radius`, "Corner radius (mm)", 3, 0.1, 500);
    for (const [key, label] of [["roundedRect", "Rounded"], ["circle", "Circle"], ["capsule", "Capsule"]]) {
      const button = el("button", { type: "button", "aria-pressed": key === pocket.shape ? "true" : "false" }, label);
      button.onclick = () => {
        pocket.shape = key; [...shapeButtons.children].forEach(entry => entry.setAttribute("aria-pressed", String(entry === button)));
        fields.height.closest("label").hidden = key === "circle"; fields.height.disabled = key === "circle";
        fields.radius.closest("label").hidden = key !== "roundedRect"; fields.radius.disabled = key !== "roundedRect";
        invalidate();
      };
      shapeButtons.append(button);
    }
    fields.depth = numberField(measurementFields, `${index}-depth`, "Pocket depth (mm)", 8, 0.1, 1000);
    fields.clearance = numberField(measurementFields, `${index}-clearance`, "Clearance per side (mm)", 0.3, 0, 5);
    fields.x = numberField(measurementFields, `${index}-x`, "Centre X (mm)", 0, -1000, 1000);
    fields.y = numberField(measurementFields, `${index}-y`, "Centre Y (mm)", 0, -1000, 1000);
    fields.rotation = numberField(measurementFields, `${index}-rotation`, "Rotation about Z (degrees)", 0, -360, 360);
    fields.merge = checkbox(group, `${index}-merge`, "Allow overlap with earlier pockets");
    const sources = el("details", {}, el("summary", {}, "Reference and dimensions"));
    const referenceList = el("div", { class: "ai-template-reference" });
    const rebuildReferences = () => {
      referenceList.replaceChildren();
      const available = editorDocument?.bodies.filter(body => body.role === "reference" && body.dimensions && !body.hidden) || [];
      referenceList.append(el("p", { class: "ai-template-note" }, available.length ? "Use a reference body's bounding dimensions as an envelope." : "No visible reference bodies. Enter measured dimensions above."));
      for (const body of available) {
        const button = el("button", { type: "button", "aria-pressed": String(pocket.referenceBodyId === body.id) }, body.name);
        button.onclick = () => {
          pocket.referenceBodyId = body.id;
          fields.width.value = Math.round(body.dimensions.x * 1000) / 1000;
          fields.height.value = Math.round(body.dimensions.y * 1000) / 1000;
          fields.product.value = body.name;
          pocket.evidenceKind = "model";
          invalidate("Envelope dimensions copied. Set the pocket's depth and orientation."); rebuildReferences(); fields.width.focus();
        };
        referenceList.append(button);
      }
    };
    pocket.rebuildReferences = rebuildReferences;
    const sourceFields = el("div", { class: "ai-template-group" });
    const evidenceButtons = el("div", { class: "ai-template-shapes", "aria-label": "Dimension evidence" });
    const sourceUnitButtons = el("div", { class: "ai-template-shapes", "aria-label": "Original dimension units" });
    pocket.evidenceKind = "estimate";
    pocket.sourceUnits = "mm";
    for (const [kind, label] of [["estimate", "Estimate"], ["measured", "Measured"], ["manufacturer", "Published"], ["model", "Model"]]) {
      const button = el("button", { type: "button", "aria-pressed": String(kind === "estimate") }, label);
      button.onclick = () => { pocket.evidenceKind = kind; [...evidenceButtons.children].forEach(entry => entry.setAttribute("aria-pressed", String(entry === button))); invalidate(); };
      evidenceButtons.append(button);
    }
    for (const units of ["mm", "cm", "in"]) {
      const button = el("button", { type: "button", "aria-pressed": String(units === pocket.sourceUnits) }, units);
      button.onclick = () => { pocket.sourceUnits = units; [...sourceUnitButtons.children].forEach(entry => entry.setAttribute("aria-pressed", String(entry === button))); invalidate(); };
      sourceUnitButtons.append(button);
    }
    sourceFields.append(el("span", {}, "Dimension evidence"), evidenceButtons,
      el("span", {}, "Original source units. Pocket dimensions are always entered in millimetres."), sourceUnitButtons);
    for (const [key, label, type] of [["product", "Item / model variant", "text"], ["url", "Dimension source URL (optional)", "url"]]) {
      const id = `ai-template-${index}-${key}`;
      fields[key] = el("input", { id, type, maxlength: key === "url" ? 2000 : 160 });
      sourceFields.append(el("label", { class: "ai-template-field", for: id }, el("span", {}, label), fields[key]));
    }
    sources.append(referenceList, sourceFields);
    const positionFields = el("div", { class: "ai-template-fields" });
    for (const key of ["radius", "clearance", "x", "y", "rotation", "merge"]) positionFields.append(fields[key].closest("label"));
    group.prepend(el("header", {}, title, remove), shapeButtons, measurementFields, el("details", {}, el("summary", {}, "Position & fit"), positionFields)); group.append(sources);
    remove.onclick = () => { pocketForms.splice(pocketForms.indexOf(pocket), 1); group.remove(); addPocket.disabled = false; invalidate(); addPocket.focus(); };
    pockets.append(group); pocketForms.push(pocket); rebuildReferences();
    addPocket.disabled = pocketForms.length >= 8; invalidate();
  }
  addPocket.onclick = addPocketForm;
  for (const input of [controls.columns, controls.rows]) {
    const field = input.closest("label"), text = field.firstChild;
    const label = el("label", { for: input.id }, text.textContent), wrap = el("div", { class: "ai-size-control" });
    const container = el("div", { class: "ai-template-field" }, label, wrap);
    for (const [change, glyph] of [[-1, "−"], [1, "+"]]) {
      const button = el("button", { type: "button", "aria-label": `${change < 0 ? "Decrease" : "Increase"} part ${input === controls.columns ? "width" : "depth"}` }, glyph);
      button.onclick = () => { change < 0 ? input.stepDown() : input.stepUp(); input.dispatchEvent(new Event("input", { bubbles: true })); };
      wrap.append(button);
    }
    wrap.insertBefore(input, wrap.lastChild); field.replaceWith(container);
  }
  fieldset.append(el("h4", {}, "Footprint"), basic, dimensions, heightFields, binFields, pocketSection, construction);
  form.append(el("div", { class: "ai-controls" }, fieldset, message), el("div", { class: "ai-template-submit" }, previewButton));
  form.querySelector(".ai-controls").prepend(el("h3", {}, "Part type"), list, partDescription);
  const settings = el("div", { class: "ai-template-settings" }, form);
  const singlePart = el("div", { class: "ai-single-part", hidden: true }, settings, el("div", { class: "ai-template-review" }, emptyPreview, previewArea, success));
  const drawerRoot = el("div", { class: "ai-drawer-mode" });
  const generatorSettings = el("form", { class: "ai-template-form ai-generator-settings", novalidate: true, hidden: true, "aria-label": "Gridfinity settings" });
  const modeSwitch = el("div", { class: "ai-template-mode", role: "group", "aria-label": "Gridfinity workflow" });
  const workflowTitle = el("h3", { id: "ai-gridfinity-title" }, "Organize your drawer");
  const workflowNote = el("p", { class: "ai-template-note" }, "Measure the inside, arrange your bins, then review your printable parts.");
  for (const [mode, title] of [["drawer", "Drawer layout"], ["part", "Single part"], ["settings", "Printer & settings"]]) {
    const button = iconLabel(el("button", { type: "button", "aria-pressed": String(mode === "drawer"), "data-workspace-view": mode }, title), { drawer: "grid", part: "box", settings: "printer3d" }[mode]);
    button.onclick = () => {
      modeButtons.forEach((entry, id) => entry.setAttribute("aria-pressed", String(id === mode)));
      singlePart.hidden = mode !== "part"; drawerRoot.hidden = mode !== "drawer";
      generatorSettings.hidden = mode !== "settings";
      workflowTitle.textContent = { drawer: "Organize your drawer", part: "Make a single part", settings: "Set up your printer" }[mode];
      workflowNote.textContent = { drawer: "Measure the inside, arrange your bins, then review your printable parts.", part: "Choose a part and adjust its size. Preview it before adding to your document.", settings: "Check that each part fits your build area. These defaults are remembered in this browser." }[mode];
      if (mode === "settings") {
        const limits = drawerPanel.getBinLimits(); limitWidth.value = limits.columns; limitDepth.value = limits.rows; updateLimitFootprint();
        const area = drawerPanel.getPrintArea(); printerEnabled.checked = !!area;
        for (const key of Object.keys(printerFields)) printerFields[key].value = (area || PRINT_AREA_PRESETS[0])[key];
        updatePrinterSummary();
      }
      invalidate(undefined, { discard: true }); drawerPanel.deactivate();
    };
    if (mode === "settings") button.classList.add("ai-settings-link");
    modeButtons.set(mode, button); modeSwitch.append(button);
  }
  const gridfinity = el("section", { class: "ai-generator", "aria-label": "Gridfinity" },
    el("div", { class: "ai-generator-header" }, el("div", { class: "ai-workflow-heading" }, workflowTitle, workflowNote), modeSwitch),
    drawerRoot, singlePart, generatorSettings);
  root.append(gridfinity);
  const drawerPanel = initDrawerPanel({ root: drawerRoot, request, subscribe, createPreviewView, onBusy: active => modeButtons.forEach(button => { button.disabled = active; }) });
  const limitFields = el("div", { class: "ai-template-fields" });
  const limitWidth = numberField(limitFields, "max-bin-width", "Maximum bin width (cells)", 4, 1, GRIDFINITY_LIMITS.columns, 1);
  const limitDepth = numberField(limitFields, "max-bin-depth", "Maximum bin depth (cells)", 4, 1, GRIDFINITY_LIMITS.rows, 1);
  const limitStatus = el("p", { class: "ai-template-message", role: "status" });
  const printerEnabled = el("input", { id: "ai-print-area-enabled", type: "checkbox" });
  const printerFieldsRoot = el("div", { class: "ai-template-fields" });
  const printerFields = {};
  for (const [key, label, initial, min, max] of [["width", "Print width (mm)", 256, 1, 2000], ["depth", "Print depth (mm)", 256, 1, 2000], ["height", "Print height (mm)", 260, 1, 2000], ["edgeMargin", "Reserve per bed edge (mm)", 2, 0, 20]]) printerFields[key] = numberField(printerFieldsRoot, `print-${key}`, label, initial, min, max, 0.1);
  const printerGuide = dimensionGuide({ title: "Your printer’s build area", note: "Each generated part is checked separately. Arrange the exported parts on print plates in your slicer." });
  const printerNote = el("p", { class: "ai-template-note", role: "status" });
  const printerPresets = el("div", { class: "ai-template-shapes", role: "group", "aria-label": "Nozzle printing area presets" });
  const presetButtons = PRINT_AREA_PRESETS.map(preset => {
    const button = el("button", { type: "button", "aria-pressed": "false" }, `${preset.name} · ${preset.width} × ${preset.depth} × ${preset.height} mm`);
    button.onclick = () => { printerEnabled.checked = true; for (const key of Object.keys(printerFields)) printerFields[key].value = preset[key]; updatePrinterSummary(); };
    printerPresets.append(button); return button;
  });
  function readPrinterArea() {
    if (!printerEnabled.checked) return false;
    const values = Object.fromEntries(Object.entries(printerFields).map(([key, input]) => [key, Number(input.value)]));
    const preset = PRINT_AREA_PRESETS.find(p => ["width", "depth", "height"].every(key => p[key] === values[key]));
    return normalizePrintArea({ ...values, ...(preset ? { name: preset.name } : {}) });
  }
  function updatePrinterSummary() {
    printerFieldsRoot.hidden = !printerEnabled.checked;
    for (const input of Object.values(printerFields)) input.disabled = !printerEnabled.checked;
    presetButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(printerEnabled.checked && ["width", "depth", "height"].every(key => Number(printerFields[key].value) === PRINT_AREA_PRESETS[index][key]))));
    try {
      const area = readPrinterArea(), tile = baseplateTileLimits(area);
      printerGuide.update({ width: area?.width, depth: area?.depth, height: area?.height });
      printerNote.textContent = area ? `Usable area ${area.width - 2 * area.edgeMargin} × ${area.depth - 2 * area.edgeMargin} × ${area.height} mm. Baseplate tiles up to ${tile.columns} × ${tile.rows} cells (${tile.columns * 42} × ${tile.rows * 42} mm); may rotate 90° for fewer tiles.` : "No printer area configured. Baseplates use the existing 4 × 4 tiling.";
    } catch (error) { printerNote.textContent = error.message; }
  }
  printerEnabled.onchange = updatePrinterSummary;
  Object.values(printerFields).forEach(input => { input.oninput = updatePrinterSummary; input.setAttribute("aria-describedby", "ai-print-area-help"); });
  const limitFootprint = el("p", { class: "ai-template-note" });
  function updateLimitFootprint() { limitFootprint.textContent = limitWidth.validity.valid && limitDepth.validity.valid ? `${(Number(limitWidth.value) * 42 - 0.5).toFixed(1)} × ${(Number(limitDepth.value) * 42 - 0.5).toFixed(1)} mm bin-size limit. Printer area is checked separately.` : ""; }
  limitWidth.oninput = limitDepth.oninput = updateLimitFootprint;
  limitWidth.setAttribute("aria-describedby", "ai-bin-limits-note"); limitDepth.setAttribute("aria-describedby", "ai-bin-limits-note");
  const printerControls = el("div", { class: "ai-template-settings" }, el("div", { class: "ai-controls" }, el("h3", {}, "Printer area"),
    el("p", { id: "ai-print-area-help", class: "ai-template-note" }, "Choose a nozzle area below, or enter your printer’s dimensions. Leave room at the edges for a brim or skirt."),
    el("label", { class: "ai-template-field", for: printerEnabled.id }, printerEnabled, el("span", {}, "Use printer area")), printerPresets, printerFieldsRoot, printerNote,
    el("details", { class: "ai-template-group", open: true }, el("summary", {}, "Bin size limits"),
      el("p", { id: "ai-bin-limits-note", class: "ai-template-note" }, "Largest bin offered when drawing or filling gaps. One cell is 42 mm; printer fit is checked separately."), limitFields, limitFootprint),
    limitStatus), el("div", { class: "ai-template-submit" }, el("button", { type: "submit", class: "ai-template-primary" }, "Save settings")));
  generatorSettings.append(printerControls, printerGuide.element);
  generatorSettings.onsubmit = event => {
    event.preventDefault(); if (!revealInvalid(generatorSettings)) return;
    try { limitStatus.textContent = drawerPanel.setBinLimits({ columns: Number(limitWidth.value), rows: Number(limitDepth.value) }, readPrinterArea()); delete limitStatus.dataset.error; }
    catch (error) { limitStatus.textContent = error.message; limitStatus.dataset.error = "true"; }
  };
  const readState = () => ({ kind, openSides: walls.get(), closeGaps: walls.getCloseGaps(), magnets: magnets.get(), ...Object.fromEntries(Object.entries(controls).map(([name, input]) => [name, input.type === "checkbox" ? input.checked : value(input)])), pockets: pocketForms.map(pocket => ({ shape: pocket.shape, referenceBodyId: pocket.referenceBodyId, evidenceKind: pocket.evidenceKind, sourceUnits: pocket.sourceUnits, ...Object.fromEntries(Object.entries(pocket.fields).map(([key, input]) => [key, input.type === "checkbox" ? input.checked : ["product", "url"].includes(key) ? input.value.trim() : value(input)])) })) });
  form.addEventListener("input", () => { invalidate(); updateDimensions(); });
  form.addEventListener("change", () => invalidate());
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    if (!revealInvalid(form)) return;
    invalidate(); setBusy(true, "Building preview…");
    try {
      const before = await request("get_document", {});
      const plan = templatePlan(readState());
      const preview = await request("preview_model", { plan, expectedRevision: before.revision, includeImage: true });
      if (!preview.valid) throw new Error(preview.errors.map(entry => entry.error).join(". ") || "Preview failed. Check the pocket dimensions and remaining material.");
      const printFits = [];
      for (const body of preview.bodies) {
        if (body.dimensions) printFits.push(checkPrintFit(drawerPanel.getPrintArea(), body.dimensions.x, body.dimensions.y, body.dimensions.z, body.name));
        const inspection = await request("inspect_geometry", { previewId: preview.previewId, bodyId: body.id, mesh: true });
        if (!inspection.meshValidation?.valid || inspection.meshValidation.disconnectedComponents !== 1) throw new Error("The preview does not form one valid connected body. Adjust the parameters and preview again.");
      }
      cached = preview;
      stalePreview.hidden = true;
      emptyPreview.hidden = true;
      previewView?.dispose(); previewView = null;
      const reviewTitle = el("h3", { tabindex: "-1" }, "Review preview");
      const previewContent = el("div", { class: "ai-preview-content" }, reviewTitle, stalePreview);
      previewArea.replaceChildren(previewContent);
      try { previewView = createPreviewView(preview.previewId); previewContent.append(previewView.element); }
      catch { for (const entry of preview.images || []) if (entry.view === "isometric") previewContent.append(el("img", { src: entry.dataUrl, alt: "Isometric view of the proposed Gridfinity model" })); }
      const dims = preview.bodies[0]?.dimensions;
      if (dims) previewContent.append(el("dl", { class: "ai-preview-dimensions", "aria-label": "Model dimensions" },
        ...[["x", "Width"], ["y", "Depth"], ["z", "Height"]].map(([axis, label]) =>
          el("div", {}, el("dt", {}, `${label} (${axis.toUpperCase()})`), el("dd", {}, `${dims[axis].toFixed(2)} mm`)))));
      const footer = el("div", { class: "ai-preview-footer" }, el("p", { class: "ai-template-note" }, "Connected geometry checked. Printed fit remains unverified."), el("div", { class: "ai-template-actions" }, addButton, cancelButton));
      if (printFits.some(fit => fit.rotation === 90)) footer.prepend(el("p", { class: "ai-template-note" }, "Turn this part 90° on the print bed to fit the selected printer area."));
      previewArea.append(footer);
      previewArea.hidden = false; reviewTitle.focus();
      message.textContent = "Preview ready. The document is unchanged.";
    } catch (error) { invalidate(); showError(error); }
    finally { setBusy(false); }
  };
  addButton.onclick = async () => {
    if (!cached || busy) return;
    const preview = cached; setBusy(true, "Adding…");
    try {
      await request("apply_model", { previewId: preview.previewId });
      invalidate("Added to the document. Use Undo to recover the previous state.", { discard: true });
      editorDocument = await request("get_document", {});
      pocketForms.forEach(pocket => pocket.rebuildReferences());
      emptyPreview.hidden = true; success.hidden = false; success.querySelector("h3").focus();
    } catch (error) { invalidate(); showError(error); }
    finally { setBusy(false); }
  };
  cancelButton.onclick = () => { invalidate("Preview cancelled. The document is unchanged.", { discard: true }); previewButton.focus(); };
  async function activate(tab) {
    document.getElementById("ai-setup-panel").dataset.activeTab = tab.id === "ai-templates-tab" ? "templates" : "connection";
    for (const entry of tabs) {
      const active = entry === tab; entry.setAttribute("aria-selected", String(active)); entry.tabIndex = active ? 0 : -1;
      document.getElementById(entry.getAttribute("aria-controls")).hidden = !active;
    }
    if (tab.id === "ai-templates-tab") {
      try { editorDocument = await request("get_document", {}); pocketForms.forEach(pocket => pocket.rebuildReferences()); await drawerPanel.refreshDocument(editorDocument); }
      catch (error) { showError(error); }
    }
  }
  tabs.forEach((tab, index) => {
    tab.onclick = () => { void activate(tab); };
    tab.onkeydown = event => {
      const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      const target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : offset ? tabs[(index + offset + tabs.length) % tabs.length] : null;
      if (target) { event.preventDefault(); target.focus(); void activate(target); }
    };
  });
  subscribe(kind => { if (!["preview", "version"].includes(kind) && (cached || !success.hidden)) invalidate("The document changed. Preview again before adding.", { discard: !success.hidden }); });
  document.getElementById("ai-setup-panel").addEventListener("workspaceopen", () => {
    const selected = tabs.find(tab => tab.getAttribute("aria-selected") === "true");
    if (selected) void activate(selected);
  });
  addPocketForm(); updateDimensions();
  for (const input of pocketSection.querySelectorAll("input")) input.disabled = true;
}
