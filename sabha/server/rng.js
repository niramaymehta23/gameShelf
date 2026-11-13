'use strict';
// Seeded randomness. Every random thing in a round comes from a generator made from the round's seed,
// so both teams can be given identical generators (same content, same difficulty curve).

function hash32(str) {
  // FNV-1a, then a final avalanche so similar labels give unrelated seeds
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

// rng(seed, label?) → generator. Same (seed, label) → same sequence, always.
function rng(seed, label = '') {
  let a = hash32(String(seed) + '|' + label) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    // integer in [lo, hi] inclusive
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle(arr) {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; }
      return a2;
    },
    // a child generator, independent of how much this one has been used
    fork: (sub) => rng(seed, label + '/' + sub),
  };
  return r;
}

function newSeed() { return Math.floor(Math.random() * 2 ** 31).toString(36) + Date.now().toString(36).slice(-4); }

module.exports = { rng, hash32, newSeed };
