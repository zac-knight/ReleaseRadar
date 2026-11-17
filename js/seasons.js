// Seasonal themes: Christmas, Halloween, Easter. Pure data and date maths (no DOM), so it's testable.
// Picking one re-skins the app AND narrows every list to titles TMDB tags with that season's keywords.

/** Easter Sunday for a year (anonymous Gregorian algorithm). Returns a Date at local midnight. */
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const day = (y, m, d) => new Date(y, m - 1, d);
const addD = (dt, n) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);

export const SEASONS = {
  christmas: {
    id: 'christmas', label: 'Christmas', emoji: '🎄',
    blurb: 'Christmas films and shows only', hint: 'Christmas is coming',
    // names are looked up against TMDB's keyword search at run time (ids are never hard-coded)
    keywords: ['christmas', 'santa claus', 'christmas eve', 'christmas tree', 'reindeer', 'elf'],
    window: (y) => [day(y, 11, 8), day(y, 12, 31)],
    demo: { forms: ['Santa’s {N}', 'A {A} Christmas', 'The Christmas {N}', 'Christmas at the {N}', 'Silent Night: {N}', 'The {A} Elf', 'Snow Globe {N}'], genres: ['Family', 'Comedy', 'Romance', 'Animation', 'Drama'], plot: 'a snowed-in family races to save Christmas' },
  },
  halloween: {
    id: 'halloween', label: 'Halloween', emoji: '🎃',
    blurb: 'Halloween and spooky films and shows only', hint: 'Halloween is coming',
    keywords: ['halloween', 'haunted house', 'witch', 'trick or treat', 'ghost', 'vampire', 'werewolf', 'zombie'],
    window: (y) => [day(y, 9, 20), day(y, 11, 1)],
    demo: { forms: ['The Haunting of {N} House', 'Night of the {A} Witch', '{A} Hollow', 'Pumpkin {N}', 'Curse of the {A} {N}', 'The {A} Séance', 'Trick or {N}'], genres: ['Horror', 'Thriller', 'Mystery', 'Fantasy', 'Comedy'], plot: 'something wakes up in a house that should have stayed empty' },
  },
  easter: {
    id: 'easter', label: 'Easter', emoji: '🐣',
    blurb: 'Easter and spring-time films and shows only', hint: 'Easter is coming',
    keywords: ['easter', 'easter bunny', 'easter egg hunt', 'rabbit', 'bunny'],
    window: (y) => { const e = easterSunday(y); return [addD(e, -21), addD(e, 7)]; },
    demo: { forms: ['The Easter {N}', 'Bunny {N}', '{A} Egg Hunt', 'Spring at {N} Farm', 'Hop to {N}', 'The {A} Rabbit'], genres: ['Family', 'Animation', 'Comedy', 'Adventure', 'Fantasy'], plot: 'a very determined rabbit has one weekend to save the egg hunt' },
  },
};
export const SEASON_IDS = Object.keys(SEASONS);

/** The season whose lead-up window contains `now`, or '' if none. */
export function seasonFor(now = new Date()) {
  const y = now.getFullYear();
  for (const id of SEASON_IDS) { const [a, b] = SEASONS[id].window(y); if (now >= a && now <= addD(b, 1)) return id; }
  return '';
}
