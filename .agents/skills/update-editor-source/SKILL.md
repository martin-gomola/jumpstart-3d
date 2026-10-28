---
name: update-editor-source
description: Updates this repo's editor core (src/, tools/) from a new JumpStart 3D author archive (JumpStart-3D-vX.Y.Z-full-source.zip) with a three-way merge against the last adopted archive in upstream/editor/. Use when the user mentions a new JumpStart version, author zip, full-source archive, or updating the editor core from classyapps.
---

# Update the editor core from an author archive

The author ships versions as zip archives, not Git. Archives are in the shared
Google Drive folder <https://drive.google.com/drive/folders/1IbgwR0PddrV7Q6wchvndJ5eUvLd_e_HL>;
the user downloads them into `sources/` (gitignored).

`upstream/editor/` is the untouched copy of the archive `src/` is currently
based on (`app/src`, `app/tools`, license notices, a `third_party.json` digest).
It is the merge base. Never edit it by hand; only the `snapshot` command replaces it.

Script (run from the repo root):

```bash
S=.agents/skills/update-editor-source/scripts/editor-upstream.mjs
node $S status   sources/JumpStart-3D-vX.Y.Z-full-source.zip   # read-only report
node $S merge    sources/JumpStart-3D-vX.Y.Z-full-source.zip   # copy + 3-way merge into src/, tools/
node $S snapshot sources/JumpStart-3D-vX.Y.Z-full-source.zip   # make it the new base + manifest
```

A zip is extracted to `sources/<name>/` on first use. Unzip and file writes
need to run outside the sandbox.

## Workflow

```
- [ ] 1. Clean tree for src/, tools/, upstream/ (git status); base version = upstream/editor/app/src/version.js
- [ ] 2. status; read the archive README "New in vX.Y.Z" section
- [ ] 3. merge; resolve conflicts
- [ ] 4. Decide every review-* row
- [ ] 5. Re-apply local rules (below)
- [ ] 6. npm run build; node --test mcp/tests/*.test.mjs; affected browser tests
- [ ] 7. snapshot; add the SOURCES.md section
- [ ] 8. Full npm test; report; ask before committing
```

**1.** If `upstream/editor/` is missing or its version differs from `src/version.js`,
stop: snapshot the archive `src/` is based on first, and check that
`git diff test/fixtures/upstream-v<ver>.json` is empty (proves it is the exact archive).
If the archive skips versions (2.7.7 → 2.8.1), one merge from the base is fine.

**2. Actions in the report**

| Action | Meaning | merge does |
| --- | --- | --- |
| `copy` | upstream changed; ours is the untouched base | copies the new file |
| `merge` | both sides changed | `git merge-file`, may leave conflict markers |
| `done` / `none` | already equal, or upstream unchanged | nothing |
| `excluded` | listed in `excluded.json` with the reason | nothing |
| `review-new` | new upstream file, absent here | nothing: adopt or skip |
| `review-absent` | upstream changed a file we dropped | nothing: usually skip |
| `review-delete` / `review-removed` | upstream deleted a file we still have | nothing: delete unless we use it |
| `review-collision` | new upstream file name we already use differently | nothing: compare |
| `review-notice` | LICENSE, THIRD-PARTY-NOTICES.md or LICENSES changed | nothing: update our notices |
| `review-dependency` | an archive `third_party/<pkg>` changed | nothing: compare with our pinned `third_party/` |

**3. Resolving conflicts.** Markers are labelled `ours (repo)`, `upstream <old>`,
`upstream <new>`. Before snapshotting, these show each side:

```bash
git diff --no-index upstream/editor/app/src/F sources/<new>/app/src/F   # the author's change
git show HEAD:src/F > /tmp/F.ours
git diff --no-index upstream/editor/app/src/F /tmp/F.ours                # our local change
git log --oneline -- src/F                                               # why we changed it
```

Keep both intents. To abort: `git checkout -- src tools` and delete any adopted new files.

**4.** A new upstream module is adopted only if a merged file imports it, or it is
core (kernel, sketcher, regions, store, workers, geometry). Add a deliberate
skip to `excluded.json` with its reason so later reports stay quiet.

## Local rules to keep (step 5)

- Core changes are ported; interface changes are reference only. The product
  interface is ours (React, `src/*.jsx`, `mcp/`). Optional local notes:
  `documentation/REACT-WORKSPACE-PLAN.md`.
- Re-check the editor integration points table in `mcp/README.md`
  (`app.js` MCP adapter start, `index.html` status panel, `viewport.js` preserved
  buffer, `projects.js`, `latheGeometry.js`, `build.mjs`).
- Keep removed: the author-hosted update checker (`SITE_URL` / `UPDATE_URL`,
  Check for updates in About) and the prebuilt `camworker.bundle.txt`.
- New or changed tool choices use the shared `tool-choice` control and tokens: no
  native `<select>`, no emoji, no one-sided coloured borders.
- Keep local geometry, body roles, parameter, persistence, export and MCP
  behaviour. New manual workspaces must block MCP mutations while open.
- Keep `third_party/` pinned; update `THIRD-PARTY-NOTICES.md` / `LICENSES/` when a
  dependency or notice changes. Keep the author's notice in `LICENSE` and `NOTICE.md`.
- Never edit `docs/app.js` or `build/`; rebuild with `npm run build`.

## Record and verify (steps 6 to 8)

- Snapshot only after the merge is resolved, since it replaces the merge base.
  It writes `test/fixtures/upstream-v<ver>.json` and prints the manifest SHA-256.
- Add a `## Editor X.Y.Z archive update` section to `SOURCES.md`, modelled on the
  2.7.4 one: archive name, manifest path and SHA-256, what was adopted, what was
  excluded and why. Do not call it an author Git tag or commit.
- Browser tests need `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright`
  and must run outside the sandbox. `npm test` takes about 14 minutes; run it in
  the background. `mcp/tests/editor-v274.browser.mjs` covers the imported tools.
- The archive's own `tests/*.cjs` are author scripts; use them as reference, not as our gate.
- Commit `src/`, `tools/`, `upstream/editor/`, the manifest and `SOURCES.md`
  together, so the `upstream/editor/` diff shows exactly the author's change.
  Report the commands run and ask before committing.
