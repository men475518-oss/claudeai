// ---------------------------------------------------------------------------
// render.js — カメラ・タイル描画・奥行きソート・ダンジョンの明かり
// ---------------------------------------------------------------------------
import { TILE, VIEW_W, VIEW_H_MIN, VIEW_H_MAX } from './config.js';
import { clamp, hash2, lerp, TAU } from './util.js';
import { SPR, TERRAIN_TILES, EDGE, PAL, makeCanvas } from './art.js';
import { T, O, TERRAIN_NAME, TERRAIN_PRIO, OBJ_DEF } from './world.js';
import * as FX from './fx.js';
import { drawArenaBackdrop } from './arena.js';
import { drawHazardsUnder, drawHazardsOver } from './hazard.js';

export const view = {
  w: VIEW_W, h: 300,          // 論理解像度
  scale: 2,                   // 表示倍率
  ox: 0, oy: 0,               // ゲーム領域の左上（ウィンドウ内の CSS px）
  cssW: 0, cssH: 0,           // ゲーム領域の大きさ（CSS px）＝ UI の座標系
  winW: 0, winH: 0,           // ウィンドウ全体
  dpr: 1,
};

export const cam = { x: 0, y: 0, tx: 0, ty: 0 };

let screen = null, sctx = null;      // 表示用（デバイス解像度）
let world = null, wctx = null;       // ゲーム画面（論理解像度）
let light = null, lctx = null;       // 明かり用

export function initRender(canvas) {
  screen = canvas;
  sctx = canvas.getContext('2d', { alpha: false });
  sctx.imageSmoothingEnabled = false;
  return { screen, sctx };
}

export function getCtx() { return { sctx, wctx, screen, world }; }

export function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const winW = window.innerWidth, winH = window.innerHeight;
  view.winW = winW; view.winH = winH; view.dpr = dpr;

  screen.style.width = winW + 'px';
  screen.style.height = winH + 'px';
  screen.width = Math.round(winW * dpr);
  screen.height = Math.round(winH * dpr);
  sctx.imageSmoothingEnabled = false;

  // 論理解像度：横幅は固定。縦は端末比率に合わせるが、
  // 横長画面では縦がはみ出さないよう倍率のほうを下げる（左右に黒帯）。
  const scale = Math.min(winW / VIEW_W, winH / VIEW_H_MIN);
  view.w = VIEW_W;
  view.h = Math.round(clamp(winH / scale, VIEW_H_MIN, VIEW_H_MAX));
  view.scale = scale;
  view.cssW = view.w * scale;
  view.cssH = view.h * scale;
  view.ox = Math.round((winW - view.cssW) / 2);
  view.oy = Math.round((winH - view.cssH) / 2);

  if (!world || world.width !== view.w || world.height !== view.h) {
    world = makeCanvas(view.w, view.h);
    wctx = world.getContext('2d');
    wctx.imageSmoothingEnabled = false;
    light = makeCanvas(view.w, view.h);
    lctx = light.getContext('2d');
  }
}

/** 論理座標 → ゲーム領域内の CSS px */
export function toScreen(x, y) {
  return { x: x * view.scale, y: y * view.scale };
}
/** ゲーム領域内の CSS px → 論理座標 */
export function toWorldPx(x, y) {
  return { x: x / view.scale, y: y / view.scale };
}

/** UI 描画用の座標系（ゲーム領域の左上が原点）に切り替える */
export function beginUi() {
  sctx.setTransform(view.dpr, 0, 0, view.dpr, view.ox * view.dpr, view.oy * view.dpr);
  return sctx;
}
export function endUi() { sctx.setTransform(1, 0, 0, 1, 0, 0); }

export function snapCamera(target, level) {
  cam.tx = target.x; cam.ty = target.y;
  cam.x = target.x; cam.y = target.y;
  clampCam(level);
}

function clampCam(level) {
  const halfW = view.w / 2, halfH = view.h / 2;
  const lw = level.w * TILE, lh = level.h * TILE;
  cam.x = lw <= view.w ? lw / 2 : clamp(cam.x, halfW, lw - halfW);
  cam.y = lh <= view.h ? lh / 2 : clamp(cam.y, halfH, lh - halfH);
}

