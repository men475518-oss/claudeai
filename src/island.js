// ---------------------------------------------------------------------------
// island.js — 島を「タイルの集まり」ではなく「なめらかな一枚の形」として描く
//   輪郭は多角形で持ち、当たり判定だけタイルへ焼きこむ。
//   これで 16px 刻みのギザギザが消え、参考画面のやわらかい島に近づく。
// ---------------------------------------------------------------------------
import { TILE } from './config.js';
import { makeCanvas } from './art.js';
import { makeRng, fbm, hash2, TAU } from './util.js';

const DV = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

// 参考画面から拾った色
const C = {
  base:   '#3f9b4e',
  dark:   '#379046',
  light:  '#4aa858',
  rim1:   '#2f7d40',
  rim2:   '#276a38',
  hedgeD: '#1d5029',
  hedgeA: '#46a054',
  hedgeB: '#52ad5f',
  path:   '#9a9060',
  pathIn: '#b0a56e',
  water:  '#3f6f9e',
  waterD: '#33608c',
  waterL: '#5f93c0',
};

// 島の種類ごとの 色あい（書いていない色は 上の C をそのまま使う）
const THEMES = {
  ash: {
    base: '#6d6a5c', dark: '#5f5c4f', light: '#7c7969',
    rim1: '#4b4940', rim2: '#3b3a33',
    hedgeD: '#33322b', hedgeA: '#6a6759', hedgeB: '#787565',
    path: '#8a8474', pathIn: '#9c9683',
  },
  graveyard: {
    base: '#3a7b57', dark: '#33704f', light: '#458a62',
    rim1: '#2a6244', rim2: '#22513a',
    hedgeD: '#173f2b', hedgeA: '#3d8459', hedgeB: '#478f63',
    path: '#8d876c', pathIn: '#a29b7b',
  },
  ruins: {
    base: '#61915a', dark: '#578653', light: '#6d9d63',
    rim1: '#457244', rim2: '#385f38',
    hedgeD: '#254a2c', hedgeA: '#5f9257', hedgeB: '#6b9e61',
  },
  rocks: {
    base: '#4f8f5b', dark: '#458452', light: '#5c9c65',
    rim1: '#376f45', rim2: '#2c5c3a',
  },
  mushroom: {
    base: '#48915a', dark: '#3f8752', light: '#529d63',
    rim1: '#2f7448', rim2: '#26603c',
    hedgeD: '#1c4c2e', hedgeA: '#4c9b5e', hedgeB: '#58a76a',
  },
  swamp: {
    base: '#3d8459', dark: '#347951', light: '#4a9163',
    rim1: '#2a6a47', rim2: '#22563b',
  },
};

function theme(kind) {
  const t = THEMES[kind];
  return t ? { ...C, ...t } : C;
}

/**
 * 島の形をつくる。すべてピクセル座標。
 * @returns {{poly, corridors, curves, patches, pools, cx, cy}}
 */
