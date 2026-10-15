// ===================== input.js — джойстик, кнопки, клавиатура/мышь =====================
import { clamp, svgIcon, TILE } from './consts.js';

export class InputSys {
  constructor(root, G) {
    this.G = G;
    this.stick = { x: 0, y: 0 };
    this.runHeld = false;
    this.joyId = null; this.joyBase = { x: 0, y: 0 };
    this.atkId = null; this.atkStart = 0; this.atkHold = false; this.atkOrigin = null;
    this.keys = {};
    this._buildDOM(root);
    this._bindTouch(root);
    this._bindKeys();
  }
  _buildDOM(root) {
    // джойстик
    this.joyEl = document.createElement('div');
    this.joyEl.className = 'mz-joy';
    this.joyEl.innerHTML = `<div class="mz-joy-base"><div class="mz-joy-knob"></div></div>`;
    root.appendChild(this.joyEl);
    this.joyBaseEl = this.joyEl.firstChild; this.joyKnobEl = this.joyBaseEl.firstChild;
    // правая зона: атака + контекст + красться
    const wrap = document.createElement('div');
    wrap.className = 'mz-actions';
    wrap.innerHTML = `
      <button class="mz-btn mz-btn-sneak" data-k="sneak" aria-label="Красться">${svgIcon('sneak', 22)}</button>
      <button class="mz-btn mz-btn-ctx" data-k="ctx" aria-label="Действие"><span class="mz-ctx-icon">${svgIcon('hand', 24)}</span></button>
      <button class="mz-btn mz-btn-atk" data-k="atk" aria-label="Атака">${svgIcon('attack', 30)}</button>`;
    root.appendChild(wrap);
    this.btnAtk = wrap.querySelector('[data-k="atk"]');
    this.btnCtx = wrap.querySelector('[data-k="ctx"]');
    this.btnSneak = wrap.querySelector('[data-k="sneak"]');
    this.btnSneak.addEventListener('click', () => { const p = this.G.player; p.sneaking = !p.sneaking; this.btnSneak.classList.toggle('on', p.sneaking); this.G.audio.uiClick(); });
    // контекстная кнопка: тап — основное действие, долгий тап — меню
    let ctxTimer = null, ctxLong = false;
    this.btnCtx.addEventListener('pointerdown', e => {
      e.preventDefault(); ctxLong = false;
      ctxTimer = setTimeout(() => { ctxLong = true; this.G.ui.showContextMenu(); }, 380);
    });
    this.btnCtx.addEventListener('pointerup', e => {
      clearTimeout(ctxTimer);
      if (!ctxLong) this.G.doContextAction();
    });
    this.btnCtx.addEventListener('pointercancel', () => clearTimeout(ctxTimer));
    // атака: тап = быстрый удар; удержание = прицел/замах (таскание задаёт направление)
    this.btnAtk.addEventListener('pointerdown', e => {
      e.preventDefault(); this.G.audio.unlock();
      this.atkId = e.pointerId; this.atkStart = performance.now(); this.atkHold = false;
      this.atkOrigin = { x: e.clientX, y: e.clientY };
      this.btnAtk.setPointerCapture(e.pointerId);
    });
    this.btnAtk.addEventListener('pointermove', e => {
      if (e.pointerId !== this.atkId) return;
      const dx = e.clientX - this.atkOrigin.x, dy = e.clientY - this.atkOrigin.y;
      if (!this.atkHold && (performance.now() - this.atkStart > 200 || Math.hypot(dx, dy) > 18)) {
        this.atkHold = true; this.G.player.aiming = true; this.btnAtk.classList.add('hold');
      }
      if (this.atkHold && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) this.G.player.aimA = Math.atan2(dy, dx);
    });
    const atkEnd = e => {
      if (e.pointerId !== this.atkId) return;
      const p = this.G.player;
      if (this.atkHold) { p.aiming = false; this.btnAtk.classList.remove('hold'); p.chargedAttack(this.G); }
      else p.quickAttack(this.G);
      this.atkId = null;
    };
    this.btnAtk.addEventListener('pointerup', atkEnd);
    this.btnAtk.addEventListener('pointercancel', atkEnd);
  }
  _bindTouch(root) {
    const joyZone = document.createElement('div');
    joyZone.className = 'mz-joyzone';
    root.appendChild(joyZone);
    const moveKnob = (dx, dy) => {
      const R = 52, len = Math.hypot(dx, dy), k = len > R ? R / len : 1;
      this.joyKnobEl.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.stick.x = clamp(dx / R, -1, 1); this.stick.y = clamp(dy / R, -1, 1);
    };
    joyZone.addEventListener('pointerdown', e => {
      e.preventDefault(); this.G.audio.unlock();
      if (this.joyId !== null) return;
      this.joyId = e.pointerId;
      this.joyBase = { x: e.clientX, y: e.clientY };
      this.joyEl.classList.add('show');
      this.joyEl.style.left = (e.clientX - 75) + 'px'; this.joyEl.style.top = (e.clientY - 75) + 'px';
      joyZone.setPointerCapture(e.pointerId);
      moveKnob(0, 0);
    });
    joyZone.addEventListener('pointermove', e => {
      if (e.pointerId !== this.joyId) return;
      moveKnob(e.clientX - this.joyBase.x, e.clientY - this.joyBase.y);
    });
    const joyEnd = e => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null; this.stick.x = 0; this.stick.y = 0;
      this.joyEl.classList.remove('show');
      this.joyKnobEl.style.transform = 'translate(0,0)';
    };
    joyZone.addEventListener('pointerup', joyEnd);
    joyZone.addEventListener('pointercancel', joyEnd);
  }
  _bindKeys() {
    const G = this.G;
    window.addEventListener('keydown', e => {
      if (G.ui.anyPanelOpen() && e.code !== 'Escape' && e.code !== 'KeyI' && e.code !== 'KeyC' && e.code !== 'KeyH') return;
      this.keys[e.code] = true; this._keysToStick();
      const p = G.player;
      switch (e.code) {
        case 'KeyE': G.doContextAction(); break;
        case 'KeyQ': G.ui.showContextMenu(); break;
        case 'KeyI': case 'Tab': e.preventDefault(); G.togglePanel('inv'); break;
        case 'KeyC': G.togglePanel('craft'); break;
        case 'KeyH': G.togglePanel('health'); break;
        case 'KeyF': G.toggleTorch(); break;
        case 'ShiftLeft': this.runHeld = true; break;
        case 'ControlLeft': e.preventDefault(); p.sneaking = !p.sneaking; this.btnSneak.classList.toggle('on', p.sneaking); break;
        case 'Escape': G.escapePressed(); break;
        case 'KeyM': G.toggleMute(); break;
      }
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false; this._keysToStick();
      if (e.code === 'ShiftLeft') this.runHeld = false;
    });
    // мышь — ПК версия
    const cv = G.engine.cv;
    let mHold = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => {
      G.audio.unlock();
      if (G.ui.anyPanelOpen()) return;
      if (e.button === 0) mHold = { t: performance.now(), x: e.clientX, y: e.clientY };
      if (e.button === 2) G.player.quickAttack(G); // толчок
    });
    window.addEventListener('mousemove', e => {
      const p = G.player;
      if (mHold && performance.now() - mHold.t > 200) {
        p.aiming = true;
        const wx = (e.clientX - G.engine.w / 2) / G.engine.cam.zoom + G.engine.cam.x;
        const wy = (e.clientY - G.engine.h / 2) / G.engine.cam.zoom + G.engine.cam.y;
        p.aimA = Math.atan2(wy - p.ty * TILE, wx - p.tx * TILE);
      }
    });
    window.addEventListener('mouseup', e => {
      if (e.button !== 0 || !mHold) return;
      const p = G.player;
      if (p.aiming) { p.aiming = false; p.chargedAttack(G); }
      else if (!G.ui.anyPanelOpen()) {
        const wx = (e.clientX - G.engine.w / 2) / G.engine.cam.zoom + G.engine.cam.x;
        const wy = (e.clientY - G.engine.h / 2) / G.engine.cam.zoom + G.engine.cam.y;
        p.aimA = Math.atan2(wy - p.ty * TILE, wx - p.tx * TILE); p.a = p.aimA;
        p.quickAttack(G);
      }
      mHold = null;
    });
  }
  _keysToStick() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k['KeyA'] || k['ArrowLeft']) x -= 1;
    if (k['KeyD'] || k['ArrowRight']) x += 1;
    if (k['KeyW'] || k['ArrowUp']) y -= 1;
    if (k['KeyS'] || k['ArrowDown']) y += 1;
    const len = Math.hypot(x, y) || 1;
    this.stick.kb = true;
    this.stick.x = x / len; this.stick.y = y / len;
  }
}
