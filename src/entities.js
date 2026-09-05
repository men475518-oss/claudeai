// ---------------------------------------------------------------------------
// entities.js — プレイヤー・敵・NPC・落ちもの・弾
// ---------------------------------------------------------------------------
import { TILE, PLAYER } from './config.js';
import { clamp, dirFromVec, DIR_VEC, makeRng, TAU, lerp, dist, easeOutCubic } from './util.js';
import { SPR, whiteOf, PAL } from './art.js';
import * as FX from './fx.js';
import { sfx } from './audio.js';

const rng = makeRng(0xBEEF);

// ---------------------------------------------------------------------------
export class Entity {
  constructor(x, y) {
    this.x = x; this.y = y; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.hw = 5; this.hh = 4;
    this.dir = 0;
    this.dead = false;
    this.hp = 1; this.maxHp = 1;
    this.hurtT = 0;
    this.kbx = 0; this.kby = 0;
    this.anim = 0;
    this.shadow = 5;
    this.sortY = 0;
  }
  get tx() { return Math.floor(this.x / TILE); }
  get ty() { return Math.floor(this.y / TILE); }

  /** 軸ごとに分けて動かし、壁に沿ってすべる */
  moveBy(g, dx, dy, ignoreWalls = false) {
    const lv = g.level;
    if (ignoreWalls) { this.x += dx; this.y += dy; return; }
    let moved = false;
    if (dx !== 0) {
      if (!lv.hits(this.x + dx, this.y, this.hw, this.hh)) { this.x += dx; moved = true; }
      else {
        // 角の引っかかりをやわらげる
        for (const s of [1, -1]) {
          if (!lv.hits(this.x + dx, this.y + s * 2, this.hw, this.hh) && !lv.hits(this.x, this.y + s * 2, this.hw, this.hh)) {
            this.x += dx; this.y += s * Math.min(2, Math.abs(dx) * 1.4); moved = true; break;
          }
        }
      }
    }
    if (dy !== 0) {
      if (!lv.hits(this.x, this.y + dy, this.hw, this.hh)) { this.y += dy; moved = true; }
      else {
        for (const s of [1, -1]) {
          if (!lv.hits(this.x + s * 2, this.y + dy, this.hw, this.hh) && !lv.hits(this.x + s * 2, this.y, this.hw, this.hh)) {
            this.y += dy; this.x += s * Math.min(2, Math.abs(dy) * 1.4); moved = true; break;
          }
        }
      }
    }
    this.x = clamp(this.x, 2, lv.w * TILE - 2);
    this.y = clamp(this.y, 2, lv.h * TILE - 2);
    return moved;
  }

  applyKnockback(dt, g, ignoreWalls = false) {
    if (this.kbx === 0 && this.kby === 0) return;
    this.moveBy(g, this.kbx * dt, this.kby * dt, ignoreWalls);
    const d = Math.pow(0.0009, dt);
    this.kbx *= d; this.kby *= d;
    if (Math.abs(this.kbx) < 2) this.kbx = 0;
    if (Math.abs(this.kby) < 2) this.kby = 0;
  }

