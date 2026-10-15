// ===================== player.js — статы, тело, инвентарь, бой =====================
import { TILE, WEAPONS, ITEMS, clamp, lerp, rand, randi, chance, angDiff, dist } from './consts.js';

const PARTS = ['head', 'torso', 'larm', 'rarm', 'lleg', 'rleg'];
export const PART_NAMES = { head: 'Голова', torso: 'Торс', larm: 'Левая рука', rarm: 'Правая рука', lleg: 'Левая нога', rleg: 'Правая нога' };
const HIT_WEIGHTS = [['larm', .18], ['rarm', .2], ['lleg', .13], ['rleg', .13], ['torso', .26], ['head', .1]];

export class Player {
  constructor(G) {
    const sp = G.world.spawn;
    this.tx = sp.x / TILE; this.ty = sp.y / TILE;
    this.a = rand(Math.PI * 2);      // направление взгляда
    this.vel = { x: 0, y: 0 };
    this.walkP = 0; this.stepAcc = 0;
    this.parts = {}; for (const p of PARTS) this.parts[p] = { hp: 100, wound: null, bleeding: 0, bandage: null, infected: 0 };
    this.hunger = 12; this.thirst = 10; this.fatigue = 5; this.endur = 100;
    this.panic = 0; this.wet = 0; this.pain = 0; this.sickCold = 0;
    this.knox = -1;                  // -1 нет, 0..100 прогресс зомбификации
    this.painkillerT = 0;
    this.inv = []; this.equip = null;
    this.sneaking = false; this.running = false; this.aiming = false; this.aimA = 0; this.torchOn = false;
    this.onBush = false; this.dead = false; this.deathCause = '';
    this.attackAnim = 0; this.attackMax = 1; this.attackCd = 0; this.muzzle = 0; this.hitShake = 0;
    this.sneezeT = rand(20, 40); this.moveMag = 0;
    // стартовые вещи
    this.addItem({ id: 'food_apple', n: 1 }); this.addItem({ id: 'drink_water', n: 1 });
    this.addItem({ id: 'med_bandage', n: 1 }); this.addItem({ id: 'cloth_shirt', n: 1 });
  }
  // ---------- инвентарь ----------
  weight() { let s = 0; for (const it of this.inv) s += (ITEMS[it.id].w || .2) * (it.n || 1); return s; }
  capacity() { let c = 8; for (const it of this.inv) if (ITEMS[it.id].type === 'bag') c = Math.max(c, 4 + ITEMS[it.id].cap); return c; }
  count(id) { let n = 0; for (const it of this.inv) if (it.id === id) n += it.n || 1; return n; }
  hasItem(id, n = 1) { return this.count(id) >= n; }
  addItem(it) {
    const def = ITEMS[it.id];
    if (def.stack) { const ex = this.inv.find(e => e.id === it.id && (e.n || 1) < def.stack); if (ex) { ex.n = Math.min(def.stack, (ex.n || 1) + (it.n || 1)); return true; } }
    if (def.type === 'weapon' && it.cond === undefined) it.cond = WEAPONS[it.id].condMax;
    this.inv.push(it); return true;
  }
  removeItems(id, n) {
    let left = n;
    for (let i = this.inv.length - 1; i >= 0 && left > 0; i--) {
      const it = this.inv[i];
      if (it.id !== id) continue;
      const take = Math.min(it.n || 1, left); it.n = (it.n || 1) - take; left -= take;
      if (it.n <= 0) { if (this.equip === it) this.equip = null; this.inv.splice(i, 1); }
    }
    return left <= 0;
  }
  findType(filter) { return this.inv.filter(it => filter(ITEMS[it.id])); }
  equipItem(it) {
    if (ITEMS[it.id].type !== 'weapon') return;
    this.equip = (this.equip === it) ? null : it;
  }
  // ---------- здоровье ----------
  bodyHp() { let s = 0; for (const p of PARTS) s += this.parts[p].hp; return s / PARTS.length; }
  health01() { return clamp(this.bodyHp() / 100, 0, 1); }
  anyBleeding() { let n = 0; for (const p of PARTS) n += this.parts[p].bleeding; return n; }
  worstWuondPart(needBandaged) {
    let best = null, bs = -1;
    for (const p of PARTS) { const q = this.parts[p]; if (q.bleeding > (needBandaged && q.bandage ? 1 : 0) && q.bleeding > bs) { bs = q.bleeding; best = p; } }
    return best;
  }
  applyZombieHit(z, G) {
    // тип раны
    const r = Math.random();
    let kind = 'graze';
    if (r < .18) kind = 'bite'; else if (r < .5) kind = 'scratch'; else if (r < .62) kind = 'lacer';
    // часть тела
    let wr = Math.random(), part = 'torso';
    for (const [p, w] of HIT_WEIGHTS) { wr -= w; if (wr <= 0) { part = p; break; } }
    const P = this.parts[part];
    const sneaky = this.sneaking;
    if (kind === 'graze') { P.hp -= rand(2, 6); this.pain = clamp(this.pain + 8, 0, 100); }
    else if (kind === 'scratch') { P.hp -= rand(6, 12); P.wound = 'scratch'; P.bleeding = Math.max(P.bleeding, 1); this.pain = clamp(this.pain + 18, 0, 100); }
    else if (kind === 'lacer') { P.hp -= rand(10, 16); P.wound = 'lacer'; P.bleeding = 2; this.pain = clamp(this.pain + 28, 0, 100); }
    else { // укус = Knox-инфекция
      P.hp -= rand(15, 25); P.wound = 'bite'; P.bleeding = 2; this.pain = clamp(this.pain + 45, 0, 100);
      if (this.knox < 0) { this.knox = 0; G.log('ВАС УКУСИЛИ. Что-то не так…', 'fatal'); }
    }
    this.hitShake = .5;
    G.audio.hurtPlayer(); if (kind === 'bite') G.audio.bite();
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(kind === 'bite' ? [80, 40, 80] : 60);
    if ((sneaky ? 1 : 0) || true) this.panic = clamp(this.panic + (kind === 'bite' ? 45 : 25), 0, 100);
    if (this.parts.torso.hp <= 0 || this.parts.head.hp <= 0) this.die(kind === 'bite' ? 'Растерзан зомби' : 'Погиб от ран', G);
  }
  die(cause, G) {
    if (this.dead) return;
    this.dead = true; this.deathCause = cause;
    G.onPlayerDeath(cause);
  }
  // ---------- потребности / эффекты ----------
  eat(G, it) {
    const d = ITEMS[it.id];
    this.hunger = clamp(this.hunger + (d.hunger || 0), 0, 100);
    this.thirst = clamp(this.thirst + (d.thirst || 0), 0, 100);
    this._consume(it); G.audio.eat(); G.log(`Вы съели: ${d.name}`);
  }
  drink(G, it) {
    const d = ITEMS[it.id];
    this.thirst = clamp(this.thirst + (d.thirst || 0), 0, 100);
    this.hunger = clamp(this.hunger + (d.hunger || 0), 0, 100);
    this._consume(it); G.audio.drink(); G.log(`Вы выпили: ${d.name}`);
  }
  useMed(G, it, part) {
    const d = ITEMS[it.id];
    if (d.med === 'bandage' || d.med === 'ripped') {
      const target = part || this.worstWuondPart();
      if (!target) { G.log('Нет кровоточащих ран', 'muted'); return false; }
      const P = this.parts[target];
      P.bandage = d.med === 'bandage' ? 'clean' : 'dirty';
      P.bleeding = 0;
      if (d.med === 'ripped' && P.wound && Math.random() < .35) { P.infected = 1; }
      this._consume(it); G.audio.bandage();
      G.log(`${PART_NAMES[target]}: ${d.med === 'bandage' ? 'перевязано' : 'затянуто тканью'}`);
      return true;
    }
    if (d.med === 'disinfect') {
      let t = part; if (!t) { for (const p of PARTS) if (this.parts[p].wound) { t = p; break; } }
      if (!t) { G.log('Нет ран для обработки', 'muted'); return false; }
      const P = this.parts[t]; P.infected = 0; if (P.bandage === 'dirty') P.bandage = 'clean';
      this._consume(it); G.audio.pills(); G.log(`${PART_NAMES[t]}: рана обработана`);
      return true;
    }
    if (d.med === 'pills') { this.painkillerT = 180; this._consume(it); G.audio.pills(); G.log('Боль отступает…'); return true; }
    if (d.med === 'antibio') {
      let inf = false; for (const p of PARTS) if (this.parts[p].infected) { this.parts[p].infected = 0; inf = true; }
      if (this.sickCold > 0) { this.sickCold = 0; inf = true; }
      this._consume(it); G.audio.pills(); G.log(inf ? 'Инфекция подавлена' : 'Антибиотики приняты');
      return true;
    }
    return false;
  }
  _consume(it) {
    it.n = (it.n || 1) - 1;
    if (it.n <= 0) { const i = this.inv.indexOf(it); if (i >= 0) this.inv.splice(i, 1); if (this.equip === it) this.equip = null; }
  }
  // ---------- бой ----------
  weaponDef() { return WEAPONS[this.equip ? this.equip.id : 'fists']; }
  _autoFace(G) { // мобильный ассист: доворот к ближайшей цели в радиусе
    if (this.aiming) return;
    const w = this.weaponDef();
    let best = null, bd = Math.max(1.7, w.range * 1.15);
    for (const z of G.zombies.list) {
      if (z.dead) continue;
      const d = dist(this.tx, this.ty, z.tx, z.ty);
      if (d > bd) continue;
      if (Math.abs(angDiff(this.a, Math.atan2(z.ty - this.ty, z.tx - this.tx))) > 1.7 && d > .8) continue;
      best = z; bd = d;
    }
    if (best) this.a = Math.atan2(best.ty - this.ty, best.tx - this.tx);
  }
  quickAttack(G) { // тап: быстрый удар / толчок
    if (this.attackCd > 0 || this.dead) return;
    const w = this.weaponDef();
    if (w.ranged) { this._autoFaceRanged(G); this.shoot(G); return; }
    this._autoFace(G);
    this._melee(G, w, false);
  }
  chargedAttack(G) { // удержание → замах
    if (this.attackCd > 0 || this.dead) return;
    const w = this.weaponDef();
    if (w.ranged) { this.shoot(G); return; }
    this._melee(G, w, true);
  }
  _autoFaceRanged(G) {
    if (this.aiming) return;
    let best = null, bd = 10;
    for (const z of G.zombies.list) {
      if (z.dead) continue;
      const d = dist(this.tx, this.ty, z.tx, z.ty);
      if (d > bd) continue;
      if (Math.abs(angDiff(this.a, Math.atan2(z.ty - this.ty, z.tx - this.tx))) > 1.5) continue;
      if (!G.world.hasLOS(this.tx, this.ty, z.tx, z.ty)) continue;
      best = z; bd = d;
    }
    if (best) this.a = Math.atan2(best.ty - this.ty, best.tx - this.tx);
  }
  _melee(G, w, charged) {
    if (this.endur < 6) { G.log('Измождение: не хватает сил', 'muted'); return; }
    this.attackCd = w.dur + .12; this.attackAnim = w.dur; this.attackMax = w.dur;
    this.endur = clamp(this.endur - (charged ? 10 : 6), 0, 100);
    G.audio.swing();
    const dir = this.aiming ? this.aimA : this.a;
    G.delay(w.dur * .38, () => {
      if (this.dead) return;
      const range = w.range * (charged ? 1.1 : 1), zl = G.zombies.list;
      let hits = 0, hitAnySolid = false;
      for (const z of zl) {
        if (z.dead) continue;
        const d = dist(this.tx, this.ty, z.tx, z.ty);
        if (d > range + .45) continue;
        if (Math.abs(angDiff(dir, Math.atan2(z.ty - this.ty, z.tx - this.tx))) > w.arc / 2) continue;
        if (!G.world.hasLOS(this.tx, this.ty, z.tx, z.ty)) continue;
        const dmgM = (charged ? 1.35 : 1) * (this.panic > 65 ? .6 : 1) * (this.fatigue > 80 ? .7 : 1);
        const pa = Math.atan2(z.ty - this.ty, z.tx - this.tx);
        if (z.state === 'down') {
          G.zombies.stomp(z, rand(18, 30) * dmgM, G);
          G.engine.addBlood(z.tx * TILE, z.ty * TILE, 3);
        } else {
          const dmg = rand(w.dmg[0], w.dmg[1]) * dmgM;
          G.zombies.damage(z, dmg, pa, w.knock * (charged ? 1.3 : 1), w.down * (charged ? 1.25 : 1), G);
          G.engine.addBlood(z.tx * TILE, z.ty * TILE, randi(1, 3) + (w.bleed ? 1 : 0));
          G.engine.bloodSpurt(z.tx * TILE, z.ty * TILE, pa);
        }
        G.audio.hitFlesh(1); hits++;
      }
      // удар по стеклу рядом (разбить окно)
      if (!hits) {
        const nx = Math.round(this.tx + Math.cos(dir) * 1), ny = Math.round(this.ty + Math.sin(dir) * 1);
        const win = G.world.windowAt(nx, ny);
        if (win && !win.broken && win.planks === 0) { win.broken = true; win.open = false; win.curtain = false; G.audio.breakGlass(); G.makeNoise(nx, ny, 22); G.log('Стекло разбито! Шум привлечёт зомби…', 'danger'); hitAnySolid = true; }
      }
      if (!hits && !hitAnySolid) G.audio.shove();
      if (hits) {
        G.engine.shake(.35 + hits * .1);
        G.makeNoise(this.tx, this.ty, w.noise + (charged ? 2 : 0));
        if (this.equip) {
          this.equip.cond -= rand(1, 2.5);
          if (this.equip.cond <= 0) {
            G.log(`${ITEMS[this.equip.id].name} — сломано!`, 'danger');
            const i = this.inv.indexOf(this.equip); if (i >= 0) this.inv.splice(i, 1);
            this.equip = null; G.audio.breakWood();
          }
        }
      }
    });
  }
  shoot(G) {
    const w = WEAPONS.w_pistol;
    const ammo = this.inv.find(e => e.id === 'ammo_9mm');
    if (!ammo) { G.audio.dryClick(); G.log('Нет патронов 9мм', 'muted'); return; }
    this._consume(ammo);
    this.attackCd = .38; this.attackAnim = .3; this.attackMax = .3; this.muzzle = .09;
    const dir = this.aiming ? this.aimA : this.a;
    G.audio.pistol(); G.engine.shake(.8); G.makeNoise(this.tx, this.ty, w.noise);
    G.log('Громкий выстрел эхом разносится по округе…', 'danger');
    // луч до первого зомби в узком конусе
    let best = null, bd = w.range;
    for (const z of G.zombies.list) {
      if (z.dead) continue;
      const d = dist(this.tx, this.ty, z.tx, z.ty);
      if (d > w.range || d > bd) continue;
      const da = Math.abs(angDiff(dir, Math.atan2(z.ty - this.ty, z.tx - this.tx)));
      if (da > (z.state === 'down' ? .5 : .12 + .5 / Math.max(1, d))) continue;
      if (!G.world.hasLOS(this.tx, this.ty, z.tx, z.ty)) continue;
      best = z; bd = d;
    }
    if (best) {
      const dmg = rand(w.dmg[0], w.dmg[1]);
      const pa = Math.atan2(best.ty - this.ty, best.tx - this.tx);
      if (best.state === 'down') G.zombies.stomp(best, dmg, G);
      else G.zombies.damage(best, dmg, pa, .4, .1, G);
      G.engine.addBlood(best.tx * TILE, best.ty * TILE, 3);
      G.engine.bloodSpurt(best.tx * TILE, best.ty * TILE, pa);
      G.audio.hitFlesh(1);
    }
  }
  // ---------- главный апдейт ----------
  update(dt, G) {
    if (this.dead) return;
    const w = G.world, inp = G.input;
    const dtMin = dt * 2; // игровые минуты (GM_PER_SEC=2)
    // ====== движение ======
    let mx = inp.stick.x, my = inp.stick.y;           // -1..1
    const mag = clamp(Math.hypot(mx, my), 0, 1);
    this.moveMag = mag;
    this.running = (mag > .93 || inp.runHeld) && this.endur > 4 && !this.sneaking && !this.aiming && mag > .1;
    let spd = 2.55;
    if (this.sneaking) spd *= .46;
    if (this.aiming) spd *= .5;
    if (this.running) spd *= 2.0;
    // модификаторы
    const over = this.weight() - this.capacity();
    if (over > 0) spd *= clamp(1 - over * .045, .45, 1);
    const legDmg = Math.min(this.parts.lleg.hp, this.parts.rleg.hp);
    if (legDmg < 50) spd *= .78; if (legDmg < 25) spd *= .6;
    if (this.endur < 15) spd *= .82;
    if (this.fatigue > 80) spd *= .9;
    if (this.onBush) spd *= .55;
    const vx = mx * spd, vy = my * spd;
    const ox = this.tx, oy = this.ty;
    w.moveEntity(this, vx * dt, vy * dt, .32);
    const moved = Math.hypot(this.tx - ox, this.ty - oy);
    // фактическое направление
    if (moved > 0 && !this.aiming) {
      const ta = Math.atan2(this.ty - oy, this.tx - ox);
      this.a += angDiff(this.a, ta) * clamp(10 * dt, 0, 1);
    }
    if (this.aiming) { this.a += angDiff(this.a, this.aimA) * clamp(14 * dt, 0, 1); }
    this.vel.x = (this.tx - ox) / Math.max(dt, 1e-4); this.vel.y = (this.ty - oy) / Math.max(dt, 1e-4);
    // шаги и шум
    this.stepAcc += moved;
    const stepLen = this.running ? 1.1 : this.sneaking ? .95 : .85;
    if (this.stepAcc > stepLen && mag > .1) {
      this.stepAcc = 0;
      const tx = Math.floor(this.tx), ty = Math.floor(this.ty);
      const tile = w.tile(tx, ty);
      this.onBush = tile === 9; // T.BUSH
      const surf = (tile === 4 || tile === 5 || tile === 6) ? 'wood' : (tile === 0 || tile === 1) ? 'grass' : 'stone';
      G.audio.step(this.running, surf, clamp(mag, .4, 1));
      if (this.onBush) { G.audio.bush(); G.makeNoise(this.tx, this.ty, this.sneaking ? 2.5 : 6); }
      else G.makeNoise(this.tx, this.ty, this.sneaking ? 1.4 : this.running ? 12 : 5);
    } else if (moved < .001) this.stepAcc = 0;
    this.walkP += moved * 3.2;
    // ====== выносливость ======
    if (this.running) this.endur = clamp(this.endur - 11 * dt, 0, 100);
    else {
      let regen = mag > .1 ? 3.2 : 8;
      if (this.fatigue > 60) regen *= .5;
      if (over > 0) regen *= .6;
      this.endur = clamp(this.endur + regen * dt, 0, 100);
    }
    // ====== метаболизм (в игровых минутах) ======
    this.hunger = clamp(this.hunger + dtMin * (100 / (16 * 60)) * (this.running ? 1.5 : 1), 0, 100);
    this.thirst = clamp(this.thirst + dtMin * (100 / (9 * 60)) * (this.running ? 1.4 : 1), 0, 100);
    this.fatigue = clamp(this.fatigue + dtMin * (100 / (16 * 60)), 0, 100);
    if (this.painkillerT > 0) { this.painkillerT -= dtMin; this.pain = clamp(this.pain - dtMin * 1.2, 0, 100); }
    // боль из травм
    let dmgSum = 0, inf = 0;
    for (const p of PARTS) { const P = this.parts[p]; dmgSum += 100 - P.hp; if (P.infected) inf++; }
    const painT = clamp(dmgSum * .35, 0, 100);
    if (this.painkillerT <= 0) this.pain = lerp(this.pain, painT, dt * .3);
    // кровотечение
    for (const p of PARTS) {
      const P = this.parts[p];
      if (P.bleeding > 0) {
        const rate = P.bandage ? 0 : (P.bleeding >= 2 ? .5 : .22);
        P.hp -= rate * dt;
        if (Math.random() < dt * (P.bleeding >= 2 ? .8 : .3)) G.engine.addBlood(this.tx * TILE + rand(-6, 6), this.ty * TILE + rand(-6, 6), 1);
      } else if (P.bandage && Math.random() < dtMin * .02) P.bandage = null; // бинт истёк
      // заживление при перевязке, сытости и отсутствии инфекции
      if (P.wound && P.bandage && !P.infected && this.hunger < 70) {
        P.hp = clamp(P.hp + dtMin * .09, 0, 100);
        if (P.hp > 92) { P.wound = null; P.bandage = null; }
      }
      if (P.infected && P.wound) { P.hp -= dtMin * .05; } // заражение раны гноит
      if (P.hp <= 0 && (p === 'torso' || p === 'head')) return this.die('Погиб от полученных ран', G);
      P.hp = clamp(P.hp, 0, 100);
    }
    // голод/жажда — урон
    if (this.hunger >= 99) for (const p of PARTS) this.parts[p].hp -= dt * .4;
    if (this.thirst >= 99) for (const p of PARTS) this.parts[p].hp -= dt * .7;
    if (this.thirst >= 99 || this.hunger >= 99) {
      if (this.parts.torso.hp <= 0) return this.die('Умер от истощения', G);
    }
    // ====== Knox-инфекция ======
    if (this.knox >= 0) {
      this.knox += dt * (100 / 340); // ~5.5 минут до конца
      if (this.knox > 100) return this.die('Инфекция Нокса. Вы стали одним из них', G);
      if (this.knox > 70 && Math.random() < dt * .3) G.log('Лихорадка усиливается…', 'fatal');
    }
    // ====== дождь и простуда ======
    const indoors = w.isIndoorsPx(this.tx * TILE, this.ty * TILE);
    if (w.weather.rain > .05 && !indoors) this.wet = clamp(this.wet + w.weather.rain * 6.5 * dt, 0, 100);
    else this.wet = clamp(this.wet - (indoors ? 5 : 2.5) * dt, 0, 100);
    if (this.wet > 55 && w.hour() < 6 || this.wet > 80) {
      if (Math.random() < dt * .008 && this.sickCold <= 0) { this.sickCold = 1; G.log('Вы простыли. Начинается насморк…', 'warn'); }
    }
    if (indoors && this.wet < 30 && this.sickCold > 0) this.sickCold = Math.max(0, this.sickCold - dt * .02);
    if (this.sickCold > 0) {
      this.sneezeT -= dt;
      if (this.sneezeT <= 0) { this.sneezeT = rand(18, 50); G.audio.sneeze(); G.makeNoise(this.tx, this.ty, 8); G.log('АП-ЧХИ! Шумно…', 'warn'); }
    }
    // ====== снятие паники со временем ======
    const ch = G.zombies.nearestChasing(this.tx, this.ty);
    let panicTarget = 0;
    if (ch.z && ch.d < 14) panicTarget = clamp(100 * (1.1 - ch.d / 14) * Math.min(1, G.zombies.chasingCount() / 3), 0, 100);
    if (this.sneaking) panicTarget *= .8;
    this.panic = lerp(this.panic, panicTarget, dt * (panicTarget > this.panic ? 2 : .12));
    // ====== боевые таймеры ======
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt);
    this.muzzle = Math.max(0, this.muzzle - dt);
    this.hitShake = Math.max(0, this.hitShake - dt);
  }
  // расчёт во время сна (минуты)
  sleepTick(min, G) {
    this.hunger = clamp(this.hunger + min * (100 / (16 * 60)), 0, 100);
    this.thirst = clamp(this.thirst + min * (100 / (9 * 60)), 0, 100);
    this.fatigue = clamp(this.fatigue - min * (100 / (7.5 * 60)), 0, 100);
    if (this.knox >= 0) this.knox += min * (100 / (340 * 2));
    for (const p of PARTS) {
      const P = this.parts[p];
      if (P.bleeding && !P.bandage) P.hp -= min * .12;
      if (P.wound && P.bandage && !P.infected) P.hp = clamp(P.hp + min * .05, 0, 100);
      P.hp = clamp(P.hp, 0, 100);
    }
    this.pain = clamp(this.pain - min * .25, 0, 100);
    this.endur = 100;
    if (this.knox >= 100 || this.parts.torso.hp <= 0 || this.parts.head.hp <= 0) this.die(this.knox >= 100 ? 'Инфекция Нокса' : 'Истёк кровью во сне', G);
  }
}
