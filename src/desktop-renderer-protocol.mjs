import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { DESKTOP_RENDERER_ORIGIN, DESKTOP_RENDERER_SCHEME } from '../bridge-runtime/src/desktop-origin.mjs';

const ASSETS = new Map([
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/renderer-desktop.mjs', ['renderer-desktop.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const MAX_ASSET_BYTES = 512 * 1024;

// Must run before app.whenReady(): Chromium needs a non-opaque ancestor origin.
// In particular, do not opt into bypassCSP or arbitrary file/network access.
export function registerDesktopRendererScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: DESKTOP_RENDERER_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

export async function installDesktopRendererProtocol({ protocol, rendererRoot }) {
  const root = await realpath(rendererRoot);
  await protocol.handle(DESKTOP_RENDERER_SCHEME, async request => {
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
    const missing = () => new Response('Not Found', { status: 404, headers });
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
    }
    let url;
    try { url = new URL(request.url); } catch { return missing(); }
    const asset = ASSETS.get(url.pathname);
    if (!asset || url.href !== `${DESKTOP_RENDERER_ORIGIN}/${asset[0]}` || url.search || url.hash) return missing();
    try {
      const file = await realpath(path.join(root, asset[0]));
      const relative = path.relative(root, file);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return missing();
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_ASSET_BYTES) return missing();
      const bytes = request.method === 'HEAD' ? null : await readFile(file);
      if (bytes && bytes.length > MAX_ASSET_BYTES) return missing();
      return new Response(bytes, { headers: { ...headers, 'Content-Type': asset[1], 'Content-Length': String(info.size) } });
    } catch { return missing(); }
  });
}
