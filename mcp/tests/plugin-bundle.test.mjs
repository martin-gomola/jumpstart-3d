import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, buildPlugin } from '../packaging/plugin.mjs';
import { installPlugin, managedRegistration } from '../packaging/install.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jumpstart-plugin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['mcp/plugin', 'mcp/server', '.agents/plugins']) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await cp(join(ROOT, path), join(root, path), { recursive: true });
  }
  return root;
}
const oldEntry = root => ({ name: 'jumpstart', enabled: true, transport: { type: 'stdio', command: '/bin/node', args: [join(root, 'mcp/server/stdio-proxy.mjs')] } });

test('portable bundle is complete and stable, and excludes evaluation fixtures', async t => {
  const root = await fixture(t), first = await buildPlugin({ root }), second = await buildPlugin({ root });
  assert.equal(first.version, second.version);
  assert.ok(!first.files.some(path => path.includes('/tests/')));
  const config = JSON.parse(await readFile(join(first.pluginRoot, '.mcp.json')));
  assert.equal(config.mcpServers.jumpstart.command, 'node');
  assert.equal(config.mcpServers.jumpstart.args[0], 'server/stdio-proxy.mjs');
  assert.ok((await readFile(join(first.pluginRoot, 'skills/3d-model/SKILL.md'), 'utf8')).includes('name: 3d-model'));
  const skill = join(root, 'mcp/plugin/skills/3d-model/SKILL.md');
  await writeFile(skill, (await readFile(skill)) + '\nUpdated instructions.\n');
  assert.notEqual((await buildPlugin({ root })).version, first.version);
});

test('local bundle pins Node; unsafe output and stale runtime are rejected', async t => {
  const root = await fixture(t), local = await buildPlugin({ root, nodePath: '/bin/node' });
  assert.equal(JSON.parse(await readFile(join(local.pluginRoot, '.mcp.json'))).mcpServers.jumpstart.command, '/bin/node');
  await assert.rejects(buildPlugin({ root, output: join(root, 'mcp') }), /owned build/);
  await writeFile(join(root, 'mcp/plugin/server/stdio-proxy.mjs'), 'stale');
  await assert.rejects(buildPlugin({ root }), /stale/);
});

test('installer rebuilds an ignored marketplace before asking Codex to load plugins', async t => {
  const root = await fixture(t), calls = [];
  let version;
  const marketplaceRoot = join(root, 'build/codex-marketplace');
  const run = args => {
    calls.push(args.join(' '));
    if (args[0] === 'mcp' && args[1] === 'list') return [];
    if (args[0] === 'plugin' && args[1] === 'list') {
      assert.ok(existsSync(join(marketplaceRoot, '.agents/plugins/marketplace.json')));
      return { installed: version ? [{ pluginId: 'jumpstart-3d@jumpstart-3d', installed: true, enabled: true, version }] : [] };
    }
    if (args[1] === 'marketplace' && args[2] === 'list') return { marketplaces: [{ name: 'jumpstart-3d', root: marketplaceRoot }] };
    if (args[0] === 'plugin' && args[1] === 'add') {
      version = JSON.parse(readFileSync(join(marketplaceRoot, 'mcp/plugin/.codex-plugin/plugin.json'), 'utf8')).version;
    }
    return {};
  };
  const result = await installPlugin({ root, run, nodePath: '/bin/node' });
  assert.equal(result.id, 'jumpstart-3d@jumpstart-3d');
  assert.ok(calls.indexOf('plugin list --json') > calls.indexOf('mcp list --json'));
});

test('custom standalone settings are never automatically migrated', () => {
  const entry = oldEntry(ROOT);
  assert.ok(managedRegistration(entry));
  for (const extra of [{ enabled: false }, { enabled_tools: ['one'] }, { tool_timeout_sec: 120 }]) assert.equal(managedRegistration({ ...entry, ...extra }), false);
  assert.equal(managedRegistration({ ...entry, transport: { ...entry.transport, env: { SECRET: 'custom' } } }), false);
});

test('installer removes old registration only after verified plugin installation', async t => {
  const root = await fixture(t), calls = [];
  let version;
  const run = args => {
    calls.push(args.join(' '));
    if (args[0] === 'mcp' && args[1] === 'list') return [oldEntry(root)];
    if (args[0] === 'mcp' && args[1] === 'get') return oldEntry(root);
    if (args[1] === 'marketplace' && args[2] === 'list') return { marketplaces: [] };
    if (args[0] === 'plugin' && args[1] === 'list') return { installed: version ? [{ pluginId: 'jumpstart-3d@jumpstart-3d', installed: true, enabled: true, version }] : [] };
    if (args[0] === 'plugin' && args[1] === 'add') version = JSON.parse(requireManifest());
    return {};
  };
  // Read generated metadata synchronously inside the fake CLI, as a real CLI does.
  const { readFileSync } = await import('node:fs');
  function requireManifest() { return JSON.stringify(JSON.parse(readFileSync(join(root, 'build/codex-marketplace/mcp/plugin/.codex-plugin/plugin.json'))).version); }
  assert.equal((await installPlugin({ root, run })).migrated, true);
  assert.equal(calls.at(-1), 'mcp remove jumpstart');
});

test('failed plugin verification retains standalone registration', async t => {
  const root = await fixture(t), calls = [];
  const run = args => {
    calls.push(args.join(' '));
    if (args[0] === 'mcp' && args[1] === 'list') return [oldEntry(root)];
    if (args[0] === 'mcp' && args[1] === 'get') return oldEntry(root);
    if (args[1] === 'marketplace' && args[2] === 'list') return { marketplaces: [] };
    if (args[0] === 'plugin' && args[1] === 'list') return { installed: [] };
    return {};
  };
  await assert.rejects(installPlugin({ root, run }), /retained/);
  assert.ok(!calls.includes('mcp remove jumpstart'));
});
