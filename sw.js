/* Қаржы — офлайн кэш (v14) */
const CACHE = 'qarzhy-v14';
const FILES = [
  './', './index.html', './app.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable.png'
];
const CDN_OK = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

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

  var sameOrigin = url.origin === self.location.origin;
  var isCdn = CDN_OK.indexOf(url.hostname) !== -1;
  if (!sameOrigin && !isCdn) return;   // API сұраулары — тікелей желіге

  // Сыртқы кітапханалар (pdf.js, SheetJS) — кэштен, өзгермейді
  if (isCdn) {
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
    return;
  }

  // Өз файлдарымыз (index.html, app.js, белгішелер) — алдымен желіден,
  // сонда GitHub-қа жаңа нұсқа жүктелген соң бірден көрінеді
  var isPage = e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').indexOf('text/html') !== -1;

  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) {
        c.put(isPage ? './index.html' : e.request, copy);
      });
      return res;
    }).catch(function () {
      return caches.match(isPage ? './index.html' : e.request);
    })
  );
});
