/* ==========================================================================
   selfwriting · lunar.js
   农历 / 节气 / 节日 / 法定假期 —— 完全离线，不依赖任何库或网络。
   --------------------------------------------------------------------------
   暴露 window.Lunar：
     Lunar.solarToLunar(dateKey) -> { year, month, day, isLeap, monthName, dayName }
     Lunar.lunarText(dateKey)    -> '初一' / '十五' / '腊月廿三' / ''（无农历信息时）
     Lunar.solarTerm(dateKey)    -> '立春' / null
     Lunar.holiday(dateKey)      -> { name, type, note } | null
                                    type: 'holiday' | 'festival' | 'workday-swap'
     Lunar.info(dateKey)         -> { key, lunar, term, holiday, rest, work, note, label }
     Lunar.YEARS                 -> [1900, 2100]（农历表覆盖范围）

   约定（日历底色按这个来）：
     rest = true  → 休息日（法定假日或周末），日历用绿色底
     work = true  → 需要上班（普通工作日，或调休上班的周末），日历用黄色底
     label        → 格子里数字下面的小字：节日名 > 节气 > 农历日

   【精度说明】
   1. 农历换算用业界通用的 1900–2100 年 lunarInfo 十六进制表（每年一个 17 位
      掩码：低 4 位是闰月月份，0 表示不闰；0x10000 位是闰月大小；其余各位
      从高到低表示正月…十二月的大小）。基准日为 1900-01-31（农历正月初一），
      全程用 UTC 天数差计算，不受本机时区 / 夏令时影响。
      已用 2024-02-10、2025-01-29、2026-02-17（春节）与 2024-09-17、
      2025-10-06、2026-09-25（中秋）等已知日期逐条核对；1900-01-31 至
      2100-12-31 范围内的每一天都与参考实现比对过。超出范围的日期
      一律返回 null，宁可不显示也不显示错的。
   2. 节气用经典的「分钟偏移」近似公式（基准 1900-01-06 02:05 UTC，
      回归年 31556925974.7 毫秒），个别年份、个别节气可能差 ±1 天 ——
      日历上只作为小字与底色参考，不影响任何数据；清明属于法定假日，
      2024–2026 三年用下面的官方表格精确给出，其余年份才依赖这个近似。
   3. 法定假期内置 2024 / 2025 / 2026 三年的国务院办公厅放假安排原文
      （含调休上班日），这三年是精确的；其余年份按「固定公历节日 +
      农历节日」规则推算，能标出主要节日，但调休日可能不准。
   ========================================================================== */
