#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { gridfinityOperationSchema, pocketOperationSchema, drawerLayoutOperationSchema } from "../shared/gridfinity-contracts.js";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateToolInput } from "../shared/schema.js";
import { focusCapabilities } from "./discovery.mjs";
import { failureGuidance } from "../shared/failure-guidance.js";
import { extendMcpTools } from "./tool-contracts.mjs";
import { inspectTriangleMesh } from "../shared/geometry.js";
import { clientPresence } from "./presence.mjs";
import { listManagedImports, resolveManagedImports, MAX_IMPORTS_PER_PLAN, MAX_IMPORT_CATALOG_FILES } from "./imports.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DOCS = join(ROOT, "build", "site");
const EXPORTS = join(ROOT, "exports");
const IMPORTS = resolve(process.env.JUMPSTART_MCP_IMPORT_DIR || join(ROOT, "imports"));
const HOST = process.env.JUMPSTART_MCP_HOST || "127.0.0.1";
const BROWSER_HOST = "localhost";
const PORT = Number(process.env.JUMPSTART_MCP_PORT || 3210);
const HTTP_ONLY = process.env.JUMPSTART_MCP_HTTP_ONLY === "1";
const MAX_HTTP_BODY = 48 * 1024 * 1024;
const MAX_QUEUED_COMMANDS = 32;
const EDITOR_STALE_MS = 15_000;
const POLL_TIMEOUT_MS = 25_000;
const PROTOCOL_VERSION = "2026-07-28";
const SUPPORTED_VERSIONS = [PROTOCOL_VERSION, "2025-11-25"];

