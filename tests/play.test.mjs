#!/usr/bin/env node
// ---------------------------------------------------------------------------
// play.test.mjs — 実際にブラウザで動かして遊びの筋道をひととおり確かめる
//
//   PLAYWRIGHT が必要:  npm i -D playwright   （ブラウザは既存のものを使う）
//   実行:               node tests/play.test.mjs
//                       node tests/play.test.mjs --single   ← dist の1ファイル版
//
// 静的サーバも自前で立てるので、ほかに準備はいらない。
// ---------------------------------------------------------------------------
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const single = process.argv.includes('--single');

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  console.error('playwright が見つかりません。 npm i -D playwright を実行してください。');
  process.exit(2);
}

// --- 静的サーバ -------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, rel === '/' ? '/index.html' : rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const url = single ? `${base}/dist/aftergrove.html` : `${base}/index.html`;

// --- テストの下ごしらえ -----------------------------------------------------
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('[pageerror] ' + (e.stack || e.message)));
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(900);

const wait = (ms) => page.waitForTimeout(ms);
/** ゲーム内のボタンを実座標でタップする */
const tapButton = async (id) => {
  const b = await page.evaluate((bid) => {
    const g = window.__game;
    const btn = g.input.buttons.find(x => x.id === bid);
    return btn ? { x: btn.x + g.view.ox, y: btn.y + g.view.oy } : null;
  }, id);
  if (!b) throw new Error(`ボタン ${id} が出ていません`);
  await page.mouse.click(b.x, b.y);
};
/** 画面のまんなかを ふつうにタップする（＝斬る／調べる）*/
const tapWorld = async () => {
  const p = await page.evaluate(() => ({ x: window.__game.view.cssW / 2, y: window.__game.view.cssH * 0.55 }));
  await page.mouse.click(p.x, p.y);
};
/** 条件が満たされるまで待つ（描画フレームに依存する判定用） */
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - t0 > ms) return false;
    await wait(100);
  }
};

/** 会話やメニューが閉じるまでタップし続ける。
 *  g.canAct は「前フレームの値」なので、UI の実状態を直接見ること。 */
const clearDialogs = async () => {
  await wait(150);
  for (let i = 0; i < 26; i++) {
    const busy = await page.evaluate(() => window.__game.ui.dialog.active || window.__game.ui.menu.active);
    if (!busy) break;
    await page.mouse.click(195, 120);
    await wait(150);
  }
  await wait(150);
};

// --- 1. 世界生成のロバスト性 ---
{
  const gen = await page.evaluate(() => {
    const g = window.__game;
    const out = [];
    for (let i = 0; i < 16; i++) {
      const t0 = performance.now();
      g.dev.newGame(1000 + i * 4177);
      const w = g.world;
      // 家からすべての島へ行けるか
      const seen = new Set([w.startId]);
      const q = [w.startId];
      while (q.length) {
        const r = w.rooms.get(q.shift());
        for (const d of ['n', 's', 'e', 'w']) {
          const n = r.exits[d];
          if (n && !seen.has(n)) { seen.add(n); q.push(n); }
        }
      }
      const names = [...w.rooms.values()].map(r => r.name);
      out.push({
        ms: performance.now() - t0,
        rooms: w.rooms.size,
        reachable: seen.size,
        dungeons: w.dungeons.length,
        dgOk: w.dungeons.every(d => seen.has(d.roomId)),
        villagers: w.villagers.length,
        vilOk: w.villagers.every(v => seen.has(v.roomId)),
        gateOk: seen.has(w.gateRoomId),
        townOk: seen.has(w.townId),
        uniqueNames: new Set(names).size === names.length,
      });
    }
    return out;
  });
  const bad = gen.filter(r => r.rooms < 30 || r.reachable !== r.rooms || r.dungeons < 3
    || !r.dgOk || r.villagers < 5 || !r.vilOk || !r.gateOk || !r.townOk);
  check('16 シードすべてで、島がひとつながりに生成される',
    bad.length === 0,
    `島 ${Math.min(...gen.map(r => r.rooms))}〜${Math.max(...gen.map(r => r.rooms))} / 最長 ${Math.max(...gen.map(r => r.ms)).toFixed(0)}ms`);
}

