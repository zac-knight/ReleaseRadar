// Data pipeline against TMDB.
//   loadCinema     movies with a theatrical release in your region (now playing + upcoming)
//   loadSoon       what's about to reach streaming: digital releases + each service's new series/seasons
//   loadAvailable  what is already on each service
//   loadDetail     rich per-title data (cast, trailer, runtime, where to watch), fetched on demand
//   searchTitles   live search across all of TMDB

import { get, getAllPages, TTL } from './tmdb.js';
import { mergeCandidates, ymd, addDays, SERVICES, releaseInfo } from './model.js';

// ---- genres: TMDB ids -> readable names (movie and TV lists differ, so normalise) ---------
const GENRES = { movie: new Map(), tv: new Map() };
const RENAME = { 'Science Fiction': 'Sci-Fi' };
// TV uses combined genres ("Sci-Fi & Fantasy"); split them so one filter works for both formats.
const splitGenre = (name) => name.split(' & ').map((n) => RENAME[n] ?? n);
let genresReady;

export function ensureGenres() {
  genresReady ??= Promise.all(['movie', 'tv'].map(async (kind) => {
    try {
      const r = await get(`/genre/${kind}/list`, {}, TTL.search);
      GENRES[kind] = new Map((r.genres || []).map((g) => [g.id, splitGenre(g.name)]));
    } catch { genresReady = undefined; /* genres are a nicety; retry next time */ }
  }));
  return genresReady;
}

function candidate(raw, type) {
  return {
    key: `${type}:${raw.id}`,
    id: raw.id,
    type,
    title: raw.title || raw.name,
    date: raw.release_date || raw.first_air_date,
    poster: raw.poster_path,
    backdrop: raw.backdrop_path,
    overview: raw.overview,
    popularity: raw.popularity,
    lang: raw.original_language,
    genres: [...new Set((raw.genre_ids || []).flatMap((id) => GENRES[type].get(id) || []))],
  };
}

// ---- detail enrichment (list level, cached and slimmed) ---------------------------------
const slimDetail = (region) => (d) => {
  const r = d['watch/providers']?.results?.[region];
  const names = (list) => (list || []).map((x) => ({ provider_id: x.provider_id, provider_name: x.provider_name }));
  return {
    id: d.id, status: d.status, release_date: d.release_date, first_air_date: d.first_air_date,
    poster_path: d.poster_path, backdrop_path: d.backdrop_path, overview: d.overview, tagline: d.tagline,
    runtime: d.runtime, vote_average: d.vote_average, vote_count: d.vote_count,
    next_episode_to_air: d.next_episode_to_air && {
      air_date: d.next_episode_to_air.air_date, episode_number: d.next_episode_to_air.episode_number,
      season_number: d.next_episode_to_air.season_number },
    networks: (d.networks || []).map((n) => ({ name: n.name })),
    release_dates: { results: (d.release_dates?.results || []).filter((x) => x.iso_3166_1 === region).map((x) => ({
      iso_3166_1: x.iso_3166_1,
      release_dates: x.release_dates.map((rd) => ({ type: rd.type, release_date: rd.release_date, certification: rd.certification })) })) },
    'watch/providers': { results: { [region]: r && { flatrate: names(r.flatrate), free: names(r.free), ads: names(r.ads) } } },
  };
};

const getDetail = (c, region) => get(`/${c.type}/${c.id}`,
  { append_to_response: c.type === 'movie' ? 'release_dates,watch/providers' : 'watch/providers' },
  TTL.detail, slimDetail(region));

function providersOf(d, region) {
  const p = d['watch/providers']?.results?.[region];
  const out = [...(p?.flatrate || []), ...(p?.free || []), ...(p?.ads || [])]
    .filter((x, i, a) => a.findIndex((y) => y.provider_id === x.provider_id) === i)
    .map((x) => x.provider_name);
  // Unreleased titles rarely have providers yet; a TV show's network (e.g. Disney+) is real data too.
  if (!out.length) out.push(...(d.networks || []).map((n) => n.name));
  return out;
}

/** A movie with the release date chosen by `pick(dates)` (theatrical, digital...). Null if it has none. */
async function enrichMovie(c, region, pick, within) {
  let d;
  try { d = await getDetail(c, region); } catch { return null; }
  const { dates, cert } = releaseInfo(d.release_dates?.results, region);
  const date = pick(dates);
  if (!date || date < within[0] || date > within[1]) return null;
  return {
    ...c, date, dates, cert, label: '',
    runtime: d.runtime || undefined,
    rating: d.vote_count > 0 ? d.vote_average : undefined,
    tagline: d.tagline || undefined,
    providers: providersOf(d, region),
    tmdbStatus: d.status,
    poster: d.poster_path || c.poster,
    backdrop: d.backdrop_path,
    overview: d.overview || c.overview,
  };
}

