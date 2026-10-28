#!/usr/bin/env node
// Registers the host MCP proxy and copies the bundled skills for Claude Code or Cursor.
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { clientConfig } from "../server/client-config.mjs";
import { commandRunner } from "./install.mjs";
import { ROOT, skillNames } from "./plugin.mjs";

const MARKER = ".jumpstart-3d";
const exists = (path) => access(path).then(() => true, () => false);

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw new Error(`Cannot read ${path}: ${error.message}. No configuration was changed.`); }
}

function checkExisting(entry, config, where) {
  if (!entry) return false;
  const same = JSON.stringify(entry.args) === JSON.stringify(config.args) && (entry.command === config.command || basename(entry.command || "") === "node");
  if (!same) throw new Error(`A custom jumpstart MCP server exists in ${where}. Remove it explicitly before installing. No configuration was changed.`);
  return true;
}

// Every target is checked before any skill is copied, so a refusal changes nothing.
async function checkSkills(skillsDir, root) {
  const targets = [];
  for (const name of await skillNames(root)) {
    const target = join(skillsDir, name);
    if (await exists(target) && !await exists(join(target, MARKER))) throw new Error(`${target} exists and was not installed by JumpStart. Remove it explicitly before installing. No configuration was changed.`);
    targets.push({ name, target });
  }
  return targets;
}

async function copySkills(targets, root) {
  for (const { name, target } of targets) {
    await rm(target, { recursive: true, force: true });
    await cp(join(root, "mcp/plugin/skills", name), target, { recursive: true, filter: (path) => !/[\\/](tests|agents|\.DS_Store)$/.test(path) });
    await writeFile(join(target, MARKER), "Installed from jumpstart-3d by make claude-install or make cursor-install.\n");
  }
  return targets.map(({ target }) => target);
}

export async function installClaude({ home = homedir(), nodePath = process.execPath, root = ROOT, run = commandRunner("claude") } = {}) {
  const config = clientConfig(nodePath);
  const registered = checkExisting((await readJson(join(home, ".claude.json"))).mcpServers?.jumpstart, config, "Claude Code user settings");
  const skills = await copySkills(await checkSkills(join(home, ".claude/skills"), root), root);
  if (!registered) run(["mcp", "add", "--scope", "user", "--transport", "stdio", "jumpstart", "--", config.command, ...config.args]);
  return { skills, registered: !registered };
}

export async function installCursor({ home = homedir(), nodePath = process.execPath, root = ROOT } = {}) {
  const config = clientConfig(nodePath);
  const path = join(home, ".cursor/mcp.json");
  const settings = await readJson(path);
  const registered = checkExisting(settings.mcpServers?.jumpstart, config, path);
  const skills = await copySkills(await checkSkills(join(home, ".cursor/skills"), root), root);
  if (!registered) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ ...settings, mcpServers: { ...settings.mcpServers, jumpstart: config } }, null, 2)}\n`);
  }
  return { skills, registered: !registered };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const client = process.argv[2];
  try {
    if (!["claude", "cursor"].includes(client)) throw new Error("Expected claude or cursor.");
    const result = await (client === "claude" ? installClaude() : installCursor());
    console.log(`${result.registered ? "Registered" : "Kept"} the jumpstart MCP server and installed skills at ${result.skills.join(", ")}.`);
    console.log(`Run make up and keep http://localhost:3210/?mcp=1 open. ${client === "claude" ? "Start a new Claude Code session" : "Restart Cursor or reload MCP servers in Cursor Settings"} to load them.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
