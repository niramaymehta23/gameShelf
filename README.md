# Our Game Shelf

**Board games for two, played on two phones, wherever you both are.**

**Play it at [gameshelf-ee306.web.app](https://gameshelf-ee306.web.app)**

Game night on a blue linen tablecloth: a painted dresser of game boxes, watercolour cards held down
with washi tape, a milk-painted Connect Four frame and a sea chart. It's made for two people in two
different places, one on Android and one on iPhone, and it plays the same on both.

## How it works

1. **Set up a table.** Type your name and tap *Set up a table*. You get a four-letter code.
2. **Send the invite.** *Send an invite* opens your phone's share sheet (or copies a link). The link
   opens the game with the code already filled in. Your partner can also type the code in.
3. **Pick a game from the shelf.** Whoever picks asks the other to join. If your partner isn't
   around, they're asked when they come back.
4. **Rock, paper, scissors decides who goes first.** Best of three, with the picks hidden until you've
   both chosen.

A short how-to-play card comes up before every new game (you can turn it off per game), and the **?**
in the corner shows it again at any time.

The dot under your partner's name tells you where they are: **green** on the same screen as you,
**amber** somewhere else at the table, **red** not connected.

## The games

- **Connect Four.** Slide along the top of the board and let go to drop a disc. Your partner sees your
  disc hovering over the column you're lining up. Four in a row wins.
- **Battleships.** Drag your five ships onto your chart (or shuffle them), then take turns firing.
  A hit burns and earns another shot; a miss plants a white flag. You can watch your partner's
  crosshair move over your fleet while they aim.
- **Hues.** Our own card game: match the pile's colour, number or symbol and be the first to empty your
  hand. 95 painted cards with Again, Splash +2, Flood +4, Blend and Trade. Call **Hues!** when you're
  down to one card, or your partner can call you out. The rock, paper, scissors winner picks
  **Custom** rules (play matching numbers together, stack penalties, two shuffles each) or
  **Official-style** (one card at a time, penalties skip your turn). Full rules:
  [docs/hues-rules.md](docs/hues-rules.md).
- **Quickfire.** Two races in one box. **Words**: you each pick a letter in secret, then race to type
  a real word that fits, like S _ _ _ T. **Sums**: you each pick a number, then race to answer, like
  67 − 24. Play Words, Sums, or Mixed. Each phone times its own player from the moment the puzzle
  appears on *that* screen, so a slow connection never costs you a round. Answers go the moment
  they're long enough, and a wrong one clears so you can try again straight away.
- **Word Wheel.** Like the newspaper puzzle: nine letters on a wheel, one in the middle. The rock,
  paper, scissors winner spins it, and you both race on the same wheel. Put a finger on a letter and
  swipe across the others to make a word, then let go. Four letters or more, every word needs the
  middle letter, each letter once, no plurals. A word only counts for whoever finds it first; first
  to five wins. There are 100 wheels, each with a nine-letter word hidden in it, and every word each
  one allows is worked out in advance, so a wrong word is refused at once.

## Around the table

- **Save and carry on later.** Leave a game and you can *Save and quit* or *Quit without saving*.
  If one of you quits, the other decides whether to keep it saved. A saved game shows a sticker on
  its box, and picking it again carries on where you left off.
- **The score.** A score sheet on the dresser counts wins per game for the two of you.
- **All the stats.** Under the score: wins and winning runs, your rock, paper, scissors habits, each
  game's records (fewest discs to win, Battleships accuracy, fewest cards to win in Hues, the fastest
  Quickfire word, the longest Word Wheel word) and a log of recent games. Worked out from the games' saved moves, so older games
  count too.
- **Change your name.** On the shelf, or by joining the table again with the code under a new name.
- **Reactions and notes.** Tap the chat button to send an emoji (it rains down on your partner's
  screen) or a short note of up to 80 characters (it arrives as a taped paper note).
- **Recent tables.** Your phone remembers the tables you've sat at, with your partner's name, so you
  can rejoin with one tap.
- **Sound.** Small synthesised sounds for drops, shots, cards and wins; the speaker button turns
  them off.
- **The screen stays on** while a game is open.

## Put it on your home screen

Open the site and use **Add to Home Screen**: the Share menu in Safari on iPhone, the ⋮ menu in
Chrome on Android. It then opens full screen, like an app.

---

# Behind the scenes

The rest of this page is for whoever works on the code. [CLAUDE.md](CLAUDE.md) has the detailed
guide to how the code is organised.

## The shape of it

It's a **static website with no build step**: plain HTML, one stylesheet and a handful of
JavaScript files, served by **Firebase Hosting**. Game data lives in **Cloud Firestore**, and the
live "who's here and where's their finger" signals go through the **Firebase Realtime Database**.

```
public/index.html     the page; loads the Firebase SDK, then our scripts in a fixed order
public/css/app.css    every style; design tokens at the top
public/js/*.js        classic scripts sharing globals (no modules, no bundler)
public/art/           painted textures and illustrations (generated by tools/paint_art.py)
firestore.rules       who may read and write tables and matches
database.rules.json   what presence and chat entries may look like
firebase.json         hosting, cache headers, emulator ports
```

