---
name: woodwork-joints-3d
description: Generates printable wood-joinery assemblies in JumpStart through local MCP, adapting traditional Western and Japanese joints (dovetails, mortise-and-tenon, keyed tenons, Kanawa and Shachi scarf splices, folding-wedge locks) to FDM constraints on a Bambu Lab X2D printer (256 × 256 × 260 mm envelope). Use for hardware-free jigs, laptop and tablet stands, interlocking fixtures, boxes, display stands, measured frames, splice connectors that extend parts beyond the build volume, and furniture-style assemblies that must hold without glue or screws. Avoid generic 3D illustration, decorative rendering, and parts intended for CNC or real wood.
metadata:
  version: "0.2.0"
---

# Model a wood-joinery assembly in JumpStart

Use the installed `jumpstart` MCP with a running local editor. All coordinates
are millimetres and no external tools, scripts or uploads are required.

## Hard constraints (Bambu Lab X2D, PLA by default)

1. **Build volume (X2D):** main nozzle 256 × 256 × 260 mm; auxiliary or dual
   nozzle 235.5 × 256 × 256 mm. Design to a **safe envelope of 230 × 245 × 245
   mm** per part to leave margin for brim, first-layer calibration and
   multi-material mode. Anything larger must be split with a joint from
   [the catalog](references/joint-catalog.md) and reassembled.
2. **No supports:** overhangs stay under 45°; horizontal holes become teardrops
   or hex at diameters ≥ 4 mm.
3. **Layer anisotropy:** orient every joint so tensile and shear loads run
   along X/Y (layer plane), never across Z. If the plan would load a tenon or
   dowel in the Z axis, rotate the part or reclassify to a dovetail or keyed
   variant.
4. **Hardware-free:** no screws, bearings or glue. Fixation must come from
   friction, wedges, latches, draw-bore offsets or gravity locks.
5. **Material fitness:** PLA for light display and jig loads only. For any
   part under sustained load, elevated temperature or outdoor use, follow
   [`references/structural-pla.md`](references/structural-pla.md) and switch
   to PETG or PLA+ with its own tolerance pass.

## Workflow

1. Clarify the assembly: what mates to what, what loads it must carry
   (tension / compression / shear / bending / **racking**), whether it must
   be demountable, which dimension exceeds the envelope, and how long the
   load is sustained.
2. Pick the joint type with
   [`references/joint-selector.md`](references/joint-selector.md), then look up
   the exact ratios in
   [`references/joint-catalog.md`](references/joint-catalog.md). Prefer joints
   with FDM rating 4 or 5.
3. For splitting an oversized part into multiple prints, read
   [`references/splitting-strategies.md`](references/splitting-strategies.md).
   The default is **not** "Kanawa through the middle": the right split depends
   on where the bending maximum sits.
4. Apply tolerances from [`references/fdm-tolerances.md`](references/fdm-tolerances.md).
   `friction-fit` by default, `press-fit` only for permanent assemblies,
   `sliding` for parts that must repeatedly separate.
5. Apply every rule in [`references/no-support-rules.md`](references/no-support-rules.md)
   before issuing `jumpstart_preview_model`. Common wins: `R 0.4` shoulder
   fillet, `0.2 × 45°` elephant-foot chamfer, teardrop horizontal holes.
6. Inspect, apply, export. Always preview and run
   `jumpstart_inspect_geometry` on the mating faces before applying.

## Worked examples

| Request | Read before modeling |
| --- | --- |
| Laptop or tablet stand, 2–3 part demountable assembly | [`references/recipe-laptop-stand.md`](references/recipe-laptop-stand.md) |
| Splicing a part that exceeds 230 mm in any axis | [`references/splitting-strategies.md`](references/splitting-strategies.md) |
| Sustained load, warm environment, or outdoor part | [`references/structural-pla.md`](references/structural-pla.md) |

## Source ground truth

The Japanese joint names, English translations and page numbers in
[`references/japanese-sources.md`](references/japanese-sources.md) come from
the OCR-extracted text of *The Complete Japanese Joinery* (414 pp). Western
joint ratios (`T/3` tenon rule, 1:6 to 1:8 dovetail slope, draw-bore offset)
come from *The Joint Book* and *Woodwork Joints*. The X2D build-volume
numbers come from the Bambu Lab X2D specification sheet. The FDM tolerance
table, PLA structural guidance and no-support rules are engineering
conventions, not quotes from the books; calibrate on a 20 × 20 test matrix
when switching material or nozzle size.

## Limits

This skill does not design joints for real wood (grain direction, moisture
movement and species-specific shrinkage are ignored). PLA creep under
sustained load is not simulated — the structural-pla reference gives rules
of thumb, not an analysis. The folding-wedge and keyed designs assume PLA;
PETG or ABS need a separate clearance pass.
