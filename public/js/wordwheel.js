'use strict';
// ================= Word Wheel: nine letters, one in the middle, first to five words =================
// The rock, paper, scissors winner spins the wheel once: match.ww = {by, n}, n an index into WW_WHEELS
// (public/js/wheels.js, built by tools/make_wheels.py with every word each wheel allows). Then both
// phones race on the same wheel. A word is claimed by appending match.finds.fNNN = {by, w} in a
// transaction that checks the latest replay, so the same word can't be claimed twice at once.
// wwState(m) replays the finds in key order: a word counts once, for whoever found it first, only if
// it's in the wheel's list; the first to WW_TO wins. Wrong words are refused on the phone and never
// written. Nothing derived is stored.

const WW_TO = 5;    // words to win
const WW_MIN = 4;   // letters in a word, at least

// ---------- the wheels ----------
const wwCache = [];
function wwWheel(n) {
  if (!wwCache[n]) {
    const x = WW_WHEELS[n], words = x.words.split(' ');
    wwCache[n] = { n, c: x.c, o: x.o, nine: x.nine.split(' '), words, set: new Set(words) };
  }
  return wwCache[n];
}
// The wheel the RPS winner spins: the table's own order of all of them (from its code), from the number
// of Word Wheel games finished there on, passing over wheels this phone has already seen at the table
// (`seen`: games that were quit or replaced never reach the results). So no wheel comes round twice
// until all hundred have.
function wwPick(code, finished, seen = []) {
  const order = WW_WHEELS.map((_, i) => i), rnd = hueRng('ww:' + code);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (let k = 0; k < order.length; k++) { const n = order[(finished + k) % order.length]; if (!seen.includes(n)) return n; }
  return order[finished % order.length];
}
// the wheels this phone has played at a table (Pref ww-seen:CODE, a JSON list)
const wwSeen = {
  get(code) { try { const v = JSON.parse(Pref.get('ww-seen:' + code) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } },
  add(code, n) { const v = this.get(code); if (!v.includes(n)) Pref.set('ww-seen:' + code, JSON.stringify([...v, n].slice(-100))); },
};

// ---------- the replay ----------
function wwSetup(m) {
  const w = m && m.ww;
  if (!w || w.by !== rpsState(m).starter || !Number.isInteger(w.n) || !WW_WHEELS[w.n]) return null;
  return { by: w.by, n: w.n };
}
function wwState(m) {
  const setup = wwSetup(m);
  const st = { setup, wheel: setup ? wwWheel(setup.n) : null, finds: [], found: new Map(), score: { host: 0, guest: 0 }, winner: null };
  if (!setup) return st;
  for (const key of sortedKeys(m.finds)) {
    if (st.winner) break;
    const f = m.finds[key];
    if (!f || (f.by !== 'host' && f.by !== 'guest') || !st.wheel.set.has(f.w) || st.found.has(f.w)) continue;
    st.found.set(f.w, f.by);
    st.finds.push({ key, by: f.by, w: f.w });
    if (++st.score[f.by] >= WW_TO) st.winner = f.by;
  }
  return st;
}
// Why this word can't be claimed ({k: 'short' | 'middle' | 'plural' | 'word' | 'found', by}), or null.
function wwRefusal(st, w) {
  const x = st.wheel;
  if (w.length < WW_MIN) return { k: 'short' };
  if (!w.includes(x.c)) return { k: 'middle' };
  if (st.found.has(w)) return { k: 'found', by: st.found.get(w) };
  if (!x.set.has(w)) return { k: /[^S]S$/.test(w) && x.set.has(w.slice(0, -1)) ? 'plural' : 'word' };
  return null;
}

// ---------- the RPS winner spins ----------
function makeWWSpin(box) {
  let m, busy = false;
  const root = h('div', { class: 'qf-setup-wrap' });
  box.append(root);
  async function spin() {
    if (busy || rpsState(m).starter !== G.seat) return;
    busy = true; draw(); Sound.whoosh();
    const finished = Object.values((G.table && G.table.results) || {}).filter((r) => r && r.g === 'ww').length;
    await chooseOnce(m, 'ww', { by: G.seat, n: wwPick(G.code, finished, wwSeen.get(G.code)) }, 'The wheel has already been spun.', 'Couldn’t spin the wheel. Try again.');
    busy = false; if (root.isConnected) draw();
  }
  function draw() {
    if (!m) return;
    const mine = rpsState(m).starter === G.seat, P = partnerName();
    root.replaceChildren(h('div', { class: 'paper qf-setup ww-spin' }, h('div', { class: 'tape sage' }),
      h('span', { class: 'eyebrow' }, 'Before the race'),
      h('h1', { class: 'display h2' }, 'Spin the wheel'),
      h('p', { class: 'hand-note' }, mine
        ? 'You won rock, paper, scissors. Spin, and you both get the same nine letters.'
        : `${P} won rock, paper, scissors and is spinning the wheel.`),
      mine ? h('button', { class: 'btn btn-primary qf-go', disabled: busy, onclick: spin }, 'Spin the wheel')
        : h('div', { class: 'pulse-dots', style: 'justify-content:center;width:100%' }, h('i'), h('i'), h('i'))));
  }
  return { update(nm) { m = nm; draw(); }, relayout() {}, destroy() { root.remove(); } };
}

// ---------- the race ----------
// The wheel is drawn in a 100 × 100 box: the middle letter at the centre, the other eight on a circle
// of radius WW_R between the spokes. A finger picks a letter when it comes within WW_HIT of it, close
// enough to be easy and far enough that a swipe can pass between two letters without picking either.
const WW_R = 31, WW_HIT = 8.5, WW_HIT_MID = 10, WW_GRAB = 15;
// place 0 is just right of the top spoke, then clockwise; place 8 is the middle
const wwSpot = (place) => (place === 8 ? [50, 50] : [50 + WW_R * Math.cos((place * 45 - 67.5) * Math.PI / 180), 50 + WW_R * Math.sin((place * 45 - 67.5) * Math.PI / 180)]);

function makeWW(box, ctx) {
  const seat = G.seat, opp = other(seat), P = partnerName();
  let m = null, st = null, dead = false, over = false, spinning = false;
  let settling = 0;                    // until then the letters are still sliding after a Shuffle: no new swipe
  let seen = -1;                       // finds already announced
  let order = [0, 1, 2, 3, 4, 5, 6, 7]; // which outer letter sits in which place (Shuffle changes it)
  let path = [];                       // letter indexes (0–7 outer, 8 the middle) of the word being made
  let drag = null, finger = null, last = null;
  let flash = '', flashTimer = null, wrong = ''; // wrong: a refused word, shown on the tiles while its note is up
  const pending = new Set();           // words sent, not yet back

  const scoreMe = h('b', null, '0'), scoreThem = h('b', null, '0');
  const sb = h('div', { class: 'scoreboard paper qf-sb ww-sb' },
    h('div', { class: 'sb-side' }, h('div', { class: 'sb-name' }, 'You'), scoreMe),
    h('div', { class: 'sb-mid' }, 'Word Wheel', h('small', null, `first to ${WW_TO}`)),
    h('div', { class: 'sb-side right' }, h('div', { class: 'sb-name' }, P), scoreThem));
  const word = h('div', { class: 'rack ww-word', 'aria-live': 'polite' });
  const trail = svgEl('<svg class="ww-trail" viewBox="0 0 100 100" aria-hidden="true"><polyline points=""/></svg>');
  const letters = Array.from({ length: 9 }, (_, i) => h('span', { class: 'ww-l' + (i === 8 ? ' mid' : '') }));
  const wheel = h('div', { class: 'ww-wheel', role: 'group', 'aria-label': 'The wheel: swipe across the letters' },
    svgEl('<svg class="ww-lines" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48"/><circle class="mid" cx="50" cy="50" r="15.5"/>'
      + Array.from({ length: 8 }, (_, i) => { const a = (i * 45 - 90) * Math.PI / 180; return `<line x1="${50 + 15.5 * Math.cos(a)}" y1="${50 + 15.5 * Math.sin(a)}" x2="${50 + 48 * Math.cos(a)}" y2="${50 + 48 * Math.sin(a)}"/>`; }).join('') + '</svg>'),
    ...letters, trail);
  const shuffleBtn = h('button', { class: 'icon-btn ww-shuffle', html: ICON.shuffle, 'aria-label': 'Shuffle the letters', onclick: shuffle });
  const status = h('div', { class: 'status-line ww-status', 'aria-live': 'polite' });
  const listMe = h('ol', { class: 'ww-list' }), listThem = h('ol', { class: 'ww-list' });
  const found = h('div', { class: 'paper ww-found' }, h('div', { class: 'tape' }),
    h('div', { class: 'ww-col' }, h('h3', null, 'Yours'), listMe),
    h('div', { class: 'ww-col' }, h('h3', null, `${firstName(P)}’s`), listThem));
  const endArea = h('div', { class: 'end-area' });
  const root = h('div', { class: 'ww' }, sb, word, h('div', { class: 'ww-stage' }, wheel, shuffleBtn), status, found, endArea);
  box.append(root);

  const say = (text) => status.replaceChildren(text);
  function note(text, ms = 1800) { flash = text; clearTimeout(flashTimer); flashTimer = setTimeout(() => { flash = wrong = ''; paint(); }, ms); paint(); }
  const letterAt = (i) => (i === 8 ? st.wheel.c : st.wheel.o[i]);
  const typed = () => path.map(letterAt).join('');
  const spot = (i) => wwSpot(i === 8 ? 8 : order.indexOf(i));

  // ---- finding letters under a finger ----
  function point(e) {
    const r = wheel.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100];
  }
  function nearest([x, y], grab) {
    let best = null, bd = Infinity;
    for (let i = 0; i < 9; i++) {
      const [sx, sy] = spot(i), d = Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = i; }
    }
    return bd <= (grab ? WW_GRAB : best === 8 ? WW_HIT_MID : WW_HIT) ? best : null;
  }
  function visit(i) {
    if (i == null) return;
    if (path.length > 1 && path[path.length - 2] === i) { path.pop(); Sound.tap(); } // back onto the last letter: undo
    else if (!path.includes(i)) { path.push(i); Sound.tap(); vibrate(6); }
  }
  // not before the partner is back in a resumed game: one player could otherwise win it alone
  const theyreIn = () => joinedBy(m, opp);
  const canPlay = () => st && st.setup && !over && !spinning && theyreIn() && Date.now() >= settling;
  wheel.addEventListener('pointerdown', (e) => {
    if (!canPlay() || drag != null || e.button > 0) return;
    const p = point(e), i = nearest(p, true);
    if (i == null) return;
    e.preventDefault();
    try { wheel.setPointerCapture(e.pointerId); } catch (err) {}
    drag = e.pointerId; path = []; flash = wrong = ''; finger = last = p;
    visit(i); paint();
  });
  wheel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== drag) return;
    const p = point(e);
    // a quick swipe moves far between two events: look along the way too, so no letter is skipped
    const steps = Math.ceil(Math.hypot(p[0] - last[0], p[1] - last[1]) / 2);
    for (let s = 1; s <= steps; s++) visit(nearest([last[0] + ((p[0] - last[0]) * s) / steps, last[1] + ((p[1] - last[1]) * s) / steps]));
    finger = last = p;
    paintWheel();
    paintWord();
  });
  const letGo = (e) => {
    if (e.pointerId !== drag) return;
    drag = null; finger = null;
    if (e.type === 'pointercancel') { path = []; paint(); return; }
    submit();
  };
  wheel.addEventListener('pointerup', letGo);
  wheel.addEventListener('pointercancel', letGo);
  // a real keyboard types too (letters on the wheel, Backspace, Enter), but not while typing a chat note,
  // on a button (Enter presses it) or with a sheet open
  const onKey = (e) => {
    if (!canPlay() || drag != null || e.metaKey || e.ctrlKey || e.altKey || !$('#sheet').hidden || e.target.closest?.('input, textarea, button, [contenteditable]')) return;
    if (!path.length && ['Enter', 'Backspace', 'Escape'].includes(e.key)) return;
    if (e.key === 'Enter') submit();
    else if (e.key === 'Backspace') { path.pop(); paint(); }
    else if (e.key === 'Escape') { path = []; paint(); }
    else if (/^[a-z]$/i.test(e.key)) {
      const ch = e.key.toUpperCase(), free = [8, 0, 1, 2, 3, 4, 5, 6, 7].find((i) => letterAt(i) === ch && !path.includes(i));
      if (free == null) { shake(word, 5); return; }
      path.push(free); flash = wrong = ''; Sound.tap(); paint();
    } else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  // ---- claiming a word ----
  function submit() {
    const w = typed();
    path = [];
    if (!w) { paint(); return; }
    if (w.length === 1) { paint(); return; } // a tap on one letter isn't an attempt
    const no = pending.has(w) ? { k: 'sent' } : wwRefusal(st, w);
    if (!no) { claim(w); return; }
    Sound.lose(); vibrate(20); shake(word, 7);
    wrong = w;
    note(no.k === 'short' ? 'Four letters or more'
      : no.k === 'middle' ? `Every word needs the middle ${st.wheel.c}`
      : no.k === 'found' ? (no.by === seat ? `You already have ${w}` : `${P} already found ${w}`)
      : no.k === 'plural' ? `No plurals: ${w} doesn’t count`
      : no.k === 'sent' ? `Already sending ${w}…`
      : `${w} isn’t a word here`, 1700);
  }
  async function claim(w) {
    const id = m.id;
    pending.add(w); Sound.ding(); vibrate([8, 30, 8]);
    paint();
    try {
      await Net.timed(FB.fs.runTransaction(async (tx) => {
        const ref = FB.fs.doc(matchPath(id)), snap = await tx.get(ref), latest = snap.data();
        if (!snap.exists) throw Error('This game is no longer available.');
        const s = wwState(latest), by = s.found.get(w);
        if (s.winner) throw Error('The race is already over.');
        if (by) throw Error(by === seat ? `You already have ${w}` : `${P} got ${w} first`);
        tx.update(ref, { ['finds.f' + pad3(Object.keys(latest.finds || {}).length)]: { by: seat, w } });
      }));
    } catch (e) {
      // a word that went stays listed as sending until the snapshot brings it back (update() drops it)
      pending.delete(w);
      if (!dead) { Sound.lose(); note(writeError(e, 'Couldn’t save that word. Try again.'), 2400); }
    }
  }

  // ---- shuffling: the outer letters swap places (on this phone only) ----
  function shuffle() {
    if (!canPlay()) return;
    Sound.whoosh();
    const next = order.slice();
    do { for (let i = next.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [next[i], next[j]] = [next[j], next[i]]; } }
    while (next.every((v, i) => v === order[i]));
    order = next; path = [];
    settling = Date.now() + 380; setTimeout(() => { if (!dead) paint(); }, 400); // the .35 s slide
    paint();
  }

  // ---- drawing ----
  function paintWheel() {
    letters.forEach((el, i) => {
      const [x, y] = spot(i);
      el.style.left = x + '%'; el.style.top = y + '%';
      el.textContent = letterAt(i);
      el.classList.toggle('on', path.includes(i));
    });
    // the ink trail: through the letters picked so far, then on to the finger
    const pts = path.map(spot);
    if (finger && pts.length) pts.push(finger);
    trail.firstChild.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
  }
  function paintWord() {
    const w = typed() || wrong;
    word.classList.toggle('empty', !w);
    word.replaceChildren(...(w ? [...w].map((ch) => h('span', { class: 'tile' + (w === wrong ? ' wrong' : '') }, ch)) : [h('span', { class: 'ww-hint' }, 'Swipe across the letters')]));
  }
  function paintLists() {
    const row = (w, cls) => h('li', { class: cls }, w);
    listMe.replaceChildren(...st.finds.filter((f) => f.by === seat).map((f) => row(f.w)), ...[...pending].filter((w) => !st.found.has(w)).map((w) => row(w, 'sending')));
    listThem.replaceChildren(...st.finds.filter((f) => f.by === opp).map((f) => row(f.w)));
    scoreMe.textContent = st.score[seat]; scoreThem.textContent = st.score[opp];
  }
  function paint() {
    if (dead || !st || !st.setup) return;
    paintWheel(); paintLists();
    shuffleBtn.disabled = !canPlay();
    if (over) return;
    paintWord();
    say(flash || (spinning ? 'Spinning…' : !theyreIn() ? `Waiting for ${P} to join…` : path.length ? 'Let go to send it' : `Every word needs the middle ${st.wheel.c}`));
  }

  // ---- what the other phone did ----
  function announce() {
    const fresh = st.finds.slice(Math.max(seen, 0));
    if (seen >= 0) for (const f of fresh) {
      const el = [...(f.by === seat ? listMe : listThem).children].find((li) => li.textContent === f.w);
      if (f.by === opp) { Sound.pop(); note(`${P} found ${f.w}`, 2000); }
      (f.by === seat ? scoreMe : scoreThem).animate([{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' });
      el && el.classList.add('new');
    }
    seen = st.finds.length;
  }
  // quiet: the game was already over when this screen opened, so no end card
  function finish(quiet) {
    if (over) return;
    over = true; path = []; drag = null;
    recordResult(m, st.winner);
    const won = st.winner === seat, a = st.score[seat], b = st.score[opp], nine = st.wheel.nine[0];
    // show the nine-letter word on the tiles, and a few more words nobody found
    word.classList.remove('empty');
    word.replaceChildren(...[...nine].map((ch) => h('span', { class: 'tile shown' }, ch)));
    const left = st.wheel.words.filter((w) => !st.found.has(w) && !st.wheel.nine.includes(w)).slice(0, 4);
    say(won ? 'You win!' : `${P} wins`);
    found.append(h('p', { class: 'ww-left' }, `The nine-letter word: ${nine}.`, ...(left.length ? [h('br'), `Nobody found ${left.join(', ')}.`] : [])));
    paint();
    endArea.replaceChildren(endBar(m));
    if (quiet) return;
    endSheetSoon(m, () => dead, 900, { title: won ? `You win, ${a}–${b}!` : `${P} wins, ${b}–${a}`, body: `The nine-letter word was ${nine}. The wheel had ${st.wheel.words.length} words.`, good: won });
  }
  async function spinIn() {
    // the wheel spins in on both phones the same way, once per game, then the race is on
    spinning = true; paint();
    Sound.whoosh();
    await settle(wheel.animate([{ transform: 'rotate(-540deg) scale(.6)', opacity: 0 }, { transform: 'rotate(0) scale(1)', opacity: 1 }], { duration: 1300, easing: 'cubic-bezier(.2,.8,.25,1)' }));
    spinning = false;
    if (!dead) { Pref.set('ww-spun:' + m.id, '1'); Sound.pick(); paint(); }
  }

  return {
    update(nm) {
      m = nm;
      const first = !st;
      st = wwState(m);
      if (!st.setup) return;
      for (const w of pending) if (st.found.has(w)) pending.delete(w);
      wwSeen.add(G.code, st.setup.n);
      if (first && !st.finds.length && Pref.get('ww-spun:' + m.id) !== '1') spinIn();
      paint();
      announce();
      if (st.winner) finish(first);
    },
    isOver() { return over; },
    relayout() {}, // the wheel is laid out in CSS, in its own units
    destroy() { dead = true; clearTimeout(flashTimer); document.removeEventListener('keydown', onKey); },
  };
}
