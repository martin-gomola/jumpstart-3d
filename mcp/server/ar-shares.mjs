import { randomBytes } from 'node:crypto';
const LIMIT = 24 * 1024 * 1024, TTL = 30 * 60 * 1000;
export function createArShares({ now = Date.now } = {}) {
  const shares = new Map();
  let uploads = 0;
  function prune() { for (const [id, share] of shares) if (share.expires <= now()) shares.delete(id); }
  return async function handle(req, res, path, allowUpload = false) {
    prune();
    const send = (status, type, data) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'" }); res.end(req.method === 'HEAD' ? undefined : data); };
    if (path === '/__mcp/ar') {
      if (!allowUpload) return send(403, 'text/plain', 'Local requests only');
      if (req.method !== 'POST') return send(405, 'text/plain', 'POST required');
      if (req.headers['content-type'] !== 'model/vnd.usdz+zip') return send(415, 'text/plain', 'USDZ required');
      if (shares.size + uploads >= 8) return send(429, 'text/plain', 'Too many active AR shares; wait for expiry');
      uploads++;
      let size = 0; const chunks = [];
      try {
        for await (const chunk of req) { size += chunk.length; if (size > LIMIT) return send(413, 'text/plain', 'Model too large'); chunks.push(chunk); }
        const bytes = Buffer.concat(chunks);
        if (size < 4 || bytes.readUInt32LE(0) !== 0x04034b50) return send(400, 'text/plain', 'Expected USDZ ZIP bytes');
        // No parsing or execution: generated assets remain opaque, temporary downloads.
        const id = randomBytes(24).toString('hex'); shares.set(id, { bytes, expires: now() + TTL });
        return send(201, 'application/json', JSON.stringify({ id }));
      } catch { return send(400, 'text/plain', 'Upload interrupted'); }
      finally { uploads--; }
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'text/plain', 'GET or HEAD required');
    const match = /^\/ar\/([a-f0-9]{48})(\/model\.usdz|\/poster\.svg)?$/.exec(path);
    const share = match && shares.get(match[1]);
    if (!share) return send(404, 'text/plain', 'AR share not found or expired. Create another QR code in JumpStart.');
    if (match[2] === '/model.usdz') return send(200, 'model/vnd.usdz+zip', share.bytes);
    if (match[2] === '/poster.svg') return send(200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#eeeeee"/><text x="160" y="105" text-anchor="middle" font-size="24">View 3D model</text></svg>');
    return send(200, 'text/html; charset=utf-8', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JumpStart AR preview</title><body style="font:18px system-ui;max-width:440px;margin:40px auto;padding:20px"><h1>View in your room</h1><p>On iPhone or iPad, tap the model and choose AR. Move the phone to find a surface.</p><a rel="ar" href="/ar/${match[1]}/model.usdz#allowsContentScaling=0"><img src="/ar/${match[1]}/poster.svg" width="320" height="200" alt="View in your room"></a><p>Original model size. This temporary snapshot expires after 30 minutes.</p><p>Other devices can <a href="/ar/${match[1]}/model.usdz">download the USDZ model</a>.</p></body></html>`);
  };
}
