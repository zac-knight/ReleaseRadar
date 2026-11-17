import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';

const ORIGIN = 'https://zac-knight.github.io';
const env = { TMDB_API_KEY: 'SECRET123', ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` };

// minimal stand-ins for the Workers runtime
function setup() {
  const store = new Map(); const upstream = [];
  globalThis.caches = { default: {
    match: async (r) => { const v = store.get(new Request(r).url); return v ? v.clone() : undefined; },
    put: async (r, res) => { store.set(new Request(r).url, res.clone()); } } };
  globalThis.fetch = async (u) => { upstream.push(String(u)); return new Response(JSON.stringify({ results: [] }), { status: 200 }); };
  return { upstream };
}
const ctx = { waitUntil: (p) => p };
const call = (path, init = {}) => worker.fetch(new Request(`https://proxy.test${path}`, { ...init, headers: { Origin: ORIGIN, ...(init.headers || {}) } }), env, ctx);

test('adds our key, drops a caller-supplied key, and never returns the key', async () => {
  const { upstream } = setup();
  const r = await call('/3/discover/movie?region=AU&api_key=EVIL');
  assert.equal(r.status, 200);
  assert.ok(upstream[0].includes('api_key=SECRET123')); assert.ok(!upstream[0].includes('EVIL'));
  assert.ok(!(await r.text()).includes('SECRET123'));
});

test('rejects other origins, other methods, other paths and unknown or oversized parameters', async () => {
  setup();
  assert.equal((await call('/3/discover/movie', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('/3/discover/movie', { method: 'POST' })).status, 405);
  assert.equal((await call('/3/account')).status, 403);
  assert.equal((await call('/3/discover/movie?with_cast=1')).status, 400);
  assert.equal((await call('/3/discover/movie?page=99')).status, 400);
  assert.equal((await call('/3/search/multi?query=' + 'x'.repeat(500))).status, 400);
});

test('parameter order and extras cannot dodge the cache', async () => {
  const { upstream } = setup();
  await call('/3/discover/movie?region=AU&sort_by=popularity.desc');
  await call('/3/discover/movie?sort_by=popularity.desc&region=AU');   // same query, different order
  assert.equal(upstream.length, 1);
  assert.equal((await call('/3/discover/movie?region=AU&sort_by=popularity.desc&cachebust=123')).status, 400);
});

test('requests that reach TMDB are rate limited per visitor, cached ones are not', async () => {
  const { upstream } = setup();
  const ip = { 'CF-Connecting-IP': '203.0.113.9' };
  let blocked = 0;
  for (let i = 1; i <= 520; i++) { const r = await call(`/3/movie/${i}`, { headers: ip }); if (r.status === 429) blocked++; }
  assert.ok(blocked >= 15 && upstream.length <= 500);
  const again = await call('/3/movie/1', { headers: ip });             // already cached: still served
  assert.equal(again.status, 200);
});