// --- 2. あそびはじめ ---------------------------------------------------------
await page.evaluate(() => { localStorage.clear(); window.__game.dev.newGame(20260904); });
await wait(500);
await clearDialogs();
check('新規ゲームが はじまる', await page.evaluate(() => window.__game.state === 'play'));

// --- 3. 移動・攻撃・ためうち --------------------------------------------------
{
  const before = await page.evaluate(() => window.__game.player.y);
  await page.mouse.move(150, 620); await page.mouse.down();
  await page.mouse.move(150, 700, { steps: 5 }); await wait(900); await page.mouse.up();
  const after = await page.evaluate(() => window.__game.player.y);
  check('画面のドラッグで下へ歩く', after - before > 30, `dy=${Math.round(after - before)}`);
}
{
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));
    g.enemies.length = 0;
    g.player.maxHp = 30; g.player.hp = 30; g.player.invuln = 99;
    const e = g.spawnEnemy(g.player.x, g.player.y - 22, 'slime', 1);
    const coins0 = g.player.coins;
    for (let i = 0; i < 15 && !e.dead; i++) {
      g.player.dir = 3;
      g.player.startAttack(false);
      await sleep(180);
      g.player.x = e.x; g.player.y = e.y + 20;
    }
    await sleep(800);
    return { dead: e.dead, coins: g.player.coins - coins0 };
  });
  check('剣で敵を倒すとコインを落とす', r.dead && r.coins > 0, `+${r.coins} コイン`);
}
{
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.enemies.length = 0;
    window.__es = [];
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2;
      window.__es.push(g.spawnEnemy(g.player.x + Math.cos(a) * 13, g.player.y + Math.sin(a) * 13, 'slime', 1));
    }
    g.player.swordLv = 3;
    return true;
  });
  await page.mouse.move(200, 620); await page.mouse.down(); await wait(900); await page.mouse.up();
  await wait(700);
  const dead = await page.evaluate(() => window.__es.filter(e => e.dead).length);
  check('その場長押し → 離すと回転斬りで周囲をなぎ払う', dead >= 3, `${dead}/4 体`);
}

// --- 2a2. 画面のどこをタップしても斬れる ---
{
  const results = [];
  for (const y of [0.24, 0.40, 0.58, 0.76, 0.90]) {
    await page.evaluate(() => {
      const g = window.__game;
      g.player.attack = 0; g.player.cooldown = 0; g.player.spin = 0; g.player.roll = 0;
    });
    await page.mouse.click(195, Math.round(844 * y));
    await wait(90);
    results.push(await page.evaluate(() => window.__game.player.attack > 0));
    await wait(320);
  }
  check('画面のどこをタップしても 剣を振る（ボタン不要）',
    results.every(Boolean), results.map(r => (r ? '○' : '×')).join(''));
}

