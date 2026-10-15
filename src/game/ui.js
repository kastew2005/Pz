// ===================== ui.js — HUD, мудлеты, инвентарь, панели =====================
import { TILE, MAP_W, MAP_H, ITEMS, WEAPONS, RECIPES, clamp, fmtTime, svgIcon } from './consts.js';
import { FURN } from './world.js';
import { PART_NAMES } from './player.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const itemIconCanvas = (id, s = 34) => {
  const c = document.createElement('canvas'); c.width = s; c.height = s; c.className = 'mz-item-ic';
  const def = ITEMS[id]; if (def) def.icon(c.getContext('2d'), s);
  return c;
};

export class UI {
  constructor(root, G) {
    this.G = G; this.root = root;
    this.logItems = [];
    this._tHud = 0; this._tMap = 0;
    this.mapBase = G.world.minimapBase();
    this._build();
    this._moodleT = 0;
  }
  // ================= DOM =================
  _build() {
    const G = this.G;
    this.hud = el('div', 'mz-hud');
    this.hud.innerHTML = `
      <div class="mz-clockcard">
        <div class="mz-clock-row"><span class="mz-wicon"></span><span class="mz-clock">День 1 · 09:00</span></div>
        <div class="mz-vitals"><div class="mz-bar mz-hpbar"><i></i></div><div class="mz-bar mz-enbar"><i></i></div></div>
        <div class="mz-weight"></div>
      </div>
      <div class="mz-moodles"></div>
      <div class="mz-mapwrap"><canvas class="mz-map" width="232" height="232"></canvas></div>
      <div class="mz-log"></div>
      <div class="mz-weapon-chip"></div>
      <div class="mz-quickbar">
        <button class="mz-qbtn" data-p="inv" title="Рюкзак [I]">${svgIcon('bag')}</button>
        <button class="mz-qbtn" data-p="craft" title="Крафт [C]">${svgIcon('craft')}</button>
        <button class="mz-qbtn" data-p="health" title="Здоровье [H]">${svgIcon('health')}</button>
        <button class="mz-qbtn" data-p="torch" title="Фонарик [F]">${svgIcon('torch')}</button>
        <button class="mz-qbtn" data-p="mute" title="Звук [M]"></button>
        <button class="mz-qbtn" data-p="menu" title="Меню">${svgIcon('menu')}</button>
      </div>
      <div class="mz-ctx-label"></div>`;
    this.root.appendChild(this.hud);
    this.clockEl = this.hud.querySelector('.mz-clock');
    this.wIconEl = this.hud.querySelector('.mz-wicon');
    this.hpBar = this.hud.querySelector('.mz-hpbar i');
    this.enBar = this.hud.querySelector('.mz-enbar i');
    this.weightEl = this.hud.querySelector('.mz-weight');
    this.moodlesEl = this.hud.querySelector('.mz-moodles');
    this.logEl = this.hud.querySelector('.mz-log');
    this.mapCv = this.hud.querySelector('.mz-map');
    this.weaponChip = this.hud.querySelector('.mz-weapon-chip');
    this.ctxLabel = this.hud.querySelector('.mz-ctx-label');
    this.hud.querySelectorAll('.mz-qbtn').forEach(b => {
      b.addEventListener('click', () => {
        const k = b.dataset.p; G.audio.unlock();
        if (k === 'torch') G.toggleTorch();
        else if (k === 'mute') G.toggleMute();
        else if (k === 'menu') this.showPause();
        else G.togglePanel(k);
        G.audio.uiClick();
      });
    });
    this.muteBtn = this.hud.querySelector('[data-p="mute"]');
    this._muteIcon();
    // панель-шторка
    this.sheet = el('div', 'mz-sheet'); this.sheet.style.display = 'none';
    this.sheet.innerHTML = `<div class="mz-sheet-inner">
        <div class="mz-sheet-head"><span class="mz-sheet-title"></span><button class="mz-sheet-close">${svgIcon('close', 20)}</button></div>
        <div class="mz-sheet-body"></div>
      </div>`;
    this.root.appendChild(this.sheet);
    this.sheet.querySelector('.mz-sheet-close').addEventListener('click', () => { this.closePanels(); G.audio.uiClick(); });
    this.sheetBody = this.sheet.querySelector('.mz-sheet-body');
    this.sheetTitle = this.sheet.querySelector('.mz-sheet-title');
    // меню контекстных действий
    this.ctxMenu = el('div', 'mz-ctxmenu'); this.ctxMenu.style.display = 'none';
    this.root.appendChild(this.ctxMenu);
    // кольцо прогресса
    this.ring = el('div', 'mz-ring'); this.ring.style.display = 'none';
    this.root.appendChild(this.ring);
    // затемнение/фейды
    this.fader = el('div', 'mz-fader'); this.root.appendChild(this.fader);
    // всплывающие подсказки лога готово
  }
  _muteIcon() {
    const m = this.G.audio.muted;
    this.muteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M4 9v6h4l6 5V4L8 9H4z"/>${m ? '<path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" fill="none"/>' : '<path d="M17 8a5 5 0 0 1 0 8M19.5 5.5a9 9 0 0 1 0 13" stroke="currentColor" stroke-width="2" fill="none"/>'}</svg>`;
  }
  // ================= лог =================
  log(msg, cls = '') {
    const it = el('div', 'mz-log-item ' + cls, msg);
    this.logEl.prepend(it);
    this.logItems.push({ it, t: performance.now() });
    if (this.logItems.length > 7) { const old = this.logItems.shift(); old.it.remove(); }
    while (this.logEl.children.length > 7) this.logEl.lastChild.remove();
    setTimeout(() => { it.classList.add('fade'); }, 4600);
    setTimeout(() => { it.remove(); }, 5400);
  }
  // ================= мудлеты =================
  _moodleDefs() {
    const p = this.G.player;
    const L = [];
    const add = (icon, name, lvl) => L.push({ icon, name, lvl });
    const bleed = p.anyBleeding();
    if (p.hunger >= 35) add('hunger', p.hunger >= 85 ? 'Истощение' : p.hunger >= 60 ? 'Голод' : 'Лёгкий голод', p.hunger >= 85 ? 3 : p.hunger >= 60 ? 2 : 1);
    if (p.thirst >= 32) add('thirst', p.thirst >= 82 ? 'Обезвоживание' : p.thirst >= 60 ? 'Жажда' : 'Сухость во рту', p.thirst >= 82 ? 3 : p.thirst >= 60 ? 2 : 1);
    if (p.fatigue >= 50) add('tired', p.fatigue >= 90 ? 'Изнеможение' : p.fatigue >= 75 ? 'Сильная усталость' : 'Вялость', p.fatigue >= 90 ? 3 : p.fatigue >= 75 ? 2 : 1);
    if (p.endur <= 58) add('endurance', p.endur <= 12 ? 'Нет сил' : p.endur <= 30 ? 'Запыхался' : 'Лёгкая одышка', p.endur <= 12 ? 3 : p.endur <= 30 ? 2 : 1);
    if (p.panic >= 15) add('panic', p.panic >= 78 ? 'Ужас' : p.panic >= 45 ? 'Паника' : 'Тревога', p.panic >= 78 ? 3 : p.panic >= 45 ? 2 : 1);
    if (p.pain >= 18) add('pain', p.pain >= 75 ? 'Агония' : p.pain >= 48 ? 'Сильная боль' : 'Боль', p.pain >= 75 ? 3 : p.pain >= 48 ? 2 : 1);
    if (bleed > 0) add('bleed', bleed >= 2 ? 'Сильное кровотечение' : 'Кровотечение', bleed >= 2 ? 3 : 2);
    if (p.knox >= 0) add('sick', p.knox >= 70 ? 'Неизбежное' : p.knox >= 35 ? 'Жар' : 'Тошнота', 3);
    else if (p.sickCold > 0) add('sick', 'Простуда', 2);
    else { let inf = false; for (const k of ['head', 'torso', 'larm', 'rarm', 'lleg', 'rleg']) if (p.parts[k].infected) inf = true; if (inf) add('sick', 'Заражение раны', 2); }
    if (p.wet >= 25) add('wet', p.wet >= 85 ? 'Промок насквозь' : p.wet >= 55 ? 'Мокрый' : 'Влажный', p.wet >= 85 ? 3 : p.wet >= 55 ? 2 : 1);
    const over = p.weight() - p.capacity();
    if (over > 0) add('weight', over > 4 ? 'Сильный перегруз' : 'Перегруз', over > 4 ? 3 : 2);
    if (p.torchOn) add('torch', 'Фонарь включён', 0);
    if (p.sneaking) add('sneak', 'Крадётесь', 0);
    return L;
  }
  _refreshMoodles() {
    const defs = this._moodleDefs();
    // перерисовываем только если изменилось
    const sig = defs.map(d => d.name).join('|');
    if (sig === this._moodleSig) return;
    this._moodleSig = sig;
    this.moodlesEl.innerHTML = '';
    const cls = ['ok', 'l1', 'l2', 'l3'];
    for (const d of defs.slice(0, 14)) {
      const c = el('div', `mz-moodle ${cls[d.lvl]}${d.lvl === 3 ? ' pulse' : ''}`, `${svgIcon(d.icon, 18)}<span>${d.name}</span>`);
      this.moodlesEl.appendChild(c);
    }
  }
  // ================= верхний HUD =================
  _refreshHud() {
    const G = this.G, w = G.world, p = G.player;
    this.clockEl.textContent = `День ${w.time.day} · ${fmtTime(w.time.min)}`;
    const h = w.hour();
    let wi = 'sun';
    if (w.isNight()) wi = 'moon'; else if (w.weather.rain > .1) wi = 'rain'; else if (w.weather.state === 'overcast' || w.weather.rain > .02) wi = 'cloud';
    this.wIconEl.innerHTML = svgIcon(wi, 17);
    this.hpBar.style.width = (p.health01() * 100).toFixed(1) + '%';
    this.hpBar.parentElement.classList.toggle('crit', p.health01() < .35);
    this.enBar.style.width = p.endur.toFixed(0) + '%';
    this.weightEl.textContent = `Вес: ${p.weight().toFixed(1)} / ${p.capacity().toFixed(0)} кг`;
    this.weightEl.classList.toggle('over', p.weight() > p.capacity());
    // чип оружия
    const eq = p.equip;
    if (eq) {
      const wd = WEAPONS[eq.id];
      let extra = '';
      if (eq.id === 'w_pistol') extra = ` · патроны: ${p.count('ammo_9mm')}`;
      const cond = eq.cond !== undefined && isFinite(wd.condMax) ? clamp(eq.cond / wd.condMax, 0, 1) : 1;
      this.weaponChip.innerHTML = `<span class="mz-wname">${ITEMS[eq.id].name}${extra}</span><div class="mz-cond"><i style="width:${cond * 100}%"></i></div>`;
    } else this.weaponChip.innerHTML = `<span class="mz-wname fists">Кулаки</span>`;
  }
  // ================= миникарта =================
  drawMinimap() {
    const G = this.G, w = G.world, cv = this.mapCv, ctx = cv.getContext('2d');
    const S = cv.width, view = 46; // тайлов в радиусе обзора карты
    const p = G.player;
    const cx = clamp(p.tx, view, MAP_W - view), cy = clamp(p.ty, view, MAP_H - view);
    const px = S / (view * 2);
    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mapBase, cx - view, cy - view, view * 2, view * 2, 0, 0, S, S);
    // неисследованное затемняем
    ctx.fillStyle = 'rgba(3,6,4,.88)';
    const ex = w.explored;
    for (let y = Math.floor(cy - view); y < cy + view; y++) for (let x = Math.floor(cx - view); x < cx + view; x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      if (!ex[x + y * MAP_W]) ctx.fillRect((x - (cx - view)) * px, (y - (cy - view)) * px, px, px);
    }
    // зомби, которых видно
    ctx.fillStyle = '#d23a2a';
    for (const z of G.engine.visZeds) {
      ctx.fillRect((z.tx - (cx - view)) * px - 1.5, (z.ty - (cy - view)) * px - 1.5, 3, 3);
    }
    // тревога
    if (G.alarm) {
      const h = G.alarm.house;
      const ax = (h.x + h.w / 2 - (cx - view)) * px, ay = (h.y + h.h / 2 - (cy - view)) * px;
      ctx.strokeStyle = `rgba(255,80,40,${.5 + .5 * Math.sin(performance.now() / 150)})`;
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ax, ay, 8, 0, 7); ctx.stroke();
    }
    // игрок
    const pxx = (p.tx - (cx - view)) * px, pyy = (p.ty - (cy - view)) * px;
    ctx.save(); ctx.translate(pxx, pyy); ctx.rotate(p.a);
    ctx.fillStyle = '#e8e4d8';
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.fill();
    ctx.restore();
  }
  // ================= контекст =================
  setContext(actions) {
    this._actions = actions || [];
    const a = this._actions[0];
    if (!a) { this.ctxLabel.classList.remove('show'); this.G.input.btnCtx.classList.remove('active'); return; }
    this.ctxLabel.classList.add('show');
    this.ctxLabel.innerHTML = `<b>[E]</b> ${a.label}${this._actions.length > 1 ? ` <i>+${this._actions.length - 1} (удерж.)</i>` : ''}`;
    const btn = this.G.input.btnCtx;
    btn.classList.add('active');
    btn.querySelector('.mz-ctx-icon').innerHTML = svgIcon(a.icon || 'hand', 24);
  }
  showContextMenu() {
    if (!this._actions || !this._actions.length) { this.ctxMenu.style.display = 'none'; return; }
    const G = this.G;
    if (this.ctxMenu.style.display === 'block') { this.ctxMenu.style.display = 'none'; return; }
    this.ctxMenu.innerHTML = '';
    for (const a of this._actions) {
      const b = el('button', 'mz-ctxmenu-item', `${svgIcon(a.icon || 'hand', 18)}<span>${a.label}</span>`);
      b.addEventListener('click', () => { this.ctxMenu.style.display = 'none'; a.fn(); });
      this.ctxMenu.appendChild(b);
    }
    this.ctxMenu.style.display = 'block';
    setTimeout(() => {
      const h = (e) => { if (!this.ctxMenu.contains(e.target)) { this.ctxMenu.style.display = 'none'; document.removeEventListener('pointerdown', h); } };
      document.addEventListener('pointerdown', h);
    }, 50);
  }
  // ================= кольцо прогресса =================
  setRing(p, label) {
    if (p == null) { this.ring.style.display = 'none'; return; }
    this.ring.style.display = 'block';
    const deg = Math.round(p * 360);
    this.ring.style.background = `conic-gradient(#d8d0b0 ${deg}deg, rgba(255,255,255,.08) ${deg}deg)`;
    this.ring.textContent = label || '';
  }
  // ================= панели =================
  anyPanelOpen() { return this.sheet.style.display !== 'none' || (this._modalOpen || false); }
  closePanels() { this.sheet.style.display = 'none'; this._openPanel = null; }
  openPanel(name, arg) {
    this.G.audio.uiClick();
    // сбрасываем ввод, чтобы персонаж не шёл фоном
    const inp = this.G.input; if (inp) { inp.stick.x = 0; inp.stick.y = 0; }
    if (this._openPanel === name && !arg) { this.closePanels(); return; }
    this._openPanel = name; this.sheet.style.display = 'block';
    if (name === 'inv') this._renderInv();
    else if (name === 'craft') this._renderCraft();
    else if (name === 'health') this._renderHealth();
    else if (name === 'loot') this._renderLoot(arg);
  }
  _renderInv() {
    const G = this.G, p = G.player;
    this.sheetTitle.textContent = `Рюкзак — ${p.weight().toFixed(1)} / ${p.capacity()} кг`;
    this.sheetBody.innerHTML = '';
    this.sheetBody.appendChild(this._invList());
  }
  _invList() {
    const G = this.G, p = G.player;
    const wrap = el('div', 'mz-invlist');
    if (!p.inv.length) wrap.appendChild(el('div', 'mz-empty', 'Пусто. Обыскивайте дома, шкафы и трупы.'));
    const eqFirst = p.inv.slice().sort((a, b) => (b === p.equip) - (a === p.equip));
    for (const it of eqFirst) {
      const def = ITEMS[it.id];
      const row = el('div', 'mz-row' + (p.equip === it ? ' equipped' : ''));
      row.appendChild(itemIconCanvas(it.id));
      const mid = el('div', 'mz-row-mid');
      let meta = `${def.w * (it.n || 1) <= 0 ? '' : (def.w * (it.n || 1)).toFixed(1) + ' кг'}`;
      if (it.n > 1) meta = `×${it.n} · ${meta}`;
      if (it.cond !== undefined && isFinite(WEAPONS[it.id]?.condMax)) meta += ` · прочность ${Math.max(0, Math.round(it.cond / WEAPONS[it.id].condMax * 100))}%`;
      mid.appendChild(el('div', 'mz-row-name', def.name));
      mid.appendChild(el('div', 'mz-row-meta', meta));
      row.appendChild(mid);
      const btns = el('div', 'mz-row-btns');
      const mk = (label, cb, cls2 = '') => { const b = el('button', 'mz-mini ' + cls2, label); b.addEventListener('click', e => { e.stopPropagation(); cb(); }); btns.appendChild(b); };
      if (def.type === 'food') mk('Съесть', () => { p.eat(G, it); this._refreshOpen(); });
      else if (def.type === 'drink') mk('Выпить', () => { p.drink(G, it); this._refreshOpen(); });
      else if (def.type === 'weapon') mk(p.equip === it ? 'Снять' : 'Экип.', () => { p.equipItem(it); G.audio.pickup(); this._refreshOpen(); }, p.equip === it ? 'on' : '');
      else if (def.type === 'med') mk('Лечить', () => { G.togglePanel('health'); }, '');
      else if (def.type === 'cloth' || it.id === 'mat_sheet') mk('Порвать', () => { G.craftRip(it); this._refreshOpen(); });
      mk('✕', () => { G.dropFromInv(it); this._refreshOpen(); }, 'drop');
      row.appendChild(btns);
      wrap.appendChild(row);
    }
    return wrap;
  }
  _refreshOpen() {
    if (this._openPanel === 'inv') this._renderInv();
    else if (this._openPanel === 'loot' && this._lootArg) this._renderLoot(this._lootArg);
    else if (this._openPanel === 'craft') this._renderCraft();
    else if (this._openPanel === 'health') this._renderHealth();
    this._refreshHud();
  }
  _renderLoot(arg) {
    this._lootArg = arg;
    const G = this.G;
    this.sheetTitle.textContent = arg.title;
    const body = this.sheetBody; body.innerHTML = '';
    const cols = el('div', 'mz-lootcols');
    // контейнер
    const colL = el('div', 'mz-col');
    colL.appendChild(el('div', 'mz-col-title', arg.sourceName));
    const listC = el('div', 'mz-invlist short');
    if (!arg.items.length) listC.appendChild(el('div', 'mz-empty', 'Пусто…'));
    for (const it of arg.items) {
      const def = ITEMS[it.id];
      const row = el('div', 'mz-row');
      row.appendChild(itemIconCanvas(it.id));
      const mid = el('div', 'mz-row-mid');
      mid.appendChild(el('div', 'mz-row-name', def.name + (it.n > 1 ? ` ×${it.n}` : '')));
      mid.appendChild(el('div', 'mz-row-meta', `${(def.w * (it.n || 1)).toFixed(1)} кг`));
      row.appendChild(mid);
      const take = el('button', 'mz-mini', 'Взять');
      take.addEventListener('click', () => { arg.onTake(it); this._renderLoot(arg); });
      row.appendChild(take);
      listC.appendChild(row);
    }
    colL.appendChild(listC);
    if (arg.items.length) {
      const all = el('button', 'mz-mini wide', 'ВЗЯТЬ ВСЁ');
      all.addEventListener('click', () => { arg.onTakeAll(); this._renderLoot(arg); });
      colL.appendChild(all);
    }
    // инвентарь
    const colR = el('div', 'mz-col');
    colR.appendChild(el('div', 'mz-col-title', `Инвентарь · ${G.player.weight().toFixed(1)}/${G.player.capacity()} кг`));
    const invWrap = el('div', 'mz-invlist short'); invWrap.appendChild(this._invList());
    colR.appendChild(invWrap);
    cols.appendChild(colL); cols.appendChild(colR);
    body.appendChild(cols);
  }
  _renderCraft() {
    const G = this.G, p = G.player;
    this.sheetTitle.textContent = 'Крафт';
    const body = this.sheetBody; body.innerHTML = '';
    const wrap = el('div', 'mz-invlist');
    // порвать всю одежду разом
    const rippables = p.findType(d => d.type === 'cloth' || d.type === 'mat');
    const ripCount = rippables.filter(i => ITEMS[i.id].type === 'cloth' || i.id === 'mat_sheet').length;
    const r1 = el('div', 'mz-recipe');
    r1.appendChild(el('div', 'mz-recipe-info', `<b>Порвать на ткань</b><span>из одежды/простыни → Рваная ткань ×2 (есть: ${ripCount})</span>`));
    const b1 = el('button', 'mz-mini', 'Сделать');
    b1.disabled = ripCount === 0;
    b1.addEventListener('click', () => { const it = p.inv.find(i => ITEMS[i.id].type === 'cloth' || i.id === 'mat_sheet'); if (it) { G.craftRip(it); this._renderCraft(); } });
    r1.appendChild(b1); wrap.appendChild(r1);
    // бита с гвоздями
    const needBat = p.count('w_bat'), needNails = p.count('mat_nails');
    const r2 = el('div', 'mz-recipe');
    r2.appendChild(el('div', 'mz-recipe-info', `<b>Бита с гвоздями</b><span>Бита (${needBat}/1) + Гвозди (${needNails}/4)</span>`));
    const b2 = el('button', 'mz-mini', 'Сделать');
    b2.disabled = !(needBat >= 1 && needNails >= 4);
    b2.addEventListener('click', () => { G.craftSpikedBat(); this._renderCraft(); });
    r2.appendChild(b2); wrap.appendChild(r2);
    // подсказка про баррикады
    wrap.appendChild(el('div', 'mz-hint', 'Доски и гвозди используются для баррикад: подойдите к окну с молотком в инвентаре и выберите «Забаррикадировать» (действие [E]).'));
    body.appendChild(wrap);
  }
  _renderHealth() {
    const G = this.G, p = G.player;
    this.sheetTitle.textContent = `Здоровье — ${Math.round(p.bodyHp())}%`;
    const body = this.sheetBody; body.innerHTML = '';
    const wrap = el('div', 'mz-invlist');
    if (p.knox >= 0) wrap.appendChild(el('div', 'mz-hint danger', `Лихорадка Нокса: ${Math.round(clamp(p.knox, 0, 100))}%. Вы чувствуете, как что-то растёт внутри. Лечения нет.`));
    const hasBand = p.count('med_bandage'), hasRipp = p.count('med_ripped'), hasDis = p.count('med_disinfect'), hasPills = p.count('med_pills'), hasAb = p.count('med_antibio');
    wrap.appendChild(el('div', 'mz-medline', `Бинт ×${hasBand} · Ткань ×${hasRipp} · Антисептик ×${hasDis} · Обезбол ×${hasPills} · Антибиотики ×${hasAb}`));
    const WOUND = { scratch: 'Царапина', lacer: 'Глубокая рана', bite: 'УКУС' };
    for (const key of ['head', 'torso', 'larm', 'rarm', 'lleg', 'rleg']) {
      const P = p.parts[key];
      const row = el('div', 'mz-part');
      const statuses = [];
      if (P.wound) statuses.push(`<b class="w">${WOUND[P.wound]}</b>`);
      if (P.bleeding) statuses.push('<b class="b">кровотечение</b>');
      if (P.bandage) statuses.push(P.bandage === 'clean' ? 'перевязано' : 'грязная повязка');
      if (P.infected) statuses.push('<b class="i">инфицировано</b>');
      const hpCls = P.hp > 75 ? 'ok' : P.hp > 45 ? 'mid' : 'low';
      row.innerHTML = `
        <div class="mz-part-head"><span>${PART_NAMES[key]}</span><span class="mz-hp-num ${hpCls}">${Math.round(P.hp)}</span></div>
        <div class="mz-part-bar"><i class="${hpCls}" style="width:${P.hp}%"></i></div>
        ${statuses.length ? `<div class="mz-part-status">${statuses.join(' · ')}</div>` : ''}`;
      const btns = el('div', 'mz-row-btns');
      if (P.wound || P.bleeding) {
        if (hasBand || hasRipp) {
          const b = el('button', 'mz-mini', hasBand ? 'Бинт' : 'Ткань');
          b.addEventListener('click', () => { const it = p.inv.find(i => i.id === (hasBand ? 'med_bandage' : 'med_ripped')); p.useMed(G, it, key); this._renderHealth(); });
          btns.appendChild(b);
        }
        if (hasDis) {
          const d = el('button', 'mz-mini', 'Антисептик');
          d.addEventListener('click', () => { const it = p.inv.find(i => i.id === 'med_disinfect'); p.useMed(G, it, key); this._renderHealth(); });
          btns.appendChild(d);
        }
      }
      if (btns.children.length) row.appendChild(btns);
      wrap.appendChild(row);
    }
    if (hasPills) {
      const pb = el('button', 'mz-mini wide', `Принять обезболивающее (боль: ${Math.round(p.pain)})`);
      pb.addEventListener('click', () => { const it = p.inv.find(i => i.id === 'med_pills'); p.useMed(G, it); this._renderHealth(); });
      wrap.appendChild(pb);
    }
    if (hasAb) {
      const ab = el('button', 'mz-mini wide', 'Принять антибиотики');
      ab.addEventListener('click', () => { const it = p.inv.find(i => i.id === 'med_antibio'); p.useMed(G, it); this._renderHealth(); });
      wrap.appendChild(ab);
    }
    body.appendChild(wrap);
  }
  // ================= экраны =================
  _overlay(cls, html) {
    const o = el('div', 'mz-overlay ' + cls, html);
    this.root.appendChild(o);
    return o;
  }
  showTitle(bestDays) {
    const G = this.G;
    const o = this._overlay('mz-title', `
      <div class="mz-title-scratch">МЁРТВЫЙ ГОРОД</div>
      <div class="mz-title-sub">— это история вашей смерти —</div>
      <div class="mz-title-desc">Зомби-выживание в духе Project Z*build41.<br>Слышат всё. Видят вас. Укус — конец.</div>
      <button class="mz-big-start">ВЫЖИВАТЬ</button>
      <div class="mz-title-best">${bestDays > 0 ? `Рекорд выживания: ${bestDays} дн.` : 'Пока никто не выжил.'}</div>
      <div class="mz-title-help">
        <b>Телефон:</b> левый стик — движение (до упора — бег) · кнопка кулака: тап — удар, удержание+свайп — прицел и сильный замах · [рука] — контекстное действие (удержание — все действия)<br>
        <b>ПК:</b> WASD — ходьба · Shift — бег · Ctrl — красться · ЛКМ — атака (удерж. — прицел) · ПКМ — толчок · E — действие · I/C/H — рюкзак/крафт/здоровье · F — фонарь
      </div>
      <div class="mz-title-note">Наденьте наушники. Устанавливается как PWA — работает оффлайн.</div>`);
    o.querySelector('.mz-big-start').addEventListener('click', () => {
      G.audio.unlock(); G.startGame();
      o.classList.add('out'); setTimeout(() => o.remove(), 600);
      this._modalOpen = false;
    });
    this._modalOpen = true;
  }
  showDeath(stats) {
    const o = this._overlay('mz-death', `
      <div class="mz-death-skull">${svgIcon('skull', 72)}</div>
      <div class="mz-death-title">ВЫ ПОГИБЛИ</div>
      <div class="mz-death-cause">${stats.cause}</div>
      <div class="mz-death-stats">Выжито дней: <b>${stats.days}</b> · Убито зомби: <b>${stats.kills}</b>${stats.best > 0 ? `<br>Рекорд: ${stats.best} дн.` : ''}</div>
      <button class="mz-big-start red">НАЧАТЬ ЗАНОВО</button>`);
    o.querySelector('.mz-big-start').addEventListener('click', () => location.reload());
    this._modalOpen = true;
  }
  showPause() {
    if (this._pauseEl) { this._pauseEl.remove(); this._pauseEl = null; this._modalOpen = false; return; }
    const G = this.G;
    const o = this._overlay('mz-pause', `
      <div class="mz-pause-box">
        <div class="mz-pause-title">ПАУЗА</div>
        <button class="mz-menu-btn" data-a="resume">Продолжить</button>
        <button class="mz-menu-btn" data-a="mute">${G.audio.muted ? 'Включить звук' : 'Выключить звук'}</button>
        <button class="mz-menu-btn red" data-a="restart">Начать заново</button>
        <div class="mz-title-help" style="margin-top:12px">Слышат шаги, выстрелы, сирены. Крадитесь за деревьями. Лечите кровотечения сразу. Укус неизлечим — не дайте себя укусить.</div>
      </div>`);
    o.addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.a;
      if (a === 'resume') { o.remove(); this._pauseEl = null; this._modalOpen = false; }
      else if (a === 'mute') { G.toggleMute(); o.remove(); this._pauseEl = null; this._modalOpen = false; }
      else if (a === 'restart') location.reload();
      else if (e.target === o) { o.remove(); this._pauseEl = null; this._modalOpen = false; }
    });
    this._pauseEl = o; this._modalOpen = true;
  }
  fade(cb, holdMs = 900, label = '') {
    this.fader.textContent = label;
    this.fader.classList.add('black');
    setTimeout(() => { cb && cb(); setTimeout(() => this.fader.classList.remove('black'), holdMs); }, 650);
  }
  // ================= тик =================
  update(dt) {
    this._tHud += dt;
    if (this._tHud > .22) { this._tHud = 0; this._refreshHud(); this._refreshMoodles(); }
    this._tMap += dt;
    if (this._tMap > .55) { this._tMap = 0; this.drawMinimap(); }
  }
}
