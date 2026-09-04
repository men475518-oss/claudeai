// ---------------------------------------------------------------------------
// world.js — タイル地図・地形定義・オーバーワールド生成
// ---------------------------------------------------------------------------
import { TILE, WORLD_W, WORLD_H } from './config.js';
import { makeRng, fbm, ridge, hash2, clamp } from './util.js';
import { SIGNS } from './story.js';

// --- 地形 ------------------------------------------------------------------
export const T = {
  GRASS: 0, FOREST: 1, SAND: 2, DIRT: 3, MARSH: 4, ASH: 5,
  STONE: 6, WATER: 7, DEEP: 8, FLOOR: 9, CLIFF: 10, WALL: 11, RUIN: 12,
  SWAMP: 13, VOID: 14, MOSS: 15,
};
export const TERRAIN_NAME = ['grass', 'forest', 'sand', 'dirt', 'marsh', 'ash', 'stone', 'water', 'deep', 'floor', 'cliff', 'wall', 'wallRuin', 'swamp', 'void', 'moss'];
export const TERRAIN_SOLID = [0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0];
export const TERRAIN_SLOW = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
// 描画時の重なり優先度（高いほうが低いほうの上へディザで乗る）
export const TERRAIN_PRIO = [3, 2, 5, 1, 2, 4, 5, 7, 6, 5, 9, 9, 9, 4, 0, 3];

// --- オブジェクト ----------------------------------------------------------
export const O = {
  NONE: 0, TREE: 1, PINE: 2, BUSH: 3, ROCK: 4, SIGN: 5, CAVE: 6, CHEST: 7,
  CHEST_OPEN: 8, DOOR: 9, GATE: 10, CRYSTAL: 11, GRAVE: 12, DEADTREE: 13,
  FLOWER: 14, TUFT: 15, STAIRS: 16, PILLAR: 17, CAGE: 18, CRACK: 19,
  EXIT: 20, RELIC: 21, SNOWPINE: 22, TORCH: 23, POT: 24, PORTAL: 25, BOUND: 26, VENDING: 27, SHRINE: 28,
};

/** [sprite, solid, hp(0=壊せない), tall(縦に重なる大きさ)] */
export const OBJ_DEF = {
  [O.TREE]:      { spr: 'tree', solid: 1, hp: 0, tall: 1 },
  [O.PINE]:      { spr: 'pine', solid: 1, hp: 0, tall: 1 },
  [O.SNOWPINE]:  { spr: 'snowPine', solid: 1, hp: 0, tall: 1 },
  [O.DEADTREE]:  { spr: 'deadTree', solid: 1, hp: 0, tall: 1 },
  [O.BUSH]:      { spr: 'bush', solid: 0, hp: 1, tall: 0 },
  [O.ROCK]:      { spr: 'rock', solid: 1, hp: 0, tall: 0 },
  [O.SIGN]:      { spr: 'sign', solid: 1, hp: 0, tall: 0 },
  [O.CAVE]:      { spr: 'cave', solid: 1, hp: 0, tall: 0 },
  [O.CHEST]:     { spr: 'chest', solid: 1, hp: 0, tall: 0 },
  [O.CHEST_OPEN]:{ spr: 'chestOpen', solid: 1, hp: 0, tall: 0 },
  [O.DOOR]:      { spr: 'door', solid: 1, hp: 0, tall: 0 },
  [O.GATE]:      { spr: 'gate', solid: 1, hp: 0, tall: 0 },
  [O.CRYSTAL]:   { spr: 'crystal', solid: 1, hp: 3, tall: 0 },
  [O.GRAVE]:     { spr: 'grave', solid: 1, hp: 0, tall: 0 },
  [O.RELIC]:     { spr: null, solid: 0, hp: 0, tall: 0 },
  [O.FLOWER]:    { spr: null, solid: 0, hp: 0, tall: 0 },
  [O.TUFT]:      { spr: null, solid: 0, hp: 0, tall: 0 },
  [O.STAIRS]:    { spr: null, solid: 0, hp: 0, tall: 0 },
  [O.EXIT]:      { spr: null, solid: 0, hp: 0, tall: 0 },
  [O.PILLAR]:    { spr: null, solid: 1, hp: 0, tall: 1 },
  [O.CAGE]:      { spr: null, solid: 1, hp: 4, tall: 0 },
  [O.CRACK]:     { spr: null, solid: 1, hp: 0, tall: 0 },
  [O.TORCH]:     { spr: null, solid: 1, hp: 0, tall: 1 },
  [O.POT]:       { spr: null, solid: 0, hp: 1, tall: 0 },
  [O.PORTAL]:    { spr: 'gate', solid: 1, hp: 0, tall: 0 },
  [O.BOUND]:     { spr: null, solid: 1, hp: 0, tall: 0 },   // 見えない仕切り
  [O.VENDING]:   { spr: 'vending', solid: 1, hp: 0, tall: 1 },
  [O.SHRINE]:    { spr: 'shrine', solid: 1, hp: 0, tall: 0 },
};

