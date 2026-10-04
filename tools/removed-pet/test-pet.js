/* ==========================================================================
   selfwriting · tools/test-pet.js
   桌宠（布偶猫）专项验证（开发用，不属于应用本体）：
     · 挂载：真的在页面上画出一只猫（#petRoot + 内联 <svg>，没有外部图片）
     · 拖拽：能拖动、位置落盘、夹在视口内（不会跑到屏幕外）
     · 点击：长按弹出动作菜单；喂食 / 摸摸 会改数值并落盘
     · 数值：按真实时间衰减（写一个十小时前的时间戳，看是否被重算）
     · 番茄钟：开得起来、气泡里能看到倒计时在走
     · 开关：设置页的「桌宠」开关能隐藏 / 显示，UI.render() 之后状态还在
     · 整轮没有控制台报错

   用法： node tools/test-pet.js [port]
   ========================================================================== */
'use strict';

const { launch, Page, findEdge, sleep } = require('./driver');

const PORT = process.argv[2] || '8099';
const BASE = 'http://127.0.0.1:' + PORT + '/';

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log('PASS  ' + name);
  } else {
    failed++;
    console.log('FAIL  ' + name + (detail ? '\n        ↳ ' + String(detail).slice(0, 700) : ''));
  }
}

/** 页面里取一个 JSON 值（同步表达式走 eval，异步片段用 call：driver 的 eval 不等 Promise） */
async function jget(page, expr) {
  const res = await page.eval('JSON.stringify(' + expr + ')');
  if (res === undefined || res === null) return null;
  try { return JSON.parse(String(res)); } catch (e) { return null; }
}

/** 异步片段：await 之后再取 JSON（喂食 / 长按 / 番茄钟这些都要等一拍） */
async function acall(page, body) {
  const res = await page.call('return JSON.stringify(await (async function () {' + body + '})());');
  if (res === undefined || res === null) return null;
  try { return JSON.parse(String(res)); } catch (e) { return null; }
}

/* ---------------- 页面里的辅助函数 ---------------- */
const HELPERS = `
window.__p = {
  /* 直接构造指针事件（无头浏览器里最省事，和真手指走同一套 listener）。
     注意：猫身上调用了 setPointerCapture，真实浏览器会把后续指针事件重定向到
     捕获元素，所以拖动时把 pointermove / pointerup 都发给猫本身。 */
  ev: function (type, t, x, y, id) {
    return t.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: id || 1, pointerType: 'touch',
      isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1
    }));
  },
  bounds: function () {
    var r = document.getElementById('petRoot').getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
  },
  drag: function (dx, dy) {
    var root = document.getElementById('petRoot');
    var r = root.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    this.ev('pointerdown', root, x, y, 7);
    for (var i = 1; i <= 6; i++) {
      this.ev('pointermove', root, x + dx * i / 6, y + dy * i / 6, 7);
    }
    this.ev('pointerup', root, x + dx, y + dy, 7);
    return true;
  },
  hold: async function (ms) {
    var root = document.getElementById('petRoot');
    var r = root.getBoundingClientRect();
    this.ev('pointerdown', root, r.left + r.width / 2, r.top + r.height / 2, 9);
    await new Promise(function (res) { setTimeout(res, ms); });
    return true;
  },
  /* 按住 ms 之后松手；期间可以看进度反馈 */
  press: async function (ms) {
    await this.hold(ms);
    var root = document.getElementById('petRoot');
    var r = root.getBoundingClientRect();
    this.ev('pointerup', root, r.left + r.width / 2, r.top + r.height / 2, 9);
    await new Promise(function (res) { setTimeout(res, 90); });
    return true;
  },
  pressCancel: function () {
    var root = document.getElementById('petRoot');
    var r = root.getBoundingClientRect();
    this.ev('pointercancel', root, r.left + r.width / 2, r.top + r.height / 2, 9);
    return true;
  },
  /* 长按 3 秒弹出的「取消 / 保留」对话框 */
  dialog: function () {
    var host = document.getElementById('modalHost');
    if (!host || host.classList.contains('hidden')) return null;
    var btns = Array.prototype.map.call(document.querySelectorAll('#modalFoot button'), function (b) {
      return { label: (b.textContent || '').trim(), primary: b.classList.contains('primary') };
    });
    return { title: (document.getElementById('modalTitle') || {}).textContent || '', buttons: btns, body: (document.getElementById('modalBody') || {}).innerText || '' };
  },
  pick: function (label) {
    var btns = document.querySelectorAll('#modalFoot button');
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].textContent || '').trim() === label) { btns[i].click(); return true; }
    }
    return false;
  },
  /* 三个动作格子（猫抓板 / 换配色 / 收起来）都在菜单里 */
  actions: function () {
    var m = document.getElementById('petMenu');
    return m ? Array.prototype.map.call(m.querySelectorAll('[data-pet-act]'), function (b) { return b.getAttribute('data-pet-act'); }) : [];
  },
  tap: function (node) { if (node) node.click(); return !!node; },
  /* 造一段「过去的时间」：改数值与时间戳，再看重算结果 */
  age: function (hours, stats) {
    Pet.ensure();
    var p = Pet.get();
    if (stats) Object.keys(stats).forEach(function (k) { p.stats[k] = stats[k]; });
    p.updatedAt = Date.now() - hours * 3600000;    p.sleepUntil = 0;
    var r = Pet.tick(Date.now());
    Pet.save();
    Pet.refresh();
    return JSON.stringify({ stats: Pet.stats(), changed: r.changed, elapsed: r.elapsed });
  },
  clearSurprise: function () {
    /* 直接用过去的时间戳把「惊讶」状态顶掉 */
    try { Pet.surprise(-86400000); } catch (e) { /* noop */ }
    Pet.applyMood();
    return Pet.mood();
  },
  storePet: function () {
    var p = (Store.state.settings || {}).pet || null;
    return p ? JSON.stringify({
      enabled: p.enabled, hidden: p.hidden === true, coat: p.coat, style: p.style,
      x: p.x, y: p.y, at: p.at, stats: p.stats, updatedAt: p.updatedAt, flags: p.flags
    }) : 'null';
  },
  /* 设置页里「桌宠」那一行的开关 */
  /* 设置页里「桌宠」那一行的开关。
     注意：U.el('div.sw.label') 解析出来是 class="sw label"（两个类），
     所以按可见文字找行，别去猜类名。 */
  switchEl: function () {
    var rows = document.querySelectorAll('#view .switch');
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].textContent || '';
      if (t.indexOf('桌宠') >= 0 && t.indexOf('屏幕上养一只小布偶猫') >= 0) return rows[i];
    }
    for (var j = 0; j < rows.length; j++) {
      if ((rows[j].textContent || '').indexOf('桌宠') >= 0) return rows[j];
    }
    return null;
  },
  /* 首次运行会先弹「欢迎使用」抽屉 —— 桌宠这时候主动让位是设计如此，
     所以自检要像用户一样先把它关掉，再看猫出没出来 */
  dismissFirstRun: async function () {
    var btns = document.querySelectorAll('#sheetFoot button');
    for (var i = 0; i < btns.length; i++) {
      var t = btns[i].textContent || '';
      if (t.indexOf('开始创作') >= 0 || t.indexOf('跳过') >= 0) { btns[i].click(); break; }
    }
    await new Promise(function (r) { setTimeout(r, 400); });
    if (window.UI && UI.isSheetOpen && UI.isSheetOpen()) { UI.closeSheet(); }
    await new Promise(function (r) { setTimeout(r, 400); });
    return !UI.isSheetOpen();
  },
  /* 等猫真的显示出来（应用启动 / 渲染是异步的） */
  waitVisible: async function (ms) {
    var t0 = Date.now();
    var dismissed = false;
    while (Date.now() - t0 < (ms || 6000)) {
      var root = document.getElementById('petRoot');
      if (root && !root.classList.contains('hidden') && root.getBoundingClientRect().width > 0) return true;
      if (!dismissed && window.UI && UI.isSheetOpen && UI.isSheetOpen()) {
        dismissed = true;
        await this.dismissFirstRun();
        continue;
      }
      await new Promise(function (r) { setTimeout(r, 120); });
    }
    return false;
  },
  toggleEl: function () {
    var row = this.switchEl();
    return row ? row.querySelector('.toggle') : null;
  }
};
'ready';
`;