**Why no framework or bundler?** It started life as a single Claude artifact and is played by two
people. Plain files mean nothing to install, upgrade or rebuild: what's in `public/` is exactly
what the phones get. The npm packages (`firebase-tools`, `playwright`) are only for running,
testing and deploying.

The Firebase SDK is the "compat" build loaded from Google's CDN at a pinned version (10.14.1). That
build works with classic `<script>` tags, which is what keeps the no-build setup possible.

## Where everything is stored

| What | Where | Lifetime |
| --- | --- | --- |
| Tables: the two seats, the current game, saved games, results, notices | Firestore `tables/{CODE}` | Until the table is cleared (not pruned automatically) |
| Games: every move, pick and shot | Firestore `tables/{CODE}/matches/{id}` | Deleted along with its table |
| Who's at the table, which screen they're on, where their finger is | Realtime Database `presence/{CODE}/{id}` | Removed the moment that phone disconnects |
| Reactions and notes | Realtime Database `chat/{CODE}/{id}` | Older than a day: removed when a table is opened. The last 12 hours are shown |
| This phone's identity, your name, sound on/off, last table, recent tables | The browser's `localStorage` | Until the browser's site data is cleared |
| Half-placed fleets, "don't show the rules again", a Quickfire round's start time | `localStorage` | Kept so a reload doesn't lose them |

### Game data: Firestore

Each table is one document, and each game played at it is a document underneath it. Firestore was
chosen for games because it's durable (a saved game is still there next month), it pushes every
change to both phones live, and it queues writes while a phone is offline.

**Moves are an append-only log, never a board.** A move is written under its own numbered key
(`moves.m007`, `shots.s012`, `plays.p00042`, `finds.f004`, …). A phone never rewrites the board, only adds a
line to the log, so the two phones can't overwrite each other. The board, whose turn it is and who
won are *worked out* by replaying the log in order. Both phones run the same replay on the same
log, so they always agree, and nothing derived is ever stored. That's also what makes saving free:
a saved game is just a log that stops, and carrying on is replaying it.

- Writes are deep-merge updates of single fields, so each move only touches its own key.
- Firestore shows a phone its own writes immediately (latency compensation), so your move appears
  at once while it's still being confirmed.
- New Hues games write each move in a **transaction** that checks the move against the latest log
  first, so a stale tap can't sneak in out of order. (Saved games from before that keep their
  original replay.) Word Wheel words are claimed the same way, so the same word can't be taken by
  both phones at once. The one-time choices (Hues rules, the Quickfire setup, the wheel)
  are transactions too, so only the rock, paper, scissors winner can make them, and only once.
- The replay functions are pure, and a test (`tests/unit/replay.mjs`) checks them against recorded
  results for a few hundred games. Changing how old games replay would break saved games, so it
  can't happen by accident.

### Presence and chat: Realtime Database

Presence changes many times a second while someone drags a disc or aims, and it has to vanish the
instant a phone drops off. The Realtime Database fits both: writes are cheap and fast, and
`onDisconnect()` removes a phone's entry on the server when the connection goes, even if the phone
just died. Presence never holds game state: it's purely "who's here and what are they touching".

Chat lives there too, as short messages; ones older than a day are removed whenever a table is opened. Messages already in the room
when you open a table are shown as history in the thread, never popped up as new.

### This phone: localStorage

Each phone gets a random **device id** the first time it opens the site. That's how a phone
recognises its own seat at a table: seats belong to devices, not names, since two people could
type the same name. There are no accounts or passwords. Everything this phone remembers is under
`gs:` keys in `localStorage`. To test both seats on one computer, open a second tab with `?as=2`;
it gets its own set of keys and so its own identity.

## Fair play without a server

There is no game server of our own: the two phones and the shared log are the whole system.

- **Turns can't clash.** Each phone only adds moves when the replay says it's that phone's turn,
  and moves that don't fit (wrong seat, illegal card) are skipped by the replay on both phones.
- **Quickfire timing is per phone.** An answer records the milliseconds measured on the answering
  phone from when the puzzle appeared on *that* screen (the clock doesn't start while the app is in
  the background, and a reload keeps the start time).
  The fastest right answer wins. A phone that sees a faster answer keeps its own player racing
  until its own clock passes that time, so neither lag nor clocks that disagree decide a round.
- **The Hues call-out lockout** starts on the catching player's phone only once that phone has
  actually shown its new turn, and lasts two seconds there. A slow connection can't let anyone be
  caught before the catcher could have seen the chance, and nothing is ever penalised automatically.
- **The trust model:** anyone who has a table's four-letter code can read and write that table.
  That's deliberate for two people who trust each other. It means a curious partner with developer
  tools could peek at hidden things: rock, paper, scissors picks before the reveal, the other fleet,
  the other Hues hand. Hiding those properly would need per-player accounts or a server.

## Security

- **No keys in the repository.** `public/js/firebase-config.js` is generated right before each
  deploy by `tools/firebase-config.mjs` (from the logged-in Firebase CLI and `.env`) and is
  git-ignored. Locally it's a placeholder, because the emulators need no real settings.
