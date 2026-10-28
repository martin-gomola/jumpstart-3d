#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, lstat, rm, copyFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const PLUGIN = "jumpstart-3d";
const MANIFEST = ".codex-plugin/plugin.json";
const PROXY = "server/stdio-proxy.mjs";

async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".DS_Store", "tests"].includes(entry.name)) continue;
    const path = join(directory, entry.name), rel = join(prefix, entry.name);
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Plugin must contain real files, not a symlink: ${rel}`);
    if (entry.isDirectory()) result.push(...await files(path, rel));
    else if (entry.isFile()) result.push(rel);
  }
  return result.sort();
}

// A shipped skill is a directory under mcp/plugin/skills with its own SKILL.md.
export async function skillNames(root = ROOT) {
  const directory = join(root, "mcp/plugin/skills");
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { await lstat(join(directory, entry.name, "SKILL.md")); }
    catch { throw new Error(`Skill directory ${entry.name} has no SKILL.md`); }
    names.push(entry.name);
  }
  return names.sort();
}

export async function syncPluginRuntime(root = ROOT) {
  const source = join(root, "mcp/server/stdio-proxy.mjs"), destination = join(root, "mcp/plugin", PROXY);
  await mkdir(join(destination, ".."), { recursive: true });
  await copyFile(source, destination);
}

export async function buildPlugin({ root = ROOT, output, nodePath } = {}) {
  const source = join(root, "mcp/plugin");
  const list = await files(source);
  for (const required of [MANIFEST, ".mcp.json", PROXY, "skills/3d-model/SKILL.md", "skills/3d-model/agents/openai.yaml"]) {
    if (!list.includes(required)) throw new Error(`Plugin is missing ${required}`);
  }
  const canonical = await readFile(join(root, "mcp/server/stdio-proxy.mjs"));
  if (!canonical.equals(await readFile(join(source, PROXY)))) throw new Error("Bundled MCP proxy is stale; run make plugin");
  const manifest = JSON.parse(await readFile(join(source, MANIFEST), "utf8"));
  if (manifest.name !== PLUGIN || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Plugin identity/version is invalid");
  const digest = createHash("sha256");
  const skills = await skillNames(root);
  for (const path of list) {
    if (path !== MANIFEST && path !== ".mcp.json" && path !== PROXY && !skills.some((name) => path.startsWith(`skills/${name}/`))) throw new Error(`Unexpected plugin file: ${path}`);
    digest.update(path).update(await readFile(join(source, path)));
  }
  digest.update(nodePath || "portable-node");
  const version = `${manifest.version}+${digest.digest("hex").slice(0, 12)}`;
  const destination = resolve(output || join(root, "build", nodePath ? "codex-marketplace" : "plugin-distribution"));
  // Only these owned build roots may be replaced by the default installer.
  if (destination === resolve(root) || destination === resolve(source) || !relative(root, destination).startsWith("build/")) throw new Error("Plugin output must be an owned build/ directory");
  await rm(destination, { recursive: true, force: true });
  const pluginRoot = join(destination, "mcp/plugin");
  for (const path of list) { await mkdir(join(pluginRoot, path, ".."), { recursive: true }); await copyFile(join(source, path), join(pluginRoot, path)); }
  await writeFile(join(pluginRoot, MANIFEST), JSON.stringify({ ...manifest, version }, null, 2) + "\n");
  const mcp = JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8"));
  if (nodePath) mcp.mcpServers.jumpstart.command = nodePath;
  await writeFile(join(pluginRoot, ".mcp.json"), JSON.stringify(mcp, null, 2) + "\n");
  const marketplace = JSON.parse(await readFile(join(root, ".agents/plugins/marketplace.json"), "utf8"));
  await mkdir(join(destination, ".agents/plugins"), { recursive: true });
  await writeFile(join(destination, ".agents/plugins/marketplace.json"), JSON.stringify(marketplace, null, 2) + "\n");
  return { marketplace: marketplace.name, pluginRoot, root: destination, version, files: list };
}

export async function packagePlugin(root = ROOT) {
  await syncPluginRuntime(root);
  const built = await buildPlugin({ root });
  const archive = join(root, "dist", `${PLUGIN}-${built.version}.tar.gz`);
  await mkdir(join(root, "dist"), { recursive: true });
  execFileSync("tar", ["-czf", archive, "-C", built.root, "."], { stdio: "inherit" });
  return { ...built, archive };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await packagePlugin(); process.stdout.write(`Plugin bundle: ${result.archive}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