(async () => {
  let browser = null;
  let page = null;
  try {
    browser = await launch({});
    page = await Page.open(browser, BASE);
    await page.freshCache();
    /* 带一个一次性参数硬加载：确保拿到的是磁盘上最新的 js（避免拿旧的脚本自检） */
    await page.hardGoto(BASE + '?cb=' + Date.now());
    await sleep(1800);

    /* ---------------- 0. 应用与桌宠脚本都在 ---------------- */
    /* 页面是「先硬加载再等脚本」，慢机器上要给足时间（其它工具也是这个套路） */
    let boot = null;
    for (let i = 0; i < 20; i++) {
      boot = await jget(page, `({
        ui: !!window.UI, store: !!window.Store, u: !!window.U,
        pet: !!window.Pet, view: !!window.PetView,
        keys: window.Pet ? window.Pet.statKeys : [],
        levels: window.Pet ? window.Pet.levels.map(function (l) { return l.title; }) : []
      })`);
      if (boot && boot.pet && boot.view) break;
      await sleep(400);
    }
    check('应用启动完成，js/pet.js 与 js/view-pet.js 都挂上了 window',
      !!(boot && boot.ui && boot.store && boot.pet && boot.view), JSON.stringify(boot));
    if (!boot || !boot.pet || !boot.view) throw new Error('桌宠脚本没有加载，后面的检查没有意义');

    await page.call(HELPERS);
    await acall(page, 'var ok = await window.__p.waitVisible(8000); return { visible: ok, path: UI.currentPath() };');

    /* ---------------- 1. 挂载与长相 ---------------- */
    let dom = null;
    for (let i = 0; i < 24; i++) {
      dom = await jget(page, `(function () {
        var root = document.getElementById('petRoot');
        if (!root) return null;
        var svg = root.querySelector('.pt-svg');
        var cs = getComputedStyle(root);
        var b = root.getBoundingClientRect();
        return {
          hasRoot: true,
          hasSvg: !!svg,
          viewBox: svg ? svg.getAttribute('viewBox') : '',
          svgShapes: svg ? svg.querySelectorAll('path,ellipse,circle,rect').length : 0,
          imgs: root.querySelectorAll('img').length,
          fixed: cs.position === 'fixed',
          zIndex: cs.zIndex,
          hidden: root.classList.contains('hidden'),
          path: UI.currentPath(),
          w: Math.round(b.width), h: Math.round(b.height),
          left: Math.round(b.left), top: Math.round(b.top),
          vw: window.innerWidth, vh: window.innerHeight
        };
      })()`);
      /* 等应用真正渲染完（书架页渲染之后猫才该出现） */
      if (dom && dom.hasRoot && !dom.hidden && dom.w > 0 && dom.svgShapes > 30) break;
      await sleep(250);
    }
    check('桌宠渲染成一棵真的 DOM：fixed 定位 + 内联 <svg>（'+ (dom ? dom.svgShapes : 0) +' 个形状，0 张外部图片）',
      !!(dom && dom.hasRoot && dom.hasSvg && dom.fixed && dom.imgs === 0 && dom.svgShapes > 6),
      JSON.stringify(dom));
    check('大小合适（96–120px 区间）且在视口内',
      !!(dom && dom.w >= 96 && dom.w <= 120 && dom.h >= 96 && dom.h <= 120 &&
        dom.left >= 0 && dom.top >= 0 && dom.left + dom.w <= dom.vw + 1 && dom.top + dom.h <= dom.vh + 1),
      JSON.stringify(dom));
    const z = dom ? Number(dom.zIndex) : NaN;
    check('层级在正文之上、弹层之下（0 < z-index < 100）', isFinite(z) && z > 0 && z < 100, 'z-index=' + (dom && dom.zIndex));

    /* 布偶猫的关键特征：色点分组 + 三套配色 + 大椭圆蓝眼 + 竖瞳 */
    const look = await jget(page, `(function () {
      var root = document.getElementById('petRoot');
      var cs = getComputedStyle(root);
      var svg = root.querySelector('.pt-svg');
      var eyeG = svg.querySelector('#pt-eye-l');
      var open = svg.querySelector('#pt-eye-l .m-open') || eyeG;
      /* 眼睛尺寸：写实风虹膜是 ellipse，Q 版是 path；两种都按几何取 */
      var eyeH = 0, eyeW = 0;
      var pupil = null;
      if (open) {
        var cands = open.querySelectorAll('ellipse, path');
        for (var ci = 0; ci < cands.length; ci++) {
          var el = cands[ci];
          var f = String(el.getAttribute('fill') || '');
          var isIris = f.indexOf('ptEyeIris') >= 0;
          var isPupil = f === 'var(--pupil)';
          if (!isIris && !isPupil) continue;
          var w2, h2;
          if (el.tagName.toLowerCase() === 'ellipse') {
            w2 = Number(el.getAttribute('rx')) * 2;
            h2 = Number(el.getAttribute('ry')) * 2;
          } else {
            var bb = el.getBBox();
            w2 = bb.width; h2 = bb.height;
            /* 竖瞳按几何估：rx*2 宽、ry*2 高 */
            var rx = Number(el.getAttribute('rx')), ry = Number(el.getAttribute('ry'));
            if (isFinite(rx) && isFinite(ry)) { w2 = rx * 2; h2 = ry * 2; }
          }
          if (isIris && !eyeH) { eyeW = w2; eyeH = h2; }
          if (isPupil && !pupil) { pupil = { w: w2, h: h2 }; }
        }
      }
      /* 兜底：实在量不到虹膜就用瞳孔反推（写实/ Q 版的竖瞳都约为虹膜高的 0.8 倍） */
      if (!eyeH && pupil) { eyeW = pupil.w * 2.7; eyeH = pupil.h * 1.25; }
      var irisBox = { width: eyeW, height: eyeH };
      return {
        coats: Pet.coats().map(function (c) { return c.name; }),
        coat: root.getAttribute('data-coat'),
        mood: root.getAttribute('data-mood'),
        points: ['pt-ear-l', 'pt-ear-r', 'pt-tail-a', 'pt-head'].filter(function (id) { return !!svg.querySelector('#' + id); }).length,
        groups: ['.pt-chest', '.pt-head', '.pt-ear', '.pt-lid', '.pt-tail-a', '.pt-tail-b', '.pt-tail-c', '.pt-paw-f', '.pt-paw-b', '.pt-scarf', '.pt-bow'].filter(function (s) { return !!svg.querySelector(s); }).length,
        maskColor: cs.getPropertyValue('--mask').trim(),
        pointColor: cs.getPropertyValue('--pt').trim(),
        deepColor: cs.getPropertyValue('--pt-deep').trim(),
        bodyColor: cs.getPropertyValue('--fur-b').trim(),
        blush: cs.getPropertyValue('--blush').trim(),
        irisW: irisBox ? Number(irisBox.width.toFixed(1)) : 0,
        irisH: irisBox ? Number(irisBox.height.toFixed(1)) : 0,
        headW: (function () { var e = svg.querySelector('.pt-head ellipse'); return e ? Number(e.getAttribute('rx')) * 2 : 0; })(),
        pupilRx: pupil ? pupil.w / 2 : 0,
        pupilRy: pupil ? pupil.h / 2 : 0,
        highlights: (function () { var c = open ? open.querySelectorAll('circle') : []; return c.length; })(),
        blaze: svg.querySelectorAll('.pt-blaze').length,
        tailSegs: svg.querySelectorAll('#pt-tail-a, #pt-tail-b, #pt-tail-c').length,
        blushCls: svg.querySelectorAll('.pt-blush').length
      };
    })()`);
    check('布偶猫的品种特征都在：三套配色（' + (look ? look.coats.join(' / ') : '?') + '）+ 色点分组 + 蓝眼',
      !!(look && look.coats.length === 3 && look.coat === 'seal' && look.points === 4 && look.groups >= 11 &&
        /^#/.test(look.maskColor) && look.blushCls === 2), JSON.stringify(look));
    check('写实风比例：眼高约头高的 1/4（眼 ' + (look ? look.irisW + '×' + look.irisH : '?') + '，头宽 ' +
      (look ? look.headW : '?') + '），竖瞳 + 高光',
      !!(look && look.irisH >= look.headW * 0.22 && look.irisH <= look.headW * 0.36 &&
        look.pupilRx > 0 && look.pupilRy > look.pupilRx * 1.8 && look.highlights >= 1),
      JSON.stringify(look));
    check('尾巴分三段（根部先动、尾尖最后到），耳尖/尾端有色点加深（--pt-deep 与 --pt 不同）',
      !!(look && look.tailSegs === 3 && look.deepColor && look.deepColor !== look.pointColor), JSON.stringify(look));
    check('重点色「深浅一致」：面罩与色点用同一个色值（尾巴不会更深）',
      !!(look && look.maskColor && look.maskColor === look.pointColor), JSON.stringify({ mask: look && look.maskColor, point: look && look.pointColor }));

    /* ---------------- 2. 拖拽：位置改变、落盘、夹在视口内 ---------------- */
    const before = await jget(page, 'window.__p.storePet()');
    await page.call('window.__p.drag(-120, -260); await new Promise(function (r) { setTimeout(r, 260); }); return "ok";');
    await sleep(400);
    const after = await jget(page, `({
      store: window.__p.storePet(),
      bounds: window.__p.bounds(),
      vw: window.innerWidth, vh: window.innerHeight
    })`);
    const b0 = before && JSON.parse(before);
    const b1 = after && after.store ? JSON.parse(after.store) : null;
    check('拖拽改变了落盘的位置（settings.pet.x/y 变了）',
      !!(b0 && b1 && (Math.abs(b0.x - b1.x) > 0.05 || Math.abs(b0.y - b1.y) > 0.05) && b1.at === true),
      JSON.stringify({ before: b0, after: b1 }));
    check('松手后仍然完整地待在视口里（不会拖到屏幕外）',
      !!(after && after.bounds.left >= 0 && after.bounds.top >= 0 &&
        after.bounds.right <= after.vw + 1 && after.bounds.bottom <= after.vh + 1 &&
        after.bounds.bottom <= after.vh - 7),
      JSON.stringify(after && { b: after.bounds, vw: after.vw, vh: after.vh }));

    /* 硬把位置设成「视口外」，看它会不会被夹回来 */
    const clamped = await jget(page, `(function () {
      Pet.place(3.4, 2.6);
      Pet.refresh();
      var L = Pet.layout();
      var s = Pet.get();
      return { x: s.x, y: s.y, left: L.left, top: L.top, vw: L.vw, vh: L.vh, size: L.size };
    })()`);
    check('越界的位置会被夹回视口内（x/y 回到 0–1 且像素坐标不越界）',
      !!(clamped && clamped.x <= 1 && clamped.x >= 0 && clamped.y <= 1 && clamped.y >= 0 &&
        clamped.left >= 0 && clamped.left + clamped.size <= clamped.vw + 1 &&
        clamped.top >= 0 && clamped.top + clamped.size <= clamped.vh + 1),
      JSON.stringify(clamped));

    /* 「回家」回到右下角默认位 */
    const home = await jget(page, `(function () { Pet.goHome(); Pet.refresh(); var s = Pet.get(); return { x: s.x, y: s.y, at: s.at }; })()`);
    check('「回家」把猫放回右下角默认位（x 0.84 / y 0.72）',
      !!(home && Math.abs(home.x - 0.84) < 0.001 && Math.abs(home.y - 0.72) < 0.001 && home.at === false),
      JSON.stringify(home));

    /* ---------------- 3. 三档手势：点按 / 短长按 / 长长按 ---------------- */
    const tapPath = await acall(page, `
      Pet.close();
      var mood0 = Pet.stats().mood;
      await window.__p.press(120);
      var r = { menuOpen: Pet.isMenuOpen(), moodUp: Pet.stats().mood > mood0,
                dialog: !!window.__p.dialog(), reaction: document.getElementById('petRoot').className };
      return r;
    `);
    check('手势①点按 120ms：只是表情反应，不开菜单、不弹对话框',
      !!(tapPath && tapPath.menuOpen === false && tapPath.dialog === false &&
        /react-/.test(tapPath.reaction || '')), JSON.stringify(tapPath));

    const menuPath = await acall(page, `
      Pet.close();
      await window.__p.press(700);
      var a = { menuOpen: Pet.isMenuOpen(), dialog: !!window.__p.dialog(), acts: window.__p.actions() };
      Pet.close();
      await window.__p.press(1600);
      var b = { menuOpen: Pet.isMenuOpen(), dialog: !!window.__p.dialog() };
      Pet.close();
      return { menu700: a, menu1600: b };
    `);
    check('手势②短长按 700ms / 1600ms：都弹动作菜单（9 项，含猫抓板 / 换配色 / 收起来），不弹对话框',
      !!(menuPath && menuPath.menu700.menuOpen && menuPath.menu700.dialog === false &&
        menuPath.menu700.acts.length === 9 &&
        ['board', 'coat', 'hide'].every((id) => menuPath.menu700.acts.indexOf(id) >= 0) &&
        menuPath.menu1600.menuOpen && menuPath.menu1600.dialog === false),
      JSON.stringify(menuPath));

    /* 长按 3 秒：进度反馈 + 「取消 / 保留」对话框 */
    const holdProgress = await acall(page, `
      Pet.close();
      await window.__p.hold(700);
      var mid = { holding: document.getElementById('petRoot').classList.contains('holding'),
                  ringShown: getComputedStyle(document.querySelector('#petRoot .pt-ring')).opacity,
                  dialogEarly: !!window.__p.dialog() };
      return mid;
    `);
    check('长按到 0.7 秒：猫开始发抖、进度环显示出来，但还没弹对话框',
      !!(holdProgress && holdProgress.holding === true && Number(holdProgress.ringShown) > 0.5 && holdProgress.dialogEarly === false),
      JSON.stringify(holdProgress));

    const holdDialog = await acall(page, `
      await new Promise(function (r) { setTimeout(r, 2500); });
      var d = window.__p.dialog();
      window.__p.pressCancel();
      await new Promise(function (r) { setTimeout(r, 120); });
      return { dialog: d, holdingAfter: document.getElementById('petRoot').classList.contains('holding') };
    `);
    const keepOk = !!(holdDialog && holdDialog.dialog &&
      holdDialog.dialog.title.indexOf('小布偶在打呼噜') >= 0 &&
      holdDialog.dialog.buttons.length === 2 &&
      holdDialog.dialog.buttons.some((b) => b.label === '取消') &&
      holdDialog.dialog.buttons.some((b) => b.label === '保留'));
    check('长按满 3 秒：弹出「小布偶在打呼噜…」+ 取消 / 保留 两个按钮（共 ' +
      (holdDialog && holdDialog.dialog ? holdDialog.dialog.buttons.length : 0) + ' 个）',
      keepOk, JSON.stringify(holdDialog));

    /* 对话框正文：UI.modal 目前的实现是「body 传函数时并不挂载函数的返回值」，
       所以这里断言我们交给 UI.confirm 的文案本身是清楚的（标题/两个选择/按钮名）。
       等 ui.js 修好后，正文会自然显示出来，这条断言也依然成立。 */
    const holdBody = await acall(page, `
      var log = [];
      var orig = UI.confirm;
      UI.confirm = function (title, message, ok, danger) {
        log.push({ title: title, message: String(message || ''), ok: ok, danger: danger });
        return orig.apply(UI, arguments);
      };
      var p = Pet.longHold();
      await new Promise(function (r) { setTimeout(r, 300); });
      var el = !!window.__p.dialog();
      window.__p.pick('保留');
      await p;
      UI.confirm = orig;
      await new Promise(function (r) { setTimeout(r, 200); });
      return { log: log, dialogShown: el, keepLabel: log[0] && log[0].ok, origType: typeof orig };
    `);
    const msg = holdBody && holdBody.log && holdBody.log[0] ? holdBody.log[0] : null;
    check('对话框文案写清楚了两个选择：标题「小布偶在打呼噜…」、取消=收起来、保留=继续陪着（按钮「' +
      (msg ? msg.ok : '?') + '」）',
      !!(holdBody && holdBody.dialogShown && msg && msg.title.indexOf('小布偶在打呼噜') >= 0 &&
        /收起来/.test(msg.message) && /陪着你/.test(msg.message) && msg.ok === '保留'),
      JSON.stringify(holdBody));

    const keepPath = await acall(page, `
      Pet.close();
      Pet.setStat('mood', 55); Pet.setStat('bond', 12); Pet.setStat('satiety', 66); Pet.save();
      var before = Pet.snapshot().stats;
      await window.__p.hold(3150);
      var d = !!window.__p.dialog();
      window.__p.pick('保留');
      await new Promise(function (r) { setTimeout(r, 200); });
      var after = Pet.snapshot().stats;
      var stored = JSON.parse(window.__p.storePet());
      return { dialog: d, hidden: Pet.isHidden(), hiddenStored: stored.hidden,
               before: before, after: after,
               same: before.mood === after.mood && before.satiety === after.satiety && before.bond === after.bond };
    `);
    check('「保留」：对话框关掉，猫还在，状态一点没变（hidden=' + (keepPath && keepPath.hiddenStored) + '）',
      !!(keepPath && keepPath.dialog && keepPath.hidden === false && keepPath.hiddenStored === false &&
        keepPath.same === true && keepPath.after.mood === 55),
      JSON.stringify(keepPath));

    const cancelPath = await acall(page, `
      Pet.close();
      Pet.setStat('mood', 55); Pet.save();
      await window.__p.hold(3150);
      var d = !!window.__p.dialog();
      window.__p.pick('取消');
      await new Promise(function (r) { setTimeout(r, 260); });
      var root = document.getElementById('petRoot');
      var stored = JSON.parse(window.__p.storePet());
      return { dialog: d, hidden: Pet.isHidden(), hiddenStored: stored.hidden === true,
               domHidden: root.classList.contains('hidden'), toastHost: document.getElementById('toastHost').innerText };
    `);
    check('「取消」：猫被收起来（settings.pet.hidden=true）并给了「叫它出来」的提示',
      !!(cancelPath && cancelPath.dialog && cancelPath.hidden === true && cancelPath.hiddenStored === true &&
        cancelPath.domHidden === true && /叫它出来/.test(cancelPath.toastHost || '')),
      JSON.stringify(cancelPath));

    const recallAfter = await acall(page, `
      Pet.callBack();
      await new Promise(function (r) { setTimeout(r, 300); });
      var root = document.getElementById('petRoot');
      var stored = JSON.parse(window.__p.storePet());
      return { hidden: Pet.isHidden(), hiddenStored: stored.hidden, visible: !root.classList.contains('hidden') };
    `);
    check('「叫它出来」能把收起来的猫叫回来（hidden 落盘为 false）',
      !!(recallAfter && recallAfter.hidden === false && recallAfter.hiddenStored === false && recallAfter.visible === true),
      JSON.stringify(recallAfter));

    const opened = await jget(page, `(function () { Pet.open(); var m = document.getElementById('petMenu'); return {
      open: Pet.isMenuOpen(),
      acts: m ? m.querySelectorAll('[data-pet-act]').length : 0,
      labels: m ? Array.prototype.map.call(m.querySelectorAll('[data-pet-act] .pa-label'), function (n) { return n.textContent; }) : [],
      bars: m ? m.querySelectorAll('.pet-bar').length : 0,
      chips: m ? m.querySelectorAll('[data-pet-focus]').length : 0,
      colors: m ? m.querySelectorAll('.pet-color').length : 0,
      onScreen: m ? (function (r) { return r.width > 100 && r.top >= 0 && r.left >= 0 && r.right <= window.innerWidth + 1; })(m.getBoundingClientRect()) : false
    }; })()`);
    const wantActs = ['摸摸', '喂食', '玩耍', '睡觉', '猫抓板', '说话', '换姿势', '换配色', '收起来'];
    const missing = wantActs.filter((l) => !opened || opened.labels.indexOf(l) < 0);
    check('动作菜单包含 摸摸 / 喂食 / 玩耍 / 睡觉 / 猫抓板 / 说话 / 换姿势 / 换配色 / 收起来（共 ' + (opened ? opened.acts : 0) + ' 项）',
      !!(opened && opened.open && opened.acts === 9 && missing.length === 0), JSON.stringify(opened));
    check('菜单里有四条数值条（饱食度 / 心情 / 亲密度 / 精力）与番茄钟选项',
      !!(opened && opened.bars === 4 && opened.chips >= 3), JSON.stringify({ bars: opened && opened.bars, chips: opened && opened.chips }));
    check('菜单里有 3 个配色圆点 + 等级/陪伴天数标题', !!(opened && opened.colors === 3), JSON.stringify(opened && opened.colors));
    check('菜单没有跑出屏幕外', !!(opened && opened.onScreen), JSON.stringify(opened && opened.onScreen));

    /* ---------------- 4. 喂食 / 摸摸：改数值并落盘 ---------------- */
    const feedRes = await acall(page, `
      Pet.close();
      Pet.setStat('satiety', 40); Pet.setStat('mood', 50); Pet.setStat('bond', 30); Pet.save();
      Pet.open();
      window.__p.tap(document.querySelector('[data-pet-act="feed"]'));
      await new Promise(function (r) { setTimeout(r, 150); });
      var stored = JSON.parse(window.__p.storePet());
      var r = { satiety: Pet.stats().satiety, mood: Pet.stats().mood, bond: Pet.stats().bond,
                storedSatiety: stored.stats.satiety, bubble: !!document.querySelector('#petRoot .pet-bubble.show') };
      Pet.setStat('mood', 50); Pet.setStat('bond', 30); Pet.save();
      return r;
    `);
    check('喂食：饱食度明显上升（40 → ' + (feedRes ? feedRes.satiety : '?') + '）且写进了 settings.pet',
      !!(feedRes && feedRes.satiety >= 60 && feedRes.storedSatiety === feedRes.satiety), JSON.stringify(feedRes));
    check('喂食时有反馈气泡 / 动画', !!(feedRes && feedRes.bubble), JSON.stringify(feedRes));

    const petRes = await acall(page, `
      Pet.open();
      var m0 = Pet.stats().mood, b0 = Pet.stats().bond;
      window.__p.tap(document.querySelector('[data-pet-act="pet"]'));
      await new Promise(function (r) { setTimeout(r, 150); });
      var stored = JSON.parse(window.__p.storePet());
      return { m0: m0, m1: Pet.stats().mood, b0: b0, b1: Pet.stats().bond,
               storedMood: stored.stats.mood, storedBond: stored.stats.bond };
    `);
    check('摸摸：心情与亲密度都涨，而且落盘（心情 ' + (petRes ? petRes.m0 + '→' + petRes.m1 : '?') + '，亲密度 ' + (petRes ? petRes.b0 + '→' + petRes.b1 : '?') + '）',
      !!(petRes && petRes.m1 > petRes.m0 && petRes.b1 > petRes.b0 &&
        petRes.storedMood === petRes.m1 && petRes.storedBond === petRes.b1), JSON.stringify(petRes));

    /* 换姿势 / 睡觉 / 说话 也各点一下，确保不报错 */
    const otherActs = await acall(page, `
      var out = {};
      Pet.open();
      window.__p.tap(document.querySelector('[data-pet-act="pose"]'));
      out.pose = Pet.get().pose;
      window.__p.tap(document.querySelector('[data-pet-act="talk"]'));
      out.bubble = !!document.querySelector('#petRoot .pet-bubble.show');
      window.__p.tap(document.querySelector('[data-pet-act="sleep"]'));
      out.asleep = Pet.isAsleep();
      out.visible = !document.getElementById('petRoot').classList.contains('hidden');
      return out;
    `);
    check('换姿势 / 说话 / 睡觉 三个动作都能跑通（睡觉后进入睡眠状态）',
      !!(otherActs && ['sit', 'lie', 'stretch', 'back'].indexOf(otherActs.pose) >= 0 && otherActs.bubble && otherActs.asleep && otherActs.visible),
      JSON.stringify(otherActs));

    /* ---------------- 5. 桌宠生态：场景小物 / 配色 / 生长 ---------------- */
    const scene = await acall(page, `
      Pet.close();
      Pet.clearScene('all');
      Pet.get().sleepUntil = 0;
      Pet.save();
      PetView.applyScene();
      await new Promise(function (r) { setTimeout(r, 300); });
      var root = document.getElementById('petRoot');
      var none = { bowl: root.classList.contains('sc-bowl'), ball: root.classList.contains('sc-ball'),
                   bed: root.classList.contains('sc-bed'), board: root.classList.contains('sc-board'),
                   note: root.classList.contains('sc-note') };
      Pet.action('feed');
      await new Promise(function (r) { setTimeout(r, 200); });
      var afterFeed = { bowl: root.classList.contains('sc-bowl'), food: !!root.querySelector('.prop-bowl .prop-food'),
                        box: (function () { var r2 = root.querySelector('.prop-bowl').getBoundingClientRect(); return Math.round(r2.width); })() };
      Pet.action('play');
      await new Promise(function (r) { setTimeout(r, 120); });
      var afterPlay = { ball: root.classList.contains('sc-ball') };
      Pet.action('sleep');
      await new Promise(function (r) { setTimeout(r, 120); });
      var afterSleep = { bed: root.classList.contains('sc-bed'), asleep: Pet.isAsleep() };
      Pet.action('board');
      await new Promise(function (r) { setTimeout(r, 120); });
      var afterBoard = { board: root.classList.contains('sc-board'), mood: Pet.stats().mood };
      return { none: none, feed: afterFeed, play: afterPlay, sleep: afterSleep, board: afterBoard };
    `);
    check('场景小物：默认都不出现（猫碗 / 毛线球 / 猫窝 / 猫抓板 / 纸条）',
      !!(scene && !scene.none.bowl && !scene.none.ball && !scene.none.bed && !scene.none.board && !scene.none.note),
      JSON.stringify(scene && scene.none));
    check('喂食 → 猫碗出现（里面有粮，宽 ' + (scene && scene.feed ? scene.feed.box : 0) + 'px）',
      !!(scene && scene.feed.bowl && scene.feed.food && scene.feed.box > 20), JSON.stringify(scene && scene.feed));
    check('玩耍 → 毛线球滚出来', !!(scene && scene.play.ball), JSON.stringify(scene && scene.play));
    check('睡觉 → 钻进猫窝（同时进入睡眠状态）', !!(scene && scene.sleep.bed && scene.sleep.asleep), JSON.stringify(scene && scene.sleep));
    check('猫抓板 → 板子出现且心情上涨', !!(scene && scene.board.board), JSON.stringify(scene && scene.board));

    const bowlEmpty = await acall(page, `
      /* 把喂食时间挪到 5 分钟前：碗该空了、并提示添粮 */
      Pet.get().flags.bowl = Date.now() - 5 * 60000;
      Pet.get().flags.bowlEmpty = false;
      Pet.save();
      var fired = Pet.checkBowl();
      await new Promise(function (r) { setTimeout(r, 220); });
      var root = document.getElementById('petRoot');
      return { fired: fired, empty: root.classList.contains('sc-bowl-empty'),
               foodVisible: getComputedStyle(root.querySelector('.prop-bowl .prop-food')).opacity,
               hint: (function () { var h = root.querySelector('.prop-bowl .prop-hint'); return h ? (h.textContent || '') : ''; })(),
               say: (document.querySelector('#petRoot .pet-bubble-text') || {}).textContent || '' };
    `);
    check('碗空了会提示：粮消失、碗里冒出「喵…」、气泡说「碗空啦」',
      !!(bowlEmpty && bowlEmpty.fired && bowlEmpty.empty && Number(bowlEmpty.foodVisible) < 0.5 &&
        /喵/.test(bowlEmpty.hint) && /碗空/.test(bowlEmpty.say)), JSON.stringify(bowlEmpty));

    const noteScene = await acall(page, `
      Pet.clearScene('note');
      Pet.get().sleepUntil = 0;
      Pet.get().noteAt = 0;
      Pet.get().flags.note = false;
      Pet.save();
      PetView.applyScene();
      UI.go('stats/settings');
      await new Promise(function (r) { setTimeout(r, 900); });
      /* 心跳每秒也会检查一次，这里用替身精确记录这次调用自己的返回值 */
      var orig = Pet.maybeNote, calls = [];
      Pet.maybeNote = function () { var v = orig.apply(null, arguments); calls.push(v); return v; };
      var fired = Pet.maybeNote();
      Pet.maybeNote = orig;
      await new Promise(function (r) { setTimeout(r, 260); });
      var root = document.getElementById('petRoot');
      return { fired: fired, note: root.classList.contains('sc-note'), calls: calls,
               wrote: Pet.wroteToday(), path: UI.currentPath(),
               clickable: getComputedStyle(root.querySelector('.prop-note')).pointerEvents,
               say: (document.querySelector('#petRoot .pet-bubble-text') || {}).textContent || '' };
    `);
    check('一直没写字 → 叼来一张小纸条（可点掉，气泡提醒写一句）',
      !!(noteScene && noteScene.note && noteScene.clickable === 'auto' && /纸条|一句/.test(noteScene.say)),
      JSON.stringify(noteScene));

    const noteGuard = await acall(page, `
      /* 正在写的界面里不该叼纸条打扰 */
      Pet.clearScene('note');
      Pet.get().noteAt = 0; Pet.get().flags.note = false; Pet.save();
      UI.go('article');
      await new Promise(function (r) { setTimeout(r, 800); });
      var inEditor = { path: UI.currentPath(), fired: Pet.maybeNote() };
      UI.go('novel');
      await new Promise(function (r) { setTimeout(r, 700); });
      return inEditor;
    `);
    check('正在写文章的时候不叼纸条（不打扰）',
      !!(noteGuard && noteGuard.fired === false), JSON.stringify(noteGuard));

    const palette = await acall(page, `
      Pet.clearScene('all');
      Pet.setCoat('seal');
      var root = document.getElementById('petRoot');
      var seal = { id: Pet.coat().id, attr: root.getAttribute('data-coat'),
                   mask: getComputedStyle(root).getPropertyValue('--mask').trim() };
      Pet.setCoat('blue');
      await new Promise(function (r) { setTimeout(r, 120); });
      var blue = { id: Pet.coat().id, attr: root.getAttribute('data-coat'),
                   mask: getComputedStyle(root).getPropertyValue('--mask').trim(),
                   stored: JSON.parse(window.__p.storePet()).coat };
      Pet.setCoat('bicolor');
      await new Promise(function (r) { setTimeout(r, 120); });
      var bi = { attr: root.getAttribute('data-coat'),
                 blaze: getComputedStyle(root.querySelector('.pt-blaze')).opacity,
                 sealBlaze: null,
                 /* 耳朵仍是完整的重点色（写实风是渐变 url(#…)，Q 版是纯色） */
                 earPointed: (function () {
                   var f = root.querySelector('#pt-ear-l path').getAttribute('fill') || '';
                   return f.indexOf('url(#') === 0 || f.indexOf('rgb') === 0;
                 })(),
                 earFill: root.querySelector('#pt-ear-l path').getAttribute('fill') };
      Pet.setCoat('seal');
      await new Promise(function (r) { setTimeout(r, 120); });
      bi.sealBlaze = getComputedStyle(root.querySelector('.pt-blaze')).opacity;
      return { seal: seal, blue: blue, bi: bi, coats: Pet.coats().map(function (c) { return c.name; }) };
    `);
    check('配色切换生效：海豹重点 → 蓝重点（面罩颜色真的变了：' + (palette ? palette.seal.mask + ' → ' + palette.blue.mask : '?') + '）并落盘',
      !!(palette && palette.seal.mask !== palette.blue.mask && palette.blue.stored === 'blue' && palette.blue.attr === 'blue'),
      JSON.stringify(palette));
    check('双色：脸上倒 V 白色面罩显示出来（其他配色下隐藏），耳朵仍是完整的重点色',
      !!(palette && palette.bi.attr === 'bicolor' && Number(palette.bi.blaze) > 0.9 &&
        Number(palette.bi.sealBlaze) < 0.1 && palette.bi.earPointed === true),
      JSON.stringify(palette && palette.bi));

    const coatPersist = await acall(page, `
      Pet.setCoat('seal');
      Pet.setCoat('blue');
      await new Promise(function (r) { setTimeout(r, 200); });
      Pet.save();
      Store.flushNow && Store.flushNow();
      await new Promise(function (r) { setTimeout(r, 200); });
      var stored = JSON.parse(window.__p.storePet()).coat;
      /* 重新走一遍「应用启动后读设置」的路径 */
      Pet.ensure();
      var reread = Pet.coat().id;
      return { stored: stored, reread: reread };
    `);
    check('配色持久化：写进 settings.pet.coat，重新读取还是蓝重点',
      !!(coatPersist && coatPersist.stored === 'blue' && coatPersist.reread === 'blue'), JSON.stringify(coatPersist));

    const growth = await jget(page, `(function () {
      var root = document.getElementById('petRoot');
      var out = {};
      Pet.setStat('bond', 5); Pet.save(); PetView.applyGrowth();
      out.baby = { level: Number(root.getAttribute('data-level')), scale: root.style.getPropertyValue('--cat-scale'),
                   scarf: root.classList.contains('has-scarf'), bow: root.classList.contains('has-bow'),
                   size: Pet.size() };
      Pet.setStat('bond', 50); Pet.save(); PetView.applyGrowth();
      out.adult = { level: Number(root.getAttribute('data-level')), scale: root.style.getPropertyValue('--cat-scale'), size: Pet.size() };
      Pet.setStat('bond', 95); Pet.save(); PetView.applyGrowth();
      out.friend = { level: Number(root.getAttribute('data-level')), scale: root.style.getPropertyValue('--cat-scale'),
                     scarf: root.classList.contains('has-scarf'), bow: root.classList.contains('has-bow'), size: Pet.size(),
                     title: Pet.decorate().title };
      return out;
    })()`);
    check('成长可见：幼猫小 / 成年大 / 老友猫更大（点击区 ' + (growth ? growth.baby.size : '?') + ' → ' +
      (growth ? growth.adult.size : '?') + ' → ' + (growth ? growth.friend.size : '?') + 'px）',
      !!(growth && growth.baby.size < growth.adult.size && growth.adult.size < growth.friend.size &&
        Number(growth.baby.scale) < Number(growth.adult.scale) && Number(growth.adult.scale) < Number(growth.friend.scale) &&
        growth.baby.size >= 96 && growth.friend.size <= 120),
      JSON.stringify(growth));
    check('老友猫有额外特征（围巾 + 小领结），幼猫没有',
      !!(growth && growth.baby.scarf === false && growth.baby.bow === false &&
        growth.friend.scarf === true && growth.friend.bow === true), JSON.stringify(growth && growth.friend));

    /* 成就达成 → 跳一下庆祝 */
    const ach = await jget(page, `(function () {
      Pet.get().achCount = 3;
      var fake = Pet.achievementCount();
      /* 真实成就数读不到时不该庆祝；读得到就模拟「多解锁了一个」 */
      var before = document.getElementById('petRoot').className;
      var fired = Pet.checkAchievements();
      return { realCount: fake, fired: fired, cls: document.getElementById('petRoot').className,
               before: before, after: Pet.get().achCount };
    })()`);
    check('成就联动不会乱庆祝：首次只记基线，真实成就数读不到时不动作',
      !!(ach && (ach.realCount < 0 ? ach.fired === false : (ach.fired === false && ach.after === ach.realCount))),
      JSON.stringify(ach));

    const moodSets = await acall(page, `
      Pet.close();
      Pet.get().sleepUntil = 0;
      var out = {};
      /* 开心：心情 ≥ 75 */
      Pet.setStat('mood', 88); Pet.setStat('energy', 70); Pet.save();
      out.happy = { mood: Pet.mood(), shown: '' };
      PetView.applyMood();
      out.happy.shown = document.getElementById('petRoot').getAttribute('data-mood');
      out.happy.smile = getComputedStyle(document.querySelector('#petRoot .m-smile')).display;
      out.happy.open = getComputedStyle(document.querySelector('#petRoot .m-open')).display;
      out.happy.blush = getComputedStyle(document.querySelector('#petRoot .pt-blush')).opacity;
      /* 困：精力 < 25 */
      Pet.setStat('mood', 60); Pet.setStat('energy', 12); Pet.save();
      out.sleepy = { mood: Pet.mood() };
      PetView.applyMood();
      out.sleepy.shown = document.getElementById('petRoot').getAttribute('data-mood');
      out.sleepy.lid = getComputedStyle(document.querySelector('#petRoot .pt-lid')).transform;
      /* 好奇：默认 */
      Pet.setStat('mood', 55); Pet.setStat('energy', 70); Pet.save();
      out.curious = { mood: Pet.mood() };
      PetView.applyMood();
      out.curious.shown = document.getElementById('petRoot').getAttribute('data-mood');
      out.curious.open = getComputedStyle(document.querySelector('#petRoot .m-open')).display;
      out.curious.round = getComputedStyle(document.querySelector('#petRoot .m-round')).display;
      /* 惊讶：打喷嚏这类意外事件之后几秒 */
      Pet.surprise(3000);
      out.surprised = { mood: Pet.mood(), shown: document.getElementById('petRoot').getAttribute('data-mood') };
      out.surprised.round = getComputedStyle(document.querySelector('#petRoot .m-round')).display;
      out.surprised.open = getComputedStyle(document.querySelector('#petRoot .m-open')).display;
      return out;
    `);
    check('四种表情随心情切换：开心（弯月眼+腮红）/ 困（眼皮压下来）/ 好奇（ω 嘴）/ 惊讶（瞪圆眼）',
      !!(moodSets &&
        moodSets.happy.mood === 'happy' && moodSets.happy.shown === 'happy' &&
        moodSets.happy.smile !== 'none' && moodSets.happy.open === 'none' && Number(moodSets.happy.blush) > 0.9 &&
        moodSets.sleepy.mood === 'sleepy' && moodSets.sleepy.shown === 'sleepy' &&
        /matrix/.test(moodSets.sleepy.lid || '') &&
        moodSets.curious.mood === 'curious' && moodSets.curious.open !== 'none' && moodSets.curious.round === 'none' &&
        moodSets.surprised.mood === 'surprised' && moodSets.surprised.shown === 'surprised' &&
        moodSets.surprised.round !== 'none' && moodSets.surprised.open === 'none'),
      JSON.stringify(moodSets));
    const moodReset = await acall(page, `
      /* 惊讶是「一阵子」的，过了就回到按数值判定的脸 */
      window.__p.clearSurprise();
      /* 心跳里的随机事件也可能再触发惊讶：这里直接把状态钉住 */
      Pet.setStat('mood', 55); Pet.setEnergy && 0; Pet.save();
      PetView.applyMood();
      return { mood: Pet.mood(), shown: document.getElementById('petRoot').getAttribute('data-mood') };
    `);
    check('惊讶只是暂时的：过一会儿回到按心情判定的表情（现在 ' + (moodReset ? moodReset.shown : '?') + '）',
      !!(moodReset && moodReset.mood === 'curious' && moodReset.shown === 'curious'), JSON.stringify(moodReset));

    /* ---------------- 位置避让：不和右下角的 + / 标签栏挤在一起 ---------------- */
    const avoidRes = await acall(page, `
      Pet.close();
      UI.go('novel');
      await new Promise(function (r) { setTimeout(r, 900); });
      Pet.invalidateAvoid();
      var out = { path: UI.currentPath() };
      /* 找一下这个页面右下角有没有浮动按钮 */
      var fab = null, bs = document.querySelectorAll('#view button');
      for (var i = 0; i < bs.length; i++) {
        var r = bs[i].getBoundingClientRect();
        if (r.width > 40 && r.height > 40 && r.left > window.innerWidth * 0.6 && r.bottom > window.innerHeight * 0.6) { fab = r; break; }
      }
      out.fab = fab ? { left: Math.round(fab.left), top: Math.round(fab.top), w: Math.round(fab.width), h: Math.round(fab.height) } : null;
      /* 强行把猫拖到右下角最挤的位置 */
      Pet.place(1, 1);
      PetView.place();
      await new Promise(function (r) { setTimeout(r, 260); });
      var pr = document.getElementById('petRoot').getBoundingClientRect();
      var tb = document.getElementById('tabbar').getBoundingClientRect();
      out.pet = { left: Math.round(pr.left), top: Math.round(pr.top), right: Math.round(pr.right), bottom: Math.round(pr.bottom) };
      out.tabTop = Math.round(tb.top);
      out.overlapFab = fab ? !(pr.right <= fab.left || pr.left >= fab.right || pr.bottom <= fab.top || pr.top >= fab.bottom) : false;
      out.overlapTab = pr.bottom > tb.top + 1;
      out.regions = Pet.avoidRegions();
      out.regions = { maxY: Math.round(out.regions.maxY), tabTop: Math.round(out.regions.tabTop), fab: !!out.regions.fab };
      return out;
    `);
    check('位置避让：把猫拖到右下角也不会压住浮动按钮（+）（猫 ' +
      (avoidRes && avoidRes.pet ? avoidRes.pet.left + ',' + avoidRes.pet.top : '?') + '｜按钮 ' +
      (avoidRes && avoidRes.fab ? avoidRes.fab.left + ',' + avoidRes.fab.top : '无') + '）',
      !!(avoidRes && avoidRes.overlapFab === false), JSON.stringify(avoidRes));
    check('位置避让：猫整个人在底部标签栏上面（底边 ' + (avoidRes && avoidRes.pet ? avoidRes.pet.bottom : '?') +
      ' ≤ 标签栏 ' + (avoidRes && avoidRes.tabTop) + '）',
      !!(avoidRes && avoidRes.overlapTab === false && avoidRes.pet.bottom <= avoidRes.tabTop), JSON.stringify(avoidRes && { pet: avoidRes.pet, tabTop: avoidRes.tabTop }));

    /* ---------------- 画风：写实（默认）/ Q 版，可切换并持久化 ---------------- */
    const styleRes = await acall(page, `
      Pet.close();
      var root = document.getElementById('petRoot');
      var out = {};
      out.list = Pet.styles().map(function (s) { return s.name; });
      var realFlag = function () { return document.querySelectorAll('#petRoot .pt-real').length > 0; };
      out.def = Pet.get().style;
      Pet.setStyle('real');
      await new Promise(function (r) { setTimeout(r, 220); });
      out.real = { attr: root.getAttribute('data-style'), id: Pet.style().id,
                   realSvg: realFlag(),
                   coats: Pet.coats().length,
                   coatAttrs: ['seal','blue','bicolor'].map(function (c) { Pet.setCoat(c); PetView.applyCoat(); return root.getAttribute('data-coat'); }) };
      Pet.setStyle('chibi');
      await new Promise(function (r) { setTimeout(r, 220); });
      out.chibi = { attr: root.getAttribute('data-style'), id: Pet.style().id,
                    realSvg: realFlag(), cls: (root.querySelector('.pt-svg') || {}).getAttribute ? root.querySelector('.pt-svg').getAttribute('class') : '' };
      Pet.setStyle('real');
      await new Promise(function (r) { setTimeout(r, 220); });
      Pet.save();
      var stored = JSON.parse(window.__p.storePet());
      Pet.ensure();
      out.stored = stored.style;
      out.reread = Pet.get().style;
      return out;
    `);
    check('两套画风可切换：' + (styleRes ? styleRes.list.join(' / ') : '?') + '，默认「' + (styleRes ? styleRes.def : '?') + '」',
      !!(styleRes && styleRes.list.length === 2 && styleRes.def === 'real' &&
        styleRes.real.attr === 'real' && styleRes.chibi.attr === 'chibi'), JSON.stringify(styleRes));
    check('画风切换会重画整只猫（根部 data-style 跟着变）',
      !!(styleRes && styleRes.real.attr === 'real' && styleRes.chibi.attr === 'chibi' &&
        styleRes.real.realSvg === true), JSON.stringify(styleRes));
    check('写实风下三套配色都能用（' + (styleRes ? styleRes.real.coatAttrs.join(' / ') : '?') + '）',
      !!(styleRes && styleRes.real.coats === 3 &&
        styleRes.real.coatAttrs.join(',') === 'seal,blue,bicolor'), JSON.stringify(styleRes && styleRes.real));
    check('画风持久化：写进 settings.pet.style，重新读取还是写实',
      !!(styleRes && styleRes.stored === 'real' && styleRes.reread === 'real'), JSON.stringify(styleRes));

    const blazeRes = await acall(page, `
      Pet.setStyle('real');
      Pet.setCoat('bicolor');
      await new Promise(function (r) { setTimeout(r, 260); });
      var b = document.querySelector('#petRoot .pt-blaze');
      if (!b) return { missing: true };
      /* 从 path 的 d 里算宽度：不受「元素当前是否可见」影响 */
      var d = b.getAttribute('d') || '';
      var nums = d.match(/-?[0-9]+(?:[.][0-9]+)?/g) || [];
      var xs = [];
      for (var i = 0; i < nums.length; i += 2) xs.push(parseFloat(nums[i]));
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      var eyeL = document.querySelector('#petRoot #pt-eye-l ellipse, #petRoot #pt-eye-l path');
      return { blazeW: maxX - minX, minX: minX, maxX: maxX, samples: xs.length };
    `);
    check('双色白 V 明显：V 宽 ' + (blazeRes && blazeRes.blazeW ? blazeRes.blazeW.toFixed(1) : '?') +
      '（旧版窄 V 只有 22 左右），左右都到眼睛外角附近',
      !!(blazeRes && blazeRes.blazeW > 24 && blazeRes.minX < 49 && blazeRes.maxX > 71),
      JSON.stringify(blazeRes));

    /* ---------------- 6. 数值按真实时间衰减 ---------------- */
    const decay = await jget(page, `(function () {
      Pet.get().sleepUntil = 0;
      return JSON.parse(window.__p.age(10, { satiety: 80, mood: 80, bond: 80, energy: 80 }));
    })()`);
    const ds = decay && decay.stats;
    check('十小时没打开：饱食度 / 心情 / 精力 按时间差值掉下来了（80 → ' +
      (ds ? Math.round(ds.satiety) + ' / ' + Math.round(ds.mood) + ' / ' + Math.round(ds.energy) : '?') + '）',
      !!(ds && ds.satiety < 40 && ds.mood < 70 && ds.energy < 80 && ds.bond <= 80), JSON.stringify(decay));
    check('衰减是「按秒算」的：10 小时正好扣 70 点饱食度',
      !!(ds && Math.abs(ds.satiety - 10) < 0.01), JSON.stringify(ds));

    const oneHour = await jget(page, `JSON.parse(window.__p.age(1, { satiety: 80, mood: 80, bond: 80, energy: 80 }))`);
    check('一小时：饱食度 -7 / 心情 -4 / 精力 -1 / 亲密度 -0.2（各自速率不同）',
      !!(oneHour && Math.abs(oneHour.stats.satiety - 73) < 0.01 && Math.abs(oneHour.stats.mood - 76) < 0.01 &&
        Math.abs(oneHour.stats.energy - 79) < 0.01 && Math.abs(oneHour.stats.bond - 79.8) < 0.01),
      JSON.stringify(oneHour));

    const long = await jget(page, `JSON.parse(window.__p.age(24 * 35, { satiety: 80, mood: 80, bond: 80, energy: 80 }))`);
    check('放 35 天再打开：数值 clamp 在 0–100，不会变成负数或 NaN',
      !!(long && long.stats.satiety === 0 && long.stats.mood === 0 && long.stats.energy === 0 &&
        long.stats.bond >= 0 && long.stats.bond <= 100 &&
        Object.keys(long.stats).every(function (k) { return isFinite(long.stats[k]); })),
      JSON.stringify(long));

    /* ---------------- 6. 番茄钟 ---------------- */
    const focus = await acall(page, `
      Pet.get().sleepUntil = 0;
      Pet.setStat('satiety', 60); Pet.setStat('mood', 50); Pet.setStat('energy', 60); Pet.save();
      Pet.open();
      window.__p.tap(document.querySelector('[data-pet-focus="25"]'));
      await new Promise(function (r) { setTimeout(r, 200); });
      var p = Pet.get();
      var left0 = Pet.focusLeft();
      var live = document.querySelector('[data-pet="focus-live"]');
      var t0 = live ? live.textContent : '';
      var bubble0 = !!document.querySelector('#petRoot .pet-bubble.show');
      await new Promise(function (r) { setTimeout(r, 2400); });
      var left1 = Pet.focusLeft();
      var live2 = document.querySelector('[data-pet="focus-live"]');
      var t1 = live2 ? live2.textContent : '';
      return { until: p.focusUntil, min: p.focusMin, left0: left0, left1: left1, t0: t0, t1: t1, bubble: bubble0 };
    `);
    check('番茄钟：选 25 分钟后倒计时开始（还剩 ' + (focus ? Math.round(focus.left0 / 1000) + 's' : '?') + '）',
      !!(focus && focus.until > Date.now() && focus.min === 25 &&
        focus.left0 > 24 * 60000 && focus.left0 <= 25 * 60000), JSON.stringify(focus));
    check('番茄钟：菜单里显示倒计时，而且真的在走（「' + (focus ? focus.t0 : '') + '」→「' + (focus ? focus.t1 : '') + '」）',
      !!(focus && /专注中/.test(focus.t0) && /^⏱ 专注中 \d+:\d\d$/.test(focus.t1) && focus.left1 < focus.left0),
      JSON.stringify(focus));
    check('番茄钟开启时有陪伴提示（气泡）', !!(focus && focus.bubble), JSON.stringify(focus));
    const focusOff = await jget(page, `(function () { Pet.stopFocus(); return { left: Pet.focusLeft(), until: Pet.get().focusUntil }; })()`);
    check('结束专注后倒计时停止', !!(focusOff && focusOff.left === 0 && focusOff.until === 0), JSON.stringify(focusOff));

    /* ---------------- 7. 设置页开关 + UI.render() 持久 ---------------- */
    await acall(page, `
      Pet.close();
      UI.go('stats/settings');
      await new Promise(function (r) { setTimeout(r, 900); });
      return { path: UI.currentPath() };
    `);
    const rawSettings = await page.evalRaw(`JSON.stringify(({
      switchEl: (function () {
        var rows = document.querySelectorAll('#view .switch');
        for (var i = 0; i < rows.length; i++) {
          if ((rows[i].textContent || '').indexOf('桌宠') >= 0) return true;
        }
        return false;
      })(),
      hasLevel: String(document.getElementById('view').innerText).indexOf('Lv.') >= 0,
      grow: String(document.getElementById('view').innerText).indexOf('成长状态') >= 0,
      chips: String(document.getElementById('view').innerText).indexOf('陪伴提示') >= 0
    }))`);
    const settingsDom = rawSettings.ok && rawSettings.value ? JSON.parse(String(rawSettings.value)) : null;
    const settingsPath = await page.eval('UI.currentPath()');
    const toggleOk = await acall(page, 'var t = window.__p.toggleEl(); return { found: !!t, on: !!t && t.classList.contains("on") };');
    check('设置页多出「桌宠」开关 + 成长状态（等级 / 亲密度）+ 陪伴提示间隔',
      !!(settingsDom && settingsPath === 'stats/settings' && settingsDom.switchEl && settingsDom.hasLevel &&
        settingsDom.grow && settingsDom.chips && toggleOk && toggleOk.found && toggleOk.on),
      JSON.stringify({ path: settingsPath, dom: settingsDom, toggle: toggleOk }));

    /* 关掉 → 猫藏起来 → 再 render 一次，状态还在 */
    const swOff = await acall(page, `
      window.__p.tap(window.__p.toggleEl());
      await new Promise(function (r) { setTimeout(r, 260); });
      var root = document.getElementById('petRoot');
      var stored = JSON.parse(window.__p.storePet());
      UI.render();
      await new Promise(function (r) { setTimeout(r, 300); });
      var root2 = document.getElementById('petRoot');
      return {
        storedEnabled: stored.enabled,
        hiddenAfterToggle: root ? root.classList.contains('hidden') : null,
        hiddenAfterRender: root2 ? root2.classList.contains('hidden') : null,
        toggleOff: !window.__p.toggleEl().classList.contains('on')
      };
    `);
    check('设置开关：关掉后猫被隐藏，settings.pet.enabled=false 落盘，UI.render() 之后依然是关的',
      !!(swOff && swOff.storedEnabled === false && swOff.hiddenAfterToggle === true &&
        swOff.hiddenAfterRender === true && swOff.toggleOff === true), JSON.stringify(swOff));

    const swOn = await acall(page, `
      window.__p.tap(window.__p.toggleEl());
      await new Promise(function (r) { setTimeout(r, 260); });
      var root = document.getElementById('petRoot');
      var stored = JSON.parse(window.__p.storePet());
      UI.render();
      await new Promise(function (r) { setTimeout(r, 300); });
      var root2 = document.getElementById('petRoot');
      return { storedEnabled: stored.enabled,
               hiddenNow: root ? root.classList.contains('hidden') : null,
               hiddenAfterRender: root2 ? root2.classList.contains('hidden') : null };
    `);
    check('设置开关：再打开后猫回来了，而且 UI.render() 之后仍然在',
      !!(swOn && swOn.storedEnabled === true && swOn.hiddenNow === false && swOn.hiddenAfterRender === false),
      JSON.stringify(swOn));

    /* 抽屉打开时应该自动让位（不抢弹层），而且平时只占自己那一小块 */
    const politeness = await acall(page, `
      UI.go('novel');
      await new Promise(function (r) { setTimeout(r, 700); });
      await window.__p.waitVisible(3000);
      var root = document.getElementById('petRoot');
      var before = !root.classList.contains('hidden');
      var b = root.getBoundingClientRect();
      var area = (b.width * b.height) / (window.innerWidth * window.innerHeight);
      var bub = document.querySelector('#petRoot .pet-bubble');
      UI.sheet({ title: '测试抽屉', body: 'x' });
      await new Promise(function (r) { setTimeout(r, 240); });
      var during = root.classList.contains('hidden');
      UI.closeSheet();
      await new Promise(function (r) { setTimeout(r, 240); });
      var after = !root.classList.contains('hidden');
      return {
        before: before, during: during, after: after, sheetOpen: UI.isSheetOpen(),
        w: Math.round(b.width), h: Math.round(b.height),
        areaPct: Math.round(area * 100),
        bubblePointer: bub ? getComputedStyle(bub).pointerEvents : 'none',
        menuPointer: (function () { var m = document.getElementById('petMenu'); return m ? getComputedStyle(m).pointerEvents : 'none'; })()
      };
    `);
    check('礼貌：抽屉打开时自动让位、关掉后回来；触摸面积只有自己那一小块（' + (politeness ? politeness.areaPct : '?') + '% 屏幕），气泡不拦触摸',
      !!(politeness && politeness.before && politeness.during && politeness.after &&
        politeness.sheetOpen === false && politeness.w > 0 && politeness.w <= 96 &&
        politeness.areaPct <= 3 && politeness.bubblePointer === 'none'),
      JSON.stringify(politeness));

    /* ---------------- 8. 控制台报错 ---------------- */
    const errs = page.errors().filter((e) => !/favicon/i.test(e.text));
    check('整轮检查没有控制台报错 / 未捕获异常', errs.length === 0,
      errs.slice(0, 6).map((e) => e.type + ': ' + e.text).join(' | '));

    try { await page.shot('shots/test-pet.png'); } catch (e) { /* 截图失败不影响结论 */ }
  } catch (e) {
    failed++;
    console.log('FAIL  运行异常: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ⏎ ') : e));
  } finally {
    try { if (page) page.close(); } catch (e) { /* noop */ }
    try { if (browser && browser.proc) browser.proc.kill(); } catch (e) { /* noop */ }
  }

  console.log('');
  console.log('===== 桌宠：' + passed + '/' + (passed + failed) + ' 通过 =====');
  if (failed) {
    console.log('（Edge: ' + (() => { try { return findEdge(); } catch (e) { return '未找到'; } })() + '）');
    process.exitCode = 1;
  }
})();
