// Ghosts: recorded runs that loop forever and interact with the factory exactly like the player does.
import * as THREE from 'three';
import { RECORD_HZ, MAX_RECORD_SECONDS, GHOST_COLORS, LOOP_CLOSE_DIST } from '../config.js';
import { FRAME_SIZE, F, FLAG } from './frame.js';
import { Actor } from './actor.js';
import { createSkater, applyPose, updateCargo } from '../render/skaterModel.js';

const DT = 1 / RECORD_HZ;
const GHOST_NAMES = ['Beat', 'Gum', 'Tab', 'Mew', 'Yoyo', 'Combo', 'Cube', 'Soda', 'Rhyth', 'Boogie', 'Slate', 'Jazz', 'Garam', 'Piranha'];

export class Recorder {
  constructor() { this.active = false; }

  start(snap) {
    this.active = true;
    this.frames = [];
    this.events = [];
    this.t = 0;
    this.acc = 0;
    this.startPos = { x: snap.x, y: snap.y, z: snap.z };
    this.push(snap);
  }

  push(s) { this.frames.push(s.x, s.y, s.z, s.yaw, s.pose, s.p1, s.p2, s.boardYaw, s.flags); }

  event(type, data = {}) { if (this.active) this.events.push({ t: this.t, type, ...data }); }

  update(dt, snap) {
    if (!this.active) return;
    this.t += dt;
    this.acc += dt;
    while (this.acc >= DT) { this.acc -= DT; this.push(snap); }
  }

  get duration() { return this.frames.length / FRAME_SIZE / RECORD_HZ; }
  get tooLong() { return this.t > MAX_RECORD_SECONDS; }
  distToStart(p) { return Math.hypot(p.x - this.startPos.x, p.z - this.startPos.z); }
  canClose(p) { return this.t > 2 && this.distToStart(p) < LOOP_CLOSE_DIST; }

  /** Finish: blend the tail into the head so the loop is seamless. */
  finish() {
    this.active = false;
    const fr = new Float32Array(this.frames);
    const n = fr.length / FRAME_SIZE;
    const blendN = Math.min(30, Math.floor(n / 3));
    const ex = fr[0] - fr[(n - 1) * FRAME_SIZE], ey = fr[1] - fr[(n - 1) * FRAME_SIZE + 1], ez = fr[2] - fr[(n - 1) * FRAME_SIZE + 2];
    for (let k = 0; k < blendN; k++) {
      const idx = n - blendN + k;
      const w = (k + 1) / blendN;
      const o = idx * FRAME_SIZE;
      fr[o] += ex * w; fr[o + 1] += ey * w; fr[o + 2] += ez * w;
      fr[o + F.flags] = fr[o + F.flags] | FLAG.blend;
    }
    return { frames: fr, events: this.events.slice(), duration: n / RECORD_HZ };
  }

  cancel() { this.active = false; this.frames = []; this.events = []; }
}

let ghostSeq = 0;

