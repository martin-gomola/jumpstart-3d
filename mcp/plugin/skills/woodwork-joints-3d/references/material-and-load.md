# Material budget, load path and reference models

Size each member from the load it actually carries, then estimate printed
filament before the first preview. A design that passes every fit and
printability check can still waste half its filament.

## Load path first

For each member, name the load it sees in use: tension, compression,
bending or racking. Then size it for that load only.

- A **tie** that only holds two legs at their spacing is in tension. A flat
  strip a few millimetres thick is enough; do not make it tall.
- **Racking** is often resisted by more than one path: a wide foot, the
  laptop resting across both legs, or a second tie. Do not size one joint
  as if it were the only path unless it is.
- A **rail** that carries the laptop is in bending. Add a strut under long
  spans rather than thickening the whole rail. A 6 × 10 mm PLA rail over
  160 mm deflects about 1.4 mm under 10 N at mid-span; a strut at mid-span
  removes most of that.

## Estimate filament as the slicer prints it

Solid volume overstates sparse-infill parts and understates tall ribs. For
each part in its print pose, estimate:

```text
skin   = (1.0 + 0.8) mm × footprint area       (5 top + 4 bottom layers)
walls  = perimeter length × n × 0.42 mm × height
infill = remaining volume × infill fraction
grams  ≈ (skin + walls + infill) / 1000 × 1.24 for PLA
```

Use the settings *3D Printing Failures* recommends: for load-bearing parts
at least 4 walls (n = 4) and 20–40 % infill for functional parts. Walls add
far more strength than infill, and infill above 50 % adds little. Two walls
and 15 % infill suit decorative parts only. Keep at least 1 mm of top skin
so the top surface does not pit over the infill.

What this means for a design:

- Large flat faces cost skin. Replace a plate with a frame of ribs.
- Tall ribs cost walls. A 25 mm tall frame can use as much filament as a
  10 mm plate of the same outline. Keep frames low in their print pose.
- Narrow ribs print almost solid at 4 walls. That is fine for a frame, but
  count them as solid in the estimate.
- Report the estimate next to the previous design with the same settings so
  the user sees the saving, and say it is an estimate, not slicer output.

## Learning from a reference model

When the user supplies a reference STL, measure it before copying it:

1. Import it as a `reference` body with explicit `units` (see the
   `3d-model` imported-parts reference), or slice the binary STL locally if
   the editor is unavailable.
2. Take sections through each joint and read the real dimensions: head and
   pocket size, wall thickness, rib width, clearances.
3. Check whether the joint locks by shape or only by friction and glue. A
   rectangular head in a pocket open toward the inside does not resist
   pulling apart, whatever it looks like in a photo.
4. Ask the user how the printed reference fits. A measured gap with a known
   result ("0.1 mm, tight after pressing") is a calibration point; record it
   in [`fdm-tolerances.md`](fdm-tolerances.md).
5. Keep what works (low frame, thin tie, drop-in assembly) and fix what only
   holds by glue.
