/* ==========================================================================
   selfwriting · pet.js
   小陪伴桌宠：一只布偶猫（全部用内联 SVG 画出来，不联网、不打包图片）

   设计要点
     · 状态存在 Store.state.settings.pet 里（跟着整库备份一起走），
       读取一律「缺字段 → 默认值」，老数据 / 手改过的数据都不会炸。
     · 数值按真实时间衰减：只记 updatedAt，用 Date.now() 的差值算，
       所以关掉应用三天再打开，猫是真的饿了。
     · 手势三档（时长由本模块判定，view 只负责计时与进度反馈）：
         点按 <350ms  → 表情反应
         350ms–2.5s  → 动作菜单
         ≥3s         → 「取消 / 保留」对话框（收起来 or 继续陪着）
     · 不抢触摸：只有猫本身那一小块接收指针事件，其余区域全部穿透。
     · 省电：整只猫只有 1 个 1 秒定时器 + 1 个空闲小动作定时器；
       页面切到后台（document.hidden）时动画与定时器一起停。
     · 不发明 API：Stats / Store / UI / Ach 全部 try/catch 兜底，
       任何一个缺失都只影响对应的小功能，不会让应用挂掉。

   对外接口（window.Pet）：见文件末尾的 Pet 对象。
   ========================================================================== */
