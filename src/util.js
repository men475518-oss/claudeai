// ---------------------------------------------------------------------------
// util.js — 数学・乱数・ノイズなどの小さな道具箱
// ---------------------------------------------------------------------------

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** 値を目標へ一定速度で近づける（フレーム時間つき） */
export function approach(v, target, step) {
  if (v < target) return Math.min(v + step, target);
  if (v > target) return Math.max(v - step, target);
  return target;
}

export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** -PI..PI に正規化 */
export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/** 矩形同士の重なり判定（中心座標＋半幅） */
export function overlaps(ax, ay, ahw, ahh, bx, by, bhw, bhh) {
  return Math.abs(ax - bx) < ahw + bhw && Math.abs(ay - by) < ahh + bhh;
}

/** イージング */
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// --- 決定論的乱数 (mulberry32) -------------------------------------------

export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.irange = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  rng.angle = () => rng() * TAU;
  return rng;
}

/** 文字列 → 32bit シード */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 座標ハッシュ：同じ (x,y,seed) は常に同じ 0..1 を返す */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), h | 1) >>> 0;
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

// --- 値ノイズ（バイオーム生成用） ----------------------------------------

const smooth = (t) => t * t * (3 - 2 * t);

/** 2D 値ノイズ。周波数 f、シード seed。戻り値 0..1 */
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** オクターブ重ね掛け（fBm）。戻り値 0..1 */
export function fbm(x, y, seed = 0, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** リッジノイズ（山脈・崖の生成に） */
export function ridge(x, y, seed = 0, octaves = 3) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * freq, y * freq, seed + i * 733) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// --- 汎用 ------------------------------------------------------------------

/** 配列から条件に合う最初の要素を取り除く */
export function removeItem(arr, item) {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
  return i >= 0;
}

/** 数値を 0 埋め */
export const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 秒 → mm:ss */
export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** 4方向を角度から求める (0:下 1:左 2:右 3:上) */
export function dirFromVec(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 2;
  return dy < 0 ? 3 : 0;
}

export const DIR_VEC = [
  [0, 1],   // 0 下
  [-1, 0],  // 1 左
  [1, 0],   // 2 右
  [0, -1],  // 3 上
];
