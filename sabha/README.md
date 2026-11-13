# Harisena Sabha Games

Phone party games for two teams (Red and Blue, 10–15 players each) run from one host phone:
**Pair Hunt**, **Shout It Out** and **Maths Chain** feed an automatic championship; **Don't Say It**
is played with cards and scored on the host's counter. The full spec is in the session upload
("Harisena Sabha Games — Full Game Spec"); choices made where the spec was open are in
[DECISIONS.md](DECISIONS.md).

This app is separate from the Game Shelf in the rest of this repository: it needs a real server
(the spec says the server decides everything), so it is a small Node + Socket.IO app, not Firebase.

## Run it

```bash
cd sabha
npm install
npm start                 # http://localhost:3100  (host page: /host)
```

- Host: open `http://localhost:3100/host`, tap **New Session**. The lobby shows the code and a QR.
- Players: scan the QR, or open `http://localhost:3100/?r=CODE`.
- Several "phones" in one browser: add `&as=1`, `&as=2`, … to each tab (each gets its own identity);
  the host can use `/host?as=h`.
- Phones on the same Wi-Fi: `http://<this computer's LAN IP>:3100`. Wake lock needs HTTPS, so it only
  works once deployed; everything else works over plain HTTP.

Environment variables: `PORT` (default 3100), `DATA_DIR` (default `sabha/data`, where each room is
saved as JSON at the end of every round), `NO_SAVE=1` (keep nothing on disk).

## Tests

```bash
npm run check             # syntax-check every file
npm run test:unit         # core + one test file per game (fake clock, no sockets)
npm run test:bots         # 31 socket bots tap randomly through every game at 10× speed, with chaos
npm run test:e2e          # Chromium: host + 5 phones play the whole evening through the real screens
npm test                  # unit + bots
```

Screenshots from the e2e and the games' own checks land in `tests/screens/` (git-ignored).

## How it fits together

```
server/index.js      HTTP (pages, /qr/CODE.svg) + Socket.IO; maps sockets to rooms and players; ticks rooms every 250 ms; saves/reloads rooms
server/room.js       The core: players, teams, lock + seats, late joiners, handover, heartbeats, the round flow
                     (intro → countdown → live → Time! → results → … → game over), pause, the event log,
                     host commands, what each phone and the host sees, persistence
server/scoring.js    Round scores → game totals → championship (out of 300), tie-break, MVPs, final
server/rng.js        Seeded generators (both teams get identical ones from the round seed)
server/games/*.js    One plug-in per game (demo.js is the test-only Tap Race and the smallest example)
public/index.html    Player page: js/common.js (socket, synced clock, sound, flash, wake lock, Keypad),
                     js/player.js (every non-game screen), js/games/*.js (each game's screen)
public/host.html     Host page: js/host.js (lobby, game control, results, audit, Don't Say It, final)
tests/harness.js     Drives a real Room with a fake clock: used by all unit tests
```

### The game plug-in shape

```js
module.exports = {
  id, name, rule /* one line on every phone */, hostSays /* what the host reads out */,
  championship: true, normalise: true /* round score = raw × 10 ÷ team size */, minPlayers,
  rounds(opts) → [{ n, label, ms, practice?, teams? /* ['red'] for a turn-based half */ }],
  bot(view, rng) → a random plausible action (bot test),
  create(ctx) → { start(), onAction(pid, action), onTick(now), onPlayerOffline(pid), onPlayerOnline(pid),
                  view(pid) /* that phone's private screen data */, hostView(), onHostCommand(data), end() → { lines, stats, tiebreak? } },
};
```

`ctx` gives the game everything it may touch: `teams` (roster at round start, by seat), `rng(label)`,
`now()` (game time; stops while paused), `award(team, playerIds, type, points, detail)` (the only way
to score: it writes the event log), `track`/`best` (per-player stats for MVPs), `push(pid)` /
`pushTeam` / `pushAll` (send fresh screens), `fx(pid, data)` (one-off flashes), `online(pid)`,
`end(reason)`, `warnHost(text)`.

Phones get their whole screen state on every push (`state.view` is the game's `view(pid)`), so a phone
that reconnects is back exactly where it was. Private data only goes to its own phone.
