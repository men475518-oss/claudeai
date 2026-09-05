// ---------------------------------------------------------------------------
// art.js — ドット絵データを canvas 化し、地形タイルを手続き生成する
// ---------------------------------------------------------------------------
import * as D from './artdata.js';
import { TILE } from './config.js';
import { hash2, valueNoise, clamp } from './util.js';

const P = D.PALETTE;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return c;
}

/** 文字列配列 → canvas。remap で色を差し替え可能 */
export function buildSprite(rows, remap = null) {
  const h = rows.length, w = rows[0].length;
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      let ch = row[x];
      if (ch === '.') continue;
      if (remap && remap[ch]) ch = remap[ch];
      const hex = P[ch];
      if (!hex) continue;
      const i = (y * w + x) * 4;
      img.data[i] = parseInt(hex.slice(1, 3), 16);
      img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export function flipH(src) {
  const cv = makeCanvas(src.width, src.height);
  const ctx = cv.getContext('2d');
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return cv;
}

/** 単色シルエット（点滅ダメージ表現用） */
export function silhouette(src, color) {
  const cv = makeCanvas(src.width, src.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, cv.width, cv.height);
  return cv;
}

// --- 地形 ------------------------------------------------------------------

/**
 * 手続き的な地面タイル。
 * shades: 濃→淡の色配列。weights は各色の出現比率。
 * clump: 大きいほど模様がまとまる。
 */
function groundTile(shades, weights, seed, clump = 0.6, variant = 0) {
  const cv = makeCanvas(TILE, TILE);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TILE, TILE);
  const cum = [];
  let acc = 0;
  for (const w of weights) { acc += w; cum.push(acc); }
  const rgb = shades.map(hex => [
    parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
  ]);
  const ox = variant * 37, oy = variant * 91;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = valueNoise((x + ox) * (1 - clump) * 1.6 + ox, (y + oy) * (1 - clump) * 1.6 + oy, seed);
      const r = hash2(x + ox, y + oy, seed + 7);
      const v = clamp(n * clump + r * (1 - clump), 0, 0.9999) * acc;
      let idx = 0;
      while (idx < cum.length - 1 && v > cum[idx]) idx++;
      const c = rgb[idx];
      const i = (y * TILE + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** 端をぼかすためのディザ用オーバーレイ（上下左右） */
function edgeOverlay(color, dir) {
  const cv = makeCanvas(TILE, TILE);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = color;
  // dir: 0 上, 1 下, 2 左, 3 右。奥ほど疎になるディザ。
  const density = [1, 0.82, 0.42, 0.16, 0.05];
  for (let d = 0; d < density.length; d++) {
    for (let t = 0; t < TILE; t++) {
      // ディザは市松＋ハッシュで有機的に
      const keep = hash2(t, d, dir * 977 + 13) < density[d];
      if (!keep) continue;
      let x, y;
      if (dir === 0) { x = t; y = d; }
      else if (dir === 1) { x = t; y = TILE - 1 - d; }
      else if (dir === 2) { x = d; y = t; }
      else { x = TILE - 1 - d; y = t; }
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

/** 崖（通行不可の岩壁）タイル。上面＋側面で「高さ」を出す。 */
function cliffTile(variant) {
  const cv = makeCanvas(TILE, TILE);
  const ctx = cv.getContext('2d');
  // 上面（明るい）
  ctx.drawImage(groundTile(['#7d7d89', '#8b8b97', '#9c9ca8'], [0.34, 0.5, 0.16], 4242 + variant, 0.78, variant), 0, 0);
  // 側面（暗い）
  const face = groundTile(['#3f3f49', '#4c4c57', '#5a5a66'], [0.36, 0.48, 0.16], 909 + variant, 0.72, variant);
  const faceTop = 9 + (hash2(variant, 3, 11) < 0.5 ? 0 : 1);
  ctx.drawImage(face, 0, faceTop, TILE, TILE - faceTop, 0, faceTop, TILE, TILE - faceTop);
  // 上面と側面のさかいめ
  ctx.fillStyle = '#2c2c34';
  for (let x = 0; x < TILE; x++) {
    const off = hash2(x, variant, 55) < 0.3 ? 1 : 0;
    ctx.fillRect(x, faceTop - 1 + off, 1, 1);
  }
  // 側面の縦すじ
  ctx.fillStyle = '#33333c';
  for (let x = 0; x < TILE; x++)
    if (hash2(x, variant, 71) < 0.28) ctx.fillRect(x, faceTop + 1, 1, TILE - faceTop - 2);
  // 底の輪郭
  ctx.fillStyle = P['0'];
  ctx.fillRect(0, TILE - 1, TILE, 1);
  return cv;
}

/** 石壁（ダンジョン） */
function brickTile(variant, base = [P.u, P.v, P.w]) {
  const cv = makeCanvas(TILE, TILE);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base[0];
  ctx.fillRect(0, 0, TILE, TILE);
  const bw = 8, bh = 4;
  for (let row = 0; row < TILE / bh; row++) {
    const off = (row % 2) * (bw / 2) + (hash2(row, variant, 5) < 0.5 ? 0 : 1);
    for (let bx = -bw; bx < TILE + bw; bx += bw) {
      const x = bx + off, y = row * bh;
      const shade = hash2(bx, row, variant * 31 + 3) < 0.32 ? base[2] : base[1];
      ctx.fillStyle = shade;
      ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
  return cv;
}

/** 水（アニメーションフレーム） */
function waterTile(frame, deep) {
  const shades = deep ? [P.h, '#25406a', P.i] : [P.i, '#3b6a97', P.j];
  const cv = makeCanvas(TILE, TILE);
  const ctx = cv.getContext('2d');
  ctx.drawImage(groundTile(shades, [0.55, 0.32, 0.13], deep ? 909 : 707, 0.75, 0), 0, 0);
  ctx.fillStyle = deep ? P.j : P.k;
  const ph = frame * 0.25;
  for (let y = 0; y < TILE; y++) {
    const w = Math.sin((y * 0.9 + ph * 6.283)) * 3.2 + 8;
    if (((y + frame) % 5) === 0) {
      const x = ((w | 0) + TILE) % TILE;
      ctx.fillRect(x, y, 3, 1);
      ctx.fillRect((x + 8) % TILE, y, 2, 1);
    }
  }
  return cv;
}

// --- スプライト登録 --------------------------------------------------------

export const SPR = {};
export const TERRAIN_TILES = {};   // 名前 → variant 配列
export const EDGE = {};            // 名前 → [上,下,左,右]

export const TERRAIN_COLOR = {
  grass:  P['9'],
  forest: P['8'],
  sand:   P.g,
  dirt:   P.d,
  marsh:  '#3d5347',
  ash:    '#3a3340',
  stone:  P.v,
  floor:  '#4a4352',
  swamp:  '#24463a',
  moss:   '#3f9b4e',
  isleD:  '#2d743d',
  isleL:  '#4eb05e',
  path:   '#b5a86f',
  void:   '#22403a',
  water:  P.i,
  deep:   P.h,
  cliff:  P.v,
};

/** すべてのアートを生成。起動時に一度だけ呼ぶ。 */
export function buildArt() {
  // --- キャラクター ---
  SPR.hero = {
    0: D.HERO_DOWN.map(f => buildSprite(f)),                     // 下
    1: D.HERO_SIDE.map(f => flipH(buildSprite(f))),              // 左
    2: D.HERO_SIDE.map(f => buildSprite(f)),                     // 右
    3: D.HERO_UP.map(f => buildSprite(f)),                       // 上
  };

  const mob = (frames) => frames.map(f => buildSprite(f));
  SPR.slime = mob(D.SLIME);
  SPR.bat = mob(D.BAT);
  SPR.skeleton = mob(D.SKELETON);
  SPR.spore = mob(D.SPORE);
  SPR.wolf = mob(D.WOLF);
  SPR.wolfL = SPR.wolf.map(flipH);
  SPR.warden = mob(D.WARDEN);
  SPR.crow = mob(D.CROW);
  SPR.thorn = mob(D.THORN);
  SPR.stump = mob(D.STUMP);
  SPR.wisp = mob(D.WISP);
  SPR.hatling = mob(D.HATLING);
  SPR.weeper = mob(D.WEEPER);
  SPR.shielder = mob(D.SHIELDER);

  // 村人：色替え × 4 方向
  SPR.villagers = D.VILLAGER_PALETTES.map(pal => ({
    0: D.HERO_DOWN.map(f => buildSprite(f, pal)),
    1: D.HERO_SIDE.map(f => flipH(buildSprite(f, pal))),
    2: D.HERO_SIDE.map(f => buildSprite(f, pal)),
    3: D.HERO_UP.map(f => buildSprite(f, pal)),
  }));

  // --- アイテム ---
  SPR.coin = buildSprite(D.IT_COIN);
  SPR.heart = buildSprite(D.IT_HEART);
  SPR.key = buildSprite(D.IT_KEY);
  SPR.gem = buildSprite(D.IT_GEM);
  SPR.bomb = buildSprite(D.IT_BOMB);
  SPR.potion = buildSprite(D.IT_POTION);
  SPR.star = buildSprite(D.IT_STAR);

  // --- オブジェクト ---
  SPR.tree = buildSprite(D.TREE);
  SPR.tree2 = buildSprite(D.TREE, { a: '9', b: 'a', '9': '8' });          // 濃い木
  SPR.tree3 = buildSprite(D.TREE, { a: 'b', b: 'b', '9': 'a', d: 'e' });  // 明るい木
  SPR.pine = buildSprite(D.PINE);
  SPR.pine2 = buildSprite(D.PINE, { a: '9', b: 'a', '9': '8' });
  SPR.bush = buildSprite(D.BUSH);
  SPR.bush2 = buildSprite(D.BUSH, { a: '9', b: 'a', '9': '8' });
  SPR.rock = buildSprite(D.ROCK);
  SPR.chest = buildSprite(D.CHEST);
  SPR.chestOpen = buildSprite(D.CHEST_OPEN);
  SPR.sign = buildSprite(D.SIGN);
  SPR.cave = buildSprite(D.CAVE);
  SPR.door = buildSprite(D.DOOR);
  SPR.gate = buildSprite(D.GATE);
  SPR.crystal = buildSprite(D.CRYSTAL);
  SPR.relic = buildSprite(D.RELIC);
  SPR.grave = buildSprite(D.GRAVE);
  SPR.hatman = buildSprite(D.HATMAN);
  SPR.vending = buildSprite(D.VENDING);
  SPR.shrine = buildSprite(D.SHRINE);
  // 枯れ木（灰バイオーム用）：木を灰色に色替え
  SPR.deadTree = buildSprite(D.TREE, { a: 'v', b: 'w', '9': 'u', d: 'u', c: 'u' });
  SPR.snowPine = buildSprite(D.PINE, { a: 'x', b: 'y', '9': 'w' });

  // ダメージ点滅用の白シルエット
  SPR.white = new WeakMap();

  // --- 地形 ---
  const T = TERRAIN_TILES;
  T.grass  = [0, 1, 2, 3].map(v => groundTile(['#537d44', '#5f8a4c', '#6d9856'], [0.32, 0.50, 0.18], 101, 0.82, v));
  T.forest = [0, 1, 2, 3].map(v => groundTile(['#3c5f35', '#47693a', '#537745'], [0.34, 0.50, 0.16], 202, 0.84, v));
  T.sand   = [0, 1, 2, 3].map(v => groundTile(['#cfa274', '#deb383', '#ecc79b'], [0.30, 0.52, 0.18], 303, 0.80, v));
  T.dirt   = [0, 1, 2, 3].map(v => groundTile(['#5c3f28', '#6f4b2f', '#82593a'], [0.32, 0.50, 0.18], 404, 0.78, v));
  T.marsh  = [0, 1, 2, 3].map(v => groundTile(['#334740', '#3d5347', '#496152'], [0.34, 0.50, 0.16], 505, 0.86, v));
  T.ash    = [0, 1, 2, 3].map(v => groundTile(['#312b39', '#3a3340', '#443c4b'], [0.34, 0.50, 0.16], 606, 0.82, v));
  T.stone  = [0, 1, 2, 3].map(v => groundTile(['#4e4e58', '#5c5c68', '#6c6c78'], [0.32, 0.50, 0.18], 707, 0.78, v));
  T.floor  = [0, 1, 2, 3].map(v => groundTile(['#413a4a', '#4a4352', '#554d5e'], [0.34, 0.50, 0.16], 808, 0.76, v));
  // ボス戦の沼地／草の島
  T.swamp  = [0, 1, 2, 3].map(v => groundTile(['#20402f', '#264a37', '#2c5540'], [0.36, 0.48, 0.16], 909, 0.52, v));
  // 島の草地（参考画面に合わせた 明るめの緑）
  T.moss   = [0, 1, 2, 3].map(v => groundTile(['#379046', '#3f9b4e', '#46a556'], [0.34, 0.48, 0.18], 1010, 0.62, v));
  T.isleD  = [0, 1, 2, 3].map(v => groundTile(['#276a38', '#2d743d', '#347e44'], [0.34, 0.48, 0.18], 1212, 0.62, v));
  T.isleL  = [0, 1, 2, 3].map(v => groundTile(['#46a556', '#4eb05e', '#57ba67'], [0.32, 0.50, 0.18], 1313, 0.60, v));
  T.path   = [0, 1, 2, 3].map(v => groundTile(['#a89a63', '#b5a86f', '#c2b57c'], [0.32, 0.50, 0.18], 1414, 0.58, v));
  T.void   = [0, 1, 2, 3].map(() => groundTile(['#22403a', '#22403a', '#22403a'], [1, 0, 0], 1111, 1, 0));
  T.water  = [0, 1, 2, 3].map(f => waterTile(f, false));
  T.deep   = [0, 1, 2, 3].map(f => waterTile(f, true));
  T.cliff  = [0, 1, 2, 3].map(v => cliffTile(v));
  T.wall   = [0, 1, 2, 3].map(v => brickTile(v));
  T.wallRuin = [0, 1, 2, 3].map(v => brickTile(v, ['#2e2a34', '#413a48', '#544b5c']));

  for (const [name, color] of Object.entries(TERRAIN_COLOR)) {
    EDGE[name] = [0, 1, 2, 3].map(d => edgeOverlay(color, d));
  }
}

/** 白フラッシュ用シルエットのキャッシュ取得 */
export function whiteOf(spr) {
  let c = SPR.white.get(spr);
  if (!c) { c = silhouette(spr, '#ffffff'); SPR.white.set(spr, c); }
  return c;
}

export { P as PAL };