export function objSolid(id) { const d = OBJ_DEF[id]; return d ? d.solid : 0; }

// --- レベル ----------------------------------------------------------------

export class Level {
  constructor(w, h, kind = 'field') {
    this.w = w; this.h = h;
    this.kind = kind;                     // 'field' | 'dungeon' | 'town'
    this.ground = new Uint8Array(w * h);
    this.obj = new Uint8Array(w * h);
    this.objHp = new Map();               // index -> 残り HP
    this.explored = new Uint8Array(w * h);
    this.buildings = [];
    this.spawns = [];                     // 敵のリスポーン定義
    this.dark = kind === 'dungeon';       // 視界制限
    this.music = kind === 'dungeon' ? 'dungeon' : 'field';
    this.name = '';
    this.id = 'field';
  }
  idx(x, y) { return y * this.w + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  g(x, y) { return this.inb(x, y) ? this.ground[y * this.w + x] : T.CLIFF; }
  o(x, y) { return this.inb(x, y) ? this.obj[y * this.w + x] : O.NONE; }
  setG(x, y, v) { if (this.inb(x, y)) this.ground[y * this.w + x] = v; }
  setO(x, y, v) {
    if (!this.inb(x, y)) return;
    const i = y * this.w + x;
    this.obj[i] = v;
    const def = OBJ_DEF[v];
    if (def && def.hp > 0) this.objHp.set(i, def.hp); else this.objHp.delete(i);
  }
  solid(x, y) {
    if (!this.inb(x, y)) return true;
    const i = y * this.w + x;
    return !!TERRAIN_SOLID[this.ground[i]] || !!objSolid(this.obj[i]);
  }
  /** 水だけを判定（落水演出用） */
  isWater(x, y) { const g = this.g(x, y); return g === T.WATER || g === T.DEEP; }
  slow(x, y) { return !!TERRAIN_SLOW[this.g(x, y)]; }

  /** ピクセル座標での矩形衝突 */
  hits(px, py, hw, hh) {
    const x0 = Math.floor((px - hw) / TILE), x1 = Math.floor((px + hw - 0.001) / TILE);
    const y0 = Math.floor((py - hh) / TILE), y1 = Math.floor((py + hh - 0.001) / TILE);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (this.solid(x, y)) return true;
    return false;
  }
  markExplored(cx, cy, r) {
    const x0 = Math.max(0, cx - r), x1 = Math.min(this.w - 1, cx + r);
    const y0 = Math.max(0, cy - r), y1 = Math.min(this.h - 1, cy + r);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.explored[y * this.w + x] = 1;
  }
}

// --- 建物 ------------------------------------------------------------------

export const BUILDINGS = [
  { id: 'home',    name: 'あなたの家',   cost: 0,    desc: 'ねむって体力を回復できる。' },
  { id: 'shop',    name: 'よろず屋',     cost: 60,   desc: 'ポーションや爆弾を買える。' },
  { id: 'smith',   name: 'かじ屋',       cost: 120,  desc: '剣をきたえて攻撃力を上げる。' },
  { id: 'healer',  name: 'いやしの家',   cost: 200,  desc: 'ハートの最大値を増やせる。' },
  { id: 'sage',    name: '賢者の塔',     cost: 320,  desc: '魔法をさずかる。' },
  { id: 'farm',    name: '畑',           cost: 90,   desc: '毎日きのみが実る。' },
  { id: 'well',    name: '井戸',         cost: 40,   desc: '村のうるおい。訪れる人が増える。' },
];

// --- オーバーワールド生成 --------------------------------------------------

function biomeAt(x, y, seed, sea) {
  const nx = x / 42, ny = y / 42;
  const e = fbm(nx, ny, seed, 5);
  const m = fbm(nx + 100, ny + 100, seed + 555, 4);
  const r = ridge(nx * 1.4, ny * 1.4, seed + 999, 3);
  return { e, m, r };
}

/** 幅優先で到達可能タイルを塗る */
function floodReach(level, sx, sy) {
  const { w, h } = level;
  const seen = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let qs = 0, qe = 0;
  q[qe++] = sy * w + sx; seen[sy * w + sx] = 1;
  let count = 1;
  while (qs < qe) {
    const i = q[qs++];
    const x = i % w, y = (i / w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (seen[j]) continue;
      if (TERRAIN_SOLID[level.ground[j]]) continue;
      seen[j] = 1; q[qe++] = j; count++;
    }
  }
  return { seen, count };
}

/** 円形に地形をならす */
function carveCircle(level, cx, cy, r, terrain) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      if (!level.inb(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) { level.setG(x, y, terrain); level.setO(x, y, O.NONE); }
    }
}

