/* ==========================================================================
   selfwriting · view-outline.js
   大纲：彩色分支树 · 重点标记 · 与章节/小节互链
     · 在这里改，写作页的「本章大纲」立刻同步；在写作页改，这里也立刻同步
     · 同一个节点可标记颜色（区分故事线 / 人物线 / 时间线）与重点
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const UI = global.UI;
  const Store = global.Store;
  const IO = global.IOApi;
  const OV = {};

  /* 折叠状态在本次会话内保持 */
  const collapsed = {};
  let onlyImportant = false;

  /* ================================================================== */
  /* 汇总                                                              */
  /* ================================================================== */
  function treeStats(nodes) {
    const s = { nodes: 0, marks: 0, linked: 0, colors: {}, depth: 0 };
    const walk = (list, d) => {
      s.depth = Math.max(s.depth, d);
      (list || []).forEach((n) => {
        s.nodes++;
        if (n.important) s.marks++;
        if (n.linkChapterId) s.linked++;
        if (n.color) s.colors[n.color] = (s.colors[n.color] || 0) + 1;
        walk(n.children, d + 1);
      });
    };
    walk(nodes, 1);
    return s;
  }

  /* ================================================================== */
  /* 顶部：大纲入口                                                    */
  /* ================================================================== */
  UI.route('outline', function (view) {
    UI.setTitle('大纲', '');
    const st = Store.state;

    const rows = [];
    st.novels.forEach((n) => rows.push({ kind: 'novel', owner: n, title: n.title, sub: '小说 · ' + (n.chapters || []).length + ' 章', stats: treeStats(n.outline) }));
    st.articles.forEach((a) => { if ((a.outline || []).length) rows.push({ kind: 'article', owner: a, title: a.title, sub: '文章', stats: treeStats(a.outline) }); });

    U.append(view, U.el('div.card', {}, [
      U.el('div', { text: '大纲与正文是同一份数据', style: { fontWeight: '650', fontSize: '14.5px' } }),
      U.el('div', {
        text: '在写作页面可以随时展开「本章大纲」边写边看；大纲改动会即时同步到正文页，反之亦然。用颜色区分分支，用星标标注重点。',
        style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '6px', lineHeight: '1.7' }
      }),
      U.el('div.grid2', { style: { marginTop: '12px' } }, [
        U.el('button.btn.primary', { onclick: () => OV.createFlow() }, [U.icon('plus', 'ico-sm'), U.el('span', { text: '新建大纲' })]),
        U.el('button.btn', { onclick: () => selectNovel() }, [U.icon('book', 'ico-sm'), U.el('span', { text: '打开小说大纲' })])
      ])
    ]));

    const withOutline = rows.filter((r) => r.stats.nodes > 0);
    if (!withOutline.length) {
      U.append(view, UI.empty('tree', '还没有大纲', '为小说建一棵大纲树，写作时随时对照。'));
      return;
    }

    U.append(view, U.el('div.section-title', {}, [U.icon('list', 'ico-sm'), U.el('span', { text: '所有大纲' }), U.el('span.spacer'), U.el('span', { text: withOutline.length + ' 个', style: { fontWeight: '500' } })]));
    const list = U.el('div');
    withOutline.forEach((r) => {
      const s = r.stats;
      const legend = Object.keys(s.colors).slice(0, 6);
      const card = U.el('div.card.tap', { onclick: () => UI.go('outline/' + r.owner.id) }, [
        U.el('div.card-head', {}, [
          U.icon(r.kind === 'novel' ? 'feather' : 'doc', 'ico-sm'),
          U.el('div.card-title', { text: r.title }),
          U.el('button.icon-btn', {
            onclick: (e) => {
              e.stopPropagation();
              UI.go('outline/' + r.owner.id);
            }, 'aria-label': '打开'
          }, U.icon('chevron', 'ico-sm'))
        ]),
        U.el('div.card-sub', {}, [
          U.el('span', { text: r.sub }),
          U.el('span', { text: s.nodes + ' 个节点' }),
          U.el('span', { text: s.marks + ' 个重点' }),
          U.el('span', { text: s.linked + ' 处联动' })
        ]),
        legend.length ? U.el('div.color-dots', { style: { paddingTop: '8px' } }, legend.map((c) => U.el('span.dot', { style: { background: c, width: '12px', height: '12px' } }))) : null
      ]);
      list.appendChild(card);
    });
    U.append(view, list);

    U.append(view, U.el('div.section-title', {}, [U.icon('palette', 'ico-sm'), U.el('span', { text: '颜色约定（可自定义）' })]));
    U.append(view, U.el('div.card', {}, [
      U.el('div', { style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '8px' }, text: '给分支选颜色后，节点左侧的竖条与写作页的对照面板都会显示同一种颜色。' }),
      U.el('div.color-dots', {}, Store.PALETTE.map((p) => U.el('div', { style: { textAlign: 'center' } }, [
        U.el('span.color-dot', { style: { background: p.value, display: 'inline-block' } }),
        U.el('div', { text: p.name, style: { fontSize: '10px', color: 'var(--text-3)', marginTop: '4px' } })
      ])))
    ]));
  });

  function selectNovel() {
    const items = Store.state.novels.map((n) => ({ label: n.title, sub: (n.chapters || []).length + ' 章 · ' + treeStats(n.outline).nodes + ' 个大纲节点', value: n.id, icon: 'feather' }));
    if (!items.length) { UI.alert('还没有小说', '先创建一本小说，再为它写大纲。'); return; }
    UI.choose({ title: '选择小说', items: items }).then((id) => { if (id) UI.go('outline/' + id); });
  }

  /** 新建大纲：挂到某本小说 / 某篇文章下 */
  OV.createFlow = function () {
    const items = [
      { label: '新建一本小说并写大纲', sub: '先有大纲，再动笔', value: 'novel', icon: 'feather' },
      { label: '新建一篇文章并写大纲', sub: '为长文先搭骨架', value: 'article', icon: 'doc' }
    ];
    Store.state.novels.forEach((n) => items.push({ label: '为《' + n.title + '》写大纲', sub: (n.chapters || []).length + ' 章', value: 'n:' + n.id, icon: 'book' }));
    UI.choose({ title: '大纲挂在哪里', items: items }).then((val) => {
      if (!val) return;
      if (val === 'novel') {
        const n = Store.createNovel({ title: '未命名小说' });
        UI.go('outline/' + n.id);
      } else if (val === 'article') {
        const a = Store.createArticle({ title: '未命名文章' });
        UI.go('outline/' + a.id);
      } else if (val.slice(0, 2) === 'n:') {
        UI.go('outline/' + val.slice(2));
      }
    });
  };

  /* ================================================================== */
  /* 大纲主体                                                          */
  /* ================================================================== */
  UI.route('outline/:ownerId', function (view, p) { return renderTree(view, p.ownerId, null, null); });
  UI.route('outline/:ownerId/:chapterId', function (view, p) { return renderTree(view, p.ownerId, p.chapterId, null); });
  UI.route('outline/:ownerId/:chapterId/:sectionId', function (view, p) { return renderTree(view, p.ownerId, p.chapterId, p.sectionId); });

  function renderTree(view, ownerId, chapterId, sectionId) {
    const owner = Store.findNovel(ownerId) || Store.findArticle(ownerId);
    if (!owner) {
      U.append(view, UI.empty('close', '找不到对应作品', '', { label: '回到大纲', onClick: () => UI.go('outline') }));
      return;
    }
    const isNovel = owner.type === 'novel';
    const focusChapter = chapterId ? Store.findChapter(ownerId, chapterId) : null;
    const focusSection = sectionId ? Store.findSection(ownerId, chapterId, sectionId) : null;

    const stats = treeStats(owner.outline);
    UI.setTitle(
      (focusSection ? focusSection.title : focusChapter ? focusChapter.title : owner.title) + ' · 大纲',
      stats.nodes + ' 个节点 · ' + stats.marks + ' 个重点 · ' + stats.linked + ' 处联动'
    );

    /* ---- 顶部：作用域与工具 ---- */
    const scopeChips = U.el('div.chips.scroll');
    scopeChips.appendChild(U.el('button.chip' + (!chapterId ? '.active' : ''), { text: '全部大纲', onclick: () => UI.go('outline/' + ownerId) }));
    if (isNovel) {
      scopeChips.appendChild(U.el('button.chip', {
        text: '跳转到章节…', onclick: () => pickChapter(owner, (ch) => UI.go('outline/' + ownerId + '/' + ch.id))
      }));
    }
    U.append(view, scopeChips);

    if (focusChapter) {
      U.append(view, U.el('div.card', { style: { marginTop: '10px', borderLeft: '3px solid var(--accent)' } }, [
        U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          U.icon('target', 'ico-sm'),
          U.el('strong', { text: (focusSection ? '小节：' : '章节：') + (focusSection ? focusSection.title : focusChapter.title), style: { fontSize: '13.5px' } }),
          U.el('span', { style: { flex: '1 1 auto' } }),
          U.el('button.chip', { text: '去写作', onclick: () => UI.go('editor/' + ownerId + '/' + chapterId + (sectionId ? '/' + sectionId : '')) })
        ]),
        U.el('div', { text: '点击节点右侧的「链接」按钮，可把它关联到当前' + (focusSection ? '小节' : '章节') + '；关联后写作页会实时显示。', style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '6px' } })
      ]));
    }

    const toolbar = U.el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' } }, [
      U.el('button.btn.sm.primary', { onclick: () => addNode(null) }, [U.icon('plus', 'ico-sm'), U.el('span', { text: '新增分支' })]),
      U.el('button.chip' + (onlyImportant ? '.active' : ''), {
        text: '只看重点', onclick: () => { onlyImportant = !onlyImportant; UI.render(); }
      }),
      U.el('button.chip', { text: '展开全部', onclick: () => { Object.keys(collapsed).forEach((k) => delete collapsed[k]); UI.render(); } }),
      U.el('button.chip', { text: '导出', onclick: () => exportSheet(owner) }),
      U.el('button.chip', { text: '更多', onclick: () => ownerMenu(owner) })
    ]);
    U.append(view, toolbar);

    /* ---- 树 ---- */
    const treeHost = U.el('div.outline-tree');
    U.append(view, treeHost);

    function renderTreeNodes() {
      U.clear(treeHost);
      if (!(owner.outline || []).length) {
        U.append(treeHost, UI.empty('tree', '大纲还是空的', '先写主干，再长枝叶：故事线、人物线、章节安排都可以。', { label: '新增第一个节点', onClick: () => addNode(null) }));
        return;
      }
      owner.outline.forEach((node, i) => treeHost.appendChild(nodeView(node, 0, owner.outline, i)));
      U.append(treeHost, U.el('div', { style: { marginTop: '12px', textAlign: 'center' } }, U.el('button.btn.sm.ghost', { onclick: () => addNode(null) }, [U.icon('plus', 'ico-sm'), U.el('span', { text: '继续添加主干节点' })])));
    }

    /** 递归渲染一个节点 */
    function nodeView(node, depth, siblings, index) {
      const wrap = U.el('div.ot-node', { dataset: { id: node.id } });
      const kids = node.children || [];
      const isCollapsed = !!collapsed[node.id];

      if (onlyImportant && !node.important && !kids.some(hasImportant)) return wrap;

      const twist = U.el('button.ot-twist' + (kids.length ? (isCollapsed ? '' : '.open') : '.leaf'), {
        onclick: (e) => {
          e.stopPropagation();
          collapsed[node.id] = !collapsed[node.id];
          renderTreeNodes();
        }
      }, U.icon('chevron'));

      const textEl = U.el('div.ot-text' + (node.text ? '' : '.empty-text'), {
        text: node.text || '（点击输入内容）',
        contenteditable: 'true',
        spellcheck: 'false',
        onfocus: () => { if (!node.text) textEl.textContent = ''; },
        onblur: () => {
          const v = textEl.textContent.replace(/\n+$/, '').trim();
          if (!node.text && !v) { textEl.textContent = '（点击输入内容）'; textEl.classList.add('empty-text'); return; }
          if (v !== (node.text || '')) Store.updateOutlineNode(ownerId, node.id, { text: v });
        },
        onkeydown: (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const v = textEl.textContent.trim();
            if (v !== (node.text || '')) Store.updateOutlineNode(ownerId, node.id, { text: v });
            const created = Store.addOutlineNode(ownerId, node.id, { color: node.color, colorName: node.colorName });
            setTimeout(() => {
              const el = treeHost.querySelector('[data-id="' + created.id + '"] .ot-text');
              if (el) { el.focus(); document.execCommand && document.execCommand('selectAll', false, null); }
            }, 60);
          }
        }
      });

      const meta = U.el('div.ot-meta');
      if (node.important) meta.appendChild(U.el('span.badge.warn', {}, [U.icon('star', 'ico-sm'), U.el('span', { text: '重点' })]));
      if (node.colorName) meta.appendChild(U.el('span.badge', {}, [U.el('span.dot', { style: { background: node.color } }), U.el('span', { text: node.colorName })]));
      if (node.linkChapterId) {
        const ch = Store.findChapter(ownerId, node.linkChapterId);
        const sec = node.linkSectionId ? Store.findSection(ownerId, node.linkChapterId, node.linkSectionId) : null;
        if (ch) {
          meta.appendChild(U.el('button.badge.accent', {
            style: { border: 'none' },
            onclick: () => UI.go('editor/' + ownerId + '/' + ch.id + (sec ? '/' + sec.id : ''))
          }, [U.icon('link', 'ico-sm'), U.el('span', { text: (sec ? sec.title : ch.title) })]));
        }
      }
      if (kids.length) meta.appendChild(U.el('span', { text: kids.length + ' 个子节点' }));

      const actions = U.el('div.ot-actions', {}, [
        U.el('button.icon-btn', {
          title: '重点', 'aria-label': '重点',
          onclick: () => { Store.updateOutlineNode(ownerId, node.id, { important: !node.important }); UI.toast(node.important ? '已取消重点' : '已标记重点', 'star'); }
        }, U.icon('star', 'ico-sm')),
        U.el('button.icon-btn', {
          title: '颜色', 'aria-label': '颜色',
          onclick: () => colorSheet(node)
        }, U.icon('palette', 'ico-sm')),
        U.el('button.icon-btn', {
          title: '添加子节点', 'aria-label': '添加子节点',
          onclick: () => addNode(node.id)
        }, U.icon('plus', 'ico-sm')),
        U.el('button.icon-btn', {
          title: '更多', 'aria-label': '更多',
          onclick: () => nodeMenu(node, siblings, index, depth)
        }, U.icon('more', 'ico-sm'))
      ]);

      const row = U.el('div.ot-row.tap' + (node.important ? '.important' : ''), {
        style: { borderLeftColor: node.color || 'var(--line-strong)' }
      }, [
        twist,
        U.el('div.ot-main', {}, [textEl, meta]),
        actions
      ]);
      wrap.appendChild(row);

      if (kids.length) {
        const kidBox = U.el('div.ot-kids' + (isCollapsed ? '.collapsed' : ''));
        kids.forEach((k, i) => kidBox.appendChild(nodeView(k, depth + 1, kids, i)));
        wrap.appendChild(kidBox);
      }
      return wrap;
    }

    function hasImportant(n) {
      if (n.important) return true;
      return (n.children || []).some(hasImportant);
    }

    /* ---- 新增节点 ---- */
    function addNode(parentId) {
      UI.input({
        title: parentId ? '新增子节点' : '新增主干节点',
        placeholder: '例如：主角身世之谜 / 第二章 转折',
        multiline: true,
        rows: 3,
        hint: '回车换行，Shift+回车也可换行；确认后会立即出现在树里'
      }).then((text) => {
        if (text === null) return;
        const parent = parentId ? Store.findOutlineNode(ownerId, parentId) : null;
        const node = Store.addOutlineNode(ownerId, parentId, {
          text: text || '',
          color: parent ? parent.color : null,
          colorName: parent ? parent.colorName : ''
        });
        // 顺手关联当前章节
        if (chapterId && focusChapter) {
          const existing = Store.nodesForChapter(ownerId, chapterId, sectionId || null);
          if (!existing.length) Store.linkOutlineNode(ownerId, node.id, chapterId, sectionId || null, '');
        }
        UI.render();
        setTimeout(() => {
          const el = treeHost.querySelector('[data-id="' + node.id + '"] .ot-text');
          if (el) el.focus();
        }, 80);
      });
    }

    /* ---- 颜色 ---- */
    function colorSheet(node) {
      UI.sheet({
        title: '分支颜色',
        body: (host) => {
          const dots = U.el('div.color-dots');
          Store.PALETTE.forEach((p) => {
            const sel = node.color === p.value;
            const d = U.el('button.color-dot' + (sel ? '.sel' : ''), {
              style: { background: p.value }, title: p.name,
              onclick: () => {
                const next = sel ? null : p.value;
                const nm = sel ? '' : p.name;
                Store.updateOutlineNode(ownerId, node.id, { color: next, colorName: nm });
                if (!sel && recolorChildren) applyColorToChildren(node, next, nm);
                UI.closeSheet();
                UI.render();
              }
            });
            if (sel) d.appendChild(U.icon('check', 'ico-sm'));
            dots.appendChild(d);
          });
          let recolorChildren = true;
          U.append(host, [
            U.el('div', { text: '给这一支上色，颜色会一路继承到子节点（可在下方关闭）。', style: { fontSize: '11.5px', color: 'var(--text-3)', marginBottom: '8px' } }),
            dots,
            UI.switchRow('同时应用到子节点', '整条分支保持同色，便于区分故事线', true, (v) => { recolorChildren = v; })
          ]);
        }
      });
    }

    function applyColorToChildren(node, color, colorName) {
      Store.walkTree(node.children || [], (nd) => {
        nd.color = color;
        nd.colorName = colorName;
      });
      Store.updateOutlineNode(ownerId, node.id, { color: color, colorName: colorName });
    }

    /* ---- 节点菜单 ---- */
    function nodeMenu(node, siblings, index, depth) {
      const items = [];
      items.push({ label: '编辑详情', icon: 'edit', fn: () => editSheet(node) });
      if (focusChapter && isNovel) {
        items.push({
          label: '关联到当前' + (focusSection ? '小节' : '章节'), icon: 'link',
          fn: () => { Store.linkOutlineNode(ownerId, node.id, chapterId, sectionId || null, ''); UI.toast('已关联', 'link'); UI.render(); }
        });
      } else if (isNovel) {
        items.push({ label: '关联到章节…', icon: 'link', fn: () => linkChapterSheet(node) });
      }
      if (node.linkChapterId) items.push({ label: '取消关联', icon: 'close', fn: () => { Store.updateOutlineNode(ownerId, node.id, { linkChapterId: null, linkSectionId: null, linkTitle: '' }); UI.render(); } });
      items.push({ label: '上移', icon: 'up', fn: () => { if (index > 0) { Store.moveOutlineNode(ownerId, node.id, siblings[index - 1].id, 'before'); UI.render(); } } });
      items.push({ label: '下移', icon: 'down', fn: () => { if (index < siblings.length - 1) { Store.moveOutlineNode(ownerId, node.id, siblings[index + 1].id, 'after'); UI.render(); } } });
      items.push({ label: '升级（移出父节点）', icon: 'arrowLeft', fn: () => {
        if (!depth) { UI.toast('已经是主干节点', 'close'); return; }
        Store.moveOutlineNode(ownerId, node.id, null, 'end'); UI.render();
      } });
      items.push({ label: '复制节点', icon: 'copy', fn: () => {
        const copy = Store.addOutlineNode(ownerId, null, { text: node.text, note: node.note, color: node.color, colorName: node.colorName, important: node.important });
        (node.children || []).forEach((k) => cloneNode(k, copy.id));
        UI.render(); UI.toast('已复制整支', 'copy');
      } });
      items.push({ label: '删除节点（含子节点）', icon: 'trash', danger: true, fn: () => {
        UI.confirm('删除节点', '「' + U.excerpt(node.text, 20) + '」及其所有子节点都会被删除。', '删除', true).then((ok) => {
          if (ok) { Store.deleteOutlineNode(ownerId, node.id); UI.render(); }
        });
      } });
      UI.sheet({
        title: U.excerpt(node.text, 18) || '节点操作',
        body: (host) => {
          const list = U.el('div.list');
          items.forEach((it) => list.appendChild(U.el('div.row.tap', { onclick: () => { UI.closeSheet(); setTimeout(it.fn, 80); } }, [
            U.el('span.row-chev', { style: { color: it.danger ? 'var(--danger)' : 'var(--text-2)' } }, U.icon(it.icon, 'ico-sm')),
            U.el('div.row-main', {}, U.el('div.row-title', { text: it.label, style: it.danger ? { color: 'var(--danger)' } : null }))
          ])));
          U.append(host, list);
        }
      });
    }

    function cloneNode(src, parentId) {
      const n = Store.addOutlineNode(ownerId, parentId, { text: src.text, note: src.note, color: src.color, colorName: src.colorName, important: src.important });
      (src.children || []).forEach((k) => cloneNode(k, n.id));
    }

    /* ---- 详情编辑 ---- */
    function editSheet(node) {
      const text = U.el('textarea.textarea', { rows: 4, placeholder: '大纲内容' });
      text.value = node.text || '';
      const note = U.el('textarea.textarea', { rows: 2, placeholder: '备注 / 细节（只有大纲里能看到）' });
      note.value = node.note || '';
      const dots = U.el('div.color-dots');
      let color = node.color, colorName = node.colorName;
      Store.PALETTE.forEach((p) => {
        const d = U.el('button.color-dot' + (node.color === p.value ? '.sel' : ''), {
          style: { background: p.value }, title: p.name,
          onclick: (e) => {
            const sel = color === p.value;
            color = sel ? null : p.value;
            colorName = sel ? '' : p.name;
            U.$$('.color-dot', dots).forEach((x) => x.classList.remove('sel'));
            if (!sel) e.currentTarget.classList.add('sel');
          }
        });
        dots.appendChild(d);
      });
      let important = !!node.important;
      UI.sheet({
        title: '节点详情',
        autoFocus: true,
        body: (host) => {
          U.append(host, [
            U.el('div.field', {}, [U.el('label', { text: '内容' }), text]),
            U.el('div.field', {}, [U.el('label', { text: '备注' }), note]),
            U.el('div.field', {}, [U.el('label', { text: '分支颜色' }), dots]),
            UI.switchRow('标记为重点', '重点节点在所有视图里都会高亮', important, (v) => { important = v; })
          ]);
        },
        footer: [
          { label: '取消', ghost: true },
          { label: '保存', primary: true, onClick: () => {
            Store.updateOutlineNode(ownerId, node.id, { text: text.value.trim(), note: note.value.trim(), color: color, colorName: colorName, important: important });
            UI.render();
          } }
        ]
      });
    }

    /* ---- 关联章节 ---- */
    function linkChapterSheet(node) {
      if (!isNovel) { UI.toast('文章没有章节，可在大纲里直接写结构', 'close'); return; }
      const items = [];
      (owner.chapters || []).forEach((c) => {
        items.push({ label: c.title, sub: U.fmtInt(c.words || 0) + ' 字', value: c.id, icon: 'doc' });
        (c.sections || []).forEach((s) => items.push({ label: '　└ ' + s.title, sub: c.title + ' · 小节', value: c.id + '::' + s.id, icon: 'dot' }));
      });
      if (!items.length) { UI.alert('还没有章节', '先在小说的章节列表里新增章节。'); return; }
      UI.choose({ title: '关联到…', items: items }).then((val) => {
        if (!val) return;
        const parts = val.split('::');
        Store.linkOutlineNode(ownerId, node.id, parts[0], parts[1] || null, '');
        UI.toast('已关联', 'link');
        UI.render();
      });
    }

    /* ---- 导出 / 更多 ---- */
    function exportSheet(o) {
      UI.sheet({
        title: '导出大纲',
        body: (host) => {
          U.append(host, U.el('div.list', {}, [
            U.el('div.row.tap', { onclick: () => { UI.closeSheet(); IO.download((o.title || '大纲') + '-大纲.txt', IO.outlineToText(o.outline, { title: o.title }), 'text/plain'); UI.toast('已导出 TXT', 'down'); } }, [
              U.el('span.row-chev', {}, U.icon('down', 'ico-sm')),
              U.el('div.row-main', {}, [U.el('div.row-title', { text: '导出为 TXT' }), U.el('div.row-sub', { text: '缩进树 + 颜色/重点标注' })])
            ]),
            U.el('div.row.tap', { onclick: () => { UI.closeSheet(); IO.exportItem('outline', o, 'md'); UI.toast('已导出 Markdown', 'down'); } }, [
              U.el('span.row-chev', {}, U.icon('down', 'ico-sm')),
              U.el('div.row-main', {}, [U.el('div.row-title', { text: '导出为 Markdown' })])
            ]),
            U.el('div.row.tap', { onclick: () => {
              UI.closeSheet();
              const lines = [];
              const walk = (list, d) => (list || []).forEach((n) => {
                lines.push('  '.repeat(d) + '- ' + String(n.text || '').replace(/\n/g, ' ') + (n.important ? ' ★' : '') + (n.linkChapterId ? ' (已关联)' : ''));
                walk(n.children, d + 1);
              });
              walk(o.outline, 0);
              U.copyText(lines.join('\n')).then((ok) => UI.toast(ok ? '大纲已复制到剪贴板' : '复制失败', 'copy'));
            } }, [
              U.el('span.row-chev', {}, U.icon('copy', 'ico-sm')),
              U.el('div.row-main', {}, [U.el('div.row-title', { text: '复制为 Markdown 列表' })])
            ])
          ]));
        }
      });
    }

    function ownerMenu(o) {
      const items = [
        { label: '重命名作品', icon: 'edit', fn: () => UI.input({ title: '名称', value: o.title }).then((v) => {
          if (!v) return;
          if (o.type === 'novel') Store.updateNovel(o.id, { title: v }); else Store.updateArticle(o.id, { title: v });
          UI.render();
        }) },
        { label: '导入大纲文本', icon: 'up', sub: '每行一个节点，用缩进表示层级', fn: () => importOutline(o) },
        { label: '清空大纲', icon: 'trash', danger: true, fn: () => UI.confirm('清空大纲', '所有节点都会被删除，不可撤销。', '清空', true).then((ok) => {
          if (!ok) return;
          Store.commit((s) => {
            const own = Store.findNovel(o.id) || Store.findArticle(o.id);
            own.outline = [];
          }, { kind: 'outline:clear', itemId: o.id });
          UI.render();
        }) }
      ];
      if (o.type === 'novel') items.push({ label: '去写正文', icon: 'feather', fn: () => UI.go('library/novel/' + o.id) });
      UI.sheet({
        title: '大纲操作',
        body: (host) => {
          const list = U.el('div.list');
          items.forEach((it) => list.appendChild(U.el('div.row.tap', { onclick: () => { UI.closeSheet(); setTimeout(it.fn, 80); } }, [
            U.el('span.row-chev', { style: { color: it.danger ? 'var(--danger)' : 'var(--text-2)' } }, U.icon(it.icon, 'ico-sm')),
            U.el('div.row-main', {}, [U.el('div.row-title', { text: it.label, style: it.danger ? { color: 'var(--danger)' } : null }), it.sub ? U.el('div.row-sub', { text: it.sub }) : null])
          ])));
          U.append(host, list);
        }
      });
    }

    function importOutline(o) {
      IO.pickFile('.txt,.md,.markdown', true).then((files) => {
        if (!files.length) return;
        Promise.all(files.map((f) => U.readFileAsText(f))).then((texts) => {
          let count = 0;
          texts.forEach((txt) => {
            const stack = [{ id: null, indent: -1 }];
            txt.replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
              if (!line.trim()) return;
              const m = /^([\s\t]*)(?:[-*+•]|\d+[.)])?\s*(.*)$/.exec(line);
              const indent = (m[1] || '').replace(/\t/g, '  ').length;
              const text = (m[2] || '').replace(/\s*(★|\[重点\])\s*$/, '');
              const important = /(★|\[重点\])/.test(line);
              while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
              const parentId = stack[stack.length - 1].id;
              const node = Store.addOutlineNode(o.id, parentId, { text: text, important: important });
              stack.push({ id: node.id, indent: indent });
              count++;
            });
          });
          Store.commit(null, { kind: 'import' });
          UI.toast('已导入 ' + count + ' 个节点', 'check');
          UI.render();
        });
      });
    }

    function pickChapter(o, cb) {
      const items = (o.chapters || []).map((c) => ({ label: c.title, sub: U.fmtInt(c.words || 0) + ' 字 · ' + (c.sections || []).length + ' 小节', value: c.id, icon: 'doc' }));
      if (!items.length) { UI.alert('还没有章节', '先在这本小说里新增章节。'); return; }
      UI.choose({ title: '选择章节', items: items }).then((id) => { if (id) cb(Store.findChapter(o.id, id)); });
    }

    renderTreeNodes();

    /* 数据变化时重绘（写作页改动 → 大纲立即更新） */
    const unsub = Store.subscribe((s, meta) => {
      if (!meta || !meta.kind) return;
      if (meta.itemId && meta.itemId !== ownerId) return;
      if (/^(outline|chapter|section|novel|import)/.test(meta.kind)) {
        const active = document.activeElement;
        if (active && active.isContentEditable && treeHost.contains(active)) return; // 正在输入，不打断
        const scrollTop = document.getElementById('view').scrollTop;
        renderTreeNodes();
        document.getElementById('view').scrollTop = scrollTop;
      }
    });
    return function () { unsub(); };
  }

  global.OutlineView = OV;
})(window);
