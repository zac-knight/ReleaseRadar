// The filter bar: one slim row of dropdowns. Each opens a small menu (checkboxes + search, radios,
// date inputs or sliders). The app owns the filter state; this module only renders it and reports
// changes through `patch({...})`.

import { el } from './ui.js';
import { SERVICES, RUNTIME_MAX } from './model.js';

export const WHEN = [['all', 'Any time'], ['week', 'This week'], ['month', 'This month'], ['nextmonth', 'Next month'],
  ['3m', 'Next 3 months'], ['year', 'This year'], ['later', 'Later']];
export const SORTS = [['auto', 'Recommended'], ['popular', 'Most popular'], ['date', 'Release date'],
  ['rating', 'Highest rated'], ['title', 'A–Z']];
const FORMAT = [['all', 'Movies & TV'], ['movie', 'Movies'], ['tv', 'TV shows']];
const LANG = [['all', 'Any language'], ['en', 'English'], ['other', 'Other languages']];
const STATUS = [['all', 'Any status'], ['now_playing', 'In cinemas now'], ['confirmed', 'Confirmed date'],
  ['rumoured', 'Rumoured'], ['delayed', 'Delayed']];
const GROUPS = [['date', 'Release date'], ['service', 'Platform']];
const WHEN_LABEL = Object.fromEntries(WHEN);
const label = (list, v) => list.find(([x]) => x === v)?.[1] ?? '';

// ---- menu building blocks --------------------------------------------------------------
function radios(name, options, onPick) {
  const wrap = el('div', { class: 'opts' });
  const rows = options.map(([v, text]) => {
    const input = el('input', { type: 'radio', name, value: v });
    input.addEventListener('change', () => onPick(v));
    wrap.append(el('label', { class: 'row' }, input, el('span', { class: 'name', text })));
    return { v, input, row: input.parentElement };
  });
  return { el: wrap, set(value, hidden = []) { rows.forEach((r) => { r.input.checked = r.v === value; r.row.hidden = hidden.includes(r.v); }); } };
}

/** Checkbox list whose rows are created once and then updated in place (keeps focus while you tick). */
function checks(onToggle) {
  const wrap = el('div', { class: 'opts scroll' });
  const rows = new Map();
  return {
    el: wrap,
    sync(items, selected, term = '') {
      const seen = new Set();
      for (const it of items) {
        let r = rows.get(it.id);
        if (!r) {
          const input = el('input', { type: 'checkbox' });
          const count = el('small');
          input.addEventListener('change', () => onToggle(it.id, input.checked));
          r = { input, count, row: el('label', { class: 'row' }, input,
            it.color && el('i', { class: 'dot', style: `background:${it.color}` }), el('span', { class: 'name', text: it.label }), count) };
          rows.set(it.id, r);
          wrap.append(r.row);
        }
        const on = selected.includes(it.id);
        r.count.textContent = it.count;
        r.input.checked = on;
        r.row.classList.toggle('zero', it.count === 0);
        r.row.hidden = (!it.keep && it.count === 0 && !on) || Boolean(term && !it.label.toLowerCase().includes(term));
        seen.add(it.id);
      }
      for (const [id, r] of rows) if (!seen.has(id)) r.row.hidden = true;
      wrap.dataset.empty = String([...rows.values()].every((r) => r.row.hidden));
    },
  };
}

const segmented = (options, onPick) => {
  const wrap = el('div', { class: 'mini-seg' });
  const btns = options.map(([v, text]) => {
    const b = el('button', { type: 'button', 'data-value': v, text });
    b.addEventListener('click', () => onPick(v));
    wrap.append(b);
    return b;
  });
  return { el: wrap, set(value) { btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value))); } };
};

const toggleIn = (list, id, on) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
const nSel = (n, one) => (n === 1 ? one : n ? `${n} selected` : '');

