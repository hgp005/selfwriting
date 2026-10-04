/* 开发用：把新的 css / lunar.js 挂进 index.html 与 Service Worker 缓存清单 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let h = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const linkAnchor = '<link rel="stylesheet" href="css/style.css">';
if (!/music2\.css/.test(h)) {
  h = h.replace(linkAnchor, [
    linkAnchor,
    '<link rel="stylesheet" href="css/music2.css">',
    '<link rel="stylesheet" href="css/diary-calendar.css">',
    '<link rel="stylesheet" href="css/reader2.css">'
  ].join('\n'));
}
const jsAnchor = '<script src="js/view-diary.js"></script>';
if (!/js\/lunar\.js/.test(h)) {
  h = h.replace(jsAnchor, '<script src="js/lunar.js"></script>\n' + jsAnchor);
}
fs.writeFileSync(path.join(ROOT, 'index.html'), h, 'utf8');
console.log('index.html: css=' + /music2\.css/.test(h) + ' lunar=' + /lunar\.js/.test(h));

let s = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
if (!/diary-calendar\.css/.test(s)) {
  s = s.replace("  './css/style.css',", [
    "  './css/style.css',",
    "  './css/music2.css',",
    "  './css/diary-calendar.css',",
    "  './css/reader2.css',"
  ].join('\n'));
}
if (!/js\/lunar\.js/.test(s)) {
  s = s.replace("  './js/view-diary.js',", "  './js/lunar.js',\n  './js/view-diary.js',");
}
/* 缓存名换一版，确保新资源被重新拉取 */
s = s.replace(/var CACHE = 'selfwriting-v[\d.]+';/, "var CACHE = 'selfwriting-v1.11.0';");
fs.writeFileSync(path.join(ROOT, 'sw.js'), s, 'utf8');
console.log('sw.js: css=' + /diary-calendar\.css/.test(s) + ' lunar=' + /js\/lunar\.js/.test(s));