// --- 2a3. 指がぶれても・歩きながらでも・連打でも 剣が出る -----------------------
{
  // startAttack の呼ばれた回数を かぞえる
  await page.evaluate(() => {
    const proto = Object.getPrototypeOf(window.__game.player);
    if (!window.__swHook) {
      window.__swHook = proto.startAttack;
      proto.startAttack = function (...a) { window.__sw = (window.__sw || 0) + 1; return window.__swHook.apply(this, a); };
    }
  });
  const swings = async (fn) => {
    await page.evaluate(() => {
      const g = window.__game;
      window.__sw = 0;
      g.enemies.length = 0; g.npcs.length = 0;
      g.player.attack = 0; g.player.spin = 0; g.player.cooldown = 0; g.player.roll = 0;
    });
    await fn();
    await wait(420);
    return page.evaluate(() => window.__sw);
  };

  // 指が すこし ぶれるタップ
  const drift = await swings(async () => {
    for (let i = 0; i < 4; i++) {
      await page.mouse.move(195, 500); await page.mouse.down();
      await page.mouse.move(203, 513, { steps: 4 });
      await wait(90);
      await page.mouse.up();
      await wait(400);
    }
  });
  check('指が ぶれても タップとして 剣が出る', drift >= 4, `${drift}/4 回`);

  // 速くて 大きく ぶれるタップ
  const fast = await swings(async () => {
    for (let i = 0; i < 4; i++) {
      await page.mouse.move(195, 500); await page.mouse.down();
      await page.mouse.move(216, 521, { steps: 4 });
      await page.mouse.up();
      await wait(400);
    }
  });
  check('速くて 大きくぶれたタップでも 剣が出る', fast >= 4, `${fast}/4 回`);

  // 歩きながら もう一本の指で タップ
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const walking = await swings(async () => {
    await touch('touchStart', [{ x: 120, y: 600, id: 1 }]);
    await touch('touchMove', [{ x: 120, y: 664, id: 1 }]);
    await wait(220);
    for (let i = 0; i < 3; i++) {
      await touch('touchStart', [{ x: 120, y: 664, id: 1 }, { x: 300, y: 400, id: 2 }]);
      await wait(70);
      await touch('touchEnd', [{ x: 120, y: 664, id: 1 }]);
      await wait(380);
    }
    await touch('touchEnd', []);
  });
  check('歩きながら もう一本の指で タップしても 剣が出る', walking >= 3, `${walking}/3 回`);

  // 振りの途中の連打も 取りこぼさない（先行入力）
  const rapid = await swings(async () => {
    for (let i = 0; i < 6; i++) { await page.mouse.click(195, 500); await wait(200); }
  });
  check('振りの途中で 連打しても 取りこぼさない', rapid >= 5, `${rapid}/6 回`);
  await page.evaluate(() => { window.__game.enemies.length = 0; });
}

// --- 2b. 島から島へ わたる ---
{
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));
    const before = g.roomId;
    const built = g.rooms[g.roomId];
    const dirs = Object.keys(built.gateways);
    const gw = built.gateways[dirs[0]];
    g.player.x = gw.x * 16 + 8; g.player.y = gw.y * 16 + 8;
    await sleep(1500);
    const after = g.roomId;
    // もどってこられるか
    const b2 = g.rooms[after];
    const back = Object.keys(b2.gateways).find(d => b2.gateways[d] && g.world.rooms.get(after).exits[d] === before);
    if (back) {
      const gw2 = b2.gateways[back];
      g.player.x = gw2.x * 16 + 8; g.player.y = gw2.y * 16 + 8;
      await sleep(1500);
    }
    return { before, after, home: g.roomId, dirs: dirs.length };
  });
  check('小道から となりの島へ わたり、もどってこられる',
    r.after !== r.before && r.home === r.before, `${r.before} → ${r.after} → ${r.home}`);
  await clearDialogs();
}

// --- 2c. 島の見た目（暗がりに浮かぶ草地）---
{
  const v = await page.evaluate(() => {
    const g = window.__game;
    const lv = g.level;
    let voidN = 0, grassN = 0, pathN = 0;
    for (let i = 0; i < lv.ground.length; i++) {
      const t = lv.ground[i];
      if (t === 14) voidN++;
      else if (t === 15 || t === 16 || t === 17) grassN++;
      else if (t === 18) pathN++;
    }
    return { island: !!lv.island, voidN, grassN, pathN, w: lv.w, h: lv.h };
  });
  check('島のまわりが 暗がりになっていて、草地と小道がある',
    v.island && v.voidN > 20 && v.grassN > 60 && v.pathN > 8,
    `外 ${v.voidN} / 草 ${v.grassN} / 道 ${v.pathN}`);
}

