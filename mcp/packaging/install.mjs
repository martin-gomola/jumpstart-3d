#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { clientConfig } from '../server/client-config.mjs';
import { ROOT, PLUGIN, syncPluginRuntime, buildPlugin } from './plugin.mjs';

export function managedRegistration(entry, root = ROOT) {
  const transport = entry?.transport;
  const proxyPaths = [join(root, 'mcp/server/stdio-proxy.mjs')];
  return transport?.type === 'stdio' && transport.args?.length === 1 && proxyPaths.includes(transport.args[0]) &&
    /(^|\/)node$/.test(transport.command || '') && !Object.keys(transport.env || {}).length &&
    !transport.env_vars?.length && !transport.cwd && entry.enabled !== false &&
    !entry.enabled_tools && !entry.disabled_tools && !entry.startup_timeout_sec && !entry.tool_timeout_sec;
}

export async function installPlugin({ cli = 'codex', run = commandRunner(cli), root = ROOT, nodePath = process.execPath } = {}) {
  clientConfig(nodePath);
  await syncPluginRuntime(root);
  const built = await buildPlugin({ root, nodePath });
  const entries = run(['mcp', 'list', '--json']);
  const currentPlugin = run(['plugin', 'list', '--json']).installed.find(entry => entry.pluginId === `${PLUGIN}@${PLUGIN}` && entry.enabled);
  let old = entries.some(entry => entry.name === 'jumpstart') ? run(['mcp', 'get', 'jumpstart', '--json']) : null;
  if (old && currentPlugin && (old.transport?.args?.[0] === '${PLUGIN_ROOT}/server/stdio-proxy.mjs' || old.transport?.args?.[0] === 'server/stdio-proxy.mjs') && old.transport.cwd?.includes(`/plugins/cache/${PLUGIN}/${PLUGIN}/${currentPlugin.version}`)) old = null;
  if (old && !managedRegistration(old, root)) throw new Error('A custom jumpstart MCP registration exists. Preserve its settings and remove it explicitly before installing the plugin. No configuration was changed.');
  const marketplaces = run(['plugin', 'marketplace', 'list', '--json']).marketplaces;
  const existing = marketplaces.find(entry => entry.name === built.marketplace);
  if (existing && resolve(existing.root) !== resolve(built.root)) throw new Error(`Marketplace ${built.marketplace} already points elsewhere: ${existing.root}. No registration was replaced.`);
  if (!existing) run(['plugin', 'marketplace', 'add', built.root, '--json']);
  const id = `${PLUGIN}@${built.marketplace}`;
  run(['plugin', 'add', id, '--json']);
  const installed = run(['plugin', 'list', '--json']).installed.find(entry => entry.pluginId === id);
  if (!installed?.installed || !installed.enabled || installed.version !== built.version) throw new Error('Plugin installation could not be verified. The old MCP registration was retained.');
  if (old) run(['mcp', 'remove', 'jumpstart']);
  return { id, version: built.version, migrated: Boolean(old) };
}

function commandRunner(cli) {
  return args => {
    const result = spawnSync(cli, args, { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${cli} ${args.slice(0, 3).join(' ')} failed: ${result.stderr.trim()}`);
    return args.includes('--json') ? JSON.parse(result.stdout) : result.stdout;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await installPlugin({ cli: process.argv[2] || 'codex' });
    console.log(`Installed ${result.id} (${result.version}) with MCP and the 3d-model skill.`);
    console.log('Run make up and keep http://localhost:3210/?mcp=1 open. Restart Codex or start a new chat to load the plugin.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
