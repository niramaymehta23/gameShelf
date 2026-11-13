// Shout It Out: player screen. Top half: your instruction with a draining bar. Bottom half: your
// 4 buttons. The server decides everything; a press is just {type: 'press', button}.
'use strict';
window.SabhaGames = window.SabhaGames || {};

SabhaGames.shout = {
  render(el, view, api) {
    if (api.fresh || !el.querySelector('.so-wrap')) {
      el.replaceChildren(h('div.so-wrap', null,
        h('div.so-top', null, h('span.so-hits', { text: '' }), h('span.so-clock', { 'data-ends': api.round && api.round.endsAt || '' })),
        h('section.so-instr', { 'aria-live': 'polite' },
          h('div.so-kicker', { text: 'PRESS' }),
          h('div.so-text', { text: '' }),
          h('div.so-bar', null, h('i.so-fill'))),
        h('section.so-tiles'),
        h('div.so-banner', { hidden: true }, h('b', { text: 'Controls changed!' }), h('span', { text: 'Your buttons have new names' }))));
      el._so = { tiles: {}, renamedAt: null, instrId: null };
    }
    const S = el._so;
    S.view = view;
    const team = api.team === 'red' ? 'Red' : 'Blue';
    el.querySelector('.so-hits').textContent = `${team}: ${view.hits || 0} hit${view.hits === 1 ? '' : 's'}${view.practice ? ' · practice' : ''}`;

    // instruction
    const box = el.querySelector('.so-instr');
    const text = el.querySelector('.so-text');
    const kicker = el.querySelector('.so-kicker');
    const i = view.instr;
    box.classList.toggle('idle', !i);
    if (i) {
      kicker.textContent = 'PRESS';
      if (S.instrId !== i.id) { S.instrId = i.id; box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop'); }
      text.textContent = i.text;
    } else {
      S.instrId = null;
      kicker.textContent = '';
      text.textContent = view.waiting ? 'Waiting for teammates…' : 'Next one coming…';
    }
    S.instr = i;
    S.lockUntil = view.lockUntil || 0;

    // tiles: rebuilt only when the names change (start, or "Controls changed!" at 2:00)
    const tiles = el.querySelector('.so-tiles');
    const sig = (view.buttons || []).map(b => b.id + b.label).join('|');
    if (tiles.dataset.sig !== sig) {
      tiles.dataset.sig = sig;
      S.tiles = {};
      tiles.replaceChildren(...(view.buttons || []).map(b => {
        const t = h('button.so-tile', {
          type: 'button', 'data-button': b.id, 'data-colour': b.colour, 'aria-label': b.label,
          style: `--tile:${b.bg};--tile-fg:${b.fg}`, // custom properties need the string form
          onpointerdown: e => { e.preventDefault(); api.sound.tap(); api.send('press', { button: b.id }); t.classList.remove('down'); void t.offsetWidth; t.classList.add('down'); },
        }, h('span.w1', { text: b.word1 }), h('span.w2', { text: b.word2 }));
        S.tiles[b.id] = t;
        return t;
      }));
    }
    if (view.renamedAt && S.renamedAt !== view.renamedAt) {
      if (!api.fresh) this.controls(el, api); // a phone reconnecting after 2:00 just sees the new names
      S.renamedAt = view.renamedAt;
    }
    this.tick(el, api);
  },

  controls(el, api) {
    const b = el.querySelector('.so-banner');
    if (!b || !b.hidden) return;
    b.hidden = false;
    api.buzz([100, 60, 100]); api.sound.turn();
    setTimeout(() => { b.hidden = true; }, 2200);
  },

  fx(d, api) {
    const el = api.el;
    if (!el || !d || d.game !== 'shout') return;
    const S = el._so || {};
    if (d.type === 'tileGood' || d.type === 'tileBad') {
      const t = S.tiles && S.tiles[d.button];
      if (t) { const c = d.type === 'tileGood' ? 'hit' : 'miss'; t.classList.remove('hit', 'miss'); void t.offsetWidth; t.classList.add(c); setTimeout(() => t.classList.remove(c), 600); }
      if (d.type === 'tileGood') { api.sound.good(); api.buzz(60); }
    } else if (d.type === 'timeout') {
      const box = el.querySelector('.so-instr');
      if (box) { box.classList.remove('late'); void box.offsetWidth; box.classList.add('late'); setTimeout(() => box.classList.remove('late'), 700); }
      api.sound.bad();
    } else if (d.type === 'controls') {
      this.controls(el, api);
    }
  },

  tick(el, api) {
    const S = el._so;
    if (!S) return;
    const tiles = el.querySelector('.so-tiles');
    const locked = api.now() < (S.lockUntil || 0);
    if (tiles && tiles.classList.contains('locked') !== locked) tiles.classList.toggle('locked', locked);
    if (tiles) tiles.dataset.wait = locked ? `Wrong button! Wait ${Math.ceil((S.lockUntil - api.now()) / 1000)}` : '';
    const fill = el.querySelector('.so-fill');
    const i = S.instr;
    if (!fill) return;
    if (!i) { fill.style.transform = 'scaleX(0)'; return; }
    const left = Math.max(0, Math.min(1, (i.deadline - api.now()) / i.timer));
    fill.style.transform = `scaleX(${left})`;
    fill.classList.toggle('low', left < 0.3);
  },
};
