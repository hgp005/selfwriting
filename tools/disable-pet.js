/* 开发用：桌宠任务取消 —— 把桌宠从应用里「摘掉引用」（不删除源文件）
   背景：被中断的子代理删掉了 js/pet.js、js/view-pet.js、css/pet.css 与设置页区块，
        而 index.html / sw.js 还在引用 → 会 404。我先把三个文件从 1.14.0 包里恢复，
        现在再把「引用」摘掉，让应用回到干净状态；三个文件留在仓库里，随时能两行代码启用。
*/
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* 1) index.html：去掉 link 与两处 script */
const idxPath = path.join(ROOT, 'index.html');
let idx = fs.readFileSync(idxPath, 'utf8');
const before = idx;
idx = idx.split('\n').filter((l) => !/pet\.css|js\/pet\.js|js\/view-pet\.js/.test(l)).join('\n');
if (idx === before) console.log('  index.html：没有需要摘的引用');
else { fs.writeFileSync(idxPath, idx, 'utf8'); console.log('  index.html：已摘掉桌宠的 link / script'); }

/* 2) sw.js：从 ASSETS 里去掉桌宠条目（cache.addAll 一条失败整批不缓存） */
const swPath = path.join(ROOT, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const swBefore = sw;
sw = sw.split('\n').filter((l) => !/pet\.css|js\/pet\.js|js\/view-pet\.js/.test(l)).join('\n');
if (sw === swBefore) console.log('  sw.js：没有需要摘的条目');
else { fs.writeFileSync(swPath, sw, 'utf8'); console.log('  sw.js：已从缓存清单去掉桌宠'); }

/* 3) 三个源文件保留，只在文件头标注状态 */
[['js/pet.js', '桌宠（已停用：任务取消，文件保留，若要启用请把 index.html / sw.js 里的引用加回去）'],
 ['js/view-pet.js', '桌宠视图（已停用：同上）'],
 ['css/pet.css', '桌宠样式（已停用：同上）']].forEach(([f, note]) => {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) return;
  let t = fs.readFileSync(p, 'utf8');
  if (t.indexOf('已停用') >= 0) { console.log('  ' + f + '：已标注'); return; }
  const lines = t.split('\n');
  lines.splice(1, 0, '   ⚠ ' + note);
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
  console.log('  ' + f + '：已标注「已停用」');
});

console.log('完成。应用不再加载桌宠；三个文件仍在仓库里。');
