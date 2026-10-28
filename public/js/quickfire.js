'use strict';
// ================= Quickfire: two races in one box, Words and Sums =================
// The rock, paper, scissors winner sets the game once (match.qf = {by, mode, len, side, op}).
// Every round both phones pick in secret, like RPS: match.picks.rNNN.{host,guest} is a letter
// (Words) or a number (Sums). Once both are in, the puzzle shows and the race starts.
//
// Fair timing: an answer is match.ans.rNNN{h|g} = {w|n, ms}, where ms is measured on the answering
// phone from the moment the puzzle appeared on *its own* screen. A phone that got the puzzle late
// (slow connection, locked screen) starts its clock late too, so lag costs nobody, and no clocks
// need to agree. The quickest right answer wins. When one phone sees the other's right answer at
// t ms, it keeps its own player racing until its own clock passes t, then writes {out, ms}; only
// then is the round settled, so it can't be decided before both phones have had the same time.
// {pass, ms} gives up (after QF_LIMIT on your own clock it's sent for you). Wrong answers are
// refused on the phone and never written. qfState(m) replays it all; nothing derived is stored.

const QF_MODES = {
  mix: { name: 'Mixed', to: 10, note: 'Words and Sums, first to 10' },
  words: { name: 'Words', to: 5, note: 'Only Words, first to 5' },
  sums: { name: 'Sums', to: 5, note: 'Only Sums, first to 5' },
};
const QF_OPS = {
  add: { sym: '+', name: 'Add', lo: 1, hi: 100 },
  sub: { sym: '−', name: 'Subtract', lo: 1, hi: 100 },
  mul: { sym: '×', name: 'Multiply', lo: 0, hi: 30 },
};
const QF_LIMIT = { w: 60000, s: 30000 }; // on your own clock, then the round is given up for you
const QF_WRONG_MS = 900;                  // a wrong sum locks the keypad this long (no guessing sprees)

// ---------- dictionary (public/js/words.js, built by tools/make_words.py) ----------
let qfIndex = null;
function qfDict() {
  if (qfIndex) return qfIndex;
  const legal = new Set(), fits = new Map();
  for (const n of [4, 5, 6]) {
    const s = QF_WORDS[n];
    for (let i = 0; i < s.length; i += n) legal.add(s.slice(i, i + n));
    const c = QF_COMMON[n]; // most common first, so fits lists are too
    for (let i = 0; i < c.length; i += n) {
      const w = c.slice(i, i + n), k = n + w[0] + w[n - 1];
      if (!fits.has(k)) fits.set(k, []);
      fits.get(k).push(w);
    }
  }
  return (qfIndex = { legal, fits });
}
const qfLegal = (w) => qfDict().legal.has(w);
// everyday words of length n from a to z: a pair with none is dealt again
const qfFits = (n, a, z) => qfDict().fits.get(n + a + z) || [];

