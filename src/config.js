// ---------------------------------------------------------------------------
// config.js — ゲーム全体の定数
// ---------------------------------------------------------------------------

export const TILE = 16;

/** 論理解像度（縦持ち）。横は固定、縦は端末のアスペクト比から決める */
export const VIEW_W = 176;          // 11 タイル
export const VIEW_H_MIN = 240;
export const VIEW_H_MAX = 340;

export const SAVE_KEY = 'aftergrove.save.v1';

/** ワールドサイズ（タイル） */
export const WORLD_W = 220;
export const WORLD_H = 220;

/** 主人公のパラメータ */
export const PLAYER = {
  speed: 52,            // px/秒
  runMul: 1.0,
  hitW: 9,              // 当たり判定（横）
  hitH: 7,              // 当たり判定（縦・足元）
  invuln: 0.9,          // 被弾後の無敵時間
  attackTime: 0.28,     // 振りの長さ
  attackCooldown: 0.10,
  chargeTime: 0.75,     // 溜め完了までの時間
  spinTime: 0.55,
  knockback: 120,
};

export const DEPTH = { GROUND: 0, DECAL: 1, OBJECT: 2, ENTITY: 3, AIR: 4, FX: 5 };

/** ダメージ表示や UI の色 */
export const UI = {
  ink: '#f4ecd8',
  inkDim: '#a99f8c',
  gold: '#e8c46a',
  red: '#d65c4e',
  green: '#84ad5f',
  panel: 'rgba(20,16,26,0.90)',
  panelEdge: '#5c5168',
  shadow: 'rgba(0,0,0,0.55)',
};

export const FONT = `"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Noto Sans JP", Meiryo, system-ui, sans-serif`;
