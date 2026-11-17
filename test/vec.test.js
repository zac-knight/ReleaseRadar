import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, hashVector, buildIdf, dot, centroid, rank, calibrate } from '../js/vec.js';

const docs = {
  space: 'A crew of astronauts discovers an alien signal on a distant planet and fights for survival in space',
  space2: 'Astronauts on a doomed spaceship face an alien threat far from Earth',
  romance: 'Two lovers meet in Paris and fall in love over one summer romance',
  cooking: 'A chef opens a restaurant and competes in a cooking contest',
};
const idf = buildIdf(Object.values(docs));
const V = Object.fromEntries(Object.entries(docs).map(([k, t]) => [k, hashVector(t, 512, idf)]));

test('tokenize drops stop words and punctuation', () => {
  assert.deepEqual(tokenize('The Chef, and the Contest!'), ['chef', 'contest']);
});
test('vectors are unit length', () => {
  assert.ok(Math.abs(dot(V.space, V.space) - 1) < 1e-5);
});
test('related synopses score higher than unrelated ones', () => {
  assert.ok(dot(V.space, V.space2) > dot(V.space, V.romance));
  assert.ok(dot(V.space, V.space2) > dot(V.space, V.cooking));
});
test('rank orders by similarity and honours exclude/limit', () => {
  const items = Object.entries(V).map(([key, vec]) => ({ key, vec }));
  const r = rank(V.space, items, { exclude: new Set(['space']), limit: 2 });
  assert.equal(r.length, 2);
  assert.equal(r[0].key, 'space2');
});
test('a taste centroid of two space films favours space over romance', () => {
  const c = centroid([V.space, V.space2]);
  assert.ok(dot(c, V.space2) > dot(c, V.romance));
  assert.equal(centroid([]), null);
});
test('calibrate never shows weak similarity as a match', () => {
  assert.equal(calibrate(0.05, true), null);
  assert.equal(calibrate(0.27, true), null);
  assert.equal(calibrate(0.28, true), 50);
  assert.equal(calibrate(0.75, true), 100);
  assert.equal(calibrate(0.9, true), 100);
  assert.equal(calibrate(0.09, false), null);
  assert.ok(calibrate(0.3, false) > 50);
});

import { hashText } from '../js/vec.js';
test('hashText gives stable, distinct cache keys', () => {
  assert.equal(hashText('A small-town doctor'), hashText('A small-town doctor'));
  assert.notEqual(hashText('A small-town doctor'), hashText('A small-town doctors'));
  assert.match(hashText('x'), /^[0-9a-f]+-1$/);
});
