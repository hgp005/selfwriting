/* ==========================================================================
   selfwriting · tools/fetch-samples.js
   构建期一次性把「真采样」下载到 assets/samples/（运行期应用只读本地文件，
   完全离线，不发任何网络请求）。

   素材来源：MIDI.js Soundfonts（FluidR3_GM，Frank Wen）
     · 仓库   https://github.com/gleitz/midi-js-soundfonts   （LICENSE.txt = MIT）
     · 说明   README 明确写明 FluidR3_GM 渲染出来的采样音色为 CC BY 3.0
     · 地址   https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/<gm>-mp3/<Note>.mp3
   许可与出处详见 assets/samples/LICENSE.md（随采样一起发布）。

   用法：
     node tools/fetch-samples.js            # 只补缺失的文件（可反复跑）
     node tools/fetch-samples.js --force    # 全部重下
     node tools/fetch-samples.js --dry      # 只打印计划，不下载

   产物：
     assets/samples/<inst>/<Note>.mp3       每个乐器隔 3 个半音一个音
     assets/samples/manifest.json           清单（应用读它，缺文件就自动回退合成）
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'samples');
const CDN = 'https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/';
const UA = 'selfwriting-fetch-samples/1.0 (+local build script)';
const CONCURRENCY = 4;
const RETRIES = 4;

/* ---------------- 音色表：只挑应用真正弹得到的音域 ----------------
   每个乐器隔 3 个半音取一个音 → 任意音高离最近采样 ≤1.5 个半音，
   用 playbackRate 变调听不出来「变声器」味。 */
const PALETTE = [
  { id: 'piano', gm: 'acoustic_grand_piano', label: '钢琴', from: 48, to: 90, step: 3 },
  { id: 'epiano', gm: 'electric_piano_1', label: '电钢琴', from: 48, to: 87, step: 3 },
  { id: 'guitar', gm: 'acoustic_guitar_steel', label: '吉他', from: 40, to: 70, step: 3 },
  { id: 'bass', gm: 'electric_bass_finger', label: '贝斯', from: 28, to: 49, step: 3 }
];

/* ---------------- 音名 ↔ MIDI（文件名一律 ASCII） ---------------- */
const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC_SHARP = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
const PC_HASH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteNames(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;          // MIDI 60 = C4
  const out = [];
  const push = (n) => { if (out.indexOf(n) < 0) out.push(n); };
  push(PC_FLAT[pc] + oct);                        // MIDI.js 用的是降号名（Bb4）
  push(PC_SHARP[pc] + oct);                       // 另一种常见写法（As4）
  push(PC_HASH[pc] + oct);                        // 升号（A#4）
  return out;
}

/* ---------------- 小工具 ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isMp3(buf) {
  if (!buf || buf.length < 512) return false;
  const b = buf[0];
  const c = buf[1];
  if (b === 0x49 && c === 0x44) return true;                 // 'ID3'
  if (b === 0xff && (c & 0xe0) === 0xe0) return true;        // MPEG 帧同步
  return false;
}

async function download(url) {
  let lastErr = 'unknown';
  for (let i = 0; i < RETRIES; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'audio/mpeg,*/*' } });
      if (!res.ok) { lastErr = 'HTTP ' + res.status; }
      else {
        const buf = Buffer.from(await res.arrayBuffer());
        if (!isMp3(buf)) lastErr = '不是 mp3（' + buf.length + ' 字节）';
        else return buf;
      }
    } catch (e) {
      lastErr = (e && e.message) || String(e);
    }
    await sleep(400 * (i + 1) * (i + 1));                     // 退避：0.4s / 1.6s / 3.6s
  }
  throw new Error(lastErr);
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function dirSize(dir) {
  let total = 0;
  let files = 0;
  const walk = (d) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    list.forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { files++; try { total += fs.statSync(p).size; } catch (e2) { /* noop */ } }
    });
  };
  walk(dir);
  return { files: files, bytes: total };
}

