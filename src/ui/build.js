// Build mode: Factorio / Dyson Sphere Program style top-down placement with mouse (or gamepad cursor).
import * as THREE from 'three';
import { CELL, GRID_W, GRID_H, HALF_W, HALF_H, PAL, ITEMS, FLAVORS } from '../config.js';
import { PIECES, PIECE_ORDER, buildPieceMesh } from '../world/pieces.js';
import { machineStatus } from '../game/machines.js';

const TOOLS = [...PIECE_ORDER, 'delete'];

export class BuildController {
  constructor(game) {
    this.g = game;
    this.tool = 'rail';
    this.rot = 1;
    this.target = new THREE.Vector3();
    this.dist = 52;
    this.yaw = 0;
    this.yawTarget = 0;
    this.pitch = 0.98;
    this.mouse = new THREE.Vector2();
    this.client = { x: 0, y: 0 };
    this.hover = null;
    this.dragStart = null;
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.active = false;
    this.padCursor = null;
    this.previewCache = new Map();

    const scene = game.scene;
    this.previewRoot = new THREE.Group();
    scene.add(this.previewRoot);
    // cursor square
    const sq = new THREE.EdgesGeometry(new THREE.PlaneGeometry(CELL, CELL));
    this.cursor = new THREE.LineSegments(sq, new THREE.LineBasicMaterial({ color: PAL.yellow, toneMapped: false }));
    this.cursor.rotation.x = -Math.PI / 2;
    this.previewRoot.add(this.cursor);
    // footprint fill
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }));
    this.fill.rotation.x = -Math.PI / 2;
    this.fill.position.y = 0.03;
    this.previewRoot.add(this.fill);
    // rail drag preview pool
    this.railPrev = [];
    this.railPrevMat = new THREE.MeshBasicMaterial({ color: PAL.yellow, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });
    // grid overlay
    const gridGeo = new THREE.BufferGeometry();
    const gp = [];
    for (let i = 0; i <= GRID_W; i++) gp.push(-HALF_W + i * CELL, 0.02, -HALF_H, -HALF_W + i * CELL, 0.02, HALF_H);
    for (let j = 0; j <= GRID_H; j++) gp.push(-HALF_W, 0.02, -HALF_H + j * CELL, HALF_W, 0.02, -HALF_H + j * CELL);
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    this.grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: PAL.cyan, transparent: true, opacity: 0.18, toneMapped: false }));
    scene.add(this.grid);
    this.previewRoot.visible = false;
    this.grid.visible = false;

    const dom = game.renderer.domElement;
    dom.addEventListener('pointermove', (e) => this.onMove(e));
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('wheel', (e) => { if (this.active) { this.dist = THREE.MathUtils.clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.1), 14, 110); } }, { passive: true });
  }

  enter(focus) {
    this.active = true;
    this.target.set(focus.x, 0, focus.z);
    this.yaw = this.yawTarget = Math.round(this.g.camYaw / (Math.PI / 2)) * (Math.PI / 2);
    this.previewRoot.visible = true;
    this.grid.visible = true;
    this.padCursor = null;
    for (const gh of this.g.ghosts) gh.pathLine.visible = true;
    this.refreshHotbar();
  }

  exit() {
    this.active = false;
    this.dragStart = null;
    this.previewRoot.visible = false;
    this.grid.visible = false;
    for (const gh of this.g.ghosts) gh.pathLine.visible = false;
    this.clearRailPreview();
    this.g.hud.tooltip(null);
  }

  refreshHotbar() { this.g.hud.hotbar(this.tool, (t) => this.pick(t)); }
  pick(t) { this.tool = t; this.g.sfx.click(); this.refreshHotbar(); }

  cameraPose() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const pos = new THREE.Vector3(
      this.target.x - Math.sin(this.yaw) * cp * this.dist,
      sp * this.dist,
      this.target.z - Math.cos(this.yaw) * cp * this.dist,
    );
    return { pos, look: this.target.clone() };
  }

  onMove(e) {
    this.client.x = e.clientX; this.client.y = e.clientY;
    const r = this.g.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.padCursor = null;
    if (this.active && e.buttons & 4) {
      // middle-drag pan (grab the ground)
      const k = this.dist * 0.0022;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const rx = -fz, rz = fx;
      this.target.x += (-rx * e.movementX + fx * e.movementY) * k;
      this.target.z += (-rz * e.movementX + fz * e.movementY) * k;
    }
  }

  onDown(e) {
    if (!this.active || !this.hover) return;
    if (e.button === 0) {
      if (this.tool === 'rail') { this.dragStart = { ...this.hover }; }
      else if (this.tool === 'delete') this.deleteAt(this.hover);
      else this.placeAt(this.hover);
    } else if (e.button === 2) {
      this.deleteAt(this.hover);
    }
  }

  onUp(e) {
    if (!this.active) return;
    if (e.button === 0 && this.dragStart && this.hover) this.commitRail();
    this.dragStart = null;
  }

  railPath(a, b) {
    const cells = [];
    const di = Math.sign(b.i - a.i), dj = Math.sign(b.j - a.j);
    const xFirst = Math.abs(b.i - a.i) >= Math.abs(b.j - a.j);
    let i = a.i, j = a.j;
    cells.push({ i, j });
    if (xFirst) {
      while (i !== b.i) { i += di; cells.push({ i, j }); }
      while (j !== b.j) { j += dj; cells.push({ i, j }); }
    } else {
      while (j !== b.j) { j += dj; cells.push({ i, j }); }
      while (i !== b.i) { i += di; cells.push({ i, j }); }
    }
    if (cells.length === 1) cells[0].axis = this.rot % 2 === 0 ? 'z' : 'x';
    return cells;
  }

  commitRail() {
    const w = this.g.world;
    const cells = this.railPath(this.dragStart, this.hover).filter((c) => {
      const p = w.pieceAtCell(c.i, c.j);
      return w.inGrid(c.i, c.j) && (!p || p.type === 'rail');
    });
    if (!cells.length) return;
    const n = w.placeRailPath(cells);
    if (n) this.g.sfx.chime(1);
    this.clearRailPreview();
  }

  anchor(type, cell, rot) {
    const { W, D } = this.g.world.dims(type, rot);
    return { i: cell.i - Math.floor((W - 1) / 2), j: cell.j - Math.floor((D - 1) / 2) };
  }

  placeAt(cell) {
    const w = this.g.world;
    const { i, j } = this.anchor(this.tool, cell, this.rot);
    if (!w.canPlace(this.tool, i, j, this.rot)) { this.g.sfx.bump(); return; }
    const breaks = this.ghostsBrokenBy(this.tool, i, j, this.rot);
    const p = w.place(this.tool, i, j, this.rot);
    if (p) {
      this.g.sfx.chime(2);
      this.g.fx.sparks(p.cx, 1, p.cz, 0x19e6ff, 14, 5);
      if (breaks.length) this.g.hud.toast(`Heads up: that blocks ${breaks.join(', ')}'s line`, 'warn');
    }
  }

  deleteAt(cell) {
    const p = this.g.world.pieceAtCell(cell.i, cell.j);
    if (!p) return;
    this.g.world.remove(p.id);
    this.g.sfx.bump();
  }

  ghostsBrokenBy(type, i, j, rot) {
    if (type === 'rail') return [];
    const w = this.g.world;
    const cand = { type, i, j, rot, ...w.pieceCenter(type, i, j, rot) };
    cand.cx = cand.x; cand.cz = cand.z;
    return this.g.ghosts.filter((gh) => gh.broken < 0 && w.validateFrames(gh.frames, cand) >= 0).map((gh) => gh.name);
  }

  getPreview(type, rot) {
    const key = type;
    let m = this.previewCache.get(key);
    if (!m) {
      m = buildPieceMesh(type);
      const mats = new Map();
      m.traverse((o) => {
        if (o.isMesh || o.isSprite) {
          if (o.userData.isOutline) { o.visible = false; return; }
          const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false });
          if (o.isSprite) { o.visible = false; return; }
          o.material = mat;
          mats.set(o.uuid, mat);
          o.castShadow = false;
        }
      });
      m.userData.mats = [...mats.values()];
      this.previewCache.set(key, m);
    }
    return m;
  }

  clearRailPreview() { for (const r of this.railPrev) r.visible = false; }

  update(dt, input) {
    const w = this.g.world;
    // keyboard camera
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    const pan = this.dist * 0.9 * dt;
    const s = input.stick();
    const usingPad = input.lastDevice === 'gamepad' && input.pad;
    if (!usingPad) {
      this.target.x += (fx * s.y + rx * s.x) * pan;
      this.target.z += (fz * s.y + rz * s.x) * pan;
    }
    if (!usingPad && input.pressed('rotCamL')) this.yawTarget += Math.PI / 2;
    if (!usingPad && input.pressed('rotCamR')) this.yawTarget -= Math.PI / 2;
    this.yaw += (this.yawTarget - this.yaw) * Math.min(1, dt * 8);
    this.target.x = THREE.MathUtils.clamp(this.target.x, -HALF_W - 10, HALF_W + 10);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -HALF_H - 10, HALF_H + 10);

    // tool hotkeys
    for (let k = 0; k < PIECE_ORDER.length; k++) {
      if (input.framePressed.has(`Digit${k + 1}`) || input.framePressed.has(`Numpad${k + 1}`)) this.pick(PIECE_ORDER[k]);
    }
    if (input.framePressed.has('KeyX') || input.framePressed.has('Delete')) this.pick('delete');
    if (input.framePressed.has('KeyR') || (usingPad && input.pressed('rotate'))) { this.rot = (this.rot + 1) % 4; this.g.sfx.click(); }

    // hover cell from mouse or pad cursor
    let hit = null;
    if (usingPad) {
      if (!this.padCursor) this.padCursor = this.target.clone();
      const sp = 22 * dt;
      this.padCursor.x += (fx * s.y + rx * s.x) * sp;
      this.padCursor.z += (fz * s.y + rz * s.x) * sp;
      this.padCursor.x = THREE.MathUtils.clamp(this.padCursor.x, -HALF_W + 0.1, HALF_W - 0.1);
      this.padCursor.z = THREE.MathUtils.clamp(this.padCursor.z, -HALF_H + 0.1, HALF_H - 0.1);
      this.target.lerp(new THREE.Vector3(this.padCursor.x, 0, this.padCursor.z), Math.min(1, dt * 3));
      const rs = input.rightStick();
      this.dist = THREE.MathUtils.clamp(this.dist * (1 - rs.y * dt * 1.2), 14, 110);
      hit = this.padCursor.clone();
      if (input.pressed('rotCamL')) {
        const i = TOOLS.indexOf(this.tool); this.pick(TOOLS[(i - 1 + TOOLS.length) % TOOLS.length]);
      }
      if (input.pressed('rotCamR')) {
        const i = TOOLS.indexOf(this.tool); this.pick(TOOLS[(i + 1) % TOOLS.length]);
      }
    } else {
      this.ray.setFromCamera(this.mouse, this.g.camera);
      const p = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.plane, p)) hit = p;
    }
    this.hover = null;
    if (hit) {
      const c = w.cellOf(hit.x, hit.z);
      if (w.inGrid(c.i, c.j)) this.hover = c;
    }

    // pad place / delete
    if (usingPad && this.hover) {
      if (input.pressed('ollie')) { if (this.tool === 'rail') this.dragStart = { ...this.hover }; else if (this.tool === 'delete') this.deleteAt(this.hover); else this.placeAt(this.hover); }
      if (!input.held('ollie') && this.dragStart) { this.commitRail(); this.dragStart = null; }
      if (input.pressed('grab')) this.deleteAt(this.hover);
    }

    this.updatePreview();
    this.updateTooltip();
  }

  updatePreview() {
    const w = this.g.world;
    for (const m of this.previewCache.values()) m.visible = false;
    this.fill.visible = false;
    this.cursor.visible = !!this.hover;
    this.clearRailPreview();
    if (!this.hover) return;
    const c = w.cellCenter(this.hover.i, this.hover.j);
    this.cursor.position.set(c.x, 0.05, c.z);

    if (this.tool === 'delete') {
      const p = w.pieceAtCell(this.hover.i, this.hover.j);
      if (p) {
        const { W, D } = w.dims(p.type, p.rot);
        this.fill.visible = true;
        this.fill.material.color.set(0xff3030);
        this.fill.scale.set(W * CELL, D * CELL, 1);
        this.fill.position.set(p.cx, 0.04, p.cz);
      }
      return;
    }
    if (this.tool === 'rail') {
      const cells = this.dragStart ? this.railPath(this.dragStart, this.hover) : [this.hover];
      cells.forEach((cc, k) => {
        let m = this.railPrev[k];
        if (!m) { m = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.5, 0.2, CELL * 0.5), this.railPrevMat); this.previewRoot.add(m); this.railPrev[k] = m; }
        const p = w.pieceAtCell(cc.i, cc.j);
        const ok = w.inGrid(cc.i, cc.j) && (!p || p.type === 'rail');
        if (!ok) return;
        const ctr = w.cellCenter(cc.i, cc.j);
        m.visible = true;
        m.position.set(ctr.x, 0.7, ctr.z);
        const next = cells[k + 1] ?? cells[k - 1];
        const axis = next ? (next.i !== cc.i ? 'x' : 'z') : this.rot % 2 === 0 ? 'z' : 'x';
        m.scale.set(axis === 'x' ? 2 : 0.4, 1, axis === 'z' ? 2 : 0.4);
      });
      return;
    }
    const { i, j } = this.anchor(this.tool, this.hover, this.rot);
    const ok = w.canPlace(this.tool, i, j, this.rot);
    const breaks = ok ? this.ghostsBrokenBy(this.tool, i, j, this.rot) : [];
    const col = !ok ? 0xff3030 : breaks.length ? 0xffa020 : 0x00ff88;
    const m = this.getPreview(this.tool, this.rot);
    const ctr = w.pieceCenter(this.tool, i, j, this.rot);
    m.visible = true;
    m.position.set(ctr.x, 0.02, ctr.z);
    m.rotation.y = (this.rot * Math.PI) / 2;
    for (const mat of m.userData.mats) mat.color.set(col);
    if (!m.parent) this.previewRoot.add(m);
    const { W, D } = w.dims(this.tool, this.rot);
    this.fill.visible = true;
    this.fill.material.color.set(col);
    this.fill.scale.set(W * CELL, D * CELL, 1);
    this.fill.position.set(ctr.x, 0.04, ctr.z);
    this._previewBreaks = breaks;
  }

  updateTooltip() {
    const w = this.g.world, hud = this.g.hud;
    if (!this.hover) { hud.tooltip(null); return; }
    const p = w.pieceAtCell(this.hover.i, this.hover.j);
    const ci = w.idx(this.hover.i, this.hover.j);
    let html = null;
    if (p && p.machine && p.machine.kind !== 'ship') {
      const m = p.machine;
      const r = m.recipe;
      html = `<b>${p.def.name}</b><br>${machineStatus(m)}<br>` +
        `<span style="color:${ITEMS[r.input].css}">${r.input.toUpperCase()} in: ${m.inBuf}</span> · <span style="color:${ITEMS[r.output].css}">${r.output.toUpperCase()} ready: ${m.outBuf}</span><br>` +
        Object.entries(r.energy).map(([f, n]) => `<span style="color:${FLAVORS[f].color}">${FLAVORS[f].label} ${m.energy[f].toFixed(1)} (needs ${n}/craft)</span>`).join(' · ') +
        `<br>Made: ${m.made}`;
    } else if (p && p.machine) {
      const sh = p.machine.shipped;
      html = `<b>Ship Ledge</b><br>Grind it to ship your whole bag.<br>Shipped here: ${Object.entries(sh).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing yet'}`;
    } else if (p && p.type === 'rail') {
      html = `<b>Rail</b>${w.ore.has(ci) ? ' <span style="color:#ff3bd0">on ORE seam — mines ore when grinded</span>' : ''}<br>Grinding gives +1 HEAT per cell.`;
    } else if (p) {
      html = `<b>${p.def.name}</b><br>${p.def.blurb}`;
    } else if (w.ore.has(ci)) {
      html = '<b>Ore seam</b><br>Lay rails over it. Grinding those rails mines ORE.';
    }
    if (this.tool !== 'delete' && this.tool !== 'rail' && this._previewBreaks?.length) {
      html = (html ? html + '<br>' : '') + `<span class="warn">⚠ Would block ${this._previewBreaks.join(', ')}'s line</span>`;
    }
    if (this.padCursor) {
      const v = this.padCursor.clone().project(this.g.camera);
      hud.tooltip(html, (v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight);
    } else hud.tooltip(html, this.client.x, this.client.y);
  }
}
