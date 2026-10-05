/* Cards: deck creation, shuffling, labels. Works in the browser and in Node. */
(function (root) {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const RANK_LABEL = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  function makeCard(rank, suit) {
    return { rank, suit, id: RANK_LABEL[rank] + suit, value: Math.min(rank, 10) };
  }

  function newDeck() {
    const deck = [];
    for (const s of SUITS) for (let r = 1; r <= 13; r++) deck.push(makeCard(r, s));
    return deck;
  }

  function randomInt(n) {
    const c = root.crypto;
    if (c && c.getRandomValues) {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function cardLabel(c) {
    return RANK_LABEL[c.rank] + SUIT_SYMBOL[c.suit];
  }

  function isRed(c) {
    return c.suit === 'H' || c.suit === 'D';
  }

  function sortCards(cards) {
    return cards.slice().sort((a, b) => a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
  }

  /** "5H", "10S", "JD" -> card (for tests) */
  function parseCard(s) {
    const suit = s.slice(-1).toUpperCase();
    const r = s.slice(0, -1).toUpperCase();
    const rank = RANK_LABEL.indexOf(r);
    if (rank < 1 || !SUITS.includes(suit)) throw new Error('Bad card ' + s);
    return makeCard(rank, suit);
  }

  const api = { SUITS, SUIT_SYMBOL, SUIT_NAME, RANK_LABEL, makeCard, newDeck, randomInt, shuffle, cardLabel, isRed, sortCards, parseCard };
  root.CribCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
