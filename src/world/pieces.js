// Piece definitions. Every piece is BOTH skate terrain and a factory part.
// Local frame (before rotation): u across the piece (width, fw cells), v along it (depth, fd cells).
// "Forward" for ramps / gates is +v.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, PAL, LEDGE_Y } from '../config.js';
import { toon, addOutlines, neon } from '../render/toon.js';
import { stickerTexture } from '../render/labels.js';

// ---------- geometry helpers ----------
function stripeTexture(a, b, stripes = 6, chevron = true) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 128, 256);
  g.fillStyle = b;
  const step = 256 / stripes;
  for (let i = 0; i < stripes + 2; i++) {
    const y = i * step;
    g.beginPath();
    if (chevron) {
      g.moveTo(0, y); g.lineTo(64, y - step * 0.5); g.lineTo(128, y);
      g.lineTo(128, y + step * 0.45); g.lineTo(64, y - step * 0.05); g.lineTo(0, y + step * 0.45);
    } else {
      g.rect(0, y, 128, step * 0.5);
    }
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Extruded ramp: profile h(v) for v in [0, depth], width across x. Centered on origin in x/z. */
function rampGeometry(width, depth, hFn, seg = 16) {
  const hw = width / 2, hd = depth / 2;
  // top (smooth, indexed)
  const tp = [], tuv = [], ti = [];
  for (let k = 0; k <= seg; k++) {
    const v = (k / seg) * depth, h = hFn(v);
    tp.push(-hw, h, v - hd, hw, h, v - hd);
    tuv.push(0, k / seg, 1, k / seg);
    if (k < seg) { const a = k * 2; ti.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  top.setIndex(ti);
  top.computeVertexNormals();
  // sides + back (flat)
  const sp = [];
  const tri = (a, b, c) => sp.push(...a, ...b, ...c);
  for (let k = 0; k < seg; k++) {
    const v0 = (k / seg) * depth, v1 = ((k + 1) / seg) * depth;
    const h0 = hFn(v0), h1 = hFn(v1);
    // left (x=-hw) facing -x
    tri([-hw, 0, v0 - hd], [-hw, h0, v0 - hd], [-hw, 0, v1 - hd]);
    tri([-hw, 0, v1 - hd], [-hw, h0, v0 - hd], [-hw, h1, v1 - hd]);
    // right facing +x
    tri([hw, 0, v0 - hd], [hw, 0, v1 - hd], [hw, h0, v0 - hd]);
    tri([hw, 0, v1 - hd], [hw, h1, v1 - hd], [hw, h0, v0 - hd]);
  }
  const hb = hFn(depth);
  tri([-hw, 0, hd], [hw, 0, hd], [-hw, hb, hd]);
  tri([hw, 0, hd], [hw, hb, hd], [-hw, hb, hd]);
  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sides.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((sp.length / 3) * 2).fill(0), 2));
  sides.computeVertexNormals();
  return mergeGeometries([top.toNonIndexed(), sides], true);
}

function signSprite(text, bg, fg = '#fff', scale = 2.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: stickerTexture(text, bg, fg), transparent: true, depthWrite: false }));
  s.scale.set(scale, scale * 0.375, 1);
  return s;
}

// ---------- height profiles ----------
const KICK_LEN = 2 * CELL;
const kickerH = (v) => 1.4 * Math.pow(Math.max(0, Math.min(v, KICK_LEN)) / KICK_LEN, 1.7);

const QP_LEN = 2 * CELL;
const QP_R = 4.25;
const qpH = (v) => {
  const vv = Math.max(0, Math.min(v, QP_LEN));
  return QP_R - Math.sqrt(Math.max(0.0001, QP_R * QP_R - vv * vv));
};

const PILLAR = 1.35;   // gate pillar thickness
const GATE_H = 3.7;

