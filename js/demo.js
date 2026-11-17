import { SEASONS } from './seasons.js';
// Demo mode (?demo): a deterministic set of FICTIONAL titles so the UI can be explored, tested and
// screenshotted without a TMDB key. Nothing here is real release data.

import { SERVICES, addDays, ymd } from './model.js';

function seeded(seed) { // mulberry32
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ = ['Neon', 'Hollow', 'Silent', 'Crimson', 'Last', 'Midnight', 'Broken', 'Golden', 'Distant', 'Electric',
  'Paper', 'Velvet', 'Iron', 'Lunar', 'Wild', 'Quiet', 'Burning', 'Glass', 'Savage', 'Eternal'];
const NOUN = ['Meridian', 'Lighthouse', 'Orchard', 'Protocol', 'Harvest', 'Signal', 'Cartographer', 'Tide', 'Empire',
  'Garden', 'Witness', 'Horizon', 'Carnival', 'Frontier', 'Archive', 'Reckoning', 'Sparrow', 'Voyage', 'Mirage', 'Lantern'];
const FORMS = ['{A} {N}', 'The {A} {N}', '{N} of the {A}', 'Project {N}', '{A} {N}: Origins', 'Return to {N}', 'The {N} Files'];
const GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Drama', 'Family', 'Fantasy', 'Horror',
  'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'Documentary'];
const PALETTES = [['#8a1006', '#2a0305'], ['#e0a83a', '#4a0000'], ['#c8202f', '#1a0204'], ['#e8b05c', '#5a0a0a'],
  ['#a3150a', '#0a0a0a'], ['#d99a2b', '#3a0606'], ['#7a0c0c', '#0a0a0a'], ['#b8742a', '#2a0505']];
const LANGS = ['en', 'en', 'en', 'en', 'en', 'en', 'ja', 'ko', 'fr', 'es'];
const CERTS = ['G', 'PG', 'PG', 'M', 'M', 'M', 'MA15+', 'MA15+', 'R18+'];
const BITS = ['A reluctant hero', 'A rookie detective', 'Two estranged siblings', 'A retired pilot', 'A small-town doctor',
  'An exiled queen', 'A rogue AI', 'A touring band'];
const PLOTS = ['uncovers a secret that was never meant to surface', 'is pulled into a race against time across three continents',
  'must choose between loyalty and the truth', 'returns home to find nothing is as it was', 'sets out to settle an old score',
  'discovers the city is hiding something far older than itself'];
const FIRST = ['Ada', 'Ben', 'Cleo', 'Dev', 'Eli', 'Faye', 'Gus', 'Hana', 'Ivo', 'June', 'Kit', 'Lena', 'Milo', 'Nora', 'Otis'];
const LAST = ['Marlow', 'Okoye', 'Lindqvist', 'Tran', 'Navarro', 'Hale', 'Brandt', 'Quill', 'Moreau', 'Sato', 'Ferris', 'Adeyemi'];

function poster(title, [c1, c2], r) {
  const words = title.replace(/[:]/g, '').split(' ');
  const mid = Math.ceil(words.length / 2);
  const lines = words.length > 2 ? [words.slice(0, mid).join(' '), words.slice(mid).join(' ')] : [title];
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cx = 40 + Math.round(r() * 120);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
    + `<rect width="200" height="300" fill="url(#g)"/>`
    + `<circle cx="${cx}" cy="110" r="${50 + Math.round(r() * 40)}" fill="#fff" opacity=".13"/>`
    + `<circle cx="${200 - cx}" cy="70" r="${20 + Math.round(r() * 30)}" fill="#fff" opacity=".1"/>`
    + `<path d="M0 230 L200 170 L200 300 L0 300Z" fill="#000" opacity=".28"/>`
    + lines.map((l, i) => `<text x="14" y="${252 + i * 22}" font-family="Helvetica,Arial,sans-serif" font-weight="800" font-size="16" fill="#fff">${esc(l)}</text>`).join('')
    + `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function makeTitles(n, seed, idBase, { movies = 0.62, season = '' } = {}) {
  const S = season ? SEASONS[season] : null;
  const r = seeded(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const seen = new Set();
  const out = [];
  while (out.length < n) {
    const title = pick(S ? S.demo.forms : FORMS).replace('{A}', pick(ADJ)).replace('{N}', pick(NOUN));
    if (seen.has(title)) continue;
    seen.add(title);
    const type = r() < movies ? 'movie' : 'tv';
    const gs = new Set(S ? [pick(S.demo.genres), pick(S.demo.genres)] : [pick(GENRES), pick(GENRES)]);
    if (r() < 0.35) gs.add(pick(GENRES));
    out.push({
      key: `${type}:${idBase + out.length}`, id: idBase + out.length, type, title,
      poster: poster(title, pick(PALETTES), r),
      overview: S ? `${pick(BITS)} in ${S.label} season: ${S.demo.plot}. (Fictional demo title.)` : `${pick(BITS)} ${pick(PLOTS)}. (Fictional demo title.)`,
      tagline: r() < 0.5 ? 'Nothing stays buried.' : undefined,
      popularity: Math.round(r() * 1000) / 10, lang: pick(LANGS), genres: [...gs], providers: [], label: '',
      ...(type === 'movie' ? { runtime: 82 + Math.floor(r() * 85), cert: pick(CERTS) } : {}),
    });
  }
  return { out, r, pick };
}

// AU cinema openings are on Thursdays, so demo dates land on them.
const thursdayOnOrAfter = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + ((4 - dt.getDay() + 7) % 7));
  return ymd(dt);
};

export function demoCinema(now = new Date(), season = '') {
  const { out, r } = makeTitles(season ? 40 : 96, 7, 9000, { movies: 1, season });
  const today = ymd(now);
  return out.map((e) => {
    const roll = r();
    let date = thursdayOnOrAfter(addDays(today, 3 + Math.floor(r() * 480)));
    let status = 'confirmed';
    let delayedFrom;
    if (roll < 0.17) { date = thursdayOnOrAfter(addDays(today, -Math.floor(r() * 28))); if (date > today) date = addDays(date, -7); status = 'now_playing'; }
    else if (roll < 0.22) { status = 'rumoured'; date = `${now.getFullYear() + 1}-01-01`; }
    else if (roll < 0.29) { status = 'delayed'; delayedFrom = addDays(date, -63); }
    const digital = addDays(date, 70 + Math.floor(r() * 30));
    return { ...e, date, status, delayedFrom, rating: undefined,
      dates: { theatrical: date, digital, physical: addDays(digital, 21) } };
  });
}

export function demoSoon(now = new Date(), season = '') {
  const { out, r, pick } = makeTitles(season ? 40 : 84, 13, 7000, { movies: 0.45, season });
  const today = ymd(now);
  return out.map((e) => {
    const date = addDays(today, 2 + Math.floor(r() * 300));
    if (e.type === 'movie') {
      const svc = r() < 0.35 ? [pick(SERVICES)] : [];
      return { ...e, date: addDays(today, 2 + Math.floor(r() * 110)), status: 'confirmed', label: 'Digital release',
        services: svc.map((s) => s.id), providers: svc.map((s) => s.label) };
    }
    const s = pick(SERVICES);
    const season = r() < 0.5;
    return { ...e, date, status: r() < 0.1 ? 'rumoured' : 'confirmed', label: season ? `Season ${2 + Math.floor(r() * 3)}` : 'New series',
      services: [s.id], providers: [s.label], runtime: undefined, cert: undefined };
  });
}

export function demoNow(now = new Date(), season = '') {
  const { out, r } = makeTitles(season ? 60 : 150, 21, 5000, { season });
  const entries = [];
  for (const e of out) {
    const first = SERVICES[Math.floor(r() * SERVICES.length)];
    const svcs = [first];
    if (r() < 0.22) svcs.push(SERVICES[Math.floor(r() * SERVICES.length)]);
    const uniq = [...new Map(svcs.map((s) => [s.id, s])).values()];
    const date = ymd(new Date(now.getFullYear() - Math.floor(r() * 14), Math.floor(r() * 12), 1 + Math.floor(r() * 27)));
    entries.push({ ...e, date, status: 'available', rating: Math.round((4.5 + r() * 4.5) * 10) / 10,
      services: uniq.map((s) => s.id), providers: uniq.map((s) => s.label), runtime: undefined, cert: undefined });
  }
  return entries;
}

/** Fake "rich detail" matching what loadDetail() returns for real titles. */
export function demoDetail(e, pool = []) {
  const r = seeded(e.id * 31 + 5);
  const name = () => `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
  const svc = (e.providers || []).filter(Boolean);
  return {
    backdrop: e.poster, // demo: reuse the generated art so the hero has a picture
    tagline: e.tagline, runtime: e.runtime || (e.type === 'tv' ? 48 : undefined), cert: e.cert,
    rating: e.rating, votes: e.rating ? 1200 + Math.floor(r() * 9000) : undefined,
    seasons: e.type === 'tv' ? 1 + Math.floor(r() * 4) : undefined, episodes: e.type === 'tv' ? 8 + Math.floor(r() * 30) : undefined,
    directors: e.type === 'movie' ? [name()] : [], creators: e.type === 'tv' ? [name()] : [],
    cast: Array.from({ length: 6 }, () => ({ name: name(), character: 'Role (demo)' })),
    // Demo only: Blender Foundation's freely licensed short film, standing in for a trailer.
    videos: [{ key: 'aqz-KE-bpKQ', name: 'Demo video (Big Buck Bunny)', type: 'Trailer' }],
    dates: e.dates || (e.type === 'tv' ? { tv: e.date } : { theatrical: e.date }),
    status: e.status === 'available' || e.status === 'now_playing' ? 'Released' : 'In Production',
    budget: e.type === 'movie' ? (40 + Math.floor(r() * 160)) * 1e6 : undefined,
    revenue: e.status === 'now_playing' ? (80 + Math.floor(r() * 500)) * 1e6 : undefined,
    keywords: ['demo data', 'fictional', 'sample', ...(e.genres || []).map((g) => g.toLowerCase())].slice(0, 8),
    crew: e.type === 'movie' ? [['Director', [name()]], ['Writing', [name(), name()]], ['Music', [name()]]] : [],
    companies: ['Fictional Pictures', 'Demo Studios'],
    reviews: [
      { author: 'demo_reviewer', rating: 8, date: '2026-10-01T00:00:00Z', text: 'A fictional review for demo mode. The pacing is confident, the score is memorable, and the second act is the standout. Worth a watch when it lands.' },
      { author: 'cinephile42', rating: 6, date: '2026-09-18T00:00:00Z', text: 'Another invented opinion: ambitious and uneven, but the performances carry it through the slower stretches.' },
    ],
    similar: pool.filter((x) => x.key !== e.key && x.poster).slice(0, 12).map((x) => ({ id: x.id, type: x.type, title: x.title, date: x.date, poster: x.poster, overview: x.overview, rating: x.rating || 7.1 })),
    links: { homepage: 'https://example.com' },
    networks: svc,
    watch: { link: '', stream: svc, free: [], rent: e.status === 'available' ? [] : [], buy: [] },
  };
}
