/* ==========================================================================
   selfwriting · io.js
   导入 / 导出：作品文本（TXT / Markdown / EPUB / MOBI / PDF）、大纲、日记、
   阅读素材、整库备份。全部在本机完成，不经过任何服务器。
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const Store = global.Store;

  const IO = {};

  /* ================================================================== */
  /* 可导入格式说明（导入界面直接标注，避免用户不知道该选什么）           */
  /* ================================================================== */
  IO.FORMAT_ROWS = [
    { ext: 'TXT', note: '纯文本，自动识别 UTF-8 / UTF-16 / GBK / Big5 编码与章节' },
    { ext: 'MD', note: 'Markdown，保留标题层级与粗体等结构' },
    { ext: 'HTML', note: '网页另存的文件，自动去掉标签只留正文' },
    { ext: 'EPUB', note: '电子书，读取书内目录与书名作者（含压缩包）' },
    { ext: 'MOBI', note: 'Kindle 格式（.mobi / .azw / .azw3 / .prc）' },
    { ext: 'PDF', note: '提取文字层；扫描版图片 PDF 无文字层，提取不出内容' }
  ];
  IO.FORMAT_ACCEPT_TEXT = 'TXT · MD · HTML · EPUB · MOBI · PDF';

  /**
   * 可导入格式说明卡片（导入对话框顶部用）
   * opt: { compact:true 只显示一行摘要, onPick: 选完文件后的提示 }
   */
  IO.formatHint = function (opt) {
    const o = opt || {};
    const card = U.el('div.fmt-hint');
    U.append(card, U.el('div.fmt-hint-title', {}, [
      U.icon('doc', 'ico-sm'),
      U.el('span', { text: '可以导入这些文件：' + IO.FORMAT_ACCEPT_TEXT })
    ]));
    if (!o.compact) {
      const list = U.el('div.fmt-hint-list');
      IO.FORMAT_ROWS.forEach((r) => {
        list.appendChild(U.el('div.fmt-hint-row', {}, [
          U.el('span.fmt-ext', { text: r.ext }),
          U.el('span.fmt-note', { text: r.note })
        ]));
      });
      U.append(card, list);
    }
    U.append(card, U.el('div.fmt-hint-tip', {
      text: '选不到文件？也可以用「粘贴文本」把内容直接贴进来。导入的内容默认不计入成就与统计。'
    }));
    /* 选文件通道自检：手机上「点了没反应」时，这一屏能直接说明原因 */
    U.append(card, U.el('button.fmt-hint-check', {
      text: '文件导入自检',
      onclick: () => IO.diagnoseImport()
    }));
    return card;
  };

  /** 导入能力诊断：把关键事实摆出来，便于判断「为什么选不到文件」 */
  IO.diagnoseImport = function () {
    const cap = IO.importCapability();
    const inApp = /^https?:$/.test(location.protocol) && /127\.0\.0\.1|localhost|192\.168\.|10\./.test(location.host);
    const rows = [
      ['运行环境', location.origin + '（' + (inApp ? '应用内' : '浏览器') + '）'],
      ['原生文件通道', cap.nativeBridge
        ? (cap.nativeAnswered ? '可用（已握手）' : '已注入，等待首次使用')
        : '不可用（浏览器环境，将用系统选择器）'],
      ['系统文件选择器', cap.fileInput ? '可用' : '不可用'],
      ['粘贴导入', '始终可用']
    ];
    UI.sheet({
      title: '文件导入自检',
      body: (host) => {
        const list = U.el('div.list');
        rows.forEach(([k, v]) => {
          list.appendChild(U.el('div.row', {}, [
            U.el('div.row-main', {}, [
              U.el('div.row-title', { text: k }),
              U.el('div.row-sub', { text: v })
            ])
          ]));
        });
        U.append(host, [
          list,
          U.el('div.field-note', {
            style: { marginTop: '12px' },
            text: '如果「原生文件通道」显示不可用，说明装的是网页版或旧版 APK；'
              + '装 1.7.0 及以上的 APK 后，选文件会由应用直接读取，不依赖 WebView。'
              + '无论哪种情况，「粘贴文本」都能用。'
          }),
          U.el('button.btn.block', {
            style: { marginTop: '12px' },
            onclick: () => {
              const txt = rows.map(([k, v]) => k + '：' + v).join('\n');
              IO.copyText('selfwriting 导入自检\n' + txt);
              UI.toast('已复制自检信息', 'check');
            }
          }, [U.icon('copy', 'ico-sm'), U.el('span', { text: '复制自检信息' })])
        ]);
      }
    });
  };

  /* ---------------- 下载 / 选择文件 ---------------- */
  IO.download = function (filename, content, mime) {
    try {
      const blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (e) {
      console.error('[IO.download]', e);
      return false;
    }
  };

  /**
   * 选择文件。
   * 两个手机上的坑，都在这里统一处理：
   *  1) accept 里带 MIME 类型时，部分安卓文件管理器会**不显示** .epub/.mobi（它们
   *     常被标成 application/octet-stream），所以默认只给扩展名，必要时再加 MIME。
   *  2) 不能用 file.text() 去「预读」文件内容 —— 那是按 UTF-8 解文本，二进制格式
   *     （epub/pdf/mobi）会被解成乱码，导致「选了文件却说没能导入」。
   *     这里统一读成字节，交给 Parsers.decodeBytes / parseFile 自己判断编码与格式。
   */
  IO.pickFile = function (accept, multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || (global.Parsers ? global.Parsers.ACCEPT : '.txt,.md,.markdown,.json');
      input.multiple = !!multiple;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      let done = false;
      const finish = (files) => {
        if (done) return;
        done = true;
        setTimeout(() => { if (input.parentNode) input.parentNode.removeChild(input); }, 500);
        resolve(files || []);
      };
      const pick = (text, name) => {
        // 粘贴文本：包成与 File 等价的对象，复用同一条导入管线
        finish([{ name: name || '粘贴的文本.txt', text: String(text || '') }]);
      };
      input.addEventListener('change', () => {
        finish(Array.prototype.slice.call(input.files || []));
      });
      input.addEventListener('cancel', () => finish([]));
      try { input.click(); } catch (e) { finish([]); }
    });
  };

  /**
   * 「选任何文件」：安卓上专门用这个 —— 不带任何 accept 限制，
   * 因为文件管理器对 epub/mobi/pdf 的 MIME 标注五花八门，限制了反而选不到。
   */
  IO.pickAnyFile = function (multiple) {
    return IO.pickFile('', multiple);
  };

  /* ================================================================== */
  /* 安卓原生读文件通道                                                  */
  /* ================================================================== */
  /**
   * 为什么需要它：用户从系统选择器选到的常常是 content:// URI，
   * WebView 的 FileReader 在部分机型/文件管理器上读不出内容 ——
   * 表现就是「选了文件，却说没能导入这个文件」。
   * 壳里用 ContentResolver 直接把字节读出来（base64）交给网页，彻底绕开这一层。
   * 纯网页环境下 SWNative 不存在，自动退回标准 <input type="file">。
   */
  IO.nativeFilePicker = null;          // 由壳通过 __swNativeReady 注入
  let nativeReqSeq = 0;
  const nativePending = Object.create(null);
  let nativeSeen = false;              // 原生通道是否真的应答过

  function hasNativePicker() {
    return !!(global.SWNative && typeof global.SWNative.available === 'function'
      && typeof global.SWNative.pick === 'function');
  }

  /** 壳把选中的文件交回来（由 MainActivity.deliverFiles 调用） */
  global.__swNativeFiles = function (payload) {
    nativeSeen = true;
    if (!payload) return;
    const id = payload.id;
    const entry = nativePending[id];
    if (!entry) return;
    delete nativePending[id];
    clearTimeout(entry.timer);
    if (payload.error) { entry.reject(new Error(String(payload.error))); return; }
    const files = (payload.files || []).map((f) => {
      const bin = atob(f.b64 || '');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { name: f.name || '导入的文件', size: Number(f.size) || bytes.length, type: f.mime || '', bytes: bytes };
    });
    entry.resolve(files);
  };

  /** 壳注入完成后点名（网页侧据此标记通道可用） */
  global.__swNativeReady = function () { nativeSeen = true; };

  /**
   * 通过原生通道选文件。
   * 返回 Promise；**若原生接口没有任何应答，会自动 reject**，
   * 调用方（pickFilesSmart）据此立刻退回标准 <input>，不会出现「点了没反应」。
   */
  IO.pickFileNative = function (multiple) {
    if (!hasNativePicker()) return null;
    return new Promise((resolve, reject) => {
      const id = 'f' + (++nativeReqSeq) + '_' + Date.now();
      /* 8 秒内没有任何回调 → 判定原生通道没生效，让上层回退 */
      const timer = setTimeout(() => {
        if (!nativePending[id]) return;
        delete nativePending[id];
        reject(new Error('原生文件通道没有响应'));
      }, 8000);
      nativePending[id] = { resolve: resolve, reject: reject, timer: timer };
      try {
        global.SWNative.pick(id, multiple ? 1 : 0);
      } catch (e) {
        clearTimeout(timer);
        delete nativePending[id];
        reject(e);
      }
    }).then((files) => {
      /* 空数组 = 用户主动取消，不是失败：原样返回，别触发回退 */
      if (!files.length) return [];
      return files.map((f) => ({ name: f.name, size: f.size, type: f.type, bytes: f.bytes, _picked: true }));
    });
  };

  /**
   * 统一的「选文件」入口。
   * 顺序：原生通道 → 失败就退回标准 <input type="file">。
   * 两个都试过还选不到，就抛错让界面提示可改用「粘贴文本」。
   */
  IO.pickFilesSmart = function (multiple) {
    const native = IO.pickFileNative(multiple);
    if (!native) return IO.pickFile('', multiple);
    return native.catch((e) => {
      console.warn('[import] 原生文件通道不可用，改用系统选择器：', e && e.message);
      return IO.pickFile('', multiple).then((files) => {
        /* 标准通道也拿不到文件时，把两种失败原因合并抛出，便于定位 */
        if (!files || !files.length) {
          const err = new Error('没能从系统选择器拿到文件（' + (e && e.message || e) + '）');
          throw err;
        }
        return files;
      });
    });
  };

  /** 让用户知道这台设备上文件导入是否可用（诊断面板用） */
  IO.importCapability = function () {
    return {
      nativeBridge: hasNativePicker(),
      nativeAnswered: nativeSeen,
      fileInput: typeof document !== 'undefined' && 'File' in global && typeof FileReader !== 'undefined',
      clipboard: !!(global.navigator && navigator.clipboard)
    };
  };

  /* ================================================================== */
  /* 联网下载书籍                                                        */
  /* ================================================================== */
  /**
   * 从网址下载一本书（TXT / EPUB / MOBI / PDF 都行）。
   * 网页直接 fetch 外部地址会被跨域策略拦死，所以统一走本机代理：
   *   - 安卓壳：LocalServer 的 /__fetch
   *   - 网页版：server.js 的 /__fetch
   * 代理只允许 http/https，并限制体积。
   */
  IO.proxyFetch = function (url) {
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) {
      return Promise.reject(new Error('请填完整网址，以 http:// 或 https:// 开头'));
    }
    const endpoint = location.origin + '/__fetch?url=' + encodeURIComponent(target);
    return fetch(endpoint, { cache: 'no-store' }).then((r) => {
      if (!r.ok) return r.text().then((t) => { throw new Error(t || ('下载失败 HTTP ' + r.status)); });
      return r.arrayBuffer();
    }).then((buf) => new Uint8Array(buf));
  };

  /** 从网址猜文件名（拿不到就用书名兜底） */
  IO.nameFromUrl = function (url) {
    try {
      const p = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
      const name = decodeURIComponent(p);
      if (name && /\.[a-z0-9]{2,6}$/i.test(name)) return name;
      return (name || '下载的书') + '.txt';
    } catch (e) { return '下载的书.txt'; }
  };

  /**
   * 下载并导入成读物。
   * opt: { url, title, author, category, split, onProgress }
   */
  IO.downloadBook = function (opt) {
    const o = opt || {};
    const name = IO.nameFromUrl(o.url);
    const lower = name.toLowerCase();
    const isBinary = global.Parsers && global.Parsers.isBinary(lower);
    return IO.proxyFetch(o.url).then((bytes) => {
      if (o.onProgress) o.onProgress('已下载 ' + (bytes.length / 1024).toFixed(0) + ' KB，正在解析…');
      const file = { name: name, size: bytes.length, type: '', bytes: bytes };
      const read = isBinary
        ? (() => {
          const book = global.Parsers.parseFile(file, bytes);
          return {
            name: name, baseName: String(name).replace(/\.[^.]+$/, ''),
            docTitle: book.title || '', author: book.author || '',
            chapters: book.chapters, note: book.note || ''
          };
        })()
        : (() => {
          const text = global.Parsers ? global.Parsers.decodeBytes(bytes) : '';
          const plain = /\.html?$/i.test(lower) && global.Parsers ? global.Parsers.htmlToText(text) : text;
          return {
            name: name, baseName: String(name).replace(/\.[^.]+$/, ''),
            text: plain.replace(/^\uFEFF/, ''),
            encoding: global.Parsers && global.Parsers.detectEncoding ? global.Parsers.detectEncoding(bytes) : '',
            chapters: U.splitChapters(plain, o.split || 'auto'),
            docTitle: '', author: '', note: ''
          };
        })();
      if (!read.chapters || !read.chapters.length) {
        throw new Error('下载到了内容，但没能分出章节（可能是图片版 PDF 或加密文件）');
      }
      const isMd = /\.md$/i.test(lower);
      const book = Store.createBook({
        title: o.title || read.docTitle || read.baseName || '下载的读物',
        author: o.author || read.author || '',
        category: o.category || '其它',
        source: 'download',
        url: o.url,
        countAchievements: false,
        format: isMd ? 'md' : 'txt',
        chapters: read.chapters.map((c, i) => {
          const body = c.content || '';
          const ch = { id: U.uid('bc'), title: c.title || ('第 ' + (i + 1) + ' 节'), content: body, words: U.estimateWords(body) };
          if (isMd) { try { ch.html = U.mdToHtml(body); } catch (e) { ch.html = null; } }
          return ch;
        })
      });
      Store.recomputeBook(Store.findBook(book.id));
      return Store.flushNow().then(() => ({
        ok: true,
        book: { id: book.id, title: book.title, chapters: read.chapters.length },
        encoding: read.encoding || ''
      }));
    });
  };

  /** 复制文本到剪贴板（失败时退化为让用户手动选） */  IO.copyText = function (text) {
    const t = String(text || '');
    try {
      if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).catch(() => IO._fallbackCopy(t));
        return true;
      }
    } catch (e) { /* 落到兜底 */ }
    IO._fallbackCopy(t);
    return false;
  };
  IO._fallbackCopy = function (t) {
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { /* 真不行就让用户手动复制 */ }
  };

  /**
   * 粘贴文本导入：不依赖系统文件选择器。
   * 手机上的文件管理器千奇百怪，这条路作为兜底。
   * kind: novel | article | diary | reading
   */
  IO.importFromText = function (kind, text, opt) {
    return IO.importText(kind, [{ name: (opt && opt.name) || '粘贴的文本.txt' }], Object.assign({ textOverride: text }, opt || {}));
  };

  const safeName = (s) => String(s || '未命名').replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 60);

  /** 把文件的关键信息整理成一行诊断（失败提示里带上，便于定位） */
  function describeFile(f) {
    const name = (f && f.name) || '(未命名)';
    const lower = String(name).toLowerCase();
    const ext = (lower.match(/\.([a-z0-9]+)$/) || [, ''])[1];
    const size = (f && typeof f.size === 'number') ? f.size : -1;
    const type = (f && f.type) || '未知 MIME';
    const KIND = {
      epub: 'EPUB 电子书', mobi: 'MOBI 电子书', azw: 'AZW 电子书', azw3: 'AZW3 电子书',
      prc: 'PRC 电子书', pdf: 'PDF 文档', txt: '纯文本', md: 'Markdown',
      markdown: 'Markdown', html: 'HTML 网页', htm: 'HTML 网页'
    };
    return {
      ext: ext,
      kind: KIND[ext] || (ext ? ext.toUpperCase() + ' 文件' : '未知类型文件'),
      line: '文件：' + name + ' · ' + (size >= 0 ? U.fmtBytes(size) : '大小未知')
        + ' · ' + type + (ext ? ' · .' + ext : ' · 无扩展名')
    };
  }
  const nowStamp = () => {
    const d = new Date();
    return d.getFullYear() + U.pad(d.getMonth() + 1) + U.pad(d.getDate()) + '-' + U.pad(d.getHours()) + U.pad(d.getMinutes());
  };

  /* ---------------- 纯文本 / Markdown 渲染 ---------------- */
  function novelToText(novel, opt) {
    const o = opt || {};
    const lines = [];
    lines.push(novel.title || '未命名小说');
    const meta = [];
    if (novel.author) meta.push('作者：' + novel.author);
    if (novel.category) meta.push(novel.category);
    meta.push('共 ' + (novel.chapters || []).length + ' 章 · ' + U.fmtInt(Store.novelWords(novel)) + ' 字');
    lines.push(meta.join(' · '));
    if (novel.intro) { lines.push(''); lines.push('【简介】'); lines.push(novel.intro); }
    lines.push('');
    (novel.chapters || []).forEach((c, i) => {
      lines.push('');
      lines.push(c.title || ('第' + (i + 1) + '章'));
      lines.push('');
      if ((c.content || '').trim()) lines.push(c.content.trim());
      (c.sections || []).forEach((s) => {
        lines.push('');
        lines.push('§ ' + (s.title || '小节'));
        lines.push('');
        lines.push((s.content || '').trim());
      });
    });
    return lines.join('\n');
  }

  function novelToMarkdown(novel) {
    const lines = [];
    lines.push('# ' + (novel.title || '未命名小说'));
    const meta = [];
    if (novel.author) meta.push('作者：' + novel.author);
    meta.push('共 ' + (novel.chapters || []).length + ' 章 · ' + U.fmtInt(Store.novelWords(novel)) + ' 字');
    lines.push('');
    lines.push('> ' + meta.join(' · '));
    if (novel.intro) { lines.push(''); lines.push('## 简介'); lines.push(''); lines.push(novel.intro); }
    (novel.chapters || []).forEach((c, i) => {
      lines.push('');
      lines.push('## ' + (c.title || ('第' + (i + 1) + '章')));
      lines.push('');
      if ((c.content || '').trim()) lines.push(c.content.trim());
      (c.sections || []).forEach((s) => {
        lines.push('');
        lines.push('### ' + (s.title || '小节'));
        lines.push('');
        lines.push((s.content || '').trim());
      });
    });
    return lines.join('\n');
  }

  /** 大纲文本（缩进树，带颜色/重点/关联标注） */
  IO.outlineToText = function (nodes, opt) {
    const o = opt || {};
    const lines = [];
    const walk = (list, depth) => {
      (list || []).forEach((n) => {
        const marks = [];
        if (n.important) marks.push('★重点');
        if (n.colorName) marks.push('#' + n.colorName);
        if (n.linkChapterTitle || n.linkTitle) marks.push('→ ' + (n.linkChapterTitle || n.linkTitle));
        const text = String(n.text || '').replace(/\n/g, ' ').trim() || '（空节点）';
        lines.push('  '.repeat(depth) + (depth === 0 ? '■ ' : (n.children && n.children.length ? '├ ' : '· ')) + text + (marks.length ? '   [' + marks.join(' ') + ']' : ''));
        walk(n.children, depth + 1);
      });
    };
    if (o.title) { lines.push('# ' + o.title); lines.push(''); }
    walk(nodes, 0);
    if (!lines.length || (lines.length === 2 && o.title)) lines.push('（暂无大纲）');
    return lines.join('\n');
  };

  function diaryToText(book, opt) {
    const o = opt || {};
    const lines = [];
    lines.push(book.title || '日记');
    lines.push('共 ' + (book.entries || []).length + ' 篇 · ' + U.fmtInt(Store.diaryWords(book)) + ' 字');
    lines.push('');
    const entries = (book.entries || []).slice().sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
    entries.forEach((e) => {
      lines.push('────── ' + e.dateKey + ' ' + U.weekdayCN(e.dateKey) + ' ──────');
      const tags = [];
      if (e.mood) tags.push('心情：' + e.mood);
      if (e.weather) tags.push('天气：' + e.weather);
      if ((e.tags || []).length) tags.push(e.tags.map((t) => '#' + t).join(' '));
      if (tags.length) lines.push(tags.join(' · '));
      if (e.title) lines.push('【' + e.title + '】');
      lines.push((e.content || '').trim());
      if ((e.images || []).length) lines.push('（含 ' + e.images.length + ' 张图片，图片不随文本导出）');
      lines.push('');
    });
    return lines.join('\n');
  }

  function articleToText(a) {
    return [a.title || '未命名文章', (a.tags || []).map((t) => '#' + t).join(' '), '', (a.content || '').trim()].filter((x) => x !== null).join('\n');
  }

  /* ---------------- 导出入口 ---------------- */
  /** 任意条目 → 文本 */
  IO.toText = function (kind, item) {
    if (kind === 'novel') return novelToText(item);
    if (kind === 'novel-md') return novelToMarkdown(item);
    if (kind === 'article') return articleToText(item);
    if (kind === 'diaryBook') return diaryToText(item);
    if (kind === 'outline') return IO.outlineToText(item.outline, { title: item.title });
    return '';
  };

  IO.exportItem = function (kind, item, fmt) {
    const t = fmt || 'txt';
    const name = safeName(item.title) + '-' + nowStamp();
    if (t === 'md') {
      const md = kind === 'novel' ? novelToMarkdown(item)
        : kind === 'article' ? '# ' + (item.title || '') + '\n\n' + (item.content || '')
        : kind === 'diaryBook' ? '# ' + (item.title || '日记') + '\n\n' + diaryToText(item)
        : IO.outlineToText(item.outline, { title: item.title });
      return IO.download(name + '.md', md, 'text/markdown');
    }
    if (t === 'json') {
      return IO.download(name + '.json', JSON.stringify({ app: 'selfwriting', version: 1, kind: kind, item: item }, null, 2), 'application/json');
    }
    return IO.download(name + '.txt', IO.toText(kind, item), 'text/plain');
  };

  /** 导出某一章 */
  IO.exportChapter = function (novel, chapter, fmt) {
    const name = safeName(novel.title) + '-' + safeName(chapter.title) + '-' + nowStamp();
    let content;
    if (fmt === 'md') {
      content = '# ' + (chapter.title || '') + '\n\n' + (chapter.content || '').trim();
      (chapter.sections || []).forEach((s) => { content += '\n\n## ' + (s.title || '小节') + '\n\n' + (s.content || '').trim(); });
    } else {
      content = (chapter.title || '') + '\n\n' + (chapter.content || '').trim();
      (chapter.sections || []).forEach((s) => { content += '\n\n§ ' + (s.title || '小节') + '\n\n' + (s.content || '').trim(); });
    }
    return IO.download(name + (fmt === 'md' ? '.md' : '.txt'), content, fmt === 'md' ? 'text/markdown' : 'text/plain');
  };

  /* ---------------- 导入文本 ---------------- */
  /**
   * 导入文本为条目。
   * kind: novel | article | diary | reading
   *
   * 导入的内容一律标记 countAchievements = false：
   * 别人的作品、外部文本不应该因为「导入」这个动作就刷出成就与解锁提示。
   * 用户之后可以手动把某一本改成「计入成就」。
   * 返回 Promise<{ok, items, message}>
   */
  /** 让出主线程一拍，使进度提示能刷新（导入大文件时避免界面像卡死） */
  const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

  IO.importText = function (kind, files, opt) {
    const o = opt || {};
    const list = Array.isArray(files) ? files : [files];
    // 批量导入：期间挂起自动落盘，结束后一次性提交；每个文件之间让出主线程，
    // 这样进度提示能刷新、界面不会像卡死（大文件导入是关键路径）
    if (Store.beginBatch) Store.beginBatch();
    const onProgress = typeof o.onProgress === 'function' ? o.onProgress : null;
    /* 阶段进度：读取 / 解析 / 建条目 / 落盘，各自报一次，让遮罩上的文字动起来 */
    const onStage = typeof o.onStage === 'function' ? o.onStage : null;
    const stage = (text, pct) => { if (onStage) { try { onStage(text, pct); } catch (e) { /* noop */ } } };
    // textOverride：直接把文本交给导入管线（粘贴导入 / 文件读取失败时兜底）
    // 二进制格式（epub/mobi/pdf）交给 Parsers 解析成章节
    const readOne = (f) => {
      if (o.textOverride !== undefined && o.textOverride !== null) {
        const t = String(o.textOverride);
        return Promise.resolve({
          name: f.name || '粘贴的文本.txt', text: t, baseName: '粘贴的文本',
          chapters: U.splitChapters(t, 'auto'), docTitle: '', author: '', note: ''
        });
      }
      const lower = String(f.name || '').toLowerCase();
      const kindPost = /\.md$/i.test(lower) ? 'md' : /\.html?$/i.test(lower) ? 'html' : '';
      const isBinary = global.Parsers && global.Parsers.isBinary(lower);
      /* 文件档案：失败提示里带上，方便定位「为什么这个文件不行」 */
      const meta = describeFile(f);
      /* 原生通道已经把字节读好了（content:// 在 WebView 里读不出来的问题），
         这里就不再重复读取；纯网页环境才走读取。 */
      const getBytes = () => (f && f.bytes) ? Promise.resolve(f.bytes) : U.readFileAsArrayBuffer(f);

      if (isBinary) {
        return getBytes().then((buf) => {
          let book;
          try {
            book = global.Parsers.parseFile(f, buf);
          } catch (pe) {
            const e = new Error('这个 ' + (meta.kind || '文件') + ' 解析不了：' + (pe && pe.message || pe)
              + '\n' + meta.line + '\n（文件本身没问题的话，可能是加密或非标准格式）');
            e.importDiag = meta.line;
            throw e;
          }
          if (!book.chapters || !book.chapters.length) {
            const e = new Error('解析成功但没提取到内容\n' + meta.line);
            e.importDiag = meta.line;
            throw e;
          }
          return {
            name: f.name, baseName: String(f.name).replace(/\.[^.]+$/, ''),
            docTitle: book.title || '', author: book.author || '',
            chapters: book.chapters, note: book.note || '', format: ''
          };
        }).catch((e) => ({
          name: f.name,
          error: String(e && e.message || e),
          diag: (e && e.importDiag) || meta.line,
          chapters: []
        }));
      }
      return getBytes().then((buf) => {
        const text = global.Parsers ? global.Parsers.decodeBytes(buf) : '';
        // HTML 先转纯文本
        const plain = (kindPost === 'html' && global.Parsers) ? global.Parsers.htmlToText(text) : text;
        const encoding = global.Parsers && global.Parsers.detectEncoding ? global.Parsers.detectEncoding(buf) : '';
        if (!plain || !plain.trim()) {
          const e = new Error('按 ' + (encoding || '未知') + ' 解码后是空的\n' + meta.line);
          e.importDiag = meta.line;
          throw e;
        }
        return {
          name: f.name, text: plain.replace(/^\uFEFF/, ''),
          baseName: String(f.name || '').replace(/\.[^.]+$/, ''),
          /* 记录识别出的编码：导入结果里会显示，方便排查「导入后是空白」 */
          encoding: encoding,
          chapters: U.splitChapters(plain, o.split || 'auto'),
          docTitle: '', author: '', note: '', format: kindPost === 'html' ? '' : kindPost
        };
      }).catch((e) => ({
        name: f.name,
        error: String(e && e.message || e),
        diag: (e && e.importDiag) || meta.line,
        chapters: []
      }));
    };
    return Promise.all(list.map(readOne))
      .then(async (read) => {
        const made = [];
        const skipped = [];
        const diagnostics = [];
        /* 读取完成 → 进入解析/建条目阶段 */
        stage(files.length + ' 个文件已读取，正在整理章节…', 0.4);
        await yieldToUI();
        for (let fi = 0; fi < read.length; fi++) {
          const r = read[fi];
          if (onProgress) onProgress(fi, read.length, r.name);
          await yieldToUI();
          /* 单个文件失败不再让整批导入失败：记下来，其余文件照常导入。
             同时把「文件档案」收进 diagnostics，便于用户反馈时一眼定位。 */
          if (r.error) {
            skipped.push(r.name + '：' + r.error);
            diagnostics.push({ name: r.name, reason: r.error, detail: r.diag || '' });
            continue;
          }
          if (!r.chapters || !r.chapters.length) {
            skipped.push(r.name + '：没有提取到内容');
            diagnostics.push({ name: r.name, reason: '没有提取到内容', detail: r.diag || '' });
            continue;
          }
          const text = r.text || '';
          const baseName = r.baseName || String(r.name || '').replace(/\.[^.]+$/, '');
          if (kind === 'novel') {
            const chapters = r.chapters;
            const first = chapters[0] || { title: baseName, content: '' };
            const novel = Store.createNovel({
              // 有书内元数据时优先用它（EPUB/MOBI 的标题、作者比文件名可靠）
              title: o.title || r.docTitle || baseName || first.title || '导入的小说',
              intro: o.intro || (r.author ? '作者：' + r.author : ''),
              category: o.category || '未分类',
              countAchievements: false            // 导入不计入成就
            });
            const n = Store.findNovel(novel.id);
            n.countAchievements = false;
            n.chapters = chapters.map((c, i) => Store.newChapterObject({ title: c.title, content: c.content, index: i + 1, goal: null }));
            Store.commit((s) => { Store.recomputeNovel(Store.findNovel(novel.id)); }, { kind: 'import' });
            made.push({ kind: 'novel', id: novel.id, title: novel.title, chapters: n.chapters.length, encoding: r.encoding || '' });
          } else if (kind === 'article') {
            const a = Store.createArticle({ title: baseName || '导入的文章', category: o.category || '随笔' });
            const art = Store.findArticle(a.id);
            art.countAchievements = false;        // 导入不计入成就
            Store.setArticleContent(a.id, text.trim());
            Store.commit(null, { kind: 'import' });
            made.push({ kind: 'article', id: a.id, title: a.title, encoding: r.encoding || '' });
          } else if (kind === 'diary') {
            const parts = splitDiaryText(text);
            const book = o.bookId ? Store.findDiary(o.bookId) : null;
            if (book) {
              parts.forEach((p) => Store.addDiaryEntry(book.id, { content: p.content, dateKey: p.dateKey, title: p.title }));
              made.push({ kind: 'diary', id: book.id, title: book.title, entries: parts.length });
            } else {
              const bk = Store.createDiaryBook({ title: baseName || '导入的日记', kind: o.diaryKind || 'daily' });
              const full = Store.findDiary(bk.id);
              full.countAchievements = false;     // 导入不计入成就
              parts.forEach((p) => Store.addDiaryEntry(bk.id, { content: p.content, dateKey: p.dateKey, title: p.title }));
              made.push({ kind: 'diary', id: bk.id, title: bk.title, entries: parts.length });
            }
          } else if (kind === 'reading') {
            const isMd = /\.md$/i.test(r.name) || /\.markdown$/i.test(r.name);
            const chapters = isMd ? U.splitChapters(text, o.split === 'none' ? 'none' : 'auto') : r.chapters;
            const book = Store.createBook({
              title: o.title || r.docTitle || baseName || '导入的读物',
              author: o.author || r.author || '',
              category: o.category || '其它',
              source: 'import',
              countAchievements: false,           // 导入不计入成就（可在读物菜单里改）
              format: o.split === 'none' ? 'txt' : (isMd ? 'md' : 'txt'),
              chapters: chapters.map((c, i) => {
                const body = c.content || '';
                const ch = { id: U.uid('bc'), title: c.title || ('第 ' + (i + 1) + ' 节'), content: body, words: U.estimateWords(body) };
                // Markdown 在导入时就解析好：否则每次打开都要重新解析整本书，
                // 大文件（几百 KB）会让打开动作卡好几秒
                if (isMd) {
                  try { ch.html = U.mdToHtml(body); } catch (e) { ch.html = null; }
                }
                return ch;
              })
            });
            // 用估算字数，精确值由后台逐步校正（导入几 MB 时不卡界面）
            book.words = chapters.reduce((s, c) => s + U.estimateWords(c.content || ''), 0);
            Store.markDirty();
            made.push({
              kind: 'book', id: book.id, title: book.title,
              chapters: chapters.length, note: r.note || '',
              encoding: r.encoding || '',
              countAchievements: book.countAchievements
            });
          }
        }
        if (onProgress) onProgress(read.length, read.length, '');
        /* 批量结束：一次性落盘 + 一次成就检查 */
        stage('正在保存到本机…', 0.9);
        await yieldToUI();
        if (Store.endBatch) Store.endBatch();
        else Store.flushNow();
        if (global.Ach) global.Ach.evaluate(Store.state, true);
        stage('完成', 1);
        return { ok: true, items: made, count: made.length, skipped: skipped, diagnostics: diagnostics };
      })
      .catch((e) => {
        if (Store.endBatch) Store.endBatch();
        return { ok: false, error: String(e && e.message || e), items: [] };
      });
  };

  /** 从 txt/md 中拆出多篇日记（按日期行分段） */
  function splitDiaryText(text) {
    const src = String(text || '').replace(/\r\n?/g, '\n');
    const lines = src.split('\n');
    const dateRe = /^\s*[#>*\-\s]*(?:(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?|\-\-\-+\s*(\d{4})-(\d{1,2})-(\d{1,2}))/;
    const blocks = [];
    let cur = null;
    lines.forEach((l) => {
      const m = dateRe.exec(l);
      if (m) {
        if (cur) blocks.push(cur);
        const y = m[1] || m[4], mo = m[2] || m[5], d = m[3] || m[6];
        cur = { dateKey: y + '-' + U.pad(Number(mo)) + '-' + U.pad(Number(d)), title: '', lines: [] };
      } else if (cur) {
        cur.lines.push(l);
      } else {
        if (!blocks.length && l.trim()) { cur = { dateKey: U.dateKey(), title: '', lines: [] }; cur.lines.push(l); }
      }
    });
    if (cur) blocks.push(cur);
    if (!blocks.length) blocks.push({ dateKey: U.dateKey(), title: '', lines: lines });
    if (blocks.length === 1 && !/^\s*(\d{4})/.test(src)) {
      // 没有日期信息：按空行切成多篇，日期从今天往前推
      const chunks = src.split(/\n\s*\n\s*\n/).map((s) => s.trim()).filter(Boolean);
      if (chunks.length > 1) {
        return chunks.map((c, i) => ({ dateKey: U.shiftDate(U.dateKey(), -(chunks.length - 1 - i)), title: '', content: c }));
      }
    }
    return blocks.map((b) => {
      const content = b.lines.join('\n').trim();
      const firstLine = content.split('\n')[0] || '';
      const isTitle = /^[【\[](.+)[】\]]$/.test(firstLine.trim()) && firstLine.length < 40;
      return {
        dateKey: b.dateKey,
        title: isTitle ? firstLine.trim().replace(/^[【\[]|[】\]]$/g, '') : '',
        content: isTitle ? content.split('\n').slice(1).join('\n').trim() : content
      };
    });
  }

  /* ---------------- 整库备份 ---------------- */
  IO.backupAll = function () {
    return global.DB.exportAll(Store.state).then((payload) => {
      IO.download('selfwriting-备份-' + nowStamp() + '.json', JSON.stringify(payload), 'application/json');
      return true;
    });
  };

  IO.restoreAll = function (file, mode) {
    return U.readFileAsText(file).then((text) => {
      let payload;
      try { payload = JSON.parse(text); } catch (e) { throw new Error('文件不是有效的 JSON'); }
      if (Store.beginBatch) Store.beginBatch();
      return global.DB.importAll(payload, mode).then((importedState) => {
        if (mode === 'replace') {
          Store.replaceAll(importedState);
        } else {
          Store.mergeImport(importedState);
        }
        if (Store.endBatch) Store.endBatch(); else Store.flushNow();
        if (global.Ach) global.Ach.evaluate(Store.state, true);
        return { ok: true, mode: mode };
      }).catch((e) => {
        if (Store.endBatch) Store.endBatch();
        throw e;
      });
    });
  };

  /* ---------------- 阅读素材导入（增强） ---------------- */
  IO.importReading = function (files, opt) {
    return IO.importText('reading', files, opt);
  };

  global.IOApi = IO;
})(window);
