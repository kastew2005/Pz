// ===================== zombies.js — ИИ зомби, орды, укусы =====================
import { TILE, MAP_W, MAP_H, clamp, rand, randi, chance, pick, angDiff, dist } from './consts.js';

const Z_SKIN = ['#9aa88a', '#8d9b83', '#a3ad92', '#939f7e', '#88947c'];
const Z_SHIRT = ['#5a4a42', '#4a5262', '#6b3d3d', '#3f4f42', '#634f35', '#4c3d54', '#59483e'];

export class ZombieSys {
  constructor(world) {
    this.world = world;
    this.list = [];
    this._populate();
  }
  _mk(tx, ty) {
    const r = Math.random();
    const fast = r < .12;              // «быстрые шаманами» — редкие
    const z = {
      tx: tx + .5, ty: ty + .5, a: rand(Math.PI * 2),
      hp: rand(60, 140), maxHp: 140,
      state: 'idle', // idle|wander|inv|chase|down
      gx: tx, gy: ty,            // цель
      thinkT: rand(2), senseT: rand(.3), groanT: rand(4, 20), attackT: 0,
      seeT: 0, loseT: 0, detect: 0,
      speed: fast ? rand(1.35, 1.6) : rand(.55, 1.05),
      skin: pick(Z_SKIN), shirt: pick(Z_SHIRT),
      walkP: rand(7), swayA: rand(.15, .3), scale: rand(.92, 1.08),
      downT: 0, downHp: 25, stuckT: 0, moanVol: rand(.7, 1.3),
      downedOnce: false, bashT: 0, dead: false, hitFlash: 0, fast,
    };
    this.list.push(z); return z;
  }
  _populate() {
    const w = this.world, sp = w.spawn;
    const spTx = sp.x / TILE, spTy = sp.y / TILE;
    // зомби в домах
    for (const h of w.houses) {
      const n = h.store ? randi(6, 10) : randi(0, 2);
      for (let i = 0; i < n; i++) {
        const p = w.freeNear(h.x + (h.w >> 1), h.y + (h.h >> 1), Math.max(h.w, h.h) >> 1);
        if (Math.hypot(p.x - spTx, p.y - spTy) < 12) continue;
        this._mk(p.x, p.y);
      }
    }
    // отшельники на улицах
    for (let i = 0; i < 170; i++) {
      const x = randi(4, MAP_W - 5), y = randi(4, MAP_H - 5);
      if (w.isSolid(x, y)) continue;
      if (Math.hypot(x - spTx, y - spTy) < 22) continue;
      this._mk(x, y);
    }
    // орды
    for (let k = 0; k < 3; k++) {
      let hx = randi(20, MAP_W - 21), hy = randi(20, MAP_H - 21);
      for (let tr = 0; tr < 30 && Math.hypot(hx - spTx, hy - spTy) < 35; tr++) { hx = randi(20, MAP_W - 21); hy = randi(20, MAP_H - 21); }
      const n = randi(11, 18);
      for (let i = 0; i < n; i++) {
        const p = w.freeNear(hx, hy, 5);
        this._mk(p.x, p.y);
      }
    }
    if (this.list.length > 260) this.list.length = 260;
  }
  chasingCount() { let n = 0; for (const z of this.list) if (!z.dead && z.state === 'chase') n++; return n; }
  nearestChasing(x, y) { let best = null, bd = 1e9; for (const z of this.list) { if (z.dead || z.state !== 'chase') continue; const d = dist(z.tx, z.ty, x, y); if (d < bd) { bd = d; best = z; } } return { z: best, d: bd }; }
  // шум в тайлах-позициях, r в тайлах
  hear(x, y, r) {
    for (const z of this.list) {
      if (z.dead || z.state === 'chase') continue;
      const d = dist(z.tx, z.ty, x, y);
      if (d < r * rand(.8, 1.15)) {
        z.state = 'inv'; z.gx = x + rand(-2, 2); z.gy = y + rand(-2, 2);
        z.thinkT = rand(0, .8);
      }
    }
  }
  damage(z, dmg, fromA, knock, downChance, G, opts = {}) {
    z.hp -= dmg; z.hitFlash = .18;
    z.a = fromA + rand(-.3, .3);
    const knockPx = clamp(knock, 0, 1.4) * .55;
    this.world.moveEntity(z, Math.cos(fromA) * knockPx / 1, Math.sin(fromA) * knockPx / 1);
    // раненый зомби агрится даже если не видел
    if (z.state !== 'chase' && !z.dead && z.hp > 0) { z.state = 'inv'; const p = G.player; z.gx = p.tx; z.gy = p.ty; }
    if (z.hp <= 0 && z.state !== 'down') { this._kill(z, G); return true; }
    if (z.state !== 'down' && Math.random() < downChance) {
      z.state = 'down'; z.downT = rand(2.2, 4); z.downHp = 22 + z.hp * .4;
      G.audio.shove();
    }
    return false;
  }
  stomp(z, dmg, G) {
    z.downHp -= dmg; z.hitFlash = .18;
    if (z.downHp <= 0) { this._kill(z, G); return true; }
    return false;
  }
  _kill(z, G) {
    z.dead = true;
    const w = this.world;
    w.corpses.push({ x: z.tx * TILE, y: z.ty * TILE, rot: z.a, skin: z.skin, shirt: z.shirt, items: null, searched: false });
    G.engine.addBlood(z.tx * TILE, z.ty * TILE, randi(4, 7));
    G.audio.hitFlesh(.9);
    G.stats.kills++;
  }
  update(dt, G) {
    const w = this.world, p = G.player;
    const night = w.isNight();
    for (const z of this.list) {
      if (z.dead) continue;
      const dp = dist(z.tx, z.ty, p.tx, p.ty);
      if (dp > 60) continue; // спящие клетки
      z.hitFlash = Math.max(0, z.hitFlash - dt);
      // ----- лежачий -----
      if (z.state === 'down') {
        z.downT -= dt;
        if (z.downT <= 0) { z.state = 'inv'; z.gx = p.tx; z.gy = p.ty; }
        continue;
      }
      // ----- чувства (рассредоточено) -----
      z.senseT -= dt;
      if (z.senseT <= 0) {
        z.senseT = .28;
        this._senses(z, dp, night, G);
      }
      // ----- поведение -----
      let spd = 0, targetA = z.a;
      if (z.state === 'chase') {
        spd = z.speed * 1.55; z.gx = p.tx; z.gy = p.ty;
        // потерял из виду?
        if (z.seeT <= 0) { z.loseT -= dt; if (z.loseT <= 0) { z.state = 'inv'; z.loseT = 0; } }
        z.groanT -= dt;
        if (z.groanT <= 0) { z.groanT = rand(1.8, 4); this._moan(z, dp, G, .5); G.makeNoise(z.tx, z.ty, 4); }
        // атака
        z.attackT -= dt;
        if (dp < .95 && z.attackT <= 0) { z.attackT = .95 + rand(0, .3); G.onZombieAttack(z); }
        // стук в преграды
        this._bash(z, dt, dp, G);
      } else if (z.state === 'inv') {
        spd = z.speed * 1.25;
        const gd = dist(z.tx, z.ty, z.gx, z.gy);
        if (gd < .9) { z.thinkT -= dt; spd = .2; if (z.thinkT <= 0) { z.state = 'wander'; z.thinkT = rand(4, 10); } }
        z.groanT -= dt; if (z.groanT <= 0) { z.groanT = rand(4, 9); this._moan(z, dp, G, .35); }
      } else { // idle/wander
        z.thinkT -= dt;
        if (z.state === 'idle' && z.thinkT <= 0) {
          z.state = 'wander'; z.thinkT = rand(5, 14);
          z.gx = clamp(z.tx + rand(-9, 9), 2, MAP_W - 3); z.gy = clamp(z.ty + rand(-9, 9), 2, MAP_H - 3);
        }
        if (z.state === 'wander') {
          spd = z.speed * .55;
          if (dist(z.tx, z.ty, z.gx, z.gy) < .8 || z.thinkT <= 0) { z.state = 'idle'; z.thinkT = rand(3, 12); spd = 0; }
        }
        z.groanT -= dt; if (z.groanT <= 0) { z.groanT = rand(7, 18); this._moan(z, dp, G, .22); }
      }
      // ----- движение -----
      if (spd > 0) {
        targetA = Math.atan2(z.gy - z.ty, z.gx - z.tx);
        const da = angDiff(z.a, targetA);
        z.a += clamp(da, -3.2 * dt, 3.2 * dt);
        const ox = z.tx, oy = z.ty;
        w.moveEntity(z, Math.cos(z.a) * spd * dt, Math.sin(z.a) * spd * dt);
        z.walkP += spd * dt * 3.4;
        // застрял?
        if (Math.abs(z.tx - ox) + Math.abs(z.ty - oy) < spd * dt * .25) {
          z.stuckT += dt;
          if (z.stuckT > 1.2) { z.stuckT = 0; z.a += rand(-1.6, 1.6); if (z.state === 'wander') z.thinkT = 0; }
        } else z.stuckT = 0;
      }
    }
  }
  _senses(z, dp, night, G) {
    const p = G.player, w = this.world;
    if (p.dead) { if (z.state === 'chase') z.state = 'wander'; return; }
    let visR = night ? 8.5 : 13;
    if (p.torchOn && night) visR += 5;
    if (w.weather.rain > .3) visR -= 2.5;
    if (p.sneaking) visR *= .55;
    if (p.onBush && p.sneaking) visR *= .5;
    let seen = false;
    if (dp < visR) {
      const ang = Math.abs(angDiff(z.a, Math.atan2(p.ty - z.ty, p.tx - z.tx)));
      const inCone = dp < 2.2 || ang < 1.15;
      if (inCone && w.hasLOS(z.tx, z.ty, p.tx, p.ty)) seen = true;
    }
    if (seen) {
      z.detect += (p.sneaking ? .5 : 1.4) * (1.6 - dp / visR);
      if (z.detect > .6) {
        if (z.state !== 'chase') { G.audio.zombieAlert(clamp(1 - dp / 20, .1, .6)); }
        z.state = 'chase'; z.seeT = .3; z.loseT = 5;
      }
    } else { z.detect = Math.max(0, z.detect - .2); if (z.state === 'chase') z.seeT -= .28; else z.seeT = 0; }
    if (z.state === 'chase' && seen) { z.seeT = .3; z.loseT = 5; }
  }
  _bash(z, dt, dp, G) {
    // бьёт дверь/окно, если к игроку ведёт преграда
    if (dp > 14) return;
    const w = this.world;
    const nx = Math.round(z.tx + Math.cos(z.a) * .8), ny = Math.round(z.ty + Math.sin(z.a) * .8);
    const d = w.doorAt(nx, ny), win = w.windowAt(nx, ny);
    if ((d && !d.open) || win) {
      z.bashT -= dt;
      if (z.bashT <= 0) {
        z.bashT = 1.15 + rand(0, .5);
        const ev = w.attackBarrier(nx, ny, randi(6, 14));
        const vol = clamp(1.2 - dp / 18, .05, .8);
        if (ev === 'thump') G.audio.doorBash(vol);
        else if (ev === 'breakWood') { G.audio.breakWood(); G.log('Дощатый проём сломан!', 'danger'); }
        else if (ev === 'breakGlass') { G.audio.breakGlass(); G.log('Разбито окно!', 'danger'); }
        G.makeNoise(z.tx, z.ty, 7);
      }
    }
  }
  _moan(z, dp, G, base) {
    if (dp > 26) return;
    const p = G.player;
    const vol = clamp(1 - dp / 26, 0, 1) * base * z.moanVol;
    const pan = clamp((z.tx - p.tx) / 12, -1, 1);
    G.audio.zombieMoan(vol, pan, z.fast ? 1.25 : 1);
  }
}
