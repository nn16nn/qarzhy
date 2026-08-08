/* Қаржы — офлайн кэш (v3) */
const CACHE = 'qarzhy-v3';
const FILES = [
  './', './index.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable.png'
];
const CDN_OK = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;

  var url;
  try { url = new URL(e.request.url); } catch (err) { return; }

  // Supabase және басқа API сұраулары — кэштелмейді, тікелей желіге
  var sameOrigin = url.origin === self.location.origin;
  var isCdn = CDN_OK.indexOf(url.hostname) !== -1;
  if (!sameOrigin && !isCdn) return;

  var isPage = e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isPage) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      });
    })
  );
});
