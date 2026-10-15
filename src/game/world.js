// ===================== world.js — карта, генерация, LOS, время, погода =====================
import { TILE, MAP_W, MAP_H, T, SOLID_TILES, GM_PER_SEC, clamp, lerp, rand, randi, chance, pick, key2, hash2 } from './consts.js';

const idx = (x, y) => x + y * MAP_W;
const inB = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

// ---------- Мебель ----------
export const FURN = {
  fridge:   { name: 'Холодильник',  loot: 'fridge',   solid: true },
  counter:  { name: 'Кухонная тумба', loot: 'kitchen', solid: true },
  wardrobe: { name: 'Шкаф',         loot: 'wardrobe', solid: true },
  sidetable:{ name: 'Тумбочка',     loot: 'side',     solid: true },
  bath:     { name: 'Полка в ванной', loot: 'bath',   solid: true },
  shelf:    { name: 'Стеллаж',      loot: 'garage',   solid: true },
  gasholder:{ name: 'Полки магазина', loot: 'store',  solid: true },
  medcase:  { name: 'Аптечный шкаф', loot: 'pharm',   solid: true },
  bed:      { name: 'Кровать',      solid: true, bed: true },
  sofa:     { name: 'Диван',        solid: true, bed: true },
  table:    { name: 'Стол',         solid: true },
  tv:       { name: 'Телевизор',    solid: true },
};

// ---------- Таблицы лута: [itemId, вес, [min,max]] ----------
const LOOT = {
  fridge:  [['food_beans', 3, [1, 2]], ['food_apple', 3, [1, 2]], ['drink_water', 3, [1, 1]], ['drink_soda', 2, [1, 2]]],
  kitchen: [['food_beans', 3, [1, 2]], ['food_chips', 3, [1, 2]], ['w_pan', 2, [1, 1]], ['w_knife', 2, [1, 1]], ['drink_soda', 2, [1, 1]]],
  wardrobe:[['cloth_shirt', 4, [1, 2]], ['cloth_pants', 3, [1, 1]], ['mat_sheet', 3, [1, 2]], ['bag_school', .7, [1, 1]], ['med_ripped', 1, [1, 2]]],
  side:    [['drink_soda', 2, [1, 1]], ['food_chips', 2, [1, 1]], ['ammo_9mm', 1.6, [4, 10]], ['w_pistol', .5, [1, 1]], ['tool_torch', .8, [1, 1]], ['med_pills', 1, [1, 1]]],
  bath:    [['med_bandage', 3, [1, 2]], ['med_disinfect', 2.5, [1, 1]], ['med_pills', 2, [1, 1]], ['med_antibio', 1.2, [1, 1]], ['med_ripped', 1.5, [1, 2]]],
  garage:  [['w_hammer', 2, [1, 1]], ['mat_nails', 3, [3, 8]], ['mat_plank', 3, [1, 3]], ['w_axe', .5, [1, 1]], ['w_bat', 1.4, [1, 1]], ['tool_torch', 1.2, [1, 1]], ['bag_hike', .4, [1, 1]]],
  store:   [['food_beans', 4, [1, 2]], ['food_chips', 4, [1, 2]], ['drink_water', 4, [1, 1]], ['drink_soda', 3, [1, 2]], ['food_apple', 2, [1, 2]], ['w_bat', .6, [1, 1]]],
  pharm:   [['med_bandage', 3, [1, 2]], ['med_antibio', 2, [1, 2]], ['med_disinfect', 2, [1, 1]], ['med_pills', 3, [1, 2]]],
  corpse:  [['med_ripped', 2, [1, 1]], ['ammo_9mm', .8, [3, 7]], ['med_bandage', .8, [1, 1]], ['med_pills', .5, [1, 1]], ['cloth_shirt', 1.2, [1, 1]]],
};
function rollLoot(tableKey, bonus = 0) {
  const t = LOOT[tableKey]; if (!t) return [];
  const items = [];
  const rolls = randi(1, 2) + bonus;
  for (let i = 0; i < rolls; i++) {
    const total = t.reduce((s, e) => s + e[1], 0); let r = Math.random() * total;
    for (const [id, w, [a, b]] of t) { r -= w; if (r <= 0) { items.push({ id, n: Math.random() < .5 ? a : b }); break; } }
  }
  return items;
}