/** 2 点を結ぶ道。確率的に斜めへ進むので、直角に折れずに自然な小径になる。 */
function carvePath(level, ax, ay, bx, by, rng, width = 0) {
  let x = ax, y = ay, guard = 0;
  const paint = (cx, cy) => {
    for (let oy = -width; oy <= width; oy++)
      for (let ox = -width; ox <= width; ox++) {
        const px = cx + ox, py = cy + oy;
        if (!level.inb(px, py)) continue;
        if (Math.abs(ox) + Math.abs(oy) > width) continue;
        const t = level.g(px, py);
        if (t === T.DEEP) continue;                 // 深い水は埋めない
        level.setG(px, py, T.DIRT);
        const ob = level.o(px, py);
        if (ob && OBJ_DEF[ob] && OBJ_DEF[ob].solid) level.setO(px, py, O.NONE);
      }
  };
  while ((x !== bx || y !== by) && guard++ < 8000) {
    paint(x, y);
    const dx = bx - x, dy = by - y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx === 0) y += Math.sign(dy);
    else if (ady === 0) x += Math.sign(dx);
    else if (rng() < adx / (adx + ady)) x += Math.sign(dx);
    else y += Math.sign(dy);
    // ときどき ふらつく
    if (rng() < 0.10) {
      if (rng() < 0.5) x += rng() < 0.5 ? 1 : -1;
      else y += rng() < 0.5 ? 1 : -1;
    }
    x = clamp(x, 1, level.w - 2); y = clamp(y, 1, level.h - 2);
  }
  paint(bx, by);
}