// --- 3b. すばやく払うと ころがる ---
{
  await page.evaluate(() => { const g = window.__game; g.player.rollCd = 0; g.player.roll = 0; });
  const y0 = await page.evaluate(() => window.__game.player.y);
  await page.mouse.move(150, 560); await page.mouse.down();
  await page.mouse.move(150, 665, { steps: 2 });
  await wait(110);
  const mid = await page.evaluate(() => ({ roll: window.__game.player.roll, iframe: window.__game.player.iframe }));
  await page.mouse.up();
  await wait(450);
  const y1 = await page.evaluate(() => window.__game.player.y);
  check('すばやく払うと ころがって よけられる（無敵つき）',
    mid.roll > 0 && mid.iframe > 0 && y1 - y0 > 30, `dy=${Math.round(y1 - y0)}`);
}

// --- 3c. 世界のかざり ---
{
  const w = await page.evaluate(() => {
    const g = window.__game;
    const rs = [...g.world.rooms.values()];
    return {
      signs: rs.filter(r => r.content.sign != null).length,
      shrines: rs.filter(r => r.content.shrine).length,
      vendings: rs.filter(r => r.content.vending).length,
      chests: rs.filter(r => r.content.chest).length,
      hatRooms: (g.world.hatmanRooms || []).length,
    };
  });
  check('立て札・祠・自販機・宝箱が 島に配られている',
    w.signs >= 4 && w.shrines >= 3 && w.vendings >= 3 && w.chests >= 7 && w.hatRooms === 4,
    `立て札${w.signs} 祠${w.shrines} 自販機${w.vendings} 宝箱${w.chests}`);

  // 帽子の人がいる島へ行って話しかける
  await page.evaluate(() => {
    const g = window.__game;
    g.dev.enterRoom(g.world.hatmanRooms[0], null, false);
  });
  await wait(700);
  await page.evaluate(() => { const g = window.__game; if (g.hatman) { g.player.x = g.hatman.x; g.player.y = g.hatman.y + 16; } });
  await wait(300);
  await tapWorld();
  await wait(300);
  check('帽子の人は 吹き出しで しゃべる',
    await page.evaluate(() => window.__game.bubbles.length > 0 && !window.__game.ui.dialog.active));
  await wait(600);
}

// --- 3.5 増えた敵：ぜんぶ動いて、たてもちは 前からは きかない ------------------
{
  const kinds = ['crow', 'thorn', 'stump', 'wisp', 'hatling', 'weeper', 'shielder'];
  const r = await page.evaluate(async (kinds) => {
    const g = window.__game;
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));
    g.enemies.length = 0; g.hazards.length = 0;
    const p = g.player;
    p.maxHp = 90; p.hp = 90; p.invuln = 9999;
    for (const k of kinds) g.spawnEnemy(p.x + 40, p.y + 40, k, 1).aggro = true;
    const start = g.enemies.map(e => ({ x: e.x, y: e.y }));
    await sleep(2200);
    const moved = g.enemies.filter((e, i) => Math.hypot(e.x - start[i].x, e.y - start[i].y) > 2).length;
    const names = g.enemies.map(e => e.def.name);
    // たてもち：正面からは はじく／うしろからは 通る
    const sh = g.enemies.find(e => e.kind === 'shielder');
    sh.dir = 0;                                  // 下を向かせる
    const hp0 = sh.hp;
    sh.hurt(g, 3, sh.x, sh.y + 30);              // 正面（下）から
    const front = sh.hp;
    sh.hurt(g, 3, sh.x, sh.y - 30);              // うしろ（上）から
    const back = sh.hp;
    // ひとだま：たおすと 二つに わかれる
    const wi = g.enemies.find(e => e.kind === 'wisp');
    const before = g.enemies.length;
    wi.hurt(g, 99, wi.x + 10, wi.y);
    await sleep(60);
    const split = g.enemies.filter(e => e.kind === 'wisp' && !e.dead).length;
    // なきぼうは 水たまりを のこす
    await sleep(1400);
    const puddle = g.hazards.some(h => h.kind === 'puddle');
    g.enemies.length = 0; g.hazards.length = 0;
    return { count: kinds.length, moved, names, blocked: front === hp0, hurtFromBack: back < front, split, before, puddle };
  }, kinds);
  check('増えた敵が それぞれ 動く', r.moved >= 5, `${r.moved}/${r.count} ・ ${r.names.join(' ')}`);
  check('たてもちは 前からは はじき、うしろからは 効く', r.blocked && r.hurtFromBack);
  check('ひとだまは たおすと 二つに わかれる', r.split >= 2, `${r.split} 体`);
  check('なきぼうは あるいたあとに 水たまりを のこす', r.puddle);
}

