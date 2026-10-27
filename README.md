# Our Game Shelf

Connect Four and Battleships for two, played on two phones wherever you both are.
One of you sets up a table and sends the invite; the other joins with the four-letter code.
Rock, paper, scissors decides who goes first.

It's a static site on Firebase Hosting. Games are stored in Firestore and kept in sync live;
who's at the table (and where their finger is) goes through the Realtime Database.
There is no build step.

## Run it on your computer

Needs Node 20 or newer and Java 11 or newer (for the Firebase emulators).

```bash
npm install
npm start
```

That runs the Firebase emulators locally, so nothing touches the real project. Open
http://localhost:3000. To play both sides on one computer, open a second tab at
http://localhost:3000/?as=2. Local game data is thrown away when you stop it.

To try it on your phone over the same Wi-Fi, find your computer's local IP
(on a Mac: `ipconfig getifaddr en0`) and open `http://<that-ip>:3000` on the phone.
Sharing, copying the invite link and keeping the screen awake need HTTPS, so they work fully
on the deployed site.

## Put it online

The site runs on Firebase (pay-as-you-go Blaze plan; two people playing stays inside the free quota).

```bash
npx firebase login
npm run deploy        # hosting + Firestore rules + Realtime Database rules
```

The project is set in `.firebaserc` and its web config in `public/js/firebase-config.js`
(`npx firebase apps:sdkconfig web`). The config values are public by design;
`firestore.rules` and `database.rules.json` decide what can be read and written.

Then open the site on both phones and use **Add to Home Screen** (Safari share menu on iPhone,
the ⋮ menu in Chrome on Android). It launches full-screen like an app.

## Tests

```bash
npx playwright install chromium   # once
npm test                          # starts the emulators; two phones play a full game of each
```

See `CLAUDE.md` for how the code is organised.
