# SOMA and text-to-cad adoption checklist

Created: 2026-10-24. Target: our self-hosted JumpStart fork.
Reviewed sources: SOMA `f66cbd97d6ff670c77a2b8ed236daebde363cbc2`;
text-to-cad `2f793659fb7bab537e2f00836e06448fc4087cb2`.

Paths below resolve from the repository root.

The current implementation covers items 1–3, 6 and 9; item 7 is partly covered
by skill guidance and item 8 partly by item 9. Items 4, 5, 7, 8 and 10 remain an ordered backlog, not claims of
implemented functionality. Keep this file updated with
actual evidence. Existing local work must be preserved; no upstream push or PR.

## Invariants for every shipped item

Rechecked for each completed slice; retain these invariants for each backlog item.

- [x] Preserve typed native plans, editable bodies, preview → inspect → explicit apply.
- [x] Preserve revision/fingerprint guards, stale rejection, idempotent apply and undo.
- [x] Keep loopback access and self-hosting; no API-key service or arbitrary script tool.
- [x] Keep measurements independent of submitted expectations; unavailable results are unknown.
- [x] Keep detailed task instructions in directly linked skill references.
- [x] Record source provenance and applicable licenses for any reused code/data.

## 1. Pairwise clearance and overlap checks — adapt code — complete

Source: `../text-to-cad/packages/cadgen/src/cadgen/geometry.py` and its geometry tests (MIT).
Adapt the query semantics to our OCCT worker; do not add a Python runtime.

- [x] Verify distance, witness-point and intersection APIs in the shipped WASM.
- [x] Add bounded read-only pair queries to the existing geometry inspection tool.
- [x] Measure world-space distance and intersection volume independently.
- [x] Initially support native CAD and valid single-solid STEP operands; reject meshes explicitly.
- [x] Distinguish separation, contact and positive-volume overlap; distance zero alone is insufficient.
- [x] Run analysis in an isolated worker with a timeout; preserve the editor's build worker/cache.
- [x] Add typed preview pair requirements and bind their results to the cached preview/revision.
- [x] Block apply for failed/unknown attached pair requirements; preserve retry and undo behavior.
- [x] Cover separated/touching/intersecting/contained shapes, placements, STEP, unsupported meshes,
      invalid solids, limits, failed queries/timeouts, read-only preview, stale state and idempotency.
- [x] Update capabilities, self-hosted MCP docs and license/provenance notes.

## 2. Fit and manufacturing guidance — skill/reference improvement — complete

Source ideas: SOMA design-workflow/tolerances skills; text-to-cad DfAM and positioning references.
Write our own concise guidance; numeric examples are fixtures, not universal tolerances.

- [x] Add a directly linked fit-and-print-checks reference and update the skill version.
- [x] Establish functional datums, named clearances, per-side versus total gaps and intentional contact.
- [x] Select process/material/printer assumptions and propose fit coupons when calibration is missing.
- [x] Explain pair-query scope, unknown results and why CAD clearance does not prove printed fit.
- [x] Keep installation and print poses separate; do not guess missing interface measurements.
- [x] Add behavior cases for wrong mating side, zero-distance ambiguity, unknown measurements,
      unrelated-part preservation and unsupported mesh fit checks.
- [x] Validate reference reachability, grounding, packaging and relevant regressions.

## 3. Design/reference/hardware roles — implement the idea independently — complete

Source idea: SOMA `python/soma/registry.py` and export selection in `cli.py` (GPL code).

- [x] Define native role metadata and typed `setRole` operations; absent roles remain design.
- [x] Select printable design bodies or an explicit design/hardware assembly in STL/3MF/STEP;
      both exclude references. Validate explicit subsets and return selection evidence.
- [x] Keep reference phones/boards and purchased screws visible without accidentally printing them.
- [x] Preserve roles through native saves, template revisions, preview/apply and undo.
- [x] Preserve conservative roles through groups, booleans, copies, mirrors and splits;
      native ungroup restores child classifications. Generated fasteners remain design by default.
