/* ==========================================================================
   selfwriting · view-library.js
   书架：小说 / 文章 / 日记本 / 读物总览、新建、条目详情、导入导出
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const UI = global.UI;
  const Store = global.Store;
  const IO = global.IOApi;
  const T = global.Taxonomy;     // 分类体系（题材 / 文章类型 / 记录周期…）
  const Lib = {};

  /* ================================================================== */
  /* 工具                                                              */
  /* ================================================================== */
  function wordLine(n) { return U.fmtInt(n) + ' 字'; }

  function menuBtn(onClick, iconName) {
    return U.el('button.icon-btn', {
      onclick: (e) => { e.stopPropagation(); onClick(e); },
      'aria-label': '更多'
    }, U.icon(iconName || 'more', 'ico-sm'));
  }

  /** 条目「更多」菜单 */
  Lib.itemMenu = function (kind, item, opts) {
    const o = opts || {};
    const items = [];
    items.push({ label: '重命名', icon: 'edit', fn: () => renameItem(kind, item) });
    if (kind === 'novel') {
      items.push({ label: '编辑书籍信息', icon: 'doc', fn: () => editNovelInfo(item) });
      items.push({ label: '标记为已完结', icon: 'check', fn: () => toggleFinished(item) });
      items.push({ label: '导出为 TXT', icon: 'down', fn: () => { IO.exportItem('novel', item, 'txt'); UI.toast('已导出 TXT', 'down'); } });
      items.push({ label: '导出为 Markdown', icon: 'down', fn: () => { IO.exportItem('novel', item, 'md'); UI.toast('已导出 Markdown', 'down'); } });
      items.push({ label: '导出大纲', icon: 'tree', fn: () => { IO.exportItem('outline', item, 'txt'); UI.toast('已导出大纲', 'tree'); } });
    } else if (kind === 'article') {
      items.push({ label: '导出为 TXT', icon: 'down', fn: () => { IO.exportItem('article', item, 'txt'); UI.toast('已导出', 'down'); } });
      items.push({ label: '导出为 Markdown', icon: 'down', fn: () => { IO.exportItem('article', item, 'md'); UI.toast('已导出', 'down'); } });
    } else if (kind === 'diaryBook') {
      items.push({ label: '导出为 TXT', icon: 'down', fn: () => { IO.exportItem('diaryBook', item, 'txt'); UI.toast('已导出', 'down'); } });
      items.push({ label: '导出为 Markdown', icon: 'down', fn: () => { IO.exportItem('diaryBook', item, 'md'); UI.toast('已导出', 'down'); } });
      items.push({ label: '导入日记文本', icon: 'up', fn: () => importDiaryInto(item) });
    } else if (kind === 'book') {
      items.push({ label: '导出当前读物文本', icon: 'down', fn: () => {
        const text = (item.chapters || []).map((c) => c.title + '\n\n' + c.content).join('\n\n');
        IO.download(item.title + '.txt', text, 'text/plain');
      } });
    }
    /* 协作：加入/退出协作、邀请朋友 */
    const Cb = global.Collab;
    if (Cb) {
      if (Cb.isShared(kind, item.id)) {
        const role = Cb.roleOf(kind, item.id);
        items.push({
          label: '退出协作', icon: 'close', sub: '当前：' + (role === 'read' ? '只读' : '可编辑'),
          fn: () => {
            Cb.leaveWork(kind, item.id);
            UI.toast('已退出协作', 'close');
            UI.render();
          }
        });
        items.push({
          label: '打开协作面板', icon: 'chat', sub: '成员与对话',
          fn: () => UI.go('collab'),
        });
      } else {
        items.push({
          label: '加入协作', icon: 'users', sub: '和朋友一起写这本书',
          fn: () => joinCollabFlow(kind, item)
        });
      }
      if (kind === 'diaryBook') {
        items.push({
          label: (item.members || []).length ? '管理共同记录人' : '设为多人日记',
          icon: 'users',
          sub: (item.members || []).length ? '当前：' + item.members.join('、') : '各写各的，互不覆盖',
          fn: () => membersFlow(item)
        });
      }
    }

    /* 隐私锁：设为私密 / 取消私密（放在删除之前） */
    const P = global.Privacy;
    if (P && P.hasPin === undefined) { /* 模块未加载 */ }
    if (P) {
      P.menuItems(kind, item.id, item.title, () => UI.render()).forEach((it) => items.push(it));
    }
    items.push({ label: '删除', icon: 'trash', danger: true, fn: () => removeItem(kind, item, o) });

    UI.sheet({
      title: item.title || '操作',
      body: (host) => {
        const list = U.el('div.list');
        items.forEach((it) => {
          list.appendChild(U.el('div.row.tap', { onclick: () => { UI.closeSheet(); setTimeout(() => it.fn(), 80); } }, [
            U.el('span.row-chev', { style: { color: it.danger ? 'var(--danger)' : 'var(--text-2)' } }, U.icon(it.icon, 'ico-sm')),
            U.el('div.row-main', {}, [
              U.el('div.row-title', { text: it.label, style: it.danger ? { color: 'var(--danger)' } : null }),
              it.sub ? U.el('div.row-sub', { text: it.sub }) : null
            ])
          ]));
        });
        U.append(host, list);
      }
    });
  };

  /** 加入协作：选可写/只读，并顺手生成邀请信息 */
  function joinCollabFlow(kind, item) {
    let role = 'write';
    const roleRow = U.el('div');
    function paintRole() {
      U.clear(roleRow);
      U.append(roleRow, U.el('div.chips.scroll', {}, [
        U.el('button.chip' + (role === 'write' ? '.active' : ''), { text: '可编辑（一起写）', onclick: () => { role = 'write'; paintRole(); } }),
        U.el('button.chip' + (role === 'read' ? '.active' : ''), { text: '只读（只给我看）', onclick: () => { role = 'read'; paintRole(); } })
      ]));
    }
    paintRole();
    UI.sheet({
      title: '加入协作',
      body: (host) => {
        U.append(host, [
          U.el('div.card', {}, [
            U.el('div', { style: { fontWeight: '650' }, text: item.title || '（无标题）' }),
            U.el('div.field-note', { text: '加入后这部作品会出现在「协作与分享」里，可通过房间同步或分享包互传。' })
          ]),
          U.el('div.field', {}, [U.el('label', { text: '我这边的权限' }), roleRow]),
          U.el('div.field-note', {
            text: '合并是段落级的：两边各写的段落都会保留，谁也不会覆盖谁。「只读」表示合并时忽略你这边的改动。'
          })
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '加入', primary: true, close: false, onClick: () => {
          global.Collab.joinWork(kind, item.id, item.title, role);
          UI.closeSheet();
          UI.toast('已加入协作', 'users');
          setTimeout(() => UI.go('collab'), 200);
        } }
      ]
    });
  }

  /** 多人日记：管理共同记录人 */
  function membersFlow(book) {
    let members = (book.members || []).slice();
    const listHost = U.el('div.list');
    const input = U.el('input.input', { placeholder: '填写对方的名字，回车添加' });
    function paint() {
      U.clear(listHost);
      if (!members.length) {
        U.append(listHost, U.el('div.note-empty', { text: '还没有共同记录人。加了名字之后，每条记录会署上作者，可按人筛选。' }));
        return;
      }
      members.forEach((m) => {
        listHost.appendChild(U.el('div.row', {}, [
          U.el('div.row-ico', {}, U.icon('users')),
          U.el('div.row-main', {}, [
            U.el('div.row-title', { text: m }),
            U.el('div.row-sub', { text: String((book.entries || []).filter((e) => e.author === m).length) + ' 篇' })
          ]),
          U.el('button.btn.sm', {
            onclick: () => { members = members.filter((x) => x !== m); paint(); }
          }, [U.el('span', { text: '移除' })])
        ]));
      });
    }
    const add = () => {
      const v = input.value.trim();
      if (!v || members.indexOf(v) >= 0) return;
      members.push(v);
      input.value = '';
      paint();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    paint();
    UI.sheet({
      title: '共同记录人',
      body: (host) => {
        U.append(host, [
          U.el('div.field', {}, [input]),
          U.el('div', { style: { height: '8px' } }),
          listHost,
          U.el('div.field-note', {
            text: '多人日记的合并按「日期 + 作者」去重：同一天里各人的记录都会保留，不会互相覆盖。'
          })
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '添加', ghost: true, close: false, onClick: add },
        { label: '保存', primary: true, close: false, onClick: () => {
          Store.updateDiaryBook(book.id, { members: members });
          UI.closeSheet();
          UI.toast(members.length ? '已设为多人日记（' + members.length + ' 人）' : '已改回单人日记', 'check');
          UI.render();
        } }
      ]
    });
  }

  /**
   * 「导入并续写」：把外部文章 / 小说导入成一部作品，然后直接打开续写辅助。
   * 用途：想接着别人的文本往下写，或者把自己的旧稿导进来续。
   */
  function continueFromFileFlow() {
    UI.sheet({
      title: '导入并续写',
      body: (host) => {
        U.append(host, [
          U.el('div.fmt-hint', {}, [
            U.el('div.fmt-hint-title', {}, [U.icon('feather', 'ico-sm'), U.el('span', { text: '把要接着写的文本导进来' })]),
            U.el('div.fmt-hint-note', {
              text: '导入后会作为一部新作品，正文按章节切好，然后立刻打开「续写辅助」，'
                + '它会照着你导入的文本分析文风与人物，给出可以接着往下写的段落。'
            })
          ]),
          IO.formatHint ? IO.formatHint({ compact: true }) : null,
          U.el('div.grid2', { style: { marginTop: '12px' } }, [
            U.el('button.btn.primary', {
              onclick: () => { UI.closeSheet(); setTimeout(() => continuePickFile(), 120); }
            }, [U.icon('up', 'ico-sm'), U.el('span', { text: '选择文件' })]),
            U.el('button.btn', {
              onclick: () => { UI.closeSheet(); setTimeout(() => continuePaste(), 120); }
            }, [U.icon('copy', 'ico-sm'), U.el('span', { text: '粘贴文本' })])
          ]),
          U.el('div.field-note', {
            style: { marginTop: '12px' },
            text: '也可以直接「阅读 → 导入文章 → 网址下载」把网上的文本拿下来，再到这里续写。'
          })
        ]);
      }
    });
  }

  /** 导入并续写：走文件 */
  function continuePickFile() {
    (IO.pickFilesSmart ? IO.pickFilesSmart(false) : IO.pickAnyFile(false)).then((files) => {
      if (!files || !files.length) return;
      const busy = UI.busy('正在导入并准备续写', files.length + ' 个文件 · 正在读取…');
      IO.importText('novel', files, {
        onStage: (text, pct) => busy.update(text, pct),
        onProgress: (i, total, name) => busy.update('正在整理：' + (name || ''), total ? i / total : 0)
      }).then((res) => {
        setTimeout(() => {
          UI.busyDone();
          if (!res.count) {
            UI.alert('没能导入这个文件', (res.skipped || []).join('\n\n') || '没有提取到内容。');
            return;
          }
          const first = res.items[0];
          UI.toast('已导入《' + first.title + '》，正在打开续写…', 'check');
          setTimeout(() => openContinueFor(first.id), 400);
        }, 160);
      }).catch((e) => {
        UI.busyDone();
        UI.alert('导入出错', String(e && e.message || e));
      });
    }).catch((e) => UI.alert('没能打开文件', String(e && e.message || e)));
  }

  /** 导入并续写：走粘贴 */
  function continuePaste() {
    UI.input({ title: '粘贴要续写的文本', multiline: true, placeholder: '把原文粘进来（越长，分析得越准）' }).then((text) => {
      const t = String(text || '').trim();
      if (!t) return;
      const busy = UI.busy('正在导入并准备续写', '正在切分章节…');
      IO.importFromText('novel', t, { name: '粘贴的素材.txt', onStage: (s, p) => busy.update(s, p) }).then((res) => {
        setTimeout(() => {
          UI.busyDone();
          if (!res.count) { UI.alert('没能导入', '内容可能是空的。'); return; }
          openContinueFor(res.items[0].id);
        }, 160);
      }).catch((e) => { UI.busyDone(); UI.alert('导入出错', String(e && e.message || e)); });
    });
  }

  /** 打开某部作品的续写面板：跳到最后一章并带上续写标记 */
  function openContinueFor(novelId) {
    const n = Store.findNovel(novelId);
    if (!n || !n.chapters.length) { UI.go('novel'); return; }
    const last = n.chapters[n.chapters.length - 1];
    UI.go('editor/' + n.id + '/' + last.id + '?continue=1');
  }

  /** 打开某部作品的续写面板（供外部调用） */
  Lib.openContinue = openContinueFor;

  function renameItem(kind, item) {    UI.input({ title: '重命名', value: item.title, okLabel: '保存' }).then((v) => {
      if (v === null || !v) return;
      if (kind === 'novel') Store.updateNovel(item.id, { title: v });
      else if (kind === 'article') Store.updateArticle(item.id, { title: v });
      else if (kind === 'diaryBook') Store.updateDiaryBook(item.id, { title: v });
      else if (kind === 'book') Store.updateBook(item.id, { title: v });
      UI.toast('已重命名', 'check');
    });
  }

  function removeItem(kind, item, opts) {
    const o = opts || {};
    UI.confirm('删除确认', '「' + (item.title || '') + '」将被移入回收站（可撤销一次）。', '删除', true).then((ok) => {
      if (!ok) return;
      if (kind === 'novel') Store.deleteNovel(item.id);
      else if (kind === 'article') Store.deleteArticle(item.id);
      else if (kind === 'diaryBook') Store.deleteDiaryBook(item.id);
      else if (kind === 'book') Store.deleteBook(item.id);
      UI.toast('已删除', 'trash');
      if (o.after) o.after();
      else if (o.goBack) UI.back('library');
    });
  }

  function toggleFinished(novel) {
    const next = novel.status === 'finished' ? 'writing' : 'finished';
    Store.updateNovel(novel.id, { status: next, finishedAt: next === 'finished' ? Date.now() : null });
    UI.toast(next === 'finished' ? '已标记完结' : '已恢复连载', 'check');
    global.Ach.evaluate(Store.state, true);
  }

  function editNovelInfo(novel) {
    const title = U.el('input.input', { value: novel.title || '', placeholder: '书名' });
    const author = U.el('input.input', { value: novel.author || '', placeholder: '作者' });
    const category = T.select(T.NOVEL, T.normalizeNovelCategory(novel.category));
    const status = T.select({ groups: [{ id: 'st', name: '状态', items: [{ id: 'writing', label: '连载中' }, { id: 'finished', label: '已完结' }] }] }, novel.status === 'finished' ? 'finished' : 'writing');
    const intro = U.el('textarea.textarea', { placeholder: '简介 / 一句话梗概' });
    intro.value = novel.intro || '';
    UI.sheet({
      title: '书籍信息',
      autoFocus: true,
      body: (host) => {
        U.append(host, [
          U.el('div.field', {}, [U.el('label', { text: '书名' }), title]),
          U.el('div.field', {}, [U.el('label', { text: '作者' }), author]),
          U.el('div.field', {}, [U.el('label', { text: '题材分类' }), category]),
          U.el('div.field', {}, [U.el('label', { text: '连载状态' }), status]),
          U.el('div.field', {}, [U.el('label', { text: '简介' }), intro])
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '保存', primary: true, onClick: () => {
          Store.updateNovel(novel.id, {
            title: title.value.trim() || '未命名小说',
            author: author.value.trim(),
            category: category.value,
            status: status.value,
            finishedAt: status.value === 'finished' ? (novel.finishedAt || Date.now()) : null,
            intro: intro.value.trim()
          });
          UI.toast('已保存', 'check');
        } }
      ]
    });
  }

  /* ================================================================== */
  /* 新建                                                              */
  /* ================================================================== */
  Lib.createNovelFlow = function (preset) {
    const p = preset || {};
    const title = U.el('input.input', { value: p.title || '', placeholder: '例如：长夜将尽' });
    const category = T.select(T.NOVEL, p.category || T.NOVEL_DEFAULT);
    const intro = U.el('textarea.textarea', { placeholder: '故事梗概（可稍后填写）', rows: 3 });
    const goal = U.el('input.input', { type: 'number', value: String(Store.state.settings.defaultChapterGoal || 3000), min: '0' });
    UI.sheet({
      title: '新建小说',
      autoFocus: true,
      body: (host) => {
        U.append(host, [
          U.el('div.field', {}, [U.el('label', { text: '书名' }), title]),
          U.el('div.field', {}, [
            U.el('label', { text: '题材分类' }),
            category,
            U.el('div', { text: '分类可在「书籍信息」里随时修改，书架会按分类自动分组', style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '6px' } })
          ]),
          U.el('div.field', {}, [U.el('label', { text: '简介' }), intro]),
          U.el('div.field', {}, [
            U.el('label', { text: '每章字数目标' }),
            goal,
            U.el('div', { text: '写作时会实时显示当前章节的达标进度', style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '6px' } })
          ])
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '创建并开始写', primary: true, onClick: () => {
          const g = Math.max(0, Number(goal.value) || 0);
          Store.setSetting('defaultChapterGoal', g);
          const n = Store.createNovel({ title: title.value.trim() || '未命名小说', intro: intro.value.trim(), category: category.value });
          Store.updateChapter(n.id, n.chapters[0].id, { goal: g });
          const ch = n.chapters[0];
          UI.toast('已创建，开始写作吧', 'feather');
          UI.go('editor/' + n.id + '/' + ch.id);
        } }
      ]
    });
  };

  Lib.createArticleFlow = function (preset) {
    const p = preset || {};
    const title = U.el('input.input', { value: p.title || '', placeholder: '文章标题' });
    const category = T.select(T.ARTICLE, p.category || T.ARTICLE_DEFAULT);
    const tags = U.el('input.input', { value: p.tags || '', placeholder: '标签，用空格分隔' });
    UI.sheet({
      title: '新建文章',
      autoFocus: true,
      body: (host) => {
        U.append(host, [
          U.el('div.field', {}, [U.el('label', { text: '标题' }), title]),
          U.el('div.field', {}, [U.el('label', { text: '文章类型' }), category]),
          U.el('div.field', {}, [U.el('label', { text: '标签' }), tags])
        ]);
      },
      footer: [
        { label: '导入文本', ghost: true, close: false, onClick: () => { UI.closeSheet(); setTimeout(() => Lib.importTextFlow('article'), 120); } },
        { label: '创建', primary: true, onClick: () => {
          const a = Store.createArticle({
            title: title.value.trim() || '未命名文章',
            category: category.value,
            tags: tags.value.trim() ? tags.value.trim().split(/\s+/) : []
          });
          UI.go('editor/' + a.id);
        } }
      ]
    });
  };

  Lib.createDiaryFlow = function () {
    const title = U.el('input.input', { placeholder: '例如：日记 / 周记 / 月记' });
    let kind = 'daily';
    let subjectSel = null;
    const intervalField = U.el('div.field.hidden', {}, [
      U.el('label', { text: '每隔几天记录一次' }),
      U.el('input.input', { type: 'number', value: '7', min: '1', id: 'diaryIntervalInput' })
    ]);
    const kinds = [
      { id: 'daily', label: '日记（每天）' },
      { id: 'weekly', label: '周记（每周）' },
      { id: 'monthly', label: '月记（每月）' },
      { id: 'custom', label: '自定义间隔' }
    ];
    UI.sheet({
      title: '新建记录本',
      autoFocus: true,
      body: (host) => {
        const chips = U.el('div.chips');
        const hint = U.el('div', { text: '', style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '7px' } });
        kinds.forEach((k) => {
          const c = U.el('button.chip' + (k.id === kind ? '.active' : ''), {
            text: k.label,
            onclick: () => {
              kind = k.id;
              U.$$('.chip', chips).forEach((x) => x.classList.remove('active'));
              c.classList.add('active');
              intervalField.classList.toggle('hidden', kind !== 'custom');
              hint.textContent = k.hint || '';
              if (!title.value.trim()) title.value = k.id === 'daily' ? '我的日记' : k.id === 'weekly' ? '我的周记' : k.id === 'monthly' ? '我的月记' : '我的记录';
            }
          });
          if (k.id === kind) hint.textContent = k.hint || '';
          chips.appendChild(c);
        });
        const subject = T.select({ groups: [{ id: 'subject', name: '内容主题', items: T.DIARY_SUBJECT }] }, '生活');
        subjectSel = subject;
        U.append(host, [
          U.el('div.field', {}, [U.el('label', { text: '名称' }), title]),
          U.el('div.field', {}, [U.el('label', { text: '记录类型' }), chips, hint]),
          intervalField,
          U.el('div.field', {}, [U.el('label', { text: '内容主题' }), subject]),
          U.el('div', { text: '周记与月记会自动把该周 / 该月的日记汇总显示，方便回顾。', style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '10px' } })
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '创建', primary: true, onClick: () => {
          const iv = Number((document.getElementById('diaryIntervalInput') || {}).value) || 7;
          const subj = subjectSel ? subjectSel.value : '生活';
          const bk = Store.createDiaryBook({
            title: title.value.trim() || (kind === 'daily' ? '我的日记' : kind === 'weekly' ? '我的周记' : kind === 'monthly' ? '我的月记' : '我的记录'),
            kind: kind,
            intervalDays: iv,
            category: subj
          });
          UI.go('diary/' + bk.id + '/' + U.dateKey());
        } }
      ]
    });
  };

  /* ================================================================== */
  /* 导入文本：文件选择 + 粘贴文本 两条路                                  */
  /* ================================================================== */
  const IMPORT_KINDS = [
    { id: 'novel', label: '导入为小说', sub: '自动按「第X章 / # 标题」切分章节', icon: 'feather' },
    { id: 'article', label: '导入为文章', sub: '整篇作为一个文章条目', icon: 'doc' },
    { id: 'diary', label: '导入为日记', sub: '自动识别日期行，按天归档', icon: 'calendar' },
    { id: 'reading', label: '导入到阅读器', sub: '仅用于阅读，不计入成就', icon: 'reader' }
  ];
  const IMPORT_LABELS = { novel: '小说', article: '文章', diary: '日记', reading: '阅读素材' };

  function afterImport(kind, res) {
    if (!res.ok) { UI.alert('导入失败', res.error || '未知错误'); return; }
    const first = res.items[0];
    const skipped = res.skipped || [];
    const diags = res.diagnostics || [];
    const enc = (res.items.find((it) => it.encoding) || {}).encoding || '';
    if (!res.count) {
      /* 一个都没成功：把原因与文件档案都摆出来，用户可以直接复制发给我 */
      UI.sheet({
        title: '没能导入这个文件',
        body: (host) => {
          U.append(host, U.el('div', {
            style: { fontSize: '13px', lineHeight: '1.9', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
            text: skipped.length ? skipped.join('\n\n') : '没有提取到内容。'
          }));
          U.append(host, U.el('div.field-note', {
            style: { marginTop: '14px' },
            text: '把上面这段信息发给我就能定位原因。也可以先试：确认文件没加密，或在电脑上另存为 TXT 再导入。'
          }));
        },
        footer: [
          { label: '关闭', ghost: true },
          { label: '复制诊断信息', primary: true, close: false, onClick: () => {
            const txt = 'selfwriting 导入诊断\n' + skipped.join('\n\n')
              + (diags.length ? '\n\n' + diags.map((d) => d.detail).filter(Boolean).join('\n') : '');
            if (IO.copyText) IO.copyText(txt);
            else UI.toast('请手动长按选择上面的文字复制', 'close');
            UI.toast('已复制诊断信息', 'check');
          } }
        ]
      });
      return;
    }
    UI.toast('已导入 ' + res.count + ' 个' + (IMPORT_LABELS[kind] || '条目')
      + (enc ? '（' + enc + '）' : ''), 'check');
    if (skipped.length) {
      setTimeout(() => UI.alert('有 ' + skipped.length + ' 个文件没导入', skipped.join('\n\n')), 600);
    }
    setTimeout(() => {
      if (!first) return;
      if (kind === 'novel' || kind === 'article') UI.go('editor/' + first.id);
      else if (kind === 'diary') UI.go('diary/' + first.id + '/' + U.dateKey());
      else if (kind === 'reading') UI.go('read/' + first.id + '/start');
    }, 400);
  }

  /** 走系统文件选择器（安卓壳里由 onShowFileChooser 接管） */
  function importViaFile(kind) {
    /* 用统一的「选文件」入口：安卓走原生通道读字节（避开 content:// 读不出的问题），
       纯网页退回标准 file input；不限 accept，否则部分文件管理器会藏起 epub/mobi */
    (IO.pickFilesSmart ? IO.pickFilesSmart(true) : IO.pickAnyFile(true)).then((files) => {
      if (!files || !files.length) return;      // 用户取消
      /* 立刻上遮罩：导入期间挡住一切点击，用户乱按也不会跳页 */
      const busy = UI.busy('正在导入', files.length + ' 个文件 · 正在读取…');
      let lastPct = 0;
      IO.importText(kind, files, {
        onProgress: (i, total, name) => {
          const pct = total ? (i / total) : 0;
          lastPct = Math.max(lastPct, pct);
          busy.update('第 ' + Math.min(i + 1, total) + '/' + total + ' 个：' + (name || ''), lastPct);
        },
        onStage: (text, pct) => busy.update(text, typeof pct === 'number' ? pct : lastPct)
      }).then((res) => {
        /* 稍等一下再撤遮罩：让进度条走完，视觉上不突兀 */
        setTimeout(() => {
          UI.busyDone();
          afterImport(kind, res);
        }, 160);
      }).catch((e) => {
        UI.busyDone();
        UI.alert('导入出错', String(e && e.message || e));
      });
    }).catch((e) => {
      UI.alert('没能打开文件', String(e && e.message || e) + '\n\n可以改用「粘贴文本」导入。');
    });
  }

  /** 粘贴文本导入：不依赖文件管理器 */
  function importViaPaste(kind, initialText) {
    const ta = U.el('textarea.textarea', {
      rows: 8,
      placeholder: '把文本粘贴到这里……\n\n· 导入小说：会自动按「第X章 / # 标题」分章\n· 导入文章：整篇作为一篇\n· 导入日记：识别「2025-01-01」这类日期行按天归档'
    });
    ta.value = initialText || '';
    const stat = U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '6px' } });
    const upd = () => { stat.textContent = '当前 ' + U.fmtInt(U.words(ta.value)) + ' 字'; };
    ta.addEventListener('input', upd);
    upd();
    UI.sheet({
      title: '粘贴文本导入',
      autoFocus: true,
      body: (host) => {
        U.append(host, [
          U.el('div', { style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '8px' } },
            '适合文件选择器用不了的机型：先在其它应用里复制全文，再粘到这里。'),
          ta, stat
        ]);
      },
      footer: [
        { label: '从剪贴板粘贴', ghost: true, close: false, onClick: () => {
          if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then((t) => { if (t) { ta.value = (ta.value ? ta.value + '\n' : '') + t; upd(); } else UI.toast('剪贴板是空的', 'close'); })
              .catch(() => UI.toast('系统不允许读取剪贴板，请长按输入框手动粘贴', 'close'));
          } else {
            UI.toast('请长按输入框手动粘贴', 'close');
          }
        } },
        { label: '取消', ghost: true },
        { label: '导入', primary: true, close: false, onClick: () => {
          const text = ta.value;
          if (!text || !text.trim()) { UI.toast('还没有内容', 'close'); return; }
          UI.closeSheet();
          const note = UI.toast('正在导入…', 'up', 60000);
          IO.importFromText(kind, text, { name: '粘贴的文本.txt' }).then((res) => {
            if (note && note.parentNode) note.parentNode.removeChild(note);
            afterImport(kind, res);
          });
        } }
      ]
    });
  }

  /**
   * 导入入口：先选去向，再选来源（文件 / 粘贴）。
   * kind 传入时直接进入「来源」选择。
   */
  Lib.importTextFlow = function (kind) {
    if (kind) { pickSource(kind); return; }
    UI.sheet({
      title: '导入文本',
      body: (host) => {
        const list = U.el('div.list');
        IMPORT_KINDS.forEach((k) => {
          list.appendChild(U.el('div.row.tap', {
            onclick: () => { UI.closeSheet(); setTimeout(() => pickSource(k.id), 120); }
          }, [
            U.el('span.row-chev', {}, U.icon(k.icon, 'ico-sm')),
            U.el('div.row-main', {}, [U.el('div.row-title', { text: k.label }), U.el('div.row-sub', { text: k.sub })]),
            U.el('span.row-chev', {}, U.icon('chevron', 'ico-sm'))
          ]));
        });
        U.append(host, list);
      }
    });
  };

  /** 选择来源：文件 or 粘贴 */
  function pickSource(kind) {
    const k = IMPORT_KINDS.find((x) => x.id === kind) || IMPORT_KINDS[0];
    UI.sheet({
      title: k.label,
      body: (host) => {
        U.append(host, [
          U.el('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '12px' } }, k.sub),
          IO.formatHint ? IO.formatHint({ compact: true }) : null,
          U.el('div.grid2', { style: { marginTop: '12px' } }, [
            U.el('button.btn.primary', { onclick: () => { UI.closeSheet(); setTimeout(() => importViaFile(kind), 120); } },
              [U.icon('up', 'ico-sm'), U.el('span', { text: '选择文件' })]),
            U.el('button.btn', { onclick: () => { UI.closeSheet(); setTimeout(() => importViaPaste(kind), 120); } },
              [U.icon('copy', 'ico-sm'), U.el('span', { text: '粘贴文本' })])
          ]),
          U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '12px', lineHeight: '1.7' } },
            '「选择文件」会打开系统文件管理器；如果这台设备的文件管理器不可用，改用「粘贴文本」。')
        ]);
      }
    });
  }

  Lib.importViaPaste = importViaPaste;

  function importDiaryInto(book) {
    IO.pickFile('.txt,.md,.markdown', true).then((files) => {
      if (!files.length) return;
      IO.importText('diary', files, { bookId: book.id }).then((res) => {
        if (!res.ok) { UI.alert('导入失败', res.error || ''); return; }
        UI.toast('已导入 ' + ((res.items[0] && res.items[0].entries) || 0) + ' 篇记录', 'check');
      });
    });
  }

  /* ================================================================== */
  /* 卡片渲染                                                          */
  /* ================================================================== */
  /** 私密作品：列表里只显示一个锁形占位，标题与内容都不露出来 */
  function lockedCard(kind, item) {
    return U.el('div.card.tap', {
      onclick: () => {
        global.Privacy.ask('输入密码', '这是一部私密作品').then((ok) => {
          if (!ok) return;
          global.Privacy.markUnlocked(kind, item.id);
          if (kind === 'novel') UI.go('library/novel/' + item.id);
          else if (kind === 'article') UI.go('library/article/' + item.id);
          else if (kind === 'diaryBook') UI.go('diary/' + item.id);
          else if (kind === 'book') UI.go('read/' + item.id + '/start');
        });
      }
    }, [
      U.el('div.card-head', {}, [
        U.el('div.card-title', {}, [U.icon('lock', 'ico-sm'), U.el('span', { text: ' 私密作品' })]),
        menuBtn(() => Lib.itemMenu(kind, item))
      ]),
      U.el('div.card-sub', {}, [
        U.el('span', { text: '已上锁 · 输入密码后查看' }),
        U.el('span', { text: U.fmtWhen(item.updatedAt) })
      ])
    ]);
  }

  /** 统一入口：锁着就渲染占位卡，否则渲染正常卡片 */
  function cardOrLock(kind, item, render) {
    const P = global.Privacy;
    if (P && P.isLocked(kind, item.id) && !P.isUnlocked(kind, item.id)) return lockedCard(kind, item);
    const card = render(item);
    /* 已解锁的私密作品给个小锁标记，提醒它是私密的 */
    if (P && P.isLocked(kind, item.id)) {
      const head = card.querySelector ? card.querySelector('.card-head') : null;
      if (head) head.insertBefore(U.el('span.badge', {}, [U.icon('lock', 'ico-sm'), U.el('span', { text: '私密' })]), head.children[1] || null);
    }
    return card;
  }

  function novelCard(n) {
    const words = Store.novelWords(n);
    const chapters = (n.chapters || []).length;
    const lastCh = n.chapters[n.chapters.length - 1];
    const pct = chapters && n.chapters[0].goal ? U.clamp((lastCh.words || 0) / (lastCh.goal || 1), 0, 1) : 0;
    const card = U.el('div.card.tap', { onclick: () => UI.go('library/novel/' + n.id) }, [
      U.el('div.card-head', {}, [
        U.el('div.card-title', { text: n.title || '未命名小说' }),
        n.status === 'finished' ? U.el('span.badge.ok', { text: '完结' }) : null,
        global.Profile && global.Profile.multiBadge(n),
        menuBtn(() => Lib.itemMenu('novel', n))
      ]),
      U.el('div.card-sub', {}, [
        U.el('span.badge', { text: T.normalizeNovelCategory(n.category) }),
        U.el('span', { text: chapters + ' 章' }),
        U.el('span', { text: wordLine(words) }),
        U.el('span', { text: U.fmtWhen(n.updatedAt) })
      ]),
      global.Profile && global.Profile.participantsLine(n, { style: { marginTop: '6px' } }),
      n.intro ? U.el('div.card-desc', { text: n.intro }) : null,
      chapters ? U.el('div', { style: { marginTop: '10px' } }, [
        U.el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-3)', marginBottom: '5px' } }, [
          U.el('span', { text: lastCh && lastCh.title ? '最新：' + lastCh.title : '' }),
          lastCh && lastCh.goal ? U.el('span', { text: U.fmtInt(lastCh.words || 0) + ' / ' + U.fmtInt(lastCh.goal) + ' 字' }) : null
        ]),
        lastCh && lastCh.goal ? UI.progressBar(pct, 'thin') : null
      ]) : null
    ]);
    return card;
  }

  function articleCard(a) {
    return U.el('div.card.tap', { onclick: () => UI.go('library/article/' + a.id) }, [
      U.el('div.card-head', {}, [
        U.el('div.card-title', { text: a.title || '未命名文章' }),
        global.Profile && global.Profile.multiBadge(a),
        menuBtn(() => Lib.itemMenu('article', a))
      ]),
      U.el('div.card-sub', {}, [
        U.el('span.badge', { text: a.category || T.ARTICLE_DEFAULT }),
        U.el('span', { text: wordLine(Store.articleWords(a)) }),
        U.el('span', { text: U.fmtWhen(a.updatedAt) }),
        (a.tags || []).length ? U.el('span', { text: a.tags.map((t) => '#' + t).join(' ') }) : null
      ]),
      a.content ? U.el('div.card-desc', { text: U.excerpt(a.content, 70) }) : U.el('div.card-desc', { text: '（还没有内容）' })
    ]);
  }

  function diaryCard(bk) {
    const words = Store.diaryWords(bk);
    const entries = (bk.entries || []).length;
    const dates = Store.diaryDates(bk);
    const last = dates[dates.length - 1];
    const kindName = { daily: '日记', weekly: '周记', monthly: '月记', custom: '自定义间隔' }[bk.kind] || '日记';
    const today = U.dateKey();
    const due = bk.kind === 'custom' && last ? U.dayDiff(last, today) >= (bk.intervalDays || 7) : false;
    return U.el('div.card.tap', { onclick: () => UI.go('diary/' + bk.id + '/' + (last || today)) }, [
      U.el('div.card-head', {}, [
        U.el('div.card-title', { text: bk.title || '记录本' }),
        U.el('span.badge' + (due ? '.warn' : ''), { text: kindName + (due ? ' · 该记录了' : '') }),
        global.Profile && global.Profile.multiBadge(bk),
        menuBtn(() => Lib.itemMenu('diaryBook', bk))
      ]),
      U.el('div.card-sub', {}, [
        U.el('span', { text: entries + ' 篇' }),
        U.el('span', { text: dates.length + ' 天' }),
        U.el('span', { text: wordLine(words) }),
        last ? U.el('span', { text: '最近 ' + last }) : null
      ]),
      U.el('div.card-desc', { text: bk.description || (last ? '上次记录：' + U.fmtDateCN(last) : '还没有记录，点进去写下第一篇') })
    ]);
  }

  function bookCard(b) {
    const pct = (b.progress && b.progress.percent) || 0;
    return U.el('div.card.tap', { onclick: () => UI.go('read/' + b.id) }, [
      U.el('div.card-head', {}, [
        U.el('div.card-title', { text: b.title || '未命名读物' }),
        pct >= 0.985 ? U.el('span.badge.ok', { text: '已读完' }) : null,
        menuBtn(() => Lib.itemMenu('book', b))
      ]),
      U.el('div.card-sub', {}, [
        U.el('span', { text: (b.chapters || []).length + ' 节' }),
        U.el('span', { text: U.fmtInt(Store.bookWords(b)) + ' 字' }),
        b.lastReadAt ? U.el('span', { text: '阅读于 ' + U.fmtWhen(b.lastReadAt) }) : U.el('span', { text: '未开始' })
      ]),
      U.el('div', { style: { marginTop: '10px' } }, [
        UI.progressBar(pct, 'thin'),
        U.el('div', { style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '5px' }, text: '已读 ' + Math.round(pct * 100) + '%' })
      ])
    ]);
  }

  /* ================================================================== */
  /* 顶部：写作概览                                                    */
  /* ================================================================== */
  function overviewCard() {
    const st = Store.state;
    const sum = global.Stats.summary(st);
    const today = sum.today;
    const goal = sum.goal;
    /* 「继续写作」不能透露私密作品的标题 —— 未解锁时整条按钮就不显示，
       否则列表虽然挡住了，这里又把标题漏出来（等于白锁）。 */
    const recentRaw = Store.allItems().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    const recent = (recentRaw && global.Privacy && global.Privacy.isLocked(recentRaw.kind, recentRaw.id)
      && !global.Privacy.isUnlocked(recentRaw.kind, recentRaw.id)) ? null : recentRaw;

    const wrap = U.el('div.card', { style: { background: 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 12%, var(--bg-elev)), var(--bg-elev))' } });
    U.append(wrap, [
      U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
        UI.ring(goal ? U.clamp(today.words / goal, 0, 1) : 0, goal ? Math.round(U.clamp(today.words / goal, 0, 1) * 100) + '%' : '—'),
        U.el('div', { style: { flex: '1 1 auto' } }, [
          U.el('div', { text: '今日 ' + U.fmtInt(today.words) + ' 字', style: { fontSize: '17px', fontWeight: '680' } }),
          U.el('div', {
            text: goal ? U.pick('目标 ' + U.fmtInt(goal) + ' 字 · 还差 ' + U.fmtInt(Math.max(0, goal - today.words)) + ' 字', 'Goal ' + U.fmtInt(goal) + ' words · ' + U.fmtInt(Math.max(0, goal - today.words)) + ' to go') : '未设置每日目标',
            style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px' }
          }),
          U.el('div', {
            text: U.pick('连续创作 ' + sum.streak + ' 天 · 累计 ' + U.fmtDuration(sum.totalMs, { short: true }), sum.streak + '-day streak · ' + U.fmtDuration(sum.totalMs, { short: true }) + ' total'),
            style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px' }
          })
        ]),
        U.el('button.icon-btn', { onclick: () => UI.go('stats'), 'aria-label': '统计' }, U.icon('chart'))
      ]),
      recent ? U.el('button.btn.block', {
        style: { marginTop: '12px' },
        onclick: () => {
          if (recent.kind === 'novel') {
            const n = recent.ref;
            const lastCh = n.chapters[n.chapters.length - 1];
            UI.go(lastCh ? 'editor/' + n.id + '/' + lastCh.id : 'library/novel/' + n.id);
          } else if (recent.kind === 'article') UI.go('editor/' + recent.id);
          else if (recent.kind === 'diaryBook') { const d = Store.diaryDates(recent.ref); UI.go('diary/' + recent.id + '/' + (d[d.length - 1] || U.dateKey())); }
          else UI.go('read/' + recent.id);
        }
      }, [U.icon('feather', 'ico-sm'), U.el('span', { text: '继续：' + U.excerpt(recent.title, 16) })]) : null
    ]);
    return wrap;
  }

  /* ================================================================== */
  /* 书架页                                                            */
  /* ================================================================== */
  /* ================================================================== */
  /* 模块列表页：底部导航直接进入（小说 / 文章 / 日记 / 阅读）             */
  /* 「全部作品」作为额外视图保留                                          */
  /* ================================================================== */
  let subFilter = '';        // 二级分类（题材 / 文章类型 / 读物类型…）

  /** 取条目的分类名（含旧数据兼容） */
  function catOf(kind, item) {
    if (kind === 'novel') return T.normalizeNovelCategory(item.category);
    if (kind === 'article') return item.category || T.ARTICLE_DEFAULT;
    if (kind === 'diary') return { daily: '日记', weekly: '周记', monthly: '月记', custom: '自定义间隔' }[item.kind] || '日记';
    if (kind === 'reading') return item.category || T.BOOK_DEFAULT;
    return '';
  }

  const MODULE_META = {
    all: { title: '全部作品', icon: 'book' },
    novel: { title: '小说', icon: 'feather' },
    article: { title: '文章', icon: 'doc' },
    diary: { title: '记录本', icon: 'calendar' },
    reading: { title: '阅读', icon: 'reader' }
  };

  const MODULE_EMPTY = {
    novel: ['还没有小说', '小说分章节创作，可随时对照大纲。'],
    article: ['还没有文章', '随笔、长文、报告都可以整篇写在这里。'],
    diary: ['还没有记录本', '日记支持日历、周记、月记与自定义间隔。'],
    reading: ['还没有读物', '支持 TXT / Markdown / EPUB / MOBI / PDF，导入即可离线阅读。'],
    all: ['还没有任何作品', '小说、文章、日记、大纲全部离线保存在这台设备上。']
  };

  /** 生成一个模块列表页 */
  function listFor(preset) {
    const filter = preset || 'novel';
    const routeName = filter === 'all' ? 'all-works' : filter;
    const meta = MODULE_META[filter];
    const emptyInfo = MODULE_EMPTY[filter];
    const catKind = filter === 'all' ? 'novel' : filter;

    UI.route(routeName, function (view) {
      const st = Store.state;
      UI.setTitle(meta.title, '');
      /* 首页第一张卡：我的头像 + 状态（仿微信 / QQ），点一下就能更新 */
      if (global.Profile && filter !== 'all') U.append(view, global.Profile.homeCard());
      U.append(view, overviewCard());

      /* 模块切换标签（带数量） */
      const moduleChips = [
        { id: 'all', label: '全部 ' + (st.novels.length + st.articles.length + st.diaries.length + st.reading.length) },
        { id: 'novel', label: '小说 ' + st.novels.length },
        { id: 'article', label: '文章 ' + st.articles.length },
        { id: 'diary', label: '记录本 ' + st.diaries.length },
        { id: 'reading', label: '阅读 ' + st.reading.length }
      ];
      U.append(view, U.el('div', { style: { marginTop: '14px' } },
        UI.chipRow(moduleChips, filter, (id) => { subFilter = ''; UI.go(id === 'all' ? 'all-works' : id); })));

      /* 二级分类 */
      const src = filter === 'novel' ? st.novels
        : filter === 'article' ? st.articles
        : filter === 'diary' ? st.diaries
        : filter === 'reading' ? st.reading
        : [].concat(st.novels, st.articles, st.diaries, st.reading);
      const tally = {};
      src.forEach((it) => { const c = catOf(catKind, it); tally[c] = (tally[c] || 0) + 1; });
      const cats = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
      if (filter !== 'all' && cats.length > 1) {
        const sub = [{ id: '', label: '全部 ' + src.length }].concat(cats.map((c) => ({ id: c, label: c + ' ' + tally[c] })));
        U.append(view, U.el('div', { style: { marginTop: '8px' } },
          UI.chipRow(sub, subFilter, (id) => { subFilter = id; UI.render(); })));
      } else {
        subFilter = '';
      }

      const body = U.el('div');
      U.append(view, body);

      function section(title, iconName, list, render) {
        if (!list.length) return;
        U.append(body, U.el('div.section-title', {}, [U.icon(iconName, 'ico-sm'), U.el('span', { text: title }), U.el('span.spacer'), U.el('span', { text: String(list.length), style: { fontWeight: '500' } })]));
        list.forEach((it) => body.appendChild(render(it)));
      }

      /** 同类型条目多于一个分类时，按分类分小标题 */
      function grouped(kindName, list, iconName, render) {
        if (!list.length) return;
        const map = {};
        list.forEach((it) => { const c = catOf(kindName, it); (map[c] = map[c] || []).push(it); });
        const keys = Object.keys(map);
        if (keys.length <= 1) { section(keys[0] || '全部', iconName, map[keys[0]] || list, render); return; }
        keys.sort((a, b) => map[b].length - map[a].length);
        keys.forEach((c) => section(c, iconName, map[c], render));
      }

      const pick = (kindName, list) => (subFilter ? list.filter((it) => catOf(kindName, it) === subFilter) : list);
      const want = (id) => filter === 'all' || filter === id;

      const novels = want('novel') ? pick('novel', st.novels) : [];
      const articles = want('article') ? pick('article', st.articles) : [];
      const diaries = want('diary') ? pick('diary', st.diaries) : [];
      const books = want('reading') ? pick('reading', st.reading) : [];
      const total = novels.length + articles.length + diaries.length + books.length;

      if (!total) {
        U.append(body, UI.empty(meta.icon, emptyInfo[0], emptyInfo[1]));
      } else if (filter === 'all') {
        section('小说', 'feather', novels, (n) => cardOrLock('novel', n, novelCard));
        section('文章', 'doc', articles, (a) => cardOrLock('article', a, articleCard));
        section('记录本', 'calendar', diaries, (b) => cardOrLock('diaryBook', b, diaryCard));
        section('阅读', 'reader', books, (b) => cardOrLock('book', b, bookCard));
      } else {
        if (novels.length) grouped('novel', novels, 'feather', (n) => cardOrLock('novel', n, novelCard));
        if (articles.length) grouped('article', articles, 'doc', (a) => cardOrLock('article', a, articleCard));
        if (diaries.length) section('记录本', 'calendar', diaries, (b) => cardOrLock('diaryBook', b, diaryCard));
        if (books.length) grouped('reading', books, 'reader', (b) => cardOrLock('book', b, bookCard));
      }

      /* 新建 / 导入 */
      U.append(body, U.el('div.section-title', {}, [U.icon('plus', 'ico-sm'), U.el('span', { text: '新建与导入' })]));
      const actionBtns = [];
      if (filter === 'novel' || filter === 'all') actionBtns.push(U.el('button.btn.primary', { onclick: Lib.createNovelFlow }, [U.icon('feather', 'ico-sm'), U.el('span', { text: '新建小说' })]));
      if (filter === 'article') actionBtns.push(U.el('button.btn.primary', { onclick: Lib.createArticleFlow }, [U.icon('doc', 'ico-sm'), U.el('span', { text: '新建文章' })]));
      if (filter === 'diary') actionBtns.push(U.el('button.btn.primary', { onclick: Lib.createDiaryFlow }, [U.icon('calendar', 'ico-sm'), U.el('span', { text: '新建记录本' })]));
      if (filter === 'reading') actionBtns.push(U.el('button.btn.primary', { onclick: () => Lib.importTextFlow('reading') }, [U.icon('up', 'ico-sm'), U.el('span', { text: '导入读物' })]));
      actionBtns.push(U.el('button.btn', { onclick: () => Lib.importTextFlow(filter === 'article' ? 'article' : filter === 'diary' ? 'diary' : 'novel') }, [U.icon('up', 'ico-sm'), U.el('span', { text: '导入文本' })]));
      actionBtns.push(U.el('button.btn', { onclick: () => UI.go('outline') }, [U.icon('tree', 'ico-sm'), U.el('span', { text: '大纲' })]));
      actionBtns.push(U.el('button.btn', { onclick: () => importBackup() }, [U.icon('refresh', 'ico-sm'), U.el('span', { text: '恢复备份' })]));
      actionBtns.push(U.el('button.btn', { onclick: () => UI.go('stats/settings') }, [U.icon('settings', 'ico-sm'), U.el('span', { text: '设置' })]));
      U.append(body, U.el('div.grid2', {}, actionBtns));

      /* 成就预览 */
      const achData = global.Ach.byGroup(st);
      const recentAch = global.Ach.all()
        .filter((r) => st.achievements[r.id])
        .sort((a, b) => st.achievements[b.id].at - st.achievements[a.id].at)
        .slice(0, 3);
      if (recentAch.length) {
        U.append(body, U.el('div.section-title', {}, [U.icon('trophy', 'ico-sm'), U.el('span', { text: '最新成就' }), U.el('span.spacer'), U.el('button.chip', { text: '全部', onclick: () => UI.go('stats/achievements') })]));
        U.append(body, U.el('div.ach-grid', {}, recentAch.map((r) => {
          const p = global.Ach.progressOf(st, r, achData.ctx);
          return UI.achievementCard({ rule: r, prog: p }, achData.ctx);
        })));
      }

      /* 浮动新建按钮 */
      const fabAction = filter === 'article' ? () => Lib.createArticleFlow()
        : filter === 'diary' ? Lib.createDiaryFlow
        : filter === 'reading' ? () => Lib.importTextFlow('reading')
        : newSheet;
      U.append(view, U.el('button.fab', { onclick: fabAction, 'aria-label': '新建' }, U.icon('plus')));
    });
  }

  listFor('novel');
  listFor('article');
  listFor('diary');
  listFor('reading');
  listFor('all');

  /** 旧链接 #/library → 小说模块（书架已拆成各模块标签） */
  UI.route('library', function () { UI.go('novel'); });

  function newSheet() {
    UI.sheet({
      title: '新建',
      body: (host) => {
        const list = U.el('div.list');
        const items = [
          { label: '小说', sub: '分章节创作，可对照大纲', icon: 'feather', fn: Lib.createNovelFlow },
          { label: '文章', sub: '散文、随笔、长文', icon: 'doc', fn: () => Lib.createArticleFlow() },
          { label: '日记本', sub: '日记 / 周记 / 月记 / 自定义间隔', icon: 'calendar', fn: Lib.createDiaryFlow },
          { label: '大纲', sub: '新建独立大纲或为已有小说建大纲', icon: 'tree', fn: () => global.OutlineView.createFlow() },
          { label: '导入文本', sub: 'TXT / Markdown 导入为作品', icon: 'up', fn: () => Lib.importTextFlow('novel') },
          { label: '导入并续写', sub: '导入别人的文章 / 小说，接着往下写', icon: 'feather', fn: () => continueFromFileFlow() },
          { label: '导入阅读', sub: '放进阅读器慢慢看', icon: 'reader', fn: () => Lib.importTextFlow('reading') }
        ];
        items.forEach((it) => {
          list.appendChild(U.el('div.row.tap', {
            onclick: () => { UI.closeSheet(); setTimeout(it.fn, 100); }
          }, [
            U.el('span.row-chev', {}, U.icon(it.icon, 'ico-sm')),
            U.el('div.row-main', {}, [U.el('div.row-title', { text: it.label }), U.el('div.row-sub', { text: it.sub })]),
            U.el('span.row-chev', {}, U.icon('chevron', 'ico-sm'))
          ]));
        });
        U.append(host, list);
      }
    });
  }

  function importBackup() {
    UI.choose({
      title: '恢复备份方式',
      items: [
        { label: '合并导入', sub: '保留现有作品，追加备份中的内容', value: 'merge', icon: 'plus' },
        { label: '覆盖导入', sub: '清空当前数据，完全恢复备份', value: 'replace', icon: 'refresh' }
      ]
    }).then((mode) => {
      if (!mode) return;
      IO.pickFile('.json,application/json').then((files) => {
        if (!files.length) return;
        const run = () => IO.restoreAll(files[0], mode).then((res) => {
          UI.toast('恢复完成', 'check');
          UI.go('library');
        }).catch((e) => UI.alert('恢复失败', String(e.message || e)));
        if (mode === 'replace') {
          UI.confirm('覆盖导入', '当前所有作品、日记与统计将被备份内容替换，且不可撤销。建议先导出备份。', '确认覆盖', true).then((ok) => { if (ok) run(); });
        } else run();
      });
    });
  }

  function aboutSheet() {
    UI.sheet({
      title: '关于 selfwriting',
      body: (host) => {
        U.append(host, [
          U.el('div', { style: { textAlign: 'center', margin: '4px 0 14px' } }, U.el('div', { style: { width: '72px', height: '72px', margin: '0 auto' }, html: '' })),
          U.el('div', { style: { fontSize: '15px', fontWeight: '650', textAlign: 'center' }, text: 'selfwriting · 离线创作' }),
          U.el('div', { style: { fontSize: '12px', color: 'var(--text-3)', textAlign: 'center', marginTop: '4px' }, text: '小说 · 文章 · 日记 · 大纲 · 阅读器 · 娱乐 · 隐私锁 · 成就 · 统计' }),
          U.el('div', { style: { height: '14px' } }),
          U.el('div.list', {}, [
            infoRow('数据存放', '全部保存在本机（IndexedDB + localStorage）'),
            infoRow('网络', '创作与数据全程离线；仅「网址下载」会联网取书'),
            infoRow('隐私', '可给任意作品单独设密码（娱乐 → 隐私锁）'),
            infoRow('成就', '小说每 10 万字、文章每 1 千字、日记按字数与天数'),
            infoRow('导出', 'TXT / Markdown / JSON 整库备份'),
            infoRow('版本', '1.15.0')
          ])
        ]);
      },
      footer: [
        { label: '导出整库备份', primary: true, close: false, onClick: () => { IO.backupAll().then(() => { UI.toast('备份已导出', 'down'); UI.closeSheet(); }); } },
        { label: '关闭', ghost: true }
      ]
    });
  }

  function infoRow(k, v) {
    return U.el('div.row', {}, [U.el('div.row-main', {}, [U.el('div.row-title', { text: k }), U.el('div.row-sub', { text: v })])]);
  }

  /* ================================================================== */
  /* 小说详情                                                          */
  /* ================================================================== */
  UI.route('library/novel/:id', function (view, params) {
    const n = Store.findNovel(params.id);
    if (!n) { U.append(view, UI.empty('close', '找不到这本小说', '可能已被删除', { label: '回到书架', onClick: () => UI.go('library') })); return; }
    /* 私密作品：解锁前不显示任何正文内容 */
    const P = global.Privacy;
    if (P && P.isLocked('novel', n.id) && !P.isUnlocked('novel', n.id)) {
      UI.setTitle('私密作品', '需要密码');
      P.lockedView(view, 'novel', n.id, null, () => UI.render());
      return;
    }
    const words = Store.novelWords(n);
    UI.setTitle(n.title || '未命名小说', (n.chapters || []).length + ' 章 · ' + U.fmtInt(words) + ' 字' + (n.status === 'finished' ? ' · 已完结' : ''));

    const head = U.el('div.card', {}, [
      U.el('div.card-head', {}, [
        U.el('div.card-title', { text: n.title || '未命名小说' }),
        U.el('span.badge', { text: n.category || '长篇小说' }),
        global.Profile && global.Profile.multiBadge(n),
        menuBtn(() => Lib.itemMenu('novel', n, { goBack: true }))
      ]),
      global.Profile && global.Profile.participantsLine(n, { style: { marginTop: '8px' } }),
      U.el('div.card-sub', {}, [
        U.el('span', { text: (n.chapters || []).length + ' 章' }),
        U.el('span', { text: U.fmtInt(words) + ' 字' }),
        U.el('span', { text: '更新于 ' + U.fmtWhen(n.updatedAt) }),
        n.author ? U.el('span', { text: '作者 ' + n.author }) : null
      ]),
      n.intro ? U.el('div.card-desc', { text: n.intro }) : null,
      U.el('div.grid2', { style: { marginTop: '12px' } }, [
        U.el('button.btn.primary', {
          onclick: () => {
            const last = n.chapters[n.chapters.length - 1];
            UI.go(last ? 'editor/' + n.id + '/' + last.id : 'editor/' + n.id);
          }
        }, [U.icon('feather', 'ico-sm'), U.el('span', { text: '继续写作' })]),
        U.el('button.btn', { onclick: () => UI.go('outline/' + n.id) }, [U.icon('tree', 'ico-sm'), U.el('span', { text: '大纲（' + countNodes(n.outline) + '）' })])
      ])
    ]);
    U.append(view, head);

    /* 章节列表 */
    const addChapter = () => {
      const ch = Store.addChapter(n.id, { title: '第' + (n.chapters.length + 1) + '章' });
      UI.toast('已新增章节', 'plus');
      UI.go('editor/' + n.id + '/' + ch.id);
    };
    U.append(view, U.el('div.section-title', {}, [
      U.icon('list', 'ico-sm'), U.el('span', { text: '章节' }), U.el('span.spacer'),
      U.el('button.chip', { text: '+ 新增', onclick: addChapter })
    ]));

    const list = U.el('div.list');
    (n.chapters || []).forEach((c, i) => {
      const cw = c.words || U.words(c.content || '');
      const goalPct = c.goal ? U.clamp(cw / c.goal, 0, 1) : 0;
      const row = U.el('div.chapter-item', {}, [
        U.el('div.chapter-ord', { text: String(i + 1) }),
        U.el('div.row-main', {
          onclick: () => UI.go('editor/' + n.id + '/' + c.id)
        }, [
          U.el('div.row-title', { text: c.title || '未命名章节' }),
          U.el('div.row-sub', {}, [
            U.el('span', { text: U.fmtInt(cw) + ' 字' }),
            c.goal ? U.el('span', { text: '目标 ' + U.fmtInt(c.goal) + (cw >= c.goal ? ' ✓ 已达标' : '') }) : null,
            (c.sections || []).length ? U.el('span', { text: (c.sections || []).length + ' 小节' }) : null,
            (c.participants || []).length > 1 ? U.el('span.multi-inline', { text: '多人创作 ' + c.participants.length }) : null,
            U.el('span', { text: U.fmtWhen(c.updatedAt) })
          ]),
          c.goal ? U.el('div', { style: { marginTop: '6px', maxWidth: '190px' } }, UI.progressBar(goalPct, 'thin')) : null
        ]),
        menuBtn(() => chapterMenu(n, c, i))
      ]);
      list.appendChild(row);
    });
    if (!(n.chapters || []).length) {
      U.append(view, UI.empty('list', '还没有章节', '', { label: '新增章节', onClick: addChapter }));
      return;
    }
    U.append(view, list);

    U.append(view, U.el('div.section-title', {}, [U.icon('down', 'ico-sm'), U.el('span', { text: '导出 / 导入' })]));
    U.append(view, U.el('div.grid2', {}, [
      U.el('button.btn', { onclick: () => { IO.exportItem('novel', n, 'txt'); UI.toast('已导出 TXT', 'down'); } }, [U.icon('down', 'ico-sm'), U.el('span', { text: '导出 TXT' })]),
      U.el('button.btn', { onclick: () => { IO.exportItem('novel', n, 'md'); UI.toast('已导出 Markdown', 'down'); } }, [U.icon('down', 'ico-sm'), U.el('span', { text: '导出 MD' })]),
      U.el('button.btn', { onclick: () => { IO.exportItem('outline', n, 'txt'); UI.toast('已导出大纲', 'down'); } }, [U.icon('tree', 'ico-sm'), U.el('span', { text: '导出大纲' })]),
      U.el('button.btn', { onclick: () => importIntoNovel(n) }, [U.icon('up', 'ico-sm'), U.el('span', { text: '导入章节' })])
    ]));

    /* 本书成就概览 */
    const data = global.Ach.byGroup(Store.state);
    const novelAch = (data.groups.novel || []).filter((x) => x.prog.unlocked).slice(0, 4);
    if (novelAch.length) {
      U.append(view, U.el('div.section-title', {}, [U.icon('trophy', 'ico-sm'), U.el('span', { text: '本书相关成就' })]));
      U.append(view, U.el('div.ach-grid', {}, novelAch.map((e) => UI.achievementCard(e, data.ctx))));
    }
  });

  function countNodes(nodes) {
    return Store.countNodes(nodes);
  }

  function chapterMenu(novel, chapter, index) {
    const items = [
      { label: '重命名', icon: 'edit', fn: () => UI.input({ title: '章节名', value: chapter.title }).then((v) => { if (v) Store.updateChapter(novel.id, chapter.id, { title: v }); }) },
      { label: '设置字数目标', icon: 'target', fn: () => UI.input({ title: '本章字数目标', value: String(chapter.goal || 0), type: 'number' }).then((v) => { if (v !== null) Store.updateChapter(novel.id, chapter.id, { goal: Math.max(0, Number(v) || 0) }); }) },
      { label: '导出本章', icon: 'down', fn: () => IO.exportChapter(novel, chapter, 'txt') },
      { label: '导出本章 Markdown', icon: 'down', fn: () => IO.exportChapter(novel, chapter, 'md') },
      { label: '上移', icon: 'up', fn: () => Store.moveChapter(novel.id, chapter.id, -1) },
      { label: '下移', icon: 'down', fn: () => Store.moveChapter(novel.id, chapter.id, 1) },
      { label: '删除本章', icon: 'trash', danger: true, fn: () => UI.confirm('删除章节', '「' + chapter.title + '」将被删除。', '删除', true).then((ok) => { if (ok) { Store.deleteChapter(novel.id, chapter.id); UI.toast('已删除', 'trash'); } }) }
    ];
    UI.sheet({
      title: chapter.title || '章节操作',
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

  function importIntoNovel(novel) {
    IO.pickFile('.txt,.md,.markdown', true).then((files) => {
      if (!files.length) return;
      Promise.all(files.map((f) => U.readFileAsText(f))).then((texts) => {
        let count = 0;
        texts.forEach((txt, i) => {
          const chapters = U.splitChapters(txt.replace(/^\uFEFF/, ''), 'auto');
          chapters.forEach((c) => { Store.addChapter(novel.id, { title: c.title, content: c.content, goal: null }); count++; });
        });
        UI.toast('已导入 ' + count + ' 个章节', 'check');
      });
    });
  }

  /* ================================================================== */
  /* 文章详情                                                          */
  /* ================================================================== */
  UI.route('library/article/:id', function (view, params) {
    const a = Store.findArticle(params.id);
    if (!a) { U.append(view, UI.empty('close', '找不到这篇文章', '', { label: '回到书架', onClick: () => UI.go('library') })); return; }
    UI.setTitle(a.title || '未命名文章', U.fmtInt(Store.articleWords(a)) + ' 字');
    U.append(view, U.el('div.card', {}, [
      U.el('div.card-head', {}, [
        U.el('div.card-title', { text: a.title }),
        menuBtn(() => Lib.itemMenu('article', a, { goBack: true }))
      ]),
      U.el('div.card-sub', {}, [
        U.el('span', { text: U.fmtInt(Store.articleWords(a)) + ' 字' }),
        U.el('span', { text: '更新于 ' + U.fmtWhen(a.updatedAt) }),
        (a.tags || []).length ? U.el('span', { text: a.tags.map((t) => '#' + t).join(' ') }) : null
      ]),
      U.el('button.btn.primary.block', { style: { marginTop: '12px' }, onclick: () => UI.go('editor/' + a.id) }, [U.icon('edit', 'ico-sm'), U.el('span', { text: '继续写作' })])
    ]));
    U.append(view, U.el('div.section-title', {}, [U.icon('eye', 'ico-sm'), U.el('span', { text: '预览' })]));
    const pre = U.el('div.card', { style: { fontFamily: 'var(--font-serif)', lineHeight: '1.85', whiteSpace: 'pre-wrap', maxHeight: '46vh', overflow: 'auto' } });
    pre.textContent = a.content || '（还没有内容）';
    U.append(view, pre);
    U.append(view, U.el('div.grid2', { style: { marginTop: '14px' } }, [
      U.el('button.btn', { onclick: () => { IO.exportItem('article', a, 'txt'); UI.toast('已导出', 'down'); } }, [U.icon('down', 'ico-sm'), U.el('span', { text: '导出 TXT' })]),
      U.el('button.btn', { onclick: () => { IO.exportItem('article', a, 'md'); UI.toast('已导出', 'down'); } }, [U.icon('down', 'ico-sm'), U.el('span', { text: '导出 MD' })])
    ]));
  });

  Lib.novelCard = novelCard;
  Lib.articleCard = articleCard;
  Lib.diaryCard = diaryCard;
  Lib.bookCard = bookCard;
  Lib.itemMenu = Lib.itemMenu;
  global.Library = Lib;
})(window);
