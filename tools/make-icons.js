/* ==========================================================================
   make-icons.js — 纯 Node 生成应用图标（PNG + ICO），不依赖任何外部程序
   --------------------------------------------------------------------------
   为什么要自己栅格化：assets/make-icons.bat 走的是无头 Edge 截图，
   在当前沙箱里会因管道/命名管道限制失败；这里全部自己算。

   支持：rect(含圆角) / circle / path(M L H V C Q Z) / text
         solid 与 linearGradient 填充、fill-opacity、transform、viewBox 缩放

   用法： node tools/make-icons.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const R = { x: 255, y: 255, z: 255, a: 255 };   // 默认颜料（黑）

/* ---------------- 颜色与渐变 ---------------- */
const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', none: null, transparent: null };

function parseColor(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (NAMED[s.toLowerCase()] !== undefined) {
    const hex = NAMED[s.toLowerCase()];
    return hex === null ? null : parseColor(hex);
  }
  if (s[0] === '#') {
    const h = s.slice(1);
    const x = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    if (x.length < 6) return null;
    return {
      r: parseInt(x.slice(0, 2), 16) || 0,
      g: parseInt(x.slice(2, 4), 16) || 0,
      b: parseInt(x.slice(4, 6), 16) || 0,
      a: 255
    };
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    return { r: p[0] | 0, g: p[1] | 0, b: p[2] | 0, a: Math.round((p.length > 3 ? p[3] : 1) * 255) };
  }
  return null;
}

function alphaOf(el) {
  let a = 255;
  if (el['fill-opacity'] != null) a = Math.round(parseFloat(el['fill-opacity']) * a);
  if (el.opacity != null) a = Math.round(parseFloat(el.opacity) * a);
  if (el['stroke-opacity'] != null && el.paintRole === 'stroke') a = Math.round(parseFloat(el['stroke-opacity']) * a);
  return a;
}