// ---------- the replay ----------
function qfSetup(m) {
  const q = m && m.qf;
  if (!q || q.by !== rpsState(m).starter || !QF_MODES[q.mode]) return null;
  const words = q.mode !== 'sums', sums = q.mode !== 'words';
  if (words && (![4, 5, 6].includes(q.len) || !['start', 'end'].includes(q.side))) return null;
  if (sums && !QF_OPS[q.op]) return null;
  return { by: q.by, mode: q.mode, len: words ? q.len : null, side: words ? q.side : null, op: sums ? q.op : null, to: QF_MODES[q.mode].to };
}
// Mixed mode draws Words or Sums for each round from the shared seed, so both phones agree.
function qfRoundType(m, setup, r) {
  if (setup.mode !== 'mix') return setup.mode === 'words' ? 'w' : 's';
  return hueRng(m.seed + ':qf:' + r)() < 0.5 ? 'w' : 's';
}
function qfPickOk(setup, type, v) {
  if (type === 'w') return typeof v === 'string' && /^[A-Z]$/.test(v);
  const op = QF_OPS[setup.op];
  return Number.isInteger(v) && v >= op.lo && v <= op.hi;
}
// The puzzle for both picks. Words: the chooser's letter goes on their end, the other's on the other.
// Sums: subtracting is always bigger minus smaller; otherwise the chooser's number comes first.
function qfPuzzle(setup, type, p) {
  const mine = p[setup.by], theirs = p[other(setup.by)];
  if (type === 'w') {
    const first = setup.side === 'start' ? mine : theirs, last = setup.side === 'start' ? theirs : mine;
    return { len: setup.len, first, last, fits: qfFits(setup.len, first, last) };
  }
  const op = setup.op;
  const [x, y] = op === 'sub' ? [Math.max(mine, theirs), Math.min(mine, theirs)] : [mine, theirs];
  return { op, x, y, answer: op === 'add' ? x + y : op === 'sub' ? x - y : x * y };
}
function qfRight(round, a) {
  if (round.type === 'w') return typeof a.w === 'string' && a.w.length === round.len && a.w[0] === round.first && a.w[round.len - 1] === round.last && qfLegal(a.w);
  return a.n === round.answer;
}
function qfAnswer(round, a) {
  if (!a || typeof a !== 'object' || typeof a.ms !== 'number' || !(a.ms >= 0) || a.ms > 1e7) return null;
  if (a.out) return { out: true, ms: a.ms };
  if (a.pass) return { pass: true, ms: a.ms };
  const right = qfRight(round, a);
  return right ? { ok: true, ms: a.ms, w: a.w, n: a.n } : null; // a wrong answer counts as no answer
}
function qfState(m) {
  const setup = qfSetup(m);
  const st = { setup, score: { host: 0, guest: 0 }, rounds: [], cur: null, winner: null };
  if (!setup) return st;
  const picks = m.picks || {}, ans = m.ans || {};
  for (let r = 1; r <= 999; r++) {
    const key = 'r' + pad3(r), type = qfRoundType(m, setup, r), p = picks[key] || {};
    const round = { r, key, type, picks: { host: null, guest: null } };
    for (const s of ['host', 'guest']) if (qfPickOk(setup, type, p[s])) round.picks[s] = p[s];
    if (round.picks.host == null || round.picks.guest == null) { round.phase = 'pick'; st.cur = round; break; }
    Object.assign(round, qfPuzzle(setup, type, round.picks));
    if (type === 'w' && !round.fits.length) { round.phase = 'void'; round.why = 'nofit'; st.rounds.push(round); continue; }
    const a = { host: qfAnswer(round, ans[key + 'h']), guest: qfAnswer(round, ans[key + 'g']) };
    round.ans = a;
    const ok = (s) => !!(a[s] && a[s].ok), gone = (s) => !!(a[s] && (a[s].out || a[s].pass));
    let w;
    if (ok('host') && ok('guest')) w = a.host.ms < a.guest.ms ? 'host' : a.guest.ms < a.host.ms ? 'guest' : null; // equal to the ms: a dead heat
    else if (ok('host') && gone('guest')) w = 'host';
    else if (ok('guest') && gone('host')) w = 'guest';
    else if (a.host && a.host.pass && a.guest && a.guest.pass) w = null;
    else { round.phase = 'race'; st.cur = round; break; }
    round.phase = 'done'; round.w = w;
    if (w) st.score[w]++;
    st.rounds.push(round);
    if (w && st.score[w] >= setup.to) { st.winner = w; break; }
  }
  return st;
}

// ---------- keyboard-aware height ----------
// Phones don't shrink the page for the on-screen keyboard, only the visual viewport; follow it,
// so the tiles, the clock and the status stay above the keyboard.
const QFViewport = {
  on() {
    const vv = window.visualViewport; if (!vv || this.fn) return;
    this.fn = () => {
      const open = window.innerHeight - vv.height > 120;
      document.documentElement.style.setProperty('--vvh', vv.height + 'px');
      document.body.classList.toggle('kb-open', open);
      if (open && (window.scrollY || vv.offsetTop)) window.scrollTo(0, 0);
    };
    vv.addEventListener('resize', this.fn); vv.addEventListener('scroll', this.fn); this.fn();
  },
  off() {
    const vv = window.visualViewport; if (!vv || !this.fn) return;
    vv.removeEventListener('resize', this.fn); vv.removeEventListener('scroll', this.fn);
    this.fn = null; document.body.classList.remove('kb-open');
  },
};

