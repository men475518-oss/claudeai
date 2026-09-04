// ---------------------------------------------------------------------------
// AFTERGROVE — 縦持ち・片手操作の探索アクション RPG
// main.js : 全体の進行・状態遷移・当たり判定の解決
// ---------------------------------------------------------------------------
import { TILE, PLAYER, UI } from './config.js';
import { clamp, dist, DIR_VEC, formatTime } from './util.js';
import { buildArt, SPR, PAL } from './art.js';
import { initInput, updateInput, endInputFrame, input, setButtons, clearHeld } from './input.js';
import { initAudio, sfx, playMusic, stopMusic, toggleMute, isMuted, resumeAudio, duckMusic } from './audio.js';
import * as R from './render.js';
import * as FX from './fx.js';
import * as UIx from './ui.js';
import { generateOverworld, layoutTown, applyBuildings, O, OBJ_DEF, BUILDINGS, TERRAIN_NAME } from './world.js';
import { generateDungeon } from './dungeon.js';
import { Player, Enemy, Pickup, Projectile, Npc, Bomb } from './entities.js';
import { hasSave, saveGame, loadSaveData, applySave, deleteSave } from './save.js';

const canvas = document.getElementById('screen');
const boot = document.getElementById('boot');

// ---------------------------------------------------------------------------
const g = {
  seed: 0,
  state: 'title',           // title | play | gameover | ending
  stateT: 0,
  playTime: 0,
  level: null, levelId: 'field',
  overworld: null,
  dungeons: {},             // id -> 生成結果
  player: null,
  enemies: [], pickups: [], projectiles: [], npcs: [], bombs: [],
  openedChests: new Set(),
  rescued: 0, kills: 0,
  gateOpen: false, won: false,
  input,
  canAct: true,
  camx: 0, camy: 0,
  mapOpen: false,
  spawnTimer: 0,
  transition: null,         // {t, dur, action}
  interact: null,
  saveSummary: '',
  autoSaveT: 0,
};
window.__game = g;
g.view = R.view;          // デバッグ／自動テスト用に表示情報を公開

// --- ヘルパ（entities / render から呼ばれる）--------------------------------
g.drawList = function () {
  const out = [];
  for (const e of g.npcs) out.push(e);
  for (const e of g.enemies) if (!e.dead) out.push(e);
  for (const e of g.pickups) out.push(e);
  for (const e of g.bombs) out.push(e);
  for (const e of g.projectiles) out.push(e);
  if (g.player && g.player.hp > 0) out.push(g.player);
  else if (g.player && g.state !== 'gameover') out.push(g.player);
  return out;
};
g.spawnPickup = function (x, y, kind, amount = 1) {
  g.pickups.push(new Pickup(x, y, kind, amount));
};
g.spawnEnemy = function (x, y, kind, level = 1) {
  const e = new Enemy(x, y, kind, level);
  g.enemies.push(e);
  return e;
};
g.spawnProjectile = function (x, y, angle, speed, dmg, kind, friendly = false) {
  g.projectiles.push(new Projectile(x, y, angle, speed, dmg, kind, friendly));
};
g.collect = function (p) {
  const pl = g.player;
  if (p.kind === 'coin') { pl.coins += p.amount || 1; sfx('coin'); }
  else if (p.kind === 'heart') { pl.heal(2); sfx('heart'); }
  else if (p.kind === 'key') { pl.keys++; sfx('gem'); UIx.toast('カギ を てにいれた'); }
  else if (p.kind === 'gem') { pl.gems++; pl.coins += 25; sfx('gem'); UIx.toast('宝石！ +25 コイン'); }
  else if (p.kind === 'bomb') { pl.bombs++; sfx('coin'); }
  else if (p.kind === 'potion') { pl.potions++; sfx('coin'); }
  else if (p.kind === 'star') { pl.heal(99); sfx('levelup'); }
};
g.blastTiles = function (px, py, r = 2) {
  const cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      if (Math.hypot(x - cx, y - cy) > r + 0.2) continue;
      const id = g.level.o(x, y);
      if (!id) continue;
      const def = OBJ_DEF[id];
      if (def && def.hp > 0) damageObject(x, y, 99);
      else if (id === O.CRACK) { g.level.setO(x, y, O.NONE); FX.burst(x * TILE + 8, y * TILE + 8, 10, [PAL.w, PAL.v]); }
    }
};
g.onBossDefeated = function (boss) {
  const dg = g.dungeons[g.levelId];
  if (!dg) return;
  const def = g.overworld.dungeons.find(d => d.id === g.levelId);
  if (def && !def.cleared) {
    def.cleared = true;
    g.level.setO(dg.relicPos.x, dg.relicPos.y, O.RELIC);
    // 扉を開ける
    if (dg.doorPos) for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]])
      if (g.level.o(dg.doorPos.x + ox, dg.doorPos.y + oy) === O.DOOR) g.level.setO(dg.doorPos.x + ox, dg.doorPos.y + oy, O.NONE);
  }
  FX.flash('#ffffff', 0.7);
  playMusic('dungeon');
  setTimeout(() => UIx.toast('番人をたおした！', 'おくに 遺物が あらわれた'), 700);
};

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
function boot0() {
  buildArt();
  R.initRender(canvas);
  R.resize();
  UIx.layoutUi();
  initInput(canvas);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  refreshSaveSummary();

  // タイトル用に世界だけ用意（プレイヤーは newGame で置く）
  g.state = 'title'; g.stateT = 0;
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 400);
  requestAnimationFrame(loop);
}

let saveExists = false;
function refreshSaveSummary() {
  saveExists = hasSave();
  const d = saveExists ? loadSaveData() : null;
  g.saveSummary = d ? `♥${Math.ceil(d.hp / 2)}  ${d.coins}コイン  ${formatTime(d.time || 0)}` : '';
}

function onResize() {
  R.resize();
  UIx.layoutUi();
  UIx.invalidateMap();
}

// ---------------------------------------------------------------------------
// ゲーム開始
// ---------------------------------------------------------------------------
function newGame(seed) {
  g.seed = seed >>> 0;
  g.overworld = generateOverworld(g.seed);
  const ow = g.overworld;
  ow.level.buildings = layoutTown(ow.level, ow.townX, ow.townY);
  g.openedChests = new Set();
  g.rescued = 0; g.kills = 0; g.gateOpen = false; g.won = false;
  g.playTime = 0;
  g.player = new Player(ow.townX * TILE + 8, (ow.townY + 3) * TILE + 8);
  enterLevel('field', g.player.x, g.player.y, false);
  g.state = 'play'; g.stateT = 0;
  UIx.invalidateMap();
  UIx.openDialog({
    speaker: 'アフターグローヴ',
    text: [
      'まもの に おそわれ、\n村のみんなは 散りぢりに なった。\nのこったのは あなた ひとり。',
      '＜あそびかた＞\n画面を ドラッグ → 歩く\nその場で タップ → 斬る\n長押しして 離す → 回転斬り',
      'まずは 村のまわりを 歩いて、\nとらわれた 村人を さがそう。\n檻は 斬れば こわれる。',
    ],
    onDone: () => UIx.toast('目標：とらわれた村人を さがす', '右上のマップで 行き先が わかる'),
  });
}

