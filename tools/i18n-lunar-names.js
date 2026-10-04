/* 开发用：生成农历日名 / 月名的词条（农历表是按前缀拼出来的，通用提取抓不到）
   用法： node tools/i18n-lunar-names.js   →  tools/i18n-frag-12.json
*/
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const NUM_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th',
  '11th', '12th', '13th', '14th', '15th', '16th', '17th', '18th', '19th', '20th',
  '21st', '22nd', '23rd', '24th', '25th', '26th', '27th', '28th', '29th', '30th'];

/* 农历日名：初一…初十、十一…十九、二十、廿一…廿九、三十 */
const days = [];
days.push(['初一', ORD[1]]);
for (let i = 2; i <= 10; i++) days.push(['初' + NUM_CN[i], ORD[i]]);
for (let i = 11; i <= 19; i++) days.push(['十' + NUM_CN[i - 10], ORD[i]]);
days.push(['二十', ORD[20]]);
for (let i = 21; i <= 29; i++) days.push(['廿' + NUM_CN[i - 20], ORD[i]]);
days.push(['三十', ORD[30]]);

/* 农历月名 */
const MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const months = MONTHS.map((m, i) => [m + '月', 'M' + (i + 1)]);

const en = {};
const tw = {};
days.concat(months).forEach(([zh, e]) => {
  en[zh] = e;
  /* 繁体：只有「腊月」→「臘月」这类字形差异 */
  const t = zh.split('腊').join('臘').split('廿').join('廿');
  if (t !== zh) tw[zh] = t;
});
/* 闰月前缀（渲染成「闰四月」） */
en['闰'] = 'Leap ';

const out = { en: en, tw: tw };
const file = path.join(ROOT, 'tools', 'i18n-frag-12.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1), 'utf8');
console.log('生成 ' + Object.keys(en).length + ' 条（日名 ' + days.length + ' + 月名 ' + months.length + ' + 闰）→ ' + path.relative(ROOT, file));
console.log('样例: ' + days.slice(0, 3).map((d) => d.join('=')).join(' / ') + ' … ' + days.slice(-2).map((d) => d.join('=')).join(' / '));
