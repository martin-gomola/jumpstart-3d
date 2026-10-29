import { readFile } from 'node:fs/promises';
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
    async function page(expired) {
      try {
        const html = await readFile(new URL(`../../build/site/${expired ? 'ar-expired' : 'ar-share'}.html`, import.meta.url), 'utf8');
        return send(expired ? 404 : 200, 'text/html; charset=utf-8', html.replaceAll('__AR_BASE__', `/ar/${match?.[1] || ''}`));
      } catch { return send(503, 'text/plain', 'The sharing page is unavailable. Rebuild JumpStart and try again.'); }
    }
    if (!share) return page(true);
    if (match[2] === '/model.usdz') return send(200, 'model/vnd.usdz+zip', share.bytes);
    if (match[2] === '/poster.svg') return send(200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.7" stroke-linejoin="round"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg>');
    return page(false);
  };
}
