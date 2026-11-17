// On-device semantic engine. Embeds film descriptions with a small sentence-transformer
// (all-MiniLM-L6-v2 via Transformers.js, running in your browser through WASM) and falls back to a
// hashed TF-IDF model when the model can't be loaded (offline, blocked CDN). No server, no API key,
// and nothing about what you watch leaves your machine.
import { hashVector, buildIdf, hashText } from './vec.js';
import { getMany, setMany } from './idb.js';

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
const MODEL = 'Xenova/all-MiniLM-L6-v2';

let enginePromise = null;
const vecs = new Map(); // `${engine}|${text}` -> vector

export const entryText = (e) => [e.title, (e.genres || []).join(', '), e.tagline, e.overview].filter(Boolean).join('. ');

// Give up on the neural model if nothing happens for this long (blocked CDN, no WASM, offline).
const IDLE_MS = 15000;

async function loadNeural(onStatus) {
  if (new URLSearchParams(location.search).has('noml')) throw new Error('neural engine disabled by ?noml');
  let last = Date.now(), dead;
  const watchdog = new Promise((_, rej) => { dead = setInterval(() => { if (Date.now() - last > IDLE_MS) rej(new Error('model load stalled')); }, 1000); });
  const load = (async () => {
    const { pipeline, env } = await import(TRANSFORMERS);
    env.allowLocalModels = false;
    return pipeline('feature-extraction', MODEL, {
      progress_callback: (p) => { last = Date.now(); if (p.status === 'progress' && p.total) onStatus?.(`Downloading language model… ${Math.round((p.loaded / p.total) * 100)}%`); },
    });
  })();
  let extractor;
  try { extractor = await Promise.race([load, watchdog]); } finally { clearInterval(dead); }
  return {
    name: 'MiniLM (on-device neural)',
    neural: true,
    async embed(texts) {
      const out = [];
      for (let i = 0; i < texts.length; i += 24) {
        const t = await extractor(texts.slice(i, i + 24), { pooling: 'mean', normalize: true });
        out.push(...t.tolist().map((r) => Float32Array.from(r)));
        await new Promise((r) => setTimeout(r)); // keep the UI responsive
      }
      return out;
    },
  };
}

function loadFallback() {
  let idf = null;
  return {
    name: 'keyword TF-IDF (fallback)',
    neural: false,
    async embed(texts, corpus) { idf = idf || buildIdf(corpus || texts); return texts.map((t) => hashVector(t, 512, idf)); },
  };
}

export function getEngine(onStatus) {
  if (!enginePromise) {
    enginePromise = (async () => {
      try { onStatus?.('Loading on-device language model…'); const e = await loadNeural(onStatus); engineName = e.name; return e; }
      catch (err) { console.warn('Neural engine unavailable, using keyword fallback:', err); const e = loadFallback(); engineName = e.name; return e; }
    })();
  }
  return enginePromise;
}

/** Embed texts (cached). `corpus` is only used by the fallback to build idf weights. */
export async function embedTexts(texts, onStatus, corpus) {
  const eng = await getEngine(onStatus);
  let missing = [...new Set(texts.filter((t) => !vecs.has(`${eng.name}|${t}`)))];
  // Neural vectors don't depend on the other texts, so they're kept between visits (IndexedDB).
  // The keyword fallback's weights depend on the whole corpus, and it's cheap, so it isn't persisted.
  if (missing.length && eng.neural) {
    const keyOf = (t) => `${eng.name}|${hashText(t)}`;
    const found = await getMany(missing.map(keyOf));
    if (found.size) { missing.forEach((t) => { const v = found.get(keyOf(t)); if (v) vecs.set(`${eng.name}|${t}`, v); }); missing = missing.filter((t) => !vecs.has(`${eng.name}|${t}`)); }
  }
  if (missing.length) {
    onStatus?.(`Reading ${missing.length} synopses…`);
    const out = await eng.embed(missing, corpus || texts);
    missing.forEach((t, i) => vecs.set(`${eng.name}|${t}`, out[i]));
    if (eng.neural) setMany(missing.map((t, i) => [`${eng.name}|${hashText(t)}`, out[i]]));
  }
  return { engine: eng, vectors: texts.map((t) => vecs.get(`${eng.name}|${t}`)) };
}

/** Name of the engine once it has loaded (for display), or null if nothing has been embedded yet. */
export let engineName = null;
export const engineLoaded = () => engineName;
