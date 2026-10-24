// 遊戲流程：開場動畫 → 15 個難關 → 博物館展示 / 邪惡博士搶走化石

const PASS_SCORE = 12;
const TOTAL = 15;
const TRIVIA_COUNT = 7; // 第 8～14 關都是古生物知識題

const $ = sel => document.querySelector(sel);
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pickN = (arr, n) => shuffle(arr).slice(0, n);
const fmtSize = n => `約 ${n} 公尺`;

const state = { player: '', dino: null, questions: [], idx: 0, score: 0, answers: [], muted: false, submitted: null, learned: 0 };

/* ---------- 音效（WebAudio 合成，不需要音檔） ---------- */

let actx = null;
function tone(freq, dur, type = 'sine', when = 0, vol = 0.14) {
  if (state.muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + when;
    const osc = actx.createOscillator(), gain = actx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(actx.destination); osc.start(t); osc.stop(t + dur + 0.02);
  } catch (e) { /* 沒有音效也能玩 */ }
}
const SFX = {
  click: () => tone(700, 0.07, 'square', 0, 0.05),
  brush: () => tone(180 + Math.random() * 80, 0.08, 'triangle', 0, 0.06),
  correct: () => [523, 659, 784].forEach((f, i) => tone(f, 0.18, 'sine', i * 0.11)),
  wrong: () => { tone(330, 0.25, 'sawtooth', 0, 0.06); tone(247, 0.4, 'sawtooth', 0.22, 0.06); },
  win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', i * 0.14)),
  evil: () => [220, 208, 196, 185, 147].forEach((f, i) => tone(f, 0.3, 'sawtooth', i * 0.18, 0.07)),
};

/* ---------- 動畫用的可跳過計時 ---------- */

let skipping = false;
let wakeups = [];
const sleep = ms => new Promise(resolve => {
  if (skipping) return resolve();
  const t = setTimeout(resolve, ms);
  wakeups.push(() => { clearTimeout(t); resolve(); });
});
function beginAnim() { skipping = false; wakeups = []; }
function skipAnim() { skipping = true; wakeups.splice(0).forEach(f => f()); }

function confetti(container, count = 70) {
  const colors = ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#c77dff', '#ff9f45'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.6 + 's';
    p.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
    p.style.setProperty('--spin', (Math.random() * 720 - 360) + 'deg');
    container.appendChild(p);
    setTimeout(() => p.remove(), 4000);
  }
}

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}

/* ---------- 題目產生 ---------- */

