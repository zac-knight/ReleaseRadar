// Release Radar AU: app shell. Three views over TMDB data for one region (Australia by default):
//   cinema  what's showing and opening in cinemas
//   soon    what's about to reach streaming (digital releases + each service's new series/seasons)
//   now     what's already on each service

import { setApiKey, clearCache, AuthError } from './tmdb.js';
import { loadCinema, loadSoon, loadAvailable, loadDetail, searchTitles, seasonKeywordIds } from './radar.js';
import {
  applyFilters, effectiveFilters, storySentence, genreFacets, certFacets, groupByMonth, groupByService, orderBy, trackDates, deriveStatus,
  displayDate, countdownLabel, entryServices, addDays, ymd, SERVICES, RUNTIME_MAX,
} from './model.js';
import { buildICS, toCSV } from './export.js';
import { demoCinema, demoSoon, demoNow, demoDetail } from './demo.js';
import { $, $$, el, store, reduced, posterSrc, backdropSrc, download, posterTint } from './ui.js';
import { createFilterBar, activeChips, SORTS } from './filters.js';
import { renderCalendar } from './calendar.js';
import { renderInsights } from './insights.js';
import { createLab } from './lab.js';
import { createNight } from './night.js';
import { SEASONS, SEASON_IDS, seasonFor } from './seasons.js';
import { createFx } from './fx.js';
import { PROXY_URL } from './config.js';
import { embedTexts, entryText } from './semantic.js';
import { centroid, rank, calibrate } from './vec.js';
import { createDetail } from './detail.js';
import { buildStep, stepsFor, isMulti, STEP_LABEL } from './story.js';

const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.has('demo');
const FRESH_MS = 20 * 60 * 1000; // a snapshot younger than this skips the network entirely
const PAGE = 40;                  // cards added each time you scroll near the bottom

const REGIONS = { AU: 'Australia', NZ: 'New Zealand', US: 'United States', GB: 'United Kingdom', CA: 'Canada',
  IE: 'Ireland', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', JP: 'Japan', IN: 'India', BR: 'Brazil',
  MX: 'Mexico', ZA: 'South Africa', SG: 'Singapore' };
const flag = () => '';
const REGION_ADJ = { AU: 'Australian', NZ: 'New Zealand', US: 'US', GB: 'UK', CA: 'Canadian', IE: 'Irish', DE: 'German', FR: 'French',
  ES: 'Spanish', IT: 'Italian', JP: 'Japanese', IN: 'Indian', BR: 'Brazilian', MX: 'Mexican', ZA: 'South African', SG: 'Singapore' };
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
  season: '',               // '', 'christmas', 'halloween' or 'easter': re-skins the app and narrows every list
  data: { cinema: new Map(), soon: new Map(), now: new Map() },
  finished: new Set(),      // finKey()s whose first fetch has completed (until then an empty list means "still loading")
  stale: new Set(),         // `${mode}:${key}` shown from before a refresh, until the fresh copy arrives
  done: new Set(),          // `${mode}:${region}:${task}` already fetched
  hydrated: new Set(),
  missing: new Set(),       // services TMDB has no provider for in this region
  remote: [],               // live TMDB search results for the current query
  limit: PAGE, groups: [], order: [], seen: new Set(),
  ai: null,                 // active on-device AI ranking: { kind, label, engine, scores: Map(key -> match %) }
  cal: { y: now().getFullYear(), m: now().getMonth(), expanded: null },
  loading: { cinema: false, soon: false, now: false },
  progress: { cinema: { done: 0, total: 0 }, soon: { done: 0, total: 0 }, now: { done: 0, total: 0 } },
  error: { cinema: '', soon: '', now: '' },
  lastVisible: 0,
  guide: { on: false, step: 'what', animate: true, touched: new Set() },
  stepDialog: null,
  filters: initialFilters(),
  watchlist: new Set(store.get('rr:watchlist', [])),
  region: store.get('rr:region', 'AU'),
};
const savedSeason = DEMO ? PARAMS.get('season') : store.get('rr:season', '');
state.season = SEASON_IDS.includes(savedSeason) ? savedSeason : '';
if (state.season) document.documentElement.dataset.season = state.season;

// ---- small helpers ----------------------------------------------------------------------
// View-transition snapshots paint above top-layer dialogs, so cards would flash over an open modal: skip them then.
const withTransition = (fn) => ((document.startViewTransition && !reduced && !document.querySelector('dialog[open]')) ? document.startViewTransition(fn) : fn());
const mode = () => state.filters.mode;
const svcOf = (id) => SERVICES.find((s) => s.id === id);

function setNotice(text, isError = false, loading = false) {
  const n = $('#status');
  n.textContent = text;
  n.classList.toggle('error', isError);
  n.classList.toggle('loading', loading);
}
// ---- toast: small confirmation with an optional Undo, so nothing important happens silently ----
let toastTimer = 0;
function toast(msg, undo = null) {
  const t = $('#toast');
  const btn = undo ? el('button', { type: 'button', class: 'toast-undo', text: 'Undo' }) : null;
  btn?.addEventListener('click', () => { clearTimeout(toastTimer); t.hidden = true; undo(); });
  t.replaceChildren(el('span', { text: msg }), btn);
  t.hidden = false; t.classList.remove('in'); void t.offsetWidth; t.classList.add('in');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 3500);
}
// ---- centred loading overlay: blocks scrolling and clicks while something heavy is working ----
let busyOwner = null, onBusyCancel = null;
function showBusy(owner, title, msg = '', cancel = null) {
  busyOwner = owner; onBusyCancel = cancel;
  $('#busy-title').textContent = title; $('#busy-msg').textContent = msg;
  $('#busy-cancel').hidden = !cancel;
  $('#busy').hidden = false; document.body.classList.add('busy-lock');
}
const setBusy = (msg) => { if (busyOwner) $('#busy-msg').textContent = msg; };
function hideBusy(owner) {
  if (owner && busyOwner !== owner) return;
  busyOwner = null; onBusyCancel = null;
  $('#busy').hidden = true; document.body.classList.remove('busy-lock');
}
$('#busy-cancel').addEventListener('click', () => onBusyCancel?.());

let syncing = 0;
const setSync = (delta) => { syncing = Math.max(0, syncing + delta); $('#sync').hidden = syncing === 0; };

/** Filters as the current view should see them (see effectiveFilters). */
const effective = () => effectiveFilters(state.filters);

// ---- data store -----------------------------------------------------------------------
const seasonTag = () => state.season || '-';
const finKey = (m) => `${m}:${state.region}:${seasonTag()}`; // "we have finished fetching this list at least once"
const doneKey = (m, task) => `${m}:${state.region}:${seasonTag()}:${task}`;
const snapKey = (m) => `rr:snap3:${m}:${state.region}:${seasonTag()}`;

function addEntry(m, e) {
  const have = state.data[m].get(e.key);
  if (have && state.stale.has(`${m}:${e.key}`)) { state.stale.delete(`${m}:${e.key}`); state.data[m].set(e.key, e); return; } // refreshed: replace the old copy in place
  if (!have) { state.data[m].set(e.key, e); return; }
  for (const id of e.services || []) {
    have.services = [...new Set([...(have.services || []), id])];
  }
  have.providers = [...new Set([...(have.providers || []), ...(e.providers || [])])];
}

function hydrate(m) {
  const k = `${m}:${state.region}:${seasonTag()}`;
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
  const prefix = `${m}:${state.region}:${seasonTag()}:`;
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
  const list = { cinema: demoCinema, soon: demoSoon, now: demoNow }[m](now(), state.season);
  for (const e of list) state.data[m].set(e.key, e);
  for (const t of neededTasks(m)) state.done.add(doneKey(m, t));
  state.finished.add(finKey(m));
}

