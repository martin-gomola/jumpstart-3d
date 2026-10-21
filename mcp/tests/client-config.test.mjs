import test from "node:test";
import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { clientConfig, clientToml } from "../server/client-config.mjs";

test("Codex configuration uses the host Node and an absolute proxy path", () => {
  const config = clientConfig();
  assert.equal(config.command, process.execPath);
  assert.equal(config.args.length, 1);
  assert.ok(isAbsolute(config.args[0]));
  assert.match(config.args[0], /mcp\/server\/stdio-proxy\.mjs$/);
  assert.doesNotMatch(clientToml(config), /docker/);
});
test("configuration checks the host Node version and quotes paths", () => {
  assert.throws(() => clientConfig("/node", "20.1.0"), /22 or newer/);
  assert.equal(clientConfig("/node", "22.0.0").command, "/node");
  const toml = clientToml({ command: '/path with "quotes"/node', args: ['/repo with spaces/proxy.mjs'] });
  assert.ok(toml.includes(JSON.stringify('/path with "quotes"/node')));
  assert.ok(toml.includes(JSON.stringify('/repo with spaces/proxy.mjs')));
});
test("make mcp-config emits the same host configuration without registration", () => {
  const result = spawnSync("make", ["mcp-config"], { cwd: new URL("../..", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, clientToml(clientConfig()));
});