/* ---------------- 轻量 XML（够用即可：元素 + 属性 + 自闭合） ---------------- */
function parseXml(src) {
  const clean = src.replace(/<!--[\s\S]*?-->/g, '');
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(clean))) {
    const closing = m[1] === '/';
    const tag = m[2];
    const attrText = m[3] || '';
    const selfClose = m[4] === '/';
    if (closing) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    const aRe = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let am;
    while ((am = aRe.exec(attrText))) attrs[am[1]] = am[3] !== undefined ? am[3] : am[4];
    const node = { tag: tag.toLowerCase(), attrs: attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

function allByTag(node, tag, out) {
  out = out || [];
  (node.children || []).forEach((c) => {
    if (c.tag === tag) out.push(c);
    allByTag(c, tag, out);
  });
  return out;
}
function firstByTag(node, tag) {
  return allByTag(node, tag)[0] || null;
}

/* ---------------- 数值与 transform ---------------- */
function nums(str) {
  const m = String(str == null ? '' : str).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  return m ? m.map(Number) : [];
}

function mul(a, b) {                              // a ∘ b（先 b 后 a）
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
  ];
}
const IDENT = [1, 0, 0, 1, 0, 0];
function apply(m, p) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
function applyPoly(m, pts) {
  return pts.map((p) => apply(m, p));
}
function translate(x, y) { return [1, 0, 0, 1, x, y]; }
function scaleM(sx, sy) { return [sx, 0, 0, sy, 0, 0]; }

function parseTransform(str) {
  let m = IDENT.slice();
  if (!str) return m;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let g;
  while ((g = re.exec(str))) {
    const fn = g[1].toLowerCase();
    const v = nums(g[2]);
    let t = null;
    if (fn === 'translate') t = translate(v[0] || 0, v[1] || 0);
    else if (fn === 'scale') t = scaleM(v[0] === undefined ? 1 : v[0], v[1] === undefined ? (v[0] === undefined ? 1 : v[0]) : v[1]);
    else if (fn === 'matrix' && v.length >= 6) t = v.slice(0, 6);
    if (t) m = mul(m, t);
  }
  return m;
}

/* ---------------- 路径解析（M L H V C Q Z，绝对/相对） ---------------- */
function parsePath(d) {
  const out = [];
  const re = /([MmLlHhVvCcQqZz])([^MmLlHhVvCcQqZz]*)/g;
  let g;
  let cur = null;
  let cx = 0, cy = 0;
  let started = false;
  while ((g = re.exec(d))) {
    const cmd = g[1];
    const v = nums(g[2]);
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    const isMove = up === 'M';
    /* H/V 只带 1 个数字，不能按 2 个配对（此前 per=2 会把 floor(1/2)=0 整条命令丢掉） */
    const per = up === 'H' || up === 'V' ? 1 : (isMove || up === 'L' ? 2 : (up === 'C' ? 6 : (up === 'Q' ? 4 : 0)));
    if (up === 'Z') {
      if (cur) cur.closed = true;
      continue;
    }
    const count = per ? Math.floor(v.length / per) : 0;
    for (let i = 0; i < count; i++) {
      const s = i * per;
      let pts;
      /* 相对 moveto 的后续坐标对按规范要当作 lineto 处理 */
      if (up === 'M' && i > 0) {
        const x = v[s] + (rel ? cx : 0), y = v[s + 1] + (rel ? cy : 0);
        if (!cur) { cur = { pts: [], closed: false }; out.push(cur); }
        cur.pts.push({ x: x, y: y });
        cx = x; cy = y;
        continue;
      }
      if (up === 'M') {
        const x = v[s] + (rel ? cx : 0), y = v[s + 1] + (rel ? cy : 0);
        cur = { pts: [{ x: x, y: y }], closed: false };
        out.push(cur);
        cx = x; cy = y;
        started = true;
      } else if (up === 'L') {
        const x = v[s] + (rel ? cx : 0), y = v[s + 1] + (rel ? cy : 0);
        if (!started) { cur = { pts: [], closed: false }; out.push(cur); started = true; }
        cur.pts.push({ x: x, y: y });
        cx = x; cy = y;
      } else if (up === 'H') {
        const x = v[s] + (rel ? cx : 0);
        if (!cur) continue;
        cur.pts.push({ x: x, y: cy });
        cx = x;
      } else if (up === 'V') {
        const y = v[s] + (rel ? cy : 0);
        if (!cur) continue;
        cur.pts.push({ x: cx, y: y });
        cy = y;
      } else if (up === 'C') {
        const x1 = v[s] + (rel ? cx : 0), y1 = v[s + 1] + (rel ? cy : 0);
        const x2 = v[s + 2] + (rel ? cx : 0), y2 = v[s + 3] + (rel ? cy : 0);
        const x = v[s + 4] + (rel ? cx : 0), y = v[s + 5] + (rel ? cy : 0);
        if (!cur) continue;
        const steps = 24;
        for (let k = 1; k <= steps; k++) {
          const t = k / steps, u = 1 - t;
          cur.pts.push({
            x: u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
            y: u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y
          });
        }
        cx = x; cy = y;
      } else if (up === 'Q') {
        const x1 = v[s] + (rel ? cx : 0), y1 = v[s + 1] + (rel ? cy : 0);
        const x = v[s + 2] + (rel ? cx : 0), y = v[s + 3] + (rel ? cy : 0);
        if (!cur) continue;
        const steps = 20;
        for (let k = 1; k <= steps; k++) {
          const t = k / steps, u = 1 - t;
          cur.pts.push({
            x: u * u * cx + 2 * u * t * x1 + t * t * x,
            y: u * u * cy + 2 * u * t * y1 + t * t * y
          });
        }
        cx = x; cy = y;
      }
    }
  }
  return out.filter((s) => s.pts.length > 1);
}

/* ---------------- 描边 → 轮廓多边形（斜接 + 圆头，永远非空填充） ---------------- */
function circlePts(cx, cy, r, n) {
  const out = [];
  const steps = n || 32;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

function strokeOutline(pts, width, closed) {
  const hw = width / 2;
  const p = pts.slice();
  if (closed && p.length > 2) p.push(p[0]);
  if (p.length < 2) {
    return hw > 0 ? [circlePts(p[0].x, p[0].y, hw, 32)] : [];
  }
  const left = [], right = [];
  const segs = [];
  for (let i = 0; i < p.length - 1; i++) {
    const dx = p[i + 1].x - p[i].x;
    const dy = p[i + 1].y - p[i].y;
    const len = Math.hypot(dx, dy) || 1e-6;
    segs.push({ tx: dx / len, ty: dy / len, nx: -dy / len, ny: dx / len });  // n = 左法线
  }
  const cap = 12;                                  // 斜接超出上限时退回平头
  for (let i = 0; i < p.length; i++) {
    const s0 = segs[Math.max(0, i - 1)];
    const s1 = segs[Math.min(segs.length - 1, i)];
    const ax = s0.nx, ay = s0.ny, bx = s1.nx, by = s1.ny;
    const cross = ax * by - ay * bx;
    const len = Math.hypot(ax + bx, ay + by) || 1e-6;
    let mx = (ax + bx) / len, my = (ay + by) / len;
    if (Math.abs(cross) < 1e-6) { mx = bx; my = by; }
    const cosHalf = mx * bx + my * by;
    let ratio = cosHalf > 1e-3 ? 1 / cosHalf : cap;
    if (!(ratio > 0) || ratio > cap) ratio = 1;    // 夹角过尖 → 平头
    left.push({ x: p[i].x + mx * hw * ratio, y: p[i].y + my * hw * ratio });
    right.push({ x: p[i].x - mx * hw * ratio, y: p[i].y - my * hw * ratio });
  }
  /* 关键：左右两条偏移链必须合围成一个闭合轮廓（只给单侧会退化成一条线，
     填充器会把它当无效多边形丢掉，只剩下圆头）。 */
  const polys = [left.concat(right.slice().reverse())];
  /* 圆角接头 + 圆头端点：都用小圆补，宁多勿缺 */
  const capPts = hw > 0.5 ? 20 : 12;
  p.forEach((q) => polys.push(circlePts(q.x, q.y, hw, capPts)));
  return polys;
}

/* ---------------- 扫描线填充（4× 超采样，返回覆盖度掩膜） ---------------- */
const SS = 4;

function fillPolys(polys, W, H, bbox) {
  const cov = new Float32Array(W * H);
  if (!polys || !polys.length || !bbox) return cov;
  const x0 = Math.max(0, bbox.x0), x1 = Math.min(W, bbox.x1);
  const y0 = Math.max(0, bbox.y0), y1 = Math.min(H, bbox.y1);
  if (x1 <= x0 || y1 <= y0) return cov;
  const X = Math.round(x0 * SS), Y = Math.round(y0 * SS);
  const Wp = Math.ceil((x1 - x0) * SS) + 1, Hp = Math.ceil((y1 - y0) * SS) + 1;
  if (Wp <= 0 || Hp <= 0 || Wp * Hp > 40e6) return cov;
  const acc = new Float32Array(Wp * Hp);

  for (let poly of polys) {
    if (poly.length < 3) continue;
    const P2 = poly.map((q) => ({ x: q.x * SS - X, y: q.y * SS - Y }));
    let miny = Infinity, maxy = -Infinity;
    for (const q of P2) { if (q.y < miny) miny = q.y; if (q.y > maxy) maxy = q.y; }
    const yA = Math.max(0, Math.floor(miny)), yB = Math.min(Hp - 1, Math.ceil(maxy));
    const n = P2.length;
    for (let y = yA; y <= yB; y++) {
      const cy = y + 0.5;
      const xs = [];
      for (let i = 0; i < n; i++) {
        const a = P2[i], b = P2[(i + 1) % n];
        /* 水平边不参与求交（否则「正上方/正下方」的边永远匹配不上，
           一条水平线段会一个像素都填不出来）；其余边用半开区间，顶点只算一次。 */
        if (a.y === b.y) continue;
        if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) {
          xs.push(a.x + (cy - a.y) / (b.y - a.y) * (b.x - a.x));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      /* 交叉点必须成对使用：顶点恰好落在扫描线上时可能出现奇数个，
         若把落单的那个当成区间右端，区间会反向、整条线一个像素都填不上。 */
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(Wp - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) acc[y * Wp + x] += 1;
      }
    }
  }
  const inv = 1 / (SS * SS);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let s = 0;
      const bx0 = Math.round(px * SS) - X, by0 = Math.round(py * SS) - Y;
      for (let sy = 0; sy < SS; sy++) {
        const ry = by0 + sy;
        if (ry < 0 || ry >= Hp) continue;
        const row = ry * Wp;
        for (let sx = 0; sx < SS; sx++) {
          const rx = bx0 + sx;
          if (rx >= 0 && rx < Wp && acc[row + rx] > 0) s++;
        }
      }
      if (s > 0) cov[py * W + px] = Math.min(1, s * inv);
    }
  }
  return cov;
}

