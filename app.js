/* Qarzhy 2 — қосымша логикасы
   Дерек құрылымы ескі нұсқамен бірдей (qarzhy_v1 · IndexedDB «qarzhy»), сондықтан деректер өзгеріссіз көшеді. */
'use strict';
var VERSION = '2.4.4';

/* ================= ТІЛ ================= */
var LANG = 'kk';
function t(s){
  if(LANG === 'kk' || !window.I18N) return s;
  var r = I18N[s];
  return r ? (LANG === 'ru' ? r[0] : r[1]) || s : s;
}
var MONTHS = ['Қаңтар','Ақпан','Наурыз','Сәуір','Мамыр','Маусым','Шілде','Тамыз','Қыркүйек','Қазан','Қараша','Желтоқсан'];
var MON_S = ['қаң','ақп','нау','сәу','мам','мау','шіл','там','қыр','қаз','қар','жел'];
var WDAYS = ['Жексенбі','Дүйсенбі','Сейсенбі','Сәрсенбі','Бейсенбі','Жұма','Сенбі'];
function monName(i){ return t(MONTHS[i]); }
function monShort(i){ return t(MON_S[i]); }

/* ================= ҚОЙМА ================= */
var DB = { tx:[], goals:[], accounts:[], btx:[], debts:[], limits:{}, split:null, recur:[], lastBackup:null, lang:'kk', theme:'auto', rate:null };
var LS_KEY = 'qarzhy_v1';

function normalize(d){
  /* белгісіз өрістер (pension, split, rules, pref, skin…) сол күйінде қалады */
  d = d || {};
  ['tx','goals','accounts','btx','debts','recur'].forEach(function(k){ if(!Array.isArray(d[k])) d[k] = []; });
  if(!d.limits || typeof d.limits !== 'object') d.limits = {};
  if(!d.rules) d.rules = {};
  if(!d.pref) d.pref = {};
  if(!d.lang) d.lang = detectLang();
  if(!d.theme) d.theme = 'auto';
  if(!d.pref.base) d.pref.base = (d.tx.length || d.accounts.length) ? 'KZT' : guessBase(d.lang);
  if(!d.accounts.length) d.accounts = [{ id:'a1', name:({ kk:'Қолма-қол', ru:'Наличные', en:'Cash' })[d.lang] || 'Қолма-қол', kind:'asset', icon:'wallet', bal:0, cur:d.pref.base }];
  return d;
}
function detectLang(){
  var l = ((navigator.languages && navigator.languages[0]) || navigator.language || 'kk').toLowerCase();
  return /^kk/.test(l) ? 'kk' : /^(ru|be|uk|ky|uz|tg)/.test(l) ? 'ru' : /^en/.test(l) ? 'en' : 'kk';
}
function lsRead(){ try{ var r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : null; }catch(e){ return null; } }

var IDB = null, idbReady = null, idbOK = false, idbChecked = false;
function idbOpen(){
  if(idbReady) return idbReady;
  idbReady = new Promise(function(res, rej){
    if(!window.indexedDB) return rej();
    var r; try{ r = indexedDB.open('qarzhy', 1); }catch(e){ return rej(); }
    r.onupgradeneeded = function(){ if(!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
    r.onsuccess = function(){ IDB = r.result; idbOK = true; res(IDB); };
    r.onerror = r.onblocked = function(){ rej(); };
  });
  return idbReady;
}
function idbSet(k, v){ return idbOpen().then(function(db){ return new Promise(function(res, rej){ var x = db.transaction('kv','readwrite'); x.objectStore('kv').put(v, k); x.oncomplete = res; x.onerror = x.onabort = rej; }); }); }
function idbGet(k){ return idbOpen().then(function(db){ return new Promise(function(res, rej){ var q = db.transaction('kv','readonly').objectStore('kv').get(k); q.onsuccess = function(){ res(q.result); }; q.onerror = rej; }); }); }
function idbDel(k){ return idbOpen().then(function(db){ return new Promise(function(res){ var x = db.transaction('kv','readwrite'); x.objectStore('kv').delete(k); x.oncomplete = x.onerror = res; }); }); }

var saveTimer = null;
function save(){
  DB.updated = new Date().toISOString();
  try{ localStorage.setItem(LS_KEY, JSON.stringify(DB)); }catch(e){}
  clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300);
}
function flush(){
  clearTimeout(saveTimer); saveTimer = null;
  if(!idbChecked) return Promise.resolve();
  return idbSet('db', JSON.parse(JSON.stringify(DB))).catch(function(){});
}
function bootData(){
  var ls = lsRead();
  return idbGet('db').then(function(idb){
    var pick = ls;
    if(idb && (!ls || (idb.updated || '') > (ls.updated || ''))) pick = idb;
    DB = normalize(pick);
    idbChecked = true;
    if(!idb || pick !== idb) flush();
  }).catch(function(){ DB = normalize(ls); idbChecked = true; });
}

/* --- автокөшірме: күніне бір рет, соңғы 7 күн --- */
function autoSnap(){
  if(!idbOK || !DB.tx.length) return;
  var day = todayISO();
  idbGet('snaps').then(function(list){
    list = list || [];
    if(list.some(function(x){ return x.day === day; })) return;
    return idbSet('snap:' + day, JSON.parse(JSON.stringify(DB))).then(function(){
      list.push({ day: day, count: DB.tx.length });
      list.sort(function(a, b){ return a.day < b.day ? -1 : 1; });
      while(list.length > 7) idbDel('snap:' + list.shift().day);
      return idbSet('snaps', list);
    });
  }).catch(function(){});
}

/* ================= КӨМЕКШІЛЕР ================= */
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/[<>&"']/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]; }); }
function newId(){ return Date.now().toString() + Math.floor(Math.random() * 900 + 100); }
function iso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function todayISO(){ return iso(new Date()); }
function parseISO(s){ var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2] || 1); }
function ym(d){ return iso(d).slice(0, 7); }
function fullDate(s){ if(!s) return '—'; var d = parseISO(s); return d.getDate() + ' ' + monName(d.getMonth()).toLowerCase() + ' ' + d.getFullYear(); }
function dayTitle(s){
  var d = parseISO(s), td = todayISO(), y = new Date(); y.setDate(y.getDate() - 1);
  if(s === td) return t('Бүгін');
  if(s === iso(y)) return t('Кеше');
  return d.getDate() + ' ' + monName(d.getMonth()).toLowerCase() + ', ' + t(WDAYS[d.getDay()]).toLowerCase();
}
function nf(n, dec){
  var a = Math.abs(n), s;
  if(dec && Math.round(a) !== a) s = a.toFixed(2); else s = Math.round(a).toString();
  var p = s.split('.');
  return p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009') + (p[1] ? ',' + p[1] : '');
}
function money(n, sym, dec){ return (n < 0 ? '−' : '') + nf(n, dec) + '\u00A0' + (sym || S()); }
function moneyShort(n, sym){
  var a = Math.abs(n), sg = n < 0 ? '−' : '', s = sym || S();
  function d(v){ return (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100).toString().replace('.', ','); }
  if(a >= 1e9) return sg + d(a / 1e9) + '\u00A0' + t('млрд') + '\u00A0' + s;
  if(a >= 1e6) return sg + d(a / 1e6) + '\u00A0' + t('млн') + '\u00A0' + s;
  return money(n, s);
}
function signed(n, type){ return (type === 'in' ? '+' : type === 'out' ? '−' : '') + nf(n) + '\u00A0' + S(); }
function num(v){ var x = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? x : 0; }
function val(id){ var e = $(id); return e ? num(e.value) : 0; }
function buzz(){ try{ navigator.vibrate && navigator.vibrate(8); }catch(e){} }

var toastTm = null;
function toast(msg, undo){
  var e = $('toast');
  e.innerHTML = '<span>' + esc(t(msg)) + '</span>' + (undo ? '<button id="t-undo">' + t('Қайтару') + '</button>' : '');
  e.classList.add('on');
  if(undo) $('t-undo').onclick = function(){ e.classList.remove('on'); undo(); };
  clearTimeout(toastTm); toastTm = setTimeout(function(){ e.classList.remove('on'); }, undo ? 4500 : 2000);
}
function ask(msg, fn, okLabel){
  var d = $('dlg');
  d.innerHTML = '<div class="dlg-box"><p>' + esc(t(msg)) + '</p><div class="btns"><button class="btn line" id="dlg-no">' + t('Болдырмау') + '</button><button class="btn" id="dlg-ok" style="background:var(--neg);color:#fff">' + t(okLabel || 'Иә') + '</button></div></div>';
  d.classList.remove('out'); d.style.display = 'grid'; d.offsetWidth; d.classList.add('on');
  var close = function(cb){ d.classList.add('out'); setTimeout(function(){ d.classList.remove('on', 'out'); d.style.display = ''; if(cb) cb(); }, 190); };
  $('dlg-no').onclick = function(){ close(); };
  $('dlg-ok').onclick = function(){ close(fn); };
}

/* ================= ВАЛЮТА ================= */
var CURS = {
  KZT:['₸','Теңге'], RUB:['₽','Рубль'], USD:['$','Доллар'], EUR:['€','Евро'], KGS:['сом','Сом'], UZS:['сўм','Сўм'],
  TRY:['₺','Лира'], GBP:['£','Фунт'], CNY:['¥','Юань'], AED:['AED','Дирхам'], INR:['₹','Рупия'], UAH:['₴','Гривна'],
  GEL:['₾','Лари'], AZN:['₼','Манат'], BYN:['Br','Бел. рубль'], TJS:['SM','Сомони'], KRW:['₩','Вона'], JPY:['¥','Иена']
};
function BASE(){ return (DB.pref && DB.pref.base && CURS[DB.pref.base]) ? DB.pref.base : 'KZT'; }
function symOf(code){ return (CURS[code] || [code])[0]; }
function S(){ return symOf(BASE()); }
function guessBase(lang){
  var loc = ((navigator.languages && navigator.languages[0]) || navigator.language || '').toUpperCase(), reg = (loc.split(/[-_]/)[1] || '');
  var m = { KZ:'KZT', RU:'RUB', KG:'KGS', UZ:'UZS', US:'USD', GB:'GBP', TR:'TRY', UA:'UAH', BY:'BYN', AZ:'AZN', GE:'GEL', IN:'INR', AE:'AED', CN:'CNY', TJ:'TJS', KR:'KRW', JP:'JPY',
            DE:'EUR', FR:'EUR', IT:'EUR', ES:'EUR', NL:'EUR', AT:'EUR', BE:'EUR', FI:'EUR', IE:'EUR', PT:'EUR', GR:'EUR', SK:'EUR', SI:'EUR', LT:'EUR', LV:'EUR', EE:'EUR' };
  if(m[reg]) return m[reg];
  return lang === 'kk' ? 'KZT' : lang === 'ru' ? 'KZT' : 'USD';
}
function fxRate(code){
  var b = BASE(); code = code || b;
  if(code === b) return 1;
  if(DB.fx && DB.fx.base === b && DB.fx.r && DB.fx.r[code] > 0) return DB.fx.r[code];
  if(code === 'USD' && b === 'KZT' && DB.rate && DB.rate.v > 0) return DB.rate.v;
  return 0;
}
function rateV(){ return fxRate('USD'); }
function curSym(a){ return symOf((a && a.cur) || BASE()); }
function foreign(a){ return !!(a && a.cur && a.cur !== BASE()); }
function toAcc(a, v){ var r = foreign(a) ? fxRate(a.cur) : 1; return r > 0 ? v / r : v; }
function toBase(a){ if(!a) return 0; var r = foreign(a) ? fxRate(a.cur) : 1; return r > 0 ? a.bal * r : a.bal; }
var toKZT = toBase;
function fxLine(code){ var r = fxRate(code); return r ? '1 ' + symOf(code) + ' = ' + nf(r, r < 100) + ' ' + S() : '—'; }
var RATE_URLS = ['https://open.er-api.com/v6/latest/USD', 'https://api.exchangerate-api.com/v4/latest/USD'];
var rateBusy = false;
function fetchRate(manual){
  if(rateBusy) return; rateBusy = true;
  var i = 0;
  (function next(){
    if(i >= RATE_URLS.length){ rateBusy = false; if(manual) toast('Курс алынбады — интернетті тексеріңіз'); return; }
    fetch(RATE_URLS[i++]).then(function(r){ return r.json(); }).then(function(d){
      var rs = d && d.rates, b = BASE(); if(!rs || !rs[b]) throw 0;
      var map = {}; for(var c in CURS) if(rs[c]) map[c] = rs[b] / rs[c];
      var keepManual = DB.fx && DB.fx.src === 'manual' && DB.fx.base === b ? DB.fx.r : null;
      if(keepManual && !manual) for(var k in keepManual) map[k] = keepManual[k];
      DB.fx = { base: b, at: new Date().toISOString(), src: keepManual && !manual ? 'manual' : 'auto', r: map };
      if(rs.KZT) DB.rate = { v: rs.KZT, at: DB.fx.at, src: 'auto' };
      save(); rateBusy = false; render(); if(manual) toast('Курс жаңартылды');
    }).catch(next);
  })();
}

