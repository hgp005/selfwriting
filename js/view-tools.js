/* ==========================================================================
   selfwriting · view-tools.js
   写作侧栏「功能库」：写作时从侧边拉开，不打断正文
     · 便签：灵感 / 注释 / 待办 / 牢骚，可一键插入正文光标处
     · 大纲：本书大纲树，点章节可直接跳过去对照
     · 排版：字号 / 行距 / 字体 / 缩进，改完立即生效
     · 目标：本章与今日字数目标

   宽屏（≥ 900px）从右侧滑出，窄屏变成底部抽屉 —— 手机上更好操作。
   挂载点是 body，所以切换视图不会把它算进正文布局。
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const Store = global.Store;
  const UI = global.UI;

  let host = null;          // 侧栏根节点
  let ctx = null;           // 当前写作上下文
  let activeTab = 'notes';

  /* ================================================================== */
  /* 侧栏骨架                                                          */
  /* ================================================================== */
  function ensureHost() {
    if (host) return host;
    host = U.el('div.tool-side', { 'aria-hidden': 'true' });
    U.append(host, [
      U.el('div.tool-side-head', {}, [
        U.el('div.tool-side-title', { text: '写作功能库' }),
        U.el('button.icon-btn', { onclick: () => close(), 'aria-label': '收起' }, U.icon('close'))
      ]),
      U.el('div.tool-side-tabs')
    ]);
    document.body.appendChild(host);
    return host;
  }

  function isOpen() { return !!host && host.classList.contains('open'); }

  function open(context) {
    ctx = context || ctx;
    if (!ctx) return;
    const h = ensureHost();
    render();
    h.classList.add('open');
    h.setAttribute('aria-hidden', 'false');
    document.body.classList.add('tool-side-open');
    /* 正文失焦时也把光标位置记下来，插入便签才能回到原处 */
    if (ctx.textarea) {
      try { ctx.textarea.addEventListener('blur', ctx.rememberSel); } catch (e) { /* noop */ }
    }
    if (ctx.onNotesChanged) { try { ctx.onNotesChanged(); } catch (e) { /* noop */ } }
  }

  function close() {
    if (!host) return;
    host.classList.remove('open');
    host.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('tool-side-open');
    if (ctx && ctx.onClose) { try { ctx.onClose(); } catch (e) { /* noop */ } }
  }

  function toggle(context) {
    if (isOpen()) close();
    else open(context);
  }

  /* ================================================================== */
  /* 渲染：页签 + 当前面板                                              */
  /* ================================================================== */
  const TABS = [
    { id: 'notes', label: '便签', icon: 'bulb' },
    { id: 'outline', label: '大纲', icon: 'tree' },
    { id: 'type', label: '排版', icon: 'text' },
    { id: 'goal', label: '目标', icon: 'target' }
  ];

  function render() {
    const h = ensureHost();
    const tabsRow = h.querySelector('.tool-side-tabs');
    U.clear(tabsRow);
    TABS.forEach((t) => {
      tabsRow.appendChild(U.el('button.tool-tab' + (activeTab === t.id ? '.active' : ''), {
        onclick: () => { activeTab = t.id; render(); }
      }, [U.icon(t.icon, 'ico-sm'), U.el('span', { text: t.label })]));
    });

    /* 面板容器 */
    let body = h.querySelector('.tool-side-body');
    if (!body) {
      body = U.el('div.tool-side-body');
      h.appendChild(body);
    }
    U.clear(body);

    if (activeTab === 'notes') renderNotes(body);
    else if (activeTab === 'outline') renderOutline(body);
    else if (activeTab === 'type') renderType(body);
    else renderGoal(body);
  }

  /* ---------------- 便签 ---------------- */
  function renderNotes(body) {
    const box = U.el('div');
    U.append(body, box);
    UI.notesPanel(box, {
      kind: ctx.noteKind || ctx.kind,
      id: ctx.noteId || ctx.doc.id,
      placeholder: ctx.notePlaceholder || '这里想表达什么、卡在哪、下一步写什么……（Ctrl+Enter 保存）',
      onInsert: (text) => { if (ctx.insertText) ctx.insertText(text); },
      onChange: () => { if (ctx.onChange) ctx.onChange(); }
    });
  }

  /* ---------------- 大纲（本书） ---------------- */
  function renderOutline(body) {
    /* 小说与文章都用 outline 字段挂在大纲树上 */
    const book = ctx.owner || Store.findNovel(ctx.noteId || ctx.doc.id) || Store.findArticle(ctx.noteId || ctx.doc.id);
    if (!book) {
      U.append(body, U.el('div.note-empty', { text: '这本书还没有大纲。到「大纲」模块里建一个，写作时就能在这里对照。' }));
      return;
    }
    const nodes = book.outline || [];
    if (!nodes.length) {
      U.append(body, U.el('div.note-empty', { text: '还没有大纲节点。可以先写一句「这一章要发生什么」，再补细节。' }));
      U.append(body, U.el('button.btn.block', {
        style: { marginTop: '10px' },
        onclick: () => UI.go('outline/' + book.id)
      }, [U.icon('tree', 'ico-sm'), U.el('span', { text: '去写大纲' })]));
      return;
    }

    const wrap = U.el('div.tool-outline');
    let highlighted = 0;
    function walk(list, depth) {
      list.forEach((n) => {
        const linked = n.linkChapterId && ctx.chapterId && n.linkChapterId === ctx.chapterId;
        if (linked) highlighted++;
        const row = U.el('div.tool-node' + (linked ? '.current' : '') + (n.important ? '.important' : ''), {
          style: { paddingLeft: (6 + depth * 12) + 'px' },
          onclick: () => {
            if (n.linkChapterId) UI.go('editor/' + book.id + '/' + n.linkChapterId);
            else UI.toast('这个节点还没关联章节', 'close');
          }
        }, [
          U.el('span.tool-node-dot', { style: { background: n.color || 'var(--line-strong)' } }),
          U.el('span.tool-node-text', { text: n.text || '（空节点）' }),
          n.important ? U.icon('star', 'ico-sm') : null
        ]);
        wrap.appendChild(row);
        if (n.children && n.children.length) walk(n.children, depth + 1);
      });
    }
    walk(nodes, 0);
    U.append(body, wrap);

    const total = (function count(list) {
      return list.reduce((s, n) => s + 1 + (n.children ? count(n.children) : 0), 0);
    })(nodes);
    U.append(body, U.el('div.field-note', {
      text: '共 ' + total + ' 个节点' + (highlighted ? ' · 本章关联 ' + highlighted + ' 个（已高亮）' : '')
        + '。点带链接的节点可直接跳到对应章节。'
    }));
    U.append(body, U.el('button.btn.block', {
      style: { marginTop: '10px' },
      onclick: () => UI.go('outline/' + book.id)
    }, [U.icon('edit', 'ico-sm'), U.el('span', { text: '打开完整大纲' })]));
  }

  /* ---------------- 排版 ---------------- */
  function renderType(body) {
    const s = Store.state.settings;
    const ta = ctx.textarea;
    const fs = U.el('input', { type: 'range', min: '14', max: '30', step: '1', value: String(s.editorFontSize || 18) });
    const lh = U.el('input', { type: 'range', min: '14', max: '30', step: '1', value: String(Math.round((s.editorLineHeight || 1.9) * 10)) });
    const fsel = U.el('select.font-sel', {}, U.FONTS.map((f) => U.el('option', {
      text: f.label, value: f.id, selected: (s.editorFont || 'serif') === f.id
    })));
    const fnote = U.el('div.field-note', { text: (U.FONTS.find((f) => f.id === (s.editorFont || 'serif')) || U.FONTS[0]).note });

    function applySize() {
      const size = Number(fs.value);
      const lineH = Number(lh.value) / 10;
      if (ta) {
        ta.style.fontSize = size + 'px';
        ta.style.lineHeight = String(lineH);
        if (ctx.autoGrow) { try { ctx.autoGrow(ta); } catch (e) { /* noop */ } }
      }
      if (ctx.onTypeChange) ctx.onTypeChange();
    }
    fs.addEventListener('input', () => { Store.setSetting('editorFontSize', Number(fs.value)); applySize(); });
    lh.addEventListener('input', () => { Store.setSetting('editorLineHeight', Number(lh.value) / 10); applySize(); });
    fsel.addEventListener('change', () => {
      const id = fsel.value;
      Store.setSetting('editorFont', id);
      U.applyFonts(Store.state.settings);
      const f = U.FONTS.find((x) => x.id === id) || U.FONTS[0];
      fnote.textContent = f.note;
      if (ta) { ta.style.fontFamily = f.stack; ta.classList.toggle('sans', id === 'sans'); }
      applySize();
    });

    U.append(body, [
      U.el('div.field', {}, [U.el('label', { text: '字号' }), fs]),
      U.el('div.field', {}, [U.el('label', { text: '行距' }), lh]),
      U.el('div.field', {}, [U.el('label', { text: '正文字体' }), fsel, fnote]),
      U.el('div.field', {}, [
        U.el('label', { text: '界面字体' }),
        (() => {
          const sel = U.el('select.font-sel', {}, U.UI_FONTS.map((f) => U.el('option', {
            text: f.label, value: f.id, selected: (s.uiFont || 'system') === f.id
          })));
          sel.addEventListener('change', () => { Store.setSetting('uiFont', sel.value); U.applyFonts(Store.state.settings); });
          return sel;
        })()
      ]),
      UI.switchRow('段首自动缩进', '回车自动空两格', s.autoIndent !== false, (v) => Store.setSetting('autoIndent', v)),
      U.el('div.font-preview', {
        style: { fontFamily: U.fontStack(s.editorFont || 'serif'), fontSize: Math.min(20, s.editorFontSize || 18) + 'px', marginTop: '12px' },
        text: '字如其人，落笔成书。The quick brown fox 1234.'
      })
    ]);
  }

  /* ---------------- 目标 ---------------- */
  function renderGoal(body) {
    const st = Store.state;
    const doc = ctx.doc;
    const words = ctx.currentWords ? ctx.currentWords() : U.words(doc.content || '');
    const goal = doc.goal || 0;
    const today = global.Stats.today(st);
    const dailyGoal = st.settings.dailyGoalWords || 0;

    U.append(body, [
      U.el('div.card', {}, [
        U.el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } }, [
          U.el('div', { style: { fontSize: '22px', fontWeight: '700' }, text: U.fmtInt(words) + ' 字' }),
          goal ? U.el('span.badge' + (words >= goal ? '.ok' : ''), { text: words >= goal ? '已达标' : '目标 ' + U.fmtInt(goal) }) : null
        ]),
        U.el('div', { style: { marginTop: '10px' } }, UI.progressBar(goal ? U.clamp(words / goal, 0, 1) : 0)),
        U.el('div.grid2', { style: { marginTop: '12px' } }, [
          U.el('button.btn', {
            onclick: () => {
              UI.input({ title: '本章字数目标', type: 'number', value: String(goal || 3000) }).then((v) => {
                if (v === null || v === undefined) return;
                const g = Math.max(0, Number(v) || 0);
                if (ctx.onGoal) ctx.onGoal(g);
                render();
              });
            }
          }, [U.icon('target', 'ico-sm'), U.el('span', { text: goal ? '改目标' : '设目标' })]),
          U.el('button.btn', {
            onclick: () => {
              UI.input({ title: '每日字数目标', type: 'number', value: String(dailyGoal || 1000) }).then((v) => {
                if (v === null || v === undefined) return;
                Store.setSetting('dailyGoalWords', Math.max(0, Number(v) || 0));
                UI.renderTabGoal();
                render();
              });
            }
          }, [U.icon('calendar', 'ico-sm'), U.el('span', { text: '今日目标' })])
        ])
      ]),
      U.el('div.list', {}, [
        U.el('div.row', {}, [U.el('div.row-main', {}, [
          U.el('div.row-title', { text: '今日已写' }),
          U.el('div.row-sub', { 'text.f': () => U.fmtInt(today.words) + ' 字' + (dailyGoal ? ' / ' + U.fmtInt(dailyGoal) + '（' + Math.round(U.clamp(today.words / dailyGoal, 0, 1) * 100) + '%）' : '') })
        ])]),
        U.el('div.row', {}, [U.el('div.row-main', {}, [
          U.el('div.row-title', { text: '本次写作时长' }),
          U.el('div.row-sub', { 'text.f': () => U.fmtDuration(global.Stats.sessionElapsedMs() / 60000, { short: true }) })
        ])]),
        U.el('div.row', {}, [U.el('div.row-main', {}, [
          U.el('div.row-title', { text: '全书 / 全篇' }),
          U.el('div.row-sub', { 'text.f': () => ctx.totalText ? ctx.totalText() : '—' })
        ])])
      ]),
      U.el('div.field-note', { text: '目标只是提醒，不影响保存。达成时会自动弹一次提示。' })
    ]);
  }

  /* ================================================================== */
  /* 对外接口                                                          */
  /* ================================================================== */
  UI.toolsPanel = {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
    setTab: (t) => { activeTab = t; if (isOpen()) render(); },
    refresh: () => { if (isOpen()) render(); },
    /** 便签增删改后调用：刷新侧栏列表，并让写作页重画角标 */
    notesChanged: () => {
      if (isOpen() && activeTab === 'notes') render();
      if (ctx && ctx.onNotesChanged) { try { ctx.onNotesChanged(); } catch (e) { /* noop */ } }
    },
    countNotes: () => (ctx ? (UI.notesApi ? UI.notesApi.count(ctx.noteKind || ctx.kind, ctx.noteId || (ctx.doc && ctx.doc.id)) : 0) : 0)
  };

  /* 路由离开写作页时自动收起 */
  global.addEventListener('hashchange', () => {
    if (!/^#\/(editor|write)/.test(location.hash)) close();
  });
})(window);
