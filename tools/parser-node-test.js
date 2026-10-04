/* ==========================================================================
   parser-node-test.js — 直接在 Node 里跑 js/parsers.js（不开浏览器）
   便于快速定位解析问题：node tools/parser-node-test.js [测试书目录]
   ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const vm = require('vm');

const DIR = process.argv[2] || path.join(os.tmpdir(), 'sw-books');
const ROOT = path.join(__dirname, '..');

/* 最小浏览器环境：parsers.js 只依赖 U.splitChapters / U.mdToHtml / TextDecoder */
const sandbox = {
  TextDecoder: TextDecoder,
  console: console,
  setTimeout: setTimeout,
  Uint8Array: Uint8Array,
  ArrayBuffer: ArrayBuffer,
  DataView: DataView,
  Object: Object,
  Array: Array,
  Math: Math,
  String: String,
  Number: Number,
  Error: Error,
  parseInt: parseInt,
  isNaN: isNaN
};
sandbox.window = sandbox;
sandbox.global = sandbox;

// 极简 U：splitChapters 用与浏览器一致的规则（这里只做「第X章」识别）
sandbox.U = {
  splitChapters: function (text) {
    const lines = String(text || '').split('\n');
    const out = [];
    let cur = null;
    const re = /^\s*第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节回卷篇]/;
    lines.forEach((l) => {
      if (re.test(l)) {
        if (cur) out.push(cur);
        cur = { title: l.trim().slice(0, 40), content: '' };
      } else if (cur) cur.content += (cur.content ? '\n' : '') + l;
      else {
        cur = { title: '前言', content: l };
      }
    });
    if (cur) out.push(cur);
    return out.map((c) => ({ title: c.title, content: c.content.trim() })).filter((c) => c.content || c.title);
  },
  mdToHtml: (s) => String(s || '')
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'parsers.js'), 'utf8'), sandbox, { filename: 'parsers.js' });
const P = sandbox.Parsers;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  → ' + detail); }
}

/* ---- 1. inflate 基本正确性：与 Node 的 zlib 对拍 ---- */
console.log('=== inflate 对拍（与 Node zlib） ===');
const samples = [
  'hello world',
  '第一章 起点\n\n中文内容测试，包含标点。\n\n第二章 转折\n\n更多内容。',
  'A'.repeat(5000),
  '混合内容 mixed content 12345\n'.repeat(300)
];
samples.forEach((s, i) => {
  const raw = zlib.deflateRawSync(Buffer.from(s, 'utf8'));
  const zl = zlib.deflateSync(Buffer.from(s, 'utf8'));
  let okRaw = false, okZlib = false, errRaw = '', errZlib = '';
  try {
    const out = Buffer.from(P.inflate(new Uint8Array(raw)));
    okRaw = out.toString('utf8') === s;
  } catch (e) { errRaw = e.message; }
  try {
    const out = Buffer.from(P.inflate(new Uint8Array(zl)));
    okZlib = out.toString('utf8') === s;
  } catch (e) { errZlib = e.message; }
  check('inflate 样本 ' + (i + 1) + '（裸 deflate / zlib）', okRaw && okZlib,
    'raw=' + okRaw + '(' + errRaw + ') zlib=' + okZlib + '(' + errZlib + ')');
});

/* ---- 2. 各格式解析 ---- */
console.log('\n=== 格式解析 ===');
fs.readdirSync(DIR).filter((f) => /\.(txt|epub|mobi|pdf)$/i.test(f)).forEach((f) => {
  const buf = new Uint8Array(fs.readFileSync(path.join(DIR, f)));
  try {
    const book = P.parseFile({ name: f }, buf);
    const total = book.chapters.reduce((n, c) => n + c.content.length, 0);
    console.log('  ' + f.padEnd(16) + ' → ' + book.chapters.length + ' 节, ' + total + ' 字, 「' +
      (book.chapters[0] ? book.chapters[0].content.slice(0, 30).replace(/\n/g, ' ') : '') + '」' +
      (book.title ? '  标题=' + book.title : ''));
    check(f + ' 解析出内容', total > 10, 'total=' + total);
    if (f === 'test.epub') check(f + ' 元数据正确', /测试书/.test(book.title) && /示例作者/.test(book.author) && book.chapters.length === 3,
      'title=' + book.title + ' author=' + book.author + ' chapters=' + book.chapters.length);
    if (f === 'test.mobi') check(f + ' 分节正确', book.chapters.length >= 2, 'chapters=' + book.chapters.length);
    if (/\.txt$/.test(f)) check(f + ' 编码正确（中文字符）', /[第一二章正文这]/.test(book.chapters[0].content), book.chapters[0].content.slice(0, 30));
  } catch (e) {
    check(f + ' 解析', false, e.message);
  }
});

/* ---- 3. 原始诊断（若失败，打印关键字段） ---- */
console.log('\n=== 诊断 ===');
try {
  const bytes = new Uint8Array(fs.readFileSync(path.join(DIR, 'test.mobi')));
  const type = Buffer.from(bytes.subarray(60, 68)).toString('latin1');
  console.log('  test.mobi 偏移 60..68 = "' + type + '"');
} catch (e) { /* 忽略 */ }
try {
  const bytes = new Uint8Array(fs.readFileSync(path.join(DIR, 'test.epub')));
  const zip = P.readZip(bytes);
  console.log('  test.epub 条目: ' + zip.names.join(', '));
  const c = zip.get('META-INF/container.xml');
  console.log('  container.xml 解压: ' + (c ? c.length + ' 字节' : '失败'));
} catch (e) {
  console.log('  test.epub 读 zip 失败: ' + e.message);
}

console.log('\n===== Node 解析测试：' + pass + '/' + (pass + fail) + ' 通过 =====');
process.exit(fail ? 1 : 0);
