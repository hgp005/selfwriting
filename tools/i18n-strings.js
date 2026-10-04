/* ==========================================================================
   开发用：从源码里挑出「可能在界面上出现、但词典里还没有」的中文文案
   --------------------------------------------------------------------------
   扫描工具（tools/i18n-scan.js）是**跑界面**收集文案的，覆盖不到的空状态、
   极少出现的提示语会漏掉。这里从源码里按「会变成界面文字的写法」捞一遍：
     text: '…'  /  text: "…"  /  '.f' 动态文案  /  placeholder: '…'
     UI.empty(…, '标题', '说明', …) / UI.alert('…', '…') / UI.confirm('…', '…', …)
     UI.sheet({ title: '…' }) / U.el('label', { text: '…' })
   用法： node tools/i18n-strings.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PH = '\u0000';

/* ---- 已有词条 ---- */
const i18nSrc = fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8');
function seg(name) {
  const i = i18nSrc.indexOf(name);
  if (i < 0) return '';
  const rest = i18nSrc.slice(i);
  const e = rest.indexOf('\n    }');
  return e < 0 ? rest : rest.slice(0, e);
}
function keys(s) {
  const out = new Set();
  const re = /(?:'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)")\s*:/g;
  let m;
  while ((m = re.exec(s))) out.add((m[1] !== undefined ? m[1] : m[2]).replace(/\\'/g, "'").replace(/\\u0000/g, PH));
  return out;
}
const have = new Set();
keys(seg('en: {')).forEach((k) => have.add(k));
const win = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'i18n-extra.js'), 'utf8'))(win);
const extra = (win.I18N_EXTRA || {});
Object.keys(extra.en || {}).forEach((k) => have.add(k));
Object.keys((extra.templates || {}).en || {}).forEach((k) => have.add(k));

/* ---- 从源码里捞候选 ---- */
const FILES = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'))
  .filter((f) => f !== 'i18n.js' && f !== 'i18n-extra.js');   /* 词典文件本身不算文案 */
const PATTERNS = [
  /text:\s*'((?:\\.|[^'])*)'/g,
  /text:\s*"((?:\\.|[^"])*)"/g,
  /placeholder:\s*'((?:\\.|[^'])*)'/g,
  /UI\.empty\([^,]+,\s*'((?:\\.|[^'])*)'/g,
  /UI\.empty\([^,]+,\s*'((?:\\.|[^'])*)',\s*'((?:\\.|[^'])*)'/g,
  /UI\.alert\(\s*'((?:\\.|[^'])*)'/g,
  /UI\.confirm\(\s*'((?:\\.|[^'])*)'/g,
  /title:\s*'((?:\\.|[^'])*)'/g,
  /label:\s*'((?:\\.|[^'])*)'/g,
  /'((?:[\u4e00-\u9fff][^']*))'\s*\]/g
];
const cand = new Map();
FILES.forEach((f) => {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  PATTERNS.forEach((re) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      for (let gi = 1; gi < m.length; gi++) {
        const raw = m[gi];
        if (!raw) continue;
        const s = raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
        if (!s || s.length > 60) continue;
        if (!/[\u4e00-\u9fff]/.test(s)) continue;
        if (/^https?:|\.js$|\.css$|^#?\/|^[a-z-]+$/.test(s)) continue;
        if (/[\u0000-\u001f]/.test(s)) continue;
        if (cand.has(s)) continue;
        cand.set(s, f);
      }
    }
  });
});

const pending = [];
cand.forEach((file, s) => {
  if (have.has(s)) return;
  /* 带数字的当作模板候选（数字位置换成 {}） */
  pending.push({ s: s, file: file, shape: s.replace(/\d{4}-\d{2}-\d{2}|\d[\d,]*(?:\.\d+)?/g, '{}') });
});
pending.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.s < b.s ? -1 : 1)));

const outDir = path.join(ROOT, 'tools', 'i18n-batches');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'pending.json'), JSON.stringify(pending.map((x) => x.s), null, 1), 'utf8');
fs.writeFileSync(path.join(outDir, 'pending-annotated.json'), JSON.stringify(pending, null, 1), 'utf8');
console.log('源码候选: ' + cand.size + ' 条，其中词典里还没有的: ' + pending.length + ' 条');
const byFile = {};
pending.forEach((p) => { byFile[p.file] = (byFile[p.file] || 0) + 1; });
Object.keys(byFile).sort().forEach((f) => console.log('  ' + f + ': ' + byFile[f]));
