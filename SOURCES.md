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

## Update process

For an editor update, fetch the author source and compare its `app/src/` files
with this repo's `src/`. Review the changes, port the selected files, then
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
