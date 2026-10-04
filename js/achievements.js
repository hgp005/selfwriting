/* ==========================================================================
   selfwriting · achievements.js
   成就系统：每个模块一套独立规则
     小说：每 10 万字一个成就（1万起步 → 千万）
     文章：每 1 千字一个成就（1千起步 → 百万）
     日记：每 1 千字 + 记录天数 + 连续记录（连续一周 / 100 天 / 一年）
     大纲：节点数与重点标记
     阅读：读完的册数与字数
     综合：活跃天数 / 周 / 月 / 年
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const Store = global.Store;
  const Ach = {};

  /* ---------------- 规则生成器 ---------------- */
  function tiers(group, iconName, unit, values, fmtValue, extra) {
    return values.map((v) => Object.assign({
      group: group,
      icon: iconName,
      unit: unit,
      target: v,
      title: fmtValue(v) + unit,
      desc: '累计达到 ' + fmtValue(v) + unit,
      value: (c) => c.value
    }, extra || {}));
  }

  const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const cnNum = (n) => (n <= 10 ? CN[n] : String(n));

  const w = (n) => U.numName(n) + '字';

  /**
   * 是否计入成就。
   * 导入的外部内容默认标记 countAchievements = false：
   * 别人的作品不该因为「导入」这个动作就解锁成就，也不该弹出解锁提示。
   * 用户可在条目菜单里手动改为「计入成就」。
   */
  function counts(item) {
    return !item || item.countAchievements !== false;
  }

  /* ---------------- 规则表 ---------------- */
  function buildRules() {
    const rules = [];
    const add = (r) => { rules.push(Object.assign({ group: 'misc', icon: 'star', unit: '' }, r)); };

    /* ===== 小说：每 10 万字 ===== */
    // 10^5 起（10 万），上到 10^8（1 亿）
    U.pow10Series(5, 8).forEach((v) => {
      const label = U.numName(v) + '字';
      add({
        id: 'novel_words_' + v, group: 'novel', icon: 'feather', unit: '字', target: v,
        title: label + ' · 里程碑',
        desc: '小说累计达到 ' + label,
        value: (c) => c.novel.words,
        fmt: w
      });
    });
    // 起步鼓励档（1 万 / 5 万）
    [10000, 50000].forEach((v) => {
      add({
        id: 'novel_words_' + v, group: 'novel', icon: 'feather', unit: '字', target: v,
        title: U.numName(v) + '字',
        desc: '小说累计达到 ' + U.numName(v) + '字',
        value: (c) => c.novel.words,
        fmt: w
      });
    });
    // 单本长篇：10 万 / 20 万 / 50 万 / 100 万
    [100000, 200000, 500000, 1000000].forEach((v) => {
      add({
        id: 'novel_book_' + v, group: 'novel', icon: 'book', unit: '字', target: v,
        title: '长篇 · ' + U.numName(v) + '字',
        desc: '任意一本小说写到 ' + U.numName(v) + '字',
        value: (c) => c.novel.maxBookWords,
        fmt: w
      });
    });
    // 章数
    [10, 30, 100, 300].forEach((v) => {
      add({
        id: 'novel_chapters_' + v, group: 'novel', icon: 'list', unit: '章', target: v,
        title: v + ' 章',
        desc: '累计完成 ' + v + ' 个章节',
        value: (c) => c.novel.chapters
      });
    });
    // 完成一本书 / 三本
    [1, 3, 5, 10].forEach((v) => {
      add({
        id: 'novel_finished_' + v, group: 'novel', icon: 'check', unit: '本', target: v,
        title: cnNum(v) + '本完结',
        desc: '完成 ' + v + ' 本小说',
        value: (c) => c.novel.finished
      });
    });
    [1000, 5000, 10000].forEach((v) => {
      add({
        id: 'novel_goal_' + v, group: 'novel', icon: 'target', unit: '次', target: v,
        title: '达标 ' + U.numName(v) + ' 次',
        desc: '章节字数达标累计 ' + U.numName(v) + ' 次',
        value: (c) => c.novel.goalsHit
      });
    });

    /* ===== 文章：每 1 千字 ===== */
    U.pow10Series(3, 6).forEach((v) => {
      add({
        id: 'article_words_' + v, group: 'article', icon: 'doc', unit: '字', target: v,
        title: U.numName(v) + '字',
        desc: '文章累计达到 ' + U.numName(v) + '字',
        value: (c) => c.article.words,
        fmt: w
      });
    });
    [1000, 5000, 20000, 50000, 100000, 500000].forEach((v) => {
      add({
        id: 'article_single_' + v, group: 'article', icon: 'doc', unit: '字', target: v,
        title: '单篇 · ' + U.numName(v) + '字',
        desc: '单篇文章达到 ' + U.numName(v) + '字',
        value: (c) => c.article.maxWords,
        fmt: w
      });
    });
    [1, 5, 10, 30, 50, 100, 300].forEach((v) => {
      add({
        id: 'article_count_' + v, group: 'article', icon: 'text', unit: '篇', target: v,
        title: v + ' 篇',
        desc: '累计写作 ' + v + ' 篇文章',
        value: (c) => c.article.count
      });
    });

    /* ===== 日记：字数 + 天数 + 连续 ===== */
    U.pow10Series(3, 5).forEach((v) => {
      add({
        id: 'diary_words_' + v, group: 'diary', icon: 'feather', unit: '字', target: v,
        title: U.numName(v) + '字',
        desc: '日记累计达到 ' + U.numName(v) + '字',
        value: (c) => c.diary.words,
        fmt: w
      });
    });
    [1, 7, 30, 100, 365, 1000].forEach((v) => {
      add({
        id: 'diary_days_' + v, group: 'diary', icon: 'calendar', unit: '天', target: v,
        title: '记录了 ' + v + ' 天',
        desc: '累计有 ' + v + ' 天留下日记',
        value: (c) => c.diary.days
      });
    });
    // 连续记录：一周 / 一个月 / 100 天 / 一年
    [{ v: 3, t: '连续三天' }, { v: 7, t: '连续一周' }, { v: 14, t: '连续两周' },
     { v: 30, t: '连续一个月' }, { v: 100, t: '连续百日' }, { v: 365, t: '连续一年' }].forEach((x) => {
      add({
        id: 'diary_streak_' + x.v, group: 'diary', icon: 'fire', unit: '天', target: x.v,
        title: x.t,
        desc: '连续 ' + x.v + ' 天记录日记',
        value: (c) => c.diary.streak
      });
    });
    [1, 10, 50, 100, 365].forEach((v) => {
      add({
        id: 'diary_count_' + v, group: 'diary', icon: 'quote', unit: '篇', target: v,
        title: v + ' 篇记录',
        desc: '累计写下 ' + v + ' 篇日记',
        value: (c) => c.diary.count
      });
    });
    // 周记 / 月记 / 自定义间隔
    [4, 12, 52].forEach((v) => {
      add({
        id: 'diary_weekly_' + v, group: 'diary', icon: 'calendar', unit: '篇', target: v,
        title: '周记 ' + v + ' 篇',
        desc: '每周记录累计 ' + v + ' 篇',
        value: (c) => c.diary.weekly
      });
    });
    [1, 6, 12, 24, 60].forEach((v) => {
      add({
        id: 'diary_monthly_' + v, group: 'diary', icon: 'calendar', unit: '篇', target: v,
        title: '月记 ' + v + ' 篇',
        desc: '每月记录累计 ' + v + ' 篇',
        value: (c) => c.diary.monthly
      });
    });
    [4, 12, 36].forEach((v) => {
      add({
        id: 'diary_custom_' + v, group: 'diary', icon: 'clock', unit: '篇', target: v,
        title: '自定义间隔 ' + v + ' 篇',
        desc: '按自定义时间间隔记录 ' + v + ' 篇',
        value: (c) => c.diary.custom
      });
    });
    [10, 50, 200].forEach((v) => {
      add({
        id: 'diary_images_' + v, group: 'diary', icon: 'image', unit: '张', target: v,
        title: '日记插图 ' + v + ' 张',
        desc: '在日记中插入 ' + v + ' 张图片',
        value: (c) => c.diary.images
      });
    });

    /* ===== 大纲 ===== */
    [10, 30, 100, 300, 1000].forEach((v) => {
      add({
        id: 'outline_nodes_' + v, group: 'outline', icon: 'tree', unit: '个', target: v,
        title: v + ' 个大纲节点',
        desc: '累计建立 ' + v + ' 个大纲节点',
        value: (c) => c.outline.nodes
      });
    });
    [1, 5, 20, 50].forEach((v) => {
      add({
        id: 'outline_marks_' + v, group: 'outline', icon: 'star', unit: '个', target: v,
        title: '重点标记 ' + v + ' 个',
        desc: '标记 ' + v + ' 个重点大纲节点',
        value: (c) => c.outline.marks
      });
    });
    [1, 3, 5].forEach((v) => {
      add({
        id: 'outline_linked_' + v, group: 'outline', icon: 'link', unit: '个', target: v,
        title: '大纲联动 ' + v + ' 处',
        desc: '把 ' + v + ' 个大纲节点关联到章节',
        value: (c) => c.outline.linked
      });
    });
    [2, 3, 5, 8].forEach((v) => {
      add({
        id: 'outline_branches_' + v, group: 'outline', icon: 'palette', unit: '条', target: v,
        title: '分支配色 ' + v + ' 种',
        desc: '用 ' + v + ' 种不同颜色区分分支',
        value: (c) => c.outline.branches
      });
    });

    /* ===== 阅读 ===== */
    [1, 3, 5, 10, 30].forEach((v) => {
      add({
        id: 'read_books_' + v, group: 'reading', icon: 'reader', unit: '本', target: v,
        title: '读完 ' + v + ' 本',
        desc: '阅读器里读完 ' + v + ' 本读物',
        value: (c) => c.reading.finished
      });
    });
    [10000, 100000, 500000, 1000000].forEach((v) => {
      add({
        id: 'read_words_' + v, group: 'reading', icon: 'reader', unit: '字', target: v,
        title: '阅读 ' + U.numName(v) + '字',
        desc: '累计阅读 ' + U.numName(v) + '字',
        value: (c) => c.reading.words,
        fmt: w
      });
    });
    [60, 300, 1200, 3600].forEach((v) => {
      add({
        id: 'read_minutes_' + v, group: 'reading', icon: 'clock', unit: '分钟', target: v,
        title: '阅读 ' + U.fmtDuration(v, { short: true }),
        desc: '累计阅读时长达到 ' + U.fmtDuration(v),
        value: (c) => c.reading.minutes
      });
    });

    /* ===== 综合：活跃天数 / 周 / 月 / 年 ===== */
    [1, 3, 7, 14, 30, 100, 365].forEach((v) => {
      add({
        id: 'active_days_' + v, group: 'active', icon: 'sun', unit: '天', target: v,
        title: '活跃 ' + v + ' 天',
        desc: '累计 ' + v + ' 天有创作记录',
        value: (c) => c.active.days
      });
    });
    [1, 4, 12, 26, 52].forEach((v) => {
      add({
        id: 'active_weeks_' + v, group: 'active', icon: 'calendar', unit: '周', target: v,
        title: '活跃 ' + v + ' 周',
        desc: '累计 ' + v + ' 个自然周有创作',
        value: (c) => c.active.weeks
      });
    });
    [1, 3, 6, 12, 24].forEach((v) => {
      add({
        id: 'active_months_' + v, group: 'active', icon: 'calendar', unit: '月', target: v,
        title: '月度创作 ' + v + ' 次',
        desc: '累计 ' + v + ' 个自然月有创作（月度成就）',
        value: (c) => c.active.months
      });
    });
    [1, 2, 3, 5].forEach((v) => {
      add({
        id: 'active_years_' + v, group: 'active', icon: 'trophy', unit: '年', target: v,
        title: '年度创作 ' + v + ' 次',
        desc: '累计 ' + v + ' 个自然年有创作（年度成就）',
        value: (c) => c.active.years
      });
    });
    [1000, 10000, 50000, 100000, 500000, 1000000].forEach((v) => {
      add({
        id: 'total_words_' + v, group: 'active', icon: 'feather', unit: '字', target: v,
        title: '全部作品 ' + U.numName(v) + '字',
        desc: '所有模块累计创作 ' + U.numName(v) + '字',
        value: (c) => c.active.words,
        fmt: w
      });
    });
    [60, 300, 1200, 3000, 10000].forEach((v) => {
      add({
        id: 'total_minutes_' + v, group: 'active', icon: 'clock', unit: '分钟', target: v,
        title: '创作 ' + U.fmtDuration(v, { short: true }),
        desc: '累计创作时长 ' + U.fmtDuration(v),
        value: (c) => c.active.minutes
      });
    });
    [1, 10, 30, 100].forEach((v) => {
      add({
        id: 'daily_goal_' + v, group: 'active', icon: 'target', unit: '天', target: v,
        title: '每日目标达成 ' + v + ' 天',
        desc: '完成每日字数目标 ' + v + ' 次',
        value: (c) => c.active.goalDays
      });
    });

    return rules;
  }

  let RULES = null;

  /* ---------------- 上下文汇总 ---------------- */
  Ach.context = function (state) {
    const ctx = {
      novel: { words: 0, chapters: 0, finished: 0, goalsHit: 0, maxBookWords: 0 },
      article: { words: 0, count: 0, maxWords: 0 },
      diary: { words: 0, days: 0, streak: 0, count: 0, weekly: 0, monthly: 0, custom: 0, images: 0 },
      outline: { nodes: 0, marks: 0, linked: 0, branches: 0 },
      reading: { finished: 0, words: 0, minutes: 0 },
      active: { days: 0, weeks: 0, months: 0, years: 0, words: 0, minutes: 0, goalDays: 0 }
    };

    /* --- 小说 --- */
    (state.novels || []).forEach((n) => {
      if (!counts(n)) return;                       // 导入的小说不计入成就
      const nw = Store.novelWords(n);
      ctx.novel.words += nw;
      ctx.novel.maxBookWords = Math.max(ctx.novel.maxBookWords, nw);
      ctx.novel.chapters += (n.chapters || []).length;
      if (n.finished || n.status === 'finished') ctx.novel.finished++;
      (n.chapters || []).forEach((c) => {
        if (c.goal && (c.words || U.words(c.content || '')) >= c.goal) ctx.novel.goalsHit++;
      });
      ctx.outline.nodes += countNodes(n.outline);
      ctx.outline.marks += countMarks(n.outline);
      ctx.outline.linked += countLinked(n.outline);
      const colors = new Set();
      collectColors(n.outline, colors);
      ctx.outline.branches = Math.max(ctx.outline.branches, colors.size);
    });
    (state.articles || []).forEach((a) => {
      if (!counts(a)) return;                       // 导入的文章不计入成就
      const aw = Store.articleWords(a);
      ctx.article.words += aw;
      ctx.article.count++;
      ctx.article.maxWords = Math.max(ctx.article.maxWords, aw);
      ctx.outline.nodes += countNodes(a.outline);
      ctx.outline.marks += countMarks(a.outline);
    });

    /* --- 日记 --- */
    const allDates = new Set();
    (state.diaries || []).forEach((bk) => {
      (bk.entries || []).forEach((en) => {
        if (!counts(bk)) return;                    // 导入的日记本不计入成就
        ctx.diary.count++;
        ctx.diary.words += (en.words || U.words(en.content || ''));
        ctx.diary.images += (en.images || []).length;
        allDates.add(en.dateKey);
        if (bk.kind === 'weekly') ctx.diary.weekly++;
        else if (bk.kind === 'monthly') ctx.diary.monthly++;
        else if (bk.kind === 'custom') ctx.diary.custom++;
      });
    });
    ctx.diary.days = allDates.size;
    ctx.diary.streak = longestStreak(Array.from(allDates));

    /* --- 阅读 ---
        导入的读物默认不计入（可在读物菜单里改为「计入成就」）。 */
    (state.reading || []).forEach((b) => {
      if (b.countAchievements !== true) return;
      ctx.reading.words += Math.round(Store.bookWords(b) * (b.progress && b.progress.percent ? b.progress.percent : 0));
      ctx.reading.minutes += Math.round((b.readingMs || 0) / 60000);
      if (b.progress && b.progress.percent >= 0.985) ctx.reading.finished++;
    });

    /* --- 综合 --- */
    const st = state.stats || {};
    const daily = st.daily || {};
    const dayKeys = Object.keys(daily).filter((k) => (daily[k].words || 0) > 0 || (daily[k].ms || 0) > 20000);
    ctx.active.days = dayKeys.length;
    const weeks = new Set(), months = new Set(), years = new Set();
    dayKeys.forEach((k) => {
      weeks.add(U.weekKey(U.parseKey(k)));
      months.add(U.monthKey(U.parseKey(k)));
      years.add(U.yearKey(U.parseKey(k)));
    });
    ctx.active.weeks = weeks.size;
    ctx.active.months = months.size;
    ctx.active.years = years.size;
    ctx.active.words = Store.totalWords();
    ctx.active.minutes = Math.round(((st.totals && st.totals.ms) || 0) / 60000);
    const goal = (state.settings && state.settings.dailyGoalWords) || 0;
    ctx.active.goalDays = goal > 0 ? dayKeys.filter((k) => (daily[k].words || 0) >= goal).length : 0;

    return ctx;
  };

  function countNodes(nodes) {
    if (!Array.isArray(nodes)) return 0;
    return nodes.reduce((s, n) => s + 1 + countNodes(n.children), 0);
  }
  function countMarks(nodes) {
    if (!Array.isArray(nodes)) return 0;
    return nodes.reduce((s, n) => s + (n.important ? 1 : 0) + countMarks(n.children), 0);
  }
  function countLinked(nodes) {
    if (!Array.isArray(nodes)) return 0;
    return nodes.reduce((s, n) => s + ((n.linkChapterId || n.linkSectionId) ? 1 : 0) + countLinked(n.children), 0);
  }
  function collectColors(nodes, set) {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((n) => { if (n.color) set.add(n.color); collectColors(n.children, set); });
  }

  /** 最长连续记录天数 */
  function longestStreak(dateKeys) {
    if (!dateKeys.length) return 0;
    const days = dateKeys.map((k) => U.parseKey(k).getTime()).sort((a, b) => a - b);
    let best = 1, cur = 1;
    for (let i = 1; i < days.length; i++) {
      const diff = Math.round((days[i] - days[i - 1]) / 86400000);
      if (diff === 1) cur++;
      else if (diff > 1) cur = 1;
      if (cur > best) best = cur;
    }
    return best;
  }
  /** 当前正在延续的连续天数（截至今天或昨天） */
  Ach.currentStreak = function (state) {
    const set = new Set();
    (state.diaries || []).forEach((bk) => (bk.entries || []).forEach((e) => set.add(e.dateKey)));
    const today = U.dateKey();
    let cursor = set.has(today) ? today : U.shiftDate(today, -1);
    if (!set.has(cursor)) return 0;
    let n = 0;
    while (set.has(cursor)) { n++; cursor = U.shiftDate(cursor, -1); }
    return n;
  };

  /* ---------------- 评估与解锁 ---------------- */
  let evalTimer = null;
  let evaluating = false;

  Ach.all = function () {
    if (!RULES) RULES = buildRules();
    return RULES;
  };
  Ach.get = function (id) { return Ach.all().find((r) => r.id === id) || null; };
  Ach.groups = [
    { id: 'novel', name: '小说', icon: 'feather' },
    { id: 'article', name: '文章', icon: 'doc' },
    { id: 'diary', name: '日记', icon: 'calendar' },
    { id: 'outline', name: '大纲', icon: 'tree' },
    { id: 'reading', name: '阅读', icon: 'reader' },
    { id: 'active', name: '综合', icon: 'trophy' }
  ];

  Ach.isUnlocked = (state, id) => !!state.achievements[id];
  Ach.unlockedCount = (state) => Object.keys(state.achievements || {}).length;
  Ach.totalCount = () => Ach.all().length;

  /** 规则进度：{ value, target, percent, unlocked } */
  Ach.progressOf = function (state, rule, ctx) {
    const c = ctx || Ach.context(state);
    let v = 0;
    try { v = Number(rule.value(c)) || 0; } catch (e) { v = 0; }
    const unlocked = Ach.isUnlocked(state, rule.id);
    const target = rule.target || 1;
    return {
      value: v,
      target: target,
      percent: U.clamp(unlocked ? 1 : v / target, 0, 1),
      unlocked: unlocked,
      at: unlocked ? state.achievements[rule.id].at : 0
    };
  };

  /** 节流评估：写入后调用，600ms 内合并 */
  Ach.evaluate = function (state, immediate) {
    if (evaluating && !immediate) return;
    clearTimeout(evalTimer);
    if (immediate) return runEval(state);
    evalTimer = setTimeout(() => runEval(state), 650);
  };

  function runEval(state) {
    if (evaluating) return;
    evaluating = true;
    try {
      const ctx = Ach.context(state);
      const rules = Ach.all();
      const newly = [];
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        if (state.achievements[r.id]) continue;
        let v = 0;
        try { v = Number(r.value(ctx)) || 0; } catch (e) { v = 0; }
        if (v >= r.target) {
          state.achievements[r.id] = { at: Date.now() };
          state.newAchievements.push(r.id);
          newly.push(r);
        }
      }
      if (newly.length) {
        Store.markDirty();
        if (global.UI && state.settings.showAchievementToast !== false) {
          newly.slice(0, 4).forEach((r, i) => setTimeout(() => global.UI.achievementToast(r), i * 900));
        }
      }
    } catch (e) {
      console.error('[Ach]', e);
    } finally {
      evaluating = false;
    }
  }

  /** 全部成就（含锁定）按分组整理 */
  Ach.byGroup = function (state) {
    const ctx = Ach.context(state);
    const out = {};
    Ach.groups.forEach((g) => { out[g.id] = []; });
    Ach.all().forEach((r) => {
      const p = Ach.progressOf(state, r, ctx);
      (out[r.group] = out[r.group] || []).push({ rule: r, prog: p });
    });
    Object.keys(out).forEach((k) => {
      out[k].sort((a, b) => {
        if (a.prog.unlocked !== b.prog.unlocked) return a.prog.unlocked ? -1 : 1;
        return a.rule.target - b.rule.target;
      });
    });
    return { groups: out, ctx: ctx };
  };

  global.Ach = Ach;
})(window);
