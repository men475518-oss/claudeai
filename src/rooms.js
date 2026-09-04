// ---------------------------------------------------------------------------
// rooms.js — 世界は「小さな島」がいくつも つながった かたち
//   ひとつの島がひとつの画面。端の小道から となりの島へ移る。
//   全体の形はグリッド上のグラフとして持ち、マップ画面はそれを点と線で描く。
// ---------------------------------------------------------------------------
import { Level, T, O, BUILDINGS, applyBuildings } from './world.js';
import { makeRng, clamp } from './util.js';
import { makeIslandShape, rasterizeIsland, addPool, poolSpot } from './island.js';

export const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
export const DV = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const DIRS = ['n', 's', 'e', 'w'];

// --- 島の種類 ---------------------------------------------------------------
// w,h はその島の広さ（タイル）。names から名前をひとつ取る。
const KIND = {
  home:     { w: 13, h: 20, mobs: 0, names: ['家のまわり'] },
  town:     { w: 17, h: 22, mobs: 0, names: ['町'] },
  glade:    { w: 12, h: 18, mobs: 1, names: ['ひらけた草地', '日だまり', 'まるい草地', '風のとおり道', 'なにもない原', 'すこし高い原', 'なだらかな丘', '見晴らし'] },
  crates:   { w: 12, h: 18, mobs: 1, names: ['木箱が三つ', '置きっぱなしの荷', 'つみに場', 'あきばこの山', 'だれかの荷物'] },
  forest:   { w: 13, h: 21, mobs: 2, names: ['深い森', 'しげみ', 'ねむりの林', '木のあいだ', 'こだまの林', 'まがりくねる林', 'したしげり', '木のトンネル'] },
  mushroom: { w: 12, h: 19, mobs: 1, names: ['きのこの家', 'きのこ林', 'かさの下', 'ほうしの原', 'あまいにおい'] },
  rocks:    { w: 12, h: 19, mobs: 2, names: ['岩場', '石のならぶ道', 'くずれ岩', 'ごろた石', '割れた岩', '石だたみ'] },
  pool:     { w: 13, h: 19, mobs: 1, names: ['みずたまり', '小さな池', 'とげのうきわ', '足まで水', 'よどんだ水'] },
  bridge:   { w: 11, h: 22, mobs: 1, names: ['橋わたり', 'トロル橋', '細い道', 'わたり板', 'ゆれる橋'] },
  graveyard:{ w: 13, h: 19, mobs: 2, names: ['墓地', 'ならんだ石', 'しずかな丘', '名前のない石', 'ねむる場所'] },
  ruins:    { w: 13, h: 19, mobs: 2, names: ['くずれた門', '遺跡の前', '柱のあと', 'こわれた壁', '床だけの家'] },
  ash:      { w: 13, h: 21, mobs: 3, names: ['灰の原', 'くらがり', '枯れ木の道', 'すすの丘', '音のない原', '白い灰'] },
  playground:{w: 12, h: 18, mobs: 1, names: ['古い遊び場', 'すべり台のあと'] },
  library:  { w: 13, h: 19, mobs: 1, names: ['図書館の前', '本のにおい', 'ぬれた紙'] },
};

// 名前を使い切ったときの ひかえ
const EXTRA_NAMES = [
  'なにもない島', 'とちゅうの原', 'ただの草地', 'わすれられた所',
  'ちいさな空き地', 'すみの島', '名もない丘', 'とおりみち',
];

const DEPTH_KINDS = [
  ['glade', 'crates', 'glade'],                        // 1
  ['glade', 'forest', 'mushroom', 'crates'],           // 2
  ['forest', 'pool', 'rocks', 'bridge', 'playground'], // 3
  ['forest', 'rocks', 'graveyard', 'library', 'pool'], // 4
  ['ruins', 'graveyard', 'rocks', 'forest', 'bridge'], // 5
  ['ash', 'ruins', 'graveyard', 'ash'],                // 6+
];

