import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, kmeans, silhouette, pca2, neighbourGenreHit, histogram, quantile, cooccurrence, clusterTerms, trainLogReg, auc, leaveOnePositiveOutAuc } from '../js/ml.js';
import { normalize } from '../js/vec.js';

// three well-separated blobs in 8-D
const rnd = mulberry32(42);
const blob = (axis, n) => Array.from({ length: n }, () => normalize(Float32Array.from({ length: 8 }, (_, j) => (j === axis ? 1 : 0) + (rnd() - 0.5) * 0.15)));
const data = [...blob(0, 15), ...blob(3, 15), ...blob(6, 15)];
const truth = [...Array(15).fill(0), ...Array(15).fill(1), ...Array(15).fill(2)];

test('k-means recovers well-separated clusters (up to relabelling)', () => {
  const { labels } = kmeans(data, 3, { seed: 1 });
  const groups = new Set(labels.map((l, i) => `${truth[i]}:${l}`));
  assert.equal(groups.size, 3); // each true cluster maps to exactly one predicted label
});
test('silhouette is high for the true partition and low for a random one', () => {
  assert.ok(silhouette(data, truth) > 0.6);
  const shuffled = truth.map((_, i) => i % 3);
  assert.ok(silhouette(data, shuffled) < silhouette(data, truth));
});
test('pca2 returns bounded 2-D points that separate the blobs', () => {
  const pts = pca2(data);
  assert.equal(pts.length, data.length);
  assert.ok(pts.every(([x, y]) => Math.abs(x) <= 1.0001 && Math.abs(y) <= 1.0001));
  const mean = (c) => { const p = pts.filter((_, i) => truth[i] === c); return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]; };
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  assert.ok(d(mean(0), mean(1)) > 0.3 && d(mean(1), mean(2)) > 0.3);
});
test('neighbour genre hit-rate beats the random baseline when vectors encode genre', () => {
  const genres = truth.map((t) => [['A', 'B', 'C'][t]]);
  const r = neighbourGenreHit(data, genres, 5);
  assert.ok(r.hit > 0.95);
  assert.ok(r.baseline < 0.4);
});
test('histogram, quantile and co-occurrence', () => {
  const h = histogram([1, 2, 2, 3, 9], 4, 0, 10);
  assert.equal(h.reduce((s, b) => s + b.count, 0), 5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  const c = cooccurrence([['A', 'B'], ['A'], ['A', 'B'], ['C']], 2);
  assert.deepEqual(c.names, ['A', 'B']);
  assert.equal(c.matrix[0][1], 2);
});
test('clusterTerms picks words distinctive to a cluster', () => {
  const docs = [['space', 'alien'], ['space', 'ship'], ['love', 'paris'], ['love', 'summer']];
  const t = clusterTerms(docs, [0, 0, 1, 1], { top: 1 });
  assert.equal(t.get(0)[0], 'space');
  assert.equal(t.get(1)[0], 'love');
});
test('logistic regression learns a separable taste and AUC reflects it', () => {
  const X = data, y = truth.map((t) => t === 0);
  const m = trainLogReg(X, y);
  const pos = X.filter((_, i) => y[i]).map(m.score), neg = X.filter((_, i) => !y[i]).map(m.score);
  assert.ok(auc(pos, neg) > 0.95);
  assert.ok(leaveOnePositiveOutAuc(X, y) > 0.9);
  assert.equal(auc([0.5], [0.5]), 0.5);
});
