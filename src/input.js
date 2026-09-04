// ---------------------------------------------------------------------------
// input.js — 片手操作用の入力（フローティング仮想スティック＋ボタン＋キーボード）
// ---------------------------------------------------------------------------
import { clamp } from './util.js';
import { view } from './render.js';

const STICK_MAX = 34;        // CSS px。ここまで倒すと最大速度
const STICK_DEAD = 5;
const CHARGE_HOLD = 0.42;    // その場でこれ以上押し続けたら「ため」
const SWIPE_DIST = 42;       // この距離を
const SWIPE_TIME = 0.13;     // この時間内に動かしたら「はらい」＝ローリング
const SWIPE_COOL = 0.34;
let gestureTap = false, gestureCharge = false;
let swipeVec = null, swipeCool = 0;

export const input = {
  // 移動ベクトル (-1..1)
  mx: 0, my: 0, mlen: 0,
  // ボタン状態
  a: false, aPressed: false, aReleased: false, aHold: 0,
  b: false, bPressed: false,
  menuPressed: false, mapPressed: false,
  // その他
  anyPressed: false,
  taps: [],                  // {x,y} 画面座標（CSS px）
  stick: { active: false, ox: 0, oy: 0, x: 0, y: 0, id: -1 },
  // 片手ジェスチャ：その場で押す＝攻撃／長押し＝ためる／ドラッグ＝移動
  gHeld: 0,          // 押している時間（動かしていないあいだだけ伸びる）
  gStill: false,     // いま「その場押し」状態か
  gTap: false,       // この 1 フレームで軽いタップとして離された
  gCharge: false,    // この 1 フレームで「ためた状態」から離された
  swipeX: 0, swipeY: 0, swiped: false,   // すばやく払った＝回避
  buttons: [],               // {id, x, y, r}（毎フレーム UI が登録）
  pressedIds: new Set(),     // このフレームに押されたボタン ID
  usingTouch: false,
  stickEnabled: true,   // メニュー表示中は false にしてタップ扱いにする
};

const keys = new Set();
const pointers = new Map(); // id -> {role, btn, sx, sy, x, y}
let canvasEl = null;
let prevA = false, prevB = false;
let touchA = false, touchB = false;   // タッチ由来の押下（キーボードと混ざらないよう分離）
const pressedThisFrame = new Set();

export function setButtons(list) { input.buttons = list; }

function hitButton(x, y) {
  // 後ろに登録されたものを優先（手前に描かれる想定）
  for (let i = input.buttons.length - 1; i >= 0; i--) {
    const b = input.buttons[i];
    const dx = x - b.x, dy = y - b.y;
    if (b.r != null) { if (dx * dx + dy * dy <= b.r * b.r) return b; }
    else if (Math.abs(dx) <= b.hw && Math.abs(dy) <= b.hh) return b;
  }
  return null;
}

function localPos(e) {
  const r = canvasEl.getBoundingClientRect();
  // 座標系は「ゲーム領域の左上が原点」に揃える（横長画面の黒帯ぶんを引く）
  return { x: e.clientX - r.left - view.ox, y: e.clientY - r.top - view.oy };
}

function onDown(e) {
  if (e.pointerType === 'touch') input.usingTouch = true;
  const p = localPos(e);
  const btn = hitButton(p.x, p.y);
  if (btn) {
    pointers.set(e.pointerId, { role: 'btn', btn: btn.id, ...p });
    pressedThisFrame.add(btn.id);
    if (btn.id === 'a') touchA = true;
    if (btn.id === 'b') touchB = true;
    input.anyPressed = true;
    return;
  }
  // スティックは画面下 2/3 のどこからでも出せる
  if (input.stickEnabled && !input.stick.active && p.y > view.cssH * 0.34) {
    input.stick.active = true;
    input.stick.id = e.pointerId;
    input.stick.ox = p.x; input.stick.oy = p.y;
    input.stick.x = p.x; input.stick.y = p.y;
    input.gHeld = 0; input.gStill = true;
    pointers.set(e.pointerId, { role: 'stick', sx: p.x, sy: p.y, t0: performance.now(), far: 0, hist: [{ x: p.x, y: p.y, t: performance.now() / 1000 }], ...p });
    input.anyPressed = true;
    return;
  }
  pointers.set(e.pointerId, { role: 'tap', sx: p.x, sy: p.y, ...p });
  input.anyPressed = true;
}

