# Source references

This product has its own repository and release history. The references below
are reviewed as source material; their branches are not merged automatically.

## Editor source

- Repository: <https://github.com/classyapps2026/jumpstart3d>
- Snapshot used for the initial standalone baseline:
  `228464f51379eeb8e1d3a0baccab5db7e5dbb78b`
- License: MIT. Keep the author's notice in `LICENSE` and `NOTICE.md`.
- The source tree provides `app/src/`; this product builds from its adapted
  `src/` copy and records app-specific integration changes in this repository.
- The bundled OCCT loader defaults its virtual-filesystem `HOME` to `/` so a
  developer machine's home path is not embedded in shipped assets.

## Feature reference

- Repository: <https://github.com/MaxSikorski/jumpstart-3d>
- Community snapshot used for the initial feature review:
  `bb6c4cb02be2cfbf3847fe7e7001413ca52706ef`
- License: MIT, with third-party libraries retaining their own licenses.
- We adapt selected behaviors and keep the relevant notices. We do not inherit
  its release, support, or contribution process.
- From build 24 (`v2.5.1-community.24`, commit `4e49a01`) that project is
  AGPL-3.0-only. Builds up to 23 keep their MIT terms. Do not port code that
  first appears in build 24 or later; use it as feature reference only.
- Parts tools: `src/fasteners.js`, `holepattern.js`, `gears.js`, `nameplate.js`,
  `knurl.js` and `spring.js` come from build 23 (`v2.5-community.23`,
  `21417c3fea8193b3751945a28467690b52b60a39`, MIT), with their `jumpstart-3d:`
  glue in `advanced.js` and `icons.js`. Local changes: the size and font choices
  use `tool-choice`, the tools other than Hole pattern sit in the beginner
  ribbon's Parts section, and
  the `JS3D` bridge entry points are not included.

## Update process

The author now ships versions as full-source zip archives. `upstream/editor/`
holds the untouched archive that `src/` and `tools/` are based on and is the
merge base for the next one. Follow the `update-editor-source` agent skill
(`.agents/skills/update-editor-source/`) for the report, three-way merge and
snapshot steps.

For an editor update, compare the author's `app/src/` files
with this repo's `src/`. Port core changes: kernel, sketcher, regions, document
store, workers and geometry fixes. Interface changes are reference material;
the product-owned interface is maintained here.
Review the changes, port the selected files, then
reapply and check the integration points listed in `mcp/README.md`. Keep
`third_party/` pinned and update its notices when dependencies change.

For a community feature, inspect the relevant source and license, then adapt
only the behavior that fits this product. Keep preview/apply, revision,
idempotency, undo, and loopback constraints intact. Build and run the relevant
checks before accepting the change.

## Native pair inspection

- Repository: <https://github.com/earthtojake/text-to-cad>
- Reviewed snapshot: `2f793659fb7bab537e2f00836e06448fc4087cb2`.
- Source: `packages/cadgen/src/cadgen/geometry.py` (`closest_points`, `overlap_volume`).
- License: MIT, Copyright (c) 2026 Thompson Labs LLC. Full notice:
  `third_party/text-to-cad/LICENSE`; also preserved in `src/pairGeometry.js` and the built worker.
- Adaptation: native solid validation, independent distance/intersection queries,
  explicit failure states and private query operands. Runs in our isolated OCCT
  Web Worker, without the Python runtime. Initial support is one native/STEP solid
  per operand; it does not reconstruct analytic geometry from meshes.
- SOMA was reviewed for workflow inspiration only; its GPL application/library
  code was not copied. Process and fit instructions are authored for our MCP.
- SOMA's `python/soma/registry.py` and export selection in `cli.py` also informed
  the design/reference/hardware workflow. Native role metadata, typed `setRole`
  plans and printable/assembly filtering in `src/bodyRoles.js` were implemented
  independently. No SOMA code or runtime dependency is included.

## Gridfinity interface profiles

- Repository: <https://github.com/kennetek/gridfinity-rebuilt-openscad>
- Reviewed snapshot: `910e22d8607fd7f5f51ad5e5cbc5287a76810bfd`.
- Source: `src/core/standard.scad` and `src/core/gridfinity-baseplate.scad`.
- License: MIT. Source and attribution details are retained in
  `third_party/gridfinity-rebuilt-openscad/SOURCE.md`; complete license notices
  are retained in `third_party/gridfinity-rebuilt-openscad/LICENSE`.
- Adaptation: interface dimensions for editable native feet, sockets and
  stacking lips. The local generator uses JumpStart native geometry; it does not
  require an OpenSCAD process, external API or the source generator's UI.
- Custom pocket guidance is authored for our typed measured-profile workflow.
  Imported models and manufacturer drawings remain evidence for the specific
  item and variant, not a source of universal printer clearances or guaranteed fit.
