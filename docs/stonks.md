# STONKS

The fifth shelf game. Source: IPOs Rules and card content, version 1, 27 October 2026. Play is for Niramay and his partner only; best-of-three rock-paper-scissors decides the starter instead of age. The user's 28 October house rules also override the original hand and banking costs for new games.

## Current house rules and table

New matches carry `stRulesVersion: 2`. Each deal or draw automatically banks Funding and places Companies/wilds into eligible portfolios. Only actions and Revenue Calls remain in the private hand. Named Companies fill matching incomplete portfolios; wilds prefer an eligible incomplete portfolio and can be rearranged free on the owner's turn. Automatic placement and action/Revenue banking use no plays, including banking after the third action. Empty action hands draw five at the start of the next turn; other hands draw two. The seven-card limit applies to the action hand. Payments, Legal Team chains, upgrades and the three-different-complete-portfolios victory requirement remain.

The compact table follows Hues: opponent hand count and public assets above, a central pile/decision area, then your table and action hand. Tap a sector or Treasury stack to spread its cards; tap again to put them down. Expanded two-colour wilds flip on tap. Any-sector Conglomerates show all ten colours and no payment value. Company faces use colour/name banners and revenue ladders; actions use value corners and title stamps. Long restrictions are available in the selected-card inspector and rules panel. Payment selection uses the expanded public assets with a pinned confirmation prompt.

Existing saved games without the version marker retain their original all-card hands and one-play banking. Start a new STONKS game to use the automatic-placement rules. The source manifest remains unchanged for traceability. [Redesign plan](stonks-ui-plan.md) records these decisions.

## Screen plan

Visual thesis: painted businesses and paper cards on the same blue linen, with the same restrained motion and handmade character as Hues.

Content plan: existing-style back/help controls and title; handwritten required-player status; expandable public portfolios and Treasuries; a compact action hand; one active decision. The handoff screen replaces all private hand content. Setup and rules use paper and washi tape. Desktop gives the board and hand more space; mobile keeps targets at least 44px.

Interaction thesis: existing painted RPS hand cards; a small lift on selected cards; a gentle paper entrance for handoffs. Honour reduced motion. No hover-only instructions; every long restriction is available in the rules panel and selected card inspector.

## Files and data

- `public/js/stonks-data.js`: classic-script card manifest and concise card-face/expanded rules text.
- `docs/stonks-cards.json`: portable structured data for all 110 physical cards, including production IDs.
- `public/js/stonks-engine.js`: pure immutable command validation and append-only-log replay.
- `public/js/stonks.js`: two-phone Firebase adapter plus local two-player room, opener, handoff privacy, accessible card/rules UI.

The inventory is consistent: 28 Companies + 11 wilds + 34 actions + 13 Revenue Calls + 20 Funding = 106 playable cards, plus 4 References = 110. Funding totals 57M. No genuine source contradictions found. The initial arithmetic concern in commentary was an error and was corrected.

## Two-phone play and privacy

The fifth shelf box uses the same Firebase tables, four-letter codes, game invitations, best-of-three RPS, chat, save/resume and results as the original games. Hands are rendered only for the phone's own seat. Public portfolios and Treasuries are visible to both. All commands are validated by the pure engine; a Firestore transaction compares the current log length and appends one legal command, preventing stale/double moves in normal play. Derived state is never stored.

This deliberately follows AGENTS.md's existing trusted-client model, like Battleships: the shuffled deck and both hands can be reconstructed from shared match data by someone using developer tools. Client validation is not a security boundary. This is hidden-hand game UI, not server-enforced secrecy.

For server-enforced private hands, a further version needs:

1. Authentication binding each player to one room seat, with invitation and reconnect handling.
2. A trusted command endpoint/Cloud Function running the reducer transactionally with a revision number, validating the authenticated seat and rejecting stale commands.
3. Server-only shuffle/deck and hands; a public room projection containing hand counts, portfolios, Treasuries, response prompts and discard; private per-player hand documents protected by security rules.
4. Server-controlled response progression, victory and save/resume; emulator tests with two authenticated clients proving neither can read the other hand or deck.

Published to the existing Firebase Hosting site at https://gameshelf-ee306.web.app. Verified live with two regular browser sessions: table creation/joining, RPS, separate hands, synchronized company/funding/action plays, payment selection and transfers, reload, and save/resume. Automated production browsers were rejected by App Check; the ordinary in-app browser passed without changing protection settings.

## Optional local room

The development URL `?stonks=1` provides a separate local pass-and-play prototype on one browser/device. Its room label is local identification, not a remote join code. Hands hide at handoff, reload and backgrounding. Browser storage contains the deck and hands and is inspectable. Progress is saved per existing device profile in localStorage. It has no shortcut on the landing screen; players choose STONKS from the shelf.
