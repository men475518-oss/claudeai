// ---------------------------------------------------------------------------
// ui.js — HUD・タッチ操作の表示・会話・メニュー・マップ・タイトル
//   すべて実画面（CSS px）へ描画する。日本語はシステムフォントで鮮明に。
// ---------------------------------------------------------------------------
import { UI, FONT, TILE } from './config.js';
import { clamp, lerp, TAU, formatTime } from './util.js';
import { SPR, PAL, silhouette, makeCanvas } from './art.js';
import { view } from './render.js';
import { input, setButtons } from './input.js';
import { T, O, TERRAIN_NAME, BUILDINGS } from './world.js';
import { sfx } from './audio.js';

export const ui = {
  S: 1,
  padTop: 0, padBottom: 0,
  toastText: '', toastT: 0, toastSub: '',
  showControls: true,
  buttons: [],
  hint: null,          // {text} 画面下の操作ヒント
};

let heartEmpty = null, heartHalf = null;

export function layoutUi() {
  ui.S = clamp(view.cssW / 390, 0.72, 2.0);
  // ノッチ／ホームバーぶんの余白（ウィンドウいっぱいに描くときだけ効かせる）
  const tall = view.winH / view.winW > 1.9;
  const fullBleed = view.oy < 2;
  ui.padTop = 10 + (tall && fullBleed ? 34 : 6);
  ui.padBottom = 8 + (tall && fullBleed ? 18 : 4);
}

// --- 描画ヘルパ ------------------------------------------------------------

export function txt(ctx, s, x, y, o = {}) {
  const size = o.size ?? 14;
  ctx.font = `${o.weight || 600} ${size}px ${FONT}`;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.baseline || 'top';
  if (o.outline !== false) {
    ctx.lineWidth = Math.max(2, size * 0.24);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = o.outlineColor || 'rgba(8,6,12,0.92)';
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = o.color || UI.ink;
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function panel(ctx, x, y, w, h, o = {}) {
  const S = ui.S;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 12 * S;
  ctx.shadowOffsetY = 3 * S;
  roundRect(ctx, x, y, w, h, o.r ?? 10 * S);
  ctx.fillStyle = o.fill || UI.panel;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, o.r ?? 10 * S);
  ctx.strokeStyle = o.edge || UI.panelEdge;
  ctx.lineWidth = Math.max(1, 1.4 * S);
  ctx.stroke();
  if (o.inner !== false) {
    roundRect(ctx, x + 3 * S, y + 3 * S, w - 6 * S, h - 6 * S, (o.r ?? 10 * S) - 2 * S);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function sprite(ctx, spr, x, y, scale) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spr, Math.round(x), Math.round(y), spr.width * scale, spr.height * scale);
}

/** 折り返し */
export function wrapText(ctx, text, maxW, size) {
  ctx.font = `600 ${size}px ${FONT}`;
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
      else line += ch;
    }
    out.push(line);
  }
  return out;
}

// --- トースト --------------------------------------------------------------

export function toast(text, sub = '') {
  ui.toastText = text; ui.toastSub = sub; ui.toastT = 2.6;
}

// --- 会話 ------------------------------------------------------------------

export const dialog = {
  active: false,
  pages: [], page: 0, chars: 0,
  speaker: '', portrait: -1,
  choices: null, choiceIdx: 0,
  onDone: null, onChoice: null,
};

export function openDialog(o) {
  dialog.active = true;
  dialog.pages = Array.isArray(o.text) ? o.text : [o.text];
  dialog.page = 0; dialog.chars = 0;
  dialog.speaker = o.speaker || '';
  dialog.portrait = o.portrait ?? -1;
  dialog.choices = o.choices || null;
  dialog.choiceIdx = 0;
  dialog.onDone = o.onDone || null;
  dialog.onChoice = o.onChoice || null;
}

export function closeDialog() {
  dialog.active = false;
  const cb = dialog.onDone; dialog.onDone = null;
  if (cb) cb();
}

function dialogRects() {
  const S = ui.S, W = view.cssW, H = view.cssH;
  const h = 128 * S;
  const x = 12 * S, y = H - h - ui.padBottom - 8 * S, w = W - 24 * S;
  return { x, y, w, h, S };
}

export function updateDialog(dt) {
  if (!dialog.active) return;
  const page = dialog.pages[dialog.page] || '';
  dialog.chars += dt * 52;
  const done = dialog.chars >= page.length;

  let advance = input.aPressed || input.gTap;
  for (const t of input.taps) advance = true;
  if (dialog.choices && done) {
    // 選択肢はボタンで処理する
    return;
  }
  if (advance) {
    if (!done) dialog.chars = page.length;
    else if (dialog.page < dialog.pages.length - 1) { dialog.page++; dialog.chars = 0; sfx('ui'); }
    else { sfx('uiBack'); closeDialog(); }
  }
}

