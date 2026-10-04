/* ==========================================================================
   serve-apk-assets.js — 把 APK 里的 assets/www 原样抽出来，按壳里
   LocalServer 的规则（回环监听 + 一次性令牌 + 同一套 MIME）提供出来。

   目的：验证「真正打进安装包的那份网页资源」是完整可用的，
        而不是验证工作目录里那一份（两者可能不一致）。
   用法： node tools/serve-apk-assets.js <apk> [port]
         端口默认 8123，访问时需带令牌：http://127.0.0.1:8123/index.html?k=<token>
   ========================================================================== */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/* LocalServer.java 里的同一张表 */
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
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function readApk(apkPath) {
  const buf = fs.readFileSync(apkPath);
  const entries = [];
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== SIG_CENTRAL) continue;
    const method = buf.readUInt16LE(i + 10);
    const compSize = buf.readUInt32LE(i + 20);
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const commentLen = buf.readUInt16LE(i + 32);
    const localOffset = buf.readUInt32LE(i + 42);
    const name = buf.toString('utf8', i + 46, i + 46 + nameLen);
    entries.push({ name, method, compSize, localOffset });
    i += 46 + nameLen + extraLen + commentLen - 1;
  }

  const files = new Map();
  entries.forEach((e) => {
    if (!e.name.startsWith('assets/www/')) return;
    const off = e.localOffset;
    if (buf.readUInt32LE(off) !== SIG_LOCAL) return;
    const nl = buf.readUInt16LE(off + 26);
    const el = buf.readUInt16LE(off + 28);
    const start = off + 30 + nl + el;
    const raw = buf.subarray(start, start + e.compSize);
    let data;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = zlib.inflateRawSync(raw);
    else return;
    files.set(e.name.replace(/^assets\/www\//, ''), data);
  });
  return files;
}

function main() {
  const apkPath = process.argv[2];
  const port = Number(process.argv[3] || 8123);
  if (!apkPath || !fs.existsSync(apkPath)) {
    console.error('用法: node tools/serve-apk-assets.js <apk> [port]');
    process.exit(2);
  }

  const files = readApk(apkPath);
  const token = crypto.randomBytes(16).toString('hex');   // 与壳里一样的一次性令牌
  console.log('APK      : ' + apkPath);
  console.log('抽出资源 : ' + files.size + ' 个文件（assets/www）');
  console.log('令牌     : ' + token);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';

    // 与壳里的 LocalServer 一致：只有「进入应用」这一步需要一次性令牌
    // （WebView 首次加载带 ?k=，之后的子资源请求不带查询串）。
    // 因此只对文档请求校验，静态资源放行；安全由「只监听 127.0.0.1」保证。
    const isDocument = p === '/index.html' || p === '/';
    if (isDocument && url.searchParams.get('k') !== token) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }

    let key = p.replace(/^\/+/, '');
    let data = files.get(key);
    if (!data && key.indexOf('.') < 0) { key = 'index.html'; data = files.get(key); }  // SPA 回落
    if (!data) {
      console.log('  404 ' + p);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = path.extname(key).toLowerCase();
    console.log('  200 ' + p + '  ' + (MIME[ext] || 'application/octet-stream') + '  ' + data.length + 'B');
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });

  server.listen(port, '127.0.0.1', () => {
    console.log('地址     : http://127.0.0.1:' + port + '/index.html?k=' + token);
  });
}

main();