function continueGame() {
  const d = loadSaveData();
  if (!d) { newGame((Math.random() * 1e9) | 0); return; }
  g.seed = d.seed >>> 0;
  g.overworld = generateOverworld(g.seed);
  const ow = g.overworld;
  ow.level.buildings = layoutTown(ow.level, ow.townX, ow.townY);
  g.player = new Player(ow.townX * TILE + 8, (ow.townY + 3) * TILE + 8);
  applySave(g, d);
  applyBuildings(ow.level, ow.level.buildings);
  // 開けた宝箱・救出済みの檻を反映
  for (const c of ow.chests) if (g.openedChests.has(`field:${c.x},${c.y}`)) ow.level.setO(c.x, c.y, O.CHEST_OPEN);
  for (const v of ow.villagers) if (v.freed && ow.level.o(v.x, v.y) === O.CAGE) ow.level.setO(v.x, v.y, O.NONE);
  if (ow.gate && g.gateOpen) ow.level.setO(ow.gate.x, ow.gate.y, O.NONE);
  enterLevel('field', g.player.x, g.player.y, false);
  g.state = 'play'; g.stateT = 0;
  UIx.invalidateMap();
}

// ---------------------------------------------------------------------------
// レベル遷移
// ---------------------------------------------------------------------------
function enterLevel(id, px, py, fade = true) {
  const doIt = () => {
    g.enemies.length = 0; g.pickups.length = 0;
    g.projectiles.length = 0; g.bombs.length = 0; g.npcs.length = 0;
    FX.clearFx();

    if (id === 'field') {
      g.level = g.overworld.level;
      g.levelId = 'field';
      if (px == null || py == null) {
        const r = g.returnPos || { x: g.overworld.townX * TILE + 8, y: (g.overworld.townY + 3) * TILE + 8 };
        px = r.x; py = r.y;
      }
      spawnTownNpcs();
    } else {
      let dg = g.dungeons[id];
      const def = g.overworld.dungeons.find(d => d.id === id);
      if (!dg) {
        dg = generateDungeon(def, 1);
        g.dungeons[id] = dg;
        if (def.cleared) {
          // クリア済みなら扉を開けておく
          if (dg.doorPos) for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]])
            if (dg.level.o(dg.doorPos.x + ox, dg.doorPos.y + oy) === O.DOOR)
              dg.level.setO(dg.doorPos.x + ox, dg.doorPos.y + oy, O.NONE);
        }
      }
      g.level = dg.level;
      g.levelId = id;
      // 敵を配置（クリア後も再湧きする）
      for (const e of dg.enemies) g.spawnEnemy(e.x * TILE + 8, e.y * TILE + 8, e.kind, e.level);
      if (!def.cleared) {
        const b = dg.boss;
        const be = g.spawnEnemy(b.x * TILE + 8, b.y * TILE + 8, b.kind, b.level);
        be.aggro = false;
      }
      // 開けた宝箱を反映
      for (const c of dg.chests) if (g.openedChests.has(`${id}:${c.x},${c.y}`)) g.level.setO(c.x, c.y, O.CHEST_OPEN);
      px = px ?? dg.spawn.x * TILE + 8;
      py = py ?? dg.spawn.y * TILE + 8;
    }
    g.player.x = px; g.player.y = py;
    g.player.kbx = g.player.kby = 0;
    g.player.spawnGuard = 0.6;
    R.snapCamera(g.player, g.level);
    g.level.markExplored(g.player.tx, g.player.ty, g.level.dark ? 5 : 9);
    UIx.invalidateMap();
    playMusic(g.level.kind === 'dungeon' ? 'dungeon' : nearTown() ? 'town' : 'field');
    clearHeld();
  };
  if (!fade) { doIt(); return; }
  g.transition = { t: 0, dur: 0.62, half: false, action: doIt };
  sfx('door');
}

function spawnTownNpcs() {
  const ow = g.overworld;
  const built = ow.level.buildings.filter(b => b.built && b.id !== 'home');
  const lines = {
    shop: ['いらっしゃい！\nなにか いるかい？', 'カギ は だいじに とっておきな。'],
    smith: ['剣を きたえてやろう。\nコインを もっておいで。'],
    healer: ['からだを 大事にね。\nハートの器を ふやせるよ。'],
    sage: ['星がめぐり、\n門がひらく…\n遺物を 3つ あつめなさい。'],
    farm: ['きのみが 実ったよ。\nもっていきな。'],
    well: ['この井戸の 水は つめたくて うまい。'],
  };
  let i = 0;
  for (const b of built) {
    const npc = new Npc(b.x * TILE + b.w * TILE / 2, (b.y + b.h) * TILE + 10, i + 2, {
      name: b.name,
      lines: lines[b.id] || ['ようこそ。'],
    });
    g.npcs.push(npc);
    i++;
  }
  // 救出した村人は広場をうろつく
  const n = Math.min(g.rescued, 8);
  for (let k = 0; k < n; k++) {
    const a = (k / Math.max(1, n)) * Math.PI * 2;
    const npc = new Npc(
      ow.townX * TILE + 8 + Math.cos(a) * (34 + k * 4),
      ow.townY * TILE + 8 + Math.sin(a) * (30 + k * 3),
      k, {
        name: '村人',
        lines: [
          ['たすけてくれて ありがとう。\nこの村、また にぎやかに なるといいね。',
           'まもの は 夜に つよくなる…\n気をつけて。',
           'ほら穴の おくには 「番人」が いるらしい。',
           'コインを ためて 家を 建てよう！',
           'くさむら や つぼ を 斬ると\nなにか 出てくるよ。'][k % 5],
        ],
      });
    g.npcs.push(npc);
  }
}

function nearTown() {
  if (g.levelId !== 'field') return false;
  const ow = g.overworld;
  return dist(g.player.tx, g.player.ty, ow.townX, ow.townY) < 14;
}

// ---------------------------------------------------------------------------
// メインループ
// ---------------------------------------------------------------------------
let last = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const t = now / 1000;
  let dt = Math.min(0.05, t - last || 0.016);
  last = t;
  if (dt <= 0) dt = 0.016;

  updateInput(dt);
  R.setTime(t);

  switch (g.state) {
    case 'title': updateTitle(dt, t); break;
    case 'play': updatePlay(dt); break;
    case 'gameover': updateGameOver(dt); break;
    case 'ending': updateEnding(dt); break;
  }
  endInputFrame();
}

