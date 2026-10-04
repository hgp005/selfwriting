/* ==========================================================================
   selfwriting · tools/test-diary.js
   日记 / 日历专项验证（开发用，不属于应用本体）：
     · 农历引擎：春节 / 中秋 / 闰月 / 节气 / 假期与已知日期对得上
     · 日历：圆形日期格 + 当天数量角标 + 农历小字 + 今天圆环 + 选中态
     · 底色：法定假日 / 周末＝绿，调休上班的周末与普通工作日＝黄
     · 点日期 → 直接进入那一天的写作（大按钮 + 自动聚焦 + 保存）
     · 长按 550ms ＝ 收藏这一天（写进 book.favs）并进入多选
     · 长按后滑动 / 点选多个日期 → 一篇跨天日记（fromKey / toKey / range）
     · 多人创作入口就在日记页上，保存后参与者写进条目
     · 时区选择器改变时钟与「今天」，未来日期写不进去
     · 记录本模块页自带日历，不用先进「新建记录本」

   用法： node tools/test-diary.js [port]
   ========================================================================== */
'use strict';

const { launch, Page, findEdge, sleep } = require('./driver');

const PORT = process.argv[2] || '8099';
const BASE = 'http://127.0.0.1:' + PORT + '/';

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

/* 页面里的小工具：点击 / 长按 / 滑动 / 找按钮 */
const HELPERS = `
  window.__d = {
    q: function (sel, root) { return (root || document).querySelector(sel); },
    qa: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
    wait: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
    go: async function (path, ms) { window.UI.go(path); await window.__d.wait(ms || 700); return window.UI.currentPath(); },
    book: function (id) { return window.Store.findDiary(id); },
    today: function () { return window.U.today(); },
    shift: function (k, n) { return window.U.shiftDate(k || window.U.today(), n); },
    cell: function (key) { return document.querySelector('.cal-day[data-key="' + key + '"]'); },
    cells: function () { return window.__d.qa('.cal-grid .cal-day'); },
    cellCls: function (key) { var c = window.__d.cell(key); return c ? c.className : '(缺格)'; },
    subText: function (key) { var c = window.__d.cell(key); var s = c ? c.querySelector('.lunar') : null; return s ? s.textContent : ''; },
    numBg: function (key) {
      var c = window.__d.cell(key);
      if (!c) return '';
      var n = c.querySelector('.num');
      return n ? getComputedStyle(n).backgroundColor : '';
    },
    numRound: function (key) {
      var c = window.__d.cell(key);
      if (!c) return '';
      var n = c.querySelector('.num');
      if (!n) return '';
      var r = n.getBoundingClientRect();
      return getComputedStyle(n).borderRadius + '|' + Math.round(r.width) + 'x' + Math.round(r.height);
    },
    center: function (key) {
      var c = window.__d.cell(key);
      if (!c) return null;
      var r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    /** 任意节点的中心点（面板里的日期格没有 data-key 查询器） */
    cellCenter: function (node) {
      if (!node) return null;
      var r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    /** 一次「真实的」单击：pointerdown + pointerup + click(detail=1) */
    tap: function (node, x, y, id) {
      if (!node) return false;
      var p = (x === undefined || x === null) ? window.__d.cellCenter(node) : { x: x, y: y };
      var pid = id || 1;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: pid, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: pid, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: p.x, clientY: p.y }));
      return true;
    },
    seeCal: function () {
      var g = document.querySelector('.cal-grid');
      if (g && g.scrollIntoView) g.scrollIntoView({ block: 'center' });
    },
    down: function (key) {
      var c = window.__d.cell(key);
      if (!c) return false;
      var p = window.__d.center(key);
      c.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true,
        clientX: p.x, clientY: p.y
      }));
      return true;
    },
    press: async function (key, ms) {
      if (!window.__d.down(key)) return false;
      await window.__d.wait(ms || 620);
      return true;
    },
    up: function () {
      var g = document.querySelector('.cal-grid');
      if (!g) return false;
      g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true }));
      return true;
    },
    btn: function (re, root) {
      return window.__d.qa('button', root).filter(function (b) { return re.test(b.textContent); })[0] || null;
    },
    clickBtn: function (re, root) {
      var b = window.__d.btn(re, root);
      if (!b) return false;
      b.click();
      return true;
    },
    clickFoot: function (re) { return window.__d.clickBtn(re, document.getElementById('sheetFoot')); },
    text: function () { return document.getElementById('view').innerText; },
    sheetText: function () { return (document.getElementById('sheetBody') || {}).innerText || ''; },
    view: function () { return document.getElementById('view'); },
    /* 长按 + 滑动都要用到坐标：先把日历滚到屏幕中间 */
    readyCal: async function (key, ms) {
      window.__d.seeCal();
      await window.__d.wait(250);
      return window.__d.cell(key) ? true : false;
    }
  };
  'ok';
`;

