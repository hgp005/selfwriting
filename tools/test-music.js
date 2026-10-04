/* ==========================================================================
   selfwriting · tools/test-music.js
   音乐模块专项验证（开发用，不属于应用本体）：
     · 乐器表：至少 钢琴 / 电钢琴 / 吉他 / 贝斯 / 鼓组
     · 钢琴键：14 白键 + 10 黑键（自动化契约）
     · 换乐器：吉他 / 贝斯 指板、鼓组打击垫都能弹
     · 试音台 #/music/lab：1 选乐器 · 2 弹一弹 · 3 调音色 + 电平表 + 示例
     · 谱曲：#/music/compose ≥200 格、点一下能落盘
     · 歌词：#/music/lyrics 存进 songs[0].lyrics
     · 键盘触发与鼓垫触发都有 lastEvent()，且没有控制台报错
     · 吉他「点一下响个不停」的回归：延迟线定长、环路增益 < 1、
       每条音有寿命上限，4 秒内必须自己归零
     · stopAll() 立刻静音；换乐器 / 离开音乐页也会收掉旧音
     · 总线里真的接上了卷积混响 + 压缩 + 限制（debug().audio 报节点）

   用法： node tools/test-music.js [port]
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const { launch, Page, findEdge, sleep } = require('./driver');

const PORT = process.argv[2] || '8099';
const BASE = 'http://127.0.0.1:' + PORT + '/';

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log('PASS  ' + name);
  } else {
    failed++;
    console.log('FAIL  ' + name + (detail ? '\n        ↳ ' + String(detail).slice(0, 600) : ''));
  }
}

/* 页面里用的小工具：逐个 UI.go 切换并等待渲染 + 现场构造最小 MIDI 字节 */
const HELPERS = `
  window.__t = {
    rowsOn: function () {
      var s = (window.Store.state.settings.songs || [])[0] || {};
      var n = 0;
      (s.rows || []).forEach(function (r) { r.forEach(function (v) { if (v) n++; }); });
      return n;
    },
    go: async function (path, ms) {
      window.UI.go(path);
      await new Promise(function (r) { setTimeout(r, ms || 650); });
      return window.UI.currentPath();
    },
    /* ---- 现场造 MIDI 字节（测试用，不依赖任何外部文件） ---- */
    vlq: function (n) {
      var out = [n & 0x7f];
      n >>= 7;
      while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; }
      return out;
    },
    track: function (events) {
      var body = [];
      events.forEach(function (e) { body = body.concat(window.__t.vlq(e[0]), e[1]); });
      var len = body.length;
      return [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255].concat(body);
    },
    midiBytes: function (tracks, division, format) {
      var head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format || 0, 0, tracks.length,
        ((division || 480) >> 8) & 255, (division || 480) & 255];
      var out = head;
      tracks.forEach(function (t) { out = out.concat(t); });
      return new Uint8Array(out);
    },
    /* 一段最小可播 MIDI：120BPM + 钢琴 + 3 个音（E4 用 velocity=0 收尾） */
    midiBasic: function () {
      return window.__t.midiBytes([window.__t.track([
        [0, [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]],
        [0, [0xc0, 0x00]],
        [0, [0x90, 0x3c, 0x64]],
        [480, [0x80, 0x3c, 0x40]],
        [0, [0x90, 0x40, 0x50]],
        [480, [0x90, 0x40, 0x00]],
        [0, [0x90, 0x43, 0x64]],
        [960, [0x80, 0x43, 0x40]],
        [0, [0xff, 0x2f, 0x00]]
      ])], 480, 0);
    }
  };
  'ready';
`;

