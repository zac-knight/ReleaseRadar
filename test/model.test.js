import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveStatus, trackDates, inTimeframe, groupByMonth, applyFilters, displayDate, daysUntil, countdownLabel, matchServices, groupByService, genreFacets, orderBy,
} from '../js/model.js';

const e = (o) => ({ key: 'movie:1', type: 'movie', title: 'T', date: '2027-05-05', status: 'confirmed', ...o });

test('deriveStatus', () => {
  assert.equal(deriveStatus({ date: '2027-05-05', tmdbStatus: 'Post Production' }), 'confirmed');
  assert.equal(deriveStatus({ date: '2027-05-05', tmdbStatus: 'Planned' }), 'rumoured');
  assert.equal(deriveStatus({ date: '2027-01-01', tmdbStatus: 'In Production' }), 'rumoured');
  assert.equal(deriveStatus({ date: '2027-06-01', delayedFrom: '2027-01-15' }), 'delayed');
});

test('trackDates flags later dates as delayed and keeps the original', () => {
  let s = trackDates([e({ date: '2027-03-01' })]);
  const moved = e({ date: '2027-09-01' });
  s = trackDates([moved], s);
  assert.equal(moved.delayedFrom, '2027-03-01');
  const moved2 = e({ date: '2028-01-10' });
  s = trackDates([moved2], s);
  assert.equal(moved2.delayedFrom, '2027-03-01');
  const early = e({ date: '2027-02-01' });
  trackDates([early], s);
  assert.equal(early.delayedFrom, undefined);
});

test('inTimeframe', () => {
  const now = new Date(2026, 10, 17);
  assert.ok(inTimeframe('2026-11-30', 'month', now));
  assert.ok(!inTimeframe('2026-12-01', 'month', now));
  assert.ok(inTimeframe('2026-12-01', 'year', now));
  assert.ok(inTimeframe('2027-01-01', 'later', now));
  assert.ok(!inTimeframe('2026-12-31', 'later', now));
});

test('groupByMonth orders groups and puts TBA years last within the year', () => {
  const gs = groupByMonth([
    e({ key: 'a', date: '2027-01-01', status: 'rumoured' }),
    e({ key: 'b', date: '2027-12-20' }),
    e({ key: 'c', date: '2026-12-01' }),
  ]);
  assert.deepEqual(gs.map((g) => g.label),
    ['December 2026', 'December 2027', '2027 · Date to be announced']);
});

test('applyFilters and displayDate', () => {
  const list = [e({ key: 'a' }), e({ key: 'b', type: 'tv' })];
  const f = { format: 'tv', when: 'all', status: 'all', watch: 'all' };
  assert.deepEqual(applyFilters(list, f, new Set()).map((x) => x.key), ['b']);
  assert.deepEqual(applyFilters(list, { ...f, format: 'all', watch: 'only' }, new Set(['a'])).map((x) => x.key), ['a']);
  assert.equal(displayDate(e({ date: '2027-01-01', status: 'rumoured' })), '2027');
  assert.equal(displayDate(e({ date: '2027-05-05' })), '5 May 2027');
});

test('search and countdown', () => {
  const list = [e({ key: 'a', title: 'Batman Begins' }), e({ key: 'b', title: 'Thor' })];
  const f = { format: 'all', when: 'all', status: 'all', watch: 'all', q: 'BAT' };
  assert.deepEqual(applyFilters(list, f, new Set()).map((x) => x.key), ['a']);
  const now = new Date(2026, 10, 17);
  assert.equal(daysUntil('2026-11-20', now), 3);
  assert.equal(countdownLabel(e({ date: '2026-11-17' }), now), 'Today');
  assert.equal(countdownLabel(e({ date: '2026-11-18' }), now), 'Tomorrow');
  assert.equal(countdownLabel(e({ date: '2026-12-16' }), now), 'in 29 days');
  assert.equal(countdownLabel(e({ date: '2027-05-17' }), now), 'in 6 months');
  assert.equal(countdownLabel(e({ date: '2027-01-01', status: 'rumoured' }), now), '');
});

