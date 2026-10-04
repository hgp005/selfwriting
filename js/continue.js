/* ==========================================================================
   selfwriting · continue.js
   续写辅助：分析已有文风与人物，生成可选的后续段落
   --------------------------------------------------------------------------
   ⚠️ 如实说明：这里**不是 AI 生成**（本应用离线、当前环境没有语言模型接口），
   而是「本地启发式续写」：
     · 从你已写的内容里提取人物名、句式节奏、常用连接词
     · 从大纲节点取「接下来该发生什么」的方向
     · 按「动作 / 对白 / 心理 / 环境」四类骨架，套用你的句式生成候选段落
   它的定位是**打破卡壳的起头器**：给你几个能接着往下写的句子，
   而不是替你写完一部小说。生成结果一律先给候选，由你选择或修改后才插入正文。
   ========================================================================== */
(function (global) {
  'use strict';

  const U = global.U;
  const CT = {};

  /* ================================================================== */
  /* 1. 文本分析                                                        */
  /* ================================================================== */
  /** 从正文里猜人物名：中文姓名最常见的是 2–3 字，且反复出现 */
  CT.detectNames = function (text, limit) {
    const src = String(text || '');
    const counts = Object.create(null);
    /* 常见姓氏，用来降低误判（避免把「自己」「时候」当人名） */
    const SURNAME = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭林钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫';
    /* 容易与「姓+字」混淆的常用词，直接排除 */
    const STOP = {
      '自己': 1, '时候': 1, '什么': 1, '没有': 1, '知道': 1, '这样': 1, '那样': 1,
      '于是': 1, '但是': 1, '因为': 1, '所以': 1, '已经': 1, '还是': 1, '这里': 1,
      '那里': 1, '现在': 1, '一个': 1, '不是': 1, '就是': 1, '可以': 1, '应该': 1,
      '一下': 1, '起来': 1, '出来': 1, '过来': 1, '上去': 1, '下来': 1,
      '高兴': 1, '喜欢': 1, '生气': 1, '着急': 1, '放心': 1, '担心': 1, '安心': 1,
      '沉默': 1, '微微': 1, '轻轻': 1, '慢慢': 1, '渐渐': 1, '忽然': 1, '突然': 1
    };
    /*
     * 人名判定用两个证据，避免造出假人物（假名字会直接污染续写句子）：
     *   证据 A：后面紧跟「动作/说话」类动词（名字 + 动词是中文最常见的句式）
     *   证据 B：同一个词反复出现
     * 只按「姓 + 1 字」取（2 字人名最常见）；3 字名宁可漏掉。
     */
    const ACTS = '说问答叫喊笑笑哭看听想走站坐跑起转点摇抬低皱停回望盯抓拿放推拉开门点头摇头挥手叹嗯哦啊';
    const re = new RegExp('([' + SURNAME + '])([\\u4e00-\\u9fa5])(?=[' + ACTS + '])', 'g');
    let m;
    const byAction = Object.create(null);
    while ((m = re.exec(src))) {
      const name = m[1] + m[2];
      if (STOP[name]) continue;
      byAction[name] = (byAction[name] || 0) + 1;
    }
    /* 证据 B：任意位置的 2 字「姓+字」重复出现（至少两次） */
    const re2 = new RegExp('([' + SURNAME + '])([\\u4e00-\\u9fa5])', 'g');
    const byRepeat = Object.create(null);
    while ((m = re2.exec(src))) {
      const name = m[1] + m[2];
      if (STOP[name]) continue;
      byRepeat[name] = (byRepeat[name] || 0) + 1;
    }
    Object.keys(byAction).forEach((n) => { counts[n] = (counts[n] || 0) + byAction[n] * 2; });
    Object.keys(byRepeat).forEach((n) => {
      if (byRepeat[n] >= 2) counts[n] = (counts[n] || 0) + byRepeat[n];
    });
    /* 英文名：首字母大写、反复出现、且不是常见词 */
    const EN_STOP = /^(The|And|But|Chapter|Part|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|He|She|They|It|You|We|I|His|Her|Mr|Mrs|Ms|Dr|Yes|No|Well|Then|There|Here|What|When|Where|Why|How|God|Lord|Sir|Madam)$/;
    const reEn = /\b([A-Z][a-z]{2,12})\b/g;
    while ((m = reEn.exec(src))) {
      const w = m[1];
      if (EN_STOP.test(w)) continue;
      counts[w] = (counts[w] || 0) + 1;
    }
    /*
     * 阈值：长文里只认反复出现的（≥2 次）避免误判；
     * 短文（比如刚写了几段）里出现一次也算，否则一个人名都识别不出来。
     */
    const short = src.length < 1200;
    const list = Object.keys(counts)
      .filter((n) => counts[n] >= (short ? 1 : 2))
      .sort((a, b) => counts[b] - counts[a] || b.length - a.length)
      .slice(0, limit || 4);
    return list;
  };

  /** 说话动词 / 动作 / 心理 的常用词，作为骨架填充 */
  const SAY = ['说', '问', '答', '低声道', '开口', '笑了笑', '沉默了一会儿才说'];
  const ACT = ['站起身', '转过身', '停下脚步', '把手里的东西放下', '看向窗外', '往前走了一步', '皱了皱眉'];
  const FEEL = ['心里忽然一紧', '没来由地觉得不安', '想起很久以前的事', '说不上来为什么，就是不想再问', '忽然明白了什么', '觉得有些疲惫'];
  const SCENE = ['风从窗缝里挤进来', '天色一点点暗下去', '远处传来很轻的声响', '雨还在下', '灯光落在地板上', '屋子里安静得能听见呼吸'];
  const LINK = ['过了很久，', '半晌，', '第二天，', '又过了几天，', '等到他再想起这件事的时候，', '就在这时，'];

  /** 取最后一段作为「当前状态」，判断是否以对白结尾 */
  function tailInfo(text) {
    const paras = String(text || '').split(/\n{2,}/).filter((p) => p.trim());
    const last = paras.length ? paras[paras.length - 1].trim() : '';
    const isDialogue = /[「“"][^」”"]*[」”"]\s*$/.test(last);
    const isQuestion = /[？?]\s*[」”"]?\s*$/.test(last);
    /* 句子长短：平均句长决定「节奏」 */
    const sentences = last.split(/[。！？!?…]+/).filter((s) => s.trim());
    const avg = sentences.length ? last.length / sentences.length : 20;
    return { last: last, isDialogue: isDialogue, isQuestion: isQuestion, avg: avg, count: paras.length };
  }

  function pick(arr, seed) {
    const i = Math.floor(seed * arr.length) % arr.length;
    return arr[i < 0 ? 0 : i];
  }

  /* ================================================================== */
  /* 2. 生成候选                                                        */
  /* ================================================================== */
  /**
   * CT.generate(text, opt) → [{ text, kind }]
   * opt: { direction: 大纲方向文本, hint: 用户补充的方向, names: 人物, count: 生成几个 }
   */
  CT.generate = function (text, opt) {
    const o = opt || {};
    const src = String(text || '');
    const names = (o.names && o.names.length) ? o.names : CT.detectNames(src, 3);
    const who = names[0] || '他';
    const other = names[1] || '她';
    const info = tailInfo(src);
    const out = [];
    const n = Math.max(1, Math.min(6, o.count || 3));
    /* 用「当前字数 + 时间」做种子：同样的输入给同样的候选，不会每次乱跳 */
    let seed = (src.length % 997) / 997 + (o.hint ? o.hint.length / 100 : 0);

    /* 大纲/提示语作为方向锚点 */
    const dir = String(o.hint || o.direction || '').trim();
    const dirLine = dir ? (dir.length > 40 ? dir.slice(0, 40) + '……' : dir) : '';

    const nextSeed = () => { seed = (seed * 9301 + 49297) % 233280 / 233280; return seed; };
    /* 中文名后面不加空格，英文名要加 —— 否则会写出「林晚 转过身」 */
    const nm = (x) => (/[\u4e00-\u9fa5]$/.test(x) ? x : x + ' ');

    for (let i = 0; i < n; i++) {
      const s1 = nextSeed(), s2 = nextSeed(), s3 = nextSeed();
      let kind, para;
      /* 四种骨架轮流来，保证候选之间差异明显，方便挑 */
      const mode = i % 4;
      if (mode === 0) {
        kind = '动作推进';
        para = nm(who) + pick(ACT, s1) + '。'
          + (dirLine ? '关于「' + dirLine + '」，' + who + '心里其实早有打算。' : pick(FEEL, s2) + '。')
          + pick(LINK, s3) + nm(who) + pick(SAY, s1 + 0.3) + '：「这件事，得从头说起了。」';
      } else if (mode === 1) {
        kind = '对白承接';
        para = (info.isDialogue ? '' : pick(SCENE, s1) + '。')
          + '「' + (info.isQuestion ? '你先别急' : '我知道') + '，」' + nm(who) + pick(SAY, s2)
          + '，「' + (dirLine ? dirLine + '。' : '有些事不是现在能说清楚的。') + '」'
          + nm(other) + '没有再追问，只是' + pick(ACT, s3) + '。';
      } else if (mode === 2) {
        kind = '心理描写';
        para = pick(FEEL, s1) + '。' + who + '想起' + (dirLine ? dirLine : '刚才那句话')
          + '，忽然觉得' + pick(['事情没那么简单', '自己一直在绕圈子', '有些话说出口就收不回来了', '该做个决定了'], s2)
          + '。' + pick(SCENE, s3) + '，' + nm(who) + pick(ACT, s2 + 0.5) + '。';
      } else {
        kind = '场景转场';
        para = pick(LINK, s1) + pick(SCENE, s2) + '。'
          + (dirLine ? '关于' + dirLine + '，' + other + '始终没有提起。' : other + '一直没说话。')
          + nm(who) + pick(ACT, s3) + '，' + pick(SAY, s1 + 0.7) + '：「你打算怎么办？」';
      }
      out.push({ text: para, kind: kind });
    }
    return out;
  };

  /* ================================================================== */
  /* 3. 从外部作品载入并一键续写                                        */
  /* ================================================================== */
  /**
   * 「导入外部文章/小说 → 一键续写」：
   * 把导入的文本接到指定作品末尾（或新建作品），再打开续写面板。
   */
  CT.appendAsChapter = function (novelId, title, content) {
    const n = global.Store.findNovel(novelId);
    if (!n) return null;
    const ch = global.Store.addChapter(novelId, { title: title || '导入的续写素材' });
    global.Store.setChapterContent(novelId, ch.id, String(content || ''));
    return ch;
  };

  CT.stats = function (text) {
    const info = tailInfo(text);
    return {
      names: CT.detectNames(text, 4),
      chars: String(text || '').length,
      paragraphs: info.count,
      dialogueEnding: info.isDialogue,
      avgSentence: Math.round(info.avg)
    };
  };

  global.Continue = CT;
})(window);
