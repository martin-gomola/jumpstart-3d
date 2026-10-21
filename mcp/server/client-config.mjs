#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function clientConfig(nodePath = process.execPath, nodeVersion = process.versions.node) {
  if (Number(nodeVersion.split(".")[0]) < 22) throw new Error("JumpStart MCP requires host Node.js 22 or newer. The app itself can still run with Docker only.");
  return { command: nodePath, args: [fileURLToPath(new URL("./stdio-proxy.mjs", import.meta.url))] };
}
export function clientToml(config) {
  return `[mcp_servers.jumpstart]\ncommand = ${JSON.stringify(config.command)}\nargs = ${JSON.stringify(config.args)}\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = clientConfig();
    if (process.argv[2] === "install") {
      const executable = process.argv[3];
      if (!executable) throw new Error("Codex CLI path is required.");
      const result = spawnSync(executable, ["mcp", "add", "jumpstart", "--", config.command, ...config.args], { stdio: "inherit" });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
      if (!process.exitCode) process.stdout.write("JumpStart MCP registered with Codex using host Node.js.\nRun make up, then open http://localhost:3210/?mcp=1\nReconnect the MCP server in Codex, or restart Codex, to load it.\n");
    } else if (!process.argv[2] || process.argv[2] === "print") process.stdout.write(clientToml(config));
    else throw new Error("Expected print or install.");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