export function makeIslandShape(room, W, H, exits, opts = {}) {
  const rng = makeRng((room.seed ^ 0x15A1D) >>> 0);
  const w = W * TILE, h = H * TILE;
  const cx = w / 2, cy = h / 2;
  const flat = !!opts.flat;

  const rx = w / 2 - TILE * 1.9;
  const ry = h / 2 - TILE * 2.0;
  const power = flat ? 3.2 : 1.85 + rng() * 0.55;
  const wob = flat ? 0.05 : 0.16 + rng() * 0.08;

  // 角度ごとの半径。まるみのあるひし形に ゆらぎを足す。
  const N = 96;
  const poly = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    // |x/rx|^p + |y/ry|^p = 1 を満たす半径
    const denom = Math.pow(Math.abs(ca) / rx, power) + Math.pow(Math.abs(sa) / ry, power);
    let r = Math.pow(denom, -1 / power);
    r *= 1 + (fbm(ca * 1.7 + 5, sa * 1.7 + 5, room.seed) - 0.5) * 2 * wob;
    poly.push({ x: cx + ca * r, y: cy + sa * r });
  }
  smoothPoly(poly, 2);

  // --- 出口へのびる首と、そこへ向かう小道 ---
  const corridors = [];
  const curves = [];
  const half = TILE * 1.15;
  for (const dir of Object.keys(exits)) {
    if (!exits[dir]) continue;
    const [dx, dy] = DV[dir];
    // 輪郭のどこまで島があるか
    let edge = 0;
    for (let t = 0; t < Math.max(w, h); t += 4) {
      if (!pointInPoly(poly, cx + dx * t, cy + dy * t)) { edge = t; break; }
    }
    const inset = Math.max(0, edge - TILE);
    if (dx !== 0) {
      const x0 = dx > 0 ? cx + inset : 0;
      const x1 = dx > 0 ? w : cx - inset;
      corridors.push({ x: Math.min(x0, x1), y: cy - half, w: Math.abs(x1 - x0), h: half * 2, r: half });
    } else {
      const y0 = dy > 0 ? cy + inset : 0;
      const y1 = dy > 0 ? h : cy - inset;
      corridors.push({ x: cx - half, y: Math.min(y0, y1), w: half * 2, h: Math.abs(y1 - y0), r: half });
    }
    // 小道は 広場から 出口へ ゆるく曲がって伸びる
    const end = { x: cx + dx * (w / 2 + TILE), y: cy + dy * (h / 2 + TILE) };
    const bend = (rng() - 0.5) * TILE * 3.4;
    const off = TILE * 0.9;
    const start = { x: cx + dx * off + (dx !== 0 ? 0 : (rng() - 0.5) * off), y: cy + dy * off + (dy !== 0 ? 0 : (rng() - 0.5) * off) };
    const mid = {
      x: (start.x + end.x) / 2 + (dx !== 0 ? 0 : bend),
      y: (start.y + end.y) / 2 + (dy !== 0 ? 0 : bend),
    };
    curves.push([start, mid, end]);
  }

  // --- 草の明暗パッチ ---
  const patches = [];
  for (let i = 0; i < 9; i++) {
    const a = rng.angle();
    const d = rng() * Math.min(rx, ry) * 0.85;
    patches.push({
      x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
      r: TILE * (1.6 + rng() * 2.4), dark: rng() < 0.55, seed: (rng() * 1e6) | 0,
    });
  }

  return { poly, corridors, curves, patches, pools: [], cx, cy, w, h };
}

/** 島の形を タイルの通行判定へ焼きこむ */
export function rasterizeIsland(lv, shape, T) {
  for (let y = 0; y < lv.h; y++) {
    for (let x = 0; x < lv.w; x++) {
      const px = x * TILE + TILE / 2, py = y * TILE + TILE / 2;
      let inside = pointInPoly(shape.poly, px, py);
      if (!inside) {
        for (const r of shape.corridors) {
          const rad = Math.min(r.r || 8, r.w / 2, r.h / 2);
          const qx = Math.max(r.x + rad, Math.min(px, r.x + r.w - rad));
          const qy = Math.max(r.y + rad, Math.min(py, r.y + r.h - rad));
          if (Math.hypot(px - qx, py - qy) <= rad) { inside = true; break; }
        }
      }
      lv.setG(x, y, inside ? T.MOSS : T.VOID);
    }
  }
  // 小道の上は 歩きやすい床（音や見た目の区別に使う）
  for (const cur of shape.curves) {
    for (let t = 0; t <= 1.001; t += 0.02) {
      const p = quadAt(cur, t);
      const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      if (lv.inb(tx, ty) && lv.g(tx, ty) === T.MOSS) lv.setG(tx, ty, T.PATH);
    }
  }
}

/**
 * 「ここには 物を置かない」場所。首の中と 小道のまわり。
 * ふさぐと 通れなくなって 詰まるので、飾りも敵も ここには 置かない。
 * 地形そのものは 変えないので 見た目は そのまま。
 */
