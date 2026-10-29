<div align="center">

# JumpStart 3D Self-Hosted

**A browser CAD editor on your homelab that your AI agent can model with.**

![Docker Compose](https://img.shields.io/badge/Run-Docker%20Compose-2496ED?logo=docker&logoColor=white)
![MCP](https://img.shields.io/badge/AI-Local%20MCP-477652)
![Editor 2.7.7](https://img.shields.io/badge/Editor-JumpStart%203D%202.7.7-365F40)
[![MIT License](https://img.shields.io/badge/License-MIT-6B7D5C.svg)](LICENSE)

[Try the demo](https://jumpstart-3d.onrender.com) ·
[Start the app](#start-the-app) · [Connect an agent](#connect-an-agent) ·
[Read the guides](#guides)

</div>

## Why this exists

I wanted JumpStart 3D running on my own server, next to the apps in
[homelab-services](https://github.com/martin-gomola/homelab-services), and I
wanted an AI agent to do the modeling: Gridfinity bins for a drawer, a bracket,
a knob that fits a shaft. Codex, Claude Code and Antigravity CLI (Gemini) all
come with subscriptions I already pay for, so the agent signs in with those. No
model API key is needed or collected.

The agent never edits the model blindly. It sends a typed plan, gets a preview
with measurements and images, and applies it only when the checks pass. The
result is normal editor features that I can edit or undo by hand.

**agent prompt → typed plan → preview and inspect → apply → editable features**

## What you need

- Docker with Compose, and Make
- Node.js 22 or newer on the computer that runs the agent

## Start the app

```bash
cp .env.example .env    # set JUMPSTART_DATA_DIR to a folder outside the repo
make up
```

Open [http://localhost:3210/?mcp=1](http://localhost:3210/?mcp=1) and keep the
tab open. The AI button in the top bar shows whether an agent is connected.

## Connect an agent

| Agent | Command |
| --- | --- |
| Codex | `make codex-install` |
| Claude Code | `make claude-install` |
| Cursor | `make cursor-install` |
| Antigravity CLI (Gemini) | Manual setup in the [MCP guide](mcp/README.md#connect-claude-code-or-antigravity-cli) |

Each command registers the MCP server and installs the `3d-model` skill with its
`step-parts`, `woodwork-joints-3d` and `bambu-handoff` companions.

The server only listens on the server's loopback. To use it from a laptop, open
an SSH tunnel and keep local port 3210, because the server only accepts
requests from `localhost` on its own port:

```bash
ssh -N -L 3210:127.0.0.1:3210 <user>@<homelab-host>
```

Then open [http://localhost:3210/?mcp=1](http://localhost:3210/?mcp=1) on the
laptop and run the agent there.

## Try the demo

The editor runs at [jumpstart-3d.onrender.com](https://jumpstart-3d.onrender.com)
on Render's free static hosting. The first visit downloads about 13 MB, mostly
the CAD engine, so it takes a few seconds to open. The demo has no AI agent
connection; run the app locally for that.

## Commands you will use

| Command | Use it when |
| --- | --- |
| `make up` | Build and start the app |
| `make down` | Stop the app |
| `make logs` | See server messages |
| `make mcp-config` | Print the MCP config for TOML-based clients |
| `npm run build` | Rebuild the browser app into `build/site/` |
| `npm test` | Run unit and browser tests (about 15 minutes) |

## What this repo adds to JumpStart 3D

| Area | What we added |
| --- | --- |
| AI modeling | Local MCP server (loopback only) with typed plans: preview, inspect, apply with revision checks, no duplicate applies, undo. |
| Agent skills | `3d-model` in `mcp/plugin/` teaches the agent how to model, check fit and recover from failures. It looks up published product dimensions, builds models from dimensioned drawings, and checks downloaded reference models against the published sizes. `step-parts` fetches STEP files for real screws, bearings, motors and boards from step.parts, `woodwork-joints-3d` designs printable wood joinery, and `bambu-handoff` opens exports in Bambu Studio. |
| Inspection | Geometry reports, preview images, sections, measurements, solid pair distance and overlap, acceptance requirements. |
| Exports and drawings | STL, STEP and 3MF of the printable bodies. Dimensioned SVG or PDF drawings with front, top, right and iso views, hidden lines, diameter callouts and a title block on A4 or A3. |
| Gridfinity | Bins, inserts with measured pockets, baseplates with optional magnet pockets, a drawer layout planner with corner spacers and clips, open-sided bins with flush joins, printer-fit checks. |
| Parts tools | Fasteners, hole patterns, gears, name plates, knurled knobs and springs. |
| Model settings | Named parameters, so saved models can be revised later. |
| Body roles | Design, reference and hardware bodies; exports include only what should be printed. |
| Traced outlines | Tool outlines exported from Tracefinity become insert pockets. |
| Self-hosting | Docker Compose setup with a persistent data folder and local save and reopen. |
| Editor updates | `upstream/editor/` base and the `update-editor-source` skill for merging new author zips. |

## iPhone AR preview (prototype)

Open **Open/Export → View in AR / QR** to create a temporary USDZ snapshot and QR code. Enter an HTTPS address reachable by your phone, with only `/ar/` forwarded to the local JumpStart server. Scan the QR with the iPhone camera and tap the model to open AR Quick Look. Shares expire after 30 minutes or a server restart. The prototype preserves physical size and body colors; face paints and image textures are not included.

See the [AR setup and verification notes](AR-QR-RESEARCH.md#prototype-implemented). Actual iPhone placement and your HTTPS route still need device verification.

## Editor updates

The author publishes new JumpStart 3D versions as zip archives in a
[Google Drive folder](https://drive.google.com/drive/folders/1IbgwR0PddrV7Q6wchvndJ5eUvLd_e_HL),
not on GitHub. `upstream/editor/` holds the untouched archive this build is
based on. Put a new zip in `sources/` and ask your agent to update the editor
core; the `.agents/skills/update-editor-source` skill merges it into `src/` and
keeps our changes.

Manual tools such as Architect, CAM Studio, CosForge and Chip Carving work in
the editor but are not MCP operations.

## Project folders

```text
src/              The editor (JumpStart 3D source with our changes)
mcp/              MCP server, browser bridge, shared contracts, tests, agent skill
upstream/editor/  Untouched author archive used as the merge base
.agents/skills/   Developer skills for working on this repo
third_party/      Pinned libraries and their licenses
```

## Guides

- [MCP guide](mcp/README.md): setup, tools, plan schemas and limits
- [Design notes](DESIGN.md)
- [Sources and licenses](SOURCES.md)
- [Agent rules for this repo](AGENTS.md)

## License

MIT. Based on JumpStart 3D; see [NOTICE.md](NOTICE.md) and
[third-party notices](THIRD-PARTY-NOTICES.md).