test('service matching, filtering and grouping', () => {
  assert.deepEqual(matchServices(['Netflix', 'Disney Plus']), ['netflix', 'disney']);
  assert.deepEqual(matchServices(['Amazon Prime Video', 'Max', 'Stan']), ['prime', 'stan', 'hbo']);
  assert.deepEqual(matchServices(['Max Amazon Channel', 'Cinemax']), []);
  const list = [e({ key: 'a', providers: ['Disney Plus'] }), e({ key: 'b', providers: ['Netflix'] }),
    e({ key: 'c', services: ['netflix', 'hbo'], providers: [] })];
  const f = { format: 'all', when: 'all', status: 'all', watch: 'all', services: ['netflix'] };
  assert.deepEqual(applyFilters(list, f, new Set()).map((x) => x.key), ['b', 'c']);
  const g = groupByService(list);
  assert.deepEqual(g.map((x) => [x.id, x.items.length]), [['netflix', 2], ['disney', 1], ['hbo', 1]]);
});

test('genre filtering (any/all), language, facets and search by genre', () => {
  const list = [
    e({ key: 'a', genres: ['Action', 'Sci-Fi'], lang: 'en' }),
    e({ key: 'b', genres: ['Action'], lang: 'ja' }),
    e({ key: 'c', genres: ['Comedy'], lang: 'en' }),
  ];
  const base = { format: 'all', when: 'all', status: 'all', watch: 'all' };
  const keys = (f) => applyFilters(list, { ...base, ...f }, new Set()).map((x) => x.key);
  assert.deepEqual(keys({ genres: ['Action', 'Comedy'], genreMode: 'any' }), ['a', 'b', 'c']);
  assert.deepEqual(keys({ genres: ['Action', 'Sci-Fi'], genreMode: 'all' }), ['a']);
  assert.deepEqual(keys({ lang: 'en' }), ['a', 'c']);
  assert.deepEqual(keys({ lang: 'other' }), ['b']);
  assert.deepEqual(keys({ q: 'comedy' }), ['c']);
  assert.deepEqual(genreFacets(list), [['Action', 2], ['Comedy', 1], ['Sci-Fi', 1]]);
});

test('orderBy', () => {
  const l = [e({ key: 'a', title: 'B', date: '2027-02-01', popularity: 5 }),
    e({ key: 'b', title: 'A', date: '2027-03-01', popularity: 9 }),
    e({ key: 'c', title: 'C', date: '2027-01-01', popularity: 1 })];
  const k = (s) => orderBy(l, s).map((x) => x.key).join('');
  assert.equal(k('date'), 'cab');
  assert.equal(k('newest'), 'bac');
  assert.equal(k('popular'), 'bac');
  assert.equal(k('title'), 'bac');
});

import {
  releaseInfo, calendarWeeks, addDays, certFacets, matchesRuntime, SERVICES,
} from '../js/model.js';
import { buildICS, toCSV } from '../js/export.js';

test('releaseInfo picks the earliest date per release type for the region, plus a certification', () => {
  const results = [
    { iso_3166_1: 'AU', release_dates: [{ type: 3, release_date: '2027-03-04T00:00:00.000Z', certification: 'M' }] },
    { iso_3166_1: 'US', release_dates: [
      { type: 3, release_date: '2027-03-05T00:00:00.000Z', certification: 'PG-13' },
      { type: 3, release_date: '2027-03-07T00:00:00.000Z', certification: '' },
      { type: 2, release_date: '2027-02-27T00:00:00.000Z', certification: '' },
      { type: 4, release_date: '2027-05-20T00:00:00.000Z', certification: '' },
    ] },
  ];
  const us = releaseInfo(results, 'US');
  assert.deepEqual(us.dates, { theatrical: '2027-03-05', limited: '2027-02-27', digital: '2027-05-20' });
  assert.equal(us.cert, 'PG-13');
  assert.equal(releaseInfo(results, 'AU').cert, 'M');
  assert.deepEqual(releaseInfo(results, 'JP'), { dates: {}, cert: '' });
});

test('deriveStatus marks titles already in cinemas', () => {
  assert.equal(deriveStatus({ date: '2026-11-10', today: '2026-11-17' }), 'now_playing');
  assert.equal(deriveStatus({ date: '2026-11-17', today: '2026-11-17' }), 'now_playing');
  assert.equal(deriveStatus({ date: '2026-12-10', today: '2026-11-17' }), 'confirmed');
});

test('groupByMonth puts "in cinemas now" first', () => {
  const g = groupByMonth([
    e({ key: 'a', date: '2026-12-10' }),
    e({ key: 'b', date: '2026-11-10', status: 'now_playing' }),
  ]);
  assert.deepEqual(g.map((x) => x.label), ['In cinemas now', 'December 2026']);
});

