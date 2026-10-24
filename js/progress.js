// 學習進度：記錄每位玩家答過哪些知識題，讓刷題真的有成長
// - 新題優先：沒看過的題目先出
// - 錯題複習：上次答錯的題目，之後會再出來（每局最多 REVIEW_PER_GAME 題）
// - 知識圖鑑：統計「學會」的題數（最近一次答對就算學會），也分主題統計
// 存在這台電腦的瀏覽器（localStorage），用玩家代碼分開記錄。

const PROGRESS_KEY = 'paleo.progress';
const REVIEW_PER_GAME = 2;
const DEFAULT_TOPIC = '恐龍與古生物';

const topicOf = t => t.topic || DEFAULT_TOPIC;

const Progress = {
  _readAll() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) { return {}; }
  },
  _writeAll(all) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(all)); } catch (e) { /* 存不了就只是沒有進度紀錄 */ }
  },
  // 題目用題幹當 id，題庫增加或調整順序都不會影響舊紀錄
  _of(player) {
    return this._readAll()[player] || {};
  },

  // 選出這局要出的知識題，回傳 [{ ...題目, review: true/false }]
  pick(player, n) {
    const mine = this._of(player);
    const review = shuffle(TRIVIA.filter(t => mine[t.q] && !mine[t.q].mastered)).slice(0, Math.min(REVIEW_PER_GAME, n));
    const unseen = shuffle(TRIVIA.filter(t => !mine[t.q]));
    // 全部都看過了，就從「最久沒出現」的開始重複（包含超過複習名額的錯題）
    const seen = TRIVIA.filter(t => mine[t.q] && !review.includes(t))
      .sort((a, b) => mine[a.q].last - mine[b.q].last);
    const fresh = [...unseen, ...seen].slice(0, n - review.length);
    return shuffle([...review.map(t => ({ ...t, review: true })), ...fresh.map(t => ({ ...t, review: false }))]);
  },

  // 回傳這題「之前是否已經學會」，用來算這局新學會幾題
  record(player, q, correct) {
    const all = this._readAll();
    const mine = all[player] || (all[player] = {});
    const rec = mine[q] || { seen: 0, right: 0 };
    const wasMastered = !!rec.mastered;
    rec.seen += 1;
    if (correct) rec.right += 1;
    rec.mastered = correct;
    rec.last = Date.now();
    mine[q] = rec;
    this._writeAll(all);
    return wasMastered;
  },

  stats(player) {
    const mine = this._of(player);
    const topics = {};
    let seen = 0, mastered = 0;
    TRIVIA.forEach(t => {
      const name = topicOf(t);
      const s = topics[name] || (topics[name] = { total: 0, mastered: 0 });
      s.total += 1;
      if (mine[t.q]) seen += 1;
      if (mine[t.q] && mine[t.q].mastered) { mastered += 1; s.mastered += 1; }
    });
    return { total: TRIVIA.length, seen, mastered, topics };
  },
};
