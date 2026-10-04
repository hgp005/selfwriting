/* ==========================================================================
   selfwriting · tools/test-reader.js（开发验证用，不属于应用本体）
   阅读器专项验证：
     · 书架：单列 / 双列切换、封面宽度可调（封面真的变宽变窄）、收藏爱心
     · 书架：章节数始终有值（含 0 章）、上万字数用「万」
     · 阅读页：点正文收起 / 放下工具栏，再点恢复，Esc 也能恢复
     · 翻页方式：连续滚动 / 整页翻页 / 滑动翻页都能前进，键盘 ← → 可翻页
     · 书签：按钮点亮、正文丝带、侧边进度条刻度、书签列表、目录命中标记
     · 切模式之后：目录跳转与进度还原照常工作
   用法： node tools/test-reader.js [端口]
   ========================================================================== */
'use strict';

const { launch, Page, findEdge, sleep } = require('./driver');

const PORT = process.argv[2] || '8099';
const BASE = 'http://127.0.0.1:' + PORT + '/index.html?nosw=1';

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log('PASS  ' + name);
  } else {
    failed++;
    console.log('FAIL  ' + name + (detail ? '\n        ↳ ' + String(detail).slice(0, 700) : ''));
  }
}

let page = null;

/** 跑一段页面脚本，返回解析后的 JSON；出错记一次 FAIL 但不中断后面的用例 */
async function grab(label, body) {
  try {
    return JSON.parse(String(await page.call(body)));
  } catch (e) {
    failed++;
    console.log('FAIL  ' + label + '（执行异常）\n        ↳ ' + String((e && e.stack) || e).split('\n').slice(0, 3).join(' ⏎ '));
    return null;
  }
}

