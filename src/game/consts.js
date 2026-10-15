// ===================== МЁРТВЫЙ ГОРОД — consts.js =====================
// Общие константы, определения предметов, оружия, рецептов, хелперы.

export const TILE = 34;               // размер тайла в px
export const MAP_W = 176, MAP_H = 176;
export const GM_PER_SEC = 2;          // игровых минут за реальную секунду (1 игр. час = 30 сек)

// ---------------- Тайлы ----------------
export const T = {
  GRASS: 0, DIRT: 1, ROAD: 2, SIDE: 3, FLOOR: 4, CARPET: 5, TILEF: 6,
  WALL: 7, TREE: 8, BUSH: 9, FENCE: 10, CAR: 11,
};

export const SOLID_TILES = new Set([T.WALL, T.TREE, T.FENCE, T.CAR]);

// ---------------- Хелперы ----------------
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const chance = p => Math.random() < p;
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const distT = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay) / TILE;
export function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
export const key2 = (x, y) => x + y * MAP_W;
export function hash2(x, y) { let h = (x * 73856093 ^ y * 19349663); h = (h ^ h >> 13) * 1274126177; return ((h ^ h >> 16) >>> 0) / 4294967295; }
let _uid = 1; export const uid = () => _uid++;

// Формат времени мира
export function fmtTime(min) { const h = Math.floor(min / 60) % 24, m = Math.floor(min % 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

// ---------------- Цвета стиля ----------------
export const PAL = {
  bg: '#0b0e0a', blood: '#8e1f1f', bloodDark: '#5c1414',
  grassA: '#42512f', grassB: '#39472a', dirt: '#4d4433',
  road: '#33363a', roadLine: '#6f705f', side: '#5c6058',
  floor: '#6e563b', carpet: '#574a55', tilef: '#5f6b6b',
  wall: '#8b8577', wallDark: '#3c382f',
};

// ---------------- Оружие ----------------
// dur — длительность замаха (сек), arc — радианы, noise — радиус шума в тайлах
export const WEAPONS = {
  fists:      { name: 'Кулаки',         dmg: [2, 6],   range: 1.15, arc: 1.9, dur: .42, noise: 3,  knock: .9, down: .32, condMax: Infinity },
  w_knife:    { name: 'Кухонный нож',   dmg: [10, 18], range: 1.3,  arc: 1.6, dur: .45, noise: 2,  knock: .15, down: .06, condMax: 90,  bleed: .5 },
  w_pan:      { name: 'Сковорода',      dmg: [7, 13],  range: 1.25, arc: 1.8, dur: .55, noise: 7,  knock: .5,  down: .18, condMax: 80 },
  w_hammer:   { name: 'Молоток',        dmg: [9, 15],  range: 1.25, arc: 1.8, dur: .55, noise: 4,  knock: .35, down: .15, condMax: 130 },
  w_bat:      { name: 'Бейсбольная бита', dmg: [14, 22], range: 1.65, arc: 2.0, dur: .8,  noise: 5,  knock: 1.0, down: .42, condMax: 150 },
  w_bat_nails:{ name: 'Бита с гвоздями', dmg: [22, 34], range: 1.65, arc: 2.0, dur: .8,  noise: 5,  knock: 1.0, down: .48, condMax: 120, bleed: .55 },
  w_axe:      { name: 'Пожарный топор', dmg: [28, 45], range: 1.55, arc: 1.9, dur: 1.0, noise: 6,  knock: .8,  down: .3,  condMax: 190, bleed: .5 },
  w_pistol:   { name: 'Пистолет M9',    dmg: [30, 70], range: 10,   arc: .3,  dur: .3,  noise: 46, knock: .3,  down: .1,  condMax: 220, ranged: true, ammo: 'ammo_9mm' },
};

// ---------------- Предметы ----------------
// icon(ctx, s) — рисует иконку в квадрате s×s (0,0 верхний левый угол)
function line(c, x1, y1, x2, y2, col, w) { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
function rect(c, x, y, w, h, col, r = 0) { c.fillStyle = col; if (r) { c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); } else c.fillRect(x, y, w, h); }
function circ(c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }

function iconBat(c, s, nail) {
  const k = s / 24; c.save(); c.translate(s / 2, s / 2); c.rotate(-.7);
  rect(c, -2 * k, -10 * k, 4 * k, 14 * k, '#8a6a3f', 2 * k); rect(c, -1.4 * k, 4 * k, 2.8 * k, 7 * k, '#5e462a', 1 * k);
  if (nail) for (let i = 0; i < 3; i++) line(c, -3 * k, (-8 + i * 4) * k, 3 * k, (-6 + i * 4) * k, '#c9ced4', 1.2 * k);
  c.restore();
}
function iconCan(c, s, col, label) { const k = s / 24; rect(c, 7 * k, 5 * k, 10 * k, 14 * k, col, 2 * k); rect(c, 7 * k, 5 * k, 10 * k, 2.6 * k, '#c7c9c4', 1 * k); rect(c, 8 * k, 10 * k, 8 * k, 5 * k, label, 1 * k); }
function iconBottle(c, s, col, cap) { const k = s / 24; rect(c, 9.5 * k, 7 * k, 5 * k, 12 * k, col, 2 * k); rect(c, 10.5 * k, 4 * k, 3 * k, 3 * k, cap, 1 * k); rect(c, 9.5 * k, 12 * k, 5 * k, 4 * k, 'rgba(255,255,255,.25)', 1 * k); }
function iconPills(c, s, col) { const k = s / 24; rect(c, 7 * k, 8 * k, 10 * k, 9 * k, '#e8e6df', 2 * k); rect(c, 7 * k, 8 * k, 10 * k, 3 * k, col, 1 * k); circ(c, 11 * k, 14 * k, 1.2 * k, col); circ(c, 14 * k, 14 * k, 1.2 * k, '#999'); }
function iconBandage(c, s, dirty) { const k = s / 24; circ(c, 12 * k, 12 * k, 7 * k, dirty ? '#b9ac93' : '#ece9e0'); circ(c, 12 * k, 12 * k, 3.4 * k, dirty ? '#8f8268' : '#c8c4b8'); circ(c, 12 * k, 12 * k, 1 * k, dirty ? '#b9ac93' : '#ece9e0'); }

export const ITEMS = {
  // еда/вода
  food_beans: { name: 'Консервы «Фасоль»', w: .8, type: 'food', hunger: -38, icon: (c, s) => iconCan(c, s, '#7f8c74', '#a33d2e') },
  food_chips: { name: 'Чипсы', w: .2, type: 'food', hunger: -14, thirst: 4, icon: (c, s) => { const k = s / 24; rect(c, 6 * k, 5 * k, 12 * k, 14 * k, '#c2982e', 3 * k); rect(c, 8 * k, 8 * k, 8 * k, 6 * k, '#8a6420', 1 * k); } },
  food_apple: { name: 'Яблоко', w: .2, type: 'food', hunger: -16, thirst: -6, icon: (c, s) => { const k = s / 24; circ(c, 12 * k, 14 * k, 6 * k, '#9cb13f'); line(c, 12 * k, 8 * k, 13 * k, 6 * k, '#5e462a', 1.4 * k); } },
  drink_water: { name: 'Бутылка воды', w: 1, type: 'drink', thirst: -50, icon: (c, s) => iconBottle(c, s, 'rgba(140,180,200,.9)', '#3c74a8') },
  drink_soda: { name: 'Газировка', w: .3, type: 'drink', thirst: -34, hunger: -6, icon: (c, s) => iconBottle(c, s, '#b8552e', '#ddd') },
  // медицина
  med_bandage: { name: 'Бинт', w: .1, type: 'med', med: 'bandage', icon: (c, s) => iconBandage(c, s, false) },
  med_ripped: { name: 'Рваная ткань', w: .1, type: 'med', med: 'ripped', icon: (c, s) => iconBandage(c, s, true) },
  med_disinfect: { name: 'Антисептик', w: .2, type: 'med', med: 'disinfect', icon: (c, s) => iconBottle(c, s, '#cbb26a', '#7a5a20') },
  med_pills: { name: 'Обезболивающее', w: .1, type: 'med', med: 'pills', icon: (c, s) => iconPills(c, s, '#b8543e') },
  med_antibio: { name: 'Антибиотики', w: .1, type: 'med', med: 'antibio', icon: (c, s) => iconPills(c, s, '#3d7f76') },
  // оружие
  w_knife: { name: 'Кухонный нож', w: .5, type: 'weapon', icon: (c, s) => { const k = s / 24; c.save(); c.translate(s / 2, s / 2); c.rotate(-.7); rect(c, -1 * k, -10 * k, 2 * k, 9 * k, '#c9ced4', 1 * k); rect(c, -1.5 * k, 0, 3 * k, 8 * k, '#3a3230', 1 * k); c.restore(); } },
  w_pan: { name: 'Сковорода', w: 1, type: 'weapon', icon: (c, s) => { const k = s / 24; circ(c, 11 * k, 10 * k, 6.5 * k, '#3b3f45'); circ(c, 11 * k, 10 * k, 4.5 * k, '#565b63'); line(c, 11 * k, 16 * k, 11 * k, 22 * k, '#2c2f34', 2.4 * k); } },
  w_hammer: { name: 'Молоток', w: 1.5, type: 'weapon', tool: 'hammer', icon: (c, s) => { const k = s / 24; line(c, 12 * k, 8 * k, 12 * k, 21 * k, '#8a6a3f', 2.4 * k); rect(c, 6.5 * k, 4 * k, 11 * k, 4.5 * k, '#7d838c', 1.5 * k); } },
  w_bat: { name: 'Бейсбольная бита', w: 2, type: 'weapon', icon: (c, s) => iconBat(c, s, false) },
  w_bat_nails: { name: 'Бита с гвоздями', w: 2.2, type: 'weapon', icon: (c, s) => iconBat(c, s, true) },
  w_axe: { name: 'Пожарный топор', w: 3, type: 'weapon', icon: (c, s) => { const k = s / 24; line(c, 11 * k, 6 * k, 11 * k, 22 * k, '#7d5b34', 2.4 * k); c.fillStyle = '#b03434'; c.beginPath(); c.moveTo(11 * k, 3 * k); c.lineTo(19 * k, 5 * k); c.lineTo(17 * k, 10 * k); c.lineTo(11 * k, 9 * k); c.fill(); } },
  w_pistol: { name: 'Пистолет M9', w: 1.5, type: 'weapon', icon: (c, s) => { const k = s / 24; rect(c, 4 * k, 8 * k, 13 * k, 4 * k, '#2e3138', 1 * k); rect(c, 12 * k, 12 * k, 4 * k, 7 * k, '#3c3f47', 1 * k); rect(c, 15 * k, 9 * k, 3 * k, 2 * k, '#1d1f24'); } },
  ammo_9mm: { name: 'Патроны 9мм', w: .02, type: 'ammo', stack: 30, icon: (c, s) => { const k = s / 24; rect(c, 6 * k, 10 * k, 12 * k, 8 * k, '#5c4a2c', 1 * k); for (let i = 0; i < 4; i++) rect(c, (7.5 + i * 2.6) * k, 6.5 * k, 1.6 * k, 5 * k, '#c8a23c', .8 * k); } },
  // материалы
  mat_plank: { name: 'Доска', w: 3, type: 'mat', stack: 3, icon: (c, s) => { const k = s / 24; c.save(); c.translate(s / 2, s / 2); c.rotate(-.3); rect(c, -10 * k, -3 * k, 20 * k, 6 * k, '#96713f', 1 * k); line(c, -8 * k, 0, 7 * k, 0, '#7a5b33', 1 * k); c.restore(); } },
  mat_nails: { name: 'Гвозди', w: .3, type: 'mat', stack: 20, icon: (c, s) => { const k = s / 24; for (let i = 0; i < 5; i++) line(c, (7 + i * 2.4) * k, (8 + (i % 2) * 3) * k, (9 + i * 2.4) * k, (17 + (i % 2) * 2) * k, '#b9bec6', 1.4 * k); } },
  mat_sheet: { name: 'Простыня', w: .5, type: 'mat', icon: (c, s) => { const k = s / 24; c.fillStyle = '#d8d2c2'; c.beginPath(); c.moveTo(6 * k, 5 * k); c.quadraticCurveTo(12 * k, 9 * k, 18 * k, 5 * k); c.lineTo(17 * k, 19 * k); c.quadraticCurveTo(12 * k, 15 * k, 7 * k, 19 * k); c.fill(); } },
  // прочее
  tool_torch: { name: 'Фонарик', w: .5, type: 'tool', icon: (c, s) => { const k = s / 24; rect(c, 8 * k, 8 * k, 5 * k, 11 * k, '#3d4550', 2 * k); rect(c, 7 * k, 6 * k, 7 * k, 4 * k, '#5a6472', 1 * k); circ(c, 10.5 * k, 8 * k, 1.5 * k, '#ffe9a8'); } },
  bag_school: { name: 'Школьный рюкзак', w: 1, type: 'bag', cap: 8, icon: (c, s) => { const k = s / 24; rect(c, 6 * k, 7 * k, 12 * k, 12 * k, '#7a5230', 4 * k); rect(c, 8 * k, 12 * k, 8 * k, 5 * k, '#5e3d22', 2 * k); } },
  bag_hike: { name: 'Походный рюкзак', w: 1.5, type: 'bag', cap: 14, icon: (c, s) => { const k = s / 24; rect(c, 5 * k, 6 * k, 14 * k, 13 * k, '#4c5b41', 4 * k); rect(c, 7 * k, 11 * k, 10 * k, 5 * k, '#39452f', 2 * k); } },
  cloth_shirt: { name: 'Рубашка', w: .5, type: 'cloth', rip: 2, icon: (c, s) => { const k = s / 24; c.fillStyle = '#5e7a94'; c.beginPath(); c.moveTo(8 * k, 6 * k); c.lineTo(16 * k, 6 * k); c.lineTo(20 * k, 10 * k); c.lineTo(17 * k, 13 * k); c.lineTo(16 * k, 19 * k); c.lineTo(8 * k, 19 * k); c.lineTo(7 * k, 13 * k); c.lineTo(4 * k, 10 * k); c.fill(); } },
  cloth_pants: { name: 'Джинсы', w: .8, type: 'cloth', rip: 2, icon: (c, s) => { const k = s / 24; c.fillStyle = '#41537e'; c.beginPath(); c.moveTo(8 * k, 5 * k); c.lineTo(16 * k, 5 * k); c.lineTo(17 * k, 19 * k); c.lineTo(13 * k, 19 * k); c.lineTo(12 * k, 10 * k); c.lineTo(11 * k, 19 * k); c.lineTo(7 * k, 19 * k); c.fill(); } },
};

// ---------------- Рецепты крафта ----------------
// needs: {itemId: count}, make(G) выдаёт результат
export const RECIPES = [
  {
    id: 'rip', name: 'Порвать на ткань', desc: 'Рубашка / джинсы / простыня → рваная ткань ×2',
    needs: () => 'cloth|mat_sheet', make: { med_ripped: 2 },
  },
  {
    id: 'bat_nails', name: 'Бита с гвоздями', desc: 'Бита + гвозди ×4', needs: { w_bat: 1, mat_nails: 4 }, make: { w_bat_nails: 1 },
  },
];

// ---------------- SVG-иконки интерфейса (24×24) ----------------
export const SVG = {
  hunger: '<path d="M7 3c-2 0-3 3-3 5 0 3 2 4 4 4v9h2v-9c2 0 4-1 4-4 0-2-1-5-3-5v6h-1V3h-1v6h-1V3h-1zM17 3c-1.5 2-2 4.5-2 7v11h2v-5h2V3h-2zm0 2v6h-1c0-2 .4-4 1-6z"/>',
  thirst: '<path d="M12 3C12 3 6 10 6 14a6 6 0 0 0 12 0c0-4-6-11-6-11zm0 15a3 3 0 0 1-3-3c0-1 .9-3.4 3-5.7 2.1 2.3 3 4.7 3 5.7a3 3 0 0 1-3 3z"/>',
  tired: '<path d="M20 13A8 8 0 1 1 11 4a7 7 0 0 0 9 9z"/>',
  endurance: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
  panic: '<path d="M12 2 1 21h22L12 2zm0 6 7 12H5l7-12zm-1 4v4h2v-4h-2zm0 5v2h2v-2h-2z"/>',
  pain: '<path d="M12 3a4 4 0 0 1 4 4c0 3.5-4 6-4 10.5C12 13 8 10.5 8 7a4 4 0 0 1 4-4zm0 5.5A1.5 1.5 0 1 1 13.5 7 1.5 1.5 0 0 1 12 8.5zM6 17l12 4M18 17L6 21" stroke-width="2" stroke="currentColor" fill="none"/>',
  bleed: '<path d="M12 3C12 3 6 10 6 14a6 6 0 0 0 12 0c0-4-6-11-6-11zm-2 15.5A3.5 3.5 0 0 1 8.5 15c0-1 .6-2.7 1.5-4.2V18.5z" fill="#c33"/>',
  sick: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1.6"/><circle cx="15" cy="10" r="1.6"/><path d="M8 16c1.5-2 6.5-2 8 0" stroke="currentColor" stroke-width="2" fill="none"/>',
  wet: '<path d="M7 15a5 5 0 1 1 1-9.9A6 6 0 0 1 19 8a4 4 0 0 1-1 7.9H7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" stroke="currentColor" stroke-width="2"/>',
  weight: '<path d="M9 4h6v3l4 13H5L9 7V4zm2 3h2v1.5h-2V7zm-1 7a2 2 0 1 0 4 0" fill="none" stroke="currentColor" stroke-width="0"/><path d="M9 4h6v3l4 13H5L9 7V4z"/>',
  temp: '<path d="M12 3a2 2 0 0 1 2 2v8a4 4 0 1 1-4 0V5a2 2 0 0 1 2-2zm0 12a2 2 0 1 0 .01 4.01A2 2 0 0 0 12 15z"/>',
  run: '<path d="M13 4a2 2 0 1 1 .01 4.01A2 2 0 0 1 13 4zM6 21l3.5-6-2-2 .5-4 4-2 2.5 3 3 1-.5 2-3.5-1-.8-1.2-1.2 1.7 2.3 2.2L15 21h-2.4l-1.5-4.6L8.6 21H6z"/>',
  sneak: '<path d="M4 12c3-5 13-5 16 0-3 5-13 5-16 0zm8 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>',
  attack: '<path d="M14.5 3 21 9.5 9.5 21 3 14.5 14.5 3zm-2.1 4.2L5.8 14.5l2.7 2.7 2-2-.9-1 1.4-1.4 1 1 2-2-1-1 1.4-1.4-1-1 2-2z"/>',
  bag: '<path d="M12 3a3 3 0 0 1 3 3h3l1 14H5L6 6h3a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1h2a1 1 0 0 0-1-1z"/>',
  craft: '<path d="M21 7l-4-4-9.5 9.5-2 6 6-2L21 7zM6.5 15.5l2 2-2.5.8.5-2.8z"/>',
  health: '<path d="M12 21S4 15.5 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5C20 15.5 12 21 12 21z"/>',
  torch: '<path d="M8 3h8l-2 5h-4L8 3zm3 5h2v6l1 1-1 6h-2l-1-6 1-1V8z"/>',
  menu: '<path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M19.5 4.5l-2 2M6.5 17.5l-2 2" stroke="currentColor" stroke-width="2" fill="none"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 9a4 4 0 0 1-1 7.9H7z"/>',
  rain: '<path d="M7 14a5 5 0 1 1 1-9.9A6 6 0 0 1 19 7a4 4 0 0 1-1 7.9H7zm2 4-1 4M13 16l-1 4M17 16l-1 4" stroke="currentColor" stroke-width="2" fill="none"/>',
  moon: '<path d="M20 13A8 8 0 1 1 11 4a7 7 0 0 0 9 9z"/>',
  skull: '<path d="M12 2a8 8 0 0 0-8 8c0 3 1.5 5 3 6v4h10v-4c1.5-1 3-3 3-6a8 8 0 0 0-8-8zM9 12a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm6 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM10 16h1v3h-1v-3zm3 0h1v3h-1v-3z"/>',
  hand: '<path d="M8 11V5a2 2 0 0 1 4 0v5V4a2 2 0 0 1 4 0v7l1.5-2c.8-1 2.4-.4 2.4.9 0 .4-.1.8-.3 1.2L16 18c-.8 2.4-2.5 4-5.5 4S5.5 19.5 5 16l-1.5-5c-.3-1.6 1.9-2.4 2.8-1L8 13v-2z"/>',
  door: '<path d="M5 3h14v18h-2V5H7v16H5V3zm9 9a1.5 1.5 0 1 1-1.5-1.5A1.5 1.5 0 0 1 14 12z"/>',
  search: '<circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l6 6" stroke="currentColor" stroke-width="2.5"/>',
  bed: '<path d="M3 7h2v7h14v-4a3 3 0 0 0-3-3H9v5H7V7H3zm2 9h14v2h-2v-1H7v1H5v-2z"/>',
  build: '<path d="M14 6l-8 8 4 4 8-8-4-4zM5 19h14v2H5zM15 2l2 2-3.5 3.5-2-2L15 2z" transform="translate(0,-1)"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" fill="none"/>',
};
export const svgIcon = (name, size = 22, color = 'currentColor') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" style="display:block">${SVG[name] || ''}</svg>`;
