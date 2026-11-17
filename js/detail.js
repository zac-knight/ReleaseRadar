// The title detail panel. Opens instantly with what the list already knows, then fills in cast,
// trailer, runtime, classification, release dates and where-to-watch from TMDB on demand.

import { displayDate, countdownLabel, daysUntil, isPlaceholderDate } from './model.js';
import { buildICS } from './export.js';
import { el, posterSrc, backdropSrc, tmdbImg, download, slug, posterTint, tintCached } from './ui.js';

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
  let tab = 'overview';
  let extra = null;      // a title opened from "Similar" (not in the list); `stack` lets Back return
  const stack = [];
  const money = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : `$${n.toLocaleString('en-AU')}`);

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
      el('div', {}, el('span', { class: 'k', text: name }), ...list.map((p) => (typeof p === 'string' ? el('span', { class: 'chip', text: p })
        : el('span', { class: 'prov', title: p.name }, p.logo && el('img', { src: tmdbImg(p.logo, 'w92'), alt: '' }), el('span', { text: p.name })))))));
  }

  let lastD = null; // the last loaded detail, so a repaint doesn't blank the panels

  function paint(e, d, failed) {
    const watched = isWatched(e.key);
    const cd = countdownLabel(e);
    const close = el('button', { class: 'd-close', 'aria-label': 'Close', text: '×' });
    close.addEventListener('click', () => dialog.close());

    const facts = [
      ['Date', `${e.status === 'available' ? 'Released ' : ''}${displayDate(e)}${e.label ? ` · ${e.label}` : ''}`],
      d?.runtime || e.runtime ? ['Runtime', hm(d?.runtime || e.runtime)] : null,
      d?.cert || e.cert ? ['Classification', d?.cert || e.cert] : null,
      (d?.rating ?? e.rating) ? ['Rating', `${(d?.rating ?? e.rating).toFixed(1)}${d?.votes ? ` (${d.votes.toLocaleString('en-AU')})` : ''}`] : null,
      e.type === 'tv' && d?.seasons ? ['Seasons', `${d.seasons}${d.episodes ? ` · ${d.episodes} episodes` : ''}`] : null,
      e.lang ? ['Language', e.lang.toUpperCase()] : null,
    ].filter(Boolean);

    const people = [];
    if (d?.directors?.length) people.push(['Directed by', d.directors.join(', ')]);
    if (d?.creators?.length) people.push(['Created by', d.creators.join(', ')]);
    if (d?.networks?.length && e.type === 'tv') people.push(['Network', d.networks.join(', ')]);

    const wl = el('button', { class: `btn${watched ? ' on' : ''}`, text: watched ? 'On watchlist' : 'Add to watchlist' });
    wl.addEventListener('click', () => {
      toggleWatch(e.key);
      const on = isWatched(e.key);
      wl.textContent = on ? 'On watchlist' : 'Add to watchlist';
      wl.classList.toggle('on', on);
    });
    const cal = el('button', { class: 'btn', text: '＋ Add to calendar', disabled: isPlaceholderDate(e.date) && e.status === 'rumoured' ? '' : null });
    cal.addEventListener('click', () => download(`${slug(e.title)}.ics`, buildICS([e], { label }), 'text/calendar'));
    const tmdb = el('a', { class: 'btn', href: `https://www.themoviedb.org/${e.type}/${e.id}`, target: '_blank', rel: 'noopener', text: 'TMDB ↗' });
    const prev = el('button', { class: 'btn', 'aria-label': 'Previous title', text: '←', disabled: extra || cur <= 0 ? '' : null });
    const next = el('button', { class: 'btn', 'aria-label': 'Next title', text: '→', disabled: extra || cur >= order().length - 1 ? '' : null });
    prev.addEventListener('click', () => open(cur - 1));
    next.addEventListener('click', () => open(cur + 1));

    const bg = backdropSrc(d?.backdrop || e.backdrop);
    const vids = d?.videos || (d?.trailer ? [d.trailer] : []);

    // The hero is either the backdrop (with a Watch trailer button) or an in-app YouTube player.
    const slot = el('div', { class: 'd-slot' });
    const trailerBtn = vids.length ? el('button', { class: 'btn primary', type: 'button', text: '▶ Watch trailer' }) : null;
    const showHero = () => {
      dialog.classList.remove('playing');
      const pill = vids.length ? el('button', { class: 'd-play', type: 'button', 'aria-label': 'Play trailer' }, el('i', { 'aria-hidden': 'true', text: '▶' })) : null;
      pill?.addEventListener('click', () => play(vids[0]));
      slot.replaceChildren(el('div', { class: 'd-hero' }, bg && el('img', { src: bg, alt: '' }), pill));
      if (trailerBtn) trailerBtn.textContent = '▶ Watch trailer';
    };
    const play = (v) => {
      dialog.classList.add('playing');
      // youtube-nocookie: no tracking cookies until you press play. The referrer policy is required by YouTube's embeds.
      const frame = el('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.key)}?autoplay=1&rel=0&playsinline=1`,
        title: `${e.title}: ${v.name}`, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: '', referrerpolicy: 'strict-origin-when-cross-origin',
      });
      const closeBtn = el('button', { class: 'linkbtn', type: 'button', text: 'Close trailer' });
      closeBtn.addEventListener('click', showHero);
      // "Trailer Trailer Teaser Teaser…" is useless: number repeats ("Trailer 1", "Trailer 2", "Teaser 1"…)
      const totals = {}; vids.forEach((x) => { const t = x.type || 'Video'; totals[t] = (totals[t] || 0) + 1; });
      const seen = {};
      const chips = vids.length > 1 ? vids.slice(0, 8).map((x) => {
        const t = x.type || 'Video'; seen[t] = (seen[t] || 0) + 1;
        const b = el('button', { type: 'button', class: 'vchip', 'aria-pressed': String(x.key === v.key), title: x.name }, totals[t] > 1 ? `${t} ${seen[t]}` : t);
        b.addEventListener('click', () => play(x));
        return b;
      }) : [];
      slot.replaceChildren(
        el('div', { class: 'd-player' }, frame),
        el('div', { class: 'd-vbar' }, el('span', { class: 'vname', text: v.name }), ...chips, el('span', { class: 'grow' }),
          el('a', { class: 'linkbtn', href: `https://www.youtube.com/watch?v=${encodeURIComponent(v.key)}`, target: '_blank', rel: 'noopener', text: 'Open on YouTube ↗' }), closeBtn));
      if (trailerBtn) trailerBtn.textContent = '■ Close trailer';
      dialog.scrollTo({ top: 0, behavior: 'smooth' });
    };
    trailerBtn?.addEventListener('click', () => (dialog.classList.contains('playing') ? showHero() : play(vids[0])));
    showHero();
    if (d) lastD = d;

    // ---- tabbed body: show a little at a time ----
    const hasCast = !!(d?.cast?.length || d?.crew?.length);
    const media = [...(d?.videos || []).map((v) => ({ kind: 'video', v })), ...(d?.backdrops || []).map((p) => ({ kind: 'img', p, w: 'w780', big: 'original' })), ...(d?.posters || []).map((p) => ({ kind: 'poster', p }))];
    const tabs = [
      ['overview', 'Overview', null, true],
      ['cast', 'Cast & crew', d?.cast?.length, hasCast],
      ['media', 'Media', media.length, media.length > 0],
      ['reviews', 'Reviews', d?.reviews?.length, !!d?.reviews?.length],
      ['similar', 'Similar', d?.similar?.length, !!d?.similar?.length],
    ].filter((t) => t[3]);
    if (!tabs.some((t) => t[0] === tab)) tab = 'overview';

    const pane = el('div', { class: 'd-pane', role: 'tabpanel' });
    const bar = el('div', { class: 'd-tabs', role: 'tablist' });
    const show = () => {
      bar.replaceChildren(...tabs.map(([id, text, n]) => {
        const b = el('button', { class: 'd-tab', role: 'tab', type: 'button', 'aria-selected': String(id === tab) }, text, n ? el('small', { text: String(n) }) : null);
        b.addEventListener('click', () => { if (tab !== id) { tab = id; show(); } });
        return b;
      }));
      pane.replaceChildren(PANES[tab]());
    };

    const score = d?.rating ?? e.rating;
    const stat = (k, v) => el('div', {}, el('span', { text: k }), el('b', { text: v }));
    const stats = [
      score ? el('div', { class: 'score' }, el('i', { class: 'ring', style: `--p:${Math.round(score * 10)}`, text: String(Math.round(score * 10)) }),
        el('div', { class: 'score-t' }, el('span', { text: 'User score' }), el('small', { text: d?.votes ? `${d.votes.toLocaleString('en-AU')} votes` : '' }))) : null,
      ...facts.filter(([k]) => k !== 'Rating').map(([k, v]) => stat(k, v)),
      d?.status && e.type === 'movie' ? stat('Status', d.status) : null,
      d?.budget ? stat('Budget', money(d.budget)) : null,
      d?.revenue ? stat('Revenue', money(d.revenue)) : null,
    ].filter(Boolean);

    const linkRow = d?.links && el('div', { class: 'd-links' },
      d.links.imdb && el('a', { href: `https://www.imdb.com/title/${d.links.imdb}`, target: '_blank', rel: 'noopener', text: 'IMDb ↗' }),
      d.links.homepage && el('a', { href: d.links.homepage, target: '_blank', rel: 'noopener', text: 'Official site ↗' }),
      d.links.instagram && el('a', { href: `https://instagram.com/${d.links.instagram}`, target: '_blank', rel: 'noopener', text: 'Instagram ↗' }),
      d.links.twitter && el('a', { href: `https://x.com/${d.links.twitter}`, target: '_blank', rel: 'noopener', text: 'X ↗' }),
      d.links.facebook && el('a', { href: `https://facebook.com/${d.links.facebook}`, target: '_blank', rel: 'noopener', text: 'Facebook ↗' }));

    const PANES = {
      overview: () => el('div', { class: 'pane-in' },
        el('div', { class: 'd-stats' }, ...stats),
        el('section', {}, el('h3', { text: 'Where to watch in Australia' }), watchBlock(e, failed ? { watch: null } : d)),
        dateRows(e, d) && el('section', {}, el('h3', { text: 'Release dates in Australia' }), dateRows(e, d)),
        d?.collection && el('section', {}, el('h3', { text: 'Part of' }), el('p', { class: 'person', text: d.collection.name })),
        d?.companies?.length && el('section', {}, el('h3', { text: 'Production' }), el('p', { class: 'person', text: d.companies.join(' · ') })),
        d?.keywords?.length && el('section', {}, el('h3', { text: 'Keywords' }), el('div', { class: 'chips' }, ...d.keywords.map((k) => el('span', { class: 'chip', text: k })))),
        linkRow),
      cast: () => el('div', { class: 'pane-in' },
        d?.cast?.length && el('div', { class: 'cast-row' }, ...d.cast.map((c) => el('figure', { class: 'cast' },
          c.photo ? el('img', { src: tmdbImg(c.photo, 'w185'), alt: '', loading: 'lazy' }) : el('div', { class: 'ph', text: c.name.split(' ').map((w) => w[0]).slice(0, 2).join('') }),
          el('figcaption', {}, el('b', { text: c.name }), el('small', { text: c.character || '' }))))),
        (d?.crew?.length || people.length) && el('div', { class: 'crew-grid' },
          ...(d.crew?.length ? d.crew : people.map(([k, v]) => [k, v.split(', ')])).map(([k, v]) => el('div', {}, el('span', { text: k }), el('b', { text: v.join(', ') }))))),
      media: () => el('div', { class: 'pane-in media' },
        el('div', { class: 'media-grid' }, ...media.map((m) => {
          if (m.kind === 'video') {
            const b = el('button', { class: 'm-video', type: 'button', title: m.v.name },
              el('img', { src: `https://i.ytimg.com/vi/${encodeURIComponent(m.v.key)}/mqdefault.jpg`, alt: '', loading: 'lazy' }),
              el('i', { text: '▶' }), el('span', { text: m.v.type || 'Video' }));
            b.addEventListener('click', () => play(m.v));
            return b;
          }
          const b = el('button', { class: `m-img ${m.kind}`, type: 'button' }, el('img', { src: tmdbImg(m.p, m.kind === 'poster' ? 'w342' : 'w500'), alt: '', loading: 'lazy' }));
          b.addEventListener('click', () => lightbox(tmdbImg(m.p, m.kind === 'poster' ? 'w780' : 'w1280')));
          return b;
        }))),
      reviews: () => el('div', { class: 'pane-in reviews' }, ...(d?.reviews || []).map((r) => el('article', { class: 'review' },
        el('header', {},
          r.avatar && /^\//.test(r.avatar) ? el('img', { src: tmdbImg(r.avatar, 'w92'), alt: '' }) : el('i', { text: (r.author || '?')[0].toUpperCase() }),
          el('div', {}, el('b', { text: r.author || 'Anonymous' }), el('small', { text: r.date ? new Date(r.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '' })),
          r.rating ? el('span', { class: 'rv-score', text: `★ ${r.rating}/10` }) : null),
        el('p', { text: r.text + (r.text.length >= 520 ? '…' : '') }),
        r.url && el('a', { href: r.url, target: '_blank', rel: 'noopener', text: 'Read full review ↗' })))),
      similar: () => el('div', { class: 'pane-in sim-row' }, ...(d?.similar || []).map((s) => {
        const b = el('button', { class: 'sim', type: 'button', title: s.title },
          el('img', { src: tmdbImg(s.poster, 'w342'), alt: '', loading: 'lazy' }),
          el('b', { text: s.title }), el('small', { text: [s.date?.slice(0, 4), s.rating > 0 ? `★ ${s.rating.toFixed(1)}` : ''].filter(Boolean).join(' · ') }));
        b.addEventListener('click', () => openEntry({ key: `${s.type}:${s.id}`, id: s.id, type: s.type, title: s.title, date: s.date || '', poster: s.poster, overview: s.overview, genres: [], status: 'released', lang: s.lang, rating: s.rating }));
        return b;
      })),
    };

    const back = stack.length ? el('button', { class: 'btn', type: 'button', text: '← Back' }) : null;
    back?.addEventListener('click', () => goBack());

    dialog.replaceChildren(close, slot,
      el('div', { class: 'd-wrap' },
        el('aside', { class: 'd-side' },
          e.poster ? el('img', { class: 'd-poster', src: posterSrc(e.poster, 'w780'), alt: '' }) : el('div', { class: 'd-poster' })),
        el('div', { class: 'd-main' },
          el('div', { class: 'd-title' }, el('h2', { text: e.title }), cd && el('span', { class: 'cd-pill', text: cd })),
          el('div', { class: 'badges' },
            el('span', { class: 'b', text: e.type === 'movie' ? 'Movie' : 'TV show' }),
            el('span', { class: `b s-${e.status}`, text: statusText(e.status) }),
            ...(e.genres || []).map((g) => el('span', { class: 'b', text: g }))),
          el('div', { class: 'd-cta' }, trailerBtn, wl, cal),
          (d?.tagline || e.tagline) && el('p', { class: 'tagline', text: `“${d?.tagline || e.tagline}”` }),
          e.delayedFrom && el('p', { class: 'warn', text: `Moved from ${displayDate({ ...e, date: e.delayedFrom, status: 'confirmed' })}` }),
          el('p', { class: 'd-over', text: e.overview || 'No synopsis yet.' }),
          bar, pane,
          !d && !failed && el('p', { class: 'muted', text: 'Loading cast, media, reviews and more…' }),
          failed && el('p', { class: 'muted', text: 'Couldn’t load extra details right now.' }),
          el('div', { class: 'd-actions' }, back, tmdb, el('span', { class: 'grow' }), prev, next))));
    show();
  }

  function lightbox(src) {
    const box = el('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Image' }, el('img', { src, alt: '' }));
    const close = () => box.remove();
    box.addEventListener('click', close);
    addEventListener('keydown', function esc(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); removeEventListener('keydown', esc, true); } }, true);
    dialog.append(box);
  }

  function load(e, token) {
    Promise.resolve(fetchDetail(e)).then((d) => { if (token === gen) paint(e, d, false); }).catch(() => { if (token === gen) paint(e, null, true); });
  }
  let gen = 0;

  // The dialog takes on the selected film's own colour (dark, so text stays readable).
  // Applied before the dialog is shown, so it never pops in a moment late.
  let tintFor = null;
  const setTint = (c, animate) => { dialog.classList.toggle('tint-anim', animate); dialog.style.setProperty('--tint', c || 'var(--maroon)'); };
  function tint(e, then) {
    tintFor = e;
    const c = tintCached(e.poster);
    if (c !== undefined) { setTint(c, dialog.open); then && then(); return; }
    // not worked out yet: give the (tiny) poster a brief moment, then show regardless
    let done = false;
    const go = (col) => { if (done) return; done = true; if (tintFor === e) setTint(col, dialog.open); then && then(); };
    posterTint(e.poster).then((col) => { if (!done) go(col); else if (col && tintFor === e) setTint(col, true); });
    setTimeout(() => go(null), 220);
  }

  function openEntry(e) {
    stack.push(extra || cur);
    extra = e; tab = 'overview';
    tint(e); paint(e, null, false); dialog.scrollTo({ top: 0 });
    load(e, ++gen);
  }
  function goBack() {
    const prev = stack.pop();
    if (typeof prev === 'number') { extra = null; open(prev, true); return; }
    extra = prev || null; tab = 'overview';
    if (extra) { tint(extra); paint(extra, null, false); load(extra, ++gen); }
  }

  function open(i, keepTab = false) {
    const e = order()[i];
    if (!e) return;
    if (!keepTab) { tab = 'overview'; stack.length = 0; }
    cur = i; extra = null;
    paint(e, null, false);
    tint(e, () => { if (!dialog.open) dialog.showModal(); });
    load(e, ++gen);
  }

  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { dialog.classList.remove('playing'); dialog.replaceChildren(); extra = null; stack.length = 0; }); // removing the iframe stops the video
  addEventListener('keydown', (ev) => {
    if (!dialog.open || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (extra) return;
    if (ev.key === 'ArrowRight' && cur < order().length - 1) open(cur + 1);
    if (ev.key === 'ArrowLeft' && cur > 0) open(cur - 1);
  });

  return { open, isOpen: () => dialog.open, refresh: () => { const e = extra || order()[cur]; if (e && dialog.open) paint(e, lastD, false); } };
}
