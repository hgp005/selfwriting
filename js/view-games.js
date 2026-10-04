/* ==========================================================================
   selfwriting · view-games.js
   休闲小游戏：俄罗斯方块 + 贪吃蛇
   设计要点：
     · 键盘（电脑）与触摸（手机）都能玩 —— 触屏是滑动 + 屏上按键双通道
     · 最高分记在本机设置里，跟着数据一起备份
     · 切页自动暂停，不会在后台空转耗电
     · 画布尺寸按可用宽度自适应，格子取整避免模糊
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const Store = global.Store;
  const UI = global.UI;

  /* ================================================================== */
  /* 高分                                                              */
  /* ================================================================== */
  function bestGet(key) {
    const b = (Store.state.settings.gameBest || {});
    return b[key] || 0;
  }
  function bestSet(key, v) {
    const b = Object.assign({}, Store.state.settings.gameBest || {});
    if (v > (b[key] || 0)) {
      b[key] = v;
      Store.setSetting('gameBest', b);
      return true;      // 刷新了纪录
    }
    return false;
  }

  /* ================================================================== */
  /* 通用画布骨架                                                      */
  /* ================================================================== */
  /**
   * 建一个游戏外壳：返回 { wrap, canvas, ctx, setStatus, setButtons, onKey, loop }
   * 自动处理 DPR、尺寸自适应、页面切换暂停、键盘绑定与清理。
   */
  function makeShell(cfg) {
    const wrap = U.el('div.arcade');
    const canvas = U.el('canvas.arcade-canvas');
    const status = U.el('div.arcade-status');
    const bar = U.el('div.arcade-bar');
    const msg = U.el('div.arcade-msg');

    U.append(wrap, [status, U.el('div.arcade-stage', {}, [canvas, msg]), bar]);

    const ctx = canvas.getContext('2d');
    let cw = 300, ch = 300;

    function fit() {
      const avail = Math.max(220, Math.min(400, (wrap.clientWidth || 320) - 4));
      const ratio = cfg.hRatio || 1;
      cw = Math.round(avail);
      ch = Math.round(avail * ratio);
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const repaint = () => { if (cfg.onResize) cfg.onResize(); };
    let rt = null;
    const onWinResize = () => { clearTimeout(rt); rt = setTimeout(() => { fit(); repaint(); }, 150); };
    global.addEventListener('resize', onWinResize);

    function onKey(e) {
      if (UI.currentPath().split('/')[0] !== 'games') return;
      const handled = cfg.onKey && cfg.onKey(e);
      if (handled) e.preventDefault();
    }
    document.addEventListener('keydown', onKey);

    function onVis() { if (document.hidden && cfg.onPause) cfg.onPause(); }
    document.addEventListener('visibilitychange', onVis);

    function destroy() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
      global.removeEventListener('resize', onWinResize);
      clearTimeout(rt);
      if (cfg.onDestroy) cfg.onDestroy();
    }

    fit();

    return {
      wrap: wrap, canvas: canvas, ctx: ctx, bar: bar, msg: msg,
      fit: fit,
      size: () => ({ w: cw, h: ch }),
      setStatus: (nodes) => { U.clear(status); U.append(status, nodes); },
      setBar: (nodes) => { U.clear(bar); U.append(bar, nodes); },
      setMsg: (text) => {
        msg.textContent = text || '';
        msg.classList.toggle('hidden', !text);
      },
      destroy: destroy
    };
  }

  /** 屏上方向键（手机操控） */
  function dpad(onDir, opt) {
    const o = opt || {};
    const pad = U.el('div.arcade-dpad');
    const mk = (label, dir) => U.el('button.arcade-dbtn', {
      html: label,
      onpointerdown: (e) => { e.preventDefault(); onDir(dir); }
    });
    U.append(pad, [
      U.el('div.arcade-drow', {}, [mk('↑', 'up')]),
      U.el('div.arcade-drow', {}, [mk('←', 'left'), o.center ? U.el('button.arcade-dbtn', { text: o.center.label || '⏸', onpointerdown: (e) => { e.preventDefault(); o.center.fn(); } }) : null, mk('→', 'right')]),
      U.el('div.arcade-drow', {}, [mk('↓', 'down')])
    ]);
    return pad;
  }

  /** 滑动识别（在画布上滑） */
  function swipe(canvas, onDir, onTap) {
    let sx = 0, sy = 0, moved = false;
    canvas.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; moved = false; });
    canvas.addEventListener('pointermove', (e) => {
      if (moved) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
      moved = true;
      if (Math.abs(dx) > Math.abs(dy)) onDir(dx > 0 ? 'right' : 'left');
      else onDir(dy > 0 ? 'down' : 'up');
    });
    canvas.addEventListener('pointerup', () => { if (!moved && onTap) onTap(); });
  }

  /* ================================================================== */
  /* 贪吃蛇                                                            */
  /* ================================================================== */
  function snakeGame(shell) {
    const COLS = 15, ROWS = 15;
    const ctx = shell.ctx;
    let snake, dir, nextDir, food, score, alive, timer, speed, paused, over;

    function reset() {
      snake = [{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 5, y: 7 }];
      dir = { x: 1, y: 0 };
      nextDir = { x: 1, y: 0 };
      score = 0;
      alive = true;
      over = false;
      paused = false;
      speed = 150;
      placeFood();
      shell.setMsg('');
      paint();
    }

    function placeFood() {
      let guard = 0;
      do {
        food = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
        guard++;
      } while (guard < 500 && snake.some((s) => s.x === food.x && s.y === food.y));
    }

    function step() {
      if (paused || over || !alive) return;
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS ||
          snake.some((s, i) => i < snake.length - 1 && s.x === head.x && s.y === head.y)) {
        alive = false;
        over = true;
        const isBest = bestSet('snake', score);
        shell.setMsg(isBest ? '新纪录！' + score + ' 分 —— 点屏幕重来' : '游戏结束 · ' + score + ' 分 —— 点屏幕重来');
        clearInterval(timer); timer = null;
        snakeStatus();
        paint();
        return;
      }
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score += 10;
        placeFood();
        /* 每 50 分提速一点，最快 70ms */
        const ns = Math.max(70, 150 - Math.floor(score / 50) * 10);
        if (ns !== speed) { speed = ns; restartTimer(); }
      } else {
        snake.pop();
      }
      snakeStatus();
      paint();
    }

    function restartTimer() {
      if (timer) clearInterval(timer);
      timer = setInterval(step, speed);
    }

    function dirInput(d) {
      if (over) { reset(); restartTimer(); return; }
      const map = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
      const nd = map[d];
      if (!nd) return;
      /* 不能 180° 掉头 */
      if (nd.x === -dir.x && nd.y === -dir.y) return;
      nextDir = nd;
    }

    function paint() {
      const { w, h } = shell.size();
      const cell = Math.floor(Math.min(w / COLS, h / ROWS));
      const ox = Math.floor((w - cell * COLS) / 2);
      const oy = Math.floor((h - cell * ROWS) / 2);
      const cs = getComputedStyle(document.documentElement);
      const bg = cs.getPropertyValue('--bg-sunken').trim() || '#eee';
      const line = cs.getPropertyValue('--line').trim() || '#ddd';
      const accent = cs.getPropertyValue('--accent').trim() || '#b4503c';
      const text = cs.getPropertyValue('--text').trim() || '#222';

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      /* 棋盘格，便于看清格子 */
      ctx.fillStyle = line;
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if ((x + y) % 2 === 0) ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
        }
      }
      /* 食物 */
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(ox + food.x * cell + cell / 2, oy + food.y * cell + cell / 2, cell * 0.32, 0, Math.PI * 2);
      ctx.fill();
      /* 蛇 */
      snake.forEach((s, i) => {
        ctx.fillStyle = i === 0 ? accent : text;
        ctx.globalAlpha = i === 0 ? 1 : Math.max(0.35, 1 - i * 0.03);
        const pad = Math.max(1, Math.floor(cell * 0.08));
        ctx.fillRect(ox + s.x * cell + pad, oy + s.y * cell + pad, cell - pad * 2, cell - pad * 2);
      });
      ctx.globalAlpha = 1;
    }

    function snakeStatus() {
      shell.setStatus([
        U.el('div.arcade-score', {}, [U.el('span', { text: '分数' }), U.el('b', { text: String(score) })]),
        U.el('div.arcade-score', {}, [U.el('span', { text: '最高' }), U.el('b', { text: String(bestGet('snake')) })]),
        U.el('div.arcade-score', {}, [U.el('span', { text: '长度' }), U.el('b', { text: String(snake.length) })])
      ]);
    }

    shell.setBar([
      dpad(dirInput, { center: { label: '⏸', fn: toggle } }),
      U.el('div.arcade-side', {}, [
        U.el('button.btn', { onclick: () => { reset(); restartTimer(); } }, [U.icon('refresh', 'ico-sm'), U.el('span', { text: '重开' })]),
        U.el('button.btn', { onclick: toggle }, [U.el('span', { text: '暂停 / 继续' })])
      ])
    ]);

    function toggle() {
      if (over) { reset(); restartTimer(); return; }
      paused = !paused;
      shell.setMsg(paused ? '已暂停 · 点画面继续' : '');
      paint();
    }

    reset();
    restartTimer();
    snakeStatus();
    swipe(shell.canvas, dirInput, () => { if (over) { reset(); restartTimer(); } else toggle(); });

    return {
      key(e) {
        const k = e.key;
        if (k === 'ArrowUp' || k === 'w') { dirInput('up'); return true; }
        if (k === 'ArrowDown' || k === 's') { dirInput('down'); return true; }
        if (k === 'ArrowLeft' || k === 'a') { dirInput('left'); return true; }
        if (k === 'ArrowRight' || k === 'd') { dirInput('right'); return true; }
        if (k === ' ') { toggle(); return true; }
        return false;
      },
      pause() { if (!paused && !over) { paused = true; shell.setMsg('已暂停 · 点画面继续'); } },
      repaint() { paint(); },
      stop() { if (timer) clearInterval(timer); }
    };
  }

  /* ================================================================== */
  /* 俄罗斯方块                                                        */
  /* ================================================================== */
  const SHAPES = {
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]]
  };
  const COLORS = { I: '#4aa3d8', O: '#d8b64a', T: '#a86fd0', S: '#4ab87a', Z: '#d85f5f', J: '#4a6fd8', L: '#d8874a' };

  function rotate(m) {
    const h = m.length, w = m[0].length;
    const out = [];
    for (let x = 0; x < w; x++) {
      const row = [];
      for (let y = h - 1; y >= 0; y--) row.push(m[y][x]);
      out.push(row);
    }
    return out;
  }

  function tetrisGame(shell) {
    const COLS = 10, ROWS = 20;
    const ctx = shell.ctx;
    let board, piece, nextKey, score, lines, level, over, paused, timer, dropMs;

    function emptyBoard() {
      const b = [];
      for (let y = 0; y < ROWS; y++) b.push(new Array(COLS).fill(null));
      return b;
    }

    function pickPiece() {
      const keys = Object.keys(SHAPES);
      const key = keys[Math.floor(Math.random() * keys.length)];
      return { key: key, m: SHAPES[key].map((r) => r.slice()), x: Math.floor((COLS - SHAPES[key][0].length) / 2), y: 0 };
    }

    function fits(m, px, py) {
      for (let y = 0; y < m.length; y++) {
        for (let x = 0; x < m[y].length; x++) {
          if (!m[y][x]) continue;
          const bx = px + x, by = py + y;
          if (bx < 0 || bx >= COLS || by >= ROWS) return false;
          if (by >= 0 && board[by][bx]) return false;
        }
      }
      return true;
    }

    function spawn() {
      piece = pickPiece();
      nextKey = null;
      if (!fits(piece.m, piece.x, piece.y)) {
        over = true;
        const isBest = bestSet('tetris', score);
        shell.setMsg(isBest ? '新纪录！' + score + ' 分' : '游戏结束 · ' + score + ' 分');
        if (timer) clearInterval(timer);
        timer = null;
      }
    }

    function reset() {
      board = emptyBoard();
      score = 0; lines = 0; level = 1; over = false; paused = false;
      dropMs = 800;
      shell.setMsg('');
      spawn();
      restartTimer();
      refresh();
      paint();
    }

    function restartTimer() {
      if (timer) clearInterval(timer);
      timer = setInterval(() => step(), dropMs);
    }

    function step() {
      if (paused || over) return;
      if (fits(piece.m, piece.x, piece.y + 1)) { piece.y++; paint(); return; }
      lock();
    }

    function lock() {
      piece.m.forEach((row, y) => row.forEach((v, x) => {
        if (v) {
          const by = piece.y + y, bx = piece.x + x;
          if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) board[by][bx] = piece.key;
        }
      }));
      /* 消行 */
      let cleared = 0;
      for (let y = ROWS - 1; y >= 0; y--) {
        if (board[y].every((c) => c)) {
          board.splice(y, 1);
          board.unshift(new Array(COLS).fill(null));
          cleared++;
          y++;                                   // 同一行要再查一次
        }
      }
      if (cleared) {
        const table = { 1: 100, 2: 300, 3: 600, 4: 1000 };
        score += (table[cleared] || 100) * level;
        lines += cleared;
        const nl = 1 + Math.floor(lines / 10);
        if (nl !== level) {
          level = nl;
          dropMs = Math.max(120, 800 - (level - 1) * 70);
          restartTimer();
        }
      }
      spawn();
      refresh();
      paint();
    }

    function move(dx) {
      if (over || paused) return;
      if (fits(piece.m, piece.x + dx, piece.y)) { piece.x += dx; paint(); }
    }
    function softDrop() {
      if (over || paused) return;
      if (fits(piece.m, piece.x, piece.y + 1)) { piece.y++; score += 1; refresh(); paint(); }
      else lock();
    }
    function hardDrop() {
      if (over || paused) return;
      let n = 0;
      while (fits(piece.m, piece.x, piece.y + 1)) { piece.y++; n++; }
      score += n * 2;
      lock();
    }
    function rotatePiece() {
      if (over || paused) return;
      const r = rotate(piece.m);
      /* 墙踢：左右各试一格，再试上移一格 */
      const tries = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];
      for (let i = 0; i < tries.length; i++) {
        const nx = piece.x + tries[i][0], ny = piece.y + tries[i][1];
        if (fits(r, nx, ny)) { piece.m = r; piece.x = nx; piece.y = ny; paint(); return; }
      }
    }

    function refresh() {
      shell.setStatus([
        U.el('div.arcade-score', {}, [U.el('span', { text: '分数' }), U.el('b', { text: String(score) })]),
        U.el('div.arcade-score', {}, [U.el('span', { text: '最高' }), U.el('b', { text: String(bestGet('tetris')) })]),
        U.el('div.arcade-score', {}, [U.el('span', { text: '消行' }), U.el('b', { text: String(lines) })]),
        U.el('div.arcade-score', {}, [U.el('span', { text: '等级' }), U.el('b', { text: String(level) })])
      ]);
    }

    function paint() {
      const { w, h } = shell.size();
      const cell = Math.floor(Math.min(w / COLS, h / ROWS));
      const bw = cell * COLS, bh = cell * ROWS;
      const ox = Math.floor((w - bw) / 2), oy = Math.floor((h - bh) / 2);
      const cs = getComputedStyle(document.documentElement);
      const bg = cs.getPropertyValue('--bg-sunken').trim() || '#eee';
      const line = cs.getPropertyValue('--line').trim() || '#ddd';

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      for (let x = 1; x < COLS; x++) {
        ctx.beginPath(); ctx.moveTo(ox + x * cell, oy); ctx.lineTo(ox + x * cell, oy + bh); ctx.stroke();
      }
      for (let y = 1; y < ROWS; y++) {
        ctx.beginPath(); ctx.moveTo(ox, oy + y * cell); ctx.lineTo(ox + bw, oy + y * cell); ctx.stroke();
      }
      function block(bx, by, color, alpha) {
        ctx.globalAlpha = alpha === undefined ? 1 : alpha;
        ctx.fillStyle = color;
        const pad = Math.max(1, Math.floor(cell * 0.06));
        ctx.fillRect(ox + bx * cell + pad, oy + by * cell + pad, cell - pad * 2, cell - pad * 2);
        ctx.globalAlpha = 1;
      }
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (board[y][x]) block(x, y, COLORS[board[y][x]]);
        }
      }
      if (piece && !over) {
        /* 落点影子 */
        let gy = piece.y;
        while (fits(piece.m, piece.x, gy + 1)) gy++;
        piece.m.forEach((row, y) => row.forEach((v, x) => {
          if (v && gy !== piece.y) block(piece.x + x, gy + y, COLORS[piece.key], 0.18);
        }));
        piece.m.forEach((row, y) => row.forEach((v, x) => {
          if (v) block(piece.x + x, piece.y + y, COLORS[piece.key]);
        }));
      }
    }

    shell.setBar([
      dpad((d) => {
        if (d === 'left') move(-1);
        else if (d === 'right') move(1);
        else if (d === 'down') softDrop();
        else if (d === 'up') rotatePiece();
      }, { center: { label: '⏸', fn: toggle } }),
      U.el('div.arcade-side', {}, [
        U.el('button.btn', { onclick: hardDrop }, [U.icon('down', 'ico-sm'), U.el('span', { text: '直落' })]),
        U.el('button.btn', { onclick: rotatePiece }, [U.icon('refresh', 'ico-sm'), U.el('span', { text: '旋转' })]),
        U.el('button.btn', { onclick: () => reset() }, [U.el('span', { text: '重开' })]),
        U.el('button.btn', { onclick: toggle }, [U.el('span', { text: '暂停 / 继续' })])
      ])
    ]);

    function toggle() {
      if (over) { reset(); return; }
      paused = !paused;
      shell.setMsg(paused ? '已暂停 · 点画面继续' : '');
      paint();
    }

    reset();
    swipe(shell.canvas, (d) => {
      if (d === 'left') move(-1);
      else if (d === 'right') move(1);
      else if (d === 'down') softDrop();
      else if (d === 'up') rotatePiece();
    }, () => toggle());

    return {
      key(e) {
        const k = e.key;
        if (k === 'ArrowLeft' || k === 'a') { move(-1); return true; }
        if (k === 'ArrowRight' || k === 'd') { move(1); return true; }
        if (k === 'ArrowDown' || k === 's') { softDrop(); return true; }
        if (k === 'ArrowUp' || k === 'w') { rotatePiece(); return true; }
        if (k === ' ') { hardDrop(); return true; }
        if (k === 'p' || k === 'P') { toggle(); return true; }
        return false;
      },
      pause() { if (!paused && !over) { paused = true; shell.setMsg('已暂停 · 点画面继续'); paint(); } },
      repaint() { paint(); },
      stop() { if (timer) clearInterval(timer); }
    };
  }

  /* ================================================================== */
  /* 视图                                                              */
  /* ================================================================== */
  /* 用数字 id 区分：1 = 贪吃蛇，2 = 俄罗斯方块。
     不用 UI.render() 重画来切游戏或暂停 —— 那会重建画布并把进度清零。 */
  const GAME_LIST = [
    { id: 1, key: 'snake', label: '贪吃蛇', icon: 'snake' },
    { id: 2, key: 'tetris', label: '俄罗斯方块', icon: 'tetris' }
  ];

  UI.route('games', function (view, params) {
    return gamesView(view, params);
  });

  /* 进入某个游戏：注册成一层路由，否则会被兜底重定向到小说页 */
  UI.route('games/:id', function (view, params) {
    return gamesView(view, params);
  });

  function gamesView(view, params) {
    UI.setTitle('休闲一下', '俄罗斯方块 · 贪吃蛇');
    const n = Number((params && params.id) || 0);
    const cur = GAME_LIST.find((g) => g.id === n) || GAME_LIST[0];

    const hasGame = !!cur && n === cur.id && GAME_LIST.some((g) => g.id === n);
    const pills = U.el('div.chips.scroll', { style: { marginBottom: '10px' } });
    pills.appendChild(U.el('button.chip' + (!hasGame ? '.active' : ''), {
      text: '游戏列表',
      onclick: () => UI.go('games')
    }));
    GAME_LIST.forEach((g) => {
      pills.appendChild(U.el('button.chip' + (hasGame && g.id === cur.id ? '.active' : ''), {
        onclick: () => UI.go('games/' + g.id)
      }, [U.icon(g.icon, 'ico-sm'), U.el('span', { text: g.label })]));
    });
    U.append(view, pills);

    /* 列表页：两张卡片，点进去玩 */
    if (!hasGame) {
      const list = U.el('div.games-grid');
      GAME_LIST.forEach((g) => {
        list.appendChild(U.el('button.game-card', { onclick: () => UI.go('games/' + g.id) }, [
          U.el('div.game-card-ico', {}, U.icon(g.icon)),
          U.el('div.game-card-name', { text: g.label }),
          U.el('div.game-card-sub', { text: g.key === 'snake' ? '最高 ' + bestGet('snake') + ' 分' : '最高 ' + bestGet('tetris') + ' 分' })
        ]));
      });
      U.append(view, list);
      U.append(view, U.el('div', {
        style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '14px', lineHeight: '1.8' },
        text: '写累了来两把，随时可退出。最高分只记在本机，不会联网上传。'
      }));
      /* 默认进贪吃蛇？不 —— 先让用户自己选，避免一进来就开始计时 */
      return;
    }

    const shell = makeShell({
      hRatio: cur.key === 'tetris' ? 1.45 : 1,
      onKey: (e) => game && game.key && game.key(e),
      onPause: () => game && game.pause && game.pause(),
      onDestroy: () => game && game.stop && game.stop(),
      onResize: () => { if (game && game.repaint) game.repaint(); }
    });

    let game = null;
    game = cur.key === 'tetris' ? tetrisGame(shell) : snakeGame(shell);

    U.append(view, shell.wrap);
    U.append(view, U.el('div', {
      style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '12px', lineHeight: '1.8' },
      text: '电脑上可用方向键 / WASD 操作；手机可直接在画面上滑动，或用下方按键。切到别的页面会自动暂停。'
    }));

    return function cleanup() { shell.destroy(); };
  }
})(window);
