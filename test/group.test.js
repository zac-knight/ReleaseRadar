import test from 'node:test';
import assert from 'node:assert/strict';
import { groupRank, verdict } from '../js/group.js';
import { normalize } from '../js/vec.js';

const v = (...a) => normalize(Float32Array.from(a));
const A = v(1, 0, 0), B = v(0, 1, 0), AB = v(1, 1, 0);

test('a title between two tastes beats a title that only one person loves', () => {
  const items = [{ key: 'a-only', vec: A }, { key: 'both', vec: AB }];
  const r = groupRank([[A], [B]], items, { neural: true });
  assert.equal(r[0].key, 'both');
});

test('least-misery: a polarising title is penalised, fairness reflects the gap', () => {
  const r = groupRank([[A], [B]], [{ key: 'a-only', vec: A }, { key: 'both', vec: AB }], { misery: 0.5 });
  const solo = r.find((x) => x.key === 'a-only');
  if (solo) assert.ok(solo.fairness < r.find((x) => x.key === 'both').fairness);
});

test('liked titles are excluded and the limit applies', () => {
  const items = [{ key: 'x', vec: AB }, { key: 'y', vec: AB }, { key: 'z', vec: AB }];
  const r = groupRank([[A], [B]], items, { exclude: new Set(['x']), limit: 1 });
  assert.equal(r.length, 1); assert.notEqual(r[0].key, 'x');
});

test('verdict names the least-sold person', () => {
  assert.match(verdict({ fairness: 40, people: [90, 10], worst: 1 }, ['Ann', 'Bo']), /Bo/);
  assert.match(verdict({ fairness: 95, people: [90, 88], worst: 1 }, ['Ann', 'Bo']), /Everyone/);
});

test('empty taste returns nothing', () => {
  assert.deepEqual(groupRank([[A], []], [{ key: 'q', vec: A }]), []);
});

import { sharedTerms, docFreq, sharedGenres } from '../js/group.js';
test('shared terms prefer rare linking words over common filler', () => {
  const texts = ['a detective hunts a serial killer in the city', 'a detective investigates a heist in the city', 'a farmer in the city', 'the city at night'];
  const df = docFreq(texts);
  const t = sharedTerms(texts[0], texts[1], df, 3);
  assert.ok(t.includes('detective')); assert.ok(!t.includes('city') || t.indexOf('detective') < t.indexOf('city'));
});
test('shared genres', () => { assert.deepEqual(sharedGenres(['Action', 'Crime'], ['Crime', 'Drama']), ['Crime']); });
test('rows carry the nearest liked film per person', () => {
  const r = groupRank([[A, B], [B]], [{ key: 'z', vec: AB }]);
  assert.equal(r[0].near.length, 2); assert.ok(r[0].near[0].i === 0 || r[0].near[0].i === 1);
});