// --- 3.6 段ボールから 回復が出る ----------------------------------------------
{
  const r = await page.evaluate(() => {
    const g = window.__game, lv = g.level, p = g.player;
    const ox = p.x, oy = p.y;
    p.x = -900; p.y = -900;
    const t = { heart: 0, potion: 0, other: 0 };
    for (let n = 0; n < 120; n++) {
      lv.setO(3, 3, 31);
      lv.objHp.set(lv.idx(3, 3), 1);
      g.pickups.length = 0;
      g.dev.damageObject(3, 3, 9);
      for (const q of g.pickups) t[q.kind === 'heart' ? 'heart' : q.kind === 'potion' ? 'potion' : 'other']++;
    }
    lv.setO(3, 3, 0);
    g.pickups.length = 0;
    p.x = ox; p.y = oy;
    return t;
  });
  check('段ボールを 割ると だいたい 回復が 出る',
    r.heart >= 60 && r.potion > 0, `ハート${r.heart} ポーション${r.potion} その他${r.other}`);
}

// --- 3.7 ポーションは 力つきる寸前に ひとりでに 効く ---------------------------
{
  const r = await page.evaluate(() => {
    const g = window.__game, p = g.player;
    p.potions = 1; p.maxHp = 12; p.hp = 2; p.invuln = 0; p.iframe = 0; p.spawnGuard = 0;
    p.hurt(g, 99, p.x + 20, p.y);
    const saved = { hp: p.hp, potions: p.potions };
    p.potions = 0; p.invuln = 0; p.iframe = 0;
    p.hurt(g, 99, p.x + 20, p.y);
    const dead = p.hp <= 0;
    p.hp = p.maxHp; p.deadT = 0;
    return { ...saved, dead };
  });
  check('ポーションは 力つきる寸前に ひとりでに 効く',
    r.hp > 0 && r.potions === 0 && r.dead, `HP ${r.hp}`);
}

// --- 4. 調べる：会話が開き、剣は振らない ------------------------------------
{
  await page.evaluate(() => {
    const g = window.__game;
    const room = [...g.world.rooms.values()].find(r => r.content.sign != null);
    g.dev.enterRoom(room.id, null, false);
  });
  await wait(700);
  await page.evaluate(() => {
    const g = window.__game;
    const sp = g.rooms[g.roomId].spots.sign;
    g.player.x = sp.x * 16 + 8; g.player.y = (sp.y + 1) * 16 + 10; g.player.dir = 3;
  });
  await wait(300);
  await tapWorld();
  await wait(200);
  const r = await page.evaluate(() => ({
    attack: window.__game.player.attack,
    bubble: window.__game.bubbles.length > 0,
    text: window.__game.bubbles[0] && window.__game.bubbles[0].text.slice(0, 12),
  }));
  check('立て札を調べると 吹き出しが出る（剣は振らない）', r.attack === 0 && r.bubble, r.text || '');
  await clearDialogs();
}

