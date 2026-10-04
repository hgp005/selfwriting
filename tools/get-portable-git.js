/* 开发用：下载便携版 Git（MinGit），解压到 tools/git-portable
   本机没有装 Git，而发布到 GitHub 需要 git 命令来推送源码。
   用法： node tools/get-portable-git.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'tools', 'git-portable');
const GIT_EXE = path.join(DEST, 'cmd', 'git.exe');

if (fs.existsSync(GIT_EXE)) { console.log('已存在: ' + GIT_EXE); process.exit(0); }

function get(url, asJson) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'selfwriting-publish', Accept: asJson ? 'application/vnd.github+json' : '*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location, asJson));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      if (asJson) {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

(async () => {
  console.log('查询 git-for-windows 最新版本…');
  const rel = await get('https://api.github.com/repos/git-for-windows/git/releases/latest', true);
  const asset = (rel.assets || []).filter((a) => /^MinGit-.*-64-bit\.zip$/.test(a.name))[0];
  if (!asset) throw new Error('没找到 MinGit 64 位压缩包');
  console.log('下载 ' + asset.name + ' (' + Math.round(asset.size / 1024 / 1024) + ' MB) …');
  const zip = path.join(ROOT, 'tools', 'git-portable.zip');
  const res = await get(asset.browser_download_url, false);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zip);
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
  console.log('解压…');
  fs.mkdirSync(DEST, { recursive: true });
  execFileSync('powershell', ['-NoProfile', '-Command',
    'Expand-Archive -LiteralPath "' + zip + '" -DestinationPath "' + DEST + '" -Force'], { stdio: 'inherit' });
  fs.unlinkSync(zip);
  const v = execFileSync(GIT_EXE, ['--version'], { encoding: 'utf8' }).trim();
  console.log('便携版 Git 就绪: ' + GIT_EXE + '  →  ' + v);
})().catch((e) => { console.log('[x] ' + e.message); process.exit(1); });
