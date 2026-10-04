/* ==========================================================================
   selfwriting · i18n-scan.js（开发工具，不属于应用本体）
   就地切到英文后逐屏采集「仍然是中文」的界面文案。
   用法：node tools/i18n-scan.js [端口]      输出：tools/.i18n-scan.json
   说明：词典是「整段完全匹配」替换、只覆盖一小部分界面，所以采到的每一条
         都是英文界面里仍然显示中文的用户可见文案。切到英文后 aria-label
         同样会被词典改写，因此按钮定位用「中文原文|英文译文」双写正则。
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { launch, Page, sleep } = require('./driver');

const ARGV = process.argv.slice(2);
const PORT = Number(ARGV[0] && ARGV[0].charAt(0) !== '-' ? ARGV[0] : 8099);
const BASE = 'http://127.0.0.1:' + PORT + '/index.html?nosw=1';
const OUT = path.join(__dirname, '.i18n-scan.json');
const STEP = 700;                    // 每次跳转 / 点击后的固定等待

/* 浏览器内：采集当前界面上所有仍然含中文的文案（正文容器与表单控件除外） */
const COLLECT = `
  var CJK = /[\\u4e00-\\u9fff]/;
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, NOSCRIPT: 1 };
  function skipEl(el) {
    if (SKIP[el.tagName] || el.isContentEditable) return true;
    if (el.closest && el.closest('script,style,textarea,input,select,[contenteditable],.reader-stage')) return true;
    return el.offsetParent === null && el.tagName !== 'BODY';
  }
  var out = [], seen = {};
  function push(s) {
    s = String(s || '').replace(/\\s+/g, ' ').trim();
    if (!s || s.length > 60 || !CJK.test(s) || seen[s]) return;
    seen[s] = 1; out.push(s);
  }
  var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n;
  while ((n = w.nextNode())) { if (n.parentElement && !skipEl(n.parentElement)) push(n.nodeValue); }
  Array.prototype.forEach.call(document.querySelectorAll('[placeholder],[title],[aria-label]'), function (el) {
    if (el.closest && el.closest('.reader-stage')) return;
    ['placeholder', 'title', 'aria-label'].forEach(function (a) { if (el.getAttribute(a)) push(el.getAttribute(a)); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('option,button[value],input[value]'), function (el) {
    if (el.tagName !== 'INPUT') push(el.textContent);
    if (el.getAttribute('value')) push(el.getAttribute('value'));
  });
  return JSON.stringify({ url: location.hash || '#/', strings: out });
`;

/* 按钮定位用的「中文原文 | 英文译文」表（译文取自 js/i18n.js 的 en 词典） */
const LB = {
  importText: '导入文本|Import text', importBook: '导入读物|Import book|Import text',
  restore: '恢复备份|Restore backup', newItem: '新建|^New$',
  host: '开一个协作室|开一个房间|Host a room', share: '生成分享包|Create share',
  friends: '添加密友|Add a friend', write: '写一篇|再写一篇|Write',
  branch: '新增分支|添加主干|New branch', budget: '字数目标',
  pin: '开启隐私锁|Turn on privacy|修改密码|Change password',
  color: '颜色|Colou?r', tools: '写作功能库|Writing tools', more: '更多|^More$'
};
for (const k of Object.keys(LB)) LB[k] = '/' + LB[k] + '/';

