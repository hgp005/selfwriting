/* 开发用：修掉「弹层正文为空」的老 bug。
   UI.modal 拿到 body 是函数时只调用、不挂载返回值，于是 confirm / alert 的正文
   在全应用范围内都是空的（删除确认、清空数据确认、长按桌宠的取消/保留…）。
   改成把返回值 append 进去（函数自己 append 的情况也兼容：返回 undefined 就不管）。
*/
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function patch(rel, pairs) {
  const file = path.join(ROOT, rel);
  let s = fs.readFileSync(file, 'utf8');
  let n = 0;
  pairs.forEach(([a, b]) => {
    const c = s.split(a).length - 1;
    if (c === 0) { console.log('  [skip 0] ' + rel + ': ' + a.slice(0, 50)); return; }
    s = s.split(a).join(b);
    n += c;
  });
  if (n) fs.writeFileSync(file, s, 'utf8');
  console.log(rel + ': ' + n + ' 处');
}

patch('js/ui.js', [
  ["if (typeof o.body === 'function') o.body(dom.modalBody);",
    "if (typeof o.body === 'function') { const node = o.body(dom.modalBody); if (node && node.nodeType) U.append(dom.modalBody, node); }"]
]);
patch('js/view-diary.js', [
  ["if (typeof o.body === 'function') o.body(dom.modalBody);",
    "if (typeof o.body === 'function') { const node = o.body(dom.modalBody); if (node && node.nodeType) U.append(dom.modalBody, node); }"]
]);
