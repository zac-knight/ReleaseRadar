// PURE vector maths for the recommender. No DOM, no network, fully unit-tested.
// Works on any embedding (MiniLM sentence vectors or the hashed bag-of-words fallback).

const STOP = new Set('a an and are as at be but by for from has have he her his i in is it its of on or she that the their they this to was were will with who which when while into than then them there these those you your not no so if out up about after before over under again more most also can could would should do does did one two'.split(' '));

export const tokenize = (text) => (String(text || '').toLowerCase().match(/[a-z0-9']+/g) || []).filter((t) => t.length > 1 && !STOP.has(t));

// FNV-1a, for signed feature hashing
function hash(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }

export function normalize(v) {
  let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Hashed TF vector with sublinear tf and optional idf weights (Map term -> weight). Unit length. */
export function hashVector(text, dim = 512, idf = null) {
  const v = new Float32Array(dim);
  const tf = new Map();
  for (const t of tokenize(text)) tf.set(t, (tf.get(t) || 0) + 1);
  for (const [t, c] of tf) {
    const h = hash(t);
    v[h % dim] += (h & 0x80000000 ? -1 : 1) * (1 + Math.log(c)) * (idf?.get(t) ?? 1);
  }
  return normalize(v);
}

/** Inverse document frequency over a list of texts. */
export function buildIdf(texts) {
  const df = new Map();
  for (const t of texts) for (const w of new Set(tokenize(t))) df.set(w, (df.get(w) || 0) + 1);
  const n = texts.length || 1;
  return new Map([...df].map(([w, c]) => [w, Math.log(1 + n / c)]));
}

export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Mean of vectors, re-normalised: a "taste profile". Optional per-vector weights. */
export function centroid(vecs, weights = null) {
  if (!vecs.length) return null;
  const out = new Float32Array(vecs[0].length);
  vecs.forEach((v, k) => { const w = weights?.[k] ?? 1; for (let i = 0; i < v.length; i++) out[i] += v[i] * w; });
  return normalize(out);
}

/** Rank items [{key, vec}] by cosine similarity to `query` (vectors are unit length, so dot = cosine). */
export function rank(query, items, { exclude = new Set(), limit = Infinity } = {}) {
  return items.filter((x) => !exclude.has(x.key)).map((x) => ({ key: x.key, score: dot(query, x.vec) }))
    .sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Honest, absolute calibration of a cosine score (no per-result-set rescaling, so the worst result
 * never looks like a 40% match). `minScore` is the relevance floor: anything below it is not a match.
 * MiniLM sentence vectors: unrelated pairs sit near 0.05-0.2, genuinely related ones 0.4+.
 * The hashed TF-IDF fallback produces lower cosines, so it uses lower anchors.
 */
export const CALIBRATION = {
  neural: { floor: 0.28, full: 0.75 },
  keyword: { floor: 0.10, full: 0.55 },
};
export function calibrate(score, neural = true) {
  const { floor, full } = CALIBRATION[neural ? 'neural' : 'keyword'];
  if (score < floor) return null; // not a match: don't show it
  return Math.round(50 + 50 * Math.min(1, (score - floor) / (full - floor)));
}

/** Fast 32-bit FNV-1a string hash (hex) plus length: a compact cache key for a long synopsis. */
export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16)}-${text.length}`;
}