export function updateCamera(dt, target, level, lookAhead = 0) {
  cam.tx = target.x;
  // ボス戦は上（地平線とボスの顔）を見せたいので、少し上に構える
  cam.ty = target.y - (level.kind === 'arena' ? view.h * 0.22 : 6);
  const k = 1 - Math.pow(0.0006, dt);
  cam.x = lerp(cam.x, cam.tx, k);
  cam.y = lerp(cam.y, cam.ty, k);
  clampCam(level);
  if (level.kind === 'arena') {
    // どんなに小さい画面でも ボスの顔が切れないところで止める
    cam.y = Math.min(cam.y, ARENA_CAM_TOP + view.h / 2);
  }
}

/** アリーナでカメラが写す最上端（ボスの頭より少し上）*/
const ARENA_CAM_TOP = 8;

// ---------------------------------------------------------------------------

function groundVariant(x, y) { return (hash2(x, y, 4711) * 4) | 0; }

/** 同じ木がならばないよう、位置ハッシュで見た目を散らす */
const VARIANTS = {
  [O.TREE]: ['tree', 'tree2', 'tree3'],
  [O.PINE]: ['pine', 'pine2'],
  [O.BUSH]: ['bush', 'bush2'],
};
/** 一部のものは 2 倍で描いて 存在感を出す */
const OBJ_SCALE = { [O.VENDING]: 2, [O.SHRINE]: 1.5, [O.CAVE]: 1.5 };
function drawObjSprite(ctx, id, x, y, px, py) {
  const spr = objSprite(id, x, y);
  const sc = OBJ_SCALE[id] || 1;
  if (sc === 1) { ctx.drawImage(spr, px, py); return; }
  const w = spr.width * sc, h = spr.height * sc;
  ctx.drawImage(spr, Math.round(px + TILE / 2 - w / 2), Math.round(py + TILE - h), w, h);
}

function objSprite(id, x, y) {
  const list = VARIANTS[id];
  if (!list) return SPR[OBJ_DEF[id].spr];
  return SPR[list[(hash2(x, y, 1237) * list.length) | 0]];
}

let waterFrame = 0;
export function setTime(t) { waterFrame = Math.floor(t * 3.2) % 4; }