// ---------------------------------------------------------------------------
// タイトル
// ---------------------------------------------------------------------------
function updateTitle(dt, t) {
  g.stateT += dt;
  input.stickEnabled = false;
  const canCont = saveExists;
  setButtons(UIx.titleButtons(canCont));
  const pressed = pressedButtons();
  if (pressed.has('title0') || (input.aPressed && !canCont)) {
    startAudio();
    sfx('levelup');
    if (canCont) continueGame(); else newGame((Math.random() * 1e9) | 0);
  } else if (pressed.has('title1')) {
    startAudio();
    sfx('ui');
    deleteSave();
    newGame((Math.random() * 1e9) | 0);
  } else if (input.taps.length && !canCont) {
    startAudio(); sfx('levelup'); newGame((Math.random() * 1e9) | 0);
  }

  const sctx = R.getCtx().sctx;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.fillStyle = '#08070c';
  sctx.fillRect(0, 0, sctx.canvas.width, sctx.canvas.height);
  R.beginUi();
  UIx.drawTitle(sctx, g, t, canCont);
  R.endUi();
}

let audioStarted = false;
function startAudio() {
  if (audioStarted) return;
  audioStarted = true;
  initAudio();
  playMusic('town');
}

// このフレームに押されたボタン ID（pointerdown 時点で確定）
function pressedButtons() { return input.pressedIds; }

// ---------------------------------------------------------------------------
// プレイ
// ---------------------------------------------------------------------------
function updatePlay(dt) {
  const p = g.player;
  // 力尽きたら 開いている UI は畳む（会話中に止まったままにならないように）
  if (p.hp <= 0) {
    if (UIx.dialog.active) { UIx.dialog.active = false; UIx.dialog.onDone = null; }
    if (UIx.menu.active) { UIx.menu.active = false; UIx.menu.onClose = null; }
    g.mapOpen = false;
  }
  const uiBusy = UIx.dialog.active || UIx.menu.active || g.mapOpen;
  input.stickEnabled = !uiBusy && !g.transition;
  g.canAct = !uiBusy && !g.transition && p.hp > 0;

  if (!uiBusy) g.playTime += dt;
  g.autoSaveT += dt;

  // --- 画面遷移 ---
  if (g.transition) {
    g.transition.t += dt;
    if (!g.transition.half && g.transition.t >= g.transition.dur / 2) {
      g.transition.half = true;
      g.transition.action();
    }
    if (g.transition.t >= g.transition.dur) g.transition = null;
  }

  // --- ボタン登録 ---
  const btns = [];
  if (g.mapOpen) {
    // 全面タップで閉じる
  } else if (UIx.menu.active) {
    btns.push(...UIx.registerMenuButtons());
  } else if (UIx.dialog.active) {
    const d = UIx.registerDialogButtons();
    if (d) btns.push(...d);
  } else {
    const L = UIx.controlLayout();
    if (UIx.ui.showControls) {
      const order = ['bomb', 'potion'];
      if (g.player.magic) order.push('magic');
      if (order.length > 1) btns.push({ id: 'swap', x: L.swap.x, y: L.swap.y, r: L.swap.r });
      btns.push({ id: 'b', x: L.b.x, y: L.b.y, r: L.b.r });
      btns.push({ id: 'a', x: L.a.x, y: L.a.y, r: L.a.r });
    }
    const hb = UIx.hudButtonLayout();
    btns.push({ id: 'menu', x: hb.menu.x, y: hb.menu.y, r: hb.menu.r });
    btns.push({ id: 'map', x: hb.map.x, y: hb.map.y, r: hb.map.r });
  }
  setButtons(btns);
  const pressed = pressedButtons();

  // --- UI 状態の処理 ---
  if (g.mapOpen) {
    if (input.taps.length || input.menuPressed || input.mapPressed || input.aPressed) {
      g.mapOpen = false; sfx('uiBack'); clearHeld();
    }
  } else if (UIx.menu.active) {
    handleMenuInput(pressed);
  } else if (UIx.dialog.active) {
    if (UIx.dialog.choices) {
      for (let i = 0; i < UIx.dialog.choices.length; i++) {
        if (pressed.has('dlg' + i)) {
          sfx('ui');
          const cb = UIx.dialog.onChoice;
          UIx.dialog.active = false;
          UIx.dialog.onDone = null;
          if (cb) cb(i);
          break;
        }
      }
    }
    UIx.updateDialog(dt);
  } else {
    if (pressed.has('menu') || input.menuPressed) { openPauseMenu(); }
    else if (pressed.has('map') || input.mapPressed) { g.mapOpen = true; UIx.invalidateMap(); sfx('ui'); clearHeld(); }
    else if (pressed.has('swap')) { cycleItem(); sfx('ui'); }
  }

  // --- ゲーム進行 ---
  if (g.canAct || (!uiBusy && p.hp <= 0)) {
    FX.updateFx(dt);
    const step = FX.fx.hitstop > 0 ? 0 : dt;
    if (step > 0) simulate(step);
  } else {
    FX.updateFx(dt * 0.4);
  }

  // 自動セーブ
  if (g.autoSaveT > 20 && g.levelId === 'field' && !uiBusy) {
    g.autoSaveT = 0;
    saveGame(g);
  }

  R.updateCamera(dt, p, g.level);
  R.drawScene(g);

  // --- UI 描画 ---
  const { sctx } = R.getCtx();
  R.present();
  R.beginUi();

  if (g.mapOpen) {
    UIx.drawMap(sctx, g);
  } else {
    UIx.drawHud(sctx, g);
    if (!UIx.menu.active && !UIx.dialog.active) UIx.drawTouchControls(sctx, g);
    UIx.drawDialog(sctx);
    UIx.drawMenu(sctx);
    drawInteractPrompt(sctx);
  }
  if (g.transition) {
    const t = g.transition.t / g.transition.dur;
    const a = t < 0.5 ? t * 2 : (1 - t) * 2;
    sctx.fillStyle = `rgba(6,4,10,${clamp(a, 0, 1)})`;
    sctx.fillRect(0, 0, R.view.cssW, R.view.cssH);
  }
  R.endUi();

  if (UIx.ui.toastT > 0) UIx.ui.toastT -= dt;
}

