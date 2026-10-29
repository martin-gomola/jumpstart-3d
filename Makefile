.PHONY: up down logs mcp-config codex-install claude-install cursor-install plugin benchmark

NODE_CHECK = @command -v node >/dev/null 2>&1 || { echo 'Host Node.js 22 or newer is required for MCP. The app can still run with Docker only.' >&2; exit 1; }

up:
	mkdir -p exports
	docker compose up -d --build --wait
	@printf 'JumpStart is ready at http://localhost:3210/?mcp=1\n'
	@printf 'For TOML-based clients: make mcp-config\n'
	@printf 'Register with Codex, Claude Code or Cursor: make codex-install, make claude-install or make cursor-install\n'
	@printf 'Antigravity CLI setup: see mcp/README.md\n'

down:
	docker compose down

logs:
	docker compose logs -f jumpstart

mcp-config:
	$(NODE_CHECK)
	@node mcp/server/client-config.mjs print

codex-install:
	@command -v codex >/dev/null 2>&1 || { echo 'Codex CLI not found on PATH.' >&2; exit 1; }
	$(NODE_CHECK)
	@node mcp/packaging/install.mjs "$$(command -v codex)"

claude-install:
	@command -v claude >/dev/null 2>&1 || { echo 'Claude Code CLI not found on PATH.' >&2; exit 1; }
	$(NODE_CHECK)
	@node mcp/packaging/agent-install.mjs claude

cursor-install:
	$(NODE_CHECK)
	@node mcp/packaging/agent-install.mjs cursor

plugin:
	@node mcp/packaging/plugin.mjs

benchmark:
	npm run benchmark:tutorials

# Publish the editor on the configured LAN IP while keeping MCP on localhost.
.PHONY: up-lan
up-lan:
	mkdir -p exports
	docker compose -f compose.yaml -f compose.lan.yaml up -d --build --wait
