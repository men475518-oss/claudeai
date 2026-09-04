// ---------------------------------------------------------------------------
// arena.js — ボス戦の舞台
//   紫がかった空、地平線に立ちならぶ黒い影、降りそそぐ短剣。
//   足場は暗い沼地で、上 1/4 は「向こう側」になっていて入れない。
// ---------------------------------------------------------------------------
import { TILE } from './config.js';
import { Level, T, O } from './world.js';
import { makeRng, hash2 } from './util.js';

export const ARENA_W = 18;
export const ARENA_H = 27;
export const HORIZON_ROW = 5;
export const FIELD_BOTTOM = 21;   // ここより下へは行けない（画面外に出ないように）                 // ここから下が足場
export const HORIZON_Y = HORIZON_ROW * TILE;

/** ボス部屋を作る。def: {id, name, seed, theme} */
export function generateArena(def) {
  const lv = new Level(ARENA_W, ARENA_H, 'arena');
  lv.id = def.id;
  lv.name = def.name;
  lv.music = 'boss';
  lv.dark = false;
  lv.ground.fill(T.VOID);

  const rng = makeRng(def.seed ^ 0x5EED);
  // 見た目の地面は下までびっしり。動ける範囲だけ見えない壁で囲う。
  for (let y = HORIZON_ROW; y < ARENA_H; y++)
    for (let x = 0; x < ARENA_W; x++) {
      lv.setG(x, y, T.SWAMP);
      const inField = x >= 1 && x <= ARENA_W - 2 && y >= HORIZON_ROW && y <= FIELD_BOTTOM;
      if (!inField) lv.setO(x, y, O.BOUND);
    }
  // 沼のよどみ（見た目だけ）
  for (let n = 0; n < 14; n++) {
    const x = rng.irange(2, ARENA_W - 3), y = rng.irange(HORIZON_ROW + 1, FIELD_BOTTOM - 1);
    if (lv.g(x, y) === T.SWAMP && rng() < 0.5) lv.setO(x, y, O.TUFT);
  }

  const spawn = { x: (ARENA_W >> 1), y: FIELD_BOTTOM - 3 };
  const relicPos = { x: (ARENA_W >> 1), y: HORIZON_ROW + 5 };
  return { level: lv, spawn, relicPos, horizonY: HORIZON_Y };
}

// --- 背景 -------------------------------------------------------------------

/** 地平線に立つ影たち。位置はシードから決めるので毎回おなじ。 */
function drawSilhouettes(ctx, seed, camx, camy, viewW, hy, t) {
  const par = 0.35;                            // 視差（遠いのでゆっくり動く）
  const ox = -camx * par;
  const oy = hy - camy;

  ctx.fillStyle = '#0b0d10';

  // 大きな主（左）— 前かがみの長い体と細い脚
  const bigX = 18 + ox;
  if (bigX > -120 && bigX < viewW + 120) {
    ctx.beginPath();
    ctx.moveTo(bigX - 20, oy);
    ctx.lineTo(bigX - 16, oy - 54);
    ctx.lineTo(bigX - 22, oy - 78);
    ctx.lineTo(bigX - 10, oy - 96);
    ctx.lineTo(bigX + 14, oy - 92);
    ctx.lineTo(bigX + 20, oy - 66);
    ctx.lineTo(bigX + 10, oy - 40);
    ctx.lineTo(bigX + 16, oy);
    ctx.closePath();
    ctx.fill();
    // ぼろぼろの裾
    for (let i = 0; i < 7; i++) {
      const fx = bigX - 20 + i * 5;
      ctx.fillRect(fx, oy - 4, 3, 4 + ((hash2(i, 3, seed) * 7) | 0));
    }
    // 赤い目
    ctx.fillStyle = '#c8332c';
    ctx.fillRect(bigX - 12, oy - 88, 3, 2);
    ctx.fillRect(bigX - 5, oy - 87, 2, 2);
    ctx.fillStyle = '#0b0d10';
  }

  // 首の長い機械じみた影
  const nx = 62 + ox;
  ctx.beginPath();
  ctx.moveTo(nx, oy);
  ctx.lineTo(nx + 2, oy - 30);
  ctx.quadraticCurveTo(nx + 4, oy - 52, nx + 20, oy - 54);
  ctx.lineTo(nx + 22, oy - 48);
  ctx.quadraticCurveTo(nx + 10, oy - 46, nx + 8, oy - 28);
  ctx.lineTo(nx + 7, oy);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(nx + 17, oy - 58, 12, 8);
  ctx.fillStyle = '#c8332c';
  ctx.fillRect(nx + 26, oy - 55, 3, 2);
  ctx.fillStyle = '#0b0d10';

  // 細い人影がずらりと（手を上げているものも）
  for (let i = 0; i < 22; i++) {
    const sx = ((i * 37 + ((hash2(i, 1, seed) * 22) | 0)) % 300) + ox;
    if (sx < -14 || sx > viewW + 14) continue;
    const h = 14 + ((hash2(i, 2, seed) * 22) | 0);
    const sway = Math.sin(t * 0.6 + i) * 0.8;
    ctx.fillRect(sx + sway, oy - h, 3, h);
    ctx.fillRect(sx - 1 + sway, oy - h - 4, 5, 5);            // 頭
    if (hash2(i, 4, seed) < 0.35) {                            // 上げた腕
      ctx.fillRect(sx - 3 + sway, oy - h - 10, 2, 8);
      ctx.fillRect(sx + 4 + sway, oy - h - 12, 2, 10);
    }
  }

  // 右手前の 傾いた尖塔
  const tx = 300 + ox;
  ctx.beginPath();
  ctx.moveTo(tx, oy + 4);
  ctx.lineTo(tx + 34, oy - 96);
  ctx.lineTo(tx + 46, oy - 92);
  ctx.lineTo(tx + 20, oy + 4);
  ctx.closePath();
  ctx.fill();
}

