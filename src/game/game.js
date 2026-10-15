function safeGetBest() { try { return parseInt(localStorage.getItem('mz_best') || '0', 10) || 0; } catch { return 0; } }

// ===================== game.js — оркестратор, цикл, действия, события =====================
import * as CONSTS from './consts.js';
import { TILE, ITEMS, clamp, rand, randi, chance, dist, svgIcon } from './consts.js';
import { World, FURN } from './world.js';
import { ZombieSys } from './zombies.js';
import { Player } from './player.js';
import { Engine } from './engine.js';
import { AudioSys } from './audio.js';
import { InputSys } from './input.js';
import { UI } from './ui.js';

export function createGame(root) {
  const G = {
    consts: CONSTS,
    started: false, over: false,
    stats: { kills: 0, daysSurvived: 0 },
    best: safeGetBest(),
    alarm: null, heli: null,
    delays: [],
    timed: null,
    actions: [],
    _ctxT: 0, _introT: 0,
  };
  // ---------- построение ----------
  root.innerHTML = '';
  root.className = 'mz-root';
  const cv = document.createElement('canvas');
  cv.className = 'mz-canvas';
  root.appendChild(cv);
  G.audio = new AudioSys();
  G.world = new World();
  G.engine = new Engine(cv, G);
  G.zombies = new ZombieSys(G.world);
  G.player = new Player(G);
  G.engine.cam.x = G.player.tx * TILE; G.engine.cam.y = G.player.ty * TILE;
  G.input = new InputSys(root, G);
  G.ui = new UI(root, G);

  // ---------- помощники ----------
  G.log = (msg, cls) => G.ui.log(msg, cls);
  G.delay = (sec, fn) => { G.delays.push({ t: sec, fn }); };
  G.makeNoise = (x, y, r) => { G.zombies.hear(x, y, r); };
  G.onZombieAttack = (z) => {
    if (G.player.dead || G.over) return;
    G.engine.shake(.7);
    G.player.applyZombieHit(z, G);
  };
  G.dropFromInv = (it) => {
    const p = G.player;
    const i = p.inv.indexOf(it); if (i < 0) return;
    if (p.equip === it) p.equip = null;
    p.inv.splice(i, 1);
    G.world.dropItem(Math.floor(p.tx), Math.floor(p.ty), it);
    G.log(`Выброшено: ${ITEMS[it.id].name}`, 'muted');
    G.audio.uiClick();
  };
  G.craftRip = (it) => {
    const p = G.player;
    p._consume(it);
    p.addItem({ id: 'med_ripped', n: 2 });
    G.audio.clothTear(); G.log('Одежда порвана на ткань (+2)');
  };
  G.craftSpikedBat = () => {
    const p = G.player;
    if (!(p.count('w_bat') >= 1 && p.count('mat_nails') >= 4)) return;
    p.removeItems('w_bat', 1); p.removeItems('mat_nails', 4);
    p.addItem({ id: 'w_bat_nails', n: 1 });
    G.audio.craft(); G.log('Создано: Бита с гвоздями. Неприятная штука.');
  };
  G.toggleTorch = () => {
    const p = G.player;
    if (!p.hasItem('tool_torch')) { G.log('Нет фонарика. Ищите в домах.', 'muted'); return; }
    p.torchOn = !p.torchOn; G.audio.uiClick();
    G.log(p.torchOn ? 'Фонарик включён. Вас лучше видно ночью…' : 'Фонарик выключен', 'muted');
  };
  G.toggleMute = () => { G.audio.unlock(); G.audio.setMuted(!G.audio.muted); G.ui._muteIcon(); };
  G.escapePressed = () => {
    if (G.ui.ctxMenu.style.display === 'block') { G.ui.ctxMenu.style.display = 'none'; return; }
    if (G.ui.anyPanelOpen()) { G.ui.closePanels(); return; }
    G.ui.showPause();
  };
  G.togglePanel = (name) => { G.ui.openPanel(name); };
  G.startTimed = (dur, label, onDone, opts = {}) => {
    G.timed = { t: 0, dur, label, onDone, x: G.player.tx, y: G.player.ty, canMove: opts.canMove };
  };

  // ---------- события мира ----------
  G.onNewDay = () => {
    const d = G.world.time.day;
    G.log(`Наступил день ${d}. Вы всё ещё живы.`, 'good');
    if (d === 2) G.delay(20, () => { if (!G.over && Math.random() < .9) startHeli(); });
    if (d === 3) G.log('Чувствуете? Город будто просыпается… их стало больше.', 'warn');
  };
  function startHeli() {
    G.heli = { t: 46, pulse: 0, told: false };
    G.audio.heliStart();
    G.log('Гул над городом… ВЕРТОЛЁТ?!', 'danger');
  }
  function triggerAlarm(house) {
    if (G.alarm || house.alarmFired) return;
    house.alarmFired = true;
    G.alarm = { house, t: 34, pulse: 0 };
    G.audio.alarmStart();
    G.log('СИГНАЛИЗАЦИЯ! Все в округе всё слышали!!', 'fatal');
  }

  // ---------- контекстные действия ----------
  function scanContext() {
    const p = G.player, w = G.world;
    const acts = [];
    if (p.dead || G.over) { G.actions = []; return; }
    const ptx = Math.floor(p.tx), pty = Math.floor(p.ty);
    const seen = new Set();
    // ближайшие клетки в радиусе 2
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = ptx + dx, y = pty + dy;
      const dTiles = Math.hypot(x + .5 - p.tx, y + .5 - p.ty);
      if (dTiles > 2.1) continue;
      const k = x + y * 1e6;
      if (seen.has(k)) continue; seen.add(k);
      // мебель-контейнеры
      const f = w.furnCell(x, y);
      if (f) {
        const fd = FURN[f.kind];
        if (fd.loot && dTiles < 2.05) acts.push({
          label: `Обыскать: ${fd.name}`, icon: 'search', fn: () => searchFurniture(f),
        });
        else if (fd.bed && dTiles < 2.05) acts.push({
          label: 'Спать (6–7 ч, [риск])', icon: 'bed', fn: () => trySleep(f),
        });
      }
      // трупы
      for (const c of w.corpses) {
        if (c._ctx) continue;
        const cd = dist(c.x / TILE, c.y / TILE, p.tx, p.ty);
        if (cd < 1.6) { c._ctx = true; acts.push({ label: 'Обыскать труп', icon: 'search', fn: () => searchCorpse(c, acts) }); break; }
      }
      // вещи на земле
      const pile = w.ground.get(x + y * CONSTS.MAP_W);
      if (pile && pile.length && dTiles < 2.05) acts.push({
        label: `Осмотреть предметы (×${pile.length})`, icon: 'bag', fn: () => openGroundPile(x, y),
      });
      // двери
      const door = w.doorAt(x, y);
      if (door && dTiles < 1.9) acts.push({
        label: door.open ? 'Закрыть дверь' : 'Открыть дверь', icon: 'door',
        fn: () => {
          w.toggleDoor(x, y); G.audio.doorCreak(); G.makeNoise(x, y, 5);
          if (door.open && door.house && door.house.alarmed && isPlayerNearHouse(door.house)) triggerAlarm(door.house);
        },
      });
      // окна
      const win = w.windowAt(x, y);
      if (win && dTiles < 1.9) {
        if (!win.broken) acts.push({
          label: win.open ? 'Закрыть окно' : 'Открыть окно', icon: 'door',
          fn: () => {
            if (win.planks >= 3) { G.log('Окно заколочено', 'muted'); return; }
            w.toggleWindow(x, y); G.audio.doorCreak(); G.makeNoise(x, y, 4);
            if (win.open && win.house && win.house.alarmed && isPlayerNearHouse(win.house)) triggerAlarm(win.house);
          },
        });
        if ((win.open || win.broken) && win.planks === 0) acts.push({
          label: 'Перелезть через окно', icon: 'run', fn: () => climbWindow(x, y, win),
        });
        // занавеска
        if (!win.broken && !win.open && dTiles < 1.9) {
          if (win.curtain) acts.push({ label: 'Снять занавеску', icon: 'hand', fn: () => { win.curtain = false; G.player.addItem({ id: 'mat_sheet', n: 1 }); G.audio.clothTear(); G.log('Занавеска снята (+простыня)'); } });
          else if (p.hasItem('mat_sheet')) acts.push({ label: 'Повесить занавеску', icon: 'hand', fn: () => { p.removeItems('mat_sheet', 1); win.curtain = true; G.audio.clothTear(); G.log('Занавеска скрывает вас изнутри', 'good'); } });
        }
        // баррикада
        const canBoard = p.hasItem('w_hammer') && p.hasItem('mat_plank') && p.count('mat_nails') >= 2 && win.planks < 4;
        if (canBoard) acts.push({
          label: `Забаррикадировать (${win.planks}/4)`, icon: 'build',
          fn: () => barricade(x, y, win),
        });
        if (win.planks > 0 && p.hasItem('w_hammer')) acts.push({
          label: 'Разобрать баррикаду', icon: 'build', fn: () => {
            G.startTimed(2.2, 'Разбираем…', () => { win.planks--; win.hp = 30; p.addItem({ id: 'mat_plank', n: 1 }); G.audio.hammerHit(); G.makeNoise(x, y, 9); });
          },
        });
      }
    }
    // сортировка: опасное/главное вперёд
    G.actions = acts.slice(0, 6);
  }
  function isPlayerNearHouse(h) {
    const p = G.player;
    return p.tx > h.x - 3 && p.tx < h.x + h.w + 3 && p.ty > h.y - 3 && p.ty < h.y + h.h + 3;
  }
  function climbWindow(x, y, win) {
    const p = G.player, w = G.world;
    // сторона: куда перелезть — напротив игрока относительно окна
    const cands = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    let best = null, bd = -1;
    for (const [cx, cy] of cands) {
      if (w.isSolid(cx, cy)) continue;
      const d = dist(cx + .5, cy + .5, p.tx, p.ty);
      if (d > bd) { bd = d; best = [cx, cy]; }
    }
    if (!best) { G.log('Некуда перелезть', 'muted'); return; }
    p.tx = best[0] + .5; p.ty = best[1] + .5;
    G.audio.bush(); G.makeNoise(x, y, 4);
    if (win.broken && Math.random() < .35) {
      const arm = Math.random() < .5 ? 'larm' : 'rarm';
      p.parts[arm].hp -= rand(4, 9); p.parts[arm].wound = 'scratch'; p.parts[arm].bleeding = 1;
      G.log('Вы порезались о стекло!', 'danger'); G.audio.hurtPlayer();
    }
    if (win.house && win.house.alarmed && isPlayerNearHouse(win.house)) triggerAlarm(win.house);
  }
  function barricade(x, y, win) {
    const p = G.player;
    if (!(p.hasItem('w_hammer') && p.hasItem('mat_plank') && p.count('mat_nails') >= 2)) return;
    G.startTimed(2.6, 'Прибиваем доску…', () => {
      p.removeItems('mat_plank', 1); p.removeItems('mat_nails', 2);
      win.planks++; win.hp = 30 * win.planks;
      G.audio.hammerHit(); G.delay(.3, () => G.audio.hammerHit());
      G.makeNoise(x, y, 10);
      G.log(`Противник за дверью не пройдёт. Досок: ${win.planks}/4`, 'good');
    });
  }
  function trySleep(f) {
    const p = G.player;
    const ch = G.zombies.nearestChasing(p.tx, p.ty);
    if (ch.z && ch.d < 12) { G.log('Слишком опасно — зомби рядом!', 'danger'); return; }
    if (p.fatigue < 25 && !G.world.isNight()) { G.log('Вы пока не устали', 'muted'); return; }
    if (p.pain > 55) { G.log('Боль не даёт уснуть. Примите обезболивающее.', 'warn'); return; }
    G.ui.fade(() => {
      const mins = 360 + randi(0, 90);
      // продвигаем мир на mins игровых минут (world.update принимает реальные секунды → ×2 игр. мин)
      let rem = mins;
      while (rem > 0) { const c = Math.min(rem, 90); G.world.update(c / 2, G); rem -= c; }
      p.sleepTick(mins, G);
      if (!p.dead) {
        G.log('Вы просыпаетесь. ' + (p.hunger > 60 ? 'Сосёт под ложечкой.' : p.thirst > 60 ? 'Во рту пересохло.' : 'Стало немного легче.'), '');
        G.makeNoise(p.tx, p.ty, 2);
      }
    }, 900, 'Сон…');
  }
  function searchFurniture(f) {
    const p = G.player;
    const facing = Math.atan2(f.y + .5 - p.ty, f.x + .5 - p.tx);
    p.a = facing;
    G.startTimed(2.1, 'Обыскиваем…', () => {
      f.searched = true;
      const items = G.world.containerItems(f);
      G.audio.pickup();
      openLootUI(`Обыскано: ${FURN[f.kind].name}`, FURN[f.kind].name, items);
    });
  }
  function searchCorpse(c) {
    G.startTimed(1.4, 'Обыск трупа…', () => {
      c.searched = true;
      if (c.items === null) {
        c.items = [];
        const rolls = Math.random() < .55 ? randi(1, 2) : 0;
        for (let i = 0; i < rolls; i++) {
          const t = [['med_ripped', 2], ['ammo_9mm', 1], ['med_bandage', 1], ['med_pills', .6], ['cloth_shirt', 1.2], ['drink_soda', .8]];
          let r = Math.random() * t.reduce((s, e) => s + e[1], 0);
          for (const [id, wgt] of t) { r -= wgt; if (r <= 0) { c.items.push({ id, n: id === 'ammo_9mm' ? randi(3, 8) : 1 }); break; } }
        }
      }
      openLootUI('Труп', 'Карманы', c.items);
    });
  }
  function openGroundPile(x, y) {
    const pile = G.world.groundPile(x, y);
    openLootUI('На земле', 'Предметы', pile);
  }
  function openLootUI(title, sourceName, items) {
    G.ui.openPanel('loot', {
      title, sourceName, items,
      onTake: (it) => {
        const i = items.indexOf(it); if (i >= 0) items.splice(i, 1);
        const copy = { id: it.id, n: it.n }; if (it.cond !== undefined) copy.cond = it.cond;
        G.player.addItem(copy); G.audio.pickup();
        G.log(`Взято: ${ITEMS[it.id].name}${it.n > 1 ? ' ×' + it.n : ''}`, 'good');
      },
      onTakeAll: () => {
        let n = 0;
        while (items.length) { const it = items.shift(); const copy = { id: it.id, n: it.n }; if (it.cond !== undefined) copy.cond = it.cond; G.player.addItem(copy); n++; }
        if (n) { G.audio.pickup(); G.log(`Взято предметов: ${n}`, 'good'); }
      },
    });
  }
  G.doContextAction = () => {
    scanContext();
    const a = G.actions[0];
    if (a) a.fn(); else G.log('Здесь нечего делать', 'muted');
  };

  // ---------- смерть/старт ----------
  G.onPlayerDeath = (cause) => {
    if (G.over) return;
    G.over = true;
    const days = G.world.time.day - 1 + (G.world.hour() >= 9 ? 1 : 0);
    const daysShown = Math.max(0, G.world.time.day - 1);
    const best = Math.max(G.best, daysShown);
    try { localStorage.setItem('mz_best', String(best)); } catch (e) { console.warn('Не удалось сохранить рекорд:', e); }
    G.audio.sting();
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([200, 100, 300]);
    G.ui.fade(() => {
      G.ui.showDeath({ cause, days: daysShown, kills: G.stats.kills, best });
    }, 1200, 'Тьма…');
  };
  G.startGame = () => {
    G.started = true;
    G.log('Это Конец Света, день первый. 9:00 утра.', '');
    G.delay(4, () => G.log('Обыскивайте дома: еда, вода, оружие, бинты.', 'good'));
    G.delay(11, () => G.log('Слышите стоны? Они тянутся на звук. Крадитесь (значок глаза).', 'warn'));
    G.delay(20, () => G.log('Укус неизлечим. Не дайте им подойти близко.', 'fatal'));
  };

  // ---------- главный цикл ----------
  let frameN = 0;
  G.frame = (dtRaw) => {
    // задержки идут по реальному времени (кроме паузы-экранов)
    if (!G.started || G.over) {
      G.engine.updateFx(dtRaw);
      G.ui.update(dtRaw);
      return;
    }
    const slow = G.ui.anyPanelOpen() ? .22 : 1;
    const dt = dtRaw * slow;
    // очередь отложенных вызовов
    for (let i = G.delays.length - 1; i >= 0; i--) {
      G.delays[i].t -= dt;
      if (G.delays[i].t <= 0) { const d = G.delays.splice(i, 1)[0]; d.fn(); }
    }
    // таймер действий
    if (G.timed) {
      const T = G.timed, p = G.player;
      if (!T.canMove && (Math.abs(p.tx - T.x) > .08 || Math.abs(p.ty - T.y) > .08)) {
        G.timed = null; G.ui.setRing(null); G.log('Действие прервано', 'muted');
      } else {
        T.t += dtRaw;
        G.ui.setRing(clamp(T.t / T.dur, 0, 1), T.label);
        if (T.t >= T.dur) { G.timed = null; G.ui.setRing(null); T.onDone(); }
      }
    }
    G.world.update(dt, G);
    G.player.update(dt, G);
    G.zombies.update(dt, G);
    // сирена дома
    if (G.alarm) {
      G.alarm.t -= dt; G.alarm.pulse -= dt;
      const h = G.alarm.house, hx = h.x + h.w / 2, hy = h.y + h.h / 2;
      if (G.alarm.pulse <= 0) { G.alarm.pulse = 1.5; G.makeNoise(hx, hy, 66); }
      if (G.alarm.t <= 0) { G.alarm = null; G.audio.alarmStop(); G.log('Сирена заглохла…', ''); }
    }
    // вертолёт
    if (G.heli) {
      G.heli.t -= dt; G.heli.pulse -= dt;
      if (!G.heli.told && G.heli.t < 40) { G.heli.told = true; G.log('Он кружит над вами. Все зомби в городе услышат это.', 'warn'); }
      if (G.heli.pulse <= 0) { G.heli.pulse = 4; G.makeNoise(G.player.tx, G.player.ty, 80); }
      if (G.heli.t <= 0) { G.heli = null; G.audio.heliStop(); G.log('Вертолёт ушёл. Но они уже идут сюда…', 'danger'); }
    }
    // скан контекста
    G._ctxT -= dt;
    if (G._ctxT < 0) {
      G._ctxT = .15;
      for (const c of G.world.corpses) c._ctx = false;
      scanContext();
      G.ui.setContext(G.actions);
    }
    G.engine.updateFx(dt);
    G.ui.update(dtRaw);
    G.audio.tick(dt, G);
    frameN++;
  };

  // ---------- запуск ----------
  if (typeof window !== 'undefined') window.__G = G; // отладка
  G.ui.showTitle(G.best);
  G.engine.start();
  return () => { G.engine.stop(); };
}
