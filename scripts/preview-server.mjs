// Design-preview server: serves the built extension (.output/chrome-mv3) and
// injects a chrome.* API mock into popup/options so the real bundles render in
// a normal browser tab. For layout/theme iteration only; run `npm run build`
// first, then `node scripts/preview-server.mjs`.
//
//   http://localhost:4173/popup.html              signed-in composer
//   http://localhost:4173/popup.html?state=login  sign-in screen
//   http://localhost:4173/options.html            settings page
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, '.output');
const port = Number(process.env.PORT ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/popup.html';

    if (pathname === '/__mock__/preview-mock.js') {
      const body = await readFile(join(root, 'scripts', 'preview-mock.js'));
      res.writeHead(200, { 'content-type': MIME['.js'] });
      res.end(body);
      return;
    }

    const file = normalize(join(dist, pathname));
    if (!file.startsWith(dist)) {
      res.writeHead(403).end();
      return;
    }

    let body = await readFile(file);
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    if (extname(file) === '.html') {
      // The mock must run before the module scripts evaluate `browser`.
      body = body
        .toString('utf8')
        .replace('<head>', '<head><script src="/__mock__/preview-mock.js"></script>');
    }
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
});

server.listen(port, () => {
  console.log(`Supersky preview: http://localhost:${port}/popup.html`);
});
