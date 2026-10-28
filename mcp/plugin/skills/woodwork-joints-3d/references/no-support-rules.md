# No-support adaptations

The CAD agent applies these rules automatically before issuing
`jumpstart_preview_model`. Rules are ordered so the first applicable one
wins.

1. **Internal 90° ceiling of a blind mortise:** replace the flat ceiling with
   an interior 45° chamfer at the back wall, or convert the mortise to a
   through variant. Through is always preferred.
2. **Horizontal round hole, diameter ≥ 4 mm:** convert to a teardrop with
   45° apex upward. Square cross-pin mortises get a 45° roof ridge, not a
   flat bridge.
3. **External overhang > 45°:** forbidden. Dovetails at 1:6 (9.46°) and 1:8
   (7.13°) are safe at any face; the only failure mode is printing the
   dovetail inverted.
4. **Tenon shoulder:** fillet the inner corner between shoulder and mortise
   face with **R 0.4** (one nozzle width). Removes stress concentration and
   elephant foot simultaneously.
5. **Internal mortise corners:** always fillet R 0.5–1.0 mm. Perfect 90°
   internal corners are impossible with a round nozzle and become crack
   initiators under cyclic load.
6. **Tenon lead-in edge:** add a 1 mm × 20° chamfer on the entry edge of
   every tenon and wedge. Prevents delamination of the first layer during
   assembly.
7. **Wall around a through mortise:** minimum 4 perimeters (1.68 mm),
   recommended 2.0 mm. Below this the key will split the wall.
8. **Tenon orientation:** the tenon axis must lie parallel to the print bed
   (XY). If the planned orientation puts the axis in Z, rotate the whole
   part, or split it and add a lap/key to each half.
9. **Oversized part (> 170 mm in any axis):** split with a **Kanawa tsugi
   with folding wedges** in the lowest-stress zone (farthest from a bending
   maximum). Orient both halves to print flat.
10. **Wedges print flat:** always on their side, long axis in X or Y, layers
    parallel to the driving direction. Default taper **1:10 (5.71°)**; for
    opposed folding-wedge pairs (Kanawa) use **1:12 (4.76°)** each.
11. **Draw-bore offset:** parameter `offset`, default **1.0 mm** for PLA
    (reduced from the wood convention of 1.5–2 mm because PLA has lower
    local plasticity and would tear).
12. **Dovetail tail root:** fillet R 0.8 mm at the base of the tail to avoid
    both stress concentration and nozzle-radius mismatch.
13. **No tensile load in Z:** forbidden. Flip the orientation or reclassify
    the joint to a dovetail or keyed variant where tension runs in the layer
    plane.
14. **Cam clamp self-locking:** rise angle `β` at the contact point must
    satisfy `β ≤ arctan(μ)`. For PLA-on-PLA `μ ≈ 0.3` → `β ≤ 16.7°`.
    Default design **β = 10°** with margin. Simple curve: Archimedean
    spiral `r(θ) = r₀ + k·θ` with `k = r₀·tan(β) / 1 rad`.
15. **Hard minimums:** `tenon_thk ≥ 2.0 mm`, `wedge_tip_thk ≥ 1.2 mm`,
    `dovetail_pin_narrow ≥ 3.0 mm`. The CAD agent refuses to generate below
    these values.