export function registerDialogButtons() {
  if (!dialog.active) return;
  const page = dialog.pages[dialog.page] || '';
  const done = dialog.chars >= page.length;
  if (!dialog.choices || !done) return;
  const r = dialogRects(), S = ui.S;
  const n = dialog.choices.length;
  const bw = (r.w - 24 * S) / n, bh = 34 * S;
  const by = r.y + r.h - bh - 10 * S;
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push({ id: 'dlg' + i, x: r.x + 12 * S + bw * i + bw / 2, y: by + bh / 2, hw: bw / 2 - 3 * S, hh: bh / 2 });
  }
  return list;
}

export function drawDialog(ctx) {
  if (!dialog.active) return;
  const r = dialogRects(), S = r.S;
  panel(ctx, r.x, r.y, r.w, r.h);
  let ty = r.y + 14 * S;
  if (dialog.speaker) {
    ctx.font = `600 ${13 * S}px ${FONT}`;
    panel(ctx, r.x + 10 * S, r.y - 13 * S, ctx.measureText(dialog.speaker).width + 32 * S, 26 * S, { r: 8 * S, fill: 'rgba(40,30,20,0.95)' });
    txt(ctx, dialog.speaker, r.x + 22 * S, r.y - 7 * S, { size: 13 * S, color: UI.gold });
  }
  if (dialog.portrait >= 0 && SPR.villagers[dialog.portrait]) {
    sprite(ctx, SPR.villagers[dialog.portrait][0][0], r.x + 12 * S, ty + 2 * S, 2 * S);
  }
  const tx = r.x + (dialog.portrait >= 0 ? 48 * S : 16 * S);
  const maxW = r.w - (dialog.portrait >= 0 ? 62 * S : 32 * S);
  const size = 14 * S;
  const full = dialog.pages[dialog.page] || '';
  const shown = full.slice(0, Math.floor(dialog.chars));
  const lines = wrapText(ctx, shown, maxW, size);
  for (let i = 0; i < lines.length && i < 4; i++) {
    txt(ctx, lines[i], tx, ty + i * size * 1.45, { size, color: UI.ink, outline: false });
  }
  const done = dialog.chars >= full.length;
  if (dialog.choices && done) {
    const n = dialog.choices.length;
    const bw = (r.w - 24 * S) / n, bh = 34 * S;
    const by = r.y + r.h - bh - 10 * S;
    for (let i = 0; i < n; i++) {
      const bx = r.x + 12 * S + bw * i;
      panel(ctx, bx + 3 * S, by, bw - 6 * S, bh, { r: 7 * S, fill: 'rgba(60,48,72,0.95)', edge: UI.gold, inner: false });
      txt(ctx, dialog.choices[i], bx + bw / 2, by + bh / 2 - 8 * S, { size: 13 * S, align: 'center', color: UI.ink, outline: false });
    }
  } else if (done) {
    const t = performance.now() / 400;
    const ax = r.x + r.w - 20 * S, ay = r.y + r.h - 16 * S + Math.sin(t * 3) * 2 * S;
    ctx.fillStyle = UI.gold;
    ctx.beginPath();
    ctx.moveTo(ax - 5 * S, ay - 4 * S); ctx.lineTo(ax + 5 * S, ay - 4 * S); ctx.lineTo(ax, ay + 3 * S);
    ctx.closePath(); ctx.fill();
  }
}

// --- リストメニュー --------------------------------------------------------

export const menu = {
  active: false,
  title: '', sub: '',
  items: [], idx: 0,
  onClose: null,
  closable: true,
  footer: '',
};

export function openMenu(o) {
  menu.active = true;
  menu.title = o.title || '';
  menu.sub = o.sub || '';
  menu.items = o.items || [];
  menu.idx = 0;
  menu.onClose = o.onClose || null;
  menu.closable = o.closable !== false;
  menu.footer = o.footer || '';
  sfx('ui');
}

export function closeMenu() {
  if (!menu.active) return;
  menu.active = false;
  const cb = menu.onClose; menu.onClose = null;
  if (cb) cb();
}

function menuRects() {
  const S = ui.S, W = view.cssW, H = view.cssH;
  const rowH = 46 * S;
  const n = menu.items.length;
  const headH = (menu.title ? 40 * S : 0) + (menu.sub ? 22 * S : 0);
  const footH = menu.footer ? 26 * S : 0;
  const h = Math.min(H - 80 * S, headH + n * rowH + 24 * S + footH);
  const w = Math.min(W - 28 * S, 360 * S);
  const x = (W - w) / 2, y = (H - h) / 2 - 10 * S;
  return { x, y, w, h, rowH, headH, footH, S };
}