(async () => {
  let browser = null;
  let page = null;
  try {
    browser = await launch({});
    page = await Page.open(browser, BASE);
    await page.freshCache();
    await page.hardGoto(BASE);
    await sleep(1400);

    const boot = await page.eval('!!(window.UI && window.Store && window.U && window.Lunar && window.DiaryView)');
    if (!boot) {
      const txt = await page.text();
      throw new Error('应用没启动完（UI/Store/U/Lunar/DiaryView 缺失）：' + String(txt).slice(0, 200));
    }
    await page.call(HELPERS);
    console.log('运行环境：' + String(await page.eval('navigator.userAgent')).slice(0, 90));
    console.log('参考时间：' + String(await page.eval('window.U.today() + " · " + window.U.tzLabel() + " · " + window.U.tzClock(true) + " · " + window.U.weekdayCN(window.U.today())')));

    /* ---------------- 0. 造数据 ---------------- */
    const setup = JSON.parse(String(await page.call(`
      if (window.__selfwritingDemo) window.__selfwritingDemo();
      await window.__d.wait(1000);
      var S = window.Store, U2 = window.U;
      var bk = S.createDiaryBook({ title: '日历验证本', kind: 'daily', countAchievements: false });
      var t = U2.today();
      S.addDiaryEntry(bk.id, { dateKey: t, content: '日历验证：今天第一篇', mood: '平静' });
      S.addDiaryEntry(bk.id, { dateKey: t, content: '日历验证：今天第二篇' });
      await S.flushNow();
      window.__bk = bk.id;
      /* 长按 / 滑动用的日子：挑一个 40 天前的月份，保证整段都在同一个月里
         又都是过去的日子（不受「今天是几号」影响） */
      var mk = U2.shiftDate(t, -40).slice(0, 7);
      window.__mk = mk;
      return JSON.stringify({ bookId: bk.id, today: t, mk: mk, first: (S.state.diaries[0] || {}).id });
    `)));
    const BK = setup.bookId;
    const MK = setup.mk;
    console.log('验证用记录本：' + BK + ' · 今天 ' + setup.today + ' · 长按用月份 ' + MK);

    const moduleReady = JSON.parse(String(await page.call(`
      await window.__d.go('diary', 800);
      var txt = window.__d.text();
      return JSON.stringify({ hasList: /记录本/.test(txt) && /篇/.test(txt), hasCal: window.__d.cells().length >= 35 });
    `)));
    check('准备：记录本模块页可以打开，列表与日历都在', moduleReady.hasList && moduleReady.hasCal, JSON.stringify(moduleReady));

    /* ---------------- 1. 农历引擎 ---------------- */
    const lunar = JSON.parse(String(await page.call(`
      var L = window.Lunar;
      var g = function (k) { var o = L.solarToLunar(k); return o ? (o.year + '-' + o.month + '-' + o.day + (o.isLeap ? 'L' : '')) : 'null'; };
      return JSON.stringify({
        spring2024: g('2024-02-10'), spring2025: g('2025-01-29'), spring2026: g('2026-02-17'),
        mid2024: g('2024-09-17'), mid2025: g('2025-10-06'), mid2026: g('2026-09-25'),
        leap: g('2025-07-25'), monthName: (L.solarToLunar('2026-02-17') || {}).monthName,
        l23: L.lunarText('2026-02-10'), l1: L.lunarText('2026-02-17'), l15: L.lunarText('2026-09-25'),
        l9: L.lunarText('2026-02-25'),
        termQingming: L.solarTerm('2025-04-04'), termQiufen: L.solarTerm('2026-09-23'), termLichun: L.solarTerm('2026-02-04'),
        h1: L.holiday('2026-09-25'), h2: L.holiday('2026-09-20'), h3: L.holiday('2026-02-17'),
        h4: L.holiday('2027-06-09'), h5: L.holiday('2026-02-14'), h6: L.holiday('2026-05-01'),
        none: L.holiday('2026-09-24')
      });
    `)));
    check('农历：2024 / 2025 / 2026 春节都是正月初一',
      lunar.spring2024 === '2024-1-1' && lunar.spring2025 === '2025-1-1' && lunar.spring2026 === '2026-1-1',
      JSON.stringify(lunar));
    check('农历：2024 / 2025 / 2026 中秋都是八月十五（月名也为「正月」这类中文）',
      lunar.mid2024 === '2024-8-15' && lunar.mid2025 === '2025-8-15' && lunar.mid2026 === '2026-8-15' && lunar.monthName === '正月',
      JSON.stringify(lunar));
    check('农历：闰月正确（2025 闰六月）；小字为 初一 / 正月 / 十五 / 腊月廿三 / 初九',
      lunar.leap === '2025-6-1L' && lunar.l1 === '正月' && lunar.l15 === '十五' && lunar.l23 === '腊月廿三' && lunar.l9 === '初九',
      JSON.stringify(lunar));
    check('节气：清明 / 秋分 / 立春（近似公式，代码注释里写明 ±1 天）',
      lunar.termQingming === '清明' && lunar.termQiufen === '秋分' && lunar.termLichun === '立春',
      JSON.stringify(lunar));
    check('假期：法定假日 / 调休上班 / 表外年份规则推算 / 平常日子为 null',
      lunar.h1 && lunar.h1.type === 'holiday' && lunar.h1.name === '中秋节' &&
      lunar.h2 && lunar.h2.type === 'workday-swap' &&
      lunar.h3 && lunar.h3.type === 'holiday' && lunar.h3.name === '春节' &&
      lunar.h4 && lunar.h4.type === 'holiday' && lunar.h4.name === '端午节' &&
      lunar.h5 && lunar.h5.type === 'workday-swap' &&
      lunar.h6 && lunar.h6.type === 'holiday' && lunar.h6.name === '劳动节' &&
      lunar.none === null,
      JSON.stringify(lunar));

    /* ---------------- 2. 日历渲染：圆形日期 + 数量角标 + 农历小字 ---------------- */
    await page.call(`await window.__d.go('diary/' + window.__bk + '/' + window.__d.today(), 800);`);
    const cal = JSON.parse(String(await page.call(`
      var t = window.__d.today();
      var cell = window.__d.cell(t);
      var cnt = cell ? cell.querySelector('.cnt') : null;
      var round = window.__d.numRound(t).split('|');
      return JSON.stringify({
        cells: window.__d.cells().length,
        radius: round[0], size: round[1],
        badge: cnt ? cnt.textContent : '',
        badgeVisible: cnt ? cnt.style.display !== 'none' : false,
        lunar: window.__d.subText(t),
        isToday: cell ? /\\btoday\\b/.test(cell.className) : false,
        title: (window.__d.q('.cal-title') || {}).textContent || '',
        ctaTitle: (window.__d.q('.day-cta-title') || {}).textContent || '',
        clock: (window.__d.q('.cal-clock') || {}).innerText || ''
      });
    `)));
    const sizeM = /^(\d+)x(\d+)$/.exec(cal.size || '');
    const roundOk = !!sizeM && sizeM[1] === sizeM[2] && Number(sizeM[1]) >= 20 && Number(sizeM[1]) <= 44;
    check('日历：整月渲染出圆形日期格（7 的倍数、圆角 50%、宽高相等）',
      cal.cells >= 35 && cal.cells % 7 === 0 && /50%/.test(cal.radius) && roundOk,
      JSON.stringify(cal));
    check('日历：当天的日记数量显示为角标（这一天写了 2 篇）',
      cal.badge === '2' && cal.badgeVisible, JSON.stringify(cal));
    check('日历：数字下面有农历小字，今天带 today 状态，标题是年月',
      !!cal.lunar && cal.isToday && /年/.test(cal.title) && /月/.test(cal.title), JSON.stringify(cal));
    check('日历：头部有时钟（时区 + 时分秒 + 星期）',
      /UTC\+8/.test(cal.clock) && /\d{2}:\d{2}:\d{2}/.test(cal.clock) && /周[一二三四五六日]/.test(cal.clock),
      JSON.stringify(cal));

    /* ---------------- 3. 底色规则 ---------------- */
    await page.call(`await window.__d.go('diary/' + window.__bk + '/2026-02-24', 800);`);
    const colors = JSON.parse(String(await page.call(`
      var cls = window.__d.cellCls.bind(window.__d);
      return JSON.stringify({
        holiday: cls('2026-02-17'), weekend: cls('2026-02-01'), weekday: cls('2026-02-25'),
        swap: cls('2026-02-14'),
        bgHoliday: window.__d.numBg('2026-02-17'), bgWeekend: window.__d.numBg('2026-02-01'),
        bgWeekday: window.__d.numBg('2026-02-25'), bgSwap: window.__d.numBg('2026-02-14'),
        subHoliday: window.__d.subText('2026-02-17'), subSwap: window.__d.subText('2026-02-14'),
        subLunar: window.__d.subText('2026-02-25'),
        subLunarExpect: window.Lunar.lunarText('2026-02-25')
      });
    `)));
    check('底色：法定假日（春节）＝绿色类，普通工作日＝黄色类（两种颜色确实不同）',
      /\brest\b/.test(colors.holiday) && /\bholiday\b/.test(colors.holiday) &&
      /\bwork\b/.test(colors.weekday) && !/\brest\b/.test(colors.weekday) &&
      !!colors.bgHoliday && colors.bgHoliday !== colors.bgWeekday,
      JSON.stringify(colors));
    check('底色：普通周末＝绿色类，和法定假日用同一套绿底',
      /\brest\b/.test(colors.weekend) && colors.bgWeekend === colors.bgHoliday,
      JSON.stringify(colors));
    check('底色：调休上班的周末按工作日走（黄色 + swap 类 + 小字「班」）',
      /\bwork\b/.test(colors.swap) && !/\brest\b/.test(colors.swap) && /\bswap\b/.test(colors.swap) &&
      colors.bgSwap === colors.bgWeekday && colors.subSwap === '班',
      JSON.stringify(colors));
    check('日历小字：法定假日显示节日名（春节），平常日子显示农历日',
      colors.subHoliday === '春节' && !!colors.subLunar && colors.subLunar === colors.subLunarExpect,
      JSON.stringify(colors));

    /* ---------------- 4. 今天：单独圆环；选中日期与今天不同 ---------------- */
    const marks = JSON.parse(String(await page.call(`
      await window.__d.go('diary/' + window.__bk + '/' + window.__d.today(), 800);
      var t = window.__d.today();
      var todayCell = window.__d.cell(t);
      var csToday = getComputedStyle(todayCell.querySelector('.num'));
      var bgToday = csToday.backgroundColor;
      var probe = window.__d.shift(t, -1);
      var other = window.__d.cell(probe);
      return JSON.stringify({
        todayRing: csToday.boxShadow, todayBg: bgToday,
        otherRing: other ? getComputedStyle(other.querySelector('.num')).boxShadow : '',
        todaySelected: /\\bsel\\b/.test(todayCell.className),
        otherSelected: other ? /\\bsel\\b/.test(other.className) : null,
        futureCells: window.__d.qa('.cal-day.future').length
      });
    `)));
    check('日历：今天有单独的圆环；其它日期没有这个环，也没有被标成「已选」',
      /rgb|rgba|color/.test(marks.todayRing) && marks.todaySelected && marks.otherSelected === false &&
      marks.otherRing !== marks.todayRing,
      JSON.stringify(marks));

    /* ---------------- 5. 点日期 → 直接写那一天 ---------------- */
    const pick = JSON.parse(String(await page.call(`
      var S = window.Store;
      var target = window.__d.shift(window.__d.today(), -4);
      var cell = window.__d.cell(target);
      if (!cell) return JSON.stringify({ err: '没有 ' + target + ' 这一格' });
      cell.click();
      await window.__d.wait(700);
      var path = window.UI.currentPath();
      var ctaTitle = (window.__d.q('.day-cta-title') || {}).textContent || '';
      var cta = window.__d.q('.day-cta-btn');
      var ctaLabel = cta ? cta.textContent : '';
      if (cta) cta.click();
      await window.__d.wait(800);
      var ta = window.__d.q('#sheetBody textarea');
      var focused = document.activeElement === ta;
      if (ta) { ta.value = '点日期就开始写：这一行来自自动化验证。'; ta.dispatchEvent(new Event('input')); }
      window.__d.clickFoot(/保存/);
      await window.__d.wait(900);
      var list = S.diaryEntriesOf(window.__bk, target);
      return JSON.stringify({
        target: target, path: path, ctaTitle: ctaTitle, ctaLabel: ctaLabel, hasCta: !!cta,
        focused: focused,
        saved: list.length === 1 && list[0].content.indexOf('点日期就开始写') >= 0,
        onPage: window.__d.text().indexOf('点日期就开始写') >= 0
      });
    `)));
    check('点日期：路由切到那一天，当日面板出现大按钮「写这一天的日记」',
      pick.path === 'diary/' + BK + '/' + pick.target && pick.hasCta &&
      /写这一天的日记/.test(pick.ctaTitle || '') && /写一篇/.test(pick.ctaLabel || ''),
      JSON.stringify(pick));
    check('点日期：一键打开编辑器并自动聚焦，保存后正好落在这一天',
      pick.focused && pick.saved && pick.onPage, JSON.stringify(pick));

    /* ---------------- 6. 双击＝收藏；长按抬起＝弹「选这几天」 ---------------- */
    const KD = MK + '-16';                       // 双击收藏用
    const K10 = MK + '-10', K12 = MK + '-12';    // 长按 + 滑动用
    const dbl = JSON.parse(String(await page.call(`
      var S = window.Store, U2 = window.U;
      var k = window.__mk + '-16', other = window.__mk + '-17';
      await window.__d.go('diary/' + window.__bk + '/' + k, 800);
      /* 双击：两次 pointerup，间隔 < 300ms、位移为 0（每次都配一次真实 click） */
      function doubleTap() {
        var cell = window.__d.cell(k);
        window.__d.tap(cell, null, null, 1);
        window.__d.tap(cell, null, null, 1);
      }
      var pathBefore = window.UI.currentPath();
      doubleTap();
      await window.__d.wait(500);
      var favs1 = (S.findDiary(window.__bk).favs || []).slice();
      var cellNow = window.__d.cell(k);
      var marker = cellNow ? cellNow.querySelector('.fav') : null;
      /* 立刻取值：同一个 span 会被下一次（取消收藏）改写，不能等到最后再读 */
      var markerOn = !!marker && marker.style.display !== 'none';
      var diag = {
        dupCells: window.__d.qa('.cal-day[data-key="' + k + '"]').length,
        cellClass: cellNow ? cellNow.className : '(no-cell)',
        visibleFavs: window.__d.qa('.cal-day .fav').filter(function (m) { return m.style.display !== 'none'; })
          .map(function (m) { return m.parentNode.getAttribute('data-key'); }).join(','),
        calTitle: (window.__d.q('.cal-title') || {}).textContent || ''
      };
      var toast = (document.getElementById('toastHost') || {}).innerText || '';
      var selCells = window.__d.qa('.cal-day.inrange').length;
      var pathAfterFav = window.UI.currentPath();
      doubleTap();
      await window.__d.wait(500);
      var favs2 = (S.findDiary(window.__bk).favs || []).slice();
      var markerOff = window.__d.cell(k) ? window.__d.cell(k).querySelector('.fav').style.display === 'none' : null;
      /* 单击（detail=1）仍然要能进那一天：等一小会儿就会跳过去 */
      window.__d.tap(window.__d.cell(other), null, null, 2);
      await window.__d.wait(700);
      var pathAfterSingle = window.UI.currentPath();
      return JSON.stringify({
        k: k, other: other, pathBefore: pathBefore, pathAfterFav: pathAfterFav,
        on: favs1.indexOf(k) >= 0, markerOn: markerOn,
        toast: toast, selCells: selCells, diag: diag,
        off: favs2.indexOf(k) < 0, markerOff: markerOff,
        pathAfterSingle: pathAfterSingle
      });
    `)));
    check('双击日期＝收藏：book.favs 写入、格子上出现小红心、给出「已收藏」提示',
      dbl.on && dbl.markerOn && /已收藏/.test(dbl.toast || ''), JSON.stringify(dbl));
    check('双击收藏：不会把页面带走，也不会进入选择状态；再双击一次取消',
      dbl.pathAfterFav === dbl.pathBefore && dbl.selCells === 0 && dbl.off && dbl.markerOff === true,
      JSON.stringify(dbl));
    check('单击仍然是「进那一天写日记」（双击判定不会把单击吃掉）',
      dbl.pathAfterSingle === 'diary/' + BK + '/' + dbl.other, JSON.stringify(dbl));

    const lp = JSON.parse(String(await page.call(`
      var S = window.Store, U2 = window.U;
      var k1 = window.__mk + '-10', k2 = window.__mk + '-12';
      await window.__d.go('diary/' + window.__bk + '/' + k1, 800);
      await window.__d.readyCal(k1);
      var favsBefore = (S.findDiary(window.__bk).favs || []).slice();
      var entriesBefore = S.findDiary(window.__bk).entries.length;
      await window.__d.press(k1, 620);                       // 按住 620ms
      var armedCls = window.__d.cell(k1).className;
      window.__d.up();                                       // 抬手 → 弹面板
      await window.__d.wait(600);
      var title = (window.__d.q('#sheetTitle') || {}).textContent || '';
      var panel = !!window.__d.q('#sheetBody .rp-strip');
      var rangeText = (window.__d.q('#sheetBody .rp-range') || {}).textContent || '';
      var steps = window.__d.qa('#sheetBody .rp-step').length;
      var footBtns = window.__d.qa('#sheetFoot .btn').map(function (b) { return b.textContent; }).join('/');
      var dayCells = window.__d.qa('#sheetBody .rp-day').length;
      var favsDuring = (S.findDiary(window.__bk).favs || []).slice();
      var marker = window.__d.cell(k1) ? window.__d.cell(k1).querySelector('.fav') : null;
      var calFav = favsDuring.indexOf(k1) >= 0 || (marker && marker.style.display !== 'none');
      var calHi = window.__d.qa('.cal-day.inrange').length;
      return JSON.stringify({
        k1: k1, k2: k2, armedCls: armedCls, title: title, panel: panel, rangeText: rangeText,
        steps: steps, footBtns: footBtns, dayCells: dayCells,
        favsBefore: favsBefore, calFav: calFav, calHi: calHi, entriesBefore: entriesBefore
      });
    `)));
    check('长按 550ms：按住时格子进入 armed 状态（松手才弹面板）',
      /\barmed\b/.test(lp.armedCls || ''), JSON.stringify(lp));
    check('长按抬起：立刻弹出「选这几天」面板（区间文字 / 前后一天微调 / 日期带 / 取消 / 写这几天）',
      /选这几天/.test(lp.title || '') && lp.panel && /1 天/.test(lp.rangeText || '') &&
      lp.steps === 2 && lp.dayCells >= 15 &&
      /取消/.test(lp.footBtns || '') && /写这几天的日记/.test(lp.footBtns || ''),
      JSON.stringify(lp));
    check('长按不再收藏：弹层出现时日历没有进入收藏状态，也没有写进 book.favs',
      lp.calFav === false && (lp.favsBefore || []).indexOf(K10) < 0, JSON.stringify(lp));
    check('选择高亮：面板打开时，日历上对应的格子是 inrange 高亮',
      lp.calHi === 1, JSON.stringify(lp));

    /* ---------------- 6b. 面板里滑动两天 → 写一篇跨天日记 ---------------- */
    const slide = JSON.parse(String(await page.call(`
      var S = window.Store, U2 = window.U;
      var k1 = window.__mk + '-10', k2 = window.__mk + '-12';
      var strip = window.__d.q('#sheetBody .rp-strip');
      var cA = window.__d.q('#sheetBody .rp-day[data-key="' + k1 + '"]');
      var cB = window.__d.q('#sheetBody .rp-day[data-key="' + k2 + '"]');
      var pA = window.__d.cellCenter(cA), pB = window.__d.cellCenter(cB);
      /* 按住起点 → 滑到第二个日期 → 抬手 */
      cA.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: pA.x, clientY: pA.y }));
      strip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: pB.x, clientY: pB.y }));
      strip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: pB.x, clientY: pB.y }));
      strip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: pB.x, clientY: pB.y }));
      await window.__d.wait(350);
      var rangeText = (window.__d.q('#sheetBody .rp-range') || {}).textContent || '';
      var inCells = window.__d.qa('#sheetBody .rp-day.in').length;
      var calHi = window.__d.qa('.cal-day.inrange').length;
      /* 微调：后一天 → 3 天 */
      var before = rangeText;
      window.__d.qa('#sheetBody .rp-step')[1].click();
      await window.__d.wait(250);
      var afterStep = (window.__d.q('#sheetBody .rp-range') || {}).textContent || '';
      window.__d.qa('#sheetBody .rp-step')[0].click();
      await window.__d.wait(250);
      var afterStep2 = (window.__d.q('#sheetBody .rp-range') || {}).textContent || '';
      /* 写这几天 */
      window.__d.clickFoot(/写这几天的日记/);
      await window.__d.wait(800);
      var editorOpen = !!window.__d.q('#sheetBody textarea');
      var editorText = window.__d.sheetText();
      var ta = window.__d.q('#sheetBody textarea');
      if (ta) { ta.value = '跨天验证：这几天一起写。'; ta.dispatchEvent(new Event('input')); }
      window.__d.clickFoot(/保存/);
      await window.__d.wait(1100);
      var es = S.findDiary(window.__bk).entries.filter(function (e) { return e.range; });
      var en = es[0] || {};
      return JSON.stringify({
        rangeText: rangeText, inCells: inCells, calHi: calHi, before: before,
        afterStep: afterStep, afterStep2: afterStep2, editorOpen: editorOpen,
        editorHasRange: editorText.indexOf(k1) >= 0 && editorText.indexOf(k2) >= 0,
        count: es.length,
        stored: { from: en.fromKey, to: en.toKey, range: en.range, dateKey: en.dateKey, content: en.content },
        calHiAfter: window.__d.qa('.cal-day.inrange').length,
        badgeOnPage: window.__d.text().indexOf('跨天') >= 0
      });
    `)));
    check('面板里按住滑动两个日期：选成 3 天（面板与日历同时高亮）',
      /3 天/.test(slide.rangeText || '') && slide.inCells === 3 && slide.calHi === 3,
      JSON.stringify(slide));
    check('面板里的「前一天 / 后一天」可以逐天微调区间',
      slide.afterStep !== slide.before && /[24] 天/.test(slide.afterStep || '') &&
      slide.afterStep2 !== slide.afterStep && /3 天/.test(slide.afterStep2 || ''),
      JSON.stringify(slide));
    check('面板里点「写这几天的日记」：存下 fromKey / toKey / range:true 的跨天记录',
      slide.count === 1 && slide.stored.from === K10 && slide.stored.to === K12 &&
      slide.stored.range === true && slide.stored.dateKey === K12 &&
      /跨天验证/.test(slide.stored.content || ''),
      JSON.stringify(slide.stored));
    check('跨天日记：编辑器里显示区间，保存后在当日面板按区间渲染（角标「跨天 · …」）',
      slide.editorOpen && slide.editorHasRange && slide.badgeOnPage && slide.calHiAfter === 0,
      JSON.stringify(slide));

    /* ---------------- 7. 面板里「点选」两天 + 取消 ---------------- */
    const tapSel = JSON.parse(String(await page.call(`
      var S = window.Store, U2 = window.U;
      var k3 = window.__mk + '-05', k4 = window.__mk + '-07';
      await window.__d.go('diary/' + window.__bk + '/' + k3, 800);
      await window.__d.readyCal(k3);
      await window.__d.press(k3, 620);
      window.__d.up();
      await window.__d.wait(600);
      var opened = !!window.__d.q('#sheetBody .rp-strip');
      /* 在面板里点第二个日期：点一下就把结束日挪过去 */
      function tap(key) {
        var c = window.__d.q('#sheetBody .rp-day[data-key="' + key + '"]');
        var p = window.__d.cellCenter(c);
        c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 4, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y }));
        document.querySelector('#sheetBody .rp-strip').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 4, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y }));
      }
      tap(k4);
      await window.__d.wait(300);
      var rangeText = (window.__d.q('#sheetBody .rp-range') || {}).textContent || '';
      var inCells = window.__d.qa('#sheetBody .rp-day.in').length;
      var calHi = window.__d.qa('.cal-day.inrange').length;
      var entriesBefore = S.findDiary(window.__bk).entries.length;
      window.__d.clickFoot(/取消/);
      await window.__d.wait(400);
      var sheetClosed = !window.__d.q('#sheetBody .rp-strip');
      var entriesAfter = S.findDiary(window.__bk).entries.length;
      return JSON.stringify({ k3: k3, k4: k4, opened: opened, rangeText: rangeText, inCells: inCells,
        calHi: calHi, sheetClosed: sheetClosed, calHiAfter: window.__d.qa('.cal-day.inrange').length,
        same: entriesBefore === entriesAfter });
    `)));
    check('面板里点选两个日期：同样选出这一段（3 天）',
      tapSel.opened && /3 天/.test(tapSel.rangeText || '') && tapSel.inCells === 3 && tapSel.calHi === 3,
      JSON.stringify(tapSel));
    check('面板点「取消」：面板收起、日历高亮清掉、不写入任何记录',
      tapSel.sheetClosed && tapSel.calHiAfter === 0 && tapSel.same, JSON.stringify(tapSel));

    /* ---------------- 7b. 桌面端：Shift+点击＝选这几天；日期格是按钮（键盘可用） ---------------- */
    const shiftSel = JSON.parse(String(await page.call(`
      var U2 = window.U;
      var k5 = window.__mk + '-20', k6 = window.__mk + '-22';
      await window.__d.go('diary/' + window.__bk + '/' + k5, 800);
      var cell = window.__d.cell(k6);
      var isButton = cell && cell.tagName === 'BUTTON';
      if (cell) cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
      await window.__d.wait(500);
      var opened = !!window.__d.q('#sheetBody .rp-strip');
      var anchored = window.__d.q('#sheetBody .rp-day[data-key="' + k6 + '"]');
      var anchoredIn = anchored ? /\\bin\\b/.test(anchored.className) : false;
      window.__d.clickFoot(/取消/);
      await window.__d.wait(300);
      return JSON.stringify({ k5: k5, k6: k6, isButton: isButton, opened: opened, anchoredIn: anchoredIn,
        closed: !window.__d.q('#sheetBody .rp-strip') });
    `)));
    check('桌面端：Shift+点击＝以那一天为起点弹「选这几天」；日期格是 button，键盘也能用',
      shiftSel.isButton && shiftSel.opened && shiftSel.anchoredIn && shiftSel.closed,
      JSON.stringify(shiftSel));

    /* ---------------- 8. 双击收藏可以取消；「收藏的日子」有入口且能跳转 ---------------- */
    const fav = JSON.parse(String(await page.call(`
      var S = window.Store, U2 = window.U;
      var k = window.__mk + '-15';
      await window.__d.go('diary/' + window.__bk + '/' + k, 800);
      /* 两条路径都覆盖：两次抬起（真实手指双击）+ 浏览器原生 dblclick */
      function doubleTap() {
        var cell = window.__d.cell(k);
        window.__d.tap(cell, null, null, 1);
        window.__d.tap(cell, null, null, 1);
      }
      doubleTap();
      await window.__d.wait(500);
      var on = (S.findDiary(window.__bk).favs || []).indexOf(k) >= 0;
      var cardDays = window.__d.qa('.fav-day').length;
      var hasCard = window.__d.text().indexOf('收藏的日子') >= 0 && cardDays >= 1;
      /* 点「收藏的日子」里的第一条 → 跳到那一天 */
      var favs = (S.findDiary(window.__bk).favs || []).slice();
      var dayBtn = window.__d.qa('.fav-day')[0];
      var jumped = null;
      if (dayBtn) { dayBtn.click(); await window.__d.wait(900); jumped = window.UI.currentPath(); }
      var jumpedOk = !!jumped && favs.some(function (f) { return jumped === 'diary/' + window.__bk + '/' + f; });
      /* 回到同一天，用原生 dblclick 再收藏一次 → 取消 */
      await window.__d.go('diary/' + window.__bk + '/' + k, 800);
      var cell = window.__d.cell(k);
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
      await window.__d.wait(500);
      var off = (S.findDiary(window.__bk).favs || []).indexOf(k) < 0;
      var marker = window.__d.cell(k) ? window.__d.cell(k).querySelector('.fav') : null;
      var markerOff = !!marker && marker.style.display === 'none';
      return JSON.stringify({ k: k, on: on, off: off, markerOff: markerOff, hasCard: hasCard,
        cardDays: cardDays, favs: favs, jumped: jumped, jumpedOk: jumpedOk });
    `)));
    check('双击收藏：两次抬起与原生 dblclick 两条路径都生效，再双击一次取消（小红心同步）',
      fav.on && fav.off && fav.markerOff === true, JSON.stringify(fav));
    check('「收藏的日子」：日记页上有这个列表，点一条就跳到那一天',
      fav.hasCard && fav.cardDays >= 1 && fav.jumpedOk, JSON.stringify(fav));

    /* ---------------- 9. 多人创作入口在日记页（保存后写进条目） ---------------- */
    const multi = JSON.parse(String(await page.call(`
      var S = window.Store, U2 = window.U;
      var t = U2.today();
      await window.__d.go('diary/' + window.__bk + '/' + t, 900);
      var entryBtn = window.__d.q('#view .day-tools .multi-entry');
      var label = entryBtn ? entryBtn.textContent : '';
      var hasEntry = !!entryBtn;
      if (entryBtn) entryBtn.click();
      await window.__d.wait(500);
      var sheetHas = /多人创作/.test(window.__d.sheetText()) && /一起写的人/.test(window.__d.sheetText());
      var sw = window.__d.q('#sheetBody .multi-box .switch');
      if (sw) sw.click();
      await window.__d.wait(250);
      var add = window.__d.qa('#sheetBody .multi-box .chip').filter(function (c) { return /其他人/.test(c.textContent); })[0];
      if (add) add.click();
      await window.__d.wait(450);
      var inp = window.__d.q('#modalBody input');
      if (inp) inp.value = '小李';
      var ok = window.__d.clickBtn(/确定/, document.getElementById('modalFoot'));
      await window.__d.wait(450);
      var chipAdded = /小李/.test(window.__d.sheetText());
      window.__d.clickFoot(/保存/);
      await window.__d.wait(1000);
      var es = S.diaryEntriesOf(window.__bk, t);
      var allMulti = es.length > 0 && es.every(function (e) {
        return (e.participants || []).indexOf('小李') >= 0 && (e.participants || []).length === 2 && e.multi === true;
      });
      return JSON.stringify({
        hasEntry: hasEntry, label: label, sheetHas: sheetHas, modalOk: ok, chipAdded: chipAdded,
        n: es.length, allMulti: allMulti,
        parts: es.map(function (e) { return (e.participants || []).join('/'); }),
        lineShown: /多人创作 · 参与者/.test(window.__d.text()),
        draft: window.DiaryView.draftOf(window.__bk, t)
      });
    `)));
    check('多人创作：日记页的当天面板上就有入口，不用先钻进编辑器',
      multi.hasEntry && /多人创作/.test(multi.label || '') && multi.sheetHas && multi.modalOk && multi.chipAdded,
      JSON.stringify(multi));
    check('多人创作：保存后参与者写进这一天的条目，并标出「多人创作 · 参与者」',
      multi.allMulti && multi.n >= 1 && multi.lineShown, JSON.stringify(multi));

    /* ---------------- 10. 未来日期写不进去 ---------------- */
    const future = JSON.parse(String(await page.call(`
      var S = window.Store, U2 = window.U;
      var t = U2.today(), tomorrow = U2.shiftDate(t, 1);
      window.UI.go('diary/' + window.__bk + '/' + tomorrow);
      await window.__d.wait(800);
      var path = window.UI.currentPath();
      var cells = window.__d.qa('.cal-day.future');
      var allDisabled = cells.length > 0 && cells.every(function (c) { return c.disabled === true; });
      if (cells[0]) cells[0].click();
      await window.__d.wait(300);
      var stayed = window.UI.currentPath() === path;
      window.__d.clickBtn(/写一篇|补写一篇|再写一篇/, window.__d.view());
      await window.__d.wait(800);
      var di = window.__d.q('#sheetBody input[type=date]');
      var maxAttr = di ? di.getAttribute('max') : '';
      if (di) { di.value = U2.shiftDate(t, 3); di.dispatchEvent(new Event('change')); }
      var pulledBack = di ? di.value === t : false;
      var ta = window.__d.q('#sheetBody textarea');
      if (ta) { ta.value = '不该出现在未来的记录'; ta.dispatchEvent(new Event('input')); }
      window.__d.clickFoot(/保存/);
      await window.__d.wait(1000);
      var leaked = S.findDiary(window.__bk).entries.filter(function (e) { return e.dateKey > U2.today(); });
      return JSON.stringify({ route: path, expect: 'diary/' + window.__bk + '/' + t, futureCells: cells.length,
        allDisabled: allDisabled, stayed: stayed, maxAttr: maxAttr, pulledBack: pulledBack,
        leaked: leaked.length, savedToday: S.diaryEntriesOf(window.__bk, t).length });
    `)));
    check('未来日期：路由自动回到今天；未来的格子全部禁用、点不动',
      future.route === future.expect && future.futureCells > 0 && future.allDisabled && future.stayed,
      JSON.stringify(future));
    check('未来日期：编辑器日期上限＝今天（选到未来会被拉回），保存后没有任何未来记录',
      future.maxAttr === setup.today && future.pulledBack && future.leaked === 0 && future.savedToday > 0,
      JSON.stringify(future));

    /* ---------------- 11. 时区选择器：时钟与「今天」都跟着走 ---------------- */
    const tz = JSON.parse(String(await page.call(`
      var S = window.Store, U2 = window.U;
      var before = { off: U2.tzOffset(), label: U2.tzLabel(), today: U2.today() };
      await window.__d.go('diary/' + window.__bk + '/' + U2.today(), 700);
      var clockBefore = (window.__d.q('.cal-clock') || {}).innerText || '';
      await window.__d.go('stats/settings', 700);
      var sel = window.__d.q('select.cal-tz-select');
      var opts = sel ? sel.options.length : 0;
      var changed = false;
      if (sel) {
        sel.value = '-600';
        sel.dispatchEvent(new Event('change'));
        await window.__d.wait(800);
        changed = S.state.settings.timeZone === -600 && U2.tzOffset() === -600;
      }
      await window.__d.go('diary/' + window.__bk + '/' + U2.today(), 800);
      var clockAfter = (window.__d.q('.cal-clock') || {}).innerText || '';
      /* 「今天」随时区走：把墙上时间挪过午夜（等于换了一天） */
      var now = new Date();
      var minsLeft = (24 * 60) - (now.getHours() * 60 + now.getMinutes());
      var far = (-now.getTimezoneOffset()) + Math.ceil((minsLeft + 30) / 60) * 60;
      var machineToday = U2.dateKey(now);
      S.setSetting('timeZone', far);
      await window.__d.wait(600);
      var shifted = U2.today();
      await window.__d.go('diary/' + window.__bk + '/' + U2.today(), 800);
      var calToday = window.__d.q('.cal-day.today');
      var cellKey = calToday ? calToday.getAttribute('data-key') : '';
      var badgeToday = /今天/.test((window.__d.q('.day-head') || {}).innerText || '');
      S.setSetting('timeZone', before.off);
      await window.__d.wait(500);
      return JSON.stringify({
        before: before, opts: opts, changed: changed, clockBefore: clockBefore, clockAfter: clockAfter,
        far: far, shifted: shifted, machineToday: machineToday, cellKey: cellKey, badgeToday: badgeToday,
        tzMoved: shifted !== machineToday, restored: U2.tzOffset() === before.off
      });
    `)));
    check('时区：设置页提供时区选择器（≥10 个时区），选择后存进设置并改变时钟',
      tz.opts >= 10 && tz.changed && /北京时间 UTC\+8/.test(tz.clockBefore || '') && /檀香山 UTC-10/.test(tz.clockAfter || ''),
      JSON.stringify(tz));
    check('时区：「今天」与日历上的今天格子跟着时区走（跨过午夜就换天），改回来也正常',
      tz.tzMoved && tz.cellKey === tz.shifted && tz.badgeToday && tz.restored,
      JSON.stringify(tz));

    /* ---------------- 12. 记录本模块页自带日历；没有记录本也能直接开始写 ---------------- */
    const modulePage = JSON.parse(String(await page.call(`
      var S = window.Store, U2 = window.U;
      await window.__d.go('diary', 800);
      var hasCal = window.__d.cells().length >= 35;
      /* 模块页的日历上双击一天＝收藏（顺带把「收藏的日子」摆出来） */
      var favDay = U2.shiftDate(U2.today(), -3);
      await window.__d.readyCal(favDay);
      var fc = window.__d.cell(favDay);
      window.__d.tap(fc, null, null, 1);
      window.__d.tap(fc, null, null, 1);
      await window.__d.wait(500);
      var tb = S.state.diaries.filter(function (b) { return b.kind === 'daily'; })[0] || S.state.diaries[0];
      var favWritten = tb ? S.isDiaryFav(tb.id, favDay) : false;
      var hasFav = window.__d.text().indexOf('收藏的日子') >= 0;
      var scopeChips = window.__d.qa('#view .chips .chip').length;
      var target = U2.shiftDate(U2.today(), -1);
      var cell = window.__d.cell(target);
      if (cell) cell.click();
      await window.__d.wait(800);
      var path = window.UI.currentPath();
      var daily = S.state.diaries.filter(function (b) { return b.kind === 'daily'; })[0] || S.state.diaries[0];
      return JSON.stringify({ hasCal: hasCal, hasFav: hasFav, favWritten: favWritten, scopeChips: scopeChips,
        target: target, path: path, expect: 'diary/' + daily.id + '/' + target });
    `)));
    check('记录本模块页：直接显示日历（含记录本切换与收藏入口），点日期就进那一天的写作',
      modulePage.hasCal && modulePage.hasFav && modulePage.favWritten && modulePage.scopeChips >= 2 &&
      modulePage.path === modulePage.expect,
      JSON.stringify(modulePage));

    const noBook = JSON.parse(String(await page.call(`
      var S = window.Store, U2 = window.U;
      S.state.diaries.slice().forEach(function (b) { S.deleteDiaryBook(b.id); });
      await S.flushNow();
      await window.__d.go('diary', 800);
      var hasCal = window.__d.cells().length >= 35;
      var target = U2.shiftDate(U2.today(), -2);
      var cell = window.__d.cell(target);
      if (cell) cell.click();
      await window.__d.wait(900);
      var created = S.state.diaries[0] || {};
      return JSON.stringify({ hasCal: hasCal, target: target, path: window.UI.currentPath(), n: S.state.diaries.length,
        title: created.title || '', expect: S.state.diaries.length ? 'diary/' + created.id + '/' + target : '' });
    `)));
    check('还没有记录本时：模块页照样有日历，点一天会自动建「我的日记」并开始写',
      noBook.hasCal && noBook.n === 1 && noBook.title === '我的日记' && noBook.path === noBook.expect,
      JSON.stringify(noBook));

    /* ---------------- 控制台报错 ---------------- */
    const errs = page.errors().filter((e) => !/favicon|manifest|DevTools/i.test(e.text));
    check('整轮检查没有控制台报错', errs.length === 0, errs.slice(0, 6).map((e) => e.type + ': ' + e.text).join(' | '));

    await page.shot('shots/test-diary.png');
  } catch (e) {
    failed++;
    console.log('FAIL  运行异常: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' ⏎ ') : e));
  } finally {
    try { if (page) page.close(); } catch (e) { /* noop */ }
    try { if (browser && browser.proc) browser.proc.kill(); } catch (e) { /* noop */ }
  }

  console.log('');
  console.log('===== 日记日历：' + passed + '/' + (passed + failed) + ' 通过 =====');
  if (failed) {
    console.log('（Edge: ' + (() => { try { return findEdge(); } catch (e) { return '未找到'; } })() + '）');
    process.exitCode = 1;
  }
})();