// ---------------------------------------------------------------------------
function simulate(dt) {
  const p = g.player;

  // --- 攻撃・ため・道具の入力（ここが唯一の入口）---
  if (g.canAct) {
    const target = findInteract();
    g.interact = target;
    const idle = p.attack <= 0 && p.spin <= 0;

    // 軽いタップ／Ａ押下：目の前に調べられる物があればそちら優先
    if (input.aPressed || input.gTap) {
      if (target) doInteract(target);
      else if (idle && p.cooldown <= 0) p.startAttack(false);
    }
    // 片手ジェスチャで ためきって離した
    if (input.gCharge && idle) p.startAttack(true);

    // Ａボタン長押しの「ため」（振り終わってから貯まりはじめる）
    // ※ 離した瞬間の判定を先に見ること。あとだと charge が 0 に戻ってしまう。
    const canSpin = p.attack <= 0 && p.spin <= 0;
    if (input.aReleased) {
      if (p.charge > PLAYER.chargeTime && canSpin) p.startAttack(true);
      p.charge = 0;
    } else if (input.a && canSpin) {
      const before = p.charge;
      p.charge += dt;
      if (before <= PLAYER.chargeTime && p.charge > PLAYER.chargeTime) sfx('magic');
    } else if (!input.a && !input.gStill) {
      p.charge = 0;
    }
    // 片手ジェスチャ中は溜めゲージをキャラにも反映（きらめき表示用）
    if (input.gStill && input.gHeld > 0 && canSpin) p.charge = input.gHeld;

    if (input.bPressed) useItem();
  } else { g.interact = null; p.charge = 0; }

  p.update(dt, g);

  // --- 攻撃判定 ---
  resolveAttack();

  // --- エンティティ ---
  for (const e of g.enemies) if (!e.dead) e.update(dt, g);
  for (let i = g.enemies.length - 1; i >= 0; i--) {
    if (g.enemies[i].dead) { g.kills++; g.enemies.splice(i, 1); }
  }
  for (const e of g.pickups) e.update(dt, g);
  for (let i = g.pickups.length - 1; i >= 0; i--) if (g.pickups[i].dead) g.pickups.splice(i, 1);
  for (const e of g.projectiles) e.update(dt, g);
  for (let i = g.projectiles.length - 1; i >= 0; i--) if (g.projectiles[i].dead) g.projectiles.splice(i, 1);
  for (const e of g.bombs) e.update(dt, g);
  for (let i = g.bombs.length - 1; i >= 0; i--) if (g.bombs[i].dead) g.bombs.splice(i, 1);
  for (const e of g.npcs) e.update(dt, g);

  // --- 探索マーク ---
  g.level.markExplored(p.tx, p.ty, g.level.dark ? 4 : 8);

  // --- 敵の湧き（フィールド）---
  if (g.levelId === 'field') updateFieldSpawns(dt);

  // --- 遺物・出口など踏むと発生するもの ---
  checkTileTriggers();

  // --- 死亡 ---
  if (p.hp <= 0 && g.state === 'play' && p.deadT > 1.0) {
    g.state = 'gameover'; g.stateT = 0;
    stopMusic();
  }

  // --- BGM 切り替え ---
  if (g.levelId === 'field') {
    const want = nearTown() ? 'town' : 'field';
    playMusic(want);
  }
}

// ---------------------------------------------------------------------------
function resolveAttack() {
  const p = g.player;
  const hb = p.hitbox();
  if (!hb) return;
  const dmg = p.dmg * (hb.spin ? 2 : 1);
  for (const e of g.enemies) {
    if (e.dead || e.hp <= 0 || p.attackHit.has(e)) continue;
    if (Math.abs(e.x - hb.x) < hb.hw + e.hw && Math.abs(e.y - 4 - hb.y) < hb.hh + e.hh + 6) {
      p.attackHit.add(e);
      e.hurt(g, dmg, p.x, p.y, hb.spin ? 190 : PLAYER.knockback);
    }
  }
  // 壊せるオブジェクト
  const x0 = Math.floor((hb.x - hb.hw) / TILE), x1 = Math.floor((hb.x + hb.hw) / TILE);
  const y0 = Math.floor((hb.y - hb.hh) / TILE), y1 = Math.floor((hb.y + hb.hh) / TILE);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const key = 'o' + x + ',' + y;
      if (p.attackHit.has(key)) continue;
      const id = g.level.o(x, y);
      const def = OBJ_DEF[id];
      if (!def || def.hp <= 0) continue;
      p.attackHit.add(key);
      damageObject(x, y, hb.spin ? 3 : 1);
    }
}

function damageObject(x, y, amount) {
  const lv = g.level;
  const id = lv.o(x, y);
  const def = OBJ_DEF[id];
  if (!def || def.hp <= 0) return;
  const i = lv.idx(x, y);
  const hp = (lv.objHp.get(i) ?? def.hp) - amount;
  const cx = x * TILE + 8, cy = y * TILE + 10;
  if (hp > 0) {
    lv.objHp.set(i, hp);
    FX.burst(cx, cy, 4, id === O.BUSH ? [PAL.a, PAL['9']] : [PAL.e, PAL.f]);
    sfx('hit');
    return;
  }
  lv.setO(x, y, O.NONE);
  sfx(id === O.CAGE ? 'chest' : 'hit');
  FX.burst(cx, cy, 10, id === O.BUSH ? [PAL.a, PAL['9'], PAL.b] : id === O.CAGE ? [PAL.u, PAL.c] : [PAL.e, PAL.f, PAL.d]);
  FX.shake(1.5, 0.12);
  const rng = Math.random();
  if (id === O.BUSH || id === O.POT) {
    if (rng < 0.24) g.spawnPickup(cx, cy, 'coin');
    else if (rng < 0.32) g.spawnPickup(cx, cy, 'heart');
    else if (rng < 0.35) g.spawnPickup(cx, cy, 'bomb');
  } else if (id === O.CAGE) {
    freeVillager(x, y);
  } else if (id === O.CRYSTAL) {
    for (let k = 0; k < 4; k++) g.spawnPickup(cx, cy, 'coin');
  }
}

function freeVillager(x, y) {
  const v = g.overworld.villagers.find(v => v.x === x && v.y === y);
  if (!v || v.freed) return;
  v.freed = true;
  g.rescued++;
  sfx('rescue');
  duckMusic();
  FX.ring(x * TILE + 8, y * TILE + 8, { r0: 4, r1: 40, life: 0.5, color: PAL.t, width: 2 });
  FX.burst(x * TILE + 8, y * TILE + 8, 22, [PAL.t, PAL.s, PAL.C], { spMax: 110, life: 0.9 });
  const b = BUILDINGS.find(bb => bb.id === v.building);
  const npc = new Npc(x * TILE + 8, y * TILE + 18, v.kind, { static: true, name: '村人' });
  g.npcs.push(npc);
  UIx.openDialog({
    speaker: '村人',
    portrait: v.kind % SPR.villagers.length,
    text: [
      'たすかった…！ ありがとう。',
      `わたし、村で ${b ? b.name : 'お店'} を ひらけるよ。\nさきに もどっているね。`,
    ],
    onDone: () => {
      const i = g.npcs.indexOf(npc);
      if (i >= 0) g.npcs.splice(i, 1);
      FX.burst(npc.x, npc.y - 6, 14, [PAL.t, PAL.C]);
      UIx.toast(`村人を ${g.rescued} 人 すくった`, b ? `村で「${b.name}」を 建てられる` : '');
      saveGame(g);
      UIx.invalidateMap();
    },
  });
}

