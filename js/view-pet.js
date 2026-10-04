/* ==========================================================================
   ⚠ 桌宠视图（已停用：同上）
   selfwriting · view-pet.js
   桌宠的「长相」与「表情」：内联 SVG 画的布偶猫 + 气泡 + 动作菜单 + 粒子。

   分工：js/pet.js 管状态与规则，本文件只管画和点。
   · 猫只用内联 SVG（不联网、不打包图片），一个 <svg> 里放好多个分组，
     呼吸 / 眨眼 / 耳朵抖 / 尾巴摇 / 姿势全部靠 class 切 CSS 动画。
   · 层次：position:fixed，z-index 90 —— 高于正文与底栏（≤60），
     低于抽屉 / 对话框（100）与亮度遮罩，所以永远不会挡住弹层。
   · 不抢触摸：只有 76×76 的猫身接收指针事件，气泡与菜单之外的区域一律穿透。
   · 省电：只有一个 2.6 秒的空闲小动作定时器；页面隐藏时连同 CSS 动画一起停。
   ========================================================================== */
(function (global) {
  'use strict';

  const doc = global.document;
  const NS = 'http://www.w3.org/2000/svg';
  const MENU_W = 214;
  const SIZE = 76;

  let host = null;                // 猫的根节点
  let svg = null;                 // 猫的 <svg>
  let bubbleEl = null, bubbleText = null;
  let menuEl = null, statsEl = null, focusRow = null;
  let bubTimer = null, animTimer = null;
  let drag = null;
  let longPressed = false;
  let lastDragAt = 0, lastDragMoved = false;
  let patched = false, paused = false, hidden = false;

  const ACTIONS = [
    { id: 'pet', icon: '💗', label: '摸摸' },
    { id: 'feed', icon: '🐟', label: '喂食' },
    { id: 'play', icon: '🧶', label: '玩耍' },
    { id: 'sleep', icon: '😴', label: '睡觉' },
    { id: 'talk', icon: '💬', label: '说话' },
    { id: 'pose', icon: '🐾', label: '换姿势' },
    { id: 'hide', icon: '🙈', label: '隐藏' }
  ];

  const FOCUS_MIN = [25, 45, 60];

  /* ---------------- 小工具 ---------------- */

  function E(tag, attrs, kids) {
    const n = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') n.textContent = v;
        else if (k === 'cls') n.setAttribute('class', v);
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
      });
    }
    if (kids) {
      (Array.isArray(kids) ? kids : [kids]).forEach((c) => { if (c) n.appendChild(c); });
    }
    return n;
  }

  function S(tag, attrs, kids) {
    const n = doc.createElementNS(NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') n.textContent = v;
        else if (k === 'cls') n.setAttribute('class', v);
        else n.setAttribute(k, v);
      });
    }
    if (kids) {
      (Array.isArray(kids) ? kids : [kids]).forEach((c) => { if (c) n.appendChild(c); });
    }
    return n;
  }

  function addCls(n, c) { if (n && n.classList) n.classList.add(c); }
  function rmCls(n, c) { if (n && n.classList) n.classList.remove(c); }

  function flash(node, cls) {
    if (!node || !node.classList) return;
    node.classList.remove(cls);
    void node.offsetWidth;          // 强制重排，让同名动画能重新播一次
    node.classList.add(cls);
  }

  /** 一次性动画：播完自己摘掉 class，避免动画被「卡住」 */
  function once(node, cls, ms) {
    if (!node) return;
    flash(node, cls);
    global.setTimeout(function () { rmCls(node, cls); }, ms || 900);
  }

  function mmss(left) {
    const total = Math.max(0, Math.round(left / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------------- 画猫 ---------------- */

  /**
   * 布偶猫：白身子、灰褐色的面罩 / 耳朵 / 尾巴、蓝眼睛。
   * 分组 class 与 CSS 一一对应：pt-body(呼吸) / pt-head(点头) / pt-ear / pt-eye /
   * pt-tail(摇摆)。
   * 注意：两只耳朵分开写，不用 scale(-1,1) 镜像 —— 镜像会把路径描边也翻掉，
   * 缩放后线条会变毛躁，单独一条路径反而更干净。
   */
  function catSvg() {
    const ear = (id, d, inner) => S('g', { cls: 'pt-ear', id: id }, [
      S('path', { d: d, fill: '#a8968d' }),
      S('path', { d: inner, fill: '#e8bfb8' })
    ]);
    const eye = (id, cx) => S('g', { cls: 'pt-eye', id: id }, [
      S('ellipse', { cx: cx, cy: 28, rx: 3.6, ry: 3.9, fill: '#4d92c9' }),
      S('ellipse', { cx: cx, cy: 28.3, rx: 1.5, ry: 2.6, fill: '#17303f' }),
      S('circle', { cx: cx - 1.1, cy: 26.6, r: 0.9, fill: '#ffffff' })
    ]);
    const leg = (id, x) => S('g', { cls: 'pt-paw', id: id }, [
      S('rect', { x: x, y: 84, width: 7, height: 15, rx: 3.5, fill: '#fbfaf8' }),
      S('path', { d: 'M' + (x + 2.2) + ' 96.5 h2.6', stroke: '#d6c7bd', 'stroke-width': 0.7, 'stroke-linecap': 'round', fill: 'none' })
    ]);

    return S('svg', {
      viewBox: '0 0 120 120', width: '120', height: '120',
      cls: 'pt-svg', focusable: 'false', 'aria-hidden': 'true'
    }, [
      S('title', { text: '布偶猫桌宠' }),
      S('defs', {}, [
        S('linearGradient', { id: 'ptFur', x1: '0', y1: '0', x2: '0', y2: '1' }, [
          S('stop', { offset: '0', 'stop-color': '#ffffff' }),
          S('stop', { offset: '0.62', 'stop-color': '#fbf7f2' }),
          S('stop', { offset: '1', 'stop-color': '#ece3d9' })
        ]),
        S('linearGradient', { id: 'ptTail', x1: '0', y1: '1', x2: '1', y2: '0' }, [
          S('stop', { offset: '0', 'stop-color': '#8b7a72' }),
          S('stop', { offset: '1', 'stop-color': '#c2b1a7' })
        ]),
        S('clipPath', { id: 'ptHeadClip' }, [S('ellipse', { cx: 60, cy: 38, rx: 29, ry: 26 })])
      ]),
      S('g', { cls: 'pt-ground', id: 'pt-ground' }, [
        S('ellipse', { cx: 60, cy: 101, rx: 27, ry: 3.6, fill: 'rgba(0,0,0,0.12)' })
      ]),
      /* 尾巴在最底层：从身子右后方甩出去，落在头部轮廓（x≤89）以外才看得见 */
      S('g', { cls: 'pt-tail', id: 'pt-tail' }, [
        S('path', {
          d: 'M80 93 C 100 93 110 86 110 75',
          stroke: 'url(#ptTail)', 'stroke-width': 10, 'stroke-linecap': 'round', fill: 'none'
        })
      ]),
      S('g', { cls: 'pt-body', id: 'pt-body' }, [
        S('path', { d: 'M34 101 C 32 76 40 60 60 60 C 80 60 88 76 86 101 Q 60 107 34 101 Z', fill: 'url(#ptFur)', stroke: '#e4d9cd', 'stroke-width': 0.9 })
      ]),
      S('ellipse', { cx: 60, cy: 90, rx: 12, ry: 12.5, fill: 'rgba(255,255,255,0.92)' }),
      leg('pt-leg-l', 39),
      leg('pt-leg-r', 74),
      S('g', { cls: 'pt-head', id: 'pt-head' }, [
        S('g', { cls: 'pt-ears' }, [
          ear('pt-ear-l', 'M38 30 L30 15 L51 21 Z', 'M40 27 L36 19 L46 22 Z'),
          ear('pt-ear-r', 'M82 30 L90 15 L69 21 Z', 'M80 27 L84 19 L74 22 Z')
        ]),
        S('ellipse', { cx: 60, cy: 38, rx: 29, ry: 26, fill: 'url(#ptFur)', stroke: '#e7ddd2', 'stroke-width': 0.9 }),
        S('g', { 'clip-path': 'url(#ptHeadClip)' }, [
          S('path', { d: 'M60 15 C 72 15 82 22 84 32 C 70 38.5 50 38.5 36 32 C 38 22 48 15 60 15 Z', fill: '#c9b5a9', opacity: '0.82' }),
          S('ellipse', { cx: 60, cy: 56, rx: 15, ry: 11, fill: 'rgba(255,255,255,0.84)' }),
          S('ellipse', { cx: 60, cy: 62, rx: 7.5, ry: 6, fill: '#cfbbb0' }),
          S('path', { d: 'M46 34 C 49 45 52 52 54 56', stroke: '#faf6f1', 'stroke-width': 4.4, 'stroke-linecap': 'round', fill: 'none', opacity: '0.8' }),
          S('path', { d: 'M74 34 C 71 45 68 52 66 56', stroke: '#faf6f1', 'stroke-width': 4.4, 'stroke-linecap': 'round', fill: 'none', opacity: '0.8' })
        ]),
        eye('pt-eye-l', 49.5),
        eye('pt-eye-r', 70.5),
        S('path', { d: 'M56.4 53.4 L63.6 53.4 L60 57 Z', fill: '#b9767a' }),
        S('path', { d: 'M60 57 v2.6 M60 59.6 L56 62 M60 59.6 L64 62', stroke: '#7d5f57', 'stroke-width': 1.2, 'stroke-linecap': 'round', fill: 'none' }),
        S('path', { d: 'M33 40 L19 36.5 M33.5 46 L20 47.5 M87 40 L101 36.5 M86.5 46 L100 47.5', stroke: '#d9c9bd', 'stroke-width': 1.1, 'stroke-linecap': 'round', fill: 'none', opacity: '0.95' })
      ])
    ]);
  }

  /* ---------------- 根节点 ---------------- */

  function build() {
    const root = E('div', { id: 'petRoot', cls: 'pet-root', 'data-pet': 'root' });
    root.setAttribute('aria-hidden', 'true');

    bubbleEl = E('div', { cls: 'pet-bubble', 'data-pet': 'bubble' }, [
      E('span', { cls: 'pet-bubble-text', text: '' })
    ]);
    bubbleText = bubbleEl.firstChild;

    const body = E('div', { cls: 'pet-body', 'data-pet': 'body' });
    svg = catSvg();
    body.appendChild(svg);

    const home = E('button', {
      cls: 'pet-home', type: 'button', 'data-pet': 'home',
      'aria-label': '回家', title: '回家'
    }, [
      E('svg', { viewBox: '0 0 24 24', width: '14', height: '14', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
        E('path', { d: 'M4 11l8-7 8 7M6 10v9h12v-9' })
      ])
    ]);
    home.addEventListener('click', function (e) {
      e.stopPropagation();
      try { global.Pet.goHome(); } catch (err) { /* noop */ }
    });

    root.appendChild(bubbleEl);
    root.appendChild(body);
    root.appendChild(home);

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('click', onClick);
    return root;
  }

  /* ---------------- 菜单 ---------------- */

  function buildMenu() {
    const m = E('div', { id: 'petMenu', cls: 'pet-menu', 'data-pet': 'menu', role: 'dialog', 'aria-label': '桌宠动作' });

    m.appendChild(E('div', { cls: 'pet-menu-head' }, [
      E('span', { cls: 'pet-menu-title', text: '布偶猫' }),
      E('span', { cls: 'pet-menu-lv', 'data-pet': 'menu-level', text: '' }),
      E('button', { cls: 'pet-menu-x', type: 'button', 'data-pet': 'menu-close', 'aria-label': '收起', text: '×', onclick: function (e) { e.stopPropagation(); closeMenu(); } })
    ]));

    statsEl = E('div', { cls: 'pet-stats', 'data-pet': 'stats' });
    m.appendChild(statsEl);

    const grid = E('div', { cls: 'pet-actions' });
    ACTIONS.forEach(function (a) {
      const b = E('button', { cls: 'pet-act', type: 'button', 'data-pet-act': a.id, title: a.label }, [
        E('span', { cls: 'pa-ico', text: a.icon }),
        E('span', { cls: 'pa-label', text: a.label })
      ]);
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        try { Pet.action(a.id); } catch (err) { /* noop */ }
        if (a.id !== 'hide' && a.id !== 'pose' && a.id !== 'talk' && a.id !== 'sleep') closeMenu();
        if (a.id === 'hide') closeMenu();
      });
      grid.appendChild(b);
    });
    m.appendChild(grid);

    focusRow = E('div', { cls: 'pet-focus', 'data-pet': 'focus' });
    m.appendChild(focusRow);
    syncFocusRow();

    m.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    return m;
  }

  function statBar(key) {
    const st = Pet.stats();
    const v = Math.max(0, Math.min(100, Math.round(st[key] || 0)));
    const row = E('div', { cls: 'pet-bar', 'data-pet-bar': key });
    row.appendChild(E('span', { cls: 'pb-name', text: Pet.statLabels[key] }));
    const track = E('span', { cls: 'pb-track' });
    const fill = E('i', { cls: 'pb-fill' });
    fill.style.width = v + '%';
    fill.setAttribute('data-v', String(v));
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(E('span', { cls: 'pb-num', text: String(v) }));
    return row;
  }

  function syncStats() {
    if (!statsEl) return;
    const st = Pet.stats();
    const bars = statsEl.querySelectorAll('.pet-bar');
    for (let i = 0; i < bars.length; i++) {
      const key = bars[i].getAttribute('data-pet-bar');
      const v = Math.max(0, Math.min(100, Math.round(st[key] || 0)));
      const fill = bars[i].querySelector('.pb-fill');
      const num = bars[i].querySelector('.pb-num');
      if (fill) { fill.style.width = v + '%'; fill.setAttribute('data-v', String(v)); }
      if (num) num.textContent = String(v);
    }
  }

  function syncLevel() {
    if (!menuEl) return;
    const d = Pet.decorate();
    const lv = menuEl.querySelector('[data-pet="menu-level"]');
    if (lv) lv.textContent = 'Lv.' + d.level + ' ' + d.levelTitle + ' · 一起 ' + d.days + ' 天';
  }

  function syncFocusRow() {
    if (!focusRow) return;
    while (focusRow.firstChild) focusRow.removeChild(focusRow.firstChild);
    const left = Pet.focusLeft();
    if (left > 0) {
      focusRow.appendChild(E('div', { cls: 'pet-focus-live', 'data-pet': 'focus-live', text: '⏱ 专注中 ' + mmss(left) }));
      focusRow.appendChild(E('div', { cls: 'pet-chips' }, [
        E('button', { cls: 'pet-chip', type: 'button', 'data-pet-focus': 'stop', text: '结束专注', onclick: function (e) { e.stopPropagation(); Pet.stopFocus(); syncFocusRow(); } })
      ]));
      return;
    }
    focusRow.appendChild(E('div', { cls: 'pet-focus-title', text: '番茄钟 · 我陪着你' }));
    const chips = E('div', { cls: 'pet-chips' });
    FOCUS_MIN.forEach(function (m) {
      chips.appendChild(E('button', {
        cls: 'pet-chip', type: 'button', 'data-pet-focus': String(m), text: m + ' 分钟',
        onclick: function (e) { e.stopPropagation(); Pet.startFocus(m); syncFocusRow(); }
      }));
    });
    focusRow.appendChild(chips);
  }

  function focusChanged() { syncFocusRow(); }

  function focusTick(left) {
    const live = menuEl && menuEl.querySelector('[data-pet="focus-live"]');
    if (live) live.textContent = '⏱ 专注中 ' + mmss(left);
  }

  function open() {
    if (!host || Pet.isEnabled() === false) return false;
    /* 抽屉 / 对话框开着的时候猫已经让位了，动作菜单也不该冒出来 */
    if (host.classList.contains('hidden')) return false;
    if (global.UI && global.UI.isSheetOpen && global.UI.isSheetOpen()) return false;
    const mh = doc.getElementById('modalHost');
    if (mh && !mh.classList.contains('hidden')) return false;
    if (!menuEl) {
      menuEl = buildMenu();
      doc.body.appendChild(menuEl);
    }
    while (statsEl.firstChild) statsEl.removeChild(statsEl.firstChild);
    Pet.statKeys.forEach(function (k) { statsEl.appendChild(statBar(k)); });
    syncLevel();
    syncFocusRow();
    menuEl.classList.add('show');
    place();
    addCls(host, 'menu-open');
    return true;
  }

  function closeMenu() {
    if (menuEl) menuEl.classList.remove('show');
    if (host) rmCls(host, 'menu-open');
    return true;
  }

  function isMenuOpen() { return !!(menuEl && menuEl.classList.contains('show')); }

  /* ---------------- 气泡 ---------------- */

  function bubble(text, ms) {
    if (!bubbleEl || !text) return false;
    const keepMenu = isMenuOpen();
    bubbleText.textContent = String(text);
    bubbleEl.classList.add('show');
    if (bubTimer) global.clearTimeout(bubTimer);
    bubTimer = global.setTimeout(function () {
      bubTimer = null;
      bubbleEl.classList.remove('show');
      if (keepMenu && isMenuOpen()) { /* 菜单自己会收 */ }
    }, Math.max(1200, ms || 4200));
    place();
    return true;
  }

  /* ---------------- 粒子 ---------------- */

  function particle(kind) {
    if (!host) return;
    const map = { heart: '💗', fish: '🐟', yarn: '🧶', paw: '🐾', zzz: '💤', star: '✨', butterfly: '🦋' };
    const alt = { purr: 'purr', happy: 'star', jump: 'star', poke: 'star' };
    const icon = map[kind] || map[alt[kind]] || '✨';
    const n = kind === 'zzz' ? 2 : (kind === 'feed' ? 3 : 4);
    for (let i = 0; i < n; i++) {
      (function (i) {
        global.setTimeout(function () {
          if (!host) return;
          const p = E('span', { cls: 'pet-particle', text: icon });
          p.style.left = (16 + i * 13 + Math.round(Math.random() * 8)) + '%';
          p.style.animationDelay = '0ms';
          host.appendChild(p);
          global.setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 1500);
        }, i * 110);
      })(i);
    }
  }

  /* ---------------- 姿势与反应 ---------------- */

  function applyPose() {
    if (!host) return;
    const pose = Pet.get().pose || 'sit';
    host.setAttribute('data-pose', pose);
    if (svg && svg.classList) { /* 姿势全部走 CSS，不需要逐个改节点 */ }
  }

  function react(kind, say) {
    if (!host) return false;
    const k = kind || 'purr';
    const dur = { ghost: 700, blink: 400, ear: 620, type: 620, sneeze: 900, chase: 2200, butterfly: 2000 };
    once(host, 'react-' + k, (dur[k] || 1000));
    if (k === 'feed') particle('fish');
    else if (k === 'play') particle('yarn');
    else if (k === 'pet' || k === 'happy') particle('heart');
    else if (k === 'sleep') particle('zzz');
    else if (k === 'celebrate') { particle('star'); global.setTimeout(function () { particle('heart'); }, 260); }
    else if (k === 'chase') particle('star');
    else if (k === 'butterfly') particle('butterfly');
    if (say) bubble(say, k === 'sleep' ? 5200 : 3600);
    return true;
  }

  function typeReact() { once(host, 'react-type', 620); }

  /* ---------------- 位置 ---------------- */

  function place() {
    if (!host) return;
    const L = Pet.layout();
    host.style.left = L.left + 'px';
    host.style.top = L.top + 'px';
    host.style.setProperty('--pet-size', L.size + 'px');
    if (menuEl) {
      const mw = menuEl.offsetWidth || MENU_W;
      const mh = menuEl.offsetHeight || 232;
      let left = L.left + L.size / 2 - mw / 2;
      left = Math.max(8, Math.min(left, L.vw - mw - 8));
      let top = L.top - mh - 12;
      let belowUp = false;
      if (top < 8) { top = L.top + L.size + 12; belowUp = true; }
      menuEl.style.left = Math.round(left) + 'px';
      menuEl.style.top = Math.round(top) + 'px';
      menuEl.setAttribute('data-side', belowUp ? 'below' : 'above');
    }
    /* 气泡跟着猫走，并避免贴着屏幕边被切掉 */
    if (bubbleEl) {
      const bw = bubbleEl.offsetWidth || 140;
      bubbleEl.style.setProperty('--bub-dx', Math.round(Math.max(6, bw / 2 - L.size / 2)) + 'px');
    }
    /* 只有离了家才显示「回家」小按钮 */
    if (host) {
      const st = Pet.get();
      const far = st.at && (Math.abs(st.x - 0.86) > 0.06 || Math.abs(st.y - 0.74) > 0.06);
      host.classList.toggle('show-home', !!far);
    }
    return L;
  }

  /* ---------------- 拖拽 / 点击 ---------------- */

  function onDown(e) {
    if (!host) return;
    if (e.button !== undefined && e.button > 0) return;
    if (e.target && e.target.closest && e.target.closest('.pet-menu')) return;
    const L = Pet.layout();
    drag = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: 0,
      left: L.left, top: L.top, vw: L.vw, vh: L.vh, moved_: false, long: false
    };
    longPressed = false;
    /* 长按（不拖动）＝ 打开动作菜单，和「点一下」区分开 */
    drag.timer = global.setTimeout(function () {
      if (!drag || drag.moved_ > 6) return;
      drag.long = true;
      longPressed = true;
      try { global.Pet.open(); } catch (err) { /* noop */ }
    }, 480);
    try { e.preventDefault(); } catch (err) { /* noop */ }
    try { host.classList.add('dragging'); } catch (err) { /* noop */ }
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onMove(e) {
    if (!drag) return;
    if (drag.id !== undefined && e.pointerId !== undefined && e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
    if (drag.moved > 6) drag.moved_ = true;
    /* 拖拽中：夹在视口内，只改 transform，不落盘（松手才写一次） */
    const left = Math.max(8, Math.min(drag.left + dx, drag.vw - SIZE - 8));
    const top = Math.max(8, Math.min(drag.top + dy, drag.vh - SIZE - 8));
    drag.cl = left; drag.ct = top;
    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(top) + 'px';
    if (e.cancelable) { try { e.preventDefault(); } catch (err) { /* noop */ } }
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    const d = drag;
    drag = null;
    if (d && d.timer) { global.clearTimeout(d.timer); d.timer = null; }
    if (host) host.classList.remove('dragging');
    if (!d) return;
    lastDragAt = Date.now();
    lastDragMoved = !!d.moved_;
    if (d.cl !== undefined && d.moved_) {
      /* 松手才落盘：拖动过程中频繁写 Store 会拖慢手感 */
      try {
        const L = Pet.place(d.cl / d.vw, d.ct / d.vh);
        if (L) place();
        react('purr', '');
      } catch (err) { /* noop */ }
    } else if (!d.long) {
      /* 原地松手＝点一下，由 click 处理 */
    }
  }

  function onClick(e) {
    /* 长按刚开过菜单，或者刚拖完：这一下 click 不算「点一下」 */
    if (longPressed) { longPressed = false; return; }
    if (lastDragMoved && Date.now() - lastDragAt < 600) { lastDragMoved = false; return; }
    if (e && e.target && e.target.closest && e.target.closest('.pet-home')) return;
    if (isMenuOpen()) { closeMenu(); return; }
    tapReact();
  }

  /** 点一下（没拖动）：随机一个小反应，长按菜单由 pointerdown 时机决定 */
  function tapReact() {
    const pool = [
      { kind: 'purr', say: '咕噜咕噜～' },
      { kind: 'happy', say: '喵！' },
      { kind: 'jump', say: '喵呜～' },
      { kind: 'poke', say: '……在写吗？' }
    ];
    const r = pool[Math.floor(Math.random() * pool.length)];
    const st = Pet.get();
    st.stats.mood = Math.min(100, st.stats.mood + 1);
    st.stats.bond = Math.min(100, st.stats.bond + 0.5);
    Pet.save();
    syncStats();
    react(r.kind, r.say);
    return r.kind;
  }

  /* ---------------- 空闲小动作：眨眼 / 耳朵抖 / 舔爪 ---------------- */

  const ACT = [
    { cls: 'anim-blink', id: 'pt-eye-l', ms: 420, w: 5 },
    { cls: 'anim-blink', id: 'pt-eye-r', ms: 420, w: 5 },
    { cls: 'anim-ear', id: 'pt-ear-l', ms: 620, w: 2 },
    { cls: 'anim-ear', id: 'pt-ear-r', ms: 700, w: 2 },
    { cls: 'anim-headtilt', id: 'pt-head', ms: 2400, w: 1 },
    { cls: 'anim-lick', id: 'pt-leg-l', ms: 1400, w: 1 }
  ];

  function idleAction() {
    if (hidden || paused || !host) return;
    if (Pet.isEnabled() === false) return;
    if (Pet.isAsleep()) {
      if (Math.random() < 0.5) react('sleep', '');
      return;
    }
    const pool = [];
    ACT.forEach(function (a) { for (let i = 0; i < a.w; i++) pool.push(a); });
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const node = doc.getElementById(pick.id);
    if (node) once(node, pick.cls, pick.ms);
  }

  function startIdle() {
    stopIdle();
    /* 2.6 秒一次、概率很低的微动作：一个定时器就够，不开 rAF */
    animTimer = global.setInterval(function () {
      try { idleAction(); } catch (e) { /* noop */ }
    }, 2600);
  }

  function stopIdle() {
    if (animTimer) { global.clearInterval(animTimer); animTimer = null; }
  }

  /* ---------------- 显隐 ---------------- */

  function editorOpen() {
    try {
      const p = global.UI && global.UI.currentPath ? String(global.UI.currentPath()) : '';
      /* 只在「正在写东西」的界面让位：文章编辑页 / 日记编辑页；
         小说首页（书架）不算，猫本来就该待在那儿 */
      return /^article(\/|$)/.test(p) || /^diary\/edit/.test(p);
    } catch (e) { return false; }
  }

  function applyVisibility() {
    if (!host) return false;
    const on = Pet.isEnabled() !== false;
    /* 礼貌：抽屉 / 对话框打开、写入编辑器、专注模式时自动让位 */
    let cover = false;
    try { cover = !!(global.UI && global.UI.isSheetOpen && global.UI.isSheetOpen()); } catch (e) { cover = false; }
    try {
      const mh = doc.getElementById('modalHost');
      if (mh && !mh.classList.contains('hidden')) cover = true;
    } catch (e) { /* noop */ }
    const editing = editorOpen();
    const show = on && !cover && !editing;
    host.classList.toggle('hidden', !show);
    host.classList.toggle('auto-hidden', !show && on);
    host.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (!show) closeMenu();
    return show;
  }

  function setPaused(v) {
    paused = !!v;
    hidden = !!v;
    if (host) host.classList.toggle('paused', !!v);
    if (v) stopIdle(); else startIdle();
  }

  /* ---------------- 挂载 ---------------- */

  function mount() {
    if (host) return true;
    if (!doc || !doc.body) return false;
    host = build();
    doc.body.appendChild(host);
    applyPose();
    place();
    applyVisibility();
    startIdle();
    patchUI();
    /* 恢复上次没跑完的番茄钟 */
    if (Pet.focusLeft() > 0) {
      global.setTimeout(function () { if (Pet.focusLeft() > 0) bubble('专注继续，还剩 ' + mmss(Pet.focusLeft()), 3600); }, 1200);
    }
    doc.addEventListener('pointerdown', onDocDown, true);
    return true;
  }

  function unmount() {
    stopIdle();
    if (bubTimer) { global.clearTimeout(bubTimer); bubTimer = null; }
    try { doc.removeEventListener('pointerdown', onDocDown, true); } catch (e) { /* noop */ }
    if (host && host.parentNode) host.parentNode.removeChild(host);
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    host = null; menuEl = null; statsEl = null; focusRow = null; bubbleEl = null; bubbleText = null;
    return true;
  }

  /* 点空白处收起菜单（capture 阶段，不会影响别人） */
  function onDocDown(e) {
    if (!isMenuOpen()) return;
    if (e.target && e.target.closest && (e.target.closest('.pet-menu') || e.target.closest('#petRoot'))) return;
    closeMenu();
  }

  /* 挂在 UI 上：渲染 / 开抽屉 / 开对话框时重新判定显隐 */
  function patchUI() {
    const UI = global.UI;
    if (!UI || patched) return false;
    try {
      const render = UI.render;
      UI.render = function () {
        const r = render.apply(this, arguments);
        try { applyVisibility(); } catch (e) { /* noop */ }
        return r;
      };
      const sheet = UI.sheet;
      UI.sheet = function () {
        closeMenu();
        const r = sheet.apply(this, arguments);
        applyVisibility();
        return r;
      };
      const closeSheet = UI.closeSheet;
      UI.closeSheet = function () {
        const r = closeSheet.apply(this, arguments);
        try { applyVisibility(); } catch (e) { /* noop */ }
        return r;
      };
      const modal = UI.modal;
      UI.modal = function () {
        closeMenu();
        const r = modal.apply(this, arguments);
        applyVisibility();
        return r;
      };
      const closeModal = UI.closeModal;
      UI.closeModal = function () {
        const r = closeModal.apply(this, arguments);
        try { applyVisibility(); } catch (e) { /* noop */ }
        return r;
      };
      patched = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- 对外对象 ---------------- */

  const PetView = {
    version: '1.0.0',
    mount: mount,
    unmount: unmount,
    node: function () { return host; },
    menuNode: function () { return menuEl; },
    applyVisibility: applyVisibility,
    applyPose: applyPose,
    place: place,
    react: react,
    typeReact: typeReact,
    bubble: bubble,
    open: open,
    closeMenu: closeMenu,
    isMenuOpen: isMenuOpen,
    syncStats: syncStats,
    syncPanel: function () { syncStats(); syncLevel(); },
    focusChanged: focusChanged,
    focusTick: focusTick,
    setPaused: setPaused,
    idleAction: idleAction,
    startIdle: startIdle,
    stopIdle: stopIdle,
    actions: function () { return ACTIONS.slice(); },
    debug: function () {
      return {
        mounted: !!host,
        visible: !!(host && !host.classList.contains('hidden')),
        paused: paused,
        menuOpen: isMenuOpen(),
        pose: host ? host.getAttribute('data-pose') : '',
        left: host ? host.style.left : '',
        top: host ? host.style.top : ''
      };
    }
  };

  global.PetView = PetView;
})(window);
