// DOM HUD: score, combo, trick energy, bag, goals, record badge, build-mode panels.
import { FLAVORS, ITEMS, BAG_CAP, PHYS } from '../config.js';
import { PIECES, PIECE_ORDER } from '../world/pieces.js';
import { GOALS } from '../game/stats.js';
import { RECIPES, stokeFactor } from '../game/machines.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), score: $('score'), shipped: $('shipped'), mode: $('mode-badge'), rec: $('rec'),
      goalList: $('goal-list'), goalsCount: $('goals-count'), goals: $('goals'),
      combo: $('combo'), comboNames: $('combo-names'), comboScore: $('combo-score'),
      tally: $('tally'), bag: $('bag'), speed: $('speed'), hints: $('hints'), toasts: $('toasts'),
      buildUI: $('build-ui'), hotbar: $('hotbar'), pieceInfo: $('piece-info'), ghostList: $('ghost-list'), tooltip: $('tooltip'),
    };
    this.cache = {};
    this.flashT = 0;
    this.buildTally();
    this.el.goals.addEventListener('click', () => this.el.goals.classList.toggle('collapsed'));
  }

  show() { this.el.hud.classList.remove('hidden'); }

  set(key, el, html) {
    if (this.cache[key] === html) return;
    this.cache[key] = html;
    el.innerHTML = html;
  }

  buildTally() {
    this.el.tally.innerHTML = Object.entries(FLAVORS)
      .map(([k, f]) => `<span class="chip ${k} zero" id="t-${k}" title="${f.desc}"><span>${f.label}</span><span class="n">0</span></span>`)
      .join('');
    this.tallyEls = {};
    for (const k of Object.keys(FLAVORS)) this.tallyEls[k] = { chip: $(`t-${k}`), n: $(`t-${k}`).querySelector('.n'), v: 0 };
  }

  setMode(mode, device) {
    const pad = device === 'gamepad';
    const html = mode === 'build'
      ? `BUILD MODE <small>${pad ? 'SELECT' : 'TAB'} → skate</small>`
      : `SKATE MODE <small>${pad ? 'SELECT' : 'TAB'} → build</small>`;
    this.el.mode.classList.toggle('build', mode === 'build');
    this.set('mode', this.el.mode, html);
    this.el.buildUI.classList.toggle('hidden', mode !== 'build');
    this.el.combo.style.display = mode === 'build' ? 'none' : '';
    this.el.tally.style.display = mode === 'build' ? 'none' : '';
    this.el.speed.style.display = mode === 'build' ? 'none' : '';
    if (mode !== 'build') this.tooltip(null);
  }

  hints(mode, device, ctx = {}) {
    const pad = device === 'gamepad';
    let h;
    if (mode === 'skate') {
      h = pad
        ? `<b>A</b> hold+release ollie <b>X</b> flip <b>B</b> grab <b>Y</b> grind <b>RT</b> manual<br><b>START</b> ${ctx.recording ? 'close loop' : 'record ghost'} <b>SELECT</b> build`
        : `<b>SPACE</b> hold+release ollie <b>J</b> flip <b>K</b> grab <b>L</b> grind <b>SHIFT</b> manual<br><b>R</b> ${ctx.recording ? 'close loop · <b>C</b> cancel' : 'record ghost'} · <b>T</b> respawn · <b>TAB</b> build · <b>ESC</b> menu`;
    } else {
      h = pad
        ? `stick move · <b>A</b> place <b>B</b> delete <b>Y</b> rotate <b>LB/RB</b> piece · <b>SELECT</b> skate`
        : `<b>LMB</b> place (drag rails) <b>RMB</b> delete <b>R</b> rotate<br><b>WASD</b> pan <b>Q/E</b> turn <b>WHEEL</b> zoom <b>TAB</b> skate`;
    }
    this.set('hints', this.el.hints, h);
  }

  update(state) {
    const { skater, stats, actor, recorder, mode } = state;
    this.set('score', this.el.score, skater.score.toLocaleString());
    const sh = stats.shipped;
    const rate = stats.rate();
    this.set('shipped', this.el.shipped,
      ['ingot', 'plate', 'gear'].map((it) => `<span class="it"><span class="dot" style="background:${ITEMS[it].css}"></span>${sh[it] || 0}</span>`).join('') +
      `<span class="rate">⇢ ${rate.toFixed(0)}/min</span>`);

    // combo
    const c = skater.combo;
    if (mode === 'skate') {
      if (c.active) {
        this.comboHold = 0;
        this.el.combo.classList.remove('banked', 'failed');
        const names = c.names.filter((n) => n !== 'Ollie' || c.names.length === 1);
        const shown = names.slice(-7).join(' + ');
        this.set('cn', this.el.comboNames, (names.length > 7 ? '… + ' : '') + shown);
        this.set('cs', this.el.comboScore, `${c.points.toLocaleString()} <span class="x">× ${Math.max(1, c.mult)}</span>`);
      } else if (this.comboHold !== undefined) {
        this.comboHold += state.dt;
        if (this.comboHold > 1.6) { this.set('cn', this.el.comboNames, ''); this.set('cs', this.el.comboScore, ''); this.comboHold = undefined; }
      }
    }
    // tally
    const sf = stokeFactor(actor.mult);
    for (const [k, t] of Object.entries(this.tallyEls)) {
      const v = actor.tally[k];
      if (v !== t.v) {
        if (v > t.v) { t.chip.classList.add('bump'); setTimeout(() => t.chip.classList.remove('bump'), 120); }
        t.v = v;
        t.n.textContent = v > 0 && sf > 1 ? `${v}×${sf.toFixed(2).replace(/0$/, '')}` : `${v}`;
        t.chip.classList.toggle('zero', v === 0);
      }
    }
    // bag
    const bagKey = actor.bag.join(',');
    if (this.cache.bag !== bagKey) {
      this.cache.bag = bagKey;
      let h = '';
      for (let i = 0; i < BAG_CAP; i++) {
        const it = actor.bag[i];
        h += it ? `<div class="slot" style="background:${ITEMS[it].css}">${it.slice(0, 3).toUpperCase()}</div>` : '<div class="slot"></div>';
      }
      this.el.bag.innerHTML = h;
    }
    const ch = document.getElementById('charge');
    const cf = skater.charging ? skater.charge / PHYS.chargeTime : 0;
    ch.classList.toggle('on', skater.charging && mode === 'skate');
    ch.classList.toggle('full', cf >= 0.999);
    document.getElementById('charge-fill').style.width = `${Math.min(100, cf * 100)}%`;
    this.set('speed', this.el.speed, `${Math.round(skater.speed * 3.6)} KM/H`);

    // record badge
    if (recorder.active) {
      this.el.rec.classList.remove('hidden');
      const d = recorder.distToStart(skater.pos);
      const can = recorder.canClose(skater.pos);
      this.el.rec.classList.toggle('close', can);
      const t = recorder.t;
      const time = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      this.set('rec', this.el.rec, can
        ? `● ${time} — PRESS ${state.device === 'gamepad' ? 'START' : 'R'} TO CLOSE THE LOOP`
        : `<span class="blink">●</span> REC ${time} — loop back to the ring (${d.toFixed(0)}m)`);
    } else this.el.rec.classList.add('hidden');
  }

  comboEnd(banked, failed) {
    this.el.combo.classList.remove('banked', 'failed');
    void this.el.combo.offsetWidth;
    if (failed) {
      this.el.combo.classList.add('failed');
      this.set('cs', this.el.comboScore, 'BAILED!');
    } else if (banked > 0) {
      this.el.combo.classList.add('banked');
      this.set('cs', this.el.comboScore, `+${banked.toLocaleString()}`);
    }
    this.comboHold = 0;
  }

  goals(done) {
    let first = true;
    const html = GOALS.map((g) => {
      const d = done.has(g.id);
      const cls = d ? 'done' : first ? 'next' : '';
      if (!d) first = false;
      return `<li class="${cls}">${g.text}</li>`;
    }).join('');
    this.set('goals', this.el.goalList, html);
    this.set('gc', this.el.goalsCount, `${done.size}/${GOALS.length}`);
  }

  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => t.remove(), 3600);
  }

  // ---------- build mode ----------
  hotbar(selected, onPick) {
    if (!this._hotbarBuilt) {
      this._hotbarBuilt = true;
      const tools = [...PIECE_ORDER, 'delete'];
      this.el.hotbar.innerHTML = tools.map((t, i) => {
        const def = PIECES[t];
        const name = def ? def.name : 'Delete';
        const col = def ? def.color : '#ff5a5a';
        return `<div class="tool ${t === 'delete' ? 'del' : ''}" data-tool="${t}"><span class="k">${t === 'delete' ? 'X' : i + 1}</span><span class="sw" style="background:${col}"></span><span>${name}</span></div>`;
      }).join('');
      this.el.hotbar.querySelectorAll('.tool').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); onPick(el.dataset.tool); }));
    }
    this.el.hotbar.querySelectorAll('.tool').forEach((el) => el.classList.toggle('sel', el.dataset.tool === selected));
    const def = PIECES[selected];
    let info;
    if (def) {
      const r = def.machine && RECIPES[def.machine];
      const recipe = r ? ` <span class="chip ${r.input}">${r.input.toUpperCase()}</span> + ${Object.entries(r.energy).map(([f, n]) => `<span class="chip ${f}">${FLAVORS[f].label}×${n}</span>`).join(' ')} → <span class="chip ${r.output}">${r.output.toUpperCase()}</span>` : '';
      info = `<b>${def.name}</b> — ${def.blurb}${recipe ? `<div style="margin-top:6px">${recipe}</div>` : ''}`;
    } else {
      info = '<b>Delete</b> — click any piece to remove it. Removing terrain under a Ghost\'s line breaks that Ghost.';
    }
    this.set('pinfo', this.el.pieceInfo, info);
  }

  ghostPanel(ghosts, handlers) {
    const key = ghosts.map((g) => `${g.id}:${g.broken}:${g.visible}:${g.actor.shippedTotal}:${Math.floor(g.itemsPerMin)}`).join('|');
    if (this.cache.ghosts === key) return;
    this.cache.ghosts = key;
    if (!ghosts.length) {
      this.el.ghostList.innerHTML = '<div class="ghost-empty">No ghosts yet. In skate mode press <b>R</b>, skate a loop through your machines, and press <b>R</b> again back at the start ring. Your run becomes a worker that loops forever.</div>';
      return;
    }
    this.el.ghostList.innerHTML = ghosts.map((g) => `
      <div class="ghost-row ${g.broken >= 0 ? 'broken' : ''}" data-id="${g.id}">
        <span class="sw" style="background:#${g.color.toString(16).padStart(6, '0')}"></span>
        <span class="nm">${g.name}${g.broken >= 0 ? ' — LINE BROKEN' : ''}</span>
        <span><button data-act="focus">FIND</button> <button data-act="del">✕</button></span>
        <span class="meta">${g.duration.toFixed(1)}s loop · stoke ×${g.peakMult} · ${g.itemsPerMin.toFixed(1)} items/min · ${g.actor.shippedTotal} shipped</span>
      </div>`).join('');
    this.el.ghostList.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(b.closest('.ghost-row').dataset.id);
      handlers[b.dataset.act]?.(id);
    }));
  }

  tooltip(html, x, y) {
    const t = this.el.tooltip;
    if (!html) { t.classList.add('hidden'); return; }
    t.classList.remove('hidden');
    if (this.cache.tt !== html) { this.cache.tt = html; t.innerHTML = html; }
    t.style.left = `${Math.min(window.innerWidth - 280, x + 18)}px`;
    t.style.top = `${Math.min(window.innerHeight - 140, y + 18)}px`;
  }
}