// ---- dropdown definitions --------------------------------------------------------------
function defs({ patch, getF }) {
  const genre = () => {
    let term = ''; let last = [];
    const search = el('input', { type: 'search', class: 'dd-search', placeholder: 'Find a genre…', 'aria-label': 'Find a genre' });
    const list = checks((id, on) => patch({ genres: toggleIn(getF().genres, id, on) }));
    const mode = segmented([['any', 'Match any'], ['all', 'Match all']], (v) => patch({ genreMode: v }));
    const clear = el('button', { type: 'button', class: 'linkbtn', text: 'Clear' });
    clear.addEventListener('click', () => patch({ genres: [] }));
    const foot = el('div', { class: 'dd-foot' }, mode.el, clear);
    const empty = el('p', { class: 'empty', text: 'No genres match.' });
    search.addEventListener('input', () => { term = search.value.trim().toLowerCase(); list.sync(last, getF().genres, term); });
    return {
      id: 'genre', label: 'Genre', modes: ['cinema', 'soon', 'now'],
      summary: (f) => nSel(f.genres.length, f.genres[0]),
      mount: (panel) => panel.append(search, list.el, empty, foot),
      update(ctx) {
        last = ctx.allGenres.map((g) => ({ id: g, label: g, count: ctx.genreCounts.get(g) || 0 }));
        for (const g of ctx.f.genres) if (!ctx.allGenres.includes(g)) last.push({ id: g, label: g, count: 0 });
        list.sync(last, ctx.f.genres, term);
        empty.hidden = list.el.dataset.empty !== 'true';
        foot.hidden = !ctx.f.genres.length;
        mode.el.hidden = ctx.f.genres.length < 2;
        mode.set(ctx.f.genreMode);
      },
    };
  };

  const when = () => {
    const r = radios('dd-when', WHEN, (v) => patch({ when: v, from: '', to: '' }));
    const from = el('input', { type: 'date', 'aria-label': 'From date' });
    const to = el('input', { type: 'date', 'aria-label': 'To date' });
    const onDate = () => patch({ when: from.value || to.value ? 'custom' : 'all', from: from.value, to: to.value });
    from.addEventListener('change', onDate); to.addEventListener('change', onDate);
    return {
      id: 'when', label: 'Release date', modes: ['cinema', 'soon'],
      summary: (f) => (f.when === 'custom' ? 'Custom' : f.when !== 'all' ? WHEN_LABEL[f.when] : ''),
      mount: (panel) => panel.append(r.el, el('div', { class: 'dd-sep' }),
        el('div', { class: 'range-dates' }, el('label', {}, 'From', from), el('label', {}, 'To', to))),
      update(ctx) { r.set(ctx.f.when === 'custom' ? '' : ctx.f.when); from.value = ctx.f.from || ''; to.value = ctx.f.to || ''; },
    };
  };

  const rating = () => {
    const input = el('input', { type: 'range', min: '0', max: '9', step: '0.5', 'aria-label': 'Minimum rating' });
    const out = el('output', { class: 'big' });
    input.addEventListener('input', () => patch({ minRating: Number(input.value) }));
    return {
      id: 'rating', label: 'Rating', modes: ['now'],
      summary: (f) => (f.minRating ? `${f.minRating}+ ★` : ''),
      mount: (panel) => panel.append(el('div', { class: 'slider' }, out, input), el('p', { class: 'hint', text: 'TMDB user rating out of 10.' })),
      update(ctx) { input.value = ctx.f.minRating; out.textContent = ctx.f.minRating ? `${ctx.f.minRating}+ ★` : 'Any rating'; },
    };
  };

  const runtime = () => {
    const lo = el('input', { type: 'range', min: '0', max: String(RUNTIME_MAX), step: '5', 'aria-label': 'Minimum runtime' });
    const hi = el('input', { type: 'range', min: '0', max: String(RUNTIME_MAX), step: '5', 'aria-label': 'Maximum runtime' });
    const out = el('output', { class: 'big' });
    lo.addEventListener('input', () => patch({ rtMin: Math.min(Number(lo.value), Number(hi.value)) }));
    hi.addEventListener('input', () => patch({ rtMax: Math.max(Number(hi.value), Number(lo.value)) }));
    const fmt = (f) => `${f.rtMin}–${f.rtMax >= RUNTIME_MAX ? `${RUNTIME_MAX}+` : f.rtMax} min`;
    return {
      id: 'runtime', label: 'Runtime', modes: ['cinema', 'soon'],
      summary: (f) => (f.rtMin > 0 || f.rtMax < RUNTIME_MAX ? fmt(f) : ''),
      mount: (panel) => panel.append(out, el('div', { class: 'slider two' }, el('label', {}, 'Shortest', lo), el('label', {}, 'Longest', hi)),
        el('p', { class: 'hint', text: 'Movies only. Titles without a listed runtime are hidden while this is active.' })),
      update(ctx) { lo.value = ctx.f.rtMin; hi.value = ctx.f.rtMax; out.textContent = ctx.f.rtMin > 0 || ctx.f.rtMax < RUNTIME_MAX ? fmt(ctx.f) : 'Any length'; },
    };
  };

  const services = () => {
    const list = checks((id, on) => patch({ services: toggleIn(getF().services, id, on) }));
    const clear = el('button', { type: 'button', class: 'linkbtn', text: 'Clear' });
    clear.addEventListener('click', () => patch({ services: [] }));
    const foot = el('div', { class: 'dd-foot' }, clear);
    return {
      id: 'services', label: 'Service', modes: ['soon', 'now'],
      summary: (f) => nSel(f.services.length, SERVICES.find((s) => s.id === f.services[0])?.label),
      mount: (panel) => panel.append(list.el, foot),
      update(ctx) {
        list.sync(SERVICES.map((s) => ({ id: s.id, label: s.label, color: s.color, count: ctx.serviceCounts.get(s.id) || 0, keep: true })), ctx.f.services);
        foot.hidden = !ctx.f.services.length;
      },
    };
  };

  const simple = (id, text, modes, options, key, summarize) => {
    const r = radios(`dd-${id}`, options, (v) => patch({ [key]: v }));
    return { id, label: text, modes, summary: (f) => (f[key] === options[0][0] ? '' : summarize ? summarize(f) : label(options, f[key])),
      mount: (panel) => panel.append(r.el), update: (ctx) => r.set(ctx.f[key]) };
  };

  const cert = () => {
    const list = checks((id, on) => patch({ certs: toggleIn(getF().certs, id, on) }));
    const clear = el('button', { type: 'button', class: 'linkbtn', text: 'Clear' });
    clear.addEventListener('click', () => patch({ certs: [] }));
    const foot = el('div', { class: 'dd-foot' }, clear);
    const note = el('p', { class: 'hint', text: 'Australian Classification: G, PG, M, MA15+, R18+.' });
    return {
      id: 'cert', label: 'Classification', modes: ['cinema', 'soon'],
      summary: (f) => (f.certs.length > 2 ? `${f.certs.length} selected` : f.certs.join(', ')),
      mount: (panel) => panel.append(list.el, foot, note),
      update(ctx) {
        const items = ctx.certCounts.map(([c, n]) => ({ id: c, label: c, count: n }));
        for (const c of ctx.f.certs) if (!items.some((i) => i.id === c)) items.push({ id: c, label: c, count: 0 });
        list.sync(items, ctx.f.certs);
        foot.hidden = !ctx.f.certs.length;
      },
    };
  };

  const sort = () => {
    const r = radios('dd-sort', SORTS, (v) => patch({ sort: v }));
    const g = radios('dd-group', GROUPS, (v) => patch({ group: v }));
    const groupBox = el('div', {}, el('div', { class: 'dd-sep' }), el('p', { class: 'dd-title', text: 'Group by' }), g.el);
    return {
      id: 'sort', label: 'Sort', modes: ['cinema', 'soon', 'now'], alignRight: true,
      summary: (f) => label(SORTS, f.sort), always: true,
      mount: (panel) => panel.append(r.el, groupBox),
      update(ctx) { r.set(ctx.f.sort); g.set(ctx.f.group); groupBox.hidden = ctx.mode !== 'soon'; },
    };
  };

  return [genre(), when(), rating(), runtime(), services(),
    simple('format', 'Format', ['soon', 'now'], FORMAT, 'format'),
    cert(),
    simple('lang', 'Language', ['cinema', 'soon', 'now'], LANG, 'lang'),
    simple('status', 'Status', ['cinema', 'soon'], STATUS, 'status'),
    sort()];
}

