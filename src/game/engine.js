// ===================== engine.js — цикл, камера, рендер, FOV, свет =====================
import { TILE, MAP_W, MAP_H, T, PAL, clamp, lerp, rand, hash2, key2 } from './consts.js';
import { FURN } from './world.js';

const idx = (x, y) => x + y * MAP_W;

export class Engine {
  constructor(canvas, G) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.G = G;
    // полифилл roundRect для старых WebView
    if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
      CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        r = Math.min(r || 0, w / 2, h / 2);
        this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
        return this;
      };
    }
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cam = { x: 0, y: 0, zoom: 1.6, shX: 0, shY: 0, shakeA: 0 };
    this.decals = [];       // кровь
    this.parts = [];        // частицы
    this.rainDrops = [];
    this.overlay = document.createElement('canvas');
    this.fovPoly = null; this.fovData = null;
    this.visZeds = [];
    this._running = false; this._last = 0; this._raf = 0;
    this.muzzleFlash = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.cv.width = w * this.dpr; this.cv.height = h * this.dpr;
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.w = w; this.h = h;
    this.overlay.width = this.cv.width; this.overlay.height = this.cv.height;
    this.cam.zoom = clamp(Math.min(w, h) / (12.6 * TILE), 1.1, 2.1);
  }
  start() {
    this._running = true; this._last = performance.now();
    const loop = (t) => {
      if (!this._running) return;
      let dt = (t - this._last) / 1000; this._last = t;
      dt = clamp(dt, .001, .05);
      this.G.frame(dt);
      this.render();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }
  stop() { this._running = false; cancelAnimationFrame(this._raf); }
  shake(a) { this.cam.shakeA = Math.min(1, this.cam.shakeA + a); }
  addBlood(x, y, n) {
    for (let i = 0; i < n; i++) {
      if (this.decals.length > 420) this.decals.shift();
      this.decals.push({ x: x + rand(-14, 14), y: y + rand(-14, 14), r: rand(2, 6.5), a: rand(.35, .7), seed: Math.random() * 9 });
    }
  }
  bloodSpurt(x, y, ang) {
    for (let i = 0; i < 7; i++) {
      const a = ang + rand(-.5, .5);
      this.parts.push({ x, y, vx: Math.cos(a) * rand(30, 130), vy: Math.sin(a) * rand(30, 130), t: 0, max: rand(.3, .6), col: '#a02323', r: rand(1.5, 3) });
    }
  }
  woodChips(x, y) { for (let i = 0; i < 6; i++) this.parts.push({ x, y, vx: rand(-90, 90), vy: rand(-90, 90), t: 0, max: rand(.3, .5), col: '#8a6a3f', r: rand(1.5, 3) }); }
  updateFx(dt) {
    const P = this.G.player;
    // камера
    const look = 26;
    const tx = P.tx * TILE + P.vel.x * TILE * .28, ty = P.ty * TILE + P.vel.y * TILE * .28;
    this.cam.x = lerp(this.cam.x, tx, clamp(6 * dt, 0, 1));
    this.cam.y = lerp(this.cam.y, ty, clamp(6 * dt, 0, 1));
    this.cam.shakeA = Math.max(0, this.cam.shakeA - dt * 2.4);
    this.cam.shX = rand(-1, 1) * this.cam.shakeA * 9; this.cam.shY = rand(-1, 1) * this.cam.shakeA * 9;
    // частицы
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.t += dt;
      if (p.t > p.max) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .9; p.vy *= .9;
    }
    // дождь
    const rain = this.G.world.weather.rain;
    const want = Math.floor(rain * 110);
    while (this.rainDrops.length < want) this.rainDrops.push({ x: Math.random() * this.w, y: Math.random() * this.h, s: rand(420, 640) });
    if (this.rainDrops.length > want) this.rainDrops.length = want;
    for (const d of this.rainDrops) { d.y += d.s * dt; d.x += d.s * .18 * dt; if (d.y > this.h) { d.y = -10; d.x = Math.random() * this.w; } }
  }
  // мировые → экранные координаты
  w2sX(x) { return (x - this.cam.x) * this.cam.zoom + this.w / 2 + this.cam.shX; }
  w2sY(y) { return (y - this.cam.y) * this.cam.zoom + this.h / 2 + this.cam.shY; }
  pointVisible(x, y) {
    const P = this.G.player;
    if (Math.hypot(x / TILE - P.tx, y / TILE - P.ty) < 2) return true;
    if (!this.fovPoly) return false;
    return this.ctx.isPointInPath(this.fovPoly, this.w2sX(x) * this.dpr, this.w2sY(y) * this.dpr);
  }

  // ============================ РЕНДЕР ============================
  render() {
    const G = this.G, ctx = this.ctx, cam = this.cam, w = G.world;
    const z = cam.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0d09'; ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    ctx.setTransform(z, 0, 0, z, this.cv.width / 2 - cam.x * z + cam.shX * this.dpr, this.cv.height / 2 - cam.y * z + cam.shY * this.dpr);
    // видимые тайлы
    const vx0 = Math.max(0, Math.floor((cam.x - this.w / 2 / cam.zoom) / TILE) - 1), vx1 = Math.min(MAP_W - 1, Math.ceil((cam.x + this.w / 2 / cam.zoom) / TILE) + 1);
    const vy0 = Math.max(0, Math.floor((cam.y - this.h / 2 / cam.zoom) / TILE) - 1), vy1 = Math.min(MAP_H - 1, Math.ceil((cam.y + this.h / 2 / cam.zoom) / TILE) + 1);
    this._ground(ctx, w, vx0, vy0, vx1, vy1);
    this._decals(ctx, vx0, vy0, vx1, vy1);
    this._groundItems(ctx, w, vx0, vy0, vx1, vy1);
    this._structures(ctx, w, vx0, vy0, vx1, vy1);
    // сущности с сортировкой по Y
    this._entities(ctx, G);
    this._particles(ctx);
    this._weather(ctx, w);
    this._lighting(ctx, G, vx0, vy0, vx1, vy1);
    // UI-слой (прицел, мигания)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._vignette(ctx, G);
  }

  _ground(ctx, w, x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = w.grid[idx(x, y)]; const h = hash2(x, y); const X = x * TILE, Y = y * TILE;
      let col;
      switch (t) {
        case T.GRASS: col = h < .5 ? PAL.grassA : PAL.grassB; break;
        case T.DIRT: col = PAL.dirt; break;
        case T.ROAD: col = PAL.road; break;
        case T.SIDE: col = PAL.side; break;
        case T.FLOOR: col = PAL.floor; break;
        case T.CARPET: col = PAL.carpet; break;
        case T.TILEF: col = h < .5 ? PAL.tilef : '#586463'; break;
        case T.TREE: col = PAL.grassB; break;
        case T.BUSH: col = h < .5 ? PAL.grassA : PAL.grassB; break;
        case T.FENCE: col = PAL.grassB; break;
        case T.CAR: col = PAL.road; break;
        default: col = PAL.grassA;
      }
      ctx.fillStyle = col; ctx.fillRect(X, Y, TILE + 1, TILE + 1);
      // текстурные детали
      if (t === T.GRASS || t === T.DIRT || t === T.BUSH || t === T.TREE) {
        ctx.fillStyle = h < .5 ? 'rgba(0,0,0,.13)' : 'rgba(255,255,255,.045)';
        const n = 2 + (h * 3 | 0);
        for (let i = 0; i < n; i++) ctx.fillRect(X + hash2(x * 7 + i, y) * TILE, Y + hash2(x, y * 5 + i) * TILE, 2, t === T.DIRT ? 3 : 4);
      } else if (t === T.ROAD) {
        if (hash2(x, y) < .08) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(X + 6, Y + 8, 12, 3); }
        // осевые линии
        if (w.grid[idx(x, y - 1)] !== T.ROAD && w.grid[idx(x, y + 1)] === T.ROAD && w.grid[idx(x, y + 2)] === T.ROAD) { /* вертикальная дорога? */ }
      } else if (t === T.SIDE) {
        ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.strokeRect(X + .5, Y + .5, TILE - 1, TILE - 1);
      } else if (t === T.FLOOR) {
        ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1;
        const off = (y % 2) * TILE / 2;
        ctx.beginPath(); ctx.moveTo(X + off, Y); ctx.lineTo(X + off, Y + TILE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X, Y + TILE - 1); ctx.lineTo(X + TILE, Y + TILE - 1); ctx.stroke();
      } else if (t === T.TILEF) {
        ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.strokeRect(X + .5, Y + .5, TILE - 1, TILE - 1);
      }
      // дорожная разметка по центру дорог (жёлтые пунктиры)
      if (t === T.ROAD) {
        const leftRoad = w.tile(x - 1, y) === T.ROAD, rightRoad = w.tile(x + 1, y) === T.ROAD;
        const upRoad = w.tile(x, y - 1) === T.ROAD, downRoad = w.tile(x, y + 1) === T.ROAD;
        if (leftRoad && !rightRoad && (x % 3 === 0) && upRoad && downRoad) { ctx.fillStyle = PAL.roadLine; ctx.fillRect(X, Y + TILE / 2 - 1, TILE / 2, 2); }
        if (!leftRoad && rightRoad && (x % 3 === 0) && upRoad && downRoad) { ctx.fillStyle = PAL.roadLine; ctx.fillRect(X + TILE / 2, Y + TILE / 2 - 1, TILE / 2, 2); }
        if (upRoad && !downRoad && (y % 3 === 0) && leftRoad && rightRoad) { ctx.fillStyle = PAL.roadLine; ctx.fillRect(X + TILE / 2 - 1, Y, 2, TILE / 2); }
        if (!upRoad && downRoad && (y % 3 === 0) && leftRoad && rightRoad) { ctx.fillStyle = PAL.roadLine; ctx.fillRect(X + TILE / 2 - 1, Y + TILE / 2, 2, TILE / 2); }
      }
    }
  }
  _decals(ctx, x0, y0, x1, y1) {
    for (const d of this.decals) {
      const tx = d.x / TILE | 0, ty = d.y / TILE | 0;
      if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
      ctx.fillStyle = `rgba(110,20,20,${d.a})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill();
    }
  }
  _groundItems(ctx, w, x0, y0, x1, y1) {
    ctx.save();
    for (const [k, pile] of w.ground) {
      if (!pile.length) continue;
      const x = k % MAP_W, y = (k / MAP_W) | 0;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const X = x * TILE + TILE / 2, Y = y * TILE + TILE / 2;
      ctx.fillStyle = 'rgba(20,16,10,.55)';
      ctx.beginPath(); ctx.ellipse(X, Y + 8, 12, 5, 0, 0, 7); ctx.fill();
      let i = 0;
      for (const it of pile.slice(0, 4)) {
        ctx.save(); ctx.translate(X - 8 + (i % 2) * 10, Y - 6 + ((i / 2) | 0) * 8); ctx.scale(.65, .65);
        (this._iconFor(it.id))(ctx, 24); ctx.restore(); i++;
      }
    }
    ctx.restore();
  }
  _iconFor(id) { const { ITEMS } = this.G.consts; return ITEMS[id] ? ITEMS[id].icon : (c, s) => { c.fillStyle = '#888'; c.fillRect(6, 6, s - 12, s - 12); }; }
  _structures(ctx, w, x0, y0, x1, y1) {
    // мебель
    for (const f of w.furn) {
      if (f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1) continue;
      this._furn(ctx, f);
    }
    // трупы
    for (const c of w.corpses) {
      const tx = c.x / TILE | 0, ty = c.y / TILE | 0;
      if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
      ctx.scale(1, .72);
      ctx.fillStyle = 'rgba(60,10,10,.5)'; ctx.beginPath(); ctx.ellipse(0, 3, 15, 8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = c.shirt; ctx.beginPath(); ctx.roundRect(-9, -6, 18, 12, 4); ctx.fill();
      ctx.fillStyle = '#3a4148'; ctx.fillRect(-17, -5, 9, 10);
      ctx.fillStyle = c.skin; ctx.beginPath(); ctx.arc(12, 0, 5, 0, 7); ctx.fill();
      ctx.restore();
    }
    // стены/деревья/двери/окна/машины/заборы/фонари
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = w.grid[idx(x, y)], k = key2(x, y), X = x * TILE, Y = y * TILE;
      const door = w.doors.get(k), win = w.windows.get(k);
      if (door) this._door(ctx, w, x, y, door);
      else if (win) this._window(ctx, w, x, y, win);
      else if (t === T.WALL) {
        const above = w.tile(x, y - 1) === T.WALL || w.windows.has(key2(x, y - 1)) || w.doors.has(key2(x, y - 1));
        ctx.fillStyle = PAL.wall; ctx.fillRect(X, Y, TILE, TILE);
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(X, Y + TILE - 6, TILE, 6);
        if (!above) { ctx.fillStyle = 'rgba(255,255,255,.13)'; ctx.fillRect(X, Y, TILE, 4); }
        ctx.fillStyle = 'rgba(0,0,0,.15)';
        if (hash2(x, y) < .4) ctx.fillRect(X + 6, Y + 10, TILE - 12, 3);
      } else if (t === T.TREE) {
        // тень
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(X + TILE / 2 + 5, Y + TILE / 2 + 7, 20, 12, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#4a3a26'; ctx.fillRect(X + TILE / 2 - 2, Y + TILE / 2 - 2, 6, 10);
        const h = hash2(x, y);
        ctx.fillStyle = '#22401f'; ctx.beginPath(); ctx.arc(X + TILE / 2, Y + TILE / 2 - 4, 15 + h * 4, 0, 7); ctx.fill();
        ctx.fillStyle = '#2d5228'; ctx.beginPath(); ctx.arc(X + TILE / 2 - 6 + h * 8, Y + TILE / 2 - 9, 10, 0, 7); ctx.fill();
        ctx.fillStyle = '#38632f'; ctx.beginPath(); ctx.arc(X + TILE / 2 + 3, Y + TILE / 2 - 12 + h * 4, 7, 0, 7); ctx.fill();
      } else if (t === T.BUSH) {
        const h = hash2(x, y);
        ctx.fillStyle = '#2c4522'; ctx.beginPath(); ctx.arc(X + 12, Y + 18, 8, 0, 7); ctx.arc(X + 22, Y + 15, 7, 0, 7); ctx.arc(X + 18, Y + 22, 7, 0, 7); ctx.fill();
        ctx.fillStyle = '#3a5a2c'; ctx.beginPath(); ctx.arc(X + 14 + h * 6, Y + 16, 4, 0, 7); ctx.fill();
      } else if (t === T.FENCE) {
        ctx.fillStyle = '#5c4a34'; ctx.fillRect(X, Y + TILE / 2 - 2, TILE, 4);
        ctx.fillRect(X + 4, Y + 6, 4, TILE - 12); ctx.fillRect(X + TILE - 8, Y + 6, 4, TILE - 12);
      } else if (t === T.CAR) {
        const h = hash2(x, y);
        const cols = ['#6e3c38', '#3c4d68', '#5a5f42', '#4a4a52'];
        const col = cols[(h * 4) | 0];
        const horiz = w.grid[idx(x - 1, y)] === T.CAR || w.grid[idx(x + 1, y)] === T.CAR;
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.roundRect(X - 2, Y + 4, TILE + 6, TILE - 4, 8); ctx.fill();
        ctx.fillStyle = col; ctx.fillRect(X - 1, Y + 2, TILE + 2, TILE - 6);
        ctx.fillStyle = 'rgba(155,190,210,.5)';
        if (w.grid[idx(x + (horiz ? 1 : 0), y + (horiz ? 0 : 1))] !== T.CAR) { // капот-конец
          ctx.fillRect(X + 2, Y + 7, TILE / 2, TILE - 16);
        }
      }
    }
    // фонари
    for (const l of w.lamps) {
      if (l.x < x0 || l.x > x1 || l.y < y0 || l.y > y1) continue;
      const X = l.x * TILE + TILE / 2, Y = l.y * TILE + TILE / 2;
      ctx.strokeStyle = '#3a3d40'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, Y - 26); ctx.stroke();
      ctx.fillStyle = this.G.world.isNight() ? '#ffe9a8' : '#555b60';
      ctx.beginPath(); ctx.arc(X, Y - 27, 4, 0, 7); ctx.fill();
    }
  }
  _door(ctx, w, x, y, d) {
    const X = x * TILE, Y = y * TILE;
    const horiz = w.tile(x - 1, y) === T.WALL || w.tile(x + 1, y) === T.WALL || w.windows.has(key2(x - 1, y)) || w.windows.has(key2(x + 1, y));
    // косяк
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(X, Y, TILE, TILE);
    ctx.fillStyle = '#5e4a30'; ctx.fillRect(X + 1, Y + 1, TILE - 2, TILE - 2);
    if (!d.open) {
      ctx.fillStyle = '#7c5c37'; ctx.fillRect(X + 3, Y + 3, TILE - 6, TILE - 6);
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(X + 5, Y + 5, TILE - 10, TILE - 10);
      ctx.fillStyle = '#c8b46a';
      if (horiz) { ctx.fillRect(X + TILE / 2 - 1.5, Y + 5, 3, 4); ctx.fillRect(X + TILE / 2 - 1.5, Y + TILE - 9, 3, 4); }
      ctx.beginPath(); ctx.arc(X + TILE / 2 + 7, Y + TILE / 2, 2.2, 0, 7); ctx.fill();
    } else {
      // открытая — панель прижата к стене
      ctx.save(); ctx.translate(X + TILE / 2, Y + TILE / 2); ctx.rotate(horiz ? Math.PI / 2 : 0);
      ctx.fillStyle = '#7c5c37'; ctx.fillRect(-TILE / 2 + 2, -4, TILE - 8, 8);
      ctx.restore();
    }
    // полоска HP при уроне
    if (d.hp < d.max) { ctx.fillStyle = '#000'; ctx.fillRect(X + 3, Y - 4, TILE - 6, 3); ctx.fillStyle = '#c33'; ctx.fillRect(X + 3, Y - 4, (TILE - 6) * d.hp / d.max, 3); }
  }
  _window(ctx, w, x, y, win) {
    const X = x * TILE, Y = y * TILE;
    ctx.fillStyle = PAL.wall; ctx.fillRect(X, Y, TILE, TILE);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(X, Y + TILE - 6, TILE, 6);
    const horiz = w.tile(x - 1, y) === T.WALL || w.windows.has(key2(x - 1, y)) || w.doors.has(key2(x - 1, y));
    ctx.save(); ctx.translate(X + TILE / 2, Y + TILE / 2); if (!horiz) ctx.rotate(Math.PI / 2);
    // рама
    ctx.fillStyle = '#46403a'; ctx.fillRect(-TILE / 2 + 3, -7, TILE - 6, 14);
    if (win.broken) {
      ctx.fillStyle = '#10120f'; ctx.fillRect(-TILE / 2 + 5, -5, TILE - 10, 10); // пустой проём
      ctx.fillStyle = 'rgba(180,220,230,.55)';
      ctx.beginPath(); ctx.moveTo(-9, -5); ctx.lineTo(-5, -5); ctx.lineTo(-7, 1); ctx.fill();
      ctx.beginPath(); ctx.moveTo(6, 5); ctx.lineTo(10, 5); ctx.lineTo(8, -1); ctx.fill();
    } else {
      if (win.open) {
        ctx.fillStyle = '#10120f'; ctx.fillRect(-TILE / 2 + 5, -5, TILE - 10, 10);
        ctx.fillStyle = 'rgba(170,215,230,.7)'; ctx.fillRect(-TILE / 2 + 4, 5, TILE - 12, 4); // откинутая рама
      } else {
        ctx.fillStyle = win.curtain ? '#b8ac8e' : 'rgba(170,215,230,.75)';
        ctx.fillRect(-TILE / 2 + 5, -5, TILE - 10, 10);
        if (!win.curtain) { ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(-2, 5); ctx.stroke(); }
        else { ctx.strokeStyle = 'rgba(0,0,0,.2)'; for (let i = -8; i <= 8; i += 4) { ctx.beginPath(); ctx.moveTo(i, -5); ctx.lineTo(i, 5); ctx.stroke(); } }
      }
    }
    // доски баррикады
    for (let i = 0; i < win.planks; i++) {
      ctx.save(); ctx.rotate((i - 1.5) * .16);
      ctx.fillStyle = '#8a6a3f'; ctx.fillRect(-TILE / 2 + 2, -3 - i * 1 + i * 2 - 2, TILE - 4, 5);
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.strokeRect(-TILE / 2 + 2, -3 + i * 2 - 2, TILE - 4, 5);
      ctx.restore();
    }
    ctx.restore();
  }
  _furn(ctx, f) {
    const X = f.x * TILE, Y = f.y * TILE, c = ctx, s = TILE;
    const sRd = (x, y, w, h, r, col) => { c.fillStyle = col; c.beginPath(); c.roundRect(X + x, Y + y, w, h, r); c.fill(); };
    switch (f.kind) {
      case 'fridge': sRd(3, 2, s - 6, s - 4, 3, '#b9beb9'); sRd(5, 4, s - 10, 5, 2, 'rgba(255,255,255,.4)'); c.fillStyle = '#6b6f6b'; c.fillRect(X + 7, Y + 12, 3, 14); c.strokeStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.moveTo(X + 4, Y + 14); c.lineTo(X + s - 4, Y + 14); c.stroke(); break;
      case 'counter': sRd(2, 3, s - 4, s - 6, 2, '#9a8f76'); c.fillStyle = '#57534a'; c.beginPath(); c.arc(X + s / 2 - 5, Y + s / 2, 4, 0, 7); c.arc(X + s / 2 + 6, Y + s / 2, 4, 0, 7); c.fill(); break;
      case 'wardrobe': sRd(3, 2, s - 6, s - 4, 2, '#6b4e2e'); c.strokeStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.moveTo(X + s / 2, Y + 3); c.lineTo(X + s / 2, Y + s - 3); c.stroke(); c.fillStyle = '#c8b46a'; c.fillRect(X + s / 2 - 4, Y + s / 2 - 1, 3, 3); c.fillRect(X + s / 2 + 1, Y + s / 2 - 1, 3, 3); break;
      case 'sidetable': sRd(5, 5, s - 10, s - 10, 3, '#7a5a34'); c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(X + 7, Y + 7, s - 14, 3); break;
      case 'bath': sRd(4, 3, s - 8, s - 6, 3, '#cfd8d4'); c.fillStyle = '#b33'; c.fillRect(X + s / 2 - 1.5, Y + 8, 3, 10); c.fillRect(X + s / 2 - 5, Y + 11.5, 10, 3); break;
      case 'shelf': sRd(2, 3, s - 4, s - 6, 2, '#5c5f63'); c.fillStyle = '#777d84'; c.fillRect(X + 4, Y + 8, s - 8, 3); c.fillRect(X + 4, Y + 16, s - 8, 3); c.fillStyle = '#8a6a3f'; c.fillRect(X + 5, Y + 20, 7, 8); c.fillStyle = '#4c5b72'; c.fillRect(X + 14, Y + 20, 9, 8); c.fillStyle = '#74443f'; c.fillRect(X + 6, Y + 4, 8, 4); break;
      case 'gasholder': sRd(2, 2, s - 4, s - 4, 2, '#6d7278'); c.fillRect(X + 4, Y + 10, s - 8, 2); c.fillRect(X + 4, Y + 20, s - 8, 2); const cs = ['#b8543e', '#c2982e', '#4c7c4c', '#3d6bb0']; for (let i = 0; i < 3; i++) { c.fillStyle = cs[(f.x + f.y + i) % 4]; c.fillRect(X + 5 + i * 8, Y + 4, 6, 5); c.fillRect(X + 5 + i * 8, Y + 13, 6, 6); } break;
      case 'medcase': sRd(5, 3, s - 10, s - 6, 2, '#dfe6e2'); c.fillStyle = '#b33'; c.fillRect(X + s / 2 - 1.5, Y + 8, 3, 10); c.fillRect(X + s / 2 - 5, Y + 11.5, 10, 3); break;
      case 'bed': sRd(2, 2, s - 4, s - 4, 3, '#5e4a30'); sRd(4, 4, s - 8, s - 8, 3, '#cdd3dc'); sRd(4, 4, s - 8, 8, 3, '#e8ecf2'); sRd(4, 12, s - 8, s - 16, 2, '#7d8fb4'); break;
      case 'sofa': sRd(2, 4, s - 4, s - 9, 5, '#6e4a56'); c.strokeStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.moveTo(X + s / 2, Y + 6); c.lineTo(X + s / 2, Y + s - 6); c.stroke(); sRd(2, 2, s - 4, 5, 2, '#59343e'); break;
      case 'table': c.fillStyle = '#6e563b'; c.beginPath(); c.arc(X + s / 2, Y + s / 2, s / 2 - 4, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,.09)'; c.beginPath(); c.arc(X + s / 2, Y + s / 2, s / 2 - 9, 0, 7); c.fill(); break;
      case 'tv': sRd(3, 7, s - 6, s - 14, 2, '#2b2d31'); sRd(6, 10, s - 12, s - 20, 1, '#0e0f12'); break;
    }
    if (!f.searched && FURN[f.kind].loot) { // маркер «не обыскано»
      c.fillStyle = 'rgba(220,200,120,.75)';
      c.beginPath(); c.arc(X + s - 7, Y + 7, 2.4, 0, 7); c.fill();
    }
  }
  // ---------------- сущности ----------------
  _entities(ctx, G) {
    const P = G.player, zs = [];
    this.visZeds.length = 0;
    for (const z of G.zombies.list) {
      if (z.dead) continue;
      const dp = Math.hypot(z.tx - P.tx, z.ty - P.ty);
      if (dp > 24) continue;
      const vis = this.pointVisible(z.tx * TILE, z.ty * TILE);
      if (!vis && dp > 1.8) continue; // не виден — не рисуем
      if (vis) this.visZeds.push(z);
      zs.push(z);
    }
    zs.sort((a, b) => a.ty - b.ty);
    let playerDrawn = false;
    for (const z of zs) {
      if (!playerDrawn && z.ty > P.ty) { this._human(ctx, G, P, true); playerDrawn = true; }
      this._human(ctx, G, z, false);
    }
    if (!playerDrawn) this._human(ctx, G, P, true);
  }
  _human(ctx, G, e, isPlayer) {
    const x = e.tx * TILE, y = e.ty * TILE;
    const down = !isPlayer && e.state === 'down';
    ctx.save(); ctx.translate(x, y);
    // тень
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(2, 6, 11, 5.5, 0, 0, 7); ctx.fill();
    if (down) {
      ctx.rotate(e.a + Math.PI / 2); ctx.scale(1, .7);
      this._body(ctx, G, e, isPlayer, true);
      ctx.restore(); return;
    }
    ctx.rotate(e.a + Math.PI / 2);
    this._body(ctx, G, e, isPlayer, false);
    ctx.restore();
    // полоска обнаружения над зомби который вас заметил
    if (!isPlayer && e.state === 'chase' && this.pointVisible(x, y)) {
      ctx.fillStyle = '#c33';
      ctx.beginPath(); ctx.moveTo(x, y - 26); ctx.lineTo(x - 3.5, y - 19); ctx.lineTo(x + 3.5, y - 19); ctx.fill();
    }
  }
  _body(ctx, G, e, isPlayer, lying) {
    const phase = e.walkP;
    const legSwing = Math.sin(phase) * (isPlayer || e.state !== 'idle' ? 4.5 : 1.5);
    const skin = isPlayer ? '#d8b28f' : e.skin;
    const shirt = isPlayer ? '#3e6f6a' : e.shirt;
    const pants = isPlayer ? '#35486e' : '#3a4148';
    const flash = !isPlayer && e.hitFlash > 0;
    // ноги
    ctx.fillStyle = pants;
    if (!lying) {
      ctx.beginPath(); ctx.roundRect(-6.5, -3 + legSwing * .4, 5, 11 - legSwing * .5, 2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(1.5, -3 - legSwing * .4, 5, 11 + legSwing * .5, 2); ctx.fill();
    } else { ctx.beginPath(); ctx.roundRect(-7, 2, 14, 8, 3); ctx.fill(); }
    // торс
    ctx.fillStyle = shirt;
    ctx.beginPath(); ctx.roundRect(-8.5, -8, 17, 13, 5); ctx.fill();
    if (!isPlayer) { // лохмотья
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath(); ctx.roundRect(-8.5, 1, 17, 4, 2); ctx.fill();
    }
    // руки
    ctx.strokeStyle = skin; ctx.lineWidth = 4; ctx.lineCap = 'round';
    const P = this.G.player;
    if (isPlayer && (P.aiming || P.attackAnim > 0)) {
      // руки+оружие вперёд
      const wp = P.equip ? P.equip.id : 'fists';
      const swing = P.attackAnim > 0 ? (1 - P.attackAnim / P.attackMax) : null;
      const wa = swing === null ? 0 : (swing - .5) * 2.2;
      ctx.save(); ctx.rotate(wa);
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-2, -13); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, -6); ctx.lineTo(2, -13); ctx.stroke();
      this._weapon(ctx, wp, -13);
      ctx.restore();
    } else if (!isPlayer && e.state === 'chase') {
      const grab = Math.sin(phase * 1.3) * 2;
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-3 - grab, -14); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, -6); ctx.lineTo(3 + grab, -14); ctx.stroke();
    } else if (!lying) {
      const armSwing = Math.sin(phase) * 3.5;
      ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(-8.5, 3 + armSwing * .3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(7, -5); ctx.lineTo(8.5, 3 - armSwing * .3); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(-13, -2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(7, -5); ctx.lineTo(13, -3); ctx.stroke();
    }
    // голова
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(0, -13, 6, 0, 7); ctx.fill();
    if (isPlayer) { ctx.fillStyle = '#4a3a28'; ctx.beginPath(); ctx.arc(0, -14.5, 5.6, Math.PI, 7); ctx.fill(); }
    else {
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.arc(0, -15, 5.6, Math.PI * 1.05, Math.PI * 1.7); ctx.fill();
      // глаза
      if (e.state === 'chase') { ctx.fillStyle = '#d8d0b8'; ctx.fillRect(-3, -14.5, 2, 1.5); ctx.fillRect(1.5, -14.5, 2, 1.5); }
    }
    if (flash) { ctx.fillStyle = 'rgba(200,40,40,.4)'; ctx.beginPath(); ctx.arc(0, -6, 12, 0, 7); ctx.fill(); }
    // красная вспышка полученного урона у игрока
    if (isPlayer && P.hitShake > 0) { ctx.fillStyle = `rgba(200,40,40,${P.hitShake * .5})`; ctx.beginPath(); ctx.arc(0, -6, 13, 0, 7); ctx.fill(); }
  }
  _weapon(ctx, id, y) {
    switch (id) {
      case 'w_bat': case 'w_bat_nails':
        ctx.strokeStyle = '#8a6a3f'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, y + 4); ctx.lineTo(0, y - 14); ctx.stroke();
        if (id === 'w_bat_nails') { ctx.strokeStyle = '#c9ced4'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-3, y - 10); ctx.lineTo(3, y - 8); ctx.stroke(); }
        break;
      case 'w_axe':
        ctx.strokeStyle = '#7d5b34'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(0, y + 4); ctx.lineTo(0, y - 13); ctx.stroke();
        ctx.fillStyle = '#b03434'; ctx.beginPath(); ctx.moveTo(0, y - 14); ctx.lineTo(7, y - 12); ctx.lineTo(5, y - 6); ctx.lineTo(0, y - 7); ctx.fill();
        break;
      case 'w_knife':
        ctx.strokeStyle = '#c9ced4'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(0, y + 1); ctx.lineTo(0, y - 7); ctx.stroke();
        break;
      case 'w_pan':
        ctx.fillStyle = '#3b3f45'; ctx.beginPath(); ctx.arc(0, y - 4, 5, 0, 7); ctx.fill();
        ctx.strokeStyle = '#2c2f34'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, y + 1); ctx.lineTo(0, y + 5); ctx.stroke();
        break;
      case 'w_hammer':
        ctx.strokeStyle = '#8a6a3f'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, y + 3); ctx.lineTo(0, y - 7); ctx.stroke();
        ctx.fillStyle = '#7d838c'; ctx.fillRect(-4, y - 11, 8, 5);
        break;
      case 'w_pistol':
        ctx.fillStyle = '#2e3138'; ctx.fillRect(-2, y - 8, 4, 9);
        ctx.fillRect(-1.5, y, 3, 5);
        if (this.G.player.muzzle > 0) {
          ctx.fillStyle = `rgba(255,220,120,${this.G.player.muzzle * 9})`;
          ctx.beginPath(); ctx.arc(0, y - 11, 7, 0, 7); ctx.fill();
        }
        break;
    }
  }
  _particles(ctx) {
    for (const p of this.parts) {
      ctx.globalAlpha = 1 - p.t / p.max;
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  _weather(ctx, w) {
    const rain = w.weather.rain;
    if (rain < .05) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = `rgba(160,185,205,${.34 * rain})`;
    ctx.lineWidth = 1 * this.dpr;
    ctx.beginPath();
    for (const d of this.rainDrops) {
      ctx.moveTo(d.x * this.dpr, d.y * this.dpr);
      ctx.lineTo((d.x - 4) * this.dpr, (d.y - 14) * this.dpr);
    }
    ctx.stroke();
    ctx.restore();
  }
  // ---------------- FOV / свет ----------------
  _lighting(ctx, G, x0, y0, x1, y1) {
    const w = G.world, P = G.player, cam = this.cam, z = cam.zoom * this.dpr;
    const night = w.isNight(), dark = w.darkness();
    // параметры зрения
    let visR = night ? 8.5 : 14;
    if (w.weather.rain > .3) visR -= 2;
    if (P.sneaking) visR -= 1;
    let coneHalf = 1.12;
    if (P.panic > 70) coneHalf = .8;
    if (P.aiming) coneHalf = .95;
    if (P.dead) { visR = 3; coneHalf = 3.14; }
    const px = P.tx * TILE, py = P.ty * TILE;
    // каст лучей
    const RAYS = 72, poly = [];
    for (let i = 0; i <= RAYS; i++) {
      const a = P.a - Math.PI + (i / RAYS) * Math.PI * 2;
      const inCone = Math.abs(((a - P.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < coneHalf;
      let maxD = inCone ? visR : 2.6;
      if (P.torchOn && inCone) maxD = Math.max(maxD, 13);
      const d = w.castRay(P.tx, P.ty, a, maxD);
      // помечаем клетки как изученные
      const steps = Math.ceil(d / .4);
      for (let s2 = 0; s2 <= steps; s2++) {
        const mx = Math.floor(P.tx + Math.cos(a) * s2 * .4), my = Math.floor(P.ty + Math.sin(a) * s2 * .4);
        if (mx >= 0 && my >= 0 && mx < MAP_W && my < MAP_H) w.explored[idx(mx, my)] = 1;
      }
      poly.push([px + Math.cos(a) * d * TILE, py + Math.sin(a) * d * TILE]);
    }
    // строим path в экранных координатах
    const ov = this.overlay.getContext('2d');
    ov.setTransform(1, 0, 0, 1, 0, 0);
    ov.clearRect(0, 0, this.overlay.width, this.overlay.height);
    // базовая темнота: неисследованное ~.97
    ov.fillStyle = `rgba(4,7,5,${.97})`;
    ov.fillRect(0, 0, this.overlay.width, this.overlay.height);
    // исследованное — смягчаем
    ov.globalCompositeOperation = 'destination-out';
    ov.fillStyle = 'rgba(0,0,0,.42)';
    const ts = TILE * z;
    const offX = this.overlay.width / 2 - cam.x * z + cam.shX * this.dpr, offY = this.overlay.height / 2 - cam.y * z + cam.shY * this.dpr;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      if (!w.explored[idx(xx, yy)]) continue;
      ov.fillRect(xx * TILE * z + offX, yy * TILE * z + offY, ts + 1, ts + 1);
    }
    // вырезаем видимый полигон (ночью частично, чтобы осталась темнота)
    const path = new Path2D();
    for (let i = 0; i < poly.length; i++) {
      const sx = poly[i][0] * z + offX, sy = poly[i][1] * z + offY;
      if (i === 0) path.moveTo(sx, sy); else path.lineTo(sx, sy);
    }
    path.closePath();
    this.fovPoly = path;
    const visKeep = clamp(dark * .55, 0, .5); // ночная темнота в зоне видимости
    ov.fillStyle = `rgba(0,0,0,${1 - visKeep})`;
    ov.fill(path);
    // мягкий край
    ov.strokeStyle = 'rgba(0,0,0,.3)'; ov.lineWidth = 14 * this.dpr; ov.stroke(path);
    ov.strokeStyle = 'rgba(0,0,0,.14)'; ov.lineWidth = 30 * this.dpr; ov.stroke(path);
    // ближний круг (чутьё)
    ov.fillStyle = 'rgba(0,0,0,.9)';
    ov.beginPath(); ov.arc(px * z + offX, py * z + offY, 1.6 * TILE * z, 0, 7); ov.fill();
    // фонари улиц ночью
    if (dark > .25) {
      for (const l of w.lamps) {
        const lx = (l.x * TILE + TILE / 2) * z + offX, ly = (l.y * TILE + TILE / 2) * z + offY;
        if (lx < -200 || ly < -200 || lx > this.overlay.width + 200) continue;
        const gr = ov.createRadialGradient(lx, ly, 0, lx, ly, 4.4 * TILE * z);
        gr.addColorStop(0, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ov.fillStyle = gr; ov.beginPath(); ov.arc(lx, ly, 4.4 * TILE * z, 0, 7); ov.fill();
      }
    }
    // вспышка молнии
    if (w.flash > 0) { ov.fillStyle = `rgba(0,0,0,${w.flash * .75})`; ov.fillRect(0, 0, this.overlay.width, this.overlay.height); }
    ov.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.overlay, 0, 0);
    // вспышка молнии — голубой оттенок
    if (w.flash > .05) { ctx.fillStyle = `rgba(180,200,255,${w.flash * .12})`; ctx.fillRect(0, 0, this.overlay.width, this.overlay.height); }
  }
  _vignette(ctx, G) {
    const W = this.cv.width, H = this.cv.height;
    const P = G.player;
    // мягкая виньетка
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .38, W / 2, H / 2, Math.max(W, H) * .75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // красная виньетка при уроне / низком хп
    const lowHp = P && !P.dead ? Math.max(0, .55 - P.health01()) : 0;
    const hurt = P ? P.hitShake : 0;
    const a = clamp(lowHp * 1.1 + hurt * .5, 0, .6);
    if (a > .01) {
      const g2 = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .7);
      g2.addColorStop(0, 'rgba(120,0,0,0)'); g2.addColorStop(1, `rgba(140,10,10,${a})`);
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    }
    // прицел для пистолета
    if (P && P.aiming && P.equip && P.equip.id === 'w_pistol' && !P.dead) {
      const sx = this.w2sX(P.tx * TILE) * this.dpr, sy = this.w2sY(P.ty * TILE) * this.dpr;
      const ex = sx + Math.cos(P.aimA) * 10 * TILE * this.cam.zoom * this.dpr, ey = sy + Math.sin(P.aimA) * 10 * TILE * this.cam.zoom * this.dpr;
      ctx.strokeStyle = 'rgba(220,80,60,.5)'; ctx.lineWidth = 1.4 * this.dpr;
      ctx.setLineDash([6 * this.dpr, 8 * this.dpr]);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
