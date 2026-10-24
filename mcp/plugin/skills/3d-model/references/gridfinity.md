# Gridfinity inserts, bins and baseplates

## Choose the object and evidence

Use `gridfinity` for an editable insert blank, bin or baseplate. Prefer a custom
insert when the useful result is a set of object pockets. Discover the focused
`gridfinity` and `pocket` operation schemas before composing the plan.

Establish the grid width/depth, height, placement, pocket depths, per-side
clearances, minimum floor/wall material, and insertion/removal direction. Name
missing values as assumptions; do not turn a suggested clearance into a printer
calibration. Propose a small fit coupon when physical fit matters.

For a product-specific pocket, identify the exact model, variant and accessories.
Prefer manufacturer drawings or attributable CAD models. Record the source URL,
units, product variant, and whether each dimension is supplied, published,
measured from geometry, or estimated. Persist the pocket's `sourceEvidence`
(product, optional variant/URL, original units, and evidence kind) and
`referenceBodyId` when available. Pocket sizes entered in JumpStart are
millimetres; convert source dimensions before modeling and retain their original
unit in the evidence. Keep measurement details with the design handoff.
Ask for the missing variant or measurement when it changes the pocket's shape.

Use the client's existing research and file tools for source acquisition. Put
approved model files in the operator-managed imports directory and import by the
digest returned by `jumpstart_list_imports`. Never invent a host path or send a
download URL to a modeling tool. Respect source access and licensing conditions.
Do not run downloaded scripts, upload private models, or add an API-key service.

Published overall dimensions support an envelope pocket, not an exact fitted outline.
A photograph alone does not establish a measured object-shaped profile. Explain
whether the proposal is a measured profile, an explicit envelope, or still an
estimate. Get agreement before substituting an envelope for a fitted shape.

## Build the editable foundation

The pinned interface reference uses a 42 mm XY grid and 7 mm height units. Bin and
insert width/depth use the grid footprint minus the interface gap. Their native
feet and the baseplate sockets have shaped mating profiles, not rectangular pegs.
Use the generator's returned dimensions and height information instead of
reconstructing the interface from the screenshot or adding a second tolerance.

Choose `kind: "insert"`, `"bin"` or `"baseplate"`, with `columns` and `rows`.
For inserts/bins, set `heightUnits`, `floor` and `wall`; bins can also use `lip`
and `dividers`. Check current capability limits before requesting a large layout.
The nominal top height and any additional stacking lip are separate dimensions.
Baseplates are 5 mm tall; bin/insert width and depth are 42 times the cell count
minus 0.5 mm, while a baseplate spans the full cell grid. The initial generator
omits magnet and screw pockets.

Use named parameters for dimensions likely to change. Save/reopen and numerical
revisions must retain the native recipe. A reference item's placement should
remain separate from printable geometry. Assign it `reference` through `setRole`
and retain it for visual comparison; printable exports exclude it.

## Define pockets and access

Pockets use the insert's local XY coordinates and cut downward from its top.
`position` is a local XY pair; `rotation` turns the profile about local Z. A
world-space screenshot is not sufficient to choose those local coordinates.
Confirm front/back and a complete top view before positioning asymmetric items.

Use a circle, rounded rectangle, capsule, or closed line/arc contour. Supply
`depth`, `clearance`, `minimumFloor` and `minimumWall` explicitly. Clearance is
per side; a contour offset is not uniform model scaling. Depth must leave both
the protected Gridfinity base and the requested floor material intact.

Start with separated pockets. Intentional finger recesses can be additional
pockets with `merge: true`; do not use merge to conceal an accidental collision.
Check the failed pocket and its material requirement before changing a layout.
Conservative envelope checks can reject a layout even when the shapes appear to
fit. Such a rejection is a limitation to resolve, not permission to bypass it.

Imported STEP/STL/3MF items are usable as references for placement and dimensions.
The initial pocket workflow does not create an exact clearance surface around
an arbitrary imported object. Use a measured profile or an agreed envelope,
or report that the requested shape needs a later supported workflow.
Never describe uniform scaling of an imported model as constant surface clearance.

## Inspect, apply and deliver

Preview the foundation and every pocket without changing the document. Inspect
the reported errors, source preservation, dimensions, top and side views, pocket
positions/depths, supported material-margin checks, and connected components.
When supported, inspect the insert/baseplate pair for unintended material
overlap at the intended mounting pose. Zero distance alone does not prove fit.

Attach supported acceptance requirements before preview. Unknown or failed
requirements block apply. Do not lower a required floor/wall, remove a failing
check, or silently enlarge the insert to make the preview pass. Resolve the
design change, then preview again against the current revision.

Apply the successful preview only. Check the final document, save when part of
the agreed task, and verify the exported body ids. Report CAD measurements,
conservative or unsupported checks, source assumptions and physical fit
separately. Printed compatibility remains unverified until a physical fit test.