// ---------------------------------------------------------------------------
// 触れるもの
// ---------------------------------------------------------------------------
function findInteract() {
  const p = g.player;
  // NPC
  let best = null, bestD = 26;
  for (const n of g.npcs) {
    const d = dist(n.x, n.y, p.x, p.y);
    if (d < bestD) { bestD = d; best = { type: 'npc', npc: n, x: n.x, y: n.y - 18 }; }
  }
  if (best) return best;

  // 建物の入口
  if (g.levelId === 'field') {
    for (const b of g.level.buildings) {
      const cx = (b.x + b.w / 2) * TILE, cy = (b.y + b.h) * TILE;
      if (Math.abs(p.x - cx) < 20 && p.y > cy - 12 && p.y < cy + 20) {
        return { type: 'building', b, x: cx, y: cy - 22 };
      }
    }
  }

  // 目の前・足元のタイル
  const [dx, dy] = DIR_VEC[p.dir];
  const cands = [
    [Math.floor((p.x + dx * 12) / TILE), Math.floor((p.y + dy * 12) / TILE)],
    [p.tx, p.ty],
    [Math.floor((p.x + dx * 12) / TILE), Math.floor((p.y - 6 + dy * 12) / TILE)],
  ];
  for (const [x, y] of cands) {
    const id = g.level.o(x, y);
    if (id === O.CHEST) return { type: 'chest', x: x * TILE + 8, y: y * TILE - 4, tx: x, ty: y };
    if (id === O.SIGN) return { type: 'sign', x: x * TILE + 8, y: y * TILE - 4, tx: x, ty: y };
    if (id === O.CAVE) return { type: 'cave', x: x * TILE + 8, y: y * TILE - 4, tx: x, ty: y };
    if (id === O.DOOR) return { type: 'door', x: x * TILE + 8, y: y * TILE - 4, tx: x, ty: y };
    if (id === O.GATE) return { type: 'gate', x: x * TILE + 8, y: y * TILE - 4, tx: x, ty: y };
    if (id === O.EXIT) return { type: 'exit', x: x * TILE + 8, y: y * TILE - 4, tx: x, ty: y };
    if (id === O.RELIC) return { type: 'relic', x: x * TILE + 8, y: y * TILE - 4, tx: x, ty: y };
  }
  return null;
}

function doInteract(t) {
  const p = g.player;
  switch (t.type) {
    case 'npc': {
      const n = t.npc;
      const b = g.level.buildings.find(bb => bb.built && bb.name === n.name);
      if (b) { openBuildingMenu(b); return; }
      UIx.openDialog({ speaker: n.name, portrait: n.kind, text: n.lines });
      sfx('ui');
      break;
    }
    case 'building': openBuildingMenu(t.b); break;
    case 'sign': {
      const s = g.overworld.signs.find(s => s.x === t.tx && s.y === t.ty);
      UIx.openDialog({ speaker: '立て札', text: [s ? s.text : 'なにも 書かれていない。'] });
      sfx('ui');
      break;
    }
    case 'chest': openChest(t.tx, t.ty); break;
    case 'cave': {
      const d = g.overworld.dungeons.find(d => d.x === t.tx && d.y === t.ty);
      if (!d) return;
      UIx.toast(d.name, d.cleared ? 'クリア済み' : 'なかへ 入る');
      g.returnPos = { x: t.tx * TILE + 8, y: (t.ty + 1) * TILE + 10 };
      enterLevel(d.id, null, null, true);
      break;
    }
    case 'exit': enterLevel('field', null, null, true); break;
    case 'door': {
      if (p.keys > 0) {
        p.keys--;
        sfx('door'); duckMusic(0.1, 0.8);
        const dg = g.dungeons[g.levelId];
        if (dg && dg.doorPos) {
          for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]])
            if (g.level.o(dg.doorPos.x + ox, dg.doorPos.y + oy) === O.DOOR)
              g.level.setO(dg.doorPos.x + ox, dg.doorPos.y + oy, O.NONE);
        } else g.level.setO(t.tx, t.ty, O.NONE);
        FX.burst(t.x, t.y + 8, 14, [PAL.f, PAL.d, PAL.s]);
        UIx.toast('カギを つかった');
      } else {
        sfx('error');
        UIx.openDialog({ text: ['かたく とじている。\nカギが 必要だ。'] });
      }
      break;
    }
    case 'gate': {
      if (p.relics >= 3) {
        g.gateOpen = true;
        g.level.setO(t.tx, t.ty, O.NONE);
        sfx('relic'); FX.flash('#ffffff', 0.9); FX.shake(6, 0.6);
        UIx.openDialog({
          speaker: '???', text: ['三つの遺物が 光を とりもどした。', '門が ひらく——'],
          onDone: () => { g.won = true; saveGame(g); g.state = 'ending'; g.stateT = 0; stopMusic(); },
        });
      } else {
        sfx('error');
        UIx.openDialog({ speaker: '古い門', text: [`三つの 遺物が いる。\nいま ${p.relics} / 3。`] });
      }
      break;
    }
    case 'relic': {
      g.level.setO(t.tx, t.ty, O.NONE);
      p.relics++;
      sfx('relic'); FX.flash('#ffffff', 0.8);
      FX.ring(t.x, t.y + 8, { r0: 4, r1: 50, life: 0.6, color: PAL.t, width: 2 });
      saveGame(g);
      UIx.openDialog({
        speaker: '遺物', text: [`遺物を てにいれた！ (${p.relics}/3)`,
          p.relics >= 3 ? '三つ そろった。\n「古い門」へ 向かおう。' : 'まだ 光が たりない…'],
      });
      break;
    }
  }
}

function openChest(x, y) {
  const key = `${g.levelId}:${x},${y}`;
  if (g.openedChests.has(key)) return;
  g.openedChests.add(key);
  g.level.setO(x, y, O.CHEST_OPEN);
  sfx('chest');
  FX.ring(x * TILE + 8, y * TILE + 6, { r0: 3, r1: 24, life: 0.4, color: PAL.t });
  FX.burst(x * TILE + 8, y * TILE + 4, 12, [PAL.t, PAL.s], { spMax: 70 });

  const src = g.levelId === 'field' ? g.overworld.chests : (g.dungeons[g.levelId]?.chests || []);
  const c = src.find(c => c.x === x && c.y === y);
  const loot = c ? c.loot : 'coins';
  const p = g.player;
  let msg = '';
  if (loot === 'key') { p.keys++; msg = 'カギ を てにいれた！'; }
  else if (loot === 'heart') { p.maxHp += 2; p.hp = p.maxHp; msg = 'ハートの器！ 最大 HP が ふえた'; sfx('levelup'); }
  else if (loot === 'bomb') { p.bombs += 3; msg = '爆弾 ×3'; }
  else if (loot === 'potion') { p.potions += 1; msg = 'ポーション ×1'; }
  else {
    const n = 18 + ((Math.random() * 30) | 0);
    const drops = 8, per = Math.ceil(n / drops);
    for (let i = 0; i < drops; i++) g.spawnPickup(x * TILE + 8, y * TILE + 8, 'coin', per);
    msg = `コイン ×${n}`;
  }
  UIx.toast(msg);
  saveGame(g);
}