// --- 5. ひび割れをタップすると 爆弾を しかける（ボタンは ない）-----------------
{
  await page.evaluate(() => {
    const g = window.__game;
    const tx = g.player.tx, ty = g.player.ty - 2;
    for (let x = tx - 1; x <= tx + 1; x++) for (let y = ty - 1; y <= ty + 1; y++) g.level.setO(x, y, 0);
    g.level.setO(tx, ty, 19);                       // ひび割れ
    g.level.setO(tx + 1, ty, 3);                    // となりに 草むら
    window.__t = { tx, ty };
    g.player.x = tx * 16 + 8; g.player.y = (ty + 1) * 16 + 10; g.player.dir = 3;
    g.player.bombs = 3;
    g.player.maxHp = 30; g.player.hp = 30; g.player.invuln = 99;
  });
  await wait(250);
  const seen = await page.evaluate(() => window.__game.interact && window.__game.interact.type);
  await tapWorld();
  await wait(2600);
  const r = await page.evaluate(() => ({
    used: 3 - window.__game.player.bombs,
    gone: window.__game.level.o(window.__t.tx, window.__t.ty) === 0,
    grass: window.__game.level.o(window.__t.tx + 1, window.__t.ty) === 0,
  }));
  check('ひび割れをタップすると 爆弾を しかけ、壁と草が こわれる',
    seen === 'crack' && r.used === 1 && r.gone && r.grass);
}

// --- 6. 村人の救出 → 建物を建てる ---------------------------------------------
{
  await page.evaluate(() => {
    const g = window.__game;
    g.dev.enterRoom(g.world.villagers[0].roomId, null, false);
  });
  await wait(700);
  const r1 = await page.evaluate(() => {
    const g = window.__game;
    const v = g.world.villagers[0];
    const sp = g.rooms[g.roomId].spots.cage;
    g.player.x = sp.x * 16 + 8; g.player.y = (sp.y + 1) * 16 + 8;
    g.dev.damageObject(sp.x, sp.y, 99);
    return { freed: v.freed, rescued: g.rescued, building: v.building };
  });
  check('檻をこわすと村人が助かる', r1.freed && r1.rescued === 1, `解放：${r1.building}`);
  await clearDialogs();

  await page.evaluate(() => {
    const g = window.__game;
    g.dev.enterRoom(g.world.townId, null, false);
  });
  await wait(800);
  await page.evaluate(() => {
    const g = window.__game;
    const v = g.world.villagers[0];
    const b = g.world.buildings.find(x => x.id === v.building);
    g.player.coins = 999;
    g.player.x = (b.x + b.w / 2) * 16; g.player.y = (b.y + b.h) * 16 + 12;
    g.dev.openBuildingMenu(b);
  });
  await wait(400);
  await tapButton('menu0');
  await wait(700);
  const r2 = await page.evaluate(() => {
    const g = window.__game;
    const v = g.world.villagers[0];
    const b = g.world.buildings.find(x => x.id === v.building);
    return { built: b.built, coins: g.player.coins, npcs: g.npcs.length };
  });
  check('コインを払って村に建物が建つ', r2.built && r2.coins < 999 && r2.npcs > 0);
}

