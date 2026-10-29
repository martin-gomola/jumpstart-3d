import { DIMENSION_DIRECTIONS, DRAWING_VIEWS, SHEETS } from "../shared/drawing-sheet.js";

const obj = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const id = { type: "string", minLength: 1, maxLength: 120 };
const text = (maxLength, description) => ({ type: "string", maxLength, pattern: "^[^\\u0000-\\u001f]*$", ...(description ? { description } : {}) });
const point = { type: "array", minItems: 3, maxItems: 3, items: { type: "number", minimum: -100000, maximum: 100000 }, description: "World point [x, y, z] in mm." };
const dimension = obj({
  view: { type: "string", enum: DRAWING_VIEWS.filter((view) => view !== "iso") },
  direction: { type: "string", enum: DIMENSION_DIRECTIONS, description: "horizontal and vertical measure along the sheet axes of the view; aligned measures the true distance in the view plane; diameter calls out the circle centred at from (to picks among concentric circles)." },
  from: point, to: point,
  side: { type: "string", enum: ["above", "below", "left", "right"], description: "Where the dimension line sits: above or below for horizontal, left or right for vertical." },
  offset: { type: "number", minimum: 2, maximum: 60, description: "Paper mm from the view edge to the dimension line; defaults stack 8, 14, 20." },
  prefix: text(12), suffix: text(12),
  tolerance: { type: "string", maxLength: 24, pattern: "^[-+±0-9.,/ ]*$", description: "Printed after the value, for example ±0.1 or +0.1/-0.05." },
}, ["view", "direction", "from"]);
export const drawingSchema = obj({
  title: { ...text(80), minLength: 1 },
  number: text(40, "Drawing number."), revision: text(12), author: text(40), material: text(40),
  date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Defaults to today." },
  sheet: { type: "string", enum: Object.keys(SHEETS), description: "Landscape ISO sheet; default A4." },
  projection: { type: "string", enum: ["third", "first"], description: "Default third angle: top above front, right to its right." },
  scale: { type: "string", pattern: "^(auto|\\d+(\\.\\d+)?:\\d+(\\.\\d+)?)$", description: "auto (default) picks the largest standard scale that fits, or give N:M." },
  views: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: { type: "string", enum: DRAWING_VIEWS }, description: "Default front, top, right and iso. Front looks along +Y, top down -Z, right along -X." },
  hiddenLines: { type: "boolean", description: "Default true: dashed hidden edges in orthographic views." },
  autoDimensions: { type: "boolean", description: "Default true: overall width, height and depth, centre marks and grouped diameter callouts." },
  dimensions: { type: "array", maxItems: 24, items: dimension },
  notes: { type: "array", maxItems: 8, items: text(160) },
}, ["title"]);
const common = { editorId: id, expectedRevision: id, scope: { type: "string", enum: ["printable", "assembly"] }, bodyIds: { type: "array", minItems: 1, maxItems: 128, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 80 } }, drawing: drawingSchema };

export const drawingTools = [
  {
    name: "jumpstart_render_drawing", title: "Render a dimensioned 2D drawing sheet",
    description: "Draw native bodies as a dimensioned sheet: orthographic views with hidden lines, isometric, title block. Returns a PNG, measured dimensions and warnings. Read-only.",
    inputSchema: obj(common, ["expectedRevision", "drawing"]),
  },
  {
    name: "jumpstart_export_drawing", title: "Export a drawing sheet to SVG or PDF",
    description: "Write the jumpstart_render_drawing sheet to exports as SVG or PDF; returns path and report.",
    inputSchema: obj({ ...common, format: { type: "string", enum: ["svg", "pdf"] }, name: { type: "string", maxLength: 80 } }, ["expectedRevision", "drawing", "format"]),
  },
];
