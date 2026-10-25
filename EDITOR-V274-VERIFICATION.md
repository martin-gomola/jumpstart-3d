# Editor 2.7.4 update verification

Verified on 25 October 2026 against the supplied source archive. Source identity
and adaptations are recorded in [SOURCES.md](SOURCES.md). The architectural
recommendation and staged delivery are in
[REACT-WORKSPACE-PLAN.md](REACT-WORKSPACE-PLAN.md).

## Delivery

The editor includes Architect, CAM Studio, CosForge, Voxel Studio, face patterns,
expanded tutorials, sketch styles and beginner hollow/fillet controls. It retains
the local native geometry, parameters, roles, persistence, export selection and
MCP transaction behavior. Existing Gridfinity work remains intact.

Imported tool interfaces use shared theme tokens, keyboard-accessible choices,
mobile canvas-first layouts and modal focus/inert management. Tool-owned drafts
block MCP mutations while document reads remain available. Printer-fit copy
identifies geometric build-area checks. The author-hosted update checker is
excluded; CAM's worker is compiled from source. Dependencies and license notices
remain pinned. React is planned, not installed or migrated in this delivery.

## Commands and actual results

| Command | Output/result |
| --- | --- |
| `npm run build` | Exit 0. `build/site/app.js: 5.49 MB build/site/worker.js: 0.49 MB build/site/occt-gz.wasm: 6.87 MB` |
| `npm test` | `tests 171`, `pass 171`, `fail 0`, `skipped 0`; browser: `97 passed (10.2m)` |
| Focused browser command below, after the last presentation and handoff-message adjustments | `4 passed (26.4s)` |
| `node mcp/tests/run-ai-panel-gates.mjs` | `38/38 UI gate runs passed.` |
| `node mcp/tests/run-tool-ui-gates.mjs` | `15/15 tool-control gate runs passed.` |
| `git diff --check` | Exit 0, no output |

Focused command:

```sh
npx playwright test --config=mcp/playwright.config.mjs \
  mcp/tests/editor-v274.browser.mjs mcp/tests/templates.browser.mjs \
  -g 'v2.7.4|shared tool choice|updated native kernel|new manual workspaces'
```

The focused checks opened the new workspaces, generated CAM G-code through a
Blob worker without worker warnings or a serial connection, created a CosForge
part, changed its printer by keyboard, checked narrow layouts, exercised choice
commit/typeahead/disabled behavior, built native hollow and face-pattern geometry,
and rejected MCP mutations in all four new manual workspaces without rejecting
reads. The tested CAM, Voxel and CosForge states passed axe WCAG checks.

The full regression suite also exercised Gridfinity bounds, open sides,
magnetic carriers, larger bins, roles, imports, native pairs, parameters,
previews, stale rejection, idempotency, save/reopen, undo and exports.

## UI evidence and scope

Both gate runners set `DS_REQUIRE_BROWSER=1` and reject `SKIPPED` output. The AI
runner checks six production panel harnesses. Its receipts are in
`exports/ai-panel/gates/` and `exports/ai-panel/gate-results.json`.

The tool runner checks the shared production choice control and the imported
tool source files: token validation, derived theme contrast, hardcodes, emoji,
native selects, keyboard, target sizes, responsive/base mobile layout, overflow,
reduced motion, intent and strict slop checks. Its receipts are in
`exports/editor-v274/gates/`. The responsive gate printed no horizontal overflow
at 280/320/414px with root font scaled to 1.25.

The stock `verify_states.mjs` selector does not recognize a combobox role and
printed `Checked 0 element-state(s)` for this control. That output was not
accepted as state coverage. `mcp/tests/tool-choice-states.mjs` instead rendered
and measured default, hover, focus, active, selected, error, loading and disabled
states across light, dark and contrast themes. Keyboard commit and popup behavior
were exercised in the browser integration test.

Desktop and phone screenshots in `exports/editor-v274/` were visually inspected.
Verification found and fixed container overflow, an overflowing Voxel palette,
CAM label/contrast issues, a small disclosure target, and CosForge controls
covering the helmet on phones. These receipts establish the reported checks;
they are not a score for visual taste or exhaustive usability research.

## Remaining limits

Browser verification used Chromium/Chrome. Safari and Firefox were not tested.
No CNC machine was connected and no physical print was produced. CAM simulation,
geometric build-area checks and the tested native geometry do not certify a
physical print or machine operation. The suite is not exhaustive validation of
every author-supplied CAM, weather/flood, sculpting or joint option.

The React migration remains a separate staged implementation. New manual tools
do not automatically become typed MCP generators. Pre-existing working changes
and the pre-existing checklist deletion were preserved; no commit was created.
