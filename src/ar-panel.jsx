import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import qrcode from 'qrcode-generator';
import { arSnapshot, shareBase } from './ar-snapshot.js';
import { openToolWindow, closeToolWindow } from './tool-window.js';

function Panel({ app, store, close }) {
  const [automaticBase] = useState(() => {
    try { return shareBase(location.origin); } catch { return ''; }
  });
  const [base, setBase] = useState(automaticBase);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(null);
  async function create() {
    if (busy) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const origin = shareBase(base);
      const data = await arSnapshot({ ...app, store });
      const response = await fetch('/__mcp/ar', { method: 'POST', headers: { 'Content-Type': 'model/vnd.usdz+zip' }, body: data });
      if (!response.ok) throw new Error(response.status === 404 || response.status === 503 ? 'AR sharing needs the local JumpStart server.' : 'Could not create the AR share. Check the local server.');
      const { id } = await response.json();
      const url = `${origin}/ar/${id}`;
      const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      setResult({ url, qr: qr.createDataURL(6, 24) });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="modal ar-panel" style={{ width: 'min(440px, calc(100vw - 32px))', minWidth: 0, boxSizing: 'border-box', padding: 24, overflowY: 'auto', maxHeight: '90vh', gap: 8 }}>
    <style>{`.ar-panel p { margin: 4px 0; } .ar-panel h2 { margin: 0 0 8px; } .ar-panel input { padding: 8px; background: var(--panel); color: var(--ink); border: 1px solid var(--line-2); border-radius: 4px; }`}</style>
    <h2 id="ar-title">View in AR</h2>
    <p>Place a snapshot of your selected printable bodies, or all printable bodies, in your room with iPhone AR Quick Look.</p>
    {!automaticBase && <>
      <label htmlFor="ar-origin">Phone-accessible HTTPS address</label>
      <input id="ar-origin" type="url" placeholder="https://cad.example.com" value={base} onChange={e => setBase(e.target.value)} style={{ width: '100%' }} />
      <p className="hint">Open JumpStart through its HTTPS address, or enter an address your phone can reach.</p>
    </>}
    <p className="hint">Keep your phone on the same Wi-Fi or VPN. Links last 30 minutes and can be opened by anyone with the link and network access.</p>
    <p className="hint">This prototype preserves size and body colors. Face paints and image textures are not included.</p>
    <button className="btn primary" aria-disabled={busy} onClick={create}>{busy ? 'Creating snapshot…' : 'Create QR code'}</button>
    <div role="status" aria-live="polite">{error}{result && <><p>Scan with your iPhone camera, then tap “View in your room”.</p><img width="180" height="180" src={result.qr} alt="QR code for this AR model" /><p><a href={result.url} target="_blank" rel="noreferrer">Open AR share</a></p><p>Expires in 30 minutes, or when the server restarts.</p></>}</div>
    <button className="btn" onClick={close}>Close</button>
  </div>;
}
export function initArPanel(app, store) {
  let current;
  document.getElementById('menu-export').addEventListener('click', e => {
    if (e.target.closest('button')?.dataset.act !== 'ar' || current) return;
    const host = document.createElement('div'); host.className = 'modal-back'; host.setAttribute('role', 'dialog'); host.setAttribute('aria-labelledby', 'ar-title');
    document.body.append(host); const root = createRoot(host); current = host;
    const close = () => { closeToolWindow(host); root.unmount(); host.remove(); current = null; };
    root.render(<Panel app={app} store={store} close={close} />); openToolWindow(host, close);
  });
}