// --- 7. ダンジョン → ボスの舞台 → 遺物 ---
{
  const r1 = await page.evaluate(() => {
    const g = window.__game;
    const d = g.world.dungeons[0];
    g.returnRoomId = d.roomId;
    g.dev.enterLevel(d.id, null, null, false);
    const dg = g.dungeons[d.id];
    return { level: g.levelId, portal: !!dg.portalPos, secrets: dg.secrets.length, dark: g.level.dark };
  });
  check('ダンジョンに入れる（隠し部屋・視界制限つき）',
    r1.portal && r1.secrets > 0 && r1.dark, `隠し部屋 ${r1.secrets}`);

  const r2 = await page.evaluate(() => {
    const g = window.__game;
    g.returnPos = { x: g.player.x, y: g.player.y };
    g.dev.enterLevel('dg0#boss', null, null, false);
    return {
      level: g.levelId, kind: g.level.kind, boss: !!g.boss,
      name: g.boss && g.boss.name, hp: g.boss && g.boss.hp,
    };
  });
  check('ボスの舞台に入ると 巨大なボスが待っている',
    r2.kind === 'arena' && r2.boss && r2.hp > 0, r2.name);

  // 前ぶれ → 手が降りてくる → 殴れる
  const r3 = await until(() => window.__game.enemies.some(e => e.isPart), 20000);
  check('ボスが 地面に 手を たたきつけてくる', r3);
  const r4 = await until(() => window.__game.enemies.some(e => e.isPart && e.state === 'planted'), 6000);
  check('ついた手は 殴れる状態になる', r4);

  // 腕だけでなく、いろいろな技を 出してくるか
  const moves = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));
    const seen = new Set();
    g.player.maxHp = 90; g.player.hp = 90; g.player.invuln = 9999;
    for (let i = 0; i < 40; i++) {
      g.boss.phase = 3;
      g.boss.cd = 0;
      await sleep(120);
      if (g.boss.lastMove) seen.add(g.boss.lastMove);
      for (const h of g.hazards) seen.add('hz:' + h.kind);
      if (g.enemies.some(e => !e.isPart)) seen.add('minion');
    }
    g.hazards.length = 0;
    for (const e of g.enemies) if (!e.isPart) e.dead = true;
    return [...seen];
  });
  const armless = ['gaze', 'spikes', 'wave', 'call', 'spit', 'daggers'];
  check('ボスは 手を たたきつける以外の技も 出してくる',
    armless.filter(m => moves.includes(m)).length >= 4, moves.join(' '));

  const r5 = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));
    g.player.maxHp = 60; g.player.hp = 60; g.player.invuln = 9999;
    const hp0 = g.boss.hp;
    let guard = 0;
    while (g.boss.hp > 0 && guard++ < 500) {
      const hand = g.enemies.find(e => e.isPart && e.state === 'planted');
      if (hand) hand.hurt(g, 6, hand.x, hand.y + 20);
      else if (g.boss.state === 'idle' && g.boss.hands.length === 0) g.boss.cd = 0;
      await sleep(35);
    }
    await sleep(700);
    return { hp0, dead: g.boss.hp <= 0, cleared: g.world.dungeons[0].cleared };
  });
  check('手を たたいて ボスを 倒せる', r5.dead && r5.cleared, `HP ${r5.hp0}`);

  const r6 = await until(() => {
    const g = window.__game;
    const a = g.arenas['dg0#boss'];
    return a && g.level.o(a.relicPos.x, a.relicPos.y) === 21;
  }, 8000);
  check('倒すと 遺物が あらわれる', r6);

  await page.evaluate(() => {
    const g = window.__game;
    const a = g.arenas['dg0#boss'];
    g.player.x = a.relicPos.x * 16 + 8; g.player.y = a.relicPos.y * 16 + 8;
  });
  check('遺物を 拾える', await until(() => window.__game.player.relics === 1));
  await clearDialogs();
  await until(() => window.__game.levelId.startsWith('room:'), 5000);
}

// --- 8. セーブとロード --------------------------------------------------------
{
  const r = await page.evaluate(() => {
    const g = window.__game;
    if (!g.levelId.startsWith('room:')) g.dev.enterRoom(g.world.townId, null, false);
    g.player.coins = 321; g.player.swordLv = 2;
    const roomBefore = g.roomId;
    const visitedBefore = [...g.world.rooms.values()].filter(r => r.visited).length;
    g.dev.save();
    g.dev.continueGame();
    return {
      coins: g.player.coins, swordLv: g.player.swordLv, relics: g.player.relics,
      rescued: g.rescued, built: g.world.buildings.filter(b => b.built).length,
      cleared: g.world.dungeons.filter(d => d.cleared).length,
      roomOk: g.roomId === roomBefore,
      visited: [...g.world.rooms.values()].filter(r => r.visited).length,
      visitedBefore,
    };
  });
  check('セーブして読みなおしても進行が残る（いた島も）',
    r.coins === 321 && r.swordLv === 2 && r.relics === 1 && r.rescued === 1
    && r.built === 2 && r.cleared === 1 && r.roomOk && r.visited >= r.visitedBefore - 1,
    JSON.stringify(r));
}

