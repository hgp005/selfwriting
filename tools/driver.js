/* ==========================================================================
   selfwriting · driver.js（开发验证用，不属于应用本体）
   用 CDP 直接驱动本机已安装的 Edge：逐屏检查渲染结果、抓控制台错误、截图。
   零依赖：Node 22+ 内置 WebSocket / fetch。

   用法：
     node tools/verify.js                # 默认 http://127.0.0.1:8099
     node tools/verify.js 8099 dark      # 指定端口 / 深色主题
   ========================================================================== */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
];

function findEdge() {
  for (const p of EDGE_CANDIDATES) {
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* next */ }
  }
  throw new Error('未找到 Microsoft Edge');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 极简 CDP 客户端 ---------------- */
class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.addEventListener('open', () => resolve(this));
      ws.addEventListener('error', (e) => reject(new Error('WS 连接失败: ' + (e.message || 'unknown'))));
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message + ' ' + JSON.stringify(msg.error.data || '')));
          else res(msg.result);
        } else if (msg.method) {
          this.handlers.forEach((h) => h(msg));
        }
      });
    });
  }
  on(fn) { this.handlers.push(fn); }
  send(method, params, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.ws.send(JSON.stringify(payload)); }
      catch (e) { this.pending.delete(id); reject(e); }
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 45000);
    });
  }
  close() { try { this.ws.close(); } catch (e) { /* noop */ } }
}

/* ---------------- 浏览器 ---------------- */
async function launch(opts) {
  const o = opts || {};
  const port = 9000 + Math.floor(Math.random() * 900);
  const udd = path.join(os.tmpdir(), 'sw-cdp-' + Date.now());
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-crashpad',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--user-data-dir=' + udd,
    '--remote-debugging-port=' + port,
    '--window-size=400,880',
    'about:blank'
  ];
  const proc = spawn(findEdge(), args, { stdio: 'ignore', detached: false });
  let version = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (res.ok) { version = await res.json(); break; }
    } catch (e) { /* 还没起来 */ }
  }
  if (!version) { try { proc.kill(); } catch (e) { /* noop */ } throw new Error('Edge 调试端口未就绪'); }
  return { proc, port, udd, version, args };
}

async function newPage(port, url) {
  const res = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  if (!res.ok) throw new Error('新建标签页失败: ' + res.status);
  const target = await res.json();
  return target;
}

/* ---------------- 页面封装 ---------------- */
class Page {
  constructor(cdp, sessionId) { this.cdp = cdp; this.sid = sessionId; this.logs = []; }

  static async open(browser, url) {
    const target = await newPage(browser.port, 'about:blank');
    const cdp = await new CDP(target.webSocketDebuggerUrl).connect();
    const page = new Page(cdp, null);
    cdp.on((msg) => {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
        page.logs.push({ type: msg.params.type, text });
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        const ex = d.exception || {};
        const where = (d.url || '') + ':' + ((d.lineNumber || 0) + 1) + ':' + ((d.columnNumber || 0) + 1);
        const stack = (ex.description || '').split('\n').slice(0, 5).join(' ⏎ ');
        page.logs.push({ type: 'exception', text: (ex.value || d.text || 'exception') + ' @' + where + ' :: ' + stack });
      } else if (msg.method === 'Log.entryAdded') {
        const e = msg.params.entry || {};
        page.logs.push({ type: 'log:' + e.level, text: e.text + (e.url ? ' @' + e.url : '') });
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 400, height: 880, deviceScaleFactor: 1, mobile: true
    });
    await page.goto(url);
    return page;
  }

  async goto(url) {
    await this.cdp.send('Page.navigate', { url });
    await sleep(600);
  }

  async eval(expression) {
    const r = await this.cdp.send('Runtime.evaluate', {
      expression: '(function(){try{return (' + expression + ')}catch(e){return "__ERR__:"+e.message}})()',
      returnByValue: true, awaitPromise: true
    });
    const v = r && r.result ? r.result.value : undefined;
    if (typeof v === 'string' && v.startsWith('__ERR__:')) throw new Error(v);
    return v;
  }

  /** 返回详细错误信息（含堆栈），便于定位 */
  async evalRaw(expression) {
    const r = await this.cdp.send('Runtime.evaluate', {
      expression: expression, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails.exception || {};
      return { ok: false, error: (ex.value || r.exceptionDetails.text || '') + ' :: ' + String(ex.description || '').split('\n').slice(0, 4).join(' | ') };
    }
    return { ok: true, value: r.result ? r.result.value : undefined };
  }

  async call(fnBody) {
    const r = await this.cdp.send('Runtime.evaluate', {
      expression: '(async function(){' + fnBody + '})()',
      returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  async text() { return this.eval('document.body.innerText'); }

  /** 彻底停用 Service Worker 与 HTTP 缓存（验证用） */
  async freshCache() {
    const cleared = await this.call(`
      try {
        if (navigator.serviceWorker) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(function (r) { return r.unregister(); }));
        }
        if (window.caches && caches.keys) {
          const keys = await caches.keys();
          await Promise.all(keys.map(function (k) { return caches.delete(k); }));
        }
      } catch (e) { return 'error:' + e.message; }
      return 'cleared';
    `);
    try {
      await this.cdp.send('Network.enable');
      await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    } catch (e) { /* noop */ }
    return cleared;
  }

  /** 断网式硬加载：忽略缓存重新请求整页 */
  async hardGoto(url) {
    await this.cdp.send('Page.navigate', { url: url, transitionType: 'reload', ignoreCache: true }).catch(() => undefined);
    await sleep(900);
  }

  async shot(file) {
    const r = await this.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }

  errors() {
    return this.logs.filter((l) => l.type === 'error' || l.type === 'exception' || l.type === 'log:error' || l.type === 'assert');
  }
  close() { this.cdp.close(); }
}

module.exports = { launch, Page, sleep, findEdge };
