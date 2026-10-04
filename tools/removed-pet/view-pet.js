/* ==========================================================================
   selfwriting · view-pet.js
   桌宠的「长相」与「表情」：内联 SVG 画的布偶+ 场景小物 + 气泡 + 动作菜单
   画法（照着布偶猫的品种特征来）
     · 身体是奶白长毛，色点落在「脸/ / / 四肢末端」上：三套配          seal    海豹重点色：奶白 + 深褐重点
          blue    蓝重点色：奶+ 灰蓝重点
          bicolor 双色：脸上V 白面+ 四只白手     · 颜色写成 CSS 变量-fur-* / --pt-* / --eye-*），JS 只把调色板挂       #petRoot style 上，配色切换不重SVG     · 体积感靠多层渐变 + 阴影 + 高光 + 腮部绒毛 + 波浪毛边，不       feTurbulence 之类昂贵的滤镜（手机上会掉帧）     · 每个可动部件单独分组：胸(呼吸) / / 眼皮 / / 两段) / 前后爪，
       动画全部CSS 关键帧，页面隐藏时统一暂停
   手势三档（时长判定在 js/pet.js，这里只负责计时、进度反馈与转发     点按 <350ms 反应50ms.5s 动作菜单；≥3s 取消 / 保留对话   ========================================================================== */