// --- 9. 門とエンディング ------------------------------------------------------
{
  await page.evaluate(() => {
    const g = window.__game;
    g.player.relics = 3;
    g.dev.enterRoom(g.world.gateRoomId, null, false);
  });
  await wait(700);
  await page.evaluate(() => {
    const g = window.__game;
    const gt = g.rooms[g.roomId].spots.gate;
    g.dev.doInteract({ type: 'gate', tx: gt.x, ty: gt.y, x: gt.x * 16 + 8, y: gt.y * 16 });
  });
  await clearDialogs();
  await wait(2600);
  check('遺物 3 つで門がひらき、エンディングへ',
    await page.evaluate(() => window.__game.state === 'ending' && window.__game.won));
}

// --- 10. 力尽きる → 村へもどる ------------------------------------------------
{
  await page.mouse.click(195, 700); await wait(900);           // タイトルへ
  await page.evaluate(() => window.__game.dev.newGame(777));
  await wait(500);
  await clearDialogs();
  await page.evaluate(() => {
    const g = window.__game;
    g.player.spawnGuard = 0; g.player.invuln = 0; g.player.hp = 0; g.player.deadT = 2;
  });
  await wait(1800);
  check('力尽きるとゲームオーバー画面になる', await page.evaluate(() => window.__game.state === 'gameover'));
  await tapButton('revive');
  await wait(1400);
  const r = await page.evaluate(() => ({ state: window.__game.state, hp: window.__game.player.hp, level: window.__game.levelId }));
  check('「村へもどる」で復帰できる', r.state === 'play' && r.hp > 0 && r.level.startsWith('room:'));
}

// --- 11. 画面サイズ ------------------------------------------------------------
await ctx.close();
{
  const sizes = [[375, 667], [393, 852], [412, 915], [820, 1180], [844, 390], [1440, 900]];
  let ok = true, detail = [];
  for (const [w, h] of sizes) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true });
    const pg = await c.newPage();
    pg.on('pageerror', e => errors.push('[pageerror@' + w + 'x' + h + '] ' + e.message));
    await pg.goto(url, { waitUntil: 'load' });
    await pg.waitForTimeout(600);
    await pg.evaluate(() => { localStorage.clear(); window.__game.dev.newGame(20260904); });
    await pg.waitForTimeout(400);
    for (let i = 0; i < 14; i++) { await pg.mouse.click(Math.round(w / 2), Math.round(h * 0.12)); await pg.waitForTimeout(110); }
    const v = await pg.evaluate(() => {
      const g = window.__game, view = g.view;
      return {
        ids: g.input.buttons.map(b => b.id),
        fits: view.cssW <= view.winW + 1 && view.cssH <= view.winH + 1,
        inside: g.input.buttons.every(b => {
          const r = b.r ?? Math.max(b.hw, b.hh);
          return b.x - r >= -1 && b.y - r >= -1 && b.x + r <= view.cssW + 1 && b.y + r <= view.cssH + 1;
        }),
      };
    });
    const good = v.fits && v.inside && ['menu', 'map'].every(id => v.ids.includes(id))
      && !v.ids.includes('a') && !v.ids.includes('b');
    if (!good) { ok = false; detail.push(`${w}x${h}`); }
    await c.close();
  }
  check('どの画面サイズでも収まり、剣や道具のボタンが 出ていない', ok, detail.join(' '));
}

check('実行中に例外が出ていない', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} 件 成功`);
process.exit(failed.length ? 1 : 0);
