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

    } else if (h.kind === 'puddle') {
      // なきぼうの おとしもの。しばらく残って、ふむと 痛い
      if (h.t >= h.warn) {
        h.hurtCd = (h.hurtCd || 0) - dt;
        if (dist(p.x, p.y, h.x, h.y) < h.r && h.hurtCd <= 0) {
          h.hurtCd = 0.7;
          p.hurt(g, h.dmg, h.x, h.y);
        }
      }
      if (h.t > h.life) h.done = true;

    } else if (h.kind === 'beam') {
      // にらみ。目からの光が 地面をなめるように 動く
      const total = h.warn + h.sweep;
      if (h.t >= h.warn) {
        const k = clamp((h.t - h.warn) / h.sweep, 0, 1);
        h.cx = h.x0 + (h.x1 - h.x0) * k;
        h.cy = h.y0 + (h.y1 - h.y0) * k;
        if (!h.armed) { h.armed = true; sfx('magic'); FX.shake(3, 0.3); }
        h.hurtCd = (h.hurtCd || 0) - dt;
        if (dist(p.x, p.y, h.cx, h.cy) < h.r && h.hurtCd <= 0) {
          h.hurtCd = 0.45;
          p.hurt(g, h.dmg, h.cx, h.cy);
        }
        if (Math.random() < 0.7) FX.burst(h.cx, h.cy, 1, ['#ffd9a8', '#ff8f6b'], { spMax: 40, life: 0.3 });
      }
      if (h.t > total + 0.2) h.done = true;

    } else if (h.kind === 'spike') {
      // 地面から せりあがる とげ
      if (!h.hit && h.t >= h.warn) {
        h.hit = true;
        sfx('hitHard'); FX.shake(3, 0.2);
        FX.burst(h.x, h.y, 8, ['#8b8b97', '#5c5c68', '#453a51'], { spMax: 70 });
        if (dist(p.x, p.y, h.x, h.y) < h.r) p.hurt(g, h.dmg, h.x, h.y);
      }
      if (h.t > h.warn + 1.4) h.done = true;

    } else if (h.kind === 'wave') {
      // ひろがる うなり。輪の上だけが 痛い
      const k = clamp(h.t / h.dur, 0, 1);
      h.cur = h.r0 + (h.r1 - h.r0) * k;
      if (!h.armed) { h.armed = true; sfx('boss'); }
      h.hurtCd = (h.hurtCd || 0) - dt;
      const dd = Math.abs(dist(p.x, p.y, h.x, h.y) - h.cur);
      if (dd < h.band && h.hurtCd <= 0) {
        h.hurtCd = 0.6;
        p.hurt(g, h.dmg, h.x, h.y);
      }
      if (h.t > h.dur) h.done = true;

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
    } else if (h.kind === 'puddle') {
      const k = clamp(h.t / h.warn, 0, 1);
      const fade = clamp((h.life - h.t) / 0.9, 0, 1);
      ctx.globalAlpha = 0.55 * fade;
      ctx.fillStyle = '#2f5580';
      ctx.beginPath();
      ctx.ellipse(Math.round(h.x), Math.round(h.y), h.r * k, h.r * 0.5 * k, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.7 * fade;
      ctx.strokeStyle = '#7fb8d4';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(Math.round(h.x), Math.round(h.y), h.r * k, h.r * 0.5 * k, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;

    } else if (h.kind === 'beam') {
      if (h.t < h.warn) {
        // ねらいの線
        const k = clamp(h.t / h.warn, 0, 1);
        ctx.globalAlpha = 0.35 + 0.35 * k;
        ctx.strokeStyle = Math.floor(h.t * 16) % 2 === 0 ? '#ffb08c' : '#d65c4e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(h.x0), Math.round(h.y0));
        ctx.lineTo(Math.round(h.x1), Math.round(h.y1));
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(Math.round(h.x0), Math.round(h.y0), h.r * k, h.r * 0.45 * k, 0, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        // こげあと
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#3a2b28';
        ctx.beginPath();
        ctx.ellipse(Math.round(h.cx), Math.round(h.cy), h.r, h.r * 0.45, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

    } else if (h.kind === 'spike' && !h.hit) {
      const k = clamp(h.t / h.warn, 0, 1);
      ctx.globalAlpha = 0.25 + 0.3 * k;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(Math.round(h.x), Math.round(h.y), h.r * k, h.r * 0.45 * k, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = k > 0.7 && Math.floor(h.t * 18) % 2 === 0 ? '#ffb08c' : '#d65c4e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(Math.round(h.x), Math.round(h.y), h.r, h.r * 0.45, 0, 0, TAU);
      ctx.stroke();

    } else if (h.kind === 'wave') {
      const fade = clamp(1 - h.t / h.dur, 0, 1);
      ctx.globalAlpha = 0.25 + 0.45 * fade;
      ctx.strokeStyle = '#cfe6d8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(Math.round(h.x), Math.round(h.y), h.cur || h.r0, (h.cur || h.r0) * 0.6, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.55 * fade;
      ctx.strokeStyle = '#8f86a8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(Math.round(h.x), Math.round(h.y), (h.cur || h.r0) + 3, ((h.cur || h.r0) + 3) * 0.6, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;

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
    } else if (h.kind === 'beam' && h.t >= h.warn) {
      // 目から地面へ のびる光の柱
      const w = 3 + Math.sin(h.t * 40) * 1.2;
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#ffd9a8';
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(Math.round(h.ex), Math.round(h.ey));
      ctx.lineTo(Math.round(h.cx), Math.round(h.cy));
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#ff8f6b';
      ctx.lineWidth = w + 3;
      ctx.beginPath();
      ctx.moveTo(Math.round(h.ex), Math.round(h.ey));
      ctx.lineTo(Math.round(h.cx), Math.round(h.cy));
      ctx.stroke();
      ctx.globalAlpha = 1;

    } else if (h.kind === 'spike' && h.hit) {
      // せりあがった とげ（しばらく残る）
      const k = clamp((h.t - h.warn) / 0.18, 0, 1);
      const a = clamp(1 - (h.t - h.warn - 0.9) / 0.5, 0, 1);
      const hgt = 18 * k;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#453a51';
      ctx.beginPath();
      ctx.moveTo(Math.round(h.x) - 5, Math.round(h.y));
      ctx.lineTo(Math.round(h.x), Math.round(h.y) - hgt);
      ctx.lineTo(Math.round(h.x) + 5, Math.round(h.y));
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#8b8b97';
      ctx.beginPath();
      ctx.moveTo(Math.round(h.x) - 2, Math.round(h.y));
      ctx.lineTo(Math.round(h.x), Math.round(h.y) - hgt);
      ctx.lineTo(Math.round(h.x) + 1, Math.round(h.y));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

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
