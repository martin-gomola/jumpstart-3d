# Splitting an oversized part

The X2D safe envelope is **230 × 245 × 245 mm** per part. The question when
a part exceeds it is not just "which joint" — it is "where to put the split
and in what geometry". The wrong split location can halve the strength of
the whole assembly.

## Rule 1: never split through a bending maximum

For any beam, platform or arm, the bending moment peaks where the load is
applied or at the supports. The splice must sit at or near the **neutral
zone**, which is:

- For a simply supported platform with a point load in the middle: close to
  the support, not the middle.
- For a cantilever: at the free end, not the root.
- For a stand with a load on top and feet on the ground: between the top
  surface and the mid-height, where moment is lowest, not in the middle of
  the top platform.

If you cannot put the splice outside the bending maximum, change the
splitting topology instead.

## Rule 2: pick the splitting topology first, then the joint

| Splitting topology | When | Joint pattern |
| --- | --- | --- |
| **Longitudinal splice** (two halves of a long beam) | long thin member, bending along its length | Kanawa tsugi at a low-moment zone |
| **Transverse split with cross-connector** (two halves + a middle piece bridging them) | wide platform, point load in the middle, X2D width exceeded | Each half mates to the connector with a sliding dovetail or keyed tenon |
| **Modular segments on a shared rail** | long member that could be reused with different lengths | Repeated keyed-tenon pockets along a central rail |
| **Hinged fold** | needs transport volume, not strength under load | Pin-and-knuckle (not covered by this skill, use external hinge) |

## Rule 3: match the splice to the dominant load

- **Compression along the splice axis:** butt joint with a cross-pin
  (Okkake daisen style) is enough; a scarf adds nothing.
- **Tension or bending across the splice:** Kanawa tsugi or draw-bored
  scarf; the keyed geometry turns the ongoing load into a self-tightening
  force.
- **Pure shear across the splice:** sliding dovetail with a locking key at
  the far end.
- **Combined bending + torsion** (common on wide flat parts): twin tenon or
  twin sliding dovetails; a single keyway allows the parts to rotate under
  torsion.

## Rule 4: budget the kerf

Every joint consumes material in the splice. Budget:

- Kanawa tsugi: **L = 3 to 3.5 × member width**. A 60 mm wide beam needs a
  180–210 mm long overlap zone — this is often *larger* than the piece you
  tried to splice. Verify before committing.
- Keyed tenon: `tenon_length ≥ 2 × T` plus 15 mm for the wedge pocket.
- Sliding dovetail: full length of the mating edge; no extra budget needed.

## Rule 5: prefer symmetric splits

Three equal parts beat two unequal parts for printing (same orientation,
same supports, same shrinkage behaviour). When a 3-part split is required
and no load argues against it, aim for **thirds**, not halves plus a
leftover.

## Example: platform wider than 245 mm

A laptop platform of 300 × 220 × 12 cannot print in one piece on X2D's safe
envelope. Candidate splits ranked by stiffness:

1. **Two halves (150 × 220 each) + a 50 × 220 central connector.** The
   splice is a sliding dovetail on each half mating with the connector.
   Bending moment at the splice is low because the splice is between the two
   feet, not under the laptop centre of mass. **Recommended.**
2. One Kanawa splice straight across the middle. Fast to design but puts
   the keyed pin exactly under the laptop. Only acceptable if the pin pocket
   is on the underside and the top surface is continuous.
3. 3 equal strips of 100 × 220. Three splice lines, strongest in bending
   but hardest to assemble flat.
