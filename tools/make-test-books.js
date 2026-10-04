/* ==========================================================================
   make-test-books.js — 生成各格式的测试用书（验证导入解析）
   产出：TXT(UTF-8/UTF-16/GBK)、EPUB、MOBI、PDF
   用法： node tools/make-test-books.js [输出目录]
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = process.argv[2] || path.join(require('os').tmpdir(), 'sw-books');
fs.mkdirSync(DIR, { recursive: true });

const CN = '第一章 起点\n\n这是一段中文正文，用来验证编码识别与分章。\n\n第二章 转折\n\n正文继续，结尾。';

/* ---------------- 1. TXT：UTF-8 / UTF-16LE / GBK ---------------- */
fs.writeFileSync(path.join(DIR, 'utf8.txt'), CN, 'utf8');
fs.writeFileSync(path.join(DIR, 'utf16le.txt'), Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(CN, 'utf16le')]));

// GBK：用常见字的手工字节表（够验证识别逻辑）
const GBK = {
  '第': [0xB5, 0xDA], '一': [0xD2, 0xBB], '章': [0xD5, 0xC2], '起': [0xC6, 0xF0], '点': [0xB5, 0xE3],
  '这': [0xD5, 0xE2], '是': [0xCA, 0xC7], '一': [0xD2, 0xBB], '段': [0xB6, 0xCE], '中': [0xD6, 0xD0],
  '文': [0xCE, 0xC4], '正': [0xD5, 0xFD], '用': [0xD3, 0xC3], '来': [0xC0, 0xB4], '验': [0xD1, 0xE9],
  '证': [0xD6, 0xA4], '编': [0xB1, 0xE0], '码': [0xC2, 0xEB], '识': [0xCA, 0xB6], '别': [0xB1, 0xF0],
  '与': [0xD3, 0xEB], '分': [0xB7, 0xD6], '二': [0xB6, 0xFE], '转': [0xD7, 0xAA], '折': [0xD5, 0xDB],
  '继': [0xBC, 0xCC], '续': [0xD0, 0xF8], '结': [0xBD, 0xE1], '尾': [0xCE, 0xB2], '还': [0xBB, 0xB9]
};
const gbkBytes = [];
for (const ch of CN) {
  if (GBK[ch]) gbkBytes.push(GBK[ch][0], GBK[ch][1]);
  else if (ch.charCodeAt(0) < 128) gbkBytes.push(ch.charCodeAt(0));
  else gbkBytes.push(0xA1, 0xA1);   // 表外的字用占位（不影响识别验证）
}
fs.writeFileSync(path.join(DIR, 'gbk.txt'), Buffer.from(gbkBytes));

/* ---------------- 2. ZIP 写入（EPUB 就是 zip） ---------------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const chunks = [], central = [];
  let offset = 0;
  files.forEach((f) => {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    let comp = data, method = 0;
    if (f.deflate) { comp = zlib.deflateRawSync(data); method = 8; }
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += local.length + name.length + comp.length;
  });
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([Buffer.concat(chunks), cd, eocd]);
}

/* ---------------- 3. EPUB ---------------- */
const CONTAINER = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
  '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>',
  '</container>'
].join('');

const OPF = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">',
  '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
  '<dc:title>测试书 EPUB</dc:title><dc:creator>示例作者</dc:creator><dc:language>zh</dc:language>',
  '</metadata>',
  '<manifest>',
  '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>',
  '<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>',
  '<item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/>',
  '</manifest>',
  '<spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>',
  '</package>'
].join('');

function chapterHtml(title, body) {
  return '<html><head><title>' + title + '</title></head><body><h1>' + title + '</h1>'
    + body.split('\n\n').map((p) => '<p>' + p + '</p>').join('') + '</body></html>';
}

const epub = makeZip([
  { name: 'mimetype', data: 'application/epub+zip' },
  { name: 'META-INF/container.xml', data: CONTAINER, deflate: true },
  { name: 'OEBPS/content.opf', data: OPF, deflate: true },
  { name: 'OEBPS/c1.xhtml', data: chapterHtml('第一章 起航', '这是第一章的正文内容。\n\n第二段内容，用来测试段落。'), deflate: true },
  { name: 'OEBPS/c2.xhtml', data: chapterHtml('第二章 风暴', '第二章的内容在这里。\n\n又一段。'), deflate: true },
  { name: 'OEBPS/c3.xhtml', data: chapterHtml('第三章 归港', '第三章收尾。'), deflate: true }
]);
fs.writeFileSync(path.join(DIR, 'test.epub'), epub);

/* ---------------- 4. MOBI（PalmDOC 无压缩） ---------------- */
const mobiHtml = '<html><body><h1>第一章</h1><p>MOBI 正文内容一。</p>'
  + '<mbp:pagebreak><h1>第二章</h1><p>MOBI 正文内容二。</p></body></html>';