- [x] Reject export results if the document changes while an asynchronous export is pending.
- [x] Acceptance: reference geometry stays visible/saved but is excluded from a printable export.
- [x] Add contract and browser coverage, shared native-menu filtering, MCP docs and skill v1.5.0
      reference guidance. SOMA inspired the workflow; no GPL implementation code was copied.

## 4. Revision-bound visual feedback — adapt MIT code selectively

Source: text-to-cad `packages/core/src/prompt/` and host capture; SOMA markup is inspiration only.

- [ ] Create a read-only packet with editor/document/revision, body/face references, fingerprints,
      world point, camera, image and user note as appropriate.
- [ ] Require current references; reject stale selections after rebuilds.
- [ ] Keep managed import IDs and explicit user copy/attach actions.
- [ ] Acceptance: a mounting-face correction identifies the selected face and fails after it changes.

## 5. Functional datums and measured mating — implement the idea independently

Source ideas: text-to-cad positioning/native-joint examples; our `src/simulate.js` joints.

- [ ] Begin with rigid placement using explicit mating frames, signed gap and roll.
- [ ] Resolve selected faces/axes at the current revision; reject ambiguous or reversed frames.
- [ ] Preserve native transforms/joint editability; defer a general assembly constraint solver.
- [ ] Acceptance: two mounting faces align with the requested orientation and measured gap.

## 6. Read-only print-orientation advice — reuse our existing implementation — complete

Source: our `src/printsim.js`; compare SOMA/text-to-cad orientation workflows.

- [x] Reimplement the candidate search on the inspected mesh in `mcp/shared/geometry.js`
      (`rankPrintOrientations`), outside UI and simulation state; `src/printsim.js` is unchanged.
      Candidates: six axis directions plus the six largest flat-face normal groups.
- [x] Return per-candidate rotation matrix, overhang and base overhang area, bed contact,
      height and slenderness, ranked in that order, with limitations. Exposed as the
      `printOrientations` option of `jumpstart_inspect_geometry`; counted in its pass budget.
- [x] Acceptance: advice is read-only; it inspects tessellation and never applies a pose.
      Unit tests cover the ranking, rotations onto the bed and open-mesh rejection.

## 7. Hardware interfaces — implement the idea independently

Source ideas: SOMA fasteners/clearance holes/nut traps/heat-set inserts (GPL implementation).
Its bd_warehouse dimension tables have separate Apache-2.0 provenance and known suspect entries.

- [x] Partial, skill only: `fit-and-print-checks.md` (skill v1.12.0) has an M2–M8 table of
      ISO 273 clearance holes, ISO 4032 nuts with printed pocket radius and depth, and
      vendor heat-set insert holes, as starting values for a fit coupon.
- [ ] Add native reusable washers, nut pockets, insert pockets and seating/counterbore geometry.
- [ ] Validate vendor dimensions, hole depth, floor/wall requirements and inconsistent table entries.
- [ ] Keep hardware placement referenced to functional seats rather than guessed origins.
- [ ] Acceptance: a specified insert pocket preserves its floor/wall and rejects invalid dimensions.

## 8. Sampled wall-thickness diagnostics — adapt MIT algorithms

Source: text-to-cad `skills/dfam-check/scripts/dfam_tool.py`; SOMA heat maps are inspiration only.

- [ ] Measure each connected body against itself, with bounded and repeatable sampling.
- [ ] Report sample counts, coverage/misses, locations and thickness statistics.
- [ ] Link suspect regions to read-only inspection images/overlays.
- [ ] Keep sampling explicitly distinct from a certified global minimum thickness.
- [ ] Acceptance: a known thin rib is located; neighboring parts do not turn gaps into walls;
      incomplete measurements are never reported as a complete pass.

## 9. Printability heuristics and fix notes — implement the idea independently — complete

