// Global tuning + palette. Everything gameplay-feel related lives here so it can be tweaked in one place.

export const CELL = 2;            // world units per grid cell
export const GRID_W = 40;         // yard size in cells
export const GRID_H = 40;
export const HALF_W = (GRID_W * CELL) / 2;
export const HALF_H = (GRID_H * CELL) / 2;

export const RAIL_Y = 0.7;        // grind height of placed rails
export const LEDGE_Y = 0.9;       // grind height of the Ship Ledge

export const PHYS = {
  gravity: 24,
  pushAccel: 14,
  maxPushSpeed: 15,
  maxSpeed: 26,
  brake: 18,
  friction: 0.35,
  turnRate: 2.6,
  airSpinRate: 7.5,
  ollieVel: 8.5,
  grindMinSpeed: 9,
  grindSnapDist: 1.35,
  stepUp: 0.35,
  launchBoost: 1.05,
  comboGrace: 0.85,
  bailTime: 1.1,
  // charged ollie (hold to crouch, release to pop)
  chargeTime: 0.7,      // seconds to full charge
  ollieMin: 0.65,       // pop strength for a tap (x ollieVel)
  ollieMax: 1.3,        // pop strength at full charge
  chargeSteer: 0.3,     // steering multiplier while crouched
  lipWindow: 0.18,      // release this close to a ramp lip for the launch bonus
  lipBonus: 0.75,       // extra pop at a lip at full charge (x ollieVel)
};

export const RECORD_HZ = 60;
export const MAX_RECORD_SECONDS = 120;
export const LOOP_CLOSE_DIST = 4.5;
export const BAG_CAP = 6;

// Jet Set Radio-ish palette: loud, saturated, sunset-cyberpunk
export const PAL = {
  pink: 0xff2e88,
  hotPink: 0xff4fd8,
  cyan: 0x19e6ff,
  teal: 0x00c2a8,
  yellow: 0xffe23b,
  lime: 0xb6ff3b,
  orange: 0xff7a1a,
  purple: 0x7b2cff,
  deepPurple: 0x2a0f4f,
  ink: 0x14061f,
  concrete: 0xb9a7d6,
  concreteDark: 0x8d7bb3,
  white: 0xfdf7ff,
  skyTop: 0x2b0a5c,
  skyMid: 0xff4f9a,
  skyLow: 0xffb347,
};

// Trick energy "flavors"
export const FLAVORS = {
  heat: { label: 'HEAT', icon: '🔥', color: '#ff7a1a', desc: 'grinds' },
  spin: { label: 'SPIN', icon: '🌀', color: '#19e6ff', desc: 'flips + spins' },
  lift: { label: 'LIFT', icon: '⬆', color: '#b6ff3b', desc: 'grabs + air' },
  pressure: { label: 'PRESS', icon: '🔩', color: '#ff4fd8', desc: 'manuals' },
};

export const ITEMS = {
  ore: { label: 'Ore', color: 0xff3bd0, css: '#ff3bd0' },
  ingot: { label: 'Ingot', color: 0xff8a1a, css: '#ff8a1a' },
  plate: { label: 'Plate', color: 0x19e6ff, css: '#19e6ff' },
  gear: { label: 'Gear', color: 0xffe23b, css: '#ffe23b' },
};

export const GHOST_COLORS = [0x19e6ff, 0xb6ff3b, 0xffe23b, 0xff7a1a, 0xff4fd8, 0x9d7bff, 0x00ffa8, 0xff5555];
