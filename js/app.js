// Release Radar AU: app shell. Three views over TMDB data for one region (Australia by default):
//   cinema  what's showing and opening in cinemas
//   soon    what's about to reach streaming (digital releases + each service's new series/seasons)
//   now     what's already on each service

import { setApiKey, clearCache, AuthError } from './tmdb.js';
import { loadCinema, loadSoon, loadAvailable, loadDetail, searchTitles } from './radar.js';
import {
  applyFilters, genreFacets, certFacets, groupByMonth, groupByService, orderBy, trackDates, deriveStatus,
  displayDate, countdownLabel, entryServices, addDays, ymd, SERVICES, RUNTIME_MAX,
} from './model.js';
import { buildICS, toCSV } from './export.js';
import { demoCinema, demoSoon, demoNow, demoDetail } from './demo.js';
import { $, $$, el, store, reduced, posterSrc, download } from './ui.js';
import { createFilterBar, activeChips, SORTS } from './filters.js';
import { renderCalendar } from './calendar.js';
import { createDetail } from './detail.js';

const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.has('demo');
const FRESH_MS = 20 * 60 * 1000; // a snapshot younger than this skips the network entirely
const PAGE = 40;                  // cards added each time you scroll near the bottom

const REGIONS = { AU: 'Australia', NZ: 'New Zealand', US: 'United States', GB: 'United Kingdom', CA: 'Canada',
  IE: 'Ireland', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', JP: 'Japan', IN: 'India', BR: 'Brazil',
  MX: 'Mexico', ZA: 'South Africa', SG: 'Singapore' };
const flag = (code) => String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0)));
const MODE_LABEL = { cinema: 'In cinemas', soon: 'Coming to streaming', now: 'Streaming now' };
const SORT_NAME = Object.fromEntries(SORTS);

const DEFAULT_FILTERS = {
  mode: 'cinema', services: [], format: 'all', when: 'all', from: '', to: '', status: 'all', watch: 'all',
  lang: 'all', genres: [], genreMode: 'any', certs: [], rtMin: 0, rtMax: RUNTIME_MAX, minRating: 0,
  sort: 'auto', group: 'date', view: 'grid',
};

function initialFilters() {
  const f = { ...DEFAULT_FILTERS, ...store.get('rr:filters2', {}), q: '' };
  if (DEMO) { // URL overrides, used to capture screenshots of specific states
    for (const k of ['mode', 'format', 'sort', 'group', 'view', 'when', 'status', 'lang']) if (PARAMS.has(k)) f[k] = PARAMS.get(k);
    if (PARAMS.has('services')) f.services = PARAMS.get('services').split(',').filter(Boolean);
    if (PARAMS.has('genres')) f.genres = PARAMS.get('genres').split(',').filter(Boolean);
    if (PARAMS.has('certs')) f.certs = PARAMS.get('certs').split(',').filter(Boolean);
    if (PARAMS.has('q')) f.q = PARAMS.get('q');
  }
  if (!MODE_LABEL[f.mode]) f.mode = 'cinema';
  for (const k of ['services', 'genres', 'certs']) if (!Array.isArray(f[k])) f[k] = [];
  return f;
}

const now = () => new Date();
const state = {
  data: { cinema: new Map(), soon: new Map(), now: new Map() },
  done: new Set(),          // `${mode}:${region}:${task}` already fetched
  hydrated: new Set(),
  missing: new Set(),       // services TMDB has no provider for in this region
  remote: [],               // live TMDB search results for the current query
  limit: PAGE, groups: [], order: [], seen: new Set(),
  cal: { y: now().getFullYear(), m: now().getMonth(), expanded: null },
  filters: initialFilters(),
  watchlist: new Set(store.get('rr:watchlist', [])),
  region: store.get('rr:region', 'AU'),
};

// ---- small helpers ----------------------------------------------------------------------
const withTransition = (fn) => ((document.startViewTransition && !reduced) ? document.startViewTransition(fn) : fn());
const mode = () => state.filters.mode;
const svcOf = (id) => SERVICES.find((s) => s.id === id);

