/* ==========================================================================
   bench.js — 核心操作性能基准（找出「导入后卡顿 / 加载慢」的真因）
   用法： node tools/bench.js
   ========================================================================== */
'use strict';

const path = require('path');
const { launch, Page, sleep } = require('./driver');

const SIZE = Number(process.argv[2] || 200000);   // 单篇文章字数
const COUNT = Number(process.argv[3] || 30);      // 文章篇数

(async () => {
  const browser = await launch();
  const page = await Page.open(browser, 'http://127.0.0.1:8099/index.html?nosw=1');
  await sleep(2500);

  const ready = await page.eval('!!(window.Store && window.U && window.Ach && window.Stats)');
  if (!ready) { console.error('应用未就绪'); process.exit(1); }

  const result = await page.call(`
    const U = window.U, Store = window.Store, Ach = window.Ach, Stats = window.Stats;
    const out = [];
    function ms(fn) { const t = performance.now(); const r = fn(); return { ms: +(performance.now() - t).toFixed(1), r: r }; }
    function msAsync(fn) { const t = performance.now(); return fn().then(function (r) { return { ms: +(performance.now() - t).toFixed(1), r: r }; }); }

    // 清空数据
    Store.state.novels = []; Store.state.articles = []; Store.state.diaries = [];
    Store.state.reading = []; Store.state.achievements = {};
    Store.commit(null, { kind: 'bench-reset', silent: true });

    const SIZE = ${SIZE}, COUNT = ${COUNT};
    const para = '这是一段用于性能测试的正文内容，包含中文标点，以及 some english words 12345。\\n';
    const chunk = para.repeat(Math.ceil(SIZE / para.length));
    const text = chunk.slice(0, SIZE);

    /* 0. 预热（JIT + 字符串扁平化），避免首次调用被计入 */
    U.words(text);

    /* 1. 字数统计：取 5 次的最小值（排除 GC / 调度抖动） */
    let wBest = Infinity;
    for (let i = 0; i < 5; i++) { const t = performance.now(); U.words(text); const d = performance.now() - t; if (d < wBest) wBest = d; }
    out.push({ name: 'U.words 单次 ' + (SIZE / 1000) + 'k 字（5 次取最小）', ms: +wBest.toFixed(1) });

    /* 2. 分章 */
    const t2 = ms(function () { return U.splitChapters(text, 'auto').length; });
    out.push({ name: 'U.splitChapters ' + (SIZE / 1000) + 'k 字', ms: t2.ms, n: t2.r });

    /* 3. 创建 N 篇大文章（模拟导入：走批量模式，与真实导入一致） */
    const ids = [];
    if (Store.beginBatch) Store.beginBatch();
    const t3 = ms(function () {
      for (let i = 0; i < COUNT; i++) {
        const a = Store.createArticle({ title: '压测文章 ' + i });
        Store.setArticleContent(a.id, text);
        ids.push(a.id);
      }
      return ids.length;
    });
    out.push({ name: '创建 ' + COUNT + ' 篇（批量，每篇 ' + (SIZE / 1000) + 'k 字）', ms: t3.ms, n: t3.r });

    /* 4. 一篇的编辑（每次按键路径） */
    let eBest = Infinity;
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      Store.setArticleContent(ids[0], text + 'x' + i);
      const d = performance.now() - t;
      if (d < eBest) eBest = d;
    }
    out.push({ name: 'setArticleContent 单次（20 次取最小）', ms: +eBest.toFixed(1) });

    /* 5-7. 汇总类 */
    out.push({ name: 'Ach.context（全库扫描）', ms: ms(function () { return Ach.context(Store.state).article.words; }).ms });
    out.push({ name: 'Ach.evaluate（全部规则）', ms: ms(function () { Ach.evaluate(Store.state, true); return Ach.all().length; }).ms });
    out.push({ name: 'Stats.summary', ms: ms(function () { return Stats.summary(Store.state).totalWords; }).ms });

    /* 8. 落盘 */
    if (Store.endBatch) await Store.endBatch();
    out.push({ name: 'JSON.stringify(state)', ms: ms(function () { window.DB._lastRev = -1; return JSON.stringify(Store.state).length; }).ms });
    out.push({ name: 'DB.saveState（落盘一次）', ms: (await msAsync(function () { window.DB._lastRev = -1; return window.DB.saveState(Store.state); })).ms });
    out.push({ name: 'DB.saveLocal（localStorage 影子副本）', ms: (await msAsync(function () { return Promise.resolve(window.DB.saveLocal(Store.state)); })).ms });

    /* 10. 书架渲染 */
    out.push({ name: '打开模块列表（' + COUNT + ' 篇）', ms: (await msAsync(function () {
      window.UI.go('article');
      return new Promise(function (r) { setTimeout(function () { r(document.querySelectorAll('#view .card').length); }, 40); });
    })).ms });

    /* 11. 打开大文章编辑器 */
    out.push({ name: '打开 ' + (SIZE / 1000) + 'k 字文章编辑器', ms: (await msAsync(function () {
      window.UI.go('editor/' + ids[0]);
      return new Promise(function (r) { setTimeout(function () { r((document.querySelector('textarea.editor') || {}).value ? 1 : 0); }, 40); });
    })).ms });

    /* 12. 编辑器输入延迟（取 5 次最小） */
    let iBest = Infinity;
    for (let i = 0; i < 5; i++) {
      const v = await msAsync(function () {
        const ta = document.querySelector('textarea.editor');
        if (!ta) return Promise.resolve(-1);
        const t = performance.now();
        ta.value = ta.value + 'x';
        ta.dispatchEvent(new Event('input'));
        return new Promise(function (r) { requestAnimationFrame(function () { r(+(performance.now() - t).toFixed(1)); }); });
      });
      if (typeof v.r === 'number' && v.r > 0 && v.r < iBest) iBest = v.r;
      await new Promise(function (r) { setTimeout(r, 120); });
    }
    out.push({ name: '编辑器输入 1 个字符（5 次取最小）', ms: iBest === Infinity ? -1 : iBest });

    /* 13. 落盘 */
    out.push({ name: 'flushNow 落盘', ms: (await msAsync(function () {
      const t = performance.now();
      return Store.flushNow().then(function () { return +(performance.now() - t).toFixed(1); });
    })).r });

    return JSON.stringify(out);
  `);

  let rows;
  try { rows = JSON.parse(result); } catch (e) { console.error('结果解析失败:', result); process.exit(2); }

  console.log('\n=== 性能基准（文章 ' + COUNT + ' 篇 × ' + (SIZE / 1000) + 'k 字） ===');
  console.log('  ' + '操作'.padEnd(40) + '耗时(ms)');
  console.log('  ' + '-'.repeat(54));
  rows.forEach((r) => {
    const flag = r.ms > 200 ? '  <== 慢' : (r.ms > 60 ? '  <-- 偏慢' : '');
    console.log('  ' + r.name.padEnd(40) + String(r.ms).padStart(8) + flag + (r.n !== undefined ? '   n=' + r.n : ''));
  });

  page.close();
  browser.proc.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