/* 浏览器内：各屏 setup 复用的通用小工具 */
const HELP = `
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function txt(el) { return (el.textContent || '').replace(/\\s+/g, ' ').trim(); }
  function label(el) { return (el.getAttribute && (el.getAttribute('aria-label') || el.title)) || ''; }
  function pick(list, rx) { return list.filter(function (el) { return rx.test(txt(el)) || rx.test(label(el)); })[0]; }
  function click(el) { if (el) el.click(); return !!el; }
  function btn(rx) { return pick($$('button,.row,.row-title,.game-card,.chip,.tool-tab,.list .row'), rx); }
  function tipBtn(rx) { return $$('#appbar .icon-btn,.icon-btn').filter(function (b) { return !b.dataset.icon && rx.test(label(b)); })[0]; }
  /* 只在弹层里找菜单项：页面上（如写作页大纲面板）也有同名的 .row-title */
  function menuItem(rx) { return pick($$('#sheetBody .row-title'), rx) || pick($$('#sheetBody .row'), rx); }
  function menuRow(rx) { var t = menuItem(rx); return t ? (t.closest('#sheetBody .row') || t.parentNode) : null; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isOpen() { var h = $('#sheetHost'); return !!h && !h.classList.contains('hidden'); }
  function isModal() { var m = $('#modalHost'); return !!m && !m.classList.contains('hidden'); }
  function reset() {
    window.UI.closeSheet(); window.UI.closeModal();
    /* 首启引导会盖住界面并吃掉点击，先关掉 */
    if (/欢迎使用/.test(($('#sheetTitle') || {}).textContent || '')) click(pick($$('#sheetFoot .btn'), /开始创作|Start/));
    window.UI.closeSheet();
  }
  function id(list) { return (list && list[0] && list[0].id) || ''; }
  function novel() { return id(Store.state.novels); }
  function chap() { return id(Store.state.novels[0].chapters); }
  function book() { return id(Store.state.reading); }
  function article() { return id(Store.state.articles); }
  function day() { return window.U.dateKey(); }
  /* 挑「今天有记录」的日记本 / 「有章节」的读物，否则采不到条目与读物菜单 */
  function diary() {
    var books = Store.state.diaries || [], today = day();
    var withToday = books.filter(function (x) { return (x.entries || []).some(function (e) { return e.dateKey === today; }); });
    var any = books.filter(function (x) { return (x.entries || []).length; });
    return id(withToday) || id(any) || id(books);
  }
  function bookWithContent() { var b = (Store.state.reading || []).filter(function (x) { return (x.chapters || []).length; }); return id(b) || book(); }
  function go(p) { reset(); window.UI.go(p); }
  function openEditor() { go('editor/' + novel() + '/' + chap()); return wait(800); }
  function openReader() { go('read/' + bookWithContent() + '/start'); return wait(900); }
  /* 阅读页顶部按钮既没有 data-icon 也没有 id，只能按图标形状定位
     （more = 四个小方块，list = 三条横线） */
  function iconBtns(pathRe) { return $$('#appbar .icon-btn').filter(function (b) { return pathRe.test(String(b.innerHTML)); }); }
  /* 作品卡片右上角的「更多」：无 data-icon（顶部栏那个带 data-icon） */
  function cardMenu() { return click(($$('#view .card-head .icon-btn,#view .card .icon-btn').filter(function (b) { return !b.dataset.icon && ${LB.more}.test(label(b)); })[0])); }
  function tip(rx) { return wait(500).then(function () { return click(tipBtn(rx)); }); }
  function ensure(kind) {
    var ok = kind === 'sheet' ? isOpen() : kind === 'modal' ? isModal()
      : kind === 'drawer' ? !!$('.tool-side.open') : !!$('#brightnessPanel:not(.hidden)');
    if (!ok) throw new Error(kind + ' 未打开');
    return kind;
  }
`;

