/* 开发用：把「农历 + 月名 + 日名」的拼接改成可翻译形式
   拼接成一条文本时，词典永远匹配不上（数字模板也救不了中文数字），
   所以这里统一改成用一个中间分隔符拆成独立片段，由 i18n 的分段翻译逐段处理：
     '农历八月十四' → '农历' + ' ' + '八月' + ' ' + '十四'
   同时给调休的「班」字加 data-i18n-group 标记（单字不进词典）。
*/
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const file = path.join(ROOT, 'js', 'view-diary.js');
let s = fs.readFileSync(file, 'utf8');
let n = 0;

/* 1) 三处 '农历' + monthName + dayName 的拼接：改成 '农历 · 八月 · 十四'
      （'·' 是 i18n 的分段分隔符，逐段翻译后原样拼回） */
const oldJoin = "'农历' + inf.lunarInfo.monthName + inf.lunarInfo.dayName";
const newJoin = "'农历 · ' + inf.lunarInfo.monthName + ' · ' + inf.lunarInfo.dayName";
const c = s.split(oldJoin).length - 1;
if (c >= 1) { s = s.split(oldJoin).join(newJoin); n += c; }
else console.log('  [skip] 没找到农历拼接');

fs.writeFileSync(file, s, 'utf8');
console.log('view-diary.js 农历拼接替换 ' + n + ' 处');

/* 2) 「农历」当词条时去掉尾空格（分段用） */
const frag = path.join(ROOT, 'tools', 'i18n-frag-5.json');
const d = JSON.parse(fs.readFileSync(frag, 'utf8'));
d.en['农历'] = 'Lunar';
d.tw['农历'] = '農曆';
fs.writeFileSync(frag, JSON.stringify(d, null, 1), 'utf8');
console.log('「农历」词条已调整');

/* 3) i18n 分组表：调休小字「班」 */
const i18nFile = path.join(ROOT, 'js', 'i18n.js');
let s2 = fs.readFileSync(i18nFile, 'utf8');
if (s2.indexOf('swap:') < 0) {
  const anchor = `    /* 写作页里单独一个「字」当单位用 */`;
  if (s2.indexOf(anchor) < 0) { console.log('[x] 找不到 GROUPS 锚点'); process.exit(1); }
  s2 = s2.replace(anchor, [
    '    /* 日历里「调休上班」的小字标记：单字，不能进词典 */',
    "    swap: {",
    "      en: ['W'],",
    "      'zh-TW': ['班']",
    '    },',
    anchor
  ].join('\n'));
  fs.writeFileSync(i18nFile, s2, 'utf8');
  console.log('GROUPS.swap 已加');
} else console.log('GROUPS.swap 已存在');
