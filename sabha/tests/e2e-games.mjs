// Game parts of tests/e2e.mjs: each plays a live round through the real phone screens.
// Where a real player would need ears or eyes on another phone (a shouted number, a partner across the
// room), the test reads the other phone's screen, like a teammate would.

// ---------- Shout It Out ----------
// For each phone's instruction, find the phone whose tile has that name and tap it there.
export async function playShout({ phones, room, sleep, until, shot, hits = 6 }) {
  const team = async p => p.evaluate(() => document.body.dataset.team);
  const teams = await Promise.all(phones.map(team));
  await until(async () => (await phones[0].locator('.so-tile').count()) === 4, 8000, 'shout tiles');
  await shot(phones[0], 'shout-1-live');
  let done = 0, tries = 0;
  while (done < hits && tries++ < 60) {
    for (let i = 0; i < phones.length && done < hits; i++) {
      const want = (await phones[i].locator('.so-text').innerText().catch(() => '')).trim().toLowerCase();
      if (!want) continue;
      for (let j = 0; j < phones.length; j++) {
        if (j === i || teams[j] !== teams[i]) continue;
        const labels = await phones[j].locator('.so-tile').evaluateAll(ts => ts.map(t => t.getAttribute('aria-label').toLowerCase()));
        const k = labels.indexOf(want);
        if (k < 0) continue;
        const before = room().events.length;
        await phones[j].locator('.so-tile').nth(k).dispatchEvent('pointerdown');
        await until(() => room().events.length > before, 3000, 'press to score');
        const e = room().events[room().events.length - 1];
        if (e.points < 10) throw new Error('expected a completed instruction, got ' + JSON.stringify(e));
        done++;
        if (done === 2) await shot(phones[i], 'shout-2-after-hit');
        break;
      }
    }
    await sleep(150);
  }
  if (done < hits) throw new Error(`only ${done} shout hits`);
  // a wrong press: a tile nobody is asking for costs 2
  const asked = new Set();
  for (const p of phones) asked.add((await p.locator('.so-text').innerText().catch(() => '')).trim().toLowerCase());
  const labels = await phones[0].locator('.so-tile').evaluateAll(ts => ts.map(t => t.getAttribute('aria-label').toLowerCase()));
  const k = labels.findIndex(l => !asked.has(l));
  if (k >= 0) {
    const before = room().events.length;
    await phones[0].locator('.so-tile').nth(k).dispatchEvent('pointerdown');
    await until(() => room().events.length > before, 3000, 'wrong press');
    const e = room().events[room().events.length - 1];
    if (e.points !== -2) throw new Error('wrong press should cost 2, got ' + JSON.stringify(e));
    await sleep(100);
    await shot(phones[0], 'shout-3-wrong');
  }
  return done;
}

// ---------- Pair Hunt ----------
// Teammates with the same symbol name find each other; one shows their code, the other types it.
const typeCode = async (p, code) => {
  for (let i = 0; i < 60 && await p.locator('.keypad.locked').count(); i++) await new Promise(r => setTimeout(r, 100));
  for (const d of String(code)) await p.locator(`.kp-key[data-key="${d}"]`).dispatchEvent('pointerdown'); };
export async function playPairHunt({ phones, room, sleep, until, shot, rounds = 2 }) {
  const teams = await Promise.all(phones.map(p => p.evaluate(() => document.body.dataset.team)));
  const hunting = p => p.locator('.ph-hunt').isVisible();
  await until(async () => (await Promise.all(phones.map(hunting))).every(Boolean), 8000, 'everyone has a symbol');
  await shot(phones[0], 'pairhunt-1-symbol');
  // a wrong code locks the keypad
  await typeCode(phones[0], '00');
  await until(() => phones[0].locator('.keypad.locked').count().then(n => n > 0), 3000, 'keypad lock after a wrong code');
  await shot(phones[0], 'pairhunt-2-locked');
  await sleep(3200);
  let confirmed = 0;
  for (let r = 0; r < rounds; r++) {
    for (const team of ['red', 'blue']) {
      const idx = phones.map((p, i) => i).filter(i => teams[i] === team);
      await until(async () => (await Promise.all(idx.map(i => hunting(phones[i])))).every(Boolean), 10000, `${team} hunting again`);
      const byName = {};
      for (const i of idx) { const n = (await phones[i].locator('.ph-name').innerText()).trim(); (byName[n] = byName[n] || []).push(i); }
      for (const [name, group] of Object.entries(byName)) {
        if (group.length < 2) throw new Error(`${name} has no partner on screen`);
        const [a, ...others] = group;
        await phones[a].locator('.ph-show').dispatchEvent('pointerdown');
        const code = (await phones[a].locator('.ph-show b').innerText()).trim();
        if (r === 0 && team === 'red') await shot(phones[a], 'pairhunt-3-code-shown');
        const before = room().events.filter(e => e.type.includes('confirm') || e.type.includes('pair') || e.type.includes('trio')).length;
        for (const b of others) { await typeCode(phones[b], code); await sleep(150); }
        await until(() => room().events.filter(e => e.type.includes('confirm') || e.type.includes('pair') || e.type.includes('trio')).length > before, 4000, `${team} ${name} confirmed`);
        confirmed++;
        await until(() => phones[a].locator('.ph-msg').isVisible(), 3000, 'matched screen');
        if (r === 0) await shot(phones[group[1]], `pairhunt-4-matched-${team}`);
      }
    }
  }
  return confirmed;
}

