# Joint selector

Pick the joint type from the load vector and the geometry topology, then
look up ratios in [`joint-catalog.md`](joint-catalog.md). "Primary load"
means the force the joint sees during normal use, not during assembly.

## By geometry topology

| Topology | Primary load | First choice | Second choice |
| --- | --- | --- | --- |
| **I-splice** (extend a straight member in its own axis) | tension, bending | Kanawa tsugi (keyed scarf) | Okkake daisen tsugi (sliding scarf + pin) |
| **I-splice** of a compression-only member (column) | compression | Koshikake ari tsugi (lapped dovetail) | plain shiplap with a cross-pin |
| **L-corner** of a rigid frame | racking, bending | Haunched tenon with wedge or draw-bore | Shachi tsugi (keyed haunched M&T) |
| **L-corner** of a box or tray | shear across the corner, pulling apart | Through dovetail | Half-blind dovetail (visible outside) |
| **T-joint** (crossbar meeting a leg) | shear, racking | Keyed tenon through the leg | Sliding dovetail with end key |
| **Cross** (two members intersecting at 90°) | compression, racking | Watari ago (dadoed cross lap) | Jyuji mechigai tsugi |
| **Flat panel edge-to-edge** join | shear, bending | Sliding dovetail with key | Mitered spline |
| **Removable cap or lid** | gravity + mild tension | Half-lap with sliding dovetail retainer | Keyed tenon with hand-removable pin |

## By primary load vector

| Load the joint must resist | Pick | Avoid |
| --- | --- | --- |
| **Pure tension along the member axis** | Kanawa tsugi, through-wedged tenon, draw-bored M&T | Plain M&T, dowel in Z |
| **Racking of a rigid frame** | Haunched tenon, Shachi tsugi, Kabuto ari at the corner | Plain miter, biscuit |
| **Shear across the joint** | Through dovetail, sliding dovetail, keyed tenon | Dowel, miter |
| **Sustained vertical compression** (e.g. laptop on top) | Koshikake ari tsugi, half-lap keyed, direct butt with cross-pin | Dovetail oriented inverted, blind mortise with thin ceiling |
| **Torsion of a long member** | Twin / double tenon, haunched tenon with draw-bore | Single thin tenon, dowel joint |
| **Demountable yet rigid** | Keyed/tusk tenon, Shachi tsugi, Kanawa with removable wedges | Press-fit anything |
| **One-time assembly, must not come apart** | Fox-wedged tenon, draw-bored M&T, press-fit dovetail | Keyed joints (owner will remove them) |

## Decision shortcut

Ask three questions in order:

1. **Is this a splice, a corner, or a crossing?** → row in the topology
   table above.
2. **What is the dominant load vector?** → confirms or overrides the pick.
3. **Must it be demountable?** If yes, require a keyed or draw-bored
   variant; reject press-fit even if the FDM rating is higher.

## Anti-patterns

- **Dowel into end-grain (Z axis in FDM):** replace with a dovetail or keyed
  tenon.
- **Miter without a spline or key:** always a failure under any real load.
- **Blind mortise where a through variant fits:** through is always better
  on FDM (no ceiling to adapt, visual confirmation of seating).
- **Decorative joint on a load-bearing surface:** structural joint first,
  cosmetic cover second.
