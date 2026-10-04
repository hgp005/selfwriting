/* ==========================================================================
   selfwriting · view-editor.js
   写作台：小说章节 / 小节 / 文章
     · 实时字数与章节目标进度
     · 「本章大纲」面板：大纲改哪里，这里立刻同步；这里改写，大纲同步变
     · 写作时长自动计时（停顿即停表）
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const UI = global.UI;
  const Store = global.Store;
  const IO = global.IOApi;
  const Stats = global.Stats;
  const Ed = {};

  const FONT_STEPS = [16, 18, 20, 22, 24, 28];

  /* ================================================================== */
  /* 自增长文本域                                                      */
  /* ================================================================== */
  function autoGrow(ta) {
    ta.style.height = 'auto';
    const h = Math.max(ta.scrollHeight, 200);
    ta.style.height = h + 'px';
  }

  function buildTextarea(opts) {
    const o = opts || {};
    const st = Store.state.settings;
    const ta = U.el('textarea.editor' + (st.editorFont === 'sans' ? '.sans' : ''), {      placeholder: o.placeholder || '开始写吧…',
      spellcheck: 'false',
      autocapitalize: 'sentences'
    });
    ta.value = o.value || '';
    ta.style.fontSize = (st.editorFontSize || 18) + 'px';
    try { ta.style.fontFamily = U.fontStack(st.editorFont || 'serif'); } catch (e) { /* noop */ }
    ta.style.lineHeight = String(st.editorLineHeight || 1.9);

    // 输入路径要尽量轻：autoGrow 会读 scrollHeight（强制同步布局），
    // 大文本下每个按键都做会明显拖慢输入，所以防抖处理。
    const growSoon = U.debounce(() => autoGrow(ta), 250);
    ta.addEventListener('input', () => {
      growSoon();
      o.onInput && o.onInput(ta.value);
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && Store.state.settings.autoIndent && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const s = ta.selectionStart;
        if (s === ta.selectionEnd) {
          e.preventDefault();
          const ins = '\n\u3000\u3000';
          const v = ta.value;
          ta.value = v.slice(0, s) + ins + v.slice(ta.selectionEnd);
          ta.selectionStart = ta.selectionEnd = s + ins.length;
          growSoon();
          o.onInput && o.onInput(ta.value);
        }
      }
    });
    // 首次进入自动缩进首行
    if (Store.state.settings.autoIndent && ta.value && !ta.value.startsWith('\u3000')) {
      // 不改动已有内容，仅当内容为空时不处理
    }
    setTimeout(() => autoGrow(ta), 0);
    return ta;
  }

  /* ================================================================== */
  /* 「本章大纲」面板                                                  */
  /* ================================================================== */
  /**
   * 同时显示：本章关联的大纲节点（可编辑、可改色、可标重点）
   * 因为是同一份数据源，正文写作时大纲面板永远显示最新内容。
   */
  function outlinePanel(novel, chapter, sectionId, host) {
    const wrap = U.el('div.card', { style: { marginBottom: '12px', borderLeft: '3px solid var(--accent)' } });

    function render() {
      U.clear(wrap);
      const nodes = Store.nodesForChapter(novel.id, chapter.id, sectionId || null);
      const head = U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: nodes.length ? '9px' : '0' } }, [
        U.icon('tree', 'ico-sm'),
        U.el('strong', { text: sectionId ? '本节大纲' : '本章大纲', style: { fontSize: '13.5px' } }),
        U.el('span', { text: nodes.length ? nodes.length + ' 条' : '未关联', style: { fontSize: '11px', color: 'var(--text-3)' } }),
        U.el('span', { style: { flex: '1 1 auto' } }),
        U.el('button.chip', { text: '+ 关联大纲', onclick: addFlow }),
        U.el('button.chip', { text: '完整大纲', onclick: () => UI.go('outline/' + novel.id + (sectionId ? '/' + chapter.id + '/' + sectionId : '/' + chapter.id)) })
      ]);
      U.append(wrap, head);

      nodes.forEach((nd) => {
        const row = U.el('div.ot-row' + (nd.important ? '.important' : ''), {
          style: { borderLeftColor: nd.color || 'var(--line-strong)', marginBottom: '6px' }
        }, [
          U.el('div.ot-main', {}, [
            U.el('div.ot-text', {
              text: nd.text || '（空节点）',
              contenteditable: 'true',
              style: { outline: 'none' },
              onblur: (e) => {
                const v = e.target.textContent.trim();
                if (v !== (nd.text || '')) Store.updateOutlineNode(novel.id, nd.id, { text: v });
              }
            }),
            nd.note ? U.el('div', { text: '注：' + nd.note, style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '4px' } }) : null,
            U.el('div.ot-meta', {}, [
              nd.colorName ? U.el('span', { text: '#' + nd.colorName }) : null,
              nd.linkSectionId ? U.el('span', { text: '关联小节' }) : U.el('span', { text: '关联整章' }),
              U.el('span', { text: U.fmtWhen(nd.updatedAt) })
            ])
          ]),
          U.el('div.ot-actions', {}, [
            U.el('button.icon-btn', { onclick: () => Store.updateOutlineNode(novel.id, nd.id, { important: !nd.important }), 'aria-label': '重点' },
              U.icon('star', 'ico-sm')),
            U.el('button.icon-btn', { onclick: () => colorSheet(novel.id, nd), 'aria-label': '颜色' }, U.icon('palette', 'ico-sm')),
            U.el('button.icon-btn', {
              onclick: () => Store.linkOutlineNode(novel.id, nd.id, null, null, ''),
              'aria-label': '取消关联'
            }, U.icon('close', 'ico-sm'))
          ])
        ]);
        wrap.appendChild(row);
      });
      if (!nodes.length) {
        U.append(wrap, U.el('div', { text: '把大纲节点关联到本章，写作时就能随时对照、随时修改。', style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '6px' } }));
      }
      U.append(host, wrap);
    }

    function colorSheet(novelId, nd) {
      UI.sheet({
        title: '分支颜色',
        body: (host) => {
          const dots = U.el('div.color-dots');
          Store.PALETTE.forEach((p) => {
            const d = U.el('button.color-dot' + (nd.color === p.value ? '.sel' : ''), {
              style: { background: p.value },
              title: p.name,
              onclick: () => {
                const next = nd.color === p.value ? null : p.value;
                const nm = nd.color === p.value ? '' : p.name;
                Store.updateOutlineNode(novelId, nd.id, { color: next, colorName: nm });
                UI.closeSheet();
                render();
                UI.toast(next ? '已设为 ' + p.name : '已清除颜色', 'palette');
              }
            });
            if (nd.color === p.value) d.appendChild(U.icon('check', 'ico-sm'));
            dots.appendChild(d);
          });
          U.append(host, [dots, U.el('div', { text: '颜色用来区分故事线 / 人物线 / 时间线，在小说写作界面与大纲界面同步显示。', style: { fontSize: '11.5px', color: 'var(--text-3)' } })]);
        }
      });
    }

    function addFlow() {
      const listHost = U.el('div');
      const input = U.el('textarea.textarea', { placeholder: '写一条大纲，回车确认（Shift+回车换行）', rows: 2 });
      const colorRow = U.el('div.color-dots');
      let chosen = null;
      Store.PALETTE.slice(0, 6).forEach((p) => {
        colorRow.appendChild(U.el('button.color-dot', {
          style: { background: p.value },
          title: p.name,
          onclick: (e) => {
            chosen = chosen === p.value ? null : p;
            U.$$('.color-dot', colorRow).forEach((x) => x.classList.remove('sel'));
            if (chosen) e.currentTarget.classList.add('sel');
          }
        }));
      });

      // 已有大纲节点可一键关联
      const existing = [];
      Store.walkTree(novel.outline || [], (nd) => existing.push(nd));

      UI.sheet({
        title: '关联大纲',
        body: (host) => {
          U.append(host, [
            U.el('div.field', {}, [U.el('label', { text: '新建并关联' }), input]),
            U.el('div.field', {}, [U.el('label', { text: '分支颜色（可选）' }), colorRow])
          ]);
          if (existing.length) {
            U.append(host, U.el('div', { style: { marginTop: '6px' } }, [
              U.el('label', { text: '或关联已有节点', style: { fontSize: '12.5px', color: 'var(--text-2)' } }),
              listHost
            ]));
            const list = U.el('div.list', { style: { marginTop: '6px', maxHeight: '34vh', overflow: 'auto' } });
            existing.slice(0, 80).forEach((nd) => {
              list.appendChild(U.el('div.row.tap', {
                onclick: () => {
                  const label = sectionId ? '关联到本节' : '关联到本章';
                  Store.linkOutlineNode(novel.id, nd.id, chapter.id, sectionId || null, label);
                  UI.closeSheet();
                  render();
                  UI.toast('已关联到' + (sectionId ? '本节' : '本章'), 'link');
                }
              }, [
                U.el('span.dot', { style: { background: nd.color || 'var(--line-strong)' } }),
                U.el('div.row-main', {}, [
                  U.el('div.row-title', { text: U.excerpt(nd.text, 34) || '（空节点）' }),
                  U.el('div.row-sub', { text: nd.important ? '重点' : '' })
                ]),
                U.el('span.row-chev', {}, U.icon('link', 'ico-sm'))
              ]));
            });
            listHost.appendChild(list);
          }
        },
        footer: [
          { label: '取消', ghost: true },
          {
            label: '新建并关联', primary: true, close: false, onClick: () => {
              const text = input.value.trim();
              if (!text) { UI.toast('请先写点内容', 'close'); return; }
              const node = Store.addOutlineNode(novel.id, null, { text: text, color: chosen ? chosen.value : null, colorName: chosen ? chosen.name : '' });
              Store.linkOutlineNode(novel.id, node.id, chapter.id, sectionId || null, sectionId ? '关联到本节' : '关联到本章');
              UI.closeSheet();
              render();
              UI.toast('已新建并关联', 'link');
            }
          }
        ],
        autoFocus: true
      });
    }

    render();
    // 数据变化时同步（大纲页改动 → 写作页立刻更新）
    // 注意：typing 事件是输入路径的高频通知，面板内容不会因它变化，直接忽略，
    // 否则每次按键都会重建整个面板。
    const unsub = Store.subscribe((s, meta) => {
      if (!meta || !meta.kind) return;
      if (/:typing$/.test(meta.kind)) return;
      if (/^(outline|novel|chapter|section)/.test(meta.kind)) render();
    });
    return () => unsub();
  }

  /* ================================================================== */
  /* 写作台通用骨架                                                    */
  /* ================================================================== */
  function writingDesk(view, cfg) {
    /**
     * cfg: {
     *   kind:'novel'|'article', owner, doc ({id,title,content,goal}), chapter, section,
     *   onCommitText(text), onTitle(v), onGoal(v), metaText, extraPanels:[], menu:[]
     * }
     */
    const settings = Store.state.settings;
    view.classList.add('flush');

    const container = U.el('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '100%', padding: '12px 16px 0' } });
    U.append(view, container);

    /* 顶部元信息条 */
    const metaStrip = U.el('div.meta-strip');
    U.append(container, metaStrip);

    /* 额外面板（小说 = 大纲面板） */
    (cfg.extraPanels || []).forEach((p) => U.append(container, p));

    /* 标题 */
    const titleInput = U.el('input.chapter-title-input', {
      placeholder: cfg.kind === 'novel' ? '章节标题' : '文章标题',
      value: cfg.doc.title || ''
    });
    titleInput.addEventListener('change', () => cfg.onTitle && cfg.onTitle(titleInput.value.trim()));
    titleInput.addEventListener('blur', () => cfg.onTitle && cfg.onTitle(titleInput.value.trim()));
    U.append(container, titleInput);

    /* 正文 */
    // 输入路径要做的事尽量少：写入内存 + 防抖更新字数。
    // 大文本下「每个按键都统计全文」会直接拖慢输入（实测 200k 字约 20ms/次）。
    const refreshSoon = U.debounce(() => { refresh(); }, 350);
    const ta = buildTextarea({
      value: cfg.doc.content || '',
      placeholder: cfg.placeholder || '开始写吧…（内容自动保存到本机）',
      onInput: (v) => {
        cfg.onCommitText(v);
        refreshSoon();
      }
    });
    U.append(container, ta);

    /* 状态条 */
    const wordCountEl = U.el('b', { text: '0' });
    const goalEl = U.el('div.goal-mini');
    const timeEl = U.el('span', { text: '00:00' });
    const bar = U.el('div.typing-bar');
    const saveTag = U.el('span', { text: '已保存' });
    U.append(bar, [
      U.el('span', {}, [wordCountEl, U.el('span', { text: ' 字' })]),
      goalEl,
      U.el('span.spacer'),
      U.el('span', {}, [U.icon('clock', 'ico-sm'), U.el('span', { text: ' ' }), timeEl]),
      saveTag
    ]);
    U.append(container, bar);

    /* ---------- 写作功能库侧栏（便签 / 大纲 / 排版 / 目标） ---------- */
    /* 记住光标位置：侧栏打开时正文失焦，插入便签才能回到原处 */
    let savedSel = null;
    function rememberSel() {
      try { savedSel = { s: ta.selectionStart, e: ta.selectionEnd }; } catch (e) { savedSel = null; }
    }
    ta.addEventListener('blur', rememberSel);
    ta.addEventListener('keyup', rememberSel);
    ta.addEventListener('click', rememberSel);

    /** 文本插入到正文光标处（没有光标就追加到末尾） */
    function insertAtCursor(text) {
      const body = String(ta.value || '');
      let s, e;
      if (savedSel && typeof savedSel.s === 'number' && savedSel.s <= body.length) { s = savedSel.s; e = savedSel.e; }
      else { s = e = body.length; }
      const needNl = s > 0 && body[s - 1] !== '\n';
      const ins = (needNl ? '\n\n' : '') + text;
      const next = body.slice(0, s) + ins + body.slice(e);
      ta.value = next;
      const caret = s + ins.length;
      try { ta.focus(); ta.setSelectionRange(caret, caret); } catch (err) { /* noop */ }
      savedSel = { s: caret, e: caret };
      cfg.onCommitText(next);
      autoGrow(ta);
      refresh();
    }

    /* 便签按「作品」归类：小说用 novel.id，文章用文章 id，不能用章节 id */
    const noteKeyId = () => cfg.noteId || cfg.doc.id;
    const noteCount = () => (UI.notesApi ? UI.notesApi.count(cfg.noteKind || cfg.kind, noteKeyId()) : 0);
    function toolsContext() {
      return {
        kind: cfg.kind,
        noteKind: cfg.noteKind || cfg.kind,
        noteId: noteKeyId(),
        owner: cfg.owner,
        doc: cfg.doc,
        chapterId: cfg.chapter ? cfg.chapter.id : null,
        textarea: ta,
        rememberSel: rememberSel,
        insertText: insertAtCursor,
        autoGrow: autoGrow,
        currentWords: () => U.words(ta.value),
        totalText: () => {
          if (cfg.kind === 'article') {
            const a = Store.findArticle(cfg.doc.id);
            return a ? U.fmtInt(U.words(a.content || '')) + ' 字（本篇）' : '—';
          }
          const nv = Store.findNovel(cfg.noteId || '') || Store.findNovel(cfg.owner && cfg.owner.id);
          return nv ? U.fmtInt(Store.novelWords(nv)) + ' 字 / 全书 · ' + nv.chapters.length + ' 章' : '—';
        },
        onGoal: (g) => { cfg.onGoal && cfg.onGoal(g); cfg.doc.goal = g; refresh(); },
        onTypeChange: () => { try { refresh(); } catch (e) { /* noop */ } },
        onChange: () => { try { refresh(); } catch (e) { /* noop */ } },
        onNotesChanged: () => { try { paintNoteBadge(); } catch (e) { /* noop */ } },
        onClose: () => { paintNoteBadge(); }
      };
    }
    function toolsDrawer(tab) {
      rememberSel();
      if (tab) UI.toolsPanel.setTab(tab);
      UI.toolsPanel.open(toolsContext());
    }

    /* ---------- 协作：对话与同步（仅协作作品显示） ---------- */
    const Cb = global.Collab;
    let collabBadge = null;
    function collabKind() { return cfg.kind === 'article' ? 'article' : 'novel'; }

    function pushToRoom() {
      if (!Cb || !Cb.room.alive) return Promise.resolve(false);
      const doc = cfg.doc;
      const chapters = cfg.kind === 'article'
        ? [{ title: '正文', content: ta.value, paraMeta: doc.paraMeta || null }]
        : [{ title: doc.title || '章节', content: ta.value, paraMeta: doc.paraMeta || null }];
      return Cb.push(collabKind(), cfg.noteId || doc.id, cfg.titleText || '', chapters, location.origin === Cb.room.host);
    }

    /** 协作面板：成员、对话、手动同步 */
    function collabSheet() {
      if (!Cb) return;
      const kind = collabKind();
      const id = cfg.noteId || cfg.doc.id;
      Cb.markChatSeen(kind, id);
      let panel = null;
      const memberLine = U.el('div.field-note', { text: '房间 ' + (Cb.room.code || '（未连接）') });
      const chatHost = U.el('div');
      /* 多人创作：勾上一起写的人，保存后作品与本章都会标出参与者 */
      const P = global.Profile;
      const currentItem = kind === 'article' ? Store.findArticle(id) : Store.findNovel(id);
      const multi = P ? P.multiBlock(P.autoParticipants(kind, id)) : null;
      const multiHost = U.el('div', {}, multi ? [
        multi.el,
        U.el('button.btn.sm.primary', {
          style: { marginTop: '10px' },
          onclick: () => {
            const people = multi.get();
            Store.setParticipants(kind, id, people, { chapterId: cfg.chapter ? cfg.chapter.id : null });
            UI.toast(people.length > 1 ? '已标为多人创作：' + P.joinNames(people) : '已设为只有我', 'check');
            UI.closeSheet();
            UI.render();
          }
        }, [U.icon('check', 'ico-sm'), U.el('span', { text: '保存参与者' })])
      ] : [U.el('div.field-note', { text: '（账号模块未加载）' })]);
      const input = U.el('input.input', { placeholder: '说点什么…（回车发送）' });

      function paintChat() {
        U.clear(chatHost);
        const msgs = Cb.chatOf(kind, id);
        if (!msgs.length) {
          U.append(chatHost, U.el('div.note-empty', { text: '还没有对话。写到哪里、想让对方接哪一段，都可以在这里说。' }));
          return;
        }
        const box = U.el('div.collab-chat');
        msgs.slice(-60).forEach((m) => {
          const mine = m.from === Cb.me();
          box.appendChild(U.el('div.collab-msg' + (mine ? '.mine' : ''), {}, [
            U.el('div.collab-msg-head', { text: m.from + ' · ' + U.fmtWhen(m.at) }),
            U.el('div.collab-msg-body', { text: m.text })
          ]));
        });
        U.append(chatHost, box);
        setTimeout(() => { chatHost.scrollTop = chatHost.scrollHeight; }, 30);
      }

      const send = () => {
        const t = input.value.trim();
        if (!t) return;
        Cb.sendChat(kind, id, t);
        input.value = '';
        paintChat();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
      paintChat();

      UI.sheet({
        title: '协作 · ' + (cfg.doc.title || '写作'),
        body: (host) => {
          U.append(host, [
            U.el('div.card', {}, [
              U.el('div', { style: { fontWeight: '650' }, text: Cb.room.alive ? '已连接房间 ' + Cb.room.code : '未连接房间' }),
              memberLine,
              U.el('div.grid2', { style: { marginTop: '10px' } }, [
                U.el('button.btn', {
                  onclick: () => {
                    UI.toast('正在同步…', 'up');
                    pushToRoom().then((ok) => {
                      UI.toast(ok ? '已把当前内容推送到房间' : '还没连接房间，改动只在本机', ok ? 'check' : 'close');
                    });
                  }
                }, [U.icon('share', 'ico-sm'), U.el('span', { text: '推送我的改动' })]),
                U.el('button.btn', { onclick: () => { UI.closeSheet(); UI.go('collab'); } },
                  [U.icon('users', 'ico-sm'), U.el('span', { text: '协作中心' })])
              ])
            ]),
            U.el('div.section-title', {}, [U.icon('users', 'ico-sm'), U.el('span', { text: '多人创作' })]),
            multiHost,
            U.el('div.section-title', {}, [U.icon('chat', 'ico-sm'), U.el('span', { text: '对话' })]),
            chatHost,
            U.el('div', { style: { height: '10px' } }),
            input
          ]);
        },
        footer: [
          { label: '关闭', ghost: true },
          { label: '发送', primary: true, close: false, onClick: send }
        ]
      });
    }

    /* ---------- 续写辅助 ---------- */
    /* 说明：这是本地启发式续写（分析文风 + 大纲方向后给候选段落），
       不是 AI 生成 —— 本应用离线，没有语言模型接口。候选一律由用户选择后才插入。 */
    function continueSheet() {
      const CT = global.Continue;
      if (!CT) return;
      const body = ta.value;
      if (!String(body || '').trim()) { UI.alert('还没有正文', '先写几句，续写才知道该往哪儿接。'); return; }
      const info = CT.stats(body);
      const direction = (cfg.outlineHint && cfg.outlineHint()) || '';
      let hint = direction;
      let count = 3;
      let picked = null;
      const candHost = U.el('div');
      const hintInput = U.el('input.input', { value: hint, placeholder: '想往哪个方向写？（可留空）' });
      const infoLine = U.el('div.field-note', {
        text: '已分析：' + info.paragraphs + ' 段 · 约 ' + info.chars + ' 字'
          + (info.names.length ? ' · 人物：' + info.names.join('、') : ' · 未识别到人物名')
          + (direction ? ' · 大纲方向：' + direction.slice(0, 24) : '')
      });

      function paint() {
        U.clear(candHost);
        const list = CT.generate(body, { hint: hintInput.value.trim(), count: count, direction: direction });
        list.forEach((c) => {
          const card = U.el('div.cont-card' + (picked === c.text ? '.sel' : ''), {
            onclick: () => { picked = c.text; paint(); }
          }, [
            U.el('div.cont-kind', { text: c.kind }),
            U.el('div.cont-text', { text: c.text })
          ]);
          candHost.appendChild(card);
        });
      }
      hintInput.addEventListener('change', paint);
      paint();

      UI.sheet({
        title: '续写辅助',
        body: (host) => {
          U.append(host, [
            U.el('div.fmt-hint', {}, [
              U.el('div.fmt-hint-title', {}, [U.icon('bulb', 'ico-sm'), U.el('span', { text: '这是「起头器」，不是 AI 代写' })]),
              U.el('div.fmt-hint-note', {
                text: '它会照着你已写的节奏、人物和右侧大纲方向，给出几个能接着往下写的段落。'
                  + '挑一个改一改再用，或者只当作灵感提示。'
              })
            ]),
            infoLine,
            U.el('div.field', {}, [U.el('label', { text: '往哪个方向写' }), hintInput]),
            U.el('div.score-tools', {}, [
              U.el('button.btn.sm', { onclick: () => { count = count >= 6 ? 3 : count + 1; paint(); } },
                [U.icon('refresh', 'ico-sm'), U.el('span', { text: '再来几个' })]),
              U.el('button.btn.sm', { onclick: () => { count = 3; paint(); } }, [U.el('span', { text: '重置' })])
            ]),
            candHost
          ]);
        },
        footer: [
          { label: '取消', ghost: true },
          { label: '插入到正文末尾', primary: true, close: false, onClick: () => {
            if (!picked) { UI.toast('先点一个候选段落', 'close'); return; }
            const cur = String(ta.value || '');
            const next = cur + (cur && !/\n\s*$/.test(cur) ? '\n\n' : '') + picked;
            ta.value = next;
            try { ta.focus(); ta.setSelectionRange(next.length, next.length); } catch (e) { /* noop */ }
            cfg.onCommitText(next);
            autoGrow(ta);
            refresh();
            UI.closeSheet();
            UI.toast('已插入，接着往下写吧', 'check');
          } }
        ]
      });
    }

    /* 顶部栏：协作按钮（协作作品才出现，带未读角标） */
    const collabBtn = U.el('button.icon-btn', { onclick: () => collabSheet(), 'aria-label': '协作对话' }, U.icon('chat'));
    function paintCollabBadge() {
      if (!Cb || !Cb.isShared(collabKind(), cfg.noteId || cfg.doc.id)) {
        collabBtn.classList.add('hidden');
        return;
      }
      collabBtn.classList.remove('hidden');
      const kind = collabKind();
      const n = Cb.unread(kind, cfg.noteId || cfg.doc.id);
      collabBtn.classList.toggle('has-badge', n > 0);
      collabBtn.setAttribute('data-badge', n > 9 ? '9+' : String(n));
      collabBtn.title = n ? '协作 · ' + n + ' 条新消息' : '协作对话';
    }

    /* 顶部栏：功能库按钮（带便签条数角标） */
    const noteBtn = U.el('button.icon-btn', { onclick: () => toolsDrawer('notes'), 'aria-label': '写作功能库' }, U.icon('bulb'));
    function paintNoteBadge() {
      const n = noteCount();
      noteBtn.classList.toggle('has-badge', n > 0);
      noteBtn.title = n ? '写作功能库 · 便签 ' + n + ' 条' : '写作功能库';
      noteBtn.setAttribute('data-badge', n > 9 ? '9+' : String(n));
      if (UI.toolsPanel) UI.toolsPanel.refresh();
    }

    /* 顶部栏按钮 */
    const actions = U.el('div', { style: { display: 'flex', gap: '2px', alignItems: 'center' } });
    actions.appendChild(U.el('button.icon-btn', { onclick: () => continueSheet(), 'aria-label': '续写辅助' }, U.icon('bulb')));
    actions.appendChild(collabBtn);
    actions.appendChild(noteBtn);
    actions.appendChild(U.el('button.icon-btn', { onclick: () => fontSheet(), 'aria-label': '排版' }, U.icon('text')));
    actions.appendChild(U.el('button.icon-btn', { onclick: () => focusToggle(), 'aria-label': '专注' }, U.icon('eye')));
    actions.appendChild(U.el('button.icon-btn', { onclick: () => menuSheet(), 'aria-label': '更多' }, U.icon('more')));
    const appbar = document.getElementById('appbar');
    appbar.appendChild(actions);
    // 底部标签跟随内容类型：写小说时高亮「小说」，写文章时高亮「文章」
    UI.setTab(cfg.kind === 'article' ? 'article' : 'novel');
    // 副标题让位给标题，避免顶部拥挤
    const metaRow = document.getElementById('appbarMeta');
    const subEl = document.getElementById('viewSub');
    if (subEl) subEl.style.display = 'none';
    UI.setTitle(cfg.titleText || '', '');

    /* 聚焦模式 */
    let focused = false;
    function focusToggle() {
      focused = !focused;
      document.getElementById('tabbar').style.display = focused ? 'none' : '';
      if (metaRow) metaRow.style.display = focused ? 'none' : '';
      document.querySelectorAll('.meta-strip').forEach((n) => { n.style.opacity = focused ? '0' : ''; });
      if (cfg.panelNodes) cfg.panelNodes.forEach((n) => n.classList.toggle('hidden', focused));
      if (focused) { try { ta.focus(); } catch (e) { /* noop */ } }
      UI.toast(focused ? '已进入专注模式（再点眼睛退出）' : '已退出专注模式', 'eye');
    }

    /* 排版抽屉 */
    function fontSheet() {
      const s = Store.state.settings;
      const slider = U.el('input', { type: 'range', min: '14', max: '30', step: '1', value: String(s.editorFontSize || 18) });
      const lhSlider = U.el('input', { type: 'range', min: '14', max: '30', step: '1', value: String(Math.round((s.editorLineHeight || 1.9) * 10)) });
      const preview = U.el('div.font-preview', { text: '字如其人，落笔成书。The quick brown fox 1234.' });
      /* 预览跟着当前字体走 */
      const curFont = U.FONTS.find((f) => f.id === (s.editorFont || 'serif')) || U.FONTS[0];
      preview.style.fontFamily = curFont.stack;
      const apply = () => {
        const fs = Number(slider.value);
        const lh = Number(lhSlider.value) / 10;
        ta.style.fontSize = fs + 'px';
        ta.style.lineHeight = String(lh);
        preview.style.fontSize = fs + 'px';
        preview.style.lineHeight = String(lh);
        autoGrow(ta);
      };
      slider.addEventListener('input', () => { Store.setSetting('editorFontSize', Number(slider.value)); apply(); });
      lhSlider.addEventListener('input', () => { Store.setSetting('editorLineHeight', Number(lhSlider.value) / 10); apply(); });
      UI.sheet({
        title: '排版',
        body: (host) => {
          U.append(host, [
            U.el('div.field', {}, [U.el('label', { text: '字号' }), slider]),
            U.el('div.field', {}, [U.el('label', { text: '行距' }), lhSlider]),
            preview,
            U.el('div', { style: { height: '12px' } }),
            UI.switchRow('段首自动缩进', '回车自动空两格', s.autoIndent !== false, (v) => { Store.setSetting('autoIndent', v); }),
            U.el('div.field', {}, [
              U.el('label', { text: '正文字体' }),
              (() => {
                const sel = U.el('select.font-sel', {}, U.FONTS.map((f) => U.el('option', {
                  text: f.label, value: f.id, selected: (s.editorFont || 'serif') === f.id
                })));
                const note = U.el('div.field-note', { text: (U.FONTS.find((f) => f.id === (s.editorFont || 'serif')) || U.FONTS[0]).note });
                sel.addEventListener('change', () => {
                  const id = sel.value;
                  Store.setSetting('editorFont', id);
                  U.applyFonts(Store.state.settings);
                  const f = U.FONTS.find((x) => x.id === id) || U.FONTS[0];
                  note.textContent = f.note;
                  /* 等宽字体不用衬线类，避免被覆盖 */
                  ta.classList.toggle('sans', id === 'sans');
                  ta.style.fontFamily = f.stack;
                  preview.style.fontFamily = f.stack;
                  autoGrow(ta);
                });
                return U.el('div', {}, [sel, note]);
              })()
            ]),
            U.el('div.field', {}, [
              U.el('label', { text: '界面字体' }),
              (() => {
                const sel = U.el('select.font-sel', {}, U.UI_FONTS.map((f) => U.el('option', {
                  text: f.label, value: f.id, selected: (s.uiFont || 'system') === f.id
                })));
                sel.addEventListener('change', () => {
                  Store.setSetting('uiFont', sel.value);
                  U.applyFonts(Store.state.settings);
                });
                return sel;
              })()
            ]),
            U.el('div.field-note', { text: '这些字体都是系统自带的免费字体，不联网、不占额外空间；缺失时自动回退，不会出现方框。' })
          ]);
        }
      });
      apply();
    }

    /* 更多菜单 */
    function menuSheet() {
      UI.sheet({
        title: cfg.menuTitle || '操作',
        body: (host) => {
          const list = U.el('div.list');
          (cfg.menu || []).forEach((it) => {
            list.appendChild(U.el('div.row.tap', {
              onclick: () => { UI.closeSheet(); setTimeout(() => it.fn(ta, { titleInput: titleInput, refresh: refresh }), 80); }
            }, [
              U.el('span.row-chev', { style: { color: it.danger ? 'var(--danger)' : 'var(--text-2)' } }, U.icon(it.icon || 'dot', 'ico-sm')),
              U.el('div.row-main', {}, [
                U.el('div.row-title', { text: it.label, style: it.danger ? { color: 'var(--danger)' } : null }),
                it.sub ? U.el('div.row-sub', { text: it.sub }) : null
              ])
            ]));
          });
          U.append(host, list);
        }
      });
    }

    /* 实时刷新状态条 */
    function refresh() {
      const words = U.words(ta.value);
      wordCountEl.textContent = U.fmtInt(words);
      U.clear(goalEl);
      if (cfg.doc.goal) {
        const pct = U.clamp(words / cfg.doc.goal, 0, 1);
        const done = words >= cfg.doc.goal;
        U.append(goalEl, [
          U.el('span', { text: (done ? '✓ ' : '') + Math.round(pct * 100) + '%', style: done ? { color: 'var(--ok)', fontWeight: '650' } : {} }),
          UI.progressBar(pct, 'thin')
        ]);
        goalEl.title = '本章目标 ' + U.fmtInt(cfg.doc.goal) + ' 字';
      } else {
        U.append(goalEl, U.el('button.chip', {
          text: '+ 设目标', onclick: () => UI.input({ title: '本章字数目标', type: 'number', value: '3000' }).then((v) => {
            if (v === null) return;
            const g = Math.max(0, Number(v) || 0);
            cfg.onGoal && cfg.onGoal(g);
            cfg.doc.goal = g;
            refresh();
          })
        }));
      }
      paintNoteBadge();
      try { paintCollabBadge(); } catch (e) { /* 协作未启用 */ }
      return words;
    }

    /* 计时器 & 保存状态 */
    const timer = setInterval(() => {
      const ms = Stats.sessionElapsedMs();
      timeEl.textContent = U.fmtClock(Math.floor(ms / 1000));
      const live = Stats.session();
      if (live && live.itemId === cfg.trackId) saveTag.textContent = '写作中';
      else saveTag.textContent = '已保存';
      saveTag.style.color = (live && live.itemId === cfg.trackId) ? 'var(--accent)' : 'var(--text-3)';
    }, 1000);

    // 自动保存：输入即写内存 + 防抖落盘
    const flushOnLeave = () => { try { Store.flushLocal(); } catch (e) { /* noop */ } };
    window.addEventListener('pagehide', flushOnLeave);

    refresh();
    setTimeout(() => autoGrow(ta), 30);

    // 生成元信息
    function renderMeta(extra) {
      U.clear(metaStrip);
      const parts = [];
      if (cfg.metaText) parts.push(cfg.metaText);
      if (extra) parts.push(extra);
      parts.forEach((p) => metaStrip.appendChild(U.el('span', { text: p })));
      metaStrip.appendChild(U.el('span.spacer'));
      const multiNow = global.Profile && global.Profile.participantsOf
        ? global.Profile.participantsOf(cfg.chapter || cfg.doc) : [];
      if (multiNow.length > 1) {
        metaStrip.appendChild(U.el('span.badge.multi', {
          title: '参与者：' + global.Profile.joinNames(multiNow),
          text: '多人创作 ' + multiNow.length
        }));
      }
      metaStrip.appendChild(U.el('span', { text: U.pick(U.fmtWhen(cfg.doc.updatedAt) + ' 更新', 'Updated ' + U.fmtWhen(cfg.doc.updatedAt)) }));
    }
    renderMeta();
    paintNoteBadge();
    paintCollabBadge();
    refresh();

    /* 从「导入并续写」进来时，自动把续写面板打开 */
    if (UI.hashQuery('continue')) {
      setTimeout(() => { try { continueSheet(); } catch (e) { /* noop */ } }, 400);
      /* 清掉标记，避免刷新时又弹一次 */
      try { history.replaceState(null, '', location.hash.replace(/[?&]continue(=1)?/, '')); } catch (e) { /* noop */ }
    }

    return {
      ta: ta,
      refresh: refresh,
      renderMeta: renderMeta,
      cleanup: () => {
        clearInterval(timer);
        window.removeEventListener('pagehide', flushOnLeave);
        if (appbar.contains(actions)) appbar.removeChild(actions);
        const sub = document.getElementById('viewSub');
        if (sub) sub.style.display = '';
        const mr = document.getElementById('appbarMeta');
        if (mr) mr.style.display = '';
        document.getElementById('tabbar').style.display = '';
        Store.flushLocal();
      }
    };
  }

  /* ================================================================== */
  /* 小说章节                                                          */
  /* ================================================================== */
  /* 私密作品在写作页也要挡住：解锁前不渲染正文，避免被翻到 */
  function gateLocked(view, kind, id) {
    const P = global.Privacy;
    if (!P || !P.isLocked(kind, id) || P.isUnlocked(kind, id)) return false;
    UI.setTitle('私密作品', '需要密码');
    P.lockedView(view, kind, id, null, () => UI.render());
    return true;
  }

  UI.route('editor/:novelId/:chapterId/:sectionId', function (view, p) {
    if (gateLocked(view, 'novel', p.novelId)) return;
    return sectionEditor(view, p.novelId, p.chapterId, p.sectionId);
  });

  UI.route('editor/:novelId/:chapterId', function (view, p) {
    if (gateLocked(view, 'novel', p.novelId)) return;
    return chapterEditor(view, p.novelId, p.chapterId);
  });

  function notFound(view, msg) {
    U.append(view, UI.empty('close', msg || '找不到内容', '它可能已经被删除了', { label: '回到小说', onClick: () => UI.go('novel') }));
  }

  function chapterEditor(view, novelId, chapterId) {
    const novel = Store.findNovel(novelId);
    if (!novel) { notFound(view, '找不到这本小说'); return; }
    const chapter = Store.findChapter(novelId, chapterId);
    if (!chapter) { notFound(view, '找不到这一章'); return; }

    const panelHost = U.el('div');
    let disposePanel = null;

    const desk = writingDesk(view, {
      kind: 'novel',
      owner: novel,
      doc: chapter,
      noteId: novel.id,                    // 便签按整本书归类，不按章节分散
      trackId: novel.id,
      titleText: novel.title,
      menuTitle: chapter.title || '章节操作',
      metaText: '第 ' + (novel.chapters.indexOf(chapter) + 1) + ' 章 · ' + U.fmtInt(Store.novelWords(novel)) + ' 字 / 全书',
      extraPanels: [panelHost],
      placeholder: '正文……（可直接写，也可以先在大纲里排好再写）',
      /* 续写辅助从这里取「接下来该发生什么」：本章关联的大纲节点 + 重点节点 */
      outlineHint: () => {
        try {
          const linked = Store.nodesForChapter(novel.id, chapter.id, null) || [];
          const texts = linked.map((n) => (n.text || '').trim()).filter(Boolean);
          if (texts.length) return texts[0];
          /* 没有关联节点就退而取书里第一个重点节点 */
          let found = '';
          (function walk(list) {
            if (found) return;
            (list || []).forEach((n) => {
              if (found) return;
              if (n.important && (n.text || '').trim()) { found = n.text.trim(); return; }
              walk(n.children);
            });
          })(novel.outline || []);
          return found;
        } catch (e) { return ''; }
      },
      onTitle: (v) => {
        Store.updateChapter(novel.id, chapter.id, { title: v || '未命名章节' });
        UI.setTitle(novel.title, '');
      },
      onGoal: (g) => Store.updateChapter(novel.id, chapter.id, { goal: g }),
      onCommitText: (text) => {
        const live = Store.findChapter(novelId, chapterId);
        const before = live.words || 0;
        const after = Store.setChapterContent(novelId, chapterId, text);
        chapter.words = after;
        // 达标提示（每章只提示一次）
        if (chapter.goal && after >= chapter.goal && before < chapter.goal) {
          UI.toast('本章已达标：' + U.fmtInt(after) + ' 字', 'target');
          global.Ach.evaluate(Store.state, true);
        }
      },
      menu: [
        { label: '本章小结（新建小节）', icon: 'plus', sub: '把一个章节拆成多个小节分别写', fn: () => {
          const title = '小节 ' + ((chapter.sections || []).length + 1);
          const sec = Store.addSection(novel.id, chapter.id, { title: title });
          UI.go('editor/' + novel.id + '/' + chapter.id + '/' + sec.id);
        } },
        { label: '设置字数目标', icon: 'target', fn: () => UI.input({ title: '本章字数目标', type: 'number', value: String(chapter.goal || 0) }).then((v) => { if (v !== null) { Store.updateChapter(novel.id, chapter.id, { goal: Math.max(0, Number(v) || 0) }); UI.render(); } }) },
        { label: '与上一章对照', icon: 'eye', sub: '在弹层里查看上一章内容', fn: () => previewNeighbor(novel, chapter, -1) },
        { label: '与下一章对照', icon: 'eye', fn: () => previewNeighbor(novel, chapter, 1) },
        { label: '查看本书大纲', icon: 'tree', fn: () => UI.go('outline/' + novel.id + '/' + chapter.id) },
        { label: '导出本章 TXT', icon: 'down', fn: () => { IO.exportChapter(novel, chapter, 'txt'); UI.toast('已导出', 'down'); } },
        { label: '导出本章 Markdown', icon: 'down', fn: () => { IO.exportChapter(novel, chapter, 'md'); UI.toast('已导出', 'down'); } },
        { label: '章节列表', icon: 'list', fn: () => UI.go('library/novel/' + novel.id) },
        { label: '删除本章', icon: 'trash', danger: true, fn: () => UI.confirm('删除章节', '「' + chapter.title + '」将被删除，可撤销一次。', '删除', true).then((ok) => {
          if (!ok) return;
          const idx = novel.chapters.indexOf(chapter);
          Store.deleteChapter(novel.id, chapter.id);
          const next = novel.chapters[Math.max(0, idx - 1)] || novel.chapters[0];
          UI.toast('已删除', 'trash');
          if (next) UI.go('editor/' + novel.id + '/' + next.id);
          else UI.go('library/novel/' + novel.id);
        }) }
      ]
    });

    const meta = document.createElement('div');
    U.append(panelHost, meta);

    // 本章大纲面板
    function mountPanel() {
      U.clear(panelHost);
      const holder = U.el('div');
      U.append(panelHost, holder);
      const dispose = outlinePanel(novel, chapter, null, holder);
      return dispose;
    }

    // 上下章切换
    const idx = novel.chapters.indexOf(chapter);
    const prev = novel.chapters[idx - 1], next = novel.chapters[idx + 1];
    if (prev || next) {
      U.append(meta, U.el('div.meta-strip', { style: { paddingTop: '0' } }, [
        prev ? U.el('button.chip', { text: '‹ ' + U.excerpt(prev.title, 8), onclick: () => UI.go('editor/' + novel.id + '/' + prev.id) }) : null,
        U.el('span.spacer'),
        next ? U.el('button.chip', { text: U.excerpt(next.title, 8) + ' ›', onclick: () => UI.go('editor/' + novel.id + '/' + next.id) }) : null
      ]));
    }

    const dispose = mountPanel();
    const deskCleanup = desk.cleanup;
    return function () {
      if (dispose) dispose();
      deskCleanup();
      Store.flushLocal();
      global.Ach.evaluate(Store.state, true);
    };
  }

  function previewNeighbor(novel, chapter, dir) {
    const i = novel.chapters.indexOf(chapter);
    const other = novel.chapters[i + dir];
    if (!other) { UI.toast('没有' + (dir < 0 ? '上一章' : '下一章') + '了', 'close'); return; }
    UI.sheet({
      title: (dir < 0 ? '上一章 · ' : '下一章 · ') + (other.title || ''),
      body: (host) => {
        U.append(host, U.el('div', {
          style: { fontFamily: 'var(--font-serif)', lineHeight: '1.85', whiteSpace: 'pre-wrap', fontSize: '14.5px' },
          text: other.content || '（本章还没有内容）'
        }));
      },
      footer: [
        { label: '跳到这一章', primary: true, onClick: () => UI.go('editor/' + novel.id + '/' + other.id) },
        { label: '关闭', ghost: true }
      ]
    });
  }

  /* ---------------- 小节编辑器 ---------------- */
  function sectionEditor(view, novelId, chapterId, sectionId) {
    const novel = Store.findNovel(novelId);
    const chapter = Store.findChapter(novelId, chapterId);
    const section = Store.findSection(novelId, chapterId, sectionId);
    if (!novel || !chapter || !section) { notFound(view, '找不到这一节'); return; }

    const panelHost = U.el('div');
    const desk = writingDesk(view, {
      kind: 'novel',
      owner: novel,
      doc: section,
      noteId: novel.id,
      trackId: novel.id,
      titleText: novel.title + ' · ' + chapter.title,
      menuTitle: section.title || '小节操作',
      metaText: chapter.title + ' · 小节',
      extraPanels: [panelHost],
      placeholder: '这一节的内容……',
      onTitle: (v) => Store.updateSection(novel.id, chapter.id, section.id, { title: v || '小节' }),
      onCommitText: (text) => {
        Store.updateSection(novel.id, chapter.id, section.id, { content: text });
        Store.commit(null, { kind: 'section:typing', itemId: novel.id, silent: true });
      },
      menu: [
        { label: '返回本章正文', icon: 'arrowLeft', fn: () => UI.go('editor/' + novel.id + '/' + chapter.id) },
        { label: '查看本书大纲', icon: 'tree', fn: () => UI.go('outline/' + novel.id + '/' + chapter.id + '/' + section.id) },
        { label: '导出本章（含所有小节）', icon: 'down', fn: () => { IO.exportChapter(novel, chapter, 'txt'); UI.toast('已导出', 'down'); } },
        { label: '删除本节', icon: 'trash', danger: true, fn: () => UI.confirm('删除小节', '「' + section.title + '」将被删除。', '删除', true).then((ok) => {
          if (!ok) return;
          Store.deleteSection(novel.id, chapter.id, section.id);
          UI.toast('已删除', 'trash');
          UI.go('editor/' + novel.id + '/' + chapter.id);
        }) }
      ]
    });

    const holder = U.el('div');
    U.append(panelHost, holder);
    const dispose = outlinePanel(novel, chapter, section.id, holder);

    return function () {
      if (dispose) dispose();
      desk.cleanup();
      Store.flushLocal();
    };
  }

  /* ================================================================== */
  /* 文章                                                              */
  /* ================================================================== */
  UI.route('editor/:articleId', function (view, p) {
    const a = Store.findArticle(p.articleId);
    if (!a) { notFound(view, '找不到这篇文章'); return; }
    if (gateLocked(view, 'article', a.id)) return;

    const desk = writingDesk(view, {
      kind: 'article',
      owner: a,
      doc: a,
      trackId: a.id,
      titleText: '文章',
      menuTitle: a.title || '文章操作',
      metaText: '文章 · ' + U.fmtInt(Store.articleWords(a)) + ' 字',
      placeholder: '写点什么……',
      onTitle: (v) => Store.updateArticle(a.id, { title: v || '未命名文章' }),
      onGoal: () => {},
      onCommitText: (text) => {
        Store.setArticleContent(a.id, text);
      },
      menu: [
        { label: '设置标签', icon: 'flag', fn: () => UI.input({ title: '标签', value: (a.tags || []).join(' '), hint: '用空格分隔多个标签' }).then((v) => { if (v !== null) Store.updateArticle(a.id, { tags: v ? v.split(/\s+/) : [] }); }) },
        { label: '导出 TXT', icon: 'down', fn: () => { IO.exportItem('article', a, 'txt'); UI.toast('已导出', 'down'); } },
        { label: '导出 Markdown', icon: 'down', fn: () => { IO.exportItem('article', a, 'md'); UI.toast('已导出', 'down'); } },
        { label: '复制全文', icon: 'copy', fn: (ta) => { U.copyText(ta.value).then((ok) => UI.toast(ok ? '已复制' : '复制失败', 'copy')); } },
        { label: '字数与目标', icon: 'target', fn: () => UI.input({ title: '文章字数目标', type: 'number', value: String(a.goal || 0) }).then((v) => {
          if (v === null) return;
          const g = Math.max(0, Number(v) || 0);
          Store.updateArticle(a.id, { goal: g });
          a.goal = g;
          UI.render();
        }) },
        { label: '回到文章列表', icon: 'doc', fn: () => UI.go('article') },
        { label: '删除文章', icon: 'trash', danger: true, fn: () => UI.confirm('删除文章', '「' + a.title + '」将被删除，可撤销一次。', '删除', true).then((ok) => {
          if (!ok) return;
          Store.deleteArticle(a.id);
          UI.toast('已删除', 'trash');
          UI.go('article');
        }) }
      ]
    });

    return function () { desk.cleanup(); Store.flushLocal(); global.Ach.evaluate(Store.state, true); };
  });

  global.EditorView = Ed;
})(window);