/* ---------------- 主流程 ---------------- */
(async () => {
  const argv = process.argv.slice(2);
  const force = argv.indexOf('--force') >= 0;
  const dry = argv.indexOf('--dry') >= 0;

  const jobs = [];
  PALETTE.forEach((inst) => {
    for (let m = inst.from; m <= inst.to; m += inst.step) {
      jobs.push({ inst: inst, midi: m, names: noteNames(m) });
    }
  });

  console.log('素材库：MIDI.js Soundfonts · FluidR3_GM（CC BY 3.0；仓库 LICENSE.txt = MIT）');
  console.log('来源前缀：' + CDN);
  console.log('计划：' + PALETTE.length + ' 件乐器 / ' + jobs.length + ' 个采样 → ' + path.relative(ROOT, OUT));
  if (dry) {
    jobs.forEach((j) => console.log('  ' + j.inst.id + '  midi ' + j.midi + '  ' + j.names[0] + '.mp3'));
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {
    name: 'selfwriting instrument samples',
    source: 'MIDI.js Soundfonts · FluidR3_GM (Frank Wen)',
    sourceUrl: 'https://github.com/gleitz/midi-js-soundfonts',
    cdn: CDN,
    licence: 'CC BY 3.0 (FluidR3_GM 采样) + MIT (该仓库脚本/清单)',
    licenceFile: 'assets/samples/LICENSE.md',
    generatedAt: new Date().toISOString(),
    instrument: {}
  };

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  /* 每件乐器一个目录；同一目录内的文件按 midi 排序写进清单 */
  for (const inst of PALETTE) {
    const dir = path.join(OUT, inst.id);
    fs.mkdirSync(dir, { recursive: true });
    const entries = [];
    const pend = jobs.filter((j) => j.inst.id === inst.id);

    for (let i = 0; i < pend.length; i += CONCURRENCY) {
      const slice = pend.slice(i, i + CONCURRENCY);
      /* eslint-disable no-await-in-loop */
      await Promise.all(slice.map(async (job) => {
        const file = path.join(dir, job.names[0] + '.mp3');
        const rel = 'assets/samples/' + inst.id + '/' + job.names[0] + '.mp3';
        if (!force && fs.existsSync(file) && fs.statSync(file).size > 512) {
          skipped++;
          entries.push({ midi: job.midi, note: job.names[0], file: rel, bytes: fs.statSync(file).size, cached: true });
          return;
        }
        let ok = null;
        let err = '';
        for (const nm of job.names) {
          const url = CDN + inst.gm + '-mp3/' + encodeURIComponent(nm) + '.mp3';
          try {
            const buf = await download(url);
            ok = { buf: buf, url: url, name: nm };
            break;
          } catch (e) { err = (e && e.message) || String(e); }
        }
        if (!ok) {
          failed++;
          console.log('  [x] ' + inst.id + ' midi ' + job.midi + '（' + job.names.join('/') + '）失败：' + err);
          return;
        }
        fs.writeFileSync(file, ok.buf);
        fetched++;
        bytes += ok.buf.length;
        entries.push({ midi: job.midi, note: ok.name, file: rel, bytes: ok.buf.length });
        process.stdout.write('.');
      }));
    }
    entries.sort((a, b) => a.midi - b.midi);
    manifest.instrument[inst.id] = {
      gm: inst.gm,
      label: inst.label,
      from: inst.from,
      to: inst.to,
      step: inst.step,
      files: entries
    };
    console.log('\n  ' + inst.id + '（' + inst.label + ' / ' + inst.gm + '）：' + entries.length + ' 个采样，midi ' +
      (entries.length ? entries[0].midi + '–' + entries[entries.length - 1].midi : '—'));
  }

  const json = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(OUT, 'manifest.json'), json, 'utf8');

  const all = dirSize(OUT);
  const listed = Object.keys(manifest.instrument)
    .reduce((a, k) => a + manifest.instrument[k].files.length, 0);

  console.log('');
  console.log('===== 采样下载：' + (fetched + skipped) + '/' + jobs.length + ' 就绪（新下载 ' + fetched +
    '，已存在跳过 ' + skipped + '，失败 ' + failed + '）=====');
  console.log('本次新增字节：' + fmtSize(bytes));
  console.log('目录总计：' + all.files + ' 个文件 / ' + fmtSize(all.bytes) + '（含 manifest.json）');
  console.log('清单条目：' + listed + ' 个采样（应用启动时按它加载，缺文件自动回退合成）');
  if (failed) {
    console.log('注意：有 ' + failed + ' 个音下载失败，清单里不会出现它们（应用会用邻近采样变调或走合成）。');
    process.exitCode = 0;                        // 采样是可选资产，不阻断构建
  }
})();