function checkTileTriggers() {
  const p = g.player;
  const id = g.level.o(p.tx, p.ty);
  if (id === O.RELIC) {
    doInteract({ type: 'relic', tx: p.tx, ty: p.ty, x: p.tx * TILE + 8, y: p.ty * TILE });
  }
}

// ---------------------------------------------------------------------------
function useItem() {
  const p = g.player;
  if (p.item === 'bomb') {
    if (p.bombs <= 0) { sfx('error'); UIx.toast('爆弾が ない'); return; }
    p.bombs--;
    const [dx, dy] = DIR_VEC[p.dir];
    const b = new Bomb(p.x + dx * 10, p.y + dy * 8, 6 + p.swordLv);
    b.vx = dx * 40; b.vy = dy * 40;
    g.bombs.push(b);
    sfx('fuse');
  } else if (p.item === 'potion') {
    if (p.potions <= 0) { sfx('error'); UIx.toast('ポーションが ない'); return; }
    if (p.hp >= p.maxHp) { sfx('error'); UIx.toast('元気いっぱいだ'); return; }
    p.potions--;
    p.heal(6);
    sfx('heart');
    FX.ring(p.x, p.y - 6, { r0: 3, r1: 22, life: 0.4, color: PAL.p });
  } else if (p.item === 'magic') {
    if (p.mp <= 0) { sfx('error'); UIx.toast('まりょくが たりない'); return; }
    p.mp--;
    const [dx, dy] = DIR_VEC[p.dir];
    const a = Math.atan2(dy, dx);
    g.spawnProjectile(p.x, p.y - 6, a, 130, p.dmg * 2, 'magic', true);
    sfx('magic');
  }
}

// ---------------------------------------------------------------------------
// 敵の湧き（フィールド）
// ---------------------------------------------------------------------------
const FIELD_MOBS = {
  grass: ['slime', 'wolf'], forest: ['slime', 'spore', 'wolf'], sand: ['slime', 'bat'],
  marsh: ['spore', 'slime'], ash: ['skeleton', 'bat'], stone: ['bat', 'skeleton'], dirt: ['slime'],
};

function updateFieldSpawns(dt) {
  const p = g.player;
  const ow = g.overworld;
  // 遠い敵を消す
  for (let i = g.enemies.length - 1; i >= 0; i--) {
    const e = g.enemies[i];
    if (!e.boss && dist(e.x, e.y, p.x, p.y) > 460) g.enemies.splice(i, 1);
  }
  const townD = dist(p.tx, p.ty, ow.townX, ow.townY);
  if (townD < 13) return;               // 村の近くは安全
  const cap = clamp(3 + Math.floor(townD / 22), 3, 9);
  if (g.enemies.length >= cap) return;
  g.spawnTimer -= dt;
  if (g.spawnTimer > 0) return;
  g.spawnTimer = 0.7;

  for (let k = 0; k < 24; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = 130 + Math.random() * 120;
    const x = Math.floor((p.x + Math.cos(a) * r) / TILE);
    const y = Math.floor((p.y + Math.sin(a) * r) / TILE);
    if (!g.level.inb(x, y) || g.level.solid(x, y)) continue;
    if (dist(x, y, ow.townX, ow.townY) < 13) continue;
    const name = TERRAIN_NAME[g.level.g(x, y)];
    const pool = FIELD_MOBS[name];
    if (!pool) continue;
    const lvl = clamp(1 + Math.floor(dist(x, y, ow.townX, ow.townY) / 34), 1, 4);
    g.spawnEnemy(x * TILE + 8, y * TILE + 8, pool[(Math.random() * pool.length) | 0], lvl);
    break;
  }
}

// ---------------------------------------------------------------------------
// メニュー各種
// ---------------------------------------------------------------------------
function handleMenuInput(pressed) {
  if (pressed.has('menuClose')) { sfx('uiBack'); UIx.closeMenu(); clearHeld(); return; }
  for (let i = 0; i < UIx.menu.items.length; i++) {
    if (pressed.has('menu' + i)) {
      const it = UIx.menu.items[i];
      UIx.menu.idx = i;
      if (it.disabled) { sfx('error'); return; }
      sfx(it.sound || 'ui');
      const act = it.action;
      if (it.close !== false) UIx.menu.active = false;
      if (act) act();
      clearHeld();
      return;
    }
  }
  if (input.menuPressed && UIx.menu.closable) { sfx('uiBack'); UIx.closeMenu(); return; }
  if (UIx.menu.closable && input.taps.length && pressed.size === 0) { sfx('uiBack'); UIx.closeMenu(); }
}

function openPauseMenu() {
  sfx('ui');
  clearHeld();
  const p = g.player;
  UIx.openMenu({
    title: 'メニュー',
    sub: `▶ ${g.objectiveText()}`,
    items: [
      { label: 'つづける', sub: 'ゲームにもどる', action: () => {} },
      { label: 'マップ', sub: `${g.level.name} ・ ${formatTime(g.playTime)}`, action: () => { g.mapOpen = true; UIx.invalidateMap(); } },
      {
        label: 'どうぐ を きりかえ',
        sub: `いま：${p.item === 'bomb' ? '爆弾' : p.item === 'potion' ? 'ポーション' : '魔法'}`,
        action: () => cycleItem(),
      },
      {
        label: isMuted() ? '音を だす' : '音を けす', sub: 'BGM と 効果音',
        action: () => { toggleMute(); UIx.toast(isMuted() ? '音 OFF' : '音 ON'); },
      },
      {
        label: UIx.ui.showControls ? 'ボタンを かくす' : 'ボタンを だす',
        sub: 'ドラッグ移動＋タップ攻撃だけでも 遊べます',
        action: () => { UIx.ui.showControls = !UIx.ui.showControls; },
      },
      {
        label: 'セーブしてタイトルへ', sub: '進行状況は 保存されます',
        action: () => {
          saveGame(g);
          refreshSaveSummary();
          g.state = 'title'; g.stateT = 0;
          playMusic('town');
        },
      },
    ],
    footer: '外側をタップ / ✕ でとじる',
  });
}

function cycleItem() {
  const p = g.player;
  const order = ['bomb', 'potion'];
  if (p.magic) order.push('magic');
  const i = order.indexOf(p.item);
  p.item = order[(i + 1) % order.length];
  UIx.toast(`どうぐ：${p.item === 'bomb' ? '爆弾' : p.item === 'potion' ? 'ポーション' : '魔法'}`);
}

