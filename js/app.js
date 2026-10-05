/* App controller: setup, local/host/guest modes, lobby, networking glue. */
(function () {
  'use strict';

  const { Game, PRIVATE_PROMPTS } = window.CribEngine;
  const UI = window.CribUI;
  const Net = window.CribNet;
  const { el, button } = UI;
  const $ = (s) => document.querySelector(s);

  const SETTINGS_KEY = 'cribbage.settings.v2';
  // Dev/test hooks (URL params): quick, watch, online, speed, autostart, autojoin, autoplay.
  const DEV = new URLSearchParams(location.search);
  function devReport(msg) { if (window.parent !== window) window.parent.postMessage({ cribDev: true, ...msg }, '*'); }
  const AI_NAMES = ['Ada', 'Babbage', 'Hopper'];

  const S = {
    mode: 'idle',      // 'host' | 'guest' | 'idle'
    cfg: null,         // host: { seats: [{ name, kind, clientId, conn, connected }], options }
    game: null,
    gameId: 0,
    net: null,         // host: Net.Host
    code: null,
    lobbyOpen: false,
    conns: new Map(),  // host: conn -> { clientId, name, seat }
    viewer: 0,         // host: local seat whose cards are shown
    guest: null,       // guest: Net.Guest
    view: null,        // guest: last view from host
    lobby: null,       // guest: last lobby from host
    guestGameId: null,
    updateQueued: false,
  };

  // ------------------------------------------------------------------ settings
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || null; } catch (e) { return null; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  function clientId() {
    let id = null;
    try { id = localStorage.getItem('cribbage.clientId'); } catch (e) { /* ignore */ }
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem('cribbage.clientId', id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  const cleanName = (s, fallback) => (String(s || '').replace(/\s+/g, ' ').trim().slice(0, 18) || fallback);

  // ------------------------------------------------------------------ setup modal
  function openSetup(errorText) {
    teardownIfIdle();
    const saved = loadSettings() || {};
    $('#setup-count').value = String(saved.count || 2);
    $('#setup-difficulty').value = saved.difficulty || 'expert';
    $('#setup-speed').value = saved.speed || 'normal';
    $('#setup-manual').checked = !!saved.manualCount;
    $('#setup-muggins').checked = !!saved.muggins;
    $('#join-name').value = saved.myName || '';
    const params = new URLSearchParams(location.search);
    if (params.get('join')) $('#join-code').value = Net.normalizeCode(params.get('join'));
    buildSeatRows(saved);
    syncMuggins();
    $('#setup-error').textContent = errorText || '';
    showModal('#setup-modal');
  }

  function buildSeatRows(saved) {
    const count = parseInt($('#setup-count').value, 10);
    const wrap = $('#setup-seats');
    const prev = [...wrap.querySelectorAll('.seat-row')].map((r) => ({ name: r.querySelector('input').value, kind: r.querySelector('select') ? r.querySelector('select').value : 'host' }));
    const savedSeats = (saved && saved.seats) || [];
    wrap.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const row = el('div', 'seat-row');
      row.append(el('span', 'seat-num', `Seat ${i + 1}`));
      const name = el('input');
      name.maxLength = 18;
      const src = prev[i] || savedSeats[i] || {};
      if (i === 0) {
        name.value = src.name || (saved && saved.myName) || 'You';
        name.placeholder = 'Your name';
        row.append(name, el('span', 'seat-kind-fixed', 'You (this device)'));
      } else {
        const kind = el('select');
        [['ai', 'Computer'], ['remote', 'Online player'], ['local', 'Player on this device']].forEach(([v, t]) => {
          const o = el('option', null, t); o.value = v; kind.append(o);
        });
        kind.value = src.kind && src.kind !== 'host' ? src.kind : 'ai';
        name.value = src.name || AI_NAMES[i - 1];
        name.placeholder = 'Name';
        const sync = () => {
          name.disabled = kind.value === 'remote';
          if (kind.value === 'remote') name.value = '';
          else if (!name.value) name.value = kind.value === 'ai' ? AI_NAMES[i - 1] : `Player ${i + 1}`;
        };
        kind.addEventListener('change', sync);
        sync();
        row.append(name, kind);
      }
      wrap.append(row);
    }
    $('#setup-partners').hidden = count !== 4;
  }

  function syncMuggins() {
    $('#setup-muggins').disabled = !$('#setup-manual').checked;
    if (!$('#setup-manual').checked) $('#setup-muggins').checked = false;
  }

  function readSetup() {
    const count = parseInt($('#setup-count').value, 10);
    const seats = [...$('#setup-seats').querySelectorAll('.seat-row')].map((r, i) => {
      const kind = i === 0 ? 'host' : r.querySelector('select').value;
      const name = i === 0 ? cleanName(r.querySelector('input').value, 'You') : kind === 'remote' ? '' : cleanName(r.querySelector('input').value, kind === 'ai' ? AI_NAMES[i - 1] : `Player ${i + 1}`);
      return { name, kind };
    });
    const options = {
      difficulty: $('#setup-difficulty').value,
      speed: $('#setup-speed').value,
      manualCount: $('#setup-manual').checked,
      muggins: $('#setup-manual').checked && $('#setup-muggins').checked,
    };
    saveSettings({ count, seats, ...options, myName: seats[0].name });
    return { seats, options };
  }

  function showModal(sel) {
    document.querySelectorAll('.modal.setup-like').forEach((m) => (m.hidden = m.matches(sel) ? false : true));
  }
  function hideModals() {
    document.querySelectorAll('.modal.setup-like').forEach((m) => (m.hidden = true));
  }

  // ------------------------------------------------------------------ teardown
  function teardown() {
    if (S.game) S.game.abort();
    S.game = null;
    if (S.net) S.net.destroy();
    S.net = null;
    if (S.guest) S.guest.destroy();
    S.guest = null;
    S.conns.clear();
    S.mode = 'idle';
    S.code = null;
    S.view = null;
    S.lobby = null;
    S.lobbyOpen = false;
    S.guestGameId = null;
    $('#room-badge').hidden = true;
    $('#banner').hidden = true;
    $('#chat-form').hidden = true;
    UI.reset();
  }
  function teardownIfIdle() { /* keep current game running behind the modal until a new one starts */ }

  // ------------------------------------------------------------------ host
  async function hostStart() {
    const { seats, options } = readSetup();
    teardown();
    S.watch = DEV.has('watch'); // dev: computer plays seat 1, its cards shown
    if (S.watch) { seats[0].kind = 'ai'; options.speed = 'fast'; }
    if (DEV.has('online')) {
      const k = Math.min(seats.length - 1, parseInt(DEV.get('online'), 10) || 1);
      for (let i = seats.length - k; i < seats.length; i++) seats[i] = { name: '', kind: 'remote' };
    }
    if (DEV.get('speed')) options.speed = DEV.get('speed');
    S.mode = 'host';
    S.cfg = { seats: seats.map((s) => ({ ...s, clientId: null, conn: null, connected: true })), options };
    if (S.cfg.seats.some((s) => s.kind === 'remote')) {
      S.lobbyOpen = true;
      renderHostLobby('Opening room…');
      showModal('#lobby-modal');
      S.net = new Net.Host({ onMessage: hostOnMessage, onClose: hostOnClose, onError: (m) => showBanner(m) });
      try {
        S.code = await S.net.open();
      } catch (e) {
        teardown();
        openSetup(e.message);
        return;
      }
      showRoomBadge();
      renderHostLobby();
      devReport({ type: 'code', code: S.code });
    } else {
      beginGame(null);
    }
  }

  function inviteLink() {
    return `${location.origin}${location.pathname}?join=${S.code}`;
  }

  function showRoomBadge() {
    const b = $('#room-badge');
    b.hidden = false;
    b.textContent = `Room ${S.code}`;
    b.title = 'Click to copy invite link';
  }

  function remoteSeatsFilled() {
    return S.cfg.seats.every((s) => s.kind !== 'remote' || (s.clientId && s.connected));
  }

  function renderHostLobby(status) {
    const body = $('#lobby-modal .modal-body');
    body.innerHTML = '';
    body.append(el('h2', null, 'Online game lobby'));
    if (status || !S.code) { body.append(el('p', 'note', status || 'Opening room…')); return; }
    const codeBox = el('div', 'room-code');
    codeBox.append(el('div', 'area-label', 'Room code'));
    codeBox.append(el('div', 'code', S.code));
    body.append(codeBox);
    const linkRow = el('div', 'link-row');
    const link = el('input');
    link.readOnly = true;
    link.value = inviteLink();
    linkRow.append(link, button('Copy link', '', () => copy(link.value)));
    body.append(linkRow);
    if (location.protocol === 'file:') {
      body.append(el('p', 'note warn', 'This page is opened from a local file, so the invite link only works on this computer. Host the folder online (e.g. GitHub Pages or Netlify), or have friends open their own copy and enter the room code.'));
    } else {
      body.append(el('p', 'note', 'Send the link (or the code) to your friends. They join from this same page.'));
    }
    const list = el('ul', 'lobby-seats');
    S.cfg.seats.forEach((s, i) => {
      const li = el('li');
      const label = s.kind === 'host' ? `${s.name} (you)` : s.kind === 'ai' ? `${s.name} (computer)` : s.kind === 'local' ? `${s.name} (this device)` : s.clientId ? `${s.name} (online)` : 'Waiting for player…';
      li.append(el('span', 'seat-num', `Seat ${i + 1}`), el('span', s.kind === 'remote' && !s.clientId ? 'muted' : '', label));
      if (s.kind === 'remote' && s.clientId) li.append(button('Remove', 'tiny', () => kickSeat(i)));
      list.append(li);
    });
    body.append(list);
    if (S.cfg.seats.length === 4) body.append(el('p', 'note', 'Partners: seats 1 & 3 vs seats 2 & 4.'));
    const actions = el('div', 'modal-actions');
    actions.append(button('Start game', 'primary', () => beginGame(null), !remoteSeatsFilled()));
    actions.append(button('Cancel', '', () => { teardown(); openSetup(); }));
    body.append(actions);
  }

  function kickSeat(i) {
    const s = S.cfg.seats[i];
    if (s.conn) { S.net.send(s.conn, { t: 'kicked' }); setTimeout(() => s.conn && s.conn.close(), 200); }
    for (const [c, info] of S.conns) if (info.seat === i) info.seat = null;
    Object.assign(s, { clientId: null, conn: null, name: '' });
    renderHostLobby();
    broadcast();
  }

  function hostOnMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const info = { clientId: String(msg.clientId || '').slice(0, 64), name: cleanName(msg.name, 'Guest'), seat: null };
      S.conns.set(conn, info);
      const seats = S.cfg.seats;
      let seat = seats.findIndex((s) => s.kind === 'remote' && s.clientId === info.clientId);
      if (seat < 0 && S.lobbyOpen) seat = seats.findIndex((s) => s.kind === 'remote' && !s.clientId);
      if (seat < 0 && S.game) seat = seats.findIndex((s, i) => s.kind === 'remote' && !s.connected && S.game.players[i].kind === 'remote');
      if (seat >= 0) {
        const s = seats[seat];
        if (s.conn && s.conn !== conn) { try { s.conn.close(); } catch (e) { /* ignore */ } }
        for (const [c, other] of S.conns) if (c !== conn && other.seat === seat) other.seat = null;
        s.clientId = info.clientId;
        s.conn = conn;
        s.connected = true;
        if (!S.game) s.name = uniqueName(info.name, seat);
        info.seat = seat;
        if (S.game) S.game.setConnected(seat, true);
      }
      S.net.send(conn, { t: 'welcome', seat: info.seat, code: S.code });
      if (S.lobbyOpen) renderHostLobby();
      broadcast();
      if (DEV.has('autostart') && S.lobbyOpen && remoteSeatsFilled()) beginGame(null);
      return;
    }
    const info = S.conns.get(conn);
    if (!info) return;
    if (msg.t === 'act' && S.game && info.seat != null) {
      S.game.submit(info.seat, msg.answer);
    } else if (msg.t === 'chat' && S.game) {
      const who = info.seat != null ? S.game.players[info.seat].name : info.name;
      postChat(who, msg.text);
    }
  }

  function uniqueName(name, seat) {
    const taken = S.cfg.seats.filter((s, i) => i !== seat).map((s) => s.name.toLowerCase());
    let n = name, k = 2;
    while (taken.includes(n.toLowerCase())) n = `${name} ${k++}`;
    return n;
  }

  function hostOnClose(conn) {
    const info = S.conns.get(conn);
    S.conns.delete(conn);
    if (!info || info.seat == null) return;
    const s = S.cfg.seats[info.seat];
    if (s.conn !== conn) return;
    s.conn = null;
    s.connected = false;
    if (S.game) {
      S.game.setConnected(info.seat, false);
    } else {
      Object.assign(s, { clientId: null, name: '', connected: true });
      renderHostLobby();
      broadcast();
    }
  }

  function postChat(who, text) {
    text = String(text || '').trim().slice(0, 200);
    if (!text || !S.game) return;
    S.game.addLog(`${who}: ${text}`, 'chat');
    S.game.changed();
  }

  function beginGame(firstDealer) {
    if (S.game) S.game.abort();
    UI.reset();
    S.gameId++;
    S.lobbyOpen = false;
    const settings = {
      ...S.cfg.options,
      firstDealer,
      seats: S.cfg.seats.map((s) => ({ name: s.name, kind: s.kind === 'host' ? 'local' : s.kind })),
      // (seat kinds: 'local' = this device, 'remote' = online guest, 'ai' = computer)
    };
    const g = new Game(settings, scheduleUpdate);
    S.cfg.seats.forEach((s, i) => { if (s.kind === 'remote' && !s.connected) g.players[i].connected = false; });
    S.game = g;
    S.viewer = 0;
    hideModals();
    $('#chat-form').hidden = !S.cfg.seats.some((s) => s.kind === 'remote');
    g.run();
    scheduleUpdate();
  }

  function rematch() {
    const g = S.game;
    let firstDealer = null;
    // Two-handed: the loser of the previous game deals first. Otherwise cut again.
    if (g && g.n === 2 && g.winner != null) firstDealer = 1 - g.winner;
    beginGame(firstDealer);
  }

  function scheduleUpdate() {
    if (S.updateQueued) return;
    S.updateQueued = true;
    setTimeout(() => {
      S.updateQueued = false;
      if (S.mode === 'host') {
        hostRender();
        broadcast();
        if (S.game && S.game.phase === 'over' && S.reported !== S.gameId) {
          S.reported = S.gameId;
          devReport({ type: 'over', scores: S.game.teams.map((t) => t.score), hands: S.game.handNo, errors: S.game.log.filter((e) => e.text.startsWith('Internal error')).length });
        }
      }
    }, 0);
  }

  function broadcast() {
    if (!S.net) return;
    for (const [conn, info] of S.conns) {
      if (S.game) S.net.send(conn, { t: 'view', gameId: S.gameId, view: S.game.view(info.seat) });
      else S.net.send(conn, { t: 'lobby', lobby: lobbyData(info.seat) });
    }
  }

  function lobbyData(seat) {
    return {
      code: S.code,
      yourSeat: seat,
      seats: S.cfg.seats.map((s) => ({ name: s.name, kind: s.kind, filled: s.kind !== 'remote' || !!s.clientId })),
      options: S.cfg.options,
    };
  }

  function hostRender() {
    const g = S.game;
    if (!g) return;
    const local = g.players.map((p, i) => i).filter((i) => g.players[i].kind === 'local');
    const multi = local.length > 1;
    if (!multi) S.viewer = local.length ? local[0] : S.watch ? 0 : null;
    const prompts = local.filter((i) => g.pending.has(i)).map((i) => ({ seat: i, ...g.promptFor(i) }));
    let prompt = null;
    let handoff = null;
    const mine = prompts.find((p) => p.seat === S.viewer && p.type !== 'continue');
    if (mine) prompt = mine;
    else {
      const priv = prompts.find((p) => PRIVATE_PROMPTS.has(p.type));
      if (priv) handoff = priv.seat;
      else prompt = prompts.find((p) => p.type !== 'continue') || prompts.find((p) => p.type === 'continue') || null;
    }
    const view = g.view(handoff != null ? null : S.viewer);
    UI.render(view, {
      baseSeat: 0,
      mySeat: handoff != null ? null : S.viewer,
      singleViewer: !multi,
      localSeats: local,
      prompt,
      handoff,
      onHandoff: (seat) => { S.viewer = seat; hostRender(); },
      act: (seat, answer) => {
        const pr = g.promptFor(seat);
        if (pr && pr.type === 'continue') local.forEach((i) => { if ((g.promptFor(i) || {}).type === 'continue') g.submit(i, true); });
        else g.submit(seat, answer);
      },
      rerender: hostRender,
      takeOver: (seat) => g.takeOver(seat),
      onRematch: rematch,
      onNewGame: () => openSetup(),
    });
  }

  // ------------------------------------------------------------------ guest
  async function guestJoin() {
    const code = Net.normalizeCode($('#join-code').value);
    const name = cleanName($('#join-name').value, 'Guest');
    if (code.length < 4) { $('#setup-error').textContent = 'Enter the room code from the host.'; return; }
    const saved = loadSettings() || {};
    saveSettings({ ...saved, myName: name });
    teardown();
    S.mode = 'guest';
    S.code = code;
    S.myName = name;
    showModal('#lobby-modal');
    renderGuestLobby('Connecting…');
    await guestConnect();
  }

  async function guestConnect() {
    if (S.guest) S.guest.destroy();
    S.guest = new Net.Guest({
      onMessage: guestOnMessage,
      onClose: () => { if (S.mode === 'guest') showBanner('Connection to the host was lost.', 'Reconnect', guestReconnect); },
      onError: (m) => showBanner(m),
    });
    try {
      await S.guest.connect(S.code);
      $('#banner').hidden = true;
      S.guest.send({ t: 'hello', clientId: clientId(), name: S.myName });
      showRoomBadge();
    } catch (e) {
      if (S.view) { showBanner(e.message, 'Retry', guestReconnect); return; }
      teardown();
      openSetup(e.message);
    }
  }

  function guestReconnect() {
    $('#banner').hidden = true;
    guestConnect();
  }

  function guestOnMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') {
      S.mySeat = msg.seat;
    } else if (msg.t === 'lobby') {
      S.lobby = msg.lobby;
      S.view = null;
      renderGuestLobby();
      showModal('#lobby-modal');
    } else if (msg.t === 'view') {
      if (msg.gameId !== S.guestGameId) { UI.reset(); S.guestGameId = msg.gameId; }
      S.view = msg.view;
      hideModals();
      $('#chat-form').hidden = false;
      guestRender();
    } else if (msg.t === 'kicked') {
      teardown();
      openSetup('The host removed you from the game.');
    }
  }

  function renderGuestLobby(status) {
    const body = $('#lobby-modal .modal-body');
    body.innerHTML = '';
    body.append(el('h2', null, `Room ${S.code || ''}`));
    const L = S.lobby;
    if (status || !L) { body.append(el('p', 'note', status || 'Waiting for the host…')); }
    else {
      if (L.yourSeat == null) body.append(el('p', 'note warn', 'All seats are taken — you are watching.'));
      else body.append(el('p', 'note', 'Connected! Waiting for the host to start the game…'));
      const list = el('ul', 'lobby-seats');
      L.seats.forEach((s, i) => {
        const label = s.kind === 'ai' ? `${s.name} (computer)` : s.filled ? s.name : 'Waiting for player…';
        const li = el('li');
        li.append(el('span', 'seat-num', `Seat ${i + 1}`), el('span', s.filled ? '' : 'muted', label + (i === L.yourSeat ? ' — you' : '')));
        list.append(li);
      });
      body.append(list);
      const o = L.options;
      body.append(el('p', 'note', `Computer skill: ${o.difficulty}. ${o.manualCount ? 'Count your own hands' + (o.muggins ? ' (muggins on).' : '.') : 'Automatic counting.'}`));
      if (L.seats.length === 4) body.append(el('p', 'note', 'Partners: seats 1 & 3 vs seats 2 & 4.'));
    }
    const actions = el('div', 'modal-actions');
    actions.append(button('Leave', '', () => { teardown(); openSetup(); }));
    body.append(actions);
  }

  function guestRender() {
    const view = S.view;
    if (!view) return;
    const prompt = view.prompt ? { seat: view.seat, ...view.prompt } : null;
    UI.render(view, {
      baseSeat: view.seat != null ? view.seat : 0,
      mySeat: view.seat,
      singleViewer: true,
      localSeats: view.seat != null ? [view.seat] : [],
      prompt,
      handoff: null,
      act: (seat, answer) => S.guest && S.guest.send({ t: 'act', answer }),
      rerender: guestRender,
      onLeave: () => { teardown(); openSetup(); },
    });
    if (DEV.has('autoplay')) devAutoplay(view);
  }

  function devAutoplay(view) {
    const pr = view.prompt;
    if (view.phase === 'over' && S.reported !== S.guestGameId) {
      S.reported = S.guestGameId;
      devReport({ type: 'guest-over', scores: view.teams.map((t) => t.score), seat: view.seat });
    }
    if (!pr || S.autoKey === view.v) return;
    S.autoKey = view.v;
    const me = view.players[view.seat];
    let answer = true;
    if (pr.type === 'cut' || pr.type === 'cutdeal') answer = pr.data.min;
    else if (pr.type === 'discard') answer = me.hand.slice(0, pr.data.count).map((c) => c.id);
    else if (pr.type === 'play') answer = pr.data.playable[0];
    else if (pr.type === 'count') answer = 0;
    setTimeout(() => S.guest && S.guest.send({ t: 'act', answer }), 20);
  }

  // ------------------------------------------------------------------ misc UI
  function showBanner(text, actionLabel, action) {
    const b = $('#banner');
    b.hidden = false;
    b.innerHTML = '';
    b.append(el('span', null, text));
    if (actionLabel) b.append(button(actionLabel, 'tiny', action));
    b.append(button('✕', 'tiny ghost', () => (b.hidden = true)));
  }

  function copy(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => flash('Copied!'), () => flash(text));
    else flash(text);
  }

  function flash(text) {
    const t = el('div', 'toast sys', text);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 2500);
  }

  function wire() {
    $('#setup-count').addEventListener('change', () => buildSeatRows(loadSettings()));
    $('#setup-manual').addEventListener('change', syncMuggins);
    $('#setup-form').addEventListener('submit', (e) => { e.preventDefault(); hostStart(); });
    $('#join-form').addEventListener('submit', (e) => { e.preventDefault(); guestJoin(); });
    $('#btn-new').addEventListener('click', () => {
      if ((S.game && S.game.phase !== 'over') || S.mode === 'guest') {
        if (!confirm('Leave the current game and set up a new one?')) return;
      }
      teardown();
      openSetup();
    });
    $('#btn-rules').addEventListener('click', () => ($('#rules-modal').hidden = false));
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => (b.closest('.modal').hidden = true)));
    $('#room-badge').addEventListener('click', () => copy(inviteLink()));
    $('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#chat-input');
      const text = input.value.trim();
      input.value = '';
      if (!text) return;
      if (S.mode === 'guest' && S.guest) S.guest.send({ t: 'chat', text });
      else if (S.mode === 'host' && S.game) postChat(S.cfg.seats[0].name, text);
    });
    window.addEventListener('beforeunload', (e) => {
      if (S.mode === 'host' && S.net && S.game && S.game.phase !== 'over') { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ------------------------------------------------------------------ self-test (?autotest=N)
  async function autotest(games) {
    const out = { games: 0, hands: 0, errors: [], results: [] };
    const origErr = console.error;
    console.error = (...a) => { out.errors.push(a.map(String).join(' ')); origErr.apply(console, a); };
    for (let k = 0; k < games; k++) {
      const n = 2 + (k % 3);
      const seats = Array.from({ length: n }, (_, i) => ({ name: 'AI' + i, kind: 'ai' }));
      const g = new Game({ seats, speed: 'instant', difficulty: k % 2 ? 'casual' : 'expert' }, () => {
        // invariants checked on every state change
        const all = [...g.deck, ...g.crib, ...g.players.flatMap((p) => p.phaseCards || [])];
        if (g.peg.count > 31) out.errors.push('count over 31');
        g.teams.forEach((t) => { if (t.score > 121 || t.score < 0) out.errors.push('bad score'); });
        if (g.phase === 'play') {
          const cards = g.players.reduce((t, p) => t + p.pegHand.length + p.played.length, 0);
          if (cards !== 4 * n) out.errors.push(`card count ${cards}`);
          if (g.crib.length !== 4) out.errors.push(`crib size ${g.crib.length}`);
        }
        void all;
      });
      await g.run();
      out.games++;
      out.hands += g.handNo;
      if (!g.result) out.errors.push(`game ${k} ended without result`);
      else out.results.push({ n, winner: g.result.winner, scores: g.teams.map((t) => t.score), hands: g.handNo });
      if (g.log.some((e) => e.text.startsWith('Internal error'))) out.errors.push('internal error in game ' + k);
    }
    const pre = document.createElement('pre');
    pre.id = 'autotest';
    pre.textContent = JSON.stringify(out);
    document.body.append(pre);
  }

  // ------------------------------------------------------------------ boot
  document.addEventListener('DOMContentLoaded', () => {
    wire();
    const params = new URLSearchParams(location.search);
    if (params.has('autotest')) { autotest(parseInt(params.get('autotest'), 10) || 6); return; }
    openSetup();
    if (params.has('join') && params.has('autojoin')) {
      $('#join-name').value = params.get('name') || 'Guest';
      guestJoin();
      return;
    }
    if (params.has('quick')) { // dev shortcut: ?quick=3 starts a 3-player game vs the computer
      $('#setup-count').value = String(Math.min(4, Math.max(2, parseInt(params.get('quick'), 10) || 2)));
      buildSeatRows(null);
      hostStart();
    }
  });
})();
