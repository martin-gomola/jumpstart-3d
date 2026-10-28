# Recipe: laptop or tablet stand, 2–3 printed parts, no hardware

A full worked example for a demountable laptop stand that fits the X2D
envelope and holds a 14–16" laptop (≤ 2.5 kg) at a 15° typing angle.
Follows the hard constraints in [`SKILL.md`](../SKILL.md).

## Design intent

- **Laptop sits on top of a tilted platform.**
- **Two triangular side legs** carry the load straight to the desk through
  the triangle hypotenuse (compression, not bending). This is the key
  decision — a bent-sheet silhouette would fail by racking in weeks.
- **One central crossbar** ties the two legs together and prevents them
  from splaying. Doubles as a cable channel.
- **Three prints, no screws, no glue.** Legs printed flat on their
  triangular face; crossbar printed flat on its longest face.

Dominant loads to resist:

- **Compression** down the legs under the laptop weight → trivial for PLA.
- **Racking** of the leg-to-crossbar T-joint → **primary failure mode**.
- **Shear** at the crossbar-to-leg joint if the laptop slides forward →
  mitigated by a lip or stopper on the platform.

## Parameters (defaults, adjustable)

| Parameter | Default | Note |
| --- | --- | --- |
| `platform_width_W` | 280 mm | Fits 14–16" laptops |
| `platform_depth_D` | 180 mm | Front-to-back dimension of the top |
| `platform_angle_α` | 15° | Typing tilt |
| `leg_height_H` | 110 mm | Rear lift of the back edge above the desk |
| `leg_depth_L` | 180 mm | Equal to platform_depth so legs do not overhang |
| `thickness_T` | 10 mm | Material thickness for all parts |
| `crossbar_offset_from_front` | 60 mm | Keep crossbar away from the maximum-moment line (close to legs) |

Build-volume check: `platform_width_W = 280` exceeds the 230 mm safe
envelope, so the **platform must be split**. The two legs
(180 × 110 × 10) and the crossbar (280 → split, below) are the two other
printable bodies.

Alternative: **make the platform integral with the crossbar** and skip the
separate top. The 3 parts become `left_leg + right_leg + crossbar-platform`.
This is what we build below.

## Part breakdown

Three parts total:

1. **Left leg** (`180 × 110 × 10`): right-triangle silhouette, hypotenuse at
   15° from horizontal. Prints flat on the triangular face.
2. **Right leg** (`180 × 110 × 10`): mirror of left leg.
3. **Crossbar-platform** (`280 × 60 × 10`): long rectangular bar that spans
   the two legs and provides the top surface the laptop sits on. Length 280
   exceeds safe envelope → **split transversely into two halves of 140
   each**, joined with a short connector or a direct Kanawa splice at the
   midpoint under the laptop's centre of mass. See
   [`splitting-strategies.md`](splitting-strategies.md).

**Revised 3-part layout to stay within envelope and avoid splice under
load:** two legs + a shorter crossbar of **220 mm** (fits the envelope),
with the laptop supported directly by the top edges of the legs rather than
the crossbar. The crossbar then only resists racking, not vertical load.
This changes the recipe to:

| Part | Size | Role |
| --- | --- | --- |
| Left leg | `180 × 110 × 10` | Carries laptop load in compression; top edge is the actual rest surface |
| Right leg | `180 × 110 × 10` | Mirror of left |
| Crossbar | `220 × 60 × 10` | Ties the legs; prevents racking |

All three parts fit on one plate.

## Joint choice

Two joints, same type at both ends:

- **Crossbar ↔ left leg:** keyed tenon (tusk tenon) through the leg,
  wedge removable from the outside. Resists racking (wedge keeps the leg
  square to the crossbar) and allows disassembly for transport.
- **Crossbar ↔ right leg:** mirrored keyed tenon.

Rationale from [`joint-selector.md`](joint-selector.md): T-joint topology
with racking as primary load → first choice is "keyed tenon through the
leg".

## Exact dimensions

Material thickness `T = 10 mm`.

### Keyed tenon on each end of the crossbar

- `tenon_thickness = T/3 = 3.33 mm` → rounded up to **4 mm** (meets the
  structural minimum from [`structural-pla.md`](structural-pla.md): tenon
  cross-section ≥ 5 × 5 mm → **use 5 mm thickness** instead).
