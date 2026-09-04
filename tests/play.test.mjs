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
  for (let i = 0; i < 24; i++) {
    const busy = await page.evaluate(() => window.__game.ui.dialog.active || window.__game.ui.menu.active);
    if (!busy) break;
    await page.mouse.click(195, 120);
    await wait(160);
  }
  await wait(150);
};

// --- 1. 世界生成のロバスト性 -------------------------------------------------
{
  const gen = await page.evaluate(() => {
    const g = window.__game;
    const out = [];
    for (let i = 0; i < 16; i++) {
      const t0 = performance.now();
      g.dev.newGame(1000 + i * 4177);
      const ow = g.overworld;
      const reach = (x, y) => ow.reach.seen[y * ow.level.w + x] === 1;
      out.push({
        ms: performance.now() - t0,
        dungeons: ow.dungeons.length,
        dgReach: ow.dungeons.filter(d => reach(d.x, d.y)).length,
        villagers: ow.villagers.length,
        vilReach: ow.villagers.filter(v => reach(v.x, v.y)).length,
        gate: !!ow.gate && reach(ow.gate.x, ow.gate.y),
        townOpen: !ow.level.solid(ow.townX, ow.townY),
      });
    }
    return out;
  });
  const bad = gen.filter(r => r.dungeons < 3 || r.dgReach < r.dungeons || r.villagers < 5
    || r.vilReach < r.villagers || !r.gate || !r.townOpen);
  check('16 シードすべてで、村・ほら穴3つ・村人・門が到達可能に生成される',
    bad.length === 0, `最長 ${Math.max(...gen.map(r => r.ms)).toFixed(0)}ms`);
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

// --- 4. 調べる：会話が開き、剣は振らない ------------------------------------
{
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.overworld.signs[0];
    g.player.x = s.x * 16 + 8; g.player.y = (s.y + 1) * 16 + 10; g.player.dir = 3;
  });
  await wait(300);
  await tapButton('a');
  await wait(150);
  const r = await page.evaluate(() => ({ attack: window.__game.player.attack, canAct: window.__game.canAct }));
  check('立て札を調べると会話だけが開く（剣は振らない）', r.attack === 0 && !r.canAct);
  await clearDialogs();
}

// --- 5. 爆弾でひび割れた壁と草を壊す ------------------------------------------
{
  await page.evaluate(() => {
    const g = window.__game;
    const tx = g.player.tx + 2, ty = g.player.ty;
    for (let x = tx - 1; x <= tx + 1; x++) for (let y = ty - 1; y <= ty + 1; y++) g.level.setO(x, y, 0);
    g.level.setO(tx, ty, 3);                        // 草むら
    window.__t = { tx, ty };
    g.player.bombs = 3; g.player.item = 'bomb'; g.player.dir = 2;
    g.player.maxHp = 30; g.player.hp = 30; g.player.invuln = 99;
  });
  await wait(200);
  await tapButton('b');
  await wait(2400);
  const r = await page.evaluate(() => ({
    used: 3 - window.__game.player.bombs,
    gone: window.__game.level.o(window.__t.tx, window.__t.ty) === 0,
  }));
  check('Ｂボタンで爆弾を置き、まわりを壊す', r.used === 1 && r.gone);
}

// --- 6. 村人の救出 → 建物を建てる ---------------------------------------------
{
  const r1 = await page.evaluate(() => {
    const g = window.__game;
    const v = g.overworld.villagers[0];
    g.player.x = v.x * 16 + 8; g.player.y = (v.y + 1) * 16 + 8;
    g.dev.damageObject(v.x, v.y, 99);
    return { freed: v.freed, rescued: g.rescued, building: v.building };
  });
  check('檻をこわすと村人が助かる', r1.freed && r1.rescued === 1, `解放：${r1.building}`);
  await clearDialogs();

  await page.evaluate(() => {
    const g = window.__game;
    const v = g.overworld.villagers[0];
    const b = g.overworld.level.buildings.find(x => x.id === v.building);
    g.player.coins = 999;
    g.player.x = (b.x + b.w / 2) * 16; g.player.y = (b.y + b.h) * 16 + 12;
    g.dev.openBuildingMenu(b);
  });
  await wait(400);
  await tapButton('menu0');
  await wait(700);
  const r2 = await page.evaluate(() => {
    const g = window.__game;
    const v = g.overworld.villagers[0];
    const b = g.overworld.level.buildings.find(x => x.id === v.building);
    return { built: b.built, coins: g.player.coins, npcs: g.npcs.length };
  });
  check('コインを払って村に建物が建つ', r2.built && r2.coins < 999 && r2.npcs > 0);
}