/** 装飾（花・草むら）を直接描く */
function drawDecor(ctx, id, px, py, x, y) {
  if (id === O.FLOWER) {
    const h = hash2(x, y, 909);
    const col = h < 0.33 ? PAL.t : h < 0.66 ? PAL.p : PAL.C;
    ctx.fillStyle = PAL['8'];
    ctx.fillRect(px + 7, py + 9, 1, 4);
    ctx.fillStyle = col;
    ctx.fillRect(px + 6, py + 7, 3, 2);
    ctx.fillRect(px + 7, py + 6, 1, 4);
    if (h < 0.5) {
      ctx.fillStyle = PAL['8']; ctx.fillRect(px + 11, py + 12, 1, 3);
      ctx.fillStyle = col; ctx.fillRect(px + 10, py + 10, 3, 2);
    }
  } else if (id === O.TUFT) {
    const h = hash2(x, y, 313);
    ctx.fillStyle = h < 0.5 ? PAL['8'] : PAL.a;
    for (let i = 0; i < 4; i++) {
      const bx = px + 2 + i * 4 + ((hash2(x + i, y, 5) * 2) | 0);
      const bh = 2 + ((hash2(x, y + i, 9) * 3) | 0);
      ctx.fillRect(bx, py + 14 - bh, 1, bh);
      ctx.fillRect(bx + 1, py + 15 - bh, 1, bh - 1);
    }
  } else if (id === O.EXIT || id === O.STAIRS) {
    ctx.fillStyle = PAL['0']; ctx.fillRect(px + 2, py + 3, 12, 11);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? PAL.v : PAL.w;
      ctx.fillRect(px + 3 + i, py + 4 + i * 2.5, 10 - i * 2, 2);
    }
  } else if (id === O.PILLAR) {
    // 建物の当たり判定専用。見た目は drawBuilding が描く。
  } else if (id === O.CAGE) {
    ctx.fillStyle = PAL['0']; ctx.fillRect(px + 1, py + 2, 14, 13);
    ctx.fillStyle = PAL.c; ctx.fillRect(px + 2, py + 3, 12, 11);
    ctx.fillStyle = PAL.u;
    for (let i = 0; i < 4; i++) ctx.fillRect(px + 3 + i * 3, py + 3, 1, 11);
    ctx.fillRect(px + 2, py + 3, 12, 1);
    ctx.fillRect(px + 2, py + 13, 12, 1);
    ctx.fillStyle = PAL.s; ctx.fillRect(px + 7, py + 8, 2, 2);
  } else if (id === O.TORCH) {
    ctx.fillStyle = PAL.c; ctx.fillRect(px + 6, py + 7, 3, 9);
    const f = (performance.now() / 90) | 0;
    const w = 3 + (f % 2);
    ctx.fillStyle = PAL.o; ctx.fillRect(px + 8 - (w >> 1), py + 2, w, 5);
    ctx.fillStyle = PAL.s; ctx.fillRect(px + 7, py + 3, 2, 3);
    ctx.fillStyle = PAL.t; ctx.fillRect(px + 7, py + 4, 1, 1);
  } else if (id === O.POT) {
    ctx.fillStyle = PAL['0']; ctx.fillRect(px + 4, py + 5, 8, 10);
    ctx.fillStyle = PAL.e; ctx.fillRect(px + 5, py + 6, 6, 8);
    ctx.fillStyle = PAL.f; ctx.fillRect(px + 5, py + 6, 2, 6);
    ctx.fillStyle = PAL.d; ctx.fillRect(px + 4, py + 5, 8, 2);
  } else if (id === O.RELIC) {
    const t = performance.now() / 1000;
    const bob = Math.round(Math.sin(t * 2) * 1.5) - 2;
    // 光の輪
    ctx.save();
    ctx.globalAlpha = 0.16 + Math.sin(t * 3) * 0.06;
    ctx.fillStyle = PAL.t;
    ctx.beginPath(); ctx.arc(px + 8, py + 8 + bob, 13, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.30;
    ctx.beginPath(); ctx.arc(px + 8, py + 8 + bob, 8, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.drawImage(SPR.relic, px, py + bob);
    // きらめき
    ctx.fillStyle = PAL.E;
    for (let i = 0; i < 3; i++) {
      const a = t * 1.4 + i * TAU / 3;
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 4 + i);
      ctx.fillRect(Math.round(px + 8 + Math.cos(a) * 11), Math.round(py + 8 + bob + Math.sin(a) * 9), 1, 1);
    }
    ctx.globalAlpha = 1;
  } else if (id === O.CRATE) {
    ctx.fillStyle = PAL['0']; ctx.fillRect(px + 2, py + 3, 12, 12);
    ctx.fillStyle = PAL.e; ctx.fillRect(px + 3, py + 4, 10, 10);
    ctx.fillStyle = PAL.f; ctx.fillRect(px + 3, py + 4, 10, 2);
    ctx.fillStyle = PAL.d;
    ctx.fillRect(px + 3, py + 8, 10, 1);
    ctx.fillRect(px + 7, py + 4, 1, 10);
    ctx.fillStyle = PAL.c; ctx.fillRect(px + 3, py + 13, 10, 1);
  } else if (id === O.LAMP) {
    ctx.fillStyle = PAL['0'];
    ctx.fillRect(px + 6, py + 2, 4, 14);
    ctx.fillStyle = PAL.u; ctx.fillRect(px + 7, py + 3, 2, 13);
    ctx.fillStyle = PAL['0']; ctx.fillRect(px + 3, py - 6, 10, 8);
    ctx.fillStyle = PAL['1']; ctx.fillRect(px + 4, py - 5, 8, 6);
    ctx.fillStyle = PAL.t; ctx.fillRect(px + 5, py - 3, 6, 3);
    ctx.fillStyle = PAL.s; ctx.fillRect(px + 5, py - 1, 6, 1);
    ctx.fillStyle = PAL['0']; ctx.fillRect(px + 4, py - 8, 8, 2);
  } else if (id === O.GATEWAY) {
    // 通り道のしるし（うっすら光る足あと）
    const t = performance.now() / 600;
    ctx.globalAlpha = 0.18 + Math.sin(t) * 0.06;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px + 2, py + 5, 12, 6);
    ctx.globalAlpha = 1;
  } else if (id === O.CRACK) {
    ctx.fillStyle = PAL.u; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = PAL['1'];
    ctx.fillRect(px + 7, py + 1, 1, 6); ctx.fillRect(px + 6, py + 7, 1, 4);
    ctx.fillRect(px + 8, py + 8, 1, 6); ctx.fillRect(px + 4, py + 10, 2, 1);
  }
}

