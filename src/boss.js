// ---------------------------------------------------------------------------
// boss.js — 地平線からのぞきこむ巨大なボス
//   頭と腕は背景側、地面に降りてきた「手」だけが実体として殴れる。
//   低解像度キャンバスに直接パスを描くので、拡大すると自然にドット絵になる。
// ---------------------------------------------------------------------------
import { TILE } from './config.js';
import { clamp, lerp, dist, makeRng, TAU, easeOutCubic, easeInCubic } from './util.js';
import { Entity } from './entities.js';
import * as FX from './fx.js';
import { say } from './bubble.js';
import { sfx, duckMusic } from './audio.js';
import { HORIZON_Y } from './arena.js';

const rng = makeRng(0x5A11);

// --- ボスごとの見た目と性格 --------------------------------------------------
export const BOSS_DEF = {
  grinner: {
    name: '沼のわらい主',
    hp: 52,
    skin: '#b0b083', skinDark: '#8a8a63', skinLite: '#c9c99a',
    body: '#241f2b', arm: '#2d2635',
    headW: 34, headH: 24,
    taunts: ['「教育」だ。', 'まだ 帰れると 思ってるの？', 'いい子だ。うごくな。', 'ぼくの 手は やさしいよ。'],
    intro: ['ようこそ、ぬかるみへ。', 'ここでは みんな しずかになる。'],
    death: ['……あぁ、しずかだ。'],
  },
  hollow: {
    name: 'うつろの見張り',
    hp: 78,
    skin: '#a8a2b6', skinDark: '#7d788c', skinLite: '#c6c1d4',
    body: '#1d1a26', arm: '#282235',
    headW: 36, headH: 26,
    taunts: ['数えていたよ。きみの歩数を。', 'まばたきを おしまい。', 'ここは まだ 途中だ。', 'かえりみち？ とじたよ。'],
    intro: ['ずっと 見ていた。', 'きみが ここへ 来るまでの ぜんぶを。'],
    death: ['……やっと、目を つむれる。'],
  },
  ashking: {
    name: '灰かぶりの王',
    hp: 104,
    skin: '#c0a483', skinDark: '#96795c', skinLite: '#dcc4a6',
    body: '#26191c', arm: '#33222a',
    headW: 38, headH: 28,
    taunts: ['灰は 平等だ。', 'きみの村も、いずれ ここへ。', 'もう すこし わらって。', '夜明けなど こない。'],
    intro: ['よく来た、ちいさな灯り。', 'ここで 消えて おゆき。'],
    death: ['……あかるい。ひさしぶりに、あかるい。'],
  },
};

// ---------------------------------------------------------------------------
// 地面に降りてくる手（これだけが殴れる）
// ---------------------------------------------------------------------------
export class BossHand extends Entity {
  constructor(boss, side, tx, ty) {
    super(tx, ty);
    this.boss = boss;
    this.side = side;                 // -1 左 / +1 右
    this.hw = 21; this.hh = 9;
    this.shadow = 0;
    this.hp = 9999; this.maxHp = 9999;
    this.isPart = true;
    this.state = 'raise';             // raise → slam → planted → retract
    this.t = 0;
    this.z = 90;
    this.flash = 0;
    this.slamAt = 0.85;               // 影がふくらむ時間
    this.plantFor = 2.6;
  }

  hurt(g, amount, fx, fy) {
    if (this.state !== 'planted') return;
    this.flash = 0.12;
    this.boss.takeDamage(g, amount, this);
    FX.burst(this.x, this.y - 6, 7, ['#ffffff', this.boss.def.skinLite, '#e8c46a'], { spMax: 90 });
  }

  update(dt, g) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    const p = g.player;

