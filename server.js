/* ==========================================================================
   selfwriting · 本地预览服务器
   仅用于在电脑/手机上打开这个离线应用（例如 http://电脑IP:8099）。
   没有任何后端逻辑，只把文件发出去；正式使用时不需要它。
   用法： node server.js [端口]
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8099);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive'
};

const FETCH_LIMIT = 96 * 1024 * 1024;      // 单本最大 96 MB

/* ==================================================================== */
/* 协作房间（局域网）                                                    */
/* ==================================================================== */
/**
 * 设计取舍：用 HTTP 轮询而不是 WebSocket。
 *   安卓壳里的本机服务（LocalServer）是手写 HTTP，加 WebSocket 要重写协议栈；
 *   轮询 2 秒一次对「写小说」这种交互密度完全够，而且断线重连天然简单。
 * 房间只存在于内存里：这是「临时凑一桌」，不是云服务 —— 关掉服务即清除。
 */
const rooms = new Map();
const ROOM_TTL = 12 * 3600 * 1000;         // 12 小时没人动就清掉

function roomGet(code) {
  const r = rooms.get(String(code || '').toUpperCase());
  if (!r) return null;
  if (Date.now() - r.touched > ROOM_TTL) { rooms.delete(r.code); return null; }
  return r;
}

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > (limit || 8 * 1024 * 1024)) { req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function handleCollab(path, query, req, res) {
  /* 建房间：谁开房谁是主机 */
  if (path === '/collab/create') {
    return readBody(req).then((b) => {
      const code = String((b && b.code) || '').toUpperCase() || 'ROOM' + Math.floor(Math.random() * 9000 + 1000);
      const room = {
        code: code, room: (b && b.room) || '',
        touched: Date.now(), seq: 0,
        members: new Map(), edits: [], chats: []
      };
      room.members.set(String((b && b.me) || '主机'), Date.now());
      rooms.set(code, room);
      sendJson(res, 200, { ok: true, code: code });
    });
  }

  const p = new URLSearchParams(query || '');
  const code = (p.get('code') || '').toUpperCase();

  if (path === '/collab/join') {
    return readBody(req).then((b) => {
      const room = roomGet((b && b.code) || code);
      if (!room) return sendJson(res, 404, { ok: false, error: '房间不存在或已过期' });
      room.members.set(String((b && b.me) || '访客'), Date.now());
      room.touched = Date.now();
      sendJson(res, 200, { ok: true, code: room.code, seq: room.seq,
        members: Array.from(room.members.keys()) });
    });
  }

  if (path === '/collab/push') {
    return readBody(req, 16 * 1024 * 1024).then((b) => {
      const room = roomGet(b && b.code);
      if (!room) return sendJson(res, 404, { ok: false, error: '房间不存在' });
      room.members.set(String((b && b.me) || '匿名'), Date.now());
      room.touched = Date.now();
      room.seq++;
      room.edits.push({ seq: room.seq, me: (b && b.me) || '匿名', work: b.work, chapters: b.chapters || [] });
      /* 只留最近 200 条改动，避免内存无限增长 */
      if (room.edits.length > 200) room.edits.splice(0, room.edits.length - 200);
      sendJson(res, 200, { ok: true, seq: room.seq });
    });
  }

  if (path === '/collab/chat') {
    return readBody(req).then((b) => {
      const room = roomGet(b && b.code);
      if (!room) return sendJson(res, 404, { ok: false, error: '房间不存在' });
      room.members.set(String((b && b.me) || '匿名'), Date.now());
      room.touched = Date.now();
      room.seq++;
      room.chats.push({ seq: room.seq, from: (b && b.me) || '匿名', work: b.work || null,
        text: String((b && b.text) || '').slice(0, 2000), at: Date.now() });
      if (room.chats.length > 500) room.chats.splice(0, room.chats.length - 500);
      sendJson(res, 200, { ok: true, seq: room.seq });
    });
  }

  if (path === '/collab/poll') {
    const room = roomGet(code);
    if (!room) return sendJson(res, 404, { ok: false, error: '房间不存在' });
    const since = Number(p.get('since') || 0);
    const me = p.get('me') || '';
    room.members.set(me, Date.now());
    room.touched = Date.now();
    const edits = room.edits.filter((e) => e.seq > since && e.me !== me);
    const chats = room.chats.filter((m) => m.seq > since && m.from !== me);
    return sendJson(res, 200, {
      ok: true, seq: room.seq,
      members: Array.from(room.members.keys()),
      edits: edits, chats: chats
    });
  }

  sendJson(res, 404, { ok: false, error: 'unknown collab endpoint' });
}

/**
 * 代取外部文件（供应用内「下载书籍」用）。
 * 只接受 http/https，限制体积，并把结果原样回给页面。
 */
function proxyFetch(search, res) {
  let target = '';
  try { target = new URL('http://x' + search).searchParams.get('url') || ''; } catch (e) { /* 交给下面报错 */ }
  if (!/^https?:\/\//i.test(target)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end('只支持 http/https 地址');
    return;
  }
  const mod = target.startsWith('https:') ? require('https') : http;
  let done = false;
  const fail = (code, msg) => {
    if (done) return;
    done = true;
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(msg);
  };
  let req2;
  try {
    req2 = mod.get(target, {
      headers: { 'User-Agent': 'selfwriting/1.6', Accept: '*/*' },
      timeout: 30000
    }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        /* 跟随一次重定向即可，避免循环 */
        r.resume();
        return proxyFetch('?url=' + encodeURIComponent(new URL(r.headers.location, target).href), res);
      }
      if (r.statusCode < 200 || r.statusCode >= 300) {
        r.resume();
        return fail(502, '对方服务器返回 ' + r.statusCode);
      }
      const chunks = [];
      let size = 0;
      r.on('data', (c) => {
        size += c.length;
        if (size > FETCH_LIMIT) { try { req2.destroy(); } catch (e) { /* 忽略 */ } return fail(502, '文件超过 96 MB，已停止'); }
        chunks.push(c);
      });
      r.on('end', () => {
        if (done) return;
        done = true;
        const body = Buffer.concat(chunks);
        res.writeHead(200, {
          'Content-Type': r.headers['content-type'] || 'application/octet-stream',
          'Content-Length': body.length,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        });
        res.end(body);
      });
      r.on('error', (e) => fail(502, '读取失败：' + e.message));
    });
    req2.on('timeout', () => { try { req2.destroy(); } catch (e) { /* 忽略 */ } fail(504, '对方响应超时'); });
    req2.on('error', (e) => fail(502, '下载失败：' + e.message));
  } catch (e) {
    fail(502, '下载失败：' + (e && e.message || e));
  }
}

