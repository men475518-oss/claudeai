// ---------------------------------------------------------------------------
// fx.js — パーティクル・ダメージ表示・画面ゆれ・ヒットストップ
// ---------------------------------------------------------------------------
import { makeRng, clamp, TAU } from './util.js';
import { PAL } from './art.js';

const rng = makeRng(0xC0FFEE);

export const fx = {
  parts: [],
  texts: [],
  rings: [],
  shake: 0,
  shakeT: 0,
  hitstop: 0,
  flash: 0,
  flashColor: '#ffffff',
};

export function clearFx() {
  fx.parts.length = 0; fx.texts.length = 0; fx.rings.length = 0;
  fx.shake = 0; fx.hitstop = 0; fx.flash = 0;
}

export function shake(amount, dur = 0.22) {
  fx.shake = Math.max(fx.shake, amount);
  fx.shakeT = Math.max(fx.shakeT, dur);
}
export function hitstop(t) { fx.hitstop = Math.max(fx.hitstop, t); }
export function flash(color = '#ffffff', amount = 0.6) { fx.flash = amount; fx.flashColor = color; }

export function particle(x, y, opts = {}) {
  fx.parts.push({
    x, y,
    vx: opts.vx ?? rng.range(-30, 30),
    vy: opts.vy ?? rng.range(-30, 30),
    vz: opts.vz ?? 0,
    z: opts.z ?? 0,
    g: opts.g ?? 0,
    life: opts.life ?? 0.5,
    max: opts.life ?? 0.5,
    size: opts.size ?? 1,
    color: opts.color ?? '#ffffff',
    fade: opts.fade ?? true,
    drag: opts.drag ?? 0.9,
    shrink: opts.shrink ?? true,
  });
}

export function burst(x, y, n, color, opts = {}) {
  for (let i = 0; i < n; i++) {
    const a = rng.angle();
    const sp = rng.range(opts.spMin ?? 22, opts.spMax ?? 70);
    particle(x, y, {
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7,
      life: rng.range(0.22, opts.life ?? 0.5),
      size: opts.size ?? (rng() < 0.4 ? 2 : 1),
      color: Array.isArray(color) ? rng.pick(color) : color,
      g: opts.g ?? 0, vz: opts.vz ?? 0, drag: opts.drag ?? 0.86,
    });
  }
}

export function dust(x, y, n = 3) {
  for (let i = 0; i < n; i++)
    particle(x + rng.range(-3, 3), y, {
      vx: rng.range(-10, 10), vy: rng.range(-4, 2), life: rng.range(0.2, 0.4),
      color: rng() < 0.5 ? PAL['3'] : PAL['2'], size: 1, drag: 0.8,
    });
}

export function ring(x, y, opts = {}) {
  fx.rings.push({
    x, y, r: opts.r0 ?? 2, r1: opts.r1 ?? 18,
    life: opts.life ?? 0.3, max: opts.life ?? 0.3,
    color: opts.color ?? '#ffffff', width: opts.width ?? 1,
  });
}

export function floatText(x, y, text, color = '#ffffff', opts = {}) {
  fx.texts.push({
    x, y, text, color,
    life: opts.life ?? 0.8, max: opts.life ?? 0.8,
    vy: opts.vy ?? -22, size: opts.size ?? 8, outline: opts.outline ?? true,
  });
}

export function updateFx(dt) {
  if (fx.hitstop > 0) fx.hitstop = Math.max(0, fx.hitstop - dt);
  if (fx.shakeT > 0) {
    fx.shakeT -= dt;
    if (fx.shakeT <= 0) { fx.shake = 0; fx.shakeT = 0; }
  }
  fx.shake *= Math.pow(0.02, dt);
  fx.flash = Math.max(0, fx.flash - dt * 2.6);

  for (let i = fx.parts.length - 1; i >= 0; i--) {
    const p = fx.parts[i];
    p.life -= dt;
    if (p.life <= 0) { fx.parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.vz || p.z) { p.z += p.vz * dt; p.vz -= p.g * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.4; } }
    else p.vy += p.g * dt;
    const d = Math.pow(p.drag, dt * 60);
    p.vx *= d; p.vy *= d;
  }
  for (let i = fx.texts.length - 1; i >= 0; i--) {
    const t = fx.texts[i];
    t.life -= dt;
    if (t.life <= 0) { fx.texts.splice(i, 1); continue; }
    t.y += t.vy * dt;
    t.vy *= Math.pow(0.9, dt * 60);
  }
  for (let i = fx.rings.length - 1; i >= 0; i--) {
    const r = fx.rings[i];
    r.life -= dt;
    if (r.life <= 0) { fx.rings.splice(i, 1); continue; }
    const t = 1 - r.life / r.max;
    r.r = r.r + (r.r1 - r.r) * (1 - Math.pow(1 - t, 3)) * dt * 8;
  }
}

/** 画面ゆれのオフセット */
export function shakeOffset() {
  if (fx.shake < 0.15) return [0, 0];
  const a = rng.angle();
  return [Math.cos(a) * fx.shake, Math.sin(a) * fx.shake];
}

export function drawParticles(ctx) {
  for (const p of fx.parts) {
    const t = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = p.fade ? (t > 0.6 ? 1 : t / 0.6) : 1;
    ctx.fillStyle = p.color;
    const s = p.shrink ? Math.max(1, Math.round(p.size * (0.4 + t * 0.6))) : p.size;
    ctx.fillRect(Math.round(p.x), Math.round(p.y - (p.z || 0)), s, s);
  }
  ctx.globalAlpha = 1;
  for (const r of fx.rings) {
    const t = clamp(r.life / r.max, 0, 1);
    ctx.globalAlpha = t;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width;
    ctx.beginPath();
    ctx.arc(r.x, r.y, Math.max(1, r.r), 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
