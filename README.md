# Cribbage

Browser cribbage for 2–4 players: computer opponents, pass-and-play on one device, or online with friends. It's a static site with no build step and no server.

## Play

Open `index.html` in a browser. In **New game**, set each seat to one of:

- **Computer**: AI opponent (Expert or Casual)
- **Player on this device**: pass-and-play. The screen hides the cards between turns.
- **Online player**: a friend joins with a room code or invite link

Four players play as partners: seats 1 & 3 vs 2 & 4.

## Online play

Online play is peer-to-peer over WebRTC using [PeerJS](https://peerjs.com). The host's browser runs the game, enforces the rules and sends each guest only their own cards. The host has to keep the tab open. If a guest drops, they can rejoin from the same browser, or the host can let the computer take over that seat.

To send invite links, host the folder on any static host, for example:

- **GitHub Pages**: push the folder to a repo, then Settings → Pages → deploy from the branch.
- **Netlify / Cloudflare Pages**: drag and drop the folder.

Online play needs internet access for the PeerJS library (unpkg) and its free signalling server.

## Files

| File | Purpose |
|---|---|
| `js/cards.js` | Deck, shuffle (crypto RNG), card labels |
| `js/scoring.js` | Scoring for the show and for pegging |
| `js/ai.js` | Computer discards (expected value + Monte Carlo crib) and pegging |
| `js/engine.js` | Authoritative rules engine and per-seat views (runs on the host) |
| `js/board.js` | SVG 121-hole board with leapfrogging pegs |
| `js/net.js` | PeerJS host/guest wrapper |
| `js/ui.js` | Renders a view and turns clicks into answers |
| `js/app.js` | Setup, lobby, host/guest/local modes |

## Tests

Open in a browser, or run headless with Edge or Chrome (`--headless=new --dump-dom`):

- `tests/test.html`: scoring and AI unit tests
- `index.html?autotest=12`: runs 12 complete AI-vs-AI games (2, 3 and 4 players) and checks invariants
- `tests/online.html?n=2`: host and auto-playing guest in two iframes, connected over real PeerJS

Dev URL flags: `?quick=3` skips setup; add `&watch` to let the computer play seat 1.
