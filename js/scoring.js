/* Cribbage scoring: the show (hands & crib) and the play (pegging). Pure functions. */
(function (root) {
  'use strict';

  const RANK_LABEL = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const value = (c) => Math.min(c.rank, 10);
  const label = (c) => RANK_LABEL[c.rank] + (SUIT_SYMBOL[c.suit] || '');

  const PAIR_NAMES = { 2: 'Pair', 3: 'Pair royal', 4: 'Double pair royal' };

  function subsets(cards, k) {
    const out = [];
    (function rec(start, combo) {
      if (combo.length === k) { out.push(combo.slice()); return; }
      for (let i = start; i < cards.length; i++) { combo.push(cards[i]); rec(i + 1, combo); combo.pop(); }
    })(0, []);
    return out;
  }

  /** True if the cards are distinct, consecutive ranks (any order). Aces are low only. */
  function isRun(cards) {
    const r = cards.map((c) => c.rank).sort((a, b) => a - b);
    for (let i = 1; i < r.length; i++) if (r[i] !== r[i - 1] + 1) return false;
    return true;
  }

  /**
   * Score a 4-card hand (or crib) with the starter.
   * Returns { total, items: [{ type, label, points, cards }] }.
   */
  function scoreHand(hand, starter, isCrib = false) {
    const all = starter ? hand.concat([starter]) : hand.slice();
    const items = [];

    // Fifteens: every distinct combination totalling 15 scores 2.
    for (let k = 2; k <= all.length; k++) {
      for (const s of subsets(all, k)) {
        if (s.reduce((t, c) => t + value(c), 0) === 15) items.push({ type: 'fifteen', label: 'Fifteen', points: 2, cards: s });
      }
    }

    // Pairs: 2 per pair, so 3 of a kind = 6, 4 of a kind = 12. Ranks must match (J and K are not a pair).
    const byRank = {};
    all.forEach((c) => (byRank[c.rank] = byRank[c.rank] || []).push(c));
    Object.keys(byRank).sort((a, b) => a - b).forEach((r) => {
      const g = byRank[r];
      if (g.length >= 2) items.push({ type: 'pairs', label: PAIR_NAMES[g.length], points: g.length * (g.length - 1), cards: g });
    });

    // Runs: only the longest length counts; each distinct run of that length scores (double/triple runs).
    for (let L = all.length; L >= 3; L--) {
      const runs = subsets(all, L).filter(isRun);
      if (runs.length) {
        runs.forEach((r) => items.push({ type: 'run', label: `Run of ${L}`, points: L, cards: r.slice().sort((a, b) => a.rank - b.rank) }));
        break;
      }
    }

    // Flush: 4 in the hand (not allowed in the crib), 5 if the starter matches too.
    if (hand.length === 4) {
      const suit = hand[0].suit;
      if (hand.every((c) => c.suit === suit)) {
        if (starter && starter.suit === suit) items.push({ type: 'flush', label: 'Five-card flush', points: 5, cards: all });
        else if (!isCrib) items.push({ type: 'flush', label: 'Four-card flush', points: 4, cards: hand.slice() });
      }
    }

    // His nobs: jack in hand of the same suit as the starter.
    if (starter) {
      const j = hand.find((c) => c.rank === 11 && c.suit === starter.suit);
      if (j) items.push({ type: 'nobs', label: 'His nobs', points: 1, cards: [j] });
    }

    return { items, total: items.reduce((t, i) => t + i.points, 0) };
  }

  /**
   * Score the card just played during the play.
   * seq = cards played since the count last reset, including the one just played (last).
   */
  function scorePegging(seq) {
    const items = [];
    const count = seq.reduce((t, c) => t + value(c), 0);
    const last = seq[seq.length - 1];
    if (count === 15) items.push({ label: 'Fifteen', points: 2 });
    if (count === 31) items.push({ label: 'Thirty-one', points: 2 });

    let same = 1;
    for (let i = seq.length - 2; i >= 0 && seq[i].rank === last.rank; i--) same++;
    if (same >= 2) items.push({ label: PAIR_NAMES[same], points: same * (same - 1) });

    for (let L = seq.length; L >= 3; L--) {
      if (isRun(seq.slice(-L))) { items.push({ label: `Run of ${L}`, points: L }); break; }
    }
    return { items, count, total: items.reduce((t, i) => t + i.points, 0) };
  }

  /** "fifteen 6, pair 2, run of 3 ×2 = 6" style summary */
  function summarize(items) {
    const groups = [];
    const order = ['fifteen', 'pairs', 'run', 'flush', 'nobs'];
    for (const type of order) {
      const g = items.filter((i) => i.type === type);
      if (!g.length) continue;
      const pts = g.reduce((t, i) => t + i.points, 0);
      if (type === 'fifteen') groups.push(`fifteen ${pts}`);
      else if (type === 'pairs') groups.push(g.map((i) => `${i.label.toLowerCase()} ${i.points}`).join(', '));
      else if (type === 'run') groups.push(g.length > 1 ? `${g.length} runs of ${g[0].points} = ${pts}` : `${g[0].label.toLowerCase()} ${pts}`);
      else groups.push(`${g[0].label.toLowerCase()} ${pts}`);
    }
    return groups.join(', ');
  }

  const api = { value, label, isRun, subsets, scoreHand, scorePegging, summarize };
  root.CribScoring = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
