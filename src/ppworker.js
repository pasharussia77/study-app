// Web worker: runs the PaddleOCR text finder off the main screen so the app stays responsive.
// Models and the ONNX runtime files come from the app's ocr/ folder and are kept by the phone after the first use.
import * as ort from 'onnxruntime-web/wasm';
import { readImage } from './paddle.js';

let ready = null;
function load(base) {
  if (!ready) ready = (async () => {
    ort.env.wasm.wasmPaths = base + 'ocr/';
    // several cores when the app is isolated (see sw.js); otherwise one
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
    const get = async (f) => { // a failed download is tried once more; the error names the file
      for (let k = 0; ; k++) {
        try { const r = await fetch(base + 'ocr/' + f); if (!r.ok) throw new Error('status ' + r.status); return r; }
        catch (err) { if (k >= 1) throw new Error(f + ': ' + ((err && err.message) || err)); await new Promise((ok) => setTimeout(ok, 1500)); }
      }
    };
    ort.env.wasm.wasmBinary = await get('ort-wasm-simd-threaded.wasm').then((r) => r.arrayBuffer()); // so the runtime's own download is retried too
    const [det, rec, keys] = await Promise.all([
      get('pp-det.onnx').then((r) => r.arrayBuffer()).then((b) => ort.InferenceSession.create(b)),
      get('pp-rec.onnx').then((r) => r.arrayBuffer()).then((b) => ort.InferenceSession.create(b)),
      get('pp-keys.txt').then((r) => r.text()).then((t) => t.split('\n')),
    ]);
    return { det, rec, keys };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

self.onmessage = async (e) => {
  const { id, base, img } = e.data;
  try {
    const { det, rec, keys } = await load(base);
    const lines = await readImage(ort, det, rec, keys, img);
    self.postMessage({ id, lines, threads: ort.env.wasm.numThreads });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
