/* ==========================================================================
   verify-apk.js — APK 交付前自检（不需要模拟器/真机）
   --------------------------------------------------------------------------
   检查项：
     1) ZIP 结构可读；无含反斜杠的条目（Windows 版 aapt2 的坑）
     2) 必需条目齐全：AndroidManifest.xml / classes.dex / resources.arsc
     3) assets/www 结构完整（index.html、css、js、assets 图标）
     4) 模拟安卓 AssetManager：LocalServer 会请求的每个路径都能在 APK 里找到
     5) index.html 里引用的本地资源在 APK 内都存在（无 404）
     6) LocalServer 的扩展名 -> MIME 映射覆盖实际用到的类型
     7) 二进制清单里含 launcher activity 与必需权限
     8) classes.dex 头部合法（magic + 版本）
   用法： node tools/verify-apk.js <apk 路径>
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && detail ? '  → ' + detail : ''));
};

/* ---------------- 极简 ZIP 读取（只读中央目录） ---------------- */
function readZip(buf) {
  const SIG_CENTRAL = 0x02014b50;
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
  return entries;
}

function extract(buf, entry) {
  const SIG_LOCAL = 0x04034b50;
  const off = entry.localOffset;
  if (buf.readUInt32LE(off) !== SIG_LOCAL) throw new Error('bad local header: ' + entry.name);
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error('unsupported compression ' + entry.method + ' for ' + entry.name);
}

/* ---------------- 主流程 ---------------- */
function firstLine(s) {
  return String(s || '').split('\n')[0].slice(0, 120);
}

/** 找 aapt2：优先仓库内下载的那份，其次 PATH */
function findAapt2() {
  const local = path.join(__dirname, '..', 'tools', 'android', 'aapt2', 'aapt2.exe');
  if (fs.existsSync(local)) return local;
  const alt = 'D:\\swbuild\\tools\\android\\aapt2\\aapt2.exe';
  if (fs.existsSync(alt)) return alt;
  return null;
}

