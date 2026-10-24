import { el } from "../../src/util.js";
import { initDrawerPanel } from "./drawer-panel.js";

const TEMPLATES = [
  ["insert", "Custom insert", "A solid blank with measured pockets"],
  ["bin", "Bin", "Open storage with optional dividers"],
  ["baseplate", "Baseplate", "A matching grid for your drawer"],
];
const value = input => Number(input.value);

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
    grid.lip = state.lip;
    grid.dividers = { x: number("dividersX", state.dividersX, "count"), y: number("dividersY", state.dividersY, "count") };
  }
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

export function initTemplatePanel({ request, subscribe }) {
  const root = document.getElementById("ai-templates-panel");
  const tabs = [...document.querySelectorAll('.ai-workspace-tabs [role="tab"]')];
  if (!root || !tabs.length) return;
  let kind = "insert", busy = false, cached = null, editorDocument = null, pocketCounter = 0;
  const cards = new Map(), controls = {}, pocketForms = [];
  const modeButtons = new Map();
  const form = el("form", { class: "ai-template-form" });
  const fieldset = el("fieldset", { class: "ai-template-group" });
  const message = el("p", { class: "ai-template-message", role: "status", "aria-live": "polite", id: "ai-template-message" });
  const previewArea = el("section", { id: "ai-template-preview", class: "ai-template-preview", hidden: true, "aria-label": "Template preview" });
  const emptyPreview = el("div", { class: "ai-template-empty" }, el("h3", {}, "Model preview"), el("p", { class: "ai-template-note" }, "Set dimensions, then select Preview."));
  const stalePreview = el("p", { class: "ai-template-stale", hidden: true, role: "status" }, "Out of date. Select Preview to update this model.");
  const previewButton = el("button", { type: "submit", class: "ai-template-primary" }, "Preview");
  const addButton = el("button", { type: "button", class: "ai-template-primary", disabled: true }, "Add to document");
  const cancelButton = el("button", { type: "button" }, "Cancel preview");
  const invalidate = (text, { discard = false } = {}) => {
    cached = null; addButton.disabled = true;
    if (discard) previewArea.hidden = true;
    stalePreview.hidden = previewArea.hidden;
    emptyPreview.hidden = !previewArea.hidden;
    message.textContent = typeof text === "string" ? text : "";
    delete message.dataset.error;
  };
  const setBusy = (active, label) => {
    busy = active; fieldset.disabled = active; previewButton.disabled = active;
    cards.forEach(button => { button.disabled = active; });
    modeButtons.forEach(button => { button.disabled = active; });
    root.setAttribute("aria-busy", String(active));
    addButton.disabled = active || !cached; cancelButton.disabled = active;
    previewButton.textContent = active ? label : "Preview";
  };
  const showError = error => { message.textContent = error.message || String(error); message.dataset.error = "true"; };
  function numberField(parent, name, label, initial, min, max, step = "any") {
    const id = `ai-template-${name}`;
    const input = el("input", { id, name, type: "number", value: initial, min, max, step, required: true, "aria-describedby": "ai-template-message" });
    parent.append(el("label", { class: "ai-template-field", for: id }, el("span", {}, label), input));
    return input;
  }
  function checkbox(parent, name, label, checked = false) {
    const input = el("input", { id: `ai-template-${name}`, type: "checkbox" }); input.checked = checked;
    parent.append(el("label", { class: "ai-template-field", for: input.id }, input, el("span", {}, label)));
    return input;
  }
  const list = el("div", { class: "ai-template-list", "aria-label": "Gridfinity templates" });
  for (const [key, title, detail] of TEMPLATES) {
    const button = el("button", { type: "button", class: "ai-template-choice", "aria-pressed": key === kind ? "true" : "false", "data-template": key }, illustration(key), el("span", {}, el("strong", {}, title), el("small", {}, detail)));
    button.onclick = () => {
      kind = key; cards.forEach((entry, id) => entry.setAttribute("aria-pressed", String(id === key)));
      heightFields.hidden = key === "baseplate"; binFields.hidden = key !== "bin"; pocketSection.hidden = key !== "insert";
      for (const group of [heightFields, binFields, pocketSection]) for (const input of group.querySelectorAll("input")) input.disabled = group.hidden || input.closest("label")?.hidden === true;
      invalidate(); updateDimensions();
    };
    list.append(button); cards.set(key, button);
  }
  const basic = el("div", { class: "ai-template-fields" });
  controls.columns = numberField(basic, "columns", "Width (cells)", 2, 1, 4, 1);
  controls.rows = numberField(basic, "rows", "Depth (cells)", 3, 1, 4, 1);
  const dimensions = el("p", { class: "ai-template-note", "aria-live": "polite" });
  const heightFields = el("div", { class: "ai-template-fields" });
  controls.heightUnits = numberField(heightFields, "heightUnits", "Height (7 mm units)", 3, 2, 12, 1);
  controls.floor = numberField(heightFields, "floor", "Minimum floor (mm)", 2, 0.8, 6);
  controls.wall = numberField(heightFields, "wall", "Minimum wall (mm)", 1.2, 0.8, 4);
  const binFields = el("div", { class: "ai-template-group", hidden: true });
  controls.lip = checkbox(binFields, "lip", "Stacking lip", true);
  const dividerFields = el("div", { class: "ai-template-fields" });
  controls.dividersX = numberField(dividerFields, "dividersX", "Width dividers", 0, 0, 6, 1);
  controls.dividersY = numberField(dividerFields, "dividersY", "Depth dividers", 0, 0, 6, 1);
  binFields.append(dividerFields);
  const pockets = el("div", { class: "ai-template-pockets" });
  const addPocket = el("button", { type: "button" }, "Add pocket");
  const pocketSection = el("section", { class: "ai-template-group" }, el("h3", {}, "Pockets"), el("p", { class: "ai-template-note" }, "Clearance is per side. Suggested values need a fit test on your printer."), pockets, addPocket);
  const updateDimensions = () => {
    const width = value(controls.columns) * 42 - (kind === "baseplate" ? 0 : 0.5);
    const depth = value(controls.rows) * 42 - (kind === "baseplate" ? 0 : 0.5);
    dimensions.textContent = `Footprint ${width} × ${depth} mm. X width, Y depth, Z up.`;
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
    group.prepend(el("header", {}, title, remove), shapeButtons, measurementFields); group.append(sources);
    remove.onclick = () => { pocketForms.splice(pocketForms.indexOf(pocket), 1); group.remove(); addPocket.disabled = false; invalidate(); addPocket.focus(); };
    pockets.append(group); pocketForms.push(pocket); rebuildReferences();
    addPocket.disabled = pocketForms.length >= 8; invalidate();
  }
  addPocket.onclick = addPocketForm;
  fieldset.append(basic, dimensions, heightFields, binFields, pocketSection);
  form.append(fieldset, message, el("div", { class: "ai-template-submit" }, previewButton));
  const settings = el("div", { class: "ai-template-settings" }, el("h3", {}, "Gridfinity"), list, form);
  const singlePart = el("div", { class: "ai-single-part", hidden: true }, settings, el("div", { class: "ai-template-review" }, emptyPreview, previewArea));
  const drawerRoot = el("div", { class: "ai-drawer-mode" });
  const modeSwitch = el("div", { class: "ai-template-mode", role: "group", "aria-label": "Design workflow" });
  for (const [mode, title] of [["drawer", "Drawer layout"], ["part", "Single part"]]) {
    const button = el("button", { type: "button", "aria-pressed": String(mode === "drawer"), "data-workspace-view": mode }, title);
    button.onclick = () => {
      modeButtons.forEach((entry, id) => entry.setAttribute("aria-pressed", String(id === mode)));
      singlePart.hidden = mode !== "part"; drawerRoot.hidden = mode !== "drawer";
      invalidate(undefined, { discard: true }); drawerPanel.deactivate();
    };
    modeButtons.set(mode, button); modeSwitch.append(button);
  }
  root.append(modeSwitch, drawerRoot, singlePart);
  const drawerPanel = initDrawerPanel({ root: drawerRoot, request, subscribe, onBusy: active => modeButtons.forEach(button => { button.disabled = active; }) });
  const readState = () => ({ kind, ...Object.fromEntries(Object.entries(controls).map(([name, input]) => [name, input.type === "checkbox" ? input.checked : value(input)])), pockets: pocketForms.map(pocket => ({ shape: pocket.shape, referenceBodyId: pocket.referenceBodyId, evidenceKind: pocket.evidenceKind, sourceUnits: pocket.sourceUnits, ...Object.fromEntries(Object.entries(pocket.fields).map(([key, input]) => [key, input.type === "checkbox" ? input.checked : ["product", "url"].includes(key) ? input.value.trim() : value(input)])) })) });
  form.addEventListener("input", () => { invalidate(); updateDimensions(); });
  form.addEventListener("change", () => invalidate());
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !form.reportValidity()) return;
    invalidate(); setBusy(true, "Building preview…");
    try {
      const before = await request("get_document", {});
      const plan = templatePlan(readState());
      const preview = await request("preview_model", { plan, expectedRevision: before.revision, includeImage: true });
      if (!preview.valid) throw new Error(preview.errors.map(entry => entry.error).join(". ") || "Preview failed. Check the pocket dimensions and remaining material.");
      for (const body of preview.bodies) {
        const inspection = await request("inspect_geometry", { previewId: preview.previewId, bodyId: body.id, mesh: true });
        if (!inspection.meshValidation?.valid || inspection.meshValidation.disconnectedComponents !== 1) throw new Error("The preview does not form one valid connected body. Adjust the parameters and preview again.");
      }
      cached = preview;
      stalePreview.hidden = true;
      emptyPreview.hidden = true;
      previewArea.replaceChildren(el("h3", {}, "Review preview"), stalePreview);
      for (const entry of preview.images || []) if (entry.view === "isometric") previewArea.append(el("img", { src: entry.dataUrl, alt: "Isometric view of the proposed Gridfinity model" }));
      const dims = preview.bodies[0]?.dimensions;
      if (dims) previewArea.append(el("dl", {}, ...["x", "y", "z"].flatMap(axis => [el("dt", {}, `${axis.toUpperCase()} size`), el("dd", {}, `${dims[axis].toFixed(2)} mm`)])));
      previewArea.append(el("p", { class: "ai-template-note" }, "Connected geometry checked. Printed fit remains unverified."), el("div", { class: "ai-template-actions" }, addButton, cancelButton));
      previewArea.hidden = false;
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
  subscribe(kind => { if (!["preview", "version"].includes(kind) && cached) invalidate("The document changed. Preview again before adding."); });
  addPocketForm(); updateDimensions();
}