export function keepClearTiles(shape, lv) {
  const set = new Set();
  const add = (tx, ty) => { if (lv.inb(tx, ty)) set.add(ty * lv.w + tx); };
  for (const r of shape.corridors) {
    const x0 = Math.floor(r.x / TILE), x1 = Math.ceil((r.x + r.w) / TILE) - 1;
    const y0 = Math.floor(r.y / TILE), y1 = Math.ceil((r.y + r.h) / TILE) - 1;
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) add(tx, ty);
  }
  for (const cur of shape.curves) {
    for (let t = 0; t <= 1.001; t += 0.02) {
      const p = quadAt(cur, t);
      const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      add(tx, ty);
      add(tx + 1, ty); add(tx - 1, ty); add(tx, ty + 1); add(tx, ty - 1);
    }
  }
  return set;
}

/** 池をあける（見た目と当たり判定の両方） */
/** 小道からいちばん離れた 池の置き場をさがす（タイル座標）*/
export function poolSpot(shape, rT) {
  const need = (rT + 1.2) * TILE;
  let best = null;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    for (const rad of [3.6, 3.0, 2.4]) {
      const x = shape.cx + Math.cos(a) * rad * TILE;
      const y = shape.cy + Math.sin(a) * rad * TILE;
      // 島から はみ出さないか（8方向を見る）
      let inside = true;
      for (let k = 0; k < 8 && inside; k++) {
        const b = (k / 8) * TAU;
        if (!pointInPoly(shape.poly, x + Math.cos(b) * need, y + Math.sin(b) * need)) inside = false;
      }
      if (!inside) continue;
      // 小道からの距離
      let far = Infinity;
      for (const cur of shape.curves)
        for (let t = 0; t <= 1.0001; t += 1 / 14) {
          const q = quadAt(cur, t);
          far = Math.min(far, Math.hypot(q.x - x, q.y - y));
        }
      if (!best || far > best.far) best = { x, y, far };
    }
  }
  if (!best) return { x: Math.round(shape.cx / TILE) + 1, y: Math.round(shape.cy / TILE) + 2 };
  return { x: Math.round((best.x - 8) / TILE), y: Math.round((best.y - 8) / TILE) };
}