const axes = ["X", "Y", "Z"];
const commonEditor = {
  editorId: { type: "string", minLength: 1, maxLength: 120, description: "Editor id from jumpstart_list_editors. Required when more than one editor is open." },
};
const point2 = { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } };
const point3 = { type: "array", minItems: 3, maxItems: 3, items: { type: "number" } };
const profileSchema = {
  oneOf: [
    {
      type: "object", additionalProperties: false, required: ["type", "points"],
      properties: { type: { const: "polygon" }, points: { type: "array", minItems: 3, maxItems: 128, items: point2 } },
    },
    {
      type: "object", additionalProperties: false, required: ["type", "center", "radius"],
      properties: { type: { const: "circle" }, center: point2, radius: { type: "number", exclusiveMinimum: 0, maximum: 10000 } },
    },
    {
      type: "object", additionalProperties: false, required: ["type", "width", "height", "radius"],
      properties: {
        type: { const: "roundedRect" }, width: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
        height: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, radius: { type: "number", exclusiveMinimum: 0, maximum: 5000 }, center: point2,
      },
    },
    {
      type: "object", additionalProperties: false, required: ["type", "segments"],
      properties: {
        type: { const: "contour" },
        segments: {
          type: "array", minItems: 1, maxItems: 64,
          items: { oneOf: [
            { type: "object", additionalProperties: false, required: ["type", "start", "end"], properties: { type: { const: "line" }, start: point2, end: point2 } },
            { type: "object", additionalProperties: false, required: ["type", "start", "through", "end"], properties: { type: { const: "arc" }, start: point2, through: point2, end: point2 } },
            { type: "object", additionalProperties: false, required: ["type", "points"], properties: { type: { const: "spline" }, points: { type: "array", minItems: 3, maxItems: 128, items: point2 }, closed: { type: "boolean" } } },
          ] },
        },
      },
    },
  ],
};
const primitiveSchema = {
  type: "object", additionalProperties: false, required: ["id", "kind"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80 }, name: { type: "string", maxLength: 80 },
    kind: { type: "string", enum: ["box", "cylinder", "sphere", "cone", "pyramid", "wedge", "torus", "tube", "hemisphere", "prism", "text", "star", "heart", "roof", "roundroof", "paraboloid", "gem", "spring", "capsule", "arrow"] },
    parameters: { type: "object", additionalProperties: false, properties: {
      w: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, d: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, h: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
      r: { type: "number", minimum: 0, maximum: 10000 }, c: { type: "number", minimum: 0, maximum: 10000 }, top: { type: "number", minimum: 0, maximum: 10000 },
      sides: { type: "integer", minimum: 3, maximum: 64 }, tube: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, wall: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
      text: { type: "string", minLength: 1, maxLength: 256 }, size: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, font: { type: "string", minLength: 1, maxLength: 80 },
      points: { type: "integer", minimum: 3, maximum: 64 }, inner: { type: "number", exclusiveMinimum: 0, maximum: 1 }, turns: { type: "integer", minimum: 1, maximum: 100 }, wire: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
    } },
    position: point3, rotation: point3, hole: { type: "boolean" },
  },
};
const edgeSignatureSchema = { type: "object", additionalProperties: false, required: ["m", "n", "t"], properties: { index: { type: "integer", minimum: 0 }, a: point3, b: point3, m: point3, n: point3, t: { type: "string", maxLength: 40 } } };
const modifierSchema = { oneOf: [
  { type: "object", additionalProperties: false, required: ["type", "radius", "edges"], properties: { type: { const: "fillet" }, radius: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, edges: { type: "array", minItems: 1, maxItems: 512, items: edgeSignatureSchema }, chain: { type: "boolean" } } },
  { type: "object", additionalProperties: false, required: ["type", "distance", "edges"], properties: { type: { const: "chamfer" }, distance: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, edges: { type: "array", minItems: 1, maxItems: 512, items: edgeSignatureSchema }, chain: { type: "boolean" } } },
  { type: "object", additionalProperties: false, required: ["type", "distance", "faces"], properties: { type: { const: "offset" }, distance: { oneOf: [{ type: "number", exclusiveMinimum: 0, maximum: 10000 }, { type: "number", minimum: -10000, exclusiveMaximum: 0 }], description: "Signed face offset in mm. Positive adds material; negative removes material." }, faces: { type: "array", minItems: 1, maxItems: 256, items: { type: "object", additionalProperties: false, required: ["c", "t"], properties: { c: point3, t: { type: "string", enum: ["PLANE", "CYLINDRE", "SPHERE"] }, n: point3 } } } } },
  { type: "object", additionalProperties: false, required: ["type", "thickness", "faces"], properties: { type: { const: "shell" }, thickness: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, faces: { type: "array", maxItems: 256, items: { type: "object", additionalProperties: false, required: ["c"], properties: { index: { type: "integer", minimum: 0 }, c: point3, n: point3, t: { type: "string" }, r: { type: "number" }, ext: { type: "boolean" }, o: point3, d: point3, ax: point3 } } }, direction: { type: "string", enum: ["in", "out", "both"] } } },
  { type: "object", additionalProperties: false, required: ["type", "at", "diameter"], properties: { type: { const: "hole" }, at: { type: "array", minItems: 1, maxItems: 64, items: { type: "object", additionalProperties: false, required: ["p", "n"], properties: { p: point3, n: point3 } } }, diameter: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, kind: { type: "string", enum: ["simple", "cbore", "csink", "tapped"] }, through: { type: "boolean" }, depth: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, counterboreDiameter: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, counterboreDepth: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, countersinkDiameter: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, countersinkAngle: { type: "number", minimum: 1, maximum: 179 }, tip: { type: "boolean" }, pitch: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, clearance: { type: "number", minimum: 0, maximum: 10000 } } },
  { type: "object", additionalProperties: false, required: ["type", "face", "pitch"], properties: { type: { const: "thread" }, face: { type: "object", additionalProperties: false, required: ["c", "t"], properties: { index: { type: "integer", minimum: 0 }, c: point3, t: { const: "CYLINDRE" }, n: point3, r: { type: "number" }, ext: { type: "boolean" }, o: point3, d: point3, ax: point3 } }, pitch: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, length: { type: "number", minimum: 0, maximum: 10000 }, flip: { type: "boolean" }, left: { type: "boolean" }, clearance: { type: "number", minimum: 0, maximum: 10000 } } },
  { type: "object", additionalProperties: false, required: ["type", "geo", "text", "size", "depth"], properties: { type: { const: "emboss" }, geo: { type: "object", additionalProperties: false, required: ["kind", "p", "n", "x"], properties: { kind: { const: "plane" }, p: point3, n: point3, x: point3 } }, text: { type: "string", minLength: 1, maxLength: 256 }, font: { type: "string", maxLength: 80 }, size: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, depth: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, mode: { type: "string", enum: ["emboss", "deboss"] }, angle: { type: "number", minimum: -360, maximum: 360 } } },
  { type: "object", additionalProperties: false, required: ["type", "factors"], properties: { type: { const: "scale" }, factors: point3, offset: point3 } },
] };
const fastenerSize = { type: "string", enum: ["M2.5", "M3", "M4", "M5", "M6", "M8", "M10", "M12", "#6-32", "#8-32", "#10-24", "#10-32", "1/4-20", "1/4-28", "5/16-18", "5/16-24", "3/8-16", "3/8-24", "1/2-13", "1/2-20"] };
const planOperationSchema = { oneOf: [
  gridfinityOperationSchema, pocketOperationSchema, drawerLayoutOperationSchema,
  { type: "object", additionalProperties: false, required: ["id", "type", "target", "role"], properties: { id: { type: "string", minLength: 1, maxLength: 80 }, type: { const: "setRole" }, target: { type: "string", minLength: 1, maxLength: 80 }, role: { type: "string", enum: ["design", "reference", "hardware"], description: "Manufacturing intent, independent of visibility. Missing roles default to design. Reference bodies are excluded from exports; hardware requires assembly scope." } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "assetId"], properties: { id: { type: "string", minLength: 1, maxLength: 80 }, type: { const: "import" }, assetId: { type: "string", pattern: "^[a-f0-9]{64}$", description: "SHA-256 asset id returned by jumpstart_list_imports. It references a file in the operator-managed imports directory; no path or file bytes are accepted." }, units: { type: "string", enum: ["mm", "cm", "in"], description: "Required for STL files. 3MF and STEP retain units encoded in their files." }, position: point3, rotation: point3 } },
  { type: "object", additionalProperties: false, required: ["id", "type", "members"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "group" }, name: { type: "string", maxLength: 80 }, members: { type: "array", minItems: 1, maxItems: 64, items: { type: "string", maxLength: 80 }, description: "A pattern reference may expand to multiple body instances before grouping." }, operation: { type: "string", enum: ["union", "cut", "intersect"] } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "source", "plane"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "mirror" }, source: { type: "string", maxLength: 80 }, plane: { type: "object", additionalProperties: false, required: ["normal"], properties: { origin: point3, normal: point3 } }, behavior: { type: "string", enum: ["linked", "join"], description: "Defaults to linked, which creates a new body that follows its source. Join keeps one body and merges a snapshot of the reflected source into it." } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "target", "plane"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "splitBody" }, target: { type: "string", maxLength: 80 }, plane: { type: "object", additionalProperties: false, required: ["origin", "normal"], properties: { origin: point3, normal: point3 }, description: "World-space plane in mm. The normalized positive-normal side keeps the target body id; the opposite side receives a new id." } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "source", "mode", "axis", "count"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "pattern" }, source: { type: "string", maxLength: 80 }, mode: { type: "string", enum: ["linear", "circular"] }, axis: { type: "string", enum: axes }, count: { type: "integer", minimum: 2, maximum: 12, description: "Instances per direction for a linear pattern (count 4 with symmetric true produces 7 total); total instance count for a circular pattern, including the original." }, spacing: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, symmetric: { type: "boolean" }, angle: { type: "number", minimum: 1, maximum: 360, description: "Circular total angle. A full 360-degree pattern spaces instances around the full circle; a partial angle includes both endpoints." }, origin: point3 } },
  { type: "object", additionalProperties: false, required: ["id", "type", "source", "path", "count"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "pathPattern" }, source: { type: "string", maxLength: 80 }, path: { type: "string", maxLength: 80, description: "An earlier typed path sketch made from connected lines and three-point arcs." }, mode: { type: "string", enum: ["fit", "spacing"], description: "Fit spaces count instances to an open path endpoint or around a closed path; spacing places count instances at an explicit interval." }, count: { type: "integer", minimum: 2, maximum: 12, description: "Total body instances, including the unchanged source body." }, spacing: { type: "number", exclusiveMinimum: 0, maximum: 10000, description: "Required when mode is spacing. Copies must fit between the anchor station and the selected endpoint, or within one closed loop." }, direction: { type: "string", enum: ["forward", "reverse"] }, orientation: { type: "string", enum: ["same", "follow-path"], description: "follow-path rotates each copy by the path tangent change from the source anchor station." }, anchor: { ...point3, description: "Optional world-space anchor projected to the nearest path point. Defaults to the source body's transformed local origin; the original body transform is preserved." } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "target", "features", "mode", "axis", "count"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "featurePattern" }, target: { type: "string", maxLength: 80 }, features: { type: "array", minItems: 1, maxItems: 24, items: { type: "string", maxLength: 80 }, description: "Stable feature references: earlier modifier or boolean-feature operation ids, or native modifier ids from geometry inspection. Supported: holes, embosses, and sketch-backed extrude/revolve/sweep booleans." }, mode: { type: "string", enum: ["linear", "circular"] }, axis: { type: "string", enum: axes, description: "World-space axis. Feature positions and directions are transformed into the target body's local coordinates." }, count: { type: "integer", minimum: 2, maximum: 12, description: "Linear count means copies per side when symmetric is true. Circular count includes the source." }, spacing: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, symmetric: { type: "boolean" }, angle: { type: "number", minimum: 1, maximum: 360 }, origin: point3 } },
  { type: "object", additionalProperties: false, required: ["id", "type", "target"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "transform" }, target: { type: "string", maxLength: 80 }, position: point3, rotation: point3, relative: { type: "boolean" } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "target", "tool", "operation"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "combine" }, target: { type: "string", maxLength: 80 }, tool: { type: "string", maxLength: 80 }, operation: { type: "string", enum: ["join", "cut", "intersect"] }, keepTool: { type: "boolean" } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "target", "modifier"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "modifier" }, target: { type: "string", maxLength: 80 }, modifier: modifierSchema } },
  { type: "object", additionalProperties: false, required: ["id", "type", "fastenerType", "size"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "fastener" }, fastenerType: { type: "string", enum: ["bolt", "nut", "rod", "cutter"] }, size: fastenerSize, length: { type: "number", exclusiveMinimum: 0, maximum: 10000, description: "Length in mm. Required for bolt, rod, and cutter; ignored for nut." }, clearance: { type: "number", minimum: -1, maximum: 0, description: "Thread print offset in mm. Default 0; values down to -1 loosen mating printed threads." }, left: { type: "boolean" }, position: point3, rotation: point3, name: { type: "string", maxLength: 80 } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "gearType", "module", "teeth", "thickness"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "gear" }, gearType: { type: "string", enum: ["spur", "rack", "bevel"] }, module: { type: "number", minimum: 0.2, maximum: 50, description: "Metric gear module in mm." }, teeth: { type: "integer", minimum: 6, maximum: 120, description: "Integer tooth count. Rack length is module × tooth count × π." }, pressureAngle: { type: "number", minimum: 14, maximum: 30, description: "Pressure angle in degrees; defaults to 20." }, thickness: { type: "number", minimum: 0.1, maximum: 10000, description: "Face width in mm. For a bevel gear this is its axial width." }, coneAngle: { type: "number", minimum: 5, maximum: 80, description: "Pitch cone angle in degrees for a straight bevel gear; defaults to 45. Teeth are an approximation lofted between scaled sampled involute sections; mating accuracy is not certified, and spiral bevel teeth are not generated." }, bore: { type: "number", minimum: 0, maximum: 10000, description: "Optional spur or bevel gear center bore diameter in mm; it must fit inside the smallest root diameter and is not supported for racks." }, baseDepth: { type: "number", minimum: 0.1, maximum: 10000, description: "Rack backing depth below the standard tooth roots in mm; defaults to twice the module and is not supported for gears." }, position: point3, rotation: point3, name: { type: "string", maxLength: 80 } } },
  { type: "object", additionalProperties: false, required: ["id", "type"], properties: { id: { type: "string", maxLength: 80 }, type: { const: "knurl" }, diameter: { type: "number", minimum: 6, maximum: 150, description: "Knob outside diameter in mm; defaults to 20." }, length: { type: "number", minimum: 1, maximum: 200, description: "Axial extrusion length in mm; defaults to 15." }, grooves: { type: "integer", minimum: 8, maximum: 120, description: "Number of axial V grooves; defaults to about one groove per mm of circumference. Pitch below 0.8 mm may be too fine to print clearly on common FDM printers." }, depth: { type: "number", minimum: 0.1, maximum: 75, description: "Groove depth in mm. Must be deep enough to remain visible and no deeper than half the radius; defaults to half the groove pitch." }, bore: { type: "string", enum: ["none", "round", "hex", "d"], description: "Optional editable center bore. Hex size is measured across flats; D-flat faces +X." }, boreSize: { type: "number", minimum: 1, maximum: 300, description: "Bore diameter, or hex across-flats dimension, in mm. The design validator enforces one millimeter of remaining wall under the groove roots." }, position: point3, rotation: point3, name: { type: "string", maxLength: 80 } } },
  { type: "object", additionalProperties: false, required: ["id", "type", "width", "phoneLength", "angle", "plateThickness", "ribThickness", "stopHeight", "stopDepth", "topEdgeToward", "position"], properties: {
    id: { type: "string", maxLength: 80 }, type: { const: "phoneCradle" }, name: { type: "string", maxLength: 80 },
    width: { type: "number", minimum: 30, maximum: 500, description: "Phone-rest width across world X in mm." },
    phoneLength: { type: "number", minimum: 30, maximum: 300, description: "Length of the phone contact surface along its incline, in mm." },
    angle: { type: "number", minimum: 10, maximum: 70, description: "Incline from horizontal in degrees." },
    plateThickness: { type: "number", minimum: 1, maximum: 10, description: "Thin phone contact plate thickness in mm." },
    ribThickness: { type: "number", minimum: 2, maximum: 30, description: "Width of each of the two side-support ribs, in mm." },
    stopHeight: { type: "number", minimum: 3, maximum: 40, description: "Phone lower-stop height in mm." },
    stopDepth: { type: "number", minimum: 2, maximum: 20, description: "Phone lower-stop depth in mm." },
    topEdgeToward: { type: "string", enum: ["+Y", "-Y"], description: "+Y means the phone top edge leans toward the dashboard; -Y means it leans toward the driver. The screen faces the opposite Y direction." },
    position: { ...point3, description: "World-space center of the phone's lower edge at the support base: [X across width, Y front/back, Z up], in mm." },
  } },
  { type: "object", additionalProperties: false, required: ["id", "type", "target", "face", "layout"], properties: {
    id: { type: "string", maxLength: 80 }, type: { const: "holePattern" }, target: { type: "string", maxLength: 80 },
    face: { type: "string", enum: ["+x", "-x", "+y", "-y", "+z", "-z"], description: "World direction of the flat face. The farthest matching planar face is selected." },
    layout: { oneOf: [
      { type: "object", additionalProperties: false, required: ["type", "cols", "rows"], properties: { type: { const: "grid" }, cols: { type: "integer", minimum: 1, maximum: 200 }, rows: { type: "integer", minimum: 1, maximum: 200 }, pitch: { oneOf: [{ type: "number", exclusiveMinimum: 0, maximum: 10000 }, { type: "array", minItems: 2, maxItems: 2, items: { type: "number", exclusiveMinimum: 0, maximum: 10000 } }] }, margin: { type: "number", minimum: 0, maximum: 10000 }, stagger: { type: "boolean" }, angle: { type: "number", minimum: -360, maximum: 360 } } },
      { type: "object", additionalProperties: false, required: ["type", "count", "radius"], properties: { type: { const: "circle" }, count: { type: "integer", minimum: 2, maximum: 200 }, radius: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, start: { type: "number", minimum: -360, maximum: 360 }, center: point3, margin: { type: "number", minimum: 0, maximum: 10000 } } },
    ] },
    shape: { type: "string", enum: ["round", "square", "hex", "slot"], description: "Defaults to round. Square, hex, and slot cuts are editable sketch-and-extrude features." },
    width: { type: "number", exclusiveMinimum: 0, maximum: 10000, description: "Required for square, hex, or slot. For a hex, width is across flats." },
    length: { type: "number", exclusiveMinimum: 0, maximum: 10000, description: "Slot length, greater than width. Omit for square and hex." },
    depth: { type: "number", exclusiveMinimum: 0, maximum: 10000, description: "Blind depth for shaped cuts; omit for through cuts." },
    hole: { type: "object", additionalProperties: false, required: ["diameter"], description: "Required for round patterns; omit for shaped cuts.", properties: { kind: { type: "string", enum: ["simple", "cbore", "csink", "tapped"] }, diameter: { type: "number", exclusiveMinimum: 0, maximum: 10000, description: "Hole or tap-drill diameter in mm." }, depth: { type: "number", exclusiveMinimum: 0, maximum: 10000, description: "Omit for through holes." }, counterboreDiameter: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, counterboreDepth: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, countersinkDiameter: { type: "number", exclusiveMinimum: 0, maximum: 10000 }, countersinkAngle: { type: "number", minimum: 1, maximum: 179 }, pitch: { type: "number", exclusiveMinimum: 0, maximum: 10000, description: "Thread pitch in mm for tapped holes." }, clearance: { type: "number", minimum: -1, maximum: 0 }, tip: { type: "boolean" } } },
  } },
] };
const planSchema = {
  type: "object", additionalProperties: false, required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    mode: { type: "string", enum: ["beginner", "advanced"] },
    primitives: { type: "array", maxItems: 64, items: primitiveSchema },
    planes: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["id", "plane"], properties: { id: { type: "string", maxLength: 80 }, name: { type: "string", maxLength: 80 }, plane: { type: "string", enum: ["XY", "XZ", "YZ"] }, origin: point3 } } },
    sketches: {
      type: "array", maxItems: 12,
      items: {
        type: "object", additionalProperties: false, required: ["id", "plane", "origin"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          name: { type: "string", maxLength: 80 },
          plane: { type: "string", enum: ["XY", "XZ", "YZ"] },
          origin: point3,
          profile: profileSchema,
          segments: {
            description: "Optional ordered path geometry instead of a closed profile. Supports connected line segments and three-point arcs in this sketch's plane.",
            type: "array", minItems: 1, maxItems: 64,
            items: { oneOf: [
              { type: "object", additionalProperties: false, required: ["type", "start", "end"], properties: { type: { const: "line" }, start: point2, end: point2 } },
              { type: "object", additionalProperties: false, required: ["type", "start", "through", "end"], properties: { type: { const: "arc" }, start: point2, through: point2, end: point2 } },
            ] },
          },
        },
      },
    },
    features: {
      type: "array", maxItems: 24,
      items: {
        type: "object", additionalProperties: false, required: ["id", "type"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          name: { type: "string", maxLength: 80 },
          type: { type: "string", enum: ["revolve", "extrude", "loft", "sweep", "pipe", "coil"], description: "Sweep carries a closed profile along a path sketch. Pipe creates a section along a path. Coil creates a native helical feature with a round, square, or triangular section." },
          sketch: { type: "string", minLength: 1, maxLength: 80 },
          path: { type: "string", minLength: 1, maxLength: 80, description: "Id of a path sketch made from ordered connected line and three-point arc segments." },
          sections: { type: "array", minItems: 2, maxItems: 12, items: { type: "string", maxLength: 80 } },
          operation: { type: "string", enum: ["new", "join", "cut"] },
          target: { type: "string", maxLength: 80 },
          axis: { type: "string", enum: axes },
          angle: { type: "number", minimum: -60, maximum: 360, description: "Revolve angle is 1 to 360 degrees; coil taper angle is -60 to 60 degrees." },
          distance: { type: "number", exclusiveMinimum: -10000, exclusiveMaximum: 10000 },
          mode: { type: "string", enum: ["one", "sym", "two", "height", "pitch"], description: "For coils, choose height or pitch mode; other features use one, sym, or two." },
          distance2: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
          ruled: { type: "boolean" }, closed: { type: "boolean" },
          section: { type: "string", enum: ["circle", "square", "triangle", "triangle-in"] },
          size: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
          hollow: { type: "boolean" },
          wall: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
          d: { type: "number", minimum: 0.1, maximum: 10000, description: "Coil centerline diameter in mm." },
          turns: { type: "number", minimum: 0.25, maximum: 100, description: "Coil turns, including fractional turns." },
          h: { type: "number", minimum: 0.1, maximum: 10000, description: "Overall coil height in mm when mode is height." },
          pitch: { type: "number", minimum: 0.05, maximum: 10000, description: "Axial distance per turn in mm when mode is pitch." },
          pos: { type: "string", enum: ["inside", "on", "outside"], description: "Where the section sits relative to the coil diameter." },
          left: { type: "boolean", description: "Use a left-handed helix when true." },
          position: point3,
          rotation: { type: "array", minItems: 3, maxItems: 3, items: { type: "number", minimum: -360, maximum: 360 }, description: "Body placement rotation in degrees. The native coil axis starts along local +Z." },
          pattern: {
            type: "object", additionalProperties: false, required: ["axis", "count"],
            properties: {
              axis: { type: "string", enum: axes },
              count: { type: "integer", minimum: 2, maximum: 12 },
              angle: { type: "number", minimum: 1, maximum: 360 },
              origin: point3,
            },
          },
        },
      },
    },
    operations: { type: "array", maxItems: 128, items: planOperationSchema },
  },
};

