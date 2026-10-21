import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { listManagedImports, resolveManagedImports, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_CATALOG_FILES } from "../server/imports.mjs";
import { MAX_3MF_ENTRY_BYTES, MAX_3MF_TOTAL_UNCOMPRESSED_BYTES } from "../../src/meshimport.js";
import { parse3MF } from "../../src/meshimport.js";

function storedZip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, entry] of Object.entries(entries)) {
    const spec = entry && typeof entry === "object" && !Buffer.isBuffer(entry) ? entry : { data: entry };
    const filename = Buffer.from(name), raw = Buffer.from(spec.data), method = spec.deflated ? 8 : 0;
    const data = spec.deflated ? deflateRawSync(raw) : raw, declaredSize = spec.declaredSize ?? raw.length;
    const local = Buffer.alloc(30), header = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(method, 10); header.writeUInt32LE(data.length, 20); header.writeUInt32LE(declaredSize, 24); header.writeUInt16LE(filename.length, 28); header.writeUInt32LE(offset, 42);
    central.push(header, filename);
    offset += local.length + filename.length + data.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

test("managed imports list metadata and resolve digest ids without exposing path input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jumpstart-imports-"));
  const bytes = await readFile(new URL("./fixtures/tetra.stl", import.meta.url));
  await writeFile(join(directory, "tetra.stl"), bytes);
  await writeFile(join(directory, "notes.txt"), "ignored");
  await symlink(join(directory, "tetra.stl"), join(directory, "linked.stl"));
  const listed = await listManagedImports(directory);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(listed.assets.length, 1);
  assert.deepEqual(listed.assets[0], { assetId: digest, name: "tetra.stl", format: "stl", sizeBytes: bytes.length });
  assert.equal(listed.assets[0].base64, undefined);
  const [resolved] = await resolveManagedImports(directory, [digest]);
  assert.equal(Buffer.from(resolved.base64, "base64").compare(bytes), 0);
  await assert.rejects(resolveManagedImports(directory, ["../tetra.stl"]), /SHA-256 asset ids/);
  await assert.rejects(resolveManagedImports(directory, ["0".repeat(64)]), /unavailable, changed/);
  await writeFile(join(directory, "too-large.stl"), Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1));
  assert.equal((await listManagedImports(directory)).assets.length, 1);
});

test("managed import resolution rejects changed content and plans over the import count", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jumpstart-imports-"));
  const bytes = await readFile(new URL("./fixtures/tetra.stl", import.meta.url));
  const path = join(directory, "tetra.stl");
  await writeFile(path, bytes);
  const [{ assetId }] = (await listManagedImports(directory)).assets;
  await writeFile(path, Buffer.concat([bytes, Buffer.from("changed")]));
  await assert.rejects(resolveManagedImports(directory, [assetId]), /unavailable, changed/);
  await assert.rejects(resolveManagedImports(directory, Array(5).fill("0".repeat(64))), /at most 4 assets/);
});

test("managed import root must be a directory rather than a symbolic link", async () => {
  const parent = await mkdtemp(join(tmpdir(), "jumpstart-import-root-"));
  const target = join(parent, "target");
  const link = join(parent, "link");
  await mkdir(target);
  await symlink(target, link);
  await assert.rejects(listManagedImports(link), /real directory/);
});

test("import catalog is bounded and 3MF file units are preserved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jumpstart-import-catalog-"));
  const model = `<model unit="inch"><resources><object id="1" type="model"><mesh><vertices><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
  const threeMf = storedZip({ "3D/3dmodel.model": model });
  await writeFile(join(directory, "000-part.3mf"), threeMf);
  for (let i = 0; i < MAX_IMPORT_CATALOG_FILES; i++) await writeFile(join(directory, `catalog-${String(i).padStart(3, "0")}.stl`), `solid empty ${i}`);
  const listing = await listManagedImports(directory);
  assert.equal(listing.assets.length, MAX_IMPORT_CATALOG_FILES);
  assert.equal(listing.truncated, true);
  assert.equal(listing.limits.catalogFiles, MAX_IMPORT_CATALOG_FILES);
  assert.equal(listing.assets[0].format, "3mf");
  const parsed = await parse3MF(threeMf.buffer.slice(threeMf.byteOffset, threeMf.byteOffset + threeMf.byteLength));
  assert.equal(parsed.unit, "inch");
  assert.equal(parsed.pos[0], 25.4);
});

test("3MF rejects oversized declared entries, aggregate expansion, and deflate output", async () => {
  const oversizedEntry = storedZip({ "3D/3dmodel.model": { data: "x", declaredSize: MAX_3MF_ENTRY_BYTES + 1 } });
  await assert.rejects(parse3MF(oversizedEntry.buffer.slice(oversizedEntry.byteOffset, oversizedEntry.byteOffset + oversizedEntry.byteLength)), /entry larger/);

  const oversizedTotal = storedZip({
    "one": { data: "x", declaredSize: MAX_3MF_ENTRY_BYTES - 1 },
    "two": { data: "y", declaredSize: MAX_3MF_TOTAL_UNCOMPRESSED_BYTES - (MAX_3MF_ENTRY_BYTES - 1) + 1 },
  });
  await assert.rejects(parse3MF(oversizedTotal.buffer.slice(oversizedTotal.byteOffset, oversizedTotal.byteOffset + oversizedTotal.byteLength)), /expands beyond/);

  // The central directory lies about the output size; inflation itself must still stop at the cap.
  const compressedBomb = storedZip({ "3D/3dmodel.model": { data: Buffer.alloc(MAX_3MF_ENTRY_BYTES + 1, 65), deflated: true, declaredSize: 32 } });
  await assert.rejects(parse3MF(compressedBomb.buffer.slice(compressedBomb.byteOffset, compressedBomb.byteOffset + compressedBomb.byteLength)), /Decompressed data exceeds/);

  const totalBomb = storedZip({
    "_rels/.rels": { data: Buffer.alloc(40 * 1024 * 1024, 32), deflated: true, declaredSize: 1 },
    "3D/3dmodel.model": { data: Buffer.concat([Buffer.from('<model unit="millimeter"/>'), Buffer.alloc(25 * 1024 * 1024, 32)]), deflated: true, declaredSize: 1 },
  });
  await assert.rejects(parse3MF(totalBomb.buffer.slice(totalBomb.byteOffset, totalBomb.byteOffset + totalBomb.byteLength)), /expands beyond/);
});
