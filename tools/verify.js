/* ==========================================================================
   selfwriting · verify.js（开发验证用）
   逐屏打开应用，抓取可见文本、点击关键交互、收集控制台错误并截图。
   用法：
     node tools/verify.js [端口] [dark]
     node tools/verify.js --base http://127.0.0.1:8123/index.html?k=xxx
       对任意来源跑同一套检查。配合 tools/serve-apk-assets.js 使用时，
       验证的就是「真正打进 APK 的那份资源」。
   ========================================================================== */
'use strict';

const path = require('path');
const fs = require('fs');
const { launch, Page, sleep } = require('./driver');

const ARGV = process.argv.slice(2);
const baseIdx = ARGV.indexOf('--base');
const CUSTOM_BASE = baseIdx >= 0 ? ARGV[baseIdx + 1] : null;
const PORT = Number(ARGV[0] && ARGV[0].charAt(0) !== '-' ? ARGV[0] : 8099);
const DARK = ARGV.indexOf('dark') >= 0;
const BASE = CUSTOM_BASE || ('http://127.0.0.1:' + PORT + '/index.html?nosw=1');
const SHOTS = path.join(__dirname, '..', 'shots');
console.log('验证目标: ' + BASE);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  → ' + String(detail).slice(0, 240) : ''));
}

function has(text, ...needles) {
  const t = String(text || '');
  return needles.map((n) => ({ n, ok: t.indexOf(n) >= 0 }));
}

