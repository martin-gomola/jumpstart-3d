import { binFootprint, binTotalHeight } from "../../shared/gridfinity-walls.js";
import { magnetCarrierHeight } from "../../shared/gridfinity-magnets.js";
import { GRIDFINITY_LIMITS } from "../../shared/gridfinity-limits.js";
import { checkPrintFit } from "../../shared/print-area.js";
import { numberValid } from "./drawer-planner.js";

export const PART_TEMPLATES = [
  ["insert", "Custom insert", "A solid blank with measured pockets"],
  ["bin", "Bin", "Open storage with optional dividers"],
  ["baseplate", "Baseplate", "A matching grid for your drawer"],
];
export const PART_LIMITS = {
  columns: { min: 1, max: GRIDFINITY_LIMITS.columns, step: 1 }, rows: { min: 1, max: GRIDFINITY_LIMITS.rows, step: 1 },
  heightUnits: { min: 2, max: 12, step: 1 }, floor: { min: 0.8, max: 6 }, wall: { min: 0.8, max: 4 },
  dividersX: { min: 0, max: 6, step: 1 }, dividersY: { min: 0, max: 6, step: 1 },
};
export const POCKET_LIMITS = {
  width: { min: 1, max: 1000 }, height: { min: 1, max: 1000 }, radius: { min: 0.1, max: 500 }, depth: { min: 0.1, max: 1000 },
  clearance: { min: 0, max: 5 }, x: { min: -1000, max: 1000 }, y: { min: -1000, max: 1000 }, rotation: { min: -360, max: 360 },
};
export const MAX_POCKETS = 8;

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
  const footprint = binFootprint({ columns: state.columns, rows: state.rows, closeGaps: kind === "bin" && state.closeGaps, openSides: state.openSides });
  const width = kind === "baseplate" ? state.columns * 42 : footprint.width;
  const depth = kind === "baseplate" ? state.rows * 42 : footprint.depth;
  let magneticHeight = "";
  if (kind === "baseplate" && magnetsValid) magneticHeight = ` Baseplate height ${(5 + magnetCarrierHeight(magnets)).toFixed(1)} mm.`;
  if (magnetsReady) magneticHeight += ` ${state.columns * state.rows * 4} magnet pockets, ${kind === "baseplate" ? "open from the top of the carrier" : "open underneath"}.`;
  const height = kind === "baseplate" ? 5 + (magnetsReady ? magnetCarrierHeight(magnets) : 0)
    : kind === "bin" ? binTotalHeight({ heightUnits: state.heightUnits, floor: state.floor, lip: state.lip, openSides: state.openSides, dividers: { x: state.dividersX, y: state.dividersY } })
    : state.heightUnits * 7;
  const valid = name => numberValid(draft.fields[name], PART_LIMITS[name]);
  const validSize = valid("columns") && valid("rows") && (kind === "baseplate" || valid("heightUnits") && valid("floor") && valid("wall")) && magnetsValid;
  return {
    validSize,
    dimensions: validSize ? `${width} × ${depth} × ${height.toFixed(1)} mm overall. One grid cell is 42 mm.${magneticHeight}` : "Enter a valid size to update the sizing guide.",
    heightNote: kind === "bin" && state.openSides.length === 4 ? "All sides are open. Only the floor and any dividers remain." : kind === "bin" && state.lip ? "The stackable rim adds 4.4 mm to the body height." : "Heights increase in 7 mm steps to match the grid system.",
    guide: { ...(validSize ? { width, depth, height } : {}), kind, columns: state.columns, rows: state.rows },
  };
}

