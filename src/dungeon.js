// ---------------------------------------------------------------------------
// dungeon.js — ダンジョン（洞窟・神殿）の自動生成
// ---------------------------------------------------------------------------
import { Level, T, O } from './world.js';
import { makeRng } from './util.js';

const THEME = {
  forest: { floor: T.FLOOR, wall: T.WALL, mobs: ['slime', 'spore', 'wolf'], boss: 'warden' },
  cave:   { floor: T.STONE, wall: T.WALL, mobs: ['bat', 'slime', 'skeleton'], boss: 'warden' },
  ruin:   { floor: T.FLOOR, wall: T.RUIN, mobs: ['skeleton', 'bat', 'wolf', 'spore'], boss: 'warden' },
};

function carveRoom(lv, r, floor) {
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++)
      if (lv.inb(x, y)) { lv.setG(x, y, floor); lv.setO(x, y, O.NONE); }
}

function carveCorridor(lv, ax, ay, bx, by, floor, horizFirst) {
  const trail = [];
  let x = ax, y = ay;
  const put = () => {
    for (let oy = 0; oy <= 1; oy++)
      for (let ox = 0; ox <= 1; ox++) {
        if (!lv.inb(x + ox, y + oy)) continue;
        lv.setG(x + ox, y + oy, floor);
        lv.setO(x + ox, y + oy, O.NONE);
      }
    trail.push({ x, y });
  };
  put();
  if (horizFirst) {
    while (x !== bx) { x += Math.sign(bx - x); put(); }
    while (y !== by) { y += Math.sign(by - y); put(); }
  } else {
    while (y !== by) { y += Math.sign(by - y); put(); }
    while (x !== bx) { x += Math.sign(bx - x); put(); }
  }
  return trail;
}

