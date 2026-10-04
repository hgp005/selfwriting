/* 开发用：把吉他 / 贝斯的余音缩短
   用户反馈「点击之后会持续响很长时间」：原来吉他的 t60 到 2.5s、寿命上限 3.4s，
   贝斯更长（4.3s / 5.8s），听感上像按下去不放。
   这里把衰减时间与寿命上限一起收紧，并让阻尼更强（高音掉得更快）。
*/
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'js', 'view-music.js');
let s = fs.readFileSync(file, 'utf8');

const edits = [
  /* 1) 寿命上限：吉他 1.9s / 贝斯 2.6s（原来 3.4 / 5.8） */
  ["  const VOICE_CAP = { piano: 7.2, epiano: 5.6, guitar: 3.4, bass: 5.8, drums: 3.2 };",
    "  const VOICE_CAP = { piano: 7.2, epiano: 5.6, guitar: 1.9, bass: 2.6, drums: 3.2 };"],

  /* 2) 衰减时间：吉他 base 1.15（1.4→其实原来 base 2.7），贝斯 base 1.9 */
  ["    guitarT60: { base: 2.7, slope: 0.0038, min: 1.35, max: 2.9 },   // -60dB 时间（秒）",
    "    guitarT60: { base: 1.15, slope: 0.0030, min: 0.60, max: 1.30 },  // -60dB 时间（秒）：拨一下就该收住"],
  ["    bassT60: { base: 4.6, slope: 0.012, min: 2.6, max: 4.8 },",
    "    bassT60: { base: 1.95, slope: 0.010, min: 1.10, max: 2.10 },"],

  /* 3) 阻尼更强：高音衰减更快、低音也更利落 */
  ["    guitarDamp: { mul: 15, min: 1600, max: 8000, q: 0.5 },",
    "    guitarDamp: { mul: 26, min: 1500, max: 7000, q: 0.6 },"],
  ["    bassDamp: { mul: 12, add: 500, min: 900, max: 2600, q: 0.5 },",
    "    bassDamp: { mul: 20, add: 700, min: 1000, max: 2600, q: 0.6 },"],

  /* 4) 释放包络更快收尾（如果存在这些常量） */
  ["  const RELEASE = { piano: 0.55, epiano: 0.5, guitar: 0.28, bass: 0.32, drums: 0.2 };",
    "  const RELEASE = { piano: 0.55, epiano: 0.5, guitar: 0.16, bass: 0.20, drums: 0.2 };"]
];

let n = 0;
edits.forEach(([a, b]) => {
  const c = s.split(a).length - 1;
  if (c === 1) { s = s.replace(a, b); n++; }
  else console.log('  [skip ' + c + '] ' + a.slice(0, 60).trim());
});
fs.writeFileSync(file, s, 'utf8');
console.log('music 余音参数改动 ' + n + '/' + edits.length + ' 处, FFFD=' + s.includes('\uFFFD'));
