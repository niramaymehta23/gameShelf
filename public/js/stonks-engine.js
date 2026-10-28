'use strict';
// Pure rules engine. Local rooms persist only setup + an append-only command log.
// Online play must run this validation on a trusted server and send private player views.
const Stonks = (() => {
  const cards = Object.fromEntries(STONKS_DATA.cards.map(c => [c.id, c]));
  const sectors = Object.fromEntries(STONKS_DATA.sectors.map(s => [s.key, s]));
  const copy = x => JSON.parse(JSON.stringify(x));
  const require = (ok, message) => { if (!ok) throw Error(message); };
  const rng = seed => { let a = 2166136261; for (const c of String(seed)) a = Math.imul(a ^ c.charCodeAt(0), 16777619); return () => { a += 0x6D2B79F5; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  function shuffle(a, seed) { const r = rng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const named = p => p.cards.some(id => cards[id].kind === 'company');
  const complete = p => p.cards.length === sectors[p.group].size && named(p);
  function revenue(p) {
    if (!p.cards.some(id => cards[id].kind === 'company' || cards[id].value > 0)) return 0;
    return (sectors[p.group].revenue[p.cards.length - 1] || 0) + p.upgrades.reduce((n, id) => n + (cards[id].effect === 'growth' ? 3 : 4), 0);
  }
  const colours = p => [...new Set(p.portfolios.filter(complete).map(x => x.group))];
  const eligible = (id, group) => cards[id]?.kind === 'company' ? cards[id].group === group : cards[id]?.kind === 'wild' && cards[id].groups.includes(group);
  const assets = p => [...p.treasury, ...p.portfolios.flatMap(x => [...x.cards, ...x.upgrades])].filter(id => cards[id].value > 0);
  const ownerPortfolio = (p, id) => p.portfolios.find(x => x.cards.includes(id) || x.upgrades.includes(id));
  function draw(s, p, n) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (!s.deck.length && s.discard.length) { s.deck = shuffle(s.discard.splice(0), s.seed + ':reshuffle:' + s.reshuffles++); }
      if (s.deck.length) drawn.push(s.deck.pop());
    }
    if (s.rulesVersion !== 2) { p.hand.push(...drawn); return; }
    const by = s.players.indexOf(p);
    for (const id of drawn) {
      if (cards[id].kind === 'funding') p.treasury.push(id);
      else if (cards[id].kind === 'company') put(s, by, id, cards[id].group);
      else if (cards[id].kind !== 'wild') p.hand.push(id);
    }
    // Place wilds after this batch's named Companies, preferring an existing
    // incomplete portfolio with a named Company, then the first printed colour.
    for (const id of drawn.filter(id => cards[id].kind === 'wild')) {
      const options = p.portfolios.filter(port => eligible(id, port.group) && port.cards.length < sectors[port.group].size)
        .sort((a, b) => Number(named(b)) - Number(named(a)) || b.cards.length / sectors[b.group].size - a.cards.length / sectors[a.group].size);
      put(s, by, id, options[0]?.group || cards[id].groups[0], options[0]?.id || '');
    }
  }
  function create(names, seed, starter = 0, rulesVersion = 1) {
    require(Array.isArray(names) && names.length >= 2 && names.length <= 5 && names.every(n => typeof n === 'string' && n.trim()), 'Choose 2–5 named players.');
    require(Number.isInteger(starter) && starter >= 0 && starter < names.length, 'Choose the rock, paper, scissors starter.');
    require(rulesVersion === 1 || rulesVersion === 2, 'Unknown STONKS rules version.');
    const s = { seed, rulesVersion, players: names.map(name => ({ name: name.trim().slice(0, 24), hand: [], treasury: [], portfolios: [] })), deck: shuffle(Object.keys(cards).filter(id => cards[id].kind !== 'reference'), seed), discard: [], turn: starter, plays: 0, phase: 'play', pending: null, incoming: [], winner: null, serial: 0, reshuffles: 0, message: 'Drawn for the first turn.' };
    for (const p of s.players) draw(s, p, 5);
    draw(s, s.players[starter], 2);
    if (rulesVersion === 2) win(s);
    return s;
  }
  function cleanup(s) {
    for (const p of s.players) {
      for (const port of p.portfolios) {
        if (!complete(port)) s.discard.push(...port.upgrades.splice(0));
        else if (!port.upgrades.some(id => cards[id].effect === 'growth')) {
          const unsupported = port.upgrades.filter(id => cards[id].effect === 'ipo');
          port.upgrades = port.upgrades.filter(id => !unsupported.includes(id)); s.discard.push(...unsupported);
        }
      }
      p.portfolios = p.portfolios.filter(p => p.cards.length);
    }
  }
  function win(s) {
    if (s.incoming.length || s.pending) return;
    const order = [s.turn, ...s.players.map((_, i) => i).filter(i => i !== s.turn)];
    const w = order.find(i => colours(s.players[i]).length >= 3);
    if (w !== undefined) { s.winner = w; s.phase = 'over'; s.message = s.players[w].name + ' wins with three different complete portfolios!'; }
  }
  function put(s, by, id, group, dest = '') {
    require(eligible(id, group), 'Choose an eligible group.');
    const p = s.players[by];
    let port = dest ? p.portfolios.find(x => x.id === dest) : null;
    if (dest) require(port && port.group === group && port.cards.length < sectors[group].size, 'That portfolio has no space.');
    // Named Companies fill the first matching portfolio before starting another.
    if (!dest && cards[id].kind === 'company') port = p.portfolios.find(x => x.group === group && x.cards.length < sectors[group].size);
    if (!port) { port = { id: 'p' + ++s.serial, group, cards: [], upgrades: [] }; p.portfolios.push(port); }
    port.cards.push(id);
  }
  function receive(s, by, id, group) {
    if (cards[id].kind === 'wild') s.incoming.push({ by, id });
    else put(s, by, id, group || cards[id].group);
  }
  function removeAsset(p, id) {
    if (p.treasury.includes(id)) { p.treasury.splice(p.treasury.indexOf(id), 1); return 'money'; }
    const port = ownerPortfolio(p, id);
    require(port, 'This asset is not on your table.');
    const list = port.cards.includes(id) ? port.cards : port.upgrades;
    list.splice(list.indexOf(id), 1);
    return cards[id].kind === 'action' ? 'money' : 'company';
  }
  function nextDemand(s) {
    const q = s.pending;
    q.index++; q.blocked = false;
    if (q.index >= q.targets.length) { s.pending = null; return; }
    q.stage = 'response'; q.responder = q.targets[q.index];
  }
  function resolve(s) {
    const q = s.pending, target = q.targets[q.index], victim = s.players[target];
    if (q.blocked) { s.message = victim.name + ' blocked ' + cards[q.card].title + '.'; nextDemand(s); return; }
    if (q.effect === 'pay') { q.stage = 'payment'; q.responder = target; return; }
    if (q.effect === 'takeover') {
      const port = victim.portfolios.find(p => p.id === q.portfolio);
      victim.portfolios.splice(victim.portfolios.indexOf(port), 1);
      // Entire portfolio transfers intact; no reassignment or upgrade cleanup in between.
      s.players[q.by].portfolios.push(port);
    } else if (q.effect === 'steal') {
      const group = ownerPortfolio(victim, q.take).group;
      removeAsset(victim, q.take); receive(s, q.by, q.take, group);
    } else if (q.effect === 'swap') {
      const giveGroup = ownerPortfolio(s.players[q.by], q.give).group, takeGroup = ownerPortfolio(victim, q.take).group;
      removeAsset(victim, q.take); removeAsset(s.players[q.by], q.give);
      receive(s, q.by, q.take, takeGroup); receive(s, target, q.give, giveGroup);
    }
    s.message = cards[q.card].title + ' resolved.';
    cleanup(s); nextDemand(s);
  }
  function actor(s) { return s.incoming[0]?.by ?? s.pending?.responder ?? s.turn; }
  function apply(state, cmd) {
    const s = copy(state);
    require(s.winner === null, 'This game has ended.');
    require(cmd && Number.isInteger(cmd.by) && cmd.by === actor(s), 'Waiting for another player.');
    const p = s.players[cmd.by], c = cards[cmd.card];
    const spend = id => { require(p.hand.includes(id), 'Card is not in your hand.'); p.hand.splice(p.hand.indexOf(id), 1); };
    if (s.incoming.length) {
      require(cmd.type === 'receive', 'Choose where your incoming wild belongs.');
      const inc = s.incoming.shift(); put(s, inc.by, inc.id, cmd.group, cmd.dest); win(s);
      if (!s.incoming.length && s.followup) { if (s.winner === null) s.pending = s.followup; delete s.followup; }
      return s;
    }
    if (s.pending) {
      const q = s.pending;
      if (q.stage === 'response') {
        if (cmd.type === 'legal') {
          require(c?.effect === 'legal', 'Choose a Legal Team from your hand.'); spend(cmd.card); s.discard.push(cmd.card);
          q.blocked = !q.blocked; q.responder = cmd.by === q.by ? q.targets[q.index] : q.by;
          s.message = p.name + ' played Legal Team. Waiting for ' + s.players[q.responder].name + '.';
        } else { require(cmd.type === 'pass', 'Respond with Legal Team or pass.'); resolve(s); }
      } else {
        require(cmd.type === 'pay', 'Choose your payment.');
        const ids = cmd.cards || [], available = assets(p);
        require(Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(id => available.includes(id)), 'Choose only your payable table assets.');
        const total = ids.reduce((n, id) => n + cards[id].value, 0), all = available.reduce((n, id) => n + cards[id].value, 0);
        require(total >= Math.min(q.amount, all), 'Pay enough, or surrender all available value.');
        // Every chosen card must be needed: no redundant assets, even in an overpayment.
        require(ids.every(id => total - cards[id].value < q.amount), 'Remove extra cards; stop when the demand is covered.');
        // Remove chosen upgrades before cleanup, so a selected upgrade remains valid in this same payment.
        for (const id of ids) {
          const kind = removeAsset(p, id);
          if (kind === 'money') s.players[q.by].treasury.push(id); else receive(s, q.by, id);
        }
        s.message = p.name + ' paid ' + total + 'M' + (total < q.amount ? '; remainder forgiven.' : '. No change.');
        cleanup(s);
        // Victory is checked after each payment, before proceeding to another opponent.
        const remaining = q.targets.slice(q.index + 1);
        s.pending = null; win(s);
        if (s.winner === null && remaining.length) { q.targets = remaining; q.index = 0; q.stage = 'response'; q.blocked = false; q.responder = remaining[0]; if (s.incoming.length) s.followup = q; else s.pending = q; }
      }
      win(s); return s;
    }
    require(cmd.by === s.turn, 'It is not your turn.');
    if (s.phase === 'discard') {
      require(cmd.type === 'discard', 'Discard down to seven to finish.');
      require(Array.isArray(cmd.cards) && new Set(cmd.cards).size === cmd.cards.length && cmd.cards.length === p.hand.length - 7 && cmd.cards.every(id => p.hand.includes(id)), 'Choose exactly the excess hand cards.');
      cmd.cards.forEach(id => { spend(id); s.discard.push(id); });
      endTurn(s); return s;
    }
    if (cmd.type === 'end') {
      if (p.hand.length > 7) s.phase = 'discard'; else endTurn(s);
      return s;
    }
    if (cmd.type === 'move') {
      const port = ownerPortfolio(p, cmd.card);
      require(port && port.cards.includes(cmd.card), 'Choose a played Company or wild.');
      require(cmd.dest !== port.id, 'Choose a different portfolio.');
      if (cards[cmd.card].kind === 'company') require(cmd.group === port.group, 'A named Company cannot change group.');
      removeAsset(p, cmd.card); put(s, cmd.by, cmd.card, cmd.group, cmd.dest); cleanup(s); win(s); return s;
    }
    if (cmd.type === 'replace') {
      const from = ownerPortfolio(p, cmd.card), to = p.portfolios.find(x => x.id === cmd.dest);
      require(c?.kind === 'company' && from?.cards.includes(cmd.card) && to && to !== from && to.group === c.group, 'Choose a played named Company and a different portfolio of its group.');
      require(to.cards.includes(cmd.replace) && cards[cmd.replace].kind === 'wild', 'Choose a wild to replace.');
      removeAsset(p, cmd.card); to.cards[to.cards.indexOf(cmd.replace)] = cmd.card;
      s.incoming.push({ by: cmd.by, id: cmd.replace }); cleanup(s); return s;
    }
    if (cmd.type === 'moveUpgrade') {
      const from = ownerPortfolio(p, cmd.card), to = p.portfolios.find(x => x.id === cmd.dest);
      require(c?.kind === 'action' && ['growth', 'ipo'].includes(c.effect) && from?.upgrades.includes(cmd.card), 'Choose an attached upgrade.');
      require(to && to !== from && complete(to) && !['black','grey'].includes(to.group), 'Choose another complete coloured portfolio.');
      const moving = c.effect === 'growth' ? [...from.upgrades] : [cmd.card];
      require(!moving.some(id => to.upgrades.some(x => cards[x].effect === cards[id].effect)), 'No duplicate upgrades.');
      require(c.effect !== 'ipo' || to.upgrades.some(id => cards[id].effect === 'growth'), 'IPO Launch needs Growth Round.');
      from.upgrades = from.upgrades.filter(id => !moving.includes(id)); to.upgrades.push(...moving); cleanup(s); return s;
    }
    if (cmd.type === 'bank' && s.rulesVersion === 2) {
      require(c && ['funding','action','revenue'].includes(c.kind), 'Companies and wilds cannot be banked.');
      spend(cmd.card); p.treasury.push(cmd.card);
      s.message = p.name + ' banked ' + c.title + ' as ' + c.value + 'M. No play used.';
      return s;
    }
    require(s.plays < 3 && c && p.hand.includes(cmd.card), 'No plays remain or card is unavailable.');
    if (cmd.type === 'bank') {
      require(['funding','action','revenue'].includes(c.kind), 'Companies and wilds cannot be banked.');
      spend(cmd.card); p.treasury.push(cmd.card); s.plays++;
    } else if (cmd.type === 'lay') {
      require(['company','wild'].includes(c.kind), 'Choose a Company or wild.');
      if (cmd.replace) {
        const port = p.portfolios.find(x => x.id === cmd.dest);
        require(c.kind === 'company' && port?.group === c.group && port.cards.includes(cmd.replace) && cards[cmd.replace].kind === 'wild', 'Replace a wild in the same group with a named Company.');
        spend(cmd.card); port.cards[port.cards.indexOf(cmd.replace)] = cmd.card;
        s.incoming.push({ by: cmd.by, id: cmd.replace });
      } else { put(s, cmd.by, cmd.card, cmd.group || c.group, cmd.dest); spend(cmd.card); }
      s.plays++;
    } else {
      require(cmd.type === 'action' && ['action','revenue'].includes(c.kind) && !['legal','hype'].includes(c.effect), 'Use Legal Team as a response, or Hype Cycle with a Revenue Call.');
      const target = s.players[cmd.target], port = p.portfolios.find(x => x.id === cmd.portfolio);
      let effect = c.effect, targets = [], amount = 0;
      if (effect === 'growth' || effect === 'ipo') {
        require(port && complete(port) && !['black','grey'].includes(port.group), 'Upgrade needs a complete coloured portfolio.');
        require(!port.upgrades.some(id => cards[id].effect === effect), 'One of each upgrade per portfolio.');
        require(effect !== 'ipo' || port.upgrades.some(id => cards[id].effect === 'growth'), 'IPO Launch requires Growth Round.');
        spend(cmd.card); port.upgrades.push(cmd.card); s.plays++;
      } else {
        if (c.kind === 'revenue') {
          require(port && c.groups.includes(port.group) && revenue(port) > 0, 'Choose an eligible portfolio with revenue.');
          const hype = cmd.hype || [];
          require(Array.isArray(hype) && hype.length <= 2 && new Set(hype).size === hype.length && hype.every(id => p.hand.includes(id) && cards[id].effect === 'hype') && s.plays + 1 + hype.length <= 3, 'Each Hype Cycle needs a card and one remaining play.');
          amount = revenue(port) * (2 ** hype.length); effect = 'pay';
          targets = c.single ? [cmd.target] : s.players.map((_, i) => i).filter(i => i !== cmd.by);
          hype.forEach(id => { spend(id); s.discard.push(id); s.plays++; });
        } else if (effect === 'invoice') { amount = 5; effect = 'pay'; targets = [cmd.target]; }
        else if (effect === 'party') { amount = 2; effect = 'pay'; targets = s.players.map((_, i) => i).filter(i => i !== cmd.by); }
        else if (['steal','swap','takeover'].includes(effect)) {
          require(target && cmd.target !== cmd.by, 'Choose an opponent.');
          if (effect === 'takeover') require(target.portfolios.some(x => x.id === cmd.portfolio && complete(x)), 'Choose an opponent’s complete portfolio.');
          else {
            const take = ownerPortfolio(target, cmd.take);
            require(take?.cards.includes(cmd.take) && !complete(take), 'Take only a Company or wild from an incomplete portfolio.');
            if (effect === 'swap') require(ownerPortfolio(p, cmd.give)?.cards.includes(cmd.give), 'You must give a played Company or wild.');
          }
          targets = [cmd.target];
        } else require(effect === 'pitch', 'Unknown action.');
        require(targets.every(i => Number.isInteger(i) && s.players[i] && i !== cmd.by), 'Choose an opponent.');
        spend(cmd.card); s.discard.push(cmd.card); s.plays++;
        if (effect === 'pitch') draw(s, p, 2);
        else s.pending = { by: cmd.by, card: cmd.card, effect, targets, index: 0, stage: 'response', responder: targets[0], blocked: false, amount, take: cmd.take || null, give: cmd.give || null, portfolio: cmd.portfolio || null };
      }
    }
    s.message = p.name + ' played ' + c.title + '.'; cleanup(s); win(s); return s;
  }
  function endTurn(s) {
    s.turn = (s.turn + 1) % s.players.length; s.plays = 0; s.phase = 'play';
    const p = s.players[s.turn]; draw(s, p, p.hand.length ? 2 : 5);
    s.message = p.name + ' drew for their turn.';
    if (s.rulesVersion === 2) { cleanup(s); win(s); }
  }
  function replay(room) { return room.log.reduce((s, cmd) => apply(s, cmd), create(room.names, room.seed, room.starter, room.rulesVersion || 1)); }
  return { cards, sectors, complete, revenue, colours, assets, eligible, ownerPortfolio, create, apply, replay, actor };
})();
