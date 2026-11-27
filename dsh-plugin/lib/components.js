/**
 * Deterministic component geometry for the FORM workbench.
 *
 * The agent chooses a kind, millimeter dimensions and a colour; this module
 * turns that into the same block/part structure the browser already renders.
 * Keeping geometry here (instead of asking the model for block coordinates)
 * makes every agent result buildable, collidable and editable.
 */

const MM_PER_GRID = 500;
const MAX_GRID = 8;
const MIN_GRID = 0.3;

export const SUPPORTED_KINDS = [
  'shelf',
  'sofa',
  'table',
  'window',
  'door',
  'planter',
  'plant',
  'rug',
  'cabinet',
  'bed',
  'chair',
  'desk',
  'light',
];

const KIND_NAMES = {
  shelf: '书架',
  sofa: '沙发',
  table: '桌子',
  window: '窗组件',
  door: '门组件',
  planter: '花池',
  plant: '绿植',
  rug: '地毯',
  cabinet: '柜子',
  bed: '床',
  chair: '椅子',
  desk: '书桌',
  light: '落地灯',
};

const DEFAULT_COLORS = {
  shelf: '#c9b69a',
  sofa: '#89977d',
  table: '#c2ac8e',
  window: '#d5dfd7',
  door: '#c9b69a',
  planter: '#b8ac97',
  plant: '#87987e',
  rug: '#e7e2d5',
  cabinet: '#bdab8d',
  bed: '#d8d3c6',
  chair: '#c9b69a',
  desk: '#c2ac8e',
  light: '#d9d4c4',
};

