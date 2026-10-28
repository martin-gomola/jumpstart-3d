import "./build-ai-panel-harness.mjs";
import "./build-tool-ui-harness.mjs";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
const kit = resolve(process.env.CODEX_HOME || `${homedir()}/.codex`, "scripts");
const output = "exports/editor-v274/gates", harness = "exports/editor-v274/harness/choices.html";
await mkdir(output, { recursive: true });
const files = ["src/arch.js", "src/cam.js", "src/cosforge.js", "src/voxel.js", "src/carve.js", "src/tool-choice.js", "src/tool-window.js", "src/tool-ui.css"];
const jobs = [
  ["tokens", "python3", [`${kit}/validate_tokens.py`, "mcp/tokens/ai-status.json"]],
  ["contrast", "python3", [`${kit}/validate_contrast.py`, "exports/ai-panel/theme-contrast.json"]],
  ["hardcodes", "python3", [`${kit}/lint_hardcodes.py`, ...files]],
  ["emoji", "python3", [`${kit}/check_no_emoji.py`, ...files]],
  ["native-select", "python3", [`${kit}/lint_native_select.py`, ...files]],
  ["component-states", process.execPath, ["mcp/tests/tool-choice-states.mjs"]],
  ...["axe_audit", "verify_responsive", "verify_keyboard", "verify_target_size", "verify_mobile_first", "verify_overflow", "verify_reduced_motion", "lint_intent", "slop_tells"].map(gate => [gate, process.execPath, ["--import=./exports/ai-panel/resolve-gate-deps.mjs", `${kit}/${gate}.mjs`, harness, ...(gate === "verify_responsive" ? ["--scale=1.25"] : gate === "slop_tells" ? ["--strict"] : [])]]),
];
const results = [];
for (const [name, command, args] of jobs) {
  const result = await new Promise(resolve => {
    const p = spawn(command, args, { env: { ...process.env, DS_REQUIRE_BROWSER: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; p.stdout.on("data", s => output += s); p.stderr.on("data", s => output += s);
    p.on("error", e => output += e.message); p.on("close", code => resolve({ name, command: [command, ...args], code, output }));
  });
  result.pass = result.code === 0 && !result.output.includes("SKIPPED");
  await writeFile(`${output}/${name}.log`, result.output); results.push(result);
  console.log(`${result.pass ? "PASS" : "FAIL"} ${name}`); if (!result.pass) console.log(result.output);
}
await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
console.log(`${results.filter(r => r.pass).length}/${results.length} tool-control gate runs passed. These cover shared controls; full tool interactions are covered by editor-v274.browser.mjs.`);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