export function createPartPlanner({ request, getPrintArea = () => false, notify = run => run() }) {
  let pocketCounter = 0, previewSeq = 0, successSeq = 0;
  const newPocket = () => ({ index: ++pocketCounter, shape: "roundedRect", referenceBodyId: null, evidenceKind: "estimate", sourceUnits: "mm", merge: false, product: "", url: "",
    fields: { width: "40", height: "30", radius: "3", depth: "8", clearance: "0.3", x: "0", y: "0", rotation: "0" } });
  let state = {
    draft: { kind: "bin", fields: { columns: "2", rows: "3", heightUnits: "3", floor: "2", wall: "1.2", dividersX: "0", dividersY: "0" },
      lip: true, openSides: [], closeGaps: false, magnets: false, pockets: [newPocket()] },
    busy: false, busyLabel: "", cached: null, preview: null, success: 0, message: { text: "", error: false }, document: null,
  };
  const listeners = new Set();
  const put = patch => { state = { ...state, ...patch }; };
  const emit = () => notify(() => { for (const listener of listeners) listener(); });
  const act = fn => (...args) => { try { return fn(...args); } finally { emit(); } };
  function invalidate(text, { discard = false } = {}) {
    put({ cached: null, success: 0, message: { text: typeof text === "string" ? text : "", error: false }, ...(discard ? { preview: null } : {}) });
  }
  const showError = error => put({ message: { text: error.message || String(error), error: true } });
  const edit = (patch, text) => { put({ draft: { ...state.draft, ...patch } }); invalidate(text); };
  const editPocket = (index, change, text) => edit({ pockets: state.draft.pockets.map(pocket => pocket.index === index ? change(pocket) : pocket) }, text);
  const setBusy = (busy, busyLabel = "") => put({ busy, busyLabel });

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setKind: act(kind => edit({ kind })),
    setField: act((name, text) => edit({ fields: { ...state.draft.fields, [name]: text } })),
    setLip: act(lip => edit({ lip })),
    setWalls: act((openSides, closeGaps) => edit({ openSides, closeGaps })),
    setCloseGaps: act(closeGaps => edit({ closeGaps })),
    setMagnets: act(magnets => edit({ magnets })),
    edited: act(() => invalidate()),
    addPocket: act(() => { if (state.draft.pockets.length < MAX_POCKETS) edit({ pockets: [...state.draft.pockets, newPocket()] }); }),
    removePocket: act(index => edit({ pockets: state.draft.pockets.filter(pocket => pocket.index !== index) })),
    setPocket: act((index, patch) => editPocket(index, pocket => ({ ...pocket, ...patch }))),
    setPocketField: act((index, name, text) => editPocket(index, pocket => ({ ...pocket, fields: { ...pocket.fields, [name]: text } }))),
    applyReference: act((index, body) => editPocket(index, pocket => ({ ...pocket, referenceBodyId: body.id, product: body.name, evidenceKind: "model",
      fields: { ...pocket.fields, width: String(Math.round(body.dimensions.x * 1000) / 1000), height: String(Math.round(body.dimensions.y * 1000) / 1000) } }),
    "Envelope dimensions copied. Set the pocket's depth and orientation.")),
    setDocument: act(document => put({ document })),
    showError: act(showError),
    discard: act(() => invalidate(undefined, { discard: true })),
    documentChanged: act(kind => {
      if (!["preview", "version"].includes(kind) && (state.cached || state.success)) invalidate("The document changed. Preview again before adding.", { discard: !!state.success });
    }),
    cancelPreview: act(() => invalidate("Preview cancelled. The document is unchanged.", { discard: true })),
    async preview() {
      if (state.busy) return;
      invalidate(); setBusy(true, "Building preview…"); emit();
      try {
        const before = await request("get_document", {});
        const preview = await request("preview_model", { plan: templatePlan(partState(state.draft)), expectedRevision: before.revision, includeImage: true });
        if (!preview.valid) throw new Error(preview.errors.map(entry => entry.error).join(". ") || "Preview failed. Check the pocket dimensions and remaining material.");
        const printFits = [];
        for (const body of preview.bodies) {
          if (body.dimensions) printFits.push(checkPrintFit(getPrintArea(), body.dimensions.x, body.dimensions.y, body.dimensions.z, body.name));
          const inspection = await request("inspect_geometry", { previewId: preview.previewId, bodyId: body.id, mesh: true });
          if (!inspection.meshValidation?.valid || inspection.meshValidation.disconnectedComponents !== 1) throw new Error("The preview does not form one valid connected body. Adjust the parameters and preview again.");
        }
        put({ cached: preview, preview: { seq: ++previewSeq, previewId: preview.previewId, dimensions: preview.bodies[0]?.dimensions,
          images: (preview.images || []).filter(image => image.view === "isometric"), rotated: printFits.some(fit => fit.rotation === 90) },
        message: { text: "Preview ready. The document is unchanged.", error: false } });
      } catch (error) { invalidate(); showError(error); }
      finally { setBusy(false); emit(); }
    },
    async apply() {
      if (!state.cached || state.busy) return;
      const preview = state.cached; setBusy(true, "Adding…"); emit();
      try {
        await request("apply_model", { previewId: preview.previewId });
        invalidate("Added to the document. Use Undo to recover the previous state.", { discard: true });
        put({ document: await request("get_document", {}), success: ++successSeq });
      } catch (error) { invalidate(); showError(error); }
      finally { setBusy(false); emit(); }
    },
  };
}
