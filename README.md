# Our Game Shelf

Connect Four and Battleships for two, played on two phones wherever you both are.
One of you sets up a table and sends the invite; the other joins with the four-letter code.
Rock, paper, scissors decides who goes first.

A small Node server serves the app and keeps both phones in sync over a WebSocket.
There is no build step and only one runtime dependency (`ws`).

## Run it on your computer

Needs Node 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. To play both sides on one computer, open a second tab at
http://localhost:3000/?as=2.

To try it on your phone over the same Wi-Fi, find your computer's local IP
(on a Mac: `ipconfig getifaddr en0`) and open `http://<that-ip>:3000` on the phone.
Sharing, copying the invite link and keeping the screen awake need HTTPS, so they work fully
once the app is deployed.

## Put it online (so you can play from two places)

Any host that runs a Node process and supports WebSockets works. Game data is one JSON file,
so give it a persistent disk if you want tables to survive restarts. Set `DATA_FILE` to a path on
that disk.

**Fly.io** (recommended: persistent volume, always on, HTTPS):

```bash
brew install flyctl && fly auth login
fly launch --no-deploy            # keeps the included fly.toml; choose an app name and region (lhr = London)
fly volumes create shelf_data --size 1 --region lhr
fly deploy
```

**Railway / Render:** create a web service from this repo, start command `npm start`, add a
disk/volume mounted at `/data`, and set `DATA_FILE=/data/db.json`. On free plans without a disk,
tables are lost when the server restarts. That's fine for playing, but the score sheet resets.

**Docker:** `docker build -t game-shelf . && docker run -p 3000:3000 -v shelf:/data game-shelf`

Then open the site on both phones and use **Add to Home Screen** (Safari share menu on iPhone,
the ⋮ menu in Chrome on Android). It launches full-screen like an app.

## Settings

| Variable    | Default         | Meaning                                       |
|-------------|-----------------|-----------------------------------------------|
| `PORT`      | `3000`          | Port to listen on                             |
| `HOST`      | `0.0.0.0`       | Interface to bind                             |
| `DATA_FILE` | `data/db.json`  | Where tables are saved; `memory` keeps nothing |

Tables nobody has touched for 30 days are cleared automatically.

## Tests

```bash
npm test                          # document store
npx playwright install chromium   # once
npm run test:e2e                  # two phones play a full game of each
```

See `CLAUDE.md` for how the code is organised.