function buildQuestions(d) {
  const others = DINOS.filter(x => x.id !== d.id);
  const families = [...new Set([...DINOS.map(x => x.family), ...EXTRA_FAMILIES])].filter(f => f !== d.family);
  const nameOf = x => x.alias ? `${x.name}（${x.alias}）` : x.name;
  const trivia = Progress.pick(state.player, TRIVIA_COUNT);
  const periodPicks = [d.period, ...pickN(PERIODS.filter(p => p !== d.period), 3)];

  const qs = [
    {
      stage: '化石鑑定', text: '仔細看看這塊化石！這是哪一種恐龍？', hint: `🔍 線索：${d.clue}`,
      answer: nameOf(d), options: shuffle([nameOf(d), ...pickN(others, 3).map(nameOf)]),
      explain: `這是${nameOf(d)}！${d.clue}`,
    },
    {
      stage: '判斷年代', text: `${d.name}生活在哪一個年代？`,
      answer: d.period,
      options: PERIODS.filter(p => periodPicks.includes(p)), // 依年代先後排列
      explain: `${d.name}生活在${d.period}（${d.periodDetail}）。恐龍的年代順序是：三疊紀 → 侏羅紀 → 白堊紀。`,
    },
    {
      stage: '生物分類①　目', text: `${d.name}屬於哪一個「目」？`,
      answer: d.order, options: shuffle(ORDERS),
      explain: `${d.name}屬於${d.order}。恐龍分成兩大類：蜥臀目（腰帶骨像蜥蜴）和鳥臀目（腰帶骨像鳥）。翼龍和蛇頸龍其實都不是恐龍喔！`,
    },
    {
      stage: '生物分類②　亞目／類群', text: `${d.name}是${d.order}裡的哪一類？`,
      answer: d.group, options: shuffle([d.group, ...pickN(Object.keys(GROUPS).filter(g => g !== d.group), 3)]),
      explain: `${d.name}屬於${d.group}：${GROUPS[d.group]}`,
    },
    {
      stage: '生物分類③　科', text: `${d.name}屬於哪一個「科」？`,
      answer: d.family, options: shuffle([d.family, ...pickN(families, 3)]),
      explain: `${d.name}屬於${d.family}。${d.familyInfo}完整分類：${d.order} → ${d.group} → ${d.family}。`,
    },
    {
      stage: '分布地區', text: `${d.name}的化石主要在哪裡被發現？`,
      answer: d.region, options: shuffle([d.region, ...pickN(REGIONS.filter(r => r !== d.region), 3)]),
      explain: `答案是${d.region}！${d.regionDetail}`,
    },
    (() => {
      const sizes = [d.size, ...pickN(SIZE_POOL.filter(s => Math.abs(Math.log(s / d.size)) > 0.28), 3)].sort((a, b) => a - b);
      return {
        stage: '測量尺寸', text: `${d.name}從頭到尾巴大約有多長？`,
        answer: fmtSize(d.size), options: sizes.map(fmtSize),
        explain: `${d.name}${fmtSize(d.size)}，${d.sizeCompare}`,
      };
    })(),
    ...trivia.map(t => ({
      stage: `小知識・${topicOf(t)}`, text: t.q, answer: t.a, options: shuffle([t.a, ...t.w]), explain: t.e,
      trivia: true, review: t.review, hint: t.review ? '🔁 複習題：上次這題答錯了，這次一定可以！' : '',
    })),
    {
      stage: '最終關：學名', text: `最後一關！${d.name}的「學名」是哪一個？`,
      hint: '💡 學名是科學家用拉丁文取的正式名字，全世界都通用。',
      answer: d.sci, options: shuffle([d.sci, ...pickN(others, 3).map(x => x.sci)]), sci: true,
      explain: `${d.name}的學名是「${d.sci}」，意思是「${d.sciMeaning}」。`,
    },
  ];
  return qs;
}

/* ---------- 標題畫面 ---------- */

function renderTitle() {
  $('#title-boy').innerHTML = boySVG('happy');
  $('#title-doctor').innerHTML = doctorSVG('normal');
}

/* ---------- 開場：挖化石 ---------- */

async function playIntro() {
  beginAnim();
  show('intro');
  const stage = $('#intro .stage');
  $('#btn-identify').classList.add('hidden');
  stage.innerHTML = `
    <div class="sky"></div><div class="sun"></div><div class="hills"></div><div class="ground"></div>
    <div class="sign">挖掘現場<br><small>DIG SITE</small></div>
    <div class="dig-site">
      <div class="fossil-slot">${fossilSVG(state.dino.id)}</div>
      ${[1, 2, 3, 4, 5, 6].map(i => `<div class="sand s${i}"></div>`).join('')}
      <div class="sparkles"></div>
    </div>
    <div class="actor boy-actor offstage-left">${boySVG('normal')}</div>
    <div class="caption"></div>
    <button class="skip-btn" type="button">跳過動畫 ⏭</button>`;
  stage.querySelector('.skip-btn').onclick = skipAnim;
  const boy = stage.querySelector('.boy-actor');
  const caption = stage.querySelector('.caption');
  const site = stage.querySelector('.dig-site');

  caption.textContent = '今天，小小古生物學家來到了挖掘現場……';
  await sleep(300);
  boy.classList.remove('offstage-left');
  boy.classList.add('walking');
  await sleep(1700);
  boy.classList.remove('walking');

  caption.textContent = '刷刷刷～小心地把沙土刷掉！';
  boy.innerHTML = boySVG('dig');
  const dust = setInterval(() => {
    if (skipping) return;
    const p = document.createElement('i');
    p.className = 'dust';
    p.style.left = 4 + Math.random() * 30 + '%';
    p.style.top = 30 + Math.random() * 50 + '%';
    p.style.setProperty('--dx', (Math.random() * 120 - 20) + 'px');
    p.style.setProperty('--dy', -(40 + Math.random() * 80) + 'px');
    site.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }, 70);
  for (const sand of site.querySelectorAll('.sand')) {
    await sleep(650);
    sand.classList.add('gone');
    SFX.brush();
  }
  clearInterval(dust);
  await sleep(400);

  site.classList.add('revealed');
  boy.innerHTML = boySVG('happy');
  caption.innerHTML = `哇！挖到恐龍化石了！<br>闖過 ${TOTAL} 個難關，就能把牠送進博物館！`;
  SFX.win();
  await sleep(1000);
  stage.querySelector('.skip-btn').remove();
  $('#btn-identify').classList.remove('hidden');
}