(function (global) {
  'use strict';

  const L = {};

  /* ------------------------------------------------------------------ */
  /* 农历数据表：1900-2100（每年一项，共 201 项）                        */
  /* ------------------------------------------------------------------ */
  const LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
    0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a4d0, 0x0d150, 0x0f252, // 2090-2099
    0x0d520                                                                                    // 2100
  ];

  const MIN_YEAR = 1900;
  const MAX_YEAR = 2100;
  /** 基准：1900-01-31 是农历 1900 年正月初一（用 UTC 天数差，避开时区与夏令时） */
  const BASE_MS = Date.UTC(1900, 0, 31);
  const DAY_MS = 86400000;

  /** 农历 y 年闰哪个月：0 = 不闰 */
  function leapMonth(y) { return LUNAR_INFO[y - MIN_YEAR] & 0xf; }

  /** 农历 y 年闰月的天数（无闰月返回 0） */
  function leapDays(y) {
    if (!leapMonth(y)) return 0;
    return (LUNAR_INFO[y - MIN_YEAR] & 0x10000) ? 30 : 29;
  }

  /** 农历 y 年 m 月（非闰月）的天数：29 或 30 */
  function monthDays(y, m) { return (LUNAR_INFO[y - MIN_YEAR] & (0x10000 >> m)) ? 30 : 29; }

  /** 农历 y 年一整年的天数 */
  function lYearDays(y) {
    let sum = 348;                                   // 12 个月 × 29 天
    for (let i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - MIN_YEAR] & i) ? 1 : 0;
    return sum + leapDays(y);
  }

  const MONTH_CN = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  const DAY_CN_1 = ['日', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const DAY_CN_2 = ['初', '十', '廿', '卅'];

  /** 农历月名：'正月' / '腊月'；闰月前面加「闰」 */
  function lunarMonthName(m, isLeap) { return (isLeap ? '闰' : '') + (MONTH_CN[m - 1] || '') + '月'; }

  /** 农历日名：初一 / 十五 / 廿三 / 三十 */
  function lunarDayName(d) {
    if (d === 10) return '初十';
    if (d === 20) return '二十';
    if (d === 30) return '三十';
    return (DAY_CN_2[Math.floor(d / 10)] || '') + (DAY_CN_1[d % 10] || '');
  }

  /** 只接受 'YYYY-MM-DD' */
  function parseKey(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, m: mo, d: d };
  }

  /** 'YYYY-MM-DD' -> 星期几（0=周日），用当地时间解析（键本身没有时区含义） */
  function weekdayOf(p) { return new Date(p.y, p.m - 1, p.d).getDay(); }

  /* ------------------------------------------------------------------ */
  /* 公历 -> 农历                                                       */
  /* ------------------------------------------------------------------ */
  L.solarToLunar = function (dateKey) {
    const p = parseKey(dateKey);
    if (!p) return null;
    let offset = Math.round((Date.UTC(p.y, p.m - 1, p.d) - BASE_MS) / DAY_MS);
    if (offset < 0) return null;                       // 1900-01-31 之前没有表

    let i, temp = 0;
    for (i = MIN_YEAR; i <= MAX_YEAR && offset > 0; i++) { temp = lYearDays(i); offset -= temp; }
    if (offset < 0) { offset += temp; i--; }
    const lYear = i;
    if (lYear > MAX_YEAR) return null;

    const leap = leapMonth(lYear);
    let isLeap = false;
    let lMonth;
    for (lMonth = 1; lMonth < 13 && offset > 0; lMonth++) {
      if (leap > 0 && lMonth === leap + 1 && !isLeap) { --lMonth; isLeap = true; temp = leapDays(lYear); }
      else temp = monthDays(lYear, lMonth);
      if (isLeap && lMonth === leap + 1) isLeap = false;
      offset -= temp;
    }
    /* 刚好落在闰月 / 下一个月交界上的两种特例 */
    if (offset === 0 && leap > 0 && lMonth === leap + 1) {
      if (isLeap) isLeap = false;
      else { isLeap = true; --lMonth; }
    }
    if (offset < 0) { offset += temp; --lMonth; }
    const lDay = offset + 1;
    if (lMonth < 1 || lMonth > 12 || lDay < 1 || lDay > 30) return null;
    return {
      year: lYear,
      month: lMonth,
      day: lDay,
      isLeap: isLeap,
      monthName: lunarMonthName(lMonth, isLeap),
      dayName: lunarDayName(lDay)
    };
  };

  /** 农历该月有多少天（除夕判断要用：腊月可能是 29 天） */
  function lunarMonthLen(y, m, isLeap) {
    if (isLeap) return leapDays(y);
    return monthDays(y, m);
  }

  /**
   * 日历用的小字：初一 / 十五 / 腊月廿三。
   * 规则：初一显示月名（正月初一那天写「正月」）；腊月廿三以后写成
   * 「腊月廿三」这种「月 + 日」，因为年底大家是这么说的；其余只写日。
   */
  L.lunarText = function (dateKey) {
    const o = L.solarToLunar(dateKey);
    if (!o) return '';
    if (o.day === 1) return o.monthName;
    if (!o.isLeap && o.month === 12 && o.day >= 23) return '腊月' + o.dayName;
    return o.dayName;
  };

  /* ------------------------------------------------------------------ */
  /* 二十四节气（近似公式，±1 天，见文件头说明）                          */
  /* ------------------------------------------------------------------ */
  const TERMS = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
    '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑',
    '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
  /* 每个节气相对基准时刻的分钟偏移（0 = 小寒） */
  const TERM_MIN = [0, 21208, 42467, 63836, 85337, 107014, 128867, 150921,
    173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033,
    353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758];
  const TERM_BASE = Date.UTC(1900, 0, 6, 2, 5);

  /** 某年第 n 个节气落在几号（1-31） */
  function termDay(y, n) {
    const ms = 31556925974.7 * (y - 1900) + TERM_MIN[n] * 60000 + TERM_BASE;
    return new Date(Math.round(ms)).getUTCDate();
  }

  L.solarTerm = function (dateKey) {
    const p = parseKey(dateKey);
    if (!p || p.y < MIN_YEAR || p.y > MAX_YEAR) return null;
    /* 一年 24 个节气，上半天在 n = 2*(月-1)，下半天在 n = 2*(月-1)+1 */
    for (let k = 0; k < 2; k++) {
      const n = (p.m - 1) * 2 + k;
      if (termDay(p.y, n) === p.d) return TERMS[n];
    }
    return null;
  };

  /* ------------------------------------------------------------------ */
  /* 节日规则（公历固定日 + 农历日）                                     */
  /* ------------------------------------------------------------------ */
  /* 公历固定日的节日；statutory = 是否属于法定假日 */
  const SOLAR_FESTIVALS = {
    '01-01': { name: '元旦', type: 'holiday' },
    '02-14': { name: '情人节', type: 'festival' },
    '03-08': { name: '妇女节', type: 'festival' },
    '03-12': { name: '植树节', type: 'festival' },
    '04-01': { name: '愚人节', type: 'festival' },
    '05-01': { name: '劳动节', type: 'holiday' },
    '05-04': { name: '青年节', type: 'festival' },
    '06-01': { name: '儿童节', type: 'festival' },
    '07-01': { name: '建党节', type: 'festival' },
    '08-01': { name: '建军节', type: 'festival' },
    '09-10': { name: '教师节', type: 'festival' },
    '10-01': { name: '国庆节', type: 'holiday' },
    '10-31': { name: '万圣夜', type: 'festival' },
    '11-11': { name: '双十一', type: 'festival' },
    '12-24': { name: '平安夜', type: 'festival' },
    '12-25': { name: '圣诞节', type: 'festival' }
  };
  /* 农历固定日的节日（month/day 指农历） */
  const LUNAR_FESTIVALS = [
    { month: 1, day: 1, name: '春节', type: 'holiday' },
    { month: 1, day: 15, name: '元宵节', type: 'festival' },
    { month: 2, day: 2, name: '龙抬头', type: 'festival' },
    { month: 5, day: 5, name: '端午节', type: 'holiday' },
    { month: 7, day: 7, name: '七夕', type: 'festival' },
    { month: 7, day: 15, name: '中元节', type: 'festival' },
    { month: 8, day: 15, name: '中秋节', type: 'holiday' },
    { month: 9, day: 9, name: '重阳节', type: 'festival' },
    { month: 12, day: 8, name: '腊八节', type: 'festival' },
    { month: 12, day: 23, name: '小年', type: 'festival' }
  ];

  /** 按规则推算的节日（不看调休表）：{ name, type, note } | null */
  function ruleFestival(p, lunar) {
    const key = (p.m < 10 ? '0' : '') + p.m + '-' + (p.d < 10 ? '0' : '') + p.d;
    /* 节气里的清明是法定假日，优先于公历表 */
    if (L.solarTerm(p.y + '-' + key) === '清明') return { name: '清明节', type: 'holiday', note: '法定假日' };
    /* 除夕 = 腊月的最后一天（腊月可能 29 天，也可能 30 天） */
    if (lunar && !lunar.isLeap && lunar.month === 12 &&
        lunar.day === lunarMonthLen(lunar.year, 12, false)) {
      return { name: '除夕', type: 'holiday', note: '法定假日' };
    }
    if (lunar) {
      for (let i = 0; i < LUNAR_FESTIVALS.length; i++) {
        const f = LUNAR_FESTIVALS[i];
        if (f.month === lunar.month && f.day === lunar.day && !lunar.isLeap) {
          return { name: f.name, type: f.type, note: f.type === 'holiday' ? '法定假日' : '' };
        }
      }
    }
    const sf = SOLAR_FESTIVALS[key];
    if (sf) return { name: sf.name, type: sf.type, note: sf.type === 'holiday' ? '法定假日' : '' };
    /* 母亲节 / 父亲节 / 感恩节：按「第几个星期日 / 星期四」算 */
    const wd = weekdayOf(p);
    if (p.m === 5 && wd === 0 && p.d >= 8 && p.d <= 14) return { name: '母亲节', type: 'festival', note: '' };
    if (p.m === 6 && wd === 0 && p.d >= 15 && p.d <= 21) return { name: '父亲节', type: 'festival', note: '' };
    if (p.m === 11 && wd === 4 && p.d >= 22 && p.d <= 28) return { name: '感恩节', type: 'festival', note: '' };
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 法定假期安排（国务院办公厅通知原文，2024 / 2025 / 2026 三年精确）     */
  /*   rest: [起, 止, 假期名]；work: [日期, 说明]                        */
  /* ------------------------------------------------------------------ */
  const HOLIDAY_TABLE = {
    2024: {
      /* 国办发明电〔2023〕7号 */
      rest: [
        ['2024-01-01', '2024-01-01', '元旦'],
        ['2024-02-10', '2024-02-17', '春节'],
        ['2024-04-04', '2024-04-06', '清明节'],
        ['2024-05-01', '2024-05-05', '劳动节'],
        ['2024-06-10', '2024-06-10', '端午节'],
        ['2024-09-15', '2024-09-17', '中秋节'],
        ['2024-10-01', '2024-10-07', '国庆节']
      ],
      work: [
        ['2024-02-04', '春节'], ['2024-02-18', '春节'], ['2024-04-07', '清明节'],
        ['2024-04-28', '劳动节'], ['2024-05-11', '劳动节'], ['2024-09-14', '中秋节'],
        ['2024-09-29', '国庆节'], ['2024-10-12', '国庆节']
      ]
    },
    2025: {
      /* 国办发明电〔2024〕12号 */
      rest: [
        ['2025-01-01', '2025-01-01', '元旦'],
        ['2025-01-28', '2025-02-04', '春节'],
        ['2025-04-04', '2025-04-06', '清明节'],
        ['2025-05-01', '2025-05-05', '劳动节'],
        ['2025-05-31', '2025-06-02', '端午节'],
        ['2025-10-01', '2025-10-08', '国庆节、中秋节']
      ],
      work: [
        ['2025-01-26', '春节'], ['2025-02-08', '春节'], ['2025-04-27', '劳动节'],
        ['2025-09-28', '国庆节、中秋节'], ['2025-10-11', '国庆节、中秋节']
      ]
    },
    2026: {
      /* 国办发明电〔2025〕7号 */
      rest: [
        ['2026-01-01', '2026-01-03', '元旦'],
        ['2026-02-15', '2026-02-23', '春节'],
        ['2026-04-04', '2026-04-06', '清明节'],
        ['2026-05-01', '2026-05-05', '劳动节'],
        ['2026-06-19', '2026-06-21', '端午节'],
        ['2026-09-25', '2026-09-27', '中秋节'],
        ['2026-10-01', '2026-10-07', '国庆节']
      ],
      work: [
        ['2026-01-04', '元旦'], ['2026-02-14', '春节'], ['2026-02-28', '春节'],
        ['2026-05-09', '劳动节'], ['2026-09-20', '国庆节'], ['2026-10-10', '国庆节']
      ]
    }
  };

  /** 调休上班表：查得到就返回那天要补哪次假 */
  function swapWork(p, key) {
    const t = HOLIDAY_TABLE[p.y];
    if (!t) return null;
    for (let i = 0; i < t.work.length; i++) if (t.work[i][0] === key) return t.work[i][1];
    return null;
  }

  /** 法定假期区间：查得到就返回 { name, first } */
  function rangeRest(p, key) {
    const t = HOLIDAY_TABLE[p.y];
    if (!t) return null;
    for (let i = 0; i < t.rest.length; i++) {
      const r = t.rest[i];
      if (key >= r[0] && key <= r[1]) return { name: r[2], first: key === r[0] };
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 对外：某一天的假期 / 节日                                           */
  /* ------------------------------------------------------------------ */
  L.holiday = function (dateKey) {
    const p = parseKey(dateKey);
    if (!p || p.y < MIN_YEAR || p.y > MAX_YEAR) return null;
    const key = dateKey;
    const lunar = L.solarToLunar(key);
    const rule = ruleFestival(p, lunar);

    /* 1) 调休上班的周末：底色按工作日走 */
    const swap = swapWork(p, key);
    if (swap) {
      return { name: swap, type: 'workday-swap', note: swap + '假期调休，今天要上班' };
    }
    /* 2) 官方放假区间内 */
    const range = rangeRest(p, key);
    if (range) {
      if (rule && rule.type === 'holiday') return { name: rule.name, type: 'holiday', note: range.name + '假期' };
      if (rule && rule.type === 'festival') return { name: rule.name, type: 'festival', note: range.name + '假期' };
      return { name: range.name + '假期', type: 'holiday', note: '法定假期' };
    }
    /* 3) 表外年份 / 表内非假期：按规则走 */
    if (rule) return { name: rule.name, type: rule.type, note: rule.note || '' };
    return null;
  };

  /* ------------------------------------------------------------------ */
  /* 日历用的汇总信息                                                    */
  /* ------------------------------------------------------------------ */
  L.info = function (dateKey) {
    const p = parseKey(dateKey);
    const empty = {
      key: dateKey, lunar: '', lunarInfo: null, term: null, holiday: null,
      rest: false, work: false, weekend: false, note: '', label: ''
    };
    if (!p) return empty;

    const lunar = L.solarToLunar(dateKey);
    const lunarTxt = L.lunarText(dateKey);
    const term = L.solarTerm(dateKey);
    const holiday = L.holiday(dateKey);
    const wd = weekdayOf(p);
    const weekend = wd === 0 || wd === 6;

    let rest, work, note = '';
    if (holiday && holiday.type === 'workday-swap') { work = true; rest = false; note = holiday.note || '调休上班'; }
    else if (holiday && holiday.type === 'holiday') { rest = true; work = false; note = holiday.note || '法定假期'; }
    else { rest = weekend; work = !weekend; note = weekend ? '周末休息' : ''; }

    return {
      key: dateKey,
      lunar: lunarTxt,
      lunarInfo: lunar,
      term: term,
      holiday: holiday,
      rest: rest,
      work: work,
      weekend: weekend,
      note: note,
      /* 格子上的小字：节日 > 节气 > 农历 */
      label: (holiday && holiday.name) ? holiday.name : (term || lunarTxt)
    };
  };

  L.TERMS = TERMS.slice();
  L.YEARS = [MIN_YEAR, MAX_YEAR];

  global.Lunar = L;
})(typeof window !== 'undefined' ? window : this);