// --- 建物 ------------------------------------------------------------------
function openBuildingMenu(b) {
  const p = g.player;
  clearHeld();
  if (!b.built) {
    const v = g.overworld.villagers.find(v => v.building === b.id);
    const unlocked = !v || v.freed;
    const canPay = p.coins >= b.cost;
    UIx.openMenu({
      title: b.name + '（こうじ中）',
      sub: b.desc,
      items: [
        {
          label: unlocked ? (canPay ? 'ここに 建てる' : 'コインが たりない') : 'まだ 建てられない',
          sub: unlocked ? `所持 ${p.coins} コイン` : 'この店を ひらく 村人を さがそう',
          cost: b.cost,
          disabled: !unlocked || !canPay,
          sound: 'build',
          action: () => {
            p.coins -= b.cost;
            b.built = true;
            applyBuildings(g.overworld.level, g.overworld.level.buildings);
            g.npcs.length = 0; spawnTownNpcs();
            sfx('build');
            FX.shake(3, 0.4);
            FX.burst((b.x + b.w / 2) * TILE, (b.y + b.h) * TILE, 24, [PAL.f, PAL.g, PAL.d], { spMax: 90 });
            UIx.toast(`${b.name} が できた！`, b.desc);
            saveGame(g);
            UIx.invalidateMap();
          },
        },
        { label: 'やめる', action: () => {} },
      ],
    });
    return;
  }
  switch (b.id) {
    case 'home': openHomeMenu(b); break;
    case 'shop': openShopMenu(b); break;
    case 'smith': openSmithMenu(b); break;
    case 'healer': openHealerMenu(b); break;
    case 'sage': openSageMenu(b); break;
    case 'farm': openFarmMenu(b); break;
    case 'well': openWellMenu(b); break;
    default:
      UIx.openDialog({ speaker: b.name, text: [b.desc] });
  }
}

function openHomeMenu(b) {
  const p = g.player;
  UIx.openMenu({
    title: 'あなたの家',
    sub: `♥ ${Math.ceil(p.hp / 2)} / ${p.maxHp / 2}   ${p.coins} コイン`,
    items: [
      {
        label: 'ねむる', sub: '体力を 全回復して セーブ', icon: 'heart',
        action: () => {
          p.hp = p.maxHp;
          saveGame(g);
          sfx('levelup');
          FX.flash('#e8c46a', 0.5);
          UIx.toast('よく ねむった', 'たいりょくが 回復した');
        },
      },
      {
        label: '村のようす', sub: `救った村人 ${g.rescued} 人 ・ 遺物 ${p.relics}/3`,
        action: () => {
          const built = g.overworld.level.buildings.filter(x => x.built).length;
          UIx.openDialog({
            speaker: '村の記録',
            text: [
              `建物 ${built} / ${g.overworld.level.buildings.length}\n村人 ${g.rescued} 人\n遺物 ${p.relics} / 3`,
              `たおした敵 ${g.kills}\nあそんだ時間 ${formatTime(g.playTime)}`,
            ],
          });
        },
      },
      { label: 'やめる', action: () => {} },
    ],
  });
}

function openShopMenu(b) {
  const p = g.player;
  const buy = (cost, fn, label) => () => {
    if (p.coins < cost) { sfx('error'); UIx.toast('コインが たりない'); return; }
    p.coins -= cost; fn(); sfx('buy'); UIx.toast(label);
    saveGame(g);
    setTimeout(() => openShopMenu(b), 80);
  };
  UIx.openMenu({
    title: 'よろず屋',
    sub: `所持 ${p.coins} コイン`,
    items: [
      { label: 'ポーション', sub: 'ハート3つ 回復', icon: 'potion', cost: 25, disabled: p.coins < 25, action: buy(25, () => p.potions++, 'ポーションを 買った') },
      { label: '爆弾 ×3', sub: '岩や 敵を ふきとばす', icon: 'bomb', cost: 30, disabled: p.coins < 30, action: buy(30, () => p.bombs += 3, '爆弾を 買った') },
      { label: 'カギ', sub: 'ダンジョンの 扉を 開ける', icon: 'key', cost: 80, disabled: p.coins < 80, action: buy(80, () => p.keys++, 'カギを 買った') },
      { label: 'やめる', action: () => {} },
    ],
  });
}

const SWORD_NAMES = ['きこりの ナタ', 'てつの 剣', 'はがねの 剣', '木もれ日の 剣', '夜明けの 剣'];
function openSmithMenu(b) {
  const p = g.player;
  const cost = 60 + p.swordLv * 90;
  const maxed = p.swordLv >= SWORD_NAMES.length - 1;
  UIx.openMenu({
    title: 'かじ屋',
    sub: `いま：${SWORD_NAMES[p.swordLv]}（攻撃 ${p.dmg}）`,
    items: [
      {
        label: maxed ? 'これ以上は きたえられない' : `${SWORD_NAMES[p.swordLv + 1]} に する`,
        sub: maxed ? '最高の 一振りだ' : `攻撃力 ${p.dmg} → ${p.dmg + 1}`,
        cost: maxed ? null : cost,
        disabled: maxed || p.coins < cost,
        action: () => {
          p.coins -= cost; p.swordLv++;
          sfx('levelup'); FX.flash('#ffffff', 0.5);
          UIx.toast('剣が つよくなった！', SWORD_NAMES[p.swordLv]);
          saveGame(g);
        },
      },
      { label: 'やめる', action: () => {} },
    ],
    footer: `所持 ${p.coins} コイン`,
  });
}

function openHealerMenu(b) {
  const p = g.player;
  const hearts = p.maxHp / 2;
  const cost = 70 + (hearts - 3) * 55;
  const maxed = hearts >= 10;
  UIx.openMenu({
    title: 'いやしの家',
    sub: `ハートの器 ${hearts} / 10`,
    items: [
      {
        label: 'ハートを ひとつ ふやす', sub: maxed ? 'もう じゅうぶん' : `最大 ${hearts} → ${hearts + 1}`,
        icon: 'heart', cost: maxed ? null : cost, disabled: maxed || p.coins < cost,
        action: () => {
          p.coins -= cost; p.maxHp += 2; p.hp = p.maxHp;
          sfx('levelup'); UIx.toast('ハートの器が ふえた！');
          saveGame(g);
        },
      },
      {
        label: '手あてを うける', sub: '体力を 全回復（10 コイン）', cost: 10,
        disabled: p.coins < 10 || p.hp >= p.maxHp,
        action: () => { p.coins -= 10; p.hp = p.maxHp; sfx('heart'); UIx.toast('回復した'); },
      },
      { label: 'やめる', action: () => {} },
    ],
    footer: `所持 ${p.coins} コイン`,
  });
}

