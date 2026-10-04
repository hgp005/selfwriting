/* 开发用：把 lunar.js 里的农历月份/节气/节日名称也捞进待翻译清单
   （这些是数据数组里的字符串，通用的 text: 提取抓不到） */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const win = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'i18n-extra.js'), 'utf8'))(win);
const have = new Set(Object.keys((win.I18N_EXTRA || {}).en || {}));

const src = fs.readFileSync(path.join(ROOT, 'js', 'lunar.js'), 'utf8');
const found = new Set();
const re = /'([^'\\\n]{1,20})'|"([^"\\\n]{1,20})"/g;
let m;
while ((m = re.exec(src))) {
  const s = (m[1] !== undefined ? m[1] : m[2]).trim();
  if (!s || s.length < 2) continue;
  if (!/[\u4e00-\u9fff]/.test(s)) continue;
  if (have.has(s)) continue;
  found.add(s);
}

const pendingFile = path.join(ROOT, 'tools', 'i18n-batches', 'pending.json');
const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
const merged = pending.slice();
found.forEach((s) => { if (merged.indexOf(s) < 0) merged.push(s); });
merged.sort();
fs.writeFileSync(pendingFile, JSON.stringify(merged, null, 1), 'utf8');
const half = Math.ceil(merged.length / 2);
fs.writeFileSync(path.join(ROOT, 'tools', 'i18n-batches', 'pending-5.json'), JSON.stringify(merged.slice(0, half), null, 1), 'utf8');
fs.writeFileSync(path.join(ROOT, 'tools', 'i18n-batches', 'pending-6.json'), JSON.stringify(merged.slice(half), null, 1), 'utf8');
console.log('lunar.js 额外捞出 ' + found.size + ' 条，合计 ' + merged.length + ' 条（pending-5: ' + Math.min(half, merged.length) + ' / pending-6: ' + (merged.length - half) + '）');
console.log('样例: ' + Array.from(found).slice(0, 24).join(' / '));
