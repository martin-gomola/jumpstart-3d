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

## Horizontal holes (hole axis in XY plane)

- Add **+0.20 mm** to the modelled diameter to compensate for thermal
  contraction and first-layer elephant foot.
- Convert to **teardrop** (45° apex upward) at diameter ≥ 4 mm.
- Below 4 mm, a hexagon with flat side up is simpler and prints cleanly.

## Elephant foot

Every shoulder that lands flat on the bed needs a **0.2 × 45° chamfer** on
the bottom edge, otherwise the shoulder will not seat into its mating
mortise.

## Minimum printable geometry

- `tenon_thk ≥ 2.0 mm`
- `wedge_tip_thk ≥ 1.2 mm`
- `dovetail_pin_narrow ≥ 3.0 mm`
- wall around a through mortise: **4 perimeters = 1.68 mm** minimum, **2.0 mm**
  recommended
