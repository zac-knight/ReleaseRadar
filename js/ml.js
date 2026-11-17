// PURE data-science toolkit used by the Insights view and the recommender. No DOM, no network.
// Everything here is deterministic (seeded) and unit-tested, so results are reproducible.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const sqDist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return s; };

/** k-means with k-means++ seeding. Returns { labels, centroids, inertia }. */
export function kmeans(vecs, k, { iters = 40, seed = 7 } = {}) {
  const n = vecs.length, d = vecs[0].length, rnd = mulberry32(seed);
  k = Math.max(1, Math.min(k, n));
  const cents = [Float32Array.from(vecs[Math.floor(rnd() * n)])];
  while (cents.length < k) {
    const dist = vecs.map((v) => Math.min(...cents.map((c) => sqDist(v, c))));
    const total = dist.reduce((a, b) => a + b, 0);
    if (total === 0) { cents.push(Float32Array.from(vecs[cents.length % n])); continue; }
    let r = rnd() * total, idx = 0;
    for (; idx < n - 1; idx++) { r -= dist[idx]; if (r <= 0) break; }
    cents.push(Float32Array.from(vecs[idx]));
  }
  let labels = new Array(n).fill(0);
  for (let it = 0; it < iters; it++) {
    let moved = false;
    labels = vecs.map((v, i) => {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const dd = sqDist(v, cents[c]); if (dd < bd) { bd = dd; best = c; } }
      if (labels[i] !== best) moved = true;
      return best;
    });
    const sums = Array.from({ length: k }, () => new Float32Array(d)), counts = new Array(k).fill(0);
    vecs.forEach((v, i) => { counts[labels[i]]++; const s = sums[labels[i]]; for (let j = 0; j < d; j++) s[j] += v[j]; });
    for (let c = 0; c < k; c++) if (counts[c]) for (let j = 0; j < d; j++) cents[c][j] = sums[c][j] / counts[c];
    if (!moved && it > 0) break;
  }
  const inertia = vecs.reduce((s, v, i) => s + sqDist(v, cents[labels[i]]), 0);
  return { labels, centroids: cents, inertia };
}

/** Mean silhouette coefficient (-1..1): how well each point sits in its own cluster vs the next nearest. */
export function silhouette(vecs, labels) {
  const n = vecs.length, ks = [...new Set(labels)];
  if (ks.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const sum = new Map(ks.map((k) => [k, 0])), cnt = new Map(ks.map((k) => [k, 0]));
    for (let j = 0; j < n; j++) if (j !== i) { sum.set(labels[j], sum.get(labels[j]) + Math.sqrt(sqDist(vecs[i], vecs[j]))); cnt.set(labels[j], cnt.get(labels[j]) + 1); }
    const own = labels[i];
    if (!cnt.get(own)) continue; // singleton cluster scores 0
    const a = sum.get(own) / cnt.get(own);
    let b = Infinity;
    for (const k of ks) if (k !== own && cnt.get(k)) b = Math.min(b, sum.get(k) / cnt.get(k));
    total += (b - a) / Math.max(a, b || 1);
  }
  return total / n;
}

/** First two principal components via power iteration + deflation. Returns [[x, y], ...] scaled to about -1..1. */
export function pca2(vecs, { iters = 60, seed = 3 } = {}) {
  const n = vecs.length, d = vecs[0].length, rnd = mulberry32(seed);
  const mean = new Float32Array(d);
  vecs.forEach((v) => { for (let j = 0; j < d; j++) mean[j] += v[j] / n; });
  let X = vecs.map((v) => Float32Array.from(v, (x, j) => x - mean[j]));
  const comps = [];
  for (let c = 0; c < 2; c++) {
    let w = Float32Array.from({ length: d }, () => rnd() - 0.5);
    for (let it = 0; it < iters; it++) {
      const next = new Float32Array(d);
      for (const x of X) { let p = 0; for (let j = 0; j < d; j++) p += x[j] * w[j]; for (let j = 0; j < d; j++) next[j] += p * x[j]; }
      let norm = Math.sqrt(next.reduce((s, x) => s + x * x, 0)) || 1;
      for (let j = 0; j < d; j++) next[j] /= norm;
      w = next;
    }
    comps.push(w);
    X = X.map((x) => { let p = 0; for (let j = 0; j < d; j++) p += x[j] * w[j]; return Float32Array.from(x, (v, j) => v - p * w[j]); });
  }
  const pts = vecs.map((v) => comps.map((w) => { let p = 0; for (let j = 0; j < d; j++) p += (v[j] - mean[j]) * w[j]; return p; }));
  const scale = [0, 1].map((a) => Math.max(...pts.map((p) => Math.abs(p[a]))) || 1);
  return pts.map((p) => [p[0] / scale[0], p[1] / scale[1]]);
}

