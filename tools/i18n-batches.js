/* 开发用：把扫描结果切成「静态词条」和「数字模板形状」两批，供翻译使用 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const scan = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '.i18n-scan.json'), 'utf8'));
const i18nSrc = fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8');
const appSrc = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* 词典里已有的 key：直接取 i18n.js 里 en 段的所有键 */
function dictKeys() {
  const start = i18nSrc.indexOf('en: {');
  const seg = i18nSrc.slice(start, i18nSrc.indexOf("'zh-TW'", start));
  const out = new Set();
  const re = /(?:'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)")\s*:/g;
  let m;
  while ((m = re.exec(seg))) out.add((m[1] !== undefined ? m[1] : m[2]).replace(/\\'/g, "'"));
  return out;
}

const covered = dictKeys();
const all = scan.all || [];

/* 数字/日期挖成 {} 占位符，用于生成模板 */
function shapeOf(s) {
  return s.replace(/\d{4}-\d{2}-\d{2}|\d{4}\/\d{1,2}\/\d{1,2}|\d[\d,]*(?:\.\d+)?/g, '{}');
}
function hasNum(s) { return /\d/.test(s); }

const statics = [];
const shapes = [];
const skipped = [];
const seenShape = new Map();

all.forEach((s) => {
  const key = s.trim();
  if (!key) return;
  if (covered.has(key)) { skipped.push({ s: key, why: 'in-dict' }); return; }
  /* 源码里找不到整串的，多半是示例数据或动态拼出来的句子 */
  const inSource = appSrc.indexOf(key) >= 0 || htmlSrc.indexOf(key) >= 0;
  if (hasNum(key)) {
    const sh = shapeOf(key);
    /* 形状里必须还有中文，且不能只是日期 */
    if (!/[\u4e00-\u9fff]/.test(sh)) { skipped.push({ s: key, why: 'no-cjk-shape' }); return; }
    seenShape.set(sh, (seenShape.get(sh) || 0) + 1);
    return;
  }
  if (!inSource) { skipped.push({ s: key, why: 'not-in-source' }); return; }
  statics.push(key);
});

statics.sort();
seenShape.forEach((n, sh) => shapes.push({ shape: sh, n: n, sample: '' }));
shapes.sort((a, b) => (b.n - a.n) || (a.shape < b.shape ? -1 : 1));

const outDir = process.argv[2] || path.join(ROOT, 'tools', 'i18n-batches');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'statics.json'), JSON.stringify(statics, null, 1), 'utf8');
fs.writeFileSync(path.join(outDir, 'shapes.json'), JSON.stringify(shapes, null, 1), 'utf8');
fs.writeFileSync(path.join(outDir, 'skipped.json'), JSON.stringify(skipped, null, 1), 'utf8');

/* 切成若干份，方便分头翻译 */
const PARTS = 3;
const per = Math.ceil(statics.length / PARTS);
for (let i = 0; i < PARTS; i++) {
  const slice = statics.slice(i * per, (i + 1) * per);
  fs.writeFileSync(path.join(outDir, 'statics-' + (i + 1) + '.json'), JSON.stringify(slice, null, 1), 'utf8');
}
console.log('扫描总数: ' + all.length);
console.log('  静态词条: ' + statics.length + ' → statics.json（并切成 ' + PARTS + ' 份，每份约 ' + per + ' 条）');
console.log('  数字模板: ' + shapes.length + ' → shapes.json');
console.log('  跳过: ' + skipped.length + '（已在词典 ' + skipped.filter((x) => x.why === 'in-dict').length
  + ' / 非源码固定串 ' + skipped.filter((x) => x.why === 'not-in-source').length + '）');