export class World {
  constructor(seed) {
    this.seed = seed || ((Math.random() * 1e9) | 0);
    let s = this.seed; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    this.grid = new Uint8Array(MAP_W * MAP_H);
    this.roof = new Uint8Array(MAP_W * MAP_H);
    this.explored = new Uint8Array(MAP_W * MAP_H);
    this.doors = new Map();    // key -> {open,hp,maxHp}
    this.windows = new Map();  // key -> {open,curtain,planks,broken,hp}
    this.furn = [];            // {x,y,kind,searched,items}
    this.furnAt = new Map();
    this.houses = [];          // {x,y,w,h,alarmed}
    this.lamps = [];           // {x,y} тайлы
    this.ground = new Map();   // key -> [{id,n}]
    this.corpses = [];         // {x,y(px),rot,items,searched}
    this.time = { min: 9 * 60, day: 1 };
    this.weather = { rain: 0, rainTarget: 0, state: 'clear', nextChange: this.time.min + randi(180, 420), storm: false };
    this.flash = 0; // вспышка молнии
    this._gen(rnd);
  }

  // ============================ ГЕНЕРАЦИЯ ============================
  _gen(rnd) {
    const R = (a, b) => a + rnd() * (b - a), RI = (a, b) => Math.floor(R(a, b + 1));
    this.grid.fill(T.GRASS);
    // пятна грязи
    for (let i = 0; i < 260; i++) { const x = RI(2, MAP_W - 3), y = RI(2, MAP_H - 3); if (rnd() < .7) this.grid[idx(x, y)] = T.DIRT; }
    // дороги
    const roadsV = [], roadsH = [];
    for (let x = 12; x < MAP_W - 12; x += 30) roadsV.push(x);
    for (let y = 12; y < MAP_H - 12; y += 30) roadsH.push(y);
    this.roadsV = roadsV; this.roadsH = roadsH;
    for (const rx of roadsV) for (let y = 5; y < MAP_H - 5; y++) {
      for (let x = rx; x < rx + 4; x++) this.grid[idx(x, y)] = T.ROAD;
      this.grid[idx(rx - 1, y)] = T.SIDE; this.grid[idx(rx + 4, y)] = T.SIDE;
    }
    for (const ry of roadsH) for (let x = 5; x < MAP_W - 5; x++) {
      for (let y = ry; y < ry + 4; y++) this.grid[idx(x, y)] = T.ROAD;
      this.grid[idx(x, ry - 1)] = T.SIDE; this.grid[idx(x, ry + 4)] = T.SIDE;
    }
    // фонари на перекрёстках
    for (const rx of roadsV) for (const ry of roadsH) {
      if (rnd() < .5) this.lamps.push({ x: rx - 1, y: ry - 1 });
      if (rnd() < .5) this.lamps.push({ x: rx + 4, y: ry + 4 });
    }
    // разбитые машины
    for (let i = 0; i < 12; i++) {
      const vert = rnd() < .5;
      const rx = pick(roadsV) + RI(0, 3), ry = pick(roadsH) + RI(0, 3);
      const x = vert ? rx : RI(8, MAP_W - 10), y = vert ? RI(8, MAP_H - 10) : ry;
      if (this._clear(x, y, 2, 2)) {
        this.grid[idx(x, y)] = T.CAR;
        this.grid[idx(vert ? x : x + 1, vert ? y + 1 : y)] = T.CAR;
      }
    }
    // кварталы между дорогами
    for (let bi = 0; bi < roadsV.length; bi++) for (let bj = 0; bj < roadsH.length; bj++) {
      const bx = roadsV[bi] + 5, by = roadsH[bj] + 5;
      const bw = (roadsV[bi + 1] !== undefined ? roadsV[bi + 1] - 1 : MAP_W - 8) - bx;
      const bh = (roadsH[bj + 1] !== undefined ? roadsH[bj + 1] - 1 : MAP_H - 8) - by;
      if (bw < 14 || bh < 14) continue;
      const roll = rnd();
      if (roll < .55) { // жилой квартал — 1–2 дома
        const placed = this._house(bx + RI(0, 2), by + RI(0, Math.max(0, bh - RI(8, 11))), RI(9, 12), RI(8, 11), rnd, RI);
        for (let tr = 0; tr < 8; tr++) {
          const hw = RI(9, 12), hh = RI(8, 11);
          const hx = bx + RI(2, Math.max(2, bw - hw - 1)), hy = by + RI(0, Math.max(0, bh - hh));
          if (this._house(hx, hy, hw, hh, rnd, RI)) break;
        }
        this._yard(bx, by, bw, bh, rnd, RI);
      } else if (roll < .68) { // парк
        for (let i = 0; i < bw * bh / 9; i++) { const x = bx + RI(0, bw - 1), y = by + RI(0, bh - 1); if (this.grid[idx(x, y)] === T.GRASS) this.grid[idx(x, y)] = rnd() < .6 ? T.TREE : T.BUSH; }
      } else if (roll < .84) { // магазин
        this._store(bx + 1, by + RI(0, Math.max(0, bh - 12)), rnd, RI);
      } else { // пустырь с редкими деревьями
        this._yard(bx, by, bw, bh, rnd, RI, .5);
      }
    }
    // разброс деревьев и кустов
    for (let i = 0; i < 420; i++) {
      const x = RI(3, MAP_W - 4), y = RI(3, MAP_H - 4), g = this.grid[idx(x, y)];
      if (g === T.GRASS && rnd() < .6) this.grid[idx(x, y)] = rnd() < .55 ? T.TREE : T.BUSH;
    }
    // точка появления: дом в левом верхнем квартале
    const h = this.houses[0];
    this.spawn = h ? { x: (h.x + h.w / 2) * TILE, y: (h.y + h.h / 2) * TILE, house: h } :
      { x: roadsV[0] * TILE, y: roadsH[0] * TILE, house: null };
  }
  _clear(x, y, w, h) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { if (!inB(i, j) || this.grid[idx(i, j)] !== T.GRASS) return false; } return true; }
  _yard(bx, by, bw, bh, rnd, RI, k = 1) {
    for (let i = 0; i < 8 * k; i++) { const x = bx + RI(0, bw - 1), y = by + RI(0, bh - 1); if (this.grid[idx(x, y)] === T.GRASS) this.grid[idx(x, y)] = rnd() < .5 ? T.TREE : T.BUSH; }
    if (rnd() < .6) { // забор вдоль участка
      const y = by + bh - 1, x0 = bx + RI(0, 4), x1 = bx + bw - RI(1, 5);
      for (let x = x0; x < x1; x++) { const t = this.grid[idx(x, y)]; if (t === T.GRASS && rnd() < .9) this.grid[idx(x, y)] = T.FENCE; }
    }
  }
  _house(x, y, w, h, rnd, RI) {
    if (x < 3 || y < 3 || x + w > MAP_W - 3 || y + h > MAP_H - 3) return;
    if (!this._clear(x - 1, y - 1, w + 2, h + 2)) return;
    const house = { x, y, w, h, alarmed: rnd() < .07 };
    this.houses.push(house);
    const floorT = pick([T.FLOOR, T.FLOOR, T.CARPET, T.TILEF]);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      this.grid[idx(i, j)] = (j === y || j === y + h - 1 || i === x || i === x + w - 1) ? T.WALL : floorT;
      this.roof[idx(i, j)] = 1;
    }
    // двери (1–2), под ними пол
    const doorN = RI(1, 2);
    for (let d = 0; d < doorN; d++) {
      const side = RI(0, 3); let dx, dy;
      if (side === 0) { dx = x + RI(2, w - 3); dy = y; } else if (side === 1) { dx = x + RI(2, w - 3); dy = y + h - 1; }
      else if (side === 2) { dx = x; dy = y + RI(2, h - 3); } else { dx = x + w - 1; dy = y + RI(2, h - 3); }
      this.grid[idx(dx, dy)] = floorT; house['door' + d] = { x: dx, y: dy };
      this.doors.set(key2(dx, dy), { open: false, hp: 80, max: 80, house });
    }
    // окна
    const winN = RI(3, 6);
    for (let k = 0; k < winN; k++) {
      const side = RI(0, 3); let wx, wy;
      if (side === 0) { wx = x + RI(1, w - 2); wy = y; } else if (side === 1) { wx = x + RI(1, w - 2); wy = y + h - 1; }
      else if (side === 2) { wx = x; wy = y + RI(1, h - 2); } else { wx = x + w - 1; wy = y + RI(1, h - 2); }
      const kk = key2(wx, wy);
      if (this.grid[idx(wx, wy)] === T.WALL && !this.windows.has(kk) && !this.doors.has(kk))
        this.windows.set(kk, { open: false, curtain: chance(.5), planks: 0, broken: false, hp: 30, house });
    }
    // мебель по периметру
    const spots = [];
    for (let j = y + 1; j < y + h - 1; j++) for (let i = x + 1; i < x + w - 1; i++) {
      const wallAdj = this.grid[idx(i - 1, j)] === T.WALL || this.grid[idx(i + 1, j)] === T.WALL ||
                      this.grid[idx(i, j - 1)] === T.WALL || this.grid[idx(i, j + 1)] === T.WALL;
      const doorAdj = [...this.doors.keys()].some(k => { const dd = { x: k % MAP_W, y: (k / MAP_W) | 0 }; return Math.abs(dd.x - i) + Math.abs(dd.y - j) <= 1; });
      if (wallAdj && !doorAdj && !this.furnAt.has(key2(i, j))) spots.push({ i, j });
    }
    const puts = (kind, n) => { for (let k = 0; k < n && spots.length; k++) { const p = spots.splice(RI(0, spots.length - 1), 1)[0]; this._addFurn(p.i, p.j, kind); } };
    puts('bed', RI(1, 2)); puts('sidetable', RI(1, 2)); puts('wardrobe', RI(1, 2));
    puts('fridge', 1); puts('counter', RI(1, 2));
    if (rnd() < .6) puts('bath', 1);
    if (rnd() < .45) puts('shelf', RI(1, 2));
    if (rnd() < .6) puts('sofa', 1);
    if (rnd() < .5) puts('table', 1);
    if (rnd() < .4) puts('tv', 1);
    return house;
  }
  _store(x, y, rnd, RI) {
    const w = 15, h = 11;
    if (!this._clear(x - 1, y - 1, w + 2, h + 2)) return;
    const house = { x, y, w, h, alarmed: rnd() < .15, store: true };
    this.houses.push(house);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      this.grid[idx(i, j)] = (j === y || j === y + h - 1 || i === x || i === x + w - 1) ? T.WALL : T.TILEF;
      this.roof[idx(i, j)] = 1;
    }
    for (const dx of [x + 3, x + w - 4]) {
      this.grid[idx(dx, y + h - 1)] = T.TILEF;
      this.doors.set(key2(dx, y + h - 1), { open: false, hp: 60, max: 60, house });
    }
    for (let i = x + 1; i < x + w - 1; i++) {
      for (const wy of [y, y + h - 1]) { const kk = key2(i, wy); if (this.grid[idx(i, wy)] === T.WALL && !this.doors.has(kk)) this.windows.set(kk, { open: false, curtain: false, planks: 0, broken: false, hp: 30, house }); }
    }
    // ряды полок + аптечный уголок
    for (let r = 0; r < 3; r++) for (let i = 0; i < 5; i++) {
      const fx = x + 3 + i * 2, fy = y + 2 + r * 3;
      if (this.grid[idx(fx, fy)] === T.TILEF) this._addFurn(fx, fy, rnd() < .25 ? 'medcase' : 'gasholder');
    }
  }
  _addFurn(x, y, kind) {
    const f = { x, y, kind, searched: false, items: null };
    this.furn.push(f); this.furnAt.set(key2(x, y), f); return f;
  }

  // ============================ ЗАПРОСЫ ============================
  tile(x, y) { return inB(x, y) ? this.grid[idx(x, y)] : T.WALL; }
  doorAt(x, y) { return this.doors.get(key2(x, y)); }
  windowAt(x, y) { return this.windows.get(key2(x, y)); }
  furnCell(x, y) { return this.furnAt.get(key2(x, y)); }
  isIndoorsPx(px, py) { return this.roof[idx(clamp(px / TILE | 0, 0, MAP_W - 1), clamp(py / TILE | 0, 0, MAP_H - 1))] === 1; }
  isSolid(x, y, forZombie = false) {
    if (!inB(x, y)) return true;
    const d = this.doors.get(key2(x, y)); if (d) return !d.open;
    const w = this.windows.get(key2(x, y)); if (w) return true; // окна: пролезает только игрок через действие
    if (SOLID_TILES.has(this.grid[idx(x, y)])) return true;
    const f = this.furnAt.get(key2(x, y)); if (f && FURN[f.kind].solid) return true;
    return false;
  }
  blocksSight(x, y) {
    if (!inB(x, y)) return true;
    const g = this.grid[idx(x, y)];
    if (g === T.WALL) {
      const w = this.windows.get(key2(x, y));
      if (w) return (w.curtain && !w.open) || w.planks >= 3;
      return true;
    }
    if (g === T.TREE) return true;
    if (g === T.FLOOR || g === T.CARPET || g === T.TILEF) {
      const d = this.doors.get(key2(x, y));
      if (d) return !d.open;
    }
    return false;
  }
  // окружность r (в тайлах) — движение со скольжением вдоль стен
  moveEntity(e, dx, dy, r = .3) {
    const tryPos = (nx, ny) => {
      const pts = [[nx - r, ny - r], [nx + r, ny - r], [nx - r, ny + r], [nx + r, ny + r], [nx, ny]];
      for (const [qx, qy] of pts) if (this.isSolid(Math.floor(qx), Math.floor(qy), e.zombie)) return false;
      return true;
    };
    if (tryPos(e.tx + dx, e.ty)) { e.tx += dx; }
    if (tryPos(e.tx, e.ty + dy)) { e.ty += dy; }
  }
  // DDA-каст луча (в тайлах) — дистанция до препятствия зрения
  castRay(x0, y0, ang, maxD) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const grid = this.grid, doors = this.doors, wins = this.windows;
    let x = x0, y = y0, t = 0;
    const step = .22;
    while (t < maxD) {
      t += step; x = x0 + dx * t; y = y0 + dy * t;
      const xi = Math.floor(x), yi = Math.floor(y);
      if (!inB(xi, yi)) return t;
      const g = grid[idx(xi, yi)];
      if (g === T.WALL) {
        const w = wins.get(key2(xi, yi));
        if (!w) return t;
        if ((w.curtain && !w.open) || w.planks >= 3) return t;
      } else if (g === T.TREE) return t;
      else if (g === T.FLOOR || g === T.CARPET || g === T.TILEF) {
        const d = doors.get(key2(xi, yi));
        if (d && !d.open) return t;
      }
    }
    return maxD;
  }
  hasLOS(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay), steps = Math.ceil(d / .3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.blocksSight(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t))) return false;
    }
    return true;
  }
  // ближайшая свободная точка рядом (для спавна)
  freeNear(tx, ty, rad = 6) {
    for (let i = 0; i < 40; i++) {
      const x = clamp(tx + randi(-rad, rad), 1, MAP_W - 2), y = clamp(ty + randi(-rad, rad), 1, MAP_H - 2);
      if (!this.isSolid(x, y)) return { x, y };
    }
    return { x: tx, y: ty };
  }
  // ---------- двери/окна ----------
  toggleDoor(x, y) {
    const d = this.doors.get(key2(x, y)); if (!d) return null;
    d.open = !d.open; return d;
  }
  toggleWindow(x, y) {
    const w = this.windows.get(key2(x, y)); if (!w) return null;
    if (!w.broken) { w.open = !w.open; if (w.open) w.curtain = false; }
    return w;
  }
  // зомби бьёт объект; возвращает событие 'thump'|'break'|'breakGlass'|null
  attackBarrier(x, y, dmg) {
    const dk = key2(x, y), d = this.doors.get(dk);
    if (d && !d.open) { d.hp -= dmg; if (d.hp <= 0) { this.doors.delete(dk); this.grid[idx(x, y)] = T.FLOOR; return 'breakWood'; } return 'thump'; }
    const w = this.windows.get(dk);
    if (w) {
      if (w.planks > 0) {
        w.hp -= dmg;
        if (w.hp <= 0) { w.planks--; w.hp = 30; if (w.planks <= 0) { w.planks = 0; return 'breakWood'; } }
        return 'thump';
      }
      if (!w.broken) { w.hp -= dmg; if (w.hp <= 0) { w.broken = true; w.open = false; w.curtain = false; return 'breakGlass'; } return 'thump'; }
      return 'thump';
    }
    return null;
  }

  // ---------- земля / контейнеры ----------
  groundPile(x, y) { const k = key2(x, y); if (!this.ground.has(k)) this.ground.set(k, []); return this.ground.get(k); }
  dropItem(x, y, it) { this.groundPile(x, y).push(it); }
  containerItems(f) {
    if (f.items === null) {
      f.items = rollLoot(FURN[f.kind].loot, f.kind === 'gasholder' || f.kind === 'medcase' ? 2 : 0)
        .map(e => ({ id: e.id, n: e.n, cond: undefined }));
    }
    return f.items;
  }

  // ============================ ВРЕМЯ / ПОГОДА ============================
  update(dtReal, G) {
    const dtMin = dtReal * GM_PER_SEC;
    const t = this.time;
    t.min += dtMin;
    if (t.min >= 1440) { t.min -= 1440; t.day++; G.onNewDay && G.onNewDay(); }
    const w = this.weather;
    if (t.min > w.nextChange) {
      const roll = Math.random();
      w.state = roll < .5 ? 'clear' : roll < .78 ? 'overcast' : 'rain';
      w.rainTarget = w.state === 'rain' ? rand(.35, 1) : 0;
      w.storm = w.state === 'rain' && w.rainTarget > .75;
      w.nextChange = t.min + randi(160, 480);
    }
    w.rain = lerp(w.rain, w.rainTarget, dtReal * .1);
    // гроза
    if (w.storm && Math.random() < dtReal * .08) { this.flash = 1; G.audio.thunder(); }
    this.flash = Math.max(0, this.flash - dtReal * 2);
  }
  isNight() { const h = this.time.min / 60; return h < 5.3 || h > 20.5; }
  hour() { return this.time.min / 60; }
  darkness() { // 0 днём → ~.75 ночью
    const h = this.hour(); let d;
    if (h < 4.8 || h > 21.8) d = .72; else if (h < 6.2) d = lerp(.72, .04, (h - 4.8) / 1.4);
    else if (h > 19.6) d = lerp(.04, .72, (h - 19.6) / 2.2); else d = .04;
    return clamp(d + this.weather.rain * .14 + (this.weather.state === 'overcast' ? .06 : 0), 0, .82);
  }
  // vib
  minimapBase() { // prerender палитры тайлов для миникарты
    const c = document.createElement('canvas'); c.width = MAP_W; c.height = MAP_H;
    const x2 = c.getContext('2d');
    const col = { [T.GRASS]: '#333f26', [T.DIRT]: '#40382a', [T.ROAD]: '#26282c', [T.SIDE]: '#484b44', [T.FLOOR]: '#54432f', [T.CARPET]: '#443a42', [T.TILEF]: '#4a5454', [T.WALL]: '#6b6659', [T.TREE]: '#27351c', [T.BUSH]: '#2e3d20', [T.FENCE]: '#4a4034', [T.CAR]: '#555' };
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) { x2.fillStyle = col[this.grid[idx(x, y)]] || '#333'; x2.fillRect(x, y, 1, 1); }
    return c;
  }
}