/** 建物を描く（外観のみ） */
function drawBuilding(ctx, b, camx, camy) {
  const px = Math.round(b.x * TILE - camx), py = Math.round(b.y * TILE - camy);
  const w = b.w * TILE, h = b.h * TILE;
  if (px > view.w || py > view.h || px + w < 0 || py + h < 0) return;
  if (!b.built) {
    // 更地：四隅の杭とロープ、そして小さな立て看板
    const x0 = px + 2, y0 = py + 6, x1 = px + w - 3, y1 = py + h - 3;
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = PAL.d;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PAL.g; ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.rect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    for (const [sx, sy] of [[x0, y0], [x1 - 1, y0], [x0, y1 - 2], [x1 - 1, y1 - 2]]) {
      ctx.fillStyle = PAL['0']; ctx.fillRect(sx - 1, sy - 4, 3, 6);
      ctx.fillStyle = PAL.d; ctx.fillRect(sx, sy - 4, 1, 5);
    }
    // 看板
    const sxc = px + (w >> 1) - 6, syc = y1 - 14;
    ctx.fillStyle = PAL['0']; ctx.fillRect(sxc - 1, syc - 1, 14, 11);
    ctx.fillStyle = PAL.e; ctx.fillRect(sxc, syc, 12, 9);
    ctx.fillStyle = PAL.f; ctx.fillRect(sxc + 1, syc + 1, 10, 7);
    ctx.fillStyle = PAL.c;
    ctx.fillRect(sxc + 2, syc + 3, 8, 1);
    ctx.fillRect(sxc + 2, syc + 5, 5, 1);
    ctx.fillStyle = PAL.d; ctx.fillRect(px + (w >> 1) - 1, syc + 10, 2, 5);
    return;
  }
  const bodyTop = py + 14;
  const bodyH = h - 14;
  // 壁
  ctx.fillStyle = PAL['0'];
  ctx.fillRect(px - 1, bodyTop - 1, w + 2, bodyH + 1);
  ctx.fillStyle = b.id === 'sage' ? PAL['2'] : PAL.f;
  ctx.fillRect(px, bodyTop, w, bodyH);
  ctx.fillStyle = b.id === 'sage' ? PAL['3'] : PAL.g;
  for (let x = 0; x < w; x += 2) ctx.fillRect(px + x, bodyTop, 1, bodyH);
  ctx.fillStyle = b.id === 'sage' ? PAL['1'] : PAL.e;
  ctx.fillRect(px, bodyTop + bodyH - 3, w, 3);
  // 屋根
  const roofC = { home: PAL.n, shop: PAL.j, smith: PAL.u, healer: PAL.a, sage: PAL.A, farm: PAL.r, well: PAL.w }[b.id] || PAL.n;
  ctx.fillStyle = PAL['0'];
  ctx.beginPath();
  ctx.moveTo(px - 4, bodyTop + 1); ctx.lineTo(px + w / 2, py - 3); ctx.lineTo(px + w + 4, bodyTop + 1);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = roofC;
  ctx.beginPath();
  ctx.moveTo(px - 3, bodyTop); ctx.lineTo(px + w / 2, py - 1); ctx.lineTo(px + w + 3, bodyTop);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.35; ctx.fillStyle = PAL['0'];
  ctx.beginPath();
  ctx.moveTo(px + w / 2, py - 1); ctx.lineTo(px + w + 3, bodyTop); ctx.lineTo(px + w / 2, bodyTop);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  // 扉
  const dx = px + (w >> 1) - 4;
  const dy = bodyTop + bodyH - 12;
  ctx.fillStyle = PAL['0']; ctx.fillRect(dx - 1, dy - 1, 10, 13);
  ctx.fillStyle = PAL.c; ctx.fillRect(dx, dy, 8, 12);
  ctx.fillStyle = PAL.d; ctx.fillRect(dx + 1, dy + 1, 6, 10);
  ctx.fillStyle = PAL.s; ctx.fillRect(dx + 6, dy + 6, 1, 2);
  // 窓
  if (bodyH > 18) {
    for (const wx of [px + 3, px + w - 8]) {
      ctx.fillStyle = PAL['0']; ctx.fillRect(wx, bodyTop + 4, 6, 6);
      ctx.fillStyle = PAL.s; ctx.fillRect(wx + 1, bodyTop + 5, 4, 4);
      ctx.fillStyle = PAL.q; ctx.fillRect(wx + 3, bodyTop + 5, 1, 4);
    }
  }
  // 看板
  if (b.id !== 'home') {
    ctx.fillStyle = PAL['0']; ctx.fillRect(px + w - 6, bodyTop + bodyH - 20, 5, 7);
    ctx.fillStyle = PAL.g; ctx.fillRect(px + w - 5, bodyTop + bodyH - 19, 3, 5);
  }
}

