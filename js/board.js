/* SVG cribbage board: continuous 121-hole track per side, two leapfrogging pegs.
 *
 * The track is drawn as bands of holes that snake back and forth:
 *   wide    – 2 bands of 60 (1–60 left→right on top, 61–120 right→left below)
 *   compact – 4 bands of 30 (for phones), the same track folded once more
 * Lanes swap order on each band so the turn-around arcs nest without crossing.
 */
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const SP = 13;        // spacing between holes
  const GAP = 8;        // extra gap between groups of five
  const LEFT = 76;      // x of the first hole in each band
  const LANE = 15;      // distance between lanes
  const SIDE = 20;      // outer margin (top / bottom)
  const RIGHT_PAD = 58;
  const BAND_GAP = 16;  // compact: gap between the two band pairs

  const holeX = (k) => k * SP + Math.floor(k / 5) * GAP;

  function node(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  class CribBoard {
    constructor(svg) {
      this.svg = svg;
      this.key = '';
    }

    // ------------------------------------------------------------ geometry
    bandTop(b) {
      const pair = Math.floor(b / 2);
      return SIDE + pair * (2 * this.bandH + this.center + BAND_GAP) + (b % 2) * (this.bandH + this.center);
    }
    laneY(b, t) { return this.bandTop(b) + (b % 2 === 0 ? t : this.T - 1 - t) * LANE; }
    bandDir(b) { return b % 2 === 0 ? 1 : -1; }
    holeXY(t, s) { // s = 1..120
      const b = Math.floor((s - 1) / this.L);
      const k = (s - 1) % this.L;
      const x = this.bandDir(b) === 1 ? LEFT + holeX(k) : LEFT + this.span - holeX(k);
      return [x, this.laneY(b, t)];
    }
    gameHole() {
      if (this.B === 2) return [LEFT - 48, this.H / 2];
      return [LEFT - 44, this.bandTop(this.B - 1) + this.bandH / 2];
    }

    /** Board coordinates for a peg at the given score (0 and -1 are the start holes). */
    pos(t, s) {
      if (s >= 121) return this.gameHole();
      if (s <= 0) return [LEFT - (s === 0 ? 24 : 38), this.laneY(0, t)];
      return this.holeXY(t, s);
    }

    // ------------------------------------------------------------ drawing
    setup(teams, compact = false) {
      const key = teams.map((t) => t.color).join(',') + (compact ? ':c' : ':w');
      if (key === this.key) return;
      this.key = key;
      const T = teams.length;
      this.T = T;
      this.compact = compact;
      this.L = compact ? 30 : 60;            // holes per band
      this.B = 120 / this.L;                 // number of bands
      this.span = holeX(this.L - 1);
      this.bandH = (T - 1) * LANE;
      this.center = compact ? 32 : 52;       // strip between paired bands (numbers, title)
      const pairs = this.B / 2;
      this.W = LEFT + this.span + RIGHT_PAD;
      this.H = 2 * SIDE + pairs * (2 * this.bandH + this.center) + (pairs - 1) * BAND_GAP;

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

      // Lane grooves: start holes → each band → turn-around arc → … → game hole.
      const [gx, gy] = this.gameHole();
      teams.forEach((tm, t) => {
        let d = `M${LEFT - 38} ${this.laneY(0, t)}`;
        for (let b = 0; b < this.B; b++) {
          const dir = this.bandDir(b);
          const y = this.laneY(b, t);
          const xEnd = dir === 1 ? LEFT + this.span : LEFT;
          d += ` L${xEnd} ${y}`;
          if (b < this.B - 1) {
            const y2 = this.laneY(b + 1, t);
            const bulge = 8 + (y2 - y) * 0.42;
            d += ` C${xEnd + dir * bulge} ${y}, ${xEnd + dir * bulge} ${y2}, ${xEnd} ${y2}`;
          } else {
            d += ` Q${gx} ${y} ${gx} ${gy}`;
          }
        }
        node('path', { d, fill: 'none', stroke: tm.color, 'stroke-opacity': 0.35, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
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

      // Numbers every five holes, in the strip between each pair of bands.
      const labels = node('g', { fill: '#3b200b', 'font-size': 9, 'font-family': 'Georgia, serif', 'font-weight': 'bold', 'text-anchor': 'middle' }, svg);
      for (let s = 5; s <= 120; s += 5) {
        const b = Math.floor((s - 1) / this.L);
        const [x] = this.holeXY(0, s);
        const y = b % 2 === 0 ? this.bandTop(b) + this.bandH + 14 : this.bandTop(b) - 7;
        node('text', { x, y }, labels).textContent = s;
      }

      // Skunk line between 90 and 91.
      const [x90] = this.holeXY(0, 90);
      const [x91] = this.holeXY(0, 91);
      const b90 = Math.floor(89 / this.L);
      const sameBand = b90 === Math.floor(90 / this.L);
      const xSk = sameBand ? (x90 + x91) / 2 : x90 + this.bandDir(b90) * 9;
      const top90 = this.bandTop(b90);
      node('line', { x1: xSk, x2: xSk, y1: top90 - 7, y2: top90 + this.bandH + 7, stroke: '#7a0f0f', 'stroke-width': 2 }, svg);

      // Captions and the title.
      const cap = (x, y, text, size = 7, fill = '#3b200b') => {
        const e = node('text', { x, y, 'text-anchor': 'middle', fill, 'font-size': size, 'font-family': 'Georgia, serif', 'font-weight': 'bold', 'letter-spacing': 1 }, svg);
        e.textContent = text;
        return e;
      };
      cap(xSk, sameBand ? top90 + this.bandH + 15 : top90 - 9, 'SKUNK', 6.5, '#7a0f0f');
      cap(LEFT - 31, 12, 'START');
      cap(gx, gy - 9, 'GAME');
      if (!compact) cap(LEFT + this.span / 2, this.H / 2 + 5, 'C R I B B A G E', 13, 'rgba(59,32,11,.45)');

      // Pegs (two per side).
      this.pegEls = teams.map((tm) => [0, 1].map(() => {
        const g = node('g', { class: 'peg' }, svg);
        node('circle', { r: 5.6, fill: 'rgba(0,0,0,.35)', cx: 1, cy: 1.5 }, g);
        node('circle', { r: 5.2, fill: tm.color, stroke: '#1a0d04', 'stroke-width': 1 }, g);
        node('circle', { r: 1.8, fill: 'rgba(255,255,255,.55)', cx: -1.6, cy: -1.6 }, g);
        return g;
      }));
      svg.classList.toggle('compact', compact);
    }

    update(teams) {
      if (!this.pegEls) this.setup(teams);
      teams.forEach((tm, t) => tm.pegs.forEach((v, i) => {
        const [x, y] = this.pos(t, v);
        const el = this.pegEls[t] && this.pegEls[t][i];
        if (!el) return;
        if (!el.dataset.placed) { // first placement after (re)drawing: no slide-in animation
          el.dataset.placed = '1';
          el.style.transition = 'none';
          el.style.transform = `translate(${x}px, ${y}px)`;
          void el.getBoundingClientRect();
          el.style.transition = '';
        }
        el.style.transform = `translate(${x}px, ${y}px)`;
        el.classList.toggle('front', v === tm.score && tm.score > 0);
      }));
    }
  }

  root.CribBoard = CribBoard;
})(window);
