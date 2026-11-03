'use strict';
// Word Slam: the RPS winner opens, then both players race to empty their hands. Each card has
// two usable letters (or is a blank). A seeded deal and append-only plays are the entire state.
// Revisions checked inside the transaction prevent a stale drop or retry from spending two cards.
const SL_CARDS = ('AE AI AO AN AR AS AT BE BO CE CH CO DE DI DO EA EI EL EN ER ES ET GA GI HA HE HO IN IO LA LE LI LO MA ME NA NE NO ON OR OS OT PA PE RA RE RI RO SA SE ST TA TE FA FE FU VE WA WE WI YO YA UP QU KI JO ZE AX * *').split(' ');
const SL_STARTS = 'CATS GAME SAND LATE MATE PINS COAT COLD HAND BELL TAIL RICE CARS BOAT BAKE TENT'.split(' ');
const slWord = (word, pos, letter) => word.slice(0, pos) + letter + word.slice(pos + 1);

function slOptions(st, by) {
  const out = [];
  for (const id of st.hands[by] || []) {
    const letters = SL_CARDS[id] === '*' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : SL_CARDS[id];
    for (const letter of letters) for (let pos = 0; pos < 4; pos++) {
      const w = slWord(st.word, pos, letter);
      if (w !== st.word && qfLegal(w)) out.push({ k: 'play', by, id, pos, letter });
    }
  }
  return out;
}
// Common words first, then the remaining legal words as a fallback. For each word cache the
// letters that can replace one of its positions. This checks every possible side and blank,
// so a fresh word always allows at least one remaining card to be played.
let slWordIndex = null;
function slFreshWord(st, seed, only = null) {
  if (!slWordIndex) {
    const words = new Set();
    for (const text of [QF_COMMON[4], QF_WORDS[4]]) for (let i = 0; i < text.length; i += 4) words.add(text.slice(i, i + 4));
    slWordIndex = [...words].filter(qfLegal).map((word) => {
      let mask = 0;
      for (let i = 0; i < 26; i++) for (let pos = 0; pos < 4; pos++) {
        const ch = String.fromCharCode(65 + i);
        if (word[pos] !== ch && qfLegal(slWord(word, pos, ch))) { mask |= 1 << i; break; }
      }
      return { word, mask };
    }).filter((x) => x.mask);
  }
  const maskOf = (by) => st.hands[by].reduce((mask, id) => SL_CARDS[id] === '*' ? 0x3ffffff :
    [...SL_CARDS[id]].reduce((m, ch) => m | (1 << (ch.charCodeAt(0) - 65)), mask), 0);
  const h = maskOf('host'), g = maskOf('guest');
  const possible = slWordIndex.filter((x) => x.word !== st.word && (x.mask & (only === 'host' ? h : only === 'guest' ? g : h | g)));
  // Prefer words that give both players a chance; retain the common-first ordering.
  const balanced = only ? [] : possible.filter((x) => (x.mask & h) && (x.mask & g));
  const choices = (balanced.length ? balanced : possible).slice(0, 128);
  if (!choices.length) throw Error('No playable word for the remaining cards.');
  return choices[Math.floor(hueRng('slam-word:' + seed)() * choices.length)].word;
}
function slCanAct(st, by) {
  return ['host', 'guest'].includes(by) && !!st.starter && !st.winner && ((st.race && !st.opening) || st.turn === by);
}