export function addPool(lv, shape, T, cxT, cyT, rT, seed) {
  const cx = cxT * TILE + 8, cy = cyT * TILE + 8;
  shape.pools.push({ x: cx, y: cy, r: rT * TILE, seed });
  for (let y = 0; y < lv.h; y++)
    for (let x = 0; x < lv.w; x++) {
      const px = x * TILE + 8, py = y * TILE + 8;
      const d = Math.hypot((px - cx) / 1.15, (py - cy) * 1.15 / 1) / TILE;
      const n = (fbm(x * 0.45, y * 0.45, seed) - 0.5) * 1.1;
      // 広場（島のまんなか）と 小道は 水にしない
      const fromMiddle = Math.hypot(px - shape.cx, py - shape.cy) / TILE;
      if (fromMiddle < 2.6) continue;
      if (d + n < rT && lv.g(x, y) !== T.VOID && lv.g(x, y) !== T.PATH) lv.setG(x, y, T.WATER);
    }
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

export function renderIslandCanvas(shape, room) {
  const { w, h, cx, cy } = shape;
  const C = theme(room.kind);
  const cv = makeCanvas(w, h);
  const c = cv.getContext('2d');

  const outline = () => {
    c.beginPath();
    tracePoly(c, shape.poly);
    for (const r of shape.corridors) capsule(c, r);
  };

  // --- 島の下に落ちる影（ぼかして「浮いている」ように）---
  c.save();
  c.shadowColor = 'rgba(4,14,12,0.85)';
  c.shadowBlur = 18;
  c.shadowOffsetY = 7;
  outline();
  c.fillStyle = 'rgba(4,14,12,0.9)';
  c.fill();
  c.shadowBlur = 34; c.shadowOffsetY = 12;
  c.fill();
  c.restore();

  // --- 中身 ---
  c.save();
  outline();
  c.clip();

  c.fillStyle = C.base;
  c.fillRect(0, 0, w, h);

  // 大きくやわらかい明暗
  for (const p of shape.patches) {
    c.fillStyle = p.dark ? C.dark : C.light;
    blobPath(c, p.x, p.y, p.r, p.seed);
    c.fill();
  }

  // まんなかのやわらかい光
  const gr = c.createRadialGradient(cx, cy - h * 0.05, 0, cx, cy - h * 0.05, Math.max(w, h) * 0.40);
  gr.addColorStop(0, 'rgba(255,255,255,0.085)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, w, h);

  // ほんのりの粒（近づかないと分からないくらい）
  const img = c.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i / w) | 0;
    const r = hash2(x, y, room.seed);
    if (r > 0.955) { const o = i * 4; img.data[o] += 8; img.data[o + 1] += 10; img.data[o + 2] += 6; }
    else if (r < 0.045) { const o = i * 4; img.data[o] -= 8; img.data[o + 1] -= 9; img.data[o + 2] -= 6; }
  }
  c.putImageData(img, 0, 0);

  // ふちの濃い緑（内側だけ見えるよう 太めに ストローク）。
  // うすい層を重ねて、島がすこし ふくらんで見えるようにする。
  c.lineJoin = 'round';
  c.globalAlpha = 0.35; c.lineWidth = 40; c.strokeStyle = C.rim1; outline(); c.stroke();
  c.globalAlpha = 0.55; c.lineWidth = 24; c.strokeStyle = C.rim1; outline(); c.stroke();
  c.globalAlpha = 1;
  c.lineWidth = 14; c.strokeStyle = C.rim1; outline(); c.stroke();
  c.lineWidth = 6;  c.strokeStyle = C.rim2; outline(); c.stroke();

  // 池（小道より先に。道は池の上を わたる）
  for (const p of shape.pools) drawPool(c, p, C);

  // 小道
  c.lineCap = 'round'; c.lineJoin = 'round';
  // まんなかの広場
  c.fillStyle = C.path;
  blobPath(c, cx, cy, TILE * 1.3, room.seed + 21);
  c.fill();
  for (const cur of shape.curves) { c.lineWidth = 14; c.strokeStyle = C.path; strokeQuad(c, cur); }
  for (const cur of shape.curves) { c.lineWidth = 8; c.strokeStyle = C.pathIn; strokeQuad(c, cur); }

  c.restore();

  // --- 生け垣（輪郭の上にのせる）---
  drawHedge(c, shape, room.seed, C);
  return cv;
}

function drawPool(c, p, C) {
  c.save();
  blobPath(c, p.x, p.y, p.r, p.seed, 0.9, 1.25);
  c.fillStyle = '#2b5a44';
  c.fill();
  c.clip();
  blobPath(c, p.x, p.y, p.r - 1.5, p.seed, 0.9, 1.25);
  c.fillStyle = '#57937f'; c.fill();
  blobPath(c, p.x, p.y, p.r - 4, p.seed, 0.9, 1.25);
  c.fillStyle = C.water; c.fill();
  c.fillStyle = C.waterD;
  blobPath(c, p.x, p.y + p.r * 0.25, p.r * 0.7, p.seed + 3, 0.9, 1.25);
  c.fill();
  c.fillStyle = C.waterL;
  c.globalAlpha = 0.55;
  for (let i = 0; i < 7; i++) {
    const j = hash2(i, 4, p.seed);
    const yy = p.y - p.r * 0.62 + i * (p.r * 0.23) + j * 2;
    const xx = p.x - p.r * 0.5 + hash2(i, 5, p.seed) * p.r * 0.7;
    c.fillRect(xx, yy, 3 + j * 5, 1);
  }
  c.globalAlpha = 1;
  c.restore();
}

