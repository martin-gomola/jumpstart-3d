import { renderToStaticMarkup } from 'react-dom/server';
import { PRODUCT_NAME } from '../../../src/product-info.js';
import tokens from '../../tokens/ai-status.json';

const css = `
*{box-sizing:border-box}body{margin:0;background:var(--panel);color:var(--ink);font:1rem/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-text-size-adjust:100%}
main{width:100%;max-width:26rem;margin:auto;padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));text-align:center}
.brand{display:flex;align-items:center;justify-content:center;gap:8px;margin:8px 0 28px;font-size:1rem;font-weight:650}.brand svg{width:24px;height:24px;color:var(--accent)}
h1{margin:0;font-size:2rem;line-height:1.1;letter-spacing:-.025em;font-weight:700}.intro{margin:14px 0 24px;color:var(--ink-2);font-size:1.0625rem;line-height:1.45}
figure{margin:0}.illustration{display:block;width:100%;height:clamp(10rem,26vh,13rem);background:var(--paper);border-radius:20px;color:var(--accent)}
figcaption{margin-top:10px;color:var(--ink-2);font-size:.875rem}.primary{display:flex;align-items:center;justify-content:center;gap:10px;min-height:56px;margin-top:22px;padding:14px 18px;background:var(--accent);color:var(--on-accent);border-radius:12px;font-size:1.0625rem;font-weight:600;text-decoration:none}
.primary img{width:24px;height:24px;flex:none}.instruction{margin:14px 0 10px;color:var(--ink-2);font-size:.9375rem}.download{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px;color:var(--accent);font-size:.9375rem;text-underline-offset:3px}.expiry{margin:18px 0 0;color:var(--ink-2);font-size:.8125rem}
a:focus-visible{outline:3px solid var(--focus);outline-offset:4px}
@media(hover:hover){.primary:hover{background:var(--accent-2)}}
@media(prefers-reduced-motion:no-preference){.primary{transition:transform ${tokens.pressDuration.$value} ease-out}.primary:active{transform:scale(${tokens.pressScale.$value})}}
@media(prefers-color-scheme:dark){.primary img{filter:invert(1)}}
@media(forced-colors:active){.primary{border:2px solid ButtonText}.primary img{forced-color-adjust:none}}
`;

function Cube() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10" /></svg>;
}
function Illustration({ expired }) {
  return <svg className="illustration" viewBox="0 0 340 208" fill="none" aria-hidden="true">
    <path d="M36 58V38a6 6 0 0 1 6-6h20m216 0h20a6 6 0 0 1 6 6v20M36 150v20a6 6 0 0 0 6 6h20m216 0h20a6 6 0 0 0 6-6v-20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <ellipse cx="170" cy="151" rx="86" ry="15" fill="currentColor" opacity=".06" />
    {expired ? <g stroke="currentColor" strokeWidth="3" strokeLinecap="round"><circle cx="170" cy="104" r="40" /><path d="M170 80v26l17 10" /></g> : <g stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"><path d="m170 57 49 22v58l-49 23-49-23V79z" /><path d="m121 79 49 23 49-23M170 102v58" /></g>}
  </svg>;
}

// Rendered during the build: the phone receives ordinary HTML and needs no JavaScript.
export function renderArSharePage({ themeCss, expired = false }) {
  const base = '__AR_BASE__';
  return '<!doctype html>' + renderToStaticMarkup(<html lang="en"><head>
    <meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>{expired ? 'Link expired' : 'View in AR'} · {PRODUCT_NAME}</title><style>{themeCss + css}</style>
  </head><body><main>
    <header className="brand"><Cube /><span>{PRODUCT_NAME}</span></header>
    <h1>{expired ? 'This link has expired' : <>See it in your<br />space</>}</h1>
    <p className="intro">{expired ? 'Create a new QR code in JumpStart, then scan it again.' : 'Place your model on a table or the floor.'}</p>
    <figure><Illustration expired={expired} /><figcaption>{expired ? 'Temporary model share' : 'Actual size · AR preview'}</figcaption></figure>
    {!expired && <>
      <a className="primary" rel="ar" href={base + '/model.usdz#allowsContentScaling=0'}><img src={base + '/poster.svg'} width="24" height="24" alt="" /><span>View in your room</span></a>
      <p className="instruction">Move your phone slowly to find a surface.</p>
      <a className="download" href={base + '/model.usdz'}>Download 3D model</a>
      <p className="expiry">Link expires 30 minutes after sharing.</p>
    </>}
  </main></body></html>);
}
