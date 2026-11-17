/* Release Radar service worker: faster repeat visits and basic offline use.
 *  - TMDB posters/backdrops: cache-first (they never change for a given path), capped.
 *  - Fonts and CDN libraries: stale-while-revalidate.
 *  - The app's own files: stale-while-revalidate in production; network-first on localhost so
 *    dev edits always show immediately.
 *  - API calls (api.themoviedb.org), /config.json and YouTube are never touched here: the app's own
 *    cache handles the API, and the key/trailers must stay live. */
const SHELL = 'rr-shell-v1', IMGS = 'rr-img-v1', LIBS = 'rr-lib-v1', MAX_IMGS = 400;
const isDev = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (![SHELL, IMGS, LIBS].includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));

// Re-request cross-origin assets with CORS so the cached copy is a normal (not "opaque") response:
// opaque entries are padded by the browser and eat storage quota.
const corsFetch = (req) => fetch(req.url, { mode: 'cors', credentials: 'omit' });

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}
async function cacheFirst(req, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try { const res = await corsFetch(req); if (res.ok) { cache.put(req.url, res.clone()); if (max) trim(cache, max); } return res; }
  catch { return fetch(req); }
}
async function staleWhileRevalidate(req, name, cors) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const net = (cors ? corsFetch(req) : fetch(req)).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
  catch { const hit = await cache.match(req); if (hit) return hit; throw new Error('offline'); }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.pathname.endsWith('/config.json') || u.pathname === '/sw.js') return;
  if (u.hostname === 'image.tmdb.org') return e.respondWith(cacheFirst(req, IMGS, MAX_IMGS));
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com' || u.hostname === 'cdn.jsdelivr.net') return e.respondWith(staleWhileRevalidate(req, LIBS, true));
  if (u.origin === self.location.origin) return e.respondWith(isDev ? networkFirst(req) : staleWhileRevalidate(req, SHELL, false));
});
