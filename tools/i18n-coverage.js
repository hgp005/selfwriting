/* ==========================================================================
   selfwriting · i18n-coverage.js（开发用，不属于应用本体）
   量测「切成英文之后，界面上还剩多少中文」。
   做法：造一套测试数据 → 切成英文（就地，不刷新）→ 逐个界面统计中文文本节点。
   用法： node tools/i18n-coverage.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, Page, sleep } = require('./driver');

const PORT = Number(process.argv[2] || 8099);
const LANG = process.argv[3] || 'en';
const BASE = 'http://127.0.0.1:' + PORT + '/index.html?nosw=1';

/* 界面清单：每一项是 [名称, 页面里执行的 JS]（导航或打开弹层） */
const SCREENS = [
  ['小说', "UI.go('novel')"],
  ['文章', "UI.go('article')"],
  ['日记', "UI.go('diary')"],
  ['大纲', "UI.go('outline')"],
  ['阅读', "UI.go('reader')"],
  ['统计', "UI.go('stats')"],
  ['成就', "UI.go('stats/achievements')"],
  ['设置', "UI.go('stats/settings')"],
  ['回收站', "UI.go('stats/trash')"],
  ['更多', "UI.go('fun')"],
  ['计算器', "UI.go('calc')"],
  ['游戏', "UI.go('games')"],
  ['音乐', "UI.go('music')"],
  ['便签', "UI.go('notes')"],
  ['隐私锁', "UI.go('privacy')"],
  ['协作', "UI.go('collab')"],
  ['今日创作', "UI.todaySheet()"],
  ['更多功能面板', "UI.funSheet()"],
  ['新建作品', "UI.newItemSheet && UI.newItemSheet()"],
  ['导入文本', "Library && Library.importFlow && Library.importFlow()"],
  ['全局搜索', "UI.search()"]
];

