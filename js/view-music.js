/* ==========================================================================
   selfwriting · view-music.js
   音乐创作：钢琴键 / 谱曲 / 歌词 / 我的曲子 / 试音台
     · 钢琴键：点按即响（Web Audio 合成 / 真采样，完全离线）
     · 试音台：四步走 —— 选乐器 / 弹一弹 / 调音色（音量·延音·明亮度 + 电平表 + 示例乐句）
              / 曲库（9 首示例曲 + 导入音乐）
     · 曲库（js/tunes.js）：公有领域传统曲调与本应用原创练习曲，可试听、可载入谱曲；
              导入支持「简谱文本」与「本应用导出的 JSON」，解析失败会给出行列位置。
              用户粘贴的曲谱只在本机解析与保存（settings.songs），不上传、不内置分发。
     · 谱曲：网格步进谱，点格子放音；可试听、可调速、可换音色；多小节曲子可翻小节
     · 歌词：一句一行，跟谱子一起保存
     · 导出：JSON（可再导入）/ 文本歌谱（音名 + 歌词，方便给别人看）

   音色分两条路：
     ① 真采样（首选）：assets/samples/ 里的 FluidR3_GM 采样（CC BY 3.0，构建期由
        tools/fetch-samples.js 下载）。钢琴 / 电钢琴 / 吉他 / 贝斯各 8–15 个音，
        隔 3 个半音一个 → 用 playbackRate 变调最多 ±1.5 个半音，听不出「变声器」味。
        运行期只读本地文件、不联网；解码时裁短 + 归一化，音色仍走本乐器总线。
     ② 内置合成（兜底）：采样缺失 / 解码失败 / 被 useSamples({}) 关掉时自动接管，
        所以离线、首次运行、老机型都不会因为采样出不了声。

   合成器（全部手写，不加载任何音频文件、不联网、不用 base64）：
     · 钢琴   8/6 个泛音分量（振幅 ~ k^-1.35，真实钢琴的泛音配比）
              + 泛音各自不同的衰减（音头亮、尾巴暖）+ 一对微失谐（拍频）
              + 琴槌噪声 + 共鸣弦「嗡」+ 总线上的音板共振
     · 电钢琴 两对 FM 算子：1:1 的木质「芯」+ 14:1 只活 60ms 的音叉「叮」
              + 总线上一只 5.2Hz 的颤音（Rhodes 的经典音箱颤音）
     · 吉他   数字波导（Karplus–Strong）：噪声激励（正好一个周期）+ 延迟线 +
              阻尼低通 + 色散全通（全通只改相位 → 轻微的「非谐性」，钢弦的味道）
              外加 200/400/2.5k 的琴体共振
              延迟线长度按采样率算准，并扣掉滤波器在基频处的相位延迟
     · 贝斯   同一套波导，阻尼更低，叠一条基频 + 手指触弦的低频「闷响」+ 总线极浅饱和
     · 鼓组   底鼓（点击 + 快速扫频 + 槌头）/ 军鼓（鼓皮 + 裂响 + 沙尾）
              / 闭镲·开镲（808 式六个非谐方波过高通 → 金属味）
              / 吊镲（非谐方波 + 两层噪声 + 慢速闪烁共振）/ 桶鼓 / 拍手 / 边击 / 牛铃
     · 总线   干/湿 → 卷积混响（现场用噪声+指数衰减算出的脉冲响应）
              → 压缩 → 限制 → 总音量 → 输出（另有分析器给电平表）

   三条硬保险（针对「吉他点一下响个不停」）：
     1. 时长表：吉他 0.35–0.6s 到 −40dB、0.9s 静音；贝斯 0.5–0.8s / 1.3s；
        钢琴 ≤2.5s、电钢 ≤2.4s。采样路径用同一张表（录音自身的尾音会被包络削掉）；
     2. 单音抢占：吉他/贝斯再按下一个音时，上一声 45ms 淡出（30ms 内的算和弦，一起响）；
     3. 每条音都有寿命上限，到点先淡出、再断开全部节点；stopAll() 立刻收掉所有音
        （换乐器、离开音乐页、切后台都会调用它）。

   噪声控制：起音噪声 ≤8ms / ≤0.06（1.2kHz 以上高通后再低通，只在起音出现）；
   波导激励只保留一个周期，之后完全静音；拨弦类混响送出压低（吉他 0.12 / 贝斯 0.03）；
   采样通道 7kHz 低通；配平整体留 3dB 余量，贝斯总线的 tanh 浅到常态不失真。
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const Store = global.Store;
  const UI = global.UI;
  /* 示例曲库 + 简谱解析（js/tunes.js）。拿不到也不影响其它功能：整块自动隐藏 */
  const Tunes = global.Tunes || null;
  /* 文件选择/下载走 IO（io.js 暴露成 IOApi；早期名字是 IO，两个都认） */
  function ioApi() { return global.IOApi || global.IO || null; }

  /* ================================================================== */
  /* 音高表                                                             */
  /* ================================================================== */
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const KEYS = 24;              // 一个键盘 = 两个八度（14 白 + 10 黑）
  const BASE_MIDI = 60;         // 默认键盘最低音 = C4

  function freqOf(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function nameOf(midi) {
    const i = Math.round(midi) - BASE_MIDI;
    const oct = 4 + Math.floor(i / 12);
    return NOTE_NAMES[((i % 12) + 12) % 12] + oct;
  }
  function pcOf(midi) { return ((Math.round(midi) - BASE_MIDI) % 12 + 12) % 12; }
  function isBlack(midi) { return NOTE_NAMES[pcOf(midi)].indexOf('#') >= 0; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function round3(v) { return Math.round(Number(v) * 1000) / 1000; }

  /* ================================================================== */
  /* 声音状态（可存进设置，重开也记得）                                  */
  /* ================================================================== */
  const TUNE_DEFAULT = { volume: 0.8, sustain: 0.35, brightness: 0.6 };
  const tune = { volume: TUNE_DEFAULT.volume, sustain: TUNE_DEFAULT.sustain, brightness: TUNE_DEFAULT.brightness };
  let tuneLoaded = false;

  function loadTune() {
    if (tuneLoaded) return;
    tuneLoaded = true;
    let s = null;
    try { s = Store.state.settings.musicTune; } catch (e) { s = null; }
    if (s && typeof s === 'object') {
      tune.volume = clamp(Number(s.volume), 0, 1);
      tune.sustain = clamp(Number(s.sustain), 0, 1);
      if (!isNaN(Number(s.brightness))) tune.brightness = clamp(Number(s.brightness), 0, 1);
    }
    if (isNaN(tune.volume)) tune.volume = TUNE_DEFAULT.volume;
    if (isNaN(tune.sustain)) tune.sustain = TUNE_DEFAULT.sustain;
    if (isNaN(tune.brightness)) tune.brightness = TUNE_DEFAULT.brightness;
  }
  function saveTune() {
    loadTune();
    try {
      Store.setSetting('musicTune', {
        volume: tune.volume, sustain: tune.sustain, brightness: tune.brightness
      });
    } catch (e) { /* 存不了就只在本次会话里生效 */ }
  }

  /* ================================================================== */
  /* 混音常量：想换听感，改这一段就够了（都是凭耳朵调的）                 */
  /* ================================================================== */
  const MIX = {
    master: 0.85,          // 总输出上限（还要再乘用户设的音量）
    wet: 0.20,             // 混响湿度：15%–25% 之间最自然
    irSeconds: 1.5,        // 程序生成脉冲响应的长度（1.2–1.8s）
    irDecay: 2.6,          // 尾巴衰减指数：越大尾巴越短、越干
    preDelayMs: 18,        // 混响预延迟：给直达声留出位置，声音更「贵」
    comp: { threshold: -16, knee: 18, ratio: 2.6, attack: 0.006, release: 0.18 },
    limiter: { threshold: -1.2, knee: 0.5, ratio: 20, attack: 0.002, release: 0.10 }
  };

  /* 每条乐器的配平：让五种乐器响度接近，谁也不炸耳朵。
     整体留 3dB 余量（−3dB ≈ ×0.708）：压缩器/限制器在常态下不出力，就不会有「糊」的失真 */
  const TRIM = { piano: 0.64, epiano: 0.64, guitar: 0.71, bass: 0.71, drums: 0.64 };
  /* 每条乐器送进混响的量：拨弦类要「干」（噪声与糊音的来源之一），电钢多一点（电味） */
  const REV_SEND = { piano: 0.24, epiano: 0.30, guitar: 0.12, bass: 0.03, drums: 0.16 };

  /* 发声上限与寿命上限（秒）：防「点一下响个不停」的第二道闸 */
  const MAX_VOICES = 20;
  const MAX_PER_INST = { piano: 12, epiano: 10, guitar: 10, bass: 6, drums: 14 };
  const VOICE_CAP = { piano: 2.5, epiano: 2.4, guitar: 1.0, bass: 1.4, drums: 3.2 };

  /* ---------------------------------------------------------------- */
  /* 每条音的时长表（秒）——合成路径与采样路径共用同一张表，             */
  /* 所以「换成采样」不会让音变长，两条路径的时长永远一致。              */
  /*   t40  ：衰减到 −40dB 的时间（听感上「这一声过去了」）              */
  /*   life ：强制静音的时间（到点淡出 + 断开节点，绝不拖尾）            */
  /* 吉他 0.35–0.6s 到 −40dB、0.9s 静音；贝斯 0.5–0.8s / 1.3s           */
  /* ---------------------------------------------------------------- */
  const DECAY = {
    piano: { base: 1.90, slope: 0.012, min: 0.90, max: 1.95, cap: 2.50 },
    epiano: { base: 1.60, slope: 0.010, min: 0.85, max: 1.65, cap: 2.40 },
    guitar: { base: 0.68, slope: 0.0030, min: 0.42, max: 0.72, cap: 1.00 },
    bass: { base: 0.98, slope: 0.008, min: 0.62, max: 1.00, cap: 1.40 }
  };
  const T40_RATIO = 2 / 3;               // 指数衰减：−40dB 落在 −60dB 的 2/3 处
  const SUS_LO = 0.72, SUS_HI = 0.56;    // 延音滑杆对时长的缩放：0.72 + sus×0.56

  /** 某件乐器某个音高的时长配方（纯计算，测试和调试接口都读它） */
  function decayOf(id, midi) {
    const d = DECAY[id];
    if (!d) return { t60: 0.6, t40: 0.4, life: 0.9, cap: 1.2, sustain: round3(susAmt()) };
    const m = Number(midi);
    const at = isNaN(m) ? 60 : clamp(m, 12, 120);
    const sus = susAmt();
    const raw = clamp(d.base - (at - 40) * d.slope, d.min, d.max);
    const t60 = round3(clamp(raw * (SUS_LO + sus * SUS_HI), d.min * 0.75, d.max));
    const t40 = round3(t60 * T40_RATIO);
    const life = round3(Math.min(t60 * 1.15 + 0.15, d.cap));
    return { t60: t60, t40: t40, life: life, cap: d.cap, sustain: round3(sus) };
  }

  /* 单音抢占：吉他/贝斯是「一件乐器一条线」，新的一拨进来时上一声要淡出。
     30ms 内连着按下的音算「和弦/扫弦」，一起响；一次扫弦最长 200ms。 */
  const CHORD_MS = 30;
  const CHORD_SPAN_MS = 200;
  const STEAL_FADE = 0.045;              // 被抢占的音 45ms 淡出（30–80ms 区间内）
  const MONO_INST = { guitar: true, bass: true };
  const lastStrike = {};                 // id → { t, last, n }

  /* 拨弦（吉他/贝斯）的物理常数 */
  const PLUCK = {
    minLoopSamples: 129.5, // 环路最短延迟：Web Audio 反馈环的下限是一个渲染量子(128 样本)
    guitarDamp: { mul: 26, min: 1500, max: 7000, q: 0.6 },
    bassDamp: { mul: 20, add: 700, min: 1000, max: 2600, q: 0.6 },
    dispMul: 16,           // 色散全通：fc = 16 × 基频（只改相位 → 轻微非谐性）
    dispQ: 0.45,
    bodyFormants: [                     // 钢弦吉他的琴体共振（200 / 400 / 2.5k）
      { hz: 200, q: 1.0, gain: 5.5 },
      { hz: 400, q: 1.4, gain: 3.5 },
      { hz: 2500, q: 1.1, gain: 3.0 }
    ],
    bassFormants: [
      { hz: 70, q: 1.0, gain: 3.0 },
      { hz: 160, q: 1.2, gain: 2.2 }
    ]
  };

  /* ================================================================== */
  /* 音频总线                                                           */
  /*                                                                    */
  /*  每条乐器 ─┬─ 干路 ────────────────────────────┐                   */
  /*            └─ 湿路 → 预延迟 → 卷积混响 → 湿配平 ┴→ 压缩 → 限制 →    */
  /*                                           总音量 ─┬→ 输出          */
  /*                                                   └→ 分析器（电平表）*/
  /* ================================================================== */
  let actx = null;
  let master = null;          // 总音量
  let analyser = null;        // 电平表用的旁路
  let levelBuf = null;
  let dryBus = null;          // 干路汇总
  let wetBus = null;          // 湿路汇总（→ 预延迟 → 卷积）
  let wetTrim = null;         // 湿度配平
  let preDelay = null;
  let conv = null;            // ConvolverNode：程序生成的脉冲响应
  let comp = null;            // DynamicsCompressorNode：总线压缩
  let limiter = null;         // DynamicsCompressorNode：限制器（防和弦/鼓爆表）
  const chanIn = {};          // 每条乐器的输入节点（各条音接这里）
  const chanTrim = {};        // 每条乐器的配平
  const chanWet = {};         // 每条乐器的混响送出
  let noiseBuf = null;
  let audioBroken = false;    // 环境完全没有音频（无头浏览器）时不再重试
  const burstCache = { key: 0, buf: null };

  /* 建好的节点清单：调试接口 / 自动化检查读它，确认链路真的接上了 */
  const GRAPH = { built: false, nodes: [], chain: '', reverb: null, compressor: null, limiter: null };

  function buildNoise(ctx) {
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * 程序生成的混响脉冲响应：噪声 × 指数衰减 + 几个早期反射。
   * 立体声两条尾巴略有差异 → 有宽度。不下载任何音频文件。
   */
  function buildImpulse(ctx, seconds, decay) {
    const sr = ctx.sampleRate;
    const len = Math.max(64, Math.floor(sr * seconds));
    const buf = ctx.createBuffer(2, len, sr);
    const tapsA = [0.011, 0.019, 0.027, 0.041, 0.058, 0.079];
    const tapsB = [0.013, 0.023, 0.031, 0.047, 0.063, 0.083];
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
      const taps = c === 0 ? tapsA : tapsB;
      taps.forEach((tap, k) => {
        const idx = Math.floor(tap * sr);
        if (idx < len) d[idx] += (k % 2 ? -0.5 : 0.6) / (1 + k * 0.8);
      });
      const fade = Math.floor(sr * 0.03);          // 尾巴别被硬切
      for (let i = 0; i < fade; i++) {
        const j = len - 1 - i;
        if (j >= 0) d[j] *= i / fade;
      }
    }
    return buf;
  }

  /** 软削波曲线（贝斯总线用）：tanh 饱和，小信号增益用 makeup 补回来 */
  function makeDriveCurve(amount) {
    const n = 1024;
    const curve = new Float32Array(n);
    const norm = Math.tanh(amount);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / norm;
    }
    return curve;
  }

  function setComp(node, cfg) {
    node.threshold.value = cfg.threshold;
    node.knee.value = cfg.knee;
    node.ratio.value = cfg.ratio;
    node.attack.value = cfg.attack;
    node.release.value = cfg.release;
    return node;
  }

  /** 懒创建：第一次用户手势时才建 AudioContext；挂了就返回 null 绝不抛错 */
  function audio() {
    if (actx || audioBroken) return actx;
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) { audioBroken = true; return null; }
    try {
      actx = new Ctx();
      const sr = actx.sampleRate;

      /* --- 总线：压缩 → 限制 → 总音量 → 输出 --- */
      dryBus = actx.createGain(); dryBus.gain.value = 1;
      wetBus = actx.createGain(); wetBus.gain.value = 1;
      preDelay = actx.createDelay(0.06);
      preDelay.delayTime.value = MIX.preDelayMs / 1000;
      conv = actx.createConvolver();
      conv.normalize = true;
      conv.buffer = buildImpulse(actx, MIX.irSeconds, MIX.irDecay);
      wetTrim = actx.createGain(); wetTrim.gain.value = MIX.wet;
      wetBus.connect(preDelay); preDelay.connect(conv); conv.connect(wetTrim);

      comp = setComp(actx.createDynamicsCompressor(), MIX.comp);
      limiter = setComp(actx.createDynamicsCompressor(), MIX.limiter);
      master = actx.createGain(); master.gain.value = 1;
      analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      levelBuf = new Uint8Array(analyser.fftSize);

      dryBus.connect(comp);
      wetTrim.connect(comp);
      comp.connect(limiter);
      limiter.connect(master);
      master.connect(analyser);                 // 旁路：只用来画电平表
      master.connect(actx.destination);

      /* --- 每条乐器：输入 → [音色总线插件] → 配平 → 干路/湿路 --- */
      makeChan('guitar');

      /* 钢琴：音板共振（固定共振峰，和真实音板一样是整台琴一起震） */
      const pIn = actx.createGain(); pIn.gain.value = 1;
      const pShape = [ { hz: 46, q: 0.7, gain: 0, type: 'highpass' },
        { hz: 110, q: 1.2, gain: 3.2, type: 'peaking' },
        { hz: 190, q: 1.6, gain: 2.2, type: 'peaking' },
        { hz: 330, q: 1.8, gain: 1.8, type: 'peaking' },
        { hz: 1250, q: 1.1, gain: 1.2, type: 'peaking' } ];
      let pTail = pIn;
      pShape.forEach((s) => {
        const f = actx.createBiquadFilter();
        f.type = s.type; f.frequency.value = s.hz; f.Q.value = s.q;
        if (s.type === 'peaking') f.gain.value = s.gain;
        pTail.connect(f); pTail = f;
      });
      makeChan('piano', pIn, pTail);

      /* 电钢琴：总线颤音（5.2Hz） */
      const eIn = actx.createGain(); eIn.gain.value = 1;
      const eHp = actx.createBiquadFilter(); eHp.type = 'highpass'; eHp.frequency.value = 55; eHp.Q.value = 0.7;
      const trem = actx.createGain(); trem.gain.value = 1;
      const lfo = actx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.2;
      const ldepth = actx.createGain(); ldepth.gain.value = 0.12;
      lfo.connect(ldepth); ldepth.connect(trem.gain);
      eIn.connect(eHp); eHp.connect(trem);
      makeChan('epiano', eIn, trem);
      try { lfo.start(); } catch (e0) { /* noop */ }

      /* 贝斯：轻度饱和（圆）+ 温和低通（厚而不糊） */
      const bIn = actx.createGain(); bIn.gain.value = 1;
      const bHp = actx.createBiquadFilter(); bHp.type = 'highpass'; bHp.frequency.value = 28; bHp.Q.value = 0.7;
      /* 饱和做得很浅：1.2 的 tanh 在常态电平下几乎就是直线（不失真），
         makeup 70% 把增益补回 1 倍；只有大力弹的时候才有一点点「圆」 */
      const shaper = actx.createWaveShaper();
      shaper.curve = makeDriveCurve(1.2);
      shaper.oversample = '2x';
      const makeup = actx.createGain(); makeup.gain.value = 0.70;
      const warm = actx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 3200; warm.Q.value = 0.5;
      bIn.connect(bHp); bHp.connect(shaper); shaper.connect(makeup); makeup.connect(warm);
      makeChan('bass', bIn, warm);

      /* 鼓组：清掉次低频，别让底鼓吃掉动态余量 */
      const dIn = actx.createGain(); dIn.gain.value = 1;
      const dHp = actx.createBiquadFilter(); dHp.type = 'highpass'; dHp.frequency.value = 26; dHp.Q.value = 0.7;
      dIn.connect(dHp);
      makeChan('drums', dIn, dHp);

      noiseBuf = buildNoise(actx);
      GRAPH.built = true;
      GRAPH.nodes = ['trim:piano', 'trim:epiano', 'trim:guitar', 'trim:bass', 'trim:drums',
        'dryBus', 'wetSend', 'preDelay', 'convolver', 'wetTrim',
        'compressor', 'limiter', 'masterGain', 'analyser', 'destination'];
      GRAPH.chain = '乐器 → 配平 → 干路 → 压缩 → 限制 → 总音量 → 输出；'
        + '乐器 → 混响送出 → 预延迟 → 卷积混响 → 湿配平 → 压缩（旁路：总音量 → 分析器）';
      GRAPH.reverb = {
        type: 'ConvolverNode',
        irSeconds: round3(MIX.irSeconds),
        wet: MIX.wet,
        preDelayMs: MIX.preDelayMs,
        decay: MIX.irDecay,
        channels: conv.buffer ? conv.buffer.numberOfChannels : 0
      };
      GRAPH.compressor = {
        type: 'DynamicsCompressorNode',
        threshold: MIX.comp.threshold, knee: MIX.comp.knee, ratio: MIX.comp.ratio,
        attack: MIX.comp.attack, release: MIX.comp.release
      };
      GRAPH.limiter = {
        type: 'DynamicsCompressorNode',
        threshold: MIX.limiter.threshold, knee: MIX.limiter.knee, ratio: MIX.limiter.ratio,
        attack: MIX.limiter.attack, release: MIX.limiter.release
      };
      GRAPH.sampleRate = sr;
      applyVolume();
    } catch (e) {
      actx = null; master = null; analyser = null; dryBus = null; audioBroken = true;
      GRAPH.built = false;
    }
    if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e2) { /* noop */ } }
    return actx;
  }

  /**
   * 建一条乐器的通道：输入（可以带一段音色插件链）→ 配平 → 干路 / 湿路。
   * head/tail 是插件链的头和尾；不传就是一个空的输入增益。
   */
  function makeChan(id, head, tail) {
    const h = head || actx.createGain();
    if (!head) h.gain.value = 1;
    const trim = actx.createGain();
    trim.gain.value = TRIM[id];
    (tail || h).connect(trim);
    const wet = actx.createGain();
    wet.gain.value = REV_SEND[id];
    trim.connect(dryBus);
    trim.connect(wet);
    wet.connect(wetBus);
    chanIn[id] = h; chanTrim[id] = trim; chanWet[id] = wet;
    return h;
  }

  /* 吉他不需要总线插件，直接建通道 */
  function ensureAllChans() {
    Object.keys(TRIM).forEach((id) => { if (!chanIn[id]) makeChan(id); });
  }

  function inputOf(id) {
    ensureAllChans();
    return chanIn[id] || dryBus;
  }

  function sampleRate() { return actx ? actx.sampleRate : 48000; }

  /** 音量：用 setTargetAtTime 平滑，避免拖动滑杆时爆音 */
  function applyVolume() {
    if (!actx || !master) return;
    const v = clamp(tune.volume, 0, 1) * MIX.master;
    const t = actx.currentTime;
    try {
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(v, t, 0.02);
    } catch (e) { master.gain.value = v; }
  }

  /** 去咔哒：把参数从当前值平滑拉到 0（先指数后线性，保证真的到 0） */
  function fadeParam(param, sec) {
    const now = actx ? actx.currentTime : 0;
    const fd = Math.max(0.008, sec || 0.02);
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(Math.max(param.value, 0.0001), now);
      param.exponentialRampToValueAtTime(0.00005, now + fd);
      param.linearRampToValueAtTime(0, now + fd + 0.02);
    } catch (e) { try { param.value = 0; } catch (e2) { /* noop */ } }
  }

  /* ---------------- 延音 / 明亮度（几条音色都用得到的两个旋钮） ---------------- */
  function susAmt() { return clamp(tune.sustain, 0, 1); }
  function brightAmt() { return clamp(tune.brightness, 0, 1); }
  function drumCutoff(def) {
    return clamp(def.cut * (0.62 + brightAmt() * 0.85), 500, 17500);
  }

  /* ================================================================== */
  /* 数字信号处理小工具：双二阶滤波器的相位延迟                          */
  /*（延迟线要按「周期 − 滤波器相位延迟」来定长，音才准）                 */
  /* ================================================================== */
  function biquadCoefs(kind, fc, Q, sr) {
    const w0 = 2 * Math.PI * Math.min(fc, sr * 0.45) / sr;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    let b0, b1, b2;
    if (kind === 'allpass') { b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha; }
    else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
    const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  function coefPhaseDelay(c, w) {
    if (w <= 0) return 0;
    const cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nRe = c.b0 + c.b1 * cw + c.b2 * c2;
    const nIm = -(c.b1 * sw + c.b2 * s2);
    const dRe = 1 + c.a1 * cw + c.a2 * c2;
    const dIm = -(c.a1 * sw + c.a2 * s2);
    return -Math.atan2(nIm * dRe - nRe * dIm, nRe * dRe + nIm * dIm) / w;
  }

  /* ================================================================== */
  /* 乐器表：一条乐器 = 一个音色 + 一块可弹的表面                        */
  /* ================================================================== */
  const INSTRUMENTS = [
    { id: 'piano', label: '钢琴', icon: 'piano', surface: 'keyboard', gain: 1 },
    { id: 'epiano', label: '电钢琴', icon: 'piano', surface: 'keyboard', gain: 1 },
    { id: 'guitar', label: '吉他', icon: 'music', surface: 'fretboard', gain: 1, strings: [64, 59, 55, 50, 45, 40], frets: 5 },
    { id: 'bass', label: '贝斯', icon: 'music', surface: 'fretboard', gain: 1.05, strings: [43, 38, 33, 28], frets: 5 },
    {
      id: 'drums', label: '鼓组', icon: 'grid', surface: 'pads', gain: 1,
      pads: ['kick', 'snare', 'hat', 'hatOpen', 'tom', 'crash', 'clap', 'rim', 'cowbell']
    }
  ];
  const INST = {};
  INSTRUMENTS.forEach((it) => { INST[it.id] = it; });
  const LABELS = INSTRUMENTS.map((it) => it.label);

  /* 旧版音色名 → 新乐器名，老曲子打开不会串味 */
  const TIMBRE_ALIAS = { piano: 'piano', epiano: 'epiano', soft: 'epiano', guitar: 'guitar', pluck: 'guitar', bass: 'bass', drums: 'drums', organ: 'piano' };

  const GUITAR_TUNE = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
  const BASS_TUNE = ['G2', 'D2', 'A1', 'E1'];
  const FRETS = [1, 2, 3, 4, 5];

  /* 鼓垫：id → 显示名 + 合成参数 */
  const DRUMS = {
    kick: { label: '底鼓', cut: 5200, dur: 0.55 },
    snare: { label: '军鼓', cut: 7600, dur: 0.32 },
    hat: { label: '闭镲', cut: 12000, dur: 0.09 },
    hatOpen: { label: '开镲', cut: 10000, dur: 0.48 },
    tom: { label: '桶鼓', cut: 4600, dur: 0.45 },
    crash: { label: '吊镲', cut: 9000, dur: 1.70 },
    clap: { label: '拍手', cut: 5600, dur: 0.34 },
    rim: { label: '边击', cut: 7200, dur: 0.16 },
    cowbell: { label: '牛铃', cut: 7000, dur: 0.42 }
  };
  const DRUM_ORDER = INSTRUMENTS[4].pads;

  /* ================================================================== */
  /* 声音登记册：每条音都有寿命，到点自己死掉                            */
  /* ================================================================== */
  const voices = new Set();
  let voiceSeq = 0;
  let lastPlan = null;

  function disconnectAll(nodes) {
    if (!nodes) return;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n) continue;
      try { if (typeof n.stop === 'function') n.stop(); } catch (e) { /* 已经停了 */ }
      try { if (typeof n.disconnect === 'function') n.disconnect(); } catch (e2) { /* noop */ }
    }
  }

  /**
   * 掐掉一条音：淡出 → 立刻从登记册里划掉 → 稍后（淡出长度之后）把
   * 这条音的所有节点断开。断开这一步是硬保险：不管包络算成什么样，
   * 节点一断就不可能再响，绝不会留下长鸣。
   */
  function killVoice(rec, fade) {
    if (!rec || rec.dead) return false;
    rec.dead = true;
    rec.until = 0;
    voices.delete(rec);
    if (rec.timer) { try { clearTimeout(rec.timer); } catch (e) { /* noop */ } rec.timer = 0; }
    const fd = fade === undefined ? 0.02 : fade;
    try { if (typeof rec.stop === 'function') rec.stop(fd); } catch (e2) { /* noop */ }
    window.setTimeout(function () {
      disconnectAll(rec.nodes);
      rec.nodes = [];
    }, Math.max(30, fd * 1000 + 40));
    return true;
  }

  /** 超过寿命的音一律收掉（activeVoices 每次都会顺手清一遍） */
  function sweep() {
    const now = Date.now();
    const dead = [];
    voices.forEach((v) => { if (v.until <= now) dead.push(v); });
    dead.forEach((v) => killVoice(v, 0.02));
  }

  function activeVoices() {
    sweep();
    return voices.size;
  }

  /** 全停：换乐器、离开音乐页、切后台都走这里 */
  function stopAll(fade) {
    const list = [];
    voices.forEach((v) => list.push(v));
    list.forEach((v) => killVoice(v, fade === undefined ? 0.015 : fade));
    voices.clear();
    return list.length;
  }

  /**
   * 单音抢占（吉他 / 贝斯）：再按下一个音时，上一声在 45ms 内淡出，
   * 于是「按一下只听到一声拨弦」，不会叠成一片长鸣。
   * 30ms 内连着按下的几个音算和弦/扫弦，一起响（一次扫弦最长 200ms）。
   */
  function stealMono(id, now) {
    if (!MONO_INST[id]) return 0;
    const b = lastStrike[id] || (lastStrike[id] = { t: 0, last: -1e9, n: 0 });
    const gap = now - b.last;
    const span = now - b.t;
    if (b.n > 0 && gap <= CHORD_MS && span <= CHORD_SPAN_MS) {
      b.last = now; b.n++;                      // 同一个和弦/同一次扫弦
      return 0;
    }
    b.t = now; b.last = now; b.n = 1;
    const old = [];
    voices.forEach((v) => { if (v.inst === id) old.push(v); });
    old.forEach((v) => killVoice(v, STEAL_FADE));
    return old.length;
  }

  /** 每件乐器现在有几条音在响（测试与调试接口读它） */
  function voiceCounts() {
    const out = { total: 0, max: MAX_VOICES };
    INSTRUMENTS.forEach((it) => { out[it.id] = 0; });
    voices.forEach((v) => {
      if (out[v.inst] === undefined) out[v.inst] = 0;
      out[v.inst]++;
      out.total++;
    });
    return out;
  }

  /** 同类乐器里同时发声太多、或同一根弦又拨了一下 → 先掐掉最早的 */
  function enforceLimits(id, midi, pad) {
    if (MONO_INST[id]) stealMono(id, Date.now());
    if (id !== 'drums') {
      const same = [];
      voices.forEach((v) => { if (v.inst === id && v.midi === midi && v.pad === pad) same.push(v); });
      same.forEach((v) => killVoice(v, 0.03));
    }
    const per = MAX_PER_INST[id] || 12;
    const mine = [];
    voices.forEach((v) => { if (v.inst === id) mine.push(v); });
    mine.sort((a, b) => a.id - b.id);
    while (mine.length >= per) killVoice(mine.shift(), 0.05);
    if (voices.size >= MAX_VOICES) {
      const all = [];
      voices.forEach((v) => all.push(v));
      all.sort((a, b) => a.id - b.id);
      while (all.length && voices.size >= MAX_VOICES) killVoice(all.shift(), 0.05);
    }
  }

  /** 登记一条音：算出寿命 → 定时器 + 清道夫双保险 */
  function registerVoice(v) {
    const cap = VOICE_CAP[v.inst] || 4;
    v.life = clamp(Number(v.life) || cap, 0.2, cap);
    v.decay = clamp(Number(v.decay) || v.life, 0.05, v.life);
    v.id = ++voiceSeq;
    v.dead = false;
    v.until = Date.now() + v.life * 1000;
    voices.add(v);
    v.timer = window.setTimeout(function () { killVoice(v); }, Math.max(120, v.life * 1000 + 150));
    return v;
  }

  /** 每条音的输出口：接到本乐器的总线，给一个干净的输出增益 */
  function voiceOut(ctx, inst, opt) {
    const bus = inputOf(inst);
    if (!bus) return null;
    const t0 = ctx.currentTime + Math.max(0, opt.when || 0);
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(bus);
    const vel = (opt.vel === undefined || opt.vel === null) ? 1 : clamp(opt.vel, 0.05, 1.6);
    return { t0: t0, out: out, vel: vel, bus: bus };
  }

  /** 包络：指数衰减到很小，再线性落到 0 —— 一定是「响到没声」 */
  function decayEnv(param, peak, t0, t60) {
    const p = Math.max(peak, 0.0002);
    const floor = Math.max(p * 0.0008, 0.00002);
    const end = t0 + Math.max(0.02, t60);
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(p, t0 + 0.004);
    param.exponentialRampToValueAtTime(floor, end);
    param.linearRampToValueAtTime(0, end + 0.04);
  }

  /**
   * 拨弦包络（合成路径与采样路径共用）：
   *   3ms 起音 → t40 处掉到 −40dB → life 处线性归零。
   * 「响多久」只由这里决定，跟波导环路的衰减、录音本身的长度都没关系。
   */
  function pluckEnv(param, peak, t0, t40, life) {
    const p = Math.max(peak, 0.0002);
    const end40 = t0 + Math.max(0.03, t40);
    const end = t0 + Math.max(t40 + 0.08, life);
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(p, t0 + 0.003);
    param.exponentialRampToValueAtTime(Math.max(p * 0.01, 0.00002), end40);      // −40dB
    param.exponentialRampToValueAtTime(Math.max(p * 0.0008, 0.00001), end);      // −62dB
    param.linearRampToValueAtTime(0, end + 0.02);                                // 一定到 0
  }

  function stopSources(nodes) {
    const now = actx ? actx.currentTime : 0;
    for (let i = 0; i < (nodes || []).length; i++) {
      const n = nodes[i];
      if (n && typeof n.stop === 'function') { try { n.stop(now + 0.02); } catch (e) { /* noop */ } }
    }
  }

  /* ================================================================== */
  /* 拨弦引擎（吉他 / 贝斯）：数字波导 + 模态兜底                        */
  /* ================================================================== */

  /** 拨弦用的噪声激励：长度≈一个周期（Karplus–Strong 的经典做法） */
  function pluckBurst(ctx, samples) {
    const n = Math.max(2, Math.round(samples));
    if (burstCache.key === n && burstCache.buf) return burstCache.buf;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      /* 轻微塑形：真实拨弦的激励不是纯白噪声 */
      d[i] = (Math.random() * 2 - 1) * (1 - (i / n) * 0.3);
    }
    burstCache.key = n; burstCache.buf = buf;
    return buf;
  }

  /**
   * 拨弦配方：先把物理量算清楚，再照着搭节点。
   * 纯计算、不碰音频（所以调试接口和自动化检查都能直接读到数字）。
   *
   * 关键几步：
   *   1) 延迟线长度 = 一个周期 − 环路滤波器在基频处的相位延迟（否则音不准）
   *   2) 环路阻尼低通：每圈都削一点高频 → 高音衰减得比低音快（真实弦的规律）
   *   3) 色散全通：只改相位不改幅度 → 泛音略微「拉宽」= 轻微非谐性
   *   4) 每圈增益 g 由目标 -60dB 时间反推：g = 10^(−3/(f·t60))
   */
  function pluckPlan(f, opt) {
    const o = opt || {};
    const sr = sampleRate();
    const isBass = !!o.bass;
    const sus = susAmt();
    const bright = brightAmt();
    const d = isBass
      ? { mul: PLUCK.bassDamp.mul, add: PLUCK.bassDamp.add, min: PLUCK.bassDamp.min, max: PLUCK.bassDamp.max, q: PLUCK.bassDamp.q }
      : { mul: PLUCK.guitarDamp.mul, add: 0, min: PLUCK.guitarDamp.min, max: PLUCK.guitarDamp.max, q: PLUCK.guitarDamp.q };
    const dampHz = clamp(f * d.mul + d.add + (isBass ? 0 : bright * f * 4), d.min, d.max);
    const dispHz = clamp(f * PLUCK.dispMul, 160, 12000);

    const lpCoef = biquadCoefs('lowpass', dampHz, d.q, sr);
    const apCoef = biquadCoefs('allpass', dispHz, PLUCK.dispQ, sr);
    function fd(hz) {
      const w = 2 * Math.PI * hz / sr;
      return coefPhaseDelay(lpCoef, w) + coefPhaseDelay(apCoef, w);
    }
    const period = sr / f;
    const comp = fd(f);
    const theory = period - comp;                 // 理论环路长度（一个周期 − 滤波器相位延迟）
    const engine = (theory >= PLUCK.minLoopSamples) ? 'waveguide' : 'modal';
    const loopSamples = Math.max(PLUCK.minLoopSamples, theory);

    /* 时长：低音长、高音短（延音滑杆整体缩放）——和采样路径共用同一张表 */
    const dcy = decayOf(isBass ? 'bass' : 'guitar', (o.midi === undefined || o.midi === null)
      ? Math.round(69 + 12 * Math.log2(f / 440)) : o.midi);
    const t60 = dcy.t60;
    const t40 = dcy.t40;
    const feedback = clamp(Math.pow(10, -3 / (f * t60)), 0.4, 0.995);
    const life = dcy.life;

    /* 泛音表：用理论延迟解出前 6 个分音的频率 → 顺手量出非谐性系数 B
       （模态引擎也用它，两种引擎的音准才对得上） */
    const D = Math.max(theory, 8);
    const partials = [];
    for (let k = 1; k <= 6; k++) {
      let lo = f * k * 0.5, hi = f * k * 1.6;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        if (mid * (D + fd(mid)) - k * sr < 0) lo = mid; else hi = mid;
      }
      partials.push((lo + hi) / 2);
    }
    const stretchB = partials.length > 1 ? (partials[1] / (2 * f) - 1) / 4 : 0;

    return {
      engine: engine,
      kind: isBass ? 'bass' : 'guitar',
      midi: o.midi === undefined ? null : o.midi,
      freq: round3(f),
      sampleRate: sr,
      loopSamples: engine === 'waveguide' ? round3(loopSamples) : null,
      theorySamples: round3(theory),
      filterDelaySamples: round3(comp),
      pitchHz: round3(engine === 'waveguide' ? sr / (loopSamples + comp) : f),
      feedback: round3(feedback),
      dampHz: Math.round(dampHz),
      allpassHz: Math.round(dispHz),
      inharmonicB: round3(stretchB * 1e6) / 1e6,   // 实测的非谐性系数（≈ 1e-4 量级）
      partialsHz: partials.map((x) => Math.round(x * 10) / 10),
      t60: round3(t60),
      t40: round3(t40),
      lifeSec: round3(life),
      silentAt: round3(life),
      sustain: sus,
      brightness: bright,
      formants: (isBass ? PLUCK.bassFormants : PLUCK.bodyFormants).map((x) => ({ hz: x.hz, q: x.q, gain: x.gain })),
      exciteMs: round3(loopSamples / sr * 1000),   // 激励只保留一个周期
      /* 拨片/指甲的噪声中心频率：也吃「明亮度」这一档 */
      pickHz: Math.round(clamp(f * (isBass ? 6 : 9) + (isBass ? 300 : 900) + bright * (isBass ? 600 : 2200), 700, 7500))
    };
  }

  /** 琴体共振链：高通去隆隆 → 200/400/2.5k 的共振峰 → 低通定亮度
      maxHz：采样路径用它把截止压在 7kHz 以下（削掉录音底噪与齿音） */
  function pluckBodyChain(ctx, plan, nodes, maxHz) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = plan.kind === 'bass' ? 36 : 74;
    hp.Q.value = 0.6;
    let tail = hp;
    plan.formants.forEach((fm) => {
      const p = ctx.createBiquadFilter();
      p.type = 'peaking';
      p.frequency.value = fm.hz;
      p.Q.value = fm.q;
      p.gain.value = fm.gain;
      tail.connect(p);
      tail = p;
      nodes.push(p);
    });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = clamp(2600 + brightAmt() * 7000, 2600, maxHz || 9600);
    lp.Q.value = 0.5;
    tail.connect(lp);
    nodes.push(hp, lp);
    if (plan.kind === 'bass') {          // 贝斯再叠一层温和低通：「圆」
      const lp2 = ctx.createBiquadFilter();
      lp2.type = 'lowpass';
      lp2.frequency.value = 2200;
      lp2.Q.value = 0.5;
      lp.connect(lp2);
      nodes.push(lp2);
      return { head: hp, tail: lp2 };
    }
    return { head: hp, tail: lp };
  }

  /**
   * 模态拨弦：给高于「反馈环一个渲染量子」的音用。
   * 用同一套泛音配比、同一个非谐性系数、同一个阻尼规律和同一块琴体，
   * 所以听感仍是「拨了一下钢弦」，不会突然变成合成器。
   */
  function pluckModal(ctx, plan, post, t0, vel, nodes) {
    const f = plan.freq;
    const B = Math.max(plan.inharmonicB, 1e-5);
    const K = 8;
    const peak = 0.55 * vel;
    let sum = 0;
    const ws = [];
    for (let k = 1; k <= K; k++) {
      const w = Math.pow(k, -1.3);
      ws.push(w); sum += w;
    }
    ws.forEach((w, i) => {
      const k = i + 1;
      const a = (w / sum) * peak;
      const t60 = plan.t60 / (1 + 0.62 * (k - 1));
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f * k * (1 + B * k * k);
      o.detune.value = (Math.random() - 0.5) * 2.2;
      decayEnv(g.gain, a, t0, t60);
      o.connect(g); g.connect(post);
      o.start(t0); o.stop(t0 + t60 + 0.12);
      nodes.push(o, g);
    });
  }

  /**
   * 拨片/指甲的瞬态：一声极短的「嗒」。
   * 硬指标：总时长 ≤8ms、电平 ≤0.06，而且先在 1.2kHz 以上高通、再用低通收掉
   * 刺耳的高频 —— 只在起音出现，绝不拖尾（起音噪声是「噪音重」的主要来源）。
   */
  function pluckAttack(ctx, plan, post, t0, vel, nodes) {
    const isBass = plan.kind === 'bass';
    const dur = isBass ? 0.006 : 0.005;
    const pick = ctx.createBufferSource();
    pick.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = isBass ? 1200 : 1500;
    hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = clamp(plan.pickHz * 0.55, 1400, isBass ? 2400 : 4000);
    lp.Q.value = 0.7;
    const pg = ctx.createGain();
    const lvl = Math.min(0.06, isBass ? 0.045 : 0.055) * Math.min(1, vel);
    pg.gain.setValueAtTime(Math.max(lvl, 0.0002), t0);
    pg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    pg.gain.linearRampToValueAtTime(0, t0 + dur + 0.002);
    pick.connect(hp); hp.connect(lp); lp.connect(pg); pg.connect(post);
    pick.start(t0, Math.random() * 0.5, dur + 0.002);
    nodes.push(pick, hp, lp, pg);
  }

  /** 吉他 / 贝斯：数字波导（Karplus–Strong） */
  function pluckVoice(ctx, id, midi, opt) {
    const o = opt || {};
    const f = freqOf(midi);
    const info = voiceOut(ctx, id, o);
    if (!info) return null;
    const isBass = id === 'bass';
    const plan = pluckPlan(f, { bass: isBass, midi: midi });
    const t0 = info.t0;
    const vel = info.vel;
    const nodes = [info.out];

    const post = ctx.createGain();          // 弦的声音汇到这里 → 琴体 → 输出
    post.gain.value = 1;
    const body = pluckBodyChain(ctx, plan, nodes);
    post.connect(body.head);
    body.tail.connect(info.out);
    nodes.push(post);

    if (plan.engine === 'waveguide') {
      /* --- 环路：求和点 → 延迟线 → 阻尼低通 → 色散全通 → 增益 → 回到求和点 --- */
      const sum = ctx.createGain(); sum.gain.value = 1;
      const dl = ctx.createDelay(0.09);
      dl.delayTime.value = plan.loopSamples / ctx.sampleRate;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass'; damp.frequency.value = plan.dampHz; damp.Q.value = 0.5;
      const disp = ctx.createBiquadFilter();
      disp.type = 'allpass'; disp.frequency.value = plan.allpassHz; disp.Q.value = PLUCK.dispQ;
      const fb = ctx.createGain();
      fb.gain.value = plan.feedback;
      sum.connect(dl); dl.connect(damp); damp.connect(disp); disp.connect(fb); fb.connect(sum);
      disp.connect(post);
      nodes.push(sum, dl, damp, disp, fb);

      /* 激励：正好一个周期的低通噪声，灌满延迟线；一个周期之后完全静音
         （不留噪声底：噪声只在起音的那一瞬间存在） */
      const exc = Math.max(0.002, plan.loopSamples / ctx.sampleRate);
      const burst = ctx.createBufferSource();
      burst.buffer = pluckBurst(ctx, plan.loopSamples);
      const bx = ctx.createBiquadFilter();
      bx.type = 'lowpass'; bx.frequency.value = plan.pickHz; bx.Q.value = 0.7;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.5 * vel, t0);
      bg.gain.exponentialRampToValueAtTime(0.00005, t0 + exc);
      burst.connect(bx); bx.connect(bg); bg.connect(sum);
      burst.start(t0, 0, exc);
      nodes.push(burst, bx, bg);
    } else {
      /* 高音区：反馈环短于一个渲染量子，改走模态拨弦（音色对齐） */
      pluckModal(ctx, plan, post, t0, vel, nodes);
    }

    /* 贝斯：再叠一条干净的基频，低频更「圆」更有芯（包络与主音同步） */
    if (isBass) {
      const sub = ctx.createOscillator();
      const sg = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.value = f;
      pluckEnv(sg.gain, 0.26 * vel, t0, plan.t40, plan.lifeSec);
      sub.connect(sg); sg.connect(post);
      sub.start(t0); sub.stop(t0 + plan.lifeSec);
      nodes.push(sub, sg);
      /* 手指触弦的低频「闷响」：很短很轻，别糊成一团 */
      const thump = ctx.createOscillator();
      const tg = ctx.createGain();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(120, t0);
      thump.frequency.exponentialRampToValueAtTime(70, t0 + 0.04);
      tg.gain.setValueAtTime(0.10 * vel, t0);
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
      thump.connect(tg); tg.connect(post);
      thump.start(t0); thump.stop(t0 + 0.07);
      nodes.push(thump, tg);
    }
    pluckAttack(ctx, plan, post, t0, vel, nodes);

    /* 输出包络：3ms 起音 → t40 处 −40dB → life 处强制归零
       （所以「响多久」是写死的，跟环路怎么算、录音多长都没关系） */
    const peak = (isBass ? 0.50 : 0.42) * vel;
    pluckEnv(info.out.gain, peak, t0, plan.t40, plan.lifeSec);

    plan.velocity = vel;
    return {
      inst: id, midi: midi, pad: null, t0: t0, gain: info.out, nodes: nodes,
      decay: plan.t60, life: plan.lifeSec, plan: plan,
      stop: function (fade) {
        fadeParam(info.out.gain, fade);
        stopSources(nodes);
      }
    };
  }

  function guitarVoice(ctx, id, midi, opt) { return pluckVoice(ctx, id, midi, opt); }
  function bassVoice(ctx, id, midi, opt) { return pluckVoice(ctx, id, midi, opt); }

  /* ================================================================== */
  /* 钢琴：泛音配比 + 各自衰减 + 琴槌噪声 + 共鸣弦                        */
  /* ================================================================== */
  function pianoVoice(ctx, id, midi, opt) {
    const o = opt || {};
    const f = freqOf(midi);
    const info = voiceOut(ctx, id, o);
    if (!info) return null;
    const t0 = info.t0;
    const vel = info.vel;
    const bright = brightAmt();
    const sus = susAmt();
    const nodes = [info.out];

    /* 泛音配比：振幅 ~ k^-1.35；明亮度越低，高次泛音压得越狠 */
    const K = f < 200 ? 8 : (f < 420 ? 6 : 5);
    const roll = 1.35 + (1 - bright) * 0.55;
    const weights = [];
    let sum = 0;
    for (let k = 1; k <= K; k++) {
      const w = Math.pow(k, -roll) * (k > 1 ? (0.86 + Math.random() * 0.28) : 1);
      weights.push(w); sum += w;
    }
    /* 时长与采样路径共用一张表（钢琴尾巴 ≤2.5s） */
    const dcy = decayOf('piano', midi);
    const t60Base = dcy.t60;
    const peak = 0.62 * vel;
    const detune = (Math.random() - 0.5) * 3.4;

    weights.forEach((w, i) => {
      const k = i + 1;
      const amp = (w / sum) * peak;
      const t60 = t60Base / (1 + 0.42 * (k - 1));       // 高次泛音衰减快 → 音头亮、尾巴暖
      /* 低音区前三个泛音做一对微失谐：缠弦的「嗡」 */
      const twins = (k <= 3 && f < 400) ? [-1, 1] : [0];
      twins.forEach((sign) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f * k;
        osc.detune.value = detune * (0.4 + k * 0.2) + sign * (k === 1 ? 2.6 : 3.4);
        const a = amp / twins.length;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(a, t0 + (k === 1 ? 0.004 : 0.0025));
        g.gain.exponentialRampToValueAtTime(Math.max(a * 0.0008, 0.00002), t0 + t60);
        g.gain.linearRampToValueAtTime(0, t0 + t60 + 0.05);
        osc.connect(g); g.connect(info.out);
        osc.start(t0); osc.stop(t0 + t60 + 0.12);
        nodes.push(osc, g);
      });
    });

    /* 琴槌：极短的带通噪声（高音区更亮更短） */
    const nb = ctx.createBufferSource();
    nb.buffer = noiseBuf;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = clamp(f * (7 + bright * 5), 800, 5200);
    nf.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.10 * vel, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.028);
    nb.connect(nf); nf.connect(ng); ng.connect(info.out);
    nb.start(t0, Math.random() * 0.4, 0.05);
    nodes.push(nb, nf, ng);

    /* 共鸣：别的弦被带着震起来的「嗡」，比主音更长、很轻 */
    const symT60 = t60Base * 1.18;
    [2.002, 3.006].forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f * ratio;
      const a = peak * (i ? 0.026 : 0.045);
      decayEnv(g.gain, a, t0 + 0.01, symT60);
      osc.connect(g); g.connect(info.out);
      osc.start(t0); osc.stop(t0 + symT60 + 0.15);
      nodes.push(osc, g);
    });

    /* 输出端收尾：到寿命时线性归零，绝不留尾巴（钢琴 ≤2.5s） */
    const life = Math.min(Math.max(t60Base, symT60) + 0.30, dcy.cap);
    info.out.gain.setValueAtTime(1, t0);
    info.out.gain.setValueAtTime(1, t0 + Math.max(0.05, life - 0.06));
    info.out.gain.linearRampToValueAtTime(0, t0 + life - 0.02);

    return {
      inst: id, midi: midi, pad: null, t0: t0, gain: info.out, nodes: nodes,
      decay: Math.max(t60Base, symT60), life: life, sustain: sus,
      stop: function (fade) { fadeParam(info.out.gain, fade); stopSources(nodes); }
    };
  }

  /* ================================================================== */
  /* 电钢琴：FM 音叉（指数包络）+ 总线颤音                              */
  /* ================================================================== */
  function epianoVoice(ctx, id, midi, opt) {
    const o = opt || {};
    const f = freqOf(midi);
    const info = voiceOut(ctx, id, o);
    if (!info) return null;
    const t0 = info.t0;
    const vel = info.vel;
    const bright = brightAmt();
    const sus = susAmt();
    const nodes = [info.out];

    const amp = ctx.createGain();          // 总幅度包络
    const peak = 0.34 * vel;
    const dcy = decayOf('epiano', midi);   // 与采样路径同一张表（电钢尾巴 ≤2.4s）
    const t60 = dcy.t60;
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(peak, t0 + 0.006);
    /* 两段衰减：先掉到 30%（木质的「芯」），再慢慢拖尾（Rhodes 的铃） */
    amp.gain.exponentialRampToValueAtTime(Math.max(peak * 0.30, 0.0004), t0 + 0.55 + sus * 0.5);
    amp.gain.exponentialRampToValueAtTime(Math.max(peak * 0.0008, 0.00002), t0 + t60);
    amp.gain.linearRampToValueAtTime(0, t0 + t60 + 0.05);
    amp.connect(info.out);
    nodes.push(amp);

    /* 两只载波（差 7.5 音分）→ 合唱感 */
    const carA = ctx.createOscillator(); carA.type = 'sine'; carA.frequency.value = f;
    const carB = ctx.createOscillator(); carB.type = 'sine'; carB.frequency.value = f; carB.detune.value = 7.5;
    const gA = ctx.createGain(); gA.gain.value = 0.6;
    const gB = ctx.createGain(); gB.gain.value = 0.4;
    carA.connect(gA); gA.connect(amp);
    carB.connect(gB); gB.connect(amp);
    nodes.push(carA, carB, gA, gB);

    /* 调制器 1（1:1）+ 指数包络：从 1.9 掉到 0.1 → 木质的芯 */
    const modA = ctx.createOscillator();
    modA.type = 'sine'; modA.frequency.value = f; modA.detune.value = -4;
    const idxA = ctx.createGain();
    idxA.gain.setValueAtTime(f * (1.9 * (0.6 + vel * 0.6)) * (0.6 + bright * 0.8), t0);
    idxA.gain.exponentialRampToValueAtTime(f * 0.10, t0 + 0.35 + sus * 0.8);
    modA.connect(idxA); idxA.connect(carA.frequency); idxA.connect(carB.frequency);
    modA.start(t0); modA.stop(t0 + t60 + 0.15);
    nodes.push(modA, idxA);

    /* 调制器 2（14:1）+ 60ms 包络：音叉的「叮」 */
    const modB = ctx.createOscillator();
    modB.type = 'sine'; modB.frequency.value = f * 14;
    const idxB = ctx.createGain();
    idxB.gain.setValueAtTime(f * 2.6 * (0.5 + vel * 0.7) * (0.5 + bright * 0.9), t0);
    idxB.gain.exponentialRampToValueAtTime(f * 0.012, t0 + 0.07);
    modB.connect(idxB); idxB.connect(carA.frequency); idxB.connect(carB.frequency);
    modB.start(t0); modB.stop(t0 + 0.25);
    nodes.push(modB, idxB);

    carA.start(t0); carA.stop(t0 + t60 + 0.15);
    carB.start(t0); carB.stop(t0 + t60 + 0.15);

    return {
      inst: id, midi: midi, pad: null, t0: t0, gain: info.out, nodes: nodes,
      decay: t60, life: Math.min(t60 + 0.30, dcy.cap), sustain: sus,
      stop: function (fade) { fadeParam(info.out.gain, fade); stopSources(nodes); }
    };
  }

  /* ================================================================== */
  /* 鼓组：一击即散，每条音也照样有寿命                                  */
  /* ================================================================== */
  const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

  function noiseHit(ctx, t0, dest, opt, nodes) {
    const o = opt || {};
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    let tail = src;
    (o.filters || []).forEach((f) => {
      const bq = ctx.createBiquadFilter();
      bq.type = f.type;
      bq.frequency.value = f.hz;
      bq.Q.value = f.q === undefined ? 0.7 : f.q;
      tail.connect(bq); tail = bq;
      nodes.push(bq);
    });
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0 + (o.at || 0));
    g.gain.linearRampToValueAtTime((o.gain || 0.3), t0 + (o.at || 0) + (o.attack || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (o.at || 0) + (o.decay || 0.1));
    tail.connect(g); g.connect(dest);
    src.start(t0 + (o.at || 0), Math.random() * 0.4, (o.decay || 0.1) + 0.06);
    nodes.push(src, g);
  }

  function toneHit(ctx, t0, dest, o, nodes) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.from, t0 + (o.at || 0));
    if (o.to && o.to !== o.from) {
      osc.frequency.exponentialRampToValueAtTime(o.to, t0 + (o.at || 0) + (o.sweep || 0.08));
    }
    g.gain.setValueAtTime(0.0001, t0 + (o.at || 0));
    g.gain.linearRampToValueAtTime(o.gain, t0 + (o.at || 0) + (o.attack || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (o.at || 0) + (o.decay || 0.2));
    osc.connect(g); g.connect(dest);
    osc.start(t0 + (o.at || 0));
    osc.stop(t0 + (o.at || 0) + (o.decay || 0.2) + 0.06);
    nodes.push(osc, g);
  }

  /** 底鼓：点击（小喇叭也听得见）+ 165→46Hz 快速下坠 + 槌头 */
  function drumKick(ctx, t0, dest, vel) {
    const nodes = [];
    noiseHit(ctx, t0, dest, {
      gain: 0.5 * vel, attack: 0.001, decay: 0.020,
      filters: [{ type: 'highpass', hz: 1500, q: 0.6 }]
    }, nodes);
    toneHit(ctx, t0, dest, { from: 168, to: 46, sweep: 0.075, gain: 0.95 * vel, decay: 0.52 }, nodes);
    toneHit(ctx, t0, dest, { type: 'triangle', from: 252, to: 92, sweep: 0.05, gain: 0.16 * vel, decay: 0.16 }, nodes);
    noiseHit(ctx, t0, dest, {
      gain: 0.30 * vel, attack: 0.001, decay: 0.035,
      filters: [{ type: 'lowpass', hz: 900, q: 0.7 }]
    }, nodes);
    return nodes;
  }

  /** 军鼓：鼓皮三个分音 + 短促的「裂」+ 稍长的「沙」+ 8k 的边圈脆响 */
  function drumSnare(ctx, t0, dest, vel) {
    const nodes = [];
    [[192, 0.30, 0.13], [268, 0.20, 0.11], [418, 0.12, 0.08]].forEach((p) => {
      toneHit(ctx, t0, dest, {
        type: 'triangle', from: p[0] * 1.12, to: p[0] * 0.93, sweep: 0.06, gain: p[1] * vel, decay: p[2]
      }, nodes);
    });
    noiseHit(ctx, t0, dest, {
      gain: 0.42 * vel, attack: 0.001, decay: 0.085,
      filters: [{ type: 'highpass', hz: 1200, q: 0.6 }, { type: 'bandpass', hz: 2600, q: 0.8 }]
    }, nodes);
    noiseHit(ctx, t0, dest, {
      gain: 0.34 * vel, attack: 0.002, decay: 0.26,
      filters: [{ type: 'highpass', hz: 380, q: 0.6 }, { type: 'lowpass', hz: 7000, q: 0.6 }]
    }, nodes);
    noiseHit(ctx, t0, dest, {
      gain: 0.12 * vel, attack: 0.001, decay: 0.018,
      filters: [{ type: 'highpass', hz: 6500, q: 0.6 }]
    }, nodes);
    return nodes;
  }

  /** 踩镲：808 式六个非谐方波过高通 → 金属味；再补一层气声 */
  function drumHat(ctx, t0, dest, vel, open) {
    const nodes = [];
    const dec = open ? 0.46 : 0.062;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = open ? 6800 : 7600; hp.Q.value = 0.7;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = open ? 9000 : 10800; bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.5 * vel, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
    hp.connect(bp); bp.connect(g); g.connect(dest);
    nodes.push(hp, bp, g);
    HAT_RATIOS.forEach((r, i) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 40 * r;              // 40Hz 的六个非谐方波，靠高通捞出金属感
      o.detune.value = (i % 2 ? 6 : -6);
      o.connect(hp);
      o.start(t0); o.stop(t0 + dec + 0.06);
      nodes.push(o);
    });
    noiseHit(ctx, t0, dest, { gain: 0.20 * vel, attack: 0.001, decay: dec * 0.7, filters: [{ type: 'highpass', hz: 8000, q: 0.6 }] }, nodes);
    return nodes;
  }

  /** 桶鼓：扫频 + 一点皮噪 */
  function drumTom(ctx, t0, dest, vel) {
    const nodes = [];
    toneHit(ctx, t0, dest, { from: 268, to: 108, sweep: 0.15, gain: 0.62 * vel, decay: 0.40 }, nodes);
    noiseHit(ctx, t0, dest, {
      gain: 0.18 * vel, attack: 0.001, decay: 0.06,
      filters: [{ type: 'bandpass', hz: 900, q: 1.2 }]
    }, nodes);
    return nodes;
  }

  /** 吊镲：非谐方波 + 两层噪声 + 慢速闪烁共振 */
  function drumCrash(ctx, t0, dest, vel) {
    const nodes = [];
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3200; hp.Q.value = 0.6;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.linearRampToValueAtTime(0.5 * vel, t0 + 0.003);
    out.gain.exponentialRampToValueAtTime(Math.max(0.15 * vel, 0.0002), t0 + 0.16);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.7);
    hp.connect(out); out.connect(dest);
    nodes.push(hp, out);
    [1, 1.414, 1.732, 2.14, 2.72, 3.36, 4.1].forEach((r, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = 300 * r;
      o.detune.value = (i % 2 ? 9 : -9);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.10 * vel / (1 + i * 0.3), t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25 + i * 0.06);
      o.connect(g); g.connect(hp);
      o.start(t0); o.stop(t0 + 1.5 + i * 0.06);
      nodes.push(o, g);
    });
    noiseHit(ctx, t0, dest, {
      gain: 0.20 * vel, attack: 0.002, decay: 1.5,
      filters: [{ type: 'highpass', hz: 4200, q: 0.6 }]
    }, nodes);
    /* 闪烁层：高 Q 带通让镲有「沙沙的亮片」而不是一片白噪声 */
    noiseHit(ctx, t0, dest, {
      gain: 0.22 * vel, attack: 0.004, decay: 1.1,
      filters: [{ type: 'bandpass', hz: 9500, q: 5.5 }]
    }, nodes);
    /* 起音飞溅 */
    noiseHit(ctx, t0, dest, {
      gain: 0.30 * vel, attack: 0.001, decay: 0.05,
      filters: [{ type: 'bandpass', hz: 7000, q: 1.0 }]
    }, nodes);
    return nodes;
  }

  /** 拍手：四下极短的噪声 + 房间尾巴 */
  function drumClap(ctx, t0, dest, vel) {
    const nodes = [];
    [0, 0.010, 0.020, 0.032].forEach((at, i) => {
      noiseHit(ctx, t0, dest, {
        at: at, gain: (i === 3 ? 0.5 : 0.30) * vel, attack: 0.001,
        decay: i === 3 ? 0.20 : 0.028,
        filters: [{ type: 'bandpass', hz: 1250, q: 1.6 }]
      }, nodes);
    });
    noiseHit(ctx, t0, dest, {
      at: 0.032, gain: 0.10 * vel, attack: 0.004, decay: 0.24,
      filters: [{ type: 'bandpass', hz: 2000, q: 0.7 }]
    }, nodes);
    return nodes;
  }

  /** 边击：两颗短促的金属音 + 一丝噪声 */
  function drumRim(ctx, t0, dest, vel) {
    const nodes = [];
    toneHit(ctx, t0, dest, { type: 'square', from: 1750, to: 1750, gain: 0.22 * vel, decay: 0.05 }, nodes);
    toneHit(ctx, t0, dest, { type: 'square', from: 2650, to: 2650, gain: 0.13 * vel, decay: 0.04 }, nodes);
    noiseHit(ctx, t0, dest, { gain: 0.16 * vel, attack: 0.001, decay: 0.02, filters: [{ type: 'highpass', hz: 3000, q: 0.6 }] }, nodes);
    return nodes;
  }

  /** 牛铃：一对非谐方波 */
  function drumCowbell(ctx, t0, dest, vel) {
    const nodes = [];
    [560, 845].forEach((fr, i) => {
      toneHit(ctx, t0, dest, { type: 'square', from: fr, to: fr, gain: (i ? 0.16 : 0.24) * vel, decay: 0.36 - i * 0.06 }, nodes);
    });
    noiseHit(ctx, t0, dest, { gain: 0.06 * vel, attack: 0.001, decay: 0.03, filters: [{ type: 'bandpass', hz: 2600, q: 1.2 }] }, nodes);
    return nodes;
  }

  const DRUM_FN = {
    kick: drumKick, snare: drumSnare, tom: drumTom, crash: drumCrash,
    clap: drumClap, rim: drumRim, cowbell: drumCowbell,
    hat: (ctx, t0, cut, vel) => drumHat(ctx, t0, cut, vel, false),
    hatOpen: (ctx, t0, cut, vel) => drumHat(ctx, t0, cut, vel, true)
  };

  /** 鼓：一次性噪声/扫频，不返回长音对象（不需要放开） */
  function drumVoice(ctx, id, pad, opt) {
    const def = DRUMS[pad];
    if (!def) return null;
    const info = voiceOut(ctx, id, opt);
    if (!info) return null;
    const t0 = info.t0;
    const vel = info.vel;
    const cut = ctx.createBiquadFilter();
    cut.type = 'lowpass';
    cut.frequency.value = drumCutoff(def);
    cut.Q.value = 0.55;
    const out = ctx.createGain();
    out.gain.value = 0.95;
    cut.connect(out); out.connect(info.out);
    const nodes = [info.out, cut, out];
    const fn = DRUM_FN[pad];
    if (fn) {
      try { nodes.push.apply(nodes, fn(ctx, t0, cut, vel) || []); } catch (e) { /* 单条鼓坏了不影响别的 */ }
    }
    return {
      inst: id, midi: null, pad: pad, t0: t0, gain: out, nodes: nodes,
      decay: def.dur, life: clamp(def.dur + 0.45, 0.3, VOICE_CAP.drums),
      plan: { engine: 'percussion', pad: pad, decay: round3(def.dur), cutoffHz: Math.round(cut.frequency.value) },
      stop: function (fade) { fadeParam(out.gain, fade === undefined ? 0.012 : fade); stopSources(nodes); }
    };
  }

  /* ================================================================== */
  /* 采样库：真乐器音色（assets/samples/，构建期下载、运行期只读本地）    */
  /*                                                                    */
  /*   素材：MIDI.js Soundfonts · FluidR3_GM（CC BY 3.0，见            */
  /*         assets/samples/LICENSE.md）；由 tools/fetch-samples.js 下载。*/
  /*   运行期不联网：清单里有什么就加载什么；任何一步失败（文件缺失 /    */
  /*   解码失败 / 被 useSamples({}) 关掉）都自动回退到上面的合成引擎，   */
  /*   所以首次运行、离线、老机型都不会因为采样出不了声。                 */
  /* ================================================================== */
  const SAMPLE_DIR = 'assets/samples/';
  /* 解码后只保留这么长：包络本来就更早把尾巴削掉了，留长尾只是白占内存 */
  const SAMPLE_MAX_SEC = { piano: 2.30, epiano: 2.10, guitar: 1.05, bass: 1.35 };
  /* 采样进总线的电平（每个采样在解码时已归一化到 0.9 峰值） */
  const SAMPLE_GAIN = { piano: 0.50, epiano: 0.52, guitar: 0.52, bass: 0.55 };
  const SAMPLE_MAX_SHIFT = 2;            // 离最近采样超过 ±2 个半音就宁可走合成
  const SAMPLE_LP_HZ = 7000;             // 采样通道低通：去掉录音底噪与齿音
  const SAMPLE_PEAK = 0.9;

  const SAMPLES = {
    enabled: true,        // useSamples({}) 可以整体关掉（测试的「合成兜底」开关）
    wanted: null,         // null = 清单里全部；数组 = 只启用列出的乐器
    ready: false,
    loading: null,
    error: null,
    files: 0,             // 清单里的文件数
    loaded: 0,            // 真正解码成功的条数
    failed: 0,
    bytes: 0,
    source: null,
    byInst: {},           // id → [{ midi, note, buf }]，按 midi 升序
    maxSec: SAMPLE_MAX_SEC
  };

  function sampleNotes(id) {
    const list = SAMPLES.byInst[id];
    return list ? list.length : 0;
  }

  /** 这件乐器现在真的会用采样发声吗 */
  function sampleBacked(id) {
    if (!SAMPLES.enabled || !SAMPLES.ready) return false;
    if (SAMPLES.wanted && SAMPLES.wanted.indexOf(id) < 0) return false;
    return sampleNotes(id) > 0;
  }

  /** 采样总览：调试接口、界面徽章、自动化检查都读它 */
  function sampleSummary() {
    const per = {};
    const backed = [];
    const fallback = [];
    INSTRUMENTS.forEach((it) => {
      const on = sampleBacked(it.id);
      const list = SAMPLES.byInst[it.id] || [];
      per[it.id] = {
        label: it.label,
        engine: on ? 'sample' : 'synth',
        files: list.length,
        notes: list.map((x) => x.midi),
        range: list.length ? [list[0].midi, list[list.length - 1].midi] : null
      };
      (on ? backed : fallback).push(it.id);
    });
    return {
      engine: backed.length ? (fallback.length ? 'hybrid' : 'sample') : 'synth',
      enabled: SAMPLES.enabled,
      ready: SAMPLES.ready,
      error: SAMPLES.error,
      source: SAMPLES.source,
      licence: 'FluidR3_GM（MIDI.js Soundfonts）· CC BY 3.0；提供仓库 LICENSE.txt = MIT',
      files: SAMPLES.files,
      loaded: SAMPLES.loaded,
      failed: SAMPLES.failed,
      bytes: SAMPLES.bytes,
      maxShiftSemitones: SAMPLE_MAX_SHIFT,
      maxSec: SAMPLE_MAX_SEC,
      backed: backed,
      fallback: fallback,
      perInstrument: per
    };
  }

  /** 解码后裁短 + 归一化：手机内存有限，尾巴也本来就会被包络削掉 */
  function trimBuffer(ctx, buf, maxSec) {
    const sr = buf.sampleRate;
    const want = Math.max(1, Math.min(buf.length, Math.floor(sr * (maxSec || 2))));
    const out = ctx.createBuffer(1, want, sr);
    const d = out.getChannelData(0);
    const ch = buf.numberOfChannels;
    if (ch === 1) {
      d.set(buf.getChannelData(0).subarray(0, want));
    } else {
      for (let c = 0; c < ch; c++) {
        const src = buf.getChannelData(c);
        for (let i = 0; i < want; i++) d[i] += src[i] / ch;
      }
    }
    const fade = Math.max(1, Math.min(Math.floor(sr * 0.02), Math.floor(want * 0.05)));
    for (let i = 0; i < fade; i++) d[want - 1 - i] *= i / fade;   // 结尾 20ms 淡出，别爆音
    let peak = 0;
    for (let i = 0; i < want; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; }
    if (peak > 0.0001) {                                          // 统一电平，免得忽大忽小
      const g = SAMPLE_PEAK / peak;
      for (let i = 0; i < want; i++) d[i] *= g;
    }
    return out;
  }

  function decodeSample(ctx, arr, maxSec) {
    return new Promise(function (resolve, reject) {
      let done = false;
      const ok = function (buf) {
        if (done) return;
        done = true;
        try { resolve(trimBuffer(ctx, buf, maxSec)); } catch (e) { reject(e); }
      };
      const bad = function (e) { if (!done) { done = true; reject(e || new Error('decode failed')); } };
      try {
        const p = ctx.decodeAudioData(arr, ok, bad);   // 老实现只有回调，新实现还有 Promise
        if (p && typeof p.then === 'function') p.then(ok, bad);
      } catch (e) { bad(e); }
    });
  }

  /** 加载整库；任何时候都 resolve（失败就静默走合成） */
  function loadSamples() {
    if (SAMPLES.loading) return SAMPLES.loading;
    if (SAMPLES.ready) return Promise.resolve(sampleSummary());
    SAMPLES.loading = (async function () {
      try {
        if (!SAMPLES.enabled) { SAMPLES.ready = true; return sampleSummary(); }
        const ctx = audio();
        if (!ctx) throw new Error('没有 AudioContext');
        const res = await fetch(SAMPLE_DIR + 'manifest.json', { cache: 'force-cache' });
        if (!res.ok) throw new Error('清单 HTTP ' + res.status);
        const man = await res.json();
        SAMPLES.source = man && man.source ? String(man.source) : null;
        const insts = (man && man.instrument) || {};
        if (!SAMPLES.source) SAMPLES.source = 'MIDI.js Soundfonts · FluidR3_GM';
        const jobs = [];
        Object.keys(insts).forEach(function (id) {
          if (!INST[id]) return;
          if (SAMPLES.wanted && SAMPLES.wanted.indexOf(id) < 0) return;
          ((insts[id] && insts[id].files) || []).forEach(function (f) {
            if (!f || f.midi === undefined || !f.file) return;
            jobs.push({ id: id, midi: Number(f.midi), note: String(f.note || ''), file: String(f.file) });
          });
        });
        SAMPLES.files = jobs.length;
        SAMPLES.loaded = 0;                 // 每次真正加载都重新计数（可反复开关）
        SAMPLES.failed = 0;
        SAMPLES.bytes = 0;
        const bucket = {};
        let cursor = 0;
        const worker = async function () {
          while (cursor < jobs.length) {
            const job = jobs[cursor++];
            try {
              const rel = job.file.replace(/^assets\/samples\//, '');
              const r = await fetch(SAMPLE_DIR + rel, { cache: 'force-cache' });
              if (!r.ok) throw new Error('HTTP ' + r.status);
              const arr = await r.arrayBuffer();
              SAMPLES.bytes += arr.byteLength;
              const buf = await decodeSample(ctx, arr, SAMPLE_MAX_SEC[job.id]);
              (bucket[job.id] = bucket[job.id] || []).push({ midi: job.midi, note: job.note, buf: buf });
              SAMPLES.loaded++;
            } catch (e) { SAMPLES.failed++; }
          }
        };
        const pool = [];
        for (let i = 0; i < 4; i++) pool.push(worker());
        await Promise.all(pool);
        Object.keys(bucket).forEach(function (id) {
          bucket[id].sort(function (a, b) { return a.midi - b.midi; });
          if (bucket[id].length) SAMPLES.byInst[id] = bucket[id];
        });
        SAMPLES.ready = true;
      } catch (e) {
        SAMPLES.error = (e && e.message) || String(e);
        SAMPLES.ready = true;                       // 标记「加载结束」：之后全部走合成
      }
      SAMPLES.loading = null;
      afterSamplesLoaded();
      return sampleSummary();
    })();
    return SAMPLES.loading;
  }

  /** 采样就绪后把徽章就地改过来（从「合成」变成「采样」） */
  function refreshEngineUi() {
    const badges = U.$$('#view .sample-badge');
    if (!badges.length) return false;
    badges.forEach((b) => {
      const id = b.getAttribute('data-inst');
      const on = sampleBacked(id);
      b.textContent = on ? '采样' : '合成';
      b.setAttribute('data-engine', on ? 'sample' : 'synth');
      b.classList.toggle('sample-on', on);
      b.classList.toggle('sample-off', !on);
      b.title = on
        ? '真采样：FluidR3_GM（CC BY 3.0）· ' + sampleNotes(id) + ' 个音，邻近采样变调 ≤2 个半音'
        : '内置合成音色（采样没有加载，或这件乐器没有采样）';
    });
    U.$$('#view .inst-chip[data-inst]').forEach((c) => {
      const on = sampleBacked(c.getAttribute('data-inst'));
      c.setAttribute('data-engine', on ? 'sample' : 'synth');
      const dot = c.querySelector('.chip-engine');
      if (dot) dot.classList.toggle('on', on);
    });
    return true;
  }

  /**
   * 采样就绪后如果正停在音乐页，刷新一下徽章。
   * 注意：**不能**无脑 UI.render() —— UI.render 会顺手关掉当前弹层，
   * 用户可能正开着「导入音乐」在粘谱子，那一票就被吃掉了。
   */
  function afterSamplesLoaded() {
    try {
      if (!/^music(\/|$)/.test(UI.currentPath() || '')) return;
      if (UI.isSheetOpen && UI.isSheetOpen()) return;
      if (refreshEngineUi()) return;
      UI.render();
    } catch (e) { /* noop */ }
  }

  /** 找最近的采样：相邻采样间隔 3 个半音 → 变调最多 ±1.5 个半音 */
  function samplePick(id, midi) {
    if (!sampleBacked(id)) return null;
    const list = SAMPLES.byInst[id];
    let best = null;
    let bestD = 1e9;
    for (let i = 0; i < list.length; i++) {
      const d = Math.abs(list[i].midi - midi);
      if (d < bestD) { bestD = d; best = list[i]; }
      if (d === 0) break;
    }
    if (!best || bestD > SAMPLE_MAX_SHIFT) return null;
    return { entry: best, semis: midi - best.midi, rate: Math.pow(2, (midi - best.midi) / 12) };
  }

  /** 采样路径的「琴体」：比合成路径轻一半，别给录音再加一层染色 */
  function sampleBodyPlan(id) {
    const isBass = id === 'bass';
    const fm = (isBass ? PLUCK.bassFormants : PLUCK.bodyFormants)
      .map((x) => ({ hz: x.hz, q: x.q, gain: x.gain * 0.5 }));
    return { kind: isBass ? 'bass' : 'guitar', formants: fm };
  }

  /**
   * 采样发声：最近采样 + playbackRate 变调（≤2 个半音）+ 与合成路径
   * 完全相同的包络（t40 到 −40dB、life 强制静音），所以换采样不会变长。
   * 音色仍走本乐器总线（吉他琴体共振 / 贝斯低通），但不再叠加任何合成振荡器。
   */
  function sampleVoice(ctx, id, midi, opt) {
    const pick = samplePick(id, midi);
    if (!pick) return null;
    const info = voiceOut(ctx, id, opt);
    if (!info) return null;
    const dcy = decayOf(id, midi);
    const t0 = info.t0;
    const vel = info.vel;
    const bright = brightAmt();
    const nodes = [info.out];

    const src = ctx.createBufferSource();
    src.buffer = pick.entry.buf;
    src.playbackRate.value = pick.rate;

    /* 低通：把录音的底噪/齿音挡在 7kHz 以下；往上变调时截止跟着降 */
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.5;
    const open = clamp(3200 + bright * 3600, 2600, SAMPLE_LP_HZ);
    tone.frequency.value = clamp(open / Math.max(1, pick.rate), 900, SAMPLE_LP_HZ);

    const g = ctx.createGain();
    pluckEnv(g.gain, (SAMPLE_GAIN[id] || 0.5) * vel, t0, dcy.t40, dcy.life);

    src.connect(g); g.connect(tone);
    if (id === 'guitar' || id === 'bass') {
      const body = pluckBodyChain(ctx, sampleBodyPlan(id), nodes, SAMPLE_LP_HZ);
      tone.connect(body.head);
      body.tail.connect(info.out);
    } else {
      tone.connect(info.out);            // 钢琴/电钢：总线上的音板共振 / 颤音就是音色
    }
    try { src.start(t0); src.stop(t0 + dcy.life + 0.05); } catch (e) { /* noop */ }
    nodes.push(src, g, tone);

    return {
      inst: id, midi: midi, pad: null, t0: t0, gain: g, nodes: nodes,
      decay: dcy.t60, life: dcy.life, sampled: true,
      plan: {
        engine: 'sample', kind: id, midi: midi, freq: round3(freqOf(midi)),
        note: pick.entry.note, noteMidi: pick.entry.midi, semis: round3(pick.semis),
        playbackRate: round3(pick.rate),
        sampleMs: Math.round(pick.entry.buf.duration * 1000),
        lowpassHz: Math.round(tone.frequency.value),
        t60: dcy.t60, t40: dcy.t40, lifeSec: dcy.life, silentAt: dcy.life,
        sustain: round3(susAmt()), brightness: round3(bright), velocity: vel,
        files: sampleNotes(id), source: 'FluidR3_GM'
      },
      stop: function (fade) { fadeParam(g.gain, fade); stopSources(nodes); }
    };
  }

  /* ================================================================== */
  /* 发声入口 + 语音计数 + 调试事件                                      */
  /* ================================================================== */
  let lastEv = null;
  let lastEngine = 'none';       // 上一条音是采样还是合成（界面与测试都读它）
  let current = 'piano';         // 当前乐器

  /**
   * 内部发声：把 (midi 或 pad) 变成真实声音。
   * 没有音频环境（无头浏览器 / 用户没交互过）时返回 null，绝不抛错。
   */
  function synthPlay(id, midi, pad, opt) {
    const o = opt || {};
    const ctx = audio();
    if (!ctx || !dryBus) return null;
    try {
      enforceLimits(id, midi, pad);          // 先腾地方：同一根弦再拨就掐掉上一条
      const voiceOpt = {
        dur: Math.max(0.05, o.dur || 0.7),
        when: Math.max(0, o.when || 0),
        vel: o.vel === undefined ? 1 : clamp(o.vel, 0.05, 1.6)
      };
      let v = null;
      if (pad) {
        v = drumVoice(ctx, id, pad, voiceOpt);
      } else {
        /* 真采样优先；没加载 / 关掉了 / 音高离最近采样太远，都自动回退到内置合成 */
        if (sampleBacked(id)) v = sampleVoice(ctx, id, midi, voiceOpt);
        if (!v) {
          if (id === 'epiano') v = epianoVoice(ctx, id, midi, voiceOpt);
          else if (id === 'guitar') v = guitarVoice(ctx, id, midi, voiceOpt);
          else if (id === 'bass') v = bassVoice(ctx, id, midi, voiceOpt);
          else v = pianoVoice(ctx, id, midi, voiceOpt);
        }
      }
      lastEngine = v ? (v.sampled ? 'sample' : 'synth') : 'none';
      if (!v) return null;
      if (v.plan) lastPlan = v.plan;
      return registerVoice(v);
    } catch (e) {
      return null;                                   // 音频环境异常：静默降级
    }
  }

  /** 记一笔调试事件：测试和「上一次弹了什么」都读它 */
  function markEvent(id, midi, pad) {
    lastEv = {
      instrument: id,
      midi: (midi === undefined || midi === null) ? null : midi,
      pad: pad || null,
      engine: pad ? 'synth' : lastEngine,
      at: Date.now(),
      voices: activeVoices()
    };
    return lastEv;
  }

  /**
   * 对外统一的发声 API。
   * play(midi, opt)            音高（钢琴/电钢/吉他/贝斯）
   * play(padName, opt)         鼓垫（'kick' 'snare' …）
   */
  function play(midi, opt) {
    return playAs(current, midi, opt);
  }

  function playAs(id, midi, opt) {
    const inst = INST[id] ? id : 'piano';
    const o = opt || {};
    let pad = null;
    let m = null;
    if (inst === 'drums') {
      if (typeof midi === 'string' && DRUMS[midi]) pad = midi;
      else if (typeof midi === 'number' && DRUM_ORDER[midi]) pad = DRUM_ORDER[midi];
      if (!pad) return null;                          // 鼓组必须给一个有效的垫名
    } else {
      m = Math.round(Number(midi));
      if (isNaN(m)) return null;
    }
    const dur = o.dur !== undefined ? o.dur : (inst === 'drums' ? DRUMS[pad].dur : 0.7);
    synthPlay(inst, m, pad, { dur: dur, when: o.when || 0, vel: o.vel });
    return markEvent(inst, m, pad);
  }

  /** 鼓垫试听（提供 pad 名的入口，语义更清楚） */
  function playPad(name, opt) { return playAs('drums', name, opt); }

  /* ================================================================== */
  /* 作品数据                                                          */
  /* ================================================================== */
  const BEATS = 16;            // 一个小节 16 个 1/16 步
  const ROWS = 12;             // 谱面只展示一个八度（C5–B5），低频用八度按钮切换

  let songs = [];
  let curId = null;
  let cur = null;              // { id, name, bpm, rows:[[step...]], lyrics, at }
  let baseMidi = 72;           // 谱面最低音 = C5
  let playing = false;
  let playTimer = null;
  let playHead = -1;

  function instOf(song) {
    if (!song) return current;
    const raw = song.inst || song.timbre || 'piano';
    return INST[raw] ? raw : (TIMBRE_ALIAS[raw] || 'piano');
  }
  function instLabel(id) { return (INST[id] || INST.piano).label; }

  function loadSongs() {
    try { songs = (Store.state.settings.songs || []).slice(); } catch (e) { songs = []; }
    if (!songs.length) {
      songs = [newSong('未命名旋律')];
      persist();
    }
    curId = songs[0].id;
    cur = songs[0];
    baseMidi = cur.baseMidi || 72;
    current = instOf(cur);
  }
  function persist() {
    try { Store.setSetting('songs', songs); } catch (e) { /* noop */ }
  }
  function newSong(name) {
    const rows = [];
    for (let i = 0; i < ROWS; i++) rows.push(new Array(BEATS).fill(0));
    return {
      id: U.uid('song'),
      name: name || '未命名旋律',
      bpm: 100,
      timbre: 'piano',
      inst: 'piano',
      baseMidi: 72,
      rows: rows,
      lyrics: '',
      at: Date.now()
    };
  }
  function findSong(id) { return songs.find((s) => s.id === id) || null; }

  /* 谱面 → 事件序列 [{step, midi, dur}] */
  function events(song) {
    const out = [];
    if (!song || !song.rows) return out;
    const base = song.baseMidi || 72;
    const len = songLen(song);
    song.rows.forEach((row, r) => {
      let step = 0;
      while (step < len) {
        if (!row[step]) { step++; continue; }
        /* 同一行连续亮的格子并成一个长音：写谱时更省事，读谱也更自然 */
        let l = 1;
        while (step + l < len && row[step + l]) l++;
        out.push({ step: step, midi: base + r, dur: l });
        step += l;
      }
    });
    /* 同一列不同行会同时发声（和弦）：按 step 排序即可 */
    return out.sort((a, b) => a.step - b.step);
  }

  /**
   * 曲子有多长（步数）：新建的曲子是一小节 16 步；
   * 载入示例曲 / 导入的曲子可以有很多小节（谱面按小节翻页）。
   */
  function songLen(song) {
    if (!song || !song.rows || !song.rows.length) return BEATS;
    const n = song.rows[0] ? song.rows[0].length : 0;
    return Math.max(BEATS, n || BEATS);
  }

  /** 曲子一共有几小节（4/4，一小节 16 个十六分步） */
  function songBars(song) { return Math.max(1, Math.round(songLen(song) / BEATS)); }

  /**
   * 换乐器：先把还在响的音全部收掉（用户报的「换乐器还在响」就是这个），
   * 再刷新当前音色并落盘。
   */
  function setInstrument(id) {
    const next = INST[id] ? id : 'piano';
    if (next !== current) stopAll(0.02);
    stopDemo(false);
    current = next;
    if (cur) { cur.inst = next; cur.timbre = next; persist(); }
    return current;
  }

  /* ================================================================== */
  /* 视图                                                              */
  /* ================================================================== */
  let tab = 'piano';
  let lastPath = '';              // 上一次渲染的路由：用来判断「刚进音乐页」还是「页内重绘」
  let pianoBase = BASE_MIDI;      // 钢琴键页当前键区的最低音（可整体移八度）
  let keyHint = false;            // 是否在键上显示电脑键盘字母（默认关掉，界面更干净）

  const TABS = [
    ['piano', '钢琴键'],
    ['compose', '谱曲'],
    ['lyrics', '歌词'],
    ['songs', '我的曲子'],
    ['lab', '试音台']
  ];

  UI.route('music', function (view, params) {
    return musicView(view, params);
  });

  /* 直接进入某个页签：注册成一层路由，否则会被兜底重定向到小说页 */
  UI.route('music/:tab', function (view, params) {
    return musicView(view, params);
  });

  function musicView(view, params) {
    loadTune();
    if (!cur) loadSongs();
    UI.setTitle('音乐创作', '钢琴键 · 谱曲 · 歌词 · 试音台');
    const want = params && params.tab;
    if (want && TABS.some((t) => t[0] === want)) tab = want;
    /* 从别处进「音乐创作」（#/music 没带页签）时回到钢琴键页：
       否则会停在离开时的页签上，进来先看到的不是琴键 */
    const path = UI.currentPath();
    if (!want && path === 'music' && lastPath && lastPath !== 'music') tab = 'piano';
    lastPath = path;
    clearPcKeys();                 // 上一次渲染留下的键盘监听一律先摘掉
    loadSamples();                 // 后台把真采样读进内存（失败就静默走合成）

    const pills = U.el('div.chips.scroll', { style: { marginBottom: '10px' } });
    TABS.forEach(([id, label]) => {
      pills.appendChild(U.el('button.chip' + (tab === id ? '.active' : ''), {
        text: label,
        onclick: () => { tab = id; UI.go('music/' + id); }
      }));
    });
    U.append(view, pills);

    /* 弹奏页（钢琴键 / 试音台）不放编曲控制，界面留给键盘本身更清爽 */
    if (tab !== 'piano' && tab !== 'lab') U.append(view, composerHead());

    if (tab === 'piano') buildPiano(view);
    else if (tab === 'compose') buildCompose(view);
    else if (tab === 'lyrics') buildLyrics(view);
    else if (tab === 'lab') buildLab(view);
    else buildSongList(view);

    return function cleanup() {
      stopMeter();
      /* 真的离开音乐模块才收声：模块内部的重新渲染不会打断手上的音 */
      if (!/^music(\/|$)/.test(UI.currentPath() || '')) {
        stopPlay();
        stopDemo(true);
        stopSequence(false);
        stopAll(0.02);
        clearPcKeys();
        demoUi = null;
        libUi = null;
      }
    };
  }

  /* ---------------- 顶部：曲名 / 速度 / 试听（只在编曲类页签出现） ---------------- */
  function composerHead() {
    const head = U.el('div.card.music-head');
    U.append(head, [
      U.el('div.music-head-row', {}, [
        U.el('input.music-name', {
          value: cur.name,
          'aria-label': '曲子名称',
          oninput: (e) => { cur.name = e.target.value; persist(); }
        }),
        U.el('button.icon-btn', { title: '重命名', 'aria-label': '重命名', onclick: () => renameSong() }, U.icon('edit', 'ico-sm'))
      ]),
      U.el('div.music-tools', {}, [
        U.el('button.mus-btn.mus-btn-s', {
          title: '慢一点', 'aria-label': '慢一点',
          onclick: () => { cur.bpm = Math.max(40, cur.bpm - 5); persist(); UI.render(); }
        }, [U.el('span', { text: '−' })]),
        U.el('span.music-bpm', { text: cur.bpm + ' BPM' }),
        U.el('button.mus-btn.mus-btn-s', {
          title: '快一点', 'aria-label': '快一点',
          onclick: () => { cur.bpm = Math.min(220, cur.bpm + 5); persist(); UI.render(); }
        }, [U.el('span', { text: '+' })]),
        U.el('button.mus-btn', {
          /* 停止 = 立刻收声（和真实播放器的停止一个意思），而不是让音自己拖尾 */
          onclick: () => { if (playing) { stopPlay(true); stopAll(0.06); } else startPlay(); }
        }, [U.icon(playing ? 'close' : 'music', 'ico-sm'), U.el('span', { text: playing ? '停止' : '试听' })]),
        U.el('select.music-sel.song-inst', {
          'aria-label': '音色',
          onchange: (e) => { setSongInstrument(cur, e.target.value, { replay: true }); UI.render(); }
        }, INSTRUMENTS.map((it) => U.el('option', { text: it.label, value: it.id, selected: instOf(cur) === it.id })))
      ])
    ]);
    return head;
  }

  /* ---------------- 乐器选择条 ---------------- */
  /** 小徽章：这件乐器现在放的是「采样」还是「合成」 */
  function engineBadge(id) {
    const on = sampleBacked(id);
    const n = sampleNotes(id);
    return U.el('span.sample-badge' + (on ? '.sample-on' : '.sample-off'), {
      'data-engine': on ? 'sample' : 'synth',
      'data-inst': id,
      text: on ? '采样' : '合成',
      title: on
        ? '真采样：FluidR3_GM（CC BY 3.0）· ' + n + ' 个音，邻近采样变调 ≤2 个半音'
        : '内置合成音色（采样没有加载，或这件乐器没有采样）'
    });
  }

  function instrumentPicker(onPick, cls) {
    const box = U.el('div.inst-picker' + (cls ? '.' + cls : ''));
    INSTRUMENTS.forEach((it) => {
      const on = sampleBacked(it.id);
      box.appendChild(U.el('button.inst-chip' + (current === it.id ? '.on' : ''), {
        'data-inst': it.id,
        'data-engine': on ? 'sample' : 'synth',
        onclick: () => { setInstrument(it.id); if (onPick) onPick(it.id); }
      }, [
        U.icon(it.icon, 'ico-sm'),
        U.el('span', { text: it.label }),
        U.el('i.chip-engine' + (on ? '.on' : ''), { title: on ? '真采样' : '内置合成' })
      ]));
    });
    return box;
  }

  function surfaceHint(text) {
    return U.el('div.music-hint', { text: text });
  }

  function wrapSurface(board) {
    const box = U.el('div.music-surface');
    U.append(box, board);
    return box;
  }

  /* ---------------- 一行「够得着」的开关（八度 / 延音 / 键位 / 示例） ---------------- */
  let demoUi = null;

  function refreshDemoUi() {
    if (demoUi && demoUi.btn && demoUi.btn.isConnected) demoUi.setOn(demoOn);
  }

  function toolButtons(kind) {
    const row = U.el('div.music-tools.mus-tools-grid');
    if (kind === 'keyboard') {
      row.appendChild(U.el('button.mus-btn', {
        title: '低八度', 'aria-label': '低八度',
        onclick: () => { pianoBase = shiftOct(pianoBase, -1); UI.render(); }
      }, [U.icon('arrowLeft', 'ico-sm'), U.el('span', { text: '八度' })]));
      row.appendChild(U.el('span.mh-oct', { text: nameOf(pianoBase) + '–' + nameOf(pianoBase + KEYS - 1) }));
      row.appendChild(U.el('button.mus-btn', {
        title: '高八度', 'aria-label': '高八度',
        onclick: () => { pianoBase = shiftOct(pianoBase, 1); UI.render(); }
      }, [U.el('span', { text: '八度' }), U.icon('arrowRight', 'ico-sm')]));
    }
    row.appendChild(U.el('button.mus-btn' + (tune.sustain > 0.05 ? '.on' : ''), {
      'data-sustain': '1',
      'aria-pressed': tune.sustain > 0.05 ? 'true' : 'false',
      title: '延音：放开之后还能响多久',
      onclick: (e) => {
        tune.sustain = tune.sustain > 0.05 ? 0 : 0.5;
        saveTune();
        e.currentTarget.classList.toggle('on', tune.sustain > 0.05);
        e.currentTarget.setAttribute('aria-pressed', tune.sustain > 0.05 ? 'true' : 'false');
        UI.toast(tune.sustain > 0.05 ? '延音已打开' : '延音已关闭', 'music');
      }
    }, [U.icon('music', 'ico-sm'), U.el('span', { text: '延音' })]));
    if (kind === 'keyboard') {
      row.appendChild(U.el('button.mus-btn' + (keyHint ? '.on' : ''), {
        title: '显示电脑键盘对应的字母', 'aria-label': '显示电脑键盘对应的字母',
        onclick: (e) => {
          keyHint = !keyHint;
          e.currentTarget.classList.toggle('on', keyHint);
          applyKeyHint();
        }
      }, [U.icon('text', 'ico-sm'), U.el('span', { text: '键位' })]));
    }
    const demoBtn = U.el('button.mus-btn.lab-demo' + (demoOn ? '.on' : ''), {
      title: '听一段示例乐句', 'aria-label': '听一段示例乐句',
      onclick: () => { if (demoOn) stopDemo(true); else startDemo(); }
    }, [U.icon('star', 'ico-sm'), U.el('span', { text: demoOn ? '停止示例' : '听示例乐句' })]);
    row.appendChild(demoBtn);
    demoUi = {
      btn: demoBtn,
      setOn: (on) => {
        const span = demoBtn.querySelector('span');
        if (span) span.textContent = on ? '停止示例' : '听示例乐句';
        demoBtn.classList.toggle('on', !!on);
      }
    };
    return row;
  }

  /** 键位字母：默认不显示，点「键位」才画到键上（手机上界面干净得多） */
  function applyKeyHint() {
    U.$$('#view .pkey').forEach((k) => {
      const cap = k.querySelector('.kc');
      if (!cap) return;
      cap.textContent = keyHint ? (k.getAttribute('data-key') || '') : '';
    });
  }

  /* ================================================================== */
  /* 键盘：14 白键 + 10 黑键（自动化检查盯的就是这个数）                  */
  /* ================================================================== */
  const KEYMAP = [
    ['a', 0], ['w', 1], ['s', 2], ['e', 3], ['d', 4], ['f', 5], ['t', 6],
    ['g', 7], ['y', 8], ['h', 9], ['u', 10], ['j', 11], ['k', 12],
    ['o', 13], ['l', 14], ['p', 15], [';', 16]
  ];
  const WHITE_KEY_HINT = 'A S D F G H J K';
  const BLACK_KEY_HINT = 'W E T Y U O P';
  const BLACK_RATIO = 0.70;      // 黑键宽度 = 白键的 70%（比默认宽一点，手指更容易按到）

  function shiftOct(base, dir) {
    const next = base + dir * 12;
    /* 49 = C3，73 = C5：三个八度以内都能凑出规整的 14 白键 */
    return clamp(next, 49, 73);
  }

  function buildKeyboardSurface(baseNote, inst, opts) {
    const o = opts || {};
    const board = U.el('div.piano-board');
    const notes = [];
    let blacks = 0;
    for (let m = baseNote; m < baseNote + KEYS; m++) {
      notes.push(m);
      if (isBlack(m)) blacks++;
    }
    if (notes.length - blacks !== 14 || blacks !== 10) {
      /* 极端音域下凑不齐就退回 C4：宁可少一个八度按钮，也不能把键盘画歪 */
      return buildKeyboardSurface(BASE_MIDI, inst, o);
    }
    const keyByMidi = {};
    /* 白键：按序平铺，用 flex 自动等分，黑键绝对定位压在两键交界上 */
    const whites = notes.filter((m) => !isBlack(m));
    const whiteIdx = {};
    whites.forEach((m, i) => { whiteIdx[m] = i; });

    notes.forEach((m) => {
      const black = isBlack(m);
      const k = U.el('button.pkey' + (black ? '.pkey-b' : '.pkey-w'), {
        type: 'button',
        'data-midi': String(m),
        'aria-label': nameOf(m)
      });
      const slot = 100 / 14;
      k.style.left = black
        ? 'calc(' + ((whiteIdx[m - 1] + 1) * slot) + '% - ' + (slot * BLACK_RATIO / 2) + '%)'
        : (whiteIdx[m] * slot) + '%';
      k.style.width = (black ? slot * BLACK_RATIO : slot) + '%';
      /* 白键写音名；黑键的位置留给「键位」字母 */
      k.appendChild(U.el('span.kl', { text: black ? '' : nameOf(m).replace(/\d/g, '') }));
      k.appendChild(U.el('span.kc', { text: '' }));
      keyByMidi[m] = k;
      k.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        strike(m);
      });
      board.appendChild(k);
    });

    /* 电脑键盘映射：字母记在 data-key 上，显示与否由「键位」按钮决定 */
    const keyToMidi = {};
    KEYMAP.forEach(([ch, semi]) => {
      const m = baseNote + semi;
      const k = keyByMidi[m];
      if (!k) return;
      keyToMidi[ch] = m;
      k.setAttribute('data-key', ch === ';' ? ';' : ch.toUpperCase());
    });
    applyKeyHint();

    function strike(m) {
      const k = keyByMidi[m];
      if (k) {
        k.classList.add('down');
        window.setTimeout(() => k.classList.remove('down'), 150);
      }
      playAs(inst, m, { dur: o.dur || 0.8 });
    }

    function press(ch) {
      const m = keyToMidi[String(ch).toLowerCase()];
      if (m === undefined) return false;
      strike(m);
      return true;
    }

    o.mount(board, { press: press, strike: strike, base: baseNote, blacks: blacks });
    return board;
  }

  /** 电脑键盘监听：一个页面只挂一个，靠清理函数换代 */
  function clearPcKeys() {
    if (global.__musicKeyCleanup) {
      try { global.__musicKeyCleanup(); } catch (e) { /* noop */ }
      global.__musicKeyCleanup = null;
    }
  }

  function bindPcKeys(keyApi) {
    /* mount 回来的对象才有 press；拿不到就当没有键盘映射，绝不抛错 */
    const api = (keyApi && typeof keyApi.press === 'function') ? keyApi : { press: () => false };
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && t.tagName && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if (api.press(e.key)) e.preventDefault();
    };
    clearPcKeys();
    document.addEventListener('keydown', onKey);
    global.__musicKeyCleanup = () => document.removeEventListener('keydown', onKey);
  }

  /* ================================================================== */
  /* 指板：吉他 6 弦 × 5 品 / 贝斯 4 弦 × 5 品                          */
  /* ================================================================== */
  function buildFretboardSurface(inst, opts) {
    const o = opts || {};
    const def = INST[inst];
    const board = U.el('div.fretboard');
    const labels = inst === 'bass' ? BASS_TUNE : GUITAR_TUNE;
    const headSpacer = U.el('div.fret-label', { text: '' });
    const head = U.el('div.fret-row.fret-head', {}, [headSpacer]);
    FRETS.forEach((f) => head.appendChild(U.el('div.fret-num', { text: String(f) })));
    board.appendChild(head);
    const cells = [];
    def.strings.forEach((openMidi, si) => {
      const row = U.el('div.fret-row');
      row.appendChild(U.el('div.fret-string', { text: labels[si] || nameOf(openMidi) }));
      cells.push(openMidi);
      FRETS.forEach((f) => {
        const midi = openMidi + f;
        const hit = U.el('button.fret-cell', {
          type: 'button',
          'data-midi': String(midi),
          'data-string': String(si + 1),
          'data-fret': String(f),
          text: nameOf(midi).replace(/\d/g, '')
        });
        hit.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          hit.classList.add('down');
          window.setTimeout(() => hit.classList.remove('down'), 140);
          playAs(inst, midi, { dur: o.dur || 1.0 });
        });
        row.appendChild(hit);
        cells.push(midi);
      });
      board.appendChild(row);
    });
    o.mount(board, { cells: cells });
    return board;
  }

  /* ================================================================== */
  /* 鼓垫：9 个打击垫，点一下就闪                                        */
  /* ================================================================== */
  function buildPadsSurface(opts) {
    const o = opts || {};
    const board = U.el('div.pad-grid');
    const zones = [];
    DRUM_ORDER.forEach((id) => {
      const def = DRUMS[id];
      const pad = U.el('button.drum-pad', { type: 'button', 'data-pad': id });
      U.append(pad, [
        U.el('span.pad-name', { text: def.label }),
        U.el('span.pad-id', { text: id })
      ]);
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pad.classList.add('hit');
        window.setTimeout(() => pad.classList.remove('hit'), 130);
        playPad(id);
      });
      board.appendChild(pad);
      zones.push(pad);
    });
    o.mount(board, { pads: zones });
    return board;
  }

  function buildSurface(inst, opts) {
    if (INST[inst] && INST[inst].surface === 'fretboard') return buildFretboardSurface(inst, opts);
    if (INST[inst] && INST[inst].surface === 'pads') return buildPadsSurface(opts);
    return buildKeyboardSurface(opts && opts.base ? opts.base : BASE_MIDI, inst, opts);
  }

  /* ---------------- 钢琴键页（弹奏页，只留琴键和一行开关） ---------------- */
  /* 乐器选择条常驻：换到吉他/贝斯/鼓组时，这一页的表面也跟着换 */
  function buildPiano(view) {
    loadTune();
    let keys = null;
    const kind = (INST[current] || INST.piano).surface;

    U.append(view, instrumentPicker(() => UI.render()));
    const surface = buildSurface(current, {
      base: pianoBase,
      mount: (b, api) => { keys = api; }
    });
    U.append(view, wrapSurface(surface));
    U.append(view, toolButtons(kind));

    if (kind === 'keyboard') {
      bindPcKeys(keys);
      U.append(view, surfaceHint('点键就响。电脑键盘：白键 ' + WHITE_KEY_HINT + '，黑键 ' + BLACK_KEY_HINT
        + '。想细调音色、听示例，去「试音台」。'));
    } else if (kind === 'pads') {
      U.append(view, surfaceHint('鼓是一次性的：点一下就响，不用放开。'));
    } else {
      U.append(view, surfaceHint('行是弦、列是品，点任意一格出声 —— 拨弦会自己衰减下去。'));
    }
    U.append(view, miniMeter());
  }

  /* ---------------- 试音台：1 选乐器 → 2 弹一弹 → 3 调音色 ---------------- */
  function buildLab(view) {
    loadTune();
    const card = U.el('div.card.lab-card');
    const kind = (INST[current] || INST.piano).surface;

    /* 1 · 选乐器 */
    U.append(card, U.el('div.lab-sec', {}, [
      U.el('span.lab-sec-n', { text: '1' }),
      U.el('span.lab-sec-t', { text: '选乐器' }),
      U.el('span.lab-sec-s', { text: '点一下换音色' })
    ]));
    U.append(card, instrumentPicker(() => UI.render(), 'lab'));

    /* 2 · 弹一弹 */
    U.append(card, U.el('div.lab-sec', {}, [
      U.el('span.lab-sec-n', { text: '2' }),
      U.el('span.lab-sec-t', { text: '弹一弹' }),
      U.el('span.lab-sec-s', { text: '按下面的键 / 弦 / 鼓垫' })
    ]));
    let keys = null;
    const surface = buildSurface(current, { mount: (b, api) => { keys = api; } });
    U.append(card, wrapSurface(surface));
    U.append(card, toolButtons(kind));

    /* 3 · 调音色 */
    U.append(card, U.el('div.lab-sec', {}, [
      U.el('span.lab-sec-n', { text: '3' }),
      U.el('span.lab-sec-t', { text: '调音色' }),
      U.el('span.lab-sec-s', { text: '改动会自动记住' })
    ]));
    U.append(card, controlRow('音量', 'volume', '总输出大小'));
    U.append(card, controlRow('延音', 'sustain', '放开之后还能响多久'));
    U.append(card, controlRow('明亮度', 'brightness', '滤波器截止与泛音配比：暗 ↔ 亮'));

    const meter = U.el('div.meter', {}, [U.el('i')]);
    U.append(card, U.el('div.lab-meter-row', {}, [
      U.el('span.lab-meter-t', { text: '电平' }),
      meter,
      U.el('span.lab-meter-v', { text: instLabel(current) }),
      engineBadge(current)
    ]));
    U.append(card, surfaceHint('这一页专门试音：换乐器、按真实的键/弦/鼓垫出声，听一段内置示例，再调音色。'
      + '满意了就回「谱曲」页写下来。'));

    /* 4 · 曲库（示例音乐 + 导入） */
    if (Tunes && Tunes.list.length) U.append(card, tuneSection());

    U.append(view, card);
    if (kind === 'keyboard') bindPcKeys(keys);
    startMeter(meter);
  }

  function controlRow(label, key, hint) {
    const val = U.el('span.mus-tune-v', { text: Math.round(tune[key] * 100) + '%' });
    const row = U.el('div.mus-tune', { 'data-tune': key }, [
      U.el('span.mus-tune-l', { text: label }),
      U.el('input.mus-tune-r', {
        type: 'range',
        min: '0',
        max: '100',
        value: String(Math.round(tune[key] * 100)),
        'aria-label': label,
        oninput: (e) => {
          const v = clamp(Number(e.target.value) / 100, 0, 1);
          tune[key] = v;
          val.textContent = Math.round(v * 100) + '%';
          if (key === 'volume') applyVolume();
          saveTune();
        }
      }),
      val
    ]);
    row.title = hint || '';
    return row;
  }

  /* ---------------- 电平表 ---------------- */
  let meterRaf = 0;
  function stopMeter() {
    if (meterRaf) { try { (global.cancelAnimationFrame || clearTimeout)(meterRaf); } catch (e) { /* noop */ } meterRaf = 0; }
  }
  function startMeter(meter) {
    stopMeter();
    const bar = meter.firstChild;
    const tick = () => {
      let lv = 0;
      if (analyser && levelBuf && actx) {
        try {
          analyser.getByteTimeDomainData(levelBuf);
          let sum = 0;
          for (let i = 0; i < levelBuf.length; i++) {
            const v = (levelBuf[i] - 128) / 128;
            sum += v * v;
          }
          lv = Math.sqrt(sum / levelBuf.length) * 3.2;
        } catch (e) { lv = 0; }
      }
      /* 没有音频环境时用「还在响的音数」估一个，界面不至于死气沉沉 */
      if (lv < 0.02) lv = Math.min(0.55, activeVoices() * 0.13);
      const pct = clamp(lv, 0, 1) * 100;
      if (bar) bar.style.width = pct.toFixed(1) + '%';
      /* 视图被换掉就自己停掉，别让循环空转 */
      if (!meter.isConnected) { meterRaf = 0; return; }
      meterRaf = (global.requestAnimationFrame || function (f) { return window.setTimeout(f, 60); })(tick);
    };
    tick();
  }
  function miniMeter() {
    const m = U.el('div.meter.meter-mini', { title: '电平' }, [U.el('i')]);
    startMeter(m);
    return m;
  }

  /* ================================================================== */
  /* 内置示例乐句（每条乐器一段）                                        */
  /* ================================================================== */
  const DEMO_NOTE = {
    piano: [[0, 72], [1, 76], [2, 79], [3, 84], [4, 81], [5, 76], [6, 79], [7, 72],
      [8, 74], [9, 77], [10, 81], [11, 86], [12, 83], [13, 77], [14, 81], [15, 74]],
    epiano: [[0, 64], [2, 67], [4, 71], [6, 74], [8, 72], [10, 67], [12, 71], [14, 64],
      [16, 65], [18, 69], [20, 72], [22, 76], [24, 74], [26, 69], [28, 72], [30, 65]],
    bass: [[0, 40], [2, 40], [3, 43], [4, 45], [6, 43], [8, 38], [10, 38], [11, 41],
      [12, 43], [14, 41], [16, 36], [18, 36], [19, 40], [20, 43], [22, 40], [24, 38]]
  };

  function guitarRiff() {
    const chords = [[52, 59, 64], [47, 55, 59], [48, 55, 60], [50, 57, 62]];  // Em C G D
    const out = [];
    let step = 0;
    chords.forEach((c) => {
      c.slice().reverse().forEach((m, i) => out.push([step + i * 0.13, m]));
      step += 4;
    });
    return out;
  }

  function demoRiff(id) {
    if (id === 'drums') {
      const grid = [
        ['kick', 0], ['hat', 0.5], ['snare', 1], ['hat', 1.5],
        ['kick', 2], ['hat', 2.5], ['snare', 3], ['hatOpen', 3.5]
      ];
      const out = [];
      for (let bar = 0; bar < 2; bar++) {
        grid.forEach((g, i) => {
          out.push([bar * 4 + g[1], g[0]]);
          if (bar === 1 && i % 3 === 0) out.push([bar * 4 + g[1] + 0.25, 'tom']);
        });
      }
      out.push([7.5, 'crash']);
      return out;
    }
    let riff;
    if (id === 'guitar') riff = guitarRiff();
    else riff = (DEMO_NOTE[id] || DEMO_NOTE.piano).map((p) => [p[0] * 0.25, p[1]]);   // 16 分步 → 拍
    const beat = 0.42;
    return riff.map((p) => [p[0] * beat, p[1]]);
  }

  let demoTimer = null;
  let demoOn = false;

  function startDemo() {
    stopDemo(true);
    stopSequence(false);           // 曲库试听那条线让位：一次只放一条
    const id = current;
    const riff = demoRiff(id);
    if (!riff.length) return;
    const t0 = Date.now();
    let i = 0;
    demoTimer = setInterval(() => {
      const el = Date.now() - t0;
      while (i < riff.length && riff[i][0] * 1000 <= el) {
        const p = riff[i];
        playAs(id, p[1], { dur: id === 'drums' ? undefined : 0.9 });
        flashFor(id, p[1]);            // 点亮对应的键/垫，让人看得见在弹什么
        i++;
      }
      if (i >= riff.length) stopDemo(false);   // 示例自己走完：让最后一个音自然衰减
    }, 40);
    demoOn = true;
    refreshDemoUi();
  }

  /** cut=true 时连还在响的音一起收掉（手动停止 / 换乐器 / 离开页面） */
  function stopDemo(cut) {
    demoOn = false;
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    if (cut) stopAll(0.05);
    refreshDemoUi();
  }

  function flashFor(id, key) {
    let el = null;
    if (id === 'drums') el = U.$('[data-pad="' + key + '"]');
    else el = U.$('[data-midi="' + key + '"]');
    if (!el) return;
    const cls = id === 'drums' ? 'hit' : 'down';
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), 150);
  }

  /* ================================================================== */
  /* 示例曲库 + 导入（简谱 / 本应用导出的 JSON）                          */
  /*                                                                    */
  /*   曲库（js/tunes.js）里全部是公有领域传统曲调或本应用原创练习曲；   */
  /*   用户粘贴进来的曲谱只在本机解析、存进本机 settings.songs，不上传。  */
  /*   本模块**不内置任何受版权保护的商业歌曲**。                        */
  /* ================================================================== */
  let libPick = (Tunes && Tunes.list.length) ? Tunes.list[0].id : null;
  let libUi = null;              // 曲库那一块的 DOM 引用（就地刷新，不整页重绘）
  let seqTimer = null;           // 曲库 / 导入试听的时钟
  let seqInfo = null;            // { id, name, inst, bpm, total, index, beats }

  function tuneList() { return Tunes ? Tunes.list : []; }
  function tuneMeta(id) { return Tunes ? Tunes.byId(id) : null; }
  function tuneParsed(id) { const t = tuneMeta(id); return t ? Tunes.events(t) : null; }

  /* ---------------- 每首曲子 / 每首示例曲自己的音色 ---------------- */
  /* 示例曲不是「曲子」，用户给它挑的音色单独存在 settings.musicTuneInst；
     导入 / 新建的曲子把音色存在曲子自身的 inst 字段（跟曲子一起落盘）。 */
  let tuneInst = {};
  try { tuneInst = Store.state.settings.musicTuneInst || {}; } catch (e) { tuneInst = {}; }

  /** 音色下拉：谱曲页 / 曲库 / 我的曲子三处共用 */
  function instSelect(selected, onPick, cls) {
    return U.el('select.music-sel' + (cls ? '.' + cls : ''), {
      'aria-label': '音色',
      onchange: (e) => onPick(e.target.value)
    }, INSTRUMENTS.map((it) => U.el('option', {
      text: it.label, value: it.id, selected: it.id === selected
    })));
  }

  /** 某首示例曲该用哪个音色：用户挑过的优先，否则用它的推荐音色 */
  function tuneInstrument(id) {
    const t = tuneMeta(id);
    if (!t) return current;
    return INST[tuneInst[id]] ? tuneInst[id] : t.inst;
  }

  function setTuneInstrument(id, inst) {
    if (!INST[inst] || !tuneMeta(id)) return null;
    tuneInst[id] = inst;
    try { Store.setSetting('musicTuneInst', tuneInst); } catch (e) { /* noop */ }
    refreshLibUi();
    return inst;
  }

  /** 用这首曲子自己的音色重放（试听 / 换音色后立刻听到） */
  function replaySong(song, opt) {
    const s = song || cur;
    if (!s) return null;
    const o = opt || {};
    const maxBeats = Number(o.maxBeats) || 64;          // 最多 16 小节
    const evs = songEventsBeats(s).filter((e) => e.beat < maxBeats);
    if (!evs.length) return null;
    return startSequence(instOf(s), evs, s.bpm, { id: 'song:' + s.id, name: s.name });
  }

  /**
   * 改某首「曲子」的音色：写进曲子（settings.songs 跟着落盘）→
   * 立刻用新音色重放一小段（够听出区别，又不用等整首放完）。
   */
  function setSongInstrument(song, id, opt) {
    const s = song || cur;
    if (!s || !INST[id]) return null;
    const o = opt || {};
    s.inst = id;
    s.timbre = id;
    if (s === cur) current = id;
    persist();
    if (o.replay !== false) replaySong(s);
    refreshLibUi();
    return id;
  }

  /**
   * 按「拍」调度一串事件（曲库试听与导入后试听共用）。
   * 和「示例」按钮同一套状态：谁开始谁就把对方停掉，绝不两条线一起响。
   */
  function startSequence(inst, evs, bpm, meta) {
    stopDemo(false);
    stopSequence(false);
    const list = [];
    (evs || []).forEach((e) => {
      if (!e || e.midi === null || e.midi === undefined) return;      // 休止不发声
      const m = Math.round(Number(e.midi));
      if (!isFinite(m)) return;
      list.push({
        midi: m,
        beat: Math.max(0, Number(e.beat) || 0),
        beats: Math.max(0.125, Number(e.beats) || 1),
        vel: e.vel === undefined ? 1 : e.vel
      });
    });
    if (!list.length) return null;
    list.sort((a, b) => a.beat - b.beat);
    const bpmN = clamp(Number(bpm) || 100, 30, 300);
    const beatMs = 60000 / bpmN;
    const t0 = Date.now();
    const lastEv = list[list.length - 1];
    let i = 0;
    seqInfo = {
      id: (meta && meta.id) || 'seq',
      name: (meta && meta.name) || '',
      inst: inst,
      bpm: Math.round(bpmN),
      total: list.length,
      index: 0,
      beats: round3((meta && meta.beats) || (lastEv.beat + lastEv.beats))
    };
    seqTimer = setInterval(() => {
      const el = Date.now() - t0;
      while (i < list.length && list[i].beat * beatMs <= el) {
        const e = list[i];
        playAs(inst, e.midi, { dur: Math.max(0.12, e.beats * beatMs / 1000), vel: e.vel });
        flashFor(inst, e.midi);                     // 点亮对应的键/弦，看得见在弹什么
        i++;
        if (seqInfo) seqInfo.index = i;
      }
      if (i >= list.length) stopSequence(false);    // 自己走完：让最后一个音自然衰减
    }, 30);
    refreshLibUi();
    return seqInfo;
  }

  /** cut=true 时连还在响的音一起收掉（手动停止 / 离开页面） */
  function stopSequence(cut) {
    const was = !!seqInfo;
    if (seqTimer) { clearInterval(seqTimer); seqTimer = null; }
    seqInfo = null;
    if (cut) stopAll(0.05);
    if (was) refreshLibUi();
  }

  /** 曲库里试听某一首（用它自己的音色：用户挑过的优先，否则推荐音色） */
  function playTune(id) {
    const t = tuneMeta(id);
    const p = t ? Tunes.events(t) : null;
    if (!p || !p.ok) { UI.toast('这首曲子没能解析', 'close'); return null; }
    libPick = id;
    const inst = tuneInstrument(id);
    const info = startSequence(inst, p.events, p.bpm, { id: t.id, name: t.name, beats: p.beats });
    refreshLibUi();
    return info;
  }

  function tuneInfoText() {
    const t = tuneMeta(libPick);
    if (!t) return '曲库是空的';
    const p = Tunes.events(t);
    const parts = [t.tag, '推荐音色：' + instLabel(t.inst)];
    if (p && p.ok) parts.push(p.notes + ' 个音 · ' + p.bars + ' 小节 · ' + p.bpm + ' BPM');
    if (t.source) parts.push(t.source);
    if (seqInfo && seqInfo.id === t.id) parts.push('正在试听 ' + seqInfo.index + '/' + seqInfo.total);
    return parts.join(' · ');
  }

  function refreshLibUi() {
    if (!libUi) return;
    (libUi.chips || []).forEach((c) => {
      if (c.el && c.el.isConnected) c.el.classList.toggle('on', c.id === libPick);
    });
    if (libUi.info && libUi.info.isConnected) libUi.info.textContent = tuneInfoText();
    if (libUi.instSel && libUi.instSel.isConnected) libUi.instSel.value = tuneInstrument(libPick);
    if (libUi.playLabel && libUi.playLabel.isConnected) {
      libUi.playLabel.textContent = (seqInfo && seqInfo.id === libPick) ? '停止' : '试听';
    }
  }

  /* ---------------- 曲库界面（试音台的第 4 段） ---------------- */
  function tunePicker() {
    const box = U.el('div.tune-picker');
    libUi = { chips: [], info: null, playLabel: null };
    tuneList().forEach((t) => {
      const el = U.el('button.tune-chip' + (libPick === t.id ? '.on' : ''), {
        'data-tune': t.id,
        title: t.source || '',
        onclick: () => {
          if (seqInfo && seqInfo.id === t.id) { stopSequence(true); return; }   // 再点一下 = 停
          libPick = t.id;
          playTune(t.id);
        }
      }, [
        U.el('span.tune-name', { text: t.name }),
        U.el('span.tune-tag', { text: t.tag })
      ]);
      libUi.chips.push({ id: t.id, el: el });
      box.appendChild(el);
    });
    return box;
  }

  function tuneInfoRow() {
    const el = U.el('div.tune-info', { text: tuneInfoText() });
    if (libUi) libUi.info = el;
    return el;
  }

  /** 曲库那一行的「音色」下拉：选了立刻用新音色重放，并记住这首曲子的音色 */
  function tuneInstRow() {
    const t = tuneMeta(libPick);
    const sel = instSelect(tuneInstrument(libPick), (id) => {
      setTuneInstrument(libPick, id);
      playTune(libPick);                       // 立刻用新音色重放
    }, 'tune-inst');
    if (libUi) libUi.instSel = sel;
    return U.el('div.mus-tune.tune-inst-row', {}, [
      U.el('span.mus-tune-l', { text: '音色' }),
      sel,
      U.el('span.tune-info-inline', { text: t ? '推荐：' + instLabel(t.inst) : '' })
    ]);
  }

  function tuneTools() {
    const row = U.el('div.score-tools.tune-tools');
    const playLabel = U.el('span', { text: (seqInfo && seqInfo.id === libPick) ? '停止' : '试听' });
    if (libUi) libUi.playLabel = playLabel;
    row.appendChild(U.el('button.btn.sm.tune-play', {
      onclick: () => {
        if (seqInfo && seqInfo.id === libPick) stopSequence(true);
        else playTune(libPick);
      }
    }, [playLabel]));
    row.appendChild(U.el('button.btn.sm.tune-rec', {
      onclick: () => {
        const t = tuneMeta(libPick);
        if (!t) return;
        const wasPlaying = !!(seqInfo && seqInfo.id === libPick);
        setTuneInstrument(libPick, t.inst);      // 回到这首的推荐音色
        setInstrument(t.inst);                   // 顺手把试音台音色也切过去
        UI.render();
        if (wasPlaying) playTune(libPick);       // 正在试听就换上新音色接着听
      }
    }, [U.el('span', { text: '用推荐音色' })]));
    row.appendChild(U.el('button.btn.sm.tune-load', {
      onclick: () => {
        const r = loadTuneIntoSong(libPick);
        if (!r.ok) { UI.toast('载入失败：' + r.error, 'close'); return; }
        UI.toast('已把《' + r.song.name + '》载入谱曲页', 'check');
        UI.go('music/compose');
      }
    }, [U.el('span', { text: '载入谱曲' })]));
    row.appendChild(U.el('button.btn.sm.tune-import', {
      onclick: () => openImportSheet()
    }, [U.el('span', { text: '导入音乐' })]));
    row.appendChild(U.el('button.btn.sm.tune-export', {
      onclick: () => { exportSongJson(cur); UI.toast('已导出当前曲子的 JSON', 'check'); }
    }, [U.el('span', { text: '导出我的曲子' })]));
    return row;
  }

  /** 曲库面板（试音台里的一段） */
  function tuneSection() {
    const wrap = U.el('div');
    U.append(wrap, U.el('div.lab-sec', {}, [
      U.el('span.lab-sec-n', { text: '4' }),
      U.el('span.lab-sec-t', { text: '曲库' }),
      U.el('span.lab-sec-s', { text: '点一下换一首试听' })
    ]));
    U.append(wrap, tunePicker());
    U.append(wrap, tuneInfoRow());
    U.append(wrap, tuneInstRow());
    U.append(wrap, tuneTools());
    U.append(wrap, surfaceHint('曲库里的曲子都是公有领域的传统曲调或本应用原创的练习曲（每首下面写了出处）。'
      + '每首曲子可以单独挑音色（上面那行下拉），挑完立刻重放并记住。'
      + '想弹自己喜欢的歌，用「导入音乐」把自己的简谱 / MIDI / JSON 弄进来 —— 只在本机解析与保存，不上传。'
      + '请只导入你有权使用的曲谱；本应用不内置受版权保护的商业歌曲。'));
    return wrap;
  }

  /** 曲库选择弹层：mode='compose' 载入谱曲页，mode='lab' 试听 */
  function openTuneSheet(mode) {
    if (!Tunes || !Tunes.list.length) { UI.toast('曲库脚本没加载（js/tunes.js）', 'close'); return; }
    UI.sheet({
      title: mode === 'compose' ? '载入示例曲' : '示例曲库',
      body: function (host) {
        U.append(host, U.el('div.music-hint', {
          text: '全部是公有领域传统曲调或本应用原创的练习曲；点一首即可'
            + (mode === 'compose' ? '载入谱曲页（载入后就是普通曲子：可改、可存、可导出）。' : '试听。')
        }));
        const box = U.el('div.tune-picker.tune-picker-sheet');
        tuneList().forEach((t) => {
          const p = Tunes.events(t);
          box.appendChild(U.el('button.tune-chip' + (libPick === t.id ? '.on' : ''), {
            'data-tune': t.id,
            onclick: () => {
              libPick = t.id;
              if (mode === 'compose') {
                const r = loadTuneIntoSong(t.id);
                if (!r.ok) { UI.toast('载入失败：' + r.error, 'close'); return; }
                UI.closeSheet();
                UI.toast('已载入《' + t.name + '》（' + r.bars + ' 小节）', 'check');
                UI.go('music/compose');
              } else {
                playTune(t.id);
                UI.closeSheet();
                UI.render();
              }
            }
          }, [
            U.el('span.tune-name', { text: t.name }),
            U.el('span.tune-tag', { text: t.tag }),
            U.el('span.tune-sub', { text: instLabel(t.inst) + (p && p.ok ? ' · ' + p.bars + ' 小节' : '') })
          ]));
        });
        U.append(host, box);
        U.append(host, U.el('div.music-hint.tune-src', {
          text: '出处都写在每首曲子的说明里；曲调为简化片段，用来试音与认简谱。'
        }));
      }
    });
  }

  /* ---------------- 事件序列 → 曲子（谱面） ---------------- */
  /**
   * 谱面只有 12 行 = 一个八度：音域超出的音就近折回，
   * 折了几个会如实返回（界面会提示），不静默丢音。
   */
  function songFromEvents(evs, meta) {
    const o = meta || {};
    const list = [];
    (evs || []).forEach((e) => {
      if (!e || e.midi === null || e.midi === undefined) return;
      const m = Math.round(Number(e.midi));
      if (!isFinite(m) || m < 0 || m > 127) return;
      list.push({
        midi: m,
        beat: Math.max(0, Number(e.beat) || 0),
        beats: Math.max(0.125, Number(e.beats) || 1),
        vel: e.vel === undefined ? 1 : e.vel
      });
    });
    if (!list.length) return null;
    let min = 127;
    let max = 0;
    list.forEach((e) => { if (e.midi < min) min = e.midi; if (e.midi > max) max = e.midi; });
    /* 选一个「折回最少」的基准音（谱面 = 一个八度 12 行） */
    const lo = clamp(max - (ROWS - 1), 12, 108);
    const hi = clamp(min, 12, 108);
    let base = clamp(min, 12, 108);
    let bestFold = Infinity;
    for (let b = Math.min(lo, hi); b <= Math.max(lo, hi); b++) {
      let f = 0;
      list.forEach((e) => { if (e.midi < b || e.midi > b + ROWS - 1) f++; });
      if (f < bestFold) { bestFold = f; base = b; }
    }
    const endBeat = list.reduce((a, e) => Math.max(a, e.beat + e.beats), 0);
    const steps = Math.max(BEATS, Math.ceil(endBeat * 4 / BEATS) * BEATS);
    const rows = [];
    for (let r = 0; r < ROWS; r++) rows.push(new Array(steps).fill(0));
    let folded = 0;
    list.forEach((e) => {
      let rr = e.midi - base;
      while (rr < 0) { rr += 12; folded++; }
      while (rr > ROWS - 1) { rr -= 12; folded++; }
      const s0 = clamp(Math.round(e.beat * 4), 0, steps - 1);
      const len = Math.max(1, Math.round(e.beats * 4));
      for (let k = 0; k < len && s0 + k < steps; k++) rows[rr][s0 + k] = 1;
    });
    const inst = INST[o.inst] ? o.inst : current;
    return {
      song: {
        id: U.uid('song'),
        name: String(o.name || '导入的曲子').slice(0, 40),
        bpm: clamp(Math.round(Number(o.bpm) || 100), 40, 220),
        inst: inst, timbre: inst,
        baseMidi: base,
        rows: rows,
        lyrics: '',
        at: Date.now(),
        src: o.source ? String(o.source).slice(0, 120) : ''
      },
      steps: steps, folded: folded, notes: list.length, bars: steps / BEATS
    };
  }

  /** 把某首示例曲装进一首新曲子（变成普通曲子：可改 / 可存 / 可导出） */
  function loadTuneIntoSong(id) {
    if (!Tunes) return { ok: false, error: '曲库脚本没加载（js/tunes.js）' };
    const t = tuneMeta(id);
    const p = t ? Tunes.events(t) : null;
    if (!p || !p.ok) return { ok: false, error: (p && p.error ? Tunes.errorText(p) : '这首曲子没能解析') };
    const built = songFromEvents(p.events, { name: t.name, bpm: p.bpm, inst: t.inst, source: t.source });
    if (!built) return { ok: false, error: '这首曲子没有音符' };
    songs.unshift(built.song);
    curId = built.song.id;
    cur = built.song;
    baseMidi = built.song.baseMidi;
    composeBar = 0;
    current = built.song.inst;
    persist();
    return { ok: true, song: built.song, notes: p.notes, bars: built.bars, folded: built.folded, steps: built.steps };
  }

  /* ---------------- 导入 ---------------- */
  function songEventsBeats(song) {
    return events(song).map((e) => ({ midi: e.midi, beat: e.step / 4, beats: e.dur / 4, vel: 1 }));
  }

  /** 简谱文本 → 曲子 */
  function importJianpuText(src, o) {
    if (!Tunes) return { ok: false, kind: 'jianpu', error: '曲库脚本没加载（js/tunes.js）' };
    const p = Tunes.parseJianpu(src, { title: (o && o.name) || '' });
    if (!p.ok) {
      return {
        ok: false, kind: 'jianpu', error: Tunes.errorText(p),
        warnings: p.warnings, notes: p.notes, beats: p.beats
      };
    }
    const built = songFromEvents(p.events, {
      name: (o && o.name) || p.title || '导入的简谱',
      bpm: p.bpm, inst: (o && o.inst) || current, source: '简谱导入'
    });
    if (!built) return { ok: false, kind: 'jianpu', error: '没有可用的音符' };
    built.ok = true;
    built.events = p.events;
    built.kind = 'jianpu';
    built.beats = p.beats;
    built.bars = p.bars;
    built.rests = p.rests;
    built.warnings = p.warnings;
    return built;
  }

  /** 从任意 JSON 里捞出曲子对象（数组 / {songs} / 备份 / 单曲 / 事件表） */
  function collectSongs(data) {
    const out = [];
    const walk = (v, depth) => {
      if (!v || depth > 4) return;
      if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
      if (typeof v !== 'object') return;
      if (Array.isArray(v.songs)) { v.songs.forEach((x) => walk(x, depth + 1)); return; }
      if (v.settings && Array.isArray(v.settings.songs)) { v.settings.songs.forEach((x) => walk(x, depth + 1)); return; }
      if (v.item && (v.item.rows || v.item.events)) { out.push(v.item); return; }
      if (v.data && (v.data.rows || v.data.events)) { out.push(v.data); return; }
      if (v.rows || v.events) { out.push(v); return; }
    };
    walk(data, 0);
    return out;
  }

  /** 单个 JSON 对象 → 曲子 */
  function songFromJson(item, o) {
    if (!item || typeof item !== 'object') return null;
    if (!item.rows && Array.isArray(item.events)) {
      return songFromEvents(item.events.map((e) => ({
        midi: e && e.midi,
        beat: e && e.beat !== undefined ? e.beat : ((e && e.step ? e.step / 4 : 0)),
        beats: e && e.beats !== undefined ? e.beats : ((e && e.dur ? e.dur / 4 : 1)),
        vel: e && e.vel
      })), {
        name: item.name || (o && o.name), bpm: item.bpm || (o && o.bpm),
        inst: item.inst || item.timbre || (o && o.inst), source: 'JSON 事件表'
      });
    }
    if (!Array.isArray(item.rows) || !item.rows.length) return null;
    const src = item.rows.filter((r) => Array.isArray(r));
    if (!src.length) return null;
    let len0 = 1;
    src.forEach((r) => { if (r.length > len0) len0 = r.length; });
    const steps = Math.max(BEATS, Math.ceil(len0 / BEATS) * BEATS);
    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      const line = new Array(steps).fill(0);
      const from = src[r] || [];
      for (let s = 0; s < Math.min(steps, from.length); s++) line[s] = from[s] ? 1 : 0;
      rows.push(line);
    }
    const inst = INST[item.inst] ? item.inst : (INST[item.timbre] ? item.timbre : current);
    return {
      song: {
        id: U.uid('song'),
        name: String(item.name || (o && o.name) || '导入的曲子').slice(0, 40),
        bpm: clamp(Math.round(Number(item.bpm) || 100), 40, 220),
        inst: inst, timbre: inst,
        baseMidi: clamp(Math.round(Number(item.baseMidi) || 72), 24, 96),
        rows: rows,
        lyrics: String(item.lyrics || ''),
        at: Date.now(),
        src: 'JSON 导入'
      },
      steps: steps, folded: 0, notes: events({ rows: rows, baseMidi: item.baseMidi || 72 }).length, bars: steps / BEATS
    };
  }

  /** JSON 文本 → 曲子（认本应用导出的 {app,kind,item}、单曲、数组、整份备份） */
  function importJsonText(src, o) {
    let data = null;
    try { data = JSON.parse(src); } catch (e) {
      return { ok: false, kind: 'json', error: 'JSON 解析失败：' + ((e && e.message) || '格式不对') };
    }
    const raw = collectSongs(data);
    if (!raw.length) return { ok: false, kind: 'json', error: 'JSON 里没找到曲子（需要 rows 谱面或 events 音符列表）' };
    const list = [];
    let folded = 0;
    let skipped = 0;
    raw.forEach((item) => {
      const b = songFromJson(item, o);
      if (b) { list.push(b.song); folded += b.folded; } else skipped++;
    });
    if (!list.length) return { ok: false, kind: 'json', error: 'JSON 里的曲子缺少 rows / events 字段，还原不了' };
    return { ok: true, kind: 'json', songs: list, song: list[0], count: list.length, folded: folded, skipped: skipped };
  }

  /**
   * 统一入口：自动分辨「简谱文本」和「JSON」，成功后存成一首曲子。
   * opt.play=true 时立刻用当前试音台音色演奏一遍。
   */
  function importMusic(text, opt) {
    const o = opt || {};
    const src = String(text === undefined || text === null ? '' : text).trim();
    if (!src) return { ok: false, kind: '', error: '还没有内容：把简谱或 JSON 粘进来再试' };
    const res = /^[\[{]/.test(src) ? importJsonText(src, o) : importJianpuText(src, o);
    return finalizeImport(res, o);
  }

  /** 导入成功后统一收尾：存成曲子 → 成为当前曲子 → （可选）立刻演奏 */
  function finalizeImport(res, o) {
    if (!res || !res.ok) return res;
    const list = (res.songs && res.songs.length) ? res.songs : (res.song ? [res.song] : []);
    if (!list.length) return { ok: false, kind: res.kind, error: '没有可导入的曲子' };
    list.forEach((s) => songs.unshift(s));
    res.song = list[0];
    res.count = list.length;
    curId = res.song.id;
    cur = res.song;
    baseMidi = res.song.baseMidi;
    composeBar = 0;
    persist();
    if (o && o.play) {
      /* 音色：MIDI 用文件里 program change 猜到的那个（那正是「把这首 .mid 调好听」的关键），
         其它导入用当前试音台音色（用户手上的选择优先）。 */
      const useInst = (res.kind === 'midi' && INST[res.song.inst]) ? res.song.inst : current;
      if (res.kind === 'midi') current = useInst;
      startSequence(useInst, res.events || songEventsBeats(res.song), res.song.bpm,
        { id: 'import', name: res.song.name });
    }
    return res;
  }

  /* ---------------- 从文件导入（MIDI / 简谱文本 / JSON） ---------------- */
  /** 真的是「字节」而不是 Blob 上那个 bytes() 方法（新版浏览器 Blob 有这个方法，别误判） */
  function isBytes(v) {
    return !!v && (v instanceof Uint8Array || Array.isArray(v) ||
      (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer));
  }

  function fileBytes(f) {
    if (f && isBytes(f.bytes)) return Promise.resolve(f.bytes);   // 安卓原生通道已经读好字节了
    if (global.U && U.readFileAsArrayBuffer) return U.readFileAsArrayBuffer(f);
    return Promise.reject(new Error('这个环境读不了文件'));
  }

  function bytesToText(buf) {
    if (global.Parsers && global.Parsers.decodeBytes) {
      try { return global.Parsers.decodeBytes(buf); } catch (e) { /* 落到下面 */ }
    }
    try { return new TextDecoder('utf-8').decode(buf); } catch (e) { return ''; }
  }

  function looksMidi(buf) {
    return !!(buf && buf.length > 4 && buf[0] === 0x4d && buf[1] === 0x54 &&
      buf[2] === 0x68 && buf[3] === 0x64);                       // 'MThd'
  }

  /** 文件名 → 曲子名（去掉扩展名） */
  function songNameFromFile(name) {
    const base = String(name || '').replace(/\.[^.]+$/, '').trim();
    return (base || '导入的曲子').slice(0, 40);
  }

  function kindLabel(kind) {
    if (kind === 'midi') return 'MIDI';
    if (kind === 'json') return 'JSON';
    if (kind === 'jianpu') return '简谱';
    return '文件';
  }

  /**
   * 字节 → 曲子。
   * 先看 MIDI 魔数（.mid / .midi 的真实内容），再按文本走 JSON / 简谱。
   */
  function importBuffer(bytes, name, opt) {
    const o = opt || {};
    const buf = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes || []);
    if (!buf.length) return { ok: false, kind: '', error: '文件是空的（0 字节）' };
    const byName = /\.(mid|midi)$/i.test(String(name || ''));
    if (byName && !looksMidi(buf)) {
      return { ok: false, kind: 'midi', error: '这个文件不是有效的 MIDI（开头没有 MThd 头）—— 是不是下载/导出时被改坏了？' };
    }
    if (looksMidi(buf)) {
      if (!Tunes || !Tunes.parseMidi) return { ok: false, kind: 'midi', error: '曲库脚本没加载（js/tunes.js）' };
      const limit = Math.max(1, Number(o.maxNotes) || 2000);
      const m = Tunes.parseMidi(buf, { maxNotes: limit });
      if (!m.ok) return { ok: false, kind: 'midi', error: m.error || 'MIDI 解析失败' };
      const built = songFromEvents(m.events, {
        name: m.title || songNameFromFile(name),
        bpm: m.bpm, inst: m.instrument,
        source: 'MIDI 导入：' + String(name || '未命名文件')
      });
      if (!built) return { ok: false, kind: 'midi', error: 'MIDI 里没有可用的音符' };
      built.ok = true;
      built.kind = 'midi';
      built.events = m.events;
      built.notes = m.notes;
      built.truncated = m.truncated;
      built.limit = limit;
      built.percussion = m.percussion;
      built.instrument = m.instrument;
      built.tracks = m.tracks;
      built.tempoUs = m.tempoUs;
      built.timeSig = m.timeSig;
      return finalizeImport(built, o);
    }
    const text = bytesToText(buf).replace(/^\uFEFF/, '');
    if (!text.trim()) {
      return { ok: false, kind: '', error: '这个文件里没有文字内容（只支持 .mid .midi .txt .md .json）' };
    }
    /* 文件名当默认曲名（JSON 里自带的名字优先），别让导入的曲子全叫「导入的简谱」 */
    const o2 = { name: songNameFromFile(name) };
    Object.keys(o).forEach((k) => { if (o[k] !== undefined && o[k] !== null) o2[k] = o[k]; });
    const res = /^\s*[[{]/.test(text) ? importJsonText(text, o2) : importJianpuText(text, o2);
    return finalizeImport(res, o);
  }

  /** 选中的文件（File / 原生通道对象 / {name, bytes}）→ 曲子 */
  function importFile(file, opt) {
    const o = opt || {};
    if (!file) return Promise.resolve({ ok: false, kind: '', error: '没有选到文件' });
    return fileBytes(file).then(
      (bytes) => importBuffer(bytes, file.name, o),
      (e) => ({ ok: false, kind: '', error: '读不了这个文件：' + ((e && e.message) || e) })
    );
  }

  /** 选一个文件：安卓优先走原生通道（content:// 在 WebView 里读不出来），网页走 <input type=file> */
  function pickMusicFile(accept) {
    const io = ioApi();
    if (!io) return Promise.resolve([]);
    try {
      if (typeof io.pickFilesSmart === 'function') return io.pickFilesSmart(false);
      if (typeof io.pickFile === 'function') return io.pickFile(accept, false);
    } catch (e) { /* 落到下面 */ }
    return Promise.resolve([]);
  }

  /** 当前曲子 → 可再导入的 JSON（去掉 id/时间戳这类一次性字段） */
  function songToJson(song) {
    const s = song || cur;
    if (!s) return null;
    return {
      name: s.name,
      bpm: s.bpm,
      inst: instOf(s),
      baseMidi: s.baseMidi || 72,
      rows: (s.rows || []).map((r) => r.slice()),
      lyrics: s.lyrics || '',
      at: s.at || Date.now()
    };
  }

  function exportSongJson(song) {
    const s = song || cur;
    if (!s) return null;
    const payload = JSON.stringify({ app: 'selfwriting', version: 1, kind: 'music', item: songToJson(s) }, null, 2);
    try {
      const io = ioApi();
      if (io && typeof io.download === 'function') {
        io.download(String(s.name || '曲子').replace(/[\\/:*?"<>|]/g, '_') + '.json', payload, 'application/json');
        return payload;
      }
    } catch (e) { /* 落到复制 */ }
    copyText(payload);
    return payload;
  }

  /** 导入弹层：三条路径 —— 粘贴 / 选择文件 / 说明（附版权提示） */
  function openImportSheet() {
    UI.sheet({
      title: '导入音乐',
      body: function (host) {
        const msg = U.el('div.import-msg');
        const show = (r) => {
          if (!r) return;
          if (r.ok) {
            msg.className = 'import-msg ok';
            msg.textContent = '导入成功：' + r.song.name + '（' + kindLabel(r.kind) + ' · ' +
              songBars(r.song) + ' 小节 · ' + r.song.bpm + ' BPM' +
              (r.notes ? ' · ' + r.notes + ' 个音' : '') +
              (r.truncated ? ' · 已截取前 ' + r.limit + ' 个音符（原文件更长）' : '') +
              (r.percussion ? ' · 跳过 ' + r.percussion + ' 个打击乐音' : '') +
              (r.folded ? ' · ' + r.folded + ' 个音超出一个八度，已就近折回' : '') + '）';
          } else {
            msg.className = 'import-msg bad';
            msg.textContent = '导入失败：' + (r.error || '看不太懂这段内容');
          }
        };

        /* --- 三个面板：粘贴 / 选择文件 / 说明 --- */
        const chipRow = U.el('div.chips.import-tabs');
        const body = U.el('div.import-body');
        const panes = {};
        const tabs = [['paste', '粘贴'], ['file', '选择文件'], ['help', '说明']];
        const switchTo = (key) => {
          tabs.forEach(([k]) => {
            if (panes[k]) panes[k].classList.toggle('hidden', k !== key);
            const chip = chipRow.querySelector('[data-pane="' + k + '"]');
            if (chip) chip.classList.toggle('active', k === key);
          });
        };
        tabs.forEach(([k, label]) => {
          chipRow.appendChild(U.el('button.chip', {
            'data-pane': k, text: label, onclick: () => switchTo(k)
          }));
        });

        /* ① 粘贴 */
        const paste = U.el('div.import-pane.import-pane-paste');
        U.append(paste, U.el('div.music-hint.import-help', {
          html: '把 <b>简谱</b> 或 <b>本应用导出的曲子 JSON</b> 粘进来，会自动识别。'
        }));
        const ta = U.el('textarea.import-text', {
          placeholder: '例如：\nT=90\n1 1 5 5 | 6 6 5 - |\n4 4 3 3 | 2 2 1 - |'
        });
        U.append(paste, ta);
        const doImport = (play) => {
          const r = importMusic(ta.value, { play: play });
          show(r);
          if (r.ok && play) { UI.closeSheet(); UI.render(); }
          return r;
        };
        U.append(paste, U.el('div.score-tools', {}, [
          U.el('button.btn.sm.import-go', {
            onclick: () => doImport(true)
          }, [U.el('span', { text: '解析并试听' })]),
          U.el('button.btn.sm.import-save', {
            onclick: () => doImport(false)
          }, [U.el('span', { text: '只保存' })]),
          U.el('button.btn.sm.import-export', {
            onclick: () => { exportSongJson(cur); UI.toast('已导出当前曲子的 JSON', 'check'); }
          }, [U.el('span', { text: '导出我的曲子' })])
        ]));
        panes.paste = paste;

        /* ② 选择文件 */
        const filePane = U.el('div.import-pane.hidden');
        U.append(filePane, U.el('div.music-hint.import-help', {
          html: '从手机/电脑里选文件导入：<br>'
            + '· <b>.mid / .midi</b>：标准 MIDI 文件（音高 + 时值 + 速度；program 用来猜音色）<br>'
            + '· <b>.txt / .md</b>：简谱文本（写法同「粘贴」）<br>'
            + '· <b>.json</b>：本应用导出的曲子文件'
        }));
        const pickAndImport = (accept, label) => {
          msg.className = 'import-msg';
          msg.textContent = '正在读取' + label + '…';
          pickMusicFile(accept).then((files) => {
            if (!files || !files.length) {
              show({ ok: false, error: '没有选到文件（可能是取消了，或者系统选择器被拦住）' });
              return null;
            }
            msg.textContent = '正在解析 ' + (files[0].name || label) + '…';
            return importFile(files[0], { play: true });
          }).then((r) => {
            if (!r) return;
            show(r);
            if (r.ok) { UI.closeSheet(); UI.render(); }
          }).catch((e) => show({ ok: false, error: '没能读取文件：' + ((e && e.message) || e) }));
        };
        U.append(filePane, U.el('div.score-tools', {}, [
          U.el('button.btn.sm.pick-midi', {
            onclick: () => pickAndImport('.mid,.midi,audio/midi,audio/x-midi', ' MIDI 文件')
          }, [U.el('span', { text: '选择 MIDI 文件' })]),
          U.el('button.btn.sm.pick-text', {
            onclick: () => pickAndImport('.txt,.md,.markdown,text/plain', ' 简谱文件')
          }, [U.el('span', { text: '选择简谱/文本' })]),
          U.el('button.btn.sm.pick-json', {
            onclick: () => pickAndImport('.json,application/json', ' JSON 文件')
          }, [U.el('span', { text: '选择 JSON 文件' })])
        ]));
        panes.file = filePane;

        /* ③ 说明 */
        const help = U.el('div.import-pane.hidden');
        U.append(help, U.el('div.music-hint.import-help', {
          html: '<b>支持的格式</b>：<code>.mid</code> <code>.midi</code>（标准 MIDI 文件）、'
            + '<code>.txt</code> <code>.md</code>（简谱文本）、<code>.json</code>（本应用导出的曲子）。<br><br>'
            + '<b>简谱写法</b>：<br>'
            + '· 音级 <code>1</code>–<code>7</code>（do…si），<code>0</code> 是休止<br>'
            + '· 时值：默认一拍；<code>-</code> 延长一拍（<code>5 - -</code> = 3 拍）；'
            + '<code>5/</code> 八分音符、<code>5//</code> 十六分音符<br>'
            + '· 八度：<code>1\'</code> 高八度、<code>1,</code> 低八度（可叠写）<br>'
            + '· 升降：<code>#4</code>、<code>b7</code><br>'
            + '· 小节线 <code>|</code>；单独一行 <code>T=90</code> 定速度，<code>1=C4</code> 定调<br>'
            + '· 多余空格、换行、中文标点都能认；出错会指出第几行第几列<br><br>'
            + '<b>MIDI 说明</b>：按 16 分音符网格量化，保留音高与相对时值；'
            + '超过 2000 个音符只取前 2000 个；打击乐通道没有音高，会被跳过。'
        }));
        panes.help = help;

        U.append(host, chipRow);
        U.append(host, body);
        U.append(body, paste);
        U.append(body, filePane);
        U.append(body, help);
        U.append(host, msg);
        U.append(host, U.el('div.music-hint.import-warn', {
          text: '请只导入你有权使用的曲谱；本应用不内置受版权保护的商业歌曲。'
            + '导入的内容只保存在本机（不上传、不分享）。'
        }));
        U.append(host, U.el('div.music-hint', {
          text: '导入后它就是一首普通曲子：可以继续改谱、存进「我的曲子」、导出 JSON 或复制歌谱。'
        }));
        switchTo('paste');
      }
    });
  }

  /* ---------------- 谱曲（步进网格） ---------------- */
  let composeBar = 0;            // 谱面翻到第几小节（示例曲/导入的曲子可能有很多小节）

  function buildCompose(view) {
    loadTune();
    const grid = U.el('div.score-grid');
    const base = cur.baseMidi || 72;
    const inst = instOf(cur);
    const bars = songBars(cur);
    if (composeBar >= bars) composeBar = 0;
    const off = composeBar * BEATS;              // 这一页第一格对应的步数

    /* 行标签：从上到下音高递减，更像谱面 */
    const rowsTopDown = [];
    for (let i = ROWS - 1; i >= 0; i--) rowsTopDown.push(i);

    /* 步进头 */
    const head = U.el('div.score-row.score-head');
    head.appendChild(U.el('div.score-label', { text: '' }));
    for (let s = 0; s < BEATS; s++) {
      head.appendChild(U.el('div.score-cell.score-beat' + (s % 4 === 0 ? '.strong' : ''), {
        text: s % 4 === 0 ? String(composeBar * 4 + s / 4 + 1) : ''
      }));
    }
    grid.appendChild(head);

    rowsTopDown.forEach((r) => {
      const row = U.el('div.score-row');
      row.appendChild(U.el('div.score-label', { text: nameOf(base + r) }));
      for (let s = 0; s < BEATS; s++) {
        const g = off + s;
        const on = !!cur.rows[r][g];
        const cell = U.el('button.score-cell' + (on ? '.on' : '') + (s % 4 === 0 ? '.strong' : ''), {
          onclick: () => {
            cur.rows[r][g] = cur.rows[r][g] ? 0 : 1;
            persist();
            cell.classList.toggle('on');
            if (cur.rows[r][g]) playAs(inst, base + r, { dur: 0.4 });
          }
        });
        row.appendChild(cell);
      }
      grid.appendChild(row);
    });

    const tools = U.el('div.score-tools');
    if (bars > 1) {
      tools.appendChild(U.el('button.btn.sm', {
        disabled: composeBar <= 0,
        onclick: () => { composeBar = Math.max(0, composeBar - 1); UI.render(); }
      }, [U.el('span', { text: '‹ 上一小节' })]));
      tools.appendChild(U.el('span.bar-count', { text: '第 ' + (composeBar + 1) + '/' + bars + ' 小节' }));
      tools.appendChild(U.el('button.btn.sm', {
        disabled: composeBar >= bars - 1,
        onclick: () => { composeBar = Math.min(bars - 1, composeBar + 1); UI.render(); }
      }, [U.el('span', { text: '下一小节 ›' })]));
    }
    tools.appendChild(U.el('button.btn.sm', {
      onclick: () => { baseMidi = Math.max(48, baseMidi - 12); cur.baseMidi = baseMidi; persist(); UI.render(); }
    }, [U.el('span', { text: '整体低八度' })]));
    tools.appendChild(U.el('button.btn.sm', {
      onclick: () => { baseMidi = Math.min(84, baseMidi + 12); cur.baseMidi = baseMidi; persist(); UI.render(); }
    }, [U.el('span', { text: '整体高八度' })]));
    tools.appendChild(U.el('button.btn.sm', {
      onclick: () => { cur.rows.forEach((r) => r.fill(0)); persist(); UI.render(); }
    }, [U.icon('trash', 'ico-sm'), U.el('span', { text: '清空' })]));
    tools.appendChild(U.el('button.btn.sm', {
      onclick: () => { demoMelody(); persist(); UI.render(); }
    }, [U.icon('star', 'ico-sm'), U.el('span', { text: '来一段示例' })]));
    tools.appendChild(U.el('button.btn.sm.lab-tune-load', {
      onclick: () => openTuneSheet('compose')
    }, [U.icon('music', 'ico-sm'), U.el('span', { text: '载入示例曲' })]));
    tools.appendChild(U.el('button.btn.sm', {
      onclick: () => openImportSheet()
    }, [U.icon('doc', 'ico-sm'), U.el('span', { text: '导入音乐' })]));
    U.append(view, tools);

    U.append(view, grid);
    U.append(view, U.el('div', {
      style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '12px', lineHeight: '1.8' },
      text: '一列就是一拍里的一个位置（每小节 4 拍、每拍 4 格）。点格子放音，同一列的多个格子会同时响（和弦）。'
        + '当前音色：' + instLabel(inst) + '。'
        + (bars > 1 ? '这首曲子有 ' + bars + ' 小节，用上面的「上一小节 / 下一小节」翻页。' : '')
    }));

    /* 五线谱预览 */
    U.append(view, U.el('div.section-title', {}, [U.icon('music', 'ico-sm'), U.el('span', { text: '乐谱预览' })]));
    U.append(view, staveSvg());
  }

  function demoMelody() {
    /* 回到一小节的示例（原来的行为：清空 + 写一段五声音阶小旋律） */
    cur.rows = [];
    for (let i = 0; i < ROWS; i++) cur.rows.push(new Array(BEATS).fill(0));
    composeBar = 0;
    const demo = [
      [0, 7], [2, 9], [4, 7], [6, 4], [8, 7], [10, 9], [12, 12], [14, 11]
    ];
    demo.forEach(([step, semi]) => {
      const r = semi - (cur.baseMidi - 72);
      if (r >= 0 && r < ROWS && step < BEATS) cur.rows[r][step] = 1;
    });
  }

  /* ---------------- 乐谱预览（SVG 五线谱） ---------------- */
  function staveSvg() {
    const W = 320, lineGap = 7, top = 26;
    const H = top + lineGap * 4 + 34;
    const lines = [];
    for (let i = 0; i < 5; i++) {
      lines.push('<line x1="14" y1="' + (top + i * lineGap) + '" x2="' + (W - 12) + '" y2="' + (top + i * lineGap) + '" stroke="var(--line-strong)" stroke-width="1"/>');
    }
    /* 音符：把行号映射到五线谱位置（每行半音，简化为级进视觉） */
    const ev = events(cur);
    const steps = Math.max(songLen(cur), 1);
    const x0 = 30, x1 = W - 20;
    const notes = ev.slice(0, 64).map((e) => {
      const x = x0 + (e.step / steps) * (x1 - x0);
      const r = e.midi - (cur.baseMidi || 72);
      /* 越高音越靠上：每 2 行抬一个线位 */
      const y = top + lineGap * 4 - (r * lineGap / 2);
      const dur = Math.max(6, (e.dur / steps) * (x1 - x0) * 0.85);
      return '<ellipse cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" rx="4.2" ry="3.1" fill="var(--accent)"/>' +
        (e.dur > 1 ? '<line x1="' + (x + 4.2).toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + (x + dur).toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="var(--accent)" stroke-width="1.6"/>' : '');
    }).join('');
    const wrap = U.el('div.card');
    wrap.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' +
      lines.join('') +
      '<text x="14" y="' + (top + lineGap * 4) + '" font-size="30" fill="var(--text-2)">𝄞</text>' +
      notes +
      '<text x="14" y="' + (H - 6) + '" font-size="10" fill="var(--text-3)">' + songBars(cur) + ' 小节 · ' + cur.bpm + ' BPM · 共 ' + ev.length + ' 个音</text>' +
      '</svg>';
    if (!ev.length) {
      return U.el('div.card', {}, [
        U.el('div', { style: { fontSize: '12.5px', color: 'var(--text-3)', textAlign: 'center', padding: '18px 0' }, text: '还没有音符 —— 到上面点几个格子，这里就会出现乐谱。' })
      ]);
    }
    return wrap;
  }

  /* ---------------- 歌词 ---------------- */
  function buildLyrics(view) {
    const ta = U.el('textarea.music-lyrics', {
      placeholder: '一句一行写歌词。\n\n第一句……\n第二句……',
      value: cur.lyrics || ''
    });
    ta.addEventListener('input', () => { cur.lyrics = ta.value; persist(); });
    ta.addEventListener('blur', () => { cur.lyrics = ta.value; persist(); });

    const info = U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '8px' } });
    const refreshInfo = () => {
      const n = (ta.value || '').split('\n').filter((l) => l.trim()).length;
      info.textContent = n + ' 句 · ' + (ta.value || '').replace(/\s/g, '').length + ' 字（歌词不计入创作字数统计）';
    };
    ta.addEventListener('input', refreshInfo);
    refreshInfo();

    U.append(view, ta);
    U.append(view, info);
    U.append(view, U.el('div.score-tools', { style: { marginTop: '12px' } }, [
      U.el('button.btn.sm', {
        onclick: () => {
          /* 把歌词按句子分行塞到谱面下方预览 */
          const ls = (cur.lyrics || '').split('\n').filter((l) => l.trim());
          if (!ls.length) { UI.toast('还没有歌词', 'close'); return; }
          UI.sheet({
            title: '歌词预览',
            body: (host) => {
              U.append(host, U.el('div', { style: { fontSize: '14px', lineHeight: '2.2', whiteSpace: 'pre-wrap' }, text: ls.join('\n') }));
            }
          });
        }
      }, [U.icon('eye', 'ico-sm'), U.el('span', { text: '预览' })]),
      U.el('button.btn.sm', {
        onclick: () => { copyText(songToText()); }
      }, [U.icon('copy', 'ico-sm'), U.el('span', { text: '复制歌谱' })])
    ]));
  }

  /* ---------------- 我的曲子 ---------------- */
  function buildSongList(view) {
    const list = U.el('div.list');
    songs.forEach((s) => {
      const n = events(s).length;
      const sel = instSelect(instOf(s), (id) => {
        setSongInstrument(s, id, { replay: true });     // 改完立刻用新音色放一小段
        UI.render();
      }, 'row-inst');
      sel.addEventListener('click', (e) => e.stopPropagation());   // 别顺手切曲子
      list.appendChild(U.el('div.row' + (s.id === curId ? '.active' : ''), {
        onclick: () => { curId = s.id; cur = s; baseMidi = s.baseMidi || 72; current = instOf(s); persist(); UI.render(); }
      }, [
        U.el('div.row-main', {}, [
          U.el('div.row-title', { text: s.name }),
          U.el('div.row-sub', { text: n + ' 个音 · ' + s.bpm + ' BPM · 音色 ' + instLabel(instOf(s)) })
        ]),
        sel,
        U.el('button.icon-btn', {
          onclick: (e) => {
            e.stopPropagation();
            UI.confirm('删除这首曲子', '「' + s.name + '」将被删除，无法恢复。', '删除', true).then((ok) => {
              if (!ok) return;
              songs = songs.filter((x) => x.id !== s.id);
              if (!songs.length) songs = [newSong('未命名旋律')];
              if (curId === s.id) { curId = songs[0].id; cur = songs[0]; }
              persist();
              UI.render();
            });
          }
        }, U.icon('trash', 'ico-sm'))
      ]));
    });
    U.append(view, list);
    U.append(view, U.el('div.score-tools', { style: { marginTop: '12px' } }, [
      U.el('button.btn', {
        onclick: () => {
          const s = newSong('新曲子 ' + (songs.length + 1));
          songs.unshift(s); curId = s.id; cur = s; baseMidi = 72;
          persist(); UI.render();
        }
      }, [U.icon('plus', 'ico-sm'), U.el('span', { text: '新建曲子' })]),
      U.el('button.btn', { onclick: () => copyText(songToText()) }, [U.icon('copy', 'ico-sm'), U.el('span', { text: '复制歌谱' })])
    ]));
  }

  /* ================================================================== */
  /* 播放                                                              */
  /* ================================================================== */
  function startPlay() {
    const ev = events(cur);
    if (!ev.length) { UI.toast('谱面还是空的', 'close'); return; }
    if (playing) return;
    const inst = instOf(cur);
    const stepMs = 60000 / cur.bpm / 4;          // 1/16 步
    const total = songLen(cur);                  // 多小节的曲子（示例/导入）整首放完
    let step = 0;
    playHead = -1;
    playing = true;
    const tick = () => {
      if (!playing) return;
      ev.filter((e) => e.step === step).forEach((e) => {
        playAs(inst, e.midi, { dur: Math.max(0.12, e.dur * stepMs / 1000) });
      });
      playHead = step;
      const col = (step % BEATS) + 1;
      U.$$('.score-cell.head', document).forEach((c) => c.classList.remove('head'));
      U.$$('.score-row').forEach((row) => {
        const cell = row.children[col];
        if (cell) cell.classList.add('head');
      });
      step++;
      if (step >= total) { step = 0; }
    };
    tick();
    playTimer = setInterval(tick, stepMs);
    UI.render();                                  // 按钮变成「停止」；播放本身不受重绘影响
  }
  function stopPlay(rerender) {
    const was = playing;
    playing = false;
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    U.$$('.score-cell.head', document).forEach((c) => c.classList.remove('head'));
    if (rerender && was) UI.render();
  }

  /* ================================================================== */
  /* 导出                                                              */
  /* ================================================================== */
  function songToText() {
    const ev = events(cur);
    const lines = [];
    lines.push('《' + cur.name + '》');
    lines.push(cur.bpm + ' BPM · 音色 ' + instLabel(instOf(cur)));
    lines.push('');
    lines.push('音名：');
    const perLine = 8;
    for (let i = 0; i < ev.length; i += perLine) {
      lines.push(ev.slice(i, i + perLine).map((e) => nameOf(e.midi) + (e.dur > 1 ? '(' + e.dur + ')' : '')).join(' '));
    }
    if (cur.lyrics && cur.lyrics.trim()) {
      lines.push('');
      lines.push('歌词：');
      lines.push(cur.lyrics.trim());
    }
    return lines.join('\n');
  }

  function copyText(t) {
    const done = () => UI.toast('已复制到剪贴板', 'check');
    const fail = () => {
      UI.sheet({
        title: '复制这段内容',
        body: (host) => U.append(host, U.el('textarea', { style: { width: '100%', height: '240px' }, value: t }))
      });
    };
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done).catch(fail);
    } else fail();
  }

  function renameSong() {
    UI.input({ title: '曲子名称', value: cur.name, placeholder: '给这段旋律起个名字' }).then((v) => {
      if (v === null || v === undefined) return;
      cur.name = String(v).trim() || '未命名旋律';
      persist();
      UI.render();
    });
  }

  /* ================================================================== */
  /* 采样开关：默认用 assets/samples/ 里的真采样，随时可以退回纯合成       */
  /* ================================================================== */
  let sampleSlots = null;
  try { sampleSlots = Store.state.settings.musicSamples || null; } catch (e) { sampleSlots = null; }

  /**
   * 采样开关（也是自动化测试的「合成兜底」开关）：
   *   useSamples()                → 恢复内置采样库（默认）
   *   useSamples({})              → 明确关掉采样，所有乐器走内置合成
   *   useSamples({piano:1,...})   → 只让列出的乐器用采样，其余走合成
   * 运行期永远是读本地文件，不联网。
   */
  function useSamples(map) {
    const explicit = !(map === undefined || map === null);
    if (!explicit && SAMPLES.enabled && SAMPLES.ready && SAMPLES.loaded > 0) {
      const now = sampleSummary();               // 已经在用内置采样库：什么都不动
      return {
        engine: now.engine, loaded: now.loaded, accepted: sampleSlots || {}, backed: now.backed,
        note: '采样库已经在用：' + now.backed.join('/') + ' 走真采样，其余走内置合成。'
      };
    }
    if (explicit) {
      const keys = Object.keys(map).filter((k) => !!INST[k]);
      SAMPLES.wanted = keys.slice();
      SAMPLES.enabled = keys.length > 0;
      sampleSlots = keys.slice();
    } else {
      SAMPLES.wanted = null;
      SAMPLES.enabled = true;
      sampleSlots = null;
    }
    /* 换了开关就重来一遍：把已解码的采样与计数清空，状态语义才清晰
       （重开时文件走浏览器缓存，解码 48 个 mp3 只要几百毫秒） */
    SAMPLES.byInst = {};
    SAMPLES.files = 0;
    SAMPLES.loaded = 0;
    SAMPLES.failed = 0;
    SAMPLES.bytes = 0;
    SAMPLES.error = null;
    SAMPLES.ready = !SAMPLES.enabled;            // 关掉采样 = 「不用加载了」
    SAMPLES.loading = null;
    try { Store.setSetting('musicSamples', sampleSlots || {}); } catch (e) { /* noop */ }
    const s = sampleSummary();
    return {
      engine: s.engine,
      loaded: s.loaded,
      accepted: sampleSlots || {},
      backed: s.backed,
      note: s.enabled
        ? '采样已启用：' + (s.backed.length ? s.backed.join('/') : '（还没加载完）') + ' 用真采样，其余走内置合成。'
        : '采样已关闭：所有乐器都走内置合成（不联网、不读音频文件）。'
    };
  }

  /* ================================================================== */
  /* 调试接口：window.MusicKit（自动化测试与外部脚本用）                  */
  /* ================================================================== */
  global.MusicKit = {
    instruments: function () { return INSTRUMENTS.map((it) => it.id); },
    instrumentInfo: function () {
      return INSTRUMENTS.map((it) => ({
        id: it.id, label: it.label, surface: it.surface,
        strings: it.strings ? it.strings.length : 0,
        frets: it.frets || 0,
        pads: it.pads ? it.pads.slice() : []
      }));
    },
    labels: function () { return LABELS.slice(); },
    current: function () { return current; },
    setInstrument: setInstrument,
    play: play,
    playAs: playAs,
    playPad: playPad,
    lastEvent: function () { return lastEv; },
    activeVoices: activeVoices,
    stopAll: stopAll,
    voices: function () {
      const list = [];
      voices.forEach((v) => list.push({
        id: v.id, inst: v.inst, midi: v.midi, pad: v.pad,
        decay: round3(v.decay), life: round3(v.life),
        sampled: !!v.sampled, engine: v.sampled ? 'sample' : 'synth',
        remain: round3(Math.max(0, (v.until - Date.now()) / 1000))
      }));
      return list;
    },
    /* 某条音「响多久」的完整配方（不发声，纯计算）—— 吉他/贝斯读它调音最方便 */
    plan: function (inst, midi) {
      const id = INST[inst] ? inst : 'guitar';
      const m = Number(midi);
      if (isNaN(m)) return null;
      if (id === 'guitar' || id === 'bass') return pluckPlan(freqOf(Math.round(m)), { bass: id === 'bass', midi: Math.round(m) });
      if (id === 'drums') return { engine: 'percussion', pad: null };
      return {
        engine: 'additive', kind: id, midi: Math.round(m), freq: round3(freqOf(Math.round(m))),
        sampleRate: sampleRate(), sustain: susAmt(), brightness: brightAmt()
      };
    },
    /* 时长表：t40（−40dB）/ life（强制静音）/ cap（寿命上限），采样与合成共用 */
    notePlan: function (inst, midi) {
      const id = INST[inst] ? inst : 'guitar';
      const m = Number(midi);
      return decayOf(id, isNaN(m) ? 60 : Math.round(m));
    },
    voiceCaps: function () {
      const out = {};
      Object.keys(VOICE_CAP).forEach((k) => { out[k] = VOICE_CAP[k]; });
      return out;
    },
    voiceCounts: voiceCounts,
    useSamples: useSamples,
    /* 采样库：loadSamples() 返回 Promise（已加载过就直接给总览） */
    samples: sampleSummary,
    loadSamples: loadSamples,
    /* 示例曲库 / 简谱 / 导入导出（js/tunes.js 没加载时返回空/报错，不抛异常） */
    tunes: function () { return Tunes ? Tunes.summary() : []; },
    /* 注意：tune() 这个键名已经被「音量/延音/明亮度」占用了，曲库用 tuneInfo() */
    tuneInfo: function (id) {
      const t = tuneMeta(id);
      const p = t ? Tunes.events(t) : null;
      if (!t || !p) return null;
      return {
        id: t.id, name: t.name, tag: t.tag, inst: t.inst, source: t.source,
        bpm: p.bpm, notes: p.notes, beats: p.beats, bars: p.bars, ok: !!p.ok,
        events: p.events, jianpu: t.jianpu
      };
    },
    parseJianpu: function (text, opt) { return Tunes ? Tunes.parseJianpu(text, opt) : null; },
    parseMidi: function (bytes, opt) { return Tunes ? Tunes.parseMidi(bytes, opt) : null; },
    importMusic: importMusic,
    /* 从文件导入：接收 File / {name, bytes} 这类对象，返回 Promise<导入结果> */
    importFile: importFile,
    importBuffer: importBuffer,
    exportSong: function (song) { return songToJson(song); },
    playTune: playTune,
    stopTune: function () { stopSequence(true); return true; },
    loadTune: loadTuneIntoSong,
    libraryPick: function () { return libPick; },
    /* 音色：示例曲（曲库）与曲子（我的曲子）各自的音色 */
    tuneInstrument: tuneInstrument,
    setTuneInstrument: setTuneInstrument,
    songInstrument: function (idOrSong) {
      const s = typeof idOrSong === 'string' ? findSong(idOrSong) : (idOrSong || cur);
      return s ? instOf(s) : null;
    },
    setSongInstrument: function (idOrSong, inst, opt) {
      const s = typeof idOrSong === 'string' ? findSong(idOrSong) : (idOrSong || cur);
      if (!s) return null;
      const o = opt || {};
      return setSongInstrument(s, inst, o);
    },
    /* 所有曲子各自的音色（测试与「我的曲子」页读它） */
    songInstruments: function () {
      const out = {};
      songs.forEach((s) => { out[s.id] = { name: s.name, inst: instOf(s) }; });
      return out;
    },
    tuneInstruments: function () { return JSON.parse(JSON.stringify(tuneInst)); },
    replaySong: function (idOrSong) {
      const s = typeof idOrSong === 'string' ? findSong(idOrSong) : (idOrSong || cur);
      return s ? replaySong(s) : null;
    },
    sequence: function () { return seqInfo ? JSON.parse(JSON.stringify(seqInfo)) : null; },
    tune: function () {
      loadTune();
      return { volume: tune.volume, sustain: tune.sustain, brightness: tune.brightness };
    },
    setTune: function (key, value) {
      loadTune();
      if (tune[key] === undefined) return null;
      tune[key] = clamp(Number(value), 0, 1);
      if (key === 'volume') applyVolume();
      saveTune();
      return tune[key];
    },
    mix: function () {
      return {
        master: MIX.master, wet: MIX.wet, irSeconds: MIX.irSeconds, irDecay: MIX.irDecay,
        preDelayMs: MIX.preDelayMs, trim: TRIM, revSend: REV_SEND,
        compressor: MIX.comp, limiter: MIX.limiter
      };
    },
    debug: function () {
      return {
        instrument: current,
        instruments: INSTRUMENTS.map((it) => it.id),
        surface: (INST[current] || INST.piano).surface,
        tune: { volume: tune.volume, sustain: tune.sustain, brightness: tune.brightness },
        audio: {
          available: !!(global.AudioContext || global.webkitAudioContext),
          ctx: actx ? actx.state : null,
          broken: audioBroken,
          built: GRAPH.built,
          sampleRate: sampleRate(),
          trim: TRIM[current] || 1,
          nodes: GRAPH.nodes.slice(),
          chain: GRAPH.chain,
          reverb: GRAPH.reverb,
          compressor: GRAPH.compressor,
          limiter: GRAPH.limiter,
          voices: activeVoices()
        },
        voices: activeVoices(),
        voiceList: global.MusicKit.voices(),
        voiceCaps: global.MusicKit.voiceCaps(),
        voiceCounts: voiceCounts(),
        lastPlan: lastPlan,
        lastEngine: lastEngine,
        samples: sampleSummary(),
        sampleSlots: sampleSlots,
        tunes: Tunes ? Tunes.summary() : [],
        libraryPick: libPick,
        libraryInstrument: libPick ? tuneInstrument(libPick) : null,
        tuneInstruments: JSON.parse(JSON.stringify(tuneInst)),
        songInstruments: global.MusicKit.songInstruments(),
        sequence: seqInfo ? { id: seqInfo.id, name: seqInfo.name, inst: seqInfo.inst, index: seqInfo.index, total: seqInfo.total, bpm: seqInfo.bpm } : null,
        composeBar: composeBar,
        songs: songs.length,
        tab: tab,
        lastEvent: lastEv
      };
    }
  };

  /* 切后台/关页面：收掉所有还在响的音（安卓壳里退到后台也会走这里） */
  try {
    global.addEventListener('pagehide', function () { stopAll(0.01); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopAll(0.01);
    });
  } catch (e) { /* noop */ }
})(window);
