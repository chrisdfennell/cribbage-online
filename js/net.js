/*
 * Peer-to-peer networking via PeerJS (WebRTC). The host's browser is authoritative;
 * guests connect to the host's peer id, derived from a short room code.
 */
(function (root) {
  'use strict';

  const PREFIX = 'cribbage-p2p-v1-';
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function makeCode(len = 5) {
    let s = '';
    for (let i = 0; i < len; i++) s += ALPHABET[root.CribCards.randomInt(ALPHABET.length)];
    return s;
  }

  function normalizeCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function peerAvailable() {
    return typeof root.Peer === 'function';
  }

  function describeError(err) {
    const t = err && err.type;
    if (t === 'peer-unavailable') return 'No game found with that code. Check the code and make sure the host still has the game open.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Could not reach the connection server. Check your internet connection.';
    if (t === 'browser-incompatible') return 'This browser does not support WebRTC.';
    return (err && err.message) || String(err);
  }

  /** Host: owns the room. handlers: { onConnect(conn), onMessage(conn, msg), onClose(conn), onError(msg) } */
  class Host {
    constructor(handlers) {
      this.h = handlers;
      this.peer = null;
      this.code = null;
      this.conns = new Set();
    }

    open(attempt = 0) {
      if (!peerAvailable()) return Promise.reject(new Error('PeerJS failed to load — online play needs an internet connection.'));
      return new Promise((resolve, reject) => {
        const code = makeCode();
        const peer = new root.Peer(PREFIX + code, { debug: 1 });
        let opened = false;
        peer.on('open', () => {
          opened = true;
          this.peer = peer;
          this.code = code;
          resolve(code);
        });
        peer.on('error', (err) => {
          if (!opened) {
            peer.destroy();
            if (err.type === 'unavailable-id' && attempt < 5) this.open(attempt + 1).then(resolve, reject);
            else reject(new Error(describeError(err)));
          } else if (err.type !== 'peer-unavailable') {
            this.h.onError && this.h.onError(describeError(err));
          }
        });
        // Stay reachable for (re)joining guests if the signalling socket drops.
        peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500); });
        peer.on('connection', (conn) => {
          conn.on('open', () => { this.conns.add(conn); this.h.onConnect && this.h.onConnect(conn); });
          conn.on('data', (msg) => this.h.onMessage(conn, msg));
          const closed = () => { if (this.conns.delete(conn)) this.h.onClose(conn); };
          conn.on('close', closed);
          conn.on('error', closed);
        });
      });
    }

    send(conn, msg) {
      try { if (conn && conn.open) conn.send(msg); } catch (e) { console.warn('send failed', e); }
    }

    destroy() {
      this.conns.forEach((c) => { try { c.close(); } catch (e) { /* ignore */ } });
      this.conns.clear();
      if (this.peer) this.peer.destroy();
      this.peer = null;
    }
  }

  /** Guest: connects to a host. handlers: { onOpen(), onMessage(msg), onClose(), onError(msg) } */
  class Guest {
    constructor(handlers) {
      this.h = handlers;
      this.peer = null;
      this.conn = null;
    }

    connect(code) {
      if (!peerAvailable()) return Promise.reject(new Error('PeerJS failed to load — online play needs an internet connection.'));
      code = normalizeCode(code);
      return new Promise((resolve, reject) => {
        const peer = new root.Peer({ debug: 1 });
        this.peer = peer;
        let opened = false;
        const timer = setTimeout(() => {
          if (!opened) { reject(new Error('Timed out connecting to the host.')); this.destroy(); }
        }, 20000);
        peer.on('open', () => {
          const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
          this.conn = conn;
          conn.on('open', () => { opened = true; clearTimeout(timer); resolve(); this.h.onOpen && this.h.onOpen(); });
          conn.on('data', (msg) => this.h.onMessage(msg));
          conn.on('close', () => this.h.onClose && this.h.onClose());
          conn.on('error', (e) => this.h.onError && this.h.onError(describeError(e)));
        });
        peer.on('error', (err) => {
          if (!opened) { clearTimeout(timer); reject(new Error(describeError(err))); this.destroy(); }
          else this.h.onError && this.h.onError(describeError(err));
        });
      });
    }

    send(msg) {
      try { if (this.conn && this.conn.open) this.conn.send(msg); } catch (e) { console.warn('send failed', e); }
    }

    destroy() {
      try { if (this.conn) this.conn.close(); } catch (e) { /* ignore */ }
      if (this.peer && !this.peer.destroyed) this.peer.destroy();
      this.peer = null;
      this.conn = null;
    }
  }

  root.CribNet = { Host, Guest, makeCode, normalizeCode, peerAvailable };
})(window);
