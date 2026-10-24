# Gridfinity implementation checklist

Created: 2026-10-24. Target: editable custom inserts in local JumpStart.
This checklist supplements `mcp/ADOPTION-CHECKLIST.md`; it does not replace that backlog.

## Native geometry and contracts

- [x] Pin and review the Gridfinity interface source and preserve its MIT notices.
- [x] Add strict typed `gridfinity` inputs for insert blanks, bins and baseplates.
- [x] Generate editable native feet/sockets, bodies, optional stacking lips and bin dividers.
- [x] Expose grid width/depth and actual millimetres; report nominal and lip-added heights separately.
- [x] Bound layout and parameter ranges with clear errors; preserve the requested geometry.
- [x] Preserve native recipes and independent pocket parameters through numerical revisions.

## Measured pockets

- [x] Add typed circle, rounded-rectangle, capsule and closed line/arc pocket profiles.
- [x] Use local XY placement, Z rotation, and depth measured downward from the insert top.
- [x] Require explicit per-side clearance, depth and minimum floor/wall requirements.
- [x] Construct clearance by shape/profile offset rather than uniform scaling.
- [x] Protect the Gridfinity base and reject unsupported, invalid or uncertain cuts.
- [x] Check pocket/wall and pocket/pocket margins; document conservative envelope limits.
- [x] Require explicit merge intent for intersecting pockets and finger-access recesses.
- [x] Retain imported items as references, with an explicit envelope/profile distinction.

## AI sidebar

- [x] Add accessible Connection and Templates tabs using existing tokens and theme variables.
- [x] Default to measured Drawer layout; keep Custom insert, Bin and Baseplate under Single part.
- [x] Configure blank, reference/dimensions and pockets before preview review and explicit Add.
- [x] Share generator, validation, preview cache and apply/undo path with the AI agent.
- [x] Invalidate previews on form or document changes; Cancel leaves the document unchanged.
- [x] Expand Templates on desktop: independently scroll settings beside a persistent preview.
      Retain the last image as visibly out of date after edits and disable Add until refresh.
- [x] Preserve entered values on errors and provide an actionable recovery path.
- [x] Support manual creation without a connected AI client; retain connection setup.
- [x] Verify keyboard operation, control states, responsive layouts and rendered interactions.

## Agent skill and sourcing

- [x] Add a directly linked Gridfinity reference and concise core routing; increment the skill version.
- [x] Identify exact product variants and prefer manufacturer drawings or attributable CAD.
- [x] Record source URLs, original units, variants and supplied/published/measured/estimated dimensions.
- [x] Keep client research and approved file acquisition outside the local modeling broker.
- [x] Use managed import ids; treat source content as untrusted design evidence.
- [x] Distinguish measured profiles, agreed envelopes and unknown object shapes.
- [x] Guide insertion/removal access, pose, clearance, source preservation and export selection.
- [x] Add trigger and behavior fixtures, retaining an honest not-run runtime-evaluation status.

## Acceptance and verification

- [x] Create a matching 2 by 3 baseplate and custom insert with rounded-rectangle/circle pockets and finger access.
- [x] Independently inspect interface dimensions, pocket pose/depth, supported margins and connectivity.
- [x] Check supported insert/baseplate interference at the intended placement; keep physical fit unverified.
- [x] Cover invalid profiles/offsets, excessive layouts, accidental overlap and material breaches.
- [x] Cover unsupported imports, failures, stale previews and user edits during pending work.
- [x] Verify no preview mutation, idempotent apply, undo, numerical revisions and save/reopen.
- [x] Verify equivalent sidebar/MCP geometry and reference exclusion from STL/3MF/STEP exports.
- [x] Run focused contracts/browser tests, full `npm test`, applicable UI gates and screenshot/click review.
- [x] Update MCP capabilities, self-hosted docs, source provenance and actual verification results.

## Deferred work

- [x] Optional magnet pockets with verified native material and matching placement.
- [ ] Screw pockets after base interfaces are verified.
- [ ] Exact imported-solid cutouts with validated surface clearance and insertion/undercut handling.
- [ ] Reliable complex-STL clearance with explicit geometry budgets and supported fit verification.
- [ ] Custom placement drag handles and automatic pocket layout.

No commit, plugin installation or container deployment is implied by implementation.
Runtime agent reasoning/routing evaluations are separate from deterministic contract and browser checks.

## Verification record

- [x] `npm test`: 151 unit/contract tests and 66 browser tests passed; build completed.
- [x] Focused Gridfinity/pocket contract checks: 43 tests passed.
- [x] Templates flow: three browser tests passed for tabs/keyboard, preview/cancel/apply/undo,
      and selected-reference envelope dimensions and preservation.
- [x] Browser checks: keyboard, target size, overflow, reduced motion, intent,
      contrast-pair delivery, and axe checks passed. Whole-editor narrow-layout exceptions are below.
- [x] Rendered sidebar screenshots captured at desktop and 390 px; the Templates panel was
      also measured at 320 px and its controls stayed within its panel.
