import "./build-ai-panel-harness.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const kit = resolve(process.env.CODEX_HOME || `${homedir()}/.codex`, "scripts");
const output = resolve("exports/ai-panel"), harness = `${output}/harness`;
await mkdir(`${output}/gates`, { recursive: true });
const views = ["drawer", "layout", "part", "settings", "connection"];
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const view of views) {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(`${harness}/${view}.html`).href);
    await page.waitForFunction(() => document.body.dataset.uiReady === "true");
    assert(await page.getByRole("dialog").isVisible(), `${view}: panel did not render`);
    assert(await page.getByRole("button").count() > 0, `${view}: no controls rendered`);
    assert.deepEqual(errors, [], `${view}: panel startup errors`);
    await page.close();
  }
} finally { await browser.close(); }
console.log(`Verified ${views.length} production panel harnesses start without page errors.`);
const node = (name, args) => [process.execPath, [`--import=${output}/resolve-gate-deps.mjs`, `${kit}/${name}.mjs`, ...args]];
const python = (name, args) => ["python3", [`${kit}/${name}.py`, ...args]];
const jobs = [
  ["tokens", python("validate_tokens", ["mcp/tokens/ai-status.json"])],
  ["contrast", python("validate_contrast", [`${output}/theme-contrast.json`])],
  ["hardcodes", python("lint_hardcodes", ["mcp/browser/templates.css", "mcp/browser/ai-status.js", "mcp/browser/template-panel.js", "mcp/browser/drawer-panel.js", "mcp/browser/dimension-guide.js"])],
  ["emoji", python("check_no_emoji", ["mcp/browser"])],
  ["native-select", python("lint_native_select", [`${output}/panel-markup.html`])],
  ...views.flatMap(view => [false, true].flatMap(dark => ["verify_states", "axe_audit"].map(gate => [`${gate}-${view}${dark ? "-dark" : ""}`, node(gate, [`${harness}/${view}.html`, ...(dark ? ["--dark"] : [])])]))),
  ["responsive", node("verify_responsive", [harness, "--scale=1.25"])],
  ...["verify_keyboard", "verify_target_size", "verify_mobile_first", "verify_overflow", "verify_reduced_motion"].map(gate => [gate, node(gate, [harness])]),
  ["intent", node("lint_intent", [harness])],
  ["intent-dark", node("lint_intent", [harness, "--dark"])],
  ["slop", node("slop_tells", [...views.map(view => `${harness}/${view}.html`), "--strict"])],
];
const results = [];
async function worker() {
  while (jobs.length) {
    const [label, [command, args]] = jobs.shift();
    const result = await new Promise(resolve => {
      const child = spawn(command, args, { env: { ...process.env, DS_REQUIRE_BROWSER: "1" }, stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      child.stdout.on("data", chunk => { text += chunk; }); child.stderr.on("data", chunk => { text += chunk; });
      child.on("error", error => { text += error.message; });
      child.on("close", code => resolve({ label, command: [command, ...args], code, text }));
    });
    await writeFile(`${output}/gates/${label}.log`, result.text);
    results.push(result);
    console.log(`${result.code === 0 && !result.text.includes("SKIPPED") ? "PASS" : "FAIL"} ${label}`);
    if (result.code !== 0 || result.text.includes("SKIPPED")) console.log(result.text);
  }
}
await Promise.all([worker(), worker(), worker()]);
await writeFile(`${output}/gate-results.json`, JSON.stringify(results, null, 2));
const failures = results.filter(result => result.code !== 0 || result.text.includes("SKIPPED"));
console.log(`${results.length - failures.length}/${results.length} UI gate runs passed. Logs: ${output}/gates`);
process.exitCode = failures.length ? 1 : 0;
