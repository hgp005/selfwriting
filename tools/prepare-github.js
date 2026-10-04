/* 开发用：准备 GitHub 发布 —— 仓库体检（个人信息 / 密钥 / 大文件）+ 生成 LICENSE + 待上传清单
   用法： node tools/prepare-github.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* 不进仓库的目录/文件：运行期产物、构建工具、密钥、安装包 */
function skipRel(rel) {
  const r = rel.replace(/\\/g, '/');
  if (!r) return false;
  if (/^(node_modules|\.git|build|shots|dist|github-upload)(\/|$)/.test(r)) return true;
  if (/^(tools\/android|android\/keystore|android-gradle\/\.gradle)(\/|$)/.test(r)) return true;
  if (/^android-gradle\/app\/(build|src\/main\/(assets|java|res))(\/|$)/.test(r)) return true;
  if (/\.(apk|jks|keystore|pfx|p12)$/i.test(r)) return true;
  if (r === '.server-info.json') return true;
  return false;
}

/* ---------- 1) 体检 ---------- */
const sus = [];
let files = 0;
let bytes = 0;
function walk(dir, rel) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (skipRel(r)) return;
    if (e.isDirectory()) { walk(p, r); return; }
    const size = fs.statSync(p).size;
    files++; bytes += size;
    if (size > 3 * 1024 * 1024) { sus.push('大文件: ' + r + ' (' + Math.round(size / 1024) + ' KB)'); return; }
    if (!/\.(js|json|html|css|md|bat|cmd|ps1|java|xml|webmanifest|txt|yml|yaml)$/i.test(e.name)) return;
    let t = '';
    try { t = fs.readFileSync(p, 'utf8'); } catch (err) { return; }
    if (t.indexOf('\uFFFD') >= 0) sus.push('疑似乱码: ' + r);
    const checks = [
      [/23116PN5BC|10\.150\.\d+\.\d+/, '设备 / 内网信息'],
      [/(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,})/, '疑似密钥'],
      [/"token"\s*:\s*"[0-9a-f]{12,}"/, '内嵌 token'],
      [/SW-[A-Z0-9]{6}(?![X])/, '真实的个人专属码（示例码 SW-XXXXXX 是允许的）']
    ];
    checks.forEach(([re, why]) => {
      const m = t.match(re);
      if (m) sus.push(why + ': ' + r + ' → ' + String(m[0]).slice(0, 40));
    });
  });
}
walk(ROOT, '');
console.log('=== 仓库体检 ===');
console.log('  文件 ' + files + ' 个 / ' + Math.round(bytes / 1024) + ' KB');
if (!sus.length) console.log('  ✔ 没发现个人信息 / 密钥 / 大文件 / 乱码');
else sus.forEach((s) => console.log('  ⚠ ' + s));

/* ---------- 2) LICENSE ---------- */
const lic = path.join(ROOT, 'LICENSE');
if (!fs.existsSync(lic)) {
  fs.writeFileSync(lic, [
    'MIT License', '',
    'Copyright (c) 2026 selfwriting contributors', '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:', '',
    'The above copyright notice and this permission notice shall be included in all',
    'copies or substantial portions of the Software.', '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
    'SOFTWARE.', '',
    '--- 第三方资源 ---',
    'assets/samples/ 下的乐器采样来自 MIDI.js Soundfonts 的 FluidR3_GM 渲染（作者 Frank Wen），',
    '内容按 CC BY 3.0 授权，署名见 assets/samples/LICENSE.md；本仓库代码部分为上面的 MIT。', ''
  ].join('\n'), 'utf8');
  console.log('  ✔ 已生成 LICENSE（MIT + 第三方资源署名）');
} else console.log('  · LICENSE 已存在');

/* ---------- 3) 待上传清单 ---------- */
const out = path.join(ROOT, 'github-upload');
fs.mkdirSync(out, { recursive: true });
const list = [];
(function collect(dir, rel) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (skipRel(r) || r === 'github-upload') return;
    if (e.isDirectory()) { collect(p, r); return; }
    list.push({ rel: r, size: fs.statSync(p).size });
  });
})(ROOT, '');
const total = list.reduce((s, x) => s + x.size, 0);
fs.writeFileSync(path.join(out, 'MANIFEST.txt'),
  'selfwriting · 需要上传到 GitHub 的文件清单\n共 ' + list.length + ' 个文件 / ' + Math.round(total / 1024) + ' KB\n\n'
  + list.filter((x) => !/^(tools\/i18n-batches\/|assets\/samples\/)/.test(x.rel))
    .map((x) => x.rel + '\t' + x.size).join('\n') + '\n', 'utf8');
console.log('=== 待上传 ===');
console.log('  ' + list.length + ' 个文件 / ' + Math.round(total / 1024) + ' KB（含采样 ' +
  list.filter((x) => /^assets\/samples\//.test(x.rel)).length + ' 个）');
console.log('  清单: github-upload/MANIFEST.txt');
