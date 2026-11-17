// Small DOM + storage helpers shared by the UI modules.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  n.append(...kids.filter((x) => x != null && x !== false));
  return n;
}

export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// Demo entries carry data: URIs for posters; real ones carry TMDB paths.
// TMDB serves several sizes. w500 keeps card posters sharp on retina screens; pass w185 for thumbnails, w780 for big ones.
export const posterSrc = (p, w = 'w500') => (!p ? '' : p.startsWith('data:') ? p : `https://image.tmdb.org/t/p/${w}${p}`);
export const backdropSrc = (p, w = 'w1280') => (!p ? '' : p.startsWith('data:') ? p : `https://image.tmdb.org/t/p/${w}${p}`);

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'release';

export const tmdbImg = (path, w = 'w500') => (!path ? '' : path.startsWith('data:') ? path : `https://image.tmdb.org/t/p/${w}${path}`);

// ---- poster colour: the dominant hue of a poster, as a dark, readable background tint ----------
const tintCache = new Map();
/** The tint if it's already been worked out (string, or null for none), else undefined. */
export const tintCached = (path) => (path ? tintCache.get(posterSrc(path, 'w92')) : null);
/** Resolves to a CSS colour (or null). Picks the most vivid hue family rather than averaging, so a
 *  blue/red/yellow poster gives one clean colour instead of mud. Lightness is clamped for contrast. */
export function posterTint(path) {
  if (!path) return Promise.resolve(null);
  const src = posterSrc(path, 'w92');
  if (tintCache.has(src)) return Promise.resolve(tintCache.get(src));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const N = 24, c = document.createElement('canvas'); c.width = c.height = N;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
          const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), s = mx - mn;
          if (mx < 0.15 || s < 0.12) continue; // ignore near-black and grey
          let h = s === 0 ? 0 : mx === r ? ((gg - b) / s) % 6 : mx === gg ? (b - r) / s + 2 : (r - gg) / s + 4;
          h = (h * 60 + 360) % 360;
          const bin = bins[Math.floor(h / 30) % 12], w = s * mx;
          bin.w += w; bin.r += d[i] * w; bin.g += d[i + 1] * w; bin.b += d[i + 2] * w;
        }
        const top = bins.reduce((a, b) => (b.w > a.w ? b : a));
        let out = null;
        if (top.w > 0.5) {
          const r = top.r / top.w / 255, gg = top.g / top.w / 255, b = top.b / top.w / 255;
          const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
          let h = mx === r ? ((gg - b) / (mx - mn)) % 6 : mx === gg ? (b - r) / (mx - mn) + 2 : (r - gg) / (mx - mn) + 4;
          h = Math.round((h * 60 + 360) % 360);
          out = `hsl(${h} ${Math.round(Math.min(0.75, Math.max(0.35, s)) * 100)}% 30%)`;
        }
        tintCache.set(src, out); resolve(out);
      } catch { resolve(null); } // tainted canvas: fall back to the theme colour
    };
    img.src = src;
  });
}
