#!/usr/bin/env node
// Compares a JumpStart 3D author archive with upstream/editor/ (the last adopted
// archive) and this repo's src/ and tools/, merges what can be merged, and
// records a new snapshot. Run from the repository root.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync, mkdtempSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const SKILL = dirname(dirname(new URL(import.meta.url).pathname));
const SNAPSHOT = join(ROOT, "upstream/editor");
const MAPPINGS = [["app/src", "src"], ["app/tools", "tools"]];
const NOTICES = ["LICENSE", "THIRD-PARTY-NOTICES.md", "LICENSES"];
const EXCLUDED = JSON.parse(readFileSync(join(SKILL, "excluded.json"), "utf8"));

const sha = buffer => createHash("sha256").update(buffer).digest("hex");
const walk = dir => !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name === ".DS_Store" ? [] : [join(dir, entry.name)]);
const hashes = dir => new Map(walk(dir).map(file => [relative(dir, file), sha(readFileSync(file))]));
const fileHash = file => existsSync(file) && statSync(file).isFile() ? sha(readFileSync(file)) : null;
const treeHash = path => !existsSync(path) ? null : statSync(path).isFile() ? fileHash(path) : sha(JSON.stringify([...hashes(path)].sort()));
const versionOf = dir => readFileSync(join(dir, "app/src/version.js"), "utf8").match(/VERSION\s*=\s*"([^"]+)"/)?.[1] ?? fail(`No VERSION in ${dir}/app/src/version.js`);
function fail(message) { console.error(`editor-upstream: ${message}`); process.exit(2); }

// Accepts an archive zip, its extracted folder, or a folder containing one archive folder.
function resolveSource(input) {
  if (!input) fail("pass the author archive (.zip) or its extracted folder");
  let path = join(ROOT, relative(ROOT, input));
  if (path.endsWith(".zip")) {
    const target = join(ROOT, "sources", basename(path, ".zip"));
    if (!existsSync(target)) {
      mkdirSync(join(ROOT, "sources"), { recursive: true });
      execFileSync("unzip", ["-q", path, "-d", join(ROOT, "sources")]);
    }
    path = target;
  }
  if (!existsSync(join(path, "app/src")) && existsSync(path)) {
    const inner = readdirSync(path).map(name => join(path, name)).filter(dir => existsSync(join(dir, "app/src")));
    if (inner.length === 1) path = inner[0];
  }
  if (!existsSync(join(path, "app/src"))) fail(`${input} has no app/src folder`);
  return path;
}

function classify(source) {
  if (!existsSync(join(SNAPSHOT, "app/src"))) fail("upstream/editor/ is missing; snapshot the archive version src/ is based on first (see SKILL.md)");
  const rows = [];
  for (const [up, local] of MAPPINGS) {
    const base = hashes(join(SNAPSHOT, up)), next = hashes(join(source, up));
    for (const path of [...new Set([...base.keys(), ...next.keys()])].sort()) {
      const key = `${up}/${path}`, b = base.get(path) ?? null, n = next.get(path) ?? null, l = fileHash(join(ROOT, local, path));
      const upstream = !b ? "added" : !n ? "removed" : b === n ? "same" : "changed";
      let action;
      if (EXCLUDED[key]) action = "excluded";
      else if (upstream === "same") action = "none";
      else if (upstream === "changed") action = l === n ? "done" : l === b ? "copy" : !l ? "review-absent" : "merge";
      else if (upstream === "added") action = l === n ? "done" : !l ? "review-new" : "review-collision";
      else action = !l ? "done" : l === b ? "review-delete" : "review-removed";
      rows.push({ path: key, local: `${local}/${path}`, upstream, action, localChanges: !!l && !!b && l !== b && l !== n });
    }
  }
  for (const name of NOTICES) if (treeHash(join(SNAPSHOT, name)) !== treeHash(join(source, name)))
    rows.push({ path: name, local: name, upstream: "changed", action: "review-notice", localChanges: false });
  const before = existsSync(join(SNAPSHOT, "third_party.json")) ? JSON.parse(readFileSync(join(SNAPSHOT, "third_party.json"), "utf8")) : {};
  for (const [name, digest] of Object.entries(thirdParty(source))) if (before[name] !== digest)
    rows.push({ path: `third_party/${name}`, local: `third_party/${name}`, upstream: before[name] ? "changed" : "added", action: "review-dependency", localChanges: false });
  return rows;
}

