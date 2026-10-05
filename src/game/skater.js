// Player skater: arcade THPS-style physics, tricks, combos and trick energy.
import * as THREE from 'three';
import { PHYS, CELL } from '../config.js';
import { POSE, FLAG } from './frame.js';

const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

const FLIPS = { n: 'Kickflip', u: 'Impossible', d: 'Pop Shove-It', l: 'Heelflip', r: 'Varial Kickflip' };
const GRABS = { n: 'Indy', u: 'Nosegrab', d: 'Tailgrab', l: 'Melon', r: 'Method' };
const GRINDS = { n: '50-50', u: 'Nosegrind', d: '5-0', l: 'Boardslide', r: 'Lipslide' };

export class Skater {
  constructor(world, actor, hooks = {}) {
    this.world = world;
    this.actor = actor;
    this.hooks = hooks;
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.bodyYaw = 0;
    this.yawOffset = 0;
    this.speed = 0;
    this.vy = 0;
    this.mode = 'ground';
    this.fakie = false;
    this.flip = null;
    this.grab = null;
    this.grind = null;
    this.manual = false;
    this.manualT = 0;
    this.pushing = false;
    this.airTime = 0;
    this.liftT = 0;
    this.spinAccum = 0;
    this.spinAwarded = 0;
    this.vert = null;
    this.bailT = 0;
    this.noGrindT = 0;
    this.grindBuffer = 0;
    this.charging = false;
    this.charge = 0;
    this.release = null;
    this.boardYaw = 0;
    this.t = 0;
    this.score = 0;
    this.bestCombo = 0;
    this.combo = { active: false, points: 0, mult: 0, names: [], grace: 0 };
    this.stats = { grindDist: 0, airTime: 0 };
    this.spawnPoint = { x: 0, z: 0, heading: 0 };
  }

  spawn(x, z, heading) {
    this.spawnPoint = { x, z, heading };
    this.pos.set(x, this.world.heightAt(x, z), z);
    this.heading = heading;
    this.bodyYaw = heading;
    this.speed = 0;
    this.vy = 0;
    this.mode = 'ground';
    this.grind = this.flip = this.grab = null;
    this.vert = null;
    this.fakie = false;
  }

  respawn() { const s = this.spawnPoint; this.endCombo(true); this.spawn(s.x, s.z, s.heading); }

