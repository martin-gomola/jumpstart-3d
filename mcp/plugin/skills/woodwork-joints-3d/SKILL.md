---
name: woodwork-joints-3d
description: Generates printable wood-joinery assemblies in JumpStart through local MCP, adapting traditional Western and Japanese joints (dovetails, mortise-and-tenon, keyed tenons, Kanawa and Shachi scarf splices, folding-wedge locks) to FDM constraints on a Bambu Lab A1 Mini printer. Use for hardware-free jigs, interlocking fixtures, boxes, display stands, measured frames, splice connectors that extend parts beyond the 170 mm build volume, and furniture-style assemblies that must hold without glue or screws. Avoid generic 3D illustration, decorative rendering, and parts intended for CNC or real wood.
metadata:
  version: "0.1.0"
---

# Model a wood-joinery assembly in JumpStart

Use the installed `jumpstart` MCP with a running local editor. All coordinates
are millimetres and no external tools, scripts or uploads are required.

## Hard constraints (Bambu Lab A1 Mini, PLA)

1. **Build volume:** split any assembly so each printed part fits inside
   170 × 170 × 170 mm. Larger parts must be split with a joint from
   [the catalog](references/joint-catalog.md) and reassembled.
2. **No supports:** overhangs stay under 45°; horizontal holes become teardrops
   or hex at diameters ≥ 4 mm.
3. **Layer anisotropy:** orient every joint so tensile and shear loads run
   along X/Y (layer plane), never across Z. If the plan would load a tenon or
   dowel in the Z axis, rotate the part or reclassify to a dovetail or keyed
   variant.
4. **Hardware-free:** no screws, bearings or glue. Fixation must come from
   friction, wedges, latches, draw-bore offsets or gravity locks.

## Workflow

1. Clarify the assembly: what mates to what, what loads it must carry
   (tension / compression / shear / bending), whether it should be
   demountable, and which dimension exceeds the build volume.
2. Pick a joint from [`references/joint-catalog.md`](references/joint-catalog.md).
   Prefer joints with FDM rating 4 or 5. For splicing an oversized part,
   default to **Kanawa tsugi with folding wedges**.
3. Apply tolerances from [`references/fdm-tolerances.md`](references/fdm-tolerances.md).
   Use `friction-fit` by default, `press-fit` only for permanent assemblies,
   `sliding` for parts that must repeatedly separate.
4. Apply every rule in [`references/no-support-rules.md`](references/no-support-rules.md)
   before issuing `jumpstart_preview_model`. The common wins are the
   `R 0.4 shoulder fillet`, the `0.2 × 45°` elephant-foot chamfer and the
   teardrop conversion for horizontal holes.
5. Inspect, apply, export. Always preview and run `jumpstart_inspect_geometry`
   on the mating faces before applying.

## Source ground truth

The Japanese joint names, English translations and page numbers in
[`references/japanese-sources.md`](references/japanese-sources.md) come from
the OCR-extracted text of *The Complete Japanese Joinery* (414 pp). Western
joint ratios (`T/3` tenon rule, 1:6 to 1:8 dovetail slope, draw-bore offset)
come from *The Joint Book* and *Woodwork Joints*. The FDM tolerance table and
the no-support rules are engineering conventions tuned for Bambu A1 Mini with
a 0.4 mm nozzle and 0.20 mm layer height — not from the books.

## Limits

This skill does not design joints for real wood (grain direction, moisture
movement and species-specific shrinkage are ignored). The folding-wedge and
keyed designs assume PLA; PETG or ABS need a separate clearance pass.