function openSageMenu(b) {
  const p = g.player;
  UIx.openMenu({
    title: '賢者の塔',
    sub: p.magic ? `まりょく ${p.mp} / ${p.maxMp}` : 'まだ 魔法を 知らない',
    items: [
      p.magic ? {
        label: 'まりょくを みたす', sub: '30 コイン', cost: 30, disabled: p.coins < 30 || p.mp >= p.maxMp,
        action: () => { p.coins -= 30; p.mp = p.maxMp; sfx('magic'); UIx.toast('まりょくが みちた'); saveGame(g); },
      } : {
        label: '魔法を さずかる', sub: '光の弾を はなてるようになる', icon: 'gem', cost: 150, disabled: p.coins < 150,
        action: () => {
          p.coins -= 150; p.magic = 1; p.maxMp = 8; p.mp = 8; p.item = 'magic';
          sfx('levelup'); FX.flash('#b57ad4', 0.6);
          UIx.toast('魔法を おぼえた！', 'Ｂボタンで 光の弾');
          saveGame(g);
        },
      },
      {
        label: '門について きく', sub: '古い門の うわさ',
        action: () => UIx.openDialog({
          speaker: '賢者',
          text: ['三つの ほら穴の おくに、\n「番人」が 眠っている。',
                 'すべての 遺物を 手にすれば、\n東の 古い門が ひらくだろう。',
                 `いまの 遺物：${p.relics} / 3`],
        }),
      },
      { label: 'やめる', action: () => {} },
    ],
    footer: `所持 ${p.coins} コイン`,
  });
}

function openWellMenu(b) {
  const p = g.player;
  UIx.openMenu({
    title: '井戸',
    sub: 'コインを 投げこむと なにか 起きるとか',
    items: [
      {
        label: 'コインを 投げる', sub: 'なにが 起きるかは 運しだい', cost: 5, disabled: p.coins < 5,
        action: () => {
          p.coins -= 5;
          const r = Math.random();
          FX.ring(p.x, p.y - 6, { r0: 3, r1: 24, life: 0.5, color: PAL.k });
          if (r < 0.34) { p.heal(4); sfx('heart'); UIx.toast('つめたい水で ひといき', '体力が すこし 回復した'); }
          else if (r < 0.60) { p.coins += 20; sfx('coin'); UIx.toast('コインが かえってきた！', '+20 コイン'); }
          else if (r < 0.78) { p.bombs += 2; sfx('buy'); UIx.toast('爆弾が ふたつ 浮いてきた'); }
          else if (r < 0.92) { p.potions += 1; sfx('buy'); UIx.toast('ポーションが 浮いてきた'); }
          else { sfx('error'); UIx.toast('…なにも 起きなかった'); }
          saveGame(g);
        },
      },
      { label: 'のぞきこむ', sub: '', action: () => UIx.openDialog({ speaker: '井戸', text: ['くらい水面に、\n自分の顔が うつっている。'] }) },
      { label: 'やめる', action: () => {} },
    ],
    footer: `所持 ${p.coins} コイン`,
  });
}

function openFarmMenu(b) {
  const p = g.player;
  const ready = (g.playTime - (b.lastHarvest ?? -999)) > 120;
  UIx.openMenu({
    title: '畑',
    sub: ready ? 'きのみが 実っている' : 'まだ 実っていない',
    items: [
      {
        label: 'きのみを とる', sub: ready ? 'ハート3つ 回復＋ポーション' : 'もうすこし 待とう',
        icon: 'heart', disabled: !ready,
        action: () => {
          b.lastHarvest = g.playTime;
          p.heal(6); p.potions++;
          sfx('heart'); UIx.toast('きのみを 食べた', 'ポーションも もらった');
          saveGame(g);
        },
      },
      { label: 'やめる', action: () => {} },
    ],
  });
}

/** いまの目標（マップとメニューに出す） */
g.objectiveText = function () {
  const p = g.player;
  if (!p || !g.overworld) return '';
  if (g.won) return 'すべて おわった。ありがとう。';
  if (p.relics >= 3) return '東の「古い門」へ 向かおう';
  const left = g.overworld.dungeons.filter(d => !d.cleared).length;
  if (g.rescued === 0) return 'とらわれた村人を さがそう（檻を 斬る）';
  if (left === 3) return 'ほら穴に もぐって 遺物を さがそう';
  return `遺物を あつめよう（${p.relics} / 3）`;
};

// 自動テスト用の入口（ブラウザからゲーム内部を叩けるようにしておく）
g.ui = UIx;
g.dev = {
  enterLevel: (...a) => enterLevel(...a),
  damageObject: (...a) => damageObject(...a),
  findInteract: () => findInteract(),
  doInteract: (t) => doInteract(t),
  openChest: (...a) => openChest(...a),
  newGame: (s) => newGame(s),
  continueGame: () => continueGame(),
  save: () => saveGame(g),
  openBuildingMenu: (b) => openBuildingMenu(b),
};

// ---------------------------------------------------------------------------
function drawInteractPrompt(ctx) {
  const t = g.interact;
  if (!t || UIx.dialog.active || UIx.menu.active || !g.canAct) return;
  const S = UIx.ui.S;
  const sx = (t.x - g.camx) * R.view.scale;
  const sy = (t.y - g.camy) * R.view.scale;
  const bob = Math.sin(performance.now() / 220) * 3 * S;
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.arc(sx, sy + bob, 13 * S, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(24,18,30,0.9)'; ctx.fill();
  ctx.strokeStyle = UI.gold; ctx.lineWidth = 2 * S; ctx.stroke();
  UIx.txt(ctx, '！', sx, sy + bob - 9 * S, { size: 16 * S, align: 'center', color: UI.gold, outline: false });
  ctx.restore();
}

// ---------------------------------------------------------------------------
function updateGameOver(dt) {
  g.stateT += dt;
  input.stickEnabled = false;
  FX.updateFx(dt);
  R.drawScene(g);
  R.present();
  const { sctx } = R.getCtx();
  R.beginUi();
  setButtons(UIx.gameOverButtons());
  UIx.drawGameOver(sctx, g, g.stateT);
  R.endUi();

  const pressed = pressedButtons();
  if (g.stateT > 1.2 && (pressed.has('revive') || input.aPressed)) {
    const p = g.player;
    p.coins = Math.floor(p.coins * 0.75);
    p.hp = p.maxHp;
    p.deadT = 0;
    p.invuln = 1.2;
    g.state = 'play'; g.stateT = 0;
    const ow = g.overworld;
    enterLevel('field', ow.townX * TILE + 8, (ow.townY + 4) * TILE + 8, true);
    saveGame(g);
    clearHeld();
  }
}

function updateEnding(dt) {
  g.stateT += dt;
  input.stickEnabled = false;
  const { sctx } = R.getCtx();
  R.drawScene(g);
  R.present();
  R.beginUi();
  UIx.drawEnding(sctx, g, g.stateT);
  R.endUi();
  setButtons([]);
  if (g.stateT > 2.5 && (input.taps.length || input.aPressed)) {
    g.state = 'title'; g.stateT = 0;
    refreshSaveSummary();
    playMusic('town');
    clearHeld();
  }
}

// ---------------------------------------------------------------------------
window.addEventListener('pointerdown', () => { startAudio(); resumeAudio(); }, { once: false });
document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeAudio(); });

boot0();
