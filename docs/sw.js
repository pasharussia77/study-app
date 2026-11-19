// Keeps the app opening offline. Pages and files: network first, cache as backup.
const CACHE = 'study-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'study-ocr-v2').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// Lets the text finder use several processor cores: Chrome allows that only when the app's own files carry these two
// settings, and GitHub Pages cannot send them. "credentialless" still lets outside files (fonts, Firebase) load.
const isolate = (res) => {
  if (!res || !res.status || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
};
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return; // let Firebase traffic pass through untouched
  // the text-reading engine files never change: keep them on the phone after the first download
  if (sameOrigin && url.pathname.includes('/ocr/')) {
    e.respondWith(caches.open('study-ocr-v2').then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }))).then(isolate));
    return;
  }
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))).then((res) => (sameOrigin ? isolate(res) : res))
  );
});
