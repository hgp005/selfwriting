/* 验证多语种真的生效：切到英文 → 重载 → 检查界面文字 */
'use strict';
const { launch, Page, sleep } = require('./driver');

const BASE = 'http://127.0.0.1:8099/index.html?nosw=1';

async function main() {
  const browser = await launch();
  const page = await Page.open(browser, BASE + '#/novel');
  for (let i = 0; i < 40; i++) {
    if (await page.eval('!!(window.Store && window.Store.state && window.UI && window.I18N)').catch(() => false)) break;
    await sleep(400);
  }

  const zh = await page.call(`
    window.Store.setSetting('language', 'zh-CN');
    window.UI.go('novel');
    await new Promise(function (r) { setTimeout(r, 700); });
    return JSON.stringify({
      tabs: Array.prototype.map.call(document.querySelectorAll('.tab'), function (t) { return t.textContent.trim(); }).join(','),
      title: (document.getElementById('viewTitle') || {}).textContent
    });
  `);
  console.log('中文：' + zh);

  /* 切到英文并重载 */
  await page.call(`window.I18N.setLang('en', { noReload: true }); return 'ok';`);
  await page.hardGoto(BASE + '#/novel');
  for (let i = 0; i < 40; i++) {
    if (await page.eval('!!(window.Store && window.Store.state && window.UI && window.I18N)').catch(() => false)) break;
    await sleep(400);
  }
  await sleep(1200);
  const en = await page.call(`
    window.UI.go('novel');
    await new Promise(function (r) { setTimeout(r, 900); });
    var bar = Array.prototype.map.call(document.querySelectorAll('#appbar .icon-btn'), function (b) { return b.getAttribute('aria-label') || ''; }).join(',');
    var tabs = Array.prototype.map.call(document.querySelectorAll('.tab'), function (t) { return t.textContent.trim(); }).join(',');
    return JSON.stringify({
      lang: window.I18N.lang(),
      tabs: tabs,
      appbar: bar,
      tabsEnglish: tabs === 'Novels,Articles,Diary,Outline,Reading',
      appbarEnglish: /Search/.test(bar) && /Brightness/.test(bar),
      stillHasChineseTab: /小说|文章|日记|大纲|阅读/.test(tabs)
    });
  `);
  console.log('英文：' + en);

  /* 切回中文：watch 会自动重载，重载会让当前 CDP 调用中断 —— 这是预期行为。
     所以这里「设完就不管」，随后重新打开页面再检查。 */
  await page.eval(`(function(){ window.Store.setSetting('language', 'zh-CN'); return 1; })()`)
    .catch(() => 'reloading');
  await sleep(3000);                       /* 等自动重载跑完 */
  await page.hardGoto(BASE + '#/novel');
  for (let i = 0; i < 40; i++) {
    if (await page.eval('!!(window.Store && window.Store.state && window.UI && window.I18N)').catch(() => false)) break;
    await sleep(400);
  }
  await sleep(1200);
  const back = await page.call(`
    return JSON.stringify({
      lang: window.I18N.lang(),
      tabs: Array.prototype.map.call(document.querySelectorAll('.tab'), function (t) { return t.textContent.trim(); }).join(',')
    });
  `);
  console.log('切回中文：' + back);

  const okEn = /"tabsEnglish":true/.test(String(en)) && /"appbarEnglish":true/.test(String(en))
    && /"stillHasChineseTab":false/.test(String(en));
  const okBack = /"lang":"zh-CN"/.test(String(back)) && /"tabs":"小说,文章,日记,大纲,阅读"/.test(String(back));
  console.log('');
  console.log(okEn ? 'PASS 多语种：界面确实切换成英文' : 'FAIL 多语种：界面文字没变');
  console.log(okBack ? 'PASS 多语种：可切回中文' : 'FAIL 多语种：切不回中文');
  browser.proc.kill();
  process.exit(okEn && okBack ? 0 : 1);
}
main().catch((e) => { console.error('失败: ' + (e && e.stack || e)); process.exit(1); });