const textBuf = Buffer.from(mobiHtml, 'utf8');

/* 记录 0 布局：PalmDOC 头 16 字节 + MOBI 头 232 字节 + 全名（末尾，不算进 MOBI 头长度） */
const MOBI_HDR = 232;
const nameBytes = Buffer.from('测试 MOBI 书', 'utf8');
const nameOff = 16 + MOBI_HDR;                   // 全名偏移（相对记录 0 起点）
const rec0 = Buffer.alloc(nameOff + nameBytes.length, 0);
rec0.writeUInt16BE(1, 0);                       // compression = 1 (none)
rec0.writeUInt32BE(textBuf.length, 4);          // 正文总长度
rec0.writeUInt16BE(1, 8);                       // 正文记录数
rec0.writeUInt16BE(0, 10);                      // 记录大小（0 = 4096）
rec0.writeUInt16BE(1252, 28);                   // PalmDOC 头的编码字段在这里（MOBI 用 1252 占位）
rec0.write('MOBI', 16, 'latin1');               // MOBI 头魔数
rec0.writeUInt32BE(MOBI_HDR, 20, true);         // MOBI 头长度
rec0.writeUInt32BE(2, 24, true);                // MOBI 类型 = book（2）
rec0.writeUInt32BE(65001, 28, true);            // MOBI 头里的编码
rec0.writeUInt32BE(nameOff, 16 + 68, true);     // 全名偏移
rec0.writeUInt32BE(nameBytes.length, 16 + 72, true);
nameBytes.copy(rec0, nameOff);

const pdb = Buffer.alloc(78, 0);
pdb.write('TestMobi', 0, 'latin1');
// PalmDB 规定 60..68 是 type/creator；MOBI 的 type 必须是 BOOKMOBI
pdb.write('BOOKMOBI', 60, 'latin1');
pdb.writeUInt16BE(0, 32);                        // attributes
pdb.writeUInt16BE(1, 34);                        // version（PalmDB 里这两项是大端）
pdb.writeUInt32BE(Math.floor(Date.now() / 1000), 36);
pdb.writeUInt32BE(Math.floor(Date.now() / 1000), 40);
/* 记录数与小端字段都在 76 之后；偏移表每项 8 字节（偏移 4 + 属性 1 + 填充 3） */
pdb.writeUInt16LE(2, 76);                        // 记录数 = 2（记录 0 = 头，记录 1 = 正文）
const offTable = Buffer.alloc(16, 0);            // 2 条记录 × 8 字节
const off0 = 78 + 16;
offTable.writeUInt32LE(off0, 0);                 // 记录 0：头
offTable.writeUInt32LE(off0 + rec0.length, 8);   // 记录 1：正文（每项间隔 8 字节）
fs.writeFileSync(path.join(DIR, 'test.mobi'), Buffer.concat([pdb, offTable, rec0, textBuf]));
if (process.env.SW_DEBUG_MOBI) {
  console.log('  [调试] rec0 长=' + rec0.length + ' off0=' + off0 + ' 全名偏移=' + nameOff
    + ' 正文长=' + textBuf.length + ' 文件长=' + (pdb.length + offTable.length + rec0.length + textBuf.length));
  console.log('  [调试] rec0 头 24 字节=' + rec0.subarray(0, 24).toString('hex'));
}

/* ---------------- 5. PDF（含文本层） ---------------- */
function pdfObj(n, body) { return Buffer.from(n + ' 0 obj\n' + body + '\nendobj\n', 'latin1'); }
const stream = [
  'BT /F1 12 Tf 72 720 Td (Chapter One of the PDF test) Tj',
  '0 -16 Td (Second line in the text layer.) Tj',
  '0 -16 Td (Escaped parens \\050like this\\051 work too.) Tj ET'
].join('\n');
const objs = [
  pdfObj(1, '<< /Type /Catalog /Pages 2 0 R >>'),
  pdfObj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
  pdfObj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
  pdfObj(4, '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream'),
  pdfObj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
];
let pdf = '%PDF-1.4\n';
const offsets = [];
objs.forEach((o) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += o.toString('latin1'); });
const xref = Buffer.byteLength(pdf, 'latin1');
pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
offsets.forEach((o) => { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
fs.writeFileSync(path.join(DIR, 'test.pdf'), Buffer.from(pdf, 'latin1'));

/* ---------------- 汇总 ---------------- */
console.log('测试文件目录: ' + DIR);
fs.readdirSync(DIR).forEach((f) => {
  console.log('  ' + f.padEnd(18) + fs.statSync(path.join(DIR, f)).size + ' 字节');
});
