// "AI Lab": a plain-language tour of every data-science / ML technique in the app, each with a live
// "Try it" button, the technology used, and the exact file it lives in.
import { el } from './ui.js';
import { engineLoaded } from './semantic.js';

const EXAMPLES = ['tense space thriller with a twist', 'feel-good family adventure', 'dark psychological horror', 'witty romantic comedy in a big city'];

const TECHNIQUES = [
  { icon: '✦', name: 'Semantic search', kind: 'NLP · embeddings',
    what: 'Describe a mood in your own words and the app finds titles that mean the same thing, even when no keyword matches.',
    how: 'Each synopsis is turned into a 384-dimensional vector by a sentence-transformer (all-MiniLM-L6-v2) running in your browser through WebAssembly. Results are ranked by cosine similarity to your query.',
    tags: ['Transformers.js', 'MiniLM-L6-v2', 'Cosine similarity', 'WASM'], file: 'js/semantic.js · js/vec.js', try: 'search' },
  { icon: '◎', name: 'Content-based recommendations', kind: 'Recommender system',
    what: '“Find similar titles” on any film, with a calibrated match percentage and a relevance floor, so weak matches are never shown.',
    how: 'Nearest-neighbour search in embedding space. Scores are calibrated on an absolute scale per engine rather than stretched across the result set, which avoids the classic “everything looks like a match” bug.',
    tags: ['k-NN', 'Score calibration', 'Relevance threshold'], file: 'js/vec.js · js/app.js (runAI)', try: 'similar' },
  { icon: '♥', name: 'Your taste model', kind: 'Supervised learning',
    what: 'Save a few titles and the app learns what you like, then ranks everything else by how likely you are to enjoy it.',
    how: 'L2-regularised logistic regression with class balancing, trained on-device with gradient descent. Quality is measured with leave-one-positive-out AUC: each saved title is held out in turn and ranked among the unsaved ones.',
    tags: ['Logistic regression', 'Gradient descent', 'AUC', 'Cross-validation'], file: 'js/ml.js · js/insights.js', try: 'insights' },
  { icon: '◔', name: 'Taste map', kind: 'Unsupervised learning',
    what: 'A 2-D map of the whole catalogue: titles with similar stories sit together, coloured by automatically discovered themes.',
    how: 'PCA by power iteration reduces the embeddings to 2-D; k-means++ finds clusters; k is chosen by silhouette score; each cluster is named from its most distinctive words (c-TF-IDF).',
    tags: ['PCA', 'k-means++', 'Silhouette score', 'c-TF-IDF'], file: 'js/ml.js · js/insights.js', try: 'insights' },
  { icon: '✓', name: 'Model evaluation', kind: 'ML engineering',
    what: 'The app measures itself. A live report shows whether the embeddings really group similar films, against a random baseline.',
    how: 'Neighbour genre hit-rate @5 versus the expected random hit-rate, silhouette for cluster quality, AUC for the taste model. Genres act as weak labels that the model never saw.',
    tags: ['Hit-rate@k', 'Baselines', 'Silhouette', 'AUC'], file: 'js/ml.js · js/insights.js', try: 'insights' },
  { icon: '▦', name: 'Data analytics', kind: 'Data analysis',
    what: 'Release density by month and weekday, genre mix, rating and runtime distributions, and genre pairings for whatever you are looking at.',
    how: 'Descriptive statistics (median, IQR, percentiles), histograms and a co-occurrence matrix over the live, filtered data, drawn as hand-built SVG with no chart library.',
    tags: ['Descriptive stats', 'Histograms', 'Co-occurrence', 'SVG'], file: 'js/insights.js · js/ml.js', try: 'insights' },
  { icon: '⚙', name: 'Resilient by design', kind: 'Engineering',
    what: 'If the neural model can’t load (offline, blocked, no WebAssembly) the same features still work.',
    how: 'A hashed TF-IDF engine (signed feature hashing, sublinear tf, idf) is used as a fallback, and the UI says which engine ran. Everything is on-device, so nothing you watch leaves your browser.',
    tags: ['Graceful degradation', 'Feature hashing', 'Privacy-first'], file: 'js/semantic.js', try: null },
  { icon: '≋', name: 'Data pipeline', kind: 'Data engineering',
    what: 'Release dates move. The app notices, and tells you when a film has been delayed.',
    how: 'A TMDB ingestion pipeline with a pooled, retrying client, response trimming and caching, plus inference of delayed and rumoured status from observed date changes between visits.',
    tags: ['REST API', 'Caching', 'Rate-limit back-off', 'Change detection'], file: 'js/radar.js · js/tmdb.js · js/model.js', try: null },
];

export function createLab({ dialog, onSearch, onSimilar, onInsights }) {
  const run = { search: onSearch, similar: onSimilar, insights: onInsights };
  function paint() {
    const close = el('button', { class: 'd-close', 'aria-label': 'Close', text: '×' });
    close.addEventListener('click', () => dialog.close());
    const eng = engineLoaded();
    const chips = el('div', { class: 'lab-examples' }, el('span', { text: 'Try a mood:' }),
      ...EXAMPLES.map((q) => { const b = el('button', { type: 'button', text: `“${q}”` }); b.addEventListener('click', () => { dialog.close(); onSearch(q); }); return b; }));
    dialog.replaceChildren(close,
      el('header', { class: 'lab-head' },
        el('span', { class: 'lab-kicker', text: '✦ Under the hood' }),
        el('h2', { text: 'AI, machine learning and data science' }),
        el('p', { text: 'Everything below runs in your browser: no server, no API key for the ML, and nothing about what you watch leaves your device. Every algorithm is implemented from scratch, deterministic and covered by unit tests.' }),
        el('div', { class: 'lab-status' },
          el('span', { class: eng ? 'on' : '', text: eng ? `Engine ready: ${eng}` : 'Model loads the first time you use an AI feature (about 25 MB, cached afterwards)' }))),
      chips,
      el('div', { class: 'lab-grid' }, ...TECHNIQUES.map((t, i) => {
        const go = t.try && el('button', { class: 'lab-try', type: 'button', text: t.try === 'search' ? 'Try semantic search' : t.try === 'similar' ? 'Try “find similar”' : 'Open in Insights' });
        go?.addEventListener('click', () => { dialog.close(); run[t.try]?.(); });
        return el('article', { class: 'lab-card', style: `--i:${i}` },
          el('div', { class: 'lab-ico', text: t.icon }),
          el('small', { text: t.kind }), el('h3', { text: t.name }),
          el('p', { class: 'what', text: t.what }), el('p', { class: 'how', text: t.how }),
          el('div', { class: 'lab-tags' }, ...t.tags.map((x) => el('span', { text: x }))),
          el('footer', {}, el('code', { text: t.file }), go));
      })),
      el('footer', { class: 'lab-foot' }, el('span', { text: '33 unit tests cover the maths (npm test). See docs/ML.md for methodology, evaluation and limitations.' })));
  }
  return { open() { paint(); if (!dialog.open) dialog.showModal(); } };
}
