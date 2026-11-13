'use strict';
// A dummy game used only by tests (and the core "done when" check): tap the big button, 1 point a tap.
// Hidden from the host's game list (not in GAME_ORDER). Also the smallest example of the plug-in shape.

module.exports = {
  id: 'demo',
  name: 'Tap Race',
  rule: 'Tap the big button as fast as you can.',
  hostSays: '"Tap the big button as fast as you can. Go!"',
  championship: false,
  normalise: true,
  rounds: () => [{ n: 1, label: 'Round 1', ms: 30000 }],
  create(ctx) {
    const taps = {};
    return {
      start() { ctx.pushAll(); },
      onAction(pid, a) {
        if (a.type !== 'tap') return;
        const team = ctx.teamOf(pid);
        taps[pid] = (taps[pid] || 0) + 1;
        ctx.award(team, [pid], 'tap', 1, 'tap');
        ctx.track(pid, 'taps');
        ctx.fx(pid, { kind: 'good' });
        ctx.pushTeam(team);
      },
      onTick() {},
      onPlayerOffline() {}, onPlayerOnline() {},
      view(pid) { return { mine: taps[pid] || 0, team: ctx.raw(ctx.teamOf(pid)) }; },
      hostView() { return { lines: ['Red ' + ctx.raw('red') + ' taps', 'Blue ' + ctx.raw('blue') + ' taps'] }; },
      end() {
        const lines = {};
        for (const t of ['red', 'blue']) lines[t] = `${t === 'red' ? 'Red' : 'Blue'} tapped ${ctx.raw(t)} times`;
        return { lines, stats: { red: { taps: ctx.raw('red') }, blue: { taps: ctx.raw('blue') } } };
      },
    };
  },
};
