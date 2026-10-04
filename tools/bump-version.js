/* 开发用：把版本号从 1.8.0 升到 1.9.0（只改版本串，不动逻辑）
   用法： node tools/bump-version.js 1.9.0
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FROM = process.argv[2] || '1.8.0';
const TO = process.argv[3] || '1.9.0';

const FILES = [
  'package.json',
  'android/AndroidManifest.xml',
  'android/build.bat',
  'android-gradle/app/build.gradle',
  'js/view-library.js',
  'js/view-stats.js',
  'README.md',
  'index.html',
  'sw.js'
];

let changed = 0;
FILES.forEach((rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return;
  const before = fs.readFileSync(p, 'utf8');
  if (before.indexOf(FROM) < 0) return;
  const after = before.split(FROM).join(TO);
  if (after === before) return;
  if (after.indexOf('\uFFFD') >= 0) { console.log('[x] 乱码，跳过 ' + rel); return; }
  fs.writeFileSync(p, after, 'utf8');
  const n = before.split(FROM).length - 1;
  console.log('  ' + rel + ': ' + n + ' 处');
  changed += n;
});
console.log('共替换 ' + changed + ' 处 ' + FROM + ' → ' + TO);
