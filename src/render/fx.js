// Juice: floating sticker popups, grind sparks, craft bursts.
import * as THREE from 'three';
import { FLAVORS, ITEMS } from '../config.js';
import { roundRect } from './labels.js';

const texCache = new Map();
function popTexture(text, color) {
  const key = text + color;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 320; c.height = 72;
  const g = c.getContext('2d');
  g.font = '900 40px "Bungee", Impact, sans-serif';
  const w = Math.min(310, g.measureText(text).width + 34);
  g.save();
  g.translate(160, 36);
  g.rotate(-0.05);
  g.fillStyle = '#14061f';
  roundRect(g, -w / 2 + 3, -27, w, 58, 16); g.fill();
  g.fillStyle = color;
  roundRect(g, -w / 2, -30, w, 56, 16); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#14061f';
  g.fillText(text, 0, 0, w - 20);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (texCache.size > 200) texCache.clear();
  texCache.set(key, t);
  return t;
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.pops = [];
    this.ghostPopsEnabled = true;
    // spark particles
    this.sparkN = 400;
    const geo = new THREE.BufferGeometry();
    this.sp = new Float32Array(this.sparkN * 3);
    this.sv = new Float32Array(this.sparkN * 3);
    this.sl = new Float32Array(this.sparkN);
    this.sc = new Float32Array(this.sparkN * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.sp, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sc, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.sparkIdx = 0;
    for (let i = 0; i < this.sparkN; i++) this.sp[i * 3 + 1] = -999;
  }

  pop(x, y, z, text, color, isGhost = false, item = null, flavor = null) {
    if (isGhost && !this.ghostPopsEnabled) return;
    const col = color ?? (item ? ITEMS[item].css : flavor ? FLAVORS[flavor].color : '#ffe23b');
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: popTexture(text, col), transparent: true, depthWrite: false, depthTest: false }));
    const sc = isGhost ? 1.6 : 2.4;
    s.scale.set(sc, sc * (72 / 320), 1);
    s.position.set(x, y, z);
    s.renderOrder = 20;
    this.scene.add(s);
    this.pops.push({ s, t: 0, life: isGhost ? 0.9 : 1.3 });
  }

  sparks(x, y, z, color = 0xffd23b, n = 4, speed = 3) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.sparkIdx++ % this.sparkN;
      this.sp.set([x, y, z], i * 3);
      this.sv.set([(Math.random() - 0.5) * speed, Math.random() * speed * 0.9, (Math.random() - 0.5) * speed], i * 3);
      this.sc.set([c.r * 2, c.g * 2, c.b * 2], i * 3);
      this.sl[i] = 0.35 + Math.random() * 0.35;
    }
  }

  machineFlash(p) { if (p.machine) p.machine.pulse = 1; }

  craftBurst(p) {
    this.sparks(p.cx, 2.2, p.cz, 0xffe23b, 18, 6);
  }

  update(dt) {
    for (let k = this.pops.length - 1; k >= 0; k--) {
      const p = this.pops[k];
      p.t += dt;
      p.s.position.y += dt * 1.4;
      const a = 1 - Math.max(0, (p.t - p.life * 0.6) / (p.life * 0.4));
      p.s.material.opacity = a;
      if (p.t >= p.life) { this.scene.remove(p.s); p.s.material.dispose(); this.pops.splice(k, 1); }
    }
    for (let i = 0; i < this.sparkN; i++) {
      if (this.sl[i] <= 0) continue;
      this.sl[i] -= dt;
      const o = i * 3;
      this.sv[o + 1] -= 14 * dt;
      this.sp[o] += this.sv[o] * dt; this.sp[o + 1] += this.sv[o + 1] * dt; this.sp[o + 2] += this.sv[o + 2] * dt;
      if (this.sl[i] <= 0) this.sp[o + 1] = -999;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
