/* Qarzhy 2 — офлайн кэш */
const CACHE = 'qarzhy2-v1';
const FILES = ['./', './index.html', './app.js', './tools.js', './parse.js', './i18n.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable.png', './icon-apple.png', './fonts/cormorant-700.woff2',
  './fonts/onest-cyrillic-ext-wght-normal.woff2', './fonts/onest-cyrillic-wght-normal.woff2',
  './fonts/onest-latin-wght-normal.woff2', './fonts/onest-latin-ext-wght-normal.woff2', './banks/bcc.png','./banks/bereke.png','./banks/forte.png','./banks/freedom.png','./banks/halyk.png','./banks/homecredit.png','./banks/jusan.png','./banks/kaspi.png','./banks/otbasy.png','./banks/qazaq.png'];
const CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(k => k.startsWith('qarzhy2-') && k !== CACHE).map(k => caches.delete(k))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let url; try { url = new URL(e.request.url); } catch (_) { return; }
  const same = url.origin === self.location.origin, cdn = CDN.includes(url.hostname);
  if (!same && !cdn) return;
  if (cdn) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    })));
    return;
  }
  /* өз файлдарымыз: алдымен желі — жаңа нұсқа бірден көрінеді; желі болмаса кэш */
  const page = e.request.mode === 'navigate';
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(page ? './index.html' : e.request, copy)); }
    return res;
  }).catch(() => caches.match(page ? './index.html' : e.request, { ignoreSearch: true })));
});