(async () => {
  let browser = null;
  let page = null;
  try {
    browser = await launch({});
    page = await Page.open(browser, BASE);
    await page.freshCache();
    await page.hardGoto(BASE);
    await sleep(1200);

    /* 等应用把自己启动起来 */
    const boot = await page.eval('!!(window.UI && window.Store && window.U && window.MusicKit)');
    if (!boot) {
      const txt = await page.text();
      throw new Error('应用没启动完（UI/Store/U/MusicKit 缺失）页面文本：' + String(txt).slice(0, 200));
    }
    await page.call(HELPERS);

    const info = await page.eval('JSON.stringify(window.MusicKit.instrumentInfo())');
    console.log('乐器表：' + info);
    console.log('运行环境：' + String(await page.eval('navigator.userAgent')).slice(0, 90));

    /* ---------------- 1. 乐器表 ---------------- */
    const listRes = await page.eval(`JSON.stringify({
      ids: window.MusicKit.instruments(),
      labels: window.MusicKit.labels(),
      current: window.MusicKit.current(),
      debug: window.MusicKit.debug()
    })`);
    const listObj = JSON.parse(String(listRes));
    const wantLabels = ['钢琴', '电钢琴', '吉他', '贝斯', '鼓组'];
    const missing = wantLabels.filter((l) => listObj.labels.indexOf(l) < 0);
    check('乐器表：至少包含 钢琴/电钢琴/吉他/贝斯/鼓组（实际 ' + listObj.labels.join('、') + '）',
      missing.length === 0 && listObj.ids.length >= 5, listRes);

    /* ---------------- 2. 钢琴键 14 + 10 ---------------- */
    const pianoRes = await page.call(`
      await window.__t.go('music', 700);
      var w = document.querySelectorAll('#view .pkey-w').length;
      var b = document.querySelectorAll('#view .pkey-b').length;
      var board = document.querySelector('#view .piano-board');
      var bw = board ? board.getBoundingClientRect() : null;
      var firstW = document.querySelector('#view .pkey-w');
      var fw = firstW ? firstW.getBoundingClientRect() : null;
      var txt = (document.getElementById('view') || {}).innerText || '';
      return JSON.stringify({
        w: w, b: b, boardW: bw ? Math.round(bw.width) : 0,
        boardH: bw ? Math.round(bw.height) : 0,
        keyW: fw ? Math.round(fw.width) : 0,
        named: document.querySelectorAll('#view .pkey-w .kl').length,
        mapped: document.querySelectorAll('#view .pkey .kc').length,
        inst: window.MusicKit.current(),
        sustain: !!document.querySelector('#view [data-sustain]'),
        hasOct: /八度/.test(txt),
        keys: /电脑键盘/.test(txt)
      });
    `);
    const piano = JSON.parse(String(pianoRes));
    check('#/music 渲染 14 白键 + 10 黑键',
      piano.w === 14 && piano.b === 10, pianoRes);
    check('钢琴键：有真实尺寸、音名、电脑键盘映射、八度与延音按钮',
      piano.boardW > 100 && piano.boardH >= 140 && piano.keyW > 8 && piano.named === 14 &&
      piano.mapped >= 13 && piano.sustain && piano.hasOct && piano.keys, pianoRes);

    /* ---------------- 3. 换乐器后的可弹表面 ---------------- */
    /* 吉他：先回到钢琴键页（选择条只在键盘类乐器上出现），再点「吉他」按钮 */
    const guitarRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music', 650);
      var chip = document.querySelector('#view .inst-chip[data-inst="guitar"]');
      if (chip) { chip.click(); await new Promise(function (r) { setTimeout(r, 550); }); }
      var cells = document.querySelectorAll('#view .fret-cell').length;
      var rows = document.querySelectorAll('#view .fret-row').length;
      var strings = document.querySelectorAll('#view .fret-string').length;
      var txt = (document.getElementById('view') || {}).innerText || '';
      var used = window.MusicKit.current();
      var ev = null;
      if (cells > 0) {
        document.querySelectorAll('#view .fret-cell')[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        ev = window.MusicKit.lastEvent();
      }
      return JSON.stringify({
        chip: !!chip, cells: cells, rows: rows, strings: strings,
        inst: used, hasHint: /品|弦/.test(txt),
        ev: ev ? { instrument: ev.instrument, midi: ev.midi, voices: ev.voices } : null
      });
    `);
    const guitar = JSON.parse(String(guitarRes));
    check('吉他：指板 ≥20 个可弹格（6 弦 × 5 品）',
      guitar.cells >= 20 && guitar.strings === 6 && guitar.inst === 'guitar', guitarRes);

    const bassRes = await page.call(`
      var chip = document.querySelector('#view .inst-chip[data-inst="bass"]');
      if (chip) { chip.click(); await new Promise(function (r) { setTimeout(r, 550); }); }
      var cells = document.querySelectorAll('#view .fret-cell').length;
      var strings = document.querySelectorAll('#view .fret-string').length;
      return JSON.stringify({ chip: !!chip, cells: cells, strings: strings, inst: window.MusicKit.current() });
    `);
    const bass = JSON.parse(String(bassRes));
    check('贝斯：指板 ≥16 个可弹格（4 弦 × 5 品）',
      bass.cells >= 16 && bass.strings === 4 && bass.inst === 'bass', bassRes);

    const drumRes = await page.call(`
      var chip = document.querySelector('#view .inst-chip[data-inst="drums"]');
      if (chip) { chip.click(); await new Promise(function (r) { setTimeout(r, 550); }); }
      var pads = document.querySelectorAll('#view .drum-pad').length;
      var want = ['kick', 'snare', 'hat', 'hatOpen', 'tom', 'crash'];
      var have = Array.prototype.slice.call(document.querySelectorAll('#view .drum-pad'))
        .map(function (p) { return p.getAttribute('data-pad'); });
      var miss = want.filter(function (w) { return have.indexOf(w) < 0; });
      var first = document.querySelector('#view .drum-pad');
      var h = first ? Math.round(first.getBoundingClientRect().height) : 0;
      return JSON.stringify({ chip: !!chip, pads: pads, have: have, missing: miss, padH: h, inst: window.MusicKit.current() });
    `);
    const drums = JSON.parse(String(drumRes));
    check('鼓组：≥8 个打击垫（含底鼓/军鼓/闭镲/开镲/桶鼓/吊镲），垫子高度 ≥60px',
      drums.pads >= 8 && drums.missing.length === 0 && drums.padH >= 60 && drums.inst === 'drums', drumRes);

    /* ---------------- 4. 触发：键盘 + 鼓垫都记录 lastEvent，且无报错 ---------------- */
    const triggerRes = await page.call(`
      var errs = [];
      var onErr = function (e) { errs.push(String(e.message || e)); };
      window.addEventListener('error', onErr);
      var out = {};

      /* 钢琴：点一个白键（pointerdown，走真实交互） */
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music', 650);
      var key = document.querySelector('#view .pkey-w[data-midi]');
      var midi = key ? Number(key.getAttribute('data-midi')) : null;
      if (key) key.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      var e1 = window.MusicKit.lastEvent();
      out.piano = { midi: midi, down: key ? key.classList.contains('down') : false, ev: e1 };

      /* 鼓：点第一个鼓垫 */
      window.MusicKit.setInstrument('drums');
      await window.__t.go('music', 650);
      var pad = document.querySelector('#view .drum-pad[data-pad]');
      var padId = pad ? pad.getAttribute('data-pad') : null;
      if (pad) pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      var e2 = window.MusicKit.lastEvent();
      out.drum = { pad: padId, hit: pad ? pad.classList.contains('hit') : false, ev: e2 };

      /* 直接 API：不能因为无音频环境而抛错 */
      window.MusicKit.setInstrument('piano');
      var r1 = window.MusicKit.play(60, { dur: 0.3 });
      window.MusicKit.setInstrument('drums');
      var r2 = window.MusicKit.play('kick');
      window.MusicKit.play(3);                        // 数字索引也要能用
      window.MusicKit.setInstrument('guitar');
      window.MusicKit.play(64, { dur: 0.3 });
      out.api = {
        a: r1 ? { instrument: r1.instrument, midi: r1.midi, voices: r1.voices } : null,
        b: r2 ? { instrument: r2.instrument, pad: r2.pad, voices: r2.voices } : null,
        last: window.MusicKit.lastEvent(),
        debug: window.MusicKit.debug()
      };
      window.removeEventListener('error', onErr);
      out.errs = errs;
      return JSON.stringify(out);
    `);
    const trig = JSON.parse(String(triggerRes));
    check('触发：点钢琴键记录 lastEvent（instrument=piano，midi 与按键一致）',
      !!trig.piano.ev && trig.piano.ev.instrument === 'piano' &&
      trig.piano.ev.midi === trig.piano.midi && trig.piano.ev.at > 0 &&
      typeof trig.piano.ev.voices === 'number', JSON.stringify(trig.piano));
    check('触发：点鼓垫记录 lastEvent（instrument=drums，pad=' + trig.drum.pad + '）',
      !!trig.drum.ev && trig.drum.ev.instrument === 'drums' &&
      trig.drum.ev.pad === trig.drum.pad && trig.drum.ev.at > 0, JSON.stringify(trig.drum));
    check('触发：play() 在无音频硬件时也不抛错，返回可读事件',
      !!trig.api.a && trig.api.a.midi === 60 && trig.api.a.instrument === 'piano' &&
      !!trig.api.b && trig.api.b.pad === 'kick' && trig.api.b.instrument === 'drums' &&
      !!trig.api.last && trig.api.last.instrument === 'guitar' &&
      typeof trig.api.last.voices === 'number', JSON.stringify(trig.api));
    check('触发：过程中没有 window error', trig.errs.length === 0, JSON.stringify(trig.errs));

    /* ---------------- 5. 试音台 ---------------- */
    const labRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music/lab', 800);
      var txt = (document.getElementById('view') || {}).innerText || '';
      var chips = document.querySelectorAll('#view .inst-chip').length;
      var ranges = Array.prototype.slice.call(document.querySelectorAll('#view .mus-tune'));
      var keys = ranges.map(function (r) { return r.getAttribute('data-tune'); });
      var before = window.MusicKit.tune().brightness;
      var slider = document.querySelector('#view .mus-tune[data-tune="brightness"] .mus-tune-r');
      if (slider) {
        slider.value = '25';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
      var after = window.MusicKit.tune().brightness;
      var labTxt = document.querySelector('#view').innerText || '';
      return JSON.stringify({
        path: window.UI.currentPath(),
        chips: chips, keys: keys, meter: !!document.querySelector('#view .meter'),
        keyboard: document.querySelectorAll('#view .pkey-w').length,
        demo: /示例/.test(labTxt),
        labeled: /音量/.test(labTxt) && /延音/.test(labTxt) && /明亮度/.test(labTxt),
        hasHint: /试音/.test(txt),
        brightnessBefore: before, brightnessAfter: after
      });
    `);
    const lab = JSON.parse(String(labRes));
    check('#/music/lab：乐器选择条 + 可弹表面 + 音量/延音/明亮度',
      lab.path === 'music/lab' && lab.chips >= 5 && lab.keyboard === 14 &&
      lab.labeled && lab.keys.indexOf('volume') >= 0 &&
      lab.keys.indexOf('sustain') >= 0 &&
      lab.keys.indexOf('brightness') >= 0 &&
      lab.meter && lab.demo, labRes);
    check('试音台：明亮度滑杆真的改变音色参数（' + lab.brightnessBefore + ' → ' + lab.brightnessAfter + '）',
      Math.abs(lab.brightnessAfter - 0.25) < 0.02, labRes);

    /* 试音台上换到鼓组：表面也要跟着换 */
    const labDrumRes = await page.call(`
      var chip = document.querySelector('#view .inst-chip[data-inst="drums"]');
      if (chip) { chip.click(); await new Promise(function (r) { setTimeout(r, 600); }); }
      return JSON.stringify({
        pads: document.querySelectorAll('#view .drum-pad').length,
        keys: document.querySelectorAll('#view .pkey-w').length,
        inst: window.MusicKit.current()
      });
    `);
    check('试音台：换乐器后可弹表面同步切换（鼓组 → 9 垫）',
      JSON.parse(String(labDrumRes)).pads >= 8 && JSON.parse(String(labDrumRes)).keys === 0, labDrumRes);

    /* ---------------- 6. 谱曲 ---------------- */
    const composeRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music/compose', 800);
      var all = Array.prototype.slice.call(document.querySelectorAll('#view .score-cell'));
      /* 表头那一行也是 .score-cell（但是 div），能点的只有下面的 button */
      var cells = Array.prototype.slice.call(document.querySelectorAll('#view button.score-cell'));
      var before = window.__t.rowsOn();
      var target = null;
      for (var i = 0; i < all.length; i++) {
        if (all[i].tagName === 'BUTTON' && !all[i].classList.contains('on')) { target = all[i]; break; }
      }
      if (target) target.click();
      await new Promise(function (r) { setTimeout(r, 250); });
      var after = window.__t.rowsOn();
      var txt = (document.getElementById('view') || {}).innerText || '';
      return JSON.stringify({
        cells: all.length, buttons: cells.length,
        on: document.querySelectorAll('#view .score-cell.on').length,
        before: before, after: after,
        preview: /乐谱预览/.test(txt), demo: /来一段示例/.test(txt),
        svg: !!document.querySelector('#view svg')
      });
    `);
    const comp = JSON.parse(String(composeRes));
    check('#/music/compose：≥200 个 .score-cell、点一下写入 songs[0].rows（' + comp.before + ' → ' + comp.after + '）',
      comp.cells >= 200 && comp.after === comp.before + 1, composeRes);
    check('#/music/compose：仍有「乐谱预览」「来一段示例」和 SVG',
      comp.preview && comp.demo && comp.svg, composeRes);

    /* ---------------- 7. 歌词 ---------------- */
    const lyricRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music/lyrics', 650);
      var ta = document.querySelector('#view textarea.music-lyrics');
      var text = '自动化验证歌词：第一句';
      if (ta) {
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise(function (r) { setTimeout(r, 250); });
      var saved = ((window.Store.state.settings.songs || [])[0] || {}).lyrics || '';
      return JSON.stringify({ hasTa: !!ta, text: text, saved: saved, ok: saved.indexOf(text) >= 0 });
    `);
    const lyric = JSON.parse(String(lyricRes));
    check('#/music/lyrics：textarea.music-lyrics 写进 songs[0].lyrics',
      lyric.hasTa && lyric.ok, lyricRes);

    /* ---------------- 8. 吉他：延迟线定长 + 环路增益 + 衰减计划 ---------------- */
    /* 这条对应「吉他点一下响个不停」：先把「这条音打算响多久」算清楚 */
    const planRes = await page.call(`
      window.MusicKit.setInstrument('guitar');
      var notes = [40, 45, 50, 52, 55, 59, 64, 69];
      var plans = notes.map(function (m) { return window.MusicKit.plan('guitar', m); });
      var bassPlans = [28, 33, 38, 43].map(function (m) { return window.MusicKit.plan('bass', m); });
      /* 真的拨一下，看登记的寿命和配方是不是同一套 */
      window.MusicKit.stopAll();
      window.MusicKit.play(52, { dur: 1.0 });
      var live = window.MusicKit.voices();
      var lastPlan = window.MusicKit.debug().lastPlan;
      return JSON.stringify({
        plans: plans, bass: bassPlans, live: live, lastPlan: lastPlan,
        caps: window.MusicKit.voiceCaps()
      });
    `);
    const plan = JSON.parse(String(planRes));
    const worstTune = plan.plans.concat(plan.bass).reduce((a, p) => Math.max(a, Math.abs(p.pitchHz - p.freq) / p.freq), 0);
    check('吉他：延迟线按采样率定长（音准误差 <1%，' +
      plan.plans.map((p) => p.midi + ':' + p.loopSamples).join(' ') + '）',
      plan.plans.every((p) => p.engine !== 'waveguide' || p.loopSamples >= 129.5) &&
      plan.bass.every((p) => p.loopSamples >= 129.5) && worstTune < 0.01, planRes);
    check('吉他：环路增益 <1 且高音衰减更快（feedback ' +
      plan.plans[0].feedback + '@E2 → ' + plan.plans[6].feedback + '@E4，t60 ' +
      plan.plans[0].t60 + 's → ' + plan.plans[6].t60 + 's）',
      plan.plans.every((p) => p.feedback < 1 && p.feedback > 0.5) &&
      plan.plans[0].t60 > plan.plans[6].t60 &&
      /* 拨一下只听到一声：0.35–0.6s 到 −40dB，0.9s 强制静音（寿命上限 1.0s） */
      plan.plans.every((p) => p.t40 >= 0.35 && p.t40 <= 0.60 && p.lifeSec <= 1.0),
      planRes);
    check('贝斯：也是「一声就收」（t40 ' + plan.bass[0].t40 + '–' + plan.bass[plan.bass.length - 1].t40 +
      's，寿命 ' + plan.bass[0].lifeSec + '–' + plan.bass[plan.bass.length - 1].lifeSec + 's ≤ 1.4s）',
      plan.bass.every((p) => p.t40 >= 0.5 && p.t40 <= 0.8 && p.lifeSec <= 1.4) &&
      plan.caps.bass <= 1.4 && plan.caps.guitar <= 1.0, planRes);
    check('吉他：拨一下登记的寿命与配方一致（life=' +
      (plan.live[0] ? plan.live[0].life : '—') + 's ≤ 上限 ' + plan.caps.guitar + 's）',
      plan.live.length === 1 && plan.live[0].inst === 'guitar' &&
      Math.abs(plan.live[0].decay - plan.lastPlan.t60) < 0.01 &&
      plan.live[0].life <= plan.caps.guitar && !!plan.lastPlan.engine, planRes);

    /* ---------------- 9. 吉他：一声就收（不会一直响） ---------------- */
    const decayRes = await page.call(`
      window.MusicKit.setInstrument('guitar');
      window.MusicKit.stopAll();
      window.MusicKit.play(52, { dur: 1.0 });
      var first = window.MusicKit.activeVoices();
      var seq = [];
      for (var i = 0; i < 10; i++) {
        await new Promise(function (r) { setTimeout(r, 400); });
        seq.push(window.MusicKit.activeVoices());
      }
      return JSON.stringify({ first: first, seq: seq, final: window.MusicKit.activeVoices(), t: 4.0 });
    `);
    const decay = JSON.parse(String(decayRes));
    const zeroAt = decay.seq.indexOf(0);
    check('吉他：拨一下，0.4s 时还在响、2.0s 内自己归零（第 ' +
      (zeroAt < 0 ? '—' : ((zeroAt + 1) * 0.4).toFixed(1) + 's') + ' 秒静音；序列 ' + decay.seq.join('') + '）',
      decay.first >= 1 && decay.seq[0] >= 1 && decay.seq[decay.seq.length - 1] === 0 &&
      decay.final === 0 && zeroAt >= 1 && zeroAt <= 5, decayRes);

    /* 高音区（反馈环低于一个渲染量子 → 模态兜底）也不能长鸣 */
    const highRes = await page.call(`
      window.MusicKit.setInstrument('guitar');
      var p = window.MusicKit.plan('guitar', 69);
      window.MusicKit.stopAll();
      window.MusicKit.play(69, {});
      var v1 = window.MusicKit.activeVoices();
      await new Promise(function (r) { setTimeout(r, 3000); });
      return JSON.stringify({ plan: p, v1: v1, v2: window.MusicKit.activeVoices() });
    `);
    const high = JSON.parse(String(highRes));
    check('吉他：高音区走模态兜底（A4 → ' + high.plan.engine + '），3 秒内也归零（' +
      high.v1 + ' → ' + high.v2 + '）',
      high.plan.engine === 'modal' && high.v1 >= 1 && high.v2 === 0 && high.plan.lifeSec <= 4, highRes);

    /* 快速重复拨同一根弦：不能堆成一片（真吉他再拨一下就掐掉上一声） */
    const burstRes = await page.call(`
      window.MusicKit.setInstrument('guitar');
      window.MusicKit.stopAll();
      var hi = 0;
      for (var i = 0; i < 24; i++) {
        window.MusicKit.play(52, {});
        hi = Math.max(hi, window.MusicKit.activeVoices());
        await new Promise(function (r) { setTimeout(r, 30); });
      }
      var busy = window.MusicKit.activeVoices();
      await new Promise(function (r) { setTimeout(r, 4200); });
      return JSON.stringify({ hi: hi, busy: busy, quiet: window.MusicKit.activeVoices() });
    `);
    const burst = JSON.parse(String(burstRes));
    check('吉他：同一根弦快速连拨 24 次不会堆积（最多同时 ' + burst.hi +
      ' 条，4.2s 后 ' + burst.quiet + ' 条）',
      burst.hi <= 3 && burst.busy <= 3 && burst.quiet === 0, burstRes);

    /* ---------------- 10. stopAll：立刻全停 ---------------- */
    const stopRes = await page.call(`
      window.MusicKit.setInstrument('guitar');
      window.MusicKit.stopAll();
      [40, 45, 50, 55, 59, 64].forEach(function (m) { window.MusicKit.play(m, {}); });
      var g = window.MusicKit.activeVoices();
      /* 鼓用 playAs 直接打（不走换乐器，免得旧音被换乐器顺手收掉） */
      ['kick', 'snare', 'hat', 'crash'].forEach(function (p) { window.MusicKit.playAs('drums', p); });
      var before = window.MusicKit.activeVoices();
      var killed = window.MusicKit.stopAll();
      return JSON.stringify({
        guitar: g, before: before, killed: killed,
        after: window.MusicKit.activeVoices(),
        listAfter: window.MusicKit.voices().length
      });
    `);
    const stop = JSON.parse(String(stopRes));
    check('stopAll()：和弦 + 鼓一起响时立刻全停（' + stop.before + ' → ' + stop.after + '，登记册也清空）',
      stop.guitar >= 5 && stop.before >= 9 && stop.killed === stop.before &&
      stop.after === 0 && stop.listAfter === 0, stopRes);

    /* ---------------- 11. 换乐器：旧音必须被掐掉 ---------------- */
    const switchRes = await page.call(`
      window.MusicKit.setInstrument('guitar');
      window.MusicKit.stopAll();
      [40, 45, 50].forEach(function (m) { window.MusicKit.play(m, {}); });
      await new Promise(function (r) { setTimeout(r, 60); });
      var before = window.MusicKit.activeVoices();
      window.MusicKit.setInstrument('piano');
      var after = window.MusicKit.activeVoices();
      await new Promise(function (r) { setTimeout(r, 200); });
      return JSON.stringify({
        before: before, after: after, after200: window.MusicKit.activeVoices(),
        inst: window.MusicKit.current()
      });
    `);
    const sw = JSON.parse(String(switchRes));
    check('换乐器：吉他还在响时切到钢琴，旧音立刻收掉（' + sw.before + ' → ' + sw.after + '）',
      sw.before >= 3 && sw.after === 0 && sw.after200 === 0 && sw.inst === 'piano', switchRes);

    /* 离开音乐模块（换页）也要收声 */
    const leaveRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music', 600);
      window.MusicKit.play(60, {});
      window.MusicKit.play(64, {});
      var before = window.MusicKit.activeVoices();
      await window.__t.go('novel', 700);
      var after = window.MusicKit.activeVoices();
      await window.__t.go('music', 500);
      return JSON.stringify({ before: before, after: after, path: window.UI.currentPath() });
    `);
    const leave = JSON.parse(String(leaveRes));
    check('离开音乐页（换到小说页）会收掉所有还在响的音（' + leave.before + ' → ' + leave.after + '）',
      leave.before >= 2 && leave.after === 0 && leave.path === 'music', leaveRes);

    /* ---------------- 12. 总线：混响 + 压缩 + 限制 ---------------- */
    const chainRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      window.MusicKit.play(60, {});
      var a = window.MusicKit.debug().audio;
      var m = window.MusicKit.mix();
      return JSON.stringify({ audio: a, mix: m, engine: window.MusicKit.useSamples({}).engine });
    `);
    const chain = JSON.parse(String(chainRes));
    const nodes = chain.audio.nodes || [];
    check('音频总线：有卷积混响 + 压缩 + 限制（节点 ' + nodes.join(',') + '）',
      chain.audio.available === true && chain.audio.built === true &&
      nodes.indexOf('convolver') >= 0 && nodes.indexOf('compressor') >= 0 &&
      nodes.indexOf('limiter') >= 0 && nodes.indexOf('destination') >= 0 &&
      nodes.indexOf('wetTrim') >= 0 && nodes.indexOf('preDelay') >= 0, chainRes);
    check('音频总线：混响是程序生成的脉冲响应（' + chain.audio.reverb.irSeconds + 's / 湿度 ' +
      chain.audio.reverb.wet + '），压缩与限制都是 DynamicsCompressorNode',
      !!chain.audio.reverb && chain.audio.reverb.type === 'ConvolverNode' &&
      chain.audio.reverb.irSeconds >= 1.2 && chain.audio.reverb.irSeconds <= 1.8 &&
      chain.audio.reverb.wet >= 0.15 && chain.audio.reverb.wet <= 0.25 &&
      !!chain.audio.compressor && chain.audio.compressor.type === 'DynamicsCompressorNode' &&
      !!chain.audio.limiter && chain.audio.limiter.type === 'DynamicsCompressorNode' &&
      chain.audio.limiter.ratio >= 10, chainRes);
    check('采样开关：useSamples({}) 关掉采样后引擎回到纯合成（engine=' + chain.engine + '）',
      chain.engine === 'synth', chainRes);
    check('总线：拨弦类压住混响送出（吉他 ' + chain.mix.revSend.guitar + ' ≤0.12、贝斯 ' +
      chain.mix.revSend.bass + ' ≤0.03），压缩阈值 ' + chain.mix.compressor.threshold +
      'dB ≥ −20（常态不失真），配平 ' + chain.mix.trim.guitar + ' ≤0.71（留 3dB 余量）',
      chain.mix.revSend.guitar <= 0.12 && chain.mix.revSend.bass <= 0.03 &&
      chain.mix.compressor.threshold >= -20 && chain.mix.trim.guitar <= 0.71 &&
      chain.mix.preDelayMs > 0, chainRes);

    /* ---------------- 13. 简化后的界面：一行开关 + 键位开关 + 试音台三步 ---------------- */
    const uiRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music/piano', 700);
      var caps = document.querySelectorAll('#view .pkey .kc').length;
      var before = Array.prototype.slice.call(document.querySelectorAll('#view .pkey .kc'))
        .map(function (e) { return e.textContent; }).join('');
      var btn = null;
      Array.prototype.slice.call(document.querySelectorAll('#view .mus-btn')).forEach(function (b) {
        if (/键位/.test(b.textContent || '')) btn = b;
      });
      if (btn) { btn.click(); await new Promise(function (r) { setTimeout(r, 150); }); }
      var after = Array.prototype.slice.call(document.querySelectorAll('#view .pkey .kc'))
        .map(function (e) { return e.textContent; }).join('');
      var btns = Array.prototype.slice.call(document.querySelectorAll('#view .mus-btn'));
      var small = btns.filter(function (b) { return b.getBoundingClientRect().height < 40; }).length;
      /* 键位开关打开后，电脑键盘映射照样能弹 */
      var kc = document.querySelector('#view .pkey .kc');
      var mappedMidi = kc ? kc.closest('.pkey').getAttribute('data-midi') : null;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      var ev = window.MusicKit.lastEvent();
      await window.__t.go('music/lab', 700);
      var nums = Array.prototype.slice.call(document.querySelectorAll('#view .lab-sec-n'))
        .map(function (e) { return e.textContent; }).join('');
      var labTxt = (document.getElementById('view') || {}).innerText || '';
      return JSON.stringify({
        caps: caps, before: before, after: after, buttons: btns.length, small: small,
        mappedMidi: mappedMidi, evMidi: ev ? ev.midi : null,
        steps: nums, stepLabels: [/选乐器/.test(labTxt), /弹一弹/.test(labTxt), /调音色/.test(labTxt)],
        hasLib: /曲库/.test(labTxt),
        demoBtn: !!document.querySelector('#view .mus-btn.lab-demo'),
        sustain: !!document.querySelector('#view [data-sustain]')
      });
    `);
    const ui = JSON.parse(String(uiRes));
    check('#/music：开关收成一行大按钮（' + ui.buttons + ' 个，都 ≥40px），键位默认不显示（' + ui.caps + ' 个键位槽）',
      ui.caps === 24 && ui.before.replace(/\s/g, '') === '' &&
      ui.after.indexOf('A') >= 0 && ui.after.indexOf('W') >= 0 &&
      ui.buttons >= 4 && ui.small === 0 && ui.sustain, uiRes);
    check('#/music：电脑键盘映射在「键位」关闭时也能弹（A → midi ' + ui.evMidi + '）',
      ui.evMidi !== null && ui.evMidi === Number(ui.mappedMidi), uiRes);
    check('#/music/lab：四步走（' + ui.steps + ' 选乐器 / 弹一弹 / 调音色 / 曲库），示例按钮在',
      ui.steps === '1234' && ui.stepLabels[0] && ui.stepLabels[1] && ui.stepLabels[2] &&
      ui.hasLib && ui.demoBtn, uiRes);

    /* ---------------- 14. 延音 / 明亮度真的改到合成配方上 ---------------- */
    const tuneRes = await page.call(`
      var keep = window.MusicKit.tune();
      window.MusicKit.setTune('brightness', 0);
      var dark = window.MusicKit.plan('guitar', 52);
      window.MusicKit.setTune('brightness', 1);
      var bright = window.MusicKit.plan('guitar', 52);
      window.MusicKit.setTune('sustain', 0);
      var shortNote = window.MusicKit.plan('guitar', 52);
      window.MusicKit.setTune('sustain', 1);
      var longNote = window.MusicKit.plan('guitar', 52);
      window.MusicKit.setTune('brightness', keep.brightness);
      window.MusicKit.setTune('sustain', keep.sustain);
      return JSON.stringify({
        dark: dark, bright: bright, shortNote: shortNote, longNote: longNote,
        t60: [shortNote.t60, longNote.t60], damp: [dark.dampHz, bright.dampHz],
        restored: window.MusicKit.tune()
      });
    `);
    const tn = JSON.parse(String(tuneRes));
    check('调音色：明亮度改阻尼/拨片截止（' + tn.damp[0] + '→' + tn.damp[1] + 'Hz），延音改衰减时间（' +
      tn.t60[0] + 's→' + tn.t60[1] + 's）',
      tn.bright.dampHz > tn.dark.dampHz && tn.bright.pickHz > tn.dark.pickHz &&
      tn.longNote.t60 > tn.shortNote.t60 && tn.longNote.lifeSec > tn.shortNote.lifeSec &&
      Math.abs(tn.restored.brightness - 0.25) < 0.02, tuneRes);

    /* ---------------- 15. 示例乐句：按钮就地换文案，停止后立刻安静 ---------------- */
    const demoRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music/lab', 700);
      var btn = document.querySelector('#view .mus-btn.lab-demo');
      var label0 = btn ? btn.textContent : '';
      if (btn) btn.click();
      await new Promise(function (r) { setTimeout(r, 500); });
      var label1 = btn ? btn.textContent : '';
      var during = window.MusicKit.activeVoices();
      if (btn) btn.click();
      await new Promise(function (r) { setTimeout(r, 200); });
      var label2 = btn ? btn.textContent : '';
      return JSON.stringify({
        label0: label0, label1: label1, label2: label2,
        during: during, after: window.MusicKit.activeVoices(), stillThere: !!btn
      });
    `);
    const demo = JSON.parse(String(demoRes));
    check('示例乐句：点一下开始（按钮变「停止示例」，' + demo.during + ' 条音在响），再点一下立刻安静',
      /示例/.test(demo.label0) && /停止/.test(demo.label1) && demo.during >= 1 &&
      !/停止/.test(demo.label2) && demo.after === 0 && demo.stillThere, demoRes);

    /* ---------------- 16. 真采样：加载数量 = 磁盘上的文件数 ---------------- */
    const diskSamples = (() => {
      const found = [];
      const walk = (d) => {
        let list = [];
        try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
        list.forEach((e) => {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.mp3$/i.test(e.name)) found.push(p);
        });
      };
      walk(path.join(__dirname, '..', 'assets', 'samples'));
      return found;
    })();

    const sampleRes = await page.call(`
      window.MusicKit.useSamples();                      // 恢复内置采样库
      var s = await window.MusicKit.loadSamples();
      return JSON.stringify({ s: s, info: window.MusicKit.samples(), debug: window.MusicKit.debug() });
    `);
    const smp = JSON.parse(String(sampleRes));
    const dsm = smp.debug.samples;
    console.log('采样库：' + smp.s.source + ' · ' + smp.s.loaded + ' 个 / ' + Math.round(smp.s.bytes / 1024) +
      ' KB · 采样发声：' + smp.s.backed.join('、'));
    check('采样：页面真的加载进 ' + smp.s.loaded + ' 个采样（磁盘上 ' + diskSamples.length + ' 个 mp3，失败 ' +
      smp.s.failed + '）',
      diskSamples.length > 0 && smp.s.loaded === diskSamples.length &&
      smp.s.files === diskSamples.length && smp.s.failed === 0 &&
      smp.s.ready === true && smp.s.engine === 'hybrid', sampleRes);
    check('采样：钢琴 / 电钢琴 / 吉他 / 贝斯 都走采样（' + smp.s.backed.join('、') + '），鼓组走合成兜底',
      ['piano', 'epiano', 'guitar', 'bass'].every((k) => smp.s.backed.indexOf(k) >= 0) &&
      smp.s.fallback.indexOf('drums') >= 0 &&
      dsm.perInstrument.piano.engine === 'sample' &&
      smp.s.perInstrument.piano.notes.length >= 8 &&
      smp.s.perInstrument.guitar.notes.length >= 8 &&
      smp.s.perInstrument.bass.notes.length >= 6, sampleRes);

    /* 试音台徽章：当前乐器是「采样」还是「合成」 */
    const badgeRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music/lab', 750);
      var b = document.querySelector('#view .sample-badge');
      var chips = Array.prototype.slice.call(document.querySelectorAll('#view .inst-chip'));
      var sampled = chips.filter(function (c) { return c.getAttribute('data-engine') === 'sample'; });
      var out = {
        text: b ? b.textContent : null,
        engine: b ? b.getAttribute('data-engine') : null,
        inst: b ? b.getAttribute('data-inst') : null,
        chips: chips.length, sampled: sampled.length,
        dots: document.querySelectorAll('#view .chip-engine.on').length,
        label: (document.querySelector('#view .lab-meter-v') || {}).textContent || ''
      };
      /* 换成鼓组：徽章要变「合成」 */
      var drum = document.querySelector('#view .inst-chip[data-inst="drums"]');
      if (drum) { drum.click(); await new Promise(function (r) { setTimeout(r, 600); }); }
      var b2 = document.querySelector('#view .sample-badge');
      out.text2 = b2 ? b2.textContent : null;
      out.engine2 = b2 ? b2.getAttribute('data-engine') : null;
      return JSON.stringify(out);
    `);
    const badge = JSON.parse(String(badgeRes));
    check('试音台：徽章显示「采样」（钢琴 → ' + badge.text + '，' + badge.sampled + '/' + badge.chips +
      ' 件乐器是采样；换鼓组 → ' + badge.text2 + '）',
      badge.text === '采样' && badge.engine === 'sample' && badge.inst === 'piano' &&
      badge.chips >= 5 && badge.sampled >= 4 && badge.dots >= 4 &&
      badge.text2 === '合成' && badge.engine2 === 'synth', badgeRes);

    /* ---------------- 17. 采样路径的时长 / 变调 / 音色链路 ---------------- */
    const sVoiceRes = await page.call(`
      window.MusicKit.useSamples();
      await window.MusicKit.loadSamples();
      function one(inst, midi) {
        window.MusicKit.setInstrument(inst);
        window.MusicKit.stopAll();
        var ev = window.MusicKit.play(midi, {});
        var v = window.MusicKit.voices()[0] || null;
        return { ev: ev, v: v, plan: window.MusicKit.debug().lastPlan };
      }
      var g = one('guitar', 52);
      var b = one('bass', 40);
      var p = one('piano', 60);
      window.MusicKit.stopAll();
      return JSON.stringify({ g: g, b: b, p: p, lanes: window.MusicKit.debug().samples.perInstrument });
    `);
    const sv = JSON.parse(String(sVoiceRes));
    check('采样：吉他/贝斯/钢琴真的由采样发声（lastEvent.engine=sample；吉他 ' + sv.g.plan.note +
      ' → 变调 ' + sv.g.plan.semis + ' 个半音 ×' + sv.g.plan.playbackRate + '）',
      sv.g.ev.engine === 'sample' && sv.b.ev.engine === 'sample' && sv.p.ev.engine === 'sample' &&
      sv.g.plan.engine === 'sample' && sv.b.plan.engine === 'sample' && sv.p.plan.engine === 'sample' &&
      Math.abs(sv.g.plan.semis) <= 2 && Math.abs(sv.b.plan.semis) <= 2 &&
      sv.g.plan.playbackRate >= 0.89 && sv.g.plan.playbackRate <= 1.13 &&
      !!sv.g.plan.note, sVoiceRes);
    check('采样：尾巴一样短（吉他 ' + sv.g.v.life + 's ≤1.0 / 贝斯 ' + sv.b.v.life + 's ≤1.4 / 钢琴 ' +
      sv.p.v.life + 's ≤2.5；−40dB 在 ' + sv.g.plan.t40 + 's / ' + sv.b.plan.t40 + 's）',
      sv.g.v.life <= 1.0 && sv.b.v.life <= 1.4 && sv.p.v.life <= 2.5 &&
      sv.g.plan.t40 >= 0.35 && sv.g.plan.t40 <= 0.60 &&
      sv.b.plan.t40 >= 0.5 && sv.b.plan.t40 <= 0.8 &&
      sv.g.v.sampled === true && Math.abs(sv.g.v.decay - sv.g.plan.t60) < 0.01, sVoiceRes);
    check('采样：录音底噪被挡在 7kHz 以下（吉他 ' + sv.g.plan.lowpassHz + 'Hz / 贝斯 ' +
      sv.b.plan.lowpassHz + 'Hz / 钢琴 ' + sv.p.plan.lowpassHz + 'Hz），裁短到 ' +
      sv.g.plan.sampleMs + 'ms 免得白占内存',
      sv.g.plan.lowpassHz <= 7000 && sv.b.plan.lowpassHz <= 7000 && sv.p.plan.lowpassHz <= 7000 &&
      sv.g.plan.sampleMs <= 1100 && sv.b.plan.sampleMs <= 1400, sVoiceRes);

    /* ---------------- 18. 单音抢占：新的一拨把上一声淡出 ---------------- */
    const monoRes = await page.call(`
      async function burst(inst, notes) {
        window.MusicKit.setInstrument(inst);
        window.MusicKit.stopAll();
        var max = 0;
        for (var i = 0; i < notes.length; i++) {
          window.MusicKit.play(notes[i], {});
          max = Math.max(max, window.MusicKit.voiceCounts()[inst]);
          await new Promise(function (r) { setTimeout(r, 60); });
        }
        return { max: max, now: window.MusicKit.voiceCounts()[inst] };
      }
      var g = await burst('guitar', [40, 43, 45, 47, 50, 52, 55, 57]);
      var b = await burst('bass', [28, 31, 33, 35, 38, 40, 43, 45]);
      /* 30ms 内一起按下的三个音算和弦：必须一起响 */
      window.MusicKit.setInstrument('guitar');
      window.MusicKit.stopAll();
      [52, 55, 59].forEach(function (m) { window.MusicKit.play(m, {}); });
      var chord = window.MusicKit.voiceCounts().guitar;
      window.MusicKit.stopAll();
      return JSON.stringify({ g: g, b: b, chord: chord });
    `);
    const mono = JSON.parse(String(monoRes));
    check('单音抢占：连按 8 次（间隔 60ms）吉他最多同时 ' + mono.g.max + ' 条、贝斯 ' + mono.b.max +
      ' 条（≤1）；30ms 内一起按的 3 个音仍一起响（和弦 ' + mono.chord + ' 条）',
      mono.g.max <= 1 && mono.g.now <= 1 && mono.b.max <= 1 && mono.b.now <= 1 && mono.chord === 3, monoRes);

    /* ---------------- 19. 采样关掉时，合成兜底照样出声 ---------------- */
    const fallbackRes = await page.call(`
      var off = window.MusicKit.useSamples({});            // 关掉采样，全部走合成
      var s0 = window.MusicKit.samples();
      var errs = [];
      var onErr = function (e) { errs.push(String(e.message || e)); };
      window.addEventListener('error', onErr);
      window.MusicKit.setInstrument('guitar');
      window.MusicKit.stopAll();
      var ev = window.MusicKit.play(52, {});
      var v = window.MusicKit.voices()[0] || null;
      var cnt = window.MusicKit.voiceCounts();
      window.MusicKit.setInstrument('piano');
      var ev2 = window.MusicKit.play(60, {});
      var v2 = window.MusicKit.voices()[0] || null;
      await new Promise(function (r) { setTimeout(r, 300); });
      window.removeEventListener('error', onErr);
      /* 再打开：采样回来，且引擎切回采样 */
      window.MusicKit.useSamples();
      var back = await window.MusicKit.loadSamples();
      window.MusicKit.setInstrument('guitar');
      window.MusicKit.stopAll();
      var ev3 = window.MusicKit.play(52, {});
      var v3 = window.MusicKit.voices()[0] || null;
      return JSON.stringify({
        off: off, s0: { engine: s0.engine, loaded: s0.loaded, backed: s0.backed },
        ev: ev, v: v, cnt: cnt, ev2: ev2, v2: v2, errs: errs,
        back: { engine: back.engine, loaded: back.loaded, backed: back.backed },
        ev3: ev3, v3: v3
      });
    `);
    const fb = JSON.parse(String(fallbackRes));
    check('合成兜底：useSamples({}) 关掉采样后引擎回到 synth（' + fb.s0.engine + '），吉他/钢琴照样出声、不抛错' +
      '（吉他 life ' + (fb.v ? fb.v.life : '—') + 's，钢琴 life ' + (fb.v2 ? fb.v2.life : '—') + 's，报错 ' +
      fb.errs.length + '）',
      fb.s0.engine === 'synth' && fb.s0.loaded === 0 && fb.off.engine === 'synth' &&
      !!fb.v && fb.v.life <= 1.0 && !!fb.v2 && fb.v2.life <= 2.5 &&
      fb.errs.length === 0 && fb.cnt.guitar === 1, fallbackRes);
    check('采样开关：再 useSamples() 打开 → 采样回来了（' + fb.back.loaded + ' 个 / ' + fb.back.engine +
      '），新弹的吉他 ' + fb.ev3.engine,
      fb.back.loaded === diskSamples.length && fb.back.engine === 'hybrid' &&
      fb.ev3.engine === 'sample' && !!fb.v3 && fb.v3.sampled === true, fallbackRes);

    /* ---------------- 20. 示例曲库 ---------------- */
    const libRes = await page.call(`
      var list = window.MusicKit.tunes();
      var parsed = list.map(function (t) { return window.MusicKit.tuneInfo(t.id); });
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music/lab', 800);
      var chips = Array.prototype.slice.call(document.querySelectorAll('#view .tune-chip'));
      var txt = (document.getElementById('view') || {}).innerText || '';
      var out = {
        list: list,
        bad: parsed.filter(function (p) { return !p || !p.ok || !p.events.length; })
          .map(function (p) { return p && p.id; }),
        chips: chips.length,
        chipIds: chips.map(function (c) { return c.getAttribute('data-tune'); }),
        tags: parsed.map(function (p) { return p && p.tag; }),
        insts: parsed.map(function (p) { return p && p.inst; }),
        sources: parsed.filter(function (p) { return p && p.source; }).length,
        info: (document.querySelector('#view .tune-info') || {}).textContent || '',
        hasImport: !!document.querySelector('#view .tune-import'),
        hasLoad: !!document.querySelector('#view .tune-load'),
        hasRec: !!document.querySelector('#view .tune-rec'),
        hasPlay: !!document.querySelector('#view .tune-play'),
        copyright: /请只导入你有权使用的曲谱/.test(txt) && /不内置受版权保护/.test(txt)
      };
      var ib = document.querySelector('#view .tune-import');
      if (ib) ib.click();
      await new Promise(function (r) { setTimeout(r, 300); });
      out.importSheet = !!document.querySelector('#sheetHost .import-text');
      out.sheetHelp = /简谱/.test((document.getElementById('sheetBody') || {}).innerText || '');
      out.sheetWarn = /请只导入你有权使用的曲谱/.test((document.getElementById('sheetBody') || {}).innerText || '');
      window.UI.closeSheet();
      await new Promise(function (r) { setTimeout(r, 200); });
      return JSON.stringify(out);
    `);
    const lib = JSON.parse(String(libRes));
    check('曲库：内置 ' + lib.list.length + ' 首示例曲（' + lib.list.map((t) => t.name).join('、') + '）',
      lib.list.length >= 15 && lib.chips === lib.list.length && lib.bad.length === 0 &&
      lib.tags.indexOf('儿歌') >= 0 && lib.tags.indexOf('民歌') >= 0 && lib.tags.indexOf('练习曲') >= 0 &&
      lib.insts.every((i) => ['piano', 'epiano', 'guitar', 'bass'].indexOf(i) >= 0) &&
      lib.sources === lib.list.length, libRes);
    check('曲库：界面有曲子胶囊 + 出处说明 + 导入/载入入口 + 版权提示（导入弹层也有）',
      lib.chips >= 6 && /推荐音色/.test(lib.info) && /公有领域|原创/.test(lib.info) &&
      lib.hasImport && lib.hasLoad && lib.hasRec && lib.hasPlay &&
      lib.copyright && lib.importSheet && lib.sheetHelp && lib.sheetWarn, libRes);

    /* 切换曲目 → 试听用的曲子必须跟着变，再点一下停止 */
    const libPlayRes = await page.call(`
      window.__t.go('music/lab');
      await new Promise(function (r) { setTimeout(r, 700); });
      var chips = Array.prototype.slice.call(document.querySelectorAll('#view .tune-chip'));
      var out = { ids: chips.map(function (c) { return c.getAttribute('data-tune'); }) };
      chips[0].click();
      await new Promise(function (r) { setTimeout(r, 500); });
      out.first = { pick: window.MusicKit.libraryPick(), seq: window.MusicKit.sequence(), voices: window.MusicKit.activeVoices() };
      var chips2 = Array.prototype.slice.call(document.querySelectorAll('#view .tune-chip'));
      chips2[2].click();
      await new Promise(function (r) { setTimeout(r, 500); });
      out.third = { pick: window.MusicKit.libraryPick(), seq: window.MusicKit.sequence(), voices: window.MusicKit.activeVoices() };
      var chips3 = Array.prototype.slice.call(document.querySelectorAll('#view .tune-chip'));
      chips3[2].click();
      await new Promise(function (r) { setTimeout(r, 300); });
      out.stopped = { seq: window.MusicKit.sequence(), voices: window.MusicKit.activeVoices() };
      var on = document.querySelector('#view .tune-chip.on');
      out.activeChip = on ? on.getAttribute('data-tune') : null;
      return JSON.stringify(out);
    `);
    const lp = JSON.parse(String(libPlayRes));
    check('曲库：点一首就试听、换一首曲子就变（' + (lp.first.seq && lp.first.seq.id) + ' → ' +
      (lp.third.seq && lp.third.seq.id) + '），再点一下停止（' + lp.stopped.voices + ' 条音）',
      lp.first.voices >= 1 && !!lp.first.seq && lp.third.voices >= 1 && !!lp.third.seq &&
      lp.third.seq.id !== lp.first.seq.id && lp.third.pick === lp.ids[2] &&
      lp.stopped.seq === null && lp.stopped.voices === 0 && lp.activeChip === lp.ids[2], libPlayRes);

    /* ---------------- 21. 简谱解析 ---------------- */
    const jpRes = await page.call(`
      var a = window.MusicKit.parseJianpu('1 1 5 5 | 6 6 5 -');
      var b = window.MusicKit.parseJianpu("T=90\\n#4 b7 0 1' 1, |");
      var c = window.MusicKit.parseJianpu('1 2 8 3');
      var d = window.MusicKit.parseJianpu('１ ２ ３， ４。５ ｜ ６’');
      var e = window.MusicKit.parseJianpu('5/ 5// 5 -');
      var f = window.MusicKit.parseJianpu('   ');
      var mi = function (r) { return r.events.map(function (x) { return x.midi; }).join(','); };
      return JSON.stringify({
        a: { ok: a.ok, midi: mi(a), beats: a.beats, bars: a.bars, notes: a.notes,
             last: a.events[a.events.length - 1].beats },
        b: { ok: b.ok, bpm: b.bpm, midi: mi(b), rests: b.rests, beats: b.beats },
        c: { ok: c.ok, line: c.error && c.error.line, col: c.error && c.error.col,
             text: window.Tunes.errorText(c) },
        d: { ok: d.ok, midi: mi(d), n: d.events.length },
        e: { ok: e.ok, dur: e.events.map(function (x) { return x.beats; }).join(','), beats: e.beats },
        f: { ok: f.ok, err: !!f.error }
      });
    `);
    const jp = JSON.parse(String(jpRes));
    check('简谱：`1 1 5 5 | 6 6 5 -` → ' + jp.a.midi + '（' + jp.a.notes +
      ' 个音 / ' + jp.a.beats + ' 拍 / ' + jp.a.bars + ' 小节，末音 ' + jp.a.last + ' 拍）',
      jp.a.ok && jp.a.midi === '60,60,67,67,69,69,67' && jp.a.notes === 7 &&
      jp.a.beats === 8 && jp.a.bars === 2 && jp.a.last === 2, jpRes);
    check('简谱：升降号 / 休止 / 高低八度 / T=BPM 都对（' + jp.b.midi + '，' +
      jp.b.bpm + ' BPM，休止 ' + jp.b.rests + ' 个）',
      jp.b.ok && jp.b.midi === '66,70,,72,48' && jp.b.bpm === 90 &&
      jp.b.rests === 1 && jp.b.beats === 5, jpRes);
    check('简谱：中文标点 / 全角数字容错（' + jp.d.midi + '）、斜杠改时值（' + jp.e.dur + '）',
      jp.d.ok && jp.d.n === 6 && jp.e.ok && jp.e.dur === '0.5,0.25,2', jpRes);
    check('简谱：错误输入给出行列位置且不崩（' + jp.c.text + '）',
      jp.c.ok === false && jp.c.line === 1 && jp.c.col === 5 &&
      /8/.test(jp.c.text) && jp.f.ok === false && jp.f.err, jpRes);

    /* ---------------- 22. 导入（简谱 / JSON） ---------------- */
    const impRes = await page.call(`
      window.MusicKit.setInstrument('guitar');
      var before = (window.Store.state.settings.songs || []).length;
      var r1 = window.MusicKit.importMusic('T=88\\n3 3 5 6 | 1\\' 6 5 6 | 5 3 5 - |', { play: true });
      await new Promise(function (x) { setTimeout(x, 400); });
      var playing = { seq: window.MusicKit.sequence(), voices: window.MusicKit.activeVoices() };
      var after = (window.Store.state.settings.songs || []).length;
      var curSong = (window.Store.state.settings.songs || [])[0] || {};
      var json = JSON.stringify({ app: 'selfwriting', version: 1, kind: 'music', item: window.MusicKit.exportSong() });
      var r2 = window.MusicKit.importMusic(json, {});
      var r3 = window.MusicKit.importMusic('1 2 8 3', {});
      var r4 = window.MusicKit.importMusic('{ not json', {});
      var r5 = window.MusicKit.importMusic('   ', {});
      var r6 = window.MusicKit.importMusic('{"songs":[{"name":"只有文字","rows":[]}]}', {});
      var r7 = window.MusicKit.importMusic('[{"name":"事件表","inst":"bass","bpm":100,"events":[{"midi":40,"beat":0,"beats":1},{"midi":43,"beat":1,"beats":2}]}]', {});
      return JSON.stringify({
        before: before, after: after,
        r1: { ok: r1.ok, kind: r1.kind, name: r1.song.name, bpm: r1.song.bpm, inst: r1.song.inst,
              notes: r1.notes, bars: r1.bars, steps: r1.steps, folded: r1.folded },
        playing: playing,
        curSong: { name: curSong.name, inst: curSong.inst, rows: (curSong.rows || []).length,
                   len: ((curSong.rows || [])[0] || []).length },
        r2: { ok: r2.ok, kind: r2.kind, name: r2.song && r2.song.name },
        r3: { ok: r3.ok, error: r3.error },
        r4: { ok: r4.ok, error: r4.error },
        r5: { ok: r5.ok, error: r5.error },
        r6: { ok: r6.ok, error: r6.error },
        r7: { ok: r7.ok, kind: r7.kind, inst: r7.song && r7.song.inst }
      });
    `);
    const imp = JSON.parse(String(impRes));
    check('导入：简谱变曲子（' + imp.r1.name + ' · ' + imp.r1.bars + ' 小节 · ' + imp.r1.notes +
      ' 个音 · ' + imp.r1.bpm + ' BPM · 音色 ' + imp.r1.inst + '）并用当前乐器立刻演奏',
      imp.r1.ok && imp.r1.kind === 'jianpu' && imp.r1.bars === 3 && imp.r1.notes === 11 &&
      imp.r1.bpm === 88 && imp.after === imp.before + 1 &&
      !!imp.playing.seq && imp.playing.seq.id === 'import' && imp.playing.voices >= 1, impRes);
    check('导入：进了 settings.songs 并成为当前曲子（' + imp.curSong.name + ' · ' +
      imp.curSong.rows + ' 行 × ' + imp.curSong.len + ' 步）',
      imp.curSong.name === imp.r1.name && imp.curSong.rows === 12 &&
      imp.curSong.len === 48 && imp.curSong.inst === 'guitar', impRes);
    check('导入：本应用导出的 JSON 能再导入（' + imp.r2.name + '）；坏输入都给中文提示且不崩',
      imp.r2.ok && imp.r2.kind === 'json' && imp.r2.name === imp.r1.name &&
      imp.r3.ok === false && /第 1 行第 5 列/.test(imp.r3.error) &&
      imp.r4.ok === false && /JSON 解析失败/.test(imp.r4.error) &&
      imp.r5.ok === false && /还没有内容/.test(imp.r5.error) &&
      imp.r6.ok === false && /没找到曲子|还原不了/.test(imp.r6.error) &&
      imp.r7.ok === true && imp.r7.inst === 'bass', impRes);

    /* ---------------- 23. 谱曲页载入示例曲 ---------------- */
    const loadRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      var before = (window.Store.state.settings.songs || []).length;
      var ld = window.MusicKit.loadTune('ode');
      var after = (window.Store.state.settings.songs || []).length;
      window.__t.go('music/compose');
      await new Promise(function (r) { setTimeout(r, 800); });
      var txt = (document.getElementById('view') || {}).innerText || '';
      return JSON.stringify({
        ld: { ok: ld.ok, bars: ld.bars, steps: ld.steps, folded: ld.folded,
              rows: ld.song ? ld.song.rows.length : 0, name: ld.song && ld.song.name },
        before: before, after: after,
        cells: document.querySelectorAll('#view .score-cell').length,
        on: document.querySelectorAll('#view .score-cell.on').length,
        barLabel: (document.querySelector('#view .bar-count') || {}).textContent || '',
        loadBtn: !!document.querySelector('#view .lab-tune-load'),
        demoBtn: /来一段示例/.test(txt),
        svg: !!document.querySelector('#view svg')
      });
    `);
    const ld = JSON.parse(String(loadRes));
    check('谱曲页：能载入示例曲（' + ld.ld.name + ' ' + ld.ld.bars + ' 小节 / ' + ld.ld.steps +
      ' 步，曲子数 ' + ld.before + '→' + ld.after + '），载入后仍是普通谱面（' +
      ld.cells + ' 格 / 本页 ' + ld.on + ' 个音）',
      ld.ld.ok && ld.ld.bars === 8 && ld.ld.steps === 128 && ld.ld.rows === 12 &&
      ld.after === ld.before + 1 && ld.cells === 208 && ld.on >= 8 &&
      /第 1\/8 小节/.test(ld.barLabel) && ld.loadBtn && ld.demoBtn && ld.svg, loadRes);
    const barRes = await page.call(`
      var btns = Array.prototype.slice.call(document.querySelectorAll('#view .score-tools button'));
      var next = null;
      btns.forEach(function (b) { if (/下一小节/.test(b.textContent)) next = b; });
      if (next) next.click();
      await new Promise(function (r) { setTimeout(r, 500); });
      return JSON.stringify({
        barLabel: (document.querySelector('#view .bar-count') || {}).textContent || '',
        on: document.querySelectorAll('#view .score-cell.on').length,
        cells: document.querySelectorAll('#view .score-cell').length,
        clicked: !!next
      });
    `);
    const bar = JSON.parse(String(barRes));
    check('谱曲页：多小节曲子能翻页（' + bar.barLabel + '，本页 ' + bar.on + ' 个音，格子仍是 ' + bar.cells + ' 个）',
      bar.clicked && /第 2\/8 小节/.test(bar.barLabel) && bar.cells === 208 && bar.on >= 4, barRes);

    /* ---------------- 24. 导入界面：真点一遍 ---------------- */
    const importUiRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music/lab', 800);
      var before = (window.Store.state.settings.songs || []).length;
      var open = document.querySelector('#view .tune-import');
      if (open) open.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 400); });
      var ta = document.querySelector('#sheetHost .import-text');
      /* 先粘错的：要出红字、弹层不关、不新增曲子 */
      if (ta) {
        ta.value = '1 2 8 3';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      var save = document.querySelector('#sheetHost .import-save');
      if (save) save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 300); });
      var msg = document.querySelector('#sheetHost .import-msg');
      var out = {
        opened: !!ta,
        placeholder: ta ? ta.getAttribute('placeholder') : null,
        badMsg: msg ? msg.textContent : '',
        badClass: msg ? msg.className : '',
        sheetOpenAfterBad: !document.getElementById('sheetHost').classList.contains('hidden'),
        songsAfterBad: (window.Store.state.settings.songs || []).length
      };
      /* 再粘对的：点「解析并试听」→ 弹层关掉 + 新曲子 + 开始演奏 */
      var ta2 = document.querySelector('#sheetHost .import-text');
      if (ta2) ta2.value = 'T=96\\n1 1 5 5 | 6 6 5 - |';
      var go = document.querySelector('#sheetHost .import-go');
      if (go) go.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 500); });
      out.sheetClosed = document.getElementById('sheetHost').classList.contains('hidden');
      out.songsAfterGood = (window.Store.state.settings.songs || []).length;
      out.before = before;
      out.seq = window.MusicKit.sequence();
      out.voices = window.MusicKit.activeVoices();
      out.curName = ((window.Store.state.settings.songs || [])[0] || {}).name;
      return JSON.stringify(out);
    `);
    const iu = JSON.parse(String(importUiRes));
    check('导入界面：粘贴简谱 → 点「解析并试听」→ 存成曲子（' + iu.before + '→' + iu.songsAfterGood +
      ' 首，' + iu.curName + '）并立刻演奏（' + iu.voices + ' 条音）；粘错时红字提示且弹层不关',
      iu.opened && !!iu.placeholder && /第 1 行第 5 列/.test(iu.badMsg) && /bad/.test(iu.badClass) &&
      iu.sheetOpenAfterBad && iu.songsAfterBad === iu.before &&
      iu.sheetClosed && iu.songsAfterGood === iu.before + 1 &&
      !!iu.seq && iu.seq.id === 'import' && iu.voices >= 1, importUiRes);

    /* ---------------- 25. MIDI 解析 ---------------- */
    const midiRes = await page.call(`
      var m1 = window.MusicKit.parseMidi(window.__t.midiBasic());
      /* 多轨 + program 25（吉他）+ running status + 60BPM */
      var m2 = window.MusicKit.parseMidi(window.__t.midiBytes([
        window.__t.track([[0, [0xff, 0x51, 0x03, 0x0f, 0x42, 0x40]], [0, [0xff, 0x2f, 0x00]]]),
        window.__t.track([
          [0, [0xc0, 25]],
          [0, [0x90, 0x40, 0x70]],
          [240, [0x40, 0x00]],
          [240, [0x90, 0x43, 0x70]],
          [240, [0x43, 0x00]],
          [0, [0xff, 0x2f, 0x00]]
        ])
      ], 480, 1));
      return JSON.stringify({
        m1: { ok: m1.ok, bpm: m1.bpm, notes: m1.notes, inst: m1.instrument,
              midi: m1.events.map(function (e) { return e.midi; }).join(','),
              beat: m1.events.map(function (e) { return e.beat; }).join(','),
              beats: m1.events.map(function (e) { return e.beats; }).join(','),
              err: m1.error },
        m2: { ok: m2.ok, bpm: m2.bpm, notes: m2.notes, inst: m2.instrument, tracks: m2.tracks,
              midi: m2.events.map(function (e) { return e.midi; }).join(','),
              beats: m2.events.map(function (e) { return e.beats; }).join(','), err: m2.error }
      });
    `);
    const md = JSON.parse(String(midiRes));
    check('MIDI 解析：最小的 120BPM 单轨 → ' + md.m1.notes + ' 个音（音高 ' + md.m1.midi +
      ' / 起点 ' + md.m1.beat + ' 拍 / 时值 ' + md.m1.beats + ' 拍），velocity=0 当 note off',
      md.m1.ok && md.m1.bpm === 120 && md.m1.notes === 3 && md.m1.midi === '60,64,67' &&
      md.m1.beat === '0,1,2' && md.m1.beats === '1,1,2' && md.m1.inst === 'piano', midiRes);
    check('MIDI 解析：多轨 + program 25 猜成吉他 + running status + tempo 生效（' +
      md.m2.bpm + ' BPM，音高 ' + md.m2.midi + '）',
      md.m2.ok && md.m2.bpm === 60 && md.m2.notes === 2 && md.m2.inst === 'guitar' &&
      md.m2.tracks === 2 && md.m2.midi === '64,67' && md.m2.beats === '0.5,0.5', midiRes);

    /* ---------------- 26. MIDI：坏文件给中文提示且不崩 ---------------- */
    const midiBadRes = await page.call(`
      var errs = [];
      var onErr = function (e) { errs.push(String(e.message || e)); };
      window.addEventListener('error', onErr);
      var out = {
        random: window.MusicKit.parseMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])),
        empty: window.MusicKit.parseMidi(new Uint8Array(0)),
        noNote: window.MusicKit.parseMidi(window.__t.midiBytes([window.__t.track([
          [0, [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]], [0, [0xff, 0x2f, 0x00]]
        ])], 480, 0)),
        drums: window.MusicKit.parseMidi(window.__t.midiBytes([window.__t.track([
          [0, [0x99, 0x24, 0x64]], [10, [0x89, 0x24, 0x40]],
          [0, [0x99, 0x26, 0x64]], [10, [0x89, 0x26, 0x40]],
          [0, [0xff, 0x2f, 0x00]]
        ])], 480, 0)),
        smpte: window.MusicKit.parseMidi(window.__t.midiBytes([window.__t.track([
          [0, [0x90, 0x3c, 0x40]], [10, [0x80, 0x3c, 0x00]], [0, [0xff, 0x2f, 0x00]]
        ])], 0xe728, 0)),
        cut: window.MusicKit.parseMidi(new Uint8Array(window.__t.midiBasic().buffer, 0, 30))
      };
      /* 走一遍导入管线：坏 MIDI 文件也要给中文提示、不新增曲子 */
      var before = (window.Store.state.settings.songs || []).length;
      var r1 = window.MusicKit.importBuffer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), 'x.mid', {});
      var r2 = window.MusicKit.importBuffer(new Uint8Array(0), 'empty.mid', {});
      var after = (window.Store.state.settings.songs || []).length;
      window.removeEventListener('error', onErr);
      return JSON.stringify({
        errs: errs, before: before, after: after,
        msgs: [out.random.error, out.empty.error, out.noNote.error, out.drums.error, out.smpte.error, out.cut.error],
        r1: { ok: r1.ok, error: r1.error }, r2: { ok: r2.ok, error: r2.error }
      });
    `);
    const mb = JSON.parse(String(midiBadRes));
    check('MIDI：坏文件都给中文提示且不崩（' + mb.msgs.length + ' 种：' +
      mb.msgs.map((m) => String(m).slice(0, 12)).join(' / ') + '…）',
      mb.msgs.every((m) => typeof m === 'string' && m.length > 4 && /[\u4e00-\u9fa5]/.test(m)) &&
      mb.r1.ok === false && /MThd|MIDI/.test(mb.r1.error) &&
      mb.r2.ok === false && /空/.test(mb.r2.error) &&
      mb.after === mb.before && mb.errs.length === 0, midiBadRes);

    /* ---------------- 27. MIDI 导入：进 songs 并能演奏 + 超长截取 ---------------- */
    const midiImpRes = await page.call(`
      window.MusicKit.setInstrument('epiano');
      var before = (window.Store.state.settings.songs || []).length;
      var r = window.MusicKit.importBuffer(window.__t.midiBasic(), '小测试.mid', { play: true });
      await new Promise(function (x) { setTimeout(x, 400); });
      var playing = { seq: window.MusicKit.sequence(), voices: window.MusicKit.activeVoices() };
      var after = (window.Store.state.settings.songs || []).length;
      var song = (window.Store.state.settings.songs || [])[0] || {};
      /* 真的 File 对象（走 FileReader 那条路） */
      var file = new File([window.__t.midiBasic()], '真实文件.mid', { type: 'audio/midi' });
      var r2 = await window.MusicKit.importFile(file, {});
      /* 2100 个音：应截取前 2000 并提示 */
      var evs = [];
      for (var i = 0; i < 2100; i++) {
        evs.push([i === 0 ? 0 : 10, [0x90, 60 + (i % 12), 0x50]]);
        evs.push([10, [0x80, 60 + (i % 12), 0x40]]);
      }
      evs.push([0, [0xff, 0x2f, 0x00]]);
      var r3 = window.MusicKit.importBuffer(window.__t.midiBytes([window.__t.track(evs)], 480, 0), '很长.mid', {});
      return JSON.stringify({
        before: before, after: after,
        r: { ok: r.ok, kind: r.kind, name: r.song.name, bpm: r.song.bpm, notes: r.notes,
             bars: r.bars, inst: r.song.inst, truncated: !!r.truncated },
        playing: playing,
        song: { name: song.name, inst: song.inst, rows: (song.rows || []).length,
                len: ((song.rows || [])[0] || []).length, src: song.src },
        r2: { ok: r2.ok, name: r2.song && r2.song.name, error: r2.error },
        r3: { ok: r3.ok, notes: r3.notes, truncated: !!r3.truncated, limit: r3.limit, bars: r3.bars }
      });
    `);
    const mi = JSON.parse(String(midiImpRes));
    check('MIDI 导入：' + mi.r.name + '（' + mi.r.notes + ' 个音 · ' + mi.r.bars + ' 小节 · ' +
      mi.r.bpm + ' BPM）进 songs（' + mi.before + '→' + mi.after + '）并用曲子自己的音色演奏',
      mi.r.ok && mi.r.kind === 'midi' && mi.r.name === '小测试' && mi.r.notes === 3 &&
      mi.r.bpm === 120 && mi.after === mi.before + 1 &&
      !!mi.playing.seq && mi.playing.seq.id === 'import' && mi.playing.voices >= 1 &&
      mi.song.name === '小测试' && mi.song.rows === 12 && mi.song.len >= 16, midiImpRes);
    check('MIDI 导入：File 对象也能读（' + mi.r2.name + '）；2100 个音截取到 ' + mi.r3.notes +
      ' 个并标记 truncated（上限 ' + mi.r3.limit + '）',
      mi.r2.ok && mi.r2.name === '真实文件' &&
      mi.r3.ok && mi.r3.notes === 2000 && mi.r3.truncated === true && mi.r3.limit === 2000, midiImpRes);

    /* ---------------- 28. 选择文件这条路（用假的选择器） ---------------- */
    const fileRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music/lab', 700);
      var open = document.querySelector('#view .tune-import');
      if (open) open.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 350); });
      var out = {
        tabs: Array.prototype.slice.call(document.querySelectorAll('#sheetHost .import-tabs .chip'))
          .map(function (c) { return c.textContent; }),
        panes: document.querySelectorAll('#sheetHost .import-pane').length,
        pickButtons: ['pick-midi', 'pick-text', 'pick-json'].map(function (c) {
          return !!document.querySelector('#sheetHost .' + c);
        }),
        hasPasteText: !!document.querySelector('#sheetHost .import-text'),
        helpText: (document.querySelector('#sheetHost .import-help') || {}).textContent || ''
      };
      /* 切到「选择文件」「说明」两个面板 */
      var chips = document.querySelectorAll('#sheetHost .import-tabs .chip');
      if (chips[1]) chips[1].click();
      await new Promise(function (r) { setTimeout(r, 200); });
      var filePane = document.querySelector('#sheetHost .import-pane:not(.hidden)');
      out.filePaneVisible = !!filePane && !!filePane.querySelector('.pick-midi');
      if (chips[2]) chips[2].click();
      await new Promise(function (r) { setTimeout(r, 200); });
      var helpPane = document.querySelector('#sheetHost .import-pane:not(.hidden)');
      out.helpPaneText = helpPane ? helpPane.innerText : '';
      /* 现在用假的选择器走「选择 MIDI 文件」按钮 */
      var before = (window.Store.state.settings.songs || []).length;
      var origSmart = window.IOApi.pickFilesSmart;
      var origPick = window.IOApi.pickFile;
      window.IOApi.pickFilesSmart = function () {
        return Promise.resolve([{ name: '按钮选的.mid', bytes: window.__t.midiBasic() }]);
      };
      if (chips[1]) chips[1].click();
      await new Promise(function (r) { setTimeout(r, 150); });
      var mb = document.querySelector('#sheetHost .pick-midi');
      out.hasMidBtn = !!mb;
      if (mb) mb.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 900); });
      out.songsAfterMidi = (window.Store.state.settings.songs || []).length;
      out.before = before;
      out.sheetClosed = document.getElementById('sheetHost').classList.contains('hidden');
      out.curName = ((window.Store.state.settings.songs || [])[0] || {}).name;
      out.seq = window.MusicKit.sequence();
      /* 简谱 .txt 与 .json 也走同一条路 */
      var txt = 'T=80\\n1 2 3 4 | 5 - - - |';
      var rTxt = await window.MusicKit.importFile({ name: '我的歌谱.txt', bytes: new TextEncoder().encode(txt) }, {});
      var json = JSON.stringify({ app: 'selfwriting', version: 1, kind: 'music', item: window.MusicKit.exportSong() });
      var rJson = await window.MusicKit.importFile({ name: '我的曲子.json', bytes: new TextEncoder().encode(json) }, {});
      window.IOApi.pickFilesSmart = origSmart;
      window.IOApi.pickFile = origPick;
      out.txt = { ok: rTxt.ok, kind: rTxt.kind, name: rTxt.song && rTxt.song.name, bpm: rTxt.song && rTxt.song.bpm };
      out.json = { ok: rJson.ok, kind: rJson.kind, name: rJson.song && rJson.song.name };
      return JSON.stringify(out);
    `);
    const fr = JSON.parse(String(fileRes));
    check('导入弹层：三条路径（' + fr.tabs.join('/') + '）+ 说明里写明 .mid/.midi/.txt/.md/.json',
      fr.tabs.join(',') === '粘贴,选择文件,说明' && fr.panes === 3 &&
      fr.pickButtons.every(Boolean) && fr.hasPasteText &&
      /简谱/.test(fr.helpText) && fr.filePaneVisible &&
      /\.mid/.test(fr.helpPaneText) && /\.midi/.test(fr.helpPaneText) &&
      /\.txt/.test(fr.helpPaneText) && /\.md/.test(fr.helpPaneText) &&
      /\.json/.test(fr.helpPaneText) && /简谱写法/.test(fr.helpPaneText) &&
      /MIDI 说明/.test(fr.helpPaneText), fileRes);
    check('选择文件：点「选择 MIDI 文件」真的导入（' + fr.before + '→' + fr.songsAfterMidi +
      ' 首，' + fr.curName + '）并开始演奏；.txt 简谱（' + fr.txt.name + '）与 .json（' +
      fr.json.name + '）也走得通',
      fr.hasMidBtn && fr.songsAfterMidi === fr.before + 1 && fr.curName === '按钮选的' &&
      fr.sheetClosed && !!fr.seq && fr.seq.id === 'import' &&
      fr.txt.ok && fr.txt.kind === 'jianpu' && fr.txt.name === '我的歌谱' && fr.txt.bpm === 80 &&
      fr.json.ok && fr.json.kind === 'json' && fr.json.name === '我的歌谱', fileRes);

    /* ---------------- 29. 导出 JSON 真的走下载通道 ---------------- */
    const expRes = await page.call(`
      var got = null;
      var orig = window.IOApi.download;
      window.IOApi.download = function (name, content, mime) { got = { name: name, mime: mime, len: String(content || '').length }; return true; };
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music/lab', 700);
      var btn = document.querySelector('#view .tune-export');
      if (btn) btn.dispatchEvent(new MouseEvent('click', { click: true, bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 300); });
      window.IOApi.download = orig;
      var payload = null;
      try { payload = JSON.parse(JSON.stringify(window.MusicKit.exportSong())); } catch (e) { payload = null; }
      return JSON.stringify({
        clicked: !!btn, got: got,
        song: payload ? { name: payload.name, rows: payload.rows.length, inst: payload.inst } : null
      });
    `);
    const ex = JSON.parse(String(expRes));
    check('导出我的曲子：走的是文件下载通道（' + (ex.got && ex.got.name) + ' · ' +
      (ex.got && ex.got.mime) + ' · ' + (ex.got && ex.got.len) + ' 字节），不再是只复制到剪贴板',
      ex.clicked && !!ex.got && /\.json$/.test(ex.got.name) && ex.got.mime === 'application/json' &&
      ex.got.len > 50 && !!ex.song && ex.song.rows === 12, expRes);

    /* ---------------- 30. 新增的民歌/童谣：出处与音数小节数 ---------------- */
    const folkRes = await page.call(`
      var list = window.MusicKit.tunes();
      var names = list.map(function (t) { return t.name; });
      var need = ['小白菜', '凤阳花鼓', '阿里郎', '樱花', '绿袖子', '送别', '玛丽有只小羊羔', '伦敦桥'];
      var missing = need.filter(function (n) { return names.indexOf(n) < 0; });
      var withSource = list.filter(function (t) { return !!t.source && t.source.length > 8; }).length;
      var pd = list.filter(function (t) { return /公有领域|原创|可自由使用/.test(t.source); }).length;
      function info(id) {
        var t = window.MusicKit.tuneInfo(id);
        return t ? { name: t.name, tag: t.tag, inst: t.inst, notes: t.notes, bars: t.bars, beats: t.beats, source: t.source } : null;
      }
      /* 不该出现的东西：有明确近现代作者、仍在保护期的作品 */
      var banned = ['沂蒙山小调', '康定情歌', '苏武牧羊', '让我们荡起双桨', '卖报歌', '小燕子', '我的祖国', '七里香'];
      var hit = banned.filter(function (n) { return names.join(',').indexOf(n) >= 0; });
      return JSON.stringify({
        count: list.length, missing: missing, withSource: withSource, pd: pd, hit: hit,
        baicai: info('baicai'), sakura: info('sakura'),
        tags: list.map(function (t) { return t.tag; })
      });
    `);
    const folk = JSON.parse(String(folkRes));
    check('曲库：共 ' + folk.count + ' 首，新增 8 首民歌/童谣齐全（' + folk.missing.length +
      ' 首缺失），每首都有出处（' + folk.withSource + '/' + folk.count + '，其中 ' +
      folk.pd + ' 首写明公有领域/原创）',
      folk.count >= 15 && folk.missing.length === 0 && folk.withSource === folk.count &&
      folk.pd === folk.count && folk.hit.length === 0, folkRes);
    check('曲库：抽查两首新曲——' + folk.baicai.name + '（' + folk.baicai.notes + ' 音 / ' +
      folk.baicai.bars + ' 小节 · ' + folk.baicai.tag + ' · 推荐 ' + folk.baicai.inst + '）、' +
      folk.sakura.name + '（' + folk.sakura.notes + ' 音 / ' + folk.sakura.bars + ' 小节）',
      folk.baicai.notes === 24 && folk.baicai.bars === 8 && folk.baicai.tag === '民歌' &&
      folk.sakura.notes === 24 && folk.sakura.bars === 8 &&
      /河北民歌/.test(folk.baicai.source) && /公有领域/.test(folk.baicai.source) &&
      /日本传统民谣/.test(folk.sakura.source), folkRes);

    /* ---------------- 31. 曲库：每首曲子自己的音色（下拉 → 立刻重放 + 记住） ---------------- */
    const libInstRes = await page.call(`
      window.MusicKit.setInstrument('piano');
      window.MusicKit.stopTune();
      await window.__t.go('music/lab', 800);
      var chips = document.querySelectorAll('#view .tune-chip');
      var target = null;
      chips.forEach(function (c) { if (c.getAttribute('data-tune') === 'baicai') target = c; });
      if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 450); });
      var out = { hasChip: !!target, defInst: window.MusicKit.tuneInstrument('baicai'),
        firstSeq: window.MusicKit.sequence() };
      var sel = document.querySelector('#view .tune-inst');
      out.hasSelect = !!sel;
      out.options = sel ? sel.options.length : 0;
      out.selectValue = sel ? sel.value : null;
      if (sel) {
        sel.value = 'bass';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise(function (r) { setTimeout(r, 450); });
      out.afterChange = {
        inst: window.MusicKit.tuneInstrument('baicai'),
        seq: window.MusicKit.sequence(),
        stored: (window.Store.state.settings.musicTuneInst || {}).baicai
      };
      /* 换到别的曲子再换回来：音色要记住 */
      var chips2 = document.querySelectorAll('#view .tune-chip');
      var other = null;
      chips2.forEach(function (c) { if (c.getAttribute('data-tune') === 'ode') other = c; });
      if (other) other.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 300); });
      var chips3 = document.querySelectorAll('#view .tune-chip');
      var back = null;
      chips3.forEach(function (c) { if (c.getAttribute('data-tune') === 'baicai') back = c; });
      if (back) back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 450); });
      out.afterBack = { seq: window.MusicKit.sequence(), sel: (document.querySelector('#view .tune-inst') || {}).value };
      window.MusicKit.stopTune();
      return JSON.stringify(out);
    `);
    const li = JSON.parse(String(libInstRes));
    check('曲库音色：下拉可选（' + li.options + ' 档），选贝斯后立刻用贝斯重放（' +
      (li.firstSeq && li.firstSeq.inst) + ' → ' + (li.afterChange.seq && li.afterChange.seq.inst) +
      '）并记住（换走再回来仍是 ' + (li.afterBack.seq && li.afterBack.seq.inst) + '）',
      li.hasChip && li.hasSelect && li.options === 5 && li.defInst === 'epiano' &&
      li.firstSeq && li.firstSeq.inst === 'epiano' && li.selectValue === 'epiano' &&
      li.afterChange.inst === 'bass' && li.afterChange.seq && li.afterChange.seq.inst === 'bass' &&
      li.afterChange.stored === 'bass' &&
      li.afterBack.seq && li.afterBack.seq.inst === 'bass' && li.afterBack.sel === 'bass', libInstRes);

    /* ---------------- 32. 曲子音色：谱曲页 / 我的曲子都能改并落盘 ---------------- */
    const songInstRes = await page.call(`
      window.MusicKit.stopTune();
      window.MusicKit.setInstrument('piano');
      await window.__t.go('music/compose', 800);
      var out = {};
      var sel = document.querySelector('#view .song-inst');
      out.hasComposeSelect = !!sel;
      out.composeValue = sel ? sel.value : null;
      if (sel) {
        sel.value = 'guitar';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise(function (r) { setTimeout(r, 500); });
      out.afterCompose = {
        songInst: ((window.Store.state.settings.songs || [])[0] || {}).inst,
        stored: window.MusicKit.songInstrument(),
        seq: window.MusicKit.sequence()
      };
      /* 我的曲子：每行显示音色 + 自带下拉 */
      await window.__t.go('music/songs', 700);
      var rowSel = document.querySelector('#view .row .row-inst');
      out.rowSelects = document.querySelectorAll('#view .row .row-inst').length;
      out.rowValue = rowSel ? rowSel.value : null;
      out.rowSub = (document.querySelector('#view .row .row-sub') || {}).textContent || '';
      if (rowSel) {
        rowSel.value = 'epiano';
        rowSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise(function (r) { setTimeout(r, 500); });
      out.afterRow = {
        songInst: ((window.Store.state.settings.songs || [])[0] || {}).inst,
        seq: window.MusicKit.sequence()
      };
      /* 离开再回来：还是这个音色 */
      await window.__t.go('music', 500);
      await window.__t.go('music/songs', 600);
      out.afterReturn = {
        songInst: ((window.Store.state.settings.songs || [])[0] || {}).inst,
        sel: (document.querySelector('#view .row .row-inst') || {}).value || null,
        sub: (document.querySelector('#view .row .row-sub') || {}).textContent || ''
      };
      window.MusicKit.stopTune();
      return JSON.stringify(out);
    `);
    const si = JSON.parse(String(songInstRes));
    check('曲子音色：谱曲页顶部下拉能改（' + si.composeValue + ' → ' + si.afterCompose.songInst +
      '）并落盘到 settings.songs，改完立刻用它重放（' + (si.afterCompose.seq && si.afterCompose.seq.id) + '）',
      si.hasComposeSelect && si.afterCompose.songInst === 'guitar' &&
      si.afterCompose.stored === 'guitar' &&
      si.afterCompose.seq && /^song:/.test(si.afterCompose.seq.id) &&
      si.afterCompose.seq.inst === 'guitar', songInstRes);
    check('我的曲子：每行显示音色 + 自带下拉（' + si.rowSelects + ' 个），改成电钢后 settings.songs 落盘（' +
      si.afterRow.songInst + '），离开再回来仍是 ' + si.afterReturn.songInst +
      '（行里显示「' + String(si.afterReturn.sub).replace(/^.*音色/, '音色') + '」）',
      si.rowSelects >= 1 && si.rowValue === 'guitar' && /音色 吉他/.test(si.rowSub) &&
      si.afterRow.songInst === 'epiano' && si.afterRow.seq && si.afterRow.seq.inst === 'epiano' &&
      si.afterReturn.songInst === 'epiano' && si.afterReturn.sel === 'epiano' &&
      /音色 电钢琴/.test(si.afterReturn.sub), songInstRes);

    /* ---------------- 33. MIDI 猜到的音色存进曲子 ---------------- */
    const midiInstRes = await page.call(`
      window.MusicKit.stopTune();
      window.MusicKit.setInstrument('piano');
      var mid = window.__t.midiBytes([
        window.__t.track([[0, [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]], [0, [0xff, 0x2f, 0x00]]]),
        window.__t.track([
          [0, [0xc0, 25]],
          [0, [0x90, 0x40, 0x70]],
          [480, [0x80, 0x40, 0x00]],
          [0, [0x90, 0x43, 0x70]],
          [480, [0x80, 0x43, 0x00]],
          [0, [0xff, 0x2f, 0x00]]
        ])
      ], 480, 1);
      var r = window.MusicKit.importBuffer(mid, '吉他谱.mid', { play: true });
      await new Promise(function (x) { setTimeout(x, 400); });
      var song = (window.Store.state.settings.songs || [])[0] || {};
      var seq = window.MusicKit.sequence();
      window.MusicKit.stopTune();
      return JSON.stringify({
        ok: r.ok, kind: r.kind, inst: r.song && r.song.inst, instrument: r.instrument,
        songInst: song.inst, songName: song.name, seq: seq,
        stored: window.MusicKit.songInstrument(song.id)
      });
    `);
    const mii = JSON.parse(String(midiInstRes));
    check('MIDI 音色：program 25 猜成吉他并存进曲子（' + mii.songName + '.inst = ' + mii.songInst +
      '），导入后就用吉他演奏（' + (mii.seq && mii.seq.inst) + '）',
      mii.ok && mii.kind === 'midi' && mii.inst === 'guitar' && mii.instrument === 'guitar' &&
      mii.songInst === 'guitar' && mii.stored === 'guitar' &&
      mii.seq && mii.seq.inst === 'guitar' && mii.seq.id === 'import', midiInstRes);

    /* ---------------- 控制台报错 ---------------- */
    const errs = page.errors().filter((e) => !/favicon/i.test(e.text));
    check('整轮检查没有控制台报错', errs.length === 0,
      errs.slice(0, 6).map((e) => e.type + ': ' + e.text).join(' | '));

    await page.shot('shots/test-music.png');
  } catch (e) {
    failed++;
    console.log('FAIL  运行异常: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ⏎ ') : e));
  } finally {
    try { if (page) page.close(); } catch (e) { /* noop */ }
    try { if (browser && browser.proc) browser.proc.kill(); } catch (e) { /* noop */ }
  }

  console.log('');
  console.log('===== 音乐模块：' + passed + '/' + (passed + failed) + ' 通过 =====');
  if (failed) {
    console.log('（Edge: ' + (() => { try { return findEdge(); } catch (e) { return '未找到'; } })() + '）');
    process.exitCode = 1;
  }
})();