function bboxOfPolys(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  polys.forEach((poly) => poly.forEach((p) => {
    if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
  }));
  if (x0 === Infinity) return null;
  return { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 };
}

/* ---------------- 渐变取样 ---------------- */
function gradSampler(grad, bbox) {
  const x1 = grad.x1, y1 = grad.y1, x2 = grad.x2, y2 = grad.y2;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1e-6;
  const stops = grad.stops.slice().sort((a, b) => a.offset - b.offset);
  return function (x, y) {
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1].offset) i++;
    const s0 = stops[i], s1 = stops[Math.min(stops.length - 1, i + 1)];
    const span = (s1.offset - s0.offset) || 1;
    const k = Math.max(0, Math.min(1, (t - s0.offset) / span));
    const op = (s0.op + (s1.op - s0.op) * k);
    return {
      r: s0.r + (s1.r - s0.r) * k,
      g: s0.g + (s1.g - s0.g) * k,
      b: s0.b + (s1.b - s0.b) * k,
      a: Math.round(255 * op)
    };
  };
}

function gradPoints(grad, attrs, bbox) {
  const units = (grad.attrs.gradientUnits || 'objectBoundingBox');
  const m = (v, axis) => {                       // 把 0..1 的坐标映射到对象包围盒
    if (units === 'userSpaceOnUse') return v;
    return axis === 'x' ? bbox.x0 + v * (bbox.x1 - bbox.x0) : bbox.y0 + v * (bbox.y1 - bbox.y0);
  };
  const gx1 = attrs.x1 != null ? parseFloat(attrs.x1) : 0;
  const gy1 = attrs.y1 != null ? parseFloat(attrs.y1) : 0;
  const gx2 = attrs.x2 != null ? parseFloat(attrs.x2) : 1;
  const gy2 = attrs.y2 != null ? parseFloat(attrs.y2) : 0;
  return { x1: m(gx1, 'x'), y1: m(gy1, 'y'), x2: m(gx2, 'x'), y2: m(gy2, 'y') };
}

