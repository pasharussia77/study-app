// Colour settings for each student: one of five palettes plus a position on the colour pad.
//   x (left to right): 0 = black and white, 0.5 (the centre) = the original colours, 1 = brightest and most saturated
//   y (top to bottom): 0 = warm background, 0.5 = neutral, 1 = cold background
// The whole app is coloured from a few CSS variables set here, so changing them recolours every screen at once.

export const PALETTES = [
  { id: 'twilight', name: 'Twilight', hue: 0 },    // the original blue and purple
  { id: 'ocean', name: 'Ocean', hue: -47 },        // blues and teal
  { id: 'orchid', name: 'Orchid', hue: 50 },       // magenta and pink
  { id: 'forest', name: 'Forest', hue: -112 },     // greens
  { id: 'ember', name: 'Ember', hue: 122 }         // coral and orange
];
export const DEFAULT_THEME = { palette: 'twilight', x: 0.5, y: 0.5 };
export const BASE_HUE = 257; // hue of the original violet, used to draw the palette swatches

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const cleanTheme = (t) => {
  const p = PALETTES.some((x) => x.id === t?.palette) ? t.palette : DEFAULT_THEME.palette;
  const n = (v, d) => (typeof v === 'number' && isFinite(v) ? clamp(v) : d);
  let x = n(t?.x, DEFAULT_THEME.x); const y = n(t?.y, DEFAULT_THEME.y);
  if (x === 0.6 && y === 0.5) x = DEFAULT_THEME.x; // an earlier version used 0.6 as its "original colours" spot
  return { palette: p, x, y };
};

/* ---------- colour maths ---------- */
export function hexToHsl(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, s, l * 100];
}
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s); l = clamp(l / 100);
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
// Blues, purples and pinks follow the palette. Greens, reds, oranges and yellows (right/wrong marks, warnings, the sun) keep their hue.
export const followsPalette = (h) => h >= 190 && h <= 350;
const lerpHue = (a, b, k) => { const d = ((b - a + 540) % 360) - 180; return (a + d * k + 360) % 360; };

// Older browsers cannot do relative colours; they keep the plain colours (the original look).
export const RELATIVE_COLORS = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('color', 'hsl(from red h s l)');
// A colour written into the stylesheet or the artwork: it reads the live variables, so it changes with the knob.
export function T(hex) {
  const [h, s] = hexToHsl(hex);
  if (s < 0.05 || !RELATIVE_COLORS) return hex;
  return `hsl(from ${hex} ${followsPalette(h) ? 'calc(h + var(--hue))' : 'h'} calc(s * var(--sat)) calc(l + var(--lift) - var(--vivid) * 11 * clamp(0, (l - 70) / 25, 1)))`;
}

/* ---------- the knob ---------- */
export const saturationOf = (x) => (x < 0.5 ? clamp((x - 0.04) / 0.46) : 1 + ((x - 0.5) / 0.5) * 0.7);
export const wornOf = (x) => clamp((0.45 - x) / 0.45);  // how worn and dirty the page looks: starts just left of the centre, full at the far left
export const vividOf = (x) => clamp((x - 0.5) / 0.5);       // how far past the original colours
export const warmthOf = (y) => (0.5 - y) * 2;           // +1 warm (top) ... -1 cold (bottom)
const hueOf = (t) => (PALETTES.find((p) => p.id === t.palette) || PALETTES[0]).hue;

const SKY = ['#DCE5FF', '#EAE4FF', '#F5E7FA', '#E6E7FF'];
const GLOW = { a: ['#CDB4FF', 0.6], b: ['#B0CDFF', 0.65] };
const WAVES = [['#D9D4FF', 0.55], ['#CFDCFF', 0.6], ['#EFE3FB', 0.8]];

// The page background: follows the palette and the colour amount, and takes the warm or cold tint from the pad.
function bgTone(hex, t) {
  const sat = saturationOf(t.x), w = warmthOf(t.y), lift = Math.min(0, (t.x - 0.5) * 5), vivid = vividOf(t.x);
  let [h, s, l] = hexToHsl(hex);
  if (followsPalette(h)) h += hueOf(t);
  h = lerpHue(h, w > 0 ? 30 : 208, Math.abs(w));
  s = s * Math.min(sat, 1.25) + Math.abs(w) * 0.32 * (1 - Math.min(sat, 1));
  l = l + lift - vivid * 11 * clamp((l - 70) / 25) + (w > 0 ? w * 2 : w * 3);
  l = clamp(l / 100, 0, 0.985) * 100;
  return { h, s: clamp(s), l };
}
const css = (c, a) => `hsl(${c.h.toFixed(1)} ${(c.s * 100).toFixed(1)}% ${c.l.toFixed(1)}%${a != null ? ' / ' + a : ''})`;
export const toneHex = (hex, t = current) => { const c = bgTone(hex, t); return hslToHex(c.h, c.s, c.l); };

function wavesImage(t) {
  const d = ['M0 90c70-50 140-30 210 0s130 20 190-30v140H0z', 'M0 130c80-40 160-20 230 4s120 6 170-24v90H0z', 'M0 165c90-26 180-10 250 2s110-4 150-18v51H0z'];
  const paths = d.map((p, i) => `<path d='${p}' fill='${css(bgTone(WAVES[i][0], t))}' fill-opacity='${WAVES[i][1]}'/>`).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 200' preserveAspectRatio='none'>${paths}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

let current = DEFAULT_THEME;
export const currentTheme = () => current;
export const skyTopHex = () => toneHex(SKY[0], current);

export function applyTheme(input) {
  const t = cleanTheme(input);
  current = t;
  const root = document.documentElement.style;
  const set = (k, v) => root.setProperty(k, v);
  set('--hue', String(+(hueOf(t) + warmthOf(t.y) * 8).toFixed(2)));
  set('--sat', String(+saturationOf(t.x).toFixed(3)));
  set('--lift', String(+Math.min(0, (t.x - 0.5) * 5).toFixed(2)));
  set('--vivid', String(+vividOf(t.x).toFixed(3)));
  set('--g', String(+wornOf(t.x).toFixed(3)));
  SKY.forEach((c, i) => set('--bg-sky' + i, css(bgTone(c, t))));
  set('--bg-glow-a', css(bgTone(GLOW.a[0], t), GLOW.a[1]));
  set('--bg-glow-b', css(bgTone(GLOW.b[0], t), GLOW.b[1]));
  set('--bg-waves', wavesImage(t));
  document.documentElement.classList.toggle('is-worn', wornOf(t.x) > 0.01);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', skyTopHex());
}

// Screens that belong to the whole family always start with the default colours; the app then applies a student's own colours inside their area.
applyTheme(DEFAULT_THEME);
if (typeof location !== 'undefined' && location.search.includes('mock')) window.__applyTheme = applyTheme;
