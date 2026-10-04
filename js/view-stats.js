/* ==========================================================================
   selfwriting · view-stats.js
   统计：创作时长 / 字数 / 创作速度 / 最长间隔 / 趋势热力图 / 分模块明细
   成就：按模块分组的完整成就墙
   设置：亮度深浅、字号行距、每日目标、数据备份与清理
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const UI = global.UI;
  const Store = global.Store;
  const Stats = global.Stats;
  const IO = global.IOApi;
  const DB = global.DB;
  const SV = {};

  const MODULE_NAME = { novel: '小说', article: '文章', diary: '日记', reading: '阅读' };
  const MODULE_ICON = { novel: 'feather', article: 'doc', diary: 'calendar', reading: 'reader' };

  /* ================================================================== */
  /* 统计总览                                                          */
  /* ================================================================== */
  UI.route('stats', function (view) {
    const st = Store.state;
    const s = Stats.summary(st);
    UI.setTitle('统计', '');

    /* 今日 */
    const goal = s.goal || 0;
    U.append(view, U.el('div.card', { style: { background: 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 12%, var(--bg-elev)), var(--bg-elev))' } }, [
      U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } }, [
        UI.ring(goal ? U.clamp(s.today.words / goal, 0, 1) : 0, goal ? Math.round(U.clamp(s.today.words / goal, 0, 1) * 100) + '%' : '—'),
        U.el('div', { style: { flex: '1 1 auto' } }, [
          U.el('div', { text: '今日创作', style: { fontSize: '12px', color: 'var(--text-3)' } }),
          U.el('div', { text: U.fmtInt(s.today.words) + ' 字', style: { fontSize: '22px', fontWeight: '700' } }),
          U.el('div', {
            text: U.pick('时长 ' + U.fmtDuration(s.today.ms / 60000, { short: true }) + (goal ? ' · 目标 ' + U.fmtInt(goal) + ' 字' : ''), U.fmtDuration(s.today.ms / 60000, { short: true }) + (goal ? ' · goal ' + U.fmtInt(goal) + ' words' : '')),
            style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px' }
          })
        ])
      ]),
      U.el('div', { style: { marginTop: '12px' } }, [
        U.el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--text-3)', marginBottom: '6px' } }, [
          U.el('span', { text: '最近 30 天：' + U.fmtInt(s.series30.reduce((a, b) => a + b.words, 0)) + ' 字 · 活跃 ' + s.activeDays30 + ' 天' }),
          U.el('span', { text: '日均 ' + U.fmtInt(s.avg30) + ' 字' })
        ]),
        UI.barChart(s.series30)
      ])
    ]));

    /* 核心数字 */
    U.append(view, U.el('div.section-title', {}, [U.icon('chart', 'ico-sm'), U.el('span', { text: '总览' })]));
    U.append(view, U.el('div.stat-grid', {}, [
      statCard('clock', '累计创作时长', U.fmtDuration(s.totalMs / 60000, { short: true }), U.pick('共 ' + s.sessions + ' 个写作段 · 平均 ' + U.fmtDuration(s.avgSessionMs / 60000, { short: true }), s.sessions + (s.sessions === 1 ? ' session' : ' sessions') + ' · avg ' + U.fmtDuration(s.avgSessionMs / 60000, { short: true }))),
      statCard('feather', '累计创作字数', U.fmtNum(s.totalWords), U.pick(U.fmtInt(s.totalWords) + ' 字（不含阅读）', U.fmtInt(s.totalWords) + ' words (excluding reading)')),
      statCard('zoom', '平均创作速度', s.speedAll ? U.fmtInt(s.speedAll) + ' 字/时' : '—', s.speedAll ? U.pick('小说 ' + U.fmtInt(s.speedNovel) + ' · 文章 ' + U.fmtInt(s.speedArticle) + ' · 日记 ' + U.fmtInt(s.speedDiary), 'Novel ' + U.fmtInt(s.speedNovel) + ' · Article ' + U.fmtInt(s.speedArticle) + ' · Diary ' + U.fmtInt(s.speedDiary)) : '写得还不够，继续加油'),
      statCard('fire', '连续创作', s.streak + ' 天', s.lastActive ? '最近一次 ' + s.lastActive : '还没有记录'),
      statCard('minus', '最长停笔间隔', s.maxGapDays + ' 天', s.maxGapFrom ? s.maxGapFrom + ' → ' + s.maxGapTo : '暂无数据'),
      statCard('clock', '最长单次写作', s.best.longestSessionMs ? U.fmtDuration(s.best.longestSessionMs / 60000, { short: true }) : '—', s.best.longestSessionAt ? U.fmtWhen(s.best.longestSessionAt) : ''),
      statCard('trophy', '单日最高字数', U.fmtNum(s.best.dayWords), s.best.dayDate || ''),
      statCard('target', '最快速度', s.best.speedPerHour ? U.fmtInt(s.best.speedPerHour) + ' 字/时' : '—', s.best.speedDate || ''),
      statCard('minus', '当前已停笔', s.currentGapDays + ' 天', s.currentGapDays > 2 ? '该动笔啦' : '保持得很好')
    ]));

    /* 分模块 */
    U.append(view, U.el('div.section-title', {}, [U.icon('grid', 'ico-sm'), U.el('span', { text: '分模块明细' })]));
    const modCard = U.el('div.card');
    const maxMs = Math.max(1, ...Object.keys(s.modules).map((k) => s.modules[k].ms || 0));
    ['novel', 'article', 'diary', 'reading'].forEach((k) => {
      const m = s.modules[k] || { ms: 0, words: 0, sessions: 0 };
      const speed = Stats.speed(st, k);
      U.append(modCard, U.el('div.hbar-row', {}, [
        U.el('span.lbl', {}, [U.icon(MODULE_ICON[k], 'ico-sm'), U.el('span', { text: ' ' + MODULE_NAME[k] })]),
        UI.progressBar(m.ms / maxMs, 'thin'),
        U.el('span.num', { text: U.fmtDuration(m.ms / 60000, { short: true }) })
      ]));
      U.append(modCard, U.el('div', {
        style: { fontSize: '11px', color: 'var(--text-3)', marginTop: '-5px', marginBottom: '10px', paddingLeft: '4px' },
        text: U.fmtInt(m.words) + ' 字 · ' + m.sessions + ' 段' + (speed ? ' · ' + U.fmtInt(speed) + ' 字/时' : '')
      }));
    });
    U.append(view, modCard);

    /* 活跃热力图 */
    U.append(view, U.el('div.section-title', {}, [U.icon('calendar', 'ico-sm'), U.el('span', { text: '活跃热力图（近 15 周）' })]));
    const heatCard = U.el('div.card');
    U.append(heatCard, UI.heatmap((st.stats || {}).daily, 15));
    U.append(heatCard, U.el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', fontSize: '11px', color: 'var(--text-3)' } }, [
      U.el('span', { dataset: { i18nGroup: 'legend:0' }, text: '少' }),
      U.el('i', { style: { width: '11px', height: '11px', borderRadius: '3px', background: 'var(--surface-2)', display: 'inline-block' } }),
      U.el('i', { style: { width: '11px', height: '11px', borderRadius: '3px', background: 'color-mix(in srgb, var(--accent) 25%, transparent)', display: 'inline-block' } }),
      U.el('i', { style: { width: '11px', height: '11px', borderRadius: '3px', background: 'color-mix(in srgb, var(--accent) 45%, transparent)', display: 'inline-block' } }),
      U.el('i', { style: { width: '11px', height: '11px', borderRadius: '3px', background: 'color-mix(in srgb, var(--accent) 70%, transparent)', display: 'inline-block' } }),
      U.el('i', { style: { width: '11px', height: '11px', borderRadius: '3px', background: 'var(--accent)', display: 'inline-block' } }),
      U.el('span', { dataset: { i18nGroup: 'legend:1' }, text: '多' })
    ]));
    U.append(view, heatCard);

    /* 速度趋势（按天） */
    const speedRows = s.series30.filter((x) => x.ms > 60000).map((x) => ({ key: x.key, speed: Math.round(x.words / (x.ms / 3600000)) })).filter((x) => x.speed > 0).sort((a, b) => b.speed - a.speed);
    if (speedRows.length) {
      U.append(view, U.el('div.section-title', {}, [U.icon('zoom', 'ico-sm'), U.el('span', { text: '创作速度排行（近 30 天）' })]));
      const sc = U.el('div.card');
      speedRows.slice(0, 6).forEach((r) => {
        U.append(sc, U.el('div.hbar-row', {}, [
          U.el('span.lbl', { text: r.key.slice(5) }),
          UI.progressBar(r.speed / speedRows[0].speed, 'thin'),
          U.el('span.num', { text: U.fmtInt(r.speed) + ' 字/时' })
        ]));
      });
      U.append(view, sc);
    }

    /* 最近写作段 */
    const journal = ((st.stats || {}).journal || []).slice(-25).reverse();
    if (journal.length) {
      U.append(view, U.el('div.section-title', {}, [U.icon('list', 'ico-sm'), U.el('span', { text: '最近写作段' })]));
      const jl = U.el('div.list');
      journal.forEach((j) => {
        const speed = j.ms > 0 ? Math.round((j.words || 0) / (j.ms / 3600000)) : 0;
        jl.appendChild(U.el('div.row', {}, [
          U.el('span.row-chev', {}, U.icon(MODULE_ICON[j.kind] || 'dot', 'ico-sm')),
          U.el('div.row-main', {}, [
            U.el('div.row-title', { text: U.fmtDuration(j.ms / 60000, { short: true }) + ' · ' + U.fmtInt(j.words || 0) + ' 字' }),
            U.el('div.row-sub', { text: U.fmtDateTime(j.start) + (speed ? ' · ' + U.fmtInt(speed) + ' 字/时' : '') })
          ])
        ]));
      });
      U.append(view, jl);
    }

    U.append(view, U.el('div.grid2', { style: { marginTop: '16px' } }, [
      U.el('button.btn', { onclick: () => UI.go('stats/achievements') }, [U.icon('trophy', 'ico-sm'), U.el('span', { text: '成就墙' })]),
      U.el('button.btn', { onclick: () => UI.go('stats/settings') }, [U.icon('settings', 'ico-sm'), U.el('span', { text: '设置' })])
    ]));
  });

  function statCard(iconName, k, v, d) {
    return U.el('div.stat', {}, [
      U.el('div.k', {}, [U.icon(iconName, 'ico-sm'), U.el('span', { text: k })]),
      U.el('div.v', { html: String(v) }),
      U.el('div.d', { text: d || '' })
    ]);
  }

  /* ================================================================== */
  /* 成就墙                                                            */
  /* ================================================================== */
  UI.route('stats/achievements', function (view) {
    const st = Store.state;
    UI.setTitle('成就', '');
    const unlocked = global.Ach.unlockedCount(st);
    const total = global.Ach.totalCount();

    const chipsHost = U.el('div', { style: { marginBottom: '4px' } });
    U.append(view, chipsHost);
    const bodyHost = U.el('div');
    U.append(view, bodyHost);

    let group = 'all';
    const groups = [{ id: 'all', label: '全部', icon: 'trophy' }].concat(global.Ach.groups.map((g) => ({ id: g.id, label: g.name, icon: g.icon })));
    const chips = U.el('div.chips.scroll');
    groups.forEach((g) => {
      chips.appendChild(U.el('button.chip' + (g.id === group ? '.active' : ''), {
        text: g.label,
        onclick: (e) => {
          group = g.id;
          U.$$('.chip', chips).forEach((x) => x.classList.remove('active'));
          e.currentTarget.classList.add('active');
          draw();
        }
      }));
    });
    U.append(chipsHost, chips);

    function draw() {
      U.clear(bodyHost);
      UI.achievementPanel(bodyHost, { groups: group === 'all' ? null : [group] });
    }
    draw();

    /* 规则说明 */
    U.append(view, U.el('div.section-title', {}, [U.icon('doc', 'ico-sm'), U.el('span', { text: '成就规则' })]));
    U.append(view, U.el('div.card', {}, [
      U.el('div', { style: { fontSize: '12.5px', lineHeight: '1.9', color: 'var(--text-2)' } }, [
        U.el('div', { text: '· 小说：每 10 万字一个成就（10 万 / 100 万 / 1000 万 / 1 亿），另有单本长篇与完结成就' }),
        U.el('div', { text: '· 文章：每 1 千字一个成就（1 千 / 1 万 / 10 万 / 100 万），另有单篇与篇数成就' }),
        U.el('div', { text: '· 日记：每 1 千字成就 + 记录天数成就 + 连续记录成就（连续一周 / 一个月 / 百日 / 一年）' }),
        U.el('div', { text: '· 大纲：节点数、重点标记数、与章节的联动数、使用的分支颜色数' }),
        U.el('div', { text: '· 阅读：读完册数、阅读字数、阅读时长' }),
        U.el('div', { text: '· 综合：活跃天数 / 周数 / 月数 / 年数、累计字数与时长、每日目标达成次数' })
      ])
    ]));
  });

  /* ================================================================== */
  /* 设置                                                              */
  /* ================================================================== */
  UI.route('stats/settings', function (view) {
    const st = Store.state;
    const s = st.settings;
    UI.setTitle('设置', '');

    /* 显示 */
    U.append(view, U.el('div.section-title', {}, [U.icon('sun', 'ico-sm'), U.el('span', { text: '显示与亮度' })]));
    const displayCard = U.el('div.card');
    const bright = U.el('input', { type: 'range', min: '20', max: '100', step: '1', value: String(s.brightness || 100) });
    bright.addEventListener('input', () => Store.setSetting('brightness', Number(bright.value)));
    U.append(displayCard, [
      U.el('div.field', {}, [
        U.el('label', { text: '屏幕亮度（阅读模式下同样生效）' }),
        U.el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [U.icon('sun-small', 'ico-sm'), bright, U.icon('sun', 'ico-sm')])
      ]),
      UI.switchRow('深色模式', '低光环境下更护眼', document.documentElement.getAttribute('data-theme') === 'dark', () => { Store.toggleTheme(); UI.syncBrightnessPanel(); UI.render(); }),
      UI.switchRow('跟随系统', '随手机深浅色自动切换', s.themeMode === 'auto', (v) => { Store.patchSettings({ themeMode: v ? 'auto' : 'manual' }); Store.applyTheme(); UI.render(); }),
      UI.switchRow('护眼暖色', '偏黄的纸张底色', !!s.warm, (v) => { Store.setSetting('warm', v); UI.render(); })
    ]);
    /* 主题色 */
    const palette = ['#b4503c', '#34618f', '#2f7d5f', '#b8860b', '#7a4a86', '#b3457a'];
    const dots = U.el('div.color-dots');
    palette.forEach((c) => {
      dots.appendChild(U.el('button.color-dot' + (s.accent === c ? '.sel' : ''), {
        style: { background: c },
        onclick: () => { Store.setSetting('accent', c); UI.render(); }
      }));
    });
    U.append(displayCard, U.el('div.field', { style: { marginTop: '10px' } }, [U.el('label', { text: '主题色' }), dots]));
    U.append(view, displayCard);

    /* 界面语言 */
    if (global.I18N) {
      U.append(view, U.el('div.section-title', {}, [U.icon('doc', 'ico-sm'), U.el('span', { text: '界面语言' })]));
      U.append(view, U.el('div.card', {}, [global.I18N.selector()]));
    }

    /* 时间与时区：日历的「今天」、顶部时钟、不能记未来日期的判定都按它算 */
    U.append(view, U.el('div.section-title', {}, [U.icon('clock', 'ico-sm'), U.el('span', { text: '时间与时区' })]));
    const tzCard = U.el('div.card');
    const tzSel = U.el('select.input.cal-tz-select', { 'aria-label': '时区' });
    U.TIMEZONES.forEach((t) => {
      tzSel.appendChild(U.el('option', { value: String(t.offset), selected: t.offset === U.tzOffset(), text: t.label + ' ' + t.sub }));
    });
    /* 设置里可能存着列表之外的偏移（导入数据 / 老版本）：补一项，别让选择框空着 */
    if (!U.TIMEZONES.some((t) => t.offset === U.tzOffset())) {
      tzSel.insertBefore(U.el('option', { value: String(U.tzOffset()), selected: true, text: U.tzLabel() }), tzSel.firstChild);
    }
    const tzNowLine = U.el('div.field-note', {
      text: '现在：' + U.tzLabel() + ' · ' + U.tzClock(true) + ' · ' + U.weekdayCN(U.today()) + ' · 今天 ' + U.today()
    });
    tzSel.addEventListener('change', () => {
      Store.setSetting('timeZone', Number(tzSel.value));
      UI.render();
    });
    U.append(tzCard, [
      U.el('div.field', {}, [
        U.el('label', { text: '时区（日历的「今天」、时钟与未来日期判定）' }),
        tzSel,
        tzNowLine
      ]),
      U.el('div.field-note', { text: '默认北京时间 UTC+8。换时区后，日历上的「今天」、时钟与「不能记录未来日期」的判定都会跟着变。' })
    ]);
    U.append(view, tzCard);

    /* 排版 */
    U.append(view, U.el('div.section-title', {}, [U.icon('text', 'ico-sm'), U.el('span', { text: '写作排版' })]));
    const typeCard = U.el('div.card');
    const efs = U.el('input', { type: 'range', min: '14', max: '30', step: '1', value: String(s.editorFontSize || 18) });
    efs.addEventListener('input', () => Store.setSetting('editorFontSize', Number(efs.value)));
    const elh = U.el('input', { type: 'range', min: '14', max: '30', step: '1', value: String(Math.round((s.editorLineHeight || 1.9) * 10)) });
    elh.addEventListener('input', () => Store.setSetting('editorLineHeight', Number(elh.value) / 10));
    const rfs = U.el('input', { type: 'range', min: '14', max: '34', step: '1', value: String(s.readerFontSize || 18) });
    rfs.addEventListener('input', () => { Store.setSetting('readerFontSize', Number(rfs.value)); Store.applyTheme(); });
    U.append(typeCard, [
      U.el('div.field', {}, [U.el('label', { text: '编辑区字号' }), efs]),
      U.el('div.field', {}, [U.el('label', { text: '编辑区行距' }), elh]),
      U.el('div.field', {}, [U.el('label', { text: '阅读器字号' }), rfs]),
      UI.switchRow('段首自动缩进', '回车自动空两格', s.autoIndent !== false, (v) => Store.setSetting('autoIndent', v)),
      UI.switchRow('衬线字体', '正文使用宋体风格字体', s.editorFont !== 'sans', (v) => Store.setSetting('editorFont', v ? 'serif' : 'sans'))
    ]);
    U.append(view, typeCard);

    /* 目标 */
    U.append(view, U.el('div.section-title', {}, [U.icon('target', 'ico-sm'), U.el('span', { text: '创作目标' })]));
    const goalCard = U.el('div.card');
    U.append(goalCard, [
      U.el('div.field', {}, [
        U.el('label', { text: '每日字数目标' }),
        U.el('div.inline', {}, [
          U.el('input.input', {
            type: 'number', value: String(s.dailyGoalWords || 0), min: '0',
            onchange: (e) => { Store.setSetting('dailyGoalWords', Math.max(0, Number(e.target.value) || 0)); UI.render(); }
          }),
          U.el('span', { dataset: { i18nGroup: 'unit:0' }, text: '字', style: { color: 'var(--text-3)' } })
        ]),
        U.el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [500, 1000, 2000, 5000, 10000].map((v) =>
          U.el('button.chip' + (s.dailyGoalWords === v ? '.active' : ''), { text: String(v), onclick: () => { Store.setSetting('dailyGoalWords', v); UI.render(); } })))
      ]),
      U.el('div.field', {}, [
        U.el('label', { text: '新章节默认字数目标' }),
        U.el('input.input', {
          type: 'number', value: String(s.defaultChapterGoal || 0), min: '0',
          onchange: (e) => Store.setSetting('defaultChapterGoal', Math.max(0, Number(e.target.value) || 0))
        })
      ]),
      U.el('div.field', {}, [
        U.el('label', { text: '写作段停顿判定（秒）' }),
        U.el('input.input', {
          type: 'number', value: String(s.sessionIdleSeconds || 45), min: '10', max: '600',
          onchange: (e) => Store.setSetting('sessionIdleSeconds', U.clamp(Number(e.target.value) || 45, 10, 600))
        }),
        U.el('div', { text: '停笔超过这个时间，当前写作段结束，时长不再累计。', style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '6px' } })
      ]),
      UI.switchRow('成就解锁提示', '解锁时弹出提示', s.showAchievementToast !== false, (v) => Store.setSetting('showAchievementToast', v))
    ]);
    U.append(view, goalCard);


    /* 数据 */
    U.append(view, U.el('div.section-title', {}, [U.icon('folder', 'ico-sm'), U.el('span', { text: '数据与备份' })]));    const dataCard = U.el('div.card');
    const usageLine = U.el('div', { text: '正在统计占用…', style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '10px' } });
    DB.usage().then((u) => {
      const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
      usageLine.textContent = '本机占用：作品数据 ' + mb(u.localBytes) + (u.idbBytes ? ' · 总用量 ' + mb(u.idbBytes) : '') + (u.quota ? ' / 可用 ' + (u.quota / 1048576 / 1024).toFixed(1) + ' GB' : '');
    });
    U.append(dataCard, [
      U.el('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.8' } }, [
        U.el('div', { text: '· 所有内容保存在本机浏览器存储中，卸载浏览器或清理数据会一并删除' }),
        U.el('div', { text: '· 建议定期导出整库备份（JSON），换机或重装后可完整恢复' }),
        U.el('div', { text: '· 文本可导出为 TXT / Markdown，方便分享到其它软件' })
      ]),
      U.el('div.grid2', { style: { marginTop: '12px' } }, [
        U.el('button.btn.primary', { onclick: () => IO.backupAll().then(() => UI.toast('备份已导出', 'down')) }, [U.icon('down', 'ico-sm'), U.el('span', { text: '导出整库备份' })]),
        U.el('button.btn', { onclick: () => restoreFlow() }, [U.icon('up', 'ico-sm'), U.el('span', { text: '从备份恢复' })]),
        U.el('button.btn', { onclick: () => requestPersist() }, [U.icon('check', 'ico-sm'), U.el('span', { text: '申请持久存储' })]),
        U.el('button.btn', { onclick: () => UI.go('stats/trash') }, [U.icon('trash', 'ico-sm'), U.el('span', { text: '回收站' })])
      ]),
      usageLine,
      U.el('div', { style: { marginTop: '14px', borderTop: '1px solid var(--line)', paddingTop: '12px' } }, [
        U.el('button.btn.block.danger', { onclick: () => wipeFlow() }, [U.icon('trash', 'ico-sm'), U.el('span', { text: '清空全部数据' })])
      ])
    ]);
    U.append(view, dataCard);

    /* 安卓安装包 */
    U.append(view, U.el('div.section-title', {}, [U.icon('down', 'ico-sm'), U.el('span', { text: '安装到手机' })]));
    U.append(view, U.el('div.card', {}, [
      U.el('div', { style: { fontSize: '13px', fontWeight: '620' }, text: 'selfwriting 安卓安装包（APK）' }),
      U.el('div', { style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '6px', lineHeight: '1.8' } }, [
        U.el('div', { text: '· 与网页版功能完全相同，完全离线，数据保存在本机' }),
        U.el('div', { text: '· 支持 Android 7.0 及以上；安装时需要允许「安装未知来源应用」' }),
        U.el('div', { text: '· APK 与当前页面在同一台电脑上，手机需与电脑在同一 Wi-Fi' })
      ]),
      U.el('button.btn.primary.block', {
        style: { marginTop: '12px' },
        onclick: () => {
          const url = new URL('selfwriting.apk', location.href).href;
          window.open(url, '_blank');
          UI.toast('已开始下载安装包', 'down');
        }
      }, [U.icon('down', 'ico-sm'), U.el('span', { text: '下载 selfwriting.apk' })])
    ]));

    U.append(view, U.el('div.card', { style: { marginTop: '12px' } }, [
      U.el('div', { style: { fontSize: '12px', color: 'var(--text-3)', lineHeight: '1.8' } }, [
        U.el('div', {}, [U.el('span', { text: 'selfwriting 1.15.0' }), U.el('span', { text: ' · 创作与数据全部在本机；只有「网址下载」会联网' })]),
        U.el('div', { text: '小说 · 文章 · 日记 · 大纲 · 阅读器 · 协作 · 娱乐 · 隐私锁 · 统计' })
      ]),
      U.el('div.grid2', { style: { marginTop: '10px' } }, [
        U.el('button.btn', { onclick: () => UI.go('stats/achievements') }, [U.icon('trophy', 'ico-sm'), U.el('span', { text: '成就墙' })]),
        U.el('button.btn', { onclick: () => UI.go('library') }, [U.icon('book', 'ico-sm'), U.el('span', { text: '回到书架' })])
      ])
    ]));
  });

  function restoreFlow() {
    UI.choose({
      title: '恢复方式',
      items: [
        { label: '合并导入', sub: '保留现有数据，追加备份内容', value: 'merge', icon: 'plus' },
        { label: '覆盖导入', sub: '完全替换为备份内容', value: 'replace', icon: 'refresh' }
      ]
    }).then((mode) => {
      if (!mode) return;
      IO.pickFile('.json,application/json').then((files) => {
        if (!files.length) return;
        const go = () => IO.restoreAll(files[0], mode).then(() => { UI.toast('恢复完成', 'check'); UI.go('library'); }).catch((e) => UI.alert('恢复失败', String(e.message || e)));
        if (mode === 'replace') UI.confirm('覆盖导入', '当前数据将被替换，且不可撤销。', '确认覆盖', true).then((ok) => { if (ok) go(); });
        else go();
      });
    });
  }

  function requestPersist() {
    DB.requestPersist().then((ok) => UI.toast(ok ? '已获得持久存储权限' : '系统未授予（通常仍需手动保留数据）', ok ? 'check' : 'close'));
  }

  function wipeFlow() {
    UI.confirm('清空全部数据', '所有小说、文章、日记、大纲、读物、成就与统计都会被永久删除，无法恢复。建议先导出备份。', '我确认清空', true).then((ok) => {
      if (!ok) return;
      UI.input({ title: '再次确认', message: '请输入「清空」两个字以确认。', placeholder: '清空' }).then((v) => {
        if (v !== '清空') { UI.toast('已取消', 'close'); return; }
        DB.wipe().then(() => {
          location.hash = '#/library';
          location.reload();
        });
      });
    });
  }

  /* ================================================================== */
  /* 回收站                                                            */
  /* ================================================================== */
  UI.route('stats/trash', function (view) {
    const st = Store.state;
    UI.setTitle('回收站', (st.trash || []).length + ' 项');
    const items = (st.trash || []).slice().reverse();
    if (!items.length) {
      U.append(view, UI.empty('trash', '回收站是空的', '删除的作品会先放到这里，可以恢复一次。'));
      return;
    }
    const KIND = { novel: '小说', chapter: '章节', article: '文章', diaryBook: '日记本', diaryEntry: '日记', book: '读物' };
    const list = U.el('div.list');
    items.forEach((t) => {
      const title = (t.item && (t.item.title || U.excerpt(t.item.content, 20))) || '（无标题）';
      list.appendChild(U.el('div.row', {}, [
        U.el('div.row-main', {}, [
          U.el('div.row-title', { text: (KIND[t.kind] || '项目') + ' · ' + title }),
          U.el('div.row-sub', { text: '删除于 ' + U.fmtDateTime(t.at) })
        ]),
        U.el('button.btn.sm', {
          onclick: () => {
            Store.commit((s) => {
              const i = s.trash.indexOf(t);
              if (i >= 0) s.trash.splice(i, 1);
              if (t.kind === 'novel') s.novels.unshift(t.item);
              else if (t.kind === 'article') s.articles.unshift(t.item);
              else if (t.kind === 'diaryBook') s.diaries.unshift(t.item);
              else if (t.kind === 'book') s.reading.unshift(t.item);
              else if (t.kind === 'chapter' && t.novelId) {
                const n = Store.findNovel(t.novelId);
                if (n) { n.chapters.push(t.item); Store.recomputeNovel(n); }
              } else if (t.kind === 'diaryEntry' && t.bookId) {
                const b = Store.findDiary(t.bookId);
                if (b) { b.entries.push(t.item); b.entries.sort((x, y) => (x.dateKey < y.dateKey ? -1 : 1)); }
              }
            }, { kind: 'trash:restore' });
            UI.toast('已恢复', 'check');
            UI.render();
          }
        }, [U.icon('refresh', 'ico-sm'), U.el('span', { text: '恢复' })]),
        U.el('button.icon-btn', {
          onclick: () => {
            Store.commit((s) => {
              const i = s.trash.indexOf(t);
              if (i >= 0) s.trash.splice(i, 1);
            }, { kind: 'trash:purge' });
            if (t.kind === 'diaryEntry' && t.item) (t.item.images || []).forEach((im) => DB.deleteImage(im.id));
            UI.toast('已彻底删除', 'trash');
            UI.render();
          }, 'aria-label': '彻底删除'
        }, U.icon('close', 'ico-sm'))
      ]));
    });
    U.append(view, list);
    U.append(view, U.el('button.btn.block', {
      style: { marginTop: '16px' },
      onclick: () => UI.confirm('清空回收站', '回收站里的内容将被永久删除。', '清空', true).then((ok) => {
        if (!ok) return;
        Store.commit((s) => {
          (s.trash || []).forEach((t) => { if (t.kind === 'diaryEntry' && t.item) (t.item.images || []).forEach((im) => DB.deleteImage(im.id)); });
          s.trash = [];
        }, { kind: 'trash:clear' });
        UI.render();
      })
    }, '清空回收站'));
  });

  global.StatsView = SV;
})(window);