- **The browser API key only works from this site.** Every Firebase web app sends its settings to
  the browser, so the key is restricted in Google Cloud Console to the site's two addresses.
- **App Check** (reCAPTCHA Enterprise) is enforced on Firestore and the Realtime Database, so they
  only answer the real site, not scripts or copies of it.
- **Rules guard the data shapes.** Only table and match documents with valid codes can be touched,
  tables can't be listed (you need the code), and presence and chat entries are validated field by
  field (a note is at most 80 characters, chat timestamps come from the server).
- GitHub secret scanning, push protection and Dependabot alerts are on.

## Caching and delivery

Set in `firebase.json`:

- **HTML, JavaScript and CSS are `Cache-Control: no-cache`.** That doesn't mean "download every
  time": the browser keeps its copy but checks with the server before using it, and gets a tiny
  "not modified" answer when nothing changed. The point is that a deploy reaches both phones the
  next time the app is opened, with no stale mix of old and new scripts. Since the files aren't
  bundled or fingerprinted, this is the simple way to keep them consistent.
- **Art and icons are cached for a week** (`max-age=604800`). They're big, they change rarely, and
  they're the bulk of what a phone downloads. The catch: a repainted image with the *same file
  name* can take up to a week to reach a phone that already has the old one, so give changed art a
  new name.
- **`X-Content-Type-Options: nosniff`** on everything, so browsers never guess a file's type.
- **Clean URLs and one page:** every path is answered with `index.html`, so invite links like
  `/?join=ABCD` always open the app.
- **No service worker / offline mode.** Playing needs both phones online anyway, so there's nothing
  useful to do offline, and leaving it out avoids a whole class of "stuck on an old version" bugs.
- Fonts (Caprasimo, Caveat, Figtree) come from Google Fonts.

## Built for phones

- **Touch first:** big targets (44 px or more), drag and tap with pointer events, no hover-only
  controls, and boards set to `touch-action: none` so dragging never scrolls the page.
- **No sound files.** Every sound is synthesised with WebAudio. iOS only allows audio after a tap,
  so sound starts on your first touch.
- **The painted look is procedural.** The watercolour textures and illustrations are generated by
  `tools/paint_art.py` (numpy, scipy, Pillow) and the home-screen icons by `tools/make_icons.py`.
  To change the art, change the scripts, not the PNGs.
- **Keyboards.** In Quickfire's Words race one text field stays focused across rounds, because iOS
  only raises the keyboard from a tap; the layout follows the visible area above the keyboard.
  Sums use the app's own paper keypad instead of switching keyboards mid-race.
- **The screen stays awake** during a game via the Wake Lock API, asked for again whenever you come
  back to the app (browsers drop it when the phone locks).
- **Connection handling.** A short blip is quiet; a dropped connection for more than a couple of
  seconds gets a "Reconnecting…" note. Firebase reconnects by itself, and a write that gets no
  answer within 15 seconds is reported as a failure, not left hanging.

## Running it on your computer

Needs Node 20 or newer and Java 11 or newer (for the Firebase emulators).

```bash
npm install
npm start
```

That runs the Firebase emulators locally, so nothing touches the real project. Open
http://localhost:3000, and http://localhost:3000/?as=2 in a second tab to play the other seat.
Local game data is thrown away when you stop it.

The app uses the emulators automatically whenever the page is on `localhost` or a private network
address. So a phone on the same Wi-Fi can open `http://<your computer's local IP>:3000`
(`ipconfig getifaddr en0` on a Mac). Sharing, copying the invite link and keeping the screen awake
need HTTPS, so those only fully work on the deployed site.

## Tests

```bash
npx playwright install chromium   # once
npm test                          # unit tests, then two browser "phones" play every game against the emulators
HEADED=1 npm run test:e2e         # watch the phones play
```

- `tests/unit/`: the game replays, Hues, Quickfire and Word Wheel rules (and every wheel's word list), the
  stats, and table history, run in Node.
  `replay.mjs` compares every replay function against recorded results.
- `tests/e2e/`: Playwright drives two phones at 390×844 through full games of everything, saving
  and quitting, chat, reconnecting and reloading. Screenshots land in `tests/e2e/screens/`.
- `tests/visual/compare.mjs`: proves a CSS change renders identically (computed styles and pixels
  at three screen sizes). See its header for how to run it.

## Deploying

The live site is the Firebase project `gameshelf-ee306` (pay-as-you-go Blaze plan; two people
playing stays inside the free quota). Nothing deploys automatically: merging to `main` changes
GitHub only.

```bash
npx firebase login    # once per machine
npm run deploy        # writes the web settings, then publishes hosting + Firestore rules + Realtime Database rules
```

Before the first deploy from a new machine, copy `.env.example` to `.env` and fill in the App Check
site key. After a deploy, phones pick up the new version the next time the app is opened, and games
in progress carry on, since the stored data doesn't change shape.

Old tables are never cleaned up automatically; they're tiny.
