# Source references

Where outside code and ideas came from, and what may be copied. None of these
repositories is merged; changes are adapted file by file.

## Editor core

- Author: [classyapps2026/jumpstart3d](https://github.com/classyapps2026/jumpstart3d), MIT.
  Keep the author's notice in `LICENSE` and `NOTICE.md`.
- Releases now arrive as zip archives. `upstream/editor/` is the untouched
  archive `src/` and `tools/` are based on (currently 2.8.1.3); file manifests are
  in `test/fixtures/upstream-v*.json`. Update with the
  `.agents/skills/update-editor-source` skill.
- Local changes to keep through merges: the author update checker and the
  prebuilt `camworker.bundle.txt` stay out; `parseSVG` (`importers.js`)
  sanitizes imported SVGs; `esc` (`tutorial_anims.js`) escapes quotes; the
  OCCT loader's virtual `HOME` is `/`.

## Editor 2.8.1.3 archive update

- Archive: `sources/JumpStart-3D-v2.8.1.3-full-source` (author full-source archive).
- Manifest: [`test/fixtures/upstream-v2813.json`](test/fixtures/upstream-v2813.json), SHA-256 `612edfbd74419b213767270a4b02f97b099748367ee156dc6a4fcc8105f12861`.
- Adopted the 2.8.1.3 editor changes, including print-plate arrangement and G-code timing, Floor Planner tutorials and saving, the expanded font set, Quick Hinge, and Architect changes. The Floor Planner build inputs and bundled three.js r128 source are included with their notices.
- Kept the local React Beginner ribbon, Studio About/version label, MCP worker operations, and local geometry and persistence integrations. Floor Planner mutations are blocked from MCP while its embedded view or separate tab is open.
- The archive's `app/src/fasteners.js` collided with the existing local parts tool; the archive implementation is adapted as `src/fastener-parts.js`. The author's update checker and prebuilt CAM worker remain excluded; the worker is built from `src/camworker.js`.

## Other sources

| Source | License | What we use |
| --- | --- | --- |
| [MaxSikorski/jumpstart-3d](https://github.com/MaxSikorski/jumpstart-3d) | MIT up to build 23; AGPL-3.0 from build 24 (`4e49a01`) | Parts tools (`fasteners`, `holepattern`, `gears`, `nameplate`, `knurl`, `spring`) from build 23 (`21417c3`). Move / Rotate access (`src/rotationui.js`, the Advanced Modify button, 15° ring snap with a Free switch, touch ring picking and Beginner turn boxes) and its test `mcp/tests/rotation-access.browser.mjs` from `06e3dbd`, an ancestor of build 24. Never copy code that first appears in build 24 or later. |
| [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad) (`2f79365`) | MIT | Pair distance and overlap queries in `src/pairGeometry.js`; notice in `third_party/text-to-cad/LICENSE`. Workflow text adapted in the `step-parts` and `bambu-handoff` skills, and the process-limits table in the `3d-model` print reference. The drawing sheet's off-geometry and overlap warnings follow its engineering-drawing skill; no code was copied. |
| [enesozturk/dimensional-drawing](https://github.com/enesozturk/dimensional-drawing) (`5c45743`) | MIT | Ideas for the `3d-model` dimensioned-drawings reference: `TBD` and `CONFLICT` values, variable codes with closing formulas, general notes and phantom and hatch conventions. Rewritten in our words; no text or code copied. |
| [kennetek/gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad) (`910e22d`) | MIT | Gridfinity interface and magnet dimensions; notices in `third_party/gridfinity-rebuilt-openscad/`. |
Never copy code from GPL or AGPL projects; they may inform ideas only.
