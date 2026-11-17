// Insights view: descriptive analytics + on-device ML over whatever is currently loaded and filtered.
// Charts are hand-built SVG (no library), coloured with CSS variables so they follow light/dark.
import { el } from './ui.js';
import { tokenize } from './vec.js';
import { kmeans, silhouette, pca2, neighbourGenreHit, histogram, quantile, cooccurrence, clusterTerms, trainLogReg, leaveOnePositiveOutAuc } from './ml.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  n.append(...kids.filter((x) => x != null));
  return n;
};
const PALETTE = ['#e8b05c', '#c8202f', '#f3d9a4', '#8a1006', '#b8832f', '#e0654f', '#7a5a2a', '#ffffff'];
const hue = (i) => PALETTE[i % PALETTE.length];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pct = (x) => `${Math.round(x * 100)}%`;

function card(title, sub, body, cls = '') {
  return el('section', { class: `in-card ${cls}` }, el('header', {}, el('h3', { text: title }), sub && el('p', { text: sub })), body);
}

/** Vertical bars. items: [{ label, value, hl? }] */
function bars(items, { h = 170, unit = '' } = {}) {
  const w = 560, pad = { l: 8, r: 8, t: 14, b: 26 };
  const max = Math.max(1, ...items.map((i) => i.value));
  const bw = (w - pad.l - pad.r) / items.length;
  const s = svg('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  items.forEach((it, i) => {
    const bh = ((h - pad.t - pad.b) * it.value) / max, x = pad.l + i * bw + bw * 0.15, y = h - pad.b - bh;
    s.append(svg('rect', { x, y, width: bw * 0.7, height: Math.max(bh, it.value ? 1 : 0), rx: 4, class: it.hl ? 'bar hl' : 'bar', style: `--i:${i}` }, svg('title', {}, `${it.label}: ${it.value}${unit}`)));
    if (it.value) s.append(svg('text', { x: x + bw * 0.35, y: y - 4, 'text-anchor': 'middle', class: 'val' }, String(it.value)));
    if (items.length <= 16 || i % 2 === 0) s.append(svg('text', { x: x + bw * 0.35, y: h - 8, 'text-anchor': 'middle', class: 'ax' }, it.label));
  });
  return s;
}

function hbars(items) {
  const row = 24, w = 560, lw = 110, h = items.length * row + 6;
  const max = Math.max(1, ...items.map((i) => i.value));
  const s = svg('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img' });
  items.forEach((it, i) => {
    const y = i * row + 4, bw = ((w - lw - 44) * it.value) / max;
    s.append(svg('text', { x: lw - 8, y: y + 15, 'text-anchor': 'end', class: 'ax' }, it.label),
      svg('rect', { x: lw, y: y + 3, width: Math.max(bw, 1), height: row - 8, rx: 4, class: 'bar hb', style: `--i:${i}` }, svg('title', {}, `${it.label}: ${it.value}`)),
      svg('text', { x: lw + bw + 6, y: y + 15, class: 'val' }, String(it.value)));
  });
  return s;
}

function heat(names, matrix) {
  const n = names.length, c = 46, lw = 74, w = lw + n * c, h = lw + n * c;
  const max = Math.max(1, ...matrix.flatMap((r, i) => r.filter((_, j) => j !== i)));
  const s = svg('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart heat', role: 'img' });
  names.forEach((nm, i) => {
    s.append(svg('text', { x: lw - 6, y: lw + i * c + c / 2 + 4, 'text-anchor': 'end', class: 'ax' }, nm),
      svg('text', { x: lw + i * c + c / 2, y: lw - 8, 'text-anchor': 'middle', class: 'ax', transform: `rotate(-35 ${lw + i * c + c / 2} ${lw - 8})` }, nm));
    names.forEach((_, j) => {
      const v = matrix[i][j], diag = i === j;
      s.append(svg('rect', { x: lw + j * c + 1, y: lw + i * c + 1, width: c - 2, height: c - 2, rx: 6, class: 'cell', style: `--a:${diag ? 0.06 : Math.min(1, v / max)}` }, svg('title', {}, `${nm} × ${names[j]}: ${v}`)),
        !diag && v ? svg('text', { x: lw + j * c + c / 2, y: lw + i * c + c / 2 + 4, 'text-anchor': 'middle', class: 'val' }, String(v)) : null);
    });
  });
  return s;
}

function kpi(label, value, note) { return el('div', { class: 'kpi' }, el('span', { text: label }), el('b', { text: value }), note && el('small', { text: note })); }