/* ---------- 答題 ---------- */

function renderProgress() {
  $('#progress').innerHTML = state.questions.map((_, i) => {
    const a = state.answers[i];
    const cls = a === undefined ? (i === state.idx ? 'current' : '') : (a.correct ? 'ok' : 'bad');
    return `<span class="dot ${cls}">${a === undefined ? i + 1 : (a.correct ? '✓' : '✗')}</span>`;
  }).join('');
  $('#score').textContent = state.score;
}

function renderQuestion() {
  show('quiz');
  const q = state.questions[state.idx];
  renderProgress();
  $('#fossil-card').innerHTML = fossilSVG(state.dino.id);
  $('#fossil-label').textContent = state.idx === 0 ? '？？？ 的化石' : `${state.dino.name}的化石`;
  $('#thinker').innerHTML = boySVG('think');
  $('#stage-tag').textContent = `難關 ${state.idx + 1}／${TOTAL}・${q.stage}`;
  $('#q-text').textContent = q.text;
  $('#q-hint').textContent = q.hint || '';
  $('#q-hint').classList.toggle('hidden', !q.hint);
  const opts = $('#options');
  opts.innerHTML = '';
  q.options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'option' + (q.sci ? ' sci' : '');
    b.innerHTML = `<span class="key">${'ABCD'[i]}</span><span class="label"></span>`;
    b.querySelector('.label').textContent = opt;
    b.onclick = () => choose(opt, b);
    opts.appendChild(b);
  });
}

let locked = false;
function choose(opt, btn) {
  if (locked) return;
  locked = true;
  const q = state.questions[state.idx];
  const correct = opt === q.answer;
  state.answers[state.idx] = { q, picked: opt, correct };
  if (correct) state.score++;
  if (q.trivia) {
    const wasMastered = Progress.record(state.player, q.text, correct);
    if (correct && !wasMastered) state.learned++;
  }
  document.querySelectorAll('#options .option').forEach(b => {
    b.disabled = true;
    if (b.querySelector('.label').textContent === q.answer) b.classList.add('right');
  });
  if (!correct) btn.classList.add('wrong');
  (correct ? SFX.correct : SFX.wrong)();
  renderProgress();
  setTimeout(() => showFeedback(correct, q), 650);
}

function showFeedback(correct, q) {
  const fb = $('#feedback');
  const done = state.idx + 1;
  const needed = PASS_SCORE - state.score;
  const left = TOTAL - done;
  let status;
  if (state.score >= PASS_SCORE) status = `🏛️ 已經答對 ${PASS_SCORE} 題，化石一定能進博物館了！`;
  else if (needed > left) status = '😈 邪惡博士在偷看……不過還是要把題目做完，多學一點知識！';
  else status = `目前答對 ${state.score} 題，還要再答對 ${needed} 題才能進博物館！`;

  const happy = ['答對了！太棒了！', '好厲害！', '你是天才古生物學家！', '完全正確！'];
  const sad = ['嗚嗚…答錯了', '哭哭，差一點點！', '嗚哇～不是這個…'];
  fb.className = 'overlay ' + (correct ? 'is-correct' : 'is-wrong');
  fb.querySelector('.fb-char').innerHTML = boySVG(correct ? 'happy' : 'cry');
  fb.querySelector('h2').textContent = q.review && correct ? '複習成功！這題你學會了 💪' : pickN(correct ? happy : sad, 1)[0];
  fb.querySelector('.fb-answer').textContent = correct ? `答案：${q.answer}` : `正確答案是：${q.answer}`;
  fb.querySelector('.fb-explain').textContent = q.explain;
  fb.querySelector('.fb-status').textContent = status;
  fb.querySelector('.fb-next').textContent = done === TOTAL ? '看看結果 ➜' : '下一關 ➜';
  fb.querySelector('.fx').innerHTML = '';
  if (correct) confetti(fb.querySelector('.fx'), 40);
  fb.classList.remove('hidden');
  fb.querySelector('.fb-next').focus();
}

