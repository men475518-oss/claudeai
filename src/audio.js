// ---------------------------------------------------------------------------
// audio.js — WebAudio による手続き効果音とループ BGM（外部ファイル不要）
// ---------------------------------------------------------------------------
import { makeRng, clamp } from './util.js';

let ac = null;
let master = null, sfxBus = null, musicBus = null;
let started = false;

export const audio = {
  get enabled() { return started && !muted; },
  volume: 0.8,
};
let muted = false;

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = v;
  if (master) master.gain.setTargetAtTime(v ? 0 : audio.volume, ac.currentTime, 0.05);
}
export function toggleMute() { setMuted(!muted); return muted; }

/** 最初のユーザー操作で呼ぶ */
export function initAudio() {
  if (started) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  master = ac.createGain();
  master.gain.value = muted ? 0 : audio.volume;
  master.connect(ac.destination);

  sfxBus = ac.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
  musicBus = ac.createGain(); musicBus.gain.value = 0.30; musicBus.connect(master);
  started = true;
  if (ac.state === 'suspended') ac.resume();
}

export function resumeAudio() { if (ac && ac.state === 'suspended') ac.resume(); }

// --- 低レベルヘルパ --------------------------------------------------------

function env(node, t, a, d, peak = 1) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  node.connect(g);
  return g;
}

function tone(freq, t, dur, type = 'square', peak = 0.3, bend = 0, bus = sfxBus) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + dur);
  const g = env(o, t, Math.min(0.012, dur * 0.2), dur, peak);
  g.connect(bus);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}

let noiseBuf = null;
function noise(t, dur, peak = 0.3, filterHz = 2000, q = 1, sweep = 1) {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.0, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 1;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(filterHz, t);
  if (sweep !== 1) f.frequency.exponentialRampToValueAtTime(Math.max(60, filterHz * sweep), t + dur);
  f.Q.value = q;
  src.connect(f);
  const g = env(f, t, 0.005, dur, peak);
  g.connect(sfxBus);
  src.start(t); src.stop(t + dur + 0.05);
}

// --- 効果音 ----------------------------------------------------------------

const SFX = {
  swing: (t) => { noise(t, 0.14, 0.28, 2400, 1.2, 0.35); },
  swingBig: (t) => { noise(t, 0.30, 0.36, 1600, 1.0, 0.25); tone(180, t, 0.22, 'sawtooth', 0.10, 0.5); },
  hit: (t) => { noise(t, 0.10, 0.42, 900, 0.8, 0.4); tone(320, t, 0.08, 'square', 0.20, 0.4); },
  hitHard: (t) => { noise(t, 0.18, 0.5, 500, 0.7, 0.3); tone(160, t, 0.14, 'square', 0.25, 0.35); },
  hurt: (t) => { tone(300, t, 0.28, 'sawtooth', 0.28, 0.35); noise(t, 0.16, 0.22, 700, 1, 0.5); },
  die: (t) => { tone(400, t, 0.6, 'square', 0.22, 0.18); tone(300, t + 0.05, 0.6, 'square', 0.16, 0.18); },
  coin: (t) => { tone(1046, t, 0.06, 'square', 0.20); tone(1568, t + 0.06, 0.14, 'square', 0.18); },
  heart: (t) => { tone(660, t, 0.08, 'triangle', 0.24); tone(880, t + 0.07, 0.10, 'triangle', 0.22); tone(1320, t + 0.15, 0.18, 'triangle', 0.18); },
  gem: (t) => { [880, 1174, 1568, 2093].forEach((f, i) => tone(f, t + i * 0.05, 0.16, 'triangle', 0.16)); },
  chest: (t) => { noise(t, 0.12, 0.3, 1200, 1, 0.5); [523, 659, 784, 1046].forEach((f, i) => tone(f, t + 0.08 + i * 0.07, 0.22, 'triangle', 0.2)); },
  door: (t) => { noise(t, 0.35, 0.24, 300, 0.7, 2.2); },
  step: (t) => { noise(t, 0.05, 0.10, 500, 0.9, 0.6); },
  dash: (t) => { noise(t, 0.22, 0.20, 1200, 0.8, 0.3); },
  bomb: (t) => { noise(t, 0.55, 0.55, 420, 0.5, 0.14); tone(90, t, 0.4, 'sawtooth', 0.28, 0.3); },
  fuse: (t) => { noise(t, 0.06, 0.12, 3200, 2, 1); },
  magic: (t) => { [523, 784, 1046].forEach((f, i) => tone(f, t + i * 0.04, 0.3, 'sine', 0.18, 1.6)); },
  shoot: (t) => { tone(700, t, 0.12, 'square', 0.16, 0.4); },
  ui: (t) => { tone(880, t, 0.05, 'square', 0.16); },
  uiBack: (t) => { tone(520, t, 0.06, 'square', 0.14); },
  error: (t) => { tone(180, t, 0.14, 'square', 0.2); tone(150, t + 0.08, 0.14, 'square', 0.18); },
  buy: (t) => { [784, 1046, 1318].forEach((f, i) => tone(f, t + i * 0.06, 0.18, 'triangle', 0.2)); },
  levelup: (t) => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, t + i * 0.08, 0.34, 'triangle', 0.22)); },
  rescue: (t) => { [659, 784, 988, 1318].forEach((f, i) => tone(f, t + i * 0.09, 0.4, 'sine', 0.2)); },
  spawn: (t) => { tone(220, t, 0.3, 'sawtooth', 0.16, 2.4); },
  boss: (t) => { tone(70, t, 1.2, 'sawtooth', 0.3, 0.7); noise(t, 0.9, 0.3, 260, 0.6, 0.5); },
  relic: (t) => { [523, 784, 1046, 1568].forEach((f, i) => tone(f, t + i * 0.12, 0.8, 'sine', 0.2)); },
  build: (t) => { noise(t, 0.12, 0.3, 800, 1, 0.6); noise(t + 0.14, 0.12, 0.26, 700, 1, 0.6); tone(392, t + 0.28, 0.3, 'triangle', 0.2); },
  splash: (t) => { noise(t, 0.3, 0.3, 1400, 0.7, 0.25); },
};