const tools = extendMcpTools([
  {
    name: "jumpstart_list_imports",
    title: "List managed CAD imports",
    description: "List STL, 3MF, STEP, and STP files placed by the operator in the read-only managed imports directory. Returns metadata and SHA-256 asset ids only. Use an id in a typed import operation; requests never accept host paths or file bytes.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "jumpstart_list_editors",
    title: "List open JumpStart editors",
    description: "List local JumpStart browser tabs connected to this MCP server. Call this first when more than one editor may be open.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "jumpstart_get_document",
    title: "Read the active CAD document",
    description: "Read document identity, revision, units, sketches, body features, world bounds, local dimensions, volume, triangle counts, and geometry errors. With includeGeometry true, also return capped edge and face selectors in body-local millimeters for fillet, chamfer, shell, hole, thread, and emboss edits. The returned units field is the UI display preference.",
    inputSchema: { type: "object", additionalProperties: false, properties: { ...commonEditor, includeGeometry: { type: "boolean", description: "Include sketch coordinates and feature nodes so an agent can revise the editable CAD model. Large sketches are capped." } } },
  },
  {
    name: "jumpstart_preview_model",
    title: "Preview a parametric model plan",
    description: "Preview a typed CAD plan using JumpStart primitives, profiles, features, patterns, mirrors, splits, fasteners, gears, native knurled knobs, phone cradles, and modifiers. Knurls are native hidden sketches plus editable extrusions with optional round, hex, or D bores. A phoneCradle uses X across width, Y front/back (+Y toward the dashboard), and Z up; its preview images include a labeled world-axis triad. Import operator-managed STL, 3MF, STEP, or STP assets by the digest id from jumpstart_list_imports; STL requires explicit units, while 3MF and STEP retain file units. Imports are native editable document assets and remain subject to preview, inspection, and explicit apply. Returns geometry errors, dimensions, volume, triangle counts, edge/face selectors, and viewport images. The preview does not modify the saved document. Coordinates and dimensions use millimeters.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["plan"],
      properties: {
        ...commonEditor,
        plan: planSchema,
        includeImage: { type: "boolean", description: "Default true. Set false to omit the viewport image when only geometry status is needed." },
        replaceBodyIds: { type: "array", maxItems: 24, items: { type: "string", minLength: 1, maxLength: 120 }, description: "Optional body ids from an earlier model that this plan replaces. Preview and apply remain one undoable edit." },
      },
    },
  },
  {
    name: "jumpstart_preview_resize_body",
    title: "Preview a body resize",
    description: "Preview exact local X, Y, or Z dimensions in millimeters for an existing body, including imported STL or 3MF meshes. Unspecified axes keep their current size. The default base anchor preserves the local bottom and center. Preview does not modify the saved document.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["bodyId", "size"],
      properties: {
        ...commonEditor,
        bodyId: { type: "string", minLength: 1, maxLength: 120, description: "Body id returned by jumpstart_get_document." },
        size: {
          type: "object", additionalProperties: false, minProperties: 1,
          properties: {
            x: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
            y: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
            z: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
          },
          description: "Target dimensions in millimeters in the body's local coordinate axes. Include only the axes to change.",
        },
        anchor: { type: "string", enum: ["base", "center", "corner"], description: "Which point stays fixed; defaults to the base center." },
        includeImage: { type: "boolean", description: "Default true. Set false to omit the viewport image." },
      },
    },
  },
  {
    name: "jumpstart_apply_model",
    title: "Apply a successful preview",
    description: "Commit a model or body edit preview as one undoable document edit. The document must not have changed since preview. Repeating the same previewId will not duplicate the edit.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["previewId"],
      properties: { ...commonEditor, previewId: { type: "string", minLength: 1, maxLength: 100 } },
    },
  },
  {
    name: "jumpstart_undo",
    title: "Undo one document edit",
    description: "Undo exactly one edit only if expectedRevision still matches the current document revision. Read the document again after an error.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["expectedRevision"],
      properties: { ...commonEditor, expectedRevision: { type: "string", minLength: 1, maxLength: 100 } },
    },
  },
  {
    name: "jumpstart_export_model",
    title: "Export an editable or printable model",
    description: "Export visible design solids to STL, 3MF or STEP. Default printable scope excludes reference and hardware bodies; assembly includes design and hardware, never references. Optional bodyIds selects an eligible subset. Writes to the configured exports directory and returns the path and selected body ids. STEP preserves CAD solids when supported by the kernel.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["format"],
      properties: { ...commonEditor, format: { type: "string", enum: ["stl", "step", "3mf"] }, name: { type: "string", maxLength: 80 }, scope: { type: "string", enum: ["printable", "assembly"], default: "printable" }, bodyIds: { type: "array", minItems: 1, maxItems: 128, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 80 } } },
    },
  },
], planSchema);