/** 輪郭にそって こんもりした葉をならべる */
function drawHedge(c, shape, seed, C) {
  const pts = resample(shape.poly, 5.5);
  const corridorNear = (x, y) => shape.corridors.some(r =>
    x > r.x - 3 && x < r.x + r.w + 3 && y > r.y - 3 && y < r.y + r.h + 3);

  const bumps = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (corridorNear(p.x, p.y)) continue;
    const j = hash2(i, 1, seed);
    bumps.push({ x: p.x + (j - 0.5) * 1.8, y: p.y + (hash2(i, 2, seed) - 0.5) * 1.8, r: 2.6 + j * 1.3, i });
  }
  // 首のふちにも すこしだけ
  for (const r of shape.corridors) {
    const vertical = r.h > r.w;
    const n = Math.floor((vertical ? r.h : r.w) / 5.5);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      for (const side of [-1, 1]) {
        const x = vertical ? (side < 0 ? r.x : r.x + r.w) : r.x + r.w * t;
        const y = vertical ? r.y + r.h * t : (side < 0 ? r.y : r.y + r.h);
        if (pointInPoly(shape.poly, x, y)) continue;
        const j = hash2(k, side + 5, seed);
        bumps.push({ x: x + (j - 0.5) * 1.6, y: y + (hash2(k, 7, seed) - 0.5) * 1.6, r: 2.6 + j * 1.3, i: k });
      }
    }
  }

  c.fillStyle = C.hedgeD;
  for (const b of bumps) { c.beginPath(); c.arc(b.x, b.y, b.r + 1.4, 0, TAU); c.fill(); }
  for (const b of bumps) {
    c.fillStyle = hash2(b.i, 9, seed) < 0.5 ? C.hedgeA : C.hedgeB;
    c.beginPath(); c.arc(b.x, b.y - 0.6, b.r, 0, TAU); c.fill();
  }
}

// --- 幾何のこまごま -----------------------------------------------------------

function smoothPoly(p, times) {
  for (let t = 0; t < times; t++) {
    const copy = p.map(v => ({ ...v }));
    for (let i = 0; i < p.length; i++) {
      const a = copy[(i - 1 + p.length) % p.length];
      const b = copy[i];
      const d = copy[(i + 1) % p.length];
      p[i].x = (a.x + b.x * 2 + d.x) / 4;
      p[i].y = (a.y + b.y * 2 + d.y) / 4;
    }
  }
}

/** 角のまるい長方形（島の首）*/
function capsule(c, r) {
  const rad = Math.min(r.r || 8, r.w / 2, r.h / 2);
  c.moveTo(r.x + rad, r.y);
  c.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  c.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  c.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  c.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  c.closePath();
}

function tracePoly(c, p) {
  c.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    c.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  c.closePath();
}

function pointInPoly(p, x, y) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i].y > y) !== (p[j].y > y)
      && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) inside = !inside;
  }
  return inside;
}

function resample(p, step) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 0; k < n; k++) {
      out.push({ x: a.x + (b.x - a.x) * (k / n), y: a.y + (b.y - a.y) * (k / n) });
    }
  }
  return out;
}

function quadAt(cur, t) {
  const [a, b, d] = cur;
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * b.x + t * t * d.x, y: u * u * a.y + 2 * u * t * b.y + t * t * d.y };
}

function strokeQuad(c, cur) {
  c.beginPath();
  c.moveTo(cur[0].x, cur[0].y);
  c.quadraticCurveTo(cur[1].x, cur[1].y, cur[2].x, cur[2].y);
  c.stroke();
}

function blobPath(c, x, y, r, seed, sx = 1, sy = 1) {
  const N = 30;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const rr = r * (0.78 + fbm(Math.cos(a) * 1.1 + 9, Math.sin(a) * 1.1 + 9, seed) * 0.48);
    pts.push({ x: x + Math.cos(a) * rr * sx, y: y + Math.sin(a) * rr / sy });
  }
  smoothPoly(pts, 3);
  c.beginPath();
  tracePoly(c, pts);
}

export { pointInPoly };
