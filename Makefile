.PHONY: up down logs mcp-config codex-install plugin benchmark

up:
	mkdir -p exports
	docker compose up -d --build --wait
	@printf 'JumpStart is ready at http://localhost:3210/?mcp=1\n'
	@printf 'For TOML-based clients: make mcp-config\n'
	@printf 'Register with Codex: make codex-install\n'
	@printf 'Claude Code and Antigravity CLI setup: see mcp/README.md\n'

down:
	docker compose down

logs:
	docker compose logs -f jumpstart

mcp-config:
	@command -v node >/dev/null 2>&1 || { echo 'Host Node.js 22 or newer is required for MCP. The app can still run with Docker only.' >&2; exit 1; }
	@node mcp/server/client-config.mjs print

codex-install:
	@command -v codex >/dev/null 2>&1 || { echo 'Codex CLI not found on PATH.' >&2; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo 'Host Node.js 22 or newer is required for MCP. The app can still run with Docker only.' >&2; exit 1; }
	@node mcp/packaging/install.mjs "$$(command -v codex)"

plugin:
	@node mcp/packaging/plugin.mjs

benchmark:
	npm run benchmark:tutorials
