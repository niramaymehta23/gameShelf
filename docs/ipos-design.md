# IPOs — design draft (v0.1, for two)

A quick game of hype and timing. Back companies at their IPO, pump the sectors you hold, talk down
the ones your partner holds, and cash out before the bubble pops. Richest after four quarters wins.

Kept from the original IPOs document: the 28 parody companies, the ten sectors and their colours,
the funding-cheque jokes, and the "Treasury" for your money. Everything else (rules, cards, scoring)
is new.

About 15 minutes. Four quarters, each with the same four steps.

---

## The market

Each sector has a **share price** on a track from 1 to 12, a **bubble line**, and a **dividend**.

| Sector (colour) | Companies | Start | Bubble line | Dividend | Personality |
|---|---|---|---|---|---|
| Scrappy ventures (brown) | WeWobble, Groupoff | 1 | 5 | 0 | Lottery tickets |
| On-demand (light blue) | Ooober, DoorDawdle, AirBeanB | 2 | 7 | 1 | |
| Fintech (pink) | PayFoe, Stryype, Blockish | 3 | 8 | 1 | |
| Entertainment (orange) | Netflicks, Spotifry, YouToob | 3 | 8 | 1 | |
| Social media (red) | Metah, TikTak, SnapChatter | 4 | 9 | 1 | |
| Devices and chips (yellow) | Appull, Samsong, Nvidiot | 4 | 10 | 1 | |
| Platform giants (green) | Joogle, Zamazon, Macrosoft | 5 | 10 | 2 | |
| AI labs (dark blue) | Twothropic, BatGPT | 5 | 12 | 0 | Pre-revenue: all hype |
| Logistics (black) | FedUps, OopsPS, DHeLivery, Maersk My Words | 3 | 7 | 2 | |
| Utilities (grey) | Shwell Energy, BeePee Power | 2 | none | 2 | Never bubbles, capped at 6 |

- A price never goes below 1 or above 12 (Utilities: 6).
- A company is worth its sector's current price. Prices are in M.
- **Above the bubble line** a sector is *frothy*: shown on the board, not yet popped. It pops only
  at Earnings (step 4), so both players get a chance to react.

## Setup

- Each player starts with **15M** in their Treasury (shown as cheques: Seed 1M, Angel 2M, Series A 3M,
  Series B 4M, Mega Round 5M, Whale 10M; just a total in the rules).
- Shuffle the 28 companies into the **listing deck**. Shuffle the 24 news cards into the **news deck**.
- Rock, paper, scissors decides who leads the first quarter. The lead alternates each quarter.

## A quarter

### 1. Newsflow
Each player draws **3 news cards**. Unplayed cards carry over; keep at most 5 (discard the rest).
(24 cards, 3 each, 4 quarters: the deck is dealt out exactly once.)

### 2. Roadshow (both at once, sealed)
Four companies are listed face up. Both players secretly bid on any of them at the same time:

- A bid is 0 (pass) or at least the sector's current price.
- Your bids together can't be more than your Treasury.
- Bids are revealed together. The higher bid wins the company and pays the bank.
  **Tie:** the player with less money wins it; if money is equal too, the IPO is pulled.
- Each company won **lifts its sector by 1** (the IPO pop).
- Listings nobody wins are pulled from the game.

(16 of the 28 companies list each game, so the mix changes every time.)

### 3. Trading (take turns)
Starting with the lead, take turns. On your turn do **one** of:

- **Play a news card** from your hand.
- **Cash out** one of your companies: the bank pays the current price, then that sector **drops by 1**.
- **Pass.**

Trading ends when both players pass in a row. (Passing doesn't stop you acting next time round.)

### 4. Earnings
In this order:

1. **Shorts settle** (see Short Seller).
2. **Bubbles pop.** Every sector above its bubble line pops: all companies in that sector are
   **delisted** (removed, worth nothing), and its price goes back to its start value.
3. **Dividends.** Each company you still hold pays its sector's dividend into your Treasury.

After the fourth quarter's Earnings, the market closes: **score = Treasury + the current price of every
company you hold.** Highest score wins. Tie: whoever holds more companies.

---

## The news deck (24 cards)

| Card | Copies | Effect (card text) |
|---|---|---|
| Hype Train | 6 | Raise one sector by 2. |
| Viral Moment | 4 | Raise two different sectors by 1 each. |
| Scandal | 5 | Lower one sector by 2. |
| Regulator Calling | 3 | Lower one sector by 3. |
| Short Seller | 2 | Pick a sector. At Earnings, gain 2M for each step it is below its price now. If it's higher, pay 1M per step. |
| Acqui-hire | 2 | Buy one of your partner's companies at its price + 2M. They must sell. |
| Lockup Expiry | 2 | Lower by 1 every sector where your partner holds more companies than you. |

Flavour lines (printed small, under the rules, never part of them): Hype Train "Everyone is talking
about it. Nobody has used it." Scandal "Leaked group chat." Regulator Calling "Please hold."

## Why it plays well (the tensions)

- **Pump or pop.** Raising a sector you hold makes you richer, but raise it too far and it pops at
  Earnings. Your partner can push your sector over the line on purpose.
- **Cash out timing.** Selling saves you from a pop but drops the price for anyone still holding.
- **Sealed bids.** Both phones bid at once, with both Treasuries visible: bluffing about which listing
  you really want.
- **Sector personalities.** AI labs have the highest ceiling and pay nothing; Utilities never pop and
  pay steadily; Scrappy ventures are cheap and pop early.

## Card faces (for the app and for printing, 63 × 88 mm)

**Company card**: name (large, Caprasimo) · sector and colour band · dividend · bubble line.
No price on the card: the price lives on the market board.

```
BatGPT
AI LABS · DARK BLUE
Dividend: none
Bubble line: 12
```

**News card**: name · rule text (≤ 25 words) · flavour line in handwriting.

```
SCANDAL
Lower one sector by 2.
"Leaked group chat."
```

## How it fits the app (for the build)

- Match field `seed` shuffles both decks on both phones (same as Hues).
- Roadshow bids: `bids: { q1: { host: [b1,b2,b3,b4], guest: [...] }, ... }` — like the RPS rounds,
  revealed only when both are in. Flat arrays of numbers, no nesting.
- Trading: append-only `plays: { p0000h: {k:'news', id, s?, s2?}, p0001g: {k:'cash', id}, p0002h: {k:'pass'} }`.
- `ipoState(m)` replays it all: prices, holdings, hands, Treasuries, frothy sectors, whose turn,
  final score. Nothing derived is stored.
- Screens: a market board (ten sector tracks with the bubble line drawn in red), your holdings, your
  hand of news cards, and a bid sheet for the Roadshow.
- Same caveat as Hues: a curious partner with dev tools can see hands and sealed bids.

## Open questions

1. **Pops: delist or crash?** Draft: pop = companies removed. Gentler: price drops to 1, you keep them.
2. **Length:** four quarters (16 listings) feels right for a phone game. Seven quarters would list
   all 28 companies, but would take about twice as long.
3. **Starting money (15M)** and the news mix are first guesses; I'll tune them by having the e2e
   test (or a quick simulation) play many games.
