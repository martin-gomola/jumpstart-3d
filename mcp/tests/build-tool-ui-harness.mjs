import { readFile, writeFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { renderToolCss } from "../tokens/render-tool-css.mjs";
import { AI_STATUS_CSS } from "../browser/ai-status.js";
const output = "exports/editor-v274/harness";
await mkdir(output, { recursive: true });
const source = await readFile("src/index.html", "utf8");
const styles = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const toolStyles = renderToolCss(await readFile("src/tool-ui.css", "utf8"));
const entry = `import { el } from './src/util.js';
const main = document.querySelector('main');
for (const [name, extra] of [['Material', {}], ['Printer', { disabled: true }], ['Tool library', {'aria-busy':'true'}], ['Missing choice', {'aria-invalid':'true', 'aria-describedby':'choice-error'}]]) {
 const field = el('div', {class:'fixture-field'}, el('span', {}, name), el('tool-choice', {'aria-label':name, ...extra}, el('option',{value:'one'},'First option'), el('option',{value:'two'},'Second option'), el('option',{value:'three'},'Third option')));
 main.append(field);
}
main.append(el('p', {id:'choice-error'}, 'Choose a supported option before continuing.'));
new MutationObserver(() => { document.documentElement.dataset.ui = document.documentElement.dataset.theme; }).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
document.body.dataset.uiReady='true';`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd() }, bundle: true, format: "iife", write: false, logLevel: "silent" });
await writeFile(`${output}/choices.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Editor tool choices</title><style>${styles}\n${AI_STATUS_CSS}\n${toolStyles}\nbody {overflow:auto;background:var(--panel);color:var(--ink);}main {display:grid;gap:var(--ai-status-panelGap);padding:var(--ai-status-panelPadding);width:100%;max-width:var(--ai-status-toolSize560);box-sizing:border-box;}h1{font:600 var(--ai-status-toolSize28)/1.2 var(--f-label);margin:0}.fixture-field{display:grid;gap:var(--ai-status-gap);min-width:0}tool-choice{width:100%}</style></head><body><main><h1>Tool choices</h1></main><script>${bundle.outputFiles[0].text}</script></body></html>`);
console.log(`Production choice-control harness: ${output}/choices.html`);
