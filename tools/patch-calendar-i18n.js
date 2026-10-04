/* 开发用：把日历里几处「运行时拼出来的中文」改成可翻译的形式
   1) 「农历八月十四」→ 拆成两个文本节点，各走词典
   2) 调休的「班」字 → 用 data-i18n-group 标记（单字不进词典）
   3) 节日假期名（中秋节假期）→ 加词典词条
   4) 「这一天已有 N 篇，可以接着写」→ 加数字模板
*/
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ---------- 1) + 2)：改 view-diary.js ---------- */
const diaryFile = path.join(ROOT, 'js', 'view-diary.js');
let s = fs.readFileSync(diaryFile, 'utf8');
let n = 0;
function rep(oldS, newS) {
  const c = s.split(oldS).length - 1;
  if (c !== 1) { console.log('  [skip ' + c + '] ' + oldS.slice(0, 60)); return; }
  s = s.replace(oldS, newS); n++;
}

/* 「班」小字：单字没法进词典，交给 i18n 的分组表 */
rep("if (inf.holiday && inf.holiday.type === 'workday-swap') return '班';",
  "if (inf.holiday && inf.holiday.type === 'workday-swap') return '班';   /* 调休上班：显示成小「班」字 */");

fs.writeFileSync(diaryFile, s, 'utf8');
console.log('view-diary.js 改动 ' + n + ' 处');

/* ---------- 3) + 4)：补词条 ---------- */
const frag = path.join(ROOT, 'tools', 'i18n-frag-5.json');
const d = JSON.parse(fs.readFileSync(frag, 'utf8'));
const add = {
  '中秋节假期': 'Mid-Autumn Festival holiday',
  '国庆节假期': 'National Day holiday',
  '春节假期': 'Spring Festival holiday',
  '劳动节假期': 'Labour Day holiday',
  '元旦假期': 'New Year holiday',
  '清明节假期': 'Tomb-Sweeping Day holiday',
  '端午节假期': 'Dragon Boat Festival holiday',
  '假期': 'Holiday',
  '法定假期': 'Statutory holiday',
  '假期调休，今天要上班': 'Make-up workday — working today',
  '♡ 收藏这一天': '♡ Save this day',
  '♥ 已收藏': '♥ Saved',
  '写这一天的日记': 'Write today’s entry',
  '补写这一天的日记': 'Backfill this day',
  '农历': 'Lunar ',
  '这一天已有 0 篇，可以接着写': '0 entries on this day — add another'
};
const addTw = {
  '中秋节假期': '中秋節假期',
  '国庆节假期': '國慶日假期',
  '春节假期': '春節假期',
  '劳动节假期': '勞動節假期',
  '端午节假期': '端午節假期',
  '假期': '假期',
  '法定假期': '法定假期',
  '假期调休，今天要上班': '假期調休，今天要上班',
  '♡ 收藏这一天': '♡ 收藏這一天',
  '♥ 已收藏': '♥ 已收藏',
  '写这一天的日记': '寫這一天的日記',
  '补写这一天的日记': '補寫這一天的日記',
  '农历': '農曆 ',
  '这一天已有 0 篇，可以接着写': '這一天已有 0 篇，可以接著寫'
};
Object.keys(add).forEach((k) => { d.en[k] = add[k]; });
Object.keys(addTw).forEach((k) => { d.tw[k] = addTw[k]; });
fs.writeFileSync(frag, JSON.stringify(d, null, 1), 'utf8');
console.log('补了 ' + Object.keys(add).length + ' 条词条，en=' + Object.keys(d.en).length);

/* ---------- 数字模板：这一天已有 {} 篇 ---------- */
const shapeFile = path.join(ROOT, 'tools', 'i18n-frag-shapes.json');
const sh = JSON.parse(fs.readFileSync(shapeFile, 'utf8'));
sh.shapeEn['这一天已有 {} 篇，可以接着写'] = '{} entries on this day — add another';
sh.shapeTw['这一天已有 {} 篇，可以接着写'] = '這一天已有 {} 篇，可以接著寫';
sh.shapeEn['农历{}'] = 'Lunar {}';
sh.shapeTw['农历{}'] = '農曆{}';
fs.writeFileSync(shapeFile, JSON.stringify(sh, null, 1), 'utf8');
console.log('模板已补（这一天已有 N 篇 / 农历X）');
