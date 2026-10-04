/* ==========================================================================
   make-icon-from-image.js — 用一张位图生成全套应用图标
   --------------------------------------------------------------------------
   为什么需要它：安卓启动器图标**不能用矢量图**还原 3D 立体质感，
   必须按密度放位图 PNG。

   流程：
     1. 用 Edge（无头）原生解码源图 —— 不自己写 JPEG 解码器，避免色偏/错位
     2. 自动量出主体边界（与角落背景色差 > 阈值的包围盒）
     3. 按需裁切 + 圆角遮罩，输出 1024 主图
     4. 缩放生成应用各尺寸 PNG、Windows ICO、安卓各密度 ic_launcher.png

   用法：
     node tools/make-icon-from-image.js <源图> [--pad 0.04] [--radius 0.2] [--flat]
       --pad     裁切时四边各留的比例（默认 0.04）
       --radius  圆角半径占边长比例（默认 0.2）
       --flat    同时输出不带圆角的方图（安卓自适应图标用，由系统裁形状）
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { launch, Page } = require('./driver.js');
const M = require('./make-icons.js');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const ANDROID_RES = path.join(ROOT, 'android', 'res');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}

/* 安卓密度：mdpi 48 / hdpi 72 / xhdpi 96 / xxhdpi 144 / xxxhdpi 192 */
const ANDROID_DENSITIES = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 }
];

async function renderWithBrowser(srcPath, opts) {
  const ext = path.extname(srcPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
  const b64 = fs.readFileSync(srcPath).toString('base64');
  const browser = await launch();
  try {
    const page = await Page.open(browser, 'about:blank');
    const res = await page.call(`
      var img = new Image();
      await new Promise(function (res, rej) {
        img.onload = res;
        img.onerror = function () { rej(new Error('浏览器无法解码这张图')); };
        img.src = 'data:${mime};base64,${b64}';
      });
      var W = img.naturalWidth, H = img.naturalHeight;
      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      var g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      var d = g.getImageData(0, 0, W, H).data;

      function px(x, y) { var i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; }
      var bg = px(2, 2);
      function diff(x, y) {
        var p = px(x, y);
        return Math.max(Math.abs(p[0] - bg[0]), Math.abs(p[1] - bg[1]), Math.abs(p[2] - bg[2]));
      }
      /* 逐行/逐列找主体边界：某行/列存在与背景色差明显的像素即算主体 */
      var T = 12;
      var x0 = W, x1 = -1, y0 = H, y1 = -1;
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          if (diff(x, y) > T) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }

      var boxW = x1 - x0 + 1, boxH = y1 - y0 + 1;
      var side = Math.max(boxW, boxH);
      var pad = side * ${Number(opts.pad)};
      var half = side / 2 + pad;
      var cxp = (x0 + x1 + 1) / 2, cyp = (y0 + y1 + 1) / 2;

      var OUT = 1024;
      function draw(round) {
        var cc = document.createElement('canvas');
        cc.width = OUT; cc.height = OUT;
        var gg = cc.getContext('2d');
        gg.imageSmoothingEnabled = true;
        gg.imageSmoothingQuality = 'high';
        if (round) {
          var r = OUT * ${Number(opts.radius)};
          gg.beginPath();
          gg.moveTo(r, 0);
          gg.lineTo(OUT - r, 0); gg.quadraticCurveTo(OUT, 0, OUT, r);
          gg.lineTo(OUT, OUT - r); gg.quadraticCurveTo(OUT, OUT, OUT - r, OUT);
          gg.lineTo(r, OUT); gg.quadraticCurveTo(0, OUT, 0, OUT - r);
          gg.lineTo(0, r); gg.quadraticCurveTo(0, 0, r, 0);
          gg.closePath();
          gg.clip();
        }
        gg.drawImage(img, cxp - half, cyp - half, half * 2, half * 2, 0, 0, OUT, OUT);
        return cc;
      }

      /* 抠底：源图是浅灰底 + 柔和阴影。把接近底色的像素按“接近程度”渐变透明，
         这样既去掉灰底，又保住阴影的柔和过渡（直接二值化会留硬边）。 */
      var LOW = 6, HIGH = 22;
      var bgR = bg[0], bgG = bg[1], bgB = bg[2];
      function cutout(canvas) {
        var g2 = canvas.getContext('2d', { willReadFrequently: true });
        var id = g2.getImageData(0, 0, OUT, OUT);
        var p = id.data;
        for (var i = 0; i < p.length; i += 4) {
          var dr = p[i] - bgR, dg = p[i + 1] - bgG, db = p[i + 2] - bgB;
          var dist = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
          if (dist <= LOW) {
            p[i + 3] = 0;
          } else if (dist < HIGH) {
            p[i + 3] = Math.round(255 * (dist - LOW) / (HIGH - LOW));
          }
        }
        g2.putImageData(id, 0, 0);
        return canvas;
      }

      var roundCanvas = cutout(draw(true));
      var flatCanvas = cutout(draw(false));

      return JSON.stringify({
        W: W, H: H, bg: bg, box: [x0, y0, x1, y1], boxSize: [boxW, boxH],
        round: roundCanvas.toDataURL('image/png'),
        flat: flatCanvas.toDataURL('image/png')
      });
    `);
    return JSON.parse(res);
  } finally {
    try { browser.proc.kill(); } catch (e) { /* noop */ }
  }
}

function pngFromDataUrl(dataUrl) {
  return Buffer.from(String(dataUrl).split(',')[1], 'base64');
}

/* ------------------------------------------------------------------ */
/* PNG 体积优化：透明像素归零                                           */
/* ------------------------------------------------------------------ */
/**
 * 说明：试过「抖动量化」把 RGB 低位抹掉，实测反而**变大** ——
 * 误差扩散引入的色彩噪声破坏了 PNG 的预测滤波，512px 从 158 KB 涨到 173 KB。
 * 因此这里只保留真正有效的一步：接近全透明的像素直接归零，
 * 让圆角外侧成为成片的 0，PNG 对这种数据的压缩率极高。
 */
function snapAlpha(img) {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 6) d[i] = 0;
  }
  return img;
}