/** Of each title's k nearest neighbours, how many share at least one genre? Compared with picking neighbours at random. */
export function neighbourGenreHit(vecs, genres, k = 5) {
  const n = vecs.length;
  const share = (a, b) => a.some((g) => b.includes(g));
  let hit = 0, base = 0, used = 0;
  for (let i = 0; i < n; i++) {
    if (!genres[i]?.length) continue;
    const sims = [];
    let others = 0, sharing = 0;
    for (let j = 0; j < n; j++) {
      if (j === i || !genres[j]?.length) continue;
      let s = 0; for (let t = 0; t < vecs[i].length; t++) s += vecs[i][t] * vecs[j][t];
      sims.push([s, j]); others++; if (share(genres[i], genres[j])) sharing++;
    }
    if (others < k) continue;
    sims.sort((a, b) => b[0] - a[0]);
    hit += sims.slice(0, k).filter(([, j]) => share(genres[i], genres[j])).length / k;
    base += sharing / others;
    used++;
  }
  return used ? { hit: hit / used, baseline: base / used, n: used, k } : null;
}

export function histogram(values, bins, lo = Math.min(...values), hi = Math.max(...values)) {
  const out = Array.from({ length: bins }, (_, i) => ({ from: lo + ((hi - lo) * i) / bins, to: lo + ((hi - lo) * (i + 1)) / bins, count: 0 }));
  for (const v of values) { if (v < lo || v > hi) continue; out[Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo || 1)) * bins))].count++; }
  return out;
}

export function quantile(values, q) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b), pos = (s.length - 1) * q, lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}

/** Genre co-occurrence counts for the `top` most common genres. */
export function cooccurrence(genreLists, top = 8) {
  const freq = new Map();
  for (const l of genreLists) for (const g of new Set(l)) freq.set(g, (freq.get(g) || 0) + 1);
  const names = [...freq].sort((a, b) => b[1] - a[1]).slice(0, top).map(([g]) => g);
  const matrix = names.map(() => names.map(() => 0));
  for (const l of genreLists) { const s = new Set(l); names.forEach((a, i) => names.forEach((b, j) => { if (s.has(a) && s.has(b)) matrix[i][j]++; })); }
  return { names, matrix };
}

/** Label clusters with their most distinctive words (a c-TF-IDF style score) from token lists. */
export function clusterTerms(tokenLists, labels, { top = 3, minCount = 2 } = {}) {
  const N = tokenLists.length, df = new Map();
  tokenLists.forEach((t) => new Set(t).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const out = new Map();
  for (const c of new Set(labels)) {
    const idx = labels.map((l, i) => (l === c ? i : -1)).filter((i) => i >= 0);
    const tf = new Map();
    idx.forEach((i) => new Set(tokenLists[i]).forEach((w) => tf.set(w, (tf.get(w) || 0) + 1)));
    out.set(c, [...tf].filter(([, n]) => n >= Math.min(minCount, idx.length))
      .map(([w, n]) => [w, (n / idx.length) * Math.log(1 + N / df.get(w))])
      .sort((a, b) => b[1] - a[1]).slice(0, top).map(([w]) => w));
  }
  return out;
}

// ---- a small taste model: L2-regularised logistic regression, evaluated leave-one-positive-out ----
const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

export function trainLogReg(X, y, { l2 = 0.05, epochs = 120, lr = 0.5 } = {}) {
  const d = X[0].length, w = new Float32Array(d);
  let b = 0;
  const pos = y.filter(Boolean).length, neg = y.length - pos;
  const wp = pos ? y.length / (2 * pos) : 1, wn = neg ? y.length / (2 * neg) : 1; // balance classes
  for (let e = 0; e < epochs; e++) {
    const g = new Float32Array(d); let gb = 0;
    X.forEach((x, i) => {
      let z = b; for (let j = 0; j < d; j++) z += w[j] * x[j];
      const err = (sigmoid(z) - (y[i] ? 1 : 0)) * (y[i] ? wp : wn);
      for (let j = 0; j < d; j++) g[j] += err * x[j]; gb += err;
    });
    for (let j = 0; j < d; j++) w[j] -= (lr * (g[j] / X.length + l2 * w[j]));
    b -= lr * gb / X.length;
  }
  return { w, b, score: (x) => { let z = b; for (let j = 0; j < d; j++) z += w[j] * x[j]; return sigmoid(z); } };
}

/** Area under the ROC curve: the chance a random positive outranks a random negative. */
export function auc(posScores, negScores) {
  if (!posScores.length || !negScores.length) return NaN;
  let wins = 0;
  for (const p of posScores) for (const n of negScores) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (posScores.length * negScores.length);
}

/** Leave-one-positive-out AUC: retrain without each saved title, then see how highly it ranks among the unsaved. */
export function leaveOnePositiveOutAuc(X, y, opts) {
  const posIdx = y.map((v, i) => (v ? i : -1)).filter((i) => i >= 0), negIdx = y.map((v, i) => (!v ? i : -1)).filter((i) => i >= 0);
  const per = posIdx.map((held) => {
    const keep = X.map((_, i) => i).filter((i) => i !== held);
    const m = trainLogReg(keep.map((i) => X[i]), keep.map((i) => y[i]), opts);
    return auc([m.score(X[held])], negIdx.map((i) => m.score(X[i])));
  });
  return per.reduce((a, b) => a + b, 0) / per.length;
}
