# 1. Keep upstream editor files whole

Large files in `src/` such as `advanced.js` and `beginner.js` track `classyapps2026/jumpstart3d` and are updated with file-level patches (see `SOURCES.md`).
We do not split or restructure them, even where an architecture review would suggest it, because that would turn each upstream update into a manual merge.
New product behaviour goes in separate modules (`src/*.jsx`, `mcp/`) that call into these files through narrow seams.
