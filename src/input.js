// Unified keyboard + gamepad input. Actions expose held / pressed (edge) state per frame.
// Gamepad uses the W3C "standard" mapping (Xbox / PlayStation layouts).

const KEYMAP = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  ollie: ['Space'],
  flip: ['KeyJ'],
  grab: ['KeyK'],
  grind: ['KeyL'],
  manual: ['ShiftLeft', 'ShiftRight', 'KeyI'],
  record: ['KeyR'],
  cancel: ['Backspace', 'KeyC'],
  mode: ['Tab'],
  rotate: ['KeyR'],
  rotCamL: ['KeyQ'],
  rotCamR: ['KeyE'],
  del: ['KeyX', 'Delete'],
  menu: ['Escape'],
  help: ['KeyH'],
  respawn: ['KeyT'],
};

// standard mapping indices
const PAD = {
  ollie: [0],      // A / Cross
  grab: [1],       // B / Circle
  flip: [2],       // X / Square
  grind: [3],      // Y / Triangle
  manual: [7, 5],  // RT / RB
  mode: [8],       // Back / Select / Share
  record: [9],     // Start / Options
  cancel: [6],     // LT
  rotate: [3],
  rotCamL: [4],    // LB
  rotCamR: [5],
  del: [1],
  menu: [16],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.prevKeys = new Set();
    this.pressedKeys = new Set();
    this.pad = null;
    this.padButtons = [];
    this.prevPadButtons = [];
    this.axes = [0, 0, 0, 0];
    this.lastDevice = 'keyboard';
    this.enabled = true;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); });
    window.addEventListener('gamepadconnected', (e) => { this.onPad?.(e.gamepad); });
  }

  /** Call once per frame before reading. */
  poll() {
    this.framePressed = this.pressedKeys;
    this.pressedKeys = new Set();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    this.prevPadButtons = this.padButtons;
    if (this.pad) {
      this.padButtons = this.pad.buttons.map((b) => b.pressed || b.value > 0.5);
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      this.axes = [dz(this.pad.axes[0] || 0), dz(this.pad.axes[1] || 0), dz(this.pad.axes[2] || 0), dz(this.pad.axes[3] || 0)];
      // d-pad as stick fallback
      const b = this.padButtons;
      if (b[12]) this.axes[1] = -1;
      if (b[13]) this.axes[1] = 1;
      if (b[14]) this.axes[0] = -1;
      if (b[15]) this.axes[0] = 1;
      if (this.padButtons.some((x, i) => x && !this.prevPadButtons[i]) || this.axes.some((a) => a !== 0)) this.lastDevice = 'gamepad';
    } else {
      this.padButtons = [];
      this.axes = [0, 0, 0, 0];
    }
  }

  held(action) {
    if (!this.enabled) return false;
    if (KEYMAP[action]?.some((k) => this.keys.has(k))) return true;
    if (PAD[action]?.some((i) => this.padButtons[i])) return true;
    return false;
  }

  pressed(action) {
    if (!this.enabled) return false;
    if (KEYMAP[action]?.some((k) => this.framePressed?.has(k))) return true;
    if (PAD[action]?.some((i) => this.padButtons[i] && !this.prevPadButtons[i])) return true;
    return false;
  }

  /** Left stick / WASD as a vector. x: right+, y: up+ */
  stick() {
    let x = 0, y = 0;
    if (this.held('left')) x -= 1;
    if (this.held('right')) x += 1;
    if (this.held('up')) y += 1;
    if (this.held('down')) y -= 1;
    if (this.axes[0] || this.axes[1]) { x = this.axes[0]; y = -this.axes[1]; }
    return { x, y };
  }

  rightStick() { return { x: this.axes[2], y: -this.axes[3] }; }

  /** Directional modifier for trick variants. */
  dirName() {
    const s = this.stick();
    if (Math.abs(s.x) < 0.4 && Math.abs(s.y) < 0.4) return 'n';
    if (Math.abs(s.y) >= Math.abs(s.x)) return s.y > 0 ? 'u' : 'd';
    return s.x > 0 ? 'r' : 'l';
  }

  padTriggerManual() { return this.pad ? (this.pad.buttons[7]?.value ?? 0) > 0.3 : false; }
}
