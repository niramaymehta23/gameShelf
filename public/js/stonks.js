'use strict';
// Two-phone UI and optional local rooms. Shared seed/log follow the existing trusted-client model; only the viewer’s own hand is rendered.
const STONKS = (() => {
  let room = null, state = null, revealed = false, selected = null, root, error = '';
  let mode = 'local', ownSeat = null, pendingSend = false, match = null, finishedShown = false;
  let expandedStacks = new Set(), paymentSelected = new Set(), paymentKey = '', flipping = null;
  const C = Stonks.cards, S = Stonks.sectors;
  const button = (label, fn, kind = 'ghost') => h('button', { class: 'btn btn-' + kind, onclick: fn, disabled: pendingSend || null }, label);
  const money = n => n ? n + 'M' : 'No payment value';
  const saved = () => { try { const x = JSON.parse(Pref.get('stonks-room')); return x?.version === 1 ? x : null; } catch (_) { return null; } };
  function start() { mode = 'local'; ownSeat = null; G.localStonks = true; revealed = false; selected = null; error = ''; room = saved(); state = room && room.dealt ? Stonks.replay(room) : null; route(); }
  function exit() { G.localStonks = false; revealed = false; route(); }
  function dispatch(cmd) {
    if (mode === 'online') { sendOnline(cmd); return; }
    try {
      const before = Stonks.actor(state), next = Stonks.apply(state, { ...cmd, by: before });
      room.log.push({ ...cmd, by: before }); state = next; Pref.set('stonks-room', JSON.stringify(room));
      if (Stonks.actor(state) !== before) revealed = false;
      selected = null; error = ''; Sound.tap(); draw();
    } catch (e) { error = e.message; draw(); }
  }
  const shortEffect = c => c.kind === 'revenue' ? (c.single ? 'One opponent pays revenue.' : 'Each opponent pays revenue.') : ({pitch:'Draw two cards.',invoice:'Collect 5M from one opponent.',party:'Each opponent pays 2M.',steal:'Take from an incomplete portfolio.',swap:'Swap a Company; take from incomplete.',takeover:'Take a complete portfolio.',legal:'Block an action targeting you.',hype:'Double a Revenue Call.',growth:'Add 3M revenue to a complete portfolio.',ipo:'Add 4M revenue. Needs Growth Round.'})[c.effect] || c.text;
  const cardDetail = c => (!state || state.rulesVersion===2) && c.effect==='legal' ? c.detail.replace('Never costs a play, even on your turn; banking it does.','Responding and banking both cost no plays.')
    : (!state || state.rulesVersion===2) && c.effect==='pitch' ? 'Drawn Companies and Funding go straight onto the table. Drawn actions may be used if plays remain, or banked free.' : c.detail;
  function ladder(group) {
    const sector = S[group];
    return h('table', {class:'st-ladder','aria-label':sector.name+' revenue'}, h('caption',null,'Revenue'),
      h('tbody',null,...sector.revenue.map((amount,i)=>h('tr',null,h('th',{scope:'row'},String(i+1)),h('td',null,amount+'M'),i+1===sector.size?h('td',{class:'st-full'},'Full'):h('td')))));
  }
  function cardFace(id, click, options={}) {
    const c=C[id], groups=c.kind==='company'?[c.group]:c.groups||[], group=options.group||groups[0];
    const el=h(click?'button':'div',{class:'st-card paper st-face-'+c.kind+(selected===id?' selected':'')+(flipping===id?' st-flipping':''),
      ...(click?{onclick:click,'aria-pressed':String(paymentSelected.has(id)||selected===id),disabled:pendingSend||null}:{}),
      'aria-label':c.title+(c.value?' · '+c.value+'M':' · no payment value'),title:cardDetail(c),'data-card':id});
    const value=h('span',{class:'st-value-badge'},c.value?c.value+'M':'—');
    if(options.money) {
      el.classList.add('st-face-money');el.append(value,h('span',{class:'st-kind'},'Treasury'),h('strong',{class:'st-money-mark'},c.value+'M'),h('span',{class:'st-card-foot'},c.title),h('span',{class:'st-card-foot'},'Money only'));
      return el;
    }
    if(c.kind==='company') {
      el.style.setProperty('--card-colour','var(--s-'+group+')');el.style.setProperty('--card-ink',['brown','dblue','black','red'].includes(group)?'var(--cream)':'var(--ink)');
      el.append(value,h('strong',{class:'st-company-banner st-name'},c.title),ladder(group),h('span',{class:'st-card-foot'},S[group].colour+' · '+S[group].size+' to complete'));
    } else if(c.kind==='wild') {
      el.classList.add(groups.length===2?'st-dual':'st-any');
      if(groups.length===2) {
        const alternate=groups.find(g=>g!==group);
        el.style.setProperty('--card-colour','var(--s-'+group+')');el.style.setProperty('--card-ink',['brown','dblue','black','red'].includes(group)?'var(--cream)':'var(--ink)');el.style.setProperty('--flip-ink',['brown','dblue','black','red'].includes(alternate)?'var(--cream)':'var(--ink)');
        el.append(value,h('strong',{class:'st-company-banner st-name'},c.title),h('span',{class:'st-active-sector'},S[group].name),ladder(group),
          h('span',{class:'st-flip-banner',style:'background:var(--s-'+alternate+')'},S[alternate].name),h('span',{class:'st-card-foot'},'Tap to flip · free'));
      } else {
        el.append(h('div',{class:'st-rainbow','aria-hidden':'true'},...groups.map(g=>h('i',{style:'background:var(--s-'+g+')'}))),
          h('strong',{class:'st-name'},c.title),h('span',{class:'st-any-mark'},'ANY'),h('span',{class:'st-card-foot'},'Any sector'),h('span',{class:'st-no-value'},'No payment value'));
      }
    } else if(c.kind==='funding') {
      el.append(value,h('span',{class:'st-kind'},'Funding'),h('strong',{class:'st-money-mark'},c.value+'M'),h('span',{class:'st-card-foot'},'Treasury money'));
    } else if(c.kind==='reference') {
      el.append(h('strong',{class:'st-name'},c.title),h('span',{class:'st-text'},c.text));
    } else {
      el.classList.add('st-effect-'+(c.effect||'revenue'));
      el.append(value,h('span',{class:'st-kind'},c.kind==='revenue'?'Revenue Call':'Action'),h('div',{class:'st-action-stamp'},h('strong',{class:'st-name'},c.title)),
        h('span',{class:'st-effect-line'},shortEffect(c)),h('span',{class:'st-value-badge st-value-end','aria-hidden':'true'},c.value+'M'));
      if(groups.length)el.append(h('div',{class:'st-rainbow st-revenue-colours','aria-hidden':'true'},...groups.map(g=>h('i',{style:'background:var(--s-'+g+')'}))));
    }
    return el;
  }
  function rules() {
    const house = !state || state.rulesVersion===2;
    const overrides = {Setup:'Five cards each, then the starter draws two. Funding is banked automatically. Companies and wilds are placed on the table automatically; only actions and Revenue Calls stay in hand. Best-of-three rock, paper, scissors decides the starter.',
      'Three plays':'Use up to three actions, Revenue Calls or upgrades. Banking an action or Revenue Call is free, including after play three, and makes it Treasury money permanently. Automatic Company/Funding placement, wild flips and valid rearrangements cost no plays.',
      'Draw and finish':'Draw two at the start of each turn, or five if your action hand started empty. Funding and Companies go straight onto the table. Finish by discarding excess action cards down to seven. Reshuffle used cards when the draw pile runs out.'};
    const body = h('div', { class: 'st-rules' },h('p',{class:'st-rules-version'},house?'Your house rules · automatic table placement and free banking':'Saved game · original document rules'), ...STONKS_DATA.rules.map(([t, text]) => h('details', null, h('summary', null, t), h('p', null, house&&overrides[t]?overrides[t]:text))),
      h('details', null, h('summary', null, 'Every card face · 110 cards'), house?h('p',null,'The four Reference cards retain the original document text. Use the house rules above for automatic placement and free banking.'):null, h('div', { class: 'st-catalogue' }, ...STONKS_DATA.cards.map(c => h('div', null, cardFace(c.id), h('p', null, cardDetail(c)))))));
    const previousFocus = document.activeElement;
    openSheet({ title: 'STONKS · rules & cards', body, actions: [{ label: 'Back to the table', kind: 'ghost', onClick: () => previousFocus?.focus() }] });
    const panel = document.querySelector('#sheet .panel');
    panel.setAttribute('aria-label', 'STONKS rules and all card faces');
    panel.tabIndex = -1; panel.focus();
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); previousFocus?.focus(); }
      if (e.key === 'Tab') {
        const focusable = [...panel.querySelectorAll('summary, button')].filter(x => x.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    });
  }
  function setup() {
    const names = [G.name || 'Niramay', (G.table && G.table[other(G.seat)]?.name) || 'Your partner'];
    const fields = h('div', { class: 'st-setup-fields' });
    names.forEach((name, i) => {
      const input = h('input', { id: 'st-name-' + i, value: name, maxlength: '24', required: true, oninput: () => { names[i] = input.value; } });
      fields.append(h('label', null, i === 0 ? 'You' : 'Your partner', input));
    });
    root.append(h('div', { class: 'paper st-setup' }, h('div', { class: 'tape sage' }), h('img', { class: 'wc st-box-art', src: '/art/box-st.png', alt: '' }),
      h('p', { class: 'eyebrow' }, 'A business empire on the table'), h('h1', { class: 'display h1' }, 'STONKS'),
      h('p', { class: 'hand-note' }, 'From WeWobble to BatGPT. Three complete portfolios win.'),
      h('p', null, 'Local room · two players on this device. Pass it at each handoff; hands stay hidden until the next player is ready.'),
      h('form', { onsubmit: e => {
        e.preventDefault();
        room = { version: 1, rulesVersion: 2, code: randCode(), names: names.slice(), seed: rid() + rid(), starter: 0, log: [], rps: {} };
        try { state = null; Pref.set('stonks-room', JSON.stringify(room)); error = ''; revealed = false; draw(); } catch (e) { error = e.message; draw(); }
      } }, fields, h('p', { class: 'hand-note' }, 'Rock, paper, scissors. Best of three decides who starts.'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Who goes first?')),
      button('Rules & all 110 cards', rules)));
  }
  function opener() {
    const st = rpsState({ rps: room.rps }), names = room.names;
    const who = st.cur.host ? 1 : 0;
    const rps = h('div', { class: 'st-opener rps' });
    rps.append(h('div', { class: 'scoreboard paper' },
      h('div', { class: 'sb-side' }, h('div', { class: 'sb-name' }, names[0]), h('div', { class: 'pips' }, ...[0,1].map(i => h('i', { class: 'pip' + (i < st.wins.host ? ' on' : '') })))),
      h('div', { class: 'sb-mid' }, 'Round ' + (st.k || st.rounds.length), h('small', null, 'best of three')),
      h('div', { class: 'sb-side right' }, h('div', { class: 'sb-name' }, names[1]), h('div', { class: 'pips' }, ...[0,1].map(i => h('i', { class: 'pip' + (i < st.wins.guest ? ' on' : '') }))))));
    const last = st.rounds.at(-1);
    if (last && !st.cur.host) rps.append(h('div', { class: 'paper st-rps-result' },
      h('p', { class: 'hand-note' }, last.w ? names[last.w === 'host' ? 0 : 1] + ' takes the round. ' + VERB[last[last.w]] : 'Tie! Go again.'),
      h('div', { class: 'st-rps-pair' }, handFace(last.host), handFace(last.guest))));
    if (st.starter) {
      const starter = st.starter === 'host' ? 0 : 1;
      rps.append(h('div', { class: 'paper st-curtain' }, h('h1', { class: 'display h2' }, names[starter] + ' starts'),
        h('p', { class: 'hand-note' }, 'Actions in hand. Companies and Funding go straight onto the table.'),
        button('Open the table', () => { room.starter = starter; room.dealt = true; state = Stonks.replay(room); Pref.set('stonks-room', JSON.stringify(room)); revealed = false; draw(); }, 'primary')));
    } else if (!revealed) {
      rps.append(h('div', { class: 'paper st-curtain' }, h('div', { class: 'tape rose' }), h('h1', { class: 'display h2' }, 'Pass to ' + names[who]),
        h('p', null, st.cur.host ? names[0] + ' has chosen. Their pick stays hidden.' : 'Rock, paper, scissors decides who starts.'),
        button('I’m ' + names[who] + ' · ready', () => { revealed = true; draw(); }, 'primary')));
    } else {
      rps.append(h('p', { class: 'rps-hint' }, names[who] + ', pick your hand.'));
      const choices = h('div', { class: 'choices' });
      ['rock','paper','scissors'].forEach(c => {
        const b = handFace(c, 'button'); b.onclick = () => {
          const key = 'r' + st.k; room.rps[key] = { ...room.rps[key], [who === 0 ? 'host' : 'guest']: c };
          Pref.set('stonks-room', JSON.stringify(room)); revealed = false; Sound.pick(); draw();
        }; choices.append(b);
      }); rps.append(choices);
    }
    root.append(rps);
  }
  function choice(label, options, id) {
    const sel = h('select', { id }, ...options.map(([v, name]) => h('option', { value: String(v) }, name)));
    return { el: h('label', null, label, sel), get: () => sel.value };
  }
  const portLabel = p => S[p.group].name + ' · ' + p.cards.map(id => C[id].title).join(', ') + ' · ' + Stonks.revenue(p) + 'M revenue';
  function destinations(by, group, allowNew = true) {
    return [...(allowNew ? [['', 'New ' + S[group].name + ' portfolio']] : []), ...state.players[by].portfolios.filter(p => p.group === group && p.cards.length < S[group].size).map(p => [p.id, portLabel(p)])];
  }
  function wildPlacement(box, id, type, by, extra = {}) {
    const c = C[id], group = choice('Assign group', (c.groups || [c.group]).map(g => [g, S[g].name]), 'st-group');
    const destWrap = h('div'); let dest;
    const refresh = () => { dest = choice('Portfolio', destinations(by, group.get()), 'st-dest'); destWrap.replaceChildren(dest.el); };
    group.el.querySelector('select').onchange = refresh; refresh();
    box.append(group.el, destWrap, button(type === 'receive' ? 'Place incoming card' : type === 'move' ? 'Move card · free' : 'Lay company · 1 play', () => dispatch({ type, card: id, group: group.get(), dest: dest.get(), ...extra }), 'primary'));
  }
  function controls() {
    const by = Stonks.actor(state), p = state.players[by], box = h('div', { class: 'paper st-controls', 'aria-label': 'Required action' });
    if (state.incoming.length) {
      const id = state.incoming[0].id;
      box.append(h('h2', null, 'Place your incoming wild'), cardFace(id)); wildPlacement(box, id, 'receive', by); return box;
    }
    if (state.pending) {
      const q = state.pending, attacker = state.players[q.by].name;
      if(q.stage==='response')box.append(h('h2',null,'Legal Team response'),h('p',null,attacker+' · '+C[q.card].title+(q.amount?' · '+q.amount+'M demand':'')+(q.blocked?' · currently blocked':' · currently active')));
      if (q.stage === 'response') {
        box.append(h('p', null, q.blocked ? 'Counter with Legal Team to restore the action, or pass to keep it blocked.' : 'Use Legal Team to block the action, or pass to let it resolve.'));
        const legal=p.hand.find(id=>C[id].effect==='legal');
        if(legal)box.append(button('Play Legal Team · free',()=>dispatch({type:'legal',card:legal}),'primary'));
        box.append(button('Pass response', () => dispatch({ type: 'pass' }), 'ink'));
      } else {
        const ids = Stonks.assets(p);
        box.append(h('h2',null,'Pay '+q.amount+'M to '+attacker),h('p', null, 'Tap Treasury or Company cards. No change.'),
          h('output',{class:'hand-note','aria-live':'polite'},'Selected '+[...paymentSelected].reduce((n,id)=>n+C[id].value,0)+'M / '+q.amount+'M'));
        if (!ids.length) box.append(h('p', null, 'No payable assets. The debt is forgiven.'));
        box.append(button(ids.length ? 'Confirm payment' : 'Confirm no assets', () => dispatch({ type: 'pay', cards: [...paymentSelected] }), 'primary'));
      }
      return box;
    }
    if (state.phase === 'discard') {
      const ids = new Set(); box.append(h('h2', null, 'Discard ' + (p.hand.length - 7) + ' cards to finish'));
      for (const id of p.hand) { const inp = h('input', { type: 'checkbox', onchange: () => { if (inp.checked) ids.add(id); else ids.delete(id); } }); box.append(h('label', { class: 'st-check' }, inp, C[id].title + ' · ' + C[id].value+'M')); }
      box.append(button('Discard & finish turn', () => dispatch({ type: 'discard', cards: [...ids] }), 'primary')); return box;
    }
    if (selected) { box.classList.add('st-has-selection'); buildSelected(box, selected, by); }
    return box;
  }
  function buildSelected(box, id, by) {
    const p = state.players[by], c = C[id], inHand = p.hand.includes(id);
    box.append(h('div',{class:'st-selection-head'},h('h3',null,c.title),button('Rules',()=>inspect(id,Stonks.ownerPortfolio(p,id)?.group)),button('Put back',()=>{selected=null;draw();})),
      h('p',{class:'st-effect-preview'},['action','revenue'].includes(c.kind)?shortEffect(c):c.text));
    if (!inHand) {
      const port = Stonks.ownerPortfolio(p, id);
      if (!port) return;
      if (port.upgrades.includes(id)) {
        const dest = choice('Move upgrade to', p.portfolios.filter(x => x !== port && Stonks.complete(x) && !['black','grey'].includes(x.group)).map(x => [x.id, portLabel(x)]), 'st-dest');
        box.append(dest.el, button('Move upgrade · free', () => dispatch({ type: 'moveUpgrade', card: id, dest: dest.get() }), 'primary'));
      } else {
        wildPlacement(box, id, 'move', by);
        if (c.kind === 'company') {
          const replacements = p.portfolios.filter(x => x !== port && x.group === c.group).flatMap(x => x.cards.filter(i => C[i].kind === 'wild').map(i => [x.id + ':' + i, C[i].title + ' in ' + S[x.group].name]));
          if (replacements.length) {
            const replace = choice('Replace a wild; keep upgrades', replacements, 'st-replace');
            box.append(replace.el, button('Replace wild · free', () => { const [dest, wild] = replace.get().split(':'); dispatch({type:'replace',card:id,dest,replace:wild}); }, 'primary'));
          }
        }
      }
      return;
    }
    const bank=['funding','action','revenue'].includes(c.kind)&&(state.rulesVersion===2||state.plays<3)?button('Bank '+c.value+'M · '+(state.rulesVersion===2?'free':'1 play'),()=>dispatch({type:'bank',card:id}),'felt'):null;
    const options=use=>box.append(h('div',{class:'st-action-options'},bank,use));
    if (state.plays >= 3) { options();box.append(h('p', null, state.rulesVersion===2?'Three actions used. You may still bank for free or finish.':'No plays remain. Finish your turn.')); return; }
    if (c.kind === 'wild') { wildPlacement(box, id, 'lay', by); return; }
    if (c.kind === 'company') {
      box.append(button('Lay company · 1 play', () => dispatch({ type: 'lay', card: id }), 'primary'));
      const replacements = p.portfolios.filter(x => x.group === c.group).flatMap(x => x.cards.filter(i => C[i].kind === 'wild').map(i => [x.id + ':' + i, C[i].title + ' in ' + S[x.group].name]));
      if (replacements.length) {
        const replace = choice('Replace a wild; keep upgrades', replacements, 'st-replace');
        box.append(replace.el, button('Replace wild · 1 play', () => { const [dest, wild] = replace.get().split(':'); dispatch({ type: 'lay', card: id, dest, replace: wild }); }, 'primary'));
      }
      return;
    }
    if (c.kind === 'funding') { options();return; }
    if (['legal','hype'].includes(c.effect)) { options();box.append(h('p', null, c.effect === 'legal' ? 'Keep in hand to respond when an action targets you.' : 'Select a Revenue Call and add this Hype Cycle there.')); return; }
    if (c.effect === 'pitch' || c.effect === 'party') { options(button('Use action · 1 play', () => dispatch({ type: 'action', card: id }), 'primary')); return; }
    let target, portfolio, take, give;
    const targets = state.players.map((x, i) => [i, x.name]).filter(([i]) => i !== by);
    if (['invoice','steal','swap','takeover'].includes(c.effect) || c.single) { target = state.rulesVersion===2&&targets.length===1?{get:()=>String(targets[0][0]),el:h('p',{class:'st-target-label'},'To '+targets[0][1])}:choice('Opponent', targets, 'st-target'); box.append(target.el); }
    const detail = h('div', { class: 'st-form-detail' }); box.append(detail);
    function refreshTarget() {
      detail.replaceChildren();
      if (['steal','swap'].includes(c.effect)) {
        const ports = state.players[+target.get()].portfolios.filter(x => !Stonks.complete(x));
        take = choice('Take from incomplete portfolio', ports.flatMap(x => x.cards.map(i => [i, C[i].title + ' · ' + S[x.group].name])), 'st-take'); detail.append(take.el);
        if (c.effect === 'swap') { give = choice('Give one of your played cards', p.portfolios.flatMap(x => x.cards.map(i => [i, C[i].title + ' · ' + S[x.group].name])), 'st-give'); detail.append(give.el); }
      }
      if (c.effect === 'takeover') { portfolio = choice('Complete portfolio to take', state.players[+target.get()].portfolios.filter(Stonks.complete).map(x => [x.id, portLabel(x)]), 'st-portfolio'); detail.append(portfolio.el); }
    }
    if (target) { const select=target.el.querySelector('select');if(select)select.onchange = refreshTarget; refreshTarget(); }
    if(c.effect==='swap')detail.classList.add('st-swap-fields');
    if (['growth','ipo'].includes(c.effect) || c.kind === 'revenue') {
      const ports = p.portfolios.filter(x => c.kind === 'revenue' ? c.groups.includes(x.group) && Stonks.revenue(x) > 0 : Stonks.complete(x) && !['black','grey'].includes(x.group) && !x.upgrades.some(i => C[i].effect === c.effect) && (c.effect !== 'ipo' || x.upgrades.some(i => C[i].effect === 'growth')));
      portfolio = choice('Your portfolio', ports.map(x => [x.id, portLabel(x)]), 'st-portfolio'); detail.append(portfolio.el);
    }
    const hype = new Set(), preview = h('output', { class: 'hand-note', 'aria-live': 'polite' });
    function demand() { const port = p.portfolios.find(x => x.id === portfolio?.get()); preview.textContent = port && c.kind === 'revenue' ? 'Demand: ' + Stonks.revenue(port) * (2 ** hype.size) + 'M · ' + (c.single ? 'one opponent' : 'each opponent') + ' · ' + (1 + hype.size) + ' plays' : ''; }
    if (c.kind === 'revenue') {
      p.hand.filter(i => C[i].effect === 'hype').forEach(i => { const inp = h('input', { type: 'checkbox', onchange: () => { if (inp.checked) hype.add(i); else hype.delete(i); demand(); } }); box.append(h('label', { class: 'st-check' }, inp, 'Add Hype Cycle · +1 play')); });
      portfolio.el.querySelector('select').onchange = demand; demand(); box.append(preview);
    }
    options(button('Use action', () => dispatch({ type: 'action', card: id, ...(target ? { target: +target.get() } : {}), ...(portfolio ? { portfolio: portfolio.get() } : {}), ...(take ? { take: take.get() } : {}), ...(give ? { give: give.get() } : {}), ...(c.kind === 'revenue' ? { hype: [...hype] } : {}) }), 'primary'));
  }
  function inspect(id, group, moneyOnly=false) {
    openSheet({title:C[id].title,body:h('div',{class:'st-inspect'},cardFace(id,null,{group,money:moneyOnly}),h('p',null,moneyOnly?'Banked money stays in Treasury. It cannot be returned to hand or used as an action.':cardDetail(C[id]))),actions:[{label:'Back',kind:'ghost'}]});
  }
  function canEdit(by) {
    return revealed && by===(mode==='online'?ownSeat:Stonks.actor(state)) && by===state.turn && !state.pending && !state.incoming.length && state.phase==='play' && state.winner===null && !pendingSend;
  }
  function flipWild(id, by, group) {
    const port=Stonks.ownerPortfolio(state.players[by],id),next=C[id].groups.find(g=>g!==group);
    const dest=state.players[by].portfolios.find(p=>p.group===next&&p.cards.length<S[next].size);
    const flip=()=>{expandedStacks.delete(by+':'+group);expandedStacks.add(by+':'+next);flipping=id;dispatch({type:'move',card:id,group:next,dest:dest?.id||''});setTimeout(()=>{flipping=null;},800);};
    if(port.upgrades.length)openSheet({title:'Flip '+C[id].title+'?',body:'Moving this wild makes its current portfolio incomplete. Its attached upgrades will be discarded.',actions:[{label:'Flip to '+S[next].name,kind:'primary',onClick:flip},{label:'Keep it here',kind:'ghost'}]});
    else flip();
  }
  function togglePile(key) {
    if(expandedStacks.has(key)) {
      expandedStacks.delete(key);
      const [by,group]=key.split(':');
      if(selected&&Stonks.ownerPortfolio(state.players[+by],selected)?.group===group)selected=null;
    }else expandedStacks.add(key);
    draw();
  }
  function publicBoard(indices) {
    const board=h('div',{class:'st-public'}),viewer=mode==='online'?ownSeat:Stonks.actor(state);
    indices.forEach(i=>{
      const p=state.players[i],mine=i===viewer,total=p.treasury.reduce((n,id)=>n+C[id].value,0);
      const paying=mine&&revealed&&state.pending?.stage==='payment'&&Stonks.actor(state)===viewer;
      const section=h('section',{class:'st-player st-side '+(mine?'st-own-table':'st-other-table'),'aria-label':p.name+' public table'},
        h('div',{class:'st-player-head'},h('span',{class:'script'},mine?'Your table':p.name+'’s table'),h('span',{class:'script'},Stonks.colours(p).length+' / 3 colours')));
      const row=h('div',{class:'st-pile-row',role:'group','aria-label':p.name+' Company and Treasury stacks'}),spreads=h('div',{class:'st-spreads'});
      const entries=[{key:'money',label:'Treasury',ids:p.treasury,caption:total+'M',group:null},...Object.keys(S).filter(group=>p.portfolios.some(port=>port.group===group)).map(group=>{
        const ports=p.portfolios.filter(port=>port.group===group);
        const count=ports.reduce((n,port)=>n+port.cards.length,0);
        return {key:group,label:S[group].name,group,ports,ids:ports.flatMap(port=>[...port.cards,...port.upgrades]),caption:ports.some(Stonks.complete)?'Complete':count+' '+(count===1?'Company':'Companies')};
      })];
      for(const entry of entries) {
        const key=i+':'+entry.key,expanded=expandedStacks.has(key);
        const pile=h('button',{class:'st-stack paper'+(entry.group?' st-company-stack':' st-money-stack')+(expanded?' open':''),'data-stack':key,'aria-expanded':String(expanded),onclick:()=>togglePile(key)},
          h('strong',{class:'st-stack-heading',...(entry.group?{style:'background:var(--s-'+entry.group+')'}:{})},entry.label),
          h('span',{class:'st-stack-peeks'},...entry.ids.slice(-3).map(id=>h('span',{class:'st-stack-strip',...(entry.group?{style:'border-color:var(--s-'+entry.group+')'}:{})},C[id].title))),
          h('span',{class:'st-stack-total'},entry.caption));
        if(entry.group)pile.style.setProperty('--stack-ink',['brown','dblue','black','red'].includes(entry.group)?'var(--cream)':'var(--ink)');
        row.append(pile);
        if(!expanded)continue;
        const spread=h('div',{class:'paper st-spread','data-spread':key},h('button',{class:'st-put-down',onclick:()=>togglePile(key),'aria-label':'Put down '+entry.label+' stack'},entry.label+' · put down'));
        if(!entry.ids.length)spread.append(h('p',{class:'hand-note'},'No money banked yet.'));
        const portions=entry.ports||[{cards:entry.ids,upgrades:[]}];
        portions.forEach(port=>{
          if(entry.group)spread.append(h('p',{class:'st-spread-label'},port.cards.length+'/'+S[entry.group].size+' · '+Stonks.revenue(port)+'M revenue'+(Stonks.complete(port)?' · Complete':'')));
          const cards=h('div',{class:'st-spread-cards'});
          for(const id of [...port.cards,...port.upgrades]) {
            const payable=paying&&Stonks.assets(p).includes(id);
            const face=cardFace(id,()=>{
              if(payable) {
                if(paymentSelected.has(id))paymentSelected.delete(id);else paymentSelected.add(id);
                draw();return;
              }
              if(canEdit(i)&&entry.group) {
                if(C[id].kind==='wild'&&C[id].groups.length===2){flipWild(id,i,entry.group);return;}
                selected=id;draw();return;
              }
              inspect(id,entry.group,entry.key==='money');
            },{group:entry.group,money:entry.key==='money'});
            face.classList.toggle('st-pay-selected',paymentSelected.has(id));
            if(payable){face.classList.add('st-pay-card');face.setAttribute('aria-label','Pay with '+C[id].title+' · '+C[id].value+'M');}
            if(!payable&&C[id].kind==='wild'&&C[id].groups.length===2&&canEdit(i))face.setAttribute('aria-label','Flip '+C[id].title+' to '+S[C[id].groups.find(g=>g!==entry.group)].name);
            cards.append(face);
          }
          spread.append(cards);
        });spreads.append(spread);
      }
      if(!p.portfolios.length)row.append(h('span',{class:'st-empty-table hand-note'},'Your empire starts here.'));
      section.append(row,spreads);board.append(section);
    });return board;
  }
  function layoutHand(hand, ids) {
    const width=hand.clientWidth||root.clientWidth||320,cw=Math.max(72,Math.min(92,Math.floor(width/4.1))),ch=Math.round(cw*1.45);
    const perRow=Math.max(4,Math.min(7,Math.floor((width-cw)/44)+1)),rows=Math.max(1,Math.ceil(ids.length/perRow)),cols=Math.ceil(ids.length/rows)||1;
    hand.style.height=(ch+(rows-1)*ch*.7+20)+'px';
    [...hand.children].forEach((card,i)=>{
      const r=Math.floor(i/cols),col=i%cols,len=Math.min(cols,ids.length-r*cols),step=len>1?Math.min(cw+6,(width-cw)/(len-1)):0;
      card.style.cssText+=';width:'+cw+'px;height:'+ch+'px;left:'+((width-(cw+step*(len-1)))/2+col*step)+'px;top:'+(12+r*ch*.7)+'px;--tilt:'+((col-(len-1)/2)*1.2)+'deg;z-index:'+i;
    });
  }
  function discardView() {
    openSheet({title:'Used cards · '+state.discard.length,body:h('div',{class:'st-discard-cards'},...state.discard.map(id=>cardFace(id))),actions:[{label:'Back to the table',kind:'ghost'}]});
  }
  function draw() {
    if (!root) return; root.classList.toggle('st-table',!!state); root.replaceChildren();
    const top = h('div', { class: 'st-top' },
      h('div', { class: 'st-top-left' },
        h('button', { class: 'icon-btn', html: ICON.back, 'aria-label': 'Back to the shelf', onclick: exit }),
        h('button', { class: 'icon-btn', html: ICON.help, 'aria-label': 'Rules & cards', onclick: rules })),
      h('span', { class: 'display' }, 'STONKS'),
      h('button', { class: 'icon-btn', html: Sound.on ? ICON.soundOn : ICON.soundOff, 'aria-label': 'Sound on or off', 'aria-pressed': String(Sound.on), onclick: () => { document.querySelector('#soundBtn').click(); draw(); } })); if (mode === 'local') root.append(top);
    if (!state) { if (room) opener(); else setup(); return; }
    const by=Stonks.actor(state),viewer=mode==='online'?ownSeat:by,p=state.players[viewer],required=state.players[by],opponent=state.players.findIndex((_,i)=>i!==viewer);
    root.classList.add('st-table');
    const pay=state.pending?.stage==='payment'&&by===viewer?state.pending.card+':'+state.pending.by+':'+state.pending.targets[state.pending.index]:'';
    if(pay!==paymentKey){paymentKey=pay;paymentSelected=new Set();if(pay)expandedStacks.add(viewer+':money');}
    if(selected&&!p.hand.includes(selected)&&!Stonks.ownerPortfolio(p,selected))selected=null;
    const chip=(i,name)=>h('div',{class:'turn-chip'+(i===state.turn?' active':'')},h('span',null,name),h('b',{class:'script'},String(state.players[i].hand.length)));
    root.append(h('div',{class:'turnbar'},chip(viewer,'You'),chip(opponent,state.players[opponent].name)));
    const otherHand=h('div',{class:'st-other-hand','aria-label':state.players[opponent].name+' has '+state.players[opponent].hand.length+' action cards'},
      ...state.players[opponent].hand.slice(0,10).map(()=>h('i',{class:'st-card-back','aria-hidden':'true'})));
    root.append(otherHand,publicBoard([opponent]));
    const active=by===viewer&&revealed&&!pendingSend&&state.winner===null&&!state.pending&&!state.incoming.length;
    const urgent=!!(state.pending||state.incoming.length||state.phase==='discard');
    const decision=(urgent||selected)&&revealed&&(mode==='local'||by===ownSeat)?controls():null;
    const paymentDecision=decision&&state.pending?.stage==='payment';
    if(paymentDecision)decision.classList.add('st-payment-controls');
    const finish=button('Finish turn',()=>dispatch({type:'end'}),'ink');finish.disabled=!active;finish.classList.add('st-end-turn');
    const deck=h('button',{class:'st-draw-pile','aria-label':'Draw pile · '+state.deck.length+' cards',onclick:()=>openSheet({title:'Draw pile',body:'Cards are drawn automatically at the start of your turn. Pitch Deck draws two extra. Companies and Funding go straight onto the table in new games.',actions:[{label:'Back',kind:'ghost'}]})},h('i',{class:'st-card-back'},h('span',null,'S')),h('span',{class:'script'},String(state.deck.length)));
    const discard=h('button',{class:'st-used-pile','aria-label':'Discard pile · '+state.discard.length+' cards',onclick:discardView},state.discard.length?cardFace(state.discard.at(-1)):h('i',{class:'st-empty-discard'},'Used cards'),h('span',{class:'script'},String(state.discard.length)));
    if(!paymentDecision)root.append(h('div',{class:'st-arena'+(decision?' deciding':'')},decision||h('div',{class:'st-central-piles'},deck,discard,h('div',{class:'st-turn-tools'},
      h('span',{class:'script'},(3-state.plays)+' plays left'),h('div',{class:'st-play-pips','aria-hidden':'true'},...[0,1,2].map(i=>h('i',{class:i<state.plays?'used':''}))),finish))));
    const status=state.winner!==null?state.message:required.name+(state.incoming.length?' · choose the incoming wild’s sector':state.pending?(state.pending.stage==='response'?' · Legal Team response':' · choose payment'):state.phase==='discard'?' · discard to seven':by===viewer?' · your turn':' · taking their turn');
    root.append(h('div',{class:'status-line st-status',role:'status','aria-live':'polite'},status));
    if(paymentDecision)root.append(decision);
    root.append(publicBoard([viewer]));
    if(error)root.append(h('p',{class:'paper st-error',role:'alert'},error));
    if(state.winner!==null){
      root.append(h('div',{class:'paper st-win'},h('h1',{class:'display'},state.players[state.winner].name+' wins!'),h('p',{class:'hand-note'},'Three different complete portfolios.'),button(mode==='online'?'Back to the shelf':'Set up another room',mode==='online'?backToShelf:newRoom,'primary')));return;
    }
    if(!revealed){
      root.append(h('div',{class:'paper st-curtain'},h('div',{class:'tape rose'}),h('h1',{class:'display h2'},(mode==='online'?'Hand hidden · ':'Pass to ')+p.name),button('I’m '+p.name+' · reveal my hand',()=>{revealed=true;selected=null;draw();},'primary')));return;
    }
    const work=h('div',{class:'st-work'+(urgent?' responding':'')});
    work.append(h('div',{class:'st-hand-head'},h('span',{class:'script'},state.rulesVersion===2?'Your actions':'Your hand'),button('Hide hand',()=>{revealed=false;selected=null;draw();})));
    const hand=h('div',{class:'st-hand',role:'group','aria-label':'Your private hand'},...p.hand.map(id=>cardFace(id,()=>{
      if(mode==='online'&&by!==ownSeat){inspect(id);return;}
      if(state.pending||state.incoming.length||state.phase==='discard'){inspect(id);return;}
      selected=selected===id?null:id;draw();root.querySelector('.st-hand')?.scrollIntoView({block:'nearest',behavior:'smooth'});
    })));
    work.append(hand);
    if(!p.hand.length)work.append(h('p',{class:'hand-note st-empty-hand'},'No actions in hand. You can rearrange or finish your turn.'));
    if(mode==='online'&&by!==ownSeat)work.append(h('p',{class:'hand-note st-waiting',role:'status'},'Waiting for '+required.name+(state.pending?(state.pending.stage==='response'?' to respond.':' to choose payment.'):state.incoming.length?' to place their wild.':' to play.')));
    root.append(work);layoutHand(hand,p.hand);
    if(flipping)root.querySelector('.st-own-table [data-card="'+flipping+'"]')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
    if(mode==='local')root.append(h('div',{class:'st-bottom'},button('New local room',()=>openSheet({title:'Deal a new room?',body:'This replaces this device’s saved game.',actions:[{label:'Start a new room',kind:'primary',onClick:newRoom},{label:'Keep playing',kind:'ghost'}]}))));
  }
  function newRoom() { room = null; state = null; revealed = false; selected = null; expandedStacks=new Set(); paymentSelected=new Set(); paymentKey=''; Pref.del('stonks-room'); draw(); }
  Screens.stonks = () => ({ cls: 'st-screen', mount(el) { root = el; draw(); }, unmount() { root = null; revealed = false; selected = null; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && (G.localStonks || (mode === 'online' && root))) { revealed = false; selected = null; closeSheet(); draw(); } });
  window.render_game_to_text = () => {
    if(G.match?.game === 'hu' && !G.localStonks) {
      const s=huState(G.match);
      return JSON.stringify({mode:document.querySelector('.hu')?'hues':'hues-setup',rules:s.rules||'legacy',seat:G.seat,turn:s.turn,
        hand:document.querySelector('.hu')&&G.seat?s.hands[G.seat].map(id=>({id,label:hueName(HUE_DECK[id])})):[],opponentCount:G.seat?s.hands[other(G.seat)].length:0,
        pile:s.pile.length,colour:HUE_NAMES[s.colour],penalty:s.penalty,drawn:s.drawn,said:s.said,calloutLockedUntil:s.callWindow?.by===G.seat?s.callWindow.until:null,shuffles:s.shuffles?.[G.seat],winner:s.winner});
    }
    return (G.localStonks || (mode === 'online' && root)) && state ? JSON.stringify({ mode: mode === 'online' ? 'stonks-online' : 'stonks-local', room: room.code, turn: state.players[state.turn].name, required: state.players[Stonks.actor(state)].name, phase: state.incoming.length ? 'receive' : state.pending?.stage || state.phase, plays: state.plays, hand: revealed ? state.players[mode === 'online' ? ownSeat : Stonks.actor(state)].hand.map(id => ({ id, title: C[id].title })) : 'hidden', players: state.players.map(p => ({ name: p.name, handCount: p.hand.length, treasury: p.treasury, portfolios: p.portfolios })), winner: state.winner }) : JSON.stringify({ mode: G.localStonks ? (room ? 'stonks-rps' : 'stonks-setup') : 'shelf', ...(G.localStonks && room ? { names: room.names, round: rpsState({ rps: room.rps }).k, picks: 'hidden' } : {}) });
  };
  window.advanceTime = () => {}; // Turn-based rules have no simulation clock.
  function onlineRoom(m) {
    return { names: [G.table.host.name, G.table.guest.name], seed: m.seed || m.id, starter: rpsState(m).starter === 'host' ? 0 : 1,
      rulesVersion:m.stRulesVersion||1, code: G.code, log: sortedKeys(m.plays).map(k => m.plays[k]) };
  }
  async function sendOnline(cmd) {
    if (pendingSend || !match || Stonks.actor(state) !== ownSeat) return;
    const currentMatch = match, expected = room.log.length, command = { ...cmd, by: ownSeat }, currentPath = matchPath(match.id);
    try { Stonks.apply(state, command); } catch (e) { error = e.message; draw(); return; }
    pendingSend = true; error = ''; root?.querySelectorAll('.st-controls button, .st-hand button').forEach(b => { b.disabled = true; });
    try {
      await Net.timed(FB.fs.runTransaction(async tx => {
        const ref = FB.fs.doc(currentPath), snap = await tx.get(ref);
        if (!snap.exists) throw Error('This game is no longer available.');
        const latest = snap.data(), replayRoom = onlineRoom(latest);
        if (replayRoom.log.length !== expected) throw Error('The table changed. Please choose again.');
        if (G.table[G.seat]?.dev !== G.dev) throw Error('Your seat changed. Rejoin the table.');
        Stonks.apply(Stonks.replay(replayRoom), command);
        tx.update(ref, { ['plays.p' + String(expected).padStart(5, '0')]: command });
      }));
      selected = null; Sound.tap();
    } catch (e) { error = e.message || 'Could not reach the table. Try again.'; }
    finally { pendingSend = false; if (mode === 'online' && match?.id === currentMatch.id && root) draw(); }
  }
  function mountOnline(el, m) {
    mode = 'online'; ownSeat = G.seat === 'host' ? 0 : 1; root = el; root.classList.add('st-online', 'st-screen');
    state = null; match = m; revealed = true; selected = null; error = ''; pendingSend = false; finishedShown = false; expandedStacks=new Set(); paymentSelected=new Set(); paymentKey='';
    return {
      update(m) {
        match = m;
        const previousRequirement = state && [Stonks.actor(state), state.pending?.stage, state.incoming.length, state.phase].join(':');
        try {
          room = onlineRoom(m); state = Stonks.replay(room); draw();
          const requirement = [Stonks.actor(state), state.pending?.stage, state.incoming.length, state.phase].join(':');
          if (previousRequirement !== requirement && Stonks.actor(state) === ownSeat && (state.pending || state.incoming.length || state.phase === 'discard')) root.querySelector('.st-controls')?.scrollIntoView({ block:'start', behavior:'smooth' });
        }
        catch (e) { root.replaceChildren(h('p', {class:'hand-note'}, 'Could not replay this game: ' + e.message)); return; }
        if (state.winner !== null && !finishedShown) {
          finishedShown = true;
          const w = state.winner === 0 ? 'host' : 'guest', mine = w === G.seat;
          recordResult(m, w);
          endSheet(m, { title: mine ? 'You win!' : state.players[state.winner].name + ' wins', sub: 'Three complete portfolios', body: 'Three different groups, each with a named Company. A business empire on the table.', good: mine, art: h('img', { class: 'wc', src: '/art/box-st.png', alt: '', style:'height:120px;margin:auto' }) });
        }
      },
      isOver: () => !!state && state.winner !== null,
      destroy() { root = null; match = null; selected = null; pendingSend = false; }
    };
  }
  return { start, rules, mountOnline };

})();

function makeST(box) { return STONKS.mountOnline(box, G.match); }