/* ---------------- 主渲染 ---------------- */
function renderSvg(src, W, H) {
  const root = parseXml(src);
  const svg = firstByTag(root, 'svg');
  if (!svg) throw new Error('找不到 <svg> 根元素');
  const vb = nums(svg.attrs.viewBox);
  const vx = vb.length === 4 ? vb[0] : 0, vy = vb.length === 4 ? vb[1] : 0;
  const vw = vb.length === 4 ? vb[2] : parseFloat(svg.attrs.width) || W;
  const vh = vb.length === 4 ? vb[3] : parseFloat(svg.attrs.height) || H;
  const sx = W / vw, sy = H / vh;

  /* 渐变定义 */
  const grads = {};
  allByTag(root, 'lineargradient').forEach((g) => {
    grads[g.attrs.id] = {
      attrs: g.attrs,
      stops: allByTag(g, 'stop').map((st) => {
        const c = parseColor(st.attrs['stop-color']) || { r: 0, g: 0, b: 0, a: 255 };
        const op = st.attrs['stop-opacity'] != null ? parseFloat(st.attrs['stop-opacity']) : 1;
        return { offset: parseFloat(st.attrs.offset || 0), r: c.r, g: c.g, b: c.b, op: op };
      })
    };
  });

  const out = new Uint8ClampedArray(W * H * 4);
  const base = mul(scaleM(sx, sy), translate(-vx, -vy));

  function paintOf(attrs, role, bbox) {
    const raw = role === 'stroke' ? attrs.stroke : attrs.fill;
    if (raw == null || raw === 'none') return null;
    const m = String(raw).match(/url\(\s*#([^)\s]+)\s*\)/);
    if (m && grads[m[1]]) {
      const g = grads[m[1]];
      const pts = gradPoints(g, g.attrs, bbox || { x0: 0, y0: 0, x1: 1, y1: 1 });
      return { sample: gradSampler({ stops: g.stops, x1: pts.x1, y1: pts.y1, x2: pts.x2, y2: pts.y2 }, bbox) };
    }
    const c = parseColor(raw);
    if (!c) return null;
    const a = role === 'stroke'
      ? (attrs['stroke-opacity'] != null ? parseFloat(attrs['stroke-opacity']) : 1)
      : (attrs['fill-opacity'] != null ? parseFloat(attrs['fill-opacity']) : 1);
    return { solid: { r: c.r, g: c.g, b: c.b, a: Math.round(255 * a * (c.a / 255)) } };
  }

  function composite(polys, paint, extraAlpha) {
    if (!paint || !polys.length) return;
    const bbox = bboxOfPolys(polys);
    const cov = fillPolys(polys, W, H, bbox);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = cov[y * W + x];
        if (c <= 0) continue;
        const col = paint.solid || paint.sample(x + 0.5, y + 0.5);
        const a = c * (col.a / 255) * extraAlpha;
        if (a <= 0) continue;
        const i = (y * W + x) * 4;
        out[i] = out[i] * (1 - a) + col.r * a;
        out[i + 1] = out[i + 1] * (1 - a) + col.g * a;
        out[i + 2] = out[i + 2] * (1 - a) + col.b * a;
        out[i + 3] = Math.min(255, out[i + 3] + a * 255);
      }
    }
  }

  function walk(node, ctm, inherited) {
    (node.children || []).forEach((el) => {
      if (el.tag === 'defs' || el.tag === 'lineargradient' || el.tag === 'stop' || el.tag === 'title') return;
      const m = mul(ctm, parseTransform(el.attrs.transform));
      const attrs = el.attrs;
      const alpha = attrs.opacity != null ? parseFloat(attrs.opacity) : 1;
      const swUser = attrs['stroke-width'] != null ? parseFloat(attrs['stroke-width']) : (inherited.sw || 1);
      /* 线宽处在用户坐标系里，点已经乘过 m：必须把线宽也按 m 的缩放换算，
         否则小尺寸下笔宽会被放大（曾把 28 单位画成 28 像素，整张图糊成白色）。 */
      const swScale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      const sw = swUser * swScale;
      const hasStroke = attrs.stroke && attrs.stroke !== 'none';

      let polys = [];
      if (el.tag === 'rect') {
        const x = parseFloat(attrs.x || 0), y = parseFloat(attrs.y || 0);
        const w = parseFloat(attrs.width || 0), h = parseFloat(attrs.height || 0);
        const rx = Math.min(parseFloat(attrs.rx || 0) || 0, w / 2);
        const corners = 16;
        const pts = [];
        const arc = (cx2, cy2, a0) => {
          for (let i = 0; i <= corners; i++) {
            const a = a0 + (i / corners) * (Math.PI / 2);
            pts.push({ x: cx2 + Math.cos(a) * rx, y: cy2 + Math.sin(a) * rx });
          }
        };
        if (rx > 0.01) {
          arc(x + w - rx, y + h - rx, 0);
          arc(x + rx, y + h - rx, Math.PI / 2);
          arc(x + rx, y + rx, Math.PI);
          arc(x + w - rx, y + rx, Math.PI * 1.5);
        } else {
          pts.push({ x: x, y: y }, { x: x + w, y: y }, { x: x + w, y: y + h }, { x: x, y: y + h });
        }
        polys = [applyPoly(m, pts)];
      } else if (el.tag === 'circle' || el.tag === 'ellipse') {
        const cx = parseFloat(attrs.cx || 0), cy = parseFloat(attrs.cy || 0);
        const rx = parseFloat(attrs.r != null ? attrs.r : (attrs.rx || 0));
        const ry = parseFloat(attrs.r != null ? attrs.r : (attrs.ry || 0));
        const steps = 64;
        const pts = [];
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
        }
        polys = [applyPoly(m, pts)];
      } else if (el.tag === 'path') {
        const subs = parsePath(attrs.d || '');
        subs.forEach((sub) => {
          const pts = applyPoly(m, sub.pts);
          if (attrs.fill && attrs.fill !== 'none') {
            const bb = bboxOfPolys([pts]);
            const fp = paintOf(attrs, 'fill', bb);
            if (fp) composite([pts], fp, alpha);
          }
          if (hasStroke) {
            const outline = strokeOutline(pts, sw, sub.closed);
            const bb = bboxOfPolys(outline);
            const sp = paintOf(attrs, 'stroke', bb);
            if (sp) composite(outline, sp, alpha);
          }
        });
        walk(el, m, { sw: sw });
        return;
      } else if (el.tag === 'text') {
        const txt = (el.children || []).filter((c) => c.tag === 'text' || c.tag === '#text');
        const content = (el.attrs['data-text'] || textContentOf(el) || '').trim();
        if (content) {
          const fs = parseFloat(attrs['font-size'] || 16);
          const fam = attrs['font-family'] || 'Microsoft YaHei, Segoe UI, Arial';
          const anchor = attrs['text-anchor'] || 'start';
          const cx = parseFloat(attrs.x || 0), cy = parseFloat(attrs.y || 0);
          const bb = { x0: cx - fs * 3, y0: cy - fs, x1: cx + fs * 3, y1: cy + fs };
          const fp = paintOf(attrs, 'fill', bb) || { solid: R };
          const mask = textMask(content, fam, fs, W, H, ctm, cx, cy, anchor);
          compositeTextMask(mask, fp, alpha);
        }
      } else if (el.tag === 'g' || el.tag === 'svg') {
        walk(el, m, { sw: sw });
        return;
      }

      if (polys.length) {
        const bb = bboxOfPolys(polys);
        if (attrs.fill !== 'none') {
          const fp = paintOf(attrs, 'fill', bb);
          if (fp) composite(polys, fp, alpha);
        }
        if (hasStroke) {
          const outline = polys.reduce((acc, poly) => acc.concat(strokeOutline(poly, sw, true)), []);
          const sp = paintOf(attrs, 'stroke', bboxOfPolys(outline));
          if (sp) composite(outline, sp, alpha);
        }
      }
    });
  }

  function textContentOf(el) {
    let s = '';
    (function rec(n) {
      (n.children || []).forEach((c) => {
        if (c.tag === '#text' || !c.children.length) s += (c.text || '');
        else rec(c);
      });
    })(el);
    return s;
  }

  walk(root, base, { sw: 1 });
  return { data: out, width: W, height: H };
}

