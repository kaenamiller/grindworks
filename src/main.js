// GRINDWORKS prototype — entry point. Wires world, skater, ghosts, build mode, HUD and rendering together.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { PAL, CELL, GRID_W, GRID_H, HALF_W, HALF_H } from './config.js';
import { buildEnvironment } from './render/environment.js';
import { createSkater, applyPose, updateCargo } from './render/skaterModel.js';
import { FX } from './render/fx.js';
import { World } from './world/world.js';
import { Actor } from './game/actor.js';
import { Skater } from './game/skater.js';
import { Recorder, Ghost, f32FromB64 } from './game/ghosts.js';
import { Stats, GOALS } from './game/stats.js';
import { FLAG } from './game/frame.js';
import { Input } from './input.js';
import { HUD } from './ui/hud.js';
import { BuildController } from './ui/build.js';
import { Sfx } from './audio.js';

const SAVE_KEY = 'grindworks-save-v1';

class Game {
  constructor() {
    // ---------- renderer ----------
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.5, 1.02);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    window.addEventListener('resize', () => this.resize());

    this.env = buildEnvironment(this.scene);

    // ---------- systems ----------
    this.input = new Input();
    this.hud = new HUD();
    this.sfx = new Sfx();
    this.stats = new Stats();
    this.fx = new FX(this.scene);
    this.world = new World(this.scene);
    this.ghosts = [];
    this.recorder = new Recorder();
    this.goalsDone = new Set();

    this.actor = new Actor('You');
    this.skater = new Skater(this.world, this.actor, this.skaterHooks());
    this.model = createSkater();
    this.scene.add(this.model.root);

    this.build = new BuildController(this);
    this.mode = 'skate';
    this.modeBlend = 0;
    this.camYaw = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.started = false;
    this.paused = false;
    this.time = 0;

