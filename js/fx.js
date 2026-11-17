// Seasonal animation layer: one full-screen, click-through canvas.
//   christmas  falling snow (drift + gusts), a sleigh crossing the sky now and then
//   halloween  bats flapping across the screen, rising embers, drifting fog
//   easter     falling pastel petals, a bunny hopping along the bottom
// Everything floats BEHIND the page content (the canvas sits under it), slowly.
// Cheap on purpose: a capped particle count, a capped pixel ratio, paused when the tab is hidden,
// and a single still frame (no motion) when the viewer prefers reduced motion.
import { reduced, store } from './ui.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const KEY = 'rr:fx';

export function createFx() {
  let canvas = null, ctx = null, raf = 0, last = 0, kind = '', parts = [], actors = [], w = 0, h = 0, dpr = 1, t = 0, wind = 0;
  let enabled = store.get(KEY, true) !== false && !new URLSearchParams(location.search).has('nofx');
  let nextActor = 0;
  const small = () => matchMedia('(max-width: 720px)').matches;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'fx'; canvas.className = 'fx'; canvas.setAttribute('aria-hidden', 'true');
    document.body.append(canvas);
    ctx = canvas.getContext('2d');
    addEventListener('resize', size);
    document.addEventListener('visibilitychange', () => { if (document.hidden) halt(); else if (kind && enabled) go(); });
  }
  function size() {
    if (!canvas) return;
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    w = innerWidth; h = innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  // ---- particles -------------------------------------------------------------------------------
  function seed() {
    const scale = small() ? 0.55 : 1;
    parts = []; actors = []; nextActor = t + (kind === 'halloween' ? rand(1, 3) : rand(2, 6));
    if (kind === 'christmas') {
      const n = Math.round(Math.min(420, Math.max(160, (w * h) / 4200)) * scale);
      for (let i = 0; i < n; i++) { const r = 0.7 + Math.random() ** 2 * 2.8; parts.push({ x: rand(0, w), y: rand(0, h), r, vy: 8 + r * 7, ph: rand(0, 6.28), sw: rand(5, 16), fr: rand(0.15, 0.6), a: rand(0.35, 0.8) }); }
    } else if (kind === 'halloween') {
      const n = Math.round(70 * scale);
      for (let i = 0; i < n; i++) parts.push({ x: rand(0, w), y: rand(0, h), r: rand(1.2, 3.4), vy: -rand(7, 22), ph: rand(0, 6.28), sw: rand(4, 14), fr: rand(0.3, 0.9), hue: pick([24, 30, 38]) });
    } else if (kind === 'easter') {
      const n = Math.round(70 * scale);
      const cols = ['#ff9ccf', '#7ad6b8', '#ffd86b', '#c7a6ff', '#ffb38a'];
      for (let i = 0; i < n; i++) parts.push({ x: rand(0, w), y: rand(0, h), rx: rand(2.5, 5), ry: rand(5, 9), vy: rand(11, 28), ph: rand(0, 6.28), sw: rand(6, 20), fr: rand(0.25, 0.7), rot: rand(0, 6.28), vr: rand(-0.7, 0.7), c: pick(cols), a: rand(0.45, 0.8) });
    }
  }

  function spawnActor() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (kind === 'christmas') actors.push({ k: 'sleigh', e: '🛷', x: dir > 0 ? -60 : w + 60, y: rand(h * 0.08, h * 0.22), vx: dir * rand(32, 50), size: small() ? 26 : 34, dir, amp: rand(6, 14) });
    else if (kind === 'halloween') {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) actors.push({ k: 'bat', e: '🦇', x: (dir > 0 ? -40 : w + 40) - dir * i * rand(30, 70), y: rand(h * 0.1, h * 0.6), vx: dir * rand(70, 120), size: rand(20, 34), dir, amp: rand(14, 36), ph: rand(0, 6.28), fl: rand(11, 17) });
    } else if (kind === 'easter') actors.push({ k: 'bunny', e: '🐇', x: dir > 0 ? -50 : w + 50, y: h - (small() ? 96 : 40), vx: dir * rand(45, 70), size: small() ? 30 : 38, dir, hop: rand(4.2, 5.6) });
  }

  // ---- drawing -----------------------------------------------------------------------------------
  function drawSnow(dt) {
    wind = Math.sin(t * 0.11) * 8 + Math.sin(t * 0.29) * 4; // slow gusts
    ctx.fillStyle = '#fff';
    for (const p of parts) {
      p.y += p.vy * dt; p.x += (Math.sin(t * p.fr + p.ph) * p.sw * 0.6 + wind) * dt;
      if (p.y > h + 8) { p.y = -8; p.x = rand(0, w); }
      if (p.x > w + 8) p.x = -8; else if (p.x < -8) p.x = w + 8;
      ctx.globalAlpha = p.a;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawFog() {
    for (let i = 0; i < 2; i++) {
      const cx = ((t * (14 + i * 9) + i * w * 0.6) % (w + 600)) - 300, cy = h - 60 - i * 40, r = 360 + i * 120;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, i ? 'rgba(138,92,214,.13)' : 'rgba(255,160,70,.10)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  function drawEmbers(dt) {
    for (const p of parts) {
      p.y += p.vy * dt; p.x += Math.sin(t * p.fr + p.ph) * p.sw * dt;
      if (p.y < -6) { p.y = h + 6; p.x = rand(0, w); }
      const flick = 0.45 + 0.55 * Math.abs(Math.sin(t * 3 * p.fr + p.ph));
      ctx.fillStyle = `hsla(${p.hue}, 100%, 60%, ${0.75 * flick})`;
      ctx.shadowColor = 'rgba(255,140,30,.9)'; ctx.shadowBlur = 6; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); ctx.shadowBlur = 0;
    }
  }
  function drawPetals(dt) {
    for (const p of parts) {
      p.y += p.vy * dt; p.x += Math.sin(t * p.fr + p.ph) * p.sw * dt; p.rot += p.vr * dt;
      if (p.y > h + 12) { p.y = -12; p.x = rand(0, w); }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = p.a; ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, 6.283); ctx.fill(); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function drawActors(dt) {
    for (let i = actors.length - 1; i >= 0; i--) {
      const a = actors[i];
      a.x += a.vx * dt;
      let y = a.y, sx = a.dir > 0 ? -1 : 1, sy = 1;            // emoji face left by default
      if (a.k === 'bat') { y += Math.sin(t * 2.2 + a.ph) * a.amp; sy = 0.55 + 0.45 * Math.abs(Math.sin(t * a.fl + a.ph)); sx = 1; }
      else if (a.k === 'sleigh') y += Math.sin(t * 0.9) * a.amp;
      else if (a.k === 'bunny') y -= Math.abs(Math.sin(t * a.hop + i)) * 30;
      ctx.save(); ctx.translate(a.x, y); ctx.scale(sx, sy); ctx.font = `${a.size}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 0.85;
      ctx.fillText(a.e, 0, 0); ctx.restore();
      if (a.x < -120 || a.x > w + 120) actors.splice(i, 1);
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now; t += dt;
    ctx.clearRect(0, 0, w, h);
    if (kind === 'christmas') drawSnow(dt);
    else if (kind === 'halloween') { drawFog(); drawEmbers(dt); }
    else if (kind === 'easter') drawPetals(dt);
    if (t >= nextActor && actors.length < 4) { spawnActor(); nextActor = t + (kind === 'christmas' ? rand(26, 45) : kind === 'halloween' ? rand(7, 15) : rand(12, 22)); }
    drawActors(dt);
  }

  function still() { // reduced motion: one calm frame, no movement
    ctx.clearRect(0, 0, w, h);
    if (kind === 'christmas') drawSnow(0); else if (kind === 'halloween') { drawFog(); drawEmbers(0); } else if (kind === 'easter') drawPetals(0);
  }

  function go() { if (raf || !canvas) return; last = 0; if (reduced) { still(); return; } raf = requestAnimationFrame(frame); }
  function halt() { cancelAnimationFrame(raf); raf = 0; }

  let current = ''; // the selected season, even while animations are switched off
  return {
    /** Start the effect for a season id ('' = none). */
    set(id) {
      current = id || '';
      kind = enabled ? current : '';
      halt();
      if (!kind) { canvas?.classList.remove('on'); ctx?.clearRect(0, 0, w, h); return; }
      ensureCanvas(); size(); canvas.classList.add('on'); go();
    },
    get enabled() { return enabled; },
    /** Turn animations on or off (remembered). Returns the new state. */
    toggle() { enabled = !enabled; store.set(KEY, enabled); this.set(current); return enabled; },
  };
}
