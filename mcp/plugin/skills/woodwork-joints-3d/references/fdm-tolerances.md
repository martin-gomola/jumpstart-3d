# FDM clearance table

Tuned for Bambu Lab X2D with the stock **0.4 mm nozzle** and **0.20 mm
layer** height on PLA. Values are the **total** gap between two walls (not
per side). Divide by two for the per-side offset in CAD. These are
engineering conventions, not quotes from the joinery books — calibrate on a
test matrix if moving to PETG, ABS, 0.6 mm or 0.8 mm nozzles. For 0.2 mm
nozzle work, halve both the gap and the minimum geometry below.

| Fit | Use for | Total gap (mm) | Per side (mm) | Notes |
| --- | --- | --- | --- | --- |
| **Press-fit / permanent** | fox-wedged tenon, draw-bore pin | 0.10 – 0.15 | 0.05 – 0.08 | mallet-seated; not demountable |
| **Friction-fit / demountable** | through M&T, keyed tenon, Kanawa tsugi | 0.20 – 0.30 | 0.10 – 0.15 | reassemblable; friction holds short-term without the key |
| **Sliding / zasúvateľný** | sliding dovetail, drawer runners | 0.30 – 0.40 | 0.15 – 0.20 | smooth slide along one axis; still self-locking in the dovetail direction |
| **Pivot / cam** | wooden-style cam clamp, holdfast | 0.40 – 0.50 | 0.20 – 0.25 | rotation without binding; clamping force comes from friction on the cam curve |
| **Folding-wedge** | wedges in a Kanawa splice | wedge slim side −0.15 vs mortise, thick side nominal | — | wedge should *press*; mild interference is intentional |

## Baselines from the 3D printing books

*3D Printing Failures* (Sean Aranda) gives these starting points. Use them
only until a tolerance gauge or coupon has been printed on the user's
machine:

- Mating clearance is about half the nozzle diameter in the layer plane
  (0.2 mm for a 0.4 mm nozzle) and one layer height along print Z. The
  author reached 0.25 mm for a tight fit and 0.35 mm for a loose one on his
  own printers.
- **Gaps along print Z are quantized to the layer height.** The slicer
  rounds them to whole layers, so a 0.1 mm gap at 0.2 mm layers prints as 0
  or 0.2 mm. Put fine clearances in the layer plane, or make a Z gap at
  least one layer.
- Printed holes come out smaller and outer dimensions larger. Compensate
  the hole and the peg, not only the hole.
- For parts that must mate, a slicer flow of 98–99 % helps; check the
  extrusion calibration before blaming the clearance.
- Print a stepped tolerance gauge before relying on any table, including
  this one.

## Measured on the user's prints

| Joint | Modelled gap | Result |
| --- | --- | --- |
| Flat tie head, 2.4 mm thick, in a 2.5 mm pocket open on the bed side (one closed face) | 0.10 mm | tight; seats when pressed by hand |
| Same head, 22.4 mm wide in a 23.0 mm pocket | 0.30 mm per side | loose; does not hold on its own |

Prefer these values over the conventions above for the same printer and
material. Add a row whenever the user reports a printed fit.

## Horizontal holes (hole axis in XY plane)

- Add **+0.20 mm** to the modelled diameter to compensate for thermal
  contraction and first-layer elephant foot.
- Convert to **teardrop** (45° apex upward) at diameter ≥ 4 mm.
- Below 4 mm, a hexagon with flat side up is simpler and prints cleanly.

## Elephant foot

Every shoulder that lands flat on the bed needs a **0.2 × 45° chamfer** on
the bottom edge, otherwise the shoulder will not seat into its mating
mortise. The chamfer complements the slicer fixes in *3D Printing
Failures*: negative first-layer expansion (elephant-foot compensation) and a
PLA bed at 55–60 °C at most.

## Before printing

Tell the user to step through the slicer layer preview and confirm that no
thin wall, pin or joint feature is skipped, and that no support is generated
inside a pocket or socket.

## Minimum printable geometry

- `tenon_thk ≥ 2.0 mm`
- `wedge_tip_thk ≥ 1.2 mm`
- `dovetail_pin_narrow ≥ 3.0 mm`
- wall around a through mortise: **4 perimeters = 1.68 mm** minimum, **2.0 mm**
  recommended
- walls braced by neighbouring walls ≥ **1 mm**; free-standing pins, tabs and
  hooks ≥ **2 mm**; highly stressed features **3–5 mm** (*Blender 3D Printing
  by Example*)
- thin walls as whole multiples of the line width (0.84, 1.26, 1.68 mm at
  0.42 mm lines), otherwise the slicer leaves a gap inside the wall