function onMove(e) {
  const rec = pointers.get(e.pointerId);
  if (!rec) return;
  const p = localPos(e);
  rec.x = p.x; rec.y = p.y;
  if (rec.role === 'stick') {
    input.stick.x = p.x; input.stick.y = p.y;
    rec.far = Math.max(rec.far || 0, Math.hypot(p.x - rec.sx, p.y - rec.sy));
    // すばやい払いを拾う（ふつうの操作より明らかに速い動きだけ）
    const now = performance.now() / 1000;
    rec.hist.push({ x: p.x, y: p.y, t: now });
    while (rec.hist.length > 2 && now - rec.hist[0].t > SWIPE_TIME) rec.hist.shift();
    if (swipeCool <= 0 && rec.hist.length > 1) {
      const a = rec.hist[0];
      const dx = p.x - a.x, dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      const dt = Math.max(0.016, now - a.t);
      if (d > SWIPE_DIST && d / dt > 330) {
        swipeVec = { x: dx / d, y: dy / d };
        swipeCool = SWIPE_COOL;
        rec.hist.length = 0;
        rec.hist.push({ x: p.x, y: p.y, t: now });
      }
    }
    let dx = p.x - input.stick.ox, dy = p.y - input.stick.oy;
    const len = Math.hypot(dx, dy);
    // 大きく倒したら原点を引きずる（指がずれても操作を続けられる）
    if (len > STICK_MAX) {
      input.stick.ox += dx * (1 - STICK_MAX / len);
      input.stick.oy += dy * (1 - STICK_MAX / len);
      dx = p.x - input.stick.ox; dy = p.y - input.stick.oy;
    }
  }
}

function onUp(e) {
  const rec = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!rec) return;
  if (rec.role === 'stick') {
    input.stick.active = false;
    input.stick.id = -1;
    const held = (performance.now() - (rec.t0 || 0)) / 1000;
    if ((rec.far || 0) < 14) {
      if (input.gHeld >= CHARGE_HOLD) gestureCharge = true;
      else if (held < 0.45) gestureTap = true;
    }
    input.gHeld = 0; input.gStill = false;
  } else if (rec.role === 'btn') {
    // 同じボタンを押している別の指がなければ離す
    let still = false;
    for (const r of pointers.values()) if (r.role === 'btn' && r.btn === rec.btn) still = true;
    if (!still) {
      if (rec.btn === 'a') touchA = false;
      if (rec.btn === 'b') touchB = false;
    }
  } else if (rec.role === 'tap') {
    const moved = Math.hypot(rec.x - rec.sx, rec.y - rec.sy);
    if (moved < 18) input.taps.push({ x: rec.x, y: rec.y });
  }
}

const KEY_A = new Set(['Space', 'KeyJ', 'KeyZ', 'Enter']);
const KEY_B = new Set(['KeyK', 'KeyX']);
const KEY_ROLL = new Set(['ShiftLeft', 'ShiftRight', 'KeyC', 'KeyL']);
const KEY_MENU = new Set(['Escape', 'KeyP']);
const KEY_MAP = new Set(['KeyM', 'Tab']);

