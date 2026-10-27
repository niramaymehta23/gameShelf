'use strict';
// ================= rock · paper · scissors (who goes first) =================
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const VERB = { rock: 'Rock blunts scissors', scissors: 'Scissors cut paper', paper: 'Paper wraps rock' };
const HAND_ART = { rock: 'art/rps-rock.png', paper: 'art/rps-paper.png', scissors: 'art/rps-scissors.png' };
const CRACK = '<svg class="crack" viewBox="0 0 100 120" preserveAspectRatio="none" aria-hidden="true"><path d="M8 20l22 18-6 14 20 10-4 18 22 12 10 20M60 0l-6 26 18 8-8 22 22 10" fill="none" stroke="rgba(30,15,5,.75)" stroke-width="3" stroke-linejoin="round"/></svg>';
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function rpsState(m) {
  const rps = (m && m.rps) || {};
  const rounds = []; const wins = { host: 0, guest: 0 }; let starter = null; let k = 1;
  for (; k <= 60; k++) {
    const r = rps['r' + k];
    if (!r || !r.host || !r.guest) break;
    const w = r.host === r.guest ? null : (BEATS[r.host] === r.guest ? 'host' : 'guest');
    if (w) wins[w]++;
    rounds.push({ k, host: r.host, guest: r.guest, w });
    if (w && wins[w] >= 2) { starter = w; break; }
  }
  const cur = starter ? {} : (rps['r' + k] || {});
  return { rounds, wins, starter, k: starter ? null : k, cur };
}

function handFace(choice, tag = 'div') {
  const L = choice[0].toUpperCase();
  return h(tag, { class: 'hand', 'aria-label': cap(choice) },
    h('span', { class: 'idx a', 'aria-hidden': 'true' }, L),
    h('img', { class: 'wc', src: HAND_ART[choice], alt: '' }),
    h('span', { class: 'nm' }, cap(choice)),
    h('span', { class: 'idx b', 'aria-hidden': 'true' }, L));
}
function handBack(chosen) {
  return h('div', { class: 'hand back', 'aria-label': chosen ? 'Chosen' : 'Choosing' },
    h('b', null, chosen ? '✓' : '?'),
    h('small', null, chosen ? 'Chosen' : h('span', { class: 'ticking' }, 'Choosing', h('i', null, '.'), h('i', null, '.'), h('i', null, '.'))));
}

