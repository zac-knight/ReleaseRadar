// Pure logic: no DOM, no network. Unit-tested in test/model.test.js.

// ---- dates ------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

/** Whole days from `now` until the date (negative if past). */
export function daysUntil(date, now = new Date()) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** TMDB uses Jan 1 for "sometime that year". */
export function isPlaceholderDate(date) {
  return typeof date === 'string' && date.endsWith('-01-01');
}

// ---- release types (TMDB release_dates) ------------------------------------------
const RELEASE_TYPES = { 1: 'premiere', 2: 'limited', 3: 'theatrical', 4: 'digital', 5: 'physical', 6: 'tv' };

/**
 * Parse TMDB's `release_dates.results` for one region into the earliest date per release
 * type plus a certification (e.g. PG-13). Theatrical = wide cinema release, limited = limited
 * cinema run, digital = streaming/PVOD, physical = disc.
 */
export function releaseInfo(results = [], region = 'US') {
  const out = { dates: {}, cert: '' };
  const r = results.find((x) => x.iso_3166_1 === region);
  if (!r) return out;
  let anyCert = '';
  for (const rd of r.release_dates || []) {
    const key = RELEASE_TYPES[rd.type];
    if (!key || !rd.release_date) continue;
    const d = rd.release_date.slice(0, 10);
    if (!out.dates[key] || d < out.dates[key]) out.dates[key] = d;
    if (rd.certification) {
      anyCert ||= rd.certification;
      if (!out.cert && (rd.type === 3 || rd.type === 2)) out.cert = rd.certification;
    }
  }
  out.cert ||= anyCert;
  return out;
}

// ---- status -----------------------------------------------------------------------
const RUMOURED_STATUSES = new Set(['Rumored', 'Planned']);

export function deriveStatus({ date, tmdbStatus, delayedFrom, today }) {
  if (today && date <= today) return 'now_playing';
  if (delayedFrom && delayedFrom < date) return 'delayed';
  if (RUMOURED_STATUSES.has(tmdbStatus) || isPlaceholderDate(date)) return 'rumoured';
  return 'confirmed';
}

/**
 * TMDB doesn't expose "delayed", so we infer it: remember the first date we saw for each
 * title, and if a later fetch reports a later date, flag it and keep the original.
 * Returns the new store; sets entry.delayedFrom on entries as a side effect.
 */
export function trackDates(entries, store = {}) {
  const next = { ...store };
  for (const e of entries) {
    const prev = next[e.key];
    if (!prev) {
      next[e.key] = { date: e.date };
    } else if (e.date > prev.date) {
      next[e.key] = { date: e.date, delayedFrom: prev.delayedFrom ?? prev.date };
    } else if (e.date < prev.date) {
      next[e.key] = { date: e.date }; // pulled forward: no longer delayed
    }
    e.delayedFrom = next[e.key].delayedFrom;
  }
  return next;
}

// ---- streaming services -----------------------------------------------------------
// Matching is by TMDB provider/network name. `networks` are TMDB network ids (from TMDB's public
// tv_network_ids export) used to find a service's own new series.
export const SERVICES = [
  { id: 'netflix', label: 'Netflix', color: '#e50914', match: /netflix/i, networks: [213] },
  { id: 'prime', label: 'Prime Video', color: '#00a8e1', match: /amazon|prime video/i, networks: [1024] },
  { id: 'disney', label: 'Disney+', color: '#2f5bff', match: /disney/i, networks: [2739] },
  { id: 'stan', label: 'Stan', color: '#2a8bff', match: /^stan\b/i, networks: [1255] },
  { id: 'binge', label: 'Binge', color: '#18c6b0', match: /binge/i, networks: [5086, 5490] },
  { id: 'hbo', label: 'HBO Max', color: '#9b5cff', match: /\b(hbo|max)\b/i, networks: [3186, 49] },
  { id: 'apple', label: 'Apple TV+', color: '#b8bcc8', match: /apple tv/i, networks: [2552] },
  { id: 'paramount', label: 'Paramount+', color: '#2e6bff', match: /paramount/i, networks: [4330] },
  { id: 'ftv', label: 'Free TV', color: '#ffb02e', match: /iview|sbs on demand|9now|7plus|10 play|tenplay/i, networks: [1327, 6038, 6883, 7089, 8185, 7975] },
];

export function matchServices(names = []) {
  return SERVICES.filter((s) => names.some((n) => s.match.test(n) && !/channel/i.test(n))).map((s) => s.id);
}
export const entryServices = (e) => e.services ?? matchServices(e.providers);

// ---- date ranges ------------------------------------------------------------------
export const WHEN_PRESETS = ['all', 'week', 'month', 'nextmonth', '3m', 'year', 'later', 'custom'];

export function inTimeframe(date, when, now = new Date(), custom = {}) {
  if (!when || when === 'all') return true;
  const today = ymd(now);
  if (when === 'week') return date >= today && date <= addDays(today, 7);
  if (when === 'month') return date.slice(0, 7) === today.slice(0, 7);
  if (when === 'nextmonth') return date.slice(0, 7) === ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1)).slice(0, 7);
  if (when === '3m') return date >= today && date <= addDays(today, 92);
  if (when === 'year') return date.slice(0, 4) === String(now.getFullYear());
  if (when === 'later') return date.slice(0, 4) > String(now.getFullYear());
  if (when === 'custom') return (!custom.from || date >= custom.from) && (!custom.to || date <= custom.to);
  return true;
}

// ---- filtering --------------------------------------------------------------------
const matchesQuery = (e, q) => {
  const t = q.toLowerCase();
  return e.title.toLowerCase().includes(t) || (e.genres || []).some((g) => g.toLowerCase().includes(t));
};

