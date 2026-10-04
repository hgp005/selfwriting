/* ==========================================================================
   fix-apk-paths.js — 把 APK 里条目名中的反斜杠改成正斜杠
   --------------------------------------------------------------------------
   为什么需要：
     Windows 版 aapt2 用系统路径（反斜杠）写 ZIP 条目名，例如
       assets/www/css\style.css
     而安卓的 AssetManager 不会把 '\' 规范化成 '/'，设备上 asset.open() 会失败，
     网页里的 CSS / JS 全部 404（应用只剩空壳）。
   做法：同时修正「中央目录」和「本地文件头」里的文件名，逐字节处理，不动内容。
   用法： node tools/fix-apk-paths.js <apk 路径>
   ========================================================================== */
'use strict';

const fs = require('fs');

const BACKSLASH = 0x5c;
const SLASH = 0x2f;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('用法: node tools/fix-apk-paths.js <apk>');
    process.exit(2);
  }
  const buf = fs.readFileSync(file);
  const total = buf.length;
  const patched = new Set();   // 已修正的本地头偏移
  let renamed = 0;

  /* ---- 1. 中央目录：读文件名长度并就地替换 ---- */
  for (let i = 0; i + 46 <= total; i++) {
    if (buf.readUInt32LE(i) !== SIG_CENTRAL) continue;
    if (i + 46 > total) break;
    const nameLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 46;
    if (nameStart + nameLen > total) continue;
    let touched = false;
    for (let k = 0; k < nameLen; k++) {
      if (buf[nameStart + k] === BACKSLASH) { buf[nameStart + k] = SLASH; touched = true; }
    }
    if (touched) {
      renamed++;
      const localOffset = buf.readUInt32LE(i + 42);
      patchLocal(localOffset);
    }
    i = nameStart + nameLen - 1;
  }

  /* ---- 2. 本地文件头：同样处理（口径必须与中央目录一致） ---- */
  function patchLocal(offset) {
    if (patched.has(offset)) return;
    if (offset + 30 > total) return;
    if (buf.readUInt32LE(offset) !== SIG_LOCAL) return;
    const nameLen = buf.readUInt16LE(offset + 26);
    const nameStart = offset + 30;
    if (nameStart + nameLen > total) return;
    for (let k = 0; k < nameLen; k++) {
      if (buf[nameStart + k] === BACKSLASH) buf[nameStart + k] = SLASH;
    }
    patched.add(offset);
  }

  /* 兜底：扫描所有本地文件头（防止中央目录里没有对应项） */
  for (let i = 0; i + 30 <= total; i++) {
    if (buf.readUInt32LE(i) !== SIG_LOCAL) continue;
    patchLocal(i);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const compSize = buf.readUInt32LE(i + 18);
    const skip = 30 + nameLen + extraLen + compSize;
    if (skip > 0) i += skip - 1;
  }

  if (renamed === 0) {
    console.log('    no backslash entries found (nothing to fix)');
    return;
  }
  fs.writeFileSync(file, buf);
  console.log('    fixed ' + renamed + ' entry name(s) with backslashes');
}

main();
