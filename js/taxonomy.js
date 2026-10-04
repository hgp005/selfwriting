/* ==========================================================================
   selfwriting · taxonomy.js
   模块分类体系：小说题材 / 文章类型 / 记录周期 / 读物类型
   分类用于书架筛选与条目归属，与「成就」「统计」互不影响。
   ========================================================================== */
(function (global) {
  'use strict';

  const T = {};

  /* ---------------- 小说：网络文学 + 传统文学 ---------------- */
  T.NOVEL = {
    groups: [
      { id: 'net', name: '网络文学', items: ['玄幻', '奇幻', '武侠', '仙侠', '都市', '现实', '历史', '军事', '科幻', '悬疑', '推理', '游戏', '体育', '轻小说', '同人'] },
      { id: 'lit', name: '传统文学', items: ['纯文学', '严肃文学', '短篇集', '散文体', '书信体', '剧本'] },
      { id: 'other', name: '其它', items: ['系列', '合集', '草稿', '未分类'] }
    ]
  };
  T.NOVEL_ALL = [].concat.apply([], T.NOVEL.groups.map((g) => g.items));
  T.NOVEL_DEFAULT = '未分类';

  /** 兼容早期数据：长篇小说 / 短篇集 等旧值映射到新分类 */
  T.NOVEL_LEGACY = { '长篇小说': '未分类', '短篇集': '短篇集', '系列': '系列', '同人': '同人', '草稿': '草稿' };

  T.normalizeNovelCategory = function (c) {
    if (!c) return T.NOVEL_DEFAULT;
    if (T.NOVEL_ALL.indexOf(c) >= 0) return c;
    return T.NOVEL_LEGACY[c] || T.NOVEL_DEFAULT;
  };

  /* ---------------- 文章 ---------------- */
  T.ARTICLE = {
    groups: [
      { id: 'main', name: '常用', items: ['随笔', '散文', '杂文', '读书笔记', '书评', '影评', '观后感', '教程', '攻略'] },
      { id: 'work', name: '工作 / 学习', items: ['报告', '总结', '计划', '演讲稿', '论文', '笔记', '复盘'] },
      { id: 'life', name: '生活 / 创作', items: ['书信', '文案', '评论', '诗', '歌词', '脚本', '其它'] }
    ]
  };
  T.ARTICLE_ALL = [].concat.apply([], T.ARTICLE.groups.map((g) => g.items));
  T.ARTICLE_DEFAULT = '随笔';

  /* ---------------- 记录本（日记 / 周记 / 月记 / 自定义） ---------------- */
  T.DIARY_KIND = {
    groups: [
      { id: 'period', name: '记录周期', items: [
        { id: 'daily', label: '日记（每天）', hint: '按天记录，日历上每天可写多篇' },
        { id: 'weekly', label: '周记（每周）', hint: '自动汇总本周所有记录' },
        { id: 'monthly', label: '月记（每月）', hint: '自动汇总当月所有记录' },
        { id: 'custom', label: '自定义间隔', hint: '每隔 N 天记录一次，到期会提醒' }
      ] }
    ]
  };
  T.DIARY_SUBJECT = ['生活', '工作', '学习', '读书', '旅行', '锻炼', '心情', '灵感', '梦境', '其它'];

  /* ---------------- 读物 ---------------- */
  T.BOOK = {
    groups: [
      { id: 'main', name: '类型', items: ['长篇小说', '短篇集', '散文', '诗歌', '历史', '传记', '社科', '科普', '哲学', '经管', '教材', '文档', '网文', '其它'] }
    ]
  };
  T.BOOK_ALL = [].concat.apply([], T.BOOK.groups.map((g) => g.items));
  T.BOOK_DEFAULT = '其它';

  /* ---------------- 通用工具 ---------------- */
  /** 把 [{groups:[{id,name,items}]}] 摊平成 select 用的 <optgroup> 数据 */
  T.forSelect = function (def, current, fallback) {
    const out = [];
    const cur = current || fallback || '';
    def.groups.forEach((g) => {
      out.push({
        group: g.name,
        items: g.items.map((it) => {
          const value = typeof it === 'string' ? it : it.id;
          const label = typeof it === 'string' ? it : it.label;
          return { value: value, label: label, selected: value === cur };
        })
      });
    });
    return out;
  };

  /** 生成 <select>（含 optgroup），并保证当前值一定在列表里 */
  T.select = function (def, current, fallback) {
    const U = global.U;
    const cur = current || fallback || '';
    const sel = U.el('select.select');
    let found = false;
    def.groups.forEach((g) => {
      const og = U.el('optgroup', { label: g.name });
      g.items.forEach((it) => {
        const value = typeof it === 'string' ? it : it.id;
        const label = typeof it === 'string' ? it : it.label;
        const opt = U.el('option', { value: value, text: label });
        if (value === cur) { opt.selected = true; found = true; }
        og.appendChild(opt);
      });
      sel.appendChild(og);
    });
    if (!found && cur) {
      const og = U.el('optgroup', { label: '当前' });
      og.appendChild(U.el('option', { value: cur, text: cur, selected: true }));
      sel.insertBefore(og, sel.firstChild);
    }
    return sel;
  };

  global.Taxonomy = T;
})(window);