(function (global) {
  'use strict';

  const Store = global.Store;
  const doc = global.document;

  /* ---------------- 常量 ---------------- */

  const BASE_SIZE = 104;          // 成年猫的点击区（px），幼猫/老友猫按等级缩放

  const DEF = {
    enabled: true,        // 桌宠总开关
    hidden: false,        // 长按 3 秒「取消」= 收起来（只在设置里「叫它出来」才回来）
    coat: 'seal',         // 配色：seal 海豹重点 / blue 蓝重点 / bicolor 双色
    style: 'real',        // 画风：real 写实（默认）/ chibi Q 版
    x: 0.84, y: 0.72,     // 位置（视口比例）
    at: false,            // 用户是否亲手挪过
    stats: null,          // { satiety, mood, bond, energy }
    updatedAt: 0,
    pose: 'sit',          // sit | lie | stretch | knead
    bornAt: 0,
    focusUntil: 0,
    focusMin: 0,
    focusCount: 0,
    slept: 0,
    talkAt: 0,
    remindMin: 0,
    seen: 0,
    flags: null,          // 场景小物：{ bowl, bowlEmpty, ball, nap, board, note }
    lastBowl: 0,
    lastPlay: 0,
    lastBoard: 0,
    noteAt: 0,            // 上次叼小纸条
    level: 1,             // 上次已知等级（升级时庆祝用）
    achCount: -1          // 上次已知成就数（达成成就时跳一下）
  };

  const STAT_KEYS = ['satiety', 'mood', 'bond', 'energy'];
  const STAT_LABEL = { satiety: '饱食度', mood: '心情', bond: '亲密度', energy: '精力' };

  /* 每小时自然衰减；睡觉时精力回血、其余减半 */
  const DECAY = { satiety: 7, mood: 4, bond: 0.2, energy: 1 };
  const DECAY_MS = 3600000;
  const MAX_ELAPSED = 30 * 24 * DECAY_MS;
  const NAP_MS = 11 * 60000;
  const PAD = 8;                  // 距屏幕边缘
  const TOP_BAR = 92;             // 不遮挡顶部栏

  /* 手势阈值（毫秒） */
  const TAP_MS = 350;             // 点按
  const MENU_MS = 2500;           // 短长按 → 动作菜单
  const HOLD_MS = 3000;           // 长长按 → 取消 / 保留
  const HOLD_ARM_MS = 380;        // 超过这个时长才开始画进度环

  /* 亲密度等级：小奶猫 → …… → 一生之友。
     scale 同时决定「视觉大小」与「点按区大小」（96–110px），
     幼猫小一点，老友猫大一点，但仍然只覆盖猫自己那一小块。 */
  const LEVELS = [
    { min: 0, title: '小奶猫', scale: 0.92 },
    { min: 20, title: '小布偶', scale: 0.96 },
    { min: 45, title: '布偶猫', scale: 1 },
    { min: 70, title: '猫伙伴', scale: 1.03 },
    { min: 90, title: '一生之友', scale: 1.06 }
  ];

  const POSES = ['sit', 'lie', 'stretch', 'knead'];

  /* 两种画风：写实（默认）与 Q 版。真正的图形在 js/view-pet.js 里。 */
  const STYLES = [
    { id: 'real', name: '写实', note: '接近真猫的比例、口鼻与毛感' },
    { id: 'chibi', name: 'Q 版', note: '大头大眼的萌版' }
  ];

  /* 三套配色（真正的颜色写在 css/pet.css 的 [data-coat=…] 里，这里只放名字与说明） */
  const COATS = [
    { id: 'seal', name: '海豹重点色', note: '奶白身子 + 深褐色重点，湛蓝眼睛', swatch: '#5b453e' },
    { id: 'blue', name: '蓝重点色', note: '奶白身子 + 灰蓝色重点，眼神更柔', swatch: '#818d9c' },
    { id: 'bicolor', name: '双色', note: '脸上倒 V 白色面罩，四只白手套', swatch: '#cfc0b6' }
  ];

  const LINES = [
    '该写点东西啦',
    '坐太久了，动一动',
    '今天也一起写一点吧',
    '我在这儿陪着你',
    '写不动就歇一会儿',
    '喝口水吧',
    '想到什么就先记下来',
    '你已经很棒了'
  ];

  const RANDOM_EVENTS = [
    { kind: 'chase', pose: 'stretch', say: '尾巴！抓到你了！' },
    { kind: 'sneeze', pose: 'sit', say: '阿嚏！' },
    { kind: 'butterfly', pose: 'stretch', say: '蝴蝶！' },
    { kind: 'knead', pose: 'knead', say: '踩踩踩～' }
  ];

  /* ---------------- 状态读写 ---------------- */

  let S = null;
  const dirty = {
    lastLine: '', lastTick: 0, sleepDone: false, lastScene: '',
    avoid: null, avoidAt: 0, surpriseUntil: 0, lastMood: ''
  };

  function num(v, d, min, max) {
    let n = Number(v);
    if (!isFinite(n)) n = d;
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    return n;
  }

  function defStat() {
    return { satiety: 80, mood: 80, bond: 8, energy: 80 };
  }

  function defFlags() {
    return { bowl: 0, bowlEmpty: false, ball: 0, nap: 0, board: 0, note: false };
  }

  function normStats(raw) {
    const out = defStat();
    if (raw && typeof raw === 'object') {
      STAT_KEYS.forEach((k) => { if (raw[k] !== undefined) out[k] = num(raw[k], out[k], 0, 100); });
    }
    return out;
  }

  function normFlags(raw) {
    const out = defFlags();
    if (raw && typeof raw === 'object') {
      out.bowl = num(raw.bowl, 0, 0);
      out.bowlEmpty = !!raw.bowlEmpty;
      out.ball = num(raw.ball, 0, 0);
      out.nap = num(raw.nap, 0, 0);
      out.board = num(raw.board, 0, 0);
      out.note = !!raw.note;
    }
    return out;
  }

  function coatOf(id) {
    for (let i = 0; i < COATS.length; i++) if (COATS[i].id === id) return COATS[i];
    return COATS[0];
  }

  function styleOf(id) {
    for (let i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i];
    return STYLES[0];   // 默认写实
  }

  /** 把外部数据规整成一份完整、合法的宠物状态（缺什么补什么） */
  function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const now = Date.now();
    const out = {
      enabled: r.enabled !== false,
      hidden: r.hidden === true,
      coat: coatOf(r.coat).id,
      style: styleOf(r.style).id,
      x: num(r.x, DEF.x, 0, 1),
      y: num(r.y, DEF.y, 0, 1),
      at: !!r.at,
      stats: normStats(r.stats),
      updatedAt: num(r.updatedAt, now, 0),
      pose: POSES.indexOf(r.pose) >= 0 ? r.pose : DEF.pose,
      bornAt: num(r.bornAt, now, 0),
      focusUntil: num(r.focusUntil, 0, 0),
      focusMin: num(r.focusMin, 0, 0, 600),
      focusCount: num(r.focusCount, 0, 0),
      slept: num(r.slept, 0, 0),
      talkAt: num(r.talkAt, 0, 0),
      remindMin: num(r.remindMin, 0, 0, 240),
      seen: num(r.seen, 0, 0),
      sleepUntil: num(r.sleepUntil, 0, 0),
      dayKey: typeof r.dayKey === 'string' ? r.dayKey : '',
      flags: normFlags(r.flags),
      lastBowl: num(r.lastBowl, 0, 0),
      lastPlay: num(r.lastPlay, 0, 0),
      lastBoard: num(r.lastBoard, 0, 0),
      noteAt: num(r.noteAt, 0, 0),
      level: num(r.level, 1, 1, 5),
      achCount: num(r.achCount, -1, -1)
    };
    if (!out.updatedAt) out.updatedAt = now;
    if (out.bornAt > now) out.bornAt = now;
    /* 场景小物有时效：放久了自动收走，别一直糊在屏幕上 */
    const alive = (t, ms) => t > 0 && now - t < ms;
    out.flags.bowl = alive(out.flags.bowl, 90 * 60000) ? out.flags.bowl : 0;
    out.flags.ball = alive(out.flags.ball, 20 * 60000) ? out.flags.ball : 0;
    out.flags.board = alive(out.flags.board, 40 * 60000) ? out.flags.board : 0;
    if (out.flags.bowl && now - out.flags.bowl > 4 * 60000) out.flags.bowlEmpty = true;
    return out;
  }

  /** 读一份浅拷贝，给界面用（界面绝不直接改这份对象） */
  function snapshot() {
    return {
      enabled: S.enabled,
      hidden: S.hidden,
      coat: S.coat,
      style: S.style,
      x: S.x, y: S.y, at: S.at,
      pose: S.pose,
      stats: { satiety: S.stats.satiety, mood: S.stats.mood, bond: S.stats.bond, energy: S.stats.energy },
      updatedAt: S.updatedAt,
      bornAt: S.bornAt,
      focusUntil: S.focusUntil,
      focusMin: S.focusMin,
      focusCount: S.focusCount,
      slept: S.slept,
      talkAt: S.talkAt,
      remindMin: S.remindMin,
      flags: {
        bowl: S.flags.bowl, bowlEmpty: S.flags.bowlEmpty, ball: S.flags.ball,
        nap: S.flags.nap, board: S.flags.board, note: S.flags.note
      },
      noteAt: S.noteAt,
      level: S.level,
      achCount: S.achCount
    };
  }

  function get() {
    if (!S) load();
    return S;
  }

  function load() {
    let raw = null;
    try {
      const st = Store && Store.state;
      if (st && st.settings && st.settings.pet) raw = st.settings.pet;
    } catch (e) { raw = null; }
    S = normalize(raw);
    return S;
  }

  /** 落盘：整份写回 settings.pet（commit 会走 Store 的节流保存） */
  function save() {
    if (!S) return false;
    try {
      if (!Store || typeof Store.setSetting !== 'function') return false;
      Store.setSetting('pet', snapshot());
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- 数值 ---------------- */

  function isAsleep(now) {
    if (!S) return false;
    const t = now === undefined ? Date.now() : now;
    return !!(S.sleepUntil && S.sleepUntil > t);
  }

  /**
   * 按真实时间推进状态：用「上次结算时间 → 现在」的差值算。
   * 返回 { before, elapsed, changed, levelUp }
   */
  function tick(now) {
    const st = get();
    const t = now === undefined ? Date.now() : now;
    const elapsed = Math.min(Math.max(0, t - st.updatedAt), MAX_ELAPSED);
    const before = { satiety: st.stats.satiety, mood: st.stats.mood, bond: st.stats.bond, energy: st.stats.energy };
    const beforeLevel = levelOf(st.stats.bond).level;

    const awake = st.sleepUntil && st.sleepUntil > t ? 0.25 : 1;
    const hours = elapsed / DECAY_MS;
    if (hours > 0) {
      st.stats.satiety = num(st.stats.satiety - DECAY.satiety * hours * awake, 0, 0, 100);
      st.stats.mood = num(st.stats.mood - DECAY.mood * hours * awake, 0, 0, 100);
      st.stats.bond = num(st.stats.bond - DECAY.bond * hours, 0, 0, 100);
      if (awake === 1) st.stats.energy = num(st.stats.energy - DECAY.energy * hours, 0, 0, 100);
      else st.stats.energy = num(st.stats.energy + 14 * hours, 0, 0, 100);
    }

    if (st.sleepUntil && st.sleepUntil <= t) {
      st.sleepUntil = 0;
      st.slept = (st.slept || 0) + 1;
      st.stats.energy = num(st.stats.energy + 18, 0, 0, 100);
      st.stats.mood = num(st.stats.mood + 4, 0, 0, 100);
      dirty.sleepDone = true;
    }

    st.updatedAt = t;
    markDay(t);
    const afterLevel = levelOf(st.stats.bond).level;
    const levelUp = afterLevel > beforeLevel ? afterLevel : 0;
    if (levelUp) {
      st.level = levelUp;
      save();
    }
    return { before: before, elapsed: elapsed, changed: changed(before), levelUp: levelUp };
  }

  function changed(before) {
    const out = [];
    if (!before || !S) return out;
    STAT_KEYS.forEach((k) => { if (Math.abs(S.stats[k] - before[k]) > 0.0001) out.push(k); });
    return out;
  }

  function markDay(now) {
    const st = get();
    let key = '';
    try {
      key = global.U && global.U.dateKey ? String(global.U.dateKey()) : new Date(now).toDateString();
    } catch (e) { key = new Date(now).toDateString(); }
    if (st.dayKey !== key) {
      if (st.dayKey) st.seen = (st.seen || 0) + 1;
      st.dayKey = key;
      st.flags.note = false;      // 新的一天，纸条重新可以叼
    }
  }

  function daysTogether() {
    const st = get();
    try {
      if (global.U && global.U.dayDiff && global.U.dateKey) {
        const n = global.U.dayDiff(global.U.dateKey(new Date(st.bornAt)), global.U.dateKey());
        return Math.max(1, num(n, 0, 0, 99999) + 1);
      }
    } catch (e) { /* 兜底 */ }
    return Math.max(1, Math.round((Date.now() - st.bornAt) / 86400000) + 1);
  }

  /* ---------------- 等级 / 体型 ---------------- */

  function levelOf(bond) {
    const b = num(bond, 0, 0, 100);
    let idx = 0;
    for (let i = 0; i < LEVELS.length; i++) if (b >= LEVELS[i].min) idx = i;
    const next = LEVELS[idx + 1] || null;
    const from = LEVELS[idx].min;
    const to = next ? next.min : 100;
    const pct = to > from ? Math.min(1, Math.max(0, (b - from) / (to - from))) : 1;
    const level = idx + 1;
    return {
      level: level,
      title: LEVELS[idx].title,
      scale: LEVELS[idx].scale,
      next: next ? next.title : '',
      need: next ? Math.ceil(next.min - b) : 0,
      pct: pct,
      /* 猫伙伴开始有围巾，一生之友才有小领结 */
      scarf: level >= 4,
      bow: level >= 5
    };
  }

  function decorate() {
    const st = get();
    const lv = levelOf(st.stats.bond);
    return {
      level: lv.level, levelTitle: lv.title, next: lv.next, need: lv.need, pct: lv.pct,
      title: lv.title, scale: lv.scale, scarf: lv.scarf, bow: lv.bow,
      days: daysTogether(), coat: coatOf(st.coat), style: styleOf(st.style), size: size()
    };
  }

  /** 当前点击区边长（按等级微调，落在 96–120px 里） */
  function size() {
    const st = get();
    return Math.round(BASE_SIZE * levelOf(st.stats.bond).scale);
  }

  /* ---------------- 与应用的其它模块打交道（全部兜底） ---------------- */

  function todayWords() {
    try {
      if (global.Stats && typeof global.Stats.today === 'function' && Store && Store.state) {
        const d = global.Stats.today(Store.state);
        if (d && isFinite(d.words)) return Math.max(0, Math.round(d.words));
      }
    } catch (e) { /* 兜底 */ }
    try {
      const daily = Store && Store.state && Store.state.stats && Store.state.stats.daily;
      if (daily && global.U && global.U.dateKey) {
        const d = daily[global.U.dateKey()];
        if (d && isFinite(d.words)) return Math.max(0, Math.round(d.words));
      }
    } catch (e) { /* 读不到就当 0 */ }
    return 0;
  }

  function wroteToday() {
    try {
      const daily = Store && Store.state && Store.state.stats && Store.state.stats.daily;
      if (!daily || !global.U || !global.U.dateKey) return true;
      const d = daily[global.U.dateKey()];
      if (!d) return false;
      return (num(d.words, 0) > 0) || (num(d.ms, 0) > 60000);
    } catch (e) { return true; }
  }

  /** 成就数（读不到就返回 -1，不触发庆祝） */
  function achievementCount() {
    try {
      const st = Store && Store.state;
      if (!st) return -1;
      const a = st.achievements;
      if (!a) return -1;
      if (Array.isArray(a)) return a.length;
      if (Array.isArray(a.unlocked)) return a.unlocked.length;
      if (typeof a === 'object') {
        let n = 0;
        Object.keys(a).forEach((k) => { if (a[k]) n++; });
        return n;
      }
    } catch (e) { /* noop */ }
    return -1;
  }

  function routePath() {
    try {
      return global.UI && global.UI.currentPath ? String(global.UI.currentPath()) : '';
    } catch (e) { return ''; }
  }

  /* ---------------- 视图层转发（js/view-pet.js 负责画） ---------------- */

  function view() { return global.PetView; }
  function callView(name, a, b, c) {
    const v = view();
    if (v && typeof v[name] === 'function') {
      try { return v[name](a, b, c); } catch (e) { return undefined; }
    }
    return undefined;
  }

  /* ---------------- 小工具 ---------------- */

  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }

  function addStat(k, delta) {
    const st = get();
    if (STAT_KEYS.indexOf(k) < 0) return 0;
    const before = st.stats[k];
    st.stats[k] = clamp(st.stats[k] + delta, 0, 100);
    return st.stats[k] - before;
  }

  function setStat(k, v) {
    const st = get();
    if (STAT_KEYS.indexOf(k) < 0) return 0;
    const before = st.stats[k];
    st.stats[k] = clamp(num(v, before, 0, 100), 0, 100);
    return st.stats[k] - before;
  }

  function react(kind, say) { callView('react', kind || 'purr', say || ''); }

  function talk(text, ms) {
    if (!text) return false;
    const st = get();
    st.talkAt = Date.now();
    return !!callView('bubble', String(text), ms);
  }

  function pose(name) {
    const st = get();
    const next = POSES.indexOf(name) >= 0 ? name : POSES[(POSES.indexOf(st.pose) + 1) % POSES.length];
    st.pose = next;
    callView('applyPose');
    save();
    return next;
  }

  /* ---------------- 配色 ---------------- */

  function setCoat(id) {
    const st = get();
    const c = coatOf(id);
    st.coat = c.id;
    save();
    callView('applyCoat');
    return c.id;
  }

  function nextCoat() {
    const st = get();
    const i = COATS.map((c) => c.id).indexOf(st.coat);
    return setCoat(COATS[(i + 1) % COATS.length].id);
  }

  /* ---------------- 画风（写实 / Q 版） ---------------- */

  function setStyle(id) {
    const st = get();
    const s = styleOf(id);
    st.style = s.id;
    save();
    callView('applyStyle');
    callView('place');
    return s.id;
  }

  function nextStyle() {
    const st = get();
    const i = STYLES.map((s) => s.id).indexOf(st.style);
    return setStyle(STYLES[(i + 1) % STYLES.length].id);
  }

  /* ---------------- 表情（随心情值切换） ----------------
     四种表情的判定阈值（自检里就是按这几个数断言的）：
       开心  心情 ≥ 75（睡觉时不摆开心脸）
       困    精力 < 25，或者正在睡觉
       惊讶  刚发生意外事件（打喷嚏 / 突然被戳）之后 4 秒
       好奇  其余时候（默认脸）
  ---------------------------------------------------------------- */

  const MOOD = { HAPPY: 75, SLEEPY: 25, SURPRISE_MS: 4000 };

  function mood() {
    const st = get();
    if (dirty.surpriseUntil && Date.now() < dirty.surpriseUntil) return 'surprised';
    if (isAsleep()) return 'sleepy';
    if (st.stats.energy < MOOD.SLEEPY) return 'sleepy';
    if (st.stats.mood >= MOOD.HAPPY) return 'happy';
    return 'curious';
  }

  /** 惊讶一下（打喷嚏、被突然戳到） */
  function surprise(ms) {
    dirty.surpriseUntil = Date.now() + (ms || MOOD.SURPRISE_MS);
    callView('applyMood');
    return mood();
  }

  function applyMood() {
    const m = mood();
    callView('applyMood', m);
    return m;
  }

  /* ---------------- 显隐 / 收起 ---------------- */

  function applySetting(name, value) {
    const st = get();
    if (name === 'enabled') st.enabled = value !== false;
    else if (name === 'hidden') st.hidden = value === true;
    else if (name === 'coat') st.coat = coatOf(value).id;
    else if (name === 'style') st.style = styleOf(value).id;
    else if (name === 'remindMin') st.remindMin = num(value, 0, 0, 240);
    return true;
  }

  function setEnabled(v) {
    const st = get();
    applySetting('enabled', v);
    save();
    callView('applyVisibility');
    if (st.enabled && !st.hidden) {
      react('happy');
      talk('我来陪你写啦', 3000);
    }
    return st.enabled;
  }

  function setVisible(v) { return setEnabled(v); }
  function isEnabled() { return get().enabled !== false; }

  /** 收起来（长按 3 秒的「取消」/ 设置页的「收起来」） */
  function hide(quiet) {
    const st = get();
    st.hidden = true;
    save();
    callView('applyVisibility');
    if (!quiet) {
      try {
        if (global.UI && global.UI.toast) global.UI.toast('想它了就点设置里的「叫它出来」', 'star');
      } catch (e) { /* noop */ }
    }
    return true;
  }

  /** 叫它出来 */
  function callBack() {
    const st = get();
    st.hidden = false;
    st.enabled = true;
    save();
    callView('applyVisibility');
    callView('place');
    react('happy');
    talk('我回来啦～', 2800);
    return true;
  }

  function isHidden() { return get().hidden === true || get().enabled === false; }

  function open() { return callView('open'); }
  function close() { return callView('closeMenu'); }
  function isMenuOpen() { return !!callView('isMenuOpen'); }

  /* ---------------- 手势（时长 → 行为） ---------------- */

  /**
   * 松手时上报按住时长，返回这一下按的是什么：
   *   { kind: 'tap' | 'menu' | 'hold', ms }
   * 动画与对话框都由这里触发，view 只负责计时与进度反馈。
   */
  function gesture(ms) {
    const t = num(ms, 0, 0, 60000);
    if (t < TAP_MS) { tapReact(); return { kind: 'tap', ms: t }; }
    if (t >= HOLD_MS) return { kind: 'hold', ms: t, dialog: true };
    open();
    return { kind: 'menu', ms: t };
  }

  /** 点一下：随机小反应 + 一点点心情/亲密度 */
  function tapReact() {
    const pool = [
      { kind: 'purr', say: '咕噜咕噜～' },
      { kind: 'happy', say: '喵！' },
      { kind: 'jump', say: '喵呜～' },
      { kind: 'poke', say: '……在写吗？' }
    ];
    const r = pool[Math.floor(Math.random() * pool.length)];
    const st = get();
    st.stats.mood = clamp(st.stats.mood + 1, 0, 100);
    st.stats.bond = clamp(st.stats.bond + 0.5, 0, 100);
    save();
    react(r.kind, r.say);
    callView('syncPanel');
    return r.kind;
  }

  /* ---------------- 长按 3 秒：取消 / 保留 ---------------- */

  function longHoldSheet() {
    const UI = global.UI;
    const msg = '长按 3 秒可以把它收起来，也可以继续陪着你。\n\n'
      + '· 取消：收进小窝（想它了就点设置里的「叫它出来」）\n'
      + '· 保留：什么也不变，它继续蹲在这儿陪你写';
    /* 优先用应用自己的确认框，拿不到就退回 modal 的兜底流程 */
    if (UI && typeof UI.confirm === 'function') {
      return Promise.resolve(UI.confirm('小布偶在打呼噜…', msg, '保留', false))
        .then((keep) => {
          if (keep === true) {
            talk('那我继续陪着你', 2800);
            react('happy');
            callView('syncPanel');
            return { keep: true, hidden: false };
          }
          hide();
          return { keep: false, hidden: true };
        })
        .catch(() => ({ keep: false, hidden: get().hidden }));
    }
    if (UI && typeof UI.modal === 'function') {
      return Promise.resolve(UI.modal({
        title: '小布偶在打呼噜…',
        body: msg,
        buttons: [{ label: '取消', value: 'hide' }, { label: '保留', value: 'keep', primary: true }]
      })).catch(() => null).then((val) => {
        if (val === 'keep') return { keep: true, hidden: false };
        hide();
        return { keep: false, hidden: true };
      });
    }
    return Promise.resolve({ keep: false, hidden: false, noUI: true });
  }

  /* ---------------- 场景小物 ---------------- */

  /** 现在该显示哪些小物（view 按这个结果挂 class） */
  function scene() {
    const st = get();
    const now = Date.now();
    const alive = (t, ms) => t > 0 && now - t < ms;
    return {
      bowl: alive(st.flags.bowl, 90 * 60000),
      bowlEmpty: !!st.flags.bowlEmpty && alive(st.flags.bowl, 90 * 60000),
      ball: alive(st.flags.ball, 20 * 60000),
      bed: isAsleep(now) || alive(st.flags.nap, 25 * 60000),
      board: alive(st.flags.board, 40 * 60000),
      note: !!st.flags.note
    };
  }

  function sceneFlags() { return scene(); }

  function clearScene(what) {
    const st = get();
    if (what === 'all') { st.flags = defFlags(); save(); callView('applyScene'); return true; }
    if (st.flags[what] !== undefined) {
      st.flags[what] = (what === 'bowlEmpty' || what === 'note') ? false : 0;
      save();
      callView('applyScene');
    }
    return true;
  }

  /** 碗空了 → 提示一次「该添粮了」 */
  function checkBowl() {
    const st = get();
    if (!st.flags.bowl || st.flags.bowlEmpty) return false;
    if (Date.now() - st.flags.bowl < 4 * 60000) return false;
    st.flags.bowlEmpty = true;
    save();
    callView('applyScene');
    talk('碗空啦…还有小鱼干吗？', 4200);
    react('hungry');
    return true;
  }

  /* ---------------- 动作菜单 ---------------- */

  function statChange(fn) {
    const st = get();
    const before = { satiety: st.stats.satiety, mood: st.stats.mood, bond: st.stats.bond, energy: st.stats.energy };
    fn(st);
    return changed(before);
  }

  function action(id) {
    const st = get();
    let say = '';
    let diff = [];
    switch (id) {
      case 'pet':          /* 摸摸 */
        diff = statChange(() => { addStat('mood', 8); addStat('bond', 2); addStat('energy', -1); });
        say = '咕噜咕噜～';
        react('pet', say);
        break;
      case 'feed':         /* 喂食：出现猫碗，粮一会儿会空 */
        diff = statChange(() => { addStat('satiety', 24); addStat('bond', 3); addStat('mood', 4); });
        st.flags.bowl = Date.now();
        st.flags.bowlEmpty = false;
        st.lastBowl = Date.now();
        say = '好吃！';
        react('feed', say);
        break;
      case 'play':         /* 玩耍：滚一个毛线球出来 */
        diff = statChange(() => { addStat('mood', 14); addStat('bond', 4); addStat('energy', -12); addStat('satiety', -5); });
        st.flags.ball = Date.now();
        st.lastPlay = Date.now();
        say = '接住啦！';
        react('play', say);
        break;
      case 'sleep':        /* 睡觉：钻进猫窝 */
        st.sleepUntil = Date.now() + NAP_MS;
        st.flags.nap = Date.now();
        diff = statChange(() => { addStat('mood', 2); });
        say = '呼……睡一会儿';
        react('sleep', say);
        break;
      case 'board':        /* 猫抓板 */
        diff = statChange(() => { addStat('mood', 10); addStat('bond', 1); addStat('energy', -4); });
        st.flags.board = Date.now();
        st.lastBoard = Date.now();
        say = '磨磨爪子！';
        react('scratch', say);
        break;
      case 'talk':         /* 说话 */
        say = pickLine(true);
        talk(say, 4200);
        react('talk');
        break;
      case 'pose':         /* 换姿势 */
        pose();
        react('pose', '');
        break;
      case 'coat':         /* 换配色 */
        nextCoat();
        react('happy');
        break;
      case 'focus':        /* 专注 */
        if (st.focusUntil) { stopFocus(); return { id: id, focus: false, stats: st.stats }; }
        return { id: id, focus: true, stats: st.stats };
      case 'hide':         /* 收起来 */
        hide();
        break;
      default:
        return null;
    }
    save();
    callView('applyScene');
    callView('syncPanel');
    callView('syncStats');
    return { id: id, stats: st.stats, changed: diff, say: say };
  }

  /* ---------------- 番茄钟 ---------------- */

  function startFocus(min) {
    const st = get();
    const m = clamp(Math.round(num(min, 25, 1, 600)), 1, 600);
    st.focusMin = m;
    st.focusUntil = Date.now() + m * 60000;
    addStat('mood', 6);
    save();
    callView('focusChanged');
    talk('好，我陪你专注 ' + m + ' 分钟', 3200);
    react('focus');
    return st.focusUntil;
  }

  function stopFocus(silent) {
    const st = get();
    const was = st.focusUntil;
    const done = was && was <= Date.now();
    st.focusUntil = 0;
    if (done) st.focusCount = (st.focusCount || 0) + 1;
    save();
    callView('focusChanged');
    if (!silent) talk(done ? '专注完成，厉害！' : '先休息一下也好', 3000);
    return was;
  }

  function focusLeft(now) {
    const st = get();
    if (!st.focusUntil) return 0;
    return Math.max(0, st.focusUntil - (now === undefined ? Date.now() : now));
  }

  function isFocusing() { return !!get().focusUntil; }

  /* ---------------- 陪伴内容 ---------------- */

  function pickLine(force) {
    const st = get();
    const words = todayWords();
    const pool = [];
    if (!wroteToday()) {
      pool.push('今天还一个字都没写呢');
      pool.push('要不要先写 50 个字？');
    } else if (words > 0) {
      pool.push('今天已经写了 ' + words + ' 字啦');
      pool.push('写了 ' + words + ' 字，继续保持');
    }
    if (st.stats.satiety < 35) pool.push('肚子有点饿了…');
    if (st.stats.energy < 30) pool.push('有点困了，想睡一会儿');
    if (st.stats.mood < 35) pool.push('陪我玩一下好不好');
    if (st.focusUntil) pool.push('专注中，我盯着你哦');
    const days = daysTogether();
    if (days >= 3) pool.push('我们已经一起 ' + days + ' 天啦');
    LINES.forEach((l) => pool.push(l));
    if (!pool.length) return '喵～';
    let i = Math.floor(Math.random() * pool.length);
    if (force && pool[i] === dirty.lastLine && pool.length > 1) i = (i + 1) % pool.length;
    dirty.lastLine = pool[i];
    return pool[i];
  }

  function idleTalk() {
    const st = get();
    if (isHidden() || isMenuOpen() || isFocusing() || isAsleep()) return false;
    const wait = st.remindMin > 0 ? st.remindMin * 60000 : 12 * 60000;
    if (Date.now() - st.talkAt < wait) return false;
    return talk(pickLine(), 4600);
  }

  /** 长时间不写：叼一张小纸条过来（一天一次，写完就不叼了） */
  function maybeNote() {
    const st = get();
    if (isHidden() || isMenuOpen() || isAsleep() || isFocusing()) return false;
    /* 正在写的界面里不打扰：纸条只在「没在写」的时候叼过来 */
    if (/^(article|novel|diary)/.test(routePath())) return false;
    if (st.flags.note || wroteToday()) return false;
    if (Date.now() - st.noteAt < 4 * 3600000) return false;
    if (st.stats.mood < 20 && st.stats.satiety < 20) return false;
    st.flags.note = true;
    st.noteAt = Date.now();
    save();
    callView('applyScene');
    talk('给你叼了张纸条：今天写一句话也好呀', 5200);
    react('note');
    return true;
  }

  /** 写日记的时候蹭一下 */
  function nuzzleDiary() {
    const st = get();
    if (isHidden() || isAsleep()) return false;
    if (Date.now() - st.talkAt < 60000) return false;
    addStat('mood', 3);
    addStat('bond', 1);
    save();
    callView('syncStats');
    callView('syncPanel');
    react('nuzzle', '蹭蹭你～');
    return true;
  }

  /** 成就达成：跳一下庆祝 */
  function checkAchievements() {
    const st = get();
    const n = achievementCount();
    if (n < 0) return false;
    if (st.achCount < 0) { st.achCount = n; save(); return false; }
    if (n <= st.achCount) { st.achCount = n; return false; }
    st.achCount = n;
    addStat('mood', 5);
    addStat('bond', 1);
    save();
    callView('syncStats');
    react('celebrate', '成就达成！好厉害！');
    return true;
  }

  /** 稀有随机事件 */
  function randomEvent() {
    if (isHidden() || isMenuOpen() || isAsleep() || isFocusing()) return false;
    const ev = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
    addStat('mood', 2);
    save();
    if (ev.pose) pose(ev.pose);
    react(ev.kind, ev.say);
    if (ev.kind === 'sneeze' || ev.kind === 'butterfly') surprise();
    return ev.kind;
  }

  /* ---------------- 每秒心跳 ---------------- */

  function onHeartbeat() {
    const st = get();
    const now = Date.now();
    const left = st.focusUntil ? st.focusUntil - now : 0;
    if (st.focusUntil && left <= 0) {
      stopFocus(true);
      talk('专注结束啦，站起来走两步～', 5200);
      react('celebrate');
      addStat('bond', 2);
      addStat('mood', 4);
      save();
    } else if (st.focusUntil) {
      callView('focusTick', left);
    }

    if (!dirty.lastTick || now - dirty.lastTick > 30000) {
      dirty.lastTick = now;
      const r = tick(now);
      if (r.changed.length) { save(); callView('syncStats'); }
      if (r.levelUp) {
        talk('我们升级啦：' + levelOf(st.stats.bond).title, 4600);
        react('celebrate');
        callView('syncPanel');
        callView('applyGrowth');
      }
      if (dirty.sleepDone) {
        dirty.sleepDone = false;
        talk('睡饱啦，精神多了！', 3600);
        callView('applyPose');
        callView('applyScene');
      }
    }

    /* 场景小物：碗空了提示、到期收回 */
    checkBowl();
    const nowScene = JSON.stringify(sceneFlags());
    if (nowScene !== dirty.lastScene) {
      dirty.lastScene = nowScene;
      callView('applyScene');
    }

    /* 表情：心情/精力一变就换脸（表情本身由 view 画） */
    const m = mood();
    if (m !== dirty.lastMood) {
      dirty.lastMood = m;
      callView('applyMood', m);
    }

    /* 陪伴内容：小纸条 / 写日记蹭一下 / 成就庆祝 */
    if (!wroteToday()) maybeNote();
    if (/^diary/.test(routePath()) && Math.random() < 0.1) nuzzleDiary();
    checkAchievements();
  }

  /* ---------------- 位置 ---------------- */

  function viewport() {
    const w = (global.innerWidth || (doc && doc.documentElement.clientWidth) || 360);
    const h = (global.innerHeight || (doc && doc.documentElement.clientHeight) || 640);
    return { w: w, h: h };
  }

  /**
   * 底部的「安全区」：猫不和右下角的浮动按钮、底部标签栏挤在一起。
   * 标签栏是贴底的一条带，右下的浮动按钮（+）则是个小方块，
   * 两者都可能在也可能不在（不同页面不一样），所以每次现算。
   * 结果缓存 2 秒 + 页面变化时清掉，避免每次布局都去查一遍 DOM。
   */
  function avoidRegions() {
    const vp = viewport();
    const now = Date.now();
    if (dirty.avoid && now - dirty.avoidAt < 2000 && dirty.avoid.w === vp.w && dirty.avoid.h === vp.h) {
      return dirty.avoid;
    }
    const out = { maxY: vp.h - PAD, tabTop: vp.h, fab: null, w: vp.w, h: vp.h };
    if (!doc || !doc.getElementById) {
      dirty.avoid = out; dirty.avoidAt = now;
      return out;
    }
    try {
      const tb = doc.getElementById('tabbar');
      if (tb && tb.getBoundingClientRect) {
        const r = tb.getBoundingClientRect();
        if (r.height > 8 && r.top < vp.h) {
          out.tabTop = r.top;
          out.maxY = Math.min(out.maxY, r.top - PAD);
        }
      }
      /* 右下角的浮动按钮：先试几个常见的挂点，再退回到「扫一遍按钮」 */
      let best = null;
      const tryNode = (n) => {
        if (!n || !n.getBoundingClientRect) return;
        const r = n.getBoundingClientRect();
        if (r.width < 34 || r.height < 34) return;
        if (r.bottom < vp.h * 0.5 || r.left < vp.w * 0.45) return;
        if (r.left > vp.w || r.top > vp.h) return;
        if (!best || r.left > best.left) best = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      };
      ['#view .fab', '#view .float-add', '.fab', '[data-fab]', '#view button.btn.primary.block'].forEach((sel) => {
        try { tryNode(doc.querySelector(sel)); } catch (e) { /* noop */ }
      });
      if (!best) {
        const cands = doc.querySelectorAll('#view button, #view a, .tabbar button');
        for (let i = 0; i < cands.length && i < 60; i++) {
          const n = cands[i];
          if (n.closest && (n.closest('#petRoot') || n.closest('.pet-menu'))) continue;
          tryNode(n);
        }
      }
      out.fab = best;
      if (best) out.maxY = Math.min(out.maxY, best.top - PAD);
    } catch (e) { /* 量不到就不避让 */ }
    dirty.avoid = out;
    dirty.avoidAt = now;
    return out;
  }

  /** 界面变了（换页 / 开抽屉）：把避让缓存丢掉，下次重新量 */
  function invalidateAvoid() { dirty.avoid = null; dirty.avoidAt = 0; }

  /** 位置 → 视口里的像素坐标（已夹在安全区内，并避开底部的按钮/标签栏） */
  function layout() {
    const st = get();
    const vp = viewport();
    const sz = size();
    const av = avoidRegions();
    const maxX = Math.max(PAD, vp.w - sz - PAD);
    const maxY = Math.max(TOP_BAR, av.maxY - sz);
    const left = clamp(st.x * vp.w, PAD, maxX);
    let top = clamp(st.y * vp.h, TOP_BAR, maxY);
    /* 万一底部太挤（矮屏），至少也要完整地待在标签栏上面 */
    if (top + sz > av.tabTop - 4) top = Math.max(TOP_BAR, av.tabTop - 4 - sz);
    return {
      left: Math.round(left),
      top: Math.round(top),
      x: vp.w > sz ? clamp(left / vp.w, 0, 1) : 0.5,
      y: vp.h > sz ? clamp(top / vp.h, 0, 1) : 0.5,
      vw: vp.w, vh: vp.h, size: sz, maxY: Math.round(maxY), maxX: Math.round(maxX)
    };
  }

  function place(x, y) {
    const st = get();
    const vp = viewport();
    const sz = size();
    const av = avoidRegions();
    const maxX = Math.max(PAD, vp.w - sz - PAD);
    const maxY = Math.max(TOP_BAR, av.maxY - sz);
    const lx = clamp(num(x, st.x, 0, 1) * vp.w, PAD, maxX);
    const ly = clamp(num(y, st.y, 0, 1) * vp.h, TOP_BAR, maxY);
    st.x = clamp(lx / vp.w, 0, 1);
    st.y = clamp(ly / vp.h, 0, 1);
    st.at = true;
    save();
    callView('place');
    return { x: st.x, y: st.y };
  }

  function goHome() {
    const st = get();
    st.x = DEF.x;
    st.y = DEF.y;
    st.at = false;
    save();
    callView('place');
    talk('我回来啦～', 2600);
    return { x: st.x, y: st.y };
  }

  /* ---------------- 定时器 ---------------- */

  function startTimers() {
    stopTimers();
    Pet._tickTimer = global.setInterval(function () {
      try { onHeartbeat(); } catch (e) { /* 定时器里绝不抛出去 */ }
    }, 1000);
    Pet._idleTimer = global.setInterval(function () {
      try {
        if (Math.random() < 0.16) randomEvent();
        else idleTalk();
      } catch (e) { /* noop */ }
    }, 20000);
  }

  function stopTimers() {
    if (Pet._tickTimer) { try { global.clearInterval(Pet._tickTimer); } catch (e) { /* noop */ } Pet._tickTimer = null; }
    if (Pet._idleTimer) { try { global.clearInterval(Pet._idleTimer); } catch (e) { /* noop */ } Pet._idleTimer = null; }
  }

  function onHidden(isNowHidden) {
    callView('setPaused', !!isNowHidden);
    if (isNowHidden) {
      tick(Date.now());
      save();
      stopTimers();
    } else {
      startTimers();
      const r = tick(Date.now());
      if (r.changed.length) { save(); callView('syncStats'); }
      callView('applyScene');
    }
  }

  /* ---------------- 挂载 ---------------- */

  function mount() {
    if (Pet.mounted) return true;
    load();
    if (!S.bornAt) S.bornAt = Date.now();
    if (S.achCount < 0) S.achCount = achievementCount();
    S.level = levelOf(S.stats.bond).level;
    markDay(Date.now());
    save();
    const ok = !!callView('mount');
    if (!ok) return false;
    Pet.mounted = true;
    startTimers();
    /* 打字互动：全局 input 计数，不做任何逐键布局计算 */
    Pet._onInput = function (e) {
      try {
        const t = e && e.target;
        if (!t) return;
        const tag = (t.tagName || '').toUpperCase();
        const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && /text|search/i.test(t.type || '')) || t.isContentEditable;
        if (!typing) return;
        Pet._keys++;
        if (Pet._keys % 12 === 0 && !isHidden() && !isMenuOpen()) {
          react('type');
          if (Pet._keys % 36 === 0) { addStat('bond', 0.2); save(); }
        }
      } catch (err) { /* noop */ }
    };
    doc.addEventListener('input', Pet._onInput, true);
    Pet._onVis = function () { onHidden(!!doc.hidden); };
    doc.addEventListener('visibilitychange', Pet._onVis);
    Pet._onResize = function () { callView('place'); };
    global.addEventListener('resize', Pet._onResize);
    return true;
  }

  function unmount() {
    if (!Pet.mounted) return false;
    stopTimers();
    try { if (Pet._onInput) doc.removeEventListener('input', Pet._onInput, true); } catch (e) { /* noop */ }
    try { if (Pet._onVis) doc.removeEventListener('visibilitychange', Pet._onVis); } catch (e) { /* noop */ }
    try { if (Pet._onResize) global.removeEventListener('resize', Pet._onResize); } catch (e) { /* noop */ }
    Pet._onInput = null; Pet._onVis = null; Pet._onResize = null;
    callView('unmount');
    Pet.mounted = false;
    return true;
  }

  /** 重置：数值回到出生状态，位置回默认（保留开关 / 相遇时间 / 配色） */
  function reset() {
    const st = get();
    const keep = { bornAt: st.bornAt, dayKey: st.dayKey, enabled: st.enabled, coat: st.coat, style: st.style, remindMin: st.remindMin };
    const fresh = normalize(Object.assign({ updatedAt: Date.now() }, keep));
    Object.keys(S).forEach((k) => { delete S[k]; });
    Object.keys(fresh).forEach((k) => { S[k] = fresh[k]; });
    S.dayKey = keep.dayKey || S.dayKey;
    save();
    callView('applyPose');
    callView('applyCoat');
    callView('applyGrowth');
    callView('applyScene');
    callView('syncStats');
    callView('syncPanel');
    callView('place');
    return snapshot();
  }

  /* ---------------- 对外对象 ---------------- */

  const Pet = {
    version: '2.0.0',
    statKeys: STAT_KEYS,
    statLabels: STAT_LABEL,
    levels: LEVELS,
    coats: function () { return COATS.map((c) => ({ id: c.id, name: c.name, note: c.note, swatch: c.swatch })); },
    styles: function () { return STYLES.map((s) => ({ id: s.id, name: s.name, note: s.note })); },
    style: function () { return styleOf(get().style); },
    coat: function () { return coatOf(get().coat); },
    lines: function () { return LINES.slice(); },
    poses: function () { return POSES.slice(); },
    timings: { tap: TAP_MS, menu: MENU_MS, hold: HOLD_MS, holdArm: HOLD_ARM_MS },
    defaults: function () { return normalize(null); },

    /* 状态 */
    ensure: load,
    get: get,
    snapshot: snapshot,
    save: save,
    stats: function () { return snapshot().stats; },
    normalize: normalize,
    tick: tick,
    refresh: tick,
    changed: changed,
    levelOf: levelOf,
    decorate: decorate,
    size: size,
    daysTogether: daysTogether,
    todayWords: todayWords,
    wroteToday: wroteToday,
    achievementCount: achievementCount,
    isAsleep: isAsleep,
    isFocusing: isFocusing,
    focusLeft: focusLeft,

    /* 动作 */
    action: action,
    react: react,
    talk: talk,
    pose: pose,
    tapReact: tapReact,
    gesture: gesture,
    longHold: longHoldSheet,
    open: open,
    close: close,
    isMenuOpen: isMenuOpen,
    pickLine: pickLine,
    idleTalk: idleTalk,
    maybeNote: maybeNote,
    nuzzleDiary: nuzzleDiary,
    checkAchievements: checkAchievements,
    randomEvent: randomEvent,
    startFocus: startFocus,
    stopFocus: stopFocus,
    addStat: addStat,
    setStat: setStat,
    setCoat: setCoat,
    nextCoat: nextCoat,
    setStyle: setStyle,
    nextStyle: nextStyle,
    setEnabled: setEnabled,
    setVisible: setVisible,
    isEnabled: isEnabled,
    setHidden: hide,
    hide: hide,
    callBack: callBack,
    isHidden: isHidden,
    applySetting: applySetting,
    scene: scene,
    sceneFlags: sceneFlags,
    clearScene: clearScene,
    checkBowl: checkBowl,
    mood: mood,
    applyMood: applyMood,
    surprise: surprise,
    moodLevels: MOOD,
    avoidRegions: avoidRegions,
    invalidateAvoid: invalidateAvoid,
    place: place,
    layout: layout,
    goHome: goHome,
    reset: reset,

    /* 生命周期 */
    mount: mount,
    unmount: unmount,
    mounted: false,
    startTimers: startTimers,
    stopTimers: stopTimers,
    onHidden: onHidden,
    heartbeat: onHeartbeat,
    _keys: 0,
    _tickTimer: null,
    _idleTimer: null
  };

  global.Pet = Pet;

  /* 打开就启动：Store.init() 是异步的，等它就绪后挂载（最多等 20 秒） */
  let tries = 0;
  function boot() {
    try {
      load();
      const ready = !!(Store && Store.state && Store.state.settings);
      if (!ready) {
        if (tries++ < 100) global.setTimeout(boot, 200);
        return;
      }
      mount();
    } catch (e) {
      if (global.console && console.error) console.error('[pet]', e);
    }
  }

  if (doc && doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  Pet._boot = boot;
})(window);
