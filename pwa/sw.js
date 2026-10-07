// The offline worker. The build fills in VERSION and FILES (vite.config.ts).
//
// It keeps a copy of every file of the app, so the app opens and works with no
// internet connection. When online, the page itself is always fetched fresh,
// so a new version shows as soon as it is published; the copies are only used
// when the network is missing or too slow.

const VERSION = '__VERSION__';
const FILES = __FILES__;
const PREFIX = 'incised-lettering-';
const CACHE = PREFIX + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Keep this version and the one before it (a window left open on the old
      // version may still need its files); clear anything older.
      const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX) && n !== CACHE);
      const dated = await Promise.all(
        names.map(async (n) => {
          const res = await (await caches.open(n)).match('./index.html');
          return { n, t: res ? Date.parse(res.headers.get('date') || '') || 0 : 0 };
        }),
      );
      dated.sort((a, b) => b.t - a.t);
      for (const { n } of dated.slice(1)) await caches.delete(n);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // The page: fresh from the network if it comes within a few seconds, else the copy.
    event.respondWith(
      (async () => {
        const copy = async () => (await caches.match('./index.html', { cacheName: CACHE })) || (await caches.match('./index.html'));
        try {
          const res = await Promise.race([
            fetch(req),
            new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000)),
          ]);
          return res.ok ? res : (await copy()) || res;
        } catch {
          return (await copy()) || Response.error();
        }
      })(),
    );
    return;
  }

  // Everything else (scripts, styles, the font, icons): the copy if there is one, else the network.
  event.respondWith(
    (async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })(),
  );
});