// ---------- definitions ----------
export const PIECES = {
  rail: {
    name: 'Rail', key: '1', fw: 1, fd: 1, color: '#ffe23b',
    blurb: 'Grind it for HEAT. Rails laid over ore seams mine ORE when grinded. Click-drag to lay a line.',
    drag: true,
    height: () => 0,
  },
  kicker: {
    name: 'Kicker', key: '2', fw: 1, fd: 2, color: '#ff7a1a',
    blurb: 'Launch ramp. Air time builds LIFT. Aim it through a gate to feed machines mid-air.',
    height: (u, v) => kickerH(v),
    build() {
      const g = new THREE.Group();
      const geo = rampGeometry(CELL * 0.98, KICK_LEN, kickerH, 14);
      const tex = stripeTexture('#ffe23b', '#14061f', 5);
      const m = new THREE.Mesh(geo, [toon(0xffffff, { map: tex }), toon(PAL.orange)]);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.98, 0.08, 0.12), neon(PAL.cyan, 2));
      lip.position.set(0, kickerH(KICK_LEN) + 0.02, KICK_LEN / 2 - 0.06);
      lip.userData.noOutline = true;
      g.add(lip);
      return g;
    },
  },
  quarter: {
    name: 'Quarter Pipe', key: '3', fw: 2, fd: 2, color: '#19e6ff',
    blurb: 'Vert ramp. Launches you straight up for big spins (SPIN) and grabs (LIFT).',
    vert: true,
    height: (u, v) => qpH(v),
    build() {
      const g = new THREE.Group();
      const geo = rampGeometry(CELL * 2 * 0.99, QP_LEN, qpH, 22);
      const tex = stripeTexture('#7b2cff', '#9d5cff', 8, false);
      const m = new THREE.Mesh(geo, [toon(0xffffff, { map: tex }), toon(0x4a1a8a)]);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      const coping = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, CELL * 2, 10), toon(PAL.cyan, { emissive: PAL.cyan, emissiveIntensity: 0.4 }));
      coping.rotation.z = Math.PI / 2;
      coping.position.set(0, qpH(QP_LEN), QP_LEN / 2);
      g.add(coping);
      const s = signSprite('VERT', '#19e6ff', '#14061f', 2.2);
      s.position.set(0, qpH(QP_LEN) + 1.0, QP_LEN / 2);
      g.add(s);
      return g;
    },
  },
  smelter: {
    name: 'Smelter Gate', key: '4', fw: 3, fd: 1, color: '#ff2e88',
    blurb: 'Skate THROUGH it carrying ORE with HEAT in your combo → INGOTS. Pick ingots up on the next pass.',
    machine: 'smelter',
    height: (u) => (u < PILLAR || u > 3 * CELL - PILLAR ? GATE_H : 0),
    zone: { u0: PILLAR, u1: 3 * CELL - PILLAR, v0: -0.3, v1: CELL + 0.3, y0: -1, y1: GATE_H - 0.2 },
    build() { return gateMesh(PAL.pink, PAL.orange, 'SMELT', '#ff2e88'); },
  },
  press: {
    name: 'Manual Press', key: '5', fw: 1, fd: 3, color: '#ff4fd8',
    blurb: 'Roll across it carrying INGOTS. Manuals build PRESSURE → PLATES.',
    machine: 'press',
    height: () => 0.28,
    zone: { u0: 0, u1: CELL, v0: 0, v1: 3 * CELL, y0: -1, y1: 1.6 },
    build() {
      const g = new THREE.Group();
      const tex = stripeTexture('#ff4fd8', '#14061f', 7, false);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.98, 0.28, 3 * CELL * 0.99), [
        toon(PAL.hotPink), toon(PAL.hotPink), toon(0xffffff, { map: tex }), toon(PAL.hotPink), toon(PAL.hotPink), toon(PAL.hotPink),
      ]);
      pad.position.y = 0.14;
      pad.castShadow = true; pad.receiveShadow = true;
      g.add(pad);
      // holo piston (visual only)
      const holo = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.8, 0.25, CELL * 1.4), new THREE.MeshBasicMaterial({ color: PAL.cyan, transparent: true, opacity: 0.35, toneMapped: false }));
      holo.position.y = 3.2;
      holo.userData.noOutline = true;
      holo.name = 'piston';
      g.add(holo);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), neon(PAL.cyan, 1.5));
      beam.position.y = 4.6; beam.userData.noOutline = true; beam.name = 'beam';
      g.add(beam);
      const s = signSprite('PRESS', '#ff4fd8', '#fff', 2.4);
      s.position.set(0, 4.4, 0);
      g.add(s);
      return g;
    },
  },
  mill: {
    name: 'Spin Mill', key: '6', fw: 3, fd: 1, color: '#b6ff3b',
    blurb: 'Fly through carrying PLATES with SPIN ×2 + LIFT ×1 in your combo → GEARS.',
    machine: 'mill',
    height: (u) => (u < PILLAR || u > 3 * CELL - PILLAR ? GATE_H : 0),
    zone: { u0: PILLAR, u1: 3 * CELL - PILLAR, v0: -0.3, v1: CELL + 0.3, y0: -1, y1: GATE_H - 0.2 },
    build() { return gateMesh(PAL.teal, PAL.lime, 'MILL', '#b6ff3b', true); },
  },
  ledge: {
    name: 'Ship Ledge', key: '7', fw: 1, fd: 3, color: '#19e6ff',
    blurb: 'Grind it to SHIP everything in your bag. Shipped goods are the score of your factory.',
    machine: 'ship',
    height: (u) => (Math.abs(u - CELL / 2) < 0.62 ? LEDGE_Y : 0),
    zone: { u0: -0.2, u1: CELL + 0.2, v0: 0, v1: 3 * CELL, y0: LEDGE_Y - 0.5, y1: LEDGE_Y + 1.8 },
    grind: [{ u0: CELL / 2, v0: 0.05, u1: CELL / 2, v1: 3 * CELL - 0.05, y: LEDGE_Y }],
    build() {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.24, LEDGE_Y - 0.08, 3 * CELL), toon(0x9a86c9));
      body.position.y = (LEDGE_Y - 0.08) / 2;
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 3 * CELL + 0.04), toon(PAL.cyan, { emissive: PAL.cyan, emissiveIntensity: 0.35 }));
      cap.position.y = LEDGE_Y - 0.04;
      g.add(cap);
      // crates on the side to read as "shipping"
      for (let i = 0; i < 2; i++) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), toon([PAL.yellow, PAL.orange][i]));
        crate.position.set(0, LEDGE_Y + 0.0, (i - 0.5) * 3.5);
        crate.visible = false;
        g.add(crate);
      }
      const s = signSprite('SHIP ⇢', '#19e6ff', '#14061f', 2.6);
      s.position.set(0, 2.6, 0);
      g.add(s);
      return g;
    },
  },
};

