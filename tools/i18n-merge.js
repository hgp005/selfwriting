/* ==========================================================================
   开发用：把 tools/i18n-frag-*.json 合并成 js/i18n-extra.js
   --------------------------------------------------------------------------
   词条来源：tools/i18n-scan.js 跑遍全部界面收集到的中文文案，
   再由 tools/i18n-batches.js 切成静态词条与数字模板两批人工/机器翻译。
   合并时做几道体检：
     · 键必须原样（不 trim、不改标点）
     · 单字词条不进词典（会和用户自己写的「一」「雨」撞车，改用 data-i18n-group）
     · 模板里的 {} 个数必须与原文一致，否则运行时替换会错位
   用法： node tools/i18n-merge.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'js', 'i18n-extra.js');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

const en = {};
const tw = {};
const tplEn = {};
const tplTw = {};
const problems = [];
let statCount = 0;
let tplCount = 0;

/* ---- 静态词条 ---- */
[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach((n) => {   /* 5 号是人工补的零散词条，6-9 号是源码里捞出来的漏网文案 */
  const frag = readJson(path.join(ROOT, 'tools', 'i18n-frag-' + n + '.json'), null);
  if (!frag) return;
  Object.keys(frag.en || {}).forEach((k) => {
    const v = frag.en[k];
    if (!k || !v) { problems.push('空词条: ' + JSON.stringify(k)); return; }
    if (k.length < 2 && n !== 5) { problems.push('单字词条跳过: ' + k); return; }
    if (/^\s|\s$/.test(k)) { problems.push('键首尾有空格: ' + JSON.stringify(k)); return; }
    en[k] = v;
    statCount++;
  });
  Object.keys(frag.tw || {}).forEach((k) => {
    if (!k || (k.length < 2 && n !== 5)) return;
    tw[k] = frag.tw[k];
  });
});

/* ---- 繁体补充：只补 zh-TW（tools/i18n-frag-tw.json） ---- */
const twFrag = readJson(path.join(ROOT, 'tools', 'i18n-frag-tw.json'), null);
if (twFrag) {
  Object.keys(twFrag.tw || {}).forEach((k) => {
    const v = twFrag.tw[k];
    if (!k || !v || v === k) return;                 /* 与简体相同的就不必存 */
    if (k.length < 2 && k !== '少' && k !== '多' && k !== '字') return;
    tw[k] = v;
  });
  Object.keys(twFrag.templates || {}).forEach((k) => {
    const v = twFrag.templates[k];
    if (!k || !v || v === k) return;
    if ((k.match(/\{\}/g) || []).length !== (String(v).match(/\{\}/g) || []).length) {
      problems.push('繁体模板占位符不一致: ' + k + ' → ' + v);
      return;
    }
    tplTw[k.replace(/\{\}/g, '\u0000')] = String(v).replace(/\{\}/g, '\u0000');
  });
}

/* ---- 数字模板 ---- */
const shapeFrag = readJson(path.join(ROOT, 'tools', 'i18n-frag-shapes.json'), null);
if (shapeFrag) {
  const PH = '\u0000';
  Object.keys(shapeFrag.shapeEn || {}).forEach((k) => {
    const v = shapeFrag.shapeEn[k];
    /* 把翻译稿里的 {} 换成运行时的占位符 */
    const key = k.replace(/\{\}/g, PH);
    const val = String(v).replace(/\{\}/g, PH);
    const nk = (k.match(/\{\}/g) || []).length;
    const nv = (String(v).match(/\{\}/g) || []).length;
    if (nk !== nv) { problems.push('模板占位符数量不一致: ' + k + ' → ' + v); return; }
    if (!val || val === key) return;
    tplEn[key] = val;
    tplCount++;
  });
  Object.keys(shapeFrag.shapeTw || {}).forEach((k) => {
    const v = shapeFrag.shapeTw[k];
    if ((k.match(/\{\}/g) || []).length !== (String(v).match(/\{\}/g) || []).length) return;
    const key = k.replace(/\{\}/g, PH);
    const val = String(v).replace(/\{\}/g, PH);
    if (val && val !== key) tplTw[key] = val;
  });
}

/* 日期类小词条：日历 aria-label 用的，人工修正成更自然的读法 */
const FIX = {
  ['\u0000 日']: '\u0000',
  ['\u0000 日（还没到）']: '\u0000 (not yet)'
};
Object.keys(FIX).forEach((k) => { if (tplEn[k] !== undefined) tplEn[k] = FIX[k]; });

const banner = [
  '/* ==========================================================================',
  '   selfwriting · i18n-extra.js（自动生成，不要手改）',
  '   --------------------------------------------------------------------------',
  '   界面文案的扩展词典：由 tools/i18n-scan.js 跑遍全部界面收集，',
  '   tools/i18n-batches.js 切批，人工/机器翻译后用 tools/i18n-merge.js 合并。',
  '   静态词条 ' + statCount + ' 条，数字模板 ' + tplCount + ' 条。',
  '   键就是源码/界面里的中文原文，数字用 \\u0000 占位（见 js/i18n.js）。',
  '   要改词条：改 tools/i18n-frag-*.json 后重新跑 node tools/i18n-merge.js。',
  '   ========================================================================== */',
  '(function (global) {',
  "  'use strict';",
  '  global.I18N_EXTRA = {',
  '    en: ' + JSON.stringify(en, null, 1).split('\n').join('\n    ') + ',',
  "    'zh-TW': " + JSON.stringify(tw, null, 1).split('\n').join('\n    ') + ',',
  '    templates: {',
  '      en: ' + JSON.stringify(tplEn, null, 1).split('\n').join('\n      ') + ',',
  "      'zh-TW': " + JSON.stringify(tplTw, null, 1).split('\n').join('\n      '),
  '    }',
  '  };',
  '})(window);',
  ''
].join('\n');

fs.writeFileSync(OUT, banner, 'utf8');
const check = fs.readFileSync(OUT, 'utf8');
console.log('写出 ' + path.relative(ROOT, OUT) + ' (' + Buffer.byteLength(check, 'utf8') + ' 字节)');
console.log('  静态词条 en=' + Object.keys(en).length + ' zh-TW=' + Object.keys(tw).length);
console.log('  数字模板 en=' + Object.keys(tplEn).length + ' zh-TW=' + Object.keys(tplTw).length);
if (check.indexOf('\uFFFD') >= 0) console.log('  [x] 文件里有乱码字符！');
if (problems.length) {
  console.log('  提醒 ' + problems.length + ' 条：');
  problems.slice(0, 20).forEach((p) => console.log('    - ' + p));
}
