'use strict';
// ================= lobby screens =================
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const TILE_POINTS = { A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, J: 8, K: 5, L: 1, M: 3, N: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10 };
const codeTile = (c) => h('span', { class: 'tile' }, c, h('sub', null, TILE_POINTS[c] || 1));
const randCode = () => Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

Screens.loading = () => ({
  cls: 'waiting',
  mount(el) {
    el.append(h('div', { class: 'chair' }, h('span', { class: 'pulse-dots' }, h('i'), h('i'), h('i')), 'Setting the table'));
  },
});

Screens.missing = () => ({
  cls: 'waiting',
  mount(el) {
    el.append(
      h('div', { class: 'display h2' }, 'This table has been cleared'),
      h('p', { class: 'muted' }, `Table ${G.code} no longer exists. Set up a new one or join with a fresh code.`),
      h('button', { class: 'btn btn-primary', onclick: () => { closeTable(); route(); } }, 'Back to the start'),
    );
  },
});

Screens.landing = () => {
  let mode = G.pendingJoin ? 'join' : 'start';
  let el;
  const S = {
    cls: 'landing',
    mount(e) { el = e; draw(); },
  };
  function nameField() {
    const input = h('input', { id: 'nameInput', type: 'text', maxlength: '16', placeholder: 'your name', autocomplete: 'nickname', autocapitalize: 'words', enterkeyhint: 'done', value: G.name || '' });
    input.addEventListener('input', () => { G.name = input.value.trim(); Pref.set('name', G.name); refreshButtons(); });
    return h('label', { class: 'name-tag', for: 'nameInput' }, h('span', null, 'Hello, my name is'), input);
  }
  function refreshButtons() {
    el.querySelectorAll('[data-needs-name]').forEach((b) => { b.disabled = !G.name; });
  }
  function draw() {
    el.replaceChildren();
    const hero = h('div', { class: 'paper hero-card' },
      h('div', { class: 'tape', style: 'top:-12px;left:50%;margin-left:-44px;transform:rotate(3deg)' }),
      h('img', { class: 'wc', src: 'art/hero.png', alt: '' }),
      h('h1', { class: 'display h1', style: 'margin:0' }, 'Our Game Shelf'),
      h('p', null, 'Board games for two, played on two phones, wherever you both are.'),
    );
    const card = h('div', { class: 'paper form-card' }, h('div', { class: 'tape sage', style: 'top:-11px;right:26px;width:70px;transform:rotate(-5deg)' }));
    if (mode === 'start') {
      card.append(
        nameField(),
        h('div', { class: 'stack' },
          h('button', { class: 'btn btn-primary', 'data-needs-name': '', onclick: create }, 'Set up a table'),
          h('button', { class: 'btn btn-ink', 'data-needs-name': '', onclick: () => { Sound.tap(); mode = 'join'; draw(); } }, 'Join with a code'),
        ),
      );
    } else {
      const err = h('div', { class: 'form-error', id: 'joinErr' });
      const tiles = [0, 1, 2, 3].map(() => h('span', { class: 'tile empty' }));
      const input = h('input', { id: 'codeInput', 'aria-label': 'Four-letter table code', maxlength: '4', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', inputmode: 'text', enterkeyhint: 'go' });
      let last = '';
      const paint = () => {
        const v = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
        if (input.value !== v) input.value = v;
        tiles.forEach((t, i) => {
          const ch = v[i] || '';
          if (ch && ch !== last[i]) { t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop'); }
          t.replaceChildren(ch, ch ? h('sub', null, TILE_POINTS[ch] || 1) : '');
          t.classList.toggle('empty', !ch);
          t.classList.toggle('cursor', i === v.length && document.activeElement === input);
        });
        last = v;
        go.disabled = v.length < 4 || !G.name;
        err.textContent = '';
      };
      const go = h('button', { class: 'btn btn-primary', onclick: () => join(input.value, err, go) }, 'Sit down');
      input.addEventListener('input', () => { Sound.tap(); paint(); if (input.value.length === 4 && G.name) join(input.value, err, go); });
      input.addEventListener('focus', paint); input.addEventListener('blur', paint);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.length === 4) join(input.value, err, go); });
      if (G.pendingJoin) { input.value = G.pendingJoin; G.pendingJoin = null; }
      card.append(
        nameField(),
        h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
          h('label', { class: 'code-label', for: 'codeInput' }, 'Table code'),
          h('div', { class: 'code-entry' }, h('div', { class: 'rack' }, ...tiles), input)),
        err, go,
      );
      setTimeout(() => { paint(); }, 0);
    }
    el.append(hero, card);
    if (mode === 'join') el.append(h('button', { class: 'back-link', onclick: () => { mode = 'start'; draw(); } }, '← I’m setting up the table'));
    else el.append(h('p', { class: 'hand-note', style: 'margin-top:auto' }, 'One of you sets up a table and shares the four-letter code. The other joins with it.'));
    refreshButtons();
  }
  async function create(e) {
    const btn = e.currentTarget; btn.disabled = true; Sound.pick();
    try {
      for (let i = 0; i < 6; i++) {
        const code = randCode();
        const s = await Net.doc('tables/' + code).get();
        if (s.exists) continue;
        const ok = await write('tables/' + code, { code, created: Date.now(), host: { dev: G.dev, name: G.name }, guest: null, current: null, results: {} }, { set: true });
        if (ok) openTable(code);
        else btn.disabled = false;
        return;
      }
      toast('Couldn’t find a free code. Try again.'); btn.disabled = false;
    } catch (err) { btn.disabled = false; toast('Couldn’t set up a table. Check your connection.'); }
  }
  async function join(raw, err, btn) {
    const code = String(raw || '').toUpperCase();
    if (code.length !== 4 || btn.dataset.busy) return;
    btn.dataset.busy = '1'; btn.disabled = true;
    try {
      const s = await Net.doc('tables/' + code).get();
      if (!s.exists) { err.textContent = `No table called ${code}. Check the letters and try again.`; Sound.lose(); return; }
      Sound.pick();
      openTable(code, { joining: true });
    } catch (e2) { err.textContent = 'Couldn’t reach the table. Check your connection.'; }
    finally { delete btn.dataset.busy; btn.disabled = false; }
  }
  return S;
};

