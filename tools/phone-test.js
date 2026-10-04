/* ==========================================================================
   selfwriting · phone-test.js（开发用）
   连着手机时，一条命令完成：安装最新 APK → 启动 → 按脚本点几下 → 截图拉回来。
   用法：
     node tools/phone-test.js                # 只装最新包并截主界面
     node tools/phone-test.js music          # 音乐：下到「更多」→ 音乐创作 → 试音台
     node tools/phone-test.js diary          # 日记：点底部「日记」标签
     node tools/phone-test.js reader         # 阅读：点底部「阅读」标签
   截图落在 shots/phone-<场景>.png（可直接用图片工具查看）。
   ========================================================================== */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB = 'C:\\Users\\hgp17\\OneDrive\\Desktop\\platform-tools\\adb.exe';
const ROOT = path.join(__dirname, '..');
const SCENE = (process.argv[2] || 'home').toLowerCase();

/* 底部五个标签的横坐标（1080 宽屏幕）+ 顶部栏按钮 */
const TAP = {
  tabNovel: [108, 2205], tabArticle: [324, 2205], tabDiary: [540, 2205],
  tabOutline: [756, 2205], tabReader: [972, 2205],
  navMe: [508, 300], navSearch: [620, 300], navStats: [732, 300],
  navFun: [844, 300], navBright: [956, 300]
};

const SCENES = {
  home: [],
  diary: [['tabDiary', 3000]],
  reader: [['tabReader', 3000]],
  music: [['navFun', 1200], [null, 900], ['tabDiary', 0]]
};

function adb(args, opts) {
  const r = spawnSync(ADB, args, Object.assign({ encoding: 'utf8', windowsHide: true }, opts || {}));
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function newestApk() {
  const dist = path.join(ROOT, 'dist');
  const list = fs.readdirSync(dist).filter((f) => /^selfwriting-[\d.]+\.apk$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dist, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return list.length ? path.join(dist, list[0].f) : null;
}

function shot(name) {
  const remote = '/sdcard/sw-' + name + '.png';
  adb(['shell', 'screencap', '-p', remote]);
  const local = path.join(ROOT, 'shots', 'phone-' + name + '.png');
  adb(['pull', remote, local]);
  adb(['shell', 'rm', remote]);
  return fs.existsSync(local) ? local + ' (' + fs.statSync(local).size + ' 字节)' : '(截图失败)';
}

async function main() {
  const dev = adb(['devices']).out.split('\n').filter((l) => /\sdevice$/.test(l.trim()));
  if (!dev.length) {
    console.log('[x] 没有检测到已授权的手机：请插上数据线、在手机上点「允许 USB 调试」');
    process.exit(2);
  }
  console.log('设备: ' + dev[0].trim());

  const apk = newestApk();
  if (apk) {
    console.log('安装: ' + path.basename(apk) + ' (' + fs.statSync(apk).size + ' 字节)');
    const r = adb(['install', '-r', apk]);
    console.log('  ' + (/Success/i.test(r.out) ? 'Success' : r.out.trim()));
  }
  const ver = adb(['shell', 'dumpsys', 'package', 'com.selfwriting.app']).out
    .split('\n').filter((l) => /versionName/.test(l))[0];
  if (ver) console.log('已装版本: ' + ver.trim());

  adb(['shell', 'am', 'force-stop', 'com.selfwriting.app']);
  adb(['shell', 'am', 'start', '-n', 'com.selfwriting.app/.MainActivity']);
  await new Promise((r) => setTimeout(r, 7000));

  console.log('场景: ' + SCENE);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const steps = SCENES[SCENE] || [];
  for (const [key, wait] of steps) {
    if (key && TAP[key]) {
      adb(['shell', 'input', 'tap', String(TAP[key][0]), String(TAP[key][1])]);
      console.log('  点击 ' + key + ' @' + TAP[key].join(','));
    } else if (key) {
      console.log('  （跳过未知按键 ' + key + '）');
    }
    await sleep(wait || 1500);
  }
  await sleep(2000);
  console.log('截图: ' + shot(SCENE));

  const errs = adb(['logcat', '-d', '-t', '400']).out
    .split('\n').filter((l) => /FATAL EXCEPTION|AndroidRuntime.*selfwriting/.test(l));
  console.log('崩溃检查: ' + (errs.length ? errs.slice(-3).join(' | ') : '无'));
}

main().catch((e) => { console.log('[x] ' + ((e && e.message) || e)); process.exit(1); });