function makeRPS(box, ctx) {
  const seat = G.seat, opp = other(seat), P = partnerName();
  let m = null, shown = -1, busy = false, pending = false, starterShown = false, dead = false, localPick = null;
  const pip = () => h('i', { class: 'pip' });
  const myPips = [pip(), pip()], theirPips = [pip(), pip()];
  const sbMid = h('div', { class: 'sb-mid' });
  const sb = h('div', { class: 'scoreboard paper' },
    h('div', { class: 'sb-side' }, h('div', { class: 'sb-name' }, 'You'), h('div', { class: 'pips' }, ...myPips)),
    sbMid,
    h('div', { class: 'sb-side right' }, h('div', { class: 'sb-name' }, P), h('div', { class: 'pips' }, ...theirPips)),
  );
  const topSlot = h('div', { class: 'slot top' }, h('div', { class: 'slot-label' }, P));
  const botSlot = h('div', { class: 'slot bottom' }, h('div', { class: 'slot-label' }, 'You'));
  const verdict = h('div', { class: 'verdict' });
  const arena = h('div', { class: 'arena' }, topSlot, verdict, botSlot);
  const hint = h('div', { class: 'rps-hint' });
  const choiceBtns = {};
  const choices = h('div', { class: 'choices' }, ...['rock', 'paper', 'scissors'].map((c) => {
    const b = handFace(c, 'button');
    b.addEventListener('click', () => pick(c));
    choiceBtns[c] = b;
    return b;
  }));
  const root = h('div', { class: 'rps' }, sb, arena, hint, choices);
  box.append(root);
  let topCard = null, botCard = null, topKey = '', botKey = '';

  function setTop(card, key) {
    if (key === topKey) return topCard;
    topKey = key;
    if (topCard) topCard.remove();
    topCard = card;
    if (card) { topSlot.append(card); card.animate([{ transform: 'scale(.85)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.34,1.56,.64,1)' }); }
    return card;
  }
  function setBot(card, key, rise) {
    if (key === botKey) return botCard;
    botKey = key;
    if (botCard) botCard.remove();
    botCard = card;
    if (card) {
      botSlot.append(card);
      if (rise) card.animate([{ transform: 'translateY(140px) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.9,.25,1)' });
    }
    return card;
  }
  function renderScore() {
    const st = rpsState(m);
    const w = { host: 0, guest: 0 };
    st.rounds.slice(0, shown).forEach((r) => { if (r.w) w[r.w]++; });
    myPips.forEach((p, i) => p.classList.toggle('on', i < w[seat]));
    theirPips.forEach((p, i) => p.classList.toggle('on', i < w[opp]));
    sbMid.replaceChildren(`Round ${Math.min(shown + 1, 60)}`, h('small', null, 'best of three'));
  }
  function renderChoosing(st) {
    const mine = st.cur[seat] || localPick;
    const theirs = st.cur[opp];
    setTop(handBack(!!theirs), theirs ? 'back-y' : 'back-n');
    // once you've picked, their face-down card bobs and its dots tick: that's the "waiting for them" signal
    topCard.classList.toggle('waiting', !!mine && !theirs);
    if (mine) setBot(handFace(mine), 'face-' + mine, true); else setBot(null, '');
    choices.classList.toggle('locked', !!mine);
    for (const c in choiceBtns) choiceBtns[c].classList.toggle('picked', c === mine);
    choices.style.opacity = '';
    hint.textContent = mine ? ''
      : (theirs ? `${P} has chosen. Your pick stays hidden until you both choose.` : 'Pick one. Nobody sees it until you’ve both chosen.');
  }
  function pick(c) {
    if (pending || busy || !m) return;
    const st = rpsState(m);
    if (!st.k || st.cur[seat]) return;
    pending = true; localPick = c;
    Sound.pick(); vibrate(10);
    renderChoosing(st);
    write(`tables/${G.code}/matches/${m.id}`, { rps: { ['r' + st.k]: { [seat]: c } } }).then((ok) => {
      pending = false;
      if (!ok) { localPick = null; if (!dead) renderChoosing(rpsState(m)); }
    });
  }
  async function animateRound(r) {
    const myC = r[seat], theirC = r[opp];
    choices.classList.add('locked');
    for (const c in choiceBtns) choiceBtns[c].classList.toggle('picked', c === myC);
    choices.style.opacity = '.35';
    hint.textContent = '';
    setBot(handFace(myC), 'face-' + myC, true);
    // their card drops in from the top of the screen
    topKey = 'reveal';
    if (topCard) topCard.remove();
    topCard = handFace(theirC);
    topSlot.append(topCard);
    Sound.whoosh();
    await settle(topCard.animate([
      { transform: 'translateY(-75vh) rotate(-16deg)', offset: 0 },
      { transform: 'translateY(10px) rotate(4deg)', offset: 0.72 },
      { transform: 'translateY(-4px) rotate(-1deg)', offset: 0.88 },
      { transform: 'none', offset: 1 },
    ], { duration: 680, easing: 'cubic-bezier(.4,.1,.5,1)' }));
    if (dead) return;
    await sleep(160);
    // clash
    Sound.clack(); vibrate(15);
    topCard.animate([{ transform: 'none' }, { transform: 'translateY(26px) scale(1.06)' }, { transform: 'none' }], { duration: 280, easing: 'ease-in-out' });
    await settle(botCard.animate([{ transform: 'none' }, { transform: 'translateY(-26px) scale(1.06)' }, { transform: 'none' }], { duration: 280, easing: 'ease-in-out' }));
    if (dead) return;
    const v1 = h('div', { class: 'v1' }), v2 = h('div', { class: 'v2' });
    if (r.w) {
      const meWon = r.w === seat;
      const win = meWon ? botCard : topCard, lose = meWon ? topCard : botCard;
      win.classList.add('won'); lose.classList.add('lost'); lose.append(svgEl(CRACK));
      lose.animate([{ transform: 'none' }, { transform: 'rotate(-7deg) translateY(8px) scale(.94)' }], { duration: 320, fill: 'forwards', easing: 'cubic-bezier(.34,1.56,.64,1)' });
      win.animate([{ transform: 'none' }, { transform: 'scale(1.1)' }, { transform: 'scale(1.04)' }], { duration: 420, fill: 'forwards' });
      v1.textContent = meWon ? 'You take the round' : `${P} takes the round`;
      v2.textContent = VERB[r[r.w]];
      if (meWon) Sound.ding(); else Sound.lose();
    } else {
      v1.textContent = 'Tie! Go again';
      v2.textContent = `You both picked ${myC}`;
      [topCard, botCard].forEach((c) => c.classList.add('shake'));
      [topCard, botCard].forEach((c) => c.animate([{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '0 0' }], { duration: 300 }));
    }
    verdict.replaceChildren(v1, v2);
    verdict.classList.remove('show'); void verdict.offsetWidth; verdict.classList.add('show');
    shown++; renderScore(); shown--;
    await sleep(1600);
    if (dead) return;
    const cards = [topCard, botCard].filter(Boolean);
    await Promise.all(cards.map((c) => settle(c.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.9)' }], { duration: 220, fill: 'forwards' }))));
    verdict.classList.remove('show'); verdict.replaceChildren();
    setTop(null, ''); setBot(null, '');
    localPick = null;
  }
  function showStarter(starter) {
    const meFirst = starter === seat;
    const game = m.game;
    const line = game === 'c4'
      ? (meFirst ? 'You’re red, and red drops first.' : `You’re yellow. ${P} is red and drops first.`)
      : (meFirst ? 'Hide your fleet, then you fire the first shot.' : `Hide your fleet, then ${P} fires the first shot.`);
    let done = false;
    const finish = () => { if (done || dead) return; done = true; Sound.tap(); ctx.onIntroDone(); };
    const card = h('div', { class: 'starter-card' },
      h('div', { class: 'paper' },
        h('div', { class: 'tape', style: 'top:-12px;left:50%;margin-left:-44px;transform:rotate(-3deg)' }),
        game === 'c4' ? h('div', { class: 'disc-demo disc ' + (meFirst ? 'red' : 'yellow') }) : h('img', { class: 'wc', src: 'art/box-bs.png', alt: '', style: 'width:64px;height:auto;border-radius:4px' }),
        h('div', { class: 'display h2', style: 'color:var(--ink)' }, meFirst ? 'You go first!' : `${P} goes first`),
        h('div', { class: 'line' }, line),
        h('button', { class: 'btn btn-felt', onclick: finish }, game === 'c4' ? 'To the board' : 'Place my ships'),
      ));
    choices.style.opacity = '0'; hint.textContent = '';
    root.append(card);
    if (meFirst) Sound.win(); else Sound.ding();
    setTimeout(finish, 3600);
  }
  async function step() {
    if (busy || dead || !m) return;
    const st = rpsState(m);
    if (st.rounds.length > shown) {
      busy = true;
      await animateRound(st.rounds[shown]);
      busy = false;
      if (dead) return;
      shown++;
      renderScore();
      return step();
    }
    if (st.starter) {
      if (!starterShown) { starterShown = true; showStarter(st.starter); }
      return;
    }
    renderScore();
    renderChoosing(st);
  }
  return {
    update(nm) {
      m = nm;
      if (shown < 0) { shown = rpsState(m).rounds.length; renderScore(); }
      step();
    },
    destroy() { dead = true; },
  };
}