// ---------- the RPS winner sets the game ----------
function makeQFSetup(box) {
  let m, busy = false;
  const pick = { mode: 'mix', len: 5, side: 'start', op: 'add' };
  const root = h('div', { class: 'qf-setup-wrap' });
  box.append(root);
  async function start() {
    if (busy || rpsState(m).starter !== G.seat) return;
    busy = true; draw(); Sound.pick();
    const words = pick.mode !== 'sums', sums = pick.mode !== 'words';
    const qf = { by: G.seat, mode: pick.mode, len: words ? pick.len : null, side: words ? pick.side : null, op: sums ? pick.op : null };
    const path = matchPath(m.id);
    try {
      await Net.timed(FB.fs.runTransaction(async (tx) => {
        const ref = FB.fs.doc(path), snap = await tx.get(ref), latest = snap.data();
        if (!snap.exists || rpsState(latest).starter !== G.seat || latest.qf) throw Error('The game has already been set up.');
        tx.update(ref, { qf });
      }));
    } catch (e) { toast(e.message || 'Couldn’t set up the game. Try again.'); }
    finally { busy = false; if (root.isConnected) draw(); }
  }
  const opt = (group, value, label, sub) => h('button', {
    class: 'qf-opt' + (pick[group] === value ? ' on' : ''), 'aria-pressed': String(pick[group] === value), 'data-opt': group + ':' + value,
    onclick: () => { Sound.tap(); pick[group] = value; draw(); },
  }, h('b', null, label), sub ? h('small', null, sub) : null);
  function draw() {
    if (!m) return;
    const mine = rpsState(m).starter === G.seat, P = partnerName();
    const card = h('div', { class: 'paper qf-setup' }, h('div', { class: 'tape sage' }),
      h('span', { class: 'eyebrow' }, 'Before the first round'),
      h('h1', { class: 'display h2' }, 'Set up Quickfire'));
    if (!mine) {
      card.append(h('p', { class: 'hand-note' }, `${P} won rock, paper, scissors and is setting up the game.`),
        h('div', { class: 'pulse-dots', style: 'justify-content:center;width:100%' }, h('i'), h('i'), h('i')));
      root.replaceChildren(card); return;
    }
    card.append(h('p', { class: 'hand-note' }, 'You won rock, paper, scissors, so you choose. It stays like this for the whole game.'),
      h('h3', null, 'Which race'),
      h('div', { class: 'qf-opts three' }, ...Object.entries(QF_MODES).map(([k, v]) => opt('mode', k, v.name, `first to ${v.to}`))));
    if (pick.mode !== 'sums') card.append(
      h('h3', null, 'Words: how long'),
      h('div', { class: 'qf-opts three' }, ...[4, 5, 6].map((n) => opt('len', n, `${n} letters`))),
      h('h3', null, 'Words: your letter'),
      h('div', { class: 'qf-opts two' }, opt('side', 'start', 'First letter', `${P} picks the last`), opt('side', 'end', 'Last letter', `${P} picks the first`)));
    if (pick.mode !== 'words') card.append(
      h('h3', null, 'Sums: which sum'),
      h('div', { class: 'qf-opts three' }, ...Object.entries(QF_OPS).map(([k, v]) => opt('op', k, v.sym, `${v.lo}–${v.hi}`))));
    card.append(h('button', { class: 'btn btn-primary qf-go', disabled: busy, onclick: start }, 'Start the race'));
    root.replaceChildren(card);
  }
  return { update(nm) { m = nm; draw(); }, relayout() {}, destroy() { root.remove(); } };
}

