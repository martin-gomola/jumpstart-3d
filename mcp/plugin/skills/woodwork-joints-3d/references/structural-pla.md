# Structural PLA — walls, infill, creep and when to switch material

The joinery skill defaults to PLA because the X2D ships with it and most
household jigs fit its envelope of use. Structural parts that take sustained
load, elevated temperature or outdoor exposure need different settings or a
different material. These are rules of thumb for Bambu Lab PLA Basic on
X2D with a 0.4 mm nozzle; verify on a load coupon when in doubt.

## PLA creep is real

PLA under constant load deforms over time. At room temperature a 1 kg
sustained load on a 10 mm thick PLA shelf will visibly sag within days.
Creep accelerates with temperature: above 45 °C the deformation is fast
enough to notice within hours.

Design rules to live with PLA creep:

- Load path must be in **compression**, not bending, for parts that stay
  loaded for more than a few hours. Columns, keys, wedges and stacked bodies
  are fine. Beams, cantilevers and platforms are not.
- Any beam under sustained load should be oriented so the load crosses the
  **widest cross-section**, not the thinnest. A platform 220 × 150 × 12 mm
  sags across the 220 mm span; across the 150 mm span it is three times
  stiffer.
- Add **triangulation**: a diagonal brace between a leg and a platform
  turns a bending load into a compression load along the brace. This is the
  single highest-value change for a stand or shelf.

## When to switch material

| Condition | Material | Notes |
| --- | --- | --- |
| Light display part, no sustained load | PLA Basic | Default |
| Jig, fixture used < 1 hour at a time | PLA Basic | Fine |
| Sustained load > 500 g for hours | PLA+ (tougher) or PETG | PETG has better creep resistance |
| In sunlight or near a window | PETG or ASA | PLA sags above 50 °C |
| Outdoor | ASA or PETG; never PLA | UV and heat kill PLA within weeks |
| Snap-fits, keys, hinges with cyclic load | PETG | PLA is brittle in fatigue |
| Food or warm liquid contact | PETG, food-safe grade | PLA deforms in the dishwasher |

When switching material, rerun the clearance test matrix in
[`fdm-tolerances.md`](fdm-tolerances.md): PETG tends to need **+0.05 to +0.10
mm** more gap on friction fits because strings and stringing settle into
tight joints.

## Walls, infill and perimeters for structural parts

For a part that must carry load:

- **Perimeters: ≥ 4** on the loaded surfaces. The default slicer value of 2
  is for cosmetic parts.
- **Infill: 25–40 %** on load-bearing bodies; **gyroid** or **cubic**
  pattern. Line infill is only for cosmetic parts.
- **Top and bottom layers: ≥ 5** so that the top surface does not dimple
  under point loads.
- **Wall thickness in CAD:** design walls at a multiple of the nozzle
  diameter (0.4 mm → 1.6 mm, 2.0 mm, 2.4 mm). A wall of 1.9 mm forces the
  slicer to leave gaps.

## Minimum body dimensions for load-bearing joint parts

Independent of the geometric minimums in [`fdm-tolerances.md`](fdm-tolerances.md):

- **Tenon in a load-bearing joint:** cross-section ≥ **5 × 5 mm**.
- **Wedge in a load-bearing joint:** min thickness ≥ **2 mm** at the tip,
  ≥ **5 mm** at the butt.
- **Dovetail tail in a load-bearing joint:** narrow end ≥ **5 mm**.

The smaller values in `fdm-tolerances.md` are the printability floor; these
are the load-bearing floor.

## Orientation on the plate

Loaded faces must sit on the plate so that layers run parallel to the load,
not across it. Specifically:

- **A-frame leg of a stand:** the triangle silhouette lies flat on the
  plate, layers build upward in Z. Loading is in-plane, which runs along
  layers.
- **Platform or shelf:** the top surface lies flat on the plate, layers
  build up into the thickness. Bending across the span then runs along
  layers (good), not across them (bad).
- **Wedge or key:** long axis along X or Y, driving direction parallel to a
  layer. Never print a wedge standing on its tip.
