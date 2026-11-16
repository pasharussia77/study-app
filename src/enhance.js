// Light clean-up of a page photo before it is stored and sent to the AI:
// removes the colour cast of lamp light (white balance) and makes the paper white and the ink dark (contrast).
// One gain per colour channel and one shared black point, so colours keep their hue: red ink stays red.
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

function percentile(hist, total, p) {
  let n = 0;
  const want = total * p;
  for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= want) return v; }
  return 255;
}

// Changes the RGBA pixel array in place. Returns what was done (for the diagnostic report).
export function enhancePixels(data) {
  const step = Math.max(1, Math.floor(data.length / 4 / 60000)) * 4; // look at about 60,000 pixels
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < data.length; i += step) { hist[Math.round(lum(data[i], data[i + 1], data[i + 2]))]++; total++; }
  const p90 = percentile(hist, total, 0.90), p995 = percentile(hist, total, 0.995);
  // Not a page of paper (too dark, or no bright area): leave the picture alone.
  if (p90 < 100) return { applied: false, why: 'too dark to find the paper' };

  // The paper: the bright pixels, leaving out the very brightest (glare).
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += step) {
    const l = lum(data[i], data[i + 1], data[i + 2]);
    if (l >= p90 && l <= p995) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  }
  if (!n) return { applied: false, why: 'no paper found' };
  r /= n; g /= n; b /= n;
  // Lamp light is warm: red >= green >= blue. That cast (or a mild cool one) is removed.
  // Paper of any other strong colour (pink, green) is a coloured sheet, so its colours are not shifted.
  const cast = Math.max(r, g, b) / Math.max(1, Math.min(r, g, b));
  const warm = r >= g && g >= b, cool = b >= g && g >= r;
  const balance = cast <= 1.25 || (warm && cast <= 2.2) || (cool && cast <= 1.5);
  const WHITE = 245;
  const clamp = (x) => Math.min(2.2, Math.max(0.7, x));
  const top = Math.max(r, g, b);
  const gain = balance ? [clamp(WHITE / r), clamp(WHITE / g), clamp(WHITE / b)] : [clamp(WHITE / top), clamp(WHITE / top), clamp(WHITE / top)];

  // Black point: the darkest ink after the gains, kept gentle so nothing is crushed.
  const h2 = new Uint32Array(256);
  for (let i = 0; i < data.length; i += step) h2[Math.min(255, Math.round(lum(data[i] * gain[0], data[i + 1] * gain[1], data[i + 2] * gain[2])))]++;
  const lo = Math.min(50, percentile(h2, total, 0.01));
  const k = 255 / (WHITE - lo);

  const lut = [0, 1, 2].map((c) => { const t = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) t[v] = (v * gain[c] - lo) * k; return t; });
  for (let i = 0; i < data.length; i += 4) { data[i] = lut[0][data[i]]; data[i + 1] = lut[1][data[i + 1]]; data[i + 2] = lut[2][data[i + 2]]; }
  const round = (x) => Math.round(x * 100) / 100;
  return { applied: true, paper: [Math.round(r), Math.round(g), Math.round(b)], gain: gain.map(round), black: lo, whiteBalance: balance };
}

export function enhanceCanvas(canvas) {
  try {
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const info = enhancePixels(img.data);
    if (info.applied) ctx.putImageData(img, 0, 0);
    return info;
  } catch (e) { return { applied: false, why: e.message }; }
}