const editors = new Map();
const queues = new Map();
const waiters = new Map();
const pending = new Map();
const presence = clientPresence();
let shuttingDown = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function response(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function rpcError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function settleWaiter(editorId, command) {
  const waiter = waiters.get(editorId);
  if (!waiter) return false;
  waiters.delete(editorId);
  clearTimeout(waiter.timer);
  waiter.resolve(command);
  return true;
}

function settlePending(commandId, result) {
  const entry = pending.get(commandId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(commandId);
  entry.resolve(result);
  return true;
}

function pruneEditors() {
  const now = Date.now();
  for (const [editorId, editor] of editors) {
    if (now - editor.lastSeen <= EDITOR_STALE_MS || waiters.has(editorId)) continue;
    editors.delete(editorId);
    queues.delete(editorId);
    for (const [commandId, entry] of pending) {
      if (entry.editorId === editorId) settlePending(commandId, { ok: false, error: "JumpStart editor is no longer connected" });
    }
  }
}

function listEditors() {
  pruneEditors();
  return [...editors.values()].sort((a, b) => Number(b.focused) - Number(a.focused)).map(({ lastSeen, ...editor }) => ({
    ...editor,
    lastSeenAt: new Date(lastSeen).toISOString(),
    connectionState: waiters.has(editor.editorId) ? "listening" : [...pending.values()].some((entry) => entry.editorId === editor.editorId && entry.delivered) ? "busy" : "reconnecting",
    sameDocumentEditors: [...editors.values()].filter((other) => other.documentId === editor.documentId).length,
  }));
}

function selectEditor(editorId) {
  pruneEditors();
  if (editorId) {
    const exact = editors.get(editorId);
    if (!exact) throw new Error(`JumpStart editor ${editorId} is not connected`);
    return exact;
  }
  const all = [...editors.values()];
  if (all.length === 1) return all[0];
  if (!all.length) throw new Error("No JumpStart editor is connected. Open the local app URL shown by the MCP server.");
  throw new Error("Multiple JumpStart editors are open; pass editorId from jumpstart_list_editors");
}

function removeQueued(editorId, commandId) {
  const queue = queues.get(editorId) || [];
  queues.set(editorId, queue.filter((command) => command.id !== commandId));
}

async function dispatch(action, params) {
  const editor = selectEditor(params.editorId);
  const queue = queues.get(editor.editorId) || [];
  if (queue.length >= MAX_QUEUED_COMMANDS) throw new Error("JumpStart editor command queue is full; wait for current work to finish");
  const command = { id: randomUUID(), action, params: { ...params } };
  delete command.params.editorId;

  const timeoutMs = action === "export_model" ? 60_000 : (action === "preview_model" || action.startsWith("preview_") && params.requirements?.pairs?.length) ? 60_000 : 30_000;
  const resultPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(command.id);
      removeQueued(editor.editorId, command.id);
      resolve({ ok: false, error: `JumpStart editor timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    pending.set(command.id, { editorId: editor.editorId, resolve, timer, delivered: false });
  });

  const waiter = waiters.get(editor.editorId);
  if (waiter && settleWaiter(editor.editorId, command)) pending.get(command.id).delivered = true;
  else {
    queue.push(command);
    queues.set(editor.editorId, queue);
  }
  return resultPromise;
}

async function readBody(req) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX_HTTP_BODY) throw new Error("Request exceeds local MCP bridge body limit");
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_HTTP_BODY) throw new Error("Request exceeds local MCP bridge body limit");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Request body must be valid JSON"); }
}

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(value));
}

function allowedLocalRequest(req, allowNavigation = false) {
  const host = req.headers.host || "";
  let url;
  try { url = new URL(`http://${host}`); } catch { return false; }
  if (!(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === String(server.address()?.port))) return false;
  if (allowNavigation && (req.method === "GET" || req.method === "HEAD")) return true;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  const fetchSite = req.headers["sec-fetch-site"];
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

async function handleBridge(req, res, pathname) {
  if (!allowedLocalRequest(req)) return json(res, 403, { error: "Only same-origin localhost requests are accepted" });
  if (req.method !== "POST") return json(res, 405, { error: "Use POST for the local bridge" });
  let body;
  try { body = await readBody(req); }
  catch (error) { return json(res, 400, { error: error.message }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "Expected a JSON object" });

  if (pathname === "/__mcp/client") {
    try {
      validateToolInput(body, { type: "object", additionalProperties: false, required: ["clientId", "state"], properties: { clientId: { type: "string", pattern: "^[a-zA-Z0-9-]{16,80}$", minLength: 16, maxLength: 80 }, state: { type: "string", enum: ["connect", "heartbeat", "disconnect"] } } });
      presence.lease(body.clientId, body.state);
      return json(res, 200, { ok: true });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (pathname === "/__mcp/heartbeat") {
    if (typeof body.editorId !== "string" || body.editorId.length > 120 || typeof body.documentId !== "string" || typeof body.documentName !== "string") {
      return json(res, 400, { error: "Invalid editor heartbeat" });
    }
    const editor = { editorId: body.editorId, documentId: body.documentId, documentName: body.documentName.slice(0, 120), mode: String(body.mode || "").slice(0, 30), bodyCount: Number.isFinite(body.bodyCount) ? body.bodyCount : 0, revision: String(body.revision || ""), focused: body.focused === true, lastSeen: Date.now() };
    editors.set(editor.editorId, editor);
    queues.set(editor.editorId, queues.get(editor.editorId) || []);
    return json(res, 200, { ok: true, agent: presence.status() });
  }

  if (pathname === "/__mcp/poll") {
    if (typeof body.editorId !== "string") return json(res, 400, { error: "Invalid editor id" });
    pruneEditors();
    const editor = editors.get(body.editorId);
    if (!editor) return json(res, 410, { error: "Editor heartbeat expired" });
    editor.lastSeen = Date.now();
    const queue = queues.get(body.editorId) || [];
    const command = queue.shift();
    if (command) {
      const entry = pending.get(command.id);
      if (entry) entry.delivered = true;
      return json(res, 200, { command });
    }
    if (waiters.has(body.editorId)) settleWaiter(body.editorId, null);
    let done = false;
    let timer;
    let resolvePoll;
    const promise = new Promise((resolve) => {
      resolvePoll = resolve;
      timer = setTimeout(() => {
        done = true;
        if (waiters.get(body.editorId)?.resolve === resolve) waiters.delete(body.editorId);
        resolve(null);
      }, POLL_TIMEOUT_MS);
      waiters.set(body.editorId, { resolve, timer });
    });
    const onClose = () => {
      if (!done && waiters.get(body.editorId)?.resolve === resolvePoll) settleWaiter(body.editorId, null);
    };
    res.once("close", onClose);
    const result = await promise;
    done = true;
    res.removeListener("close", onClose);
    if (!res.writableEnded) json(res, 200, { command: result });
    return;
  }

  if (pathname === "/__mcp/result") {
    if (typeof body.editorId !== "string" || typeof body.commandId !== "string" || typeof body.ok !== "boolean") return json(res, 400, { error: "Invalid command result" });
    if (pending.get(body.commandId)?.editorId !== body.editorId) return json(res, 200, { accepted: false });
    const accepted = settlePending(body.commandId, { ok: body.ok, data: body.data, error: typeof body.error === "string" ? body.error.slice(0, 4000) : undefined });
    return json(res, 200, { accepted });
  }
  return json(res, 404, { error: "Unknown local MCP bridge route" });
}

async function handleHttpRpc(req, res) {
  if (!allowedLocalRequest(req)) return json(res, 403, { error: "Only same-origin localhost requests are accepted" });
  if (req.method !== "POST") return json(res, 405, { error: "Use POST for local MCP requests" });
  let message;
  try { message = await readBody(req); }
  catch (error) { return json(res, 400, { error: error.message }); }
  if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string") {
    return json(res, 400, { error: "Expected a JSON-RPC request" });
  }

  const { id, method, params = {} } = message;
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    res.writeHead(202, { "Cache-Control": "no-store" });
    return res.end();
  }

  let result;
  if (method === "initialize") {
    result = {
      protocolVersion: SUPPORTED_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "jumpstart-3d", version: "0.1.0" },
      instructions: "Use preview before apply. Model coordinates are millimeters.",
    };
  } else if (method === "ping") {
    result = {};
  } else if (method === "tools/list") {
    result = { resultType: "complete", tools, cacheScope: "public", ttlMs: 300_000 };
  } else if (method === "tools/call") {
    if (typeof params.name !== "string" || !tools.some((tool) => tool.name === params.name)) {
      result = toolError(new Error(`Unknown tool: ${params.name || ""}`));
    } else {
      try { result = toolResult(await callTool(params.name, params.arguments === undefined ? {} : params.arguments)); }
      catch (error) { result = toolError(error); }
    }
  } else {
    return json(res, 200, { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message: `Unknown method: ${method}` } });
  }
  return json(res, 200, { jsonrpc: "2.0", id: id ?? null, result });
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
};

async function serveStatic(req, res, pathname) {
  if (!allowedLocalRequest(req, true)) {
    process.stderr.write(`Rejected local app request: method=${req.method} host=${req.headers.host || ""} origin=${req.headers.origin || ""} site=${req.headers["sec-fetch-site"] || ""} mode=${req.headers["sec-fetch-mode"] || ""} dest=${req.headers["sec-fetch-dest"] || ""}\n`);
    return json(res, 403, { error: "Only localhost requests are accepted" });
  }
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Static app only accepts GET and HEAD" });
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return json(res, 400, { error: "Invalid path" }); }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = resolve(DOCS, relative);
  if (file !== DOCS && !file.startsWith(DOCS + sep)) return json(res, 404, { error: "Not found" });
  try { await access(file); }
  catch {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    return res.end("Build the local JumpStart app first with npm run build.\n");
  }
  const contentType = MIME[extname(file).toLowerCase()] || "application/octet-stream";
  let shell;
  if (file === join(DOCS, "index.html") && req.method === "GET") {
    try {
      shell = await readFile(file, "utf8");
      const bridgeMeta = '<meta name="jumpstart-mcp-bridge" content="1">';
      shell = shell.includes("</head>")
        ? shell.replace("</head>", `${bridgeMeta}\n</head>`)
        : shell.replace("<title>", `${bridgeMeta}\n<title>`);
    }
    catch { return json(res, 503, { error: "The local app is rebuilding; retry after the build finishes" }); }
  }
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
  if (req.method === "HEAD") return res.end();
  if (shell !== undefined) return res.end(shell);
  createReadStream(file).on("error", () => { if (!res.headersSent) res.writeHead(404); res.end(); }).pipe(res);
}

const server = createServer((req, res) => {
  const pathname = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`).pathname;
  if (pathname === "/__mcp/rpc") { void handleHttpRpc(req, res); return; }
  if (pathname.startsWith("/__mcp/")) { void handleBridge(req, res, pathname); return; }
  void serveStatic(req, res, pathname);
});

const host = (args) => typeof args.editorId === "string" ? args.editorId : undefined;

async function callTool(name, args) {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (Buffer.byteLength(JSON.stringify(args)) > 262144) throw new Error("Tool input exceeds 262144 byte budget");
  validateToolInput(args, tool.inputSchema);
  if ((args.againstBodyId || args.requirements?.pairs?.length) && !args.expectedRevision) throw new Error("expectedRevision is required for pair inspection and pair requirements");
  if (args.pairChecks && !args.againstBodyId) throw new Error("pairChecks require againstBodyId");
  presence.activity();
  const run = async (action, params) => {
    const result = await dispatch(action, params);
    if (!result?.ok) throw new Error(result?.error || `JumpStart ${action} failed`);
    return result.data;
  };
  switch (name) {
    case "jumpstart_get_capabilities": return focusCapabilities({
      schemaVersion: 1, units: "mm", toolSchemas: tools,
      limits: { toolInputBytes: 262144, trianglesInspected: 200000, estimatedTriangleVisits: 8000000, meshWeldToleranceMm: 0.0001, namedParameters: 64, parameterModels: 16, images: 4, requirementBodies: 16, requirementChecks: 64, geometryPairs: 8, pairOperandFaces: 2000, pairQueryTimeoutMs: 20000, importFileBytes: 24 * 1024 * 1024, importPlanBytes: 24 * 1024 * 1024, importsPerPlan: MAX_IMPORTS_PER_PLAN, importCatalogFiles: MAX_IMPORT_CATALOG_FILES },
      bodyRoles: { default: "design", values: ["design", "reference", "hardware"], assignment: "setRole native plan operation", exports: { printable: ["design"], assembly: ["design", "hardware"] } },
      operations: ["native Gridfinity bins, inserts and baseplates with optional aligned magnet pockets", "drawerLayout measured drawer planning with native bins and tiled baseplates", "setRole body metadata", "operator-managed STL/3MF/STEP/STP imports by digest id", "rectangular frame preset", "native bound rectangle/extrusion", "native parameters", "native Lathe profile/hollow/scale", "primitives", "circle/polygon/rounded-rectangle/line-arc-spline contour profiles", "line/arc path sketches", "extrude", "revolve", "loft", "sweep", "pipe", "coil", "linear/circular/path body patterns", "linear/circular patterns of editable hole, emboss, and sketch-backed boolean features", "transforms", "linked or joined body mirrors", "plane-based splitBody operation (two editable outputs)", "booleans", "native ISO/UNC fasteners", "native parametric spur, straight bevel, and rack gears (module, tooth count, pressure angle, face width, bevel cone angle, optional bore, and rack baseDepth)", "native axial knurled knobs (V-groove sketch, editable extrusion, optional round/hex/D bore)", "native phone cradle (thin angled plate, two ribs, and lower stop)", "fitted planar grid/staggered/circular round and shaped hole patterns", "fillet", "chamfer", "signed planar/cylindrical/spherical face offset", "shell", "hole", "thread", "planar emboss", "scale"],
      inspection: ["top/side/isometric/section images with labeled world axes", "tessellated plane sections", "line/solid intervals", "dimensions", "axis-aligned parallel flat-bottom channels", "mesh edge incidence and phone-cradle support connectivity", "semantic native signature queries", "native/STEP single-solid pair distance, witness points and intersection volume"],
      exports: ["stl", "step", "3mf"],
      unsupported: ["interactive pedal/chisel session automation", "spiral bevel tooth geometry and automatic gear-pair placement or mating-accuracy certification", "patterning feature types other than holes, embosses, and sketch-backed extrude/revolve/sweep booleans", "Split Face (the editor cannot edit it and its kernel face selector has no distance/ambiguity guard)", "general sketch constraint solver", "independent analytic contour self-intersection checks (preview relies on CAD kernel face construction)", "sweep taper and twist", "pipe paths picked from existing body edges", "dimensional algebra", "automatic stable topological naming", "mesh-to-parametric reconstruction", "exact mesh pair queries and automatic datum mating", "minimum wall thickness everywhere", "physical fit or printability certification"],
      parameterExample: { parameters: { diameter: { value: 100, unit: "mm", min: 10, max: 500 } }, numericReference: { $expr: "diameter / 2" }, operators: ["+", "-", "*", "/", "parentheses"], lifecycle: "preview_model -> inspect_geometry(previewId) -> apply_model -> save_document -> preview_parameters; templates survive native save/reopen" },
      validationLayers: ["schema", "CAD construction", "preview-scoped acceptance requirements and source-preservation checks", "requested geometric measurements", "export mesh checks", "physical fit unverified"],
    }, args);
    case "jumpstart_start_tutorial": return await run("start_tutorial", { ...args, editorId: host(args) });
    case "jumpstart_get_tutorial_status": return await run("get_tutorial_status", { ...args, editorId: host(args) });
    case "jumpstart_preview_native_model": return await run("preview_native_model", { ...args, editorId: host(args) });
    case "jumpstart_preview_native_parameters": return await run("preview_native_parameters", { ...args, editorId: host(args) });
    case "jumpstart_preview_frame": return await run("preview_frame", { ...args, editorId: host(args) });
    case "jumpstart_preview_lathe": return await run("preview_lathe", { ...args, editorId: host(args) });
    case "jumpstart_list_imports": return await listManagedImports(IMPORTS);
    case "jumpstart_list_editors": return { editors: listEditors() };
    case "jumpstart_get_document": return await run("get_document", { ...args, editorId: host(args) });
    case "jumpstart_preview_new_document": return await run("preview_new_document", { ...args, editorId: host(args) });
    case "jumpstart_preview_model": {
      const imports = (args.plan.operations || []).filter((operation) => operation.type === "import").map((operation) => operation.assetId);
      if (imports.length > MAX_IMPORTS_PER_PLAN) throw new Error(`A model plan can import at most ${MAX_IMPORTS_PER_PLAN} assets`);
      const importAssets = await resolveManagedImports(IMPORTS, imports);
      return await run("preview_model", { editorId: host(args), plan: args.plan, importAssets, replaceBodyIds: args.replaceBodyIds || [], includeImage: args.includeImage !== false, section: args.section, expectedRevision: args.expectedRevision, requirements: args.requirements });
    }
    case "jumpstart_preview_resize_body": return await run("preview_resize_body", { editorId: host(args), bodyId: args.bodyId, size: args.size, anchor: args.anchor, includeImage: args.includeImage !== false, section: args.section, expectedRevision: args.expectedRevision, requirements: args.requirements });
    case "jumpstart_preview_parameters": return await run("preview_parameters", { ...args, editorId: host(args) });
    case "jumpstart_inspect_geometry": return await run("inspect_geometry", { ...args, editorId: host(args) });
    case "jumpstart_select_geometry": return await run("select_geometry", { ...args, editorId: host(args) });
    case "jumpstart_save_document": return await run("save_document", { ...args, editorId: host(args) });
    case "jumpstart_reopen_document": return await run("reopen_document", { ...args, editorId: host(args) });
    case "jumpstart_apply_model": return await run("apply_model", { editorId: host(args), previewId: args.previewId });
    case "jumpstart_undo": return await run("undo", { editorId: host(args), expectedRevision: args.expectedRevision });
    case "jumpstart_export_model": {
      const name = sanitizeName(args.name || "design");
      const result = await run("export_model", { editorId: host(args), format: args.format, name, scope: args.scope, bodyIds: args.bodyIds });
      if (!result?.base64 || !["stl", "step", "3mf"].includes(args.format)) throw new Error("Editor returned an invalid export payload");
      const bytes = Buffer.from(result.base64, "base64");
      if (bytes.length !== result.byteLength || bytes.length > 32 * 1024 * 1024) throw new Error("Export payload failed size validation");
      await mkdir(EXPORTS, { recursive: true });
      const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
      if (args.format === "3mf" && (bytes.length < 30 || bytes.readUInt32LE(0) !== 0x04034b50 || !bytes.includes(Buffer.from("3D/3dmodel.model")))) throw new Error("Malformed 3MF export");
      const fileName = `${name}-${digest}.${args.format}`;
      const path = join(EXPORTS, fileName);
      try { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        const existing = await readFile(path);
        if (!existing.equals(bytes)) throw new Error("Export filename collision; change the export name and retry");
      }
      let meshValidation;
      if (args.format === "stl") {
        const count = bytes.length >= 84 ? bytes.readUInt32LE(80) : 0;
        if (!count || bytes.length !== 84 + count * 50) throw new Error("Malformed binary STL export");
        if (count <= 200000) {
          const vertices = new Float64Array(count * 9), triangles = new Uint32Array(count * 3);
          for (let i = 0; i < count; i++) for (let j = 0; j < 9; j++) vertices[i * 9 + j] = bytes.readFloatLE(84 + i * 50 + 12 + j * 4);
          for (let i = 0; i < triangles.length; i++) triangles[i] = i;
          meshValidation = inspectTriangleMesh({ vertices, triangles }, { tolerance: 0.0001 });
          meshValidation.valid = !meshValidation.degenerateTriangles && !meshValidation.boundaryEdges && !meshValidation.nonManifoldEdges && !meshValidation.inconsistentWindingEdges;
        } else meshValidation = { valid: null, status: "not_checked", reason: "Export exceeds the 200000 triangle inspection budget" };
      }
      await run("export_complete", { editorId: host(args), format: args.format, expectedRevision: result.revision });
      return { format: args.format, path, scope: result.scope, bodyIds: result.bodyIds, roles: result.roles, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), meshValidation, physicalFit: "unverified", manufacturingPerformance: "unverified" };
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function sanitizeName(value) {
  if (typeof value !== "string" || value.length > 80) throw new Error("Export name must be a string of at most 80 characters");
  const name = value.trim().replace(/\.[a-z0-9]+$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, "-").replace(/^\.+|\.+$/g, "").slice(0, 80);
  return name || "design";
}

function textContent(value) {
  return { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) };
}

function toolResult(value) {
  const content = [];
  if (Array.isArray(value?.images)) {
    const { images, ...summary } = value;
    content.push(textContent({ ...summary, images: images.map(({ dataUrl, ...metadata }) => metadata) }));
    for (const image of images) {
      const match = /^data:image\/(png|jpeg);base64,/.exec(image.dataUrl || "");
      if (match) { content.push(textContent({ view: image.view })); content.push({ type: "image", data: image.dataUrl.slice(match[0].length), mimeType: `image/${match[1]}` }); }
    }
    return { resultType: "complete", content, isError: false };
  }
  const imageMatch = /^data:image\/(png|jpeg);base64,/.exec(value?.imageDataUrl || "");
  if (imageMatch) {
    const { imageDataUrl, ...summary } = value;
    content.push(textContent(summary));
    content.push({ type: "image", data: imageDataUrl.slice(imageMatch[0].length), mimeType: `image/${imageMatch[1]}` });
  } else content.push(textContent(value));
  return { resultType: "complete", content, isError: false };
}

function toolError(error) {
  return { resultType: "complete", content: [textContent({ error: error instanceof Error ? error.message : String(error), guidance: failureGuidance(error) })], isError: true };
}

async function handleMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  const { id: requestId, method, params = {} } = message;
  if (typeof method !== "string") return rpcError(requestId ?? null, -32600, "Expected a JSON-RPC method");
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  try {
    if (["initialize", "server/discover"].includes(method)) presence.stdioConnected();
    if (method === "server/discover") {
      return response(requestId, {
        resultType: "complete",
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "jumpstart-3d", version: "0.1.0" } },
        instructions: "Use jumpstart_preview_model, inspect its geometry and image, then apply the returned previewId. Model coordinates are millimeters. Read the current document revision before undoing. STL fit is not guaranteed by dimensions alone.",
        ttlMs: 300_000,
        cacheScope: "public",
      });
    }
    if (method === "initialize") {
      return response(requestId, {
        protocolVersion: SUPPORTED_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "jumpstart-3d", version: "0.1.0" },
        instructions: "Use preview before apply. Model coordinates are millimeters.",
      });
    }
    if (method === "ping") return response(requestId, {});
    if (method === "tools/list") return response(requestId, { resultType: "complete", tools, cacheScope: "public", ttlMs: 300_000 });
    if (method === "tools/call") {
      if (typeof params.name !== "string" || !tools.some((tool) => tool.name === params.name)) {
        return response(requestId, toolError(new Error(`Unknown tool: ${params.name || ""}`)));
      }
      try {
        const args = params.arguments === undefined ? {} : params.arguments;
        return response(requestId, toolResult(await callTool(params.name, args)));
      }
      catch (error) { return response(requestId, toolError(error)); }
    }
    rpcError(requestId ?? null, -32601, `Unknown method: ${method}`);
  } catch (error) {
    rpcError(requestId ?? null, -32603, error instanceof Error ? error.message : String(error));
  }
}

function close() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [editorId] of waiters) settleWaiter(editorId, null);
  for (const [commandId] of pending) settlePending(commandId, { ok: false, error: "MCP server is shutting down" });
  server.close();
}

server.listen(PORT, HOST, () => {
  process.stderr.write(`JumpStart MCP app: http://${BROWSER_HOST}:${server.address().port}/?mcp=1\n`);
});
server.on("error", (error) => {
  process.stderr.write(`JumpStart MCP local server failed: ${error.message}\n`);
  process.exitCode = 1;
  close();
});

if (!HTTP_ONLY) {
  let inputBuffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    inputBuffer += chunk;
    const lines = inputBuffer.split(/\r?\n/);
    inputBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try { void handleMessage(JSON.parse(line)); }
      catch (error) { rpcError(null, -32700, error instanceof Error ? error.message : String(error)); }
    }
  });
  process.stdin.on("end", close);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