// --- 7. ダンジョン：ボス → 遺物 -----------------------------------------------
{
  const r1 = await page.evaluate(() => {
    const g = window.__game;
    const d = g.overworld.dungeons[0];
    g.returnPos = { x: d.x * 16 + 8, y: (d.y + 1) * 16 + 8 };
    g.dev.enterLevel(d.id, null, null, false);
    const dg = g.dungeons[d.id];
    return { level: g.levelId, boss: g.enemies.filter(e => e.boss).length, secrets: dg.secrets.length, dark: g.level.dark };
  });
  check('ダンジョンに入れる（ボス・隠し部屋・視界制限つき）',
    r1.boss === 1 && r1.secrets > 0 && r1.dark, `隠し部屋 ${r1.secrets}`);

  const r2 = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));
    const boss = g.enemies.find(e => e.boss);
    g.player.maxHp = 60; g.player.hp = 60; g.player.invuln = 999;
    for (let i = 0; i < 80 && !boss.dead; i++) boss.hurt(g, 10, boss.x, boss.y + 30);
    await sleep(900);
    const dg = g.dungeons[g.levelId];
    return { dead: boss.dead, cleared: g.overworld.dungeons[0].cleared, relic: g.level.o(dg.relicPos.x, dg.relicPos.y) };
  });
  check('ボスを倒すと遺物があらわれる', r2.dead && r2.cleared && r2.relic !== 0);

  await page.evaluate(() => {
    const g = window.__game;
    const dg = g.dungeons[g.levelId];
    g.player.x = dg.relicPos.x * 16 + 8; g.player.y = dg.relicPos.y * 16 + 8;
  });
  const gotRelic = await until(() => window.__game.player.relics === 1);
  check('遺物を拾える', gotRelic,
    gotRelic ? '' : JSON.stringify(await page.evaluate(() => {
      const g = window.__game, dg = g.dungeons[g.levelId];
      return {
        relics: g.player.relics, hp: g.player.hp, canAct: g.canAct,
        ptx: g.player.tx, pty: g.player.ty, rp: dg.relicPos,
        objThere: g.level.o(dg.relicPos.x, dg.relicPos.y), level: g.levelId,
        state: g.state, mapOpen: g.mapOpen, transition: !!g.transition,
        dialog: g.ui.dialog.active ? { speaker: g.ui.dialog.speaker, page: g.ui.dialog.pages[g.ui.dialog.page] } : null,
        menu: g.ui.menu.active ? g.ui.menu.title : null,
      };
    })));
  await clearDialogs();
}

// --- 8. セーブとロード --------------------------------------------------------
{
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.dev.enterLevel('field', null, null, false);
    g.player.coins = 321; g.player.swordLv = 2;
    g.dev.save();
    g.dev.continueGame();
    return {
      coins: g.player.coins, swordLv: g.player.swordLv, relics: g.player.relics,
      rescued: g.rescued, built: g.overworld.level.buildings.filter(b => b.built).length,
      cleared: g.overworld.dungeons.filter(d => d.cleared).length,
    };
  });
  check('セーブして読みなおしても進行が残る',
    r.coins === 321 && r.swordLv === 2 && r.relics === 1 && r.rescued === 1 && r.built === 2 && r.cleared === 1,
    JSON.stringify(r));
}

// --- 9. 門とエンディング ------------------------------------------------------
{
  await page.evaluate(() => {
    const g = window.__game;
    g.player.relics = 3;
    const gt = g.overworld.gate;
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
  check('「村へもどる」で復帰できる', r.state === 'play' && r.hp > 0 && r.level === 'field');
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
    const good = v.fits && v.inside && ['a', 'b', 'menu', 'map'].every(id => v.ids.includes(id));
    if (!good) { ok = false; detail.push(`${w}x${h}`); }
    await c.close();
  }
  check('どの画面サイズでも収まり、操作ボタンが画面内にある', ok, detail.join(' '));
}

check('実行中に例外が出ていない', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} 件 成功`);
process.exit(failed.length ? 1 : 0);
