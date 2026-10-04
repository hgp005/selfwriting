/* 还原被「UTF-8 文本按 GBK 误读」损坏的源码文件。
   损坏路径：原 UTF-8 字节 → 被当成 GBK 解码成乱码字符 → 再按 UTF-8 写出。
   反向即：当前文本 → 每个字符按 GBK 编码回字节 → 得到原始 UTF-8 字节流。 */
'use strict';
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('用法: node tools/fix-mojibake.js <文件>'); process.exit(2); }

const text = fs.readFileSync(file, 'utf8');
console.log('当前文件字符数=' + text.length);

/* 构造 GBK 双字节 → 字符 的反查表 */
const gbkTable = (() => {
  const map = new Map();
  const dec = new TextDecoder('gbk');
  for (let hi = 0x81; hi <= 0xfe; hi++) {
    for (let lo = 0x40; lo <= 0xfe; lo++) {
      if (lo === 0x7f) continue;
      const ch = dec.decode(new Uint8Array([hi, lo]));
      if (ch && ch.length === 1 && ch !== '\uFFFD' && !map.has(ch)) map.set(ch, [hi, lo]);
    }
  }
  return map;
})();
console.log('GBK 反查表条目数=' + gbkTable.size);

const out = [];
let unmapped = 0;
const missing = [];
for (let i = 0; i < text.length; i++) {
  const code = text.charCodeAt(i);
  if (code < 0x80) { out.push(code); continue; }
  const pair = gbkTable.get(text[i]);
  if (!pair) { unmapped++; if (missing.length < 12) missing.push(text[i] + '(U+' + code.toString(16) + ')'); out.push(0x3f); continue; }
  out.push(pair[0], pair[1]);
}
console.log('无法还原的字符数=' + unmapped + (missing.length ? ' 例如: ' + missing.join(' ') : ''));

const restored = Buffer.from(out).toString('utf8');
const bad = (restored.match(/\uFFFD/g) || []).length;
console.log('还原后替换符数量=' + bad);
if (bad > 0 || unmapped > 0) {
  console.error('还原不完美，已放弃写入（原文件未改动）');
  process.exit(1);
}
fs.writeFileSync(file, restored);
console.log('已还原: ' + file + ' (' + Buffer.byteLength(restored, 'utf8') + ' 字节)');
