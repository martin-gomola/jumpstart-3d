# Modeling workflows

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

## Revise an imported mesh

Read the body ID and measured bounds. Clarify whether a request such as "make it
larger" means a target outside dimension, a uniform percentage, or independent
axis changes. Preview the resize and inspect all three resulting dimensions.
Resizing an imported lid scales its locking details too; it does not independently
adjust a fit clearance. Report that it remains a mesh with unverified physical fit.

## Choose native parameters or a template

For a new rectangular bracket on a blank document, discover the schema for
`jumpstart_preview_native_model`: it supports driving rectangle dimensions and an
expression-bound extrude. Inspect native parameters and sketch constraints after
apply. Revise with `jumpstart_preview_native_parameters` and inspect the result.
Do not assume this endpoint authors arbitrary native sketches or constraints.

For existing MCP template models, inspect their parameter metadata and use
`jumpstart_preview_parameters`. Do not substitute native parameter tools merely
because both models are called parametric.

## Turned parts

Discover the Lathe schema before building a recipe. Its axial radius profile is
cut-only relative to the blank. Use the persisted body recipe for revision and
reconcile native edits outside that recipe before regeneration. Inspect actual
hollowing and `latheSampling.axialStepMm`; coarse samples can change the effective
bottom thickness. Do not present a recipe mesh as a complete CAD feature tree.
