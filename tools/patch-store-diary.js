/* 开发用：给 store.js 加日记收藏 / 跨日期日记 / 读物收藏 的接口 */
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'js', 'store.js');
let s = fs.readFileSync(file, 'utf8');

/* 1) 日记日期兜底改用「随时区算出的今天」 */
const old1 = `  function clampDiaryDate(key) {
    const today = U.dateKey();`;
const new1 = `  function clampDiaryDate(key) {
    const today = U.today ? U.today() : U.dateKey();`;
if (s.split(old1).length - 1 !== 1) { console.log('[1] 匹配异常'); process.exit(1); }
s = s.replace(old1, new1);

/* 2) 新增接口：日记收藏、跨日期日记、读物收藏；插在「参与者」一节之前 */
const anchor = `    /* --- 参与者（多人创作） --- */`;
const add = `    /* --- 日记收藏（日历上长按收藏的日子） --- */
    toggleDiaryFav(bookId, dateKey) {
      let on = false;
      commit((s) => {
        const b = findDiary(bookId);
        if (!b) return;
        if (!Array.isArray(b.favs)) b.favs = [];
        const i = b.favs.indexOf(dateKey);
        if (i >= 0) b.favs.splice(i, 1);
        else { b.favs.push(dateKey); b.favs.sort(); on = true; }
      }, { kind: 'diary:fav', itemId: bookId });
      return on;
    },

    isDiaryFav(bookId, dateKey) {
      const b = findDiary(bookId);
      return !!(b && Array.isArray(b.favs) && b.favs.indexOf(dateKey) >= 0);
    },

    diaryFavs(bookId) {
      const b = findDiary(bookId);
      return (b && Array.isArray(b.favs)) ? b.favs.slice() : [];
    },

    /**
     * 跨日期的一篇日记（长按日期后选一段日子，写「这几天」的专属日记）。
     * 数据上仍是一条记录，额外记下 fromKey / toKey，界面上显示成日期范围。
     */
    addDiaryRange(bookId, fromKey, toKey, data) {
      const d = data || {};
      const from = clampDiaryDate(fromKey);
      const to = clampDiaryDate(toKey);
      const a = from <= to ? from : to;
      const b2 = from <= to ? to : from;
      const en = {
        id: U.uid('en'),
        title: d.title || '',
        content: d.content || '',
        dateKey: b2,                     // 归到结束那天，日历上看得到
        fromKey: a,
        toKey: b2,
        range: true,
        multi: Array.isArray(d.participants) ? d.participants.length > 1 : !!d.multi,
        participants: Array.isArray(d.participants) ? d.participants.slice(0, 12) : [],
        mood: d.mood || '',
        weather: d.weather || '',
        tags: d.tags || [],
        images: d.images || [],
        author: d.author || '',
        words: U.words(d.content || ''),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      commit((s) => {
        const bk = findDiary(bookId);
        if (!bk) return;
        bk.entries.push(en);
        bk.entries.sort((x, y) => (x.dateKey < y.dateKey ? -1 : x.dateKey > y.dateKey ? 1 : x.createdAt - y.createdAt));
        bk.updatedAt = Date.now();
      }, { kind: 'diaryEntry:add', itemId: bookId, dateKey: en.dateKey });
      if (global.Stats) global.Stats.touch(state, 'diary', en.words, 0, { dateKey: en.dateKey });
      return en;
    },

    /* --- 读物收藏（书架封面上的爱心） --- */
    toggleLike(bookId) {
      let on = false;
      commit((s) => {
        const b = findBook(bookId);
        if (!b) return;
        b.liked = !b.liked;
        b.likedAt = b.liked ? Date.now() : 0;
        on = b.liked;
      }, { kind: 'book:like', itemId: bookId });
      return on;
    },

    isLiked(bookId) {
      const b = findBook(bookId);
      return !!(b && b.liked);
    },

${anchor}`;
if (s.split(anchor).length - 1 !== 1) { console.log('[2] 匹配异常'); process.exit(1); }
s = s.replace(anchor, add);

fs.writeFileSync(file, s, 'utf8');
console.log('store 接口已加, FFFD=' + s.includes('\uFFFD'));
