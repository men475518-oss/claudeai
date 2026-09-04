#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build.mjs — src/*.js を 1 枚の HTML にまとめる（依存パッケージなし）
//
//   node tools/build.mjs                     → dist/aftergrove.html（単体で開ける）
//   node tools/build.mjs --artifact out.html → <body> の中身だけ（埋め込み用）
//
// 各モジュールを IIFE で包み、import は名前空間オブジェクトからの分割代入に
// 置きかえる。モジュールごとのスコープが保たれるので、私的な変数名が
// ぶつかる心配がない。
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 依存の順番（先に読まれたものだけを参照できる）
const ORDER = [
  'config', 'util', 'story', 'artdata', 'art', 'audio', 'fx',
  'world', 'arena', 'dungeon', 'bubble', 'entities', 'hazard',
  'render', 'input', 'boss', 'ui', 'save', 'main',
];

const RE_IMPORT_NS = /^import\s+\*\s+as\s+([\w$]+)\s+from\s+'\.\/([\w.-]+)\.js';?\s*$/;
const RE_IMPORT_NAMED = /^import\s*\{([^}]*)\}\s*from\s+'\.\/([\w.-]+)\.js';?\s*$/;
const RE_EXPORT_FN = /^export\s+(?:async\s+)?function\s+([\w$]+)/;
const RE_EXPORT_CLASS = /^export\s+class\s+([\w$]+)/;
const RE_EXPORT_VAR = /^export\s+(?:const|let|var)\s+([\w$]+)/;
const RE_EXPORT_LIST = /^export\s*\{([^}]*)\}\s*;?\s*$/;

const emitted = new Set();

function transform(name) {
  const src = readFileSync(resolve(root, 'src', `${name}.js`), 'utf8');
  const out = [];
  const head = [];
  const exports = [];      // 'localName' もしくは 'exported: local'

  for (const line of src.split('\n')) {
    let m;
    if ((m = line.match(RE_IMPORT_NS))) {
      requireEmitted(name, m[2]);
      head.push(`const ${m[1]} = __M_${m[2]};`);
      continue;
    }
    if ((m = line.match(RE_IMPORT_NAMED))) {
      requireEmitted(name, m[2]);
      const parts = m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => {
        const as = s.split(/\s+as\s+/);
        return as.length === 2 ? `${as[0].trim()}: ${as[1].trim()}` : s;
      });
      head.push(`const { ${parts.join(', ')} } = __M_${m[2]};`);
      continue;
    }
    if ((m = line.match(RE_EXPORT_LIST))) {
      for (const raw of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
        const as = raw.split(/\s+as\s+/);
        exports.push(as.length === 2 ? `${as[1].trim()}: ${as[0].trim()}` : raw);
      }
      continue;
    }
    if ((m = line.match(RE_EXPORT_FN) || line.match(RE_EXPORT_CLASS) || line.match(RE_EXPORT_VAR))) {
      exports.push(m[1]);
      out.push(line.replace(/^export\s+/, ''));
      continue;
    }
    if (/^export\s/.test(line)) throw new Error(`${name}.js: 未対応の export 文です → ${line}`);
    if (/^import\s/.test(line)) throw new Error(`${name}.js: 未対応の import 文です → ${line}`);
    out.push(line);
  }

  return [
    `const __M_${name} = (function () {`,
    ...head,
    ...out,
    `return { ${exports.join(', ')} };`,
    `})();`,
  ].join('\n');
}

/** 依存の順番まちがいを 静かに壊れる前に 見つける */
function requireEmitted(from, dep) {
  if (!ORDER.includes(dep)) throw new Error(`${from}.js が ORDER にない ${dep}.js を読んでいます`);
  if (!emitted.has(dep)) throw new Error(`${from}.js は ${dep}.js より先に置かれています（ORDER を直してください）`);
}

function bundle() {
  const parts = ORDER.map(n => { const out = transform(n); emitted.add(n); return out; });
  return [
    '/* AFTERGROVE — 単一ファイル版（tools/build.mjs が生成） */',
    '(function () {',
    "'use strict';",
    ...parts,
    'void __M_main;',
    '})();',
  ].join('\n\n');
}

// --- HTML の組み立て -------------------------------------------------------

const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = html.match(/<body>([\s\S]*?)<script/);
if (!styleMatch || !bodyMatch) throw new Error('index.html の形が想定と違います');

const style = styleMatch[1];
const body = bodyMatch[1].trim();
const code = bundle();

const artifactIdx = process.argv.indexOf('--artifact');
const TITLE = 'AFTERGROVE';

const inner = `<title>${TITLE}</title>
<style>${style}</style>
${body}
<script>
${code}
</script>`;

if (artifactIdx >= 0) {
  const dest = process.argv[artifactIdx + 1];
  if (!dest) throw new Error('--artifact のあとに出力先が必要です');
  mkdirSync(dirname(resolve(dest)), { recursive: true });
  writeFileSync(resolve(dest), inner + '\n');
  console.log(`書き出しました: ${dest}  (${(inner.length / 1024).toFixed(1)} KB)`);
} else {
  const full = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${TITLE} — 片手で遊ぶ小さな冒険</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#12101c">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>${style}</style>
</head>
<body>
${body}
<script>
${code}
</script>
</body>
</html>
`;
  const dest = resolve(root, 'dist', 'aftergrove.html');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, full);
  console.log(`書き出しました: dist/aftergrove.html  (${(full.length / 1024).toFixed(1)} KB)`);
}
