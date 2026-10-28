# Recipe: laptop or tablet stand, 2–3 printed parts, no hardware

A full worked example for a demountable laptop stand that fits the X2D
envelope and holds a 14–16" laptop (≤ 2.5 kg) at a 15° typing angle.
Follows the hard constraints in [`SKILL.md`](../SKILL.md).

## Design intent

- **Laptop rests on the sloped top edges of two legs.**
- **Two solid side legs** carry the load straight to the desk in
  compression, not bending. This is the key decision — a bent-sheet
  silhouette would fail by racking in weeks.
- **One upright crossbar near the rear** ties the two legs together and
  prevents them from splaying sideways.
- **Three structural prints plus two wedges, no screws, no glue.** Legs
  print flat on their side face; the crossbar prints flat on the face its
  tenons are flush with.

Dominant loads to resist:

- **Compression** down the legs under the laptop weight → trivial for PLA.
- **Racking** of the leg-to-crossbar T-joint → **primary failure mode**.
- **Shear** at the crossbar-to-leg joint if the laptop slides forward →
  mitigated by a lip or stopper on the platform.

## Parameters (defaults, adjustable)

| Parameter | Default | Note |
| --- | --- | --- |
| `platform_angle_α` | 15° | Typing tilt of the leg top edge |
| `leg_depth_L` | 180 mm | Front-to-back length of each leg |
| `leg_front_h` | 15 mm | Leg height at the front; rear height follows from α |
| `leg_rear_h` | 63.2 mm | `15 + 180 × tan 15°` |
| `lip` | 8 × 10 mm | Front stop rising 10 mm above the rest edge |
| `thickness_T` | 10 mm | Material thickness for all parts |
| `crossbar_body` | 190 × 40 × 10 mm | Between the legs, upright, near the rear |
| `crossbar_total` | 240 mm | Body plus two 25 mm tenons; must stay ≤ 252 mm |

There is no separate platform: a 280 mm platform would exceed the 252 mm
usable envelope and need a splice under the laptop. The laptop rests
directly on the 10 mm top edges of the two legs, and the crossbar only
resists racking.

Check the geometry before modeling. A 180 × 110 mm right triangle slopes at
31°, not 15°, and a 220 mm crossbar body plus two tenons is 270 mm long and
does not fit the plate. Both errors appeared in an earlier version of this
recipe.

## Part breakdown

| Part | Size | Role |
| --- | --- | --- |
| Left leg | `180 × 63.2 × 10` trapezoid with front lip | Carries the laptop in compression; top edge is the rest surface |
| Right leg | same | Mirror position |
| Crossbar | `240 × 40 × 10` including tenons | Ties the legs 190 mm apart; prevents racking |
| 2× wedge | `18 × 14.6 × 6` | Locks each tenon |

Leg profile (Y front-to-back, Z up): `(0,0) (180,0) (180,63.2) (8,17.14)
(8,27) (0,27)`. Place the crossbar upright with its faces at Y 150–160 and
Z 5–45. The leg top edge there is at 55–58 mm, so the laptop clears the
crossbar by about 10 mm.

All five parts fit on one 252 × 252 mm plate.

## Joint choice

Two joints, same type at both ends:

- **Crossbar ↔ left leg:** keyed tenon (tusk tenon) through the leg,
  wedge removable from the outside. Resists racking (wedge keeps the leg
  square to the crossbar) and allows disassembly for transport.
- **Crossbar ↔ right leg:** mirrored keyed tenon.

Rationale from [`joint-selector.md`](joint-selector.md): T-joint topology
with racking as primary load → first choice is "keyed tenon through the
leg".

### Recommended light variant: frame legs and a dovetail tie

Use this variant unless the user asks for the keyed or sliding versions. It
prints in about 62 g of PLA instead of about 104 g for solid legs and an
upright crossbar, both at 4 walls and 15 % infill (estimates from
[`material-and-load.md`](material-and-load.md)). It follows the reference
15" notebook stand: low frame legs and a thin tie on the desk. Unlike that
reference, the tie locks by shape instead of glue.

- **Leg:** the same profile extruded 10 mm, with two windows cut through it.
  Ribs are 5 mm: front strut Y 8–13, mid strut Y 87.5–92.5 above the tie
  pocket, rear strut Y 175–180, sloped rail 5 mm measured square to the
  slope. The floor rail stays 8 mm tall to hold the pocket. Window corners
  are chamfered 2 mm. Front window `(15,8) (85.5,8) (87.5,10) (87.5,31.266)
  (85.568,32.748) (14.932,13.822) (13,11.304) (13,10)`; rear window
  `(94.5,8) (173,8) (175,10) (175,54.712) (173.068,56.194) (94.432,35.124)
  (92.5,32.606) (92.5,10)`.
