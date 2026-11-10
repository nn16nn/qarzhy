/* Qarzhy 2 — офлайн кэш */
const CACHE = 'qarzhy2-v17';
const FILES = ['./', './index.html', './app.js', './tools.js', './features.js', './parse.js', './i18n.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable.png', './icon-apple.png', './privacy.html', './fonts/cormorant-700.woff2',
  './fonts/onest-cyrillic-ext-wght-normal.woff2', './fonts/onest-cyrillic-wght-normal.woff2',
  './fonts/onest-latin-wght-normal.woff2', './fonts/onest-latin-ext-wght-normal.woff2', './banks/bcc.png','./banks/bereke.png','./banks/forte.png','./banks/freedom.png','./banks/halyk.png','./banks/homecredit.png','./banks/jusan.png','./banks/kaspi.png','./banks/otbasy.png','./banks/qazaq.png'];
const CDN = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(k => k.startsWith('qarzhy') && k !== CACHE).map(k => caches.delete(k))))
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
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(page ? './index.html' : e.request, copy)); }
    return res;
  }).catch(() => caches.match(page ? './index.html' : e.request, { ignoreSearch: true })));
});

/* ===== Еске салу: фондық тексеру (periodicSync) және қосымша ашылғанда ===== */
const SYM = { KZT:'₸', RUB:'₽', USD:'$', EUR:'€', KGS:'сом', UZS:'сўм', TRY:'₺', GBP:'£', CNY:'¥', AED:'AED', INR:'₹', UAH:'₴', GEL:'₾', AZN:'₼', BYN:'Br', TJS:'SM', KRW:'₩', JPY:'¥' };
const TXT = {
  kk: { today:'Бүгін', tom:'Ертең', pay:'төлем', loan:'несие төлемі', debtIn:'қарызды қайтаратын күн', debtOut:'сізге қарыз қайтаратын күн', eve:'Бүгінгі шығындарды жаздыңыз ба?', eveB:'Бір минут — және ай соңында бәрі анық болады.' },
  ru: { today:'Сегодня', tom:'Завтра', pay:'платёж', loan:'платёж по кредиту', debtIn:'срок возврата долга', debtOut:'вам должны вернуть долг', eve:'Записали сегодняшние расходы?', eveB:'Одна минута — и в конце месяца всё будет ясно.' },
  en: { today:'Today', tom:'Tomorrow', pay:'payment', loan:'loan payment', debtIn:'debt due', debtOut:'debt owed to you is due', eve:'Logged today’s expenses?', eveB:'One minute now keeps the month clear.' }
};
function kv(mode, fn) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('qarzhy', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
    r.onerror = rej;
    r.onsuccess = () => { const x = r.result.transaction('kv', mode); const q = fn(x.objectStore('kv')); x.oncomplete = () => res(q && q.result); x.onerror = rej; };
  });
}
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fmt = (n, s) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ' + s;
async function remind() {
  const db = await kv('readonly', s => s.get('db'));
  if (!db || !db.pref || !db.pref.notify) return;
  const L = TXT[db.lang] || TXT.kk, sym = SYM[(db.pref && db.pref.base) || 'KZT'] || '₸';
  const now = new Date(), today = iso(now), tm = new Date(now); tm.setDate(tm.getDate() + 1);
  const tomorrow = iso(tm), month = today.slice(0, 7);
  const sent = (await kv('readonly', s => s.get('notified'))) || {};
  const out = [];
  const dayIs = (d, ref) => d === ref.getDate() || (d > 28 && ref.getDate() === new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate() && d >= ref.getDate());
  (db.recur || []).forEach(r => {
    if (r.paid === month) return;
    if (dayIs(r.day, now)) out.push(['r' + r.id + today, L.today + ' — ' + L.pay, r.name + ' · ' + fmt(r.amt, sym)]);
    else if (dayIs(r.day, tm)) out.push(['r' + r.id + tomorrow, L.tom + ' — ' + L.pay, r.name + ' · ' + fmt(r.amt, sym)]);
  });
  (db.accounts || []).forEach(a => {
    if (a.kind !== 'debt' || !a.payDay || !(a.bal > 0)) return;
    if (dayIs(a.payDay, now)) out.push(['l' + a.id + today, L.today + ' — ' + L.loan, a.name + (a.pay ? ' · ' + fmt(a.pay, sym) : '')]);
    else if (dayIs(a.payDay, tm)) out.push(['l' + a.id + tomorrow, L.tom + ' — ' + L.loan, a.name + (a.pay ? ' · ' + fmt(a.pay, sym) : '')]);
  });
  (db.debts || []).forEach(d => {
    const left = (d.amt || 0) - (d.paid || 0);
    if (left <= 0 || !d.due) return;
    if (d.due === today || d.due === tomorrow) out.push(['d' + d.id + d.due, (d.due === today ? L.today : L.tom) + ' — ' + (d.dir === 'out' ? L.debtOut : L.debtIn), d.who + ' · ' + fmt(left, sym)]);
  });
  if (now.getHours() >= 19 && !(db.tx || []).some(x => x.date === today)) out.push(['e' + today, L.eve, L.eveB]);
  const fresh = out.filter(o => !sent[o[0]]);
  for (const o of fresh) {
    await self.registration.showNotification(o[1], { body: o[2], tag: o[0], icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './index.html#home' } });
    sent[o[0]] = today;
  }
  const keep = {}; const cut = iso(new Date(now.getTime() - 7 * 864e5));
  Object.keys(sent).forEach(k => { if (sent[k] >= cut) keep[k] = sent[k]; });
  await kv('readwrite', s => s.put(keep, 'notified'));
}
self.addEventListener('periodicsync', e => { if (e.tag === 'qarzhy-remind') e.waitUntil(remind().catch(() => {})); });
self.addEventListener('message', e => { if (e.data && e.data.type === 'remind') e.waitUntil(remind().catch(() => {})); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