// ---------- the race ----------
function makeQF(box, ctx) {
  const seat = G.seat, opp = other(seat), P = partnerName(), me = seat === 'host' ? 'h' : 'g';
  let m = null, st = null, dead = false, shown = -1, busy = false, endShown = false;
  let cur = null;          // key of the round on screen
  let clock = null;        // {key, t}: Date.now() when the puzzle first appeared on this phone
  let typed = '';          // the Sums keypad's number
  let lockUntil = 0, flash = '', flashTimer = null, tick = null;
  const sent = new Set();  // answers and picks already on their way, by key
  const localPick = {};

  const scoreMe = h('b', null, '0'), scoreThem = h('b', null, '0'), sbMid = h('div', { class: 'sb-mid' });
  const sb = h('div', { class: 'scoreboard paper qf-sb' },
    h('div', { class: 'sb-side' }, h('div', { class: 'sb-name' }, 'You'), scoreMe), sbMid,
    h('div', { class: 'sb-side right' }, h('div', { class: 'sb-name' }, P), scoreThem));
  const eyebrow = h('span', { class: 'eyebrow' });
  const clockEl = h('span', { class: 'qf-clock script', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'qf-stage' });
  // one input for the whole game: picking your letter and typing the word use the same field, so
  // the keyboard that came up for your letter is still up when the puzzle appears
  const input = h('input', { class: 'qf-input', type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Type your letters' });
  const tapHint = h('div', { class: 'qf-tap', hidden: true }, 'Tap the tiles to type');
  const entry = h('div', { class: 'qf-entry' }, stage, input, tapHint);
  const result = h('div', { class: 'qf-result', hidden: true });
  const card = h('div', { class: 'paper qf-card' }, h('div', { class: 'tape' }), h('div', { class: 'qf-head' }, eyebrow, clockEl), entry, result);
  const status = h('div', { class: 'status-line qf-status', 'aria-live': 'polite' });
  const actions = h('div', { class: 'qf-actions' });
  const padKeys = {};
  const pad = h('div', { class: 'qf-pad', hidden: true }, ...['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => {
    const b = h('button', { class: 'qf-key' + (k === 'ok' ? ' ok' : k === 'del' ? ' del' : ''), 'data-key': k, 'aria-label': k === 'del' ? 'Delete' : k === 'ok' ? 'Enter' : k }, k === 'del' ? '⌫' : k === 'ok' ? '=' : k);
    // act on touch-down: a keypad that waits for the click feels slow in a race
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); press(k); });
    padKeys[k] = b;
    return b;
  }));
  const endArea = h('div', { class: 'end-area' });
  const root = h('div', { class: 'qf' }, sb, card, status, actions, pad, endArea);
  box.append(root);
  QFViewport.on();

  const mySide = () => (seat === st.setup.by ? st.setup.side : st.setup.side === 'start' ? 'end' : 'start');
  const round = () => st && st.cur && st.cur.key === cur ? st.cur : null;
  const elapsed = () => (clock && clock.key === cur ? Date.now() - clock.t : 0);
  const clockKey = (key) => 'qf-t0:' + m.id + ':' + key;
  const say = (text) => { status.replaceChildren(...(Array.isArray(text) ? text : [text])); };
  const shake = (el) => el.animate([{ translate: '0 0' }, { translate: '-7px 0' }, { translate: '7px 0' }, { translate: '0 0' }], { duration: 260 });
  function note(text, ms = 1600) { flash = text; clearTimeout(flashTimer); flashTimer = setTimeout(() => { flash = ''; paint(); }, ms); paint(); }
  const wordsUp = () => document.activeElement === input;
  function btn(label, kind, fn) {
    const b = h('button', { class: 'btn ' + kind }, label);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // don't take the focus (and keyboard) from the tiles
    b.addEventListener('click', () => { fn(); if (round() && round().type === 'w') input.focus({ preventScroll: true }); });
    return b;
  }

  // ---- the clock: starts when the puzzle is first on this screen, and survives a reload ----
  function startClock() {
    const r = round();
    if (!r || r.phase !== 'race' || (clock && clock.key === r.key) || document.visibilityState !== 'visible') return;
    const saved = +Pref.get(clockKey(r.key)) || 0;
    clock = { key: r.key, t: saved || Date.now() };
    if (!saved) Pref.set(clockKey(r.key), String(clock.t));
  }
  const onVisible = () => { if (!dead) { startClock(); paint(); } };
  document.addEventListener('visibilitychange', onVisible);

  async function send(r, a) {
    if (sent.has(r.key)) return;
    sent.add(r.key);
    const ms = Math.round(elapsed() * 10) / 10;
    const ok = await write(matchPath(m.id), { ans: { [r.key + me]: { ...a, ms } } });
    if (!ok) sent.delete(r.key);
    if (!dead) paint();
  }
  function race() {
    // runs every 50 ms while a race is on: the clock, the time limit, and conceding to a faster answer
    const r = round();
    if (!r || r.phase !== 'race') return;
    startClock();
    if (!clock || r.ans[seat] || sent.has(r.key)) return;
    const e = elapsed();
    clockEl.textContent = (e / 1000).toFixed(1) + ' s';
    const theirs = r.ans[opp];
    if (theirs && theirs.ok && e >= theirs.ms) send(r, { out: true });
    else if (e >= QF_LIMIT[r.type]) send(r, { pass: true });
  }

  // ---- picking ----
  function lockLetter() {
    const r = round(); const v = input.value.slice(0, 1);
    if (!r || r.phase !== 'pick' || r.type !== 'w' || r.picks[seat] || localPick[r.key]) return;
    if (!/^[A-Z]$/.test(v)) { note('Type a letter first'); return; }
    pickIt(r, v);
  }
  function pickIt(r, v) {
    localPick[r.key] = v; Sound.pick(); vibrate(10);
    input.value = ''; typed = '';
    write(matchPath(m.id), { picks: { [r.key]: { [seat]: v } } }).then((ok) => { if (!ok) delete localPick[r.key]; if (!dead) paint(); });
    paint();
  }
  // ---- typing a word: only the middle letters, the ends are given ----
  input.addEventListener('input', () => {
    const r = round();
    let v = input.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (!r || r.type !== 'w' || (r.phase === 'pick' && (r.picks[seat] || localPick[r.key])) || (r.phase === 'race' && (r.ans[seat] || sent.has(r.key)))) v = '';
    const max = r && r.phase === 'race' ? r.len - 2 : 1;
    if (v.length > max) v = max === 1 ? v.slice(-1) : v.slice(0, max); // a second letter replaces your pick
    if (input.value !== v) input.value = v;
    if (r && r.phase === 'pick' && v) Sound.tap();
    if (r && r.phase === 'race' && v.length === max) tryWord(r, r.first + v + r.last);
    paint();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const r = round(); if (!r) return;
    if (r.phase === 'pick') lockLetter();
    else if (r.phase === 'race' && input.value.length === r.len - 2) tryWord(r, r.first + input.value + r.last);
  });
  input.addEventListener('focus', () => { tapHint.hidden = true; });
  input.addEventListener('blur', () => { paint(); });
  function tryWord(r, w) {
    if (r.ans[seat] || sent.has(r.key)) return;
    if (!qfLegal(w)) { Sound.lose(); vibrate(20); shake(stage); note(`${w} isn’t in our dictionary`, 1800); return; }
    Sound.ding(); send(r, { w });
  }
  // ---- the Sums keypad (and a real keyboard's digits) ----
  function press(k) {
    const r = round();
    if (!r || r.type !== 's' || (r.phase === 'pick' && (r.picks[seat] != null || localPick[r.key] != null)) || (r.phase === 'race' && (r.ans[seat] || sent.has(r.key)))) return;
    if (Date.now() < lockUntil) { shake(pad); return; }
    const max = r.phase === 'pick' ? 3 : 4;
    if (k === 'del') typed = typed.slice(0, -1);
    else if (k === 'ok') return enter(r);
    else if (typed.length < max) typed = (typed === '0' ? '' : typed) + k;
    Sound.tap(); paint();
  }
  function enter(r) {
    if (!typed) { shake(pad); return; }
    const n = +typed, op = QF_OPS[st.setup.op];
    if (r.phase === 'pick') {
      if (n < op.lo || n > op.hi) { shake(pad); note(`Pick from ${op.lo} to ${op.hi}`); typed = ''; paint(); return; }
      pickIt(r, n); return;
    }
    if (n === r.answer) { Sound.ding(); send(r, { n }); return; }
    Sound.lose(); vibrate(20); shake(stage); lockUntil = Date.now() + QF_WRONG_MS;
    note(`Not ${n}`, QF_WRONG_MS); typed = ''; paint();
  }
  const onKey = (e) => {
    const r = round(); if (!r || r.type !== 's' || e.target === input) return;
    if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); else if (e.key === 'Enter') press('ok'); else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  actions.addEventListener('mousedown', (e) => e.preventDefault());
  stage.addEventListener('pointerdown', () => { const r = round(); if (r && r.type === 'w') input.focus({ preventScroll: true }); });

  // ---- drawing ----
  function tile(ch, cls = '') { return h('span', { class: 'tile ' + cls }, ch || ''); }
  function rack(r, letters) { return h('div', { class: 'rack qf-rack', 'data-len': r.len }, ...letters); }
  function paintScore() {
    const shownScore = { host: 0, guest: 0 };
    st.rounds.slice(0, shown).forEach((r) => { if (r.w) shownScore[r.w]++; });
    scoreMe.textContent = shownScore[seat]; scoreThem.textContent = shownScore[opp];
    const s = st.setup;
    sbMid.replaceChildren(QF_MODES[s.mode].name, h('small', null, `first to ${s.to}`));
  }
  function paintWords(r) {
    const L = st.setup.len, mine = mySide(), myI = mine === 'start' ? 0 : L - 1, theirI = L - 1 - myI;
    if (r.phase === 'pick') {
      const my = r.picks[seat] || localPick[r.key], theirs = r.picks[opp];
      const t = Array.from({ length: L }, () => tile('', 'empty'));
      t[myI] = tile(my || input.value, my ? 'fixed' : 'cursor' + (input.value ? ' pop' : ''));
      t[theirI] = tile(theirs ? '✓' : '?', 'back');
      stage.replaceChildren(rack({ len: L }, t));
      eyebrow.textContent = `Words · ${L} letters`;
      clockEl.textContent = '';
      say(my ? (theirs ? '' : `Waiting for ${P}’s letter…`) : [`Type your ${mine === 'start' ? 'first' : 'last'} letter`, theirs ? h('small', null, ` · ${P} has picked`) : '']);
      actions.replaceChildren(...(my ? [] : [btn('Lock in my letter', 'btn-primary', lockLetter)]));
      return;
    }
    const v = input.value, done = r.ans[seat] || sent.has(r.key);
    const t = [tile(r.first, 'fixed')];
    for (let i = 0; i < L - 2; i++) t.push(tile(v[i] || '', v[i] ? '' : i === v.length && !done ? 'cursor' : 'empty'));
    t.push(tile(r.last, 'fixed'));
    stage.replaceChildren(rack(r, t));
    eyebrow.textContent = `Words · ${r.first} to ${r.last}`;
    say(flash || (done ? 'Got it! Checking with ' + P + '’s phone…' : 'Go! Type the middle letters'));
    actions.replaceChildren(...(done ? [] : [btn('Give up', 'btn-ghost', () => send(r, { pass: true }))]));
  }
  function paintSums(r) {
    const op = QF_OPS[st.setup.op];
    if (r.phase === 'pick') {
      const my = r.picks[seat] != null ? r.picks[seat] : localPick[r.key], theirs = r.picks[opp] != null;
      stage.replaceChildren(h('div', { class: 'qf-sum pick' },
        h('span', { class: 'qf-num mine' + (my == null ? ' typing' : '') }, my != null ? String(my) : typed || '_'),
        h('span', { class: 'op' }, op.sym),
        h('span', { class: 'qf-num back' }, theirs ? '✓' : '?')));
      eyebrow.textContent = `Sums · ${op.name}`;
      clockEl.textContent = '';
      say(flash || (my != null ? (theirs ? '' : `Waiting for ${P}’s number…`) : [`Pick a number, ${op.lo} to ${op.hi}`, theirs ? h('small', null, ` · ${P} has picked`) : '']));
      padKeys.ok.textContent = 'Lock in';
      actions.replaceChildren();
      return;
    }
    const done = r.ans[seat] || sent.has(r.key);
    stage.replaceChildren(h('div', { class: 'qf-sum' },
      h('span', null, String(r.x)), h('span', { class: 'op' }, op.sym), h('span', null, String(r.y)), h('span', { class: 'op' }, '='),
      h('span', { class: 'ans' + (typed ? '' : ' empty') }, done && r.ans[seat] ? String(r.ans[seat].n) : typed || '?')));
    eyebrow.textContent = `Sums · ${op.name}`;
    padKeys.ok.textContent = '=';
    say(flash || (done ? 'Got it! Checking with ' + P + '’s phone…' : 'Go!'));
    actions.replaceChildren(...(done ? [] : [btn('Give up', 'btn-ghost', () => send(r, { pass: true }))]));
  }
  function paint() {
    if (dead || !st || !st.setup || busy || endShown) return;
    const r = round(); if (!r) return;
    paintScore();
    result.hidden = true;
    if (r.type === 'w') {
      pad.hidden = true; input.hidden = false;
      if (!wordsUp()) input.focus({ preventScroll: true }); // works on Android; iOS needs the tap below
      tapHint.hidden = wordsUp();
      paintWords(r);
    } else {
      if (wordsUp()) input.blur();
      input.hidden = true; tapHint.hidden = true; pad.hidden = false;
      paintSums(r);
    }
    if (r.phase === 'race' && r.ans[opp] && r.ans[opp].pass && !r.ans[seat] && !sent.has(r.key)) say(flash || `${P} gave up. Take your time`);
    card.classList.toggle('racing', r.phase === 'race');
  }

  // ---- a finished round: the answer, both times, and some words that would have done ----
  // 'out' (conceded to a faster answer) has no time worth showing
  const secs = (who, a) => (a && a.ok ? `${who} ${(a.ms / 1000).toFixed(2)} s` : a && a.pass ? `${who} gave up` : null);
  async function showResult(r, quick) {
    const L = st.setup.len;
    Pref.del(clockKey(r.key));
    pad.hidden = true; actions.replaceChildren(); clockEl.textContent = '';
    if (r.why === 'nofit') {
      stage.replaceChildren(rack(r, [tile(r.first, 'fixed'), ...Array.from({ length: L - 2 }, () => tile('', 'empty')), tile(r.last, 'fixed')]));
      result.replaceChildren(h('b', null, 'No everyday word fits'), h('span', null, `${L} letters from ${r.first} to ${r.last}. New letters!`));
      say(''); result.hidden = false;
      if (!quick) { Sound.pop(); await sleep(2200); }
      return;
    }
    const win = r.w ? r.ans[r.w] : null;
    if (r.type === 'w') {
      stage.replaceChildren(rack(r, [...(win ? win.w : r.fits[0])].map((c, i) => tile(c, i === 0 || i === L - 1 ? 'fixed' : 'shown'))));
    } else {
      const op = QF_OPS[r.op];
      stage.replaceChildren(h('div', { class: 'qf-sum' }, h('span', null, String(r.x)), h('span', { class: 'op' }, op.sym), h('span', null, String(r.y)), h('span', { class: 'op' }, '='), h('span', { class: 'ans shown' }, String(r.answer))));
    }
    const title = r.w === seat ? 'You got it first!' : r.w ? `${P} got it first` : r.ans.host && r.ans.host.ok ? 'Dead heat! No point' : 'Nobody got it';
    const shownWord = r.type === 'w' ? (win ? win.w : r.fits[0]) : null;
    const others = r.type === 'w' ? r.fits.filter((w) => w !== shownWord).slice(0, 3) : [];
    result.replaceChildren(h('b', null, title),
      h('span', { class: 'times' }, [secs('You', r.ans[seat]), secs(P, r.ans[opp])].filter(Boolean).join(' · ')),
      others.length ? h('span', { class: 'also' }, (win ? 'Also: ' : 'Could have been: ') + others.join(', ')) : null);
    result.hidden = false; say('');
    card.classList.remove('racing');
    shown++; paintScore(); shown--;
    if (quick) return;
    if (r.w === seat) { Sound.win(); vibrate([10, 40, 10]); } else if (r.w) Sound.lose(); else Sound.pop();
    (r.w === seat ? scoreMe : r.w ? scoreThem : sbMid).animate([{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    await sleep(2700);
  }
  function finish() {
    if (endShown) return;
    endShown = true;
    clearInterval(tick); input.blur(); input.hidden = true; pad.hidden = true; actions.replaceChildren();
    recordResult(m, st.winner);
    endArea.replaceChildren(endBar(m));
    const a = st.score[seat], b = st.score[opp], won = st.winner === seat;
    say(won ? 'You win!' : `${P} wins`);
    setTimeout(() => { if (!dead && G.matchId === m.id) endSheet(m, { title: won ? `You win, ${a}–${b}!` : `${P} wins, ${b}–${a}`, body: `${st.rounds.filter((r) => r.phase === 'done').length} rounds of ${QF_MODES[st.setup.mode].name}.`, good: won }); }, 900);
  }

  async function step() {
    if (busy || dead || !m) return;
    st = qfState(m);
    if (!st.setup) return;
    if (shown < st.rounds.length) {
      busy = true;
      await showResult(st.rounds[shown], shown < st.rounds.length - 1);
      shown++; busy = false;
      if (!dead) step();
      return;
    }
    paintScore();
    if (st.winner) { finish(); return; }
    if (st.cur.key !== cur) { cur = st.cur.key; input.value = ''; typed = ''; flash = ''; lockUntil = 0; }
    paint();
    race();
  }
  tick = setInterval(() => { if (!dead && !busy) race(); }, 50);

  return {
    update(nm) {
      m = nm;
      if (shown < 0) shown = qfState(m).rounds.length; // earlier rounds aren't replayed on the way in
      step();
    },
    isOver() { return !!(st && st.winner); },
    relayout() {}, // CSS does the layout; rebuilding would drop the keyboard and what you typed
    destroy() {
      dead = true; clearInterval(tick); clearTimeout(flashTimer);
      document.removeEventListener('visibilitychange', onVisible); document.removeEventListener('keydown', onKey);
      input.blur(); QFViewport.off();
    },
  };
}
