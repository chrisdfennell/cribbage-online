/* Computer opponent: discard selection and pegging play. */
(function (root) {
  'use strict';

  const req = typeof require !== 'undefined' ? require : null;
  const Cards = root.CribCards || (req && req('./cards.js'));
  const Scoring = root.CribScoring || (req && req('./scoring.js'));

  function sampleDistinct(pool, k, rng) {
    const taken = new Set();
    const out = [];
    while (out.length < k) {
      const i = Math.floor(rng() * pool.length);
      if (!taken.has(i)) { taken.add(i); out.push(pool[i]); }
    }
    return out;
  }

  /**
   * Choose which k cards to lay away into the crib.
   * Expert: exact expected hand value over every possible starter, plus a Monte Carlo
   * estimate of the crib (added if the crib belongs to our side, subtracted otherwise).
   */
  function chooseDiscard(hand, k, ownCrib, difficulty = 'expert', rng = Math.random) {
    const ids = new Set(hand.map((c) => c.id));
    const unknown = Cards.newDeck().filter((c) => !ids.has(c.id));
    const fill = 4 - k; // crib cards that will come from elsewhere
    let best = null;
    let bestVal = -Infinity;

    for (const toss of Scoring.subsets(hand, k)) {
      const keep = hand.filter((c) => !toss.includes(c));
      let handTotal = 0;
      for (const st of unknown) handTotal += Scoring.scoreHand(keep, st, false).total;
      let val = handTotal / unknown.length;

      if (difficulty === 'expert') {
        const N = 140;
        let crib = 0;
        for (let s = 0; s < N; s++) {
          const picks = sampleDistinct(unknown, fill + 1, rng);
          crib += Scoring.scoreHand(toss.concat(picks.slice(1)), picks[0], true).total;
        }
        val += (ownCrib ? 1 : -1) * (crib / N);
      } else {
        val += (rng() - 0.5) * 4;
      }
      if (val > bestVal) { bestVal = val; best = toss; }
    }
    return best;
  }

  /**
   * Choose a card to play. Only cards keeping the count at or under 31 are legal.
   * Expert: immediate points minus the expected points the next player can score in reply.
   */
  function choosePlay(pegHand, seq, count, unknown, difficulty = 'expert', rng = Math.random) {
    const playable = pegHand.filter((c) => c.value + count <= 31);
    if (playable.length <= 1) return playable[0] || null;

    const rankCount = new Array(14).fill(0);
    unknown.forEach((c) => rankCount[c.rank]++);
    const total = unknown.length || 1;

    let best = null;
    let bestVal = -Infinity;
    for (const c of playable) {
      const nseq = seq.concat([c]);
      const ncount = count + c.value;
      let val = Scoring.scorePegging(nseq).total;

      if (difficulty === 'expert') {
        if (ncount < 31) {
          let risk = 0;
          for (let r = 1; r <= 13; r++) {
            if (!rankCount[r]) continue;
            const v = Math.min(r, 10);
            if (ncount + v > 31) continue;
            risk += (rankCount[r] / total) * Scoring.scorePegging(nseq.concat([{ rank: r, value: v, suit: '?' }])).total;
          }
          val -= risk;
          // Hold low cards for late "go" situations; shed high cards while it's safe.
          val += c.value * 0.04;
          // Leading: cards under 5 can't be made into fifteen.
          if (count === 0 && c.value < 5) val += 0.25;
        }
      } else {
        val += rng() * 1.8;
      }
      if (val > bestVal) { bestVal = val; best = c; }
    }
    return best;
  }

  const api = { chooseDiscard, choosePlay };
  root.CribAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