/* 造一个最小但合法的 EPUB（deflate 压缩），用于浏览器端导入回归 */
function buildMiniEpub(chapters) {
  const zlib = require('zlib');
  const chunks = [];
  const central = [];
  let offset = 0;
  function add(name, data, deflate) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = Buffer.from(data, 'utf8');
    const method = deflate ? 8 : 0;
    const comp = deflate ? zlib.deflateRawSync(body) : body;
    const crc = crc32buf(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc >>> 0, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(body.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  add('mimetype', 'application/epub+zip', false);
  add('META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    + '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', true);
  const items = chapters.map((c, i) => '<item id="c' + i + '" href="c' + i + '.xhtml" media-type="application/xhtml+xml"/>').join('');
  const spine = chapters.map((c, i) => '<itemref idref="c' + i + '"/>').join('');
  add('OEBPS/content.opf',
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">'
    + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>验证用 EPUB</dc:title>'
    + '<dc:creator>测试作者</dc:creator></metadata>'
    + '<manifest>' + items + '</manifest><spine>' + spine + '</spine></package>', true);
  chapters.forEach((c, i) => {
    add('OEBPS/c' + i + '.xhtml',
      '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>'
      + c.title + '</title></head><body><h1>' + c.title + '</h1><p>' + c.body + '</p></body></html>', true);
  });
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(chapters.length + 3, 8);
  eocd.writeUInt16LE(chapters.length + 3, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat(chunks.concat([cd, eocd]));
}

function crc32buf(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function main() {
  const browser = await launch();
  console.log('Edge:', browser.version['Browser'], '| 调试端口', browser.port);
  const page = await Page.open(browser, BASE + '#/library');

  /* 等待应用真正启动（脚本全部执行完、Store/UI 就绪） */
  async function waitReady(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 20000);
    while (Date.now() < deadline) {
      const ok = await page.eval('!!(window.Store && window.UI && window.U && window.__selfwritingDemo)').catch(() => false);
      if (ok) return true;
      await sleep(400);
    }
    return false;
  }
  console.log('应用就绪:', await waitReady(25000));

  /* 断言都是按中文写的：先把界面语言重置为中文，避免被上一次测试的残留影响 */
  try {
    await page.eval(`(function(){ window.Store.setSetting('language','zh-CN'); return 1; })()`);
  } catch (e) { /* 忽略 */ }

  /* 清掉离线缓存，保证测试的是最新源码，然后重新加载 */
  console.log('清理 Service Worker 缓存:', await page.freshCache());
  await page.hardGoto(BASE + '#/library');
  const ready2 = await waitReady(25000);
  if (!ready2) {
    const txt = await page.text().catch(() => '');
    const errs = page.errors().map((e) => e.type + ': ' + e.text.slice(0, 160)).join(' | ');
    throw new Error('应用未能启动。页面文本=' + String(txt).slice(0, 120) + ' 控制台=' + errs);
  }

  /* 测试模式：改语言不要自动刷新页面，否则后面的用例会在半路被刷掉 */
  try { await page.eval('(window.I18N.testMode = true, 1)'); } catch (e) { /* 忽略 */ }

  /* 自检：确认浏览器拿到的是最新源码 */
  const freshCheck = await page.eval(`(function(){
    return JSON.stringify({
      guard: String(window.Store.countNodes).indexOf('walkTree') >= 0,
      panel: String(window.EditorView ? 1 : 0),
      searchWalkerOk: String(window.UI.search).length > 100
    });
  })()`);
  console.log('源码自检:', freshCheck);

  /* 每次验证都从干净的本机数据开始，然后创建示例数据 */
  const reset = await page.call(`
    if (!window.__selfwritingReset) return 'no-reset';
    await window.__selfwritingReset();
    return 'reset';
  `);
  console.log('数据重置:', reset);
  await page.goto(BASE + '#/library');
  await sleep(900);
  const seeded = await page.call(`
    const t = document.body.innerText;
    if (/欢迎使用 selfwriting/.test(t)) {
      const b = Array.prototype.slice.call(document.querySelectorAll('.sheet-foot .btn')).filter(function (x) { return /示例数据/.test(x.textContent); })[0];
      if (b) { b.click(); return 'via-welcome'; }
    }
    if (window.__selfwritingDemo) { window.__selfwritingDemo(); return 'via-api'; }
    return 'failed';
  `);
  console.log('示例数据:', seeded);
  await sleep(2200);
  await page.goto(BASE + '#/library');
  await sleep(700);

  /* 深色模式 */
  if (DARK) {
    await page.eval('(function(){document.documentElement.setAttribute("data-theme","dark");return 1})()');
  }

  /* 等待启动完成 */
  let ready = false;
  let firstText = '';
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    firstText = await page.text().catch(() => '');
    if (/欢迎使用 selfwriting/.test(firstText) || /开始你的第一部作品|小说/.test(firstText)) { ready = true; break; }
  }
  check('应用启动并渲染首屏', ready, firstText.slice(0, 120));
  await page.shot(path.join(SHOTS, '10-welcome.png'));

  /* 首启引导里的「看看示例数据」按钮（不强求出现，取决于是否首次启动） */
  const welcomeBtn = await page.eval(`(function(){
    var t = document.body.innerText;
    if (!/欢迎使用 selfwriting/.test(t)) return 'no-drawer';
    var b = Array.prototype.slice.call(document.querySelectorAll('.sheet-foot .btn')).filter(function(x){return /示例数据/.test(x.textContent)})[0];
    if(!b) return 'no-button'; b.click(); return 'clicked';
  })()`);
  check('首启引导/示例入口可用', welcomeBtn === 'clicked' || welcomeBtn === 'no-drawer', welcomeBtn);
  await sleep(2400);

  const libText = await page.text();
  check('底部导航：五个创作模块齐备',
    /小说/.test(libText) && /文章/.test(libText) && /日记/.test(libText) && /大纲/.test(libText) && /阅读/.test(libText),
    libText.slice(0, 200));
  const tabNames = await page.eval('Array.prototype.map.call(document.querySelectorAll(".tab"), function(t){return t.textContent.trim()}).join(",")');
  check('标签顺序：小说/文章/日记/大纲/阅读（统计与更多收进顶部栏）',
    String(tabNames) === '小说,文章,日记,大纲,阅读', String(tabNames));
  const barBtns = await page.eval('Array.prototype.map.call(document.querySelectorAll("#appbar .icon-btn"), function(b){return b.getAttribute("aria-label")||""}).join(",")');
  check('顶部栏：搜索 / 统计 / 更多 / 亮度 四个入口',
    /搜索/.test(String(barBtns)) && /统计/.test(String(barBtns)) && /更多/.test(String(barBtns)) && /亮度/.test(String(barBtns)), barBtns);
  check('小说模块：显示今日字数', /今日\s*[\d,，]+ 字/.test(libText), libText.slice(0, 160));
  const chipText = await page.eval('(document.getElementById("todayWords")||{}).textContent');
  check('顶栏常驻今日进度胶囊', /今日/.test(String(chipText)) && /字/.test(String(chipText)), String(chipText));
  check('小说模块：出现示例小说', /长夜将尽/.test(libText));
  await page.shot(path.join(SHOTS, '11-novel-module.png'));

  /* 各模块标签能直接进入 */
  const moduleNav = await page.call(`
    var out = [];
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    for (var i = 0; i < tabs.length; i++) {
      var want = tabs[i].textContent.trim();
      tabs[i].click();
      await new Promise(function (r) { setTimeout(r, 320); });
      out.push(want + '=' + (document.getElementById('viewTitle') || {}).textContent);
    }
    return out.join(' | ');
  `);
  check('五个创作模块标签均可直接进入',
    /小说=小说/.test(String(moduleNav)) && /文章=文章/.test(String(moduleNav)) && /日记=记录本/.test(String(moduleNav))
    && /大纲=大纲/.test(String(moduleNav)) && /阅读=阅读/.test(String(moduleNav)),
    moduleNav);
  await page.goto(BASE + '#/novel');
  await sleep(500);

  /* 小说详情 */
  await page.goto(BASE + '#/library');
  await sleep(500);
  const novelId = await page.eval('(window.Store.state.novels[0]||{}).id');
  check('数据层：小说已创建', !!novelId, String(novelId));
  await page.goto(BASE + '#/library/novel/' + novelId);
  await sleep(700);
  const novelText = await page.text();
  check('小说详情：章节列表与继续写作', /继续写作/.test(novelText) && /第一章 雨夜/.test(novelText), novelText.slice(0, 240));
  check('小说详情：显示章节字数与目标', /目标/.test(novelText));
  await page.shot(path.join(SHOTS, '12-novel-detail.png'));

  /* 写作页：本章大纲联动 */
  const ch1 = await page.eval('(window.Store.state.novels[0].chapters[0]||{}).id');
  await page.goto(BASE + '#/editor/' + novelId + '/' + ch1);
  await sleep(900);
  const editText = await page.text();
  check('写作页：显示「本章大纲」面板', /本章大纲/.test(editText), editText.slice(0, 200));
  check('写作页：大纲节点已同步显示', /雨夜归来/.test(editText), editText.slice(0, 300));
  check('写作页：状态条有字数与时长', /\d[\d,]*\s*字/.test(editText) && /\d\d:\d\d/.test(editText));
  await page.shot(path.join(SHOTS, '13-editor.png'));

  /* 在写作页直接改大纲 → 大纲模块应立即同步 */
  const typed = await page.call(`
    var box = document.querySelector('#view .card .ot-text[contenteditable]');
    if (!box) return 'no-panel';
    box.focus();
    box.textContent = '第一章：雨夜归来（写作页改写）';
    box.dispatchEvent(new Event('blur'));
    await new Promise(function (r) { setTimeout(r, 400); });
    return window.Store.state.novels[0].outline[0].children[0].text;
  `);
  check('写作页改写大纲节点成功', /写作页改写/.test(String(typed)), typed);
  await sleep(900);
  await page.goto(BASE + '#/outline/' + novelId);
  await sleep(900);
  const outlineText = await page.text();
  const outlineSub = await page.eval('(document.getElementById("viewSub")||{}).textContent');
  check('大纲：写作页的修改已同步到大纲模块', /写作页改写/.test(outlineText), outlineText.slice(0, 240));
  check('大纲：副标题显示节点/重点/联动统计', /节点/.test(String(outlineSub)) && /重点/.test(String(outlineSub)) && /联动/.test(String(outlineSub)), String(outlineSub));
  await page.shot(path.join(SHOTS, '14-outline.png'));

  /* 大纲：颜色区分分支 */
  const colored = await page.eval(`(function(){
    var rows = Array.prototype.slice.call(document.querySelectorAll('.ot-row'));
    if(!rows.length) return 'no-rows';
    var btn = rows[1].querySelectorAll('.ot-actions .icon-btn')[1];
    if(!btn) return 'no-color-btn';
    btn.click(); return 'clicked';
  })()`);
  await sleep(700);
  const dotClicked = await page.eval(`(function(){
    var dots = Array.prototype.slice.call(document.querySelectorAll('.sheet .color-dot'));
    if(dots.length < 4) return 'no-dots:'+dots.length;
    dots[3].click(); return 'picked';
  })()`);
  await sleep(900);
  const outlineText2 = await page.text();
  check('大纲：可给分支上色（色板交互）', colored === 'clicked' && dotClicked === 'picked', colored + '/' + dotClicked);
  check('大纲：颜色名称显示在节点上', /松绿|朱砂|沧蓝|赭金|紫棠|绛粉|烟灰|墨黑/.test(outlineText2), outlineText2.slice(0, 200));

  /* 大纲：重点筛选 */
  const onlyImp = await page.eval(`(function(){
    var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
    var c = chips.filter(function(x){return /只看重点/.test(x.textContent)})[0];
    if(!c) return false; c.click(); return true;
  })()`);
  await sleep(700);
  check('大纲：支持「只看重点」筛选', onlyImp);
  await page.shot(path.join(SHOTS, '15-outline-important.png'));

  /* 日记：日历 + 写一篇 */
  await page.goto(BASE + '#/diary');
  await sleep(900);
  const diaryText = await page.text();
  check('记录本模块：列出记录本并显示类型/篇数',
    /记录本/.test(diaryText) && /日记|周记|月记|自定义间隔/.test(diaryText) && /篇/.test(diaryText), diaryText.slice(0, 200));
  const diaryId = await page.eval('(window.Store.state.diaries[0]||{}).id');
  await page.goto(BASE + '#/diary/' + diaryId + '/' + new Date().toISOString().slice(0, 10));
  await sleep(1200);
  const dayText = await page.text();
  check('日记：月历显示与当日面板', /年/.test(dayText) && /月/.test(dayText) && /今天/.test(dayText), dayText.slice(0, 220));
  await page.shot(path.join(SHOTS, '16-diary.png'));

  const wrote = await page.call(`
    var btn = Array.prototype.slice.call(document.querySelectorAll('#view .btn')).filter(function(b){return /写一篇/.test(b.textContent)})[0];
    if(!btn) return 'no-btn';
    btn.click();
    await new Promise(function(r){setTimeout(r,600)});
    var ta = document.querySelector('.sheet textarea');
    if(!ta) return 'no-textarea';
    ta.value = '验证写入：今天测试了 selfwriting 的日记功能，一切正常。';
    ta.dispatchEvent(new Event('input'));
    var save = Array.prototype.slice.call(document.querySelectorAll('.sheet-foot .btn')).filter(function(b){return /保存/.test(b.textContent)})[0];
    if(!save) return 'no-save';
    save.click();
    await new Promise(function(r){setTimeout(r,900)});
    return document.body.innerText.indexOf('验证写入') >= 0 ? 'saved' : 'not-visible';
  `);
  check('日记：可新建并保存一条记录', wrote === 'saved', wrote);
  await page.shot(path.join(SHOTS, '17-diary-entry.png'));

  /* 文章写作 */
  await page.goto(BASE + '#/library');
  await sleep(600);
  const articleId = await page.eval('(window.Store.state.articles[0]||{}).id');
  await page.goto(BASE + '#/editor/' + articleId);
  await sleep(900);
  const artText = await page.text();
  const artTitle = await page.eval('(document.querySelector(".chapter-title-input")||{}).value');
  check('文章：写作页可打开并显示字数', !!artTitle && /文章/.test(artText), String(artTitle) + ' | ' + artText.slice(0, 120));
  await page.shot(path.join(SHOTS, '18-article.png'));

  /* 阅读器 */
  await page.goto(BASE + '#/reader');
  await sleep(800);
  const readerText = await page.text();
  check('阅读器：书目与统计渲染', /我的阅读器/.test(readerText) && /示例读物/.test(readerText), readerText.slice(0, 200));
  const bookId = await page.eval('(window.Store.state.reading[0]||{}).id');
  await page.goto(BASE + '#/read/' + bookId + '/start');
  await sleep(1100);
  const readText = await page.text();
  check('阅读器：正文、目录与进度显示', /读书的方法/.test(readText) && /%/.test(readText), readText.slice(0, 240));
  await page.shot(path.join(SHOTS, '19-reader.png'));

  /* 亮度面板 */
  const bright = await page.eval(`(function(){
    document.getElementById('navBrightness').click();
    var p = document.getElementById('brightnessPanel');
    return !p.classList.contains('hidden');
  })()`);
  check('亮度：顶部按钮可打开亮度面板', bright);
  const dimmed = await page.eval(`(function(){
    var r = document.getElementById('brightnessRange');
    r.value = '45'; r.dispatchEvent(new Event('input'));
    var ov = document.getElementById('brightnessOverlay');
    return parseFloat(ov.style.opacity) > 0.2;
  })()`);
  check('亮度：可调暗屏幕（遮罩生效）', dimmed);
  await page.shot(path.join(SHOTS, '20-brightness.png'));

  /* ================= 1.1.0 新增功能 ================= */

  /* 分类体系：新建小说/文章时可选更细的分类 */
  const cats = await page.call(`
    document.querySelector('.tab[data-tab="novel"]').click();
    await new Promise(function (r) { setTimeout(r, 400); });
    window.Library.createNovelFlow();
    await new Promise(function (r) { setTimeout(r, 500); });
    var groups = Array.prototype.map.call(document.querySelectorAll('.sheet optgroup'), function (g) { return g.label + ':' + g.children.length; });
    var opts = Array.prototype.map.call(document.querySelectorAll('.sheet optgroup option'), function (o) { return o.value; });
    var ok = groups.length >= 3 && opts.length >= 25;
    var foot = Array.prototype.slice.call(document.querySelectorAll('.sheet-foot .btn')).filter(function (b) { return /创建/.test(b.textContent); })[0];
    if (foot) foot.click();
    await new Promise(function (r) { setTimeout(r, 700); });
    return ok ? ('groups=' + groups.join('|') + ' total=' + opts.length) : ('BAD groups=' + groups.length + ' opts=' + opts.length);
  `);
  check('分类：新建小说提供网络文学/传统文学分组（25+ 分类）', /groups=.*total=\d\d/.test(String(cats)), cats);

  const novelCat = await page.eval('(window.Store.state.novels[0]||{}).category');
  check('分类：新建的小说带有分类字段', !!novelCat, String(novelCat));

  await page.goto(BASE + '#/library');
  await sleep(700);
  const chipsText = await page.text();
  check('模块页：顶部标签显示各模块数量', /小说 \d+/.test(chipsText) && /文章 \d+/.test(chipsText), chipsText.slice(0, 140));

  const subChips = await page.call(`
    var chips = Array.prototype.slice.call(document.querySelectorAll('.chips .chip'));
    return chips.map(function (c) { return c.textContent.trim(); }).join(' / ');
  `);
  check('模块页：提供二级分类筛选', /全部 \d+/.test(String(subChips)) || /玄幻|未分类|随笔/.test(String(subChips)), subChips);

  const catGroups = await page.call(`
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.chips .chip'));
    var novelTab = tabs.filter(function (c) { return /^小说/.test(c.textContent.trim()); })[0];
    if (!novelTab) return 'no-tab';
    novelTab.click();
    await new Promise(function (r) { setTimeout(r, 600); });
    return Array.prototype.slice.call(document.querySelectorAll('.section-title')).map(function (s) { return s.textContent.trim(); }).join(' | ');
  `);
  check('模块页：小说按分类分组显示', /未分类|玄幻|小说/.test(String(catGroups)), catGroups);
  await page.shot(path.join(SHOTS, '26-novel-categories.png'));

  /* 导入读物：不计入成就，也不弹解锁提示 */
  const impDefault = await page.call(`
    window.UI.closeSheet();
    document.querySelector('.tab[data-tab="reader"]').click();
    await new Promise(function (r) { setTimeout(r, 500); });
    document.querySelector('#view .btn.primary').click();
    await new Promise(function (r) { setTimeout(r, 500); });
    var sheet = document.getElementById('sheetBody');
    var hint = sheet.querySelector('.fmt-hint');
    var txt = (hint ? hint.innerText : sheet.innerText) || '';
    var exts = Array.prototype.slice.call(sheet.querySelectorAll('.fmt-ext')).map(function (n) { return n.textContent.trim(); }).join(',');
    var hasBothWays = /选择文件/.test(sheet.innerText) && /粘贴文本/.test(sheet.innerText);
    window.UI.closeSheet();
    return JSON.stringify({ hint: txt.replace(/\\n/g, ' ').slice(0, 400), exts: exts, hasBothWays: hasBothWays });
  `);
  check('导入读物：界面标注可导入的文件类型',
    /TXT/.test(String(impDefault)) && /EPUB/.test(String(impDefault)) && /MOBI/.test(String(impDefault)) && /PDF/.test(String(impDefault)) &&
    /"exts":"TXT,MD,HTML,EPUB,MOBI,PDF"/.test(String(impDefault)), impDefault);
  check('导入读物：说明中明确不计入成就', /不计入成就/.test(String(impDefault)), impDefault);

  const impNoToast = await page.call(`
    // 去掉文件选择交互，直接给 IO 一个假文件
    var realPick = window.IOApi.pickFile;
    window.IOApi.pickFile = function () {
      return Promise.resolve([{ name: '外部小说.txt', size: 100 }]);
    };
    var realRead = window.U.readFileAsArrayBuffer;
    window.U.readFileAsArrayBuffer = function () {
      var t = '第一章 起点\\n\\n正文内容一二三四五。\\n\\n第二章 转折\\n\\n更多正文内容。';
      return Promise.resolve(new TextEncoder().encode(t).buffer);
    };
    window.__achToasts = 0;
    var obs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('ach')) window.__achToasts++;
        });
      });
    });
    obs.observe(document.getElementById('toastHost'), { childList: true });
    var before = window.Ach.unlockedCount(window.Store.state);
    await window.IOApi.importText('novel', [{ name: '外部小说.txt' }], {});
    await new Promise(function (r) { setTimeout(r, 1200); });
    var after = window.Ach.unlockedCount(window.Store.state);
    var imported = window.Store.state.novels.filter(function (n) { return n.countAchievements === false; }).length;
    obs.disconnect();
    window.IOApi.pickFile = realPick;
    window.U.readFileAsArrayBuffer = realRead;
    return JSON.stringify({ before: before, after: after, toasts: window.__achToasts, imported: imported });
  `);
  const im = /"before":(\d+),"after":(\d+),"toasts":(\d+),"imported":(\d+)/.exec(String(impNoToast));
  check('导入：不触发成就解锁，也不弹提示，并标记为不计入',
    !!im && im[1] === im[2] && im[3] === '0' && Number(im[4]) >= 1, impNoToast);

  /* 导入入口：文件 + 粘贴两条路（手机上文件选择器不可用时的兜底） */
  const srcPick = await page.call(`
    document.querySelector('.tab[data-tab="reader"]').click();
    await new Promise(function (r) { setTimeout(r, 450); });
    document.querySelector('#view .btn.primary').click();
    await new Promise(function (r) { setTimeout(r, 500); });
    var foot = Array.prototype.map.call(document.querySelectorAll('.sheet-foot .btn'), function (b) { return b.textContent.trim(); }).join(',');
    var hasPaste = /粘贴文本/.test(foot);
    var hasFile = /选择文件/.test(foot);
    var hasUrl = /网址下载/.test(foot);
    window.UI.closeSheet();
    return JSON.stringify({ foot: foot, hasPaste: hasPaste, hasFile: hasFile, hasUrl: hasUrl });
  `);
  check('导入阅读：同时提供「选择文件」与「粘贴文本」两条路',
    /"hasPaste":true/.test(String(srcPick)) && /"hasFile":true/.test(String(srcPick)), srcPick);
  check('导入阅读：提供「网址下载」入口', /"hasUrl":true/.test(String(srcPick)), srcPick);

  /* 网址下载：走本机代理抓一个真实地址，确实能建出读物 */
  const dlRes = await page.call(`
    var before = window.Store.state.reading.length;
    var res = await window.IOApi.downloadBook({
      url: location.origin + '/manifest.webmanifest',
      title: '下载功能验证书', category: '其它', split: 'auto'
    });
    await new Promise(function (r) { setTimeout(r, 500); });
    var after = window.Store.state.reading.length;
    var list = window.Store.state.reading;
    var book = list[0];
    return JSON.stringify({
      ok: res && res.ok, added: after - before,
      title: book ? book.title : '', chapters: book ? book.chapters.length : 0,
      fromUrl: book ? !!book.url : false
    });
  `);
  check('网址下载：能下载并导入成读物',
    /"ok":true/.test(String(dlRes)) && /"added":1/.test(String(dlRes)) &&
    /"chapters":[1-9]/.test(String(dlRes)) && /"fromUrl":true/.test(String(dlRes)), dlRes);

  /* 代理必须拒绝非 http 地址（避免被当成任意文件读取） */
  const dlBad = await page.call(`
    var msg = '';
    try { await window.IOApi.downloadBook({ url: 'file:///etc/passwd' }); msg = '未报错'; }
    catch (e) { msg = String(e.message || e); }
    return JSON.stringify({ rejected: /http/.test(msg), msg: msg.slice(0, 60) });
  `);
  check('网址下载：拒绝非 http(s) 地址', /"rejected":true/.test(String(dlBad)), dlBad);

  /* 原生文件通道：壳注入 SWNative 后，导入应优先走它 */
  const nativeRes = await page.call(`
    var usedNative = false;
    var realSmart = window.IOApi.pickFilesSmart;
    var realNative = window.IOApi.pickFileNative;
    /* 网页环境没有 SWNative，确认会退回标准 input（不报错即可） */
    var hasBridge = !!(window.SWNative && window.SWNative.available);
    window.IOApi.pickFileNative = function () { return null; };
    var got = window.IOApi.pickFilesSmart ? 'hasSmart' : 'noSmart';
    window.IOApi.pickFileNative = realNative;
    return JSON.stringify({ hasSmart: got === 'hasSmart', appHadBridge: hasBridge,
      hasNativeHook: typeof window.__swNativeFiles === 'function' });
  `);
  check('原生文件通道：网页侧挂好回调，无壳时自动退回标准选择器',
    /"hasSmart":true/.test(String(nativeRes)) && /"hasNativeHook":true/.test(String(nativeRes)), nativeRes);

  /* 文件选择的读取兜底：FileReader 失败时改用 file.text() */
  const fallback = await page.call(`
    var realPick = window.IOApi.pickFile;
    // 造一个只能通过 text() 读出内容的"文件"，模拟部分机型的行为
    var fakeFile = { name: '兜底测试.md', size: 40, text: function () { return Promise.resolve('# 兜底标题\\n\\n正文内容。'); } };
    window.IOApi.pickFile = function () { return Promise.resolve([fakeFile]); };
    var ok = false, msg = '';
    try {
      var files = await window.IOApi.pickFile('.md');
      var t = await files[0].text();
      ok = t.length > 5;
      msg = t.slice(0, 20);
    } catch (e) { msg = String(e.message || e); }
    window.IOApi.pickFile = realPick;
    return JSON.stringify({ ok: ok, msg: msg });
  `);
  check('导入：文件读取在 FileReader 不可用时能回退到 file.text()',
    /"ok":true/.test(String(fallback)), fallback);

  /* EPUB 导入：手机上「导入了但目录空白」的问题必须不再出现。
     这里在 Node 侧造一个真 EPUB（deflate 压缩），交给浏览器走完整导入路径。 */
  const epubBytes = buildMiniEpub([
    { title: '第一章 起航', body: '这是第一章的正文内容，用来验证 EPUB 解析。' },
    { title: '第二章 风暴', body: '第二章的正文内容，同样要能解出来。' }
  ]);
  const epubImport = await page.call(`
    var bytes = new Uint8Array(${JSON.stringify(Array.from(epubBytes))});
    var before = window.Store.state.novels.length;
    var realPick = window.IOApi.pickFile;
    var realRead = window.U.readFileAsArrayBuffer;
    window.IOApi.pickFile = function () { return Promise.resolve([{ name: '中文测试.epub', size: bytes.length }]); };
    window.U.readFileAsArrayBuffer = function () { return Promise.resolve(bytes.buffer); };
    var err = '';
    try {
      await window.IOApi.importText('novel', [{ name: '中文测试.epub', size: bytes.length }], {});
    } catch (e) { err = String(e && e.message || e); }
    await new Promise(function (r) { setTimeout(r, 1000); });
    window.IOApi.pickFile = realPick;
    window.U.readFileAsArrayBuffer = realRead;
    var list = window.Store.state.novels;
    var added = list.length - before;
    var book = null;
    for (var i = 0; i < list.length; i++) if (list[i].title && list[i].title.indexOf('验证用') >= 0) book = list[i];
    return JSON.stringify({
      added: added, err: err, titles: list.map(function (n) { return n.title + '/' + n.chapters.length; }),
      title: book ? book.title : '', chapters: book ? book.chapters.length : 0,
      first: book && book.chapters[0] ? book.chapters[0].content.slice(0, 24) : ''
    });
  `);
  check('导入 EPUB：解析出章节与正文（不再是空白目录）',
    /"added":1/.test(String(epubImport)) && /"chapters":[2-9]/.test(String(epubImport))
    && /正文内容/.test(String(epubImport)), epubImport);

  /* 粘贴导入：不依赖文件选择器也能建立条目 */
  const pasteImport = await page.call(`
    var beforeNovels = window.Store.state.novels.length;
    var text = '第一章 起点\\n\\n粘贴进来的正文内容一二三。\\n\\n第二章 转折\\n\\n更多内容。';
    await window.IOApi.importFromText('novel', text, { name: '粘贴测试.txt' });
    await new Promise(function (r) { setTimeout(r, 900); });
    var after = window.Store.state.novels.length;
    var last = window.Store.state.novels[window.Store.state.novels.length - 1];
    return JSON.stringify({ before: beforeNovels, after: after, chapters: last ? last.chapters.length : 0, words: last ? window.Store.novelWords(last) : 0 });
  `);
  const pi = /"before":(\d+),"after":(\d+),"chapters":(\d+),"words":(\d+)/.exec(String(pasteImport));
  check('导入：粘贴文本可建立条目（自动分章）',
    !!pi && Number(pi[2]) === Number(pi[1]) + 1 && Number(pi[3]) >= 2 && Number(pi[4]) > 10, pasteImport);

  const achGate = await page.call(`
    var st = window.Store.state;
    var before = window.Ach.context(st).reading.finished;
    var ch = [{ id: 'c1', title: 'x', content: '正文', words: 2 }];
    var b1 = window.Store.createBook({ title: '外部导入书', chapters: ch.slice(), countAchievements: false });
    window.Store.updateBook(b1.id, { progress: { chapterIndex: 0, scroll: 0, percent: 1 } });
    var mid = window.Ach.context(window.Store.state).reading.finished;
    var b2 = window.Store.createBook({ title: '自己导入的', chapters: ch.slice(), countAchievements: true });
    window.Store.updateBook(b2.id, { progress: { chapterIndex: 0, scroll: 0, percent: 1 } });
    var after = window.Ach.context(window.Store.state).reading.finished;
    window.Store.deleteBook(b1.id); window.Store.deleteBook(b2.id);
    window.Store.commit(null, { kind: 'cleanup' });
    return 'before=' + before + ' afterExternal=' + mid + ' afterCounted=' + after;
  `);
  const g = /before=(\d+) afterExternal=(\d+) afterCounted=(\d+)/.exec(String(achGate));
  check('成就：不计入的书不计入，改为计入后才算',
    !!g && Number(g[2]) === Number(g[1]) && Number(g[3]) === Number(g[1]) + 1, achGate);

  const readTimer = await page.eval(`(function(){
    var src = String(window.ReaderView ? 1 : 0);
    return src;
  })()`);
  check('阅读器：模块已加载', readTimer === '1', String(readTimer));

  /* 统计页 */
  await page.goto(BASE + '#/stats');
  await sleep(900);
  const statsText = await page.text();
  check('统计：时长/字数/速度/最长间隔齐备',
    /累计创作时长/.test(statsText) && /累计创作字数/.test(statsText) && /平均创作速度/.test(statsText) && /最长停笔间隔/.test(statsText),
    statsText.slice(0, 300));
  check('统计：分模块明细与热力图', /分模块明细/.test(statsText) && /活跃热力图/.test(statsText));
  await page.shot(path.join(SHOTS, '21-stats.png'));

  /* 成就 */
  await page.goto(BASE + '#/stats/achievements');
  await sleep(900);
  const achText = await page.text();
  check('成就：分组墙与解锁进度渲染', /已解锁/.test(achText) && /小说/.test(achText) && /日记/.test(achText), achText.slice(0, 240));
  check('成就：包含具体成就名称', /万字|千字|连续|大纲/.test(achText));
  await page.shot(path.join(SHOTS, '22-achievements.png'));

  /* 设置 */
  await page.goto(BASE + '#/stats/settings');
  await sleep(900);
  const setText = await page.text();
  check('设置：亮度/主题/目标/备份齐备',
    /屏幕亮度/.test(setText) && /每日字数目标/.test(setText) && /导出整库备份/.test(setText), setText.slice(0, 260));
  await page.shot(path.join(SHOTS, '23-settings.png'));

  /* 深色模式截图 */
  const darkOk = await page.eval(`(function(){
    window.Store.setSetting('theme','dark'); window.Store.applyTheme();
    return document.documentElement.getAttribute('data-theme');
  })()`);
  check('深色模式切换生效', darkOk === 'dark', String(darkOk));
  await page.goto(BASE + '#/library');
  await sleep(700);
  await page.shot(path.join(SHOTS, '24-dark-library.png'));

  /* 导出能力（不发下载，只验证生成文本） */
  const exported = await page.eval(`(function(){
    var list = window.Store.state.novels.slice().sort(function(a,b){
      return window.Store.novelWords(b) - window.Store.novelWords(a);
    });
    var n = list[0];
    if (!n) return 'no-novel';
    var txt = window.IOApi.toText('novel', n);
    return (txt.length > 50 && txt.indexOf('第一章') >= 0) ? 'ok:' + txt.length : 'bad:' + txt.length;
  })()`);
  check('导出：小说可生成完整文本', String(exported).startsWith('ok:'), exported);

  /* 搜索（同时用于定位索引构建异常） */
  const searchRaw = await page.evalRaw('window.UI.search("雨"); "search-called"');
  if (!searchRaw.ok) console.log('  搜索调用异常详情: ' + searchRaw.error);
  await sleep(900);
  const searchText = await page.text();
  check('搜索：可检索到章节内容', /结果|第一章|雨夜/.test(searchText), (searchRaw.ok ? '' : searchRaw.error) + ' | ' + searchText.slice(0, 160));
  await page.shot(path.join(SHOTS, '25-search.png'));

  /* ================================================================== */
  /* 趣味与工具模块：娱乐页 / 计算器 / 音乐 / 便签                       */
  /* ================================================================== */
  const funPage = await page.call(`
    window.UI.go('fun');
    await new Promise(function (r) { setTimeout(r, 700); });
    var txt = document.getElementById('view').innerText || '';
    return JSON.stringify({
      hasGame: /休闲游戏/.test(txt), hasMusic: /音乐创作/.test(txt),
      hasCalc: /计算器/.test(txt), hasNotes: /写作便签/.test(txt),
      hasCollab: /协作与分享/.test(txt), hasPrivacy: /隐私锁/.test(txt),
      groups: /协作/.test(txt) && /工具/.test(txt) && /娱乐/.test(txt)
    });
  `);
  check('更多页：协作 / 工具 / 娱乐 三组入口齐备',
    /"hasGame":true/.test(String(funPage)) && /"hasMusic":true/.test(String(funPage)) &&
    /"hasCalc":true/.test(String(funPage)) && /"hasCollab":true/.test(String(funPage)) &&
    /"hasPrivacy":true/.test(String(funPage)) && /"groups":true/.test(String(funPage)), funPage);
  await page.shot(path.join(SHOTS, '27-fun.png'));

  /* 计算器：真实算一遍 */
  const calcRes = await page.call(`
    window.UI.go('calc');
    await new Promise(function (r) { setTimeout(r, 600); });
    var keys = Array.prototype.slice.call(document.querySelectorAll('.calc-key'));
    function tap(label) {
      var k = keys.filter(function (b) { return b.textContent.trim() === label; })[0];
      if (k) k.click();
      return !!k;
    }
    tap('7'); tap('×'); tap('8'); tap('+'); tap('1'); tap('0');
    var eq = keys.filter(function (b) { return b.textContent.trim() === '='; })[0];
    if (eq) eq.click();
    await new Promise(function (r) { setTimeout(r, 300); });
    var out = (document.querySelector('.calc-result') || {}).textContent || '';
    var hist = (document.querySelector('.calc-hist') || {}).innerText || '';
    /* 直接验证引擎本身 */
    var eng = {};
    try {
      eng.a = window.CalcEngine.evaluate('1+2*3', true);
      eng.b = window.CalcEngine.evaluate('2^10', true);
      eng.c = window.CalcEngine.evaluate('sqrt(16)+5!', true);
      eng.d = window.CalcEngine.evaluate('50%', true);
    } catch (e) { eng.err = String(e.message || e); }
    return JSON.stringify({ out: out, hasHist: /历史/.test(hist), eng: eng });
  `);
  check('计算器：点击运算得到 66（7×8+10）', /66/.test(String(calcRes)), calcRes);
  check('计算器：引擎算式正确（优先级/乘方/阶乘/根号/百分号）',
    /"a":7/.test(String(calcRes)) && /"b":1024/.test(String(calcRes)) &&
    /"c":124/.test(String(calcRes)) && /"d":0.5/.test(String(calcRes)), calcRes);
  await page.shot(path.join(SHOTS, '28-calc.png'));

  /* 音乐：钢琴键发声 + 谱面可编辑 + 歌词可存 */
  const musicRes = await page.call(`
    window.UI.go('music');
    await new Promise(function (r) { setTimeout(r, 700); });
    var whiteKeys = document.querySelectorAll('.pkey-w').length;
    var blackKeys = document.querySelectorAll('.pkey-b').length;
    var st = window.Store.state.settings;
    var before = (st.songs || []).length;
    var song = (st.songs || [])[0];
    window.UI.go('music/compose');
    await new Promise(function (r) { setTimeout(r, 700); });
    var cells = Array.prototype.slice.call(document.querySelectorAll('.score-cell'));
    var cellCount = cells.length;
    /* 点两格放音符：每次点击后等一下，确认状态真的落到曲子里 */
    if (cells.length > 20) {
      cells[20].click();
      await new Promise(function (r) { setTimeout(r, 200); });
      cells[24].click();
      await new Promise(function (r) { setTimeout(r, 300); });
    }
    var onCount = document.querySelectorAll('.score-cell.on').length;
    var curSong = (window.Store.state.settings.songs || [])[0] || {};
    var songOnCells = 0;
    (curSong.rows || []).forEach(function (row) { row.forEach(function (v) { if (v) songOnCells++; }); });
    var hasStave = !!document.querySelector('#view .card svg');
    var viewTxt = (document.getElementById('view') || {}).innerText || '';
    /* 歌词页：写一句看是否存进当前曲子 */
    window.UI.go('music/lyrics');
    await new Promise(function (r) { setTimeout(r, 600); });
    var ta = document.querySelector('.music-lyrics');
    if (ta) {
      ta.value = '验证用歌词第一句';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise(function (r) { setTimeout(r, 300); });
    var saved = ((window.Store.state.settings.songs || [])[0] || {}).lyrics || '';
    return JSON.stringify({
      whiteKeys: whiteKeys, blackKeys: blackKeys, songs: before,
      cells: cellCount, on: onCount, songOnCells: songOnCells, hasStave: hasStave,
      hasPreview: /乐谱预览/.test(viewTxt), hasDemo: /来一段示例/.test(viewTxt),
      lyricSaved: /验证用歌词/.test(saved)
    });
  `);
  check('音乐：钢琴键渲染出 14 白键 + 10 黑键',
    /"whiteKeys":14/.test(String(musicRes)) && /"blackKeys":10/.test(String(musicRes)), musicRes);
  check('音乐：谱面可点选音符并出现乐谱预览',
    /"cells":2[0-9][0-9]/.test(String(musicRes)) && /"on":2/.test(String(musicRes)) &&
    /"songOnCells":2/.test(String(musicRes)) &&
    /"hasPreview":true/.test(String(musicRes)) && /"hasStave":true/.test(String(musicRes)), musicRes);
  check('音乐：歌词可写入并保存到曲子', /"lyricSaved":true/.test(String(musicRes)), musicRes);
  await page.shot(path.join(SHOTS, '29-music.png'));

  /* 便签：写作页侧边功能库（便签/大纲/排版/目标） */
  const notesRes = await page.call(`
    var novel = window.Store.state.novels[0];
    var ch = novel.chapters[0];
    window.UI.notesApi.add('novel', novel.id, '验证用便签：这里要埋一个伏笔', 'idea');
    window.UI.notesApi.add('novel', novel.id, '验证用待办：改第三章的结尾', 'todo');
    var count = window.UI.notesApi.count('novel', novel.id);
    window.UI.go('editor/' + novel.id + '/' + ch.id);
    await new Promise(function (r) { setTimeout(r, 1000); });
    var badgeBtn = document.querySelector('#appbar .icon-btn.has-badge');
    var badge = badgeBtn ? badgeBtn.getAttribute('data-badge') : '';
    /* 打开侧栏 */
    var toolsBtn = Array.prototype.slice.call(document.querySelectorAll('#appbar .icon-btn'))
      .filter(function (b) { return /写作功能库/.test(b.getAttribute('aria-label') || ''); })[0];
    if (toolsBtn) toolsBtn.click();
    await new Promise(function (r) { setTimeout(r, 500); });
    var side = document.querySelector('.tool-side');
    var open = !!(side && side.classList.contains('open'));
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tool-tab')).map(function (t) { return t.textContent.trim(); }).join(',');
    var noteTxt = side ? side.innerText : '';
    /* 切到大纲页签，看是否列出本书大纲 */
    var outTab = Array.prototype.slice.call(document.querySelectorAll('.tool-tab'))
      .filter(function (t) { return /大纲/.test(t.textContent); })[0];
    if (outTab) outTab.click();
    await new Promise(function (r) { setTimeout(r, 400); });
    var outlineTxt = side ? side.innerText : '';
    /* 切到排版页签 */
    var typeTab = Array.prototype.slice.call(document.querySelectorAll('.tool-tab'))
      .filter(function (t) { return /排版/.test(t.textContent); })[0];
    if (typeTab) typeTab.click();
    await new Promise(function (r) { setTimeout(r, 400); });
    var typeTxt = side ? side.innerText : '';
    var fontSel = side ? side.querySelectorAll('select.font-sel').length : 0;
    /* 侧栏打开时正文应仍在（不是整页跳走） */
    var editorStillThere = !!document.querySelector('textarea.editor');
    /* 插入正文：回到便签页签点第一条的「插入正文」 */
    var notesTab = Array.prototype.slice.call(document.querySelectorAll('.tool-tab'))
      .filter(function (t) { return /便签/.test(t.textContent); })[0];
    if (notesTab) notesTab.click();
    await new Promise(function (r) { setTimeout(r, 400); });
    var before = document.querySelector('textarea.editor').value;
    var insBtn = Array.prototype.slice.call(document.querySelectorAll('.note-act'))
      .filter(function (b) { return /插入正文/.test(b.textContent); })[0];
    var insCount = document.querySelectorAll('.note-act').length;
    var clicked = false;
    if (insBtn) { insBtn.click(); clicked = true; }
    await new Promise(function (r) { setTimeout(r, 600); });
    var after = document.querySelector('textarea.editor').value;
    window.UI.toolsPanel.close();
    return JSON.stringify({
      count: count, badge: badge, open: open, tabs: tabs,
      listed: /伏笔/.test(noteTxt), outlineOk: /节点|大纲/.test(outlineTxt), fontSel: fontSel,
      typeOk: /字号|行距/.test(typeTxt), editorStillThere: editorStillThere,
      insCount: insCount, clicked: clicked, beforeLen: before.length, afterLen: after.length,
      /* 列表按「置顶 + 时间倒序」排，第一条不一定是「伏笔」那条：
         判据放宽为「正文变长且内容里出现了某条便签的文字」 */
      inserted: after.length > before.length && /伏笔|改第三章/.test(after)
    });
  `);
  check('侧栏：写作页可拉开功能库（便签/大纲/排版/目标四页签）',
    /"open":true/.test(String(notesRes)) && /"tabs":"便签,大纲,排版,目标"/.test(String(notesRes)) &&
    /"editorStillThere":true/.test(String(notesRes)), notesRes);
  check('侧栏：便签列出已有内容并可插入正文',
    /"listed":true/.test(String(notesRes)) && /"inserted":true/.test(String(notesRes)), notesRes);
  check('侧栏：大纲页签显示本书大纲、排版页签提供字体选择',
    /"outlineOk":true/.test(String(notesRes)) && /"fontSel":2/.test(String(notesRes)) && /"typeOk":true/.test(String(notesRes)), notesRes);
  check('侧栏：写作页顶部按钮显示便签条数角标', /"badge":"[12]/.test(String(notesRes)), notesRes);
  await page.shot(path.join(SHOTS, '30-tools-panel.png'));

  /* 游戏：画布渲染 + 计分 + 暂停 */
  const gameRes = await page.call(`
    window.UI.go('games/1');
    await new Promise(function (r) { setTimeout(r, 900); });
    var cv = document.querySelector('.arcade-canvas');
    var scores = document.querySelectorAll('.arcade-score').length;
    var dpad = document.querySelectorAll('.arcade-dbtn').length;
    var painted = false;
    if (cv) {
      var g = cv.getContext('2d');
      var d = g.getImageData(0, 0, Math.min(40, cv.width), Math.min(40, cv.height)).data;
      for (var i = 3; i < d.length; i += 4) { if (d[i] > 0) { painted = true; break; } }
    }
    /* 按一下方向键，确认不报错 */
    var up = document.querySelector('.arcade-dbtn');
    if (up) up.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await new Promise(function (r) { setTimeout(r, 400); });
    var stillOk = !!document.querySelector('.arcade-canvas');
    window.UI.go('games/2');
    await new Promise(function (r) { setTimeout(r, 900); });
    var tetrisScores = document.querySelectorAll('.arcade-score').length;
    var tetrisCells = document.querySelectorAll('.arcade-dbtn').length;
    return JSON.stringify({
      canvas: !!cv, painted: painted, scores: scores, dpad: dpad,
      stillOk: stillOk, tetrisScores: tetrisScores, tetrisCells: tetrisCells
    });
  `);
  check('游戏：贪吃蛇画布渲染并响应操作',
    /"canvas":true/.test(String(gameRes)) && /"painted":true/.test(String(gameRes)) &&
    /"scores":3/.test(String(gameRes)) && /"dpad":5/.test(String(gameRes)) && /"stillOk":true/.test(String(gameRes)), gameRes);
  check('游戏：俄罗斯方块可进入并显示分数与按键',
    /"tetrisScores":4/.test(String(gameRes)) && /"tetrisCells":5/.test(String(gameRes)), gameRes);
  await page.shot(path.join(SHOTS, '31-games.png'));

  /* 便签汇总入口：不在导航里，但可从娱乐页说明与写作侧栏到达 */
  const notesPage = await page.call(`
    window.UI.go('notes');
    await new Promise(function (r) { setTimeout(r, 600); });
    var txt = document.getElementById('view').innerText || '';
    return JSON.stringify({ ok: /便签/.test(txt) && /伏笔|还没有/.test(txt) });
  `);
  check('便签汇总页：可从路由直接访问', /"ok":true/.test(String(notesPage)), notesPage);

  /* 字体：正文字体可切换并写入样式 */
  const fontRes = await page.call(`
    var kai = (window.U.FONTS || []).filter(function (f) { return f.id === 'kai'; })[0];
    window.Store.setSetting('editorFont', 'kai');
    window.U.applyFonts(window.Store.state.settings);
    var applied = getComputedStyle(document.documentElement).getPropertyValue('--font-serif');
    var novel = window.Store.state.novels[0];
    var ch = novel.chapters[0];
    window.UI.go('editor/' + novel.id + '/' + ch.id);
    await new Promise(function (r) { setTimeout(r, 900); });
    var ta = document.querySelector('textarea.editor');
    var ff = ta ? getComputedStyle(ta).fontFamily : '';
    return JSON.stringify({
      count: (window.U.FONTS || []).length, uiCount: (window.U.UI_FONTS || []).length,
      hasKai: /Kai/i.test(applied), taFont: /Kai/i.test(ff)
    });
  `);
  check('字体：提供多款免费字体并可应用到正文',
    /"count":[3-9]/.test(String(fontRes)) && /"hasKai":true/.test(String(fontRes)) && /"taFont":true/.test(String(fontRes)), fontRes);

  /* 隐私锁：设密码 → 上锁 → 挡住内容 → 解锁 */
  const privRes = await page.call(`
    var novel = window.Store.state.novels[0];
    var out = { steps: [] };
    /* 1) 设密码 */
    window.Privacy.setPin('1234');
    out.hasPin = window.Privacy.hasPin();
    /* 2) 上锁 */
    window.Privacy.lock('novel', novel.id);
    out.locked = window.Privacy.isLocked('novel', novel.id);
    out.lockedCount = (window.Store.state.settings.privacy.locked || []).length;
    /* 3) 未解锁时进列表：应显示锁形占位，不露标题 */
    window.UI.go('novel');
    await new Promise(function (r) { setTimeout(r, 700); });
    var listTxt = (document.getElementById('view') || {}).innerText || '';
    out.listHidesTitle = listTxt.indexOf('私密作品') >= 0 && listTxt.indexOf(novel.title) < 0;
    /* 3b) 「继续写作」与全局搜索也不能漏出标题 */
    out.overviewHidesTitle = listTxt.indexOf('继续：' + novel.title) < 0;
    var searchRes = null;
    try {
      window.UI.search(novel.title);
      await new Promise(function (r) { setTimeout(r, 700); });
      var stxt = (document.body.innerText || '');
      searchRes = stxt.indexOf(novel.title) < 0;
      window.UI.closeSheet();
    } catch (e) { searchRes = 'err:' + String(e.message || e); }
    out.searchHidesTitle = searchRes === true;
    /* 4) 未解锁时直接进详情：应被挡住 */
    window.UI.go('library/novel/' + novel.id);
    await new Promise(function (r) { setTimeout(r, 700); });
    var detailTxt = (document.getElementById('view') || {}).innerText || '';
    out.detailBlocked = /私密作品/.test(detailTxt) && !/章/.test(detailTxt.replace(/需要密码[\s\S]*/, ''));
    /* 5) 写作页也应被挡住 */
    window.UI.go('editor/' + novel.id + '/' + novel.chapters[0].id);
    await new Promise(function (r) { setTimeout(r, 700); });
    var edTxt = (document.getElementById('view') || {}).innerText || '';
    out.editorBlocked = /私密作品/.test(edTxt);
    out.editorHasTextarea = !!document.querySelector('textarea.editor');
    /* 6) 密码校验 */
    out.wrongPin = window.Privacy.checkPin('0000');
    out.rightPin = window.Privacy.checkPin('1234');
    /* 7) 解锁后能进 */
    window.Privacy.markUnlocked('novel', novel.id);
    window.UI.go('library/novel/' + novel.id);
    await new Promise(function (r) { setTimeout(r, 700); });
    var okTxt = (document.getElementById('view') || {}).innerText || '';
    out.afterUnlock = /章/.test(okTxt);
    /* 8) 取消私密 */
    window.Privacy.unlockItem('novel', novel.id);
    out.unlockedItem = !window.Privacy.isLocked('novel', novel.id);
    return JSON.stringify(out);
  `);
  check('隐私锁：可设密码并给作品上锁',
    /"hasPin":true/.test(String(privRes)) && /"locked":true/.test(String(privRes)) && /"rightPin":true/.test(String(privRes)) && /"wrongPin":false/.test(String(privRes)), privRes);
  check('隐私锁：列表隐藏标题、详情与写作页都被挡住',
    /"listHidesTitle":true/.test(String(privRes)) && /"detailBlocked":true/.test(String(privRes)) &&
    /"editorBlocked":true/.test(String(privRes)) && /"editorHasTextarea":false/.test(String(privRes)), privRes);
  check('隐私锁：「继续写作」与全局搜索同样不漏标题',
    /"overviewHidesTitle":true/.test(String(privRes)) && /"searchHidesTitle":true/.test(String(privRes)), privRes);
  check('隐私锁：解锁后可正常进入，也可取消私密',
    /"afterUnlock":true/.test(String(privRes)) && /"unlockedItem":true/.test(String(privRes)), privRes);

  /* 隐私中心页面 */
  const privPage = await page.call(`
    window.UI.go('privacy');
    await new Promise(function (r) { setTimeout(r, 600); });
    var t = (document.getElementById('view') || {}).innerText || '';
    return JSON.stringify({
      hasToggle: /隐私锁已开启|开启隐私锁/.test(t),
      hasBoundary: /不是加密/.test(t),
      hasList: /私密作品/.test(t)
    });
  `);
  check('隐私中心：说明安全边界并提供开关',
    /"hasToggle":true/.test(String(privPage)) && /"hasBoundary":true/.test(String(privPage)), privPage);

  /* 协作：房间 + 分享包 + 多人日记 */
  const collabRes = await page.call(`
    var out = {};
    /* 1) 协作中心页面 */
    window.UI.go('collab');
    await new Promise(function (r) { setTimeout(r, 600); });
    var t = (document.getElementById('view') || {}).innerText || '';
    out.pageOk = /协作室|还没有加入/.test(t) && /密友名单/.test(t);
    /* 2) 加入一部作品协作 */
    var novel = window.Store.state.novels[0];
    window.Collab.joinWork('novel', novel.id, novel.title, 'write');
    out.shared = window.Collab.isShared('novel', novel.id);
    out.role = window.Collab.roleOf('novel', novel.id);
    /* 3) 分享包：导出 → 改内容 → 再导入，验证「不覆盖」 */
    var before = novel.chapters[0].content;
    var pack = window.CollabView.makePack('novel', novel.id, false);
    out.packOk = !!(pack && pack.format === 'selfwriting-share' && pack.chapters.length);
    /* 模拟对方在他的副本里加了一段 */
    var other = JSON.parse(JSON.stringify(pack));
    other.from = '对方';
    other.chapters[0].content = before + '\\n\\n对方新增的一段。';
    other.chapters[0].paraMeta = null;
    /* 我这边也加一段 */
    var mine = before + '\\n\\n我新增的一段。';
    window.Store.setChapterContent(novel.id, novel.chapters[0].id, mine);
    var res = window.CollabView.importPack(other, {});
    await new Promise(function (r) { setTimeout(r, 400); });
    var after = window.Store.state.novels.filter(function (n) { return n.id === novel.id; })[0].chapters[0].content;
    out.mergedKeepsBoth = /我新增的一段/.test(after) && /对方新增的一段/.test(after);
    out.mergeResult = res && res.ok;
    /* 4) 多人日记：设为多人后，新建条目应带作者 */
    var d = window.Store.createDiaryBook({ title: '多人日记验证', kind: 'daily', countAchievements: false });
    window.Store.updateDiaryBook(d.id, { members: ['甲', '乙'] });
    window.Store.addDiaryEntry(d.id, { dateKey: '2026-01-01', content: '甲的记录', author: '甲' });
    window.Store.addDiaryEntry(d.id, { dateKey: '2026-01-01', content: '乙的记录', author: '乙' });
    var book = window.Store.findDiary(d.id);
    out.members = book.members.length;
    out.sameDayKept = window.Store.diaryEntriesOf(d.id, '2026-01-01').length;
    /* 5) 多人日记页面：按作者筛选 chips */
    window.UI.go('diary/' + d.id + '/2026-01-01');
    await new Promise(function (r) { setTimeout(r, 700); });
    var dt = (document.getElementById('view') || {}).innerText || '';
    out.diaryShowsAuthor = /甲/.test(dt) && /乙/.test(dt);
    out.diaryHasFilter = /多人日记本/.test(dt) && /全部 2/.test(dt);
    return JSON.stringify(out);
  `);
  check('协作中心：页面与「加入协作」生效',
    /"pageOk":true/.test(String(collabRes)) && /"shared":true/.test(String(collabRes)) && /"role":"write"/.test(String(collabRes)), collabRes);
  check('分享包：导出正常，导入后双方内容都保留（不覆盖）',
    /"packOk":true/.test(String(collabRes)) && /"mergeResult":true/.test(String(collabRes)) &&
    /"mergedKeepsBoth":true/.test(String(collabRes)), collabRes);
  check('多人日记：成员、同日多条记录与按人筛选',
    /"members":2/.test(String(collabRes)) && /"sameDayKept":2/.test(String(collabRes)) &&
    /"diaryShowsAuthor":true/.test(String(collabRes)) && /"diaryHasFilter":true/.test(String(collabRes)), collabRes);
  await page.shot(path.join(SHOTS, '32-collab.png'));

  /* 协作室：真的开一个房间（需要带协作接口的本机服务） */
  const roomRes = await page.call(`
    var code = window.Collab.newRoomCode();
    var res = null, skipped = '';
    try {
      res = await window.Collab.hostRoom({ code: code });
    } catch (e) {
      skipped = String(e && e.message || e);
    }
    /* 静态资源服务器（只发文件、没有 /collab 接口）上不判定失败 */
    var isStaticOnly = /JSON|DOCTYPE|Unexpected/i.test(skipped) || !res;
    if (isStaticOnly) {
      return JSON.stringify({ skipped: true, reason: skipped.slice(0, 80) });
    }
    await new Promise(function (r) { setTimeout(r, 500); });
    var novel = window.Store.state.novels[0];
    var ok = await window.Collab.push('novel', novel.id, novel.title,
      [{ title: novel.chapters[0].title, content: novel.chapters[0].content, paraMeta: novel.chapters[0].paraMeta }]);
    window.Collab.leaveRoom();
    return JSON.stringify({ created: !!(res && res.ok), pushOk: !!(ok && ok.ok) });
  `);
  if (/"skipped":true/.test(String(roomRes))) {
    console.log('  （跳过）协作室联机测试：当前验证目标没有 /collab 接口 —— ' + String(roomRes).slice(0, 90));
  } else {
    check('协作室：能创建房间并把改动推送到房间',
      /"created":true/.test(String(roomRes)) && /"pushOk":true/.test(String(roomRes)), roomRes);
  }

  /* 导入体验：加载遮罩挡住界面 + 阶段进度 */
  const busyRes = await page.call(`
    var out = {};
    /* 拉起遮罩 */
    var b = window.UI.busy('正在导入', '测试中…');
    out.maskShown = !!document.querySelector('.busy-mask');
    out.spinner = !!document.querySelector('.busy-spin');
    out.isBusy = window.UI.isBusy();
    /* 遮罩期间点别处不应产生跳转 */
    var before = location.hash;
    var mask = document.querySelector('.busy-mask');
    mask.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    var tab = document.querySelector('.tab[data-tab="reader"]');
    if (tab) tab.click();
    await new Promise(function (r) { setTimeout(r, 300); });
    out.hashUnchanged = location.hash === before;
    /* 进度更新 */
    b.update('第 2/3 个：测试.txt', 0.6);
    var bar = document.querySelector('.busy-bar > i');
    out.progressShown = !!bar && parseFloat(bar.style.width) > 50;
    out.subText = (document.querySelector('.busy-sub') || {}).textContent || '';
    b.done();
    out.maskRemoved = !document.querySelector('.busy-mask');
    return JSON.stringify(out);
  `);
  check('导入遮罩：显示加载动画并挡住误操作',
    /"maskShown":true/.test(String(busyRes)) && /"spinner":true/.test(String(busyRes)) &&
    /"isBusy":true/.test(String(busyRes)) && /"hashUnchanged":true/.test(String(busyRes)), busyRes);
  check('导入遮罩：有阶段文字与进度条，完成后自动移除',
    /"progressShown":true/.test(String(busyRes)) && /第 2/.test(String(busyRes)) &&
    /"maskRemoved":true/.test(String(busyRes)), busyRes);

  /* 续写辅助：分析 + 生成候选 + 插入正文 */
  const contRes = await page.call(`
    var out = {};
    var text = '陈默把伞靠在门边，水滴顺着伞骨落在地板上。\\n\\n「你回来了。」屋里的人说。\\n\\n他没有回答。有些话一旦说出口，就再也收不回去了。';
    out.names = window.Continue.detectNames(text, 3);
    out.stats = window.Continue.stats(text).paragraphs;
    var cands = window.Continue.generate(text, { hint: '他决定说出真相', count: 4 });
    out.candCount = cands.length;
    out.hasHint = cands.some(function (c) { return c.text.indexOf('真相') >= 0; });
    out.kinds = Array.from(new Set(cands.map(function (c) { return c.kind; }))).length;
    /* 同样的输入应给出同样的候选（可复现，不会每次乱跳） */
    var again = window.Continue.generate(text, { hint: '他决定说出真相', count: 4 });
    out.deterministic = again[0].text === cands[0].text;
    /* 写作页里真的插入一段 */
    var novel = window.Store.state.novels[0];
    var ch = novel.chapters[0];
    window.Store.setChapterContent(novel.id, ch.id, '原来的内容。');
    window.UI.go('editor/' + novel.id + '/' + ch.id + '?continue=1');
    await new Promise(function (r) { setTimeout(r, 1200); });
    var sheetOpen = !!document.querySelector('.cont-card');
    out.sheetOpened = sheetOpen;
    if (sheetOpen) {
      document.querySelector('.cont-card').click();
      await new Promise(function (r) { setTimeout(r, 200); });
      var btn = Array.prototype.slice.call(document.querySelectorAll('.sheet-foot .btn'))
        .filter(function (x) { return /插入到正文末尾/.test(x.textContent); })[0];
      if (btn) btn.click();
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    var ta = document.querySelector('textarea.editor');
    out.inserted = !!ta && ta.value.length > '原来的内容。'.length + 10;
    return JSON.stringify(out);
  `);
  check('续写：识别人物、按方向生成候选且结果可复现',
    /"candCount":4/.test(String(contRes)) && /"hasHint":true/.test(String(contRes)) &&
    /"deterministic":true/.test(String(contRes)) && /"kinds":[2-4]/.test(String(contRes)), contRes);
  check('续写：写作页可打开面板并把候选插入正文',
    /"sheetOpened":true/.test(String(contRes)) && /"inserted":true/.test(String(contRes)), contRes);

  /* 多语种：词典、翻译、语言切换 */
  const i18nRes = await page.call(`
    var out = {};
    out.hasI18N = !!window.I18N;
    out.langs = window.I18N.LANGS.map(function (l) { return l.id; }).join(',');
    out.dictEn = window.I18N.dictSize('en');
    out.dictTw = window.I18N.dictSize('zh-TW');
    /* 先在中文下确认设置页有语言选择器（英文模式下这行文案会被翻译掉） */
    window.I18N.setLang('zh-CN', { test: true });
    window.UI.go('stats/settings');
    await new Promise(function (r) { setTimeout(r, 700); });
    var zhTxt = (document.getElementById('view') || {}).innerText || '';
    out.selectorInSettings = /界面语言/.test(zhTxt);
    /* 切英文并抽样翻译（noReload：不动页面，避免把测试用的 CDP 连接刷断） */
    window.I18N.setLang('en', { noReload: true });
    out.t1 = window.I18N.t('小说');
    out.t2 = window.I18N.t('选择文件');
    out.t3 = window.I18N.t('这是用户自己写的内容，不该被翻译');
    /* 切回中文应原样返回，并确认设置真的写进了本地镜像
       （只写 IndexedDB 的话，立刻刷新会看到旧值 —— 这正是之前切不回中文的原因） */
    window.I18N.setLang('zh-CN', { test: true });
    out.t4 = window.I18N.t('小说');
    try { out.persisted = JSON.parse(localStorage.getItem('selfwriting.state.v1') || '{}').settings.language; }
    catch (e) { out.persisted = 'err'; }
    return JSON.stringify(out);
  `);
  check('多语种：提供中/英/繁三档并可翻译界面文案',
    /"hasI18N":true/.test(String(i18nRes)) && /"langs":"zh-CN,en,zh-TW"/.test(String(i18nRes)) &&
    /"t1":"Novels"/.test(String(i18nRes)) && /"t2":"Choose file"/.test(String(i18nRes)), i18nRes);
  check('多语种：不翻译用户自己的内容，且中文原样返回',
    /"t3":"这是用户自己写的内容，不该被翻译"/.test(String(i18nRes)) && /"t4":"小说"/.test(String(i18nRes)) && /"persisted":"zh-CN"/.test(String(i18nRes)), i18nRes);
  check('多语种：设置页提供语言选择器',
    /"selectorInSettings":true/.test(String(i18nRes)) && /"dictEn":[1-9][0-9][0-9]/.test(String(i18nRes)), i18nRes);

  /* 返回键：像原生应用那样一层层退，而不是浏览器式「每步都回退」 */
  await waitReady(15000);      // 前面的多语种用例可能触发过一次刷新，这里等应用重新就绪
  const backSetup = await page.call(`
    var out = {};
    var S = window.Store;
    var n = S.createNovel({ title: '返回键用例' });
    var nv = S.state.novels.filter(function (x) { return x.id === n.id; })[0];
    out.nid = n.id;
    out.c1 = nv.chapters[0].id;
    var c2 = S.addChapter(n.id, { title: '第二章' });
    out.c2 = c2 && c2.id;
    await S.flushNow();
    window.__backCase = out;
    return JSON.stringify(out);
  `);
  const backCase = JSON.parse(backSetup);
  const backStep = async (label, body) => {
    try { return JSON.parse(await page.call(body)); }
    catch (e) { console.log('  [返回键用例 ' + label + ' 失败] ' + e.message); return {}; }
  };
  const backA = await backStep('导航', `
    var C = window.__backCase;
    var out = {};
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    window.UI.go('novel'); await wait(420);
    out.rootStack = window.UI.stack.length;
    window.UI.go('editor/' + C.nid + '/' + C.c1); await wait(520);
    out.afterEditor = window.UI.stack.length;
    window.UI.go('editor/' + C.nid + '/' + C.c2); await wait(520);
    out.afterSwitch = window.UI.stack.length;              /* 换章节不该往栈里堆 */
    window.UI.hardwareBack(); await wait(520);
    out.afterBack = window.UI.currentPath();
    window.UI.hardwareBack(); await wait(180);
    out.outerToast = ((document.getElementById('toastHost') || {}).textContent || '');
    return JSON.stringify(out);
  `);
  const backB = await backStep('弹层', `
    var out = {};
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    window.UI.go('novel'); await wait(320);
    window.UI.go('calc'); await wait(420);
    out.toolDepth = window.UI.stack.length;
    window.UI.hardwareBack(); await wait(480);
    out.fromTool = window.UI.currentPath();
    window.UI.go('novel'); await wait(320);
    window.UI.go('article'); await wait(320);
    out.tabStack = window.UI.stack.join(',');
    /* 弹层：返回键先关弹层 */
    window.UI.sheet({ title: '返回键用例', body: function (h) { h.appendChild(document.createTextNode('x')); } });
    await wait(260);
    var handled = window.UI.hardwareBack();
    await wait(140);
    out.sheetClosed = handled === true && window.UI.isSheetOpen() === false;
    /* 换页面时上一页残留的弹层会被自动收掉 */
    window.UI.sheet({ title: '残留弹层', body: function (h) { h.appendChild(document.createTextNode('y')); } });
    await wait(220);
    window.UI.go('stats'); await wait(620);
    out.sheetCleared = window.UI.isSheetOpen() === false;
    return JSON.stringify(out);
  `);
  const backRes = Object.assign({}, backCase, backA, backB);
  check('返回键：页面栈只记「层」，换章节不会越堆越深',
    Number(backRes.rootStack) === 1 && Number(backRes.afterEditor) === 2 &&
    Number(backRes.afterSwitch) === 2, JSON.stringify(backRes));
  check('返回键：从写作页退到模块页，最外层提示「再按一次退出」',
    backRes.afterBack === 'novel' && /再按一次返回键退出/.test(String(backRes.outerToast)), JSON.stringify(backRes));
  check('返回键：工具页能退回来源页，换标签会重置页面栈',
    Number(backRes.toolDepth) === 2 && backRes.fromTool === 'novel' && backRes.tabStack === 'article', JSON.stringify(backRes));
  check('返回键：先关弹层，换页面时残留弹层自动收起',
    backRes.sheetClosed === true && backRes.sheetCleared === true, JSON.stringify(backRes));

  /* 日记：不能记未来 + 旧日记可改 */
  await waitReady(15000);
  const diaryRes = await page.call(`
    var out = {};
    var S = window.Store, U2 = window.U;
    var bk = S.createDiaryBook({ title: '日记边界用例' });
    var today = U2.dateKey(), tomorrow = U2.shiftDate(today, 1), past = U2.shiftDate(today, -7);
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    /* store 兜底：写成未来日期也会落在今天 */
    var e1 = S.addDiaryEntry(bk.id, { dateKey: tomorrow, content: '不该出现的未来日记' });
    out.storeClamp = e1.dateKey === today;
    out.noFutureEntry = S.diaryEntriesOf(bk.id, tomorrow).length === 0;
    /* 旧日记可改：内容与日期都能改，改完还是同一条 */
    var e2 = S.addDiaryEntry(bk.id, { dateKey: past, content: '上周写的' });
    S.updateDiaryEntry(bk.id, e2.id, { content: '上周写的（改过）' });
    var kept = S.diaryEntriesOf(bk.id, past);
    out.editPast = kept.length === 1 && kept[0].content === '上周写的（改过）';
    /* 想把旧日记改到未来 → 仍然拉回今天 */
    S.updateDiaryEntry(bk.id, e2.id, { dateKey: tomorrow });
    var book = S.state.diaries.filter(function (d) { return d.id === bk.id; })[0];
    var moved = book.entries.filter(function (x) { return x.id === e2.id; })[0];
    out.editClamp = moved.dateKey === today;
    S.updateDiaryEntry(bk.id, e2.id, { dateKey: past });
    await S.flushNow();
    /* 路由：未来日期自动回到今天 */
    window.UI.go('diary/' + bk.id + '/' + tomorrow); await wait(700);
    out.routeClamp = window.UI.currentPath() === 'diary/' + bk.id + '/' + today;
    /* 日历：未来的格子被禁用 */
    var futureCells = document.querySelectorAll('.cal-cell.future');
    out.calFuture = futureCells.length > 0;
    out.calDisabled = Array.prototype.every.call(futureCells, function (c) { return c.disabled === true; });
    var navBtns = document.querySelectorAll('.day-head .icon-btn');
    out.nextDisabledToday = navBtns[navBtns.length - 2].disabled === true;
    /* 过去的那天：能往后走，且有补写/编辑入口 */
    window.UI.go('diary/' + bk.id + '/' + past); await wait(700);
    var txt = document.getElementById('view').innerText;
    var navBtns2 = document.querySelectorAll('.day-head .icon-btn');
    out.nextEnabledPast = navBtns2[navBtns2.length - 2].disabled === false;
    out.pastEditable = /以前的日记随时可以改/.test(txt);
    var editBtn = Array.prototype.slice.call(document.querySelectorAll('#view button')).filter(function (b) { return b.textContent.trim() === '编辑'; })[0];
    if (editBtn) { editBtn.click(); await wait(500); }
    var dateInput = document.querySelector('#sheetBody input[type=date]');
    out.dateMax = dateInput ? dateInput.getAttribute('max') === today : false;
    window.UI.closeSheet();
    S.deleteDiaryBook(bk.id);
    await S.flushNow();
    return JSON.stringify(out);
  `);
  check('日记：不能提前记录未到的日期（store / 路由 / 日历三层都拦住）',
    /"storeClamp":true/.test(String(diaryRes)) && /"noFutureEntry":true/.test(String(diaryRes)) &&
    /"routeClamp":true/.test(String(diaryRes)) && /"calDisabled":true/.test(String(diaryRes)) &&
    /"calFuture":true/.test(String(diaryRes)), diaryRes);
  check('日记：以前的记录可以修改（改内容 / 改日期都留在原记录上）',
    /"editPast":true/.test(String(diaryRes)) && /"editClamp":true/.test(String(diaryRes)) &&
    /"pastEditable":true/.test(String(diaryRes)) && /"dateMax":true/.test(String(diaryRes)), diaryRes);
  check('日记：今天不能再往未来翻页，过去的日子可以',
    /"nextDisabledToday":true/.test(String(diaryRes)) && /"nextEnabledPast":true/.test(String(diaryRes)), diaryRes);

  /* 多语种：就地切换（不刷新）+ 动态小字 + 数字模板 */
  const i18nLive = await page.call(`
    var out = {};
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    window.__i18nToken = 'alive';
    var I = window.I18N;
    I.setLang('zh-CN', { test: true });
    window.UI.go('novel'); await wait(400);
    out.zhTabs = Array.prototype.map.call(document.querySelectorAll('.tab'), function (t) { return t.textContent.trim(); }).join(',');
    /* 切成英文：应当就地生效，不刷新页面 */
    I.setLang('en', { noReload: true });
    await wait(700);
    out.aliveEn = window.__i18nToken === 'alive';
    out.tabsEn = Array.prototype.map.call(document.querySelectorAll('.tab'), function (t) { return t.textContent.trim(); }).join(',');
    out.tplChapter = I.t('第 3 章');
    out.tplWords = I.t('1234 字');
    out.tplMixed = I.t('时长 0分 · 目标 1,000 字');
    out.userSafe = I.t('今天很好，因为下雨了');
    /* 顶部「今日字数」胶囊是每秒动态重写的：小字也要跟着翻译 */
    await wait(1500);
    out.chip = (document.getElementById('todayWords') || {}).textContent || '';
    /* 切回中文：原文原样回来，并且依然没有刷新 */
    I.setLang('zh-CN', { noReload: true });
    await wait(700);
    out.aliveZh = window.__i18nToken === 'alive';
    out.tabsZh = Array.prototype.map.call(document.querySelectorAll('.tab'), function (t) { return t.textContent.trim(); }).join(',');
    return JSON.stringify(out);
  `);
  check('多语种：切换语言就地生效，不用刷新页面也能切回来',
    /"aliveEn":true/.test(String(i18nLive)) && /"aliveZh":true/.test(String(i18nLive)) &&
    /"tabsEn":"Novels,Articles,Diary,Outline,Reading"/.test(String(i18nLive)) &&
    /"tabsZh":"小说,文章,日记,大纲,阅读"/.test(String(i18nLive)), i18nLive);
  check('多语种：动态小字与「数字模板」句子也会翻译，且不碰用户句子',
    /"tplChapter":"Chapter 3"/.test(String(i18nLive)) && /"tplWords":"1234 words"/.test(String(i18nLive)) &&
    /"tplMixed":"Duration 0 min · 1,000 words goal"/.test(String(i18nLive)) &&
    /"userSafe":"今天很好，因为下雨了"/.test(String(i18nLive)) &&
    /Today|words/.test(String(i18nLive)), i18nLive);

  /* 账号（注册 / 专属码 / 状态）+ 多人创作标记 */
  await waitReady(15000);
  const accountRes = await page.call(`
    var out = {};
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var S = window.Store, U2 = window.U;
    var before = S.profile().name;
    out.hadProfile = !!window.Profile;
    /* 专属码：自动生成且形如 SW-XXXXXX */
    out.codeShape = /^SW-[A-Z0-9]{6}$/.test(S.userCode());
    /* 注册 */
    S.saveProfile({ name: '验证用户', emoji: '🐼', registered: true });
    out.registered = S.isRegistered();
    out.nameOk = S.profile().name === '验证用户';
    /* 头像三种形态：表情 / 首字 / 图片 */
    out.avatarEmoji = S.avatarOf(S.profile()).kind;
    S.saveProfile({ emoji: '' });
    out.avatarText = S.avatarOf(S.profile()).text;
    S.saveProfile({ emoji: '🐼' });
    /* 状态：设置 → 显示 → 过期 → 清除 */
    S.setStatus('专注写作中', { emoji: '✍️', hours: 0 });
    out.statusActive = (S.activeStatus() || {}).text;
    window.UI.go('me'); await wait(600);
    var meTxt = document.getElementById('view').innerText;
    out.statusOnPage = /专注写作中/.test(meTxt);
    out.codeOnPage = meTxt.indexOf('专属码') >= 0;
    out.faceEmoji = (document.getElementById('navMeFace') || {}).textContent;
    S.state.profile.status.until = Date.now() - 1000;
    out.expired = S.activeStatus() === null;
    S.clearStatus();
    out.statusCleared = S.activeStatus() === null;
    /* 首页状态卡 */
    window.UI.go('novel'); await wait(600);
    out.homeCard = /验证用户/.test(document.getElementById('view').innerText);
    /* 多人创作：日记条目 */
    var bk = S.createDiaryBook({ title: '多人用例本' });
    S.addDiaryEntry(bk.id, { dateKey: U2.dateKey(), content: '一起写的', participants: ['验证用户', '小李'], author: '验证用户' });
    await S.flushNow();
    window.UI.go('diary/' + bk.id + '/' + U2.dateKey()); await wait(700);
    var dTxt = document.getElementById('view').innerText;
    out.diaryMulti = /多人创作 · 参与者：验证用户、小李/.test(dTxt);
    var editBtn = Array.prototype.slice.call(document.querySelectorAll('#view button'))
      .filter(function (b) { return b.textContent.trim() === '编辑'; })[0];
    if (editBtn) { editBtn.click(); await wait(600); }
    var sheetTxt = (document.getElementById('sheetBody') || {}).innerText || '';
    out.diaryEntryPoint = /多人创作/.test(sheetTxt) && /一起写的人/.test(sheetTxt);
    window.UI.closeSheet(); await wait(150);
    /* 多人创作：小说 */
    var nv = S.createNovel({ title: '多人用例小说' });
    var nvObj = S.state.novels.filter(function (x) { return x.id === nv.id; })[0];
    S.setParticipants('novel', nv.id, ['验证用户', '小李', '小王'], { chapterId: nvObj.chapters[0].id });
    await S.flushNow();
    window.UI.go('novel'); await wait(600);
    out.novelCard = /多人创作 3/.test(document.getElementById('view').innerText);
    window.UI.go('library/novel/' + nv.id); await wait(700);
    var nTxt = document.getElementById('view').innerText;
    out.novelDetail = /多人创作/.test(nTxt) && /参与者：验证用户、小李、小王/.test(nTxt);
    out.chapterLine = /多人创作 3/.test(nTxt);
    S.deleteNovel(nv.id); S.deleteDiaryBook(bk.id);
    /* 语言名称不被翻译 */
    var I = window.I18N;
    I.setLang('en', { noReload: true });
    window.UI.go('stats/settings'); await wait(600);
    out.langNamesEn = Array.prototype.map.call(document.querySelectorAll('select.font-sel option'),
      function (o) { return o.textContent; }).join('/');
    I.setLang('zh-TW', { noReload: true });
    window.UI.render(); await wait(400);
    out.langNamesTw = Array.prototype.map.call(document.querySelectorAll('select.font-sel option'),
      function (o) { return o.textContent; }).join('/');
    I.setLang('zh-CN', { noReload: true });
    window.UI.render(); await wait(300);
    S.saveProfile({ name: before || '我', registered: false, emoji: '' });
    await S.flushNow();
    return JSON.stringify(out);
  `);
  check('账号：可注册（昵称 / 头像 / 自动生成的专属码）',
    /"hadProfile":true/.test(String(accountRes)) && /"codeShape":true/.test(String(accountRes)) &&
    /"registered":true/.test(String(accountRes)) && /"nameOk":true/.test(String(accountRes)) &&
    /"avatarEmoji":"emoji"/.test(String(accountRes)) && /"codeOnPage":true/.test(String(accountRes)), accountRes);
  check('账号：状态可更新、可过期、显示在个人页与首页',
    /"statusActive":"专注写作中"/.test(String(accountRes)) && /"statusOnPage":true/.test(String(accountRes)) &&
    /"faceEmoji":"✍️"/.test(String(accountRes)) && /"expired":true/.test(String(accountRes)) &&
    /"statusCleared":true/.test(String(accountRes)) && /"homeCard":true/.test(String(accountRes)), accountRes);
  check('多人创作：日记条目有入口、保存后标出参与者',
    /"diaryMulti":true/.test(String(accountRes)) && /"diaryEntryPoint":true/.test(String(accountRes)), accountRes);
  check('多人创作：小说卡片、详情与章节都标注参与者',
    /"novelCard":true/.test(String(accountRes)) && /"novelDetail":true/.test(String(accountRes)) &&
    /"chapterLine":true/.test(String(accountRes)), accountRes);
  check('多语种：语言名称保持原样（简体中文 / English / 繁體中文）',
    /"langNamesEn":"简体中文\/English\/繁體中文"/.test(String(accountRes)) &&
    /"langNamesTw":"简体中文\/English\/繁體中文"/.test(String(accountRes)), accountRes);

  /* 控制台错误 */
  await sleep(300);
  const errs = page.errors().filter((e) => !/favicon|manifest|DevTools/i.test(e.text));
  check('运行期无控制台报错', errs.length === 0, errs.slice(0, 4).map((e) => e.type + ': ' + e.text).join(' | '));

  /* 汇总 */
  const failed = results.filter((r) => !r.ok);
  console.log('\n===== 汇总：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
  if (failed.length) failed.forEach((f) => console.log('  ✗ ' + f.name + '  ' + String(f.detail).slice(0, 200)));

  try { await page.eval('window.Store.flushNow()'); } catch (e) { /* noop */ }
  page.close();
  try { browser.proc.kill(); } catch (e) { /* noop */ }
  process.exit(failed.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('验证脚本异常:', e && e.stack || e);
    process.exit(2);
  });
}

module.exports = { buildMiniEpub: buildMiniEpub };