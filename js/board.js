/* SVG cribbage board (horizontal): continuous 121-hole track per side, two leapfrogging pegs. */
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const SP = 13;      // spacing between holes
  const GAP = 8;      // extra gap between groups of five
  const LEFT = 76;    // x of holes 1 / 120
  const LANE = 15;    // distance between lanes
  const SIDE = 20;    // outer margin (top / bottom)
  const CENTER = 52;  // height of the middle strip (numbers + title)
  const RIGHT_PAD = 58;

  const holeX = (k) => k * SP + Math.floor(k / 5) * GAP; // k = 0..59
  const SPAN = holeX(59);

  function node(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /*
   * Horizontal continuous board: holes 1–60 run left→right along the top lanes,
   * the track loops round the right end, and 61–120 run right→left along the bottom
   * lanes into the game hole on the left. Start holes sit left of hole 1.
   */
  class CribBoard {
    constructor(svg) {
      this.svg = svg;
      this.key = '';
    }

    yT(t) { return SIDE + t * LANE; }              // top lanes (t = 0 outermost)
    yB(t) { return this.H - SIDE - t * LANE; }     // bottom lanes
    gameHole() { return [LEFT - 48, this.H / 2]; }

    /** Board coordinates for a peg at the given score (0 and -1 are the start holes). */
    pos(t, s) {
      if (s >= 121) return this.gameHole();
      if (s <= 0) return [LEFT - (s === 0 ? 24 : 38), this.yT(t)];
      if (s <= 60) return [LEFT + holeX(s - 1), this.yT(t)];
      return [LEFT + SPAN - holeX(s - 61), this.yB(t)];
    }

    setup(teams) {
      const key = teams.map((t) => t.color).join(',');
      if (key === this.key) return;
      this.key = key;
      const T = teams.length;
      this.T = T;
      this.W = LEFT + SPAN + RIGHT_PAD;
      this.H = 2 * (SIDE + (T - 1) * LANE) + CENTER;
      const svg = this.svg;
      svg.innerHTML = '';
      svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);

      const defs = node('defs', {}, svg);
      const grad = node('linearGradient', { id: 'wood', x1: '0', y1: '0', x2: '0.15', y2: '1' }, defs);
      [['0', '#9a6334'], ['0.35', '#b57a43'], ['0.6', '#a26a37'], ['1', '#8a5428']].forEach(([o, c]) => node('stop', { offset: o, 'stop-color': c }, grad));
      const grain = node('pattern', { id: 'grain', width: '40', height: '12', patternUnits: 'userSpaceOnUse' }, defs);
      node('path', { d: 'M0 3 Q20 5 40 3 M0 9 Q20 7 40 9', stroke: 'rgba(60,30,10,.12)', fill: 'none', 'stroke-width': '1' }, grain);

      node('rect', { x: 2, y: 2, width: this.W - 4, height: this.H - 4, rx: 22, fill: 'url(#wood)', stroke: '#5b3416', 'stroke-width': 3 }, svg);
      node('rect', { x: 2, y: 2, width: this.W - 4, height: this.H - 4, rx: 22, fill: 'url(#grain)' }, svg);

      // Lane grooves: start → along the top → round the right end → back along the bottom → game hole.
      const [gx, gy] = this.gameHole();
      const xr = LEFT + SPAN;
      teams.forEach((tm, t) => {
        const yt = this.yT(t), yb = this.yB(t);
        const bulge = 12 + (T - t) * 9; // outer lanes loop wider
        node('path', {
          d: `M${LEFT - 38} ${yt} L${xr} ${yt} C${xr + bulge} ${yt}, ${xr + bulge} ${yb}, ${xr} ${yb} L${LEFT} ${yb} Q${gx} ${yb} ${gx} ${gy}`,
          fill: 'none', stroke: tm.color, 'stroke-opacity': 0.35, 'stroke-width': 7, 'stroke-linecap': 'round',
        }, svg);
      });

      // Holes
      const holes = node('g', { fill: '#2a170a' }, svg);
      teams.forEach((tm, t) => {
        for (let s = -1; s <= 120; s++) {
          const [x, y] = this.pos(t, s);
          node('circle', { cx: x, cy: y, r: s <= 0 ? 3.2 : 2.7 }, holes);
        }
      });
      node('circle', { cx: gx, cy: gy, r: 5, fill: '#2a170a', stroke: '#f2c14e', 'stroke-width': 1.5 }, svg);

      // Numbers every five holes along the inside of each row.
      const labels = node('g', { fill: '#3b200b', 'font-size': 9, 'font-family': 'Georgia, serif', 'font-weight': 'bold', 'text-anchor': 'middle' }, svg);
      const innerT = this.yT(T - 1) + 14, innerB = this.yB(T - 1) - 7;
      for (let s = 5; s <= 120; s += 5) {
        const [x] = this.pos(0, s);
        const tx = node('text', { x, y: s <= 60 ? innerT : innerB }, labels);
        tx.textContent = s;
      }

      // Skunk line between 90 and 91.
      const xSk = (this.pos(0, 90)[0] + this.pos(0, 91)[0]) / 2;
      node('line', { x1: xSk, x2: xSk, y1: this.yB(T - 1) - 7, y2: this.yB(0) + 7, stroke: '#7a0f0f', 'stroke-width': 2 }, svg);

      // Captions and the title.
      const cap = (x, y, text, size = 7, fill = '#3b200b') => {
        const e = node('text', { x, y, 'text-anchor': 'middle', fill, 'font-size': size, 'font-family': 'Georgia, serif', 'font-weight': 'bold', 'letter-spacing': 1 }, svg);
        e.textContent = text;
        return e;
      };
      cap(xSk, this.H - 5, 'SKUNK', 6.5, '#7a0f0f');
      cap(LEFT - 31, 12, 'START');
      cap(gx, gy - 9, 'GAME');
      cap(LEFT + SPAN / 2, this.H / 2 + 5, 'C R I B B A G E', 13, 'rgba(59,32,11,.45)');

      // Pegs (two per side).
      this.pegEls = teams.map((tm) => [0, 1].map(() => {
        const g = node('g', { class: 'peg' }, svg);
        node('circle', { r: 5.6, fill: 'rgba(0,0,0,.35)', cx: 1, cy: 1.5 }, g);
        node('circle', { r: 5.2, fill: tm.color, stroke: '#1a0d04', 'stroke-width': 1 }, g);
        node('circle', { r: 1.8, fill: 'rgba(255,255,255,.55)', cx: -1.6, cy: -1.6 }, g);
        return g;
      }));
    }

    update(teams) {
      if (!this.pegEls) this.setup(teams);
      teams.forEach((tm, t) => tm.pegs.forEach((v, i) => {
        const [x, y] = this.pos(t, v);
        const el = this.pegEls[t] && this.pegEls[t][i];
        if (!el) return;
        el.style.transform = `translate(${x}px, ${y}px)`;
        el.classList.toggle('front', v === tm.score && tm.score > 0);
      }));
    }
  }

  root.CribBoard = CribBoard;
})(window);