function num(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function normalizeColor(value, fallback) {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim().toLowerCase();
  if (typeof value === 'string' && /^#[0-9a-f]{3}$/i.test(value.trim())) {
    const raw = value.trim().slice(1);
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toLowerCase();
  }
  return fallback;
}

function shade(hex, factor) {
  const rgb = hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16));
  return `#${rgb
    .map((channel) => clamp(Math.round(channel * factor), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Turn a millimetre description into a valid FORM custom component.
 * @param {object} input
 * @param {string} input.kind
 * @param {number} [input.widthMm]
 * @param {number} [input.depthMm]
 * @param {number} [input.heightMm]
 * @param {string} [input.color]
 * @param {string} [input.name]
 * @param {string} [input.notes]
 * @param {string} [input.skill]
 */
export function buildComponent(input = {}) {
  const kind = SUPPORTED_KINDS.includes(input.kind) ? input.kind : 'shelf';
  const color = normalizeColor(input.color, DEFAULT_COLORS[kind]);
  const w = round(clamp(num(input.widthMm, 1800) / MM_PER_GRID, MIN_GRID, MAX_GRID));
  const d = round(clamp(num(input.depthMm, 600) / MM_PER_GRID, MIN_GRID, MAX_GRID));
  const h = round(clamp(num(input.heightMm, 2000) / MM_PER_GRID, 0.05, MAX_GRID));
  const parts = [];
  const add = (x, y, z, sx, sy, sz, c = color) => {
    parts.push({
      x: round(clamp(x, 0, Math.max(0, w - 0.01))),
      y: round(clamp(y, 0, Math.max(0, d - 0.01))),
      z: round(clamp(z, 0, Math.max(0, h - 0.01))),
      sx: round(Math.max(0.02, Math.min(sx, w))),
      sy: round(Math.max(0.02, Math.min(sy, d))),
      sz: round(Math.max(0.02, Math.min(sz, h))),
      c,
    });
  };

  if (kind === 'shelf') {
    const t = Math.min(0.1, Math.max(0.04, w / 14));
    add(0, 0, 0, t, d, h, shade(color, 0.94));
    add(w - t, 0, 0, t, d, h, shade(color, 0.94));
    add(0, d - t, 0, w, t, h, shade(color, 0.9));
    const shelves = Math.max(3, Math.min(6, Math.round(h / 0.9)));
    for (let i = 0; i <= shelves; i++) {
      add(0, 0, (h - t) * (i / shelves), w, d, t, shade(color, 1.03));
    }
    const rows = Math.max(1, shelves);
    for (let i = 0; i < rows; i++) {
      const z = (h - t) * (i / shelves) + t;
      const count = 3 + (i % 3);
      for (let j = 0; j < count; j++) {
        const bw = (w - 0.35) / count;
        add(0.18 + j * bw, d * 0.22, z, bw * 0.7, d * 0.6, h * 0.12, j % 2 ? '#82927e' : '#dcd8bf');
      }
    }
  } else if (kind === 'sofa') {
    const seatH = h * 0.4;
    add(0, 0, seatH * 0.35, w, d, seatH, shade(color, 0.92));
    add(0, d * 0.78, seatH, w, d * 0.22, h - seatH, color);
    add(0, 0, seatH, w * 0.09, d, h * 0.62, color);
    add(w * 0.91, 0, seatH, w * 0.09, d, h * 0.62, color);
    const cushions = Math.max(2, Math.min(4, Math.round(w / 0.9)));
    for (let i = 0; i < cushions; i++) {
      add(w * 0.11 + i * (w * 0.78 / cushions), d * 0.04, seatH * 1.03, (w * 0.78 / cushions) * 0.92, d * 0.7, h * 0.16, shade(color, 1.05));
    }
    add(w * 0.12, d * 0.1, seatH * 1.3, w * 0.22, d * 0.3, h * 0.22, '#b9ac8d');
  } else if (kind === 'table') {
    const top = Math.min(0.18, h * 0.22);
    add(0, 0, h - top, w, d, top, color);
    const leg = Math.min(0.18, w / 12);
    for (const x of [w * 0.06, w * 0.94 - leg]) {
      for (const y of [d * 0.08, d * 0.92 - leg]) {
        add(x, y, 0, leg, leg, h - top, shade(color, 0.9));
      }
    }
    add(w * 0.2, d * 0.25, h, w * 0.22, d * 0.4, 0.06, '#f0ede1');
    add(w * 0.3, d * 0.32, h + 0.06, w * 0.2, d * 0.26, 0.05, '#7a8978');
  } else if (kind === 'window' || kind === 'door') {
    const t = Math.min(0.12, Math.max(0.05, w / 18));
    add(0, 0, 0, t, d, h, shade(color, 0.96));
    add(w - t, 0, 0, t, d, h, shade(color, 0.96));
    add(0, 0, h - t, w, d, t, shade(color, 0.96));
    if (kind === 'window') {
      add(0, d * 0.42, 0, w, d * 0.16, t, shade(color, 1.05));
      add(w * 0.48, d * 0.42, t, t, d * 0.16, h - 2 * t, '#c4d9d7');
      add(t, d * 0.44, t, w - 2 * t, d * 0.12, h - 2 * t, '#c4d9d7');
    } else {
      add(t, d * 0.35, 0, w - 2 * t, d * 0.5, h - t, shade(color, 0.94));
      add(w * 0.52, d * 0.9, h * 0.55, 0.05, 0.05, 0.05, '#8b8578');
    }
  } else if (kind === 'planter') {
    add(0, 0, 0, w, d, h * 0.6, '#b8ac97');
    add(w * 0.06, d * 0.08, h * 0.6, w * 0.88, d * 0.84, h * 0.06, '#7d6c55');
    const bushes = Math.max(2, Math.min(5, Math.round(w / 0.5)));
    for (let i = 0; i < bushes; i++) {
      add(w * 0.05 + i * (w * 0.9 / bushes), d * 0.12, h * 0.66, (w * 0.9 / bushes) * 0.85, d * 0.76, h * 0.34, i % 2 ? '#87987b' : '#7a8c70');
    }
  } else if (kind === 'plant') {
    add(w * 0.16, d * 0.16, 0, w * 0.68, d * 0.68, h * 0.2, '#b8ac97');
    add(w * 0.46, d * 0.46, h * 0.2, w * 0.08, d * 0.08, h * 0.45, '#9a8665');
    add(0, 0, h * 0.42, w, d, h * 0.26, '#89977d');
    add(w * 0.18, d * 0.13, h * 0.68, w * 0.7, d * 0.7, h * 0.24, '#809371');
    add(w * 0.3, d * 0.3, h * 0.9, w * 0.4, d * 0.4, h * 0.1, '#95a184');
  } else if (kind === 'rug') {
    add(0, 0, 0, w, d, Math.min(0.04, h), color);
    add(w * 0.04, d * 0.04, 0.04, w * 0.92, d * 0.92, 0.015, shade(color, 0.96));
  } else if (kind === 'cabinet') {
    const body = Math.max(0.2, h * 0.96);
    add(0, 0, 0, w, d, body, color);
    add(w * 0.03, -0.02, body * 0.1, w * 0.44, 0.04, body * 0.76, shade(color, 1.06));
    add(w * 0.53, -0.02, body * 0.1, w * 0.44, 0.04, body * 0.76, shade(color, 1.06));
    add(w * 0.12, -0.04, body * 0.8, 0.05, 0.06, 0.2, '#8b8578');
    add(w * 0.62, -0.04, body * 0.8, 0.05, 0.06, 0.2, '#8b8578');
    add(w * 0.08, d * 0.2, body, w * 0.25, d * 0.35, 0.18, '#eee8dc');
  } else if (kind === 'bed') {
    add(0, 0, 0, w, d, h * 0.22, shade(color, 0.92));
    add(0, 0, h * 0.22, w, d * 0.94, h * 0.22, '#e8e4d9');
    add(0, d * 0.9, 0, w, d * 0.1, h * 0.9, color);
    add(w * 0.06, d * 0.08, h * 0.44, w * 0.36, d * 0.35, h * 0.1, '#f1eee5');
    add(w * 0.54, d * 0.08, h * 0.44, w * 0.36, d * 0.35, h * 0.1, '#f1eee5');
    add(0, d * 0.5, h * 0.44, w, d * 0.36, h * 0.08, '#d2cbb9');
  } else if (kind === 'chair') {
    const seat = h * 0.5;
    add(0, 0, seat, w, d, Math.min(0.12, h * 0.12), color);
    add(0, d * 0.82, seat, w, d * 0.14, h - seat, color);
    const leg = Math.min(0.08, w / 10);
    for (const x of [w * 0.08, w * 0.92 - leg]) {
      for (const y of [d * 0.1, d * 0.9 - leg]) {
        add(x, y, 0, leg, leg, seat, shade(color, 0.9));
      }
    }
  } else if (kind === 'desk') {
    const top = Math.min(0.14, h * 0.14);
    add(0, 0, h - top, w, d, top, color);
    const leg = Math.min(0.12, w / 14);
    add(w * 0.06, d * 0.08, 0, leg, d * 0.84, h - top, shade(color, 0.9));
    add(w * 0.94 - leg, d * 0.08, 0, leg, d * 0.84, h - top, shade(color, 0.9));
    add(w * 0.35, d * 0.1, h * 0.5, w * 0.5, d * 0.72, h * 0.28, shade(color, 1.05));
    add(w * 0.18, d * 0.2, h, w * 0.22, d * 0.5, 0.05, '#f0ede1');
  } else if (kind === 'light') {
    add(w * 0.3, d * 0.3, 0, w * 0.4, d * 0.4, h * 0.06, '#8b8578');
    add(w * 0.46, d * 0.46, h * 0.06, w * 0.08, d * 0.08, h * 0.72, '#8b8578');
    add(w * 0.1, d * 0.1, h * 0.74, w * 0.8, d * 0.8, h * 0.26, color);
    add(w * 0.2, d * 0.2, h * 0.72, w * 0.6, d * 0.6, h * 0.04, '#fff3cf');
  }

  const fallbackName = KIND_NAMES[kind] || '组件';
  let name = (typeof input.name === 'string' && input.name.trim() ? input.name.trim() : `${colorName(color)}${fallbackName}`).slice(0, 28);
  if (/[圆弧曲]/.test(name) && !name.includes('近似')) name = `${name.slice(0, 20)}（方块近似）`;
  return {
    id: `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name,
    type: 'custom',
    x: 0,
    y: 0,
    z: 0,
    sx: w,
    sy: d,
    sz: h,
    c: color,
    parts,
    source: 'dsh-form-agent',
    skill: typeof input.skill === 'string' ? input.skill : undefined,
    description: typeof input.notes === 'string' ? input.notes.slice(0, 240) : undefined,
  };
}

function colorName(hex) {
  const map = {
    '#e8e5da': '奶油白',
    '#c9b69a': '浅木色',
    '#89977d': '绿色',
    '#a8b4b5': '雾蓝',
    '#bc8e79': '赤陶',
    '#5c6b60': '森林绿',
  };
  return map[hex] || '定制';
}

/** Human-readable summary used by the tool result and by the API fallback. */
export function summarize(component) {
  const mm = (value) => Math.round(value * MM_PER_GRID);
  return `已生成「${component.name}」：宽 ${mm(component.sx)} × 深 ${mm(component.sy)} × 高 ${mm(component.sz)} mm，共 ${component.parts.length} 个体块。`;
}
