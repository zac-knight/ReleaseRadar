// Thin TMDB client: auth, rate-limit-friendly concurrency, retry on 429,
// pagination, and a localStorage cache with TTLs.

const BASE = 'https://api.themoviedb.org/3';
export const IMG = 'https://image.tmdb.org/t/p/w342';
const CACHE_PREFIX = 'rr:cache3:';
const MAX_CONCURRENT = 12;

export const TTL = { search: 7 * 864e5, list: 6 * 36e5, detail: 24 * 36e5 };

let apiKey = '';
export const setApiKey = (k) => { apiKey = (k || '').trim(); };

// ---- cache ---------------------------------------------------------------
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return undefined;
    const { t, ttl, v } = JSON.parse(raw);
    if (Date.now() - t > ttl) { localStorage.removeItem(CACHE_PREFIX + key); return undefined; }
    return v;
  } catch { return undefined; }
}

function cacheSet(key, v, ttl) {
  const payload = JSON.stringify({ t: Date.now(), ttl, v });
  try { localStorage.setItem(CACHE_PREFIX + key, payload); }
  catch { // quota: evict the oldest third (not everything), then try once more
    evictOldest(1 / 3);
    try { localStorage.setItem(CACHE_PREFIX + key, payload); } catch { evictOldest(1 / 2); try { localStorage.setItem(CACHE_PREFIX + key, payload); } catch { /* give up quietly */ } }
  }
}

/** Remove the oldest `fraction` of cached responses (least-recently-fetched first). */
function evictOldest(fraction) {
  try {
    const rows = [];
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(CACHE_PREFIX)) continue;
      let t = 0; try { t = JSON.parse(localStorage.getItem(k)).t; } catch { /* corrupt: evict first */ }
      rows.push([k, t]);
    }
    rows.sort((a, b) => a[1] - b[1]).slice(0, Math.max(1, Math.ceil(rows.length * fraction))).forEach(([k]) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

export function clearCache() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('rr:cache'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// ---- concurrency pool ------------------------------------------------------
let active = 0;
const waiting = [];
async function slot() {
  if (active >= MAX_CONCURRENT) await new Promise((r) => waiting.push(r));
  active++;
}
function release() { active--; waiting.shift()?.(); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AuthError extends Error {}

async function fetchJson(path, params) {
  const url = new URL(BASE + path);
  const headers = { accept: 'application/json' };
  if (apiKey.startsWith('eyJ')) headers.authorization = `Bearer ${apiKey}`; // v4 token
  else url.searchParams.set('api_key', apiKey);
  url.searchParams.set('language', 'en-AU'); // Australian titles/synopses where TMDB has them
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 4; attempt++) {
    await slot();
    let res;
    try { res = await fetch(url, { headers }); } finally { release(); }
    if (res.status === 401) throw new AuthError('TMDB rejected the API key.');
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}`);
    return res.json();
  }
  throw new Error('TMDB rate limit: gave up after retries.');
}

/** Cached GET. In-flight requests for the same key are shared. */
const inflight = new Map();
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const slimList = (v) => (v && Array.isArray(v.results) && v.results[0]?.poster_path !== undefined
  ? { page: v.page, total_pages: v.total_pages,
    results: v.results.map((r) => pick(r, ['id', 'title', 'name', 'release_date', 'first_air_date', 'poster_path', 'backdrop_path', 'overview', 'popularity', 'genre_ids', 'original_language', 'vote_average', 'media_type'])) }
  : v);

/** `slim` trims a response before it is cached/returned, to keep localStorage small. */
export function get(path, params = {}, ttl = TTL.list, slim) {
  const shrink = slim ?? (path.startsWith('/discover') ? slimList : (x) => x);
  const key = path + '?' + Object.entries(params).sort().map(([k, v]) => `${k}=${v}`).join('&');
  const hit = ttl > 0 ? cacheGet(key) : undefined; // ttl 0 = never cache (e.g. live search)
  if (hit !== undefined) return Promise.resolve(hit);
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchJson(path, params)
    .then((v) => { v = shrink(v); if (ttl > 0) cacheSet(key, v, ttl); return v; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Walk pages of a list endpoint (capped) and return all results. */
export async function getAllPages(path, params, { maxPages = 5, ttl = TTL.list } = {}) {
  const first = await get(path, { ...params, page: 1 }, ttl);
  const total = Math.min(first.total_pages || 1, maxPages);
  const rest = await Promise.all(
    Array.from({ length: total - 1 }, (_, i) => get(path, { ...params, page: i + 2 }, ttl)));
  return [first, ...rest].flatMap((p) => p.results || []);
}