/* 屏幕 / 弹层清单：route 是描述，nav 是进入动作，kind 是期望打开的弹层 */
const S = (route, nav, kind) => ({ route, nav, kind });
const SCREENS = [
  S('tab:novel (#/novel)', `go('novel')`), S('tab:article (#/article)', `go('article')`),
  S('tab:diary (#/diary)', `go('diary')`), S('tab:outline (#/outline)', `go('outline')`),
  S('tab:reader (#/reader)', `go('reader')`), S('all-works (#/all-works)', `go('all-works')`),
  S('novel detail (#/library/novel/:id)', `go('library/novel/' + novel())`),
  S('article detail (#/library/article/:id)', `go('library/article/' + article())`),
  S('diary day (#/diary/:bookId/:date)', `go('diary/' + diary() + '/' + day())`),
  S('stats (#/stats)', `go('stats')`), S('achievements (#/stats/achievements)', `go('stats/achievements')`),
  S('settings (#/stats/settings)', `go('stats/settings')`), S('trash (#/stats/trash)', `go('stats/trash')`),
  S('fun/tools hub (#/fun)', `go('fun')`), S('calculator (#/calc)', `go('calc')`),
  S('games hub (#/games)', `go('games')`), S('game:snake (#/games/1)', `go('games/1')`),
  S('game:tetris (#/games/2)', `go('games/2')`), S('music (#/music)', `go('music')`),
  S('music:compose (#/music/compose)', `go('music/compose')`), S('music:lyrics (#/music/lyrics)', `go('music/lyrics')`),
  S('notes (#/notes)', `go('notes')`), S('privacy lock (#/privacy)', `go('privacy')`),
  S('collab (#/collab)', `go('collab')`), S('editor:novel chapter (#/editor/:novelId/:chapterId)', `await openEditor()`),
  S('editor:article (#/editor/:articleId)', `go('editor/' + article())`),
  S('outline editor (#/outline/:novelId)', `go('outline/' + novel())`),
  S('reader open book (#/read/:bookId/start)', `await openReader()`),

  /* ---- 弹层 / 抽屉 / 面板 ---- */
  S('sheet:today chip (今日创作)', `go('novel'); await wait(400); click($('#todayChip'))`, 'sheet'),
  S('sheet:more panel (UI.funSheet)', `go('novel'); await wait(400); window.UI.funSheet()`, 'sheet'),
  S('sheet:new item (新建)', `go('novel'); await wait(400); click($('.fab') || btn(${LB.newItem}))`, 'sheet'),
  S('sheet:import text (导入文本)', `go('novel'); await wait(400); click(btn(${LB.importText}))`, 'sheet'),
  S('sheet:import reading (导入读物)', `go('reader'); await wait(400); click(pick($$('#view button'), ${LB.importBook}))`, 'sheet'),
  S('sheet:restore backup (恢复备份)', `go('novel'); await wait(400); click(btn(${LB.restore}))`, 'modal'),
  S('sheet:global search (搜索)', `go('novel'); await wait(400); click($('#navSearch'))`, 'sheet'),
  S('panel:brightness (亮度)', `go('novel'); await wait(400); click($('#navBrightness'))`, 'bright'),
  S('sheet:novel card menu (作品卡片菜单)', `go('novel'); await wait(500); cardMenu()`, 'sheet'),
  S('sheet:novel detail menu (小说详情菜单)', `go('library/novel/' + novel()); await wait(500); cardMenu()`, 'sheet'),
  S('sheet:editor menu (写作页更多)', `await openEditor(); await tip(${LB.more})`, 'sheet'),
  S('sheet:editor continue (续写辅助)', `await openEditor(); await tip(/续写辅助|Continue writing/)`, 'sheet'),
  S('sheet:editor typography (排版)', `await openEditor(); await tip(/排版|Typography/)`, 'sheet'),
  S('sheet:chapter goal (本章字数目标)', `await openEditor(); await tip(${LB.more}); await wait(500); click(menuRow(${LB.budget}))`, 'modal'),
  /* 必须点「下一章」——第一章点「上一章」只会弹「没有上一章了」的提示 */
  S('sheet:chapter compare (与下一章对照)', `await openEditor(); await tip(${LB.more}); await wait(500); click(menuRow(/下一章对照/))`, 'sheet'),
  S('drawer:writing tools (写作功能库)', `await openEditor(); await tip(${LB.tools})`, 'drawer'),
  S('drawer:tools tab 大纲', `await openEditor(); await tip(${LB.tools}); await wait(500); click(pick($$('.tool-tab'), /大纲|Outline/))`, 'drawer'),
  S('drawer:tools tab 排版', `await openEditor(); await tip(${LB.tools}); await wait(500); click(pick($$('.tool-tab'), /排版|Typography/))`, 'drawer'),
  S('drawer:tools tab 目标', `await openEditor(); await tip(${LB.tools}); await wait(500); click(pick($$('.tool-tab'), /目标|Goals?/))`, 'drawer'),
  S('sheet:diary entry editor (写一篇)', `go('diary/' + diary() + '/' + day()); await wait(500); click(btn(${LB.write}))`, 'sheet'),
  S('sheet:diary entry menu (记录操作)', `go('diary/' + diary() + '/' + day()); await wait(800); var hb = $$('#view .card-head .icon-btn')[0]; if (hb) hb.click(); else cardMenu()`, 'sheet'),
  S('sheet:reader book menu (阅读操作)', `await openReader(); click(iconBtns(/M4 4h7v7/)[0])`, 'sheet'),
  S('sheet:reader contents (目录)', `await openReader(); click(iconBtns(/M4 6h16M4 12h16/)[0])`, 'sheet'),
  S('sheet:reader settings (阅读设置)', `await openReader(); click(iconBtns(/M4 4h7v7/)[0]); await wait(800); click(menuRow(/阅读设置|Reading settings/))`, 'sheet'),
  S('sheet:reader search book (搜索本书)', `await openReader(); click(iconBtns(/M4 4h7v7/)[0]); await wait(800); click(menuRow(/搜索本书|Search/))`, 'sheet'),
  S('sheet:reader card menu (读物菜单)', `go('reader'); await wait(600); click($('#view .card .card-head .icon-btn'))`, 'sheet'),
  S('sheet:collab host room (开一个协作室)', `go('collab'); await wait(500); click(btn(${LB.host}))`, 'sheet'),
  S('sheet:collab join room (加入协作室)', `go('collab'); await wait(500); click(pick($$('#view button'), /输入房间码|Join with/))`, 'sheet'),
  S('sheet:collab share pack (生成分享包)', `go('collab'); await wait(500); click(btn(${LB.share}))`, 'sheet'),
  S('sheet:collab add friend (添加密友)', `go('collab'); await wait(500); click(btn(${LB.friends}))`, 'modal'),
  S('sheet:privacy pin setup (开启隐私锁)', `go('privacy'); await wait(500); click(btn(${LB.pin}))`, 'sheet'),
  S('sheet:outline node color (分支颜色)', `go('outline/' + novel()); await wait(600); click(tipBtn(${LB.color}))`, 'sheet'),
  S('sheet:outline node menu (节点更多)', `go('outline/' + novel()); await wait(600); click($$('.ot-actions .icon-btn,.ot-row .icon-btn').pop())`, 'sheet'),
  S('sheet:outline add branch (新增分支)', `go('outline/' + novel()); await wait(700); click(pick($$('#view button'), ${LB.branch}))`, 'modal')
];

