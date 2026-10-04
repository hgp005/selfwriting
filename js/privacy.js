/* ==========================================================================
   selfwriting · privacy.js
   隐私锁：给任意作品单独设密码，保护私密内容
   --------------------------------------------------------------------------
   诚实地说明安全边界（这一点很重要，不要给用户虚假的安全感）：
     · 这是「应用内访问锁」—— 打开被锁作品需要输入密码，界面列表、搜索结果、
       导出都会挡住，别人拿到你解锁状态下的手机翻不到内容。
     · 但它**不是加密**：浏览器里的 JS 无法可靠地加密本地数据，因为密钥同样
       存在这台设备上。如果对方懂技术、能把设备连上电脑调试，数据仍可能被读走。
     · 密码本身只存「加盐哈希」，不存明文；忘记密码只能通过清空数据重置。
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const Store = global.Store;
  const UI = global.UI;

  const P = {};
  const SALT = 'selfwriting.lock.v1';

  /* ================================================================== */
  /* 哈希（简单但足够：这不是加密，只是不存明文密码）                      */
  /* ================================================================== */
  function hashPin(pin) {
    const s = SALT + '|' + String(pin || '');
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = (h1 ^ c) >>> 0;
      h1 = (h1 * 16777619) >>> 0;
      h2 = ((h2 + c) * 2654435761) >>> 0;
    }
    return h1.toString(16) + h2.toString(16);
  }

  /* ================================================================== */
  /* 数据                                                              */
  /* ================================================================== */
  function st() { return Store.state; }

  /** 全局密码单：{ hash, at }；未设置时为 null */
  P.pinOf = function () {
    const p = st().settings.privacy;
    return (p && p.pinHash) ? p : null;
  };
  P.hasPin = function () { return !!P.pinOf(); };

  P.setPin = function (pin) {
    const h = hashPin(pin);
    const s = st().settings;
    s.privacy = Object.assign({}, s.privacy || {}, { pinHash: h, at: Date.now() });
    Store.markDirty();
    Store.flushNow();
    return true;
  };

  P.checkPin = function (pin) {
    const p = P.pinOf();
    if (!p) return true;
    return p.pinHash === hashPin(pin);
  };

  /** 关闭隐私锁（需要先验证） */
  P.clearPin = function () {
    const s = st().settings;
    if (s.privacy) { delete s.privacy.pinHash; }
    unlockedAll();
    Store.markDirty();
    Store.flushNow();
  };

  /* ---- 哪些作品被锁 ---- */
  function keyOf(kind, id) { return kind + ':' + id; }

  function lockedList() {
    const p = st().settings.privacy;
    return (p && Array.isArray(p.locked)) ? p.locked : [];
  }
  P.isLocked = function (kind, id) {
    if (!P.hasPin()) return false;                 // 没有全局密码时，任何锁都不生效
    return lockedList().indexOf(keyOf(kind, id)) >= 0;
  };
  P.lock = function (kind, id) {
    if (!P.hasPin()) return false;
    const s = st().settings;
    s.privacy = s.privacy || {};
    if (!Array.isArray(s.privacy.locked)) s.privacy.locked = [];
    const k = keyOf(kind, id);
    if (s.privacy.locked.indexOf(k) < 0) s.privacy.locked.push(k);
    /* 上锁即视为未解锁 */
    if (unlocked.has(k)) unlocked.delete(k);
    Store.markDirty(); Store.flushNow();
    return true;
  };
  P.unlockItem = function (kind, id) {
    const s = st().settings;
    if (!s.privacy || !Array.isArray(s.privacy.locked)) return;
    s.privacy.locked = s.privacy.locked.filter((x) => x !== keyOf(kind, id));
    unlocked.delete(keyOf(kind, id));
    Store.markDirty(); Store.flushNow();
  };

  /* ---- 会话内的解锁状态（不写入存储：重启应用后需要重新输入） ---- */
  const unlocked = new Set();
  function unlockedAll() { unlocked.clear(); }

  P.isUnlocked = function (kind, id) { return unlocked.has(keyOf(kind, id)); };
  P.markUnlocked = function (kind, id) { unlocked.add(keyOf(kind, id)); };

  /** 需要访问时调用：已解锁返回 true，否则弹密码框 */
  P.ensure = function (kind, id, opt) {
    if (!P.isLocked(kind, id)) return Promise.resolve(true);
    if (P.isUnlocked(kind, id)) return Promise.resolve(true);
    return P.ask('这是一部私密作品', (opt && opt.title) || '输入密码后查看').then((ok) => {
      if (ok) P.markUnlocked(kind, id);
      return ok;
    });
  };

  /* ================================================================== */
  /* 密码输入框                                                        */
  /* ================================================================== */
  /** 弹一个密码框，返回 Promise<boolean> */
  P.ask = function (title, message) {
    return new Promise((resolve) => {
      let settled = false;
      const input = U.el('input.input', {
        type: 'password', inputmode: 'numeric', placeholder: '输入密码',
        autocomplete: 'off', style: { letterSpacing: '.3em', textAlign: 'center', fontSize: '20px' }
      });
      const tip = U.el('div.field-note', { text: message || '' });
      let tries = 0;

      const submit = () => {
        const v = input.value;
        if (!v) { tip.textContent = '请输入密码'; tip.style.color = 'var(--danger)'; return; }
        if (P.checkPin(v)) {
          settled = true;
          UI.closeSheet();
          resolve(true);
          return;
        }
        tries++;
        tip.style.color = 'var(--danger)';
        tip.textContent = '密码不对' + (tries >= 3 ? '（忘记密码只能清空数据重置）' : '，请重试');
        input.value = '';
        try { input.focus(); } catch (e) { /* noop */ }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

      UI.sheet({
        title: title || '需要密码',
        onClose: () => { if (!settled) resolve(false); },
        body: (host) => {
          U.append(host, [
            U.el('div', { style: { display: 'flex', justifyContent: 'center', padding: '8px 0 4px' } }, [
              U.el('div.privacy-lock-ico', {}, U.icon('lock'))
            ]),
            U.el('div.field', {}, [input]),
            tip
          ]);
        },
        footer: [
          { label: '取消', ghost: true },
          { label: '解锁', primary: true, close: false, onClick: submit }
        ]
      });
      setTimeout(() => { try { input.focus(); } catch (e) { /* noop */ } }, 260);
    });
  };

  /** 设置/修改密码（两次输入确认） */
  P.setupPin = function () {
    return new Promise((resolve) => {
      const a = U.el('input.input', { type: 'password', inputmode: 'numeric', placeholder: '设置密码（数字或字母都行）' });
      const b = U.el('input.input', { type: 'password', inputmode: 'numeric', placeholder: '再输一次' });
      const tip = U.el('div.field-note', { text: '密码只保存在本机，并且不存明文。忘记后无法找回，只能清空数据。' });
      let settled = false;
      const submit = () => {
        const v1 = a.value.trim(), v2 = b.value.trim();
        if (v1.length < 4) { tip.style.color = 'var(--danger)'; tip.textContent = '至少 4 位'; return; }
        if (v1 !== v2) { tip.style.color = 'var(--danger)'; tip.textContent = '两次输入不一致'; return; }
        P.setPin(v1);
        settled = true;
        UI.closeSheet();
        resolve(true);
      };
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      UI.sheet({
        title: '开启隐私锁',
        onClose: () => { if (!settled) resolve(false); },
        body: (host) => U.append(host, [
          U.el('div.field', {}, [U.el('label', { text: '设置密码' }), a]),
          U.el('div.field', {}, [U.el('label', { text: '确认密码' }), b]),
          tip
        ]),
        footer: [
          { label: '取消', ghost: true },
          { label: '开启', primary: true, close: false, onClick: submit }
        ]
      });
      setTimeout(() => { try { a.focus(); } catch (e) { /* noop */ } }, 260);
    });
  };

  /* ================================================================== */
  /* 通用：给任意作品的「更多」菜单提供两个条目                           */
  /* ================================================================== */
  /**
   * items: 传入现有菜单数组，本函数按需追加「设为私密 / 取消私密」
   * kind: novel | article | diaryBook | book
   */
  P.menuItems = function (kind, id, title, after) {
    const items = [];
    const done = (msg) => { UI.toast(msg, 'check'); if (after) after(); };
    if (!P.hasPin()) {
      items.push({
        label: '设为私密（需先设密码）', icon: 'lock',
        fn: () => {
          P.setupPin().then((ok) => {
            if (!ok) return;
            P.lock(kind, id);
            done('已设为私密');
          });
        }
      });
      return items;
    }
    if (P.isLocked(kind, id)) {
      items.push({
        label: '取消私密', icon: 'unlock',
        fn: () => {
          P.ask('确认身份', '取消私密前需要输入密码').then((ok) => {
            if (!ok) return;
            P.unlockItem(kind, id);
            done('已取消私密');
          });
        }
      });
    } else {
      items.push({
        label: '设为私密', icon: 'lock',
        fn: () => { P.lock(kind, id); done('已设为私密'); }
      });
    }
    return items;
  };

  /** 内容被锁时的占位界面 */
  P.lockedView = function (host, kind, id, title, onUnlock) {
    U.clear(host);
    U.append(host, U.el('div.empty', {}, [
      U.icon('lock'),
      U.el('div.empty-title', { text: '这是一部私密作品' }),
      U.el('p', { text: (title ? '《' + title + '》' : '') + '需要输入密码才能查看。' }),
      U.el('button.btn.primary', {
        onclick: () => {
          P.ask('输入密码', '解锁后本次使用期间不再重复询问').then((ok) => {
            if (!ok) return;
            P.markUnlocked(kind, id);
            if (onUnlock) onUnlock();
          });
        }
      }, [U.icon('unlock', 'ico-sm'), U.el('span', { text: '解锁查看' })])
    ]));
  };

  /* ================================================================== */
  /* 隐私中心                                                          */
  /* ================================================================== */
  const KIND_LABEL = { novel: '小说', article: '文章', diaryBook: '记录本', book: '读物' };

  /** 把 'novel:xxx' 解析成可读条目信息 */
  function resolveLocked(key) {
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    const id = key.slice(i + 1);
    let title = '（已删除）';
    try {
      if (kind === 'novel') { const x = Store.findNovel(id); if (x) title = x.title; }
      else if (kind === 'article') { const x = Store.findArticle(id); if (x) title = x.title; }
      else if (kind === 'diaryBook') { const x = Store.findDiary(id); if (x) title = x.title; }
      else if (kind === 'book') { const x = Store.findBook(id); if (x) title = x.title; }
    } catch (e) { /* 忽略 */ }
    return { kind: kind, id: id, title: title, label: KIND_LABEL[kind] || '作品' };
  }

  UI.route('privacy', function (view) {
    const on = P.hasPin();
    const locked = lockedList().map(resolveLocked);
    UI.setTitle('隐私锁', on ? (locked.length ? locked.length + ' 部私密作品' : '已开启') : '保护你的私密作品');

    /* 说明卡 */
    U.append(view, U.el('div.card', {}, [
      U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        U.el('div.privacy-lock-ico', {}, U.icon(on ? 'lock' : 'unlock')),
        U.el('div', { style: { flex: '1 1 auto' } }, [
          U.el('div', { style: { fontWeight: '650', fontSize: '15px' }, text: on ? '隐私锁已开启' : '隐私锁未开启' }),
          U.el('div', {
            style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px' },
            text: on ? '被设为私密的作品需要密码才能打开' : '开启后可以给任意作品单独上锁'
          })
        ])
      ]),
      U.el('div', { style: { marginTop: '12px' } }, [
        !on
          ? U.el('button.btn.primary.block', { onclick: () => P.setupPin().then((ok) => { if (ok) { UI.toast('隐私锁已开启', 'check'); UI.render(); } }) },
            [U.icon('lock', 'ico-sm'), U.el('span', { text: '开启隐私锁' })])
          : U.el('div.grid2', {}, [
            U.el('button.btn', { onclick: () => P.setupPin().then((ok) => { if (ok) UI.toast('密码已修改', 'check'); }) },
              [U.icon('edit', 'ico-sm'), U.el('span', { text: '修改密码' })]),
            U.el('button.btn.danger', {
              onclick: () => {
                P.ask('确认身份', '关闭隐私锁需要输入当前密码').then((ok) => {
                  if (!ok) return;
                  UI.confirm('关闭隐私锁', '关闭后所有私密作品都会恢复为普通作品，谁都能打开。', '确认关闭', true).then((yes) => {
                    if (!yes) return;
                    P.clearPin();
                    UI.toast('隐私锁已关闭', 'unlock');
                    UI.render();
                  });
                });
              }
            }, [U.icon('unlock', 'ico-sm'), U.el('span', { text: '关闭隐私锁' })])
          ])
      ]),
      U.el('div.field-note', {
        style: { marginTop: '12px' },
        text: '安全边界（请知悉）：这是「应用内访问锁」—— 界面、列表、导出都会挡住，但**不是加密**。密码只存加盐哈希，不存明文；如果你把解锁状态下的设备交给懂技术的人，数据仍可能被读走。忘记密码无法找回，只能清空数据。'
      })
    ]));

    /* 私密作品清单 */
    U.append(view, U.el('div.section-title', {}, [U.icon('lock', 'ico-sm'), U.el('span', { text: '私密作品' }), U.el('span.spacer'), U.el('span', { text: String(locked.length), style: { fontWeight: '500' } })]));
    if (!on) {
      U.append(view, U.el('div.note-empty', { text: '开启隐私锁后，在任意作品的「更多」菜单里选择「设为私密」即可。' }));
    } else if (!locked.length) {
      U.append(view, U.el('div.note-empty', { text: '还没有私密作品。在小说 / 文章 / 日记本 / 读物的「更多」菜单里点「设为私密」。' }));
    } else {
      const list = U.el('div.list');
      locked.forEach((it) => {
        list.appendChild(U.el('div.row', {}, [
          U.el('div.row-ico', {}, U.icon('lock')),
          U.el('div.row-main', {}, [
            U.el('div.row-title', { text: it.title }),
            U.el('div.row-sub', { text: it.label + (P.isUnlocked(it.kind, it.id) ? ' · 本次已解锁' : ' · 需要密码') })
          ]),
          U.el('button.btn.sm', {
            onclick: () => {
              P.ask('确认身份', '取消私密前需要输入密码').then((ok) => {
                if (!ok) return;
                P.unlockItem(it.kind, it.id);
                UI.toast('已取消私密', 'unlock');
                UI.render();
              });
            }
          }, [U.el('span', { text: '取消私密' })])
        ]));
      });
      U.append(view, list);
    }

    U.append(view, U.el('div', {
      style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '16px', lineHeight: '1.8' },
      text: '解锁状态只在本次使用期间有效：重新打开应用后需要再输一次密码。'
    }));
  });

  global.Privacy = P;
})(window);