  drawShadow(ctx) {
    if (this.shadow <= 0) return;
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = '#000000';
    const w = this.shadow, h = Math.max(2, (w * 0.45) | 0);
    ctx.beginPath();
    ctx.ellipse(Math.round(this.x), Math.round(this.y), w, h, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  blit(ctx, spr, ox = 0, oy = 0, scale = 1, flashWhite = false) {
    const w = spr.width * scale, h = spr.height * scale;
    const dx = Math.round(this.x - w / 2 + ox);
    const dy = Math.round(this.y - h + oy - this.z);
    ctx.drawImage(flashWhite ? whiteOf(spr) : spr, dx, dy, w, h);
  }
}

// ---------------------------------------------------------------------------
// プレイヤー
// ---------------------------------------------------------------------------
export const ROLL = { dur: 0.36, speed: 175, iframe: 0.26, cool: 0.10 };

export class Player extends Entity {
  constructor(x, y) {
    super(x, y);
    this.hw = PLAYER.hitW / 2; this.hh = PLAYER.hitH / 2;
    this.maxHp = 6; this.hp = 6;
    this.shadow = 5;
    this.speed = PLAYER.speed;
    this.invuln = 0;
    this.attack = 0;          // 残り時間
    this.attackDir = 0;
    this.attackHit = new Set();
    this.cooldown = 0;
    this.charge = 0;
    this.spin = 0;
    this.combo = 0;
    this.comboT = 0;
    this.walkT = 0;
    this.stepT = 0;
    this.swordLv = 0;
    this.coins = 0;
    this.keys = 0;
    this.gems = 0;
    this.bombs = 1;
    this.potions = 1;
    this.magic = 0;           // 0=なし 1=魔法弾
    this.mp = 0; this.maxMp = 0;
    this.item = 'bomb';       // B ボタンで使うもの
    this.relics = 0;
    this.deadT = 0;
    this.spawnGuard = 0.4;
    // 回避（ローリング）
    this.roll = 0;
    this.rollDir = { x: 0, y: 1 };
    this.rollCd = 0;
    this.iframe = 0;
    this.trail = [];
  }

  get rolling() { return this.roll > 0; }

  /** 払い入力で ころがる。無敵は序盤だけ。 */
  startRoll(dx, dy) {
    if (this.roll > 0 || this.rollCd > 0 || this.hp <= 0) return false;
    const l = Math.hypot(dx, dy) || 1;
    this.rollDir = { x: dx / l, y: dy / l };
    this.roll = ROLL.dur;
    this.rollCd = ROLL.dur + ROLL.cool;
    this.iframe = ROLL.iframe;
    this.attack = 0; this.spin = 0; this.charge = 0;
    this.dir = dirFromVec(this.rollDir.x, this.rollDir.y);
    this.trail.length = 0;
    sfx('dash');
    FX.dust(this.x, this.y, 4);
    return true;
  }

  get dmg() { return 2 + this.swordLv; }

  hurt(g, amount, fromX, fromY) {
    if (this.invuln > 0 || this.iframe > 0 || this.spawnGuard > 0 || this.hp <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = PLAYER.invuln;
    this.hurtT = 0.3;
    const a = Math.atan2(this.y - fromY, this.x - fromX);
    this.kbx = Math.cos(a) * 150; this.kby = Math.sin(a) * 150;
    this.attack = 0; this.spin = 0; this.charge = 0;
    FX.shake(3.2, 0.25); FX.hitstop(0.07);
    FX.burst(this.x, this.y - 8, 8, [PAL.o, PAL.n, PAL.p]);
    FX.floatText(this.x, this.y - 14, '-' + amount, PAL.o, { size: 7 });
    sfx('hurt');
    // ポーションを 持っていれば、たおれる寸前に ひとりでに 飲む
    if (this.hp <= 0 && this.potions > 0) {
      this.potions--;
      this.hp = Math.min(this.maxHp, 6);
      this.invuln = PLAYER.invuln * 1.6;
      sfx('heart');
      FX.ring(this.x, this.y - 6, { r0: 3, r1: 26, life: 0.5, color: PAL.p, width: 2 });
      FX.floatText(this.x, this.y - 20, 'ポーション！', PAL.p, { size: 8 });
    }
    if (this.hp <= 0) { sfx('die'); FX.flash('#000000', 0.5); }
    return true;
  }

  heal(n) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    if (this.hp > before) FX.floatText(this.x, this.y - 14, '+' + ((this.hp - before) / 2), PAL.o, { size: 7 });
  }

  startAttack(spin = false, g = null) {
    if (spin) {
      this.spin = PLAYER.spinTime;
      this.attack = 0;
      // まりょくが あるなら 回転斬りから 光が とびだす
      if (g && this.magic && this.mp > 0) {
        this.mp--;
        for (let i = 0; i < 6; i++) {
          g.spawnProjectile(this.x, this.y - 6, (i / 6) * TAU, 120, this.dmg, 'magic', true);
        }
        sfx('magic');
      }
      this.attackHit.clear();
      sfx('swingBig');
      FX.ring(this.x, this.y - 6, { r0: 4, r1: 26, life: 0.32, color: PAL.l });
      return;
    }
    this.attack = PLAYER.attackTime;
    this.attackDir = this.dir;
    this.attackHit.clear();
    this.combo = (this.comboT > 0 ? this.combo + 1 : 0) % 2;
    this.comboT = 0.55;
    this.cooldown = PLAYER.attackCooldown;
    sfx('swing');
  }

  /** 攻撃の当たり判定（矩形） */
  hitbox() {
    if (this.spin > 0) return { x: this.x, y: this.y - 4, hw: 17, hh: 14, spin: true };
    if (this.attack <= 0) return null;
    const t = 1 - this.attack / PLAYER.attackTime;
    if (t < 0.12 || t > 0.78) return null;
    const [dx, dy] = DIR_VEC[this.attackDir];
    const reach = 11;
    return {
      x: this.x + dx * reach, y: this.y - 4 + dy * reach,
      hw: dx !== 0 ? 10 : 11, hh: dy !== 0 ? 10 : 9,
    };
  }

  update(dt, g) {
    const inp = g.input;
    if (this.hp <= 0) { this.deadT += dt; this.applyKnockback(dt, g); return; }

    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.comboT = Math.max(0, this.comboT - dt);
    this.spawnGuard = Math.max(0, this.spawnGuard - dt);
    this.rollCd = Math.max(0, this.rollCd - dt);
    this.iframe = Math.max(0, this.iframe - dt);

    // --- 回避中はほかの操作を受けつけない ---
    if (this.roll > 0) {
      this.roll = Math.max(0, this.roll - dt);
      const k = 1 - this.roll / ROLL.dur;
      const sp = ROLL.speed * (1 - k * 0.45);
      this.trail.push({ x: this.x, y: this.y, dir: this.dir, a: 1 });
      if (this.trail.length > 5) this.trail.shift();
      for (const tr of this.trail) tr.a *= 0.86;
      this.moveBy(g, this.rollDir.x * sp * dt, this.rollDir.y * sp * dt);
      if (Math.random() < 0.5) FX.dust(this.x, this.y, 1);
      this.applyKnockback(dt, g);
      return;
    }
    if (this.trail.length) this.trail.length = 0;

    // 攻撃・ため・道具の入力は main.js の simulate() が一括で扱う

    if (this.attack > 0) this.attack = Math.max(0, this.attack - dt);
    if (this.spin > 0) this.spin = Math.max(0, this.spin - dt);

    // --- 移動 ---
    let mx = 0, my = 0;
    if (g.canAct) { mx = inp.mx; my = inp.my; }
    const attacking = this.attack > 0 || this.spin > 0;
    let sp = this.speed * (attacking ? 0.42 : 1);
    if (g.level.slow(this.tx, this.ty)) sp *= 0.62;
    if (this.charge > 0.14) sp *= 0.55;

    const len = Math.hypot(mx, my);
    if (len > 0.02) {
      if (!attacking) this.dir = dirFromVec(mx, my);
      this.walkT += dt * (4 + len * 6);
      this.stepT += dt * len;
      if (this.stepT > 0.34) { this.stepT = 0; sfx('step'); FX.dust(this.x, this.y + 1, 1); }
    } else {
      this.walkT = 0;
    }
    this.moveBy(g, mx * sp * dt, my * sp * dt);
    this.applyKnockback(dt, g);
  }

  draw(ctx) {
    this.drawShadow(ctx);
    const frames = SPR.hero[this.dir];

    // --- 回避中は くるりと回る（残像つき）---
    if (this.roll > 0) {
      const k = 1 - this.roll / ROLL.dur;
      for (const tr of this.trail) {
        if (tr.a < 0.06) continue;
        ctx.globalAlpha = tr.a * 0.5;
        const sp = SPR.hero[tr.dir][0];
        ctx.drawImage(sp, Math.round(tr.x - 8), Math.round(tr.y - 16));
      }
      ctx.globalAlpha = 1;
      const spr = frames[Math.floor(k * 4) % 2];
      ctx.save();
      ctx.translate(Math.round(this.x), Math.round(this.y - 8));
      ctx.rotate(k * TAU * (this.rollDir.x < 0 ? -1 : 1));
      ctx.drawImage(this.iframe > 0 && Math.floor(k * 12) % 2 === 0 ? whiteOf(spr) : spr, -8, -8);
      ctx.restore();
      return;
    }

    const f = this.walkT > 0 ? (Math.floor(this.walkT) % 2) : 0;
    const bob = this.walkT > 0 && f === 1 ? -1 : 0;
    // 上へ振るときは 剣が体のうしろに来る
    const behind = this.spin <= 0 && this.attack > 0 && this.attackDir === 3;
    if (behind) drawSword(ctx, this);

    const flashing = this.invuln > 0 && Math.floor(this.invuln * 18) % 2 === 0;
    if (flashing && this.hurtT > 0.05) {
      this.blit(ctx, frames[f], 0, bob, 1, true);
    } else if (this.invuln > 0 && Math.floor(this.invuln * 22) % 2 === 0) {
      ctx.globalAlpha = 0.4; this.blit(ctx, frames[f], 0, bob); ctx.globalAlpha = 1;
    } else {
      this.blit(ctx, frames[f], 0, bob);
    }
    // 溜めのきらめき
    if (this.charge > PLAYER.chargeTime) {
      const t = performance.now() / 100;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = Math.floor(t) % 2 ? PAL.t : PAL.l;
      for (let i = 0; i < 3; i++) {
        const a = t * 0.9 + i * TAU / 3;
        ctx.fillRect(Math.round(this.x + Math.cos(a) * 11) - 1, Math.round(this.y - 8 + Math.sin(a) * 8) - 1, 2, 2);
      }
      ctx.globalAlpha = 1;
    } else if (this.charge > 0.18) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = PAL.x;
      ctx.fillRect(Math.round(this.x - 1), Math.round(this.y - 20), 2, 2);
      ctx.globalAlpha = 1;
    }
    if (!behind) drawSword(ctx, this);
  }
}

/** 剣そのもの。原点から angle の向きへ生やす。 */
function drawBlade(ctx, angle, len, glow) {
  ctx.save();
  ctx.rotate(angle);
  const bl = Math.max(5, len - 6);
  // 柄
  ctx.fillStyle = PAL['0']; ctx.fillRect(-2, -2, 6, 4);
  ctx.fillStyle = PAL.d;    ctx.fillRect(-1, -1, 4, 2);
  // つば
  ctx.fillStyle = PAL['0']; ctx.fillRect(3, -4, 3, 8);
  ctx.fillStyle = PAL.s;    ctx.fillRect(4, -3, 2, 6);
  // 身
  ctx.fillStyle = PAL['0']; ctx.fillRect(6, -3, bl + 1, 6);
  ctx.fillStyle = PAL.w;    ctx.fillRect(6, -2, bl, 4);
  ctx.fillStyle = glow ? PAL.t : PAL.y; ctx.fillRect(6, -2, bl, 2);
  // 切っ先
  ctx.fillStyle = PAL['0'];
  ctx.beginPath(); ctx.moveTo(6 + bl, -3); ctx.lineTo(6 + bl + 4, 0); ctx.lineTo(6 + bl, 3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.x;
  ctx.beginPath(); ctx.moveTo(6 + bl, -2); ctx.lineTo(6 + bl + 3, 0); ctx.lineTo(6 + bl, 2); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** 振りの軌跡と剣 */
function drawSword(ctx, p) {
  const px = Math.round(p.x), py = Math.round(p.y - 7);
  const bladeLen = 12 + Math.min(3, p.swordLv);

  if (p.spin > 0) {
    const t = 1 - p.spin / PLAYER.spinTime;
    const a0 = t * TAU * 2.2;
    ctx.save();
    ctx.translate(px, py);
    for (let k = 1; k <= 4; k++) {
      ctx.globalAlpha = 0.55 - k * 0.11;
      ctx.strokeStyle = k < 2 ? PAL.y : PAL.k;
      ctx.lineWidth = 3.2 - k * 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, bladeLen + 3, a0 - k * 0.42, a0 - (k - 1) * 0.42);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    drawBlade(ctx, a0, bladeLen, true);
    ctx.restore();
    return;
  }

  if (p.attack <= 0) return;
  const t = 1 - p.attack / PLAYER.attackTime;
  const base = [Math.PI / 2, Math.PI, 0, -Math.PI / 2][p.attackDir];
  const swing = p.combo === 0 ? 1 : -1;
  const a = base + swing * lerp(-1.15, 1.15, easeOutCubic(t));
  const s = Math.sin(t * Math.PI);

  ctx.save();
  ctx.translate(px, py);
  // 振り抜いた跡
  ctx.globalAlpha = s * 0.9;
  ctx.strokeStyle = PAL.y;
  ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.arc(0, 0, bladeLen + 3, a - swing * 0.8, a, swing < 0); ctx.stroke();
  ctx.globalAlpha = s * 0.45;
  ctx.strokeStyle = PAL.k;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 0, bladeLen - 2, a - swing * 1.0, a, swing < 0); ctx.stroke();
  ctx.globalAlpha = 1;
  drawBlade(ctx, a, bladeLen, false);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 敵
// ---------------------------------------------------------------------------
export const ENEMY_DEF = {
  slime:    { hp: 4,  speed: 26, dmg: 1, spr: 'slime',    ai: 'hop',    coin: [2, 4],  hw: 6, hh: 4, shadow: 6, name: 'スライム' },
  bat:      { hp: 3,  speed: 52, dmg: 1, spr: 'bat',      ai: 'flyer',  coin: [2, 4],  hw: 5, hh: 4, shadow: 4, fly: 1, name: 'コウモリ' },
  skeleton: { hp: 7,  speed: 32, dmg: 2, spr: 'skeleton', ai: 'chaser', coin: [4, 8],  hw: 5, hh: 4, shadow: 5, name: 'がいこつ' },
  spore:    { hp: 6,  speed: 0,  dmg: 1, spr: 'spore',    ai: 'turret', coin: [3, 6],  hw: 6, hh: 4, shadow: 6, name: 'キノコ' },
  wolf:     { hp: 6,  speed: 42, dmg: 2, spr: 'wolf',     ai: 'dasher', coin: [4, 8],  hw: 7, hh: 4, shadow: 7, name: 'やまいぬ' },
  warden:   { hp: 46, speed: 26, dmg: 2, spr: 'warden',   ai: 'aiBoss',   coin: [60, 90], hw: 12, hh: 8, shadow: 13, scale: 2, boss: 1, name: '根の番人' },

  // --- 追加の敵 ---
  crow:     { hp: 5,  speed: 46, dmg: 2, spr: 'crow',     ai: 'diver',   coin: [4, 7],  hw: 6, hh: 4, shadow: 5, fly: 1, name: 'ものまね鳥' },
  thorn:    { hp: 5,  speed: 70, dmg: 2, spr: 'thorn',    ai: 'roller',  coin: [3, 6],  hw: 5, hh: 5, shadow: 6, name: 'とげまり' },
  stump:    { hp: 9,  speed: 30, dmg: 2, spr: 'stump',    ai: 'ambush',  coin: [6, 10], hw: 7, hh: 5, shadow: 7, name: 'ねぼけ株' },
  wisp:     { hp: 4,  speed: 34, dmg: 1, spr: 'wisp',     ai: 'drifter', coin: [3, 6],  hw: 5, hh: 4, shadow: 4, fly: 1, split: 1, name: 'ひとだま' },
  hatling:  { hp: 6,  speed: 30, dmg: 2, spr: 'hatling',  ai: 'blinker', coin: [6, 11], hw: 5, hh: 4, shadow: 5, name: 'こぼうし' },
  weeper:   { hp: 8,  speed: 22, dmg: 2, spr: 'weeper',   ai: 'leaker',  coin: [5, 9],  hw: 6, hh: 4, shadow: 6, name: 'なきぼう' },
  shielder: { hp: 12, speed: 24, dmg: 2, spr: 'shielder', ai: 'guard',   coin: [8, 14], hw: 7, hh: 5, shadow: 7, name: 'たてもち' },
};

export class Enemy extends Entity {
  constructor(x, y, kind, level = 1) {
    super(x, y);
    const d = ENEMY_DEF[kind] || ENEMY_DEF.slime;
    this.kind = kind; this.def = d;
    this.level = level;
    this.maxHp = Math.round(d.hp * (1 + 0.35 * (level - 1)));
    this.hp = this.maxHp;
    this.dmg = d.dmg + (level > 2 ? 1 : 0);
    this.speed = d.speed;
    this.hw = d.hw; this.hh = d.hh;
    this.shadow = d.shadow;
    this.scale = d.scale || 1;
    this.fly = !!d.fly;
    this.boss = !!d.boss;
    this.state = 'idle';
    this.t = rng() * 3;
    this.cd = rng.range(0.4, 1.6);
    this.phase = 0;
    this.wobble = rng() * TAU;
    this.home = { x, y };
    this.aggro = false;
    this.flash = 0;
    this.stun = 0;
    if (this.fly) this.z = 8;
  }

  hurt(g, amount, fromX, fromY, kb = 130) {
    if (this.hp <= 0) return;
    // たてもちは 向いている側からの攻撃を はじく
    if (this.def.ai === 'guard') {
      const [vx, vy] = DIR_VEC[this.dir];
      const ax = fromX - this.x, ay = fromY - this.y;
      const l = Math.hypot(ax, ay) || 1;
      if ((ax / l) * vx + (ay / l) * vy > 0.35) {
        this.flash = 0.08;
        this.aggro = true;
        sfx('error');
        FX.burst(this.x + vx * 8, this.y - 6 + vy * 6, 6, [PAL.y, PAL.x], { spMax: 60 });
        FX.floatText(this.x, this.y - 16, 'カン', PAL.x, { size: 7 });
        return;
      }
    }
    this.hp -= amount;
    this.flash = 0.14;
    this.aggro = true;
    this.stun = this.boss ? 0.06 : 0.16;
    const a = Math.atan2(this.y - fromY, this.x - fromX);
    const k = this.boss ? kb * 0.25 : kb;
    this.kbx = Math.cos(a) * k; this.kby = Math.sin(a) * k;
    FX.burst(this.x, this.y - 6, this.boss ? 10 : 6, [PAL.y, PAL.s, PAL.o], { spMax: 90 });
    FX.floatText(this.x + rng.range(-3, 3), this.y - 12 - this.z, String(amount), PAL.t, { size: 7 });
    sfx(this.boss ? 'hitHard' : 'hit');
    FX.hitstop(this.boss ? 0.05 : 0.035);
    FX.shake(this.boss ? 2.2 : 1.4, 0.14);
    if (this.hp <= 0) this.die(g);
  }

  die(g) {
    this.dead = true;
    FX.burst(this.x, this.y - 6, this.boss ? 34 : 12, [PAL.y, PAL.x, PAL.o, PAL.s], { spMax: this.boss ? 150 : 90, life: 0.7 });
    FX.ring(this.x, this.y - 5, { r0: 3, r1: this.boss ? 44 : 20, life: 0.36, color: PAL.t });
    FX.shake(this.boss ? 7 : 2, this.boss ? 0.5 : 0.16);
    sfx(this.boss ? 'bomb' : 'die');
    const n = rng.irange(this.def.coin[0], this.def.coin[1]);
    const drops = Math.min(n, 8);
    const per = Math.ceil(n / drops);
    for (let i = 0; i < drops; i++) g.spawnPickup(this.x, this.y, 'coin', per);
    if (rng() < (this.boss ? 1 : 0.16)) g.spawnPickup(this.x, this.y, 'heart');
    if (this.boss) {
      for (let i = 0; i < 3; i++) g.spawnPickup(this.x, this.y, 'heart');
      g.onBossDefeated?.(this);
    } else if (rng() < 0.05) g.spawnPickup(this.x, this.y, 'gem');

    // ひとだまは 二つに わかれる（小さいのは わかれない）
    if (this.def.split && !this.small) {
      for (let i = 0; i < 2; i++) {
        const a = rng.angle();
        const e = g.spawnEnemy(this.x + Math.cos(a) * 10, this.y + Math.sin(a) * 10, this.kind, this.level);
        if (e) {
          e.small = true; e.maxHp = Math.max(1, Math.round(this.maxHp * 0.5)); e.hp = e.maxHp;
          e.scale = 0.75; e.hw = 4; e.hh = 3; e.aggro = true;
        }
      }
      sfx('spawn');
    }
  }

  update(dt, g) {
    if (this.hp <= 0) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.cd -= dt;
    const p = g.player;
    const d = dist(this.x, this.y, p.x, p.y);
    if (!this.aggro && d < (this.boss ? 200 : 92) && this.def.ai !== 'ambush') this.aggro = true;
    if (this.aggro && d > 260 && !this.boss) this.aggro = false;

    if (this.stun <= 0 && p.hp > 0) this[this.def.ai](dt, g, p, d);
    this.applyKnockback(dt, g, this.fly);

    // 接触ダメージ
    if (p.hp > 0 && Math.abs(this.x - p.x) < this.hw + p.hw + 2 &&
        Math.abs(this.y - p.y) < this.hh + p.hh + 4 && Math.abs(this.z - p.z) < 14) {
      p.hurt(g, this.dmg, this.x, this.y);
    }
  }

  // --- AI ---
  hop(dt, g, p, d) {
    if (this.z > 0 || this.vz > 0) {
      this.z += this.vz * dt; this.vz -= 260 * dt;
      this.moveBy(g, this.vx * dt, this.vy * dt);
      if (this.z <= 0) { this.z = 0; this.vz = 0; this.vx = this.vy = 0; FX.dust(this.x, this.y, 3); }
      return;
    }
    if (this.cd <= 0) {
      this.cd = rng.range(0.7, 1.3);
      const a = this.aggro ? Math.atan2(p.y - this.y, p.x - this.x) + rng.range(-0.3, 0.3) : rng.angle();
      const sp = this.speed * (this.aggro ? 1.5 : 0.7);
      this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
      this.vz = 62;
      this.dir = dirFromVec(this.vx, this.vy);
    }
  }

  flyer(dt, g, p, d) {
    this.wobble += dt * 6;
    this.z = 8 + Math.sin(this.wobble) * 3;
    let ax, ay;
    if (this.aggro) {
      ax = p.x - this.x; ay = p.y - this.y;
    } else {
      ax = this.home.x - this.x + Math.cos(this.t * 1.3) * 40;
      ay = this.home.y - this.y + Math.sin(this.t * 1.7) * 40;
    }
    const l = Math.hypot(ax, ay) || 1;
    const sp = this.speed * (this.aggro ? 1 : 0.55);
    this.vx = lerp(this.vx, (ax / l) * sp + Math.cos(this.wobble * 1.7) * 20, 0.06);
    this.vy = lerp(this.vy, (ay / l) * sp + Math.sin(this.wobble * 2.1) * 14, 0.06);
    this.moveBy(g, this.vx * dt, this.vy * dt, true);
    this.dir = dirFromVec(this.vx, this.vy);
  }

  chaser(dt, g, p, d) {
    if (!this.aggro) {
      if (this.cd <= 0) {
        this.cd = rng.range(1.0, 2.4);
        const a = rng.angle();
        this.vx = Math.cos(a) * this.speed * 0.4; this.vy = Math.sin(a) * this.speed * 0.4;
      }
      this.moveBy(g, this.vx * dt, this.vy * dt);
      return;
    }
    const a = Math.atan2(p.y - this.y, p.x - this.x);
    // 少し左右に振れて群れが重ならないように
    const off = Math.sin(this.t * 2 + this.wobble) * 0.35;
    this.vx = Math.cos(a + off) * this.speed;
    this.vy = Math.sin(a + off) * this.speed;
    this.dir = dirFromVec(this.vx, this.vy);
    this.moveBy(g, this.vx * dt, this.vy * dt);
  }

  turret(dt, g, p, d) {
    this.dir = dirFromVec(p.x - this.x, p.y - this.y);
    if (this.aggro && d < 110 && this.cd <= 0) {
      this.cd = rng.range(1.5, 2.4);
      const a = Math.atan2(p.y - this.y - 4, p.x - this.x);
      for (let i = -1; i <= 1; i++) {
        g.spawnProjectile(this.x, this.y - 8, a + i * 0.24, 62, this.dmg, 'spore');
      }
      sfx('shoot');
    }
  }

  dasher(dt, g, p, d) {
    if (this.state === 'dash') {
      this.moveBy(g, this.vx * dt, this.vy * dt);
      this.cd -= dt * 0;
      if (this.t > this.stateEnd) { this.state = 'idle'; this.cd = rng.range(0.8, 1.6); }
      if (rng() < 0.4) FX.dust(this.x, this.y, 1);
      return;
    }
    if (this.state === 'wind') {
      if (this.t > this.stateEnd) {
        this.state = 'dash'; this.stateEnd = this.t + 0.42;
        const a = Math.atan2(p.y - this.y, p.x - this.x);
        this.vx = Math.cos(a) * this.speed * 3.1;
        this.vy = Math.sin(a) * this.speed * 3.1;
        this.dir = dirFromVec(this.vx, this.vy);
        sfx('dash');
      }
      return;
    }
    if (this.aggro && d < 110 && this.cd <= 0) {
      this.state = 'wind'; this.stateEnd = this.t + 0.42;
      this.dir = dirFromVec(p.x - this.x, p.y - this.y);
      return;
    }
    if (this.cd <= 0) {
      this.cd = rng.range(0.9, 1.8);
      const a = this.aggro ? Math.atan2(p.y - this.y, p.x - this.x) + rng.range(-0.9, 0.9) : rng.angle();
      this.vx = Math.cos(a) * this.speed * 0.5; this.vy = Math.sin(a) * this.speed * 0.5;
      this.dir = dirFromVec(this.vx, this.vy);
    }
    this.moveBy(g, this.vx * dt, this.vy * dt);
  }

  // --- 追加の敵の AI ---

  /** ものまね鳥：空で待って、まっすぐ 急降下してくる */
  diver(dt, g, p, d) {
    this.wobble += dt * 5;
    if (this.state === 'dive') {
      this.z = Math.max(0, this.z - 46 * dt);
      this.moveBy(g, this.vx * dt, this.vy * dt, true);
      if (this.t > this.stateEnd) { this.state = 'up'; this.stateEnd = this.t + 0.9; sfx('swing'); }
      return;
    }
    if (this.state === 'up') {
      this.z = Math.min(20, this.z + 40 * dt);
      const ax = this.home.x - this.x, ay = this.home.y - this.y;
      const l = Math.hypot(ax, ay) || 1;
      this.moveBy(g, (ax / l) * this.speed * 0.7 * dt, (ay / l) * this.speed * 0.7 * dt, true);
      if (this.t > this.stateEnd) { this.state = 'idle'; this.cd = rng.range(0.6, 1.4); }
      return;
    }
    // 空をまわりながら ねらう
    this.z = 18 + Math.sin(this.wobble) * 3;
    const a = this.t * 1.1 + this.wobble * 0.2;
    const tx = (this.aggro ? p.x : this.home.x) + Math.cos(a) * 34;
    const ty = (this.aggro ? p.y : this.home.y) + Math.sin(a) * 26;
    const ax = tx - this.x, ay = ty - this.y;
    const l = Math.hypot(ax, ay) || 1;
    this.vx = lerp(this.vx, (ax / l) * this.speed, 0.08);
    this.vy = lerp(this.vy, (ay / l) * this.speed, 0.08);
    this.moveBy(g, this.vx * dt, this.vy * dt, true);
    this.dir = dirFromVec(this.vx, this.vy);
    if (this.aggro && this.cd <= 0 && d < 90) {
      this.state = 'dive'; this.stateEnd = this.t + 0.55;
      const ang = Math.atan2(p.y - this.y, p.x - this.x);
      this.vx = Math.cos(ang) * this.speed * 2.6;
      this.vy = Math.sin(ang) * this.speed * 2.6;
      this.dir = dirFromVec(this.vx, this.vy);
      sfx('dash');
    }
  }

  /** とげまり：まっすぐ ころがって、壁で はねかえる */
  roller(dt, g, p, d) {
    if (!this.rolling) {
      if (!this.aggro) return;
      const a = Math.atan2(p.y - this.y, p.x - this.x);
      this.vx = Math.cos(a) * this.speed; this.vy = Math.sin(a) * this.speed;
      this.rolling = true;
    }
    const bx = this.x, by = this.y;
    this.moveBy(g, this.vx * dt, 0);
    if (Math.abs(this.x - bx) < Math.abs(this.vx * dt) * 0.6) { this.vx = -this.vx; sfx('hit'); }
    this.moveBy(g, 0, this.vy * dt);
    if (Math.abs(this.y - by) < Math.abs(this.vy * dt) * 0.6) { this.vy = -this.vy; sfx('hit'); }
    // ときどき ねらいなおす
    if (this.cd <= 0) {
      this.cd = rng.range(1.6, 2.8);
      const a = Math.atan2(p.y - this.y, p.x - this.x) + rng.range(-0.5, 0.5);
      const sp = Math.hypot(this.vx, this.vy) || this.speed;
      this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
    }
    if (rng() < dt * 6) FX.dust(this.x, this.y, 1);
  }

  /** ねぼけ株：近づくまで ただの切り株。起きたら 追ってくる */
  ambush(dt, g, p, d) {
    if (!this.awake) {
      this.aggro = false;
      if (d < 34) {
        this.awake = true; this.aggro = true;
        sfx('spawn'); FX.dust(this.x, this.y, 6);
        FX.floatText(this.x, this.y - 16, '！', PAL.o, { size: 9 });
      }
      return;
    }
    this.chaser(dt, g, p, d);
  }

  /** ひとだま：ふわふわ ただよう。たおすと 二つに わかれる */
  drifter(dt, g, p, d) {
    this.wobble += dt * 3;
    this.z = 7 + Math.sin(this.wobble) * 4;
    const a = this.aggro ? Math.atan2(p.y - this.y, p.x - this.x) : this.wobble * 0.6;
    const sp = this.speed * (this.aggro ? 1 : 0.4);
    this.vx = lerp(this.vx, Math.cos(a) * sp + Math.cos(this.wobble * 2.3) * 22, 0.05);
    this.vy = lerp(this.vy, Math.sin(a) * sp + Math.sin(this.wobble * 1.9) * 16, 0.05);
    this.moveBy(g, this.vx * dt, this.vy * dt, true);
  }

  /** こぼうし：すっと消えて、プレイヤーのそばに 出る */
  blinker(dt, g, p, d) {
    if (this.fade == null) this.fade = 1;
    if (this.state === 'gone') {
      this.fade = Math.max(0, this.fade - dt * 5);
      if (this.t > this.stateEnd) {
        const a = rng.angle();
        const r = 26 + rng() * 10;
        const nx = p.x + Math.cos(a) * r, ny = p.y + Math.sin(a) * r;
        if (!g.level.hits(nx, ny, this.hw, this.hh)) { this.x = nx; this.y = ny; }
        this.state = 'idle'; this.cd = rng.range(1.4, 2.4);
        sfx('magic');
        FX.ring(this.x, this.y - 6, { r0: 2, r1: 16, life: 0.3, color: PAL.s });
      }
      return;
    }
    this.fade = Math.min(1, this.fade + dt * 5);
    this.dir = dirFromVec(p.x - this.x, p.y - this.y);
    if (this.aggro) {
      const a = Math.atan2(p.y - this.y, p.x - this.x);
      this.vx = Math.cos(a) * this.speed; this.vy = Math.sin(a) * this.speed;
      this.moveBy(g, this.vx * dt, this.vy * dt);
    }
    if (this.aggro && this.cd <= 0 && d > 20) {
      this.state = 'gone'; this.stateEnd = this.t + 0.45;
      FX.burst(this.x, this.y - 6, 8, [PAL['1'], PAL.s], { spMax: 40 });
    }
  }

  /** なきぼう：のろいが、あるいたあとに 水たまりを おとす */
  leaker(dt, g, p, d) {
    this.chaser(dt, g, p, d);
    if (this.aggro && this.cd <= 0) {
      this.cd = rng.range(0.8, 1.4);
      g.hazards.push({ kind: 'puddle', x: this.x, y: this.y, t: 0, warn: 0.35, life: 5.2, dmg: 1, r: 9, done: false });
      sfx('splash');
    }
  }

  /** たてもち：前からの攻撃を たてで はじく。うしろに回れ */
  guard(dt, g, p, d) {
    this.dir = dirFromVec(p.x - this.x, p.y - this.y);
    if (!this.aggro) return;
    const a = Math.atan2(p.y - this.y, p.x - this.x);
    // ゆっくり近づいて、たまに たてで押してくる
    if (this.state === 'bash') {
      this.moveBy(g, this.vx * dt, this.vy * dt);
      if (this.t > this.stateEnd) { this.state = 'idle'; this.cd = rng.range(1.6, 2.6); }
      return;
    }
    this.vx = Math.cos(a) * this.speed; this.vy = Math.sin(a) * this.speed;
    this.moveBy(g, this.vx * dt, this.vy * dt);
    if (this.cd <= 0 && d < 40) {
      this.state = 'bash'; this.stateEnd = this.t + 0.45;
      this.vx = Math.cos(a) * this.speed * 3.4; this.vy = Math.sin(a) * this.speed * 3.4;
      sfx('dash');
    }
  }

  aiBoss(dt, g, p, d) {
    const hpr = this.hp / this.maxHp;
    if (this.state === 'idle') {
      const a = Math.atan2(p.y - this.y, p.x - this.x);
      this.vx = lerp(this.vx, Math.cos(a) * this.speed, 0.04);
      this.vy = lerp(this.vy, Math.sin(a) * this.speed, 0.04);
      this.dir = dirFromVec(this.vx, this.vy);
      this.moveBy(g, this.vx * dt, this.vy * dt);
      if (this.cd <= 0) {
        const roll = rng();
        if (roll < 0.4) { this.state = 'wind'; this.stateEnd = this.t + 0.6; }
        else if (roll < 0.75) { this.state = 'summon'; this.stateEnd = this.t + 0.7; }
        else { this.state = 'spray'; this.stateEnd = this.t + 0.9; this.sprayN = 0; }
        this.cd = 9;
      }
    } else if (this.state === 'wind') {
      FX.dust(this.x + rng.range(-8, 8), this.y, 1);
      if (this.t > this.stateEnd) {
        this.state = 'charge'; this.stateEnd = this.t + 0.9;
        const a = Math.atan2(p.y - this.y, p.x - this.x);
        this.vx = Math.cos(a) * this.speed * 4.2;
        this.vy = Math.sin(a) * this.speed * 4.2;
        sfx('dash');
      }
    } else if (this.state === 'charge') {
      this.moveBy(g, this.vx * dt, this.vy * dt);
      FX.dust(this.x, this.y, 2);
      if (this.t > this.stateEnd) { this.state = 'idle'; this.cd = rng.range(1.2, 2.2) * (hpr < 0.5 ? 0.6 : 1); }
    } else if (this.state === 'summon') {
      if (this.t > this.stateEnd) {
        const n = hpr < 0.5 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const a = rng.angle();
          g.spawnEnemy(this.x + Math.cos(a) * 26, this.y + Math.sin(a) * 26, rng() < 0.5 ? 'bat' : 'slime', this.level);
        }
        sfx('spawn');
        FX.ring(this.x, this.y - 8, { r0: 4, r1: 40, life: 0.4, color: PAL.A });
        this.state = 'idle'; this.cd = rng.range(1.6, 2.6);
      }
    } else if (this.state === 'spray') {
      if (this.cd2 == null || this.t > this.cd2) {
        this.cd2 = this.t + 0.16;
        const base = this.t * 3.4;
        for (let i = 0; i < 4; i++) {
          g.spawnProjectile(this.x, this.y - 10, base + i * TAU / 4, 58, this.dmg, 'spore');
        }
        sfx('shoot');
        this.sprayN++;
      }
      if (this.t > this.stateEnd) { this.state = 'idle'; this.cd = rng.range(1.4, 2.4); this.cd2 = null; }
    }
  }

  draw(ctx) {
    this.drawShadow(ctx);
    let spr;
    const frames = (this.kind === 'wolf' && (this.dir === 1)) ? SPR.wolfL : SPR[this.def.spr];
    let f = Math.floor(this.t * (this.state === 'dash' || this.state === 'charge' ? 12 : 5)) % frames.length;
    if (this.def.ai === 'ambush') f = this.awake ? 1 : 0;          // 起きるまで 目をあけない
    if (this.def.ai === 'roller') f = Math.floor(this.t * 14) % frames.length;
    spr = frames[f];
    if (this.fade != null && this.fade < 1) ctx.globalAlpha = this.fade;
    const tel = (this.state === 'wind');
    if (tel && Math.floor(this.t * 20) % 2 === 0) {
      this.blit(ctx, spr, 0, 0, this.scale, true);
    } else {
      this.blit(ctx, spr, 0, 0, this.scale, this.flash > 0);
    }
    ctx.globalAlpha = 1;
    if (this.boss) drawBossBarWorld(ctx, this);
  }
}

function drawBossBarWorld(ctx, e) {
  const w = 30, x = Math.round(e.x - w / 2), y = Math.round(e.y - 40);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
  ctx.fillStyle = PAL.m; ctx.fillRect(x, y, w, 3);
  ctx.fillStyle = PAL.o; ctx.fillRect(x, y, Math.round(w * clamp(e.hp / e.maxHp, 0, 1)), 3);
}

// ---------------------------------------------------------------------------
// 弾
// ---------------------------------------------------------------------------
export class Projectile extends Entity {
  constructor(x, y, angle, speed, dmg, kind, friendly = false) {
    super(x, y);
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.dmg = dmg;
    this.kind = kind;
    this.friendly = friendly;
    this.life = 3.2;
    this.hw = 2; this.hh = 2;
    this.shadow = 0;
    this.t = 0;
    this.z = 8;
  }
  update(dt, g) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (g.level.hits(this.x, this.y, 1, 1)) { this.burst(); return; }
    if (this.friendly) {
      for (const e of g.enemies) {
        if (e.dead || e.hp <= 0) continue;
        if (Math.abs(e.x - this.x) < e.hw + 4 && Math.abs(e.y - 4 - this.y) < e.hh + 8) {
          e.hurt(g, this.dmg, this.x, this.y, 100);
          this.burst(); return;
        }
      }
    } else {
      const p = g.player;
      if (p.hp > 0 && Math.abs(p.x - this.x) < p.hw + 3 && Math.abs(p.y - 5 - this.y) < p.hh + 6) {
        p.hurt(g, this.dmg, this.x, this.y);
        this.burst(); return;
      }
    }
    if (rng() < 0.3) FX.particle(this.x, this.y - this.z, {
      vx: 0, vy: 0, life: 0.2, size: 1, color: this.friendly ? PAL.C : PAL.b,
    });
  }
  burst() {
    this.dead = true;
    FX.burst(this.x, this.y - this.z, 5, this.friendly ? [PAL.C, PAL.B] : [PAL.b, PAL.a]);
  }
  draw(ctx) {
    const c = this.friendly ? [PAL.C, PAL.B, PAL.A] : [PAL.b, PAL.a, PAL['8']];
    const x = Math.round(this.x), y = Math.round(this.y - this.z);
    ctx.fillStyle = c[2]; ctx.fillRect(x - 2, y - 2, 4, 4);
    ctx.fillStyle = c[1]; ctx.fillRect(x - 2, y - 1, 4, 2); ctx.fillRect(x - 1, y - 2, 2, 4);
    ctx.fillStyle = c[0]; ctx.fillRect(x - 1, y - 1, 2, 2);
  }
}

// ---------------------------------------------------------------------------
// 落ちもの
// ---------------------------------------------------------------------------
const PICKUP_SPR = { coin: 'coin', heart: 'heart', key: 'key', gem: 'gem', bomb: 'bomb', potion: 'potion', star: 'star' };

export class Pickup extends Entity {
  constructor(x, y, kind, amount = 1) {
    super(x, y);
    this.kind = kind; this.amount = amount;
    this.hw = 4; this.hh = 3;
    this.shadow = 3;
    const a = rng.angle();
    const sp = rng.range(14, 46);
    this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
    this.z = 3; this.vz = rng.range(40, 80);
    this.life = 26;
    this.t = rng() * 3;
    this.pull = 0;
  }
  update(dt, g) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    const p = g.player;
    const d = dist(this.x, this.y, p.x, p.y);
    if (this.z > 0 || this.vz !== 0) {
      this.z += this.vz * dt; this.vz -= 240 * dt;
      this.moveBy(g, this.vx * dt, this.vy * dt);
      this.vx *= Math.pow(0.1, dt); this.vy *= Math.pow(0.1, dt);
      if (this.z <= 0) { this.z = 0; this.vz = 0; }
    } else if (d < 34 && p.hp > 0) {
      this.pull = Math.min(1, this.pull + dt * 3);
      const a = Math.atan2(p.y - 5 - this.y, p.x - this.x);
      const sp = 40 + this.pull * 190;
      this.x += Math.cos(a) * sp * dt;
      this.y += Math.sin(a) * sp * dt;
    }
    if (d < 9 && p.hp > 0) { g.collect(this); this.dead = true; }
  }
  draw(ctx) {
    if (this.life < 5 && Math.floor(this.life * 6) % 2 === 0) return;
    this.drawShadow(ctx);
    const spr = SPR[PICKUP_SPR[this.kind]] || SPR.coin;
    const bob = Math.sin(this.t * 4) * 1.2;
    this.blit(ctx, spr, 0, -1 + bob, 1);
  }
}

