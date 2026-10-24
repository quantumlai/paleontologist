// 玩家代碼與排行榜（LootLocker 雲端版 + localStorage 離線備援）

const PLAYER_KEY = 'paleo.playerCode';
const BOARD_KEY = 'paleo.leaderboard';

// LootLocker 設定
const LL_DOMAIN = 'https://obijv3bs.api.lootlocker.com';
const LL_API_KEY = 'dev_0f50a2619b804c9b85faf30609aa8ffb';
const LL_BOARD_KEY = 'paleo_leaderboard';

const Player = {
  load: function() {
    try { return localStorage.getItem(PLAYER_KEY) || ''; } catch (e) { return ''; }
  },
  save: function(code) {
    try { localStorage.setItem(PLAYER_KEY, code); } catch (e) {}
  }
};

const Leaderboard = {
  _sessionToken: null,
  _playerId: null,
  _currentCode: null,

  _readLocal: function() {
    try { return JSON.parse(localStorage.getItem(BOARD_KEY)) || {}; } catch (e) { return {}; }
  },
  _writeLocal: function(board) {
    try { localStorage.setItem(BOARD_KEY, JSON.stringify(board)); } catch (e) {}
  },

  // 將任意中文字串轉為純英數 Hex，避免 % 等特殊符號觸發 LootLocker 400 錯誤
  _toSafeIdentifier: function(str) {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
      hex += str.charCodeAt(i).toString(16);
    }
    return 'paleo_user_' + hex;
  },

  _ensureSession: async function(code) {
    const cleanCode = (code || 'guest').trim();
    if (this._sessionToken && this._currentCode === cleanCode) {
      return;
    }

    const identifier = this._toSafeIdentifier(cleanCode);

    const res = await fetch(LL_DOMAIN + '/game/v2/session/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_key: LL_API_KEY,
        player_identifier: identifier,
        game_version: '1.0.0.0',
        development_mode: true
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('🚨 LootLocker 拒絕登入詳細原因:', errText);
      throw new Error('LootLocker login failed: ' + res.status);
    }
    const data = await res.json();

    this._sessionToken = data.session_token;
    this._playerId = data.player_id;
    this._currentCode = cleanCode;

    if (code && data.player_name !== cleanCode) {
      try {
        await fetch(LL_DOMAIN + '/game/player/name', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': this._sessionToken
          },
          body: JSON.stringify({ name: cleanCode })
        });
      } catch (e) {}
    }
  },

  _parseItem: function(item) {
    let meta = { games: 1, best: item.score };
    if (item.metadata) {
      try { meta = JSON.parse(item.metadata); } catch (e) {}
    }
    const playerName = (item.player && item.player.name) ? item.player.name : (this._currentCode || '無名氏');
    const bestScore = (meta.best !== undefined && meta.best !== null) ? meta.best : item.score;
    return {
      rank: item.rank,
      code: playerName,
      total: item.score,
      games: meta.games || 1,
      best: bestScore
    };
  },

  _fetchMember: async function(playerId) {
    const res = await fetch(
      LL_DOMAIN + '/game/leaderboards/' + LL_BOARD_KEY + '/member/' + playerId,
      { headers: { 'x-session-token': this._sessionToken } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.rank) return null;
    return this._parseItem(data);
  },

  submit: async function(code, correct) {
    const board = this._readLocal();
    const localRec = board[code] || { total: 0, games: 0, best: 0 };
    localRec.total += correct;
    localRec.games += 1;
    localRec.best = Math.max(localRec.best, correct);
    board[code] = localRec;
    this._writeLocal(board);

    try {
      await this._ensureSession(code);

      const existing = await this._fetchMember(this._playerId);
      const prevTotal = existing ? existing.total : 0;
      const prevGames = existing ? existing.games : 0;
      const prevBest = existing ? existing.best : 0;

      const newRec = {
        total: prevTotal + correct,
        games: prevGames + 1,
        best: Math.max(prevBest, correct)
      };

      const res = await fetch(
        LL_DOMAIN + '/game/leaderboards/' + LL_BOARD_KEY + '/submit',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': this._sessionToken
          },
          body: JSON.stringify({
            score: newRec.total,
            metadata: JSON.stringify({ games: newRec.games, best: newRec.best })
          })
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error('🚨 LootLocker 上傳分數失敗原因:', errText);
        throw new Error('Submit failed: ' + res.status);
      }
      return {
        code: code,
        total: newRec.total,
        games: newRec.games,
        best: newRec.best
      };
    } catch (err) {
      console.warn('LootLocker 連線異常，改用本地紀錄:', err);
      return {
        code: code,
        total: localRec.total,
        games: localRec.games,
        best: localRec.best
      };
    }
  },

  top: async function(n) {
    if (n === undefined) n = 10;
    try {
      if (!this._sessionToken) {
        await this._ensureSession(Player.load() || 'guest');
      }
      const count = (n === Infinity) ? 100 : n;
      const res = await fetch(
        LL_DOMAIN + '/game/leaderboards/' + LL_BOARD_KEY + '/list?count=' + count,
        { headers: { 'x-session-token': this._sessionToken } }
      );

      if (!res.ok) throw new Error('Get top failed: ' + res.status);
      const data = await res.json();
      const rawItems = data.items || [];
      const self = this;
      const items = rawItems.map(function(item) { return self._parseItem(item); });

      items.sort(function(a, b) { return (b.total - a.total) || (a.games - b.games); });
      return items.slice(0, count).map(function(r, i) {
        return {
          rank: i + 1,
          code: r.code,
          total: r.total,
          games: r.games,
          best: r.best
        };
      });
    } catch (err) {
      console.warn('LootLocker 讀取異常，改用本地排行榜:', err);
      const localData = this._readLocal();
      return Object.entries(localData)
        .map(function(entry) {
          const k = entry[0];
          const v = entry[1];
          return { code: k, total: v.total, games: v.games, best: v.best };
        })
        .sort(function(a, b) { return (b.total - a.total) || (a.games - b.games); })
        .slice(0, n)
        .map(function(r, i) {
          return { rank: i + 1, code: r.code, total: r.total, games: r.games, best: r.best };
        });
    }
  },

  rankOf: async function(code) {
    try {
      await this._ensureSession(code);
      const member = await this._fetchMember(this._playerId);
      if (member) {
        return {
          rank: member.rank,
          code: code,
          total: member.total,
          games: member.games,
          best: member.best
        };
      }
      return null;
    } catch (err) {
      const all = await this.top(100);
      return all.find(function(r) { return r.code === code; }) || null;
    }
  }
};