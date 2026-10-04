/* ==========================================================================
   selfwriting · view-notes.js
   写作侧边便签（灵感 / 注释 / 牢骚）
   定位：和正文分开的一层 —— 不打断正文，又能随手记下「这里想说什么」。
     · 写作页侧边抽屉：写小说、文章、日记、大纲时随手记
     · 可标记类型：灵感 / 注释 / 待办 / 牢骚
     · 可「插入正文」把某条便签同步进作品（在光标处插入）
     · 可置顶、可搜索，汇总页能按作品筛选
   数据放在 state.notes[kind:id]，跟着整库备份一起走。
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const Store = global.Store;
  const UI = global.UI;

  const KINDS = [
    { id: 'idea', label: '灵感', icon: 'bulb' },
    { id: 'note', label: '注释', icon: 'quote' },
    { id: 'todo', label: '待办', icon: 'check' },
    { id: 'rant', label: '牢骚', icon: 'fire' }
  ];
  const KIND_MAP = {};
  KINDS.forEach((k) => { KIND_MAP[k.id] = k; });

  /* ================================================================== */
  /* 数据                                                              */
  /* ================================================================== */
  function notesMap() {
    const st = Store.state;
    if (!st.notes || typeof st.notes !== 'object') st.notes = {};
    return st.notes;
  }
  function keyOf(kind, id) { return kind + ':' + id; }

  function list(kind, id) {
    const m = notesMap();
    const arr = m[keyOf(kind, id)];
    return Array.isArray(arr) ? arr : [];
  }

  function add(kind, id, text, type) {
    const t = String(text || '').trim();
    if (!t) return null;
    const m = notesMap();
    const k = keyOf(kind, id);
    if (!Array.isArray(m[k])) m[k] = [];
    const note = { id: U.uid('nt'), text: t, type: type || 'idea', at: Date.now(), pinned: false };
    m[k].unshift(note);
    Store.commit(null, { kind: 'note:add' });
    notifyChanged();
    return note;
  }

  /** 便签变化后通知侧栏与写作页刷新（角标、列表计数） */
  function notifyChanged() {
    try { if (UI.toolsPanel) UI.toolsPanel.notesChanged(); } catch (e) { /* noop */ }
  }

  function update(kind, id, noteId, patch) {
    const arr = list(kind, id);
    const n = arr.find((x) => x.id === noteId);
    if (!n) return;
    Object.assign(n, patch || {});
    Store.commit(null, { kind: 'note:edit' });
    notifyChanged();
  }

  function remove(kind, id, noteId) {
    const m = notesMap();
    const k = keyOf(kind, id);
    if (!Array.isArray(m[k])) return;
    m[k] = m[k].filter((x) => x.id !== noteId);
    if (!m[k].length) delete m[k];
    Store.commit(null, { kind: 'note:remove' });
    notifyChanged();
  }

  function count(kind, id) { return list(kind, id).length; }

  /** 所有作品里的便签总数（给统计页用） */
  function totalCount() {
    const m = notesMap();
    let n = 0;
    Object.keys(m).forEach((k) => { if (Array.isArray(m[k])) n += m[k].length; });
    return n;
  }

  /** 某作品便签的纯文本（导出时附在文末用） */
  function textOf(kind, id) {
    const arr = list(kind, id);
    if (!arr.length) return '';
    const lines = arr.slice().reverse().map((n) => {
      const k = KIND_MAP[n.type] || KIND_MAP.idea;
      return '· [' + k.label + '] ' + n.text.replace(/\n/g, ' / ');
    });
    return '【写作便签】\n' + lines.join('\n');
  }

  /* ================================================================== */
  /* 单条便签卡片                                                      */
  /* ================================================================== */
  function noteCard(n, handlers) {
    const k = KIND_MAP[n.type] || KIND_MAP.idea;
    const card = U.el('div.note-card' + (n.pinned ? '.pinned' : ''));
    const head = U.el('div.note-head', {}, [
      U.el('span.note-type.note-type-' + (n.type || 'idea'), {}, [U.icon(k.icon, 'ico-sm'), U.el('span', { text: k.label })]),
      U.el('span.note-time', { text: U.fmtDateTime(n.at) })
    ]);
    const body = U.el('div.note-text', { text: n.text });
    const acts = U.el('div.note-acts', {}, [
      U.el('button.note-act', {
        onclick: () => handlers.onEdit && handlers.onEdit(n)
      }, [U.icon('edit', 'ico-sm'), U.el('span', { text: '编辑' })]),
      U.el('button.note-act', {
        onclick: () => handlers.onInsert && handlers.onInsert(n)
      }, [U.icon('arrowRight', 'ico-sm'), U.el('span', { text: '插入正文' })]),
      U.el('button.note-act', {
        onclick: () => handlers.onPin && handlers.onPin(n)
      }, [U.icon('bookmark', 'ico-sm'), U.el('span', { text: n.pinned ? '取消置顶' : '置顶' })]),
      U.el('button.note-act.danger', {
        onclick: () => handlers.onDelete && handlers.onDelete(n)
      }, [U.icon('trash', 'ico-sm'), U.el('span', { text: '删除' })])
    ]);
    U.append(card, [head, body, acts]);
    return card;
  }

  /* ================================================================== */
  /* 便签面板（写作页调用）：host 内渲染，自带输入框                    */
  /* ================================================================== */
  /**
   * UI.notesPanel(host, { kind, id, title, onInsert, compact })
   * onInsert(text) 由调用方决定怎么同步进正文（比如在光标处插入）
   */
  UI.notesPanel = function (host, opt) {
    const o = opt || {};
    const kind = o.kind || 'novel';
    const id = o.id || '';
    let filter = 'all';
    let type = 'idea';

    function render() {
      U.clear(host);
      const all = list(kind, id);
      const shown = filter === 'all' ? all : all.filter((n) => (n.type || 'idea') === filter);

      /* 输入区 */
      const ta = U.el('textarea.note-input', {
        placeholder: o.placeholder || '随手记一句：这段想表达什么、卡在哪、下一步写什么……（Ctrl+Enter 保存）'
      });
      const typeRow = U.el('div.chips.scroll');
      KINDS.forEach((k) => {
        typeRow.appendChild(U.el('button.chip' + (type === k.id ? '.active' : ''), {
          onclick: () => { type = k.id; render(); }
        }, [U.icon(k.icon, 'ico-sm'), U.el('span', { text: k.label })]));
      });
      const save = () => {
        const t = ta.value.trim();
        if (!t) { UI.toast('先写点什么', 'close'); return; }
        add(kind, id, t, type);
        ta.value = '';
        UI.toast('已记下', 'check');
        render();
      };
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
      });

      U.append(host, [
        U.el('div.note-compose', {}, [
          ta,
          U.el('div.note-compose-foot', {}, [
            typeRow,
            U.el('button.btn.primary.sm', { onclick: save }, [U.icon('plus', 'ico-sm'), U.el('span', { text: '记下' })])
          ])
        ])
      ]);

      /* 筛选 */
      if (all.length) {
        const chips = U.el('div.chips.scroll', { style: { margin: '12px 0 8px' } });
        chips.appendChild(U.el('button.chip' + (filter === 'all' ? '.active' : ''), {
          text: '全部 ' + all.length,
          onclick: () => { filter = 'all'; render(); }
        }));
        KINDS.forEach((k) => {
          const n = all.filter((x) => (x.type || 'idea') === k.id).length;
          if (!n) return;
          chips.appendChild(U.el('button.chip' + (filter === k.id ? '.active' : ''), {
            text: k.label + ' ' + n,
            onclick: () => { filter = k.id; render(); }
          }));
        });
        U.append(host, chips);
      }

      /* 列表（置顶在前） */
      if (!shown.length) {
        U.append(host, U.el('div.note-empty', {
          text: all.length ? '这个分类下还没有便签。' : '还没有便签。写正文时想到什么，就记在这里 —— 不会混进正文。'
        }));
        return;
      }
      const sorted = shown.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.at - a.at);
      const listHost = U.el('div.note-list');
      sorted.forEach((n) => {
        listHost.appendChild(noteCard(n, {
          onEdit: () => {
            UI.input({ title: '编辑便签', value: n.text, multiline: true, placeholder: '内容' }).then((v) => {
              if (v === null || v === undefined) return;
              const t = String(v).trim();
              if (!t) { remove(kind, id, n.id); }
              else update(kind, id, n.id, { text: t, at: Date.now() });
              render();
              if (o.onChange) o.onChange();
            });
          },
          onInsert: () => {
            if (!o.onInsert) { UI.toast('这个页面不支持插入正文', 'close'); return; }
            o.onInsert(n.text);
            UI.toast('已插入正文', 'check');
          },
          onPin: () => { update(kind, id, n.id, { pinned: !n.pinned }); render(); },
          onDelete: () => {
            UI.confirm('删除这条便签', n.text.slice(0, 40) + (n.text.length > 40 ? '…' : ''), '删除', true).then((ok) => {
              if (!ok) return;
              remove(kind, id, n.id);
              render();
              if (o.onChange) o.onChange();
            });
          }
        }));
      });
      U.append(host, listHost);
    }

    render();
    return { refresh: render, count: () => count(kind, id) };
  };

  /** 写作页用的抽屉：从下方弹出（手机上比侧栏更好用，桌面上也一样直观） */
  UI.notesSheet = function (opt) {
    const o = opt || {};
    let panel = null;
    UI.sheet({
      title: (o.title || '写作便签') + (o.sub ? ' · ' + o.sub : ''),
      onClose: () => { if (o.onChange) o.onChange(); },
      body: (host) => {
        U.append(host, U.el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', marginBottom: '10px', lineHeight: '1.7' },
          text: '便签独立于正文保存：写正文时随手记，回头再看。点「插入正文」可在光标处同步进作品。'
        }));
        const box = U.el('div');
        U.append(host, box);
        panel = UI.notesPanel(box, o);
      }
    });
    return () => panel;
  };

  /* ================================================================== */
  /* 汇总页                                                            */
  /* ================================================================== */
  UI.route('notes', function (view) {
    const st = Store.state;
    const m = notesMap();
    const keys = Object.keys(m).filter((k) => Array.isArray(m[k]) && m[k].length);
    UI.setTitle('写作便签', keys.length ? totalCount() + ' 条 · ' + keys.length + ' 个作品' : '随手记的灵感与牢骚');

    if (!keys.length) {
      U.append(view, UI.empty('bulb', '还没有便签', '在小说、文章、日记或大纲页面点顶部的便签按钮，随手记下的内容会汇总到这里。'));
      return;
    }

    /* 按作品分组展示 */
    const NAME = { novel: '小说', article: '文章', diary: '日记本', outline: '大纲', book: '读物' };
    function titleOf(kind, id) {
      try {
        if (kind === 'novel') { const n = Store.findNovel(id); return n ? n.title : id; }
        if (kind === 'article') { const a = Store.findArticle(id); return a ? a.title : id; }
        if (kind === 'diary') { const b = Store.findDiary(id); return b ? b.title : id; }
        if (kind === 'outline') { const n = Store.findNovel(id); return n ? n.title + '（大纲）' : id; }
      } catch (e) { /* noop */ }
      return id;
    }

    keys.forEach((k) => {
      const parts = k.split(':');
      const kind = parts[0];
      const id = parts.slice(1).join(':');
      const arr = m[k];
      const head = U.el('div.section-title', {}, [
        U.icon(kind === 'novel' ? 'feather' : kind === 'article' ? 'doc' : kind === 'diary' ? 'calendar' : 'tree', 'ico-sm'),
        U.el('span', { text: (NAME[kind] || '作品') + ' · ' + titleOf(kind, id) + '（' + arr.length + '）' })
      ]);
      U.append(view, head);
      const listHost = U.el('div.note-list');
      arr.forEach((n) => {
        listHost.appendChild(noteCard(n, {
          onPin: () => { update(kind, id, n.id, { pinned: !n.pinned }); UI.render(); },
          onEdit: () => {
            UI.input({ title: '编辑便签', value: n.text, multiline: true }).then((v) => {
              if (v === null || v === undefined) return;
              const t = String(v).trim();
              if (!t) remove(kind, id, n.id); else update(kind, id, n.id, { text: t, at: Date.now() });
              UI.render();
            });
          },
          onInsert: () => {
            /* 汇总页没有光标：把便签追加到对应作品末尾 */
            if (kind === 'novel') {
              const nv = Store.findNovel(id);
              if (nv && nv.chapters.length) {
                const ch = nv.chapters[nv.chapters.length - 1];
                Store.setChapterContent(id, ch.id, (ch.content || '') + (ch.content ? '\n\n' : '') + n.text);
                UI.toast('已追加到最后一章末尾', 'check');
                return;
              }
            }
            if (kind === 'article') {
              const a = Store.findArticle(id);
              if (a) {
                Store.setArticleContent(id, (a.content || '') + (a.content ? '\n\n' : '') + n.text);
                UI.toast('已追加到文章末尾', 'check');
                return;
              }
            }
            if (kind === 'diary') {
              const b = Store.findDiary(id);
              if (b) {
                const key = U.dateKey();
                const found = b.entries.find((e) => e.dateKey === key);
                if (found) Store.updateDiaryEntry(id, found.id, { content: (found.content || '') + '\n\n' + n.text });
                else Store.addDiaryEntry(id, { dateKey: key, content: n.text });
                UI.toast('已写入今天的日记', 'check');
                return;
              }
            }
            UI.toast('这个模块暂不支持一键插入', 'close');
          },
          onDelete: () => {
            UI.confirm('删除这条便签', n.text.slice(0, 40), '删除', true).then((ok) => {
              if (!ok) return;
              remove(kind, id, n.id);
              UI.render();
            });
          }
        }));
      });
      U.append(view, listHost);
    });

    U.append(view, U.el('div', {
      style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '14px', lineHeight: '1.8' },
      text: '便签不计入创作字数与成就统计 —— 它是写给自己看的草稿层。'
    }));
  });

  /* 暴露给其它模块用 */
  UI.notesApi = {
    list: list, add: add, update: update, remove: remove,
    count: count, totalCount: totalCount, textOf: textOf, KINDS: KINDS
  };
})(window);
