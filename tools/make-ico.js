/* ==========================================================================
   make-ico.js — 把 PNG 图标打包成 Windows .ico
   （ICO 允许直接内嵌 PNG，从 Vista 起系统原生支持，无需 BMP 转换）
   用法： node tools/make-ico.js <输出.ico> <16.png> <32.png> <48.png> <64.png> <128.png> <256.png>
   ========================================================================== */
'use strict';

const fs = require('fs');

function main() {
  const out = process.argv[2];
  const pngs = process.argv.slice(3);
  if (!out || !pngs.length) {
    console.error('用法: node tools/make-ico.js <out.ico> <png...>');
    process.exit(2);
  }

  const images = pngs.map((p) => {
    const buf = fs.readFileSync(p);
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG: ' + p);
    return { buf, size: buf.readUInt32BE(16) };   // IHDR 宽 = 高（正方形）
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type = icon
  header.writeUInt16LE(images.length, 4);  // image count

  let offset = 6 + images.length * 16;
  const dirEntries = [];
  const blobs = [];

  images.forEach((img) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 0);   // width  (0 = 256)
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 1);   // height
    e.writeUInt8(0, 2);                                // palette
    e.writeUInt8(0, 3);                                // reserved
    e.writeUInt16LE(1, 4);                             // color planes
    e.writeUInt16LE(32, 6);                            // bits per pixel
    e.writeUInt32LE(img.buf.length, 8);                // data size
    e.writeUInt32LE(offset, 12);                       // data offset
    offset += img.buf.length;
    dirEntries.push(e);
    blobs.push(img.buf);
  });

  fs.writeFileSync(out, Buffer.concat([header].concat(dirEntries, blobs)));
  console.log('ICO 写出: ' + out + '  (' + images.length + ' 种尺寸, ' +
    images.map((i) => i.size).join('/') + ', ' + fs.statSync(out).size + ' 字节)');
}

main();