    if (this.state === 'raise') {
      const k = clamp(this.t / this.slamAt, 0, 1);
      this.z = lerp(90, 34, easeInCubic(k));
      if (this.t >= this.slamAt) { this.state = 'slam'; this.t = 0; }
    } else if (this.state === 'slam') {
      const k = clamp(this.t / 0.13, 0, 1);
      this.z = lerp(34, 0, k);
      if (k >= 1) {
        this.state = 'planted'; this.t = 0; this.z = 0;
        sfx('hitHard'); FX.shake(7, 0.45); FX.hitstop(0.05);
        FX.burst(this.x, this.y, 20, ['#3e6b52', '#2b4f42', '#7fb8d4'], { spMax: 130, life: 0.6 });
        FX.ring(this.x, this.y, { r0: 6, r1: 46, life: 0.4, color: '#cfe6d8', width: 2 });
        if (dist(p.x, p.y, this.x, this.y) < 30) p.hurt(g, 2, this.x, this.y);
      }
    } else if (this.state === 'planted') {
      if (this.t > this.plantFor) { this.state = 'retract'; this.t = 0; }
      // 触れているとじわじわ痛い
      if (Math.abs(p.x - this.x) < this.hw + p.hw && Math.abs(p.y - this.y) < this.hh + p.hh + 3) {
        p.hurt(g, 1, this.x, this.y);
      }
    } else if (this.state === 'retract') {
      this.z = lerp(0, 110, easeInCubic(clamp(this.t / 0.5, 0, 1)));
      if (this.t > 0.5) this.dead = true;
    }
  }

  draw(ctx) {
    // 落ちてくる先の影
    if (this.state === 'raise' || this.state === 'slam') {
      const k = this.state === 'raise' ? clamp(this.t / this.slamAt, 0, 1) : 1;
      ctx.globalAlpha = 0.25 + 0.4 * k;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.ellipse(Math.round(this.x), Math.round(this.y), 20 * (0.4 + 0.6 * k), 9 * (0.4 + 0.6 * k), 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (this.state === 'raise') {
        ctx.strokeStyle = k > 0.75 && Math.floor(this.t * 16) % 2 === 0 ? '#ff8f6b' : '#d65c4e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(Math.round(this.x), Math.round(this.y), 20, 9, 0, 0, TAU);
        ctx.stroke();
      }
    }
    drawHand(ctx, this.boss.def, this.x, this.y - this.z, this.side, this.flash > 0);
  }
}

/** 手そのもの（指 4 本のぶ厚い手のひら） */
function drawHand(ctx, def, x, y, side, flash) {
  const c = flash ? '#ffffff' : def.skin;
  const cd = flash ? '#dddddd' : def.skinDark;
  const cl = flash ? '#ffffff' : def.skinLite;
  x = Math.round(x); y = Math.round(y);
  // 指 4 本。長さをばらして ひらいた手に見せる
  const FING = [12, 16, 15, 11];
  for (let i = 0; i < 4; i++) {
    const fx = x - 22 + i * 11 + (i - 1.5) * 1.2;
    ctx.fillStyle = '#12100f';
    rounded(ctx, fx - 1, y - 6, 13, FING[i] + 2, 6); ctx.fill();
  }
  for (let i = 0; i < 4; i++) {
    const fx = x - 22 + i * 11 + (i - 1.5) * 1.2;
    ctx.fillStyle = c;
    rounded(ctx, fx, y - 5, 11, FING[i], 5); ctx.fill();
    ctx.fillStyle = cl;
    rounded(ctx, fx + 1, y - 4, 9, 5, 2); ctx.fill();
  }
  // 手のひら（指のつけ根をつなぐ）
  ctx.fillStyle = '#12100f';
  rounded(ctx, x - 23, y - 14, 46, 13, 6); ctx.fill();
  ctx.fillStyle = c;
  rounded(ctx, x - 22, y - 13, 44, 11, 5); ctx.fill();
  ctx.fillStyle = cd;
  for (let i = 0; i < 3; i++) ctx.fillRect(x - 10 + i * 11, y - 4, 1, 9);
}