function thirdParty(source) {
  const dir = join(source, "third_party");
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => [entry.name, treeHash(join(dir, entry.name))]));
}

function report(rows, source) {
  const counts = rows.reduce((all, row) => ({ ...all, [row.action]: (all[row.action] ?? 0) + 1 }), {});
  console.log(`Base upstream/editor: ${versionOf(SNAPSHOT)}  New archive: ${versionOf(source)} (${relative(ROOT, source)})`);
  console.log(Object.entries(counts).map(([action, count]) => `${action}: ${count}`).join("  "));
  for (const row of rows.filter(row => !["none", "done"].includes(row.action)))
    console.log(`${row.action.padEnd(18)} ${row.path}${row.action === "excluded" ? `  (${EXCLUDED[row.path]})` : ""}`);
}

function merge(rows, source) {
  const work = mkdtempSync(join(tmpdir(), "editor-upstream-")), conflicts = [];
  const baseLabel = `upstream ${versionOf(SNAPSHOT)}`, newLabel = `upstream ${versionOf(source)}`;
  for (const row of rows) {
    const next = join(source, row.path), local = join(ROOT, row.local);
    if (row.action === "copy") { cpSync(next, local); console.log(`copied   ${row.local}`); }
    if (row.action !== "merge") continue;
    const base = join(work, "base");
    writeFileSync(base, readFileSync(join(SNAPSHOT, row.path)));
    try { execFileSync("git", ["merge-file", "-L", "ours (repo)", "-L", baseLabel, "-L", newLabel, local, base, next]); console.log(`merged   ${row.local}`); }
    catch (error) { if (error.status > 0 && error.status < 128) { conflicts.push(row.local); console.log(`CONFLICT ${row.local} (${error.status})`); } else throw error; }
  }
  rmSync(work, { recursive: true, force: true });
  console.log(conflicts.length ? `\nResolve conflict markers in: ${conflicts.join(", ")}` : "\nNo conflicts.");
}

function snapshot(source) {
  const version = versionOf(source);
  rmSync(SNAPSHOT, { recursive: true, force: true });
  for (const path of [...MAPPINGS.map(([up]) => up), ...NOTICES]) if (existsSync(join(source, path))) {
    mkdirSync(dirname(join(SNAPSHOT, path)), { recursive: true });
    cpSync(join(source, path), join(SNAPSHOT, path), { recursive: true, filter: file => basename(file) !== ".DS_Store" });
  }
  writeFileSync(join(SNAPSHOT, "third_party.json"), `${JSON.stringify(thirdParty(source), null, 2)}\n`);
  const files = [...hashes(join(source, "app/src"))].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, digest]) => ({ path, sha256: digest }));
  const manifest = { version, source: "User-supplied full-source archive, app/src", manifestSha256: sha(JSON.stringify(files)), files };
  const fixture = join(ROOT, `test/fixtures/upstream-v${version.replaceAll(".", "")}.json`);
  writeFileSync(fixture, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`upstream/editor/ is now ${version}; ${files.length} app/src files; manifest ${relative(ROOT, fixture)} sha256 ${manifest.manifestSha256}`);
}

const [command, input] = process.argv.slice(2);
if (command === "status") { const source = resolveSource(input); report(classify(source), source); }
else if (command === "merge") { const source = resolveSource(input), rows = classify(source); report(rows, source); console.log(""); merge(rows, source); }
else if (command === "snapshot") snapshot(resolveSource(input));
else fail("usage: editor-upstream.mjs status|merge|snapshot <archive.zip|folder>");
