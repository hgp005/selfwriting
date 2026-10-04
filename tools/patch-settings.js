/* 开发用：给 store.js 的默认设置补上时区、阅读器视图等新字段 */
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'js', 'store.js');
let s = fs.readFileSync(file, 'utf8');

const oldS = [
  '    sessionIdleSeconds: 45,    // 停顿多久算一次「写作段」结束',
  '    showAchievementToast: true,',
  "    lastTab: 'novel'"
].join('\n');

const newS = [
  '    sessionIdleSeconds: 45,    // 停顿多久算一次「写作段」结束',
  '    showAchievementToast: true,',
  '    /* 时区：默认北京时间（UTC+8），日历的「今天」、时钟、日记日期上限都按它算 */',
  '    timeZone: 480,',
  '    /* 阅读器：书本视图（单列 / 双列）、封面宽度、翻页方式、点击正文收起工具栏 */',
  '    readerCols: 1,             // 1 | 2 列',
  '    readerCoverWidth: 108,     // 书架封面宽度（像素）',
  '    readerPageMode: \'scroll\',  // scroll | page | slide',
  '    readerTapMenu: true,       // 点正文收起 / 显示工具栏',
  "    lastTab: 'novel'"
].join('\n');

const n = s.split(oldS).length - 1;
if (n !== 1) { console.log('匹配异常: ' + n); process.exit(1); }
s = s.replace(oldS, newS);
fs.writeFileSync(file, s, 'utf8');
console.log('settings 已扩展, FFFD=' + s.includes('\uFFFD'));
