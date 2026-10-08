// A stand-in for GitHub Pages, for the browser tests: it serves one published
// version of the site under /incised-lettering/, as GitHub Pages does. As
// there, publishing a version deletes the files of the one before, and every
// file may be kept by the browser for 10 minutes (Cache-Control: max-age=600),
// with ETag answers to "has it changed?". It can also be taken offline.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const BASE = '/incised-lettering/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export async function pagesServer() {
  const site = mkdtempSync(join(tmpdir(), 'pages-'));
  let offline = false;
  let missing = new Set();
  const server = createServer((req, res) => {
    if (offline) return req.socket.destroy(); // as with no internet: no answer at all
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith(BASE)) return res.writeHead(404).end();
    let rel = u.pathname.slice(BASE.length).split('/').filter((s) => s && s !== '..').join('/');
    if (!rel || u.pathname.endsWith('/')) rel = rel ? `${rel}/index.html` : 'index.html';
    const file = join(site, rel);
    if (missing.has(rel) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404, { 'Content-Type': 'text/html' }).end('<h1>404</h1>');
    const body = readFileSync(file);
    const etag = `"${createHash('md5').update(body).digest('hex')}"`;
    const head = { 'Cache-Control': 'max-age=600', ETag: etag, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };
    if (req.headers['if-none-match'] === etag) return res.writeHead(304, head).end();
    res.writeHead(200, head).end(body);
  });
  await new Promise((r) => server.listen(0, r));
  return {
    url: `http://localhost:${server.address().port}${BASE}`,
    /** Publish a built site (a dist folder): the last one's files are gone. `without`: files left out, as if lost. */
    publish(dir, without = []) {
      rmSync(site, { recursive: true, force: true });
      mkdirSync(site, { recursive: true });
      cpSync(dir, site, { recursive: true });
      missing = new Set(without);
    },
    set offline(v) {
      offline = v;
    },
    close() {
      server.close();
      server.closeAllConnections?.();
      rmSync(site, { recursive: true, force: true });
    },
  };
}