export function initInput(canvas) {
  canvasEl = canvas;
  const opt = { passive: false };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    onDown(e);
  }, opt);
  canvas.addEventListener('pointermove', (e) => { e.preventDefault(); onMove(e); }, opt);
  canvas.addEventListener('pointerup', (e) => { e.preventDefault(); onUp(e); }, opt);
  canvas.addEventListener('pointercancel', (e) => { onUp(e); }, opt);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => {
    pointers.clear(); keys.clear();
    touchA = touchB = false;
    input.a = input.b = false; input.stick.active = false;
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (KEY_A.has(e.code) || KEY_B.has(e.code) || KEY_MENU.has(e.code) || KEY_MAP.has(e.code)
        || e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (KEY_MENU.has(e.code)) pressedThisFrame.add('menu');
    if (KEY_MAP.has(e.code)) pressedThisFrame.add('map');
    if (KEY_ROLL.has(e.code)) pressedThisFrame.add('roll');
    input.anyPressed = true;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
}

/** 毎フレーム先頭で呼ぶ */
export function updateInput(dt) {
  // --- 移動 ---
  let mx = 0, my = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
  let len = Math.hypot(mx, my);
  if (len > 0) { mx /= len; my /= len; len = 1; }

  if (input.stick.active) {
    const dx = input.stick.x - input.stick.ox;
    const dy = input.stick.y - input.stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_DEAD) {
      const t = clamp((d - STICK_DEAD) / (STICK_MAX - STICK_DEAD), 0, 1);
      mx = (dx / d) * t; my = (dy / d) * t;
      len = t;
    } else { mx = 0; my = 0; len = 0; }
  }
  input.mx = mx; input.my = my; input.mlen = len;

  // 片手ジェスチャの状態更新
  if (input.stick.active) {
    const rec = pointers.get(input.stick.id);
    const far = rec ? (rec.far || 0) : 99;
    if (far < 14 && len < 0.18) { input.gHeld += dt; input.gStill = true; }
    else { input.gHeld = 0; input.gStill = false; }
  }
  input.gTap = gestureTap; gestureTap = false;
  input.gCharge = gestureCharge; gestureCharge = false;

  // 回避の入力（払い または キー）
  swipeCool = Math.max(0, swipeCool - dt);
  if (swipeVec) {
    input.swiped = true; input.swipeX = swipeVec.x; input.swipeY = swipeVec.y;
    swipeVec = null;
  } else if (pressedThisFrame.has('roll') || pressedThisFrame.has('roll-btn')) {
    input.swiped = true;
    const l = Math.hypot(mx, my);
    input.swipeX = l > 0.1 ? mx / l : 0;
    input.swipeY = l > 0.1 ? my / l : 1;
  } else {
    input.swiped = false;
  }

  // --- ボタン ---
  let keyA = false, keyB = false;
  for (const k of keys) { if (KEY_A.has(k)) keyA = true; if (KEY_B.has(k)) keyB = true; }
  // 1 フレームより短いタップも取りこぼさないよう、押下は必ず 1 度は拾う
  const aNow = touchA || keyA || pressedThisFrame.has('a');
  const bNow = touchB || keyB || pressedThisFrame.has('b');
  input.aPressed = aNow && !prevA;
  input.aReleased = !aNow && prevA;
  input.bPressed = bNow && !prevB;
  input.aHold = aNow ? input.aHold + dt : 0;
  prevA = aNow; prevB = bNow;
  input.a = aNow; input.b = bNow;

  input.menuPressed = pressedThisFrame.has('menu');
  input.mapPressed = pressedThisFrame.has('map');
  input.pressedIds = pressedThisFrame;
}

/** 毎フレーム末尾で呼ぶ */
export function endInputFrame() {
  input.taps.length = 0;
  input.anyPressed = false;
  pressedThisFrame.clear();
}

/** メニュー等で入力状態をリセット */
export function resetInput() {
  input.aPressed = input.bPressed = input.aReleased = false;
  input.aHold = 0;
  input.taps.length = 0;
}

/** ボタンの押しっぱなしを打ち切る（画面遷移時など） */
export function clearHeld() {
  touchA = touchB = false;
  gestureTap = gestureCharge = false;
  swipeVec = null;
  input.gTap = input.gCharge = false;
  input.swiped = false;
  input.gHeld = 0; input.gStill = false;
  prevA = prevB = true;   // 次フレームで pressed が立たないように
  input.a = input.b = false;
  input.aHold = 0;
}