export function registerMenuButtons() {
  if (!menu.active) return [];
  const r = menuRects(), S = r.S;
  const list = [];
  const top = r.y + r.headH + 10 * S;
  for (let i = 0; i < menu.items.length; i++) {
    const ry = top + i * r.rowH;
    if (ry + r.rowH > r.y + r.h - r.footH) break;
    list.push({ id: 'menu' + i, x: r.x + r.w / 2, y: ry + r.rowH / 2 - 2 * S, hw: r.w / 2 - 10 * S, hh: r.rowH / 2 - 3 * S });
  }
  if (menu.closable) list.push({ id: 'menuClose', x: r.x + r.w - 18 * S, y: r.y + 18 * S, r: 18 * S });
  return list;
}

export function drawMenu(ctx) {
  if (!menu.active) return;
  const r = menuRects(), S = r.S;
  ctx.fillStyle = 'rgba(6,5,10,0.55)';
  ctx.fillRect(0, 0, view.cssW, view.cssH);
  panel(ctx, r.x, r.y, r.w, r.h);
  if (menu.title) txt(ctx, menu.title, r.x + r.w / 2, r.y + 13 * S, { size: 17 * S, align: 'center', color: UI.gold, outline: false });
  if (menu.sub) txt(ctx, menu.sub, r.x + r.w / 2, r.y + 36 * S, { size: 11.5 * S, align: 'center', color: UI.inkDim, outline: false });
  const top = r.y + r.headH + 10 * S;
  for (let i = 0; i < menu.items.length; i++) {
    const it = menu.items[i];
    const ry = top + i * r.rowH;
    if (ry + r.rowH > r.y + r.h - r.footH) break;
    const sel = i === menu.idx;
    const dis = !!it.disabled;
    roundRect(ctx, r.x + 10 * S, ry, r.w - 20 * S, r.rowH - 6 * S, 7 * S);
    ctx.fillStyle = sel ? 'rgba(90,74,110,0.85)' : 'rgba(38,31,48,0.7)';
    ctx.fill();
    if (sel) { ctx.strokeStyle = UI.gold; ctx.lineWidth = 1.5 * S; ctx.stroke(); }
    let lx = r.x + 22 * S;
    if (it.icon && SPR[it.icon]) { sprite(ctx, SPR[it.icon], lx - 4 * S, ry + 8 * S, 2 * S); lx += 18 * S; }
    txt(ctx, it.label, lx, ry + (it.sub ? 6 * S : 12 * S), {
      size: 14 * S, color: dis ? '#6d6478' : UI.ink, outline: false,
    });
    if (it.sub) txt(ctx, it.sub, lx, ry + 24 * S, { size: 10.5 * S, color: dis ? '#5b5366' : UI.inkDim, outline: false });
    if (it.cost != null) {
      const cx = r.x + r.w - 24 * S;
      sprite(ctx, SPR.coin, cx - 10 * S, ry + 13 * S, 1.6 * S);
      txt(ctx, String(it.cost), cx - 14 * S, ry + 13 * S, { size: 13 * S, align: 'right', color: dis ? '#6d6478' : UI.gold, outline: false });
    } else if (it.right) {
      txt(ctx, it.right, r.x + r.w - 22 * S, ry + 13 * S, { size: 12 * S, align: 'right', color: UI.inkDim, outline: false });
    }
  }
  if (menu.footer) txt(ctx, menu.footer, r.x + r.w / 2, r.y + r.h - 20 * S, { size: 10.5 * S, align: 'center', color: UI.inkDim, outline: false });
  if (menu.closable) {
    const cx = r.x + r.w - 18 * S, cy = r.y + 18 * S;
    ctx.strokeStyle = UI.inkDim; ctx.lineWidth = 2 * S; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 5 * S, cy - 5 * S); ctx.lineTo(cx + 5 * S, cy + 5 * S);
    ctx.moveTo(cx + 5 * S, cy - 5 * S); ctx.lineTo(cx - 5 * S, cy + 5 * S);
    ctx.stroke();
  }
}

// --- HUD -------------------------------------------------------------------

function ensureHearts() {
  if (heartEmpty) return;
  heartEmpty = silhouette(SPR.heart, '#42303a');
  heartHalf = makeCanvas(8, 8);
  const c = heartHalf.getContext('2d');
  c.drawImage(heartEmpty, 0, 0);
  c.save(); c.beginPath(); c.rect(0, 0, 4, 8); c.clip();
  c.drawImage(SPR.heart, 0, 0); c.restore();
}

