/* ==========================================================================
   test-calc.js — 计算器引擎自检（不需要浏览器）
   直接加载 view-calc.js 暴露的 CalcEngine，跑一批带期望值的算式。
   用法： node tools/test-calc.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* 造一个最小沙箱：view-calc.js 只用到 U / Store / UI / window */
const settings = {};
const sandbox = {
  console,
  Math,
  Object,
  Array,
  String,
  Number,
  Error,
  isFinite,
  isNaN,
  parseFloat,
  parseInt,
  JSON
};
sandbox.window = sandbox;
sandbox.U = {
  el: () => ({ appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, dataset: {} }),
  append: () => {},
  clear: () => {},
  escapeHtml: (s) => String(s),
  toast: () => {}
};
sandbox.Store = {
  state: { settings: settings },
  setSetting: (k, v) => { settings[k] = v; }
};
sandbox.UI = { route: () => {}, render: () => {}, setTitle: () => {}, currentPath: () => 'calc' };

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'view-calc.js'), 'utf8'), sandbox, { filename: 'view-calc.js' });

const eng = sandbox.CalcEngine;
if (!eng) { console.error('未能取得 CalcEngine'); process.exit(1); }

let pass = 0, fail = 0;
function eq(expr, expected, opts) {
  const deg = !opts || opts.deg !== false;
  let got, err = '';
  try { got = eng.evaluate(expr, deg); } catch (e) { err = e.message; }
  const ok = !err && Math.abs(got - expected) < 1e-9;
  if (ok) { pass++; console.log('  PASS  ' + expr + '  =  ' + eng.fmt(got)); }
  else {
    fail++;
    console.log('  FAIL  ' + expr + '  期望 ' + expected + '  实际 ' + (err ? '错误: ' + err : got));
  }
}
function bad(expr, why) {
  let err = '';
  try { eng.evaluate(expr, true); } catch (e) { err = e.message; }
  if (err) { pass++; console.log('  PASS  ' + expr + '  正确报错（' + err + '）'); }
  else { fail++; console.log('  FAIL  ' + expr + '  应报错但没有：' + why); }
}

console.log('=== 四则与优先级 ===');
eq('1+2*3', 7);
eq('(1+2)*3', 9);
eq('10/4', 2.5);
eq('2+3-4+5', 6);
eq('1.5*4', 6);
eq('0.1+0.2', 0.30000000000000004);   // 浮点原样，不粉饰
eq('100/8/2', 6.25);

console.log('=== 幂 / 阶乘 / 根号 ===');
eq('2^10', 1024);
eq('2^0.5', Math.SQRT2);
eq('5!', 120);
eq('0!', 1);
eq('sqrt(16)', 4);
eq('cbrt(27)', 3);
eq('abs(-7)', 7);

console.log('=== 百分号 ===');
eq('50%', 0.5);
eq('200*10%', 20);
eq('200+10%', 200.1);          // 注：这里是「加 0.1」，不是「加 10%」
eq('100-25%', 99.75);

console.log('=== 一元负号 ===');
eq('-5', -5);
eq('-(3+4)', -7);
eq('3*-2', -6);
eq('-3^2', -9);                 // -(3^2)

console.log('=== 三角函数（角度/弧度）===');
eq('sin(30)', 0.5);
eq('cos(60)', 0.5);
eq('tan(45)', 1);
eq('asin(1)', 90);
/* 注意：默认是角度制，所以带 pi 的式子必须显式声明用弧度 */
eq('sin(pi/2)', 1, { deg: false });
eq('cos(0)', 1, { deg: false });
eq('sin(pi/6)', 0.5, { deg: false });

console.log('=== 对数 / 常数 ===');
eq('ln(e)', 1);
eq('log(1000)', 3);
eq('log(100)', 2);
eq('exp(0)', 1);

console.log('=== 错误处理 ===');
bad('1/0', '除以零');
bad('1+', '表达式不完整');
bad('(1+2', '左括号没有闭合');
bad('1+2)', '多余的右括号');
bad('sqrt(', '函数缺参数');
bad('sqrt()', '函数参数为空');
bad('2..5', '多余小数点');
bad('foo(3)', '未知函数');
bad('', '空表达式');

console.log('');
console.log('===== 计算器引擎：' + pass + '/' + (pass + fail) + ' 通过 =====');
process.exit(fail ? 1 : 0);
