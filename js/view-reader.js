/* ==========================================================================
   selfwriting · view-reader.js
   内置阅读器：导入 TXT / Markdown / EPUB / MOBI / PDF，目录、进度、书签、
   字体行距、亮度与屏幕亮度，全部离线。

   v2（本次升级）：
     · 书架：单列 / 双列视图切换 + 封面宽度可调（存 Store 设置，立即重排）
     · 书架：书名旁的收藏爱心（点亮 / 熄灭，Store.toggleLike）+「收藏」筛选
     · 阅读页：点正文让顶部栏与底部阅读条「落下 / 收起」，进入专注阅读
     · 翻页方式：连续滚动 / 整页翻页 / 滑动翻页（设置里与阅读操作里都能切）
     · 书签：按钮点亮、章标题左侧丝带、目录行与侧边进度条上的书签刻度
     · 章节数始终显示（含 0 章 / 1 章），字数上万用「万」（U.fmtWords）

   与创作模块完全隔离，不参与创作类成就（只统计阅读时长与阅读字数）
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const UI = global.UI;
  const Store = global.Store;
  const IO = global.IOApi;
  const Stats = global.Stats;
  const T = global.Taxonomy;      // 读物类型分类
  const RV = {};

  /* ================================================================== */
  /* 常量与小工具                                                      */
  /* ================================================================== */
  /* 翻页方式：scroll 连续滚动 / page 整页翻页 / slide 滑动翻页 / curl 仿真卷曲 / fade 柔和叠化 */
  const PAGE_MODES = [
    { id: 'scroll', label: '连续滚动', sub: '上下滑动连着读，像网页一样' },
    { id: 'page', label: '整页翻页', sub: '新页从侧面压上来，旧页不动' },
    { id: 'slide', label: '滑动翻页', sub: '两层一起横向平移，像画廊' },
    { id: 'curl', label: '仿真翻页', sub: '书页跟着手指卷起，折痕有明暗，推荐', rec: true },
    { id: 'fade', label: '柔和叠化', sub: '旧页淡出、新页淡入并回正，最安静的换页' }
  ];
  const COVER_MIN = 56;
  const COVER_MAX = 180;
  const COVER_DEFAULT = 108;

  /** 当前是不是「英文界面」（U.pick 的第二参数由词典负责，这里只做兜底） */
  function pick(zh, en) { return U.pick(zh, en); }

  function modeLabel(id) {
    const hit = PAGE_MODES.filter((m) => m.id === id)[0];
    return hit ? hit.label : PAGE_MODES[0].label;
  }
  function normMode(id) {
    return PAGE_MODES.some((m) => m.id === id) ? id : 'scroll';
  }

  /** 章节数：0 章 / 1 章 也要显示出来，不能留空 */
  function chapterCount(b) {
    return Array.isArray(b && b.chapters) ? b.chapters.length : 0;
  }
  function chapterLabel(b) { return chapterCount(b) + ' 章'; }
  /** 字数统一走 U.fmtWords：上万自动变「万」 */
  function wordsText(n) { return U.fmtWords(Number(n) || 0); }

  /** 从设置里读阅读器配置（老数据可能缺键，全部给默认值） */
  function shelfConfig() {
    const s = (Store.state && Store.state.settings) || {};
    return {
      cols: Number(s.readerCols) === 2 ? 2 : 1,
      coverWidth: U.clamp(Math.round(Number(s.readerCoverWidth) || COVER_DEFAULT), COVER_MIN, COVER_MAX),
      mode: normMode(s.readerPageMode),
      tapMenu: s.readerTapMenu !== false
    };
  }

  /* 爱心图标：util.js 的图标表里没有 heart，就地画一个（离线，纯 SVG） */
  const HEART_PATH = 'M12 20.4l-1.5-1.35C5.1 14.2 2 11.5 2 8.2 2 5.5 4.2 3.3 6.9 3.3c1.6 0 3.1.74 4.1 1.9 1-1.16 2.5-1.9 4.1-1.9 2.7 0 4.9 2.2 4.9 4.9 0 3.3-3.1 6-8.5 10.85L12 20.4z';
  function heartIcon(on) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'ico rv-heart-ico' + (on ? ' on' : ''));
    svg.setAttribute('fill', on ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', HEART_PATH);
    svg.appendChild(p);
    return svg;
  }

  /** 书名 -> 色相（没有封面的书按书名生成一枚稳定颜色的封面） */
  function titleHue(title) {
    const s = String(title || '');
    let h = 17;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  /**
   * 封面：有图就用图（本机 dataURL），没有就用 CSS 渐变 + 书名画一个。
   * 宽度由外层容器的 --rv-cover-w 控制，拖「封面宽度」时不用重建 DOM。
   */
  function coverEl(b) {
    const wrap = U.el('div.rv-cover');
    const src = typeof b.cover === 'string' ? b.cover : '';
    if (src) {
      wrap.classList.add('rv-cover-photo');
      wrap.appendChild(U.el('img', { src: src, alt: '' }));
      return wrap;
    }
    const h = titleHue(b.title);
    wrap.classList.add('rv-cover-gen');
    wrap.style.background = 'linear-gradient(158deg, hsl(' + h + ', 44%, 56%), hsl(' + ((h + 32) % 360) + ', 40%, 32%))';
    wrap.appendChild(U.el('div.rv-cover-spine'));
    wrap.appendChild(U.el('div.rv-cover-text', { text: U.excerpt(b.title || '未命名读物', 9) }));
    wrap.appendChild(U.el('div.rv-cover-tag', { text: chapterLabel(b) }));
    return wrap;
  }

  /* ---- 收藏爱心（书架卡片 / 书本菜单 / 阅读页顶栏共用）---- */
  function paintHeart(btn, on) {
    const old = btn.querySelector('svg');
    const fresh = heartIcon(on);
    if (old) btn.replaceChild(fresh, old);
    else btn.insertBefore(fresh, btn.firstChild);
    const label = btn.querySelector('.rv-like-label');
    if (label) label.textContent = on ? '已收藏' : '收藏';
    btn.classList.toggle('on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
    btn.setAttribute('title', on ? '取消收藏' : '收藏');
  }

  function likeButton(book, variant) {
    const btn = U.el('button.rv-like.rv-like-' + (variant || 'sm'), {
      'data-rv': 'like',
      dataset: { book: book.id },
      'aria-label': '收藏',
      'aria-pressed': 'false',
      onclick: (e) => { e.stopPropagation(); e.preventDefault(); toggleLike(book); }
    }, [
      heartIcon(false),
      variant === 'wide' ? U.el('span.rv-like-label', { text: '收藏' }) : null
    ]);
    paintHeart(btn, Store.isLiked(book.id));
    return btn;
  }

  /** 点亮 / 熄灭所有同一本书的爱心（书架卡片 + 菜单 + 阅读页顶栏） */
  function toggleLike(book) {
    const on = Store.toggleLike(book.id);
    U.$$('.rv-like[data-book="' + book.id + '"]').forEach((b) => paintHeart(b, on));
    UI.toast(on ? '已收藏「' + (book.title || '') + '」' : '已取消收藏', on ? 'star' : 'close');
    /* 正在按「收藏」筛选时，取消收藏要把卡片收走 */
    if (shelfFilter === 'liked' && !on) UI.render();
    return on;
  }

  /* ================================================================== */
  /* 书架（阅读列表）                                                  */
  /* ================================================================== */
  let shelfFilter = 'all';        // all | liked —— 只影响当前这次打开，不写进设置

  UI.route('reader', function (view) {
    const st = Store.state;
    const cfg = shelfConfig();
    const books = (st.reading || []).slice()
      .sort((a, b) => (b.lastReadAt || b.createdAt) - (a.lastReadAt || a.createdAt));
    UI.setTitle('阅读', '');
    UI.setSub('');

    const readingMs = ((((st.stats || {}).modules || {}).reading || {}).ms) || 0;
    U.append(view, U.el('div.card', {}, [
      U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        U.icon('reader'),
        U.el('div', { style: { flex: '1 1 auto' } }, [
          U.el('div', { text: '我的阅读器', style: { fontWeight: '650', fontSize: '15px' } }),
          U.el('div', { text: '导入想看的文章或小说，离线阅读 · 亮度与字数目标互不干扰', style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px' } })
        ])
      ]),
      U.el('div', { style: { display: 'flex', gap: '14px', marginTop: '12px', fontSize: '12px', color: 'var(--text-3)' } }, [
        U.el('span', { text: books.length + ' 本' }),
        U.el('span', { text: pick('阅读时长 ' + U.fmtDuration(readingMs / 60000, { short: true }), 'Reading time ' + U.fmtDuration(readingMs / 60000, { short: true })) }),
        U.el('span', { text: wordsText(books.reduce((s, b) => s + Store.bookWords(b), 0)) })
      ]),
      U.el('div.grid2', { style: { marginTop: '12px' } }, [
        U.el('button.btn.primary', { onclick: () => importFlow() }, [U.icon('up', 'ico-sm'), U.el('span', { text: '导入文本' })]),
        U.el('button.btn', { onclick: () => readingSettings() }, [U.icon('text', 'ico-sm'), U.el('span', { text: '阅读设置' })])
      ])
    ]));

    if (!books.length) {
      U.append(view, UI.empty('reader', '阅读器还是空的', '支持 TXT 与 Markdown，自动识别章节。导入后即可离线阅读。', { label: '导入文章', onClick: () => importFlow() }));
      return;
    }

    /* ---- 视图切换（单列 / 双列）、封面宽度、收藏筛选 ---- */
    const likedCount = books.filter((b) => Store.isLiked(b.id)).length;
    const listHost = U.el('div.rv-shelf-list');
    listHost.style.setProperty('--rv-cover-w', cfg.coverWidth + 'px');

    const rangeVal = U.el('span.rv-range-val', { text: cfg.coverWidth + 'px' });
    const range = U.el('input.rv-range', {
      type: 'range', min: String(COVER_MIN), max: String(COVER_MAX), step: '2',
      value: String(cfg.coverWidth), 'data-rv': 'cover-range', 'aria-label': '封面宽度'
    });
    /* 拖动时立刻改 CSS 变量（所有封面即时变宽/变窄），落盘做防抖 */
    const persistCover = U.debounce((w) => Store.setSetting('readerCoverWidth', w), 260);
    function applyCoverWidth(w, persist) {
      const width = U.clamp(Math.round(Number(w) || COVER_DEFAULT), COVER_MIN, COVER_MAX);
      listHost.style.setProperty('--rv-cover-w', width + 'px');
      rangeVal.textContent = width + 'px';
      if (persist === false) return width;
      if (persist === 'now') { persistCover.cancel(); Store.setSetting('readerCoverWidth', width); }
      else persistCover(width);
      return width;
    }
    range.addEventListener('input', () => applyCoverWidth(range.value));
    range.addEventListener('change', () => applyCoverWidth(range.value, 'now'));

    function segBtn(label, iconName, on, key, fn) {
      return U.el('button.rv-seg-btn' + (on ? '.on' : ''), {
        'data-rv': key, 'aria-pressed': on ? 'true' : 'false', title: label, onclick: fn
      }, [U.icon(iconName, 'ico-sm'), U.el('span', { text: label })]);
    }
    function filterChip(label, id, count) {
      const on = shelfFilter === id;
      return U.el('button.chip' + (on ? '.active' : ''), {
        'data-rv': 'filter-' + id, 'aria-pressed': on ? 'true' : 'false',
        onclick: () => { if (shelfFilter === id) return; shelfFilter = id; UI.render(); }
      }, [
        id === 'liked' ? heartIcon(on) : null,
        U.el('span', { text: label }),
        count === undefined ? null : U.el('span.rv-chip-n', { text: String(count) })
      ]);
    }

    U.append(view, U.el('div.card.rv-shelf-bar', {}, [
      U.el('div.rv-bar-row', {}, [
        U.el('div.rv-seg', { role: 'group', 'aria-label': '书本视图' }, [
          segBtn('单列', 'list', cfg.cols === 1, 'cols-1', () => setCols(1)),
          segBtn('双列', 'grid', cfg.cols === 2, 'cols-2', () => setCols(2))
        ]),
        U.el('span.rv-bar-gap'),
        U.el('div.chips.rv-filter', {}, [
          filterChip('全部', 'all'),
          filterChip('收藏', 'liked', likedCount)
        ])
      ]),
      U.el('div.rv-bar-row', {}, [
        U.el('span.rv-bar-label', { text: '封面宽度' }),
        range,
        rangeVal
      ])
    ]));

    function setCols(n) {
      Store.setSetting('readerCols', n === 2 ? 2 : 1);
      UI.render();                       // 立即重排
    }

    U.append(view, U.el('div.section-title', {}, [
      U.icon('book', 'ico-sm'),
      U.el('span', { text: shelfFilter === 'liked' ? '我的收藏' : '读物' }),
      U.el('span.spacer'),
      U.el('span', { text: (shelfFilter === 'liked' ? likedCount : books.length) + ' 本', style: { fontWeight: '500' } })
    ]));

    paintShelf();
    U.append(view, listHost);

    function paintShelf() {
      U.clear(listHost);
      const list = shelfFilter === 'liked' ? books.filter((b) => Store.isLiked(b.id)) : books;
      if (!list.length) {
        U.append(listHost, U.el('div.empty', {}, [
          heartIcon(false),
          U.el('div.empty-title', { text: '还没有收藏的读物' }),
          U.el('p', { text: '点书封上的爱心就能收藏，收藏的书会出现在这里。' })
        ]));
        return;
      }
      if (cfg.cols === 2) {
        const grid = U.el('div.rv-grid');
        list.forEach((b) => grid.appendChild(gridCard(b)));
        listHost.appendChild(grid);
      } else {
        list.forEach((b) => listHost.appendChild(listCard(b)));
      }
    }

    /* 书签汇总 */
    const marks = [];
    (st.reading || []).forEach((b) => (b.bookmarks || []).forEach((m) => marks.push({ book: b, mark: m })));
    if (marks.length) {
      U.append(view, U.el('div.section-title', {}, [U.icon('bookmark', 'ico-sm'), U.el('span', { text: '我的书签' }), U.el('span.spacer'), U.el('span', { text: marks.length + ' 条', style: { fontWeight: '500' } })]));
      const ml = U.el('div.list');
      marks.sort((a, b) => b.mark.at - a.mark.at).slice(0, 12).forEach((x) => {
        ml.appendChild(U.el('div.row.tap', {
          onclick: () => UI.go('read/' + x.book.id + '/' + (x.mark.chapterIndex || 0))
        }, [
          U.el('span.row-chev', {}, U.icon('bookmark', 'ico-sm')),
          U.el('div.row-main', {}, [
            U.el('div.row-title', { text: U.excerpt(x.mark.text, 30) || x.mark.chapterTitle || '书签' }),
            U.el('div.row-sub', { text: x.book.title + ' · ' + (x.mark.chapterTitle || '') + ' · ' + U.fmtWhen(x.mark.at) })
          ]),
          U.el('span.row-chev', {}, U.icon('chevron', 'ico-sm'))
        ]));
      });
      U.append(view, ml);
    }
  });

  /** 单列卡片：封面 + 书名（爱心）+ 章节 / 字数 + 进度 */
  function listCard(b) {
    const pct = (b.progress && b.progress.percent) || 0;
    const words = Store.bookWords(b);
    const remain = Math.max(0, Math.round(words * (1 - pct)));
    const minutesLeft = words ? Math.round(remain / 500) : 0;   // 500 字/分钟 估算
    return U.el('div.card.tap.rv-card', {
      dataset: { book: b.id },
      onclick: () => UI.go('read/' + b.id + '/start')
    }, [
      U.el('div.rv-card-main', {}, [
        coverEl(b),
        U.el('div.rv-card-info', {}, [
          U.el('div.rv-title-row', {}, [
            U.el('div.card-title.rv-title', { text: b.title || '未命名读物' }),
            pct >= 0.985 ? U.el('span.badge.ok', { text: '已读完' }) : null,
            likeButton(b, 'sm'),
            U.el('button.icon-btn', {
              'data-rv': 'book-more', 'aria-label': '更多',
              onclick: (e) => { e.stopPropagation(); bookMenu(b); }
            }, U.icon('more', 'ico-sm'))
          ]),
          U.el('div.card-sub', {}, [
            b.countAchievements === true
              ? U.el('span.badge.ok', { text: '计入成就' })
              : U.el('span.badge', { text: '不计成就' }),
            U.el('span', { text: b.category || T.BOOK_DEFAULT }),
            U.el('span.rv-chapters', { text: chapterLabel(b) }),
            U.el('span.rv-words', { text: wordsText(words) }),
            b.lastReadAt ? U.el('span', { text: '上次 ' + U.fmtWhen(b.lastReadAt) }) : U.el('span', { text: '未开始' })
          ]),
          U.el('div', { style: { marginTop: '10px' } }, [
            UI.progressBar(pct, 'thin'),
            U.el('div.rv-read-line', {}, [
              U.el('span', { text: '已读 ' + Math.round(pct * 100) + '%' }),
              pct > 0 && pct < 0.985 ? U.el('span', { text: '约剩 ' + minutesLeft + ' 分钟' }) : null
            ])
          ])
        ])
      ])
    ]);
  }

  /** 双列卡片：封面（角上爱心）+ 书名 + 章节 / 字数 + 进度 */
  function gridCard(b) {
    const pct = (b.progress && b.progress.percent) || 0;
    const words = Store.bookWords(b);
    return U.el('div.rv-grid-card.tap', {
      dataset: { book: b.id },
      onclick: () => UI.go('read/' + b.id + '/start')
    }, [
      U.el('div.rv-cover-wrap', {}, [coverEl(b), likeButton(b, 'cover')]),
      U.el('div.rv-grid-title', { text: b.title || '未命名读物' }),
      U.el('div.rv-grid-sub', {}, [
        U.el('span.rv-chapters', { text: chapterLabel(b) }),
        U.el('span.rv-dot', { text: '·' }),
        U.el('span.rv-words', { text: wordsText(words) })
      ]),
      UI.progressBar(pct, 'thin'),
      U.el('div.rv-grid-pct', { text: '已读 ' + Math.round(pct * 100) + '%' + (pct >= 0.985 ? ' · 已读完' : '') })
    ]);
  }

  function bookMenu(b) {
    UI.sheet({
      title: b.title || '读物',
      body: (host) => {
        /* 读物名字旁的收藏爱心 */
        U.append(host, U.el('div.rv-menu-head', {}, [
          coverEl(b),
          U.el('div.rv-menu-info', {}, [
            U.el('div.rv-menu-title', { text: b.title || '未命名读物' }),
            U.el('div.rv-menu-sub', { text: chapterLabel(b) + ' · ' + wordsText(Store.bookWords(b)) + (b.author ? ' · ' + b.author : '') }),
            U.el('div', { style: { marginTop: '8px' } }, likeButton(b, 'wide'))
          ])
        ]));

        const items = [
          { label: '开始 / 继续阅读', icon: 'reader', fn: () => UI.go('read/' + b.id + '/start') },
          { label: '重命名', icon: 'edit', fn: () => UI.input({ title: '名称', value: b.title }).then((v) => { if (v) Store.updateBook(b.id, { title: v }); }) },
          { label: '设置作者', icon: 'flag', fn: () => UI.input({ title: '作者', value: b.author || '' }).then((v) => { if (v !== null) Store.updateBook(b.id, { author: v }); }) },
          { label: '设置读物类型', icon: 'filter', fn: () => categorySheet(b) },
          {
            label: b.countAchievements === true ? '改为「不计入成就」' : '改为「计入成就」',
            icon: 'trophy',
            sub: b.countAchievements === true ? '当前：阅读时长与读完册数会算进阅读成就' : '当前：仅供阅读，不影响成就与统计',
            fn: () => {
              Store.updateBook(b.id, { countAchievements: b.countAchievements !== true });
              UI.toast(b.countAchievements === true ? '已改为计入成就' : '已改为不计入成就', 'trophy');
              global.Ach.evaluate(Store.state, true);
              UI.render();
            }
          },
          { label: b.finished ? '标记为未读完' : '标记为已读完', icon: 'check', fn: () => Store.updateBook(b.id, { progress: Object.assign({}, b.progress, { percent: b.finished ? 0.5 : 1 }) }) },
          { label: '导出为 TXT', icon: 'down', fn: () => {
            const text = (b.chapters || []).map((c) => (c.title || '') + '\n\n' + (c.content || '')).join('\n\n');
            IO.download((b.title || '读物') + '.txt', text, 'text/plain');
            UI.toast('已导出', 'down');
          } },
          { label: '清空书签', icon: 'bookmark', fn: () => Store.updateBook(b.id, { bookmarks: [] }) },
          { label: '删除读物', icon: 'trash', danger: true, fn: () => UI.confirm('删除读物', '「' + b.title + '」将被删除。', '删除', true).then((ok) => { if (ok) { Store.deleteBook(b.id); UI.toast('已删除', 'trash'); UI.render(); } }) }
        ];
        const list = U.el('div.list');
        items.forEach((it) => list.appendChild(U.el('div.row.tap', { onclick: () => { UI.closeSheet(); setTimeout(it.fn, 80); } }, [
          U.el('span.row-chev', { style: { color: it.danger ? 'var(--danger)' : 'var(--text-2)' } }, U.icon(it.icon, 'ico-sm')),
          U.el('div.row-main', {}, U.el('div.row-title', { text: it.label, style: it.danger ? { color: 'var(--danger)' } : null }))
        ])));
        U.append(host, list);
      }
    });
  }

  /** 读物类型选择 */
  function categorySheet(b) {
    const sel = T.select(T.BOOK, b.category || T.BOOK_DEFAULT);
    UI.modal({
      title: '读物类型',
      body: (host) => U.append(host, [U.el('div', { text: '用于阅读书架的筛选与分组', style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '8px' } }), sel]),
      buttons: [
        { label: '取消', value: null, ghost: true },
        { label: '保存', primary: true, value: '__ok' }
      ]
    }).then((v) => {
      if (v !== '__ok') return;
      Store.updateBook(b.id, { category: sel.value });
      UI.toast('已设为「' + sel.value + '」', 'check');
      UI.render();
    });
  }

  function importFlow() {
    UI.sheet({
      title: '导入到阅读器',
      body: (host) => {
        let split = 'auto';
        const chips = U.el('div.chips');
        [{ id: 'auto', label: '自动识别章节' }, { id: 'none', label: '当作一整篇' }].forEach((o) => {
          const c = U.el('button.chip' + (o.id === split ? '.active' : ''), {
            text: o.label,
            onclick: () => {
              split = o.id;
              U.$$('.chip', chips).forEach((x) => x.classList.remove('active'));
              c.classList.add('active');
            }
          });
          chips.appendChild(c);
        });
        const titleInput = U.el('input.input', { placeholder: '标题（默认用文件名）' });
        const authorInput = U.el('input.input', { placeholder: '作者（可留空）' });
        const catSel = T.select(T.BOOK, T.BOOK_DEFAULT);
        U.append(host, [
          IO.formatHint ? IO.formatHint({}) : U.el('div', {
            text: '支持 TXT / Markdown / EPUB / MOBI(AZW3) / PDF，内容只保存在本机。'
              + '导入的内容不计入成就与统计，也不会弹出解锁提示。',
            style: { fontSize: '12px', color: 'var(--text-3)', marginBottom: '12px', lineHeight: '1.7' }
          }),
          U.el('div.field', {}, [U.el('label', { text: '分章方式' }), chips]),
          U.el('div.field', {}, [U.el('label', { text: '标题' }), titleInput]),
          U.el('div.field', {}, [U.el('label', { text: '作者' }), authorInput]),
          U.el('div.field', {}, [U.el('label', { text: '类型' }), catSel])
        ]);
        host._get = () => ({ split: split, title: titleInput.value.trim(), author: authorInput.value.trim(), category: catSel.value });
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '网址下载', ghost: true, close: false, onClick: () => {
          const body = document.getElementById('sheetBody');
          const opt = body._get ? body._get() : { split: 'auto', title: '', author: '', category: T.BOOK_DEFAULT };
          UI.closeSheet();
          setTimeout(() => downloadFlow(opt), 140);
        } },
        { label: '粘贴文本', ghost: true, close: false, onClick: () => {
          const body = document.getElementById('sheetBody');
          const opt = body._get ? body._get() : { split: 'auto', title: '', author: '', category: T.BOOK_DEFAULT };
          UI.closeSheet();
          setTimeout(() => {
            const paste = global.Library && global.Library.importViaPaste;
            if (paste) paste('reading');
            else UI.toast('此版本不支持粘贴导入', 'close');
          }, 120);
        } },
        { label: '选择文件', primary: true, close: false, onClick: () => {
          const body = document.getElementById('sheetBody');
          const opt = body._get ? body._get() : { split: 'auto', title: '', author: '', category: T.BOOK_DEFAULT };
          UI.closeSheet();
          (IO.pickFilesSmart ? IO.pickFilesSmart(true) : IO.pickAnyFile(true)).then((files) => {
            if (!files || !files.length) return;
            const busy = UI.busy('正在导入读物', '正在读取…');
            let pct = 0;
            IO.importReading(files, Object.assign({}, opt, {
              onStage: (text, p) => busy.update(text, typeof p === 'number' ? p : pct)
            })).then((res) => {
              UI.busyDone();
              if (!res.ok) { UI.alert('导入失败', res.error || ''); return; }
              const first = res.items[0];
              const skipped = res.skipped || [];
              const diags = res.diagnostics || [];
              const enc = (res.items.find((it) => it.encoding) || {}).encoding || '';
              if (!res.count) {
                UI.sheet({
                  title: '没能导入这个文件',
                  body: (host) => {
                    U.append(host, U.el('div', {
                      style: { fontSize: '13px', lineHeight: '1.9', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
                      text: skipped.length ? skipped.join('\n\n') : '没有提取到内容。'
                    }));
                    U.append(host, U.el('div.field-note', {
                      style: { marginTop: '14px' },
                      text: '把上面这段信息发给我就能定位。也可以先试：确认文件没加密，或在电脑上另存为 TXT 再导入。'
                    }));
                  },
                  footer: [
                    { label: '关闭', ghost: true },
                    { label: '复制诊断信息', primary: true, close: false, onClick: () => {
                      const txt = 'selfwriting 导入诊断\n' + skipped.join('\n\n')
                        + (diags.length ? '\n\n' + diags.map((d) => d.detail).filter(Boolean).join('\n') : '');
                      if (IO.copyText) IO.copyText(txt);
                      UI.toast('已复制诊断信息', 'check');
                    } }
                  ]
                });
                return;
              }
              UI.toast('已导入：' + (first ? first.title : '') + (enc ? '（' + enc + '）' : ''), 'check');
              if (skipped.length) setTimeout(() => UI.alert('有 ' + skipped.length + ' 个文件没导入', skipped.join('\n\n')), 600);
              if (first) setTimeout(() => UI.go('read/' + first.id + '/start'), 350);
            });
          });
        } }
      ]
    });
  }

  /* ================================================================== */
  /* 从网址下载书籍                                                      */
  /* ================================================================== */
  /**
   * 填一个 http/https 地址直接下载并导入。
   * 网页直接抓外部地址会被跨域拦住，所以统一走本机代理（壳里的 LocalServer
   * 或网页版 server.js 都实现了 /__fetch）。
   */
  function downloadFlow(preset) {
    const base = preset || {};
    const urlInput = U.el('input.input', {
      placeholder: 'https://example.com/book.txt',
      inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
    });
    const titleInput = U.el('input.input', { placeholder: '书名（留空则用网址里的文件名）', value: base.title || '' });
    const authorInput = U.el('input.input', { placeholder: '作者（可留空）', value: base.author || '' });
    const catSel = T.select(T.BOOK, base.category || T.BOOK_DEFAULT);
    const progress = U.el('div.field-note', { text: '' });

    const doDownload = () => {
      const url = urlInput.value.trim();
      if (!/^https?:\/\//i.test(url)) {
        progress.textContent = '请填完整网址，以 http:// 或 https:// 开头';
        progress.style.color = 'var(--danger)';
        return;
      }
      progress.style.color = '';
      progress.textContent = '正在连接…';
      const note = UI.toast('正在下载…', 'up', 120000);
      const kill = () => { if (note && note.parentNode) note.parentNode.removeChild(note); };
      IO.downloadBook({
        url: url,
        title: titleInput.value.trim(),
        author: authorInput.value.trim(),
        category: catSel.value,
        split: base.split || 'auto',
        onProgress: (m) => { progress.textContent = m; }
      }).then((res) => {
        kill();
        if (!res.ok) throw new Error(res.error || '下载失败');
        UI.closeSheet();
        UI.toast('已下载《' + res.book.title + '》· ' + res.book.chapters + ' 章', 'check');
        setTimeout(() => UI.go('read/' + res.book.id + '/start'), 300);
      }).catch((e) => {
        kill();
        progress.style.color = 'var(--danger)';
        progress.textContent = String(e && e.message || e);
      });
    };

    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doDownload(); });

    UI.sheet({
      title: '从网址下载书籍',
      body: (host) => {
        U.append(host, [
          U.el('div.field', {}, [U.el('label', { text: '文件网址' }), urlInput]),
          U.el('div.field-note', {
            text: '支持 TXT / EPUB / MOBI(AZW3) / PDF。把直链粘进来即可（右键「复制链接」得到的那种）。'
          }),
          U.el('div.field', {}, [U.el('label', { text: '书名' }), titleInput]),
          U.el('div.field', {}, [U.el('label', { text: '作者' }), authorInput]),
          U.el('div.field', {}, [U.el('label', { text: '类型' }), catSel]),
          progress,
          U.el('div.fmt-hint', { style: { marginTop: '12px' } }, [
            U.el('div.fmt-hint-title', {}, [U.icon('bulb', 'ico-sm'), U.el('span', { text: '下载不到？常见原因' })]),
            U.el('div.fmt-hint-list', {}, [
              U.el('div.fmt-hint-row', {}, [U.el('span.fmt-ext', { text: '需要直链' }), U.el('span.fmt-note', { text: '网页地址（.html）通常抓不到正文，要的是文件本身的链接' })]),
              U.el('div.fmt-hint-row', {}, [U.el('span.fmt-ext', { text: '需要联网' }), U.el('span.fmt-note', { text: '这台设备当前要能访问该网址；部分站点会拒绝非浏览器请求' })]),
              U.el('div.fmt-hint-row', {}, [U.el('span.fmt-ext', { text: '大小限制' }), U.el('span.fmt-note', { text: '单本最大 96 MB' })])
            ])
          ])
        ]);
      },
      footer: [
        { label: '取消', ghost: true },
        { label: '开始下载', primary: true, close: false, onClick: doDownload }
      ]
    });
    setTimeout(() => { try { urlInput.focus(); } catch (e) { /* noop */ } }, 200);
  }

  /* ================================================================== */
  /* 阅读设置（字号 / 行距 / 字体 / 亮度 / 翻页方式 / 点击收起）          */
  /* ================================================================== */
  /**
   * @param {object} [opt]
   *   opt.onMode(mode, user)  阅读页里切换翻页方式时回调（不传就只存设置）
   *   opt.onTapMenu(bool)     「点击正文收起工具栏」开关
   *   opt.onRestyle()         字号 / 行距 / 字体变了（分页模式要重新分列）
   */
  function readingSettings(opt) {
    const o = opt || {};
    const s = Store.state.settings || {};
    const fs = U.el('input', { type: 'range', min: '14', max: '34', step: '1', value: String(s.readerFontSize || 18) });
    const lh = U.el('input', { type: 'range', min: '14', max: '30', step: '1', value: String(Math.round((s.readerLineHeight || 1.9) * 10)) });
    const preview = U.el('div.font-preview', { text: '读书不觉已春深，一寸光阴一寸金。' });
    function sync() {
      const f = Number(fs.value), l = Number(lh.value) / 10;
      preview.style.fontSize = f + 'px';
      preview.style.lineHeight = String(l);
      Store.patchSettings({ readerFontSize: f, readerLineHeight: l });
      Store.applyTheme();
      if (o.onRestyle) o.onRestyle();
    }
    fs.addEventListener('input', sync);
    lh.addEventListener('input', sync);

    /* 翻页方式 */
    const modeChips = U.el('div.chips');
    PAGE_MODES.forEach((m) => {
      const on = normMode(Store.state.settings.readerPageMode) === m.id;
      const c = U.el('button.chip' + (on ? '.active' : ''), {
        'data-rv': 'mode-' + m.id, title: m.sub,
        onclick: () => {
          if (o.onMode) o.onMode(m.id, true);                 // 阅读页里即时生效
          else Store.setSetting('readerPageMode', m.id);      // 书架上只存设置
          U.$$('button.chip[data-rv^="mode-"]').forEach((x) => x.classList.remove('active'));
          c.classList.add('active');
        }
      }, [
        U.el('span', { text: m.label }),
        m.rec ? U.el('span.rv-chip-rec', { text: '推荐' }) : null
      ]);
      modeChips.appendChild(c);
    });

    UI.sheet({
      title: '阅读设置',
      body: (host) => {
        U.append(host, [
          U.el('div.field', {}, [U.el('label', { text: '正文字号' }), fs]),
          U.el('div.field', {}, [U.el('label', { text: '行距' }), lh]),
          preview,
          U.el('div', { style: { height: '12px' } }),
          U.el('div.field', {}, [
            U.el('label', { text: '翻页方式' }),
            modeChips,
            U.el('div.field-note', { text: '连续滚动：上下滑动连着读。整页翻页 / 滑动翻页：两种整页切换动画。仿真翻页（推荐）：按住书页横向拖动，纸页跟着手指卷起来，拖过约 38% 或甩一下即翻页，否则回弹。柔和叠化：旧页淡出、新页淡入并回正，最安静。分页模式下点左右两侧或按 ← → 都能翻页。' })
          ]),
          UI.switchRow('点击正文收起工具栏', '收起后就是纯净阅读；再点一下正文（或按 Esc）恢复', s.readerTapMenu !== false, (v) => {
            Store.setSetting('readerTapMenu', v);
            if (o.onTapMenu) o.onTapMenu(v);
            UI.toast(v ? '已开启：点正文可以收起工具栏' : '已关闭：点正文不再收起', 'check');
          }),
          UI.switchRow('衬线字体（宋体感）', '关闭则用无衬线字体', s.readerFont !== 'sans', (v) => { Store.setSetting('readerFont', v ? 'serif' : 'sans'); if (o.onRestyle) o.onRestyle(); }),
          UI.switchRow('深色模式', '夜间阅读更省眼', document.documentElement.getAttribute('data-theme') === 'dark', () => { Store.toggleTheme(); UI.syncBrightnessPanel(); }),
          UI.switchRow('护眼暖色', '偏黄的纸张色', !!s.warm, (v) => Store.setSetting('warm', v)),
          U.el('div', { style: { marginTop: '6px' } }, [
            U.el('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', marginBottom: '8px' }, text: '屏幕亮度（与手机阅读软件一致，可拖到最低）' }),
            U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
              U.icon('sun-small', 'ico-sm'),
              (() => {
                const b = U.el('input', { type: 'range', min: '20', max: '100', step: '1', value: String(s.brightness || 100) });
                b.addEventListener('input', () => { Store.setSetting('brightness', Number(b.value)); UI.syncBrightnessPanel(); });
                return b;
              })(),
              U.icon('sun', 'ico-sm')
            ])
          ])
        ]);
      }
    });
    sync();
  }

  /* ================================================================== */
  /* 阅读页                                                            */
  /* ================================================================== */
  /* 私密读物：解锁前不渲染正文 */
  function gateBookLocked(view, book) {
    const P = global.Privacy;
    if (!P || !P.isLocked('book', book.id) || P.isUnlocked('book', book.id)) return false;
    UI.setTitle('私密读物', '需要密码');
    P.lockedView(view, 'book', book.id, null, () => UI.render());
    return true;
  }

  UI.route('read/:bookId/:target', function (view, p) {
    const b = Store.findBook(p.bookId);
    if (!b) { U.append(view, UI.empty('close', '找不到这本读物', '', { label: '回到阅读', onClick: () => UI.go('reader') })); return; }
    if (gateBookLocked(view, b)) return;
    return renderReader(view, b, p.target);
  });
  UI.route('read/:bookId', function (view, p) {
    const b = Store.findBook(p.bookId);
    if (!b) { U.append(view, UI.empty('close', '找不到这本读物', '', { label: '回到阅读', onClick: () => UI.go('reader') })); return; }
    if (gateBookLocked(view, b)) return;
    return renderReader(view, b, 'start');
  });

  /* 当前打开的阅读页状态快照（纯数据，供调试 / 自动化断言，不含任何 DOM） */
  let liveState = null;

  function renderReader(view, book, target) {
    view.classList.add('flush', 'rv-reader');
    const settings = Store.state.settings || {};
    const cfg = shelfConfig();
    let pageMode = cfg.mode;
    let tapMenu = cfg.tapMenu;
    let chromeOff = false;
    let disposed = false;
    let layout = null;              // 当前正文版式：滚动 / 分页
    const timers = [];
    function later(fn, ms) {
      const id = setTimeout(() => { if (!disposed) fn(); }, ms);
      timers.push(id);
      return id;
    }

    book.finished = (book.progress && book.progress.percent) >= 0.985;
    const chapters = book.chapters || [];
    book.chapterCount = chapters.length;
    UI.setTitle(book.title || '阅读', (book.author ? book.author + ' · ' : '') + chapterLabel(book));
    if (!chapters.length) {
      U.append(view, UI.empty('reader', '这本读物没有内容', '', { label: '回到阅读', onClick: () => UI.go('reader') }));
      return;
    }

    let currentIndex = 0;
    if (target === 'start' || target === undefined || target === null) {
      currentIndex = (book.progress && book.progress.chapterIndex) || 0;
    } else if (/^\d+$/.test(String(target))) {
      currentIndex = Number(target);
    }
    currentIndex = U.clamp(currentIndex, 0, chapters.length - 1);

    /* 章内比例：滚动模式是「章内读了百分之几」，分页模式是「第几页 / 共几页」，
       两种都写进 progress.chapterFrac，所以换版式、重开都能落在同一处。 */
    function savedFrac() {
      return (book.progress && typeof book.progress.chapterFrac === 'number')
        ? U.clamp(book.progress.chapterFrac, 0, 1) : 0;
    }
    let restoreFrac = (target === 'start' || target === undefined || target === null) ? savedFrac() : 0;

    /* ------------------------------------------------------------------
       正文渐进渲染（打开速度的关键）
       以前这里一次性把所有章节的正文都塞进 DOM：一本 300 章的书要一次
       布局几十万字，手机上点开要等好几秒，滚动还会卡。
       现在分成三步：
         1) 章节标题全部先建好 —— 很便宜，进度、目录、跳转都靠它；
         2) 正文只先渲染「当前这一屏附近」的几章，其余用估高占位块撑住滚动条；
         3) 剩下的交给 IntersectionObserver：滚到哪渲染到哪。
       进度改用「字符位置」计算，所以占位块的高度误差不会影响进度百分比。
       ------------------------------------------------------------------ */
    const N = chapters.length;
    const chars = new Array(N);
    const prefix = new Array(N + 1);
    prefix[0] = 0;
    for (let i = 0; i < N; i++) {
      chars[i] = (chapters[i].content || '').length;
      prefix[i + 1] = prefix[i] + chars[i];
    }
    const totalChars = Math.max(1, prefix[N]);

    /** 章节标题（两种版式共用） */
    function makeHead(i) {
      return U.el('h2', {
        dataset: { chapter: String(i) },
        text: chapters[i].title || ('第 ' + (i + 1) + ' 章'),
        style: { fontSize: '17px', margin: '26px 0 10px', scrollMarginTop: '70px' }
      });
    }

    /** 造一章正文节点（Markdown 优先用导入时预渲染的 HTML，老数据才现场解析） */
    function makeBody(i, paged) {
      const html = book.format === 'md' ? (chapters[i].html || U.mdToHtml(chapters[i].content || '')) : null;
      return U.el('div.reader-stage' + (paged ? '.rv-paged-body' : ''), {
        html: html,
        text: html ? null : (chapters[i].content || '（本节没有内容）')
      });
    }

    /** 一屏有多高（滚动模式翻屏 / 分页模式都不用猜） */
    function screenStep() { return Math.max(140, view.clientHeight - 30); }

    /* 这个滚动容器在 CSS 里是 scroll-behavior: smooth —— 直接改 scrollTop 会「动画过去」。
       一本几百章的书要还原到很后面时，动画会一路滚过整本书（顺带把沿途每章都排版一遍），
       那才是「打开书很慢、一直在加载」的真正原因。所以：定位一律瞬时。 */
    function setScroll(top, animate) {
      if (animate) { view.scrollTo({ top: top, behavior: 'smooth' }); return; }
      const prev = view.style.scrollBehavior;
      view.style.scrollBehavior = 'auto';
      view.scrollTop = top;
      void view.scrollTop;                       /* 读一次，确保立即生效 */
      if (prev) view.style.scrollBehavior = prev; else view.style.removeProperty('scroll-behavior');
    }

    /* ------------------------------------------------------------------ */
    /* 顶部 / 底部工具栏（可以整条落下去的「菜单」）                        */
    /* ------------------------------------------------------------------ */
    const root = document.documentElement;
    const appbarEl = document.getElementById('appbar');

    const railFill = U.el('i.rv-rail-fill');
    const railCursor = U.el('i.rv-rail-cursor');
    const railTicks = U.el('div.rv-rail-ticks');
    const rail = U.el('div.rv-rail', {}, [railFill, railTicks, railCursor]);
    U.append(view, rail);

    /* 页码指示（只在分页模式出现）：第 3 / 12 页 · 26% */
    const pageInd = U.el('div.rv-page-ind', { 'data-rv': 'page-ind', text: '' });
    U.append(view, pageInd);

    const pctText = U.el('span.rv-pct', { text: '0%' });
    const chapterText = U.el('span.rv-chapter', { text: '' });
    const modeTag = U.el('button.rv-mode-tag', {
      'data-rv': 'mode-tag', title: '切换翻页方式', text: modeLabel(pageMode),
      onclick: (e) => { e.stopPropagation(); cycleMode(); }
    });
    const topbar = U.el('div.reader-topbar.rv-bottombar', {}, [
      U.el('button.icon-btn', { 'data-rv': 'prev', 'aria-label': '上一页', onclick: () => turn(-1) }, U.icon('back')),
      U.el('div.rv-bb-main', {}, [
        U.el('div.rv-bb-line', {}, [chapterText, U.el('span', { style: { flex: '1 1 auto' } }), pctText]),
        U.el('div.rv-bb-line', {}, [UI.progressBar(0, 'thin'), modeTag])
      ]),
      U.el('button.icon-btn', { 'data-rv': 'next', 'aria-label': '下一页', onclick: () => turn(1) }, U.icon('chevron')),
      U.el('button.icon-btn', { 'data-rv': 'toc', 'aria-label': '目录', onclick: () => tocSheet() }, U.icon('list')),
      U.el('button.icon-btn', { 'data-rv': 'settings', 'aria-label': '阅读设置', onclick: () => readingSettings({ onMode: applyMode, onTapMenu: setTapMenu, onRestyle: relayoutSoon }) }, U.icon('text')),
      U.el('button.icon-btn', { 'data-rv': 'more', 'aria-label': '更多', onclick: () => readerMenu() }, U.icon('more'))
    ]);
    U.append(view, topbar);
    const progressBarInner = topbar.querySelector('.bar > i');

    /* 顶部栏按钮：书签（会点亮）、收藏爱心、搜索本书 */
    const markBtn = U.el('button.icon-btn.rv-mark-btn', {
      'data-rv': 'bookmark', 'aria-label': '加书签', 'aria-pressed': 'false',
      onclick: () => toggleBookmarkNow()
    }, U.icon('bookmark'));
    const actions = U.el('div.rv-appbar-actions', {}, [
      markBtn,
      likeButton(book, 'sm'),
      U.el('button.icon-btn', { 'data-rv': 'search', 'aria-label': '搜索本书', onclick: () => bookSearch(book, chapters) }, U.icon('search'))
    ]);
    if (appbarEl) appbarEl.appendChild(actions);

    /** 量一下上下两条工具栏的真实高度，收起时才能把页面一起让出来 */
    function measureChrome() {
      const tb = document.getElementById('tabbar');
      const ab = document.getElementById('appbar');
      if (ab) root.style.setProperty('--rv-appbar-h', Math.round(ab.getBoundingClientRect().height) + 'px');
      if (tb) root.style.setProperty('--rv-tabbar-h', Math.round(tb.getBoundingClientRect().height) + 'px');
      root.style.setProperty('--rv-bottombar-h', Math.round(topbar.getBoundingClientRect().height) + 'px');
    }

    function setChromeHidden(hidden) {
      const next = !!hidden;
      if (next === chromeOff) {
        root.classList.toggle('rv-chrome-off', next);
        return;
      }
      /* 收起时顶部栏的位置会被正文接管：把阅读位置补回来，读到的字不会跳 */
      const h = appbarEl ? appbarEl.getBoundingClientRect().height : 0;
      chromeOff = next;
      root.classList.toggle('rv-chrome-off', chromeOff);
      if (layout && layout.onChrome) layout.onChrome(h, chromeOff);
      updateProgress();
      if (liveState) liveState.chromeOff = chromeOff;
    }
    function toggleChrome() { setChromeHidden(!chromeOff); }
    setChromeHidden(false);

    /* 字号 / 行距 / 字体变了：分页模式要按新字号重新分列 */
    const relayoutSoon = U.debounce(() => {
      if (disposed) return;
      if (layout && layout.relayout) layout.relayout();
    }, 220);

    /* ---- 翻页方式 ----------------------------------------------------
       scroll = 连续滚动（占位块 + 观察者的渐进渲染）
       page   = 整页翻页（CSS 多列真实分页 + 覆盖式翻页动画）
       slide  = 滑动翻页（同一套分页 + 两层一起平移的动画）
       ------------------------------------------------------------------ */
    function applyMode(mode, user) {
      const next = normMode(mode);
      const prevKind = pageMode === 'scroll' ? 'scroll' : 'paged';
      const nextKind = next === 'scroll' ? 'scroll' : 'paged';
      pageMode = next;
      view.classList.toggle('rv-mode-scroll', next === 'scroll');
      view.classList.toggle('rv-mode-page', next === 'page');
      view.classList.toggle('rv-mode-slide', next === 'slide');
      view.classList.toggle('rv-mode-curl', next === 'curl');
      view.classList.toggle('rv-mode-fade', next === 'fade');
      modeTag.textContent = modeLabel(pageMode);
      U.$$('button.chip[data-rv^="mode-"]').forEach((n) => {
        n.classList.toggle('active', n.getAttribute('data-rv') === 'mode-' + pageMode);
      });
      if (nextKind !== prevKind) {
        /* 滚动 ⇄ 分页 是两套正文容器：先把位置存好，再换版式重建 */
        const p = saveReading();
        currentIndex = p.idx;
        restoreFrac = p.frac;
        buildLayout();
      } else if (layout && layout.cancelCurl) {
        layout.cancelCurl();                 /* 换翻页方式时别留下卷曲层 */
      }
      if (user) {
        Store.setSetting('readerPageMode', pageMode);
        UI.toast('翻页方式：' + modeLabel(pageMode), 'check');
      }
      if (liveState) { liveState.mode = pageMode; }
    }
    function cycleMode() {
      const i = PAGE_MODES.map((m) => m.id).indexOf(pageMode);
      applyMode(PAGE_MODES[(i + 1) % PAGE_MODES.length].id, true);
    }
    function setTapMenu(v) {
      tapMenu = v !== false;
      if (liveState) liveState.tapMenu = tapMenu;
    }

    /* ------------------------------------------------------------------ */
    /* 进度追踪（滚动模式按字符位置，分页模式按「章 + 页」）                */
    /* ------------------------------------------------------------------ */
    let lastPct = -1;
    let lastIdxShown = -1;
    let lastPageShown = -1;

    /** 当前读到第几章、章内比例（0~1）、全书百分比 —— 由当前版式给出 */
    function position() {
      if (layout) return layout.position();
      return { idx: currentIndex, frac: 0, percent: 0 };
    }

    function saveReading() {
      const p = position();
      const extra = (layout && layout.pageInfo) ? layout.pageInfo() : null;
      Store.setBookProgress(book.id, Object.assign({
        chapterIndex: p.idx,
        chapterFrac: p.frac,
        scroll: view.scrollTop,
        percent: p.percent
      }, extra || {}));
      return p;
    }

    function updateProgress() {
      const p = position();
      currentIndex = p.idx;
      const pct = Math.round(p.percent * 100);
      const info = (layout && layout.pageInfo) ? layout.pageInfo() : null;
      if (liveState) {
        liveState.idx = p.idx;
        liveState.percent = p.percent;
        liveState.currentPct = pct;
        liveState.pageIndex = info ? info.pageIndex : 0;
        liveState.pageCount = info ? info.pageCount : 0;
      }
      if (pct !== lastPct || p.idx !== lastIdxShown || (info && info.pageIndex !== lastPageShown)) {
        lastPct = pct;
        lastIdxShown = p.idx;
        pctText.textContent = pct + '%';
        if (progressBarInner) progressBarInner.style.width = pct + '%';
        chapterText.textContent = (p.idx + 1) + ' / ' + N + ' · ' + U.excerpt(chapters[p.idx].title, 12);
      }
      if (info) {
        lastPageShown = info.pageIndex;
        pageInd.textContent = '第 ' + (info.pageIndex + 1) + ' / ' + info.pageCount + ' 页 · ' + pct + '%';
        pageInd.classList.add('rv-on');
      } else {
        lastPageShown = -1;
        pageInd.classList.remove('rv-on');
      }
      railFill.style.height = (p.percent * 100).toFixed(1) + '%';
      railCursor.style.top = (p.percent * 100).toFixed(1) + '%';
      syncMarkButton();
    }

    /* ------------------------------------------------------------------ */
    /* 书签：点亮按钮 / 章标题丝带 / 段落标记 / 目录与侧边进度条刻度        */
    /* ------------------------------------------------------------------ */
    function marksOf(i) {
      const all = book.bookmarks || [];
      const out = [];
      for (let k = 0; k < all.length; k++) {
        if (U.clamp(Number(all[k].chapterIndex) || 0, 0, N - 1) === i) out.push(all[k]);
      }
      return out;
    }

    /** 当前阅读位置是否已经有书签（有：按钮点亮，再点就是取消） */
    function bookmarkAtNow() {
      const p = position();
      const list = marksOf(p.idx);
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        const f = (typeof m.chapterFrac === 'number') ? m.chapterFrac : p.frac;
        if (Math.abs(f - p.frac) <= 0.2) return m;
      }
      return null;
    }

    function syncMarkButton() {
      const on = !!bookmarkAtNow();
      if (markBtn.classList.contains('on') !== on) {
        markBtn.classList.toggle('on', on);
        markBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        markBtn.setAttribute('aria-label', on ? '取消书签' : '加书签');
      }
      if (liveState) { liveState.marked = on; liveState.marks = (book.bookmarks || []).length; }
      return on;
    }

    /** 把书签旁边的段落也标出来（Markdown 导入有真实段落节点；TXT 只有章标题丝带） */
    function markParagraphs(i, body) {
      const list = marksOf(i);
      if (!list.length || !body) return;
      const nodes = body.querySelectorAll('p,li,blockquote,h3,h4,div');
      list.forEach((m) => {
        const key = String(m.text || '').replace(/\s+/g, '').slice(0, 10);
        if (!key) return;
        for (let k = 0; k < nodes.length; k++) {
          const txt = String(nodes[k].textContent || '').replace(/\s+/g, '');
          if (txt.indexOf(key) >= 0) { nodes[k].classList.add('rv-mark-para'); return; }
        }
      });
    }

    function toggleBookmarkNow() {
      const hit = bookmarkAtNow();
      if (hit) {
        Store.removeBookmark(book.id, hit.id);
        UI.toast('已取消书签', 'trash');
      } else {
        const p = position();
        Store.addBookmark(book.id, {
          text: U.excerpt(chapters[p.idx].content, 40),
          chapterIndex: p.idx,
          chapterTitle: chapters[p.idx].title,
          chapterFrac: p.frac,
          percent: p.percent
        });
        UI.toast('已加书签', 'bookmark');
      }
      syncMarks();
    }

    function renderRailTicks() {
      U.clear(railTicks);
      const seen = {};
      (book.bookmarks || []).forEach((m) => {
        const ci = U.clamp(Number(m.chapterIndex) || 0, 0, N - 1);
        if (seen[ci]) return;
        seen[ci] = 1;
        const pct = totalChars ? (prefix[ci] / totalChars) : 0;
        railTicks.appendChild(U.el('button.rv-rail-tick', {
          style: { top: (pct * 100).toFixed(2) + '%' },
          dataset: { chapter: String(ci) },
          title: '书签 · ' + (chapters[ci].title || ('第 ' + (ci + 1) + ' 章')),
          'aria-label': '书签：' + (chapters[ci].title || ('第 ' + (ci + 1) + ' 章')),
          onclick: (e) => { e.stopPropagation(); jump(ci); }
        }));
      });
    }

    /** 给某一章的标题 + 正文画 / 摘书签标记（两种版式共用） */
    function applyMarksToChapter(i, head, body) {
      if (!head) return;
      const has = marksOf(i).length > 0;
      head.classList.toggle('rv-has-mark', has);
      let rib = head.querySelector('.rv-ribbon');
      if (has && !rib) {
        rib = U.el('span.rv-ribbon', { 'aria-hidden': 'true' });
        head.insertBefore(rib, head.firstChild);
      } else if (!has && rib) {
        head.removeChild(rib);
      }
      if (body) {
        body.classList.toggle('rv-marked', has);
        if (has) markParagraphs(i, body);
      }
    }

    /** 书签变化后统一刷新：章标题丝带、段落标记、侧边刻度、按钮状态 */
    function syncMarks() {
      if (layout && layout.syncMarks) layout.syncMarks();
      renderRailTicks();
      syncMarkButton();
    }

    /* ------------------------------------------------------------------ */
    /* 翻页 / 跳转（交给当前版式实现）                                     */
    /* ------------------------------------------------------------------ */
    function turn(dir) {
      if (!layout) return false;
      const moved = layout.turn(dir);
      if (!moved) {
        if (layout.kind !== 'scroll') UI.toast(dir > 0 ? '已经是最后一页了' : '已经是第一页了', 'dot');
        return false;
      }
      if (layout.kind === 'scroll') { updateProgress(); saveReading(); }
      return true;
    }

    function jump(i) {
      i = U.clamp(i, 0, N - 1);
      currentIndex = i;
      if (layout) layout.jump(i);
      saveReading();
      later(updateProgress, 60);
      later(syncMarks, 120);
    }

    /* ------------------------------------------------------------------ */
    /* 滚动版式：章节标题全建、正文按屏渐进排版、占位块撑滚动条            */
    /* ------------------------------------------------------------------ */
    function createScrollLayout() {
      const heads = new Array(N);
      const bodies = new Array(N);
      const holders = new Array(N);
      let pxPerChar = 0.5;        // 占位块估高：先给经验值，首屏排版完自动校准
      let observer = null;
      let idleTimer = null;
      let rafId = null;

      const stage = U.el('div.rv-stage', { 'data-rv': 'stage', style: { padding: '10px 16px 120px' } });
      U.append(view, stage);
      view.classList.remove('rv-noscroll');

      /* 第一步：只建章节标题（很便宜）。进度、目录、跳转都靠这些锚点 */
      for (let i = 0; i < N; i++) {
        heads[i] = makeHead(i);
        stage.appendChild(heads[i]);
      }
      stage.classList.toggle('sans', settings.readerFont === 'sans');

      function insertAfterHead(i, node) {
        const head = heads[i];
        if (head.nextSibling) stage.insertBefore(node, head.nextSibling);
        else stage.appendChild(node);
      }

      /**
       * 渲染第 i 章正文（有占位块就替换它，没有就直接插到标题后面）；已渲染过就返回 false。
       * quiet = true 时不做「补滚动」校正（首屏那几章在设置滚动位置之前渲染，不需要）。
       */
      function paint(i, quiet) {
        if (i < 0 || i >= N || bodies[i]) return false;
        const holder = holders[i];
        const oldH = (quiet || !holder) ? 0 : holder.offsetHeight;
        const top = (quiet || !holder) ? 0 : holder.offsetTop;
        const body = makeBody(i, false);
        if (holder && holder.parentNode) holder.parentNode.replaceChild(body, holder);
        else insertAfterHead(i, body);
        holders[i] = null;
        bodies[i] = body;
        if (marksOf(i).length) { body.classList.add('rv-marked'); markParagraphs(i, body); }
        if (!quiet) keepAnchor(top, oldH, body);
        return true;
      }

      /** 占位估高和真实排版总会有差：这块在视线之上时按差值把滚动位置补回来 */
      function keepAnchor(top, oldH, body) {
        const d = body.offsetHeight - oldH;
        if (d && top > 0 && top < view.scrollTop) setScroll(Math.max(0, view.scrollTop + d), false);
      }

      /* 第二步：首屏正文 —— 从当前章往后渲染到「够两三屏」为止，点开就有字可看 */
      let firstEnd = currentIndex;
      (function firstScreen() {
        let used = 0, i = currentIndex;
        while (i < N && (used < 3200 || i - currentIndex < 2) && i - currentIndex < 40) {
          paint(i, true);
          used += chars[i];
          i++;
        }
        firstEnd = i;
      })();

      /* 其余章节：交给 IntersectionObserver，滚到附近才排版 */
      function watchHolders() {
        if (!global.IntersectionObserver) return;
        if (!observer) {
          observer = new global.IntersectionObserver((ents) => {
            let hit = 0;
            for (let k = 0; k < ents.length; k++) {
              const en = ents[k];
              if (!en.isIntersecting) continue;
              const i = Number(en.target.dataset.src);
              if (paint(i)) hit++;
              observer.unobserve(en.target);
            }
            if (hit && !disposed) updateProgress();
          }, { root: view, rootMargin: '1500px 0px 1800px 0px' });
        }
        for (let i = 0; i < N; i++) if (holders[i]) observer.observe(holders[i]);
      }

      /* 老浏览器没有 IntersectionObserver：退回「空闲时按需补齐」，
         先补当前章后面，再补前面（插到前面时补回滚动位置，视线不动）。 */
      function idlePrefill() {
        idleTimer = null;
        let budget = 12000;
        let i = currentIndex;
        while (i < N && budget > 0) {
          if (holders[i]) { budget -= chars[i]; paint(i); }
          i++;
        }
        i = currentIndex;
        while (i >= 0 && budget > 0) {
          if (holders[i]) { budget -= chars[i]; paint(i); }
          i--;
        }
        if (budget <= 0) idleTimer = setTimeout(idlePrefill, 200);
      }

      function chapterFromScroll() {
        const top = view.scrollTop + 90;
        let idx = currentIndex;
        for (let i = 0; i < N; i++) {
          const h = heads[i];
          if (!h) break;
          if (h.offsetTop <= top) idx = i;
          else break;
        }
        return idx;
      }

      return {
        kind: 'scroll',
        restore: function () {
          /* 第三步：占位块、精确估高、还原阅读位置，统统放到下一帧。
             这一帧先让浏览器把首屏画出来 —— 用户看到的是「点开即显示」。 */
          rafId = global.requestAnimationFrame(() => {
            rafId = null;
            if (disposed) return;
            measureChrome();
            /* 用首屏几章的真实排版校准「每字占多少像素」，占位块估高就八九不离十了 */
            let n = 0, sum = 0;
            for (let k = currentIndex; k < firstEnd; k++) {
              if (!bodies[k] || chars[k] < 200) continue;
              sum += bodies[k].offsetHeight / chars[k];
              n++;
            }
            if (n) pxPerChar = U.clamp(sum / n, 0.1, 6);
            /* 其余章节先摆占位块，把滚动条长度撑得和全书差不多 */
            for (let i = 0; i < N; i++) {
              if (bodies[i]) continue;
              const holder = U.el('div.reader-stage.pending', {
                dataset: { src: String(i) },
                style: { minHeight: Math.max(30, Math.round(chars[i] * pxPerChar)) + 'px' }
              });
              holders[i] = holder;
              insertAfterHead(i, holder);
            }
            watchHolders();
            /* 还原：正文是渐进渲染的，所以用「章节 + 章内比例」而不是像素 */
            const i0 = U.clamp(currentIndex, 0, N - 1);
            const head = heads[i0];
            if (head) {
              let top = Math.max(0, head.offsetTop - 60);
              const body = bodies[i0] || holders[i0];
              if (restoreFrac > 0 && body) top += body.offsetHeight * restoreFrac;
              setScroll(top, false);
              /* 还原位置附近可能还有没排版的章：顺手补上，免得一进来就是骨架 */
              paint(i0 - 1);
              paint(i0 + 1);
              paint(i0 + 2);
            }
            updateProgress();
            saveReading();
            syncMarks();
          });
        },
        position: function () {
          const idx = chapterFromScroll();
          const head = heads[idx];
          let frac = 0;
          if (head) {
            const body = bodies[idx];
            const holder = holders[idx];
            const h = body ? body.offsetHeight : (holder ? holder.offsetHeight : 0);
            const start = head.offsetTop + head.offsetHeight;
            frac = U.clamp((view.scrollTop + view.clientHeight * 0.3 - start) / Math.max(1, h), 0, 1);
          }
          let percent = U.clamp((prefix[idx] + frac * chars[idx]) / totalChars, 0, 1);
          /* 滚到底就是 100%：正文下面还有内边距，纯字符估算到不了 1 */
          if (view.scrollTop >= view.scrollHeight - view.clientHeight - 6) percent = 1;
          if (percent >= 0.999 && idx >= N - 1) percent = 1;
          return { idx: idx, frac: frac, percent: percent };
        },
        pageInfo: null,
        onChrome: function (h, off) {
          if (h > 4) setScroll(Math.max(0, view.scrollTop + (off ? -h : h)), false);
        },
        jump: function (i) {
          paint(i);                                  /* 目标章先排版，再跳 */
          const head = heads[i];
          if (head) {
            setScroll(Math.max(0, head.offsetTop - 60), false);
            /* 占位块会在下一帧被真实正文替换（高度不同）：再校一次，保证落在目标章 */
            global.requestAnimationFrame(() => {
              if (disposed) return;
              const t2 = Math.max(0, heads[i].offsetTop - 60);
              if (Math.abs(t2 - view.scrollTop) > 4) setScroll(t2, false);
              updateProgress();
              saveReading();
            });
          }
        },
        turn: function (dir) {
          const from = view.scrollTop;
          const top = U.clamp(from + dir * screenStep(), 0, Math.max(0, view.scrollHeight - view.clientHeight));
          if (Math.abs(top - from) < 4) return false;
          setScroll(top, true);                      /* 连续滚动：平滑滑一屏 */
          later(() => { if (!disposed) { updateProgress(); saveReading(); } }, 450);
          return true;
        },
        syncMarks: function () {
          for (let i = 0; i < N; i++) applyMarksToChapter(i, heads[i], bodies[i]);
        },
        destroy: function () {
          if (idleTimer) clearTimeout(idleTimer);
          if (rafId) { try { global.cancelAnimationFrame(rafId); } catch (e) { /* noop */ } }
          if (observer) { try { observer.disconnect(); } catch (e) { /* noop */ } }
          if (stage.parentNode) stage.parentNode.removeChild(stage);
        }
      };
    }

    /* ------------------------------------------------------------------ */
    /* 分页版式：按章真实分列（一页 = 一屏），只对当前章排版                 */
    /*                                                                     */
    /* 做法与微信读书 / 掌阅一致：                                          */
    /*   .rv-pager  一屏大小的取景框（overflow: hidden）                    */
    /*   .rv-pages  CSS 多列容器：column-width = 一屏宽、column-gap = 0、    */
    /*              column-fill: auto、固定高度 —— 排不下就往右溢出成新的一  */
    /*              列，scrollWidth / 列宽 就是这一章的页数                  */
    /* 翻页 = 给 .rv-pages 做 translateX(-页号 × 列宽)，动画由两层容器完成。 */
    /* 一本书只排「当前这一章」，所以打开速度还是几十毫秒。                  */
    /* ------------------------------------------------------------------ */
    const PAGE_PAD_X = 16;
    const PAGE_PAD_TOP = 12;
    const TURN_MS = 300;
    const FADE_MS = 290;           /* 柔和叠化的时长 */

    function createPagedLayout() {
      const host = U.el('div.rv-paged', { 'data-rv': 'paged' });
      U.append(view, host);
      view.classList.add('rv-noscroll');
      host.classList.toggle('sans', settings.readerFont === 'sans');
      measureChrome();                 /* 分页要先知道底部阅读条有多高，才量得出版心 */

      let VW = 0, VH = 0, W = 0, H = 0;
      const pos = { ci: U.clamp(currentIndex, 0, N - 1), pi: 0, pages: 1 };
      let cur = null;
      let busy = false;

      /** 底部阅读条占掉的高度（收起工具栏后正文可以多吃一点） */
      function padBottom() {
        const barH = topbar.getBoundingClientRect().height || 0;
        return (chromeOff ? 14 : Math.round(barH) + 14);
      }

      function geometry() {
        VW = Math.max(200, Math.round(host.clientWidth || view.clientWidth || 320));
        VH = Math.max(240, Math.round(host.clientHeight || view.clientHeight || 480));
        W = Math.max(140, VW - PAGE_PAD_X * 2);
        H = Math.max(120, VH - PAGE_PAD_TOP - padBottom());
        return { W: W, H: H };
      }

      /** 一列 = 一屏宽，所以页数 = scrollWidth ÷ 列宽 */
      function pagesOf(cols) {
        const sw = Math.max(cols.scrollWidth || 0, cols.clientWidth || 0);
        let n = Math.round(sw / W);
        if (!(n > 1)) {
          /* 有些内核不把多列溢出算进 scrollWidth：退回「单列高度 ÷ 页高」估算 */
          const probe = cols.cloneNode(true);
          probe.style.position = 'absolute';
          probe.style.left = '-99999px';
          probe.style.top = '0';
          probe.style.width = W + 'px';
          probe.style.height = 'auto';
          probe.style.columnWidth = 'auto';
          probe.style.columnCount = '1';
          host.appendChild(probe);
          const total = probe.offsetHeight || 0;
          host.removeChild(probe);
          n = Math.ceil(total / Math.max(1, H));
        }
        return Math.max(1, n);
      }

      function moveEl(el, x, animate) {
        el.style.transition = animate ? 'transform ' + TURN_MS + 'ms cubic-bezier(.22,.61,.36,1)' : 'none';
        el.style.transform = 'translateX(' + Math.round(x) + 'px)';
      }

      function setPage(layer, pi) {
        const target = U.clamp(pi, 0, Math.max(0, layer.pages - 1));
        layer.cols.style.transition = 'none';
        layer.cols.style.transform = 'translateX(' + (-target * W).toFixed(1) + 'px)';
        layer.pi = target;
        return target;
      }

      function buildLayer(ci, pi) {
        const el = U.el('div.rv-pager', { dataset: { chapter: String(ci) } });
        const cols = U.el('div.rv-pages');
        /* 取景框本身左右各留一屏留白（写在 CSS 的 --rv-page-pad-x 上），
           多列容器贴齐取景框 —— 这样右边的下一列会被裁在版心边上，不会露出来 */
        cols.style.left = '0';
        cols.style.top = PAGE_PAD_TOP + 'px';
        cols.style.width = W + 'px';
        cols.style.height = H + 'px';
        cols.style.columnWidth = W + 'px';
        cols.style.columnGap = '0px';
        cols.style.columnFill = 'auto';
        const head = makeHead(ci);
        const body = makeBody(ci, true);
        cols.appendChild(head);
        cols.appendChild(body);
        el.appendChild(cols);
        host.appendChild(el);
        const layer = { el: el, cols: cols, head: head, body: body, ci: ci, pi: 0, pages: pagesOf(cols) };
        setPage(layer, pi);
        applyMarksToChapter(ci, head, body);
        return layer;
      }

      /** 当前 DOM 里的分页层（正常只有一层，动画期间是两层） */
      function layers() { return U.$$('.rv-pager', host); }
      function dropOthers(keep) {
        layers().forEach((n) => { if (n !== keep && n.parentNode) n.parentNode.removeChild(n); });
      }

      /** 翻到下一处：同章下一页 / 下一章首页 / 上一章末页 */
      function resolve(dir) {
        const pi = pos.pi + dir;
        if (pi < 0) {
          if (pos.ci <= 0) return null;
          const l = buildLayer(pos.ci - 1, 0);
          const last = Math.max(0, l.pages - 1);
          setPage(l, last);                          /* 上一章要先排出来才知道末页是第几页 */
          return { ci: pos.ci - 1, pi: last, layer: l };
        }
        if (pi >= pos.pages) {
          if (pos.ci >= N - 1) return null;
          return { ci: pos.ci + 1, pi: 0, layer: buildLayer(pos.ci + 1, 0) };
        }
        return { ci: pos.ci, pi: pi, layer: null };
      }

      function turn(dir) {
        if (busy || !cur) return false;
        geometry();
        const target = resolve(dir);
        if (!target) return false;
        if (pageMode === 'curl') {                          /* 仿真翻页：点击也用同一套卷曲轨迹 */
          if (!setupCurl(dir, target)) return false;
          busy = true;
          commitCurl(320);
          return true;
        }
        if (pageMode === 'fade') {                          /* 柔和叠化：旧页淡出缩放，新页淡入回正 */
          busy = true;
          const incoming = target.layer || buildLayer(target.ci, target.pi);
          const outgoing = cur.el;
          incoming.el.classList.add('rv-layer-next', 'rv-fade-next');
          outgoing.classList.add('rv-fade-out');
          incoming.el.style.zIndex = '2';
          void incoming.el.offsetWidth;                     /* 先把起始状态落到样式上，过渡才会跑 */
          incoming.el.classList.add('rv-fade-run');
          /* 位置立刻生效：进度、书签、目录都以新的一页为准 */
          cur = incoming;
          pos.ci = target.ci;
          pos.pi = incoming.pi;
          pos.pages = incoming.pages;
          updateProgress();
          saveReading();
          later(() => {
            if (disposed) return;
            if (outgoing && outgoing.parentNode) outgoing.parentNode.removeChild(outgoing);
            incoming.el.classList.remove('rv-layer-next', 'rv-fade-next', 'rv-fade-run');
            incoming.el.style.zIndex = '';
            incoming.el.style.transition = '';
            incoming.el.style.opacity = '';
            incoming.el.style.transform = '';
            busy = false;
          }, FADE_MS + 40);
          return true;
        }
        busy = true;
        const cover = pageMode === 'page';                 /* 覆盖式 vs 平移滑动 */
        const incoming = target.layer || buildLayer(target.ci, target.pi);
        const outgoing = cur.el;
        incoming.el.classList.add('rv-layer-next');
        incoming.el.style.zIndex = '2';
        moveEl(incoming.el, dir * VW, false);
        if (cover) incoming.el.classList.add(dir > 0 ? 'rv-cover-left' : 'rv-cover-right');
        else outgoing.style.zIndex = '1';
        global.requestAnimationFrame(() => {
          if (disposed) return;
          if (!cover) moveEl(outgoing, -dir * VW, true);   /* 滑动翻页：两层一起平移 */
          moveEl(incoming.el, 0, true);
        });
        /* 位置立刻生效：进度、书签、目录都以新的一页为准 */
        cur = incoming;
        pos.ci = target.ci;
        pos.pi = incoming.pi;
        pos.pages = incoming.pages;
        updateProgress();
        saveReading();
        later(() => {
          if (disposed) return;
          if (outgoing && outgoing.parentNode) outgoing.parentNode.removeChild(outgoing);
          incoming.el.classList.remove('rv-layer-next', 'rv-cover-left', 'rv-cover-right');
          incoming.el.style.zIndex = '';
          incoming.el.style.transition = 'none';
          incoming.el.style.transform = 'translateX(0px)';
          busy = false;
        }, TURN_MS + 30);
        return true;
      }

      /* ----------------------------------------------------------------
         仿真翻页（卷曲）—— 「像真的纸书一样翻」
         手指横拖时折痕跟着手指走：折痕一侧的页面保持不动，被掀起的那一片
         绕折痕镜像折到另一侧（露出纸背与透出的墨色），折痕处用两条渐变做
         明暗（外缘背光变暗、卷起内侧有高光），下一页从掀开的地方透出来。
         全程只用 clip-path + transform + 渐变，不重排、不重新分列。
         ---------------------------------------------------------------- */
      const CURL_BOW = 14;           /* 折痕的弧线幅度（px） */
      const CURL_N = 8;              /* 弧线取样点数 */
      let curl = null;

      function poly(pts) {
        const out = [];
        for (let i = 0; i < pts.length; i++) out.push(pts[i][0].toFixed(1) + 'px ' + pts[i][1].toFixed(1) + 'px');
        return 'polygon(' + out.join(', ') + ')';
      }
      function nowMs() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

      /** 造出卷曲需要的几层：下面那一页 + 掀起来的一片（内容克隆 + 明暗）
       *  from = 正在进行的这次拖拽（保留手指起点，别把 dx 的基准冲掉） */
      function setupCurl(dir, target, from) {
        const t = target || resolve(dir);
        if (!t || !cur) return false;
        const org = from || null;
        const under = t.layer || buildLayer(t.ci, t.pi);
        const flat = cur;
        const wrap = U.el('div.rv-curl-flap');
        const sheet = flat.cols.cloneNode(true);            /* 同一个页面内容的副本 */
        sheet.classList.add('rv-curl-sheet');
        const shade = U.el('div.rv-curl-shade');
        const flatShade = U.el('div.rv-curl-flat-shade');
        const underShade = U.el('div.rv-curl-under-shade');
        wrap.appendChild(sheet);
        wrap.appendChild(shade);
        flat.el.appendChild(flatShade);
        under.el.appendChild(underShade);
        host.appendChild(wrap);
        host.classList.toggle('rv-curl-rev', dir < 0);       /* 反向翻：渐变方向也反过来 */
        under.el.style.zIndex = '1';
        flat.el.style.zIndex = '2';
        wrap.style.zIndex = '3';
        curl = {
          dir: dir, p: 0, settled: false,
          dragging: org ? !!org.dragging : false,
          x0: org ? org.x0 : 0, y0: org ? org.y0 : 0,
          lastX: org ? org.lastX : 0, lastT: Date.now(), vel: 0,
          target: t, flat: flat, under: under,
          wrap: wrap, sheet: sheet, shade: shade, flatShade: flatShade, underShade: underShade,
          animRaf: null, paintRaf: null
        };
        paintCurl();
        return true;
      }

      /** 按当前进度把折痕、镜像、明暗画出来 */
      function paintCurl() {
        if (!curl || !curl.dir) return;
        const dir = curl.dir;
        const p = U.clamp(curl.p, 0, 1);
        if (liveState) { liveState.curlDir = dir; liveState.curlP = p; }
        const d = p * W;
        const foldAt = (dir > 0 ? W : 0);                   /* 折痕基准位置 */
        const foldPts = [];
        const freePts = [];
        for (let i = 0; i <= CURL_N; i++) {
          const t = i / CURL_N;
          const y = t * VH;
          const bow = Math.sin(Math.PI * t) * CURL_BOW * dir;   /* 中间鼓一点 = 弧线折痕 */
          const fx = (dir > 0 ? (W - d) : d) + bow;
          foldPts.push([fx, y]);
          freePts.push([fx - dir * d, y]);                      /* 自由边：折痕再往外 d */
        }
        /* 1) 没被掀起的那一半留在原处 */
        const flatPts = dir > 0
          ? [[0, 0]].concat(foldPts, [[0, VH]])
          : foldPts.slice().reverse().concat([[W, VH], [W, 0]]);
        curl.flat.el.style.clipPath = poly(flatPts);
        /* 2) 掀起的一片：折痕 ↔ 自由边 */
        curl.wrap.style.clipPath = poly(foldPts.concat(freePts.slice().reverse()));
        /* 3) 内容绕折痕镜像折过来（纸背透出的墨色） */
        curl.sheet.style.transformOrigin = foldAt.toFixed(1) + 'px 50%';
        curl.sheet.style.transform = 'scaleX(-1)';
        /* 4) 明暗：折痕内侧压暗、卷面背光变暗 + 内侧高光、下一页上的投影 */
        const fade = Math.min(1, p * 4);
        const mid = foldAt + (dir > 0 ? -d : d) * 0.0;         /* 折痕在中线附近的 x */
        const edge = dir > 0 ? (W - d) : d;
        const bandW = Math.max(14, Math.min(64, d * 0.6));
        if (dir > 0) {
          curl.flatShade.style.cssText = 'left:' + (edge - bandW) + 'px;width:' + bandW + 'px;opacity:' + fade;
          curl.shade.style.cssText = 'left:' + Math.max(0, edge - d) + 'px;width:' + Math.max(1, d) + 'px;opacity:' + fade;
          curl.underShade.style.cssText = 'left:' + edge + 'px;width:' + bandW + 'px;opacity:' + fade;
        } else {
          curl.flatShade.style.cssText = 'left:' + edge + 'px;width:' + bandW + 'px;opacity:' + fade;
          curl.shade.style.cssText = 'left:' + edge + 'px;width:' + Math.max(1, d) + 'px;opacity:' + fade;
          curl.underShade.style.cssText = 'left:' + Math.max(0, edge - bandW) + 'px;width:' + bandW + 'px;opacity:' + fade;
        }
        void mid;
      }

      /** 收尾动画：p 从当前值走到 to，走完调 done() */
      function animateCurl(to, ms, done) {
        const c = curl;
        if (!c) return;
        const from = c.p;
        const t0 = nowMs();
        if (c.animRaf) { try { global.cancelAnimationFrame(c.animRaf); } catch (e) { /* noop */ } }
        function step() {
          if (curl !== c) return;
          const k = U.clamp((nowMs() - t0) / Math.max(1, ms), 0, 1);
          c.p = from + (to - from) * (1 - Math.pow(1 - k, 3));     /* easeOutCubic：收尾平滑 */
          paintCurl();
          if (k < 1) c.animRaf = global.requestAnimationFrame(step);
          else { c.animRaf = null; done(); }
        }
        c.animRaf = global.requestAnimationFrame(step);
      }

      /** 翻过去：位置立刻生效，再把卷曲走完 */
      function commitCurl(ms) {
        const c = curl;
        if (!c) return;
        cur = c.under;
        pos.ci = c.target.ci;
        pos.pi = c.under.pi;
        pos.pages = c.under.pages;
        updateProgress();
        saveReading();
        animateCurl(1, ms || 320, finishCurl);
      }

      /** 动画收尾：拆掉卷曲用的几层，只留下新的那一页 */
      function finishCurl() {
        const c = curl;
        if (!c) return;
        curl = null;
        if (c.paintRaf) { try { global.cancelAnimationFrame(c.paintRaf); } catch (e) { /* noop */ } }
        if (c.wrap && c.wrap.parentNode) c.wrap.parentNode.removeChild(c.wrap);
        if (c.flatShade && c.flatShade.parentNode) c.flatShade.parentNode.removeChild(c.flatShade);
        if (c.underShade && c.underShade.parentNode) c.underShade.parentNode.removeChild(c.underShade);
        if (c.flat && c.flat.el) {
          c.flat.el.style.clipPath = '';
          c.flat.el.style.zIndex = '';
          if (c.flat.el.parentNode) c.flat.el.parentNode.removeChild(c.flat.el);
        }
        if (c.under && c.under.el) c.under.el.style.zIndex = '';
        host.classList.remove('rv-curl-rev');
        busy = false;
      }

      /** 丢弃正在进行的卷曲（回弹 / 切章 / 切模式 / 重新分列时调用），页码不变 */
      function cancelCurl() {
        const c = curl;
        if (!c) return;
        curl = null;
        if (c.animRaf) { try { global.cancelAnimationFrame(c.animRaf); } catch (e) { /* noop */ } }
        if (c.paintRaf) { try { global.cancelAnimationFrame(c.paintRaf); } catch (e) { /* noop */ } }
        if (c.wrap && c.wrap.parentNode) c.wrap.parentNode.removeChild(c.wrap);
        if (c.flatShade && c.flatShade.parentNode) c.flatShade.parentNode.removeChild(c.flatShade);
        if (c.underShade && c.underShade.parentNode) c.underShade.parentNode.removeChild(c.underShade);
        if (c.flat && c.flat.el) {
          c.flat.el.style.clipPath = '';
          c.flat.el.style.zIndex = '';
        }
        if (c.under && c.under.el && c.under.el !== (c.flat && c.flat.el) && c.under.el.parentNode) {
          c.under.el.parentNode.removeChild(c.under.el);       /* 目标页还没用上，拆掉 */
        }
        host.classList.remove('rv-curl-rev');
        busy = false;
      }

      /** 手指按下：先记位置，等横向位移够大再决定掀哪一边 */
      function curlBegin(x, y) {
        if (busy || curl) return false;
        curl = { dir: 0, p: 0, dragging: true, settled: false, x0: x, y0: y, lastX: x, lastT: Date.now(), vel: 0, animRaf: null, paintRaf: null };
        return true;
      }
      function curlMove(x, y) {
        if (!curl || !curl.dragging) return false;
        const dx = x - curl.x0;
        if (!curl.dir) {
          if (Math.abs(dx) < 10) return true;                       /* 还看不出方向 */
          if (Math.abs(dx) < Math.abs(y - curl.y0)) return false;    /* 纵向为主：不抢滚动 */
          const dir = dx < 0 ? 1 : -1;
          const org = curl;
          if (!setupCurl(dir, null, org)) { curl = null; return false; }
          curl.dragging = true;
        }
        const t = Date.now();
        curl.vel = Math.abs(x - curl.lastX) / Math.max(1, t - curl.lastT);
        curl.lastX = x;
        curl.lastT = t;
        curl.p = U.clamp(Math.abs(dx) / Math.max(1, W), 0, 1);
        if (!curl.paintRaf) {
          curl.paintRaf = global.requestAnimationFrame(() => {
            if (curl) curl.paintRaf = null;
            paintCurl();
          });
        }
        return true;
      }
      /** 松手：拖过 38% 或甩得够快就翻过去，否则回弹 */
      function curlEnd(x) {
        const c = curl;
        if (!c) return false;
        if (!c.dir) { curl = null; return false; }                   /* 没掀起来，当点击处理 */
        const p = U.clamp(Math.abs(x - c.x0) / Math.max(1, W), 0, 1);
        const vel = Math.abs(x - c.lastX) / Math.max(1, Date.now() - c.lastT);
        c.dragging = false;
        const go = p > 0.38 || (vel > 0.55 && p > 0.12);
        if (liveState) { liveState.curlP = p; liveState.curlVel = vel; liveState.curlGo = go; liveState.curlDir = c.dir; }
        if (go) commitCurl(120 + 220 * (1 - p));
        else animateCurl(0, 160 + 200 * p, cancelCurl);
        return true;
      }

      /** 重建当前章（字号 / 屏幕尺寸变了）：按章内比例停回原来那一页附近 */
      function rebuild(frac) {
        cancelCurl();                        /* 重新分列前先把卷曲层收干净 */
        const ci = pos.ci;
        const layer = buildLayer(ci, 0);
        setPage(layer, Math.round(U.clamp(frac, 0, 1) * Math.max(0, layer.pages - 1)));
        dropOthers(layer.el);
        cur = layer;
        pos.ci = ci;
        pos.pi = layer.pi;
        pos.pages = layer.pages;
      }

      const api = {
        kind: 'paged',
        restore: function () {
          geometry();
          const ci = U.clamp(currentIndex, 0, N - 1);
          const layer = buildLayer(ci, 0);
          cur = layer;
          pos.ci = ci;
          pos.pages = layer.pages;
          let pi = Math.round(restoreFrac * Math.max(0, layer.pages - 1));
          const prog = book.progress || {};
          /* 上次就停在这一页而且页数没变：精确回到同一页 */
          if (prog.chapterIndex === ci && typeof prog.pageIndex === 'number' && prog.pageCount === layer.pages) {
            pi = prog.pageIndex;
          }
          pos.pi = setPage(layer, pi);
          syncMarks();
          updateProgress();
          saveReading();
        },
        position: function () {
          const pages = Math.max(1, pos.pages);
          const frac = pages > 1 ? (pos.pi / (pages - 1)) : 0;
          const percent = U.clamp((prefix[pos.ci] + frac * chars[pos.ci]) / totalChars, 0, 1);
          return { idx: pos.ci, frac: frac, percent: percent };
        },
        pageInfo: function () {
          return { pageIndex: pos.pi, pageCount: Math.max(1, pos.pages) };
        },
        relayout: function () {
          if (!cur) return;
          if (busy) {                       /* 翻页动画还在跑：等它收尾再重新分列 */
            later(() => { if (!disposed && !busy) api.relayout(); }, 420);
            return;
          }
          const frac = cur.pages > 1 ? (cur.pi / (cur.pages - 1)) : 0;
          geometry();
          rebuild(frac);
          updateProgress();
          saveReading();
        },
        onChrome: function () {
          /* 工具栏落下 / 收起后可用高度变了：等过渡结束再重新分列 */
          later(() => {
            if (disposed) return;
            geometry();
            rebuild(cur && cur.pages > 1 ? (cur.pi / (cur.pages - 1)) : 0);
            updateProgress();
            saveReading();
          }, 340);
        },
        jump: function (i) {
          cancelCurl();                      /* 切章不留动画层 */
          geometry();
          const layer = buildLayer(U.clamp(i, 0, N - 1), 0);
          dropOthers(layer.el);
          cur = layer;
          pos.ci = U.clamp(i, 0, N - 1);
          pos.pi = 0;
          pos.pages = layer.pages;
        },
        turn: turn,
        curlBegin: curlBegin,
        curlMove: curlMove,
        curlEnd: curlEnd,
        cancelCurl: cancelCurl,
        syncMarks: function () {
          if (cur) applyMarksToChapter(cur.ci, cur.head, cur.body);
        },
        destroy: function () {
          cancelCurl();
          U.$$('.rv-pager', host).forEach((n) => { if (n.parentNode) n.parentNode.removeChild(n); });
          U.$$('.rv-curl-flap', host).forEach((n) => { if (n.parentNode) n.parentNode.removeChild(n); });
          if (host.parentNode) host.parentNode.removeChild(host);
          view.classList.remove('rv-noscroll');
        }
      };
      return api;
    }

    function destroyLayout() {
      if (!layout) return;
      try { layout.destroy(); } catch (e) { /* noop */ }
      layout = null;
    }

    /** 建当前版式的正文容器，并还原到上次读到的位置。
        注意：这里不做 updateProgress —— 滚动版式要等占位块摆好、位置还原之后再算，
        否则会在「同步渲染」这一帧里强行触发整本书的排版（打开就慢了）。 */
    function buildLayout() {
      destroyLayout();
      layout = (pageMode === 'scroll') ? createScrollLayout() : createPagedLayout();
      if (liveState) liveState.layout = layout.kind;
      layout.restore();
    }

    /* ---- 触摸 / 鼠标手势 ---- */
    const ptr = { on: false, x: 0, y: 0, t: 0, swiped: false, curl: false };
    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ptr.on = true;
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      ptr.t = Date.now();
      ptr.swiped = false;
      ptr.curl = false;
      /* 仿真翻页：手指一落下就先等着，横拖就跟着走 */
      if (e.pointerType !== 'mouse' && pageMode === 'curl' && layout && layout.curlBegin) {
        ptr.curl = layout.curlBegin(e.clientX, e.clientY) === true;
      }
    }
    function onPointerMove(e) {
      if (!ptr.on) return;
      /* 鼠标不参与滑动手势：拖拽在桌面上的本意是选字（用左右点击区 / 键盘翻页） */
      if (e.pointerType === 'mouse') return;
      /* 仿真翻页：页面跟着手指卷起来 */
      if (ptr.curl && layout && layout.curlMove) {
        if (layout.curlMove(e.clientX, e.clientY)) { ptr.swiped = true; return; }
      }
      if (!layout || layout.kind !== 'paged' || pageMode === 'curl') return;
      const dx = e.clientX - ptr.x;
      const dy = e.clientY - ptr.y;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx < 46 || adx < ady * 1.3) return;
      if (turn(dx < 0 ? 1 : -1)) { ptr.swiped = true; ptr.on = false; }
    }
    function onPointerUp(e) {
      if (ptr.curl && layout && layout.curlEnd) {
        const handled = layout.curlEnd(e.clientX, e.clientY);
        ptr.curl = false;
        if (handled) { ptr.on = false; ptr.swiped = false; return; }
      }
      if (!ptr.on) { ptr.swiped = false; return; }
      ptr.on = false;
      if (ptr.swiped) { ptr.swiped = false; return; }
      const dx = Math.abs(e.clientX - ptr.x);
      const dy = Math.abs(e.clientY - ptr.y);
      if (dx > 12 || dy > 12) {
        /* 分页模式：上下轻扫也翻一页 */
        if (layout && layout.kind === 'paged' && pageMode !== 'curl' && dy > 70 && dy > dx * 1.4 && Date.now() - ptr.t < 700) turn(dy < 0 ? 1 : -1);
        return;
      }
      if (Date.now() - ptr.t > 520) return;          // 长按不是点击
      handleTap(e);
    }
    function onPointerCancel() {
      ptr.on = false;
      ptr.swiped = false;
      if (ptr.curl && layout && layout.cancelCurl) layout.cancelCurl();
      ptr.curl = false;
    }

    function hasSelection() {
      try {
        const s = global.getSelection && global.getSelection();
        return !!(s && String(s.toString() || '').trim());
      } catch (e) { return false; }
    }

    /** 点正文：收起 / 落下工具栏；整页与滑动模式下左右两侧是翻页区 */
    function handleTap(e) {
      const t = e.target;
      if (t && t.closest && t.closest('a,button,input,textarea,select,label,summary,[contenteditable="true"],.rv-notap')) return;
      if (hasSelection()) return;
      if (UI.isSheetOpen && UI.isSheetOpen()) return;
      const panel = document.getElementById('brightnessPanel');
      if (panel && !panel.classList.contains('hidden')) return;   // 亮度面板开着时不抢点击
      /* 开关以设置里的实时值为准（设置面板里改完立刻生效） */
      if ((Store.state.settings || {}).readerTapMenu === false) return;
      if (layout && layout.kind === 'paged') {
        const rect = view.getBoundingClientRect();
        const x = (e.clientX - rect.left) / Math.max(1, rect.width);
        if (x < 0.26) { turn(-1); return; }
        if (x > 0.74) { turn(1); return; }
      }
      toggleChrome();
    }

    /* ---- 键盘：← / → 翻页，Esc 恢复工具栏 ---- */
    function onKey(e) {
      if (e.defaultPrevented) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (UI.isSheetOpen && UI.isSheetOpen()) return;
      if (e.key === 'Escape') { setChromeHidden(false); return; }
      const paged = !!(layout && layout.kind === 'paged');
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); turn(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); turn(-1); }
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (paged) turn(1);
        else { setScroll(view.scrollTop + screenStep(), false); updateProgress(); saveReading(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (paged) turn(-1);
        else { setScroll(Math.max(0, view.scrollTop - screenStep()), false); updateProgress(); saveReading(); }
      }
    }

    view.addEventListener('pointerdown', onPointerDown, { passive: true });
    view.addEventListener('pointermove', onPointerMove, { passive: true });
    view.addEventListener('pointerup', onPointerUp, { passive: true });
    view.addEventListener('pointercancel', onPointerCancel, { passive: true });
    document.addEventListener('keydown', onKey);

    const onScroll = U.throttle(() => {
      /* throttle 会留一个尾巴：页面已经切走时不能再按旧位置写进度 */
      if (disposed) return;
      updateProgress();
      saveReading();
    }, 400);
    view.addEventListener('scroll', onScroll);

    /* ------------------------------------------------------------------ */
    /* 目录                                                              */
    /* ------------------------------------------------------------------ */
    function tocSheet() {
      const marksByChapter = {};
      (book.bookmarks || []).forEach((m) => {
        const ci = U.clamp(Number(m.chapterIndex) || 0, 0, N - 1);
        marksByChapter[ci] = (marksByChapter[ci] || 0) + 1;
      });
      const totalMarks = Object.keys(marksByChapter).length;
      UI.sheet({
        title: '目录（' + chapters.length + ' 章）',
        body: (host) => {
          let onlyMarks = false;
          function chip(label, on, fn, attrs) {
            return U.el('button.chip' + (on ? '.active' : ''), Object.assign({ text: label, onclick: fn }, attrs || {}));
          }
          const list = U.el('div.list');
          function paintList() {
            U.clear(list);
            let shown = 0;
            chapters.forEach((c, i) => {
              const marked = !!marksByChapter[i];
              if (onlyMarks && !marked) return;
              shown++;
              list.appendChild(U.el('div.toc-item.tap' + (i === currentIndex ? '.active' : '') + (marked ? '.rv-toc-marked' : ''), {
                dataset: { chapter: String(i) },
                onclick: () => { UI.closeSheet(); later(() => jump(i), 60); }
              }, [
                U.el('div.toc-num', { text: String(i + 1) }),
                U.el('div.row-main', {}, [
                  U.el('div.row-title', { text: c.title || ('第 ' + (i + 1) + ' 章') }),
                  U.el('div.row-sub', {
                    text: wordsText(c.words || U.words(c.content || ''))
                      + (marked ? ' · ' + marksByChapter[i] + ' 个书签' : '')
                  })
                ]),
                marked ? U.el('span.rv-toc-mark', { title: '有书签', 'aria-label': '有书签' }, U.icon('bookmark', 'ico-sm')) : null,
                i === currentIndex ? U.el('span.badge', { text: '在读' }) : null
              ]));
            });
            if (!shown) U.append(list, U.el('div.empty', {}, U.el('div.empty-title', { text: '这本书还没有书签' })));
          }
          const chips = U.el('div.chips', { style: { marginBottom: '10px' } }, [
            chip('全部章节', !onlyMarks, () => { onlyMarks = false; sync(); }, { 'data-rv': 'toc-all' }),
            chip('只看有书签' + (totalMarks ? '（' + totalMarks + '）' : ''), onlyMarks, () => { onlyMarks = true; sync(); }, { 'data-rv': 'toc-marks' })
          ]);
          function sync() {
            U.$$('.chip', chips).forEach((c) => c.classList.remove('active'));
            const target = chips.querySelector(onlyMarks ? '[data-rv="toc-marks"]' : '[data-rv="toc-all"]');
            if (target) target.classList.add('active');
            paintList();
          }
          paintList();
          U.append(host, [chips, list]);
        }
      });
    }

    /* ------------------------------------------------------------------ */
    /* 阅读操作（含收藏爱心、翻页方式、书签列表）                           */
    /* ------------------------------------------------------------------ */
    function readerMenu() {
      const marks = (book.bookmarks || []).slice().sort((a, b) => b.at - a.at);
      UI.sheet({
        title: '阅读操作',
        body: (host) => {
          U.append(host, U.el('div.rv-menu-head', {}, [
            coverEl(book),
            U.el('div.rv-menu-info', {}, [
              U.el('div.rv-menu-title', { text: book.title || '读物' }),
              U.el('div.rv-menu-sub', { text: chapterLabel(book) + ' · ' + wordsText(Store.bookWords(book)) + (book.author ? ' · ' + book.author : '') }),
              U.el('div', { style: { marginTop: '8px' } }, likeButton(book, 'wide'))
            ])
          ]));

          const modeChips = U.el('div.chips');
          PAGE_MODES.forEach((m) => {
            modeChips.appendChild(U.el('button.chip' + (pageMode === m.id ? '.active' : ''), {
              'data-rv': 'mode-' + m.id, text: m.label, title: m.sub,
              onclick: () => { UI.closeSheet(); later(() => applyMode(m.id, true), 80); }
            }));
          });
          U.append(host, U.el('div.field', {}, [U.el('label', { text: '翻页方式' }), modeChips]));

          const list = U.el('div.list');
          [{
            label: '阅读设置', sub: '字号 / 行距 / 深色 / 亮度', icon: 'text',
            fn: () => { UI.closeSheet(); later(() => readingSettings({ onMode: applyMode, onTapMenu: setTapMenu }), 100); }
          }, {
            label: '目录', sub: chapters.length + ' 章', icon: 'list',
            fn: () => { UI.closeSheet(); later(tocSheet, 100); }
          }, {
            label: '搜索本书内容', icon: 'search',
            fn: () => { UI.closeSheet(); later(() => bookSearch(book, chapters), 100); }
          }, {
            label: markBtn.classList.contains('on') ? '取消这个书签' : '加书签（当前位置）', icon: 'bookmark',
            fn: () => toggleBookmarkNow()
          }, {
            label: '导出全文 TXT', icon: 'down',
            fn: () => {
              const text = chapters.map((c) => (c.title || '') + '\n\n' + (c.content || '')).join('\n\n');
              IO.download((book.title || '读物') + '.txt', text, 'text/plain');
              UI.toast('已导出', 'down');
            }
          }, {
            label: '删除这本读物', icon: 'trash', danger: true,
            fn: () => UI.confirm('删除读物', '「' + book.title + '」将被删除。', '删除', true).then((ok) => {
              if (ok) { Store.deleteBook(book.id); UI.toast('已删除', 'trash'); UI.go('reader'); }
            })
          }].forEach((it) => list.appendChild(U.el('div.row.tap', { onclick: () => { UI.closeSheet(); setTimeout(it.fn, 80); } }, [
            U.el('span.row-chev', { style: { color: it.danger ? 'var(--danger)' : 'var(--text-2)' } }, U.icon(it.icon, 'ico-sm')),
            U.el('div.row-main', {}, [U.el('div.row-title', { text: it.label, style: it.danger ? { color: 'var(--danger)' } : null }), it.sub ? U.el('div.row-sub', { text: it.sub }) : null])
          ])));
          U.append(host, list);

          if (marks.length) {
            const ml = U.el('div.list', { style: { marginTop: '14px' } });
            marks.slice(0, 20).forEach((m) => ml.appendChild(U.el('div.row.tap', {
              dataset: { mark: m.id },
              onclick: () => { UI.closeSheet(); later(() => jump(m.chapterIndex || 0), 60); }
            }, [
              U.el('span.row-chev', {}, U.icon('bookmark', 'ico-sm')),
              U.el('div.row-main', {}, [
                U.el('div.row-title', { text: U.excerpt(m.text, 26) || '书签' }),
                U.el('div.row-sub', { text: (m.chapterTitle || '') + ' · ' + U.fmtWhen(m.at) })
              ]),
              U.el('button.icon-btn', {
                onclick: (e) => { e.stopPropagation(); Store.removeBookmark(book.id, m.id); syncMarks(); UI.closeSheet(); UI.toast('已删除书签', 'trash'); }
              }, U.icon('close', 'ico-sm'))
            ])));
            U.append(host, [U.el('div.section-title', {}, [U.el('span', { text: '书签' }), U.el('span.spacer'), U.el('span', { text: marks.length + ' 条', style: { fontWeight: '500' } })]), ml]);
          }
        }
      });
    }

    /* ---- 阅读计时 ----
       只有「计入成就」的书才累计到全局阅读统计（阅读成就的数据来源）；
       每本书自己的阅读时长始终记录，用于「约剩 N 分钟」这类提示。 */
    let readMs = 0;
    const tickTimer = setInterval(() => {
      if (document.hidden) return;
      readMs += 5000;
      if (readMs % 30000 === 0) {
        if (book.countAchievements === true) Stats.touchReading(Store.state, readMs, book.id);
        Store.updateBook(book.id, { readingMs: (book.readingMs || 0) + readMs });
        readMs = 0;
      }
    }, 5000);

    function flushRead() {
      if (readMs > 0) {
        if (book.countAchievements === true) Stats.touchReading(Store.state, readMs, book.id);
        Store.updateBook(book.id, { readingMs: (book.readingMs || 0) + readMs });
        readMs = 0;
      }
      Store.flushLocal();
    }

    /* ------------------------------------------------------------------ */
    /* 开卷：量工具栏 → 建正文容器（滚动版式首屏同步排版 / 分页版式当前章   */
    /* 分列）→ 还原上次读到的位置 → 画书签标记                              */
    /* ------------------------------------------------------------------ */
    const onResize = U.debounce(() => {
      if (disposed) return;
      measureChrome();
      relayoutSoon();
    }, 260);
    global.addEventListener('resize', onResize);

    applyMode(pageMode, false);        // 先定好版式（不会触发重建）

    /* liveState 要在建版式之前挂好：buildLayout() 里的 updateProgress 会往里写页码 */
    liveState = {
      bookId: book.id,
      title: book.title || '',
      mode: pageMode,
      layout: '',
      tapMenu: tapMenu,
      chromeOff: chromeOff,
      idx: currentIndex,
      pageIndex: 0,
      pageCount: 0,
      curlDir: 0,
      curlP: 0,
      curlVel: 0,
      curlGo: null,
      currentPct: Math.round(((book.progress && book.progress.percent) || 0) * 100),
      percent: (book.progress && book.progress.percent) || 0,
      marks: (book.bookmarks || []).length,
      marked: false,
      chapters: N
    };

    buildLayout();

    return function () {
      disposed = true;
      liveState = null;
      timers.forEach((id) => clearTimeout(id));
      clearInterval(tickTimer);
      relayoutSoon.cancel();
      global.removeEventListener('resize', onResize);
      destroyLayout();
      view.removeEventListener('scroll', onScroll);
      view.removeEventListener('pointerdown', onPointerDown);
      view.removeEventListener('pointermove', onPointerMove);
      view.removeEventListener('pointerup', onPointerUp);
      view.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('keydown', onKey);
      /* UI.render 只会清掉 flush，这些类要自己摘干净，别影响别的页面 */
      view.classList.remove('rv-reader', 'rv-mode-scroll', 'rv-mode-page', 'rv-mode-slide', 'rv-noscroll');
      root.classList.remove('rv-chrome-off');
      root.style.removeProperty('--rv-appbar-h');
      root.style.removeProperty('--rv-tabbar-h');
      root.style.removeProperty('--rv-bottombar-h');
      if (appbarEl && appbarEl.contains(actions)) appbarEl.removeChild(actions);
      flushRead();
      Stats.recalcGaps();
    };
  }

  function bookSearch(book, chapters) {
    const input = U.el('input.input', { type: 'search', placeholder: '搜索本书内容' });
    const host = U.el('div', { style: { marginTop: '10px' } });
    function run() {
      U.clear(host);
      const query = input.value.trim().toLowerCase();
      if (!query) return;
      const hits = [];
      chapters.forEach((c, i) => {
        const text = (c.content || '');
        const low = text.toLowerCase();
        let pos = low.indexOf(query);
        while (pos >= 0 && hits.length < 80) {
          hits.push({ i: i, title: c.title, snippet: text.slice(Math.max(0, pos - 24), pos + query.length + 40).replace(/\s+/g, ' ') });
          pos = low.indexOf(query, pos + query.length);
        }
      });
      if (!hits.length) { U.append(host, U.el('div.empty', {}, [U.el('div.empty-title', { text: '没有找到' })])); return; }
      const list = U.el('div.list');
      hits.forEach((hit) => list.appendChild(U.el('div.row.tap', {
        onclick: () => { UI.closeSheet(); setTimeout(() => { UI.go('read/' + book.id + '/' + hit.i); }, 60); }
      }, [
        U.el('div.row-main', {}, [
          U.el('div.row-title', { text: hit.title || ('第 ' + (hit.i + 1) + ' 章') }),
          U.el('div.row-sub', { text: '…' + hit.snippet + '…' })
        ])
      ])));
      U.append(host, [U.el('div', { text: '共 ' + hits.length + ' 处匹配', style: { fontSize: '11.5px', color: 'var(--text-3)', marginBottom: '8px' } }), list]);
    }
    input.addEventListener('input', U.debounce(run, 200));
    UI.sheet({ title: '搜索本书', body: (h) => { U.append(h, [input, host]); }, autoFocus: true });
  }

  /* 调试 / 自动化断言用：返回纯数据快照，不暴露任何 DOM 或 Store 内部对象 */
  RV.PAGE_MODES = PAGE_MODES;
  RV.config = function () { return shelfConfig(); };
  RV.current = function () { return liveState ? Object.assign({}, liveState) : null; };
  RV.shelf = function () {
    const st = Store.state;
    return {
      filter: shelfFilter,
      cols: shelfConfig().cols,
      coverWidth: shelfConfig().coverWidth,
      books: (st.reading || []).map((b) => ({
        id: b.id, title: b.title || '', chapters: chapterCount(b), liked: Store.isLiked(b.id)
      }))
    };
  };

  global.ReaderView = RV;
  /* 供导入对话框调用（「网址下载」入口） */
  global.ReaderDownload = downloadFlow;
})(window);
