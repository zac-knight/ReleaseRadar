// Tiny IndexedDB key-value store, used to keep embedding vectors between visits (too big for
// localStorage). Every call fails soft: if IndexedDB is unavailable the app simply recomputes.
const DB = 'rr-cache', STORE = 'vec', MAX = 6000;
let dbp = null;
const open = () => dbp || (dbp = new Promise((res, rej) => {
  if (!('indexedDB' in globalThis)) return rej(new Error('no indexedDB'));
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });

/** Look up many keys; resolves to a Map of the ones found (key -> Float32Array). */
export async function getMany(keys) {
  const out = new Map();
  try {
    const db = await open(); const tx = db.transaction(STORE); const st = tx.objectStore(STORE);
    await Promise.all(keys.map((k) => new Promise((res) => {
      const q = st.get(k); q.onsuccess = () => { if (q.result?.v) out.set(k, new Float32Array(q.result.v)); res(); }; q.onerror = () => res();
    })));
  } catch { /* soft fail */ }
  return out;
}

/** Store many [key, Float32Array] pairs, then trim the oldest entries if over the cap. */
export async function setMany(pairs) {
  try {
    const db = await open(); const tx = db.transaction(STORE, 'readwrite'); const st = tx.objectStore(STORE); const t = Date.now();
    for (const [k, v] of pairs) st.put({ v: v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength), t }, k);
    await done(tx);
    const n = await new Promise((res) => { const c = db.transaction(STORE).objectStore(STORE).count(); c.onsuccess = () => res(c.result); c.onerror = () => res(0); });
    if (n > MAX) await trim(db, n - MAX);
  } catch { /* soft fail */ }
}

async function trim(db, drop) {
  const tx = db.transaction(STORE, 'readwrite'); const st = tx.objectStore(STORE);
  const rows = []; await new Promise((res) => { const c = st.openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { rows.push([cur.key, cur.value.t]); cur.continue(); } else res(); }; c.onerror = () => res(); });
  rows.sort((a, b) => a[1] - b[1]).slice(0, drop).forEach(([k]) => st.delete(k));
  await done(tx);
}
