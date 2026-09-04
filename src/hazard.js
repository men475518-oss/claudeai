// ---------------------------------------------------------------------------
// hazard.js — 地面に降ってくる危険（短剣の雨・腕のなぎ払い）
//   どれも「予告 → 発生 → 余韻」の三段。予告のあいだに逃げるのが遊び。
// ---------------------------------------------------------------------------
import { clamp, dist, TAU } from './util.js';
import * as FX from './fx.js';
import { sfx } from './audio.js';

export function updateHazards(dt, g) {
  const p = g.player;
  for (const h of g.hazards) {
    h.t += dt;
    if (h.t < 0) continue;

    if (h.kind === 'dagger') {
      if (!h.hit && h.t >= h.warn) {
        h.hit = true;
        sfx('hit');
        FX.shake(2, 0.12);
        FX.burst(h.x, h.y, 8, ['#cfd6e0', '#8b8b97', '#3e6b52'], { spMax: 70 });
        if (dist(p.x, p.y, h.x, h.y) < h.r) p.hurt(g, h.dmg, h.x, h.y - 20);
      }
      if (h.t > h.warn + 1.1) h.done = true;

    } else if (h.kind === 'sweep') {
      const total = h.warn + h.sweep;
      if (h.t >= h.warn) {
        const k = clamp((h.t - h.warn) / h.sweep, 0, 1);
        const w = g.level.w * 16;
        h.cur = h.dir > 0 ? -30 + k * (w + 60) : w + 30 - k * (w + 60);
        if (!h.armed) { h.armed = true; sfx('swingBig'); FX.shake(4, 0.3); }
        if (Math.abs(p.y - h.y) < h.h && Math.abs(p.x - h.cur) < 26) {
          p.hurt(g, h.dmg, h.cur, h.y);
        }
        if (Math.random() < 0.6) FX.dust(h.cur, h.y + 6, 1);
      }
      if (h.t > total + 0.2) h.done = true;

    } else if (h.kind === 'quake') {
      if (!h.hit && h.t >= h.warn) {
        h.hit = true;
        sfx('bomb'); FX.shake(8, 0.5);
        FX.ring(h.x, h.y, { r0: 4, r1: h.r * 1.4, life: 0.4, color: '#cfe6d8', width: 2 });
        if (dist(p.x, p.y, h.x, h.y) < h.r) p.hurt(g, h.dmg, h.x, h.y);
      }
      if (h.t > h.warn + 0.6) h.done = true;
    }
  }
  for (let i = g.hazards.length - 1; i >= 0; i--) if (g.hazards[i].done) g.hazards.splice(i, 1);
}

/** 地面より上・エンティティより下に描くもの（予告のしるし） */
export function drawHazardsUnder(ctx, g) {
  for (const h of g.hazards) {
    if (h.t < 0) continue;
    if (h.kind === 'dagger' && !h.hit) {
      const k = clamp(h.t / h.warn, 0, 1);
      ctx.globalAlpha = 0.30 + 0.30 * k;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(Math.round(h.x), Math.round(h.y), h.r * (0.35 + 0.65 * k), h.r * 0.45 * (0.35 + 0.65 * k), 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = k > 0.7 && Math.floor(h.t * 18) % 2 === 0 ? '#ffb08c' : '#d65c4e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(Math.round(h.x), Math.round(h.y), h.r, h.r * 0.45, 0, 0, TAU);
      ctx.stroke();
    } else if (h.kind === 'sweep' && h.t < h.warn) {
      const k = clamp(h.t / h.warn, 0, 1);
      ctx.globalAlpha = 0.18 + 0.22 * k;
      ctx.fillStyle = '#d65c4e';
      ctx.fillRect(0, Math.round(h.y - h.h), g.level.w * 16, h.h * 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = Math.floor(h.t * 16) % 2 === 0 ? '#ffb08c' : '#d65c4e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(h.y - h.h) + 0.5); ctx.lineTo(g.level.w * 16, Math.round(h.y - h.h) + 0.5);
      ctx.moveTo(0, Math.round(h.y + h.h) - 0.5); ctx.lineTo(g.level.w * 16, Math.round(h.y + h.h) - 0.5);
      ctx.stroke();
    } else if (h.kind === 'quake' && !h.hit) {
      const k = clamp(h.t / h.warn, 0, 1);
      ctx.strokeStyle = '#d65c4e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(Math.round(h.x), Math.round(h.y), h.r * k, 0, TAU);
      ctx.stroke();
    }
  }
}

/** エンティティより上に描くもの（落ちてくる剣・振り抜かれる腕） */
export function drawHazardsOver(ctx, g) {
  for (const h of g.hazards) {
    if (h.t < 0) continue;
    if (h.kind === 'dagger') {
      if (!h.hit) {
        // 空から降ってくる短剣
        const k = clamp(h.t / h.warn, 0, 1);
        const y = h.y - (1 - k) * 150;
        ctx.fillStyle = '#c9cfd8';
        ctx.fillRect(Math.round(h.x) - 1, Math.round(y) - 14, 2, 14);
        ctx.fillStyle = '#8b8b97';
        ctx.fillRect(Math.round(h.x) - 4, Math.round(y) - 18, 8, 2);
        ctx.fillStyle = '#6f4b2f';
        ctx.fillRect(Math.round(h.x) - 1, Math.round(y) - 24, 2, 6);
      } else {
        // 刺さったまま しばらく残る
        const a = clamp(1 - (h.t - h.warn) / 1.1, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#c9cfd8';
        ctx.fillRect(Math.round(h.x) - 1, Math.round(h.y) - 9, 2, 9);
        ctx.fillStyle = '#8b8b97';
        ctx.fillRect(Math.round(h.x) - 4, Math.round(h.y) - 13, 8, 2);
        ctx.globalAlpha = 1;
      }
    } else if (h.kind === 'sweep' && h.t >= h.warn) {
      const x = Math.round(h.cur);
      ctx.fillStyle = '#2d2635';
      ctx.beginPath();
      ctx.ellipse(x, Math.round(h.y), 26, h.h, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#1a1622';
      ctx.beginPath();
      ctx.ellipse(x - h.dir * 8, Math.round(h.y), 18, h.h * 0.7, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#8f86a8';
      ctx.fillRect(x - h.dir * 70, Math.round(h.y - h.h * 0.5), 70, h.h);
      ctx.globalAlpha = 1;
    }
  }
}
