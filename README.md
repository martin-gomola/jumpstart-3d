# JumpStart 3D Self-Hosted

A standalone, self-hosted build of JumpStart 3D with a local MCP server. Connect
Codex, Claude Code, or Antigravity CLI through the account you already use. The
JumpStart setup does not require a model API key.

## Start locally

Requirements: Docker Compose, Make, and Node.js 22 or newer on the host for MCP
clients.

```sh
npm ci
make up
```

Open [http://localhost:3210/?mcp=1](http://localhost:3210/?mcp=1) and keep the
editor tab open. The server publishes its port on loopback only. The top-bar AI
button shows connection status and the setup commands for supported clients.
Stop the app with `make down`; inspect logs with `make logs`.

For Codex, run `make codex-install`. For Claude Code and Antigravity CLI,
register the host proxy described in [the MCP guide](mcp/README.md).

## MCP workflow

The MCP API accepts typed modeling plans. Preview reports geometry and a visual
inspection; apply requires the returned preview and current document revision.
Duplicate applies do not repeat an edit. Applied changes use native JumpStart
feature nodes and can be undone in the editor.

Supported plans include primitives, sketches, CAD features, transforms,
patterns, fasteners, hole patterns, and geometry modifiers. See the
[MCP guide](mcp/README.md) for schemas, limits, setup commands, and examples.

## Build and checks

```sh
npm run build
npm test
```

The build produces a local web app and the standalone HTML artifact. MCP test
commands and browser prerequisites are listed in the MCP guide.

## Source and license

This is an independent project based on JumpStart 3D source released under the
MIT License. We use the author repository as the editor source reference and
Max Sikorski's community project as an optional feature reference. Updates are
reviewed and adapted into this repository; neither source is merged
automatically. See [SOURCES.md](SOURCES.md), [NOTICE.md](NOTICE.md), and
[third-party notices](THIRD-PARTY-NOTICES.md).