function nextQuestion() {
  SFX.click();
  $('#feedback').classList.add('hidden');
  locked = false;
  state.idx++;
  if (state.idx < TOTAL) return renderQuestion();
  state.submitted = Leaderboard.submit(state.player, state.score);
  state.score >= PASS_SCORE ? playMuseum() : playDoctor();
}

/* ---------- 結局：博物館展示 ---------- */

async function playMuseum() {
  beginAnim();
  show('ending');
  const d = state.dino;
  const stage = $('#ending .stage');
  $('#report').classList.add('hidden');
  stage.className = 'stage city';
  stage.innerHTML = `
    <div class="sky"></div><div class="sun"></div><div class="museum">${museumSVG()}</div><div class="road"></div>
    <div class="actor truck offstage-left">${truckSVG()}</div>
    <div class="caption">答對 ${state.score} 題！出發～把化石送到博物館！</div>
    <button class="skip-btn" type="button">跳過動畫 ⏭</button>`;
  stage.querySelector('.skip-btn').onclick = skipAnim;
  SFX.click();
  await sleep(200);
  stage.querySelector('.truck').classList.replace('offstage-left', 'drive-in');
  await sleep(3200);

  stage.classList.add('fade-out');
  await sleep(500);
  stage.className = 'stage hall';
  stage.innerHTML = `
    <div class="wall"></div><div class="floor"></div>
    <div class="spot sp1"></div><div class="spot sp2"></div>
    <div class="exhibit">
      <div class="exhibit-fossil">${fossilSVG(d.id)}</div>
      <div class="pedestal"></div>
    </div>
    <figure class="poster">${restorationSVG(d.id)}<figcaption>復原圖：${d.name}活著的時候可能長這樣</figcaption></figure>
    <div class="plaque"><b>${d.name}</b><i>${d.sci}</i><span>${d.period}・${d.region}・${fmtSize(d.size)}</span><span>發現者：小小古生物學家</span></div>
    <div class="actor boy-actor museum-boy">${boySVG('happy')}</div>
    <div class="fx"></div>
    <div class="caption">化石放上展示台……</div>`;
  await sleep(300);
  stage.querySelector('.exhibit').classList.add('placed');
  await sleep(1200);
  stage.classList.add('lights-on');
  stage.querySelector('.caption').innerHTML = `🎉 恭喜！${d.name}化石在博物館展出了！🎉`;
  SFX.win();
  confetti(stage.querySelector('.fx'), 90);
  await sleep(2800);
  showReport(true);
}

/* ---------- 結局：邪惡博士搶走化石 ---------- */

async function playDoctor() {
  beginAnim();
  show('ending');
  const stage = $('#ending .stage');
  $('#report').classList.add('hidden');
  stage.className = 'stage camp';
  stage.innerHTML = `
    <div class="sky dusk"></div><div class="hills"></div><div class="ground"></div><div class="tent"></div>
    <div class="table"><div class="table-fossil">${fossilSVG(state.dino.id)}</div></div>
    <div class="actor boy-actor camp-boy">${boySVG('think')}</div>
    <div class="actor doctor-actor offstage-right">${doctorSVG('evil')}</div>
    <div class="bubble hidden"></div>
    <div class="caption">只答對了 ${state.score} 題……咦？那是誰？</div>
    <button class="skip-btn" type="button">跳過動畫 ⏭</button>`;
  stage.querySelector('.skip-btn').onclick = skipAnim;
  const doctor = stage.querySelector('.doctor-actor');
  const boy = stage.querySelector('.camp-boy');
  const bubble = stage.querySelector('.bubble');
  const caption = stage.querySelector('.caption');
  const fossil = stage.querySelector('.table-fossil');

  await sleep(900);
  doctor.classList.remove('offstage-right');
  doctor.classList.add('sneak-in');
  SFX.evil();
  await sleep(1500);
  bubble.textContent = `嘿嘿嘿！答對不到 ${PASS_SCORE} 題，這塊化石就歸我邪惡博士啦！`;
  bubble.classList.remove('hidden');
  caption.textContent = '糟糕！是邪惡博士！';
  await sleep(2200);

  bubble.classList.add('hidden');
  doctor.innerHTML = doctorSVG('grab');
  doctor.appendChild(fossil);
  fossil.className = 'carried-fossil';
  boy.innerHTML = boySVG('cry');
  await sleep(500);
  doctor.classList.add('run-away');
  caption.textContent = '嗚嗚嗚……化石被邪惡博士搶走了！';
  SFX.wrong();
  await sleep(2200);
  caption.innerHTML = '別灰心！多學一點恐龍知識，<br>下次一定能把化石送進博物館！';
  await sleep(1800);
  showReport(false);
}

