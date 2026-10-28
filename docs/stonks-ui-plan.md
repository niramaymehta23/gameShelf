# STONKS table redesign

The user's 28 October corrections override the document's original hand and play-cost rules for new games. Existing saved matches retain the original reducer behaviour.

## Layout

- Keep the existing linen, painted paper, tape, Caprasimo, Caveat and Figtree.
- Follow Hues: two turn chips, the opponent's compact public table, a central draw/discard area and required-player prompt, your public table, then your compact overlapping hand.
- The hand contains only action and Revenue Call cards in new games. Newly dealt/drawn Funding goes to Treasury; named Companies and wilds go directly to portfolios. No extra tap to place them.
- Group public Companies by sector colour. Collapsed piles show colour/title strips and counts, with a small revenue/completion label. Tap the pile to spread its cards; tap the same pile to put them down again. Treasury uses the same interaction.
- Show full card rules in the selected-card inspector and rules panel. The normal table has no rule paragraphs, debug IDs or permanently expanded forms.
- Keep only the active decision open: selected action, Legal Team response, payment, incoming wild placement, or excess-card discard. Keep the private hand visible while deciding.

## Card faces

- Companies: printed value badge, broad sector-colour name banner, compact count/revenue ladder, and complete size.
- Two-colour Pivots: opposing colour banners and ladders, with active orientation clear. Tap an owned, expanded Pivot to flip its assignment free on your turn. Warn before a flip would discard attached upgrades.
- Conglomerates: all ten colour marks, an Any sector face, and explicit no payment value. Sector choice stays available on the player's turn.
- Actions: value badges in opposing corners, a clear title/stamp in the centre and one short effect line. Expanded rules preserve restrictions. Banked actions remain money permanently.

## New-game rules

- Add a rules-version marker to new online and local games. Older logs replay unchanged.
- Draw five each and the usual starter draw; route each draw batch automatically. Put named Companies together in the first matching incomplete portfolio. Assign wilds to an eligible existing incomplete portfolio where useful, otherwise their first printed colour; players may rearrange them free on their turn.
- A played action/Revenue Call/upgrade uses its normal action cost. Banking an action or Revenue Call uses zero plays, including after play three. Automatic Funding/Company placement is also free.
- Keep empty-action-hand draw-five, the seven-card action-hand limit, legal response chains, payments, upgrades, portfolio-size restrictions, named-Company requirement, and three-different-colour victory.
- Check victory after automatic placements as well as completed actions/transfers. Preserve the 110-card source inventory and names/values.

## Hues

- Audit all 95 IDs and 22 cards of each colour across complete deals/draws, and verify shuffle/conservation on both phones. A random deal need not have equal colour counts; do not secretly change the deck to force a result.
- Make Shuffle draw pile explicit, with remaining uses and confirmation. Allow either Custom player to reshuffle between moves, twice each, while retaining the same hands, top card and turn. Official-style remains without manual shuffles.

## Verification and release

- Unit checks for automatic placement on initial deal, turn draws, empty-hand draws, Pitch Deck, wild assignment, free banking after three plays, victory, card conservation and legacy replay.
- Touch tests for pile expand/collapse, dual-wild flips, any-sector assignment, bank/use choices, payment selection and Legal Team chains. Complete a new-rule game on two synchronized phones; reload and save/resume.
- Inspect 390×844 and narrow-phone screens plus desktop. Run the repository's syntax/full game checks, then publish and verify matching live assets and normal-browser interaction.