// ---------------------------------------------------------------------------
// NPC（村人・救出対象）
// ---------------------------------------------------------------------------
export class Npc extends Entity {
  constructor(x, y, kind, data = {}) {
    super(x, y);
    this.kind = kind % SPR.villagers.length;
    this.hw = 4; this.hh = 3;
    this.shadow = 5;
    this.data = data;
    this.name = data.name || '村人';
    this.lines = data.lines || ['こんにちは。'];
    this.t = rng() * 5;
    this.home = { x, y };
    this.walkT = 0;
    this.cd = rng.range(1, 3);
    this.vx = 0; this.vy = 0;
    this.static = !!data.static;
    this.spr = data.spr || null;      // 村人以外の見た目（帽子の人など）
    this.bob = !!data.bob;
  }
  update(dt, g) {
    this.t += dt;
    if (this.static) return;
    this.cd -= dt;
    if (this.cd <= 0) {
      this.cd = rng.range(1.4, 3.6);
      if (rng() < 0.45) { this.vx = 0; this.vy = 0; }
      else {
        const a = rng.angle();
        this.vx = Math.cos(a) * 16; this.vy = Math.sin(a) * 16;
      }
    }
    if (this.vx || this.vy) {
      if (dist(this.x, this.y, this.home.x, this.home.y) > 40) {
        const a = Math.atan2(this.home.y - this.y, this.home.x - this.x);
        this.vx = Math.cos(a) * 16; this.vy = Math.sin(a) * 16;
      }
      this.dir = dirFromVec(this.vx, this.vy);
      this.walkT += dt * 6;
      this.moveBy(g, this.vx * dt, this.vy * dt);
    } else this.walkT = 0;
    // プレイヤーのほうを向く
    const p = g.player;
    if (dist(this.x, this.y, p.x, p.y) < 22) {
      this.dir = dirFromVec(p.x - this.x, p.y - this.y);
      this.vx = this.vy = 0; this.walkT = 0;
    }
  }
  draw(ctx) {
    this.drawShadow(ctx);
    if (this.spr && SPR[this.spr]) {
      const b = this.bob ? Math.round(Math.sin(this.t * 2) * 1.2) : 0;
      this.blit(ctx, SPR[this.spr], 0, b);
      return;
    }
    const set = SPR.villagers[this.kind];
    const f = this.walkT > 0 ? Math.floor(this.walkT) % 2 : 0;
    this.blit(ctx, set[this.dir][f], 0, this.walkT > 0 && f === 1 ? -1 : 0);
  }
}