export function drawHud(ctx, g) {
  ensureHearts();
  const S = ui.S, W = view.cssW;
  const p = g.player;
  const top = ui.padTop;

  // ハート
  const hs = 2.2 * S;
  const hearts = Math.ceil(p.maxHp / 2);
  const perRow = Math.min(hearts, Math.floor((W - 100 * S) / (10 * hs)));
  for (let i = 0; i < hearts; i++) {
    const col = i % perRow, row = (i / perRow) | 0;
    const x = 12 * S + col * 10 * hs, y = top + row * 9 * hs;
    const v = clamp(p.hp - i * 2, 0, 2);
    sprite(ctx, v >= 2 ? SPR.heart : v >= 1 ? heartHalf : heartEmpty, x, y, hs);
  }

  // コイン・カギ
  const rowsH = Math.ceil(hearts / Math.max(1, perRow)) * 9 * hs;
  let ix = 12 * S, iy = top + rowsH + 3 * S;
  sprite(ctx, SPR.coin, ix, iy, 2 * S);
  txt(ctx, String(p.coins), ix + 20 * S, iy + 2 * S, { size: 13 * S, color: UI.gold });
  ix += 20 * S + ctx.measureText(String(p.coins)).width + 14 * S;
  if (p.keys > 0) {
    sprite(ctx, SPR.key, ix, iy, 2 * S);
    txt(ctx, String(p.keys), ix + 18 * S, iy + 2 * S, { size: 13 * S, color: UI.ink });
    ix += 18 * S + 20 * S;
  }
  if (p.relics > 0) {
    sprite(ctx, SPR.gem, ix, iy, 2 * S);
    txt(ctx, `${p.relics}/3`, ix + 18 * S, iy + 2 * S, { size: 13 * S, color: PAL.C });
  }

  // 右上ボタン（メニュー・マップ）
  const bx = W - 26 * S, by = top + 12 * S;
  drawIconButton(ctx, bx, by, 17 * S, 'menu');
  drawIconButton(ctx, bx - 42 * S, by, 17 * S, 'map');

  // ボス HP
  const boss = g.enemies.find(e => e.boss && !e.dead && e.aggro);
  if (boss) {
    const bw = Math.min(view.cssW - 80 * S, 260 * S), bh = 12 * S;
    const bxx = (W - bw) / 2, byy = top + 6 * S;
    panel(ctx, bxx - 4 * S, byy - 4 * S, bw + 8 * S, bh + 22 * S, { r: 6 * S, inner: false });
    txt(ctx, boss.def.name, bxx + bw / 2, byy - 1 * S, { size: 11 * S, align: 'center', color: UI.gold, outline: false });
    const yy = byy + 16 * S;
    ctx.fillStyle = '#2a1420'; ctx.fillRect(bxx, yy, bw, bh);
    ctx.fillStyle = UI.red;
    ctx.fillRect(bxx, yy, bw * clamp(boss.hp / boss.maxHp, 0, 1), bh);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bxx + 0.5, yy + 0.5, bw - 1, bh - 1);
  }

  // トースト
  if (ui.toastT > 0) {
    const a = clamp(ui.toastT / 0.4, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = `600 ${14 * S}px ${FONT}`;
    const w1 = ctx.measureText(ui.toastText).width;
    ctx.font = `600 ${11 * S}px ${FONT}`;
    const w2 = ui.toastSub ? ctx.measureText(ui.toastSub).width : 0;
    const tw = Math.min(view.cssW - 24 * S, Math.max(w1, w2, 120 * S) + 40 * S);
    const th = ui.toastSub ? 52 * S : 36 * S;
    const tx = (W - tw) / 2, ty = view.cssH * 0.30;
    panel(ctx, tx, ty, tw, th, { r: 8 * S });
    txt(ctx, ui.toastText, W / 2, ty + 10 * S, { size: 14 * S, align: 'center', color: UI.gold, outline: false });
    if (ui.toastSub) txt(ctx, ui.toastSub, W / 2, ty + 30 * S, { size: 11 * S, align: 'center', color: UI.inkDim, outline: false });
    ctx.globalAlpha = 1;
  }

  // 操作ヒント
  if (ui.hint) {
    const hy = view.cssH - ui.padBottom - 150 * S;
    txt(ctx, ui.hint, W / 2, hy, { size: 12 * S, align: 'center', color: UI.ink });
  }
}

function drawIconButton(ctx, cx, cy, r, kind) {
  const S = ui.S;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = 'rgba(20,16,26,0.72)'; ctx.fill();
  ctx.strokeStyle = 'rgba(210,196,164,0.45)'; ctx.lineWidth = 1.4 * S; ctx.stroke();
  ctx.strokeStyle = UI.ink; ctx.lineWidth = 2 * S; ctx.lineCap = 'round';
  if (kind === 'menu') {
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(cx - 6 * S, cy + i * 5 * S); ctx.lineTo(cx + 6 * S, cy + i * 5 * S);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - 7 * S, cy - 5 * S); ctx.lineTo(cx - 2 * S, cy - 7 * S);
    ctx.lineTo(cx + 3 * S, cy - 4 * S); ctx.lineTo(cx + 7 * S, cy - 6 * S);
    ctx.lineTo(cx + 7 * S, cy + 6 * S); ctx.lineTo(cx + 3 * S, cy + 8 * S);
    ctx.lineTo(cx - 2 * S, cy + 5 * S); ctx.lineTo(cx - 7 * S, cy + 7 * S);
    ctx.closePath(); ctx.stroke();
  }
}

