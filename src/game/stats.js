// Factory-wide counters + THPS-style goal list (zen: no fail states, just things to aim for).

export class Stats {
  constructor() {
    this.reset();
  }
  reset() {
    this.mined = 0;
    this.crafted = { ingot: 0, plate: 0, gear: 0 };
    this.shipped = { ore: 0, ingot: 0, plate: 0, gear: 0 };
    this.shipLog = [];          // timestamps (for per-minute rate)
    this.gearLog = [];
    this.grindCells = 0;
    this.ghostsRecorded = 0;
    this.maxGhosts = 0;
    this.bestMult = 0;
    this.now = 0;
    this.onEvent = null;
  }
  mine() { this.mined++; }
  craft(it) { this.crafted[it] = (this.crafted[it] || 0) + 1; this.onEvent?.('craft', it); }
  ship(it, n, actor) {
    this.shipped[it] = (this.shipped[it] || 0) + n;
    actor.shippedTotal += n;
    for (let k = 0; k < n; k++) { this.shipLog.push(this.now); if (it === 'gear') this.gearLog.push(this.now); }
    this.onEvent?.('ship', it, n, actor);
  }
  rate(log = this.shipLog, window = 60) {
    const cut = this.now - window;
    while (log.length && log[0] < cut) log.shift();
    return log.length * (60 / window);
  }
  serialize() {
    const { mined, crafted, shipped, grindCells, ghostsRecorded, maxGhosts, bestMult } = this;
    return { mined, crafted, shipped, grindCells, ghostsRecorded, maxGhosts, bestMult };
  }
  load(d) { Object.assign(this, d); }
}

export const GOALS = [
  { id: 'grind', text: 'Grind 10 cells of rail', check: (s) => s.grindCells >= 10 },
  { id: 'ore', text: 'Mine 5 ORE — grind the rail over the pink seam', check: (s) => s.mined >= 5 },
  { id: 'ingot', text: 'Smelt an INGOT — skate through the Smelter with ore + HEAT', check: (s) => s.crafted.ingot >= 1 },
  { id: 'ghost', text: 'Record a Ghost — press R, skate a loop, R at the start ring', check: (s) => s.ghostsRecorded >= 1 },
  { id: 'ship', text: 'Ship 10 items at the Ship Ledge', check: (s) => Object.values(s.shipped).reduce((a, b) => a + b, 0) >= 10 },
  { id: 'plate', text: 'Build a Manual Press and make a PLATE', check: (s) => s.crafted.plate >= 1 },
  { id: 'gear', text: 'Build a Spin Mill and make a GEAR', check: (s) => s.crafted.gear >= 1 },
  { id: 'mult', text: 'Land an 8× combo', check: (s) => s.bestMult >= 8 },
  { id: 'ghosts3', text: 'Run 3 Ghosts at once', check: (s) => s.maxGhosts >= 3 },
  { id: 'gears50', text: 'Ship 50 GEARS — the factory runs itself', check: (s) => (s.shipped.gear || 0) >= 50 },
];