- Magnet-pocket dimensions and 26 mm center spacing use the same pinned
  `standard.scad`. The raised perforated carrier is independently implemented;
  retaining floor/wall geometry and matching bin placement are measured in tests.
- User-supplied design reference: <https://www.printables.com/model/250550-gridfinity-magnet-light-baseplate/comments>.
  The comments/model page could not be fetched during this review. No model files,
  comments or implementation from Printables were copied or treated as verified specifications.

## Traced tool outlines

- Repository: <https://github.com/tracefinity/tracefinity> (MIT), reviewed 2026-10-27.
- Read `backend/app/api/routes.py` (`download_tool_svg`) and
  `backend/app/models/schemas.py` (`Tool`, `FingerHole`) for the exported file
  formats only. `mcp/shared/traced-outline.js` reads those formats and was
  written independently; no Tracefinity code, models or runtime are included.
  Photo tracing stays in Tracefinity.

## Drawer planning interaction reference

- Repository: <https://github.com/andymai/gridfinity-layout-tool>
- Reviewed snapshot: `6753e8b28706d008c86755dacb3fe8643b2ac358`.
- Read implementation: `src/features/grid-editor/hooks/useInteraction.ts` and its
  draw tests; `src/features/bin-inspector/hooks/useBinInspector.ts`;
  `src/core/store/layout/drawerActions.ts`;
  `src/features/grid-editor/components/Grid/DrawerMargin/useDrawerMarginInsets.ts`.
- Observed the live planner at `gridfinitylayouttool.com`: a spatial grid,
  draw-to-create bin footprints, selected-bin settings, and measured drawer margins.
- License: AGPL-3.0. This is interaction inspiration only. Our drawer state,
  validation, rendering, keyboard controls and native-plan compilation were authored
  independently. No reference code, assets or runtime dependencies are included.

## Editor 2.7.4 archive update

- Source: user-supplied `JumpStart-3D-v2.7.4-full-source`, `app/src/`.
  This is an archive version, not an asserted author Git tag or commit.
- The 73-file source manifest is retained in
  `test/fixtures/upstream-v274.json`. Its canonical JSON manifest SHA-256 is
  `8613a90f098b892b0abb6904fdd30cc7bad0f91bda5aeb8cc7473bb8bc224f78`.
- File-level adaptation uses the initial author baseline above to distinguish
  source changes from local fixes. No upstream repository history is merged.
- Added Architect, CAM Studio, CosForge, Voxel Studio, face patterns, tutorials,
  sketch styles and beginner shell/fillet controls. Retained local geometry,
  roles, parameter, persistence, export and MCP behavior.
- CAM's worker is compiled from `src/camworker.js` during our build. The archive's
  prebuilt worker text is not shipped. Third-party runtime implementations and
  licenses remain pinned; the archive's OCCT binary matches our compressed one.
- The author-hosted update checker is excluded. Imported choice controls use
  the shared keyboard-accessible `tool-choice`; tool chrome uses shared tokens,
  host theme colours and mobile-first workspace structure. Material/mesh colours
  remain model data rather than interface branding.
- MCP mutations require leaving the new manual workspaces. These manual tools
  do not extend the typed MCP modeling API automatically.

## Editor 2.7.7 archive update

- Source: user-supplied `JumpStart-3D-v2.7.7-full-source`, `app/src/`. This is an
  archive version, not an asserted author Git tag or commit. It includes the
  2.7.5 and 2.7.6 changes.
- The 75-file manifest is retained in `test/fixtures/upstream-v277.json`. Its
  canonical JSON manifest SHA-256 is
  `615b13ed1472618636ccca229b3f72a41ea05665fe4249da3a604222641bc4a7`.
  `upstream/editor/` holds this archive as the base for the next update.
- Three-way merge from the 2.7.4 base. Added the distance-field Shell method
  (`sdfshell.js`), drain holes and Shell method choice, Shell on lofts, the
  Chip Carving workspace (`carve.js`) and the CAM Roland MDX-50 profiles.
- Chip Carve sits in the beginner ribbon's Workshops section. Its choice
  controls use the shared `tool-choice`, chip shapes have text labels, and MCP
  mutations require closing it, as for CAM, Voxel and CosForge.
- Still excluded: the author-hosted update checker and the prebuilt
  `camworker.bundle.txt`. Notices and `third_party/` are unchanged.


## Flush joins on open Gridfinity edges

`closeGaps` is a local optional extension to the native bin generator. It squares
open-end corners and extends the body by 0.25 mm per open edge to the grid
boundary, straight down to the foot tops at Z=4.75 mm without a rounded ledge.
Feet below that plane, sockets and magnet positions retain
the pinned interface profiles. Closed wall and stacking-rim profiles continue
to the joining plane. This is not a claim of a new standard profile or verified
physical fit; both adjoining parts must enable the option and be fit-tested.
