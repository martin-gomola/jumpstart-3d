# Optional Gridfinity magnet pockets

Read the focused `gridfinity` and `drawerLayout` schemas. Magnets are optional
and off by default. The generator creates pockets; it does not insert physical
magnets or certify their retention or magnetic strength.

Use `gridfinity.magnets: true` for default pocket dimensions, or an object with
`diameter` and `depth` in mm. Defaults are 6.5 mm diameter and 2.4 mm depth for
nominal 6 by 2 mm magnets with glue clearance. These are pocket dimensions, not
the physical magnet's diameter/depth. Ask which magnets the user has when the
default is not agreed. Do not call the default a calibrated press fit.

Pockets repeat four times per 42 mm cell at local ±13 mm (26 mm centers). Bins
and insert blanks have blind pockets opening from the underside. Their shaped
feet, top height, protected base and cutout floor requirements remain intact.

An open baseplate needs supporting material around its magnets. The magnetic
baseplate adds a perforated carrier beneath the original sockets, retaining a
0.8 mm floor under the pockets. Carrier height is pocket depth +0.8 mm. With
defaults, the plate is 8.2 mm tall and an aligned bin's foot bottom is at Z=3.45 mm
when the plate bottom is at Z=0. Use the recipe's `baseplatePlacementZ`; do not
retain the plain plate's 0.25 mm seating value for a magnetic plate.

For a drawer layout, use `baseplateMagnets` at layout level and `magnets` on each
bin. The compiler applies the same carrier height to bin placement and includes
that placement in usable-height checks. Reducing a bin's height, disabling the
carrier, or increasing the measured usable height requires an explicit design
choice; do not silently change measurements to make the layout pass.

The sidebar exposes bin magnets under More bin options and baseplate magnets
under Advanced construction. Use this magnet fit in all bins copies the current
bin configuration to all existing bins; newly added bins can be configured later.
Single part has its own Magnet pockets checkbox. All changes require a fresh
preview and explicit apply.

Inspect pocket count and opening direction in `magnetPockets` recipe data,
retained floor/roof with supported samples, connected geometry, and the aligned
native bin/baseplate pair for unintended overlap. The current geometry bounds
pocket diameter to 2–8 mm and depth to 0.5–4 mm. Unsupported sizes need a reviewed
interface change rather than bypassing validation.

Preview, inspect and apply as usual; save/reopen and named parameter revisions
retain pocket dimensions. Before gluing, use a polarity jig and confirm the
intended bin/baseplate pairing attracts. Propose a small fit coupon when actual
magnet and printer fit is unknown. Report physical fit and retention as unverified.
