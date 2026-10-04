/* ==========================================================================
   selfwriting · adb-install.js（开发用）
   等手机插上（USB 调试打开）后，自动把最新 APK 装进去。
   用法： node tools/adb-install.js [超时分钟]
   状态会一直打印：没有设备 / 未授权 / 正在安装 / 结果
   ========================================================================== */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADB = 'C:\\Users\\hgp17\\OneDrive\\Desktop\\platform-tools\\adb.exe';
const WAIT_MIN = Number(process.argv[2] || 20);

function adb(args) {
  const r = spawnSync(ADB, args, { encoding: 'utf8', windowsHide: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function newestApk() {
  const dist = path.join(ROOT, 'dist');
  const list = fs.readdirSync(dist).filter((f) => /^selfwriting-[\d.]+\.apk$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dist, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return list.length ? path.join(dist, list[0].f) : null;
}

const apk = newestApk();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
if (!apk) { console.log('[x] dist 里没有 APK'); process.exit(2); }
console.log('APK : ' + apk + '  (' + fs.statSync(apk).size + ' 字节)');
if (!fs.existsSync(ADB)) { console.log('[x] 找不到 adb: ' + ADB); process.exit(2); }
adb(['start-server']);
console.log('等待手机接入（USB 调试打开，并在手机上点「允许」）…');

const deadline = Date.now() + WAIT_MIN * 60000;
let last = '';
let lastState = '';
while (Date.now() < deadline) {
  const r = adb(['devices']);
  const lines = r.out.split('\n').map((s) => s.trim()).filter((s) => s && !/^List of devices/.test(s));
  const state = lines.map((s) => s.split(/\s+/)[1] + ' ' + s.split(/\s+/)[0]).join(' | ') || 'none';
  if (state !== lastState) { console.log('[' + new Date().toLocaleTimeString() + '] 设备状态: ' + state); lastState = state; }

  const ready = lines.filter((s) => /\sdevice$/.test(s));
  const unauth = lines.filter((s) => /\sunauthorized$/.test(s));
  const offline = lines.filter((s) => /\soffline$/.test(s));

  if (unauth.length) {
    if (last !== 'unauth') {
      console.log('  → 手机已连上，但还没授权：请在手机上点「允许 USB 调试」（可勾选「一律允许」）');
      last = 'unauth';
    }
  } else if (offline.length) {
    if (last !== 'offline') { console.log('  → 设备 offline：拔插一次数据线，或在手机上重新确认授权'); last = 'offline'; }
  } else if (ready.length) {
    const serial = ready[0].split(/\s+/)[0];
    console.log('  → 设备已就绪: ' + serial + '，开始安装…');
    const ins = adb(['-s', serial, 'install', '-r', apk]);
    console.log(ins.out.trim());
    if (/Success/i.test(ins.out)) {
      console.log('===== 安装成功 =====');
      const info = adb(['-s', serial, 'shell', 'dumpsys', 'package', 'com.selfwriting.app', '|', 'grep', 'versionName']);
      if (info.out.trim()) console.log('  已装版本: ' + info.out.trim().split('\n')[0]);
      process.exit(0);
    }
    if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(ins.out)) {
      console.log('===== 签名冲突：手机上装的旧版不是同一个签名 =====');
      console.log('  处理：先在手机上卸载旧版（会清数据，请先在应用里「设置 → 导出整库备份」），再跑一次本脚本');
      process.exit(3);
    }
    console.log('===== 安装失败（上面是 adb 的原始输出）=====');
    process.exit(4);
  }
  await sleep(3000);
}
console.log('===== 超时：' + WAIT_MIN + ' 分钟内没有检测到已授权的设备 =====');
process.exit(5);
}

main().catch((e) => { console.log('[x] 脚本出错: ' + ((e && e.message) || e)); process.exit(9); });
