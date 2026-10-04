/* ==========================================================================
   selfwriting · Service Worker
   只做一件事：把应用外壳缓存到本机，实现完全离线启动。
   没有任何网络业务请求，用户数据全部在 IndexedDB / localStorage。
   ========================================================================== */
var CACHE = 'selfwriting-v1.15.0';
var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './css/music2.css',
  './css/diary-calendar.css',
  './css/reader2.css',
  './js/i18n-extra.js',
  './js/i18n.js',
  './js/util.js',
  './js/taxonomy.js',
  './js/parsers.js',
  './js/db.js',
  './js/store.js',
  './js/achievements.js',
  './js/stats.js',
  './js/io.js',
  './js/ui.js',
  './js/view-library.js',
  './js/view-editor.js',
  './js/view-outline.js',
  './js/lunar.js',
  './js/view-diary.js',
  './js/view-reader.js',
  './js/view-stats.js',
  './js/privacy.js',
  './js/collab.js',
  './js/continue.js',
  './js/view-calc.js',
  './js/view-games.js',
  './js/tunes.js',
  './js/view-music.js',
  './js/view-notes.js',
  './js/view-tools.js',
  './js/view-collab.js',
  './js/app.js',
  './assets/icon-16.png',
  './assets/icon-32.png',
  './assets/icon-48.png',
  './assets/icon-128.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png',
  './assets/icon.ico',
  /* 真采样（FluidR3_GM · CC BY 3.0）：随包发布，离线也能用 */
  './assets/samples/manifest.json',
  './assets/samples/piano/C3.mp3',
  './assets/samples/piano/Eb3.mp3',
  './assets/samples/piano/Gb3.mp3',
  './assets/samples/piano/A3.mp3',
  './assets/samples/piano/C4.mp3',
  './assets/samples/piano/Eb4.mp3',
  './assets/samples/piano/Gb4.mp3',
  './assets/samples/piano/A4.mp3',
  './assets/samples/piano/C5.mp3',
  './assets/samples/piano/Eb5.mp3',
  './assets/samples/piano/Gb5.mp3',
  './assets/samples/piano/A5.mp3',
  './assets/samples/piano/C6.mp3',
  './assets/samples/piano/Eb6.mp3',
  './assets/samples/piano/Gb6.mp3',
  './assets/samples/epiano/C3.mp3',
  './assets/samples/epiano/Eb3.mp3',
  './assets/samples/epiano/Gb3.mp3',
  './assets/samples/epiano/A3.mp3',
  './assets/samples/epiano/C4.mp3',
  './assets/samples/epiano/Eb4.mp3',
  './assets/samples/epiano/Gb4.mp3',
  './assets/samples/epiano/A4.mp3',
  './assets/samples/epiano/C5.mp3',
  './assets/samples/epiano/Eb5.mp3',
  './assets/samples/epiano/Gb5.mp3',
  './assets/samples/epiano/A5.mp3',
  './assets/samples/epiano/C6.mp3',
  './assets/samples/epiano/Eb6.mp3',
  './assets/samples/guitar/E2.mp3',
  './assets/samples/guitar/G2.mp3',
  './assets/samples/guitar/Bb2.mp3',
  './assets/samples/guitar/Db3.mp3',
  './assets/samples/guitar/E3.mp3',
  './assets/samples/guitar/G3.mp3',
  './assets/samples/guitar/Bb3.mp3',
  './assets/samples/guitar/Db4.mp3',
  './assets/samples/guitar/E4.mp3',
  './assets/samples/guitar/G4.mp3',
  './assets/samples/guitar/Bb4.mp3',
  './assets/samples/bass/E1.mp3',
  './assets/samples/bass/G1.mp3',
  './assets/samples/bass/Bb1.mp3',
  './assets/samples/bass/Db2.mp3',
  './assets/samples/bass/E2.mp3',
  './assets/samples/bass/G2.mp3',
  './assets/samples/bass/Bb2.mp3',
  './assets/samples/bass/Db3.mp3'
];

/** 应用代码：网络优先（保证升级后不会跑到旧代码），离线时回落缓存 */
function isShell(url) {
  var p = url.pathname;
  if (p.slice(-1) === '/') return true;
  var exts = ['.js', '.css', '.html', '.webmanifest'];
  for (var i = 0; i < exts.length; i++) {
    if (p.slice(-exts[i].length) === exts[i]) return true;
  }
  return false;
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS).catch(function () { return undefined; });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 外部资源一律不接管

  if (isShell(url)) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
      })
    );
    return;
  }

  // 其它静态资源（图标等）：缓存优先，后台静默更新
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        fetch(req).then(function (res) {
          if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
        }).catch(function () { return undefined; });
        return hit;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
