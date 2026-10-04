/* ==========================================================================
   selfwriting · view-collab.js
   协作：协作室 / 密友名单 / 分享包
   --------------------------------------------------------------------------
   三种「一起写」的方式，按场景分：
     · 协作室  —— 同一个 WiFi 下，一台开房，其他人输房间码加入，实时互见
     · 分享包  —— 不走网络：导出一个文件用微信/QQ 发给朋友，对方导入即合并
     · 密友名单 —— 记录常一起写的人，加入时不用每次输名字
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const Store = global.Store;
  const UI = global.UI;
  const C = global.Collab;

  const KIND_LABEL = { novel: '小说', article: '文章', diaryBook: '日记本', book: '读物' };

  /* ================================================================== */
  /* 路由：协作中心                                                      */
  /* ================================================================== */
  UI.route('collab', function (view) {
    const st = C.state();
    const P = global.Privacy;
    UI.setTitle('协作与分享', st.room ? '房间 ' + st.room : '和朋友一起写');

    /* ---- 当前房间状态 ---- */
    const roomCard = U.el('div.card');
    if (st.room) {
      const members = C.room.members && C.room.members.length ? C.room.members : [C.me()];
      U.append(roomCard, [
        U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
          U.el('div.privacy-lock-ico', { style: { background: 'color-mix(in srgb, var(--ok) 18%, transparent)', color: 'var(--ok)' } }, U.icon('users')),
          U.el('div', { style: { flex: '1 1 auto' } }, [
            U.el('div', { style: { fontWeight: '650', fontSize: '15px' }, text: '房间 ' + st.room }),
            U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px' },
              text: '我的昵称：' + C.me() + ' · ' + members.length + ' 人在线：' + members.join('、') })
          ])
        ]),
        U.el('div.grid2', { style: { marginTop: '12px' } }, [
          U.el('button.btn', { onclick: () => shareRoomInfo(st) }, [U.icon('link', 'ico-sm'), U.el('span', { text: '告诉朋友怎么加入' })]),
          U.el('button.btn.danger', {
            onclick: () => UI.confirm('退出房间', '退出后不再接收对方改动，本地内容保留。', '退出', true).then((ok) => {
              if (!ok) return;
              C.leaveRoom();
              UI.toast('已退出房间', 'close');
              UI.render();
            })
          }, [U.icon('close', 'ico-sm'), U.el('span', { text: '退出房间' })])
        ])
      ]);
    } else {
      U.append(roomCard, [
        U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
          U.el('div.privacy-lock-ico', {}, U.icon('users')),
          U.el('div', { style: { flex: '1 1 auto' } }, [
            U.el('div', { style: { fontWeight: '650', fontSize: '15px' }, text: '还没有加入协作室' }),
            U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px' },
              text: '同一个 WiFi 下，一台设备开房，其他人输房间码加入' })
          ])
        ]),
        U.el('div.grid2', { style: { marginTop: '12px' } }, [
          U.el('button.btn.primary', { onclick: () => hostFlow() }, [U.icon('plus', 'ico-sm'), U.el('span', { text: '开一个房间' })]),
          U.el('button.btn', { onclick: () => joinFlow() }, [U.icon('link', 'ico-sm'), U.el('span', { text: '输入房间码加入' })])
        ])
      ]);
    }
    U.append(view, roomCard);

    /* ---- 我的昵称 ---- */
    const nameInput = U.el('input.input', { value: C.me(), placeholder: '别人看到的名字' });
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim() || C.me();
      C.state().me = v;
      C.save();
      UI.toast('昵称已改为 ' + v, 'check');
      UI.render();
    });
    U.append(view, U.el('div.section-title', {}, [U.icon('edit', 'ico-sm'), U.el('span', { text: '我的昵称' })]));
    U.append(view, U.el('div.card', {}, [
      nameInput,
      U.el('div.field-note', { text: '协作时对方看到的就是这个名字。' })
    ]));

    /* ---- 协作中的作品 ---- */
    U.append(view, U.el('div.section-title', {}, [
      U.icon('feather', 'ico-sm'), U.el('span', { text: '协作中的作品' }),
      U.el('span.spacer'), U.el('span', { text: String(st.works.length), style: { fontWeight: '500' } })
    ]));
    if (!st.works.length) {
      U.append(view, U.el('div.note-empty', {
        text: '还没有作品加入协作。打开一部小说 / 文章 / 日记本，在「更多」菜单里选「加入协作」。'
      }));
    } else {
      const list = U.el('div.list');
      st.works.forEach((w) => {
        const unread = C.unread(w.kind, w.id);
        list.appendChild(U.el('div.row', {
          onclick: () => openWork(w)
        }, [
          U.el('div.row-ico', {}, U.icon(w.role === 'read' ? 'eye' : 'edit')),
          U.el('div.row-main', {}, [
            U.el('div.row-title', { text: w.title || '（无标题）' }),
            U.el('div.row-sub', { text: (KIND_LABEL[w.kind] || '作品') + ' · ' + (w.role === 'read' ? '只读' : '可编辑')
              + (unread ? ' · ' + unread + ' 条新消息' : '') })
          ]),
          unread ? U.el('span.badge.ok', { text: String(unread) }) : U.icon('chevron', 'ico-sm')
        ]));
      });
      U.append(view, list);
    }

    /* ---- 密友名单 ---- */
    U.append(view, U.el('div.section-title', {}, [U.icon('star', 'ico-sm'), U.el('span', { text: '密友名单' })]));
    const friendList = U.el('div.list');
    if (!st.friends.length) {
      U.append(view, U.el('div.note-empty', { text: '把常一起写的人记下来，之后加入时直接选，不用每次输名字。' }));
    } else {
      st.friends.forEach((f) => {
        friendList.appendChild(U.el('div.row', {}, [
          U.el('div.row-ico', {}, U.icon('users')),
          U.el('div.row-main', {}, [
            U.el('div.row-title', { text: f.name }),
            U.el('div.row-sub', { text: '添加于 ' + U.fmtWhen(f.at) })
          ]),
          U.el('button.btn.sm', {
            onclick: () => {
              st.friends = st.friends.filter((x) => x.name !== f.name);
              C.save(); UI.render();
            }
          }, [U.el('span', { text: '移除' })])
        ]));
      });
      U.append(view, friendList);
    }
    U.append(view, U.el('div.grid2', { style: { marginTop: '10px' } }, [
      U.el('button.btn', {
        onclick: () => UI.input({ title: '添加密友', placeholder: '对方的昵称' }).then((v) => {
          const n = String(v || '').trim();
          if (!n) return;
          if (st.friends.some((f) => f.name === n)) { UI.toast('已经在名单里了', 'close'); return; }
          st.friends.push({ name: n, at: Date.now() });
          C.save();
          UI.render();
        })
      }, [U.icon('plus', 'ico-sm'), U.el('span', { text: '添加密友' })]),
      U.el('button.btn', { onclick: () => sharePackFlow() }, [U.icon('share', 'ico-sm'), U.el('span', { text: '生成分享包' })])
    ]));

    U.append(view, U.el('div', {
      style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '16px', lineHeight: '1.9' },
      text: '协作是「段落级合并且不覆盖」：你和对方各写各的段落，合并时两边的段落都会保留，谁也不会盖掉谁。'
        + '房间只在局域网内存活（关掉主机即结束）；不在一起时可以用分享包互传。'
    }));
  });

  /* ================================================================== */
  /* 开房 / 加入                                                         */
  /* ================================================================== */
  function hostFlow() {
    const code = C.newRoomCode();
    const nameInput = U.el('input.input', { value: C.me() });
    nameInput.addEventListener('change', () => { C.state().me = nameInput.value.trim() || C.me(); C.save(); });

    UI.sheet({
      title: '开一个协作室',
      body: (host) => {
        U.append(host, [
          U.el('div.card', { style: { textAlign: 'center' } }, [
            U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)' }, text: '房间码' }),
            U.el('div', { style: { fontSize: '30px', fontWeight: '750', letterSpacing: '.16em', margin: '6px 0 2px' }, text: code }),
            U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)' }, text: '把这个码和你的地址告诉朋友' })
          ]),
          U.el('div.field', {}, [U.el('label', { text: '我的昵称' }), nameInput]),
          U.el('div.fmt-hint', { style: { marginTop: '12px' } }, [
            U.el('div.fmt-hint-title', {}, [U.icon('bulb', 'ico-sm'), U.el('span', { text: '朋友怎么加入' })]),
            U.el('div.fmt-hint-list', {}, [
              U.el('div.fmt-hint-row', {}, [U.el('span.fmt-ext', { text: '同一 WiFi' }), U.el('span.fmt-note', { text: '朋友打开你屏幕上显示的地址（形如 http://192.168.x.x:8099），进「协作与分享」输房间码' })]),
              U.el('div.fmt-hint-row', {}, [U.el('span.fmt-ext', { text: '不在一起' }), U.el('span.fmt-note', { text: '用「生成分享包」导出发给对方，对方导入即合并' })])
            ])
          ])
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '开房', primary: true, close: false, onClick: () => {
          UI.closeSheet();
          const note = UI.toast('正在创建房间…', 'up', 20000);
          C.hostRoom({ code: code }).then(() => {
            if (note && note.parentNode) note.parentNode.removeChild(note);
            UI.toast('房间已创建：' + code, 'check');
            UI.render();
            setTimeout(() => shareRoomInfo(C.state()), 400);
          }).catch((e) => {
            if (note && note.parentNode) note.parentNode.removeChild(note);
            UI.alert('创建房间失败', String(e && e.message || e)
              + '\n\n协作室需要本机服务在运行（电脑上双击「selfwriting 创作」，APK 内部自带）。');
          });
        } }
      ]
    });
  }

  function shareRoomInfo(st) {
    const addr = st.hostUrl || location.origin;
    const code = st.room;
    const lines = [
      '一起写点什么？',
      '',
      '1. 连同一个 WiFi',
      '2. 浏览器打开：' + addr,
      '3. 进入「协作与分享」→「输入房间码加入」',
      '4. 房间码：' + code,
      ''
      + '（提示：如果用手机加入，把上面的地址原样粘到浏览器里就行）'
    ].join('\n');
    UI.sheet({
      title: '告诉朋友怎么加入',
      body: (h) => {
        U.append(h, [
          U.el('div.card', { style: { textAlign: 'center' } }, [
            U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)' }, text: '房间码' }),
            U.el('div', { style: { fontSize: '30px', fontWeight: '750', letterSpacing: '.16em', margin: '6px 0' }, text: code })
          ]),
          U.el('div', { style: { fontSize: '13px', lineHeight: '2', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }, text: lines })
        ]);
      },
      footer: [
        { label: '关闭', ghost: true },
        { label: '复制邀请信息', primary: true, close: false, onClick: () => {
          if (global.IO && global.IO.copyText) global.IO.copyText(lines);
          UI.toast('已复制，发给朋友即可', 'check');
        } }
      ]
    });
  }

  function joinFlow() {
    const addrInput = U.el('input.input', { placeholder: 'http://192.168.1.5:8099', value: C.state().hostUrl || '' });
    const codeInput = U.el('input.input', { placeholder: '6 位房间码', autocapitalize: 'characters', style: { letterSpacing: '.2em', textTransform: 'uppercase' } });
    const st = C.state();
    const friendChips = U.el('div.chips.scroll');
    if (st.friends.length) {
      st.friends.forEach((f) => {
        friendChips.appendChild(U.el('button.chip', {
          text: f.name,
          onclick: () => { C.state().me = f.name; C.save(); UI.toast('昵称已设为 ' + f.name, 'check'); }
        }));
      });
    }
    const tip = U.el('div.field-note', { text: '地址就是主机屏幕上显示的那个（本机服务地址）。' });

    const doJoin = () => {
      const addr = addrInput.value.trim();
      const code = codeInput.value.trim().toUpperCase();
      if (!/^https?:\/\//i.test(addr)) { tip.style.color = 'var(--danger)'; tip.textContent = '主机地址要以 http:// 开头'; return; }
      if (code.length < 4) { tip.style.color = 'var(--danger)'; tip.textContent = '请填 6 位房间码'; return; }
      tip.style.color = '';
      tip.textContent = '正在连接…';
      const note = UI.toast('正在加入…', 'up', 20000);
      C.joinRoom(addr, code).then(() => {
        if (note && note.parentNode) note.parentNode.removeChild(note);
        UI.closeSheet();
        UI.toast('已加入房间 ' + code, 'check');
        UI.render();
      }).catch((e) => {
        if (note && note.parentNode) note.parentNode.removeChild(note);
        tip.style.color = 'var(--danger)';
        tip.textContent = String(e && e.message || e);
      });
    };
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

    UI.sheet({
      title: '加入协作室',
      body: (h) => {
        U.append(h, [
          U.el('div.field', {}, [U.el('label', { text: '主机地址' }), addrInput]),
          U.el('div.field', {}, [U.el('label', { text: '房间码' }), codeInput]),
          st.friends.length ? U.el('div.field', {}, [U.el('label', { text: '用哪个名字' }), friendChips]) : null,
          tip
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '加入', primary: true, close: false, onClick: doJoin }
      ]
    });
  }

  /* ================================================================== */
  /* 打开协作作品（跳到对应写作页）                                      */
  /* ================================================================== */
  function openWork(w) {
    if (w.kind === 'novel') {
      const n = Store.findNovel(w.id);
      if (!n) { UI.toast('这本小说已经被删除了', 'close'); return; }
      const last = n.chapters[n.chapters.length - 1];
      UI.go(last ? 'editor/' + n.id + '/' + last.id : 'library/novel/' + n.id);
    } else if (w.kind === 'article') {
      UI.go('editor/' + w.id);
    } else if (w.kind === 'diaryBook') {
      UI.go('diary/' + w.id);
    }
  }

  /* ================================================================== */
  /* 分享包（不走网络的文件传递）                                        */
  /* ================================================================== */
  /**
   * 分享包是一个 JSON：包含作品内容 + 段落元数据（合并需要它），
   * 可选「只读」。直接用系统的「下载/分享」，通过微信、QQ、数据线都能传。
   */
  function sharePackFlow() {
    const st = Store.state;
    const items = [];
    (st.novels || []).forEach((n) => items.push({ kind: 'novel', id: n.id, title: n.title }));
    (st.articles || []).forEach((a) => items.push({ kind: 'article', id: a.id, title: a.title }));
    (st.diaries || []).forEach((d) => items.push({ kind: 'diaryBook', id: d.id, title: d.title }));

    if (!items.length) { UI.alert('没有可分享的作品', '先写点什么吧。'); return; }

    let chosen = items[0];
    let readonly = false;
    const listHost = U.el('div.list');
    const readonlyRow = U.el('div');

    function paintList() {
      U.clear(listHost);
      items.forEach((it) => {
        listHost.appendChild(U.el('div.row' + (chosen.kind === it.kind && chosen.id === it.id ? '.active' : ''), {
          onclick: () => { chosen = it; paintList(); }
        }, [
          U.el('div.row-ico', {}, U.icon(it.kind === 'novel' ? 'feather' : it.kind === 'article' ? 'doc' : 'calendar')),
          U.el('div.row-main', {}, [
            U.el('div.row-title', { text: it.title || '（无标题）' }),
            U.el('div.row-sub', { text: KIND_LABEL[it.kind] || '' })
          ])
        ]));
      });
      U.clear(readonlyRow);
      U.append(readonlyRow, UI.switchRow('只读分享', '对方只能看，合并时会忽略他的改动', readonly, (v) => { readonly = v; }));
    }
    paintList();

    UI.sheet({
      title: '生成分享包',
      body: (host) => {
        U.append(host, [
          U.el('div.field-note', { text: '选一部作品，导出成一个文件发给朋友；对方导入时自动合并且不会覆盖各自的内容。' }),
          U.el('div.section-title', {}, [U.icon('list', 'ico-sm'), U.el('span', { text: '选择作品' })]),
          listHost,
          readonlyRow
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '生成并保存', primary: true, close: false, onClick: () => {
          UI.closeSheet();
          const pack = makePack(chosen.kind, chosen.id, readonly);
          if (!pack) { UI.alert('导出失败', '找不到这部作品。'); return; }
          const name = (chosen.title || '作品').replace(/[\\/:*?"<>|]/g, '_') + '.swshare.json';
          global.IO.download(name, JSON.stringify(pack), 'application/json');
          UI.toast('分享包已生成，发给朋友即可', 'share');
        } }
      ]
    });
  }

  /** 打包一部作品 */
  function makePack(kind, id, readonly) {
    const base = {
      format: 'selfwriting-share',
      version: 1,
      kind: kind,
      readonly: !!readonly,
      from: C.me(),
      at: Date.now(),
      room: C.state().room || null
    };
    if (kind === 'novel') {
      const n = Store.findNovel(id);
      if (!n) return null;
      return Object.assign(base, {
        title: n.title,
        chapters: (n.chapters || []).map((c) => ({
          title: c.title, content: c.content, createdAt: c.createdAt, paraMeta: c.paraMeta || null
        })),
        outline: n.outline || []
      });
    }
    if (kind === 'article') {
      const a = Store.findArticle(id);
      if (!a) return null;
      return Object.assign(base, {
        title: a.title, content: a.content,
        paraMeta: a.paraMeta || null, tags: a.tags || []
      });
    }
    if (kind === 'diaryBook') {
      const d = Store.findDiary(id);
      if (!d) return null;
      return Object.assign(base, {
        title: d.title, kind2: d.kind,
        entries: (d.entries || []).map((e) => ({ dateKey: e.dateKey, title: e.title, content: e.content, author: e.author || '' }))
      });
    }
    return null;
  }

  /** 导入分享包（合并，不覆盖） */
  function importPack(pack, opt) {
    const o = opt || {};
    if (!pack || pack.format !== 'selfwriting-share') throw new Error('这不是 selfwriting 分享包');
    const C2 = global.Collab;
    if (pack.kind === 'novel') {
      /* 找到同名小说就合并，没有就新建 */
      let target = (Store.state.novels || []).find((n) => n.title === pack.title);
      let created = false;
      if (!target) {
        const nv = Store.createNovel({ title: pack.title + '（协作）', category: '未分类', countAchievements: false });
        target = Store.findNovel(nv.id);
        created = true;
      }
      let addedParas = 0;
      (pack.chapters || []).forEach((rc) => {
        let local = (target.chapters || []).find((c) => c.title === rc.title);
        if (!local) {
          const nc = Store.addChapter(target.id, { title: rc.title || '新章节' });
          local = Store.findChapter(target.id, nc.id);
        }
        const merged = C2.mergeChapter(
          { content: local.content || '', paraMeta: local.paraMeta },
          { content: rc.content || '', paraMeta: rc.paraMeta },
          { localAuthor: C2.me(), remoteAuthor: pack.from || '对方' }
        );
        addedParas += Math.max(0, merged.added);
        Store.setChapterContent(target.id, local.id, merged.content);
        const live = Store.findChapter(target.id, local.id);
        if (live) live.paraMeta = merged.meta;
      });
      Store.commit((s) => { const n = Store.findNovel(target.id); if (n) Store.recomputeNovel(n); }, { kind: 'collab:merge' });
      return { ok: true, created: created, title: target.title, addedParas: addedParas };
    }
    if (pack.kind === 'article') {
      let target = (Store.state.articles || []).find((a) => a.title === pack.title);
      let created = false;
      if (!target) {
        const a = Store.createArticle({ title: pack.title + '（协作）', countAchievements: false });
        target = Store.findArticle(a.id);
        created = true;
      }
      const merged = C2.mergeChapter(
        { content: target.content || '', paraMeta: target.paraMeta },
        { content: pack.content || '', paraMeta: pack.paraMeta },
        { localAuthor: C2.me(), remoteAuthor: pack.from || '对方' }
      );
      Store.setArticleContent(target.id, merged.content);
      const live = Store.findArticle(target.id);
      if (live) live.paraMeta = merged.meta;
      return { ok: true, created: created, title: target.title, addedParas: Math.max(0, merged.added) };
    }
    if (pack.kind === 'diaryBook') {
      let target = (Store.state.diaries || []).find((d) => d.title === pack.title);
      if (!target) {
        const d = Store.createDiaryBook({ title: pack.title + '（共享）', kind: pack.kind2 || 'daily' });
        target = Store.findDiary(d.id);
      }
      /* 多人日记：每条记录带上作者，按 (日期 + 作者) 去重，不覆盖别人写的 */
      let added = 0;
      (pack.entries || []).forEach((re) => {
        const who = re.author || pack.from || '对方';
        const dup = (target.entries || []).some((e) => e.dateKey === re.dateKey && (e.author || '') === who);
        if (dup) return;
        Store.addDiaryEntry(target.id, { dateKey: re.dateKey, title: re.title, content: re.content, author: who });
        added++;
      });
      return { ok: true, created: false, title: target.title, addedEntries: added };
    }
    throw new Error('分享包里是暂不支持的作品类型');
  }

  /* 供导入入口调用 */
  global.CollabView = { importPack: importPack, makePack: makePack, hostFlow: hostFlow, joinFlow: joinFlow };
})(window);
