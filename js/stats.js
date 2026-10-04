/* ==========================================================================
   selfwriting · stats.js
   创作时长 / 字数 / 速度 / 滞留最长间隔 + 每日记录
   只记录本机行为，不上报任何数据。
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const S = {};

  /* ---------------- 结构 ---------------- */
  S.create = function () {
    return {
      daily: {},        // 'YYYY-MM-DD' -> { ms, words, byModule:{novel,article,diary}, items:{} }
      journal: [],      // 写作段流水（最多 1500 条）
      totals: { ms: 0, words: 0, sessions: 0 },
      modules: {
        novel: { ms: 0, words: 0, sessions: 0 },
        article: { ms: 0, words: 0, sessions: 0 },
        diary: { ms: 0, words: 0, sessions: 0 },
        reading: { ms: 0, words: 0, sessions: 0 }
      },
      gaps: { maxGapDays: 0, maxGapFrom: null, maxGapTo: null, currentGapDays: 0 },
      best: { dayWords: 0, dayDate: null, speedPerHour: 0, speedDate: null, longestSessionMs: 0, longestSessionAt: null },
      items: {}         // itemId -> { kind, title, ms, words }
    };
  };

  /** 兼容旧数据 / 缺字段 */
  S.migrate = function (stats) {
    const base = S.create();
    if (!stats || typeof stats !== 'object') return base;
    const out = Object.assign(base, stats);
    out.daily = stats.daily || {};
    out.journal = Array.isArray(stats.journal) ? stats.journal.slice(-1500) : [];
    out.totals = Object.assign(base.totals, stats.totals || {});
    out.modules = Object.assign(base.modules, stats.modules || {});
    ['novel', 'article', 'diary', 'reading'].forEach((k) => {
      out.modules[k] = Object.assign({ ms: 0, words: 0, sessions: 0 }, out.modules[k] || {});
    });
    out.gaps = Object.assign(base.gaps, stats.gaps || {});
    out.best = Object.assign(base.best, stats.best || {});
    out.items = stats.items || {};
    Object.keys(out.daily).forEach((k) => {
      const d = out.daily[k] || {};
      d.ms = d.ms || 0; d.words = d.words || 0;
      d.byModule = Object.assign({ novel: 0, article: 0, diary: 0, reading: 0 }, d.byModule || {});
      d.items = d.items || {};
      out.daily[k] = d;
    });
    return out;
  };

  const day = (key) => {
    const st = global.Store.state.stats;
    const k = key || U.dateKey();
    if (!st.daily[k]) st.daily[k] = { ms: 0, words: 0, byModule: { novel: 0, article: 0, diary: 0, reading: 0 }, items: {} };
    const d = st.daily[k];
    if (!d.byModule) d.byModule = { novel: 0, article: 0, diary: 0, reading: 0 };
    if (!d.items) d.items = {};
    return d;
  };

  /* ---------------- 会话（写作段） ---------------- */
  let session = null;     // { kind, startedAt, lastAt, ms, words, itemId, dateKey }
  let idleTimer = null;

  function idleLimitMs() {
    const s = (global.Store.state.settings.sessionIdleSeconds || 45) * 1000;
    return U.clamp(s, 5000, 10 * 60 * 1000);
  }

  S.session = function () { return session; };
  S.sessionElapsedMs = function () { return session ? session.ms : 0; };
  S.isActive = function () { return !!session; };

  function startSession(kind, itemId) {
    session = { kind: kind, startedAt: Date.now(), lastAt: Date.now(), ms: 0, words: 0, itemId: itemId || null, dateKey: U.dateKey() };
    return session;
  }

  function closeSession(reason) {
    if (!session) return;
    const st = global.Store.state.stats;
    const sess = session;
    session = null;
    clearTimeout(idleTimer);
    if (sess.ms < 3000) return;   // 太短不计
    const d = day(sess.dateKey);
    st.totals.sessions++;
    st.modules[sess.kind].sessions = (st.modules[sess.kind].sessions || 0) + 1;
    if (sess.ms > (st.best.longestSessionMs || 0)) {
      st.best.longestSessionMs = sess.ms;
      st.best.longestSessionAt = sess.startedAt;
    }
    st.journal.push({
      kind: sess.kind, start: sess.startedAt, end: Date.now(),
      ms: sess.ms, words: sess.words, itemId: sess.itemId, reason: reason || 'idle'
    });
    if (st.journal.length > 1500) st.journal.splice(0, st.journal.length - 1500);
    d.ms += sess.ms;
    recalcGaps();
    global.Store.markDirty();
    if (global.UI) global.UI.onSessionEnd && global.UI.onSessionEnd(sess);
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { flushSession(); }, idleLimitMs());
  }

  /** 把当前会话时长结算并入（不结束会话） */
  function flushSession() {
    if (!session) return;
    const st = global.Store.state.stats;
    const now = Date.now();
    const dt = now - session.lastAt;
    if (dt > 0 && dt < 6 * 60 * 1000) {
      session.ms += dt;
      session.lastAt = now;
      st.totals.ms += dt;
      st.modules[session.kind].ms += dt;
      const d = day(session.dateKey);
      d.ms += dt;
      if (session.itemId) {
        const it = st.items[session.itemId] || (st.items[session.itemId] = { kind: session.kind, title: '', ms: 0, words: 0 });
        it.ms += dt;
      }
    } else {
      session.lastAt = now;
    }
    checkSpeed();
  }

  function checkSpeed() {
    const st = global.Store.state.stats;
    if (!session) return;
    if (session.ms >= 5 * 60 * 1000 && session.words >= 60) {
      const perHour = Math.round(session.words / (session.ms / 3600000));
      if (perHour > (st.best.speedPerHour || 0) && perHour < 20000) {
        st.best.speedPerHour = perHour;
        st.best.speedDate = U.dateKey();
      }
    }
  }

  /**
   * 写作行为入口。
   * @param {string} kind  novel | article | diary | reading
   * @param {number} wordsDelta 本次新增字数
   * @param {number} msDelta 额外时长（导入等场景可传 0）
   * @param {object} opts { itemId, dateKey }
   */
  S.touch = function (state, kind, wordsDelta, msDelta, opts) {
    const o = opts || {};
    if (!state.stats) state.stats = S.create();
    if (!session || session.kind !== kind || (o.itemId && session.itemId && o.itemId !== session.itemId)) {
      if (session) closeSession('switch');
      startSession(kind, o.itemId);
    } else {
      flushSession();
    }
    scheduleIdle();

    const st = state.stats;
    const d = day(o.dateKey || U.dateKey());
    const words = Math.max(0, Math.round(wordsDelta || 0));
    if (words > 0) {
      st.totals.words += words;
      st.modules[kind].words += words;
      d.words += words;
      d.byModule[kind] = (d.byModule[kind] || 0) + words;
      session.words += words;
      if (o.itemId) {
        const it = st.items[o.itemId] || (st.items[o.itemId] = { kind: kind, title: '', ms: 0, words: 0 });
        it.words += words;
      }
      const goal = state.settings.dailyGoalWords || 0;
      const wasDone = goal > 0 && (d.words - words) >= goal;
      const nowDone = goal > 0 && d.words >= goal;
      if (nowDone && !wasDone && global.UI) global.UI.toast('今日目标达成！' + U.fmtInt(d.words) + ' 字', 'target');
      if (d.words > (st.best.dayWords || 0)) { st.best.dayWords = d.words; st.best.dayDate = o.dateKey || U.dateKey(); }
      // 每写 500 字合并落盘一次，避免频繁写盘
      if (st.totals.words % 500 < words) global.Store.flushLocal();
    }
    if (msDelta) {
      st.totals.ms += msDelta;
      st.modules[kind].ms += msDelta;
      d.ms += msDelta;
      session.ms += msDelta;
    }
    return session;
  };

  /** 阅读计时：以分钟级累积（阅读器每分钟上报一次） */
  S.touchReading = function (state, ms, bookId) {
    if (!state.stats) state.stats = S.create();
    const st = state.stats;
    const d = day();
    st.totals.ms += ms;
    st.modules.reading.ms += ms;
    d.ms += ms;
    d.byModule.reading = (d.byModule.reading || 0) + ms;
    if (bookId) {
      const it = st.items[bookId] || (st.items[bookId] = { kind: 'reading', title: '', ms: 0, words: 0 });
      it.ms += ms;
    }
    global.Store.markDirty();
  };

  S.flush = function () { flushSession(); };
  S.end = function (reason) { closeSession(reason || 'manual'); };

  /* ---------------- 间隔分析 ---------------- */
  function recalcGaps() {
    const st = global.Store.state.stats;
    const keys = Object.keys(st.daily)
      .filter((k) => (st.daily[k].words || 0) > 0 || (st.daily[k].ms || 0) > 60000)
      .sort();
    if (!keys.length) { st.gaps.maxGapDays = 0; st.gaps.currentGapDays = 0; return; }
    let maxGap = 0, from = null, to = null;
    for (let i = 1; i < keys.length; i++) {
      const gap = U.dayDiff(keys[i - 1], keys[i]) - 1;
      if (gap > maxGap) { maxGap = gap; from = keys[i - 1]; to = keys[i]; }
    }
    st.gaps.maxGapDays = maxGap;
    st.gaps.maxGapFrom = from;
    st.gaps.maxGapTo = to;
    const today = U.dateKey();
    const last = keys[keys.length - 1];
    st.gaps.currentGapDays = Math.max(0, U.dayDiff(last, today) - (keys.indexOf(today) >= 0 ? 0 : 0));
    if (last === today) st.gaps.currentGapDays = 0;
    else st.gaps.currentGapDays = U.dayDiff(last, today);
    st.gaps.lastActive = last;
  }
  S.recalcGaps = recalcGaps;

  /* ---------------- 查询 ---------------- */
  /** 连续活跃天数（含今天/昨天） */
  S.currentStreak = function (state) {
    const daily = (state.stats && state.stats.daily) || {};
    let cursor = U.dateKey();
    const has = (k) => daily[k] && ((daily[k].words || 0) > 0 || (daily[k].ms || 0) > 60000);
    if (!has(cursor)) cursor = U.shiftDate(cursor, -1);
    let n = 0;
    while (has(cursor)) { n++; cursor = U.shiftDate(cursor, -1); }
    return n;
  };

  /** 今日数据 */
  S.today = function (state) {
    const daily = (state.stats && state.stats.daily) || {};
    return daily[U.dateKey()] || { ms: 0, words: 0, byModule: { novel: 0, article: 0, diary: 0 }, items: {} };
  };

  /** 近 N 天序列：[{key, words, ms}] */
  S.series = function (state, days) {
    const daily = (state.stats && state.stats.daily) || {};
    const out = [];
    const n = days || 14;
    for (let i = n - 1; i >= 0; i--) {
      const k = U.shiftDate(U.dateKey(), -i);
      const d = daily[k] || { words: 0, ms: 0 };
      out.push({ key: k, words: d.words || 0, ms: d.ms || 0, byModule: d.byModule || {} });
    }
    return out;
  };

  /** 某模块速度（字/小时）：基于该模块的累计字数与时长 */
  S.speed = function (state, kind) {
    const st = state.stats;
    if (!st) return 0;
    const m = kind ? st.modules[kind] : { ms: st.totals.ms, words: st.totals.words };
    if (!m || !m.ms || m.ms < 60000) return 0;
    return Math.round((m.words || 0) / (m.ms / 3600000));
  };

  /** 近 N 天平均每日字数 */
  S.dailyAverage = function (state, days) {
    const ser = S.series(state, days || 30);
    const total = ser.reduce((s, x) => s + x.words, 0);
    return Math.round(total / (days || 30));
  };

  /** 汇总卡片数据 */
  S.summary = function (state) {
    const st = state.stats || S.create();
    const ser30 = S.series(state, 30);
    const activeDays30 = ser30.filter((x) => x.words > 0 || x.ms > 60000).length;
    const today = S.today(state);
    const goal = state.settings.dailyGoalWords || 0;
    return {
      totalMs: st.totals.ms,
      totalWords: st.totals.words,
      sessions: st.totals.sessions,
      avgSessionMs: st.totals.sessions ? Math.round(st.totals.ms / st.totals.sessions) : 0,
      today: today,
      goal: goal,
      goalPercent: goal > 0 ? U.clamp(today.words / goal, 0, 1) : 0,
      streak: S.currentStreak(state),
      speedAll: S.speed(state, null),
      speedNovel: S.speed(state, 'novel'),
      speedArticle: S.speed(state, 'article'),
      speedDiary: S.speed(state, 'diary'),
      activeDays30: activeDays30,
      avg30: Math.round(ser30.reduce((s, x) => s + x.words, 0) / 30),
      maxGapDays: st.gaps.maxGapDays || 0,
      maxGapFrom: st.gaps.maxGapFrom,
      maxGapTo: st.gaps.maxGapTo,
      currentGapDays: st.gaps.currentGapDays || 0,
      lastActive: st.gaps.lastActive || null,
      best: st.best,
      modules: st.modules,
      series30: ser30
    };
  };

  /** 重置统计（保留作品） */
  S.reset = function (state) {
    state.stats = S.create();
    global.Store.markDirty();
  };

  global.Stats = S;
})(window);
