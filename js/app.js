/* ==========================================================================
   selfwriting · app.js
   启动引导：初始化存储 → 应用主题 → 挂载视图 → 注册离线缓存
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const Store = global.Store;
  const UI = global.UI;
  const Stats = global.Stats;

  function boot() {
    /* 启动时的兜底错误提示（便于发现问题，不影响数据） */
    global.addEventListener('error', (e) => {
      if (!e || !e.message) return;
      console.error('[selfwriting]', e.message);
    });
    global.addEventListener('unhandledrejection', (e) => {
      console.error('[selfwriting:promise]', e && e.reason);
    });

    showSplash();

    Store.init()
      .then(() => {
        UI.init();
        try { U.applyFonts(Store.state.settings); } catch (e) { /* 字体缺失不影响启动 */ }
        Stats.recalcGaps();
        global.Ach.evaluate(Store.state, true);
        UI.start();
        hideSplash();
        /* 多语种放在首屏渲染之后：此时 DOM 已就绪，翻译才有东西可翻 */
        try { I18N.start(); I18N.watch(); } catch (e) { /* 多语种失败也要能正常用 */ }
        afterBoot();
      })
      .catch((err) => {
        console.error('[boot]', err);
        hideSplash();
        document.body.insertAdjacentHTML('beforeend',
          '<div style="position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);z-index:9999;text-align:center">' +
          '<div><div style="font-size:16px;font-weight:650;margin-bottom:8px">启动失败</div>' +
          '<div style="font-size:13px;color:var(--text-3);line-height:1.7">' + U.escapeHtml(String(err && err.message || err)) +
          '<br>请尝试在浏览器设置里允许本站使用本地存储后重试。</div></div></div>');
      });
  }

  function showSplash() {
    const el = document.createElement('div');
    el.id = 'splash';
    el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:var(--bg);z-index:9500;transition:opacity .3s ease';
    el.innerHTML =
      '<div style="text-align:center">' +
      '<svg width="66" height="66" viewBox="0 0 96 96" fill="none" style="margin-bottom:14px">' +
      '<path d="M20 74V26a6 6 0 016-6h30" stroke="#b4503c" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M20 74h44a8 8 0 008-8V34" stroke="#b4503c" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M40 26l30 30" stroke="#b4503c" stroke-width="5" stroke-linecap="round"/>' +
      '</svg>' +
      '<div style="font-size:15px;font-weight:650;letter-spacing:.02em">selfwriting</div>' +
      '<div style="font-size:11.5px;color:var(--text-3);margin-top:4px">离线创作 · 正在读取本地数据</div>' +
      '</div>';
    document.body.appendChild(el);
  }

  function hideSplash() {
    const el = document.getElementById('splash');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
  }

  function afterBoot() {
    /* 离线缓存（带 #/no-sw 打开时不注册，便于开发/自动化验证） */
    const noSw = UI.currentPath().indexOf('no-sw') >= 0 || /[?&]nosw=1/.test(location.search);
    if (!noSw && 'serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e && e.message));
    }

    /* 切后台 / 关闭页面前立即落盘 */
    const flush = () => {
      try { Stats.flush(); } catch (e) { /* noop */ }
      try { Stats.recalcGaps(); } catch (e) { /* noop */ }
      Store.flushNow();
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    global.addEventListener('pagehide', flush);
    global.addEventListener('beforeunload', () => { try { Store.flushNow(); } catch (e) { /* noop */ } });

    /* 定期落盘（防止长时间不切换页面时意外丢失） */
    setInterval(() => { Store.flushIdb ? Store.flushIdb() : Store.flushLocal(); }, 60000);

    /* 首次使用：给出引导 */
    const st = Store.state;
    if (!st.profile || !st.profile.seenIntro) {
      st.profile = st.profile || {};
      st.profile.seenIntro = true;
      Store.markDirty();
      setTimeout(welcome, 600);
    }

    /* 深链：示例数据（地址栏 #/demo 触发） */
    if (/^demo(&|$)/.test(UI.currentPath())) {
      try { seedDemo(); } catch (e) { console.error('[demo]', e); UI.toast('示例数据创建失败：' + (e.message || e), 'close'); }
    }
  }

  function welcome() {
    UI.sheet({
      title: '欢迎使用 selfwriting',
      body: (host) => {
        U.append(host, [
          U.el('div', { style: { fontSize: '14px', fontWeight: '620', marginBottom: '10px' }, text: '一个完全离线的创作与记录空间' }),
          U.el('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.9' } }, [
            U.el('div', { text: '· 小说：分章节写作，随时对照大纲，章节字数目标实时进度' }),
            U.el('div', { text: '· 大纲：颜色区分分支、标记重点，改动与正文双向同步' }),
            U.el('div', { text: '· 文章 / 日记：日记支持日历、周记、月记与自定义间隔，可插图' }),
            U.el('div', { text: '· 阅读器：导入 TXT / Markdown 离线阅读，亮度字体随心调' }),
            U.el('div', { text: '· 成就与统计：各模块独立成就，创作时长 / 速度 / 最长间隔' }),
            U.el('div', { text: '· 数据只保存在这台设备上，记得定期导出备份' })
          ])
        ]);
      },
      footer: [
        { label: '看看示例数据', ghost: true, onClick: () => { UI.closeSheet(); seedDemo(); } },
        { label: '开始创作', primary: true }
      ]
    });
  }

  /* ================================================================== */
  /* 示例数据（可选，随时可在设置里清空）                              */
  /* ================================================================== */
  function seedDemo() {
    const st = Store.state;
    if (st.profile && st.profile.demo) { UI.toast('示例数据已经存在', 'check'); UI.go('novel'); return; }
    st.profile = st.profile || {};
    st.profile.demo = true;

    /* 小说 + 章节 + 大纲 */
    const nv = Store.createNovel({
      title: '长夜将尽（示例）',
      author: '我',
      intro: '一个关于记忆与告别的故事。示例数据，可随时删除。',
      category: '长篇小说'
    });
    const ch1 = nv.chapters[0];
    Store.updateChapter(nv.id, ch1.id, {
      title: '第一章 雨夜',
      goal: 3000,
      content: '雨下了一整夜。\n\n陈默把伞靠在门边，水滴顺着伞骨落在地板上，聚成一小片暗色。他忽然想起很多年前的那个晚上——也是这样的雨。\n\n「你回来了。」屋里的人说。\n\n他没有回答。有些话一旦说出口，就再也收不回去了。'
    });
    const ch2 = Store.addChapter(nv.id, { title: '第二章 旧信', goal: 3000 });
    Store.setChapterContent(nv.id, ch2.id,
      '抽屉最里面压着一封信，纸边已经泛黄。\n\n信封上没有邮票，收信人那一栏是空的，只有一行小字：「等你想起我的时候再看」。\n\n他盯着那行字看了很久，最终没有拆开。');
    const ch3 = Store.addChapter(nv.id, { title: '第三章 灯塔', goal: 3000 });

    const rootA = Store.addOutlineNode(nv.id, null, { text: '主线：寻找失踪的哥哥', color: '#b4503c', colorName: '朱砂', important: true });
    const c1 = Store.addOutlineNode(nv.id, rootA.id, { text: '第一章：雨夜归来，发现旧信', color: '#b4503c', colorName: '朱砂', linkChapterId: ch1.id });
    Store.addOutlineNode(nv.id, c1.id, { text: '细节：伞骨滴水 → 暗示时间流逝', color: '#b4503c', colorName: '朱砂', important: true });
    Store.addOutlineNode(nv.id, rootA.id, { text: '第二章：拆信与回忆穿插', color: '#b4503c', colorName: '朱砂', linkChapterId: ch2.id });
    const rootB = Store.addOutlineNode(nv.id, null, { text: '人物线：陈默与母亲的关系', color: '#34618f', colorName: '沧蓝' });
    Store.addOutlineNode(nv.id, rootB.id, { text: '母亲始终没有说出真相', color: '#34618f', colorName: '沧蓝' });
    const rootC = Store.addOutlineNode(nv.id, null, { text: '悬念线：灯塔上的灯为什么一直亮着', color: '#2f7d5f', colorName: '松绿', important: true });
    Store.addOutlineNode(nv.id, rootC.id, { text: '第三章揭晓：有人一直在等他回来', color: '#2f7d5f', colorName: '松绿', linkChapterId: ch3.id });
    Store.addOutlineNode(nv.id, null, { text: '结局构想：他最终选择留下', color: '#b8860b', colorName: '赭金', important: true });

    /* 文章 */
    const ar = Store.createArticle({ title: '关于写作这件事（示例）', tags: ['随笔', '写作'] });
    Store.setArticleContent(ar.id,
      '写作最难的部分，往往不是把句子写好，而是坐下来开始写。\n\n我试过很多办法：定闹钟、换环境、给自己设字数目标。最后真正有用的只有一条——把目标定得足够小，小到不好意思不完成。\n\n比如：今天只要写三百字。');
    const ar2 = Store.createArticle({ title: '读书笔记：怎样做笔记', tags: ['笔记'] });
    Store.setArticleContent(ar2.id, '摘抄要有出处，感想要有对象。把「我读到了什么」和「我想到了什么」分开写，回头再看会清楚很多。');

    /* 日记 + 周记 + 自定义间隔 */
    const dy = Store.createDiaryBook({ title: '我的日记（示例）', kind: 'daily' });
    const today = U.dateKey();
    Store.addDiaryEntry(dy.id, {
      dateKey: U.shiftDate(today, -2), mood: '平静', weather: '雨',
      content: '今天下雨，没有出门。把第一章重写了一遍，删掉了三百字，反而更顺了。\n\n晚上听了很久的雨声。'
    });
    Store.addDiaryEntry(dy.id, {
      dateKey: U.shiftDate(today, -1), mood: '充实', weather: '多云', tags: ['写作'],
      content: '写了 1200 字，达成今日目标。发现先写大纲再写正文，速度快很多。'
    });
    Store.addDiaryEntry(dy.id, {
      dateKey: today, mood: '期待', weather: '晴',
      content: '今天开始用 selfwriting 记录。希望一年后回头看，能看到自己走了多远。'
    });
    const wk = Store.createDiaryBook({ title: '每周回顾（示例）', kind: 'weekly' });
    Store.addDiaryEntry(wk.id, { dateKey: today, mood: '平静', content: '本周写了三章，进度比预期慢一点，但状态不错。下周把第二章改完。' });
    const cu = Store.createDiaryBook({ title: '每 3 天记录（示例）', kind: 'custom', intervalDays: 3 });
    Store.addDiaryEntry(cu.id, { dateKey: U.shiftDate(today, -3), content: '三天一次的记录：这三天里读完了半本书。' });

    /* 阅读 */
    const bk = Store.createBook({
      title: '示例读物 · 论读书',
      author: '佚名',
      format: 'md',
      chapters: [
        { id: U.uid('bc'), title: '一、读书的方法', content: '读书要慢。慢不是拖延，而是让每一句话都有落脚的地方。\n\n遇到喜欢的句子，抄下来；遇到不懂的地方，标记出来，隔几天再回来看。\n\n**重点**：笔记是读书的一半。', words: 0 },
        { id: U.uid('bc'), title: '二、笔记的作用', content: '笔记不是为了记住，而是为了想清楚。\n\n把作者的话用自己的话写一遍，你会发现很多「以为懂了」的地方其实是含混的。', words: 0 },
        { id: U.uid('bc'), title: '三、重读', content: '一本好书值得读三遍：年轻时、困惑时、年老时。\n\n> 每一次重读，读到的其实都是自己。', words: 0 }
      ]
    });
    Store.recomputeBook(Store.findBook(bk.id));

    /* 一点统计与成就，便于直观看到效果 */
    const s = Store.state.stats;
    s.daily[U.dateKey()] = Object.assign(s.daily[U.dateKey()] || { byModule: {}, items: {} }, { ms: 42 * 60000, words: 1260, byModule: { novel: 900, article: 0, diary: 360, reading: 0 }, items: {} });
    s.daily[U.shiftDate(today, -1)] = Object.assign(s.daily[U.shiftDate(today, -1)] || { byModule: {}, items: {} }, { ms: 65 * 60000, words: 1840, byModule: { novel: 1500, article: 200, diary: 140, reading: 0 }, items: {} });
    s.daily[U.shiftDate(today, -2)] = Object.assign(s.daily[U.shiftDate(today, -2)] || { byModule: {}, items: {} }, { ms: 28 * 60000, words: 620, byModule: { novel: 500, article: 0, diary: 120, reading: 0 }, items: {} });
    s.totals.ms = 22 * 3600000; s.totals.words = 48300; s.totals.sessions = 34;
    s.modules.novel = { ms: 15 * 3600000, words: 38000, sessions: 22 };
    s.modules.article = { ms: 3 * 3600000, words: 6200, sessions: 6 };
    s.modules.diary = { ms: 2.4 * 3600000, words: 4100, sessions: 6 };
    s.modules.reading = { ms: 1.6 * 3600000, words: 0, sessions: 0 };
    s.journal = [
      { kind: 'novel', start: Date.now() - 3600000 * 2, end: Date.now() - 3600000 * 2 + 2400000, ms: 2400000, words: 1200, itemId: nv.id },
      { kind: 'diary', start: Date.now() - 3600000 * 26, end: Date.now() - 3600000 * 26 + 900000, ms: 900000, words: 360, itemId: dy.id }
    ];
    s.best = { dayWords: 1840, dayDate: U.shiftDate(today, -1), speedPerHour: 1320, speedDate: U.shiftDate(today, -1), longestSessionMs: 2400000, longestSessionAt: Date.now() - 3600000 * 2 };
    Stats.recalcGaps();
    Store.commit(null, { kind: 'demo' });
    global.Ach.evaluate(Store.state, true);
    Store.flushNow().then(() => {
      UI.toast('示例数据已创建', 'check');
      UI.go('novel');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* ================================================================== */
  /* 开发/验证用：清空本机数据（同时允许下次启动时重新展示引导）          */
  /* 只有显式调用才会执行，正常使用不会触发。                            */
  /* ================================================================== */
  global.__selfwritingReset = function () {
    const hadIntro = !!(Store.state && Store.state.profile && Store.state.profile.seenIntro);
    return DB.wipe().then(() => {
      try {
        if (!hadIntro) global.localStorage.removeItem('selfwriting.state.v1');
      } catch (e) { /* noop */ }
      return true;
    });
  };

  /** 供验证脚本使用：立即进入示例模式 */
  global.__selfwritingDemo = function () { seedDemo(); return true; };
})(window);
