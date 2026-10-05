// Canvas-texture sprites for floating machine readouts and sticker-style signs.
import * as THREE from 'three';

export function makeTextTexture(drawFn, w = 256, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  drawFn(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { tex: t, canvas: c, ctx: g };
}

// Redraw canvas textures once the display font has loaded (otherwise early signs bake in the fallback font).
const fontWaiters = [];
let fontsReady = false;
if (document.fonts?.ready) {
  document.fonts.load('900 40px "Bungee"').finally(() => {
    fontsReady = true;
    for (const f of fontWaiters.splice(0)) f();
  });
}
export function onFontsReady(fn) { if (fontsReady) return; fontWaiters.push(fn); }

const isDark = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 110;
};

export function stickerTexture(text, bg = '#ff2e88', fg = '#ffffff', w = 512, h = 192) {
  const draw = (g) => {
    g.clearRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(-0.04);
    g.fillStyle = '#14061f';
    roundRect(g, -w / 2 + 12, -h / 2 + 20, w - 24, h - 32, 36); g.fill();
    g.fillStyle = bg;
    roundRect(g, -w / 2 + 20, -h / 2 + 12, w - 40, h - 36, 32); g.fill();
    g.font = `900 ${Math.floor(h * 0.46)}px "Bungee", "Impact", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const maxW = w - 90;
    // dark lettering on a bright sticker reads cleanly without an outline;
    // light lettering gets a slim ink stroke so it pops off the sticker
    if (!isDark(fg)) {
      g.lineWidth = 9; g.strokeStyle = '#14061f'; g.lineJoin = 'round';
      g.strokeText(text, 0, -4, maxW);
    }
    g.fillStyle = fg; g.fillText(text, 0, -4, maxW);
    g.restore();
  };
  const r = makeTextTexture(draw, w, h);
  onFontsReady(() => { draw(r.ctx); r.tex.needsUpdate = true; });
  return r.tex;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A sprite whose canvas can be redrawn cheaply (machine readouts). */
export class LabelSprite {
  constructor(w = 256, h = 128, worldW = 3.2) {
    const { tex, canvas, ctx } = makeTextTexture(() => {}, w, h);
    this.tex = tex; this.canvas = canvas; this.ctx = ctx;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.sprite.scale.set(worldW, worldW * (h / w), 1);
    this.sprite.renderOrder = 5;
    this.lastKey = '';
    onFontsReady(() => { this.lastKey = ''; });
  }
  draw(key, fn) {
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fn(this.ctx, this.canvas.width, this.canvas.height);
    this.tex.needsUpdate = true;
  }
}