let lastPlay = new Map();
export function sfx(name, detune = 0) {
  if (!started || muted) return;
  const fn = SFX[name];
  if (!fn) return;
  const now = ac.currentTime;
  // 同じ音の連打を軽く間引く
  if (now - (lastPlay.get(name) || -1) < 0.025) return;
  lastPlay.set(name, now);
  try { fn(now + 0.001, detune); } catch (e) { /* ignore */ }
}

// --- BGM -------------------------------------------------------------------

const SCALES = {
  town:    [0, 2, 4, 7, 9, 12, 14, 16],
  field:   [0, 2, 3, 5, 7, 10, 12, 14],
  dungeon: [0, 1, 5, 7, 8, 12, 13, 17],
  boss:    [0, 1, 3, 6, 7, 10, 12, 13],
};
const ROOTS = { town: 261.63, field: 220.0, dungeon: 174.61, boss: 146.83 };
const PROG = {
  town:    [0, 5, 3, 4],
  field:   [0, 3, 5, 4],
  dungeon: [0, 0, 5, 3],
  boss:    [0, 1, 0, 5],
};

let musicTrack = null;
let musicTimer = null;
let nextNoteTime = 0;
let step = 0;
let mrng = makeRng(12345);

function scheduleStep(track, t) {
  const scale = SCALES[track], root = ROOTS[track], prog = PROG[track];
  const bar = Math.floor(step / 8) % prog.length;
  const chordRoot = root * Math.pow(2, prog[bar] / 12);
  const s = step % 8;

  // ベース
  if (s === 0 || s === 4) {
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.value = chordRoot / 2;
    const g = env(o, t, 0.02, 0.5, 0.30);
    g.connect(musicBus);
    o.start(t); o.stop(t + 0.6);
  }
  // アルペジオ
  if (track === 'boss' ? true : (s % 2 === 0 || mrng() < 0.4)) {
    const deg = scale[(s + bar * 2) % scale.length];
    const f = chordRoot * Math.pow(2, deg / 12);
    const o = ac.createOscillator();
    o.type = track === 'town' ? 'triangle' : track === 'boss' ? 'sawtooth' : 'square';
    o.frequency.value = f;
    const g = env(o, t, 0.01, track === 'town' ? 0.34 : 0.22, track === 'boss' ? 0.16 : 0.13);
    g.connect(musicBus);
    o.start(t); o.stop(t + 0.5);
  }
  // 上物（たまに）
  if (mrng() < (track === 'town' ? 0.30 : 0.16)) {
    const deg = scale[mrng.int(scale.length)];
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = chordRoot * 2 * Math.pow(2, deg / 12);
    const g = env(o, t, 0.02, 0.6, 0.09);
    g.connect(musicBus);
    o.start(t); o.stop(t + 0.8);
  }
  // ドラム（ダンジョン／ボス）
  if ((track === 'dungeon' || track === 'boss') && (s === 0 || s === 4)) {
    noise(t, 0.09, 0.10, 180, 0.6, 0.4);
  }
}

const STEP_SEC = { town: 0.28, field: 0.26, dungeon: 0.24, boss: 0.17 };

function tick() {
  if (!started || !musicTrack) return;
  const ahead = 0.20;
  while (nextNoteTime < ac.currentTime + ahead) {
    scheduleStep(musicTrack, nextNoteTime);
    nextNoteTime += STEP_SEC[musicTrack];
    step++;
  }
}

export function playMusic(track) {
  if (!started) { musicTrack = track; return; }
  if (musicTrack === track && musicTimer) return;
  musicTrack = track;
  step = 0;
  mrng = makeRng(9871);
  nextNoteTime = ac.currentTime + 0.05;
  if (!musicTimer) musicTimer = setInterval(tick, 40);
  musicBus.gain.setTargetAtTime(track === 'boss' ? 0.34 : 0.28, ac.currentTime, 0.4);
}

export function stopMusic() {
  musicTrack = null;
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}

export function duckMusic(v = 0.08, back = 1.2) {
  if (!started || !musicBus) return;
  musicBus.gain.setTargetAtTime(v, ac.currentTime, 0.08);
  setTimeout(() => { if (musicBus) musicBus.gain.setTargetAtTime(0.28, ac.currentTime, 0.4); }, back * 1000);
}

export function setVolume(v) {
  audio.volume = clamp(v, 0, 1);
  if (master && !muted) master.gain.setTargetAtTime(audio.volume, ac.currentTime, 0.05);
}