function setNotice(text, isError = false) {
  const n = $('#status');
  n.textContent = text;
  n.classList.toggle('error', isError);
}
let syncing = 0;
const setSync = (delta) => { syncing = Math.max(0, syncing + delta); $('#sync').hidden = syncing === 0; };

/** Filters as the current view should see them (cinema is movies-only and has no platform filter). */
function effective() {
  const f = state.filters;
  return f.mode === 'cinema' ? { ...f, format: 'all', services: [] } : f;
}

// ---- data store -----------------------------------------------------------------------
const doneKey = (m, task) => `${m}:${state.region}:${task}`;
const snapKey = (m) => `rr:snap3:${m}:${state.region}`;

function addEntry(m, e) {
  const have = state.data[m].get(e.key);
  if (!have) { state.data[m].set(e.key, e); return; }
  for (const id of e.services || []) {
    have.services = [...new Set([...(have.services || []), id])];
  }
  have.providers = [...new Set([...(have.providers || []), ...(e.providers || [])])];
}

function hydrate(m) {
  const k = `${m}:${state.region}`;
  if (state.hydrated.has(k)) return;
  state.hydrated.add(k);
  const snap = store.get(snapKey(m), null);
  if (!snap?.entries) return;
  const today = ymd(now());
  for (const e of snap.entries) {
    if (m === 'cinema') { if (e.date < addDays(today, -35)) continue; if (e.date <= today) e.status = 'now_playing'; }
    else if (m === 'soon' && e.date < today) continue;
    state.data[m].set(e.key, e);
  }
  snap.missing?.forEach((x) => state.missing.add(x));
  // A fresh snapshot counts as fetched; an old one still paints instantly, then refreshes.
  if (Date.now() - snap.t < FRESH_MS) snap.done.forEach((t) => state.done.add(doneKey(m, t)));
}

function persist(m) {
  const prefix = `${m}:${state.region}:`;
  store.set(snapKey(m), {
    t: Date.now(), missing: [...state.missing],
    done: [...state.done].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
    entries: [...state.data[m].values()].map((e) => ({ ...e, overview: (e.overview || '').slice(0, 220) })),
  });
}

function neededTasks(m) {
  if (m === 'cinema') return ['all'];
  const sel = state.filters.services.length ? state.filters.services : SERVICES.map((s) => s.id);
  return m === 'soon' ? ['movies', ...sel] : sel;
}

const statusFor = (e, today) => deriveStatus({ date: e.date, tmdbStatus: e.tmdbStatus, delayedFrom: e.delayedFrom, today });

let queued = false;
function queueRender(m) {
  if (queued) return;
  queued = true;
  setTimeout(() => { queued = false; if (mode() === m) render({ reveal: true }); }, 350);
}

const tokens = { cinema: 0, soon: 0, now: 0 };

function fillDemo(m) {
  if (state.data[m].size) return;
  const list = { cinema: demoCinema, soon: demoSoon, now: demoNow }[m](now());
  for (const e of list) state.data[m].set(e.key, e);
  for (const t of neededTasks(m)) state.done.add(doneKey(m, t));
}