// ---------------------------------------------------------------------------
// 世界（島のグラフ）を作る
// ---------------------------------------------------------------------------
export function generateRoomWorld(seed) {
  const rng = makeRng(seed);
  const rooms = new Map();          // "gx,gy" -> room
  const key = (gx, gy) => `${gx},${gy}`;

  const makeRoom = (gx, gy) => {
    const r = {
      id: key(gx, gy), gx, gy, kind: 'glade', name: '', depth: 0,
      exits: {}, seed: (seed ^ (gx * 73856093) ^ (gy * 19349663)) >>> 0,
      visited: false, content: {}, mobs: [],
    };
    rooms.set(r.id, r);
    return r;
  };

  // --- 骨格：ランダムに枝をのばす ---
  const home = makeRoom(0, 0);
  const TARGET = 34;
  let guard = 0;
  while (rooms.size < TARGET && guard++ < 4000) {
    const list = [...rooms.values()];
    const from = list[rng.int(list.length)];
    const dir = DIRS[rng.int(4)];
    const [dx, dy] = DV[dir];
    const nx = from.gx + dx, ny = from.gy + dy;
    if (Math.abs(nx) > 5 || Math.abs(ny) > 5) continue;
    if (rooms.has(key(nx, ny))) continue;
    // 枝分かれしすぎないよう、出口が 3 つ以上ある島からは のばさない
    if (Object.keys(from.exits).length >= 3 && rng() < 0.75) continue;
    const to = makeRoom(nx, ny);
    from.exits[dir] = to.id;
    to.exits[OPP[dir]] = from.id;
  }

  // --- ループを何本か足して、行き止まりだらけにしない ---
  const all = [...rooms.values()];
  let loops = 0;
  for (let k = 0; k < 400 && loops < 5; k++) {
    const a = all[rng.int(all.length)];
    const dir = DIRS[rng.int(4)];
    if (a.exits[dir]) continue;
    const [dx, dy] = DV[dir];
    const b = rooms.get(key(a.gx + dx, a.gy + dy));
    if (!b) continue;
    a.exits[dir] = b.id;
    b.exits[OPP[dir]] = a.id;
    loops++;
  }

  // --- 家からの距離 ---
  const queue = [home];
  home.depth = 0;
  const seen = new Set([home.id]);
  while (queue.length) {
    const r = queue.shift();
    for (const d of DIRS) {
      const nid = r.exits[d];
      if (!nid || seen.has(nid)) continue;
      seen.add(nid);
      const n = rooms.get(nid);
      n.depth = r.depth + 1;
      queue.push(n);
    }
  }
  const sorted = [...rooms.values()].sort((a, b) => a.depth - b.depth);
  const maxDepth = sorted[sorted.length - 1].depth;

  // --- 種類と名前 ---
  const usedNames = new Set();
  const nameFor = (kind) => {
    const pool = KIND[kind].names;
    for (let i = 0; i < pool.length; i++) {
      const n = pool[(rng.int(pool.length) + i) % pool.length];
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
    }
    // ぜんぶ使い切ったら、名もない島として名づける
    for (const n of EXTRA_NAMES) if (!usedNames.has(n)) { usedNames.add(n); return n; }
    return 'なまえのない島';
  };

  home.kind = 'home'; home.name = '家のまわり'; usedNames.add('家のまわり');

  // 町は 家から 2〜3 歩のところ
  const townCand = sorted.filter(r => r.depth >= 2 && r.depth <= 3);
  const town = townCand.length ? rng.pick(townCand) : sorted[1];
  town.kind = 'town'; town.name = '町'; usedNames.add('町');

  for (const r of sorted) {
    if (r.kind === 'home' || r.kind === 'town') continue;
    const tier = DEPTH_KINDS[Math.min(DEPTH_KINDS.length - 1, Math.max(0, r.depth - 1))];
    r.kind = rng.pick(tier);
    r.name = nameFor(r.kind);
  }

  // --- ほら穴 三つ（別々の方向・別々の深さ）---
  const dungeons = [];
  const themes = [
    { theme: 'forest', name: 'ねむりの森', level: 1, minD: 3 },
    { theme: 'cave', name: 'こだまの洞', level: 2, minD: 5 },
    { theme: 'ruin', name: '灰の神殿', level: 3, minD: 7 },
  ];
  for (let i = 0; i < themes.length; i++) {
    const t = themes[i];
    const cand = sorted.filter(r => !r.content.dungeon && r.kind !== 'home' && r.kind !== 'town'
      && r.depth >= Math.min(t.minD, maxDepth - 1)
      && !dungeons.some(d => rooms.get(d.roomId).gx === r.gx && rooms.get(d.roomId).gy === r.gy));
    const room = cand.length ? cand[rng.int(Math.min(cand.length, 6))] : sorted[sorted.length - 1 - i];
    room.content.dungeon = i;
    dungeons.push({
      id: 'dg' + i, roomId: room.id, name: t.name, theme: t.theme, level: t.level,
      cleared: false, relicTaken: false, seed: (seed + 4177 * (i + 1)) >>> 0,
    });
  }

  // --- 古い門はいちばん遠く ---
  const gateRoom = sorted.filter(r => !r.content.dungeon && r.kind !== 'town' && r.kind !== 'home').pop() || sorted[sorted.length - 1];
  gateRoom.content.gate = true;

  // --- とらわれた村人 ---
  const villagers = [];
  const vcand = sorted.filter(r => r.depth >= 2 && !r.content.dungeon && !r.content.gate && r.kind !== 'town');
  rng.shuffle(vcand);
  for (let i = 0; i < Math.min(7, vcand.length); i++) {
    const room = vcand[i];
    room.content.cage = true;
    villagers.push({
      id: 'vil' + i, roomId: room.id, freed: false,
      kind: i % 8, building: BUILDINGS[(i % (BUILDINGS.length - 1)) + 1].id,
    });
  }

  // --- 宝箱・自販機・祠・立て札 ---
  const rest = sorted.filter(r => r.kind !== 'home' && r.kind !== 'town' && !r.content.gate);
  rng.shuffle(rest);
  let ri = 0;
  for (let i = 0; i < 9 && ri < rest.length; i++) rest[ri++].content.chest = true;
  for (let i = 0; i < 3 && ri < rest.length; i++) rest[ri++].content.vending = true;
  for (let i = 0; i < 4 && ri < rest.length; i++) rest[ri++].content.shrine = true;
  for (let i = 0; i < 5 && ri < rest.length; i++) rest[ri++].content.sign = i;
  // 家と町にも一台ずつ
  town.content.vending = true;

  // --- 建物：自分の家は 出発の島に、店は 町に ---
  const buildings = BUILDINGS.map(b => ({
    ...b, built: b.id === 'home', roomId: b.id === 'home' ? home.id : town.id,
    x: 0, y: 0, w: 4, h: 3,
  }));

  // --- 帽子の人が 立つ島（進み具合で 移る）---
  const hatPool = sorted.filter(r => r.kind !== 'home' && !r.content.cage && !r.content.gate);
  const pickAt = (d) => (hatPool.filter(r => r.depth >= d)[0] || hatPool[hatPool.length - 1] || home).id;
  const hatmanRooms = [pickAt(1), pickAt(3), pickAt(Math.max(4, maxDepth - 2)), gateRoom.id];

  return {
    rooms, startId: home.id, townId: town.id, gateRoomId: gateRoom.id,
    dungeons, villagers, buildings, hatmanRooms, seed, maxDepth,
  };
}

