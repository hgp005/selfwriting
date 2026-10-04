/* 开发用：给日历里调休的「班」字标上 i18n 分组（单字不能进词典） */
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'js', 'view-diary.js');
let s = fs.readFileSync(file, 'utf8');
const oldS = '    const label = labelOf(inf);';
const newS = [
  '    const label = labelOf(inf);',
  '    /* 调休的「班」是单字，进不了词典：标上分组让多语种模块按语言取表 */',
  "    if (label === '班') lun.dataset.i18nGroup = 'swap:0';",
  '    else delete lun.dataset.i18nGroup;'
].join('\n');
const c = s.split(oldS).length - 1;
if (c !== 1) { console.log('匹配异常: ' + c); process.exit(1); }
s = s.replace(oldS, newS);
fs.writeFileSync(file, s, 'utf8');
console.log('已给「班」标记分组, FFFD=' + s.includes('\uFFFD'));