const server = http.createServer((req, res) => {
  let urlPath;
  let query = '';
  try {
    const u = new URL(req.url, 'http://localhost');
    urlPath = decodeURIComponent(u.pathname);
    query = u.search;
  } catch (e) {
    res.writeHead(400); res.end('bad request'); return;
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  /* 下载代理：/__fetch?url=<外部地址>
     网页直接 fetch 外部站点会被跨域策略拦住，所以由本地服务代取。
     只在用户主动点「下载」时才会用到，地址由用户自己填。 */
  if (urlPath === '/__fetch') {
    return proxyFetch(query, res);
  }

  /* 协作房间：局域网内多人共同创作的临时枢纽（内存中，重启即清） */
  if (urlPath.indexOf('/collab/') === 0) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
      });
      res.end();
      return;
    }
    return handleCollab(urlPath, query.replace(/^\?/, ''), req, res);
  }

  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // 单页应用：未命中的路径回落到 index.html
      if (!path.extname(filePath)) {
        fs.readFile(path.join(ROOT, 'index.html'), (e2, buf) => {
          if (e2) { res.writeHead(404); res.end('not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
          res.end(buf);
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ips = [];
  Object.keys(nets).forEach((k) => {
    (nets[k] || []).forEach((n) => { if (n.family === 'IPv4' && !n.internal) ips.push({ ip: n.address, name: k }); });
  });
  // 一次性令牌 + 进程信息，供桌面快捷方式/launcher.js 使用（安全由只监听本机/局域网保证）
  const token = crypto.randomBytes(8).toString('hex');
  try {
    fs.writeFileSync(path.join(ROOT, '.server-info.json'),
      JSON.stringify({ port: PORT, token: token, pid: process.pid, startedAt: Date.now(), addresses: ips.map((n) => n.ip) }));
  } catch (e) { /* 忽略 */ }

  console.log('selfwriting 已启动：');
  console.log('  本机： http://127.0.0.1:' + PORT + '/?k=' + token);
  ips.forEach((n) => console.log('  手机（' + n.name + '）： http://' + n.ip + ':' + PORT + '/?k=' + token));
  console.log('  在安卓 Chrome 里打开后，菜单 →「安装应用 / 添加到主屏幕」即可离线使用。');
  console.log('  停止服务： node launcher.js stop');
});

function cleanup() {
  try { fs.unlinkSync(path.join(ROOT, '.server-info.json')); } catch (e) { /* 忽略 */ }
}
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });
