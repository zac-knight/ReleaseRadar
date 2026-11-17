// "Movie Night": pick a film the whole group will enjoy. UI only; the maths is in group.js.
import { el, posterSrc } from './ui.js';
import { groupRank, verdict, docFreq, sharedTerms, sharedGenres } from './group.js';

const MAX_PEOPLE = 5;
const NAMES = ['Alex', 'Sam', 'Jo', 'Kai', 'Riley'];

export function createNight({ dialog, getAll, getCandidates, embed, entryText, onPick }) {
  let people = [];
  let results = null, busy = '', engine = '', df = new Map();
  const reset = () => { people = [{ name: NAMES[0], likes: [] }, { name: NAMES[1], likes: [] }]; results = null; busy = ''; };
  reset();

  function search(person, box) {
    const input = el('input', { class: 'nt-search', type: 'search', placeholder: 'Add a film they love…', 'aria-label': `Add a film ${person.name} loves` });
    const list = el('ul', { class: 'nt-suggest', hidden: true });
    const update = () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { list.hidden = true; return; }
      const taken = new Set(people.flatMap((p) => p.likes.map((e) => e.key)));
      const hits = getAll().filter((e) => !taken.has(e.key) && e.title.toLowerCase().includes(q)).slice(0, 6);
      list.replaceChildren(...hits.map((e) => {
        const li = el('li', {}, el('img', { src: e.poster ? posterSrc(e.poster, 'w92') : '', alt: '', loading: 'lazy' }),
          el('span', {}, el('b', { text: e.title }), el('small', { text: `${(e.date || '').slice(0, 4)} · ${(e.genres || []).slice(0, 2).join(', ')}` })));
        li.addEventListener('mousedown', (ev) => { ev.preventDefault(); person.likes.push(e); results = null; draw(); });
        return li;
      }));
      if (!hits.length) list.replaceChildren(el('li', { class: 'none', text: 'No match in the films loaded right now' }));
      list.hidden = false;
    };
    input.addEventListener('input', update);
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
    return el('div', { class: 'nt-add' }, input, list);
  }

  function personCard(p, i) {
    const name = el('input', { class: 'nt-name', value: p.name, 'aria-label': `Person ${i + 1} name`, maxlength: 14 });
    name.addEventListener('input', () => { p.name = name.value || `Person ${i + 1}`; });
    const del = people.length > 2 && el('button', { class: 'nt-x', type: 'button', 'aria-label': `Remove ${p.name}`, text: '✕' });
    del && del.addEventListener('click', () => { people.splice(i, 1); results = null; draw(); });
    const chips = el('div', { class: 'nt-likes' }, ...p.likes.map((e) => {
      const c = el('button', { class: 'nt-like', type: 'button', title: 'Remove', 'aria-label': `Remove ${e.title}` },
        e.poster ? el('img', { src: posterSrc(e.poster, 'w92'), alt: '' }) : null, el('span', { text: e.title }), el('i', { text: '✕' }));
      c.addEventListener('click', () => { p.likes = p.likes.filter((x) => x !== e); results = null; draw(); });
      return c;
    }), !p.likes.length && el('p', { class: 'nt-hint', text: 'Pick two or three films they love.' }));
    return el('section', { class: 'nt-person' }, el('header', {}, name, del || null), chips, search(p));
  }

  async function run() {
    const ready = people.every((p) => p.likes.length);
    if (!ready) return;
    busy = 'Reading synopses and comparing tastes…'; results = null; draw();
    try {
      const cands = getCandidates();
      const liked = people.flatMap((p) => p.likes);
      const texts = [...cands.map(entryText), ...liked.map(entryText)];
      const { engine: eng, vectors } = await embed(texts, (m) => { busy = m; const s = dialog.querySelector('.nt-busy'); if (s) s.textContent = m; });
      engine = eng.name; df = docFreq(cands.map(entryText));
      const items = cands.map((e, i) => ({ key: e.key, vec: vectors[i] }));
      let off = cands.length;
      const likes = people.map((p) => p.likes.map(() => vectors[off++]));
      const rows = groupRank(likes, items, { neural: eng.neural, exclude: new Set(liked.map((e) => e.key)), limit: 5 });
      const byKey = new Map(cands.map((e) => [e.key, e]));
      results = rows.map((r) => ({ ...r, entry: byKey.get(r.key) }));
    } catch (err) { console.error(err); results = []; }
    busy = ''; draw();
  }

  /** Plain-English reasons: who it's close to, what they share, and the arithmetic. */
  function why(r) {
    const e = r.entry, names = people.map((p) => p.name);
    const lines = people.map((p, i) => {
      const like = p.likes[r.near[i].i], pct = r.near[i].pct;
      if (!like) return null;
      const g = sharedGenres(e.genres, like.genres), terms = sharedTerms(entryText(e), entryText(like), df, 3);
      const bits = [g.length ? `both ${g.slice(0, 2).join(' and ')}` : null, terms.length ? `shared themes: ${terms.join(', ')}` : null].filter(Boolean);
      return el('li', {}, el('b', { text: names[i] }),
        pct ? ` loves ${like.title}; this is a ${pct}% match to it${bits.length ? ` (${bits.join('; ')})` : ''}.`
            : ` loves ${like.title}, but nothing here really resembles it, which is what holds this pick back.`);
    }).filter(Boolean);
    const limit = r.people[r.worst] ? `${names[r.worst]}’s ${r.min}% is the lowest, so it caps the score.` : `${names[r.worst]} had no real match, which caps the score.`;
    return el('details', { class: 'nt-why', open: true },
      el('summary', { text: 'Why this one?' }),
      el('ul', {}, ...lines),
      el('p', { class: 'nt-math' }, el('b', { text: 'The maths: ' }),
        `half the group average (${r.avg}%) plus half the lowest match (${r.min}%) = ${r.group}%. ${limit}`));
  }

  function resultCard(r, rank) {
    const names = people.map((p) => p.name);
    const e = r.entry;
    const open = el('button', { class: 'nt-open', type: 'button', text: 'Open' });
    open.addEventListener('click', () => onPick(e));
    return el('article', { class: `nt-result${rank === 0 ? ' first' : ''}` },
      el('div', { class: 'nt-rank', text: String(rank + 1) }),
      e.poster ? el('img', { src: posterSrc(e.poster, 'w185'), alt: '' }) : el('div', { class: 'nt-noimg' }),
      el('div', { class: 'nt-body' },
        el('h4', { text: e.title }),
        el('p', { class: 'nt-meta', text: `${(e.date || '').slice(0, 4)} · ${(e.genres || []).slice(0, 3).join(', ')}` }),
        el('p', { class: 'nt-verdict', text: verdict(r, names) }),
        el('div', { class: 'nt-bars' }, ...r.people.map((v, i) => el('div', { class: 'nt-bar' },
          el('span', { text: names[i] }), el('i', { style: `--w:${v}%` }), el('em', { text: v ? `${v}%` : '—' })))),
        why(r)),
      el('div', { class: 'nt-score' }, el('b', { text: `${r.group}%` }), el('small', { text: 'group match' }), open));
  }

  function draw() {
    const canRun = people.every((p) => p.likes.length) && !busy;
    const go = el('button', { class: 'btn primary nt-go', type: 'button', text: busy ? 'Thinking…' : 'Find our film' });
    go.disabled = !canRun; go.addEventListener('click', run);
    const add = people.length < MAX_PEOPLE && el('button', { class: 'btn nt-addp', type: 'button', text: '+ Add a person' });
    add && add.addEventListener('click', () => { people.push({ name: NAMES[people.length] || `Person ${people.length + 1}`, likes: [] }); results = null; draw(); });
    const demo = el('button', { class: 'linkbtn', type: 'button', text: 'Try it with an example group' });
    demo.addEventListener('click', () => { fillExample(); draw(); run(); });
    const close = el('button', { class: 'd-close', type: 'button', 'aria-label': 'Close', text: '✕' });
    close.addEventListener('click', () => dialog.close());
    dialog.replaceChildren(el('div', { class: 'nt' },
      close,
      el('header', { class: 'nt-head' }, el('p', { class: 'lab-kicker', text: 'Group pick' }), el('h2', { text: 'Movie Night' }),
        el('p', { text: 'Everyone names a few films they love. The on-device model finds the one title the whole group should enjoy, and shows who’s least sold, so nobody gets stuck watching something they hate.' })),
      el('div', { class: 'nt-people' }, ...people.map(personCard)),
      el('div', { class: 'nt-actions' }, add || null, go, demo),
      busy && el('p', { class: 'nt-busy', role: 'status', text: busy }),
      results && (results.length
        ? el('div', { class: 'nt-results' }, el('h3', { text: 'Tonight’s shortlist' }), ...results.map(resultCard),
          el('p', { class: 'nt-method', text: `How it works: each person’s taste is the average meaning-vector of their picks (${engine || 'on-device model'}). A film’s group score is half the group’s average match and half the lowest match (the “least misery” rule), so a title one person adores and another hates is pushed down. Candidates are the films in your current view, minus everyone’s picks.` }))
        : el('p', { class: 'nt-hint', text: 'Nothing here suits everyone. Try loosening your filters or adding more favourites.' }))));
  }

  function fillExample() {
    const pool = getAll().filter((e) => e.poster && (e.genres || []).length);
    if (pool.length < 6) return;
    const byGenre = new Map();
    for (const e of pool) for (const g of (e.genres || []).slice(0, 1)) (byGenre.get(g) || byGenre.set(g, []).get(g)).push(e);
    const gs = [...byGenre.entries()].sort((a, b) => b[1].length - a[1].length).filter(([, l]) => l.length >= 3);
    const a = gs[0]?.[1] || pool, b = gs[1]?.[1] || pool.slice().reverse();
    people = [{ name: NAMES[0], likes: a.slice(0, 3) }, { name: NAMES[1], likes: b.filter((e) => !a.slice(0, 3).includes(e)).slice(0, 3) }];
  }

  return { open() { if (!results) busy = ''; draw(); if (!dialog.open) dialog.showModal(); }, example() { fillExample(); draw(); return run(); } };
}