Source ideas: HackerSCAD `source/hackerscad/geom/printability.d` (GPL-3.0, reviewed
2026-10-26) and print3d `src/print3d/printability.py`, `skill/SKILL.md` (MIT,
reviewed 2026-10-26). Both inspired the checks; no code was copied.

- [x] Add a `printability` geometry check usable in `jumpstart_inspect_geometry`
      and preview requirements; failed or unknown results block apply.
- [x] Measure downward overhang area for a +Z build, excluding the bed and
      reporting faces within `baseZone` of it separately as base overhang.
- [x] Probe thin walls along inward normals through a bounding-volume hierarchy
      with a ray-test budget; report thinnest samples and bounds.
- [x] Return `notes` with code, severity and fix; only declared limits fail.
      Advisory notes cover slender parts, small bed contact and thin parts.
- [x] Reject open or inconsistently wound meshes and incomplete checks as unknown.
- [x] Skill: default Bambu Lab X2D profile and slicer handoff, dimension
      provenance with unknowns, and image review even when checks pass.
- [x] Candidate orientations are covered by item 6; this check reports the current pose.
- [ ] Item 8 remains open for neighbor-aware sampling, coverage statistics and overlays.

## Agent tooling — 2026-10-26

Follow-up from an over-engineering audit and agent-task benchmark; not a SOMA/text-to-cad item.

- [x] `tools/list` publishes compact schemas (shared `$defs.expr`, requirement stubs on
      non-model previews); `tools/call` and `jumpstart_get_capabilities` keep full schemas.
- [x] Agent benchmark: 24 tasks, including 13 printed parts graded by hidden measurement
      probes and native-feature checks; each grader is calibrated against a scripted
      reference plan in the browser suite.
- [x] `make claude-install` and `make cursor-install` register the MCP server and copy the
      skill, refusing to overwrite custom entries or unmanaged skills.
- [x] Real-agent run, six printed-part tasks (nut trap, heat-set bosses, D-shaft knob,
      friction-lid box, snap hook, phone stand), one Cursor subagent each through the
      recorder against a local broker: geometry probes passed 6/6; 0/6 passed overall,
      all on process checks (no post-apply mesh check, no section image; one missing
      `reopened` checkpoint was a briefing error). Agents also hit the `operationTypes`
      vocabulary and the skill's `expectedRevision` advice for apply.
- [x] Follow-up: `jumpstart_apply_model` returns per-body `meshValidation`, which the
      recorder accepts at the candidate revision; previews add a default X mid-plane
      section image; compact capabilities return `planVocabulary`; capability schemas
      share `$defs.expr` and are minified (`jumpstart_preview_model` schema 359 → 65 k
      characters). Skill v1.13.0 corrects the apply/`expectedRevision` advice.
- [x] Rerun of the same six tasks after the follow-up (same brief plus the `reopened`
      checkpoint step): 6/6 passed; 62 calls with 1 error, against 70 calls with 8 errors
      and 0/6 before. Heat-set bosses now use the native `hole` modifier.
- [x] Friction fixes from the rerun: `regularPolygon` profile (across flats or
      circumradius) and `roundedRect` radius 0; `$expr` functions (trig in degrees,
      `sqrt`, `min`, `max`, rounding); schema descriptions for plan build order, body
      references, primitive and knurl anchors, extrude direction, hole `n`/`through`
      defaults, edge selectors and Gridfinity-only `pocket`; knurl `boreDepth` (blind,
      native joined fill) and D-bore `boreFlat`; per-body STL `meshValidation` with
      `combinedValid`; `get_capabilities` `schemaPaths` fragments (5.5–9 k characters
      against 27–65 k); preview `includeSelectors`/`includeFeatureTree` (97.6 k → 3.4 k
      characters without images). Checked live: blind D bore adds the expected 113.7 mm³,
      touching boxes export with both bodies valid.
- [x] `tools/list` publishes the eight domain generators in `plan.operations` as type,
      required names and a summary, with full fields through `schemaPaths`; argument
      errors name the exact path. 107.1 k → 85.7 k characters; validation unchanged.
