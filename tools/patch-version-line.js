/* 开发用：把「版本号 + 说明」这一行拆成两个文本节点，并把后半句加进词典
   （原来整句含版本号，每次发版词条都会失效） */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const statsFile = path.join(ROOT, 'js', 'view-stats.js');
let s = fs.readFileSync(statsFile, 'utf8');
const oldS = "U.el('div', { text: 'selfwriting 1.11.0 · 创作与数据全部在本机；只有「网址下载」会联网' }),";
const newS = "U.el('div', {}, [U.el('span', { text: 'selfwriting 1.11.0' }), U.el('span', { text: ' · 创作与数据全部在本机；只有「网址下载」会联网' })]),";
const c = s.split(oldS).length - 1;
if (c !== 1) { console.log('view-stats 匹配异常: ' + c); process.exit(1); }
s = s.replace(oldS, newS);
fs.writeFileSync(statsFile, s, 'utf8');
console.log('版本行已拆成两段');

const frag = path.join(ROOT, 'tools', 'i18n-frag-5.json');
const d = JSON.parse(fs.readFileSync(frag, 'utf8'));
d.en[' · 创作与数据全部在本机；只有「网址下载」会联网'] = ' · All writing and data stay on this device; only “Download from URL” goes online';
d.tw[' · 创作与数据全部在本机；只有「网址下载」会联网'] = ' · 創作與資料全部在本機；只有「網址下載」會連網';
fs.writeFileSync(frag, JSON.stringify(d, null, 1), 'utf8');
console.log('已补词条，en=' + Object.keys(d.en).length + ' tw=' + Object.keys(d.tw).length);