test('date presets', () => {
  const now = new Date(2026, 10, 17); // 17 Nov 2026
  assert.ok(inTimeframe('2026-11-24', 'week', now));
  assert.ok(!inTimeframe('2026-11-25', 'week', now));
  assert.ok(!inTimeframe('2026-11-16', 'week', now));
  assert.ok(inTimeframe('2026-12-31', 'nextmonth', now));
  assert.ok(!inTimeframe('2027-01-01', 'nextmonth', now));
  assert.ok(inTimeframe('2027-02-16', '3m', now));
  assert.ok(!inTimeframe('2027-02-18', '3m', now));
  assert.ok(inTimeframe('2026-12-05', 'custom', now, { from: '2026-12-01', to: '2026-12-10' }));
  assert.ok(!inTimeframe('2026-12-11', 'custom', now, { from: '2026-12-01', to: '2026-12-10' }));
  assert.ok(inTimeframe('2030-01-01', 'custom', now, { from: '2026-12-01' }));
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('calendarWeeks is a Monday-first month grid', () => {
  const w = calendarWeeks(2026, 10); // Nov 1 2026 is a Sunday, so it sits at the end of the first row
  assert.equal(w.length, 6);
  assert.ok(w.every((wk) => wk.length === 7));
  assert.equal(w[0][0], '2026-10-26');
  assert.equal(w[0][6], '2026-11-01');
  assert.equal(w[5][0], '2026-11-30');
  assert.equal(w[5][6], '2026-12-06');
  assert.equal(calendarWeeks(2027, 1).length, 4); // Feb 2027 starts on a Monday and has 28 days
});

test('cert facets, runtime buckets and TBA service group', () => {
  assert.deepEqual(certFacets([e({ cert: 'R' }), e({ cert: 'PG' }), e({ cert: 'R' }), e({})]), [['R', 2], ['PG', 1]]);
  assert.ok(matchesRuntime({ runtime: 90 }, 0, 94));
  assert.ok(matchesRuntime({ runtime: 120 }, 95, 130));
  assert.ok(!matchesRuntime({ runtime: 120 }, 131, 240));
  assert.ok(matchesRuntime({ runtime: 200 }, 150, 240)); // 240 means "240+"
  assert.ok(!matchesRuntime({}, 100, 240)); // unknown runtime fails an active range...
  assert.ok(matchesRuntime({}, 0, 240)); // ...but passes when the filter is off
  const g = groupByService([e({ key: 'a', providers: ['Netflix'] }), e({ key: 'b', providers: [] })], 'popular', { tba: true });
  assert.deepEqual(g.map((x) => x.id), ['netflix', 'tba']);
  assert.ok(SERVICES.every((s) => s.networks.length && s.color));
});

test('buildICS emits all-day events and skips year-only placeholders', () => {
  const ics = buildICS([
    e({ key: 'movie:1', title: 'Big, Loud; Film', date: '2027-03-05', overview: 'Line1\nLine2', genres: ['Action'] }),
    e({ key: 'movie:2', title: 'Someday', date: '2028-01-01', status: 'rumoured' }),
  ], { label: () => 'In cinemas', stamp: new Date('2026-11-17T00:00:00Z') });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270305/);
  assert.match(ics, /DTEND;VALUE=DATE:20270306/);
  assert.match(ics, /SUMMARY:Big\\, Loud\; Film \(In cinemas\)/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75));
});

test('toCSV quotes cells that need it', () => {
  const csv = toCSV([e({ title: 'He said "hi", twice', genres: ['A', 'B'], providers: ['Netflix'], cert: 'R', runtime: 100, lang: 'en' })]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^"He said ""hi"", twice",Movie,2027-05-05,confirmed,A; B,Netflix,R,100,en$/);
});

test('multi-service and rating filters', () => {
  const list = [e({ key: 'a', providers: ['Netflix'], rating: 8 }), e({ key: 'b', providers: ['Stan'], rating: 6 }),
    e({ key: 'c', providers: ['Disney Plus'], rating: 9 })];
  const base = { format: 'all', when: 'all', status: 'all', watch: 'all' };
  const keys = (f) => applyFilters(list, { ...base, ...f }, new Set()).map((x) => x.key);
  assert.deepEqual(keys({ services: ['netflix', 'stan'] }), ['a', 'b']);
  assert.deepEqual(keys({ minRating: 8 }), ['a', 'c']);
  assert.deepEqual(keys({ services: ['stan', 'disney'], minRating: 7 }), ['c']);
});