async function main() {
  const browser = await launch();
  const page = await Page.open(browser, BASE + '#/novel');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (await page.eval('!!(window.Store && window.Store.state && window.UI && window.U)').catch(() => false)) { ready = true; break; }
    await sleep(300);
  }
  if (!ready) throw new Error('应用没有启动完成');

  /* 切成目标语言（就地切换，不刷新页面），后面统计的都是该语言下的残留中文 */
  const langNow = await page.eval("(function(){ window.I18N.setLang('" + LANG + "', { noReload: true }); return window.I18N.lang(); })()");
  console.log('当前语言: ' + langNow);
  await sleep(600);

  /* 造测试数据（覆盖列表、详情、写作页、日记、阅读器） */
  const ids = JSON.parse(await page.call(`    var S = window.Store, U = window.U;
    var n = S.createNovel({ title: '测试小说' });
    var nv = S.state.novels.filter(function (x) { return x.id === n.id; })[0];
    var c1 = nv.chapters[0];
    S.addOutlineNode(n.id, null, { text: '主线', color: 'ink', star: true });
    var a = S.createArticle({ title: '测试文章', content: '正文内容。' });
    var d = S.createDiaryBook({ title: '测试日记本' });
    S.addDiaryEntry(d.id, { dateKey: U.dateKey(), content: '今天写了点东西。', mood: '平静', weather: '晴' });
    var bk = S.createBook({ title: '测试读物', format: 'txt', chapters: [{ title: '第一节', content: '正文。' }] });
    await S.flushNow();
    return JSON.stringify({ nid: n.id, cid: c1.id, aid: a.id, did: d.id, bid: bk.id });
  `));

  const routes = [
    ['小说详情', "UI.go('library/novel/" + ids.nid + "')"],
    ['文章详情', "UI.go('library/article/" + ids.aid + "')"],
    ['写作页', "UI.go('editor/" + ids.nid + "/" + ids.cid + "')"],
    ['文章写作', "UI.go('editor/" + ids.aid + "')"],
    ['日记本', "UI.go('diary/" + ids.did + "/" + new Date().toISOString().slice(0, 10) + "')"],
    ['大纲编辑', "UI.go('outline/" + ids.nid + "')"],
    ['阅读正文', "UI.go('read/" + ids.bid + "/start')"]
  ].concat(SCREENS);

  const report = [];
  /* 统计口径：
     · en → 任何汉字都算没翻好
     · zh-TW → 只揪「简体专用字」（从词条表里简体/繁体不同的字推出来），
       因为繁体界面本来就该是汉字 */
  const SIMP = (() => {
    if (LANG !== 'zh-TW') return '';
    try {
      const extra = fs.readFileSync(path.join(__dirname, '..', 'js', 'i18n-extra.js'), 'utf8');
      const win = {};
      new Function('window', extra)(win);
      const obj = win.I18N_EXTRA || {};
      const set = new Set();
      Object.keys(obj['zh-TW'] || {}).forEach((zh) => {
        const tw = obj['zh-TW'][zh];
        for (let i = 0; i < zh.length && i < tw.length; i++) {
          if (zh[i] !== tw[i] && /[\u4e00-\u9fff]/.test(zh[i])) set.add(zh[i]);
        }
      });
      console.log('检测用简体专用字: ' + set.size + ' 个');
      return Array.from(set).join('');
    } catch (e) { console.log('简体字表生成失败: ' + e.message); return ''; }
  })();

  for (const [label, code] of routes) {
    const res = await page.call(`
      var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      try { ${code}; } catch (e) { return JSON.stringify({ label: '${label}', error: String(e.message || e) }); }
      await wait(420);
      var simp = '${SIMP.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';
      var hosts = ['view', 'appbar', 'tabbar', 'sheetHost', 'modalHost'].map(function (id) { return document.getElementById(id); }).filter(Boolean);
      var found = [];
      var unknown = [];
      var walk = function (el) {
        if (!el) return;
        if (el.nodeType === 3) {
          var t = el.nodeValue.trim();
          if (t && /[\\u4e00-\\u9fff]/.test(t) && t.length <= 60) {
            if (!simp) found.push(t);
            else if (window.I18N.twGap(t)) found.push(t);
            else if (window.I18N.unknown(t)) unknown.push(t);
          }
          return;
        }
        if (el.nodeType !== 1) return;
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return;
        if (el.classList && (el.classList.contains('reader-stage') || el.classList.contains('user-text'))) return;
        /* 明确标了「不翻译」的地方（语言名称、用户名、状态、专属码）不算漏翻 */
        if (el.hasAttribute && el.hasAttribute('data-i18n-skip')) return;
        if (el.closest && el.closest('[data-i18n-skip]')) return;
        var kids = el.childNodes;
        for (var i = 0; i < kids.length; i++) walk(kids[i]);
      };
      hosts.forEach(walk);
      var uniq = [];
      found.forEach(function (s) { if (uniq.indexOf(s) < 0) uniq.push(s); });
      var uniqU = [];
      unknown.forEach(function (s) { if (uniqU.indexOf(s) < 0) uniqU.push(s); });
      return JSON.stringify({ label: '${label}', count: found.length, uniq: uniq, unknown: uniqU });
    `);
    report.push(JSON.parse(res));
  }

  /* 收尾：关掉可能开着的弹层 */
  try { await page.eval('(window.UI.closeSheet(), 1)'); } catch (e) { /* noop */ }

  let total = 0;
  const all = [];
  const unknownAll = [];
  report.forEach((r) => {
    if (r.error) { console.log('  [x] ' + r.label + ': ' + r.error); return; }
    total += r.count;
    console.log('  ' + (r.count === 0 ? 'OK  ' : '    ') + r.label + ': ' + r.count + ' 处未翻译');
    (r.uniq || []).forEach((s) => { if (all.indexOf(s) < 0) all.push(s); });
    (r.unknown || []).forEach((s) => { if (unknownAll.indexOf(s) < 0) unknownAll.push(s); });
  });

  console.log('\n合计未翻译的文本节点: ' + total + '，去重后 ' + all.length + ' 条');
  if (all.length) {
    console.log('--- 未翻译（前 60 条） ---');
    all.slice(0, 60).forEach((s) => console.log('  ' + s));
  }
  if (LANG !== 'en' && unknownAll.length) {
    console.log('--- 词典里查不到（多半是用户内容或运行时拼接，前 25 条） ---');
    unknownAll.slice(0, 25).forEach((s) => console.log('  ' + s));
  }
  browser.proc.kill();
}

main().catch((e) => { console.error('失败: ' + ((e && e.stack) || e)); process.exit(1); });
