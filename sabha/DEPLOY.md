# Putting Sabha Games online (Fly.io)

You get one link, `https://<app-name>.fly.dev`, that works on any phone, on Wi-Fi or mobile data.
Players use the QR on the host screen; the host opens `/host` on the same link.

Cost: about $0.003 an hour while the machine runs (~$2.19 a month if left on all month) plus ~$0.15 a
month for the 1 GB disk that keeps scores across a restart. No subscription; billed by the second.

## Once: set up (about 10 minutes)

1. Install Fly's command-line tool on your laptop.
   - Mac: `brew install flyctl` (or `curl -L https://fly.io/install.sh | sh`)
   - Windows (PowerShell): `iwr https://fly.io/install.ps1 -useb | iex`
2. Make an account and sign in: `fly auth signup` (or `fly auth login`). Add a card when it asks
   (Dashboard → Billing).
3. Get the code on your laptop and go into the `sabha` folder:
   ```bash
   git fetch origin && git checkout claude/festive-rubin-bdd5yg && git pull
   cd sabha
   ```
4. Create the app from the config that's already here (say **No** if it offers to tweak settings):
   ```bash
   fly launch --copy-config --no-deploy --ha=false
   ```
   If it says the name `sabha-games` is taken, pick another (e.g. `harisena-sabha`); it updates fly.toml.
   The region is London (`lhr`) in fly.toml; change `primary_region` first if the sabha is elsewhere
   (`fly platform regions` lists them).
5. Create the disk (same region as fly.toml):
   ```bash
   fly volumes create sabha_data --size 1 --region lhr --yes
   ```
6. Deploy:
   ```bash
   fly deploy --ha=false
   ```
   `--ha=false` matters: the games live in one server's memory, so there must be exactly one machine.
7. Open `https://<app-name>.fly.dev/host` on the host phone and tap **New Session**.

After a code change, run `fly deploy --ha=false` again from the `sabha` folder (not during a game: it
restarts the server; scores up to the last finished round are kept and the host replays the round).

## On the night

- Check it's running: `fly status` (one machine, state `started`). If it was turned off: `fly scale count 1`.
- Host: open `/host` 10 minutes early, New Session, hold the QR up.
- If something looks wrong: `fly logs` shows the server's output live.

## Turning it off afterwards

Leave it on until everyone has seen the final screen. Take a screenshot of the host's Final screen and
the Audit if you want a record (rooms are also kept on the disk for a day).

- **Stop paying for the machine, keep everything for next time:** `fly scale count 0`
  (only the disk is billed, ~$0.15/month). Start again with `fly scale count 1`.
- **Delete everything, stop all charges:** `fly apps destroy <app-name>` (deletes the disk and its saved
  rooms too). Next time, do the set-up again from step 4.