/* ================= БЕЛГІШЕЛЕР ================= */
var IC = {
  home:'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  wallet:'<path d="M3 7a2 2 0 0 1 2-2h12v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.1"/>',
  pie:'<path d="M12 3v9l7.6 4.6"/><circle cx="12" cy="12" r="9"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  in:'<path d="M17 7 7 17M7 9v8h8"/>',
  out:'<path d="M7 17 17 7M9 7h8v8"/>',
  swap:'<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  upload:'<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  download:'<path d="M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  people:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3 2.2 3.5 5"/>',
  calc:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h3.5"/>',
  repeat:'<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  right:'<path d="m9 6 6 6-6 6"/>', left:'<path d="m15 6-6 6 6 6"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit:'<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/>',
  moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  dollar:'<circle cx="12" cy="12" r="9"/><path d="M15 9.2c-.5-1-1.6-1.7-3-1.7-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.5-.7-3-1.7M12 6v1.5M12 16.5V18"/>',
  lock:'<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  cal:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  card:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',
  bank:'<path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  check:'<path d="m5 12.5 4.5 4.5L19 7"/>',
  food:'<path d="M7 3v8a2 2 0 0 0 2 2v8M7 3v5M11 3v5a2 2 0 0 1-2 2M17 21V3c-2 1.5-3 4-3 7v4h3"/>',
  fun:'<rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M7.5 11v3M6 12.5h3M15 12h.01M17.5 13.5h.01"/>',
  phone:'<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18h2"/>',
  family:'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M12 17.5s-3.5-2-3.5-4.2A1.8 1.8 0 0 1 12 12.4a1.8 1.8 0 0 1 3.5.9c0 2.2-3.5 4.2-3.5 4.2z"/>',
  car:'<path d="M5 17h14M6 17v2M18 17v2M4 13l1.6-5.2A2 2 0 0 1 7.5 6.4h9a2 2 0 0 1 1.9 1.4L20 13v4H4z"/><path d="M7.5 13.5h.01M16.5 13.5h.01"/>',
  shirt:'<path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
  building:'<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10.5 21v-3h3v3"/>',
  health:'<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M12 10.5v4M10 12.5h4"/>',
  book:'<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v14H5.5A1.5 1.5 0 0 0 4 18.5zM4 18.5A1.5 1.5 0 0 0 5.5 20H20"/>',
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8S10.5 3 8 4s0 4 4 4zM12 8s1.5-5 4-4 0 4-4 4z"/>',
  invest:'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  other:'<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  salary:'<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M3 12.5h18"/>',
  biz:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  laptop:'<rect x="4" y="4" width="16" height="11" rx="2"/><path d="M2 19h20"/>',
  coin:'<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  percent:'<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  split:'<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4M12 12H3"/>',
  receipt:'<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>'
};
function ic(n, cls){ return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24">' + (IC[n] || IC.other) + '</svg>'; }

/* ================= САНАТТАР ================= */
var CATS = {
  out: ['Тамақ','Ойын-сауық','Байланыс','Әке-шешеме','Көлік','Киім','Тұрғын үй','Денсаулық','Білім','Сыйлық','Инвестиция','Несие төлемі','Аударымдар','Басқа'],
  in:  ['Жалақы','Бизнес','Фриланс','Инвестиция','Кэшбэк','Несие алу','Сыйлық','Басқа']
};
var CAT_META = {
  'Тамақ':['food','#E07A2F'], 'Ойын-сауық':['fun','#8B5CF6'], 'Байланыс':['phone','#2F7DE1'], 'Әке-шешеме':['family','#D9467A'],
  'Көлік':['car','#0E9F9C'], 'Киім':['shirt','#C2562B'], 'Тұрғын үй':['building','#5B6B82'], 'Денсаулық':['health','#E2474C'],
  'Білім':['book','#3E6FE0'], 'Сыйлық':['gift','#D23C8F'], 'Инвестиция':['invest','#169A55'], 'Несие төлемі':['card','#B9750F'],
  'Аударымдар':['swap','#6E7380'], 'Аударым':['swap','#6E7380'], 'Басқа':['other','#7C776E'],
  'Жалақы':['salary','#169A55'], 'Бизнес':['biz','#0A8FB0'], 'Фриланс':['laptop','#7B47E0'], 'Кэшбэк':['coin','#C08A06'], 'Несие алу':['card','#B9750F']
};
function catMeta(c){ return CAT_META[c] || ['other', '#7C776E']; }
function catIc(c, size){
  var m = catMeta(c);
  return '<span class="ci" style="background:' + m[1] + '1F;color:' + m[1] + '">' + ic(m[0]) + '</span>';
}

/* ================= БАНКТЕР ================= */
var BANKS = [
  ['Kaspi Bank', /kaspi|каспи|каспий/i, 'K', '#F14635', '#fff', 'banks/kaspi.png'],
  ['Halyk Bank', /halyk|халык|халық|народный/i, 'H', '#00815F', '#F1A400', 'banks/halyk.png'],
  ['Freedom SuperApp', /freedom|фридом|ffin/i, 'F', '#02B140', '#fff', 'banks/freedom.png'],
  ['Jusan Bank', /jusan|жусан/i, 'J', '#FF5A00', '#fff', 'banks/jusan.png'],
  ['ForteBank', /forte|форте/i, 'Fo', '#00B4C5', '#fff', 'banks/forte.png'],
  ['Bereke Bank', /bereke|береке/i, 'B', '#023DFF', '#fff', 'banks/bereke.png'],
  ['Bank CenterCredit', /centercredit|центркредит|\bbcc\b|бцк/i, 'BCC', '#00AB75', '#fff', 'banks/bcc.png'],
  ['Otbasy Bank', /otbasy|отбасы|жилстрой/i, 'O', '#00A3A3', '#fff', 'banks/otbasy.png'],
  ['Home Credit Bank', /home ?credit|хоум ?кредит/i, 'HC', '#E31E3A', '#fff', 'banks/homecredit.png'],
  ['Qazaq Bank', /qazaq|назарбанк/i, 'Q', '#2F6FB8', '#fff', 'banks/qazaq.png'],
  ['Қолма-қол', /^қолма-қол|^наличн|^cash/i, '●', '#141412', '#D2F45C', null]
];
function bankOf(name){
  if(!name) return null;
  for(var i = 0; i < BANKS.length; i++) if(BANKS[i][1].test(name)) return BANKS[i];
  return null;
}
function accBadge(a){
  var b = bankOf(a && a.name);
  if(b && b[5]) return '<span class="bank" style="background:#fff;box-shadow:inset 0 0 0 1px var(--line)"><img src="' + b[5] + '" alt="" loading="lazy" onerror="this.remove()"></span>';
  if(b) return '<span class="bank" style="background:' + b[3] + ';color:' + b[4] + '">' + b[2] + '</span>';
  if(a && a.kind === 'debt') return '<span class="ci" style="background:#B9750F1F;color:#B9750F">' + ic('card') + '</span>';
  return '<span class="ci" style="background:var(--sf2)">' + ic(a && a.icon && IC[a.icon] ? a.icon : 'wallet') + '</span>';
}

/* ================= ЕСЕПТЕУЛЕР ================= */
function acc(id){ for(var i = 0; i < DB.accounts.length; i++) if(DB.accounts[i].id === id) return DB.accounts[i]; return null; }
function accsOf(kind){ return DB.accounts.filter(function(a){ return a.kind === kind; }); }
function assets(){ return accsOf('asset'); }
function debtLeft(d){ return Math.max(0, (d.amt || 0) - (d.paid || 0)); }
function debtTotals(){
  var r = { lent: 0, owed: 0, late: 0 }, td = todayISO();
  DB.debts.forEach(function(d){
    var l = debtLeft(d); if(l <= 0) return;
    if(d.dir === 'out') r.lent += l; else r.owed += l;
    if(d.due && d.due < td) r.late++;
  });
  return r;
}
function totals(){
  var b = 0, d = 0, g = 0;
  DB.accounts.forEach(function(x){ if(x.kind === 'debt') d += toKZT(x); else if(x.kind !== 'broker') b += toKZT(x); });
  DB.goals.forEach(function(x){ g += x.saved || 0; });
  var dt = debtTotals();
  return { banks: b, loans: d, goals: g, lent: dt.lent, owed: dt.owed, net: b - d + dt.lent - dt.owed };
}
function monthSum(key){
  var r = { in: 0, out: 0, n: 0 };
  DB.tx.forEach(function(x){
    if(x.date && x.date.slice(0, 7) === key && x.type !== 'tr'){ r[x.type] += x.amt; r.n++; }
  });
  return r;
}
function applyTx(x, sign){
  var a = acc(x.acc);
  if(x.type === 'tr'){
    var to = acc(x.to);
    if(a) a.bal -= sign * toAcc(a, x.amt);
    if(to) to.bal += sign * toAcc(to, x.amt);
    return;
  }
  if(a) a.bal += sign * toAcc(a, x.type === 'in' ? x.amt : -x.amt);
  if(x.loan){ var l = acc(x.loan); if(l) l.bal -= sign * x.amt; }
}
function txOf(id){ for(var i = 0; i < DB.tx.length; i++) if(DB.tx[i].id === id) return DB.tx[i]; return null; }
function sortTx(list){ return list.sort(function(a, b){ return a.date === b.date ? (b.id > a.id ? 1 : -1) : (a.date < b.date ? 1 : -1); }); }

/* ================= НАВИГАЦИЯ ================= */
var TABS = ['home', 'accounts', 'stats', 'more'];
var page = 'home', sub = '';
function go(p, s, replace){
  page = p; sub = s || '';
  var h = '#' + p + (sub ? '/' + sub : '');
  if(location.hash !== h){ if(replace || TABS.indexOf(p) >= 0) history.replaceState({}, '', h); else history.pushState({}, '', h); }
  show();
}
function show(){
  document.querySelectorAll('.page').forEach(function(e){ e.classList.remove('on'); });
  var el = $('p-' + page); if(!el){ page = 'home'; el = $('p-home'); }
  el.classList.add('on');
  drawDock();
  renderPage(page);
  window.scrollTo(0, 0);
  try{ localStorage.setItem('qarzhy2_view', page + (sub ? '/' + sub : '')); }catch(e){}
}
function readHash(){
  var h = location.hash.replace(/^#\/?/, '').split('/');
  page = $('p-' + h[0]) ? h[0] : 'home'; sub = h.slice(1).join('/');
}
function back(){ if(history.length > 1 && TABS.indexOf(page) < 0) history.back(); else go('home'); }
window.addEventListener('popstate', function(){
  if(fanOn){ fanOn = false; $('fan').classList.remove('on'); var a = document.querySelector('.dock .add'); if(a) a.classList.remove('open'); return; }
  if(sheetOn){ closeSheet(true); return; }
  readHash(); show();
});
function drawDock(){
  var items = [['home', 'home', 'Басты'], ['accounts', 'wallet', 'Шоттар'], null, ['stats', 'pie', 'Нәтиже'], ['more', 'user', 'Профиль']];
  var tab = TABS.indexOf(page) >= 0 ? page : (page === 'ops' ? 'home' : '');
  var changed = tab !== lastTab;
  $('dock').innerHTML = '<i class="pill"></i>' + items.map(function(x){
    if(!x) return '<button class="add' + (fanOn ? ' open' : '') + '" onclick="toggleFan()" aria-label="' + t('Қосу') + '">' + ic('plus') + '</button>';
    return '<button data-tab="' + x[0] + '" class="' + (tab === x[0] ? 'on' + (changed ? ' pop' : '') : '') + '" onclick="go(\'' + x[0] + '\')" aria-label="' + t(x[2]) + '">' + ic(x[1]) + '</button>';
  }).join('');
  movePill(tab);
  lastTab = tab;
}
var lastTab = null, pillX = null, fanOn = false;
var FAN = [['out', 'out', 'Шығын'], ['in', 'in', 'Кіріс'], ['tr', 'swap', 'Аударым'], ['import', 'upload', 'Жүктеу']];
function toggleFan(force){
  var on = force === undefined ? !fanOn : force;
  if(on === fanOn) return;
  fanOn = on;
  var f = $('fan'), add = document.querySelector('.dock .add');
  if(add) add.classList.toggle('open', on);
  if(on){
    f.innerHTML = '<div class="fan-veil" onclick="toggleFan(false)"></div>' + FAN.map(function(x, i){
      var a = (-150 + i * 40) * Math.PI / 180;
      return '<button class="fan-b" style="--i:' + i + ';--x:' + (Math.cos(a) * 118).toFixed(1) + 'px;--y:' + (Math.sin(a) * 118).toFixed(1) + 'px" onclick="fanGo(\'' + x[0] + '\')"><span class="fan-ic">' + ic(x[1]) + '</span><span class="fan-t">' + t(x[2]) + '</span></button>';
    }).join('');
    f.classList.add('on'); buzz();
    history.pushState({ fan: 1 }, '', location.hash);
  } else {
    f.classList.remove('on');
    if(history.state && history.state.fan) history.back();
  }
}
function fanGo(k){
  toggleFan(false);
  setTimeout(function(){ if(k === 'import') go('import'); else openTx(k); }, 160);
}
function movePill(tab){
  var dock = $('dock'), pill = dock.querySelector('.pill'), b = dock.querySelector('[data-tab="' + tab + '"]');
  if(!b){ pill.style.opacity = 0; if(pillX !== null) pill.style.left = pillX + 'px'; return; }
  var x = b.offsetLeft + b.offsetWidth / 2 - 26;
  pill.style.transition = 'none';
  pill.style.left = (pillX === null ? x : pillX) + 'px';
  pill.offsetWidth;
  pill.style.transition = '';
  pill.style.left = x + 'px';
  pillX = x;
}
window.addEventListener('resize', function(){ pillX = null; movePill(lastTab); });
function topBar(title, subTitle, right){
  return '<div class="top"><button class="ibtn" onclick="back()" aria-label="' + t('Артқа') + '">' + ic('left') + '</button><h1>' + title +
    (subTitle ? '<span class="sub">' + subTitle + '</span>' : '') + '</h1>' + (right || '') + '</div>';
}
function tabBar(title, subTitle, right){
  return '<div class="top"><h1>' + title + (subTitle ? '<span class="sub">' + subTitle + '</span>' : '') + '</h1>' + (right || '') + '</div>';
}

/* ================= ПАРАҚ (SHEET) ================= */
var sheetOn = false, sheetPushed = false;
function openSheet(html){
  $('sheet').classList.toggle('still', sheetOn);
  $('sheet-body').innerHTML = html;
  requestAnimationFrame(function(){ enhanceSegs($('sheet-body'), 'sheet'); });
  $('sheet').scrollTop = 0;
  $('sheet').classList.add('on'); $('veil').classList.add('on');
  if(!sheetOn){ history.pushState({ sheet: 1 }, '', location.hash); sheetPushed = true; }
  sheetOn = true;
}
function closeSheet(fromPop){
  if(!sheetOn) return;
  sheetOn = false;
  $('sheet').classList.remove('on'); $('veil').classList.remove('on');
  if(!fromPop && sheetPushed){ sheetPushed = false; history.back(); }
  sheetPushed = false;
}
function sheetHead(title){ return '<h3>' + title + '<button class="x" onclick="closeSheet()" aria-label="' + t('Жабу') + '">' + ic('x') + '</button></h3>'; }
function done(msg){ save(); closeSheet(); render(); if(msg) toast(msg); buzz(); }

/* ================= RENDER ================= */
function render(){ renderPage(page); }
var segPos = {};
function enhanceSegs(root, scope){
  (root || document).querySelectorAll('.seg, .week').forEach(function(sg, i){
    var on = sg.querySelector('button.on'); if(!on) return;
    var th = sg.querySelector('.thumb'); if(!th){ th = document.createElement('i'); th.className = 'thumb'; sg.insertBefore(th, sg.firstChild); }
    sg.classList.add('has-thumb');
    var key = (scope || page) + ':' + i + ':' + sg.children.length, to = { l: on.offsetLeft, w: on.offsetWidth }, from = segPos[key] || to;
    th.style.transition = 'none'; th.style.left = from.l + 'px'; th.style.width = from.w + 'px';
    th.offsetWidth; th.style.transition = '';
    th.style.left = to.l + 'px'; th.style.width = to.w + 'px';
    segPos[key] = to;
    sg.querySelectorAll('button').forEach(function(b){
      if(b._seg) return; b._seg = 1;
      b.addEventListener('click', function(){
        if(!sg.isConnected) return;
        var o = { l: b.offsetLeft, w: b.offsetWidth };
        th.style.left = o.l + 'px'; th.style.width = o.w + 'px'; segPos[key] = o;
      });
    });
  });
}
function renderPage(p){
  var f = PAGES[p]; if(f) $('p-' + p).innerHTML = f();
  if(p === 'ops') bindSwipes();
  if(p === 'home') animateHero();
  enhanceSegs($('p-' + p), p);
}
var PAGES = {};

/* ---------- БАСТЫ ---------- */
PAGES.home = function(){
  var T = totals(), now = new Date(), M = monthSum(ym(now));
  var dt = debtTotals(), rc = recurState();
  var gSaved = 0, gTarget = 0; DB.goals.forEach(function(g){ gSaved += g.saved || 0; gTarget += g.target || 0; });
  var h = '<div class="top"><div class="mark">qarzhy<i></i></div>' +
    '<button class="ibtn" onclick="go(\'ops\')" aria-label="' + t('Іздеу') + '">' + ic('search') + '</button></div>';
  h += '<div class="hero"><div class="lab">' + t('Таза капитал') + '<span class="pill" style="margin-left:auto">' + monName(now.getMonth()) + '</span></div>' +
    '<div class="big num" id="hero-net" data-v="' + Math.round(T.net) + '">' + heroNum(T.net) + '</div>' +
    '<div class="hrow">' +
      '<button class="cell" onclick="statsKind=\'in\';go(\'stats\')"><span><i class="dot" style="background:var(--pos)"></i>' + t('Кіріс') + '</span><b class="num">' + moneyShort(M.in) + '</b></button>' +
      '<button class="cell" onclick="statsKind=\'out\';go(\'stats\')"><span><i class="dot" style="background:var(--neg)"></i>' + t('Шығын') + '</span><b class="num">' + moneyShort(M.out) + '</b></button>' +
    '</div></div>';
  if(isFresh()) return h + welcomeCard();
  /* ескерту */
  var warn = '';
  if(rc.due.length) warn += alertRow('bell', t('Төлем жақындады') + ': ' + rc.due.map(function(r){ return esc(r.name); }).join(', '), "go('recur')");
  if(dt.late) warn += alertRow('people', t('Мерзімі өткен қарыз') + ': ' + dt.late, "go('debts')");
  var lim = DB.pref.monthLimit;
  if(lim > 0){
    var dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), left = dim - now.getDate() + 1;
    var canDay = Math.max(0, (lim - M.out) / left);
    warn += '<div class="card" style="display:flex;align-items:center;gap:12px"><span class="ci" style="width:40px;height:40px;border-radius:14px;display:grid;place-items:center;background:var(--sf2)">' + ic('cal') + '</span>' +
      '<div style="flex:1"><span class="muted" style="font-size:12.5px">' + t('Бүгін жұмсауға болады') + '</span><b class="num" style="display:block;font-size:18px;letter-spacing:-.02em">' + money(canDay) + '</b>' +
      '<div class="prog"><i style="width:' + Math.min(100, M.out / lim * 100).toFixed(1) + '%;' + (M.out > lim ? 'background:var(--neg)' : '') + '"></i></div></div></div>';
  }
  h += warn;
  h += '<div class="grid2">' +
    tile('target', t('Мақсаттар'), DB.goals.length ? moneyShort(gSaved) + (gTarget ? ' · ' + Math.round(gSaved / gTarget * 100) + '%' : '') : t('Әлі жоқ'), "go('goals')") +
    tile('people', t('Қарыздар'), (dt.lent || dt.owed) ? '↗ ' + moneyShort(dt.lent) + '  ↙ ' + moneyShort(dt.owed) : t('Қарыз жоқ'), "go('debts')") +
    tile('repeat', t('Тұрақты төлемдер'), DB.recur.length ? (rc.unpaid > 0 ? t('Қалды') + ' ' + moneyShort(rc.unpaid) : t('Барлығы төленді')) : t('Әлі жоқ'), "go('recur')") +
    tile('calc', t('Есептегіш'), t('Несие · Депозит · Салық'), "go('calc')") +
  '</div>';
  var recent = sortTx(DB.tx.slice()).slice(0, 6);
  h += '<div class="sec">' + t('Соңғы операциялар') + (DB.tx.length ? '<button class="more" onclick="go(\'ops\')">' + t('Барлығы') + ic('right') + '</button>' : '') + '</div>';
  h += recent.length ? '<div class="list">' + recent.map(txRow).join('') + '</div>'
    : '<div class="card empty">' + ic('receipt') + t('Әзірге операция жоқ.') + '<br>' + t('Ортадағы + түймесімен бірінші шығынды қосыңыз.') + '</div>';
  return h;
};
function isFresh(){
  return !DB.tx.length && !DB.goals.length && !DB.debts.length && DB.accounts.length <= 1 && !(DB.accounts[0] && DB.accounts[0].bal);
}
function welcomeCard(){
  var steps = [['bank', 'Банк шотын қосыңыз', 'Kaspi, Halyk, Freedom… қазіргі қалдығымен', "openAcc('asset')"],
               ['upload', 'Немесе үзінді жүктеңіз', 'Банк PDF/Excel үзіндісінен операциялар өзі түседі', "go('import')"],
               ['out', 'Бірінші шығынды жазыңыз', 'Ортадағы + түймесі — 3 секунд', "openTx('out')"]];
  return '<div class="card" style="padding:20px"><b style="font-size:20px;letter-spacing:-.02em;display:block">' + t('Qarzhy-ге қош келдіңіз') + '</b>' +
    '<p class="muted" style="margin:6px 0 4px;font-size:14px">' + t('Ақшаңыз қайда кететінін көріңіз. Деректер тек осы телефонда сақталады — тіркелу де, сервер де жоқ.') + '</p></div>' +
    '<div class="list" style="margin-top:12px">' + steps.map(function(x, i){
      return '<button class="row" onclick="' + x[3] + '"><span class="ci" style="background:' + (i === 0 ? 'var(--lime);color:#141412' : 'var(--sf2)') + '">' + ic(x[0]) + '</span><span class="mid"><b>' + t(x[1]) + '</b><span>' + t(x[2]) + '</span></span>' + ic('right') + '</button>';
    }).join('') + '</div>' +
    '<div class="chips" style="margin-top:14px;justify-content:center">' + [['kk', 'Қазақша'], ['ru', 'Русский'], ['en', 'English']].map(function(x){
      return '<button class="chip ' + (LANG === x[0] ? 'on' : '') + '" onclick="setLang(\'' + x[0] + '\')">' + x[1] + '</button>'; }).join('') + '</div>' +
    '<label class="f" style="max-width:260px;margin:14px auto 0"><span style="text-align:center">' + t('Негізгі валюта') + '</span><select class="in" style="background-color:var(--sf)" onchange="setBase(this.value,this)">' + curOptions(BASE()) + '</select></label>';
}
function heroNum(v){ return (v < 0 ? '−' : '') + nf(v) + '<small>' + S() + '</small>'; }
function animateHero(){
  var e = $('hero-net'); if(!e) return;
  var target = +e.dataset.v, from = +(e.dataset.from || window._heroLast || 0);
  if(from === target || matchMedia('(prefers-reduced-motion:reduce)').matches){ window._heroLast = target; return; }
  var t0 = performance.now(), dur = 650;
  (function step(now){
    var k = Math.min(1, (now - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
    e.innerHTML = heroNum(from + (target - from) * ease);
    if(k < 1) requestAnimationFrame(step); else window._heroLast = target;
  })(t0);
}
function tile(icn, title, subt, act){
  return '<button class="tile" onclick="' + act + '"><span class="ti">' + ic(icn) + '</span><div><b>' + title + '</b><span class="num">' + subt + '</span></div></button>';
}
function alertRow(icn, text, act){
  return '<button class="card" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left" onclick="' + act + '">' +
    '<span style="width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:var(--lime);color:#141412;flex:none">' + ic(icn) + '</span>' +
    '<span style="flex:1;font-size:14px;font-weight:550">' + text + '</span>' + ic('right') + '</button>';
}
function txRow(x){
  var a = acc(x.acc), title, subt, cls = '', amt;
  if(x.type === 'tr'){
    var to = acc(x.to);
    title = t('Аударым'); subt = (a ? esc(a.name) : '—') + ' → ' + (to ? esc(to.name) : '—');
    amt = nf(x.amt) + '\u00A0' + S();
  } else {
    title = x.note ? esc(x.note) : esc(t(x.cat));
    subt = (x.note ? esc(t(x.cat)) + ' · ' : '') + (a ? esc(a.name) : t('Шотсыз'));
    cls = x.type === 'in' ? 'pos' : ''; amt = signed(x.amt, x.type);
  }
  return '<button class="row' + (x.id === flashId ? ' flash' : '') + '" data-id="' + x.id + '" onclick="viewTx(\'' + x.id + '\')">' + catIc(x.type === 'tr' ? 'Аударым' : x.cat) +
    '<span class="mid"><b>' + title + '</b><span>' + subt + '</span></span><span class="amt num ' + cls + '">' + amt + '</span></button>';
}

/* ---------- ШОТТАР ---------- */
PAGES.accounts = function(){
  var T = totals();
  var h = tabBar(t('Менің қаржым'), t('Таза капитал') + ' · <b class="num" style="color:var(--ink)">' + money(T.net) + '</b>');
  if(T.lent || T.owed) h += '<div class="grid2" style="margin-top:4px">' + (T.lent ? miniStat(t('Маған қарыз'), T.lent) : '') + (T.owed ? miniStat(t('Менің қарызым'), -T.owed) : '') + '</div>';
  var bs = assets();
  h += '<div class="sec">' + t('Банк шоттары') + '<button class="more" onclick="openAcc(\'asset\')">' + ic('plus') + t('Қосу') + '</button></div>';
  h += bs.length ? '<div class="list">' + bs.map(accRow).join('') + '</div>' : '<div class="card empty">' + t('Банк шоты жоқ.') + '</div>';
  var ls = accsOf('debt');
  h += '<div class="sec">' + t('Несиелер') + '<button class="more" onclick="openAcc(\'debt\')">' + ic('plus') + t('Қосу') + '</button></div>';
  h += ls.length ? '<div class="list">' + ls.map(accRow).join('') + '</div>' : '<div class="card empty">' + t('Несие жоқ — тамаша.') + '</div>';
  return h;
};
function activeDebts(){ return DB.debts.filter(function(d){ return debtLeft(d) > 0; }).length; }
function miniStat(label, v){
  return '<div class="tile" style="min-height:0;gap:2px;box-shadow:var(--sh)"><span>' + label + '</span><b class="num" style="font-size:17px;letter-spacing:-.02em;' + (v < 0 ? 'color:var(--neg)' : '') + '">' + moneyShort(v) + '</b></div>';
}
function accRow(a){
  var sym = curSym(a), extra = '';
  if(foreign(a) && fxRate(a.cur)) extra = '<small>≈ ' + moneyShort(toBase(a)) + '</small>';
  if(a.kind === 'debt' && a.pay) extra = '<small>' + t('айына') + ' ' + moneyShort(a.pay) + '</small>';
  return '<button class="row" onclick="viewAcc(\'' + a.id + '\')">' + accBadge(a) +
    '<span class="mid"><b>' + esc(a.name) + '</b><span>' + (a.kind === 'debt' ? (a.rate ? a.rate + '% · ' : '') + t('Несие') : (a.cur || BASE())) + '</span></span>' +
    '<span class="amt num ' + (a.kind === 'debt' ? 'neg' : '') + '">' + money(a.kind === 'debt' ? -a.bal : a.bal, sym, foreign(a)) + extra + '</span></button>';
}
function linkRow(icn, title, subt, act){
  return '<button class="row" onclick="' + act + '"><span class="ci" style="background:var(--sf2)">' + ic(icn) + '</span><span class="mid"><b>' + title + '</b><span class="num">' + subt + '</span></span>' + ic('right') + '</button>';
}

/* ---------- ОПЕРАЦИЯЛАР ---------- */
var opsF = { type: 'all', acc: '', q: '', cat: '', mon: '' };
PAGES.ops = function(){
  var h = topBar(t('Операциялар'), DB.tx.length + ' ' + t('жазба'),
    '<button class="ibtn" onclick="exportOpsXlsx()" aria-label="Excel">' + ic('download') + '</button>');
  h += '<label class="search">' + ic('search') + '<input id="ops-q" type="search" placeholder="' + t('Іздеу: атау, санат, сома') + '" value="' + esc(opsF.q) + '" oninput="opsF.q=this.value;drawOpsList()"></label>';
  h += '<div class="chips">' + [['all', 'Барлығы'], ['out', 'Шығын'], ['in', 'Кіріс'], ['tr', 'Аударым']].map(function(x){
    return '<button class="chip ' + (opsF.type === x[0] ? 'on' : '') + '" onclick="opsF.type=\'' + x[0] + '\';render()">' + t(x[1]) + '</button>';
  }).join('') +
  '<select class="chip" style="border:0;padding-right:14px" onchange="opsF.acc=this.value;drawOpsList()"><option value="">' + t('Барлық шот') + '</option>' +
    DB.accounts.map(function(a){ return '<option value="' + a.id + '"' + (opsF.acc === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></div>';
  if(opsF.cat || opsF.mon){
    h += '<div class="chips" style="margin-top:8px"><button class="chip on" onclick="opsF.cat=\'\';opsF.mon=\'\';render()">' +
      esc(t(opsF.cat || '')) + (opsF.mon ? ' · ' + monName(+opsF.mon.slice(5) - 1) : '') + ' ' + ic('x') + '</button></div>';
  }
  h += '<div id="ops-list"></div>';
  setTimeout(drawOpsList, 0);
  return h;
};
function opsFiltered(){
  var q = opsF.q.trim().toLowerCase();
  return sortTx(DB.tx.filter(function(x){
    if(opsF.type !== 'all' && x.type !== opsF.type) return false;
    if(opsF.acc && x.acc !== opsF.acc && x.to !== opsF.acc && x.loan !== opsF.acc) return false;
    if(opsF.cat && x.cat !== opsF.cat) return false;
    if(opsF.mon && (x.date || '').slice(0, 7) !== opsF.mon) return false;
    if(q){
      var a = acc(x.acc), s = [x.note, x.cat, t(x.cat), a && a.name, String(Math.round(x.amt)), x.date].join(' ').toLowerCase();
      if(s.indexOf(q) < 0) return false;
    }
    return true;
  }));
}
var opsLimit = 150;
function drawOpsList(){
  var box = $('ops-list'); if(!box) return;
  var list = opsFiltered();
  if(!list.length){ box.innerHTML = '<div class="card empty">' + ic('search') + t('Операция табылмады.') + '</div>'; return; }
  var groups = {}, order = [];
  list.slice(0, opsLimit).forEach(function(x){ if(!groups[x.date]){ groups[x.date] = []; order.push(x.date); } groups[x.date].push(x); });
  var h = '';
  order.forEach(function(d){
    var sum = 0; groups[d].forEach(function(x){ if(x.type === 'in') sum += x.amt; else if(x.type === 'out') sum -= x.amt; });
    h += '<div class="day"><span>' + dayTitle(d) + '</span><span class="num">' + (sum ? (sum > 0 ? '+' : '−') + nf(sum) + ' ' + S() : '') + '</span></div><div class="list">' +
      groups[d].map(function(x){ return '<div class="swipe"><div class="under"><span class="l">' + t('Түзету') + '</span><span class="r">' + t('Өшіру') + '</span></div>' + txRow(x) + '</div>'; }).join('') + '</div>';
  });
  if(list.length > opsLimit) h += '<button class="btn line" onclick="opsLimit+=200;drawOpsList()">' + t('Тағы көрсету') + ' (' + (list.length - opsLimit) + ')</button>';
  box.innerHTML = h;
  bindSwipes();
}
function bindSwipes(){
  document.querySelectorAll('#ops-list .swipe').forEach(function(w){
    var r = w.querySelector('.row'); if(r._b) return; r._b = 1;
    var x0 = 0, y0 = 0, dx = 0, on = false, lock = false;
    r.addEventListener('touchstart', function(e){ x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; on = true; lock = false; r.style.transition = 'none'; }, { passive: true });
    r.addEventListener('touchmove', function(e){
      if(!on) return;
      var mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if(!lock){ if(Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)){ on = false; return; } if(Math.abs(mx) > 10) lock = true; }
      if(lock){ dx = mx; r.style.transform = 'translateX(' + dx + 'px)'; w.className = 'swipe ' + (dx < 0 ? 'del' : 'ed'); }
    }, { passive: true });
    r.addEventListener('touchend', function(){
      r.style.transition = ''; on = false;
      var id = r.dataset.id;
      if(dx < -90){ r.style.transform = 'translateX(-110%)'; setTimeout(function(){ delTx(id, true); }, 180); }
      else { r.style.transform = ''; if(dx > 90) setTimeout(function(){ openTx(null, id); }, 120); }
      if(lock){ r._skip = true; setTimeout(function(){ r._skip = false; }, 300); }
      dx = 0;
    });
    r.addEventListener('click', function(e){ if(r._skip){ e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  });
}

/* ---------- ОПЕРАЦИЯ ҚОСУ / ТҮЗЕТУ ---------- */
var F = null;
function openTx(type, editId){
  if(!assets().length){ toast('Алдымен шот қосыңыз'); openAcc('asset'); return; }
  var x = editId ? txOf(editId) : null;
  var lastAcc = acc(DB.pref.acc) ? DB.pref.acc : assets()[0].id;
  F = x ? { id: x.id, type: x.type, cat: x.cat, acc: x.acc || lastAcc, to: x.to, loan: x.loan || null, amt: x.amt, date: x.date, note: x.note || '' }
        : { id: null, type: type || 'out', cat: null, acc: lastAcc, to: null, loan: null, amt: '', date: todayISO(), note: '' };
  if(!F.cat && F.type !== 'tr') F.cat = DB.pref['cat_' + F.type] || CATS[F.type][0];
  if(F.type === 'tr' && !F.to){ var o = assets().filter(function(a){ return a.id !== F.acc; })[0]; F.to = o ? o.id : null; }
  drawTxSheet();
  if(!x) setTimeout(function(){ var e = $('f-amt'); if(e) e.focus(); }, 320);
}
function drawTxSheet(){
  var types = [['out', 'Шығын'], ['in', 'Кіріс'], ['tr', 'Аударым']];
  var h = sheetHead(F.id ? t('Өзгерту') : t('Жаңа операция'));
  h += '<div class="seg">' + types.map(function(x){ return '<button class="' + (F.type === x[0] ? 'on' : '') + '" onclick="txType(\'' + x[0] + '\')">' + t(x[1]) + '</button>'; }).join('') + '</div>';
  h += '<div class="amtbox"><input id="f-amt" inputmode="decimal" placeholder="0" value="' + (F.amt || '') + '" oninput="F.amt=this.value;fitAmt(this)" style="width:' + amtW(F.amt) + '"><span>' + S() + '</span></div>';
  if(F.type !== 'tr'){
    var list = CATS[F.type].slice();
    if(F.cat && list.indexOf(F.cat) < 0) list.push(F.cat);
    h += '<div class="cats">' + list.map(function(c){
      return '<button class="cat ' + (F.cat === c ? 'on' : '') + '" onclick="txCat(this,\'' + esc(c) + '\')">' + catIc(c) + '<span>' + esc(t(c)) + '</span></button>';
    }).join('') + '</div>';
  }
  h += '<div class="f"><span>' + (F.type === 'tr' ? t('Қай шоттан') : t('Шот')) + '</span><div class="chips">' + accChips('acc') + '</div></div>';
  if(F.type === 'tr') h += '<div class="f"><span>' + t('Қай шотқа') + '</span><div class="chips">' + accChips('to') + '</div></div>';
  if(F.type === 'out' && F.cat === 'Несие төлемі' && accsOf('debt').length){
    h += '<label class="f"><span>' + t('Қай несие өтеледі') + '</span><select class="in" onchange="F.loan=this.value||null"><option value="">' + t('Белгілемеу') + '</option>' +
      accsOf('debt').map(function(a){ return '<option value="' + a.id + '"' + (F.loan === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></label>';
  }
  h += '<div class="f"><span>' + t('Күні') + '</span>' + weekStrip() + '</div>';
  h += '<label class="f"><span>' + t('Түсініктеме') + '</span><input class="in" id="f-note" list="note-list" value="' + esc(F.note) + '" placeholder="' + t('Мысалы, Magnum') + '" oninput="F.note=this.value;noteHint()"></label>';
  h += '<datalist id="note-list">' + noteSuggestions() + '</datalist>';
  h += '<button class="btn" onclick="saveTx()">' + ic('check') + t('Сақтау') + '</button>';
  if(F.id) h += '<button class="btn red" onclick="delTx(\'' + F.id + '\')">' + ic('trash') + t('Өшіру') + '</button>';
  openSheet(h);
}
function amtW(v){ return Math.max(1, String(v || '').length || 1) * 0.62 + 0.3 + 'em'; }
function fitAmt(e){ e.style.width = amtW(e.value); }
function weekStrip(){
  var days = [], d0 = new Date();
  for(var i = 5; i >= 0; i--){ var d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - i); days.push(iso(d)); }
  var custom = days.indexOf(F.date) < 0;
  var WD = ['Жс','Дс','Сс','Ср','Бс','Жм','Сб'];
  var h = '<div class="week">' + days.map(function(ds, i){
    var d = parseISO(ds), lab = i === 5 ? t('Бүгін') : i === 4 ? t('Кеше') : t(WD[d.getDay()]);
    return '<button class="' + (F.date === ds ? 'on' : '') + '" onclick="pickDay(this,\'' + ds + '\')">' + lab + '<b>' + d.getDate() + '</b></button>';
  }).join('');
  if(custom){ var c = parseISO(F.date); h += '<button class="on" onclick="openDatePick()">' + monShort(c.getMonth()) + '<b>' + c.getDate() + '</b></button>'; }
  h += '<button class="cal" onclick="openDatePick()" aria-label="' + t('Күні') + '">' + ic('cal') + '</button>';
  return h + '<input type="date" id="f-date" value="' + F.date + '" max="' + todayISO() + '" onchange="if(this.value){F.date=this.value;drawTxSheetKeep()}" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px"></div>';
}
function pickDay(el, ds){
  F.date = ds;
  el.parentNode.querySelectorAll('button').forEach(function(b){ b.classList.toggle('on', b === el); });
  buzz();
}
function openDatePick(){ var e = $('f-date'); try{ e.showPicker(); }catch(_){ e.style.pointerEvents = 'auto'; e.focus(); e.click(); } }
function accChips(field){
  return assets().map(function(a){
    var on = F[field] === a.id;
    return '<button class="chip ' + (on ? 'on' : '') + '" onclick="F.' + field + '=\'' + a.id + '\';drawTxSheetKeep()">' + esc(a.name) +
      ' <span class="num" style="opacity:.6;font-size:12px">' + moneyShort(a.bal, curSym(a)) + '</span></button>';
  }).join('');
}
function drawTxSheetKeep(){ var s = $('sheet').scrollTop; drawTxSheet(); $('sheet').scrollTop = s; }
function txType(tp){
  F.type = tp;
  if(tp !== 'tr'){ if(CATS[tp].indexOf(F.cat) < 0) F.cat = DB.pref['cat_' + tp] || CATS[tp][0]; }
  else if(!F.to || F.to === F.acc){ var o = assets().filter(function(a){ return a.id !== F.acc; })[0]; F.to = o ? o.id : null; }
  drawTxSheetKeep();
}
function txCat(el, c){
  F.cat = c;
  if(c === 'Несие төлемі') return drawTxSheetKeep();
  document.querySelectorAll('#sheet .cat').forEach(function(b){ b.classList.toggle('on', b === el); });
}
function noteSuggestions(){
  var seen = {}, out = [];
  sortTx(DB.tx.slice()).forEach(function(x){ if(x.note && !seen[x.note] && out.length < 40){ seen[x.note] = 1; out.push('<option value="' + esc(x.note) + '">'); } });
  return out.join('');
}
function noteHint(){
  if(F.type === 'tr' || !F.note) return;
  var c = (typeof ruleCat === 'function') && ruleCat(F.type, F.note);
  if(!c){ for(var i = DB.tx.length - 1; i >= 0; i--){ var x = DB.tx[i]; if(x.type === F.type && x.note && x.note.toLowerCase() === F.note.toLowerCase()){ c = x.cat; break; } } }
  if(c && c !== F.cat && CATS[F.type].indexOf(c) >= 0){ F.cat = c; document.querySelectorAll('#sheet .cat').forEach(function(b){ b.classList.toggle('on', b.textContent === t(c)); }); }
}
function saveTx(){
  var amt = num(F.amt);
  if(!amt || amt <= 0){ toast('Соманы жазыңыз'); return; }
  if(F.type === 'tr'){
    if(!F.to){ toast('Қай шотқа екенін таңдаңыз'); return; }
    if(F.to === F.acc){ toast('Екі түрлі шот таңдаңыз'); return; }
  }
  var x = { id: F.id || newId(), type: F.type, cat: F.type === 'tr' ? 'Аударым' : F.cat, amt: Math.abs(amt),
            date: F.date || todayISO(), note: (F.note || '').trim(), acc: F.acc,
            loan: (F.type === 'out' && F.cat === 'Несие төлемі') ? F.loan : null, to: F.type === 'tr' ? F.to : null };
  var more = 0;
  if(F.id){
    var old = txOf(F.id);
    if(old){
      applyTx(old, -1);
      DB.tx = DB.tx.map(function(y){ return y.id === old.id ? x : y; });
      if(x.type !== 'tr' && old.cat !== x.cat && x.note && typeof learnCat === 'function'){
        learnCat(x.type, x.note, x.cat);
        var k = merchKey(x.note);
        if(k) DB.tx.forEach(function(y){ if(y.id !== x.id && y.type === x.type && y.cat === 'Басқа' && merchKey(y.note) === k){ y.cat = x.cat; more++; } });
      }
    }
  } else DB.tx.push(x);
  applyTx(x, 1);
  DB.pref.acc = x.acc;
  if(x.type !== 'tr'){ DB.pref['cat_' + x.type] = x.cat; if(!F.id && x.note && typeof learnCat === 'function') learnCat(x.type, x.note, x.cat); }
  var msg = F.id ? (more ? t('Өзгертілді') + ' · +' + more : 'Өзгертілді') : (x.type === 'in' ? 'Кіріс қосылды' : x.type === 'tr' ? 'Аударым жасалды' : 'Шығын қосылды');
  flashId = x.id; setTimeout(function(){ flashId = null; }, 1800);
  okThen(document.querySelector('#sheet .btn:not(.red):not(.line)'), function(){ done(msg); });
}
var flashId = null;
function okThen(btn, fn){
  if(!btn || matchMedia('(prefers-reduced-motion:reduce)').matches) return fn();
  btn.classList.add('ok');
  btn.innerHTML = '<svg class="chk" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg>';
  buzz();
  setTimeout(fn, 420);
}
function delTx(id, quick){
  var x = txOf(id); if(!x) return;
  if(!quick) return ask('Операция өшіріледі. Жалғастырасыз ба?', function(){ delTx(id, true); }, 'Өшіру');
  applyTx(x, -1);
  DB.tx = DB.tx.filter(function(y){ return y.id !== id; });
  save(); if(sheetOn) closeSheet(); render();
  toast('Өшірілді', function(){ DB.tx.push(x); applyTx(x, 1); save(); render(); });
}
function viewTx(id){
  var x = txOf(id); if(!x) return;
  var a = acc(x.acc), h = sheetHead(x.type === 'in' ? t('Кіріс') : x.type === 'tr' ? t('Аударым') : t('Шығын'));
  h += '<div style="display:flex;align-items:center;gap:14px;margin:6px 0 10px">' + catIc(x.type === 'tr' ? 'Аударым' : x.cat) +
    '<div><b class="num ' + (x.type === 'in' ? 'pos' : '') + '" style="font-size:30px;letter-spacing:-.03em;display:block">' + signed(x.amt, x.type) + '</b>' +
    '<span class="muted">' + esc(x.note || t(x.cat)) + '</span></div></div><div>';
  if(x.type === 'tr'){ var to = acc(x.to); h += kv(t('Қайдан'), a ? esc(a.name) : '—') + kv(t('Қайда'), to ? esc(to.name) : '—'); }
  else { h += kv(t('Санат'), esc(t(x.cat))) + kv(t('Шот'), a ? esc(a.name) : t('Шотсыз')); if(x.loan && acc(x.loan)) h += kv(t('Несие'), esc(acc(x.loan).name)); }
  h += kv(t('Күні'), fullDate(x.date)) + '</div>';
  h += '<div class="btns"><button class="btn line" onclick="openTx(null,\'' + id + '\')">' + ic('edit') + t('Түзету') + '</button><button class="btn red" onclick="delTx(\'' + id + '\')">' + ic('trash') + t('Өшіру') + '</button></div>';
  openSheet(h);
}
function kv(k, v){ return '<div class="kv"><span>' + k + '</span><b class="num">' + v + '</b></div>'; }

/* ---------- ШОТ ---------- */
var AF = null;
function openAcc(kind, id){
  var a = id ? acc(id) : null;
  AF = a ? { id: a.id, kind: a.kind, name: a.name, bal: a.bal, cur: a.cur || BASE(), rate: a.rate || '', pay: a.pay || '', payDay: a.payDay || '', icon: a.icon }
         : { id: null, kind: kind || 'asset', name: '', bal: '', cur: BASE(), rate: '', pay: '', payDay: '', icon: kind === 'debt' ? 'card' : 'wallet' };
  drawAccSheet();
}
function drawAccSheet(){
  var isLoan = AF.kind === 'debt';
  var h = sheetHead(AF.id ? t('Шотты өзгерту') : (isLoan ? t('Жаңа несие') : t('Жаңа шот')));
  if(!isLoan && !AF.id){
    h += '<div class="f"><span>' + t('Банкті таңдаңыз') + '</span><div class="chips" style="flex-wrap:wrap">' + BANKS.map(function(b){
      return '<button class="chip ' + (AF.name === b[0] ? 'on' : '') + '" onclick="AF.name=\'' + b[0] + '\';drawAccSheet()">' + esc(t(b[0])) + '</button>';
    }).join('') + '</div></div>';
  }
  h += '<label class="f"><span>' + t('Атауы') + '</span><input class="in" value="' + esc(AF.name) + '" oninput="AF.name=this.value" placeholder="' + (isLoan ? t('Мысалы, Kaspi Red') : 'Kaspi Gold') + '"></label>';
  h += '<label class="f"><span>' + (isLoan ? t('Несие қалдығы') : t('Қазіргі қалдық')) + '</span><input class="in" inputmode="decimal" value="' + (AF.bal === '' ? '' : AF.bal) + '" oninput="AF.bal=this.value" placeholder="0"></label>';
  if(!isLoan){
    h += '<label class="f"><span>' + t('Валюта') + '</span><select class="in" onchange="AF.cur=this.value">' + curOptions(AF.cur) + '</select></label>';
  } else {
    h += '<div class="two"><label class="f"><span>' + t('Мөлшерлеме, %') + '</span><input class="in" inputmode="decimal" value="' + AF.rate + '" oninput="AF.rate=this.value"></label>' +
      '<label class="f"><span>' + t('Айлық төлем') + '</span><input class="in" inputmode="decimal" value="' + AF.pay + '" oninput="AF.pay=this.value"></label></div>' +
      '<label class="f"><span>' + t('Төлем күні (1–31)') + '</span><input class="in" inputmode="numeric" value="' + AF.payDay + '" oninput="AF.payDay=this.value"></label>';
  }
  h += '<button class="btn" onclick="saveAcc()">' + ic('check') + t('Сақтау') + '</button>';
  if(AF.id) h += '<button class="btn red" onclick="delAcc(\'' + AF.id + '\')">' + ic('trash') + t('Шотты өшіру') + '</button>';
  openSheet(h);
}
function curOptions(sel){
  var b = BASE(), list = [b].concat(Object.keys(CURS).filter(function(c){ return c !== b; }));
  return list.map(function(c){ return '<option value="' + c + '"' + (sel === c ? ' selected' : '') + '>' + symOf(c) + ' · ' + c + ' — ' + t(CURS[c][1]) + '</option>'; }).join('');
}
function saveAcc(){
  var name = (AF.name || '').trim();
  if(!name){ toast('Атауын жазыңыз'); return; }
  var a = AF.id ? acc(AF.id) : { id: newId(), kind: AF.kind, icon: AF.icon };
  a.name = name; a.bal = num(AF.bal);
  if(AF.kind === 'asset') a.cur = AF.cur;
  if(AF.kind === 'debt'){ a.rate = num(AF.rate); a.pay = num(AF.pay); var pd = Math.round(num(AF.payDay)); a.payDay = pd >= 1 && pd <= 31 ? pd : null; }
  if(!AF.id) DB.accounts.push(a);
  done(AF.id ? 'Сақталды' : (AF.kind === 'debt' ? 'Несие қосылды' : 'Шот қосылды'));
}
function delAcc(id){
  ask('Шот өшіріледі. Операциялары сақталады, бірақ шотсыз қалады. Жалғастырасыз ба?', function(){
  DB.accounts = DB.accounts.filter(function(a){ return a.id !== id; });
  DB.tx.forEach(function(x){ if(x.acc === id) x.acc = null; if(x.to === id) x.to = null; if(x.loan === id) x.loan = null; });
  done('Өшірілді');
  }, 'Өшіру');
}
function monthsLeft(bal, rate, pay){
  var i = rate / 12 / 100, b = bal, n = 0;
  if(pay <= bal * i) return -1;
  while(b > 0 && n < 600){ b = b * (1 + i) - pay; n++; }
  return n;
}
function viewAcc(id){
  var a = acc(id); if(!a) return;
  var sym = curSym(a), h = sheetHead(esc(a.name));
  h += '<div style="display:flex;align-items:center;gap:14px;margin:6px 0 12px">' + accBadge(a) +
    '<b class="num" style="font-size:30px;letter-spacing:-.03em">' + money(a.kind === 'debt' ? -a.bal : a.bal, sym, foreign(a)) + '</b></div>';
  if(foreign(a)) h += kv(t('Негізгі валютада'), fxRate(a.cur) ? money(toBase(a)) : '—') + kv(t('Курс'), fxLine(a.cur));
  if(a.kind === 'debt'){
    h += kv(t('Мөлшерлеме'), (a.rate || 0) + '%') + kv(t('Айлық төлем'), money(a.pay || 0));
    if(a.payDay) h += kv(t('Төлем күні'), a.payDay);
    if(a.pay > 0 && a.bal > 0){
      var m = monthsLeft(a.bal, a.rate || 0, a.pay);
      h += kv(t('Қалған мерзім'), m > 0 ? m + ' ' + t('ай') : t('есептелмеді'));
      if(m > 0){
        var m2 = monthsLeft(a.bal, a.rate || 0, a.pay * 1.25), paid = a.pay * m, paid2 = a.pay * 1.25 * m2;
        h += '<div class="card" style="background:var(--sf2);box-shadow:none"><b style="font-size:14px">' + t('Айына 25% артық төлесеңіз') + '</b>' +
          '<div class="muted" style="font-size:13.5px;margin-top:4px">' + (m - m2) + ' ' + t('ай ерте жабылады') + ' · ' + t('үнем') + ' ≈ ' + money(Math.max(0, paid - paid2)) + '</div></div>';
      }
    }
  }
  var cnt = DB.tx.filter(function(x){ return x.acc === id || x.to === id || x.loan === id; }).length;
  h += kv(t('Операция'), cnt);
  h += '<div class="btns"><button class="btn line" onclick="opsF.acc=\'' + id + '\';closeSheet();setTimeout(function(){go(\'ops\')},50)">' + ic('receipt') + t('Операциялар') + '</button>' +
    '<button class="btn line" onclick="openAcc(\'' + a.kind + '\',\'' + id + '\')">' + ic('edit') + t('Түзету') + '</button></div>';
  openSheet(h);
}

/* ---------- МАҚСАТТАР ---------- */
function goalOf(id){ for(var i = 0; i < DB.goals.length; i++) if(DB.goals[i].id === id) return DB.goals[i]; return null; }
function goalPace(g){
  var left = Math.max(0, (g.target || 0) - (g.saved || 0));
  if(!g.due) return { left: left, need: 0, days: 0, late: false };
  var days = Math.round((parseISO(g.due) - parseISO(todayISO())) / 864e5), months = Math.max(0, days / 30.44);
  return { left: left, days: days, late: days < 0 && left > 0, need: months > 0.1 && left > 0 ? left / months : left };
}
PAGES.goals = function(){
  var s = 0, tg = 0; DB.goals.forEach(function(g){ s += g.saved || 0; tg += g.target || 0; });
  var h = topBar(t('Мақсаттар'), DB.goals.length > 1 ? t('Барлығы') + ' ' + moneyShort(s) + ' / ' + moneyShort(tg) : '', '<button class="ibtn" onclick="openGoal()">' + ic('plus') + '</button>');
  if(!DB.goals.length) return h + '<div class="card empty">' + ic('target') + t('Мақсат әлі жоқ.') + '<br>' + t('Жинайтын сомаңызды белгілеп қойыңыз.') + '<button class="btn" onclick="openGoal()">' + t('Мақсат қосу') + '</button></div>';
  DB.goals.forEach(function(g){
    var pct = g.target ? Math.min(100, (g.saved || 0) / g.target * 100) : 0, p = goalPace(g);
    h += '<button class="card" style="display:block;width:100%;text-align:left" onclick="viewGoal(\'' + g.id + '\')">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><b style="font-size:16px">' + esc(g.name) + '</b><b class="num" style="font-size:14px">' + Math.round(pct) + '%</b></div>' +
      '<div class="num" style="font-size:22px;font-weight:650;letter-spacing:-.03em;margin-top:6px">' + money(g.saved || 0) + ' <span class="muted" style="font-size:14px;font-weight:500">/ ' + moneyShort(g.target) + '</span></div>' +
      '<div class="prog"><i style="width:' + pct.toFixed(1) + '%;' + (pct >= 100 ? 'background:var(--pos)' : '') + '"></i></div>' +
      (g.due ? '<div class="muted" style="font-size:12.5px;margin-top:8px">' + (pct >= 100 ? t('Орындалды') + ' ✓' : p.late ? '<span class="neg">' + t('Мерзімі өтті') + '</span>' : fullDate(g.due) + ' · ' + t('айына') + ' ' + money(p.need)) + '</div>' : '') +
    '</button>';
  });
  return h;
};
var GF = null;
function openGoal(id){
  var g = id ? goalOf(id) : null;
  GF = g ? { id: g.id, name: g.name, target: g.target, saved: g.saved, due: g.due || '' } : { id: null, name: '', target: '', saved: '', due: '' };
  var h = sheetHead(g ? t('Мақсатты өзгерту') : t('Жаңа мақсат'));
  h += '<label class="f"><span>' + t('Атауы') + '</span><input class="in" value="' + esc(GF.name) + '" oninput="GF.name=this.value" placeholder="' + t('Мысалы, Көлік') + '"></label>' +
    '<div class="two"><label class="f"><span>' + t('Мақсат сомасы') + '</span><input class="in" inputmode="decimal" value="' + GF.target + '" oninput="GF.target=this.value"></label>' +
    '<label class="f"><span>' + t('Жиналған') + '</span><input class="in" inputmode="decimal" value="' + GF.saved + '" oninput="GF.saved=this.value"></label></div>' +
    '<label class="f"><span>' + t('Мерзімі (міндетті емес)') + '</span><input class="in" type="date" value="' + GF.due + '" onchange="GF.due=this.value"></label>' +
    '<button class="btn" onclick="saveGoal()">' + ic('check') + t('Сақтау') + '</button>';
  openSheet(h);
}
function saveGoal(){
  if(!GF.name.trim()){ toast('Атауын жазыңыз'); return; }
  if(num(GF.target) <= 0){ toast('Мақсат сомасын жазыңыз'); return; }
  var g = GF.id ? goalOf(GF.id) : { id: newId(), hist: [] };
  g.name = GF.name.trim(); g.target = num(GF.target); g.saved = num(GF.saved); g.due = GF.due || null;
  if(!GF.id) DB.goals.push(g);
  done(GF.id ? 'Сақталды' : 'Мақсат қосылды');
}
var gvAcc = '';
function viewGoal(id){
  var g = goalOf(id); if(!g) return;
  var pct = g.target ? Math.min(100, g.saved / g.target * 100) : 0, p = goalPace(g);
  var h = sheetHead(esc(g.name));
  h += '<div class="num" style="font-size:30px;font-weight:650;letter-spacing:-.03em">' + money(g.saved || 0) + '</div>' +
    '<div class="prog" style="height:8px"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
    kv(t('Мақсат'), money(g.target)) + kv(t('Қалды'), money(p.left)) + (g.due ? kv(t('Мерзімі'), fullDate(g.due)) + kv(t('Айына салу керек'), money(p.need)) : '');
  h += '<div class="card" style="background:var(--sf2);box-shadow:none"><b style="font-size:14px">' + t('Салым қосу') + '</b>' +
    '<input class="in" id="gv-amt" inputmode="decimal" placeholder="0 ' + S() + '" style="margin-top:10px;background:var(--sf)">' +
    '<select class="in" id="gv-acc" style="margin-top:8px;background-color:var(--sf)"><option value="">' + t('Шотсыз — тек белгілеу') + '</option>' +
    assets().map(function(a){ return '<option value="' + a.id + '"' + (gvAcc === a.id ? ' selected' : '') + '>' + esc(a.name) + ' · ' + moneyShort(a.bal, curSym(a)) + '</option>'; }).join('') + '</select>' +
    '<button class="btn lime" onclick="addToGoal(\'' + id + '\')">' + ic('plus') + t('Қосу') + '</button></div>';
  if(g.hist && g.hist.length){
    h += '<div class="sec" style="margin-left:0">' + t('Салым тарихы') + '</div>' + g.hist.slice().reverse().slice(0, 12).map(function(x){
      var a = acc(x.acc); return kv(fullDate(x.date) + (a ? ' · ' + esc(a.name) : ''), (x.amt < 0 ? '' : '+') + money(x.amt));
    }).join('');
  }
  h += '<div class="btns"><button class="btn line" onclick="openGoal(\'' + id + '\')">' + ic('edit') + t('Түзету') + '</button><button class="btn red" onclick="delGoal(\'' + id + '\')">' + ic('trash') + t('Өшіру') + '</button></div>';
  openSheet(h);
}
function addToGoal(id){
  var g = goalOf(id), v = val('gv-amt'); gvAcc = $('gv-acc').value;
  if(!g || v <= 0){ toast('Соманы жазыңыз'); return; }
  var a = acc(gvAcc); if(a) a.bal -= toAcc(a, v);
  g.saved = (g.saved || 0) + v;
  (g.hist = g.hist || []).push({ date: todayISO(), acc: gvAcc || null, amt: v });
  done(g.saved >= g.target ? 'Мақсат орындалды!' : 'Салым қосылды');
}
function delGoal(id){
  ask('Мақсат өшіріледі. Жалғастырасыз ба?', function(){
  DB.goals = DB.goals.filter(function(g){ return g.id !== id; });
  done('Өшірілді');
  }, 'Өшіру');
}

/* ---------- ҚАРЫЗДАР ---------- */
var debtDir = 'out';
function debtOf(id){ for(var i = 0; i < DB.debts.length; i++) if(DB.debts[i].id === id) return DB.debts[i]; return null; }
PAGES.debts = function(){
  var T = debtTotals();
  var h = topBar(t('Қарыздар'), '', '<button class="ibtn" onclick="openDebt()">' + ic('plus') + '</button>');
  h += '<div class="grid2" style="margin-top:4px">' + miniStat(t('Маған қарыз'), T.lent) + miniStat(t('Менің қарызым'), -T.owed) + '</div>';
  h += '<div class="seg" style="margin-top:14px">' + [['out', 'Мен бердім'], ['in', 'Мен алдым']].map(function(x){
    return '<button class="' + (debtDir === x[0] ? 'on' : '') + '" onclick="debtDir=\'' + x[0] + '\';render()">' + t(x[1]) + '</button>'; }).join('') + '</div>';
  var list = DB.debts.filter(function(d){ return d.dir === debtDir; }).sort(function(a, b){ return debtLeft(b) - debtLeft(a) || (a.date < b.date ? 1 : -1); });
  if(!list.length) return h + '<div class="card empty">' + ic('people') + t('Жазба жоқ.') + '</div>';
  var td = todayISO();
  h += '<div class="list" style="margin-top:12px">' + list.map(function(d){
    var l = debtLeft(d), pct = d.amt ? Math.min(100, (d.paid || 0) / d.amt * 100) : 0, late = l > 0 && d.due && d.due < td;
    return '<button class="row" onclick="viewDebt(\'' + d.id + '\')"><span class="ci" style="background:var(--sf2);font-weight:700">' + esc((d.who || '?').trim().charAt(0).toUpperCase()) + '</span>' +
      '<span class="mid"><b>' + esc(d.who) + '</b><span>' + (l <= 0 ? t('Жабылды') + ' ✓' : late ? '<span class="neg">' + t('Мерзімі өтті') + ' · ' + fullDate(d.due) + '</span>' : (d.due ? t('Мерзімі') + ' ' + fullDate(d.due) : fullDate(d.date))) + '</span>' +
      '<div class="prog" style="height:4px;margin-top:6px"><i style="width:' + pct + '%;background:var(--pos)"></i></div></span>' +
      '<span class="amt num">' + money(l) + '<small>/ ' + moneyShort(d.amt) + '</small></span></button>';
  }).join('') + '</div>';
  return h;
};
var DF = null;
function openDebt(){
  DF = { dir: debtDir, who: '', amt: '', acc: '', date: todayISO(), due: '', note: '' };
  drawDebtSheet();
}
function drawDebtSheet(){
  var h = sheetHead(t('Жаңа қарыз'));
  h += '<div class="seg">' + [['out', 'Мен бердім'], ['in', 'Мен алдым']].map(function(x){
    return '<button class="' + (DF.dir === x[0] ? 'on' : '') + '" onclick="DF.dir=\'' + x[0] + '\';drawDebtSheet()">' + t(x[1]) + '</button>'; }).join('') + '</div>';
  h += '<label class="f"><span>' + (DF.dir === 'out' ? t('Кімге') : t('Кімнен')) + '</span><input class="in" value="' + esc(DF.who) + '" oninput="DF.who=this.value" placeholder="' + t('Аты') + '"></label>' +
    '<label class="f"><span>' + t('Сома') + '</span><input class="in" inputmode="decimal" value="' + DF.amt + '" oninput="DF.amt=this.value" placeholder="0 ' + S() + '"></label>' +
    '<label class="f"><span>' + t('Шот') + '</span><select class="in" onchange="DF.acc=this.value"><option value="">' + t('Шотсыз — тек белгілеу') + '</option>' +
    assets().map(function(a){ return '<option value="' + a.id + '"' + (DF.acc === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></label>' +
    '<div class="two"><label class="f"><span>' + t('Күні') + '</span><input class="in" type="date" value="' + DF.date + '" onchange="DF.date=this.value"></label>' +
    '<label class="f"><span>' + t('Қайтару мерзімі') + '</span><input class="in" type="date" value="' + DF.due + '" onchange="DF.due=this.value"></label></div>' +
    '<label class="f"><span>' + t('Түсініктеме') + '</span><input class="in" value="' + esc(DF.note) + '" oninput="DF.note=this.value"></label>' +
    '<button class="btn" onclick="saveDebt()">' + ic('check') + t('Сақтау') + '</button>';
  openSheet(h);
}
function saveDebt(){
  if(!DF.who.trim()){ toast('Кім екенін жазыңыз'); return; }
  var amt = num(DF.amt); if(amt <= 0){ toast('Соманы жазыңыз'); return; }
  var d = { id: newId(), dir: DF.dir, who: DF.who.trim(), amt: amt, paid: 0, date: DF.date || todayISO(), due: DF.due || null, note: DF.note.trim(), acc: DF.acc || null, hist: [] };
  var a = acc(d.acc); if(a) a.bal += toAcc(a, d.dir === 'out' ? -amt : amt);
  DB.debts.push(d); debtDir = d.dir;
  done(d.dir === 'out' ? 'Қарызға берілді' : 'Қарыз алынды');
}
function viewDebt(id){
  var d = debtOf(id); if(!d) return;
  var l = debtLeft(d), a = acc(d.acc), h = sheetHead(esc(d.who));
  h += '<div class="num" style="font-size:30px;font-weight:650;letter-spacing:-.03em">' + money(l) + '</div><div class="muted">' + (d.dir === 'out' ? t('маған қайтаруы керек') : t('мен қайтаруым керек')) + '</div>' +
    kv(d.dir === 'out' ? t('Бердім') : t('Алдым'), money(d.amt)) + kv(t('Қайтарылды'), money(d.paid || 0)) + kv(t('Күні'), fullDate(d.date)) +
    (d.due ? kv(t('Қайтару мерзімі'), fullDate(d.due)) : '') + (a ? kv(t('Шот'), esc(a.name)) : '') + (d.note ? kv(t('Түсініктеме'), esc(d.note)) : '');
  if(l > 0){
    h += '<div class="card" style="background:var(--sf2);box-shadow:none"><b style="font-size:14px">' + (d.dir === 'out' ? t('Маған қайтарған сома') : t('Мен қайтарған сома')) + '</b>' +
      '<input class="in" id="dv-amt" inputmode="decimal"  placeholder="' + nf(l) + ' ' + S() + '" style="margin-top:10px;background:var(--sf)">' +
      '<select class="in" id="dv-acc" style="margin-top:8px;background-color:var(--sf)"><option value="">' + t('Шотсыз — тек белгілеу') + '</option>' +
      assets().map(function(x){ return '<option value="' + x.id + '"' + (d.acc === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<div class="btns"><button class="btn line" onclick="$(\'dv-amt\').value=' + l + '">' + t('Толық') + '</button><button class="btn lime" onclick="payDebt(\'' + id + '\')">' + ic('check') + t('Жазу') + '</button></div></div>';
  }
  if(d.hist && d.hist.length) h += '<div class="sec" style="margin-left:0">' + t('Төлем тарихы') + '</div>' + d.hist.slice().reverse().map(function(x){ var pa = acc(x.acc); return kv(fullDate(x.date) + (pa ? ' · ' + esc(pa.name) : ''), money(x.amt)); }).join('');
  h += '<button class="btn red" onclick="delDebt(\'' + id + '\')">' + ic('trash') + t('Өшіру') + '</button>';
  openSheet(h);
}
function payDebt(id){
  var d = debtOf(id), v = val('dv-amt'), accId = $('dv-acc').value || null;
  if(!d || v <= 0){ toast('Соманы жазыңыз'); return; }
  v = Math.min(v, debtLeft(d));
  var a = acc(accId); if(a) a.bal += toAcc(a, d.dir === 'out' ? v : -v);
  d.paid = (d.paid || 0) + v;
  (d.hist = d.hist || []).push({ date: todayISO(), amt: v, acc: accId });
  done(debtLeft(d) <= 0 ? 'Толық жабылды' : 'Төлем жазылды');
}
function delDebt(id){
  var d = debtOf(id); if(!d) return;
  ask('Жазба өшіріледі, шот қалдықтары бастапқы күйге қайтарылады. Жалғастырасыз ба?', function(){
  var a = acc(d.acc); if(a) a.bal += toAcc(a, d.dir === 'out' ? d.amt : -d.amt);
  (d.hist || []).forEach(function(x){ var pa = acc(x.acc); if(pa) pa.bal += toAcc(pa, d.dir === 'out' ? -x.amt : x.amt); });
  DB.debts = DB.debts.filter(function(x){ return x.id !== id; });
  done('Өшірілді');
  }, 'Өшіру');
}

/* ---------- ТҰРАҚТЫ ТӨЛЕМДЕР ---------- */
function recurState(){
  var now = new Date(), key = ym(now), d = now.getDate(), r = { total: 0, unpaid: 0, due: [] };
  DB.recur.forEach(function(x){
    r.total += x.amt;
    if(x.paid !== key){ r.unpaid += x.amt; if(x.day - d <= 3 && x.day - d >= -31) r.due.push(x); }
  });
  return r;
}
PAGES.recur = function(){
  var R = recurState(), key = ym(new Date());
  var h = topBar(t('Тұрақты төлемдер'), monName(new Date().getMonth()), '<button class="ibtn" onclick="openRecur()">' + ic('plus') + '</button>');
  h += '<div class="grid2" style="margin-top:4px">' + miniStat(t('Айына'), R.total) + miniStat(t('Төленбеген'), R.unpaid) + '</div>';
  if(!DB.recur.length) return h + '<div class="card empty">' + ic('repeat') + t('Ай сайынғы төлемдерді (интернет, жалдау, жазылым) осында қосыңыз.') + '<button class="btn" onclick="openRecur()">' + t('Төлем қосу') + '</button></div>';
  var list = DB.recur.slice().sort(function(a, b){ return (a.paid === key) - (b.paid === key) || a.day - b.day; });
  h += '<div class="list" style="margin-top:12px">' + list.map(function(x){
    var paid = x.paid === key;
    return '<div class="row"><button style="display:contents" onclick="openRecur(\'' + x.id + '\')">' + catIc(x.cat) +
      '<span class="mid"><b>' + esc(x.name) + '</b><span>' + t('Айдың') + ' ' + x.day + ' ' + t('күні') + ' · ' + money(x.amt) + '</span></span></button>' +
      (paid ? '<span class="tag" style="background:var(--pos);color:#fff">' + t('Төленді') + '</span>'
            : '<button class="btn sm lime" onclick="payRecur(\'' + x.id + '\')">' + t('Төледім') + '</button>') + '</div>';
  }).join('') + '</div>';
  h += '<p class="muted" style="font-size:12.5px;margin:12px 6px">' + t('«Төледім» басқанда шығын жазылады және шот қалдығы азаяды.') + '</p>';
  return h;
};
var RF = null;
function openRecur(id){
  var r = null; DB.recur.forEach(function(x){ if(x.id === id) r = x; });
  RF = r ? { id: r.id, name: r.name, amt: r.amt, day: r.day, cat: r.cat || 'Басқа', acc: r.acc || '' } : { id: null, name: '', amt: '', day: '', cat: 'Байланыс', acc: (assets()[0] || {}).id || '' };
  drawRecurSheet();
}
function drawRecurSheet(){
  var h = sheetHead(RF.id ? t('Төлемді өзгерту') : t('Жаңа төлем'));
  h += '<label class="f"><span>' + t('Атауы') + '</span><input class="in" value="' + esc(RF.name) + '" oninput="RF.name=this.value" placeholder="' + t('Мысалы, Интернет') + '"></label>' +
    '<div class="two"><label class="f"><span>' + t('Сома') + '</span><input class="in" inputmode="decimal" value="' + RF.amt + '" oninput="RF.amt=this.value"></label>' +
    '<label class="f"><span>' + t('Айдың күні (1–31)') + '</span><input class="in" inputmode="numeric" value="' + RF.day + '" oninput="RF.day=this.value"></label></div>' +
    '<label class="f"><span>' + t('Санат') + '</span><select class="in" onchange="RF.cat=this.value">' + CATS.out.map(function(c){ return '<option value="' + esc(c) + '"' + (RF.cat === c ? ' selected' : '') + '>' + esc(t(c)) + '</option>'; }).join('') + '</select></label>' +
    '<label class="f"><span>' + t('Шот') + '</span><select class="in" onchange="RF.acc=this.value">' + assets().map(function(a){ return '<option value="' + a.id + '"' + (RF.acc === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></label>' +
    '<button class="btn" onclick="saveRecur()">' + ic('check') + t('Сақтау') + '</button>' +
    (RF.id ? '<button class="btn red" onclick="delRecur(\'' + RF.id + '\')">' + ic('trash') + t('Өшіру') + '</button>' : '');
  openSheet(h);
}
function saveRecur(){
  var amt = num(RF.amt), day = Math.round(num(RF.day));
  if(!RF.name.trim()){ toast('Атауын жазыңыз'); return; }
  if(amt <= 0){ toast('Соманы жазыңыз'); return; }
  if(day < 1 || day > 31){ toast('Айдың қай күні екенін жазыңыз (1–31)'); return; }
  var r = null; DB.recur.forEach(function(x){ if(x.id === RF.id) r = x; });
  if(!r){ r = { id: newId(), paid: null }; DB.recur.push(r); }
  r.name = RF.name.trim(); r.amt = amt; r.day = day; r.cat = RF.cat; r.acc = RF.acc;
  done('Сақталды');
}
function delRecur(id){
  ask('Төлем тізімнен өшіріледі. Бұрын жазылған операциялар қалады. Жалғастырасыз ба?', function(){
  DB.recur = DB.recur.filter(function(x){ return x.id !== id; });
  done('Өшірілді');
  }, 'Өшіру');
}
function payRecur(id){
  var r = null; DB.recur.forEach(function(x){ if(x.id === id) r = x; }); if(!r) return;
  var a = acc(r.acc) || assets()[0]; if(!a){ toast('Алдымен шот қосыңыз'); return; }
  var x = { id: newId(), type: 'out', cat: r.cat, amt: r.amt, date: todayISO(), note: r.name, acc: a.id, loan: null, to: null };
  DB.tx.push(x); applyTx(x, 1); r.paid = ym(new Date());
  save(); render(); buzz();
  toast('Төлем жазылды', function(){ DB.tx = DB.tx.filter(function(y){ return y.id !== x.id; }); applyTx(x, -1); r.paid = null; save(); render(); });
}

/* ---------- НӘТИЖЕ (СТАТИСТИКА) ---------- */
var statsKind = 'out', statsMon = null;
PAGES.stats = function(){
  if(!statsMon){ statsMon = new Date(); statsMon.setDate(1); }
  var key = ym(statsMon), M = monthSum(key);
  var h = tabBar(t('Нәтиже'));
  h += '<div class="monnav"><button onclick="shiftStat(-1)">' + ic('left') + '</button><b>' + monName(statsMon.getMonth()) + ' ' + statsMon.getFullYear() + '</b><button onclick="shiftStat(1)">' + ic('right') + '</button></div>';
  h += '<div class="card"><div class="seg">' + [['out', 'Шығын'], ['in', 'Кіріс']].map(function(x){
    return '<button class="' + (statsKind === x[0] ? 'on' : '') + '" onclick="statsKind=\'' + x[0] + '\';render()">' + t(x[1]) + '</button>'; }).join('') + '</div>';
  var items = catTotals(key, statsKind), total = 0; items.forEach(function(x){ total += x.v; });
  if(!items.length) h += '<div class="empty">' + ic('pie') + t('Бұл айда дерек жоқ.') + '</div>';
  else {
    h += donutSvg(items, total, statsKind === 'out' ? t('Барлық шығын') : t('Барлық кіріс'));
    h += items.map(function(x){
      var pct = x.v / total * 100;
      return '<button class="row" style="padding:10px 0;background:none" onclick="opsF={type:\'' + statsKind + '\',acc:\'\',q:\'\',cat:\'' + esc(x.cat) + '\',mon:\'' + key + '\'};go(\'ops\')">' + catIc(x.cat) +
        '<span class="mid"><b>' + esc(t(x.cat)) + '</b><div class="prog" style="height:4px;margin-top:6px"><i style="width:' + pct.toFixed(1) + '%;background:' + catMeta(x.cat)[1] + '"></i></div></span>' +
        '<span class="amt num">' + money(x.v) + '<small>' + pct.toFixed(pct < 10 ? 1 : 0).replace('.', ',') + '% · ' + x.n + '</small></span></button>';
    }).join('');
  }
  h += '</div>';
  /* 6 ай */
  var months = [], max = 1;
  for(var i = 5; i >= 0; i--){ var d = new Date(statsMon.getFullYear(), statsMon.getMonth() - i, 1), s = monthSum(ym(d)); months.push({ d: d, s: s }); max = Math.max(max, s.in, s.out); }
  h += '<div class="card"><h2>' + t('Соңғы 6 ай') + '</h2><div class="bars">' + months.map(function(m, i){
    return '<div class="' + (i === 5 ? 'on' : '') + '" onclick="statsMon=new Date(' + m.d.getFullYear() + ',' + m.d.getMonth() + ',1);render()"><div class="pair"><i class="a" style="height:' + (m.s.in / max * 100).toFixed(1) + '%"></i><i class="b" style="height:' + (m.s.out / max * 100).toFixed(1) + '%"></i></div><span>' + monShort(m.d.getMonth()) + '</span></div>';
  }).join('') + '</div><div class="legend"><span><i class="dot" style="background:var(--pos)"></i>' + t('Кіріс') + '</span><span><i class="dot" style="background:var(--ink)"></i>' + t('Шығын') + '</span></div></div>';
  /* көрсеткіштер */
  var avg = 0, cnt = 0;
  for(var j = 1; j <= 3; j++){ var dd = new Date(statsMon.getFullYear(), statsMon.getMonth() - j, 1), ss = monthSum(ym(dd)); if(ss.n){ avg += ss.out; cnt++; } }
  avg = cnt ? avg / cnt : M.out;
  var T = totals(), rate = M.in > 0 ? (M.in - M.out) / M.in * 100 : 0, runway = avg > 0 ? T.banks / avg : 0;
  h += '<div class="card"><h2>' + t('Көрсеткіштер') + '</h2><div class="stat3">' +
    '<div><span>' + t('Айлық орташа шығын') + '</span><b class="num">' + moneyShort(avg) + '</b></div>' +
    '<div><span>' + t('Жинақ үлесі') + '</span><b class="num ' + (rate < 0 ? 'neg' : 'pos') + '">' + Math.round(rate) + '%</b></div>' +
    '<div><span>' + t('Қаражат жетеді') + '</span><b class="num">' + (runway ? runway.toFixed(1).replace('.', ',') + ' ' + t('ай') : '—') + '</b></div></div>' +
    kv(t('Ай қалдығы') + ' (' + t('кіріс') + ' − ' + t('шығын') + ')', '<span class="' + (M.in - M.out < 0 ? 'neg' : 'pos') + '">' + (M.in - M.out > 0 ? '+' : '') + money(M.in - M.out) + '</span>') +
    kv(t('Айлық шығын жоспары'), DB.pref.monthLimit ? money(DB.pref.monthLimit) + ' <button class="tag" onclick="openLimit()">' + t('өзгерту') + '</button>' : '<button class="tag" onclick="openLimit()">' + t('қою') + '</button>') + '</div>';
  return h;
};
function shiftStat(d){
  statsMon = new Date(statsMon.getFullYear(), statsMon.getMonth() + d, 1); render();
  var c = d > 0 ? 'slide-l' : 'slide-r';
  document.querySelectorAll('#p-stats .monnav b, #p-stats .grid2, #p-stats .card').forEach(function(e){ e.classList.add(c); });
}
function catTotals(key, type){
  var m = {}, out = [];
  DB.tx.forEach(function(x){ if(x.type === type && (x.date || '').slice(0, 7) === key){ var c = x.cat || 'Басқа'; m[c] = m[c] || { cat: c, v: 0, n: 0 }; m[c].v += x.amt; m[c].n++; } });
  for(var k in m) out.push(m[k]);
  return out.sort(function(a, b){ return b.v - a.v; });
}
function donutSvg(items, total, label){
  var R = 88, C = 2 * Math.PI * R, off = 0, segs = '';
  items.forEach(function(x){
    var len = x.v / total * C, gap = items.length > 1 ? Math.min(3, len * .3) : 0;
    segs += '<circle cx="110" cy="110" r="' + R + '" fill="none" stroke="' + catMeta(x.cat)[1] + '" stroke-width="22" stroke-dasharray="' + Math.max(0, len - gap).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" stroke-linecap="butt"/>';
    off += len;
  });
  return '<div class="donut"><svg viewBox="0 0 220 220"><circle cx="110" cy="110" r="' + R + '" fill="none" stroke="var(--sf2)" stroke-width="22"/>' + segs + '</svg>' +
    '<div class="c"><span>' + label + '</span><b class="num">' + moneyShort(total) + '</b></div></div>';
}
function openLimit(){
  var h = sheetHead(t('Айлық шығын жоспары')) + '<p class="muted" style="margin:0 0 6px;font-size:14px">' + t('Айына қанша жұмсауды жоспарлайсыз? Басты бетте «Бүгін жұмсауға болады» көрсетіледі. 0 — өшіру.') + '</p>' +
    '<input class="in" id="lim" inputmode="decimal" value="' + (DB.pref.monthLimit || '') + '" placeholder="0 ' + S() + '">' +
    '<button class="btn" onclick="DB.pref.monthLimit=val(\'lim\')||0;done(\'Сақталды\')">' + ic('check') + t('Сақтау') + '</button>';
  openSheet(h);
}

/* ---------- ПРОФИЛЬ / БАПТАУ ---------- */
PAGES.more = function(){
  var h = tabBar(t('Профиль'));
  var days = DB.lastBackup ? Math.floor((Date.now() - new Date(DB.lastBackup)) / 864e5) : null;
  h += '<div class="hero" style="padding:18px 20px"><div class="lab">' + ic('lock') + t('Деректер тек осы телефонда') + '</div>' +
    '<div style="font-size:15px;margin-top:8px;position:relative;z-index:1;line-height:1.45">' + DB.tx.length + ' ' + t('операция') + ' · ' + DB.accounts.length + ' ' + t('шот') + '<br><span style="color:var(--hero-mute);font-size:13px">' +
    (days === null ? t('Көшірме әлі жасалмаған') : t('Соңғы көшірме') + ': ' + (days === 0 ? t('бүгін') : days + ' ' + t('күн бұрын'))) + '</span></div></div>';
  h += '<div class="sec">' + t('Деректер') + '</div><div class="list">' +
    linkRow('download', t('Деректі сақтау'), t('Файлды Drive-қа немесе поштаға сақтап қойыңыз'), 'exportData()') +
    linkRow('upload', t('Деректі ашу'), t('Бұрын сақталған файлдан қайтару'), "$('file-backup').click()") +
    linkRow('history', t('Автокөшірмелер'), t('Соңғы 7 күн'), 'openSnaps()') + '</div>';
  h += '<div class="sec">' + t('Көрініс') + '</div><div class="card" style="margin-top:0">' +
    '<div class="f" style="margin-top:0"><span>' + t('Тақырып') + '</span><div class="seg">' + [['auto', 'Авто'], ['light', 'Ашық'], ['dark', 'Қараңғы']].map(function(x){
      return '<button class="' + (DB.theme === x[0] ? 'on' : '') + '" onclick="setTheme(\'' + x[0] + '\')">' + t(x[1]) + '</button>'; }).join('') + '</div></div>' +
    '<div class="f"><span>' + t('Тіл') + '</span><div class="seg">' + [['kk', 'Қазақша'], ['ru', 'Русский'], ['en', 'English']].map(function(x){
      return '<button class="' + (LANG === x[0] ? 'on' : '') + '" onclick="setLang(\'' + x[0] + '\')">' + x[1] + '</button>'; }).join('') + '</div></div></div>';
  h += '<div class="sec">' + t('Еске салу') + '</div><div class="card" style="margin-top:0">' +
    '<button class="toggle" style="width:100%;text-align:left;padding-top:0" onclick="toggleNotify()"><span style="font-size:14.5px;font-weight:550">' + t('Хабарлама жіберу') +
    '<br><span class="muted" style="font-size:12.5px;font-weight:400">' + t('Төлем, несие, қарыз мерзімі және кешкі «шығынды жаздыңыз ба?»') + '</span></span><i class="sw ' + (notifyOn() ? 'on' : '') + '"></i></button>' +
    (notifyOn() ? '<div class="muted" style="font-size:12.5px;margin-top:2px">' + notifyStatus() + '</div><button class="btn line sm" style="margin-top:10px" onclick="testNotify()">' + ic('bell') + t('Тексеріп көру') + '</button>' : '') + '</div>';
  var fc = {}; DB.accounts.forEach(function(a){ if(foreign(a)) fc[a.cur] = 1; }); if(BASE() !== 'USD') fc.USD = 1;
  h += '<div class="sec">' + t('Валюта') + '</div><div class="card" style="margin-top:0">' +
    '<label class="f" style="margin-top:0"><span>' + t('Негізгі валюта') + '</span><select class="in" onchange="setBase(this.value,this)">' + curOptions(BASE()) + '</select></label>' +
    Object.keys(fc).map(function(c){ return kv(c, fxLine(c)); }).join('') +
    kv(t('Жаңартылды'), DB.fx && DB.fx.at ? fullDate(DB.fx.at.slice(0, 10)) + (DB.fx.src === 'manual' ? ' · ' + t('қолмен') : '') : (DB.rate && DB.rate.at ? fullDate(DB.rate.at.slice(0, 10)) : '—')) +
    '<div class="btns" style="margin-top:12px"><button class="btn line sm" style="flex:1" onclick="fetchRate(true)">' + ic('repeat') + t('Жаңарту') + '</button>' +
    (Object.keys(fc).length ? '<button class="btn line sm" style="flex:1" onclick="openRate()">' + ic('edit') + t('Қолмен') + '</button>' : '') + '</div></div>';
  h += '<div class="sec">' + t('Қосымша') + '</div><div class="list">' +
    linkRow('info', 'Qarzhy ' + VERSION, t('Офлайн жұмыс істейді · сервер жоқ · жарнама жоқ'), 'void 0') +
    linkRow('lock', t('Құпиялылық саясаты'), t('Қандай дерек қайда сақталады'), "location.href='privacy.html#'+LANG") +
    linkRow('trash', '<span class="neg">' + t('Барлық деректі өшіру') + '</span>', t('Қайтару мүмкін емес'), 'wipeAll()') + '</div>';
  return h;
};
function setTheme(m){ DB.theme = m; save(); applyTheme(); render(); }
function applyTheme(){
  var dark = DB.theme === 'dark' || (DB.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  $('meta-theme').content = dark ? '#0C0C0B' : '#EFECE4';
}
function setLang(l){ DB.lang = l; save(); flush().then(function(){ location.reload(); }); }
function openRate(){
  var fc = {}; DB.accounts.forEach(function(a){ if(foreign(a)) fc[a.cur] = 1; }); if(BASE() !== 'USD') fc.USD = 1;
  openSheet(sheetHead(t('Курсты қолмен жазу')) + Object.keys(fc).map(function(c){
    var r = fxRate(c);
    return '<label class="f"><span>1 ' + symOf(c) + ' (' + c + ') = ? ' + S() + '</span><input class="in" data-c="' + c + '" inputmode="decimal" value="' + (r ? +r.toFixed(4) : '') + '"></label>';
  }).join('') + '<button class="btn" onclick="saveManualRates()">' + ic('check') + t('Сақтау') + '</button>');
}
function saveManualRates(){
  var b = BASE(), r = (DB.fx && DB.fx.base === b && DB.fx.r) ? DB.fx.r : {};
  if(b === 'KZT' && !r.USD && DB.rate && DB.rate.v) r.USD = DB.rate.v;
  document.querySelectorAll('#sheet input[data-c]').forEach(function(e){ var v = num(e.value); if(v > 0) r[e.dataset.c] = v; });
  DB.fx = { base: b, at: new Date().toISOString(), src: 'manual', r: r };
  if(b === 'KZT' && r.USD) DB.rate = { v: r.USD, at: DB.fx.at, src: 'manual' };
  done('Курс сақталды');
}
function setBase(code, el){
  if(code === BASE()) return;
  var apply = function(){
    var old = BASE();
    DB.pref.base = code;
    DB.accounts.forEach(function(a){ if(!a.cur || a.cur === old) a.cur = code; });
    DB.fx = null; save(); render(); fetchRate(false); toast('Сақталды');
  };
  if(!DB.tx.length && !DB.accounts.some(function(a){ return a.bal; })) return apply();
  if(el) el.value = BASE();
  ask('Негізгі валюта ауысады. Бұрынғы сомалар қайта есептелмейді — тек белгісі өзгереді. Жалғастырасыз ба?', apply, 'Ауыстыру');
}
function exportData(){
  var blob = new Blob([JSON.stringify(DB, null, 1)], { type: 'application/json' }), name = 'qarzhy-' + todayISO() + '.json';
  DB.lastBackup = new Date().toISOString(); save(); render();
  var file = null; try{ file = new File([blob], name, { type: 'application/json' }); }catch(e){}
  if(file && navigator.canShare && navigator.canShare({ files: [file] })){ navigator.share({ files: [file], title: name }).catch(function(){ dl(blob, name); }); }
  else dl(blob, name);
}
function dl(blob, name){ var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function(){ a.remove(); }, 500); }
function importBackup(f){
  var r = new FileReader();
  r.onload = function(){
    try{
      var d = JSON.parse(r.result);
      if(!d || !Array.isArray(d.tx)) throw 0;
      ask('Қазіргі деректің орнына файлдағы дерек қойылады. Жалғастырасыз ба?', function(){
        var keepLang = DB.lang; DB = normalize(d); DB.lang = d.lang || keepLang;
        save(); applyTheme(); render(); toast('Дерек ашылды');
      }, 'Ашу');
    }catch(e){ toast('Файл оқылмады'); }
  };
  r.readAsText(f);
}
function openSnaps(){
  idbGet('snaps').then(function(list){
    list = (list || []).slice().reverse();
    var h = sheetHead(t('Автокөшірмелер')) + '<p class="muted" style="font-size:13.5px;margin:0 0 8px">' + t('Қосымша күн сайын деректің көшірмесін өзі жасайды.') + '</p>';
    h += list.length ? list.map(function(x){
      return '<div class="kv" style="align-items:center"><span>' + fullDate(x.day) + ' · ' + x.count + ' ' + t('операция') + '</span><button class="btn sm line" onclick="restoreSnap(\'' + x.day + '\')">' + t('Қайтару') + '</button></div>';
    }).join('') : '<div class="empty">' + t('Әзірге көшірме жоқ.') + '</div>';
    openSheet(h);
  }).catch(function(){ toast('Көшірмелер оқылмады'); });
}
function restoreSnap(day){
  idbGet('snap:' + day).then(function(d){
    if(!d){ toast('Көшірме табылмады'); return; }
    ask('Осы күнгі күйге қайтарамыз ба?', function(){ DB = normalize(d); done('Қайтарылды'); }, 'Қайтару');
  });
}
function wipeAll(){
  ask('Барлық операция, шот, мақсат және қарыз өшіріледі. Қайтару мүмкін емес. Жалғастырасыз ба?', function(){
    setTimeout(function(){ ask('Сенімдісіз бе? Алдымен «Деректі сақтау» жасаған жөн.', function(){
      var keep = { lang: DB.lang, theme: DB.theme, rate: DB.rate, fx: DB.fx, pref: { base: BASE() } };
      DB = normalize(keep); save(); render(); toast('Барлығы өшірілді');
    }, 'Өшіру'); }, 150);
  }, 'Өшіру');
}

/* ---------- ЕСКЕ САЛУ ---------- */
var notifyMode = '';
function notifyOn(){ return !!(DB.pref.notify && 'Notification' in window && Notification.permission === 'granted'); }
function notifyStatus(){
  return notifyMode === 'bg' ? t('Қосымша жабық тұрса да тексеріледі (күніне 1–2 рет, уақытын Android өзі таңдайды).')
       : t('Бұл телефонда фондық тексеру қолжетімсіз — хабарлама қосымшаны ашқанда шығады.');
}
function toggleNotify(){
  if(DB.pref.notify){ DB.pref.notify = false; save(); unregisterSync(); render(); return; }
  if(!('Notification' in window)){ toast('Бұл браузер хабарламаны қолдамайды'); return; }
  Notification.requestPermission().then(function(p){
    if(p !== 'granted'){ toast('Хабарламаға рұқсат берілмеді — телефон баптауынан қосыңыз'); return; }
    DB.pref.notify = true; save(); flush();
    registerSync().then(function(){ render(); toast('Еске салу қосылды'); });
  });
}
function registerSync(){
  if(!('serviceWorker' in navigator)) return Promise.resolve();
  return navigator.serviceWorker.ready.then(function(reg){
    if(!reg.periodicSync){ notifyMode = 'open'; return; }
    return navigator.permissions.query({ name: 'periodic-background-sync' }).then(function(st){
      if(st.state !== 'granted'){ notifyMode = 'open'; return; }
      return reg.periodicSync.register('qarzhy-remind', { minInterval: 6 * 3600e3 }).then(function(){ notifyMode = 'bg'; });
    });
  }).catch(function(){ notifyMode = 'open'; });
}
function unregisterSync(){
  if('serviceWorker' in navigator) navigator.serviceWorker.ready.then(function(reg){ if(reg.periodicSync) reg.periodicSync.unregister('qarzhy-remind'); }).catch(function(){});
}
function testNotify(){
  if(!notifyOn()) return;
  navigator.serviceWorker.ready.then(function(reg){
    reg.showNotification('Qarzhy', { body: t('Хабарлама жұмыс істейді ✓'), icon: 'icon-192.png', badge: 'icon-192.png', tag: 'qarzhy-test' });
  }).catch(function(){ toast('Хабарлама жіберілмеді'); });
}
function checkRemindersNow(){
  if(!notifyOn() || !navigator.serviceWorker || !navigator.serviceWorker.controller) return;
  flush().then(function(){ navigator.serviceWorker.controller.postMessage({ type: 'remind' }); });
}

/* ---------- EXCEL ---------- */
var XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
function exportOpsXlsx(){
  toast('Excel дайындалуда…');
  loadScript(XLSX_URL).then(function(){
    var rows = [[t('Күні'), t('Түрі'), t('Санат'), t('Сома'), t('Шот'), t('Қай шотқа'), t('Түсініктеме')]];
    var list = page === 'ops' ? opsFiltered() : sortTx(DB.tx.slice());
    list.forEach(function(x){
      var a = acc(x.acc), to = acc(x.to);
      rows.push([x.date, t(x.type === 'in' ? 'Кіріс' : x.type === 'tr' ? 'Аударым' : 'Шығын'), t(x.cat), x.type === 'out' ? -x.amt : x.amt, a ? a.name : '', to ? to.name : '', x.note || '']);
    });
    var ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 11 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 34 }];
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Qarzhy');
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    dl(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'qarzhy-' + todayISO() + '.xlsx');
  }).catch(function(){ toast('Бірінші рет интернет керек'); });
}

/* ================= ІСКЕ ҚОСУ ================= */
function handleShortcut(){
  var m = location.search.match(/[?&]add=(out|in|tr)/);
  if(m){ history.replaceState({}, '', location.pathname + '#home'); setTimeout(function(){ openTx(m[1]); }, 350); }
}
function boot(){
  bootData().then(function(){
    LANG = DB.lang || 'kk';
    document.documentElement.lang = LANG === 'kk' ? 'kk' : LANG;
    applyTheme();
    try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){ if(DB.theme === 'auto') applyTheme(); }); }catch(e){}
    if(location.hash) readHash();
    else { var v = null; try{ v = localStorage.getItem('qarzhy2_view'); }catch(e){} if(v){ var p = v.split('/'); if($('p-' + p[0]) && TABS.indexOf(p[0]) >= 0) page = p[0]; } }
    history.replaceState({}, '', '#' + page + (sub ? '/' + sub : ''));
    show();
    handleShortcut();
    setTimeout(function(){ $('splash').classList.add('out'); setTimeout(function(){ $('splash').remove(); }, 400); }, 250);
    var fxAt = (DB.fx && DB.fx.base === BASE() && DB.fx.at) || null;
    if(!fxAt || (Date.now() - new Date(fxAt)) > 6 * 3600e3) fetchRate(false);
    autoSnap();
    if(DB.pref.notify) registerSync().then(function(){ setTimeout(checkRemindersNow, 2500); });
    try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){}
  });
  $('veil').onclick = function(){ closeSheet(); };
  $('file-backup').onchange = function(){ var f = this.files[0]; this.value = ''; if(f) importBackup(f); };
  $('file-import').onchange = function(){ var f = this.files[0]; this.value = ''; if(f) onImportFile(f); };
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  if('serviceWorker' in navigator && location.protocol === 'https:'){
    var hadCtl = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function(){
      if(!hadCtl || reloaded) return; reloaded = true;
      flush().then(function(){ location.reload(); });
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function(reg){
      reg.update();
      document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible') reg.update(); });
    }).catch(function(){});
  }
}
document.addEventListener('DOMContentLoaded', boot);