/** A TV show's next premiere: a brand-new series, or the next season's first episode. */
async function enrichTv(c, region, today) {
  let d;
  try { d = await getDetail(c, region); } catch { return c.date >= today ? { ...c, providers: [], label: '' } : null; }
  const next = d.next_episode_to_air;
  let date; let label;
  if (d.first_air_date && d.first_air_date >= today) { date = d.first_air_date; label = 'New series'; }
  else if (next?.air_date >= today && next.episode_number === 1) { date = next.air_date; label = `Season ${next.season_number}`; }
  else return null; // already airing, nothing upcoming worth listing
  return {
    ...c, date, label, dates: {},
    providers: providersOf(d, region),
    tmdbStatus: d.status,
    poster: d.poster_path || c.poster,
    backdrop: d.backdrop_path,
    overview: d.overview || c.overview,
    tagline: d.tagline || undefined,
  };
}

const settleAll = async (jobs) => {
  const settled = await Promise.allSettled(jobs);
  if (settled.length && settled.every((x) => x.status === 'rejected')) throw settled[0].reason;
  return settled.filter((x) => x.status === 'fulfilled').map((x) => x.value);
};

// ---- In cinemas ---------------------------------------------------------------------
/**
 * Movies with a theatrical (wide or limited) release in `region`, from ~5 weeks ago (still playing)
 * to 18 months out, most popular first. Dates are the regional cinema dates, not the global ones.
 */
/** TMDB keyword ids for a season's keyword names (looked up, then cached for a week by the TMDB client). */
export async function seasonKeywordIds(names) {
  const found = await Promise.all(names.map((q) => get('/search/keyword', { query: q }, TTL.search).then((r) => {
    const hits = r.results || [];
    return (hits.find((k) => k.name?.toLowerCase() === q.toLowerCase()) || hits[0])?.id;
  }).catch(() => undefined)));
  return [...new Set(found.filter(Boolean))];
}

export async function loadCinema({ region = 'US', now = new Date(), extra = {}, onEntry = () => {}, onProgress = () => {} } = {}) {
  const today = ymd(now);
  const from = addDays(today, -35);
  const to = ymd(new Date(now.getFullYear(), now.getMonth() + 18, now.getDate()));
  await ensureGenres();
  const [list] = await settleAll([getAllPages('/discover/movie', {
    region, with_release_type: '2|3', 'release_date.gte': from, 'release_date.lte': to,
    sort_by: 'popularity.desc', include_adult: false, ...extra,
  }, { maxPages: 10 })]);
  const candidates = list.map((r) => candidate(r, 'movie')).filter((c) => c.title);
  const out = [];
  let done = 0;
  await Promise.all(candidates.map(async (c) => {
    const e = await enrichMovie(c, region, (d) => d.theatrical ?? d.limited, [from, to]);
    if (e) { out.push(e); onEntry(e); }
    onProgress(++done, candidates.length);
  }));
  return out;
}

// ---- Coming to streaming ------------------------------------------------------------
/**
 * Calls onBatch(taskId, entries) per task. Tasks: 'movies' (cinema titles reaching digital/streaming in
 * the next ~4 months) and one per service id (that service's own new series and new seasons).
 */