// ---------- Maths Chain ----------
// The phone whose turn it is shows its step; the number it "hears" is the previous phone's shouted answer.
function apply(v, text) {
  const m = text.trim().match(/^([+−×÷]) (\d+)$/);
  if (m) { const n = Number(m[2]); return { '+': v + n, '−': v - n, '×': v * n, '÷': v / n }[m[1]]; }
  return { 'Double it': v * 2, 'Half it': v / 2, 'Add the digits': String(v).split('').reduce((a, d) => a + Number(d), 0), 'Square it': v * v }[text.trim()];
}
async function answer(p, value) {
  for (let i = 0; i < 60 && await p.locator('.keypad.locked').count(); i++) await new Promise(r => setTimeout(r, 100)); // wait out a lock
  for (const d of String(value)) await p.locator(`.kp-key[data-key="${d}"]`).dispatchEvent('pointerdown');
  await p.locator('.kp-send').dispatchEvent('pointerdown');
}
export async function playMaths({ phones, room, sleep, until, shot }) {
  const teams = await Promise.all(phones.map(p => p.evaluate(() => document.body.dataset.team)));
  const heard = { red: null, blue: null };
  let wrongDone = false, shots = 0;
  for (const team of ['red', 'blue']) {
    const idx = phones.map((p, i) => i).filter(i => teams[i] === team);
    for (let guard = 0; guard < 40; guard++) {
      const done = await Promise.all(idx.map(i => phones[i].locator('.mc-celebrate').count()));
      if (done.some(n => n > 0)) break;
      let turn = -1;
      for (const i of idx) if (await phones[i].locator('.keypad').isVisible().catch(() => false)) { turn = i; break; }
      if (turn < 0) { await sleep(150); continue; }
      const p = phones[turn];
      if (await p.locator('.keypad.locked').count()) { await sleep(300); continue; }
      const say = await p.locator('.mc-body').innerText();
      const start = say.match(/Start:\s*(\d+)/i);
      if (start) heard[team] = Number(start[1]);
      const steps = await p.locator('.mc-step').allInnerTexts();
      let v = heard[team];
      for (const s of steps) for (const part of s.split(', then ')) v = apply(v, part);
      if (shots++ === 0) await shot(p, 'maths-1-turn');
      if (!wrongDone) { // one wrong answer first: "Not right", 3 s lock
        wrongDone = true;
        await answer(p, v + 1);
        await until(() => p.locator('.mc-wrong').count().then(n => n > 0), 3000, 'wrong answer message');
        await shot(p, 'maths-2-wrong');
        await sleep(3200); // (answer() also waits until the keypad unlocks)
      }
      await answer(p, v);
      await until(() => p.locator('.mc-answer').count().then(n => n > 0), 4000, 'done screen with the answer');
      heard[team] = Number((await p.locator('.mc-answer').first().innerText()).trim());
      if (shots === 1) await shot(p, 'maths-3-done');
      const waiting = idx.find(i => i !== turn);
      if (waiting != null && shots === 1) await shot(phones[waiting], 'maths-4-other');
    }
    await until(async () => (await Promise.all(idx.map(i => phones[i].locator('.mc-celebrate').count()))).some(n => n > 0), 5000, `${team} finished`);
    await shot(phones[idx[0]], `maths-5-finished-${team}`);
  }
  return true;
}
