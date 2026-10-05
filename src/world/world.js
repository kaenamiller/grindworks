// The yard: grid occupancy, pieces, terrain height queries, rail graph, machines.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, GRID_W, GRID_H, HALF_W, HALF_H, RAIL_Y, PAL, ITEMS, FLAVORS } from '../config.js';
import { PIECES, buildPieceMesh } from './pieces.js';
import { toon, addOutlines } from '../render/toon.js';
import { LabelSprite, roundRect } from '../render/labels.js';
import { createMachineState, machineUpdate } from '../game/machines.js';
import { FRAME_SIZE, F, FLAG } from '../game/frame.js';

const WALL_H = 99;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.pieces = new Map();
    this.occ = new Map();     // cell index -> piece id
    this.ore = new Set();     // cell indices
    this.nextId = 1;
    this.listeners = [];
    this.root = new THREE.Group();
    scene.add(this.root);
    this.railGroup = new THREE.Group();
    this.root.add(this.railGroup);
    this.oreGroup = new THREE.Group();
    this.root.add(this.oreGroup);
    this.graph = { nodes: [], edges: [] };
    this.machinePieces = [];
    this._dirtyRails = true;
    this.time = 0;
  }

  onChange(fn) { this.listeners.push(fn); }
  emitChange() { for (const f of this.listeners) f(); }

  // ---------- grid ----------
  idx(i, j) { return i + j * GRID_W; }
  inGrid(i, j) { return i >= 0 && j >= 0 && i < GRID_W && j < GRID_H; }
  cellCenter(i, j) { return { x: -HALF_W + (i + 0.5) * CELL, z: -HALF_H + (j + 0.5) * CELL }; }
  cellOf(x, z) { return { i: Math.floor((x + HALF_W) / CELL), j: Math.floor((z + HALF_H) / CELL) }; }
  cellIndexAt(x, z) {
    const { i, j } = this.cellOf(x, z);
    return this.inGrid(i, j) ? this.idx(i, j) : -1;
  }
  railAtCell(c) { const id = this.occ.get(c); return id !== undefined && this.pieces.get(id).type === 'rail'; }

  // ---------- piece transforms ----------
  dims(type, rot) {
    const d = PIECES[type];
    return rot % 2 === 0 ? { W: d.fw, D: d.fd } : { W: d.fd, D: d.fw };
  }
  footprint(type, i, j, rot) {
    const { W, D } = this.dims(type, rot);
    const cells = [];
    for (let a = 0; a < W; a++) for (let b = 0; b < D; b++) cells.push({ i: i + a, j: j + b });
    return cells;
  }
  pieceCenter(type, i, j, rot) {
    const { W, D } = this.dims(type, rot);
    return { x: -HALF_W + (i + W / 2) * CELL, z: -HALF_H + (j + D / 2) * CELL };
  }
  /** world -> piece local (u,v) */
  toLocal(p, x, z) {
    const def = PIECES[p.type];
    const phi = (p.rot * Math.PI) / 2;
    const c = Math.cos(phi), s = Math.sin(phi);
    const dx = x - p.cx, dz = z - p.cz;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return { u: lx + (def.fw * CELL) / 2, v: lz + (def.fd * CELL) / 2 };
  }
  toWorld(p, u, v) {
    const def = PIECES[p.type];
    const phi = (p.rot * Math.PI) / 2;
    const c = Math.cos(phi), s = Math.sin(phi);
    const lx = u - (def.fw * CELL) / 2, lz = v - (def.fd * CELL) / 2;
    return { x: p.cx + lx * c + lz * s, z: p.cz - lx * s + lz * c };
  }

  canPlace(type, i, j, rot) {
    for (const c of this.footprint(type, i, j, rot)) {
      if (!this.inGrid(c.i, c.j)) return false;
      if (this.occ.has(this.idx(c.i, c.j))) return false;
    }
    return true;
  }

  place(type, i, j, rot = 0, opts = {}) {
    if (!this.canPlace(type, i, j, rot)) return null;
    const def = PIECES[type];
    const id = opts.id ?? this.nextId++;
    this.nextId = Math.max(this.nextId, id + 1);
    const { x: cx, z: cz } = this.pieceCenter(type, i, j, rot);
    const p = { id, type, i, j, rot, cx, cz, def, links: new Set(), axis: opts.axis ?? (rot % 2 === 0 ? 'z' : 'x') };
    for (const c of this.footprint(type, i, j, rot)) this.occ.set(this.idx(c.i, c.j), id);
    this.pieces.set(id, p);
    if (type !== 'rail') {
      p.mesh = buildPieceMesh(type);
      p.mesh.position.set(cx, 0, cz);
      p.mesh.rotation.y = (rot * Math.PI) / 2;
      p.mesh.userData.pieceId = id;
      this.root.add(p.mesh);
      if (def.machine) {
        p.machine = opts.machine ?? createMachineState(def.machine);
        if (def.machine !== 'ship') {
          p.label = new LabelSprite(256, 150, 3.4);
          p.label.sprite.position.set(cx, 6.4, cz);
          this.root.add(p.label.sprite);
        }
        this.machinePieces.push(p);
      }
    } else {
      this._dirtyRails = true;
    }
    if (!opts.silent) this.emitChange();
    return p;
  }

  /** Lay a path of rail cells (from a drag), linking consecutive cells. */
  placeRailPath(cells) {
    let prev = null, placed = 0;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (!this.inGrid(c.i, c.j)) { prev = null; continue; }
      const ci = this.idx(c.i, c.j);
      let p = null;
      const existing = this.occ.get(ci);
      if (existing !== undefined) {
        const ep = this.pieces.get(existing);
        if (ep.type === 'rail') p = ep;
      } else {
        const next = cells[k + 1] ?? cells[k - 1];
        const axis = next ? (next.i !== c.i ? 'x' : 'z') : c.axis ?? 'z';
        p = this.place('rail', c.i, c.j, axis === 'x' ? 1 : 0, { axis, silent: true });
        placed++;
      }
      if (p && prev) this.linkRails(prev, p);
      prev = p;
    }
    // auto-join path ends to existing open rail ends that line up
    if (cells.length) {
      for (const end of [cells[0], cells[cells.length - 1]]) {
        const p = this.pieceAtCell(end.i, end.j);
        if (!p || p.type !== 'rail' || p.links.size >= 2) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const q = this.pieceAtCell(end.i + di, end.j + dj);
          if (!q || q.type !== 'rail' || q === p || p.links.has(q.id)) continue;
          if (q.links.size >= 2) continue;
          const alongP = (di !== 0 ? 'x' : 'z') === p.axis;
          const alongQ = (di !== 0 ? 'x' : 'z') === q.axis;
          if ((alongP || p.links.size === 0) && (alongQ || q.links.size === 0)) { this.linkRails(p, q); break; }
        }
      }
    }
    this._dirtyRails = true;
    this.emitChange();
    return placed;
  }

  linkRails(a, b) {
    if (a === b) return;
    if (Math.abs(a.i - b.i) + Math.abs(a.j - b.j) !== 1) return;
    a.links.add(b.id); b.links.add(a.id);
  }

  pieceAtCell(i, j) {
    if (!this.inGrid(i, j)) return null;
    const id = this.occ.get(this.idx(i, j));
    return id === undefined ? null : this.pieces.get(id);
  }
  pieceAt(x, z) { const { i, j } = this.cellOf(x, z); return this.pieceAtCell(i, j); }

  remove(id, silent = false) {
    const p = this.pieces.get(id);
    if (!p) return;
    for (const c of this.footprint(p.type, p.i, p.j, p.rot)) this.occ.delete(this.idx(c.i, c.j));
    if (p.type === 'rail') {
      for (const lid of p.links) this.pieces.get(lid)?.links.delete(id);
      this._dirtyRails = true;
    }
    if (p.mesh) { this.root.remove(p.mesh); disposeTree(p.mesh); }
    if (p.label) { this.root.remove(p.label.sprite); p.label.tex.dispose(); }
    this.machinePieces = this.machinePieces.filter((m) => m !== p);
    this.pieces.delete(id);
    if (!silent) this.emitChange();
  }

  clear() {
    for (const id of [...this.pieces.keys()]) this.remove(id, true);
    this.nextId = 1;
    this._dirtyRails = true;
    this.emitChange();
  }

  // ---------- terrain ----------
  heightAt(x, z) {
    if (x < -HALF_W || x > HALF_W || z < -HALF_H || z > HALF_H) return WALL_H;
    const p = this.pieceAt(x, z);
    if (!p || p.type === 'rail') return 0;
    const { u, v } = this.toLocal(p, x, z);
    return p.def.height(u, v);
  }

  /** Height with an extra hypothetical piece (for placement previews). */
  heightAtWith(x, z, cand) {
    if (cand) {
      const { i, j } = this.cellOf(x, z);
      const { W, D } = this.dims(cand.type, cand.rot);
      if (i >= cand.i && i < cand.i + W && j >= cand.j && j < cand.j + D) {
        if (cand.type === 'rail') return 0;
        const { u, v } = this.toLocal(cand, x, z);
        return PIECES[cand.type].height(u, v);
      }
    }
    return this.heightAt(x, z);
  }

  machinesAt(x, y, z) {
    const out = [];
    const p = this.pieceAt(x, z);
    // zones can poke slightly out of the footprint (gates), so also test neighbors via machine list when near
    const cand = p && p.machine ? [p] : [];
    for (const m of this.machinePieces) {
      if (m === p) continue;
      if (Math.abs(m.cx - x) < 6 && Math.abs(m.cz - z) < 6) cand.push(m);
    }
    for (const m of cand) {
      const zn = m.def.zone;
      const { u, v } = this.toLocal(m, x, z);
      if (u >= zn.u0 && u <= zn.u1 && v >= zn.v0 && v <= zn.v1 && y >= zn.y0 && y <= zn.y1) out.push(m);
    }
    return out;
  }

  // ---------- rail graph ----------
  rebuildGraph() {
    const nodes = [], edges = [];
    const centerNode = new Map();
    const addNode = (x, y, z, isEnd, cell) => { nodes.push({ p: new THREE.Vector3(x, y, z), edges: [], isEnd, cell }); return nodes.length - 1; };
    const addEdge = (a, b, kind, piece) => {
      const e = { a, b, kind, piece, len: nodes[a].p.distanceTo(nodes[b].p) };
      edges.push(e);
      nodes[a].edges.push(edges.length - 1);
      nodes[b].edges.push(edges.length - 1);
    };
    const rails = [...this.pieces.values()].filter((p) => p.type === 'rail');
    for (const r of rails) {
      const c = this.cellCenter(r.i, r.j);
      centerNode.set(r.id, addNode(c.x, RAIL_Y, c.z, false, this.idx(r.i, r.j)));
    }
    for (const r of rails) {
      const a = centerNode.get(r.id);
      for (const lid of r.links) if (lid > r.id) addEdge(a, centerNode.get(lid), 'rail', r);
      // stubs to the cell edge where the rail is open
      const linkDirs = [...r.links].map((lid) => { const q = this.pieces.get(lid); return [q.i - r.i, q.j - r.j]; });
      let stubDirs = [];
      if (linkDirs.length === 0) stubDirs = r.axis === 'x' ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
      else if (linkDirs.length === 1) stubDirs = [[-linkDirs[0][0], -linkDirs[0][1]]];
      const c = this.cellCenter(r.i, r.j);
      for (const [di, dj] of stubDirs) {
        const e = addNode(c.x + di * CELL * 0.5, RAIL_Y, c.z + dj * CELL * 0.5, true, this.idx(r.i, r.j));
        addEdge(a, e, 'rail', r);
      }
    }
    // ledges
    for (const p of this.pieces.values()) {
      if (!p.def.grind) continue;
      for (const g of p.def.grind) {
        const w0 = this.toWorld(p, g.u0, g.v0), w1 = this.toWorld(p, g.u1, g.v1);
        const a = addNode(w0.x, g.y, w0.z, true, -1), b = addNode(w1.x, g.y, w1.z, true, -1);
        addEdge(a, b, 'ledge', p);
      }
    }
    this.graph = { nodes, edges };
    this.buildRailMesh(rails, edges, nodes);
    this._dirtyRails = false;
  }

  ensureGraph() { if (this._dirtyRails) this.rebuildGraph(); }

  /** Nearest point on any grindable edge. */
  nearestGrind(x, y, z, maxH = 1.4, yBelow = 1.4, yAbove = 2.6) {
    this.ensureGraph();
    const { nodes, edges } = this.graph;
    let best = null;
    for (let k = 0; k < edges.length; k++) {
      const e = edges[k];
      const A = nodes[e.a].p, B = nodes[e.b].p;
      const abx = B.x - A.x, abz = B.z - A.z;
      const L2 = abx * abx + abz * abz;
      let t = L2 > 0 ? ((x - A.x) * abx + (z - A.z) * abz) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = A.x + abx * t, pz = A.z + abz * t, py = A.y + (B.y - A.y) * t;
      const dh = Math.hypot(x - px, z - pz);
      if (dh > maxH) continue;
      const dy = y - py;
      if (dy < -yBelow || dy > yAbove) continue;
      const score = dh + Math.abs(dy) * 0.3;
      if (!best || score < best.score) best = { edge: k, t, x: px, y: py, z: pz, dist: dh, dy, score };
    }
    return best;
  }

  // ---------- visuals ----------
  buildRailMesh(rails, edges, nodes) {
    for (const ch of [...this.railGroup.children]) { this.railGroup.remove(ch); disposeTree(ch); }
    if (!rails.length) return;
    const geos = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const e of edges) {
      if (e.kind !== 'rail') continue;
      const A = nodes[e.a].p, B = nodes[e.b].p;
      const len = A.distanceTo(B);
      const g = new THREE.CylinderGeometry(0.1, 0.1, len + 0.08, 8, 1);
      const dir = new THREE.Vector3().subVectors(B, A).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      g.applyQuaternion(q);
      g.translate((A.x + B.x) / 2, RAIL_Y, (A.z + B.z) / 2);
      geos.push(g);
    }
    const postGeos = [];
    for (const r of rails) {
      const c = this.cellCenter(r.i, r.j);
      const g = new THREE.CylinderGeometry(0.06, 0.06, RAIL_Y, 6);
      g.translate(c.x, RAIL_Y / 2, c.z);
      postGeos.push(g);
      const b = new THREE.BoxGeometry(0.4, 0.06, 0.4);
      b.translate(c.x, 0.03, c.z);
      postGeos.push(b);
    }
    const railMesh = new THREE.Mesh(mergeGeometries(geos), toon(PAL.yellow, { emissive: PAL.yellow, emissiveIntensity: 0.15 }));
    railMesh.castShadow = true;
    const postMesh = new THREE.Mesh(mergeGeometries(postGeos), toon(0x5a2d8a));
    postMesh.castShadow = true;
    const g = new THREE.Group();
    g.add(railMesh, postMesh);
    addOutlines(g, 0.035);
    this.railGroup.add(g);
  }

  buildOreVisuals() {
    for (const ch of [...this.oreGroup.children]) { this.oreGroup.remove(ch); disposeTree(ch); }
    const crystalGeo = new THREE.OctahedronGeometry(0.22, 0);
    const n = this.ore.size * 3;
    const crystals = new THREE.InstancedMesh(crystalGeo, toon(0xff3bd0, { emissive: 0xff3bd0, emissiveIntensity: 0.55 }), n);
    const decalGeo = new THREE.PlaneGeometry(CELL * 0.98, CELL * 0.98);
    const decals = new THREE.InstancedMesh(decalGeo, new THREE.MeshBasicMaterial({ color: 0x8a1a8a, transparent: true, opacity: 0.55, depthWrite: false }), this.ore.size);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    let k = 0, d = 0;
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const ci of this.ore) {
      const i = ci % GRID_W, j = Math.floor(ci / GRID_W);
      const c = this.cellCenter(i, j);
      m.compose(pos.set(c.x, 0.012, c.z), q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), s.set(1, 1, 1));
      decals.setMatrixAt(d++, m);
      for (let a = 0; a < 3; a++) {
        const ang = rnd() * Math.PI * 2, rr = 0.35 + rnd() * 0.45;
        const sc = 0.7 + rnd() * 0.9;
        m.compose(
          pos.set(c.x + Math.cos(ang) * rr, 0.15 * sc, c.z + Math.sin(ang) * rr),
          q.setFromEuler(new THREE.Euler(rnd() * 0.5, rnd() * 3, rnd() * 0.5)),
          s.set(sc * 0.8, sc * 1.5, sc * 0.8),
        );
        crystals.setMatrixAt(k++, m);
      }
    }
    crystals.castShadow = true;
    this.oreGroup.add(decals, crystals);
  }

  update(dt, stats, fx) {
    this.time += dt;
    this.ensureGraph();
    for (const p of this.machinePieces) {
      const m = p.machine;
      if (machineUpdate(m, dt, stats)) fx?.craftBurst(p);
      // animate
      if (p.mesh) {
        const ring = p.mesh.getObjectByName('ring');
        if (ring) ring.rotation.z += dt * (m.busy ? 6 : 0.6);
        const ring2 = p.mesh.getObjectByName('ring2');
        if (ring2) { ring2.rotation.y += dt * (m.busy ? 7 : 0.8); ring2.rotation.x += dt * (m.busy ? 3 : 0.2); }
        const film = p.mesh.getObjectByName('film');
        if (film) film.material.opacity = 0.12 + (m.busy ? 0.12 + 0.08 * Math.sin(this.time * 14) : 0) + (m.pulse ?? 0) * 0.3;
        const piston = p.mesh.getObjectByName('piston');
        if (piston) piston.position.y = m.busy ? 1.2 + Math.abs(Math.sin(this.time * 7)) * 2.2 : 3.2;
      }
      if (p.label) this.drawLabel(p);
    }
  }

  drawLabel(p) {
    const m = p.machine;
    const r = m.recipe;
    const key = `${m.inBuf}|${m.outBuf}|${Object.values(m.energy).map((e) => e.toFixed(0)).join(',')}|${m.busy ? Math.floor(m.progress * 12) : -1}`;
    p.label.draw(key, (g, w, h) => {
      g.fillStyle = 'rgba(20,6,31,0.82)';
      roundRect(g, 4, 4, w - 8, h - 8, 18); g.fill();
      g.strokeStyle = PIECES[p.type].color; g.lineWidth = 5;
      roundRect(g, 4, 4, w - 8, h - 8, 18); g.stroke();
      g.font = '900 24px "Bungee", Impact, sans-serif';
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = ITEMS[r.input].css;
      g.fillText(`${r.input.toUpperCase()} ${m.inBuf}`, 18, 34, w / 2 - 34);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText('→', w / 2 + 6, 34);
      g.textAlign = 'right';
      g.fillStyle = ITEMS[r.output].css;
      g.fillText(`${m.outBuf} ${r.output.toUpperCase()}`, w - 18, 34, w / 2 - 34);
      // energy bars
      const fl = Object.entries(r.energy);
      const bw = (w - 40) / fl.length;
      fl.forEach(([f, need], k) => {
        const x = 20 + k * bw;
        g.fillStyle = 'rgba(255,255,255,0.12)';
        roundRect(g, x, 66, bw - 10, 26, 10); g.fill();
        const frac = Math.min(1, m.energy[f] / (need * 4));
        g.fillStyle = FLAVORS[f].color;
        roundRect(g, x, 66, Math.max(12, (bw - 10) * frac), 26, 10); g.fill();
        g.font = '900 18px "Bungee", Impact, sans-serif';
        g.textAlign = 'center';
        g.fillStyle = '#14061f';
        g.fillText(`${FLAVORS[f].label} ${m.energy[f].toFixed(0)}/${need}`, x + (bw - 10) / 2, 80, bw - 22);
      });
      // progress
      g.fillStyle = 'rgba(255,255,255,0.15)';
      roundRect(g, 20, 106, w - 40, 22, 10); g.fill();
      if (m.busy) {
        g.fillStyle = '#ffe23b';
        roundRect(g, 20, 106, Math.max(14, (w - 40) * m.progress), 22, 10); g.fill();
      }
    });
  }

  // ---------- ghost line validation ----------
  /** Returns index of first frame that no longer fits the world, or -1 if the whole line is skateable. */
  validateFrames(frames, cand = null) {
    const n = frames.length / FRAME_SIZE;
    for (let k = 0; k < n; k += 2) {
      const o = k * FRAME_SIZE;
      const flags = frames[o + F.flags];
      if (flags & FLAG.blend) continue;
      const x = frames[o + F.x], y = frames[o + F.y], z = frames[o + F.z];
      if (cand && !this._nearCand(x, z, cand)) continue;
      const h = this.heightAtWith(x, z, cand);
      if (h >= WALL_H) return k;
      if (flags & FLAG.grinding) {
        if (cand) continue;
        const g = this.nearestGrind(x, y, z, 0.8, 0.6, 0.6);
        if (!g) return k;
      } else if (flags & FLAG.airborne) {
        if (h > y + 0.45) return k;
      } else if (Math.abs(h - y) > 0.4) {
        return k;
      }
    }
    return -1;
  }

  _nearCand(x, z, cand) {
    const { W, D } = this.dims(cand.type, cand.rot);
    const x0 = -HALF_W + cand.i * CELL, z0 = -HALF_H + cand.j * CELL;
    return x >= x0 - 0.1 && x <= x0 + W * CELL + 0.1 && z >= z0 - 0.1 && z <= z0 + D * CELL + 0.1;
  }

  // ---------- persistence ----------
  serialize() {
    return {
      ore: [...this.ore],
      pieces: [...this.pieces.values()].map((p) => ({
        id: p.id, type: p.type, i: p.i, j: p.j, rot: p.rot, axis: p.axis, links: [...p.links],
        machine: p.machine ? JSON.parse(JSON.stringify({ ...p.machine, recipe: undefined })) : undefined,
      })),
    };
  }

  load(data) {
    this.clear();
    this.ore = new Set(data.ore);
    this.buildOreVisuals();
    for (const s of data.pieces) {
      let machine;
      if (s.machine) {
        machine = createMachineState(s.machine.kind);
        Object.assign(machine, s.machine);
        if (machine.kind !== 'ship') machine.recipe = createMachineState(s.machine.kind).recipe;
      }
      const p = this.place(s.type, s.i, s.j, s.rot, { id: s.id, axis: s.axis, machine, silent: true });
      if (p) p._links = s.links;
    }
    for (const p of this.pieces.values()) {
      if (p._links) { for (const l of p._links) if (this.pieces.has(l)) p.links.add(l); delete p._links; }
    }
    this._dirtyRails = true;
    this.emitChange();
  }
}

export function disposeTree(o) {
  o.traverse((c) => {
    if (c.isMesh && !c.userData.isOutline) c.geometry?.dispose?.();
  });
}
