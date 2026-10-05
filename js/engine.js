/*
 * Authoritative cribbage engine. Runs on the host only. No DOM access.
 * Human decisions are requested with ask(); answers arrive through submit(seat, answer)
 * (from the local UI or from a remote player over the network) and are validated here.
 * view(seat) returns what that seat is allowed to see.
 */
(function (root) {
  'use strict';

  const Cards = root.CribCards;
  const Scoring = root.CribScoring;
  const AI = root.CribAI;

  const TEAM_COLORS = ['#e5484d', '#3e7bfa', '#2fb36b'];
  const SPEED_MS = { slow: 1400, normal: 850, fast: 350, instant: 0 };
  const PRIVATE_PROMPTS = new Set(['discard', 'play', 'go']);
  const WIN = 121;

  class GameOver extends Error {}
  class Aborted extends Error {}

  class Game {
    /**
     * settings: { seats: [{ name, kind: 'local'|'remote'|'ai' }], difficulty, speed,
     *             manualCount, muggins, firstDealer }
     */
    constructor(settings, onChange) {
      this.settings = settings;
      this.onChange = onChange || (() => {});
      const n = settings.seats.length;
      if (n < 2 || n > 4) throw new Error('Cribbage needs 2–4 players');
      this.n = n;
      this.players = settings.seats.map((s, i) => ({
        name: s.name, kind: s.kind, connected: true, team: n === 4 ? i % 2 : i,
        hand: [], pegHand: [], played: [], discards: [], status: '', cutCard: null, revealed: false,
      }));
      const T = n === 4 ? 2 : n;
      this.teams = [];
      for (let t = 0; t < T; t++) {
        this.teams.push({
          name: n === 4 ? `${this.players[t].name} & ${this.players[t + 2].name}` : this.players[t].name,
          color: TEAM_COLORS[t], score: 0, pegs: [0, -1],
        });
      }
      this.phase = 'start';
      this.dealer = null;
      this.deck = [];
      this.crib = [];
      this.cribRevealed = false;
      this.starter = null;
      this.peg = { count: 0, seq: [] };
      this.turn = null;
      this.show = null;
      this.log = [];
      this.logId = 0;
      this.pending = new Map();
      this.winner = null;
      this.result = null;
      this.handNo = 0;
      this.aborted = false;
      this.version = 0;
    }

    // ---------------------------------------------------------------- utilities
    changed() { this.version++; this.onChange(); }
    teamOf(seat) { return this.players[seat].team; }
    next(seat, k = 1) { return (seat + k) % this.n; }
    name(seat) { return this.players[seat].name; }
    isHuman(seat) { return this.players[seat].kind !== 'ai'; }

    sleep(ms) {
      return new Promise((resolve, reject) => setTimeout(() => (this.aborted ? reject(new Aborted()) : resolve()), ms));
    }
    pause(mult = 1) { return this.sleep((SPEED_MS[this.settings.speed] ?? 850) * mult); }

    addLog(text, kind = 'info', team = null, pts = 0) {
      this.log.push({ id: ++this.logId, text, kind, team, pts });
      if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    }

    abort() {
      this.aborted = true;
      for (const pr of this.pending.values()) pr.reject(new Aborted());
      this.pending.clear();
    }

    async addPoints(team, pts, reason, seat) {
      if (pts <= 0) return;
      const t = this.teams[team];
      const score = Math.min(WIN, t.score + pts);
      const back = t.pegs[0] <= t.pegs[1] ? 0 : 1; // the back peg leapfrogs the front peg
      t.pegs[back] = score;
      t.score = score;
      const who = seat != null ? this.name(seat) : t.name;
      this.addLog(`${who} +${pts} — ${reason}`, 'score', team, pts);
      this.changed();
      if (score >= WIN) {
        this.winner = team;
        throw new GameOver();
      }
    }

    // ---------------------------------------------------------------- decisions
    ask(seat, type, data = {}) {
      if (this.aborted) return Promise.reject(new Aborted());
      if (!this.isHuman(seat)) return this.aiTurn(seat, type, data);
      return new Promise((resolve, reject) => {
        this.pending.set(seat, { type, data, resolve, reject });
        this.changed();
      });
    }

    async aiTurn(seat, type, data) {
      const p = this.players[seat];
      const prev = p.status;
      p.status = 'thinking…';
      this.changed();
      await this.pause(type === 'discard' ? 0.9 : type === 'go' ? 0.6 : 1);
      p.status = prev === 'thinking…' ? '' : prev;
      return this.aiAnswer(seat, type, data);
    }

    aiAnswer(seat, type, data) {
      const p = this.players[seat];
      const diff = this.settings.difficulty || 'expert';
      switch (type) {
        case 'cutdeal':
        case 'cut': return data.min + Cards.randomInt(data.max - data.min + 1);
        case 'discard': return AI.chooseDiscard(p.hand, data.count, this.teamOf(seat) === this.teamOf(this.dealer), diff);
        case 'play': return AI.choosePlay(p.pegHand, this.peg.seq.map((s) => s.card), this.peg.count, this.unknownFor(seat), diff);
        case 'count': return this.show ? this.show.res.total : 0;
        default: return true;
      }
    }

    /** Called by UI/network. Returns true if the answer was accepted. */
    submit(seat, answer) {
      const pr = this.pending.get(seat);
      if (!pr) return false;
      const v = this.validate(seat, pr, answer);
      if (v === undefined) return false;
      this.pending.delete(seat);
      pr.resolve(v);
      this.changed();
      return true;
    }

    validate(seat, pr, a) {
      const p = this.players[seat];
      switch (pr.type) {
        case 'cutdeal':
        case 'cut': {
          const i = Number(a);
          return Number.isInteger(i) && i >= pr.data.min && i <= pr.data.max ? i : undefined;
        }
        case 'discard': {
          if (!Array.isArray(a) || a.length !== pr.data.count || new Set(a).size !== a.length) return undefined;
          const cards = a.map((id) => p.hand.find((c) => c.id === id));
          return cards.every(Boolean) ? cards : undefined;
        }
        case 'play': {
          const c = p.pegHand.find((x) => x.id === a);
          return c && c.value + this.peg.count <= 31 ? c : undefined;
        }
        case 'count': {
          const k = Number(a);
          return Number.isInteger(k) && k >= 0 && k <= 29 ? k : undefined;
        }
        default: return true; // go, continue
      }
    }

    promptFor(seat) {
      const pr = this.pending.get(seat);
      return pr ? { type: pr.type, data: pr.data } : null;
    }

    /** Hand a human seat to the computer (e.g. a player disconnected). */
    takeOver(seat) {
      const p = this.players[seat];
      p.kind = 'ai';
      p.connected = true;
      this.addLog(`The computer takes over for ${p.name}.`, 'sys');
      const pr = this.pending.get(seat);
      if (pr) {
        this.pending.delete(seat);
        Promise.resolve().then(() => pr.resolve(this.aiAnswer(seat, pr.type, pr.data)));
      }
      this.changed();
    }

    setConnected(seat, connected) {
      const p = this.players[seat];
      if (p.connected === connected) return;
      p.connected = connected;
      this.addLog(`${p.name} ${connected ? 'reconnected' : 'disconnected'}.`, 'sys');
      if (!connected) {
        const pr = this.pending.get(seat);
        if (pr && pr.type === 'continue') { this.pending.delete(seat); pr.resolve(true); }
      }
      this.changed();
    }

    /** Wait until every connected human has pressed Continue (or a short pause if none). */
    async readyAll(mult = 3) {
      const seats = this.players.map((p, i) => i).filter((i) => this.isHuman(i) && this.players[i].connected);
      if (!seats.length) { await this.pause(mult); return; }
      await Promise.all(seats.map((s) => this.ask(s, 'continue')));
    }

    unknownFor(seat) {
      const known = new Set();
      const p = this.players[seat];
      p.hand.forEach((c) => known.add(c.id));
      p.discards.forEach((c) => known.add(c.id));
      this.players.forEach((q) => q.played.forEach((c) => known.add(c.id)));
      if (this.starter) known.add(this.starter.id);
      return Cards.newDeck().filter((c) => !known.has(c.id));
    }

    // ---------------------------------------------------------------- game flow
    async run() {
      try {
        const fd = this.settings.firstDealer;
        if (fd != null && fd >= 0 && fd < this.n) {
          this.dealer = fd;
          this.addLog(`First dealer: ${this.name(fd)} (lost the last game).`, 'sys');
        } else {
          await this.cutForDeal();
        }
        for (;;) {
          await this.playHand();
          this.dealer = this.next(this.dealer);
        }
      } catch (e) {
        if (e instanceof GameOver) this.finish();
        else if (!(e instanceof Aborted)) {
          console.error(e);
          this.addLog('Internal error: ' + e.message, 'sys');
          this.changed();
        }
      }
    }

    finish() {
      this.phase = 'over';
      this.turn = null;
      for (const pr of this.pending.values()) pr.reject(new Aborted());
      this.pending.clear();
      const w = this.teams[this.winner];
      const losers = this.teams.map((t, i) => ({ i, name: t.name, score: t.score })).filter((t) => t.i !== this.winner)
        .map((t) => ({ ...t, skunk: t.score <= 60 ? 'double' : t.score <= 90 ? 'single' : null }));
      this.result = { winner: this.winner, winnerName: w.name, losers };
      this.addLog(`🏆 Game won by ${w.name}!`, 'win', this.winner);
      losers.forEach((l) => {
        if (l.skunk === 'double') this.addLog(`Double skunk: ${l.name} (60 or less).`, 'sys');
        else if (l.skunk === 'single') this.addLog(`Skunk: ${l.name} (90 or less).`, 'sys');
      });
      this.changed();
    }

    async cutForDeal() {
      this.phase = 'cutdeal';
      this.addLog('Cut for deal — the lowest card deals (aces are low).', 'sys');
      let contenders = this.players.map((p, i) => i);
      this.deck = Cards.shuffle(Cards.newDeck());
      for (;;) {
        this.players.forEach((p) => (p.cutCard = null));
        for (const seat of contenders) {
          this.turn = seat;
          const i = await this.ask(seat, 'cutdeal', { min: 4, max: this.deck.length - 5, size: this.deck.length });
          const card = this.deck.splice(i, 1)[0];
          this.players[seat].cutCard = card;
          this.addLog(`${this.name(seat)}: cut ${Cards.cardLabel(card)}`);
          this.changed();
        }
        const low = Math.min(...contenders.map((s) => this.players[s].cutCard.rank));
        const lows = contenders.filter((s) => this.players[s].cutCard.rank === low);
        if (lows.length === 1) { this.dealer = lows[0]; break; }
        this.addLog(`Tie for low card between ${lows.map((s) => this.name(s)).join(' and ')} — cut again.`, 'sys');
        this.changed();
        await this.pause(1.5);
        contenders = lows;
        this.deck = Cards.shuffle(Cards.newDeck());
      }
      this.turn = null;
      this.addLog(`First dealer: ${this.name(this.dealer)}.`, 'sys');
      this.changed();
      await this.pause(2.2);
      this.players.forEach((p) => (p.cutCard = null));
    }

    async playHand() {
      const n = this.n;
      this.handNo++;
      this.phase = 'deal';
      this.crib = [];
      this.cribRevealed = false;
      this.starter = null;
      this.show = null;
      this.peg = { count: 0, seq: [] };
      this.players.forEach((p) => Object.assign(p, { hand: [], pegHand: [], played: [], discards: [], status: '', revealed: false, cutCard: null }));
      this.deck = Cards.shuffle(Cards.newDeck());
      this.addLog(`Hand ${this.handNo} — dealer: ${this.name(this.dealer)}`, 'deal');

      // Deal one at a time, starting on the dealer's left. 2 players: 6 each. 3–4 players: 5 each.
      const per = n === 2 ? 6 : 5;
      for (let r = 0; r < per; r++) {
        for (let k = 1; k <= n; k++) this.players[this.next(this.dealer, k)].hand.push(this.deck.shift());
      }
      if (n === 3) this.crib.push(this.deck.shift()); // 3 players: one card dealt straight to the crib
      this.players.forEach((p) => (p.hand = Cards.sortCards(p.hand)));
      this.changed();
      await this.pause(0.5);

      // Lay away to the crib (all players at once).
      this.phase = 'discard';
      const k = n === 2 ? 2 : 1;
      const order = [];
      for (let i = 1; i <= n; i++) order.push(this.next(this.dealer, i));
      this.turn = null;
      await Promise.all(order.map(async (seat) => {
        const cards = await this.ask(seat, 'discard', { count: k, cribOwner: this.dealer });
        const p = this.players[seat];
        p.hand = p.hand.filter((c) => !cards.includes(c));
        p.discards = cards;
        this.crib.push(...cards);
        this.changed();
      }));
      this.addLog(`Crib laid away (belongs to ${this.name(this.dealer)}).`);

      // Cut for the starter: the player on the dealer's left cuts, at least 4 cards each side.
      this.phase = 'cut';
      const cutter = this.next(this.dealer);
      this.turn = cutter;
      const len = this.deck.length;
      const ci = await this.ask(cutter, 'cut', { min: 4, max: len - 4, size: len });
      this.starter = this.deck[ci];
      this.turn = null;
      this.addLog(`${this.name(cutter)}: cut — starter ${Cards.cardLabel(this.starter)}`);
      this.changed();
      if (this.starter.rank === 11) {
        await this.addPoints(this.teamOf(this.dealer), 2, 'his heels (jack turned up)', this.dealer);
      }
      await this.pause(1);

      await this.thePlay();
      await this.theShow();
    }

    resetCount(msg) {
      this.peg.count = 0;
      this.peg.seq = [];
      this.players.forEach((p) => { if (p.status === 'Go') p.status = ''; });
      if (msg) this.addLog(msg, 'sys');
      this.changed();
    }

    async thePlay() {
      this.phase = 'play';
      const n = this.n;
      this.players.forEach((p) => { p.pegHand = p.hand.slice(); p.played = []; p.status = ''; });
      this.peg = { count: 0, seq: [] };
      let turn = this.next(this.dealer);
      let last = null;   // seat that played the most recent card in this series
      let passes = 0;    // consecutive players unable to play
      this.changed();

      while (this.players.some((p) => p.pegHand.length)) {
        const p = this.players[turn];
        this.turn = turn;
        const playable = p.pegHand.filter((c) => c.value + this.peg.count <= 31);

        if (playable.length) {
          const card = await this.ask(turn, 'play', { playable: playable.map((c) => c.id), count: this.peg.count });
          p.pegHand = p.pegHand.filter((c) => c !== card);
          p.played.push(card);
          this.peg.seq.push({ card, seat: turn });
          this.peg.count += card.value;
          this.addLog(`${p.name}: ${Cards.cardLabel(card)} — count ${this.peg.count}`, 'play', p.team);
          this.changed();
          const res = Scoring.scorePegging(this.peg.seq.map((s) => s.card));
          if (res.total) {
            await this.addPoints(p.team, res.total, res.items.map((i) => `${i.label.toLowerCase()} ${i.points}`).join(', '), turn);
          }
          last = turn;
          passes = 0;
          if (this.peg.count === 31) {
            await this.pause(1);
            this.resetCount('Count resets to 0.');
            last = null;
          }
          turn = this.next(turn);
        } else {
          passes++;
          if (p.pegHand.length && p.status !== 'Go') {
            await this.ask(turn, 'go');
            p.status = 'Go';
            this.addLog(`${p.name}: “Go.”`, 'play', p.team);
            this.changed();
          }
          if (passes >= n) {
            // Nobody can play: the last player to lay a card pegs 1 for the go.
            if (last !== null) await this.addPoints(this.teamOf(last), 1, 'go', last);
            await this.pause(0.8);
            this.resetCount('Count resets to 0.');
            turn = last !== null ? this.next(last) : this.next(turn);
            last = null;
            passes = 0;
          } else {
            turn = this.next(turn);
          }
        }
      }
      // One for last card (unless it made 31, which already scored 2 and reset the count).
      if (last !== null && this.peg.count > 0) {
        await this.addPoints(this.teamOf(last), 1, 'last card', last);
      }
      this.turn = null;
      await this.pause(1.2);
    }

    async theShow() {
      this.phase = 'show';
      this.peg = { count: 0, seq: [] };
      this.players.forEach((p) => (p.status = ''));
      this.addLog('The show.', 'sys');
      // Count in order starting at the dealer's left; dealer counts hand last, then the crib.
      for (let i = 1; i <= this.n; i++) {
        const seat = this.next(this.dealer, i);
        await this.showOne(seat, this.players[seat].hand, false);
      }
      await this.showOne(this.dealer, this.crib, true);
      this.show = null;
      this.turn = null;
    }

    async showOne(seat, cards, isCrib) {
      const p = this.players[seat];
      const res = Scoring.scoreHand(cards, this.starter, isCrib);
      this.show = { seat, isCrib, cards: Cards.sortCards(cards), revealed: false, res, claimed: null, notes: [] };
      this.turn = seat;
      this.changed();

      let pts = res.total;
      let mug = 0;
      if (this.isHuman(seat) && this.settings.manualCount) {
        const claim = await this.ask(seat, 'count', { isCrib });
        this.show.claimed = claim;
        if (claim > res.total) {
          this.show.notes.push(`Claimed ${claim} — over-count corrected to ${res.total}.`);
        } else if (claim < res.total) {
          pts = claim;
          if (this.settings.muggins) {
            mug = res.total - claim;
            this.show.notes.push(`Claimed ${claim} of ${res.total}. Muggins! ${mug} point${mug > 1 ? 's' : ''} taken by the opponent.`);
          } else {
            this.show.notes.push(`Claimed ${claim} of ${res.total} — missed points are lost.`);
          }
        }
      } else {
        await this.pause(0.6);
      }

      this.show.revealed = true;
      if (isCrib) this.cribRevealed = true; else p.revealed = true;
      this.changed();
      const what = isCrib ? 'crib' : 'hand';
      if (pts > 0) {
        const detail = pts === res.total ? Scoring.summarize(res.items) : `claimed ${pts}`;
        await this.addPoints(p.team, pts, `${what}: ${detail}`, seat);
      } else {
        this.addLog(`${p.name} — ${what}: nineteen (no points)`);
        this.changed();
      }
      if (mug) {
        let opp = this.next(seat);
        while (this.teamOf(opp) === p.team) opp = this.next(opp);
        await this.addPoints(this.teamOf(opp), mug, 'muggins!', opp);
      }
      await this.readyAll(2.6);
    }

    // ---------------------------------------------------------------- views
    view(seat) {
      const pr = seat != null ? this.pending.get(seat) : null;
      const s = this.show;
      return {
        v: this.version,
        seat,
        n: this.n,
        phase: this.phase,
        dealer: this.dealer,
        turn: this.turn,
        handNo: this.handNo,
        settings: { manualCount: !!this.settings.manualCount, muggins: !!this.settings.muggins, difficulty: this.settings.difficulty },
        players: this.players.map((p, i) => ({
          name: p.name, kind: p.kind, connected: p.connected, team: p.team, status: p.status,
          cutCard: p.cutCard, played: p.played, handCount: p.hand.length, pegCount: p.pegHand.length,
          hand: i === seat || p.revealed ? p.hand : null,
          pegHand: i === seat ? p.pegHand : null,
          waiting: this.pending.has(i),
        })),
        teams: this.teams.map((t) => ({ name: t.name, color: t.color, score: t.score, pegs: t.pegs.slice() })),
        deckCount: this.deck.length,
        starter: this.starter,
        crib: { count: this.crib.length, owner: this.dealer, cards: this.cribRevealed ? Cards.sortCards(this.crib) : null },
        peg: { count: this.peg.count, seq: this.peg.seq },
        show: s ? {
          seat: s.seat, isCrib: s.isCrib, cards: s.cards, revealed: s.revealed, claimed: s.claimed, notes: s.notes,
          items: s.revealed ? s.res.items : null, total: s.revealed ? s.res.total : null,
        } : null,
        prompt: pr ? { type: pr.type, data: pr.data } : null,
        log: this.log.slice(-150),
        result: this.result,
      };
    }
  }

  root.CribEngine = { Game, TEAM_COLORS, PRIVATE_PROMPTS, SPEED_MS };
})(typeof window !== 'undefined' ? window : globalThis);
