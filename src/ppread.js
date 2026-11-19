// Starts the text finder (ppworker.js) and hands it the photo. Returns { lines, W, H } in the photo's pixels.
let worker = null, seq = 0;
const waiting = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./ppworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); e.data.error ? w.reject(new Error(e.data.error)) : w.resolve({ lines: e.data.lines, threads: e.data.threads }); } };
    worker.onerror = (e) => { for (const w of waiting.values()) w.reject(new Error(e.message || 'text finder failed')); waiting.clear(); worker = null; };
  }
  return worker;
}

export async function readEngine(dataUrl, maxSide = 2000) {
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
  const W = Math.round(im.naturalWidth * k), H = Math.round(im.naturalHeight * k);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H);
  const id = ++seq;
  const { lines, threads } = await new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, base: new URL(import.meta.env.BASE_URL, location.href).href, img: { data: d.data, width: W, height: H } }, [d.data.buffer]);
  });
  return { lines, threads, W, H };
}
