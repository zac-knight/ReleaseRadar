// The guided "story": a short sequence of questions answered with big tiles.
//   What are you looking for?  ->  Movies or TV?  ->  What kind of story?  ->  Where?  ->  When?
// The same step screens are used for the first-run flow and for editing one phrase of the
// sentence later. This module only builds DOM; app.js owns the state.

import { el, posterSrc } from './ui.js';
import { SERVICES } from './model.js';

export const STEP_LABEL = { what: 'Looking for', media: 'Media', genre: 'Genre', where: 'Where', when: 'When' };
const MULTI = new Set(['genre', 'where']);
export const isMulti = (step) => MULTI.has(step);

/** Which questions apply: films-only cinema has no media/where, and "now" has no date. */
export function stepsFor(mode) {
  return ['what', ...(mode === 'cinema' ? [] : ['media']), 'genre', ...(mode === 'cinema' ? [] : ['where']), ...(mode === 'now' ? [] : ['when'])];
}

// Shown before any data has loaded, so the question is answerable straight away.
export const DEFAULT_GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family',
  'Fantasy', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western'];

const WHAT = [
  ['cinema', 'Coming to cinemas', 'What’s showing and opening near you, with Australian dates and classifications.'],
  ['soon', 'Coming to streaming', 'Films about to reach home viewing, plus new series and seasons on each service.'],
  ['now', 'On streaming now', 'What you can already watch tonight on Netflix, Stan, Prime Video and more.'],
];
const MEDIA = [
  ['all', 'Movies & TV', 'Either is fine'],
  ['movie', 'Movies', 'Feature films'],
  ['tv', 'TV shows', 'Series and new seasons'],
];
const WHEN = [
  ['week', 'This week', 'The next 7 days'],
  ['month', 'This month', 'Everything this calendar month'],
  ['3m', 'Next 3 months', 'A bit further ahead'],
  ['all', 'Any time', 'Don’t filter by date'],
];

function tile({ title, desc, selected, onPick, color, count, big, delay = 0 }) {
  const b = el('button', {
    type: 'button', class: `tile${big ? ' big' : ''}${selected ? ' selected' : ''}`, 'aria-pressed': String(Boolean(selected)),
    style: `--d:${delay}ms${color ? `;--c:${color}` : ''}`,
  },
  el('span', { class: 'tick', 'aria-hidden': 'true', text: '' }),
  color && el('i', { class: 'dot', 'aria-hidden': 'true' }),
  el('b', { text: title }),
  desc && el('small', { class: 'desc', text: desc }),
  count != null && el('small', { class: 'count', text: count }));
  b.addEventListener('click', onPick);
  return b;
}

const BLURB = {
  Action: 'Big set pieces and constant momentum.', Adventure: 'Journeys, quests and far-off places.', Animation: 'Drawn, painted or rendered worlds.',
  Comedy: 'Built to make you laugh.', Crime: 'Heists, detectives and the other side of the law.', Documentary: 'Real people, real stories.',
  Drama: 'Character-driven stories with weight.', Family: 'Something everyone can sit through together.', Fantasy: 'Magic, myth and invented worlds.',
  History: 'Stories pulled from the past.', Horror: 'Dread, tension and a good scare.', Music: 'Stories told through song and performance.',
  Mystery: 'Puzzles and slow reveals.', Romance: 'Love stories, messy and sweet.', 'Science Fiction': 'Big ideas set in the future.', 'Sci-Fi': 'Big ideas set in the future.',
  'Sci-Fi & Fantasy': 'Big ideas and invented worlds.', Thriller: 'Edge-of-your-seat suspense.', 'TV Movie': 'Made for the small screen.', War: 'Conflict and its cost.', Western: 'Dust, frontiers and gunfights.',
  'Action & Adventure': 'Momentum and far-off places.', Kids: 'Made for younger viewers.', Reality: 'Unscripted and real.', Soap: 'Long-running drama.', Talk: 'Conversation and interviews.', News: 'Current affairs.', Politics: 'Power and the people who hold it.',
};

/** Right-hand panel for the genre picker: what the genre is, plus a few real example posters. */
function genrePeek(ctx, start) {
  const box = el('aside', { class: 'genre-peek', 'aria-live': 'polite' });
  const show = (g) => {
    if (!g) { box.replaceChildren(el('p', { class: 'gp-empty', text: 'Hover a genre to see example films.' })); return; }
    const ex = ctx.loaded && ctx.examples ? ctx.examples(g) : [];
    const n = ctx.genreCounts.get(g) || 0;
    box.replaceChildren(
      el('p', { class: 'gp-kicker', text: 'Example films' }),
      el('h3', { text: g }),
      el('p', { class: 'gp-blurb', text: BLURB[g] || 'Browse this genre.' }),
      ctx.loaded && el('p', { class: 'gp-count', text: `${n} ${n === 1 ? 'title' : 'titles'} match right now` }),
      ex.length ? el('div', { class: 'gp-posters' }, ...ex.map((e) => el('figure', {},
        el('img', { src: posterSrc(e.poster, 'w342'), alt: '', loading: 'lazy', decoding: 'async' }),
        el('figcaption', {}, el('b', { text: e.title }), el('small', { text: (e.date || '').slice(0, 4) || (e.rating ? `★ ${Number(e.rating).toFixed(1)}` : '') })))))
        : el('p', { class: 'gp-empty', text: ctx.loaded ? 'No titles with posters for this genre in the current results.' : 'Examples appear once films have loaded.' }));
  };
  show(start);
  return { box, show };
}