async function ensure(m) {
  if (DEMO) { fillDemo(m); render({ reveal: true }); return; }
  const key = store.get('rr:key', '');
  if (!key) { setNotice('Add your free TMDB API key in Settings to get started.'); openSettings(); return; }
  setApiKey(key);
  hydrate(m);
  const todo = neededTasks(m).filter((t) => !state.done.has(doneKey(m, t)));
  render({ reveal: true }); // instant paint from the snapshot, if any
  if (!todo.length) return;
  if (!state.data[m].size) showSkeleton();

  const token = ++tokens[m];
  const region = state.region;
  const today = ymd(now());
  setSync(1);
  try {
    if (m === 'cinema') {
      let dates = store.get(`rr:dates:cinema:${region}`, {});
      await loadCinema({ region, onEntry: (e) => {
        dates = trackDates([e], dates);
        e.status = statusFor(e, today);
        addEntry(m, e);
        queueRender(m);
      } });
      store.set(`rr:dates:cinema:${region}`, dates);
    } else if (m === 'soon') {
      let dates = store.get(`rr:dates:soon:${region}`, {});
      await loadSoon({ region, tasks: todo, onBatch: (id, entries) => {
        dates = trackDates(entries, dates);
        for (const e of entries) { e.status = statusFor(e); addEntry(m, e); }
        state.done.add(doneKey(m, id));
        queueRender(m);
      } });
      store.set(`rr:dates:soon:${region}`, dates);
    } else {
      const { missing } = await loadAvailable({ region, services: todo, onBatch: (sid, list) => {
        for (const e of list) addEntry(m, e);
        state.done.add(doneKey(m, sid));
        queueRender(m);
      } });
      missing.forEach((id) => { state.missing.add(id); state.done.add(doneKey(m, id)); });
    }
    if (token !== tokens[m] || region !== state.region) return;
    for (const t of todo) state.done.add(doneKey(m, t));
    persist(m);
    if (mode() === m) render({ reveal: true });
  } catch (err) {
    if (err instanceof AuthError) { setNotice('TMDB rejected that key. Check it in Settings.', true); openSettings(); }
    else setNotice(`Couldn't load ${MODE_LABEL[m].toLowerCase()}: ${err.message}`, true);
  } finally {
    setSync(-1);
  }
}

// ---- grouping + rendering -----------------------------------------------------------------
function buildGroups(visible, f) {
  const m = f.mode;
  const sort = f.sort;
  if (m === 'now') return groupByService(visible, sort === 'auto' ? 'popular' : sort === 'date' ? 'newest' : sort);
  if (m === 'soon' && f.group === 'service') return groupByService(visible, sort === 'auto' ? 'date' : sort, { tba: true });
  if (sort === 'auto' || sort === 'date') return groupByMonth(visible);
  return [{ id: 'all', label: SORT_NAME[sort], items: orderBy(visible, sort) }];
}

const labelFor = (e) => (e._mode === 'cinema' || (!e._mode && mode() === 'cinema') ? 'In cinemas' : e.label || 'Streaming');

const cardCache = new Map();

function buildCard(e) {
  const star = el('button', { class: 'star', 'aria-pressed': 'false', text: '☆' });
  star.addEventListener('click', (ev) => { ev.stopPropagation(); toggleWatch(e.key, star); });
  const poster = e.poster
    ? el('img', { class: 'poster', src: posterSrc(e.poster), alt: '', loading: 'lazy', decoding: 'async' })
    : el('div', { class: 'poster none', text: e.title[0] });
  const count = countdownLabel(e);
  const svc = svcOf(entryServices(e)[0]);
  const tags = el('div', { class: 'tags' },
    el('span', { class: 'tag', text: e.type === 'movie' ? 'Film' : 'TV' }),
    e.status === 'now_playing' && el('span', { class: 'tag now_playing', text: 'In cinemas' }),
    (e.status === 'rumoured' || e.status === 'delayed') && el('span', { class: `tag ${e.status}`, text: e.status }),
    e.label && e.status !== 'available' && el('span', { class: 'tag lbl', text: e.label }));
  const corner = el('div', { class: 'corner' },
    e.cert && el('span', { class: 'cert', text: e.cert }),
    svc && el('span', { class: 'svc', style: `--c:${svc.color}`, text: svc.label }));
  const over = el('div', { class: 'over' },
    e.tagline && el('b', { text: e.tagline }),
    el('p', { text: e.overview || 'No synopsis yet.' }));
  const sub = e.status === 'available' ? e.date.slice(0, 4) : displayDate(e);
  const c = el('article', { class: 'card', tabindex: '0', role: 'button', 'aria-label': `${e.title}, ${sub}` },
    el('div', { class: 'poster-wrap' }, poster, over, tags, !e.cert && count && el('span', { class: 'count', text: count }), corner, star),
    el('div', { class: 'meta' }, el('h3', { text: e.title }),
      el('p', { text: sub + (e.status !== 'available' && e.runtime ? ` · ${Math.floor(e.runtime / 60)}h ${e.runtime % 60}m` : '') }),
      e.genres?.length && el('p', { class: 'genres', text: e.genres.slice(0, 2).join(' · ') }),
      e.delayedFrom && el('p', { class: 'was', text: displayDate({ ...e, date: e.delayedFrom, status: 'confirmed' }) })));
  c._e = e;
  c.addEventListener('click', () => detail.open(c._idx));
  c.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); detail.open(c._idx); } });
  return c;
}

