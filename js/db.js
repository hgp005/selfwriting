/* ==========================================================================
   selfwriting · db.js
   本地存储层（离线优先，双写保底）
     - IndexedDB  : 主存储（容量大，可放图片）
     - localStorage: 同步影子副本（启动更快，防意外丢失）
   不含任何网络代码。
   ========================================================================== */
(function (global) {
  'use strict';

  const DB_NAME = 'selfwriting';
  const DB_VERSION = 1;
  const STORE_APP = 'app';       // 单条状态记录
  const STORE_IMG = 'images';    // 图片二进制/DataURL
  const LS_KEY = 'selfwriting.state.v1';
  const LS_BACKUP = 'selfwriting.backup.v1';
  const LS_MAX_BYTES = 1500000;      // 超过约 1.5MB 就不再写 localStorage（同步写会卡界面）

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) { reject(new Error('indexedDB unavailable')); return; }
      if (location.protocol === 'file:') { reject(new Error('file:// 下无法使用 IndexedDB')); return; }
      let req;
      try { req = global.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = function (ev) {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_APP)) db.createObjectStore(STORE_APP);
        if (!db.objectStoreNames.contains(STORE_IMG)) db.createObjectStore(STORE_IMG);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      req.onblocked = () => reject(new Error('indexedDB blocked'));
      setTimeout(() => reject(new Error('indexedDB timeout')), 6000);
    }).catch((e) => { dbPromise = null; throw e; });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      try { out = fn(s); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
    }));
  }

  const DB = {
    available: null,

    /** 探测 IndexedDB 是否可用（隐私模式等场景会失败） */
    probe() {
      if (DB.available !== null) return Promise.resolve(DB.available);
      return openDB()
        .then(() => { DB.available = true; return true; })
        .catch(() => { DB.available = false; return false; });
    },

    /* ---------- 主状态 ---------- */
    loadState() {
      return DB.probe().then((ok) => {
        if (!ok) return null;
        return tx(STORE_APP, 'readonly', (s) => s.get('state')).then((v) => v || null);
      }).catch(() => null);
    },

    /**
     * 保存状态。
     * 性能要点：大作品（数 MB 文本）下 JSON.stringify 本身就要几十毫秒，
     * 因此：同一份 state 只序列化一次并复用；IndexedDB 直接存字符串，
     * 省掉一次结构化克隆。
     */
    _lastRev: -1,
    _lastJson: null,

    /** 序列化（按 rev 缓存） */
    serialize(state) {
      if (DB._lastRev === state.rev && DB._lastJson) return DB._lastJson;
      const json = JSON.stringify(DB._stripImages(state));
      DB._lastRev = state.rev;
      DB._lastJson = json;
      return json;
    },

    /** 只写 localStorage：高频、便宜，作为影子副本。
     *  注意：localStorage 是同步的，写几 MB 字符串会阻塞主线程几百毫秒，
     *  所以仅在数据量较小时才写；大作品完全依赖 IndexedDB（异步、不阻塞）。 */
    saveLocal(state) {
      const json = DB.serialize(state);
      if (json.length > DB.LS_MAX_BYTES) return false;
      try {
        global.localStorage.setItem(LS_KEY, json);
        return true;
      } catch (e) {
        try { global.localStorage.removeItem(LS_BACKUP); global.localStorage.setItem(LS_KEY, json); return true; } catch (e2) { return false; }
      }
    },

    /** 完整落盘：IndexedDB 为主；数据量小时再补一份 localStorage 影子副本 */
    saveState(state) {
      const json = DB.serialize(state);
      const smallEnough = json.length <= DB.LS_MAX_BYTES;
      let lsOk = false;
      if (smallEnough) {
        try {
          global.localStorage.setItem(LS_KEY, json);
          lsOk = true;
        } catch (e) {
          // localStorage 满：清理旧备份后再试一次
          try { global.localStorage.removeItem(LS_BACKUP); global.localStorage.setItem(LS_KEY, json); lsOk = true; } catch (e2) { lsOk = false; }
        }
      }
      return DB.probe().then((ok) => {
        if (!ok) return { idb: false, ls: lsOk };
        return tx(STORE_APP, 'readwrite', (s) => { s.put(json, 'state'); return true; })
          .then(() => ({ idb: true, ls: lsOk }))
          .catch(() => ({ idb: false, ls: lsOk }));
      });
    },

    /** 写入前的兜底备份（每天最多一次） */
    backup(state) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const meta = global.localStorage.getItem('selfwriting.backup.date');
        if (meta === today) return;
        global.localStorage.setItem(LS_BACKUP, JSON.stringify(DB._stripImages(state)));
        global.localStorage.setItem('selfwriting.backup.date', today);
      } catch (e) { /* 空间不足则跳过 */ }
    },

    readLocalBackup() {
      try { return JSON.parse(global.localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
    },

    /** 从 state 中剥离图片正文（图片单独存在 images 表） */
    _stripImages(state) {
      const copy = JSON.parse(JSON.stringify(state, (k, v) => (k === '_imgCache' ? undefined : v)));
      return copy;
    },

    /* ---------- 图片 ---------- */
    putImage(id, dataUrl) {
      return DB.probe().then((ok) => {
        if (!ok) { DB._mem.put(id, dataUrl); return false; }
        return tx(STORE_IMG, 'readwrite', (s) => { s.put(dataUrl, id); return true; }).then(() => true).catch(() => { DB._mem.put(id, dataUrl); return false; });
      });
    },
    getImage(id) {
      if (DB._mem.has(id)) return Promise.resolve(DB._mem.get(id));
      return DB.probe().then((ok) => {
        if (!ok) return null;
        return tx(STORE_IMG, 'readonly', (s) => s.get(id)).then((v) => v || null).catch(() => null);
      });
    },
    deleteImage(id) {
      DB._mem.delete(id);
      return DB.probe().then((ok) => {
        if (!ok) return false;
        return tx(STORE_IMG, 'readwrite', (s) => { s.delete(id); return true; }).catch(() => false);
      });
    },
    allImageIds() {
      return DB.probe().then((ok) => {
        if (!ok) return Array.from(DB._mem.keys());
        return tx(STORE_IMG, 'readonly', (s) => s.getAllKeys()).catch(() => []);
      });
    },
    _mem: new Map(),

    /* ---------- 导出 / 导入 ---------- */
    /** 导出全部数据（含图片）为可下载 JSON 对象 */
    exportAll(state) {
      const ids = [];
      (state.diary || []).forEach((bk) => (bk.entries || []).forEach((en) => (en.images || []).forEach((i) => ids.push(i.id))));
      return Promise.all(ids.map((id) => DB.getImage(id).then((d) => [id, d])))
        .then((pairs) => {
          const images = {};
          pairs.forEach(([id, d]) => { if (d) images[id] = d; });
          return {
            app: 'selfwriting',
            version: 1,
            exportedAt: new Date().toISOString(),
            state: DB._stripImages(state),
            images
          };
        });
    },

    /** 导入：合并或覆盖 */
    importAll(payload, mode) {
      if (!payload || payload.app !== 'selfwriting' || !payload.state) throw new Error('不是 selfwriting 的备份文件');
      const state = payload.state;
      const images = payload.images || {};
      const jobs = Object.keys(images).map((id) => DB.putImage(id, images[id]));
      return Promise.all(jobs).then(() => state);
    },

    /** 彻底清空本地数据 */
    wipe() {
      try { global.localStorage.removeItem(LS_KEY); global.localStorage.removeItem(LS_BACKUP); } catch (e) { /* noop */ }
      DB._mem.clear();
      return DB.probe().then((ok) => {
        if (!ok) return true;
        return tx(STORE_APP, 'readwrite', (s) => { s.clear(); return true; })
          .then(() => tx(STORE_IMG, 'readwrite', (s) => { s.clear(); return true; }))
          .catch(() => false);
      });
    },

    /** 估算占用 */
    usage() {
      return new Promise((resolve) => {
        try {
          let ls = 0;
          for (let i = 0; i < global.localStorage.length; i++) {
            const k = global.localStorage.key(i);
            if (k && k.indexOf('selfwriting') === 0) ls += (global.localStorage.getItem(k) || '').length;
          }
          if (navigator.storage && navigator.storage.estimate) {
            navigator.storage.estimate().then((est) => resolve({ localBytes: ls, idbBytes: est.usage || 0, quota: est.quota || 0 })).catch(() => resolve({ localBytes: ls }));
          } else resolve({ localBytes: ls });
        } catch (e) { resolve({ localBytes: 0 }); }
      });
    },

    /** 请求持久化存储，降低被系统清理的概率 */
    requestPersist() {
      try {
        if (navigator.storage && navigator.storage.persist) return navigator.storage.persist();
      } catch (e) { /* noop */ }
      return Promise.resolve(false);
    }
  };

  global.DB = DB;
})(window);
