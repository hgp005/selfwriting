/* 开发用：把新的 css 挂进 index.html（自闭合写法 <link … />） */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const file = path.join(ROOT, 'index.html');
let h = fs.readFileSync(file, 'utf8');
const anchor = '<link rel="stylesheet" href="css/style.css" />';
if (!/music2\.css/.test(h)) {
  if (h.indexOf(anchor) < 0) { console.log('[x] 找不到样式表锚点'); process.exit(1); }
  h = h.replace(anchor, [
    anchor,
    '<link rel="stylesheet" href="css/music2.css" />',
    '<link rel="stylesheet" href="css/diary-calendar.css" />',
    '<link rel="stylesheet" href="css/reader2.css" />'
  ].join('\n'));
  fs.writeFileSync(file, h, 'utf8');
}
console.log('css links:', /music2\.css/.test(h), /diary-calendar\.css/.test(h), /reader2\.css/.test(h));