export function renderInsights({ entries, saved, embed, onPick, scopeLabel }) {
  const root = el('div', { class: 'insights' });
  const dated = entries.filter((e) => e.date && !/-0?1-0?1$/.test(e.date) || e.date);
  const ratings = entries.map((e) => e.rating).filter((r) => r > 0);
  const runtimes = entries.map((e) => e.runtime).filter((r) => r > 0);
  const genreLists = entries.map((e) => e.genres || []);
  const gFreq = new Map(); genreLists.forEach((l) => l.forEach((g) => gFreq.set(g, (gFreq.get(g) || 0) + 1)));
  const topGenres = [...gFreq].sort((a, b) => b[1] - a[1]);
  const byMonth = new Map(); dated.forEach((e) => { const k = e.date.slice(0, 7); if (/^\d{4}-\d\d$/.test(k) && !k.endsWith('-13')) byMonth.set(k, (byMonth.get(k) || 0) + 1); });
  const months = [...byMonth].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 16);
  const byDow = Array(7).fill(0); dated.forEach((e) => { const d = new Date(`${e.date}T00:00:00`); if (!isNaN(d) && !/-01-01$/.test(e.date)) byDow[d.getDay()]++; });
  const status = (s) => entries.filter((e) => e.status === s).length;
  const busiest = months.slice().sort((a, b) => b[1] - a[1])[0];

  if (!entries.length) return el('div', { class: 'in-empty', text: 'Nothing to analyse with the current filters.' });

  root.append(
    el('header', { class: 'in-head' }, el('h2', { text: 'Insights' }), el('p', { text: `${entries.length} titles ${scopeLabel || ''}. Everything is computed on your device from the current filters.` })),
    el('div', { class: 'kpis' },
      kpi('Titles', String(entries.length), `${gFreq.size} genres`),
      kpi('Median rating', ratings.length ? quantile(ratings, 0.5).toFixed(1) : '–', ratings.length ? `IQR ${quantile(ratings, 0.25).toFixed(1)}–${quantile(ratings, 0.75).toFixed(1)}` : ''),
      kpi('Median runtime', runtimes.length ? `${Math.round(quantile(runtimes, 0.5))}m` : '–', runtimes.length ? `${Math.round(quantile(runtimes, 0.1))}–${Math.round(quantile(runtimes, 0.9))}m (P10–P90)` : ''),
      kpi('Busiest month', busiest ? `${MONTHS[Number(busiest[0].slice(5)) - 1]} '${busiest[0].slice(2, 4)}` : '–', busiest ? `${busiest[1]} releases` : ''),
      kpi('Uncertain dates', `${status('rumoured') + status('delayed')}`, `${status('rumoured')} rumoured · ${status('delayed')} delayed`)),
    el('div', { class: 'in-grid' },
      months.length > 1 && card('Release calendar', 'Titles per month', bars(months.map(([k, v]) => ({ label: `${MONTHS[Number(k.slice(5)) - 1]}`, value: v })))),
      byDow.some(Boolean) && card('Release weekday', 'Australian cinema openings cluster on Thursdays', bars(DOW.map((d, i) => ({ label: d, value: byDow[i], hl: byDow[i] === Math.max(...byDow) })))),
      topGenres.length > 1 && card('Genres', 'Most common in this selection', hbars(topGenres.slice(0, 10).map(([label, value]) => ({ label, value })))),
      ratings.length > 4 && card('Rating distribution', `Median ${quantile(ratings, 0.5).toFixed(1)} across ${ratings.length} rated titles`, bars(histogram(ratings, 10, 0, 10).map((b) => ({ label: `${Math.round(b.from)}`, value: b.count })))),
      runtimes.length > 4 && card('Runtime distribution', 'Minutes', bars(histogram(runtimes, 10).map((b) => ({ label: `${Math.round(b.from)}`, value: b.count })))),
      topGenres.length > 3 && (() => { const c = cooccurrence(genreLists, Math.min(8, topGenres.length)); return card('Genre pairings', 'How often two genres share a title', heat(c.names, c.matrix)); })()));

  // ---- ML cards fill in asynchronously (they need embeddings) ----
  const mapBox = el('div', { class: 'map-box' }, el('p', { class: 'in-wait', text: 'Reading synopses and building the taste map…' }));
  const reportBox = el('div', { class: 'report' }, el('p', { class: 'in-wait', text: 'Evaluating the embedding model…' }));
  root.append(el('div', { class: 'in-grid ml' },
    card('Film map', 'Each dot is a film. Films whose stories read alike sit close together, and the colours are groups the model found on its own. Hover a dot to read it, click a group to isolate it, click a dot to open it.', mapBox, 'wide'),
    card('Model report', 'How good are the embeddings and the clusters, measured honestly', reportBox)));

  (async () => {
    try {
      const texts = entries.map((e) => [e.title, (e.genres || []).join(', '), e.tagline, e.overview].filter(Boolean).join('. '));
      const { engine, vectors } = await embed(texts, (m) => { if (mapBox.isConnected) mapBox.firstChild && (mapBox.firstChild.textContent = m); });
      if (!root.isConnected) return;
      const n = entries.length;
      if (n < 8) { mapBox.replaceChildren(el('p', { class: 'in-wait', text: 'Need at least 8 titles for the taste map.' })); reportBox.replaceChildren(); return; }

      // choose k by silhouette over a small range
      let best = null;
      for (let k = 3; k <= Math.min(8, Math.floor(n / 4)); k++) {
        const km = kmeans(vectors, k, { seed: 11 }); const sil = silhouette(vectors, km.labels);
        if (!best || sil > best.sil) best = { k, sil, ...km };
      }
      best ||= { k: 1, sil: 0, labels: new Array(n).fill(0) };
      const pts = pca2(vectors);
      const terms = clusterTerms(texts.map(tokenize), best.labels, { top: 3 });
      const name = (c) => {
        const idx = best.labels.map((l, i) => (l === c ? i : -1)).filter((i) => i >= 0);
        const gf = new Map(); idx.forEach((i) => (entries[i].genres || []).forEach((g) => gf.set(g, (gf.get(g) || 0) + 1)));
        const g = [...gf].sort((a, b) => b[1] - a[1])[0]?.[0];
        return [g, ...(terms.get(c) || []).slice(0, 2)].filter(Boolean).join(' · ') || `Cluster ${c + 1}`;
      };

      // scatter
      const W = 720, H = 420, P = 28;
      const groups = [...new Set(best.labels)].sort();
      const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart map', role: 'img', 'aria-label': 'Map of films grouped by story similarity' });
      s.append(svg('rect', { x: 0, y: 0, width: W, height: H, rx: 10, class: 'map-bg' }));
      const sx = (x) => P + ((x + 1) / 2) * (W - 2 * P), sy = (y) => P + ((1 - (y + 1) / 2)) * (H - 2 * P);
      const readout = el('div', { class: 'map-read' }, el('span', { text: 'Hover a dot to see which film it is.' }));
      const show = (e, c) => readout.replaceChildren(el('b', { text: e.title }), el('span', { text: ` · ${(e.genres || []).slice(0, 3).join(', ') || 'film'}` }), el('em', { text: name(c) }));
      const dots = [];
      entries.forEach((e, i) => {
        const dot = svg('circle', { cx: sx(pts[i][0]), cy: sy(pts[i][1]), r: saved.has(e.key) ? 7 : 5, fill: hue(best.labels[i]), class: `dot${saved.has(e.key) ? ' saved' : ''}`, tabindex: '0', 'data-c': best.labels[i], style: `--i:${i % 40}` },
          svg('title', {}, `${e.title} — ${name(best.labels[i])}`));
        dot.addEventListener('click', () => onPick(e));
        dot.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') onPick(e); });
        dot.addEventListener('pointerenter', () => show(e, best.labels[i]));
        dot.addEventListener('focus', () => show(e, best.labels[i]));
        dots.push(dot); s.append(dot);
      });
      // group names written on the map at each group's centre
      groups.forEach((c) => {
        const idx = best.labels.map((l, i) => (l === c ? i : -1)).filter((i) => i >= 0);
        const mx = idx.reduce((a, i) => a + pts[i][0], 0) / idx.length, my = idx.reduce((a, i) => a + pts[i][1], 0) / idx.length;
        s.append(svg('text', { x: sx(mx), y: sy(my), class: 'map-label', 'text-anchor': 'middle', 'data-c': c, fill: hue(c) }, name(c).split(' · ')[0]));
      });
      let focus = null;
      const legend = el('ul', { class: 'legend' }, ...groups.map((c) => {
        const ex = best.labels.map((l, i) => (l === c ? entries[i].title : null)).filter(Boolean).slice(0, 2).join(', ');
        const li = el('li', { tabindex: '0', role: 'button', 'aria-pressed': 'false', title: `Show only: ${name(c)}` }, el('i', { style: `background:${hue(c)}` }),
          el('span', {}, el('b', { text: name(c) }), el('small', { text: `${best.labels.filter((l) => l === c).length} films · e.g. ${ex}` })));
        const toggle = () => { focus = focus === c ? null : c; s.classList.toggle('has-focus', focus !== null);
          [...s.querySelectorAll('[data-c]')].forEach((n) => n.classList.toggle('dim', focus !== null && Number(n.dataset.c) !== focus));
          legend.querySelectorAll('li').forEach((l) => { const on = l === li && focus === c; l.classList.toggle('on', on); l.setAttribute('aria-pressed', String(on)); }); };
        li.addEventListener('click', toggle); li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
        return li;
      }));
      const honest = el('p', { class: 'map-note', text: best.sil < 0.25
        ? `Heads up: the groups overlap (silhouette ${best.sil.toFixed(2)}), so colours mix on the map. Story similarity doesn't split neatly into ${best.k} groups, and squashing ${vectors[0].length} dimensions into 2 loses detail. The model report shows how well it actually works.`
        : `Groups are well separated (silhouette ${best.sil.toFixed(2)}). Axes have no units: it's a 2D view of a ${vectors[0].length}-dimension space (PCA).` });
      mapBox.replaceChildren(legend, readout, s, honest);

      // report
      const nn = neighbourGenreHit(vectors, genreLists, 5);
      const rows = [];
      rows.push(el('div', { class: 'rep-row' }, el('b', { text: 'Engine' }), el('span', { text: engine.name })));
      if (nn) {
        rows.push(el('div', { class: 'rep-row col' }, el('b', { text: `Neighbour genre hit-rate @${nn.k}` }),
          el('div', { class: 'duel' },
            el('div', {}, el('span', { text: 'Embedding neighbours' }), el('i', { class: 'm', style: `--w:${nn.hit * 100}%` }), el('em', { text: pct(nn.hit) })),
            el('div', {}, el('span', { text: 'Random baseline' }), el('i', { class: 'm base', style: `--w:${nn.baseline * 100}%` }), el('em', { text: pct(nn.baseline) }))),
          el('small', { text: `Share of each title's ${nn.k} nearest neighbours that share a genre with it, over ${nn.n} titles. ${nn.hit > nn.baseline ? `${(nn.hit / nn.baseline).toFixed(1)}× better than chance.` : 'Not better than chance here.'}` })));
      }
      rows.push(el('div', { class: 'rep-row col' }, el('b', { text: `Clusters: k = ${best.k}` }),
        el('small', { text: `Chosen by silhouette score (${best.sil.toFixed(2)}; 1 is perfect separation, 0 is overlapping). Tried k = 3…${Math.min(8, Math.floor(n / 4))}.` })));

      // taste model
      const y = entries.map((e) => saved.has(e.key));
      const nPos = y.filter(Boolean).length;
      if (nPos >= 3 && n - nPos >= 8) {
        const lo = leaveOnePositiveOutAuc(vectors, y);
        const model = trainLogReg(vectors, y);
        const picks = entries.map((e, i) => ({ e, p: model.score(vectors[i]) })).filter((x) => !saved.has(x.e.key)).sort((a, b) => b.p - a.p).slice(0, 5);
        rows.push(el('div', { class: 'rep-row col' }, el('b', { text: 'Your taste model' }),
          el('small', { text: `Logistic regression on ${nPos} saved titles. Leave-one-out AUC ${lo.toFixed(2)} (0.5 is guessing, 1 is perfect).` }),
          el('ol', { class: 'picks' }, ...picks.map(({ e, p }) => { const li = el('li', {}, el('span', { text: e.title }), el('em', { text: pct(p) })); li.addEventListener('click', () => onPick(e)); return li; }))));
      } else {
        rows.push(el('div', { class: 'rep-row col' }, el('b', { text: 'Your taste model' }), el('small', { text: `Save ${Math.max(0, 3 - nPos)} more title${nPos === 2 ? '' : 's'} (and keep a few unsaved) and a logistic-regression model will learn your taste and report its leave-one-out AUC here.` })));
      }
      reportBox.replaceChildren(...rows);
    } catch (err) {
      console.error(err);
      mapBox.replaceChildren(el('p', { class: 'in-wait', text: 'The taste map could not be built.' })); reportBox.replaceChildren();
    }
  })();
  return root;
}
