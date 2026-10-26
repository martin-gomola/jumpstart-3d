# Inspection, acceptance and recovery

## Contents

- Attach acceptance requirements
- Review the proposed change
- Preview, inspect, then apply
- Save and hand off
- Failure recovery

## Attach acceptance requirements

Before building, write a short checklist: required dimensions and orientation,
expected body/component counts, preserved bodies, and requested exports. Give
each item an independent measurement or a complete visual review. Do not
manufacture dimensions from a screenshot.

Record where every dimension came from: `measured` (by whom and with what),
`given` by the user, `listed` (quote the product page or datasheet and its
rounding), or `assumed` with a reason. List what the evidence does not show as
unknowns. Make assumed dimensions native parameters, and repeat the list in the
final report.

All preview tools accept optional `requirements` alongside the plan or edit:

```json
{
  "bodyCount": 2,
  "preserveBodyIds": ["existing-base-id"],
  "bodies": [{
    "target": "new-bracket",
    "checks": [
      { "id": "width", "kind": "dimension", "axis": "X", "expected": 40, "tolerance": 0.05 },
      { "id": "connected", "kind": "components", "expected": 1 }
    ]
  }]
}
```

Targets resolve to plan references or existing body ids and must identify one
body. Dimensions and `bound` checks use world axes; a bound adds `side: "min"`
or `"max"`. `components` counts mesh components. `channels` checks support straight
axis-aligned parallel channels with a shared flat floor. `printability` checks
a closed body in its current pose as if printed along world +Z with the bed at
its lowest Z: `maxOverhangArea` (mm²) limits downward faces steeper than
`overhangAngle` (default 45° from vertical), and `minWall` with optional
`maxThinWallArea` (default 0) limits surface over walls thinner than `minWall`.
Use `overhangBounds`, `thinWallBounds` and `thinnestSamples` to locate a failure.
Each printability result has `notes` with a `code`, `severity` and `fix`. An
`error` note is a failed limit; `warn` notes (`slender`, `bed_contact`,
`thin_part`, or an overhang within its limit) do not fail the check. Apply each
note's fix to the model or name why it stays, then preview again. Downward faces
within `baseZone` (default 1 mm) of the bed are `base_overhang`, not overhang.
Native pair queries also measure distance and intersection volume for supported
single CAD/STEP solids. These checks do not recognize arbitrary holes or pockets,
measure exact wall thickness everywhere, or certify continuous-motion interference.
Read the focused schema before requesting a check. Requirements belong to one preview; resubmit them on every later revision.
Unknown or failed attached requirements block apply. A later optional inspection cannot replace them.

## Review the proposed change

Preview `changes` lists added, removed, changed and unchanged body ids, with
before/after world bounds, dimensions and volume for changed bodies. Check the
requested delta and preservation requirements separately. An unchanged volume
or bounding box alone does not establish unchanged geometry. Preservation checks
compare source definitions and resolved geometry inputs, not exact 3D regions.
Do not center or align reference geometry in a way that hides a placement error.

## Preview, inspect, then apply

1. Read the current revision and pass `expectedRevision` to preview operations
   that accept it. Use `jumpstart_preview_new_document` only when a fresh document
   is requested or replacing the current document has been authorized.
2. Inspect preview errors, dimensions, assumptions, axis triad, camera directions,
   and images. For angled mounts, confirm the phone's top edge leans in the
   requested world direction and the screen faces the user. Use
   `jumpstart_inspect_geometry` for dimensions, sections, and mesh checks. A
   phone-cradle preview must report one connected support mesh before apply. A
   cropped image is insufficient visual evidence; obtain a complete view before
   claiming the appearance was checked. Look at the images even when every check
   passes: mirrored text, a hole in the wrong face or a feature too shallow to
   see passes the numbers.
3. Correct the plan and preview again when errors or measurements disagree with
   the request. Stop on unsupported operations or critical validation failures.
4. Apply only the successful `previewId` using `jumpstart_apply_model` against the
   same editor. For a changed document, reread and preview again. For an ambiguous
   timeout, inspect state before retrying; reuse the same preview ID rather than
   generating a second edit blindly. Never bypass the MCP transport through raw
   HTTP, arbitrary JavaScript, or UI clicks. Report a closed transport and request
   MCP reconnection when it cannot recover.
5. Confirm the resulting document and dimensions. Preserve other bodies unless
   the user requested replacement. Use `jumpstart_undo` with the current revision
   for recovery; do not undo unrelated edits.

## Save and hand off

Save with `jumpstart_save_document` when requested or part of the agreed task;
reopen with `jumpstart_reopen_document` only for an intended restore or verification.
A versioned save changes the revision, so reread it before subsequent edits.
Use `jumpstart_export_model` with an explicit supported format: STL, 3MF, or STEP.
Use `scope: "printable"` for manufactured design bodies or `scope: "assembly"`
for design plus hardware; reference bodies are excluded in both. Optional
`bodyIds` must be eligible for the selected scope. Check the returned ids and
roles; an excluded or empty selection fails, rather than exporting another part.
Check actual export success; mesh-only models may not support a useful STEP solid.

Report the created or revised part, measured dimensions, editable representation,
where each dimension came from and the unknowns, remaining printability notes,
unverified fit requirements, and returned local export link when available. Do not claim printability, electrical suitability, or installation fit
from dimensions alone.

## Failure recovery

Use the returned failure category and next checks. A timeout does not establish
that a mutation failed: reread current state before retrying the same preview id.
Reduce inspection scope for a resource limit; do not simplify the design without
confirming that this meets the user's intent. For CAD construction failures,
inspect intermediate features. For failed unions, distinguish separate bodies
from a fused solid. Never call overlapping bodies a successful union.

Do not lower a required count, remove a fit requirement, or increase tolerances
merely to turn a failed check into a pass. Return to the earliest incorrect
assumption or feature and preview again. Report unsupported measurements as
unverified, not passed.


For edits within one body, use `requirements.intent` and native
`preserveRegions` rather than treating equal volume or bounds as preservation.
The [existing-part workflow](edit-existing-parts.md) defines the supported world
AABB masks and before/after detail views. Keep region comparisons and physical
fit conclusions separate. Unknown regional checks cannot permit apply.
