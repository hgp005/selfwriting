'use strict';
const { launch, Page, sleep } = require('./driver');
const BASE = process.argv[2];

(async () => {
  const b = await launch();
  const page = await Page.open(b, BASE);
  await sleep(3000);
  const info = await page.eval(`(function(){
    return JSON.stringify({
      title: document.title,
      scripts: Array.prototype.map.call(document.querySelectorAll('script'), function(s){ return s.getAttribute('src'); }),
      hasU: typeof window.U, hasStore: typeof window.Store, hasUI: typeof window.UI,
      bodyLen: document.body.innerText.length,
      bodyHead: document.body.innerText.slice(0, 200),
      htmlHead: document.documentElement.outerHTML.slice(0, 300)
    }, null, 1);
  })()`);
  console.log(info);
  console.log('--- 控制台 ---');
  console.log(page.logs.slice(0, 25).map((l) => l.type + ': ' + l.text.slice(0, 220)).join('\n') || '（无）');
  page.close();
  b.proc.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
