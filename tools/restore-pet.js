/* 开发用：桌宠任务取消后，把三个桌宠文件从已发布的 1.14.0 APK 里恢复回来
   （被中断的子代理把 js/pet.js、js/view-pet.js、css/pet.css 删掉了，
    而 index.html / sw.js 还在引用它们 —— 不恢复的话应用会 404 报错）。
   注意：只从 APK 取，不从 build/（构建暂存目录永远是旧副本）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const apk = path.join(ROOT, 'dist', 'selfwriting-1.14.0.apk');
const buf = fs.readFileSync(apk);

function entry(name) {
  let i = 0;
  while ((i = buf.indexOf(Buffer.from('PK\u0003\u0004', 'binary'), i)) >= 0) {
    const method = buf.readUInt16LE(i + 8);
    const csize = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const elen = buf.readUInt16LE(i + 28);
    const nm = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const start = i + 30 + nlen + elen;
    if (nm === name) {
      const d = buf.slice(start, start + csize);
      return method === 8 ? zlib.inflateRawSync(d) : d;
    }
    i = start + csize;
  }
  return null;
}

const MAP = [
  ['assets/www/js/pet.js', 'js/pet.js'],
  ['assets/www/js/view-pet.js', 'js/view-pet.js'],
  ['assets/www/css/pet.css', 'css/pet.css']
];
let restored = 0;
MAP.forEach(([inApk, target]) => {
  const p = path.join(ROOT, target);
  if (fs.existsSync(p)) { console.log('已存在，跳过: ' + target); return; }
  const data = entry(inApk);
  if (!data) { console.log('[x] 包里没有: ' + inApk); return; }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  console.log('已恢复 ' + target + ' (' + data.length + ' 字节)');
  restored++;
});
console.log('共恢复 ' + restored + ' 个文件');

/* index.html / sw.js 里的引用是否还在 */
['index.html', 'sw.js'].forEach((f) => {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  ['pet.js', 'view-pet.js', 'pet.css'].forEach((k) => {
    if (t.indexOf(k) >= 0) console.log('  ' + f + ' 仍引用 ' + k);
  });
});