function slError(st, e) {
  if (!e || !['host', 'guest'].includes(e.by)) return 'Choose a card first';
  if (st.winner) return 'This game is already over';
  if (!slCanAct(st, e.by)) return st.race ? 'The RPS winner makes the opening play' : 'Wait for your turn';
  if (e.k === 'pass') {
    if (st.race && st.passed[e.by]) return 'Already waiting for a new word';
    return slOptions(st, e.by).length ? 'You can still play a card' : '';
  }
  if (e.k !== 'play' || !Number.isInteger(e.id) || !st.hands[e.by].includes(e.id)) return 'Choose a card from your hand';
  if (!Number.isInteger(e.pos) || e.pos < 0 || e.pos > 3) return 'Drop onto one of the four letters';
  if (typeof e.letter !== 'string' || !/^[A-Z]$/.test(e.letter)) return 'Choose a letter for your card';
  if (SL_CARDS[e.id] !== '*' && !SL_CARDS[e.id].includes(e.letter)) return 'That letter isn’t on your card';
  if (st.word[e.pos] === e.letter) return 'Change a letter to make a new word';
  const word = slWord(st.word, e.pos, e.letter);
  return qfLegal(word) ? '' : `${word} isn’t a word here`;
}
function slState(m) {
  const rnd = hueRng('slam:' + (m.seed || m.id || ''));
  const deck = SL_CARDS.map((_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const starter = rpsState(m).starter;
  const st = { race: m.slamVersion === 2, opening: true, passed: { host: false, guest: false }, refreshes: 0, starter, turn: starter, word: SL_STARTS[Math.floor(rnd() * SL_STARTS.length)], hands: { host: deck.slice(0, 10), guest: deck.slice(10, 20) }, log: [], passes: 0, winner: null, reason: null };
  if (st.race && starter && !slOptions(st, starter).length) st.word = slFreshWord(st, (m.seed || m.id || '') + ':opening', starter);
  for (const key of sortedKeys(m.plays)) {
    const e = m.plays[key];
    if (st.winner) break;
    if (slError(st, e)) continue;
    if (e.k === 'pass') {
      st.passes++;
      const entry = { k: 'pass', by: e.by };
      if (st.race) {
        st.passed[e.by] = true;
        if (st.passed.host && st.passed.guest) {
          const before = st.word;
          st.word = slFreshWord(st, (m.seed || m.id || '') + ':refresh:' + st.refreshes);
          st.refreshes++; st.passes = 0; st.passed = { host: false, guest: false };
          Object.assign(entry, { reset: true, before, word: st.word });
        }
      } else if (st.passes === 2) {
        const a = st.hands.host.length, b = st.hands.guest.length;
        st.winner = a === b ? 'draw' : a < b ? 'host' : 'guest'; st.reason = 'blocked';
      }
      st.log.push(entry);
    } else {
      const before = st.word;
      st.word = slWord(st.word, e.pos, e.letter);
      st.hands[e.by] = st.hands[e.by].filter((id) => id !== e.id);
      st.passes = 0; st.passed = { host: false, guest: false }; st.opening = false;
      st.log.push({ k: 'play', by: e.by, id: e.id, pos: e.pos, letter: e.letter, before, word: st.word });
      if (!st.hands[e.by].length) { st.winner = e.by; st.reason = 'empty'; }
    }
    if (!st.winner) st.turn = st.race ? (st.opening ? starter : null) : other(e.by);
  }
  return st;
}

function makeSL(box) {
  const seat = G.seat, opp = other(seat), P = partnerName();
  let m, st, selected = null, faces = {}, pending = false, dead = false, finished = false;
  let flash = '', timer, drag = null, ghost = null, suppressClick = 0;
  const countMe = h('b'), countThem = h('b');
  const sb = h('div', { class: 'scoreboard paper qf-sb sl-sb' },
    h('div', { class: 'sb-side' }, h('div', { class: 'sb-name' }, 'You'), countMe),
    h('div', { class: 'sb-mid' }, 'Cards left', h('small', null, 'first out wins')),
    h('div', { class: 'sb-side right' }, h('div', { class: 'sb-name' }, P), countThem));
  const status = h('div', { class: 'status-line sl-status', 'aria-live': 'polite' });
  const word = h('div', { class: 'sl-word', role: 'group', 'aria-label': 'Drop a card onto a letter' });
  const positions = Array.from({ length: 4 }, (_, pos) => h('button', { class: 'sl-letter paper', onclick: () => place(pos) }));
  word.append(...positions);
  const choice = h('div', { class: 'sl-choice' });
  const hand = h('div', { class: 'sl-hand', role: 'group', 'aria-label': 'Your letter cards' });
  const pass = h('button', { class: 'btn btn-ink sl-pass', onclick: () => send({ k: 'pass', by: seat }) }, 'Pass');
  const trail = h('ol', { class: 'sl-trail' });
  const endArea = h('div', { class: 'end-area' });
  const root = h('div', { class: 'sl-game' }, sb, status,
    h('section', { class: 'sl-table' }, h('p', { class: 'sl-caption' }, 'Change one letter. Make a new word.'), word),
    h('section', { class: 'sl-rack paper' }, h('div', { class: 'tape sage' }),
      h('div', { class: 'sl-rack-head' }, h('h3', null, 'Your hand'), choice),
      h('p', { class: 'sl-instruction' }, 'Drag to play, or tap a card then a letter.'), hand,
      h('div', { class: 'sl-footer' }, h('div', { class: 'sl-history' }, h('span', null, 'Recent words'), trail), pass)), endArea);
  box.append(root);
  const canPlay = () => st && slCanAct(st, seat) && joinedBy(m, opp) && !pending;
  const face = (id) => faces[id] || SL_CARDS[id][0];
  function note(text) {
    flash = text; clearTimeout(timer); timer = setTimeout(() => { flash = ''; if (!dead) paint(); }, 2300); paint();
  }
  function choose(id) {
    if (!canPlay()) return;
    selected = selected === id ? null : id; flash = ''; Sound.pick(); paint();
  }
  function blank(pos = null) {
    if (!canPlay() || selected == null) return;
    const id = selected;
    openSheet({ title: 'Your blank can be any letter', body: h('div', { class: 'sl-alphabet' },
      ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((ch) => h('button', { class: 'sl-letter paper', onclick: () => {
        closeSheet(); if (dead || !canPlay() || !st.hands[seat].includes(id)) return;
        selected = id; faces[id] = ch; paint(); if (pos != null) place(pos);
      } }, ch))), actions: [{ label: 'Keep choosing', kind: 'ghost' }] });
  }
  function place(pos) {
    if (!canPlay()) return;
    if (selected == null) { note('Pick a card from your hand first'); return; }
    if (face(selected) === '*') { blank(pos); return; }
    send({ k: 'play', by: seat, id: selected, pos, letter: face(selected) });
  }
  async function send(e) {
    if (!canPlay()) return;
    const error = slError(st, e);
    if (error) { Sound.lose(); shake(word); note(error); return; }
    const id = m.id, revision = Object.keys(m.plays || {}).length, baseWord = st.word;
    pending = true; flash = ''; paint();
    try {
      await Net.timed(FB.fs.runTransaction(async (tx) => {
        const ref = FB.fs.doc(matchPath(id)), snap = await tx.get(ref);
        if (!snap.exists) throw Error('This game is no longer available.');
        const latest = snap.data();
        if (!joinedBy(latest, seat) || !joinedBy(latest, opp)) throw Error('Wait for both players to join.');
        const current = slState(latest), next = Object.keys(latest.plays || {}).length;
        const onlyPasses = sortedKeys(latest.plays).slice(revision).every((key) => latest.plays[key]?.k === 'pass');
        if (next !== revision && (current.word !== baseWord || !onlyPasses)) throw Error('The word changed. Try your card again.');
        const no = slError(current, e); if (no) throw Error(no);
        tx.update(ref, { ['plays.p' + String(next).padStart(5, '0')]: e });
      }));
      selected = null;
    } catch (err) { if (!dead) note(writeError(err, 'Couldn’t save that card. Try again.')); }
    finally { pending = false; if (!dead) paint(); }
  }
  function paint() {
    if (!st || dead) return;
    countMe.textContent = st.hands[seat].length; countThem.textContent = st.hands[opp].length;
    const ready = canPlay();
    status.textContent = flash || (pending ? 'Putting your card down…' : st.winner ? st.winner === 'draw' ? 'A draw — the same cards left' : st.winner === seat ? 'You win!' : `${P} wins`
      : !joinedBy(m, opp) ? `Waiting for ${P} to join…`
      : st.race ? st.opening ? st.starter === seat ? 'You open — then it’s a race!' : `${P} makes the opening play…`
        : st.passed[seat] ? `You’re stuck — waiting for ${P}` : st.passed[opp] ? `${P} is stuck — keep playing!` : 'Slam! Both of you can play'
      : st.turn === seat ? 'Your turn — change one letter' : `${P} is choosing a card…`);
    root.classList.toggle('sl-my-turn', !!ready);
    positions.forEach((el, pos) => {
      el.textContent = st.word[pos]; el.disabled = !ready;
      el.setAttribute('aria-label', `Position ${pos + 1}: ${st.word[pos]}`);
    });
    if (selected != null && !st.hands[seat].includes(selected)) selected = null;
    choice.replaceChildren();
    if (selected != null) {
      const card = SL_CARDS[selected];
      choice.append(h('button', { class: 'btn btn-ink sl-flip', onclick: () => {
          if (!canPlay()) return;
          if (card === '*') blank(); else { faces[selected] = face(selected) === card[0] ? card[1] : card[0]; Sound.tap(); paint(); }
        }, disabled: !ready }, card === '*' ? 'Choose letter' : `Flip to ${face(selected) === card[0] ? card[1] : card[0]}`));
    } else choice.append(h('button', { class: 'btn btn-ink sl-flip', disabled: true }, 'Flip card'));
    hand.replaceChildren(...st.hands[seat].map((id) => {
      const card = SL_CARDS[id], ch = face(id), back = card === '*' ? 'any' : ch === card[0] ? card[1] : card[0];
      return h('button', { class: 'sl-card paper' + (id === selected ? ' selected' : '') + (drag?.moved && drag.id === id ? ' dragging' : ''), 'data-card': id,
        'aria-label': card === '*' ? `Blank card${ch === '*' ? '' : ', ' + ch}` : `Card ${ch}, flip side ${back}`,
        'aria-pressed': id === selected ? 'true' : 'false', disabled: !ready,
        onclick: (e) => { if (e.detail === 0 && Date.now() > suppressClick) choose(id); } },
        h('b', null, ch === '*' ? '☆' : ch), h('small', { 'aria-hidden': 'true' }, card === '*' ? 'any' : `↔ ${back}`));
    }));
    pass.hidden = !!st.winner; pass.disabled = !ready || st.race && st.passed[seat];
    pass.textContent = st.race ? st.passed[seat] ? 'Waiting…' : 'Stuck' : 'Pass';
    pass.setAttribute('aria-label', st.race ? 'Stuck: no card can make a word' : 'Pass when no card can make a word');
    trail.replaceChildren(...st.log.filter((e) => e.k === 'play').slice(-3).map((e) => h('li', { class: e.by === seat ? 'mine' : '' }, e.word)));
    if (!trail.children.length) trail.append(h('li', null, st.word));
  }

  // One pointer path owns both touch and mouse. Capture on the stable root, so repainting the hand
  // never loses a gesture. A short tap selects; movement lifts a ghost, leaving the hand in place.
  function targetAt(x, y) {
    return positions.findIndex((el) => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
  }
  function clearDrag() {
    if (drag) { try { root.releasePointerCapture(drag.pointer); } catch (_) {} }
    drag = null; ghost?.remove(); ghost = null;
    positions.forEach((el) => el.classList.remove('drop-target'));
    hand.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  }
  root.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.sl-card');
    if (!card || !canPlay() || drag || e.button > 0 || e.isPrimary === false) return;
    e.preventDefault();
    drag = { pointer: e.pointerId, id: Number(card.dataset.card), x: e.clientX, y: e.clientY, moved: false, card };
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    if (!canPlay()) { clearDrag(); return; }
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
      drag.moved = true; drag.card.classList.add('dragging');
      ghost = drag.card.cloneNode(true); ghost.className = 'sl-card paper sl-ghost'; ghost.removeAttribute('data-card'); ghost.setAttribute('aria-hidden', 'true'); document.body.append(ghost);
    }
    if (!ghost) return;
    ghost.style.left = e.clientX + 'px'; ghost.style.top = (e.clientY - 26) + 'px';
    const pos = targetAt(e.clientX, e.clientY);
    positions.forEach((el, i) => el.classList.toggle('drop-target', i === pos));
  });
  root.addEventListener('pointerup', (e) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    const { id, moved } = drag, pos = targetAt(e.clientX, e.clientY);
    clearDrag(); suppressClick = Date.now() + 450;
    if (!canPlay()) return;
    if (moved) { selected = id; paint(); if (pos >= 0) place(pos); }
    else choose(id);
  });
  root.addEventListener('pointercancel', clearDrag);
  root.addEventListener('lostpointercapture', () => { if (drag) clearDrag(); });
  return {
    update(nm) {
      m = nm; const old = st; st = slState(m);
      if (drag && (!canPlay() || old?.word !== st.word)) clearDrag();
      if (old && old.log.length !== st.log.length) {
        flash = ''; if (!st.race || !st.hands[seat].includes(selected)) selected = null; Sound.pop();
        if (st.refreshes > old.refreshes) note('Fresh word — keep your cards. Go!');
      }
      paint();
      if (old && old.word !== st.word) {
        const last = st.log[st.log.length - 1];
        if (last.k === 'play') positions[last.pos].animate([{ transform: 'translateY(-18px) rotate(-5deg)', opacity: .5 }, { transform: 'translateY(0) rotate(0)', opacity: 1 }], { duration: 260, easing: 'ease-out' });
      }
      if (old && st.refreshes > old.refreshes) positions.forEach((el) => el.animate([{ opacity: .3, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 240, easing: 'ease-out' }));
      if (st.winner && !finished) {
        finished = true; recordResult(m, st.winner); endArea.replaceChildren(endBar(m));
        const won = st.winner === seat, draw = st.winner === 'draw';
        endSheetSoon(m, () => dead, 700, { title: draw ? 'A wordy draw' : won ? st.reason === 'empty' ? 'Your last card. You win!' : 'Fewer cards. You win!' : `${P} wins!`,
          body: st.reason === 'empty' ? 'All ten cards played. Nicely done.' : `Neither hand can change the word. You have ${st.hands[seat].length} cards left; ${P} has ${st.hands[opp].length}. Fewest cards wins.`, good: won });
      }
    },
    isOver() { return !!st?.winner; },
    relayout() {},
    destroy() { dead = true; clearTimeout(timer); clearDrag(); },
  };
}
