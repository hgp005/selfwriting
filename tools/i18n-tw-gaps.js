/* 开发用：找出「英文有、繁体没有」的词条，生成待翻译清单
   用法： node tools/i18n-tw-gaps.js
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8');

/* 主词典：分别取 en 段与 zh-TW 段的键 */
function segment(name) {
  const start = src.indexOf(name);
  if (start < 0) return '';
  /* 段落到下一个顶层键为止：找下一个 "\n    }" 之前 */
  const rest = src.slice(start);
  const end = rest.indexOf('\n    }');
  return end < 0 ? rest : rest.slice(0, end);
}
const enSeg = segment('en: {');
const twSeg = segment("'zh-TW': {");

function keys(seg) {
  const out = [];
  const re = /(?:'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)")\s*:/g;
  let m;
  while ((m = re.exec(seg))) out.push((m[1] !== undefined ? m[1] : m[2]).replace(/\\'/g, "'"));
  return out;
}
const mainEn = keys(enSeg);
const mainTw = new Set(keys(twSeg));

const win = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'i18n-extra.js'), 'utf8'))(win);
const extra = win.I18N_EXTRA || {};
const extraEn = extra.en || {};
const extraTw = extra['zh-TW'] || {};
const tplEn = (extra.templates && extra.templates.en) || {};
const tplTw = (extra.templates && extra.templates['zh-TW']) || {};
const PH = '\u0000';

const statics = [];
mainEn.forEach((k) => {
  if (extraTw[k] !== undefined) return;          /* 扩展词典里已有繁体 */
  if (mainTw.has(k)) return;                     /* 主词典繁体段已有 */
  if (k.length < 2) return;
  statics.push(k);
});
Object.keys(extraEn).forEach((k) => {
  if (extraTw[k] !== undefined) return;
  if (k.length < 2) return;
  statics.push(k);
});

const templates = [];
Object.keys(tplEn).forEach((k) => {
  if (tplTw[k] !== undefined) return;
  templates.push(k.split(PH).join('{}'));
});

const uniq = (arr) => Array.from(new Set(arr));
const outDir = path.join(ROOT, 'tools', 'i18n-batches');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'tw-gaps.json'), JSON.stringify({
  statics: uniq(statics).sort(),
  templates: uniq(templates).sort()
}, null, 1), 'utf8');

console.log('繁体缺口: 静态 ' + uniq(statics).length + ' 条，模板 ' + uniq(templates).length + ' 条');
console.log('  → ' + path.relative(ROOT, path.join(outDir, 'tw-gaps.json')));