export function generateOverworld(seed) {
  const rng = makeRng(seed);
  let level, reach, townX, townY, sea = 0.36;

  for (let attempt = 0; attempt < 10; attempt++) {
    level = new Level(WORLD_W, WORLD_H, 'field');
    level.id = 'field';
    level.name = 'アフターグローヴ';
    const s = seed + attempt * 7919;

    for (let y = 0; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        // 外周は海
        const edge = Math.min(x, y, WORLD_W - 1 - x, WORLD_H - 1 - y);
        const fall = clamp(edge / 14, 0, 1);
        const { e: e0, m, r } = biomeAt(x, y, s, sea);
        const e = e0 * (0.35 + 0.65 * fall);
        let t;
        if (e < sea - 0.07) t = T.DEEP;
        else if (e < sea) t = T.WATER;
        else if (e < sea + 0.045) t = T.SAND;
        else if (r > 0.70 && e > sea + 0.16) t = T.CLIFF;
        else if (m > 0.62 && e < sea + 0.14) t = T.MARSH;
        else if (m > 0.55) t = T.FOREST;
        else if (m < 0.34 && e > sea + 0.22) t = T.ASH;
        else if (m < 0.30) t = T.SAND;
        else if (e > sea + 0.30) t = T.STONE;
        else t = T.GRASS;
        level.ground[y * WORLD_W + x] = t;
      }
    }

    // 村の候補地：中央付近の広い草地
    let best = null;
    for (let k = 0; k < 900; k++) {
      const x = rng.irange(26, WORLD_W - 27), y = rng.irange(26, WORLD_H - 27);
      const dc = Math.hypot(x - WORLD_W / 2, y - WORLD_H / 2);
      if (dc > 46) continue;
      let ok = 0;
      for (let oy = -5; oy <= 5; oy++)
        for (let ox = -5; ox <= 5; ox++)
          if (!TERRAIN_SOLID[level.g(x + ox, y + oy)]) ok++;
      const score = ok - dc * 0.4;
      if (!best || score > best.score) best = { x, y, score };
    }
    townX = best ? best.x : (WORLD_W >> 1);
    townY = best ? best.y : (WORLD_H >> 1);
    carveCircle(level, townX, townY, 9, T.GRASS);

    reach = floodReach(level, townX, townY);
    const land = level.ground.reduce((a, t) => a + (TERRAIN_SOLID[t] ? 0 : 1), 0);
    if (reach.count > land * 0.42 && reach.count > 4000) break;
    sea -= 0.02;   // 海面を下げてもう一度
  }

  const reachable = (x, y) => level.inb(x, y) && reach.seen[y * level.w + x] === 1;

  // --- 植生・岩を配置 ---
  for (let y = 1; y < WORLD_H - 1; y++) {
    for (let x = 1; x < WORLD_W - 1; x++) {
      const t = level.g(x, y);
      if (TERRAIN_SOLID[t]) continue;
      const h = hash2(x, y, seed + 31);
      const inTown = Math.hypot(x - townX, y - townY) < 10;
      if (inTown) {
        if (h < 0.05) level.setO(x, y, O.FLOWER);
        else if (h < 0.12) level.setO(x, y, O.TUFT);
        continue;
      }
      if (t === T.FOREST) {
        // 大きなうねりで「林」と「ひらけた場所」を作る
        const density = 0.18 + fbm(x / 11, y / 11, seed + 4242, 2) * 0.34;
        if (h < density) level.setO(x, y, hash2(x, y, seed + 8) < 0.28 ? O.PINE : O.TREE);
        else if (h < density + 0.10) level.setO(x, y, O.BUSH);
        else if (h < density + 0.17) level.setO(x, y, O.TUFT);
      } else if (t === T.GRASS) {
        if (h < 0.055) level.setO(x, y, O.TREE);
        else if (h < 0.10) level.setO(x, y, O.BUSH);
        else if (h < 0.13) level.setO(x, y, O.FLOWER);
        else if (h < 0.20) level.setO(x, y, O.TUFT);
      } else if (t === T.MARSH) {
        if (h < 0.10) level.setO(x, y, O.DEADTREE);
        else if (h < 0.22) level.setO(x, y, O.BUSH);
        else if (h < 0.30) level.setO(x, y, O.TUFT);
      } else if (t === T.SAND) {
        if (h < 0.03) level.setO(x, y, O.ROCK);
        else if (h < 0.05) level.setO(x, y, O.TUFT);
      } else if (t === T.STONE) {
        if (h < 0.12) level.setO(x, y, O.ROCK);
      } else if (t === T.ASH) {
        if (h < 0.13) level.setO(x, y, O.DEADTREE);
        else if (h < 0.18) level.setO(x, y, O.ROCK);
        else if (h < 0.21) level.setO(x, y, O.GRAVE);
      }
    }
  }

  // --- 村の整地 ---
  carveCircle(level, townX, townY, 8, T.GRASS);
  for (let y = townY - 8; y <= townY + 8; y++)
    for (let x = townX - 8; x <= townX + 8; x++) {
      if (!level.inb(x, y)) continue;
      const h = hash2(x, y, seed + 77);
      if (h < 0.05) level.setO(x, y, O.FLOWER);
      else if (h < 0.11) level.setO(x, y, O.TUFT);
    }

  // --- ダンジョン入口を 3 つ ---
  const dungeons = [];
  const wantBiomes = [
    { t: T.FOREST, name: 'ねむりの森', theme: 'forest', level: 1 },
    { t: T.STONE,  name: 'こだまの洞', theme: 'cave',   level: 2 },
    { t: T.ASH,    name: '灰の神殿',   theme: 'ruin',   level: 3 },
  ];
  for (let i = 0; i < wantBiomes.length; i++) {
    const want = wantBiomes[i];
    let spot = null, bestScore = -1;
    for (let k = 0; k < 6000; k++) {
      const x = rng.irange(6, WORLD_W - 7), y = rng.irange(6, WORLD_H - 7);
      if (!reachable(x, y)) continue;
      const d = Math.hypot(x - townX, y - townY);
      if (d < 22 + i * 12 || d > 90) continue;
      let match = level.g(x, y) === want.t ? 8 : 0;
      for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++)
        if (level.g(x + ox, y + oy) === want.t) match++;
      const far = dungeons.every(dg => Math.hypot(dg.x - x, dg.y - y) > 34);
      if (!far) continue;
      const score = match + d * 0.05;
      if (score > bestScore) { bestScore = score; spot = { x, y }; }
    }
    if (!spot) {
      // 見つからなければ到達可能な適当な遠い場所
      for (let k = 0; k < 8000 && !spot; k++) {
        const x = rng.irange(6, WORLD_W - 7), y = rng.irange(6, WORLD_H - 7);
        if (reachable(x, y) && Math.hypot(x - townX, y - townY) > 24) spot = { x, y };
      }
    }
    if (!spot) continue;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      level.setO(spot.x + ox, spot.y + oy, O.NONE);
      if (TERRAIN_SOLID[level.g(spot.x + ox, spot.y + oy)]) level.setG(spot.x + ox, spot.y + oy, T.DIRT);
    }
    level.setG(spot.x, spot.y, T.STONE);
    level.setO(spot.x, spot.y, O.CAVE);
    dungeons.push({ id: 'dg' + i, x: spot.x, y: spot.y, ...want, cleared: false, seed: seed + 4177 * (i + 1) });
    carvePath(level, townX, townY, spot.x, spot.y + 1, rng, 0);
  }

  // --- とらわれた村人（檻）---
  const villagers = [];
  for (let i = 0; i < 7; i++) {
    let spot = null;
    for (let k = 0; k < 4000 && !spot; k++) {
      const x = rng.irange(5, WORLD_W - 6), y = rng.irange(5, WORLD_H - 6);
      if (!reachable(x, y)) continue;
      const d = Math.hypot(x - townX, y - townY);
      if (d < 14 || d > 85) continue;
      if (villagers.some(v => Math.hypot(v.x - x, v.y - y) < 20)) continue;
      let open = 0;
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++)
        if (!level.solid(x + ox, y + oy)) open++;
      if (open < 18) continue;
      spot = { x, y };
    }
    if (!spot) continue;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      if (TERRAIN_SOLID[level.g(spot.x + ox, spot.y + oy)]) level.setG(spot.x + ox, spot.y + oy, T.DIRT);
      const ob = level.o(spot.x + ox, spot.y + oy);
      if (ob && OBJ_DEF[ob] && OBJ_DEF[ob].solid) level.setO(spot.x + ox, spot.y + oy, O.NONE);
    }
    level.setO(spot.x, spot.y, O.CAGE);
    villagers.push({ id: 'vil' + i, x: spot.x, y: spot.y, kind: i % 8, freed: false, building: BUILDINGS[(i % (BUILDINGS.length - 1)) + 1].id });
  }

  // --- 宝箱 ---
  const chests = [];
  for (let i = 0; i < 22; i++) {
    for (let k = 0; k < 2500; k++) {
      const x = rng.irange(4, WORLD_W - 5), y = rng.irange(4, WORLD_H - 5);
      if (!reachable(x, y) || level.solid(x, y)) continue;
      if (Math.hypot(x - townX, y - townY) < 12) continue;
      if (chests.some(c => Math.hypot(c.x - x, c.y - y) < 12)) continue;
      level.setO(x, y, O.CHEST);
      chests.push({ x, y, loot: rng() < 0.22 ? 'heart' : rng() < 0.5 ? 'coins' : rng() < 0.7 ? 'bomb' : 'potion' });
      break;
    }
  }

  // --- 立て札 ---
  const signs = [];
  for (let i = 0; i < SIGNS.length; i++) {
    for (let k = 0; k < 1200; k++) {
      const ang = rng() * Math.PI * 2, r = 10 + i * 6 + rng() * 10;
      const x = Math.round(townX + Math.cos(ang) * r), y = Math.round(townY + Math.sin(ang) * r);
      if (!reachable(x, y) || level.solid(x, y)) continue;
      level.setO(x, y, O.SIGN);
      signs.push({ x, y, text: SIGNS[i] });
      break;
    }
  }

  // --- 祠（近くの用事を教えてくれる）---
  const shrines = [];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3000; k++) {
      const x = rng.irange(6, WORLD_W - 7), y = rng.irange(6, WORLD_H - 7);
      if (!reachable(x, y) || level.solid(x, y)) continue;
      const d = Math.hypot(x - townX, y - townY);
      if (d < 16 || d > 80) continue;
      if (shrines.some(sh => Math.hypot(sh.x - x, sh.y - y) < 26)) continue;
      level.setO(x, y, O.SHRINE);
      shrines.push({ x, y });
      break;
    }
  }

  // --- 自販機（村に一台、外に二台）---
  const vendings = [];
  const putVending = (x, y) => {
    if (!level.inb(x, y) || level.solid(x, y)) return false;
    level.setO(x, y, O.VENDING);
    vendings.push({ x, y });
    return true;
  };
  putVending(townX + 3, townY + 2);
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 2500; k++) {
      const x = rng.irange(6, WORLD_W - 7), y = rng.irange(6, WORLD_H - 7);
      if (!reachable(x, y)) continue;
      const d = Math.hypot(x - townX, y - townY);
      if (d < 20 || d > 70) continue;
      if (vendings.some(v => Math.hypot(v.x - x, v.y - y) < 30)) continue;
      if (putVending(x, y)) break;
    }
  }

  // --- 最終の門（3 つの遺物で開く）---
  let gate = null;
  for (let k = 0; k < 8000 && !gate; k++) {
    const x = rng.irange(5, WORLD_W - 6), y = rng.irange(5, WORLD_H - 6);
    if (!reachable(x, y)) continue;
    const d = Math.hypot(x - townX, y - townY);
    if (d < 40) continue;
    gate = { x, y };
  }
  if (gate) {
    for (let oy = -2; oy <= 2; oy++) for (let ox = -3; ox <= 3; ox++) {
      if (!level.inb(gate.x + ox, gate.y + oy)) continue;
      level.setG(gate.x + ox, gate.y + oy, T.STONE);
      level.setO(gate.x + ox, gate.y + oy, O.NONE);
    }
    level.setO(gate.x, gate.y, O.GATE);
    carvePath(level, townX, townY, gate.x, gate.y + 2, rng, 0);
  }

  return { level, townX, townY, dungeons, villagers, chests, signs, shrines, vendings, gate, reach };
}

