# Decisions log

Everything below is a call I made where the spec was open, unclear or in tension, with the options I
weighed. Each is easy to change; the file/function to touch is named. Items marked **(needs you)** are
the ones I could not decide for you.

## Needs you

1. **(needs you) Where it runs on the night.** The spec wants a server that holds the game (WebSockets);
   Firebase Hosting (used by the Game Shelf) can't run one. The app is a plain Node server
   (`npm start`), so any of these work: Render / Railway / Fly.io (free or ~$5/month, HTTPS included,
   which the screen wake lock needs), a small VM, or a laptop on the house Wi-Fi (no HTTPS, so no wake
   lock; phones on mobile data can't reach it). Nothing is deployed yet. Recommended: Render or Fly.io
   with one instance (rooms live in memory in one process) and a persistent disk for `DATA_DIR`.
2. **(needs you) The "Decisions to make before building" in the spec** — I went with the spec's own
   defaults: Don't Say It does **not** count; the host does **not** play; Shout It Out defaults to
   **simultaneous** (the host can switch to turn-based on the games screen before starting it); team
   names **Red and Blue**; the host can stop any game early ("End game here"), so the minimum-rounds
   question is answered on the night.

## Architecture

3. **Separate app in `sabha/`, Node + Socket.IO**, no framework or build step (like the Game Shelf).
   Alternatives: Firebase + Cloud Functions (no long-lived timers, awkward for a 250 ms tick), or Firestore
   with clients deciding (the spec forbids it). Dependencies: `socket.io`, `qrcode`.
4. **One process, rooms in memory**, saved to `data/CODE.json` at the end of every round (and a second
   after lobby changes). A round that is running when the server dies is dropped from the save, so the
   restart puts the host back on "Start Round N" for that round (the spec's "interrupted round is
   replayed"). The host also has **Replay this round** on the results screen for any reason.
5. **Phones get whole screen states, not patches.** Every change sends the affected phones their full
   state (small JSON). Simpler, and reconnecting needs nothing special. The host page gets at most ~4
   pushes a second.
6. **Identity is bound per socket.** The spec says every message carries roomCode/playerId/token; instead
   the socket proves the token once (`p:hello`) and is then bound to that player. Same security, fewer
   bytes; a handover rotates the token and disconnects the old phone.
7. **Game clock vs wall clock.** Pausing stops the game clock; every round timer (round end, Shout timers,
   lockouts) runs on it, so pause/resume is exact. Heartbeats and the spam guard use real time.

## Lobby and teams

8. **Join is name + one tap on Red or Blue** (one screen, as in the spec's screen table). After lock the
   same screen shows a single **Join** button and the player lands in the host's queue.
9. **Anyone who joined but never picked a team when the host locks** goes into the queue too.
10. **Seats are given in join order** at lock (1..N per team). A player moved after lock gets the next free
    seat in the new team (no renumbering, so nobody's number changes under them).
11. **Lost phone / new device**: typing a name already in use **after lock** asks the host "Is this X
    (Red #4)?". Before lock it simply becomes "Ravi 2" (no prompt), as the spec's step 2 says. "No" makes
    them a new late joiner.
12. **Team size for normalising** = the team's roster (online or not, not removed, not in the queue) when
    each round starts. The spec says lists freeze at lock but also that removal and late joiners change
    things "from the next round"; per-round rosters satisfy both.

## Scoring

13. **Manual adjustments add championship points directly** (not game points), need a reason, and show
    in the audit, the championship table and the final. Alternative: adjust a specific game's total —
    rejected because it gets rescaled by the 100-point conversion and is hard to explain.
14. **Championship conversion edge cases**: both totals 0 (or negative) → both 0; equal positive totals →
    both 100; a negative total counts as 0.
15. **Replaying a whole game** (tapping Replay on a played game) throws away that game's old scores.
16. **Practice rounds** write events (for the audit) but never count, and don't feed MVP stats.
17. **Tie-break** = lower combined Maths Chain time (each team's time per round incl. hint penalties; a
    team that didn't finish counts the 4-minute cap plus penalties). If Maths Chain wasn't played the
    champion stays a tie.
18. **Don't Say It points can go to either team at any time** (the judge's team doesn't matter to the
    counter), with an **Undo last tap** (written as its own event, so the audit still shows both).

## Screens

19. **Players never see the other team's numbers during a round**; between rounds they see their own
    team's game total so far and one line; after each game, the championship ("Red 192 · Blue 188").
20. **The watching team in turn-based Shout It Out** sees "Red is playing — watch them!" with the clock.
21. **A late joiner assigned mid-round** sees "You join from the next round" until the next round starts.
22. **Look**: bold and plain rather than the Game Shelf's watercolour (the spec asks for the team colour
    as the whole background and text readable at arm's length). Same fonts (Caprasimo, Figtree), no
    pills, no gradients. Sound is synthesised (no files).

## Pair Hunt (`server/games/pairhunt.js`)

23. **Each player has their own 2-digit code, not one per pair** (deviation from the spec). With a
    shared pair code a player could tap "Show my code" and type it themselves without finding anyone,
    which breaks the "Faking a pair" safeguard. You show yours, your partner types it. In a trio, two
    members each type another member's code. Alternative: the spec's single code, accepting the exploit.
24. Typing your **own** code gets a "that's your own code" note and no lockout (a slip, not a guess).
25. **Wrong codes are not written to the audit log** (0 points, and 30 guessers would flood it); they're
    counted in the stats and the host's results table.
26. **Tiny teams**: when nobody else exists to wait for, "never your last partner" is relaxed (the last
    two re-pair, the last three form a trio), otherwise a team of 2–3 would stall forever.
27. The last three in the pool form a trio only when nobody else in the team is still hunting.
28. **Round 2 look-alike families** (my choice): colours red/orange, blue/purple, green/yellow; shapes
    circle/moon, square/diamond, star/cross, triangle/heart. The family size grows with team size.
    Green/yellow and triangle/heart are the weakest look-alikes; swap them if they're too easy.
29. "Show my code" reveals for 5 s on the phone itself (the code is in that player's private view).
30. "Matched! New symbol coming…" shows for 1.5 s before the player joins the free pool.

## Shout It Out (`server/games/shout.js`)

31. **The 12 colours**: Golden, Green, Purple, Pink, Orange, Silver, Black, White, Brown, Sky, Maroon,
    Teal. Every tile also prints its name, so colour-blind players can play.
32. **The 2:00 rename** uses names from the other half of the 144, so nobody gets an old name back
    (enough for 18 players a team). All active instructions are re-issued for new random targets.
33. **Instruction text has no colour hint**, only the name ("PRESS: PURPLE DRUM") — it's a shouting game.
34. Speed bonus `ceil(5 × left ÷ timer)` is kept between 1 and 5; both the shouter and the holder are
    named on the event. A press within the 300 ms grace after an instruction's deadline still counts.
35. **Timeouts write no event** (no points change); they're counted in stats and the host panel. The next
    instruction comes 0.7 s after a timeout.
36. Pressing a button that isn't on your own phone (a stale tap) is ignored, not penalised.
37. **Turn-based mode**: the practice round is both teams at once; rounds 1 and 2 are Red's half then
    Blue's half, same names and seed.

## Maths Chain (`server/games/maths.js`)

38. Running totals stay between **1** and the cap (0 excluded, steps that change nothing skipped), and no
    two "special" steps (×, ÷, word steps) of the same kind in a row.
39. **Ranking uses team time including hint penalties**, so a team that finished first on the clock can
    lose on penalties. Exact ties go to whichever finish the server saw first.
40. **Second place is capped at 99**, so even a near-tie separates the teams (alternative: both 100).
41. A step passed on to the next seat is answered with **one number** (after both steps).
42. The 15 s "offline current player" timer starts when the core marks them offline (10 s without a
    heartbeat), so about 25 s after a phone dies. The host's **Skip** button is the fast way.
43. Passing goes to the next online chain seat, then wraps, then to a checker; with nobody online it waits.
44. **The hint is never offered on step 1** (that player already sees the start number).
45. `fastestStep` (the MVP) counts only normal single-step turns.
46. Players offline at round start are left out of that round's chain (they get the checker view if they
    come back).
47. The host's live raw points stay 0 during a Maths Chain round (points are given at the end); the host
    panel shows each team's progress and Skip buttons instead.
48. Starting seats per round: 1, 4, 8 (wrapping round the team). Checkers in the bigger team rotate: in
    a 14 v 12 game the checkers are #13–14, then #2–3, then #6–7.

## Testing notes

49. **Nothing was tested on real phones** (needs you: the spec's real phone / chaos / read-aloud / deploy
    tests). What was tested: unit tests per game and the core, a server-restart test, a 31-bot socket test
    with dropped connections, double taps, a pause, a late joiner and a handover (two modes: random taps,
    and bots that "hear" each other so pairs form and chains complete), and a Chromium e2e with a host and
    five 390×844 phones playing every game through the real screens.
50. The bot test speeds the game clock up 10× but keeps heartbeats on real time, so in it a dropped phone
    stalls Maths Chain for longer (in game time) than it would on the night.