function card(e, reveal, i, group) {
  const ck = `${mode()}:${group}:${e.key}`;
  let c = cardCache.get(ck);
  if (!c || c._e !== e) { c = buildCard(e); cardCache.set(ck, c); }
  c._idx = state.order.length;
  state.order.push(e);
  c.style.setProperty('--d', `${Math.min(i, 8) * 45}ms`);
  c.style.viewTransitionName = i < 60 ? `vt-${e.key.replace(':', '-')}-${group}` : '';
  const star = c.querySelector('.star');
  const on = state.watchlist.has(e.key);
  if (star.getAttribute('aria-pressed') !== String(on)) { star.textContent = on ? '★' : '☆'; star.setAttribute('aria-pressed', String(on)); }
  star.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} watchlist: ${e.title}`);
  if (!c.classList.contains('in')) {
    if (reveal) { c.classList.add('reveal'); io.observe(c); } else c.classList.add('in');
  }
  return c;
}

// scroll reveal + scrollspy + infinite scroll
const io = new IntersectionObserver((items) => {
  for (const it of items) if (it.isIntersecting) { it.target.classList.add('in'); io.unobserve(it.target); }
}, { rootMargin: '0px 0px -6% 0px' });

let spy;
function activateJump(id) {
  const jump = $('#jump');
  let active;
  $$('a', jump).forEach((a) => { const on = a.dataset.target === id; a.classList.toggle('active', on); if (on) active = a; });
  if (active) jump.scrollTo({ left: active.offsetLeft - jump.clientWidth / 2 + active.offsetWidth / 2, behavior: reduced ? 'auto' : 'smooth' });
}
function setupSpy() {
  spy?.disconnect();
  spy = new IntersectionObserver((items) => { for (const it of items) if (it.isIntersecting) activateJump(it.target.id); },
    { rootMargin: '-170px 0px -70% 0px' });
  $$('.month').forEach((s) => spy.observe(s));
}

let hasMore = false;
function growList() {
  if (!hasMore) return;
  state.limit += PAGE;
  render({ reveal: true });
  requestAnimationFrame(() => { if (hasMore && $('#sentinel').getBoundingClientRect().top < innerHeight + 700) growList(); });
}
new IntersectionObserver((items) => { if (items[0].isIntersecting) growList(); }, { rootMargin: '0px 0px 700px 0px' }).observe($('#sentinel'));

function jumpTo(id) {
  let sec = document.getElementById(`sec-${id}`);
  if (!sec) {
    let before = 0;
    for (const g of state.groups) { if (g.id === id) break; before += g.items.length; }
    state.limit = Math.max(state.limit, before + PAGE);
    render();
    sec = document.getElementById(`sec-${id}`);
  }
  sec?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function jumpLabel(g) {
  if (g.id === '0-now') return 'Now showing';
  if (g.id.endsWith('-13')) return `${g.id.slice(0, 4)} TBA`;
  if (/^\d{4}-\d\d$/.test(g.id)) { const [y, m] = g.id.split('-'); return `${SHORT_MONTHS[Number(m) - 1]} '${y.slice(2)}`; }
  return g.label;
}

function render({ reveal = false } = {}) {
  const f = state.filters;
  const ef = effective();
  const pool = [...state.data[f.mode].values()];
  const visible = applyFilters(pool, ef, state.watchlist);
  updateChrome(pool, ef, visible);
  document.body.dataset.mode = f.mode;
  const calendar = f.view === 'calendar' && f.mode !== 'now';
  document.body.dataset.view = calendar ? 'calendar' : 'grid';
  if (calendar) renderCal(visible); else renderGrid(visible, ef, reveal);
}

