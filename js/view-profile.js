/* ==========================================================================
   selfwriting · view-profile.js
   个人档案（本机账号）+ 状态（仿微信 / QQ）+ 密友名单 + 多人创作参与者
   --------------------------------------------------------------------------
   · 这个应用完全离线，所以「注册」就是在这台设备上建一份自己的档案：
     昵称 + 头像（表情或相册图片）+ 专属码，用来在协作时表明身份。
   · 状态：一行字 + 表情，可以随时更新，也能设「1 小时 / 今天 / 本周」这样的时效；
     显示在个人页、首页状态卡，以及作品的参与者信息里。
   · 多人创作：作品 / 章节 / 日记条目都能记下参与者，界面上统一标「多人创作 · 参与者」。
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const UI = global.UI;
  const Store = global.Store;
  const P = {};

  /* 预设头像（表情）：不占空间，离线可用 */
  const AVATARS = ['🐱', '🐶', '🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐧', '🦉', '🐳', '🦄',
    '🌸', '🌿', '🍀', '🌙', '⭐', '🔥', '☕', '📖', '✒️', '🎧', '🎹', '🎸'];

  /* 状态表情：仿聊天软件那一排 */
  const STATUS_EMOJI = ['😀', '😄', '😌', '😴', '🤔', '😮‍💨', '🥳', '😭', '😤', '🤒',
    '📖', '✍️', '🎧', '☕', '🌙', '🔥', '💪', '🎯', '🚀', '🌧️'];

  const STATUS_PRESETS = ['专注写作中', '今天想写点东西', '在看书', '摸鱼中', '离线勿扰', '心情不错', '赶稿中', '刚刚起床'];

  function me() { return Store.profile(); }
  function isRegistered() { return Store.isRegistered(); }
  function myName() { return me().name || '我'; }

  /* ================================================================== */
  /* 头像 / 名字的小组件                                                */
  /* ================================================================== */
  function avatarEl(person, size) {
    const px = size || 40;
    const av = Store.avatarOf(person);
    const box = U.el('div.avatar', {
      style: { width: px + 'px', height: px + 'px', fontSize: Math.round(px * 0.5) + 'px' }
    });
    if (av.kind === 'img') {
      const im = U.el('img', { alt: '' });
      im.src = av.src;
      box.appendChild(im);
    } else {
      box.appendChild(U.el('span', { text: av.text }));
    }
    return box;
  }

  /** 头像 + 昵称（一行） */
  function chip(person, opts) {
    const o = opts || {};
    const wrap = U.el('div.person-chip' + (o.tap ? '.tap' : ''), o.onclick ? { onclick: o.onclick } : null, [
      avatarEl(person, o.size || 28),
      U.el('span.person-name', { text: (person && person.name) || '我' }),
      o.sub ? U.el('span.person-sub', { text: o.sub }) : null
    ]);
    return wrap;
  }

  /** 'A、B、C' */
  function joinNames(list) {
    const arr = (list || []).map((x) => String(x).trim()).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length <= 3) return arr.join('、');
    return arr.slice(0, 3).join('、') + ' 等 ' + arr.length + ' 人';
  }

  /** 参与者一行：「多人创作 · 参与者：A、B」；单人或不标注时返回 null */
  function participantsLine(item, opts) {
    const o = opts || {};
    const people = Store.participantsOf(item);
    if (!people || people.length < 2) return null;
    return U.el('div.multi-line', {
      style: o.style || null,
      text: '多人创作 · 参与者：' + joinNames(people)
    });
  }

  /** 小徽标：多人创作 */
  function multiBadge(item) {
    const people = Store.participantsOf(item);
    if (!people || people.length < 2) return null;
    return U.el('span.badge.multi', { title: '参与者：' + joinNames(people) }, [
      U.icon('users', 'ico-sm'),
      U.el('span', { text: ' 多人创作 ' + people.length })
    ]);
  }

  /** 本机所有可署名的人：我 + 密友 */
  function allPeople() {
    const list = [{ name: myName(), code: Store.userCode(), emoji: me().emoji, avatar: me().avatar, self: true }];
    const c = global.Collab ? global.Collab.state() : null;
    ((c && c.friends) || []).forEach((f) => {
      list.push({ name: f.name, code: f.code || '', emoji: f.emoji || '', avatar: f.avatar || '' });
    });
    return list;
  }

  /**
   * 自动推断参与者：协作室里的人 + 已经写进作品里的人。
   * 新章节 / 新条目默认用这份名单，用户可以再手动勾。
   */
  function autoParticipants(kind, id) {
    const names = [];
    const c = global.Collab ? global.Collab.state() : null;
    if (c && global.Collab.isShared && global.Collab.isShared(kind, id)) {
      names.push(myName());
      ((c.room && c.room.members) || []).forEach((m) => { if (m && names.indexOf(m) < 0) names.push(m); });
      (c.friends || []).forEach((f) => { if (f && f.name && names.indexOf(f.name) < 0) names.push(f.name); });
    }
    const item = kind === 'novel' ? Store.findNovel(id) : kind === 'article' ? Store.findArticle(id) : kind === 'diary' ? Store.findDiary(id) : null;
    Store.participantsOf(item).forEach((n) => { if (names.indexOf(n) < 0) names.push(n); });
    if (names.indexOf(myName()) < 0) names.unshift(myName());
    return names;
  }

  /**
   * 参与者选择器（写作页 / 日记编辑弹层里用）
   * 返回 { el, get() }：el 是一排可点的人名 chip，get() 取当前勾选的名字数组。
   */
  function picker(initial, opts) {
    const o = opts || {};
    let picked = (initial && initial.length ? initial.slice() : [myName()]);
    const wrap = U.el('div.chips.wrap.multi-pick');
    const people = allPeople();
    const render = () => {
      U.clear(wrap);
      people.forEach((p) => {
        const on = picked.indexOf(p.name) >= 0;
        wrap.appendChild(U.el('button.chip' + (on ? '.active' : ''), {
          text: p.name + (p.self ? '（我）' : ''),
          onclick: () => {
            const i = picked.indexOf(p.name);
            if (i >= 0) {
              if (picked.length <= 1) { UI.toast('至少要留一个人', 'close'); return; }
              picked.splice(i, 1);
            } else picked.push(p.name);
            render();
          }
        }));
      });
      /* 不在名单里的人也能临时加进来 */
      wrap.appendChild(U.el('button.chip.ghost', {
        text: '+ 其他人',
        onclick: () => UI.input({ title: '一起写的人', placeholder: '名字', value: '' }).then((v) => {
          const name = String(v || '').trim();
          if (!name) return;
          if (picked.indexOf(name) < 0) picked.push(name);
          if (!people.some((x) => x.name === name)) people.push({ name: name });
          render();
        })
      }));
    };
    render();
    return {
      el: wrap,
      get: () => picked.slice(),
      set: (list) => { picked = (list || []).slice(); render(); }
    };
  }

  /** 多人创作模式入口（一块可以塞进任意表单的控件） */
  function multiBlock(initial, opts) {
    const o = opts || {};
    const state = { on: (initial || []).length > 1 };
    const row = picker(initial, o);
    const box = U.el('div.multi-box');
    const body = U.el('div', { style: { marginTop: '8px' } }, [row.el]);
    const hint = U.el('div.field-note', {
      text: '勾上一起写的人，保存后会标成「多人创作」并显示参与者。'
    });
    const toggle = U.el('button.switch' + (state.on ? '.on' : ''), {
      onclick: () => {
        state.on = !state.on;
        toggle.className = 'switch' + (state.on ? ' on' : '');
        body.style.display = state.on ? '' : 'none';
        hint.style.display = state.on ? '' : 'none';
      }
    }, U.el('i'));
    U.append(box, [
      U.el('div.multi-head', {}, [
        U.icon('users', 'ico-sm'),
        U.el('span.multi-title', { text: '多人创作' }),
        U.el('span', { style: { flex: '1 1 auto' } }),
        U.el('span.multi-sub', { text: state.on ? '已开启' : '只有我' }),
        toggle
      ]),
      body,
      hint
    ]);
    if (!state.on) { body.style.display = 'none'; hint.style.display = 'none'; }
    return {
      el: box,
      /** 保存时调用：返回参与者数组（1 个就是单人） */
      get: () => (state.on ? row.get() : [myName()]),
      isMulti: () => state.on && row.get().length > 1,
      set: (list) => { row.set(list); state.on = (list || []).length > 1; }
    };
  }

  /* ================================================================== */
  /* 注册 / 编辑资料                                                    */
  /* ================================================================== */
  function avatarSheet(current, onPick) {
    const sheet = UI.sheet({
      title: '选头像',
      body: (host) => {
        const grid = U.el('div.avatar-grid');
        AVATARS.forEach((a) => grid.appendChild(U.el('button.avatar-cell' + (current === a ? '.active' : ''), {
          text: a,
          onclick: () => { UI.closeSheet(); onPick({ emoji: a, avatar: '' }); }
        })));
        U.append(host, [
          U.el('div.section-title', {}, [U.el('span', { text: '表情头像' })]),
          grid,
          U.el('div.section-title', { style: { marginTop: '14px' } }, [U.el('span', { text: '自己的图片' })]),
          U.el('div.grid2', {}, [
            U.el('button.btn', {
              onclick: () => {
                global.IOApi.pickFile('image/*', false).then((files) => {
                  const f = files && files[0];
                  if (!f) return;
                  UI.toast('正在处理图片…', 'image');
                  U.compressImage(f, 320, 0.82).then((data) => {
                    UI.closeSheet();
                    onPick({ avatar: data, emoji: '' });
                    UI.toast('头像已更新', 'check');
                  }).catch((e) => UI.alert('图片处理失败', String((e && e.message) || e)));
                });
              }
            }, [U.icon('image', 'ico-sm'), U.el('span', { text: '从相册选' })]),
            U.el('button.btn.ghost', {
              onclick: () => { UI.closeSheet(); onPick({ emoji: '', avatar: '' }); }
            }, [U.icon('close', 'ico-sm'), U.el('span', { text: '用昵称首字' })])
          ]),
          U.el('div.field-note', { style: { marginTop: '10px' }, text: '图片会压缩后存在本机，不会上传到任何地方。' })
        ]);
      }
    });
    return sheet;
  }

  /** 注册 / 编辑资料弹层 */
  function registerSheet(onDone) {
    const p = me();
    const draft = { name: p.name === '我' ? '' : p.name, emoji: p.emoji, avatar: p.avatar, bio: p.bio || '' };
    const isNew = !isRegistered();
    const nameInput = U.el('input.input', { value: draft.name, placeholder: '给自己起个名字', maxlength: '16', dataset: { i18nSkip: '1' } });
    const bioInput = U.el('input.input', { value: draft.bio, placeholder: '一句话签名（可留空）', maxlength: '30', dataset: { i18nSkip: '1' } });
    const avBox = U.el('div.avatar-pick');
    const codeEl = U.el('div.code-pill', { dataset: { i18nSkip: '1' }, text: Store.userCode() });

    const renderAvatar = () => {
      U.clear(avBox);
      avBox.appendChild(avatarEl({ name: draft.name || '我', emoji: draft.emoji, avatar: draft.avatar }, 64));
      avBox.appendChild(U.el('button.btn.sm', {
        onclick: () => avatarSheet(draft.emoji, (r) => {
          Object.assign(draft, r);
          renderAvatar();
        })
      }, [U.icon('image', 'ico-sm'), U.el('span', { text: '换头像' })]));
    };
    renderAvatar();

    const sheet = UI.sheet({
      title: isNew ? '注册我的账号' : '编辑资料',
      body: (host) => {
        U.append(host, [
          U.el('div.card', {}, [
            U.el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, [
              avBox,
              U.el('div', { style: { flex: '1 1 auto' } }, [
                U.el('div', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: isNew ? '这个名字会用在协作署名、日记作者上' : '昵称改了，协作署名会一起改' }),
                U.el('div', { style: { marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' } }, [
                  U.el('span', { style: { fontSize: '12px', color: 'var(--text-3)' }, text: '专属码' }),
                  codeEl
                ])
              ])
            ])
          ]),
          U.el('div.field', {}, [U.el('label', { text: '昵称' }), nameInput]),
          U.el('div.field', {}, [U.el('label', { text: '签名' }), bioInput]),
          U.el('div.field-note', {
            text: '专属码是这台设备给你生成的，朋友用它把你加进密友名单；全程离线，不会上传。'
          })
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        {
          label: isNew ? '完成注册' : '保存',
          primary: true,
          close: false,
          onClick: () => {
            const name = nameInput.value.trim();
            if (!name) { UI.toast('先写个昵称', 'close'); try { nameInput.focus(); } catch (e) { /* noop */ } return; }
            Store.saveProfile({ name: name, emoji: draft.emoji, avatar: draft.avatar, bio: bioInput.value.trim(), registered: true });
            UI.closeSheet();
            UI.toast(isNew ? '注册好了，欢迎 ' + name : '资料已更新', 'check');
            UI.render();
            if (onDone) onDone();
          }
        }
      ],
      onMount: () => setTimeout(() => { try { nameInput.focus(); } catch (e) { /* noop */ } }, 200)
    });
    return sheet;
  }

  /* ================================================================== */
  /* 状态（仿微信 / QQ）                                                */
  /* ================================================================== */
  function statusSheet() {
    const cur = me().status || {};
    const draft = { text: cur.text || '', emoji: cur.emoji || '', hours: 0 };
    const input = U.el('input.input', { value: draft.text, placeholder: '此刻在做什么？', maxlength: '60', dataset: { i18nSkip: '1' } });
    const emojiRow = U.el('div.chips.scroll');
    const renderEmoji = () => {
      U.clear(emojiRow);
      STATUS_EMOJI.forEach((e) => emojiRow.appendChild(U.el('button.chip' + (draft.emoji === e ? '.active' : ''), {
        text: e,
        onclick: () => { draft.emoji = draft.emoji === e ? '' : e; renderEmoji(); }
      })));
    };
    renderEmoji();
    const hourChips = U.el('div.chips');
    const HOURS = [[0, '一直显示'], [1, '1 小时'], [8, '今天'], [24, '一天'], [168, '本周']];
    const renderHours = () => {
      U.clear(hourChips);
      HOURS.forEach(([h, label]) => hourChips.appendChild(U.el('button.chip' + (draft.hours === h ? '.active' : ''), {
        text: label,
        onclick: () => { draft.hours = h; renderHours(); }
      })));
    };
    renderHours();

    UI.sheet({
      title: '更新状态',
      body: (host) => {
        const presetRow = U.el('div.chips.wrap');
        STATUS_PRESETS.forEach((s) => presetRow.appendChild(U.el('button.chip', {
          text: s,
          onclick: () => { input.value = s; draft.text = s; }
        })));
        U.append(host, [
          U.el('div.field', {}, [U.el('label', { text: '状态' }), input]),
          U.el('div.field', {}, [U.el('label', { text: '表情' }), emojiRow]),
          U.el('div.field', {}, [U.el('label', { text: '时效' }), hourChips]),
          U.el('div.section-title', { style: { marginTop: '12px' } }, [U.el('span', { text: '常用' })]),
          presetRow,
          U.el('div.field-note', { style: { marginTop: '10px' }, text: '状态会显示在个人页和首页；点「清除」可以撤掉。' })
        ]);
      },
      footer: [
        { label: '清除', ghost: true, close: false, onClick: () => { Store.clearStatus(); UI.closeSheet(); UI.toast('状态已清除', 'check'); UI.render(); } },
        {
          label: '保存',
          primary: true,
          close: false,
          onClick: () => {
            const text = input.value.trim();
            if (!text) { UI.toast('写一句状态吧', 'close'); return; }
            Store.setStatus(text, { emoji: draft.emoji, hours: draft.hours });
            UI.closeSheet();
            UI.toast('状态已更新', 'check');
            UI.render();
          }
        }
      ],
      onMount: () => setTimeout(() => { try { input.focus(); } catch (e) { /* noop */ } }, 200)
    });
  }

  /* ================================================================== */
  /* 密友（联系人）                                                     */
  /* ================================================================== */
  function friendSheet() {
    const nameInput = U.el('input.input', { placeholder: '对方的名字', maxlength: '16', dataset: { i18nSkip: '1' } });
    const codeInput = U.el('input.input', { placeholder: '专属码（形如 SW-XXXXXX）', maxlength: '12', dataset: { i18nSkip: '1' } });
    UI.sheet({
      title: '添加密友',
      body: (host) => {
        U.append(host, [
          U.el('div.field', {}, [U.el('label', { text: '名字' }), nameInput]),
          U.el('div.field', {}, [U.el('label', { text: '专属码（可留空）' }), codeInput]),
          U.el('div.field-note', { text: '对方的专属码在「我的」页面顶部，加进来以后协作署名就能直接勾选。' })
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        {
          label: '添加',
          primary: true,
          close: false,
          onClick: () => {
            const name = nameInput.value.trim();
            if (!name) { UI.toast('先写个名字', 'close'); return; }
            const code = codeInput.value.trim().toUpperCase();
            const c = global.Collab.state();
            if ((c.friends || []).some((f) => f.name === name)) { UI.toast('已经有这个名字了', 'close'); return; }
            c.friends.push({ id: U.uid('fr'), name: name, code: code, at: Date.now() });
            global.Collab.save();
            UI.closeSheet();
            UI.toast('已加入密友名单', 'check');
            UI.render();
          }
        }
      ]
    });
  }

  function removeFriend(name) {
    UI.confirm('移出密友', '「' + name + '」会从名单里移除（作品里的参与者记录不受影响）。', '移除', true).then((ok) => {
      if (!ok) return;
      const c = global.Collab.state();
      c.friends = (c.friends || []).filter((f) => f.name !== name);
      global.Collab.save();
      UI.toast('已移除', 'trash');
      UI.render();
    });
  }

  /* ================================================================== */
  /* 个人主页                                                           */
  /* ================================================================== */
  UI.route('me', function (view) {
    const p = me();
    UI.setTitle('我的', isRegistered() ? '个人主页' : '还没注册');

    /* ---- 顶部：头像 + 昵称 + 专属码 ---- */
    const head = U.el('div.card.profile-card');
    U.append(head, [
      U.el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, [
        avatarEl(p, 64),
        U.el('div', { style: { flex: '1 1 auto', minWidth: '0' } }, [
          U.el('div.profile-name', { dataset: { i18nSkip: '1' }, text: isRegistered() ? p.name : '还没有账号' }),
          U.el('div.profile-code', {}, [
            U.el('span', { text: '专属码 ' }),
            U.el('b', { dataset: { i18nSkip: '1' }, text: Store.userCode() })
          ]),
          p.bio ? U.el('div.profile-bio', { dataset: { i18nSkip: '1' }, text: p.bio }) : null
        ]),
        U.el('button.btn.sm', { onclick: () => registerSheet() }, [U.icon('edit', 'ico-sm'), U.el('span', { text: isRegistered() ? '编辑' : '注册' })])
      ])
    ]);
    U.append(head, U.el('div.grid2', { style: { marginTop: '12px' } }, [
      U.el('button.btn', {
        onclick: () => {
          const code = Store.userCode();
          global.IOApi.copyText(code);
          UI.toast('专属码已复制：' + code, 'copy');
        }
      }, [U.icon('copy', 'ico-sm'), U.el('span', { text: '复制专属码' })]),
      U.el('button.btn.ghost', {
        onclick: () => UI.confirm('换一个专属码', '换掉之后要把新码告诉朋友，旧的就不用了。', '换一个', false).then((ok) => {
          if (!ok) return;
          const code = Store.userCode();
          Store.newUserCode();
          UI.toast('新专属码：' + code, 'refresh');
          UI.render();
        })
      }, [U.icon('refresh', 'ico-sm'), U.el('span', { text: '重新生成' })])
    ]));
    if (!isRegistered()) {
      U.append(head, U.el('div.field-note', {
        style: { marginTop: '10px' },
        text: '注册只要一个昵称：它会用在协作署名、日记作者和多人创作里。专属码已经替你生成好了。'
      }));
    }
    U.append(view, head);

    /* ---- 状态卡（仿微信 / QQ）---- */
    const active = Store.activeStatus();
    const statusCard = U.el('div.card.status-card');
    U.append(statusCard, [
      U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        active ? U.el('span.status-emoji', { text: active.emoji || '💬' }) : U.icon('chat', 'ico-sm'),
        U.el('div', { style: { flex: '1 1 auto', minWidth: '0' } }, [
          U.el('div.status-text', { dataset: { i18nSkip: '1' }, text: active ? active.text : '还没有状态' }),
          U.el('div.status-sub', {
            text: active
              ? ('更新于 ' + U.fmtWhen(active.at) + (active.until ? ' · ' + U.fmtWhen(active.until) + ' 到期' : ' · 一直显示'))
              : '写一句现在在做什么，个人页和首页都会显示'
          })
        ]),
        U.el('button.btn.sm.primary', { onclick: () => statusSheet() }, [U.icon('edit', 'ico-sm'), U.el('span', { text: active ? '更新' : '设置' })])
      ])
    ]);
    U.append(view, statusCard);

    /* ---- 我的数据 ---- */
    const st = Store.state;
    const novels = (st.novels || []).length, articles = (st.articles || []).length;
    const diaries = (st.diaries || []).length, books = (st.reading || []).length;
    const words = Store.totalWords ? Store.totalWords() : 0;
    const achs = Object.keys(st.achievements || {}).length;
    U.append(view, U.el('div.section-title', {}, [U.icon('chart', 'ico-sm'), U.el('span', { text: '我的数据' })]));
    U.append(view, U.el('div.grid2', {}, [
      U.el('div.card.mini', {}, [U.el('div.mini-num', { text: String(novels + articles + diaries + books) }), U.el('div.mini-label', { text: '全部作品' })]),
      U.el('div.card.mini', {}, [U.el('div.mini-num', { text: U.fmtInt(words) }), U.el('div.mini-label', { text: '累计字数' })]),
      U.el('div.card.mini', {}, [U.el('div.mini-num', { text: String(achs) }), U.el('div.mini-label', { text: '已解锁成就' })]),
      U.el('div.card.mini', {}, [
        U.el('div.mini-num', { text: String((global.Ach && global.Ach.currentStreak) ? global.Ach.currentStreak(st) : 0) }),
        U.el('div.mini-label', { text: '连续创作天数' })
      ])
    ]));

    /* ---- 密友名单 ---- */
    const c = global.Collab.state();
    U.append(view, U.el('div.section-title', {}, [
      U.icon('users', 'ico-sm'), U.el('span', { text: '密友名单' }),
      U.el('span.spacer'), U.el('span', { text: (c.friends || []).length + ' 人', style: { fontWeight: '500' } })
    ]));
    const fl = U.el('div.list');
    if (!(c.friends || []).length) {
      U.append(view, U.el('div.card', {}, [
        U.el('div', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '还没有密友。记下常一起写的人，协作时就能直接勾选参与者。' }),
        U.el('button.btn.sm.primary', { style: { marginTop: '10px' }, onclick: () => friendSheet() }, [U.icon('plus', 'ico-sm'), U.el('span', { text: '添加密友' })])
      ]));
    } else {
      (c.friends || []).forEach((f) => {
        fl.appendChild(U.el('div.row', {}, [
          avatarEl(f, 34),
          U.el('div.row-main', {}, [
            U.el('div.row-title', { dataset: { i18nSkip: '1' }, text: f.name }),
            U.el('div.row-sub', { text: f.code ? ('专属码 ' + f.code) : '没有记录专属码' })
          ]),
          U.el('button.icon-btn', { onclick: () => removeFriend(f.name), 'aria-label': '移出' }, U.icon('close', 'ico-sm'))
        ]));
      });
      U.append(view, fl);
      U.append(view, U.el('button.btn.sm', { style: { marginTop: '8px' }, onclick: () => friendSheet() }, [U.icon('plus', 'ico-sm'), U.el('span', { text: '添加密友' })]));
    }

    /* ---- 协作中的作品 ---- */
    const works = (c.works || []);
    U.append(view, U.el('div.section-title', {}, [U.icon('share', 'ico-sm'), U.el('span', { text: '协作中的作品' }), U.el('span.spacer'), U.el('span', { text: works.length + ' 部', style: { fontWeight: '500' } })]));
    if (!works.length) {
      U.append(view, U.el('div.card', {}, [
        U.el('div', { style: { fontSize: '13px', color: 'var(--text-2)' }, text: '还没有一起写的作品。到「协作与分享」开一个房间，或导入朋友发来的分享包。' }),
        U.el('button.btn.sm', { style: { marginTop: '10px' }, onclick: () => UI.go('collab') }, [U.icon('users', 'ico-sm'), U.el('span', { text: '去协作中心' })])
      ]));
    } else {
      const wl = U.el('div.list');
      works.forEach((w) => {
        const item = w.kind === 'novel' ? Store.findNovel(w.id) : w.kind === 'article' ? Store.findArticle(w.id) : Store.findDiary(w.id);
        wl.appendChild(U.el('div.row.tap', {
          onclick: () => {
            if (!item) { UI.toast('作品已不在本机', 'close'); return; }
            UI.go(w.kind === 'diary' ? 'diary' : (w.kind === 'article' ? 'library/article' : 'library/novel') + '/' + (w.kind === 'diary' ? '' : w.id));
          }
        }, [
          U.el('span.row-chev', {}, U.icon('share', 'ico-sm')),
          U.el('div.row-main', {}, [
            U.el('div.row-title', { dataset: { i18nSkip: '1' }, text: (item && item.title) || w.title || '（已删除）' }),
            U.el('div.row-sub', { text: (w.role === 'host' ? '我是房主' : '我是参与者') + (w.at ? ' · ' + U.fmtWhen(w.at) : '') })
          ]),
          U.el('span.row-chev', {}, U.icon('chevron', 'ico-sm'))
        ]));
      });
      U.append(view, wl);
    }

    U.append(view, U.el('div.grid2', { style: { marginTop: '16px' } }, [
      U.el('button.btn', { onclick: () => UI.go('collab') }, [U.icon('users', 'ico-sm'), U.el('span', { text: '协作与分享' })]),
      U.el('button.btn', { onclick: () => UI.go('stats/settings') }, [U.icon('settings', 'ico-sm'), U.el('span', { text: '设置' })])
    ]));
  });

  /* ================================================================== */
  /* 首页状态卡（各模块首页共用）                                       */
  /* ================================================================== */
  function homeCard(opts) {
    const o = opts || {};
    const p = me();
    const active = Store.activeStatus();
    const card = U.el('div.card.home-me');
    if (!isRegistered()) {
      U.append(card, [
        U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
          avatarEl({ name: '我' }, 40),
          U.el('div', { style: { flex: '1 1 auto' } }, [
            U.el('div', { style: { fontSize: '14px', fontWeight: '650' }, text: '给自己注册一个名字' }),
            U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' }, text: '协作署名、日记作者、多人创作都用它' })
          ]),
          U.el('button.btn.sm.primary', { onclick: () => registerSheet() }, [U.el('span', { text: '注册' })])
        ])
      ]);
      return card;
    }
    U.append(card, [
      U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        U.el('div.tap', { onclick: () => UI.go('me'), style: { display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 auto', minWidth: '0' } }, [
          avatarEl(p, 40),
          U.el('div', { style: { minWidth: '0' } }, [
            U.el('div', { style: { fontSize: '14px', fontWeight: '650' }, dataset: { i18nSkip: '1' }, text: p.name }),
            U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, dataset: { i18nSkip: '1' }, text: active ? ((active.emoji ? active.emoji + ' ' : '') + active.text) : (p.bio || '点这里写一句状态') })
          ])
        ]),
        U.el('button.btn.sm', { onclick: () => statusSheet() }, [U.icon('edit', 'ico-sm'), U.el('span', { text: active ? '更新状态' : '写状态' })])
      ]),
      active ? U.el('div.field-note', { style: { marginTop: '8px' }, text: '更新于 ' + U.fmtWhen(active.at) }) : null
    ]);
    return card;
  }

  /* ================================================================== */
  /* 导出                                                               */
  /* ================================================================== */
  P.me = me;
  P.myName = myName;
  P.isRegistered = isRegistered;
  P.avatarEl = avatarEl;
  P.chip = chip;
  P.joinNames = joinNames;
  P.participantsLine = participantsLine;
  P.multiBadge = multiBadge;
  P.picker = picker;
  P.multiBlock = multiBlock;
  P.allPeople = allPeople;
  P.autoParticipants = autoParticipants;
  P.registerSheet = registerSheet;
  P.statusSheet = statusSheet;
  P.friendSheet = friendSheet;
  P.homeCard = homeCard;
  P.avatarSheet = avatarSheet;

  global.Profile = P;
})(window);