(function (global) {
  'use strict';

  const doc = global.document;
  const NS = 'http://www.w3.org/2000/svg';

  const BASE_SIZE = 104;          // 点按区边长（视觉大小按等级缩放，applyGrowth  const MENU_W = 226;

  /* ---------------- 三套配色 ----------------
     依据 CFA 布偶猫品种标准：
       · 海豹重点色的身子不是纯白，是「暖调的浅鹿色到奶油色」，肚子更浅
       · 蓝重点色的身子是「冷调的蓝白色」，重点色是深蓝灰（slate 鼻头/肉垫       · 重点色「深浅一致」——脸/ / 四肢 / 尾同一个色，不能尾巴更       · 双色：鼻子粉色，下巴胸腹白，而耳朵与尾巴仍是完整的重点  ---------------------------------------------------------------- */

  const COATS = {
    seal: {
      bodyA: '#f9efdd', bodyB: '#f2e7d6', bodyC: '#e6d8c3',
      belly: '#fdf8f0', ruffA: '#fffdf9', ruffB: '#f3e9db',
      mask: '#5c4331', maskSoft: '#7a5c46', point: '#5c4331', pointSoft: '#7a5c46', ptDeep: '#4a3425',
      earIn: '#e8b4b0', earFur: '#d9c3b4', nose: '#c98a92', noseLine: '#8a6a5e', mouth: '#6d564a',
      pad: '#e8b0b6', blaze: '#f6ecdb', lid: '#8f7460', lidSoft: '#a98d76', eyeLine: '#3f4a52', whisker: '#cbb9a6',
      shade: 'rgba(110, 88, 66, .2)', shade2: '#c9b7a1',
      blush: 'rgba(232, 150, 150, .34)',
      eyeA: '#a8dcf6', eyeB: '#4a7fb5', eyeC: '#2f5c8a', pupil: '#101c24',
      line: '#c3b09a', shade: 'rgba(110, 88, 66, .2)', cream: '#fdf8f0'
    },
    blue: {
      bodyA: '#f9fbfe', bodyB: '#f0f4f9', bodyC: '#e3e9f1',
      belly: '#fdfeff', ruffA: '#ffffff', ruffB: '#eef3f9',
      mask: '#8492a6', maskSoft: '#a3aebd', point: '#8492a6', pointSoft: '#a3aebd', ptDeep: '#6d7b8f',
      earIn: '#e6bcc2', earFur: '#cfd6de', nose: '#c98f9a', noseLine: '#7d8794', mouth: '#68727e',
      pad: '#e8b8bf', blaze: '#f0f4f9', lid: '#94a0af', lidSoft: '#aab4c0', eyeLine: '#414c58', whisker: '#c6ced8',
      shade: 'rgba(90, 102, 118, .18)', shade2: '#c8d0da',
      blush: 'rgba(226, 150, 165, .32)',
      eyeA: '#bde6fa', eyeB: '#5fa0d4', eyeC: '#356f9f', pupil: '#152231',
      line: '#b7bfca', shade: 'rgba(90, 102, 118, .18)', cream: '#fbfcfe'
    },
    bicolor: {
      bodyA: '#faf4e8', bodyB: '#f2ebdd', bodyC: '#e6dccb',
      belly: '#fffdf8', ruffA: '#fffefb', ruffB: '#f4ece0',
      mask: '#6d5140', maskSoft: '#8b6c58', point: '#6d5140', pointSoft: '#8b6c58', ptDeep: '#5b4234',
      earIn: '#e5b6b3', earFur: '#dcc7b7', nose: '#d98f96', noseLine: '#8a6a5e', mouth: '#6d564a',
      pad: '#e8b2b6', blaze: '#fffdf8', lid: '#96795f', lidSoft: '#ad9078', eyeLine: '#3f4a52', whisker: '#cbb9a6',
      shade: 'rgba(110, 88, 66, .18)', shade2: '#cbb9a4',
      blush: 'rgba(232, 150, 150, .32)',
      eyeA: '#a8dcf6', eyeB: '#4a7fb5', eyeC: '#2f5c8a', pupil: '#101c24',
      line: '#c3b09a', shade: 'rgba(110, 88, 66, .18)', cream: '#fffdf8'
    }
  };

  let host = null, stage = null, cat = null, scene = null;
  let bubbleEl = null, bubbleText = null;
  let menuEl = null, statsEl = null, focusRow = null, paletteEl = null;
  let ringEl = null, ringBar = null;
  let bubTimer = null, animTimer = null;
  let drag = null, holdTimer = null;
  let clickBlock = false, longFired = false, lastDragAt = 0;
  let patched = false, paused = false, pageHidden = false;

  const ACTIONS = [
    { id: 'pet', icon: '💗', label: '摸摸' },
    { id: 'feed', icon: '🐟', label: '喂食' },
    { id: 'play', icon: '🧶', label: '玩耍' },
    { id: 'sleep', icon: '😴', label: '睡觉' },
    { id: 'board', icon: '🪵', label: '猫抓板' },
    { id: 'talk', icon: '💬', label: '说话' },
    { id: 'pose', icon: '🐾', label: '换姿势' },
    { id: 'coat', icon: '🎨', label: '换配色' },
    { id: 'hide', icon: '🙈', label: '收起来' }
  ];

  const FOCUS_MIN = [25, 45, 60];

  /* ---------------- 建节点的小工---------------- */

  function applyAttrs(n, attrs) {
    if (!attrs) return;
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

  function addKids(n, kids) {
    if (!kids) return;
    (Array.isArray(kids) ? kids : [kids]).forEach((c) => { if (c) n.appendChild(c); });
  }

  function E(tag, attrs, kids) {
    const n = doc.createElement(tag);
    applyAttrs(n, attrs);
    addKids(n, kids);
    return n;
  }

  function S(tag, attrs, kids) {
    const n = doc.createElementNS(NS, tag);
    applyAttrs(n, attrs);
    addKids(n, kids);
    return n;
  }

  function path(d, fill, extra) {
    const a = { d: d, fill: fill || 'none' };
    if (extra) Object.keys(extra).forEach((k) => { a[k] = extra[k]; });
    return S('path', a);
  }

  function stroke(d, color, w, extra) {
    const a = { d: d, stroke: color, 'stroke-width': w, fill: 'none', 'stroke-linecap': 'round' };
    if (extra) Object.keys(extra).forEach((k) => { a[k] = extra[k]; });
    return S('path', a);
  }

  function flash(node, cls) {
    if (!node || !node.classList) return;
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  function once(node, cls, ms) {
    if (!node) return;
    flash(node, cls);
    global.setTimeout(function () { if (node.classList) node.classList.remove(cls); }, ms || 900);
  }

  function mmss(left) {
    const total = Math.max(0, Math.round(left / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------------- 画猫 ---------------- */

  /**
   * 布偶猫正面坐姿，坐标0..120。比例参CFA 标准   *   头宽 28:1 的楔形），身子宽 46（约 1.6 倍头宽）   *   耳朵宽基、圆尖、前倾、位置偏外，头顶两耳之间是平的（不戴「帽子」）   *   眼睛是大而微斜的椭圆（竖直枣核瞳），尾巴是蓬松的羽状、尾尖圆钝   * 可动分组   *   .pt-chest(呼吸) .pt-head(点头/歪头) .pt-lid(上眼 .pt-ear
   *   .pt-tail-a/.pt-tail-b(分段摇尾，尾尖滞 .pt-paw-f/.pt-paw-b
   */
  /* ==================================================================
     写实风布偶猫（默认画风）

     比例按真猫来（不Q 版）：头高约占整只坐高的 30%，身子拉长、有胸腔     后腿的体块关系；脸上有真实的口鼻部突起（muzzle）、下巴与胡须垫；眼睛     杏仁形蓝眼，带上下眼睑、眼线，瞳孔是竖裂；耳朵是三角带圆弧、耳内有绒毛     毛感靠「边缘毛path + 多层明暗 + 轮廓光」，不用滤镜     ================================================================== */

  /* 毛束：沿一段圆弧外侧画出锯齿状的毛边，用来做颈毛、胸毛、尾*/
  function furEdge(cx, cy, r, n, len, from, to) {
    let d = '';
    for (let i = 0; i < n; i++) {
      const a0 = from + (to - from) * (i / n);
      const a1 = from + (to - from) * ((i + 0.5) / n);
      const a2 = from + (to - from) * ((i + 1) / n);
      const l = len * (0.72 + 0.28 * Math.sin(i * 2.1));
      const p = (a, rr) => (cx + Math.cos(a) * rr).toFixed(2) + ' ' + (cy + Math.sin(a) * rr).toFixed(2);
      d += (i ? ' L' : 'M') + p(a0, r) + ' Q' + p(a1, r + l) + ' ' + p(a2, r);
    }
    return d;
  }

  function realCatSvg() {
    /* 耳朵：中等大小、宽基、圆尖、略前倾（布偶猫不能显大耳）       耳内粉色 + 几根绒毛*/
    const ear = (id, flip) => S('g', { cls: 'pt-ear', id: id }, [
      S('path', {
        d: flip
          ? 'M84 50 C 90 42 91 32 85 27 C 78 29 71 38 68 45 Z'
          : 'M36 50 C 30 42 29 32 35 27 C 42 29 49 38 52 45 Z',
        fill: 'url(#ptEarFill)'
      }),
      S('path', {
        d: flip
          ? 'M82 47 C 86 41 87 34 83 30 C 78 32 74 38 72 43 Z'
          : 'M38 47 C 34 41 33 34 37 30 C 42 32 46 38 48 43 Z',
        fill: 'var(--ear-in)', opacity: '0.8'
      }),
      stroke(flip ? 'M81 38 C 79 36 77 35 75 35 M82 42 C 80 40 78 39 76 39' : 'M39 38 C 41 36 43 35 45 35 M38 42 C 40 40 42 39 44 39',
        'var(--ear-fur)', 0.9, { opacity: '0.7' })
    ]);

    /* 眼睛：大而微斜的椭圆（不是细长的杏仁），上下眼睑 + 眼线 +
       竖裂瞳（约占虹膜1/3 左上一点高*/
    const eye = (id, cx) => S('g', { cls: 'pt-eye', id: id }, [
      S('g', { cls: 'm-open' }, [
        /* 眼球：椭圆，外角略高于内角（8°/
        S('ellipse', { cx: cx, cy: 43.4, rx: 7.2, ry: 6.6, fill: 'url(#ptEyeIris)',
          transform: 'rotate(' + (cx > 60 ? -8 : 8) + ' ' + cx + ' 43)' }),
        S('ellipse', { cx: cx, cy: 43, rx: 7, ry: 5.9, fill: 'url(#ptEyeIris)',
          transform: 'rotate(' + (cx > 60 ? -8 : 8) + ' ' + cx + ' 43)' }),
        /* 上眼睑压住上缘约 1/4 */
        S('path', {
          d: 'M' + (cx - 6) + ' 38 C ' + (cx - 3.6) + ' 34.6 ' + (cx + 3.6) + ' 34.6 ' + (cx + 6) + ' 38 '
            + 'C ' + (cx + 3.6) + ' 37 ' + (cx - 3.6) + ' 37 ' + (cx - 6) + ' 38 Z',
          fill: 'var(--lid)'
        }),
        S('ellipse', { cx: cx, cy: 43.8, rx: 2.1, ry: 5, fill: 'var(--pupil)' }),
        S('circle', { cx: cx - 2.4, cy: 41, r: 1.4, fill: '#ffffff', opacity: '0.92' }),
        /* 眼线：上粗下*/
        path('M' + (cx - 7.6) + ' 38.2 C ' + (cx - 5) + ' 34 ' + (cx + 5) + ' 34 ' + (cx + 7.6) + ' 38.2', 'none',
          { stroke: 'var(--eye-line)', 'stroke-width': '1', 'stroke-linecap': 'round', opacity: '0.75' }),
        path('M' + (cx - 6.6) + ' 44.4 C ' + (cx - 4.4) + ' 48 ' + (cx + 4.4) + ' 48 ' + (cx + 6.6) + ' 44.4', 'none',
          { stroke: 'var(--eye-line)', 'stroke-width': '0.8', 'stroke-linecap': 'round', opacity: '0.55' })
      ]),
      /* 眯眼（开心）：只剩一条上弯的*/
      S('path', {
        cls: 'm-smile',
        d: 'M' + (cx - 7) + ' 43 C ' + (cx - 4.2) + ' 39 ' + (cx + 4.2) + ' 39 ' + (cx + 7) + ' 43 '
          + 'C ' + (cx + 3.6) + ' 45 ' + (cx - 3.6) + ' 45 ' + (cx - 7) + ' 43 Z',
        fill: 'var(--eye-line)'
      }),
      /* 圆睁（惊讶）：瞳孔放大一*/
      S('g', { cls: 'm-round' }, [
        S('ellipse', { cx: cx, cy: 43, rx: 6.4, ry: 6, fill: 'url(#ptEyeIris)' }),
        S('ellipse', { cx: cx, cy: 43, rx: 6.4, ry: 6, fill: 'none', stroke: 'var(--eye-line)', 'stroke-width': '1.3' }),
        S('ellipse', { cx: cx, cy: 43, rx: 3, ry: 4.6, fill: 'var(--pupil)' }),
        S('circle', { cx: cx - 2.4, cy: 40.6, r: 1.5, fill: '#ffffff', opacity: '0.92' })
      ]),
      /* 眼皮（眨/ 睡觉*/
      S('path', {
        cls: 'pt-lid',
        d: 'M' + (cx - 8) + ' 41.2 C ' + (cx - 5) + ' 34 ' + (cx + 5) + ' 34 ' + (cx + 8) + ' 41.2 '
          + 'C ' + (cx + 5.4) + ' 48.4 ' + (cx - 5.4) + ' 48.4 ' + (cx - 8) + ' 41.2 Z',
        fill: 'var(--lid)'
      })
    ]);

    return S('svg', {
      viewBox: '0 0 120 120', width: '120', height: '120',
      cls: 'pt-svg pt-real', focusable: 'false', 'aria-hidden': 'true'
    }, [
      S('title', { text: '布偶猫桌宠（写实）' }),
      S('defs', {}, [
        S('linearGradient', { id: 'ptBody', x1: '0.2', y1: '0', x2: '0.7', y2: '1' }, [
          S('stop', { offset: '0', 'stop-color': 'var(--fur-a)' }),
          S('stop', { offset: '0.45', 'stop-color': 'var(--fur-b)' }),
          S('stop', { offset: '1', 'stop-color': 'var(--fur-c)' })
        ]),
        S('linearGradient', { id: 'ptEarFill', x1: '0', y1: '1', x2: '0.4', y2: '0' }, [
          S('stop', { offset: '0', 'stop-color': 'var(--pt-soft)' }),
          S('stop', { offset: '0.5', 'stop-color': 'var(--pt)' }),
          S('stop', { offset: '1', 'stop-color': 'var(--pt-deep)' })
        ]),
        S('linearGradient', { id: 'ptTailFill', x1: '0', y1: '1', x2: '1', y2: '0' }, [
          S('stop', { offset: '0', 'stop-color': 'var(--pt-soft)' }),
          S('stop', { offset: '0.4', 'stop-color': 'var(--pt)' }),
          S('stop', { offset: '1', 'stop-color': 'var(--pt-deep)' })
        ]),
        /* 面罩：边缘要软（真猫的重点色是渐开的），所以用径向渐变收边 */
        S('radialGradient', { id: 'ptMaskReal', cx: '0.5', cy: '0.46', r: '0.58' }, [
          S('stop', { offset: '0', 'stop-color': 'var(--mask)' }),
          S('stop', { offset: '0.88', 'stop-color': 'var(--mask)' }),
          S('stop', { offset: '1', 'stop-color': 'var(--mask)', 'stop-opacity': '0.15' })
        ]),
        S('radialGradient', { id: 'ptEyeIris', cx: '0.44', cy: '0.32', r: '0.82' }, [
          S('stop', { offset: '0', 'stop-color': 'var(--eye-a)' }),
          S('stop', { offset: '0.5', 'stop-color': 'var(--eye-b)' }),
          S('stop', { offset: '1', 'stop-color': 'var(--eye-c)' })
        ]),
        S('clipPath', { id: 'ptHeadClip' }, [S('ellipse', { cx: 60, cy: 50, rx: 23, ry: 21.5 })])
      ]),

      /* 地上的影子：柔和 */
      S('g', { cls: 'pt-ground', id: 'pt-ground' }, [
        S('ellipse', { cx: 60, cy: 110, rx: 27, ry: 3.4, fill: 'rgba(40,30,22,0.16)' })
      ]),

      /* 尾巴：三段错相位；末段是蓬松的羽状（毛束不做成均匀尖刺*/
      S('g', { cls: 'pt-tail-a', id: 'pt-tail-a' }, [
        stroke('M86 104 C 96 104 103 100 105 93', 'url(#ptTailFill)', 9.5, { 'stroke-linecap': 'round' }),
        S('g', { cls: 'pt-tail-b', id: 'pt-tail-b' }, [
          stroke('M105 93 C 107 86 104 80 99 77', 'url(#ptTailFill)', 9, { 'stroke-linecap': 'round' }),
          S('g', { cls: 'pt-tail-c', id: 'pt-tail-c' }, [
            /* 尾尖：一大两小三撮，不对称才像真*/
            S('path', {
              d: 'M93 73 C 89 66 93 61 99 62 C 105 63 107 69 104 74 C 101 78 96 78 93 73 Z',
              fill: 'var(--pt-deep)'
            }),
            S('path', { d: 'M92 71 C 87 68 86 63 89 60 C 92 63 94 67 95 71 Z', fill: 'var(--pt-deep)' }),
            S('path', { d: 'M105 72 C 110 70 113 66 112 62 C 108 64 105 68 103 71 Z', fill: 'var(--pt-deep)' }),
            S('path', { d: 'M96 77 C 94 82 97 86 101 85 C 99 82 98 79 98 76 Z', fill: 'var(--pt-deep)' }),
            S('ellipse', { cx: 99, cy: 70, rx: 4.4, ry: 3.6, fill: 'var(--pt-soft)', opacity: '0.42' })
          ])
        ])
      ]),

      /* 后腿：正面看是两侧的「毛裤」（britches），外缘带毛*/
      S('g', { cls: 'pt-paw-b', id: 'pt-paw-b' }, [
        S('path', { d: furEdge(30, 96, 13, 3, 3, 1.1, 2.3), fill: 'var(--fur-c)' }),
        S('path', { d: furEdge(90, 96, 13, 3, 3, 0.84, 2.04), fill: 'var(--fur-c)' }),
        S('ellipse', { cx: 30, cy: 96, rx: 12, ry: 10.5, fill: 'var(--fur-c)' }),
        S('ellipse', { cx: 90, cy: 96, rx: 12, ry: 10.5, fill: 'var(--fur-c)' }),
        S('ellipse', { cx: 30, cy: 94, rx: 9.5, ry: 8, fill: 'var(--fur-b)' }),
        S('ellipse', { cx: 90, cy: 94, rx: 9.5, ry: 8, fill: 'var(--fur-b)' })
      ]),

      /* 身体：长而方正（肩与臀同宽），往下收         外轮廓只留很少几撮毛束：布偶是「软的长毛」，不是炸毛球*/
      S('g', { cls: 'pt-body', id: 'pt-body' }, [
        S('path', {
          d: 'M60 60 C 77 60 88 70 91 84 C 93 94 93 102 91 106 '
            + 'C 82 108.6 71 109 60 109 C 49 109 38 108.6 29 106 '
            + 'C 27 102 27 94 29 84 C 32 70 43 60 60 60 Z',
          fill: 'url(#ptBody)'
        }),
        /* 右侧暗面：把体积压出*/
        S('path', {
          d: 'M60 60 C 77 60 88 70 91 84 C 93 94 93 102 91 106 C 85 107.7 79 108.5 73 108.8 '
            + 'C 81 104 85 94 83 80 C 81.4 70 72 62 60 60 Z',
          fill: 'var(--shade2)', opacity: '0.4'
        }),
        /* 两侧各一撮毛束，打破轮廓线就*/
        S('path', { d: furEdge(31, 92, 5, 2, 2.6, 1.0, 2.2), fill: 'var(--fur-b)' }),
        S('path', { d: furEdge(89, 92, 5, 2, 2.6, 0.95, 2.15), fill: 'var(--fur-b)' }),
        /* 肩部的高光带（光从左上打过来*/
        S('path', { d: 'M40 74 C 48 66 72 66 80 74 C 70 70 50 70 40 74 Z', fill: '#ffffff', opacity: '0.18' })
      ]),

      /* 胸前的白毛：不要做成一大圈「围脖」，只留中间一团（长毛感靠外缘毛束*/
      S('g', { cls: 'pt-chest', id: 'pt-chest' }, [
        S('path', { d: furEdge(60, 88, 11, 6, 3, 0.5, 2.64) + ' Z', fill: 'var(--ruff-b)' }),
        S('ellipse', { cx: 60, cy: 87, rx: 10.5, ry: 10, fill: 'var(--ruff-a)' }),
        S('ellipse', { cx: 60, cy: 84, rx: 7, ry: 6, fill: '#ffffff', opacity: '0.4' })
      ]),

      /* 前腿：两根明显的腿柱 + 圆爪子（脚趾不分开，用三撮毛表现） */
      S('g', { cls: 'pt-paw pt-paw-f', id: 'pt-paw-fl' }, [
        S('path', { d: 'M43 82 C 41 91 41 100 42 106 L54 106 C 55 100 55 91 53 82 Z', fill: 'var(--fur-b)' }),
        S('path', { d: 'M46 83 C 45 91 45 99 46 105 L54 106 C 55 100 55 91 53 82 Z', fill: 'var(--shade2)', opacity: '0.35' }),
        S('ellipse', { cx: 48, cy: 106, rx: 6, ry: 4.2, fill: 'var(--belly)' }),
        S('path', { d: furEdge(48, 106, 5.4, 3, 1.6, 2.7, 6.0), fill: 'var(--belly)' })
      ]),
      S('g', { cls: 'pt-paw pt-paw-f', id: 'pt-paw-fr' }, [
        S('path', { d: 'M77 82 C 79 91 79 100 78 106 L66 106 C 65 100 65 91 67 82 Z', fill: 'var(--fur-b)' }),
        S('path', { d: 'M74 83 C 75 91 75 99 74 105 L66 106 C 65 100 65 91 67 82 Z', fill: 'var(--shade2)', opacity: '0.3' }),
        S('ellipse', { cx: 72, cy: 106, rx: 6, ry: 4.2, fill: 'var(--belly)' }),
        S('path', { d: furEdge(72, 106, 5.4, 3, 1.6, 2.7, 6.0), fill: 'var(--belly)' })
      ]),

      /* */
      S('g', { cls: 'pt-head', id: 'pt-head' }, [
        ear('pt-ear-l', false), ear('pt-ear-r', true),
        /* 脸颊毛束（少数几撮、不对称*/
        S('path', { d: furEdge(60, 50, 21, 4, 2.8, 0.8, 2.34), fill: 'var(--fur-a)' }),
        /* 头：楔形但不尖，额头略拱 */
        S('ellipse', { cx: 60, cy: 50, rx: 23, ry: 21.5, fill: 'url(#ptBody)' }),
        /* 头顶轮廓*/
        S('path', { d: 'M44 38 C 49 32 71 32 76 38 C 71 35 49 35 44 38 Z', fill: '#ffffff', opacity: '0.38' }),
        S('g', { 'clip-path': 'url(#ptHeadClip)' }, [
          /* 面罩：盖住整张脸含胡须垫（品种标准如此），但不越过头顶；
             用径向渐变让边缘软开，和耳朵之间留出「tracings」的细条 */
          S('path', {
            d: 'M45 33 C 53 29 67 29 75 33 C 81 39 84 47 83 54 '
              + 'C 82 61 77 66 69 68 C 63 69.6 57 69.6 51 68 C 43 66 38 61 37 54 '
              + 'C 36 47 39 39 45 33 Z',
            fill: 'url(#ptMaskReal)'
          }),
          /* 与耳朵相连的细 tracing */
          S('path', { d: 'M45 34 C 41 32 37 31 33 31 C 36 34 39 37 41 40 Z', fill: 'var(--mask)', opacity: '0.75' }),
          S('path', { d: 'M75 34 C 79 32 83 31 87 31 C 84 34 81 37 79 40 Z', fill: 'var(--mask)', opacity: '0.75' }),
          /* 双色的V：从鼻梁往上，宽度到眼睛外角（明显但不越界*/
          S('path', {
            cls: 'pt-blaze',
            d: 'M60 26 C 68 26 72 36 73.6 50 C 71 59 66 64 60 64 '
              + 'C 54 64 49 59 46.4 50 C 48 36 52 26 60 26 Z',
            fill: 'var(--blaze)'
          }),
          /* 口鼻部：正面看几乎不往前突，就是一团圆鼓鼓的白 */
          S('ellipse', { cx: 60, cy: 62.5, rx: 11.5, ry: 8.4, fill: 'var(--cream)' }),
          S('ellipse', { cx: 60, cy: 61, rx: 11, ry: 7, fill: '#ffffff', opacity: '0.3' }),
          /* 胡须垫：两块小鼓*/
          S('ellipse', { cx: 54.4, cy: 63.6, rx: 4.8, ry: 3.8, fill: 'var(--cream)' }),
          S('ellipse', { cx: 65.6, cy: 63.6, rx: 4.8, ry: 3.8, fill: 'var(--cream)' }),
          /* 下巴 */
          S('ellipse', { cx: 60, cy: 68.6, rx: 6, ry: 3.2, fill: 'var(--cream)' }),
          /* 面罩在胡须垫下方的阴影（体积*/
          S('ellipse', { cx: 60, cy: 57, rx: 14, ry: 3, fill: 'rgba(60, 45, 34, .14)' })
        ]),
        eye('pt-eye-l', 50.2), eye('pt-eye-r', 69.8),
        /* 鼻子：小的三角带圆角，宽度约头宽0.14 */
        S('path', { d: 'M57.8 59 C 58.5 58.3 61.5 58.3 62.2 59 C 62.9 59.7 61.4 62.2 60 62.2 C 58.6 62.2 57.1 59.7 57.8 59 Z', fill: 'var(--nose)' }),
        S('path', { d: 'M60 62.2 v1.4', 'stroke': 'var(--nose-line)', 'stroke-width': '1', 'stroke-linecap': 'round', fill: 'none', opacity: '0.8' }),
        /* 嘴：浅浅W，再往上收 */
        path('M60 63.6 C 58.4 65.6 56.4 66 54.8 65.2 M60 63.6 C 61.6 65.6 63.6 66 65.2 65.2', 'none',
          { stroke: 'var(--mouth)', 'stroke-width': '1.2', 'stroke-linecap': 'round' }),
        /* 腮红：写实风很淡 */
        S('ellipse', { cls: 'pt-blush', cx: 41.5, cy: 56, rx: 4.6, ry: 2.6, fill: 'var(--blush)' }),
        S('ellipse', { cls: 'pt-blush', cx: 78.5, cy: 56, rx: 4.6, ry: 2.6, fill: 'var(--blush)' }),
        /* 胡须：细、长（约一个头宽）、微微上翘，5 */
        stroke('M49 62 C 40 61 31 60.4 24 60.8', 'var(--whisker)', 0.8, { opacity: '0.6' }),
        stroke('M49 64.6 C 40 64.8 32 65.4 25 66.6', 'var(--whisker)', 0.8, { opacity: '0.6' }),
        stroke('M50 67 C 42 68.6 36 70.6 30 73.4', 'var(--whisker)', 0.8, { opacity: '0.5' }),
        stroke('M52 69.4 C 46 71.6 41 74.4 37 78', 'var(--whisker)', 0.8, { opacity: '0.42' }),
        stroke('M71 62 C 80 61 89 60.4 96 60.8', 'var(--whisker)', 0.8, { opacity: '0.6' }),
        stroke('M71 64.6 C 80 64.8 88 65.4 95 66.6', 'var(--whisker)', 0.8, { opacity: '0.6' }),
        stroke('M70 67 C 78 68.6 84 70.6 90 73.4', 'var(--whisker)', 0.8, { opacity: '0.5' }),
        stroke('M68 69.4 C 74 71.6 79 74.4 83 78', 'var(--whisker)', 0.8, { opacity: '0.42' })
      ]),

      /* 成长特征：围/ 小领*/
      S('g', { cls: 'pt-scarf', id: 'pt-scarf' }, [
        path('M39 80 C 47 88 73 88 81 80 C 82 85 79 89 72 90 C 65 92 55 92 48 90 C 41 89 38 85 39 80 Z', '#b8514c'),
        path('M60 88 C 64 94 65 101 63 105 L54 105 C 53 98 55 92 57 88 Z', '#9d423e')
      ]),
      S('g', { cls: 'pt-bow', id: 'pt-bow' }, [
        path('M53 82 L46 77 L46 87 Z', '#4f7cb4'),
        path('M67 82 L74 77 L74 87 Z', '#4f7cb4'),
        S('circle', { cx: 60, cy: 82, r: 2.4, fill: '#3a6394' })
      ])
    ]);
  }

  /** 当前画风该画哪一*/
  function currentCatSvg() {
    try {
      return (Pet.style && Pet.style().id === 'chibi') ? catSvg() : realCatSvg();
    } catch (e) {
      return realCatSvg();      // 默认写实
    }
  }

  /** 换画风：整只重画（两种画风的骨架差别太大，重建比class 干净*/
  function applyStyle() {
    if (!host) return '';
    const id = (Pet.style && Pet.style().id) || 'real';
    host.setAttribute('data-style', id);
    if (cat) {
      const fresh = currentCatSvg();
      while (cat.firstChild) cat.removeChild(cat.firstChild);
      cat.appendChild(fresh);
    }
    return id;
  }

  /* ---------------- 场景小物 ---------------- */

  function bowlSvg() {
    return S('svg', { viewBox: '0 0 120 120', width: '120', height: '120', cls: 'prop-svg', 'aria-hidden': 'true' }, [
      S('ellipse', { cx: 92, cy: 102, rx: 17, ry: 4.5, fill: 'rgba(40,30,22,0.10)' }),
      path('M76 92 C 76 102 82 106 92 106 C 102 106 108 102 108 92 Z', '#d9a24c'),
      path('M76 92 C 76 99 82 102 92 102 C 102 102 108 99 108 92 Z', '#c08d3c'),
      S('ellipse', { cx: 92, cy: 92, rx: 16, ry: 5, fill: '#b8813a' }),
      S('ellipse', { cx: 92, cy: 91.4, rx: 13, ry: 3.8, fill: '#8d6530' }),
      /* 粮：碗空了就藏起来 */
      S('g', { cls: 'prop-food' }, [
        S('ellipse', { cx: 88, cy: 90.6, rx: 3.4, ry: 2.4, fill: '#c98a4b' }),
        S('ellipse', { cx: 94, cy: 91, rx: 3.8, ry: 2.6, fill: '#d69a58' }),
        S('ellipse', { cx: 99, cy: 90.2, rx: 3, ry: 2.2, fill: '#c07f42' })
      ]),
      S('text', { cls: 'prop-hint', x: 92, y: 80, 'text-anchor': 'middle', 'font-size': '10', fill: '#b4503c', text: '喵…' })
    ]);
  }

  function ballSvg() {
    return S('svg', { viewBox: '0 0 120 120', width: '120', height: '120', cls: 'prop-svg', 'aria-hidden': 'true' }, [
      S('ellipse', { cx: 26, cy: 100, rx: 12, ry: 4, fill: 'rgba(40,30,22,0.10)' }),
      S('circle', { cx: 26, cy: 90, r: 11, fill: '#c96a86' }),
      stroke('M18 84 C 24 90 28 96 26 100', '#f2d3dd', 2.2, { opacity: '0.9' }),
      stroke('M34 84 C 28 90 24 96 26 100', '#f2d3dd', 2.2, { opacity: '0.9' }),
      stroke('M16 90 C 22 88 30 88 36 90', '#f2d3dd', 2, { opacity: '0.75' }),
      S('circle', { cx: 22, cy: 86, r: 2.4, fill: '#ffffff', opacity: '0.5' })
    ]);
  }

  function bedSvg() {
    return S('svg', { viewBox: '0 0 160 90', width: '160', height: '90', cls: 'prop-svg', 'aria-hidden': 'true' }, [
      S('ellipse', { cx: 80, cy: 56, rx: 66, ry: 26, fill: '#e5c7a8' }),
      S('ellipse', { cx: 80, cy: 52, rx: 60, ry: 22, fill: '#f3ddc4' }),
      S('ellipse', { cx: 80, cy: 52, rx: 46, ry: 15, fill: '#d9b391' }),
      path('M34 44 C 44 30 62 24 80 24 C 98 24 116 30 126 44 C 112 36 96 33 80 33 C 64 33 48 36 34 44 Z', '#efe0cd', { opacity: '0.9' })
    ]);
  }

  function boardSvg() {
    return S('svg', { viewBox: '0 0 120 120', width: '120', height: '120', cls: 'prop-svg', 'aria-hidden': 'true' }, [
      S('ellipse', { cx: 24, cy: 102, rx: 15, ry: 4.5, fill: 'rgba(40,30,22,0.10)' }),
      path('M8 100 L16 78 L32 78 L40 100 Z', '#c39a68'),
      path('M14 78 L20 60 L28 60 L34 78 Z', '#d8b487'),
      stroke('M18 66 h8 M17 72 h10', '#b08a5c', 1.4, { opacity: '0.8' }),
      stroke('M12 86 h24 M13 92 h22', '#b08a5c', 1.2, { opacity: '0.6' })
    ]);
  }

  function noteSvg() {
    return S('svg', { viewBox: '0 0 60 60', width: '60', height: '60', cls: 'prop-svg', 'aria-hidden': 'true' }, [
      path('M8 10 L52 10 L52 44 L38 54 L8 54 Z', '#fdf3d8'),
      path('M8 10 L52 10 L52 44 L38 54 L8 54 Z', 'none', { stroke: '#e2d3ac', 'stroke-width': '1.2' }),
      path('M38 54 L52 44 L38 44 Z', '#efe0b8'),
      stroke('M15 20 h30 M15 27 h30 M15 34 h22', '#c9b070', 1.6, { opacity: '0.9' })
    ]);
  }

  /* ---------------- 根节---------------- */

  function build() {
    const root = E('div', { id: 'petRoot', cls: 'pet-root', 'data-pet': 'root', 'data-coat': 'seal' });
    root.setAttribute('aria-hidden', 'true');

    bubbleEl = E('div', { cls: 'pet-bubble', 'data-pet': 'bubble' }, [
      E('span', { cls: 'pet-bubble-text', text: '' })
    ]);
    bubbleText = bubbleEl.firstChild;

    /* 长按 3 秒的进度*/
    ringEl = S('svg', { viewBox: '0 0 120 120', cls: 'pt-ring', 'aria-hidden': 'true' }, [
      S('circle', { cx: 60, cy: 60, r: 54, fill: 'none', stroke: 'rgba(180,80,60,0.20)', 'stroke-width': '3.5' }),
      S('circle', {
        cls: 'pt-ring-bar', cx: 60, cy: 60, r: 54, fill: 'none', stroke: '#b4503c',
        'stroke-width': '3.5', 'stroke-linecap': 'round', 'stroke-dasharray': '339.3', 'stroke-dashoffset': '339.3'
      })
    ]);
    ringBar = ringEl.lastChild;

    cat = E('div', { cls: 'pet-body', 'data-pet': 'body' }, currentCatSvg());

    scene = E('div', { cls: 'pet-scene', 'data-pet': 'scene' }, [
      E('div', { cls: 'prop prop-bed', 'data-prop': 'bed' }, bedSvg()),
      E('div', { cls: 'prop prop-board', 'data-prop': 'board' }, boardSvg()),
      E('div', { cls: 'prop prop-bowl', 'data-prop': 'bowl' }, bowlSvg()),
      E('div', { cls: 'prop prop-ball', 'data-prop': 'ball' }, ballSvg()),
      E('button', {
        cls: 'prop prop-note', 'data-prop': 'note', type: 'button', 'aria-label': '收起纸条',
        onclick: function (e) { e.stopPropagation(); try { global.Pet.clearScene('note'); } catch (err) { /* noop */ } }
      }, noteSvg())
    ]);

    const home = E('button', {
      cls: 'pet-home', type: 'button', 'data-pet': 'home', 'aria-label': '回家', title: '回家'
    }, [
      E('svg', { viewBox: '0 0 24 24', width: '14', height: '14', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
        E('path', { d: 'M4 11l8-7 8 7M6 10v9h12v-9' })
      ])
    ]);
    home.addEventListener('click', function (e) {
      e.stopPropagation();
      try { global.Pet.goHome(); } catch (err) { /* noop */ }
    });

    stage = E('div', { cls: 'pet-stage' }, [scene, cat]);
    root.appendChild(bubbleEl);
    root.appendChild(ringEl);
    root.appendChild(stage);
    root.appendChild(home);

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    root.addEventListener('lostpointercapture', onUp);
    root.addEventListener('click', onClick);
    root.addEventListener('contextmenu', function (e) { e.preventDefault(); });
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

    paletteEl = E('div', { cls: 'pet-palette', 'data-pet': 'palette' });
    m.appendChild(paletteEl);

    const grid = E('div', { cls: 'pet-actions' });
    ACTIONS.forEach(function (a) {
      const b = E('button', { cls: 'pet-act', type: 'button', 'data-pet-act': a.id, title: a.label }, [
        E('span', { cls: 'pa-ico', text: a.icon }),
        E('span', { cls: 'pa-label', text: a.label })
      ]);
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        try { Pet.action(a.id); } catch (err) { /* noop */ }
        if (a.id === 'hide' || a.id === 'coat') closeMenu();
      });
      grid.appendChild(b);
    });
    m.appendChild(grid);

    focusRow = E('div', { cls: 'pet-focus', 'data-pet': 'focus' });
    m.appendChild(focusRow);
    syncFocusRow();
    syncPalette();

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

  function syncPalette() {
    if (!paletteEl) return;
    while (paletteEl.firstChild) paletteEl.removeChild(paletteEl.firstChild);
    const cur = Pet.coat().id;
    Pet.coats().forEach(function (c) {
      const b = E('button', {
        cls: 'pet-color' + (c.id === cur ? ' sel' : ''), type: 'button',
        'data-pet-color': c.id, title: c.name, 'aria-label': c.name
      });
      b.style.background = c.swatch;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        try { Pet.setCoat(c.id); } catch (err) { /* noop */ }
        syncPalette();
      });
      paletteEl.appendChild(b);
    });
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
    if (!host || Pet.isHidden()) return false;
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
    syncPalette();
    menuEl.classList.add('show');
    place();
    host.classList.add('menu-open');
    return true;
  }

  function closeMenu() {
    if (menuEl) menuEl.classList.remove('show');
    if (host) host.classList.remove('menu-open');
    return true;
  }

  function isMenuOpen() { return !!(menuEl && menuEl.classList.contains('show')); }

  /* ---------------- 气泡 / 粒子 ---------------- */

  function bubble(text, ms) {
    if (!bubbleEl || !text) return false;
    bubbleText.textContent = String(text);
    bubbleEl.classList.add('show');
    if (bubTimer) global.clearTimeout(bubTimer);
    bubTimer = global.setTimeout(function () {
      bubTimer = null;
      bubbleEl.classList.remove('show');
    }, Math.max(1200, ms || 4200));
    place();
    return true;
  }

  function particle(kind) {
    if (!host) return;
    const map = {
      heart: '💗', fish: '🐟', yarn: '🧶', paw: '🐾', zzz: '💤', star: '✨',
      butterfly: '🦋', note: '📝', bowl: '🍚', board: '🐾'
    };
    const alt = { purr: 'purr', happy: 'star', jump: 'star', poke: 'star', scratch: 'board', hungry: 'bowl', nuzzle: 'heart' };
    const icon = map[kind] || map[alt[kind]] || '✨';
    const n = kind === 'zzz' ? 2 : (kind === 'feed' ? 3 : 4);
    for (let i = 0; i < n; i++) {
      (function (i) {
        global.setTimeout(function () {
          if (!host) return;
          const p = E('span', { cls: 'pet-particle', text: icon });
          p.style.left = (16 + i * 13 + Math.round(Math.random() * 8)) + '%';
          host.appendChild(p);
          global.setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 1500);
        }, i * 110);
      })(i);
    }
  }

  /* ---------------- 姿势 / 反应 / 成长 / 小物 ---------------- */

  function applyPose() {
    if (!host) return;
    host.setAttribute('data-pose', Pet.get().pose || 'sit');
  }

  function applyCoat() {
    if (!host) return;
    const id = Pet.coat().id;
    const c = COATS[id] || COATS.seal;
    host.setAttribute('data-coat', id);
    Object.keys(c).forEach(function (k) {
      host.style.setProperty('--' + k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }), c[k]);
    });
    if (paletteEl) syncPalette();
    return id;
  }

  function applyMood(m) {
    if (!host) return '';
    const mood = m || (Pet.mood ? Pet.mood() : 'curious');
    host.setAttribute('data-mood', mood);
    return mood;
  }

  function applyGrowth() {
    if (!host) return;
    const d = Pet.decorate();
    /* 视觉大小跟着等级走；点按区由 CSS --pet-size 控制，仍只覆盖猫本身 */
    host.style.setProperty('--cat-scale', String(d.scale));
    host.classList.toggle('has-scarf', !!d.scarf);
    host.classList.toggle('has-bow', !!d.bow);
    host.setAttribute('data-level', String(d.level));
    return d.level;
  }

  function applyScene() {
    if (!host) return;
    const s = Pet.scene();
    host.classList.toggle('sc-bowl', !!s.bowl);
    host.classList.toggle('sc-bowl-empty', !!s.bowlEmpty);
    host.classList.toggle('sc-ball', !!s.ball);
    host.classList.toggle('sc-bed', !!s.bed);
    host.classList.toggle('sc-board', !!s.board);
    host.classList.toggle('sc-note', !!s.note);
    return s;
  }

  function react(kind, say) {
    if (!host) return false;
    const k = kind || 'purr';
    const dur = {
      ghost: 700, blink: 400, ear: 620, type: 620, sneeze: 900, chase: 2200,
      butterfly: 2000, scratch: 1200, nuzzle: 1400, note: 1400, hungry: 1200
    };
    once(host, 'react-' + k, (dur[k] || 1000));
    if (k === 'feed') { particle('fish'); flash(host, 'sc-pop'); }
    else if (k === 'play') { particle('yarn'); flash(host, 'sc-pop'); }
    else if (k === 'pet' || k === 'happy') particle('heart');
    else if (k === 'sleep') particle('zzz');
    else if (k === 'celebrate') { particle('star'); global.setTimeout(function () { particle('heart'); }, 260); }
    else if (k === 'chase') particle('star');
    else if (k === 'butterfly') particle('butterfly');
    else if (k === 'nuzzle') particle('heart');
    else if (k === 'note') { particle('note'); flash(host, 'sc-pop'); }
    else if (k === 'scratch') particle('board');
    else if (k === 'hungry') particle('bowl');
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
      const mh = menuEl.offsetHeight || 268;
      let left = L.left + L.size / 2 - mw / 2;
      left = Math.max(8, Math.min(left, L.vw - mw - 8));
      let top = L.top - mh - 12;
      let below = false;
      if (top < 8) { top = L.top + L.size + 12; below = true; }
      menuEl.style.left = Math.round(left) + 'px';
      menuEl.style.top = Math.round(top) + 'px';
      menuEl.setAttribute('data-side', below ? 'below' : 'above');
    }
    if (bubbleEl) {
      const bw = bubbleEl.offsetWidth || 140;
      bubbleEl.style.setProperty('--bub-dx', Math.round(Math.max(6, bw / 2 - L.size / 2)) + 'px');
    }
    const st = Pet.get();
    const far = st.at && (Math.abs(st.x - 0.84) > 0.06 || Math.abs(st.y - 0.72) > 0.06);
    host.classList.toggle('show-home', !!far);
    return L;
  }

  /* ---------------- 手势：点/ 短长/ 长长---------------- */

  function clearHold() {
    if (!holdTimer) return;
    try { global.clearTimeout(holdTimer.arm); global.clearTimeout(holdTimer.end); } catch (e) { /* noop */ }
    holdTimer = null;
    if (host) { host.classList.remove('holding'); host.classList.remove('hold-done'); }
  }

  function armHold(armMs, endMs) {
    clearHold();
    holdTimer = {
      arm: global.setTimeout(function () {
        if (!drag || drag.moved) return;
        try { host.classList.add('holding'); } catch (e) { /* noop */ }
      }, armMs),
      end: global.setTimeout(function () {
        if (!drag || drag.moved) return;
        drag.long = true;
        longFired = true;
        try { host.classList.remove('holding'); host.classList.add('hold-done'); } catch (e) { /* noop */ }
        closeMenu();
        try {
          Promise.resolve(global.Pet.longHold()).then(function () {
            if (host) host.classList.remove('hold-done');
          });
        } catch (e) { /* noop */ }
      }, endMs)
    };
  }

  function onDown(e) {
    if (!host) return;
    if (e.button !== undefined && e.button > 0) return;
    if (e.target && e.target.closest && e.target.closest('.pet-menu')) return;
    if (e.target && e.target.closest && e.target.closest('.prop-note')) return;
    const L = Pet.layout();
    drag = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: Date.now(),
      left: L.left, top: L.top, vw: L.vw, vh: L.vh, moved: false, long: false, cl: undefined, ct: undefined
    };
    longFired = false;
    clickBlock = false;
    try { host.setPointerCapture && host.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    try { e.preventDefault(); } catch (err) { /* noop */ }
    window.addEventListener('pointermove', onMove, { passive: false });
    const T = (global.Pet && Pet.timings) ? Pet.timings : { holdArm: 380, hold: 3000 };
    armHold(T.holdArm, T.hold);
  }

  function onMove(e) {
    if (!drag) return;
    if (drag.id !== undefined && e.pointerId !== undefined && e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 6) {
      drag.moved = true;
      clearHold();
      try { host.classList.add('dragging'); } catch (err) { /* noop */ }
    }
    if (!drag.moved) return;
    const left = Math.max(4, Math.min(drag.left + dx, drag.vw - Pet.size() - 4));
    const top = Math.max(4, Math.min(drag.top + dy, drag.vh - Pet.size() - 4));
    drag.cl = left; drag.ct = top;
    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(top) + 'px';
    if (e.cancelable) { try { e.preventDefault(); } catch (err) { /* noop */ } }
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    const d = drag;
    drag = null;
    clearHold();
    if (host) host.classList.remove('dragging');
    if (!d) return;
    try { host.releasePointerCapture && host.releasePointerCapture(d.id); } catch (err) { /* noop */ }
    const held = Date.now() - d.t0;

    if (d.moved) {
      clickBlock = true;
      lastDragAt = Date.now();
      try {
        const L = Pet.place(d.cl / d.vw, d.ct / d.vh);
        if (L) place();
        react('purr', '');
      } catch (err) { /* noop */ }
      return;
    }
    if (d.long || longFired) { clickBlock = true; return; }
    /* 原地点按：按住了多久 交给 Pet.gesture 判定（点/ 菜单 / 对话框） */
    clickBlock = true;
    if (held >= 240) {
      try { Pet.gesture(held); } catch (err) { /* noop */ }
    } else {
      try { Pet.tapReact(); } catch (err) { /* noop */ }
    }
  }

  function onClick(e) {
    if (clickBlock) { clickBlock = false; return; }
    if (e && e.target && e.target.closest && e.target.closest('.pet-home')) return;
    if (isMenuOpen()) { closeMenu(); return; }
    try { Pet.tapReact(); } catch (err) { /* noop */ }
  }

  /* ---------------- 空闲小动---------------- */

  const ACT = [
    { cls: 'anim-blink', id: 'pt-lid', ms: 460, w: 6 },
    { cls: 'anim-ear', id: 'pt-ear-l', ms: 660, w: 2 },
    { cls: 'anim-ear', id: 'pt-ear-r', ms: 720, w: 2 },
    { cls: 'anim-headtilt', id: 'pt-head', ms: 2400, w: 1 },
    { cls: 'anim-lick', id: 'pt-paw-fl', ms: 1500, w: 2 },
    { cls: 'anim-knead', id: 'pt-paw-f', ms: 1800, w: 1 },
    { cls: 'anim-tailflick', id: 'pt-tail-b', ms: 900, w: 2 }
  ];

  function idleAction() {
    if (pageHidden || paused || !host) return;
    if (Pet.isHidden()) return;
    if (Pet.isAsleep()) {
      if (Math.random() < 0.5) react('sleep', '');
      return;
    }
    const pool = [];
    ACT.forEach(function (a) { for (let i = 0; i < a.w; i++) pool.push(a); });
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const list = (pick.id === 'pt-paw-f') ? host.querySelectorAll('.pt-paw-f') : [doc.getElementById(pick.id)];
    for (let i = 0; i < list.length; i++) if (list[i]) once(list[i], pick.cls, pick.ms);
  }

  function startIdle() {
    stopIdle();
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
      return /^article(\/|$)/.test(p) || /^diary\/edit/.test(p);
    } catch (e) { return false; }
  }

  function applyVisibility() {
    if (!host) return false;
    const on = !Pet.isHidden();
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
    pageHidden = !!v;
    if (host) host.classList.toggle('paused', !!v);
    if (v) stopIdle(); else startIdle();
  }

  /* ---------------- 挂载 ---------------- */

  function mount() {
    if (host) return true;
    if (!doc || !doc.body) return false;
    host = build();
    doc.body.appendChild(host);
    applyStyle();
    applyCoat();
    applyPose();
    applyMood();
    applyGrowth();
    applyScene();
    place();
    applyVisibility();
    startIdle();
    patchUI();
    if (Pet.focusLeft() > 0) {
      global.setTimeout(function () { if (Pet.focusLeft() > 0) bubble('专注继续，还剩 ' + mmss(Pet.focusLeft()), 3600); }, 1200);
    }
    doc.addEventListener('pointerdown', onDocDown, true);
    return true;
  }

  function unmount() {
    stopIdle();
    clearHold();
    if (bubTimer) { global.clearTimeout(bubTimer); bubTimer = null; }
    try { doc.removeEventListener('pointerdown', onDocDown, true); } catch (e) { /* noop */ }
    if (host && host.parentNode) host.parentNode.removeChild(host);
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    host = null; menuEl = null; statsEl = null; focusRow = null; paletteEl = null;
    bubbleEl = null; bubbleText = null; stage = null; cat = null; scene = null;
    ringEl = null; ringBar = null;
    return true;
  }

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
    version: '2.0.0',
    baseSize: BASE_SIZE,
    mount: mount,
    unmount: unmount,
    node: function () { return host; },
    menuNode: function () { return menuEl; },
    catNode: function () { return cat; },
    sceneNode: function () { return scene; },
    propNode: function (id) { return host ? host.querySelector('[data-prop="' + id + '"]') : null; },
    palette: function () { return Pet.coats(); },
    applyVisibility: applyVisibility,
    applyPose: applyPose,
    applyCoat: applyCoat,
    applyStyle: applyStyle,
    currentCatSvg: currentCatSvg,
    applyMood: applyMood,
    applyGrowth: applyGrowth,
    applyScene: applyScene,
    place: place,
    react: react,
    typeReact: typeReact,
    bubble: bubble,
    open: open,
    closeMenu: closeMenu,
    isMenuOpen: isMenuOpen,
    syncStats: syncStats,
    syncPanel: function () { syncStats(); syncLevel(); syncPalette(); },
    syncPalette: syncPalette,
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
        coat: host ? host.getAttribute('data-coat') : '',
        mood: host ? host.getAttribute('data-mood') : '',
        level: host ? host.getAttribute('data-level') : '',
        scene: host ? ['sc-bowl', 'sc-bowl-empty', 'sc-ball', 'sc-bed', 'sc-board', 'sc-note'].filter(function (c) { return host.classList.contains(c); }) : [],
        holding: !!(host && host.classList.contains('holding')),
        left: host ? host.style.left : '',
        top: host ? host.style.top : ''
      };
    }
  };

  global.PetView = PetView;
})(window);