export function generateDungeon(def, playerLevel = 1) {
  const rng = makeRng(def.seed);
  const theme = THEME[def.theme] || THEME.cave;
  const W = 46 + def.level * 6, H = 46 + def.level * 6;
  const lv = new Level(W, H, 'dungeon');
  lv.id = def.id;
  lv.name = def.name;
  lv.music = 'dungeon';
  lv.ground.fill(theme.wall);

  // --- 部屋を配置 ---
  const rooms = [];
  const tries = 260;
  const maxRooms = 9 + def.level * 2;
  for (let i = 0; i < tries && rooms.length < maxRooms; i++) {
    const w = rng.irange(6, 11), h = rng.irange(5, 10);
    const x = rng.irange(2, W - w - 3), y = rng.irange(2, H - h - 3);
    const r = { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) };
    if (rooms.some(o => x < o.x + o.w + 3 && x + w + 3 > o.x && y < o.y + o.h + 3 && y + h + 3 > o.y)) continue;
    rooms.push(r);
  }
  if (rooms.length < 4) {   // 保険
    for (let i = rooms.length; i < 4; i++) {
      const x = 3 + (i % 2) * ((W >> 1) + 2), y = 3 + ((i / 2) | 0) * ((H >> 1) + 2);
      rooms.push({ x, y, w: 8, h: 7, cx: x + 4, cy: y + 3 });
    }
  }
  for (const r of rooms) carveRoom(lv, r, theme.floor);

  // --- 通路で数珠つなぎ＋ループを 2 本 ---
  const doorTrails = [];
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    doorTrails.push(carveCorridor(lv, a.cx, a.cy, b.cx, b.cy, theme.floor, rng() < 0.5));
  }
  for (let k = 0; k < 2 && rooms.length > 3; k++) {
    const a = rng.pick(rooms), b = rng.pick(rooms);
    if (a !== b) carveCorridor(lv, a.cx, a.cy, b.cx, b.cy, theme.floor, rng() < 0.5);
  }

  // --- 入口とボス部屋 ---
  const start = rooms[0];
  const bossRoom = rooms[rooms.length - 1];
  const spawn = { x: start.cx, y: start.y + start.h - 2 };
  lv.setO(spawn.x, spawn.y + 1 < H ? spawn.y : spawn.y, O.NONE);
  lv.setG(start.cx, start.cy, theme.floor);
  const exitTile = { x: start.cx, y: start.cy };
  lv.setO(exitTile.x, exitTile.y, O.EXIT);

  // ボス部屋を少し広げ、床を整える
  carveRoom(lv, { x: bossRoom.x - 1, y: bossRoom.y - 1, w: bossRoom.w + 2, h: bossRoom.h + 2 }, theme.floor);
  bossRoom.x--; bossRoom.y--; bossRoom.w += 2; bossRoom.h += 2;
  bossRoom.cx = bossRoom.x + (bossRoom.w >> 1); bossRoom.cy = bossRoom.y + (bossRoom.h >> 1);

  // --- カギ付きの扉：ボス部屋直前の通路に置く ---
  let doorPos = null;
  const lastTrail = doorTrails[doorTrails.length - 1];
  if (lastTrail) {
    for (let i = lastTrail.length - 1; i >= 0; i--) {
      const p = lastTrail[i];
      const inBoss = p.x >= bossRoom.x - 1 && p.x < bossRoom.x + bossRoom.w + 1 &&
                     p.y >= bossRoom.y - 1 && p.y < bossRoom.y + bossRoom.h + 1;
      if (!inBoss) { doorPos = p; break; }
    }
  }
  if (doorPos) {
    lv.setO(doorPos.x, doorPos.y, O.DOOR);
    lv.setO(doorPos.x + 1, doorPos.y, O.DOOR);
    lv.setO(doorPos.x, doorPos.y + 1, O.DOOR);
    lv.setO(doorPos.x + 1, doorPos.y + 1, O.DOOR);
  }

  // --- 中身：宝箱・カギ・壺・敵 ---
  const enemies = [];
  const chests = [];
  const mid = rooms.slice(1, -1);
  const keyRoom = mid.length ? mid[mid.length - 1] : rooms[0];

  const placeIn = (r, fn, count) => {
    for (let n = 0; n < count; n++) {
      for (let k = 0; k < 60; k++) {
        const x = rng.irange(r.x + 1, r.x + r.w - 2);
        const y = rng.irange(r.y + 1, r.y + r.h - 2);
        if (lv.solid(x, y) || lv.o(x, y) !== O.NONE) continue;
        if (fn(x, y)) break;
      }
    }
  };

  // カギ
  placeIn(keyRoom, (x, y) => { lv.setO(x, y, O.CHEST); chests.push({ x, y, loot: 'key' }); return true; }, 1);

  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (r === bossRoom) continue;
    const count = i === 0 ? 0 : rng.irange(1, 2 + def.level);
    placeIn(r, (x, y) => {
      enemies.push({ x, y, kind: rng.pick(theme.mobs), level: def.level });
      return true;
    }, count);
    if (i > 0 && rng() < 0.45) {
      placeIn(r, (x, y) => {
        lv.setO(x, y, O.CHEST);
        chests.push({ x, y, loot: rng() < 0.3 ? 'heart' : rng() < 0.6 ? 'coins' : rng() < 0.8 ? 'bomb' : 'potion' });
        return true;
      }, 1);
    }
    placeIn(r, (x, y) => { lv.setO(x, y, O.POT); return true; }, rng.irange(0, 3));
    // 灯り
    if (rng() < 0.8) {
      lv.setO(r.x + 1, r.y + 1, O.TORCH);
      lv.setO(r.x + r.w - 2, r.y + 1, O.TORCH);
    }
  }

  // --- ひび割れた壁のむこうの隠し部屋（爆弾で開ける）---
  const secrets = [];
  for (const r of rng.shuffle(mid.slice())) {
    if (secrets.length >= 2) break;
    const sides = rng.shuffle([[0, -1], [0, 1], [-1, 0], [1, 0]]);
    let placed = false;
    for (const [dx, dy] of sides) {
      if (placed) break;
      const ax = r.cx + dx * ((r.w >> 1) + 3);
      const ay = r.cy + dy * ((r.h >> 1) + 3);
      if (ax < 3 || ay < 3 || ax > W - 5 || ay > H - 5) continue;
      // 掘る先が全部 壁であること（他の部屋を壊さない）
      let clear = true;
      for (let y = ay - 1; y <= ay + 1 && clear; y++)
        for (let x = ax - 1; x <= ax + 1 && clear; x++)
          if (lv.g(x, y) !== theme.wall) clear = false;
      if (!clear) continue;
      // 部屋から通路を掘り、境目に ひび割れ を置く
      const cx0 = r.cx + dx * ((r.w >> 1) - 1), cy0 = r.cy + dy * ((r.h >> 1) - 1);
      let x = cx0, y = cy0, guard = 0, crackAt = null;
      while ((x !== ax || y !== ay) && guard++ < 40) {
        if (lv.g(x, y) === theme.wall && !crackAt) crackAt = { x, y };
        lv.setG(x, y, theme.floor);
        lv.setO(x, y, O.NONE);
        if (x !== ax) x += Math.sign(ax - x); else y += Math.sign(ay - y);
      }
      carveRoom(lv, { x: ax - 1, y: ay - 1, w: 3, h: 3 }, theme.floor);
      if (crackAt) { lv.setO(crackAt.x, crackAt.y, O.CRACK); secrets.push(crackAt); }
      lv.setO(ax, ay, O.CHEST);
      chests.push({ x: ax, y: ay, loot: rng() < 0.5 ? 'heart' : 'coins' });
      lv.setO(ax - 1, ay - 1, O.TORCH);
      placed = true;
    }
  }

  // ボス部屋のおくに「向こう側」への門
  const portalPos = { x: bossRoom.cx, y: bossRoom.y + 2 };
  lv.setO(portalPos.x, portalPos.y, O.PORTAL);
  lv.setO(portalPos.x - 2, portalPos.y, O.TORCH);
  lv.setO(portalPos.x + 2, portalPos.y, O.TORCH);
  for (let x = bossRoom.x + 1; x < bossRoom.x + bossRoom.w - 1; x++)
    for (let y = bossRoom.y + 1; y < bossRoom.y + bossRoom.h - 1; y++)
      if (lv.o(x, y) === O.POT) lv.setO(x, y, O.NONE);

  // 壁際の飾り
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (lv.g(x, y) === theme.floor && rng() < 0.012 && lv.o(x, y) === O.NONE)
        lv.setO(x, y, O.POT);

  return { level: lv, spawn, exitTile, rooms, bossRoom, portalPos, enemies, chests, doorPos, secrets, theme: def.theme };
}