- [ ] Whole-page mobile-first gate: fails on the existing editor shell. With media rules removed,
      it reports 1152 px overflow from existing toolbar controls. The 320 px sidebar panel itself
      fits. Restructuring the complete CAD toolbar was outside this Gridfinity implementation.
- [x] Gridfinity reference source and MIT provenance are recorded; no source runtime was added.
- [ ] Agent reasoning/routing evaluations: not run; YAML cases are specifications only.

### Desktop sidebar layout follow-up

- [x] Templates expands to a 64 rem desktop workspace with a 24 rem settings column.
      Settings and model review scroll independently; the Preview action stays accessible.
- [x] Editing values retains the last image with an Out of date label and disables Add.
      A successful refreshed preview restores Add; Cancel removes the proposal.
- [x] Five focused browser checks passed, including stable preview placement during settings edits.
      The final `npm test` run passed 151 unit/contract and 66 browser tests.
- [x] Captured and inspected the live desktop layout at 1400 by 880.
- [x] Token validator: 41 tokens valid. New CSS hardcode, emoji and native-select gates passed.
      App-theme contrast-pair checks passed. Built-shell gates passed: 122 element states,
      zero axe violations, keyboard, target size, intent, overflow, reduced motion and strict slop checks.
- [ ] Whole-editor responsive gate still flags existing toolbar overflow at 280 and 320 px.
      The whole-editor mobile-first gate still flags the existing base toolbar layout.
      This follow-up targets the user's desktop settings/preview workflow.
- [x] `git diff --check` passed. Implementation verified locally; deployment is a separate action.

### Drawer planning UX

- [x] Reviewed the live Gridfinity Layout Tool and pinned source files; implemented
      draw/select/fit ideas independently. AGPL source was not copied. See `SOURCES.md`.
- [x] Added inside width/depth/usable height in mm, automatic grid dimensions and spare space.
- [x] Added direct drawing, moving, resize handles, keyboard movement/resize, Add bin,
      Fill gaps, rotation, duplication, removal and independent draft undo/redo.
- [x] Collapse drawer setup after planning starts; show only selected-bin controls,
      plain mm height choices and compartment counts. Keep construction controls under Advanced.
- [x] Added typed `drawerLayout` compilation into existing native Gridfinity parts and tiled
      baseplates, with placement/height/overlap/resource checks before geometry generation.
- [x] Save/reopen native layout metadata and explicit replacement of owned parts. Reject
      native edits, locks, missing parts and external dependencies instead of discarding them.
- [x] Protect selected CAD objects behind the planner from draft arrow/undo shortcuts.
- [x] Added on-demand drawer skill guidance, source grounding and skill version 1.7.0.
- [x] `npm test`: 155 unit/contract tests and 69 browser tests passed. Final focused drawer
      checks also cover inspector keyboard focus, invalid-height recovery and compact setup.
- [x] Maximum tested preview: 144 cells / 18 native parts built in roughly 3.2 seconds
      on this host. This is measured runtime evidence, not a performance guarantee.
- [x] Live selected-bin panel: zero axe WCAG violations in light, dark and high-contrast
      themes; desktop bounds checked at 1280, 1440 and 1920 px. At 200% text, controls
      stayed within the workspace. Screenshots were captured and inspected.
- [x] 42 tokens valid; new CSS hardcode, emoji and native-select checks passed; app-theme
      contrast checks passed. Built-shell state, axe, desktop responsive, keyboard, target-size,
      intent, overflow, reduced-motion and strict slop checks passed.
- [ ] Existing whole-editor mobile-first gate still fails on the base toolbar at 320 px.
      This task follows the user's desktop-only workflow. Runtime agent reasoning evals remain unrun.

### Optional magnet pockets

- [x] Add optional native magnet pockets to bins, inserts and baseplates through typed plans.
      Defaults are 6.5 mm diameter by 2.4 mm deep for nominal 6 by 2 mm magnets,
      with four pockets per cell. Validate custom sizes and remaining material.
- [x] Keep plain geometry unchanged when magnets are off. Magnetic baseplates add a
      perforated carrier with a 0.8 mm floor; default total height is 8.2 mm.
      Raise bins to 3.45 mm and include this placement in drawer height checks.
- [x] Expose pockets in Single part, baseplate Advanced construction and selected-bin
      More options. Allow copying the selected magnet fit to all current bins.
- [x] Preserve preview without mutation, explicit apply, native editing, save/reopen,
      replacement and undo. Update capability schemas, docs and skill version 1.8.0.
- [x] Verify native pocket volume, floor/roof sections, connected geometry and zero
      overlap between seated parts. Cache keys ignore geometry-independent sequence metadata.
- [x] `npm test`: 160 unit/contract tests and 75 browser tests passed.
      A focused maximum preview of 144 cells, 18 parts and 1152 pockets took 6062 ms
      on this host; this measurement is not a performance guarantee.
- [x] Screenshot and inspect the live magnetic preview. Live controls reported zero
      axe WCAG violations in light, dark and high-contrast themes. Token, hardcode,
      emoji, native-select, contrast and desktop render checks passed.
- [ ] Existing whole-editor mobile-first toolbar failure remains unchanged.
      Physical printed fit, magnet retention and runtime agent reasoning evals remain unverified.
