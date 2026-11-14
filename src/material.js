import { askAI } from './ai.js';

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

const RULES = 'Keep each line of the page on its own line. If the page is a word list or glossary with definitions, write one entry per line as: word - definition. If it has questions with answers, write each as: question - answer. Do not add commentary, titles you invented, or markdown. If there is no readable text, reply with exactly: NO TEXT';
const PROMPTS = {
  none: 'Transcribe all the text in this image. ' + RULES,
  handwriting: 'Transcribe only the PRINTED text in this image. Ignore any handwriting, notes, underlines or annotations written by hand. ' + RULES,
  printed: 'Transcribe only the HANDWRITTEN text in this image. Ignore all printed or typed text. ' + RULES
};

export async function readImageText(code, dataUrl, ignore = 'none') {
  const text = await askAI(code, {
    messages: [{ role: 'user', content: [
      { type: 'text', text: PROMPTS[ignore] || PROMPTS.none },
      { type: 'image_url', image_url: { url: dataUrl } }
    ] }],
    maxTokens: 3000
  });
  const t = text.trim();
  if (!t || t === 'NO TEXT') throw new Error('No readable text was found in this picture.');
  return t;
}

export async function readTextFile(file) {
  const t = (await file.text()).trim();
  if (!t) throw new Error('That file is empty.');
  return t;
}

const MAX_PDF_PAGES = 30;
const MAX_SCANNED_PAGES = 10;

export async function readPdf(code, file, onProgress = () => {}) {
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
  if (text.replace(/\s/g, '').length >= 20 * pages) return { text, note };

  // Scanned PDF: no real text inside, so draw the pages and let the AI read them.
  const scanPages = Math.min(pdf.numPages, MAX_SCANNED_PAGES);
  if (pdf.numPages > scanPages) note = `Only the first ${scanPages} pages were read.`;
  const parts = [];
  for (let i = 1; i <= scanPages; i++) {
    onProgress(`Reading scanned page ${i} of ${scanPages}…`);
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1.6 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const { data } = await compressImage(c);
    try { parts.push(await readImageText(code, data, 'none')); } catch (e) { if (scanPages === 1) throw e; }
  }
  if (!parts.length) throw new Error('No readable text was found in that PDF.');
  return { text: parts.join('\n'), note };
}