// ---------------------------------------------------------------------------
// 島の地面を組み立てる
// ---------------------------------------------------------------------------
export function buildRoomLevel(world, room) {
  const K = KIND[room.kind] || KIND.glade;
  const W = K.w, H = K.h;
  const lv = new Level(W, H, 'field');
  lv.id = room.id;
  lv.name = room.name;
  lv.island = true;
  lv.dark = false;
  lv.ground.fill(T.VOID);
  const rng = makeRng(room.seed);

  const cx = W / 2, cy = H / 2;
  const flat = room.kind === 'town' || room.kind === 'home';

  // 島の形は多角形で持ち、通行判定だけタイルへ焼く（見た目は island.js が描く）
  const shape = makeIslandShape(room, W, H, room.exits, { flat });
  rasterizeIsland(lv, shape, T);
  lv.shape = shape;
  lv.shapeSeed = room.seed;
  lv.shapeKind = room.kind;

  const isGround = (x, y) => lv.inb(x, y) && lv.g(x, y) !== T.VOID;

  // --- 出口（島のはしの小道）---
  const gateways = {};
  const midX = clamp(Math.floor(cx), 0, W - 1), midY = clamp(Math.floor(cy), 0, H - 1);
  for (const dir of DIRS) {
    if (!room.exits[dir]) continue;
    if (dir === 'n') gateways.n = { x: midX, y: 0 };
    else if (dir === 's') gateways.s = { x: midX, y: H - 1 };
    else if (dir === 'e') gateways.e = { x: W - 1, y: midY };
    else gateways.w = { x: 0, y: midY };
  }
  for (const dir of Object.keys(gateways)) {
    const gw = gateways[dir];
    lv.setG(gw.x, gw.y, T.PATH);
    lv.setO(gw.x, gw.y, O.GATEWAY);
  }

  // --- 池のある島 ---
  if (room.kind === 'pool') {
    const ps = poolSpot(shape, 2.6);
    addPool(lv, shape, T, ps.x, ps.y, 2.6, room.seed);
  }

  // --- 建物（家の島と 町）---
  let buildings = [];
  if (flat) {
    buildings = world.buildings.filter(b => b.roomId === room.id);
    const plots = room.kind === 'home'
      ? [{ dx: -2, dy: -5, w: 4, h: 3 }]
      : [{ dx: -6, dy: -6, w: 4, h: 3 }, { dx: -1, dy: -7, w: 4, h: 3 }, { dx: 3, dy: -5, w: 4, h: 3 },
         { dx: -6, dy: -1, w: 4, h: 3 }, { dx: 2, dy: 0, w: 4, h: 3 }, { dx: -3, dy: 4, w: 4, h: 3 }];
    buildings.forEach((b, i) => {
      const pl = plots[i % plots.length];
      b.x = Math.round(cx + pl.dx); b.y = Math.round(cy + pl.dy);
      b.w = pl.w; b.h = pl.h;
    });
    lv.buildings = buildings;
    applyBuildings(lv, buildings);
  }

  // --- 中身 ---
  const free = [];
  for (let y = 2; y < H - 2; y++)
    for (let x = 1; x < W - 1; x++) {
      if (!isGround(x, y) || lv.o(x, y) !== O.NONE) continue;
      if (lv.g(x, y) === T.PATH) continue;
      // ふちギリギリに置くと 絵が島から はみ出して見える
      if (!isGround(x - 1, y) || !isGround(x + 1, y)
        || !isGround(x, y - 1) || !isGround(x, y + 1)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < 2.2) continue;                       // まんなかは あけておく
      free.push({ x, y, d });
    }
  // 小さな島で 置き場がなくなったら ふち条件をゆるめる
  if (free.length < 14) {
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        if (!isGround(x, y) || lv.o(x, y) !== O.NONE) continue;
        if (lv.g(x, y) === T.PATH) continue;
        if (Math.hypot(x - cx, y - cy) < 2.2) continue;
        if (free.some(f => f.x === x && f.y === y)) continue;
        free.push({ x, y, d: Math.hypot(x - cx, y - cy) });
      }
  }
  rng.shuffle(free);
  const take = () => free.pop();
  /** 大きく描くものは 島のふちから離れた場所へ */
  const nearBuilding = (x, y) => buildings.some(b =>
    x >= b.x - 2 && x <= b.x + b.w + 1 && y >= b.y - 1 && y <= b.y + b.h + 2);
  const takeInner = () => {
    for (let i = free.length - 1; i >= 0; i--) {
      const c = free[i];
      let ok = !nearBuilding(c.x, c.y);
      for (let oy = -2; oy <= 2 && ok; oy++)
        for (let ox = -2; ox <= 2 && ok; ox++)
          if (!isGround(c.x + ox, c.y + oy)) ok = false;
      if (ok) { free.splice(i, 1); return c; }
    }
    return take();
  };

  const put = (id, n = 1) => {
    for (let i = 0; i < n; i++) {
      const s = take();
      if (!s) return null;
      lv.setO(s.x, s.y, id);
      if (i === n - 1) return s;
    }
    return null;
  };

  decorate(lv, room, rng, put, take, isGround, W, H, cx, cy);

  // --- 特別なもの ---
  const spots = {};
  if (room.content.dungeon != null) {
    const s = takeInner() || { x: Math.round(cx), y: 3 };
    lv.setG(s.x, s.y, T.STONE);
    lv.setO(s.x, s.y, O.CAVE);
    spots.cave = s;
  }
  if (room.content.gate) {
    const s = { x: Math.round(cx - 0.5), y: Math.max(2, Math.round(cy - H * 0.22)) };
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -2; ox <= 2; ox++)
        if (isGround(s.x + ox, s.y + oy)) { lv.setG(s.x + ox, s.y + oy, T.STONE); lv.setO(s.x + ox, s.y + oy, O.NONE); }
    lv.setO(s.x, s.y, O.GATE);
    spots.gate = s;
  }
  if (room.content.cage) {
    const s = take() || { x: Math.round(cx), y: Math.round(cy) + 3 };
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++)
        if (isGround(s.x + ox, s.y + oy)) lv.setO(s.x + ox, s.y + oy, O.NONE);
    lv.setO(s.x, s.y, O.CAGE);
    spots.cage = s;
  }
  if (room.content.chest) spots.chest = put(O.CHEST);
  if (room.content.vending) { const sp = takeInner(); if (sp) { lv.setO(sp.x, sp.y, O.VENDING); spots.vending = sp; } }
  if (room.content.shrine) { const sp = takeInner(); if (sp) { lv.setO(sp.x, sp.y, O.SHRINE); spots.shrine = sp; } }
  if (room.content.sign != null) spots.sign = put(O.SIGN);

  // --- 敵の湧きどころ ---
  const mobs = [];
  const count = KIND[room.kind].mobs + (room.depth > 4 ? 1 : 0);
  const pool = MOB_POOL[room.kind] || ['slime'];
  for (let i = 0; i < count; i++) {
    const s = take();
    if (!s) break;
    mobs.push({ x: s.x, y: s.y, kind: rng.pick(pool), level: clamp(1 + Math.floor(room.depth / 3), 1, 4) });
  }

  return { level: lv, gateways, spots, mobs, buildings, w: W, h: H, center: { x: cx * 16, y: cy * 16 } };
}

