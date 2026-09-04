// ---------------------------------------------------------------------------
// dungeon.js — ダンジョン（洞窟・神殿）の自動生成
// ---------------------------------------------------------------------------
import { Level, T, O } from './world.js';
import { makeRng, clamp } from './util.js';

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

  // ボス
  const boss = { x: bossRoom.cx, y: bossRoom.y + 2, kind: theme.boss, level: def.level, boss: true };
  const relicPos = { x: bossRoom.cx, y: bossRoom.cy + Math.max(1, (bossRoom.h >> 1) - 2) };

  // 壁際の飾り
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (lv.g(x, y) === theme.floor && rng() < 0.012 && lv.o(x, y) === O.NONE)
        lv.setO(x, y, O.POT);

  return { level: lv, spawn, exitTile, rooms, bossRoom, boss, relicPos, enemies, chests, doorPos, theme: def.theme };
}
