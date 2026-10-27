import { partEnvelope } from "../../shared/gridfinity-envelope.js";
import { GRIDFINITY_LIMITS } from "../../shared/gridfinity-limits.js";
import { checkPrintFit } from "../../shared/print-area.js";
import { numberValid } from "./field-text.js";
import { POCKET_LIMITS, MAX_POCKETS, COMPARTMENT_LIMITS, newPocketDraft, referencePatch, pocketDraftValid } from "./pocket-draft.js";

export const PART_TEMPLATES = [
  ["insert", "Custom insert", "A solid blank with measured pockets"],
  ["bin", "Bin", "Open storage with optional dividers"],
  ["baseplate", "Baseplate", "A matching grid for your drawer"],
];
export const PART_LIMITS = {
  columns: { min: 1, max: GRIDFINITY_LIMITS.columns, step: 1 }, rows: { min: 1, max: GRIDFINITY_LIMITS.rows, step: 1 },
  heightUnits: { min: 2, max: 12, step: 1 }, floor: { min: 0.8, max: 6 }, wall: { min: 0.8, max: 4 },
  compartmentsX: COMPARTMENT_LIMITS, compartmentsY: COMPARTMENT_LIMITS,
};
export { POCKET_LIMITS, MAX_POCKETS };

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
    grid.dividers = { x: number("dividersX", state.compartmentsX - 1, "count"), y: number("dividersY", state.compartmentsY - 1, "count") };
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

// Converts the editable texts into the numeric state that templatePlan expects.
export function partState(draft) {
  const numbers = fields => Object.fromEntries(Object.entries(fields).map(([key, text]) => [key, Number(text)]));
  return {
    kind: draft.kind, openSides: draft.openSides, closeGaps: draft.closeGaps, magnets: draft.magnets, lip: draft.lip, ...numbers(draft.fields),
    pockets: draft.pockets.map(pocket => ({ shape: pocket.shape, referenceBodyId: pocket.referenceBodyId, evidenceKind: pocket.evidenceKind, sourceUnits: pocket.sourceUnits,
      ...numbers(pocket.fields), merge: pocket.merge, product: pocket.product.trim(), url: pocket.url.trim() })),
  };
}

export function partSummary(draft, magnetsValid = true) {
  const state = partState(draft), { kind, magnets } = state, magnetsReady = !!magnets && magnetsValid;
  const { width, depth, height } = partEnvelope({ ...state, closeGaps: kind === "bin" && state.closeGaps, magnets: magnetsReady && magnets,
    dividers: { x: state.compartmentsX - 1, y: state.compartmentsY - 1 } });
  let magneticHeight = "";
  if (kind === "baseplate" && magnetsValid) magneticHeight = ` Baseplate height ${height.toFixed(1)} mm.`;
  if (magnetsReady) magneticHeight += ` ${state.columns * state.rows * 4} magnet pockets, ${kind === "baseplate" ? "open from the top of the carrier" : "open underneath"}.`;
  const valid = name => numberValid(draft.fields[name], PART_LIMITS[name]);
  const validSize = valid("columns") && valid("rows") && (kind === "baseplate" || valid("heightUnits") && valid("floor") && valid("wall")) && magnetsValid;
  return {
    validSize,
    dimensions: validSize ? `${width} × ${depth} × ${height.toFixed(1)} mm overall. One grid cell is 42 mm.${magneticHeight}` : "Enter a valid size to update the sizing guide.",
    heightNote: kind === "bin" && state.openSides.length === 4 ? "All sides are open. Only the floor and any dividers remain." : kind === "bin" && state.lip ? "The stackable rim adds 4.4 mm to the body height." : "Heights increase in 7 mm steps to match the grid system.",
    guide: { ...(validSize ? { width, depth, height } : {}), kind, columns: state.columns, rows: state.rows },
  };
}

// True when every field the part kind uses holds a valid value.
export function partReady(draft, magnetsValid = true) {
  const valid = name => numberValid(draft.fields[name], PART_LIMITS[name]);
  if (!partSummary(draft, magnetsValid).validSize) return false;
  if (draft.kind === "bin") return valid("compartmentsX") && valid("compartmentsY");
  return draft.kind !== "insert" || draft.pockets.every(pocketDraftValid);
}

// Checks the part's overall size against a printer area; `rotated` means it only fits turned 90°.
export function partFit(draft, magnetsValid, area) {
  const { validSize, guide } = partSummary(draft, magnetsValid);
  if (!validSize) return { rotated: false };
  try { return { rotated: checkPrintFit(area, guide.width, guide.depth, guide.height, "This part").rotation === 90 }; }
  catch (error) { return { error: error.message, rotated: false }; }
}

export function createPartPlanner({ notify = run => run() } = {}) {
  let pocketCounter = 0;
  const newPocket = () => newPocketDraft(++pocketCounter);
  let state = {
    draft: { kind: "bin", fields: { columns: "2", rows: "3", heightUnits: "3", floor: "2", wall: "1.2", compartmentsX: "1", compartmentsY: "1" },
      lip: true, openSides: [], closeGaps: false, magnets: false, pockets: [newPocket()] },
    message: { text: "", error: false },
  };
  const listeners = new Set();
  const put = patch => { state = { ...state, ...patch }; };
  const emit = () => notify(() => { for (const listener of listeners) listener(); });
  const act = fn => (...args) => { try { return fn(...args); } finally { emit(); } };
  const say = (text = "", error = false) => put({ message: { text, error } });
  const edit = (patch, text) => { put({ draft: { ...state.draft, ...patch } }); say(text); };
  const editPocket = (index, change, text) => edit({ pockets: state.draft.pockets.map(pocket => pocket.index === index ? change(pocket) : pocket) }, text);

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setKind: act(kind => edit({ kind })),
    setField: act((name, text) => edit({ fields: { ...state.draft.fields, [name]: text } })),
    setLip: act(lip => edit({ lip })),
    setWalls: act((openSides, closeGaps) => edit({ openSides, closeGaps })),
    setCloseGaps: act(closeGaps => edit({ closeGaps })),
    setMagnets: act(magnets => edit({ magnets })),
    edited: act(() => say()),
    addPocket: act(() => { if (state.draft.pockets.length < MAX_POCKETS) edit({ pockets: [...state.draft.pockets, newPocket()] }); }),
    removePocket: act(index => edit({ pockets: state.draft.pockets.filter(pocket => pocket.index !== index) })),
    setPocket: act((index, patch) => editPocket(index, pocket => ({ ...pocket, ...patch }))),
    setPocketField: act((index, name, text) => editPocket(index, pocket => ({ ...pocket, fields: { ...pocket.fields, [name]: text } }))),
    applyReference: act((index, body) => editPocket(index, pocket => ({ ...pocket, ...referencePatch(pocket, body), referenceBodyId: body.id }),
    "Envelope dimensions copied. Set the pocket's depth and orientation.")),
    showError: act(error => say(error.message || String(error), true)),
  };
}
