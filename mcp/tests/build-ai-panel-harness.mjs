import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { AI_STATUS_CSS } from "../browser/ai-status.js";
import { reactBuildOptions } from "../../react-build.mjs";

// The kit gates open local HTML. Bundle the production panel with a document
// fixture; actual native previews and transactions remain covered by browser tests.
const root = fileURLToPath(new URL("../..", import.meta.url));
const output = resolve(root, "exports/ai-panel");
await mkdir(`${output}/harness`, { recursive: true });
const source = await readFile(`${root}/src/index.html`, "utf8");
const styles = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const panel = source.slice(source.indexOf('  <aside id="ai-setup-panel"'), source.indexOf('  <nav class="ribbon"')).replace('data-active-tab="templates" hidden', 'data-active-tab="templates"');
const trigger = source.match(/<button id="ai-status"[\s\S]*?<\/button>/)[0].replace('aria-expanded="false"', 'aria-expanded="true"');
const panelStyles = await readFile(`${root}/mcp/browser/templates.css`, "utf8");
await writeFile(`${output}/panel-markup.html`, panel);
const entry = `
  import { initTemplatePanel } from './mcp/browser/template-panel.js';
  import { initAiSetupPanel, initAgentStatus } from './mcp/browser/ai-status.js';
  initAiSetupPanel();
  initAgentStatus()({ online: true });
  initTemplatePanel({
    request: async action => {
      if (action === 'get_document') return { revision: 0, document: { id: 'ui-gate-fixture' }, bodies: [], drawerLayouts: [] };
      throw new Error('Native model generation is exercised in the running app browser tests.');
    }, subscribe: () => {}, createPreviewView: () => { throw new Error('No native preview in this fixture.'); }
  });
  new MutationObserver(() => { document.documentElement.dataset.ui = document.documentElement.dataset.theme; }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const view = document.body.dataset.view;
  if (view === 'connection') document.getElementById('ai-connection-tab').click();
  if (view === 'orientation') {
    for (const [name, value] of [['width',230], ['depth',695], ['height',60]]) {
      const input = document.getElementById('drawer-' + name); input.value = value; input.dispatchEvent(new Event('change', {bubbles:true}));
    }
    document.getElementById('drawer-swap-dimensions').click();
  }

  if (['part','settings'].includes(view)) document.querySelector('[data-workspace-view="' + view + '"]').click();
  if (['layout', 'open-walls'].includes(view)) {
    document.querySelector('.drawer-example').click();
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Add bin').click();
  }
  if (view === 'layout') document.getElementById('drawer-bin-stackable').click();
  if (view === 'open-walls') {
    document.querySelector('.drawer-wall-options summary').click();
    document.querySelector('[aria-label="Open right side"]').click();
    document.getElementById('drawer-close-gaps').click();
    if (matchMedia('(min-width: 64rem)').matches) {
      // Keep height, stacking and the expanded edge options in the visible pane.
      const height = document.querySelector('[aria-label="Bin height"] [aria-pressed="true"]');
      height.scrollIntoView({ block: 'start', inline: 'nearest' });
      height.focus({ preventScroll: true });
    }
  }
  document.body.dataset.uiReady = "true";
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root }, bundle: true, format: "iife", write: false, logLevel: "silent", ...reactBuildOptions(root) });
for (const view of ["drawer", "layout", "part", "settings", "connection", "open-walls", "orientation"]) {
  await writeFile(`${output}/harness/${view}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gridfinity ${view} UI gate</title><style>${styles}\n${AI_STATUS_CSS}\n${panelStyles}</style></head><body data-view="${view}"><header class="topbar"><div class="modeswitch">${trigger}</div></header>${panel}<script>${bundle.outputFiles[0].text}</script></body></html>`);
}

// Translate the actual app theme values into the kit's semantic contrast schema.
const declarations = block => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-fA-F]+)\s*;/g)].map(([, key, value]) => [key, value]));
const light = declarations(styles.match(/:root\s*\{([\s\S]*?)\}/)[1]);
const dark = { ...light, ...declarations(styles.match(/:root\[data-ui="dark"\]\s*\{([\s\S]*?)\}/)[1]) };
const semantic = values => {
  const color = key => ({ $type: "color", $value: values[key] });
  return { text: { primary: color("ink"), secondary: color("ink-2"), link: color("accent"), "on-action": color("on-accent") }, surface: { page: color("panel-2"), card: color("panel"), raised: color("panel-2") }, action: { primary: color("accent") }, border: { strong: color("ink-3"), default: color("line") } };
};
await writeFile(`${output}/theme-contrast.json`, JSON.stringify({ semantic: semantic(light), dark: semantic(dark) }, null, 2));
await writeFile(`${output}/resolve-gate-deps.mjs`, `import { registerHooks } from 'node:module';\nregisterHooks({ resolve(specifier, context, next) { return next(specifier === 'playwright' ? ${JSON.stringify(import.meta.resolve("playwright"))} : specifier, context); } });\n`);
console.log(`Production UI harnesses and derived theme pairs: ${output}`);