function renderGrid(visible, ef, reveal) {
  let groups = buildGroups(visible, ef);
  if (ef.q && state.remote.length) { // live TMDB search results beyond what's loaded
    const have = new Set([...state.data.cinema.keys(), ...state.data.soon.keys(), ...state.data.now.keys()]);
    const more = applyFilters(state.remote.filter((r) => !have.has(r.key)),
      { ...DEFAULT_FILTERS, mode: 'now', format: ef.format, genres: ef.genres, genreMode: ef.genreMode, lang: ef.lang }, new Set());
    if (more.length) groups = [...groups, { id: 'remote', label: 'More from TMDB', items: more.slice(0, 24) }];
  }
  state.groups = groups;
  state.order = [];
  const root = document.createDocumentFragment();
  let i = 0;
  let budget = state.limit;
  hasMore = false;
  for (const g of groups) {
    const shown = g.items.slice(0, Math.max(budget, 0));
    budget -= shown.length;
    if (shown.length < g.items.length) hasMore = true;
    if (!shown.length) continue;
    const title = state.filters.mode === 'now' && g.id !== 'remote' ? `On ${g.label}` : g.label;
    root.append(el('section', { class: 'month', id: `sec-${g.id}` },
      el('h2', {}, el('span', { text: title }), el('small', { text: String(g.items.length) })),
      el('div', { class: 'cards' }, ...shown.map((e) => card(e, reveal && !state.seen.has(`${g.id}:${e.key}`), i++, g.id)))));
    shown.forEach((e) => state.seen.add(`${g.id}:${e.key}`));
  }
  $('#timeline').replaceChildren(root);
  const sentinel = $('#sentinel');
  sentinel.classList.toggle('loading', hasMore);
  sentinel.textContent = hasMore ? 'Loading more…' : (visible.length > PAGE ? "That's everything" : '');
  $('#jump').replaceChildren(...(groups.length > 1 ? groups : []).map((g) => {
    const a = el('a', { href: `#sec-${g.id}`, 'data-target': `sec-${g.id}` }, jumpLabel(g), el('small', { text: String(g.items.length) }));
    a.addEventListener('click', (ev) => { ev.preventDefault(); jumpTo(g.id); });
    return a;
  }));
  setupSpy();
}

function renderCal(visible) {
  const today = ymd(now());
  state.order = orderBy(visible, 'date');
  const cal = renderCalendar({
    entries: visible, year: state.cal.y, month: state.cal.m, today, expanded: state.cal.expanded,
    serviceColor: (e) => svcOf(entryServices(e)[0])?.color,
    onPick: (e) => detail.open(state.order.indexOf(e)),
    onExpand: (d) => { state.cal.expanded = d; render(); },
    onNav: (delta) => {
      if (delta === 0) { state.cal = { y: now().getFullYear(), m: now().getMonth(), expanded: null }; }
      else { const d = new Date(state.cal.y, state.cal.m + delta, 1); state.cal = { y: d.getFullYear(), m: d.getMonth(), expanded: null }; }
      withTransition(() => render());
    },
  });
  $('#timeline').replaceChildren(cal);
  $('#sentinel').textContent = '';
  $('#jump').replaceChildren();
  hasMore = false;
}

function showSkeleton() {
  $('#jump').replaceChildren();
  $('#timeline').replaceChildren(el('section', { class: 'month' },
    el('div', { class: 'cards' }, ...Array.from({ length: 16 }, (_, i) =>
      el('article', { class: 'card skeleton', style: `--d:${i * 35}ms` },
        el('div', { class: 'poster-wrap' }),
        el('div', { class: 'meta' }, el('i', { class: 'sk w80' }), el('i', { class: 'sk w60' })))))));
}