async function main() {
  const src = process.argv[2];
  if (!src) {
    console.error('用法: node tools/make-icon-from-image.js <源图> [--pad 0.04] [--radius 0.2]');
    process.exit(2);
  }
  const opts = { pad: arg('pad', 0.04), radius: arg('radius', 0.2) };
  console.log('源图: ' + src);
  console.log('裁切留白: ' + (Number(opts.pad) * 100).toFixed(1) + '%   圆角: ' + (Number(opts.radius) * 100).toFixed(0) + '%');

  const r = await renderWithBrowser(src, opts);
  console.log('原图 ' + r.W + 'x' + r.H + '  背景色 rgb(' + r.bg.join(',') + ')');
  console.log('主体边界 [' + r.box.join(', ') + ']  尺寸 ' + r.boxSize.join('x'));

  /* 1024 母版：只作为「重新生成图标」的存档，放进 android/icon-source，
     绝不放进 assets —— 否则两张 470 KB 的大图会白白撑大 APK。 */
  const roundPng = pngFromDataUrl(r.round);
  const flatPng = pngFromDataUrl(r.flat);
  const srcDir = path.join(ROOT, 'android', 'icon-source');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'icon-source-1024.png'), roundPng);
  fs.writeFileSync(path.join(srcDir, 'icon-square-1024.png'), flatPng);

  /* 透明像素归零，其余保持原样（不做量化：实测会变大） */
  const roundImg = snapAlpha(M.decodePng(roundPng));

  /* --- 应用图标（网页 / 通知 / 桌面） --- */
  const sizes = [512, 256, 192, 128, 64, 48, 32, 24, 16];
  const icoImages = [];
  sizes.forEach((s) => {
    const img = M.resize(roundImg, s, s);
    const png = M.encodePng(img);
    fs.writeFileSync(path.join(ASSETS, 'icon-' + s + '.png'), png);
    if ([16, 24, 32, 48, 64, 128, 256].indexOf(s) >= 0) icoImages.push({ size: s, png: png });
  });
  /* maskable 用 192 就够 PWA 安装提示用，省下 100 多 KB */
  fs.writeFileSync(path.join(ASSETS, 'icon-maskable-512.png'), M.encodePng(M.resize(roundImg, 256, 256)));
  fs.writeFileSync(path.join(ASSETS, 'icon-maskable-192.png'), M.encodePng(M.resize(roundImg, 192, 192)));
  icoImages.sort((a, b) => a.size - b.size);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), M.buildIco(icoImages));

  /* --- 安卓各密度 ic_launcher.png（用圆角版，与手机桌面观感一致） --- */
  ANDROID_DENSITIES.forEach((d) => {
    const dir = path.join(ANDROID_RES, d.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), M.encodePng(M.resize(roundImg, d.size, d.size)));
  });

  console.log('已生成:');
  console.log('  assets/icon-{512..16}.png + icon.ico（' + icoImages.map((i) => i.size).join('/') + '）');
  console.log('  assets/icon-maskable-{512,192}.png');
  console.log('  android/icon-source/icon-source-1024.png（母版存档，不进 APK）');
  console.log('  android/res/mipmap-*/ic_launcher.png（' + ANDROID_DENSITIES.map((d) => d.size).join('/') + '）');
}

main().catch((e) => {
  console.error('生成失败: ' + (e && e.stack || e));
  process.exit(1);
});
