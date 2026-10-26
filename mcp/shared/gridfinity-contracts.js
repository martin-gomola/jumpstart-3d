import { BIN_SIDES } from "./gridfinity-walls.js";
import { GRIDFINITY_LIMITS } from "./gridfinity-limits.js";
const number = (minimum, maximum) => ({ type: "number", minimum, maximum });
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const text = maxLength => ({ type: "string", minLength: 1, maxLength });
const vector = (length, bound = 10000) => ({ type: "array", minItems: length, maxItems: length, items: number(-bound, bound) });
const object = (properties, required) => ({ type: "object", additionalProperties: false, properties, required });
const point2 = vector(2);
export const magnetPocketsSchema = { oneOf: [
  { type: "boolean" },
  object({ diameter: number(2, 8), depth: number(0.5, 4) }, []),
], description: "Optional four magnet pockets per 42 mm cell, on 26 mm centers. true uses 6.5 mm pocket diameter and 2.4 mm pocket depth for nominal 6x2 magnets with glue clearance. Object dimensions describe the pocket, not the magnet. Printed fit needs calibration." };
export const openSidesSchema = { type: "array", maxItems: 4, uniqueItems: true, items: { type: "string", enum: [...BIN_SIDES] }, description: "Bin-only openings from the inside floor upward, including the rim. Left/right are -X/+X; front/back are -Y/+Y. Open matching sides on adjacent separately printed bins. The protected base and floor remain intact. Dividers are unchanged; no mechanical connector is generated." };
export const closeGapsSchema = { type: "boolean", description: "Bin-only; requires openSides. Square corners adjoining open edges and extend the body from the foot tops at Z=4.75 mm by 0.25 mm per open edge to the grid boundary. Enable on both adjoining bins for nominal flush contact. Feet below Z=4.75 mm remain unchanged; no rounded ledge under the joining edge. No connector or physical fit guarantee." };
export const gridfinityOperationSchema = object({
  id: text(80), type: { const: "gridfinity" }, name: text(80), kind: { type: "string", enum: ["insert", "bin", "baseplate"] },
  columns: integer(1, GRIDFINITY_LIMITS.columns), rows: integer(1, GRIDFINITY_LIMITS.rows), heightUnits: integer(2, 12), floor: number(0.8, 6), wall: number(0.8, 4), lip: { type: "boolean" }, openSides: openSidesSchema, closeGaps: closeGapsSchema,
  dividers: object({ x: integer(0, 6), y: integer(0, 6) }, []), magnets: magnetPocketsSchema, position: vector(3), rotation: vector(3, 360),
}, ["id", "type", "kind"]);
gridfinityOperationSchema.description = "Editable Gridfinity insert, bin or matching baseplate. 42 mm pitch; insert/bin footprint 42*n-0.5 mm (closeGaps adds 0.25 mm per open edge), top Z=7*heightUnits. Plain baseplate height is 5 mm; magnets add a perforated carrier of pocket depth +0.8 mm beneath it. Its baseplatePlacementZ reports the aligned bin-bottom height. Lip/dividers/openSides/closeGaps are bin-only. Open sides remove walls and their rim above the floor for separately printed adjoining bins. Maximum 6x6 cells.";
const segment = { oneOf: [
  object({ type: { const: "line" }, start: point2, end: point2 }, ["type", "start", "end"]),
  object({ type: { const: "arc" }, start: point2, through: point2, end: point2 }, ["type", "start", "through", "end"]),
] };
export const pocketOperationSchema = object({
  id: text(80), type: { const: "pocket" }, target: text(80), profile: { oneOf: [
    object({ type: { const: "circle" }, radius: number(0.01, 10000) }, ["type", "radius"]),
    object({ type: { const: "roundedRect" }, width: number(0.02, 10000), height: number(0.02, 10000), radius: number(0.01, 10000) }, ["type", "width", "height", "radius"]),
    object({ type: { const: "capsule" }, length: number(0.02, 10000), width: number(0.02, 10000) }, ["type", "length", "width"]),
    object({ type: { const: "contour" }, segments: { type: "array", minItems: 2, maxItems: 64, items: segment } }, ["type", "segments"]),
  ] }, position: point2, rotation: number(-360, 360), depth: number(0.01, 10000), clearance: number(0, 10),
  minimumFloor: number(0.1, 10000), minimumWall: number(0.1, 10000), merge: { type: "boolean" }, referenceBodyId: text(80),
  sourceEvidence: object({ product: text(160), variant: text(160), url: text(2000), units: { type: "string", enum: ["mm", "cm", "in"] }, kind: { type: "string", enum: ["measured", "manufacturer", "model", "estimate"] } }, ["product", "kind"]),
}, ["id", "type", "target", "profile", "depth", "clearance", "minimumFloor", "minimumWall"]);
pocketOperationSchema.description = "Measured vertical pocket in an unchanged Gridfinity insert. Position is body-local XY; rotation is degrees about Z; cuts downward from insert top. Clearance is a true per-side 2D offset. Floor/wall and conservative neighboring-pocket bounds are enforced; merge authorizes overlap. Imported reconstruction and arbitrary 3D offset are unsupported. sourceEvidence records provenance without fetching URLs.";

