/* ==========================================================================
   launcher.js — 桌面快捷方式的入口
     node launcher.js            启动服务并打开应用（已在运行则直接打开）
     node launcher.js phone      启动服务并显示手机访问地址（二维码风格提示）
     node launcher.js stop       停止后台服务
     node launcher.js status     查看运行状态
   服务在后台独立运行，关掉这个窗口也不影响使用。
   ========================================================================== */
'use strict';

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const ROOT = __dirname;
const INFO = path.join(ROOT, '.server-info.json');
const PORT = Number(process.env.PORT || 8099);
const CMD = (process.argv[2] || 'open').toLowerCase();

/* ---------------- 工具 ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readInfo() {
  try {
    const j = JSON.parse(fs.readFileSync(INFO, 'utf8'));
    if (!j || !j.port) return null;
    return j;
  } catch (e) { return null; }
}

function ping(port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: port, path: '/index.html', timeout: timeoutMs || 1200 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function openBrowser(url) {
  try {
    // start 的第一个引号参数会被当作窗口标题，所以给个占位标题
    exec('start "" "' + url + '"', { shell: 'cmd.exe', windowsHide: true });
  } catch (e) {
    console.log('请手动在浏览器打开： ' + url);
  }
}

function lanIps() {
  const nets = os.networkInterfaces();
  const out = [];
  Object.keys(nets).forEach((k) => {
    (nets[k] || []).forEach((n) => {
      if (n.family === 'IPv4' && !n.internal && !/^169\.254\./.test(n.address)) out.push({ name: k, ip: n.address });
    });
  });
  return out;
}

/* ---------------- 启动 / 打开 ---------------- */
async function ensureServer() {
  // 1) 已有可用服务
  if (await ping(PORT, 900)) {
    const info = readInfo();
    console.log('[=] 服务已在运行： http://127.0.0.1:' + PORT + '/');
    return info && info.port === PORT ? Object.assign({}, info, { alreadyRunning: true }) : { port: PORT, token: null, alreadyRunning: true };
  }
  // 2) 拉起新进程（后台常驻，父进程退出后仍继续运行）
  console.log('[>] 正在启动本地服务 ...');
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();

  // 3) 等服务就绪并读取令牌
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await ping(PORT, 800)) {
      await sleep(150);
      const info = readInfo();
      console.log('[ok] 服务已启动（后台运行，关闭本窗口不影响）');
      return info && info.port === PORT ? info : { port: PORT, token: null };
    }
  }
  throw new Error('服务启动超时，请检查 8099 端口是否被占用');
}

async function main() {
  if (CMD === 'stop') {
    const info = readInfo();
    let stopped = false;
    if (info && info.pid) {
      try { process.kill(info.pid); stopped = true; } catch (e) { /* 进程可能已退出 */ }
    }
    // 兜底：按端口找进程
    if (!stopped) {
      const out = await new Promise((res) => {
        exec('netstat -ano -p tcp | findstr LISTENING | findstr :' + PORT, (e, stdout) => res(stdout || ''));
      });
      const pids = Array.from(new Set(String(out).split(/\r?\n/).map((l) => (l.trim().split(/\s+/).pop() || '')).filter((p) => /^\d+$/.test(p))));
      pids.forEach((p) => { try { process.kill(Number(p)); stopped = true; } catch (e) { /* 忽略 */ } });
    }
    try { fs.unlinkSync(INFO); } catch (e) { /* 忽略 */ }
    console.log(stopped ? '[ok] 已停止 selfwriting 服务' : '[=] 没有找到正在运行的服务');
    await sleep(900);
    return;
  }

  if (CMD === 'status') {
    const alive = await ping(PORT, 1200);
    const info = readInfo();
    console.log(alive ? '[ok] 运行中  http://127.0.0.1:' + PORT + '/' : '[x] 未运行');
    if (info && info.startedAt) console.log('    启动于 ' + new Date(info.startedAt).toLocaleString('zh-CN'));
    if (info && info.addresses) console.log('    局域网地址 ' + info.addresses.join(', '));
    await sleep(1200);
    return;
  }

  const info = await ensureServer();
  const local = 'http://127.0.0.1:' + PORT + '/index.html';

  if (CMD === 'phone') {
    const ips = lanIps();
    console.log('');
    console.log('  ================  手机访问地址  ================');
    console.log('  （手机需与电脑在同一 Wi-Fi）');
    console.log('');
    if (!ips.length) {
      console.log('    [!] 没有检测到局域网地址，请先让电脑连上 Wi-Fi');
    }
    ips.forEach((n) => {
      console.log('    http://' + n.ip + ':' + PORT + '/index.html        [' + n.name + ']');
    });
    console.log('');
    console.log('  手机 Chrome 打开上面任意一个地址即可：');
    console.log('    · 功能与电脑完全一致，数据保存在手机本机');
    console.log('    · 打开后 Chrome 菜单 →「安装应用 / 添加到主屏幕」');
    console.log('      桌面会生成图标，之后断网也能继续写（离线缓存）');
    console.log('    · 想装成独立应用（APK）：应用内「统计 → 设置 → 安装到手机」');
    console.log('');
    console.log('  电脑上继续使用： ' + local);
    console.log('  ==============================================');
    await sleep(20000);
    return;
  }

  // 已在运行（SW_ONCE=1 时）不再开新标签，避免重复双击堆一堆窗口
  if (process.env.SW_NO_BROWSER === '1') {
    console.log('[=] 已跳过打开浏览器（SW_NO_BROWSER=1）： ' + local);
    await sleep(600);
    return;
  }
  if (info && info.alreadyRunning && process.env.SW_ONCE === '1') {
    console.log('[=] 应用已在运行，未重复打开浏览器： ' + local);
    await sleep(800);
    return;
  }

  openBrowser(local);
  console.log('[ok] 已在浏览器打开： ' + local);
  await sleep(1500);
}

main().catch((e) => {
  console.error('[x] ' + (e && e.message ? e.message : e));
  console.error('    可手动运行： node server.js ' + PORT);
  // 让窗口停留一会儿，便于看到错误
  setTimeout(() => process.exit(1), 4000);
});
