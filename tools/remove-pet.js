/* 开发用：彻底移除桌宠功能（按用户要求）
   做法：文件先备份到 tools/removed-pet/（想恢复随时能拿回来），
   再从 index.html / sw.js / js/view-stats.js 里摘掉引用，最后残留自检。
*/
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BK = path.join(ROOT, 'tools', 'removed-pet');
fs.mkdirSync(BK, { recursive: true });

/* 1) 备份并删除桌宠文件 */
const FILES = ['js/pet.js', 'js/view-pet.js', 'css/pet.css', 'tools/test-pet.js'];
FILES.forEach((rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { console.log('  [无] ' + rel); return; }
  fs.copyFileSync(p, path.join(BK, path.basename(rel)));
  fs.unlinkSync(p);
  console.log('  已移除（备份在 tools/removed-pet/）: ' + rel);
});

/* 2) index.html：摘掉 <link> 与两个 <script> */
const idx = path.join(ROOT, 'index.html');
let h = fs.readFileSync(idx, 'utf8');
const before = h;
h = h.split('\n').filter((line) => !/pet\.css|js\/pet\.js|js\/view-pet\.js/.test(line)).join('\n');
if (h !== before) { fs.writeFileSync(idx, h, 'utf8'); console.log('  index.html 已清理桌宠引用'); }
else console.log('  index.html 没有桌宠引用（可能已清理）');

/* 3) sw.js：摘掉 ASSETS 里的桌宠条目 */
const swp = path.join(ROOT, 'sw.js');
let s = fs.readFileSync(swp, 'utf8');
const b2 = s;
s = s.split('\n').filter((line) => !/pet\.css|js\/pet\.js|js\/view-pet\.js/.test(line)).join('\n');
if (s !== b2) { fs.writeFileSync(swp, s, 'utf8'); console.log('  sw.js ASSETS 已清理'); }

/* 4) view-stats.js：摘掉「桌宠 · 小陪伴」设置区块 */
const vs = path.join(ROOT, 'js', 'view-stats.js');
let v = fs.readFileSync(vs, 'utf8');
const marks = ['桌宠 · 小陪伴', 'petSection', 'PetView', 'window.Pet'];
let removed = 0;
let lines = v.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (!/桌宠|PetView|window\.Pet|settings\.pet/.test(lines[i])) continue;
  /* 找到这个块的范围：从最近的空行/注释起点到配对括号结束（保守：逐行删到下一个空行 + 收尾括号） */
  let start = i;
  while (start > 0 && !/^\s*$/.test(lines[start - 1]) && !/^\s*\/\*/.test(lines[start - 1])) start--;
  let depth = 0, end = i;
  for (let j = i; j < lines.length; j++) {
    depth += (lines[j].match(/[{([]/g) || []).length - (lines[j].match(/[})\]]/g) || []).length;
    if (j > i && depth <= 0) { end = j; break; }
    end = j;
  }
  console.log('  view-stats.js 删除第 ' + (start + 1) + '–' + (end + 1) + ' 行（桌宠设置块）');
  lines.splice(start, end - start + 1);
  removed++;
  i = start - 1;
}
if (removed) fs.writeFileSync(vs, lines.join('\n'), 'utf8');
else console.log('  view-stats.js 未发现桌宠设置块（可能用别的写法，需要人工看一眼）');

/* 5) 残留自检 */
const left = [];
const scan = ['index.html', 'sw.js', 'js/view-stats.js', 'js/app.js', 'js/ui.js', 'js/store.js'];
scan.forEach((rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return;
  const t = fs.readFileSync(p, 'utf8');
  const hits = t.split('\n').map((l, i) => ({ l, i })).filter((x) => /pet\.css|js\/pet\.js|view-pet|桌宠|PetView|window\.Pet/.test(x.l));
  if (hits.length) left.push(rel + ': ' + hits.length + ' 处（例：第 ' + (hits[0].i + 1) + ' 行 ' + hits[0].l.trim().slice(0, 60) + '）');
});
console.log(left.length ? ('  ⚠ 仍有引用：\n    ' + left.join('\n    ')) : '  ✅ 引用已全部清理');
