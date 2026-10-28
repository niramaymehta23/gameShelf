'use strict';
// ================= boot =================
function boot() {
  G.dev = Pref.get('dev');
  if (!G.dev) { G.dev = 'd' + rid() + rid(); Pref.set('dev', G.dev); }
  G.name = Pref.get('name') || '';
  Sound.on = Pref.get('sound') !== 'off';
  paintSoundBtn();

  // An invite link looks like /?join=ABCD. It takes the player to the join form with the code filled in,
  // unless this phone is already sitting at that table.
  let join = null;
  try {
    const q = new URLSearchParams(location.search);
    join = (q.get('join') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || null;
    if (join) { q.delete('join'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '')); }
  } catch (e) {}

  Net.connect();
  if (new URLSearchParams(location.search).has('stonks')) { STONKS.start(); return; }
  const saved = Pref.get('table');
  if (join && join !== saved) { G.pendingJoin = join; route(); }
  else if (saved) openTable(saved);
  else route();
}
boot();
