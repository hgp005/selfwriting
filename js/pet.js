/* ==========================================================================
   ⚠ 桌宠（已停用：任务取消，文件保留，若要启用请把 index.html / sw.js 里的引用加回去）
   selfwriting · pet.js
   小陪伴桌宠：一只布偶猫（全部用内联 SVG 画出来，不联网、不打包图片）

   设计要点
     · 状态存在 Store.state.settings.pet 里（跟着整库备份一起走），
       读取一律「缺字段 → 默认值」，老数据 / 手改过的数据都不会炸。
     · 数值按真实时间衰减：只记 updatedAt，用 Date.now() 的差值算，
       所以关掉应用三天再打开，猫是真的饿了。
     · 不抢触摸：只有 76×76 的猫本身接收指针事件，其余区域全部穿透。
     · 省电：整只猫只有 1 个 1 秒定时器 + 1 个空闲小动作定时器；
       页面切到后台（document.hidden）时动画与定时器一起停。
     · 不发明 API：Stats / Store / UI / Achievements 全部 try/catch 兜底，
       任何一个缺失都只影响对应的小功能，不会让应用挂掉。

   对外接口（window.Pet）：
     mount() / unmount() / refresh() / tick(now) / stats() / changed(before)
     talk(text) / react(kind) / open() / close() / action(id) / setVisible(v)
     startFocus(min) / stopFocus() / reset() / levelOf(bond) / lines()
   ========================================================================== */
