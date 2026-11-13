// Maths Chain phone screen (server: server/games/maths.js). The view says which of five screens this
// phone shows: waiting (listen to …), turn (your step + keypad), done (shout your answer on), checker
// (the whole chain so far) or teamDone. The keypad is built once per round so typed digits survive pushes.
'use strict';
window.SabhaGames = window.SabhaGames || {};

(function () {
  const TN = { red: 'Red', blue: 'Blue' };
  const tag = p => (p ? `${p.name} (#${p.seat})` : '');

  function strip(view) {
    const s = h('div.mc-strip', { 'aria-label': `Step ${Math.min(view.pos + 1, view.L)} of ${view.L}` });
    for (let i = 0; i < view.L; i++) s.append(h('i' + (i < view.pos ? '.done' : i === view.pos && !view.teamDone ? '.now' : '')));
    return s;
  }

  SabhaGames.maths = {
    render(el, view, api) {
      if (api.fresh || !el._mc) {
        const top = h('div.mc-top');
        const banner = h('div.mc-banner');
        const body = h('div.mc-body');
        const kp = Keypad({ maxLen: 3, label: 'Your answer', submitText: 'Send', onSubmit: v => api.send('answer', { value: v }) });
        el.replaceChildren(top, banner, body);
        el._mc = { top, banner, body, kp, key: null, turnKey: null, lockUntil: 0, status: null };
      }
      const m = el._mc;
      const me = view.me || {};
      const team = view.team;

      m.top.replaceChildren(
        h('p.kicker', { text: `Maths Chain · Round ${view.round}` }),
        h('p.mc-progress', { text: view.teamDone ? `All ${view.L} steps done` : `Step ${view.pos + 1} of ${view.L}` }),
        strip(view));
      m.banner.replaceChildren(...(view.otherDone && !view.teamDone ? [h('div.mc-other', { text: `${TN[view.otherDone.team]} finished! Keep going!` })] : []));

      // what to draw; only rebuild when it changes (the keypad keeps its value)
      const key = JSON.stringify([view.status, view.pos, view.solving, view.listen, view.answer, view.next, view.steps, view.incoming,
        view.hintAvailable, view.wrong, view.sofar && view.sofar.length, view.attempts, view.teamDone && view.teamDone.time]);
      if (key === m.key) return this.lockSync(m, view);
      m.key = key;

      if (view.status === 'turn' && view.turnKey !== m.turnKey) {
        m.turnKey = view.turnKey;
        m.kp.clear();
        api.buzz([200, 80, 200]); api.flash('turn'); api.sound.turn();
      }
      if (view.status === 'teamDone' && m.status !== 'teamDone') { api.sound.win(); api.buzz([100, 50, 100, 50, 300]); }
      m.status = view.status;

      const B = [];
      switch (view.status) {
        case 'turn': {
          const steps = view.steps || [];
          if (view.start != null) B.push(h('p.mc-say', null, 'Start: ', h('b.mc-num', { text: String(view.start) })));
          else if (view.incoming != null) B.push(h('p.mc-say', null, 'You should have heard ', h('b.mc-num', { text: String(view.incoming) })));
          else if (view.listen) B.push(h('p.mc-say', { text: `Use the number ${view.listen.name} shouted` }));
          if (steps.length > 1) {
            B.push(h('p.mc-say', { text: `Do ${steps[0].from}'s step first:` }), h('div.mc-step.small', { text: steps[0].text }),
              h('p.mc-say', { text: 'then yours:' }), h('div.mc-step', { text: steps.slice(1).map(s => s.text).join(', then ') }));
          } else if (steps[0] && steps[0].from) {
            B.push(h('p.mc-say', { text: `Do ${steps[0].from}'s step:` }), h('div.mc-step', { text: steps[0].text }));
          } else {
            B.push(h('p.mc-say', { text: 'Your step:' }), h('div.mc-step', { text: steps[0] ? steps[0].text : '' }));
          }
          if (view.wrong) B.push(h('p.mc-wrong', { text: 'Not right. Check the number you heard.' }));
          if (view.hintAvailable) B.push(h('button.btn.ghost.mc-hint', { onclick: () => api.send('hint'), text: 'Show the number I should have heard (+10 s)' }));
          B.push(m.kp.el);
          break;
        }
        case 'waiting': {
          const listenIsSolving = view.listen && view.solving && view.listen.name === view.solving.name;
          B.push(h('p.mc-say', { text: `You're ${TN[team]} #${me.seat}.` }));
          B.push(h('p.mc-listen', null, listenIsSolving ? 'You\'re next! ' : '', 'Listen to ', h('b', { text: tag(view.listen) })));
          if (view.solving && !listenIsSolving) B.push(h('p.mc-say', { text: `Player #${view.solving.seat} is solving now.` }));
          B.push(h('p.sub', { text: 'Your phone buzzes when it\'s your turn.' }));
          break;
        }
        case 'done':
          B.push(h('p.mc-say', { text: view.last ? 'Done! You did the last step.' : 'Done! Shout' }));
          B.push(h('div.mc-answer', { text: String(view.answer) }));
          if (view.next) B.push(h('p.mc-listen', null, 'to ', h('b', { text: tag(view.next) })));
          if (view.solving && !view.last) B.push(h('p.sub', { text: `Now solving: ${tag(view.solving)}` }));
          break;
        case 'checker': {
          B.push(h('p.mc-listen', { text: 'You\'re a checker this round' }));
          B.push(h('p.sub', { text: 'Catch mistakes and tell people who to listen to.' }));
          const ch = h('div.mc-chain');
          ch.append(h('span.mc-v', { text: String(view.start) }));
          for (const s of view.sofar || []) ch.append(h('span.mc-op', { text: s.text }), h('span.mc-v', { text: String(s.value) }));
          ch.append(h('span.mc-op', { text: '…' }));
          B.push(ch);
          if (view.solving) B.push(h('p.mc-say', { text: `Solving now: ${tag(view.solving)}${view.attempts ? ` · ${view.attempts} wrong` : ''}` }));
          break;
        }
        case 'teamDone': {
          const t = view.teamDone.time;
          B.push(h('div.mc-celebrate', { text: `${TN[team]} finished!` }));
          B.push(h('div.mc-answer', { text: fmtClock(t) }));
          if (view.teamDone.penalty) B.push(h('p.sub', { text: `including ${view.teamDone.penalty / 1000} s of hints` }));
          B.push(h('p.sub', { text: view.otherDone ? 'Both teams are done.' : 'Waiting for the other team…' }));
          break;
        }
      }
      m.body.classList.toggle('tight', view.status === 'turn' && !!(view.wrong || view.hintAvailable || (view.steps || []).length > 1));
      m.body.replaceChildren(...B);
      this.lockSync(m, view);
    },
    lockSync(m, view) {
      const until = view.status === 'turn' ? (view.lockUntil || 0) : 0;
      if (until !== m.lockUntil) { m.lockUntil = until; if (until) m.kp.lock(until); }
    },
    fx(d, api) {
      if (d && d.game === 'maths' && d.kind === 'turn') { /* the view push draws the turn; buzz happens there */ }
    },
  };
})();