const MOB_POOL = {
  home: [], town: [],
  glade: ['slime'], crates: ['slime', 'bat'],
  forest: ['slime', 'spore', 'wolf'], mushroom: ['spore', 'slime'],
  rocks: ['bat', 'skeleton'], pool: ['slime', 'bat'],
  bridge: ['bat', 'wolf'], graveyard: ['skeleton', 'bat'],
  ruins: ['skeleton', 'wolf'], ash: ['skeleton', 'bat', 'wolf'],
  playground: ['slime', 'bat'], library: ['spore', 'skeleton'],
};

/** 島ごとの飾りつけ */
function decorate(lv, room, rng, put, take, isGround, W, H, cx, cy) {
  const k = room.kind;
  const scatter = (id, n) => { for (let i = 0; i < n; i++) put(id); };

  // どの島にも すこしだけ草と花
  scatter(O.TUFT, 4 + rng.int(5));
  scatter(O.FLOWER, 1 + rng.int(3));

  if (k === 'forest') { scatter(O.TREE, 7 + rng.int(5)); scatter(O.PINE, 2 + rng.int(3)); scatter(O.BUSH, 3); }
  else if (k === 'glade') { scatter(O.TREE, 1 + rng.int(2)); scatter(O.BUSH, 2 + rng.int(3)); }
  else if (k === 'crates') { scatter(O.CRATE, 3); scatter(O.BUSH, 2); scatter(O.TREE, 1); }
  else if (k === 'mushroom') { scatter(O.SPOREDEC ?? O.BUSH, 4); scatter(O.TREE, 2); scatter(O.POT, 2); }
  else if (k === 'rocks') { scatter(O.ROCK, 5 + rng.int(4)); scatter(O.BUSH, 1); }
  else if (k === 'pool') { scatter(O.ROCK, 3); scatter(O.BUSH, 3); }
  else if (k === 'bridge') { scatter(O.ROCK, 2); scatter(O.BUSH, 3); }
  else if (k === 'graveyard') { scatter(O.GRAVE, 5 + rng.int(3)); scatter(O.DEADTREE, 2); }
  else if (k === 'ruins') { scatter(O.PILLAR, 4); scatter(O.ROCK, 3); scatter(O.DEADTREE, 1); }
  else if (k === 'ash') { scatter(O.DEADTREE, 5 + rng.int(3)); scatter(O.ROCK, 3); scatter(O.GRAVE, 1); }
  else if (k === 'playground') { scatter(O.CRATE, 2); scatter(O.LAMP, 1); scatter(O.BUSH, 2); scatter(O.POT, 2); }
  else if (k === 'library') { scatter(O.PILLAR, 2); scatter(O.CRATE, 2); scatter(O.BUSH, 2); scatter(O.LAMP, 1); }
  else if (k === 'home') { scatter(O.BUSH, 3); scatter(O.TREE, 2); scatter(O.CRATE, 1); }
  else if (k === 'town') { scatter(O.BUSH, 2); scatter(O.LAMP, 2); }
}
