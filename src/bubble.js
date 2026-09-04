// ---------------------------------------------------------------------------
// bubble.js — キャラの頭上に出る吹き出し
//   ワールド座標を画面座標に直して、UI レイヤー（等倍）へ描く。
//   文字はドットに潰さず、くっきり表示させたいので実解像度で描画する。
// ---------------------------------------------------------------------------
import { clamp, easeOutBack } from './util.js';
import { FONT } from './config.js';

export const bubbles = [];

/**
 * @param {object} opt
 *   target : {x,y} を持つ実体（追従する）。省略時は x,y 固定
 *   text   : 表示する文（\n 可）
 *   life   : 表示時間（秒）
 *   tone   : 'normal' | 'boss' | 'think'
 */
export function say(opt) {
  const b = {
    target: opt.target || null,
    x: opt.x ?? 0, y: opt.y ?? 0,
    dy: opt.dy ?? -22,
    text: String(opt.text || ''),
    life: opt.life ?? 2.6,
    max: opt.life ?? 2.6,
    t: 0,
    tone: opt.tone || 'normal',
  };
  // 同じ相手のふきだしは重ねない
  if (b.target) {
    for (let i = bubbles.length - 1; i >= 0; i--)
      if (bubbles[i].target === b.target) bubbles.splice(i, 1);
  }
  bubbles.push(b);
  return b;
}

/** 何行かを ひとつずつ 順に見せる（世界は止めない） */
const queues = [];
export function sayQueue(target, lines, opt = {}) {
  if (!lines || !lines.length) return;
  const per = opt.per ?? 2.9;
  queues.push({ target, lines: lines.slice(), i: 0, t: 0, per, tone: opt.tone || 'normal' });
  say({ target, text: lines[0], life: per, tone: opt.tone || 'normal' });
}

export function clearBubbles() { bubbles.length = 0; queues.length = 0; }

export function updateBubbles(dt) {
  for (let q = queues.length - 1; q >= 0; q--) {
    const Q = queues[q];
    Q.t += dt;
    if (Q.t >= Q.per) {
      Q.t = 0; Q.i++;
      if (Q.i >= Q.lines.length || (Q.target && Q.target.dead)) { queues.splice(q, 1); continue; }
      say({ target: Q.target, text: Q.lines[Q.i], life: Q.per, tone: Q.tone });
    }
  }
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.t += dt;
    b.life -= dt;
    if (b.life <= 0 || (b.target && b.target.dead)) bubbles.splice(i, 1);
  }
}

/** ctx は UI レイヤー（CSS px）。toScreen は world→画面 の変換関数。 */
export function drawBubbles(ctx, toScreen, S) {
  for (const b of bubbles) {
    const wx = b.target ? b.target.x : b.x;
    const wy = (b.target ? b.target.y : b.y) + b.dy - (b.target?.z || 0);
    const p = toScreen(wx, wy);

    // 出るときは ぷるっと、消えぎわは すっと
    const inT = clamp(b.t / 0.16, 0, 1);
    const outT = clamp(b.life / 0.24, 0, 1);
    const scale = easeOutBack(inT);
    const alpha = outT;
    if (scale <= 0.01) continue;

    const size = (b.tone === 'boss' ? 15 : 13) * S;
    ctx.font = `700 ${size}px ${FONT}`;
    const lines = b.text.split('\n');
    let tw = 0;
    for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
    const padX = 11 * S, padY = 8 * S, lh = size * 1.35;
    const w = tw + padX * 2;
    const h = lines.length * lh + padY * 2 - (lh - size) * 0.5;
    const tail = 9 * S;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.scale(scale, scale);
    ctx.translate(0, -h - tail);

    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    bubblePath(ctx, -w / 2, 2 * S, w, h, 7 * S, tail);
    ctx.fill();
    // 本体
    ctx.fillStyle = b.tone === 'boss' ? '#f4e6e6' : '#ffffff';
    bubblePath(ctx, -w / 2, 0, w, h, 7 * S, tail);
    ctx.fill();
    ctx.strokeStyle = b.tone === 'boss' ? '#5a2230' : '#1d1a24';
    ctx.lineWidth = 2 * S;
    ctx.stroke();

    ctx.fillStyle = b.tone === 'boss' ? '#5a1c28' : '#181420';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, 0, padY + i * lh - 1 * S));
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function bubblePath(ctx, x, y, w, h, r, tail) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  // しっぽ（右下寄り）
  ctx.lineTo(x + w * 0.60, y + h);
  ctx.lineTo(x + w * 0.53, y + h + tail);
  ctx.lineTo(x + w * 0.47, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
