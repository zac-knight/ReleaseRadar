// The title detail panel. Opens instantly with what the list already knows, then fills in cast,
// trailer, runtime, classification, release dates and where-to-watch from TMDB on demand.

import { displayDate, countdownLabel, daysUntil, isPlaceholderDate } from './model.js';
import { buildICS } from './export.js';
import { el, posterSrc, backdropSrc, download, slug } from './ui.js';

const DATE_ROWS = [
  ['premiere', 'Premiere'], ['limited', 'Limited cinema release'], ['theatrical', 'In cinemas'],
  ['digital', 'Digital / streaming'], ['physical', 'Blu-ray & DVD'], ['tv', 'On TV'],
];
const STATUS_TEXT = { now_playing: 'In cinemas now', available: 'Streaming now', released: 'Released' };
const statusText = (s) => STATUS_TEXT[s] ?? (s[0].toUpperCase() + s.slice(1));
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/**
 * @param {{ dialog: HTMLDialogElement, region: () => string, order: () => object[],
 *           isWatched: (key: string) => boolean, toggleWatch: (key: string) => void,
 *           label: (e: object) => string, fetchDetail: (e: object) => Promise<object> }} api
 */
export function createDetail({ dialog, region, order, isWatched, toggleWatch, label, fetchDetail }) {
  let cur = -1;

  function dateRows(e, d) {
    const dates = { ...(e.dates || {}), ...(d?.dates || {}) };
    const rows = DATE_ROWS.filter(([k]) => dates[k]);
    if (!rows.length) return null;
    return el('ul', { class: 'd-dates' }, ...rows.map(([k, text]) => {
      const date = dates[k];
      const cd = countdownLabel({ date, status: 'confirmed' });
      const past = daysUntil(date) < 0;
      return el('li', { class: past ? 'past' : '' }, el('span', { text }),
        el('b', { text: displayDate({ date, status: 'confirmed' }) }),
        cd && el('small', { class: 'cd', text: cd }));
    }));
  }

  function watchBlock(e, d) {
    if (!d) return el('div', { class: 'sk-block' }, el('i', { class: 'sk w80' }), el('i', { class: 'sk w60' }));
    const w = d.watch;
    const groups = [['Stream', w?.stream], ['Free', w?.free], ['Rent', w?.rent], ['Buy', w?.buy]].filter(([, l]) => l?.length);
    if (!groups.length) {
      const fallback = e.providers?.length ? `Expected on ${e.providers.join(', ')}.` : 'No platform announced for Australia yet.';
      return el('p', { class: 'muted', text: fallback });
    }
    return el('div', { class: 'd-watch' }, ...groups.map(([name, list]) =>
      el('div', {}, el('span', { class: 'k', text: name }), ...list.map((p) => el('span', { class: 'chip', text: p })))));
  }

  function paint(e, d, failed) {
    const watched = isWatched(e.key);
    const cd = countdownLabel(e);
    const close = el('button', { class: 'd-close', 'aria-label': 'Close', text: '✕' });
    close.addEventListener('click', () => dialog.close());

    const facts = [
      ['Date', `${e.status === 'available' ? 'Released ' : ''}${displayDate(e)}${e.label ? ` · ${e.label}` : ''}`],
      d?.runtime || e.runtime ? ['Runtime', hm(d?.runtime || e.runtime)] : null,
      d?.cert || e.cert ? ['Classification', d?.cert || e.cert] : null,
      (d?.rating ?? e.rating) ? ['Rating', `★ ${(d?.rating ?? e.rating).toFixed(1)}${d?.votes ? ` (${d.votes.toLocaleString('en-AU')})` : ''}`] : null,
      e.type === 'tv' && d?.seasons ? ['Seasons', `${d.seasons}${d.episodes ? ` · ${d.episodes} episodes` : ''}`] : null,
      e.lang ? ['Language', e.lang.toUpperCase()] : null,
    ].filter(Boolean);

    const people = [];
    if (d?.directors?.length) people.push(['Directed by', d.directors.join(', ')]);
    if (d?.creators?.length) people.push(['Created by', d.creators.join(', ')]);
    if (d?.networks?.length && e.type === 'tv') people.push(['Network', d.networks.join(', ')]);

    const wl = el('button', { class: `btn${watched ? ' on' : ''}`, text: watched ? '★ On watchlist' : '☆ Add to watchlist' });
    wl.addEventListener('click', () => {
      toggleWatch(e.key);
      const on = isWatched(e.key);
      wl.textContent = on ? '★ On watchlist' : '☆ Add to watchlist';
      wl.classList.toggle('on', on);
    });
    const cal = el('button', { class: 'btn', text: '＋ Add to calendar', disabled: isPlaceholderDate(e.date) && e.status === 'rumoured' ? '' : null });
    cal.addEventListener('click', () => download(`${slug(e.title)}.ics`, buildICS([e], { label }), 'text/calendar'));
    const trailer = d?.trailer && el('a', { class: 'btn primary', href: `https://www.youtube.com/watch?v=${d.trailer.key}`, target: '_blank', rel: 'noopener', text: '▶ Trailer' });
    const tmdb = el('a', { class: 'btn', href: `https://www.themoviedb.org/${e.type}/${e.id}`, target: '_blank', rel: 'noopener', text: 'TMDB ↗' });
    const prev = el('button', { class: 'btn', 'aria-label': 'Previous title', text: '←', disabled: cur <= 0 ? '' : null });
    const next = el('button', { class: 'btn', 'aria-label': 'Next title', text: '→', disabled: cur >= order().length - 1 ? '' : null });
    prev.addEventListener('click', () => open(cur - 1));
    next.addEventListener('click', () => open(cur + 1));

    const bg = backdropSrc(d?.backdrop || e.backdrop);
    dialog.replaceChildren(close,
      el('div', { class: 'd-hero' }, bg && el('img', { src: bg, alt: '' })),
      el('div', { class: 'd-wrap' },
        el('aside', { class: 'd-side' },
          e.poster ? el('img', { class: 'd-poster', src: posterSrc(e.poster), alt: '' }) : el('div', { class: 'd-poster' }),
          el('dl', { class: 'd-facts' }, ...facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]))),
        el('div', { class: 'd-main' },
          el('div', { class: 'd-title' }, el('h2', { text: e.title }), cd && el('span', { class: 'cd-pill', text: cd })),
          el('div', { class: 'badges' },
            el('span', { class: 'b', text: e.type === 'movie' ? 'Movie' : 'TV show' }),
            el('span', { class: `b s-${e.status}`, text: statusText(e.status) }),
            ...(e.genres || []).map((g) => el('span', { class: 'b', text: g }))),
          (d?.tagline || e.tagline) && el('p', { class: 'tagline', text: `“${d?.tagline || e.tagline}”` }),
          e.delayedFrom && el('p', { class: 'warn', text: `Moved from ${displayDate({ ...e, date: e.delayedFrom, status: 'confirmed' })}` }),
          el('p', { class: 'd-over', text: e.overview || 'No synopsis yet.' }),
          dateRows(e, d) && el('section', {}, el('h3', { text: 'Release dates in Australia' }), dateRows(e, d)),
          el('section', {}, el('h3', { text: 'Where to watch in Australia' }), watchBlock(e, failed ? { watch: null } : d)),
          (people.length || d?.cast?.length) && el('section', {}, el('h3', { text: 'Cast & crew' }),
            ...people.map(([k, v]) => el('p', { class: 'person' }, el('span', { class: 'k', text: k }), v)),
            d?.cast?.length && el('div', { class: 'chips' }, ...d.cast.map((c) => el('span', { class: 'chip', title: c.character || '', text: c.name })))),
          !d && !failed && el('p', { class: 'muted', text: 'Loading cast, trailer and release details…' }),
          failed && el('p', { class: 'muted', text: 'Couldn’t load extra details right now.' }),
          el('div', { class: 'd-actions' }, wl, cal, trailer, tmdb, el('span', { class: 'grow' }), prev, next))));
  }

  function open(i) {
    const e = order()[i];
    if (!e) return;
    cur = i;
    paint(e, null, false);
    if (!dialog.open) dialog.showModal();
    Promise.resolve(fetchDetail(e)).then((d) => { if (cur === i) paint(e, d, false); }).catch(() => { if (cur === i) paint(e, null, true); });
  }

  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); });
  addEventListener('keydown', (ev) => {
    if (!dialog.open || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (ev.key === 'ArrowRight' && cur < order().length - 1) open(cur + 1);
    if (ev.key === 'ArrowLeft' && cur > 0) open(cur - 1);
  });

  return { open, isOpen: () => dialog.open, refresh: () => { const e = order()[cur]; if (e && dialog.open) paint(e, null, false); } };
}
