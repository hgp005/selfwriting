/* ==========================================================================
   selfwriting · i18n.js
   多语种：界面文案翻译 + 语言切换
   --------------------------------------------------------------------------
   设计取舍（为什么不去改每一个 t('...') 调用）：
     项目里有上千条中文字面量，逐个替换成 t('…') 风险极高（漏掉一处就是
     半中半英），而且会动到所有视图文件。这里改成**运行时词典替换**：
       · 词典的 key 就是源码里的中文原文，一眼能核对
       · 挂一个 MutationObserver，新渲染出来的界面自动翻译
       · 只替换「整段完全匹配」的文本，用户自己的作品内容不会被误改
     代价：新增文案若忘了加词典，会显示中文原文（可接受，优先保证不乱）
   ========================================================================== */
(function (global) {
  'use strict';

  const I = {};
  const ZH = 'zh-CN';

  I.LANGS = [
    { id: 'zh-CN', label: '简体中文', native: '简体中文' },
    { id: 'en', label: 'English', native: 'English' },
    { id: 'zh-TW', label: '繁體中文', native: '繁體中文' }
  ];

  /* ================================================================== */
  /* 词典：key = 源码里的中文原文                                        */
  /* ================================================================== */
  const DICT = {
    en: {
      /* --- 底部导航 / 顶部栏 --- */
      '小说': 'Novels', '文章': 'Articles', '日记': 'Diary', '大纲': 'Outline', '阅读': 'Reading',
      '搜索': 'Search', '统计': 'Stats', '更多': 'More', '亮度': 'Brightness', '返回': 'Back',
      '统计与成就': 'Stats & Trophies', '更多功能': 'More',
      /* --- 通用 --- */
      '取消': 'Cancel', '保存': 'Save', '删除': 'Delete', '关闭': 'Close', '确定': 'OK',
      '编辑': 'Edit', '复制': 'Copy', '完成': 'Done', '新建': 'New', '添加': 'Add',
      '重命名': 'Rename', '导出': 'Export', '导入': 'Import', '设置': 'Settings', '移除': 'Remove',
      '加入': 'Join', '退出': 'Leave', '开启': 'Turn on', '暂停 / 继续': 'Pause / Resume',
      '重开': 'Restart', '分数': 'Score', '最高': 'Best', '长度': 'Length', '消行': 'Lines',
      '等级': 'Level', '直落': 'Drop', '旋转': 'Rotate', '重试': 'Retry', '诊断信息': 'Diagnostics',
      /* --- 模块页 --- */
      '全部': 'All', '新建小说': 'New novel', '新建文章': 'New article', '新建记录本': 'New diary book',
      '导入读物': 'Import book', '导入文本': 'Import text', '大纲': 'Outline', '恢复备份': 'Restore backup',
      '设置': 'Settings', '最新成就': 'Latest achievements', '记录本': 'Diary books',
      '小说 · 章节目数目标': 'Novels · chapter goals',
      /* --- 日记 --- */
      '今天': 'Today', '前一天': 'Previous day', '后一天': 'Next day', '本月': 'This month',
      '最近记录': 'Recent entries', '已保存': 'Saved', '已更新': 'Updated',
      '日记': 'Diary', '周记': 'Weekly', '月记': 'Monthly', '自定义间隔': 'Custom interval',
      '多人日记本': 'Shared diary',
      /* --- 写作 --- */
      '排版': 'Typography', '专注': 'Focus', '字号': 'Font size', '行距': 'Line height',
      '正文字体': 'Body font', '界面字体': 'UI font', '段首自动缩进': 'Auto indent',
      '写作功能库': 'Writing tools', '便签': 'Notes', '目标': 'Goals',
      '续写辅助': 'Continue writing', '协作对话': 'Team chat', '插入到正文末尾': 'Insert at end',
      '已插入，接着往下写吧': 'Inserted — keep going',
      /* --- 阅读器 --- */
      '我的阅读器': 'My reader', '导入文章': 'Import', '阅读设置': 'Reading settings',
      '目录': 'Contents', '书签': 'Bookmarks', '进度': 'Progress', '下一节': 'Next',
      '网址下载': 'Download from URL', '开始下载': 'Download', '从网址下载书籍': 'Download a book from a URL',
      '文件网址': 'File URL', '书名': 'Title', '作者': 'Author', '类型': 'Category',
      /* --- 导入 --- */
      '导入为小说': 'Import as novel', '导入为文章': 'Import as article',
      '导入为日记': 'Import as diary', '导入到阅读器': 'Import to reader',
      '选择文件': 'Choose file', '粘贴文本': 'Paste text', '正在导入': 'Importing',
      '没能导入这个文件': 'Could not import this file',
      '复制诊断信息': 'Copy diagnostics', '文件导入自检': 'File import self-check',
      '可以导入这些文件：': 'Supported files: ',
      /* --- 娱乐与工具 --- */
      '休闲游戏': 'Mini games', '音乐创作': 'Music', '计算器': 'Calculator',
      '隐私锁': 'Privacy lock', '协作与分享': 'Collaborate & share',
      '标准': 'Standard', '科学': 'Scientific', '换算': 'Convert',
      '钢琴键': 'Piano', '谱曲': 'Compose', '歌词': 'Lyrics', '我的曲子': 'My songs',
      '试听': 'Preview', '整体低八度': 'Octave down', '整体高八度': 'Octave up',
      '清空': 'Clear', '来一段示例': 'Load a demo', '乐谱预览': 'Score preview',
      '灵感': 'Idea', '注释': 'Note', '待办': 'To-do', '牢骚': 'Rant', '记下': 'Save note',
      /* --- 协作 --- */
      '开一个房间': 'Host a room', '输入房间码加入': 'Join with a room code',
      '我的昵称': 'My nickname', '协作中的作品': 'Shared works', '密友名单': 'Close friends',
      '添加密友': 'Add a friend', '生成分享包': 'Create share file', '生成分享包': 'Create share file',
      '退出房间': 'Leave room', '告诉朋友怎么加入': 'How friends join',
      '房间码': 'Room code', '主机地址': 'Host address', '加入协作室': 'Join a room',
      '可编辑（一起写）': 'Can edit (co-write)', '只读（只给我看）': 'Read-only',
      '只读分享': 'Read-only share', '选择作品': 'Pick a work', '生成并保存': 'Create & save',
      '协作室': 'Rooms', '同一个 WiFi': 'Same Wi-Fi', '不在一起': 'Not together',
      /* --- 隐私 --- */
      '开启隐私锁': 'Turn on privacy lock', '关闭隐私锁': 'Turn off privacy lock',
      '修改密码': 'Change password', '私密作品': 'Private works', '设为私密': 'Make private',
      '取消私密': 'Make public', '解锁': 'Unlock', '解锁查看': 'Unlock to view',
      '输入密码': 'Enter password', '设置密码': 'Set password', '确认密码': 'Confirm password',
      '这是一部私密作品': 'This work is private', '需要密码': 'Password required',
      /* --- 统计与设置 --- */
      '创作时长': 'Writing time', '字数': 'Words', '创作速度': 'Speed', '最长间隔': 'Longest gap',
      '成就墙': 'Trophy wall', '导出整库备份': 'Export full backup', '清空全部数据': 'Erase all data',
      '深色模式': 'Dark mode', '护眼': 'Warm', '跟随系统': 'Follow system',
      '今日创作': 'Today', '连续创作': 'Streak', '天': 'days',
      /* --- 提示语 --- */
      '已复制': 'Copied', '已删除': 'Deleted', '已保存到本机': 'Saved on this device',
      '此版本不支持粘贴导入': 'Paste import is not supported in this version'
    },

    'zh-TW': {
      '小说': '小說', '文章': '文章', '日记': '日記', '大纲': '大綱', '阅读': '閱讀',
      '搜索': '搜尋', '统计': '統計', '更多': '更多', '亮度': '亮度', '返回': '返回',
      '取消': '取消', '保存': '儲存', '删除': '刪除', '关闭': '關閉', '确定': '確定',
      '编辑': '編輯', '复制': '複製', '完成': '完成', '新建': '新增', '添加': '新增',
      '重命名': '重新命名', '导出': '匯出', '导入': '匯入', '设置': '設定', '移除': '移除',
      '记录本': '記錄本', '今天': '今天', '最近记录': '最近記錄', '已保存': '已儲存',
      '日记': '日記', '周记': '週記', '月記': '月記', '月记': '月記', '自訂間隔': '自訂間隔',
      '排版': '排版', '專注': '專注', '专注': '專注', '字號': '字號', '字号': '字號',
      '行距': '行距', '正文字體': '正文字體', '正文字体': '正文字體',
      '写作功能库': '寫作功能庫', '便签': '便籤', '目标': '目標', '續寫輔助': '續寫輔助',
      '续写辅助': '續寫輔助', '我的閱讀器': '我的閱讀器', '我的阅读器': '我的閱讀器',
      '导入文章': '匯入文章', '閱讀設定': '閱讀設定', '阅读设置': '閱讀設定',
      '目錄': '目錄', '目录': '目錄', '書籤': '書籤', '书签': '書籤', '進度': '進度', '进度': '進度',
      '選擇檔案': '選擇檔案', '选择文件': '選擇檔案', '貼上文字': '貼上文字', '粘贴文本': '貼上文字',
      '正在匯入': '正在匯入', '正在导入': '正在匯入', '沒能匯入這個檔案': '沒能匯入這個檔案',
      '没能导入这个文件': '沒能匯入這個檔案', '休閒遊戲': '休閒遊戲', '休闲游戏': '休閒遊戲',
      '音樂創作': '音樂創作', '音乐创作': '音樂創作', '計算機': '計算機', '计算器': '計算機',
      '隱私鎖': '隱私鎖', '隐私锁': '隱私鎖', '協作與分享': '協作與分享', '协作与分享': '協作與分享',
      '標準': '標準', '标准': '標準', '科學': '科學', '科学': '科學', '換算': '換算', '换算': '換算',
      '創作時長': '創作時長', '创作时长': '創作時長', '字數': '字數', '字数': '字數',
      '設定': '設定', '設定': '設定', '深色模式': '深色模式', '護眼': '護眼', '护眼': '護眼',
      '跟隨系統': '跟隨系統', '跟随系统': '跟隨系統', '已複製': '已複製', '已复制': '已複製',
      '已刪除': '已刪除', '已删除': '已刪除'
    }
  };

  /* ================================================================== */
  /* 语言状态                                                          */
  /* ================================================================== */
  I.lang = function () {
    try {
      const s = global.Store && global.Store.state && global.Store.state.settings;
      return (s && s.language) || detect();
    } catch (e) { return detect(); }
  };

  function detect() {
    const n = (global.navigator && navigator.language) || ZH;
    if (/^zh-(TW|HK|MO)/i.test(n)) return 'zh-TW';
    if (/^zh/i.test(n)) return ZH;
    return 'en';
  }

  I.isZh = function () { return I.lang() === ZH; };

  /* ------------------------------------------------------------------
     动态文案：字数、进度、章节号这类「模板 + 数字」的句子。
     做法：把数字/日期挖成占位符 \u0000 再查表，命中后把数字填回去。
     例：'1234 字' → 形状 '\u0000 字' → '1234 words'
     ------------------------------------------------------------------ */
  const NUM = /(\d{4}-\d{2}-\d{2}|\d{4}\/\d{1,2}\/\d{1,2}|\d[\d,]*(?:\.\d+)?)/g;
  const PH = '\u0000';
  /* 混排句子（如「时长 0分 · 目标 1,000 字」）按分隔符拆段，逐段翻译再拼回 */
  const SEG_SPLIT = /(\s*[·|｜]\s*|，|；|：|\s\/\s|,\s|:\s|;\s)/;

  const TEMPLATES = {
    en: {
      [PH + ' 字']: PH + ' words', [PH + ' 个字']: PH + ' words', [PH + ' 字/时']: PH + ' words/hr',
      [PH + ' 本']: PH + ' books', [PH + ' 节']: PH + ' sections', [PH + ' 章节']: PH + ' chapters',
      [PH + ' 篇']: PH + ' entries', [PH + ' 篇日记']: PH + ' diary entries', [PH + ' 篇文章']: PH + ' articles',
      [PH + ' 篇记录']: PH + ' entries', [PH + ' 条']: PH + ' items', [PH + ' 条记录']: PH + ' entries',
      [PH + ' 条结果']: PH + ' results', [PH + ' 天']: PH + ' days', [PH + ' 分钟']: PH + ' min',
      [PH + ' 小时']: PH + ' hr', [PH + ' 秒']: PH + ' s', [PH + ' 项']: PH + ' items',
      [PH + ' 首']: PH + ' songs', [PH + ' 张']: PH + ' images', [PH + ' 张图片']: PH + ' images',
      [PH + ' 次']: PH + ' times', [PH + ' 处']: PH + ' matches', [PH + ' 个']: PH + ' items',
      [PH + ' 个作品']: PH + ' works', [PH + ' 个章节']: PH + ' chapters', [PH + ' 个节点']: PH + ' nodes',
      [PH + ' 个重点']: PH + ' highlights', [PH + ' 年']: PH + ' yr', [PH + ' 月']: PH + ' mo',
      [PH + ' 章']: PH + ' chapters', [PH + ' 部']: PH + ' works', [PH + ' 种']: PH + ' kinds',
      ['第 ' + PH + ' 章']: 'Chapter ' + PH, ['第 ' + PH + ' 节']: 'Section ' + PH,
      ['第 ' + PH + ' 篇']: 'Entry ' + PH, ['第 ' + PH + ' 小节']: 'Subsection ' + PH,
      ['第 ' + PH + ' 段']: 'Paragraph ' + PH,
      ['共 ' + PH + ' 字']: PH + ' words total', ['已读 ' + PH + '%']: PH + '% read',
      ['约剩 ' + PH + ' 分钟']: '~' + PH + ' min left', ['今日 ' + PH + ' 字']: 'Today ' + PH + ' words',
      ['目标 ' + PH]: 'Goal ' + PH, [PH + ' / ' + PH]: PH + ' / ' + PH,
      [PH + ' 年 ' + PH + ' 月']: PH + '-' + PH, [PH + ' 月 ' + PH + ' 日']: PH + '/' + PH,
      ['共 ' + PH + ' 节']: PH + ' sections', ['共 ' + PH + ' 章']: PH + ' chapters',
      ['共 ' + PH + ' 条']: PH + ' items', ['连续 ' + PH + ' 天']: PH + '-day streak',
      ['本书 ' + PH + ' 天']: PH + ' days in this book', ['本周 ' + PH + ' 篇']: PH + ' this week',
      ['本月 ' + PH + ' 篇']: PH + ' this month', ['已记录 ' + PH + ' 篇']: PH + ' recorded',
      ['本周 ' + PH + ' 篇 · 本月 ' + PH + ' 篇']: PH + ' this week · ' + PH + ' this month',
      ['上次 ' + PH]: 'Last ' + PH, [PH + ' 字/分钟']: PH + ' wpm',
      ['今天 · ' + PH]: 'Today · ' + PH, [PH + ' 天前']: PH + ' days ago',
      ['已读 ' + PH + '% · 约剩 ' + PH + ' 分钟']: PH + '% read · ~' + PH + ' min left',
      ['第' + PH + '章']: 'Chapter ' + PH, ['第' + PH + '节']: 'Section ' + PH,
      ['时长 ' + PH + '分']: 'Duration ' + PH + ' min', [PH + '分']: PH + ' min',
      ['目标 ' + PH + ' 字']: PH + ' words goal', ['最近 ' + PH + ' 天']: 'Last ' + PH + ' days',
      ['最近 ' + PH + ' 天：' + PH + ' 字 · 活跃 ' + PH + ' 天']: 'Last ' + PH + ' days: ' + PH + ' words · active ' + PH + ' days',
      ['活跃 ' + PH + ' 天']: PH + ' active days', ['共 ' + PH + ' 位']: PH + ' people',
      ['导入 ' + PH + ' 篇']: PH + ' imported', [PH + ' 人在线']: PH + PH + ' online',
      ['已解锁 ' + PH] : PH + ' unlocked', [' 共 ' + PH + ' 首']: ' · ' + PH + ' songs',
      ['今日 ' + PH + ' 字 · ' + PH + '%']: 'Today ' + PH + ' words · ' + PH + '%',
      ['今日 ' + PH + ' 字 · ' + PH + '% · ' + PH]: 'Today ' + PH + ' words · ' + PH + '% · ' + PH,
      ['今日 ' + PH + ' 字 · ' + PH]: 'Today ' + PH + ' words · ' + PH
    },
    'zh-TW': {
      [PH + ' 字']: PH + ' 字', ['第 ' + PH + ' 章']: '第 ' + PH + ' 章', ['第 ' + PH + ' 节']: '第 ' + PH + ' 節',
      ['共 ' + PH + ' 字']: '共 ' + PH + ' 字', ['已读 ' + PH + '%']: '已讀 ' + PH + '%',
      ['约剩 ' + PH + ' 分钟']: '約剩 ' + PH + ' 分鐘', ['连续 ' + PH + ' 天']: '連續 ' + PH + ' 天',
      ['本书 ' + PH + ' 天']: '本書 ' + PH + ' 天', [PH + ' 篇']: PH + ' 篇', [PH + ' 条']: PH + ' 條',
      [PH + ' 个']: PH + ' 個', [PH + ' 分钟']: PH + ' 分鐘', [PH + ' 章节']: PH + ' 章節'
    }
  };

  /* ------------------------------------------------------------------
     扩展词条 / 扩展模板：由工具扫描全部界面收集来的文案，放在 js/i18n-extra.js。
     单独一个文件，方便继续补词条而不用动这里的核心逻辑。
     ------------------------------------------------------------------ */
  if (global.I18N_EXTRA) {
    const extra = global.I18N_EXTRA;
    ['en', 'zh-TW'].forEach((lg) => {
      if (extra[lg]) Object.assign(DICT[lg] || (DICT[lg] = {}), extra[lg]);
      const tpl = extra.templates && extra.templates[lg];
      if (tpl) Object.assign(TEMPLATES[lg] || (TEMPLATES[lg] = {}), tpl);
    });
  }

  /** 模板翻译：命中返回句子，未命中返回 null */
  function byTemplate(s, lang) {
    const t = TEMPLATES[lang];
    if (!t) return null;
    const nums = [];
    const shape = s.replace(NUM, (m) => { nums.push(m); return PH; });
    let hit = t[shape];
    if (hit === undefined) {
      /* 数字形状不完全一致时，再退一步：只把「数字开头的量词短语」当模板 */
      const m2 = shape.match(/^(\u0000(?:\.\d+)?\s*[\u4e00-\u9fff]{1,3})(.*)$/);
      if (m2 && t[m2[1]] !== undefined) hit = t[m2[1]] + m2[2];
    }
    if (hit === undefined || hit === null) return null;
    let i = 0;
    return String(hit).replace(new RegExp(PH, 'g'), () => (i < nums.length ? nums[i++] : ''));
  }

  /**
   * 混排句子逐段翻译：'时长 0分 · 目标 1,000 字' 这种「界面词 + 数字」拼起来的句子，
   * 整段查不到词条，就按 · ，：/ 拆开逐段查，再原样拼回去。
   * 只有当**至少两段**都能查到词条时才动手 —— 免得把用户写的句子翻掉一半。
   */
  function bySegments(s, lang) {
    const parts = s.split(SEG_SPLIT);
    if (parts.length < 3) return null;
    const d = DICT[lang];
    let hit = 0;
    for (let i = 0; i < parts.length; i += 2) {
      const seg = parts[i];
      const key = seg.trim();
      if (!key || key.length > 24 || !/[\u4e00-\u9fff]/.test(key)) continue;
      let out = d ? d[key] : undefined;
      if (out === undefined) {
        const tpl = byTemplate(key, lang);
        if (tpl !== null) out = tpl;
      }
      if (out === undefined || out === null || out === key) continue;
      parts[i] = seg.replace(key, out);
      hit++;
    }
    return hit >= 2 ? parts.join('') : null;
  }

  /**
   * 最长可翻译前缀：'今日 0 字 · 0% · 05:12' 这类「界面词 + 数字 + 后缀」的句子，
   * 整段查不到就找最长的那截能翻译的前缀，后面原样留着。
   * 关键保护：剩下的部分不能以汉字开头 —— 否则 '今天很好…' 这种用户写的句子
   * 会被翻掉前两个字。
   */
  function byHead(s, lang) {
    const d = DICT[lang];
    for (let end = s.length - 1; end > 1; end--) {
      const head = s.slice(0, end);
      const key = head.trim();
      if (!key || !/[\u4e00-\u9fff]/.test(key)) continue;
      /* 剩下的部分不能以汉字开头（去掉空白后判断）—— 否则 '同一 WiFi 下，一台设备…'
         这种句子会被翻掉前半截，变成半中半英 */
      const rest = s.slice(end);
      if (/[\u4e00-\u9fff]/.test(rest.replace(/^[\s，。！？、：；·]+/, '').charAt(0))) continue;
      let out = d ? d[key] : undefined;
      if (out === undefined) {
        const tpl = byTemplate(key, lang);
        if (tpl !== null) out = tpl;
      }
      if (out === undefined || out === null || out === key) continue;
      return head.replace(key, out) + rest;
    }
    return null;
  }

  /**
   * 前缀词条：'更新于 刚刚'、'继续：某本读物' 这种「界面词 + 用户内容/时间」的句子
   * 整段永远查不到，就按前缀翻，后面原样留着。
   */
  const PREFIXES = {
    en: {
      '上次记录：': 'Last entry: ', '更新于 ': 'Updated ', '写于 ': 'Written ', '上次 ': 'Last ',
      '继续：': 'Continue: ', '最新：': 'Latest: ', '最后编辑：': 'Last edited: '
    },
    'zh-TW': {
      '更新于 ': '更新於 ', '写于 ': '寫於 ', '继续：': '繼續：', '最新：': '最新：', '上次 ': '上次 '
    }
  };

  function byPrefix(s, lang) {
    const t = PREFIXES[lang];
    if (!t) return null;
    let best = null;
    Object.keys(t).forEach((k) => {
      if (s.length > k.length && s.indexOf(k) === 0 && (!best || k.length > best.length)) best = k;
    });
    return best ? t[best] + s.slice(best.length) : null;
  }

  /** 翻译一段文本；查不到就原样返回（宁可显示中文，也不要显示乱码键名） */
  I.t = function (text) {
    const lang = I.lang();
    if (lang === ZH) return text;
    const d = DICT[lang];
    const s = String(text == null ? '' : text);
    if (!d) return s;
    /* 整段 → 模板 → 混排分段 → 最长前缀，最后原样 */
    if (d[s] !== undefined) return d[s];
    const tpl = byTemplate(s, lang);
    if (tpl !== null) return tpl;
    const seg = bySegments(s, lang);
    if (seg !== null) return seg;
    const pre = byPrefix(s, lang);
    if (pre !== null) return pre;
    const head = byHead(s, lang);
    return head === null ? s : head;
  };

  /* ------------------------------------------------------------------
     简 → 繁 的逐字对照表：从词典里「简体键 / 繁体值」成对的条目推出来
     （只在长度相同、可以逐字对齐时取字）。
     用途有两个：
       1. 运行时拼出来的句子（统计行、时长行）没法进词典，繁体界面下就用它转；
       2. 给「英文有、繁体没有」的词条与数字模板自动补一份繁体。
     ------------------------------------------------------------------ */
  const S2T = (function () {
    const map = Object.create(null);
    const pairs = DICT['zh-TW'] || {};
    Object.keys(pairs).forEach((zh) => {
      const tw = pairs[zh];
      if (typeof tw !== 'string' || tw.length !== zh.length) return;
      for (let i = 0; i < zh.length; i++) {
        const a = zh.charAt(i), b = tw.charAt(i);
        if (a === b) continue;
        if (!/[\u4e00-\u9fff]/.test(a)) continue;
        if (map[a] === undefined) map[a] = b;
      }
    });
    return map;
  })();

  /* ------------------------------------------------------------------
     繁体用词表：字形转换只能把「导」变「導」，但台湾说的是「匯入」而不是「導入」。
     自动补繁体（以及运行时拼句）时，再过一遍这张用词表。
     人工翻译过的词条不经过这里，以人工稿为准。
     ------------------------------------------------------------------ */
  const TERMS = [
    ['導入', '匯入'], ['導出', '匯出'], ['默認', '預設'], ['搜索', '搜尋'],
    ['數據', '資料'], ['網絡', '網路'], ['視頻', '影片'], ['軟件', '軟體'],
    ['保存', '儲存'], ['自定義', '自訂'], ['信息', '資訊'], ['文件', '檔案'],
    ['界面', '介面'], ['加載', '載入'], ['鼠標', '滑鼠'], ['屏幕', '螢幕'],
    ['硬盤', '硬碟'], ['內存', '記憶體'], ['在線', '線上'], ['支持', '支援'],
    ['用戶', '使用者'], ['質量', '品質'], ['打印', '列印'], ['賬號', '帳號'],
    ['優化', '最佳化'], ['移動端', '行動裝置'], ['默認值', '預設值'], ['字體', '字型'],
    ['粘貼', '貼上'], ['剪切', '剪下'], ['撤銷', '復原'], ['重做', '取消復原'],
    ['刷新', '重新整理'], ['服務器', '伺服器'], ['端口', '連接埠'], ['視頻通話', '視訊通話']
  ];

  function applyTerms(s) {
    let out = s;
    for (let i = 0; i < TERMS.length; i++) out = out.split(TERMS[i][0]).join(TERMS[i][1]);
    return out;
  }

  /** 简体串 → 繁体串（先逐字转换，再过一遍用词表） */
  I.toTW = function (text) {
    const s = String(text == null ? '' : text);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charAt(i);
      out += S2T[c] !== undefined ? S2T[c] : c;
    }
    return applyTerms(out);
  };
  I.twCharCount = function () { return Object.keys(S2T).length; };

  /* ------------------------------------------------------------------
     繁体兜底：词条/模板「英文有、繁体没有」时，用字表自动补一份。
     人工翻译过的条目优先（上一步已经并进 DICT/TEMPLATES 了），
     只有转完和原文一样（本来就相同）的才跳过，不占体积。
     ------------------------------------------------------------------ */
  (function fillTraditional() {
    const twDict = DICT['zh-TW'] || (DICT['zh-TW'] = {});
    Object.keys(DICT.en).forEach((k) => {
      if (twDict[k] !== undefined) return;
      const v = I.toTW(k);
      if (v !== k) twDict[k] = v;
    });
    const twTpl = TEMPLATES['zh-TW'] || (TEMPLATES['zh-TW'] = {});
    Object.keys(TEMPLATES.en).forEach((k) => {
      if (twTpl[k] !== undefined) return;
      /* 只处理中文形状的模板：模板值可能已经是英文，不能拿来转 */
      const v = I.toTW(k);
      if (v !== k) twTpl[k] = v;
    });
  })();

  /* ================================================================== */
  /* DOM 自动翻译                                                      */
  /* ================================================================== */
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1 };
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  /* 用户自己的内容绝不翻译：阅读正文、便签、大纲节点文字、协作聊天、任何可编辑区 */
  const SKIP_SEL = '.reader-stage, .user-text, .km-text, .ot-text, .chat-text, .collab-msg, .prose, .preview, [contenteditable="true"]';
  /* 明确标记「不要翻译」的地方：语言名称（简体中文 / English / 繁體中文）、
     用户名、状态、专属码这类专有名词 —— 选了英文也不该把「简体中文」写成 Simplified Chinese */
  const SKIP_ATTR_SEL = '[data-i18n-skip], [data-i18n-skip] *';

  function isSkipNode(el) {
    if (SKIP_TAGS[el.tagName]) return true;
    if (el.isContentEditable) return true;
    if (!el.matches) return false;
    try {
      if (el.matches(SKIP_ATTR_SEL)) return true;      /* 自己标了 data-i18n-skip */
      if (el.closest && el.closest('[data-i18n-skip]')) return true;
      return el.matches(SKIP_SEL);
    } catch (e) { return false; }
  }

  /**
   * 单个汉字的界面元素（日历星期表头、天气小圆片）没法进词典 —— 一个字的词条
   * 会和用户自己写的「一」「日」「雨」这类内容撞车。用 data-i18n-group="wx:3"
   * 标出「分组:序号」，交给这里按语言取表。
   */
  const GROUPS = {
    wd: {
      en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      'zh-TW': ['一', '二', '三', '四', '五', '六', '日']
    },
    wx: {
      en: ['Sunny', 'Cloudy', 'Overcast', 'Rain', 'Snow', 'Windy'],
      'zh-TW': ['晴', '多雲', '陰', '雨', '雪', '風']
    },
    mood: {
      'zh-TW': ['平靜', '開心', '充實', '疲憊', '低落', '焦慮', '期待', '感動']
    },
    /* 统计页热力图的两端刻度：单字，不能进词典 */
    legend: {
      en: ['Less', 'More'],
      'zh-TW': ['少', '多']
    },
    /* 日历里「调休上班」的小字标记：单字，不能进词典 */
    swap: {
      en: ['W'],
      'zh-TW': ['班']
    },
    /* 写作页里单独一个「字」当单位用 */
    unit: {
      en: ['words'],
      'zh-TW': ['字']
    }
  };

  function translateGrouped(el) {
    if (!el.dataset || !el.dataset.i18nGroup) return 0;
    const bits = String(el.dataset.i18nGroup).split(':');
    const table = GROUPS[bits[0]] && GROUPS[bits[0]][I.lang()];
    const word = table && table[Number(bits[1])];
    if (!word) return 0;
    const node = el.firstChild;
    if (!node || node.nodeType !== 3 || node.nodeValue === word) return 0;
    if (node.__i18nOrig === undefined) node.__i18nOrig = node.nodeValue;
    node.__i18nOut = word;
    node.nodeValue = word;
    return 1;
  }

  /** 翻译一个文本节点；同时记下原文，切回中文时能原样还原 */
  function translateTextNode(node, d) {
    const raw = node.nodeValue;
    const key = raw.trim();
    if (!key) return 0;
    let out = null;
    if (d[key] !== undefined) out = d[key];
    else {
      const tpl = byTemplate(key, I.lang());
      if (tpl !== null) out = tpl;
      else {
        const seg = bySegments(key, I.lang());
        if (seg !== null) out = seg;
        else {
          const pre = byPrefix(key, I.lang());
          if (pre !== null) out = pre;
          else {
            const head = byHead(key, I.lang());
            if (head !== null) out = head;
          }
        }
      }
    }
    if (out === null || out === key) return 0;
    const next = raw.replace(key, out);
    if (next === raw) return 0;
    if (node.__i18nOrig === undefined) node.__i18nOrig = raw;
    node.__i18nOut = next;
    node.nodeValue = next;
    return 1;
  }

  /** 属性文案：placeholder / title / aria-label */
  function translateAttrs(el, d) {
    let n = 0;
    ATTRS.forEach((a) => {
      if (!el.getAttribute) return;
      const v = el.getAttribute(a);
      if (!v) return;
      let out = d[v];
      if (out === undefined) {
        const tpl = byTemplate(v, I.lang());
        if (tpl !== null) out = tpl;
      }
      if (out === undefined || out === null || out === v) return;
      const store = el.__i18nAttr || (el.__i18nAttr = {});
      if (store[a] === undefined) store[a] = v;
      el.setAttribute(a, out);
      n++;
    });
    return n;
  }

  /** 翻译一棵子树（文本节点 + 属性；数字模板同样处理） */
  function translateTree(root) {
    const lang = I.lang();
    if (lang === ZH) return restoreTree(root);
    const d = DICT[lang];
    if (!d) return 0;
    let n = 0;
    const walk = (el) => {
      if (!el) return;
      if (el.nodeType === 3) { n += translateTextNode(el, d); return; }
      if (el.nodeType !== 1) return;
      /* 输入框 / 文本域：正文不能翻，但 placeholder、aria-label 要翻 ——
         以前这里一并 return 了，于是「章节标题」「写点什么……」这类
         占位提示在英文界面里一直是中文。 */
      if (SKIP_TAGS[el.tagName]) { n += translateAttrs(el, d); return; }
      if (isSkipNode(el)) return;
      n += translateGrouped(el);
      n += translateAttrs(el, d);
      const kids = el.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.nodeType === 3) n += translateTextNode(c, d);
        else if (c.nodeType === 1) walk(c);
      }
    };
    walk(root);
    return n;
  }

  /**
   * 还原成中文原文（就地切换，不用刷新页面）。
   * 只还原「当前值确实是我们写进去的那句」的节点 —— 界面在这之后自己改过的文字不动。
   */
  function restoreTree(root) {
    let n = 0;
    const walk = (el) => {
      if (!el) return;
      if (el.nodeType === 3) {
        if (el.__i18nOrig !== undefined) {
          if (el.nodeValue === el.__i18nOut) { el.nodeValue = el.__i18nOrig; n++; }
          delete el.__i18nOrig; delete el.__i18nOut;
        }
        return;
      }
      if (el.nodeType !== 1) return;
      if (el.__i18nAttr) {
        const store = el.__i18nAttr;
        ATTRS.forEach((a) => {
          if (store[a] === undefined) return;
          if (el.getAttribute(a) === store[a]) return;    /* 已经被改回去了 */
          el.setAttribute(a, store[a]);
          n++;
        });
        delete el.__i18nAttr;
      }
      const kids = el.childNodes;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    };
    walk(root);
    return n;
  }

  let observer = null;
  let pending = null;
  let applied = false;

  /** 按当前语言重刷整个界面（切换语言时用，不需要刷新页面） */
  I.applyLang = function () {
    if (!document || !document.body) return 0;
    restoreTree(document.body);
    lastApplied = I.lang();
    if (I.lang() === ZH) return 0;
    applied = true;
    return translateTree(document.body);
  };

  /** 开始自动翻译：首次全量 + 后续监听新渲染/新写入的节点与属性 */
  I.start = function () {
    lastApplied = I.lang();
    if (I.lang() === ZH) {
      /* 中文：只需要把之前翻过去的还原回来 */
      restoreTree(document.body);
    } else {
      applied = true;
      translateTree(document.body);
    }
    if (observer) return;
    try {
      observer = new MutationObserver((muts) => {
        /* 合并成一次：视图切换时会一次性插入大量节点 */
        if (pending) { pending.muts = pending.muts.concat(muts); return; }
        pending = { muts: muts };
        requestAnimationFrame(() => {
          const batch = pending ? pending.muts : [];
          pending = null;
          const zh = I.lang() === ZH;
          if (zh ? false : !DICT[I.lang()]) return;
          /* 收集这一批里需要处理的根节点 */
          const jobs = [];
          batch.forEach((m) => {
            if (m.type === 'characterData') jobs.push(m.target);
            else if (m.type === 'attributes') jobs.push(m.target);
            else Array.prototype.forEach.call(m.addedNodes || [], (nd) => jobs.push(nd));
          });
          jobs.forEach((node) => {
            if (!node || !node.parentNode && node.nodeType === 3) return;
            if (zh) restoreTree(node);
            else translateTree(node);
          });
        });
      });
      observer.observe(document.body, {
        childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS
      });
    } catch (e) { /* 老浏览器没有也不影响主流程 */ }
  };

  /**
   * 先落盘再刷新。只在「就地切换失败」时兜底用 —— 早期版本切回中文必须刷新，
   * 现在改成记住每段原文、就地还原，切语言不再打断你正在写的东西。
   * 落盘这一步仍然重要：Store.setSetting 只是标记待保存，真正写 localStorage
   * 是延迟的（最长 20 秒），直接 reload 会把刚改的语言丢掉。
   */
  function flushThenReload() {
    const doReload = () => { try { location.reload(); } catch (e) { /* noop */ } };
    try {
      if (global.Store.flushNow) {
        const p = global.Store.flushNow();
        if (p && typeof p.then === 'function') { p.then(doReload).catch(doReload); return; }
      } else if (global.Store.flushLocal) {
        global.Store.flushLocal();
      }
    } catch (e) { /* 落盘失败也要能切语言 */ }
    doReload();
  }

  I.setLang = function (lang, opts) {
    const o = opts || {};
    try {
      global.Store.setSetting('language', lang);
    } catch (e) { /* noop */ }
    lastApplied = lang;
    try { global.Store.flushLocal && global.Store.flushLocal(); } catch (e) { /* noop */ }
    /* 测试模式：由调用方自己决定什么时候检查 */
    if (o.test) return;
    /* 就地切换：记住原文 → 还原 → 按新语言重翻，全程不刷新页面 */
    try {
      if (!observer) I.start(); else I.applyLang();
    } catch (e) {
      if (!o.noReload) flushThenReload();
      return;
    }
    if (o.reload) flushThenReload();       /* 需要彻底重来时仍可显式要求刷新 */
  };

  /**
   * 设置变更后立即让语言生效。
   * 由 app.js 在启动完成后注册；没有它的话，改语言必须手动刷新才生效。
   */
  I.watch = function () {
    if (watchInstalled) return;
    watchInstalled = true;
    try {
      global.Store.subscribe(() => {
        const want = I.lang();
        if (want === lastApplied) return;
        lastApplied = want;
        /* 测试模式：由测试自己决定何时检查，不要在这里重刷界面 */
        if (I.testMode) return;
        try {
          if (!observer) I.start(); else I.applyLang();
        } catch (e) { flushThenReload(); }
      });
    } catch (e) { /* Store 没有 subscribe 也不影响 */ }
  };
  let watchInstalled = false;
  let lastApplied = null;

  /** 语言切换器（设置页用） */
  I.selector = function () {
    const U = global.U;
    const wrap = U.el('div.field');
    const title = U.el('label', { text: I.lang() === ZH ? '界面语言' : 'Language' });
    /* 语言名称永远保持原样：简体中文 / English / 繁體中文 换到哪种语言都不变，
       不然英文界面里会出现「Simplified Chinese」这种把名字也翻掉的情况 */
    const sel = U.el('select.font-sel', { dataset: { i18nSkip: '1' } }, I.LANGS.map((l) => U.el('option', {
      text: l.native, value: l.id, selected: I.lang() === l.id
    })));
    const note = U.el('div.field-note');
    const refreshNote = () => {
      note.textContent = I.lang() === ZH
        ? '切换后界面立即变成所选语言，不用刷新，也不会动你写的正文。'
        : (I.lang() === 'zh-TW'
          ? '切換後介面立即變成所選語言，不用重新整理，也不會動你寫的正文。'
          : 'Switches instantly — no reload, and your own writing is never translated.');
    };
    refreshNote();
    sel.addEventListener('change', () => {
      I.setLang(sel.value);
      title.textContent = I.lang() === ZH ? '界面语言' : 'Language';
      refreshNote();
    });
    U.append(wrap, title);
    U.append(wrap, sel);
    U.append(wrap, note);
    return wrap;
  };

  I.dictSize = function (lang) { return Object.keys(DICT[lang || 'en'] || {}).length; };

  /**
   * 诊断用（tools/i18n-coverage.js）：这句是不是「英文词条有、繁体词条缺」的漏网之鱼。
   * 只要中文原文在英文词典里、繁体词典里却没有，就说明该补繁体了。
   */
  I.twGap = function (text) {
    const s = String(text == null ? '' : text);
    if (!s) return false;
    const tw = DICT['zh-TW'] || {};
    if (tw[s] !== undefined) return false;
    /* 只有「转成繁体后确实不一样」才算缺繁体：
       '1 章'、'朱砂' 这种简繁同形的本来就该保持原样 */
    if (I.toTW(s) === s) return false;
    return DICT.en[s] !== undefined || !!byTemplate(s, 'en') || !!byTemplate(s, 'zh-TW');
  };

  /** 诊断用：这段文本在词典里完全查不到（多半是用户内容或运行时拼出来的） */
  I.unknown = function (text) {
    const s = String(text == null ? '' : text);
    if (!s) return true;
    const d = DICT[I.lang()];
    if (d && d[s] !== undefined) return false;
    if (byTemplate(s, I.lang()) !== null) return false;
    return true;
  };

  global.I18N = I;
})(window);
