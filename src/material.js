import { askAIDetailed } from './ai.js';

const MAX_DATA_CHARS = 850000; // Firestore documents must stay under 1 MiB

export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That picture could not be opened.')); };
    img.src = url;
  });
}

// Shrinks a photo so it fits in the database: longest side 1600 px, JPEG.
export async function compressImage(source) {
  const img = source instanceof HTMLCanvasElement ? source : await fileToImage(source);
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  let max = 1600, quality = 0.78;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * scale); c.height = Math.round(h0 * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', quality);
    if (data.length <= MAX_DATA_CHARS) return { data, width: c.width, height: c.height };
    quality = Math.max(0.5, quality - 0.1); max = Math.round(max * 0.8);
  }
  throw new Error('That picture is too large to store.');
}

import { buildPrompt, parseAiJson, resolvePage } from './items.js';

// Reads one photo and returns clean study items plus notes for the next page.
export async function readPhotoItems(code, dataUrl, ignore = 'none', ctx = null, log = () => {}) {
  const prompt = buildPrompt(ignore, ctx);
  const t0 = Date.now();
  let res;
  try {
    res = await askAIDetailed(code, {
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } }
      ] }],
      json: true,
      maxTokens: 4000
    });
  } catch (e) {
    log({ type: 'photo_read', ignore, prompt, ok: false, error: e.message, ms: Date.now() - t0 });
    throw e;
  }
  let result;
  try { result = resolvePage(parseAiJson(res.text), ctx); }
  catch (e) {
    log({ type: 'photo_read', ignore, prompt, ok: false, error: e.message, ms: res.ms, usage: res.usage, raw: res.text });
    throw e;
  }
  if (!result.items.length) {
    log({ type: 'photo_read', ignore, prompt, ok: false, error: 'No study items found', ms: res.ms, usage: res.usage, raw: res.text });
    throw new Error('No readable questions or words were found in this picture.');
  }
  log({ type: 'photo_read', ignore, prompt, ok: true, ms: res.ms, usage: res.usage, raw: res.text,
        made: result.items.length, flagged: result.items.filter((i) => i.flagged).length, page: result.page });
  return result;
}

export async function readTextFile(file) {
  const t = (await file.text()).trim();
  if (!t) throw new Error('That file is empty.');
  return t;
}

const MAX_PDF_PAGES = 30;
const MAX_SCANNED_PAGES = 10;

export async function readPdf(file, onProgress = () => {}, log = () => {}) {
  const t0 = Date.now();
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  let text = '';
  for (let i = 1; i <= pages; i++) {
    onProgress(`Reading page ${i} of ${pages}…`);
    const content = await (await pdf.getPage(i)).getTextContent();
    text += content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n') + '\n';
  }
  text = text.trim();
  let note = pdf.numPages > pages ? `Only the first ${pages} pages were read.` : '';
  if (text.replace(/\s/g, '').length >= 20 * pages) {
    log({ type: 'doc_import', name: file.name, size: file.size, method: 'PDF text layer (no AI)', pages, chars: text.length, ms: Date.now() - t0, note });
    return { text, note };
  }

  // Scanned PDF: no real text inside, so hand back the pages as pictures to be read like photos.
  const scanPages = Math.min(pdf.numPages, MAX_SCANNED_PAGES);
  if (pdf.numPages > scanPages) note = `Only the first ${scanPages} pages were used.`;
  const images = [];
  for (let i = 1; i <= scanPages; i++) {
    onProgress(`Preparing page ${i} of ${scanPages}…`);
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1.6 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    images.push(await compressImage(c));
  }
  log({ type: 'doc_import', name: file.name, size: file.size, method: 'Scanned PDF turned into page photos', pages: scanPages, chars: 0, ms: Date.now() - t0, note });
  return { text: '', images, note };
}