function rounded(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------
export class GiantBoss {
  constructor(g, kind, level = 1) {
    this.kind = kind;
    this.def = BOSS_DEF[kind] || BOSS_DEF.grinner;
    this.name = this.def.name;
    this.maxHp = Math.round(this.def.hp * (1 + 0.15 * (level - 1)));
    this.hp = this.maxHp;
    this.level = level;

    this.cx = (g.level.w * TILE) / 2;
    this.headY = HORIZON_Y - 30;
    this.headX = this.cx;
    this.baseHeadY = this.headY;

    this.hands = [];
    this.state = 'intro';
    this.t = 0;
    this.cd = 2.2;
    this.phase = 1;
    this.dead = false;
    this.deadT = 0;
    this.blink = 0;
    this.mouth = 0.35;               // 口の開き
    this.flash = 0;
    this.introStep = 0;
    this.tauntCd = 5;

    // 突進（かぶりつき）用
    this.lunge = null;

    // 吹き出しの吸着点
    // 吹き出しは 顔の下（足場の上）に出す。HUD と かぶらないように。
    this.anchor = { x: this.cx, y: HORIZON_Y + 34, z: 0, dead: false };
  }

  get alive() { return this.hp > 0; }

  takeDamage(g, amount, from) {
    if (this.hp <= 0) return;
    this.hp -= amount;
    this.flash = 0.1;
    this.mouth = Math.min(1, this.mouth + 0.35);
    sfx('hitHard');
    FX.floatText(from.x, from.y - 14, String(amount), '#ffe9a8', { size: 8 });
    const before = this.phase;
    this.phase = this.hp / this.maxHp > 0.62 ? 1 : this.hp / this.maxHp > 0.3 ? 2 : 3;
    if (this.phase !== before) this.onPhase(g);
    if (this.hp <= 0) this.die(g);
  }

  onPhase(g) {
    sfx('boss');
    duckMusic(0.06, 1.4);
    FX.flash('#e0d0ff', 0.35);
    FX.shake(6, 0.5);
    say({ target: this.anchor, text: this.phase === 2 ? 'まだ たっているのか。' : 'ゆるさない。', tone: 'boss', life: 2.2 });
    // 手をいったん引っこめる
    for (const h of this.hands) if (h.state === 'planted') { h.state = 'retract'; h.t = 0; }
  }

  die(g) {
    this.hp = 0;
    this.state = 'dying';
    this.t = 0;
    sfx('bomb');
    FX.shake(10, 1.2); FX.flash('#ffffff', 0.7);
    say({ target: this.anchor, text: this.def.death[0], tone: 'boss', life: 3.4 });
    for (const h of this.hands) h.dead = true;
    this.hands.length = 0;
    g.onGiantBossDefeated?.(this);
  }

  // --- 進行 ---
  update(dt, g) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.blink = Math.max(0, this.blink - dt);
    if (this.blink <= 0 && rng() < dt * 0.35) this.blink = 0.14;
    this.mouth = lerp(this.mouth, this.state === 'lunge' ? 1 : 0.35, 1 - Math.pow(0.02, dt));
    this.headX = this.cx + Math.sin(this.t * 0.7) * 5;
    this.headY = this.baseHeadY + Math.sin(this.t * 0.9) * 2;

    // 生きている手だけ残す
    this.hands = this.hands.filter(h => !h.dead);

    if (this.state === 'dying') {
      this.deadT += dt;
      this.headY = this.baseHeadY + easeInCubic(clamp(this.deadT / 3, 0, 1)) * 70;
      if (rng() < dt * 14) {
        FX.burst(this.headX + rng.range(-20, 20), this.headY + rng.range(-10, 10), 3,
          ['#ffffff', this.def.skinLite, '#e8c46a']);
      }
      return;
    }

    if (this.state === 'intro') {
      if (this.t > 1.1 && this.introStep === 0) {
        this.introStep = 1;
        say({ target: this.anchor, text: this.def.intro[0], tone: 'boss', life: 2.4 });
      } else if (this.t > 3.4 && this.introStep === 1) {
        this.introStep = 2;
        say({ target: this.anchor, text: this.def.intro[1], tone: 'boss', life: 2.4 });
      } else if (this.t > 5.8) {
        this.state = 'idle'; this.t = 0; this.cd = 0.6;
      }
      return;
    }

    if (this.state === 'lunge') { this.updateLunge(dt, g); return; }

    // ときどき挑発
    this.tauntCd -= dt;
    if (this.tauntCd <= 0) {
      this.tauntCd = rng.range(7, 12);
      say({ target: this.anchor, text: rng.pick(this.def.taunts), tone: 'boss', life: 2.4 });
    }

    this.cd -= dt;
    if (this.cd > 0) return;
    this.pickMove(g);
  }

  pickMove(g) {
    const p = g.player;
    // 手だけに かたよらないよう 腕以外の技を 多めに。
    // ただし「ついた手」は こちらが 殴れる ただ一つの機会なので、slam は 残しておく。
    const pool = ['slam', 'slam', 'slam', 'spit', 'gaze', 'spikes', 'call'];
    if (this.phase >= 2) pool.push('daggers', 'sweep', 'wave', 'gaze', 'spikes', 'slam', 'slam');
    if (this.phase >= 3) pool.push('lunge', 'daggers', 'wave', 'call', 'spikes', 'sweep', 'slam');
    // 腕以外の技は 続けて出さない（slam は 出てよい）
    let move = rng.pick(pool);
    for (let i = 0; i < 3 && move !== 'slam' && move === this.lastMove; i++) move = rng.pick(pool);
    this.lastMove = move;
    const gap = this.phase === 1 ? rng.range(2.0, 2.8) : this.phase === 2 ? rng.range(1.5, 2.2) : rng.range(1.1, 1.7);

    if (move === 'slam') {
      const n = this.phase >= 3 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const side = i === 0 ? (p.x < this.cx ? -1 : 1) : (p.x < this.cx ? 1 : -1);
        const tx = clamp(p.x + rng.range(-16, 16) + (i ? rng.range(-40, 40) : 0), 40, g.level.w * TILE - 40);
        const ty = clamp(p.y + rng.range(-10, 10), HORIZON_Y + 30, g.level.h * TILE - 30);
        const h = new BossHand(this, side, tx, ty);
        h.slamAt = this.phase >= 3 ? 0.6 : 0.85;
        h.plantFor = this.phase >= 3 ? 2.0 : 2.6;
        this.hands.push(h);
        g.enemies.push(h);
      }
      sfx('swingBig');
      this.cd = gap + 2.2;
    } else if (move === 'spit') {
      this.mouth = 1;
      const n = 3 + this.phase;
      const base = Math.atan2(p.y - (this.headY + 14), p.x - this.headX);
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.16;
        g.spawnProjectile(this.headX, this.headY + 16, a, 66 + this.phase * 8, 2, 'spore');
      }
      sfx('shoot');
      this.cd = gap;
    } else if (move === 'daggers') {
      this.startDaggers(g);
      this.cd = gap + 1.2;
    } else if (move === 'sweep') {
      this.startSweep(g);
      this.cd = gap + 1.6;
    } else if (move === 'lunge') {
      this.startLunge(g);
      this.cd = gap + 2.4;
    } else if (move === 'gaze') {
      this.startGaze(g);
      this.cd = gap + 1.4;
    } else if (move === 'spikes') {
      this.startSpikes(g);
      this.cd = gap + 1.0;
    } else if (move === 'wave') {
      this.startWave(g);
      this.cd = gap + 1.2;
    } else if (move === 'call') {
      this.startCall(g);
      this.cd = gap + 1.6;
    }
  }

  // --- にらみ（目からの光が 地面をなめる）---
  startGaze(g) {
    const p = g.player;
    const W = g.level.w * TILE;
    const top = HORIZON_Y + 26, bot = g.level.h * TILE - 26;
    // 光は 目から出す（顔の描画と 同じ位置）
    const side = p.x < this.cx ? -1 : 1;
    const ex = this.headX + side * this.def.headW * 0.40;
    const ey = this.headY - this.def.headH * 0.36;
    const horizontal = rng() < 0.6;
    const y = clamp(p.y + rng.range(-18, 18), top, bot);
    const dir = p.x < this.cx ? 1 : -1;
    const a = horizontal
      ? { x0: dir > 0 ? 24 : W - 24, y0: y, x1: dir > 0 ? W - 24 : 24, y1: y }
      : { x0: clamp(p.x + rng.range(-30, 30), 24, W - 24), y0: top, x1: clamp(p.x + rng.range(-30, 30), 24, W - 24), y1: bot };
    say({ target: this.anchor, text: 'よく 見えるよ。', tone: 'boss', life: 1.4 });
    g.hazards.push({
      kind: 'beam', ...a, ex, ey, cx: a.x0, cy: a.y0,
      t: 0, warn: 0.95, sweep: this.phase >= 3 ? 1.5 : 2.1, dmg: 2, r: 11, done: false,
    });
    sfx('magic');
  }

  // --- せりあがる とげ（プレイヤーを 囲む ように）---
  startSpikes(g) {
    const p = g.player;
    const W = g.level.w * TILE, H = g.level.h * TILE;
    const top = HORIZON_Y + 24;
    say({ target: this.anchor, text: 'したを ごらん。', tone: 'boss', life: 1.3 });
    const ring = rng() < 0.55;
    if (ring) {
      // 足もとを 囲む輪（ぬける すきまが ひとつ ある）
      const n = 9 + this.phase;
      const gapAt = rng.int(n);
      const rad = 34;
      for (let i = 0; i < n; i++) {
        if (i === gapAt && this.phase < 3) continue;
        const a = (i / n) * TAU;
        g.hazards.push({
          kind: 'spike', x: clamp(p.x + Math.cos(a) * rad, 18, W - 18),
          y: clamp(p.y + Math.sin(a) * rad * 0.8, top, H - 18),
          t: -i * 0.02, warn: 0.8, dmg: 2, r: 11, done: false,
        });
      }
    } else {
      // まっすぐ 走ってくる 一列
      const a = Math.atan2(p.y - (HORIZON_Y + 20), p.x - this.cx);
      const n = 7 + this.phase * 2;
      for (let i = 0; i < n; i++) {
        g.hazards.push({
          kind: 'spike',
          x: clamp(this.cx + Math.cos(a) * (26 + i * 17), 18, W - 18),
          y: clamp(HORIZON_Y + 20 + Math.sin(a) * (26 + i * 17), top, H - 18),
          t: -i * 0.07, warn: 0.55, dmg: 2, r: 11, done: false,
        });
      }
    }
    sfx('swingBig');
  }

  // --- うなり（ひろがる輪。輪の上だけ 痛い）---
  startWave(g) {
    const W = g.level.w * TILE;
    const n = this.phase >= 3 ? 3 : 2;
    say({ target: this.anchor, text: 'しずかに して。', tone: 'boss', life: 1.3 });
    for (let i = 0; i < n; i++) {
      g.hazards.push({
        kind: 'wave', x: clamp(this.cx, 0, W), y: HORIZON_Y + 18,
        r0: 18, r1: 230, band: 13, dur: 1.9, dmg: 2, t: -i * 0.55, done: false,
      });
    }
    FX.shake(4, 0.4);
    duckMusic(0.10, 1.0);
  }

  // --- よびよせ（口から こぼれてくる）---
  startCall(g) {
    const W = g.level.w * TILE;
    const n = this.phase >= 3 ? 3 : 2;
    say({ target: this.anchor, text: 'ひとりじゃ さみしいね。', tone: 'boss', life: 1.5 });
    this.mouth = 1;
    for (let i = 0; i < n; i++) {
      const x = clamp(this.cx + rng.range(-56, 56), 26, W - 26);
      const y = HORIZON_Y + 30 + rng.range(0, 16);
      const kind = rng.pick(this.phase >= 2 ? ['bat', 'wisp', 'thorn', 'hatling'] : ['bat', 'slime', 'thorn']);
      const e = g.spawnEnemy(x, y, kind, 2);
      if (e) { e.aggro = true; e.stun = 0.3; }
      FX.ring(x, y, { r0: 3, r1: 22, life: 0.35, color: '#cfe6d8' });
    }
    sfx('spawn');
  }

  // --- 短剣の雨 ---
  startDaggers(g) {
    const p = g.player;
    const n = 6 + this.phase * 2;
    say({ target: this.anchor, text: 'ふっておいで。', tone: 'boss', life: 1.4 });
    for (let i = 0; i < n; i++) {
      const tx = clamp(p.x + rng.range(-70, 70), 30, g.level.w * TILE - 30);
      const ty = clamp(p.y + rng.range(-60, 60), HORIZON_Y + 24, g.level.h * TILE - 24);
      g.hazards.push({ kind: 'dagger', x: tx, y: ty, t: -i * 0.06, warn: 0.95, dmg: 2, r: 13, done: false });
    }
    sfx('magic');
  }

  // --- 腕なぎ払い ---
  startSweep(g) {
    const p = g.player;
    const y = clamp(p.y + rng.range(-14, 14), HORIZON_Y + 34, g.level.h * TILE - 34);
    const dir = rng() < 0.5 ? 1 : -1;
    say({ target: this.anchor, text: 'どいて。', tone: 'boss', life: 1.2 });
    g.hazards.push({
      kind: 'sweep', y, dir, t: 0, warn: 0.9, sweep: 0.55, dmg: 2, h: 15, done: false,
      x0: dir > 0 ? -30 : g.level.w * TILE + 30,
    });
    sfx('swingBig');
  }

  // --- かぶりつき（画面いっぱいの見せ場）---
  startLunge(g) {
    const p = g.player;
    this.state = 'lunge';
    this.t = 0;
    this.lunge = { tx: p.x, ty: p.y, phase: 'warn', bit: false };
    say({ target: this.anchor, text: 'いただきます。', tone: 'boss', life: 1.3 });
    sfx('boss');
    duckMusic(0.05, 2.2);
  }

  updateLunge(dt, g) {
    const L = this.lunge;
    const p = g.player;
    if (L.phase === 'warn') {
      L.tx = lerp(L.tx, p.x, 1 - Math.pow(0.06, dt));
      L.ty = lerp(L.ty, p.y, 1 - Math.pow(0.06, dt));
      if (this.t > 1.15) { L.phase = 'strike'; this.t = 0; sfx('dash'); FX.shake(4, 0.3); }
    } else if (L.phase === 'strike') {
      const k = clamp(this.t / 0.30, 0, 1);
      if (k >= 1 && !L.bit) {
        L.bit = true;
        sfx('bomb');
        FX.shake(11, 0.6); FX.hitstop(0.09); FX.flash('#ffffff', 0.35);
        FX.burst(L.tx, L.ty, 26, ['#ffffff', this.def.skinLite, '#d65c4e'], { spMax: 160, life: 0.7 });
        if (dist(p.x, p.y, L.tx, L.ty) < 40) p.hurt(g, 3, L.tx, L.ty);
      }
      if (this.t > 0.62) { L.phase = 'back'; this.t = 0; }
    } else {
      if (this.t > 0.55) { this.state = 'idle'; this.t = 0; this.lunge = null; }
    }
  }

  /** かぶりつきの拡大率（0 = ふつう）。描画側で使う。 */
  lungeAmount() {
    if (this.state !== 'lunge' || !this.lunge) return 0;
    const L = this.lunge;
    if (L.phase === 'warn') return 0;
    if (L.phase === 'strike') return easeOutCubic(clamp(this.t / 0.30, 0, 1));
    return 1 - easeInCubic(clamp(this.t / 0.55, 0, 1));
  }

  // --- 描画（背景層：頭・体・腕）---
  drawBack(ctx, camx, camy) {
    const def = this.def;
    const hx = this.headX - camx;
    const hy = this.headY - camy;

    // 腕（頭のうしろから、地面の手へ）
    ctx.strokeStyle = def.arm;
    ctx.lineCap = 'round';
    for (const h of this.hands) {
      const px = h.x - camx, py = h.y - camy - h.z;
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(hx + (h.side > 0 ? 18 : -18), hy + 14);
      ctx.quadraticCurveTo(hx + h.side * 96, hy - 4, px, py - 6);
      ctx.stroke();
      ctx.strokeStyle = '#191426';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(hx + (h.side > 0 ? 18 : -18), hy + 17);
      ctx.quadraticCurveTo(hx + h.side * 96, hy, px, py - 3);
      ctx.stroke();
      ctx.strokeStyle = def.arm;
    }

    // ふだんは 地平線ぎわに 手をついている
    for (const side of [-1, 1]) {
      if (this.hands.some(h => Math.sign(h.x - this.cx) === side)) continue;
      const rx = this.cx + side * 82 - camx;
      const ry = HORIZON_Y + 12 - camy + Math.sin(this.t * 0.8 + side) * 1.5;
      ctx.strokeStyle = def.arm;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(hx + side * 18, hy + 14);
      ctx.quadraticCurveTo(hx + side * 74, hy - 6, rx, ry - 6);
      ctx.stroke();
      drawHand(ctx, def, rx, ry, side, false);
    }

    // 肩から下。地平線のところで切って「沈んでいる」ように見せる
    const cut = HORIZON_Y - camy;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-999, -999, 4000, cut + 999);
    ctx.clip();
    ctx.fillStyle = def.body;
    ctx.beginPath();
    ctx.moveTo(hx - def.headW - 10, cut + 4);
    ctx.quadraticCurveTo(hx - def.headW + 2, hy + 8, hx, hy + 6);
    ctx.quadraticCurveTo(hx + def.headW - 2, hy + 8, hx + def.headW + 10, cut + 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    this.drawHead(ctx, hx, hy, 1);
  }

  /** 頭。scale を上げると かぶりつきの寄り絵になる。 */
  drawHead(ctx, hx, hy, scale) {
    const def = this.def;
    const w = def.headW * scale, h = def.headH * scale;
    const flash = this.flash > 0;
    ctx.save();
    ctx.translate(hx, hy);

    // 輪郭
    ctx.fillStyle = '#12100f';
    rounded(ctx, -w - 2, -h - 2, w * 2 + 4, h * 2 + 4, 12 * scale); ctx.fill();
    // 顔
    ctx.fillStyle = flash ? '#ffffff' : def.skin;
    rounded(ctx, -w, -h, w * 2, h * 2, 11 * scale); ctx.fill();
    ctx.fillStyle = flash ? '#ffffff' : def.skinLite;
    rounded(ctx, -w + 2 * scale, -h + 2 * scale, w * 2 - 4 * scale, h * 0.7, 8 * scale); ctx.fill();

    // 目（顔の上のほうで大きくふくらむ）
    const eyeY = -h * 0.36, eyeR = w * 0.31;
    for (const s of [-1, 1]) {
      const ex = s * w * 0.40;
      ctx.fillStyle = '#12100f';
      ctx.beginPath(); ctx.ellipse(ex, eyeY, eyeR + 1.5 * scale, eyeR * 1.06 + 1.5 * scale, 0, 0, TAU); ctx.fill();
      if (this.blink > 0) {
        ctx.fillStyle = def.skinDark;
        ctx.beginPath(); ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.06, 0, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = '#f7f4ea';
        ctx.beginPath(); ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.06, 0, 0, TAU); ctx.fill();
        // 瞳はプレイヤーの方をちらちら見る
        const px = Math.sin(this.t * 1.3 + s) * eyeR * 0.32;
        const py = Math.cos(this.t * 0.9) * eyeR * 0.22;
        ctx.fillStyle = '#1b1520';
        ctx.beginPath(); ctx.ellipse(ex + px, eyeY + py, eyeR * 0.42, eyeR * 0.46, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(ex + px - eyeR * 0.2, eyeY + py - eyeR * 0.3, Math.max(1, 2 * scale), Math.max(1, 2 * scale));
      }
    }

    // 口（下半分いっぱいに ぱっくり）
    const mw = w * 0.80, mh = h * (0.22 + this.mouth * 0.34);
    const my = h * 0.40;
    ctx.fillStyle = '#12100f';
    rounded(ctx, -mw, my - mh, mw * 2, mh * 2, 6 * scale); ctx.fill();
    ctx.fillStyle = '#5c1620';
    rounded(ctx, -mw + 1.5 * scale, my - mh + 1.5 * scale, mw * 2 - 3 * scale, mh * 2 - 3 * scale, 5 * scale); ctx.fill();
    ctx.fillStyle = '#20080e';
    rounded(ctx, -mw + 3 * scale, my - mh + 3.5 * scale, mw * 2 - 6 * scale, mh * 2 - 7 * scale, 4 * scale); ctx.fill();
    // 牙
    ctx.fillStyle = '#f2eee0';
    const teeth = 7;
    for (let i = 0; i < teeth; i++) {
      const tx = -mw + 2 * scale + (i + 0.5) * ((mw * 2 - 4 * scale) / teeth);
      const th = (2.6 + (i % 2) * 1.6) * scale;
      ctx.beginPath();
      ctx.moveTo(tx - 1.6 * scale, my - mh + 2 * scale);
      ctx.lineTo(tx + 1.6 * scale, my - mh + 2 * scale);
      ctx.lineTo(tx, my - mh + 2 * scale + th);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tx - 1.6 * scale, my + mh - 2 * scale);
      ctx.lineTo(tx + 1.6 * scale, my + mh - 2 * scale);
      ctx.lineTo(tx, my + mh - 2 * scale - th);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  /** かぶりつきの寄り絵。ワールド描画のいちばん上に重ねる。 */
  drawLungeOverlay(ctx, camx, camy, viewW, viewH) {
    const amt = this.lungeAmount();
    if (amt <= 0.001 || !this.lunge) return;
    const L = this.lunge;
    const sx = L.tx - camx, sy = L.ty - camy;
    const scale = lerp(1, 7.5, amt);
    // 頭が奥から手前へ降ってくる
    const hx = lerp(this.headX - camx, sx, amt);
    const hy = lerp(this.headY - camy, sy - this.def.headH * scale * 0.15, amt);
    ctx.save();
    ctx.globalAlpha = 1;
    this.drawHead(ctx, hx, hy, scale);
    ctx.restore();
  }

  /** 狙われている位置のしるし（かぶりつきの前触れ） */
  drawWarn(ctx, camx, camy) {
    if (this.state !== 'lunge' || !this.lunge || this.lunge.phase !== 'warn') return;
    const L = this.lunge;
    const x = Math.round(L.tx - camx), y = Math.round(L.ty - camy);
    const k = clamp(this.t / 1.15, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.35 * k;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, y, 34 * (0.5 + 0.5 * k), 15 * (0.5 + 0.5 * k), 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = Math.floor(this.t * 14) % 2 === 0 ? '#ff9b7a' : '#d65c4e';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(x, y, 34, 15, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}
