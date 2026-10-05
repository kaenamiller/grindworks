// Cel-shading helpers: 3-band toon ramp + inverted-hull ink outlines (the Jet Set Radio look).
import * as THREE from 'three';
import { PAL } from '../config.js';

let gradientMap = null;
export function getGradientMap() {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const matCache = new Map();
export function toon(color, opts = {}) {
  const key = `${color}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? ''}|${opts.map ? opts.map.uuid : ''}|${opts.transparent ? opts.opacity : ''}`;
  if (!opts.noCache && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: getGradientMap(),
    map: opts.map ?? null,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.transparent ? false : true,
  });
  if (!opts.noCache) matCache.set(key, m);
  return m;
}

const outlineMat = new THREE.MeshBasicMaterial({ color: PAL.ink, side: THREE.BackSide });
export function getOutlineMaterial() { return outlineMat; }

/** Adds an inverted-hull outline to every mesh under `root`. `thickness` is in world units. */
export function addOutlines(root, thickness = 0.06, mat = outlineMat) {
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.noOutline && !o.userData.isOutline) meshes.push(o); });
  for (const m of meshes) {
    const geo = m.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const hull = new THREE.Mesh(geo, mat);
    hull.userData.isOutline = true;
    hull.raycast = () => {};
    // scale relative to object size so thin objects still get a visible line
    geo.computeBoundingBox();
    const s = new THREE.Vector3();
    geo.boundingBox.getSize(s);
    hull.scale.set(
      1 + (2 * thickness) / Math.max(s.x, 0.05),
      1 + (2 * thickness) / Math.max(s.y, 0.05),
      1 + (2 * thickness) / Math.max(s.z, 0.05),
    );
    // keep hull centered on the geometry center
    const c = new THREE.Vector3();
    geo.boundingBox.getCenter(c);
    hull.position.copy(c).multiply(new THREE.Vector3(1 - hull.scale.x, 1 - hull.scale.y, 1 - hull.scale.z));
    m.add(hull);
  }
  return root;
}

export function neon(color, intensity = 2.2) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false });
}

/** Box helper: returns an outlined toon box mesh. */
export function box(w, h, d, color, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.material ?? toon(color, opts));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
