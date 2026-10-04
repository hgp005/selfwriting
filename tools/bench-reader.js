/* ==========================================================================
   selfwriting · bench-reader.js（开发用，不属于应用本体）
   量测「打开一本书」的真实耗时：造一本 300 章 / 约 700KB 的书，
   分别量首屏同步耗时、首帧耗时、已排版章数、DOM 节点数、跳转耗时与进度准确性。
   用法： node tools/bench-reader.js [端口]
   ========================================================================== */
'use strict';
const { launch, Page, sleep } = require('./driver');

const PORT = Number(process.argv[2] || 8099);
const BASE = 'http://127.0.0.1:' + PORT + '/index.html?nosw=1';

async function main() {
  const browser = await launch();
  const page = await Page.open(browser, BASE + '#/reader');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (await page.eval('!!(window.Store && window.Store.state && window.UI)').catch(() => false)) { ready = true; break; }
    await sleep(300);
  }
  if (!ready) throw new Error('应用没有启动完成');

  /* 造一本 300 章的书：每章 12 段，约 2.3KB，合计约 700KB */
  const made = await page.call(`
    var chapters = [];
    for (var i = 1; i <= 300; i++) {
      var body = '';
      for (var p = 0; p < 12; p++) {
        body += '第 ' + i + ' 章第 ' + (p + 1) + ' 段：这是一段用于测试阅读器渲染性能的正文内容，'
          + '长度接近真实小说的段落，包含标点、对话与叙述，用来验证渐进排版的效果。\\n\\n';
      }
      chapters.push({ id: 'tc' + i, title: '第 ' + i + ' 章 测试章节', content: body, words: 0, html: null });
    }
    var b = window.Store.createBook({ title: '性能测试书（300 章）', category: '其它', countAchievements: false, format: 'txt', chapters: chapters });
    window.Store.recomputeBook(window.Store.findBook(b.id));
    await window.Store.flushNow();
    var bk = window.Store.findBook(b.id);
    return JSON.stringify({ id: b.id, chapters: bk.chapters.length, words: bk.words, kb: Math.round(bk.chapters.reduce(function (s, c) { return s + c.content.length; }, 0) / 1024) });
  `);
  const meta = JSON.parse(made);
  console.log('测试书: ' + meta.chapters + ' 章 / ' + meta.kb + 'KB / ' + meta.words + ' 字');
  const id = meta.id;

  const openOnce = `
    window.UI.go('reader');
    await new Promise(function (r) { setTimeout(r, 260); });
    var view = document.getElementById('view');
    /* 钩一下 UI.render，量「同步渲染」这一段的真实耗时 */
    var origRender = window.UI.render;
    var renderMs = null;
    window.UI.render = function () {
      var t = performance.now();
      var out = origRender.apply(this, arguments);
      renderMs = performance.now() - t;
      return out;
    };
    var t0 = performance.now();
    window.UI.go('read/${id}/start');
    var domMs = null;
    while (performance.now() - t0 < 8000) {
      if (view.querySelector('.reader-stage:not(.pending)')) { domMs = performance.now() - t0; break; }
      await new Promise(function (r) { requestAnimationFrame(r); });
    }
    window.UI.render = origRender;
    await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    var painted = view.querySelectorAll('.reader-stage:not(.pending)').length;
    var pending = view.querySelectorAll('.reader-stage.pending').length;
    var nodes = view.querySelectorAll('*').length;
    var textLen = 0;
    view.querySelectorAll('.reader-stage:not(.pending)').forEach(function (n) { textLen += n.textContent.length; });
    return JSON.stringify({
      renderMs: Math.round(renderMs * 10) / 10,
      domMs: Math.round(domMs),
      firstFrameMs: Math.round(performance.now() - t0),
      painted: painted, pending: pending, nodes: nodes, textLen: textLen,
      scrollHeight: view.scrollHeight
    });
  `;

  for (let round = 1; round <= 3; round++) {
    const r = JSON.parse(await page.call(openOnce));
    console.log('  打开第 ' + round + ' 次: 同步渲染 ' + r.renderMs + 'ms · 首帧 ' + r.firstFrameMs +
      'ms · 已排版 ' + r.painted + ' 章 / 待排版 ' + r.pending + ' 章 · DOM 节点 ' + r.nodes +
      ' · 首屏正文 ' + r.textLen + ' 字 · 全文估高 ' + Math.round(r.scrollHeight / 1000) + 'k px');
  }

  /* 参照：同样的书，用「老办法」（一次性把 300 章正文都塞进 DOM）要多久 */
  const baseline = await page.call(`
    var book = window.Store.findBook('${id}');
    var host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-99999px;top:0;width:360px';
    document.body.appendChild(host);
    var t0 = performance.now();
    book.chapters.forEach(function (c, i) {
      host.appendChild(window.U.el('h2', { text: c.title }));
      host.appendChild(window.U.el('div.reader-stage', { text: c.content }));
    });
    var buildMs = performance.now() - t0;
    var h = host.offsetHeight;
    var layoutMs = performance.now() - t0;
    host.parentNode.removeChild(host);
    return JSON.stringify({ buildMs: Math.round(buildMs), layoutMs: Math.round(layoutMs), height: h });
  `);
  console.log('  对照（老办法：一次渲染全部章节）: ' + baseline);

  /* 滚到第 120 章附近，看按需排版有没有跟上
     （容器 CSS 是 scroll-behavior: smooth，量测时先关掉，否则拿到的是动画中间值） */
  const scrollRes = await page.call(`
    var view = document.getElementById('view');
    var jumpTo = function (top) {
      view.style.scrollBehavior = 'auto';
      view.scrollTop = top;
      void view.scrollTop;
      view.style.removeProperty('scroll-behavior');
    };
    var heads = view.querySelectorAll('h2[data-chapter]');
    jumpTo(heads[120].offsetTop);
    await new Promise(function (r) { setTimeout(r, 900); });
    var painted = view.querySelectorAll('.reader-stage:not(.pending)').length;
    var near = 0;
    view.querySelectorAll('.reader-stage:not(.pending)').forEach(function (n) {
      if (Math.abs(n.offsetTop - view.scrollTop) < 2500) near++;
    });
    var book = window.Store.findBook('${id}');
    return JSON.stringify({ painted: painted, nearView: near, chapter: book.progress.chapterIndex, percent: Math.round(book.progress.percent * 100) });
  `);
  console.log('  滚到第 121 章: ' + scrollRes);

  /* 跳到最后：进度必须能到 100% */
  const endRes = await page.call(`
    var view = document.getElementById('view');
    var jumpTo = function (top) {
      view.style.scrollBehavior = 'auto';
      view.scrollTop = top;
      void view.scrollTop;
      view.style.removeProperty('scroll-behavior');
    };
    jumpTo(view.scrollHeight);
    await new Promise(function (r) { setTimeout(r, 1500); });
    jumpTo(view.scrollHeight);
    await new Promise(function (r) { setTimeout(r, 900); });
    var book = window.Store.findBook('${id}');
    var painted = view.querySelectorAll('.reader-stage:not(.pending)').length;
    return JSON.stringify({ percent: Math.round(book.progress.percent * 100), chapter: book.progress.chapterIndex, painted: painted });
  `);
  console.log('  滚到末尾: ' + endRes);

  /* 用目录跳回第 1 章：跳转后进度要回到开头附近 */
  const jumpRes = await page.call(`
    var view = document.getElementById('view');
    view.style.scrollBehavior = 'auto';
    var t0 = performance.now();
    view.scrollTop = view.querySelectorAll('h2[data-chapter]')[0].offsetTop;
    void view.scrollTop;
    view.style.removeProperty('scroll-behavior');
    await new Promise(function (r) { setTimeout(r, 700); });
    var book = window.Store.findBook('${id}');
    return JSON.stringify({ ms: Math.round(performance.now() - t0), percent: Math.round(book.progress.percent * 100), chapter: book.progress.chapterIndex });
  `);
  console.log('  跳回第 1 章: ' + jumpRes);

  /* 从第 200 章继续读：还原位置要「瞬间到位」，不能一路滚过整本书 */
  const resume = await page.call(`
    var view = document.getElementById('view');
    var book = window.Store.findBook('${id}');
    window.Store.setBookProgress(book.id, { chapterIndex: 200, chapterFrac: 0.5, percent: 200 / 300 });
    await window.Store.flushNow();
    window.UI.go('reader');
    await new Promise(function (r) { setTimeout(r, 260); });
    var t0 = performance.now();
    window.UI.go('read/${id}/start');
    var domMs = null;
    while (performance.now() - t0 < 8000) {
      if (view.querySelector('.reader-stage:not(.pending)')) { domMs = performance.now() - t0; break; }
      await new Promise(function (r) { requestAnimationFrame(r); });
    }
    await new Promise(function (r) { setTimeout(r, 700); });
    var b2 = window.Store.findBook('${id}');
    var painted = view.querySelectorAll('.reader-stage:not(.pending)').length;
    return JSON.stringify({ domMs: Math.round(domMs), chapter: b2.progress.chapterIndex, painted: painted, scrollTop: Math.round(view.scrollTop) });
  `);
  console.log('  从第 201 章继续读: ' + resume);

  await page.call(`window.Store.deleteBook('${id}'); await window.Store.flushNow(); return 'ok';`);
  browser.proc.kill();
}

main().catch((e) => { console.error('失败: ' + ((e && e.stack) || e)); process.exit(1); });
