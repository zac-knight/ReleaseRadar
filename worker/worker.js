// Release Radar: TMDB proxy for Cloudflare Workers.
// The browser calls this Worker with NO key; the Worker adds the secret key and forwards to TMDB.
//   secret   TMDB_API_KEY       (wrangler secret put TMDB_API_KEY)
//   var      ALLOWED_ORIGINS    comma-separated site origins allowed to call this (wrangler.toml)
//
// The address is public, so it is hardened against misuse (it can never *reveal* the key):
//   1. GET only, and only the exact TMDB endpoints and parameters this app uses
//   2. size caps (page <= 10, short queries) and unknown parameters are rejected
//   3. responses are cached at the edge on a NORMALISED url, so varying/adding parameters can't dodge it
//   4. a per-visitor limit on requests that actually reach TMDB (cache hits are free and unlimited)
//   5. an origin allowlist (a deterrent only: non-browser clients can fake the header)

const PATHS = [
  [/^\/3\/discover\/(movie|tv)$/, 3 * 3600],
  [/^\/3\/search\/multi$/, 3600],
  [/^\/3\/search\/keyword$/, 24 * 3600],
  [/^\/3\/genre\/(movie|tv)\/list$/, 24 * 3600],
  [/^\/3\/watch\/providers\/(movie|tv)$/, 24 * 3600],
  [/^\/3\/(movie|tv)\/\d{1,9}$/, 24 * 3600],
];
const PARAMS = new Set(['language', 'region', 'page', 'sort_by', 'include_adult', 'query', 'append_to_response', 'include_image_language',
  'watch_region', 'with_networks', 'with_release_type', 'with_watch_monetization_types', 'with_watch_providers', 'with_keywords',
  'release_date.gte', 'release_date.lte', 'primary_release_date.lte', 'first_air_date.gte', 'first_air_date.lte', 'air_date.gte', 'air_date.lte']);
const MAX_VALUE = 160;          // longest accepted parameter value
const MAX_PAGE = 10;
const MISSES_PER_MIN = 500;     // requests per visitor per minute that go on to TMDB (a first load is a few hundred)

const bad = (msg, status, cors) => new Response(msg, { status, headers: cors });

/** Per-visitor counter for requests that miss the cache (Cache API: per-location and best-effort, which is plenty here). */
async function overLimit(ip) {
  const cache = caches.default;
  const key = new Request(`https://limit.internal/${encodeURIComponent(ip)}/${Math.floor(Date.now() / 60000)}`);
  const hit = await cache.match(key);
  const n = hit ? Number(await hit.text()) || 0 : 0;
  if (n >= MISSES_PER_MIN) return true;
  await cache.put(key, new Response(String(n + 1), { headers: { 'Cache-Control': 'max-age=90' } }));
  return false;
}

export default {
  async fetch(req, env, ctx) {
    const origins = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': origins.includes(origin) ? origin : (origins[0] || ''), Vary: 'Origin' };

    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (req.method !== 'GET') return bad('Method not allowed', 405, cors);
    if (origin && !origins.includes(origin)) return bad('Origin not allowed', 403, cors);

    const url = new URL(req.url);
    const route = PATHS.find(([re]) => re.test(url.pathname));
    if (!route) return bad('Path not allowed', 403, cors);
    if (!env.TMDB_API_KEY) return bad('Proxy is missing its TMDB_API_KEY secret', 500, cors);

    // validate and normalise the parameters (sorted, known names only, bounded values)
    const clean = [];
    for (const [k, v] of url.searchParams) {
      if (k === 'api_key') continue;                       // never trust a caller-supplied key
      if (!PARAMS.has(k) || v.length > MAX_VALUE) return bad(`Parameter not allowed: ${k}`, 400, cors);
      if (k === 'page' && !(Number(v) >= 1 && Number(v) <= MAX_PAGE)) return bad('page out of range', 400, cors);
      if (k === 'append_to_response' && !/^[a-z_/,]+$/.test(v)) return bad('bad append_to_response', 400, cors);
      clean.push([k, v]);
    }
    clean.sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
    const publicUrl = new URL(url.origin + url.pathname);
    clean.forEach(([k, v]) => publicUrl.searchParams.append(k, v));

    // 1. the shared edge cache (the public url contains no secret)
    const cache = caches.default;
    const cacheKey = new Request(publicUrl.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) { const r = new Response(hit.body, hit); Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v)); return r; }

    // 2. a miss costs us a TMDB call, so that's what is rate limited
    if (await overLimit(req.headers.get('CF-Connecting-IP') || 'unknown')) return bad('Too many requests, slow down', 429, { ...cors, 'Retry-After': '60' });

    const target = new URL('https://api.themoviedb.org' + url.pathname);
    clean.forEach(([k, v]) => target.searchParams.append(k, v));
    // Either kind of TMDB credential works: the short v3 API key (query parameter) or the long v4
    // "Read Access Token" that starts with eyJ (Bearer header).
    const headers = { accept: 'application/json' };
    if (env.TMDB_API_KEY.startsWith('eyJ')) headers.authorization = `Bearer ${env.TMDB_API_KEY}`;
    else target.searchParams.set('api_key', env.TMDB_API_KEY);

    const res = await fetch(target.toString(), { headers });
    const out = new Response(res.body, { status: res.status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${route[1]}` } });
    if (res.ok) ctx.waitUntil(cache.put(cacheKey, out.clone()));
    return out;
  },
};