(async () => {
  let browser = null;
  try {
    browser = await launch({});
    page = await Page.open(browser, BASE + '#/reader');
    await page.freshCache();
    await page.hardGoto(BASE + '#/reader');
    await sleep(1200);

    let boot = false;
    for (let i = 0; i < 40; i++) {
      boot = await page.eval('!!(window.Store && window.UI && window.U && window.ReaderView && window.__selfwritingDemo)').catch(() => false);
      if (boot) break;
      await sleep(300);
    }
    if (!boot) throw new Error('应用没有启动完成（Store / UI / ReaderView 缺失）');

    /* 断言按中文写：先把界面语言固定回中文 */
    try { await page.eval(`(function(){ window.Store.setSetting('language','zh-CN'); return 1; })()`); } catch (e) { /* 忽略 */ }
    try { await page.eval('(window.I18N.testMode = true, 1)'); } catch (e) { /* 忽略 */ }

    /* ---------------- 0. 准备数据：示例读物 + 一本万字测试书 ---------------- */
    const made = await grab('准备测试数据', `
      if (!window.Store.state.reading.length && window.__selfwritingDemo) window.__selfwritingDemo();
      await new Promise(function (r) { setTimeout(r, 500); });
      var exist = null;
      window.Store.state.reading.forEach(function (b) { if (b.title === '阅读器测试书·万字') exist = b; });
      var book = exist;
      if (!book) {
        var chapters = [];
        for (var i = 1; i <= 12; i++) {
          var body = '';
          for (var p = 0; p < 30; p++) {
            body += '第 ' + i + ' 章第 ' + (p + 1) + ' 段：这是一段用来验证阅读器的正文，长度接近真实小说段落，'
              + '包含标点、对话与叙述，用来验证渐进排版、翻页、书签与进度还原是否都正常。\\n\\n';
          }
          chapters.push({ id: 'rt' + i, title: '测试第 ' + i + ' 章', content: body, words: 0, html: null });
        }
        book = window.Store.createBook({ title: '阅读器测试书·万字', author: '自动化', format: 'txt', chapters: chapters, category: '其它' });
        window.Store.recomputeBook(window.Store.findBook(book.id));
      }
      await window.Store.flushNow();
      var b = window.Store.findBook(book.id);
      return JSON.stringify({ id: b.id, chapters: b.chapters.length, words: window.Store.bookWords(b), sample: window.Store.state.reading.length });
    `);
    if (!made) throw new Error('没法准备测试读物');
    const id = made.id;
    console.log('测试读物: ' + made.chapters + ' 章 / ' + made.words + ' 字 · 书架共 ' + made.sample + ' 本');
    check('准备：测试读物 ≥ 12 章且字数 ≥ 10000（用来验证「万」）', made.chapters >= 12 && made.words >= 10000, JSON.stringify(made));

    /* ---------------- 1. 书架：视图切换 / 封面宽度 / 章节数 / 万字 ---------------- */
    const shelf = await grab('书架', `
      window.UI.go('reader');
      await new Promise(function (r) { setTimeout(r, 800); });
      var view = document.getElementById('view');
      var seg1 = document.querySelector('[data-rv="cols-1"]');
      var seg2 = document.querySelector('[data-rv="cols-2"]');
      var range = document.querySelector('[data-rv="cover-range"]');
      var card = document.querySelector('#view .rv-card[data-book="${id}"]');
      var cover = card ? card.querySelector('.rv-cover') : null;
      var w0 = cover ? cover.getBoundingClientRect().width : 0;
      /* 拉宽 */
      range.value = '170';
      range.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 150); });
      var wBig = document.querySelector('#view .rv-card[data-book="${id}"] .rv-cover').getBoundingClientRect().width;
      /* 收窄 */
      range.value = '70';
      range.dispatchEvent(new Event('input', { bubbles: true }));
      range.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 350); });
      var wSmall = document.querySelector('#view .rv-card[data-book="${id}"] .rv-cover').getBoundingClientRect().width;
      /* 0 章的书：章节数也要显示出来，不能留空 */
      var empty = window.Store.createBook({ title: '零章测试书', chapters: [] });
      window.UI.render();
      await new Promise(function (r) { setTimeout(r, 400); });
      var emptyCard = document.querySelector('#view .rv-card[data-book="' + empty.id + '"]');
      var emptyText = emptyCard ? emptyCard.textContent : '';
      window.Store.deleteBook(empty.id);
      window.UI.render();
      await new Promise(function (r) { setTimeout(r, 400); });
      var card2 = document.querySelector('#view .rv-card[data-book="${id}"]');
      return JSON.stringify({
        seg1: !!seg1, seg2: !!seg2,
        seg1Text: seg1 ? seg1.textContent : '', seg2Text: seg2 ? seg2.textContent : '',
        hasRange: !!range && range.type === 'range',
        w0: Math.round(w0), wBig: Math.round(wBig), wSmall: Math.round(wSmall),
        stored: window.Store.state.settings.readerCoverWidth,
        cardText: card2 ? card2.textContent : '',
        sample: /示例读物/.test(view.textContent)
      });
    `);
    if (shelf) {
      check('书架：有「单列 / 双列」视图切换', shelf.seg1 && shelf.seg2 && /单列/.test(shelf.seg1Text) && /双列/.test(shelf.seg2Text),
        JSON.stringify({ a: shelf.seg1Text, b: shelf.seg2Text }));
      check('书架：封面宽度控件能改变封面实际宽度（' + shelf.wBig + 'px → ' + shelf.wSmall + 'px）',
        shelf.hasRange && shelf.wBig > 60 && shelf.wSmall > 20 && (shelf.wBig - shelf.wSmall) >= 60, JSON.stringify(shelf));
      check('书架：拖完把封面宽度存进设置（readerCoverWidth=' + shelf.stored + '）', shelf.stored === 70, String(shelf.stored));
      check('书架：章节数显示为「N 章」，0 章也不留空', /\d+\s*章/.test(shelf.cardText), shelf.cardText.slice(0, 200));
      check('书架：上万字数用「万」显示', /万/.test(shelf.cardText), shelf.cardText.slice(0, 200));
      check('书架：示例读物仍在（没有破坏原有书目渲染）', shelf.sample);
    }

    /* ---------------- 2. 双列视图 ---------------- */
    const grid = await grab('双列视图', `
      document.querySelector('[data-rv="cols-2"]').click();
      await new Promise(function (r) { setTimeout(r, 600); });
      var view = document.getElementById('view');
      var cards = view.querySelectorAll('.rv-grid-card');
      var mine = view.querySelector('.rv-grid-card[data-book="${id}"]');
      var cover = mine ? mine.querySelector('.rv-cover') : null;
      return JSON.stringify({
        cols: window.Store.state.settings.readerCols,
        cards: cards.length,
        hasMine: !!mine,
        coverW: cover ? Math.round(cover.getBoundingClientRect().width) : 0,
        text: mine ? mine.textContent : ''
      });
    `);
    if (grid) {
      check('书架：切到双列后立即变成网格布局（' + grid.cards + ' 张卡片）', grid.cols === 2 && grid.cards >= 2 && grid.hasMine, JSON.stringify(grid));
      check('书架：双列卡片有封面 / 章节数 / 阅读进度',
        grid.coverW > 20 && /\d+\s*章/.test(grid.text) && /已读/.test(grid.text), grid.text.slice(0, 200));
    }

    /* ---------------- 3. 收藏爱心 + 收藏筛选 ---------------- */
    const heart = await grab('收藏爱心', `
      var btn = document.querySelector('#view .rv-like[data-book="${id}"]');
      var before = window.Store.isLiked('${id}');
      btn.click();
      await new Promise(function (r) { setTimeout(r, 220); });
      var on = window.Store.isLiked('${id}');
      var btn2 = document.querySelector('#view .rv-like[data-book="${id}"]');
      var pressed = btn2.getAttribute('aria-pressed');
      var fill = btn2.querySelector('svg').getAttribute('fill');
      /* 收藏筛选 */
      document.querySelector('[data-rv="filter-liked"]').click();
      await new Promise(function (r) { setTimeout(r, 500); });
      var cards = document.querySelectorAll('#view .rv-grid-card, #view .rv-card');
      var allLiked = true;
      cards.forEach(function (c) { if (!window.Store.isLiked(c.getAttribute('data-book'))) allLiked = false; });
      var likedShown = cards.length;
      document.querySelector('[data-rv="filter-all"]').click();
      await new Promise(function (r) { setTimeout(r, 450); });
      /* 熄灭 */
      document.querySelector('#view .rv-like[data-book="${id}"]').click();
      await new Promise(function (r) { setTimeout(r, 220); });
      var off = window.Store.isLiked('${id}');
      var btn4 = document.querySelector('#view .rv-like[data-book="${id}"]');
      var offFill = btn4.querySelector('svg').getAttribute('fill');
      /* 再点亮，方便后面看菜单里的爱心 */
      btn4.click();
      await new Promise(function (r) { setTimeout(r, 220); });
      return JSON.stringify({ before: before, on: on, off: off, pressed: pressed, fill: fill, offFill: offFill, likedShown: likedShown, allLiked: allLiked, back: window.Store.isLiked('${id}') });
    `);
    if (heart) {
      check('收藏：点爱心点亮并与 Store.isLiked 同步（实心 / 空心）',
        heart.before === false && heart.on === true && heart.pressed === 'true' && heart.fill === 'currentColor' &&
        heart.off === false && heart.offFill === 'none', JSON.stringify(heart));
      check('收藏：「收藏」筛选只留下收藏过的书（' + heart.likedShown + ' 本）', heart.likedShown === 1 && heart.allLiked === true, JSON.stringify(heart));
    }

    /* ---------------- 4. 打开读物：渐进渲染 + 章节数 ---------------- */
    const reading = await grab('打开读物', `
      window.Store.setBookProgress('${id}', { chapterIndex: 0, chapterFrac: 0, percent: 0, scroll: 0 });
      window.UI.go('read/${id}/start');
      await new Promise(function (r) { setTimeout(r, 1000); });
      var view = document.getElementById('view');
      return JSON.stringify({
        stage: !!view.querySelector('.rv-stage'),
        heads: view.querySelectorAll('h2[data-chapter]').length,
        painted: view.querySelectorAll('.reader-stage:not(.pending)').length,
        pending: view.querySelectorAll('.reader-stage.pending').length,
        rail: !!view.querySelector('.rv-rail'),
        bottom: !!view.querySelector('.reader-topbar'),
        sub: document.getElementById('viewSub').textContent,
        pct: /%/.test(view.textContent)
      });
    `);
    if (reading) {
      check('阅读页：渐进渲染（已排版 ' + reading.painted + ' 章 / 占位 ' + reading.pending + ' 章）',
        reading.stage && reading.heads === made.chapters && reading.painted >= 1 && reading.painted <= 8 && reading.pending >= 1,
        JSON.stringify(reading));
      check('阅读页：顶部副标题显示章节数，正文里有百分比', /\d+\s*章/.test(reading.sub) && reading.pct, reading.sub);
      check('阅读页：侧边进度条与底部阅读条都在', reading.rail && reading.bottom, JSON.stringify(reading));
    }

    /* ---------------- 5. 点正文收起 / 放下工具栏 ---------------- */
    const tap = await grab('点击收起工具栏', `
      var view = document.getElementById('view');
      function tapAt(x, y) {
        var o = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 11, isPrimary: true, pointerType: 'touch' };
        view.dispatchEvent(new PointerEvent('pointerdown', o));
        view.dispatchEvent(new PointerEvent('pointerup', o));
      }
      var r = view.getBoundingClientRect();
      tapAt(r.left + r.width / 2, r.top + 140);
      await new Promise(function (x) { setTimeout(x, 150); });
      var off = document.documentElement.classList.contains('rv-chrome-off');
      tapAt(r.left + r.width / 2, r.top + 140);
      await new Promise(function (x) { setTimeout(x, 150); });
      var back = document.documentElement.classList.contains('rv-chrome-off');
      /* 关掉「点击正文收起工具栏」后就不该再收起 */
      window.Store.setSetting('readerTapMenu', false);
      tapAt(r.left + r.width / 2, r.top + 140);
      await new Promise(function (x) { setTimeout(x, 150); });
      var disabled = document.documentElement.classList.contains('rv-chrome-off');
      window.Store.setSetting('readerTapMenu', true);
      return JSON.stringify({ off: off, back: back, disabled: disabled });
    `);
    if (tap) {
      check('点击正文：工具栏落下（rv-chrome-off）', tap.off === true, JSON.stringify(tap));
      check('再点一次：工具栏恢复', tap.back === false, JSON.stringify(tap));
      check('设置关掉 readerTapMenu 后点正文不再收起', tap.disabled === false, JSON.stringify(tap));
    }

    /* ---------------- 6. 真·横向分页（整页翻页） ---------------- */
    const paging = await grab('整页翻页', `
      document.querySelector('[data-rv="settings"]').click();
      await new Promise(function (r) { setTimeout(r, 350); });
      var chip = document.querySelector('button.chip[data-rv="mode-page"]');
      var hasChip = !!chip;
      chip.click();
      await new Promise(function (r) { setTimeout(r, 200); });
      var stored = window.Store.state.settings.readerPageMode;
      window.UI.closeSheet();
      /* 离开再进来：翻页方式要从设置里读回来 */
      window.UI.go('reader');
      await new Promise(function (r) { setTimeout(r, 350); });
      window.Store.setBookProgress('${id}', { chapterIndex: 0, chapterFrac: 0, percent: 0, scroll: 0, pageIndex: 0, pageCount: 0 });
      window.UI.go('read/${id}/start');
      await new Promise(function (r) { setTimeout(r, 1100); });

      var view = document.getElementById('view');
      var rect = view.getBoundingClientRect();
      var cols = view.querySelector('.rv-pages');
      var ind = view.querySelector('.rv-page-ind');
      var live0 = window.ReaderView.current();
      var colW = cols ? Math.round(cols.clientWidth) : 0;
      var pagesByScroll = cols ? Math.round(cols.scrollWidth / cols.clientWidth) : 0;
      var snap = {
        hasChip: hasChip, stored: stored,
        mode: live0.mode, layout: live0.layout,
        hasPaged: !!view.querySelector('.rv-paged'), hasStage: !!view.querySelector('.rv-stage'),
        colW: colW, colH: cols ? Math.round(cols.clientHeight) : 0,
        scrollWidth: cols ? cols.scrollWidth : 0,
        pagesByScroll: pagesByScroll,
        pageCount: live0.pageCount, pageIndex: live0.pageIndex,
        pagers: view.querySelectorAll('.rv-pager').length,
        paintedChapters: view.querySelectorAll('.reader-stage:not(.pending)').length,
        scrollable: view.scrollHeight > view.clientHeight + 4,
        ind: ind ? ind.textContent : '', indOn: ind ? ind.classList.contains('rv-on') : false,
        p0: live0.percent
      };
      function tapAt(x, y) {
        var o = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 12, isPrimary: true, pointerType: 'touch' };
        view.dispatchEvent(new PointerEvent('pointerdown', o));
        view.dispatchEvent(new PointerEvent('pointerup', o));
      }
      /* 点右侧 1/4 区域：翻一页（顺便抓一下翻页动画的中间状态） */
      tapAt(rect.left + rect.width * 0.9, rect.top + rect.height * 0.5);
      await new Promise(function (r) { setTimeout(r, 70); });
      var inc = view.querySelector('.rv-pager.rv-layer-next');
      snap.midCls = inc ? inc.className : '';
      snap.midShadow = inc ? getComputedStyle(inc).boxShadow : '';
      await new Promise(function (r) { setTimeout(r, 600); });
      snap.p1 = window.Store.findBook('${id}').progress.percent;
      snap.page1 = window.ReaderView.current().pageIndex;
      snap.ind1 = (view.querySelector('.rv-page-ind') || {}).textContent || '';
      snap.pagers1 = view.querySelectorAll('.rv-pager').length;
      /* 键盘 → 再翻一页 */
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      await new Promise(function (r) { setTimeout(r, 600); });
      snap.page2 = window.ReaderView.current().pageIndex;
      snap.p2 = window.Store.findBook('${id}').progress.percent;
      /* 横向滑动：手指从右往左 */
      var y = rect.top + rect.height * 0.5;
      function pe(type, x) {
        view.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 13, isPrimary: true, pointerType: 'touch' }));
      }
      pe('pointerdown', rect.left + rect.width * 0.85);
      pe('pointermove', rect.left + rect.width * 0.55);
      pe('pointerup', rect.left + rect.width * 0.3);
      await new Promise(function (r) { setTimeout(r, 700); });
      snap.page3 = window.ReaderView.current().pageIndex;
      snap.p3 = window.Store.findBook('${id}').progress.percent;
      /* 键盘 ← 退回一页 */
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
      await new Promise(function (r) { setTimeout(r, 600); });
      snap.pageBack = window.ReaderView.current().pageIndex;
      /* 点中间：收起工具栏；Esc：恢复 */
      tapAt(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5);
      await new Promise(function (r) { setTimeout(r, 150); });
      snap.hidden = document.documentElement.classList.contains('rv-chrome-off');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise(function (r) { setTimeout(r, 500); });
      snap.shown = document.documentElement.classList.contains('rv-chrome-off');
      snap.indAfter = (view.querySelector('.rv-page-ind') || {}).textContent || '';
      return JSON.stringify(snap);
    `);
    if (paging) {
      check('翻页方式：设置里能切到「整页翻页」并写进 readerPageMode', paging.hasChip && paging.stored === 'page' && paging.mode === 'page', JSON.stringify(paging));
      check('真分页：正文按屏分列（列宽 ' + paging.colW + 'px × 高 ' + paging.colH + 'px），页数 = scrollWidth/列宽 = ' + paging.pagesByScroll,
        paging.hasPaged && !paging.hasStage && paging.colW > 120 && paging.colH > 120 &&
        paging.pagesByScroll >= 2 && paging.pagesByScroll === paging.pageCount, JSON.stringify(paging));
      check('真分页：只排版当前一章、页面本身不滚动（已排版 ' + paging.paintedChapters + ' 章）',
        paging.paintedChapters === 1 && paging.scrollable === false && paging.pagers === 1, JSON.stringify(paging));
      check('页码指示：右下角显示「' + paging.ind + '」含全书百分比',
        /第 1 \/ \d+ 页/.test(paging.ind) && /%/.test(paging.ind) && paging.indOn === true, JSON.stringify(paging));
      check('翻页动画：覆盖式翻页时新页带 rv-cover-left + 阴影（' + String(paging.midShadow).slice(0, 34) + '…）',
        /rv-cover-left/.test(paging.midCls) && /rgb/.test(String(paging.midShadow)), JSON.stringify(paging));
      check('翻页：点右侧 / 键盘 → / 横向滑动都能翻页，页码与进度递增（' +
        [paging.pageIndex, paging.page1, paging.page2, paging.page3].join(' → ') + '）',
        paging.page1 === 1 && paging.page2 === 2 && paging.page3 === 3 &&
        paging.p1 > paging.p0 && paging.p2 > paging.p1 && paging.p3 > paging.p2, JSON.stringify(paging));
      check('翻页：页码指示随翻页更新（' + paging.ind1 + '），键盘 ← 能退回（第 ' + (paging.pageBack + 1) + ' 页）',
        /第 2 \/ \d+ 页/.test(paging.ind1) && paging.pageBack === 2 && paging.pagers1 === 1, JSON.stringify(paging));
      check('分页模式下点中间收起工具栏、Esc 恢复', paging.hidden === true && paging.shown === false, JSON.stringify(paging));
    }

    /* ---------------- 7. 翻到章末自动进入下一章 ---------------- */
    const chapTurn = await grab('翻到章末', `
      var view = document.getElementById('view');
      var guard = 0;
      while (guard < 40) {
        var l = window.ReaderView.current();
        if (l.pageIndex >= l.pageCount - 1) break;
        document.querySelector('[data-rv="next"]').click();
        await new Promise(function (r) { setTimeout(r, 380); });
        guard++;
      }
      var atEnd = window.ReaderView.current();
      var endInd = (view.querySelector('.rv-page-ind') || {}).textContent || '';
      document.querySelector('[data-rv="next"]').click();
      await new Promise(function (r) { setTimeout(r, 500); });
      var next = window.ReaderView.current();
      var nextInd = (view.querySelector('.rv-page-ind') || {}).textContent || '';
      /* 再往前退：应该回到上一章的最后一页 */
      document.querySelector('[data-rv="prev"]').click();
      await new Promise(function (r) { setTimeout(r, 500); });
      var back = window.ReaderView.current();
      return JSON.stringify({
        turns: guard,
        atEndChapter: atEnd.idx, atEndPage: atEnd.pageIndex, atEndPages: atEnd.pageCount, endInd: endInd,
        nextChapter: next.idx, nextPage: next.pageIndex, nextPages: next.pageCount, nextInd: nextInd,
        backChapter: back.idx, backPage: back.pageIndex, backPages: back.pageCount,
        percent: next.percent
      });
    `);
    if (chapTurn) {
      check('章末翻页：翻到本章最后一页（第 ' + (chapTurn.atEndPage + 1) + '/' + chapTurn.atEndPages + ' 页）',
        chapTurn.atEndPage === chapTurn.atEndPages - 1, JSON.stringify(chapTurn));
      check('章末翻页：再翻一次进入下一章首页（第 ' + chapTurn.atEndChapter + ' 章 → 第 ' + chapTurn.nextChapter + ' 章）',
        chapTurn.nextChapter === chapTurn.atEndChapter + 1 && chapTurn.nextPage === 0 &&
        /第 1 \/ \d+ 页/.test(chapTurn.nextInd), JSON.stringify(chapTurn));
      check('章首回翻：退到上一章的最后一页（第 ' + (chapTurn.backPage + 1) + '/' + chapTurn.backPages + ' 页）',
        chapTurn.backChapter === chapTurn.atEndChapter && chapTurn.backPage === chapTurn.backPages - 1, JSON.stringify(chapTurn));
    }

    /* ---------------- 8. 翻页后重开：恢复到同一页 ---------------- */
    const resumePage = await grab('分页进度还原', `
      var view = document.getElementById('view');
      /* 停到本章第 4 页 */
      var guard = 0;
      while (window.ReaderView.current().pageIndex < 3 && guard < 40) {
        document.querySelector('[data-rv="next"]').click();
        await new Promise(function (r) { setTimeout(r, 380); });
        guard++;
      }
      var before = window.ReaderView.current();
      var stored = window.Store.findBook('${id}').progress;
      /* 离开再进来（等价于刷新页面后重新打开这本书） */
      window.UI.go('reader');
      await new Promise(function (r) { setTimeout(r, 400); });
      window.UI.go('read/${id}/start');
      await new Promise(function (r) { setTimeout(r, 1200); });
      var after = window.ReaderView.current();
      var ind = (view.querySelector('.rv-page-ind') || {}).textContent || '';
      return JSON.stringify({
        beforeChapter: before.idx, beforePage: before.pageIndex, beforePages: before.pageCount,
        storedChapter: stored.chapterIndex, storedPage: stored.pageIndex, storedPages: stored.pageCount,
        afterChapter: after.idx, afterPage: after.pageIndex, afterPages: after.pageCount, ind: ind
      });
    `);
    if (resumePage) {
      check('分页进度：存下「章 + 页号 + 页数」（第 ' + (resumePage.storedPage + 1) + '/' + resumePage.storedPages + ' 页）',
        resumePage.storedChapter === resumePage.beforeChapter && resumePage.storedPage === resumePage.beforePage &&
        resumePage.storedPages === resumePage.beforePages, JSON.stringify(resumePage));
      check('分页进度：重新打开回到同一页（第 ' + (resumePage.afterPage + 1) + '/' + resumePage.afterPages + ' 页）',
        resumePage.afterChapter === resumePage.beforeChapter && resumePage.afterPage === resumePage.beforePage, JSON.stringify(resumePage));
    }

    /* ---------------- 9. 滑动翻页：两层一起平移 ---------------- */
    const slide = await grab('滑动翻页', `
      window.Store.setSetting('readerPageMode', 'slide');
      window.UI.go('reader');
      await new Promise(function (r) { setTimeout(r, 350); });
      window.Store.setBookProgress('${id}', { chapterIndex: 0, chapterFrac: 0, percent: 0, scroll: 0, pageIndex: 0, pageCount: 0 });
      window.UI.go('read/' + '${id}' + '/start');
      await new Promise(function (r) { setTimeout(r, 1100); });
      var view = document.getElementById('view');
      var rect = view.getBoundingClientRect();
      var mode = window.ReaderView.current().mode;
      var live0 = window.ReaderView.current();
      var p0 = live0.percent;
      var y = rect.top + rect.height * 0.5;
      function pe(type, x) {
        view.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 13, isPrimary: true, pointerType: 'touch' }));
      }
      /* 横向滑动：手指从右往左 */
      pe('pointerdown', rect.left + rect.width * 0.85);
      pe('pointermove', rect.left + rect.width * 0.55);
      await new Promise(function (r) { setTimeout(r, 60); });
      var inc = view.querySelector('.rv-pager.rv-layer-next');
      var cur = null;
      view.querySelectorAll('.rv-pager').forEach(function (n) { if (!n.classList.contains('rv-layer-next')) cur = n; });
      var midCls = inc ? inc.className : '';
      var curT = cur ? getComputedStyle(cur).transform : '';
      pe('pointerup', rect.left + rect.width * 0.3);
      await new Promise(function (r) { setTimeout(r, 700); });
      var p1 = window.Store.findBook('${id}').progress.percent;
      var page1 = window.ReaderView.current().pageIndex;
      /* 底部「下一页」按钮 */
      document.querySelector('[data-rv="next"]').click();
      await new Promise(function (r) { setTimeout(r, 700); });
      var p2 = window.Store.findBook('${id}').progress.percent;
      var page2 = window.ReaderView.current().pageIndex;
      var pagers = view.querySelectorAll('.rv-pager').length;
      return JSON.stringify({ mode: mode, layout: live0.layout, p0: p0, p1: p1, p2: p2, page1: page1, page2: page2, midCls: midCls, curT: curT, pagers: pagers, pageCount: live0.pageCount });
    `);
    if (slide) {
      check('滑动翻页：横向滑动翻一页，进度前进（' + slide.p0.toFixed(3) + ' → ' + slide.p1.toFixed(3) + '）',
        slide.mode === 'slide' && slide.layout === 'paged' && slide.page1 === 1 && slide.p1 > slide.p0, JSON.stringify(slide));
      check('滑动翻页：平移动画 —— 新页没有覆盖阴影，旧页同时位移（transform=' + String(slide.curT).slice(0, 26) + '…）',
        /rv-layer-next/.test(slide.midCls) && !/rv-cover/.test(slide.midCls) && /matrix/.test(String(slide.curT)), JSON.stringify(slide));
      check('滑动翻页：底部「下一页」按钮同样生效，动画结束后只剩一层',
        slide.page2 === 2 && slide.p2 > slide.p1 && slide.pagers === 1 && slide.pageCount >= 2, JSON.stringify(slide));
    }

    /* ---------------- 10. 字号变了要重新分列 ---------------- */
    const restyle = await grab('分页跟随字号', `
      document.querySelector('[data-rv="settings"]').click();
      await new Promise(function (r) { setTimeout(r, 400); });
      var fs = document.querySelectorAll('#sheetBody input[type="range"]')[0];
      var colH = document.querySelector('#view .rv-pages').clientHeight;
      var before = window.ReaderView.current().pageCount;
      var pageBefore = window.ReaderView.current().pageIndex;
      fs.value = '30';
      fs.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 1100); });
      var after = window.ReaderView.current().pageCount;
      var ind = (document.querySelector('#view .rv-page-ind') || {}).textContent || '';
      var fontSize = getComputedStyle(document.querySelector('#view .rv-pages')).fontSize;
      fs.value = '18';
      fs.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 1100); });
      var restored = window.ReaderView.current().pageCount;
      window.UI.closeSheet();
      await new Promise(function (r) { setTimeout(r, 250); });
      return JSON.stringify({ colH: colH, before: before, after: after, restored: restored, pageBefore: pageBefore, fontSize: fontSize, ind: ind });
    `);
    if (restyle) {
      check('分页跟随字号：字号 18→30 后重新分列、页数变多（' + restyle.before + ' → ' + restyle.after + ' 页，字号 ' + restyle.fontSize + '）',
        restyle.fontSize === '30px' && restyle.after > restyle.before && /第 \d+ \/ \d+ 页/.test(restyle.ind), JSON.stringify(restyle));
      check('分页跟随字号：字号调回后页数还原（' + restyle.restored + ' 页）', restyle.restored === restyle.before, JSON.stringify(restyle));
    }

    /* ---------------- 10. 仿真翻页（卷曲） ---------------- */
    const curl = await grab('仿真翻页', `
      var id = '${id}';
      /* 设置里选中「仿真翻页」（分页模式下的推荐项） */
      document.querySelector('[data-rv="settings"]').click();
      await new Promise(function (r) { setTimeout(r, 400); });
      var chip = document.querySelector('button.chip[data-rv="mode-curl"]');
      var hasChip = !!chip && /仿真翻页/.test(chip.textContent);
      var rec = !!(chip && chip.querySelector('.rv-chip-rec'));
      chip.click();
      await new Promise(function (r) { setTimeout(r, 280); });
      var stored = window.Store.state.settings.readerPageMode;
      window.UI.closeSheet();
      /* 离开再进来：走的就是 curl 版式 */
      window.UI.go('reader');
      await new Promise(function (r) { setTimeout(r, 400); });
      window.Store.setBookProgress(id, { chapterIndex: 0, chapterFrac: 0, percent: 0, scroll: 0, pageIndex: 0, pageCount: 0 });
      window.UI.go('read/' + id + '/start');
      await new Promise(function (r) { setTimeout(r, 1200); });

      var view = document.getElementById('view');
      var live0 = window.ReaderView.current();
      var r0 = view.getBoundingClientRect();
      var W = view.querySelector('.rv-pages').clientWidth;
      var y = r0.top + r0.height * 0.5;
      function pd(x) { view.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 31, isPrimary: true, pointerType: 'touch' })); }
      function pm(x) { view.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 31, isPrimary: true, pointerType: 'touch' })); }
      function pu(x) { view.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 31, isPrimary: true, pointerType: 'touch' })); }
      function flapInfo() {
        var fl = view.querySelector('.rv-curl-flap');
        var sh = view.querySelector('.rv-curl-sheet');
        return {
          flaps: view.querySelectorAll('.rv-curl-flap').length,
          pagers: view.querySelectorAll('.rv-pager').length,
          clip: !!(fl && /^polygon/.test(fl.style.clipPath || '')),
          clipHead: fl ? (fl.style.clipPath || '').slice(0, 30) : '',
          mirror: sh ? sh.style.transform : '',
          sheet: !!sh,
          shade: !!view.querySelector('.rv-curl-shade'),
          flatShade: !!view.querySelector('.rv-curl-flat-shade'),
          underShade: !!view.querySelector('.rv-curl-under-shade'),
          shadeCss: view.querySelector('.rv-curl-shade') ? view.querySelector('.rv-curl-shade').style.cssText : ''
        };
      }

      /* a) 横向拖 45%：页面跟着手指走 */
      var x0 = r0.left + r0.width - 20;
      var drag = W * 0.45;
      pd(x0);
      for (var k = 1; k <= 6; k++) { pm(x0 - drag * k / 6); await new Promise(function (r) { setTimeout(r, 30); }); }
      await new Promise(function (r) { setTimeout(r, 60); });
      var mid = flapInfo();
      mid.p = window.ReaderView.current().curlP;
      mid.dir = window.ReaderView.current().curlDir;
      pu(x0 - drag);
      await new Promise(function (r) { setTimeout(r, 750); });
      var afterDrag = window.ReaderView.current();
      var dragLayers = flapInfo();

      /* b) 只拖 18%：松手回弹，页码不变 */
      var beforeBack = window.ReaderView.current();
      pd(x0);
      for (var k2 = 1; k2 <= 5; k2++) { pm(x0 - W * 0.18 * k2 / 5); await new Promise(function (r) { setTimeout(r, 30); }); }
      var backMidFlap = view.querySelectorAll('.rv-curl-flap').length;
      pu(x0 - W * 0.18);
      await new Promise(function (r) { setTimeout(r, 90); });
      var goFlag = window.ReaderView.current().curlGo;
      await new Promise(function (r) { setTimeout(r, 700); });
      var afterBack = window.ReaderView.current();
      var backLayers = flapInfo();

      /* c) 点右侧 1/4：走同一套卷曲动画 */
      var beforeTap = window.ReaderView.current();
      pd(r0.left + r0.width * 0.9);
      pu(r0.left + r0.width * 0.9);
      await new Promise(function (r) { setTimeout(r, 140); });
      var tapMid = flapInfo();
      await new Promise(function (r) { setTimeout(r, 700); });
      var afterTap = window.ReaderView.current();

      /* d) 快速连点两次：不能叠层 */
      pd(r0.left + r0.width * 0.9); pu(r0.left + r0.width * 0.9);
      await new Promise(function (r) { setTimeout(r, 70); });
      pd(r0.left + r0.width * 0.9); pu(r0.left + r0.width * 0.9);
      await new Promise(function (r) { setTimeout(r, 900); });
      var afterRapid = window.ReaderView.current();
      var rapidLayers = flapInfo();

      return JSON.stringify({
        hasChip: hasChip, rec: rec, stored: stored, mode0: live0.mode, layout0: live0.layout,
        pages: live0.pageCount, pageBefore: live0.pageIndex, pctBefore: live0.percent,
        mid: mid, afterDrag: { page: afterDrag.pageIndex, pct: afterDrag.percent },
        dragLayers: dragLayers,
        backMidFlap: backMidFlap, goFlag: goFlag,
        beforeBack: beforeBack.pageIndex, afterBack: afterBack.pageIndex, backLayers: backLayers,
        beforeTap: beforeTap.pageIndex, tapPage: afterTap.pageIndex, tapMid: tapMid,
        rapidPage: afterRapid.pageIndex, rapidLayers: rapidLayers
      });
    `);
    if (curl) {
      check('仿真翻页：设置里能选中并生效（推荐项，readerPageMode=' + curl.stored + '）',
        curl.hasChip && curl.rec && curl.stored === 'curl' && curl.mode0 === 'curl' && curl.layout0 === 'paged' && curl.pages >= 2,
        JSON.stringify(curl));
      check('仿真翻页：拖动时页面跟着手指走（进度 ' + Number(curl.mid && curl.mid.p).toFixed(2) + '，折痕 + 镜像纸背 + 明暗都在）',
        curl.mid && curl.mid.flaps === 1 && curl.mid.pagers === 2 && curl.mid.clip && curl.mid.mirror === 'scaleX(-1)' &&
        curl.mid.sheet && curl.mid.shade && curl.mid.flatShade && curl.mid.underShade && curl.mid.p > 0.3 && curl.mid.dir === 1,
        JSON.stringify(curl.mid));
      check('仿真翻页：拖过 38% 松手翻过去（第 ' + (curl.pageBefore + 1) + ' 页 → 第 ' + (curl.afterDrag.page + 1) + ' 页）',
        curl.afterDrag.page === curl.pageBefore + 1 && curl.afterDrag.pct > curl.pctBefore,
        JSON.stringify(curl));
      check('仿真翻页：动画结束只剩一层 DOM（.rv-pager=' + curl.dragLayers.pagers + '，卷曲层=' + curl.dragLayers.flaps + '）',
        curl.dragLayers.pagers === 1 && curl.dragLayers.flaps === 0 && !curl.dragLayers.clip, JSON.stringify(curl.dragLayers));
      check('仿真翻页：只拖 18% 松手会回弹（判定 go=' + curl.goFlag + '，页码 ' + (curl.beforeBack + 1) + ' → ' + (curl.afterBack + 1) + '）',
        curl.backMidFlap === 1 && curl.goFlag === false && curl.afterBack === curl.beforeBack, JSON.stringify(curl));
      check('仿真翻页：回弹后同样只剩一层、不留裁剪',
        curl.backLayers.pagers === 1 && curl.backLayers.flaps === 0 && !curl.backLayers.clip, JSON.stringify(curl.backLayers));
      check('仿真翻页：点右侧 1/4 也走卷曲动画并翻页（第 ' + (curl.beforeTap + 1) + ' → 第 ' + (curl.tapPage + 1) + ' 页）',
        curl.tapMid.flaps === 1 && curl.tapMid.clip && curl.tapPage === curl.beforeTap + 1, JSON.stringify(curl.tapMid));
      check('仿真翻页：快速连点不叠层（连点两次后 .rv-pager=' + curl.rapidLayers.pagers + '，卷曲层=' + curl.rapidLayers.flaps + '）',
        curl.rapidPage > curl.tapPage && curl.rapidLayers.pagers === 1 && curl.rapidLayers.flaps === 0, JSON.stringify(curl.rapidLayers));
    }

    /* ---------------- 11. 切章 / 切模式 / 字号后不留动画层 ---------------- */
    const noLeftover = await grab('卷曲无残留', `
      var view = document.getElementById('view');
      function state() {
        return {
          mode: window.ReaderView.current().mode, ch: window.ReaderView.current().idx,
          pagers: view.querySelectorAll('.rv-pager').length,
          flaps: view.querySelectorAll('.rv-curl-flap').length,
          clips: view.querySelectorAll('.rv-pager[style*="clip-path"]').length
        };
      }
      /* 拖动到一半直接切章（目录跳转） */
      var r0 = view.getBoundingClientRect();
      var W = view.querySelector('.rv-pages').clientWidth;
      var y = r0.top + r0.height * 0.5;
      var x0 = r0.left + r0.width - 20;
      view.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x0, clientY: y, pointerId: 41, isPrimary: true, pointerType: 'touch' }));
      for (var k = 1; k <= 4; k++) {
        view.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: x0 - W * 0.3 * k / 4, clientY: y, pointerId: 41, isPrimary: true, pointerType: 'touch' }));
        await new Promise(function (r) { setTimeout(r, 25); });
      }
      var midDrag = state();
      document.querySelector('[data-rv="toc"]').click();
      await new Promise(function (r) { setTimeout(r, 420); });
      document.querySelector('#sheetBody .toc-item[data-chapter="3"]').click();
      await new Promise(function (r) { setTimeout(r, 1000); });
      var afterJump = state();
      /* 切模式：把五种都走一遍（模式标签循环） */
      var seen = [];
      for (var m = 0; m < 5; m++) {
        document.querySelector('[data-rv="mode-tag"]').click();
        await new Promise(function (r) { setTimeout(r, 750); });
        seen.push(state());
      }
      /* 回到 curl：改字号 → 重新分列，也不能留层 */
      var guardMode = 0;
      while (window.ReaderView.current().mode !== 'curl' && guardMode < 8) {
        document.querySelector('[data-rv="mode-tag"]').click();
        await new Promise(function (r) { setTimeout(r, 650); });
        guardMode++;
      }
      var beforeFont = state();
      document.querySelector('[data-rv="settings"]').click();
      await new Promise(function (r) { setTimeout(r, 400); });
      var fs = document.querySelectorAll('#sheetBody input[type="range"]')[0];
      fs.value = '28'; fs.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 1200); });
      var fontState = state();
      var fontPages = window.ReaderView.current().pageCount;
      fs.value = '18'; fs.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 1200); });
      window.UI.closeSheet();
      await new Promise(function (r) { setTimeout(r, 300); });
      var backState = state();
      return JSON.stringify({ midDrag: midDrag, afterJump: afterJump, seen: seen, beforeFont: beforeFont, fontState: fontState, fontPages: fontPages, backState: backState, pages: window.ReaderView.current().pageCount });
    `);
    if (noLeftover) {
      const s = noLeftover.seen || [];
      check('卷曲无残留：拖到一半切章不留动画层（.' + 'rv-pager=' + noLeftover.afterJump.pagers + '，卷曲层=' + noLeftover.afterJump.flaps + '）',
        noLeftover.midDrag.flaps === 1 && noLeftover.afterJump.pagers === 1 && noLeftover.afterJump.flaps === 0 &&
        noLeftover.afterJump.clips === 0 && noLeftover.afterJump.ch === 3, JSON.stringify(noLeftover));
      check('卷曲无残留：五种翻页方式互切后都不留层（' + s.map((x) => x.mode).join(' → ') + '）',
        s.length === 5 && s.every((x) => (x.mode === 'scroll' ? true : x.pagers === 1)) &&
        s.every((x) => x.flaps === 0 && x.clips === 0), JSON.stringify(s));
      check('卷曲无残留：改字号重新分列后也不留层（' + noLeftover.fontState.pagers + ' 层 / ' + noLeftover.fontPages + ' 页）',
        noLeftover.fontState.pagers === 1 && noLeftover.fontState.flaps === 0 && noLeftover.beforeFont.pagers === 1, JSON.stringify(noLeftover));
    }

    /* ---------------- 12. 柔和叠化（fade） ---------------- */
    const fade = await grab('柔和叠化', `
      var id = '${id}';
      /* 设置里选中「柔和叠化」，并确认五个选项都在 */
      document.querySelector('[data-rv="settings"]').click();
      await new Promise(function (r) { setTimeout(r, 420); });
      var chips = document.querySelectorAll('#sheetBody button.chip[data-rv^="mode-"]');
      var labels = [];
      chips.forEach(function (c) { labels.push(c.textContent.replace(/推荐/g, '').trim()); });
      var chip = document.querySelector('button.chip[data-rv="mode-fade"]');
      var hasChip = !!chip && /柔和叠化/.test(chip.textContent);
      chip.click();
      await new Promise(function (r) { setTimeout(r, 280); });
      var stored = window.Store.state.settings.readerPageMode;
      var activeCls = (document.querySelector('#sheetBody button.chip[data-rv="mode-fade"]') || {}).className || '';
      window.UI.closeSheet();
      /* 离开再进来：走的就是 fade 版式 */
      window.UI.go('reader');
      await new Promise(function (r) { setTimeout(r, 400); });
      window.Store.setBookProgress(id, { chapterIndex: 0, chapterFrac: 0, percent: 0, scroll: 0, pageIndex: 0, pageCount: 0 });
      window.UI.go('read/' + id + '/start');
      await new Promise(function (r) { setTimeout(r, 1200); });

      var view = document.getElementById('view');
      var live0 = window.ReaderView.current();
      var r0 = view.getBoundingClientRect();
      var y = r0.top + r0.height * 0.5;
      function pd(x, yy) { view.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: yy, pointerId: 51, isPrimary: true, pointerType: 'touch' })); }
      function pm(x, yy) { view.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: x, clientY: yy, pointerId: 51, isPrimary: true, pointerType: 'touch' })); }
      function pu(x, yy) { view.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: yy, pointerId: 51, isPrimary: true, pointerType: 'touch' })); }
      function fadeState() {
        var cur = view.querySelector('.rv-pager');
        return {
          pagers: view.querySelectorAll('.rv-pager').length,
          fading: view.querySelectorAll('.rv-fade-next').length,
          fadingOut: view.querySelectorAll('.rv-fade-out').length,
          opacity: cur ? getComputedStyle(cur).opacity : '',
          inlineOpacity: cur ? (cur.style.opacity || '') : 'x',
          inlineTransform: cur ? (cur.style.transform || '') : 'x'
        };
      }

      /* a) 点右侧 1/4：页码 +1，动画类出现 */
      var beforeTap = window.ReaderView.current();
      pd(r0.left + r0.width * 0.9, y);
      pu(r0.left + r0.width * 0.9, y);
      await new Promise(function (r) { setTimeout(r, 90); });
      var mid = fadeState();
      await new Promise(function (r) { setTimeout(r, 400); });
      var afterTap = window.ReaderView.current();
      var settled = fadeState();

      /* b) 键盘 → 翻页 */
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      await new Promise(function (r) { setTimeout(r, 500); });
      var afterKey = window.ReaderView.current();

      /* c) 横向滑动翻页（手指从右往左甩） */
      pd(r0.left + r0.width * 0.85, y);
      pm(r0.left + r0.width * 0.6, y);
      pm(r0.left + r0.width * 0.3, y);
      pu(r0.left + r0.width * 0.3, y);
      await new Promise(function (r) { setTimeout(r, 600); });
      var afterSwipe = window.ReaderView.current();

      /* d) 快速连点两次：不叠层 */
      pd(r0.left + r0.width * 0.9, y); pu(r0.left + r0.width * 0.9, y);
      await new Promise(function (r) { setTimeout(r, 60); });
      pd(r0.left + r0.width * 0.9, y); pu(r0.left + r0.width * 0.9, y);
      await new Promise(function (r) { setTimeout(r, 600); });
      var afterRapid = window.ReaderView.current();
      var rapid = fadeState();

      /* e) 切章 / 改字号后不残留 */
      document.querySelector('[data-rv="toc"]').click();
      await new Promise(function (r) { setTimeout(r, 420); });
      document.querySelector('#sheetBody .toc-item[data-chapter="2"]').click();
      await new Promise(function (r) { setTimeout(r, 1000); });
      var afterJump = fadeState();
      var jumpChapter = window.ReaderView.current().idx;
      document.querySelector('[data-rv="settings"]').click();
      await new Promise(function (r) { setTimeout(r, 420); });
      var fs = document.querySelectorAll('#sheetBody input[type="range"]')[0];
      fs.value = '28'; fs.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 1200); });
      var afterFont = fadeState();
      var fontPages = window.ReaderView.current().pageCount;
      fs.value = '18'; fs.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 1200); });
      window.UI.closeSheet();
      await new Promise(function (r) { setTimeout(r, 300); });
      var afterFontBack = fadeState();
      var backPages = window.ReaderView.current().pageCount;

      return JSON.stringify({
        chipCount: chips.length, labels: labels, hasChip: hasChip, stored: stored, activeCls: activeCls,
        mode0: live0.mode, layout0: live0.layout, pages: live0.pageCount, page0: live0.pageIndex,
        mid: mid, tapPage: afterTap.pageIndex, settled: settled,
        keyPage: afterKey.pageIndex, swipePage: afterSwipe.pageIndex,
        rapidPage: afterRapid.pageIndex, rapid: rapid,
        afterJump: afterJump, jumpChapter: jumpChapter,
        afterFont: afterFont, fontPages: fontPages, afterFontBack: afterFontBack, backPages: backPages
      });
    `);
    if (fade) {
      check('柔和叠化：设置里五个翻页方式都在、能选中并高亮（' + (fade.labels || []).join(' / ') + '）',
        fade.chipCount === 5 && fade.hasChip && fade.stored === 'fade' && /active/.test(fade.activeCls) &&
        ['连续滚动', '整页翻页', '滑动翻页', '仿真翻页', '柔和叠化'].every((x) => (fade.labels || []).indexOf(x) >= 0),
        JSON.stringify(fade));
      check('柔和叠化：打开后生效（' + fade.mode0 + ' / ' + fade.layout0 + '，' + fade.pages + ' 页）',
        fade.mode0 === 'fade' && fade.layout0 === 'paged' && fade.pages >= 2, JSON.stringify(fade));
      check('柔和叠化：点右侧翻页时叠化动画类出现（淡出 ' + fade.mid.fadingOut + ' 层 / 淡入 ' + fade.mid.fading + ' 层）',
        fade.mid.fading === 1 && fade.mid.fadingOut === 1 && fade.mid.pagers === 2, JSON.stringify(fade.mid));
      check('柔和叠化：点击翻页后页码 +1（第 ' + (fade.page0 + 1) + ' → 第 ' + (fade.tapPage + 1) + ' 页）',
        fade.tapPage === fade.page0 + 1, JSON.stringify(fade));
      check('柔和叠化：动画结束后只剩一层、动画类与内联覆盖都清干净（.rv-pager=' + fade.settled.pagers + '，opacity=' + fade.settled.opacity + '）',
        fade.settled.pagers === 1 && fade.settled.fading === 0 && fade.settled.fadingOut === 0 &&
        fade.settled.opacity === '1' && fade.settled.inlineOpacity === '' && fade.settled.inlineTransform === '', JSON.stringify(fade.settled));
      check('柔和叠化：键盘 → 与横向滑动都能翻页（第 ' + (fade.keyPage + 1) + ' 页 → 第 ' + (fade.swipePage + 1) + ' 页）',
        fade.keyPage === fade.tapPage + 1 && fade.swipePage === fade.keyPage + 1, JSON.stringify(fade));
      check('柔和叠化：快速连点不叠层（.rv-pager=' + fade.rapid.pagers + ' / 淡入层=' + fade.rapid.fading + '）',
        fade.rapidPage > fade.swipePage && fade.rapid.pagers === 1 && fade.rapid.fading === 0, JSON.stringify(fade));
      check('柔和叠化：切章 / 改字号重新分列后都不残留（第 ' + (fade.jumpChapter + 1) + ' 章，页数 ' + fade.fontPages + '→' + fade.backPages + '）',
        fade.afterJump.pagers === 1 && fade.afterJump.fading === 0 && fade.jumpChapter === 2 &&
        fade.afterFont.pagers === 1 && fade.afterFont.fading === 0 && fade.fontPages > fade.pages &&
        fade.afterFontBack.pagers === 1 && fade.backPages === fade.pages, JSON.stringify(fade));
    }

    /* ---------------- 13. 五种翻页方式互切 ---------------- */
    const modes = await grab('五种模式互切', `
      var view = document.getElementById('view');
      var out = { snaps: [] };
      function snap() {
        var live = window.ReaderView.current();
        return {
          mode: live.mode, layout: live.layout, chapter: live.idx,
          stage: !!view.querySelector('.rv-stage'), paged: !!view.querySelector('.rv-paged'),
          ind: !!view.querySelector('.rv-page-ind.rv-on'),
          pagers: view.querySelectorAll('.rv-pager').length,
          fading: view.querySelectorAll('.rv-fade-next, .rv-fade-out').length,
          flaps: view.querySelectorAll('.rv-curl-flap').length,
          clips: view.querySelectorAll('.rv-pager[style*="clip-path"]').length,
          pageCount: live.pageCount
        };
      }
      var startChapter = window.ReaderView.current().idx;
      var startMode = window.ReaderView.current().mode;
      /* 模式标签点了就换下一种，点 5 次刚好回到起点那一种 */
      for (var i = 0; i < 5; i++) {
        document.querySelector('[data-rv="mode-tag"]').click();
        await new Promise(function (r) { setTimeout(r, 750); });
        out.snaps.push(snap());
      }
      out.final = snap();
      out.startChapter = startChapter;
      out.startMode = startMode;
      out.stored = window.Store.state.settings.readerPageMode;
      return JSON.stringify(out);
    `);
    if (modes) {
      const s = modes.snaps || [];
      const kinds = s.map((x) => x.mode).sort().join(',');
      check('五种翻页方式互切：模式标签循环一圈能全部切到（' + s.map((x) => x.mode).join(' → ') + '）',
        s.length === 5 && kinds === 'curl,fade,page,scroll,slide' &&
        s.every((x) => (x.mode === 'scroll' ? (x.stage && !x.paged) : (x.paged && !x.stage))), JSON.stringify(modes));
      check('五种翻页方式互切：切模式不丢章节、回到起点那一种、不留动画层、页码指示只在分页模式出现',
        modes.final && modes.final.chapter === modes.startChapter && modes.final.mode === modes.startMode &&
        s.filter((x) => x.mode === 'scroll').every((x) => x.ind === false) &&
        s.filter((x) => x.mode !== 'scroll').every((x) => x.ind === true) &&
        s.every((x) => x.flaps === 0 && x.clips === 0 && x.fading === 0), JSON.stringify(modes));
    }

    /* ---------------- 8. 书签：点亮 / 正文 / 列表 / 目录 ---------------- */
    const mark = await grab('书签', `
      var id = '${id}';
      var before = window.Store.findBook(id).bookmarks.length;
      document.querySelector('[data-rv="bookmark"]').click();
      await new Promise(function (r) { setTimeout(r, 300); });
      var after = window.Store.findBook(id).bookmarks.length;
      var btn = document.querySelector('[data-rv="bookmark"]');
      var lit = btn.classList.contains('on') && btn.getAttribute('aria-pressed') === 'true';
      var chapter = window.ReaderView.current().idx;
      var ribbon = document.querySelectorAll('#view h2.rv-has-mark .rv-ribbon').length;
      var ticks = document.querySelectorAll('#view .rv-rail-tick').length;
      /* 阅读操作：书签列表 */
      document.querySelector('[data-rv="more"]').click();
      await new Promise(function (r) { setTimeout(r, 350); });
      var rows = document.querySelectorAll('#sheetBody .row[data-mark]').length;
      var listText = document.getElementById('sheetBody').textContent;
      var menuHeart = !!document.querySelector('#sheetBody .rv-like-wide');
      window.UI.closeSheet();
      await new Promise(function (r) { setTimeout(r, 250); });
      /* 目录：有书签的章被标记，与「在读」区分 */
      document.querySelector('[data-rv="toc"]').click();
      await new Promise(function (r) { setTimeout(r, 400); });
      var marked = document.querySelectorAll('#sheetBody .toc-item.rv-toc-marked').length;
      var active = document.querySelectorAll('#sheetBody .toc-item.active').length;
      var activeRow = document.querySelector('#sheetBody .toc-item.active');
      var activeMarked = !!(activeRow && activeRow.classList.contains('rv-toc-marked'));
      var markedRow = document.querySelector('#sheetBody .toc-item.rv-toc-marked');
      var markedChapter = markedRow ? Number(markedRow.getAttribute('data-chapter')) : -1;
      window.UI.closeSheet();
      /* 再点一次按钮：书签取消、按钮熄灭 */
      await new Promise(function (r) { setTimeout(r, 200); });
      document.querySelector('[data-rv="bookmark"]').click();
      await new Promise(function (r) { setTimeout(r, 300); });
      var offCount = window.Store.findBook(id).bookmarks.length;
      var offLit = document.querySelector('[data-rv="bookmark"]').classList.contains('on');
      /* 再补回来一个，后面还要用 */
      document.querySelector('[data-rv="bookmark"]').click();
      await new Promise(function (r) { setTimeout(r, 300); });
      return JSON.stringify({
        before: before, after: after, lit: lit, chapter: chapter, ribbon: ribbon, ticks: ticks,
        rows: rows, menuHeart: menuHeart, listText: listText.slice(0, 100),
        marked: marked, active: active, activeMarked: activeMarked, markedChapter: markedChapter,
        offCount: offCount, offLit: offLit, back: window.Store.findBook(id).bookmarks.length
      });
    `);
    if (mark) {
      check('书签：点一下加书签并点亮按钮（' + mark.before + ' → ' + mark.after + '）', mark.after === mark.before + 1 && mark.lit, JSON.stringify(mark));
      check('书签：再点一下取消书签、按钮熄灭', mark.offCount === mark.before && mark.offLit === false && mark.back === mark.before + 1, JSON.stringify(mark));
      check('书签：正文里画出章标题丝带、侧边进度条上有刻度', mark.ribbon >= 1 && mark.ticks >= 1, JSON.stringify(mark));
      check('书签：出现在书签列表里（' + mark.rows + ' 条），菜单里有收藏爱心', mark.rows >= 1 && mark.menuHeart, JSON.stringify(mark));
      check('书签：目录里标出有书签的章（第 ' + (mark.markedChapter + 1) + ' 章），与「在读」行区分',
        mark.marked >= 1 && mark.markedChapter === mark.chapter && mark.active === 1 && mark.activeMarked === true, JSON.stringify(mark));
    }

    /* ---------------- 11. 切模式后：目录跳转 + 进度还原 ---------------- */
    const jump = await grab('目录跳转与进度还原', `
      var id = '${id}';
      document.querySelector('[data-rv="toc"]').click();
      await new Promise(function (r) { setTimeout(r, 400); });
      var row = document.querySelector('#sheetBody .toc-item[data-chapter="5"]');
      var hasRow = !!row;
      row.click();
      await new Promise(function (r) { setTimeout(r, 1000); });
      var afterJump = window.Store.findBook(id).progress;
      var liveJump = window.ReaderView.current();
      var modeBefore = liveJump.mode;
      /* 离开再回来：位置要还原（翻页方式也保持） */
      window.UI.go('reader');
      await new Promise(function (r) { setTimeout(r, 400); });
      window.UI.go('read/' + id + '/start');
      await new Promise(function (r) { setTimeout(r, 1100); });
      var p2 = window.Store.findBook(id).progress;
      var live = window.ReaderView.current();
      return JSON.stringify({
        hasRow: hasRow, jumpIdx: afterJump.chapterIndex, liveIdx: liveJump ? liveJump.idx : -1,
        jumpPage: liveJump ? liveJump.pageIndex : -1, modeBefore: modeBefore,
        restoreIdx: p2.chapterIndex, liveRestoreIdx: live ? live.idx : -1,
        restorePage: live ? live.pageIndex : -1, restorePages: live ? live.pageCount : -1,
        mode: live ? live.mode : '', layout: live ? live.layout : '', percent: p2.percent
      });
    `);
    if (jump) {
      check('目录跳转：分页模式下也能跳到第 6 章首页（chapterIndex=' + jump.jumpIdx + '，第 ' + (jump.jumpPage + 1) + ' 页）',
        jump.hasRow && jump.jumpIdx === 5 && jump.liveIdx === 5 && jump.jumpPage === 0, JSON.stringify(jump));
      check('进度还原：重新打开仍停在第 6 章首页（第 ' + (jump.restorePage + 1) + '/' + jump.restorePages + ' 页）',
        jump.restoreIdx === 5 && jump.liveRestoreIdx === 5 && jump.restorePage === 0 && jump.restorePages >= 1, JSON.stringify(jump));
      check('进度还原：翻页方式保持不变（' + jump.mode + '，分页版式）',
        jump.mode === jump.modeBefore && jump.layout === 'paged', JSON.stringify(jump));
    }

    /* ---------------- 12. 连续滚动模式仍然可用 ---------------- */
    const back = await grab('回到连续滚动', `
      window.Store.setSetting('readerPageMode', 'scroll');
      window.Store.setBookProgress('${id}', { chapterIndex: 0, chapterFrac: 0, percent: 0, scroll: 0 });
      window.UI.go('reader');
      await new Promise(function (r) { setTimeout(r, 350); });
      window.UI.go('read/' + '${id}' + '/start');
      await new Promise(function (r) { setTimeout(r, 1100); });
      var view = document.getElementById('view');
      var live0 = window.ReaderView.current();
      var before = window.Store.findBook('${id}').progress.percent;
      var painted = view.querySelectorAll('.reader-stage:not(.pending)').length;
      var pending = view.querySelectorAll('.reader-stage.pending').length;
      view.style.scrollBehavior = 'auto';
      view.scrollTop = view.scrollTop + view.clientHeight * 2;
      void view.scrollTop;
      view.style.removeProperty('scroll-behavior');
      await new Promise(function (r) { setTimeout(r, 700); });
      var after = window.Store.findBook('${id}').progress.percent;
      return JSON.stringify({
        mode: live0.mode, layout: live0.layout, before: before, after: after,
        stage: !!view.querySelector('.rv-stage'), paged: !!view.querySelector('.rv-paged'),
        painted: painted, pending: pending, ind: !!view.querySelector('.rv-page-ind.rv-on')
      });
    `);
    if (back) {
      check('连续滚动：回到滚动版式后仍是渐进渲染（已排版 ' + back.painted + ' 章 / 占位 ' + back.pending + ' 章，没有页码指示）',
        back.mode === 'scroll' && back.layout === 'scroll' && back.stage && !back.paged &&
        back.painted >= 1 && back.painted <= 8 && back.pending >= 1 && back.ind === false, JSON.stringify(back));
      check('连续滚动：滚动后进度继续跟进（' + back.before.toFixed(3) + ' → ' + back.after.toFixed(3) + '）',
        back.after > back.before, JSON.stringify(back));
    }

    /* ---------------- 11. 离开阅读页后不留痕迹 ---------------- */
    const leave = await grab('离开阅读页', `
      window.UI.go('reader');
      await new Promise(function (r) { setTimeout(r, 500); });
      var view = document.getElementById('view');
      return JSON.stringify({
        chromeClass: document.documentElement.classList.contains('rv-chrome-off'),
        modeScroll: view.classList.contains('rv-mode-scroll'),
        modePage: view.classList.contains('rv-mode-page'),
        modeSlide: view.classList.contains('rv-mode-slide'),
        rail: view.querySelectorAll('.rv-rail').length,
        appbarActions: document.querySelectorAll('.rv-appbar-actions').length
      });
    `);
    if (leave) {
      check('离开阅读页：收起状态、翻页模式类、进度条与顶栏按钮都清干净',
        leave.chromeClass === false && leave.modeScroll === false && leave.modePage === false &&
        leave.modeSlide === false && leave.rail === 0 && leave.appbarActions === 0, JSON.stringify(leave));
    }

    /* ---------------- 18. 控制台报错 ---------------- */
    /* 只对「阅读器自己的报错」负责：别的模块（可能有并行开发中的文件）的报错记录但不判失败 */
    const allErrs = page.errors().filter((e) => !/favicon/i.test(e.text));
    const mineErrs = allErrs.filter((e) => !/@http/.test(e.text) || /view-reader\.js/.test(e.text));
    const otherErrs = allErrs.filter((e) => mineErrs.indexOf(e) < 0);
    check('整轮检查没有控制台报错（阅读器自身）', mineErrs.length === 0,
      mineErrs.slice(0, 6).map((e) => e.type + ': ' + e.text).join(' | ') +
      (otherErrs.length ? ' ／其它模块报错（非阅读器，仅记录）: ' + otherErrs.slice(0, 2).map((e) => e.text.slice(0, 140)).join(' | ') : ''));
    if (otherErrs.length) {
      console.log('       （记录：本次有 ' + otherErrs.length + ' 条来自其它模块的报错，与阅读器无关）');
    }

    await page.shot('shots/test-reader.png');
  } catch (e) {
    failed++;
    console.log('FAIL  运行异常: ' + String((e && e.stack) || e).split('\n').slice(0, 4).join(' ⏎ '));
  } finally {
    try { if (page) page.close(); } catch (e) { /* noop */ }
    try { if (browser && browser.proc) browser.proc.kill(); } catch (e) { /* noop */ }
  }

  console.log('');
  console.log('===== 阅读器：' + passed + '/' + (passed + failed) + ' 通过 =====');
  if (failed) {
    console.log('（Edge: ' + (() => { try { return findEdge(); } catch (e) { return '未找到'; } })() + '）');
    process.exitCode = 1;
  }
})();
