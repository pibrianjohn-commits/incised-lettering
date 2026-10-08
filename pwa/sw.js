// The offline worker. The build fills in VERSION and FILES (vite.config.ts).
//
// It keeps a copy of every file of one version of the app, so the app opens
// and works with no internet connection. The page, its scripts and the 3D
// worker must always come from the same version: GitHub Pages deletes the old
// version's files as soon as a new one is published, and lets the browser
// keep any file for 10 minutes, so a page of one version asking for its files
// after another has been published may find them gone (BRIEF.md, Decisions:
// "The offline copy"). So:
//
//  - The copy is fetched fresh from the server, never from the browser's own
//    store of files, and is kept only if its page names this version's files.
//    Otherwise (the server part-way through publishing) the copy already
//    working carries on, and the browser tries again next time.
//  - When online, the page is always checked with the server, so a new version
//    opens as soon as it is published. This version's own page is used only
//    when the network is missing or too slow, with this version's files.
//  - A file in assets/ has a mark of its contents in its name, so it is the
//    same whichever copy holds it. Any other file (the page, the fonts, the
//    icons) comes only from this version's copy.
//  - On taking over, older copies are cleared out, keeping the one before (a
//    window may still be open on it). Copies made before these rules (8 Oct
//    2026) may hold another version's page, so they all go, and any window
//    open at the time is opened again, on this version.

const VERSION = '__VERSION__';
const FILES = __FILES__;
const PREFIX = 'incised-lettering-';
/** Copies made under these rules; any other copy starting with PREFIX was made before them. */
const COPY = PREFIX + 'copy-';
const CACHE = COPY + VERSION;
const ASSETS = new URL('./assets/', self.location).pathname;

/** The page must name this version's files (in assets/) and no others. */
function checkPage(html) {
  const named = [...html.matchAll(/\b(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => `./${m[1]}`);
  const strange = named.filter((f) => !FILES.includes(f));
  if (!named.length || strange.length) throw new Error(`the page on the server is not this version's (${strange.join(', ') || 'it names no files'})`);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const got = await Promise.all(
          FILES.map(async (f) => {
            const res = await fetch(new Request(f, { cache: 'reload' }));
            if (!res.ok) throw new Error(`${f}: ${res.status}`);
            return [f, res];
          }),
        );
        for (const [f, res] of got) if (f === './' || f === './index.html') checkPage(await res.clone().text());
        const cache = await caches.open(CACHE);
        await Promise.all(got.map(([f, res]) => cache.put(f, res)));
      } catch (err) {
        await caches.delete(CACHE);
        throw err;
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX) && n !== CACHE);
      const before = names.filter((n) => !n.startsWith(COPY));
      // The newest other copy stays, for a window still open on it. A copy's
      // page was fetched fresh when it was made, so its date says when that was.
      const dated = await Promise.all(
        names
          .filter((n) => n.startsWith(COPY))
          .map(async (n) => {
            const res = await (await caches.open(n)).match('./index.html');
            return { n, t: res ? Date.parse(res.headers.get('date') || '') || 0 : 0 };
          }),
      );
      dated.sort((a, b) => b.t - a.t);
      for (const n of [...before, ...dated.slice(1).map((d) => d.n)]) await caches.delete(n);
      await self.clients.claim();
      if (before.length) {
        for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url).catch(() => {});
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(req.mode === 'navigate' ? page(req) : file(req, url));
});

/** The page: fresh from the server (asking whether it has changed) if it comes within a few seconds, else this version's own. */
async function page(req) {
  const own = async () => (await caches.open(CACHE)).match('./index.html');
  try {
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000)),
    ]);
    return res.ok || res.type === 'opaqueredirect' ? res : (await own()) || res;
  } catch {
    return (await own()) || Response.error();
  }
}

/**
 * Any other file: this version's copy, or for a file in assets/ any copy that
 * has it, else the server. Asked for fresh (the page does when a file fails
 * to load), the server first.
 */
async function file(req, url) {
  const kept = async () =>
    (await (await caches.open(CACHE)).match(req)) || (url.pathname.startsWith(ASSETS) ? await caches.match(req) : undefined);
  if (req.cache === 'reload' || req.cache === 'no-cache' || req.cache === 'no-store') {
    try {
      const res = await fetch(req);
      return res.ok ? res : (await kept()) || res;
    } catch {
      return (await kept()) || Response.error();
    }
  }
  return (await kept()) || fetch(req);
}
