# Hues: updated rules and interface

New Hues games use rules version 2. After the usual best-of-three rock, paper, scissors, its winner chooses **Custom** or **Official-style**. The other player sees the choice screen but cannot change the selection. Both phones use the chosen rules. Existing saved version-1 games retain their original replay and show “Custom · saved rules”; start a new game for the updated rules.

## Both modes

- Declare **Hues!** only with exactly one card. Every draw resets the declaration. If you draw a playable card and play it to return to one, declare again.
- When the opponent’s screen has finished showing its new turn, that screen starts a two-second **Call out lockout**. Only that player sees the countdown; the button is disabled throughout it.
- Expiry only unlocks Call out. It never penalizes automatically. The player on one card may still declare after expiry, until an opponent actually catches them.
- An unlocked, valid Call out immediately draws two for the caught player. Duplicate clicks and stale one-card episodes cannot queue extra penalties. Playing or drawing instead closes that turn’s missed-declaration opportunity.
- A final Splash/Flood waits for its mandatory penalty to settle. In Custom, an existing stacking card can return the penalty to the empty-handed player. Taking the penalty ends the game immediately if the opponent is still out; newly drawn cards cannot restart that finished game.
- A final Blend ends after the colour is chosen. The colour picker sits above the remaining hand, with four large paint pots and a cancel action. It works with tap-select/tap-play and with dragging.

## Differences shown before play

| Rule | Custom | Official-style |
| --- | --- | --- |
| Cards per play | Matching number cards together | One card |
| Draw penalties | Splash/Flood stacks, using the existing Hues matching rules | No stacking |
| After paying | Play a card or pass, unless the game has ended | Skip that player’s turn |
| Flood | Existing Hues wild rule | Only if no card in the active colour |
| Trade | Swap hands and choose a colour | Swap hands and choose a colour |
| Manual draw-pile shuffle | Twice per player, on either turn, between moves | Unavailable |

The button reads “Shuffle pile” and shows uses remaining. Either Custom player may use it between moves, twice each. A manual shuffle changes only the order of the remaining draw pile, for both players. It preserves all hands, the top card, active colour and turn. Automatic recycling when the draw pile runs out remains available in both modes.

Both modes keep the complete 95-card Hues deck, including Trade. Official-style applies classic turn rules to those painted cards, as requested; it is a first-out adaptation rather than UNO’s exact deck, bluff/challenge mechanism or 500-point match scoring. The two-player penalty/skip behaviour and drawn-card restriction were checked against [Mattel’s UNO instructions](https://service.mattel.com/instruction_sheets/53641.pdf).

## Sync and timing

The state is derived by replaying append-only commands. Version 2 uses Firestore transactions to validate against the latest match and serialize writes. Hues declarations and callouts can rebase over concurrent events, while repeated card plays cannot silently overwrite each other.

A `notice` command records when the receiving player has actually rendered the new turn and the opponent is still on one undeclared card. Its timestamp uses the Realtime Database server-time offset. The resulting deadline and button availability are derived on both phones; the countdown is rendered only on the receiving phone. The one-card episode key invalidates notices/callouts after any draw or new episode. No derived turn, deadline or winner field is stored in the match.

## Rules sheets and recent tables

Shelf previews and the question-mark help panel now share a bounded, touch-scrollable content region. The decision buttons remain reachable at the bottom of the sheet. The pre-game rules screen retains its existing scrolling.

Recent table history stores up to 20 table codes, player names and visit dates on the current device. It appears on the landing screen and is accessible from the shelf. It starts recording tables as this version is used, including an existing table reopened on this device. It cannot recover unknown older codes or sync across devices without an account.

Rejoining checks the table’s original creation/host identity and this device’s existing seat. Player names are display labels, not authentication. A reused or deleted code cannot take you into a different table through an old history row. Removing a history entry only removes the local record.

The deck audit checks all 95 IDs and 22 cards of each colour across 1,000 seeded deals. Initial hand totals were 3,257 Lavender, 3,273 Orange, 3,299 Navy and 3,277 Sage; 108 of those openings had at most one Lavender across the two hands, with the other Lavender cards still in the pile. No hidden colour balancing is applied.
