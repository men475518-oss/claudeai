// ---------------------------------------------------------------------------
// rooms.js — 世界は「小さな島」がいくつも つながった かたち
//   ひとつの島がひとつの画面。端の小道から となりの島へ移る。
//   全体の形はグリッド上のグラフとして持ち、マップ画面はそれを点と線で描く。
// ---------------------------------------------------------------------------
import { Level, T, O, BUILDINGS, applyBuildings } from './world.js';
import { makeRng, fbm, clamp } from './util.js';

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
    return pool[rng.int(pool.length)] + '（おく）';
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
  const rx = W / 2 - 1.9, ry = H / 2 - 2.0;
  const flat = room.kind === 'town' || room.kind === 'home';
  const power = flat ? 2.8 : 1.45 + rng() * 0.4;   // 1.0 でひし形、2.0 で楕円
  const wob = flat ? 0.10 : 0.30 + rng() * 0.18;

  const inside = (x, y) => {
    const dx = Math.abs((x + 0.5 - cx) / rx);
    const dy = Math.abs((y + 0.5 - cy) / ry);
    const d = Math.pow(dx, power) + Math.pow(dy, power);
    const n = (fbm(x / 4.5, y / 4.5, room.seed) - 0.5) * wob;
    return d + n <= 1;
  };

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (inside(x, y)) lv.setG(x, y, T.MOSS);

  // --- 出口へのびる くびれた通路（島の外がわだけ掘る）---
  const gateways = {};
  const midX = Math.round(cx - 0.5), midY = Math.round(cy - 0.5);
  for (const dir of DIRS) {
    if (!room.exits[dir]) continue;
    const [dx, dy] = DV[dir];
    // まず 島のふちまで進む
    let x = midX, y = midY;
    while (lv.inb(x + dx, y + dy) && inside(x + dx, y + dy)) { x += dx; y += dy; }
    // そこから 外へ 3 マス幅の首を のばす
    let gx = x, gy = y;
    while (lv.inb(x, y)) {
      for (let o = -1; o <= 1; o++) {
        const px = dx !== 0 ? x : x + o;
        const py = dy !== 0 ? y : y + o;
        if (lv.inb(px, py)) lv.setG(px, py, T.MOSS);
      }
      gx = x; gy = y;
      x += dx; y += dy;
    }
    gateways[dir] = { x: clamp(gx, 0, W - 1), y: clamp(gy, 0, H - 1) };
  }

  // --- ふちの濃い緑 ---
  const isGround = (x, y) => lv.inb(x, y) && lv.g(x, y) !== T.VOID;
  const edgeDist = new Int8Array(W * H).fill(9);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!isGround(x, y)) continue;
      let near = 9;
      for (let oy = -2; oy <= 2; oy++)
        for (let ox = -2; ox <= 2; ox++)
          if (!isGround(x + ox, y + oy)) near = Math.min(near, Math.max(Math.abs(ox), Math.abs(oy)));
      edgeDist[y * W + x] = near;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!isGround(x, y)) continue;
      if (edgeDist[y * W + x] <= 1) lv.setG(x, y, T.ISLE_D);
      else if (fbm(x / 3.2 + 11, y / 3.2 + 7, room.seed + 5) > 0.60) lv.setG(x, y, T.ISLE_L);
    }

  // --- 小道（中心から 各出口へ）---
  for (const dir of Object.keys(gateways)) {
    const gwe = gateways[dir];
    const [dx, dy] = DV[dir];
    let x = midX, y = midY;
    for (let step = 0; step < Math.max(W, H) + 2; step++) {
      const jig = Math.round(Math.sin(step * 0.45 + (room.seed % 11)) * 1.3);
      const wide = (step % 3 === 0) ? 2 : 1;
      for (let w = 0; w < wide; w++) {
        const px = dx !== 0 ? x : x + jig + w;
        const py = dy !== 0 ? y : y + jig + w;
        if (isGround(px, py)) lv.setG(px, py, T.PATH);
      }
      if (x === gwe.x && y === gwe.y) break;
      x += dx; y += dy;
      if (x < 0 || y < 0 || x >= W || y >= H) break;
    }
  }

  // --- 通り道の入口に しるし（となりへ行く床）---
  for (const dir of Object.keys(gateways)) {
    const gwe = gateways[dir];
    lv.setO(gwe.x, gwe.y, O.GATEWAY);
  }

  // --- 中身 ---
  const free = [];
  for (let y = 2; y < H - 2; y++)
    for (let x = 1; x < W - 1; x++) {
      if (!isGround(x, y) || lv.o(x, y) !== O.NONE) continue;
      if (lv.g(x, y) === T.PATH) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < 2.2) continue;                       // まんなかは あけておく
      free.push({ x, y, d });
    }
  rng.shuffle(free);
  const take = () => free.pop();

  const put = (id, n = 1) => {
    for (let i = 0; i < n; i++) {
      const s = take();
      if (!s) return null;
      lv.setO(s.x, s.y, id);
      if (i === n - 1) return s;
    }
    return null;
  };

  // --- 建物（家の島と 町）---
  let buildings = [];
  if (room.kind === 'home' || room.kind === 'town') {
    buildings = world.buildings.filter(b => b.roomId === room.id);
    const plots = room.kind === 'home'
      ? [{ dx: -2, dy: -5, w: 4, h: 3 }]
      : [{ dx: -6, dy: -6, w: 4, h: 3 }, { dx: -1, dy: -7, w: 4, h: 3 }, { dx: 3, dy: -5, w: 4, h: 3 },
         { dx: -6, dy: -1, w: 4, h: 3 }, { dx: 2, dy: 0, w: 4, h: 3 }, { dx: -3, dy: 4, w: 4, h: 3 }];
    buildings.forEach((b, i) => {
      const pl = plots[i % plots.length];
      b.x = Math.round(cx + pl.dx); b.y = Math.round(cy + pl.dy);
      b.w = pl.w; b.h = pl.h;
      for (let y = b.y - 1; y < b.y + b.h + 1; y++)
        for (let x = b.x - 1; x < b.x + b.w + 1; x++)
          if (lv.inb(x, y)) lv.setG(x, y, lv.g(x, y) === T.VOID ? T.MOSS : lv.g(x, y));
    });
    lv.buildings = buildings;
    applyBuildings(lv, buildings);
  }

  decorate(lv, room, rng, put, take, isGround, W, H, cx, cy);

  // --- 特別なもの ---
  const spots = {};
  if (room.content.dungeon != null) {
    const s = take() || { x: Math.round(cx), y: 3 };
    lv.setG(s.x, s.y, T.STONE);
    lv.setO(s.x, s.y, O.CAVE);
    spots.cave = s;
  }
  if (room.content.gate) {
    const s = { x: Math.round(cx - 0.5), y: Math.max(2, Math.round(cy - ry * 0.55)) };
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
  if (room.content.vending) spots.vending = put(O.VENDING);
  if (room.content.shrine) spots.shrine = put(O.SHRINE);
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
  else if (k === 'pool') {
    // まんなかに 小さな水たまり
    const px = Math.round(cx - 0.5) + 2, py = Math.round(cy - 0.5) + 2;
    for (let oy = -3; oy <= 3; oy++)
      for (let ox = -3; ox <= 3; ox++) {
        const d = Math.hypot(ox * 0.9, oy * 1.25) + (fbm(ox * 0.7 + 3, oy * 0.7 + 5, room.seed) - 0.5) * 1.1;
        if (d < 2.5 && isGround(px + ox, py + oy)) lv.setG(px + ox, py + oy, T.WATER);
      }
    scatter(O.ROCK, 2); scatter(O.BUSH, 2);
  }
  else if (k === 'bridge') { scatter(O.ROCK, 2); scatter(O.BUSH, 3); }
  else if (k === 'graveyard') { scatter(O.GRAVE, 5 + rng.int(3)); scatter(O.DEADTREE, 2); }
  else if (k === 'ruins') { scatter(O.PILLAR, 4); scatter(O.ROCK, 3); scatter(O.DEADTREE, 1); }
  else if (k === 'ash') { scatter(O.DEADTREE, 5 + rng.int(3)); scatter(O.ROCK, 3); scatter(O.GRAVE, 1); }
  else if (k === 'playground') { scatter(O.CRATE, 2); scatter(O.LAMP, 1); scatter(O.BUSH, 2); scatter(O.POT, 2); }
  else if (k === 'library') { scatter(O.PILLAR, 2); scatter(O.CRATE, 2); scatter(O.BUSH, 2); scatter(O.LAMP, 1); }
  else if (k === 'home') { scatter(O.BUSH, 3); scatter(O.TREE, 2); scatter(O.CRATE, 1); }
  else if (k === 'town') { scatter(O.BUSH, 2); scatter(O.LAMP, 2); }
}