// --- タッチ操作の表示 ------------------------------------------------------

export function controlLayout() {
  const S = ui.S, W = view.cssW, H = view.cssH;
  const ay = H - ui.padBottom - 62 * S;
  return {
    a: { x: W - 56 * S, y: ay, r: 38 * S },
    b: { x: W - 122 * S, y: ay + 18 * S, r: 26 * S },
    swap: { x: W - 122 * S, y: ay - 26 * S, r: 15 * S },
    S,
  };
}

export function drawTouchControls(ctx, g) {
  const S = ui.S;
  const L = controlLayout();
  const p = g.player;

  // フローティングスティック
  if (input.stick.active && !input.gStill) {
    const s = input.stick;
    ctx.globalAlpha = 0.30;
    ctx.beginPath(); ctx.arc(s.ox, s.oy, 34 * S, 0, TAU);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.strokeStyle = UI.ink; ctx.lineWidth = 2 * S; ctx.stroke();
    ctx.globalAlpha = 0.7;
    let dx = s.x - s.ox, dy = s.y - s.oy;
    const d = Math.hypot(dx, dy);
    if (d > 34 * S) { dx = dx / d * 34 * S; dy = dy / d * 34 * S; }
    ctx.beginPath(); ctx.arc(s.ox + dx, s.oy + dy, 15 * S, 0, TAU);
    ctx.fillStyle = UI.ink; ctx.fill();
    ctx.globalAlpha = 1;
  }
  // ため中のリング
  if (input.gStill && input.gHeld > 0.1) {
    const t = clamp(input.gHeld / 0.42, 0, 1);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(input.stick.ox, input.stick.oy, 26 * S, -Math.PI / 2, -Math.PI / 2 + TAU * t);
    ctx.strokeStyle = t >= 1 ? UI.gold : UI.ink;
    ctx.lineWidth = 4 * S; ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (!ui.showControls) return;

  // A ボタン
  const aDown = input.a;
  ctx.globalAlpha = aDown ? 0.95 : 0.62;
  ctx.beginPath(); ctx.arc(L.a.x, L.a.y, L.a.r, 0, TAU);
  ctx.fillStyle = aDown ? '#7a4750' : 'rgba(30,22,34,0.8)'; ctx.fill();
  ctx.strokeStyle = UI.red; ctx.lineWidth = 2.4 * S; ctx.stroke();
  ctx.globalAlpha = 1;
  drawSwordIcon(ctx, L.a.x, L.a.y, 16 * S);

  // B ボタン（道具）
  const item = p.item;
  const cnt = item === 'bomb' ? p.bombs : item === 'potion' ? p.potions : p.mp;
  ctx.globalAlpha = input.b ? 0.95 : 0.55;
  ctx.beginPath(); ctx.arc(L.b.x, L.b.y, L.b.r, 0, TAU);
  ctx.fillStyle = input.b ? '#4a5a7a' : 'rgba(30,22,34,0.8)'; ctx.fill();
  ctx.strokeStyle = PAL.j; ctx.lineWidth = 2.2 * S; ctx.stroke();
  ctx.globalAlpha = 1;
  const iconOf = (k) => (k === 'bomb' ? SPR.bomb : k === 'potion' ? SPR.potion : SPR.gem);
  sprite(ctx, iconOf(item), L.b.x - 10 * S, L.b.y - 12 * S, 2.4 * S);
  txt(ctx, String(cnt), L.b.x + 16 * S, L.b.y + 4 * S, { size: 12 * S, align: 'right', color: cnt > 0 ? UI.ink : '#7c6f84' });

  // 道具の切り替え（次の道具が小さく見えている）
  const order = ['bomb', 'potion'];
  if (p.magic) order.push('magic');
  if (order.length > 1) {
    const next = order[(order.indexOf(item) + 1) % order.length];
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(L.swap.x, L.swap.y, L.swap.r, 0, TAU);
    ctx.fillStyle = 'rgba(30,22,34,0.8)'; ctx.fill();
    ctx.strokeStyle = PAL.w; ctx.lineWidth = 1.6 * S; ctx.stroke();
    ctx.globalAlpha = 0.85;
    sprite(ctx, iconOf(next), L.swap.x - 6 * S, L.swap.y - 7 * S, 1.5 * S);
    ctx.globalAlpha = 1;
    // 循環をあらわす小さな矢印
    ctx.strokeStyle = PAL.x; ctx.lineWidth = 1.2 * S;
    ctx.beginPath();
    ctx.arc(L.swap.x, L.swap.y, L.swap.r - 3 * S, -0.6, 1.6);
    ctx.stroke();
  }
}

function drawSwordIcon(ctx, cx, cy, r) {
  const S = ui.S;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = PAL.x;
  ctx.fillRect(-2 * S, -r, 4 * S, r * 1.5);
  ctx.fillStyle = PAL.y;
  ctx.fillRect(-2 * S, -r, 2 * S, r * 1.5);
  ctx.fillStyle = PAL.s;
  ctx.fillRect(-7 * S, r * 0.5, 14 * S, 3.5 * S);
  ctx.fillStyle = PAL.d;
  ctx.fillRect(-2.5 * S, r * 0.5, 5 * S, r * 0.45);
  ctx.restore();
}

// --- マップ ----------------------------------------------------------------

let mapCanvas = null, mapDirty = true, mapLevelId = null;
export function invalidateMap() { mapDirty = true; }

const MAP_COLOR = {
  grass: '#5f8a4c', forest: '#456a3c', sand: '#deb383', dirt: '#96683f',
  marsh: '#3d5347', ash: '#3a3340', stone: '#5c5c68', water: '#2f5580',
  deep: '#1b3352', floor: '#4a4352', cliff: '#8b8b97', wall: '#2a2233', wallRuin: '#2e2a34',
};

function buildMap(level) {
  const c = makeCanvas(level.w, level.h);
  const x = c.getContext('2d');
  const img = x.createImageData(level.w, level.h);
  for (let i = 0; i < level.w * level.h; i++) {
    const o = i * 4;
    if (!level.explored[i]) { img.data[o + 3] = 0; continue; }
    const hex = MAP_COLOR[TERRAIN_NAME[level.ground[i]]] || '#000';
    img.data[o] = parseInt(hex.slice(1, 3), 16);
    img.data[o + 1] = parseInt(hex.slice(3, 5), 16);
    img.data[o + 2] = parseInt(hex.slice(5, 7), 16);
    img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

export function drawMap(ctx, g) {
  const S = ui.S, W = view.cssW, H = view.cssH;
  const level = g.level;
  if (mapDirty || mapLevelId !== level.id || !mapCanvas) {
    mapCanvas = buildMap(level);
    mapDirty = false; mapLevelId = level.id;
  }
  ctx.fillStyle = 'rgba(6,5,10,0.86)';
  ctx.fillRect(0, 0, W, H);

  const pad = 18 * S;
  const availW = W - pad * 2, availH = H - 150 * S;
  const sc = Math.min(availW / level.w, availH / level.h);
  const mw = level.w * sc, mh = level.h * sc;
  const mx = (W - mw) / 2, my = 90 * S;

  panel(ctx, mx - 8 * S, my - 8 * S, mw + 16 * S, mh + 16 * S, { r: 8 * S });
  ctx.fillStyle = '#15121c';
  ctx.fillRect(mx, my, mw, mh);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(mx + (mw * i) / 6, my); ctx.lineTo(mx + (mw * i) / 6, my + mh);
    ctx.moveTo(mx, my + (mh * i) / 6); ctx.lineTo(mx + mw, my + (mh * i) / 6);
    ctx.stroke();
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mapCanvas, mx, my, mw, mh);

  txt(ctx, level.name || 'マップ', W / 2, 46 * S, { size: 18 * S, align: 'center', color: UI.gold });

  const mark = (tx, ty, color, size = 3.2) => {
    const x = mx + tx * sc, y = my + ty * sc;
    ctx.fillStyle = color;
    ctx.fillRect(x - size * S / 2, y - size * S / 2, size * S, size * S);
  };
  const explored = (tx, ty) => level.explored[ty * level.w + tx];

  if (level.id === 'field') {
    const ow = g.overworld;
    for (const b of level.buildings) if (b.built) mark(b.x + b.w / 2, b.y + b.h / 2, '#e8c46a', 4);
    // ほら穴と門は「行き先」なので未探索でも うっすら見える
    for (const d of ow.dungeons) {
      const seen = explored(d.x, d.y);
      ctx.globalAlpha = seen ? 1 : 0.42;
      mark(d.x, d.y, d.cleared ? '#7fb8d4' : '#d65c4e', seen ? 5 : 4);
      ctx.globalAlpha = 1;
    }
    if (ow.gate) {
      const seen = explored(ow.gate.x, ow.gate.y);
      ctx.globalAlpha = seen ? 1 : 0.42;
      mark(ow.gate.x, ow.gate.y, '#e6c2f5', seen ? 5 : 4);
      ctx.globalAlpha = 1;
    }
    for (const v of ow.villagers) if (!v.freed && explored(v.x, v.y)) mark(v.x, v.y, '#b57ad4', 4);
  } else {
    for (let y = 0; y < level.h; y++)
      for (let x = 0; x < level.w; x++) {
        if (!explored(x, y)) continue;
        const o = level.obj[y * level.w + x];
        if (o === O.CHEST) mark(x, y, '#e8c46a', 3.5);
        else if (o === O.EXIT) mark(x, y, '#7fb8d4', 4);
        else if (o === O.DOOR) mark(x, y, '#d65c4e', 3.5);
      }
  }
  // プレイヤー
  const px = mx + (g.player.x / TILE) * sc, py = my + (g.player.y / TILE) * sc;
  const pulse = 3 + Math.sin(performance.now() / 200) * 1.2;
  ctx.beginPath(); ctx.arc(px, py, pulse * S, 0, TAU);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1 * S; ctx.stroke();

  txt(ctx, `探索 ${mapPercent(level)}%   ⏱ ${formatTime(g.playTime)}`, W / 2, my + mh + 22 * S,
    { size: 12 * S, align: 'center', color: UI.inkDim });
  const obj = g.objectiveText ? g.objectiveText() : '';
  if (obj) txt(ctx, '▶ ' + obj, W / 2, my + mh + 44 * S, { size: 13 * S, align: 'center', color: UI.gold });
  // 凡例
  const leg = [['#e8c46a', '村'], ['#d65c4e', 'ほら穴'], ['#7fb8d4', 'クリア'], ['#b57ad4', '村人'], ['#e6c2f5', '門']];
  let lx = W / 2 - (leg.length * 56 * S) / 2;
  for (const [c, label] of leg) {
    ctx.fillStyle = c;
    ctx.fillRect(lx, my + mh + 70 * S, 6 * S, 6 * S);
    txt(ctx, label, lx + 11 * S, my + mh + 68 * S, { size: 10 * S, color: UI.inkDim, outline: false });
    lx += 56 * S;
  }
  txt(ctx, 'タップでとじる', W / 2, H - ui.padBottom - 34 * S, { size: 12 * S, align: 'center', color: UI.inkDim });
}

function mapPercent(level) {
  let n = 0, tot = level.w * level.h;
  for (let i = 0; i < tot; i++) if (level.explored[i]) n++;
  return Math.round((n / tot) * 100);
}

// --- タイトル --------------------------------------------------------------

export function drawTitle(ctx, g, t, canContinue) {
  const S = ui.S, W = view.cssW, H = view.cssH;
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#151024');
  grd.addColorStop(0.55, '#241a2e');
  grd.addColorStop(1, '#3a2a30');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // 星
  for (let i = 0; i < 60; i++) {
    const x = ((i * 9973) % 1000) / 1000 * W;
    const y = ((i * 7919) % 700) / 1000 * H;
    const a = 0.3 + 0.7 * Math.abs(Math.sin(t * 0.8 + i));
    ctx.globalAlpha = a * 0.7;
    ctx.fillStyle = i % 5 === 0 ? '#e8c46a' : '#ffffff';
    ctx.fillRect(x, y, 2 * S, 2 * S);
  }
  ctx.globalAlpha = 1;

  // 丘のシルエット
  ctx.fillStyle = '#1c1526';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.72);
  for (let x = 0; x <= W; x += 8) {
    ctx.lineTo(x, H * 0.72 + Math.sin(x / 90 + 1.2) * 18 * S + Math.sin(x / 33) * 5 * S);
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#120d19';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.82);
  for (let x = 0; x <= W; x += 8) ctx.lineTo(x, H * 0.82 + Math.sin(x / 60 + 3) * 12 * S);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

  // 主人公
  const hx = W / 2, hy = H * 0.735 + Math.sin(t * 2) * 1.5;
  ctx.imageSmoothingEnabled = false;
  const scale = 4 * S;
  ctx.drawImage(SPR.hero[3][Math.floor(t * 2) % 2], hx - 8 * scale, hy - 16 * scale, 16 * scale, 16 * scale);

  txt(ctx, 'AFTERGROVE', W / 2, H * 0.20, { size: 34 * S, align: 'center', color: '#e8c46a', weight: 800 });
  txt(ctx, 'アフターグローヴ', W / 2, H * 0.20 + 42 * S, { size: 13 * S, align: 'center', color: '#c2b8a4' });
  txt(ctx, '— ちいさな村を、もういちど —', W / 2, H * 0.20 + 64 * S, { size: 11 * S, align: 'center', color: '#8d8496' });

  const bw = Math.min(240 * S, W - 60 * S), bh = 46 * S;
  const bx = (W - bw) / 2;
  let by = H * 0.50;
  const btn = (label, sub, y, hot) => {
    panel(ctx, bx, y, bw, bh, { r: 10 * S, fill: hot ? 'rgba(90,70,110,0.92)' : 'rgba(24,19,32,0.9)', edge: hot ? UI.gold : UI.panelEdge });
    txt(ctx, label, W / 2, y + (sub ? 8 * S : 14 * S), { size: 15 * S, align: 'center', color: UI.ink, outline: false });
    if (sub) txt(ctx, sub, W / 2, y + 27 * S, { size: 10.5 * S, align: 'center', color: UI.inkDim, outline: false });
  };
  if (canContinue) {
    btn('つづきから', g.saveSummary || '', by, true);
    btn('はじめから', 'あたらしい世界で遊ぶ', by + bh + 12 * S, false);
  } else {
    btn('はじめる', 'タップしてスタート', by, true);
  }

  txt(ctx, 'ドラッグで移動 ・ タップで斬る ・ 長押しでためる',
    W / 2, H - ui.padBottom - 44 * S, { size: 11 * S, align: 'center', color: '#9a90a6' });
}

export function titleButtons(canContinue) {
  const S = ui.S, W = view.cssW, H = view.cssH;
  const bw = Math.min(240 * S, W - 60 * S), bh = 46 * S;
  const bx = (W - bw) / 2;
  const by = H * 0.50;
  const list = [{ id: 'title0', x: W / 2, y: by + bh / 2, hw: bw / 2, hh: bh / 2 }];
  if (canContinue) list.push({ id: 'title1', x: W / 2, y: by + bh + 12 * S + bh / 2, hw: bw / 2, hh: bh / 2 });
  return list;
}

// --- ゲームオーバー／エンディング ------------------------------------------

export function drawGameOver(ctx, g, t) {
  const S = ui.S, W = view.cssW, H = view.cssH;
  ctx.fillStyle = `rgba(10,6,12,${clamp(t / 1.2, 0, 0.86)})`;
  ctx.fillRect(0, 0, W, H);
  if (t < 0.5) return;
  txt(ctx, 'ちからつきた…', W / 2, H * 0.36, { size: 26 * S, align: 'center', color: UI.red });
  txt(ctx, '村のベッドで目をさました。', W / 2, H * 0.36 + 38 * S, { size: 12 * S, align: 'center', color: UI.inkDim });
  txt(ctx, `もっていたコインを すこし落とした`, W / 2, H * 0.36 + 58 * S, { size: 11 * S, align: 'center', color: UI.inkDim });
  const bw = Math.min(220 * S, W - 70 * S), bh = 44 * S;
  panel(ctx, (W - bw) / 2, H * 0.60, bw, bh, { r: 10 * S, fill: 'rgba(90,70,110,0.92)', edge: UI.gold });
  txt(ctx, '村へもどる', W / 2, H * 0.60 + 13 * S, { size: 15 * S, align: 'center', color: UI.ink, outline: false });
}

export function gameOverButtons() {
  const S = ui.S, W = view.cssW, H = view.cssH;
  const bw = Math.min(220 * S, W - 70 * S), bh = 44 * S;
  return [{ id: 'revive', x: W / 2, y: H * 0.60 + bh / 2, hw: bw / 2, hh: bh / 2 }];
}

export function drawEnding(ctx, g, t) {
  const S = ui.S, W = view.cssW, H = view.cssH;
  ctx.fillStyle = `rgba(8,6,14,${clamp(t / 1.5, 0, 0.94)})`;
  ctx.fillRect(0, 0, W, H);
  if (t < 0.6) return;
  for (let i = 0; i < 40; i++) {
    const x = ((i * 6151) % 1000) / 1000 * W;
    const y = (((i * 3571) % 1000) / 1000 * H + t * 20) % H;
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t + i);
    ctx.fillStyle = '#e8c46a';
    ctx.fillRect(x, y, 2 * S, 2 * S);
  }
  ctx.globalAlpha = 1;
  txt(ctx, '夜が明けた', W / 2, H * 0.28, { size: 28 * S, align: 'center', color: UI.gold });
  const lines = [
    'かがやきが 谷にもどり、',
    'アフターグローヴ に 人のこえが かえってきた。',
    '',
    `救った村人  ${g.rescued} 人`,
    `建てた家    ${g.overworld.level.buildings.filter(b => b.built).length} けん`,
    `たおした敵  ${g.kills}`,
    `あつめたコイン  ${g.player.coins}`,
    `かかった時間  ${formatTime(g.playTime)}`,
  ];
  lines.forEach((l, i) => txt(ctx, l, W / 2, H * 0.40 + i * 22 * S, {
    size: i >= 3 ? 13 * S : 13.5 * S, align: 'center', color: i >= 3 ? UI.ink : UI.inkDim,
  }));
  txt(ctx, 'タップでタイトルへ', W / 2, H - ui.padBottom - 50 * S, { size: 12 * S, align: 'center', color: UI.inkDim });
}
