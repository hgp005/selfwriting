/* ==========================================================================
   selfwriting · view-calc.js
   小计算器：标准 / 科学 / 单位换算 + 记忆 + 历史
   设计目标：把市面上计算器「常用但不啰嗦」的功能做齐 ——
     四则运算、括号、百分号（含「加上百分之几」这类口语化用法）、
     正负号、退格、科学函数、角度/弧度、记忆加减、历史记录、
     以及随手能用的一点点单位换算（长度/重量/温度/面积）。
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const Store = global.Store;
  const UI = global.UI;

  /* ================================================================== */
  /* 表达式引擎：手写分词 + 调度场算法（不用 eval，避免意外执行）          */
  /* ================================================================== */
  const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    ln: Math.log, log: (x) => Math.log10(x), sqrt: Math.sqrt,
    cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp
  };
  const CONSTS = { pi: Math.PI, e: Math.E };

  /** 分词：数字 / 函数 / 常量 / 运算符 / 括号 */
  function tokenize(src) {
    const s = String(src).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
      .replace(/π/g, 'pi').replace(/√/g, 'sqrt');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        /* 科学计数法 1e-3 */
        if (s[j] === 'e' && /[0-9+\-]/.test(s[j + 1] || '')) {
          let k = j + 1;
          if (/[+\-]/.test(s[k])) k++;
          if (/[0-9]/.test(s[k] || '')) { while (k < s.length && /[0-9]/.test(s[k])) k++; j = k; }
        }
        const raw = s.slice(i, j);
        if ((raw.match(/\./g) || []).length > 1) throw new Error('数字里有多余的小数点');
        out.push({ t: 'num', v: parseFloat(raw) });
        i = j;
        continue;
      }
      if (/[a-z]/i.test(c)) {
        let j = i;
        while (j < s.length && /[a-z0-9]/i.test(s[j])) j++;
        const word = s.slice(i, j).toLowerCase();
        if (FUNCS[word]) out.push({ t: 'func', v: word });
        else if (CONSTS[word] !== undefined) out.push({ t: 'num', v: CONSTS[word] });
        else throw new Error('不认识的符号：' + word);
        i = j;
        continue;
      }
      if ('+-*/^()%!'.indexOf(c) >= 0) {
        /* 一元负号：开头或紧跟运算符/左括号时，视为 (0-1)* */
        if (c === '-' && (out.length === 0 || (out[out.length - 1].t === 'op' && out[out.length - 1].v !== '!') ||
            (out[out.length - 1].t === 'lp'))) {
          out.push({ t: 'num', v: -1 }, { t: 'op', v: '*' });
          i++;
          continue;
        }
        if (c === '(') out.push({ t: 'lp' });
        else if (c === ')') out.push({ t: 'rp' });
        else if (c === '%') out.push({ t: 'pct' });          // 后缀百分号
        else out.push({ t: 'op', v: c });
        i++;
        continue;
      }
      throw new Error('无法识别的字符：' + c);
    }
    return out;
  }

  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3, '!': 4 };
  const RIGHT = { '^': true, '!': true };

  function toRpn(tokens) {
    const output = [], stack = [];
    tokens.forEach((tk) => {
      if (tk.t === 'num') output.push(tk);
      else if (tk.t === 'func') stack.push(tk);
      else if (tk.t === 'pct') {                       // 后缀 %：等价于除以 100
        output.push({ t: 'op', v: '/100' });
      } else if (tk.t === 'op') {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.t === 'func' ||
              (top.t === 'op' && (PREC[top.v] > PREC[tk.v] ||
                (PREC[top.v] === PREC[tk.v] && !RIGHT[tk.v])))) {
            output.push(stack.pop());
          } else break;
        }
        stack.push(tk);
      } else if (tk.t === 'lp') stack.push(tk);
      else if (tk.t === 'rp') {
        let opened = false;
        while (stack.length && stack[stack.length - 1].t !== 'lp') output.push(stack.pop());
        if (!stack.length) throw new Error('多余的右括号');
        stack.pop();
        if (stack.length && stack[stack.length - 1].t === 'func') output.push(stack.pop());
      }
    });
    while (stack.length) {
      const top = stack.pop();
      if (top.t === 'lp') throw new Error('左括号没有闭合');
      output.push(top);
    }
    return output;
  }

  function evalRpn(rpn, angleDeg) {
    const st = [];
    rpn.forEach((tk) => {
      if (tk.t === 'num') { st.push(tk.v); return; }
      if (tk.t === 'func') {
        if (!st.length) throw new Error('函数缺少参数');
        let x = st.pop();
        if (angleDeg && /^(sin|cos|tan)$/.test(tk.v)) x = x * Math.PI / 180;
        let y = FUNCS[tk.v](x);
        if (angleDeg && /^(asin|acos|atan)$/.test(tk.v)) y = y * 180 / Math.PI;
        if (!isFinite(y) || isNaN(y)) throw new Error('结果无意义');
        st.push(y);
        return;
      }
      if (tk.v === '/100') { if (!st.length) throw new Error('百分号用法不正确'); st.push(st.pop() / 100); return; }
      if (tk.v === '!') {
        const n = st.pop();
        if (n < 0 || n > 170 || Math.floor(n) !== n) throw new Error('阶乘只支持 0–170 的整数');
        let r = 1;
        for (let i = 2; i <= n; i++) r *= i;
        st.push(r);
        return;
      }
      if (st.length < 2) throw new Error('运算符缺少数字');
      const b = st.pop(), a = st.pop();
      switch (tk.v) {
        case '+': st.push(a + b); break;
        case '-': st.push(a - b); break;
        case '*': st.push(a * b); break;
        case '/':
          if (b === 0) throw new Error('除数不能为 0');
          st.push(a / b); break;
        case '^': st.push(Math.pow(a, b)); break;
        default: throw new Error('未知运算符 ' + tk.v);
      }
    });
    if (st.length !== 1) throw new Error('表达式不完整');
    const v = st[0];
    if (!isFinite(v) || isNaN(v)) throw new Error('结果无意义');
    return v;
  }

  function evaluate(expr, angleDeg) {
    const tokens = tokenize(expr);
    if (!tokens.length) throw new Error('空表达式');
    return evalRpn(toRpn(tokens), angleDeg);
  }

  /* ================================================================== */
  /* 单位换算                                                          */
  /* ================================================================== */
  const UNITS = {
    长度: {
      米: 1, 千米: 1000, 厘米: 0.01, 毫米: 0.001, 英里: 1609.344, 英尺: 0.3048, 英寸: 0.0254, 海里: 1852, 里: 500
    },
    重量: {
      千克: 1, 克: 0.001, 吨: 1000, 斤: 0.5, 两: 0.05, 磅: 0.45359237, 盎司: 0.028349523125
    },
    面积: {
      '平方米': 1, '平方千米': 1e6, '公顷': 1e4, '亩': 666.6666667, '平方英尺': 0.09290304
    },
    体积: {
      升: 1, 毫升: 0.001, '立方米': 1000, '加仑(美)': 3.785411784
    },
    数据: {
      B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776
    },
    时间: {
      秒: 1, 分钟: 60, 小时: 3600, 天: 86400, 周: 604800
    }
  };
  const TEMPS = ['摄氏度', '华氏度', '开尔文'];

  function convertTemp(v, from, to) {
    let c = v;
    if (from === '华氏度') c = (v - 32) * 5 / 9;
    else if (from === '开尔文') c = v - 273.15;
    if (to === '华氏度') return c * 9 / 5 + 32;
    if (to === '开尔文') return c + 273.15;
    return c;
  }

  /* ================================================================== */
  /* 状态                                                              */
  /* ================================================================== */
  let expr = '';
  let angleDeg = true;
  let ans = 0;
  let tab = 'std';           // std | sci | conv
  let history = [];          // [{expr, result}]
  let conv = { cat: '长度', from: '米', to: '千米', value: '1' };

  function fmt(n) {
    if (!isFinite(n)) return '错误';
    if (n === 0) return '0';
    const abs = Math.abs(n);
    if (abs >= 1e12 || abs < 1e-9) return n.toExponential(8).replace(/\.?0+e/, 'e');
    let s = parseFloat(n.toPrecision(13)).toString();
    /* 千分位（仅整数部分较长时） */
    if (Math.abs(n) >= 10000 && s.indexOf('e') < 0) {
      const neg = s[0] === '-';
      const body = neg ? s.slice(1) : s;
      const [ip, fp] = body.split('.');
      const withSep = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      s = (neg ? '-' : '') + withSep + (fp ? '.' + fp : '');
    }
    return s;
  }

  /* ================================================================== */
  /* 视图                                                              */
  /* ================================================================== */
  UI.route('calc', function (view, params) {
    UI.setTitle('计算器', '标准 / 科学 / 换算');
    if (params && params.mode) tab = params.mode;

    const wrap = U.el('div.calc');
    const display = U.el('div.calc-display');
    const exprLine = U.el('div.calc-expr');
    const resultLine = U.el('div.calc-result');
    const previewLine = U.el('div.calc-preview');
    U.append(display, [previewLine, exprLine, resultLine]);

    const tabs = U.el('div.chips.scroll', { style: { margin: '10px 0' } });
    [['std', '标准'], ['sci', '科学'], ['conv', '换算']].forEach(([id, label]) => {
      tabs.appendChild(U.el('button.chip' + (tab === id ? '.active' : ''), {
        text: label,
        onclick: () => { tab = id; UI.render(); }
      }));
    });

    const pad = U.el('div.calc-pad');

    /* ---- 按键处理 ---- */
    function push(s) {
      /* 结果刚算完又输入数字 → 开新算式；输入运算符 → 接着算 */
      if (state.justEvaluated) {
        if (/[0-9.(]/.test(s) || /^[a-z]/.test(s)) expr = '';
        state.justEvaluated = false;
      }
      expr += s;
      refresh();
    }
    function backspace() { expr = expr.slice(0, -1); refresh(); }
    function clearAll() { expr = ''; state.justEvaluated = false; refresh(); }
    function negate() {
      /* 整体取负：包一层括号最直观 */
      if (!expr) { push('-'); return; }
      if (expr[0] === '-' && expr[1] === '(' && expr[expr.length - 1] === ')') expr = expr.slice(2, -1);
      else expr = '-(' + expr + ')';
      refresh();
    }
    function equals() {
      if (!expr) return;
      let v;
      try { v = evaluate(expr, angleDeg); }
      catch (e) { state.error = e.message; refresh(); return; }
      ans = v;
      const shown = fmt(v);
      history.unshift({ expr: expr, result: shown });
      if (history.length > 60) history.pop();
      saveHistory();
      state.lastExpr = expr;
      state.lastResult = shown;
      expr = shown.replace(/,/g, '');
      state.justEvaluated = true;
      state.error = '';
      refresh();
      renderHistory();
    }

    const state = { justEvaluated: false, error: '', lastExpr: '', lastResult: '' };

    function refresh() {
      exprLine.textContent = expr || '0';
      if (state.error) {
        previewLine.textContent = '';
        resultLine.textContent = state.error;
        resultLine.classList.add('err');
      } else {
        resultLine.classList.remove('err');
        /* 实时预览：能算出来就淡淡显示 */
        if (expr && !state.justEvaluated) {
          try {
            const v = evaluate(expr, angleDeg);
            previewLine.textContent = '= ' + fmt(v);
          } catch (e) { previewLine.textContent = ''; }
        } else {
          previewLine.textContent = state.lastExpr ? (state.lastExpr + ' =') : '';
        }
        resultLine.textContent = state.justEvaluated ? fmt(parseFloat(expr) || 0) : '';
      }
      if (state.justEvaluated) {
        exprLine.textContent = state.lastExpr;
        resultLine.textContent = state.lastResult;
      }
    }

    function btn(label, onClick, cls) {
      return U.el('button.calc-key' + (cls ? '.' + cls : ''), { text: label, onclick: onClick });
    }
    function row(children) { return U.el('div.calc-row', {}, children); }

    function buildPad() {
      U.clear(pad);
      if (tab === 'conv') { buildConvert(); return; }

      /* 记忆行 */
      const mem = U.el('div.calc-mem');
      [['MC', () => { global.CalcMem && global.CalcMem.set(0); UI.toast('记忆已清除', 'check'); }],
       ['MR', () => { push(String(memGet())); }],
       ['M+', () => { memSet(memGet() + curValue()); UI.toast('已加入记忆', 'check'); }],
       ['M−', () => { memSet(memGet() - curValue()); UI.toast('已从记忆减去', 'check'); }],
       [angleDeg ? 'DEG' : 'RAD', () => { angleDeg = !angleDeg; buildPad(); refresh(); }]
      ].forEach(([label, fn]) => {
        mem.appendChild(U.el('button.calc-mkey', { text: label, onclick: fn }));
      });
      U.append(pad, mem);

      if (tab === 'sci') {
        U.append(pad, row([
          btn('sin', () => push('sin(')), btn('cos', () => push('cos(')), btn('tan', () => push('tan(')), btn('π', () => push('pi'))
        ]));
        U.append(pad, row([
          btn('ln', () => push('ln(')), btn('log', () => push('log(')), btn('√', () => push('sqrt(')), btn('e', () => push('e'))
        ]));
        U.append(pad, row([
          btn('x²', () => push('^2')), btn('xʸ', () => push('^')), btn('n!', () => push('!')), btn('1/x', () => push('^(-1)'))
        ]));
        U.append(pad, row([
          btn('(', () => push('(')), btn(')', () => push(')')), btn('|x|', () => push('abs(')), btn('eˣ', () => push('exp('))
        ]));
      } else {
        U.append(pad, row([
          btn('C', clearAll, 'fn'), btn('⌫', backspace, 'fn'), btn('%', () => push('%'), 'fn'), btn('÷', () => push('/'), 'op')
        ]));
      }

      const grid = [['7', '8', '9', '×'], ['4', '5', '6', '−'], ['1', '2', '3', '+']];
      grid.forEach((r) => {
        U.append(pad, row(r.map((k) => {
          const isOp = '×−+'.indexOf(k) >= 0;
          return btn(k, () => push(isOp ? (k === '×' ? '*' : k === '−' ? '-' : '+') : k), isOp ? 'op' : '');
        })));
      });
      U.append(pad, row([
        btn('±', negate, 'fn'), btn('0', () => push('0')), btn('.', () => push('.')), btn('=', equals, 'eq')
      ]));

      /* 历史 */
      const hWrap = U.el('div.calc-hist');
      U.append(pad, hWrap);
      renderHistory = () => {
        U.clear(hWrap);
        if (!history.length) return;
        U.append(hWrap, [
          U.el('div.calc-hist-head', {}, [
            U.el('span', { text: '历史记录' }),
            U.el('button.calc-mkey', {
              text: '清空',
              onclick: () => { history = []; saveHistory(); renderHistory(); }
            })
          ])
        ]);
        history.slice(0, 20).forEach((h) => {
          hWrap.appendChild(U.el('button.calc-hist-item', {
            onclick: () => { expr = h.result.replace(/,/g, ''); state.justEvaluated = true; state.lastExpr = h.expr; state.lastResult = h.result; refresh(); },
            html: '<span class="he">' + U.escapeHtml(h.expr) + '</span><span class="hr">= ' + U.escapeHtml(h.result) + '</span>'
          }));
        });
      };
      renderHistory();
    }

    let renderHistory = () => {};

    function curValue() {
      if (state.justEvaluated) return parseFloat(expr) || 0;
      try { return evaluate(expr || '0', angleDeg); } catch (e) { return 0; }
    }
    function memGet() { return Store.state.settings.calcMem || 0; }
    function memSet(v) { Store.setSetting('calcMem', v); }

    /* ---- 单位换算 ---- */
    function buildConvert() {
      const cats = Object.keys(UNITS).concat(['温度']);
      const wrap2 = U.el('div.conv');
      U.append(wrap2, U.el('div.chips.scroll', {}, cats.map((c) => U.el('button.chip' + (conv.cat === c ? '.active' : ''), {
        text: c,
        onclick: () => {
          conv.cat = c;
          const list = unitList(c);
          conv.from = list[0];
          conv.to = list[1] || list[0];
          UI.render();
        }
      }))));

      const list = unitList(conv.cat);
      const input = U.el('input.conv-input', {
        type: 'text', inputmode: 'decimal', value: conv.value,
        oninput: () => { conv.value = input.value; update(); }
      });
      const fromSel = U.el('select.conv-sel', {}, list.map((u) => U.el('option', { text: u, value: u, selected: u === conv.from })));
      fromSel.addEventListener('change', () => { conv.from = fromSel.value; update(); });
      const toSel = U.el('select.conv-sel', {}, list.map((u) => U.el('option', { text: u, value: u, selected: u === conv.to })));
      toSel.addEventListener('change', () => { conv.to = toSel.value; update(); });

      const outLine = U.el('div.conv-out');
      function update() {
        const v = parseFloat(conv.value);
        if (isNaN(v)) { outLine.textContent = '请输入数字'; return; }
        let r;
        if (conv.cat === '温度') r = convertTemp(v, conv.from, conv.to);
        else r = v * UNITS[conv.cat][conv.from] / UNITS[conv.cat][conv.to];
        outLine.innerHTML = '<span class="co-num">' + U.escapeHtml(fmt(r)) + '</span> <span class="co-unit">' + U.escapeHtml(conv.to) + '</span>';
      }

      U.append(wrap2, U.el('div.card', { style: { marginTop: '10px' } }, [
        U.el('div.conv-row', {}, [fromSel, input]),
        U.el('div.conv-arrow', { text: '↓' }),
        U.el('div.conv-row', {}, [toSel, outLine])
      ]));
      U.append(wrap2, U.el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '10px', lineHeight: '1.8' }, text: '换算在输入时即时更新；温度支持摄氏度 / 华氏度 / 开尔文。' }));
      update();
      U.append(pad, wrap2);
    }

    function unitList(cat) { return cat === '温度' ? TEMPS.slice() : Object.keys(UNITS[cat]); }

    /* ---- 组装 ---- */
    U.append(wrap, [display, tabs, pad]);
    U.append(view, wrap);

    /* 键盘支持（桌面调试／外接键盘都方便） */
    function onKey(e) {
      if (UI.currentPath().split('/')[0] !== 'calc') return;
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const k = e.key;
      if (/^[0-9.]$/.test(k)) { push(k); e.preventDefault(); }
      else if ('+-*/^()%'.indexOf(k) >= 0) { push(k === '*' ? '*' : k); e.preventDefault(); }
      else if (k === 'Enter' || k === '=') { equals(); e.preventDefault(); }
      else if (k === 'Backspace') { backspace(); e.preventDefault(); }
      else if (k === 'Escape') { clearAll(); e.preventDefault(); }
    }
    document.addEventListener('keydown', onKey);

    buildPad();
    refresh();

    return function cleanup() { document.removeEventListener('keydown', onKey); };
  });

  /* 历史持久化（放设置里，跟着数据一起备份） */
  function saveHistory() {
    try { Store.setSetting('calcHistory', history.slice(0, 40)); } catch (e) { /* noop */ }
  }
  function loadHistory() {
    try { history = (Store.state.settings.calcHistory || []).slice(); } catch (e) { history = []; }
  }
  loadHistory();

  global.CalcEngine = { evaluate: evaluate, fmt: fmt };
})(window);
