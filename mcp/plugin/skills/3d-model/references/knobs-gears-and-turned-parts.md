# Knobs, gears and turned parts

Use this reference for knurled knobs, shaft bores, gears, and Lathe turned
parts. Example sizes are not fit measurements. Read the operation fields with
`jumpstart_get_capabilities` and `schemaPaths`, for example
`["plan.operations.knurl"]` or `["plan.operations.gear"]`.

## Knurled knob on a D shaft

The `knurl` operation makes one editable knob body. Its `position` is the
centre of the bottom face and the knob grows along local +Z. `bore` is `none`,
`round`, `hex` or `d`; omit `boreDepth` for a through bore. For a D bore,
`boreFlat` is the distance from the bore axis to the flat, and the flat faces
+X. A 6 mm D shaft with a 4.5 mm flat height uses `boreFlat: 1.5`.

A 30 mm knob, 18 mm tall, with a blind 12 mm D bore for a 6 mm shaft and a
0.15 mm per-side allowance:

```json
{
  "name": "Knurled knob for 6 mm D shaft",
  "operations": [{
    "id": "knob",
    "type": "knurl",
    "diameter": 30,
    "length": 18,
    "grooves": 48,
    "depth": 0.8,
    "bore": "d",
    "boreSize": 6.3,
    "boreFlat": 1.65,
    "boreDepth": 12,
    "position": [0, 0, 0]
  }]
}
```

To add a skirt, cap or pointer, build it as a primitive or feature and join it
with a later `combine` operation; features run before operations, so a feature
cannot target the knob. When a groove falls on the X or Y axis, a per-axis
`dimension` check can read slightly below `diameter`; allow for groove depth in
its tolerance. Pitch below about 0.8 mm (circumference ÷ grooves) may print as
a blur. Treat the shaft allowance as provisional until a fit coupon or the
user's measurement confirms it.

## Gears

For gear models, supply module, tooth count, pressure angle, face width, bore,
cone angle, and placement as needed. Straight bevel gears are a conical loft
approximation; do not claim tooth-contact accuracy or a matched gear pair.
Measure the bore, face width and outside diameter in the preview rather than
relying on the formula alone.

## Turned parts

For turned parts, use `jumpstart_preview_lathe`. Its persisted recipe is editable
mesh generation, not a sketch-based CAD feature tree. Discover the Lathe schema
before building a recipe. Its axial radius profile is cut-only relative to the
blank. Use the persisted body recipe for revision and reconcile native edits
outside that recipe before regeneration. Inspect actual hollowing and
`latheSampling.axialStepMm`; coarse samples can change the effective bottom
thickness. Do not present a recipe mesh as a complete CAD feature tree.