/* ---------- 成績與複習 ---------- */

async function renderLeaderboard() {
  const box = $('#report .leaderboard');
  const list = box.querySelector('.lb-list');
  list.innerHTML = '<li class="lb-empty">讀取中…</li>';
  const me = await state.submitted;
  const [top, mine] = await Promise.all([Leaderboard.top(10), Leaderboard.rankOf(state.player)]);
  box.querySelector('.lb-me').textContent = me && mine
    ? `${state.player}：這局答對 ${state.score} 題，累積答對 ${me.total} 題（玩了 ${me.games} 局），目前第 ${mine.rank} 名！`
    : '';
  fillBoardList(list, top, state.player);
}

function fillBoardList(list, rows, me) {
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<li class="lb-empty">還沒有人上榜，快來當第一名！</li>';
    return;
  }
  rows.forEach(r => {
    const li = document.createElement('li');
    li.className = me && r.code === me ? 'me' : '';
    li.innerHTML = '<span class="lb-rank"></span><span class="lb-code"></span><span class="lb-total"></span>';
    li.querySelector('.lb-rank').textContent = ['🥇', '🥈', '🥉'][r.rank - 1] || r.rank;
    li.querySelector('.lb-code').textContent = r.code; // 玩家輸入的文字一律用 textContent，避免被當成 HTML
    li.querySelector('.lb-total').textContent = `${r.total} 題`;
    list.appendChild(li);
  });
}

// 開始畫面的排行榜：進首頁、從結算回首頁時都重新讀取
let titleBoardLoad = 0;
async function renderTitleBoard() {
  const list = $('#title-board .lb-list');
  const load = ++titleBoardLoad;
  list.innerHTML = '<li class="lb-empty">讀取中…</li>';
  let rows = [];
  try { rows = await Leaderboard.top(10); } catch (e) { /* 讀不到就顯示空的排行榜 */ }
  if (load === titleBoardLoad) fillBoardList(list, rows, $('#player-code').value.trim());
}

// 知識圖鑑：總進度＋各主題進度
function renderKnowledge(box, player, learnedThisGame) {
  const s = Progress.stats(player);
  const pct = n => Math.round((n / Math.max(1, s.total)) * 100);
  box.innerHTML = `
    <h3>📚 我的知識圖鑑</h3>
    ${learnedThisGame === undefined ? '' : `<p class="kn-new">${learnedThisGame ? `這局新學會 <b>${learnedThisGame}</b> 題知識！` : '這局沒有新學會的題目，下次加油！'}</p>`}
    <div class="kn-total"><span>已學會 <b>${s.mastered}</b> / ${s.total} 題</span><div class="bar"><i style="width:${pct(s.mastered)}%"></i></div></div>
    <ul class="kn-topics"></ul>`;
  const ul = box.querySelector('.kn-topics');
  Object.entries(s.topics).forEach(([name, t]) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="kn-name"></span><div class="bar"><i></i></div><span class="kn-count"></span>';
    li.querySelector('.kn-name').textContent = name;
    li.querySelector('i').style.width = Math.round((t.mastered / t.total) * 100) + '%';
    li.querySelector('.kn-count').textContent = `${t.mastered}/${t.total}`;
    ul.appendChild(li);
  });
}

function renderTitleProgress() {
  const code = $('#player-code').value.trim();
  const el = $('#title-progress');
  if (!code) { el.textContent = ''; return; }
  const s = Progress.stats(code);
  el.textContent = s.seen ? `📚 ${code} 已學會 ${s.mastered} / ${s.total} 題知識` : `📚 題庫共有 ${s.total} 題知識等你來挑戰！`;
}

