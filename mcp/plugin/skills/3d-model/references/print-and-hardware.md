# Print setup and hardware

Use this reference for printed parts: the default printer profile, limits for
other processes, how to report printability, print pose, export for the slicer,
and holes or pockets for screws, nuts and heat-set inserts. Clearances between mating parts are in
[Fit and print checks](fit-and-print-checks.md).

## Contents

- Hand off to the slicer
- Other processes and printers
- Report printability findings
- Choose the print pose
- Hardware holes and pockets

## Hand off to the slicer

Supports, bridges, layer settings and material profiles stay in the slicer.
Do not ask about the printer each time. Use this default profile unless the
request names another printer, nozzle or material:

- Printer: Bambu Lab X2D, sliced in Bambu Studio, 0.4 mm nozzle, PLA, printed
  with one nozzle (no support material from the auxiliary nozzle).
- Usable envelope: 252 × 252 × 256 mm (256 × 256 × 260 mm main-nozzle
  volume less the 2 mm edge reserve and the dual-nozzle height); with two
  nozzles, 231.5 × 252 × 256 mm. Split a larger part.
- The same envelope fits a Bambu Lab A1 or P2S (256 × 256 × 256 mm).

Ask only when the answer changes the design: a part larger than the
envelope, a material other than PLA (ABS/ASA warps on the open A1), or
soft and rigid zones that suggest PLA with TPU on the X2D's two nozzles.

- Use `printability` limits of `minWall` 0.9 mm (about two perimeters) and
  `overhangAngle` 45°. When the user prints supports from the auxiliary
  nozzle, report overhangs without reshaping the part to remove them.
- Model parts in different materials as separate bodies so each can take its
  own filament in the slicer.
- Run the check on each body in its print pose and fix flagged areas in the
  CAD model while it is still editable: thicken walls, chamfer downward edges,
  or reorient the part.
- Export 3MF so separate parts stay separate objects in Bambu Studio or
  PrusaSlicer; use STL only when requested.
- In the report, name the print orientation, the printer profile and limits
  used, and what to inspect in the slicer preview, such as remaining
  overhangs needing supports.

A passing check means no flagged overhang or thin-wall area in the
tessellation; the slicer preview and a test print remain the authority.
To open the export in Bambu Studio or Bambu Connect, use the companion
`bambu-handoff` skill.

## Other processes and printers

When the request names a printer you do not know, or another process, use these
conservative design-guide defaults instead of the X2D profile. A datasheet the
user supplies for the machine or material overrides them.

| Limit | FDM, unknown printer | SLA/DLP resin | SLS (PA12) | MJF |
| --- | --- | --- | --- | --- |
| `minWall`, supported (mm) | 1.2 | 0.5 | 0.7 | 0.5 |
| `minWall`, unsupported (mm) | 1.6 | 1.0 | 0.7 | 0.5 |
| `overhangAngle` (degrees from vertical) | 45 | 60 | not applicable | not applicable |
| Smallest hole (mm) | 2.0 | 0.5 | 1.5 | 1.0 |
| Smallest positive feature (mm) | 0.8 | 0.2 | 0.8 | 0.5 |
| Longest unsupported bridge (mm) | 10 | 5 | not applicable | not applicable |

Powder processes (SLS, MJF) need no supports, so do not report overhangs for
them. Report enclosed cavities that trap powder instead, and note that escape
holes are not measured. The resin angle is the guides' 30° from horizontal.

## Report printability findings

Give each limit one of three results, and cite both the limit's source (the
profile above, this table or the user's datasheet) and the measured field:

- **pass**: a measured value meets the limit.
- **fail**: a measured value violates it. Give a fix with target numbers, such
  as "thicken the wall at `thinnestSamples[0]` from 0.6 mm to at least 1.2 mm",
  then preview again.
- **not checked**: nothing measured it. Smallest hole, smallest feature, bridge
  length and trapped powder have no `printability` measurement. Do not infer
  them from images, the bounding box or the plan's constants.

Report watertightness or `meshValidation` failures first, then walls, then
overhangs, then orientation. Thin-wall sampling is ray based: treat
`thinnestWall` as a sample, not an exhaustive minimum. The table is adapted
from the `dfam-check` skill in
[earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad) (MIT),
which cites the Hubs, Formlabs, HP and EOS design guides and ISO/ASTM 52910.

## Choose the print pose

When the request does not fix the print pose, call `jumpstart_inspect_geometry`
with `printOrientations: {}` (optionally `overhangAngle`) on the body. It lays
the six axis directions and the largest flat faces on the bed and ranks them by
overhang area, then bed contact, then height; `current: true` marks the modeled
pose. It does not change the document and does not score layer-direction
strength, finish or support removal. Name the chosen pose and why in the report;
reject a top-ranked pose that puts load across layers or a cosmetic face on the
bed. Preview a separate print layout only when that is part of the requested
handoff, and retain the intended final pose.

## Hardware holes and pockets

Starting values for metric hardware, sized for the default X2D 0.4 mm profile.
Confirm critical fits with a coupon. Clearance holes are ISO 273 medium; nuts
are ISO 4032. The nut pocket adds 0.3 mm to the width across flats; its hex
radius is the circumradius (across flats ÷ √3) for a six-sided polygon.

| Size | Clearance hole | Nut across flats | Nut height | Nut pocket hex radius | Pocket depth | Heat-set insert hole |
| --- | --- | --- | --- | --- | --- | --- |
| M2 | 2.4 | 4.0 | 1.6 | 2.48 | 1.8 | 3.2 |
| M2.5 | 2.9 | 5.0 | 2.0 | 3.06 | 2.2 | datasheet |
| M3 | 3.4 | 5.5 | 2.4 | 3.35 | 2.6 | 4.0 |
| M4 | 4.5 | 7.0 | 3.2 | 4.21 | 3.4 | 5.6 |
| M5 | 5.5 | 8.0 | 4.7 | 4.79 | 4.9 | 6.4 |
| M6 | 6.6 | 10.0 | 5.2 | 5.95 | 5.4 | 8.0 |
| M8 | 9.0 | 13.0 | 6.8 | 7.68 | 7.0 | datasheet |

All values are mm. Insert holes are for standard-length inserts of one common
vendor type; use the supplied insert's datasheet when it differs. Make an
insert hole at least the insert length plus 1 mm deep and keep 1.5 mm or more
of wall around it. Orient a hex pocket with a flat parallel to the bed, or add
a sacrificial bridge layer, when it prints face-down above the bed. A
`regularPolygon` profile with `acrossFlats` avoids the circumradius arithmetic.
