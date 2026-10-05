// Recipes + machine simulation. Machines are fed by actors (player OR ghosts) passing through their zone:
// they deposit matching cargo, donate trick energy from the current combo, and pick up finished goods.
import { BAG_CAP } from '../config.js';

export const RECIPES = {
  smelter: { input: 'ore', output: 'ingot', energy: { heat: 3 }, time: 1.4 },
  press: { input: 'ingot', output: 'plate', energy: { pressure: 2 }, time: 1.4 },
  mill: { input: 'plate', output: 'gear', energy: { spin: 2, lift: 1 }, time: 2.0 },
};

const IN_CAP = 12, OUT_CAP = 12, ENERGY_CAP = 60;

export function stokeFactor(mult) {
  return Math.min(4, 1 + 0.25 * Math.max(0, mult - 1));
}

export function createMachineState(kind) {
  if (kind === 'ship') return { kind, shipped: {} };
  return { kind, recipe: RECIPES[kind], inBuf: 0, outBuf: 0, energy: { heat: 0, spin: 0, lift: 0, pressure: 0 }, busy: false, progress: 0, made: 0, pulse: 0 };
}

/** Called every frame an actor is inside a machine zone. Returns a list of {text, color} popups. */
export function machineTouch(m, actor, stats) {
  const pops = [];
  if (m.kind === 'ship') {
    if (actor.bag.length === 0) return pops;
    const counts = {};
    for (const it of actor.bag) counts[it] = (counts[it] || 0) + 1;
    actor.bag.length = 0;
    for (const [it, n] of Object.entries(counts)) {
      m.shipped[it] = (m.shipped[it] || 0) + n;
      stats.ship(it, n, actor);
      pops.push({ text: `SHIPPED ${n} ${it.toUpperCase()}`, item: it });
    }
    actor.onBagChanged?.();
    return pops;
  }
  const r = m.recipe;
  // deposit inputs
  let dep = 0;
  for (let i = actor.bag.length - 1; i >= 0 && m.inBuf < IN_CAP; i--) {
    if (actor.bag[i] === r.input) { actor.bag.splice(i, 1); m.inBuf++; dep++; }
  }
  if (dep) pops.push({ text: `+${dep} ${r.input.toUpperCase()} IN`, item: r.input });
  // absorb trick energy from the combo (stoke multiplies it)
  const sf = stokeFactor(actor.mult);
  for (const f of Object.keys(r.energy)) {
    const amt = actor.tally[f];
    if (amt > 0) {
      const give = amt * sf;
      m.energy[f] = Math.min(ENERGY_CAP, m.energy[f] + give);
      actor.tally[f] = 0;
      pops.push({ text: `+${give.toFixed(give % 1 ? 1 : 0)} ${f.toUpperCase()}`, flavor: f });
      actor.onTallyChanged?.();
    }
  }
  // collect outputs
  let got = 0;
  while (m.outBuf > 0 && actor.bag.length < BAG_CAP) { m.outBuf--; actor.bag.push(r.output); got++; }
  if (got) pops.push({ text: `+${got} ${r.output.toUpperCase()}`, item: r.output });
  if (dep || got) { actor.onBagChanged?.(); m.pulse = 1; }
  return pops;
}

export function canStart(m) {
  if (m.busy || m.inBuf <= 0 || m.outBuf >= OUT_CAP) return false;
  for (const [f, need] of Object.entries(m.recipe.energy)) if (m.energy[f] < need - 1e-6) return false;
  return true;
}

/** Returns true when an item finished this tick. */
export function machineUpdate(m, dt, stats) {
  if (m.kind === 'ship') return false;
  m.pulse = Math.max(0, m.pulse - dt * 2);
  if (!m.busy && canStart(m)) {
    m.inBuf--;
    for (const [f, need] of Object.entries(m.recipe.energy)) m.energy[f] -= need;
    m.busy = true;
    m.progress = 0;
  }
  if (m.busy) {
    m.progress += dt / m.recipe.time;
    if (m.progress >= 1) {
      m.busy = false;
      m.progress = 0;
      m.outBuf++;
      m.made++;
      stats.craft(m.recipe.output);
      return true;
    }
  }
  return false;
}

/** Why isn't it running? Used by the build-mode tooltip. */
export function machineStatus(m) {
  if (m.kind === 'ship') return 'Grind to ship cargo';
  if (m.busy) return 'Working…';
  if (m.outBuf >= OUT_CAP) return 'Output full — come pick it up';
  if (m.inBuf <= 0) return `Needs ${m.recipe.input.toUpperCase()}`;
  const missing = Object.entries(m.recipe.energy).filter(([f, n]) => m.energy[f] < n).map(([f]) => f.toUpperCase());
  if (missing.length) return `Needs ${missing.join(' + ')} energy`;
  return 'Idle';
}
