# Plan a measured drawer

Establish inside width, inside depth, usable height and what the user wants to
store. Work in millimetres. Do not infer a specific drawer's dimensions from a
brand name or photograph. Label an example layout as an example.

Discover the focused `drawerLayout` operation schema. It uses a standard 42 mm
grid, calculates leftover space, and creates native bins or insert blanks plus
optional matching baseplates. `x` and `y` are whole-cell offsets from the
front-left of the usable grid; +Y points toward the back. The grid is centered
inside the supplied width/depth. Native part widths include the generator's
interface gap; do not subtract another arbitrary gap from their cell pitch.

Use one `drawerLayout` operation for an arrangement. Give it a stable `layoutId`,
inside `width`, `depth`, `height`, and named `bins`. Each bin specifies its cell
position, cell footprint, height units, kind and optional compartments/lip. Prefer
simple, labelled storage zones over many tiny bins. Show the user top-view
placement before generating the final parts. Check current limits rather than
silently truncating a large drawer or changing requested dimensions.

Choose bin heights against the usable drawer height. A stacking lip adds height;
bins seated on included baseplates also use the generator's placement offset.
Validate those complete heights rather than only comparing nominal height units.
Physical printed fit remains unverified. Propose an agreed small interface or
fit coupon when calibration is missing.

Optional `baseplateMagnets` and per-bin `magnets` add magnet pockets. A magnetic
baseplate raises bin seating by its pocket depth +0.8 mm; usable-height checks
include this added carrier. Use the directly linked magnet guidance for sizes.

When the grid splits into several baseplate tiles, `baseplateClips: true` adds
separate straight clips that join neighbouring tiles from below; the bin-seating
profile is unchanged. Clips do not reduce filament; offer them for alignment and
holding tiles together, and recommend printing one joint to check clearance.

Attach supported acceptance requirements, preview, and inspect the generated
parts for dimensions, geometry errors and connected meshes. Distinguish a planned
arrangement from printed drawer compatibility. Apply only the successful preview
against the same document revision; save the native project when requested.

`get_document` returns `drawerLayouts` with definitions, owned body ids and an
`editable` flag. To revise one, reuse its `layoutId` and explicitly set
`replaceExisting: true`. Preserve other document bodies. The compiler rejects
native edits, missing/locked parts and external dependencies; do not delete them
or bypass the check to force regeneration. Offer a new separate layout or
reconcile the user's native edits instead.

Put item-specific pockets on insert bins inside the layout with `bins[].pockets`
rather than separate `pocket` operations, so they regenerate with it. They take
the `pocket` operation's measured profile, position, depth, clearance and
`sourceEvidence`; a traced outline from `jumpstart_get_outline` becomes a
`contour` profile. A bin's own `floor` or `wall` overrides the drawer default and
also sets that bin's pocket material limits. Do not turn a
reference item's bounds into an exact fitted surface. Keep imported items as
reference bodies so they remain visible and are excluded from printable exports.

The sidebar's Drawer layout view uses the same typed operation. Draw/move bins
on the grid or use Add bin, footprint steppers, and keyboard movement. Select a
bin to edit its name, height, compartments, thickness and insert pockets. Advanced construction settings are
optional. Draft undo is separate from document undo; an unapplied arrangement
must not be described as saved in the native project.
