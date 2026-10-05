// Sky, city skyline, ground and lighting. Everything is procedural (canvas textures) so the prototype has no asset deps.
import * as THREE from 'three';
import { PAL, CELL, GRID_W, GRID_H, HALF_W, HALF_H } from '../config.js';
import { toon, addOutlines, neon } from './toon.js';

function rand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(PAL.skyTop) },
      mid: { value: new THREE.Color(PAL.skyMid) },
      low: { value: new THREE.Color(PAL.skyLow) },
      sunDir: { value: new THREE.Vector3(0.0, 0.16, -1).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = mix(low, mid, smoothstep(-0.05, 0.18, h));
        c = mix(c, top, smoothstep(0.18, 0.65, h));
        // posterize the gradient into bands for that print / cel look
        c = floor(c * 7.0) / 7.0;
        // big striped synth sun
        float d = distance(normalize(vDir), sunDir);
        float sun = smoothstep(0.23, 0.22, d);
        float stripes = step(0.5, fract((vDir.y - sunDir.y) * 38.0)) + step(sunDir.y + 0.02, vDir.y);
        vec3 sunCol = mix(vec3(1.0,0.35,0.55), vec3(1.0,0.92,0.35), smoothstep(-0.1,0.3, vDir.y - sunDir.y + 0.15));
        c = mix(c, sunCol, sun * clamp(stripes, 0.0, 1.0));
        // halftone dots in upper sky
        vec2 uv = vec2(atan(vDir.x, vDir.z) * 60.0, vDir.y * 60.0);
        float dots = smoothstep(0.32, 0.28, length(fract(uv) - 0.5));
        c += dots * 0.05 * smoothstep(0.35, 0.9, h);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -10;
  return sky;
}

function windowTexture(seed, color) {
  const r = rand(seed);
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1b0b33';
  g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (r() < 0.38) { g.fillStyle = r() < 0.5 ? color : '#ffe9a8'; g.fillRect(x, y, 4, 5); }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeSkyline(scene) {
  const r = rand(7);
  const group = new THREE.Group();
  const texes = [windowTexture(1, '#ff4fd8'), windowTexture(2, '#19e6ff'), windowTexture(3, '#ffe23b')];
  const bodyCols = [0x3a1670, 0x4a1a7a, 0x2c0f5a, 0x55207f];
  for (let i = 0; i < 110; i++) {
    const ang = r() * Math.PI * 2;
    const dist = 140 + r() * 160;
    const w = 10 + r() * 22, d = 10 + r() * 22, h = 20 + r() * (dist > 220 ? 120 : 70);
    const tex = texes[i % 3].clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 16)));
    const mat = new THREE.MeshBasicMaterial({ color: bodyCols[i % 4], map: tex, fog: true });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(Math.cos(ang) * dist, h / 2 - 2, Math.sin(ang) * dist);
    m.rotation.y = r() * Math.PI;
    group.add(m);
    if (r() < 0.25) {
      // neon rooftop sign
      const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 3, 0.6), neon([PAL.pink, PAL.cyan, PAL.yellow, PAL.lime][i % 4], 1.6));
      sign.position.set(0, h / 2 + 3, 0);
      m.add(sign);
    }
  }
  scene.add(group);
}