const heading = (q, hint) => el('header', { class: 'step-head' }, el('h2', { text: q }), hint && el('p', { text: hint }));

/**
 * @param {'what'|'media'|'genre'|'where'|'when'} step
 * @param {{ f: object, loaded: boolean, allGenres: string[], genreCounts: Map<string, number>,
 *           serviceCounts: Map<string, number>, status: string, showCurrent: boolean }} ctx
 *        f = effective filters; showCurrent marks today's single-select answer (off in the first-run flow,
 *        where nothing has been chosen yet)
 * @param {{ set: (patch: object) => void, pick: (patch: object) => void }} api
 *        pick = a single-select answer (moves on); set = a multi-select change (stays)
 */
export function buildStep(step, ctx, api) {
  const { f } = ctx;
  const wrap = el('section', { class: `step step-${step}` });
  const status = ctx.status ? el('p', { class: 'step-status', text: ctx.status }) : null;

  if (step === 'what') {
    wrap.append(heading('What are you looking for?', 'Pick one. You can change your mind at any time.'),
      el('div', { class: 'tiles three' }, ...WHAT.map(([v, title, desc], i) =>
        tile({ title, desc, big: true, selected: ctx.showCurrent && f.mode === v, delay: i * 70, onPick: () => api.pick({ mode: v }) }))));
  } else if (step === 'media') {
    wrap.append(heading('Movies, TV shows, or both?'),
      el('div', { class: 'tiles three' }, ...MEDIA.map(([v, title, desc], i) =>
        tile({ title, desc, big: true, selected: ctx.showCurrent && f.format === v, delay: i * 70, onPick: () => api.pick({ format: v }) }))));
  } else if (step === 'genre') {
    const sel = f.genres;
    const names = [...new Set([...(ctx.loaded ? ctx.allGenres : DEFAULT_GENRES), ...sel])];
    const shown = names.filter((g) => !ctx.loaded || sel.includes(g) || (ctx.genreCounts.get(g) || 0) > 0);
    const toggle = (g) => api.set({ genres: sel.includes(g) ? sel.filter((x) => x !== g) : [...sel, g] });
    const modeSeg = sel.length > 1 ? el('div', { class: 'mini-seg center' },
      ...[['any', 'Match any'], ['all', 'Match all']].map(([v, t]) => {
        const b = el('button', { type: 'button', 'aria-pressed': String(f.genreMode === v), text: t });
        b.addEventListener('click', () => api.set({ genreMode: v }));
        return b;
      })) : null;
    const tiles = shown.map((g, i) => {
      const t = tile({ title: g, selected: sel.includes(g), delay: Math.min(i, 14) * 25,
        count: ctx.loaded ? String(ctx.genreCounts.get(g) || 0) : null, onPick: () => toggle(g) });
      return [g, t];
    });
    const peek = ctx.examples ? genrePeek(ctx, sel[sel.length - 1] || shown[0]) : null;
    if (peek) tiles.forEach(([g, t]) => { const on = () => peek.show(g); t.addEventListener('pointerenter', on); t.addEventListener('focus', on); });
    const grid = el('div', { class: 'tiles genres' }, ...tiles.map(([, t]) => t));
    wrap.append(...[heading('What kind of story are you after?', 'Pick as many as you like, or none for everything.'), status,
      peek ? el('div', { class: 'genre-split' }, grid, peek.box) : grid, modeSeg].filter(Boolean));
  } else if (step === 'where') {
    const sel = f.services;
    const toggle = (id) => api.set({ services: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
    wrap.append(...[heading('Where do you watch?', 'Pick your services, or none to see them all.'), status,
      el('div', { class: 'tiles services' }, ...SERVICES.map((s, i) => tile({
        title: s.label, color: s.color, selected: sel.includes(s.id), delay: i * 30,
        count: ctx.loaded ? String(ctx.serviceCounts.get(s.id) || 0) : null, onPick: () => toggle(s.id) })))].filter(Boolean));
  } else if (step === 'when') {
    const current = ctx.showCurrent && f.when !== 'custom' ? f.when : '';
    wrap.append(heading('When?', 'Pick a window. Exact dates are under Refine.'),
      el('div', { class: 'tiles four' }, ...WHEN.map(([v, title, desc], i) =>
        tile({ title, desc, big: true, selected: current === v, delay: i * 60, onPick: () => api.pick({ when: v, from: '', to: '' }) }))));
  }
  return wrap;
}