async function main() {
  const browser = await launch();
  const skipped = [];
  try {
    const page = await Page.open(browser, BASE + '#/novel');
    console.log('目标: ' + BASE + '  |  Edge ' + browser.version['Browser']);

    /* 1) 等应用启动；2) 造一套干净的示例数据，逐屏才有内容可扫 */
    let ok = false;
    for (let i = 0; i < 80 && !ok; i++) {
      ok = await page.eval('!!(window.Store && window.Store.state && window.UI)').catch(() => false);
      if (!ok) await sleep(300);
    }
    if (!ok) throw new Error('应用未能启动（Store/UI 未就绪）');
    try {
      await page.eval(`(function(){ window.Store.setSetting('language','zh-CN'); return 1; })()`);
      await page.call('await window.__selfwritingReset(); return "ok";');
      await page.goto(BASE + '#/novel');
      await sleep(1400);
      await page.call('window.__selfwritingDemo(); await new Promise(function(r){setTimeout(r,2600)}); return "ok";');
    } catch (e) { console.log('示例数据准备失败（沿用现有数据）: ' + e.message); }

    /* 3) 就地切到英文，并关掉会盖住界面的首启引导 */
    console.log('语言切换: ' + await page.call(HELP + `
      reset();
      if (!window.I18N) return 'no-i18n';
      window.I18N.setLang('en', { noReload: true });
      try { window.Store.setSetting('language', 'en'); } catch (e) { /* noop */ }
      await wait(800);
      return 'lang=' + window.I18N.lang() + ' dict=' + window.I18N.dictSize('en')
        + ' sheetOpen=' + isOpen() + ' novels=' + Store.state.novels.length;
    `));

    /* 4) 逐屏采集：每屏先跑一次全量词典替换（观察器只管新增节点，
          aria-label 这类属性被改写后需要重新应用才算「英文界面」） */
    const ordered = [], counts = Object.create(null), screens = [];
    for (let i = 0; i < SCREENS.length; i++) {
      const spec = SCREENS[i];
      let res, why = '';
      for (let attempt = 0; attempt < 2; attempt++) {      // 偶发时序问题重试一次
        try {
          await page.call(HELP + `if (window.I18N) window.I18N.start(); await wait(120); ${spec.nav}; return 1;`);
          await sleep(STEP);
          if (spec.kind) await page.call(HELP + 'return ensure(' + JSON.stringify(spec.kind) + ');');
          await page.call(HELP + 'if (window.I18N) window.I18N.start(); await wait(150); return 1;');
          res = JSON.parse(await page.call(HELP + COLLECT));
          why = '';
          break;
        } catch (e) {
          why = String(e.message || e).split('\n')[0].slice(0, 100);
          res = null;
          await page.call(HELP + 'reset(); await wait(300); return 1;').catch(() => undefined);
        }
      }
      if (!res) {
        /* 跳过这一屏，并记下页面真实状态，便于定位是哪个选择器没命中 */
        let diag = 'diag-failed';
        try {
          diag = String(await page.call(HELP + `
            var h = $('#sheetHost'), m = $('#modalHost');
            return 'sheet=' + (h && !h.classList.contains('hidden') ? (($('#sheetTitle')||{}).textContent||'?') : '-')
              + ' modal=' + (m && !m.classList.contains('hidden') ? 1 : 0) + ' hash=' + location.hash
              + ' rows=' + $$('#sheetBody .row-title').map(txt).join('|').slice(0, 90)
              + ' toast=' + (($('#toastHost')||{}).innerText || '').slice(0, 40);`));
        } catch (e2) { /* 保持 diag-failed */ }
        skipped.push(spec.route + ' → ' + why + ' [' + diag + ']');
        console.log('SKIP [' + (i + 1) + '/' + SCREENS.length + '] ' + spec.route + ' → ' + why + '  ' + diag);
        continue;
      }
      res.strings.forEach((s) => { counts[s] = (counts[s] || 0) + 1; if (ordered.indexOf(s) < 0) ordered.push(s); });
      screens.push({ route: spec.route, strings: res.strings });
      console.log('[' + (i + 1) + '/' + SCREENS.length + '] ' + spec.route + ' @' + res.url + ' → ' + res.strings.length + ' 条');
    }

    /* 5) 落盘 + 终端摘要 */
    fs.writeFileSync(OUT, JSON.stringify({ screens: screens, all: ordered, counts: counts }, null, 2), 'utf8');
    const top = ordered.slice().sort((a, b) => (counts[b] - counts[a]) || (ordered.indexOf(a) - ordered.indexOf(b))).slice(0, 40);
    console.log('\n================ 扫描汇总 ================');
    console.log('扫描屏幕: ' + screens.length + ' / ' + SCREENS.length + '（跳过 ' + skipped.length + '）');
    console.log('仍然中文的唯一文案: ' + ordered.length + ' 条');
    console.log('输出文件: ' + OUT);
    console.log('\n出现最多的 40 条（次数 × 文案）:');
    top.forEach((s, i) => console.log('  ' + String(i + 1).padStart(2) + '. [' + counts[s] + 'x] ' + s));
    if (skipped.length) { console.log('\n跳过的屏幕:'); skipped.forEach((s) => console.log('  - ' + s)); }
  } finally {
    try { browser.proc.kill(); } catch (e) { /* noop */ }
  }
}

main().catch((e) => { console.error('扫描失败: ' + (e && e.stack || e)); process.exit(1); });
