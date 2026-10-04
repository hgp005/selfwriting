/* ==========================================================================
   selfwriting · util.js
   基础工具：DOM、字数、日期、格式化、图片压缩、迷你 Markdown
   ========================================================================== */
(function (global) {
  'use strict';

  const U = {};

  /* ---------------- DOM ---------------- */
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /**
   * 极简元素工厂
   * el('div.card', { onclick: fn }, [child, 'text'])
   * 标签语法： tag.class1.class2#id
   */
  U.el = function (spec, attrs, children) {
    let tag = 'div', id = null;
    const classes = [];
    const m = String(spec || 'div').match(/^([a-zA-Z0-9]*)((?:[.#][^.#]+)*)$/);
    if (m) {
      if (m[1]) tag = m[1];
      const rest = m[2] || '';
      const re = /([.#])([^.#]+)/g;
      let mm;
      while ((mm = re.exec(rest))) {
        if (mm[1] === '.') classes.push(mm[2]);
        else id = mm[2];
      }
    } else {
      tag = String(spec || 'div');
    }
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (classes.length) node.className = classes.join(' ');
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        let v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        /* 函数式属性：键名以 .f 结尾时先求值，便于「打开时才算一次」的动态文案。
           没有这个的话把函数塞给 text 会变成函数源码字符串。 */
        if (/\.f$/.test(k)) {
          if (typeof v === 'function') { try { v = v(); } catch (e) { v = ''; } }
          k = k.slice(0, -2);
          if (v === null || v === undefined || v === false) return;
        }
        if (k === 'class') node.className = (node.className ? node.className + ' ' : '') + v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'value') node.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected') node[k] = !!v;
        else node.setAttribute(k, v);
      });
    }
    U.append(node, children);
    return node;
  };

  U.append = function (node, children) {
    if (children === null || children === undefined || children === false) return node;
    if (Array.isArray(children)) {
      children.forEach((c) => U.append(node, c));
      return node;
    }
    if (children instanceof Node) node.appendChild(children);
    else node.appendChild(document.createTextNode(String(children)));
    return node;
  };

  U.clear = function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; };

  /** 图标：统一 24 网格线性图标，用 currentColor */
  const ICONS = {
    back: 'M15 5l-7 7 7 7',
    close: 'M6 6l12 12M18 6L6 18',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    check: 'M4 12.5l5 5L20 6.5',
    search: 'M11 4a7 7 0 105.2 11.7L21 20.5 19.5 22l-4.8-4.8A7 7 0 0011 4zm0 2a5 5 0 110 10 5 5 0 010-10z',
    sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7l1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2l-1.4-1.4M12 7a5 5 0 100 10 5 5 0 000-10z',
    'sun-small': 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10l1.4 1.4m0-12.8l-1.4 1.4m-10 10l-1.4 1.4',
    moon: 'M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z',
    book: 'M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5v-15zM20 18v3H6.5',
    feather: 'M20 4c-6 0-11 4.5-11 10v6h3v-4h8l-1.5-3H15c3-2 5-4.5 5-9zM4 20l5-5',
    calendar: 'M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v11A2.5 2.5 0 0117.5 20h-11A2.5 2.5 0 014 17.5v-11zM4 9.5h16M8 3v3m8-3v3',
    tree: 'M5 4h5v4H5V4zm9 12h5v4h-5v-4zM7.5 8v4.5A2 2 0 009.5 14.5h2m0 0V12m0 2.5a2 2 0 002 2h0',
    reader: 'M4 4h7a3 3 0 013 3v13a2.5 2.5 0 00-2.5-2.5H4V4zm16 0h-4a3 3 0 00-3 3v13a2.5 2.5 0 012.5-2.5H20V4z',
    chart: 'M4 20V4m0 16h16M8 20v-6m4 6V8m4 12v-9',
    trophy: 'M8 4h8v4a4 4 0 01-8 0V4zM8 5H5.5A2.5 2.5 0 008 9.5M16 5h2.5A2.5 2.5 0 0116 9.5M12 12v4m-2.5 4h5',
    settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zm8.4 3a8.4 8.4 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a8.6 8.6 0 00-2-1.2L15.6 3h-3.9l-.4 2.5a8.6 8.6 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A8.4 8.4 0 006.9 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a8.6 8.6 0 002 1.2l.4 2.5h3.9l.4-2.5a8.6 8.6 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
    edit: 'M4 20h4L20 8l-4-4L4 16v4zM14 6l4 4',
    doc: 'M6 3h8l4 4v14H6V3zm8 0v4h4M9 12h6M9 16h6',
    image: 'M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v13A1.5 1.5 0 0118.5 20h-13A1.5 1.5 0 014 18.5v-13zM4 16l4.5-4.5 3 3L15 11l5 5M9 9a1 1 0 100-2 1 1 0 000 2z',
    trash: 'M5 7h14M9 7V5h6v2m-8 0l1 13h8l1-13M11 11v6m2-6v6',
    down: 'M12 4v12m0 0l-5-5m5 5l5-5M4 20h16',
    up: 'M12 20V8m0 0L7 13m5-5l5 5M4 4h16',
    chevron: 'M9 5l7 7-7 7',
    dot: 'M12 10a2 2 0 100 4 2 2 0 000-4z',
    star: 'M12 3.5l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.9l6.1-.8L12 3.5z',
    flag: 'M6 21V4h12l-2.5 4.5L18 13H6',
    clock: 'M12 4a8 8 0 100 16 8 8 0 000-16zm0 3v5.5l4 2',
    fire: 'M12 3c1 3-1 4.5-2 6s-1.5 3 0 4.5c1-1 1.5-1.5 2-3 1 2 3 3 3 5.5a4.5 4.5 0 01-9 0C6 10.5 10.5 8 12 3z',
    link: 'M10 13.5a3.5 3.5 0 005 0l3-3a3.5 3.5 0 10-5-5l-1 1M14 10.5a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 105 5l1-1',
    folder: 'M4 6.5A1.5 1.5 0 015.5 5h4l2 2.5h7A1.5 1.5 0 0120 9v9.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5v-12z',
    filter: 'M4 5h16l-6 7v6l-4 2v-8L4 5z',
    more: 'M6 12a1.6 1.6 0 100-.01M12 12a1.6 1.6 0 100-.01M18 12a1.6 1.6 0 100-.01',
    palette: 'M12 3a9 9 0 000 18c1.4 0 2-1 2-2s-.6-2-2-2h-1a2 2 0 010-4h5a5 5 0 005-5c0-3-4-5-9-5zM7.5 12a1.2 1.2 0 100-.02M9.5 8a1.2 1.2 0 100-.02M14.5 7.5a1.2 1.2 0 100-.02',
    bookmark: 'M6 4h12v17l-6-4-6 4V4z',
    target: 'M12 4a8 8 0 100 16 8 8 0 000-16zm0 4a4 4 0 100 8 4 4 0 000-8zm0 3a1 1 0 100 2 1 1 0 000-2z',
    list: 'M4 6h16M4 12h16M4 18h10',
    eye: 'M12 5c5 0 8.5 4.5 9.5 7-1 2.5-4.5 7-9.5 7S3.5 14.5 2.5 12C3.5 9.5 7 5 12 5zm0 3.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
    copy: 'M9 9h10v11H9V9zm2-3V4h10v11h-2',
    text: 'M5 6h14M5 12h9M5 18h12',
    dash: 'M4 12h16',
    arrowRight: 'M5 12h14m0 0l-5-5m5 5l-5 5',
    arrowLeft: 'M19 12H5m0 0l5-5m-5 5l5 5',
    refresh: 'M20 11a8 8 0 10-2.3 6M20 5v6h-6',
    zoom: 'M11 4a7 7 0 105 12l5 5M8 11h6M11 8v6',
    grid: 'M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z',
    quote: 'M8 6C5.5 7 4 9.5 4 13v5h6v-6H7c0-2 .5-3.5 2-4.5L8 6zm10 0c-2.5 1-4 3.5-4 7v5h6v-6h-3c0-2 .5-3.5 2-4.5L18 6z',
    /* --- 趣味与工具模块 --- */
    game: 'M7.5 8h9A4.5 4.5 0 0121 12.5c0 3-1.5 5.5-3.5 5.5-1.2 0-2-.8-2.8-1.6-.6-.6-1.1-1.1-2.7-1.1s-2.1.5-2.7 1.1C8.5 17.2 7.7 18 6.5 18 4.5 18 3 15.5 3 12.5A4.5 4.5 0 017.5 8zM7 11v3M5.5 12.5h3M16 11.2h.01M18 13.2h.01',
    calc: 'M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zm2 3h8v3H8V6zm0 6h2v2H8v-2zm4 0h2v2h-2v-2zm4 0h.01M8 16h2v2H8v-2zm4 0h2v2h-2v-2zm4 0h.01',
    music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm10-2a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
    bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.5.4.8 1 .8 1.6v.5h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0012 3z',
    piano: 'M3 5h18v14H3V5zm3.5 0v8M12 5v8M18 5v8M3 13h18M8 13v6m6-6v6',
    snake: 'M5 6h4a3 3 0 010 6H7a3 3 0 000 6h10a3 3 0 003-3V9',
    tetris: 'M4 4h5v5H4V4zm5 5h5v5H9V9zm5-5h5v5h-5V4zM4 14h5v5H4v-5zm10 5h5v-5h-5v5z',
    /* --- 隐私 / 协作 --- */
    lock: 'M7 11V8a5 5 0 0110 0v3M5.5 11h13a1 1 0 011 1v7a1 1 0 01-1 1h-13a1 1 0 01-1-1v-7a1 1 0 011-1zM12 15v2',
    unlock: 'M7 11V8a5 5 0 019.6-2M5.5 11h13a1 1 0 011 1v7a1 1 0 01-1 1h-13a1 1 0 01-1-1v-7a1 1 0 011-1z',
    share: 'M12 16V4m0 0L8 8m4-4l4 4M5 14v5a1 1 0 001 1h12a1 1 0 001-1v-5',
    users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm7.5 0a3 3 0 100-6 3 3 0 000 6zM3 20v-1.5A4.5 4.5 0 017.5 14h3A4.5 4.5 0 0115 18.5V20M17 14h.5a4 4 0 014 4v2',
    chat: 'M4 5.5A1.5 1.5 0 015.5 4h9A1.5 1.5 0 0116 5.5v6a1.5 1.5 0 01-1.5 1.5H9l-4 3v-3H5.5A1.5 1.5 0 014 11.5v-6zM18 8h1.5A1.5 1.5 0 0121 9.5v6a1.5 1.5 0 01-1.5 1.5H18v3l-3.5-2.6'
  };

  U.icon = function (name, cls) {
    const d = ICONS[name] || ICONS.dot;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'ico ' + (cls || ''));
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
    return svg;
  };

  /* ---------------- 字体 ---------------- */
  /**
   * 可选字体。全部是系统自带的免费字体（安卓 7+ / Windows 都有）
   * 或自由许可的开源字体 —— 不联网、不打包字体文件，因此 APK 不会变大。
   * stack 里按「先具体后兜底」排列，缺失时自动回退，不会出现方框。
   */
  U.FONTS = [
    {
      id: 'serif', label: '宋体（衬线）', note: '默认，适合长篇阅读与正式文稿',
      stack: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", Georgia, "Times New Roman", serif'
    },
    {
      id: 'sans', label: '黑体（无衬线）', note: '笔画均匀，屏幕上更清爽',
      stack: '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif'
    },
    {
      id: 'kai', label: '楷体', note: '笔锋明显，写日记、书信很有味道',
      stack: '"Kaiti SC", "KaiTi", "STKaiti", "KaiTi_GB2312", "Noto Serif SC", "Songti SC", "SimSun", serif'
    },
    {
      id: 'fangsong', label: '仿宋', note: '清瘦工整，适合公文与短篇',
      stack: '"FangSong", "STFangsong", "FangSong_GB2312", "Noto Serif SC", "Songti SC", "SimSun", serif'
    },
    {
      id: 'mono', label: '等宽', note: '每个字宽度一致，写代码、排大纲方便',
      stack: '"Cascadia Mono", Consolas, "SF Mono", Menlo, "Noto Sans Mono CJK SC", "Sarasa Mono SC", "Courier New", monospace'
    },
    {
      id: 'latin', label: '西文衬线', note: '中文走宋体，英文数字用衬线，写英文稿更雅致',
      stack: 'Georgia, "Times New Roman", "Songti SC", "SimSun", "Noto Serif SC", serif'
    }
  ];

  /** 界面字体（影响整个 App 的按钮、列表、标题） */
  U.UI_FONTS = [
    { id: 'system', label: '系统默认', stack: '' },
    { id: 'sans', label: '黑体', stack: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif' },
    { id: 'serif', label: '宋体', stack: '"Noto Serif SC", "Songti SC", "SimSun", Georgia, serif' },
    { id: 'kai', label: '楷体', stack: '"Kaiti SC", "KaiTi", "STKaiti", "Noto Serif SC", serif' },
    { id: 'mono', label: '等宽', stack: '"Cascadia Mono", Consolas, "Noto Sans Mono CJK SC", monospace' }
  ];

  U.fontStack = function (id) {
    const f = U.FONTS.find((x) => x.id === id);
    return f ? f.stack : U.FONTS[0].stack;
  };
  U.uiFontStack = function (id) {
    const f = U.UI_FONTS.find((x) => x.id === id);
    return f ? f.stack : '';
  };

  /** 把字体选择写进 CSS 变量（正文 --font-serif 同时供阅读器/日记/预览复用） */
  U.applyFonts = function (settings) {
    const s = settings || {};
    const root = document.documentElement;
    root.style.setProperty('--font-serif', U.fontStack(s.editorFont || 'serif'));
    const ui = U.uiFontStack(s.uiFont || 'system');
    if (ui) root.style.setProperty('--font-ui', ui);
    else root.style.removeProperty('--font-ui');
  };

  /** 把 data-icon="xxx" 的占位元素替换成真实 SVG（静态 HTML 用） */
  U.hydrateStaticIcons = function (root) {
    U.$$('[data-icon]', root || document).forEach((node) => {
      if (node.dataset.iconDone) return;
      const name = node.dataset.icon;
      node.dataset.iconDone = '1';
      node.appendChild(U.icon(name, node.dataset.iconClass || ''));
    });
  };

  /* ---------------- 字数 ---------------- */
  /**
   * 统计文本。
   * words  = 中文字符数 + 西文单词数（创作平台通用「字数」口径）
   * chars  = 全部可见字符（含标点与空格）
   *
   * 性能：这是整个应用最热的热点（每次统计都要遍历全文）。
   * 用 charCodeAt + 区间判断替代逐字符正则，大文本下快数倍。
   */
  U.countText = function (text) {
    if (!text) return { words: 0, chars: 0, cjk: 0, latin: 0, punct: 0, lines: 0, paras: 0 };
    let words = 0, chars = 0, cjk = 0, latin = 0, punct = 0;
    let inWord = false, inPara = false;
    let lines = 1, paras = 0;
    const len = text.length;
    for (let i = 0; i < len; i++) {
      const c = text.charCodeAt(i);
      if (c === 13) continue;                              // \r
      if (c === 10) { lines++; inWord = false; inPara = false; continue; }  // \n
      if (c === 32 || c === 9) { inWord = false; continue; }  // 空格 / Tab
      chars++;
      if (!inPara) { paras++; inPara = true; }              // 连续非空行算一段
      if ((c >= 0x4e00 && c <= 0x9fff) ||                  // CJK 统一表意
          (c >= 0x3400 && c <= 0x4dbf) ||                  // 扩展 A
          (c >= 0xf900 && c <= 0xfaff) ||                  // 兼容表意
          (c >= 0x3040 && c <= 0x30ff) ||                  // 日文假名
          (c >= 0xac00 && c <= 0xd7af)) {                  // 韩文
        cjk++; words++; inWord = false;
      } else if ((c >= 48 && c <= 57) ||                   // 0-9
                 (c >= 65 && c <= 90) ||                   // A-Z
                 (c >= 97 && c <= 122) ||                  // a-z
                 (c >= 0xc0 && c <= 0x24f) ||              // 拉丁扩展
                 c === 39 || c === 0x2019 || c === 45) {   // ' ’ -
        latin++;
        if (!inWord) { words++; inWord = true; }
      } else {
        punct++;
        inWord = false;
      }
    }
    return { words, chars, cjk, latin, punct, lines, paras };
  };

  U.words = (t) => U.countText(t).words;

  /** 近似字数：大文本下先给个数，精确值留给空闲时校正（导入/首次统计用） */
  U.estimateWords = function (text) {
    const len = text ? text.length : 0;
    return len < 600 ? U.words(text) : len;
  };

  /* ---------------- 数字 / 时间格式化 ---------------- */
  U.clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  U.fmtNum = function (n) {
    n = Number(n) || 0;
    const en = lang() === 'en';
    if (en) {
      if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
      if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
      return String(n);
    }
    if (n >= 100000000) return (n / 100000000).toFixed(2).replace(/\.?0+$/, '') + '亿';
    if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + '万';
    return String(n);
  };

  /** 字数：一万以上用「万」作单位（英文界面用 k/M），小数字照常 */
  U.fmtWords = function (n) {
    n = Number(n) || 0;
    const en = lang() === 'en';
    if (Math.abs(n) < 10000) return U.fmtInt(n) + (en ? '' : ' 字');
    return U.fmtNum(n) + (en ? ' words' : ' 字');
  };

  U.fmtInt = (n) => (Number(n) || 0).toLocaleString('en-US');

  /* ------------------------------------------------------------------
     时区与「现在」
     手机上的时间是系统本地时间；应用里允许自己选时区（默认北京时间 UTC+8），
     日历的「今天」、日记的日期上限、时钟显示全部走这里，保证和现实时间一致。
     ------------------------------------------------------------------ */
  U.TIMEZONES = [
    { offset: 480, label: '北京时间', sub: 'UTC+8' },
    { offset: 540, label: '东京 / 首尔', sub: 'UTC+9' },
    { offset: 420, label: '曼谷 / 雅加达', sub: 'UTC+7' },
    { offset: 330, label: '新德里', sub: 'UTC+5:30' },
    { offset: 240, label: '迪拜', sub: 'UTC+4' },
    { offset: 60, label: '巴黎 / 柏林', sub: 'UTC+1' },
    { offset: 0, label: '伦敦', sub: 'UTC+0' },
    { offset: -300, label: '纽约', sub: 'UTC-5' },
    { offset: -480, label: '洛杉矶', sub: 'UTC-8' },
    { offset: -600, label: '檀香山', sub: 'UTC-10' }
  ];

  /** 当前设置里的时区偏移（分钟） */
  U.tzOffset = function () {
    try {
      const s = global.Store && global.Store.state && global.Store.state.settings;
      if (s && typeof s.timeZone === 'number') return s.timeZone;
    } catch (e) { /* 启动早期还没有 Store */ }
    return 480;                       // 默认北京时间
  };

  U.tzLabel = function () {
    const off = U.tzOffset();
    const hit = U.TIMEZONES.filter((t) => t.offset === off)[0];
    return hit ? (hit.label + ' ' + hit.sub) : ('UTC' + (off >= 0 ? '+' : '-') + Math.abs(off) / 60);
  };

  /**
   * 目标时区的「现在」。
   * 返回的 Date 用本地 getHours() 之类的读出来，就是那个时区的墙上时间 ——
   * 这样所有既有的日期格式化都不用改。
   */
  U.tzNow = function (ts) {
    const base = ts === undefined ? Date.now() : Number(ts);
    const localOffset = -new Date(base).getTimezoneOffset();     // 东八区 = 480
    return new Date(base + (U.tzOffset() - localOffset) * 60000);
  };

  /** 应用内的「今天」（按所选时区算），'YYYY-MM-DD' */
  U.today = function () { return U.dateKey(U.tzNow()); };

  /** 实时时钟：HH:MM:SS（随时区） */
  U.tzClock = function (withSeconds) {
    const d = U.tzNow();
    const p = (x) => String(x).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + (withSeconds === false ? '' : ':' + p(d.getSeconds()));
  };

  /* ------------------------------------------------------------------
     多语种：日期 / 时长 / 相对时间的写法也跟着界面语言走。
     之前这些串是「运行时拼出来的」，词典永远追不上 —— 英文界面里就会
     冒出「更新于 刚刚」「9月24日 周四」这类半中半英的句子。
     ------------------------------------------------------------------ */
  function lang() {
    try {
      return (global.I18N && global.I18N.lang && global.I18N.lang()) || 'zh-CN';
    } catch (e) { return 'zh-CN'; }
  }
  const EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const EN_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /**
   * 运行时拼出来的文案：给出中文与英文两种整句，按当前界面语言取一句。
   * 词典只能替换「整段完全匹配」的静态文案，像
   *   '连续创作 ' + n + ' 天 · 累计 ' + U.fmtDuration(...)
   * 这种拼出来的句子必须在这里就把两种语言都写好，否则英文界面会半中半英。
   */
  U.pick = function (zh, en) {
    if (lang() === 'en') return en === undefined || en === null ? zh : en;
    if (lang() === 'zh-TW' && global.I18N && global.I18N.toTW) return global.I18N.toTW(zh);
    return zh;
  };

  /** 分钟 -> 人类可读 */
  U.fmtDuration = function (mins, opt) {
    mins = Math.max(0, Math.round(Number(mins) || 0));
    const o = opt || {};
    const en = lang() !== 'zh-CN';
    const u = { min: en ? ' min' : ' 分钟', hr: en ? ' hr' : ' 小时', day: en ? ' d' : ' 天' };
    if (mins < 1) return o.short ? (en ? '0 min' : '0分') : (en ? 'under 1 min' : '不足 1 分钟');
    if (mins < 60) return mins + u.min;
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h < 24) return m ? h + u.hr + ' ' + m + (en ? ' min' : ' 分') : h + u.hr;
    const d = Math.floor(h / 24), hh = h % 24;
    return hh ? d + u.day + ' ' + hh + u.hr : d + u.day;
  };

  /** 秒 -> mm:ss / h:mm:ss */
  U.fmtClock = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (x) => String(x).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  };

  U.pad = (n) => String(n).padStart(2, '0');

  /** Date -> 'YYYY-MM-DD'（本地时区） */
  U.dateKey = function (d) {
    d = d ? new Date(d) : new Date();
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
  };
  U.monthKey = function (d) { d = d ? new Date(d) : new Date(); return d.getFullYear() + '-' + U.pad(d.getMonth() + 1); };
  U.yearKey = function (d) { d = d ? new Date(d) : new Date(); return String(d.getFullYear()); };

  /** 周键：以周一为一周开始 → '2025-W03' */
  U.weekKey = function (d) {
    d = d ? new Date(d) : new Date();
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = (t.getDay() + 6) % 7;           // 周一 = 0
    t.setDate(t.getDate() - day + 3);            // 移到本周周四
    const firstThu = new Date(t.getFullYear(), 0, 4);
    const fday = (firstThu.getDay() + 6) % 7;
    firstThu.setDate(firstThu.getDate() - fday + 3);
    const week = 1 + Math.round((t - firstThu) / (7 * 86400000));
    return t.getFullYear() + '-W' + U.pad(week);
  };

  U.weekRange = function (d) {
    d = d ? new Date(d) : new Date();
    const day = (d.getDay() + 6) % 7;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return [start, end];
  };

  U.parseKey = function (key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
    if (!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };

  U.shiftDate = function (key, days) {
    const d = U.parseKey(key);
    d.setDate(d.getDate() + days);
    return U.dateKey(d);
  };

  U.dayDiff = function (a, b) {
    const da = U.parseKey(a), db = U.parseKey(b);
    return Math.round((db - da) / 86400000);
  };

  /** 相对时间：刚刚 / 12 分钟前 / 3 小时前 / 昨天 / 3 天前 / 2024-05-01 */
  U.fmtWhen = function (ts) {
    if (!ts) return '';
    const en = lang() !== 'zh-CN';
    const tw = lang() === 'zh-TW';
    const now = Date.now();
    const diff = now - ts;
    const hm = (t) => new Date(t).getHours() + ':' + U.pad(new Date(t).getMinutes());
    if (diff < 45000) return tw ? '剛剛' : (en ? 'Just now' : '刚刚');
    if (diff < 3600000) return Math.floor(diff / 60000) + (en ? ' min ago' : (tw ? ' 分鐘前' : ' 分钟前'));
    const today = U.dateKey();
    const dk = U.dateKey(ts);
    if (dk === today) return (en ? 'Today ' : (tw ? '今天 ' : '今天 ')) + hm(ts);
    if (dk === U.shiftDate(today, -1)) return (en ? 'Yesterday ' : (tw ? '昨天 ' : '昨天 ')) + hm(ts);
    const dd = U.dayDiff(dk, today);
    if (dd < 7) return dd + (en ? ' days ago' : (tw ? ' 天前' : ' 天前'));
    const d = new Date(ts);
    if (en) return EN_MON[d.getMonth()] + ' ' + d.getDate() + (dd < 365 ? '' : ', ' + d.getFullYear());
    return (d.getMonth() + 1) + '月' + d.getDate() + '日' + (dd < 365 ? '' : ' ' + d.getFullYear() + ' 年');
  };

  U.fmtDate = function (ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
  };
  U.fmtDateTime = function (ts) {
    const d = ts ? new Date(ts) : new Date();
    return U.fmtDate(d) + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  };

  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  U.weekdayCN = (key) => {
    const i = U.parseKey(key).getDay();
    if (lang() === 'en') return EN_WD[i];
    return (lang() === 'zh-TW' ? '週' : '周') + WD[i];
  };
  U.fmtDateCN = function (key) {
    const d = U.parseKey(key);
    if (lang() === 'en') return EN_MON[d.getMonth()] + ' ' + d.getDate() + ', ' + EN_WD[d.getDay()];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + U.weekdayCN(key);
  };

  /* ---------------- 杂项 ---------------- */
  U.uid = function (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  U.escapeHtml = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  U.debounce = function (fn, wait) {
    let t = null;
    const wrapped = function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(self, args); }, wait);
    };
    wrapped.cancel = () => clearTimeout(t);
    wrapped.flush = function () { if (t) { clearTimeout(t); t = null; fn.apply(this, arguments); } };
    return wrapped;
  };

  U.throttle = function (fn, wait) {
    let last = 0, timer = null, lastArgs = null;
    return function () {
      const now = Date.now();
      lastArgs = arguments;
      if (now - last >= wait) { last = now; fn.apply(this, lastArgs); }
      else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn.apply(this, lastArgs); }, wait - (now - last));
      }
    };
  };

  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  U.copyText = async function (text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* 降级 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  };

  /** 10^n 序列（成就档位：1万 / 10万 / 100万 …） */
  U.pow10Series = function (from, to) {
    const out = [];
    for (let e = from; e <= to; e++) out.push(Math.pow(10, e));
    return out;
  };

  /** 数字名称（用于成就标题）：10000 → “1万” */
  U.numName = function (n) {
    if (n >= 100000000) return (n / 100000000) + '亿';
    if (n >= 10000) return (n / 10000) + '万';
    return String(n);
  };

  /** 取 text 中前 len 个字符（不破坏代理对） */
  U.sliceChars = function (s, len) {
    const arr = Array.from(String(s || ''));
    return arr.length > len ? arr.slice(0, len).join('') : arr.join('');
  };

  /** 文本摘要：去掉换行与多余空白 */
  U.excerpt = function (text, len) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > (len || 60) ? t.slice(0, len || 60) + '…' : t;
  };

  /* ---------------- 图片压缩（日记插图用） ---------------- */
  U.readFileAsDataURL = (file) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('读取失败'));
    fr.readAsDataURL(file);
  });

  /**
   * 读文件成字节 —— 手机上最容易出问题的一步，所以做成三级兜底：
   *   1) FileReader.readAsArrayBuffer（最标准）
   *   2) file.arrayBuffer()（新版 WebView 的 Promise 接口）
   *   3) file.text() 再按原样取字节（部分文件管理器只认这条）
   * 全部失败时，抛出的错误里带上文件名/大小/类型与每一级的失败原因，
   * 让「没能导入这个文件」这句提示变成可定位的信息。
   */
  U.readFileAsArrayBuffer = function (file) {
    const name = (file && file.name) || '(未命名)';
    const size = (file && typeof file.size === 'number') ? file.size : -1;
    const type = (file && file.type) || '未知类型';
    const tried = [];

    const viaFileReader = () => new Promise((resolve, reject) => {
      if (typeof FileReader === 'undefined') { reject(new Error('没有 FileReader')); return; }
      const fr = new FileReader();
      fr.onload = () => resolve(new Uint8Array(fr.result || new ArrayBuffer(0)));
      fr.onerror = () => reject(fr.error || new Error('FileReader 报错'));
      fr.onabort = () => reject(new Error('FileReader 被中断'));
      try { fr.readAsArrayBuffer(file); } catch (e) { reject(e); }
    });

    const viaArrayBuffer = () => {
      if (!file || typeof file.arrayBuffer !== 'function') return Promise.reject(new Error('没有 arrayBuffer()'));
      return file.arrayBuffer().then((b) => new Uint8Array(b || new ArrayBuffer(0)));
    };

    const viaText = () => {
      if (!file || typeof file.text !== 'function') return Promise.reject(new Error('没有 text()'));
      return file.text().then((t) => new TextEncoder().encode(String(t || '')));
    };

    return viaFileReader()
      .catch((e1) => {
        tried.push('readAsArrayBuffer: ' + (e1 && e1.message || e1));
        return viaArrayBuffer();
      })
      .catch((e2) => {
        tried.push('arrayBuffer(): ' + (e2 && e2.message || e2));
        return viaText();
      })
      .catch((e3) => {
        tried.push('text(): ' + (e3 && e3.message || e3));
        const err = new Error('读不到文件内容（' + name + ' · ' + (size >= 0 ? U.fmtBytes(size) : '大小未知')
          + ' · ' + type + '）\n' + tried.join('\n'));
        err.readTried = tried;
        throw err;
      })
      .then((bytes) => {
        if (!bytes || !bytes.length) {
          const err = new Error('文件读出来是空的（' + name + ' · ' + (size >= 0 ? U.fmtBytes(size) : '大小未知')
            + ' · ' + type + '）\n' + (tried.length ? tried.join('\n') : '读取过程没有报错，但内容为 0 字节。'));
          err.readTried = tried;
          throw err;
        }
        return bytes;
      });
  };

  /** 字节数 → 人类可读 */
  U.fmtBytes = function (n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / 1024 / 1024).toFixed(1) + ' MB';
  };

  /** 兼容旧名：按字节读（不再按文本读，避免中文乱码） */
  U.readFileAsText = (file) => U.readFileAsArrayBuffer(file)
    .then((bytes) => new TextDecoder('utf-8').decode(bytes));

  /**
   * 压缩图片为 JPEG dataURL，控制本地存储体积。
   * maxSide 默认 1600px，quality 0.82
   */
  U.compressImage = function (file, maxSide, quality) {
    maxSide = maxSide || 1600;
    quality = quality || 0.82;
    return U.readFileAsDataURL(file).then((dataUrl) => new Promise((resolve) => {
      const img = new Image();
      img.onload = function () {
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        try {
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const out = cv.toDataURL('image/jpeg', quality);
          resolve(out.length < dataUrl.length ? out : dataUrl);
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    }));
  };

  /* ---------------- 迷你 Markdown ---------------- */
  /** 极简、安全的 Markdown → HTML（供阅读器使用） */
  U.mdToHtml = function (src) {
    const esc = U.escapeHtml;
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inCode = false, listType = null, para = [];

    const flushPara = () => {
      if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; }
    };
    const closeList = () => { if (listType) { out.push('</' + listType + '>'); listType = null; } };

    const inline = (s) => {
      let t = esc(s);
      t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return t;
    };

    lines.forEach((raw) => {
      const line = raw.replace(/\s+$/, '');
      if (/^\s*```/.test(line)) {
        flushPara(); closeList();
        out.push(inCode ? '</code></pre>' : '<pre><code>');
        inCode = !inCode;
        return;
      }
      if (inCode) { out.push(esc(raw)); return; }
      if (!line.trim()) { flushPara(); closeList(); return; }

      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        flushPara(); closeList();
        const lv = Math.min(6, m[1].length + 1);
        out.push('<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>');
        return;
      }
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); return; }
      if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
        flushPara();
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        out.push('<li>' + inline(m[1]) + '</li>');
        return;
      }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
        flushPara();
        if (listType === 'ol') { /* 继续当前列表 */ }
        else { closeList(); out.push('<ol>'); listType = 'ol'; }
        out.push('<li>' + inline(m[1]) + '</li>');
        return;
      }
      if ((m = /^\s*>\s?(.*)$/.exec(line))) {
        flushPara(); closeList();
        out.push('<blockquote>' + inline(m[1]) + '</blockquote>');
        return;
      }
      closeList();
      para.push(inline(line));
    });
    flushPara(); closeList();
    if (inCode) out.push('</code></pre>');
    return out.join('\n');
  };

  /** 从 Markdown / 纯文本里猜章节标题（用于导入阅读） */
  U.splitChapters = function (text, mode) {
    const src = String(text || '').replace(/\r\n?/g, '\n');
    if (mode === 'none' || mode === 'single') return [{ title: '全文', content: src }];

    const lines = src.split('\n');
    const headingRe = /^\s{0,3}(?:#{1,4}\s+(.{1,80})|(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节回卷篇][^\n]{0,60})|((?:Chapter|CHAPTER|chapter)\s*\d{1,4}[^\n]{0,60}))\s*$/;
    const idx = [];
    lines.forEach((l, i) => { if (headingRe.test(l)) idx.push(i); });

    const chapters = [];
    if (idx.length >= 2) {
      const first = idx[0];
      if (lines.slice(0, first).join('').trim()) {
        chapters.push({ title: '前言', content: lines.slice(0, first).join('\n').trim() });
      }
      idx.forEach((start, k) => {
        const end = k + 1 < idx.length ? idx[k + 1] : lines.length;
        const title = lines[start].replace(/^\s{0,3}#{1,4}\s+/, '').trim().slice(0, 80);
        const content = lines.slice(start + 1, end).join('\n').trim();
        chapters.push({ title: title || ('第 ' + (k + 1) + ' 节'), content });
      });
    } else if (idx.length === 1 && idx[0] === 0) {
      const title = lines[0].replace(/^\s{0,3}#{1,4}\s+/, '').trim().slice(0, 80);
      chapters.push({ title: title || '全文', content: lines.slice(1).join('\n').trim() });
    }
    if (!chapters.length) {
      // 退化为按固定长度切分，避免单章过长
      const CHUNK = 12000;
      if (src.length <= CHUNK) chapters.push({ title: '全文', content: src.trim() });
      else {
        for (let i = 0, n = 1; i < src.length; i += CHUNK, n++) {
          chapters.push({ title: '第 ' + n + ' 部分', content: src.slice(i, i + CHUNK).trim() });
        }
      }
    }
    return chapters;
  };

  /** 取正文前 N 个字符做预览（保留换行结构） */
  U.preview = function (text, len) {
    const t = String(text || '').trim();
    return t.length > (len || 200) ? t.slice(0, len || 200) + '…' : t;
  };

  global.U = U;
})(window);