function gateMesh(pillarCol, accent, text, signBg, rings = false) {
  const g = new THREE.Group();
  const W = 3 * CELL;
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(PILLAR, GATE_H, CELL * 0.95), toon(pillarCol));
    p.position.set(side * (W / 2 - PILLAR / 2), GATE_H / 2, 0);
    p.castShadow = true; p.receiveShadow = true;
    g.add(p);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(PILLAR + 0.04, 0.3, CELL * 0.97), toon(accent, { emissive: accent, emissiveIntensity: 0.6 }));
    stripe.position.set(side * (W / 2 - PILLAR / 2), GATE_H * 0.55, 0);
    g.add(stripe);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(W, 0.7, CELL * 0.95), toon(0x2a0f4f));
  beam.position.y = GATE_H + 0.35;
  beam.castShadow = true;
  g.add(beam);
  // glowing membrane you pass through
  const film = new THREE.Mesh(
    new THREE.PlaneGeometry(W - PILLAR * 2, GATE_H),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.16, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }),
  );
  film.position.y = GATE_H / 2;
  film.userData.noOutline = true;
  film.name = 'film';
  g.add(film);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.07, 6, 32), neon(accent, 2.2));
  frame.position.y = GATE_H * 0.55;
  frame.userData.noOutline = true;
  frame.name = 'ring';
  g.add(frame);
  if (rings) {
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 6, 32), neon(PAL.yellow, 2));
    r2.position.y = GATE_H * 0.55; r2.userData.noOutline = true; r2.name = 'ring2';
    g.add(r2);
  }
  const s = signSprite(text, signBg, '#14061f', 2.6);
  s.position.set(0, GATE_H + 1.25, 0);
  g.add(s);
  return g;
}

export function buildPieceMesh(type) {
  const def = PIECES[type];
  const g = def.build();
  addOutlines(g, 0.05);
  return g;
}

export const PIECE_ORDER = ['rail', 'kicker', 'quarter', 'smelter', 'press', 'mill', 'ledge'];
