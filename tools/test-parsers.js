/* ==========================================================================
   test-parsers.js — 在真实浏览器里验证各格式解析（TXT 编码 / EPUB / MOBI / PDF）
   用法： node tools/test-parsers.js [测试书目录]
   ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, Page, sleep } = require('./driver');

const DIR = process.argv[2] || path.join(os.tmpdir(), 'sw-books');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && detail ? '  → ' + detail : ''));
};

(async () => {
  if (!fs.existsSync(DIR)) {
    console.error('测试目录不存在: ' + DIR + '\n先运行: node tools/make-test-books.js');
    process.exit(2);
  }

  const browser = await launch();
  const page = await Page.open(browser, 'http://127.0.0.1:8099/index.html?nosw=1');
  await sleep(2500);

  const hasParsers = await page.eval('!!(window.Parsers && window.Parsers.parseFile && window.Parsers.inflate)');
  check('解析模块已加载', hasParsers);
  if (!hasParsers) { console.error('Parsers 未加载'); process.exit(1); }

  const files = fs.readdirSync(DIR).filter((f) => /\.(txt|epub|mobi|pdf)$/i.test(f));
  console.log('测试文件: ' + files.join(', ') + '\n');

  for (const f of files) {
    const buf = fs.readFileSync(path.join(DIR, f));
    const b64 = buf.toString('base64');
    const raw = await page.call(`
      const b64 = ${JSON.stringify(b64)};
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      try {
        const book = window.Parsers.parseFile({ name: ${JSON.stringify(f)} }, bytes);
        const total = book.chapters.reduce(function (s, c) { return s + c.content.length; }, 0);
        return JSON.stringify({
          ok: true,
          title: book.title,
          author: book.author || '',
          chapters: book.chapters.length,
          firstTitle: book.chapters[0] ? book.chapters[0].title : '',
          totalChars: total,
          head: book.chapters[0] ? book.chapters[0].content.slice(0, 60) : '',
          note: book.note || ''
        });
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e && e.message || e) });
      }
    `);

    let r;
    try { r = JSON.parse(raw); } catch (e) { r = { ok: false, error: '结果解析失败: ' + raw }; }

    const label = f.padEnd(16);
    if (!r.ok) {
      check(label + '解析', false, r.error);
      continue;
    }
    console.log('  ' + label + ' -> ' + r.chapters + ' 节, ' + r.totalChars + ' 字, 首节「' + r.head.replace(/\n/g, ' ').slice(0, 40) + '」' + (r.note ? '  [' + r.note + ']' : ''));
    check(label + '有内容', r.totalChars > 10, 'totalChars=' + r.totalChars + ' head=' + r.head);
    if (f === 'utf8.txt' || f === 'gbk.txt' || f === 'utf16le.txt') {
      check(label + '编码正确（含中文且分章）',
        /[第一二章正文]/.test(r.head) && r.chapters >= 2,
        'head=' + r.head + ' chapters=' + r.chapters);
    }
    if (f === 'test.epub') {
      check(label + '元数据与分节正确',
        /测试书/.test(r.title) && /示例作者/.test(r.author) && r.chapters === 3,
        'title=' + r.title + ' author=' + r.author + ' chapters=' + r.chapters);
    }
    if (f === 'test.mobi') {
      check(label + '标题与内容正确',
        r.chapters >= 1 && r.totalChars > 10, 'title=' + r.title + ' chapters=' + r.chapters);
    }
    if (f === 'test.pdf') {
      check(label + '文本层抽取成功',
        /Chapter One|PDF test/i.test(r.head) || r.totalChars > 20, 'head=' + r.head);
    }
  }

  /* 导入管线端到端：EPUB 走完整链路（构造真实 File 对象，确保走 onShowFileChooser 之后的同一条路） */
  const epubB64 = fs.readFileSync(path.join(DIR, 'test.epub')).toString('base64');
  const e2e = await page.call(`
    const b64 = ${JSON.stringify(epubB64)};
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'test.epub', { type: 'application/epub+zip' });
    const before = window.Store.state.reading.length;
    const res = await window.IOApi.importText('reading', [file], {});
    await new Promise(function (r) { setTimeout(r, 900); });
    const after = window.Store.state.reading.length;
    const books = window.Store.state.reading;
    const book = books.filter(function (b) { return /test/i.test(b.title) || b.chapters.length >= 3; })[0] || books[0];
    return JSON.stringify({
      ok: res.ok, count: res.count, err: res.error || '',
      before: before, after: after,
      chapters: book ? book.chapters.length : 0,
      words: book ? window.Store.bookWords(book) : 0,
      title: book ? book.title : '',
      author: book ? book.author : '',
      firstHead: book && book.chapters[0] ? book.chapters[0].content.slice(0, 30) : ''
    });
  `);
  let e;
  try { e = JSON.parse(e2e); } catch (err) { e = { ok: false, err: String(e2e) }; }
  check('端到端：EPUB 经导入管线进入阅读器（含标题/作者/章节）',
    e.ok && e.after === e.before + 1 && e.chapters >= 3 && e.words > 0 && /测试书/.test(e.title || ''),
    JSON.stringify(e));

  const failed = results.filter((r) => !r.ok);
  console.log('\n===== 解析验证：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
  if (failed.length) failed.forEach((f) => console.log('  ✗ ' + f.name + '  ' + f.detail));

  page.close();
  browser.proc.kill();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