// ---- the bar ---------------------------------------------------------------------------
/**
 * @param {{ mount: HTMLElement, getF: () => object, patch: (p: object) => void,
 *           onExport: (kind: string) => void, onWatch: () => void }} api
 */
export function createFilterBar({ mount, getF, patch, onExport, onWatch }) {
  let openId = null;
  const items = defs({ patch, getF }).map((def) => {
    const val = el('b', { class: 'val' });
    const btn = el('button', { type: 'button', class: 'dd-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
      el('span', { class: 'lab', text: def.label }), val, el('span', { class: 'chev', 'aria-hidden': 'true', text: '▾' }));
    const panel = el('div', { class: 'dd-panel', hidden: true, role: 'group', 'aria-label': def.label });
    const root = el('div', { class: `dd${def.alignRight ? ' right' : ''}`, 'data-dd': def.id }, btn, panel);
    def.mount(panel);
    btn.addEventListener('click', () => toggle(def.id));
    return { def, btn, val, panel, root };
  });

  // Export + watchlist live at the right end of the bar.
  const watch = el('button', { type: 'button', class: 'dd-btn icon', 'aria-pressed': 'false', title: 'Show only my watchlist' },
    el('span', { class: 'star-ico', 'aria-hidden': 'true', text: '★' }), el('span', { class: 'lab', text: 'Watchlist' }));
  watch.addEventListener('click', onWatch);
  const exportItems = [['csv', 'Download this list (.csv)'], ['ics-view', 'Add this list to calendar (.ics)'], ['ics-watch', 'Add my watchlist to calendar (.ics)']];
  const exportBtn = el('button', { type: 'button', class: 'dd-btn icon', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
    el('span', { 'aria-hidden': 'true', text: '⤓' }), el('span', { class: 'lab', text: 'Export' }));
  const exportPanel = el('div', { class: 'dd-panel', hidden: true },
    el('div', { class: 'opts' }, ...exportItems.map(([k, t]) => {
      const b = el('button', { type: 'button', class: 'row action', text: t });
      b.addEventListener('click', () => { close(); onExport(k); });
      return b;
    })));
  const exportRoot = el('div', { class: 'dd right', 'data-dd': 'export' }, exportBtn, exportPanel);
  exportBtn.addEventListener('click', () => toggle('export'));

  mount.replaceChildren(...items.map((i) => i.root), el('span', { class: 'grow' }), exportRoot, watch);

  function all() { return [...items.map((i) => ({ id: i.def.id, btn: i.btn, panel: i.panel, root: i.root })), { id: 'export', btn: exportBtn, panel: exportPanel, root: exportRoot }]; }
  function close() {
    openId = null;
    for (const d of all()) { d.panel.hidden = true; d.btn.setAttribute('aria-expanded', 'false'); d.root.classList.remove('open'); }
  }
  function toggle(id) {
    if (openId === id) { close(); return; }
    close();
    const d = all().find((x) => x.id === id);
    openId = id;
    d.panel.hidden = false; d.btn.setAttribute('aria-expanded', 'true'); d.root.classList.add('open');
    // flip to the left edge if the menu would run off the right of the screen
    const r = d.panel.getBoundingClientRect();
    d.root.classList.toggle('flip', r.right > innerWidth - 8 && !d.root.classList.contains('right'));
    d.panel.querySelector('input[type="search"]')?.focus({ preventScroll: true });
  }
  addEventListener('pointerdown', (e) => { if (openId && !e.target.closest('.dd')) close(); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openId) { all().find((x) => x.id === openId)?.btn.focus(); close(); }
  });

  return {
    close,
    open: (id) => toggle(id),
    update(ctx) {
      for (const { def, btn, val, root } of items) {
        const visible = def.modes.includes(ctx.mode);
        root.hidden = !visible;
        if (!visible) continue;
        const v = def.summary(ctx.f);
        val.textContent = v ? v : '';
        btn.classList.toggle('active', Boolean(v) && !def.always);
        def.update(ctx);
      }
      watch.setAttribute('aria-pressed', String(ctx.f.watch === 'only'));
    },
  };
}

// ---- active-filter chips ----------------------------------------------------------------
/** What is currently filtering the list, each with the patch that removes it. */
export function activeChips(f, mode) {
  const chips = [];
  for (const g of f.genres) chips.push({ label: g, patch: { genres: f.genres.filter((x) => x !== g) } });
  if (mode !== 'cinema') for (const id of f.services) {
    chips.push({ label: SERVICES.find((s) => s.id === id)?.label ?? id, patch: { services: f.services.filter((x) => x !== id) } });
  }
  if (mode !== 'cinema' && f.format !== 'all') chips.push({ label: label(FORMAT, f.format), patch: { format: 'all' } });
  if (mode !== 'now' && f.when !== 'all') {
    chips.push({ label: f.when === 'custom' ? `${f.from || '…'} → ${f.to || '…'}` : WHEN_LABEL[f.when], patch: { when: 'all', from: '', to: '' } });
  }
  if (f.lang !== 'all') chips.push({ label: label(LANG, f.lang), patch: { lang: 'all' } });
  if (mode !== 'now' && f.status !== 'all') chips.push({ label: label(STATUS, f.status), patch: { status: 'all' } });
  if (mode !== 'now') for (const c of f.certs) chips.push({ label: c, patch: { certs: f.certs.filter((x) => x !== c) } });
  if (mode !== 'now' && (f.rtMin > 0 || f.rtMax < RUNTIME_MAX)) chips.push({ label: `${f.rtMin}–${f.rtMax >= RUNTIME_MAX ? `${RUNTIME_MAX}+` : f.rtMax} min`, patch: { rtMin: 0, rtMax: RUNTIME_MAX } });
  if (mode === 'now' && f.minRating) chips.push({ label: `${f.minRating}+ ★`, patch: { minRating: 0 } });
  if (f.watch === 'only') chips.push({ label: '★ Watchlist', patch: { watch: 'all' } });
  return chips;
}
