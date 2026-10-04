/* ==========================================================================
   selfwriting · collab.js
   协作引擎：段落级「不冲突」合并 + 协作房间的本地数据模型
   ==========================================================================
   为什么用「段落」而不是「一行」或「整章」：
     · 整章合并 = 谁后同步谁覆盖谁，这就是冲突，不能接受
     · 逐字合并（真 CRDT）需要把正文拆成字符块，改动量太大且会让编辑变慢
     · 段落是自然的写作单位：两个人各写各的段落，天然不冲突

   合并规则（关键，且是可证明的）：
     1. 段落以「规范化后的文本哈希」为身份 —— 同一段文字在两边是同一个 id
     2. 合并 = 两边的段落做**并集**：谁都不会覆盖对方新增的段落
     3. 删除用**墓碑**记录（不直接消失），避免「我删了你又同步回来」
     4. 顺序：先按已知位置排，新段落按「作者 + 创建时间」稳定排序 ——
        同样的输入必然得到同样的结果（合并可交换、可重复执行，不会越并越乱）

   这些性质在 tools/test-collab.js 里有对应测试。
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const C = {};

  /* ================================================================== */
  /* 1. 段落拆分与标识                                                  */
  /* ================================================================== */
  /** 拆成段落（空行分段），保留每一段的原始首尾空白信息 */
  C.splitParas = function (text) {
    const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    if (!src.trim()) return [];
    /* 按「一个或多个空行」切；单换行（段内换行）留在段落里 */
    return src.split(/\n{2,}/).map((p) => p.replace(/\s+$/, '')).filter((p) => p.trim().length);
  };

  /** 段落身份：规范化文本的哈希（首尾空白与行内多余空白不影响身份） */
  C.paraId = function (para) {
    const norm = String(para || '').replace(/\s+/g, ' ').trim();
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i = 0; i < norm.length; i++) {
      const c = norm.charCodeAt(i);
      h1 = ((h1 ^ c) * 16777619) >>> 0;
      h2 = ((h2 + c) * 2654435761) >>> 0;
    }
    return h1.toString(36) + h2.toString(36);
  };

  /* ================================================================== */
  /* 2. 章节的段落元数据                                                */
  /* ================================================================== */
  /**
   * meta 结构（挂在章节上，随作品一起保存/备份）：
   * {
   *   order:  [paraId...]           已知的段落顺序
   *   info:   { paraId: { a: 作者名, t: 创建时间 } }
   *   tomb:   { paraId: 删除时间 }   墓碑
   *   updatedAt: 最后一次合并时间
   * }
   */
  C.ensureMeta = function (chapter) {
    if (!chapter.paraMeta || typeof chapter.paraMeta !== 'object') {
      chapter.paraMeta = { order: [], info: {}, tomb: {}, updatedAt: 0 };
    }
    const m = chapter.paraMeta;
    if (!Array.isArray(m.order)) m.order = [];
    if (!m.info || typeof m.info !== 'object') m.info = {};
    if (!m.tomb || typeof m.tomb !== 'object') m.tomb = {};
    return m;
  };

  /** 用当前正文刷新元数据：登记所有段落的 id、作者与顺序 */
  C.syncMeta = function (chapter, author) {
    const m = C.ensureMeta(chapter);
    const paras = C.splitParas(chapter.content);
    const seen = [];
    paras.forEach((p) => {
      const id = C.paraId(p);
      seen.push(id);
      /* 不要覆盖已有作者：段落是先写的人创作的 */
      if (!m.info[id]) m.info[id] = { a: author || '我', t: Date.now() };
      if (m.tomb[id]) delete m.tomb[id];          // 又出现了 → 撤销墓碑
    });
    /* 顺序：保留已知顺序，把新段落按出现位置补进去 */
    const known = m.order.filter((id) => seen.indexOf(id) >= 0);
    const fresh = seen.filter((id) => known.indexOf(id) < 0);
    m.order = known.concat(fresh);
    m.updatedAt = Date.now();
    return m;
  };

  /* ================================================================== */
  /* 3. 合并两个版本（核心）                                            */
  /* ================================================================== */
  /**
   * 合并「本地章节」与「远端章节」的正文。
   * 返回 { content, added, kept, removed, meta }，content 永远是两边段落的并集。
   *
   * 关键性质：
   *   · 交换律：merge(A,B) 与 merge(B,A) 得到相同正文
   *   · 幂等：merge(A,A) === A
   *   · 不丢内容：任何一边独有的段落都会保留
   */
  C.mergeChapter = function (local, remote, opt) {
    const o = opt || {};
    const localAuthor = o.localAuthor || '我';
    const remoteAuthor = o.remoteAuthor || '对方';

    const localContent = String(local && local.content || '');
    const remoteContent = String(remote && remote.content || '');
    const lm = C.ensureMeta({ paraMeta: local && local.paraMeta });
    const rm = C.ensureMeta({ paraMeta: remote && remote.paraMeta });

    const lParas = C.splitParas(localContent);
    const rParas = C.splitParas(remoteContent);

    /*
     * 位置必须「只由数据决定」，不能依赖遍历先后 ——
     * 否则 merge(A,B) 与 merge(B,A) 会给出不同的顺序，两台设备就对不上了。
     * 所以这里分别记下「在本地正文里的位置」与「在远端正文里的位置」，
     * 排序时取两边已知位置的最小值。
     */
    const items = Object.create(null);
    const put = (id, text, info, side, idx) => {
      let it = items[id];
      if (!it) { it = items[id] = { id: id, text: text, posL: -1, posR: -1, info: info }; }
      if (side === 'L') it.posL = idx; else it.posR = idx;
      if (!it.info && info) it.info = info;
    };
    lParas.forEach((p, i) => put(C.paraId(p), p, lm.info[C.paraId(p)] || { a: localAuthor, t: 0 }, 'L', i));
    rParas.forEach((p, i) => {
      const id = C.paraId(p);
      put(id, p, rm.info[id] || { a: remoteAuthor, t: 0 }, 'R', i);
    });

    /* 墓碑合并：一方删除且另一方没有修改过 → 删掉。
       判定依据：墓碑时间晚于该段落最后出现的时间（这里用「对方元数据里是否还有它」近似） */
    const tomb = Object.assign({}, lm.tomb, rm.tomb);
    const removed = [];
    Object.keys(tomb).forEach((id) => {
      if (!items[id]) { delete tomb[id]; return; }     // 墓碑指向一个不存在的段落，没有意义
      const lateLocal = !!lm.info[id] && rm.tomb[id] && rm.tomb[id] > (lm.info[id].t || 0);
      const lateRemote = !!rm.info[id] && lm.tomb[id] && lm.tomb[id] > (rm.info[id].t || 0);
      if (lateLocal || lateRemote) { delete items[id]; removed.push(id); }
      else delete tomb[id];
    });

    /*
     * 排序只用「与顺序无关」的依据，依次是：
     *   1. 该段在两边正文里的最小位置（新段落自然落在它被写下的地方）
     *   2. 创建时间
     *   3. 作者名、段落 id（纯兜底，保证任何输入都有唯一确定的结果）
     * 注意：不拿 order 数组当排序依据 —— order 的合并本身是「先来先得」，
     * 用它排序会破坏交换律，两台设备就会得到不同顺序。
     */
    const list = Object.keys(items).map((k) => items[k]);
    const posKey = (it) => Math.min(
      it.posL < 0 ? Number.MAX_SAFE_INTEGER : it.posL,
      it.posR < 0 ? Number.MAX_SAFE_INTEGER : it.posR
    );
    list.sort((a, b) => {
      const pa = posKey(a), pb = posKey(b);
      if (pa !== pb) return pa - pb;
      const ta = (a.info && a.info.t) || 0, tb = (b.info && b.info.t) || 0;
      if (ta !== tb) return ta - tb;
      const aa = (a.info && a.info.a) || '', ab = (b.info && b.info.a) || '';
      if (aa !== ab) return aa < ab ? -1 : 1;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });

    const content = list.map((x) => x.text).join('\n\n');
    const info = Object.assign({}, lm.info, rm.info);
    const meta = {
      order: list.map((x) => x.id),
      info: info,
      tomb: tomb,
      updatedAt: Date.now()
    };
    return {
      content: content,
      added: list.length - C.splitParas(localContent).length,
      total: list.length,
      removed: removed,
      meta: meta
    };
  };

  /* ================================================================== */
  /* 4. 章节删除标记的同步                                              */
  /* ================================================================== */
  /** 用「章节标题 + 创建时间」作为章节身份，避免两边各自新增导致错配 */
  C.chapterKey = function (ch) {
    return C.paraId('ch:' + (ch && ch.title || '') + '|' + (ch && ch.createdAt || 0));
  };

  /* ================================================================== */
  /* 5. 协作房间的本地模型                                              */
  /* ================================================================== */
  /**
   * settings.collab = {
   *   me: '昵称',
   *   room: 'ABC123' | null,
   *   hostUrl: 'http://192.168.1.5:8099',
   *   works: [{ kind, id, title, role: 'write'|'read', joinedAt }],
   *   friends: [{ name, at }],
   *   chat: { 'kind:id': [ {from, text, at} ] }
   * }
   */
  C.state = function () {
    const s = global.Store.state;
    if (!s.settings.collab || typeof s.settings.collab !== 'object') {
      s.settings.collab = { me: '', room: null, hostUrl: '', works: [], friends: [], chat: {} };
    }
    const c = s.settings.collab;
    if (!Array.isArray(c.works)) c.works = [];
    if (!Array.isArray(c.friends)) c.friends = [];
    if (!c.chat || typeof c.chat !== 'object') c.chat = {};
    return c;
  };

  C.save = function () {
    try { global.Store.setSetting('collab', C.state()); } catch (e) { /* noop */ }
  };

  /**
   * 我在协作里的署名。
   * 注册过账号就用昵称（「我的」页面里设的名字），没注册才退回随机代号 ——
   * 这样日记作者、协作对话、参与者名单里显示的都是你自己起的名字。
   */
  C.me = function () {
    const c = C.state();
    const p = (global.Store && global.Store.profile) ? global.Store.profile() : null;
    if (p && p.registered && p.name) return p.name;
    if (!c.me) {
      c.me = '我' + String(Math.floor(Math.random() * 900) + 100);
      C.save();
    }
    return c.me;
  };

  /** 昵称改了之后调用：让后续署名立刻用新名字（历史消息保持原样） */
  C.refreshIdentity = function () {
    const c = C.state();
    const p = (global.Store && global.Store.profile) ? global.Store.profile() : null;
    if (p && p.registered && p.name) c.me = p.name;
    C.save();
  };

  /** 加入一部作品的协作 */
  C.joinWork = function (kind, id, title, role) {
    const c = C.state();
    const found = c.works.find((w) => w.kind === kind && w.id === id);
    if (found) { found.role = role || found.role; found.title = title || found.title; }
    else c.works.unshift({ kind: kind, id: id, title: title || '', role: role || 'write', joinedAt: Date.now() });
    C.save();
  };

  C.leaveWork = function (kind, id) {
    const c = C.state();
    c.works = c.works.filter((w) => !(w.kind === kind && w.id === id));
    C.save();
  };

  C.isShared = function (kind, id) {
    return C.state().works.some((w) => w.kind === kind && w.id === id);
  };

  C.roleOf = function (kind, id) {
    const w = C.state().works.find((x) => x.kind === kind && x.id === id);
    return w ? w.role : null;
  };

  /* ---- 聊天记录 ---- */
  C.chatKey = (kind, id) => kind + ':' + id;

  C.chatOf = function (kind, id) {
    const c = C.state();
    const k = C.chatKey(kind, id);
    if (!Array.isArray(c.chat[k])) c.chat[k] = [];
    return c.chat[k];
  };

  C.addChat = function (kind, id, from, text) {
    const arr = C.chatOf(kind, id);
    const msg = { from: String(from || '匿名').slice(0, 20), text: String(text || '').slice(0, 2000), at: Date.now() };
    arr.push(msg);
    if (arr.length > 500) arr.splice(0, arr.length - 500);      // 只留最近 500 条
    C.save();
    return msg;
  };

  /** 未读计数：房间消息进来时用它提示 */
  C.unread = function (kind, id) {
    const arr = C.chatOf(kind, id);
    const seen = C.state().chatSeen || {};
    const last = seen[C.chatKey(kind, id)] || 0;
    return arr.filter((m) => m.at > last && m.from !== C.me()).length;
  };

  C.markChatSeen = function (kind, id) {
    const c = C.state();
    c.chatSeen = c.chatSeen || {};
    c.chatSeen[C.chatKey(kind, id)] = Date.now();
    C.save();
  };

  /* ================================================================== */
  /* 6. 协作网络：房间服务端（本机起房）与客户端                        */
  /* ================================================================== */
  /**
   * 用的是「HTTP 轮询」而不是 WebSocket，理由：
   *   · 安卓壳里的本机服务是手写 HTTP（LocalServer），加 WebSocket 要重写协议栈；
   *   · 轮询 2 秒一次，写小说的交互密度完全够，且断线重连天然简单；
   *   · 两个版本（网页 / APK）用同一套接口，行为一致。
   * 房间是「谁先起房谁是主机」，不需要任何中心服务器。
   */
  const POLL_MS = 2000;

  C.room = { code: null, host: null, me: null, members: [], seq: 0, timer: null, onEvent: null, alive: false };

  function randCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉易混的 I O 0 1
    let s = '';
    for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  /** 生成房间码 —— 需要主机侧把它交给服务端 */
  C.newRoomCode = randCode;

  /** 起房：把房间注册到本机服务（server.js / LocalServer 的 /collab/* 接口） */
  C.hostRoom = function (opt) {
    const o = opt || {};
    const code = o.code || randCode();
    return fetch('/collab/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, me: C.me(), room: o.room || '' })
    }).then((r) => r.json()).then((res) => {
      if (!res || !res.ok) throw new Error((res && res.error) || '创建房间失败');
      C.room.code = res.code;
      C.room.host = location.origin;
      C.room.me = C.me();
      C.room.seq = 0;
      C.room.alive = true;
      C.state().room = res.code;
      C.state().hostUrl = location.origin;
      C.save();
      C.startPolling();
      return res;
    });
  };

  /** 加入别人的房间 */
  C.joinRoom = function (hostUrl, code) {
    const base = String(hostUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return Promise.reject(new Error('主机地址要以 http:// 开头'));
    const url = base + '/collab/join';
    /* 直连主机：如果页面上有本机代理，用代理绕开跨域；没有就直连（同局域网通常允许） */
    const direct = () => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: String(code || '').toUpperCase(), me: C.me() })
    }).then((r) => r.json());
    return direct().catch(() => {
      /* 跨域被拦时改走本机代理 */
      return fetch('/__fetch?url=' + encodeURIComponent(url.replace(/^https?:/, location.protocol)), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: String(code || '').toUpperCase(), me: C.me() })
      }).then((r) => r.json());
    }).then((res) => {
      if (!res || !res.ok) throw new Error((res && res.error) || '加入失败：房间码或地址不对');
      C.room.code = res.code;
      C.room.host = base;
      C.room.me = C.me();
      C.room.seq = 0;
      C.room.alive = true;
      C.state().room = res.code;
      C.state().hostUrl = base;
      C.save();
      C.startPolling();
      return res;
    });
  };

  C.leaveRoom = function () {
    C.stopPolling();
    C.room.alive = false;
    C.room.code = null;
    C.room.host = null;
    C.state().room = null;
    C.save();
  };

  function roomUrl(path) {
    if (!C.room.host) return null;
    return C.room.host.replace(/\/+$/, '') + path;
  }

  /** 推送本地改动到房间 */
  C.push = function (kind, id, title, chapters, isHost) {
    if (!C.room.alive || !C.room.code) return Promise.resolve({ ok: false, offline: true });
    const payload = {
      code: C.room.code, me: C.me(),
      work: { kind: kind, id: id, title: title },
      chapters: chapters
    };
    const url = isHost === false ? roomUrl('/collab/push') : '/collab/push';
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then((r) => r.json()).catch(() => ({ ok: false, offline: true }));
  };

  /** 发一条聊天 */
  C.sendChat = function (kind, id, text) {
    const msg = C.addChat(kind, id, C.me(), text);
    if (C.room.alive && C.room.code) {
      fetch('/collab/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: C.room.code, me: C.me(), work: { kind: kind, id: id }, text: msg.text })
      }).catch(() => { /* 离线就只留在本地 */ });
    }
    return msg;
  };

  /** 开始轮询：拿到远端改动就回调 onEvent */
  C.startPolling = function () {
    C.stopPolling();
    if (!C.room.alive || !C.room.code) return;
    C.room.timer = setInterval(() => {
      if (!C.room.alive || !C.room.code) return;
      window.fetch('/collab/poll?code=' + encodeURIComponent(C.room.code)
        + '&me=' + encodeURIComponent(C.me()) + '&since=' + C.room.seq)
        .then((r) => r.json())
        .then((res) => {
          if (!res || !res.ok) return;
          C.room.seq = res.seq || C.room.seq;
          C.room.members = res.members || [];
          if (C.room.onEvent) {
            (res.edits || []).forEach((e) => C.room.onEvent({ type: 'edit', edit: e }));
            (res.chats || []).forEach((m) => C.room.onEvent({ type: 'chat', msg: m }));
          }
        })
        .catch(() => { /* 主机暂时不可达：下次再试，不打断写作 */ });
    }, POLL_MS);
  };

  C.stopPolling = function () {
    if (C.room.timer) { clearInterval(C.room.timer); C.room.timer = null; }
  };

  C.onEvent = function (fn) { C.room.onEvent = fn; };

  global.Collab = C;
})(window);
