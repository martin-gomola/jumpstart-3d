# Household parts and editable representations

Use this reference for frames, trays, brackets, hooks, cups, and native or
template parameter revisions. Example sizes are not fit measurements. Knobs,
gears and turned parts are in
[Knobs, gears and turned parts](knobs-gears-and-turned-parts.md); phone cradles
are in [Mounts and assemblies](mounts-and-assemblies.md).

## Contents

- Choose an editable representation
- Rectangular spacer, native parameters or a template
- Common household parts: divided tray, hook and cable guide, mirrored bracket, hollow cup

## Choose an editable representation

- For rectangular spacers and frames, use `jumpstart_preview_frame`. Obtain outer
  width/depth and height. Explain any omitted wall value as an assumption. Inspect
  the measured opening, wall samples, and open centre. Use the rectangular-frame example below.
- For general CAD, use `jumpstart_preview_model` with supported primitives,
  dimensioned circle, polygon, rounded-rectangle, or line/arc/spline contour
  sketches, extrude/revolve/loft/sweep/pipe/coil features, transforms, body and
  feature patterns, booleans, fasteners, and round or shaped hole patterns.
  The plan also supports plane-based body splits, linked or joined mirrors and
  face modifiers. Read `jumpstart_get_capabilities` for current limits and
  supported feature types.
- For repeated existing features, use `featurePattern` only for holes, planar
  embosses, and sketch-backed extrude/revolve/sweep booleans. Use `pathPattern`
  for repeated editable bodies along a typed line/arc path. Other feature types
  are rejected; do not substitute arbitrary scripts.
- For a native rectangle with parameter-bound extrusion, use
  `jumpstart_preview_native_model` on a blank document; revise using
  `jumpstart_preview_native_parameters`. Native parameters and MCP template
  parameters are separate systems. Use `jumpstart_preview_parameters` for the
  latter. Do not overwrite an occupied document to satisfy a creation restriction.


## Rectangular spacer

A user supplies an 86 × 86 mm switch plate and requests a 10 mm high square spacer
with an open centre. Ask about width/depth and height if they are missing; use the
known plate dimensions when already supplied. No screw holes are required when
the user requests only a surrounding frame.

Call `jumpstart_preview_frame` with the selected editor and current revision:

```json
{
  "editorId": "selected-editor-id",
  "expectedRevision": "current-document-revision",
  "plan": {
    "name": "Wall switch spacer",
    "outerWidth": 86,
    "outerDepth": 86,
    "height": 10
  }
}
```

Omitting `wall` selects the preset's provisional 5 mm wall and records that
assumption. Expect a 76 × 76 mm opening, but check the returned `frameInspection`
measurements and open-centre result rather than relying on arithmetic alone.
Inspect the complete image before applying its preview ID. The preset stores
`designContext`; preserve supplied/assumed values through saves and parameter
revisions. Change the wall if the user supplies a different value. The frame's
axis-aligned wall samples do not establish minimum thickness everywhere or fit.

## Choose native parameters or a template

For a new rectangular bracket on a blank document, discover the schema for
`jumpstart_preview_native_model`: it supports driving rectangle dimensions and an
expression-bound extrude. Inspect native parameters and sketch constraints after
apply. Revise with `jumpstart_preview_native_parameters` and inspect the result.
Do not assume this endpoint authors arbitrary native sketches or constraints.

For existing MCP template models, inspect their parameter metadata and use
`jumpstart_preview_parameters`. Do not substitute native parameter tools merely
because both models are called parametric.

## Common household parts

Treat these as dimensioned examples only. Replace dimensions with measurements
from the user's part or requirements. Preview and inspect the result; a valid
mesh does not establish installation fit or printability.

### Divided tray

This plan creates an 80 × 60 × 16 mm tray with 5 mm outer corner radii, a 2 mm
floor, two compartments, and a 2 mm divider:

```json
{
  "name": "80 by 60 divided organizer",
  "sketches": [
    { "id": "outer", "plane": "XY", "origin": [0, 0, 0], "profile": { "type": "roundedRect", "width": 80, "height": 60, "radius": 5 } },
    { "id": "cavity", "plane": "XY", "origin": [0, 0, 2], "profile": { "type": "roundedRect", "width": 76, "height": 56, "radius": 3 } },
    { "id": "divider", "plane": "XY", "origin": [0, 0, 2], "profile": { "type": "polygon", "points": [[-1, -28.1], [1, -28.1], [1, 28.1], [-1, 28.1]] } }
  ],
  "features": [
    { "id": "tray", "type": "extrude", "sketch": "outer", "distance": 16 },
    { "id": "cavity-cut", "type": "extrude", "sketch": "cavity", "distance": 14, "operation": "cut", "target": "tray" },
    { "id": "divider-wall", "type": "extrude", "sketch": "divider", "distance": 14, "operation": "join", "target": "tray" }
  ]
}
```

Inspect the outer bounds, floor, compartment count and widths, divider, and mesh.
State the test dimensions as assumptions unless the user supplied them.

### Curved hook and cable guide

Use a circle profile with a connected line/arc path for a swept hook. Use a
separate pipe path with `hollow: true` and a wall value for a cable guide. The
section size and path are explicit and remain editable. Check path bounds and
measured volume; do not infer load capacity from the model.

### Mirrored slotted bracket pair

For two 40 × 24 × 6 mm plates, create one plate at `[22, 0, 0]`, cut two slots
with `shape: "slot"`, `width: 4`, `length: 10`, and `pitch: [16, 12]`, then add a
linked mirror across the plane at the origin with normal `[1, 0, 0]`. Preview
and inspect both plates, slot symmetry, thickness, and mesh validity. Supply the
actual wall and fastener measurements before treating this as a fit design.

### Hollow cup or cover

A 40 mm cylinder with a 38 mm circular cut that starts 2 mm above the base has
a nominal 2 mm side wall and 2 mm bottom:

```json
{
  "name": "Hollow 40 by 40 cup",
  "primitives": [{ "id": "cup", "kind": "cylinder", "parameters": { "w": 40, "d": 40, "h": 40 } }],
  "sketches": [{ "id": "inside", "plane": "XY", "origin": [0, 0, 2], "profile": { "type": "circle", "center": [0, 0], "radius": 18 } }],
  "features": [{ "id": "cup-cavity", "type": "extrude", "sketch": "inside", "distance": 38, "operation": "cut", "target": "cup" }]
}
```

Measure the outside bounds, volume, wall intervals, and mesh after preview. This
example does not establish a lid fit, liquid seal, or material suitability.
