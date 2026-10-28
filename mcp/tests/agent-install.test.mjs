import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installClaude, installCursor } from "../packaging/agent-install.mjs";
import { clientConfig } from "../server/client-config.mjs";

const home = () => mkdtemp(join(tmpdir(), "jumpstart-home-"));
const config = clientConfig();

test("cursor install merges the MCP server, copies the skill and is repeatable", async () => {
  const dir = await home();
  await mkdir(join(dir, ".cursor"));
  await writeFile(join(dir, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
  assert.equal((await installCursor({ home: dir })).registered, true);
  const settings = JSON.parse(await readFile(join(dir, ".cursor/mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(settings.mcpServers), ["other", "jumpstart"]);
  assert.deepEqual(settings.mcpServers.jumpstart, config);
  const skill = join(dir, ".cursor/skills/3d-model");
  assert.match(await readFile(join(skill, "SKILL.md"), "utf8"), /^---\nname: 3d-model/);
  assert.ok((await readdir(join(skill, "references"))).length > 0);
  for (const omitted of ["tests", "agents"]) await assert.rejects(access(join(skill, omitted)));
  for (const name of ["step-parts", "woodwork-joints-3d"]) {
    assert.match(await readFile(join(dir, ".cursor/skills", name, "SKILL.md"), "utf8"), new RegExp(`^---\\nname: ${name}\\n`));
    await access(join(dir, ".cursor/skills", name, ".jumpstart-3d"));
  }
  assert.equal((await installCursor({ home: dir })).registered, false);
});

test("installers refuse custom registrations and unmanaged skills without changing anything", async () => {
  const dir = await home();
  await mkdir(join(dir, ".cursor"));
  const custom = JSON.stringify({ mcpServers: { jumpstart: { command: "docker", args: ["exec", "-i", "jumpstart-3d"] } } });
  await writeFile(join(dir, ".cursor/mcp.json"), custom);
  await assert.rejects(installCursor({ home: dir }), /custom jumpstart MCP server/);
  assert.equal(await readFile(join(dir, ".cursor/mcp.json"), "utf8"), custom);
  await assert.rejects(access(join(dir, ".cursor/skills/3d-model")));

  const other = await home();
  await mkdir(join(other, ".claude/skills/3d-model"), { recursive: true });
  const calls = [];
  await assert.rejects(installClaude({ home: other, run: (args) => calls.push(args) }), /not installed by JumpStart/);
  assert.deepEqual(calls, []);

  const companion = await home();
  await mkdir(join(companion, ".cursor/skills/woodwork-joints-3d"), { recursive: true });
  await assert.rejects(installCursor({ home: companion }), /woodwork-joints-3d exists and was not installed by JumpStart/);
  await assert.rejects(access(join(companion, ".cursor/skills/3d-model")));
  await assert.rejects(access(join(companion, ".cursor/mcp.json")));
});

test("claude install registers through the CLI once and keeps a matching registration", async () => {
  const dir = await home();
  const calls = [];
  assert.equal((await installClaude({ home: dir, run: (args) => calls.push(args) })).registered, true);
  assert.deepEqual(calls, [["mcp", "add", "--scope", "user", "--transport", "stdio", "jumpstart", "--", config.command, ...config.args]]);
  await writeFile(join(dir, ".claude.json"), JSON.stringify({ mcpServers: { jumpstart: { type: "stdio", command: "node", args: config.args, env: {} } } }));
  assert.equal((await installClaude({ home: dir, run: (args) => calls.push(args) })).registered, false);
  assert.equal(calls.length, 1);
  assert.ok(await readFile(join(dir, ".claude/skills/3d-model/SKILL.md"), "utf8"));
});