export async function loadSoon({ region = 'US', now = new Date(), tasks, extra = {}, onBatch = () => {} }) {
  const today = ymd(now);
  const horizon = ymd(new Date(now.getFullYear(), now.getMonth() + 12, now.getDate()));
  await ensureGenres();

  const run = async (id) => {
    let entries = [];
    if (id === 'movies') {
      const to = addDays(today, 120);
      const rs = await getAllPages('/discover/movie', {
        region, with_release_type: '4', 'release_date.gte': today, 'release_date.lte': to,
        sort_by: 'popularity.desc', include_adult: false, ...extra,
      }, { maxPages: 4 });
      const found = await Promise.all(rs.map((r) => enrichMovie(candidate(r, 'movie'), region, (d) => d.digital, [today, to])));
      entries = found.filter(Boolean).map((e) => ({ ...e, label: 'Digital release' }));
    } else {
      const svc = SERVICES.find((s) => s.id === id);
      const nets = svc.networks.join('|');
      const lists = await settleAll([
        getAllPages('/discover/tv', { with_networks: nets, 'first_air_date.gte': today, 'first_air_date.lte': horizon, sort_by: 'popularity.desc', ...extra }, { maxPages: 1 }),
        getAllPages('/discover/tv', { with_networks: nets, 'air_date.gte': today, 'air_date.lte': horizon, sort_by: 'popularity.desc', ...extra }, { maxPages: 1 }),
      ]);
      const cands = mergeCandidates(...lists.map((l) => l.map((r) => candidate(r, 'tv')))).filter((c) => c.title);
      const found = await Promise.all(cands.map((c) => enrichTv(c, region, today)));
      entries = found.filter(Boolean).map((e) => ({ ...e, services: [id], providers: [svc.label] }));
    }
    onBatch(id, entries);
  };

  const settled = await Promise.allSettled(tasks.map(run));
  const bad = settled.find((x) => x.status === 'rejected');
  if (bad && settled.every((x) => x.status === 'rejected')) throw bad.reason;
}

// ---- On streaming now ------------------------------------------------------------------
async function providerIds(region) {
  const slim = (v) => ({ results: (v.results || []).map((p) => ({ provider_id: p.provider_id, provider_name: p.provider_name })) });
  const [m, t] = await Promise.all(['movie', 'tv'].map((k) =>
    get(`/watch/providers/${k}`, { watch_region: region }, TTL.search, slim)));
  const all = [...(m.results || []), ...(t.results || [])];
  return Object.fromEntries(SERVICES.map((s) => [s.id, [...new Set(all
    .filter((p) => s.match.test(p.provider_name) && !/channel/i.test(p.provider_name))
    .map((p) => p.provider_id))]]));
}

/**
 * The most popular titles on the given services in `region`, using TMDB's own provider filter.
 * Calls onBatch(serviceId, entries) as each service finishes.
 * Resolves to { missing } listing services TMDB doesn't know in that region.
 */