// ---- chrome: tabs, filter bar, chips, status line -------------------------------------------
let bar;
function updateChrome(pool, ef, visible) {
  const f = state.filters;
  // tabs
  $$('#tabs button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.value === f.mode));
    const n = state.data[b.dataset.value].size;
    $('.cnt', b).textContent = n ? String(n) : '';
  });
  $$('#view-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === f.view)));

  // filter bar with faceted counts (each facet ignores its own filter)
  const base = (over) => applyFilters(pool, { ...ef, ...over }, state.watchlist);
  const serviceCounts = new Map();
  for (const e of base({ services: [] })) for (const id of entryServices(e)) serviceCounts.set(id, (serviceCounts.get(id) || 0) + 1);
  bar.update({
    f, mode: f.mode,
    allGenres: genreFacets(pool).map(([g]) => g),
    genreCounts: new Map(genreFacets(base({ genres: [] }))),
    certCounts: certFacets(base({ certs: [] })),
    serviceCounts,
  });

  // active chips
  const chips = activeChips(f, f.mode);
  $('#active').replaceChildren(...chips.map((c) => {
    const b = el('button', { class: 'achip', type: 'button', 'aria-label': `Remove filter ${c.label}` }, c.label, el('i', { text: '✕' }));
    b.addEventListener('click', () => patch(c.patch));
    return b;
  }));
  $('#activebar').hidden = chips.length === 0;

  // status line
  const n = visible.length;
  const loaded = state.data[f.mode].size > 0 || [...state.done].some((k) => k.startsWith(`${f.mode}:`));
  const region = REGIONS[state.region] || state.region;
  const noun = { cinema: `${n === 1 ? 'film' : 'films'} showing or opening in ${region}`,
    soon: `${n === 1 ? 'title' : 'titles'} heading to streaming in ${region}`,
    now: `${n === 1 ? 'title' : 'titles'} streaming in ${region}` }[f.mode];
  const missing = f.mode !== 'cinema' ? [...state.missing].map((id) => svcOf(id)?.label).filter(Boolean) : [];
  if (loaded) {
    setNotice((n ? `${n} ${noun}` : 'Nothing matches these filters.')
      + (missing.length ? ` · ${missing.join(', ')} not listed for ${region}` : ''));
  }
  $('#region-btn').textContent = `${flag(state.region)} ${state.region}`;
}

function patch(p) {
  Object.assign(state.filters, p);
  const { q, ...persistable } = state.filters;
  store.set('rr:filters2', persistable);
  state.limit = PAGE;
  if (!state.filters.mode) state.filters.mode = 'cinema';
  withTransition(() => render());
  if ('services' in p && mode() !== 'cinema') ensure(mode()); // a newly chosen service may need loading
  if (state.filters.view !== 'calendar' && scrollY > 0) scrollTo({ top: 0, behavior: 'auto' });
}

function reset() {
  const { mode: m, view, sort, group } = state.filters;
  $('#q').value = '';
  state.remote = [];
  patch({ ...DEFAULT_FILTERS, mode: m, view, sort, group, q: '' });
  ensure(mode());
}

// ---- watchlist, export ----------------------------------------------------------------------
function toggleWatch(key, starEl) {
  const on = !state.watchlist.has(key);
  on ? state.watchlist.add(key) : state.watchlist.delete(key);
  store.set('rr:watchlist', [...state.watchlist]);
  if (state.filters.watch === 'only') { withTransition(() => render()); return; }
  if (starEl) { starEl.textContent = on ? '★' : '☆'; starEl.setAttribute('aria-pressed', String(on)); starEl.classList.remove('pop'); void starEl.offsetWidth; starEl.classList.add('pop'); }
  $$('.card').forEach((c) => {
    const s = $('.star', c);
    if (c._e?.key === key && s && s !== starEl) { s.textContent = on ? '★' : '☆'; s.setAttribute('aria-pressed', String(on)); }
  });
}

function doExport(kind) {
  const ef = effective();
  const visible = orderBy(applyFilters([...state.data[mode()].values()], ef, state.watchlist), 'date');
  const stamp = ymd(now());
  if (kind === 'csv') download(`release-radar-${mode()}-${stamp}.csv`, toCSV(visible), 'text/csv');
  else if (kind === 'ics-view') download(`release-radar-${mode()}-${stamp}.ics`, buildICS(visible, { label: labelFor }), 'text/calendar');
  else {
    const mine = [];
    for (const m of ['cinema', 'soon']) for (const e of state.data[m].values()) if (state.watchlist.has(e.key)) mine.push({ ...e, _mode: m });
    download(`my-watchlist-${stamp}.ics`, buildICS(mine, { label: (e) => (e._mode === 'cinema' ? 'In cinemas' : e.label || 'Streaming') }), 'text/calendar');
  }
}

