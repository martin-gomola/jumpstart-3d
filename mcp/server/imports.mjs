import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { basename, join } from "node:path";

export const MAX_IMPORT_FILE_BYTES = 24 * 1024 * 1024;
export const MAX_IMPORTS_PER_PLAN = 4;
export const MAX_IMPORT_BYTES_PER_PLAN = 24 * 1024 * 1024;
export const MAX_IMPORT_CATALOG_FILES = 128;
const FORMATS = new Set([".stl", ".3mf", ".step", ".stp"]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function importRoot(directory) {
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("The managed imports path must be a real directory");
  return realpath(directory);
}

async function safeEntry(root, name) {
  if (basename(name) !== name || name === "." || name === ".." || name.includes("\\") || /[\u0000-\u001f\u007f]/.test(name)) return null;
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (!FORMATS.has(ext)) return null;
  const path = join(root, name);
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_IMPORT_FILE_BYTES) return null;
  return { path, info, format: ext === ".stp" ? "step" : ext.slice(1) };
}

export async function listManagedImports(directory) {
  const root = await importRoot(directory);
  const names = (await readdir(root)).filter((name) => FORMATS.has(name.slice(name.lastIndexOf(".")).toLowerCase())).sort((a, b) => a.localeCompare(b));
  const truncated = names.length > MAX_IMPORT_CATALOG_FILES;
  const assets = [];
  const listedIds = new Set();
  for (const name of names.slice(0, MAX_IMPORT_CATALOG_FILES)) {
    const entry = await safeEntry(root, name);
    if (!entry) continue;
    const handle = await open(entry.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.dev !== entry.info.dev || current.ino !== entry.info.ino || current.size > MAX_IMPORT_FILE_BYTES) continue;
      const bytes = await handle.readFile();
      if (bytes.length !== current.size) continue;
      const assetId = digest(bytes);
      if (listedIds.has(assetId)) continue;
      listedIds.add(assetId);
      assets.push({ assetId, name: name.slice(0, 160), format: entry.format, sizeBytes: bytes.length });
    } finally { await handle.close(); }
  }
  return { assets: assets.sort((a, b) => a.name.localeCompare(b.name)), truncated, limits: { fileBytes: MAX_IMPORT_FILE_BYTES, totalPlanBytes: MAX_IMPORT_BYTES_PER_PLAN, importsPerPlan: MAX_IMPORTS_PER_PLAN, catalogFiles: MAX_IMPORT_CATALOG_FILES } };
}

export async function resolveManagedImports(directory, requestedIds) {
  if (!Array.isArray(requestedIds) || requestedIds.length > MAX_IMPORTS_PER_PLAN) throw new Error(`A model plan can import at most ${MAX_IMPORTS_PER_PLAN} assets`);
  if (new Set(requestedIds).size !== requestedIds.length) throw new Error("An import asset may only appear once in a model plan");
  if (requestedIds.some((id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))) throw new Error("Import references must be SHA-256 asset ids from jumpstart_list_imports");
  const wanted = new Set(requestedIds);
  if (!wanted.size) return [];
  const root = await importRoot(directory);
  const names = (await readdir(root)).filter((name) => FORMATS.has(name.slice(name.lastIndexOf(".")).toLowerCase())).sort((a, b) => a.localeCompare(b)).slice(0, MAX_IMPORT_CATALOG_FILES);
  const found = new Map();
  let totalBytes = 0;
  for (const name of names) {
    const entry = await safeEntry(root, name);
    if (!entry) continue;
    const handle = await open(entry.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.dev !== entry.info.dev || current.ino !== entry.info.ino) continue;
      if (current.size > MAX_IMPORT_FILE_BYTES) continue;
      const bytes = await handle.readFile();
      if (bytes.length !== current.size) continue;
      const assetId = digest(bytes);
      if (!wanted.has(assetId)) continue;
      if (found.has(assetId)) continue;
      totalBytes += bytes.length;
      if (totalBytes > MAX_IMPORT_BYTES_PER_PLAN) throw new Error(`Imported files exceed the ${MAX_IMPORT_BYTES_PER_PLAN} byte plan limit`);
      found.set(assetId, { assetId, name: name.slice(0, 160), format: entry.format, sizeBytes: bytes.length, base64: bytes.toString("base64") });
    } finally { await handle.close(); }
  }
  const missing = requestedIds.find((id) => !found.has(id));
  if (missing) throw new Error(`Import ${missing} is unavailable, changed, or not an allowed regular file in the managed imports directory`);
  return requestedIds.map((id) => found.get(id));
}