- **Foot:** an inward pad 10 mm wide, 56 mm long (Y 62–118) and 8 mm tall
  on each leg, so the leg is 20 mm wide where the tie enters.
- **Tie:** a flat strip 4 mm thick lying on the desk, neck 10 mm wide and
  170 mm long between the feet. Each end has a dovetail head flaring from
  10 to 24 mm over 16 mm (about 24° per side). Total length 202 mm.
- **Pocket:** the head offset 0.15 mm on the flanks and the end, 4.1 mm
  tall, cut up from the underside of the foot and open toward the inside.
  The outer wall is 3.85 mm and the pocket ceiling 3.9 mm. Press each leg
  down onto a head; pulling the legs apart wedges the heads tighter.
- **Fit:** 0.1 mm to the pocket ceiling is the measured tight fit in
  [`fdm-tolerances.md`](fdm-tolerances.md). Pair checks use
  `minimumClearance` 0.1 with `distanceTolerance` 0.002 and
  `maximumOverlapVolume` 0.
- **Print:** each leg with its outer face on the bed (zero overhang; the
  pocket flanks lean 24° from vertical); the tie flat.
- **Limits:** the tie does not resist lifting. Lifting the stand by a leg
  leaves the tie on the desk unless the ceiling fit holds it by friction.
  Flank clearance 0.15 mm is a convention, not yet measured; print one foot
  section and tie end as a coupon first.

### Three-part variant: vertical sliding dovetail

When the user wants exactly three parts, drop the wedges and use a
**half-dovetail that slides down** into a stopped socket in each leg. The
joint selector's alternative "sliding dovetail with end key" applies, with
gravity and the socket floor acting as the key.

- **Crossbar:** one XY profile extruded 40 mm (Z 5–45): body 189.7 × 10 mm
  between the legs plus a 6 mm tail at each end. The tail is flush with the
  bed face (Y 150) and flares 1:6 on the other side, from 6 mm at the
  shoulder to 7 mm at the tip. Total length 201.7 mm.
- **Leg socket:** the tail profile offset 0.15 mm per side (sliding fit),
  6 mm deep into the inner face, leaving a 3.85 mm outer wall. It is open at
  the leg top edge and stopped at Z 4.85, so the crossbar hangs on the
  socket floor 5 mm above the desk.
- **Print:** each leg with its outer face on the bed (socket opening up);
  the crossbar on its flat tail face. Both poses rank first with zero
  overhang; the opposite faces give 376 and 487 mm².
- **Checks:** pair `minimumClearance` 0.15 mm with `distanceTolerance`
  0.002 and `maximumOverlapVolume` 0. The shoulder is held 0.15 mm off the
  leg face for the same reason as the keyed version.
- **Limits:** lifting by the legs carries the crossbar; lifting by the
  crossbar lets the legs slide off. The 1 mm interlock is small, so print a
  40 mm tall coupon of one socket and tail first.

## Exact dimensions

Material thickness `T = 10 mm`.

### Keyed tenon on each end of the crossbar

- `tenon_thickness = T/3 = 3.33 mm` → rounded up to **4 mm** (meets the
  structural minimum from [`structural-pla.md`](structural-pla.md): tenon
  cross-section ≥ 5 × 5 mm → **use 5 mm thickness** instead).
- `tenon_width = 2 × tenon_thk = 10 mm` → use **20 mm** (crossbar is wider,
  gives more area).
- **Bare-faced:** the tenon sits flush with the crossbar face that lies on
  the bed (no-support rule 8). A tenon centred in the 10 mm thickness
  leaves 400+ mm² of unsupported underside.
- `tenon_length = T_leg + 15 = 25 mm` protrusion through the leg.
- `wedge_pocket`: rectangular through slot across the tenon, perpendicular
  to the bed, **6 mm along the tenon × 15 mm across it**. Its shoulder-side
  edge sits **1 mm inside the leg's outer face** (draw-bore offset, rule
  11), so measured from the shoulder the slot spans 9–15 mm. The wedge then
  bears on the leg face and the slot's far edge, a 5 mm gap. This leaves
  2.5 mm walls beside the slot and 10 mm of tenon beyond it.