- [x] Skill v1.15.0 splits references by task: knobs, gears and Lathe parts move to
      `knobs-gears-and-turned-parts.md` with a checked D-shaft knob example; the phone
      cradle recipe joins `mounts-and-assemblies.md`; printer profile, print pose and
      hardware holes move to `print-and-hardware.md`. A knob task now loads 2.5 k
      instead of 9.1 k characters of reference.
- [ ] Not yet addressed: ring (hollow) rectangle profile, fillet edge selection by
      predicate inside a plan, and a third benchmark round to measure these changes.

## 10. Photo measurement and likeness check — implement the idea independently — planned

Source idea: print3d `src/print3d/photo.py`, `spec.py`, `likeness.py` and
`skill/references/from-photo.md`, `from-listing.md` (MIT, reviewed 2026-10-26).

- [ ] Scale a photo from a reference of known size (card, coin, ruler, A4) or a
      quoted listing dimension; never from the object itself.
- [ ] Rectify an angled flat face from four corners of known size.
- [ ] Record each dimension as measured, given, listed or assumed, with pixels,
      reference and tolerance; list unknowns.
- [ ] Project the model's silhouette along each photographed view, overlay it on
      the photo, and fail when overlap, size, rotation or mirroring disagree.
- [ ] Keep photos as untrusted managed imports; no remote fetch from the MCP.
- [ ] Acceptance: a part photographed beside a ruler is measured within the
      stated tolerance and a mirrored model fails the likeness check.

## Deliberately deferred

- Python/script execution architecture, replacement desktop/viewer stacks.
- Robotics formats, fabrication-service integrations and a second FEM backend.
- Removed text-to-cad interference module and deprecated AssemblyHelper.
- Automatic mesh feature-tree reconstruction, exact full-model revision differences,
  continuous-motion collision certification and physical-fit certification.

## Verification record

- [x] Items 1–2 baseline: `npm test`: 135 unit/contract tests and 53 browser tests passed.
- [x] Items 1–3 final: `npm test` rebuilt the app and passed 139 unit/contract
      tests and 56 browser tests (browser suite: 4.6 minutes). No failed/skipped tests.
- [x] Final focused recheck after the placement-matrix guard:
      `node --test mcp/tests/pairs.test.mjs mcp/tests/discovery-requirements.test.mjs mcp/tests/mcp-server.test.mjs`
      — 12 passed; native-pair and MCP-pair Playwright files — 6 passed.
- [x] Shipped-WASM evidence: separation, contact, material overlap, containment,
      rotated placement, an empty cavity, unsupported nonuniform placement,
      disconnected groups and managed STEP input. Native/STEP operands remained editable.
- [x] Recovery evidence: controlled timeout and failed native-query tests; user edits during
      pending live inspection and preview rejected stale results and retained the user's work.
- [x] Skill reference reachability, exact grounding and plugin-bundle checks passed.
- [x] Item 3 focused checks: 16 role/Lathe/discovery unit tests passed; two browser
      scenarios passed before the complete suite. The complete suite also covers
      pending-export revision rejection. Native export-menu rendering was captured
      and inspected; a selected reference left only the design body eligible.
- [x] Final skill wording recheck: `node --test mcp/tests/discovery-requirements.test.mjs`
      passed 7 tests, including direct reference reachability and exact grounding.
- [x] Emoji gate for the three new role implementation/test files: scanned 3 files,
      reported no emoji.
- [x] Built worker retains the adapted code's copyright and MIT grant; complete license retained.
- [x] Final diff review and `git diff --check` passed. No install or push performed during implementation.
- [ ] Runtime agent reasoning/routing evals: not run. The new behavior cases are specifications,
      separate from the deterministic implementation and browser tests above.

Limits: one valid native/STEP solid per operand, rigid/uniform-scale placement,
8 pairs, 2,000 faces per operand, 20 seconds including analysis-worker startup.
Mesh pairs, automatic mating, physical fit and continuous-motion certification remain unverified/unsupported.