function graffitiGround() {
  const S = 2048;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const r = rand(42);
  // concrete base with mottled slabs
  g.fillStyle = '#a996c9';
  g.fillRect(0, 0, S, S);
  const cellPx = S / GRID_W;
  for (let y = 0; y < GRID_H; y += 4) {
    for (let x = 0; x < GRID_W; x += 4) {
      const v = 150 + Math.floor(r() * 30);
      g.fillStyle = `rgb(${v - 6},${v - 22},${v + 40})`;
      g.fillRect(x * cellPx + 2, y * cellPx + 2, cellPx * 4 - 4, cellPx * 4 - 4);
    }
  }
  // speckle
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(60,20,90,0.18)' : 'rgba(255,255,255,0.12)';
    g.fillRect(r() * S, r() * S, 2, 2);
  }
  // build grid lines
  g.strokeStyle = 'rgba(70,30,110,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= GRID_W; i++) {
    g.beginPath(); g.moveTo(i * cellPx, 0); g.lineTo(i * cellPx, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * cellPx); g.lineTo(S, i * cellPx); g.stroke();
  }
  // graffiti tags
  const tags = ['GRIND', 'WORKS', 'FLOW', 'GG', 'RUDIE', 'TOKYO-TO', 'SK8', 'LINE', 'KICK', '★'];
  const cols = ['#ff2e88', '#19e6ff', '#ffe23b', '#b6ff3b', '#ff7a1a', '#7b2cff'];
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S;
    g.save();
    g.translate(x, y);
    g.rotate((r() - 0.5) * 1.2);
    const size = 50 + r() * 90;
    g.font = `900 ${size}px "Bungee", "Impact", sans-serif`;
    const t = tags[Math.floor(r() * tags.length)];
    g.lineJoin = 'round';
    g.lineWidth = size * 0.22;
    g.strokeStyle = 'rgba(20,6,31,0.55)';
    g.strokeText(t, 0, 0);
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    g.globalAlpha = 0.55;
    g.fillText(t, 0, 0);
    g.restore();
  }
  // big center logo
  g.save();
  g.translate(S / 2, S / 2 + cellPx * 6);
  g.rotate(-0.08);
  g.font = `900 150px "Bungee", "Impact", sans-serif`;
  g.lineWidth = 34; g.strokeStyle = 'rgba(20,6,31,0.6)'; g.strokeText('GRINDWORKS', 0, 0);
  g.globalAlpha = 0.5; g.fillStyle = '#ff2e88'; g.fillText('GRINDWORKS', 0, 0);
  g.restore();
  // halftone vignette near edges
  for (let y = 0; y < S; y += 18) {
    for (let x = 0; x < S; x += 18) {
      const dx = x / S - 0.5, dy = y / S - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      const rad = Math.max(0, (d - 0.38) * 30);
      if (rad > 0.3) { g.fillStyle = 'rgba(42,15,79,0.35)'; g.beginPath(); g.arc(x, y, Math.min(rad, 8), 0, Math.PI * 2); g.fill(); }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildEnvironment(scene) {
  scene.background = new THREE.Color(PAL.skyTop);
  scene.fog = new THREE.Fog(0x9b3b8f, 120, 420);
  scene.add(makeSky());

  const hemi = new THREE.HemisphereLight(0xffd6f5, 0x4a2a7a, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0e0, 2.1);
  sun.position.set(-40, 70, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -HALF_W - 6; sc.right = HALF_W + 6; sc.top = HALF_H + 6; sc.bottom = -HALF_H - 6;
  sc.near = 1; sc.far = 200;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // the yard slab
  const groundTex = graffitiGround();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_W * CELL, GRID_H * CELL),
    new THREE.MeshToonMaterial({ map: groundTex, color: 0xffffff, gradientMap: toon(0xffffff).gradientMap }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  // outer street level around the yard
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), toon(0x3a1d63));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  scene.add(outer);

  // perimeter walls with neon trim (yard boundary)
  const wallH = 3.2, wallT = 1.2;
  const wallMat = toon(0x6b3fa8);
  const walls = new THREE.Group();
  const mk = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    m.position.set(x, wallH / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    walls.add(m);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.18, d + 0.02), neon(PAL.cyan, 1.8));
    trim.position.set(x, wallH + 0.05, z);
    walls.add(trim);
  };
  mk(GRID_W * CELL + wallT * 2, wallT, 0, -HALF_H - wallT / 2);
  mk(GRID_W * CELL + wallT * 2, wallT, 0, HALF_H + wallT / 2);
  mk(wallT, GRID_H * CELL, -HALF_W - wallT / 2, 0);
  mk(wallT, GRID_H * CELL, HALF_W + wallT / 2, 0);
  addOutlines(walls, 0.05);
  scene.add(walls);

  // decorative stacks + pipes (the abandoned megafactory vibe) just outside the yard
  const r = rand(99);
  const deco = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const side = i % 4;
    const t = (r() - 0.5) * GRID_W * CELL * 0.9;
    const off = 8 + r() * 14;
    const x = side === 0 ? t : side === 1 ? t : side === 2 ? -HALF_W - off : HALF_W + off;
    const z = side === 0 ? -HALF_H - off : side === 1 ? HALF_H + off : t;
    const h = 10 + r() * 22;
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, h, 10), toon([0x8a4fc2, 0x5c2d91, 0xa65bd0][i % 3]));
    stack.position.set(x, h / 2, z);
    stack.castShadow = true;
    deco.add(stack);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.6, 10), neon([PAL.pink, PAL.yellow, PAL.lime][i % 3], 1.5));
    band.position.set(x, h * 0.8, z);
    deco.add(band);
  }
  addOutlines(deco, 0.08);
  scene.add(deco);

  makeSkyline(scene);
  return { sun, ground };
}
