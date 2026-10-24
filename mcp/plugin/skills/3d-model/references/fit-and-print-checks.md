# Fit and print checks

Use this reference when parts must meet, slide, mount, or print with a specified
clearance. Read the current inspection schema before requesting measurements.

## Contents

- Establish the functional interface
- Measure a pair in one revision
- Attach pair acceptance before building
- Choose the manufacturing assumptions
- Review installation and print poses separately

## Establish the functional interface

Record what the part touches, its insertion/removal direction, the relevant
mounting faces, the required access, and the available envelope. Obtain critical
interface sizes from supplied measurements, a verified drawing, or source CAD.
A product cover's outline does not establish the cavity underneath it. For a
concept, keep inferred dimensions explicitly provisional and editable.

Use named parameters such as `lid_gap_per_side` and `insert_extra_depth`. State
whether a clearance is per side, diametral, or a minimum between whole solids.
For a centered rectangular insert, a per-side gap changes each outside dimension
by twice the gap. This arithmetic is a design choice; inspect resulting geometry
independently. Avoid hidden fit constants in unrelated expressions.

## Measure a pair in one revision

`jumpstart_inspect_geometry` accepts `againstBodyId` alongside `bodyId`. Supply
`expectedRevision` and, for proposed geometry, `previewId`. Both operands must
belong to the same current document or cached preview. Initial support is native
CAD or STEP with one valid positive-volume solid per operand and rigid or
uniform-scale placement. Nonuniform scale, shear and perspective are unsupported. Imported STL/3MF
and Lathe recipe meshes are unsupported, even if their mesh passes validation.

The `pair` result contains a nonnegative `distanceMm`, world-space witness
points, and a separate `overlapVolumeMm3`. A completed query has `status:
"measured"`; a failed, unsupported or timed-out query is `unknown`, not zero.

Zero distance does not distinguish contact from overlap or containment.
Read the overlap result before claiming that bodies do not intersect. A minimum
distance between entire solids also includes intentional contacts: it is not a
measurement of one selected wall's running clearance or penetration depth.
Define which parts may touch before choosing a requirement. Selected-face gap
and automatic datum-mating operations are not part of this initial interface.

## Attach pair acceptance before building

All preview tools accept `requirements.pairs`. For example, this synthetic
fixture requests a 0.3 mm separation and no material overlap:

```json
{
  "requirements": {
    "pairs": [{
      "id": "lid-fit",
      "a": "base",
      "b": "lid",
      "minimumClearance": 0.3,
      "maximumOverlapVolume": 0
    }]
  }
}
```

`a` and `b` identify plan body references or existing native body ids, each
resolving to one different body. `minimumClearance` is mm;
`maximumOverlapVolume` is mm3. The fixture values are not printer recommendations.
Numerical `distanceTolerance` defaults to 0.0001 mm and `volumeTolerance` to
0.000001 mm3; these account for computation, not manufacturing allowance.

Read `acceptance.pairs` and the individual threshold results. Failed or unknown
attached pair requirements block apply. A later inspection using looser limits
cannot replace the original acceptance contract. Correct the design and preview
again; resubmit requirements on every later revision. Do not convert meshes or
invent proxy geometry merely to obtain a passing check. If a proxy is useful,
obtain agreement and label exactly which fit requirements remain unverified.

## Choose the manufacturing assumptions

Establish the intended process, material, printer/nozzle if applicable, and
whether the part will be removed or moved repeatedly. Ask about relevant heat,
water, load and access requirements instead of certifying them from geometry.

Do not use one clearance, wall thickness, hole compensation or overhang limit
for every printer and material. Keep supplied values separate from calibration
assumptions. When behavior is unknown, propose a small native fit coupon using
the same mating profile, orientation and settings. Record the chosen tested
variant before revising the complete part. Manufacturer-specific inserts need
manufacturer-specific dimensions; a nominal screw size is insufficient.

Build envelope and interfaces first, functional walls/openings second, then
finishing features. Preserve smooth surfaces and requested fillets. Use ribs
and thin contact plates where appropriate rather than adding an unnecessary
solid mass to support a phone or bridge a cavity.

## Review installation and print poses separately

Inspect the assembled installation pose from complete views, especially the
mating side and insertion path. Do not rotate the reference assembly to hide a
placement error. Preview a separate print layout only when that is part of the
requested handoff, and retain the intended final pose.

Report measured CAD clearance, overlap, source geometry and unverified physical
fit separately. A valid solid or passing pair check does not establish printed
fit, material strength, minimum wall thickness everywhere or collision freedom
through a continuous motion. Use bounded sections/mesh checks for additional
supported questions and name what remains unchecked.