// ---- detail panel, settings, wiring ------------------------------------------------------------
const detail = createDetail({
  dialog: $('#detail'), region: () => state.region, order: () => state.order,
  isWatched: (k) => state.watchlist.has(k), toggleWatch: (k) => toggleWatch(k), label: labelFor,
  fetchDetail: (e) => (DEMO ? Promise.resolve(demoDetail(e)) : loadDetail(e, state.region)),
});

function openSettings() {
  $('#key-input').value = store.get('rr:key', '');
  $('#region-input').value = state.region;
  if (!$('#settings').open) $('#settings').showModal();
}

function reloadAll() {
  clearCache();
  try { Object.keys(localStorage).filter((k) => k.startsWith('rr:snap')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  for (const m of Object.values(state.data)) m.clear();
  state.done.clear(); state.hydrated.clear(); state.missing.clear(); state.seen.clear(); cardCache.clear();
  state.limit = PAGE;
  ensure(mode());
}

function init() {
  $('#region-input').replaceChildren(...Object.entries(REGIONS).map(([c, n]) => el('option', { value: c, text: `${flag(c)}  ${n}` })));
  $('#demo-note').hidden = !DEMO;
  if (DEMO) $('#q').value = state.filters.q;

  bar = createFilterBar({ mount: $('#filterbar'), getF: () => state.filters, patch, onExport: doExport,
    onWatch: () => patch({ watch: state.filters.watch === 'only' ? 'all' : 'only' }) });

  $('#tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || b.dataset.value === mode()) return;
    bar.close();
    patch({ mode: b.dataset.value });
    ensure(b.dataset.value);
  });
  $('#view-seg').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) patch({ view: b.dataset.value });
  });
  $('#reset').addEventListener('click', reset);

  // Live search: local results update on every keystroke; TMDB-wide results follow after a short pause.
  let remoteTimer = 0; let remoteToken = 0;
  $('#q').addEventListener('input', (ev) => {
    const q = ev.target.value.trim();
    state.filters.q = q;
    state.limit = PAGE;
    if (scrollY > 0) scrollTo(0, 0);
    if (q.length < 2 || DEMO) state.remote = [];
    render();
    clearTimeout(remoteTimer);
    if (q.length >= 2 && !DEMO) {
      remoteTimer = setTimeout(async () => {
        const token = ++remoteToken;
        try { const r = await searchTitles(q); if (token === remoteToken && state.filters.q === q) { state.remote = r; render(); } } catch { /* local results still show */ }
      }, 280);
    }
  });
  addEventListener('keydown', (ev) => {
    if (ev.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
      ev.preventDefault(); $('#q').focus();
    }
  });

  const toTop = $('#to-top');
  addEventListener('scroll', () => { toTop.hidden = scrollY < 900; }, { passive: true });
  toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }));

  $('#settings-btn').addEventListener('click', openSettings);
  $('#region-btn').addEventListener('click', openSettings);
  $('#refresh').addEventListener('click', reloadAll);
  $('#settings').addEventListener('close', () => {
    if ($('#settings').returnValue !== 'save') return;
    store.set('rr:key', $('#key-input').value.trim());
    state.region = $('#region-input').value;
    store.set('rr:region', state.region);
    reloadAll();
  });

  try { Object.keys(localStorage).filter((k) => /^rr:(snap|nowsnap|snap2|nowsnap2|cache):/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }

  if (DEMO && PARAMS.has('cal')) { const [y, m] = PARAMS.get('cal').split('-').map(Number); state.cal = { y, m: m - 1, expanded: null }; }
  ensure(mode());
  if (DEMO && PARAMS.has('open')) setTimeout(() => bar.open(PARAMS.get('open')), 300);
  if (DEMO && PARAMS.get('detail') != null) setTimeout(() => detail.open(Number(PARAMS.get('detail'))), 600);
}

init();
