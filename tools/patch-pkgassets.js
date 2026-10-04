/* 开发用：给 android/pkgassets.bat 加一行，把 assets/samples（采样音色）递归拷进 APK。
   原来的 for %%F in ("%ROOT%\assets\*") 只拷一层，子目录会被漏掉。 */
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'android', 'pkgassets.bat');
let s = fs.readFileSync(file, 'utf8');
if (s.indexOf('assets\\samples') >= 0) { console.log('已经加过了'); process.exit(0); }

const anchor = 'if exist "%ROOT%\\assets" mkdir "%TGT%\\assets" 2>nul';
if (s.indexOf(anchor) < 0) { console.log('[x] 找不到锚点'); process.exit(1); }
const add = [
  anchor,
  'rem  ---- 采样音色：assets/samples 是子目录，上面那条 for 只拷一层，这里递归补上 ----',
  'if exist "%ROOT%\\assets\\samples" xcopy /e /i /q /y "%ROOT%\\assets\\samples" "%TGT%\\assets\\samples\\" >nul'
].join('\r\n');
s = s.replace(anchor, add);
fs.writeFileSync(file, s, 'utf8');
console.log('pkgassets.bat 已加采样递归拷贝');
