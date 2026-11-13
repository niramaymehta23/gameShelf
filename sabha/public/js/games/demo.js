// Tap Race: the test-only demo game (server/games/demo.js). Smallest example of a game screen.
'use strict';
window.SabhaGames = window.SabhaGames || {};
SabhaGames.demo = {
  render(el, view, api) {
    if (api.fresh) {
      el.replaceChildren(
        h('p.kicker', { text: 'Tap Race' }),
        h('div.score.demo-team', { text: '0' }),
        h('p.sub.demo-mine', { text: '' }),
        h('button.btn.main.demo-tap', { text: 'TAP!', onpointerdown: e => { e.preventDefault(); api.send('tap'); } }),
        h('div.timer-big', { 'data-ends': api.round.endsAt }));
    }
    el.querySelector('.demo-team').textContent = view.team;
    el.querySelector('.demo-mine').textContent = `You: ${view.mine}`;
  },
};