/* ---------------- PNG 编解码 ---------------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(img) {
  const w = img.width, h = img.height;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = y * (stride + 1) + 1 + x * 4;
      raw[d] = img.data[s]; raw[d + 1] = img.data[s + 1];
      raw[d + 2] = img.data[s + 2]; raw[d + 3] = img.data[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('仅支持 8 位深 PNG');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c2 = x >= ch ? prev[x - ch] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c2, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c2);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c2)) & 255;
      }
    }
    prev = line;
    for (let x = 0; x < width; x++) {
      const s = x * ch, d = (y * width + x) * 4;
      out[d] = line[s]; out[d + 1] = ch > 2 ? line[s + 1] : line[s]; out[d + 2] = ch > 2 ? line[s + 2] : line[s];
      out[d + 3] = ch === 4 ? line[s + 3] : 255;
    }
  }
  return { width: width, height: height, data: out };
}

/* 面积平均缩放（带 alpha 加权的颜色还原） */
function resize(img, nw, nh) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(nw * nh * 4);
  const sx = w / nw, sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, aw = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < h; yy++) {
        for (let xx = x0; xx < x1 && xx < w; xx++) {
          const i = (yy * w + xx) * 4, al = data[i + 3] / 255;
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al;
          aw += al; n++;
        }
      }
      const o = (y * nw + x) * 4;
      out[o] = aw > 0 ? Math.round(r / aw) : 0;
      out[o + 1] = aw > 0 ? Math.round(g / aw) : 0;
      out[o + 2] = aw > 0 ? Math.round(b / aw) : 0;
      out[o + 3] = n ? Math.round((aw / n) * 255) : 0;
    }
  }
  return { width: nw, height: nh, data: out };
}

