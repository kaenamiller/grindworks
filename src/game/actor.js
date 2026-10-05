// An Actor is anything that skates through the factory and interacts with it: the player, or a Ghost.
// Both share the exact same interaction rules, which is what makes "your run becomes the machine" work.
import { BAG_CAP } from '../config.js';
import { machineTouch } from './machines.js';

export class Actor {
  constructor(name, isGhost = false) {
    this.name = name;
    this.isGhost = isGhost;
    this.bag = [];
    this.tally = { heat: 0, spin: 0, lift: 0, pressure: 0 };
    this.mult = 1;
    this.lastOreCell = -1;
    this.inside = new Set();
    this.shippedTotal = 0;
    this.onBagChanged = null;
    this.onTallyChanged = null;
  }

  resetTally() {
    this.tally.heat = this.tally.spin = this.tally.lift = this.tally.pressure = 0;
    this.onTallyChanged?.();
  }

  addItem(it) {
    if (this.bag.length >= BAG_CAP) return false;
    this.bag.push(it);
    this.onBagChanged?.();
    return true;
  }

  /** Per-frame world interaction. `fx` gets popups for feedback. */
  interact(world, x, y, z, grinding, stats, fx) {
    // mining: grinding a rail that sits on an ore seam
    const cell = world.cellIndexAt(x, z);
    if (grinding && cell >= 0 && world.ore.has(cell) && world.railAtCell(cell)) {
      if (cell !== this.lastOreCell) {
        this.lastOreCell = cell;
        if (this.addItem('ore')) {
          stats.mine(this);
          fx?.pop(x, y + 1.6, z, '+ORE', '#ff3bd0', this.isGhost);
        }
      }
    } else if (!grinding) {
      this.lastOreCell = -1;
    }
    // machines
    const hits = world.machinesAt(x, y, z);
    const nowInside = new Set();
    for (const p of hits) {
      nowInside.add(p.id);
      const pops = machineTouch(p.machine, this, stats);
      if (pops.length) {
        let k = 0;
        for (const pp of pops) {
          fx?.pop(x, y + 1.8 + k * 0.55, z, pp.text, pp.color ?? null, this.isGhost, pp.item, pp.flavor);
          k++;
        }
        fx?.machineFlash(p);
      }
    }
    this.inside = nowInside;
  }
}