- `tenon_width = 2 × tenon_thk = 10 mm` → use **20 mm** (crossbar is wider,
  gives more area).
- `tenon_length = T_leg + wedge_pocket = 10 + 15 = 25 mm` protrusion
  through the leg.
- `wedge_pocket` on the protruding tenon: through hole 15 × 5 mm, **offset
  1.5 mm toward the shoulder** so the wedge pulls the leg tight.
- `wedge` separate print: `18 × 4 → 6 mm` taper over 18 mm length
  (ratio 1:9 ≈ 6.3°, below the self-locking limit).

### Leg mortise

- Rectangular through-hole **5.2 × 20.2 mm** (per-side clearance 0.1 mm,
  friction-fit from [`fdm-tolerances.md`](fdm-tolerances.md)).
- Internal corners filleted **R 0.5 mm** per no-support rule 5.
- Bottom entry edge chamfered **0.2 × 45°** per rule 4.
- Top edge of the leg (where the laptop rests) chamfered **1 mm × 45°**
  as a lead-in and anti-slip bevel.

### Crossbar

- `220 × 60 × 10` with two 5 × 20 mm tenons centred, one on each short end.
- Shoulder fillet **R 0.4 mm** per rule 4.
- Lead-in chamfer on each tenon **1 mm × 20°** per rule 6.

## Print orientation and settings

| Part | Orientation | Perimeters | Infill |
| --- | --- | --- | --- |
| Left leg | Triangular face on plate | **4** | **30 % gyroid** |
| Right leg | Triangular face on plate | **4** | **30 % gyroid** |
| Crossbar | 220 × 60 face on plate (lies flat along X) | **4** | **30 % gyroid** |
| 2× wedge | Long axis along X, driving direction parallel to a layer | **3** | **40 % cubic** |

Material: PLA Basic acceptable for a desk-use stand. If the stand lives in
sunlight or warm office, switch to PETG per
[`structural-pla.md`](structural-pla.md).

## Assembly

1. Insert the crossbar's left tenon through the left leg's mortise from the
   inside. Tap the shoulder flush.
2. Drive the first wedge into the exposed cross-slot from the top. The
   draw-bore offset pulls the leg tight to the shoulder.
3. Repeat on the right leg.
4. Place the laptop on the top edges of the legs. The front edge of the
   crossbar is 60 mm behind the laptop's front, so no vertical load reaches
   the crossbar.
5. To disassemble: tap wedges out from the bottom. No tools, no residue.

## MCP plan sketch (one keyed tenon)

Call `jumpstart_get_capabilities({includeSchemas:false})` and
`jumpstart_get_capabilities({schemaPaths:["plan.features","plan.operations"]})`
for the exact current schemas. The sketch below is illustrative only.

```json
{
  "plan": {
    "name": "crossbar-left-tenon",
    "features": [
      {"type":"sketch","id":"base","plane":"XY",
       "profile":{"type":"polygon","points":[[0,0],[220,0],[220,60],[0,60]]}},
      {"type":"extrude","id":"body","profile":"base","distance":10}
    ],
    "operations": [
      {"type":"sketch","id":"tenon_profile","plane":"XZ","offset":[0,30,0],
       "profile":{"type":"polygon","points":[[-2.5,0],[2.5,0],[2.5,10],[-2.5,10]]}},
      {"type":"extrude","id":"tenon","profile":"tenon_profile","distance":25,"merge":true},
      {"type":"modifier","target":"tenon","modifier":{"type":"hole",
        "at":[{"p":[215,30,5],"n":[0,1,0]}],"diameter":5,"depth":60}},
      {"type":"modifier","target":"body","modifier":{"type":"fillet",
        "edges":"shoulder_tenon_body","radius":0.4}},
      {"type":"modifier","target":"tenon","modifier":{"type":"chamfer",
        "edges":"tenon_lead_in","distance":1.0,"angle":20}}
    ]
  }
}
```

The `hole` modifier produces the wedge pocket; replace with a true
rectangular slot using a sketch-and-extrude-cut if the native hole feature
is round-only in your current MCP capabilities.
