/* ==========================================================================
   selfwriting · view-diary.js
   日记：日历（农历 / 节气 / 节假日底色 / 圆形日期 / 数量角标 / 长按收藏 / 多选区间）
        · 点日期就开始写 · 多人创作入口 · 日记 / 周记 / 月记 / 自定义间隔
        · 插图 · 周月汇总 · 时区与实时时钟
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const UI = global.UI;
  const Store = global.Store;
  const IO = global.IOApi;
  const DB = global.DB;
  const DV = {};

  const MOODS = ['平静', '开心', '充实', '疲惫', '低落', '焦虑', '期待', '感动'];
  const WEATHERS = ['晴', '多云', '阴', '雨', '雪', '风'];

  const KIND_NAME = { daily: '日记', weekly: '周记', monthly: '月记', custom: '自定义间隔' };

  const LONG_PRESS_MS = 550;          // 长按判定：触屏与鼠标一致

  /* ================================================================== */
  /* 视图状态（在会话内保持）                                          */
  /* ================================================================== */
  let calMonth = null;        // 'YYYY-MM'
  let selectedBookId = null;
  let authorFilter = '';      // 多人日记：按作者筛选，空 = 全部
  let calScope = 'all';       // 记录本模块页的日历对象：'all' 或某个记录本 id
  let calSel = null;          // 日历多选：{ bookId, from, to }
  let favOpen = false;        // 「收藏的日子」是否展开
  let liveToday = null;       // 上一次时钟读到的「今天」，用于跨零点刷新
  const draftPeople = {};     // '记录本id|日期' -> [参与者]：多人创作待用名单
  /* 手势共用的小状态：双击收藏要跨「页面重绘」也认得出来，所以放在模块里 */
  let lastUpTap = null;       // 上一次抬起：{ key, t, x, y }
  let favGuardAt = 0;         // 刚刚用「两次抬起」收藏过的时间戳，避免 dblclick 再来一次

  /** 触感反馈：只有用户真的点过页面才调用，否则浏览器会在控制台留一条被拦截的告警 */
  function haptic(ms) {
    try {
      if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
        navigator.vibrate(ms || 12);
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ================================================================== */
  /* 日期 / 农历 / 区间文本                                             */
  /* ================================================================== */
  /** 应用内的「今天」：按设置里的时区算（默认北京时间） */
  function todayKey() { return U.today(); }

  /** 农历 / 节气 / 节日信息（lunar.js 缺失时安全降级） */
  function infoOf(key) {
    if (global.Lunar && global.Lunar.info) {
      try { return global.Lunar.info(key); } catch (e) { /* 降级 */ }
    }
    return { key: key, lunar: '', term: null, holiday: null, rest: false, work: false, label: '' };
  }

  /** '9月21日' */
  function mdCN(key) {
    const d = U.parseKey(key);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /** '9月21日 – 9月25日 · 5 天'（区间短文案，角标 / 列表用） */
  function shortRange(from, to) {
    const a = from <= to ? from : to, b = from <= to ? to : from;
    return mdCN(a) + ' – ' + mdCN(b) + ' · ' + (U.dayDiff(a, b) + 1) + ' 天';
  }

  /** '9月21日 周一 – 9月25日 周五 · 5 天'（选择条用，带星期） */
  function longRange(from, to) {
    const a = from <= to ? from : to, b = from <= to ? to : from;
    return U.fmtDateCN(a) + ' – ' + U.fmtDateCN(b) + ' · ' + (U.dayDiff(a, b) + 1) + ' 天';
  }

  function monthDays(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const days = [];
    const lead = (first.getDay() + 6) % 7; // 周一开头
    for (let i = 0; i < lead; i++) {
      const d = new Date(y, m - 1, 1 - (lead - i));
      days.push({ key: U.dateKey(d), out: true });
    }
    const last = new Date(y, m, 0).getDate();
    for (let d = 1; d <= last; d++) days.push({ key: U.dateKey(new Date(y, m - 1, d)), out: false });
    while (days.length % 7 !== 0) {
      const lastKey = days[days.length - 1].key;
      days.push({ key: U.shiftDate(lastKey, 1), out: true });
    }
    return days;
  }

  function shiftMonth(monthKey, delta) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1);
  }

  /** 这一天的记录数：当天的 + 覆盖这一天的跨天日记 */
  function countOn(entries, key) {
    let n = 0;
    (entries || []).forEach((e) => {
      if (e.dateKey === key) n++;
      else if (e.range && e.fromKey && e.toKey && e.fromKey <= key && key <= e.toKey) n++;
    });
    return n;
  }

  /** 某一天的记录（含覆盖这一天的跨天日记） */
  function entriesOn(book, key) {
    if (!book) return [];
    return (book.entries || []).filter((e) =>
      e.dateKey === key || (e.range && e.fromKey && e.toKey && e.fromKey <= key && key <= e.toKey));
  }

  /** 跨天日记的角标文案 */
  function rangeBadgeText(en) {
    return '跨天 · ' + shortRange(en.fromKey, en.toKey);
  }

  /** 某周 / 某月 / 自定义区间的所有记录汇总 */
  function collectRange(book, fromKey, toKey) {
    const out = [];
    (book.entries || []).forEach((e) => { if (e.dateKey >= fromKey && e.dateKey <= toKey) out.push(e); });
    out.sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
    return out;
  }

  function draftKey(bookId, dateKey) { return bookId + '|' + dateKey; }

  /* ================================================================== */
  /* 实时时钟（按所选时区）                                             */
  /* ================================================================== */
  /**
   * 日历头部的时钟：'北京时间 UTC+8 · 19:42:07 · 周四'
   * 每秒由页面的定时器调用 tick()；跨过零点时回调 onRollover（刷新「今天」）。
   */
  function makeClock(onRollover) {
    const tz = U.el('span.cal-clock-tz');
    const time = U.el('span.cal-clock-time');
    const wd = U.el('span.cal-clock-wd');
    const host = U.el('div.cal-clock', {}, [
      U.icon('clock', 'ico-sm'),
      tz,
      U.el('span.cal-clock-sep', { text: '·' }),
      time,
      U.el('span.cal-clock-sep', { text: '·' }),
      wd
    ]);
    function tick() {
      const d = U.tzNow();
      const k = U.dateKey(d);
      tz.textContent = U.tzLabel();
      time.textContent = U.tzClock(true);
      wd.textContent = U.weekdayCN(k);
      /* 跨过零点（或换了时区）就换了一天：先记下新的「今天」再回调，
         否则回调里的重绘会再次认为「变天了」，一层层递归下去 */
      const rolled = liveToday !== null && liveToday !== k;
      liveToday = k;
      if (rolled && onRollover) onRollover(k);
    }
    tick();
    return { el: host, tick: tick };
  }

  /* ================================================================== */
  /* 日历卡片（记录本页与模块页共用）                                   */
  /* ================================================================== */
  /**
   * o = {
   *   book, dateKey, clock,            // 目标记录本（可为 null）/ 选中日期 / 时钟节点
   *   today(), countsOf(key), isFav(key),
   *   onPick(key),                     // 单击：去写这一天（等 280ms 看是不是双击的第二下）
   *   onFav(key) -> bool,              // 双击：收藏这一天（返回收藏后的状态）
   *   onRangePanel(key),               // 长按（或 Shift+点击）：弹「选这几天」面板
   *   onFavChanged(key),               // 收藏状态变了（刷新收藏列表 / 当日面板）
   *   sel(), setSel(sel), onSelChange(),
   *   scopeChips, hint
   * }
   * 返回 { el, update() }：update() 就地重画（不重建 DOM）
   *
   * 手势约定（三者互不误触）：
   *   单击 = 去那一天写日记 · 双击 = 收藏 · 长按（≥550ms）＝ 弹「选这几天」面板
   */
  function diaryCalendar(o) {
    const card = U.el('div.card.cal-card');
    const grid = U.el('div.cal-grid');
    const selBar = U.el('div.cal-selbar.hidden');
    const titleEl = U.el('div.cal-title');
    const cells = {};
    const outMap = {};
    let builtMonth = null;

    const st = { timer: null, key: null, fired: false, swallow: false, x: 0, y: 0, nav: null, armed: null };

    const sel = () => (o.sel ? o.sel() : null);
    const setSel = (s) => { if (o.setSel) o.setSel(s); };
    const today = () => (o.today ? o.today() : todayKey());

    if (o.clock) U.append(card, o.clock);

    /* ---- 月份导航 ---- */
    function shift(delta) {
      calMonth = shiftMonth(calMonth, delta);
      paint(true);
    }
    U.append(card, U.el('div.cal-head', {}, [
      U.el('button.icon-btn', { onclick: () => shift(-1), 'aria-label': '上个月' }, U.icon('back')),
      titleEl,
      U.el('button.icon-btn', { onclick: () => shift(1), 'aria-label': '下个月' }, U.icon('chevron')),
      U.el('button.chip', { text: '今天', onclick: () => { const t = today(); calMonth = t.slice(0, 7); paint(true); if (o.onPick) o.onPick(t); } })
    ]));
    if (o.scopeChips) U.append(card, o.scopeChips);
    U.append(card, grid);

    /* ---- 图例（底色规则一眼看懂） ---- */
    U.append(card, U.el('div.cal-legend', {}, [
      U.el('span.lg', {}, [U.el('i.sw.work'), U.el('span', { text: '工作日' })]),
      U.el('span.lg', {}, [U.el('i.sw.rest'), U.el('span', { text: '休息日' })]),
      U.el('span.lg', {}, [U.el('i.sw.swap'), U.el('span', { text: '调休上班' })]),
      U.el('span.lg', {}, [U.el('i.sw.today'), U.el('span', { text: '今天' })]),
      U.el('span.lg', {}, [U.el('i.sw.sel'), U.el('span', { text: '已选' })]),
      U.el('span.lg', {}, [U.el('i.sw.fav', { text: '♥' }), U.el('span', { text: '收藏' })])
    ]));
    U.append(card, selBar);
    U.append(card, U.el('div.field-note', {
      style: { marginTop: '6px' },
      text: '点日期就到那一天写日记；长按日期＝弹出「选这几天」，在里面滑动或点选多个日期，写成一篇专属日记；双击日期＝收藏。灰掉的日子还没到，不能提前记录；以前的日记随时可以补写或修改。'
    }));

    /* ---- 单元格 ---- */
    function buildCell(key, out) {
      const cell = U.el('button.cal-cell.cal-day', {
        dataset: { key: key },
        onpointerdown: (ev) => onDown(key, ev),
        onpointerenter: (ev) => onEnter(key, ev),
        onpointerup: (ev) => onUp(ev),
        onpointercancel: (ev) => onUp(ev),
        onpointerleave: () => { if (!st.fired) clearTimer(); },
        oncontextmenu: (ev) => { ev.preventDefault(); openPanel(key); },
        onclick: (ev) => onClick(key, ev),
        ondblclick: (ev) => { ev.preventDefault(); onDoubleClick(key); }
      }, [
        U.el('span.num'),
        U.el('span.cnt'),
        U.el('span.lunar'),
        U.el('span.fav', { text: '♥' })
      ]);
      outMap[key] = !!out;
      return cell;
    }

    function paintShadow(rebuild) {
      U.clear(grid);
      Object.keys(cells).forEach((k) => delete cells[k]);
      const wd = ['一', '二', '三', '四', '五', '六', '日'];
      wd.forEach((w, i) => grid.appendChild(U.el('div.cal-wd', { dataset: { i18nGroup: 'wd:' + i }, text: w })));
      monthDays(calMonth).forEach((d) => {
        const cell = buildCell(d.key, d.out);
        cells[d.key] = cell;
        grid.appendChild(cell);
      });
      builtMonth = calMonth;
      if (rebuild) { /* 月份变了：标题跟着走 */ }
    }

    /** 就地刷新一格（数字 / 数量角标 / 农历小字 / 收藏心 / 各类状态类名） */
    function paintCell(key) {
      const cell = cells[key];
      if (!cell) return;
      const inf = infoOf(key);
      const t = today();
      const future = key > t;
      const n = o.countsOf ? (o.countsOf(key) || 0) : 0;
      const s = sel();
      const a = s ? (s.from <= s.to ? s.from : s.to) : null;
      const b = s ? (s.from <= s.to ? s.to : s.from) : null;
      const inSel = !!(s && a <= key && key <= b);

      const cls = ['cal-cell', 'cal-day'];
      if (outMap[key]) cls.push('out');
      if (future) cls.push('future');
      if (n > 0) cls.push('has');
      if (inf.work) cls.push('work');
      if (inf.rest) cls.push('rest');
      if (inf.holiday && inf.holiday.type === 'holiday') cls.push('holiday');
      if (inf.holiday && inf.holiday.type === 'festival') cls.push('festival');
      if (inf.holiday && inf.holiday.type === 'workday-swap') cls.push('swap');
      if (key === t) cls.push('today');
      if (key === o.dateKey) cls.push('sel');
      if (inSel) cls.push('inrange');
      if (key === st.armed) cls.push('armed');
      cell.className = cls.join(' ');

      cell.disabled = future;
      cell.setAttribute('aria-disabled', future ? 'true' : 'false');
      cell.setAttribute('aria-pressed', inSel ? 'true' : 'false');
      cell.setAttribute('aria-label', ariaFor(key, inf, n, future));

      cell.children[0].textContent = String(U.parseKey(key).getDate());
      const cnt = cell.children[1];
      cnt.textContent = n ? (n > 99 ? '99+' : String(n)) : '';
      cnt.style.display = n ? '' : 'none';
      const lun = cell.children[2];
      const label = labelOf(inf);
    /* 调休的「班」是单字，进不了词典：标上分组让多语种模块按语言取表 */
    if (label === '班') lun.dataset.i18nGroup = 'swap:0';
    else delete lun.dataset.i18nGroup;
      lun.textContent = label;
      lun.style.display = label ? '' : 'none';
      lun.title = fullLabelOf(inf);
      cell.children[3].style.display = (o.isFav && o.isFav(key)) ? '' : 'none';
      cell.title = fullLabelOf(inf) + (n ? ' · ' + n + ' 篇' : '');
    }

    function labelOf(inf) {
      if (inf.holiday && inf.holiday.type === 'workday-swap') return '班';   /* 调休上班：显示成小「班」字 */
      return inf.label || inf.lunar || '';
    }
    function fullLabelOf(inf) {
      const parts = [];
      if (inf.holiday) parts.push(inf.holiday.name + (inf.holiday.note ? '（' + inf.holiday.note + '）' : ''));
      if (inf.term && (!inf.holiday || inf.holiday.name !== inf.term)) parts.push(inf.term);
      if (inf.lunarInfo) parts.push('农历 · ' + inf.lunarInfo.monthName + ' · ' + inf.lunarInfo.dayName);
      if (inf.note && !(inf.holiday && inf.holiday.note)) parts.push(inf.note);
      return parts.join(' · ');
    }
    function ariaFor(key, inf, n, future) {
      const bits = [U.fmtDateCN(key)];
      if (inf.holiday) bits.push(inf.holiday.name);
      if (inf.term) bits.push(inf.term);
      if (inf.lunarInfo) bits.push('农历 · ' + inf.lunarInfo.monthName + ' · ' + inf.lunarInfo.dayName);
      bits.push(n ? n + ' 篇记录' : '还没有记录');
      if (future) bits.push('还没到');
      return bits.join('，');
    }

    function paintAll() {
      titleEl.textContent = calMonth.split('-')[0] + ' 年 ' + Number(calMonth.split('-')[1]) + ' 月';
      Object.keys(cells).forEach(paintCell);
      paintSelBar();
    }

    /** 日历上的「已选区间」提示：真正的调整都在「选这几天」面板里 */
    function paintSelBar() {
      U.clear(selBar);
      const s = sel();
      if (!s) { selBar.classList.add('hidden'); return; }
      const a = s.from <= s.to ? s.from : s.to;
      const b = s.from <= s.to ? s.to : s.from;
      selBar.classList.remove('hidden');
      U.append(selBar, [
        U.el('div.cal-sel-info', {}, [
          U.icon('target', 'ico-sm'),
          U.el('div', {}, [
            U.el('div.cal-sel-title', { text: '已选 ' + longRange(a, b) }),
            U.el('div.cal-sel-sub', { text: '这几天会写成一篇专属日记' })
          ])
        ]),
        U.el('button.chip', { text: '取消选择', onclick: () => { setSel(null); paintAll(); if (o.onSelChange) o.onSelChange(); } })
      ]);
    }

    /* ------------------------------------------------------------------ */
    /* 手势：单击＝去写这一天 · 双击＝收藏 · 长按＝弹「选这几天」面板        */
    /* ------------------------------------------------------------------ */
    const NAV_DELAY = 280;      // 单击等一下，看是不是双击的第二下
    const DOUBLE_MS = 300;      // 两次抬起间隔小于这个数 = 双击
    const DOUBLE_DIST = 14;     // 双击时手指允许的位移

    function clearTimer() { if (st.timer) { clearTimeout(st.timer); st.timer = null; } }
    function cancelNav() { if (st.nav) { clearTimeout(st.nav); st.nav = null; } }
    function scheduleNav(key) {
      cancelNav();
      st.nav = setTimeout(() => { st.nav = null; if (o.onPick) o.onPick(key); }, NAV_DELAY);
    }
    function moved(ev) {
      if (!ev || ev.clientX === undefined) return false;
      return Math.abs(ev.clientX - st.x) > 8 || Math.abs(ev.clientY - st.y) > 8;
    }
    /** 长按期间给按下的那一格一个「按住了」的视觉反馈 */
    function markArmed(key) {
      clearArmed();
      st.armed = key || null;
      const c = st.armed ? cells[st.armed] : null;
      if (c) c.classList.add('armed');
    }
    function clearArmed() {
      const c = st.armed ? cells[st.armed] : null;
      if (c) c.classList.remove('armed');
      st.armed = null;
    }
    function openPanel(key) {
      if (!key) return;
      clearTimer();
      cancelNav();
      clearArmed();
      st.swallow = true;
      setTimeout(() => { st.swallow = false; }, 700);   // 抬手带出的那次 click 丢掉
      if (o.onRangePanel) o.onRangePanel(key);
    }
    function toggleFav(key) {
      if (!o.onFav) return;
      const on = o.onFav(key);
      favGuardAt = Date.now();
      haptic(12);
      paintCell(key);
      UI.toast((on ? '已收藏 ' : '已取消收藏 ') + U.fmtDateCN(key), on ? 'star' : 'close');
      if (o.onFavChanged) o.onFavChanged(key);
    }
    /** dblclick 事件（键盘/无障碍/合成事件都可能只给这个） */
    function onDoubleClick(key) {
      if (Date.now() - favGuardAt < 500) return;        // 两次抬起那条路径已经处理过
      cancelNav();
      st.swallow = true;
      setTimeout(() => { st.swallow = false; }, 400);
      toggleFav(key);
    }

    function onDown(key, ev) {
      const cell = cells[key];
      if (!cell || cell.disabled) return;
      clearTimer();
      cancelNav();
      st.key = key;
      st.fired = false;
      st.x = ev && ev.clientX !== undefined ? ev.clientX : 0;
      st.y = ev && ev.clientY !== undefined ? ev.clientY : 0;
      /* 触屏上浏览器会把指针隐式捕获给按下的那一格，主动放开，
         这样滑动时 pointerenter / 坐标反查都还能用 */
      try {
        if (cell.releasePointerCapture && ev && ev.pointerId !== undefined &&
            cell.hasPointerCapture && cell.hasPointerCapture(ev.pointerId)) {
          cell.releasePointerCapture(ev.pointerId);
        }
      } catch (e) { /* 忽略 */ }
      st.timer = setTimeout(() => {
        st.timer = null;
        st.fired = true;
        markArmed(key);
        haptic(10);
      }, LONG_PRESS_MS);
    }
    function onEnter(key, ev) {
      if (!st.key || st.fired) return;
      if (moved(ev)) clearTimer();                 // 还没到长按时间就滑开了 → 是在滚动
    }
    function onMove(ev) {
      if (!st.key || st.fired) return;
      if (moved(ev)) clearTimer();
    }
    function onUp(ev) {
      const fired = st.fired;
      const key = st.key;
      const x = ev && ev.clientX !== undefined ? ev.clientX : st.x;
      const y = ev && ev.clientY !== undefined ? ev.clientY : st.y;
      clearTimer();
      clearArmed();
      st.key = null;
      st.fired = false;
      if (fired) { openPanel(key); return; }        // 长按：抬手后弹面板（不碰收藏）
      /* 双击：两次抬起间隔很短、同一天、位移很小 → 收藏 */
      const now = Date.now();
      if (key && lastUpTap && lastUpTap.key === key && (now - lastUpTap.t) < DOUBLE_MS &&
          Math.abs(x - lastUpTap.x) <= DOUBLE_DIST && Math.abs(y - lastUpTap.y) <= DOUBLE_DIST) {
        lastUpTap = null;
        st.swallow = true;
        setTimeout(() => { st.swallow = false; }, 400);
        cancelNav();
        toggleFav(key);
        return;
      }
      lastUpTap = key ? { key: key, t: now, x: x, y: y } : null;
    }
    function onClick(key, ev) {
      if (st.swallow) { st.swallow = false; return; }   // 长按抬手 / 双击之后的那次 click 丢掉
      if (ev && ev.shiftKey) { openPanel(key); return; } // 桌面端：Shift+点击＝选这几天
      if (ev && ev.detail === 0) { if (o.onPick) o.onPick(key); return; }  // 键盘 Enter/Space：立即去写
      scheduleNav(key);                                  // 单击：等 280ms 看有没有第二下
    }

    grid.addEventListener('pointermove', onMove);
    /* 手指可能滑出格子才松开：抬手事件挂在格子上兜一层，长按松手照样弹面板 */
    grid.addEventListener('pointerup', (ev) => { if (st.key) onUp(ev); });
    grid.addEventListener('pointercancel', (ev) => { if (st.key) onUp(ev); });

    function paint(rebuild) {
      if (rebuild || builtMonth !== calMonth) paintShadow(true);
      paintAll();
    }
    paint(true);

    return {
      el: card,
      update: () => paintAll(),
      /** 月份跳转（外部想跟着选中日期走时用） */
      gotoMonth: (monthKey) => { if (monthKey && monthKey !== calMonth) { calMonth = monthKey; paint(true); } },
      dispose: () => { clearTimer(); cancelNav(); clearArmed(); }
    };
  }

  /* ================================================================== */
  /* 「选这几天」面板（长按日期后弹出）                                  */
  /* ------------------------------------------------------------------ */
  /* 长按抬起 → 弹这个面板：
      · 上面一行大字：已选区间（9月21日 – 9月25日 · 5 天）
      · 左「前一天」右「后一天」两个微调按钮，调整结束日
      · 中间一条横向日期带，可以按住左右滑动，也可以点两个日期
      · 底部「取消 / 写这几天的日记」
     面板调整的同时，日历上的这些格子会实时高亮（setSel 回调）。          */
  /* ================================================================== */
  const RP_WINDOW = 21;        // 日期带一次显示多少格
  const RP_LEAD = 3;           // 选区起点前面留几格

  /**
   * @param book      目标记录本
   * @param anchorKey 长按的那一天（选区的锚点）
   * @param setSel    ({from,to}|null) => void：同步日历高亮
   */
  function rangePanel(book, anchorKey, setSel) {
    const today = todayKey();
    const anchor = !anchorKey || anchorKey > today ? today : anchorKey;
    /* a = 锚点（不动），b = 另一头（滑动 / 点选 / 微调都在动它） */
    const state = { a: anchor, b: anchor, winStart: U.shiftDate(anchor, -RP_LEAD) };

    const norm = () => (state.a <= state.b ? { from: state.a, to: state.b } : { from: state.b, to: state.a });
    const spanDays = () => U.dayDiff(norm().from, norm().to) + 1;

    const head = U.el('div.rp-head');
    const ctrl = U.el('div.rp-ctrl');
    const strip = U.el('div.rp-strip');
    const stripCells = {};
    const drag = { on: false };

    function sync() { if (setSel) setSel(norm()); }

    /* ---- 大字：已选区间 ---- */
    function paintHead() {
      U.clear(head);
      const r = norm();
      U.append(head, [
        U.el('div.rp-range', { text: shortRange(r.from, r.to) }),
        U.el('div.rp-range-sub', { text: U.fmtDateCN(r.from) + ' 起 · ' + U.fmtDateCN(r.to) + ' 止' })
      ]);
    }

    /* ---- 微调：前一天 / 后一天（动的是结束日那一头） ---- */
    function step(delta) {
      const b = U.shiftDate(state.b, delta);
      if (b > today) { UI.toast('还没到那一天，不能往后选', 'calendar'); return; }
      state.b = b;
      ensureWindow();
      paintStrip(true);
      refresh();
    }
    function paintCtrl() {
      U.clear(ctrl);
      U.append(ctrl, [
        U.el('button.btn.sm.rp-step', { onclick: () => step(-1), 'aria-label': '前一天' }, [
          U.icon('back', 'ico-sm'), U.el('span', { text: '前一天' })
        ]),
        U.el('div.rp-ctrl-mid', {}, [
          U.el('div.rp-ctrl-main', { text: spanDays() + ' 天' }),
          U.el('div.rp-ctrl-sub', { text: '结束日 ' + U.fmtDateCN(state.b) })
        ]),
        U.el('button.btn.sm.rp-step', { onclick: () => step(1), 'aria-label': '后一天' }, [
          U.el('span', { text: '后一天' }), U.icon('chevron', 'ico-sm')
        ])
      ]);
    }

    /* ---- 横向日期带：可滑动、可点选 ---- */
    function ensureWindow() {
      const r = norm();
      const last = U.shiftDate(state.winStart, RP_WINDOW - 1);
      if (r.from < state.winStart) state.winStart = U.shiftDate(r.from, -RP_LEAD);
      else if (r.to > last) state.winStart = U.shiftDate(r.to, -(RP_WINDOW - 1 - RP_LEAD));
    }
    function buildStrip() {
      U.clear(strip);
      Object.keys(stripCells).forEach((k) => delete stripCells[k]);
      for (let i = 0; i < RP_WINDOW; i++) {
        const key = U.shiftDate(state.winStart, i);
        const cell = U.el('button.rp-day', {
          dataset: { key: key },
          onpointerdown: (ev) => stripDown(key, ev),
          onpointerenter: () => { if (drag.on) stripTo(key); },
          onpointerup: () => { drag.on = false; },
          onpointercancel: () => { drag.on = false; }
        }, [U.el('span.rp-num'), U.el('span.rp-sub')]);
        stripCells[key] = cell;
        strip.appendChild(cell);
      }
    }
    function paintStripCell(key) {
      const cell = stripCells[key];
      if (!cell) return;
      const inf = infoOf(key);
      const r = norm();
      const cls = ['rp-day'];
      if (inf.work) cls.push('work');
      if (inf.rest) cls.push('rest');
      if (inf.holiday && inf.holiday.type === 'workday-swap') cls.push('swap');
      if (key > today) cls.push('future');
      if (key === today) cls.push('today');
      if (key >= r.from && key <= r.to) cls.push('in');
      if (key === r.from) cls.push('first');
      if (key === r.to) cls.push('last');
      cell.className = cls.join(' ');
      cell.disabled = key > today;
      cell.setAttribute('aria-pressed', (key >= r.from && key <= r.to) ? 'true' : 'false');
      cell.setAttribute('aria-label', U.fmtDateCN(key));
      cell.children[0].textContent = String(U.parseKey(key).getDate());
      const sub = (inf.holiday && inf.holiday.type === 'workday-swap') ? '班' : (inf.label || inf.lunar || '');
      const subEl = cell.children[1];
      if (sub === '班') subEl.dataset.i18nGroup = 'swap:0';
      else delete subEl.dataset.i18nGroup;
      subEl.textContent = sub;
    }
    function paintStrip(rebuild) {
      if (rebuild) buildStrip();
      Object.keys(stripCells).forEach(paintStripCell);
    }
    /** 让「正在动的那一头」始终留在可见范围里 */
    function scrollEdge() {
      const cell = stripCells[state.b];
      if (!cell || !cell.scrollIntoView) return;
      try { cell.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* 忽略 */ }
    }
    function refresh() {
      paintHead();
      paintCtrl();
      paintStrip(false);
      sync();
      scrollEdge();
    }

    function stripDown(key, ev) {
      if (key > today) return;
      drag.on = true;
      /* 触屏上指针会被隐式捕获给按下的那一格：放开它，滑过别的格子才能接住 */
      try {
        const cell = stripCells[key];
        if (cell && cell.releasePointerCapture && ev && ev.pointerId !== undefined &&
            cell.hasPointerCapture && cell.hasPointerCapture(ev.pointerId)) {
          cell.releasePointerCapture(ev.pointerId);
        }
      } catch (e) { /* 忽略 */ }
      state.b = key;
      refresh();
    }
    function stripTo(key) {
      if (!drag.on) return;
      const k = key > today ? today : key;
      if (state.b === k) return;
      state.b = k;
      const before = state.winStart;
      ensureWindow();
      /* 只有窗口真的挪了才重建 DOM：按住滑动时别把手指底下那一格换掉 */
      paintStrip(state.winStart !== before);
      refresh();
    }
    /* 触屏上指针可能被捕获在按下的那一格，用坐标反查手指底下的日期 */
    strip.addEventListener('pointermove', (ev) => {
      if (!drag.on) return;
      let el = null;
      try { el = document.elementFromPoint(ev.clientX, ev.clientY); } catch (e) { el = null; }
      const day = el && el.closest ? el.closest('.rp-day') : null;
      if (day && day.dataset && day.dataset.key) stripTo(day.dataset.key);
    });
    strip.addEventListener('pointerup', () => { drag.on = false; });
    strip.addEventListener('pointercancel', () => { drag.on = false; });

    /* ---- 写这几天 ---- */
    function create() {
      const r = norm();
      if (setSel) setSel(null);          // 高亮交给下一页
      UI.closeSheet();
      /* 只选了一天：走普通的「补记这一天」，不必造一条跨天记录 */
      if (r.from === r.to) { setTimeout(() => entrySheet(book, r.to, null), 120); return; }
      setTimeout(() => rangeSheet(book, r.from, r.to), 120);
    }

    buildStrip();
    paintStrip(false);
    refresh();

    UI.sheet({
      title: '选这几天 · 写一篇专属日记',
      body: (host) => {
        U.append(host, [
          head,
          ctrl,
          strip,
          U.el('div.field-note', {
            style: { marginTop: '2px' },
            text: '在日期带上按住左右滑动，或点两个日期，就能选定一段日子；「前一天 / 后一天」可以逐天微调。选中的日子在日历上会同时高亮。'
          })
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '写这几天的日记', primary: true, close: false, onClick: create }
      ],
      onClose: () => { drag.on = false; if (setSel) setSel(null); }
    });
  }

  /* ================================================================== */
  /* 记录本 / 日记模块页（#/diary）                                     */
  /* ------------------------------------------------------------------ */
  /* 注意：#/diary 这条路由由 view-library.js 的通用列表页先注册（同一个
     路径、同样的段数，先注册的先匹配），所以这里不抢路由，而是在每次渲染
     之后把一张日历「补」到页面最上面 —— 记录本页面上就能直接看日历、点日期
     开始写，不必先走一遍「新建记录本」。                                 */
  /* ================================================================== */

  /** 默认记录本：优先日记本，其次第一本 */
  function primaryBook() {
    const st = Store.state;
    return st.diaries.filter((b) => b.kind === 'daily')[0] || st.diaries[0] || null;
  }
  function moduleTargetBook() {
    if (calScope !== 'all') return Store.findDiary(calScope);
    return primaryBook();
  }
  /** 还没有任何记录本时：点日期直接建一本，不再让人先去「新建记录本」 */
  function ensureDiaryBook() {
    let b = moduleTargetBook();
    if (b) return b;
    b = Store.createDiaryBook({ title: '我的日记', kind: 'daily' });
    calScope = b.id;
    return b;
  }
  /** 全部记录本在某一天的记录数（角标） */
  function countAllBooks(key) {
    let n = 0;
    Store.state.diaries.forEach((bk) => { n += countOn(bk.entries, key); });
    return n;
  }

  function scopeChipsRow() {
    const st = Store.state;
    const chips = U.el('div.chips.scroll', { style: { margin: '2px 0 4px' } });
    chips.appendChild(U.el('button.chip' + (calScope === 'all' ? '.active' : ''), {
      text: '全部记录本',
      onclick: () => { calScope = 'all'; calSel = null; UI.render(); }
    }));
    st.diaries.forEach((bk) => {
      chips.appendChild(U.el('button.chip' + (calScope === bk.id ? '.active' : ''), {
        text: bk.title,
        onclick: () => { calScope = bk.id; calSel = null; UI.render(); }
      }));
    });
    chips.appendChild(U.el('button.chip.ghost', { text: '+ 新建', onclick: () => global.Library.createDiaryFlow() }));
    return chips;
  }

  /**
   * 模块页的日历整块：时钟 + 月历 + 记录本切换 + 收藏的日子。
   * 返回 { el, tick, dispose }：时钟由调用方按秒驱动。
   */
  function buildModuleCalendar(onRollover) {
    const clock = makeClock(onRollover);
    const favHost = U.el('div');
    const cal = diaryCalendar({
      book: moduleTargetBook(),
      dateKey: todayKey(),
      clock: clock.el,
      today: todayKey,
      scopeChips: scopeChipsRow(),
      countsOf: countAllBooks,
      isFav: (key) => { const b = moduleTargetBook(); return b ? Store.isDiaryFav(b.id, key) : false; },
      onPick: (key) => { const b = ensureDiaryBook(); UI.go('diary/' + b.id + '/' + key); },
      onFav: (key) => {
        const b = ensureDiaryBook();
        return Store.toggleDiaryFav(b.id, key);
      },
      onFavChanged: () => { paintFavs(); },
      onRangePanel: (key) => { const b = ensureDiaryBook(); rangePanel(b, key, applySel); },
      sel: () => { const b = moduleTargetBook(); return calSel && calSel.bookId === (b ? b.id : null) ? calSel : null; },
      setSel: (s) => applySel(s),
      onSelChange: () => { paintFavs(); }
    });
    /** 面板调整选区时，同步到日历高亮上 */
    function applySel(s) {
      const b = moduleTargetBook();
      calSel = s ? { bookId: b ? b.id : null, from: s.from, to: s.to } : null;
      cal.update();
    }

    function paintFavs() {
      U.clear(favHost);
      const all = [];
      Store.state.diaries.forEach((bk) => { Store.diaryFavs(bk.id).forEach((k) => all.push({ book: bk, key: k })); });
      if (!all.length) return;
      all.sort((a, b) => (a.key < b.key ? 1 : -1));
      U.append(favHost, favCard(all, 6));
    }
    paintFavs();

    const hint = U.el('div.field-note', {
      style: { margin: '8px 2px 0' },
      text: Store.state.diaries.length
        ? '日历上点一天，就直接进那一天写日记；长按日期＝收藏这一天。'
        : '还没有记录本：点日历上任意一天，会自动建一本「我的日记」并开始写。'
    });

    const el = U.el('div.diary-tab-cal', {}, [cal.el, hint, favHost]);
    return { el: el, tick: clock.tick, dispose: cal.dispose, paintFavs: paintFavs };
  }

  /** 把模块页的日历插到 #view 最上面（每次渲染后调用一次） */
  function mountDiaryTabCalendar() {
    const view = UI.dom && UI.dom.view;
    if (!view) return;
    if (calScope !== 'all' && !Store.findDiary(calScope)) calScope = 'all';
    calMonth = todayKey().slice(0, 7);          // 模块页永远从「这个月」看起
    const old = view.querySelector('.diary-tab-cal');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const block = buildModuleCalendar((k) => { if (!UI.isSheetOpen()) UI.render(); });
    view.insertBefore(block.el, view.firstChild);
    /* 秒级时钟：节点被换掉（页面切走）时自己停掉，不留定时器 */
    const timer = setInterval(() => {
      if (!block.el.parentNode) { clearInterval(timer); block.dispose(); return; }
      block.tick();
    }, 1000);
  }

  /** 包一层 UI.render：只在记录本模块页面上补日历，别的一概不碰 */
  (function installDiaryTabCalendar() {
    const orig = UI.render;
    if (!orig || orig.__diaryCal) return;
    function renderWithDiaryCalendar() {
      const r = orig.apply(UI, arguments);
      try {
        if (UI.currentPath() === 'diary') mountDiaryTabCalendar();
      } catch (e) { console.error('[diary-calendar]', e); }
      return r;
    }
    renderWithDiaryCalendar.__diaryCal = true;
    UI.render = renderWithDiaryCalendar;
  })();

  /* 兜底：万一哪天 #/diary 没有被通用列表页接管，这里也能给出一个完整的
     记录本页面（日历 + 记录本列表 + 最近记录） */
  UI.route('diary', function (view) {
    const st = Store.state;
    UI.setTitle('日记', '');
    selectedBookId = null;
    view.classList.add('flush');
    calMonth = todayKey().slice(0, 7);

    const host = U.el('div', { style: { padding: '12px 16px 90px' } });
    U.append(view, host);

    const block = buildModuleCalendar((k) => { if (!UI.isSheetOpen()) UI.render(); });
    U.append(host, block.el);
    const clockTimer = setInterval(block.tick, 1000);

    if (!st.diaries.length) {
      U.append(host, U.el('div.card', {}, [
        U.el('div', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '还没有记录本。日记、周记、月记，或者你自定义的时间间隔——点日历上的日期就能直接开始写。' }),
        U.el('div.grid2', { style: { marginTop: '12px' } }, [
          U.el('button.btn.primary', { onclick: () => global.Library.createDiaryFlow() }, [U.icon('plus', 'ico-sm'), U.el('span', { text: '新建记录本' })]),
          U.el('button.btn', { onclick: () => global.Library.importTextFlow('diary') }, [U.icon('up', 'ico-sm'), U.el('span', { text: '导入日记文本' })])
        ])
      ]));
      U.append(view, U.el('button.fab', { onclick: () => global.Library.createDiaryFlow(), 'aria-label': '新建记录本' }, U.icon('plus')));
      return function () { clearInterval(clockTimer); block.dispose(); };
    }

    U.append(host, U.el('div.section-title', {}, [U.icon('folder', 'ico-sm'), U.el('span', { text: '记录本' }), U.el('span.spacer'), U.el('button.chip', { text: '+ 新建', onclick: () => global.Library.createDiaryFlow() })]));
    const list = U.el('div');
    st.diaries.forEach((bk) => {
      list.appendChild(global.Library.diaryCard(bk));
      const rl = rangeSummaryLine(bk);
      if (rl) list.appendChild(rl);
      const favs = Store.diaryFavs(bk.id);
      if (favs.length) list.appendChild(U.el('div.field-note', { style: { margin: '-6px 2px 8px' }, text: '收藏的日子 ' + favs.length + ' 天 · 最近 ' + favs[favs.length - 1] }));
    });
    U.append(host, list);

    const recent = [];
    st.diaries.forEach((bk) => (bk.entries || []).forEach((e) => recent.push({ book: bk, entry: e })));
    recent.sort((a, b) => (b.entry.dateKey < a.entry.dateKey ? -1 : b.entry.dateKey > a.entry.dateKey ? 1 : (b.entry.updatedAt || 0) - (a.entry.updatedAt || 0)));
    if (recent.length) {
      U.append(host, U.el('div.section-title', {}, [U.icon('clock', 'ico-sm'), U.el('span', { text: '最近记录' })]));
      const rl = U.el('div.list');
      recent.slice(0, 8).forEach((x) => {
        rl.appendChild(U.el('div.row.tap', {
          onclick: () => UI.go('diary/' + x.book.id + '/' + x.entry.dateKey + '/' + x.entry.id)
        }, [
          U.el('div.row-main', {}, [
            U.el('div.row-title', { text: x.entry.title || U.excerpt(x.entry.content, 24) || '（空记录）' }),
            U.el('div.row-sub', {
              text: (x.entry.range ? rangeBadgeText(x.entry) + ' · ' : '') + x.entry.dateKey + ' · ' + x.book.title + ' · ' + U.fmtInt(x.entry.words || 0) + ' 字'
            })
          ]),
          U.el('span.row-chev', {}, U.icon('chevron', 'ico-sm'))
        ]));
      });
      U.append(host, rl);
    }

    U.append(view, U.el('button.fab', { onclick: () => global.Library.createDiaryFlow(), 'aria-label': '新建记录本' }, U.icon('plus')));
    return function () { clearInterval(clockTimer); block.dispose(); };
  });

  function stat(k, v, unit, isWords) {
    return U.el('div.stat', {}, [
      U.el('div.k', { text: k }),
      U.el('div.v', { html: (isWords ? U.fmtNum(v) : U.fmtInt(v)) + '<small>' + unit + '</small>' }),
      U.el('div.d', { text: isWords ? U.fmtInt(v) + ' 字' : '' })
    ]);
  }

  function quickWrite(book) {
    if (!book) { global.Library.createDiaryFlow(); return; }
    const en = Store.addDiaryEntry(book.id, { dateKey: todayKey() });
    UI.go('diary/' + book.id + '/' + en.dateKey + '/' + en.id);
  }

  /** 记录本卡片下面补一行：这本里有哪些跨天日记 */
  function rangeSummaryLine(book) {
    const rs = (book.entries || []).filter((e) => e.range && e.fromKey && e.toKey);
    if (!rs.length) return null;
    const last = rs[rs.length - 1];
    return U.el('div.field-note', { style: { margin: '-6px 2px 8px' }, text: '跨天日记 ' + rs.length + ' 篇 · 最近 ' + shortRange(last.fromKey, last.toKey) });
  }

  /* 「收藏的日子」卡片：all = [{book, key}] */
  function favCard(all, limit) {
    const card = U.el('div.card.fav-card');
    const shown = favOpen ? all : all.slice(0, limit || 6);
    U.append(card, U.el('div.card-head', {}, [
      U.icon('star', 'ico-sm'),
      U.el('div.card-title', { text: '收藏的日子' }),
      U.el('span.badge', { text: all.length + ' 天' }),
      all.length > (limit || 6) ? U.el('button.chip', { text: favOpen ? '收起' : '全部', onclick: () => { favOpen = !favOpen; UI.render(); } }) : null
    ]));
    const wrap = U.el('div.fav-list');
    shown.forEach((x) => {
      wrap.appendChild(U.el('button.fav-day', {
        onclick: () => UI.go('diary/' + x.book.id + '/' + x.key),
        title: x.book.title
      }, [
        U.el('span.fav-heart', { text: '♥' }),
        U.el('span.fav-date', { text: U.fmtDateCN(x.key) }),
        U.el('span.fav-sub', { text: (infoOf(x.key).label || '') + ' · ' + x.book.title })
      ]));
    });
    U.append(card, wrap);
    return card;
  }

  /* ================================================================== */
  /* 某个记录本的日历视图                                              */
  /* ================================================================== */
  UI.route('diary/:bookId/:dateKey', function (view, p) {
    return renderDiary(view, p.bookId, p.dateKey, null);
  });
  UI.route('diary/:bookId', function (view, p) {
    return renderDiary(view, p.bookId, todayKey(), null);
  });
  UI.route('diary/:bookId/:dateKey/:entryId', function (view, p) {
    return renderDiary(view, p.bookId, p.dateKey, p.entryId);
  });

  function renderDiary(view, bookId, dateKey, entryId) {
    const book = Store.findDiary(bookId);
    if (!book) {
      U.append(view, UI.empty('close', '找不到这个记录本', '', { label: '回到日记', onClick: () => UI.go('diary') }));
      return;
    }
    /* 私密记录本：解锁前不渲染日历与内容 */
    const P = global.Privacy;
    if (P && P.isLocked('diaryBook', book.id) && !P.isUnlocked('diaryBook', book.id)) {
      UI.setTitle('私密记录本', '需要密码');
      P.lockedView(view, 'diaryBook', book.id, null, () => UI.render());
      return;
    }
    const today = todayKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) dateKey = today;
    /* 还没到的日子不能记录：就算从旧链接、导入数据里冒出未来日期，也回到今天 */
    if (dateKey > today) {
      UI.toast('还没到那一天，已回到今天', 'calendar');
      UI.go('diary/' + bookId + '/' + today, { replace: true });
      return;
    }
    calMonth = calMonth && calMonth.slice(0, 7) === dateKey.slice(0, 7) ? calMonth : dateKey.slice(0, 7);
    selectedBookId = book.id;
    /* 多选是「某个记录本」里的事，换本就重来 */
    if (calSel && calSel.bookId !== book.id) calSel = null;

    const isNovelLike = book.kind !== 'daily';
    UI.setTitle(book.title, KIND_NAME[book.kind] + ' · ' + (book.entries || []).length + ' 篇 · ' + U.fmtInt(Store.diaryWords(book)) + ' 字');
    view.classList.add('flush');

    const host = U.el('div', { style: { padding: '12px 16px 90px' } });
    U.append(view, host);

    /* ---- 多人日记：成员与筛选 ---- */
    const isShared = Array.isArray(book.members) && book.members.length > 0;
    if (isShared) {
      const authors = {};
      (book.entries || []).forEach((e) => { const a = e.author || '(未署名)'; authors[a] = (authors[a] || 0) + 1; });
      const names = Object.keys(authors);
      const chips2 = U.el('div.chips.scroll', { style: { marginTop: '10px' } });
      chips2.appendChild(U.el('button.chip' + (!authorFilter ? '.active' : ''), {
        text: '全部 ' + (book.entries || []).length,
        onclick: () => { authorFilter = ''; UI.render(); }
      }));
      names.forEach((a) => {
        chips2.appendChild(U.el('button.chip' + (authorFilter === a ? '.active' : ''), {
          text: a + ' ' + authors[a],
          onclick: () => { authorFilter = a; UI.render(); }
        }));
      });
      U.append(host, U.el('div', {
        style: { fontSize: '11.5px', color: 'var(--text-3)', margin: '12px 0 0' },
        text: '多人日记本 · 成员：' + book.members.join('、') + '（各自写各自的记录，互不覆盖）'
      }));
      U.append(host, chips2);
    }

    /* ---- 记录本切换 ---- */
    const chips = U.el('div.chips.scroll');
    Store.state.diaries.forEach((bk) => {
      chips.appendChild(U.el('button.chip' + (bk.id === book.id ? '.active' : ''), {
        text: bk.title,
        onclick: () => UI.go('diary/' + bk.id + '/' + dateKey)
      }));
    });
    chips.appendChild(U.el('button.chip', { text: '+ 新建', onclick: () => global.Library.createDiaryFlow() }));
    U.append(host, chips);

    /* ---- 实时时钟 + 月历 ---- */
    const clock = makeClock((k) => { if (!UI.isSheetOpen()) UI.render(); });
    const clockTimer = setInterval(clock.tick, 1000);

    const cal = diaryCalendar({
      book: book,
      dateKey: dateKey,
      clock: clock.el,
      today: todayKey,
      countsOf: (key) => countOn(book.entries, key),
      isFav: (key) => Store.isDiaryFav(book.id, key),
      onPick: (key) => UI.go('diary/' + book.id + '/' + key),
      onFav: (key) => Store.toggleDiaryFav(book.id, key),
      onFavChanged: () => { paintFavs(); renderDay(); },
      onRangePanel: (key) => rangePanel(book, key, applySel),
      sel: () => (calSel && calSel.bookId === book.id ? calSel : null),
      setSel: (s) => applySel(s),
      onSelChange: () => { paintFavs(); }
    });
    /** 面板调整选区时，同步到日历高亮上 */
    function applySel(s) {
      calSel = s ? { bookId: book.id, from: s.from, to: s.to } : null;
      cal.update();
    }
    U.append(host, cal.el);

    /* ---- 收藏的日子 ---- */
    const favHost = U.el('div');
    U.append(host, favHost);
    function paintFavs() {
      U.clear(favHost);
      const keys = Store.diaryFavs(book.id);
      if (!keys.length) {
        U.append(favHost, U.el('div.field-note', {
          style: { margin: '8px 2px 0' },
          text: '长按日历上的日期就能收藏：收藏的日子会集中列在这里（再长按一次取消）。'
        }));
        return;
      }
      U.append(favHost, favCard(keys.slice().sort().reverse().map((k) => ({ book: book, key: k })), 6));
    }
    paintFavs();

    /* ---- 自定义间隔提醒 ---- */
    if (book.kind === 'custom') {
      const dates = Store.diaryDates(book);
      const last = dates[dates.length - 1];
      const gap = last ? U.dayDiff(last, today) : 999;
      const iv = book.intervalDays || 7;
      const nextDue = last ? U.shiftDate(last, iv) : today;
      U.append(host, U.el('div.card', { style: { marginTop: '12px', borderLeft: '3px solid ' + (gap >= iv ? 'var(--warn)' : 'var(--ok)') } }, [
        U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          U.icon('clock', 'ico-sm'),
          U.el('strong', { text: '自定义间隔：每 ' + iv + ' 天记录一次', style: { fontSize: '13.5px' } }),
          U.el('span', { style: { flex: '1 1 auto' } }),
          U.el('button.chip', { text: '修改间隔', onclick: () => UI.input({ title: '间隔天数', type: 'number', value: String(iv) }).then((v) => { if (v) { Store.updateDiaryBook(book.id, { intervalDays: Math.max(1, Number(v) || 1) }); UI.render(); } }) })
        ]),
        U.el('div', {
          text: last ? (gap >= iv ? '已超过 ' + (gap - iv + 1) + ' 天没记录了，建议今天补上。' : '距下次记录还有 ' + (iv - gap) + ' 天，下次日期：' + nextDue) : '还没有开始记录。',
          style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '6px' }
        }),
        U.el('button.btn.sm.primary', { style: { marginTop: '10px' }, onclick: () => quickWrite(book) }, [U.icon('edit', 'ico-sm'), U.el('span', { text: '现在记录一次' })])
      ]));
    }

    /* ---- 周 / 月汇总（周记、月记、自定义区间） ---- */
    if (book.kind === 'weekly' || book.kind === 'monthly' || book.kind === 'custom') {
      renderSummary(host, book, dateKey);
    }

    /* ---- 当日面板 ---- */
    const dayPanel = U.el('div.day-panel');
    U.append(host, dayPanel);
    renderDay();

    function dayEntries() {
      let list = entriesOn(book, dateKey);
      /* 多人日记：按作者筛选 */
      if (authorFilter) list = list.filter((e) => (e.author || '(未署名)') === authorFilter);
      return list;
    }

    function renderDay() {
      U.clear(dayPanel);
      const entries = dayEntries();
      const isToday = dateKey === todayKey();
      const canGoNext = dateKey < todayKey();               /* 后一天：不能走到未来 */
      const inf = infoOf(dateKey);

      U.append(dayPanel, U.el('div.day-head', {}, [
        U.el('h3', { text: U.fmtDateCN(dateKey) }),
        isToday ? U.el('span.badge.accent', { text: '今天' }) : null,
        inf.holiday ? U.el('span.badge', { text: inf.holiday.name }) : null,
        U.el('span.spacer'),
        U.el('button.icon-btn', { onclick: () => UI.go('diary/' + book.id + '/' + U.shiftDate(dateKey, -1)), 'aria-label': '前一天' }, U.icon('back')),
        U.el('button.icon-btn', {
          disabled: !canGoNext,
          title: canGoNext ? '后一天' : '还没到那一天',
          onclick: () => { if (canGoNext) UI.go('diary/' + book.id + '/' + U.shiftDate(dateKey, 1)); },
          'aria-label': '后一天'
        }, U.icon('chevron')),
        U.el('button.icon-btn', { onclick: () => entrySheet(book, dateKey, null), 'aria-label': '新建' }, U.icon('plus'))
      ]));

      /* 农历 / 节气 / 本周本月 —— 一眼看清这一天是什么日子 */
      const [ws, we] = U.weekRange(U.parseKey(dateKey));
      const weekEntries = collectRange(book, U.dateKey(ws), U.dateKey(we));
      const monthEntries = collectRange(book, dateKey.slice(0, 7) + '-01', dateKey.slice(0, 7) + '-31');
      U.append(dayPanel, U.el('div.day-sub', {}, [
        U.el('span', { text: '本周 ' + weekEntries.length + ' 篇 · 本月 ' + monthEntries.length + ' 篇' }),
        U.el('span', { text: fullDayLine(inf) })
      ]));

      /* ---- 多人创作入口：就在这一天上面，不用钻进编辑框 ---- */
      const armed = draftPeople[draftKey(book.id, dateKey)];
      const favNow = Store.isDiaryFav(book.id, dateKey);
      U.append(dayPanel, U.el('div.day-tools', {}, [
        U.el('button.btn.sm.multi-entry', {
          onclick: () => multiSheet(book, dateKey, renderDay)
        }, [U.icon('users', 'ico-sm'), U.el('span', { text: '多人创作' })]),
        armed && armed.length > 1
          ? U.el('span.badge.multi', { title: '参与者：' + global.Profile.joinNames(armed) }, '多人创作 · ' + global.Profile.joinNames(armed))
          : U.el('span.field-note', { text: '和谁一起写？' }),
        U.el('button.chip.fav-toggle' + (favNow ? '.on' : ''), {
          text: favNow ? '♥ 已收藏' : '♡ 收藏这一天',
          onclick: () => {
            const on = Store.toggleDiaryFav(book.id, dateKey);
            UI.toast(on ? '已收藏 ' + U.fmtDateCN(dateKey) : '已取消收藏', on ? 'star' : 'close');
            cal.update();
            paintFavs();
            renderDay();
          }
        })
      ]));

      /* ---- 大按钮：写这一天的日记（点日期 → 一下就开始写） ---- */
      const ctaLabel = entries.length ? '这一天再写一篇' : (isToday ? '写一篇' : '补写一篇');
      U.append(dayPanel, U.el('div.card.day-cta', {}, [
        U.el('div.day-cta-head', {}, [
          U.icon('edit', 'ico-sm'),
          U.el('div', {}, [
            U.el('div.day-cta-title', { text: isToday ? '写这一天的日记' : '补写这一天的日记' }),
            U.el('div.day-cta-sub', {
              text: entries.length
                ? '这一天已有 ' + entries.length + ' 篇，可以接着写'
                : (isToday ? '今天还没有记录，现在开始' : '这一天没有记录，可以补写；日期仍然记在这一天')
            })
          ])
        ]),
        U.el('button.btn.primary.block.day-cta-btn', {
          onclick: () => entrySheet(book, dateKey, null)
        }, [U.icon('edit', 'ico-sm'), U.el('span', { text: ctaLabel })])
      ]));

      entries.forEach((en) => {
        const card = U.el('div.card', { style: { marginBottom: '10px' } });
        appendEntryView(card, book, en, isToday);
        U.append(dayPanel, card);
      });

      if (!isToday) {
        U.append(dayPanel, U.el('div.field-note', {
          style: { marginTop: '8px' },
          text: '以前的日记随时可以改：点每篇下面的「编辑」，正文、心情、日期都能改。'
        }));
      }
      if (isNovelLike) {
        U.append(dayPanel, U.el('div.field-note', {
          style: { marginTop: '6px' },
          text: '这是「' + KIND_NAME[book.kind] + '」记录本：上面的汇总会把整个区间（本周 / 本月 / 最近 ' + (book.intervalDays || 7) + ' 天）的记录放在一起。'
        }));
      }
    }

    /* 滚动定位到指定条目 */
    if (entryId) {
      setTimeout(() => {
        const en = (book.entries || []).find((e) => e.id === entryId);
        if (!en) return;
        if (en.dateKey !== dateKey) { UI.go('diary/' + book.id + '/' + en.dateKey + '/' + entryId); return; }
        entrySheet(book, en.dateKey, en);
      }, 120);
    }

    /* 数据变化时局部刷新 */
    const unsub = Store.subscribe((s, meta) => {
      if (!meta || !meta.kind) return;
      if (meta.itemId && meta.itemId !== book.id) return;
      if (/^diary/.test(meta.kind)) {
        const scroll = view.scrollTop;
        cal.update();
        paintFavs();
        renderDay();
        view.scrollTop = scroll;
      } else if (meta.kind === 'settings') {
        /* 时区 / 亮度之类的设置变了：今天与时钟都要跟着变 */
        const scroll = view.scrollTop;
        clock.tick();
        cal.update();
        renderDay();
        view.scrollTop = scroll;
      }
    });
    return function () { unsub(); clearInterval(clockTimer); cal.dispose(); };
  }

  /** 「农历八月十四 · 周四 · 中秋节」这类整句 */
  function fullDayLine(inf) {
    const parts = [];
    if (inf.lunarInfo) parts.push('农历 · ' + inf.lunarInfo.monthName + ' · ' + inf.lunarInfo.dayName);
    if (inf.term) parts.push(inf.term);
    if (inf.holiday) parts.push(inf.holiday.name + (inf.holiday.type === 'workday-swap' ? ' · 调休上班' : ''));
    if (!parts.length) parts.push(inf.work ? '工作日' : '休息日');
    return parts.join(' · ');
  }

  /* ================================================================== */
  /* 多人创作（日记本页 / 当天面板上的入口）                            */
  /* ================================================================== */
  function multiSheet(book, dateKey, after) {
    const P = global.Profile;
    if (!P || !P.multiBlock) { UI.toast('多人创作暂不可用', 'close'); return; }
    const k = draftKey(book.id, dateKey);
    const dayEntries = entriesOn(book, dateKey);
    const initial = draftPeople[k] || P.autoParticipants('diary', book.id);
    const block = P.multiBlock(initial);
    let applyDay = dayEntries.length > 0;
    let asMembers = Array.isArray(book.members) && book.members.length > 0;

    function save() {
      const names = block.get();
      draftPeople[k] = names.slice();
      if (applyDay) {
        dayEntries.forEach((e) => Store.updateDiaryEntry(book.id, e.id, { participants: names.slice(), multi: names.length > 1 }));
      }
      if (asMembers) Store.setParticipants('diary', book.id, names);
      UI.toast(names.length > 1 ? '多人创作 · ' + P.joinNames(names) : '已保存（只有我）', 'users');
      UI.closeSheet();
      if (after) after();
      UI.render();
    }

    UI.sheet({
      title: '多人创作 · ' + U.fmtDateCN(dateKey),
      body: (host) => {
        U.append(host, [
          U.el('div.field-note', { text: '勾上一起写的人：这一天接下来写的日记会带上这些参与者，保存后也会标出「多人创作」。' }),
          block.el,
          dayEntries.length ? UI.switchRow('同时写到这一天的 ' + dayEntries.length + ' 篇记录上', '保存后这些记录都会标成多人创作', applyDay, (v) => { applyDay = v; }) : null,
          UI.switchRow('设为多人日记本', '把这些人写进记录本成员，每条记录按作者区分', asMembers, (v) => { asMembers = v; })
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '保存', primary: true, close: false, onClick: () => save() }
      ]
    });
  }

  /* ================================================================== */
  /* 条目展示                                                          */
  /* ================================================================== */
  function appendEntryView(card, book, en, isToday) {
    const isShared = Array.isArray(book.members) && book.members.length > 0;
    const head = U.el('div.card-head', {}, [
      U.el('div.card-title', { text: en.title || (isToday ? '今天' : U.fmtDateCN(en.dateKey)) }),
      /* 跨天日记：一眼看出覆盖了哪几天 */
      en.range && en.fromKey && en.toKey ? U.el('span.badge.range', { text: rangeBadgeText(en) }) : null,
      /* 多人日记：标出这条是谁写的 */
      isShared ? U.el('span.badge.ok', {}, [U.icon('users', 'ico-sm'), U.el('span', { text: ' ' + (en.author || '未署名') })]) : null,
      en.mood ? U.el('span.badge', { dataset: { i18nGroup: 'mood:' + MOODS.indexOf(en.mood) }, text: en.mood }) : null,
      en.weather ? U.el('span.badge', { dataset: { i18nGroup: 'wx:' + WEATHERS.indexOf(en.weather) }, text: en.weather }) : null,
      U.el('button.icon-btn', { onclick: () => entryMenu(book, en), 'aria-label': '更多' }, U.icon('more', 'ico-sm'))
    ]);
    card.appendChild(head);

    const metaLine = U.el('div.card-sub');
    metaLine.appendChild(U.el('span', { text: U.fmtInt(en.words || U.words(en.content || '')) + ' 字' }));
    metaLine.appendChild(U.el('span', { text: '写于 ' + U.fmtWhen(en.createdAt) }));
    if (en.updatedAt && en.updatedAt - en.createdAt > 60000) metaLine.appendChild(U.el('span', { text: '改于 ' + U.fmtWhen(en.updatedAt) }));
    if ((en.tags || []).length) metaLine.appendChild(U.el('span', { text: en.tags.map((t) => '#' + t).join(' ') }));
    card.appendChild(metaLine);

    const body = U.el('div.user-text', {
      style: { fontFamily: 'var(--font-serif)', lineHeight: '1.85', whiteSpace: 'pre-wrap', marginTop: '10px', fontSize: '15px' },
      text: en.content || '（还没有内容）'
    });
    card.appendChild(body);

    const multiLine = global.Profile && global.Profile.participantsLine(en, { style: { marginTop: '8px' } });
    if (multiLine) card.appendChild(multiLine);
    if ((en.images || []).length) {
      const grid = U.el('div.diary-imgs');
      grid.style.gridTemplateColumns = en.images.length === 1 ? '1fr' : 'repeat(3, 1fr)';
      en.images.forEach((img) => {
        const box = U.el('div.diary-img', {
          style: en.images.length === 1 ? { aspectRatio: 'auto', maxHeight: '320px' } : null,
          onclick: () => viewImage(img)
        });
        const im = U.el('img', { alt: img.name || '插图', loading: 'lazy' });
        box.appendChild(im);
        DB.getImage(img.id).then((data) => { if (data) im.src = data; });
        grid.appendChild(box);
      });
      card.appendChild(grid);
    }

    card.appendChild(U.el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
      U.el('button.btn.sm', { onclick: () => entrySheet(book, en.dateKey, en) }, [U.icon('edit', 'ico-sm'), U.el('span', { text: '编辑' })]),
      U.el('button.btn.sm.ghost', { onclick: () => addImages(book, en) }, [U.icon('image', 'ico-sm'), U.el('span', { text: '插入图片' })])
    ]));
  }

  function viewImage(img) {
    DB.getImage(img.id).then((data) => {
      if (!data) { UI.toast('图片已丢失', 'close'); return; }
      UI.modal({
        title: img.name || '插图',
        body: () => U.el('img', { src: data, style: { width: '100%', borderRadius: '10px' } }),
        buttons: [{ label: '关闭', primary: true, value: true }]
      });
    });
  }

  function entryMenu(book, en) {
    UI.sheet({
      title: '记录操作',
      body: (host) => {
        const items = [
          { label: '编辑', icon: 'edit', fn: () => entrySheet(book, en.dateKey, en) },
          { label: '插入图片', icon: 'image', fn: () => addImages(book, en) },
          { label: '复制文本', icon: 'copy', fn: () => U.copyText((en.title ? en.title + '\n' : '') + en.content).then((ok) => UI.toast(ok ? '已复制' : '复制失败', 'copy')) },
          { label: '导出这一篇', icon: 'down', fn: () => IO.download(book.title + '-' + en.dateKey + '.txt', (en.title ? en.title + '\n\n' : '') + en.content, 'text/plain') },
          { label: '删除', icon: 'trash', danger: true, fn: () => UI.confirm('删除记录', '这一篇将被删除（可撤销一次）。', '删除', true).then((ok) => { if (ok) { Store.deleteDiaryEntry(book.id, en.id); UI.toast('已删除', 'trash'); } }) }
        ];
        const list = U.el('div.list');
        items.forEach((it) => list.appendChild(U.el('div.row.tap', { onclick: () => { UI.closeSheet(); setTimeout(it.fn, 80); } }, [
          U.el('span.row-chev', { style: { color: it.danger ? 'var(--danger)' : 'var(--text-2)' } }, U.icon(it.icon, 'ico-sm')),
          U.el('div.row-main', {}, U.el('div.row-title', { text: it.label, style: it.danger ? { color: 'var(--danger)' } : null }))
        ])));
        U.append(host, list);
      }
    });
  }

  /* ================================================================== */
  /* 写 / 编辑一篇（含「这几天的专属日记」）                            */
  /* ================================================================== */
  /** 跨天日记：长按后选了一段日子，写一篇覆盖这几天的记录 */
  function rangeSheet(book, fromKey, toKey) {
    const a = fromKey <= toKey ? fromKey : toKey;
    const b = fromKey <= toKey ? toKey : fromKey;
    entrySheet(book, b, null, { rangeFrom: a, rangeTo: b });
  }

  function entrySheet(book, dateKey, entry, opts) {
    const o = opts || {};
    const isRange = !!(o.rangeFrom && o.rangeTo);
    const isNew = !entry;
    const en = entry || { title: '', content: '', mood: '', weather: '', tags: [], images: [], dateKey: dateKey };
    const isRangeEntry = !!(en.range && en.fromKey && en.toKey);
    const images = (en.images || []).slice();
    const today = todayKey();

    /* 多人创作：新建时优先用这一天已经选好的名单，其次自动推断；已有多人的条目沿用原名单 */
    const P = global.Profile;
    const peopleKey = draftKey(book.id, isRange ? o.rangeTo : dateKey);
    const initialPeople = !isNew ? Store.participantsOf(en)
      : (draftPeople[peopleKey] || (P ? P.autoParticipants('diary', book.id) : []));
    const multi = P ? P.multiBlock(initialPeople) : null;

    const titleInput = U.el('input.input', { value: en.title || '', placeholder: '标题（可留空）' });
    const ta = U.el('textarea.textarea', {
      placeholder: isRange ? '这几天发生了什么？想到什么就写什么……' : '今天发生了什么？想到什么就写什么……',
      rows: 9
    });
    ta.value = en.content || '';
    ta.style.fontFamily = 'var(--font-serif)';
    ta.style.lineHeight = '1.8';
    ta.addEventListener('input', () => { countEl.textContent = U.fmtInt(U.words(ta.value)) + ' 字'; });

    const countEl = U.el('span', { text: U.fmtInt(U.words(ta.value)) + ' 字', style: { fontSize: '11.5px', color: 'var(--text-3)' } });

    /* 心情 / 天气 */
    let mood = en.mood || '', weather = en.weather || '';
    const moodChips = U.el('div.chips.scroll');
    MOODS.forEach((m, mi) => moodChips.appendChild(U.el('button.chip' + (mood === m ? '.active' : ''), {
      dataset: { i18nGroup: 'mood:' + mi },
      text: m, onclick: (e) => {
        mood = mood === m ? '' : m;
        U.$$('.chip', moodChips).forEach((c) => c.classList.remove('active'));
        if (mood) e.currentTarget.classList.add('active');
      }
    })));
    const weatherChips = U.el('div.chips.scroll');
    WEATHERS.forEach((wth, wi) => weatherChips.appendChild(U.el('button.chip' + (weather === wth ? '.active' : ''), {
      dataset: { i18nGroup: 'wx:' + wi },
      text: wth, onclick: (e) => {
        weather = weather === wth ? '' : wth;
        U.$$('.chip', weatherChips).forEach((c) => c.classList.remove('active'));
        if (weather) e.currentTarget.classList.add('active');
      }
    })));

    /* 标签 */
    let tags = (en.tags || []).slice();
    const tagsInput = U.el('input.input', { value: tags.join(' '), placeholder: '标签（空格分隔）' });

    /* 图片区 */
    const imgGrid = U.el('div.diary-imgs');
    function renderImages() {
      U.clear(imgGrid);
      images.forEach((img) => {
        const box = U.el('div.diary-img');
        const im = U.el('img', { alt: img.name || '' });
        DB.getImage(img.id).then((d) => { if (d) im.src = d; });
        box.appendChild(im);
        box.appendChild(U.el('button.del', {
          onclick: () => {
            const i = images.findIndex((x) => x.id === img.id);
            if (i >= 0) images.splice(i, 1);
            DB.deleteImage(img.id);
            renderImages();
          }, 'aria-label': '删除图片'
        }, U.icon('close')));
        imgGrid.appendChild(box);
      });
      imgGrid.appendChild(U.el('button.img-add', { onclick: pickImages, 'aria-label': '添加图片' }, U.icon('image')));
    }
    renderImages();

    function pickImages() {
      IO.pickFile('image/*', true).then((files) => {
        if (!files.length) return;
        UI.toast('正在处理图片…', 'image');
        Promise.all(files.map((f) => U.compressImage(f, 1600, 0.82).then((data) => {
          const id = U.uid('img');
          return DB.putImage(id, data).then(() => ({ id: id, name: f.name, size: data.length, at: Date.now() }));
        }))).then((metas) => {
          metas.forEach((m) => images.push(m));
          renderImages();
          UI.toast('已添加 ' + metas.length + ' 张图片', 'image');
        }).catch((e) => UI.alert('图片处理失败', String(e.message || e)));
      });
    }

    const sheet = UI.sheet({
      title: isRange ? '写这几天的日记' : isNew ? (dateKey === today ? '写日记' : '补记 · ' + dateKey) : '编辑记录',
      body: (host) => {
        U.append(host, [
          U.el('div.field', {}, [U.el('label', { text: '日期' }), dateRow()]),
          U.el('div.field', {}, [U.el('label', { text: '标题' }), titleInput]),
          U.el('div.field', {}, [U.el('label', { text: '正文' }), ta, U.el('div', { style: { textAlign: 'right', marginTop: '4px' } }, countEl)]),
          U.el('div.field', {}, [U.el('label', { text: '心情' }), moodChips]),
          U.el('div.field', {}, [U.el('label', { text: '天气' }), weatherChips]),
          U.el('div.field', {}, [U.el('label', { text: '标签' }), tagsInput]),
          U.el('div.field', {}, [U.el('label', { text: '插图' }), imgGrid, U.el('button.btn.sm.ghost', { style: { marginTop: '8px' }, onclick: pickImages }, [U.icon('image', 'ico-sm'), U.el('span', { text: '从相册选择' })])]),
          multi ? U.el('div.field', {}, [U.el('label', { text: '一起写的人' }), multi.el]) : null
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: isNew ? '保存' : '保存修改', primary: true, close: false, onClick: () => save() }
      ],
      onMount: () => setTimeout(() => { try { ta.focus(); } catch (e) { /* noop */ } }, 200)
    });

    function dateRow() {
      /* 跨天日记：日期是一个区间，不能改单日 */
      if (isRange) {
        return U.el('div.range-row', {}, [
          U.icon('calendar', 'ico-sm'),
          U.el('span', { text: o.rangeFrom + ' ~ ' + o.rangeTo }),
          U.el('span.badge.range', { text: shortRange(o.rangeFrom, o.rangeTo) })
        ]);
      }
      if (isRangeEntry) {
        return U.el('div.range-row', {}, [
          U.icon('calendar', 'ico-sm'),
          U.el('span', { text: en.fromKey + ' ~ ' + en.toKey }),
          U.el('span.badge.range', { text: rangeBadgeText(en) })
        ]);
      }
      const input = U.el('input.input', { type: 'date', value: en.dateKey || dateKey, max: today });
      input.addEventListener('change', () => {
        /* 未来日期不能记：选到以后就拉回今天并提示 */
        if (input.value && input.value > today) {
          input.value = today;
          en.dateKey = today;
          UI.toast('还没到那一天，日期已设为今天', 'calendar');
          return;
        }
        en.dateKey = input.value || dateKey;
      });
      return input;
    }

    function save() {
      const picked = en.dateKey || dateKey;
      const people = multi ? multi.get() : [];
      const patch = {
        title: titleInput.value.trim(),
        content: ta.value,
        mood: mood,
        weather: weather,
        tags: tagsInput.value.trim() ? tagsInput.value.trim().split(/\s+/) : [],
        images: images,
        participants: people,
        multi: people.length > 1
      };
      if (isRange) {
        Store.addDiaryRange(book.id, o.rangeFrom, o.rangeTo, patch);
        UI.toast('已保存跨天日记 · ' + shortRange(o.rangeFrom, o.rangeTo), 'check');
      } else {
        /* 兜底：任何路径都不写未来日期；跨天日记保持原区间不动 */
        if (!isRangeEntry) patch.dateKey = picked > today ? today : picked;
        if (isNew) {
          /* 多人日记：新建时署上我的名字；单人本留空，保持界面干净 */
          if (Array.isArray(book.members) && book.members.length) {
            patch.author = (global.Collab && global.Collab.me()) || '我';
          }
          Store.addDiaryEntry(book.id, patch);
          UI.toast(patch.multi ? '已保存 · 多人创作（' + global.Profile.joinNames(patch.participants) + '）' : '已保存', 'check');
        } else {
          Store.updateDiaryEntry(book.id, en.id, patch);
          UI.toast('已更新', 'check');
        }
      }
      images.forEach((img) => { if (!img._saved) DB.putImage(img.id, '').catch(() => {}); });
      UI.closeSheet();
      UI.render();
    }
  }

  async function addImages(book, en) {
    const files = await IO.pickFile('image/*', true);
    if (!files.length) return;
    const metas = [];
    for (const f of files) {
      const data = await U.compressImage(f, 1600, 0.82);
      const id = U.uid('img');
      await DB.putImage(id, data);
      const meta = { id: id, name: f.name, size: data.length, at: Date.now() };
      metas.push(meta);
      Store.addDiaryImage(book.id, en.id, meta);
    }
    UI.toast('已添加 ' + metas.length + ' 张图片', 'image');
  }

  /* ================================================================== */
  /* 周 / 月 汇总                                                      */
  /* ================================================================== */
  function renderSummary(host, book, dateKey) {
    const card = U.el('div.card.summary-card', { style: { marginTop: '12px' } });
    U.append(host, card);

    function draw() {
      U.clear(card);
      const isWeek = book.kind === 'weekly';
      const isMonth = book.kind === 'monthly';
      const [ws, we] = U.weekRange(U.parseKey(dateKey));
      const from = isWeek ? U.dateKey(ws) : isMonth ? dateKey.slice(0, 7) + '-01' : U.shiftDate(dateKey, -((book.intervalDays || 7) - 1));
      const to = isWeek ? U.dateKey(we) : isMonth ? U.dateKey(new Date(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)), 0)) : dateKey;
      const list = collectRange(book, from, to);
      const title = isWeek ? '本周汇总（' + from + ' ~ ' + to + '）'
        : isMonth ? dateKey.slice(0, 7) + ' 月度汇总'
        : '最近 ' + (book.intervalDays || 7) + ' 天汇总';

      U.append(card, U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } }, [
        U.icon(isMonth ? 'calendar' : 'list', 'ico-sm'),
        U.el('strong', { text: title, style: { fontSize: '13.5px' } }),
        U.el('span', { style: { flex: '1 1 auto' } }),
        U.el('span.badge', { text: list.length + ' 篇' }),
        U.el('button.chip', { text: '导出汇总', onclick: () => {
          const text = title + '\n\n' + list.map((e) => '【' + e.dateKey + ' ' + U.weekdayCN(e.dateKey) + '】\n' + (e.title ? e.title + '\n' : '') + e.content).join('\n\n');
          IO.download(book.title + '-' + from + '-汇总.txt', text || '（本区间没有记录）', 'text/plain');
          UI.toast('已导出汇总', 'down');
        } })
      ]));

      if (!list.length) {
        U.append(card, U.el('div', { style: { fontSize: '12.5px', color: 'var(--text-3)' }, text: '这个区间还没有记录。你的日常日记也会自动汇总到这里。' }));
        return;
      }

      const totalWords = list.reduce((s, e) => s + (e.words || U.words(e.content || '')), 0);
      U.append(card, U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginBottom: '10px' }, text: '共 ' + U.fmtInt(totalWords) + ' 字 · ' + list.length + ' 篇记录' }));

      const box = U.el('div.km-list');
      list.forEach((e) => {
        box.appendChild(U.el('div.km-item', {}, [
          U.el('div.km-date', { text: U.fmtDateCN(e.dateKey) + (e.range ? ' · ' + rangeBadgeText(e) : '') + (e.mood ? ' · ' + e.mood : '') }),
          U.el('div.km-text', { text: U.excerpt(e.content, 180) || '（空）' })
        ]));
      });
      U.append(card, box);
    }
    draw();
  }

  /* 给验证脚本留几个只读小工具（不参与界面逻辑） */
  DV.shortRange = shortRange;
  DV.longRange = longRange;
  DV.infoOf = infoOf;
  DV.entriesOn = entriesOn;
  DV.countOn = countOn;
  DV.draftOf = (bookId, dateKey) => draftPeople[draftKey(bookId, dateKey)] || null;

  global.DiaryView = DV;
})(window);