/** `mode` 'any' = at least one selected genre, 'all' = every selected genre. */
export function matchesGenres(e, selected = [], mode = 'any') {
  if (!selected.length) return true;
  const have = e.genres || [];
  return mode === 'all' ? selected.every((g) => have.includes(g)) : selected.some((g) => have.includes(g));
}

export function matchesLang(e, lang = 'all') {
  if (lang === 'all') return true;
  if (lang === 'en') return e.lang === 'en';
  return Boolean(e.lang) && e.lang !== 'en';
}

export const RUNTIME_MAX = 240; // slider ceiling; 240 means "240 or more"
/** Runtime range in minutes. The full range (0..240) means "no filter", so unknown runtimes still pass. */
export function matchesRuntime(e, min = 0, max = RUNTIME_MAX) {
  if (min <= 0 && max >= RUNTIME_MAX) return true;
  if (!e.runtime) return false;
  return e.runtime >= min && (max >= RUNTIME_MAX || e.runtime <= max);
}

/** Genre counts for the given entries, most common first (drives the live genre chips). */
export function genreFacets(entries) {
  const counts = new Map();
  for (const e of entries) for (const g of e.genres || []) counts.set(g, (counts.get(g) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function certFacets(entries) {
  const counts = new Map();
  for (const e of entries) if (e.cert) counts.set(e.cert, (counts.get(e.cert) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function applyFilters(entries, f, watchlist, now = new Date()) {
  const catalogue = f.mode === 'now'; // "streaming now" has no upcoming dates/status to filter on
  const custom = { from: f.from, to: f.to };
  return entries.filter((e) =>
    (f.format === 'all' || !f.format || e.type === f.format) &&
    (!f.services?.length || entryServices(e).some((id) => f.services.includes(id))) &&
    (catalogue || !f.status || f.status === 'all' || e.status === f.status) &&
    (f.watch !== 'only' || watchlist.has(e.key)) &&
    (!f.q || matchesQuery(e, f.q)) &&
    matchesGenres(e, f.genres, f.genreMode) &&
    matchesLang(e, f.lang) &&
    (!f.certs?.length || f.certs.includes(e.cert)) &&
    matchesRuntime(e, f.rtMin, f.rtMax) &&
    (!f.minRating || (e.rating || 0) >= f.minRating) &&
    (catalogue || inTimeframe(e.date, f.when, now, custom)));
}

/** Order entries by 'date' (soonest first), 'newest', 'popular', 'rating' or 'title'. */
export function orderBy(entries, sort = 'date') {
  const byTitle = (a, b) => a.title.localeCompare(b.title);
  const cmp = {
    date: (a, b) => a.date.localeCompare(b.date) || byTitle(a, b),
    newest: (a, b) => b.date.localeCompare(a.date) || byTitle(a, b),
    popular: (a, b) => (b.popularity || 0) - (a.popularity || 0) || byTitle(a, b),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || byTitle(a, b),
    title: byTitle,
  }[sort] ?? byTitle;
  return [...entries].sort(cmp);
}

export const sortEntries = (entries) => orderBy(entries, 'date');

// ---- grouping ---------------------------------------------------------------------
function groupOf(e) {
  if (e.status === 'now_playing') return { id: '0-now', label: 'In cinemas now' };
  const year = e.date.slice(0, 4);
  if (e.status === 'rumoured' && isPlaceholderDate(e.date)) {
    return { id: `${year}-13`, label: `${year} · Date to be announced` };
  }
  const m = Number(e.date.slice(5, 7));
  return { id: e.date.slice(0, 7), label: `${MONTHS[m - 1]} ${year}` };
}

export function groupByMonth(entries) {
  const groups = new Map();
  for (const e of sortEntries(entries)) {
    const g = groupOf(e);
    if (!groups.has(g.id)) groups.set(g.id, { ...g, items: [] });
    groups.get(g.id).items.push(e);
  }
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** One section per service, ordered by `sort`. With `tba`, entries on no known service get their own group. */
export function groupByService(entries, sort = 'popular', { tba = false } = {}) {
  const groups = SERVICES.map((s) => ({ id: s.id, label: s.label, items: [] }));
  const none = { id: 'tba', label: 'Platform not announced', items: [] };
  for (const e of orderBy(entries, sort)) {
    const ids = entryServices(e);
    if (!ids.length) { if (tba) none.items.push(e); continue; }
    for (const id of ids) groups.find((g) => g.id === id)?.items.push(e);
  }
  return [...groups, ...(tba ? [none] : [])].filter((g) => g.items.length);
}

/** Month grid (Monday-first) as arrays of 7 `YYYY-MM-DD` strings; includes spill-over days. */
export function calendarWeeks(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month, 1 - offset);
  const last = new Date(year, month + 1, 0);
  const total = Math.ceil((offset + last.getDate()) / 7) * 7;
  const days = Array.from({ length: total }, (_, i) => ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  return Array.from({ length: total / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));
}

// ---- display ----------------------------------------------------------------------
export function displayDate(e) {
  if (e.status === 'rumoured' && isPlaceholderDate(e.date)) return e.date.slice(0, 4);
  const [y, m, d] = e.date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`; // Australian order: 18 Dec 2026
}

export function countdownLabel(e, now = new Date()) {
  if (e.status === 'rumoured' && isPlaceholderDate(e.date)) return '';
  const n = daysUntil(e.date, now);
  if (n < 0) return '';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n <= 60) return `in ${n} days`;
  return `in ${Math.round(n / 30.4)} months`;
}

/** Merge lists of candidate entries, de-duplicating by key (first seen wins). */
export function mergeCandidates(...lists) {
  const seen = new Map();
  for (const list of lists) for (const e of list) if (!seen.has(e.key)) seen.set(e.key, e);
  return [...seen.values()];
}
