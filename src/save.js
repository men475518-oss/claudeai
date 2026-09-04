// ---------------------------------------------------------------------------
// save.js — localStorage への保存と復元
//   世界はシードから作りなおせるので、残すのは「変わったこと」だけでよい。
// ---------------------------------------------------------------------------
import { SAVE_KEY } from './config.js';

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function saveGame(g) {
  try {
    const p = g.player;
    const visited = [];
    for (const [id, r] of g.world.rooms) if (r.visited) visited.push(id);
    const data = {
      v: 2,
      seed: g.seed,
      time: g.playTime,
      roomId: g.levelId.startsWith('room:') ? g.roomId : (g.returnRoomId || g.world.startId),
      hp: p.hp, maxHp: p.maxHp,
      coins: p.coins, keys: p.keys, gems: p.gems,
      bombs: p.bombs, potions: p.potions,
      swordLv: p.swordLv, magic: p.magic, mp: p.mp, maxMp: p.maxMp,
      item: p.item, relics: p.relics,
      buildings: g.world.buildings.map(b => (b.built ? 1 : 0)),
      villagers: g.world.villagers.map(v => (v.freed ? 1 : 0)),
      dungeons: g.world.dungeons.map(d => (d.cleared ? 1 : 0)),
      relicTaken: g.world.dungeons.map(d => (d.relicTaken ? 1 : 0)),
      opened: [...g.openedChests],
      visited,
      rescued: g.rescued,
      gateOpen: g.gateOpen ? 1 : 0,
      won: g.won ? 1 : 0,
      kills: g.kills,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('セーブに失敗しました', e);
    return false;
  }
}

export function loadSaveData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 2) return null;      // 古い形式は読まない
    return d;
  } catch { return null; }
}

export function applySave(g, d) {
  const p = g.player;
  p.hp = d.hp; p.maxHp = d.maxHp;
  p.coins = d.coins; p.keys = d.keys; p.gems = d.gems || 0;
  p.bombs = d.bombs; p.potions = d.potions;
  p.swordLv = d.swordLv; p.magic = d.magic || 0;
  p.mp = d.mp || 0; p.maxMp = d.maxMp || 0;
  p.item = d.item || 'bomb';
  p.relics = d.relics || 0;
  g.playTime = d.time || 0;
  g.rescued = d.rescued || 0;
  g.gateOpen = !!d.gateOpen;
  g.won = !!d.won;
  g.kills = d.kills || 0;
  const w = g.world;
  (d.buildings || []).forEach((v, i) => { if (w.buildings[i]) w.buildings[i].built = !!v; });
  (d.villagers || []).forEach((v, i) => { if (w.villagers[i]) w.villagers[i].freed = !!v; });
  (d.dungeons || []).forEach((v, i) => { if (w.dungeons[i]) w.dungeons[i].cleared = !!v; });
  (d.relicTaken || []).forEach((v, i) => { if (w.dungeons[i]) w.dungeons[i].relicTaken = !!v; });
  for (const id of (d.visited || [])) { const r = w.rooms.get(id); if (r) r.visited = true; }
  g.openedChests = new Set(d.opened || []);
  return true;
}

export function deleteSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* 消せなくても問題ない */ }
}