/** 空から降りつづける短剣（背景の飾り） */
function drawFallingDaggers(ctx, seed, camx, camy, viewW, hy, t) {
  const par = 0.6;
  const ox = -camx * par, oy = -camy * par;
  const bandH = hy + 40;
  ctx.fillStyle = '#15151c';
  for (let i = 0; i < 34; i++) {
    const baseX = (hash2(i, 7, seed) * 340) | 0;
    const speed = 10 + hash2(i, 8, seed) * 16;
    const phase = hash2(i, 9, seed) * 400;
    const x = ((baseX + ox) % 340 + 340) % 340 - 20;
    const y = ((t * speed + phase) % (bandH + 120)) - 60 + oy * 0.2;
    if (x < -12 || x > viewW + 12 || y > bandH) continue;
    const s = 0.7 + hash2(i, 10, seed) * 0.8;
    dagger(ctx, x, y, s);
  }
}

function dagger(ctx, x, y, s) {
  const bl = Math.round(14 * s), bw = Math.max(1, Math.round(2 * s));
  ctx.fillRect(x, y, bw, bl);                       // 刃
  ctx.fillRect(x - Math.round(2 * s), y - Math.round(3 * s), bw + Math.round(4 * s), Math.max(1, Math.round(1.6 * s))); // つば
  ctx.fillRect(x, y - Math.round(7 * s), bw, Math.round(4 * s));   // 柄
  ctx.fillRect(x - 1, y + bl, bw + 2, 1);           // 切っ先
}

/** ボス戦の舞台まるごと。地面を描く前に呼ぶ。 */
export function drawArenaBackdrop(ctx, g, camx, camy, viewW, viewH, t) {
  const hy = HORIZON_Y - camy;

  // 空
  const grd = ctx.createLinearGradient(0, 0, 0, Math.max(1, hy));
  grd.addColorStop(0, '#4a4358');
  grd.addColorStop(1, '#565068');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, viewW, Math.max(0, hy));

  // 地平線の向こうの暗がり
  ctx.fillStyle = '#16211f';
  ctx.fillRect(0, Math.max(0, hy - 1), viewW, viewH - hy + 1);

  const seed = g.arenaSeed || 1234;
  drawFallingDaggers(ctx, seed, camx, camy, viewW, hy, t);
  drawSilhouettes(ctx, seed, camx, camy, viewW, HORIZON_Y - camy, t);

  // 地平線のもや
  const fog = ctx.createLinearGradient(0, hy - 14, 0, hy + 10);
  fog.addColorStop(0, 'rgba(70,66,86,0)');
  fog.addColorStop(0.6, 'rgba(46,52,58,0.55)');
  fog.addColorStop(1, 'rgba(22,33,31,0.9)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, hy - 14, viewW, 24);
}
