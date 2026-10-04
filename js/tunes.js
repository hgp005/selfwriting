/* ==========================================================================
   selfwriting · js/tunes.js
   示例曲库 + 简谱解析（纯数据 + 纯函数：不碰 DOM、不碰音频、不联网）

   版权说明（重要）：
     · 本文件里的曲目全部是**公有领域**的传统曲调 / 古典主题，或者本应用
       自己写的原创练习曲；每首都在 `source` 字段里写明出处。
     · **不内置任何受版权保护的商业歌曲**。用户自己粘贴的曲谱属于他的私人
       数据：只在本地解析、存进本机 settings.songs，不上传、不再分发。
     · 曲调都是**简化片段**（等时值化、个别装饰音省略），用途是「听个例子、
       认一下简谱」，不是出版级乐谱。

   简谱格式（parseJianpu）：
     T=90 / BPM=90 / 速度=90      速度（可选，默认 100）
     1=C4                         调号（1 等于哪个音，可选，默认 C4 = 中央 C）
     1 2 3 4 5 6 7                音级（1=do … 7=si）
     0                            休止
     #4 / b7                      升 / 降（也认 ♯ ♭）
     1' / 1,                      高八度 / 低八度（可叠加：1'' / 1,,，也认 ·）
     5 - -                        时值：一个「-」延长一拍（也可写成 5-）
     5/ 5//                       时值：斜杠减半（八分 / 十六分）
     |                            小节线（只用来数小节，不影响音高）
     ，。、；：（）「」《》 等中文标点、多余空格与换行都会被容错忽略
   ========================================================================== */
