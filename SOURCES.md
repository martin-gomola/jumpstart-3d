# Source references

Where outside code and ideas came from, and what may be copied. None of these
repositories is merged; changes are adapted file by file.

## Editor core

- Author: [classyapps2026/jumpstart3d](https://github.com/classyapps2026/jumpstart3d), MIT.
  Keep the author's notice in `LICENSE` and `NOTICE.md`.
- Releases now arrive as zip archives. `upstream/editor/` is the untouched
  archive `src/` and `tools/` are based on (currently 2.7.7); file manifests are
  in `test/fixtures/upstream-v*.json`. Update with the
  `.agents/skills/update-editor-source` skill.
- Local changes to keep through merges: the author update checker and the
  prebuilt `camworker.bundle.txt` stay out; `parseSVG` (`importers.js`)
  sanitizes imported SVGs; `esc` (`tutorial_anims.js`) escapes quotes; the
  OCCT loader's virtual `HOME` is `/`.

## Other sources

| Source | License | What we use |
| --- | --- | --- |
| [MaxSikorski/jumpstart-3d](https://github.com/MaxSikorski/jumpstart-3d) | MIT up to build 23; AGPL-3.0 from build 24 (`4e49a01`) | Parts tools (`fasteners`, `holepattern`, `gears`, `nameplate`, `knurl`, `spring`) from build 23 (`21417c3`). Never copy code that first appears in build 24 or later. |
| [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad) (`2f79365`) | MIT | Pair distance and overlap queries in `src/pairGeometry.js`; notice in `third_party/text-to-cad/LICENSE`. |
| [kennetek/gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad) (`910e22d`) | MIT | Gridfinity interface and magnet dimensions; notices in `third_party/gridfinity-rebuilt-openscad/`. |
Never copy code from GPL or AGPL projects; they may inform ideas only.