- `wedge` separate print: **18 mm long, tapering 4 → 6 mm, 14.6 mm wide**
  (0.2 mm per side in the 15 mm slot). The taper is 1:9 ≈ 6.3°, below the
  self-locking limit, and the wedge binds at mid-length where it is 5 mm.

### Leg mortise

- Rectangular through-hole **5.2 × 20.2 mm** (per-side clearance 0.1 mm,
  friction-fit from [`fdm-tolerances.md`](fdm-tolerances.md)), aligned
  with the bare-faced tenon: 0.1 mm proud of the crossbar's bed face.
- Internal corners filleted **R 0.5 mm** per no-support rule 5.
- All four entry edges chamfered **0.5 mm** on both faces of the leg. On
  the shoulder side this is required, not cosmetic: a sharp mortise edge
  sits about 0.02 mm from the R 0.4 shoulder fillet, so the pair check
  fails. With the chamfer the fillet clears it and the 0.1 mm side gap
  stays the minimum.
- Top edge of the leg (where the laptop rests) chamfered **1 mm × 45°**
  as a lead-in and anti-slip bevel.

### Crossbar

- `190 × 40 × 10` body with two 5 × 20 mm bare-faced tenons, centred across
  the 40 mm height and flush with the bed face, one on each short end.
- Shoulder fillet **R 0.4 mm** per rule 4.
- Lead-in chamfer on each tenon **1 mm × 20°** per rule 6.

## Print orientation and settings

| Part | Orientation | Perimeters | Infill |
| --- | --- | --- | --- |
| Left leg | Triangular face on plate | **4** | **30 % gyroid** |
| Right leg | Triangular face on plate | **4** | **30 % gyroid** |
| Crossbar | 240 × 40 face flush with the tenons on plate | **4** | **30 % gyroid** |
| 2× wedge | 18 × 14.6 face on plate, taper facing up | **3** | **40 % cubic** |

Material: PLA Basic acceptable for a desk-use stand. If the stand lives in
sunlight or warm office, switch to PETG per
[`structural-pla.md`](structural-pla.md).

## Assembly

1. Insert the crossbar's left tenon through the left leg's mortise from the
   inside. Tap the shoulder flush.
2. Drive the first wedge front-to-back through the slot in the protruding
   tenon. The draw-bore offset pulls the leg tight to the shoulder.
3. Repeat on the right leg.
4. Place the laptop on the top edges of the legs, against the front lips.
   The crossbar sits about 10 mm below the rest line, so no vertical load
   reaches it.
5. To disassemble: tap the wedges out from the back. No tools, no residue.

## Build order in JumpStart

This recipe gives dimensions, not plan JSON. Read the current operation
schemas with `jumpstart_get_capabilities({includeSchemas:false})` and then
only the needed `schemaPaths`; do not copy field names from older examples.

1. Build the crossbar as one native body: the 190 × 40 × 10 bar, the two
   bare-faced 5 × 20 × 25 mm end tenons joined to it (let each tool overlap
   the bar by 1 mm instead of touching its end face), and the 6 × 15 mm
   wedge slots cut with box tools, not round holes.
2. Build each leg as its own body with the 5.2 × 20.2 mm through mortise.
3. Build each wedge as its own body.
4. Add the shoulder fillets and lead-in chamfers from the sections above as
   modifier operations on the existing bodies.
5. Pose the crossbar and legs assembled, but hold each shoulder **0.1 mm
   off** its leg face. The shoulder touches the leg in reality, and a
   touching pair always measures 0 mm, which hides the mortise clearance.
   Lay the wedges beside the assembly in their print pose. Preview with
   these `requirements`: five bodies; per-body world bounds inside
   252 × 252 × 256 mm; printability on the crossbar and wedges (both already
   lie in their print pose); `requirements.pairs` for crossbar to each leg
   (`minimumClearance` 0.1 mm with `distanceTolerance` 0.001,
   `maximumOverlapVolume` 0). The wedge locks by interference, so check it
   on the coupon, not with a clearance pair.
6. Run `jumpstart_inspect_geometry` with `printOrientations: {}` on each
   leg, which is posed upright for the assembly. The top-ranked pose should
   lie flat with zero overhang; the upright pose overhangs above the mortise.
7. Apply only after every check passes. Print a coupon before the full set:
   a 40 mm crossbar end with its tenon and slot, a 50 × 40 mm leg piece with
   one mortise, and one wedge.