export class Ghost {
  constructor(scene, data, opts = {}) {
    this.id = opts.id ?? ++ghostSeq;
    ghostSeq = Math.max(ghostSeq, this.id);
    this.name = opts.name ?? GHOST_NAMES[(this.id - 1) % GHOST_NAMES.length];
    this.color = opts.color ?? GHOST_COLORS[(this.id - 1) % GHOST_COLORS.length];
    this.frames = data.frames;
    this.events = data.events;
    this.duration = data.duration;
    this.n = this.frames.length / FRAME_SIZE;
    this.t = 0;
    this.evIdx = 0;
    this.loops = 0;
    this.runTime = 0;
    this.broken = -1;
    this.visible = true;
    this.actor = new Actor(this.name, true);
    this.peakMult = this.events.reduce((m, e) => (e.type === 'mult' ? Math.max(m, e.m) : m), 1);
    this.scene = scene;

    const col = new THREE.Color(this.color);
    this.mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
    this.cargoMat = new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.4), transparent: true, opacity: 0.9, toneMapped: false });
    this.model = createSkater({ ghost: this.mat });
    this.model.root.renderOrder = 3;
    scene.add(this.model.root);

    // light trail ribbon
    this.trailN = 36;
    this.trailPts = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailN * 2 * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.trailN * 2 * 4), 4));
    const idx = [];
    for (let k = 0; k < this.trailN - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    // path line for build mode
    this.pathLine = null;
    this.buildPath();
  }

  buildPath() {
    if (this.pathLine) { this.scene.remove(this.pathLine); this.pathLine.geometry.dispose(); }
    const pts = [];
    const cols = [];
    const c = new THREE.Color(this.color), bad = new THREE.Color(0xff2020);
    for (let k = 0; k < this.n; k += 3) {
      const o = k * FRAME_SIZE;
      pts.push(this.frames[o], this.frames[o + 1] + 0.15, this.frames[o + 2]);
      const cc = this.broken >= 0 && k >= this.broken ? bad : c;
      cols.push(cc.r, cc.g, cc.b);
    }
    pts.push(this.frames[0], this.frames[1] + 0.15, this.frames[2]);
    cols.push(c.r, c.g, c.b);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.pathLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, toneMapped: false }));
    this.pathLine.visible = false;
    this.scene.add(this.pathLine);
  }

  sample(t) {
    const fi = Math.min(this.n - 1, t * RECORD_HZ);
    const i0 = Math.floor(fi), i1 = (i0 + 1) % this.n, a = fi - i0;
    const o0 = i0 * FRAME_SIZE, o1 = i1 * FRAME_SIZE, f = this.frames;
    const lerpAng = (x, y) => { let d = y - x; d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return x + d * a; };
    return {
      x: f[o0] + (f[o1] - f[o0]) * a,
      y: f[o0 + 1] + (f[o1 + 1] - f[o0 + 1]) * a,
      z: f[o0 + 2] + (f[o1 + 2] - f[o0 + 2]) * a,
      yaw: lerpAng(f[o0 + F.yaw], f[o1 + F.yaw]),
      pose: f[o0 + F.pose],
      p1: f[o0 + F.pose] === f[o1 + F.pose] && Math.abs(f[o1 + F.p1] - f[o0 + F.p1]) < 3 ? f[o0 + F.p1] + (f[o1 + F.p1] - f[o0 + F.p1]) * a : f[o0 + F.p1],
      p2: f[o0 + F.p2],
      boardYaw: f[o0 + F.boardYaw],
      flags: f[o0 + F.flags],
    };
  }

  applyEvent(e) {
    const a = this.actor;
    if (e.type === 'gain') { a.tally[e.f] += e.amt; }
    else if (e.type === 'mult') { a.mult = e.m; }
    else if (e.type === 'comboEnd') { a.resetTally(); a.mult = 1; }
  }

  update(dt, world, stats, fx, now) {
    let s;
    if (this.broken >= 0) {
      s = this.sample(Math.max(0, (this.broken - 2) / RECORD_HZ));
      this.model.root.visible = this.visible && Math.floor(now * 4) % 2 === 0;
      this.mat.color.set(0xff2a2a);
    } else {
      this.mat.color.set(this.color);
      this.model.root.visible = this.visible;
      const prev = this.t;
      this.t += dt;
      this.runTime += dt;
      if (this.t >= this.duration) {
        for (; this.evIdx < this.events.length; this.evIdx++) this.applyEvent(this.events[this.evIdx]);
        this.t -= this.duration;
        this.evIdx = 0;
        this.loops++;
        this.trailPts.length = 0;
      }
      while (this.evIdx < this.events.length && this.events[this.evIdx].t <= this.t) {
        this.applyEvent(this.events[this.evIdx]);
        this.evIdx++;
      }
      s = this.sample(this.t);
      this.actor.interact(world, s.x, s.y, s.z, (s.flags & FLAG.grinding) !== 0, stats, fx);
      void prev;
    }
    const P = this.model;
    P.root.position.set(s.x, s.y, s.z);
    P.root.rotation.y = s.yaw;
    applyPose(P, s.pose, s.p1, s.p2, s.boardYaw, now + this.id, dt);
    updateCargo(P, this.actor.bag, now + this.id, this.cargoMat);
    this.updateTrail(s);
  }

  updateTrail(s) {
    this.trailPts.unshift([s.x, s.y, s.z]);
    if (this.trailPts.length > this.trailN) this.trailPts.length = this.trailN;
    const pos = this.trail.geometry.attributes.position.array;
    const col = this.trail.geometry.attributes.color.array;
    const c = new THREE.Color(this.broken >= 0 ? 0xff2a2a : this.color);
    for (let k = 0; k < this.trailN; k++) {
      const p = this.trailPts[Math.min(k, this.trailPts.length - 1)] ?? [s.x, s.y, s.z];
      pos.set([p[0], p[1] + 0.15, p[2], p[0], p[1] + 1.1, p[2]], k * 6);
      const a = this.visible ? (1 - k / this.trailN) * 0.55 : 0;
      col.set([c.r, c.g, c.b, a, c.r, c.g, c.b, a * 0.2], k * 8);
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;
  }

  validate(world) {
    const b = world.validateFrames(this.frames);
    if (b !== this.broken) {
      const wasBroken = this.broken >= 0;
      this.broken = b;
      this.buildPath();
      return { changed: true, nowBroken: b >= 0, wasBroken };
    }
    return { changed: false };
  }

  get itemsPerMin() { return this.runTime > 5 ? (this.actor.shippedTotal / this.runTime) * 60 : 0; }

  dispose() {
    this.scene.remove(this.model.root, this.trail);
    if (this.pathLine) this.scene.remove(this.pathLine);
    this.trail.geometry.dispose();
    this.pathLine?.geometry.dispose();
  }

  serialize() {
    return {
      id: this.id, name: this.name, color: this.color, duration: this.duration, events: this.events,
      frames: b64FromF32(this.frames),
    };
  }
}

export function b64FromF32(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function f32FromB64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
