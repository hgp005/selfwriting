/* 开发用：1.15.0 发布前的 README 收尾
   1) 音乐一行补上「示例曲库可选 + 简谱 / MIDI 导入」
   2) 桌宠已从应用摘除 → 从功能表里去掉，并在「已知不足」里注明它已停用（文件保留）
*/
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'README.md');
let s = fs.readFileSync(file, 'utf8');
const before = s;

/* 1) 音乐能力描述 */
const oldMusic = '| **音乐** | 真采样音色（钢琴 / 电钢琴 / 吉他 / 贝斯，FluidR3_GM）+ 合成鼓组、试音台（选乐器 / 弹奏 / 调音色 / 电平表 / 示范乐句）、16 步谱曲、歌词、曲子保存与导出 |';
const newMusic = '| **音乐** | 真采样音色（钢琴 / 电钢琴 / 吉他 / 贝斯，FluidR3_GM）+ 合成鼓组、试音台（选乐器 / 弹奏 / 调音色 / 电平表）、**示例曲库可选**（内置多首传统 / 原创短曲，点开就听）、**导入演奏**（粘贴简谱文本或导入 MIDI / 本应用导出的曲子，选一件试音台乐器就能弹）、16 步谱曲、歌词、曲子保存与导出 |';
if (s.indexOf(oldMusic) >= 0) { s = s.replace(oldMusic, newMusic); console.log('  ✔ 音乐一行已更新'); }
else console.log('  · 音乐一行没找到（可能已改过）');

/* 2) 娱乐与工具一行去掉桌宠 */
const oldFun = '| **游戏与工具** | 俄罗斯方块、贪吃蛇（键盘 + 触屏）、计算器（标准 / 科学 / 单位换算 / 历史）、便签、隐私锁、桌宠（布偶猫小陪伴） |';
const newFun = '| **游戏与工具** | 俄罗斯方块、贪吃蛇（键盘 + 触屏）、计算器（标准 / 科学 / 单位换算 / 历史）、便签、隐私锁 |';
if (s.indexOf(oldFun) >= 0) { s = s.replace(oldFun, newFun); console.log('  ✔ 功能表已去掉桌宠'); }
else console.log('  · 娱乐与工具一行没找到（可能已改过）');

/* 3) 已知不足：桌宠那条改成「已停用」 */
const oldPet = '| **桌宠** | 布偶猫是纯 SVG/CSS 绘制（无外部图片），观感离真猫还有距离；生态（猫碗 / 玩具 / 猫窝）仍在做 |';
const newPet = '| **桌宠（已停用）** | 曾经做过一只 SVG 布偶猫桌宠，因观感不理想已**从应用里摘除**（源码保留在 `js/pet.js`、`js/view-pet.js`、`css/pet.css`，文件头标注「已停用」）。想启用就把 `index.html` 与 `sw.js` 里的三行引用加回去 |';
if (s.indexOf(oldPet) >= 0) { s = s.replace(oldPet, newPet); console.log('  ✔ 已知不足里的桌宠已改写为「已停用」'); }
else console.log('  · 桌宠不足条目没找到');

/* 4) 版本段加上 1.15.0 的更新重点 */
const oldHead = '> 当前版本 **1.14.0**';
if (s.indexOf(oldHead) >= 0) {
  s = s.replace(oldHead, '> 当前版本 **1.15.0**');
  console.log('  ✔ README 版本号已改 1.15.0');
}
const marker = '> 安装包：';
const i = s.indexOf(marker);
if (i >= 0) {
  const line = [
    '> 本版重点：音乐试音台新增**示例曲库**（可选曲、点开就听）与**导入演奏**（粘贴简谱 / 导入 MIDI → 用试音台乐器弹），',
    '> 阅读器新增**仿真卷曲翻页**（手指跟随卷边、露纸背、松手回弹），日记改为**长按弹「选这几天」、双击收藏**，',
    '> 桌宠已按你的要求停用并从应用摘除。',
    ''
  ].join('\n');
  s = s.slice(0, i) + line + s.slice(i);
  console.log('  ✔ 已插入 1.15.0 更新重点');
}
fs.writeFileSync(file, s, 'utf8');
console.log('README 已更新（' + (s === before ? '无变化' : '有改动') + '，' + s.split('\n').length + ' 行，FFFD=' + s.includes('\uFFFD') + '）');
