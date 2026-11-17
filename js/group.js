// Group recommendation ("Movie Night"): several people each name films they love, and we rank
// candidates for the *group*. Pure functions, no DOM, so they are unit-tested.
//
// Per person: taste vector = centroid of the embeddings of their liked films; happiness with a
// candidate = calibrated cosine similarity (0 below the relevance floor).
// Group score blends the two classic social-choice rules:
//   average  (utilitarian: maximise total happiness)
//   minimum  (least misery: nobody should hate it)
// score = (1 - w) * average + w * minimum, with w = 0.5 by default. Fairness = 1 - spread.
import { centroid, dot, calibrate, tokenize } from './vec.js';

/**
 * @param {Float32Array[][]} likes  one array of liked-film vectors per person
 * @param {{key:string, vec:Float32Array}[]} items candidates
 * @param {{neural?:boolean, exclude?:Set<string>, limit?:number, misery?:number}} opts
 * @returns {{key:string, group:number, fairness:number, people:number[], worst:number}[]}  people = 0..100 each
 */
export function groupRank(likes, items, { neural = true, exclude = new Set(), limit = 10, misery = 0.5 } = {}) {
  const tastes = likes.map((v) => centroid(v));
  if (tastes.some((t) => !t)) return [];
  const out = [];
  for (const it of items) {
    if (exclude.has(it.key)) continue;
    const people = tastes.map((t) => calibrate(dot(t, it.vec), neural) ?? 0);
    // which of each person's own picks this candidate resembles most (for the explanation)
    const near = likes.map((vs) => { let bi = 0, bs = -1; vs.forEach((v, i) => { const d = dot(v, it.vec); if (d > bs) { bs = d; bi = i; } }); return { i: bi, pct: calibrate(bs, neural) ?? 0 }; });
    const avg = people.reduce((a, b) => a + b, 0) / people.length;
    const min = Math.min(...people), max = Math.max(...people);
    out.push({ key: it.key, group: Math.round((1 - misery) * avg + misery * min), fairness: Math.round(100 - (max - min)), people, worst: people.indexOf(min), avg: Math.round(avg), min, near });
  }
  return out.filter((r) => r.group > 0).sort((a, b) => b.group - a.group || b.fairness - a.fairness).slice(0, limit);
}

/** Plain-English verdict for a result row. */
export function verdict(row, names) {
  if (row.fairness >= 80) return 'Everyone should enjoy this one';
  if (row.people[row.worst] === 0) return `${names[row.worst]} probably won’t be into it`;
  return `${names[row.worst]} is the least sold`;
}

const STOP = new Set(['with', 'from', 'that', 'this', 'their', 'they', 'have', 'into', 'about', 'when', 'where', 'while', 'after', 'before', 'through', 'against', 'across', 'being', 'become', 'becomes', 'must', 'will', 'them', 'than', 'then', 'only', 'other', 'which', 'what', 'film', 'story', 'life', 'world', 'new', 'one', 'two', 'finds', 'find', 'young', 'man', 'woman']);
/** Document frequency of each token over a list of texts, for picking distinctive shared words. */
export function docFreq(texts) {
  const df = new Map();
  for (const t of texts) for (const w of new Set(tokenize(t))) df.set(w, (df.get(w) || 0) + 1);
  return df;
}
/** The rarest few words two texts share: the themes that actually link them, not filler. */
export function sharedTerms(a, b, df, n = 3) {
  const B = new Set(tokenize(b));
  return [...new Set(tokenize(a))].filter((w) => w.length > 3 && !STOP.has(w) && B.has(w))
    .sort((x, y) => (df.get(x) || 1) - (df.get(y) || 1)).slice(0, n);
}
export const sharedGenres = (a = [], b = []) => a.filter((g) => b.includes(g));