/** 村の広場に建物区画を作る */
export function layoutTown(level, townX, townY) {
  const plots = [
    { dx: -6, dy: -4, w: 4, h: 3 },
    { dx: 1,  dy: -5, w: 4, h: 3 },
    { dx: 5,  dy: 0,  w: 4, h: 3 },
    { dx: -7, dy: 2,  w: 4, h: 3 },
    { dx: 0,  dy: 4,  w: 4, h: 3 },
    { dx: -3, dy: -7, w: 4, h: 3 },
    { dx: 6,  dy: -6, w: 3, h: 3 },
  ];
  const list = [];
  for (let i = 0; i < BUILDINGS.length; i++) {
    const p = plots[i % plots.length];
    const b = {
      ...BUILDINGS[i],
      x: townX + p.dx, y: townY + p.dy, w: p.w, h: p.h,
      built: BUILDINGS[i].id === 'home',
    };
    list.push(b);
  }
  applyBuildings(level, list);
  return list;
}

/** 建物の当たり判定をタイルへ反映 */
export function applyBuildings(level, list) {
  for (const b of list) {
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) {
        if (!level.inb(x, y)) continue;
        level.setO(x, y, O.NONE);
        level.setG(x, y, b.built ? T.DIRT : T.GRASS);
      }
    if (b.built) {
      // 建物本体は下 1 行を除いて壁（下辺が入口側）
      for (let y = b.y; y < b.y + b.h - 1; y++)
        for (let x = b.x; x < b.x + b.w; x++)
          if (level.inb(x, y)) level.setO(x, y, O.PILLAR);
      // 入口タイル（下辺は入口の 1 マスだけ通れる）
      const dx = b.x + (b.w >> 1);
      const dy = b.y + b.h - 1;
      b.doorX = dx; b.doorY = dy;
      for (let x = b.x; x < b.x + b.w; x++)
        if (level.inb(x, dy)) level.setO(x, dy, x === dx ? O.NONE : O.PILLAR);
      level.setG(dx, dy, T.DIRT);
    }
  }
}
