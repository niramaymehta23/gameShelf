'use strict';
// Faithful card inventory transcribed from the supplied document; production IDs retained.
const STONKS_DATA = {
  "name": "STONKS",
  "source": "IPOs Rules and card content, version 1, 27 October 2026. Game title renamed by request.",
  "sectors": [
    {
      "key": "brown",
      "name": "Brown",
      "colour": "Brown",
      "sector": "Scrappy ventures",
      "size": 2,
      "value": 1,
      "revenue": [
        1,
        2
      ]
    },
    {
      "key": "lblue",
      "name": "Light blue",
      "colour": "Light blue",
      "sector": "On demand platforms",
      "size": 3,
      "value": 1,
      "revenue": [
        1,
        2,
        3
      ]
    },
    {
      "key": "pink",
      "name": "Pink",
      "colour": "Pink",
      "sector": "Fintech",
      "size": 3,
      "value": 2,
      "revenue": [
        1,
        2,
        4
      ]
    },
    {
      "key": "orange",
      "name": "Orange",
      "colour": "Orange",
      "sector": "Entertainment",
      "size": 3,
      "value": 2,
      "revenue": [
        1,
        3,
        5
      ]
    },
    {
      "key": "red",
      "name": "Red",
      "colour": "Red",
      "sector": "Social media",
      "size": 3,
      "value": 3,
      "revenue": [
        2,
        3,
        6
      ]
    },
    {
      "key": "yellow",
      "name": "Yellow",
      "colour": "Yellow",
      "sector": "Devices and chips",
      "size": 3,
      "value": 3,
      "revenue": [
        2,
        4,
        6
      ]
    },
    {
      "key": "green",
      "name": "Green",
      "colour": "Green",
      "sector": "Platform giants",
      "size": 3,
      "value": 4,
      "revenue": [
        2,
        4,
        7
      ]
    },
    {
      "key": "dblue",
      "name": "Dark blue",
      "colour": "Dark blue",
      "sector": "AI labs",
      "size": 2,
      "value": 4,
      "revenue": [
        3,
        8
      ]
    },
    {
      "key": "black",
      "name": "Logistics",
      "colour": "Black",
      "sector": "Delivery networks",
      "size": 4,
      "value": 2,
      "revenue": [
        1,
        2,
        3,
        4
      ]
    },
    {
      "key": "grey",
      "name": "Utilities",
      "colour": "Grey",
      "sector": "Energy suppliers",
      "size": 2,
      "value": 2,
      "revenue": [
        1,
        2
      ]
    }
  ],
  "cards": [
    {
      "id": "C01",
      "kind": "company",
      "title": "WeWobble",
      "value": 1,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "brown"
    },
    {
      "id": "C02",
      "kind": "company",
      "title": "Groupoff",
      "value": 1,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "brown"
    },
    {
      "id": "C03",
      "kind": "company",
      "title": "Ooober",
      "value": 1,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "lblue"
    },
    {
      "id": "C04",
      "kind": "company",
      "title": "DoorDawdle",
      "value": 1,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "lblue"
    },
    {
      "id": "C05",
      "kind": "company",
      "title": "AirBeanB",
      "value": 1,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "lblue"
    },
    {
      "id": "C06",
      "kind": "company",
      "title": "PayFoe",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "pink"
    },
    {
      "id": "C07",
      "kind": "company",
      "title": "Stryype",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "pink"
    },
    {
      "id": "C08",
      "kind": "company",
      "title": "Blockish",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "pink"
    },
    {
      "id": "C09",
      "kind": "company",
      "title": "Netflicks",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "orange"
    },
    {
      "id": "C10",
      "kind": "company",
      "title": "Spotifry",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "orange"
    },
    {
      "id": "C11",
      "kind": "company",
      "title": "YouToob",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "orange"
    },
    {
      "id": "C12",
      "kind": "company",
      "title": "Metah",
      "value": 3,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "red"
    },
    {
      "id": "C13",
      "kind": "company",
      "title": "TikTak",
      "value": 3,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "red"
    },
    {
      "id": "C14",
      "kind": "company",
      "title": "SnapChatter",
      "value": 3,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "red"
    },
    {
      "id": "C15",
      "kind": "company",
      "title": "Appull",
      "value": 3,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "yellow"
    },
    {
      "id": "C16",
      "kind": "company",
      "title": "Samsong",
      "value": 3,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "yellow"
    },
    {
      "id": "C17",
      "kind": "company",
      "title": "Nvidiot",
      "value": 3,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "yellow"
    },
    {
      "id": "C18",
      "kind": "company",
      "title": "Joogle",
      "value": 4,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "green"
    },
    {
      "id": "C19",
      "kind": "company",
      "title": "Zamazon",
      "value": 4,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "green"
    },
    {
      "id": "C20",
      "kind": "company",
      "title": "Macrosoft",
      "value": 4,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "green"
    },
    {
      "id": "C21",
      "kind": "company",
      "title": "Twothropic",
      "value": 4,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "dblue"
    },
    {
      "id": "C22",
      "kind": "company",
      "title": "BatGPT",
      "value": 4,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "dblue"
    },
    {
      "id": "C23",
      "kind": "company",
      "title": "FedUps",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "black"
    },
    {
      "id": "C24",
      "kind": "company",
      "title": "OopsPS",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "black"
    },
    {
      "id": "C25",
      "kind": "company",
      "title": "DHeLivery",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "black"
    },
    {
      "id": "C26",
      "kind": "company",
      "title": "Maersk My Words",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "black"
    },
    {
      "id": "C27",
      "kind": "company",
      "title": "Shwell Energy",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "grey"
    },
    {
      "id": "C28",
      "kind": "company",
      "title": "BeePee Power",
      "value": 2,
      "text": "Add to your company collection. Cannot be banked.",
      "detail": "Add to your company collection. Cannot be banked.",
      "group": "grey"
    },
    {
      "id": "W01",
      "kind": "wild",
      "title": "Accelerator Pivot",
      "value": 1,
      "text": "Choose one eligible group. Counts as one company. Reassign free on your turn. Cannot be banked.",
      "detail": "A complete portfolio needs a named Company. May start a portfolio and make a one company Revenue Call. Payment value never changes.",
      "groups": [
        "brown",
        "lblue"
      ]
    },
    {
      "id": "W02",
      "kind": "wild",
      "title": "Last Mile Pivot",
      "value": 4,
      "text": "Choose one eligible group. Counts as one company. Reassign free on your turn. Cannot be banked.",
      "detail": "A complete portfolio needs a named Company. May start a portfolio and make a one company Revenue Call. Payment value never changes.",
      "groups": [
        "lblue",
        "black"
      ]
    },
    {
      "id": "W03",
      "kind": "wild",
      "title": "Subscription Pivot",
      "value": 2,
      "text": "Choose one eligible group. Counts as one company. Reassign free on your turn. Cannot be banked.",
      "detail": "A complete portfolio needs a named Company. May start a portfolio and make a one company Revenue Call. Payment value never changes.",
      "groups": [
        "pink",
        "orange"
      ]
    },
    {
      "id": "W04",
      "kind": "wild",
      "title": "Subscription Pivot",
      "value": 2,
      "text": "Choose one eligible group. Counts as one company. Reassign free on your turn. Cannot be banked.",
      "detail": "A complete portfolio needs a named Company. May start a portfolio and make a one company Revenue Call. Payment value never changes.",
      "groups": [
        "pink",
        "orange"
      ]
    },
    {
      "id": "W05",
      "kind": "wild",
      "title": "Creator Economy Pivot",
      "value": 3,
      "text": "Choose one eligible group. Counts as one company. Reassign free on your turn. Cannot be banked.",
      "detail": "A complete portfolio needs a named Company. May start a portfolio and make a one company Revenue Call. Payment value never changes.",
      "groups": [
        "red",
        "yellow"
      ]
    },
    {
      "id": "W06",
      "kind": "wild",
      "title": "Creator Economy Pivot",
      "value": 3,
      "text": "Choose one eligible group. Counts as one company. Reassign free on your turn. Cannot be banked.",
      "detail": "A complete portfolio needs a named Company. May start a portfolio and make a one company Revenue Call. Payment value never changes.",
      "groups": [
        "red",
        "yellow"
      ]
    },
    {
      "id": "W07",
      "kind": "wild",
      "title": "AI Platform Pivot",
      "value": 4,
      "text": "Choose one eligible group. Counts as one company. Reassign free on your turn. Cannot be banked.",
      "detail": "A complete portfolio needs a named Company. May start a portfolio and make a one company Revenue Call. Payment value never changes.",
      "groups": [
        "dblue",
        "green"
      ]
    },
    {
      "id": "W08",
      "kind": "wild",
      "title": "Fulfilment Pivot",
      "value": 4,
      "text": "Choose one eligible group. Counts as one company. Reassign free on your turn. Cannot be banked.",
      "detail": "A complete portfolio needs a named Company. May start a portfolio and make a one company Revenue Call. Payment value never changes.",
      "groups": [
        "green",
        "black"
      ]
    },
    {
      "id": "W09",
      "kind": "wild",
      "title": "Power Grid Pivot",
      "value": 2,
      "text": "Choose one eligible group. Counts as one company. Reassign free on your turn. Cannot be banked.",
      "detail": "A complete portfolio needs a named Company. May start a portfolio and make a one company Revenue Call. Payment value never changes.",
      "groups": [
        "black",
        "grey"
      ]
    },
    {
      "id": "W10",
      "kind": "wild",
      "title": "Conglomerate",
      "value": 0,
      "text": "Choose one eligible group. Counts as one company. Reassign free on your turn. Cannot be banked. No payment value.",
      "detail": "A complete portfolio needs a named Company. Cannot pay debts or generate revenue alone. Needs another Company or Pivot alongside it.",
      "groups": [
        "brown",
        "lblue",
        "pink",
        "orange",
        "red",
        "yellow",
        "green",
        "dblue",
        "black",
        "grey"
      ]
    },
    {
      "id": "W11",
      "kind": "wild",
      "title": "Conglomerate",
      "value": 0,
      "text": "Choose one eligible group. Counts as one company. Reassign free on your turn. Cannot be banked. No payment value.",
      "detail": "A complete portfolio needs a named Company. Cannot pay debts or generate revenue alone. Needs another Company or Pivot alongside it.",
      "groups": [
        "brown",
        "lblue",
        "pink",
        "orange",
        "red",
        "yellow",
        "green",
        "dblue",
        "black",
        "grey"
      ]
    },
    {
      "id": "A01",
      "kind": "action",
      "title": "Pitch Deck",
      "value": 1,
      "text": "Draw two cards. Uses one play; grants no extra plays.",
      "detail": "Newly drawn cards may be played if plays remain.",
      "effect": "pitch"
    },
    {
      "id": "A02",
      "kind": "action",
      "title": "Pitch Deck",
      "value": 1,
      "text": "Draw two cards. Uses one play; grants no extra plays.",
      "detail": "Newly drawn cards may be played if plays remain.",
      "effect": "pitch"
    },
    {
      "id": "A03",
      "kind": "action",
      "title": "Pitch Deck",
      "value": 1,
      "text": "Draw two cards. Uses one play; grants no extra plays.",
      "detail": "Newly drawn cards may be played if plays remain.",
      "effect": "pitch"
    },
    {
      "id": "A04",
      "kind": "action",
      "title": "Pitch Deck",
      "value": 1,
      "text": "Draw two cards. Uses one play; grants no extra plays.",
      "detail": "Newly drawn cards may be played if plays remain.",
      "effect": "pitch"
    },
    {
      "id": "A05",
      "kind": "action",
      "title": "Pitch Deck",
      "value": 1,
      "text": "Draw two cards. Uses one play; grants no extra plays.",
      "detail": "Newly drawn cards may be played if plays remain.",
      "effect": "pitch"
    },
    {
      "id": "A06",
      "kind": "action",
      "title": "Pitch Deck",
      "value": 1,
      "text": "Draw two cards. Uses one play; grants no extra plays.",
      "detail": "Newly drawn cards may be played if plays remain.",
      "effect": "pitch"
    },
    {
      "id": "A07",
      "kind": "action",
      "title": "Pitch Deck",
      "value": 1,
      "text": "Draw two cards. Uses one play; grants no extra plays.",
      "detail": "Newly drawn cards may be played if plays remain.",
      "effect": "pitch"
    },
    {
      "id": "A08",
      "kind": "action",
      "title": "Pitch Deck",
      "value": 1,
      "text": "Draw two cards. Uses one play; grants no extra plays.",
      "detail": "Newly drawn cards may be played if plays remain.",
      "effect": "pitch"
    },
    {
      "id": "A09",
      "kind": "action",
      "title": "Pitch Deck",
      "value": 1,
      "text": "Draw two cards. Uses one play; grants no extra plays.",
      "detail": "Newly drawn cards may be played if plays remain.",
      "effect": "pitch"
    },
    {
      "id": "A10",
      "kind": "action",
      "title": "Pitch Deck",
      "value": 1,
      "text": "Draw two cards. Uses one play; grants no extra plays.",
      "detail": "Newly drawn cards may be played if plays remain.",
      "effect": "pitch"
    },
    {
      "id": "A11",
      "kind": "action",
      "title": "Stealth Buyout",
      "value": 3,
      "text": "Take one Company or wild from an opponent’s incomplete portfolio.",
      "detail": "Cannot take from a complete portfolio, Treasury or hand. Target chooses no substitute. Legal Team may cancel.",
      "effect": "steal"
    },
    {
      "id": "A12",
      "kind": "action",
      "title": "Stealth Buyout",
      "value": 3,
      "text": "Take one Company or wild from an opponent’s incomplete portfolio.",
      "detail": "Cannot take from a complete portfolio, Treasury or hand. Target chooses no substitute. Legal Team may cancel.",
      "effect": "steal"
    },
    {
      "id": "A13",
      "kind": "action",
      "title": "Stealth Buyout",
      "value": 3,
      "text": "Take one Company or wild from an opponent’s incomplete portfolio.",
      "detail": "Cannot take from a complete portfolio, Treasury or hand. Target chooses no substitute. Legal Team may cancel.",
      "effect": "steal"
    },
    {
      "id": "A14",
      "kind": "action",
      "title": "Asset Swap",
      "value": 3,
      "text": "Swap one of your played Companies or wilds for one in an opponent’s incomplete portfolio.",
      "detail": "Choose both. Your card may come from a complete portfolio. Values need not match. Neither comes from a hand. A cancelled swap exchanges neither.",
      "effect": "swap"
    },
    {
      "id": "A15",
      "kind": "action",
      "title": "Asset Swap",
      "value": 3,
      "text": "Swap one of your played Companies or wilds for one in an opponent’s incomplete portfolio.",
      "detail": "Choose both. Your card may come from a complete portfolio. Values need not match. Neither comes from a hand. A cancelled swap exchanges neither.",
      "effect": "swap"
    },
    {
      "id": "A16",
      "kind": "action",
      "title": "Asset Swap",
      "value": 3,
      "text": "Swap one of your played Companies or wilds for one in an opponent’s incomplete portfolio.",
      "detail": "Choose both. Your card may come from a complete portfolio. Values need not match. Neither comes from a hand. A cancelled swap exchanges neither.",
      "effect": "swap"
    },
    {
      "id": "A17",
      "kind": "action",
      "title": "Hostile Takeover",
      "value": 5,
      "text": "Take one opponent’s complete portfolio, including its wilds and upgrades.",
      "detail": "Cannot take an incomplete portfolio, Treasury money or hand cards. Legal Team may cancel.",
      "effect": "takeover"
    },
    {
      "id": "A18",
      "kind": "action",
      "title": "Hostile Takeover",
      "value": 5,
      "text": "Take one opponent’s complete portfolio, including its wilds and upgrades.",
      "detail": "Cannot take an incomplete portfolio, Treasury money or hand cards. Legal Team may cancel.",
      "effect": "takeover"
    },
    {
      "id": "A19",
      "kind": "action",
      "title": "Legal Team",
      "value": 4,
      "text": "Cancel an action against you. Free reaction; may counter Legal Team.",
      "detail": "Only from your hand. Protects only you, including the whole boosted demand. Attacker and defender alternate counters. Never costs a play, even on your turn; banking it does.",
      "effect": "legal"
    },
    {
      "id": "A20",
      "kind": "action",
      "title": "Legal Team",
      "value": 4,
      "text": "Cancel an action against you. Free reaction; may counter Legal Team.",
      "detail": "Only from your hand. Protects only you, including the whole boosted demand. Attacker and defender alternate counters. Never costs a play, even on your turn; banking it does.",
      "effect": "legal"
    },
    {
      "id": "A21",
      "kind": "action",
      "title": "Legal Team",
      "value": 4,
      "text": "Cancel an action against you. Free reaction; may counter Legal Team.",
      "detail": "Only from your hand. Protects only you, including the whole boosted demand. Attacker and defender alternate counters. Never costs a play, even on your turn; banking it does.",
      "effect": "legal"
    },
    {
      "id": "A22",
      "kind": "action",
      "title": "Invoice Due",
      "value": 3,
      "text": "Choose one opponent. They owe you 5M and choose how to pay.",
      "detail": "The demand is 5M; the Treasury value is 3M. Legal Team may cancel.",
      "effect": "invoice"
    },
    {
      "id": "A23",
      "kind": "action",
      "title": "Invoice Due",
      "value": 3,
      "text": "Choose one opponent. They owe you 5M and choose how to pay.",
      "detail": "The demand is 5M; the Treasury value is 3M. Legal Team may cancel.",
      "effect": "invoice"
    },
    {
      "id": "A24",
      "kind": "action",
      "title": "Invoice Due",
      "value": 3,
      "text": "Choose one opponent. They owe you 5M and choose how to pay.",
      "detail": "The demand is 5M; the Treasury value is 3M. Legal Team may cancel.",
      "effect": "invoice"
    },
    {
      "id": "A25",
      "kind": "action",
      "title": "Funding Party",
      "value": 2,
      "text": "Each opponent owes you 2M. Each chooses how to pay.",
      "detail": "With two players collect 2M from the sole opponent. Each may defend separately with Legal Team. The Treasury pays no gift.",
      "effect": "party"
    },
    {
      "id": "A26",
      "kind": "action",
      "title": "Funding Party",
      "value": 2,
      "text": "Each opponent owes you 2M. Each chooses how to pay.",
      "detail": "With two players collect 2M from the sole opponent. Each may defend separately with Legal Team. The Treasury pays no gift.",
      "effect": "party"
    },
    {
      "id": "A27",
      "kind": "action",
      "title": "Funding Party",
      "value": 2,
      "text": "Each opponent owes you 2M. Each chooses how to pay.",
      "detail": "With two players collect 2M from the sole opponent. Each may defend separately with Legal Team. The Treasury pays no gift.",
      "effect": "party"
    },
    {
      "id": "A28",
      "kind": "action",
      "title": "Hype Cycle",
      "value": 1,
      "text": "Play with a Revenue Call. Double its total demand. Costs one additional play.",
      "detail": "One Hype doubles; two quadruple and use all three plays with the Revenue Call. Cannot boost Invoice Due or Funding Party.",
      "effect": "hype"
    },
    {
      "id": "A29",
      "kind": "action",
      "title": "Hype Cycle",
      "value": 1,
      "text": "Play with a Revenue Call. Double its total demand. Costs one additional play.",
      "detail": "One Hype doubles; two quadruple and use all three plays with the Revenue Call. Cannot boost Invoice Due or Funding Party.",
      "effect": "hype"
    },
    {
      "id": "A30",
      "kind": "action",
      "title": "Growth Round",
      "value": 3,
      "text": "Attach to a complete coloured portfolio: +3M revenue. One per portfolio.",
      "detail": "Cannot attach to Logistics or Utilities. It is not a company. Discard if its portfolio becomes incomplete.",
      "effect": "growth"
    },
    {
      "id": "A31",
      "kind": "action",
      "title": "Growth Round",
      "value": 3,
      "text": "Attach to a complete coloured portfolio: +3M revenue. One per portfolio.",
      "detail": "Cannot attach to Logistics or Utilities. It is not a company. Discard if its portfolio becomes incomplete.",
      "effect": "growth"
    },
    {
      "id": "A32",
      "kind": "action",
      "title": "Growth Round",
      "value": 3,
      "text": "Attach to a complete coloured portfolio: +3M revenue. One per portfolio.",
      "detail": "Cannot attach to Logistics or Utilities. It is not a company. Discard if its portfolio becomes incomplete.",
      "effect": "growth"
    },
    {
      "id": "A33",
      "kind": "action",
      "title": "IPO Launch",
      "value": 4,
      "text": "Attach to a complete coloured portfolio with Growth Round: another +4M revenue.",
      "detail": "Keep Growth Round. One IPO Launch per portfolio. Cannot attach to Logistics or Utilities. Discard if incomplete or unsupported. Optional for victory.",
      "effect": "ipo"
    },
    {
      "id": "A34",
      "kind": "action",
      "title": "IPO Launch",
      "value": 4,
      "text": "Attach to a complete coloured portfolio with Growth Round: another +4M revenue.",
      "detail": "Keep Growth Round. One IPO Launch per portfolio. Cannot attach to Logistics or Utilities. Discard if incomplete or unsupported. Optional for victory.",
      "effect": "ipo"
    },
    {
      "id": "R01",
      "kind": "revenue",
      "title": "Brown / Light blue Revenue Call",
      "value": 1,
      "text": "Choose one portfolio in either printed group. Every opponent owes its total revenue.",
      "detail": "Demand = (ladder revenue + attached Growth Round 3M + attached IPO Launch 4M) × Hype multiplier. Use one portfolio, not every portfolio of that colour.",
      "groups": [
        "brown",
        "lblue"
      ]
    },
    {
      "id": "R02",
      "kind": "revenue",
      "title": "Brown / Light blue Revenue Call",
      "value": 1,
      "text": "Choose one portfolio in either printed group. Every opponent owes its total revenue.",
      "detail": "Demand = (ladder revenue + attached Growth Round 3M + attached IPO Launch 4M) × Hype multiplier. Use one portfolio, not every portfolio of that colour.",
      "groups": [
        "brown",
        "lblue"
      ]
    },
    {
      "id": "R03",
      "kind": "revenue",
      "title": "Pink / Orange Revenue Call",
      "value": 1,
      "text": "Choose one portfolio in either printed group. Every opponent owes its total revenue.",
      "detail": "Demand = (ladder revenue + attached Growth Round 3M + attached IPO Launch 4M) × Hype multiplier. Use one portfolio, not every portfolio of that colour.",
      "groups": [
        "pink",
        "orange"
      ]
    },
    {
      "id": "R04",
      "kind": "revenue",
      "title": "Pink / Orange Revenue Call",
      "value": 1,
      "text": "Choose one portfolio in either printed group. Every opponent owes its total revenue.",
      "detail": "Demand = (ladder revenue + attached Growth Round 3M + attached IPO Launch 4M) × Hype multiplier. Use one portfolio, not every portfolio of that colour.",
      "groups": [
        "pink",
        "orange"
      ]
    },
    {
      "id": "R05",
      "kind": "revenue",
      "title": "Red / Yellow Revenue Call",
      "value": 1,
      "text": "Choose one portfolio in either printed group. Every opponent owes its total revenue.",
      "detail": "Demand = (ladder revenue + attached Growth Round 3M + attached IPO Launch 4M) × Hype multiplier. Use one portfolio, not every portfolio of that colour.",
      "groups": [
        "red",
        "yellow"
      ]
    },
    {
      "id": "R06",
      "kind": "revenue",
      "title": "Red / Yellow Revenue Call",
      "value": 1,
      "text": "Choose one portfolio in either printed group. Every opponent owes its total revenue.",
      "detail": "Demand = (ladder revenue + attached Growth Round 3M + attached IPO Launch 4M) × Hype multiplier. Use one portfolio, not every portfolio of that colour.",
      "groups": [
        "red",
        "yellow"
      ]
    },
    {
      "id": "R07",
      "kind": "revenue",
      "title": "Dark blue / Green Revenue Call",
      "value": 1,
      "text": "Choose one portfolio in either printed group. Every opponent owes its total revenue.",
      "detail": "Demand = (ladder revenue + attached Growth Round 3M + attached IPO Launch 4M) × Hype multiplier. Use one portfolio, not every portfolio of that colour.",
      "groups": [
        "dblue",
        "green"
      ]
    },
    {
      "id": "R08",
      "kind": "revenue",
      "title": "Dark blue / Green Revenue Call",
      "value": 1,
      "text": "Choose one portfolio in either printed group. Every opponent owes its total revenue.",
      "detail": "Demand = (ladder revenue + attached Growth Round 3M + attached IPO Launch 4M) × Hype multiplier. Use one portfolio, not every portfolio of that colour.",
      "groups": [
        "dblue",
        "green"
      ]
    },
    {
      "id": "R09",
      "kind": "revenue",
      "title": "Logistics / Utilities Revenue Call",
      "value": 1,
      "text": "Choose one portfolio in either printed group. Every opponent owes its total revenue.",
      "detail": "Demand = (ladder revenue + attached Growth Round 3M + attached IPO Launch 4M) × Hype multiplier. Use one portfolio, not every portfolio of that colour.",
      "groups": [
        "black",
        "grey"
      ]
    },
    {
      "id": "R10",
      "kind": "revenue",
      "title": "Logistics / Utilities Revenue Call",
      "value": 1,
      "text": "Choose one portfolio in either printed group. Every opponent owes its total revenue.",
      "detail": "Demand = (ladder revenue + attached Growth Round 3M + attached IPO Launch 4M) × Hype multiplier. Use one portfolio, not every portfolio of that colour.",
      "groups": [
        "black",
        "grey"
      ]
    },
    {
      "id": "R11",
      "kind": "revenue",
      "title": "Marketwide Revenue",
      "value": 3,
      "text": "Choose one of your portfolios in any group and one opponent. They owe its total revenue.",
      "detail": "Marketwide means any group, not all opponents. Include attached upgrades and Hype multipliers.",
      "groups": [
        "brown",
        "lblue",
        "pink",
        "orange",
        "red",
        "yellow",
        "green",
        "dblue",
        "black",
        "grey"
      ],
      "single": true
    },
    {
      "id": "R12",
      "kind": "revenue",
      "title": "Marketwide Revenue",
      "value": 3,
      "text": "Choose one of your portfolios in any group and one opponent. They owe its total revenue.",
      "detail": "Marketwide means any group, not all opponents. Include attached upgrades and Hype multipliers.",
      "groups": [
        "brown",
        "lblue",
        "pink",
        "orange",
        "red",
        "yellow",
        "green",
        "dblue",
        "black",
        "grey"
      ],
      "single": true
    },
    {
      "id": "R13",
      "kind": "revenue",
      "title": "Marketwide Revenue",
      "value": 3,
      "text": "Choose one of your portfolios in any group and one opponent. They owe its total revenue.",
      "detail": "Marketwide means any group, not all opponents. Include attached upgrades and Hype multipliers.",
      "groups": [
        "brown",
        "lblue",
        "pink",
        "orange",
        "red",
        "yellow",
        "green",
        "dblue",
        "black",
        "grey"
      ],
      "single": true
    },
    {
      "id": "F01",
      "kind": "funding",
      "title": "Seed Cheque",
      "value": 1,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F02",
      "kind": "funding",
      "title": "Seed Cheque",
      "value": 1,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F03",
      "kind": "funding",
      "title": "Seed Cheque",
      "value": 1,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F04",
      "kind": "funding",
      "title": "Seed Cheque",
      "value": 1,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F05",
      "kind": "funding",
      "title": "Seed Cheque",
      "value": 1,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F06",
      "kind": "funding",
      "title": "Seed Cheque",
      "value": 1,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F07",
      "kind": "funding",
      "title": "Angel Cheque",
      "value": 2,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F08",
      "kind": "funding",
      "title": "Angel Cheque",
      "value": 2,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F09",
      "kind": "funding",
      "title": "Angel Cheque",
      "value": 2,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F10",
      "kind": "funding",
      "title": "Angel Cheque",
      "value": 2,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F11",
      "kind": "funding",
      "title": "Angel Cheque",
      "value": 2,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F12",
      "kind": "funding",
      "title": "Series A Cheque",
      "value": 3,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F13",
      "kind": "funding",
      "title": "Series A Cheque",
      "value": 3,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F14",
      "kind": "funding",
      "title": "Series A Cheque",
      "value": 3,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F15",
      "kind": "funding",
      "title": "Series B Cheque",
      "value": 4,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F16",
      "kind": "funding",
      "title": "Series B Cheque",
      "value": 4,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F17",
      "kind": "funding",
      "title": "Series B Cheque",
      "value": 4,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F18",
      "kind": "funding",
      "title": "Mega Round Cheque",
      "value": 5,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F19",
      "kind": "funding",
      "title": "Mega Round Cheque",
      "value": 5,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "F20",
      "kind": "funding",
      "title": "Whale Cheque",
      "value": 10,
      "text": "Place in your Treasury. Use to pay opponents.",
      "detail": "Money only. Series A and Series B do not trigger extra rounds or upgrades."
    },
    {
      "id": "Q01",
      "kind": "reference",
      "title": "Your turn",
      "value": 0,
      "text": "Draw two, or five if your hand started empty. Play up to three. Rearranging played cards is free on your turn. Discard down to seven. Legal Team reactions are free.",
      "detail": "Draw two, or five if your hand started empty. Play up to three. Rearranging played cards is free on your turn. Discard down to seven. Legal Team reactions are free."
    },
    {
      "id": "Q02",
      "kind": "reference",
      "title": "Payments",
      "value": 0,
      "text": "Pay from Treasury and/or played assets. You choose. Never from your hand. No change. Pay what you can. Conglomerates cannot pay. Incoming money goes to Treasury; companies go to portfolios.",
      "detail": "Pay from Treasury and/or played assets. You choose. Never from your hand. No change. Pay what you can. Conglomerates cannot pay. Incoming money goes to Treasury; companies go to portfolios."
    },
    {
      "id": "Q03",
      "kind": "reference",
      "title": "Deals",
      "value": 0,
      "text": "Stealth Buyout and Asset Swap take only from incomplete portfolios. Hostile Takeover takes a complete portfolio and upgrades. Legal Team protects only its user and may be countered.",
      "detail": "Stealth Buyout and Asset Swap take only from incomplete portfolios. Hostile Takeover takes a complete portfolio and upgrades. Legal Team protects only its user and may be countered."
    },
    {
      "id": "Q04",
      "kind": "reference",
      "title": "Victory",
      "value": 0,
      "text": "Three complete portfolios in different groups win. Each needs a named Company. Logistics and Utilities count. Upgrades are optional. Cash and hand cards never complete portfolios.",
      "detail": "Three complete portfolios in different groups win. Each needs a named Company. Logistics and Utilities count. Upgrades are optional. Cash and hand cards never complete portfolios."
    }
  ],
  "rules": [
    [
      "Setup",
      "Two players in this app (the source supports 2–5). Remove the four Reference cards. Shuffle 106 playable cards and deal five each. Empty Treasuries and collections. In this app, best-of-three rock, paper, scissors decides who starts (user override); continue clockwise."
    ],
    [
      "Draw and finish",
      "Draw two at the start of each turn, or five if your hand started empty. Up to three plays in any order, including zero. Finish by choosing excess cards to discard down to seven; no free discarding at seven or fewer. Reshuffle discards when needed. If both shared piles are empty, draw what is available and continue. If everyone is stuck, agree to redeal."
    ],
    [
      "Portfolios",
      "Named Companies, Pivots and Conglomerates each occupy one place. Never exceed the printed size. Every complete portfolio needs at least one named Company. Matching named Companies go together until the first portfolio fills; extras start another. Several portfolios of one group count once for victory. A Conglomerate alone earns no revenue; another Company or Pivot must accompany it."
    ],
    [
      "Three plays",
      "Bank one Funding or action card; lay one Company or wild; play one action or Revenue Call; attach one upgrade. Each uses one play. Revenue Calls plus one or two Hype Cycles use two or three plays. Reactions, payments, receiving assets and moving already played cards cost no plays."
    ],
    [
      "Revenue",
      "Revenue is collected only through a Revenue Call. Choose one portfolio. Read the ladder once; do not multiply by the company count. Add attached Growth Round (+3M) and IPO Launch (+4M), then multiply by 1, 2 or 4 for zero, one or two Hype Cycles. Paired calls charge every opponent; Marketwide Revenue charges one chosen opponent."
    ],
    [
      "Payments",
      "Payer chooses Treasury cards, played Companies, Pivots or attached upgrades. Never hand cards or Conglomerates. Use printed payment values. No change. Stop as soon as selected cards cover the demand; no unnecessary extra cards. If assets cannot cover it, surrender all payable assets; remainder disappears. You may choose a company even when you have cash."
    ],
    [
      "Receiving",
      "Funding and banked actions remain Treasury money forever. Paid upgrades enter the recipient’s Treasury permanently. Companies stay in the company collection. The recipient chooses the eligible group of incoming wilds, even outside their turn, without moving their other cards."
    ],
    [
      "Legal Team",
      "Resolve responses before transfers. Affected player may cancel with Legal Team from hand; attacker may counter, defender may counter again. Each is discarded. Passing ends that chain and resolves its parity. Reactions are free even after play three. Triggering action and attached Hype are spent even if cancelled. A block protects only that opponent; others still owe their demand."
    ],
    [
      "Rearranging and upgrades",
      "On your turn, move played Companies between valid portfolios and reassign wilds free. Move an attached upgrade to another eligible complete portfolio free; move Growth Round and its IPO Launch together to keep support. No duplicates, no upgrades on Logistics or Utilities. An incomplete portfolio immediately discards its upgrades; an unsupported IPO Launch is discarded. Replace a wild with a named Company atomically to keep upgrades. Played cards never return to hand."
    ],
    [
      "Victory",
      "After an action or payment and responses finish, three complete portfolios in different groups win immediately, including outside your turn. Each needs a named Company. Logistics and Utilities count. A swap completing both players’ third groups is won by the active player."
    ],
    [
      "Source and prototype",
      "Source: IPOs version 1, 27 October 2026; title renamed STONKS by request. Inventory is consistent: 28 Companies + 11 wilds + 34 actions + 13 Revenue Calls + 20 Funding + 4 References = 110; Funding totals 57M. No conflicting rules found. User override: this app is for two players; best-of-three rock, paper, scissors decides the starter instead of age. The shelf game uses the existing two-phone Firebase rooms. Only your own hand is shown, but shared match data is inspectable in developer tools, as in Battleships. Server-enforced private hands need authentication and an authoritative server. An optional local room hides hands at handoffs."
    ]
  ]
};