    // record start marker
    this.ring = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.pink).multiplyScalar(2.2), toneMapped: false }));
    torus.rotation.x = Math.PI / 2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 14, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.pink).multiplyScalar(1.6), transparent: true, opacity: 0.6, toneMapped: false }));
    beam.position.y = 7;
    this.ring.add(torus, beam);
    this.ring.visible = false;
    this.scene.add(this.ring);

    this.stats.onEvent = (type, it, n, actor) => {
      if (type === 'ship' && !actor.isGhost) this.sfx.ship();
      if (type === 'craft') { /* soft tick handled by fx */ }
    };

    this.validateTimer = -1;
    this.world.onChange(() => { this.validateTimer = 0.12; this.saveSoon(); });

    if (!this.load()) this.seed();
    this.hud.goals(this.goalsDone);
    this.hud.setMode('skate', 'keyboard');
    this.setupMenus();

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------- starter yard ----------------
  seed() {
    const w = this.world;
    w.clear();
    for (const g of this.ghosts) g.dispose();
    this.ghosts = [];
    // ore seams
    w.ore = new Set();
    for (let i = 6; i <= 12; i++) for (let j = 8; j <= 10; j++) w.ore.add(w.idx(i, j));
    for (let i = 26; i <= 31; i++) for (let j = 25; j <= 28; j++) w.ore.add(w.idx(i, j));
    for (let i = 5; i <= 8; i++) for (let j = 27; j <= 31; j++) w.ore.add(w.idx(i, j));
    w.buildOreVisuals();
    // starter line: rail over ore -> smelter -> ship ledge -> quarter pipe
    const rail = [];
    for (let i = 4; i <= 14; i++) rail.push({ i, j: 9 });
    w.placeRailPath(rail);
    w.place('smelter', 17, 8, 1);
    w.place('ledge', 21, 9, 1);
    w.place('quarter', 27, 8, 1);
    w.place('quarter', 0, 8, 3);
    w.place('kicker', 13, 14, 3);
    w.place('quarter', 18, 38, 0);
    this.skater.spawn(w.cellCenter(3, 9).x, w.cellCenter(3, 9).z, Math.PI / 2);
    this.camYaw = Math.PI / 2;
  }

  // ---------------- skater hooks ----------------
  skaterHooks() {
    let trickN = 0;
    return {
      onTrick: () => { this.sfx.trick(trickN++ % 6); },
      onGain: (f, amt) => this.recorder.event('gain', { f, amt }),
      onMult: (m) => { this.recorder.event('mult', { m }); this.stats.bestMult = Math.max(this.stats.bestMult, m); },
      onComboEnd: (banked, failed) => { this.recorder.event('comboEnd'); this.hud.comboEnd(banked, failed); trickN = 0; },
      onBail: () => { this.sfx.bail(); },
      onLand: (air) => { if (air > 0.25) this.sfx.land(); },
      onOllie: (c = 0.5) => this.sfx.pop(c),
      onLaunch: () => {},
      onFlip: () => this.sfx.pop(),
      onBump: () => this.sfx.bump(),
      onGrindStart: () => this.sfx.tone(300, 0.05, 'square', 0.08),
      onGrindCell: () => { this.stats.grindCells++; },
      onGrindEnd: () => {},
    };
  }

  // ---------------- modes ----------------
  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'build') this.build.enter(this.skater.pos);
    else this.build.exit();
    this.hud.setMode(m, this.input.lastDevice);
    this.sfx.click();
  }

  toggleRecord() {
    const r = this.recorder;
    if (!r.active) {
      r.start(this.skater.snapshot());
      this.ring.position.set(this.skater.pos.x, this.world.heightAt(this.skater.pos.x, this.skater.pos.z) + 0.05, this.skater.pos.z);
      this.ring.visible = true;
      this.sfx.rec();
      this.hud.toast('REC — skate your line, then come back to the ring', 'info');
      return;
    }
    if (!r.canClose(this.skater.pos)) {
      this.hud.toast(r.t < 2 ? 'Loop too short — skate a real line!' : 'Get back to the pink ring to close the loop (C cancels)', 'warn');
      return;
    }
    const data = r.finish();
    this.ring.visible = false;
    const g = new Ghost(this.scene, data);
    const res = g.validate(this.world);
    this.ghosts.push(g);
    this.stats.ghostsRecorded++;
    this.sfx.goal();
    this.hud.toast(`${g.name} joined the crew — ${data.duration.toFixed(1)}s loop`);
    if (res.nowBroken) this.hud.toast(`${g.name}'s line clips something — check it in build mode`, 'warn');
    this.saveSoon();
  }

  cancelRecord() {
    if (!this.recorder.active) return;
    this.recorder.cancel();
    this.ring.visible = false;
    this.hud.toast('Recording cancelled', 'warn');
  }

  deleteGhost(id) {
    const i = this.ghosts.findIndex((g) => g.id === id);
    if (i < 0) return;
    this.ghosts[i].dispose();
    this.ghosts.splice(i, 1);
    this.saveSoon();
  }

  validateGhosts() {
    for (const g of this.ghosts) {
      const r = g.validate(this.world);
      if (r.changed && r.nowBroken) this.hud.toast(`${g.name}'s line is broken!`, 'warn');
      else if (r.changed && r.wasBroken) this.hud.toast(`${g.name} is back on the line`);
      if (this.mode === 'build') g.pathLine.visible = true;
    }
  }

  // ---------------- main loop ----------------
  frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    this.time += dt;
    const input = this.input;
    input.poll();

    if (!this.started) {
      if (input.padButtons.some((b) => b)) this.start();
      this.attractCam(dt);
      this.composer.render();
      return;
    }
    if (input.pressed('menu')) this.toggleMenu();
    if (this.paused) { this.composer.render(); return; }

    if (input.pressed('mode')) this.setMode(this.mode === 'skate' ? 'build' : 'skate');

    if (this.mode === 'skate') {
      if (input.pressed('record')) this.toggleRecord();
      if (input.pressed('cancel')) this.cancelRecord();
      if (input.pressed('respawn')) { this.cancelRecord(); this.skater.respawn(); }
      this.skater.update(dt, input);
      if (this.recorder.active) {
        this.recorder.update(dt, this.skater.snapshot());
        if (this.recorder.tooLong) { this.cancelRecord(); this.hud.toast('Loop too long (max 2 min)', 'warn'); }
      }
      const snap = this.skater.snapshot();
      this.actor.interact(this.world, snap.x, snap.y, snap.z, (snap.flags & FLAG.grinding) !== 0, this.stats, this.fx);
      if (this.skater.mode === 'grind') this.fx.sparks(snap.x, snap.y + 0.05, snap.z, 0xffd23b, 2, 3.5);
    } else {
      this.build.update(dt, input);
    }

    // world + ghosts keep running in both modes (the factory never stops)
    this.stats.now = this.time;
    this.world.update(dt, this.stats, this.fx);
    for (const g of this.ghosts) {
      g.update(dt, this.world, this.stats, this.fx, this.time);
      if (g.broken < 0 && g.model.root.visible && g.sample(g.t).flags & FLAG.grinding && Math.random() < 0.5) {
        const p = g.model.root.position;
        this.fx.sparks(p.x, p.y + 0.05, p.z, g.color, 1, 3);
      }
    }
    this.stats.maxGhosts = Math.max(this.stats.maxGhosts, this.ghosts.filter((g) => g.broken < 0).length);
    if (this.validateTimer >= 0) { this.validateTimer -= dt; if (this.validateTimer < 0) this.validateGhosts(); }
    this.fx.update(dt);

    // player model
    const s = this.skater.snapshot();
    this.model.root.position.set(s.x, s.y, s.z);
    this.model.root.rotation.y = s.yaw;
    applyPose(this.model, s.pose, s.p1, s.p2, s.boardYaw, this.time, dt);
    updateCargo(this.model, this.actor.bag, this.time);
    if (this.ring.visible) { this.ring.children[0].scale.setScalar(1 + Math.sin(this.time * 6) * 0.08); this.ring.rotation.y += dt; }

    // audio loops
    const sk = this.skater;
    this.sfx.setLoops(this.mode === 'skate' && sk.mode === 'ground' ? Math.min(1, sk.speed / 15) : 0, this.mode === 'skate' && sk.mode === 'grind' ? 1 : 0);

    this.updateCamera(dt);
    this.updateGoals(dt);
    this.hud.update({ skater: sk, stats: this.stats, actor: this.actor, recorder: this.recorder, mode: this.mode, dt, device: input.lastDevice });
    this.hud.hints(this.mode, input.lastDevice, { recording: this.recorder.active });
    if (this.mode === 'build') this.hud.ghostPanel(this.ghosts, { del: (id) => this.deleteGhost(id), focus: (id) => this.focusGhost(id) });
    if (input.lastDevice !== this._lastDev) { this._lastDev = input.lastDevice; this.hud.setMode(this.mode, input.lastDevice); }

    this.autosaveT = (this.autosaveT ?? 0) + dt;
    if (this.autosaveT > 15 || (this.saveAt && this.time > this.saveAt)) { this.save(); this.autosaveT = 0; this.saveAt = 0; }

    this.composer.render();
  }

  focusGhost(id) {
    const g = this.ghosts.find((x) => x.id === id);
    if (g) this.build.target.set(g.model.root.position.x, 0, g.model.root.position.z);
  }

  updateCamera(dt) {
    const sk = this.skater;
    // skate chase cam
    const followRate = sk.mode === 'air' ? (sk.vert ? 0.4 : 1.6) : sk.mode === 'grind' ? 4 : 3.2;
    let d = sk.heading - this.camYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (sk.speed > 0.5 || sk.mode !== 'ground') this.camYaw += d * Math.min(1, dt * followRate);
    const dist = 7.2 + Math.min(4, sk.speed * 0.12);
    const height = 3.2 + (sk.mode === 'air' ? 0.6 : 0);
    const sp = new THREE.Vector3(sk.pos.x - Math.sin(this.camYaw) * dist, sk.pos.y + height, sk.pos.z - Math.cos(this.camYaw) * dist);
    // keep the camera inside the yard walls and above terrain
    const lim = (v, h) => Math.max(-h + 0.8, Math.min(h - 0.8, v));
    const cx = lim(sp.x, HALF_W), cz = lim(sp.z, HALF_H);
    if (cx !== sp.x || cz !== sp.z) sp.y += Math.min(3, Math.hypot(cx - sp.x, cz - sp.z) * 0.6);
    sp.x = cx; sp.z = cz;
    const gh = this.world.heightAt(sp.x, sp.z);
    if (gh < 50) sp.y = Math.max(sp.y, gh + 1.2);
    const sl = new THREE.Vector3(sk.pos.x + Math.sin(this.camYaw) * 3, sk.pos.y + 1.3, sk.pos.z + Math.cos(this.camYaw) * 3);

    const target = this.mode === 'build' ? 1 : 0;
    this.modeBlend += (target - this.modeBlend) * Math.min(1, dt * 5);
    const e = this.modeBlend;
    let pos = sp, look = sl;
    if (e > 0.001) {
      const bp = this.build.cameraPose();
      pos = sp.clone().lerp(bp.pos, e);
      look = sl.clone().lerp(bp.look, e);
    }
    if (!this._camInit) { this.camPos.copy(pos); this.camLook.copy(look); this._camInit = true; }
    const k = this.mode === 'build' || e > 0.02 ? 1 : Math.min(1, dt * 10);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const fov = (62 + Math.min(14, sk.speed * 0.55)) * (1 - e) + 40 * e;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4); this.camera.updateProjectionMatrix(); }
  }

  attractCam(dt) {
    const a = this.time * 0.08;
    this.camera.position.set(Math.sin(a) * 60, 32, Math.cos(a) * 60);
    this.camera.lookAt(0, 0, 0);
    this.world.update(dt, this.stats, null);
    for (const g of this.ghosts) g.update(dt, this.world, this.stats, null, this.time);
    this.fx.update(dt);
    const s = this.skater.snapshot();
    this.model.root.position.set(s.x, s.y, s.z);
    this.model.root.rotation.y = s.yaw;
    applyPose(this.model, s.pose, s.p1, s.p2, s.boardYaw, this.time, dt);
  }

  updateGoals(dt) {
    this.goalT = (this.goalT ?? 0) + dt;
    if (this.goalT < 0.4) return;
    this.goalT = 0;
    let changed = false;
    for (const g of GOALS) {
      if (!this.goalsDone.has(g.id) && g.check(this.stats)) {
        this.goalsDone.add(g.id);
        changed = true;
        this.hud.toast(`GOAL ✓ ${g.text.split(' — ')[0]}`);
        this.sfx.goal();
      }
    }
    if (changed) { this.hud.goals(this.goalsDone); this.saveSoon(); }
  }

  // ---------------- UI ----------------
  start() {
    if (this.started) return;
    this.started = true;
    this.sfx.init();
    document.getElementById('title').classList.add('hidden');
    this.hud.show();
    this.clock.getDelta();
    this._camInit = false;
  }

  setupMenus() {
    document.getElementById('start-btn').addEventListener('click', () => this.start());
    document.getElementById('title').addEventListener('click', (e) => { if (e.target.id === 'title') this.start(); });
    const menu = document.getElementById('menu');
    menu.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (!act) return;
      if (act === 'resume') this.toggleMenu(false);
      if (act === 'sfx') { this.sfx.enabled = !this.sfx.enabled; e.target.textContent = `SOUND: ${this.sfx.enabled ? 'ON' : 'OFF'}`; }
      if (act === 'ghostpops') { this.fx.ghostPopsEnabled = !this.fx.ghostPopsEnabled; e.target.textContent = `GHOST POPUPS: ${this.fx.ghostPopsEnabled ? 'ON' : 'OFF'}`; }
      if (act === 'controls') { this.toggleMenu(false); this.started = false; document.getElementById('title').classList.remove('hidden'); document.getElementById('start-btn').textContent = 'BACK TO IT'; }
      if (act === 'reset') {
        if (confirm('Reset the yard? This deletes all your pieces and ghosts.')) {
          localStorage.removeItem(SAVE_KEY);
          this.recorder.cancel(); this.ring.visible = false;
          this.stats.reset(); this.goalsDone.clear(); this.skater.score = 0;
          this.actor.bag.length = 0; this.actor.resetTally();
          this.seed(); this.hud.goals(this.goalsDone);
          this.toggleMenu(false);
        }
      }
    });
  }

  toggleMenu(force) {
    this.paused = force ?? !this.paused;
    document.getElementById('menu').classList.toggle('hidden', !this.paused);
    this.sfx.setLoops(0, 0);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- persistence ----------------
  saveSoon() { this.saveAt = this.time + 1.0; }

  save() {
    try {
      const data = {
        v: 1,
        world: this.world.serialize(),
        ghosts: this.ghosts.map((g) => g.serialize()),
        stats: this.stats.serialize(),
        goals: [...this.goalsDone],
        score: this.skater.score,
        player: { x: this.skater.pos.x, z: this.skater.pos.z, heading: this.skater.heading },
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('save failed', err);
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      this.world.load(d.world);
      for (const gd of d.ghosts) {
        const g = new Ghost(this.scene, { frames: f32FromB64(gd.frames), events: gd.events, duration: gd.duration }, { id: gd.id, name: gd.name, color: gd.color });
        g.validate(this.world);
        this.ghosts.push(g);
      }
      this.stats.load(d.stats);
      this.goalsDone = new Set(d.goals);
      this.skater.score = d.score || 0;
      const sp = this.world.cellCenter(3, 9);
      this.skater.spawn(sp.x, sp.z, Math.PI / 2);
      if (d.player && this.world.heightAt(d.player.x, d.player.z) < 0.5) {
        this.skater.pos.set(d.player.x, this.world.heightAt(d.player.x, d.player.z), d.player.z);
        this.skater.heading = this.skater.bodyYaw = d.player.heading;
      }
      this.camYaw = this.skater.heading;
      return true;
    } catch (err) {
      console.warn('load failed, starting fresh', err);
      return false;
    }
  }
}

window.game = new Game();
void CELL; void GRID_W; void GRID_H;