export async function loadAvailable({ region = 'US', services, now = new Date(), extra = {}, onBatch = () => {} }) {
  const today = ymd(now);
  const [ids] = await Promise.all([providerIds(region), ensureGenres()]);
  const missing = [];
  const jobs = [];
  for (const sid of services) {
    const pids = ids[sid];
    if (!pids.length) { missing.push(sid); continue; }
    const label = SERVICES.find((s) => s.id === sid).label;
    const queries = ['movie', 'tv'].map((type) => getAllPages(`/discover/${type}`, {
      with_watch_providers: pids.join('|'), watch_region: region,
      with_watch_monetization_types: 'flatrate|free|ads', sort_by: 'popularity.desc', include_adult: false,
      [type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte']: today, ...extra,
    }, { maxPages: 3 }).then((rs) => rs.map((r) => ({
      ...candidate(r, type), status: 'available', services: [sid], providers: [label],
      rating: r.vote_average > 0 ? r.vote_average : undefined }))));
    jobs.push(Promise.allSettled(queries).then((res) => {
      const ok = res.filter((x) => x.status === 'fulfilled');
      if (!ok.length) throw res[0].reason;
      onBatch(sid, mergeCandidates(...ok.map((x) => x.value)).filter((e) => e.title && e.date));
    }));
  }
  const settled = await Promise.allSettled(jobs);
  const bad = settled.find((x) => x.status === 'rejected');
  if (bad && settled.every((x) => x.status === 'rejected')) throw bad.reason;
  return { missing };
}

// ---- rich detail (on demand) ---------------------------------------------------------------
const slimRich = (region) => (d) => {
  const wp = d['watch/providers']?.results?.[region];
  const prov = (l) => (l || []).map((x) => ({ name: x.provider_name, logo: x.logo_path }));
  const videos = (d.videos?.results || []).filter((v) => v.site === 'YouTube');
  const rank = (v) => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 1 : 2) + (v.official ? 0 : 0.5);
  const sorted = [...videos].sort((a, b) => rank(a) - rank(b));
  const trailer = sorted[0];
  const crew = d.credits?.crew || [];
  const people = (jobs, n = 3) => [...new Set(crew.filter((c) => jobs.includes(c.job)).map((c) => c.name))].slice(0, n);
  const ext = d.external_ids || {};
  const kw = d.keywords?.keywords || d.keywords?.results || [];
  const title = (r) => r.title || r.name;
  return {
    tagline: d.tagline, status: d.status, homepage: d.homepage,
    backdrop: d.backdrop_path || d.images?.backdrops?.[0]?.file_path,
    runtime: d.runtime || d.episode_run_time?.[0],
    rating: d.vote_count > 0 ? d.vote_average : undefined, votes: d.vote_count,
    seasons: d.number_of_seasons, episodes: d.number_of_episodes,
    networks: (d.networks || []).map((n) => n.name),
    creators: (d.created_by || []).map((c) => c.name),
    directors: people(['Director']),
    crew: [['Director', people(['Director'])], ['Writing', people(['Screenplay', 'Writer', 'Story'], 4)], ['Producer', people(['Producer'], 3)],
      ['Music', people(['Original Music Composer', 'Music'], 2)], ['Cinematography', people(['Director of Photography'], 2)]].filter(([, v]) => v.length),
    cast: (d.credits?.cast || []).slice(0, 16).map((c) => ({ name: c.name, character: c.character, photo: c.profile_path })),
    trailer: trailer && { key: trailer.key, name: trailer.name },
    videos: sorted.slice(0, 12).map((v) => ({ key: v.key, name: v.name, type: v.type })),
    backdrops: (d.images?.backdrops || []).slice(0, 12).map((i) => i.file_path),
    posters: (d.images?.posters || []).slice(0, 8).map((i) => i.file_path),
    keywords: kw.slice(0, 14).map((k) => k.name),
    reviews: (d.reviews?.results || []).slice(0, 4).map((r) => ({
      author: r.author, rating: r.author_details?.rating, avatar: r.author_details?.avatar_path,
      date: r.created_at, url: r.url, text: (r.content || '').replace(/\s+/g, ' ').slice(0, 520) })),
    similar: (d.recommendations?.results?.length ? d.recommendations.results : d.similar?.results || []).filter((r) => r.poster_path).slice(0, 12).map((r) => ({
      id: r.id, type: r.media_type || (d.title ? 'movie' : 'tv'), title: title(r), date: r.release_date || r.first_air_date,
      poster: r.poster_path, overview: r.overview, rating: r.vote_average, lang: r.original_language })),
    budget: d.budget || undefined, revenue: d.revenue || undefined,
    language: d.original_language, spoken: (d.spoken_languages || []).map((l) => l.english_name).slice(0, 3),
    companies: (d.production_companies || []).map((c) => c.name).slice(0, 3),
    collection: d.belongs_to_collection && { name: d.belongs_to_collection.name },
    links: { imdb: ext.imdb_id, instagram: ext.instagram_id, twitter: ext.twitter_id, facebook: ext.facebook_id, homepage: d.homepage },
    releases: d.release_dates?.results?.filter((x) => x.iso_3166_1 === region).map((x) => ({
      iso_3166_1: x.iso_3166_1,
      release_dates: x.release_dates.map((rd) => ({ type: rd.type, release_date: rd.release_date, certification: rd.certification, note: rd.note })) })) || [],
    tvRating: d.content_ratings?.results?.find((x) => x.iso_3166_1 === region)?.rating,
    watch: wp && { link: wp.link, stream: prov(wp.flatrate), free: prov([...(wp.free || []), ...(wp.ads || [])]), rent: prov(wp.rent), buy: prov(wp.buy) },
  };
};

export async function loadDetail(e, region = 'US') {
  const append = e.type === 'movie'
    ? 'credits,videos,images,keywords,reviews,recommendations,external_ids,release_dates,watch/providers'
    : 'credits,videos,images,keywords,reviews,recommendations,external_ids,content_ratings,watch/providers';
  const d = await get(`/${e.type}/${e.id}`, { append_to_response: append, include_image_language: 'en,null' }, TTL.detail, slimRich(region));
  const info = releaseInfo(d.releases, region);
  return { ...d, dates: info.dates, cert: info.cert || d.tvRating };
}

// ---- search across all of TMDB -----------------------------------------------------------------
export async function searchTitles(query, { signal } = {}) {
  await ensureGenres();
  const r = await get('/search/multi', { query, include_adult: false }, 0);
  if (signal?.aborted) return [];
  return (r.results || [])
    .filter((x) => x.media_type === 'movie' || x.media_type === 'tv')
    .map((x) => candidate(x, x.media_type))
    .filter((c) => c.title && c.date)
    .map((c) => ({ ...c, status: 'released', providers: [], label: '' }));
}