async function ensure(m) {
  if (DEMO) {
    if (PARAMS.has('slow') && !state.data[m].size) { // hold the loading state (for screenshots/testing the loading UI)
      state.loading[m] = true; state.progress[m] = { done: 3, total: 10 };
      render(); updateProgressUI();
      setTimeout(() => { state.loading[m] = false; fillDemo(m); render({ reveal: true }); updateProgressUI(); }, 60000);
      return;
    }
    fillDemo(m); render({ reveal: true }); return;
  }
  const key = store.get('rr:key', '') || envKey;
  if (!key && !PROXY_URL) { setNotice('Add your free TMDB API key in Settings to get started.'); openSettings(); return; }
  setApiKey(key); // empty is fine when a proxy supplies the key
  hydrate(m);
  const todo = neededTasks(m).filter((t) => !state.done.has(doneKey(m, t)));
  render({ reveal: true }); // instant paint from the snapshot, if any
  if (!todo.length) { state.finished.add(finKey(m)); return; }
  if (!state.data[m].size) showSkeleton();

  const token = ++tokens[m];
  const region = state.region;
  // A season narrows every query to titles TMDB tags with that season's keywords.
  let extra = {};
  if (state.season) {
    const ids = await seasonKeywordIds(SEASONS[state.season].keywords);
    if (token !== tokens[m]) return;
    if (!ids.length) { state.error[m] = `Couldn't look up ${SEASONS[state.season].label} titles on TMDB. Check your connection and try again.`; render(); return; }
    extra = { with_keywords: ids.join('|') };
  }
  const today = ymd(now());
  state.error[m] = '';
  state.loading[m] = true;
  state.progress[m] = { done: 0, total: m === 'cinema' ? 0 : todo.length };
  updateProgressUI();
  setSync(1);
  try {
    if (m === 'cinema') {
      let dates = store.get(`rr:dates:cinema:${region}`, {});
      await loadCinema({ region, extra,
        onProgress: (done, total) => { state.progress.cinema = { done, total }; updateProgressUI(); },
        onEntry: (e) => {
          dates = trackDates([e], dates);
          e.status = statusFor(e, today);
          addEntry(m, e);
          queueRender(m);
        } });
      store.set(`rr:dates:cinema:${region}`, dates);
    } else if (m === 'soon') {
      let dates = store.get(`rr:dates:soon:${region}`, {});
      await loadSoon({ region, extra, tasks: todo, onBatch: (id, entries) => {
        dates = trackDates(entries, dates);
        for (const e of entries) { e.status = statusFor(e); addEntry(m, e); }
        state.done.add(doneKey(m, id));
        state.progress.soon.done++; updateProgressUI();
        queueRender(m);
      } });
      store.set(`rr:dates:soon:${region}`, dates);
    } else {
      const { missing } = await loadAvailable({ region, extra, services: todo, onBatch: (sid, list) => {
        for (const e of list) addEntry(m, e);
        state.done.add(doneKey(m, sid));
        state.progress.now.done++; updateProgressUI();
        queueRender(m);
      } });
      missing.forEach((id) => { state.missing.add(id); state.done.add(doneKey(m, id)); });
    }
    if (token !== tokens[m] || region !== state.region) return;
    for (const t of todo) state.done.add(doneKey(m, t));
    for (const k of [...state.stale]) if (k.startsWith(`${m}:`)) { state.data[m].delete(k.slice(m.length + 1)); state.stale.delete(k); } // gone after the refresh
    persist(m);
    if (mode() === m) render({ reveal: true });
  } catch (err) {
    if (err instanceof AuthError) { state.error[m] = 'TMDB rejected that key. Check it in Settings.'; openSettings(); }
    else state.error[m] = `Couldn't load ${MODE_LABEL[m].toLowerCase()}: ${err.message}`;
  } finally {
    setSync(-1);
    if (token === tokens[m]) { state.loading[m] = false; state.finished.add(finKey(m)); updateProgressUI(); if (mode() === m) render({ reveal: true }); }
  }
}

// ---- loading feedback: progress bar, tab spinner, status line --------------------------------
let progressRaf = 0;
function updateProgressUI() {
  cancelAnimationFrame(progressRaf);
  progressRaf = requestAnimationFrame(() => {
    const m = mode();
    const bar = $('#progress');
    const p = state.progress[m];
    bar.hidden = !state.loading[m];
    bar.classList.toggle('indet', !p.total);
    bar.style.setProperty('--p', p.total ? `${Math.max(6, Math.round((p.done / p.total) * 100))}%` : '30%');
    $('#sentence').classList.toggle('loading', state.loading[m]);
    // nothing to show yet: take over the page with a centred loader instead of an endless skeleton
    if (state.loading[m] && state.data[m].size === 0 && !state.guide.on && busyOwner !== 'ai') {
      showBusy('data', 'Loading films…', p.total ? `${p.done} of ${p.total}` : 'Contacting TMDB');
    } else hideBusy('data');
    refreshStatus();
  });
}

function refreshStatus() {
  const f = state.filters;
  if (state.guide.on) { renderWizard(); return; } // keeps the step's live counts/loading line current
  const m = f.mode;
  const region = REGIONS[state.region] || state.region;
  const n = state.lastVisible;
  if (state.error[m] && !state.data[m].size) { setNotice(state.error[m], true); return; }
  if (state.loading[m]) {
    const what = { cinema: 'cinema listings', soon: 'streaming releases', now: 'streaming catalogue' }[m];
    const p = state.progress[m];
    const prog = p.total ? ` ${p.done}/${p.total}${m === 'cinema' ? ' titles checked' : ' sources'}` : '';
    setNotice(`Loading ${what} for ${region}…${prog}${n ? ` · ${n} shown so far` : ''}`, false, true);
    return;
  }
  if (state.error[m]) { setNotice(state.error[m], true); return; }
  const loaded = state.data[m].size > 0 || [...state.done].some((k) => k.startsWith(`${m}:`));
  if (!loaded) return;
  const noun = { cinema: `${n === 1 ? 'film' : 'films'} showing or opening in ${region}`,
    soon: `${n === 1 ? 'title' : 'titles'} heading to streaming in ${region}`,
    now: `${n === 1 ? 'title' : 'titles'} streaming in ${region}` }[m];
  const missing = m !== 'cinema' ? [...state.missing].map((id) => svcOf(id)?.label).filter(Boolean) : [];
  setNotice((n ? `${n} ${noun}` : 'Nothing matches these filters.')
    + (missing.length ? ` · ${missing.join(', ')} not listed for ${region}` : ''));
}

