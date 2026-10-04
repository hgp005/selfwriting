/* ==========================================================================
   selfwriting · ui.js
   视图路由 + 全局交互件（吐司 / 抽屉 / 对话框 / 亮度面板 / 全局搜索 / 成就）
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const Store = global.Store;
  const UI = {};

  const dom = {};
  const routes = [];
  let current = { route: null, params: {}, cleanup: null };

  /* ================================================================== */
  /* 路由                                                              */
  /* ================================================================== */
  /**
   * 注册路由：UI.route(pattern, handler, opts)
   * pattern 例：'library' | 'library/:id'；handler(view, params, route) 可返回 cleanup
   */
  UI.route = function (pattern, handler, opts) {
    const segs = pattern.split('/').filter(Boolean);
    routes.push({ pattern: pattern, segs: segs, handler: handler, opts: opts || {} });
    // 长路径优先
    routes.sort((a, b) => b.segs.length - a.segs.length);
  };

  function matchRoute(path) {
    const segs = path.split('/').filter(Boolean);
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (r.segs.length !== segs.length) continue;
      const params = {};
      let ok = true;
      for (let j = 0; j < r.segs.length; j++) {
        const p = r.segs[j];
        if (p.charAt(0) === ':') params[p.slice(1)] = decodeURIComponent(segs[j]);
        else if (p !== segs[j]) { ok = false; break; }
      }
      if (ok) return { route: r, params: params };
    }
    return null;
  }

  UI.currentPath = function () {
    /* 去掉查询串：路由形如 #/editor/<id>/<ch>?continue=1，
       不剥离的话 matchRoute 会拿 "…?continue=1" 当路径段，永远匹配不上 */
    const h = String(location.hash || '').replace(/^#\/?/, '');
    return h.split('?')[0].split('&')[0] || '';
  };

  /** 取地址里的参数（目前只用到 continue 这一种标记） */
  UI.hashQuery = function (name) {
    const h = String(location.hash || '');
    const q = h.indexOf('?') >= 0 ? h.slice(h.indexOf('?') + 1) : '';
    if (!q) return '';
    const parts = q.split('&');
    for (let i = 0; i < parts.length; i++) {
      const eq = parts[i].indexOf('=');
      if (eq < 0) continue;
      if (parts[i].slice(0, eq) === name) return decodeURIComponent(parts[i].slice(eq + 1));
    }
    return '';
  };

  /* ------------------------------------------------------------------
     返回键模型：像原生应用那样「一层一层退」，而不是浏览器那样每一步都回退。
       · 换标签（底部五个模块）→ 页面栈重置，返回键直接退出应用；
       · 同一类页面里切换（换章节、换条目、换书）→ 只替换栈顶，不堆历史；
       · 进入更深的页面（书架→正文、列表→写作页）→ 入栈一层；
       · 回到别的类别的页面 → 也记一层，返回键能回到「你是从哪来的」。
     顶部返回按钮和安卓返回键都走 UI.hardwareBack()，逻辑只有一份。
     ------------------------------------------------------------------ */
  UI.stack = [];
  const ROOT_PAGES = { novel: 1, article: 1, diary: 1, outline: 1, reader: 1, library: 1 };

  /** 页面类别：路由第一段（editor / read / outline …），同类页面之间是「替换」 */
  function kindOf(path) {
    return String(path || '').split('/')[0] || 'novel';
  }

  /** 页面层级：底部标签最浅，顶部栏工具页次之，其余按路径段数 */
  function depthOf(path) {
    const segs = String(path || '').split('/').filter(Boolean);
    if (!segs.length) return 1;
    if (segs.length === 1) return ROOT_PAGES[segs[0]] ? 1 : 2;
    return segs.length + 1;
  }

  function isRootPage(path) {
    const segs = String(path || '').split('/').filter(Boolean);
    return segs.length === 1 && !!ROOT_PAGES[segs[0]];
  }

  /** 往页面栈里记一笔（每次 render 都会调用） */
  function trackStack(path) {
    const st = UI.stack;
    const top = st.length ? st[st.length - 1] : null;
    if (top === path) return;
    if (isRootPage(path)) { st.length = 0; st.push(path); return; }
    if (!top) { st.push(path); return; }
    const k = kindOf(path), tk = kindOf(top);
    if (k === tk) { st[st.length - 1] = path; return; }           // 换章 / 换条目：替换
    if (depthOf(path) > depthOf(top)) { st.push(path); return; }  // 更深一层：入栈
    for (let i = st.length - 1; i >= 0; i--) {                    // 栈里有这一类：退回到它
      if (kindOf(st[i]) === k) { st.length = i + 1; st[i] = path; return; }
    }
    st.push(path);                                               // 别处来的：记一层，好退回去
    if (st.length > 8) st.splice(0, st.length - 8);              // 栈别无限长
  }

  /** 这次跳转要不要新增一条历史？只有「往更深一层走」才新增 */
  UI.shouldPush = function (from, to) {
    return depthOf(to) > depthOf(from) && kindOf(to) !== kindOf(from);
  };

  UI.go = function (path, opts) {
    const target = '#/' + String(path || '').replace(/^#?\/?/, '');
    if (!dom.view) { location.hash = target; return; }      // 未 init 时只改地址
    if (location.hash === target) { UI.render(); return; }
    if (opts && opts.replace) location.replace(target);
    else if (UI.shouldPush(UI.currentPath(), path)) location.hash = target;
    else location.replace(target);                          // 同类/回退：不堆历史
  };

  /** 交给原生退出应用（装了壳才有效） */
  UI.exitApp = function () {
    try {
      if (global.SWNative && typeof global.SWNative.exitApp === 'function') {
        global.SWNative.exitApp();
        return true;
      }
    } catch (e) { /* 浏览器里没有这个接口 */ }
    return false;
  };

  let exitArmedAt = 0;

  /** 退到页面栈的上一层；已经是最外层就返回 false */
  UI.goUp = function () {
    if (UI.stack.length > 1) {
      UI.stack.pop();
      UI.go(UI.stack[UI.stack.length - 1], { replace: true });
      return true;
    }
    return false;
  };

  /**
   * 返回键的统一入口（安卓返回键 / 返回按钮最后都落到这里）。
   * 返回 true 表示「我处理了」，返回 false 表示已经是最外层（调用方决定是否退出）。
   */
  UI.hardwareBack = function () {
    /* 1. 有弹层先关弹层 */
    if (UI.isSheetOpen()) { UI.closeSheet(); return true; }
    if (dom.modalHost && !dom.modalHost.classList.contains('hidden')) { UI.closeModal(null); return true; }
    if (dom.brightPanel && !dom.brightPanel.classList.contains('hidden')) { UI.toggleBrightness(false); return true; }
    /* 2. 页面栈里还有上一层：退回去（替换，不新增历史） */
    if (UI.goUp()) return true;
    /* 3. 已经是最外层：安卓惯例「再按一次退出」 */
    const now = Date.now();
    if (now - exitArmedAt < 2200) {
      exitArmedAt = 0;
      /* 装了安卓壳就真的退出；浏览器里没有「退出应用」这回事，保持不动 */
      UI.exitApp();
      return true;
    }
    exitArmedAt = now;
    UI.toast('再按一次返回键退出', 'back');
    return true;
  };

  UI.back = function (fallback) {
    if (UI.isSheetOpen()) { UI.closeSheet(); return; }
    if (UI.goUp()) return;
    UI.go(fallback || UI.tabHome(UI.tabOf(UI.currentPath())));
  };

  /** 路由段 → 底部标签（模块详情页也归属对应标签） */
  /* 底部导航：只放创作模块。工具与娱乐走顶部栏的「更多」，
     但路由仍归属对应的高亮（进入 calc 时「更多」按钮点亮）。 */
  const TAB_ALIAS = {
    library: 'novel',      // 旧的「书架」入口归到小说
    novel: 'novel',
    article: 'article',
    articles: 'article',
    diary: 'diary',
    outline: 'outline',
    reader: 'reader',
    read: 'reader',
    stats: 'stats',
    editor: 'novel',       // 写作页按内容类型再修正
    write: 'novel',
    fun: 'fun',
    games: 'fun',
    music: 'fun',
    calc: 'fun',
    privacy: 'fun',
    collab: 'fun',
    notes: 'fun'
  };

  /** 顶部栏「更多」中心：协作 + 工具 + 娱乐，分组卡片 */
  const FUN_ITEMS = [
    { path: 'games', label: '休闲游戏', sub: '俄罗斯方块 · 贪吃蛇', icon: 'game', group: '娱乐' },
    { path: 'music', label: '音乐创作', sub: '钢琴键 · 谱曲 · 歌词', icon: 'music', group: '娱乐' },
    { path: 'calc', label: '计算器', sub: '标准 · 科学 · 单位换算', icon: 'calc', group: '工具' },
    { path: 'privacy', label: '隐私锁', sub: '给作品单独设密码', icon: 'lock', group: '工具' },
    { path: 'collab', label: '协作与分享', sub: '一起写 · 分享包 · 密友', icon: 'users', group: '协作' }
  ];

  UI.tabOf = function (path) {
    const seg = String(path || '').split('/')[0];
    return TAB_ALIAS[seg] || seg || 'novel';
  };

  /** 标签 → 默认路由 */
  UI.tabHome = function (tab) {
    const map = {
      novel: 'novel', article: 'article', diary: 'diary', outline: 'outline',
      reader: 'reader', stats: 'stats', library: 'novel',
      fun: 'fun', games: 'fun', music: 'fun', calc: 'fun', notes: 'fun'
    };
    return map[tab] || 'novel';
  };

  UI.render = function () {
    /* 页面尚未 init（或异常重载）时直接忽略：不能把整个界面打空 */
    if (!dom.view) return;
    const path = UI.currentPath();
    const found = matchRoute(path);
    if (current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } current.cleanup = null; }

    /* 换页面就收掉弹层：上一页留下的浮层不但会挡住新页面，
       还会让返回键的第一步「只关了个看不见的弹层」。 */
    if (UI.isSheetOpen()) UI.closeSheet();
    if (dom.modalHost && !dom.modalHost.classList.contains('hidden')) UI.closeModal(null);

    const view = dom.view;
    U.clear(view);
    view.scrollTop = 0;
    view.classList.remove('flush');

    if (!found) { UI.go('novel', { replace: true }); return; }

    trackStack(path);          // 页面栈：返回键按它一层层退

    const meta = found.route.opts || {};
    const tab = UI.tabOf(path);
    UI.setTab(tab);
    UI.setChrome({ title: meta.title || '', sub: '', back: found.route.segs.length > 1 && meta.back !== false, flush: !!meta.flush });

    let cleanup = null;
    try {
      cleanup = found.route.handler(view, found.params, found.route);
    } catch (e) {
      console.error('[view]', e);
      U.append(view, U.el('div.empty', {}, [
        U.icon('close'),
        U.el('div.empty-title', { text: '页面出错了' }),
        U.el('p', { text: String(e && e.message || e) }),
        U.el('button.btn', { text: '回到小说', onclick: () => UI.go('novel') })
      ]));
    }
    current = { route: found.route, params: found.params, cleanup: typeof cleanup === 'function' ? cleanup : null };
    UI.renderTabGoal();
    if (UI.syncMe) { try { UI.syncMe(); } catch (e) { /* 头像同步失败不影响渲染 */ } }
  };

  UI.setChrome = function (o) {
    if (o.title !== undefined) dom.title.textContent = o.title || '';
    if (o.sub !== undefined) dom.sub.textContent = o.sub || '';
    if (o.back !== undefined) dom.back.classList.toggle('hidden', !o.back);
    if (o.flush !== undefined) dom.view.classList.toggle('flush', !!o.flush);
  };
  UI.setTitle = function (t, sub) { dom.title.textContent = t || ''; if (sub !== undefined) dom.sub.textContent = sub || ''; };
  UI.setSub = function (s) { dom.sub.textContent = s || ''; };

  /* ================================================================== */
  /* 今日创作详情                                                      */
  /* ================================================================== */
  UI.todaySheet = function () {
    const st = Store.state;
    const s = global.Stats.summary(st);
    const t = s.today;
    const goal = s.goal || 0;
    const MODULE_NAME = { novel: '小说', article: '文章', diary: '日记', reading: '阅读' };
    const rows = ['novel', 'article', 'diary'].map((k) => ({
      label: MODULE_NAME[k],
      sub: U.fmtInt((t.byModule && t.byModule[k]) || 0) + ' 字'
    }));
    if ((t.byModule && t.byModule.reading) || (st.stats.modules.reading.ms)) {
      /* 阅读时长单独展示 */
    }
    UI.sheet({
      title: '今日创作',
      body: (host) => {
        U.append(host, [
          U.el('div.card', {}, [
            U.el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } }, [
              U.el('div', { text: U.fmtInt(t.words) + ' 字', style: { fontSize: '24px', fontWeight: '700' } }),
              goal ? U.el('span.badge' + (t.words >= goal ? '.ok' : ''), { text: t.words >= goal ? '已达标' : '目标 ' + U.fmtInt(goal) }) : null
            ]),
            U.el('div', { style: { marginTop: '10px' } }, UI.progressBar(goal ? U.clamp(t.words / goal, 0, 1) : 0)),
            U.el('div', {
              text: U.pick('创作时长 ' + U.fmtDuration(t.ms / 60000, { short: true }) + ' · 连续创作 ' + s.streak + ' 天', U.fmtDuration(t.ms / 60000, { short: true }) + ' writing · ' + s.streak + '-day streak'),
              style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '9px' }
            })
          ]),
          U.el('div.section-title', {}, [U.icon('grid', 'ico-sm'), U.el('span', { text: '今日分模块' })]),
          U.el('div.list', {}, rows.map((r) => U.el('div.row', {}, [
            U.el('div.row-main', {}, [U.el('div.row-title', { text: r.label }), U.el('div.row-sub', { text: r.sub })])
          ]))),
          U.el('div.grid2', { style: { marginTop: '14px' } }, [
            U.el('button.btn', { onclick: () => { UI.closeSheet(); UI.go('stats'); } }, [U.icon('chart', 'ico-sm'), U.el('span', { text: '完整统计' })]),
            U.el('button.btn', { onclick: () => { UI.closeSheet(); UI.go('stats/achievements'); } }, [U.icon('trophy', 'ico-sm'), U.el('span', { text: '成就' })])
          ])
        ]);
      }
    });
  };

  UI.setTab = function (tab) {
    /* 底部导航只有五个创作模块；工具/协作/娱乐走顶部栏，进入时点亮「更多」 */
    U.$$('.tab', dom.tabbar).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const funBtn = document.getElementById('navFun');
    if (funBtn) funBtn.classList.toggle('active', tab === 'fun');
    const statsBtn = document.getElementById('navStats');
    if (statsBtn) statsBtn.classList.toggle('active', tab === 'stats');
  };

  /** 顶部栏「更多」面板：按 娱乐 / 工具 / 协作 分组 */
  UI.funSheet = function () {
    UI.sheet({
      title: '更多功能',
      body: (host) => {
        const groups = ['协作', '工具', '娱乐'];
        groups.forEach((g) => {
          const list = FUN_ITEMS.filter((f) => f.group === g);
          if (!list.length) return;
          U.append(host, U.el('div.section-title', {}, [U.el('span', { text: g })]));
          const box = U.el('div.list');
          list.forEach((f) => {
            box.appendChild(U.el('div.row', {
              onclick: () => { UI.closeSheet(); UI.go(f.path); }
            }, [
              U.el('div.row-ico', {}, U.icon(f.icon)),
              U.el('div.row-main', {}, [
                U.el('div.row-title', { text: f.label }),
                U.el('div.row-sub', { text: f.sub })
              ]),
              U.icon('chevron', 'ico-sm')
            ]));
          });
          U.append(host, box);
        });
        U.append(host, U.el('div.field-note', {
          style: { marginTop: '14px' },
          text: '统计与成就在顶部栏的图表按钮里。所有功能都只读写本机数据。'
        }));
      }
    });
  };

  /* 「更多」页：与顶部面板同一批入口，方便从别处跳回来 */
  UI.route('fun', function (view) {
    UI.setTitle('更多功能', '协作 · 工具 · 娱乐');
    const groups = ['协作', '工具', '娱乐'];
    groups.forEach((g) => {
      const list = FUN_ITEMS.filter((f) => f.group === g);
      if (!list.length) return;
      U.append(view, U.el('div.section-title', {}, [U.el('span', { text: g })]));
      const grid = U.el('div.games-grid');
      list.forEach((f) => {
        grid.appendChild(U.el('button.game-card', { onclick: () => UI.go(f.path) }, [
          U.el('div.game-card-ico', {}, U.icon(f.icon)),
          U.el('div.game-card-name', { text: f.label }),
          U.el('div.game-card-sub', { text: f.sub })
        ]));
      });
      U.append(view, grid);
    });
    const st = Store.state;
    const bits = [];
    if (UI.notesApi) bits.push('便签 ' + UI.notesApi.totalCount() + ' 条');
    if (global.Collab) {
      const c = global.Collab.state();
      if (c.room) bits.push('房间 ' + c.room);
      if (c.works.length) bits.push('协作作品 ' + c.works.length + ' 部');
    }
    const songs = (st.settings.songs || []).length;
    if (songs) bits.push('曲子 ' + songs + ' 首');
    const best = st.settings.gameBest || {};
    if (best.snake || best.tetris) bits.push('贪吃蛇 ' + (best.snake || 0) + ' · 方块 ' + (best.tetris || 0));
    if (bits.length) {
      U.append(view, U.el('div.card', { style: { marginTop: '12px' } }, [
        U.el('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.9' }, text: bits.join(' · ') })
      ]));
    }
  });

  /** 今日创作进度胶囊（顶部栏）：显示今天字数、目标百分比与本次写作时长 */
  let goalTimer = null;
  UI.renderTabGoal = function () {
    clearInterval(goalTimer);
    const tick = () => {
      const st = Store.state;
      if (!st || !dom.todayWords) return;
      const t = global.Stats.today(st);
      const goal = st.settings.dailyGoalWords || 0;
      const pct = goal ? U.clamp(t.words / goal, 0, 1) : 0;
      const sec = global.Stats.sessionElapsedMs();
      const live = sec > 4000 ? ' · ' + U.fmtClock(sec / 1000) : '';
      dom.todayWords.textContent = '今日 ' + U.fmtNum(t.words) + ' 字' + (goal ? ' · ' + Math.round(pct * 100) + '%' : '') + live;
      if (dom.todayProgress) dom.todayProgress.firstChild.style.width = Math.round(pct * 100) + '%';
      if (dom.todayChip) dom.todayChip.classList.toggle('done', !!goal && pct >= 1);
    };
    tick();
    // 写作相关页面高频刷新，其它页面低频刷新
    const fast = /^(editor|write|diary|outline)/.test(UI.currentPath());
    goalTimer = setInterval(tick, fast ? 1000 : 8000);
  };

  /* ================================================================== */
  /* 加载遮罩：导入这类耗时操作期间挡住界面，避免乱按导致跳转             */
  /* ================================================================== */
  let busyEl = null;
  let busyTimer = null;

  /**
   * 遮罩期间的「拦截器」必须挂在捕获阶段：
   * 只靠 mask 上的 stopPropagation 是不够的 —— 事件到达目标（比如别的标签按钮）
   * 时它自己的处理函数照样会跑。捕获阶段在 document 上拦下来才真的挡得住。
   */
  function busyGuard(e) {
    if (!busyEl) return;
    /* 遮罩内部的滚动允许 */
    if (e.type === 'wheel' && busyEl.contains(e.target)) return;
    e.stopPropagation();
    e.preventDefault();
  }
  function installBusyGuard(on) {
    const evs = ['click', 'pointerdown', 'touchstart', 'wheel', 'keydown'];
    evs.forEach((ev) => {
      if (on) document.addEventListener(ev, busyGuard, true);
      else document.removeEventListener(ev, busyGuard, true);
    });
  }

  /**
   * UI.busy(title, sub) → 返回 { update(sub, pct), done() }
   * 遮罩会吃掉所有点击（防止用户在导入中途切页），并显示旋转动画与进度。
   */
  UI.busy = function (title, sub) {
    UI.busyDone();
    const spinner = U.el('div.busy-spin');
    const titleEl = U.el('div.busy-title', { text: title || '正在处理…' });
    const subEl = U.el('div.busy-sub', { text: sub || '' });
    const barFill = U.el('i');
    const bar = U.el('div.busy-bar', {}, [barFill]);
    const tipEl = U.el('div.busy-tip', { text: '处理期间请不要操作，完成后会自动打开' });
    busyEl = U.el('div.busy-mask', {
      role: 'alertdialog', 'aria-busy': 'true', 'aria-live': 'polite'
    }, [U.el('div.busy-card', {}, [spinner, titleEl, subEl, bar, tipEl])]);
    /* 遮罩自身也吃掉事件（双保险：捕获阶段 + 元素自身） */
    ['click', 'pointerdown', 'touchstart', 'wheel'].forEach((ev) => {
      busyEl.addEventListener(ev, (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false });
    });
    document.body.appendChild(busyEl);
    installBusyGuard(true);
    /* 稍等 120ms 再显示进度条，短任务不闪 */
    const started = Date.now();
    busyTimer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      if (s >= 3) {
        tipEl.textContent = '已处理 ' + s + ' 秒…大文件会慢一些，请稍候';
      }
    }, 1000);
    return {
      update: (s, pct) => {
        if (s !== undefined && s !== null) subEl.textContent = s;
        if (typeof pct === 'number') barFill.style.width = Math.max(0, Math.min(1, pct)) * 100 + '%';
      },
      done: UI.busyDone
    };
  };

  UI.busyDone = function () {
    if (busyTimer) { clearInterval(busyTimer); busyTimer = null; }
    installBusyGuard(false);
    if (busyEl && busyEl.parentNode) busyEl.parentNode.removeChild(busyEl);
    busyEl = null;
  };

  UI.isBusy = function () { return !!busyEl; };

  /* ================================================================== */
  /* 吐司                                                              */
  /* ================================================================== */
  UI.toast = function (msg, iconName, ms) {
    const node = U.el('div.toast', {}, [U.icon(iconName || 'check', 'ico-sm'), U.el('span', { text: msg })]);
    dom.toastHost.appendChild(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 300);
    }, ms || 2100);
    return node;
  };

  UI.achievementToast = function (rule) {
    const node = U.el('div.toast.ach', {}, [
      U.icon(rule.icon || 'trophy', 'ico-sm'),
      U.el('div', {}, [
        U.el('div', { text: '成就解锁 · ' + rule.title, style: { fontWeight: '650' } }),
        U.el('div', { text: rule.desc, style: { fontSize: '11.5px', opacity: '.85' } })
      ])
    ]);
    dom.toastHost.appendChild(node);
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 300);
    }, 3200);
  };

  /* ================================================================== */
  /* 底部抽屉                                                          */
  /* ================================================================== */
  let sheetOnClose = null;

  /**
   * UI.sheet({ title, body, footer:[{label,primary,onClick,close}], onClose, onMount })
   * body 可以是 Node 或 (host) => void
   */
  UI.sheet = function (opts) {
    const o = opts || {};
    dom.sheetTitle.textContent = o.title || '';
    U.clear(dom.sheetBody);
    U.clear(dom.sheetFoot);
    if (typeof o.body === 'function') o.body(dom.sheetBody);
    else if (o.body) U.append(dom.sheetBody, o.body);

    (o.footer || []).forEach((btn) => {
      const b = U.el('button.btn' + (btn.primary ? '.primary' : '') + (btn.danger ? '.danger' : '') + (btn.ghost ? '.ghost' : ''), {
        text: btn.label,
        onclick: () => {
          const keep = btn.onClick && btn.onClick();
          if (keep === true) return;
          if (btn.close !== false) UI.closeSheet();
        }
      });
      if (btn.disabled) b.disabled = true;
      dom.sheetFoot.appendChild(b);
    });

    dom.sheetHost.classList.remove('hidden');
    dom.sheetHost.setAttribute('aria-hidden', 'false');
    sheetOnClose = o.onClose || null;
    if (o.onMount) o.onMount(dom.sheetBody);
    if (o.autoFocus) {
      const f = dom.sheetBody.querySelector('input,textarea,select');
      if (f) setTimeout(() => { try { f.focus(); } catch (e) { /* noop */ } }, 220);
    }
    return {
      body: dom.sheetBody,
      close: UI.closeSheet,
      setTitle: (t) => { dom.sheetTitle.textContent = t; },
      setFooter: (btns) => {
        U.clear(dom.sheetFoot);
        (btns || []).forEach((btn) => dom.sheetFoot.appendChild(U.el('button.btn' + (btn.primary ? '.primary' : ''), { text: btn.label, onclick: btn.onClick })));
      }
    };
  };

  UI.closeSheet = function () {
    if (dom.sheetHost.classList.contains('hidden')) return;
    dom.sheetHost.classList.add('hidden');
    dom.sheetHost.setAttribute('aria-hidden', 'true');
    U.clear(dom.sheetBody);
    U.clear(dom.sheetFoot);
    const cb = sheetOnClose;
    sheetOnClose = null;
    if (cb) { try { cb(); } catch (e) { console.error(e); } }
  };

  UI.isSheetOpen = () => !dom.sheetHost.classList.contains('hidden');

  /* ================================================================== */
  /* 对话框                                                            */
  /* ================================================================== */
  UI.modal = function (opts) {
    const o = opts || {};
    dom.modalTitle.textContent = o.title || '提示';
    U.clear(dom.modalBody);
    U.clear(dom.modalFoot);
    if (typeof o.body === 'function') { const node = o.body(dom.modalBody); if (node && node.nodeType) U.append(dom.modalBody, node); }
    else if (o.body) U.append(dom.modalBody, o.body);

    return new Promise((resolve) => {
      const close = (val) => {
        dom.modalHost.classList.add('hidden');
        dom.modalHost.setAttribute('aria-hidden', 'true');
        resolve(val);
      };
      (o.buttons || [{ label: '好', primary: true, value: true }]).forEach((b) => {
        dom.modalFoot.appendChild(U.el('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : '') + (b.ghost ? '.ghost' : ''), {
          text: b.label,
          onclick: () => close(b.value === undefined ? b.label : b.value)
        }));
      });
      dom.modalHost.classList.remove('hidden');
      dom.modalHost.setAttribute('aria-hidden', 'false');
      dom.modalHost._resolve = close;
      if (o.autoFocus) {
        const f = dom.modalBody.querySelector('input,textarea,select');
        if (f) setTimeout(() => { try { f.focus(); f.select && f.select(); } catch (e) { /* noop */ } }, 200);
      }
    });
  };

  UI.closeModal = function (val) {
    const fn = dom.modalHost._resolve;
    if (fn) { dom.modalHost._resolve = null; fn(val === undefined ? null : val); }
  };

  UI.alert = function (title, message, okLabel) {
    return UI.modal({
      title: title,
      body: () => U.el('div', { text: message }),
      buttons: [{ label: okLabel || '知道了', primary: true, value: true }]
    });
  };

  UI.confirm = function (title, message, okLabel, danger) {
    return UI.modal({
      title: title,
      body: () => U.el('div', { text: message || '' }),
      buttons: [
        { label: '取消', value: false, ghost: true },
        { label: okLabel || '确定', primary: !danger, danger: !!danger, value: true }
      ]
    }).then((v) => v === true);
  };

  /** 文本输入对话框 */
  UI.prompt = function (opts) {
    const o = opts || {};
    let input;
    const commitVal = () => {
      const v = input ? input.value : '';
      UI.closeModal(v.trim());
    };
    return UI.modal({
      title: o.title || '输入',
      body: (host) => {
        U.append(host, [o.message ? U.el('div', { text: o.message, style: { marginBottom: '4px' } }) : null]);
        if (o.multiline) {
          input = U.el('textarea.textarea', { value: o.value || '', placeholder: o.placeholder || '', rows: o.rows || 5 });
        } else {
          input = U.el('input.input', { type: o.type || 'text', value: o.value || '', placeholder: o.placeholder || '' });
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitVal(); } });
        }
        U.append(host, input);
      },
      buttons: [
        { label: '取消', value: null, ghost: true },
        { label: o.okLabel || '确定', primary: true, value: undefined, onclick: undefined }
      ],
      autoFocus: true
    }).then((v) => {
      // 主按钮返回值需读取输入框，这里用特殊处理
      return v;
    });
  };

  /** 更可靠的输入框（自己控制按钮） */
  UI.input = function (opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      let input;
      const host = U.el('div');
      if (o.message) U.append(host, U.el('div', { text: o.message, style: { marginBottom: '8px' } }));
      if (o.multiline) {
        input = U.el('textarea.textarea', { placeholder: o.placeholder || '', rows: o.rows || 5 });
        input.value = o.value || '';
      } else {
        input = U.el('input.input', { type: o.type || 'text', placeholder: o.placeholder || '' });
        input.value = o.value || '';
      }
      U.append(host, input);
      if (o.hint) U.append(host, U.el('div', { text: o.hint, style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '7px' } }));
      UI.modal({
        title: o.title || '输入',
        body: host,
        buttons: [
          { label: '取消', value: '__cancel', ghost: true },
          { label: o.okLabel || '确定', primary: true, value: '__ok' }
        ],
        autoFocus: true
      }).then((v) => resolve(v === '__ok' ? String(input.value || '').trim() : null));
    });
  };

  /** 选择列表对话框：items [{label, value, sub, icon}] */
  UI.choose = function (opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const host = U.el('div.list');
      (o.items || []).forEach((it) => {
        const row = U.el('div.row.tap', {
          onclick: () => { UI.closeModal(it.value); }
        }, [
          it.icon ? U.el('span.row-chev', {}, U.icon(it.icon)) : null,
          U.el('div.row-main', {}, [
            U.el('div.row-title', { text: it.label }),
            it.sub ? U.el('div.row-sub', { text: it.sub }) : null
          ]),
          it.badge ? U.el('span.badge', { text: it.badge }) : null
        ]);
        host.appendChild(row);
      });
      U.append(host, U.el('div.row.tap', { onclick: () => UI.closeModal(null) }, [U.el('div.row-main', {}, U.el('div.row-title', { text: '取消', style: { color: 'var(--text-3)' } }))]));
      UI.modal({ title: o.title || '请选择', body: host, buttons: [] }).then((v) => resolve(v === undefined ? null : v));
    });
  };

  /* ================================================================== */
  /* 亮度面板                                                          */
  /* ================================================================== */
  UI.toggleBrightness = function (force) {
    const show = force === undefined ? dom.brightPanel.classList.contains('hidden') : !!force;
    dom.brightPanel.classList.toggle('hidden', !show);
    dom.brightPanel.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (show) syncBrightnessPanel();
  };

  function syncBrightnessPanel() {
    const st = Store.state;
    if (!st) return;
    dom.brightRange.value = String(st.settings.brightness);
    const btn = dom.brightThemeToggle;
    const theme = document.documentElement.getAttribute('data-theme');
    btn.textContent = theme === 'dark' ? '浅色模式' : '深色模式';
    dom.brightWarm.classList.toggle('active', !!st.settings.warm);
    dom.brightAuto.classList.toggle('active', st.settings.themeMode === 'auto');
  }
  UI.syncBrightnessPanel = syncBrightnessPanel;

  /* ================================================================== */
  /* 全局搜索                                                          */
  /* ================================================================== */
  function buildIndex() {
    const st = Store.state;
    const idx = [];
    (st.novels || []).forEach((n) => {
      idx.push({ kind: 'novel', id: n.id, title: n.title, sub: '小说 · ' + (n.chapters || []).length + ' 章', hash: 'editor/' + n.id, text: (n.title || '') + ' ' + (n.intro || '') });
      (n.chapters || []).forEach((c) => {
        idx.push({ kind: 'chapter', id: c.id, novelId: n.id, title: c.title || '（未命名章节）', sub: n.title + ' · ' + U.fmtInt(c.words || 0) + ' 字', hash: 'editor/' + n.id + '/' + c.id, text: (c.title || '') + ' ' + (c.content || '') });
        (c.sections || []).forEach((sec) => {
          idx.push({ kind: 'section', id: sec.id, novelId: n.id, chapterId: c.id, title: (c.title || '') + ' § ' + (sec.title || '小节'), sub: n.title + ' · 小节', hash: 'editor/' + n.id + '/' + c.id + '/' + sec.id, text: (sec.title || '') + ' ' + (sec.content || '') });
        });
      });
      (n.outline || []).forEach(function walk(nodes) {
        if (!Array.isArray(nodes)) return;
        nodes.forEach((nd) => {
          if (!nd || typeof nd !== 'object') return;
          idx.push({ kind: 'outline', id: nd.id, novelId: n.id, title: U.excerpt(nd.text, 40) || '（空大纲）', sub: '大纲 · ' + n.title, hash: 'outline/' + n.id + '/' + nd.id, text: (nd.text || '') + ' ' + (nd.note || '') });
          walk(nd.children);
        });
      });
    });
    (st.articles || []).forEach((a) => {
      idx.push({ kind: 'article', id: a.id, title: a.title, sub: '文章 · ' + U.fmtInt(Store.articleWords(a)) + ' 字', hash: 'editor/' + a.id, text: (a.title || '') + ' ' + (a.content || '') + ' ' + (a.tags || []).join(' ') });
    });
    (st.diaries || []).forEach((bk) => {
      idx.push({ kind: 'diaryBook', id: bk.id, title: bk.title, sub: '日记本 · ' + (bk.entries || []).length + ' 篇', hash: 'diary/' + bk.id, text: bk.title });
      (bk.entries || []).forEach((e) => {
        idx.push({ kind: 'diaryEntry', id: e.id, bookId: bk.id, title: (e.title || U.excerpt(e.content, 30)) || '（空日记）', sub: bk.title + ' · ' + e.dateKey, hash: 'diary/' + bk.id + '/' + e.dateKey + '/' + e.id, text: (e.title || '') + ' ' + (e.content || '') + ' ' + (e.tags || []).join(' ') });
      });
    });
    (st.reading || []).forEach((b) => {
      idx.push({ kind: 'book', id: b.id, title: b.title, sub: '阅读 · ' + (b.chapters || []).length + ' 节', hash: 'read/' + b.id, text: (b.title || '') + ' ' + (b.author || '') });
      (b.chapters || []).forEach((c, i) => {
        idx.push({ kind: 'bookChapter', id: c.id, bookId: b.id, index: i, title: c.title || ('第 ' + (i + 1) + ' 节'), sub: b.title + ' · 读物章节', hash: 'read/' + b.id + '/' + i, text: (c.title || '') + ' ' + (c.content || '') });
      });
    });
    return idx;
  }

  UI.search = function (initial) {
    let results = [];
    const input = U.el('input.input', { type: 'search', placeholder: '搜索作品、章节、大纲、日记、读物…', value: initial || '' });
    const listHost = U.el('div', { style: { marginTop: '12px' } });

    function run(q) {
      q = String(q || '').trim().toLowerCase();
      U.clear(listHost);
      if (q.length < 1) {
        U.append(listHost, U.el('div.kbd-hint', { text: '输入关键词开始搜索 · 全部在本地完成' }));
        return;
      }
      const idx = buildIndex();
      /* 私密作品（未解锁）完全不进搜索结果：否则列表挡住了，搜索又把标题和正文漏出来 */
      const ownerLocked = (it) => {
        const P = global.Privacy;
        if (!P) return false;
        const map = {
          novel: ['novel', it.id], article: ['article', it.id],
          chapter: ['novel', it.novelId], section: ['novel', it.novelId], outline: ['novel', it.novelId],
          diaryBook: ['diaryBook', it.id], diaryEntry: ['diaryBook', it.bookId],
          book: ['book', it.id], bookChapter: ['book', it.bookId]
        };
        const k = map[it.kind];
        if (!k || !k[1]) return false;
        return P.isLocked(k[0], k[1]) && !P.isUnlocked(k[0], k[1]);
      };
      const hits = [];
      idx.forEach((item) => {
        if (ownerLocked(item)) return;
        const hay = (item.text || '').toLowerCase();
        const pos = hay.indexOf(q);
        const titleHit = (item.title || '').toLowerCase().indexOf(q);
        if (pos < 0 && titleHit < 0) return;
        hits.push({ item: item, score: titleHit >= 0 ? 0 : 1, pos: pos });
      });
      hits.sort((a, b) => a.score - b.score);
      results = hits.slice(0, 60);
      if (!results.length) {
        U.append(listHost, U.el('div.empty', {}, [U.icon('search'), U.el('div.empty-title', { text: '没有找到' }), U.el('p', { text: '换个关键词试试' })]));
        return;
      }
      const list = U.el('div.list');
      results.forEach((h) => {
        const it = h.item;
        let snippet = '';
        if (h.pos >= 0 && it.kind !== 'chapter' && it.kind !== 'article' && it.kind !== 'bookChapter') {
          const raw = it.text;
          const start = Math.max(0, h.pos - 18);
          snippet = (start > 0 ? '…' : '') + raw.slice(start, h.pos + q.length + 34).replace(/\s+/g, ' ');
        } else if (h.pos >= 0) {
          const raw = it.text;
          const start = Math.max(0, h.pos - 14);
          snippet = (start > 0 ? '…' : '') + raw.slice(start, h.pos + q.length + 26).replace(/\s+/g, ' ');
        }
        const row = U.el('div.row.tap', {
          onclick: () => { UI.closeSheet(); setTimeout(() => UI.go(it.hash), 60); }
        }, [
          U.el('div.row-main', {}, [
            U.el('div.row-title', { html: highlight(it.title || '', q) }),
            U.el('div.row-sub', {}, [
              U.el('span', { text: it.sub }),
              snippet ? U.el('span', { html: ' · ' + highlight(snippet, q) }) : null
            ])
          ]),
          U.el('span.row-chev', {}, U.icon('chevron', 'ico-sm'))
        ]);
        list.appendChild(row);
      });
      U.append(listHost, [U.el('div', { text: '共 ' + results.length + ' 条结果', style: { fontSize: '11.5px', color: 'var(--text-3)', margin: '0 2px 8px' } }), list]);
    }

    function highlight(text, q) {
      const safe = U.escapeHtml(text || '');
      if (!q) return safe;
      try {
        const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        return safe.replace(re, '<span class="hl">$1</span>');
      } catch (e) { return safe; }
    }

    input.addEventListener('input', U.debounce(() => run(input.value), 160));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(input.value); });

    const s = UI.sheet({
      title: '搜索',
      body: (host) => { U.append(host, input); U.append(host, listHost); },
      autoFocus: true
    });
    setTimeout(() => { try { input.focus(); } catch (e) { /* noop */ } }, 120);
    run(initial || '');
    return s;
  };

  /* ================================================================== */
  /* 通用小部件                                                        */
  /* ================================================================== */
  UI.empty = function (iconName, title, desc, action) {
    return U.el('div.empty', {}, [
      U.icon(iconName || 'doc'),
      U.el('div.empty-title', { text: title || '还没有内容' }),
      desc ? U.el('p', { text: desc }) : null,
      action ? U.el('button.btn.primary', { text: action.label, onclick: action.onClick }) : null
    ]);
  };

  UI.progressBar = function (percent, cls) {
    const bar = U.el('div.bar' + (cls ? '.' + cls : ''), {}, U.el('i'));
    bar.firstChild.style.width = Math.round(U.clamp(percent, 0, 1) * 100) + '%';
    return bar;
  };

  /** 环形进度（成就总览用） */
  UI.ring = function (percent, text) {
    const p = U.clamp(percent, 0, 1);
    const r = 28, c = 2 * Math.PI * r;
    const wrap = U.el('div.ring');
    wrap.innerHTML =
      '<svg width="68" height="68" viewBox="0 0 68 68">' +
      '<circle cx="34" cy="34" r="' + r + '" fill="none" stroke="var(--surface-2)" stroke-width="6"></circle>' +
      '<circle cx="34" cy="34" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - p)).toFixed(1) + '"></circle>' +
      '</svg>';
    U.append(wrap, U.el('div.ring-txt', { text: text }));
    return wrap;
  };

  /** 迷你柱状图：data [{key,words,ms}] */
  UI.barChart = function (data, opt) {
    const o = opt || {};
    const W = 300, H = 110, padB = 16;
    const max = Math.max(1, Math.max.apply(null, data.map((d) => d.words)));
    const bw = W / Math.max(1, data.length);
    const bars = data.map((d, i) => {
      const h = (d.words / max) * (H - padB);
      const x = i * bw + bw * 0.16;
      const y = H - padB - h;
      const w = bw * 0.68;
      const isToday = i === data.length - 1;
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(d.words > 0 ? 2 : 0, h).toFixed(1) + '" rx="' + Math.min(3, w / 2).toFixed(1) + '" fill="' + (isToday ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 45%, transparent)') + '"></rect>';
    }).join('');
    const svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<line x1="0" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" stroke="var(--line)" stroke-width="1"></line>' +
      bars + '</svg>';
    const wrap = U.el('div');
    wrap.innerHTML = svg;
    return wrap;
  };

  /** 热力图（近 15 周） */
  UI.heatmap = function (daily, weeks) {
    const n = weeks || 15;
    const cells = [];
    const today = new Date();
    const day = (today.getDay() + 6) % 7;
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - day + 6);
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (n * 7 - 1));
    let max = 1;
    Object.keys(daily || {}).forEach((k) => { max = Math.max(max, daily[k].words || 0); });
    for (let i = 0; i < n * 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = U.dateKey(d);
      const rec = (daily || {})[key];
      const w = rec ? (rec.words || 0) : 0;
      const lv = w === 0 ? 0 : Math.min(4, Math.ceil((w / max) * 4));
      const future = d > today;
      cells.push('<i class="' + (future ? '' : (lv ? 'l' + lv : '')) + '" title="' + key + ' · ' + U.fmtInt(w) + ' 字"' + (future ? ' style="opacity:.25"' : '') + '></i>');
    }
    const wrap = U.el('div.heat');
    wrap.innerHTML = cells.join('');
    return wrap;
  };

  UI.switchRow = function (label, sub, on, onChange) {
    const t = U.el('div.toggle' + (on ? '.on' : ''));
    const row = U.el('div.switch', { onclick: () => { const next = !t.classList.contains('on'); t.classList.toggle('on', next); onChange(next); } }, [
      U.el('div', {}, [U.el('div.sw.label', { text: label }), sub ? U.el('div.sw-sub', { text: sub }) : null]),
      t
    ]);
    return row;
  };

  UI.chipRow = function (items, activeId, onPick) {
    const wrap = U.el('div.chips.scroll');
    items.forEach((it) => {
      const c = U.el('button.chip' + (it.id === activeId ? '.active' : ''), {
        text: it.label,
        onclick: () => onPick(it.id)
      });
      wrap.appendChild(c);
    });
    return wrap;
  };

  /* ================================================================== */
  /* 成就面板（各模块共用）                                            */
  /* ================================================================== */
  UI.achievementCard = function (entry, ctx) {
    const r = entry.rule, p = entry.prog;
    const card = U.el('div.ach' + (p.unlocked ? '.unlocked' : '.locked'), {
      onclick: () => {
        UI.alert(r.title, r.desc + '\n\n进度：' + (r.fmt ? r.fmt(p.value) : U.fmtInt(p.value)) + ' / ' + (r.fmt ? r.fmt(p.target) : U.fmtInt(r.target)) + (p.unlocked ? '\n解锁时间：' + U.fmtDateTime(p.at) : ''));
      }
    }, [
      U.el('div.medal', {}, U.icon(p.unlocked ? r.icon || 'trophy' : 'target')),
      U.el('div.ach-name', { text: r.title }),
      U.el('div.ach-desc', { text: r.desc }),
      !p.unlocked ? UI.progressBar(p.percent, 'thin') : null,
      p.unlocked ? U.el('div.ach-date', { text: U.fmtWhen(p.at) }) : U.el('div.ach-desc', { text: Math.round(p.percent * 100) + '%' })
    ]);
    return card;
  };

  UI.achievementPanel = function (host, opt) {
    const o = opt || {};
    const state = Store.state;
    const data = global.Ach.byGroup(state);
    const unlocked = global.Ach.unlockedCount(state);
    const total = global.Ach.totalCount();
    const streak = global.Ach.currentStreak(state);

    U.clear(host);
    U.append(host, U.el('div.card', {}, [
      U.el('div.progress-hero', {}, [
        UI.ring(unlocked / Math.max(1, total), Math.round((unlocked / Math.max(1, total)) * 100) + '%'),
        U.el('div', { style: { flex: '1 1 auto' } }, [
          U.el('div', { text: '已解锁 ' + unlocked + ' / ' + total + ' 项成就', style: { fontWeight: '650', fontSize: '15px' } }),
          U.el('div', { text: '连续记录 ' + streak + ' 天 · 成就只增不减', style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '4px' } }),
          U.el('div', {}, U.el('div.bar', { style: { marginTop: '9px' } }, (() => { const i = U.el('i'); i.style.width = (unlocked / Math.max(1, total) * 100).toFixed(1) + '%'; return i; })()))
        ])
      ])
    ]));

    const groups = o.groups && o.groups.length ? o.groups : global.Ach.groups.map((g) => g.id);
    groups.forEach((gid) => {
      const g = global.Ach.groups.find((x) => x.id === gid) || { name: gid, icon: 'star' };
      const list = data.groups[gid] || [];
      if (!list.length) return;
      const got = list.filter((x) => x.prog.unlocked).length;
      const head = U.el('div.ach-section-head', {}, [
        U.icon(g.icon, 'ico-sm'),
        U.el('strong', { text: g.name, style: { fontSize: '14px' } }),
        U.el('span.n', { text: got + ' / ' + list.length }),
        U.el('span', { style: { flex: '1 1 auto' } }),
        o.collapse ? U.el('button.chip', {
          text: '展开', onclick: (e) => {
            const wrapNode = e.target.closest('.ach-group').querySelector('.ach-grid');
            const hid = wrapNode.classList.toggle('hidden');
            e.target.textContent = hid ? '展开' : '收起';
          }
        }) : null
      ]);
      const grid = U.el('div.ach-grid' + (o.collapse && got === 0 ? '.hidden' : ''));
      const showUnlockedFirst = list.slice().sort((a, b) => (a.prog.unlocked === b.prog.unlocked ? a.rule.target - b.rule.target : (a.prog.unlocked ? -1 : 1)));
      const limited = o.limit ? showUnlockedFirst.slice(0, got === 0 ? o.limit : Math.max(o.limit, got)) : showUnlockedFirst;
      limited.forEach((entry) => grid.appendChild(UI.achievementCard(entry, data.ctx)));
      U.append(host, U.el('div.ach-group', {}, [
        U.el('div.section-title', {}, [head]),
        grid
      ]));
    });
    return host;
  };

  /* ================================================================== */
  /* 初始化                                                            */
  /* ================================================================== */
  UI.init = function () {
    dom.view = document.getElementById('view');
    dom.title = document.getElementById('viewTitle');
    dom.sub = document.getElementById('viewSub');
    dom.back = document.getElementById('navBack');
    dom.todayChip = document.getElementById('todayChip');
    dom.todayWords = document.getElementById('todayWords');
    dom.todayProgress = document.getElementById('todayProgress');
    dom.tabbar = document.getElementById('tabbar');
    dom.toastHost = document.getElementById('toastHost');
    dom.sheetHost = document.getElementById('sheetHost');
    dom.sheetTitle = document.getElementById('sheetTitle');
    dom.sheetBody = document.getElementById('sheetBody');
    dom.sheetFoot = document.getElementById('sheetFoot');
    dom.modalHost = document.getElementById('modalHost');
    dom.modalTitle = document.getElementById('modalTitle');
    dom.modalBody = document.getElementById('modalBody');
    dom.modalFoot = document.getElementById('modalFoot');
    dom.brightPanel = document.getElementById('brightnessPanel');
    dom.brightRange = document.getElementById('brightnessRange');
    dom.brightThemeToggle = document.getElementById('brightThemeToggle');
    dom.brightWarm = document.getElementById('brightWarm');
    dom.brightAuto = document.getElementById('brightAuto');
    UI.dom = dom;

    U.hydrateStaticIcons(document);

    // 顶部栏
    dom.back.addEventListener('click', () => UI.back());
    /* 「我的」按钮：显示头像 / 状态表情，没注册时带一个小红点 */
    dom.meBtn = document.getElementById('navMe');
    dom.meFace = document.getElementById('navMeFace');
    dom.meDot = document.getElementById('navMeDot');
    UI.syncMe = function () {
      if (!dom.meFace || !global.Profile || !Store.state) return;
      const p = Store.profile();
      const active = Store.activeStatus();
      const av = Store.avatarOf(p);
      dom.meFace.textContent = active && active.emoji ? active.emoji
        : (av.kind === 'emoji' ? av.text : (av.kind === 'text' ? av.text : '我'));
      dom.meFace.classList.toggle('has-img', av.kind === 'img');
      dom.meFace.style.backgroundImage = av.kind === 'img' ? 'url(' + av.src + ')' : '';
      if (dom.meDot) dom.meDot.classList.toggle('hidden', !!Store.isRegistered());
      if (dom.meBtn) dom.meBtn.title = Store.isRegistered() ? (p.name + (active ? ' · ' + active.text : '')) : '点这里注册一个名字';
    };
    if (dom.meBtn) dom.meBtn.addEventListener('click', () => UI.go('me'));
    document.getElementById('navSearch').addEventListener('click', () => UI.search());
    document.getElementById('navBrightness').addEventListener('click', (e) => { e.stopPropagation(); UI.toggleBrightness(); });
    const funBtn = document.getElementById('navFun');
    if (funBtn) funBtn.addEventListener('click', () => UI.funSheet());
    const statsBtn = document.getElementById('navStats');
    if (statsBtn) statsBtn.addEventListener('click', () => UI.go('stats'));
    if (dom.todayChip) dom.todayChip.addEventListener('click', () => UI.todaySheet());

    // 底部导航
    U.$$('.tab', dom.tabbar).forEach((b) => {
      b.addEventListener('click', () => {
        const t = b.dataset.tab;
        if (Store.state) Store.setSetting('lastTab', t);
        UI.go(t);
      });
    });

    // 亮度面板交互
    dom.brightRange.addEventListener('input', () => {
      const v = Number(dom.brightRange.value);
      Store.setSetting('brightness', v);
    });
    dom.brightThemeToggle.addEventListener('click', () => { Store.toggleTheme(); syncBrightnessPanel(); });
    dom.brightWarm.addEventListener('click', () => {
      Store.setSetting('warm', !Store.state.settings.warm);
      syncBrightnessPanel();
    });
    dom.brightAuto.addEventListener('click', () => {
      const st = Store.state.settings;
      Store.patchSettings({ themeMode: st.themeMode === 'auto' ? 'manual' : 'auto' });
      Store.applyTheme();
      syncBrightnessPanel();
    });

    // 弹层关闭
    U.$$('[data-close]', dom.sheetHost).forEach((n) => n.addEventListener('click', () => UI.closeSheet()));
    U.$$('[data-close]', dom.modalHost).forEach((n) => n.addEventListener('click', () => UI.closeModal(null)));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (UI.isSheetOpen()) UI.closeSheet();
        else if (!dom.modalHost.classList.contains('hidden')) UI.closeModal(null);
        else if (!dom.brightPanel.classList.contains('hidden')) UI.toggleBrightness(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); UI.search(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); Store.flushNow().then(() => UI.toast('已保存到本机', 'check')); }
    });

    document.addEventListener('click', (e) => {
      if (dom.brightPanel.classList.contains('hidden')) return;
      if (dom.brightPanel.contains(e.target)) return;
      if (e.target.closest && e.target.closest('#navBrightness')) return;
      UI.toggleBrightness(false);
    }, true);

    // 系统主题变化
    try {
      global.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (Store.state && Store.state.settings.themeMode === 'auto') Store.applyTheme();
      });
    } catch (e) { /* noop */ }

    // 数据变更 → 更新顶部副标题
    Store.subscribe(() => {
      if (!/^(editor|write)/.test(UI.currentPath())) UI.renderTabGoal();
    });

    global.addEventListener('hashchange', () => UI.render());
  };

  UI.start = function () {
    if (!UI.currentPath()) {
      const last = UI.tabHome(Store.state.settings.lastTab || 'novel');
      location.replace('#/' + last);
      return;
    }
    UI.render();
  };

  UI.dom = dom;
  global.UI = UI;
})(window);