(function (global) {
  'use strict';

  const Store = global.Store;
  const doc = global.document;

  /* ---------------- 常量 ---------------- */

  const DEF = {
    enabled: true,        // 桌宠总开关
    x: 0.86, y: 0.74,     // 位置（视口比例，左下角为原点坐标系里的左上角）
    at: false,            // 用户是否亲手挪过（没挪过就跟着屏幕尺寸重新算）
    stats: null,          // { satiety, mood, bond, energy }
    updatedAt: 0,
    pose: 'sit',          // sit | lie | stretch | back
    bornAt: 0,            // 相遇时间（用来算陪伴天数）
    focusUntil: 0,        // 番茄钟结束时间戳
    focusMin: 0,          // 本次番茄钟选择的分钟数
    focusCount: 0,        // 累计完成的番茄钟
    slept: 0,             // 睡过几次
    talkAt: 0,            // 上次主动说话的时间
    remindMin: 0,         // 陪伴提示间隔（分钟），0 = 自动
    seen: 0               // 累计陪伴天数计数（按天去重）
  };

  const STAT_KEYS = ['satiety', 'mood', 'bond', 'energy'];
  const STAT_LABEL = { satiety: '饱食度', mood: '心情', bond: '亲密度', energy: '精力' };

  /* 每小时自然衰减：饿得最快，亲密度几乎不掉 */
  const DECAY = { satiety: 7, mood: 4, bond: 0.2, energy: 1 };
  const DECAY_MS = 3600000;
  const MAX_ELAPSED = 30 * 24 * DECAY_MS;   // 离线再久也只按 30 天算
  const NAP_MS = 11 * 60000;                // 睡一觉的时长（11 分钟，正好一个短番茄）
  const SIZE = 76;                          // 猫的点击区（px）
  const PAD = 8;                            // 距屏幕边缘的安全距离
  const TOP_BAR = 92;                       // 不遮挡顶部栏

  /* 亲密度等级：小奶猫 → …… → 一生之友 */
  const LEVELS = [
    { min: 0, title: '小奶猫' },
    { min: 20, title: '小布偶' },
    { min: 45, title: '布偶猫' },
    { min: 70, title: '猫伙伴' },
    { min: 90, title: '老友猫' }
  ];
  const TITLES = ['写作搭子', '陪写员', '老友', '一生之友'];

  const POSES = ['sit', 'lie', 'stretch', 'back'];

  /* 陪伴提示（气泡里的轮播文案） */
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

  /* 点猫（不选菜单里的动作）时的随机反应 */
  const REACTS = [
    { kind: 'purr', pose: 'sit', say: '咕噜咕噜～' },
    { kind: 'happy', pose: 'sit', say: '喵！' },
    { kind: 'jump', pose: 'sit', say: '喵呜～' },
    { kind: 'poke', pose: 'sit', say: '……在写吗？' }
  ];

  /* 稀有随机事件 */
  const RANDOM_EVENTS = [
    { kind: 'chase', pose: 'stretch', say: '尾巴！抓到你了！' },
    { kind: 'sneeze', pose: 'sit', say: '阿嚏！' },
    { kind: 'butterfly', pose: 'stretch', say: '蝴蝶！' }
  ];

  /* ---------------- 状态读写 ---------------- */

  let S = null;           // 当前宠物状态（Store.state.settings.pet 的引用）
  const dirty = { timers: false };

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

  function normStats(raw) {
    const out = defStat();
    if (raw && typeof raw === 'object') {
      STAT_KEYS.forEach((k) => { if (raw[k] !== undefined) out[k] = num(raw[k], out[k], 0, 100); });
    }
    return out;
  }

  /** 把外部数据规整成一份完整、合法的宠物状态（缺什么补什么） */
  function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const now = Date.now();
    const out = {
      enabled: r.enabled !== false,
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
      dayKey: typeof r.dayKey === 'string' ? r.dayKey : ''
    };
    if (!out.updatedAt) out.updatedAt = now;
    /* 相遇时间不可能在未来 */
    if (out.bornAt > now) out.bornAt = now;
    return out;
  }

  /** 读一份浅拷贝，给界面用（界面绝不直接改这份对象） */
  function snapshot() {
    return {
      enabled: S.enabled,
      x: S.x, y: S.y, at: S.at,
      pose: S.pose,
      stats: { satiety: S.stats.satiety, mood: S.stats.mood, bond: S.stats.bond, energy: S.stats.energy },
      updatedAt: S.updatedAt,
      bornAt: S.bornAt,
      focusUntil: S.focusUntil,
      focusMin: S.focusMin,
      focusCount: S.focusCount,
      slept: S.slept,
      talkAt: S.talkAt
    };
  }

  /** 只读当前状态（界面渲染用，不要改它） */
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
   * 按真实时间推进状态：用「上次结算时间 → 现在」的差值算，
   * 应用关掉多久都算得对。返回各数值的变化量（用来判断要不要弹提示）。
   */
  function tick(now) {
    const st = get();
    const t = now === undefined ? Date.now() : now;
    const elapsed = Math.min(Math.max(0, t - st.updatedAt), MAX_ELAPSED);
    const before = { satiety: st.stats.satiety, mood: st.stats.mood, bond: st.stats.bond, energy: st.stats.energy };

    /* 睡觉中：精力回血、肚子也会饿，但掉得慢 */
    const awake = st.sleepUntil && st.sleepUntil > t ? 0.25 : 1;
    const hours = elapsed / DECAY_MS;
    if (hours > 0) {
      st.stats.satiety = num(st.stats.satiety - DECAY.satiety * hours * awake, 0, 0, 100);
      st.stats.mood = num(st.stats.mood - DECAY.mood * hours * awake, 0, 0, 100);
      st.stats.bond = num(st.stats.bond - DECAY.bond * hours, 0, 0, 100);
      if (awake === 1) st.stats.energy = num(st.stats.energy - DECAY.energy * hours, 0, 0, 100);
      else st.stats.energy = num(st.stats.energy + 14 * hours, 0, 0, 100);
    }

    /* 睡醒了 */
    if (st.sleepUntil && st.sleepUntil <= t) {
      st.sleepUntil = 0;
      st.slept = (st.slept || 0) + 1;
      st.stats.energy = num(st.stats.energy + 18, 0, 0, 100);
      st.stats.mood = num(st.stats.mood + 4, 0, 0, 100);
      dirty.sleepDone = true;
    }

    st.updatedAt = t;
    /* 陪伴天数：每天第一次打开记一次 */
    markDay(t);

    return { before: before, elapsed: elapsed, changed: changed(before) };
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
    }
  }

  /** 陪伴天数（今天也算一天） */
  function daysTogether() {
    const st = get();
    try {
      if (global.U && global.U.dayDiff && global.U.dateKey) {
        const n = global.U.dayDiff(global.U.dateKey(new Date(st.bornAt)), global.U.dateKey());
        return Math.max(1, num(n, 0, 0, 99999) + 1);
      }
    } catch (e) { /* 落到下面的兜底 */ }
    return Math.max(1, Math.round((Date.now() - st.bornAt) / 86400000) + 1);
  }

  /* ---------------- 等级 ---------------- */

  function levelOf(bond) {
    const b = num(bond, 0, 0, 100);
    let idx = 0;
    for (let i = 0; i < LEVELS.length; i++) if (b >= LEVELS[i].min) idx = i;
    const next = LEVELS[idx + 1] || null;
    const from = LEVELS[idx].min;
    const to = next ? next.min : 100;
    const pct = to > from ? Math.min(1, Math.max(0, (b - from) / (to - from))) : 1;
    return { level: idx + 1, title: LEVELS[idx].title, next: next ? next.title : '', need: next ? Math.ceil(next.min - b) : 0, pct: pct };
  }

  function decorate() {
    const st = get();
    const lv = levelOf(st.stats.bond);
    const title = lv.level <= 2 ? '小布偶' : TITLES[Math.min(TITLES.length - 1, lv.level - 3)];
    return { level: lv.level, levelTitle: lv.title, title: title, days: daysTogether() };
  }

  /* ---------------- 与应用的其它模块打交道（全部兜底） ---------------- */

  function todayWords() {
    try {
      if (global.Stats && typeof global.Stats.today === 'function' && Store && Store.state) {
        const d = global.Stats.today(Store.state);
        if (d && isFinite(d.words)) return Math.max(0, Math.round(d.words));
      }
    } catch (e) { /* 下面兜底 */ }
    try {
      const daily = Store && Store.state && Store.state.stats && Store.state.stats.daily;
      if (daily && global.U && global.U.dateKey) {
        const d = daily[global.U.dateKey()];
        if (d && isFinite(d.words)) return Math.max(0, Math.round(d.words));
      }
    } catch (e) { /* 读不到就当 0 */ }
    return 0;
  }

  /** 今天到底写没写（读不到统计就说「写了」，免得乱催） */
  function wroteToday() {
    try {
      const daily = Store && Store.state && Store.state.stats && Store.state.stats.daily;
      if (!daily || !global.U || !global.U.dateKey) return true;
      const d = daily[global.U.dateKey()];
      if (!d) return false;
      return (num(d.words, 0) > 0) || (num(d.ms, 0) > 60000);
    } catch (e) { return true; }
  }

  /* ---------------- 视图层（js/view-pet.js 负责画） ---------------- */

  function view() { return global.PetView; }
  function callView(name, a, b, c) {
    const v = view();
    if (v && typeof v[name] === 'function') {
      try { return v[name](a, b, c); } catch (e) { return undefined; }
    }
    return undefined;
  }

  /* ---------------- 对外动作 ---------------- */

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

  function pushStat(key, delta, kind, say) {
    const before = { satiety: S.stats.satiety, mood: S.stats.mood, bond: S.stats.bond, energy: S.stats.energy };
    addStat(key, delta);
    const diff = changed(before);
    react(kind, say);
    save();
    callView('syncPanel');
    return diff;
  }

  /** 换姿势 */
  function pose(name) {
    const st = get();
    const next = POSES.indexOf(name) >= 0 ? name : POSES[(POSES.indexOf(st.pose) + 1) % POSES.length];
    st.pose = next;
    callView('applyPose');
    save();
    return next;
  }

  /** 猫的反应动画（爱心 / 打呼噜 / 蹦一下 / 甩尾巴…） */
  function react(kind, say) {
    callView('react', kind || 'purr', say || '');
  }

  /** 说一句话（气泡）。ms 不传就用默认时长 */
  function talk(text, ms) {
    if (!text) return false;
    const st = get();
    st.talkAt = Date.now();
    return !!callView('bubble', String(text), ms);
  }

  function open() { return callView('open'); }
  function close() { return callView('closeMenu'); }
  function isMenuOpen() { return !!callView('isMenuOpen'); }

  /* ---------------- 番茄钟 ---------------- */

  function startFocus(min) {
    const st = get();
    const m = clamp(Math.round(num(min, 25, 1, 600)), 1, 600);
    st.focusMin = m;
    st.focusUntil = Date.now() + m * 60000;
    st.stats.mood = clamp(st.stats.mood + 6, 0, 100);
    save();
    callView('focusChanged');
    callView('bubble', '好，我陪你专注 ' + m + ' 分钟', 3200);
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
    if (!silent) callView('bubble', done ? '专注完成，厉害！' : '先休息一下也好', 3000);
    return was;
  }

  function focusLeft(now) {
    const st = get();
    if (!st.focusUntil) return 0;
    return Math.max(0, st.focusUntil - (now === undefined ? Date.now() : now));
  }

  /** 每秒的心跳：跑番茄钟倒计时；顺便做低频的状态结算 */
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
    /* 状态每 30 秒结算一次即可，没必要每秒写盘 */
    if (!dirty.lastTick || now - dirty.lastTick > 30000) {
      dirty.lastTick = now;
      const r = tick(now);
      if (r.changed.length) { save(); callView('syncStats'); }
      if (dirty.sleepDone) {
        dirty.sleepDone = false;
        talk('睡饱啦，精神多了！', 3600);
        callView('applyPose');
      }
    }
  }

  /* ---------------- 拖拽：位置 ---------------- */

  function viewport() {
    const w = (global.innerWidth || (doc && doc.documentElement.clientWidth) || 360);
    const h = (global.innerHeight || (doc && doc.documentElement.clientHeight) || 640);
    return { w: w, h: h };
  }

  /** 位置 → 视口里的像素坐标（已夹在安全区内） */
  function layout() {
    const st = get();
    const vp = viewport();
    const maxX = Math.max(PAD, vp.w - SIZE - PAD);
    const maxY = Math.max(TOP_BAR, vp.h - SIZE - PAD);
    const left = clamp(st.x * vp.w, PAD, maxX);
    const top = clamp(st.y * vp.h, TOP_BAR, maxY);
    return {
      left: Math.round(left),
      top: Math.round(top),
      x: vp.w > SIZE ? clamp(left / vp.w, 0, 1) : 0.5,
      y: vp.h > SIZE ? clamp(top / vp.h, 0, 1) : 0.5,
      vw: vp.w, vh: vp.h, size: SIZE
    };
  }

  /** 拖拽结束后把比例坐标夹回视口内并落盘 */
  function place(x, y) {
    const st = get();
    const vp = viewport();
    const maxX = Math.max(PAD, vp.w - SIZE - PAD);
    const maxY = Math.max(TOP_BAR, vp.h - SIZE - PAD);
    const lx = clamp(num(x, st.x, 0, 1) * vp.w, PAD, maxX);
    const ly = clamp(num(y, st.y, 0, 1) * vp.h, TOP_BAR, maxY);
    st.x = clamp(lx / vp.w, 0, 1);
    st.y = clamp(ly / vp.h, 0, 1);
    st.at = true;
    save();
    callView('place');
    return { x: st.x, y: st.y };
  }

  /** 回家：右下角默认位 */
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

  /* ---------------- 显隐 / 开关 ---------------- */

  function setEnabled(v) {
    const st = get();
    st.enabled = v !== false;
    save();
    callView('applyVisibility');
    if (st.enabled) {
      react('happy');
      talk('我来陪你写啦', 3000);
    }
    return st.enabled;
  }

  function setVisible(v) { return setEnabled(v); }
  function isEnabled() { return get().enabled !== false; }

  /* ---------------- 动作菜单的行为 ---------------- */

  function action(id) {
    const st = get();
    const before = { satiety: st.stats.satiety, mood: st.stats.mood, bond: st.stats.bond, energy: st.stats.energy };
    let say = '';
    switch (id) {
      case 'pet':          /* 摸摸 */
        addStat('mood', 8); addStat('bond', 2); addStat('energy', -1);
        say = '咕噜咕噜～';
        react('pet', say);
        break;
      case 'feed':         /* 喂食 */
        addStat('satiety', 22); addStat('bond', 3); addStat('mood', 4);
        say = '好吃！';
        react('feed', say);
        break;
      case 'play':         /* 玩耍 */
        addStat('mood', 14); addStat('bond', 4); addStat('energy', -12); addStat('satiety', -5);
        say = '接住啦！';
        react('play', say);
        break;
      case 'sleep':        /* 睡觉 */
        st.sleepUntil = Date.now() + NAP_MS;
        addStat('mood', 2);
        say = '呼……睡一会儿';
        react('sleep', say);
        break;
      case 'talk':         /* 说话 */
        say = pickLine(true);
        talk(say, 4200);
        react('talk');
        break;
      case 'pose':         /* 换姿势 */
        pose();
        react('pose');
        break;
      case 'focus':        /* 专注 */
        if (st.focusUntil) { stopFocus(); return { id: id, focus: false, stats: st.stats }; }
        return { id: id, focus: true, stats: st.stats };
      case 'hide':         /* 隐藏 */
        setEnabled(false);
        break;
      default:
        return null;
    }
    save();
    callView('syncPanel');
    callView('syncStats');
    return { id: id, before: before, stats: st.stats, changed: changed(before), say: say };
  }

  /* ---------------- 陪伴提示 / 随机事件 ---------------- */

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

  /** 到点说一句话（间隔可配，默认 12 分钟，太久没写会催） */
  function idleTalk() {
    const st = get();
    if (!isEnabled() || isMenuOpen() || isFocusing()) return false;
    if (isAsleep()) return false;
    const wait = st.remindMin > 0 ? st.remindMin * 60000 : 12 * 60000;
    if (Date.now() - st.talkAt < wait) return false;
    return talk(pickLine(), 4600);
  }

  function isFocusing() { return !!get().focusUntil; }

  /** 稀有随机事件 */
  function randomEvent() {
    if (!isEnabled() || isMenuOpen() || isAsleep() || isFocusing()) return false;
    const ev = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
    addStat('mood', 2);
    save();
    if (ev.pose) pose(ev.pose);
    react(ev.kind, ev.say);
    return ev.kind;
  }

  /* ---------------- 定时器 ---------------- */

  function startTimers() {
    stopTimers();
    dirty.timers = true;
    /* 每秒：番茄钟倒计时 + 低频状态结算（页面隐藏时会停掉） */
    Pet._tickTimer = global.setInterval(function () {
      try { onHeartbeat(); } catch (e) { /* 定时器里绝不抛出去 */ }
    }, 1000);
    /* 每 20 秒一次小概率：陪伴提示 / 随机事件 */
    Pet._idleTimer = global.setInterval(function () {
      try {
        if (Math.random() < 0.16) randomEvent();
        else idleTalk();
      } catch (e) { /* noop */ }
    }, 20000);
  }

  function stopTimers() {
    dirty.timers = false;
    if (Pet._tickTimer) { try { global.clearInterval(Pet._tickTimer); } catch (e) { /* noop */ } Pet._tickTimer = null; }
    if (Pet._idleTimer) { try { global.clearInterval(Pet._idleTimer); } catch (e) { /* noop */ } Pet._idleTimer = null; }
  }

  /** 页面隐藏：停定时器 + 记一次时间，回前台再补算 */
  function onHidden(hidden) {
    callView('setPaused', !!hidden);
    if (hidden) {
      tick(Date.now());
      save();
      stopTimers();
    } else {
      startTimers();
      const r = tick(Date.now());
      if (r.changed.length) { save(); callView('syncStats'); }
    }
  }

  /* ---------------- 挂载 ---------------- */

  function mount() {
    if (Pet.mounted) return true;
    load();
    if (!S.bornAt) S.bornAt = Date.now();
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
        const typing = tag === 'TEXTAREA' || tag === 'INPUT' && /text|search/i.test(t.type || '') || t.isContentEditable;
        if (!typing) return;
        Pet._keys++;
        if (Pet._keys % 12 === 0 && isEnabled() && !isMenuOpen()) {
          react('type');
          if (Pet._keys % 36 === 0) addStat('bond', 0.2);
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

  /** 重置：数值回到出生状态，位置回右下角（保留开关与相遇时间） */
  function reset() {
    const st = get();
    const born = st.bornAt;
    const dayKey = st.dayKey;
    const fresh = normalize({ bornAt: born, updatedAt: Date.now(), enabled: st.enabled, remindMin: st.remindMin });
    Object.keys(S).forEach((k) => { delete S[k]; });
    Object.keys(fresh).forEach((k) => { S[k] = fresh[k]; });
    S.bornAt = born;
    S.dayKey = dayKey || S.dayKey;
    save();
    callView('applyPose');
    callView('syncStats');
    callView('syncPanel');
    callView('place');
    return snapshot();
  }

  /* ---------------- 对外对象 ---------------- */

  const Pet = {
    /* 元信息（自检与界面共用） */
    version: '1.0.0',
    size: SIZE,
    statKeys: STAT_KEYS,
    statLabels: STAT_LABEL,
    levels: LEVELS,
    lines: function () { return LINES.slice(); },
    poses: function () { return POSES.slice(); },
    defaults: function () { return normalize(null); },

    /* 状态 */
    ensure: load,
    get: get,
    snapshot: snapshot,
    save: save,
    stats: function () { return snapshot().stats; },    normalize: normalize,
    tick: tick,
    refresh: tick,                 // 别名：结算一次到当前时间
    changed: changed,
    levelOf: levelOf,
    decorate: decorate,
    daysTogether: daysTogether,
    todayWords: todayWords,
    wroteToday: wroteToday,
    isAsleep: isAsleep,
    isFocusing: isFocusing,
    focusLeft: focusLeft,

    /* 动作 */
    action: action,
    react: react,
    talk: talk,
    pose: pose,
    open: open,
    close: close,
    isMenuOpen: isMenuOpen,
    pickLine: pickLine,
    idleTalk: idleTalk,
    randomEvent: randomEvent,
    startFocus: startFocus,
    stopFocus: stopFocus,
    addStat: addStat,
    setStat: setStat,
    place: place,
    layout: layout,
    goHome: goHome,
    setEnabled: setEnabled,
    setVisible: setVisible,
    isEnabled: isEnabled,
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
      /* 桌宠失败绝不影响应用本体 */
      if (global.console && console.error) console.error('[pet]', e);
    }
  }

  if (doc && doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* 供自检使用 */
  Pet._boot = boot;
})(window);