// ---- grouping + rendering -----------------------------------------------------------------
function buildGroups(visible, f) {
  if (state.ai) {
    const sc = state.ai.scores;
    return [{ id: 'ai', label: state.ai.label, items: visible.filter((e) => sc.has(e.key)).sort((a, b) => sc.get(b.key) - sc.get(a.key)) }];
  }
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
  const star = el('button', { class: 'star', 'aria-pressed': 'false', text: 'Save' });
  star.addEventListener('click', (ev) => { ev.stopPropagation(); toggleWatch(e.key, star); });
  const poster = e.poster
    ? el('img', { class: 'poster', src: posterSrc(e.poster), alt: '', loading: 'lazy', decoding: 'async' })
    : el('div', { class: 'poster none', text: e.title[0] });
  const count = countdownLabel(e);
  const svc = svcOf(entryServices(e)[0]);
  const tags = el('div', { class: 'tags' },
    e.type !== 'movie' && el('span', { class: 'tag', text: 'TV' }),
    e.status === 'now_playing' && e._mode !== 'cinema' && mode() !== 'cinema' && el('span', { class: 'tag now_playing', text: 'In cinemas' }),
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
      el('p', { class: 'when' }, el('span', { text: sub + (e.status !== 'available' && e.runtime ? ` · ${Math.floor(e.runtime / 60)}h ${e.runtime % 60}m` : '') }),
        e.rating > 0 && el('span', { class: 'rate', title: 'TMDB rating', text: `★ ${e.rating.toFixed(1)}` })),
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
  if (star.getAttribute('aria-pressed') !== String(on)) { star.textContent = on ? 'Saved' : 'Save'; star.setAttribute('aria-pressed', String(on)); }
  star.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} watchlist: ${e.title}`);
  const pct = state.ai?.scores.get(e.key);
  let mb = c.querySelector('.match');
  if (pct != null) { if (!mb) { mb = el('span', { class: 'match' }); c.querySelector('.poster-wrap').append(mb); } mb.textContent = `✦ ${pct}% match`; } else mb?.remove();
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

// Phone tab bar: highlight the current view.
function syncBnav() {
  $$('#bnav [data-view]').forEach((b) => {
    const on = b.dataset.view === state.filters.view;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

function render({ reveal = false } = {}) {
  syncBnav();
  renderSeasonBanner();
  document.body.dataset.guide = state.guide.on ? 'on' : 'off';
  if (state.guide.on) { renderWizard(); return; }
  const f = state.filters;
  const ef = effective();
  const pool = [...state.data[f.mode].values()];
  const visible = applyFilters(pool, ef, state.watchlist);
  updateChrome(pool, ef, visible);
  document.body.dataset.mode = f.mode;
  const insights = f.view === 'insights';
  const calendar = f.view === 'calendar' && f.mode !== 'now';
  document.body.dataset.view = insights ? 'insights' : calendar ? 'calendar' : 'grid';
  if (insights) renderInsightsView(visible);
  else if (calendar) renderCal(visible);
  else { renderGrid(visible, ef, reveal); syncPeek(); }
}

function renderInsightsView(visible) {
  state.order = orderBy(visible, 'date');
  const scope = { cinema: 'in or heading to Australian cinemas', soon: 'coming to streaming', now: 'streaming now' }[mode()];
  const node = renderInsights({
    entries: visible, saved: state.watchlist, scopeLabel: scope,
    embed: (texts, status) => embedTexts(texts, status),
    onPick: (e) => detail.open(state.order.indexOf(e)),
  });
  $('#timeline').replaceChildren(node);
  $('#sentinel').textContent = '';
  $('#jump').replaceChildren();
  hasMore = false;
}

// ---- right-hand preview pane: hover (or focus) a poster to read about it ----
let peeked = null;
function peekFor(e, idx) {
  const svc = svcOf(entryServices(e)[0]);
  const bg = backdropSrc(e.backdrop) || posterSrc(e.poster);
  const facts = [
    e.cert && el('span', { class: 'cert', text: e.cert }),
    svc && el('span', { class: 'svc', style: `--c:${svc.color}`, text: svc.label }),
    e.status === 'now_playing' && el('span', { class: 'tag now_playing', text: 'In cinemas' }),
    (e.status === 'rumoured' || e.status === 'delayed') && el('span', { class: `tag ${e.status}`, text: e.status }),
    e.rating > 0 && el('span', { class: 'rate', text: `★ ${e.rating.toFixed(1)}` })];
  const sub = e.status === 'available' ? e.date.slice(0, 4) : displayDate(e);
  const count = countdownLabel(e);
  const on = state.watchlist.has(e.key);
  const open = el('button', { class: 'pk-btn primary', type: 'button', text: 'Full details' });
  open.addEventListener('click', () => detail.open(state.order.indexOf(e)));
  const save = el('button', { class: 'pk-btn', type: 'button', text: on ? '★ Saved' : '☆ Save' });
  save.addEventListener('click', () => {
    toggleWatch(e.key, document.createElement('button'));
    save.textContent = state.watchlist.has(e.key) ? '★ Saved' : '☆ Save';
    const c = [...document.querySelectorAll('.card')].find((x) => x._e === e);
    const star = c?.querySelector('.star');
    if (star) { const w = state.watchlist.has(e.key); star.textContent = w ? 'Saved' : 'Save'; star.setAttribute('aria-pressed', String(w)); }
  });
  return el('div', { class: 'pk' },
    el('div', { class: 'pk-hero' }, bg ? el('img', { src: bg, alt: '' }) : null),
    el('div', { class: 'pk-body' },
      el('div', { class: 'pk-facts' }, ...facts),
      el('h2', { text: e.title }),
      el('p', { class: 'pk-sub', text: [sub, count, e.status !== 'available' && e.runtime ? `${Math.floor(e.runtime / 60)}h ${e.runtime % 60}m` : null].filter(Boolean).join(' · ') }),
      e.genres?.length > 0 && el('div', { class: 'pk-genres' }, ...e.genres.map((g) => el('span', { text: g }))),
      el('p', { class: 'pk-over', text: e.overview || 'No synopsis yet.' }),
      el('div', { class: 'pk-actions' }, open, save),
      (() => { const sim = el('button', { class: 'pk-btn ai', type: 'button', text: '✦ Find similar titles' }); sim.addEventListener('click', () => runAI('similar', e)); return sim; })()));
}
// ---- personal touches: a greeting that knows your taste, and a page that takes on the colour of what you're viewing ----
function tasteGenres() {
  const counts = new Map();
  const pool = [...state.data.cinema.values(), ...state.data.soon.values(), ...state.data.now.values()];
  for (const e of pool) if (state.watchlist.has(e.key)) for (const g of e.genres || []) counts.set(g, (counts.get(g) || 0) + 1);
  const picked = state.filters.genres || [];
  return [...new Set([...[...counts].sort((a, b) => b[1] - a[1]).map(([g]) => g), ...picked])].slice(0, 3);
}
function hello(visible) {
  if (state.ai || state.filters.watch === 'only' || !visible.length || sessionStorage.getItem('rr:helloOff')) return null;
  const h = now().getHours();
  const part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const today = ymd(now()), week = addDays(today, 7);
  const soon = visible.filter((e) => e.date >= today && e.date <= week && e.status !== 'available');
  const likes = tasteGenres();
  const match = (e) => likes.filter((g) => e.genres?.includes(g)).length;
  const pick = [...(soon.length ? soon : visible)].sort((a, b) => match(b) - match(a) || (b.rating || 0) - (a.rating || 0))[0];
  if (!pick) return null;
  const why = likes.length && match(pick) ? `Because you like ${likes.filter((g) => pick.genres?.includes(g)).join(' & ')}` : soon.length ? 'Top pick this week' : 'Worth a look';
  const bg = backdropSrc(pick.backdrop) || posterSrc(pick.poster);
  const open = el('button', { class: 'hello-pick', type: 'button' },
    pick.poster && el('img', { src: posterSrc(pick.poster, 'w185'), alt: '' }),
    el('span', {}, el('small', { text: why }), el('b', { text: pick.title }), el('em', { text: [displayDate(pick), countdownLabel(pick)].filter(Boolean).join(' · ') })));
  open.addEventListener('click', () => { showPeek(pick); detail.open(state.order.indexOf(pick)); });
  const x = el('button', { class: 'hello-x', type: 'button', 'aria-label': 'Dismiss greeting', text: '×' });
  x.addEventListener('click', () => {
    try { sessionStorage.setItem('rr:helloOff', '1'); } catch { /* ignore */ }
    const h = x.closest('.hello'); h.classList.add('leaving');
    setTimeout(() => h.remove(), 380);
  });
  return el('section', { class: 'hello', style: bg && !bg.startsWith('data:') ? `--bg-img:url(${bg})` : '' },
    el('div', { class: 'hello-copy' },
      el('h2', { text: `${part}.` }),
      el('p', { text: soon.length ? `${soon.length} ${soon.length === 1 ? 'title is' : 'titles are'} arriving in the next 7 days${likes.length ? `, tuned to ${likes.join(', ')}` : ''}.` : `${visible.length} titles match your search${likes.length ? `, tuned to ${likes.join(', ')}` : ''}.` }),
      state.watchlist.size
        ? aiButton('✦ Rank everything by my taste', () => runAI('taste'))
        : el('p', { class: 'ai-tip', text: '✦ Tip: describe a mood in the search box (“tense space thriller with a twist”) and press Enter.' })),
    open, x);
}

// ---- on-device AI: semantic search, "more like this" and taste matching ----
function aiButton(text, fn) { const b = el('button', { class: 'ai-cta', type: 'button', text }); b.addEventListener('click', fn); return b; }

let aiRun = 0;
async function runAI(kind, arg) {
  const f = state.filters;
  const visible = applyFilters([...state.data[f.mode].values()], effective(), state.watchlist);
  if (!visible.length) return;
  const all = new Map();
  for (const m of ['cinema', 'soon', 'now']) for (const e of state.data[m].values()) all.set(e.key, e);
  const anchors = kind === 'similar' ? [arg] : kind === 'taste' ? [...state.watchlist].map((k) => all.get(k)).filter(Boolean) : [];
  if (kind === 'taste' && !anchors.length) { setNotice('Save a few titles first so there is a taste to learn from.'); return; }
  const run = ++aiRun;
  showBusy('ai', kind === 'query' ? 'Understanding your search' : kind === 'similar' ? 'Finding similar titles' : 'Learning your taste',
    'Starting the on-device model…', () => { aiRun++; hideBusy('ai'); refreshStatus(); });
  try {
    const texts = visible.map(entryText), extra = anchors.map(entryText), qt = kind === 'query' ? [arg] : [];
    const { engine, vectors } = await embedTexts([...texts, ...extra, ...qt], (m) => { if (run === aiRun) setBusy(m); });
    if (run !== aiRun) return; // cancelled while the model was working
    const items = visible.map((e, i) => ({ key: e.key, vec: vectors[i] }));
    const q = kind === 'query' ? vectors[texts.length + extra.length] : centroid(vectors.slice(texts.length, texts.length + extra.length));
    const exclude = new Set(kind === 'query' ? [] : anchors.map((a) => a.key));
    // keep only genuine matches: below the engine's relevance floor a title is not similar at all
    const ranked = rank(q, items, { exclude, limit: 80 }).map((r) => ({ ...r, pct: calibrate(r.score, engine.neural) })).filter((r) => r.pct != null);
    if (!ranked.length) { setNotice(kind === 'similar' ? `Nothing here is a close match for “${arg.title}”.` : 'Nothing here is a close match. Try different words or looser filters.'); return; }
    const label = kind === 'similar' ? `More like “${arg.title}”` : kind === 'query' ? `Matches “${arg}”`
      : `Picked for your taste, from ${anchors.length} saved ${anchors.length === 1 ? 'title' : 'titles'}`;
    state.ai = { kind, label, engine: engine.name, neural: engine.neural, scores: new Map(ranked.map((r) => [r.key, r.pct])) };
    state.limit = PAGE;
    if (scrollY > 0) scrollTo({ top: 0, behavior: 'auto' });
    withTransition(() => render());
  } catch (err) {
    console.error(err); setNotice('The AI ranking failed; see the console.', true);
  } finally {
    if (run === aiRun) hideBusy('ai');
  }
}
function aiBar() {
  const clear = el('button', { class: 'linkbtn', type: 'button', text: 'Clear' });
  clear.addEventListener('click', () => { state.ai = null; withTransition(() => render()); });
  return el('div', { class: 'ai-bar' },
    el('span', { class: 'ai-mark', text: '✦' }),
    el('div', {}, el('b', { text: state.ai.label }), el('small', { text: `Ranked by meaning, on your device · ${state.ai.engine}` })),
    clear);
}
const ambCache = new Map();
function ambient(e) {
  return; // the Video Shop theme is flat colour: no poster-tinted glow
  const src = e.poster ? posterSrc(e.poster, 'w185') : '';
  if (!src) return;
  const apply = (c) => document.documentElement.style.setProperty('--amb', c);
  if (ambCache.has(src)) return apply(ambCache.get(src));
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 16;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      let r = 0, gr = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        const wt = (mx - mn) + 8; // favour vivid pixels
        r += d[i] * wt; gr += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
      }
      const col = `rgb(${Math.round(r / w)}, ${Math.round(gr / w)}, ${Math.round(b / w)})`;
      ambCache.set(src, col); if (peeked === e) apply(col);
    } catch { /* tainted canvas: keep the default glow */ }
  };
  img.src = src;
}
// While you hover a title, fetch its full details quietly (cached for a day), so clicking it is instant.
const prefetched = new Set();
let prefetchTimer = 0;
function prefetchDetail(e) {
  if (DEMO || prefetched.has(e.key)) return;
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => { if (peeked !== e) return; prefetched.add(e.key); loadDetail(e, state.region).catch(() => prefetched.delete(e.key)); }, 250);
}
function showPeek(e) {
  const box = $('#peek');
  if (!box || !e || peeked === e) return;
  peeked = e;
  box.replaceChildren(peekFor(e));
  posterTint(e.poster); // warm the detail dialog's colour so it opens already tinted
  prefetchDetail(e);    // and its full details, so the dialog opens with everything already there
  ambient(e);
}
function syncPeek() {
  const box = $('#peek');
  if (!box) return;
  if (peeked && state.order.includes(peeked)) { const e = peeked; peeked = null; showPeek(e); return; }
  peeked = null;
  if (state.order[0]) showPeek(state.order[0]);
  else box.replaceChildren();
}
// Hover intent: only switch once the pointer has rested on a poster, so sweeping across
// other posters on the way to the pane doesn't change what you're reading.
let peekTimer = 0;
const tl = $('#timeline');
tl.addEventListener('mouseover', (ev) => {
  const c = ev.target.closest?.('.card');
  clearTimeout(peekTimer);
  if (c?._e && c._e !== peeked) peekTimer = setTimeout(() => showPeek(c._e), 350);
});
tl.addEventListener('mouseleave', () => clearTimeout(peekTimer));
tl.addEventListener('focusin', (ev) => { const c = ev.target.closest?.('.card'); if (c?._e) { clearTimeout(peekTimer); showPeek(c._e); } });


function renderGrid(visible, ef, reveal) {
  let groups = buildGroups(visible, ef);
  if (ef.q && state.remote.length) { // live TMDB search results beyond what's loaded
    const have = new Set([...state.data.cinema.keys(), ...state.data.soon.keys(), ...state.data.now.keys()]);
    const more = applyFilters(state.remote.filter((r) => !have.has(r.key)),
      { ...DEFAULT_FILTERS, mode: 'now', format: ef.format, genres: ef.genres, genreMode: ef.genreMode, lang: ef.lang }, new Set());
    if (more.length) groups = [...groups, { id: 'remote', label: 'More matches on TMDB (any service or date)', items: more.slice(0, 24) }];
  }
  state.groups = groups;
  state.order = [];
  document.body.dataset.empty = groups.length ? 'off' : 'on';
  if (!groups.length) { // still loading -> skeletons so it never looks like "no results"; otherwise a real empty state
    const m = state.filters.mode;
    const waiting = state.loading[m] || (!state.data[m].size && !state.error[m] && !state.finished.has(finKey(m)));
    $('#timeline').replaceChildren(waiting ? skeletonNode() : emptyNode(state.data[m].size > 0, state.error[m]));
    $('#sentinel').textContent = ''; $('#sentinel').classList.remove('loading');
    $('#jump').replaceChildren();
    hasMore = false;
    return;
  }
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
  const hi = hello(visible);
  if (hi) root.prepend(hi);
  if (state.ai) root.prepend(aiBar());
  $('#timeline').replaceChildren(root);
  const sentinel = $('#sentinel');
  sentinel.classList.toggle('loading', hasMore);
  sentinel.textContent = hasMore ? 'Loading more…' : (visible.length > PAGE ? "That's everything" : '');
  $('#jump').replaceChildren(...(groups.length > 3 ? groups : []).map((g) => {
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

const skeletonNode = () => el('section', { class: 'month skeleton-wrap', 'aria-busy': 'true' },
  el('div', { class: 'sk-head', role: 'status' }, el('i', { class: 'sk-spin', 'aria-hidden': 'true' }),
    el('span', { text: state.season ? `Finding ${SEASONS[state.season].label.toLowerCase()} titles…` : 'Finding films…' })),
  el('div', { class: 'cards' }, ...Array.from({ length: 16 }, (_, i) =>
    el('article', { class: 'card skeleton', style: `--d:${i * 35}ms` },
      el('div', { class: 'poster-wrap' }),
      el('div', { class: 'meta' }, el('i', { class: 'sk w80' }), el('i', { class: 'sk w60' }))))));

function showSkeleton() {
  $('#jump').replaceChildren();
  $('#timeline').replaceChildren(skeletonNode());
}

function emptyNode(hasData, error = '') {
  const clear = el('button', { class: 'btn primary', type: 'button', text: 'Clear all filters' });
  clear.addEventListener('click', reset);
  if (error) { // a real failure: say what happened and offer the one obvious next step
    const retry = el('button', { class: 'btn primary', type: 'button', text: 'Try again' });
    retry.addEventListener('click', reloadAll);
    return el('div', { class: 'empty-state' }, el('h3', { text: 'Couldn’t load titles' }), el('p', { text: error }), retry);
  }
  // Point at the parts of the sentence that are narrowing things, so the fix is one click.
  const ef = effective();
  const narrowing = [
    ['genre', ef.genres.length && 'genre'],
    ['where', ef.mode !== 'cinema' && ef.services.length && 'service'],
    ['media', ef.mode !== 'cinema' && ef.format !== 'all' && 'movies/TV'],
    ['when', ef.mode !== 'now' && ef.when !== 'all' && 'dates'],
  ].filter(([, label]) => label);
  const hints = hasData && narrowing.length ? el('div', { class: 'empty-hints' }, el('span', { text: 'Try loosening:' }),
    ...narrowing.map(([step, label]) => {
      const b = el('button', { class: 'tok', type: 'button', text: label });
      b.addEventListener('click', () => openStepDialog(step));
      return b;
    })) : null;
  return el('div', { class: 'empty-state' },
        el('h3', { text: hasData ? 'Nothing matches your search' : 'No titles to show yet' }),
    el('p', { text: hasData ? 'Your sentence above is quite specific. Change a phrase, or start fresh.' : 'Check your API key and region in Settings, then press Refresh.' }),
    hints, hasData && clear);
}

// ---- chrome: tabs, filter bar, chips, status line -------------------------------------------
let bar;
function updateChrome(pool, ef, visible) {
  const f = state.filters;
  // the story sentence: the whole search as words, each highlighted phrase editable
  const parts = storySentence(ef, { regionAdj: REGION_ADJ[state.region] || REGIONS[state.region] || state.region,
    serviceLabel: (id) => svcOf(id)?.label ?? id });
  $('#sentence').replaceChildren(...parts.map((p) => {
    if (!p.step) return el('span', { class: 'w', text: p.text });
    const b = el('button', { type: 'button', class: 'tok', 'data-step': p.step, text: p.text, title: 'Change this' });
    b.addEventListener('click', () => openStepDialog(p.step));
    return b;
  }));
  $$('#view-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === f.view)));
  $('#watch-btn').setAttribute('aria-pressed', String(f.watch === 'only'));
  const refineCount = (ef.status !== 'all' ? 1 : 0) + (ef.lang !== 'all' ? 1 : 0) + ef.certs.length
    + (ef.rtMin > 0 || ef.rtMax < RUNTIME_MAX ? 1 : 0) + (ef.minRating ? 1 : 0) + (ef.when === 'custom' ? 1 : 0);
  $('#refine-badge').hidden = !refineCount;
  $('#refine-badge').textContent = String(refineCount);
  if (state.stepDialog && $('#step-dialog').open) renderStepDialog();

  // filter bar with faceted counts (each facet ignores its own filter)
  const base = (over) => applyFilters(pool, { ...ef, ...over }, state.watchlist);
  const serviceCounts = new Map();
  for (const e of base({ services: [] })) for (const id of entryServices(e)) serviceCounts.set(id, (serviceCounts.get(id) || 0) + 1);
  bar.update({
    f: ef, mode: f.mode,
    allGenres: genreFacets(pool).map(([g]) => g),
    genreCounts: new Map(genreFacets(base({ genres: [] }))),
    certCounts: certFacets(base({ certs: [] })),
    serviceCounts,
  });

  // active chips
  const chips = activeChips(ef, f.mode, { story: true });
  $('#active').replaceChildren(...chips.map((c) => {
    const b = el('button', { class: 'achip', type: 'button', 'aria-label': `Remove filter ${c.label}` }, c.label, el('i', { text: '×' }));
    b.addEventListener('click', () => patch(c.patch));
    return b;
  }));
  $('#activebar').hidden = chips.length === 0;

  // status line + loading indicators
  state.lastVisible = visible.length;
  refreshStatus();
  $('#sentence').classList.toggle('loading', state.loading[f.mode]);
  $('#progress').hidden = !state.loading[f.mode];
  $('#region-btn').textContent = `Region: ${state.region}`;
}

function patch(p) {
  if ('mode' in p) state.ai = null;
  Object.assign(state.filters, p);
  const { q, ...persistable } = state.filters;
  store.set('rr:filters2', persistable);
  state.limit = PAGE;
  if (!state.filters.mode) state.filters.mode = 'cinema';
  if (state.guide.on) render(); else withTransition(() => render());
  if ('services' in p && mode() !== 'cinema') ensure(mode()); // a newly chosen service may need loading
  if (state.filters.view !== 'calendar' && scrollY > 0) scrollTo({ top: 0, behavior: 'auto' });
}

function reset() {
  state.ai = null;
  const { mode: m, view, sort, group } = state.filters;
  $('#q').value = '';
  state.remote = [];
  patch({ ...DEFAULT_FILTERS, mode: m, view, sort, group, q: '' });
  ensure(mode());
}

// ---- the story: guided questions + editing one phrase ---------------------------------------------
function stepContext(showCurrent = true) {
  const f = state.filters;
  const ef = effective();
  const pool = [...state.data[f.mode].values()];
  const base = (over) => applyFilters(pool, { ...ef, ...over }, state.watchlist);
  const serviceCounts = new Map();
  for (const e of base({ services: [] })) for (const id of entryServices(e)) serviceCounts.set(id, (serviceCounts.get(id) || 0) + 1);
  const m = f.mode;
  const p = state.progress[m];
  const status = state.loading[m]
    ? `Loading titles for ${REGIONS[state.region] || state.region}…${p.total ? ` ${p.done}/${p.total}` : ''} (counts update as they arrive)` : '';
  return { f: ef, showCurrent, loaded: pool.length > 0, allGenres: genreFacets(pool).map(([g]) => g),
    genreCounts: new Map(genreFacets(base({ genres: [] }))), serviceCounts, status,
    // a few well-rated titles with posters for a genre, so the picker can show what it means
    examples: (() => {
      let list = null; const memo = new Map();
      return (g) => {
        if (memo.has(g)) return memo.get(g);
        list ||= base({ genres: [] }).filter((e) => e.poster);
        const out = list.filter((e) => (e.genres || []).includes(g))
          .sort((a, b) => ((b.rating || 0) * Math.log10(10 + (b.popularity || 0))) - ((a.rating || 0) * Math.log10(10 + (a.popularity || 0)))).slice(0, 4);
        memo.set(g, out); return out;
      };
    })() };
}

function applyChoice(p) {
  const modeChange = 'mode' in p && p.mode !== mode();
  patch(p);
  if (modeChange) ensure(p.mode);
}

const wizardApi = {
  set: (p) => applyChoice(p),
  pick: (p) => { applyChoice(p); state.guide.touched.add(state.guide.step); setTimeout(() => advance(), 190); },
};
const dialogApi = {
  set: (p) => applyChoice(p),
  pick: (p) => { applyChoice(p); setTimeout(() => $('#step-dialog').close(), 150); },
};

function advance() {
  const steps = stepsFor(mode());
  const i = steps.indexOf(state.guide.step);
  if (i < steps.length - 1) { state.guide.step = steps[i + 1]; state.guide.animate = true; render(); }
  else finishGuide();
}

function back() {
  const steps = stepsFor(mode());
  const i = steps.indexOf(state.guide.step);
  if (i > 0) { state.guide.step = steps[i - 1]; state.guide.animate = true; render(); }
}

function finishGuide() {
  state.guide.on = false;
  store.set('rr:storyDone', true);
  state.limit = PAGE;
  document.body.dataset.guide = 'off';
  scrollTo({ top: 0, behavior: 'auto' });
  render({ reveal: true });
}

function closeOpenDialogs() { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); }
function startOver() {
  const { view, sort, group } = state.filters;
  $('#q').value = ''; state.remote = [];
  Object.assign(state.filters, { ...DEFAULT_FILTERS, view, sort, group, q: '' });
  store.set('rr:filters2', { ...state.filters, q: undefined });
  state.guide = { on: true, step: 'what', animate: true, touched: new Set() };
  state.limit = PAGE;
  scrollTo({ top: 0, behavior: 'auto' });
  render();
}

function renderWizard() {
  const w = $('#wizard');
  const steps = stepsFor(mode());
  if (!steps.includes(state.guide.step)) state.guide.step = steps[0];
  const step = state.guide.step;
  const idx = steps.indexOf(step);
  const ctx = stepContext(state.guide.touched.has(step)); // nothing is pre-selected until you answer it

  const dots = el('ol', { class: 'wiz-steps', 'aria-label': 'Progress' }, ...steps.map((s, i) =>
    el('li', { class: i < idx ? 'done' : i === idx ? 'cur' : '', 'aria-current': i === idx ? 'step' : null },
      el('i', { text: String(i + 1) }), el('span', { text: STEP_LABEL[s] }))));

  const stepEl = buildStep(step, ctx, wizardApi);
  if (state.guide.animate) stepEl.classList.add('enter');
  state.guide.animate = false;

  const foot = el('div', { class: 'wiz-foot' });
  if (idx > 0) { const b = el('button', { class: 'btn', type: 'button', text: '← Back' }); b.addEventListener('click', back); foot.append(b); }
  const skip = el('button', { class: 'linkbtn wiz-skip', type: 'button', text: idx === 0 ? 'Skip the questions' : 'Show results now' });
  skip.addEventListener('click', finishGuide);
  foot.append(skip);
  if (isMulti(step)) {
    const chosen = step === 'genre' ? ctx.f.genres.length : ctx.f.services.length;
    const label = chosen ? `Continue with ${chosen} selected →` : step === 'genre' ? 'Any genre, continue →' : 'Any service, continue →';
    const next = el('button', { class: 'btn primary', type: 'button', text: label });
    next.addEventListener('click', advance);
    foot.append(next);
  }
  w.replaceChildren(dots, stepEl, foot);
}

function renderStepDialog() {
  const d = $('#step-dialog');
  const step = state.stepDialog;
  const close = el('button', { class: 'd-close', 'aria-label': 'Close', type: 'button', text: '×' });
  close.addEventListener('click', () => d.close());
  const done = el('button', { class: 'btn primary', type: 'button', text: 'Done' });
  done.addEventListener('click', () => d.close());
  const stepEl = buildStep(step, stepContext(), dialogApi);
  d.replaceChildren(close, stepEl, el('div', { class: 'step-dialog-foot' }, done));
}

function openStepDialog(step) {
  state.stepDialog = step;
  renderStepDialog();
  const d = $('#step-dialog');
  if (!d.open) d.showModal();
}

// ---- watchlist, export ----------------------------------------------------------------------
function toggleWatch(key, starEl, quiet = false) {
  const on = !state.watchlist.has(key);
  on ? state.watchlist.add(key) : state.watchlist.delete(key);
  if (!quiet) {
    const t = allLoaded().find((e) => e.key === key)?.title;
    toast(`${on ? 'Saved' : 'Removed'}${t ? ` “${t}”` : ''}${on ? ' to your watchlist' : ' from your watchlist'}`, () => toggleWatch(key, null, true));
  }
  store.set('rr:watchlist', [...state.watchlist]);
  if (state.filters.watch === 'only') { withTransition(() => render()); return; }
  if (starEl) { starEl.textContent = on ? 'Saved' : 'Save'; starEl.setAttribute('aria-pressed', String(on)); starEl.classList.remove('pop'); void starEl.offsetWidth; starEl.classList.add('pop'); }
  $$('.card').forEach((c) => {
    const s = $('.star', c);
    if (c._e?.key === key && s && s !== starEl) { s.textContent = on ? 'Saved' : 'Save'; s.setAttribute('aria-pressed', String(on)); }
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
  fetchDetail: (e) => (DEMO ? Promise.resolve(demoDetail(e, [...state.data.cinema.values(), ...state.data.soon.values(), ...state.data.now.values()])) : loadDetail(e, state.region)),
});

const lab = createLab({
  dialog: $('#lab'),
  onSearch: (q) => { if (state.guide.on) { state.guide.on = false; store.set('rr:storyDone', true); } if (state.filters.view === 'insights') patch({ view: 'grid' }); runAI('query', q); },
  onSimilar: () => { if (state.filters.view === 'insights') patch({ view: 'grid' }); const e = peeked || state.order[0]; if (e) runAI('similar', e); },
  onInsights: () => { if (state.guide.on) { state.guide.on = false; store.set('rr:storyDone', true); } patch({ view: 'insights' }); },
});
$('#lab-btn').addEventListener('click', () => lab.open());
const allLoaded = () => { const m = new Map(); for (const k of ['cinema', 'soon', 'now']) for (const e of state.data[k].values()) m.set(e.key, e); return [...m.values()]; };
const night = createNight({
  dialog: $('#night'), getAll: allLoaded, entryText,
  getCandidates: () => { const v = applyFilters([...state.data[state.filters.mode].values()], effective(), state.watchlist); return v.length ? v : allLoaded(); },
  embed: (texts, onStatus) => embedTexts(texts, onStatus),
  onPick: (e) => { $('#night').close(); let i = state.order.indexOf(e); if (i < 0) { state.order.push(e); i = state.order.length - 1; } detail.open(i); },
});
$('#night-btn').addEventListener('click', () => night.open());
if (DEMO && PARAMS.has('night')) setTimeout(() => (PARAMS.get('night') === 'run' ? (night.open(), night.example()) : night.open()), 400);
if (DEMO && PARAMS.has('lab')) setTimeout(() => lab.open(), 300);

// ---- seasonal themes ----------------------------------------------------------------------
let seasonSuggestDismissed = false;
try { seasonSuggestDismissed = !!sessionStorage.getItem('rr:seasonHint'); } catch { /* ignore */ }

const fx = createFx();
function syncFxButton() {
  const b = $('#fx-btn');
  if (!b) return;
  b.textContent = `✨ Seasonal animations: ${fx.enabled ? 'on' : 'off'}`;
  b.hidden = !state.season; // only meaningful while a season is selected
}
$('#fx-btn')?.addEventListener('click', () => { fx.toggle(); syncFxButton(); });

function applySeasonDom() {
  const root = document.documentElement;
  if (state.season) root.dataset.season = state.season; else root.removeAttribute('data-season');
  fx.set(state.season);
  syncFxButton();
  $$('.season-pick button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.season === state.season)));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--deep').trim() || '#0a0a0a';
}

function setSeason(id) {
  id = SEASON_IDS.includes(id) ? id : '';
  if (id === state.season) return;
  state.season = id;
  store.set('rr:season', id);
  seasonSuggestDismissed = true;
  applySeasonDom();
  // different titles for a different season: start clean (the TMDB cache keeps it quick)
  for (const m of Object.values(state.data)) m.clear();
  state.done.clear(); state.hydrated.clear(); state.missing.clear(); state.stale.clear(); state.seen.clear(); cardCache.clear(); state.finished.clear();
  state.ai = null; state.limit = PAGE; state.remote = [];
  scrollTo({ top: 0, behavior: 'auto' });
  toast(id ? `${SEASONS[id].emoji} ${SEASONS[id].label} mode on: showing ${SEASONS[id].label.toLowerCase()} titles only` : 'Back to everything');
  ensure(mode());
  render();
}

function renderSeasonBanner() {
  const box = $('#season-banner');
  if (!box) return;
  if (state.season) {
    const S = SEASONS[state.season];
    const off = el('button', { type: 'button', class: 'sb-btn', text: 'Show everything' });
    off.addEventListener('click', () => setSeason(''));
    box.replaceChildren(el('div', { class: 'wrap sb-in' }, el('span', { class: 'sb-emoji', 'aria-hidden': 'true', text: S.emoji }),
      el('p', {}, el('b', { text: `${S.label} mode` }), ` · ${S.blurb}.`), off));
    box.hidden = false; box.dataset.kind = 'active';
    return;
  }
  const hint = !seasonSuggestDismissed && !state.guide.on ? seasonFor(now()) : '';
  if (!hint) { box.hidden = true; box.replaceChildren(); return; }
  const S = SEASONS[hint];
  const on = el('button', { type: 'button', class: 'sb-btn primary', text: `Turn on ${S.label} mode` });
  on.addEventListener('click', () => setSeason(hint));
  const x = el('button', { type: 'button', class: 'sb-x', 'aria-label': 'Dismiss', text: '✕' });
  x.addEventListener('click', () => { seasonSuggestDismissed = true; try { sessionStorage.setItem('rr:seasonHint', '1'); } catch { /* ignore */ } renderSeasonBanner(); });
  box.replaceChildren(el('div', { class: 'wrap sb-in' }, el('span', { class: 'sb-emoji', 'aria-hidden': 'true', text: S.emoji }),
    el('p', {}, el('b', { text: `${S.hint}.` }), ' Want only the films and shows that fit?'), on, x));
  box.hidden = false; box.dataset.kind = 'hint';
}
document.querySelectorAll('.season-pick button').forEach((b) => b.addEventListener('click', () => setSeason(b.dataset.season)));
applySeasonDom();

function openHelp() {
  const d = $('#help');
  const row = (k, t) => el('li', {}, el('kbd', { text: k }), el('span', { text: t }));
  const close = el('button', { class: 'd-close', type: 'button', 'aria-label': 'Close', text: '✕' });
  close.addEventListener('click', () => d.close());
  d.replaceChildren(el('div', { class: 'help-in' }, close,
    el('h2', { text: 'Getting around' }),
    el('div', { class: 'help-cols' },
      el('section', {}, el('h3', { text: 'Keyboard' }), el('ul', {},
        row('/', 'Search for a title, or describe a mood'), row('1  2  3', 'Grid, Calendar, Insights'), row('M', 'Movie Night (group pick)'),
        row('← →', 'Previous / next title when one is open'), row('Esc', 'Close whatever is open'), row('?', 'This help'))),
      el('section', {}, el('h3', { text: 'Tips' }), el('ul', { class: 'tips' },
        el('li', { text: 'Click any phrase in the “Showing…” sentence to change it.' }),
        el('li', { text: 'Hover or focus a poster to preview it on the right.' }),
        el('li', { text: 'Save titles, then use “Rank everything by my taste”.' }),
        el('li', { text: 'Dates are Australian and can change. Uncertain ones are marked.' }),
        el('li', { text: 'The browser Back button closes dialogs.' })))),
    el('p', { class: 'help-foot', text: 'Everything runs in your browser. Nothing you watch or save leaves your device.' })));
  if (!d.open) d.showModal();
}

function openSettings() {
  $('#key-input').value = store.get('rr:key', '');
  $('#key-input').placeholder = envKey ? 'Using the key from .env (leave blank)' : '';
  $('#region-input').value = state.region;
  if (!$('#settings').open) $('#settings').showModal();
}

function reloadAll() {
  clearCache();
  try { Object.keys(localStorage).filter((k) => k.startsWith('rr:snap')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  // Seamless refresh: keep what's on screen, mark it stale, and swap in fresh data as it arrives.
  state.stale.clear();
  for (const [m, map] of Object.entries(state.data)) for (const k of map.keys()) state.stale.add(`${m}:${k}`);
  state.done.clear(); state.hydrated.clear(); state.missing.clear(); cardCache.clear();
  state.limit = PAGE;
  ensure(mode());
}

// Offline-capable app shell and image cache (not in demo mode, which is for screenshots).
if ('serviceWorker' in navigator && !DEMO && !PARAMS.has('nosw')) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

function init() {
  $('#region-input').replaceChildren(...Object.entries(REGIONS).map(([c, n]) => el('option', { value: c, text: `${n} (${c})` })));
  $('#demo-note').hidden = !DEMO;
  $('#region-btn').textContent = `Region: ${state.region}`;
  if (DEMO) $('#q').value = state.filters.q;

  bar = createFilterBar({ mount: $('#filterbar'), getF: () => state.filters, patch, onExport: doExport,
    exclude: ['genre', 'services', 'format'], showWatch: false, // the story covers these
    onWatch: () => {} });

  $('#refine-btn').addEventListener('click', () => {
    const open = $('#refine').hidden;
    $('#refine').hidden = !open;
    $('#refine-btn').setAttribute('aria-expanded', String(open));
    if (!open) bar.close();
  });
  $('#restart-btn').addEventListener('click', startOver);
$('#home-link').addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); closeOpenDialogs(); startOver(); });
  $('#watch-btn').addEventListener('click', () => patch({ watch: state.filters.watch === 'only' ? 'all' : 'only' }));
  $('#step-dialog').addEventListener('click', (ev) => { if (ev.target === $('#step-dialog')) $('#step-dialog').close(); });
  $('#step-dialog').addEventListener('close', () => { state.stepDialog = null; });

  // keep sticky offsets (jump bar, scroll targets) in step with the story bar's real height
  new ResizeObserver(() => document.documentElement.style.setProperty('--stick', `${$('#stickwrap').offsetHeight}px`)).observe($('#stickwrap'));

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
    if (state.guide.on && q) { state.guide.on = false; store.set('rr:storyDone', true); }
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
  // Describe a vibe (3+ words) and press Enter: semantic search, ranked by meaning on-device.
  $('#q').addEventListener('keydown', (ev) => {
    const text = ev.target.value.trim();
    if (ev.key !== 'Enter' || text.split(/\s+/).length < 3) return;
    ev.preventDefault();
    ev.target.value = ''; state.filters.q = ''; state.remote = [];
    if (state.guide.on) { state.guide.on = false; store.set('rr:storyDone', true); }
    runAI('query', text);
  });
  addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const open = document.querySelector('dialog[open]');
    if (ev.key === '?' ) { ev.preventDefault(); open ? null : openHelp(); return; }
    if (open || state.guide.on) { if (ev.key === '/' && !open) { ev.preventDefault(); $('#q').focus(); } return; }
    if (ev.key === '/') { ev.preventDefault(); $('#q').focus(); }
    else if (ev.key === '1') patch({ view: 'grid' });
    else if (ev.key === '2') patch({ view: 'calendar' });
    else if (ev.key === '3') patch({ view: 'insights' });
    else if (ev.key === 'm') night.open();
  });
  $('#help-btn').addEventListener('click', openHelp);

  // Back button / swipe-back closes whatever dialog is open, instead of leaving the app.
  const proto = HTMLDialogElement.prototype, nativeShow = proto.showModal;
  proto.showModal = function (...a) {
    nativeShow.apply(this, a);
    if (!this._hist) { this._hist = true; this.addEventListener('close', () => { if (history.state?.rrDlg === this.id) history.replaceState(null, ''); }); }
    history.pushState({ rrDlg: this.id }, '');
  };
  addEventListener('popstate', () => { const d = [...document.querySelectorAll('dialog[open]')].pop(); if (d) d.close(); });

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
    if (DEMO && $('#key-input').value.trim()) { location.replace(location.pathname); return; } // key added: leave the demo for real data
    $('#region-btn').textContent = `Region: ${state.region}`;
    reloadAll();
  });

  try { Object.keys(localStorage).filter((k) => /^rr:(snap|nowsnap|snap2|nowsnap2|cache):/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }

  if (DEMO && PARAMS.has('cal')) { const [y, m] = PARAMS.get('cal').split('-').map(Number); state.cal = { y, m: m - 1, expanded: null }; }
  // First visit (or ?guide=1): ask the questions. Returning visitors go straight to their results.
  state.guide = { on: DEMO ? PARAMS.get('guide') === '1' || PARAMS.has('step') : !store.get('rr:storyDone', false), step: PARAMS.get('step') && DEMO ? PARAMS.get('step') : 'what', animate: true, touched: new Set() };
  ensure(mode());
  if (DEMO && PARAMS.has('ai')) setTimeout(() => runAI('query', PARAMS.get('ai')), 500);
  if (DEMO && PARAMS.has('edit')) setTimeout(() => openStepDialog(PARAMS.get('edit')), 400);
  if (DEMO && PARAMS.has('refine')) { $('#refine').hidden = false; $('#refine-btn').setAttribute('aria-expanded', 'true'); }
  if (DEMO && PARAMS.has('open')) setTimeout(() => bar.open(PARAMS.get('open')), 300);
  if (DEMO && PARAMS.get('detail') != null) setTimeout(() => detail.open(Number(PARAMS.get('detail'))), 600);
  if (DEMO && PARAMS.has('play')) setTimeout(() => $('.d-play')?.click(), 1500);
}

// TMDB key from .env, served by scripts/serve.py. A key typed into Settings overrides it.
let envKey = '';
try { envKey = ((await (await fetch('config.json', { cache: 'no-store' })).json()).tmdbKey || '').trim(); } catch { /* no server config */ }
// No key anywhere (typical on a static host such as GitHub Pages): open the demo instead of an empty page.
// `?nodemo` skips this, e.g. to see the first-run "add your key" prompt.
if (!DEMO && !envKey && !PROXY_URL && !store.get('rr:key', '') && !PARAMS.has('nodemo')) {
  location.replace(`${location.pathname}?demo`);
  await new Promise(() => {}); // stop here while the browser navigates
}
init();

// ---- motion: poster tilt + cursor spotlight (skipped for touch and reduced motion) ----
if (matchMedia('(hover: hover)').matches && !reduced) {
  let raf = 0;
  addEventListener('pointermove', (ev) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = document.documentElement.style;
      r.setProperty('--px', `${ev.clientX}px`); r.setProperty('--py', `${ev.clientY}px`);
      const w = ev.target.closest?.('.card')?.querySelector('.poster-wrap');
      if (w) {
        const b = w.getBoundingClientRect();
        const x = (ev.clientX - b.left) / b.width, y = (ev.clientY - b.top) / b.height;
        w.style.setProperty('--ry', `${((x - .5) * 14).toFixed(1)}deg`);
        w.style.setProperty('--rx', `${((.5 - y) * 14).toFixed(1)}deg`);
        w.style.setProperty('--mx', `${(x * 100).toFixed(0)}%`); w.style.setProperty('--my', `${(y * 100).toFixed(0)}%`);
      }
    });
  }, { passive: true });
  $('#timeline').addEventListener('pointerout', (ev) => {
    const w = ev.target.closest?.('.card')?.querySelector('.poster-wrap');
    if (w && !ev.relatedTarget?.closest?.('.card')?.contains(ev.target)) { w.style.removeProperty('--rx'); w.style.removeProperty('--ry'); }
  });
}


// ---- calm scrolling: the month bar slips away while you read down and returns when you scroll up ----
{
  let lastY = scrollY, ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY, dy = y - lastY;
      if (Math.abs(dy) > 6) { document.body.classList.toggle('reading', dy > 0 && y > 260); lastY = y; }
      ticking = false;
    });
  }, { passive: true });
}

// "⋯" menu: close after choosing something, on outside click, and on Escape.
{
  const more = document.getElementById('more');
  if (more) {
    more.addEventListener('click', (ev) => { if (ev.target.closest('.more-menu button')) setTimeout(() => { more.open = false; }, 0); });
    addEventListener('click', (ev) => { if (more.open && !more.contains(ev.target)) more.open = false; });
    addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && more.open) { more.open = false; more.querySelector('summary').focus(); } });
  }
}

// Phone tab bar: the same actions as the desktop buttons.
document.getElementById('bnav')?.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.view) {
    if (state.guide.on) { state.guide.on = false; store.set('rr:storyDone', true); }
    patch({ view: b.dataset.view });
    scrollTo({ top: 0, behavior: 'auto' });
  } else if (b.dataset.act === 'night') $('#night-btn').click();
  else if (b.dataset.act === 'lab') $('#lab-btn').click();
});
if (DEMO && PARAMS.has('more')) setTimeout(() => { const m = document.getElementById('more'); if (m) m.open = true; }, 300);