// ---------------------------------------------------------------------------

const drawables = [];

export function drawScene(g) {
  const ctx = wctx;
  const level = g.level;
  const [sx, sy] = FX.shakeOffset();
  const camx = Math.round(cam.x - view.w / 2 + sx);
  const camy = Math.round(cam.y - view.h / 2 + sy);
  g.camx = camx; g.camy = camy;

  if (level.kind === 'arena') {
    drawArenaBackdrop(ctx, g, camx, camy, view.w, view.h, performance.now() / 1000);
  } else {
    ctx.fillStyle = level.island ? '#22403a' : level.kind === 'dungeon' ? '#0d0b12' : PAL.h;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  const x0 = Math.max(0, Math.floor(camx / TILE));
  const y0 = Math.max(0, Math.floor(camy / TILE));
  const x1 = Math.min(level.w - 1, Math.ceil((camx + view.w) / TILE));
  const y1 = Math.min(level.h - 1, Math.ceil((camy + view.h) / TILE));

  // --- 地面 ---
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = level.ground[y * level.w + x];
      if (t === T.VOID) continue;                  // 「向こう側」は背景がそのまま見える
      const name = TERRAIN_NAME[t];
      const px = x * TILE - camx, py = y * TILE - camy;
      const set = TERRAIN_TILES[name];
      const v = (t === T.WATER || t === T.DEEP) ? waterFrame : groundVariant(x, y);
      ctx.drawImage(set[v], px, py);
    }
  }
  // --- 地面のディザ境界 ---
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = level.ground[y * level.w + x];
      if (t === T.VOID) continue;
      const prio = TERRAIN_PRIO[t];
      const px = x * TILE - camx, py = y * TILE - camy;
      const nb = [[0, -1, 0], [0, 1, 1], [-1, 0, 2], [1, 0, 3]];
      for (const [ox, oy, dir] of nb) {
        const nx = x + ox, ny = y + oy;
        if (!level.inb(nx, ny)) continue;
        const nt = level.ground[ny * level.w + nx];
        if (nt === t) continue;
        if (TERRAIN_PRIO[nt] <= prio) continue;
        const e = EDGE[TERRAIN_NAME[nt]];
        if (e) ctx.drawImage(e[dir], px, py);
      }
    }
  }

  // --- 島のふち ---
  if (level.island) drawIslandEdges(ctx, level, x0, y0, x1, y1, camx, camy);

  // --- ボスの頭・腕（地面より上、キャラより下）---
  if (g.boss) g.boss.drawBack(ctx, camx, camy);

  // --- 危険の予告（地面のしるし）---
  ctx.save();
  ctx.translate(-camx, -camy);
  drawHazardsUnder(ctx, g);
  ctx.restore();

  // --- 低いオブジェクト・装飾 ---
  drawables.length = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const id = level.obj[y * level.w + x];
      if (!id) continue;
      const def = OBJ_DEF[id];
      const px = x * TILE - camx, py = y * TILE - camy;
      if (!def) continue;
      if (def.tall) { drawables.push({ sortY: y * TILE + TILE, kind: 'obj', id, px, py, x, y }); continue; }
      if (def.spr) drawObjSprite(ctx, id, x, y, px, py);
      else drawDecor(ctx, id, px, py, x, y);
    }
  }

  // --- 奥行きソートして描画（建物・高い物・エンティティをまとめて）---
  for (const b of level.buildings) {
    if (b.x * TILE > camx + view.w || (b.x + b.w) * TILE < camx) continue;
    if (b.y * TILE > camy + view.h + 40 || (b.y + b.h) * TILE < camy - 40) continue;
    drawables.push({ sortY: (b.y + b.h) * TILE - 2, kind: 'bld', b });
  }

  ctx.save();
  ctx.translate(-camx, -camy);
  for (const e of g.drawList()) {
    if (e.x < camx - 40 || e.x > camx + view.w + 40 || e.y < camy - 60 || e.y > camy + view.h + 60) continue;
    drawables.push({ sortY: e.y, kind: 'ent', e });
  }
  drawables.sort((a, b) => a.sortY - b.sortY);
  for (const d of drawables) {
    if (d.kind === 'ent') { d.e.draw(ctx); continue; }
    if (d.kind === 'bld') {
      ctx.restore(); drawBuilding(ctx, d.b, camx, camy); ctx.save(); ctx.translate(-camx, -camy);
      continue;
    }
    const def = OBJ_DEF[d.id];
    if (def.spr) drawObjSprite(ctx, d.id, d.x, d.y, d.px + camx, d.py + camy);
    else { ctx.restore(); drawDecor(ctx, d.id, d.px, d.py, d.x, d.y); ctx.save(); ctx.translate(-camx, -camy); }
  }
  FX.drawParticles(ctx);
  drawHazardsOver(ctx, g);
  if (g.boss) g.boss.drawWarn(ctx, 0, 0);
  ctx.restore();

  // --- 木もれ日（屋外だけ）---
  if (level.kind === 'field' && !level.dark) drawSunShafts(ctx, camx, camy);

  // --- かぶりつきの寄り絵 ---
  if (g.boss) g.boss.drawLungeOverlay(ctx, camx, camy, view.w, view.h);

  // --- 明かり（ダンジョン）---
  if (level.dark) drawLight(g, camx, camy);

  // --- 画面フラッシュ ---
  if (FX.fx.flash > 0.01) {
    ctx.globalAlpha = clamp(FX.fx.flash, 0, 1);
    ctx.fillStyle = FX.fx.flashColor;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.globalAlpha = 1;
  }

  // --- 文字の浮き上がり ---
  ctx.save();
  ctx.translate(-camx, -camy);
  ctx.font = 'bold 8px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (const t of FX.fx.texts) {
    const a = clamp(t.life / t.max, 0, 1);
    ctx.globalAlpha = a > 0.5 ? 1 : a * 2;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.font = `bold ${t.size}px ui-monospace, monospace`;
    ctx.strokeText(t.text, Math.round(t.x), Math.round(t.y));
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, Math.round(t.x), Math.round(t.y));
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 島のふちに、こんもりした葉の帯を描く（参考画面の見た目に合わせて）*/
function drawIslandEdges(ctx, level, x0, y0, x1, y1, camx, camy) {
  const isVoid = (x, y) => !level.inb(x, y) || level.ground[y * level.w + x] === T.VOID;
  const NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (isVoid(x, y)) continue;
      const px = x * TILE - camx, py = y * TILE - camy;
      for (const [ox, oy] of NB) {
        if (!isVoid(x + ox, y + oy)) continue;
        // その辺にそって 3 つのふくらみ
        for (let i = 0; i < 3; i++) {
          const t = (i + 0.5) / 3;
          const jitter = (hash2(x * 4 + i, y * 4 + (ox + oy * 2), 991) - 0.5) * 2.2;
          const r = 2.6 + hash2(x + i, y, 331) * 1.5;
          let bx, by;
          if (oy !== 0) { bx = px + t * TILE + jitter; by = py + (oy < 0 ? 1.5 : TILE - 1.5); }
          else { bx = px + (ox < 0 ? 1.5 : TILE - 1.5); by = py + t * TILE + jitter; }
          ctx.fillStyle = '#1d4a2b';
          ctx.beginPath(); ctx.arc(bx, by, r + 0.9, 0, TAU); ctx.fill();
          ctx.fillStyle = hash2(x, y + i, 77) < 0.5 ? '#54b463' : '#63c471';
          ctx.beginPath(); ctx.arc(bx, by - 0.6, r, 0, TAU); ctx.fill();
        }
      }
    }
  }
}

