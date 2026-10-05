/* Renders a game view (from the engine, local or remote) and turns clicks into answers. */
(function (root) {
  'use strict';

  const { cardLabel, isRed, SUIT_SYMBOL, RANK_LABEL } = root.CribCards;

  const POSITIONS = { 2: ['bottom', 'top'], 3: ['bottom', 'left', 'right'], 4: ['bottom', 'left', 'top', 'right'] };
  const $ = (s) => document.querySelector(s);

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(text, cls, onClick, disabled = false) {
    const b = el('button', 'btn ' + (cls || ''), text);
    b.type = 'button';
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  function cardEl(card, size = '') {
    const d = el('div', `card ${size} ${isRed(card) ? 'red' : ''}`);
    const r = RANK_LABEL[card.rank];
    const s = SUIT_SYMBOL[card.suit];
    d.innerHTML = `<span class="corner tl">${r}<br>${s}</span><span class="pip">${s}</span><span class="corner br">${r}<br>${s}</span><span class="mini-face">${r}<small>${s}</small></span>`;
    d.title = cardLabel(card);
    d.dataset.id = card.id;
    return d;
  }

  function backEl(size = '') {
    return el('div', `card back ${size}`);
  }

  const state = {
    board: null,
    selected: new Set(),
    selectKey: '',
    lastLogId: null,
    lastLogRendered: -1,
    resultShownFor: null,
    animated: new Set(),
  };

  /** True the first time a key is seen, so entry animations run once despite full re-renders. */
  function once(key) {
    if (state.animated.has(key)) return false;
    state.animated.add(key);
    return true;
  }

  function possessive(view, seat, ctx) {
    if (seat === ctx.mySeat && ctx.singleViewer) return 'Your';
    return `${view.players[seat].name}'s`;
  }

  function who(view, seat, ctx) {
    if (seat === ctx.mySeat && ctx.singleViewer) return 'You';
    return view.players[seat].name;
  }

  // ------------------------------------------------------------------ seats
  function renderSeats(view, ctx) {
    $('#table').dataset.n = view.n; // lets the phone layout arrange 1–3 opponents in one row
    const n = view.n;
    const pos = POSITIONS[n];
    ['top', 'left', 'right', 'bottom'].forEach((p) => { const c = $('#pos-' + p); c.innerHTML = ''; c.classList.toggle('empty', true); });
    view.players.forEach((p, i) => {
      const where = pos[(i - ctx.baseSeat + n) % n];
      const box = $('#pos-' + where);
      box.classList.remove('empty');
      const team = view.teams[p.team];
      const seat = el('div', 'seat');
      seat.style.setProperty('--team', team.color);
      if (view.turn === i) seat.classList.add('active');
      if (p.waiting) seat.classList.add('waiting');

      const head = el('div', 'seat-head');
      head.append(el('span', 'dot'));
      head.append(el('span', 'seat-name', p.name));
      if (i === ctx.mySeat) head.append(el('span', 'tag you', 'you'));
      if (p.kind === 'ai') head.append(el('span', 'tag', 'AI'));
      if (p.kind === 'remote') head.append(el('span', 'tag', 'online'));
      if (view.dealer === i && view.phase !== 'cutdeal') head.append(el('span', 'chip-dealer', 'Dealer'));
      head.append(el('span', 'seat-score', String(team.score)));
      seat.append(head);

      const status = el('div', 'seat-status');
      if (!p.connected) {
        status.textContent = 'Disconnected';
        status.classList.add('warn');
        if (ctx.takeOver) status.append(button('Computer plays', 'tiny', () => ctx.takeOver(i)));
      } else if (p.status) {
        status.textContent = p.status;
      } else if (p.waiting) {
        status.textContent = p.kind === 'remote' ? 'deciding…' : '';
      }
      seat.append(status);

      const cards = el('div', 'seat-cards');
      if (p.cutCard) {
        cards.append(cardEl(p.cutCard, 'small'));
      } else if (view.phase === 'show' && p.hand) {
        p.hand.forEach((c) => cards.append(cardEl(c, 'mini')));
      } else if (i !== ctx.mySeat || where !== 'bottom') {
        const count = view.phase === 'play' ? p.pegCount : view.phase === 'show' ? p.handCount : ['deal', 'discard', 'cut'].includes(view.phase) ? p.handCount : 0;
        for (let k = 0; k < count; k++) cards.append(backEl('mini'));
      }
      seat.append(cards);

      if (view.phase === 'play' && p.played.length) {
        const played = el('div', 'seat-played');
        p.played.forEach((c) => played.append(cardEl(c, 'mini')));
        seat.append(played);
      }
      box.append(seat);
    });
  }

  // ------------------------------------------------------------------ centre
  function renderCenter(view, ctx) {
    const deck = $('#deck-area');
    deck.innerHTML = '';
    if (view.deckCount && view.phase !== 'cutdeal' && view.phase !== 'over' || (view.phase === 'over' && view.starter)) {
      const stack = el('div', 'stack');
      stack.append(backEl());
      if (view.starter) {
        const s = cardEl(view.starter);
        s.classList.add('starter-card');
        if (once(`st:${view.handNo}:${view.starter.id}`)) s.classList.add('anim');
        stack.append(s);
      }
      deck.append(stack);
      deck.append(el('div', 'area-label', view.starter ? 'Starter' : 'Deck'));
    }

    const pile = $('#pile-area');
    pile.innerHTML = '';
    if (view.phase === 'play') {
      pile.append(el('div', 'count', String(view.peg.count)));
      pile.append(el('div', 'area-label', 'Count'));
      const row = el('div', 'pile-cards');
      view.peg.seq.forEach((s) => {
        const c = cardEl(s.card, 'small');
        c.style.setProperty('--team', view.teams[view.players[s.seat].team].color);
        c.classList.add('played');
        if (once(`pl:${view.handNo}:${s.card.id}`)) c.classList.add('anim');
        c.title = `${view.players[s.seat].name}: ${cardLabel(s.card)}`;
        row.append(c);
      });
      pile.append(row);
    } else if (view.phase === 'cutdeal') {
      pile.append(el('div', 'center-msg', 'Cut for deal — low card deals'));
    } else if (view.phase === 'discard') {
      pile.append(el('div', 'center-msg', `Lay away to ${possessive(view, view.dealer, ctx).replace(/^Your$/, 'your')} crib`));
    }

    const crib = $('#crib-area');
    crib.innerHTML = '';
    if (view.dealer != null && view.phase !== 'cutdeal' && (view.crib.count || view.phase === 'discard')) {
      const row = el('div', 'crib-cards');
      if (view.crib.cards) view.crib.cards.forEach((c) => row.append(cardEl(c, 'small')));
      else for (let k = 0; k < view.crib.count; k++) row.append(backEl('small'));
      crib.append(row);
      const lab = el('div', 'area-label', `${possessive(view, view.dealer, ctx)} crib`);
      lab.style.color = view.teams[view.players[view.dealer].team].color;
      crib.append(lab);
    }
  }

  // ------------------------------------------------------------------ hand / actions
  function statusText(view, ctx) {
    const t = view.turn;
    const name = (s) => who(view, s, ctx);
    const waiting = view.players.map((p, i) => i).filter((i) => view.players[i].waiting || view.players[i].status === 'thinking…');
    switch (view.phase) {
      case 'cutdeal': return t != null ? `${name(t)} cutting for deal…` : 'Cutting for deal…';
      case 'deal': return `${name(view.dealer)} dealing…`;
      case 'discard': return waiting.length ? `Waiting for ${waiting.map(name).join(', ')} to lay away…` : '';
      case 'cut': return t != null ? `${name(t)} cutting for the starter…` : '';
      case 'play': return t != null ? `${name(t)} to play · count ${view.peg.count}` : '';
      case 'show': return view.show ? `Counting ${possessive(view, view.show.seat, ctx).replace(/^Your$/, 'your')} ${view.show.isCrib ? 'crib' : 'hand'}…` : '';
      case 'over': return 'Game over';
      default: return '';
    }
  }

  function renderSpread(container, data, onPick) {
    const spread = el('div', 'spread');
    spread.style.setProperty('--n', data.size);
    for (let i = 0; i < data.size; i++) {
      const b = backEl('small');
      if (i >= data.min && i <= data.max) {
        b.classList.add('pickable');
        b.addEventListener('click', () => onPick(i));
      } else {
        b.classList.add('locked');
      }
      spread.append(b);
    }
    container.append(spread);
  }

  function renderHand(view, ctx) {
    const area = $('#hand-area');
    area.innerHTML = '';
    const pr = ctx.prompt;
    const head = el('div', 'hand-head');
    const msg = el('div', 'hand-msg');
    const actions = el('div', 'hand-actions');
    const cardsRow = el('div', 'hand-cards');
    area.append(head, cardsRow, actions);

    const me = view.seat != null ? view.players[view.seat] : null;

    if (pr && (pr.type === 'cut' || pr.type === 'cutdeal')) {
      const nm = who(view, pr.seat, ctx);
      msg.textContent = pr.type === 'cutdeal'
        ? `${nm}: cut for deal — click any card (lowest card deals).`
        : `${nm}: cut the deck for the starter — click where to cut.`;
      msg.classList.add('prompt');
      head.append(msg);
      renderSpread(cardsRow, pr.data, (i) => ctx.act(pr.seat, i));
      if (me && me.hand && me.hand.length && pr.type === 'cut') {
        const mine = el('div', 'hand-cards secondary');
        me.hand.forEach((c) => mine.append(cardEl(c, 'small')));
        area.append(mine);
      }
      return;
    }

    if (me) {
      const title = el('div', 'hand-title', ctx.singleViewer ? 'Your hand' : `${me.name}'s hand`);
      title.style.color = view.teams[me.team].color;
      head.append(title);
    }
    head.append(msg);

    const cards = me ? (view.phase === 'play' ? me.pegHand : me.hand) || [] : [];
    const isMine = pr && pr.seat === view.seat;

    if (isMine && pr.type === 'discard') {
      const key = `${view.handNo}:${pr.seat}`;
      if (state.selectKey !== key) { state.selected = new Set(); state.selectKey = key; }
      const k = pr.data.count;
      const owner = pr.data.cribOwner === view.seat ? (ctx.singleViewer ? 'your' : `${me.name}'s`) : `${view.players[pr.data.cribOwner].name}'s`;
      msg.textContent = `Choose ${k} card${k > 1 ? 's' : ''} for ${owner} crib.`;
      msg.classList.add('prompt');
      cards.forEach((c) => {
        const ce = cardEl(c, 'big');
        ce.classList.add('pickable');
        if (state.selected.has(c.id)) ce.classList.add('selected');
        ce.addEventListener('click', () => {
          if (state.selected.has(c.id)) state.selected.delete(c.id);
          else if (state.selected.size < k) state.selected.add(c.id);
          else if (k === 1) state.selected = new Set([c.id]);
          ctx.rerender();
        });
        cardsRow.append(ce);
      });
      actions.append(button(`Send to crib`, 'primary', () => {
        const ids = [...state.selected];
        state.selected = new Set();
        ctx.act(pr.seat, ids);
      }, state.selected.size !== k));
      return;
    }

    if (isMine && pr.type === 'play') {
      msg.textContent = `Your play — count is ${view.peg.count}.`;
      msg.classList.add('prompt');
      const ok = new Set(pr.data.playable);
      cards.forEach((c) => {
        const ce = cardEl(c, 'big');
        if (ok.has(c.id)) {
          ce.classList.add('pickable');
          ce.addEventListener('click', () => ctx.act(pr.seat, c.id));
        } else {
          ce.classList.add('disabled');
          ce.title = 'Would go over 31';
        }
        cardsRow.append(ce);
      });
      return;
    }

    if (isMine && pr.type === 'go') {
      msg.textContent = `No card can be played without passing 31 (count ${view.peg.count}).`;
      msg.classList.add('prompt');
      cards.forEach((c) => { const ce = cardEl(c, 'big'); ce.classList.add('disabled'); cardsRow.append(ce); });
      actions.append(button('Say “Go”', 'primary', () => ctx.act(pr.seat, true)));
      return;
    }

    msg.textContent = statusText(view, ctx);
    cards.forEach((c) => cardsRow.append(cardEl(c, 'big')));
    if (!me) cardsRow.append(el('div', 'spectator', view.seat == null && ctx.handoff == null ? 'Spectating' : ''));
  }

  // ------------------------------------------------------------------ show panel
  function renderShow(view, ctx) {
    const box = $('#show-panel');
    const s = view.show;
    if (!s || view.phase !== 'show') { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '';
    const team = view.teams[view.players[s.seat].team];
    box.style.setProperty('--team', team.color);
    box.append(el('h3', null, `${possessive(view, s.seat, ctx)} ${s.isCrib ? 'crib' : 'hand'}`));

    const row = el('div', 'show-cards');
    s.cards.forEach((c) => row.append(cardEl(c)));
    const st = el('div', 'starter-wrap');
    st.append(cardEl(view.starter));
    st.append(el('div', 'area-label', 'starter'));
    row.append(st);
    box.append(row);

    const pr = ctx.prompt;
    if (pr && pr.type === 'count') {
      const form = el('form', 'count-form');
      form.append(el('label', null, `${who(view, pr.seat, ctx)}: count ${s.isCrib ? 'the crib' : 'the hand'}`));
      const input = el('input');
      Object.assign(input, { type: 'number', min: 0, max: 29, required: true, value: '' });
      input.inputMode = 'numeric';
      form.append(input, button('Claim', 'primary', () => {}));
      form.querySelector('button').type = 'submit';
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = parseInt(input.value, 10);
        if (Number.isInteger(v) && v >= 0 && v <= 29) ctx.act(pr.seat, v);
      });
      box.append(form);
      if (view.settings.muggins) box.append(el('div', 'note', 'Muggins is on: points you miss go to your opponent.'));
      setTimeout(() => input.focus(), 0);
    } else if (s.revealed) {
      const list = el('ul', 'breakdown');
      if (!s.items.length) list.append(el('li', 'none', 'Nineteen — no points.'));
      s.items.forEach((it) => {
        const li = el('li');
        li.append(el('span', 'bd-label', it.label));
        li.append(el('span', 'bd-cards', it.cards.map(cardLabel).join(' ')));
        li.append(el('span', 'bd-pts', String(it.points)));
        list.append(li);
      });
      box.append(list);
      const total = el('div', 'bd-total');
      total.innerHTML = `Total <strong>${s.total}</strong>`;
      box.append(total);
      s.notes.forEach((nt) => box.append(el('div', 'note warn', nt)));
    } else {
      box.append(el('div', 'note', 'Counting…'));
    }

    if (pr && pr.type === 'continue') {
      const others = view.players.map((p, i) => i).filter((i) => view.players[i].waiting && !(ctx.localSeats || []).includes(i));
      const b = button('Continue ▸', 'primary', () => ctx.act(pr.seat, true));
      box.append(b);
      setTimeout(() => b.focus(), 0);
      if (others.length) box.append(el('div', 'note', `Also waiting on: ${others.map((i) => view.players[i].name).join(', ')}`));
    } else if (s.revealed) {
      const w = view.players.map((p, i) => i).filter((i) => view.players[i].waiting);
      if (w.length) box.append(el('div', 'note', `Waiting for ${w.map((i) => view.players[i].name).join(', ')}…`));
    }
  }

  // ------------------------------------------------------------------ scores / board / log
  function renderScores(view, ctx) {
    const box = $('#scores');
    box.innerHTML = '';
    view.teams.forEach((t, i) => {
      const row = el('div', 'score-row');
      row.style.setProperty('--team', t.color);
      row.append(el('span', 'dot'));
      row.append(el('span', 'score-name', t.name));
      row.append(el('span', 'score-val', String(t.score)));
      const bar = el('div', 'score-bar');
      const fill = el('div', 'score-fill');
      fill.style.width = `${(t.score / 121) * 100}%`;
      bar.append(fill);
      row.append(bar);
      box.append(row);
    });
    drawBoard(view);
  }

  function renderLog(view, ctx) {
    const box = $('#log');
    const lastId = view.log.length ? view.log[view.log.length - 1].id : 0;
    if (lastId === state.lastLogRendered) return;
    state.lastLogRendered = lastId;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.innerHTML = '';
    view.log.forEach((e) => {
      const li = el('div', `log-entry ${e.kind}`);
      if (e.team != null && view.teams[e.team]) li.style.setProperty('--team', view.teams[e.team].color);
      li.textContent = e.text;
      box.append(li);
    });
    if (atBottom || true) box.scrollTop = box.scrollHeight;

    // Toasts for newly scored points.
    if (state.lastLogId === null) { state.lastLogId = lastId; return; }
    view.log.filter((e) => e.id > state.lastLogId && e.kind === 'score').forEach((e, k) => toast(e, view, k));
    state.lastLogId = lastId;
  }

  function toast(entry, view, k) {
    const t = el('div', 'toast', entry.text);
    if (entry.team != null && view.teams[entry.team]) t.style.setProperty('--team', view.teams[entry.team].color);
    t.style.animationDelay = `${k * 0.15}s`;
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 3200 + k * 150);
  }

  function renderHandoff(view, ctx) {
    const ov = $('#handoff');
    if (ctx.handoff == null) { ov.hidden = true; return; }
    ov.hidden = false;
    ov.innerHTML = '';
    const p = view.players[ctx.handoff];
    const box = el('div', 'handoff-box');
    box.style.setProperty('--team', view.teams[p.team].color);
    box.append(el('div', 'handoff-title', `Pass to ${p.name}`));
    box.append(el('p', null, 'Other players: look away. Cards are hidden until the button is pressed.'));
    box.append(button(`I'm ${p.name} — show my cards`, 'primary', () => ctx.onHandoff(ctx.handoff)));
    ov.append(box);
  }

  function renderResult(view, ctx) {
    const modal = $('#result-modal');
    const r = view.result;
    if (!r || view.phase !== 'over') { modal.hidden = true; return; }
    modal.hidden = false;
    const box = modal.querySelector('.modal-body');
    box.innerHTML = '';
    const team = view.teams[r.winner];
    const mine = ctx.mySeat != null && view.players[ctx.mySeat].team === r.winner;
    const title = mine && ctx.singleViewer ? (view.n === 4 ? 'You and your partner win!' : 'You win!') : `${r.winnerName} ${view.n === 4 ? 'win' : 'wins'}!`;
    const h = el('h2', 'result-title', title);
    h.style.color = team.color;
    box.append(h);
    const list = el('ul', 'result-list');
    view.teams.forEach((t, i) => {
      const li = el('li');
      li.style.setProperty('--team', t.color);
      const l = r.losers.find((x) => x.i === i);
      li.innerHTML = `<span class="dot"></span><span>${escapeHtml(t.name)}</span><strong>${t.score}</strong>${l && l.skunk ? `<em>${l.skunk === 'double' ? 'double skunk' : 'skunk'}</em>` : ''}`;
      list.append(li);
    });
    box.append(list);
    const skunked = r.losers.filter((l) => l.skunk);
    if (skunked.length) {
      box.append(el('p', 'note', skunked.some((l) => l.skunk === 'double')
        ? 'A double skunk (loser at 60 or less) counts as three games won.'
        : 'A skunk (loser at 90 or less) counts as two games won.'));
    }
    const actions = el('div', 'modal-actions');
    if (ctx.onRematch) actions.append(button('Play again', 'primary', ctx.onRematch));
    if (ctx.onNewGame) actions.append(button('New game setup', '', ctx.onNewGame));
    if (!ctx.onRematch) actions.append(el('div', 'note', 'Waiting for the host to start another game…'));
    if (ctx.onLeave) actions.append(button('Leave', '', ctx.onLeave));
    box.append(actions);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Phones get the folded 4-row board so it fits without scrolling. */
  function drawBoard(view) {
    if (!state.board) state.board = new root.CribBoard($('#board'));
    const compact = $('.board-col').clientWidth < 700;
    state.board.setup(view.teams, compact);
    state.board.update(view.teams);
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.lastView) drawBoard(state.lastView); }, 120);
  });

  function render(view, ctx) {
    state.lastView = view;
    document.body.classList.toggle('in-game', true);
    renderSeats(view, ctx);
    renderCenter(view, ctx);
    renderHand(view, ctx);
    renderShow(view, ctx);
    renderScores(view, ctx);
    renderLog(view, ctx);
    renderHandoff(view, ctx);
    renderResult(view, ctx);
  }

  function reset() {
    state.lastLogId = null;
    state.lastLogRendered = -1;
    state.selected = new Set();
    state.selectKey = '';
    state.animated = new Set();
    $('#toasts').innerHTML = '';
  }

  root.CribUI = { render, reset, el, button, cardEl, escapeHtml };
})(window);
