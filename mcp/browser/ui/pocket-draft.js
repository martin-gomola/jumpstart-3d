import { numberValid } from "./field-text.js";

export const POCKET_LIMITS = {
  width: { min: 1, max: 1000 }, height: { min: 1, max: 1000 }, radius: { min: 0.1, max: 500 }, depth: { min: 0.1, max: 1000 },
  clearance: { min: 0, max: 5 }, x: { min: -1000, max: 1000 }, y: { min: -1000, max: 1000 }, rotation: { min: -360, max: 360 },
};
export const MAX_POCKETS = 8;
export const COMPARTMENT_LIMITS = { min: 1, max: 7, step: 1 };

export const newPocketDraft = index => ({ index, shape: "roundedRect", referenceBodyId: null, evidenceKind: "estimate", sourceUnits: "mm", merge: false, product: "", url: "",
  fields: { width: "40", height: "30", radius: "3", depth: "8", clearance: "0.3", x: "0", y: "0", rotation: "0" } });
export const nextPocketIndex = pockets => pockets.reduce((max, pocket) => Math.max(max, pocket.index), 0) + 1;

// Fields that a shape does not use stay hidden and are not checked.
export const pocketFieldUsed = (shape, name) => shape === "contour" ? !["width", "height", "radius"].includes(name)
  : name === "height" ? shape !== "circle" : name === "radius" ? shape === "roundedRect" : true;
export const pocketDraftValid = draft => Object.keys(POCKET_LIMITS).every(name => !pocketFieldUsed(draft.shape, name) || numberValid(draft.fields[name], POCKET_LIMITS[name]));

export const referenceBodies = document => document?.bodies?.filter(body => body.role === "reference" && body.dimensions && !body.hidden) || [];
export const referencePatch = (draft, body) => ({ product: body.name, evidenceKind: "model",
  fields: { ...draft.fields, width: String(Math.round(body.dimensions.x * 1000) / 1000), height: String(Math.round(body.dimensions.y * 1000) / 1000) } });

// Profiles follow the editor's shape names: width is the diameter or length, height the other side.
export function pocketProfile(shape, { width, height, radius }) {
  if (shape === "circle") return { type: "circle", radius: width / 2 };
  if (shape === "capsule") return { type: "capsule", length: width, width: height };
  return { type: "roundedRect", width, height, radius };
}

export function pocketFromDraft(draft) {
  const n = name => Number(draft.fields[name]), product = draft.product.trim(), url = draft.url.trim();
  return { id: draft.id ?? `pocket-${draft.index}`, profile: draft.shape === "contour" ? draft.profile : pocketProfile(draft.shape, { width: n("width"), height: n("height"), radius: n("radius") }),
    position: [n("x"), n("y")], rotation: n("rotation"), depth: n("depth"), clearance: n("clearance"), merge: draft.merge,
    sourceEvidence: { product: product || "Pocket dimensions", kind: draft.evidenceKind, units: draft.sourceUnits, ...(url ? { url } : {}) } };
}

export function draftFromPocket(pocket, index) {
  const p = pocket.profile, text = value => String(value ?? 0), evidence = pocket.sourceEvidence;
  const size = p.type === "circle" ? { width: p.radius * 2, height: p.radius * 2, radius: 3 } : p.type === "capsule" ? { width: p.length, height: p.width, radius: 3 }
    : p.type === "roundedRect" ? { width: p.width, height: p.height, radius: p.radius } : { width: 40, height: 30, radius: 3 };
  return { index, id: pocket.id, shape: p.type, ...(p.type === "contour" ? { profile: p } : {}), referenceBodyId: null, merge: pocket.merge === true,
    evidenceKind: evidence?.kind || "estimate", sourceUnits: evidence?.units || "mm", product: evidence?.product === "Pocket dimensions" ? "" : evidence?.product || "", url: evidence?.url || "",
    fields: { width: text(size.width), height: text(size.height), radius: text(size.radius), depth: text(pocket.depth), clearance: text(pocket.clearance),
      x: text(pocket.position?.[0]), y: text(pocket.position?.[1]), rotation: text(pocket.rotation) } };
}