  dir() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }

  // ---------------- combo / energy ----------------
  addTrick(name, pts, multInc = 1) {
    const c = this.combo;
    if (!c.active) { c.active = true; c.points = 0; c.mult = 0; c.names = []; }
    const reps = c.names.filter((n) => n === name).length;
    c.names.push(name);
    c.points += Math.round(pts / (1 + reps * 0.6));
    c.mult += multInc;
    c.grace = 0;
    this.syncMult();
    this.hooks.onTrick?.(name);
  }
  addPoints(p) { if (this.combo.active) this.combo.points += p; }
  gain(f, amt = 1) {
    if (!this.combo.active) { const c = this.combo; c.active = true; c.points = 0; c.mult = 0; c.names = []; c.grace = 0; }
    this.actor.tally[f] += amt;
    this.hooks.onGain?.(f, amt);
    this.actor.onTallyChanged?.();
  }
  syncMult() {
    const m = Math.max(1, this.combo.mult);
    if (m !== this.actor.mult) { this.actor.mult = m; this.hooks.onMult?.(m); }
  }
  endCombo(failed = false) {
    const c = this.combo;
    if (!c.active) return;
    const banked = failed ? 0 : Math.round(c.points * Math.max(1, c.mult));
    this.score += banked;
    this.bestCombo = Math.max(this.bestCombo, failed ? 0 : c.mult);
    this.hooks.onComboEnd?.(banked, failed, c.mult, [...c.names]);
    c.active = false; c.points = 0; c.mult = 0; c.names = [];
    this.actor.resetTally();
    this.syncMult();
  }

  // ---------------- update ----------------
  update(dt, input) {
    this.t += dt;
    this.noGrindT = Math.max(0, this.noGrindT - dt);
    this.grindBuffer = Math.max(0, this.grindBuffer - dt);
    if (input.pressed('grind')) this.grindBuffer = 0.28;
    // charged ollie: hold to crouch + charge, release to pop
    if (this.mode === 'ground' || this.mode === 'grind') {
      if (input.held('ollie')) {
        this.charging = true;
        this.charge = Math.min(PHYS.chargeTime, this.charge + dt);
      } else if (this.charging) {
        this.charging = false;
        this.release = { c: this.charge / PHYS.chargeTime, t: PHYS.lipWindow };
        this.charge = 0;
      }
    } else {
      this.charging = false;
      this.charge = 0;
    }
    if (this.release) this.release.t -= dt;
    this.yawOffset *= Math.max(0, 1 - dt * 5);

    if (this.mode === 'ground') this.updateGround(dt, input);
    else if (this.mode === 'air') this.updateAir(dt, input);
    else if (this.mode === 'grind') this.updateGrind(dt, input);
    else if (this.mode === 'bail') this.updateBail(dt);

    if (this.world.heightAt(this.pos.x, this.pos.z) > 50 || this.pos.y < -20) this.respawn();
  }

  slopeInfo() {
    const { x: dx, z: dz } = this.dir();
    const w = this.world, p = this.pos;
    const h0 = w.heightAt(p.x, p.z);
    const hb = w.heightAt(p.x - dx * 0.25, p.z - dz * 0.25);
    const hf = w.heightAt(p.x + dx * 0.25, p.z + dz * 0.25);
    const sb = Math.abs(h0 - hb) < 1.0 ? (h0 - hb) / 0.25 : 0;
    const sf = Math.abs(hf - h0) < 1.0 ? (hf - h0) / 0.25 : sb;
    const slope = (sb + sf) / 2;
    const n = Math.sqrt(1 + slope * slope);
    return { h0, slope, slopeBack: sb, sin: slope / n, cos: 1 / n };
  }

  updateGround(dt, input) {
    const s = input.stick();
    const sl = this.slopeInfo();
    const steer = -s.x;
    const steerMul = this.charging ? PHYS.chargeSteer : 1;
    this.heading += steer * steerMul * PHYS.turnRate * dt * (0.55 + 0.45 * Math.min(1, this.speed / 10));
    this.pushing = false;
    if (s.y > 0.3 && !this.manual) {
      if (this.speed < PHYS.maxPushSpeed) { this.speed += PHYS.pushAccel * dt * s.y; this.pushing = true; }
    } else if (s.y < -0.3 && !this.manual) {
      this.speed = Math.max(0, this.speed - PHYS.brake * dt * -s.y);
    }
    this.speed -= PHYS.friction * dt * (this.manual ? 0.4 : 1);
    this.speed -= PHYS.gravity * sl.sin * dt;
    this.speed = Math.min(this.speed, PHYS.maxSpeed);
    if (this.speed < 0) {
      if (Math.abs(sl.slope) > 0.05) { this.heading += Math.PI; this.speed = -this.speed; this.fakie = !this.fakie; }
      else this.speed = 0;
    }

    // manual
    const wantManual = input.held('manual');
    if (wantManual && this.speed > 1.5) {
      if (!this.manual) {
        this.manual = true; this.manualT = 0;
        this.addTrick(input.dirName() === 'u' ? 'Nose Manual' : 'Manual', 60);
      }
      this.manualT += dt;
      while (this.manualT >= 0.4) { this.manualT -= 0.4; this.gain('pressure', 1); this.addPoints(25); }
    } else if (this.manual) {
      this.manual = false;
    }

    // hop onto a nearby rail
    if (this.grindBuffer > 0 && this.tryGrind(input, true)) return;

    // ollie — on a rising ramp face, hold the release briefly so a lip launch can use it
    if (this.release) {
      const onRamp = sl.slopeBack > 0.25 && this.speed > 3;
      if (!onRamp || this.release.t <= 0) {
        const c = this.release.c;
        this.release = null;
        this.manual = false;
        const pop = PHYS.ollieVel * (PHYS.ollieMin + (PHYS.ollieMax - PHYS.ollieMin) * c);
        this.startAir(pop + Math.max(0, sl.sin) * this.speed * 0.7, this.speed * sl.cos);
        this.addTrick('Ollie', 10 + Math.round(c * 20), 0);
        this.hooks.onOllie?.(c);
        return;
      }
    }

    // move
    const { x: dx, z: dz } = this.dir();
    const step = this.speed * sl.cos * dt;
    const nx = this.pos.x + dx * step, nz = this.pos.z + dz * step;
    const hn = this.world.heightAt(nx, nz);
    if (sl.slopeBack > 1.6 && (hn < sl.h0 - 0.06 || hn - sl.h0 > PHYS.stepUp)) {
      // top of a vert ramp (even if it's backed by a wall)
      this.launch(sl);
    } else if (hn - sl.h0 > PHYS.stepUp) {
      this.bounce(nx, nz, sl.h0, true);
    } else if (hn < sl.h0 - 0.06 && sl.slopeBack > 0.12) {
      this.launch(sl);
    } else if (hn < sl.h0 - 0.45) {
      this.pos.x = nx; this.pos.z = nz;
      this.startAir(0, this.speed);
    } else {
      this.pos.set(nx, hn, nz);
    }

    // combo grace on flat ground
    if (this.combo.active && !this.manual) {
      this.combo.grace += dt;
      if (this.combo.grace > PHYS.comboGrace) this.endCombo(false);
    } else if (this.combo.active) this.combo.grace = 0;

    const target = this.heading + (this.fakie ? Math.PI : 0);
    this.bodyYaw += wrap(target - this.bodyYaw) * Math.min(1, dt * 12);
    this.boardYaw *= Math.max(0, 1 - dt * 10);
  }

  launch(sl) {
    const sb = sl.slopeBack;
    const n = Math.sqrt(1 + sb * sb);
    const sin = sb / n, cos = 1 / n;
    // released right at the lip: charged pop on top of the ramp's launch
    let extra = 0;
    if (this.release && this.release.t > 0) {
      const c = this.release.c;
      extra = PHYS.ollieVel * PHYS.lipBonus * (0.3 + 0.7 * c);
      this.addTrick(c > 0.9 ? 'Perfect Ollie' : 'Ollie', 20 + Math.round(c * 60), 0);
      this.hooks.onOllie?.(c);
    }
    this.release = null;
    if (sb > 1.6) {
      // vert: straight up, auto-revert 180 so you come back down the ramp
      const { x: dx, z: dz } = this.dir();
      this.vert = { speed: this.speed };
      this.pos.x -= dx * 0.32; this.pos.z -= dz * 0.32;
      this.startAir(this.speed * sin * 1.12 + extra, 0);
      this.heading += Math.PI;
      this.bodyYaw += Math.PI;
      this.yawOffset -= Math.PI;
      this.hooks.onLaunch?.(true);
    } else {
      this.startAir(this.speed * sin * PHYS.launchBoost + extra, this.speed * cos);
      this.hooks.onLaunch?.(false);
    }
  }

  startAir(vy, hSpeed) {
    this.mode = 'air';
    this.vy = vy;
    this.speed = hSpeed;
    this.airTime = 0;
    this.liftT = 0;
    this.spinAccum = 0;
    this.spinAwarded = 0;
    this.manual = false;
    this.release = null;
    this.pos.y += 0.02;
  }

  bounce(nx, nz, h0, ground) {
    const p = this.pos, w = this.world;
    const { x: dx, z: dz } = this.dir();
    const okX = w.heightAt(nx, p.z) - h0 <= (ground ? PHYS.stepUp : 0.3);
    const okZ = w.heightAt(p.x, nz) - h0 <= (ground ? PHYS.stepUp : 0.3);
    if (okX && !okZ) { this.heading = Math.atan2(dx, -dz); }
    else if (okZ && !okX) { this.heading = Math.atan2(-dx, dz); }
    else { this.heading += Math.PI; }
    this.speed *= 0.5;
    if (ground) this.bodyYaw = this.heading + (this.fakie ? Math.PI : 0);
    this.hooks.onBump?.();
  }

  updateAir(dt, input) {
    const s = input.stick();
    this.airTime += dt;
    this.vy -= PHYS.gravity * dt;
    // spin
    const spin = -s.x * PHYS.airSpinRate * dt;
    this.bodyYaw += spin;
    this.spinAccum += spin;
    const halvesNow = Math.floor((Math.abs(this.spinAccum) + 0.35) / Math.PI);
    while (this.spinAwarded < halvesNow) { this.spinAwarded++; this.gain('spin', 1); }
    if (this.vert) this.speed = 0;

    // air time builds LIFT
    this.liftT += dt;
    if (this.liftT >= 0.8) { this.liftT -= 0.8; this.gain('lift', 1); this.addPoints(20); }

    // flips
    if (this.flip) {
      this.flip.t += dt;
      if (this.flip.t >= this.flip.dur) this.flip = null;
    }
    if (input.pressed('flip') && !this.flip && !this.grab) {
      const d = input.dirName();
      this.flip = { name: FLIPS[d], t: 0, dur: d === 'r' ? 0.5 : 0.4, shove: d === 'd' || d === 'r' };
      this.addTrick(this.flip.name, 100);
      this.gain('spin', 1);
      this.hooks.onFlip?.();
    }
    // grabs (hold)
    if (input.held('grab') && !this.flip) {
      if (!this.grab) {
        const d = input.dirName();
        this.grab = { name: GRABS[d], t: 0, tick: 0, variant: ['n', 'u', 'd', 'l', 'r'].indexOf(d) };
        this.addTrick(this.grab.name, 100);
        this.gain('lift', 1);
      }
      this.grab.t += dt;
      this.grab.tick += dt;
      if (this.grab.tick >= 0.45) { this.grab.tick -= 0.45; this.gain('lift', 1); this.addPoints(40); }
    } else if (this.grab) {
      this.grab = null;
    }

    // grind snap
    if ((this.grindBuffer > 0 || input.held('grind')) && this.tryGrind(input, false)) return;

    // integrate
    const { x: dx, z: dz } = this.dir();
    const nx = this.pos.x + dx * this.speed * dt;
    const nz = this.pos.z + dz * this.speed * dt;
    const ny = this.pos.y + this.vy * dt;
    const hn = this.world.heightAt(nx, nz);
    if (hn > ny) {
      if (hn - this.pos.y > 0.55) {
        // side of something tall: deflect, keep falling
        this.bounce(nx, nz, this.pos.y, false);
        this.pos.y = ny;
        const hh = this.world.heightAt(this.pos.x, this.pos.z);
        if (this.pos.y <= hh) { this.pos.y = hh; this.land(input); }
      } else {
        this.pos.set(nx, hn, nz);
        this.land(input);
      }
    } else {
      this.pos.set(nx, ny, nz);
    }
  }

  land(input) {
    // spins count on landing
    const halves = Math.round(Math.abs(this.spinAccum) / Math.PI);
    const d = wrap(this.bodyYaw - this.heading);
    let bail = false;
    if (this.flip && this.flip.t < this.flip.dur * 0.8) bail = true;
    if (Math.abs(d) > 1.15 && Math.abs(d) < Math.PI - 1.15) bail = true;
    this.grab = null;
    this.flip = null;
    const vert = this.vert;
    this.vert = null;
    if (bail) { this.doBail(); return; }
    if (halves >= 1 && Math.abs(this.spinAccum) > Math.PI * 0.75) this.addTrick(`${halves * 180}`, 80 * halves);
    this.fakie = Math.abs(d) > Math.PI / 2;
    this.bodyYaw = this.heading + (this.fakie ? Math.PI : 0) + 0;
    this.yawOffset = wrap(this.yawOffset);
    this.mode = 'ground';
    this.vy = 0;
    if (vert) this.speed = Math.max(this.speed, vert.speed * 0.85);
    this.stats.airTime += this.airTime;
    if (this.combo.active) this.combo.grace = 0;
    this.hooks.onLand?.(this.airTime);
  }

  doBail() {
    this.mode = 'bail';
    this.bailT = PHYS.bailTime;
    this.grind = this.flip = this.grab = null;
    this.manual = false;
    this.vy = 0;
    this.speed *= 0.35;
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z);
    this.endCombo(true);
    this.hooks.onBail?.();
  }

  updateBail(dt) {
    this.bailT -= dt;
    this.speed = Math.max(0, this.speed - 10 * dt);
    const { x: dx, z: dz } = this.dir();
    const nx = this.pos.x + dx * this.speed * dt, nz = this.pos.z + dz * this.speed * dt;
    const hn = this.world.heightAt(nx, nz);
    if (Math.abs(hn - this.pos.y) < 0.5) this.pos.set(nx, hn, nz);
    if (this.bailT <= 0) { this.mode = 'ground'; this.fakie = false; this.bodyYaw = this.heading; }
  }

  // ---------------- grinding ----------------
  tryGrind(input, fromGround) {
    if (this.noGrindT > 0) return false;
    const w = this.world;
    const g = fromGround
      ? w.nearestGrind(this.pos.x, this.pos.y, this.pos.z, 1.2, 1.6, 1.2)
      : w.nearestGrind(this.pos.x, this.pos.y, this.pos.z, PHYS.grindSnapDist, 1.3, 2.4);
    if (!g) return false;
    if (!fromGround && this.vy > 4 && g.dy < -0.2) return false; // still rising below the rail
    const { nodes, edges } = w.graph;
    const e = edges[g.edge];
    const A = nodes[e.a].p, B = nodes[e.b].p;
    const ex = B.x - A.x, ez = B.z - A.z;
    const L = Math.hypot(ex, ez) || 1;
    const { x: dx, z: dz } = this.dir();
    let dot = (dx * ex + dz * ez) / L;
    if (this.speed < 0.5) dot = Math.cos(this.bodyYaw - Math.atan2(ex, ez));
    // spin-to-grind counts
    if (this.mode === 'air') {
      const halves = Math.round(Math.abs(this.spinAccum) / Math.PI);
      if (halves >= 1 && Math.abs(this.spinAccum) > Math.PI * 0.75) this.addTrick(`${halves * 180}`, 80 * halves);
    }
    const d = input.dirName();
    const name = GRINDS[d];
    this.grind = { edge: g.edge, t: g.t, dir: dot >= 0 ? 1 : -1, name, dist: 0, kind: e.kind, piece: e.piece };
    this.boardYaw = d === 'l' || d === 'r' ? Math.PI / 2 : 0;
    this.speed = Math.max(this.speed, PHYS.grindMinSpeed);
    this.mode = 'grind';
    this.flip = this.grab = null;
    this.vert = null;
    this.manual = false;
    this.vy = 0;
    this.grindBuffer = 0;
    this.fakie = false;
    this.pos.set(g.x, g.y, g.z);
    this.addTrick(name, 100);
    this.gain('heat', 1);
    this.hooks.onGrindStart?.(e.kind);
    return true;
  }

  updateGrind(dt, input) {
    const w = this.world;
    w.ensureGraph();
    const { nodes, edges } = w.graph;
    if (!edges[this.grind.edge]) { this.startAir(2, this.speed); this.grind = null; return; }
    // switch grinds
    if (input.pressed('grind')) {
      const d = input.dirName();
      const name = GRINDS[d];
      if (name !== this.grind.name) { this.grind.name = name; this.boardYaw = d === 'l' || d === 'r' ? Math.PI / 2 : 0; this.addTrick(name, 100); }
    }
    // jump off
    if (this.release || input.pressed('flip')) {
      const flipOut = input.pressed('flip');
      const c = this.release ? this.release.c : 0.4;
      this.release = null;
      this.charging = false;
      this.charge = 0;
      this.grind = null;
      this.noGrindT = 0.3;
      this.pos.y += 0.1;
      this.startAir(PHYS.ollieVel * (0.7 + 0.45 * c), this.speed);
      this.hooks.onGrindEnd?.();
      if (flipOut) {
        const dn = input.dirName();
        this.flip = { name: FLIPS[dn], t: 0, dur: 0.4, shove: dn === 'd' || dn === 'r' };
        this.addTrick(this.flip.name + ' Out', 120);
        this.gain('spin', 1);
      }
      return;
    }
    this.speed = Math.max(PHYS.grindMinSpeed, Math.min(PHYS.maxSpeed, this.speed - 0.5 * dt));
    let remaining = this.speed * dt;
    const steerLeft = -input.stick().x;
    let guard = 0;
    while (remaining > 0 && guard++ < 8) {
      const e = edges[this.grind.edge];
      const len = e.len || 0.0001;
      const toEnd = this.grind.dir > 0 ? (1 - this.grind.t) * len : this.grind.t * len;
      if (remaining < toEnd) {
        this.grind.t += (this.grind.dir * remaining) / len;
        this.grind.dist += remaining;
        remaining = 0;
        break;
      }
      remaining -= toEnd;
      this.grind.dist += toEnd;
      this.grind.t = this.grind.dir > 0 ? 1 : 0;
      const nodeIdx = this.grind.dir > 0 ? e.b : e.a;
      const node = nodes[nodeIdx];
      const fromIdx = this.grind.dir > 0 ? e.a : e.b;
      const cur = new THREE.Vector3().subVectors(node.p, nodes[fromIdx].p).setY(0).normalize();
      let best = null, bestScore = -Infinity;
      for (const ei of node.edges) {
        if (ei === this.grind.edge) continue;
        const ne = edges[ei];
        const other = ne.a === nodeIdx ? ne.b : ne.a;
        const nd = new THREE.Vector3().subVectors(nodes[other].p, node.p).setY(0).normalize();
        const dot = cur.dot(nd);
        if (dot < -0.2) continue;
        const crossY = cur.z * nd.x - cur.x * nd.z;
        const score = dot + 1.6 * steerLeft * crossY;
        if (score > bestScore) { bestScore = score; best = ei; }
      }
      if (best === null || node.isEnd) {
        // off the end
        this.setGrindPos(nodes, edges);
        this.heading = Math.atan2(cur.x, cur.z);
        this.bodyYaw = this.heading;
        this.grind = null;
        this.noGrindT = 0.25;
        this.startAir(3.2, this.speed);
        this.hooks.onGrindEnd?.();
        return;
      }
      const ne = edges[best];
      this.grind.edge = best;
      this.grind.dir = ne.a === nodeIdx ? 1 : -1;
      this.grind.t = this.grind.dir > 0 ? 0 : 1;
    }
    // HEAT per cell of rail
    while (this.grind.dist >= CELL) {
      this.grind.dist -= CELL;
      this.gain('heat', 1);
      this.addPoints(30);
      this.hooks.onGrindCell?.();
    }
    this.setGrindPos(nodes, edges);
    this.combo.grace = 0;
  }

  setGrindPos(nodes, edges) {
    const e = edges[this.grind.edge];
    const A = nodes[e.a].p, B = nodes[e.b].p;
    const t = this.grind.t;
    this.pos.set(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t, A.z + (B.z - A.z) * t);
    const sx = (B.x - A.x) * this.grind.dir, sz = (B.z - A.z) * this.grind.dir;
    if (Math.abs(sx) + Math.abs(sz) > 1e-4) {
      this.heading = Math.atan2(sx, sz);
      this.bodyYaw += wrap(this.heading - this.bodyYaw) * 0.35;
    }
  }

  // ---------------- snapshot for rendering + ghost recording ----------------
  snapshot() {
    let pose = POSE.roll, p1 = 0, p2 = 0, flags = 0;
    let boardYaw = this.boardYaw;
    if (this.mode === 'ground') {
      pose = this.manual ? POSE.manual : this.charging ? POSE.charge : this.pushing ? POSE.push : POSE.roll;
      if (this.charging) p1 = this.charge / PHYS.chargeTime;
      if (this.manual) flags |= FLAG.manual;
    } else if (this.mode === 'air') {
      flags |= FLAG.airborne;
      if (this.flip) {
        pose = POSE.flip;
        const f = this.flip.t / this.flip.dur;
        if (this.flip.shove) { boardYaw = f * Math.PI; p1 = this.flip.name.startsWith('Varial') ? f * TAU : 0; }
        else p1 = f * TAU * (this.flip.name === 'Heelflip' ? -1 : 1);
      } else if (this.grab) { pose = POSE.grab; p1 = this.grab.variant; }
      else pose = POSE.air;
    } else if (this.mode === 'grind') {
      pose = POSE.grind;
      flags |= FLAG.grinding;
    } else if (this.mode === 'bail') {
      pose = POSE.bail;
    }
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.bodyYaw + this.yawOffset, pose, p1, p2, boardYaw, flags };
  }
}
