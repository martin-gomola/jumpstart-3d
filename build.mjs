// Build the browser app consumed by the local MCP server.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, statSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { renderToolCss } from "./mcp/tokens/render-tool-css.mjs";
import { AI_STATUS_CSS } from "./mcp/browser/ui/ai-status.js";
import { buildRevision } from "./build-revision.mjs";
import { PRODUCT_NAME, STUDIO_VERSION, EDITOR_VERSION } from "./src/product-info.js";
import { reactBuildOptions } from "./react-build.mjs";

const root = new URL(".", import.meta.url).pathname;
const src = join(root, "src");
const tp = join(root, "third_party");
const site = join(root, "build", "site");
const productInfo = { name: PRODUCT_NAME, version: STUDIO_VERSION, editorVersion: EDITOR_VERSION, build: buildRevision(root) };
const versionLabel = `Studio ${STUDIO_VERSION} · Editor ${EDITOR_VERSION} · Build ${productInfo.build}`;

const alias = {
  replicad: join(tp, "replicad/src/index.ts"),
  "replicad/shape-functions": join(tp, "replicad/src/shapeFunctions/index.ts"),
  "opentype.js": join(tp, "opentype.js/dist/opentype.module.js"),
  flatbush: join(tp, "flatbush/index.js"),
  flatqueue: join(tp, "flatqueue/index.js"),
  "manifold-3d": join(tp, "manifold-3d/index.js"),
  "replicad-opencascadejs": join(tp, "replicad-opencascadejs/dist/replicad_single.js"),
  three: join(tp, "three/build/three.module.js"),
};
const react = reactBuildOptions(root);
const common = { define: { __JUMPSTART_BUILD_REVISION__: JSON.stringify(productInfo.build) }, bundle: true, minify: true, legalComments: "eof", target: "es2020", alias: { ...alias, ...react.alias }, jsx: react.jsx, logLevel: "warning" };
const wasm = join(src, "occt-gz.wasm");
const wasmSize = statSync(wasm).size;

rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });
// Compile the CAM worker from reviewed source; do not ship an opaque upstream bundle.
const camWorker = await build({ ...common, entryPoints: [join(src, "camworker.js")], format: "iife", write: false });
await build({ ...common, entryPoints: [join(src, "app.js")], format: "esm", outfile: join(site, "app.js"),
  plugins: [{ name: "cam-worker-source", setup(builder) {
    builder.onResolve({ filter: /^jumpstart:camworker$/ }, () => ({ path: "camworker", namespace: "cam-worker" }));
    builder.onLoad({ filter: /.*/, namespace: "cam-worker" }, () => ({ contents: camWorker.outputFiles[0].text, loader: "text" }));
  } }],
  loader: { ".html": "text" }, define: { ...common.define, __WASM_PARTS__: JSON.stringify([{ url: "occt-gz.wasm", gz: true, size: wasmSize }]) } });
await build({ ...common, entryPoints: [join(src, "worker.js")], format: "esm", outfile: join(site, "worker.js"), external: ["node:*"] });

const shell = `<html lang="en">\n${readFileSync(join(src, "index.html"), "utf8").replaceAll("__JUMPSTART_PRODUCT_NAME__", PRODUCT_NAME).replaceAll("__JUMPSTART_VERSION_LABEL__", versionLabel).replace("<style>", () => `<style>\n${AI_STATUS_CSS}\n${readFileSync(join(root, "mcp/browser/ui/templates.css"), "utf8")}`).replace("</style>", () => `\n${renderToolCss(readFileSync(join(src, "tool-ui.css"), "utf8"))}\n</style>`)}\n</html>`;
if (!shell.includes('<script type="module" src="app.js"></script>\n')) throw new Error("src/index.html is missing the app.js script tag");
writeFileSync(join(site, "index.html"), shell);
writeFileSync(join(site, "version.json"), JSON.stringify(productInfo, null, 2) + "\n");
cpSync(wasm, join(site, "occt-gz.wasm"));
cpSync(join(src, "assets/drawer-measurement.png"), join(site, "drawer-measurement.png"));
// Share pages use the same React and theme tokens but ship as HTML, without a client bundle.
const shareBuild = await build({ ...common, entryPoints: [join(root, "mcp/browser/ui/ar-share-page.jsx")],
  platform: "node", format: "esm", write: false,
  alias: { ...common.alias, "react-dom/server": join(tp, "react-dom/cjs/react-dom-server-legacy.browser.production.js") } });
const { renderArSharePage } = await import("data:text/javascript;base64," + Buffer.from(shareBuild.outputFiles[0].contents).toString("base64"));
const editorCss = readFileSync(join(src, "index.html"), "utf8");
const light = editorCss.match(/:root\s*\{([^}]+)\}/)[1];
const dark = editorCss.match(/:root\[data-ui="dark"\]\s*\{([^}]+)\}/)[1];
const themeCss = `:root{${light}}@media(prefers-color-scheme:dark){:root{${dark}}}`;
for (const expired of [false, true]) writeFileSync(join(site, expired ? "ar-expired.html" : "ar-share.html"), renderArSharePage({ themeCss, expired }));


const mb = (n) => (n / 1048576).toFixed(2) + " MB";
console.log("build/site/app.js:", mb(statSync(join(site, "app.js")).size), " build/site/worker.js:", mb(statSync(join(site, "worker.js")).size), " build/site/occt-gz.wasm:", mb(wasmSize));
