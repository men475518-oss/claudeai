// ---------------------------------------------------------------------------
// save.js — localStorage への保存と復元
// ---------------------------------------------------------------------------
import { SAVE_KEY } from './config.js';

function rleEncode(arr) {
  let out = '', run = 0, cur = arr[0] || 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] ? 1 : 0;
    if (v === cur) run++;
    else { out += run.toString(36) + (cur ? 'x' : '.'); cur = v; run = 1; }
  }
  out += run.toString(36) + (cur ? 'x' : '.');
  return out;
}

function rleDecode(str, len) {
  const arr = new Uint8Array(len);
  let i = 0, num = '';
  for (const ch of str) {
    if (ch === 'x' || ch === '.') {
      const n = parseInt(num, 36) || 0;
      if (ch === 'x') arr.fill(1, i, Math.min(len, i + n));
      i += n; num = '';
      if (i >= len) break;
    } else num += ch;
  }
  return arr;
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function saveGame(g) {
  try {
    const p = g.player;
    const data = {
      v: 1,
      seed: g.seed,
      time: g.playTime,
      levelId: 'field',
      px: g.levelId === 'field' ? p.x : g.overworld.townX * 16 + 8,
      py: g.levelId === 'field' ? p.y : g.overworld.townY * 16 + 8,
      hp: p.hp, maxHp: p.maxHp,
      coins: p.coins, keys: p.keys, gems: p.gems,
      bombs: p.bombs, potions: p.potions,
      swordLv: p.swordLv, magic: p.magic, item: p.item, relics: p.relics,
      buildings: g.overworld.level.buildings.map(b => (b.built ? 1 : 0)),
      villagers: g.overworld.villagers.map(v => (v.freed ? 1 : 0)),
      dungeons: g.overworld.dungeons.map(d => (d.cleared ? 1 : 0)),
      opened: [...g.openedChests],
      explored: rleEncode(g.overworld.level.explored),
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
    if (!d || d.v !== 1) return null;
    return d;
  } catch { return null; }
}

export function applySave(g, d) {
  const p = g.player;
  p.x = d.px; p.y = d.py;
  p.hp = d.hp; p.maxHp = d.maxHp;
  p.coins = d.coins; p.keys = d.keys; p.gems = d.gems || 0;
  p.bombs = d.bombs; p.potions = d.potions;
  p.swordLv = d.swordLv; p.magic = d.magic || 0; p.item = d.item || 'bomb';
  p.relics = d.relics || 0;
  g.playTime = d.time || 0;
  g.rescued = d.rescued || 0;
  g.gateOpen = !!d.gateOpen;
  g.won = !!d.won;
  g.kills = d.kills || 0;
  const lv = g.overworld.level;
  (d.buildings || []).forEach((v, i) => { if (lv.buildings[i]) lv.buildings[i].built = !!v; });
  (d.villagers || []).forEach((v, i) => { if (g.overworld.villagers[i]) g.overworld.villagers[i].freed = !!v; });
  (d.dungeons || []).forEach((v, i) => { if (g.overworld.dungeons[i]) g.overworld.dungeons[i].cleared = !!v; });
  g.openedChests = new Set(d.opened || []);
  if (d.explored) lv.explored.set(rleDecode(d.explored, lv.explored.length));
  return true;
}

export function deleteSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* 消せなくても問題ない */ }
}
