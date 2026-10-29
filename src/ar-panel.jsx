import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import qrcode from 'qrcode-generator';
import { arSnapshot, shareBase } from './ar-snapshot.js';
import { openToolWindow, closeToolWindow } from './tool-window.js';

function Panel({ app, store, close }) {
  const [automaticBase] = useState(() => {
    try { return shareBase(location.origin); } catch { return ''; }
  });
  const [base, setBase] = useState(automaticBase);
  const [canShare, setCanShare] = useState(() => document.querySelector('meta[name="jumpstart-ar-sharing"]')?.content === '1');
  const [details, setDetails] = useState(false);
  const action = useRef(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(null);
  useEffect(() => { action.current?.focus(); }, [result]);
  async function create() {
    if (busy) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const origin = shareBase(base);
      const data = await arSnapshot({ ...app, store });
      const response = await fetch('/__mcp/ar', { method: 'POST', headers: { 'Content-Type': 'model/vnd.usdz+zip' }, body: data });
      if (!response.ok) throw new Error(response.status === 404 || response.status === 503 ? 'AR sharing needs the local JumpStart server.' : 'Could not create the AR share. Check the local server.');
      let payload;
      try { payload = await response.json(); } catch { /* Static hosts and proxies can return an empty successful response. */ }
      if (typeof payload?.id !== 'string' || !/^[a-f0-9]{48}$/.test(payload.id)) {
        setCanShare(false);
        throw new Error('This address did not return an AR share. Download the model or open your server-hosted editor.');
      }
      const { id } = payload;
      const url = `${origin}/ar/${id}`;
      const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      setResult({ url, qr: qr.createDataURL(6, 24) });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function download() {
    if (busy) return;
    setBusy(true); setError('');
    try { await app.projects.saveModel('model.usdz', await arSnapshot({ ...app, store })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="modal ar-panel">
    <style>{`
      .ar-panel *{box-sizing:border-box}
      .ar-panel{width:min(420px,calc(100vw - 32px));min-width:0;box-sizing:border-box;padding:24px;max-height:90vh;max-height:90dvh;overflow:hidden;border-radius:20px;gap:0;font-family:var(--f-ui)}
      .ar-panel-heading{text-align:center;flex-shrink:0}.ar-panel-mark{display:grid;place-items:center;width:44px;height:44px;margin:0 auto 12px;border-radius:12px;background:var(--accent-soft);color:var(--accent)}.ar-panel-mark svg{width:28px;height:28px}
      .ar-panel h2{margin:0;color:var(--ink);font-size:1.5rem;line-height:1.2;font-weight:650;letter-spacing:-.02em}.ar-panel .ar-panel-intro{margin:8px 0 20px;font-size:.9375rem;line-height:1.45;color:var(--ink-2)}
      .ar-panel-content{min-height:0;overflow-y:auto;overscroll-behavior:contain}.ar-panel-qr{display:flex;justify-content:center}.ar-panel-qr-frame{display:inline-flex;padding:8px;border:1px solid var(--line);border-radius:16px;background:#fff;max-width:100%;box-sizing:border-box}.ar-panel-qr img{display:block;width:240px;max-width:100%;height:auto}
      .ar-panel .ar-panel-meta{margin:12px 0 0;text-align:center;font-size:.8125rem;line-height:1.5;color:var(--ink-2)}.ar-panel-disclosure{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:44px;margin-top:12px;padding:10px 12px;background:var(--panel-2);color:var(--ink-2);border:1px solid var(--line-2);border-radius:10px;font:inherit;font-size:.875rem;text-align:left;cursor:pointer}.ar-panel-disclosure svg{width:16px;height:16px;flex:none}.ar-panel-disclosure[aria-expanded="true"] svg{transform:rotate(180deg)}
      .ar-panel .ar-panel-details{margin:10px 4px 2px;font-size:.8125rem;line-height:1.5;color:var(--ink-2)}.ar-panel-address{display:grid;gap:8px;font-size:.875rem;color:var(--ink-2)}.ar-panel input{width:100%;min-height:44px;box-sizing:border-box;padding:10px;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:8px;font:inherit;font-size:1rem}
      .ar-panel-actions{display:grid;grid-template-columns:1fr 1.5fr;gap:10px;margin-top:20px;flex-shrink:0}.ar-panel-action{display:flex;align-items:center;justify-content:center;min-height:48px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);font:inherit;font-size:.9375rem;font-weight:600;text-align:center;text-decoration:none;cursor:pointer}.ar-panel-action.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}.ar-panel-action[aria-disabled="true"]{opacity:.65;cursor:progress}
      .ar-panel :focus-visible{outline:3px solid var(--focus);outline-offset:3px}.ar-panel-error{margin:8px 0;color:var(--danger);font-size:.875rem;line-height:1.5}.ar-panel-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
      @media(hover:hover){.ar-panel-action.primary:hover{background:var(--accent-2)}.ar-panel-disclosure:hover{border-color:var(--hover-line)}}
      @media(max-height:600px){.ar-panel{padding:16px}.ar-panel-mark{display:none}.ar-panel .ar-panel-intro{margin-bottom:12px}.ar-panel-qr img{width:200px}.ar-panel-actions{margin-top:12px}}
    `}</style>
    <div className="ar-panel-heading">
      <div className="ar-panel-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10" /></svg></div>
      <h2 id="ar-title">View in AR</h2>
      <p className="ar-panel-intro">{result ? 'Scan with your iPhone camera, then open the link.' : canShare ? 'See your model in your room, at actual size.' : 'Download your model for AR.'}</p>
    </div>
    <div className="ar-panel-content">
      {!canShare && <p className="ar-panel-details">QR sharing is unavailable on this site. Download the USDZ model to open on your iPhone, or use your server-hosted editor for QR sharing.</p>}
      {canShare && !automaticBase && !result && <div className="ar-panel-address">
        <label htmlFor="ar-origin">Phone-accessible HTTPS address</label>
        <input id="ar-origin" type="url" placeholder="https://cad.example.com" value={base} onChange={e => setBase(e.target.value)} />
        <p>Open JumpStart through its HTTPS address, or enter an address your phone can reach.</p>
      </div>}
      {result && <>
        <div className="ar-panel-qr"><div className="ar-panel-qr-frame"><img width="240" height="240" src={result.qr} alt="QR code for this AR model" /></div></div>
        <p className="ar-panel-meta">Same Wi-Fi or VPN · Expires in 30 minutes</p>
      </>}
      <div role="status" aria-live="polite" className={error ? 'ar-panel-error' : 'ar-panel-status'}>{error || (busy ? (canShare ? 'Creating snapshot…' : 'Preparing USDZ…') : result ? 'QR code ready.' : '')}</div>
      <button className="ar-panel-disclosure" aria-expanded={details} aria-controls="ar-share-details" onClick={() => setDetails(!details)}><span>Share details</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>
      <div id="ar-share-details" hidden={!details}><p className="ar-panel-details">Uses selected printable bodies, or all printable bodies if none are selected. Preserves size and body colors; face paints and image textures are not included.</p>{canShare && <p className="ar-panel-details">Anyone with the link and network access can open it. Shares expire after 30 minutes or a server restart.</p>}</div>
    </div>
    <div className="ar-panel-actions">
      <button className="ar-panel-action" onClick={close}>Close</button>
      {result ? <a ref={action} className="ar-panel-action primary" href={result.url} target="_blank" rel="noreferrer">Open AR share</a> : <button ref={action} className="ar-panel-action primary" aria-disabled={busy} onClick={canShare ? create : download}>{busy ? (canShare ? 'Creating…' : 'Preparing…') : canShare ? 'Create QR code' : 'Download USDZ'}</button>}
    </div>
  </div>;
}
export function initArPanel(app, store) {
  let current;
  document.getElementById('menu-export').addEventListener('click', e => {
    if (e.target.closest('button')?.dataset.act !== 'ar' || current) return;
    const host = document.createElement('div'); host.className = 'modal-back'; host.setAttribute('role', 'dialog'); host.setAttribute('aria-labelledby', 'ar-title');
    document.body.append(host); const root = createRoot(host); current = host;
    const close = () => { closeToolWindow(host); root.unmount(); host.remove(); current = null; document.getElementById('btn-export').focus(); };
    root.render(<Panel app={app} store={store} close={close} />); openToolWindow(host, close);
  });
}