(function (global) {
  'use strict';

  /* ================================================================== */
  /* 音名 ↔ MIDI                                                        */
  /* ================================================================== */
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /** 'C4' / 'C#4' / 'Db4' / 'c4' → MIDI；认不出来返回 null */
  function noteToMidi(name) {
    const m = String(name == null ? '' : name).trim().match(/^([A-Ga-g])([#b♯♭]?)(-?\d{1,2})$/);
    if (!m) return null;
    let semi = PC[m[1].toUpperCase()];
    if (m[2] === '#' || m[2] === '♯') semi += 1;
    else if (m[2] === 'b' || m[2] === '♭') semi -= 1;
    return (Number(m[3]) + 1) * 12 + semi;
  }

  /** MIDI → 'C4'（只用于显示） */
  function midiToNote(midi) {
    const m = Math.round(Number(midi));
    if (!isFinite(m)) return '';
    return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  /* ================================================================== */
  /* 简谱解析                                                           */
  /* ================================================================== */
  const DEGREE = [0, 0, 2, 4, 5, 7, 9, 11];     // 下标 = 音级：1..7 → 大调音阶半音数
  const PUNCT = '，。、；：！？（）「」『』《》【】“”‘’,.;:!?()<>[]{}';

  const FW = { '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9' };

  /** 全角/花体字符归一化（不动中文标点，标点在分词时再剥） */
  function normalize(text) {
    return String(text == null ? '' : text)
      .replace(/[０-９]/g, (c) => FW[c] || c)
      .replace(/[＃♯]/g, '#')
      .replace(/[♭ｂ]/g, 'b')
      .replace(/[－–—−ー]/g, '-')
      .replace(/[／]/g, '/')
      .replace(/[｜丨]/g, '|')
      .replace(/[’′]/g, "'")
      .replace(/[　\t\r]/g, ' ')
      .replace(/\u00a0/g, ' ');
  }

  function blank() {
    return {
      ok: false, kind: 'jianpu', bpm: 100, tonic: 60, title: '',
      events: [], beats: 0, bars: 0, notes: 0, rests: 0,
      warnings: [], error: null
    };
  }

  /**
   * 简谱文本 → 事件序列。
   * 返回 { ok, bpm, tonic, events:[{midi,beats,beat,vel}], beats, bars, notes, rests,
   *        warnings:[{line,col,msg}], error:{line,col,msg,token}|null }
   * 容错：多余空格 / 换行 / 中文标点 / 全角数字都能吃；真正的错误（无效音级等）
   * 会带上「第几行第几列」停下来。
   */
  function parseJianpu(text, opt) {
    const o = opt || {};
    const out = blank();
    if (o.bpm !== undefined && isFinite(Number(o.bpm))) out.bpm = clampBpm(Number(o.bpm));
    if (o.tonic !== undefined && isFinite(Number(o.tonic))) out.tonic = Math.round(Number(o.tonic));
    if (o.title) out.title = String(o.title);

    const src = normalize(text);
    const lines = src.split('\n');
    let last = null;
    let beat = 0;
    let barCount = 0;
    let barHasNote = false;

    const fail = (msg, line, col, token) => {
      out.error = { line: line, col: col, msg: msg, token: token || '' };
      return false;
    };
    const warn = (msg, line, col) => {
      if (out.warnings.length < 12) out.warnings.push({ line: line, col: col, msg: msg });
    };

    for (let li = 0; li < lines.length && !out.error; li++) {
      const raw = lines[li];
      let i = 0;
      while (i < raw.length) {
        const ch = raw[i];
        if (ch === ' ' || ch === '\u3000') { i++; continue; }
        if (ch === '|') { barCount++; barHasNote = false; i++; continue; }
        let j = i;
        while (j < raw.length && raw[j] !== ' ' && raw[j] !== '|') j++;
        const col = i + 1;
        const word = raw.slice(i, j);
        i = j;
        /* 一个词里可能粘着标点（从别处粘过来很常见）：按标点切开逐个处理 */
        const pieces = splitPunct(word);
        for (let p = 0; p < pieces.length && !out.error; p++) handleWord(pieces[p], li + 1, col);
      }
    }

    /** 处理一个记号：头部指令 / 延长减半 / 音符 */
    function handleWord(rawWord, line, col) {
      const word = stripPunct(rawWord);
      if (!word) return;

      /* ---- 头部指令：T=90 / BPM=90 / 速度=90 / 1=C4 ---- */
      const head = word.match(/^([^=]+)=(.+)$/);
      if (head) {
        const key = head[1].trim().toLowerCase();
        const val = head[2].trim();
        if (/^(t|bpm|tempo|速度|拍速|♩|♪)$/.test(key)) {
          const n = Number(val);
          if (!isFinite(n) || n < 20 || n > 300) {
            fail('速度要写 20–300 之间的数字（例如 T=90）', line, col, word);
            return;
          }
          out.bpm = clampBpm(n);
          return;
        }
        if (key === '1' || key === '调' || key === 'key') {
          const m0 = noteToMidi(val);
          if (m0 === null) { fail('调号写错了（要写成 1=C4 这样）', line, col, word); return; }
          out.tonic = m0;
          return;
        }
        warn('这行不是速度也不是调号，已忽略', line, col);
        return;
      }

      /* ---- 单独的延长 / 减半 ---- */
      if (/^-+$/.test(word)) {
        if (!last || last.midi === null) { warn('这个「-」前面没有音符，已忽略', line, col); return; }
        last.beats += word.length;
        out.beats += word.length;
        return;
      }
      if (/^\/+$/.test(word)) {
        if (!last || last.midi === null) { warn('这个「/」前面没有音符，已忽略', line, col); return; }
        const nb = Math.max(0.125, last.beats / Math.pow(2, word.length));
        out.beats += nb - last.beats;
        last.beats = nb;
        return;
      }

      /* ---- 音符 ---- */
      const m = word.match(/^([#b]?)([0-9])(['’,，·]*)([-]*)([\/]*)$/);
      if (!m) {
        if (/[0-9]/.test(word)) {
          fail('看不懂这个记号（简谱只用 0–7，升降号写 #4 / b7）', line, col, word);
          return;
        }
        warn('跳过一个不是简谱的记号', line, col);
        return;
      }
      const acc = m[1] === '#' ? 1 : (m[1] === 'b' ? -1 : 0);
      const deg = Number(m[2]);
      if (deg > 7) { fail('简谱只有 0–7，「' + deg + '」无效', line, col, word); return; }
      const marks = m[3] || '';
      let oct = 0;
      for (let k = 0; k < marks.length; k++) {
        if (marks[k] === "'" || marks[k] === '·') oct += 1;
        else oct -= 1;                                  // ’ ， ,
      }
      const dashes = (m[4] || '').length;
      const slashes = (m[5] || '').length;
      const beats = Math.max(0.125, (1 + dashes) / Math.pow(2, slashes));
      if (deg === 0) {
        out.rests++;
        out.beats += beats;
        out.events.push({ midi: null, beats: beats, beat: beat, vel: 0 });
        beat += beats;
        last = out.events[out.events.length - 1];
        barHasNote = true;
        return;
      }
      const midi = out.tonic + DEGREE[deg] + acc + oct * 12;
      if (!isFinite(midi) || midi < 12 || midi > 120) {
        fail('音高超出范围（' + midiToNote(midi) + '）', line, col, word);
        return;
      }
      out.notes++;
      out.beats += beats;
      out.events.push({ midi: midi, beats: beats, beat: beat, vel: 1 });
      beat += beats;
      last = out.events[out.events.length - 1];
      barHasNote = true;
    }

    if (!out.error && !out.events.length) {
      out.error = { line: 0, col: 0, msg: '没有解析到任何音符（简谱用 1–7，0 是休止）', token: '' };
    }
    out.bars = barCount + (barHasNote ? 1 : 0);
    if (out.bars < 1) out.bars = 1;
    out.beats = round3(out.beats);
    out.events.forEach((e) => { e.beat = round3(e.beat); e.beats = round3(e.beats); });
    out.ok = !out.error && out.events.some((e) => e.midi !== null);
    return out;
  }

  /** 按标点切开一个词（逗号留着：它是低八度记号；「·」也是八度记号） */
  function splitPunct(word) {
    const parts = [];
    let cur = '';
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      if (ch !== ',' && PUNCT.indexOf(ch) >= 0) {
        if (cur) parts.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur) parts.push(cur);
    return parts;
  }

  function stripPunct(w) {
    let s = String(w);
    let guard = 0;
    while (s.length && PUNCT.indexOf(s[0]) >= 0 && s[0] !== ',' && guard++ < 40) s = s.slice(1);
    guard = 0;
    /* 结尾：逗号要留住（低八度记号），其余标点剥掉 */
    while (s.length && PUNCT.indexOf(s[s.length - 1]) >= 0 && s[s.length - 1] !== ',' && guard++ < 40) {
      s = s.slice(0, -1);
    }
    return s;
  }

  function clampBpm(v) { return Math.max(20, Math.min(300, Math.round(v))); }
  function round3(v) { return Math.round(Number(v) * 1000) / 1000; }

  /** 解析结果 → 错误提示文案（带位置） */
  function errorText(res) {
    if (!res || !res.error) return '';
    const e = res.error;
    const where = e.line ? '第 ' + e.line + ' 行第 ' + e.col + ' 列：' : '';
    return where + e.msg + (e.token ? '（看到的是「' + e.token + '」）' : '');
  }

  /* ================================================================== */
  /* 内置示例曲库                                                        */
  /*   全部是公有领域曲调 / 原创练习曲；source 字段写明出处。             */
  /*   简谱里 1 的绝对音高由 tonic 决定（默认 C4 = 中央 C）。            */
  /* ================================================================== */
  const LIST = [
    {
      id: 'twinkle', name: '小星星', tag: '儿歌', inst: 'piano', bpm: 100, tonic: 60,
      source: '法国童谣《Ah! vous dirai-je, maman》（18 世纪 · 公有领域）',
      jianpu: [
        '1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |',
        '5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - |',
        '1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |'
      ].join('\n')
    },
    {
      id: 'jacques', name: '两只老虎', tag: '儿歌', inst: 'piano', bpm: 104, tonic: 60,
      source: '法国童谣《Frère Jacques》（18 世纪 · 公有领域）· 简化片段',
      jianpu: [
        '1 2 3 1 | 1 2 3 1 | 3 4 5 - | 3 4 5 - |',
        '5 6 5 4 | 3 1 - - | 1 5, 1 - | 1 5, 1 - |'
      ].join('\n')
    },
    {
      id: 'bells', name: '铃儿响叮当', tag: '儿歌', inst: 'epiano', bpm: 120, tonic: 60,
      source: 'Jingle Bells（James Lord Pierpont, 1857 · 公有领域）· 副歌片段',
      jianpu: [
        "3 3 3 - | 3 3 3 - | 3 5 1' 2' | 3 - - - |",
        "4 4 4 4 | 4 3 3 3 | 3 2 2 3 | 2 - 5 - |"
      ].join('\n')
    },
    {
      id: 'birthday', name: '生日快乐', tag: '儿歌', inst: 'epiano', bpm: 108, tonic: 60,
      source: '旋律《Good Morning to All》（1893；美国法院 2015/2016 判定已进入公有领域）',
      jianpu: [
        "5, 5, 6, 5, | 1 7, - - |",
        "5, 5, 6, 5, | 2' 1' - - |",
        "5, 5, 5' 3' | 1' 7, 6, - |",
        "4' 4' 3' 1' | 2' 1' - - |"
      ].join('\n')
    },
    {
      id: 'rowboat', name: '划船歌', tag: '儿歌', inst: 'piano', bpm: 100, tonic: 60,
      source: 'Row Row Row Your Boat（美国传统童谣 · 公有领域）· 简化片段',
      jianpu: [
        "1 1 1 2 3 | 3 2 3 4 5 |",
        "1' 1' 1' 5 5 5 | 3 3 3 1 1 1 |",
        "5, 5, 5, 1 2 3 | 4 - 3 - | 2 - 1 - |"
      ].join('\n')
    },
    {
      id: 'ode', name: '欢乐颂', tag: '经典', inst: 'piano', bpm: 96, tonic: 60,
      source: '贝多芬《第九交响曲》第四乐章主题（1824 · 公有领域）· 主题片段',
      jianpu: [
        '3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 3 - 2 - |',
        '3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2 - 1 - |'
      ].join('\n')
    },
    {
      id: 'jasmine', name: '茉莉花', tag: '民歌', inst: 'piano', bpm: 92, tonic: 60,
      source: '江苏民歌《茉莉花》（传统曲调 · 公有领域）· 简化片段',
      jianpu: [
        "3 3 5 6 | 1' 6 5 6 | 5 3 5 - |",
        "3 3 5 6 | 1' 6 5 6 | 5 3 2 - |",
        "1 2 3 5 | 3 2 1 - |"
      ].join('\n')
    },
    {
      id: 'arpeggio', name: '分解和弦练习', tag: '练习曲', inst: 'guitar', bpm: 92, tonic: 60,
      source: '原创练习曲（本应用自带，可自由使用）',
      jianpu: [
        '1 3 5 3 | 5 3 1 - |',
        '4 6 4 6 | 5 - 5 - |',
        '1 3 5 3 | 5 3 1 - |',
        '4 5 3 1 | 1 - - - |'
      ].join('\n')
    },
    {
      id: 'blues', name: '布鲁斯练习', tag: '练习曲', inst: 'bass', bpm: 96, tonic: 60,
      source: '原创练习曲（本文件自带，可自由使用）· 十二小节布鲁斯音型',
      jianpu: [
        '1 1 b3 3 | 5 b7 5 3 |',
        '1 1 b3 3 | 5 3 1 - |',
        '4 b3 1 b3 | 4 5 b7 5 |',
        '1 b3 3 5 | 1 - - - |'
      ].join('\n')
    },
    /* ---- 第二批：传统民歌 / 世界传统 / 古典童谣（全部公有领域，出处见 source） ---- */
    {
      id: 'baicai', name: '小白菜', tag: '民歌', inst: 'epiano', bpm: 76, tonic: 60,
      source: '河北民歌《小白菜》（传统曲调、作者不详，清代已在民间流传 · 公有领域）· 简化片段',
      jianpu: [
        '6 6 5 3 | 5 6 5 - | 3 5 3 2 | 2 - - - |',
        '6 6 5 3 | 5 6 5 - | 3 5 3 2 | 1 - - - |'
      ].join('\n')
    },
    {
      id: 'fengyang', name: '凤阳花鼓', tag: '民歌', inst: 'piano', bpm: 104, tonic: 60,
      source: '安徽民歌《凤阳花鼓》（明清流传的传统曲调、作者不详 · 公有领域）· 简化片段',
      jianpu: [
        '5 6 5 3 | 2 3 2 - | 5 6 5 3 | 2 1 2 - |',
        '3 5 3 2 | 1 2 1 - | 2 3 5 6 | 5 - - - |'
      ].join('\n')
    },
    {
      id: 'arirang', name: '阿里郎', tag: '民歌', inst: 'guitar', bpm: 84, tonic: 60,
      source: '朝鲜族 / 韩国民谣《阿里郎》（传统民谣，最早西文记谱见于 1896 年 · 公有领域）· 简化片段',
      jianpu: [
        '3 3 3 - | 2 3 2 - | 1 - - - |',
        '3 3 3 - | 2 3 2 - | 1 - - - |',
        '5 5 5 - | 3 5 3 - | 2 - - - | 2 3 2 - | 1 - - - |'
      ].join('\n')
    },
    {
      id: 'sakura', name: '樱花', tag: '民歌', inst: 'piano', bpm: 80, tonic: 60,
      source: '日本传统民谣《さくらさくら》（江户时代流传的曲调，明治时期已刊行 · 公有领域）· 简化片段',
      jianpu: [
        "6 6 7 - | 6 6 7 - | 6 7 1' 7 | 6 7 6 - |",
        "3' 3' 2' - | 7 6 7 - | 6 7 1' 7 | 6 - - - |"
      ].join('\n')
    },
    {
      id: 'greensleeves', name: '绿袖子', tag: '经典', inst: 'guitar', bpm: 96, tonic: 60,
      source: '英国传统曲调《Greensleeves》（16 世纪，最早见于 1580 年前后的文献 · 公有领域）· 简化片段',
      jianpu: [
        "6 1' 2' 3' | 4' 3' 2' 7 | 5 6 7 1' | 6 - 6 - |",
        "6 1' 2' 3' | 4' 3' 2' 7 | 5 6 7 1' | 6 - - - |"
      ].join('\n')
    },
    {
      id: 'farewell', name: '送别', tag: '经典', inst: 'epiano', bpm: 76, tonic: 60,
      source: '旋律为 J. P. Ordway《Dreaming of Home and Mother》（1851 · 公有领域）；'
        + '李叔同填词（1915，1942 年逝世，中国著作权保护期已届满）· 简化片段',
      jianpu: [
        "5 3 5 1' | 7 - 6 - | 5 3 5 1' | 7 - - - |",
        "5 3 5 1' | 7 1' 7 6 | 5 3 5 2' | 1' - - - |"
      ].join('\n')
    },
    {
      id: 'mary', name: '玛丽有只小羊羔', tag: '儿歌', inst: 'piano', bpm: 100, tonic: 60,
      source: '美国童谣《Mary Had a Little Lamb》（1830 年代 · 传统曲调 / 公有领域）',
      jianpu: [
        '3 2 1 2 | 3 3 3 - | 2 2 2 - | 3 5 5 - |',
        '3 2 1 2 | 3 3 3 3 | 2 2 3 2 | 1 - - - |'
      ].join('\n')
    },
    {
      id: 'london', name: '伦敦桥', tag: '儿歌', inst: 'piano', bpm: 108, tonic: 60,
      source: '英国传统童谣《London Bridge Is Falling Down》（中世纪流传、作者不详 · 公有领域）· 简化片段',
      jianpu: [
        '5 6 5 4 | 3 4 5 - | 2 3 4 - | 3 4 5 - |',
        '5 6 5 4 | 3 4 5 - | 2 - 1 - | 1 - - - |'
      ].join('\n')
    }
  ];

  const CACHE = {};

  function byId(id) {
    for (let i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }

  /** 解析某首内置曲（结果按 id 缓存） */
  function events(tune) {
    const t = typeof tune === 'string' ? byId(tune) : tune;
    if (!t) return null;
    if (!CACHE[t.id]) {
      CACHE[t.id] = parseJianpu(t.jianpu, { bpm: t.bpm, tonic: t.tonic, title: t.name });
    }
    return CACHE[t.id];
  }

  /** 曲库总览（界面与调试接口用；不含简谱正文，避免日志太长） */
  function summary() {
    return LIST.map((t) => {
      const p = events(t);
      return {
        id: t.id, name: t.name, tag: t.tag, inst: t.inst, bpm: t.bpm,
        source: t.source, ok: !!(p && p.ok),
        notes: p ? p.notes : 0, beats: p ? p.beats : 0, bars: p ? p.bars : 0,
        error: p && p.error ? errorText(p) : null
      };
    });
  }

  /** 供外部（导入/导出）复用：把事件序列转成「起始拍」排好序的数组 */
  function sorted(evs) {
    return (evs || []).slice().sort((a, b) => a.beat - b.beat);
  }

  /* ================================================================== */
  /* 标准 MIDI 文件（SMF / .mid / .midi）解析                            */
  /*                                                                    */
  /*   只关心「音高 + 时值」：MThd 头 → 多轨 MTrk → 变长时值 delta →     */
  /*   note on/off（velocity=0 视为 note off）→ 量化到 16 分音符网格。    */
  /*   tempo(0x51) 决定曲子 BPM；program change(0xC0) 用来猜乐器。        */
  /*   打击乐通道（第 10 通道，索引 9）的「音高」是鼓件编号，会被排除计数。 */
  /* ================================================================== */
  function toBytes(input) {
    if (!input) return null;
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (Array.isArray(input)) return new Uint8Array(input);
    if (input.buffer && typeof input.byteLength === 'number') return new Uint8Array(input.buffer);
    return null;
  }

  function mstr(b, at, len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      const c = b[at + i];
      if (c === undefined) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  function mu16(b, at) { return (b[at] << 8) | b[at + 1]; }
  function mu32(b, at) { return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0; }

  /** 变长时值：每字节 7 位，最高位表示「还有下一个」 */
  function readVar(b, at, end) {
    let v = 0;
    let i = at;
    for (let k = 0; k < 4; k++) {
      if (i >= end) return null;
      const c = b[i++];
      v = (v << 7) | (c & 0x7f);
      if ((c & 0x80) === 0) return { value: v, next: i };
    }
    return { value: v, next: i };
  }

  /** GM program → 本应用的乐器 id（0–7 钢琴 / 24–31 吉他 / 32–39 贝斯 / 其它钢琴） */
  function instFromProgram(program) {
    const p = Number(program) || 0;
    if (p >= 24 && p <= 31) return 'guitar';
    if (p >= 32 && p <= 39) return 'bass';
    return 'piano';
  }

  /**
   * MIDI 字节 → 事件序列（与简谱解析结果同构，可直接进谱面）。
   * 返回 { ok, bpm, tempoUs, events, notes, kept, truncated, dropped, percussion,
   *        tracks, format, division, programs, mainProgram, mainChannel,
   *        instrument, timeSig, title, error }
   */
  function parseMidi(input, opt) {
    const o = opt || {};
    const maxNotes = Math.max(1, Number(o.maxNotes) || 2000);
    const out = {
      ok: false, kind: 'midi', bpm: 0, tempoUs: 0, events: [], notes: 0, kept: 0,
      truncated: false, dropped: 0, percussion: 0, tracks: 0, format: 0, division: 0,
      programs: [], mainProgram: 0, mainChannel: 0, instrument: 'piano',
      timeSig: null, title: '', error: null
    };
    const b = toBytes(input);
    if (!b || b.length < 14) { out.error = '文件太小，不像 MIDI（至少要 14 个字节）'; return out; }
    if (mstr(b, 0, 4) !== 'MThd') {
      out.error = '不是标准 MIDI 文件（开头没有 MThd 头）';
      return out;
    }
    const hlen = mu32(b, 4);
    if (hlen < 6 || 8 + hlen > b.length) { out.error = 'MIDI 头长度不对（MThd 至少要 6 个字节）'; return out; }
    out.format = mu16(b, 8);
    out.tracks = mu16(b, 10);
    const div = mu16(b, 12);
    if (div & 0x8000) { out.error = '这份 MIDI 用 SMPTE 时间格式，暂不支持（请按「每拍多少 tick」的常规格式导出）'; return out; }
    out.division = div || 480;

    /* --- 收集音轨块 --- */
    const chunks = [];
    let p = 8 + hlen;
    while (p + 8 <= b.length && chunks.length < 64) {
      const id = mstr(b, p, 4);
      const len = mu32(b, p + 4);
      if (id === 'MTrk') chunks.push({ start: p + 8, end: Math.min(b.length, p + 8 + len), i: chunks.length });
      if (len === 0 && id !== 'MTrk') break;
      p += 8 + len;
    }
    if (!chunks.length) { out.error = 'MIDI 里没有音轨（找不到 MTrk）'; return out; }

    const raw = [];              // { midi, ch, startTick, endTick, vel }
    const tempos = [];           // { tick, us }
    let sawEnd = false;

    const addProgram = (program, ch) => { out.programs.push({ program: program, ch: ch }); };

    chunks.forEach((tr) => {
      let i = tr.start;
      let tick = 0;
      let status = 0;
      const open = Object.create(null);
      while (i < tr.end) {
        const dv = readVar(b, i, tr.end);
        if (!dv) break;
        i = dv.next;
        tick += dv.value;
        if (i >= tr.end) break;
        let st = b[i];
        if (st & 0x80) { i++; status = st; } else { st = status; }   // running status
        if (!st) break;
        if (st === 0xff) {                                            // 元事件
          const type = b[i++];
          const dl = readVar(b, i, tr.end);
          if (!dl) break;
          i = dl.next;
          const len = dl.value;
          const d0 = i;
          if (type === 0x51 && len >= 3) {
            tempos.push({ tick: tick, us: (b[d0] << 16) | (b[d0 + 1] << 8) | b[d0 + 2] });
          } else if (type === 0x03 && !out.title) {
            out.title = mstr(b, d0, len).replace(/\u0000/g, '').trim();
          } else if (type === 0x58 && len >= 2 && !out.timeSig) {
            out.timeSig = { num: b[d0], den: Math.pow(2, b[d0 + 1]) };
          } else if (type === 0x2f) { sawEnd = true; break; }
          i = d0 + len;
          continue;
        }
        if (st === 0xf0 || st === 0xf7) {                             // sysex：跳过
          const dl = readVar(b, i, tr.end);
          if (!dl) break;
          i = dl.next + dl.value;
          continue;
        }
        const hi = st & 0xf0;
        const ch = st & 0x0f;
        if (hi === 0x90 || hi === 0x80) {
          const note = b[i++];
          const vel = b[i++];
          const on = (hi === 0x90 && vel > 0);                        // velocity=0 = note off
          const key = ch * 128 + note;
          if (on) {
            if (open[key] !== undefined) raw[open[key]].endTick = tick;   // 同音重复：先收上一条
            if (raw.length < maxNotes * 6) {
              open[key] = raw.length;
              raw.push({ midi: note, ch: ch, startTick: tick, endTick: -1, vel: vel });
            } else out.dropped++;
          } else if (open[key] !== undefined) {
            raw[open[key]].endTick = tick;
            delete open[key];
          }
          continue;
        }
        if (hi === 0xc0) { addProgram(b[i], ch); i += 1; continue; }
        if (hi === 0xd0) { i += 1; continue; }
        if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) { i += 2; continue; }
        break;                                                        // 看不懂的状态：保护性停下
      }
      Object.keys(open).forEach((k) => {
        const n = raw[open[k]];
        if (n && n.endTick < 0) n.endTick = tick;
      });
    });

    if (!raw.length) {
      out.error = sawEnd ? '这份 MIDI 里没有音符（只有控制信息）' : 'MIDI 里没有音符（没有 note on/off）';
      return out;
    }

    const melodic = [];
    raw.forEach((n) => { if (n.ch === 9) out.percussion++; else melodic.push(n); });
    if (!melodic.length) {
      out.error = '这份 MIDI 只有打击乐（第 10 通道），没有旋律音符 —— 谱面只放有音高的旋律';
      return out;
    }

    melodic.sort((a, z) => (a.startTick - z.startTick) || (a.midi - z.midi));
    let keep = melodic;
    if (melodic.length > maxNotes) {
      keep = melodic.slice(0, maxNotes);
      out.truncated = true;
    }
    out.kept = keep.length;
    out.notes = keep.length;

    /* --- tempo → BPM（取最早的一个） --- */
    let bpm = 100;
    if (tempos.length) {
      tempos.sort((a, z) => a.tick - z.tick);
      out.tempoUs = tempos[0].us;
      out.tempoChanges = tempos.length;
      if (tempos[0].us > 0) bpm = Math.round(60000000 / tempos[0].us);
    } else {
      out.tempoUs = 500000;                 // MIDI 默认 120 BPM
    }
    out.bpm = Math.max(20, Math.min(300, bpm));

    /* --- 乐器猜测：音符最多的那个通道用的是哪个 program --- */
    const chCount = {};
    keep.forEach((n) => { chCount[n.ch] = (chCount[n.ch] || 0) + 1; });
    let mainCh = 0;
    let bestCount = -1;
    Object.keys(chCount).forEach((c) => {
      if (chCount[c] > bestCount) { bestCount = chCount[c]; mainCh = Number(c); }
    });
    const pros = out.programs.filter((x) => x.ch === mainCh).map((x) => x.program);
    out.mainChannel = mainCh;
    out.mainProgram = pros.length ? pros[0] : 0;
    out.instrument = instFromProgram(out.mainProgram);

    const divN = out.division;
    out.events = keep.map((n) => {
      const startBeat = n.startTick / divN;
      const endTick = n.endTick > n.startTick ? n.endTick : n.startTick + divN / 4;
      return {
        midi: n.midi,
        beat: round3(startBeat),
        beats: round3(Math.max(0.25, (endTick - n.startTick) / divN)),
        vel: round3(Math.max(0.05, Math.min(1.6, n.vel / 127)))
      };
    });
    out.ok = true;
    return out;
  }

  global.Tunes = {
    version: 1,
    list: LIST,
    byId: byId,
    events: events,
    summary: summary,
    parseJianpu: parseJianpu,
    parseMidi: parseMidi,
    instFromProgram: instFromProgram,
    errorText: errorText,
    noteToMidi: noteToMidi,
    midiToNote: midiToNote,
    sorted: sorted
  };
})(typeof window !== 'undefined' ? window : globalThis);
