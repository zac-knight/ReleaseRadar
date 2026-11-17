import test from 'node:test';
import assert from 'node:assert/strict';
import { easterSunday, seasonFor, SEASONS, SEASON_IDS } from '../js/seasons.js';

test('Easter Sunday matches known dates', () => {
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(ymd(easterSunday(2024)), '2024-03-31');
  assert.equal(ymd(easterSunday(2025)), '2025-04-20');
  assert.equal(ymd(easterSunday(2026)), '2026-04-05');
  assert.equal(ymd(easterSunday(2027)), '2027-03-28');
});

test('seasonFor picks the right lead-up window', () => {
  assert.equal(seasonFor(new Date(2026, 9, 20)), 'halloween');   // 20 Oct
  assert.equal(seasonFor(new Date(2026, 11, 10)), 'christmas');  // 10 Dec
  assert.equal(seasonFor(new Date(2026, 2, 25)), 'easter');      // 25 Mar, 11 days before Easter 2026
  assert.equal(seasonFor(new Date(2026, 5, 15)), '');            // mid-June: nothing
});

test('every season has keywords, a window and demo data', () => {
  for (const id of SEASON_IDS) {
    const s = SEASONS[id];
    assert.ok(s.keywords.length >= 3); assert.equal(s.window(2026).length, 2); assert.ok(s.demo.forms.length && s.demo.genres.length);
  }
});