/** ななめに差しこむ光。うっすらで十分。 */
function drawSunShafts(ctx, camx, camy) {
  const t = performance.now() / 1000;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.035;
  ctx.fillStyle = '#fff6d8';
  const drift = (t * 3) % 90;
  for (let i = -2; i < 8; i++) {
    const x = i * 90 + drift - (camx * 0.12) % 90;
    ctx.beginPath();
    ctx.moveTo(x, -10);
    ctx.lineTo(x + 26, -10);
    ctx.lineTo(x - 40, view.h + 10);
    ctx.lineTo(x - 66, view.h + 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawLight(g, camx, camy) {
  const level = g.level;
  lctx.globalCompositeOperation = 'source-over';
  lctx.fillStyle = 'rgba(6,4,10,0.90)';
  lctx.fillRect(0, 0, view.w, view.h);
  lctx.globalCompositeOperation = 'destination-out';

  const addLight = (x, y, r, strength = 1) => {
    if (x < -r || y < -r || x > view.w + r || y > view.h + r) return;
    const grd = lctx.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(0,0,0,${strength})`);
    grd.addColorStop(0.55, `rgba(0,0,0,${strength * 0.72})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = grd;
    lctx.fillRect(x - r, y - r, r * 2, r * 2);
  };

  const flicker = 1 + Math.sin(performance.now() / 130) * 0.04;
  addLight(g.player.x - camx, g.player.y - camy - 6, 74 * flicker, 1);

  const x0 = Math.max(0, Math.floor(camx / TILE)), y0 = Math.max(0, Math.floor(camy / TILE));
  const x1 = Math.min(level.w - 1, Math.ceil((camx + view.w) / TILE));
  const y1 = Math.min(level.h - 1, Math.ceil((camy + view.h) / TILE));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      {
        const ob = level.obj[y * level.w + x];
        if (ob === O.TORCH)
          addLight(x * TILE + 8 - camx, y * TILE + 5 - camy, 42 * (1 + Math.sin(performance.now() / 90 + x) * 0.07), 0.95);
        else if (ob === O.RELIC)
          addLight(x * TILE + 8 - camx, y * TILE + 6 - camy, 56 * (1 + Math.sin(performance.now() / 260) * 0.10), 1);
        else if (ob === O.CHEST)
          addLight(x * TILE + 8 - camx, y * TILE + 8 - camy, 15, 0.42);
      }
  for (const b of g.bombs) addLight(b.x - camx, b.y - camy - 4, 22, 0.7);
  for (const e of g.enemies) if (e.boss && !e.dead) addLight(e.x - camx, e.y - camy - 10, 40, 0.6);

  lctx.globalCompositeOperation = 'source-over';
  wctx.drawImage(light, 0, 0);
}

/** 論理画面を実画面へ拡大転送 */
export function present() {
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.fillStyle = '#08070c';
  sctx.fillRect(0, 0, screen.width, screen.height);
  const d = view.dpr;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(world, 0, 0, view.w, view.h,
    Math.round(view.ox * d), Math.round(view.oy * d),
    Math.round(view.cssW * d), Math.round(view.cssH * d));
}
