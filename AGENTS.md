# Standalone JumpStart 3D

This repository is an independent self-hosted product. The author source and
the Max Sikorski community project are reference sources, not Git remotes to
merge automatically. See [SOURCES.md](SOURCES.md) for pinned snapshots and
update policy.

## Product boundaries

- Keep the CAD editor in `src/` and MCP integration in `mcp/` within this
  repository. `mcp/browser/` adapts the editor document and scene APIs;
  `mcp/shared/` owns input and geometry contracts; `mcp/server/` owns local
  transport and tool validation.
- Use typed plans and native editor feature nodes. Keep preview, inspection,
  explicit apply, revision checks, idempotency, and undo in the MCP workflow.
- Bind the MCP server to loopback for local use. Do not add arbitrary script
  execution to MCP tools.
- Use signed-in MCP clients for model access. Do not add API-key collection to
  the setup panel.
- Preserve the author's and third-party license notices. See `LICENSE`,
  `NOTICE.md`, `THIRD-PARTY-NOTICES.md`, and `LICENSES/`.

## Source updates

- Treat `classyapps2026/jumpstart3d` as the source reference for editor core
  code. Its interface changes are reference only; see
  `documentation/REACT-WORKSPACE-PLAN.md` (local, gitignored).
- Treat `MaxSikorski/jumpstart-3d` as a feature and implementation reference.
- Review source changes as file-level patches. Do not merge either repository
  into this repository as a routine update.
- Author releases arrive as zip archives. Update the editor core with the
  `.agents/skills/update-editor-source` skill; `upstream/editor/` is its merge
  base and is only replaced by the skill's `snapshot` step.
- Developer skills for working on this repository live in `.agents/skills/`.
  The `mcp/plugin/` skills ship to users and cover 3D modeling with the app.
- Rebuild generated output with `npm run build`. Do not edit `docs/app.js` by
  hand.
- Keep product documentation focused on standalone installation and operation.

## Verification

Build with `npm run build`. Run `npm test` when a change affects code contracts,
geometry, editor behavior, browser integration, or MCP transactions. Report the
commands actually run and any skipped checks.

JumpStart is a desktop browser app. Browser tests run in the configured
Chromium project only. Do not install or run WebKit or Firefox, and do not add
Playwright device profiles such as iPhone or iPad emulation; every page boots
the WebGL kernel in software, and emulated high-density screens multiply that
cost. Cover narrow layouts with `page.setViewportSize` inside an existing
Chromium test. Native iPhone behavior, such as AR Quick Look, needs a physical
device and is reported as unverified rather than emulated.

New and reworked product UI uses React (`*.jsx`, pinned builds in
`third_party/react*`). Keep draft logic in plain modules without DOM access.
React owns its mount subtree; do not mutate its children from DOM code. Keep
the ids, roles and labels that browser tests use.

UI changes use the shared tokens in `mcp/tokens/ai-status.json` and the app's
CSS variables. Do not introduce emoji, native `<select>` elements, or
one-sided colored borders in new UI.