function main() {
  const apkPath = process.argv[2];
  if (!apkPath || !fs.existsSync(apkPath)) {
    console.error('用法: node tools/verify-apk.js <apk>');
    process.exit(2);
  }
  console.log('APK: ' + apkPath + '  (' + fs.statSync(apkPath).size + ' 字节)\n');
  const buf = fs.readFileSync(apkPath);
  const entries = readZip(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const names = entries.map((e) => e.name);

  /* 1. 反斜杠 */
  const backslash = names.filter((n) => n.includes('\\'));
  check('条目名无反斜杠（设备上才读得到）', backslash.length === 0,
    backslash.length + ' 个: ' + backslash.slice(0, 3).join(', '));

  /* 2. 必需条目 */
  ['AndroidManifest.xml', 'classes.dex', 'resources.arsc'].forEach((n) => {
    check('包含 ' + n, byName.has(n), names.filter((x) => x.includes(n.split('.')[0])).slice(0, 3).join(', '));
  });

  /* 3. assets/www 结构 */
  const wwwEntries = names.filter((n) => n.startsWith('assets/www/'));
  check('assets/www 条目数 > 15', wwwEntries.length > 15, String(wwwEntries.length));
  ['assets/www/index.html', 'assets/www/manifest.webmanifest', 'assets/www/js/app.js',
   'assets/www/css/style.css', 'assets/www/assets/icon-192.png',
   'assets/www/js/view-calc.js', 'assets/www/js/view-games.js',
   'assets/www/js/view-music.js', 'assets/www/js/view-notes.js',
   'assets/www/js/view-tools.js'].forEach((n) => {
    check('存在 ' + n.replace('assets/www/', ''), byName.has(n));
  });
  const flat = names.filter((n) => /^assets\/[^/]+$/.test(n));
  check('assets 根下没有被拍平的散落文件', flat.length === 0, flat.slice(0, 4).join(', '));

  /* 4. 模拟 AssetManager：LocalServer 请求的路径都能找到 */
  const requested = ['www/index.html', 'www/js/app.js', 'www/css/style.css', 'www/sw.js',
    'www/manifest.webmanifest', 'www/assets/icon-192.png', 'www/assets/icon-512.png'];
  const missing = requested.filter((p) => !byName.has('assets/' + p));
  check('AssetManager 路径全部可解析（' + requested.length + ' 个样本）', missing.length === 0, missing.join(', '));

  /* 5. index.html 引用的本地文件都存在 */
  let refMissing = [];
  let refCount = 0;
  try {
    const html = extract(buf, byName.get('assets/www/index.html')).toString('utf8');
    const refs = [];
    const re = /(?:src|href)\s*=\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      const v = m[1];
      if (/^(https?:|data:|#|mailto:)/.test(v)) continue;
      refs.push(v.replace(/^\.\//, ''));
    }
    refCount = refs.length;
    refMissing = refs.filter((r) => !byName.has('assets/www/' + r));
    check('index.html 引用的 ' + refCount + ' 个本地资源都存在', refMissing.length === 0, refMissing.join(', '));
  } catch (e) {
    check('可读取并解析 index.html', false, e.message);
  }

  /* 5b. 载荷一致性：APK 里的文件必须与仓库源文件逐字节相同
         （曾经有过一次教训：打包脚本"顺手"替换转义符，把 app 打成了坏的，
          但结构检查全绿。这里用哈希比对把它钉死。） */
  const srcPairs = [
    ['assets/www/js/app.js', 'js/app.js'],
    ['assets/www/js/util.js', 'js/util.js'],
    ['assets/www/js/ui.js', 'js/ui.js'],
    ['assets/www/css/style.css', 'css/style.css'],
    ['assets/www/index.html', 'index.html'],
    ['assets/www/sw.js', 'sw.js'],
    ['assets/www/manifest.webmanifest', 'manifest.webmanifest']
  ];
  const repoRoot = path.join(__dirname, '..');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const mismatched = [];
  const checked = [];
  srcPairs.forEach(([inApk, inRepo]) => {
    const e = byName.get(inApk);
    const repoFile = path.join(repoRoot, inRepo);
    if (!e || !fs.existsSync(repoFile)) return;
    checked.push(inRepo);
    const a = sha(extract(buf, e));
    const b = sha(fs.readFileSync(repoFile));
    if (a !== b) mismatched.push(inRepo);
  });
  check('载荷与源文件逐字节一致（' + checked.length + ' 个样本）', mismatched.length === 0,
    '不一致: ' + mismatched.join(', '));

  /* 5c. 转义符完整性：扫描 APK 内所有 JS，
         出现「/uXXXX」这种把 \ 换成 / 的痕迹就说明打包时被改写坏了 */
  const badEscapes = [];
  names.filter((n) => /^assets\/www\/js\/.*\.js$/.test(n)).forEach((n) => {
    try {
      const t = extract(buf, byName.get(n)).toString('utf8');
      if (/\/u[0-9a-fA-F]{4}/.test(t)) badEscapes.push(n.replace('assets/www/', ''));
    } catch (e) { /* 解压失败会在别处报 */ }
  });
  check('JS 转义符未被破坏（无 /uXXXX 痕迹）', badEscapes.length === 0, badEscapes.join(', '));

  /* 5d. 运行期必备全局：确保入口与各模块都在载荷里 */
  const mustExist = ['assets/www/js/util.js', 'assets/www/js/taxonomy.js', 'assets/www/js/store.js',
    'assets/www/js/achievements.js', 'assets/www/js/stats.js', 'assets/www/js/io.js',
    'assets/www/js/ui.js', 'assets/www/js/app.js'];
  const missingJs = mustExist.filter((n) => !byName.has(n));
  check('全部 ' + mustExist.length + ' 个核心脚本都在载荷里', missingJs.length === 0, missingJs.join(', '));

  /* 5e. index.html 的 script 标签与载荷一一对应 */
  try {
    const html = extract(buf, byName.get('assets/www/index.html')).toString('utf8');
    const srcs = [];
    const re = /<script[^>]+src="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) srcs.push(m[1]);
    const lost = srcs.filter((s) => !byName.has('assets/www/' + s.replace(/^\.\//, '')));
    check('index.html 引用的 ' + srcs.length + ' 个脚本都存在', lost.length === 0, lost.join(', '));
  } catch (e) {
    check('可解析 index.html 的 script 标签', false, e.message);
  }

  /* 6. MIME 映射覆盖 */
  try {
    const server = fs.readFileSync(path.join(__dirname, '..', 'android', 'src', 'com', 'selfwriting', 'app', 'LocalServer.java'), 'utf8');
    const exts = new Set();
    wwwEntries.forEach((n) => {
      const ext = path.extname(n).toLowerCase();
      if (ext) exts.add(ext);
    });
    const uncovered = [];
    exts.forEach((ext) => {
      // 形如  ".js", "text/javascript; charset=utf-8",
      if (!server.includes('"' + ext + '"')) uncovered.push(ext);
    });
    check('LocalServer 覆盖全部 ' + exts.size + ' 种扩展名的 MIME', uncovered.length === 0, uncovered.join(', '));
  } catch (e) {
    check('可读取 LocalServer.java', false, e.message);
  }

  /* 7. 清单与资源：直接问 aapt2（权威解析，避免自己猜二进制格式） */
  const aapt2 = findAapt2();
  if (!aapt2) {
    check('找到 aapt2 以校验清单', false, 'tools/android/aapt2/aapt2.exe 缺失');
  } else {
    let badging = '';
    try {
      badging = require('child_process').execFileSync(aapt2, ['dump', 'badging', apkPath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    } catch (e) {
      badging = String((e.stdout || '') + (e.stderr || ''));
    }
    const has = (s) => badging.includes(s);
    check('清单：包名 com.selfwriting.app', has("package: name='com.selfwriting.app'"), firstLine(badging));
    check('清单：minSdk 24 / targetSdk 34', has("minSdkVersion:'24'") && has("targetSdkVersion:'34'"), firstLine(badging));
    check('清单：申请 INTERNET 权限（访问本机回环服务）', has("uses-permission: name='android.permission.INTERNET'"));
    check('清单：存在可启动的 MainActivity', /launchable-activity: name='com\.selfwriting\.app\.MainActivity'/.test(badging));
    // AGP 会把资源改名（ic_launcher -> res/xx.xml），所以只校验图标存在且指向 drawable
    check('清单：应用名与图标存在',
      has("application-label:'selfwriting'") && /application: label='selfwriting' icon='res\/[^']+'/.test(badging),
      badging.split('\n').filter((l) => l.startsWith('application:')).join(' | '));
  }

  /* 8. dex：解压后检查（dex 在 APK 里是压缩存储的，不能直接搜原始字节） */
  const dexEntries = entries.filter((e) => /^classes\d*\.dex$/.test(e.name));
  check('存在 classes.dex', dexEntries.length >= 1, names.filter((n) => n.endsWith('.dex')).join(', '));
  if (dexEntries.length) {
    let allClasses = '';
    let headOk = true;
    let headInfo = '';
    dexEntries.forEach((e) => {
      const dex = extract(buf, e);
      const magic = dex.subarray(0, 4).toString('ascii');
      const ver = dex.readUInt32LE(4);
      if (magic !== 'dex\n' || ver < 35) headOk = false;
      if (!headInfo) headInfo = magic.replace('\n', '') + ' v' + ver;
      allClasses += dex.toString('latin1');
    });
    check('classes.dex 头部合法（' + headInfo + '）', headOk, headInfo);
    check('dex 含 MainActivity 与 LocalServer 两个类',
      allClasses.includes('MainActivity') && allClasses.includes('LocalServer'),
      'MainActivity=' + allClasses.includes('MainActivity') + ' LocalServer=' + allClasses.includes('LocalServer'));
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n===== APK 自检：' + (results.length - failed.length) + '/' + results.length + ' 通过 =====');
  if (failed.length) failed.forEach((f) => console.log('  ✗ ' + f.name + '  ' + f.detail));
  process.exit(failed.length ? 1 : 0);
}

main();