export const drawerLayoutOperationSchema = object({
  id: text(80), type: { const: "drawerLayout" }, layoutId: { type: "string", minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" }, name: text(80),
  width: number(42, 881.99), depth: number(42, 881.99), height: number(14, 10000),
  includeBaseplate: { type: "boolean" }, baseplateMagnets: magnetPocketsSchema,
  baseplateClips: { oneOf: [{ type: "boolean" }, object({ clearance: number(0.05, 0.4) }, [])], description: "Optional separate straight clips that join neighbouring baseplate tiles. Each 2 mm wide, 16 mm bar fits a 2 mm deep slot cut up from the bed side, so the bin-seating profile is unchanged. Up to two per tile joint, across the joint at interior grid nodes; a one-cell joint gets one bar along it. Default per-side clearance 0.15 mm. Does not reduce baseplate material; requires baseplates. Physical fit requires a test print." },
  replaceExisting: { type: "boolean" }, floor: number(0.8, 6), wall: number(0.8, 4),
  cornerSpacers: { oneOf: [{ type: "boolean" }, object({ clearance: number(0, 1), height: number(1, 12), legLength: number(5, 60) }, [])], description: "Optional four separate native corner stops in unused drawer margins. Default outer-edge clearance 0.2 mm, height 5 mm, legs 20 mm. Requires baseplates; narrow margins fail validation. Physical fit requires calibration." },
  printArea: { oneOf: [{ type: "boolean", const: false }, object({ name: text(80), width: number(1, 2000), depth: number(1, 2000), height: number(1, 2000), edgeMargin: number(0, 20) }, ["width", "depth", "height"])], description: "Optional per-part printer envelope in mm. edgeMargin reserves space at each XY edge (default 2 mm). Baseplate tiling adapts to usable area up to native 6x6. Bins and spacers must fit individually, allowing 90-degree XY rotation. No whole-layout print-bed packing." },
  binLimits: object({ columns: integer(1, GRIDFINITY_LIMITS.columns), rows: integer(1, GRIDFINITY_LIMITS.rows) }, []),
  bins: { type: "array", minItems: 0, maxItems: 16, items: object({ id: text(80), label: text(80), x: integer(0, 19), y: integer(0, 19), columns: integer(1, GRIDFINITY_LIMITS.columns), rows: integer(1, GRIDFINITY_LIMITS.rows), heightUnits: integer(2, 12), kind: { type: "string", enum: ["bin", "insert"] }, openSides: openSidesSchema, closeGaps: closeGapsSchema, lip: { type: "boolean" }, magnets: magnetPocketsSchema, dividers: object({ x: integer(0, 6), y: integer(0, 6) }, []) }, ["id", "x", "y", "columns", "rows"]) },
}, ["id", "type", "width", "depth", "height", "bins"]);
drawerLayoutOperationSchema.description = "Measured rectangular drawer in mm with nonoverlapping cell-aligned bins. x/y are whole cells from the front-left; +Y points to the back. Grid pitch is 42 mm. Matching baseplates default to 4x4 tiles; printArea enables printer-sized tiles up to 6x6. Bin limits default to 4x4; binLimits configures up to 6x6. Zero bins are allowed when matching baseplates are enabled. Up to 16 bins, 20 cells per direction and 144 generated grid cells. layoutId persists native layout ownership; replaceExisting explicitly regenerates an unchanged existing layout. Rejects native edits, missing parts, locks and dependencies. Preview and inspect before apply.";