/* ---------------- ICO 打包 ---------------- */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const dir = [], blobs = [];
  images.forEach(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    dir.push(e); blobs.push(png);
  });
  return Buffer.concat([header].concat(dir, blobs));
}

/* ---------------- 主流程 ---------------- */
function main() {
  const assets = path.join(ROOT, 'assets');
  const jobs = [
    { svg: path.join(assets, 'icon.svg'), sizes: [512, 256, 192, 128, 64, 48, 32, 24, 16] },
    { svg: path.join(assets, 'icon-maskable.svg'), sizes: [512, 192] }
  ];
  const icoImages = [];
  jobs.forEach((job, ji) => {
    const src = fs.readFileSync(job.svg, 'utf8');
    job.sizes.forEach((size) => {
      const img = renderSvg(src, size, size);
      const png = encodePng(img);
      if (process.env.SW_ICON_VERBOSE) {
        let w = 0, r = 0, t = 0;
        for (let i = 0; i < img.data.length; i += 4) {
          if (img.data[i + 3] < 128) { t++; continue; }
          if (img.data[i] > 200 && img.data[i + 1] > 200 && img.data[i + 2] > 200) w++; else r++;
        }
        console.log('    ' + size + 'px: 白=' + w + ' 红=' + r + ' 透明=' + t);
      }
      const name = ji === 0
        ? (size === 512 ? 'icon-512.png' : 'icon-' + size + '.png')
        : (size === 512 ? 'icon-maskable-512.png' : 'icon-maskable-' + size + '.png');
      fs.writeFileSync(path.join(assets, name), png);
      if (ji === 0 && [16, 24, 32, 48, 64, 128, 256].indexOf(size) >= 0) icoImages.push({ size: size, png: png });
    });
  });
  icoImages.sort((a, b) => a.size - b.size);
  const ico = buildIco(icoImages);
  fs.writeFileSync(path.join(assets, 'icon.ico'), ico);
  console.log('已生成 PNG: ' + jobs.map((j) => j.sizes.length).reduce((a, b) => a + b, 0) + ' 个');
  console.log('ICO: ' + path.join(assets, 'icon.ico') + '  (' + ico.length + ' 字节, ' + icoImages.map((i) => i.size).join('/') + ')');
}

if (require.main === module) main();
module.exports = { renderSvg: renderSvg, encodePng: encodePng, decodePng: decodePng, resize: resize, buildIco: buildIco, parsePath: parsePath };
