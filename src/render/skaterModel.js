// Chunky JSR-style skater built from primitives + procedural poses. Ghosts reuse it with a holo material.
import * as THREE from 'three';
import { toon, addOutlines } from './toon.js';
import { PAL, ITEMS } from '../config.js';
import { POSE } from '../game/frame.js';

const itemGeos = {
  ore: new THREE.OctahedronGeometry(0.14, 0),
  ingot: new THREE.BoxGeometry(0.26, 0.11, 0.13),
  plate: new THREE.BoxGeometry(0.26, 0.04, 0.26),
  gear: new THREE.TorusGeometry(0.12, 0.05, 6, 10),
};

export function itemMesh(it, ghostMat = null) {
  const m = new THREE.Mesh(itemGeos[it], ghostMat ?? toon(ITEMS[it].color, { emissive: ITEMS[it].color, emissiveIntensity: 0.5 }));
  return m;
}

export function createSkater({ jacket = PAL.yellow, pants = 0x2a2a6a, skin = 0xb57a55, hair = PAL.cyan, deck = PAL.pink, ghost = null } = {}) {
  const M = (c) => (ghost ? ghost : toon(c));
  const root = new THREE.Group();

  // --- board ---
  const board = new THREE.Group();
  board.position.y = 0.16;
  const deckMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 1.0), M(deck));
  board.add(deckMesh);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.012, 0.96), M(0x1a0d2a));
  grip.position.y = 0.03; grip.userData.noOutline = true;
  board.add(grip);
  for (const z of [-0.33, 0.33]) {
    const truck = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.07), M(0xc8c8d8));
    truck.position.set(0, -0.05, z);
    board.add(truck);
    for (const x of [-0.13, 0.13]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8), M(PAL.cyan));
      w.rotation.z = Math.PI / 2;
      w.position.set(x, -0.09, z);
      board.add(w);
    }
  }
  root.add(board);

  // --- body (side stance) ---
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  hips.rotation.y = -1.1;  // side stance
  body.add(hips);

  const mkLimb = (r, len, col) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), M(col));
    m.position.y = -len / 2;
    g.add(m);
    return g;
  };
  const legL = mkLimb(0.11, 0.62, pants); legL.position.set(-0.14, 0, 0);
  const legR = mkLimb(0.11, 0.62, pants); legR.position.set(0.14, 0, 0);
  hips.add(legL, legR);
  // sneakers
  for (const leg of [legL, legR]) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.28), M(PAL.white));
    shoe.position.set(0, -0.82, 0.05);
    leg.add(shoe);
  }

  const torso = new THREE.Group();
  hips.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.32, 4, 10), M(jacket));
  chest.position.y = 0.3;
  chest.scale.set(1.05, 1, 0.8);
  torso.add(chest);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.36), M(PAL.pink));
  stripe.position.y = 0.36; stripe.userData.noOutline = true;
  torso.add(stripe);
  // backpack (cargo)
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.18), M(PAL.purple));
  pack.position.set(0, 0.34, -0.24);
  torso.add(pack);

  const armL = mkLimb(0.075, 0.5, jacket); armL.position.set(-0.3, 0.55, 0);
  const armR = mkLimb(0.075, 0.5, jacket); armR.position.set(0.3, 0.55, 0);
  torso.add(armL, armR);

  // head w/ headphones + spiky hair
  const head = new THREE.Group();
  head.position.y = 0.86;
  head.rotation.y = 0.9;  // look down the line
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), M(skin));
  head.add(skull);
  const phones = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 6, 16, Math.PI), M(0x1a0d2a));
  phones.position.y = 0.02;
  head.add(phones);
  for (const s of [-1, 1]) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), M(PAL.cyan));
    cup.rotation.z = Math.PI / 2;
    cup.position.set(s * 0.22, 0, 0);
    head.add(cup);
  }
  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.1), M(PAL.orange));
  goggles.position.set(0, 0.1, 0.15);
  head.add(goggles);
  for (let k = 0; k < 6; k++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 5), M(hair));
    const a = (k / 6) * Math.PI * 1.4 - 0.7;
    spike.position.set(Math.sin(a) * 0.1, 0.2, -0.05 + Math.cos(a) * 0.08 - 0.05);
    spike.rotation.set(-0.5 - Math.cos(a) * 0.4, 0, Math.sin(a) * 0.6);
    head.add(spike);
  }

  // cargo display group (floats behind the pack)
  const cargo = new THREE.Group();
  cargo.position.set(0, 1.9, -0.25);
  root.add(cargo);

  if (!ghost) addOutlines(root, 0.03);
  else root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  root.traverse((o) => { if (o.isMesh && !ghost) o.castShadow = true; });

  const parts = { root, board, body, hips, legL, legR, torso, armL, armR, head, cargo, bagKey: '' };
  root.userData.parts = parts;
  return parts;
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Apply a pose. state: {pose, p1, p2, boardYaw, t} */
export function applyPose(P, pose, p1, p2, boardYaw, t, dt = 1 / 60) {
  const k = Math.min(1, dt * 14);
  let crouch = 0.04, armSpread = 0.25, lean = 0, armReach = 0, bail = 0, pushLeg = 0;
  let boardRoll = 0, boardPitch = 0, bYaw = boardYaw;
  switch (pose) {
    case POSE.roll: crouch = 0.08 + Math.sin(t * 2) * 0.02; break;
    case POSE.charge: crouch = 0.12 + p1 * 0.4; armSpread = 0.45 + p1 * 0.35; lean = p1 * 0.15; break;
    case POSE.push: crouch = 0.12; pushLeg = Math.sin(t * 9) * 0.6; break;
    case POSE.air: crouch = 0.3; armSpread = 0.7; break;
    case POSE.flip: crouch = 0.36; armSpread = 0.9; boardRoll = p1; break;
    case POSE.grab: crouch = 0.48; armSpread = 0.3; armReach = 1; boardPitch = p1 * 0.25; break;
    case POSE.grind: crouch = 0.22; armSpread = 1.25; lean = Math.sin(t * 5) * 0.06; break;
    case POSE.manual: crouch = 0.12; armSpread = 1.0; lean = -0.22; boardPitch = -0.32; break;
    case POSE.bail: bail = 1; break;
  }
  const cur = P._s || (P._s = { crouch: 0, arm: 0.25, lean: 0, reach: 0, bail: 0, pitch: 0 });
  cur.crouch = lerp(cur.crouch, crouch, k);
  cur.arm = lerp(cur.arm, armSpread, k);
  cur.lean = lerp(cur.lean, lean, k);
  cur.reach = lerp(cur.reach, armReach, k);
  cur.bail = lerp(cur.bail, bail, Math.min(1, dt * 8));
  cur.pitch = lerp(cur.pitch, boardPitch, k);

  P.body.position.y = -cur.crouch;
  P.legL.rotation.x = cur.crouch * 1.2 + pushLeg;
  P.legR.rotation.x = -cur.crouch * 0.6;
  P.legL.scale.y = P.legR.scale.y = 1 - cur.crouch * 0.35;
  P.torso.rotation.x = cur.crouch * 0.7 + cur.lean;
  P.armL.rotation.z = -cur.arm - 0.15;
  P.armR.rotation.z = cur.arm + 0.15;
  P.armR.rotation.x = -cur.reach * 1.6;
  P.board.rotation.set(cur.pitch, bYaw, boardRoll, 'YXZ');
  // bail: tumble the rider, leave the board
  P.body.rotation.z = cur.bail * 1.35;
  P.body.position.x = cur.bail * 0.5;
  if (cur.bail > 0.05) P.board.rotation.z = cur.bail * 2.6;
}

/** Show the actor's cargo as little floating icons behind the skater. */
export function updateCargo(P, bag, t, ghostMat = null) {
  const key = bag.join(',');
  if (key !== P.bagKey) {
    P.bagKey = key;
    for (const c of [...P.cargo.children]) P.cargo.remove(c);
    bag.forEach((it) => {
      const m = itemMesh(it, ghostMat);
      if (!ghostMat) addOutlines(m, 0.02);
      P.cargo.add(m);
    });
  }
  const n = P.cargo.children.length;
  P.cargo.children.forEach((m, i) => {
    const a = t * 1.8 + (i / Math.max(1, n)) * Math.PI * 2;
    m.position.set(Math.cos(a) * 0.42, Math.sin(t * 3 + i) * 0.06 + (i % 2) * 0.12, Math.sin(a) * 0.42);
    m.rotation.y = t * 2 + i;
  });
}