function showReport(won) {
  const d = state.dino;
  const r = $('#report');
  renderLeaderboard();
  renderKnowledge(r.querySelector('.knowledge'), state.player, state.learned);
  r.querySelector('h2').textContent = won ? `🏛️ 任務成功！答對 ${state.score} / ${TOTAL} 題` : `😈 化石被搶走了… 答對 ${state.score} / ${TOTAL} 題`;
  r.querySelector('.stars').textContent = '⭐'.repeat(state.score) + '☆'.repeat(TOTAL - state.score);
  r.querySelector('.dino-card').innerHTML = `
    <div class="dino-pics">
      <figure>${fossilSVG(d.id)}<figcaption>🦴 化石</figcaption></figure>
      <figure>${restorationSVG(d.id)}<figcaption>🦖 復原圖（牠活著時的樣子）</figcaption></figure>
    </div>
    <div class="dino-info"><h3>${d.name}${d.alias ? `（${d.alias}）` : ''}</h3>
      <p class="sci">${d.sci}</p>
      <p>📅 ${d.period}（${d.periodDetail}）</p>
      <p>🧬 ${d.order} → ${d.group} → ${d.family}</p>
      <p>🌍 ${d.region}　📏 ${fmtSize(d.size)}</p>
      <p>✨ ${d.fact}</p>
      <p class="note">※ 復原圖是根據骨骼畫出來的；大部分恐龍真正的顏色還不知道，是畫家合理的想像。</p></div>`;
  r.querySelector('.review').innerHTML = state.answers.map((a, i) => `
    <li class="${a.correct ? 'ok' : 'bad'}">
      <span class="mark">${a.correct ? '✓' : '✗'}</span>
      <div><b>難關 ${i + 1}：</b>${a.q.text}<br>
      ${a.correct ? `你的答案：${a.picked}` : `你選了：${a.picked}　→　正確答案：<b>${a.q.answer}</b>`}</div>
    </li>`).join('');
  r.querySelector('.review-title').textContent = `📖 複習一下這 ${TOTAL} 關`;
  r.querySelector('.again').textContent = won ? '再挖一隻新恐龍 🦴' : '再挑戰一次！把化石搶回來 💪';
  r.classList.remove('hidden');
  r.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- 啟動 ---------- */

function newGame() {
  SFX.click();
  const prev = state.dino && state.dino.id;
  const pool = DINOS.filter(d => d.id !== prev);
  state.dino = pickN(pool, 1)[0];
  state.questions = buildQuestions(state.dino);
  state.idx = 0; state.score = 0; state.answers = []; state.learned = 0; locked = false;
  playIntro();
}

function startFromTitle() {
  const input = $('#player-code');
  const code = input.value.trim();
  $('#player-error').classList.toggle('hidden', !!code);
  if (!code) { input.focus(); return; }
  state.player = code;
  Player.save(code);
  newGame();
}

document.addEventListener('DOMContentLoaded', () => {
  renderTitle();
  $('#player-code').value = Player.load();
  renderTitleBoard();
  renderTitleProgress();
  $('#player-code').addEventListener('keydown', e => { if (e.key === 'Enter') startFromTitle(); });
  // 邊打邊存，就算沒按開始就離開，下次也會自動帶入
  $('#player-code').addEventListener('input', e => { const code = e.target.value.trim(); if (code) Player.save(code); renderTitleProgress(); });
  $('#btn-start').onclick = startFromTitle;
  $('#btn-identify').onclick = () => { SFX.click(); renderQuestion(); };
  $('#feedback .fb-next').onclick = nextQuestion;
  $('#report .again').onclick = newGame;
  $('#report .home').onclick = () => { SFX.click(); show('title'); renderTitleBoard(); renderTitleProgress(); };
  $('#mute').onclick = () => {
    state.muted = !state.muted;
    $('#mute').textContent = state.muted ? '🔇' : '🔊';
  };
  document.addEventListener('keydown', e => {
    if ($('#quiz').classList.contains('active') && $('#feedback').classList.contains('hidden')) {
      const i = 'abcd1234'.indexOf(e.key.toLowerCase()) % 4;
      const btns = document.querySelectorAll('#options .option');
      if (i >= 0 && btns[i] && !btns[i].disabled) btns[i].click();
    }
  });
});