Screens.seat = () => {
  let el;
  return {
    cls: 'waiting',
    mount(e) { el = e; },
    update() { draw(); },
    onPeers() { draw(); },
  };
  function draw() {
    const t = G.table; if (!t) return;
    el.replaceChildren(
      h('div', { class: 'display h2' }, 'This table is full'),
      h('p', { class: 'muted', style: 'margin:0' }, 'Two people are already sitting here. If one of them is you on this phone, take your seat back.'),
      ...['host', 'guest'].filter((s) => t[s]).map((s) => {
        const busy = Live.seatOnline(s);
        return h('button', {
          class: 'btn btn-felt', disabled: busy || null,
          onclick: () => { G.claimed = true; write('tables/' + G.code, { [s]: { dev: G.dev, name: t[s].name } }); },
        }, busy ? `${t[s].name} is playing right now` : `I’m ${t[s].name}`);
      }),
      h('button', { class: 'back-link', onclick: () => { closeTable(); route(); } }, 'Leave this table'),
    );
  }
};

Screens.waiting = () => ({
  cls: 'waiting',
  mount(el) {
    const code = G.code;
    const link = `${location.origin}/?join=${code}`;
    const copyBtn = h('button', { class: 'btn btn-primary', onclick: async () => {
      Sound.tap();
      if (navigator.share) {
        try { await navigator.share({ title: 'Our Game Shelf', text: `Come play! Our table code is ${code}.`, url: link }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      try { await navigator.clipboard.writeText(link); toast('Invite link copied'); }
      catch (e) { toast(`Your code is ${code.split('').join(' ')}`); }
    } }, 'Send an invite');
    el.append(
      h('div', { class: 'paper code-card' },
        h('div', { class: 'tape', style: 'top:-12px;left:30px;transform:rotate(-6deg)' }),
        h('div', { class: 'tape rose', style: 'top:-12px;right:30px;width:64px;transform:rotate(5deg)' }),
        h('span', { class: 'eyebrow' }, 'Your table is ready'),
        h('div', { class: 'display h2' }, 'Here’s your code'),
        h('div', { class: 'rack', 'aria-label': 'Table code ' + code.split('').join(' ') }, ...code.split('').map(codeTile)),
        h('p', { class: 'script' }, 'Send your partner the invite. It opens this page with the code already filled in.'),
        h('img', { class: 'wc sprig', src: 'art/sprig-b.png', alt: '' }),
      ),
      h('div', { class: 'chair' }, h('span', { class: 'pulse-dots' }, h('i'), h('i'), h('i')), 'Saving them a seat'),
      h('div', { class: 'stack', style: 'margin-top:auto' },
        copyBtn,
        h('button', { class: 'btn btn-ghost', onclick: () => openSheet({
          title: 'Clear this table?', body: 'The code will stop working.',
          actions: [
            { label: 'Clear the table', kind: 'ink', onClick: async () => { const c = G.code; closeTable(); route(); try { await Net.doc('tables/' + c).delete(); } catch (e) {} } },
            { label: 'Keep waiting', kind: 'ghost' },
          ],
        }) }, 'Cancel'),
      ),
    );
  },
});

// ---------------- shelf ----------------
const GAMES = {
  c4: {
    name: 'Connect Four', cls: 'c4', art: 'art/box-c4.png',
    rules: ['Rock, paper, scissors (best of 3) decides who drops first.', 'First player is red, second is yellow.', 'Line up four in a row, across, down or diagonally.'],
  },
  bs: {
    name: 'Battleships', cls: 'bs', art: 'art/box-bs.png',
    rules: ['Rock, paper, scissors (best of 3) decides who fires first.', 'Hide your five ships on your chart. Your partner can’t see them.', 'Take turns firing. A hit earns you another shot.', 'Sink every ship to win.'],
  },
  gw: { name: 'Guess Who?', cls: 'gw', soon: true, art: 'art/box-gw.png' },
};

Screens.shelf = () => {
  let el, note, sheet;
  const boxes = {};
  const savedId = (key) => (G.table && G.table.saved && G.table.saved[key]) || null;
  const S = {
    cls: 'shelf-screen',
    mount(e) {
      el = e;
      const P = partnerName();
      el.append(h('div', { class: 'shelf-head' },
        h('span', { class: 'script' }, `${myName()} & ${P}’s`),
        h('h1', { class: 'display h2', style: 'margin:0' }, 'Pick a game'),
      ));
      const cubby = h('div', { class: 'cubby' });
      for (const key of ['c4', 'bs', 'gw']) {
        const g = GAMES[key];
        const box = h('button', { class: `gbox ${g.cls}${g.soon ? ' soon' : ''}`, 'aria-label': g.name + (g.soon ? ', coming soon' : '') },
          h('img', { class: 'wc', src: g.art, alt: '' }),
          h('span', { class: 'lbl' }, g.name),
          g.soon ? h('span', { class: 'sticker' }, 'Soon') : h('span', { class: 'sticker saved', hidden: true }, 'Saved'));
        box.addEventListener('click', () => pick(key, box));
        boxes[key] = box;
        cubby.append(box);
      }
      sheet = h('div', { class: 'score-grid' });
      const lower = h('div', { class: 'dresser-lower' },
        h('div', { class: 'paper score-sheet' },
          h('div', { class: 'tape', style: 'top:-10px;left:40%;width:70px;transform:rotate(-3deg)' }),
          h('h3', null, 'The score'), sheet),
        h('img', { class: 'wc sprig', src: 'art/sprig-a.png', alt: '' }));
      const dresser = h('div', { class: 'dresser sage-wood' },
        h('div', { class: 'cornice sage-wood' }), cubby, h('div', { class: 'shelf-board sage-wood' }), lower);
      note = h('p', { class: 'hand-note shelf-note' });
      el.append(dresser, note,
        h('div', { class: 'shelf-foot' },
          h('button', { class: 'btn btn-ghost', onclick: () => openSheet({
            title: 'Get up from the table?',
            body: `You can come back any time with code ${G.code}.`,
            actions: [{ label: 'Leave the table', kind: 'ink', onClick: () => { closeTable(); route(); } }, { label: 'Stay', kind: 'ghost' }],
          }) }, 'Leave the table'),
        ));
    },
    update() { paintScore(); paintNote(); paintSaved(); },
    onPeers() { paintNote(); },
  };
  function paintScore() {
    const res = (G.table && G.table.results) || {};
    const short = (n) => String(n || '').split(' ')[0];
    const cells = [h('span'), h('span', { class: 'hd n' }, short(myName())), h('span', { class: 'hd n' }, short(partnerName()))];
    for (const key of ['c4', 'bs']) {
      let me = 0, them = 0;
      for (const id in res) { const r = res[id]; if (r.g !== key) continue; if (r.w === G.seat) me++; else if (r.w === other(G.seat)) them++; }
      cells.push(h('span', null, GAMES[key].name), h('span', { class: 'n' }, me), h('span', { class: 'n' }, them));
    }
    sheet.replaceChildren(...cells);
  }
  function paintNote() {
    const p = Live.partner();
    note.textContent = p ? `${partnerName()}’s at the shelf too. Whoever picks a game asks the other to join.` : `${partnerName()} isn’t here right now. Pick a game and they’ll be asked to join when they’re back.`;
  }
  function paintSaved() {
    for (const key in boxes) { const s = boxes[key].querySelector('.sticker.saved'); if (s) s.hidden = !savedId(key); }
  }
  function pick(key, box) {
    const g = GAMES[key];
    Sound.tap(); vibrate(8);
    if (g.soon) { box.classList.add('pulled'); setTimeout(() => box.classList.remove('pulled'), 400); toast('Guess Who? is still on order'); return; }
    box.classList.add('pulled');
    const saved = savedId(key);
    const body = h('div', { class: 'sheet-body' },
      saved ? h('p', { style: 'margin:0 0 8px' }, `You have a saved game. Carry on where you left off, or start a new one (the saved game is thrown away).`) : null,
      h('ul', null, ...g.rules.map((r) => h('li', null, r))));
    openSheet({
      title: g.name, body,
      actions: saved
        ? [{ label: 'Carry on the saved game', kind: 'primary', onClick: () => { Sound.pick(); resumeMatch(saved); } },
          { label: 'Start a new game', kind: 'ink', onClick: () => { Sound.pick(); startMatch(key); } },
          { label: 'Put it back', kind: 'ghost' }]
        : [{ label: `Play ${g.name}`, kind: 'primary', onClick: () => { Sound.pick(); startMatch(key); } }, { label: 'Put it back', kind: 'ghost' }],
    });
    setTimeout(() => box.classList.remove('pulled'), 700);
  }
  return S;
};

// ---------------- match shell ----------------
Screens.match = () => {
  let el, phaseEl, phase = null, phaseName = null, introDone = false;
  const S = {
    cls: 'match',
    mount(e) {
      el = e;
      const m = G.match;
      introDone = Pref.get('intro:' + m.id) === '1';
      el.append(h('div', { class: 'match-head' },
        h('button', { class: 'pill-back', html: ICON.back + '<span>Shelf</span>', onclick: confirmLeave }),
        h('div', { class: 'title' }, GAMES[m.game].name),
      ));
      phaseEl = h('div', { class: 'phase' });
      el.append(phaseEl);
      Wake.on();
      if (!joinedBy(m, other(G.seat))) toast(`Waiting for ${partnerName()} to join…`, 3200);
    },
    update() {
      const m = G.match; if (!m) return;
      const st = rpsState(m);
      const want = (!st.starter || !introDone) ? 'rps' : m.game;
      if (want !== phaseName) setPhase(want);
      phase && phase.update(m);
    },
    onPeers() { phase && phase.onPeers && phase.onPeers(); },
    relayout() { if (phaseName) { const n = phaseName; phaseName = null; setPhase(n); phase.update(G.match); } },
    unmount() { phase && phase.destroy && phase.destroy(); Wake.off(); closeSheet(); },
  };
  function setPhase(name) {
    phase && phase.destroy && phase.destroy();
    phaseEl.replaceChildren();
    phaseName = name;
    const box = h('div', { style: 'flex:1;display:flex;flex-direction:column;min-height:0;animation:screenIn .4s var(--ease-out) both' });
    phaseEl.append(box);
    const ctx = { onIntroDone: () => { introDone = true; Pref.set('intro:' + G.match.id, '1'); S.update(); } };
    if (name === 'rps') phase = makeRPS(box, ctx);
    else if (name === 'c4') phase = makeC4(box, ctx);
    else phase = makeBS(box, ctx);
  }
  function confirmLeave() {
    Sound.tap();
    const m = G.match;
    const over = phase && phase.isOver && phase.isOver();
    if (over || !hasProgress(m)) { backToShelf(); return; } // nothing to save yet
    openSheet({
      title: 'Leave this game?',
      body: `Save it to finish another time, or quit. Either way it stops for ${partnerName()} too, and they’ll see what you chose.`,
      actions: [
        { label: 'Save and quit', kind: 'primary', onClick: () => saveAndQuit(m) },
        { label: 'Quit without saving', kind: 'ink', onClick: () => quitGame(m) },
        { label: 'Keep playing', kind: 'ghost' },
      ],
    });
  }
  return S;
};

function endSheet(m, { title, sub, body, good, art }) {
  const game = m.game;
  if (good) Sound.win(); else Sound.lose();
  openSheet({
    title, sub, body, art,
    actions: [
      { label: 'Rematch', kind: 'primary', onClick: () => rematch(m.id, game) },
      { label: 'Back to the shelf', kind: 'ghost', onClick: backToShelf },
    ],
  });
}
function endBar(m) {
  return h('div', { class: 'btn-row', style: 'width:100%' },
    h('button', { class: 'btn btn-primary', onclick: () => { Sound.pick(); rematch(m.id, m.game); } }, 'Rematch'),
    h('button', { class: 'btn btn-ghost', onclick: () => { Sound.tap(); backToShelf(); } }, 'Shelf'),
  );
}
