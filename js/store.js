/* ==========================================================================
   selfwriting · store.js
   状态中心：数据模型 + 变更 + 本地持久化 + 渲染通知
   所有模块（小说/文章/日记/大纲/阅读/成就/统计）共享同一个 state。
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const DB = global.DB;

  /* 大纲分支调色板：颜色用于区分分支，并可标重点 */
  const PALETTE = [
    { id: 'ink', name: '墨黑', value: '#4a4f57' },
    { id: 'zhu', name: '朱砂', value: '#b4503c' },
    { id: 'jin', name: '赭金', value: '#b8860b' },
    { id: 'song', name: '松绿', value: '#2f7d5f' },
    { id: 'cang', name: '沧蓝', value: '#34618f' },
    { id: 'zi', name: '紫棠', value: '#7a4a86' },
    { id: 'fen', name: '绛粉', value: '#b3457a' },
    { id: 'hui', name: '烟灰', value: '#7b8087' }
  ];

  const DEFAULT_SETTINGS = {
    theme: 'light',            // light | dark
    themeMode: 'manual',       // manual | auto（跟随系统）
    warm: false,               // 护眼暖色
    brightness: 100,           // 20 - 100
    accent: '#b4503c',
    readerFontSize: 18,
    readerLineHeight: 1.9,
    readerFont: 'serif',       // serif | sans
    editorFontSize: 18,
    editorLineHeight: 1.9,
    editorFont: 'serif',
    editorWidth: 'normal',     // normal | wide
    autoIndent: true,          // 段首自动缩进（两格）
    fontSizeUI: 16,
    dailyGoalWords: 1000,      // 每日字数目标
    defaultChapterGoal: 3000,  // 新建章节默认字数目标
    statsDetail: true,
    sessionIdleSeconds: 45,    // 停顿多久算一次「写作段」结束
    showAchievementToast: true,
    /* 时区：默认北京时间（UTC+8），日历的「今天」、时钟、日记日期上限都按它算 */
    timeZone: 480,
    /* 阅读器：书本视图（单列 / 双列）、封面宽度、翻页方式、点击正文收起工具栏 */
    readerCols: 1,             // 1 | 2 列
    readerCoverWidth: 108,     // 书架封面宽度（像素）
    readerPageMode: 'scroll',  // scroll | page | slide
    readerTapMenu: true,       // 点正文收起 / 显示工具栏
    lastTab: 'novel'
  };

  const DEFAULT_STATE = {
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    profile: { name: '我' },
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    novels: [],
    articles: [],
    diaries: [],
    reading: [],
    achievements: {},     // id -> { at: ts }
    newAchievements: [],  // 待展示的解锁提示
    stats: null,          // 由 stats.js 初始化
    trash: []
  };

  /* ------------------------------------------------------------------
     个人档案（本机账号）
     这个应用完全离线，所以「注册」= 在这台设备上建一份自己的档案：
       name   昵称（协作、日记署名都用它）
       emoji  头像（预设表情头像，不占空间）
       avatar 头像图片（相册选图后压缩成 dataURL，存 IndexedDB 的 images 表太
              重了，直接放 state 里的小图更省事；只有用户选了图才会有）
       code   专属码（本机生成，用来让朋友把你加进密友名单）
       status 状态：仿微信 / QQ，一行字 + 表情 + 更新时间 + 可选时效
     ------------------------------------------------------------------ */
  const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // 去掉容易看错的 0/O/1/I
  function makeUserCode() {
    let s = '';
    for (let i = 0; i < 6; i++) s += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
    return 'SW-' + s;
  }

  function profileOf() {
    if (!state.profile || typeof state.profile !== 'object') state.profile = {};
    const p = state.profile;
    if (typeof p.name !== 'string' || !p.name) p.name = '我';
    if (typeof p.emoji !== 'string') p.emoji = '';
    if (typeof p.avatar !== 'string') p.avatar = '';
    if (typeof p.code !== 'string') p.code = '';
    if (typeof p.bio !== 'string') p.bio = '';
    if (typeof p.registered !== 'boolean') p.registered = false;
    if (!p.status || typeof p.status !== 'object') p.status = { text: '', emoji: '', at: 0, until: 0 };
    if (typeof p.status.text !== 'string') p.status.text = '';
    if (typeof p.status.emoji !== 'string') p.status.emoji = '';
    if (typeof p.status.at !== 'number') p.status.at = 0;
    if (typeof p.status.until !== 'number') p.status.until = 0;
    if (typeof p.createdAt !== 'number') p.createdAt = 0;
    if (typeof p.updatedAt !== 'number') p.updatedAt = 0;
    return p;
  }

  const listeners = [];
  const viewListeners = [];
  let state = null;
  let saveTimer = null;
  let saveIdbTimer = null;
  let dirty = false;
  let lastSavedAt = 0;

  /* 落盘节流间隔（毫秒）：本地副本较快，IndexedDB 较慢 */
  const SAVE_LOCAL_MS = 1500;
  const SAVE_IDB_MS = 20000;

  /* ------------------------------------------------------------------ */
  /* 初始化 / 持久化                                                     */
  /* ------------------------------------------------------------------ */
  function migrate(s) {
    if (!s || typeof s !== 'object') return null;
    const out = Object.assign({}, DEFAULT_STATE, s);
    out.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
    ['novels', 'articles', 'diaries', 'reading', 'trash'].forEach((k) => {
      if (!Array.isArray(out[k])) out[k] = [];
    });
    if (!out.achievements || typeof out.achievements !== 'object') out.achievements = {};
    if (!Array.isArray(out.newAchievements)) out.newAchievements = [];
    out.version = 1;

    // 逐模块字段补齐
    out.novels.forEach((n) => {
      if (!Array.isArray(n.chapters)) n.chapters = [];
      if (!Array.isArray(n.outline)) n.outline = [];
      if (!n.tags) n.tags = [];
      if (typeof n.countAchievements !== 'boolean') n.countAchievements = true;
      n.chapters.forEach((c) => {
        if (!Array.isArray(c.sections)) c.sections = [];
        if (typeof c.content !== 'string') c.content = '';
        if (!c.goal && c.goal !== 0) c.goal = null;
      });
    });
    out.articles.forEach((a) => {
      if (typeof a.content !== 'string') a.content = '';
      if (!Array.isArray(a.outline)) a.outline = [];
      if (!a.tags) a.tags = [];
      if (!a.category) a.category = '随笔';            // 文章类型，旧数据补默认值
      if (typeof a.countAchievements !== 'boolean') a.countAchievements = true;
    });
    out.diaries.forEach((bk) => {
      if (!Array.isArray(bk.entries)) bk.entries = [];
      if (!bk.category) bk.category = '生活';
      if (typeof bk.countAchievements !== 'boolean') bk.countAchievements = true;
      bk.entries.forEach((en) => {
        if (!Array.isArray(en.images)) en.images = [];
        if (typeof en.content !== 'string') en.content = '';
        if (!en.tags) en.tags = [];
      });
    });
    out.reading.forEach((b) => {
      if (!Array.isArray(b.chapters)) b.chapters = [];
      if (!Array.isArray(b.bookmarks)) b.bookmarks = [];
      if (!b.category) b.category = '其它';
      if (typeof b.countAchievements !== 'boolean') b.countAchievements = false;   // 默认不计入成就
      b.chapters.forEach((c) => { if (typeof c.content !== 'string') c.content = ''; });
    });
    out.stats = global.Stats ? global.Stats.migrate(out.stats) : out.stats;
    return out;
  }

  function init() {
    return DB.probe()
      .then(() => DB.loadState())
      .then((fromIdb) => {
        const fromLs = DB.readLocalBackup();
        let chosen = null;
        if (fromIdb && fromLs) chosen = (fromLs.updatedAt || 0) > (fromIdb.updatedAt || 0) ? fromLs : fromIdb;
        else chosen = fromIdb || fromLs;
        state = migrate(chosen) || JSON.parse(JSON.stringify(DEFAULT_STATE));
        if (!state.stats && global.Stats) state.stats = global.Stats.create();
        profileOf();
        applyTheme();
        return state;
      });
  }

  function markDirty() {
    dirty = true;
    state.rev = (state.rev || 0) + 1;        // 供 DB 层缓存序列化结果
    state.updatedAt = Date.now();
    scheduleSave();
  }

  /**
   * 落盘调度。
   * 大作品下 JSON.stringify 本身就要几十毫秒，所以：
   *   - 写作期间节流：本地影子副本 1.5 秒一次，IndexedDB 20 秒一次
   *   - 用 requestIdleCallback 在浏览器空闲时做，避免卡住输入
   *   - 真正的安全网是 visibilitychange / pagehide 时的 flushNow
   */
  const idle = (fn) => {
    if (global.requestIdleCallback) global.requestIdleCallback(fn, { timeout: 2000 });
    else setTimeout(fn, 0);
  };

  function scheduleSave() {
    if (suspended) return;                    // 导入等批量操作期间不落盘
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { idle(() => { flushLocal(); }); }, SAVE_LOCAL_MS);
    clearTimeout(saveIdbTimer);
    saveIdbTimer = setTimeout(() => { idle(() => { flushIdb(); }); }, SAVE_IDB_MS);
  }

  /** 只写 localStorage（便宜），用于高频自动保存 */
  function flushLocal() {
    if (!state) return Promise.resolve(null);
    lastSavedAt = Date.now();
    return Promise.resolve(DB.saveLocal(state));
  }

  function flushIdb() {
    if (!state || !dirty) return Promise.resolve();
    dirty = false;
    DB.backup(state);
    return DB.saveState(state).catch(() => null);
  }

  /** 立即落盘（切后台、页面隐藏、导入导出前后、需要立刻 reload 时调用） */
  function flushNow() {
    clearTimeout(saveTimer);
    clearTimeout(saveIdbTimer);
    if (api.flushRecounts) api.flushRecounts();   // 落盘前把近似字数算准
    dirty = false;
    state.updatedAt = Date.now();
    lastSavedAt = Date.now();
    /*
     * 两份都要写：只写 IndexedDB 的话，localStorage 那份镜像会停留在旧状态，
     * 而启动时那份镜像会先被读到 —— 于是「刚改完就 reload」会看到旧值
     * （语言切换就是这么坏的）。localStorage 很便宜，一起写。
     */
    try { DB.saveLocal(state); } catch (e) { /* 配额满等情况忽略，IDB 仍会写 */ }
    return DB.saveState(state).catch(() => null);
  }

  /* ------------------------------------------------------------------ */
  /* 批量操作（导入 / 恢复备份）：期间的落盘与重绘先挂起，结束后一次性提交   */
  /* ------------------------------------------------------------------ */
  let suspended = false;
  function beginBatch() {
    suspended = true;
    clearTimeout(saveTimer);
    clearTimeout(saveIdbTimer);
  }
  function endBatch() {
    suspended = false;
    dirty = true;
    return flushNow().then(() => reconcileWords()).catch(() => 0);
  }

  /* ------------------------------------------------------------------ */
  /* 订阅                                                                */
  /* ------------------------------------------------------------------ */
  /** 数据变更通知：fn(state, meta) */
  function subscribe(fn) {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  /** 视图级重绘钩子（用于在不打断输入的前提下更新局部信息） */
  function onActiveView(fn, view) {
    viewListeners.push({ fn, view });
    return () => { const i = viewListeners.findIndex((v) => v.fn === fn); if (i >= 0) viewListeners.splice(i, 1); };
  }

  function emit(meta) {
    const m = meta || {};
    listeners.forEach((fn) => { try { fn(state, m); } catch (e) { console.error('[store listener]', e); } });
  }

  function activeViewRefresh(meta) {
    viewListeners.forEach((v) => {
      if (v.view && meta && meta.view && v.view !== meta.view) return;
      try { v.fn(state, meta); } catch (e) { console.error('[view listener]', e); }
    });
  }

  /** 统一的变更出口：commit(() => {...}, { kind, itemId, view }) */
  function commit(mutator, meta) {
    const m = meta || {};
    if (typeof mutator === 'function') mutator(state);
    if (m.touch !== false) markDirty();
    if (m.silent !== true) {
      emit(m);
      activeViewRefresh(m);
      if (global.Ach) global.Ach.evaluate(state);   // 成就检查（内部有节流）
    }
    return state;
  }

  /* ------------------------------------------------------------------ */
  /* 主题 / 亮度                                                         */
  /* ------------------------------------------------------------------ */
  function resolvedTheme() {
    const s = state.settings;
    if (s.themeMode === 'auto') {
      try {
        return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch (e) { return 'light'; }
    }
    return s.theme === 'dark' ? 'dark' : 'light';
  }

  function applyTheme() {
    const s = state.settings;
    const theme = resolvedTheme();
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-warm', s.warm ? '1' : '0');
    root.style.setProperty('--accent', s.accent || DEFAULT_SETTINGS.accent);
    root.style.setProperty('--fs-read', (s.readerFontSize || 18) + 'px');
    root.style.setProperty('--lh-read', String(s.readerLineHeight || 1.9));
    root.style.setProperty('--fs', (s.fontSizeUI || 16) + 'px');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#141517' : (s.warm ? '#f2ebdd' : '#f6f6f4'));
    applyBrightness();
  }

  /** 亮度：与阅读软件一致的调暗方式（100% 无遮罩，越低越暗） */
  function applyBrightness() {
    const b = U.clamp(Number(state.settings.brightness) || 100, 20, 100);
    const overlay = document.getElementById('brightnessOverlay');
    if (overlay) {
      const opacity = b >= 100 ? 0 : Math.min(0.82, (100 - b) / 100 * 0.92);
      overlay.style.opacity = String(opacity);
    }
    document.documentElement.style.setProperty('--brightness', String(b / 100));
  }

  /* ------------------------------------------------------------------ */
  /* 查询                                                                */
  /* ------------------------------------------------------------------ */
  function findNovel(id) { return state.novels.find((n) => n.id === id) || null; }
  function findArticle(id) { return state.articles.find((a) => a.id === id) || null; }
  function findDiary(id) { return state.diaries.find((d) => d.id === id) || null; }
  function findBook(id) { return state.reading.find((b) => b.id === id) || null; }

  /**
   * 日记日期兜底：不能记到未来的日子（用户明确要求）。
   * 界面已经拦住日历与日期选择器，这里再兜一层 —— 导入备份、协作同步、
   * 旧链接进来时同样不会留下「明天的日记」。
   */
  function clampDiaryDate(key) {
    const today = U.today ? U.today() : U.dateKey();
    const k = String(key == null ? '' : key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return today;
    return k > today ? today : k;
  }
  function findChapter(novelId, chapterId) {
    const n = findNovel(novelId);
    if (!n) return null;
    return n.chapters.find((c) => c.id === chapterId) || null;
  }
  function findSection(novelId, chapterId, sectionId) {
    const c = findChapter(novelId, chapterId);
    if (!c) return null;
    return (c.sections || []).find((s) => s.id === sectionId) || null;
  }

  /* ---------------- 大纲树工具 ---------------- */
  function walkTree(nodes, fn, parent) {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((n) => {
      if (!n || typeof n !== 'object') return;
      fn(n, parent);
      if (Array.isArray(n.children) && n.children.length) walkTree(n.children, fn, n);
    });
  }
  function countNodes(nodes) { let n = 0; walkTree(nodes, () => { n++; }); return n; }
  function countMarks(nodes) { let n = 0; walkTree(nodes, (x) => { if (x.important) n++; }); return n; }
  function countLinkedNodes(nodes) { let n = 0; walkTree(nodes, (x) => { if (x.linkChapterId || x.linkSectionId) n++; }); return n; }
  function countColors(nodes) { const set = new Set(); walkTree(nodes, (x) => { if (x.color) set.add(x.color); }); return set.size; }

  function findNode(nodes, id) {
    let hit = null;
    walkTree(nodes, (n) => { if (!hit && n.id === id) hit = n; });
    return hit;
  }
  function removeNode(nodes, id) {
    for (let i = 0; i < (nodes || []).length; i++) {
      if (nodes[i].id === id) { nodes.splice(i, 1); return true; }
      if (nodes[i].children && removeNode(nodes[i].children, id)) return true;
    }
    return false;
  }
  function insertNode(nodes, parentId, node, index) {
    if (!parentId) {
      if (index === undefined || index === null || index < 0 || index >= nodes.length) nodes.push(node);
      else nodes.splice(index, 0, node);
      return true;
    }
    const p = findNode(nodes, parentId);
    if (!p) return false;
    if (!Array.isArray(p.children)) p.children = [];
    if (index === undefined || index === null || index < 0 || index >= p.children.length) p.children.push(node);
    else p.children.splice(index, 0, node);
    return true;
  }
  /** 找到节点所在数组与索引（重排用） */
  function locateNode(nodes, id, parent) {
    for (let i = 0; i < (nodes || []).length; i++) {
      if (nodes[i].id === id) return { list: nodes, index: i, parent: parent || null };
      const r = locateNode(nodes[i].children || [], id, nodes[i]);
      if (r) return r;
    }
    return null;
  }
  /** 大纲节点是否仍与章节/小节互链 */
  function nodeLinked(novel, node) {
    if (!novel) return false;
    if (node.linkChapterId) {
      const c = (novel.chapters || []).find((x) => x.id === node.linkChapterId);
      if (!c) return false;
      if (node.linkSectionId) return (c.sections || []).some((s) => s.id === node.linkSectionId);
      return true;
    }
    return false;
  }

  /* ---------------- 字数重算 ---------------- */
  /* 字数校正：需要 api 上的容器，而 recompute* 可能在 api 赋值前被调用（迁移期），
     所以这里用 hoisted 函数并在调用时才取 api。 */
  function queueRecount(obj, itemId, content) {
    if (!obj) return;
    const pending = api._pendingWords || (api._pendingWords = new Map());
    pending.set(itemId, { obj: obj, content: content });
    if (api._recountTimer) return;
    const run = () => { api._recountTimer = null; if (api.flushRecounts) api.flushRecounts(); };
    api._recountTimer = setTimeout(run, 2500);            // 停笔 2.5 秒后才校正
    if (global.requestIdleCallback) global.requestIdleCallback(run, { timeout: 4000 });
  }

  function recomputeNovel(novel) {
    let w = 0, secW = 0;
    novel.chapters.forEach((c) => {
      const cw = U.estimateWords(c.content || '');   // 近似即可，精确值由空闲校正
      c.words = cw;
      w += cw;
      secW += (c.sections || []).reduce((s, x) => s + U.estimateWords(x.content || ''), 0);
      queueRecount(c, novel.id + ':' + c.id, c.content || '');
    });
    novel.words = w + secW;
    novel.chapterCount = novel.chapters.length;
    novel.updatedAt = Date.now();
    return novel.words;
  }
  function recomputeArticle(article) {
    article.words = U.estimateWords(article.content || '');
    article.updatedAt = Date.now();
    queueRecount(article, 'ar:' + article.id, article.content || '');
    return article.words;
  }
  function recomputeBook(book) {
    let w = 0;
    (book.chapters || []).forEach((c) => { c.words = U.estimateWords(c.content || ''); w += c.words; });
    book.words = w;
    book.chapterCount = (book.chapters || []).length;
    return w;
  }

  /**
   * 后台把「近似字数」逐步校正为精确值（导入大文件后调用）。
   * 分批 + 让出主线程，避免一次性扫描几 MB 文本卡住界面。
   */
  function reconcileWords() {
    if (!state || state.wordsApprox !== true) return Promise.resolve(0);
    const jobs = [];
    state.novels.forEach((n) => (n.chapters || []).forEach((c) => jobs.push({ obj: c, text: c.content || '' })));
    state.novels.forEach((n) => (n.chapters || []).forEach((c) => (c.sections || []).forEach((sec) => jobs.push({ obj: sec, text: sec.content || '' }))));
    state.articles.forEach((a) => jobs.push({ obj: a, text: a.content || '' }));
    state.diaries.forEach((b) => (b.entries || []).forEach((e) => jobs.push({ obj: e, text: e.content || '' })));
    state.reading.forEach((b) => (b.chapters || []).forEach((c) => jobs.push({ obj: c, text: c.content || '' })));

    let i = 0;
    return new Promise((resolve) => {
      const step = () => {
        const t0 = Date.now();
        // 每批最多 25ms，保证界面不被长时间占用
        while (i < jobs.length && Date.now() - t0 < 25) {
          const j = jobs[i++];
          j.obj.words = U.words(j.text);
        }
        if (i < jobs.length) {
          setTimeout(step, 0);
        } else {
          state.novels.forEach(recomputeNovelTotals);
          state.wordsApprox = false;
          markDirty();
          resolve(jobs.length);
        }
      };
      setTimeout(step, 0);
    });
  }

  /** 只累加总量，不再重算每个章节（校正后调用） */
  function recomputeNovelTotals(novel) {
    let w = 0;
    (novel.chapters || []).forEach((c) => {
      w += (c.words || 0);
      (c.sections || []).forEach((s) => { w += (s.words || 0); });
    });
    novel.words = w;
    return w;
  }

  function articleWords(article) {
    if (typeof article.words === 'number') return article.words;
    return U.words(article.content || '');
  }
  function bookWords(book) {
    if (typeof book.words === 'number') return book.words;
    return (book.chapters || []).reduce((s, c) => s + U.words(c.content || ''), 0);
  }
  function novelWords(novel) {
    if (typeof novel.words === 'number') return novel.words;
    return (novel.chapters || []).reduce((s, c) => s + U.words(c.content || '') + (c.sections || []).reduce((t, x) => t + U.words(x.content || ''), 0), 0);
  }
  function diaryWords(book) {
    return (book.entries || []).reduce((s, e) => s + (e.words || U.words(e.content || '')), 0);
  }

  /** 全库字数（不含阅读） */
  function totalWords() {
    let w = 0;
    state.novels.forEach((n) => { w += novelWords(n); });
    state.articles.forEach((a) => { w += articleWords(a); });
    state.diaries.forEach((bk) => { w += diaryWords(bk); });
    return w;
  }

  /** 某个记录本有记录的日期 */
  function diaryDates(book) {
    const set = new Set();
    (book.entries || []).forEach((e) => set.add(e.dateKey));
    return Array.from(set).sort();
  }

  /** 全局所有创作日期（用于连续记录统计） */
  function allContentDates() {
    const set = new Set();
    state.novels.forEach((n) => (n.chapters || []).forEach((c) => {
      const has = (c.content || '').trim() || (c.sections || []).some((s) => (s.content || '').trim());
      if (has) set.add(U.dateKey(c.updatedAt || n.updatedAt));
    }));
    state.articles.forEach((a) => { if ((a.content || '').trim()) set.add(U.dateKey(a.updatedAt)); });
    state.diaries.forEach((bk) => (bk.entries || []).forEach((e) => { if ((e.content || '').trim() || (e.images || []).length) set.add(e.dateKey); }));
    return Array.from(set).sort();
  }

  /** 各模块条目扁平列表：用于搜索与统计 */
  function allItems() {
    const out = [];
    state.novels.forEach((n) => out.push({ kind: 'novel', id: n.id, title: n.title, sub: (n.chapters || []).length + ' 章', words: novelWords(n), updatedAt: n.updatedAt, ref: n }));
    state.articles.forEach((a) => out.push({ kind: 'article', id: a.id, title: a.title, sub: '文章', words: articleWords(a), updatedAt: a.updatedAt, ref: a }));
    state.diaries.forEach((bk) => out.push({ kind: 'diaryBook', id: bk.id, title: bk.title, sub: (bk.entries || []).length + ' 篇', words: diaryWords(bk), updatedAt: bk.updatedAt, ref: bk }));
    state.reading.forEach((b) => out.push({ kind: 'book', id: b.id, title: b.title, sub: '阅读', words: bookWords(b), updatedAt: b.updatedAt, ref: b }));
    return out;
  }

  /** 回收站出口：最多保留 60 条，避免本地存储被撑满 */
  function pushTrash(s, entry) {
    if (!Array.isArray(s.trash)) s.trash = [];
    s.trash.push(entry);
    if (s.trash.length > 60) s.trash.splice(0, s.trash.length - 60);
  }

  /* ------------------------------------------------------------------ */
  /* 变更动作                                                            */
  /* ------------------------------------------------------------------ */
  const api = {
    /* --- 个人档案（本机账号） --- */
    /** 当前档案（缺字段会就地补齐） */
    profile() { return profileOf(); },

    /** 是否已经注册过（填过昵称并有专属码） */
    isRegistered() {
      const p = profileOf();
      return !!p.registered && !!p.name && p.name !== '我';
    },

    /** 专属码：没有就生成一个并记住 */
    userCode() {
      const p = profileOf();
      if (!p.code) {
        p.code = makeUserCode();
        markDirty();
      }
      return p.code;
    },

    newUserCode() {
      return commit((s) => {
        const p = profileOf();
        p.code = makeUserCode();
        p.updatedAt = Date.now();
        if (global.Collab && global.Collab.refreshIdentity) global.Collab.refreshIdentity();
      }, { kind: 'profile' });
    },

    /**
     * 注册 / 更新档案。
     * 第一次填昵称就算注册（会补上专属码），之后随时可以改头像、昵称、签名。
     */
    saveProfile(patch) {
      return commit((s) => {
        const p = profileOf();
        const before = p.name;
        Object.assign(p, patch || {});
        if (!p.code) p.code = makeUserCode();
        if (typeof p.registered !== 'boolean' || (!p.registered && patch && patch.name)) p.registered = true;
        if (!p.createdAt) p.createdAt = Date.now();
        p.updatedAt = Date.now();
        /* 昵称变了：协作室里的署名、日记署名都要跟着变 */
        if (before !== p.name && global.Collab && global.Collab.refreshIdentity) global.Collab.refreshIdentity();
      }, { kind: 'profile' });
    },

    /** 更新状态（仿微信 / QQ）：一行字 + 表情，可选时效（小时，0 = 一直显示） */
    setStatus(text, opt) {
      const o = opt || {};
      return commit((s) => {
        const p = profileOf();
        p.status = {
          text: String(text == null ? '' : text).slice(0, 60),
          emoji: String(o.emoji || ''),
          at: Date.now(),
          until: o.hours ? Date.now() + Number(o.hours) * 3600000 : 0
        };
        p.updatedAt = Date.now();
      }, { kind: 'profile' });
    },

    clearStatus() {
      return commit((s) => {
        const p = profileOf();
        p.status = { text: '', emoji: '', at: 0, until: 0 };
        p.updatedAt = Date.now();
      }, { kind: 'profile' });
    },

    /** 当前正在展示的状态（过期的返回 null） */
    activeStatus() {
      const p = profileOf();
      const st = p.status;
      if (!st || !st.text) return null;
      if (st.until && Date.now() > st.until) return null;
      return st;
    },

    /** 头像显示用：图片优先，其次表情头像，最后昵称首字 */
    avatarOf(person) {
      const p = person || profileOf();
      if (p.avatar) return { kind: 'img', src: p.avatar };
      if (p.emoji) return { kind: 'emoji', text: p.emoji };
      const n = String(p.name || '我').trim();
      return { kind: 'text', text: n ? n.charAt(0) : '我' };
    },

    /* --- 日记收藏（日历上长按收藏的日子） --- */
    toggleDiaryFav(bookId, dateKey) {
      let on = false;
      commit((s) => {
        const b = findDiary(bookId);
        if (!b) return;
        if (!Array.isArray(b.favs)) b.favs = [];
        const i = b.favs.indexOf(dateKey);
        if (i >= 0) b.favs.splice(i, 1);
        else { b.favs.push(dateKey); b.favs.sort(); on = true; }
      }, { kind: 'diary:fav', itemId: bookId });
      return on;
    },

    isDiaryFav(bookId, dateKey) {
      const b = findDiary(bookId);
      return !!(b && Array.isArray(b.favs) && b.favs.indexOf(dateKey) >= 0);
    },

    diaryFavs(bookId) {
      const b = findDiary(bookId);
      return (b && Array.isArray(b.favs)) ? b.favs.slice() : [];
    },

    /**
     * 跨日期的一篇日记（长按日期后选一段日子，写「这几天」的专属日记）。
     * 数据上仍是一条记录，额外记下 fromKey / toKey，界面上显示成日期范围。
     */
    addDiaryRange(bookId, fromKey, toKey, data) {
      const d = data || {};
      const from = clampDiaryDate(fromKey);
      const to = clampDiaryDate(toKey);
      const a = from <= to ? from : to;
      const b2 = from <= to ? to : from;
      const en = {
        id: U.uid('en'),
        title: d.title || '',
        content: d.content || '',
        dateKey: b2,                     // 归到结束那天，日历上看得到
        fromKey: a,
        toKey: b2,
        range: true,
        multi: Array.isArray(d.participants) ? d.participants.length > 1 : !!d.multi,
        participants: Array.isArray(d.participants) ? d.participants.slice(0, 12) : [],
        mood: d.mood || '',
        weather: d.weather || '',
        tags: d.tags || [],
        images: d.images || [],
        author: d.author || '',
        words: U.words(d.content || ''),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      commit((s) => {
        const bk = findDiary(bookId);
        if (!bk) return;
        bk.entries.push(en);
        bk.entries.sort((x, y) => (x.dateKey < y.dateKey ? -1 : x.dateKey > y.dateKey ? 1 : x.createdAt - y.createdAt));
        bk.updatedAt = Date.now();
      }, { kind: 'diaryEntry:add', itemId: bookId, dateKey: en.dateKey });
      if (global.Stats) global.Stats.touch(state, 'diary', en.words, 0, { dateKey: en.dateKey });
      return en;
    },

    /* --- 读物收藏（书架封面上的爱心） --- */
    toggleLike(bookId) {
      let on = false;
      commit((s) => {
        const b = findBook(bookId);
        if (!b) return;
        b.liked = !b.liked;
        b.likedAt = b.liked ? Date.now() : 0;
        on = b.liked;
      }, { kind: 'book:like', itemId: bookId });
      return on;
    },

    isLiked(bookId) {
      const b = findBook(bookId);
      return !!(b && b.liked);
    },

    /* --- 参与者（多人创作） --- */
    /**
     * 给作品 / 章节 / 日记条目记下参与者。
     * 数据很轻：只存昵称与专属码，用来在界面上标出「多人创作 · 参与者」。
     */
    setParticipants(kind, id, list, opt) {
      const o = opt || {};
      return commit((s) => {
        let target = null;
        if (kind === 'novel') target = findNovel(id);
        else if (kind === 'article') target = findArticle(id);
        else if (kind === 'diary') target = findDiary(id);
        else if (kind === 'book') target = findBook(id);
        if (!target) return;
        const clean = (list || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
        target.members = clean;
        target.multi = clean.length > 1;
        target.updatedAt = Date.now();
        if (o.chapterId && target.chapters) {
          const ch = target.chapters.find((c) => c.id === o.chapterId);
          if (ch) { ch.participants = clean.slice(); ch.multi = clean.length > 1; }
        }
      }, { kind: kind + ':members', itemId: id });
    },

    participantsOf(item) {
      if (!item) return [];
      if (Array.isArray(item.participants) && item.participants.length) return item.participants.slice();
      if (Array.isArray(item.members) && item.members.length) return item.members.slice();
      return [];
    },

    /* --- 设置 --- */
    setSetting(key, value) {
      return commit((s) => {
        s.settings[key] = value;
        if (key === 'theme' || key === 'themeMode' || key === 'warm' || key === 'accent' || key === 'readerFontSize' || key === 'readerLineHeight' || key === 'fontSizeUI') applyTheme();
        if (key === 'brightness') applyBrightness();
      }, { kind: 'settings', view: null });
    },
    patchSettings(patch) {
      return commit((s) => {
        Object.assign(s.settings, patch);
        if (patch.accent || patch.fontSizeUI) applyTheme();
      }, { kind: 'settings' });
    },
    toggleTheme() {
      return commit((s) => {
        s.settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
        s.settings.themeMode = 'manual';
        applyTheme();
      }, { kind: 'settings' });
    },
    applyTheme: applyTheme,
    applyBrightness: applyBrightness,
    resolvedTheme: resolvedTheme,

    /* --- 小说 --- */
    createNovel(data) {
      const d = data || {};
      const now = Date.now();
      const novel = {
        id: U.uid('nv'),
        type: 'novel',
        title: d.title || '未命名小说',
        author: d.author || '',
        intro: d.intro || '',
        cover: d.cover || '',
        tags: d.tags || [],
        category: d.category || '未分类',
        status: 'writing',
        // 是否计入成就：导入的外部内容设为 false（不计入、不弹提示）
        countAchievements: d.countAchievements !== false,
        createdAt: now,
        updatedAt: now,
        chapters: [],
        outline: []
      };
      novel.chapters.push(api.newChapterObject({ title: '第一章', goal: state.settings.defaultChapterGoal }));
      commit((s) => { s.novels.unshift(novel); }, { kind: 'novel:create', itemId: novel.id });
      if (global.Stats) global.Stats.touch(state, 'novel', 0, 0, { itemId: novel.id });
      return novel;
    },
    newChapterObject(data) {
      const d = data || {};
      return {
        id: U.uid('ch'),
        title: d.title || ('第' + (d.index || 1) + '章'),
        content: d.content || '',
        sections: [],
        goal: d.goal === undefined ? state.settings.defaultChapterGoal : d.goal,
        note: d.note || '',
        words: U.words(d.content || ''),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: d.status || 'draft'
      };
    },
    updateNovel(id, patch) {
      return commit((s) => {
        const n = findNovel(id);
        if (!n) return;
        Object.assign(n, patch);
        n.updatedAt = Date.now();
      }, { kind: 'novel:update', itemId: id });
    },
    deleteNovel(id) {
      return commit((s) => {
        const i = s.novels.findIndex((n) => n.id === id);
        if (i >= 0) { pushTrash(s, { kind: 'novel', at: Date.now(), item: s.novels[i] }); s.novels.splice(i, 1); }
      }, { kind: 'novel:delete', itemId: id });
    },
    addChapter(novelId, data) {
      const n = findNovel(novelId);
      if (!n) return null;
      const ch = api.newChapterObject(Object.assign({ index: n.chapters.length + 1 }, data || {}));
      commit((s) => {
        const nn = findNovel(novelId);
        if (!nn) return;
        nn.chapters.push(ch);
        recomputeNovel(nn);
      }, { kind: 'chapter:add', itemId: novelId });
      return ch;
    },
    updateChapter(novelId, chapterId, patch) {
      return commit((s) => {
        const n = findNovel(novelId);
        if (!n) return;
        const c = n.chapters.find((x) => x.id === chapterId);
        if (!c) return;
        Object.assign(c, patch);
        c.updatedAt = Date.now();
        recomputeNovel(n);
      }, { kind: 'chapter:update', itemId: novelId, chapterId: chapterId });
    },
    /* --- 字数：输入路径的即时估算 + 空闲精确校正 ---
       大文本下逐字符统计要几十毫秒，不能每个按键都跑一遍。
       策略：输入时用字符数（length）做即时估算，浏览器空闲时再做精确统计并写回。
       估算只用于界面显示，任何「持久化 / 成就 / 统计」读取前都会先做一次精确校正。 */
    _pendingWords: new Map(),      // itemId -> { obj, content }
    _recountTimer: null,

    /** 立即（近似）字数：用于输入时的即时反馈 */
    estimateWords(content) {
      return U.estimateWords(content);
    },

    /** 登记待精确校正的条目 */
    scheduleRecount(obj, itemId, content) {
      queueRecount(obj, itemId, content);
    },

    /** 把所有待校正的字数算准（落盘 / 统计 / 成就前调用） */
    flushRecounts() {
      if (!api._pendingWords || api._pendingWords.size === 0) return;
      api._pendingWords.forEach((entry, id) => {
        try {
          const exact = U.words(entry.content);
          if (entry.obj) entry.obj.words = exact;
          state.wordsApprox = false;
        } catch (e) { /* 忽略 */ }
      });
      api._pendingWords.clear();
      markDirty();
    },

    /** 高频：正文输入（不触发整页重绘，交给编辑器处理光标） */
    setChapterContent(novelId, chapterId, content) {
      const n = findNovel(novelId);
      if (!n) return 0;
      const c = n.chapters.find((x) => x.id === chapterId);
      if (!c) return 0;
      const before = c.words || 0;
      c.content = content;
      c.words = api.estimateWords(content);
      c.updatedAt = Date.now();
      n.updatedAt = Date.now();
      n.words = undefined;   // 延迟重算，交给需要的页面
      api.scheduleRecount(c, n.id + ':' + c.id, content);
      state.wordsApprox = true;
      markDirty();
      const delta = c.words - before;
      if (global.Stats) global.Stats.touch(state, 'novel', delta > 0 ? delta : 0, 0, { itemId: novelId });
      // 输入路径不发通知：见 setArticleContent 的说明
      if (!suspended) emit({ kind: 'chapter:typing', itemId: novelId, chapterId: chapterId });
      return c.words;
    },
    deleteChapter(novelId, chapterId) {
      return commit((s) => {
        const n = findNovel(novelId);
        if (!n) return;
        const i = n.chapters.findIndex((c) => c.id === chapterId);
        if (i >= 0) { pushTrash(s, { kind: 'chapter', at: Date.now(), item: n.chapters[i], novelId: novelId }); n.chapters.splice(i, 1); }
        recomputeNovel(n);
      }, { kind: 'chapter:delete', itemId: novelId });
    },
    moveChapter(novelId, chapterId, dir) {
      return commit((s) => {
        const n = findNovel(novelId);
        if (!n) return;
        const i = n.chapters.findIndex((c) => c.id === chapterId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= n.chapters.length) return;
        const t = n.chapters[i]; n.chapters[i] = n.chapters[j]; n.chapters[j] = t;
      }, { kind: 'chapter:move', itemId: novelId });
    },
    reorderChapters(novelId, orderedIds) {
      return commit((s) => {
        const n = findNovel(novelId);
        if (!n) return;
        const map = new Map(n.chapters.map((c) => [c.id, c]));
        const next = [];
        orderedIds.forEach((id) => { if (map.has(id)) { next.push(map.get(id)); map.delete(id); } });
        map.forEach((c) => next.push(c));
        n.chapters = next;
      }, { kind: 'chapter:reorder', itemId: novelId });
    },

    /* --- 章节内小节 --- */
    addSection(novelId, chapterId, data) {
      const d = data || {};
      const sec = { id: U.uid('sc'), title: d.title || '小节', content: d.content || '', createdAt: Date.now(), updatedAt: Date.now() };
      commit((s) => {
        const c = findChapter(novelId, chapterId);
        if (!c) return;
        if (!Array.isArray(c.sections)) c.sections = [];
        c.sections.push(sec);
        const n = findNovel(novelId);
        if (n) recomputeNovel(n);
      }, { kind: 'section:add', itemId: novelId, chapterId: chapterId });
      return sec;
    },
    updateSection(novelId, chapterId, sectionId, patch) {
      return commit((s) => {
        const c = findChapter(novelId, chapterId);
        if (!c) return;
        const x = (c.sections || []).find((y) => y.id === sectionId);
        if (!x) return;
        Object.assign(x, patch);
        x.updatedAt = Date.now();
        const n = findNovel(novelId);
        if (n) recomputeNovel(n);
      }, { kind: 'section:update', itemId: novelId, chapterId: chapterId });
    },
    deleteSection(novelId, chapterId, sectionId) {
      return commit((s) => {
        const c = findChapter(novelId, chapterId);
        if (!c) return;
        const i = (c.sections || []).findIndex((y) => y.id === sectionId);
        if (i >= 0) c.sections.splice(i, 1);
        const n = findNovel(novelId);
        if (n) recomputeNovel(n);
      }, { kind: 'section:delete', itemId: novelId, chapterId: chapterId });
    },

    /* --- 大纲（小说与文章共用一棵树） --- */
    findOutlineNode(ownerId, nodeId) {
      const n = findNovel(ownerId) || findArticle(ownerId);
      if (!n) return null;
      if (!Array.isArray(n.outline)) n.outline = [];
      return findNode(n.outline, nodeId);
    },
    outlineOwner(ownerId) { return findNovel(ownerId) || findArticle(ownerId); },
    addOutlineNode(ownerId, parentId, data) {
      const d = data || {};
      const node = {
        id: U.uid('ol'),
        text: d.text || '',
        note: d.note || '',
        color: d.color || null,
        colorName: d.colorName || '',
        important: !!d.important,
        linkChapterId: d.linkChapterId || null,
        linkSectionId: d.linkSectionId || null,
        linkTitle: d.linkTitle || '',
        collapsed: false,
        children: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      commit((s) => {
        const owner = findNovel(ownerId) || findArticle(ownerId);
        if (!owner) return;
        if (!Array.isArray(owner.outline)) owner.outline = [];
        insertNode(owner.outline, parentId || null, node, d.index);
        owner.updatedAt = Date.now();
      }, { kind: 'outline:add', itemId: ownerId, view: 'outline' });
      return node;
    },
    updateOutlineNode(ownerId, nodeId, patch) {
      return commit((s) => {
        const owner = findNovel(ownerId) || findArticle(ownerId);
        if (!owner) return;
        const node = findNode(owner.outline, nodeId);
        if (!node) return;
        Object.assign(node, patch);
        node.updatedAt = Date.now();
        owner.updatedAt = Date.now();
      }, { kind: 'outline:update', itemId: ownerId, view: 'outline' });
    },
    deleteOutlineNode(ownerId, nodeId) {
      return commit((s) => {
        const owner = findNovel(ownerId) || findArticle(ownerId);
        if (!owner) return;
        removeNode(owner.outline, nodeId);
        owner.updatedAt = Date.now();
      }, { kind: 'outline:delete', itemId: ownerId, view: 'outline' });
    },
    /** 移动：把 nodeId 移到 targetId 之前/之后，或成为其子节点 */
    moveOutlineNode(ownerId, nodeId, targetId, position) {
      return commit((s) => {
        const owner = findNovel(ownerId) || findArticle(ownerId);
        if (!owner) return;
        const node = findNode(owner.outline, nodeId);
        if (!node) return;
        let bad = false;
        walkTree(node.children || [], (x) => { if (x.id === targetId) bad = true; });
        if (bad || nodeId === targetId) return;
        removeNode(owner.outline, nodeId);
        if (!targetId) owner.outline.push(node);
        else if (position === 'inside') {
          const t = findNode(owner.outline, targetId);
          if (t) { if (!Array.isArray(t.children)) t.children = []; t.children.push(node); }
        } else {
          const loc = locateNode(owner.outline, targetId);
          if (loc) loc.list.splice(loc.index + (position === 'after' ? 1 : 0), 0, node);
          else owner.outline.push(node);
        }
        owner.updatedAt = Date.now();
      }, { kind: 'outline:move', itemId: ownerId, view: 'outline' });
    },
    /** 关联到章节 / 小节 */
    linkOutlineNode(ownerId, nodeId, chapterId, sectionId, linkTitle) {
      return commit((s) => {
        const owner = findNovel(ownerId) || findArticle(ownerId);
        if (!owner) return;
        const node = findNode(owner.outline, nodeId);
        if (!node) return;
        node.linkChapterId = chapterId || null;
        node.linkSectionId = sectionId || null;
        node.linkTitle = linkTitle || '';
        node.updatedAt = Date.now();
      }, { kind: 'outline:link', itemId: ownerId, view: 'outline' });
    },
    /** 某个章节 / 小节关联到的大纲节点 */
    nodesForChapter(novelId, chapterId, sectionId) {
      const n = findNovel(novelId);
      if (!n) return [];
      const out = [];
      walkTree(n.outline || [], (nd) => {
        if (!nodeLinked(n, nd)) return;
        if (sectionId) { if (nd.linkSectionId === sectionId) out.push(nd); }
        else if (nd.linkChapterId === chapterId) out.push(nd);
      });
      return out;
    },
    /** 清理失效关联（章节被删后） */
    pruneOutlineLinks(novelId) {
      return commit((s) => {
        const owner = findNovel(novelId) || findArticle(novelId);
        if (!owner) return;
        walkTree(owner.outline || [], (nd) => {
          if (!nodeLinked(owner, nd)) { nd.linkChapterId = null; nd.linkSectionId = null; nd.linkTitle = ''; }
        });
      }, { kind: 'outline:prune', itemId: novelId, view: 'outline' });
    },
    _outlineIndex(ownerId) {
      const owner = findNovel(ownerId) || findArticle(ownerId);
      const map = {};
      if (!owner) return map;
      walkTree(owner.outline || [], (nd, parent) => { map[nd.id] = { node: nd, parent: parent ? parent.id : null }; });
      return map;
    },
    walkTree: walkTree,
    findNode: findNode,

    /* --- 文章 --- */
    createArticle(data) {
      const d = data || {};
      const now = Date.now();
      const a = {
        id: U.uid('ar'),
        type: 'article',
        title: d.title || '未命名文章',
        category: d.category || '随笔',              // 文章类型
        countAchievements: d.countAchievements !== false,
        content: d.content || '',
        tags: d.tags || [],
        outline: d.outline || [],
        goal: 0,
        words: U.words(d.content || ''),
        createdAt: now,
        updatedAt: now
      };
      commit((s) => { s.articles.unshift(a); }, { kind: 'article:create', itemId: a.id });
      if (global.Stats) global.Stats.touch(state, 'article', 0, 0, { itemId: a.id });
      return a;
    },
    updateArticle(id, patch) {
      return commit((s) => {
        const a = findArticle(id);
        if (!a) return;
        Object.assign(a, patch);
        if (patch.content !== undefined) a.words = U.words(patch.content);
        a.updatedAt = Date.now();
      }, { kind: 'article:update', itemId: id });
    },
    setArticleContent(id, content) {
      const a = findArticle(id);
      if (!a) return 0;
      const before = a.words || 0;
      a.content = content;
      a.words = api.estimateWords(content);      // 即时估算，空闲时精确校正
      a.updatedAt = Date.now();
      api.scheduleRecount(a, 'ar:' + id, content);
      state.wordsApprox = true;
      markDirty();
      const delta = a.words - before;
      if (global.Stats) global.Stats.touch(state, 'article', delta > 0 ? delta : 0, 0, { itemId: id });
      // 输入路径不发通知：避免每次按键触发订阅者重绘（大纲/日记/列表页会整棵重建）
      if (!suspended) emit({ kind: 'article:typing', itemId: id });
      return a.words;
    },
    deleteArticle(id) {
      return commit((s) => {
        const i = s.articles.findIndex((a) => a.id === id);
        if (i >= 0) { pushTrash(s, { kind: 'article', at: Date.now(), item: s.articles[i] }); s.articles.splice(i, 1); }
      }, { kind: 'article:delete', itemId: id });
    },

    /* --- 日记 --- */
    createDiaryBook(data) {
      const d = data || {};
      const now = Date.now();
      const bk = {
        id: U.uid('dy'),
        type: 'diary',
        title: d.title || '我的日记',
        kind: d.kind || 'daily',            // daily | weekly | monthly | custom
        intervalDays: d.intervalDays || 7,  // custom 时的间隔天数
        category: d.category || '生活',      // 内容主题
        countAchievements: d.countAchievements !== false,
        description: d.description || '',
        cover: d.cover || '',
        /* 多人日记：members 为空就是单人本；有成员时每条记录按作者区分 */
        members: Array.isArray(d.members) ? d.members : [],
        entries: [],
        createdAt: now,
        updatedAt: now
      };
      commit((s) => { s.diaries.unshift(bk); }, { kind: 'diary:create', itemId: bk.id });
      if (global.Stats) global.Stats.touch(state, 'diary', 0, 0, {});
      return bk;
    },
    updateDiaryBook(id, patch) {
      return commit((s) => {
        const b = findDiary(id);
        if (!b) return;
        Object.assign(b, patch);
        b.updatedAt = Date.now();
      }, { kind: 'diary:update', itemId: id });
    },
    deleteDiaryBook(id) {
      return commit((s) => {
        const i = s.diaries.findIndex((b) => b.id === id);
        if (i >= 0) { pushTrash(s, { kind: 'diaryBook', at: Date.now(), item: s.diaries[i] }); s.diaries.splice(i, 1); }
      }, { kind: 'diary:delete', itemId: id });
    },
    /** 某一天的条目（同一天可多条） */
    diaryEntriesOf(bookId, dateKey) {
      const b = findDiary(bookId);
      if (!b) return [];
      return (b.entries || []).filter((e) => e.dateKey === dateKey);
    },
    addDiaryEntry(bookId, data) {
      const d = data || {};
      const now = Date.now();
      const en = {
        id: U.uid('en'),
        title: d.title || '',
        content: d.content || '',
        dateKey: clampDiaryDate(d.dateKey),
        mood: d.mood || '',
        weather: d.weather || '',
        tags: d.tags || [],
        images: d.images || [],
        /* 多人日记：每条记录记下是谁写的（单人本留空即可） */
        author: d.author || '',
        /* 多人创作：参与者名字数组（>=2 就是多人创作，界面上会标出来） */
        participants: Array.isArray(d.participants) ? d.participants.slice(0, 12) : [],
        multi: Array.isArray(d.participants) ? d.participants.length > 1 : !!d.multi,
        words: U.words(d.content || ''),
        createdAt: now,
        updatedAt: now
      };
      commit((s) => {
        const b = findDiary(bookId);
        if (!b) return;
        b.entries.push(en);
        b.entries.sort((x, y) => (x.dateKey < y.dateKey ? -1 : x.dateKey > y.dateKey ? 1 : x.createdAt - y.createdAt));
        b.updatedAt = now;
      }, { kind: 'diaryEntry:add', itemId: bookId, dateKey: en.dateKey });
      if (global.Stats) global.Stats.touch(state, 'diary', en.words, 0, { dateKey: en.dateKey });
      return en;
    },
    updateDiaryEntry(bookId, entryId, patch) {
      return commit((s) => {
        const b = findDiary(bookId);
        if (!b) return;
        const e = b.entries.find((x) => x.id === entryId);
        if (!e) return;
        const before = e.words || 0;
        Object.assign(e, patch);
        /* 改日期：同样不许改到未来，并重新排好顺序 */
        if (patch.dateKey !== undefined) {
          e.dateKey = clampDiaryDate(patch.dateKey);
          b.entries.sort((x, y) => (x.dateKey < y.dateKey ? -1 : x.dateKey > y.dateKey ? 1 : x.createdAt - y.createdAt));
        }
        if (patch.content !== undefined) e.words = U.words(patch.content);
        e.updatedAt = Date.now();
        b.updatedAt = Date.now();
        if (e.words > before && global.Stats) global.Stats.touch(s, 'diary', e.words - before, 0, { dateKey: e.dateKey });
      }, { kind: 'diaryEntry:update', itemId: bookId, entryId: entryId });
    },
    setDiaryEntryContent(bookId, entryId, content) {
      const b = findDiary(bookId);
      if (!b) return 0;
      const e = b.entries.find((x) => x.id === entryId);
      if (!e) return 0;
      const before = e.words || 0;
      e.content = content;
      e.words = api.estimateWords(content);
      e.updatedAt = Date.now();
      b.updatedAt = Date.now();
      api.scheduleRecount(e, 'en:' + entryId, content);
      state.wordsApprox = true;
      markDirty();
      const delta = e.words - before;
      if (global.Stats) global.Stats.touch(state, 'diary', delta > 0 ? delta : 0, 0, { dateKey: e.dateKey });
      if (!suspended) emit({ kind: 'diaryEntry:typing', itemId: bookId, entryId: entryId });
      return e.words;
    },
    deleteDiaryEntry(bookId, entryId) {
      return commit((s) => {
        const b = findDiary(bookId);
        if (!b) return;
        const i = b.entries.findIndex((x) => x.id === entryId);
        if (i >= 0) {
          const e = b.entries[i];
          (e.images || []).forEach((img) => DB.deleteImage(img.id));
          pushTrash(s, { kind: 'diaryEntry', at: Date.now(), item: e, bookId: bookId });
          b.entries.splice(i, 1);
        }
      }, { kind: 'diaryEntry:delete', itemId: bookId });
    },
    addDiaryImage(bookId, entryId, img) {
      return commit((s) => {
        const b = findDiary(bookId);
        if (!b) return;
        const e = b.entries.find((x) => x.id === entryId);
        if (!e) return;
        if (!Array.isArray(e.images)) e.images = [];
        e.images.push(img);
        e.updatedAt = Date.now();
      }, { kind: 'diaryImage:add', itemId: bookId, entryId: entryId });
    },
    removeDiaryImage(bookId, entryId, imageId) {
      DB.deleteImage(imageId);
      return commit((s) => {
        const b = findDiary(bookId);
        if (!b) return;
        const e = b.entries.find((x) => x.id === entryId);
        if (!e) return;
        const i = (e.images || []).findIndex((x) => x.id === imageId);
        if (i >= 0) e.images.splice(i, 1);
      }, { kind: 'diaryImage:remove', itemId: bookId, entryId: entryId });
    },

    /* --- 阅读 --- */
    createBook(data) {
      const d = data || {};
      const now = Date.now();
      const book = {
        id: U.uid('bk'),
        type: 'book',
        title: d.title || '未命名读物',
        author: d.author || '',
        category: d.category || '其它',           // 读物类型
        source: d.source || 'import',
        /* 从网址下载的书：记下来源，方便知道它是哪来的 */
        url: d.url || '',
        // 是否计入阅读成就与统计：导入的书默认不计入（用户可在导入时勾选）
        countAchievements: d.countAchievements === true,
        format: d.format || 'txt',
        chapters: d.chapters || [],
        bookmarks: [],
        progress: { chapterIndex: 0, scroll: 0, percent: 0 },
        words: 0,
        readingMs: 0,
        createdAt: now,
        updatedAt: now,
        lastReadAt: 0
      };
      recomputeBook(book);
      commit((s) => { s.reading.unshift(book); }, { kind: 'book:create', itemId: book.id });
      return book;
    },
    updateBook(id, patch) {
      return commit((s) => {
        const b = findBook(id);
        if (!b) return;
        Object.assign(b, patch);
        b.updatedAt = Date.now();
      }, { kind: 'book:update', itemId: id });
    },
    deleteBook(id) {
      return commit((s) => {
        const i = s.reading.findIndex((b) => b.id === id);
        if (i >= 0) { pushTrash(s, { kind: 'book', at: Date.now(), item: s.reading[i] }); s.reading.splice(i, 1); }
      }, { kind: 'book:delete', itemId: id });
    },
    setBookProgress(id, progress) {
      return commit((s) => {
        const b = findBook(id);
        if (!b) return;
        b.progress = Object.assign({ chapterIndex: 0, scroll: 0, percent: 0 }, b.progress, progress);
        b.lastReadAt = Date.now();
      }, { kind: 'book:progress', itemId: id, silent: true });
    },
    addBookmark(id, mark) {
      return commit((s) => {
        const b = findBook(id);
        if (!b) return;
        if (!Array.isArray(b.bookmarks)) b.bookmarks = [];
        b.bookmarks.push(Object.assign({ id: U.uid('bm'), at: Date.now() }, mark));
      }, { kind: 'book:bookmark', itemId: id });
    },
    removeBookmark(id, markId) {
      return commit((s) => {
        const b = findBook(id);
        if (!b) return;
        const i = (b.bookmarks || []).findIndex((m) => m.id === markId);
        if (i >= 0) b.bookmarks.splice(i, 1);
      }, { kind: 'book:bookmark', itemId: id });
    },

    /* --- 成就 --- */
    unlockAchievement(id, meta) {
      if (state.achievements[id]) return false;
      commit((s) => {
        s.achievements[id] = { at: Date.now(), meta: meta || null };
        s.newAchievements.push(id);
      }, { kind: 'achievement', silent: true });
      emit({ kind: 'achievement', id: id });
      return true;
    },
    consumeNewAchievements() {
      const list = state.newAchievements.slice();
      if (list.length) { state.newAchievements = []; markDirty(); }
      return list;
    },

    /* --- 导入导出 --- */
    replaceAll(newState) {
      state = migrate(newState);
      applyTheme();
      markDirty();
      emit({ kind: 'import' });
      return state;
    },
    mergeImport(payload) {
      let added = 0;
      commit((s) => {
        const pushUnique = (arr, items, key) => {
          (items || []).forEach((item) => {
            if (!item || !item.id) return;
            if (arr.some((x) => x.id === item.id || (key && x[key] === item[key]))) return;
            arr.push(item);
            added++;
          });
        };
        pushUnique(s.novels, payload.novels, 'title');
        pushUnique(s.articles, payload.articles, null);
        pushUnique(s.diaries, payload.diaries, null);
        pushUnique(s.reading, payload.reading, null);
        if (payload.achievements) Object.keys(payload.achievements).forEach((k) => { if (!s.achievements[k]) s.achievements[k] = payload.achievements[k]; });
        s.novels.forEach(recomputeNovel);
        s.articles.forEach(recomputeArticle);
        s.reading.forEach(recomputeBook);
      }, { kind: 'import' });
      return added;
    },

    /* --- 工具 --- */
    recomputeNovel: recomputeNovel,
    recomputeArticle: recomputeArticle,
    recomputeBook: recomputeBook,
    articleWords: articleWords,
    novelWords: novelWords,
    bookWords: bookWords,
    diaryWords: diaryWords,
    findNovel: findNovel,
    findArticle: findArticle,
    findDiary: findDiary,
    findBook: findBook,
    findChapter: findChapter,
    findSection: findSection,
    totalWords: totalWords,
    allItems: allItems,
    allContentDates: allContentDates,
    diaryDates: diaryDates,
    subscribe: subscribe,
    onActiveView: onActiveView,
    commit: commit,
    markDirty: markDirty,
    flushNow: flushNow,
    flushLocal: flushLocal,
    /* 批量操作：期间挂起落盘与自动刷新，结束后一次性提交（导入大文件用） */
    beginBatch: beginBatch,
    endBatch: endBatch,
    flushIdb: flushIdb,
    countNodes: countNodes,
    countMarks: countMarks,
    countLinkedNodes: countLinkedNodes,
    countColors: countColors,
    pushTrash: pushTrash,
    PALETTE: PALETTE,
    get state() { return state; },
    set state(v) { state = v; },
    get lastSavedAt() { return lastSavedAt; }
  };

  api._DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  api._DEFAULT_STATE = DEFAULT_STATE;
  api.init = init;

  global.Store = api;
})(window);