// ---------------------------------------------------------------------------
// 爆弾
// ---------------------------------------------------------------------------
export class Bomb extends Entity {
  constructor(x, y, dmg = 6) {
    super(x, y);
    this.hw = 3; this.hh = 3;
    this.shadow = 4;
    this.fuse = 1.5;
    this.dmg = dmg;
    this.t = 0;
    this.z = 2; this.vz = 30;
    this.beep = 0;
  }
  update(dt, g) {
    this.t += dt;
    this.fuse -= dt;
    if (this.z > 0 || this.vz !== 0) {
      this.z += this.vz * dt; this.vz -= 240 * dt;
      this.moveBy(g, this.vx * dt, this.vy * dt);
      this.vx *= Math.pow(0.06, dt); this.vy *= Math.pow(0.06, dt);
      if (this.z <= 0) { this.z = 0; this.vz = 0; }
    }
    this.beep -= dt;
    if (this.beep <= 0) { this.beep = this.fuse < 0.5 ? 0.12 : 0.34; sfx('fuse'); }
    if (this.fuse <= 0) this.explode(g);
  }
  explode(g) {
    this.dead = true;
    sfx('bomb');
    FX.shake(6, 0.4); FX.hitstop(0.06);
    FX.ring(this.x, this.y - 4, { r0: 4, r1: 34, life: 0.36, color: PAL.t, width: 2 });
    FX.burst(this.x, this.y - 4, 26, [PAL.t, PAL.s, PAL.o, PAL.w], { spMax: 150, life: 0.7 });
    const R = 30;
    for (const e of g.enemies) {
      if (e.dead || e.hp <= 0) continue;
      if (dist(e.x, e.y, this.x, this.y) < R + e.hw) e.hurt(g, this.dmg, this.x, this.y, 200);
    }
    if (dist(g.player.x, g.player.y, this.x, this.y) < R * 0.8) g.player.hurt(g, 1, this.x, this.y);
    g.blastTiles(this.x, this.y, 2);
  }
  draw(ctx) {
    this.drawShadow(ctx);
    const blink = this.fuse < 0.5 && Math.floor(this.t * 12) % 2 === 0;
    this.blit(ctx, SPR.bomb, 0, 0, 1, blink);
  }
}
