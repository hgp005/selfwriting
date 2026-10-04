/* ==========================================================================
   perf-import.js — 真实场景性能验收：导入一本大书 → 立刻开始打字
   这是用户报「导入后卡顿、无法操作」的复现路径。
   用法： node tools/perf-import.js [文本量KB]
   ========================================================================== */
'use strict';

const { launch, Page, sleep } = require('./driver');

const KB = Number(process.argv[2] || 1024);   // 默认约 1MB

(async () => {
  const browser = await launch();
  const page = await Page.open(browser, 'http://127.0.0.1:8099/index.html?nosw=1');
  await sleep(2500);

  const raw = await page.call(`
    const U = window.U, Store = window.Store;
    const TARGET = ${KB} * 1024;
    const para = '这一章的内容很长，用来模拟真实导入的小说文本，包含标点、英文 words 和数字 12345。\\n';
    // 拼到大约 TARGET 字节，按「第 N 章」切分，模拟真实书稿
    let text = '';
    let i = 1;
    while (text.length < TARGET) {
      text += '第' + i + '章 标题' + i + '\\n\\n' + para.repeat(Math.max(1, Math.floor(TARGET / 30 / para.length))) + '\\n\\n';
      i++;
    }
    const textMB = +(text.length / 1048576).toFixed(2);

    /* --- 1. 导入（与真实导入同一路径：beginBatch → 建章节 → 批量提交） --- */
    const t0 = performance.now();
    Store.beginBatch();
    const chs = U.splitChapters(text, 'auto');
    const nv = Store.createNovel({ title: '导入性能测试', countAchievements: false });
    const n = Store.findNovel(nv.id);
    n.chapters = chs.map(function (c, k) { return Store.newChapterObject({ title: c.title, content: c.content, index: k + 1, goal: null }); });
    Store.commit(function () { Store.recomputeNovel(Store.findNovel(nv.id)); }, { kind: 'import' });
    const createMs = Math.round(performance.now() - t0);

    const t1 = performance.now();
    await Store.endBatch();
    const batchMs = Math.round(performance.now() - t1);

    /* --- 2. 导入后立刻打开第一章并连续输入 --- */
    const ch1 = n.chapters[0];
    window.UI.go('editor/' + nv.id + '/' + ch1.id);
    await new Promise(function (r) { setTimeout(r, 500); });
    const ta = document.querySelector('textarea.editor');
    if (!ta) return JSON.stringify({ error: '编辑器未打开' });

    const openMs = Math.round(performance.now() - t0);

    let worst = 0, total = 0, n1 = 15;
    for (let k = 0; k < n1; k++) {
      const t = performance.now();
      ta.value = ta.value + 'x';
      ta.dispatchEvent(new Event('input'));
      await new Promise(function (r) { requestAnimationFrame(r); });
      const d = performance.now() - t;
      total += d;
      if (d > worst) worst = d;
      await new Promise(function (r) { setTimeout(r, 50); });
    }

    /* --- 3. 切页是否流畅（导入后最容易卡的路径） --- */
    const t3 = performance.now();
    window.UI.go('novel');
    await new Promise(function (r) { setTimeout(function () { r(); }, 60); });
    const listMs = Math.round(performance.now() - t3);
    const t4 = performance.now();
    window.UI.go('stats');
    await new Promise(function (r) { setTimeout(function () { r(); }, 60); });
    const statsMs = Math.round(performance.now() - t4);

    return JSON.stringify({
      textMB: textMB,
      chapters: chs.length,
      importCreateMs: createMs,
      importCommitMs: batchMs,
      openEditorMs: openMs,
      keystrokeAvgMs: +(total / n1).toFixed(1),
      keystrokeWorstMs: +worst.toFixed(1),
      switchListMs: listMs,
      switchStatsMs: statsMs
    });
  `);

  let r;
  try { r = JSON.parse(raw); } catch (e) { console.error('结果解析失败:', raw); process.exit(2); }

  console.log('\n=== 导入 ' + r.textMB + ' MB 文本（' + r.chapters + ' 章）后的响应 ===');
  console.log('  导入建章         ' + String(r.importCreateMs).padStart(6) + ' ms');
  console.log('  批量提交+落盘    ' + String(r.importCommitMs).padStart(6) + ' ms');
  console.log('  打开编辑器       ' + String(r.openEditorMs).padStart(6) + ' ms');
  console.log('  打字平均延迟     ' + String(r.keystrokeAvgMs).padStart(6) + ' ms   ' + (r.keystrokeAvgMs < 60 ? '✓ 流畅' : '✗ 卡'));
  console.log('  打字最差延迟     ' + String(r.keystrokeWorstMs).padStart(6) + ' ms   ' + (r.keystrokeWorstMs < 150 ? '✓' : '✗'));
  console.log('  切到小说列表     ' + String(r.switchListMs).padStart(6) + ' ms');
  console.log('  切到统计         ' + String(r.switchStatsMs).padStart(6) + ' ms');

  const ok = r.keystrokeAvgMs < 60 && r.keystrokeWorstMs < 200 && r.switchListMs < 500 && r.switchStatsMs < 500;
  console.log('\n  结论: ' + (ok ? '导入后仍可正常操作 ✓' : '仍有可能卡顿 ✗'));

  page.close();
  browser.proc.kill();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
