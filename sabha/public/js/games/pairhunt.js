// Pair Hunt: the player's screen. A big symbol (drawn in SVG, its name in capitals underneath so
// colour-blind players aren't disadvantaged), "Show my code", and a keypad for the partner's code.
'use strict';
window.SabhaGames = window.SabhaGames || {};

(function () {
  const INK = {
    red: '#d7262b', blue: '#1f5fd1', green: '#1f9a48', yellow: '#f6c400', purple: '#7d3fbb', orange: '#f27a12',
  };
  const STAR = (() => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 19 : 44;
      pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(53 + r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  })();
  const SHAPE_SVG = {
    circle: '<circle cx="50" cy="50" r="40"/>',
    triangle: '<polygon points="50,9 93,88 7,88"/>',
    square: '<rect x="13" y="13" width="74" height="74" rx="3"/>',
    star: `<polygon points="${STAR}"/>`,
    heart: '<path d="M50 88 C20 66 7 50 7 32 C7 18 18 9 30 9 C40 9 46 15 50 23 C54 15 60 9 70 9 C82 9 93 18 93 32 C93 50 80 66 50 88 Z"/>',
    moon: '<path d="M62 8 A42 42 0 1 0 62 92 A34 34 0 1 1 62 8 Z"/>',
    diamond: '<polygon points="50,5 90,50 50,95 10,50"/>',
    cross: '<polygon points="37,8 63,8 63,37 92,37 92,63 63,63 63,92 37,92 37,63 8,63 8,37 37,37"/>',
  };
  function symbolSvg(shape, colour) {
    return `<svg viewBox="0 0 100 100" class="ph-svg" aria-hidden="true"><g fill="${INK[colour] || '#888'}" stroke="#1d2433" stroke-width="3.5" stroke-linejoin="round">${SHAPE_SVG[shape] || ''}</g></svg>`;
  }

  // per-phone bits that don't come from the server: the 5 s code reveal and the screen we built
  const S = { kp: null, gid: null, lock: 0, revealUntil: 0, revealTimer: null };

  function build(el, api) {
    S.kp = api.Keypad({
      maxLen: 2, autoSubmit: true, label: "Enter your partner's code", submitText: 'Check',
      onSubmit: v => api.send('code', { code: v }),
    });
    S.gid = null; S.lock = 0; S.revealUntil = 0;
    el.replaceChildren(
      h('div.ph-top', null, h('span.ph-count'), h('span.ph-mine')),
      h('div.ph-hunt', null,
        h('div.ph-tile', null, h('div.ph-sym'), h('div.ph-name')),
        h('div.ph-trio'),
        h('button.ph-show', { type: 'button', onpointerdown: e => { e.preventDefault(); reveal(el); } }),
        h('div.ph-pad', null, S.kp.el),
        h('div.ph-typed', { text: 'Done! Now one more person in your trio types a code.' })),
      h('div.ph-msg', null, h('div.ph-msg-big'), h('div.ph-msg-sub')));
  }

  function reveal(el) {
    api_sound();
    S.revealUntil = Date.now() + 5000;
    paintShow(el);
    clearTimeout(S.revealTimer);
    S.revealTimer = setTimeout(() => paintShow(el), 5050);
  }
  function api_sound() { try { Sound.tap(); } catch (e) {} }

  function paintShow(el) {
    const btn = el.querySelector('.ph-show');
    if (!btn) return;
    const on = Date.now() < S.revealUntil && S.code;
    btn.classList.toggle('on', !!on);
    btn.replaceChildren(on ? h('span', null, h('small', { text: 'My code' }), h('b', { text: S.code })) : h('span', { text: 'Show my code' }));
  }

  SabhaGames.pairhunt = {
    render(el, v, api) {
      if (api.fresh || !el.querySelector('.ph-hunt')) build(el, api);
      const team = TEAM_NAME[api.team] || '';
      el.querySelector('.ph-count').textContent = `${team}: ${v.teamPairs || 0} pair${v.teamPairs === 1 ? '' : 's'}`;
      el.querySelector('.ph-mine').textContent = v.mine ? `You: ${v.mine}` : '';
      const hunting = v.status === 'hunt';
      el.querySelector('.ph-hunt').hidden = !hunting;
      el.querySelector('.ph-msg').hidden = hunting;
      if (hunting) {
        if (v.gid !== S.gid) {
          S.gid = v.gid; S.revealUntil = 0; S.kp.clear();
          el.querySelector('.ph-sym').innerHTML = symbolSvg(v.symbol.shape, v.symbol.colour);
          el.querySelector('.ph-name').textContent = v.symbol.name;
          const tile = el.querySelector('.ph-tile');
          tile.classList.remove('pop'); void tile.offsetWidth; tile.classList.add('pop');
        }
        S.code = v.code;
        paintShow(el);
        const trio = v.size >= 3;
        el.querySelector('.ph-trio').textContent = trio ? 'Group of three: two of you type a code.' : '';
        el.querySelector('.ph-trio').hidden = !trio;
        const done = trio && v.typed;
        el.querySelector('.ph-pad').hidden = done;
        el.querySelector('.ph-typed').hidden = !done;
        if (v.lockUntil && v.lockUntil !== S.lock) { S.lock = v.lockUntil; if (v.lockUntil > api.now()) S.kp.lock(v.lockUntil); }
      } else {
        S.gid = null;
        const big = el.querySelector('.ph-msg-big'), sub = el.querySelector('.ph-msg-sub');
        const msg = {
          matched: ['Matched!', 'New symbol coming…'],
          dropped: ['Your partner dropped out', 'New symbol coming…'],
          waiting: ['Waiting for others…', 'You get a new symbol as soon as someone else is free.'],
          offline: ['Reconnecting…', ''],
        }[v.status] || ['Waiting for others…', ''];
        big.textContent = msg[0]; sub.textContent = msg[1];
        el.querySelector('.ph-msg').classList.toggle('good', v.status === 'matched');
      }
    },
    fx(d, api) {
      if (d.game !== 'pairhunt') return;
      if (d.kind === 'newsym') { api.flash('turn'); api.buzz([60, 40, 60]); api.sound.turn(); }
      if (d.kind === 'typed') { api.sound.good(); }
      if (d.kind === 'own') {
        api.sound.bad();
        const note = api.el && api.el.querySelector('.kp-lock');
        if (note) { note.textContent = "That's your own code. Type your partner's."; setTimeout(() => { if (note.textContent.startsWith("That's")) note.textContent = ''; }, 2500); }
      }
    },
  };
})();
