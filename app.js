/* Қаржы — қосымша логикасы
   index.html осы файлды жүктейді. Барлық есептеу осында. */
/* ================= STORAGE ================= */
var mem = {};
var store = {
  get: function(k){ try{ return localStorage.getItem(k); }catch(e){ return k in mem ? mem[k] : null; } },
  set: function(k,v){ try{ localStorage.setItem(k,v); }catch(e){ mem[k]=v; } }
};
var DB = { tx:[], goals:[], accounts:[], btx:[], debts:[], recur:[], budgets:{}, lastBackup:null, lang:'kk', theme:'auto', rate:null, home:null, ver:0 };

function load(){
  try{
    var raw = store.get('qarzhy_v1');
    if(raw){
      var d = JSON.parse(raw);
      DB.tx = d.tx||[]; DB.goals = d.goals||[]; DB.accounts = d.accounts||[]; DB.btx = d.btx||[]; DB.debts = d.debts||[]; DB.recur = d.recur||[];
      DB.budgets = d.budgets||{}; DB.lang = d.lang||'kk'; DB.theme = d.theme||'auto';
      DB.lastBackup = d.lastBackup||null; DB.rate = d.rate||null; DB.home = d.home||null; DB.ver = d.ver||0;
      if(!DB.accounts.length){
        DB.accounts = [{id:'a1',name:'Қолма-қол',kind:'asset',icon:'wallet',bal:d.start||0,start:d.start||0}];
      }
    }
  }catch(e){}
  if(!DB.accounts.length) DB.accounts = [{id:'a1',name:'Қолма-қол',kind:'asset',icon:'wallet',bal:0,start:0}];
}
/* ================= IndexedDB ҚОЙМАСЫ ================= */
/* localStorage шегі ~5 МБ. IndexedDB — жүздеген МБ.
   Дерек әрі IndexedDB-де, әрі (сыйса) localStorage-те қосарланып сақталады. */

var IDB = null, idbBoot = null, idbOK = false;

function idbOpen(){
  if(idbBoot) return idbBoot;
  idbBoot = new Promise(function(res, rej){
    if(!window.indexedDB){ rej(); return; }
    var r;
    try { r = indexedDB.open('qarzhy', 1); } catch(e){ rej(); return; }
    r.onupgradeneeded = function(){
      var db = r.result;
      if(!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = function(){ IDB = r.result; idbOK = true; res(IDB); };
    r.onerror = function(){ rej(); };
    r.onblocked = function(){ rej(); };
  });
  return idbBoot;
}
function idbSet(k, v){
  return idbOpen().then(function(db){
    return new Promise(function(res, rej){
      var tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = function(){ res(); };
      tx.onerror = function(){ rej(); };
      tx.onabort = function(){ rej(); };
    });
  });
}
function idbGet(k){
  return idbOpen().then(function(db){
    return new Promise(function(res, rej){
      var tx = db.transaction('kv', 'readonly');
      var q = tx.objectStore('kv').get(k);
      q.onsuccess = function(){ res(q.result); };
      q.onerror = function(){ rej(); };
    });
  });
}
function idbDel(k){
  return idbOpen().then(function(db){
    return new Promise(function(res){
      var tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(k);
      tx.oncomplete = function(){ res(); };
      tx.onerror = function(){ res(); };
    });
  });
}

/* --- деректі қою --- */
function applyDB(d){
  if(!d) return;
  DB.tx = d.tx || []; DB.goals = d.goals || []; DB.accounts = d.accounts || [];
  DB.btx = d.btx || []; DB.debts = d.debts || []; DB.recur = d.recur || []; DB.budgets = d.budgets || {};
  DB.lastBackup = d.lastBackup || null; DB.lang = d.lang || 'kk';
  DB.theme = d.theme || 'auto'; DB.rate = d.rate || null; DB.home = d.home || null; DB.ver = d.ver || 0;
  DB.updated = d.updated || null;
  if(!DB.accounts.length) DB.accounts = [{id:'a1',name:'Қолма-қол',kind:'asset',icon:'wallet',bal:0,start:0,cur:'KZT'}];
}

var saveTimer = null;
var SAVE_ERR = false, LS_FULL = false;
function save(){
  DB.updated = new Date().toISOString();
  /* localStorage — жеделдігі үшін. Толып қалса қорқынышты емес (негізгі қойма — IndexedDB),
     бірақ үнсіз қалдырмай, жад бөлімінде белгісін көрсетеміз. */
  try { localStorage.setItem('qarzhy_v1', JSON.stringify(DB)); LS_FULL = false; }
  catch(e){ LS_FULL = true; }
  /* IndexedDB — негізгі қойма, 300 мс кідіріспен */
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function(){
    idbSet('db', JSON.parse(JSON.stringify(DB))).then(function(){
      if(SAVE_ERR){ SAVE_ERR = false; drawWarnings(); }
    }).catch(function(){
      /* бұл шын мәнінде қауіпті жағдай — үндемей қалуға болмайды */
      if(!SAVE_ERR){ SAVE_ERR = true; toast('Дерек сақталмады!'); }
      drawWarnings();
    });
  }, 300);
}

/* --- жад көлемі --- */
var STO = { usage: 0, quota: 0, persisted: null };
function refreshStorage(){
  if(!(navigator.storage && navigator.storage.estimate)) return Promise.resolve();
  return navigator.storage.estimate().then(function(e){
    STO.usage = e.usage || 0;
    STO.quota = e.quota || 0;
    drawStorage();
  drawSelBar();
  }).catch(function(){});
}
function fmtBytes(b){
  if(b < 1024) return b + ' Б';
  if(b < 1048576) return (b / 1024).toFixed(1).replace('.', ',') + ' КБ';
  if(b < 1073741824) return (b / 1048576).toFixed(1).replace('.', ',') + ' МБ';
  return (b / 1073741824).toFixed(2).replace('.', ',') + ' ГБ';
}
function drawStorage(){
  var box = document.getElementById('sto-box');
  if(!box) return;
  var pct = STO.quota > 0 ? (STO.usage / STO.quota * 100) : 0;
  var w = Math.max(1, Math.min(100, pct));
  var warn = pct >= 80;
  box.innerHTML =
    '<div class="bar-top"><span>' + fmtBytes(STO.usage) + ' пайдаланылды</span>' +
    '<b>' + (STO.quota ? fmtBytes(STO.quota) + ' қолжетімді' : '') + '</b></div>' +
    '<div class="track"><div class="fill' + (warn ? ' neg' : '') + '" style="width:' + w.toFixed(2) + '%"></div></div>' +
    '<p class="muted" style="margin:10px 0 0">' +
      (idbOK
        ? 'Дерек IndexedDB қоймасында — көлем шегі іс жүзінде шексіз.'
        : 'IndexedDB қолжетімсіз, дерек браузердің қарапайым жадында (шегі ~5 МБ).') +
      (STO.persisted === true ? ' Браузер деректі тұрақты сақтауға келісті.' : '') +
      (warn ? ' <b>Жад толуға жақын — көшірме жасап, ескі жазбаларды тазалаңыз.</b>' : '') +
    '</p>';
}

/* ================= АВТОКӨШІРМЕЛЕР (IndexedDB-де) ================= */
var SNAPS = [];

function loadSnaps(){
  return idbGet('snaps').then(function(v){
    SNAPS = v || [];
    drawSnaps();
  drawStorage();
  drawSelBar();
    return SNAPS;
  }).catch(function(){ SNAPS = []; });
}
function autoSnapshot(){
  var day = todayISO();
  if(!DB.tx.length && !DB.accounts.length) return;
  loadSnaps().then(function(list){
    var has = false;
    list.forEach(function(x){ if(x.day === day) has = true; });
    if(has) return;
    return idbSet('snap:' + day, JSON.parse(JSON.stringify(DB))).then(function(){
      list.push({ day: day, count: DB.tx.length });
      list.sort(function(a, b){ return a.day < b.day ? -1 : 1; });
      var drop = [];
      while(list.length > 7) drop.push(list.shift());
      SNAPS = list;
      drop.forEach(function(x){ idbDel('snap:' + x.day); });
      return idbSet('snaps', list).then(drawSnaps);
    });
  }).catch(function(){});
}
function restoreSnap(day){
  idbGet('snap:' + day).then(function(d){
    if(!d){ toast('Көшірме табылмады'); return; }
    if(!confirm(tr('Осы күнгі күйге қайтарамыз ба?') + ' ' + fullDate(day))) return;
    var back = JSON.parse(JSON.stringify(DB));
    applyDB(d);
    migrateBal();
    save(); render();
    toastUndo('Қайтарылды', function(){
      applyDB(back); recalcBal(); save(); render(); toast('Болдырылмады');
    });
  }).catch(function(){ toast('Көшірме оқылмады'); });
}
function drawSnaps(){
  var box = document.getElementById('snap-list');
  if(!box) return;
  box.innerHTML = '';
  if(!SNAPS.length){
    box.innerHTML = '<div class="muted">Әзірге көшірме жоқ — ертең өзі жасалады.</div>';
    return;
  }
  SNAPS.slice().reverse().forEach(function(x){
    var row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<div class="ico">' + svgIcon('clock') + '</div>' +
      '<div style="flex:1"><div class="name">' + fullDate(x.day) + '</div>' +
      '<div class="sub2">' + x.count + ' операция</div></div>';
    var b = document.createElement('button');
    b.className = 'btn sm ghost';
    b.style.width = 'auto';
    b.style.padding = '9px 14px';
    b.textContent = tr('Қайтару');
    b.onclick = function(){ restoreSnap(x.day); };
    row.appendChild(b);
    box.appendChild(row);
  });
}


/* ================= ВАЛЮТА ЖӘНЕ КУРС ================= */
var RATE_URLS = [
  'https://open.er-api.com/v6/latest/USD',
  'https://api.exchangerate-api.com/v4/latest/USD'
];
var rateBusy = false;

function rateV(){ return (DB.rate && DB.rate.v > 0) ? DB.rate.v : 0; }
function accCurSym(a){ return a && a.cur === 'USD' ? '$' : '₸'; }
/* шот валютасына аудару (кіріс сомасы әрқашан ₸-мен сақталады) */
function toAcc(a, kzt){ return (a && a.cur === 'USD' && rateV() > 0) ? kzt / rateV() : kzt; }
/* шот қалдығын ₸-ге аудару */
function toKZT(a){
  if(!a) return 0;
  if(a.cur === 'USD') return rateV() > 0 ? a.bal * rateV() : a.bal;
  return a.bal;
}
function investedKZT(a){
  var inv = a.invested || 0;
  if(a.cur === 'USD') return rateV() > 0 ? inv * rateV() : inv;
  return inv;
}

function fetchRate(manual){
  if(rateBusy) return;
  rateBusy = true;
  if(manual) toast('Курс жаңартылуда…');
  var i = 0;
  function tryNext(){
    if(i >= RATE_URLS.length){
      rateBusy = false;
      if(manual) toast('Курс алынбады — интернетті тексеріңіз');
      return;
    }
    fetch(RATE_URLS[i++])
      .then(function(r){ return r.json(); })
      .then(function(d){
        var v = d && d.rates && d.rates.KZT;
        if(!v) throw new Error('no kzt');
        DB.rate = { v: v, at: new Date().toISOString(), src: 'auto' };
        save(); rateBusy = false; render();
        if(manual) toast('Курс жаңартылды');
      })
      .catch(function(){ tryNext(); });
  }
  tryNext();
}
function saveRateManual(){
  var v = parseFloat(document.getElementById('set-rate').value);
  if(!v || v <= 0){ toast('Курсты жазыңыз'); return; }
  DB.rate = { v: v, at: new Date().toISOString(), src: 'manual' };
  save(); render(); toast('Курс сақталды');
}
function rateText(){
  if(!rateV()) return 'Курс белгісіз — басып жаңартыңыз';
  return '1 $ = ' + rateV().toFixed(2).replace('.', ',') + ' ₸';
}
function rateAgo(){
  if(!DB.rate || !DB.rate.at) return '';
  var h = (Date.now() - new Date(DB.rate.at).getTime()) / 3600000;
  if(h < 1) return 'жаңа ғана';
  if(h < 24) return Math.round(h) + ' сағат бұрын';
  return Math.round(h / 24) + ' күн бұрын';
}

/* ================= HELPERS ================= */
var CATS = {
  out:[["Тамақ","🍜"],["Көлік","🚌"],["Тұрғын үй","🏠"],["Байланыс","📱"],["Киім","👕"],
       ["Денсаулық","🩺"],["Несие төлемі","💳"],["Ойын-сауық","🎬"],["Білім","📚"],["Сыйлық","🎁"],["Басқа","✦"]],
  in:[["Жалақы","💼"],["Бизнес","📈"],["Фриланс","💻"],["Инвестиция","📊"],["Несие алу","💳"],["Сыйлық","🎁"],["Басқа","✦"]]
};
var ACC_ICONS = ["card","bank","wallet","phone","invest","chart","coin","house"];
function accIconHtml(a, cls){
  var n = a && a.icon;
  if(n && SVGI[n]) return svgIcon(n, cls);
  return '<span style="font-size:19px;line-height:1">' + (n || '') + '</span>';
}
var BRAND = {
  'kaspi bank':      ['K','#F14635'],
  'freedom superapp':['F','#12356B'],
  'halyk bank':      ['H','#00A19A'],
  'jusan bank':      ['J','#F5C518','#1A1A1A'],
  'fortebank':       ['F','#00A0DF'],
  'bereke bank':     ['B','#7B2CBF'],
  'otbasy bank':     ['O','#E30613'],
  'qazaq bank':      ['Q','#0F766E'],
  'қолма-қол':       ['₸','#00BE86']
};
function brandOf(name){
  if(!name) return null;
  var k = String(name).trim().toLowerCase();
  if(BRAND[k]) return BRAND[k];
  for(var b in BRAND){ if(k.indexOf(b.split(' ')[0]) === 0) return BRAND[b]; }
  return null;
}
function accBadge(a, small){
  var b = brandOf(a.name);
  if(!b) return '<div class="ico'+(small?' sm':'')+'">'+accIconHtml(a)+'</div>';
  return '<div class="brand'+(small?' sm':'')+'" style="background:'+b[1]+
         (b[2]?';color:'+b[2]:'')+'">'+b[0]+'</div>';
}

var BANKS = [
  ['Kaspi Bank','card',/kaspi|каспи|каспий/i],
  ['Freedom SuperApp','bank',/freedom|фридом|фрidom/i],
  ['Halyk Bank','bank',/halyk|халык|халық|народный банк/i],
  ['Jusan Bank','card',/jusan|жусан/i],
  ['ForteBank','card',/forte|форте/i],
  ['Bereke Bank','bank',/bereke|береке/i],
  ['Otbasy Bank','house',/otbasy|отбасы|жилстрой/i],
  ['Qazaq Bank','bank',/qazaq|назарбанк/i],
  ['Қолма-қол','wallet',null]
];
function bankExists(name){
  var f=false;
  DB.accounts.forEach(function(a){ if(a.name.toLowerCase()===name.toLowerCase()) f=true; });
  return f;
}
function addBank(name, icon, select){
  if(bankExists(name)){
    if(select) DB.accounts.forEach(function(a){ if(a.name.toLowerCase()===name.toLowerCase()) IMP.acc=a.id; });
  } else {
    var a={id:newId(), name:name, kind:'asset', icon:icon, bal:0};
    DB.accounts.push(a);
    if(select) IMP.acc=a.id;
    save();
  }
  render();
  if(IMP.rows.length) renderImport();
  toast(name+' қосылды');
}
var MONTHS = ["Қаңтар","Ақпан","Наурыз","Сәуір","Мамыр","Маусым","Шілде","Тамыз","Қыркүйек","Қазан","Қараша","Желтоқсан"];
var DAYS = ["Жексенбі","Дүйсенбі","Сейсенбі","Сәрсенбі","Бейсенбі","Жұма","Сенбі"];

function nf(n){ return Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g," "); }
function money(n,c){ return (n<0?"−":"") + nf(n) + " " + (c||"₸"); }
function icon(type,cat){
  var l = CATS[type]; for(var i=0;i<l.length;i++) if(l[i][0]===cat) return l[i][1];
  return type==="in"?"💰":"✦";
}
function iso(d){
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function todayISO(){ return iso(new Date()); }
function parseISO(s){ var p=s.split("-"); return new Date(+p[0],+p[1]-1,+p[2]); }
function dayTitle(s){ var d=parseISO(s); return d.getDate()+" "+MONTHS[d.getMonth()].toLowerCase()+", "+DAYS[d.getDay()]; }
function fullDate(s){ var d=parseISO(s); return d.getDate()+" "+MONTHS[d.getMonth()].toLowerCase()+" "+d.getFullYear(); }
function esc(s){ return String(s).replace(/[<>&]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;"}[c];}); }
function toast(m){ var t=document.getElementById('toast'); t.textContent=(typeof tr==='function'?tr(m):m); t.classList.add('on'); setTimeout(function(){t.classList.remove('on');},1800); }
function acc(id){ for(var i=0;i<DB.accounts.length;i++) if(DB.accounts[i].id===id) return DB.accounts[i]; return null; }
function newId(){ return Date.now().toString()+Math.floor(Math.random()*900+100); }

var cur = new Date(); cur.setDate(1);
function shiftMonth(d){ cur.setMonth(cur.getMonth()+d); render(); }
function inMonth(s){ return s.slice(0,7) === iso(cur).slice(0,7); }

function totals(){
  var b=0,br=0,inv=0,d=0;
  DB.accounts.forEach(function(x){
    if(x.kind==='broker'){ br+=toKZT(x); inv+=investedKZT(x); }
    else if(x.kind==='debt'){ d+=toKZT(x); }
    else { b+=toKZT(x); }
  });
  var dt = (typeof debtTotals === 'function') ? debtTotals() : {lent:0, owed:0};
  return {banks:b, broker:br, invested:inv, assets:b, debts:d,
          lent:dt.lent, owed:dt.owed,
          net:b - d + dt.lent - dt.owed, brokerPL:br-inv};
}
function accsOf(kind){ return DB.accounts.filter(function(a){ return a.kind===kind; }); }
function spendable(){ return DB.accounts.filter(function(a){ return a.kind==='asset'||a.kind==='broker'; }); }

/* ================= NAV ================= */
var view = 'home';
function sheetOpen(){ return !!document.querySelector('.sheet.on'); }

/* ================= ЖАБЫСҚАҚ ТАҚЫРЫП ЖӘНЕ СЕКІРУ ================= */
var PAGE_TITLE = {
  home:'Қаржы', accounts:'Қаржы', ops:'Операциялар', overview:'Шолу',
  stat:'Статистика', goals:'Мақсаттар', calc:'Калькулятор',
  'calc-inv':'Инвестиция калькуляторы', 'calc-loan':'Несие калькуляторы',
  'calc-dep':'Депозит калькуляторы', 'calc-tax':'Салық калькуляторы',
  set:'Баптау', debts:'Қарыздар', sync:'Шотты салыстыру',
  broker:'Брокерлік шот', import:'Файл жүктеу', invest:'Инвестиция', homeset:'Басты бет'
};
/* қай беттен қайда қайту керек */
var PAGE_BACK = {
  accounts:'home', ops:'home', overview:'home', stat:'home', goals:'home', calc:'home',
  'calc-inv':'calc', 'calc-loan':'calc', 'calc-dep':'calc', 'calc-tax':'calc',
  set:'home', debts:'home', sync:'accounts',
  broker:'accounts', import:'home', invest:'accounts', homeset:'home'
};

function pageHeight(){
  var d = document.documentElement, b = document.body;
  return Math.max(d.scrollHeight || 0, b.scrollHeight || 0);
}
function scrollY(){ return window.scrollY || document.documentElement.scrollTop || 0; }
function scrollToY(y){
  try { window.scrollTo({ top: y, behavior: 'smooth' }); }
  catch(e){ window.scrollTo(0, y); }
}
function scrollTop(){ scrollToY(0); }
function scrollBottom(){ scrollToY(pageHeight()); }
function topBack(){ go(PAGE_BACK[view] || 'home'); }
function jumpTo(id){
  var el = document.getElementById(id);
  if(el) el.scrollIntoView({ behavior:'smooth', block:'start' });
}
function syncTopbar(){
  var bar = document.getElementById('topbar');
  if(!bar) return;
  var t = document.getElementById('tb-title');
  if(t){
    var nm = PAGE_TITLE[view] || 'Қаржы';
    if(view === 'broker'){ var ba = acc(brId); if(ba) nm = ba.name; }
    nm = tr(nm);
    if(t.getAttribute('data-nm') !== nm){
      t.setAttribute('data-nm', nm);
      t.innerHTML = '<span class="ar">↑</span>' + esc(nm);
    }
  }
  var y = scrollY();
  bar.classList.toggle('on', y > 96);

  /* Тақырыпты бассаң — беттің басына. Оң жақтағы ↓ — түбіне. */
  var max = Math.max(0, pageHeight() - window.innerHeight);
  var dn = document.getElementById('tb-down');
  if(dn) dn.disabled = (max - y) < 40;
}
var scrollSaveT = null;
window.addEventListener('scroll', function(){
  syncTopbar();
  if(scrollSaveT) clearTimeout(scrollSaveT);
  scrollSaveT = setTimeout(saveView, 400);
}, { passive:true });

var NAV_DEPTH = { home:0, accounts:1, ops:1, overview:1, stat:1, goals:1, calc:1, set:1, debts:1,
  invest:2, broker:2, sync:2, homeset:1, import:2,
  'calc-inv':2, 'calc-loan':2, 'calc-dep':2, 'calc-tax':2 };

function go(v, silent){
  var same = (v === view);
  var back = (NAV_DEPTH[v] || 0) < (NAV_DEPTH[view] || 0);
  view = v;
  var pages = document.querySelectorAll('.page');
  for(var i=0;i<pages.length;i++) pages[i].classList.remove('on','back');
  var el = document.getElementById('p-'+v);
  if(el){
    if(back) el.classList.add('back');
    el.classList.add('on');
  }
  var btns = document.querySelectorAll('.tabbar button');
  for(var j=0;j<btns.length;j++) btns[j].classList.toggle('on', btns[j].dataset.tab===v);
  window.scrollTo(0,0);
  render();
  syncTopbar();

  saveView();
  /* Android-тың «артқа» түймесі қосымшадан шығармай, алдыңғы бетке қайтсын */
  if(!silent && history && history.pushState){
    var st = history.state || {};
    if(same && !st.sheet) history.replaceState({ v: v }, '', '#' + v);
    else history.pushState({ v: v }, '', '#' + v);
  }
}

/* ================= SHEETS ================= */
/* ================= ТЕРЕЗЕНІ СҮЙРЕП ЖАБУ ================= */
/* Тұтқадан ұстап төмен тартсаң, терезе саусақпен бірге жүреді.
   Жарты жолдан асса немесе жылдам сілтесең — жабылады, әйтпесе орнына қайтады. */
function bindSheetDrag(){
  var zones = document.querySelectorAll('.grab-zone');
  for(var i = 0; i < zones.length; i++){
    (function(z){
      var sheet = z.closest ? z.closest('.sheet') : null;
      if(!sheet || z.__bound) return;
      z.__bound = 1;
      var y0 = 0, t0 = 0, dy = 0, on = false;

      function start(e){
        var p = e.touches ? e.touches[0] : e;
        y0 = p.clientY; t0 = Date.now(); dy = 0; on = true;
        sheet.classList.add('drag');
      }
      function move(e){
        if(!on) return;
        var p = e.touches ? e.touches[0] : e;
        dy = Math.max(0, p.clientY - y0);
        sheet.style.transform = 'translateY(' + dy + 'px)';
        if(dy > 2 && e.cancelable) e.preventDefault();
      }
      function end(){
        if(!on) return;
        on = false;
        sheet.classList.remove('drag');
        sheet.style.transform = '';
        var fast = (Date.now() - t0) < 320 && dy > 60;
        if(dy > sheet.offsetHeight * 0.32 || fast){ buzz(10); closeSheets(); }
      }
      z.addEventListener('touchstart', function(e){ start(e); buzz(6); }, { passive:true });
      z.addEventListener('touchmove', move, { passive:false });
      z.addEventListener('touchend', end);
      z.addEventListener('touchcancel', end);
      z.addEventListener('mousedown', function(e){
        start(e);
        function mm(ev){ move(ev); }
        function mu(){ end(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
      });
    })(zones[i]);
  }
}

/* Қысқа дірілмен растау — қолдамайтын құрылғыда үнсіз өтеді */
function buzz(ms){
  try { if(navigator.vibrate) navigator.vibrate(ms || 8); } catch(e){}
}

function openSheet(id){
  var wasOpen = sheetOpen();
  // алдымен барлық ашық терезелерді жабамыз — үстіне-үсті ашылмасын
  var all = document.querySelectorAll('.sheet');
  for(var i=0;i<all.length;i++){
    if(all[i].id !== id) all[i].classList.remove('on');
  }
  document.getElementById('scrim').classList.add('on');
  var el = document.getElementById(id);
  el.scrollTop = 0;
  el.style.transform = '';
  el.classList.add('on');
  if(typeof translateDom==='function') translateDom(el);
  document.body.classList.add('locked');

  if(history && history.pushState){
    var st = { v: view, sheet: id };
    if(wasOpen && history.state && history.state.sheet) history.replaceState(st, '', '#' + view);
    else history.pushState(st, '', '#' + view);
  }
}
function closeSheets(fromPop){
  accEdit = null;
  var had = sheetOpen();
  document.getElementById('scrim').classList.remove('on');
  var s = document.querySelectorAll('.sheet');
  for(var i=0;i<s.length;i++){ s[i].classList.remove('on','drag'); s[i].style.transform = ''; }
  document.body.classList.remove('locked');
  if(!fromPop && had && history && history.state && history.state.sheet){
    history.back();
  }
}

/* ---- transaction ---- */
var fType='out', fCat='Тамақ', fAcc=null, fLoan=null, fTo=null, fEdit=null;
function setType(t){
  fType=t;
  document.getElementById('seg-out').classList.toggle('on', t==='out');
  document.getElementById('seg-in').classList.toggle('on', t==='in');
  document.getElementById('seg-tr').classList.toggle('on', t==='tr');
  document.getElementById('f-cat-box').classList.toggle('hide', t==='tr');
  document.getElementById('f-to-box').classList.toggle('hide', t!=='tr');
  document.getElementById('f-acc-lab').textContent = t==='tr' ? 'Қай шоттан' : (t==='in'?'Қай шотқа түсті':'Қай шоттан');
  if(t!=='tr'){ fCat = CATS[t][0][0]; drawCats(); }
  drawAccs();
}
function drawCats(){
  var box=document.getElementById('f-cats'); box.innerHTML='';
  CATS[fType].forEach(function(c){
    var b=document.createElement('button');
    b.className='chip'+(c[0]===fCat?' on':'');
    b.innerHTML=catSvg(fType,c[0],'chip-ic')+'<span>'+c[0]+'</span>';
    b.onclick=function(){ fCat=c[0]; drawCats(); drawAccs(); };
    box.appendChild(b);
  });
}
function drawAccs(){
  var box=document.getElementById('f-accs'); box.innerHTML='';
  var src = fType==='tr' ? spendable() : accsOf('asset');
  if(!src.length){ box.innerHTML='<div class="muted">Алдымен шот қосыңыз</div>'; }
  var ok=false; src.forEach(function(a){ if(a.id===fAcc) ok=true; });
  if(!ok) fAcc = src.length? src[0].id : null;
  src.forEach(function(a){
    var b=document.createElement('button');
    b.className='chip'+(a.id===fAcc?' on':'');
    var br=brandOf(a.name);
    b.innerHTML=(br?'<span class="brand sm" style="background:'+br[1]+(br[2]?';color:'+br[2]:'')+'">'+br[0]+'</span>'
      :accIconHtml(a,'chip-ic'))+'<span>'+esc(a.name)+'</span>';
    b.onclick=function(){ fAcc=a.id; if(fTo===a.id) fTo=null; drawAccs(); };
    box.appendChild(b);
  });

  var ah=document.getElementById('f-cur-hint');
  var sel=acc(fAcc), selTo=acc(fTo);
  var usd = (sel&&sel.cur==='USD') || (fType==='tr'&&selTo&&selTo.cur==='USD');
  ah.classList.toggle('hide', !usd);
  if(usd) ah.textContent = rateV()
    ? 'Сома ₸-мен енгізіледі, доллар шотына '+rateV().toFixed(2).replace('.',',')+' курсымен аударылады'
    : 'Курс белгісіз — алдымен Баптаудан курсты жаңартыңыз';

  if(fType==='tr'){
    var tb=document.getElementById('f-tos'); tb.innerHTML='';
    var dst = spendable().filter(function(a){ return a.id!==fAcc; });
    var ok2=false; dst.forEach(function(a){ if(a.id===fTo) ok2=true; });
    if(!ok2) fTo = dst.length? dst[0].id : null;
    if(!dst.length) tb.innerHTML='<div class="muted">Кемінде екі шот керек</div>';
    dst.forEach(function(a){
      var b=document.createElement('button');
      b.className='chip'+(a.id===fTo?' on':'');
      b.innerHTML=accIconHtml(a,'chip-ic')+'<span>'+esc(a.name)+'</span>';
      b.onclick=function(){ fTo=a.id; drawAccs(); };
      tb.appendChild(b);
    });
  }
  // несие өтеу
  var loans = DB.accounts.filter(function(a){return a.kind==='debt';});
  var show = (fType==='out' && fCat==='Несие төлемі' && loans.length);
  document.getElementById('f-loan-box').classList.toggle('hide', !show);
  if(show){
    var lb=document.getElementById('f-loans'); lb.innerHTML='';
    if(!fLoan || !acc(fLoan)) fLoan = loans[0].id;
    loans.forEach(function(a){
      var b=document.createElement('button');
      b.className='chip'+(a.id===fLoan?' on':'');
      b.textContent='💳 '+a.name+' · '+money(a.bal);
      b.onclick=function(){ fLoan=a.id; drawAccs(); };
      lb.appendChild(b);
    });
  } else { fLoan=null; }
}
function openTx(editId){
  fEdit = editId || null;
  var t = null;
  if(fEdit) DB.tx.forEach(function(x){ if(x.id===fEdit) t=x; });
  document.getElementById('tx-title').textContent = t ? 'Операцияны түзету' : 'Операция қосу';
  document.getElementById('f-amt').value = t ? t.amt : '';
  document.getElementById('f-note').value = t ? (t.note||'') : '';
  document.getElementById('f-date').value = t ? t.date : todayISO();
  fAcc = t ? t.acc : fAcc;
  fTo  = t ? t.to : null;
  fLoan= t ? t.loan : null;
  setType(t ? t.type : 'out');
  if(t && t.type!=='tr'){ fCat = t.cat; drawCats(); drawAccs(); }
  openSheet('sheet-tx');
}
function saveTx(){
  var amt=parseFloat(document.getElementById('f-amt').value);
  if(!amt || amt<=0){ toast('Соманы жазыңыз'); return; }
  if(!fAcc){ toast('Алдымен шот қосыңыз'); return; }
  if(fType==='tr' && !fTo){ toast('Қай шотқа екенін таңдаңыз'); return; }
  var t={ id:newId(), type:fType, cat:(fType==='tr'?'Аударым':fCat), amt:Math.abs(amt),
    date:document.getElementById('f-date').value||todayISO(),
    note:document.getElementById('f-note').value.trim(), acc:fAcc, loan:fLoan,
    to:(fType==='tr'?fTo:null) };
  stampTx(t);

  if(fEdit){
    var old=null; DB.tx.forEach(function(x){ if(x.id===fEdit) old=x; });
    if(old){
      t.id = old.id;
      if(old.r) t.r = old.r;
      DB.tx = DB.tx.map(function(x){ return x.id===old.id ? t : x; });
      recalcBal();
      fEdit=null;
      save(); closeSheets(); render(); toast('Өзгертілді');
      return;
    }
    fEdit=null;
  }
  DB.tx.push(t);
  recalcBal();
  save(); closeSheets(); render();
  toast(fType==='in'?'Кіріс қосылды':(fType==='tr'?'Аударым жасалды':'Шығын қосылды'));
}
/* ================= ҚАЛДЫҚ — ЕСЕПТЕЛЕТІН САН ================= */
/* Шоттың қалдығы енді жадта жинақталмайды. Ол әр өзгерістен кейін
   a.start (бастапқы қалдық) + барлық жазба бойынша нөлден қайта есептеледі.
   Сол себепті бір операция қате өшсе де, импорт жартылай тоқтаса да,
   қалдық қисайып қалмайды — келесі есептеуде өзі түзеледі. */

function r2(x){ return Math.round((x || 0) * 100) / 100; }

/* Доллар шоты үшін жазба жасалған сәттегі курсты пайдаланамыз.
   Курс өзгергенде ескі жазбалар қайта саналып, қалдық жылжып кетпесін деп. */
function toAccR(a, kzt, r){
  if(!a || a.cur !== 'USD') return kzt;
  var v = r || rateV();
  return v > 0 ? kzt / v : kzt;
}
function usdAcc(id){ var a = acc(id); return !!(a && a.cur === 'USD'); }
/* жазбаға сол сәттегі курсты бекітіп қоямыз (тек доллар шоты қатысса) */
function stampTx(t){
  if(!t.r && (usdAcc(t.acc) || usdAcc(t.to))) t.r = rateV() || null;
  return t;
}

function recalcBal(){
  DB.accounts.forEach(function(a){
    if(a.kind === 'broker') return;
    if(typeof a.start !== 'number') a.start = 0;
    a.bal = a.start;
  });
  /* 1. операциялар */
  DB.tx.forEach(function(t){ applyTx(t, 1); });
  /* 2. жеке қарыздар: беру/алу және өтелген төлемдер */
  (DB.debts || []).forEach(function(d){
    var a = acc(d.acc);
    if(a && a.kind !== 'broker') a.bal += toAccR(a, d.dir === 'out' ? -d.amt : d.amt, d.r);
    (d.hist || []).forEach(function(x){
      var pa = acc(x.acc);
      if(pa && pa.kind !== 'broker') pa.bal += toAccR(pa, d.dir === 'out' ? x.amt : -x.amt, x.r);
    });
  });
  /* 3. мақсатқа шоттан салынған ақша */
  (DB.goals || []).forEach(function(g){
    (g.hist || []).forEach(function(x){
      if(!x.acc) return;
      var a = acc(x.acc);
      if(a && a.kind !== 'broker') a.bal -= toAccR(a, x.amt, x.r);
    });
  });
  DB.accounts.forEach(function(a){ if(a.kind !== 'broker') a.bal = r2(a.bal); });
  syncBrokers();
}

/* Ескі деректі жаңа модельге көшіру: қазіргі қалдықты өзгертпей,
   айырманы a.start-қа жазып қоямыз. Сол себепті сандар бір тиынға да жылжымайды. */
function migrateBal(){
  if(DB.ver >= 2){ recalcBal(); return; }
  var before = {};
  DB.accounts.forEach(function(a){ before[a.id] = a.bal || 0; });
  var rv = rateV() || null;
  DB.tx.forEach(function(t){ if(!t.r && (usdAcc(t.acc) || usdAcc(t.to))) t.r = rv; });
  (DB.debts || []).forEach(function(d){
    if(!d.r && usdAcc(d.acc)) d.r = rv;
    (d.hist || []).forEach(function(x){ if(!x.r && usdAcc(x.acc)) x.r = rv; });
  });
  (DB.goals || []).forEach(function(g){
    (g.hist || []).forEach(function(x){ if(!x.r && x.acc && usdAcc(x.acc)) x.r = rv; });
  });
  DB.accounts.forEach(function(a){ a.start = 0; });
  recalcBal();
  DB.accounts.forEach(function(a){
    if(a.kind === 'broker') return;
    a.start = r2((before[a.id] || 0) - (a.bal || 0));
  });
  DB.ver = 2;
  recalcBal();
}

/* Баптаудағы "қайта есептеу" түймесі — қолмен түзету жолы */
function forceRecalc(){
  recalcBal(); save(); render();
  toast('Қалдық қайта есептелді');
}

function applyTx(t, sign){
  var a=acc(t.acc);
  if(t.type==='tr'){
    var to=acc(t.to);
    if(a) a.bal -= sign * toAccR(a, t.amt, t.r);
    if(to && to.kind !== 'broker') to.bal += sign * toAccR(to, t.amt, t.r);
    return;
  }
  if(a) a.bal += sign * toAccR(a, (t.type==='in' ? t.amt : -t.amt), t.r);
  if(t.loan){
    var l=acc(t.loan);
    if(l) l.bal -= sign * t.amt;   // өтеген сайын несие азаяды
  }
}
var viewId=null;
function openView(id){
  viewId=id;
  var t=null; DB.tx.forEach(function(x){ if(x.id===id) t=x; });
  if(!t) return;
  document.getElementById('v-title').textContent=
    (t.type==='in'?'Кіріс: ':(t.type==='tr'?'Аударым: ':'Шығын: '))+money(t.amt);
  var a=acc(t.acc);
  var h='';
  if(t.type==='tr'){
    var to2=acc(t.to);
    h='<div class="kv"><span>Қайдан</span><b>'+(a?esc(a.name):'—')+'</b></div>'+
      '<div class="kv"><span>Қайда</span><b>'+(to2?esc(to2.name):'—')+'</b></div>'+
      '<div class="kv"><span>Күні</span><b>'+fullDate(t.date)+'</b></div>';
  } else {
    h='<div class="kv"><span>Санат</span><b>'+esc(t.cat)+'</b></div>'+
      '<div class="kv"><span>Күні</span><b>'+fullDate(t.date)+'</b></div>'+
      (a?'<div class="kv"><span>Шот</span><b>'+esc(a.name)+'</b></div>':'');
  }
  if(t.loan){ var l=acc(t.loan); if(l) h+='<div class="kv"><span>Несие</span><b>'+esc(l.name)+'</b></div>'; }
  if(t.note) h+='<div class="kv"><span>Түсініктеме</span><b>'+esc(t.note)+'</b></div>';
  document.getElementById('v-body').innerHTML=h;
  var slot0=document.getElementById('v-extra');
  if(slot0) slot0.innerHTML='<button class="btn line" onclick="openTx(\''+t.id+'\')">Түзету</button>';
  document.getElementById('v-del').textContent='Операцияны өшіру';
  document.getElementById('v-del').onclick=delTx;
  openSheet('sheet-view');
}
function delTx(){
  DB.tx=DB.tx.filter(function(x){return x.id!==viewId;});
  recalcBal();
  save(); closeSheets(); render(); toast('Өшірілді');
}

/* ---- accounts ---- */
var accKind='asset', accIcon='💵', accEdit=null;
var KIND_TITLE={asset:'Банк шоты',broker:'Брокерлік шот',debt:'Несие'};
function openAcc(kind, editId){
  accEdit = editId||null;
  accKind = kind;
  accIcon = kind==='asset'?'card':(kind==='broker'?'invest':'bank');
  var a = accEdit ? acc(accEdit) : null;
  if(a){ accIcon=a.icon; }
  document.getElementById('acc-title').textContent = (a?'Түзету: ':'')+KIND_TITLE[kind]+(a?'':' қосу');
  document.getElementById('ac-bal-lab').textContent =
    kind==='asset'?'Қалдық, ₸':(kind==='broker'?'Портфель құны, ₸':'Несие қалдығы, ₸');
  document.getElementById('ac-name').value = a?a.name:'';
  document.getElementById('ac-bal').value = a?a.bal:'';
  document.getElementById('ac-rate').value = a&&a.rate?a.rate:'';
  document.getElementById('ac-pay').value = a&&a.pay?a.pay:'';
  document.getElementById('ac-inv').value = a&&a.invested?a.invested:'';
  document.getElementById('ac-loan-box').classList.toggle('hide', kind!=='debt');
  document.getElementById('ac-inv-box').classList.add('hide');
  document.getElementById('ac-bal-box').classList.toggle('hide', kind==='broker');
  var bh=document.getElementById('ac-broker-hint');
  if(bh) bh.classList.toggle('hide', kind!=='broker');
  document.getElementById('ac-bank-box').classList.toggle('hide', kind!=='asset');
  document.getElementById('ac-back').textContent = accEdit ? '‹ Артқа' : '‹ Жабу';
  accCur = a && a.cur ? a.cur : 'KZT';
  document.getElementById('ac-cur-box').classList.toggle('hide', kind!=='asset');
  drawCurChips(); drawBankChips(); drawAccIcons(); openSheet('sheet-acc');
}
var accCur='KZT';
function backToAcc(){
  if(accEdit){ var id=accEdit; accEdit=null; openAccView(id); }
  else closeSheets();
}
function drawCurChips(){
  var box=document.getElementById('ac-curs'); box.innerHTML='';
  [['KZT','₸ теңге'],['USD','$ доллар']].forEach(function(c){
    var b=document.createElement('button');
    b.className='chip'+(accCur===c[0]?' on':'');
    b.textContent=c[1];
    b.onclick=function(){
      accCur=c[0];
      if(c[0]==='USD' && !rateV()) fetchRate(true);
      document.getElementById('ac-bal-lab').textContent =
        (accKind==='broker'?'Портфель құны, ':(accKind==='asset'?'Қалдық, ':'Қалдық, ')) + (c[0]==='USD'?'$':'₸');
      drawCurChips();
    };
    box.appendChild(b);
  });
}
function drawBankChips(){
  var box=document.getElementById('ac-banks'); box.innerHTML='';
  var cur=document.getElementById('ac-name').value.trim().toLowerCase();
  BANKS.forEach(function(b){
    var br=brandOf(b[0]);
    var btn=document.createElement('button');
    btn.className='chip'+(cur===b[0].toLowerCase()?' on':'');
    btn.innerHTML=(br
      ? '<span class="brand sm" style="background:'+br[1]+(br[2]?';color:'+br[2]:'')+'">'+br[0]+'</span>'
      : svgIcon(b[1],'chip-ic'))+'<span>'+b[0]+'</span>';
    btn.onclick=function(){
      document.getElementById('ac-name').value=b[0];
      accIcon=b[1]; drawAccIcons(); drawBankChips();
    };
    box.appendChild(btn);
  });
}
function drawAccIcons(){
  var box=document.getElementById('ac-icons'); box.innerHTML='';
  ACC_ICONS.forEach(function(ic){
    var b=document.createElement('button');
    b.className='chip icon-chip'+(ic===accIcon?' on':''); b.innerHTML=svgIcon(ic);
    b.onclick=function(){ accIcon=ic; drawAccIcons(); };
    box.appendChild(b);
  });
}
function saveAcc(){
  var n=document.getElementById('ac-name').value.trim();
  if(!n){ toast('Атауын жазыңыз'); return; }
  var a={ id:newId(), name:n, kind:accKind, icon:accIcon,
    bal:parseFloat(document.getElementById('ac-bal').value)||0 };
  a.start = a.bal;   /* бастапқы қалдық — қалғанын жазбалар есептейді */
  if(accKind==='debt'){
    a.rate=parseFloat(document.getElementById('ac-rate').value)||0;
    a.pay=parseFloat(document.getElementById('ac-pay').value)||0;
  }
  if(accKind==='broker'){
    a.vals = { KZT: 0, USD: 0 };
    a.invested = 0; a.bal = 0; a.valSet = false; a.cur = 'KZT';
  }
  if(accKind==='asset') a.cur=accCur;
  if(accEdit){
    var old=acc(accEdit);
    if(old){
      old.name=a.name; old.icon=a.icon;
      if(accKind!=='broker'){
        /* формадағы сан — қазіргі қалдық. Айырманы бастапқы қалдыққа қосамыз,
           сонда жазбалар тарихы бұзылмайды (сверка осылай жасалады). */
        old.start = r2((old.start || 0) + (a.bal - (old.bal || 0)));
        old.cur = a.cur;
      }
      if(accKind==='debt'){ old.rate=a.rate; old.pay=a.pay; }
      if(accKind==='broker'){ if(!old.vals) old.vals={KZT:0,USD:0}; }
    }
    accEdit=null;
    recalcBal();
    save(); closeSheets(); render(); toast('Сақталды'); return;
  }
  DB.accounts.push(a); recalcBal(); save(); closeSheets(); render();
  toast(KIND_TITLE[accKind]+' қосылды');
}
function openAccView(id){
  var a=acc(id); if(!a) return;
  viewId=id;
  document.getElementById('v-title').textContent=a.name;
  if(a.kind==='broker') syncBroker(a);
  var sym=accCurSym(a);
  var h='<div class="kv"><span>'+(a.kind==='asset'?'Қалдық':(a.kind==='broker'?'Портфель құны':'Несие қалдығы'))+'</span><b>'+
    (a.kind==='broker' ? curPair(bVals(a),true) : money(a.bal,sym))+'</b></div>';
  if(a.cur==='USD') h+='<div class="kv"><span>Теңгемен</span><b>'+money(toKZT(a))+'</b></div>'+
    '<div class="kv"><span>Қолданылған курс</span><b>'+(rateV()?rateV().toFixed(2).replace('.',','):'—')+'</b></div>';
  if(a.kind==='broker'){
    var inv=a.invested||0, pl=a.bal-inv;
    h+='<div class="kv"><span>Салынған қаражат</span><b>'+curPair(bInv(a.id),true)+'</b></div>'+
       '<div class="kv"><span>Табыс / шығын</span><b style="color:'+(pl>=0?'var(--pos)':'var(--neg)')+'">'+
       (pl>=0?'+':'')+money(pl,sym)+(inv>0?' ('+(pl>=0?'+':'−')+Math.abs(Math.round(pl/inv*100))+'%)':'')+'</b></div>';
  }
  if(a.kind==='debt'){
    h+='<div class="kv"><span>Мөлшерлеме</span><b>'+(a.rate||0)+'%</b></div>'+
       '<div class="kv"><span>Ай сайынғы төлем</span><b>'+money(a.pay||0)+'</b></div>';
    if(a.pay>0 && a.bal>0){
      var m=monthsLeft(a.bal,a.rate||0,a.pay);
      h+='<div class="kv"><span>Қалған мерзім</span><b>'+(m>0?m+' ай':'есептелмеді')+'</b></div>';
    }
  }
  var cnt=DB.tx.filter(function(t){return t.acc===id||t.loan===id;}).length;
  h+='<div class="kv"><span>Операция</span><b>'+cnt+'</b></div>';
  document.getElementById('v-body').innerHTML=h;
  var extraBtns='<button class="btn line" onclick="openAcc(\''+a.kind+'\',\''+a.id+'\')">Түзету</button>';
  if(a.kind==='broker'){
    extraBtns='<button class="btn" onclick="openBroker(\''+a.id+'\')">Операцияларын ашу</button>'+
      '<button class="btn line" onclick="openBVal(\''+a.id+'\')">Құнын жаңарту</button>'+extraBtns;
  } else {
    extraBtns='<button class="btn" onclick="accOps(\''+a.id+'\')">Операцияларын көру ('+cnt+')</button>'+extraBtns;
  }
  document.getElementById('v-body').innerHTML=h;
  var slot=document.getElementById('v-extra');
  if(slot) slot.innerHTML=extraBtns;
  document.getElementById('v-del').textContent = 'Өшіру';
  document.getElementById('v-del').onclick=delAcc;
  openSheet('sheet-view');
}
/* Шот бетінен бірден сол шоттың операцияларына өту.
   Бұрын Операциялар бетіне барып, шот белгісін өзің тауып басу керек болатын. */
function accOps(id){
  opsAcc = id; opsFilter = 'all'; opsMonth = null;
  var q = document.getElementById('ops-q'); if(q) q.value = '';
  closeSheets();
  go('ops');
  setTimeout(function(){
    jumpTo('ops-card');
    var chip = document.querySelector('#ops-accs .chip.on');
    if(chip && chip.scrollIntoView) chip.scrollIntoView({ block:'nearest', inline:'center' });
  }, 60);
}

function opsClear(){
  opsAcc = 'all'; opsFilter = 'all'; opsMonth = null;
  var q = document.getElementById('ops-q'); if(q) q.value = '';
  var segs = document.querySelectorAll('[data-of]');
  for(var i = 0; i < segs.length; i++) segs[i].classList.toggle('on', segs[i].dataset.of === 'all');
  render();
}

function delAcc(){
  DB.accounts=DB.accounts.filter(function(a){return a.id!==viewId;});
  DB.tx.forEach(function(t){ if(t.acc===viewId) t.acc=null; if(t.loan===viewId) t.loan=null; });
  save(); closeSheets(); render(); toast('Өшірілді');
}
function monthsLeft(bal, rate, pay){
  var i=rate/12/100, b=bal, n=0;
  while(b>0 && n<600){ b = b*(1+i) - pay; n++; if(pay <= bal*i) return -1; }
  return n;
}

/* ---- брокерлік операциялар ---- */
var BOP = [['dep','Салым','arrDown'],['wd','Шығару','arrUp'],['div','Дивиденд','coin'],['fee','Комиссия · салық','receipt']];
function bopName(t){ for(var i=0;i<BOP.length;i++) if(BOP[i][0]===t) return BOP[i][1]; return t; }
function bopIcon(t){ for(var i=0;i<BOP.length;i++) if(BOP[i][0]===t) return BOP[i][2]; return 'star'; }
function bopSvg(t, cls){ return svgIcon(bopIcon(t), cls); }

/* Брокердің қалдығы мен салынған қаражаты жазбалардан есептеледі (syncBroker),
   сондықтан бұл жерде ештеңе өзгертудің қажеті жоқ. */
function applyBTx(b, sign){ }

/* брокерлік шоттың дивиденд/комиссия жиынтығы */
function brokerStats(id){
  var d=0, f=0, dep=0, wd=0;
  (DB.btx||[]).forEach(function(b){
    if(b.acc!==id) return;
    if(b.t==='div') d+=b.amt;
    else if(b.t==='fee') f+=b.amt;
    else if(b.t==='dep') dep+=b.amt;
    else if(b.t==='wd') wd+=b.amt;
  });
  return { div:d, fee:f, dep:dep, wd:wd };
}

/* салынған қаражатты жазбалардан қайта есептеу */
function recalcInvested(){
  var a=acc(brId); if(!a) return;
  if(!confirm(tr('Портфель құны жазбалардан қайта есептеледі, қолмен қойылған сома жойылады. Жалғастырасыз ба?'))) return;
  a.valSet=false; a.valAt=null;
  syncBroker(a);
  save(); render(); toast('Қайта есептелді');
}

var brId=null, boType='dep', boViewId=null;
function openBroker(id){
  brId=id; go('broker'); saveView();
}
function openBOp(){
  boType='dep';
  document.getElementById('bo-amt').value='';
  document.getElementById('bo-note').value='';
  document.getElementById('bo-date').value=todayISO();
  var a=acc(brId);
  document.getElementById('bo-amt-lab').textContent='Сома';
  drawBOpTypes(); openSheet('sheet-bop');
}
function drawBOpTypes(){
  var box=document.getElementById('bo-types'); box.innerHTML='';
  BOP.forEach(function(t){
    var b=document.createElement('button');
    b.className='chip'+(boType===t[0]?' on':'');
    b.innerHTML=svgIcon(t[2],'chip-ic')+'<span>'+t[1]+'</span>';
    b.onclick=function(){ boType=t[0]; drawBOpTypes(); };
    box.appendChild(b);
  });
}
function saveBOp(){
  var v=parseFloat(document.getElementById('bo-amt').value);
  if(!v||v<=0){ toast('Соманы жазыңыз'); return; }
  var b={id:newId(), acc:brId, t:boType, amt:v,
    date:document.getElementById('bo-date').value||todayISO(),
    note:document.getElementById('bo-note').value.trim()};
  DB.btx.push(b); applyBTx(b,1);
  save(); closeSheets(); render(); toast(bopName(boType)+' қосылды');
}
function openBView(id){
  var b=null; DB.btx.forEach(function(x){ if(x.id===id) b=x; });
  if(!b) return;
  boViewId=id;
  var sym = (b.cur==='USD') ? '$' : '₸';
  document.getElementById('v-title').textContent=bopName(b.t)+': '+money(b.amt,sym);
  document.getElementById('v-body').innerHTML=
    '<div class="kv"><span>Түрі</span><b>'+bopName(b.t)+'</b></div>'+
    '<div class="kv"><span>Күні</span><b>'+fullDate(b.date)+'</b></div>'+
    (b.note?'<div class="kv"><span>Түсініктеме</span><b>'+esc(b.note)+'</b></div>':'');
  var slot=document.getElementById('v-extra'); if(slot) slot.innerHTML='';
  document.getElementById('v-del').textContent='Операцияны өшіру';
  document.getElementById('v-del').onclick=function(){
    var x=null; DB.btx.forEach(function(y){ if(y.id===boViewId) x=y; });
    if(x) applyBTx(x,-1);
    DB.btx=DB.btx.filter(function(y){ return y.id!==boViewId; });
    save(); closeSheets(); render(); toast('Өшірілді');
  };
  openSheet('sheet-view');
}
function delBrokerAcc(){
  if(!confirm('Бұл брокерлік шот пен оның операциялары өшіріледі. Жалғастырасыз ба?')) return;
  DB.btx=DB.btx.filter(function(b){ return b.acc!==brId; });
  DB.accounts=DB.accounts.filter(function(a){ return a.id!==brId; });
  DB.tx.forEach(function(t){ if(t.to===brId) t.to=null; });
  save(); go('accounts'); toast('Өшірілді');
}
function renderBroker(){
  var a=acc(brId);
  if(!a){ return; }
  syncBroker(a);
  var v=bVals(a), inv=bInv(brId), df=bDivFee(brId);
  var invT=kztOf(inv), pl=a.bal-invT;
  document.getElementById('br-name').textContent=a.name;
  document.getElementById('br-val').textContent=curPair(v, true);
  document.getElementById('br-inv').textContent=curPair(inv, true);
  var ple=document.getElementById('br-pl');
  ple.textContent=(pl>=0?'+':'')+money(pl,'₸')+(invT>0?' ('+(pl>=0?'+':'−')+Math.abs(Math.round(pl/invT*100))+'%)':'');
  ple.style.color = pl>=0?'#7CF2CE':'#FFA8B3';

  var info=document.getElementById('br-info');
  if(info){
    var block = '';
    ['USD','KZT'].forEach(function(c){
      var sg = c === 'USD' ? '$' : '₸';
      if(!v[c] && !inv[c] && !df[c].div && !df[c].fee) return;
      var p = v[c] - inv[c];
      block +=
        '<label class="f" style="margin-top:12px">' + (c === 'USD' ? 'Доллар' : 'Теңге') + '</label>' +
        '<div class="kv"><span>Портфель құны</span><b>' + nf(v[c]) + ' ' + sg + '</b></div>' +
        '<div class="kv"><span>Салынған</span><b>' + nf(inv[c]) + ' ' + sg + '</b></div>' +
        '<div class="kv"><span>Табыс</span><b style="color:' + (p >= 0 ? 'var(--pos)' : 'var(--neg)') + '">' +
          (p >= 0 ? '+' : '−') + nf(p) + ' ' + sg +
          (inv[c] > 0 ? ' (' + (p >= 0 ? '+' : '−') + Math.abs(Math.round(p / inv[c] * 100)) + '%)' : '') + '</b></div>' +
        (df[c].div ? '<div class="kv"><span>Дивиденд · купон</span><b style="color:var(--pos)">+' + nf(df[c].div) + ' ' + sg + '</b></div>' : '') +
        (df[c].fee ? '<div class="kv"><span>Комиссия · салық</span><b style="color:var(--neg)">−' + nf(df[c].fee) + ' ' + sg + '</b></div>' : '');
    });
    info.innerHTML = block +
      '<label class="f" style="margin-top:14px">Барлығы теңгемен</label>' +
      '<div class="kv"><span>Портфель құны</span><b>' + money(a.bal) + '</b></div>' +
      '<div class="kv"><span>Салынған қаражат</span><b>' + money(invT) + '</b></div>' +
      '<div class="kv"><span>Курс</span><b>' + (rateV() ? '1 $ = ' + rateV().toFixed(2).replace('.', ',') + ' ₸' : '—') + '</b></div>' +
      '<div class="kv"><span>Құн көзі</span><b>' +
        (a.valSet ? tr('қолмен қойылған') + (a.valAt ? ' · ' + fullDate(a.valAt) : '') : tr('жазбалардан есептелген')) +
      '</b></div>';
  }

  var ops=DB.btx.filter(function(b){ return b.acc===brId; });
  var trs=DB.tx.filter(function(t){ return t.type==='tr' && t.to===brId; });
  var box=document.getElementById('br-list'); box.innerHTML='';
  document.getElementById('br-count').textContent=(ops.length+trs.length)+' жазба';
  var all=[];
  ops.forEach(function(b){ all.push({date:b.date, kind:'b', o:b}); });
  trs.forEach(function(t){ all.push({date:t.date, kind:'t', o:t}); });
  all.sort(function(x,y){ return x.date<y.date?1:-1; });
  if(!all.length){ box.innerHTML='<div class="empty">Жазба жоқ.<br>Файл жүктеңіз немесе қолмен қосыңыз.</div>'; return; }
  all.forEach(function(it){
    var row=document.createElement('div'); row.className='row';
    if(it.kind==='b'){
      var b=it.o, plus=(b.t==='dep'||b.t==='div');
      var pickB = selActive('btx');
      row.onclick = pickB ? function(){ selTog(b.id); } : function(){ openBView(b.id); };
      row.innerHTML=(pickB?selBox(b.id):'')+'<div class="ico'+(plus?' pos':' red')+'">'+bopSvg(b.t)+'</div>'+
        '<div style="min-width:0;flex:1"><div class="name">'+bopName(b.t)+'</div>'+
        '<div class="sub2">'+fullDate(b.date)+(b.note?' · '+esc(b.note):'')+'</div></div>'+
        '<div class="amt" style="color:'+(plus?'var(--pos)':'var(--neg)')+'">'+
        (plus?'+':'−')+nf(b.amt)+' '+(b.cur==='USD'?'$':'₸')+'</div>';
    } else {
      var t=it.o, from=acc(t.acc);
      row.onclick=function(){ openView(t.id); };
      row.innerHTML=(pick?selBox(t.id):'')+'<div class="ico blue">'+svgIcon('swap')+'</div>'+
        '<div style="min-width:0;flex:1"><div class="name">Банктен аударым</div>'+
        '<div class="sub2">'+fullDate(t.date)+' · '+(from?esc(from.name):'—')+'</div></div>'+
        '<div class="amt" style="color:var(--blue)">+'+nf(t.amt)+' ₸</div>';
    }
    box.appendChild(row);
  });
}

/* ---- брокер құны ---- */
var bvId=null;
function openBVal(id){
  var a=acc(id); if(!a) return;
  bvId=id;
  document.getElementById('bv-title').textContent=a.name+' — құнын жаңарту';
  var v0=bVals(a);
  document.getElementById('bv-usd').value = v0.USD || '';
  document.getElementById('bv-kzt').value = v0.KZT || '';
  openSheet('sheet-bval');
}
function saveBVal(){
  var a=acc(bvId); if(!a) return;
  var u=parseFloat(document.getElementById('bv-usd').value);
  var k=parseFloat(document.getElementById('bv-kzt').value);
  if(isNaN(u) && isNaN(k)){ toast('Соманы жазыңыз'); return; }
  var v=bVals(a);
  v.USD = isNaN(u) ? 0 : u;
  v.KZT = isNaN(k) ? 0 : k;
  a.valSet=true; a.valAt=todayISO();
  syncBroker(a);
  save(); closeSheets(); render(); toast('Жаңартылды');
}

/* ---- жылдам баптау ---- */


/* ---- goals ---- */
var goalId=null;
function openGoal(){
  document.getElementById('g-name').value='';
  document.getElementById('g-target').value='';
  document.getElementById('g-saved').value='';
  openSheet('sheet-goal');
}
function saveGoal(){
  var n=document.getElementById('g-name').value.trim();
  var t=parseFloat(document.getElementById('g-target').value);
  if(!n){ toast('Атауын жазыңыз'); return; }
  if(!t||t<=0){ toast('Мақсат сомасын жазыңыз'); return; }
  DB.goals.push({id:newId(),name:n,target:t,saved:parseFloat(document.getElementById('g-saved').value)||0});
  save(); closeSheets(); render(); toast('Мақсат қосылды');
}
var gvAcc=null;
function goal(id){ var r=null; DB.goals.forEach(function(x){ if(x.id===id) r=x; }); return r; }

function openGview(id){
  goalId=id;
  var g=goal(id);
  if(!g) return;
  document.getElementById('gv-title').textContent=g.name;
  document.getElementById('gv-add').value='';
  var pct=Math.min(100,Math.round(g.saved/g.target*100));
  document.getElementById('gv-sum').innerHTML=
    '<div class="kv"><span>Жиналған</span><b>'+money(g.saved)+' / '+money(g.target)+'</b></div>'+
    '<div class="kv"><span>Орындалды</span><b>'+pct+'%</b></div>'+
    '<div class="kv"><span>Қалды</span><b>'+money(Math.max(0,g.target-g.saved))+'</b></div>';
  drawGvAccs(); drawGvHist();
  openSheet('sheet-gview');
}
function drawGvAccs(){
  var box=document.getElementById('gv-accs'); box.innerHTML='';
  var list=spendable();
  var ok=false; list.forEach(function(a){ if(a.id===gvAcc) ok=true; });
  if(!ok) gvAcc = list.length? list[0].id : null;
  list.forEach(function(a){
    var b=document.createElement('button');
    b.className='chip'+(gvAcc===a.id?' on':'');
    b.innerHTML=accIconHtml(a,'chip-ic')+'<span>'+esc(a.name)+'</span>';
    b.onclick=function(){ gvAcc=a.id; drawGvAccs(); };
    box.appendChild(b);
  });
  var none=document.createElement('button');
  none.className='chip'+(!gvAcc?' on':'');
  none.textContent='Шотсыз — тек белгілеу';
  none.onclick=function(){ gvAcc=null; drawGvAccs(); };
  box.appendChild(none);
}
function drawGvHist(){
  var box=document.getElementById('gv-hist'); box.innerHTML='';
  var g=goal(goalId);
  if(!g || !g.hist || !g.hist.length) return;
  var h='<label class="f" style="margin-top:8px">Салым тарихы</label>';
  g.hist.slice().reverse().slice(0,8).forEach(function(x){
    var a=x.acc?acc(x.acc):null;
    h+='<div class="kv"><span>'+fullDate(x.date)+' · '+(a?esc(a.name):'Шотсыз')+'</span><b>+'+nf(x.amt)+' ₸</b></div>';
  });
  box.innerHTML=h;
}
function addToGoal(){
  var v=parseFloat(document.getElementById('gv-add').value);
  if(!v || v<=0){ toast('Соманы жазыңыз'); return; }
  var g=goal(goalId);
  if(!g) return;
  g.saved += v;
  g.hist = g.hist || [];
  g.hist.push({ date: todayISO(), acc: gvAcc || null, amt: v, r: usdAcc(gvAcc) ? (rateV() || null) : null });
  recalcBal();
  save(); closeSheets(); render();
  toast(gvAcc ? (acc(gvAcc).name+' шотынан алынды') : 'Салым қосылды');
}
function delGoal(){
  DB.goals=DB.goals.filter(function(g){return g.id!==goalId;});
  recalcBal();
  save(); closeSheets(); render(); toast('Өшірілді');
}

/* ---- settings ---- */
function exportData(){
  var blob=new Blob([JSON.stringify(DB,null,2)],{type:'application/json'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='qarzhy-'+todayISO()+'.json'; a.click();
  DB.lastBackup=new Date().toISOString(); save(); render();
}
/* ---- көшірмені тексеру ----
   Бұрын кез келген JSON файл бүкіл базаны үнсіз ауыстырып жіберетін.
   Енді: құрылымы тексеріледі, ішіндегісі көрсетіліп расталады,
   ауыстырар алдында қазіргі күй бөлек көшірмеге жазылады. */
function checkBackup(d){
  if(!d || typeof d !== 'object' || Array.isArray(d)) return 'Файл құрылымы дұрыс емес';
  if(!Array.isArray(d.tx) && !Array.isArray(d.accounts)) return 'Бұл Қаржы көшірмесі емес';
  var arrs = ['tx','goals','accounts','btx','debts','recur'], i;
  for(i = 0; i < arrs.length; i++){
    if(d[arrs[i]] !== undefined && !Array.isArray(d[arrs[i]])) return 'Файлдың ішіндегі дерек бүлінген';
  }
  if(d.budgets !== undefined && (typeof d.budgets !== 'object' || Array.isArray(d.budgets)))
    return 'Файлдың ішіндегі дерек бүлінген';
  var bad = 0;
  (d.tx || []).forEach(function(t){
    if(!t || typeof t.amt !== 'number' || !isFinite(t.amt) || !t.date || !t.type) bad++;
  });
  (d.accounts || []).forEach(function(a){ if(!a || !a.id || !a.name) bad++; });
  if(bad) return bad + ' жазба бүлінген';
  return null;
}

/* ---- Excel үшін CSV ---- */
/* статистика есебінің жолдары — экрандағы сандардан жиналады */
function statRows(){
  var TYPE = { in: 'Кіріс', out: 'Шығын' };
  var list = DB.tx.filter(function(t){ return inRange(t.date) && t.type !== 'tr'; });
  var sIn = 0, sOut = 0, sums = { in: {}, out: {} };
  list.forEach(function(t){
    if(t.type === 'in') sIn += t.amt; else sOut += t.amt;
    sums[t.type][t.cat] = (sums[t.type][t.cat] || 0) + t.amt;
  });
  var rows = [
    ['Кезең', (range.from || '') + ' — ' + (range.to || '')],
    ['Кіріс', Math.round(sIn)],
    ['Шығын', Math.round(sOut)],
    ['Нәтиже', Math.round(sIn - sOut)],
    []
  ];
  ['out', 'in'].forEach(function(ty){
    var ks = Object.keys(sums[ty]).sort(function(a, b){ return sums[ty][b] - sums[ty][a]; });
    if(!ks.length) return;
    rows.push([TYPE[ty] + ' санаттары', 'Сома', 'Үлесі']);
    var tot = ty === 'in' ? sIn : sOut;
    ks.forEach(function(k){
      rows.push([k, Math.round(sums[ty][k]), (tot ? Math.round(sums[ty][k] / tot * 100) : 0) + '%']);
    });
    rows.push([]);
  });
  rows.push(['Операциялар', '', '', '', '']);
  rows.push(['Күні', 'Түрі', 'Санат', 'Сома', 'Шот']);
  list.slice().sort(function(a, b){ return a.date < b.date ? -1 : 1; }).forEach(function(t){
    var a = acc(t.acc);
    rows.push([t.date, TYPE[t.type], t.cat || '', Math.round(t.amt), a ? a.name : '']);
  });
  return rows;
}

function csvCell(v){
  v = (v === null || v === undefined) ? '' : String(v);
  return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function exportCSV(){
  var TYPE = { in: 'Кіріс', out: 'Шығын', tr: 'Аударым' };
  var rows = [['Күні', 'Түрі', 'Санат', 'Сома', 'Шот', 'Қайда', 'Ескертпе']];
  DB.tx.slice().sort(function(a, b){ return a.date < b.date ? -1 : 1; }).forEach(function(t){
    var a = acc(t.acc), to = acc(t.to);
    rows.push([t.date, TYPE[t.type] || t.type, t.cat || '', Math.round(t.amt),
               a ? a.name : '', to ? to.name : '', t.note || '']);
  });
  /* Excel нүктелі үтірді бағанға бөледі, BOM — кириллица мен қазақ әрпі үшін */
  var csv = '\ufeff' + rows.map(function(r){ return r.map(csvCell).join(';'); }).join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var a2 = document.createElement('a');
  a2.href = URL.createObjectURL(blob);
  a2.download = 'qarzhy-' + todayISO() + '.csv';
  a2.click();
  setTimeout(function(){ URL.revokeObjectURL(a2.href); }, 4000);
  toast(DB.tx.length + ' операция шығарылды');
}

/* ---- көшірмені бірден жіберу (Telegram, Drive, пошта) ---- */
function shareBackup(){
  var txt = JSON.stringify(DB, null, 2);
  var name = 'qarzhy-' + todayISO() + '.json';
  var f = null;
  try { f = new File([txt], name, { type: 'application/json' }); } catch(e){}
  if(f && navigator.canShare && navigator.canShare({ files: [f] })){
    navigator.share({ files: [f], title: name }).then(function(){
      DB.lastBackup = new Date().toISOString(); save(); render();
    }).catch(function(){});
    return;
  }
  exportData();   /* қолдамаса — әдеттегідей жүктеп аламыз */
}

function importData(el){
  var f = el.files[0];
  if(!f){ return; }
  var r = new FileReader();
  r.onerror = function(){ el.value = ''; alert(tr('Файл оқылмады')); };
  r.onload = function(){
    var d = null;
    try { d = JSON.parse(r.result); }
    catch(e){ el.value = ''; alert(tr('Файл оқылмады') + ' — JSON емес.'); return; }

    var err = checkBackup(d);
    if(err){ el.value = ''; alert(tr('Файл жарамсыз') + ': ' + tr(err)); return; }

    var when = d.updated ? fullDate(String(d.updated).slice(0, 10)) : tr('белгісіз');
    var msg = tr('Көшірмедегі дерек:') + '\n' +
      '• ' + (d.tx || []).length + ' ' + tr('операция') + '\n' +
      '• ' + (d.accounts || []).length + ' ' + tr('шот') + '\n' +
      '• ' + (d.debts || []).length + ' ' + tr('қарыз') + ' · ' + (d.goals || []).length + ' ' + tr('мақсат') + '\n' +
      tr('Жазылған күні') + ': ' + when + '\n\n' +
      tr('Қазіргі дерегіңіз') + ': ' + DB.tx.length + ' ' + tr('операция') + '.\n' +
      tr('Ол ауыстырылады. Жалғастырасыз ба?');
    if(!confirm(msg)){ el.value = ''; return; }

    /* артқа қайтару үшін қазіргі күйді сақтап аламыз */
    var back = JSON.parse(JSON.stringify(DB));
    idbSet('snap:import-' + todayISO(), back).catch(function(){});

    applyDB(d);
    migrateBal();
    save(); render();
    el.value = '';
    toastUndo('Қалпына келтірілді', function(){
      applyDB(back); recalcBal(); save(); render(); toast('Қайтарылды');
    });
  };
  r.readAsText(f);
}
function wipe(){
  if(!confirm('Барлық дерек өшіріледі. Жалғастырасыз ба?')) return;
  DB={tx:[],goals:[],accounts:[{id:'a1',name:'Қолма-қол',kind:'asset',icon:'wallet',bal:0,start:0,cur:'KZT'}],
      btx:[],debts:[],recur:[],budgets:{},lastBackup:DB.lastBackup,lang:DB.lang,
      theme:DB.theme,home:DB.home,rate:DB.rate,ver:2};
  SNAPS.forEach(function(x){ idbDel('snap:'+x.day); });
  SNAPS=[]; idbSet('snaps',[]).catch(function(){});
  save(); render(); toast('Өшірілді');
}

/* ================= FILTERS ================= */
var opsFilter='all', opsAcc='all', statFilter='all', period='month';
var range={from:null,to:null};
var opsMonth = null;   /* 'YYYY-MM' — тек сол айды көрсету, null болса бәрі */
function setOpsFilter(f){
  opsFilter=f;
  document.querySelectorAll('[data-of]').forEach(function(b){ b.classList.toggle('on', b.dataset.of===f); });
  render();
}
function setStatFilter(f){
  statFilter=f;
  document.querySelectorAll('[data-sf]').forEach(function(b){ b.classList.toggle('on', b.dataset.sf===f); });
  render();
}
function setPeriod(p){
  period=p;
  document.querySelectorAll('[data-per]').forEach(function(b){ b.classList.toggle('on', b.dataset.per===p); });
  var now=new Date(), f, t=new Date();
  if(p==='day'){ f=new Date(); }
  else if(p==='week'){ f=new Date(); f.setDate(f.getDate()-6); }
  else if(p==='month'){ f=new Date(now.getFullYear(),now.getMonth(),1); }
  else { f=new Date(now.getFullYear(),now.getMonth()-1,1); t=new Date(now.getFullYear(),now.getMonth(),0); }
  range.from=iso(f); range.to=iso(t);
  document.getElementById('s-from').value=range.from;
  document.getElementById('s-to').value=range.to;
  render();
}
function customRange(){
  range.from=document.getElementById('s-from').value;
  range.to=document.getElementById('s-to').value;
  document.querySelectorAll('[data-per]').forEach(function(b){ b.classList.remove('on'); });
  render();
}
function inRange(d){ return (!range.from || d>=range.from) && (!range.to || d<=range.to); }

/* ================= АЙ СОҢЫНА БОЛЖАМ ================= */
/* Осы айдағы нақты қарқын + әлі келмеген тұрақты операциялар.
   Тұрақты операциялар орташа есепке қосылмайды (олар бөлек саналады),
   әйтпесе бір төлем екі рет есептеліп кетер еді. */
function forecast(){
  var d = new Date(), day = d.getDate(), dim = daysInYM(ymOf(todayISO()));
  var rest = Math.max(0, dim - day);
  var mIn = 0, mOut = 0, freeOut = 0;
  DB.tx.forEach(function(t){
    if(!inMonth(t.date) || t.type === 'tr') return;
    if(t.type === 'in') mIn += t.amt;
    else { mOut += t.amt; if(!t.rec) freeOut += t.amt; }
  });
  var avg = day > 0 ? freeOut / day : 0;
  var planIn = 0, planOut = 0;
  var restOut = avg * rest;
  var T = totals();
  return {
    day: day, dim: dim, rest: rest,
    inNow: mIn, outNow: mOut, avg: avg,
    planIn: planIn, planOut: planOut,
    endIn: mIn + planIn, endOut: mOut + restOut,
    endBal: T.banks + planIn - restOut,
    now: T.banks
  };
}

/* ================= МАҚСАТҚА ЖЕТУ МЕРЗІМІ ================= */
/* Соңғы 3 айдағы нақты қарқын бойынша. Қарқын жоқ болса — болжам да жоқ. */
function goalETA(g){
  var left = (g.target || 0) - (g.saved || 0);
  if(left <= 0) return { done: true };
  var lim = new Date(); lim.setMonth(lim.getMonth() - 3);
  var from = lim.toISOString().slice(0, 10), sum = 0;
  (g.hist || []).forEach(function(x){ if(x.date >= from) sum += x.amt; });
  if(sum <= 0) return { rate: 0 };
  var per = sum / 3;
  var months = Math.ceil(left / per);
  if(months > 600) return { rate: per, far: true };
  var e = new Date(); e.setDate(1); e.setMonth(e.getMonth() + months);
  return { rate: per, months: months, when: MONTHS[e.getMonth()] + ' ' + e.getFullYear() };
}

/* ================= RENDER ================= */
/* Бұрын render() әр өзгерісте барлық бетті — статистиканы, калькуляторларды,
   көрінбей тұрған тізімдерді — қайта сызатын. Енді әр бөлім өз беті ашық
   тұрғанда ғана сызылады. go() әр ауысқанда render() шақырады, сондықтан
   бет ашылған сәтте деректің жаңасы болады. */
function on(v){ return view === v; }

function render(){
  syncBrokers();
  if(on('broker')) renderBroker();
  var T=totals();
  var mTx=DB.tx.filter(function(t){return inMonth(t.date) && t.type!=='tr';});
  var mIn=0,mOut=0; mTx.forEach(function(t){ if(t.type==='in') mIn+=t.amt; else mOut+=t.amt; });

  /* --- home --- */
  if(on('home')){
  animNum(document.getElementById('h-net'), T.net);
  var pill=document.getElementById('h-pill');
  pill.textContent = T.net>=0?'↑ Оң':'↓ Теріс';
  pill.style.color = T.net>=0?'#7CF2CE':'#FFA8B3';
  document.getElementById('h-month').textContent=MONTHS[cur.getMonth()]+' '+cur.getFullYear();
  document.getElementById('h-in').textContent=money(mIn);
  document.getElementById('h-out').textContent=money(mOut);
  document.getElementById('h-banks').textContent=money(T.banks);
  document.getElementById('h-broker').textContent=money(T.broker);
  document.getElementById('h-debts').textContent=money(T.debts);
  var hl=document.getElementById('h-lent'), ho=document.getElementById('h-owed');
  if(hl) hl.textContent=money(T.lent);
  if(ho) ho.textContent=money(T.owed);
  document.getElementById('h-net2').textContent=money(T.net);
  var openDebts = (DB.debts||[]).filter(function(d){ return debtLeft(d) > 0; }).length;
  document.getElementById('acc-count').textContent=
    accsOf('asset').length+' банк · '+accsOf('broker').length+' брокер'+
    (openDebts ? ' · '+openDebts+' қарыз' : '');
  document.getElementById('h-rate').textContent=rateText();
  document.getElementById('h-rate-at').textContent = rateV()? (rateAgo()+' · ↻') : '↻';
  var recent=DB.tx.slice().sort(function(a,b){return a.date<b.date?1:-1;}).slice(0,5);
  var hb=document.getElementById('home-tx'); hb.innerHTML='';
  if(!recent.length) hb.innerHTML='<div class="empty">Операция жоқ.<br>Жоғарыдағы <b>+</b> түймесімен қосыңыз.</div>';
  else recent.forEach(function(t){ hb.appendChild(txRow(t)); });
  applyHome();
  renderHomeWidgets();
  drawWarnings();
  }

  /* --- accounts --- */
  if(on('accounts')){
  document.getElementById('a-count').textContent=DB.accounts.length+' шот';
  animNum(document.getElementById('a-net'), T.net);
  document.getElementById('a-banks').textContent=money(T.banks);
  document.getElementById('a-broker').textContent=money(T.broker);
  document.getElementById('a-debts').textContent=money(T.debts);
  document.getElementById('a-sum-bank').textContent=money(T.banks);
  var pl=T.broker-T.invested;
  document.getElementById('a-sum-broker').textContent=
    T.invested>0 ? money(T.broker)+'  ('+(pl>=0?'+':'−')+nf(Math.abs(pl))+' ₸)' : money(T.broker);
  document.getElementById('a-sum-debt').textContent=money(T.debts);
  renderAccList('asset','a-list-asset','Банк шоты жоқ. Төмендегі түймемен қосыңыз.');
  renderAccList('broker','a-list-broker','Брокерлік шот жоқ. Инвестицияңызды осында қосыңыз.');
  renderAccList('debt','a-list-debt','Несие жоқ — тамаша.');
  }

  /* --- ops --- */
  if(on('ops')){
  var q=(document.getElementById('ops-q').value||'').trim().toLowerCase();
  var ops=DB.tx.filter(function(t){
    if(opsFilter!=='all' && t.type!==opsFilter) return false;
    if(opsAcc!=='all' && t.acc!==opsAcc && t.to!==opsAcc) return false;
    if(opsMonth && t.date.slice(0,7)!==opsMonth) return false;
    if(q){
      var hay=((t.cat||'')+' '+(t.note||'')+' '+Math.round(t.amt)).toLowerCase();
      if(hay.indexOf(q)===-1) return false;
    }
    return true;
  }).sort(function(a,b){return a.date<b.date?1:-1;});

  var oIn=0,oOut=0;
  ops.forEach(function(t){ if(t.type==='in') oIn+=t.amt; else if(t.type==='out') oOut+=t.amt; });
  var fAccName = opsAcc!=='all' ? (acc(opsAcc) ? acc(opsAcc).name : '') : '';
  var fMonth = opsMonth ? MONTHS[parseInt(opsMonth.slice(5,7),10)-1]+' '+opsMonth.slice(0,4) : '';
  var anyF = q||opsAcc!=='all'||opsFilter!=='all'||opsMonth;
  document.getElementById('o-count').textContent = anyF
      ? (fMonth ? fMonth+' · ' : '')+(fAccName ? fAccName+' · ' : '')+
        ops.length+' табылды · +'+nf(oIn)+' / −'+nf(oOut)+' ₸'
      : DB.tx.length+' операция';
  var clr = document.getElementById('ops-clear');
  if(clr) clr.classList.toggle('hide', !anyF);

  var oab=document.getElementById('ops-accs'); oab.innerHTML='';
  var oaList=[{id:'all',name:'Барлық шот',icon:'◎'}].concat(DB.accounts);
  oaList.forEach(function(a){
    var b=document.createElement('button');
    b.className='chip'+(opsAcc===a.id?' on':'');
    var obr = a.id==='all' ? null : brandOf(a.name);
    b.innerHTML=(a.id==='all'
      ? svgIcon('grid','chip-ic')
      : (obr ? '<span class="brand sm" style="background:'+obr[1]+(obr[2]?';color:'+obr[2]:'')+'">'+obr[0]+'</span>'
             : accIconHtml(a,'chip-ic')))+'<span>'+esc(a.name)+'</span>';
    b.onclick=function(){ opsAcc=a.id; render(); };
    oab.appendChild(b);
  });
  OPS_IDS = ops.map(function(t){ return t.id; });
  var ol=document.getElementById('ops-list'); ol.innerHTML='';
  if(!ops.length) ol.innerHTML='<div class="empty">Операция табылмады.</div>';
  else {
    var byDay={};
    ops.forEach(function(t){ (byDay[t.date]=byDay[t.date]||[]).push(t); });
    Object.keys(byDay).sort().reverse().forEach(function(d){
      var sum=0; byDay[d].forEach(function(t){ if(t.type==='in') sum+=t.amt; else if(t.type==='out') sum-=t.amt; });
      var hd=document.createElement('div'); hd.className='dayhead';
      hd.innerHTML='<span>'+dayTitle(d)+'</span><span>'+money(sum)+'</span>';
      ol.appendChild(hd);
      byDay[d].forEach(function(t){ ol.appendChild(txRow(t)); });
    });
  }

  }

  /* --- overview --- */
  if(on('overview')){
  animNum(document.getElementById('ov-net'), T.net);
  var rate = mIn>0 ? Math.round((mIn-mOut)/mIn*100) : 0;
  document.getElementById('ov-month').innerHTML=
    '<div class="kv"><span>Кіріс</span><b style="color:var(--pos)">'+money(mIn)+'</b></div>'+
    '<div class="kv"><span>Шығын</span><b style="color:var(--neg)">'+money(mOut)+'</b></div>'+
    '<div class="kv"><span>Қалдық</span><b>'+money(mIn-mOut)+'</b></div>'+
    '<div class="kv"><span>Жинақ үлесі</span><b>'+(mIn>0?rate+'%':'—')+'</b></div>';

  var assets=accsOf('asset');
  var ob=document.getElementById('ov-assets'); ob.innerHTML='';
  if(!assets.length) ob.innerHTML='<div class="empty">Шот жоқ.</div>';
  else {
    ob.innerHTML='<div class="kv"><span>Банктердегі ақша</span><b style="color:var(--pos)">'+money(T.banks)+'</b></div>'+
      '<div class="kv"><span>Міндеттемелер</span><b style="color:var(--neg)">'+money(T.debts)+'</b></div>'+
      (T.lent?'<div class="kv"><span>Маған қарыз</span><b style="color:var(--pos)">'+money(T.lent)+'</b></div>':'')+
      (T.owed?'<div class="kv"><span>Мен қарызбын</span><b style="color:var(--neg)">'+money(T.owed)+'</b></div>':'')+
      '<div class="kv"><span>Таза капитал</span><b>'+money(T.net)+'</b></div>'+
      '<div class="kv" style="margin-top:8px"><span>Инвестиция портфелі (бөлек)</span><b style="color:var(--blue)">'+money(T.broker)+'</b></div>'+
      (T.invested>0?'<div class="kv"><span>Портфель табысы</span><b style="color:'+(T.brokerPL>=0?'var(--pos)':'var(--neg)')+'">'+
        (T.brokerPL>=0?'+':'')+money(T.brokerPL)+'</b></div>':'');
    var wrapB=document.createElement('div'); wrapB.style.marginTop='12px';
    assets.forEach(function(a){
      var kz=toKZT(a);
      var f=T.banks>0?kz/T.banks:0;
      wrapB.appendChild(barRow(accIconHtml(a,'bar-ic')+'<span>'+esc(a.name)+'</span>', money(kz), f, false));
    });
    ob.appendChild(wrapB);
  }

  var debts=DB.accounts.filter(function(a){return a.kind==='debt';});
  var db=document.getElementById('ov-debts'); db.innerHTML='';
  if(!debts.length) db.innerHTML='<div class="empty">Несие жоқ — тамаша.</div>';
  else {
    var pay=0; debts.forEach(function(a){ pay+=a.pay||0; });
    db.innerHTML='<div class="kv"><span>Жалпы қарыз</span><b style="color:var(--neg)">'+money(T.debts)+'</b></div>'+
      '<div class="kv"><span>Айлық төлем</span><b>'+money(pay)+'</b></div>'+
      '<div class="kv"><span>Кіріске қатысты</span><b>'+(mIn>0?Math.round(pay/mIn*100)+'%':'—')+'</b></div>';
    debts.forEach(function(a){
      var kz=toKZT(a);
      var f=T.debts>0?kz/T.debts:0;
      db.appendChild(barRow(accIconHtml(a,'bar-ic')+'<span>'+esc(a.name)+'</span>', money(kz), f, 'neg'));
    });
  }

  var topBox=document.getElementById('ov-top'); topBox.innerHTML='';
  var sums={};
  mTx.filter(function(t){return t.type==='out';}).forEach(function(t){ sums[t.cat]=(sums[t.cat]||0)+t.amt; });
  var keys=Object.keys(sums).sort(function(a,b){return sums[b]-sums[a];}).slice(0,5);
  if(!keys.length) topBox.innerHTML='<div class="empty">Бұл айда шығын жоқ.</div>';
  else {
    var mx=sums[keys[0]]||1;
    keys.forEach(function(k,i){
      var col=PIE_COLORS[i%PIE_COLORS.length];
      var pct=Math.max(2,Math.round(sums[k]/mx*100));
      var el=document.createElement('div'); el.className='cat-row';
      el.innerHTML='<div class="cat-top"><span><i class="dotc" style="background:'+col+'"></i>'+esc(k)+'</span>'+
        '<b>'+money(sums[k])+'</b></div>'+
        '<div class="track"><div class="fill" style="width:'+pct+'%;background:'+col+'"></div></div>';
      topBox.appendChild(el);
    });
  }

  }

  /* --- жаңа бөлімдер: әрқайсысы өз бетінде ғана --- */
  if(on('debts')) drawDebts();
  if(on('calc-dep')) calcDep();
  if(on('calc-tax')) calcTax();
  if(on('invest')) renderInvest();
  if(on('homeset')) drawHomeSet();
  if(on('sync')) drawSync();
  if(on('stat')) renderStats();
  drawSelBar();
  if(on('set')){
  var sri=document.getElementById('set-rate-info');
  if(sri) sri.textContent = rateV()
    ? rateText()+' · '+rateAgo()+(DB.rate.src==='manual'?' (қолмен)':'')
    : 'Курс әлі алынбаған. Интернет болса жаңартыңыз немесе қолмен жазыңыз.';
  drawSnaps();
  drawStorage();
  var bk=document.getElementById('bk-info');
  if(bk){
    var dd=daysSinceBackup();
    var pt = persisted===true ? ' Браузер деректі тұрақты сақтауға келісті.' : '';
    bk.textContent = (dd===null
      ? 'Дерек әр өзгерісте телефонға өзі сақталады. Файл көшірмесі әлі жасалмаған.'
      : 'Дерек өзі сақталып отырады. Соңғы файл көшірмесі: '+(dd===0?'бүгін':dd+' күн бұрын')+'.') + pt;
  }
  var di=document.getElementById('dup-info');
  if(di){
    var seen={}, dc=0;
    DB.tx.forEach(function(t){
      var k=t.date+'|'+Math.round(t.amt)+'|'+t.type+'|'+(t.cat||'')+'|'+(t.note||'').slice(0,20);
      if(seen[k]) dc++; else seen[k]=1;
    });
    di.textContent = dc ? dc+' қайталанған операция табылды.' : 'Қайталанған операция жоқ.';
  }
  drawLangChips();
  drawThemeChips();
  }

  fillIcons();
  translateDom(document.body);

  /* --- goals --- */
  if(!on('goals')) return;
  var gt=0; DB.goals.forEach(function(g){ gt+=g.saved; });
  animNum(document.getElementById('g-total'), gt);
  document.getElementById('g-count').textContent=DB.goals.length+' мақсат';
  var gl=document.getElementById('goal-list'); gl.innerHTML='';
  if(!DB.goals.length) gl.innerHTML='<div class="card"><div class="empty">Мақсат әлі жоқ.<br>Жинайтын сомаңызды белгілеп қойыңыз.</div></div>';
  else DB.goals.forEach(function(g){
    var pct=Math.min(100,Math.round(g.saved/g.target*100));
    var eta=goalETA(g);
    var etaTxt = eta.done ? 'Мақсат орындалды'
      : (eta.when ? 'Осы қарқынмен ' + eta.when + ' шамасында'
      : (eta.far ? 'Осы қарқынмен өте ұзаққа созылады' : 'Қарқын белгісіз — салым жасаңыз'));
    var el=document.createElement('div'); el.className='card';
    el.onclick=function(){ openGview(g.id); };
    el.innerHTML='<div style="display:flex;align-items:center;gap:11px;margin-bottom:12px">'+
      '<div class="ico blue">'+svgIcon('flag')+'</div><div style="font-weight:700;font-size:16px">'+esc(g.name)+'</div></div>'+
      '<div class="track"><div class="fill" style="width:'+pct+'%"></div></div>'+
      '<div style="display:flex;justify-content:space-between;margin-top:8px;font-size:13px;color:var(--ink-2)">'+
      '<span>'+money(g.saved)+' / '+money(g.target)+'</span><b style="color:var(--ink)">'+pct+'%</b></div>'+
      '<div class="muted" style="margin-top:6px">'+etaTxt+
        (eta.rate>0&&!eta.done ? ' · айына ~'+money(eta.rate) : '')+'</div>'+
      (function(){
        if(!g.hist || !g.hist.length) return '';
        var last=g.hist[g.hist.length-1], la=last.acc?acc(last.acc):null;
        return '<div class="muted" style="margin-top:6px">Соңғы салым: '+fullDate(last.date)+
               ' · '+(la?esc(la.name)+' шотынан':'шотсыз')+'</div>';
      })();
    gl.appendChild(el);
  });
}

function txRow(t){
  var row=document.createElement('div'); row.className='row';
  var pick = selActive('tx');
  row.onclick = pick ? function(){ selTog(t.id); } : function(){ openView(t.id); };
  var a=acc(t.acc);
  if(t.type==='tr'){
    var to=acc(t.to);
    row.innerHTML='<div class="ico blue">⇄</div>'+
      '<div><div class="name">Аударым</div><div class="sub2">'+
      (a?esc(a.name):'—')+' → '+(to?esc(to.name):'—')+'</div></div>'+
      '<div class="amt" style="color:var(--blue)">'+nf(t.amt)+' ₸</div>';
    return pick ? row : swipeWrap(row, function(){ deleteTxWithUndo(t); }, function(){ openTx(t.id); });
  }
  row.innerHTML=(pick?selBox(t.id):'')+catBox(t.type,t.cat)+
    '<div style="min-width:0;flex:1"><div class="name">'+esc(t.cat)+'</div><div class="sub2">'+
    (a?esc(a.name):'—')+(t.note?' · '+esc(t.note):'')+'</div></div>'+
    '<div class="amt '+t.type+'">'+(t.type==='in'?'+':'−')+nf(t.amt)+' ₸</div>';
  return pick ? row : swipeWrap(row, function(){ deleteTxWithUndo(t); }, function(){ openTx(t.id); });
}
function renderAccList(kind, elId, emptyTxt){
  var box=document.getElementById(elId); box.innerHTML='';
  var list=DB.accounts.filter(function(a){return a.kind===kind;});
  if(!list.length){ box.innerHTML='<div class="empty">'+emptyTxt+'</div>'; return; }
  list.forEach(function(a){
    var row=document.createElement('div'); row.className='row';
    row.onclick = (kind==='broker') ? function(){ openBroker(a.id); } : function(){ openAccView(a.id); };
    var sym=accCurSym(a);
    var sub='Банк шоты';
    if(kind==='debt') sub=(a.rate||0)+'% · айына '+nf(a.pay||0)+' ₸';
    if(kind==='broker'){
      var inv=a.invested||0, pl=a.bal-inv;
      sub='Салынған '+nf(inv)+' '+sym+' · '+(pl>=0?'+':'−')+nf(Math.abs(pl))+' '+sym+
          (inv>0?' ('+(pl>=0?'+':'−')+Math.abs(Math.round(pl/inv*100))+'%)':'');
    }
    if(a.cur==='USD') sub += ' · ≈ '+nf(toKZT(a))+' ₸';
    row.innerHTML=(kind==='asset' ? accBadge(a) :
      '<div class="ico'+(kind==='debt'?' red':' blue')+'">'+accIconHtml(a)+'</div>')+
      '<div style="min-width:0;flex:1"><div class="name">'+esc(a.name)+(a.cur==='USD'?' <span class="badge">$</span>':'')+
      '</div><div class="sub2">'+sub+'</div></div>'+
      '<div class="amt" style="color:'+(kind==='debt'?'var(--neg)':'var(--ink)')+'">'+money(a.bal,sym)+'</div>';
    box.appendChild(row);
  });
}
function barRow(label, right, frac, kind){
  var el=document.createElement('div'); el.className='bar-row';
  var pct=Math.max(0,Math.min(100,Math.round(frac*100)));
  var cls = kind===true||kind==='neg' ? ' neg' : (kind==='pos' ? ' pos' : '');
  el.innerHTML='<div class="bar-top"><span>'+label+'</span><b>'+right+'</b></div>'+
    '<div class="track"><div class="fill'+cls+'" style="width:'+pct+'%"></div></div>';
  return el;
}

function renderStats(){
  var list=DB.tx.filter(function(t){ return inRange(t.date) && t.type!=='tr'; });
  var sIn=0,sOut=0;
  list.forEach(function(t){ if(t.type==='in') sIn+=t.amt; else sOut+=t.amt; });
  document.getElementById('s-count').textContent=list.length+' операция';
  document.getElementById('s-in').textContent=money(sIn);
  document.getElementById('s-out').textContent=money(sOut);
  var net=sIn-sOut;
  var ne=document.getElementById('s-net');
  ne.textContent=(net>=0?'+':'')+money(net);
  ne.style.color = net>=0?'var(--pos)':'var(--neg)';

  document.getElementById('s-card-in').classList.toggle('hide', statFilter==='out');
  document.getElementById('s-card-out').classList.toggle('hide', statFilter==='in');

  drawCatBars('s-cat-out','out',list,sOut);
  drawCatBars('s-cat-in','in',list,sIn);
  drawChart(list);
  drawDonut('s-donut-out', catItems(list, 'out'), 'Барлық шығын');
  drawDonut('s-donut-in', catItems(list, 'in'), 'Барлық кіріс');
  drawTrend();
}
function drawCatBars(elId,type,list,total){
  var box=document.getElementById(elId); box.innerHTML='';
  var sums={};
  list.filter(function(t){return t.type===type;}).forEach(function(t){ sums[t.cat]=(sums[t.cat]||0)+t.amt; });
  var keys=Object.keys(sums).sort(function(a,b){return sums[b]-sums[a];});
  if(!keys.length){ box.innerHTML='<div class="empty">Бұл кезеңде дерек жоқ.</div>'; return; }
  keys.forEach(function(k){
    var pct=total?sums[k]/total:0;
    box.appendChild(barRow(catSvg(type,k,'bar-ic')+'<span>'+k+'</span>', money(sums[k])+' · '+Math.round(pct*100)+'%', pct, type==='out'?'neg':'pos'));
  });
}
function drawChart(list){
  var box=document.getElementById('s-chart');
  if(!list.length){ box.innerHTML='<div class="empty">Диаграмма үшін дерек жоқ.</div>'; return; }
  var days={};
  list.forEach(function(t){
    if(!days[t.date]) days[t.date]={in:0,out:0};
    days[t.date][t.type]+=t.amt;
  });
  var keys=Object.keys(days).sort().slice(-31);
  var max=0; keys.forEach(function(k){ max=Math.max(max,days[k]["in"],days[k].out); });
  if(max<=0) max=1;
  var W=100, H=100, n=keys.length, gw=W/n, bw=Math.min(gw*0.36, 3.2);
  var s='<svg class="chart" viewBox="0 0 100 100" preserveAspectRatio="none">';
  keys.forEach(function(k,i){
    var x=i*gw+gw/2;
    var hi=days[k]["in"]/max*88, ho=days[k].out/max*88;
    s+='<rect x="'+(x-bw-0.3)+'" y="'+(94-hi)+'" width="'+bw+'" height="'+hi+'" fill="#00BE86" rx="0.6"/>';
    s+='<rect x="'+(x+0.3)+'" y="'+(94-ho)+'" width="'+bw+'" height="'+ho+'" fill="#FF4D67" rx="0.6"/>';
  });
  s+='<line x1="0" y1="94.5" x2="100" y2="94.5" stroke="#DCE1F5" stroke-width="0.4"/></svg>';
  box.innerHTML=s;
}

/* ================= ИНВЕСТИЦИЯ КАЛЬКУЛЯТОРЫ ================= */
var invMode='income', invUnit='year', invReinvest=true, invCur='₸', loanCur='₸';
function setInvMode(m){
  invMode=m;
  document.querySelectorAll('[data-im]').forEach(function(b){ b.classList.toggle('on', b.dataset.im===m); });
  document.getElementById('i-target-box').classList.toggle('hide', m!=='term');
  document.getElementById('i-term-box').classList.toggle('hide', m==='term');
  calcInv();
}
function setInvUnit(u){
  invUnit=u;
  document.querySelectorAll('[data-iu]').forEach(function(b){ b.classList.toggle('on', b.dataset.iu===u); });
  calcInv();
}
function setCur(which,c){
  if(which==='inv'){ invCur=c; document.querySelectorAll('[data-icur]').forEach(function(b){ b.classList.toggle('on', b.dataset.icur===c); }); calcInv(); }
  else { loanCur=c; document.querySelectorAll('[data-lcur]').forEach(function(b){ b.classList.toggle('on', b.dataset.lcur===c); }); calcLoan(); }
}
function toggleReinvest(){
  invReinvest=!invReinvest;
  document.getElementById('i-sw').classList.toggle('on', invReinvest);
  document.getElementById('i-sw-txt').textContent = invReinvest?'Қосылған — күрделі пайыз':'Қосылмаған — қарапайым пайыз';
  calcInv();
}
function num(id){ var v=parseFloat(document.getElementById(id).value); return isNaN(v)?0:v; }

function calcInv(){
  var P=num('i-start'), M=num('i-month'), r=num('i-rate')/100/12;
  var box=document.getElementById('i-res');
  if(invMode==='income'){
    var n = invUnit==='year' ? Math.round(num('i-years')*12) : Math.round(num('i-years'));
    if(n<=0 || (P<=0&&M<=0)){ box.innerHTML='<div class="empty">Мәндерді толтырыңыз.</div>'; return; }
    var res=growth(P,M,r,n,invReinvest);
    var invested=P+M*n;
    box.innerHTML='<div class="res"><div class="lab">Мерзім соңындағы сома</div>'+
      '<div class="big">'+money(res,invCur)+'</div></div>'+
      '<div class="card"><div class="kv"><span>Салынған қаражат</span><b>'+money(invested,invCur)+'</b></div>'+
      '<div class="kv"><span>Пайыздық табыс</span><b style="color:var(--pos)">'+money(res-invested,invCur)+'</b></div>'+
      '<div class="kv"><span>Мерзім</span><b>'+n+' ай ('+(n/12).toFixed(1)+' жыл)</b></div>'+
      '<div class="kv"><span>Өсім</span><b>'+(invested>0?Math.round((res-invested)/invested*100):0)+'%</b></div></div>'+
      yearTable(P,M,r,n,invReinvest);
  } else {
    var target=num('i-target');
    if(target<=0 || (P<=0&&M<=0)){ box.innerHTML='<div class="empty">Мақсатты соманы толтырыңыз.</div>'; return; }
    if(P>=target){ box.innerHTML='<div class="res"><div class="lab">Мақсат</div><div class="big">Қазірдің өзінде жеткен</div></div>'; return; }
    var n2=0, bal=P, base=P, acc2=0;
    while(n2<1200){
      n2++;
      if(invReinvest){ bal=bal*(1+r)+M; }
      else { acc2+=base*r; base+=M; bal=base+acc2; }
      if(bal>=target) break;
    }
    if(bal<target){ box.innerHTML='<div class="empty">100 жыл ішінде мақсатқа жетпейді. Ай сайынғы үлесті немесе мөлшерлемені арттырыңыз.</div>'; return; }
    var inv2=P+M*n2;
    box.innerHTML='<div class="res"><div class="lab">Мақсатқа жету мерзімі</div>'+
      '<div class="big">'+Math.floor(n2/12)+' жыл '+(n2%12)+' ай</div></div>'+
      '<div class="card"><div class="kv"><span>Жинақталған сома</span><b>'+money(bal,invCur)+'</b></div>'+
      '<div class="kv"><span>Салынған қаражат</span><b>'+money(inv2,invCur)+'</b></div>'+
      '<div class="kv"><span>Пайыздық табыс</span><b style="color:var(--pos)">'+money(bal-inv2,invCur)+'</b></div>'+
      '<div class="kv"><span>Барлығы</span><b>'+n2+' ай</b></div></div>';
  }
}
function growth(P,M,r,n,compound){
  if(compound){
    var b=P;
    for(var i=0;i<n;i++) b=b*(1+r)+M;
    return b;
  }
  var base=P, acc=0;
  for(var j=0;j<n;j++){ acc+=base*r; base+=M; }
  return base+acc;
}
function yearTable(P,M,r,n,compound){
  if(n<12) return '';
  var rows='', b=P, base=P, acc=0;
  var h='<div class="card"><h2>Жыл сайынғы өсім</h2><table class="sched"><tr><th>Жыл</th><th>Салынған</th><th>Сома</th></tr>';
  for(var i=1;i<=n;i++){
    if(compound) b=b*(1+r)+M;
    else { acc+=base*r; base+=M; b=base+acc; }
    if(i%12===0 || i===n){
      rows+='<tr><td>'+Math.ceil(i/12)+'</td><td>'+nf(P+M*i)+'</td><td><b>'+nf(b)+'</b></td></tr>';
    }
  }
  return h+rows+'</table></div>';
}

/* ================= НЕСИЕ КАЛЬКУЛЯТОРЫ ================= */
var loanMode='pay', loanUnit='year', loanType='ann';
function setLoanMode(m){
  loanMode=m;
  document.querySelectorAll('[data-lm]').forEach(function(b){ b.classList.toggle('on', b.dataset.lm===m); });
  document.getElementById('l-rate-box').classList.toggle('hide', m==='rate');
  document.getElementById('l-pay-box').classList.toggle('hide', m!=='rate');
  document.getElementById('l-type-box').classList.toggle('hide', m==='rate');
  calcLoan();
}
function setLoanUnit(u){
  loanUnit=u;
  document.querySelectorAll('[data-lu]').forEach(function(b){ b.classList.toggle('on', b.dataset.lu===u); });
  calcLoan();
}
function setLoanType(t){
  loanType=t;
  document.querySelectorAll('[data-lt]').forEach(function(b){ b.classList.toggle('on', b.dataset.lt===t); });
  calcLoan();
}
function annuity(S,i,n){ return i===0 ? S/n : S*i*Math.pow(1+i,n)/(Math.pow(1+i,n)-1); }

function calcLoan(){
  var box=document.getElementById('l-res');
  var S=num('l-sum');
  var n = loanUnit==='year' ? Math.round(num('l-term')*12) : Math.round(num('l-term'));

  if(loanMode==='rate'){
    var pay=num('l-pay');
    if(S<=0||n<=0||pay<=0){ box.innerHTML='<div class="empty">Мәндерді толтырыңыз.</div>'; return; }
    if(pay*n<=S){ box.innerHTML='<div class="empty">Төлем тым аз — бұл несие өтелмейді.</div>'; return; }
    var lo=0, hi=2, mid;
    for(var k=0;k<80;k++){
      mid=(lo+hi)/2;
      if(annuity(S,mid,n)>pay) hi=mid; else lo=mid;
    }
    var yr=mid*12*100, total=pay*n;
    box.innerHTML='<div class="res"><div class="lab">Жылдық мөлшерлеме</div>'+
      '<div class="big">'+yr.toFixed(2)+' %</div></div>'+
      '<div class="card"><div class="kv"><span>Барлық төлем</span><b>'+money(total,loanCur)+'</b></div>'+
      '<div class="kv"><span>Артық төлем</span><b style="color:var(--neg)">'+money(total-S,loanCur)+'</b></div>'+
      '<div class="kv"><span>Артық төлем үлесі</span><b>'+Math.round((total-S)/S*100)+'%</b></div></div>';
    return;
  }

  var rate=num('l-rate'), i=rate/12/100;
  if(S<=0||n<=0){ box.innerHTML='<div class="empty">Мәндерді толтырыңыз.</div>'; return; }
  var early=num('l-early'), earlyM=Math.round(num('l-early-m'));

  var bal=S, total=0, interest=0, rows='', months=0;
  var basePay = loanType==='ann' ? annuity(S,i,n) : 0;
  var principalPart = S/n;
  var firstPay=0, lastPay=0;

  for(var m=1;m<=n*2 && bal>0.5;m++){
    var int_ = bal*i, pr, p;
    if(loanType==='ann'){
      p = Math.min(basePay, bal+int_);
      pr = p-int_;
    } else {
      pr = Math.min(principalPart, bal);
      p = pr+int_;
    }
    bal -= pr;
    if(early>0 && earlyM===m){ var e=Math.min(early,bal); bal-=e; p+=e; }
    total+=p; interest+=int_; months=m;
    if(m===1) firstPay=p;
    lastPay=p;
    if(m<=360) rows+='<tr><td>'+m+'</td><td>'+nf(p)+'</td><td>'+nf(int_)+'</td><td>'+nf(Math.max(0,bal))+'</td></tr>';
  }

  var payLabel = loanType==='ann' ? 'Ай сайынғы төлем' : 'Бірінші айдағы төлем';
  var extra='';
  if(loanType==='diff') extra='<div class="kv"><span>Соңғы төлем</span><b>'+money(lastPay,loanCur)+'</b></div>';
  if(early>0 && earlyM>0){
    var noEarly = loanType==='ann' ? annuity(S,i,n)*n : 0;
    extra+='<div class="kv"><span>Ерте өтеуден кейін</span><b>'+months+' ай ('+(n-months)+' ай қысқарды)</b></div>';
  }

  box.innerHTML='<div class="res"><div class="lab">'+payLabel+'</div>'+
    '<div class="big">'+money(firstPay,loanCur)+'</div></div>'+
    '<div class="card"><div class="kv"><span>Несие сомасы</span><b>'+money(S,loanCur)+'</b></div>'+
    '<div class="kv"><span>Барлық төлем</span><b>'+money(total,loanCur)+'</b></div>'+
    '<div class="kv"><span>Артық төлем</span><b style="color:var(--neg)">'+money(interest,loanCur)+'</b></div>'+
    '<div class="kv"><span>Мерзім</span><b>'+months+' ай</b></div>'+extra+'</div>'+
    '<div class="card"><h2>Төлем кестесі</h2><table class="sched">'+
    '<tr><th>Ай</th><th>Төлем</th><th>Пайыз</th><th>Қалдық</th></tr>'+rows+'</table></div>';
}

/* ================= БАНК ҮЗІНДІСІН ИМПОРТТАУ ================= */
var CDN_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
var CDN_PDF  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var CDN_PDFW = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

var IMP = { rows: [], acc: null, mode: 'bank', brAcc: null };

var BR_KEYS = [
  [/(дивиденд|dividend|купон|coupon|выплата по|доход по бумаг)/i, 'div'],
  [/(комисси|fee|налог|tax|удержан|штраф|обслужив)/i, 'fee'],
  [/(вывод|withdraw|снятие|перевод на карт|списание на счет)/i, 'wd'],
  [/(пополнен|депозит|deposit|зачислен|поступлен|ввод средств)/i, 'dep']
];
function guessBrokerType(text, sign){
  for(var i=0;i<BR_KEYS.length;i++) if(BR_KEYS[i][0].test(text)) return BR_KEYS[i][1];
  return sign==='in' ? 'dep' : 'wd';
}
function startBrokerImport(){
  IMP.mode='broker'; IMP.brAcc=brId; IMP.rows=[];
  document.getElementById('imp-result').innerHTML='';
  document.getElementById('imp-status').innerHTML='';
  go('import');
  var a=acc(brId);
  document.getElementById('imp-h1').textContent='Брокерлік есеп';
  document.getElementById('imp-sub').textContent=(a?a.name:'')+' — жеке есеп';
  document.getElementById('imp-title').textContent='Брокер есебін таңдаңыз';
  document.getElementById('imp-desc').textContent='Freedom Finance, Interactive Brokers және т.б. — есеп файлын (PDF, Excel, CSV) жүктеңіз. Салым, шығару, дивиденд пен комиссия автоматты бөлінеді. Бұл жазбалар тек осы брокерлік шотқа жазылады, жалпы кіріс-шығынға қосылмайды.';
}
function startBrokerImportAll(){
  var list = accsOf('broker');
  if(!list.length){ toast('Алдымен брокерлік шот қосыңыз'); return; }
  brId = list[0].id;
  startBrokerImport();
}
function startBankImport(){
  IMP.mode='bank'; IMP.brAcc=null; IMP.rows=[];
  document.getElementById('imp-result').innerHTML='';
  document.getElementById('imp-status').innerHTML='';
  go('import');
  document.getElementById('imp-h1').textContent='Файл жүктеу';
  document.getElementById('imp-sub').textContent='PDF · Excel · CSV үзінді';
  document.getElementById('imp-title').textContent='Банк үзіндісін таңдаңыз';
  document.getElementById('imp-desc').textContent='Kaspi, Halyk, Freedom, Forte — банк қосымшасынан айлық үзіндіні PDF немесе Excel түрінде жүктеп алыңыз. Операциялар автоматты түрде кіріс пен шығынға бөлініп, санаттары анықталады.';
}

/* --- санат кілт сөздері --- */
var OUT_KEYS = [
  [/(супермаркет|магазин|magnum|small|галмарт|продукт|азық|дүкен|market|food|тамақ|кафе|ресторан|доставка|kfc|burger|pizza|coffee|кофе|chocofood|wolt|glovo)/i, 'Тамақ'],
  [/(такси|taxi|bolt|яндекс|indriver|автобус|метро|онай|onay|азс|заправ|бензин|petrol|helios|көлік|парков|каршер)/i, 'Көлік'],
  [/(коммунал|квартплат|аренда|жкх|тұрғын|электр|энерго|газ|водоканал|теплосеть|мусор|кск|опс)/i, 'Тұрғын үй'],
  [/(мобиль|интернет|beeline|activ|kcell|tele2|altel|izi|байланыс|связь|транстелеком|казахтелеком)/i, 'Байланыс'],
  [/(аптек|apteka|медиц|клиник|дәрі|денсаул|health|стоматол|анализ|invivo|olymp)/i, 'Денсаулық'],
  [/(кредит|несие|қарыз|займ|погашен|рассрочк|ипотек|микрозайм|loan)/i, 'Несие төлемі'],
  [/(одежд|киім|zara|waikiki|обувь|sport|adidas|nike|бутик|h&m)/i, 'Киім'],
  [/(кино|театр|игр|steam|netflix|spotify|youtube|ойын|развлеч|концерт|боулинг|фитнес|бассейн)/i, 'Ойын-сауық'],
  [/(школ|курс|оқу|білім|univer|educat|книг|кітап|детский сад|репетитор)/i, 'Білім'],
  [/(подарок|сыйлық|gift|цвет|букет)/i, 'Сыйлық']
];
var IN_KEYS = [
  [/(зарплат|жалақы|salary|аванс|оклад|payroll)/i, 'Жалақы'],
  [/(дивиденд|инвест|брокер|freedom|депозит|вклад|вознагражд|процент по)/i, 'Инвестиция'],
  [/(кредит выдан|несие алу|займ получ|кредит получ|транш)/i, 'Несие алу'],
  [/(бизнес|kaspi pay|оплата от|выручк|эквайринг|(^|[^а-яё])(ип|тоо|жк|жшс)([^а-яё]|$))/i, 'Бизнес'],
  [/(фриланс|freelance|upwork|услуг|гонорар)/i, 'Фриланс']
];
var IN_WORDS  = /(пополнен|поступлен|зачислен|перевод от|получен|возврат|refund|кіріс|түсім|қабылданд|салынды|income|credit)/i;
var OUT_WORDS = /(покупк|оплат|снятие|перевод на|списан|платеж|шығын|төлем|аударым|payment|withdraw|debit|перевод в)/i;

function loadScript(url){
  return new Promise(function(res, rej){
    if(document.querySelector('script[src="'+url+'"]')) return res();
    var sc = document.createElement('script');
    sc.src = url; sc.onload = function(){ res(); }; sc.onerror = function(){ rej(new Error('load')); };
    document.head.appendChild(sc);
  });
}

function impStatus(html){ document.getElementById('imp-status').innerHTML = html; }

function onImportFile(el){
  var f = el.files[0]; el.value = '';
  if(!f) return;
  document.getElementById('imp-result').innerHTML = '';
  IMP.freedom = null;
  impStatus('<div class="card"><div class="spin"></div><div class="empty">Файл оқылып жатыр…<br><b>'+esc(f.name)+'</b></div></div>');

  var name = f.name.toLowerCase();
  var task;
  if(name.slice(-4) === '.pdf')      task = readBuf(f).then(parsePDF);
  else if(name.slice(-4) === '.csv') task = readText(f).then(parseCSV);
  else                                task = readBuf(f).then(parseXLSX);

  task.then(function(lines){
    IMP.bank = null; IMP.bankUsed = false;

    /* Freedom брокер есебі — арнайы оқу */
    if(IMP.mode === 'broker' && isFreedomReport(lines)){
      var frRows = parseFreedom(lines);
      if(frRows && frRows.length){
        var code = freedomClientCode(lines);
        var target = IMP.brAcc, auto = false, created = false;
        if(code){
          accsOf('broker').forEach(function(a){
            var c = brokerCode(a.name);
            if(c && (c === code || code.indexOf(c) !== -1 || c.indexOf(code) !== -1)){ target = a.id; auto = true; }
          });
          if(!auto){
            /* мұндай шот жоқ — атын клиент кодымен қойып, өзіміз құрамыз */
            var na = { id: newId(), name: '#' + code, kind: 'broker', icon: 'invest',
                       bal: 0, cur: 'KZT', vals: { KZT: 0, USD: 0 }, invested: 0, valSet: false };
            DB.accounts.push(na);
            save();
            target = na.id; auto = true; created = true;
          }
        }
        if(!target && accsOf('broker').length) target = accsOf('broker')[0].id;
        frRows.forEach(function(r){ r.bacc = target; });
        var have = {};
        DB.btx.forEach(function(b){ have[b.acc + '|' + b.date + '|' + b.amt.toFixed(2)] = 1; });
        frRows.forEach(function(r){
          r.dup = !!have[r.bacc + '|' + r.date + '|' + r.amt.toFixed(2)];
          r.on = !r.dup;
        });
        IMP.rows = frRows;
        IMP.brAcc = target;
        IMP.freedom = { code: code, auto: auto, created: created };
        impStatus('');
        renderImport();
        return;
      }
    }

    var head = lines.slice(0, 40).join(' ') + ' ' + f.name;
    for(var i = 0; i < BANKS.length; i++){
      if(BANKS[i][2] && BANKS[i][2].test(head)){ IMP.bank = BANKS[i]; break; }
    }
    var rows = extractRows(lines);
    if(!rows.length){
      impStatus('<div class="card"><div class="empty">Бұл файлдан операция табылмады.<br>Excel (.xlsx) нұсқасын жүктеп көріңіз — ол әрқашан дәлірек оқылады.</div></div>');
      return;
    }
    IMP.rows = rows;
    impStatus('');
    renderImport();
  }).catch(function(e){
    impStatus('<div class="card"><div class="empty">Файлды оқу мүмкін болмады.<br>' +
      'Бірінші рет оқығанда интернет қажет (кітапхана жүктеледі). Интернетті қосып қайта көріңіз.</div></div>');
  });
}

function readBuf(f){
  return new Promise(function(res, rej){
    var r = new FileReader();
    r.onload = function(){ res(r.result); };
    r.onerror = rej; r.readAsArrayBuffer(f);
  });
}
function readText(f){
  return new Promise(function(res, rej){
    var r = new FileReader();
    r.onload = function(){ res(r.result); };
    r.onerror = rej; r.readAsText(f);
  });
}

/* --- PDF --> жолдар --- */
function parsePDF(buf){
  return loadScript(CDN_PDF).then(function(){
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN_PDFW;
    return window.pdfjsLib.getDocument({ data: buf }).promise;
  }).then(function(pdf){
    var jobs = [];
    for(var i = 1; i <= pdf.numPages; i++){
      jobs.push(pdf.getPage(i).then(function(pg){ return pg.getTextContent(); }));
    }
    return Promise.all(jobs);
  }).then(function(pages){
    var lines = [];
    pages.forEach(function(c){
      var map = {};
      c.items.forEach(function(it){
        var key = Math.round(it.transform[5] / 3);
        (map[key] = map[key] || []).push({ x: it.transform[4], s: it.str });
      });
      Object.keys(map).sort(function(a,b){ return b - a; }).forEach(function(k){
        var line = map[k].sort(function(a,b){ return a.x - b.x; })
          .map(function(o){ return o.s; }).join(' ').replace(/\s+/g,' ').trim();
        if(line) lines.push(line);
      });
    });
    return lines;
  });
}

/* --- Excel --> жолдар --- */
function parseXLSX(buf){
  return loadScript(CDN_XLSX).then(function(){
    var wb = window.XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
    var lines = [];
    wb.SheetNames.forEach(function(n){
      var rows = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' });
      rows.forEach(function(r){
        var line = r.map(function(c){ return String(c).trim(); }).filter(Boolean).join(' | ');
        if(line) lines.push(line);
      });
    });
    return lines;
  });
}

/* --- CSV --> жолдар --- */
function parseCSV(text){
  return text.split(/\r?\n/).map(function(l){
    return l.replace(/"/g,'').split(/[;\t,](?=(?:[^"]*"[^"]*")*[^"]*$)/).join(' | ');
  }).filter(function(l){ return l.trim(); });
}

/* --- сан --- */
function toNum(str){
  var s = String(str).replace(/[\s\u00A0\u202F]/g,'');
  if(s.indexOf(',') > -1 && s.indexOf('.') > -1){
    if(s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g,'').replace(',','.');
    else s = s.replace(/,/g,'');
  } else if(s.indexOf(',') > -1){
    var p = s.split(',');
    if(p[p.length-1].length === 2) s = p.slice(0,-1).join('') + '.' + p[p.length-1];
    else s = s.replace(/,/g,'');
  }
  return parseFloat(s);
}
function pad2(n){ return String(n).padStart(2,'0'); }

/* --- бір жолдан операция шығару --- */
/* Брокерлік шоттың нөмірін атауынан алу: "#7D1541", "Брокер 7A99244" т.б. */
function brokerCode(name){
  var m = String(name || '').match(/#?\s*([A-Za-z0-9]{4,})/);
  return m ? m[1].toUpperCase() : null;
}
function detectBrokerAcc(text){
  var t = String(text || '').toUpperCase().replace(/[\s\u00A0]/g, '');
  var found = null;
  accsOf('broker').forEach(function(a){
    var c = brokerCode(a.name);
    if(c && c.length >= 4 && t.indexOf(c) !== -1) found = a.id;
  });
  return found;
}

function extractRows(lines){
  var out = [], seen = {}, curAcc = null;
  lines.forEach(function(line){
    if(IMP.mode === 'broker'){
      var hit = detectBrokerAcc(line);
      if(hit) curAcc = hit;
    }
    var r = extractOne(line);
    if(!r) return;
    if(IMP.mode === 'broker'){
      r.bacc = detectBrokerAcc(line) || curAcc || IMP.brAcc;
    }
    var k = r.date + '|' + r.amt + '|' + r.type + '|' + r.note.slice(0,24) +
            (IMP.mode === 'broker' ? '|' + r.bacc : '');
    if(seen[k]) return;
    seen[k] = 1;
    out.push(r);
  });
  // қайталанғанды тексеру
  var have = {};
  if(IMP.mode === 'broker'){
    DB.btx.forEach(function(b){ have[b.acc + '|' + b.date + '|' + Math.round(b.amt)] = 1; });
    out.forEach(function(r){
      r.bt = guessBrokerType(r.note + ' ' + r.type, r.type);
      r.dup = !!have[r.bacc + '|' + r.date + '|' + Math.round(r.amt)];
      r.on = !r.dup;
    });
  } else {
    DB.tx.forEach(function(t){ have[t.date + '|' + Math.round(t.amt) + '|' + t.type] = 1; });
    out.forEach(function(r){
      r.dup = !!have[r.date + '|' + Math.round(r.amt) + '|' + r.type];
      r.on = !r.dup;
    });
  }
  out.sort(function(a,b){ return a.date < b.date ? 1 : -1; });
  return out;
}

var SKIP_LINE = /(выписк|за период|итого|всего|остаток|входящ|исходящ|сальдо|доступн|қолжетімді|баланс|лимит|номер счет|отчет|страниц|үзінді|кезең|барлығы|қалдық|жалпы сома|jsc |бсн|бин|иин|бжк)/i;

function extractOne(line){
  if(SKIP_LINE.test(line)) return null;
  var rest = ' ' + line + ' ';

  // маскаланған карта, шот нөмірлері, ЖСН
  rest = rest.replace(/(\d[\d\s]*)?\*{2,}([\s\d]*\d)?/g, ' ');
  rest = rest.replace(/KZ[0-9A-Z]{14,}/gi, ' ');
  rest = rest.replace(/\b\d{12,}\b/g, ' ');

  // барлық күндер (біріншісі — операция күні, қалғандары алынып тасталады)
  var d = null;
  var reISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  var reDMY = /\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})\b/g;
  var hits = [], m;
  while((m = reISO.exec(rest)) !== null) hits.push({raw:m[0], d:m[0]});
  while((m = reDMY.exec(rest)) !== null){
    var day = +m[1], mon = +m[2], yr = m[3].length === 2 ? 2000 + (+m[3]) : +m[3];
    if(day > 31 || mon > 12 || yr < 2000 || yr > 2100) continue;
    hits.push({raw:m[0], d: yr + '-' + pad2(mon) + '-' + pad2(day)});
  }
  if(!hits.length) return null;
  d = hits[0].d;
  hits.forEach(function(h){ rest = rest.split(h.raw).join(' '); });

  // уақыт
  rest = rest.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ');

  // сомалар
  var re = /([+\-−–])?\s*(\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2}|\d{3,})\s*(₸|тг|тнг|KZT|₽|\$|USD|EUR)?/g;
  var best = null, mm;
  while((mm = re.exec(rest)) !== null){
    var v = toNum(mm[2]);
    if(!isFinite(v) || v <= 0 || v > 999999999) continue;
    var score = (mm[3] ? 3 : 0) + (mm[1] ? 2 : 0) + (/[.,]\d{2}$/.test(mm[2]) ? 1 : 0);
    if(!best || score > best.score || (score === best.score && v > best.v)){
      best = { v: v, sign: mm[1], score: score, raw: mm[0] };
    }
  }
  if(!best) return null;

  // түсініктеме
  var note = rest.replace(best.raw, ' ')
    .replace(/[|]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:.,]+|[\s\-–—:.,]+$/g, '')
    .trim();
  if(note.length > 70) note = note.slice(0, 70);

  // кіріс пе, шығын ба
  var type = 'out';
  if(best.sign === '+') type = 'in';
  else if(best.sign === '-' || best.sign === '−' || best.sign === '–') type = 'out';
  else if(IN_WORDS.test(line) && !OUT_WORDS.test(line)) type = 'in';
  else if(OUT_WORDS.test(line)) type = 'out';

  if(best.v < 1) return null;
  return { date: d, amt: best.v, type: type, note: note || '—', cat: guessCat(type, line) };
}

function guessCat(type, text){
  var keys = type === 'in' ? IN_KEYS : OUT_KEYS;
  for(var i = 0; i < keys.length; i++) if(keys[i][0].test(text)) return keys[i][1];
  return type === 'in' ? 'Басқа' : 'Басқа';
}

/* --- нәтижені көрсету --- */
function renderImport(){
  var box = document.getElementById('imp-result');
  var assets = DB.accounts.filter(function(a){ return a.kind === 'asset'; });
  if(!IMP.acc || !acc(IMP.acc)) IMP.acc = assets.length ? assets[0].id : null;

  var head = document.createElement('div');
  head.className = 'card';

  if(IMP.mode === 'broker'){
    var ba = acc(IMP.brAcc), bsym = accCurSym(ba);
    var cnt = {dep:0, wd:0, div:0, fee:0}, sums = {dep:0, wd:0, div:0, fee:0};
    IMP.rows.forEach(function(r){ cnt[r.bt]++; sums[r.bt] += r.amt; });
    var rowsHtml = '';
    BOP.forEach(function(t){
      if(!cnt[t[0]]) return;
      rowsHtml += '<div class="kv"><span>' + t[1] + ' · ' + cnt[t[0]] + '</span><b>' +
        money(sums[t[0]], bsym) + '</b></div>';
    });
    var per = {};
    IMP.rows.forEach(function(r){ per[r.bacc] = (per[r.bacc] || 0) + 1; });
    var split = '<label class="f" style="margin-top:14px">Шоттар бойынша бөлінді</label>';
    accsOf('broker').forEach(function(a){
      if(!per[a.id]) return;
      var c = brokerCode(a.name);
      split += '<div class="kv"><span>' + esc(a.name) + (c ? ' <span class="badge">' + c + '</span>' : '') +
               '</span><b>' + per[a.id] + '</b></div>';
    });
    var oneOnly = Object.keys(per).length === 1 && accsOf('broker').length > 1;

    var pickBox = '';
    if(accsOf('broker').length > 1){
      pickBox = '<label class="f" style="margin-top:14px">Қай шотқа жазылсын</label><div class="chips" id="imp-bacc"></div>';
    }
    var frNote2 = '';
    if(IMP.freedom){
      var ta0 = acc(IMP.brAcc);
      frNote2 = '<p class="muted" style="margin:12px 0 0">Freedom есебі танылды' +
        (IMP.freedom.code ? ' · клиент коды <b>' + esc(IMP.freedom.code) + '</b>' : '') +
        (IMP.freedom.auto && ta0
          ? ' → <b>' + esc(ta0.name) + '</b> шотына жазылады' +
            (IMP.freedom.created ? ' (шот автоматты құрылды)' : ' (автоматты таңдалды)')
          : '') +
        '. Тек ақша қозғалысы алынды — сауда мәмілелері мен комиссия кестесі есептелмеді.' +
        ' Теңге мен доллар бөлек есептеледі, бір-біріне аударылмайды.' +
        '</p>';
    }
    head.innerHTML = '<h2>Табылды: ' + IMP.rows.length + ' жазба</h2>' + rowsHtml + split + pickBox + frNote2 +
      (oneOnly
        ? '<p class="muted" style="margin:12px 0 0">Файлдан екінші шоттың нөмірі табылмады — бәрі бір шотқа жазылды. Әр жолдың шотын төменнен өзгертуге болады.</p>'
        : '<p class="muted" style="margin:12px 0 0">Шот нөмірі бойынша автоматты бөлінді. Бұл жазбалар жалпы кіріс-шығынға қосылмайды.</p>');
    box.innerHTML = '';
    box.appendChild(head);

    var pb = head.querySelector('#imp-bacc');
    if(pb){
      accsOf('broker').forEach(function(a){
        var b = document.createElement('button');
        b.className = 'chip' + (a.id === IMP.brAcc ? ' on' : '');
        b.innerHTML = accIconHtml(a, 'chip-ic') + '<span>' + esc(a.name) + '</span>';
        b.onclick = function(){
          IMP.brAcc = a.id;
          IMP.rows.forEach(function(r){ r.bacc = a.id; });
          renderImport();
        };
        pb.appendChild(b);
      });
    }

    renderImportList(box);
    return;
  }

  var nIn = 0, nOut = 0, sIn = 0, sOut = 0;
  IMP.rows.forEach(function(r){
    if(r.type === 'in'){ nIn++; sIn += r.amt; } else { nOut++; sOut += r.amt; }
  });
  head.innerHTML =
    '<h2>Табылды: ' + IMP.rows.length + ' операция</h2>' +
    '<div class="kv"><span>Кіріс · ' + nIn + '</span><b style="color:var(--pos)">' + money(sIn) + '</b></div>' +
    '<div class="kv"><span>Шығын · ' + nOut + '</span><b style="color:var(--neg)">' + money(sOut) + '</b></div>' +
    '<label class="f" style="margin-top:14px">Қай банктің шотына жазылсын</label>' +
    '<div class="chips" id="imp-accs"></div>' +
    '<div id="imp-hint"></div>' +
    '<label class="f">Тізімде жоқ па? Бір басып қосыңыз</label>' +
    '<div class="chips" id="imp-add" style="margin-bottom:0"></div>';
  box.innerHTML = '';
  box.appendChild(head);

  // анықталған банкті автоматты таңдау
  if(IMP.bank && !IMP.bankUsed){
    assets.forEach(function(a){
      if(a.name.toLowerCase() === IMP.bank[0].toLowerCase()){ IMP.acc = a.id; IMP.bankUsed = true; }
    });
  }

  var ab = head.querySelector('#imp-accs');
  if(!assets.length) ab.innerHTML = '<div class="muted">Банк шоты жоқ — төменнен таңдаңыз</div>';
  assets.forEach(function(a){
    var b = document.createElement('button');
    b.className = 'chip' + (a.id === IMP.acc ? ' on' : '');
    var br2 = brandOf(a.name);
    b.innerHTML = (br2 ? '<span class="brand sm" style="background:'+br2[1]+(br2[2]?';color:'+br2[2]:'')+'">'+br2[0]+'</span>'
      : accIconHtml(a,'chip-ic')) + '<span>'+esc(a.name)+'</span>';
    b.onclick = function(){ IMP.acc = a.id; renderImport(); };
    ab.appendChild(b);
  });

  // үзінді қай банктен екені анықталса — ескерту
  var hint = head.querySelector('#imp-hint');
  if(IMP.bank && !bankExists(IMP.bank[0])){
    hint.innerHTML = '<div class="badge" style="display:block;padding:10px 12px;margin-bottom:12px;line-height:1.5">' +
      'Бұл үзінді <b>' + esc(IMP.bank[0]) + '</b> банкінен көрінеді. Сол шотты құрайық па?</div>';
    var mk = document.createElement('button');
    mk.className = 'btn ghost'; mk.style.marginBottom = '12px';
    mk.textContent = IMP.bank[1] + ' ' + IMP.bank[0] + ' шотын құру';
    mk.onclick = function(){ IMP.bankUsed = true; addBank(IMP.bank[0], IMP.bank[1], true); };
    hint.appendChild(mk);
  }

  var addBox = head.querySelector('#imp-add');
  BANKS.forEach(function(bk){
    if(bankExists(bk[0])) return;
    var b = document.createElement('button');
    b.className = 'chip';
    b.textContent = '+ ' + bk[1] + ' ' + bk[0];
    b.onclick = function(){ addBank(bk[0], bk[1], true); };
    addBox.appendChild(b);
  });

  renderImportList(box);
}

function renderImportList(box){
  var isBr = IMP.mode === 'broker';
  var ba = isBr ? acc(IMP.brAcc) : null;
  var bsym = isBr ? accCurSym(ba) : '₸';

  var tools = document.createElement('div');
  tools.className = 'card';
  tools.innerHTML = '<div class="seg tight" style="margin:0">' +
    '<button onclick="impAll(true)">Барлығын белгілеу</button>' +
    '<button onclick="impAll(false)">Барлығын алып тастау</button>' +
    '<button onclick="impOnlyNew()">Тек жаңалары</button></div>';
  box.appendChild(tools);

  var list = document.createElement('div');
  list.className = 'card';
  IMP.rows.forEach(function(r, i){
    var row = document.createElement('div');
    row.className = 'imp-row' + (r.on ? '' : ' off');

    var cb = document.createElement('div');
    cb.className = 'cb' + (r.on ? ' on' : '');
    cb.textContent = r.on ? '✓' : '';
    cb.onclick = function(){ r.on = !r.on; renderImport(); };

    var txt = document.createElement('div');
    txt.className = 'txt';
    txt.innerHTML = '<div class="nm">' + esc(r.note) + '</div>' +
      '<div class="dt">' + fullDate(r.date) + '</div>';

    var meta = document.createElement('div');
    meta.className = 'imp-meta';

    if(isBr){
      var sb = document.createElement('select');
      BOP.forEach(function(t){
        var op = document.createElement('option');
        op.value = t[0]; op.textContent = t[1];
        if(r.bt === t[0]) op.selected = true;
        sb.appendChild(op);
      });
      sb.onchange = function(){ r.bt = sb.value; renderImport(); };
      meta.appendChild(sb);

      var sa = document.createElement('select');
      accsOf('broker').forEach(function(a){
        var op = document.createElement('option');
        op.value = a.id; op.textContent = a.name;
        if(r.bacc === a.id) op.selected = true;
        sa.appendChild(op);
      });
      sa.onchange = function(){ r.bacc = sa.value; renderImport(); };
      meta.appendChild(sa);
    } else {
      var st = document.createElement('select');
      [['out','Шығын'],['in','Кіріс']].forEach(function(o){
        var op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1]; if(r.type === o[0]) op.selected = true;
        st.appendChild(op);
      });
      st.onchange = function(){
        r.type = st.value;
        if(CATS[r.type].filter(function(c){ return c[0] === r.cat; }).length === 0) r.cat = 'Басқа';
        renderImport();
      };

      var sc = document.createElement('select');
      CATS[r.type].forEach(function(c){
        var op = document.createElement('option');
        op.value = c[0]; op.textContent = c[0];
        if(r.cat === c[0]) op.selected = true;
        sc.appendChild(op);
      });
      sc.onchange = function(){ r.cat = sc.value; };
      meta.appendChild(st); meta.appendChild(sc);
    }
    if(r.dup){
      var bd = document.createElement('span');
      bd.className = 'badge'; bd.textContent = 'бұрын қосылған';
      meta.appendChild(bd);
    }
    txt.appendChild(meta);

    var am = document.createElement('div');
    am.style.fontSize = '14px';
    am.style.fontWeight = '700';
    am.style.marginLeft = 'auto';
    am.style.whiteSpace = 'nowrap';
    var plus = isBr ? (r.bt === 'dep' || r.bt === 'div') : (r.type === 'in');
    am.style.color = plus ? 'var(--pos)' : 'var(--neg)';
    var rowSym = isBr ? (r.cur === 'USD' ? '$' : '₸') : bsym;
    am.textContent = (plus ? '+' : '−') + nf(r.amt) + ' ' + rowSym;

    row.appendChild(cb); row.appendChild(txt); row.appendChild(am);
    list.appendChild(row);
  });
  box.appendChild(list);

  var n = IMP.rows.filter(function(r){ return r.on; }).length;
  var btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = n + (isBr ? ' жазбаны қосу' : ' операцияны қосу');
  btn.onclick = importConfirm;
  if(!n || (!isBr && !IMP.acc)){ btn.style.opacity = '.5'; }
  box.appendChild(btn);

  translateDom(box);
  var cancel = document.createElement('button');
  cancel.className = 'btn ghost';
  cancel.textContent = 'Болдырмау';
  cancel.onclick = function(){ IMP.rows = []; document.getElementById('imp-result').innerHTML = ''; };
  box.appendChild(cancel);
}

function impAll(v){ IMP.rows.forEach(function(r){ r.on = v; }); renderImport(); }
function impOnlyNew(){ IMP.rows.forEach(function(r){ r.on = !r.dup; }); renderImport(); }

function importConfirm(){
  var sel = IMP.rows.filter(function(r){ return r.on; });
  if(!sel.length){ toast('Бірде-бір жазба белгіленбеген'); return; }

  if(IMP.mode === 'broker'){
    sel.forEach(function(r){
      var b = { id: newId(), acc: r.bacc || IMP.brAcc, t: r.bt, amt: r.amt, date: r.date,
                note: r.note === '—' ? '' : r.note,
                cur: (r.cur === 'USD') ? 'USD' : 'KZT' };
      DB.btx.push(b);
      applyBTx(b, 1);
    });
    save();
    IMP.rows = [];
    document.getElementById('imp-result').innerHTML = '';
    toast(sel.length + ' жазба қосылды');
    brId = IMP.brAcc;
    go('broker');
    return;
  }

  if(!IMP.acc){ toast('Алдымен шот қосыңыз'); return; }
  sel.forEach(function(r){
    var t = { id: newId(), type: r.type, cat: r.cat, amt: r.amt, date: r.date,
              note: r.note === '—' ? '' : r.note, acc: IMP.acc, loan: null };
    stampTx(t);
    DB.tx.push(t);
  });
  recalcBal();
  save();
  IMP.rows = [];
  document.getElementById('imp-result').innerHTML = '';
  toast(sel.length + ' операция қосылды');
  go('ops');
}

/* ================= ТІЛ / ЯЗЫК / LANGUAGE ================= */
/* [қазақша, орысша, ағылшынша] */
var TR = [
/* --- навигация --- */
["Басты","Главная","Home"],["Қаржы","Финансы","Finance"],["Операция","Операции","Activity"],
["Статистика","Статистика","Stats"],["Баптау","Настройки","Settings"],
["Шолу","Обзор","Overview"],["Операциялар","Операции","Transactions"],
["Мақсаттар","Цели","Goals"],["Калькулятор","Калькулятор","Calculator"],
["Бюджет","Бюджет","Budget"],["Бюджет — санат лимиттері","Бюджет — лимиты по категориям","Budget — category limits"],

/* --- басты бет --- */
["Таза капитал","Чистый капитал","Net worth"],["Кіріс","Доход","Income"],["Шығын","Расход","Expense"],
["Аударым","Перевод","Transfer"],["Кіріс · Шығын · Санаттар","Доход · Расход · Категории","Income · Expense · Categories"],
["Менің қаржым","Мои финансы","My finances"],["Активтер","Активы","Assets"],
["Міндеттемелер","Обязательства","Liabilities"],["Таза","Чисто","Net"],
["Банктердегі ақша","Деньги в банках","Money in banks"],["Инвестиция · бөлек","Инвестиции · отдельно","Investments · separate"],
["Соңғы операциялар","Последние операции","Recent transactions"],["Барлығы →","Все →","All →"],
["↑ Оң","↑ Плюс","↑ Positive"],["↓ Теріс","↓ Минус","↓ Negative"],
["Банк үзіндісін жүктеу (PDF · Excel)","Загрузить выписку банка (PDF · Excel)","Import bank statement (PDF · Excel)"],
["Операция жоқ.","Операций нет.","No transactions."],
["Жоғарыдағы + түймесімен қосыңыз.","Добавьте кнопкой + сверху.","Add with the + button above."],

/* --- шоттар --- */
["Банк шоттары","Банковские счета","Bank accounts"],["Брокерлік шоттар","Брокерские счета","Brokerage accounts"],
["Несиелер","Кредиты","Loans"],["Банктер","Банки","Banks"],["Брокер·бөлек","Брокер·отд.","Broker·sep."],
["Несие","Кредит","Loan"],["Банк шоты","Банковский счёт","Bank account"],["Брокерлік шот","Брокерский счёт","Brokerage account"],
["Жеке есептеледі — таза капиталға қосылмайды.","Считается отдельно — в чистый капитал не входит.","Counted separately — not part of net worth."],
["+ Банк шотын қосу","+ Добавить банковский счёт","+ Add bank account"],
["+ Брокерлік шот қосу","+ Добавить брокерский счёт","+ Add brokerage account"],
["+ Несие қосу","+ Добавить кредит","+ Add loan"],
["Банк шоты жоқ. Төмендегі түймемен қосыңыз.","Банковских счетов нет. Добавьте кнопкой ниже.","No bank accounts. Add one below."],
["Брокерлік шот жоқ. Инвестицияңызды осында қосыңыз.","Брокерских счетов нет. Добавьте инвестиции здесь.","No brokerage accounts. Add your investments here."],
["Несие жоқ — тамаша.","Кредитов нет — отлично.","No loans — excellent."],
["Қалдық","Остаток","Balance"],["Несие қалдығы","Остаток кредита","Loan balance"],
["Портфель құны","Стоимость портфеля","Portfolio value"],["Салынған қаражат","Вложено","Invested"],
["Табыс / шығын","Прибыль / убыток","Profit / loss"],["Мөлшерлеме","Ставка","Rate"],
["Ай сайынғы төлем","Ежемесячный платёж","Monthly payment"],["Қалған мерзім","Осталось","Time left"],
["Теңгемен","В тенге","In tenge"],["Қолданылған курс","Использован курс","Rate used"],
["есептелмеді","не рассчитано","not calculated"],["Түзету","Изменить","Edit"],["Өшіру","Удалить","Delete"],
["Жабу","Закрыть","Close"],["‹ Артқа","‹ Назад","‹ Back"],["‹ Жабу","‹ Закрыть","‹ Close"],

/* --- операциялар --- */
["Барлығы","Все","All"],["Іздеу: атау, санат, сома…","Поиск: название, категория, сумма…","Search: name, category, amount…"],
["Операция табылмады.","Операции не найдены.","No transactions found."],["Барлық шот","Все счета","All accounts"],

/* --- шолу --- */
["Қаржылық жағдай","Финансовое положение","Financial position"],["Осы ай","Этот месяц","This month"],
["Активтер құрылымы","Структура активов","Asset breakdown"],["Несие жүктемесі","Кредитная нагрузка","Debt load"],
["Ең көп шығын (осы ай)","Крупнейшие расходы (этот месяц)","Top expenses (this month)"],
["Жинақ үлесі","Норма сбережений","Savings rate"],["Жалпы қарыз","Общий долг","Total debt"],
["Айлық төлем","Платёж в месяц","Monthly payment"],["Кіріске қатысты","От дохода","Of income"],
["Инвестиция портфелі (бөлек)","Инвестиционный портфель (отдельно)","Investment portfolio (separate)"],
["Портфель табысы","Доход портфеля","Portfolio return"],["Шот жоқ.","Счетов нет.","No accounts."],
["Бұл айда шығын жоқ.","В этом месяце расходов нет.","No expenses this month."],

/* --- статистика --- */
["Бүгін","Сегодня","Today"],["Апта","Неделя","Week"],["Өткен ай","Прошлый месяц","Last month"],
["Бастапқы","С","From"],["Соңы","По","To"],["Нәтиже","Итог","Result"],
["Кіріс / Шығын","Доход / Расход","Income / Expense"],["Шығын санаттары","Категории расходов","Expense categories"],
["Кіріс көздері","Источники дохода","Income sources"],
["Бұл кезеңде дерек жоқ.","За этот период данных нет.","No data for this period."],
["Диаграмма үшін дерек жоқ.","Нет данных для графика.","No data for the chart."],
["Бұл айда кіріс жазылмаған.","В этом месяце доходов нет.","No income this month."],
["Бұл айда шығын жазылмаған.","В этом месяце расходов нет.","No expenses this month."],

/* --- мақсаттар --- */
["Жиналған","Накоплено","Saved"],["+ Мақсат қосу","+ Добавить цель","+ Add goal"],
["Мақсат қосу","Новая цель","New goal"],["Мақсат","Цель","Goal"],
["Мақсат әлі жоқ.","Целей пока нет.","No goals yet."],
["Жинайтын сомаңызды белгілеп қойыңыз.","Укажите сумму, которую копите.","Set the amount you are saving for."],
["Мақсат сомасы, ₸","Сумма цели, ₸","Goal amount, ₸"],["Қазір жиналған, ₸","Уже накоплено, ₸","Already saved, ₸"],
["Салым қосу, ₸","Пополнить, ₸","Add funds, ₸"],["Қосу","Добавить","Add"],
["Қай шоттан алынды","С какого счёта взято","Taken from which account"],
["Шотсыз — тек белгілеу","Без счёта — только отметка","No account — just track"],
["Салым тарихы","История пополнений","Deposit history"],
["Шотсыз","Без счёта","No account"],["Орындалды","Выполнено","Progress"],["Қалды","Осталось","Remaining"],
["Мақсатты өшіру","Удалить цель","Delete goal"],

/* --- калькулятор --- */
["Қаржылық есептеулер","Финансовые расчёты","Financial calculations"],
["Инвестиция калькуляторы","Инвестиционный калькулятор","Investment calculator"],
["Статистика есебі","Отчёт по статистике","Statistics report"],
["Шотты салыстыру","Сверка счетов","Reconcile accounts"],
["Салыстыру →","Сверка →","Reconcile →"],
["Сандар банктегімен сәйкес пе?","Цифры сходятся с банком?","Do the numbers match your bank?"],
["Банктегі нақты сан мен қосымшадағы санды сәйкестендіру","Сверить фактический остаток в банке с приложением","Match your real bank balance with the app"],
["Банк қосымшасын ашып, әр шоттың нақты қалдығын жазыңыз. Айырма шықса, қосымша оны түзете алады — операциялар тарихы бұзылмайды.","Откройте приложение банка и впишите фактический остаток по каждому счёту. Если появится разница, приложение её исправит — история операций не пострадает.","Open your bank app and enter the real balance for each account. If there's a gap, the app can fix it — your transaction history stays intact."],
["Санды жазсаңыз, айырма осында шығады.","Впишите число — разница появится здесь.","Enter a number and the difference shows up here."],
["✓ Сәйкес келеді","✓ Совпадает","✓ Matches"],
["Айырма","Разница","Difference"],
["Банкте артық — жазылмай қалған кіріс бар сияқты.","В банке больше — похоже, не записан доход.","The bank has more — some income is probably missing."],
["Банкте кем — жазылмай қалған шығын бар сияқты.","В банке меньше — похоже, не записан расход.","The bank has less — some spending is probably missing."],
["Қорытынды","Итог","Summary"],
["Айырманы түзету","Исправить разницу","Fix the difference"],
["Айырма жоқ","Разницы нет","No difference"],
["Түзету «Түзету операциясы» деген жазба ретінде қосылады, сондықтан кейін қайдан шыққанын көресіз.","Исправление добавляется отдельной записью, поэтому потом видно, откуда взялась сумма.","The fix is added as its own transaction, so you can see later where the amount came from."],
["Қосымшада","В приложении","In the app"],
["Депозит калькуляторы","Депозитный калькулятор","Deposit calculator"],
["Салық калькуляторы","Налоговый калькулятор","Tax calculator"],
["Кезең","Период","Period"],
["Кіріс санаттары","Категории доходов","Income categories"],
["Үлесі","Доля","Share"],
["Сома","Сумма","Amount"],
["Түрі","Тип","Type"],
["Күні","Дата","Date"],
["Табыс · Мерзім · Күрделі пайыз","Доход · Срок · Сложный процент","Return · Term · Compound interest"],
["Несие калькуляторы","Кредитный калькулятор","Loan calculator"],
["Ай төлем · Ерте өтеу · Кесте","Платёж · Досрочное · График","Payment · Early payoff · Schedule"],
["Күрделі пайыз","Сложный процент","Compound interest"],
["Аннуитетті · Дифференциалды","Аннуитетный · Дифференцированный","Annuity · Differentiated"],
["Табыс","Доход","Return"],["Мерзім","Срок","Term"],["Бастапқы сома","Начальная сумма","Initial amount"],
["Ай сайынғы үлес","Ежемесячный взнос","Monthly contribution"],["Мақсатты сома","Целевая сумма","Target amount"],
["Реинвестиция","Реинвестирование","Reinvest"],
["Қосылған — күрделі пайыз","Включено — сложный процент","On — compound interest"],
["Қосылмаған — қарапайым пайыз","Выключено — простой процент","Off — simple interest"],
["Жылдық мөлшерлеме, %","Годовая ставка, %","Annual rate, %"],["Мерзімі","Срок","Term"],
["жыл","лет","years"],["ай","мес.","months"],
["Мерзім соңындағы сома","Сумма в конце срока","Final amount"],
["Пайыздық табыс","Процентный доход","Interest earned"],["Өсім","Рост","Growth"],
["Жыл сайынғы өсім","Рост по годам","Year-by-year growth"],["Жыл","Год","Year"],["Салынған","Вложено","Invested"],
["Сома","Сумма","Amount"],["Мақсатқа жету мерзімі","Срок достижения цели","Time to reach goal"],
["Жинақталған сома","Накопленная сумма","Accumulated"],["Қазірдің өзінде жеткен","Уже достигнуто","Already reached"],
["Несие сомасы","Сумма кредита","Loan amount"],["Пайызын есептеу","Расчёт ставки","Find the rate"],
["Аннуитетті","Аннуитетный","Annuity"],["Дифференциалды","Дифференцированный","Differentiated"],
["Ерте өтеу (міндетті емес)","Досрочное погашение (не обязательно)","Early payoff (optional)"],
["ай №","№ месяца","month #"],["Барлық төлем","Всего выплат","Total paid"],
["Артық төлем","Переплата","Overpayment"],["Артық төлем үлесі","Доля переплаты","Overpayment share"],
["Төлем кестесі","График платежей","Payment schedule"],["Ай","Мес.","Mo."],["Төлем","Платёж","Payment"],
["Пайыз","Проценты","Interest"],["Бірінші айдағы төлем","Платёж первого месяца","First month payment"],
["Соңғы төлем","Последний платёж","Final payment"],
["Мәндерді толтырыңыз.","Заполните поля.","Fill in the values."],
["Мақсатты соманы толтырыңыз.","Укажите целевую сумму.","Enter the target amount."],
["Төлем тым аз — бұл несие өтелмейді.","Платёж слишком мал — кредит не погасится.","Payment too small — the loan will never be repaid."],

/* --- брокер --- */
["Жеке есеп — жалпы ақшаға қосылмайды","Отдельный учёт — в общие деньги не входит","Separate — not counted in total money"],
["Құнын жаңарту","Обновить стоимость","Update value"],
["Қай шотқа жазылсын","На какой счёт записать","Which account to use"],
["(шот автоматты құрылды)","(счёт создан автоматически)","(account created automatically)"],
["(автоматты таңдалды)","(выбран автоматически)","(selected automatically)"],
["Брокерлік шот теңгені де, долларды да бірге ұстайды. Валютаны таңдаудың қажеті жоқ — файл жүктегенде әрқайсысы өз валютасында есептеледі. Портфель құнын кейін «Құнын жаңарту» арқылы қоясыз.","Брокерский счёт держит и тенге, и доллары одновременно. Валюту выбирать не нужно — при импорте каждая сумма считается в своей валюте. Стоимость портфеля задаётся позже через «Обновить стоимость».","A brokerage account holds both tenge and dollars. No currency choice needed — on import each amount stays in its own currency. Set the portfolio value later via Update value."],
["Доллармен, $","В долларах, $","In dollars, $"],["Теңгемен, ₸","В тенге, ₸","In tenge, ₸"],
["Доллар","Доллар","Dollars"],["Теңге","Тенге","Tenge"],
["Барлығы теңгемен","Итого в тенге","Total in tenge"],["Құн көзі","Источник стоимости","Value source"],
["Портфель құны жазбалардан қайта есептеледі, қолмен қойылған сома жойылады. Жалғастырасыз ба?","Стоимость будет пересчитана по записям, введённая вручную сумма удалится. Продолжить?","The value will be recalculated from records; the manual amount will be discarded. Continue?"],
["Құнды жазбалардан қайта есептеу","Пересчитать стоимость по записям","Recalculate value from records"],
["Курс","Курс","Rate"],
["Таңдау","Выбрать","Select"],["Кері","Инверсия","Invert"],
["Белгіні алу","Снять все","Deselect"],["Ештеңе таңдалмаған","Ничего не выбрано","Nothing selected"],
["жазба өшіріледі. Жалғастырасыз ба?","записей будет удалено. Продолжить?","records will be deleted. Continue?"],
["жазба өшірілді","записей удалено","records deleted"],
["Валюта бойынша","По валютам","By currency"],["Тізім","Список","List"],
["қолмен қойылған","задано вручную","set manually"],
["жазбалардан есептелген","рассчитано по записям","calculated from records"],
["Дивиденд · купон","Дивиденды · купоны","Dividends · coupons"],
["Комиссия · салық","Комиссии · налоги","Fees · taxes"],
["Салынғанды қайта есептеу","Пересчитать вложения","Recalculate invested"],
["Салынған қаражат жазбалар бойынша қайта есептеледі:","Вложения будут пересчитаны по записям:","Invested will be recalculated from records:"],
["Жалғастырасыз ба?","Продолжить?","Continue?"],
["Қайта есептелді","Пересчитано","Recalculated"],["Операция қосу","Добавить операцию","Add transaction"],
["Файл жүктеу","Загрузить файл","Import file"],["Шотты өшіру","Удалить счёт","Delete account"],
["Салым","Пополнение","Deposit"],["Шығару","Вывод","Withdrawal"],["Дивиденд","Дивиденды","Dividend"],
["Комиссия · салық","Комиссия · налог","Fee · tax"],["Банктен аударым","Перевод из банка","Transfer from bank"],
["Брокерлік операция","Брокерская операция","Brokerage transaction"],["Түрі","Тип","Type"],
["Жазба жоқ.","Записей нет.","No records."],
["Файл жүктеңіз немесе қолмен қосыңыз.","Загрузите файл или добавьте вручную.","Import a file or add manually."],
["Шот құнын жаңарту","Обновить стоимость счёта","Update account value"],
["Ағымдағы құны, ₸","Текущая стоимость, ₸","Current value, ₸"],
["Салынған қаражат (барлығы), ₸","Всего вложено, ₸","Total invested, ₸"],

/* --- импорт --- */
["PDF · Excel · CSV үзінді","PDF · Excel · CSV выписка","PDF · Excel · CSV statement"],
["Банк үзіндісін таңдаңыз","Выберите выписку банка","Choose a bank statement"],
["Файл таңдау","Выбрать файл","Choose file"],
["Файл ешқайда жіберілмейді — телефонның өз ішінде оқылады.","Файл никуда не отправляется — читается прямо на телефоне.","The file is never uploaded — it is read on your phone."],
["Қай банктің шотына жазылсын","На счёт какого банка записать","Which bank account to use"],
["Тізімде жоқ па? Бір басып қосыңыз","Нет в списке? Добавьте одним нажатием","Not listed? Add it in one tap"],
["Барлығын белгілеу","Выбрать все","Select all"],["Барлығын алып тастау","Снять все","Deselect all"],
["Тек жаңалары","Только новые","New only"],["бұрын қосылған","уже добавлено","already added"],
["Болдырмау","Отмена","Cancel"],["Брокерлік есеп","Брокерский отчёт","Brokerage report"],
["Брокер есебін таңдаңыз","Выберите отчёт брокера","Choose a brokerage report"],
["Файл оқылып жатыр…","Файл читается…","Reading the file…"],
["Бұл файлдан операция табылмады.","В этом файле операции не найдены.","No transactions found in this file."],
["Файлды оқу мүмкін болмады.","Не удалось прочитать файл.","Could not read the file."],
["Банк шоты жоқ — төменнен таңдаңыз","Счетов нет — выберите ниже","No accounts — pick one below"],
["Алдымен шот қосыңыз","Сначала добавьте счёт","Add an account first"],

/* --- баптау --- */
["Дерек және көшірме","Данные и резервная копия","Data and backup"],["Тіл","Язык","Language"],
["Қайталанған операциялар","Дубликаты операций","Duplicate transactions"],
["Тексеру және тазалау","Проверить и очистить","Check and clean"],
["Қайталанған операция жоқ.","Дубликатов нет.","No duplicates."],
["Доллар курсы","Курс доллара","USD rate"],["Интернеттен жаңарту","Обновить из интернета","Update online"],
["Немесе қолмен жазыңыз (1 $ = ? ₸)","Или введите вручную (1 $ = ? ₸)","Or enter manually (1 $ = ? ₸)"],
["Сақтау","Сохранить","Save"],["Банк үзіндісі","Выписка банка","Bank statement"],
["Дерек көшірмесі","Резервная копия","Backup"],["Деректі сақтау","Сохранить данные","Save data"],
["Деректі ашу","Открыть данные","Open data"],["Ашу","Открыть","Open"],["Ашылды","Открыто","Opened"],
["Барлығын өшіру","Удалить всё","Delete everything"],["Барлық деректі өшіру","Удалить все данные","Delete all data"],
["Шоттар, операциялар және мақсаттар қайтарылмайды.","Счета, операции и цели не восстановить.","Accounts, transactions and goals cannot be restored."],
["Қосымша туралы","О приложении","About"],
["PDF немесе Excel файлдан операцияларды автоматты қосу.","Автоматически добавить операции из PDF или Excel.","Add transactions automatically from PDF or Excel."],

/* --- операция терезесі --- */
["Операцияны түзету","Изменить операцию","Edit transaction"],["Санат","Категория","Category"],
["Қай шоттан","С какого счёта","From account"],["Қай шотқа түсті","На какой счёт","To account"],
["Қай шотқа","На какой счёт","To account"],["Қай несиені өтейді","Какой кредит погашает","Which loan it repays"],
["Күні","Дата","Date"],["Түсініктеме","Комментарий","Note"],["Міндетті емес","Не обязательно","Optional"],
["Кемінде екі шот керек","Нужно минимум два счёта","At least two accounts needed"],
["Операцияны өшіру","Удалить операцию","Delete transaction"],["Қайдан","Откуда","From"],["Қайда","Куда","To"],
["Шот","Счёт","Account"],

/* --- шот терезесі --- */
["Шот қосу","Новый счёт","New account"],["Несие қосу","Новый кредит","New loan"],
["Банкті таңдаңыз","Выберите банк","Choose a bank"],["Валютасы","Валюта","Currency"],
["₸ теңге","₸ тенге","₸ tenge"],["$ доллар","$ доллар","$ dollar"],["Белгіше","Значок","Icon"],
["Атауы","Название","Name"],["Қалдық, ₸","Остаток, ₸","Balance, ₸"],
["Несие қалдығы, ₸","Остаток кредита, ₸","Loan balance, ₸"],["Портфель құны, ₸","Стоимость портфеля, ₸","Portfolio value, ₸"],
["Ай сайынғы төлем, ₸","Ежемесячный платёж, ₸","Monthly payment, ₸"],["Қолма-қол","Наличные","Cash"],

/* --- бюджет --- */
["Айлық шығын шектеуі","Месячный лимит расходов","Monthly spending limit"],
["Шектелген","Лимит","Limit"],["Жұмсалды","Потрачено","Spent"],
["Санатқа айлық шек қойыңыз. 80%-ға жеткенде ескертеміз. 0 деп қойсаңыз — шек жоқ.","Задайте месячный лимит по категории. Предупредим на 80%. 0 — без лимита.","Set a monthly limit per category. We warn at 80%. 0 means no limit."],
["шек жоқ","без лимита","no limit"],

/* --- санаттар --- */
["Тамақ","Еда","Food"],["Көлік","Транспорт","Transport"],["Тұрғын үй","Жильё","Housing"],
["Байланыс","Связь","Phone & internet"],["Киім","Одежда","Clothes"],["Денсаулық","Здоровье","Health"],
["Несие төлемі","Платёж по кредиту","Loan payment"],["Ойын-сауық","Развлечения","Entertainment"],
["Білім","Образование","Education"],["Сыйлық","Подарки","Gifts"],["Басқа","Другое","Other"],
["Жалақы","Зарплата","Salary"],["Бизнес","Бизнес","Business"],["Фриланс","Фриланс","Freelance"],
["Инвестиция","Инвестиции","Investments"],["Несие алу","Получение кредита","Loan received"],

/* --- айлар мен күндер --- */
["Қаңтар","Январь","January"],["Ақпан","Февраль","February"],["Наурыз","Март","March"],
["Сәуір","Апрель","April"],["Мамыр","Май","May"],["Маусым","Июнь","June"],["Шілде","Июль","July"],
["Тамыз","Август","August"],["Қыркүйек","Сентябрь","September"],["Қазан","Октябрь","October"],
["Қараша","Ноябрь","November"],["Желтоқсан","Декабрь","December"],
["қаңтар","января","January"],["ақпан","февраля","February"],["наурыз","марта","March"],
["сәуір","апреля","April"],["мамыр","мая","May"],["маусым","июня","June"],["шілде","июля","July"],
["тамыз","августа","August"],["қыркүйек","сентября","September"],["қазан","октября","October"],
["қараша","ноября","November"],["желтоқсан","декабря","December"],
["Дүйсенбі","Понедельник","Monday"],["Сейсенбі","Вторник","Tuesday"],["Сәрсенбі","Среда","Wednesday"],
["Бейсенбі","Четверг","Thursday"],["Жұма","Пятница","Friday"],["Сенбі","Суббота","Saturday"],
["Жексенбі","Воскресенье","Sunday"],

/* --- хабарламалар --- */
["Кіріс қосылды","Доход добавлен","Income added"],["Шығын қосылды","Расход добавлен","Expense added"],
["Аударым жасалды","Перевод выполнен","Transfer done"],["Өзгертілді","Изменено","Updated"],
["Өшірілді","Удалено","Deleted"],["Сақталды","Сохранено","Saved"],["Жаңартылды","Обновлено","Updated"],
["Соманы жазыңыз","Укажите сумму","Enter an amount"],["Атауын жазыңыз","Укажите название","Enter a name"],
["Мақсат сомасын жазыңыз","Укажите сумму цели","Enter the goal amount"],
["Мақсат қосылды","Цель добавлена","Goal added"],["Салым қосылды","Пополнение добавлено","Funds added"],
["Курсты жазыңыз","Укажите курс","Enter the rate"],["Курс сақталды","Курс сохранён","Rate saved"],
["Курс жаңартылды","Курс обновлён","Rate updated"],["Курс жаңартылуда…","Курс обновляется…","Updating rate…"],
["Курс алынбады — интернетті тексеріңіз","Курс не получен — проверьте интернет","Could not fetch the rate — check your connection"],
["Курс белгісіз — басып жаңартыңыз","Курс неизвестен — нажмите, чтобы обновить","Rate unknown — tap to update"],
["Қай шотқа екенін таңдаңыз","Выберите счёт получателя","Choose the destination account"],
["Қалпына келтірілді","Восстановлено","Restored"],["Файл оқылмады","Файл не прочитан","File could not be read"],
["Бұл шоттар бар","Такие счета уже есть","These accounts already exist"],
["Бірде-бір жазба белгіленбеген","Ничего не отмечено","Nothing selected"],
["жаңа ғана","только что","just now"],["бүгін","сегодня","today"],["(қолмен)","(вручную)","(manual)"],

/* --- тұрақты операциялар --- */
["Тұрақты","Регулярные","Recurring"],["Тұрақты операциялар","Регулярные операции","Recurring transactions"],
["Тұрақты операция","Регулярная операция","Recurring transaction"],
["Ай сайынғы кіріс","Доход в месяц","Monthly income"],["Ай сайынғы шығын","Расход в месяц","Monthly expense"],
["Айдың қай күні","В какой день месяца","Day of month"],["Қай шот","Какой счёт","Account"],
["Мысалы: пәтер жалдау","Например: аренда квартиры","E.g. rent"],
["ай сайын","ежемесячно","monthly"],["келесі","следующая","next"],["тоқтатылған","остановлено","paused"],
["Бір рет жазсаңыз, ай сайын белгіленген күні өзі қосылады. Қосымшаны ашқанда өтіп кеткен айлар да толтырылады.","Записывается один раз и добавляется каждый месяц в указанный день. Пропущенные месяцы заполняются при открытии.","Added once, repeats every month on the chosen day. Missed months are filled in when you open the app."],
["Тоқтатылды","Остановлено","Paused"],["Қосылды","Включено","Enabled"],

/* --- PDF есеп --- */
["PDF есеп жасау","Сформировать PDF-отчёт","Generate PDF report"],
["Кестені PDF-ке шығару","Выгрузить график в PDF","Export schedule to PDF"],
["Несие төлем кестесі","График платежей по кредиту","Loan payment schedule"],
["Несиелер","Кредиты","Loans"],["Айлық төлем","Ежемесячный платёж","Monthly payment"],
["Қалған мерзім","Осталось","Time left"],["Барлығы айына","Итого в месяц","Total per month"],
["Негізгі қарыз","Основной долг","Principal"],
["PDF дайындалуда…","Готовим PDF…","Preparing PDF…"],
["PDF сақталды","PDF сохранён","PDF saved"],
["PDF жасалмады — интернетті тексеріңіз","PDF не создан — проверьте интернет","Could not create the PDF — check your connection"],
["Жіберілді","Отправлено","Shared"],

/* --- қарыздар мен калькуляторлар --- */
["Қарыздар","Долги","Debts"],["Адамдарға берген және алған ақша","Деньги, данные и взятые в долг","Money lent and borrowed"],
["Маған қарыз","Мне должны","Owed to me"],["Мен қарызбын","Я должен","I owe"],
["Қарыз жазу","Новая запись","New record"],["Мен бердім","Я дал","I lent"],["Мен алдым","Я взял","I borrowed"],
["Кімге / кімнен","Кому / от кого","To / from whom"],["Аты-жөні","Имя","Name"],
["Қай шоттан бердім","С какого счёта дал","From which account"],["Қай шотқа түсті","На какой счёт","To which account"],
["Қайтару мерзімі (міндетті емес)","Срок возврата (не обязательно)","Due date (optional)"],
["Қайтарылған сома","Возвращённая сумма","Repaid amount"],
["Маған қайтарған сома","Мне вернули","Repaid to me"],["Мен қайтарған сома","Я вернул","I repaid"],
["Қай шот арқылы","Через какой счёт","Which account"],["Төлемді жазу","Записать платёж","Record payment"],
["Төлем тарихы","История платежей","Payment history"],["Жазбаны өшіру","Удалить запись","Delete record"],
["Қарызға берілді","Записано: дал в долг","Recorded: lent"],["Қарыз алынды","Записано: взял в долг","Recorded: borrowed"],
["Толық жабылды","Полностью закрыт","Fully repaid"],["Төлем жазылды","Платёж записан","Payment recorded"],
["Кімге екенін жазыңыз","Укажите имя","Enter a name"],
["Ешкім қарыз емес.<br>Біреуге ақша берсеңіз, төмендегі түймемен жазып қойыңыз.","Вам никто не должен.<br>Дали кому-то денег — запишите кнопкой ниже.","Nobody owes you.<br>Lent someone money? Add it with the button below."],
["Қарызыңыз жоқ.<br>Біреуден ақша алсаңыз, төмендегі түймемен жазып қойыңыз.","У вас нет долгов.<br>Взяли у кого-то — запишите кнопкой ниже.","You owe nothing.<br>Borrowed from someone? Add it below."],
["+ Мен қарызға бердім","+ Я дал в долг","+ I lent money"],
["+ Мен қарызға алдым","+ Я взял в долг","+ I borrowed money"],
["мерзімі өтті","просрочен","overdue"],["жабылды","закрыт","closed"],["дейін","до","by"],
["Бердім","Дал","Lent"],["Алдым","Взял","Borrowed"],["Қайтарылды","Возвращено","Repaid"],
["Қарыз мерзімі өтті","Просроченные долги","Overdue debts"],["қарыз","долг","debt"],

["Банк салымының табысы","Доход по вкладу","Deposit return"],
["Капитализация · Толықтыру","Капитализация · Пополнение","Compounding · Top-ups"],
["Салым сомасы, ₸","Сумма вклада, ₸","Deposit amount, ₸"],["Мерзімі, ай","Срок, мес.","Term, months"],
["Ай сайынғы толықтыру, ₸","Ежемесячное пополнение, ₸","Monthly top-up, ₸"],
["Капитализация","Капитализация","Compounding"],
["Ай сайын капитализация — пайызға пайыз","Ежемесячная капитализация — процент на процент","Monthly compounding — interest on interest"],
["Пайыз мерзім соңында бір рет төленеді","Проценты выплачиваются в конце срока","Interest paid at the end of the term"],
["Тиімді жылдық өсім","Эффективная годовая доходность","Effective annual return"],
["Айына орташа табыс","Средний доход в месяц","Average monthly return"],

["ЖК · оңайлатылған декларация","ИП · упрощённая декларация","Sole trader · simplified"],
["ЖК · оңайлатылған декларация (910-форма)","ИП · упрощённая декларация (форма 910)","Sole trader · simplified (form 910)"],
["Кезеңдегі табыс, ₸","Доход за период, ₸","Income for the period, ₸"],
["Кезең, ай","Период, мес.","Period, months"],
["Салық мөлшерлемесі, %","Ставка налога, %","Tax rate, %"],
["Өзіңізге жариялайтын айлық табыс, ₸","Заявляемый доход в месяц, ₸","Declared monthly income, ₸"],
["Барлығы төлеу керек","Итого к уплате","Total due"],["Бөлшектеп","Детализация","Breakdown"],
["Өз атыңызға аударымдар","Отчисления за себя","Contributions for yourself"],
["Жарияланған табыс","Заявленный доход","Declared income"],
["Пайдалы сандар","Полезные цифры","Useful figures"],
["Салық жүктемесі","Налоговая нагрузка","Tax burden"],
["Қолда қалады","Останется на руках","Left after tax"],
["Айына бөлгенде","В пересчёте на месяц","Per month"],
["Табысты жазыңыз.","Укажите доход.","Enter the income."],

/* --- брокер импорты --- */
["Шоттар бойынша бөлінді","Разделено по счетам","Split by account"],
["Брокер есебін жүктеу (шоттарға бөледі)","Загрузить отчёт брокера (разделит по счетам)","Import broker report (splits by account)"],
["Алдымен брокерлік шот қосыңыз","Сначала добавьте брокерский счёт","Add a brokerage account first"],

/* --- тақырып пен жестер --- */
["Тақырып","Тема","Theme"],["Ашық","Светлая","Light"],["Қараңғы","Тёмная","Dark"],
["Жүйе бойынша","Как в системе","System"],
["Операцияны солға сырғытсаңыз — өшіріледі, оңға сырғытсаңыз — түзетіледі.","Свайп влево — удалить, вправо — изменить.","Swipe left to delete, right to edit."],

/* --- диаграммалар мен бөлісу --- */
["Санаттар үлесі","Доли категорий","Category split"],
["Шығын санаттарының үлесі","Доли категорий расходов","Expense category split"],
["Кіріс көздерінің үлесі","Доли источников дохода","Income source split"],
["12 айлық тенденция","Тренд за 12 месяцев","12-month trend"],
["Барлық шығын","Все расходы","All expenses"],["Барлық кіріс","Все доходы","All income"],
["Басқалары","Прочее","Other"],
["Айлық орташа кіріс","Средний доход в месяц","Average monthly income"],
["Айлық орташа шығын","Средний расход в месяц","Average monthly expense"],
["Ең табысты ай","Самый прибыльный месяц","Best month"],

/* --- қорғаныс пен автосақтау --- */
["Автоматты көшірмелер (соңғы 7 күн)","Автоматические копии (последние 7 дней)","Automatic snapshots (last 7 days)"],
["Жад","Память","Storage"],
["пайдаланылды","использовано","used"],["қолжетімді","доступно","available"],
["Дерек IndexedDB қоймасында — көлем шегі іс жүзінде шексіз.","Данные в хранилище IndexedDB — предел объёма практически не ограничен.","Data is stored in IndexedDB — practically no size limit."],
["IndexedDB қолжетімсіз, дерек браузердің қарапайым жадында (шегі ~5 МБ).","IndexedDB недоступен, данные в обычном хранилище браузера (лимит ~5 МБ).","IndexedDB unavailable; data is in basic browser storage (~5 MB limit)."],
["Әзірге көшірме жоқ — ертең өзі жасалады.","Копий пока нет — появятся завтра.","No snapshots yet — one will appear tomorrow."],
["Қайтару","Вернуть","Restore"],["Қайтарылды","Возвращено","Restored"],
["Осы күнгі күйге қайтарамыз ба?","Вернуться к состоянию на эту дату?","Restore the state from this date?"],
["Көшірме табылмады","Копия не найдена","Snapshot not found"],
["Көшірме оқылмады","Копию не удалось прочитать","Snapshot could not be read"],
["Дерек әр өзгерісте телефонға өзі сақталады. Файл көшірмесі әлі жасалмаған.","Данные сохраняются на телефон автоматически. Файловая копия ещё не создана.","Data is saved to your phone automatically. No file backup yet."],

/* --- ескертулер --- */
["Дерек сақталмайды","Данные не сохраняются","Data is not being saved"],
["Көшірме жасаңыз","Сделайте копию","Make a backup"],
["Көшірме ескірді","Копия устарела","Backup is outdated"],
["Дерек әлі жоқ","Данных пока нет","No data yet"],
["Дерек тек осы телефонда сақталады.","Данные хранятся только на этом телефоне.","Data is stored only on this phone."],

/* --- басты бетті реттеу --- */
["Басты бетті реттеу","Настроить главную","Customize home"],
["Басты бет","Главный экран","Home screen"],
["Қай карта көрінеді және қандай ретпен","Какие карточки видны и в каком порядке","Which cards show, and in what order"],
["Карталар","Карточки","Cards"],
["Көзді басып жасырыңыз, көрсеткішпен ретін ауыстырыңыз.","Глазом — скрыть, стрелками — поменять порядок.","Tap the eye to hide, arrows to reorder."],
["Басты беттегі карталардың ретін өзгертіп, керексізін жасыруға болады.","Порядок карточек на главной можно менять, лишние — скрывать.","Reorder the cards on the home screen and hide the ones you do not need."],
["Әдепкі қалпына қайтару","Вернуть по умолчанию","Reset to default"],
["Әдепкі қалпына келтірілді","Возвращено по умолчанию","Reset to default"],
["Жылдам сілтемелер","Быстрые ссылки","Quick links"],
["Айдағы шығын","Расходы за месяц","Spending this month"],
["Статистика →","Статистика →","Stats →"],
["Санат лимиті қойылмаған. Бюджет бөлімінен қойыңыз.","Лимиты по категориям не заданы. Задайте их в разделе «Бюджет».","No category limits set. Add them in Budget."],
["Бұл айда шығын жоқ.","В этом месяце расходов нет.","No spending this month."],
["Мақсат әлі жоқ. Жинайтын сомаңызды белгілеп қойыңыз.","Целей пока нет. Отметьте сумму, которую копите.","No goals yet. Set an amount to save toward."],

/* --- инвестиция беті --- */
["Брокерлер","Брокеры","Brokers"],
["Валюта бойынша","По валютам","By currency"],
["Портфель","Портфель","Portfolio"],
["Барлығын салыстыру →","Сравнить все →","Compare all →"],
["Брокерлік шот жоқ.","Брокерских счетов нет.","No brokerage accounts."],
["Төмендегі түймемен қосыңыз.","Добавьте кнопкой ниже.","Add one with the button below."],
["Дерек жоқ.","Данных нет.","No data."],
["Барлығы теңгемен","Всего в тенге","Total in tenge"],

/* --- қалдық пен көшірме --- */
["Шот қалдығы","Остаток счёта","Account balance"],
["Қалдықты қайта есептеу","Пересчитать остаток","Recalculate balance"],
["Қалдық қайта есептелді","Остаток пересчитан","Balance recalculated"],
["Қалдық жазбалар бойынша есептеледі. Бір жерде сан күмәнді көрінсе, қайта есептеп көріңіз — дерек өзгермейді.","Остаток считается по записям. Если где-то цифра выглядит странно — пересчитайте, данные не изменятся.","The balance is computed from your records. If a number looks off, recalculate — nothing is deleted."],
["Қазіргі нақты қалдықты жазыңыз — айырма бастапқы қалдыққа жазылады, операциялар тарихы бұзылмайды.","Впишите текущий фактический остаток — разница уйдёт в начальный остаток, история операций не пострадает.","Enter the real current balance — the difference goes to the opening balance, and your history stays intact."],
["Файл жарамсыз","Файл не подходит","Invalid file"],
["Файл құрылымы дұрыс емес","Структура файла неверна","The file structure is wrong"],
["Бұл Қаржы көшірмесі емес","Это не копия Қаржы","This is not a Qarzhy backup"],
["Файлдың ішіндегі дерек бүлінген","Данные внутри файла повреждены","The data inside the file is damaged"],
["жазба бүлінген","записей повреждено","records are damaged"],
["Көшірмедегі дерек:","В копии:","In this backup:"],
["Жазылған күні","Дата копии","Backup date"],
["белгісіз","неизвестно","unknown"],
["Қазіргі дерегіңіз","Сейчас у вас","You currently have"],
["Ол ауыстырылады. Жалғастырасыз ба?","Оно будет заменено. Продолжить?","It will be replaced. Continue?"],
["операция","операций","transactions"],
["шот","счетов","accounts"],
["қарыз","долгов","debts"],
["мақсат","целей","goals"],
["Болдырылмады","Отменено","Undone"],

/* --- болжам, CSV, жіберу --- */
["Ай соңына болжам","Прогноз на конец месяца","Month-end forecast"],
["Қалады","Останется","Left"],
["Қазір шоттарда","Сейчас на счетах","In accounts now"],
["Күнделікті орташа шығын","Средний расход в день","Average daily spending"],
["Күтілетін кіріс","Ожидаемый доход","Expected income"],
["Айдың болжамды шығыны","Прогноз расходов за месяц","Forecast spending this month"],
["ай аяқталды","месяц закончился","month is over"],
["Мақсат орындалды","Цель достигнута","Goal reached"],
["Қарқын белгісіз — салым жасаңыз","Темп неизвестен — сделайте взнос","No pace yet — add a contribution"],
["Осы қарқынмен өте ұзаққа созылады","При таком темпе это займёт очень долго","At this pace it will take a very long time"],
["Көшірмені жіберу (Telegram · Drive · пошта)","Отправить копию (Telegram · Drive · почта)","Send a backup (Telegram · Drive · mail)"],
["Деректі файлға сақтау","Сохранить данные в файл","Save data to a file"],
["Операцияларды Excel-ге (CSV)","Операции в Excel (CSV)","Transactions to Excel (CSV)"],
["Дерек сақталмады!","Данные не сохранены!","Data was not saved!"],
["Дерек сақталмады","Данные не сохранены","Data was not saved"],
["Соңғы өзгеріс телефон жадына жазылмады. Қосымшаны жаппай тұрып, Баптау → Деректі сақтау арқылы файл көшірмесін жасаңыз.","Последнее изменение не записалось в память телефона. Не закрывая приложение, сделайте копию: Настройки → Сохранить данные.","The last change was not written to your phone. Before closing the app, make a backup: Settings → Save data."],

/* --- навигация, график, есеп --- */
["Операцияларын көру","Показать операции","View transactions"],
["Операцияларын ашу","Открыть операции","Open transactions"],
["↓ Операциялар тізіміне","↓ К списку операций","↓ To the transaction list"],
["✕ Сүзгіні алу — барлық операция","✕ Снять фильтр — все операции","✕ Clear filter — all transactions"],
["нүктені басыңыз","нажмите на точку","tap a point"],
["Осы айдың операцияларын көру","Показать операции этого месяца","View this month's transactions"],
["Өткен айдан үнемделді","Сэкономлено против прошлого месяца","Saved vs last month"],
["Өткен айдан артық жұмсалды","Потрачено больше, чем в прошлом месяце","Spent more than last month"],
["12 айдың жиынтығы","Итог за 12 месяцев","12-month summary"],
["Есепті жіберу (PDF · Excel)","Отправить расчёт (PDF · Excel)","Send the result (PDF · Excel)"],
["Есепті қалай жіберейін?","В каком виде отправить?","How should I send it?"],
["Экранда тұрған нәтиже сол күйінде файлға айналады.","Результат с экрана станет файлом как есть.","The result on screen becomes a file as it is."],
["PDF — оқуға және басып шығаруға","PDF — читать и печатать","PDF — to read and print"],
["Excel (CSV) — сандармен жұмыс істеуге","Excel (CSV) — работать с числами","Excel (CSV) — to work with the numbers"],
["Болдырмау","Отмена","Cancel"],
["Алдымен есептеңіз","Сначала посчитайте","Calculate something first"],
["Кесте табылмады","Таблица не найдена","No table found"],
["Бұл есеп шамамен берілген, шарт банкке қарай өзгеруі мүмкін.","Расчёт примерный, условия банка могут отличаться.","This is an estimate; bank terms may differ."],
["Инвестиция калькуляторы","Инвестиционный калькулятор","Investment calculator"],
["Несие калькуляторы","Кредитный калькулятор","Loan calculator"],
["Тұрақты операциялар","Регулярные операции","Recurring transactions"],
["Брокерлік шот","Брокерский счёт","Brokerage account"],
["Файл жүктеу","Загрузка файла","File import"],
["Басты","Главная","Home"],
["Баптау","Настройки","Settings"],
["Шолу","Обзор","Overview"]
];

var LANG = 'kk';
var DICT_RU = {}, DICT_EN = {};
TR.forEach(function(r){ DICT_RU[r[0]] = r[1]; DICT_EN[r[0]] = r[2]; });

var TR_RULES = [
  [/^(\d+) шот$/, "Счетов: $1", "$1 accounts"],
  [/^(\d+) банк · (\d+) брокер$/, "Банков: $1 · брокеров: $2", "$1 banks · $2 brokerage"],
  [/^(\d+) операция$/, "Операций: $1", "$1 transactions"],
  [/^(\d+) жазба$/, "Записей: $1", "$1 records"],
  [/^(\d+) мақсат$/, "Целей: $1", "$1 goals"],
  [/^(\d+) сағат бұрын$/, "$1 ч. назад", "$1 h ago"],
  [/^(\d+) күн бұрын$/, "$1 дн. назад", "$1 d ago"],
  [/^(\d+) ай$/, "$1 мес.", "$1 months"],
  [/^Табылды: (\d+) операция$/, "Найдено: $1 операций", "Found: $1 transactions"],
  [/^Табылды: (\d+) жазба$/, "Найдено: $1 записей", "Found: $1 records"],
  [/^(\d+) операцияны қосу$/, "Добавить $1 операций", "Add $1 transactions"],
  [/^(\d+) жазбаны қосу$/, "Добавить $1 записей", "Add $1 records"],
  [/^(\d+) операция қосылды$/, "Добавлено $1 операций", "$1 transactions added"],
  [/^(\d+) жазба қосылды$/, "Добавлено $1 записей", "$1 records added"],
  [/^(\d+) шот қосылды — қалдықтарын жазыңыз$/, "Добавлено счетов: $1 — укажите остатки", "$1 accounts added — set their balances"],
  [/^(\d+) операция өшірілді$/, "Удалено операций: $1", "$1 transactions deleted"],
  [/^(\d+) қайталанған операция табылды\.$/, "Найдено дубликатов: $1.", "$1 duplicates found."],
  [/^(\d+) табылды · (.+)$/, "Найдено $1 · $2", "$1 found · $2"],
  [/^Соңғы көшірме: (.+)\.$/, "Последняя копия: $1.", "Last backup: $1."],
  [/^(.+) — құнын жаңарту \((.+)\)$/, "$1 — обновить стоимость ($2)", "$1 — update value ($2)"],
  [/^Сома, (.+)$/, "Сумма, $1", "Amount, $1"],
  [/^(\d+)% — абайлаңыз$/, "$1% — осторожно", "$1% — careful"],
  [/^шектен (.+) асты$/, "превышен на $1", "over by $1"],
  [/^Шек қойылмаған · осы айда (.+)$/, "Без лимита · в этом месяце $1", "No limit · $1 this month"],
  [/^(.+) — шекке жақындады$/, "$1 — близко к лимиту", "$1 — near the limit"],
  [/^Кіріс · (\d+)$/, "Доход · $1", "Income · $1"],
  [/^Шығын · (\d+)$/, "Расход · $1", "Expense · $1"],
  [/^Салынған (.+) · (.+)$/, "Вложено $1 · $2", "Invested $1 · $2"],
  [/^(\d+) жыл (\d+) ай$/, "$1 л. $2 мес.", "$1 y $2 mo"],
  [/^(\d+) ай \((.+) жыл\)$/, "$1 мес. ($2 лет)", "$1 months ($2 years)"],
  [/^(\d+) ай \((\d+) ай қысқарды\)$/, "$1 мес. (короче на $2 мес.)", "$1 months ($2 fewer)"],
  [/^(\d+) брокер$/, "Брокеров: $1", "$1 brokerages"],
  [/^Портфельдің (\d+)%-ы$/, "$1% портфеля", "$1% of portfolio"],
  [/^(\d+) күн қалды$/, "Осталось дней: $1", "$1 days left"],
  [/^Осы қарқынмен (.+) шамасында$/, "При таком темпе примерно $1", "At this pace, around $1"],
  [/^(\d+) операция шығарылды$/, "Выгружено операций: $1", "$1 transactions exported"],
  [/^Операцияларын көру \((\d+)\)$/, "Показать операции ($1)", "View transactions ($1)"],
  [/^Банктегі нақты қалдық, (.+)$/, "Фактический остаток в банке, $1", "Real bank balance, $1"],
  [/^Қосымшада: (.+)$/, "В приложении: $1", "In the app: $1"],
  [/^Айырманы түзету \((\d+)\)$/, "Исправить разницу ($1)", "Fix the difference ($1)"],
  [/^(\d+) шотқа түзету операциясы қосылады. Жалғастырасыз ба\?$/, "Будет добавлено исправление по $1 счетам. Продолжить?", "A correction will be added to $1 accounts. Continue?"],
  [/^(\d+) түзету жазылды$/, "Записано исправлений: $1", "$1 corrections recorded"]
];

function tr(str){
  if(LANG === 'kk' || !str) return str;
  var d = LANG === 'ru' ? DICT_RU : DICT_EN;
  var idx = LANG === 'ru' ? 1 : 2;
  var s = String(str).trim();
  if(!s) return str;

  if(d[s]) return d[s];

  // белгішемен басталса (🍜 Тамақ)
  var m = s.match(/^([^\wА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]{1,3})\s*(.+)$/);
  if(m && d[m[2]]) return m[1].trim() + ' ' + d[m[2]];

  for(var i = 0; i < TR_RULES.length; i++){
    if(TR_RULES[i][0].test(s)){
      var tpl = TR_RULES[i][idx];
      return s.replace(TR_RULES[i][0], function(){
        var args = arguments;
        return tpl.replace(/\$(\d)/g, function(_, k){ return tr(args[+k]); });
      });
    }
  }

  // ай/күн атауларын жол ішінен ауыстыру
  var out = s, hit = false;
  MONTHS.concat(MONTHS.map(function(x){ return x.toLowerCase(); }))
    .concat(DAYS).forEach(function(w){
      if(out.indexOf(w) !== -1 && d[w]){ out = out.split(w).join(d[w]); hit = true; }
    });
  return hit ? out : str;
}

function translateDom(root){
  if(LANG === 'kk') return;
  var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null);
  var nodes = [], n;
  while((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(function(node){
    var p = node.parentNode;
    if(!p || p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE') return;
    var raw = node.nodeValue;
    if(!raw || !raw.trim()) return;
    var t = tr(raw);
    if(t !== raw && t !== raw.trim()) node.nodeValue = raw.replace(raw.trim(), t);
    else if(t !== raw) node.nodeValue = t;
  });
  var ph = (root || document).querySelectorAll('[placeholder]');
  for(var i = 0; i < ph.length; i++){
    var v = ph[i].getAttribute('placeholder');
    var t2 = tr(v);
    if(t2 !== v) ph[i].setAttribute('placeholder', t2);
  }
}

function setLang(l){
  DB.lang = l;
  save();
  location.reload();
}
function drawLangChips(){
  var box = document.getElementById('lang-chips');
  if(!box) return;
  box.innerHTML = '';
  [['kk','Қазақша'],['ru','Русский'],['en','English']].forEach(function(l){
    var b = document.createElement('button');
    b.className = 'chip' + (LANG === l[0] ? ' on' : '');
    b.textContent = l[1];
    b.onclick = function(){ setLang(l[0]); };
    box.appendChild(b);
  });
}

/* ================= АВТОМАТТЫ САҚТАУ (телефонда) ================= */
/* дерек өшіп қалмасын деп браузерден тұрақты сақтау сұраймыз */
var persisted = null;
function askPersist(){
  if(navigator.storage && navigator.storage.persist){
    navigator.storage.persisted().then(function(ok){
      persisted = ok; STO.persisted = ok;
      if(ok){ drawStorage(); return; }
      navigator.storage.persist().then(function(g){ persisted = g; STO.persisted = g; drawStorage(); });
    }).catch(function(){});
  }
}

/* қосымшадан шыққанда / фонға кеткенде бірден сақтау */
function bindExitSave(){
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden'){ saveView(); save(); autoSnapshot(); }
  });
  window.addEventListener('pagehide', function(){ saveView(); save(); });
  var scrollTimer = null;
  window.addEventListener('scroll', function(){
    if(scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(saveView, 400);
  }, { passive: true });
  window.addEventListener('beforeunload', function(){ save(); });
}

/* ================= ДИАГРАММАЛАР ================= */
var PIE_COLORS = ['#021CF5','#3F5CFF','#6D3FE8','#00A3C4','#E2534B',
                  '#F0913C','#9B51E0','#2BB673','#7A8199','#C4CAE0'];

function drawDonut(elId, items, centerLabel){
  var box = document.getElementById(elId);
  if(!box) return;
  var total = 0;
  items.forEach(function(i){ total += i.value; });
  if(!total){ box.innerHTML = '<div class="empty">Бұл кезеңде дерек жоқ.</div>'; return; }

  var R = 40, C = 2 * Math.PI * R, off = 0;
  var svg = '<svg viewBox="0 0 100 100" class="donut">' +
    '<circle cx="50" cy="50" r="' + R + '" fill="none" stroke="var(--g-soft)" stroke-width="15"/>';
  items.forEach(function(it, k){
    var len = it.value / total * C;
    if(len <= 0) return;
    svg += '<circle class="seg" data-len="' + len + '" cx="50" cy="50" r="' + R +
      '" fill="none" stroke="' + it.color + '" stroke-width="15" stroke-dasharray="0 ' + C +
      '" stroke-dashoffset="0" transform="rotate(-90 50 50)"/>';
    off += len;
  });
  svg += '<text x="50" y="46" text-anchor="middle" font-size="6.5" fill="var(--ink-2)">' +
         esc(centerLabel) + '</text>' +
         '<text x="50" y="58" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">' +
         nf(total) + ' ₸</text></svg>';

  var leg = '<div class="legend2">';
  items.forEach(function(it){
    leg += '<div class="lg"><i style="background:' + it.color + '"></i>' +
      '<span>' + esc(it.label) + '</span><b>' + Math.round(it.value / total * 100) + '%</b></div>';
  });
  leg += '</div>';
  box.innerHTML = '<div class="donut-wrap">' + svg + leg + '</div>';
  animateDonut(box, C);
}

/* доғалар нөлден өз ұзындығына дейін сызылады */
function animateDonut(box, C){
  var segs = box.querySelectorAll('circle.seg');
  if(!segs.length) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function paint(e){
    var off = 0;
    for(var i = 0; i < segs.length; i++){
      var len = parseFloat(segs[i].getAttribute('data-len')) * e;
      segs[i].setAttribute('stroke-dasharray', Math.max(0, len - 0.6) + ' ' + (C - len + 0.6));
      segs[i].setAttribute('stroke-dashoffset', String(-off));
      off += len;
    }
  }
  if(reduce){ paint(1); return; }
  var t0 = performance.now(), dur = 780;
  function step(t){
    var k = Math.min(1, (t - t0) / dur);
    paint(1 - Math.pow(1 - k, 3));
    if(k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function catItems(list, type){
  var sums = {};
  list.filter(function(t){ return t.type === type; })
      .forEach(function(t){ sums[t.cat] = (sums[t.cat] || 0) + t.amt; });
  var keys = Object.keys(sums).sort(function(a,b){ return sums[b] - sums[a]; });
  var out = [], rest = 0;
  keys.forEach(function(k, i){
    if(i < 6) out.push({ label: k, value: sums[k], color: PIE_COLORS[i] });
    else rest += sums[k];
  });
  if(rest) out.push({ label: 'Басқалары', value: rest, color: PIE_COLORS[9] });
  return out;
}

/* --- 12 айлық тенденция --- */
var TREND_SEL = null;
function drawTrend(){
  var box = document.getElementById('trend-chart');
  if(!box) return;
  var now = new Date(), months = [];
  for(var i = 11; i >= 0; i--){
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
      m: d.getMonth(), y: d.getFullYear(), in: 0, out: 0
    });
  }
  var map = {};
  months.forEach(function(x){ map[x.key] = x; });
  DB.tx.forEach(function(t){
    if(t.type === 'tr') return;
    var k = t.date.slice(0, 7);
    if(map[k]) map[k][t.type] += t.amt;
  });

  var max = 1;
  months.forEach(function(x){ max = Math.max(max, x.in, x.out); });

  var W = 100, H = 46, pad = 6, top = 4, bot = 38;
  function px(i){ return pad + i * ((W - pad * 2) / 11); }
  function py(v){ return bot - (v / max) * (bot - top); }

  function path(field){
    var p = '';
    months.forEach(function(x, i){ p += (i ? ' L' : 'M') + px(i).toFixed(1) + ' ' + py(x[field]).toFixed(1); });
    return p;
  }
  var s = '<svg viewBox="0 0 100 46" class="trend">' +
    '<defs>' +
      '<linearGradient id="gPosL" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#7CF2CE"/><stop offset="1" stop-color="#00BE86"/></linearGradient>' +
      '<linearGradient id="gNegL" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#FFA8B3"/><stop offset="1" stop-color="#FF4D67"/></linearGradient>' +
    '</defs>';
  [0, 0.25, 0.5, 0.75, 1].forEach(function(f){
    var y = bot - f * (bot - top);
    s += '<line x1="' + pad + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad) + '" y2="' + y.toFixed(1) +
         '" stroke="var(--line)" stroke-width="0.25"/>';
  });
  /* екі таза сызық — толтырусыз, сондықтан қиылысқан жері анық көрінеді */
  s += '<path class="line" d="' + path('in') + '" fill="none" stroke="url(#gPosL)" stroke-width="0.9" ' +
       'stroke-linejoin="round" stroke-linecap="round"/>';
  s += '<path class="line" d="' + path('out') + '" fill="none" stroke="url(#gNegL)" stroke-width="0.9" ' +
       'stroke-linejoin="round" stroke-linecap="round" style="animation-delay:.15s"/>';
  /* әр айда — екі нүкте. Ақ жиегі бар, сондықтан сызықтың үстінде айқын тұрады */
  months.forEach(function(x, i){
    var dly = 'style="animation-delay:' + (0.5 + i * 0.05).toFixed(2) + 's"';
    s += '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(x.out).toFixed(1) +
         '" r="0.95" fill="#FF4D67" stroke="var(--surface)" stroke-width="0.4" ' + dly + '/>';
    s += '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(x.in).toFixed(1) +
         '" r="0.95" fill="#00BE86" stroke="var(--surface)" stroke-width="0.4" ' + dly + '/>';
  });
  /* басуға ыңғайлы болу үшін әр ай бойымен көрінбейтін кең жолақ */
  months.forEach(function(x, i){
    var w = (W - pad * 2) / 11;
    s += '<rect class="tr-hit" data-mi="' + i + '" x="' + Math.max(0, px(i) - w / 2).toFixed(1) +
         '" y="0" width="' + w.toFixed(1) + '" height="' + (bot + 3) + '"/>';
  });
  s += '</svg>';

  /* ай атаулары SVG-де емес, HTML-де — созылып кетпес үшін */
  var lab = '<div class="tr-x">';
  months.forEach(function(x, i){
    if((11 - i) % 2 !== 0) return;
    var isCur = (i === 11);
    lab += '<span class="' + (isCur ? 'cur' : '') + '" style="left:' + px(i).toFixed(1) + '%;' +
           'animation:fadein .5s backwards;animation-delay:' + (0.35 + i * 0.045).toFixed(2) + 's">' +
           MONTHS[x.m].slice(0, 3) + '</span>';
  });
  s += lab + '</div>';

  var last = months[11];
  s += '<div class="legend">' +
       '<span><i style="background:linear-gradient(92deg,#7CF2CE,#00BE86)"></i>Кіріс' +
       '<b class="gpos">' + nf(last.in) + ' ₸</b></span>' +
       '<span><i style="background:linear-gradient(92deg,#FFA8B3,#FF4D67)"></i>Шығын' +
       '<b class="gneg">' + nf(last.out) + ' ₸</b></span></div>';

  box.innerHTML = s;

  /* 12 айдың жиынтығы — ең астында, таңдалған айдың сандарынан кейін */
  var best = months.slice().sort(function(a,b){ return (b.in-b.out) - (a.in-a.out); })[0];
  var avgIn = 0, avgOut = 0;
  months.forEach(function(x){ avgIn += x.in; avgOut += x.out; });
  var sum = document.getElementById('trend-sum');
  if(sum) sum.innerHTML =
    '<div class="kv"><span>Айлық орташа кіріс</span><b>' + money(avgIn / 12) + '</b></div>' +
    '<div class="kv"><span>Айлық орташа шығын</span><b>' + money(avgOut / 12) + '</b></div>' +
    '<div class="kv"><span>Ең табысты ай</span><b>' + MONTHS[best.m] + ' ' + best.y + '</b></div>';

  /* --- нүктені (немесе ай бағанын) басқанда сол айдың сандары --- */
  var info = document.getElementById('trend-info');
  function showMonth(i){
    if(!info) return;
    var x = months[i], prev = i > 0 ? months[i - 1] : null;
    var net = x.in - x.out;
    var diff = prev ? (x.out - prev.out) : 0;
    info.className = 'on';
    info.innerHTML =
      '<div class="m">' + MONTHS[x.m] + ' ' + x.y + '</div>' +
      '<div class="kv"><span>Кіріс</span><b class="gpos">' + money(x.in) + '</b></div>' +
      '<div class="kv"><span>Шығын</span><b class="gneg">' + money(x.out) + '</b></div>' +
      '<div class="kv"><span>Нәтиже</span><b style="color:' + (net >= 0 ? 'var(--pos)' : 'var(--neg)') + '">' +
        (net >= 0 ? '+' : '−') + nf(Math.abs(net)) + ' ₸</b></div>' +
      (prev && prev.out > 0
        ? '<div class="kv"><span>' + (diff <= 0 ? 'Өткен айдан үнемделді' : 'Өткен айдан артық жұмсалды') +
          '</span><b style="color:' + (diff <= 0 ? 'var(--pos)' : 'var(--neg)') + '">' +
          nf(Math.abs(diff)) + ' ₸ (' + Math.abs(Math.round(diff / prev.out * 100)) + '%)</b></div>'
        : '') +
      '<button class="btn line sm" style="margin-top:10px" data-mo="' + x.key + '">Осы айдың операцияларын көру</button>';
    var b = info.querySelector('[data-mo]');
    if(b) b.onclick = function(){ monthOps(x.key); };
    /* таңдалған айды графикте белгілеп қою */
    var svg = box.querySelector('svg');
    var old = svg && svg.querySelector('.tr-sel');
    if(old) old.parentNode.removeChild(old);
    if(svg){
      var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('class', 'tr-sel');
      ln.setAttribute('x1', px(i).toFixed(1)); ln.setAttribute('x2', px(i).toFixed(1));
      ln.setAttribute('y1', top - 1.5); ln.setAttribute('y2', bot);
      svg.insertBefore(ln, svg.firstChild);
      /* таңдалған айдың нүктелерін ірілетіп қоямыз */
      var dots = svg.querySelectorAll('circle'), cx = px(i).toFixed(1);
      for(var q = 0; q < dots.length; q++){
        var sel = dots[q].getAttribute('cx') === cx;
        dots[q].setAttribute('r', sel ? '1.6' : '0.95');
        dots[q].setAttribute('stroke-width', sel ? '0.5' : '0.4');
      }
    }
  }
  var hits = box.querySelectorAll('.tr-hit');
  for(var hi = 0; hi < hits.length; hi++){
    (function(el){
      el.onclick = function(){
        buzz(6);
        TREND_SEL = parseInt(el.getAttribute('data-mi'), 10);
        showMonth(TREND_SEL);
      };
    })(hits[hi]);
  }
  /* блок бос тұрмасын — әдепкіде осы ай ашық */
  showMonth(TREND_SEL === null ? 11 : Math.min(11, TREND_SEL));
}

/* графиктен сол айдың операцияларына өту */
function monthOps(key){
  opsMonth = key;
  opsAcc = 'all'; opsFilter = 'all';
  var q = document.getElementById('ops-q'); if(q) q.value = '';
  go('ops');
  setTimeout(function(){ jumpTo('ops-card'); }, 60);
}



/* ================= ТАҚЫРЫП (ашық / қараңғы) ================= */
function themeMode(){ return DB.theme || 'auto'; }
function isDark(){
  var m = themeMode();
  if(m === 'dark') return true;
  if(m === 'light') return false;
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
function applyTheme(){
  var dark = isDark();
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  var mt = document.querySelector('meta[name="theme-color"]');
  if(mt) mt.setAttribute('content', dark ? '#04061C' : '#021cf5');
}
function setTheme(m){
  DB.theme = m; save(); applyTheme(); render();
}
function drawThemeChips(){
  var box = document.getElementById('theme-chips');
  if(!box) return;
  box.innerHTML = '';
  [['light','Ашық','sun'],['dark','Қараңғы','moon'],['auto','Жүйе бойынша','gear']].forEach(function(t){
    var b = document.createElement('button');
    b.className = 'chip' + (themeMode() === t[0] ? ' on' : '');
    b.innerHTML = svgIcon(t[2],'chip-ic') + '<span>' + t[1] + '</span>';
    b.onclick = function(){ setTheme(t[0]); };
    box.appendChild(b);
  });
}
function watchSystemTheme(){
  if(!window.matchMedia) return;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var h = function(){ if(themeMode() === 'auto') applyTheme(); };
  if(mq.addEventListener) mq.addEventListener('change', h);
  else if(mq.addListener) mq.addListener(h);
}

/* ================= САН АНИМАЦИЯСЫ ================= */
function animNum(el, val, sym){
  if(!el) return;
  sym = sym || '₸';
  var prev = parseFloat(el.getAttribute('data-v'));
  el.setAttribute('data-v', val);
  if(isNaN(prev) || Math.abs(val - prev) < 1 ||
     (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)){
    el.textContent = money(val, sym);
    return;
  }
  var t0 = performance.now(), dur = 520;
  function step(t){
    var k = Math.min(1, (t - t0) / dur);
    var e = 1 - Math.pow(1 - k, 3);
    el.textContent = money(prev + (val - prev) * e, sym);
    if(k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ================= СВАЙП ЖЕСТЕРІ ================= */
var undoBuf = null;

function toastUndo(msg, cb){
  var t = document.getElementById('toast');
  t.innerHTML = '';
  t.appendChild(document.createTextNode(tr(msg)));
  var b = document.createElement('span');
  b.className = 'undo';
  b.textContent = tr('Қайтару');
  b.onclick = function(){
    t.classList.remove('on');
    cb();
  };
  t.appendChild(b);
  t.classList.add('on');
  clearTimeout(t._tm);
  t._tm = setTimeout(function(){ t.classList.remove('on'); t.textContent = ''; }, 4500);
}

function swipeWrap(row, onLeft, onRight){
  var wrap = document.createElement('div');
  wrap.className = 'swipe';
  var bg = document.createElement('div');
  bg.className = 'swipe-bg';
  bg.innerHTML = '<span class="sw-i" style="color:var(--blue)">' + svgIcon('edit') +
    '</span><span class="sw-i" style="color:var(--neg)">' + svgIcon('trash') + '</span>';
  wrap.appendChild(bg);
  wrap.appendChild(row);

  var x0 = 0, y0 = 0, dx = 0, lock = null;

  row.addEventListener('touchstart', function(e){
    if(e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    dx = 0; lock = null;
    wrap.classList.add('drag');
  }, { passive: true });

  row.addEventListener('touchmove', function(e){
    if(e.touches.length !== 1) return;
    var cx = e.touches[0].clientX, cy = e.touches[0].clientY;
    var ddx = cx - x0, ddy = cy - y0;
    if(lock === null){
      if(Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      lock = Math.abs(ddx) > Math.abs(ddy) * 1.4 ? 'x' : 'y';
    }
    if(lock !== 'x') return;
    dx = Math.max(-120, Math.min(120, ddx));
    row.style.transform = 'translateX(' + dx + 'px)';
    bg.classList.add('show');
    bg.style.background = dx < 0 ? 'var(--danger-bg)' : 'var(--blue-bg)';
  }, { passive: true });

  function finish(){
    wrap.classList.remove('drag');
    bg.classList.remove('show');
    row.style.transform = '';
    var d = dx; dx = 0;
    if(lock !== 'x') return;
    if(d < -70){ onLeft(); }
    else if(d > 70){ onRight(); }
  }
  row.addEventListener('touchend', finish, { passive: true });
  row.addEventListener('touchcancel', finish, { passive: true });

  return wrap;
}

function deleteTxWithUndo(t){
  var copy = JSON.parse(JSON.stringify(t));
  DB.tx = DB.tx.filter(function(x){ return x.id !== t.id; });
  recalcBal();
  save(); render();
  toastUndo('Өшірілді', function(){
    DB.tx.push(copy);
    recalcBal();
    save(); render();
    toast('Қайтарылды');
  });
}

/* ================= FREEDOM БРОКЕР ЕСЕБІ ================= */
/* Есептің "Ақша қаражатын салу/шығару" бөлімін ғана оқиды.
   Сауда мәмілелері, комиссия кестесі, корпоративтік әрекеттер бөлімі алынбайды —
   олар портфель құнын өзгертпейді немесе ақша бөлімінде қайталанады. */

var FR_MARK  = /(клиент коды|код клиента|брокер есебі|отчет брокера|freedom finance)/i;
var FR_START = /(ақша қаражатын салу|ввод\s*\/?\s*вывод\s*денежных|движение денежных средств)/i;
var FR_STOP  = /(бағалы қағаздарды енгізу|есепті кезеңде жасалған|ценные бумаги ввод|сделки с ценными|бағалы қағаздар қозғалысы)/i;
var FR_BLOCK = /(бұғатта|блокиров|разблокир)/i;

function isFreedomReport(lines){
  var head = lines.slice(0, 60).join(' ');
  return FR_MARK.test(head) && lines.some(function(l){ return FR_START.test(l); });
}

function freedomClientCode(lines){
  for(var i = 0; i < Math.min(lines.length, 80); i++){
    var m = lines[i].match(/(?:клиент коды|код клиента)\s*[:№]?\s*([A-Za-z0-9]{4,})/i);
    if(m) return m[1].toUpperCase();
  }
  return null;
}

function frType(txt, val){
  if(/(дивиденд|купон|coupon|dividend)/i.test(txt)) return val >= 0 ? 'div' : 'fee';
  if(/(салық|налог|комисси|fee|tax)/i.test(txt))    return 'fee';
  return val >= 0 ? 'dep' : 'wd';
}

function frNote(txt){
  var t = txt.replace(/\s+/g, ' ')
    .replace(/по поручению\s*\d+/ig, '')
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, '')
    .replace(/остаток на дату среза\s*[\d.,]+/ig, '')
    .replace(/на одну бумагу\s*[\d.,]+\s*\w*/ig, '')
    .replace(/торговый/ig, '')
    .replace(/\s{2,}/g, ' ').trim();
  if(t.length > 70) t = t.slice(0, 70);
  return t;
}

function parseFreedom(lines){
  var i0 = -1, i1 = lines.length;
  for(var i = 0; i < lines.length; i++){
    if(i0 < 0 && FR_START.test(lines[i])) { i0 = i + 1; continue; }
    if(i0 >= 0 && FR_STOP.test(lines[i])) { i1 = i; break; }
  }
  if(i0 < 0) return null;

  var sec = lines.slice(i0, i1);

  /* жазбаларға бөлу: әр жазба "20XX-" деген жол фрагментінен басталады */
  var recs = [], cur = null;
  sec.forEach(function(l){
    if(/20\d{2}-(?!\d)/.test(l)){ if(cur) recs.push(cur); cur = [l]; }
    else if(cur) cur.push(l);
  });
  if(cur) recs.push(cur);

  var out = [];
  recs.forEach(function(rec){
    var raw = rec.join(' ');
    if(FR_BLOCK.test(raw)) return;                       // бұғаттау/босату — нақты қозғалыс емес

    /* бөлініп қалған минусты жабыстыру: "- 115.80" */
    var t = raw.replace(/(^|\s)-\s+(?=\d)/g, '$1-');

    /* түсініктемедегі күндер мен коэффициенттер сомамен шатаспас үшін */
    t = t.replace(/\b20\d{2}-\d{2}-\d{2}\b/g, ' ')
         .replace(/на одну бумагу\s*[\d.,]+\s*(KZT|USD|RUR|EUR)?/ig, ' ')
         .replace(/остаток на дату среза\s*[\d.,]+/ig, ' ')
         .replace(/ставка налога\s*[\d.,]+/ig, ' ')
         .replace(/по поручению\s*\d+/ig, ' ')
         .replace(/№\s*\S+/g, ' ')
         .replace(/\b\d{1,2}\.\d{2}\.\d{4}\S*/g, ' ');

    /* күні: "2025-" бір жолда, "11-18" екінші жолда */
    var y = t.match(/\b(20\d{2})-(?!\d)/);
    if(!y) return;
    t = t.replace(y[0], ' ');
    var md = t.match(/\b(\d{2})-(\d{2})\b/);
    if(!md) return;
    var date = y[1] + '-' + md[1] + '-' + md[2];
    t = t.replace(md[0], ' ');

    var cm = t.match(/\b(KZT|USD|RUR|EUR)\b/);
    if(!cm) return;

    /* шот кодтары мен ұзын нөмірлерді алып тастау */
    t = t.replace(/\b[A-Za-zА-Яа-яӘәҒғҚқҢңӨөҰұҮүҺһІі]+\d[\wА-Яа-я]*\b/g, ' ')
         .replace(/\b\d[\wА-Яа-я]*[A-Za-zА-Яа-я][\wА-Яа-я]*\b/g, ' ')
         .replace(/\b\d{5,}\b/g, ' ');

    var toks = t.match(/-?\d[\d \u00A0]*(?:[.,]\d+)?/g) || [];
    var nums = [];
    toks.forEach(function(tk){
      var s = tk.replace(/[\s\u00A0]/g, '');
      if(s && s !== '-') nums.push(s);
    });

    /* PDF мыңдықты бөліп жіберген: "5" + "000.00" -> "5000.00" */
    var merged = [], k = 0;
    while(k < nums.length){
      var a = nums[k];
      if(k + 1 < nums.length && /^-?\d{1,3}$/.test(a) && /^\d{3}[.,]\d{2}$/.test(nums[k + 1])){
        merged.push(a + nums[k + 1]); k += 2;
      } else { merged.push(a); k += 1; }
    }

    var cands = merged.filter(function(m){ return /[.,]\d{2}$/.test(m); });
    if(!cands.length) return;
    var val = parseFloat(cands[0].replace(',', '.'));
    if(!isFinite(val)) return;
    /* жеке тұрып қалған минус */
    if(val > 0 && /(^|\s)[-−–](\s|$)/.test(t)) val = -val;
    if(val === 0) return;

    out.push({
      date: date,
      amt: Math.abs(val),
      cur: cm[1] === 'RUR' ? 'RUB' : cm[1],
      bt: frType(raw, val),
      note: frNote(raw),
      type: val >= 0 ? 'in' : 'out'
    });
  });

  out.sort(function(a, b){ return a.date < b.date ? 1 : -1; });
  return out;
}

/* ================= SVG БЕЛГІШЕЛЕР ================= */
var SVGI = {
  home:   '<path d="M3.5 11 12 3.5 20.5 11"/><path d="M5.8 9.7V20h12.4V9.7"/><path d="M10 20v-5h4v5"/>',
  wallet: '<rect x="3" y="6.5" width="18" height="13" rx="3"/><path d="M3 9.5V7a2.5 2.5 0 0 1 2.5-2.5H16"/><circle cx="16.5" cy="13" r="1.4"/>',
  receipt:'<path d="M6 3.2h12v17.6l-3-1.8-3 1.8-3-1.8-3 1.8V3.2Z"/><path d="M9.2 8.2h5.6"/><path d="M9.2 12h5.6"/>',
  stats:  '<path d="M4 20V11"/><path d="M9.3 20V5"/><path d="M14.7 20v-6"/><path d="M20 20V9"/>',
  gear:   '<circle cx="12" cy="12" r="3.3"/><path d="M19 12c0 .5-.05.9-.13 1.35l2.1 1.6-2 3.46-2.5-1a7.4 7.4 0 0 1-2.33 1.35l-.37 2.64h-4l-.37-2.64A7.4 7.4 0 0 1 7.07 17.4l-2.5 1-2-3.46 2.1-1.6A7.6 7.6 0 0 1 4.54 12c0-.46.05-.9.13-1.35l-2.1-1.6 2-3.46 2.5 1a7.4 7.4 0 0 1 2.33-1.35L9.77 2.6h4l.37 2.64a7.4 7.4 0 0 1 2.33 1.35l2.5-1 2 3.46-2.1 1.6c.08.45.13.89.13 1.35Z"/>',
  grid:   '<rect x="3.4" y="3.4" width="7.2" height="7.2" rx="2.2"/><rect x="13.4" y="3.4" width="7.2" height="7.2" rx="2.2"/><rect x="3.4" y="13.4" width="7.2" height="7.2" rx="2.2"/><rect x="13.4" y="13.4" width="7.2" height="7.2" rx="2.2"/>',
  chart:  '<path d="M4 19.2h16"/><path d="M7.2 16V9.5"/><path d="M12 16V5"/><path d="M16.8 16v-4.5"/>',
  target: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1"/>',
  calc:   '<rect x="4.5" y="2.8" width="15" height="18.4" rx="2.6"/><path d="M8 7h8"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18.3h.01M12 18.3h.01M15.5 18.3h.01"/>',
  budget: '<circle cx="12" cy="12" r="8.4"/><path d="M12 3.6V12l6 5.8"/>',
  inbox:  '<path d="M12 3v9.5"/><path d="M8.2 9.2 12 13l3.8-3.8"/><path d="M3.5 14.5h4l1.6 2.6h5.8l1.6-2.6h4"/><path d="M3.5 14.5V18a2.5 2.5 0 0 0 2.5 2.5h12a2.5 2.5 0 0 0 2.5-2.5v-3.5"/>',
  flag:   '<path d="M6 21V3.8"/><path d="M6 4.4h11.5l-2.2 3.8 2.2 3.8H6"/>',
  swap:   '<path d="M4 8.5h13"/><path d="M13.6 5 17 8.5 13.6 12"/><path d="M20 15.5H7"/><path d="M10.4 12 7 15.5 10.4 19"/>',
  bank:   '<path d="M3.5 9.5 12 4l8.5 5.5"/><path d="M5.5 10.5v8M10 10.5v8M14 10.5v8M18.5 10.5v8"/><path d="M3.5 20.5h17"/>',
  brief:  '<rect x="3" y="7" width="18" height="13" rx="2.6"/><path d="M8.8 7V5.4a1.8 1.8 0 0 1 1.8-1.8h2.8a1.8 1.8 0 0 1 1.8 1.8V7"/><path d="M3 12.5h18"/>',

  /* --- шығын санаттары --- */
  food:   '<path d="M3.6 12.2h16.8a8.4 8.4 0 0 1-16.8 0Z"/><path d="M6.4 12.2a5.6 5.6 0 0 1 11.2 0"/><path d="M2.5 20.4h19"/>',
  car:    '<path d="M4.8 13.4 6.4 8.9A2.2 2.2 0 0 1 8.5 7.4h7a2.2 2.2 0 0 1 2.1 1.5l1.6 4.5"/><rect x="3.4" y="13.4" width="17.2" height="5" rx="1.8"/><circle cx="7.4" cy="18.4" r="1.5"/><circle cx="16.6" cy="18.4" r="1.5"/>',
  house:  '<path d="M3.5 11 12 3.5 20.5 11"/><path d="M5.8 9.7V20h12.4V9.7"/><path d="M10.2 20v-4.6h3.6V20"/>',
  phone:  '<rect x="6.6" y="2.6" width="10.8" height="18.8" rx="2.6"/><path d="M10.6 18.6h2.8"/>',
  shirt:  '<path d="M8.6 3.4 12 5.2l3.4-1.8 4.4 3.6-2.6 2.6V20.6H6.8V9.4L4.2 6.8Z"/>',
  health: '<path d="M12 20.6s-7.2-4.4-7.2-9.4a4.1 4.1 0 0 1 7.2-2.7 4.1 4.1 0 0 1 7.2 2.7c0 5-7.2 9.4-7.2 9.4Z"/>',
  card:   '<rect x="2.8" y="5.4" width="18.4" height="13.2" rx="2.6"/><path d="M2.8 10h18.4"/><path d="M6.4 14.6h3.4"/>',
  fun:    '<circle cx="12" cy="12" r="8.6"/><path d="M10.2 8.9 15.6 12l-5.4 3.1Z"/>',
  book:   '<path d="M4 4.6h6.2A1.8 1.8 0 0 1 12 6.4v13.2a1.8 1.8 0 0 0-1.8-1.8H4Z"/><path d="M20 4.6h-6.2A1.8 1.8 0 0 0 12 6.4v13.2a1.8 1.8 0 0 1 1.8-1.8H20Z"/>',
  gift:   '<rect x="3.4" y="9.4" width="17.2" height="11.2" rx="1.8"/><path d="M2.6 9.4h18.8"/><path d="M12 9.4v11.2"/><path d="M12 9.4S9 9.2 8 8a2.1 2.1 0 0 1 2.6-3.2c1.1.6 1.4 3 1.4 4.6Z"/><path d="M12 9.4s3-.2 4-1.4a2.1 2.1 0 0 0-2.6-3.2C12.3 5.4 12 7.8 12 9.4Z"/>',
  star:   '<path d="M12 3.4 14 9.6l6.2 2-6.2 2-2 6.2-2-6.2-6.2-2 6.2-2Z"/>',

  /* --- кіріс көздері --- */
  salary: '<rect x="2.8" y="6.6" width="18.4" height="11.4" rx="2.4"/><circle cx="12" cy="12.3" r="2.6"/><path d="M6.2 12.3h.01M17.8 12.3h.01"/>',
  biz:    '<path d="M3.6 16.8 9 11.4l3.6 3.6 7-7"/><path d="M15.6 8h4v4"/>',
  laptop: '<rect x="4.4" y="5" width="15.2" height="10.4" rx="2"/><path d="M2.6 18.6h18.8"/>',
  sun:    '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M5.4 18.6 7 17M17 7l1.6-1.6"/>',
  moon:   '<path d="M20 14.4A8.6 8.6 0 0 1 9.6 4a8.6 8.6 0 1 0 10.4 10.4Z"/>',
  edit:   '<path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0-3-3L5.2 17Z"/><path d="M14.6 6.6l2.8 2.8"/>',
  trash:  '<path d="M4.6 6.6h14.8"/><path d="M9.4 6.6V4.8a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.8"/><path d="M6.6 6.6 7.6 20a1.6 1.6 0 0 0 1.6 1.4h5.6A1.6 1.6 0 0 0 16.4 20l1-13.4"/>',
  arrDown:'<path d="M12 4.4v14"/><path d="M6.4 13 12 18.6 17.6 13"/>',
  arrUp:  '<path d="M12 19.6V5.4"/><path d="M6.4 11 12 5.4 17.6 11"/>',
  clock:  '<circle cx="12" cy="12" r="8.6"/><path d="M12 6.8V12l3.6 2.2"/>',
  down:   '<path d="M3.6 7.2 9 12.6l3.6-3.6 7 7"/><path d="M19.6 12.6v4h-4"/>',
  coin:   '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4v9.2"/><path d="M14.6 9.6c-.6-.8-1.6-1.2-2.6-1.2-1.5 0-2.7.8-2.7 2s1.2 1.7 2.7 2 2.7.8 2.7 2-1.2 2-2.7 2c-1 0-2-.4-2.6-1.2"/>',
  invest: '<path d="M4 19.4h16"/><path d="M7.4 16.4V12"/><path d="M11.8 16.4V7.4"/><path d="M16.2 16.4v-6.4"/><path d="M6.2 8.6 12 3.8l5.8 4.8"/>',
  eye:    '<path d="M2.4 12S5.9 5.8 12 5.8 21.6 12 21.6 12 18.1 18.2 12 18.2 2.4 12 2.4 12Z"/><circle cx="12" cy="12" r="2.9"/>',
  eyeOff: '<path d="M4.2 4.2 19.8 19.8"/><path d="M9.6 6.2A9.6 9.6 0 0 1 12 5.8c6.1 0 9.6 6.2 9.6 6.2a17 17 0 0 1-3.1 3.8"/><path d="M6.6 8.2A16.6 16.6 0 0 0 2.4 12S5.9 18.2 12 18.2c1.1 0 2.1-.2 3-.5"/><path d="M10.1 10.2a2.9 2.9 0 0 0 3.9 3.9"/>'
};

var CAT_ICON = {
  'Тамақ':'food','Көлік':'car','Тұрғын үй':'house','Байланыс':'phone','Киім':'shirt',
  'Денсаулық':'health','Несие төлемі':'card','Ойын-сауық':'fun','Білім':'book',
  'Сыйлық':'gift','Басқа':'star',
  'Жалақы':'salary','Бизнес':'biz','Фриланс':'laptop','Инвестиция':'invest','Несие алу':'card',
  'Аударым':'swap'
};

/* HTML-дегі data-i="..." орындарын SVG-мен толтыру */
function fillIcons(root){
  var els = (root || document).querySelectorAll('[data-i]');
  for(var i = 0; i < els.length; i++){
    var n = els[i].getAttribute('data-i');
    if(els[i].getAttribute('data-done') === n) continue;
    els[i].innerHTML = svgIcon(n);
    els[i].setAttribute('data-done', n);
  }
}
function svgIcon(name, cls){
  var d = SVGI[name] || SVGI.star;
  return '<svg class="svi' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" ' +
         'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
         d + '</svg>';
}
function catSvg(type, cat, cls){
  return svgIcon(CAT_ICON[cat] || (type === 'in' ? 'salary' : 'star'), cls);
}
function catBox(type, cat){
  var kind = type === 'in' ? 'pos' : (type === 'tr' ? 'blue' : 'red');
  return '<div class="ico ' + kind + '">' + catSvg(type, cat) + '</div>';
}

/* ================= ҚАРЫЗДАР (адамдарға берген / алған) ================= */
/* dir: 'out' — мен бердім (маған қарыз), 'in' — мен алдым (мен қарызбын) */

function debts(){ return DB.debts || (DB.debts = []); }
function debtOf(id){ var r=null; debts().forEach(function(d){ if(d.id===id) r=d; }); return r; }
function debtLeft(d){ return Math.max(0, d.amt - (d.paid || 0)); }

function debtTotals(){
  var lent = 0, owed = 0, overdue = 0;
  var today = todayISO();
  debts().forEach(function(d){
    var left = debtLeft(d);
    if(left <= 0) return;
    if(d.dir === 'out') lent += left; else owed += left;
    if(d.due && d.due < today) overdue++;
  });
  return { lent: lent, owed: owed, overdue: overdue };
}

var dDir = 'out', dAcc = null, dId = null, dPayAcc = null;

function openDebt(dir){
  dDir = (dir === 'in' || dir === 'out') ? dir : 'out';
  document.getElementById('de-who').value = '';
  document.getElementById('de-amt').value = '';
  document.getElementById('de-note').value = '';
  document.getElementById('de-date').value = todayISO();
  document.getElementById('de-due').value = '';
  drawDebtDir(); drawDebtAccs();
  openSheet('sheet-debt');
}
function drawDebtDir(){
  document.getElementById('de-out').classList.toggle('on', dDir === 'out');
  document.getElementById('de-in').classList.toggle('on', dDir === 'in');
  document.getElementById('de-acc-lab').textContent =
    dDir === 'out' ? 'Қай шоттан бердім' : 'Қай шотқа түсті';
}
function setDebtDir(x){ dDir = x; drawDebtDir(); }
function drawDebtAccs(){
  var box = document.getElementById('de-accs'); box.innerHTML = '';
  var list = accsOf('asset');
  var ok = false; list.forEach(function(a){ if(a.id === dAcc) ok = true; });
  if(!ok) dAcc = list.length ? list[0].id : null;
  list.forEach(function(a){
    var b = document.createElement('button');
    var br = brandOf(a.name);
    b.className = 'chip' + (a.id === dAcc ? ' on' : '');
    b.innerHTML = (br ? '<span class="brand sm" style="background:'+br[1]+(br[2]?';color:'+br[2]:'')+'">'+br[0]+'</span>'
                      : accIconHtml(a,'chip-ic')) + '<span>' + esc(a.name) + '</span>';
    b.onclick = function(){ dAcc = a.id; drawDebtAccs(); };
    box.appendChild(b);
  });
}
function saveDebt(){
  var who = document.getElementById('de-who').value.trim();
  var amt = parseFloat(document.getElementById('de-amt').value);
  if(!who){ toast('Кімге екенін жазыңыз'); return; }
  if(!amt || amt <= 0){ toast('Соманы жазыңыз'); return; }
  var d = {
    id: newId(), dir: dDir, who: who, amt: amt, paid: 0,
    date: document.getElementById('de-date').value || todayISO(),
    due: document.getElementById('de-due').value || null,
    note: document.getElementById('de-note').value.trim(),
    acc: dAcc, hist: []
  };
  if(usdAcc(dAcc)) d.r = rateV() || null;
  debts().push(d);
  recalcBal();
  save(); closeSheets(); render();
  toast(dDir === 'out' ? 'Қарызға берілді' : 'Қарыз алынды');
}

function openDView(id){
  var d = debtOf(id); if(!d) return;
  dId = id;
  var left = debtLeft(d);
  document.getElementById('dv-title').textContent = d.who;
  document.getElementById('dv-pay').value = '';
  var pct = d.amt > 0 ? Math.round((d.paid || 0) / d.amt * 100) : 0;
  var a0 = acc(d.acc);
  document.getElementById('dv-sum').innerHTML =
    '<div class="kv"><span>' + (d.dir === 'out' ? 'Бердім' : 'Алдым') + '</span><b>' + money(d.amt) + '</b></div>' +
    '<div class="kv"><span>Қайтарылды</span><b>' + money(d.paid || 0) + ' · ' + pct + '%</b></div>' +
    '<div class="kv"><span>Қалды</span><b style="color:' + (left > 0 ? 'var(--neg)' : 'var(--pos)') + '">' + money(left) + '</b></div>' +
    '<div class="kv"><span>Күні</span><b>' + fullDate(d.date) + '</b></div>' +
    (d.due ? '<div class="kv"><span>Қайтару мерзімі</span><b>' + fullDate(d.due) + '</b></div>' : '') +
    (a0 ? '<div class="kv"><span>Шот</span><b>' + esc(a0.name) + '</b></div>' : '') +
    (d.note ? '<div class="kv"><span>Түсініктеме</span><b>' + esc(d.note) + '</b></div>' : '');
  document.getElementById('dv-pay-lab').textContent =
    d.dir === 'out' ? 'Маған қайтарған сома' : 'Мен қайтарған сома';
  drawDPayAccs(); drawDHist(d);
  document.getElementById('dv-payrow').classList.toggle('hide', left <= 0);
  openSheet('sheet-dview');
}
function drawDPayAccs(){
  var box = document.getElementById('dv-accs'); box.innerHTML = '';
  var list = accsOf('asset');
  var ok = false; list.forEach(function(a){ if(a.id === dPayAcc) ok = true; });
  if(!ok) dPayAcc = list.length ? list[0].id : null;
  list.forEach(function(a){
    var b = document.createElement('button');
    b.className = 'chip' + (a.id === dPayAcc ? ' on' : '');
    b.innerHTML = accIconHtml(a,'chip-ic') + '<span>' + esc(a.name) + '</span>';
    b.onclick = function(){ dPayAcc = a.id; drawDPayAccs(); };
    box.appendChild(b);
  });
}
function drawDHist(d){
  var box = document.getElementById('dv-hist'); box.innerHTML = '';
  if(!d.hist || !d.hist.length) return;
  var h = '<label class="f" style="margin-top:10px">Төлем тарихы</label>';
  d.hist.slice().reverse().forEach(function(x){
    var a = x.acc ? acc(x.acc) : null;
    h += '<div class="kv"><span>' + fullDate(x.date) + (a ? ' · ' + esc(a.name) : '') +
         '</span><b>' + nf(x.amt) + ' ₸</b></div>';
  });
  box.innerHTML = h;
}
function payDebt(){
  var v = parseFloat(document.getElementById('dv-pay').value);
  var d = debtOf(dId); if(!d) return;
  if(!v || v <= 0){ toast('Соманы жазыңыз'); return; }
  var left = debtLeft(d);
  if(v > left) v = left;
  d.paid = (d.paid || 0) + v;
  d.hist = d.hist || [];
  d.hist.push({ date: todayISO(), amt: v, acc: dPayAcc, r: usdAcc(dPayAcc) ? (rateV() || null) : null });
  recalcBal();
  save(); closeSheets(); render();
  toast(debtLeft(d) <= 0 ? 'Толық жабылды' : 'Төлем жазылды');
}
function delDebt(){
  var d = debtOf(dId); if(!d) return;
  if(!confirm('Жазба өшіріледі, шот қалдықтары бастапқы күйге қайтарылады. Жалғастырасыз ба?')) return;
  DB.debts = debts().filter(function(x){ return x.id !== dId; });
  recalcBal();
  save(); closeSheets(); render(); toast('Өшірілді');
}

function drawDebts(){
  var T = debtTotals();
  var le = document.getElementById('d-lent'), oe = document.getElementById('d-owed');
  if(le) le.textContent = money(T.lent);
  if(oe) oe.textContent = money(T.owed);
  var s1 = document.getElementById('d-sum-lent'), s2 = document.getElementById('d-sum-owed');
  if(s1) s1.textContent = money(T.lent);
  if(s2) s2.textContent = money(T.owed);

  ['out','in'].forEach(function(dir){
    var box = document.getElementById(dir === 'out' ? 'd-list-lent' : 'd-list-owed');
    if(!box) return;
    box.innerHTML = '';
    var list = debts().filter(function(d){ return d.dir === dir; })
      .sort(function(a,b){
        var la = debtLeft(a) > 0 ? 0 : 1, lb = debtLeft(b) > 0 ? 0 : 1;
        if(la !== lb) return la - lb;
        return a.date < b.date ? 1 : -1;
      });
    if(!list.length){
      box.innerHTML = '<div class="empty">' +
        (dir === 'out'
          ? 'Ешкім қарыз емес.<br>Біреуге ақша берсеңіз, төмендегі түймемен жазып қойыңыз.'
          : 'Қарызыңыз жоқ.<br>Біреуден ақша алсаңыз, төмендегі түймемен жазып қойыңыз.') + '</div>';
      return;
    }
    list.forEach(function(d){
      var left = debtLeft(d), done = left <= 0;
      var pct = d.amt > 0 ? Math.round((d.paid || 0) / d.amt * 100) : 0;
      var late = d.due && d.due < todayISO() && !done;
      var el = document.createElement('div');
      el.className = 'row';
      el.style.display = 'block';
      el.style.padding = '13px 2px';
      var pickD = selActive('debt');
      el.onclick = pickD ? function(){ selTog(d.id); } : function(){ openDView(d.id); };
      el.innerHTML =
        '<div style="display:flex;align-items:center;gap:11px">' +
          (pickD ? selBox(d.id) : '') +
          '<div class="ico' + (done ? ' pos' : (dir === 'out' ? '' : ' red')) + '">' +
            svgIcon(done ? 'target' : (dir === 'out' ? 'arrUp' : 'arrDown')) + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="name">' + esc(d.who) + (late ? ' <span class="badge">мерзімі өтті</span>' : '') + '</div>' +
            '<div class="sub2">' + fullDate(d.date) +
              (d.due ? ' · ' + tr('дейін') + ' ' + fullDate(d.due) : '') +
              (d.note ? ' · ' + esc(d.note) : '') + '</div>' +
          '</div>' +
          '<div class="amt" style="color:' + (done ? 'var(--pos)' : (dir === 'out' ? 'var(--ink)' : 'var(--neg)')) + '">' +
            (done ? tr('жабылды') : money(left)) + '</div>' +
        '</div>' +
        (done ? '' :
          '<div class="track" style="margin-top:10px"><div class="fill' + (dir === 'out' ? '' : ' neg') +
          '" style="width:' + pct + '%"></div></div>' +
          '<div class="bar-top" style="margin:6px 0 0"><span class="muted">' +
          money(d.paid || 0) + ' / ' + money(d.amt) + '</span><b class="muted">' + pct + '%</b></div>');
      box.appendChild(el);
    });
  });
}

/* ================= ДЕПОЗИТ КАЛЬКУЛЯТОРЫ ================= */
var depCap = true;



/* --- несие кестесін PDF ретінде --- */
function exportLoanPdf(){
  var S = num('l-sum');
  var n = loanUnit === 'year' ? Math.round(num('l-term') * 12) : Math.round(num('l-term'));
  var rate = num('l-rate'), i = rate / 12 / 100;
  if(S <= 0 || n <= 0){ toast('Мәндерді толтырыңыз.'); return; }

  var early = num('l-early'), earlyM = Math.round(num('l-early-m'));
  var basePay = loanType === 'ann' ? annuity(S, i, n) : 0;
  var principalPart = S / n;
  var bal = S, total = 0, interest = 0, months = 0, first = 0, rows = '';

  for(var m = 1; m <= n * 2 && bal > 0.5; m++){
    var int_ = bal * i, pr, pay;
    if(loanType === 'ann'){ pay = Math.min(basePay, bal + int_); pr = pay - int_; }
    else { pr = Math.min(principalPart, bal); pay = pr + int_; }
    bal -= pr;
    if(early > 0 && earlyM === m){ var e = Math.min(early, bal); bal -= e; pay += e; }
    total += pay; interest += int_; months = m;
    if(m === 1) first = pay;
    rows += '<tr>' +
      '<td style="padding:6px 0;border-bottom:1px solid #EEF1FA;color:#5D6480">' + m + '</td>' +
      '<td style="padding:6px 0;border-bottom:1px solid #EEF1FA;text-align:right;font-weight:600">' + nf(pay) + '</td>' +
      '<td style="padding:6px 0;border-bottom:1px solid #EEF1FA;text-align:right;color:#FF4D67">' + nf(int_) + '</td>' +
      '<td style="padding:6px 0;border-bottom:1px solid #EEF1FA;text-align:right;color:#00BE86">' + nf(pr) + '</td>' +
      '<td style="padding:6px 0;border-bottom:1px solid #EEF1FA;text-align:right">' + nf(Math.max(0, bal)) + '</td></tr>';
  }

  var html =
  '<div style="width:794px;padding:44px 46px;background:#fff;color:#0D1226;' +
       'font-family:Inter,-apple-system,Roboto,Arial,sans-serif;box-sizing:border-box">' +
    '<div style="display:flex;align-items:center;gap:16px;padding-bottom:22px;border-bottom:3px solid #021CF5">' +
      '<div style="width:54px;height:54px;border-radius:16px;background:#021CF5;color:#fff;' +
           'display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800">Q</div>' +
      '<div style="flex:1"><div style="font-size:26px;font-weight:800">Несие төлем кестесі</div>' +
        '<div style="color:#5D6480;font-size:14px;margin-top:2px">' +
          (loanType === 'ann' ? 'Аннуитетті' : 'Дифференциалды') + ' · ' + rate + '% жылдық</div></div>' +
      '<div style="text-align:right;color:#5D6480;font-size:12px">' + fullDate(todayISO()) + '</div>' +
    '</div>' +

    '<div style="display:flex;gap:14px;margin:26px 0">' +
      '<div style="flex:1;background:#E9ECFF;border-radius:16px;padding:18px">' +
        '<div style="color:#5D6480;font-size:13px">Ай сайынғы төлем</div>' +
        '<div style="font-size:23px;font-weight:800;color:#021CF5;margin-top:4px">' + money(first, loanCur) + '</div></div>' +
      '<div style="flex:1;background:#FFEFF1;border-radius:16px;padding:18px">' +
        '<div style="color:#5D6480;font-size:13px">Артық төлем</div>' +
        '<div style="font-size:23px;font-weight:800;color:#FF4D67;margin-top:4px">' + money(interest, loanCur) + '</div></div>' +
      '<div style="flex:1;background:#EAFBF4;border-radius:16px;padding:18px">' +
        '<div style="color:#5D6480;font-size:13px">Барлық төлем</div>' +
        '<div style="font-size:23px;font-weight:800;color:#00BE86;margin-top:4px">' + money(total, loanCur) + '</div></div>' +
    '</div>' +

    '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:24px">' +
      rpRow('Несие сомасы', money(S, loanCur)) +
      rpRow('Мерзімі', months + ' ай' + (months !== n ? ' (' + (n - months) + ' ай қысқарды)' : '')) +
      rpRow('Жылдық мөлшерлеме', rate + '%') +
      (early > 0 ? rpRow('Ерте өтеу', money(early, loanCur) + ' · ' + earlyM + '-ай') : '') +
    '</table>' +

    '<div style="font-size:17px;font-weight:800;margin:0 0 10px">Кесте</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<tr style="color:#5D6480;font-size:11.5px">' +
        '<th style="text-align:left;padding-bottom:6px">Ай</th>' +
        '<th style="text-align:right;padding-bottom:6px">Төлем</th>' +
        '<th style="text-align:right;padding-bottom:6px">Пайыз</th>' +
        '<th style="text-align:right;padding-bottom:6px">Негізгі қарыз</th>' +
        '<th style="text-align:right;padding-bottom:6px">Қалдық</th></tr>' + rows +
    '</table>' +

    '<div style="margin-top:26px;padding-top:16px;border-top:1px solid #E4E8F7;' +
         'color:#5D6480;font-size:11.5px">Qarzhy · есеп шамамен, банктің нақты шарттарын тексеріңіз</div>' +
  '</div>';

  exportPdf(html, 'qarzhy-nesie-' + todayISO() + '.pdf');
}

/* ================= ДЕПОЗИТ ЖӘНЕ САЛЫҚ КАЛЬКУЛЯТОРЛАРЫ ================= */
function calcDep(){
  var P = num('dp-sum'), M = num('dp-add'), r = num('dp-rate') / 100, n = Math.round(num('dp-term'));
  var box = document.getElementById('dp-res');
  if(!box) return;
  if(P <= 0 || n <= 0){ box.innerHTML = '<div class="empty">Мәндерді толтырыңыз.</div>'; return; }

  var i = r / 12, bal, invested = P + M * n, interest;
  if(depCap){
    bal = P;
    for(var k = 0; k < n; k++){ bal = bal * (1 + i) + M; }
  } else {
    var base = P, acc2 = 0;
    for(var j = 0; j < n; j++){ acc2 += base * i; base += M; }
    bal = base + acc2;
  }
  interest = bal - invested;
  var years = n / 12;
  var eff = invested > 0 && years > 0 ? (Math.pow(bal / invested, 1 / years) - 1) * 100 : 0;

  var rows = '';
  if(n >= 12){
    var b2 = P, base2 = P, a2 = 0;
    rows = '<div class="card"><h2>Жыл сайынғы өсім</h2><table class="sched">' +
           '<tr><th>Жыл</th><th>Салынған</th><th>Сома</th></tr>';
    for(var m = 1; m <= n; m++){
      if(depCap) b2 = b2 * (1 + i) + M;
      else { a2 += base2 * i; base2 += M; b2 = base2 + a2; }
      if(m % 12 === 0 || m === n){
        rows += '<tr><td>' + Math.ceil(m / 12) + '</td><td>' + nf(P + M * m) + '</td><td><b>' + nf(b2) + '</b></td></tr>';
      }
    }
    rows += '</table></div>';
  }

  box.innerHTML =
    '<div class="res"><div class="lab">Мерзім соңындағы сома</div><div class="big">' + money(bal) + '</div></div>' +
    '<div class="card">' +
      '<div class="kv"><span>Салынған қаражат</span><b>' + money(invested) + '</b></div>' +
      '<div class="kv"><span>Пайыздық табыс</span><b style="color:var(--pos)">' + money(interest) + '</b></div>' +
      '<div class="kv"><span>Мерзім</span><b>' + n + ' ай (' + years.toFixed(1) + ' жыл)</b></div>' +
      '<div class="kv"><span>Тиімді жылдық өсім</span><b>' + eff.toFixed(2) + '%</b></div>' +
      '<div class="kv"><span>Айына орташа табыс</span><b>' + money(interest / n) + '</b></div>' +
    '</div>' + rows +
    '<p class="muted" style="padding:0 4px">Есеп шамамен. Банктің нақты шарттарын (толықтыру шегі, мерзімінен бұрын алу кезінде пайыздың жоғалуы) тексеріңіз.</p>';
}
function toggleDepCap(){
  depCap = !depCap;
  document.getElementById('dp-sw').classList.toggle('on', depCap);
  document.getElementById('dp-sw-txt').textContent = depCap
    ? 'Ай сайын капитализация — пайызға пайыз'
    : 'Пайыз мерзім соңында бір рет төленеді';
  calcDep();
}
function calcTax(){
  var box = document.getElementById('tx-res');
  if(!box) return;
  var income = num('tx-income');
  var rate = num('tx-rate');
  var mrp = num('tx-mrp') || 4325;
  var mzp = num('tx-mzp') || 85000;
  var declared = num('tx-declared') || mzp;
  var months = Math.round(num('tx-months')) || 6;

  if(income <= 0){ box.innerHTML = '<div class="empty">Табысты жазыңыз.</div>'; return; }
  if(declared < mzp) declared = mzp;

  /* негізгі салық: жартысы ИПН, жартысы әлеуметтік салық */
  var total = income * rate / 100;
  var ipn = total / 2;
  var sn = total / 2;

  /* өз атына міндетті аударымдар */
  var opv = declared * 0.10 * months;          // зейнетақы
  var so  = declared * 0.035 * months;         // әлеуметтік аударым
  var vosms = 1.4 * mzp * 0.05 * months;       // медициналық сақтандыру

  /* әлеуметтік салық әлеуметтік аударымға азайтылады */
  var snPay = Math.max(0, sn - so);

  var sum = ipn + snPay + opv + so + vosms;

  box.innerHTML =
    '<div class="res"><div class="lab">Барлығы төлеу керек</div><div class="big">' + money(sum) + '</div></div>' +
    '<div class="card"><h2>Бөлшектеп</h2>' +
      '<div class="kv"><span>Табыс</span><b>' + money(income) + '</b></div>' +
      '<div class="kv"><span>Салық (' + rate + '%)</span><b>' + money(total) + '</b></div>' +
      '<div class="kv" style="padding-left:14px"><span>— ИПН</span><b>' + money(ipn) + '</b></div>' +
      '<div class="kv" style="padding-left:14px"><span>— Әлеуметтік салық</span><b>' + money(sn) + '</b></div>' +
      '<div class="kv" style="padding-left:14px"><span>— ӘС минус ӘА, төленеді</span><b>' + money(snPay) + '</b></div>' +
    '</div>' +
    '<div class="card"><h2>Өз атыңызға аударымдар</h2>' +
      '<div class="kv"><span>ОПВ · 10%</span><b>' + money(opv) + '</b></div>' +
      '<div class="kv"><span>ӘА · 3,5%</span><b>' + money(so) + '</b></div>' +
      '<div class="kv"><span>ӘМСЖ · 1,4 МЗП × 5%</span><b>' + money(vosms) + '</b></div>' +
      '<div class="kv"><span>Жарияланған табыс</span><b>' + money(declared) + ' × ' + months + ' ай</b></div>' +
    '</div>' +
    '<div class="card"><h2>Пайдалы сандар</h2>' +
      '<div class="kv"><span>Салық жүктемесі</span><b>' + (sum / income * 100).toFixed(1) + '%</b></div>' +
      '<div class="kv"><span>Қолда қалады</span><b style="color:var(--pos)">' + money(income - sum) + '</b></div>' +
      '<div class="kv"><span>Айына бөлгенде</span><b>' + money(sum / months) + '</b></div>' +
    '</div>' +
    '<p class="muted" style="padding:0 4px">Бұл — шамамен есеп, ресми құжат емес. Мөлшерлемелер мен МРП/МЗП жыл сайын өзгереді, ' +
    'жеңілдіктер мен ерекше жағдайлар ескерілмеген. Нақты сомасын salyk.kz немесе бухгалтерден растаңыз.</p>';
}



/* ================= PDF ЕСЕП ================= */
var CDN_H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
var CDN_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

function rpRow(label, value, color){
  return '<tr><td style="padding:9px 0;border-bottom:1px solid #E4E8F7;color:#5D6480">' + label +
         '</td><td style="padding:9px 0;border-bottom:1px solid #E4E8F7;text-align:right;' +
         'font-weight:700;color:' + (color || '#0D1226') + '">' + value + '</td></tr>';
}
function rpBar(label, sum, pct, color){
  return '<div style="margin-bottom:12px">' +
    '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">' +
      '<span style="color:#0D1226">' + esc(label) + '</span>' +
      '<b style="color:#0D1226">' + sum + ' · ' + pct + '%</b></div>' +
    '<div style="height:8px;background:#E9ECFF;border-radius:99px;overflow:hidden">' +
      '<div style="height:8px;width:' + pct + '%;background:' + color + ';border-radius:99px"></div></div></div>';
}

function buildReport(){
  var list = DB.tx.filter(function(t){ return inRange(t.date) && t.type !== 'tr'; });
  var sIn = 0, sOut = 0;
  list.forEach(function(t){ if(t.type === 'in') sIn += t.amt; else sOut += t.amt; });
  var T = totals();

  /* санаттар */
  function cats(type, total, color){
    var sums = {};
    list.filter(function(t){ return t.type === type; })
        .forEach(function(t){ sums[t.cat] = (sums[t.cat] || 0) + t.amt; });
    var keys = Object.keys(sums).sort(function(a, b){ return sums[b] - sums[a]; });
    if(!keys.length) return '<div style="color:#5D6480;font-size:13px">Дерек жоқ</div>';
    var h = '';
    keys.forEach(function(k){
      h += rpBar(k, money(sums[k]), Math.round(sums[k] / total * 100), color);
    });
    return h;
  }

  /* шоттар */
  var accRows = '';
  accsOf('asset').forEach(function(a){
    accRows += rpRow(esc(a.name), money(a.bal, accCurSym(a)));
  });
  accsOf('broker').forEach(function(a){
    syncBroker(a);
    accRows += rpRow(esc(a.name) + ' · брокер', curPair(bVals(a), true) + ' ≈ ' + money(a.bal), '#6D3FE8');
  });
  accsOf('debt').forEach(function(a){
    accRows += rpRow(esc(a.name) + ' · несие', money(a.bal), '#FF4D67');
  });

  /* несиелер */
  var loans = accsOf('debt');
  var loanBlock = '';
  if(loans.length){
    var payTotal = 0, rows = '';
    loans.forEach(function(a){
      payTotal += (a.pay || 0);
      var left = (a.pay > 0 && a.bal > 0) ? monthsLeft(a.bal, a.rate || 0, a.pay) : 0;
      rows += '<tr>' +
        '<td style="padding:9px 0;border-bottom:1px solid #E4E8F7">' + esc(a.name) + '</td>' +
        '<td style="padding:9px 0;border-bottom:1px solid #E4E8F7;text-align:right;color:#5D6480">' +
          (a.rate || 0) + '%</td>' +
        '<td style="padding:9px 0;border-bottom:1px solid #E4E8F7;text-align:right;color:#5D6480">' +
          (left > 0 ? left + ' ай' : '—') + '</td>' +
        '<td style="padding:9px 0;border-bottom:1px solid #E4E8F7;text-align:right;font-weight:700">' +
          money(a.pay || 0) + '</td>' +
        '<td style="padding:9px 0;border-bottom:1px solid #E4E8F7;text-align:right;font-weight:700;color:#FF4D67">' +
          money(a.bal) + '</td></tr>';
    });
    loanBlock =
      '<div style="font-size:17px;font-weight:800;margin:0 0 10px">Несиелер</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px">' +
        '<tr style="color:#5D6480;font-size:12px">' +
          '<th style="text-align:left;padding-bottom:6px">Несие</th>' +
          '<th style="text-align:right;padding-bottom:6px">Мөлшерлеме</th>' +
          '<th style="text-align:right;padding-bottom:6px">Қалған мерзім</th>' +
          '<th style="text-align:right;padding-bottom:6px">Айлық төлем</th>' +
          '<th style="text-align:right;padding-bottom:6px">Қалдық</th></tr>' +
        rows +
        '<tr><td colspan="3" style="padding:11px 0;font-weight:800">Барлығы айына</td>' +
        '<td style="padding:11px 0;text-align:right;font-weight:800;font-size:15px">' + money(payTotal) + '</td>' +
        '<td style="padding:11px 0;text-align:right;font-weight:800;font-size:15px;color:#FF4D67">' +
          money(T.debts) + '</td></tr>' +
      '</table>' +
      '<div style="color:#5D6480;font-size:12.5px;margin-bottom:26px">' +
        'Айлық төлем кірістің ' +
        (sIn > 0 ? '<b style="color:#0D1226">' + Math.round(payTotal / sIn * 100) + '%</b>' : '—') +
        ' мөлшерін алады</div>';
  }

  /* қарыздар */
  var debtRows = '';
  (DB.debts || []).forEach(function(d){
    var left = debtLeft(d);
    if(left <= 0) return;
    debtRows += rpRow(esc(d.who) + (d.dir === 'out' ? ' · маған қарыз' : ' · мен қарызбын'),
      money(left), d.dir === 'out' ? '#00BE86' : '#FF4D67');
  });

  /* соңғы операциялар */
  var ops = list.slice().sort(function(a, b){ return a.date < b.date ? 1 : -1; }).slice(0, 20);
  var opRows = '';
  ops.forEach(function(t){
    var a = acc(t.acc);
    opRows += '<tr>' +
      '<td style="padding:7px 0;border-bottom:1px solid #E4E8F7;color:#5D6480;font-size:12px;white-space:nowrap">' +
        fullDate(t.date) + '</td>' +
      '<td style="padding:7px 8px;border-bottom:1px solid #E4E8F7;font-size:13px">' +
        esc(t.cat) + (t.note ? ' <span style="color:#5D6480">· ' + esc(t.note).slice(0, 28) + '</span>' : '') + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #E4E8F7;font-size:12px;color:#5D6480;white-space:nowrap">' +
        (a ? esc(a.name) : '—') + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #E4E8F7;text-align:right;font-weight:700;white-space:nowrap;' +
        'color:' + (t.type === 'in' ? '#00BE86' : '#FF4D67') + '">' +
        (t.type === 'in' ? '+' : '−') + nf(t.amt) + ' ₸</td></tr>';
  });

  var net = sIn - sOut;
  var rate = sIn > 0 ? Math.round(net / sIn * 100) : 0;

  return '' +
  '<div style="width:794px;padding:44px 46px;background:#fff;color:#0D1226;' +
       'font-family:Inter,-apple-system,Roboto,Arial,sans-serif;box-sizing:border-box">' +

    /* тақырып */
    '<div style="display:flex;align-items:center;gap:16px;padding-bottom:22px;border-bottom:3px solid #021CF5">' +
      '<div style="width:54px;height:54px;border-radius:16px;background:#021CF5;color:#fff;' +
           'display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800">Q</div>' +
      '<div style="flex:1">' +
        '<div style="font-size:26px;font-weight:800;letter-spacing:-.5px">Қаржы есебі</div>' +
        '<div style="color:#5D6480;font-size:14px;margin-top:2px">' +
          fullDate(range.from) + ' — ' + fullDate(range.to) + '</div>' +
      '</div>' +
      '<div style="text-align:right;color:#5D6480;font-size:12px">Жасалған күні<br>' +
        '<b style="color:#0D1226">' + fullDate(todayISO()) + '</b></div>' +
    '</div>' +

    /* қорытынды */
    '<div style="display:flex;gap:14px;margin:26px 0 8px">' +
      '<div style="flex:1;background:#EAFBF4;border-radius:16px;padding:18px">' +
        '<div style="color:#5D6480;font-size:13px">Кіріс</div>' +
        '<div style="font-size:23px;font-weight:800;color:#00BE86;margin-top:4px">' + money(sIn) + '</div></div>' +
      '<div style="flex:1;background:#FFEFF1;border-radius:16px;padding:18px">' +
        '<div style="color:#5D6480;font-size:13px">Шығын</div>' +
        '<div style="font-size:23px;font-weight:800;color:#FF4D67;margin-top:4px">' + money(sOut) + '</div></div>' +
      '<div style="flex:1;background:#E9ECFF;border-radius:16px;padding:18px">' +
        '<div style="color:#5D6480;font-size:13px">Нәтиже</div>' +
        '<div style="font-size:23px;font-weight:800;color:#021CF5;margin-top:4px">' +
          (net >= 0 ? '+' : '') + money(net) + '</div></div>' +
    '</div>' +
    '<div style="color:#5D6480;font-size:13px;margin-bottom:26px">' +
      'Жинақ үлесі: <b style="color:#0D1226">' + (sIn > 0 ? rate + '%' : '—') + '</b> · ' +
      'операция саны: <b style="color:#0D1226">' + list.length + '</b></div>' +

    /* капитал */
    '<div style="font-size:17px;font-weight:800;margin:0 0 10px">Қаржылық жағдай</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:26px">' +
      rpRow('Банктердегі ақша', money(T.banks), '#00BE86') +
      rpRow('Міндеттемелер · несиелер', money(T.debts), '#FF4D67') +
      (T.lent ? rpRow('Маған қарыз', money(T.lent), '#00BE86') : '') +
      (T.owed ? rpRow('Мен қарызбын', money(T.owed), '#FF4D67') : '') +
      rpRow('<b style="color:#0D1226">Таза капитал</b>', '<span style="font-size:15px">' + money(T.net) + '</span>') +
      rpRow('Инвестиция портфелі (бөлек)', money(T.broker), '#6D3FE8') +
      (T.invested ? rpRow('Портфель табысы',
        (T.brokerPL >= 0 ? '+' : '') + money(T.brokerPL), T.brokerPL >= 0 ? '#00BE86' : '#FF4D67') : '') +
    '</table>' +

    /* санаттар */
    '<div style="display:flex;gap:30px;margin-bottom:26px">' +
      '<div style="flex:1">' +
        '<div style="font-size:17px;font-weight:800;margin:0 0 12px">Шығын санаттары</div>' +
        cats('out', sOut, 'linear-gradient(90deg,#FFA8B3,#FF4D67)') + '</div>' +
      '<div style="flex:1">' +
        '<div style="font-size:17px;font-weight:800;margin:0 0 12px">Кіріс көздері</div>' +
        cats('in', sIn, 'linear-gradient(90deg,#7CF2CE,#00BE86)') + '</div>' +
    '</div>' +

    loanBlock +

    /* шоттар */
    '<div style="font-size:17px;font-weight:800;margin:0 0 10px">Шоттар</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:26px">' +
      accRows + debtRows + '</table>' +

    /* операциялар */
    (opRows ?
      '<div style="font-size:17px;font-weight:800;margin:0 0 10px">Соңғы операциялар</div>' +
      '<table style="width:100%;border-collapse:collapse">' + opRows + '</table>' : '') +

    /* төменгі жол */
    '<div style="margin-top:30px;padding-top:16px;border-top:1px solid #E4E8F7;' +
         'color:#5D6480;font-size:11.5px;display:flex;justify-content:space-between">' +
      '<span>Qarzhy · жеке қаржы есебі</span>' +
      '<span>Дерек тек құрылғыда сақталады</span></div>' +
  '</div>';
}

/* ================= КАЛЬКУЛЯТОР ЕСЕБІН ЖІБЕРУ ================= */
/* Экранда тұрған нәтижені сол күйінде PDF немесе Excel файлы етіп жасайды.
   Ешқандай қайта есептеу жоқ — көріп отырған сандарыңыз. */
var CALC_SRC = {
  inv:  ['i-res',  'Инвестиция калькуляторы'],
  loan: ['l-res',  'Несие калькуляторы'],
  dep:  ['dp-res', 'Депозит калькуляторы'],
  tax:  ['tx-res', 'Салық калькуляторы'],
  stat: [null, 'Статистика есебі']   /* бұл экрандағы блоктан емес, buildReport-тан жиналады */
};

function calcHTML(kind){
  var src = CALC_SRC[kind]; if(!src) return null;
  var el = document.getElementById(src[0]);
  if(!el || !el.innerHTML.trim()) return null;
  return '<div style="width:760px;padding:38px;background:#fff;color:#0B1020;' +
    'font-family:Inter,Arial,sans-serif">' +
    '<div style="font-size:12px;letter-spacing:.12em;color:#5B6480">ҚАРЖЫ</div>' +
    '<div style="font-size:26px;font-weight:800;margin:4px 0 2px">' + tr(src[1]) + '</div>' +
    '<div style="font-size:13px;color:#5B6480;margin-bottom:20px">' + fullDate(todayISO()) + '</div>' +
    '<div style="border-top:2px solid #021CF5;padding-top:18px">' + el.innerHTML + '</div>' +
    '<div style="margin-top:26px;font-size:11.5px;color:#8892AB">' +
    tr('Бұл есеп шамамен берілген, шарт банкке қарай өзгеруі мүмкін.') + '</div></div>';
}

/* нәтиженің «атауы — мәні» жолдарын кестеге жинау */
function calcRows(kind){
  if(kind === 'stat') return statRows();
  var src = CALC_SRC[kind];
  var el = src && document.getElementById(src[0]);
  if(!el) return [];
  var rows = [], i;
  var kv = el.querySelectorAll('.kv');
  for(i = 0; i < kv.length; i++){
    var sp = kv[i].querySelector('span'), b = kv[i].querySelector('b');
    if(sp && b) rows.push([sp.textContent.trim(), b.textContent.trim()]);
  }
  /* өтеу кестесі болса — оны да қосамыз */
  var tr2 = el.querySelectorAll('table tr');
  if(tr2.length){
    rows.push(['', '']);
    for(i = 0; i < tr2.length; i++){
      var cells = tr2[i].querySelectorAll('td,th'), r = [];
      for(var j = 0; j < cells.length; j++) r.push(cells[j].textContent.trim());
      if(r.length) rows.push(r);
    }
  }
  return rows;
}

function calcCSV(kind){
  var rows = calcRows(kind);
  if(!rows.length) return false;
  var src = CALC_SRC[kind] || ['', 'Есеп'];
  var head = [[tr(src[1])], [fullDate(todayISO())], []];
  var csv = '\ufeff' + head.concat(rows)
    .map(function(r){ return r.map(csvCell).join(';'); }).join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var name = 'qarzhy-' + kind + '-' + todayISO() + '.csv';
  var f = null;
  try { f = new File([blob], name, { type: 'text/csv' }); } catch(e){}
  if(f && navigator.canShare && navigator.canShare({ files: [f] }) && navigator.share){
    navigator.share({ files: [f], title: tr(src[1]) }).catch(function(){});
    return true;
  }
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  return true;
}

/* Статистика бетінің есебі — бұрын тек PDF болатын, енді CSV де бар */
function shareStat(){
  askCalcFmt('stat', buildReport());
}

function shareCalc(kind){
  var html = calcHTML(kind);
  if(!html){ toast('Алдымен есептеңіз'); return; }
  askCalcFmt(kind, html);
}

/* қай пішімде — қарапайым сұрақ терезесі */
function askCalcFmt(kind, html){
  var name = 'qarzhy-' + kind + '-' + todayISO();
  var sc = document.getElementById('fmt-sheet');
  if(!sc) return exportPdf(html, name + '.pdf');
  document.getElementById('fmt-pdf').onclick = function(){
    closeSheets();
    exportPdf(html, name + '.pdf');
  };
  document.getElementById('fmt-csv').onclick = function(){
    closeSheets();
    if(!calcCSV(kind)) toast('Кесте табылмады');
  };
  openSheet('fmt-sheet');
}

function exportPdf(html, fname){
  var wrap = document.getElementById('pdf-stage');
  if(!wrap){
    wrap = document.createElement('div');
    wrap.id = 'pdf-stage';
    wrap.style.cssText = 'position:fixed;left:-20000px;top:0;background:#fff;z-index:-1';
    document.body.appendChild(wrap);
  }
  wrap.innerHTML = (typeof html === 'string' && html) ? html : buildReport();

  toast('PDF дайындалуда…');

  loadScript(CDN_H2C)
    .then(function(){ return loadScript(CDN_JSPDF); })
    .then(function(){
      return window.html2canvas(wrap.firstChild, {
        scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false
      });
    })
    .then(function(canvas){
      var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      var pdf = new jsPDF('p', 'mm', 'a4');
      var img = canvas.toDataURL('image/jpeg', 0.94);
      var pageH = 297, w = 210;
      var h = w * canvas.height / canvas.width;
      var left = h, pos = 0;
      pdf.addImage(img, 'JPEG', 0, pos, w, h);
      left -= pageH;
      while(left > 0){
        pos -= pageH;
        pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, pos, w, h);
        left -= pageH;
      }
      var name = (typeof fname === 'string' && fname) ? fname
                 : ('qarzhy-' + range.from + '_' + range.to + '.pdf');
      var blob = pdf.output('blob');
      wrap.innerHTML = '';

      var file = null;
      try { file = new File([blob], name, { type: 'application/pdf' }); } catch(e){}

      if(file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share){
        navigator.share({ files: [file], title: 'Қаржы есебі' })
          .then(function(){ toast('Жіберілді'); })
          .catch(function(){ pdfDownload(blob, name); });
      } else {
        pdfDownload(blob, name);
      }
    })
    .catch(function(){
      wrap.innerHTML = '';
      toast('PDF жасалмады — интернетті тексеріңіз');
    });
}

function pdfDownload(blob, name){
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
  toast('PDF сақталды');
}

/* ================= ТҰРАҚТЫ ОПЕРАЦИЯЛАР ================= */
/* {id, type:'in'|'out', cat, amt, acc, day:1..31, note, active, start:'YYYY-MM-DD', last:'YYYY-MM'} */




function ymOf(d){ return d.slice(0, 7); }
function ymNext(ym){
  var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  m++; if(m > 12){ m = 1; y++; }
  return y + '-' + String(m).padStart(2, '0');
}
function daysInYM(ym){
  return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
}


/* қосымша ашылғанда өтіп кеткен айларды толтыру */














/* ================= ЖЫЛДАМ ЖАРЛЫҚ ================= */
function handleShortcut(){
  var m = location.search.match(/[?&]add=(in|out|tr)/);
  if(!m) return;
  try { history.replaceState({ v: 'home' }, '', location.pathname + '#home'); } catch(e){}
  setTimeout(function(){
    openTx();
    setType(m[1]);
  }, 250);
}

/* ================= ТАҢДАП ӨШІРУ ================= */
var SEL = { on: false, kind: '', ids: {} };

function selStart(kind){ SEL.on = true; SEL.kind = kind; SEL.ids = {}; render(); }
function selStop(){ SEL.on = false; SEL.kind = ''; SEL.ids = {}; render(); }
function selActive(kind){ return SEL.on && SEL.kind === kind; }
function selHas(id){ return !!SEL.ids[id]; }
function selTog(id){ if(SEL.ids[id]) delete SEL.ids[id]; else SEL.ids[id] = 1; render(); }
function selCount(){ var n = 0; for(var k in SEL.ids) n++; return n; }

function selBox(id){
  return '<div class="cb' + (selHas(id) ? ' on' : '') + '">' + (selHas(id) ? '✓' : '') + '</div>';
}
function selIdsOf(kind){
  if(kind === 'tx') return currentOpsIds();
  if(kind === 'btx') return (DB.btx || []).filter(function(b){ return b.acc === brId; }).map(function(b){ return b.id; });
  if(kind === 'debt') return (DB.debts || []).map(function(d){ return d.id; });
  return [];
}
var OPS_IDS = [];
function currentOpsIds(){ return OPS_IDS.slice(); }

function selAll(){
  var ids = selIdsOf(SEL.kind);
  if(selCount() >= ids.length){ SEL.ids = {}; }
  else { SEL.ids = {}; ids.forEach(function(i){ SEL.ids[i] = 1; }); }
  render();
}
function selInvert(){
  var ids = selIdsOf(SEL.kind), next = {};
  ids.forEach(function(i){ if(!SEL.ids[i]) next[i] = 1; });
  SEL.ids = next; render();
}
function selDelete(){
  var n = selCount();
  if(!n){ toast('Ештеңе таңдалмаған'); return; }
  if(!confirm(n + ' ' + tr('жазба өшіріледі. Жалғастырасыз ба?'))) return;

  if(SEL.kind === 'tx'){
    DB.tx = DB.tx.filter(function(t){ return !SEL.ids[t.id]; });
  } else if(SEL.kind === 'btx'){
    (DB.btx || []).forEach(function(b){ if(SEL.ids[b.id]) applyBTx(b, -1); });
    DB.btx = (DB.btx || []).filter(function(b){ return !SEL.ids[b.id]; });
  } else if(SEL.kind === 'debt'){
    DB.debts = (DB.debts || []).filter(function(d){ return !SEL.ids[d.id]; });
  }
  recalcBal();
  save();
  SEL.on = false; SEL.ids = {};
  render();
  toast(n + ' ' + tr('жазба өшірілді'));
}
function drawSelBar(){
  var bar = document.getElementById('selbar');
  if(!bar) return;
  bar.classList.toggle('on', SEL.on);
  if(!SEL.on) return;
  var total = selIdsOf(SEL.kind).length;
  document.getElementById('sel-n').textContent = selCount() + ' / ' + total;
  document.getElementById('sel-all-btn').textContent =
    selCount() >= total && total > 0 ? tr('Белгіні алу') : tr('Барлығы');
}

/* ================= БРОКЕР: ВАЛЮТА БОЙЫНША ================= */
function brokerByCur(id){
  var out = {};
  (DB.btx || []).forEach(function(b){
    if(b.acc !== id) return;
    var c = b.cur || 'ACC';
    var v = (b.cur && b.orig) ? b.orig : b.amt;
    if(!out[c]) out[c] = { dep:0, wd:0, div:0, fee:0 };
    out[c][b.t] += v;
  });
  return out;
}
function curSign(c){ return c === 'KZT' ? '₸' : (c === 'USD' ? '$' : c); }

/* ================= БРОКЕР: ЕКІ ВАЛЮТА БӨЛЕК ================= */
/* Ақша қозғалысы қай валютада болса, сол валютада сақталады.
   Портфель құны да ₸ мен $ бөлек тұрады. Жалпы қосынды тек көрсету үшін теңгеге аударылады. */

function bVals(a){
  if(!a.vals){
    a.vals = { KZT: 0, USD: 0 };
    if(a.bal) a.vals[a.cur === 'USD' ? 'USD' : 'KZT'] = a.bal;   /* ескі деректі көшіру */
  }
  if(typeof a.vals.KZT !== 'number') a.vals.KZT = 0;
  if(typeof a.vals.USD !== 'number') a.vals.USD = 0;
  return a.vals;
}

/* салынған қаражат: салым − шығару, валюта бойынша */
function bInv(id){
  var m = { KZT: 0, USD: 0 };
  (DB.btx || []).forEach(function(b){
    if(b.acc !== id) return;
    var c = (b.cur === 'USD') ? 'USD' : 'KZT';
    if(b.t === 'dep') m[c] += b.amt;
    else if(b.t === 'wd') m[c] -= b.amt;
  });
  (DB.tx || []).forEach(function(t){ if(t.type === 'tr' && t.to === id) m.KZT += t.amt; });
  return m;
}

/* барлық ақша қозғалысы (дивиденд пен комиссияны қоса) — құн қолмен қойылмаған кездегі бағалау */
function bFlow(id){
  var m = { KZT: 0, USD: 0 };
  (DB.btx || []).forEach(function(b){
    if(b.acc !== id) return;
    var c = (b.cur === 'USD') ? 'USD' : 'KZT';
    if(b.t === 'dep' || b.t === 'div') m[c] += b.amt;
    else m[c] -= b.amt;
  });
  (DB.tx || []).forEach(function(t){ if(t.type === 'tr' && t.to === id) m.KZT += t.amt; });
  return m;
}

/* валюта бойынша дивиденд/комиссия */
function bDivFee(id){
  var m = { KZT: { div:0, fee:0 }, USD: { div:0, fee:0 } };
  (DB.btx || []).forEach(function(b){
    if(b.acc !== id) return;
    var c = (b.cur === 'USD') ? 'USD' : 'KZT';
    if(b.t === 'div') m[c].div += b.amt;
    else if(b.t === 'fee') m[c].fee += b.amt;
  });
  return m;
}

function kztOf(m){ return (m.KZT || 0) + (m.USD || 0) * (rateV() || 0); }

/* туынды өрістерді (bal, invested) қайта есептеу — қалған код солармен жұмыс істейді */
function syncBroker(a){
  if(!a || a.kind !== 'broker') return;
  var v = bVals(a), inv = bInv(a.id);
  a.cur = 'KZT';
  if(!a.valSet){
    var f = bFlow(a.id);
    v.KZT = f.KZT; v.USD = f.USD;
  }
  a.invested = kztOf(inv);
  a.bal = kztOf(v);
}
function syncBrokers(){ accsOf('broker').forEach(syncBroker); }

/* екі валютаны бір жолға жазу: «1 507 $ · 184 ₸» */
function curPair(m, skipZero){
  var out = [];
  if(m.USD || !skipZero) out.push(nf(m.USD) + ' $');
  if(m.KZT || !skipZero) out.push(nf(m.KZT) + ' ₸');
  return out.length ? out.join(' · ') : '0 ₸';
}

/* ================= БЮДЖЕТ ================= */






/* ================= ДЕРЕК ҚАУІПСІЗДІГІ ================= */
function storageOK(){
  try{ localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; }
  catch(e){ return false; }
}
function daysSinceBackup(){
  if(!DB.lastBackup) return null;
  return Math.floor((Date.now()-new Date(DB.lastBackup).getTime())/86400000);
}
function drawWarnings(){
  var box=document.getElementById('home-warn');
  if(!box) return;
  var html='';
  if(SAVE_ERR){
    html+='<div class="warnbar" style="background:#FDECEB;color:#8A2F29"><b>Дерек сақталмады</b>'+
      'Соңғы өзгеріс телефон жадына жазылмады. Қосымшаны жаппай тұрып, Баптау → Деректі сақтау арқылы файл көшірмесін жасаңыз.</div>';
  }
  if(!storageOK()){
    html+='<div class="warnbar" style="background:#FDECEB;color:#8A2F29"><b>Дерек сақталмайды</b>'+
      'Браузер жадына жазу мүмкін емес. Chrome-ды жеке (инкогнито) режимде ашпаңыз.</div>';
  }
  var d=daysSinceBackup();
  if(d===null && DB.tx.length>5){
    html+='<div class="warnbar"><b>Көшірме жасаңыз</b>Дерек тек осы браузерде тұр. '+
      'Баптау → Деректі сақтау арқылы сақтап қойыңыз.</div>';
  } else if(d!==null && d>=14){
    html+='<div class="warnbar"><b>Көшірме ескірді</b>Соңғы көшірмеден '+d+' күн өтті. Жаңартып қойыңыз.</div>';
  }
  var dt2 = debtTotals();
  if(dt2.overdue){
    html+='<div class="warnbar"><b>Қарыз мерзімі өтті</b>'+dt2.overdue+
      ' жазбаның қайтару мерзімі өтіп кетті. Қарыздар бөлімінен қараңыз.</div>';
  }
  box.innerHTML=html;
}
function cleanDups(){
  var seen={}, dups=[];
  DB.tx.forEach(function(t){
    var k=t.date+'|'+Math.round(t.amt)+'|'+t.type+'|'+(t.cat||'')+'|'+(t.note||'').slice(0,20);
    if(seen[k]) dups.push(t); else seen[k]=1;
  });
  if(!dups.length){ toast('Қайталанған операция жоқ'); render(); return; }
  if(!confirm(dups.length+' қайталанған операция табылды. Өшіресіз бе?')) return;
  var ids={}; dups.forEach(function(t){ ids[t.id]=1; });
  DB.tx=DB.tx.filter(function(t){ return !ids[t.id]; });
  recalcBal();
  save(); render(); toast(dups.length+' операция өшірілді');
}

/* ================= АРТҚА ҚАЙТУ ================= */
/* қай бетте тұрғанымызды есте сақтау — жаңартқанда сол жерде қаламыз */
var BOOT_HASH = '';
function saveView(){
  try{
    localStorage.setItem('qarzhy_view', JSON.stringify({
      v: view, br: (typeof brId !== 'undefined' ? brId : null),
      y: Math.round(window.scrollY || 0),
      oa: opsAcc, of: opsFilter, om: opsMonth
    }));
  }catch(e){}
}
function restoreView(){
  var st = null;
  try{ st = JSON.parse(localStorage.getItem('qarzhy_view') || 'null'); }catch(e){}
  /* жаңартқанда: алдымен сақталған бет, сосын hash */
  var h = BOOT_HASH;
  var v = h || (st && st.v) || 'home';

  if(v === 'broker'){
    var id = (st && st.br) || null;
    if(id && acc(id)) brId = id; else v = 'accounts';
  }
  if(!document.getElementById('p-' + v)) v = 'home';

  /* операциялар бетінің сүзгісін де қалпына келтіреміз */
  if(st && st.v === v && v === 'ops'){
    if(st.oa) opsAcc = st.oa;
    if(st.of) opsFilter = st.of;
    opsMonth = st.om || null;
    var segs = document.querySelectorAll('[data-of]');
    for(var i2 = 0; i2 < segs.length; i2++)
      segs[i2].classList.toggle('on', segs[i2].dataset.of === opsFilter);
  }

  if(v !== 'home') go(v, true); else render();
  try{ history.replaceState({ v: v }, '', '#' + v); }catch(e){}

  if(st && st.y && st.v === v){
    setTimeout(function(){ window.scrollTo(0, st.y); syncTopbar(); }, 60);
  }
  syncTopbar();
}

function initHistory(){
  if(!(history && history.replaceState)) return;
  window.addEventListener('popstate', function(e){
    var st = e.state || { v: 'home' };
    if(!st.sheet && sheetOpen()) closeSheets(true);
    if(st.v && st.v !== view) go(st.v, true);
  });
}

/* ================= ШОТТЫ САЛЫСТЫРУ (СВЕРКА) ================= */
/* Банктегі нақты қалдықты енгізесіз — қосымша айырманы көрсетеді.
   Түзету жеке операция болып жазылады, сондықтан кейін «бұл сан қайдан шықты»
   деген сұрақ тумайды. Бұрын мұны шотты өңдеу арқылы жасау керек болатын
   және айырма қайда кеткені еш жерде көрінбейтін. */
var SYNC = {};   /* accId -> енгізілген нақты қалдық */

function syncDiffs(){
  var list = [], total = 0;
  accsOf('asset').forEach(function(a){
    var real = SYNC[a.id];
    if(real === undefined || real === null || real === '') return;
    var d = r2(parseFloat(real) - (a.bal || 0));
    if(!isFinite(d) || Math.abs(d) < 0.5) return;
    list.push({ id: a.id, name: a.name, app: a.bal || 0, real: parseFloat(real), diff: d, cur: a.cur });
    total += (a.cur === 'USD' && rateV() > 0) ? d * rateV() : d;
  });
  return { list: list, total: r2(total) };
}

function drawSync(){
  var box = document.getElementById('sync-list');
  if(!box) return;
  var list = accsOf('asset');
  box.innerHTML = '';
  if(!list.length){
    box.innerHTML = '<div class="card"><div class="empty">Банк шоты жоқ.</div></div>';
    return;
  }
  list.forEach(function(a){
    var sym = accCurSym(a);
    var val = SYNC[a.id];
    var d = (val !== undefined && val !== '') ? r2(parseFloat(val) - (a.bal || 0)) : null;
    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="row" style="padding:0 0 10px">' + accBadge(a) +
        '<div style="flex:1;min-width:0"><div class="name">' + esc(a.name) + '</div>' +
        '<div class="sub2">Қосымшада: ' + money(a.bal || 0, sym) + '</div></div></div>' +
      '<label class="f">Банктегі нақты қалдық, ' + sym + '</label>' +
      '<input class="inp soft" type="number" inputmode="decimal" placeholder="' +
        Math.round(a.bal || 0) + '" value="' + (val === undefined ? '' : val) + '">' +
      (d === null || Math.abs(d) < 0.5
        ? (d === null ? '<div class="muted">Санды жазсаңыз, айырма осында шығады.</div>'
                      : '<div class="muted" style="color:var(--pos)">✓ Сәйкес келеді</div>')
        : '<div class="kv"><span>Айырма</span><b style="color:' + (d > 0 ? 'var(--pos)' : 'var(--neg)') + '">' +
          (d > 0 ? '+' : '−') + nf(Math.abs(d)) + ' ' + sym + '</b></div>' +
          '<div class="muted">' + (d > 0
            ? 'Банкте артық — жазылмай қалған кіріс бар сияқты.'
            : 'Банкте кем — жазылмай қалған шығын бар сияқты.') + '</div>');
    var inp = card.querySelector('input');
    inp.oninput = function(){
      SYNC[a.id] = inp.value;
      drawSyncSummary();
    };
    inp.onblur = function(){ drawSync(); };
    box.appendChild(card);
  });
  drawSyncSummary();
}

function drawSyncSummary(){
  var r = syncDiffs();
  var card = document.getElementById('sync-sum');
  var btn = document.getElementById('sync-apply');
  if(!card || !btn) return;
  if(!r.list.length){
    card.style.display = 'none'; btn.style.display = 'none';
    return;
  }
  card.style.display = ''; btn.style.display = '';
  var h = '';
  r.list.forEach(function(x){
    var sym = x.cur === 'USD' ? '$' : '₸';
    h += '<div class="kv"><span>' + esc(x.name) + '</span><b style="color:' +
      (x.diff > 0 ? 'var(--pos)' : 'var(--neg)') + '">' +
      (x.diff > 0 ? '+' : '−') + nf(Math.abs(x.diff)) + ' ' + sym + '</b></div>';
  });
  h += '<div class="kv" style="margin-top:8px"><span>Барлығы теңгемен</span><b>' +
       (r.total > 0 ? '+' : '−') + nf(Math.abs(r.total)) + ' ₸</b></div>';
  document.getElementById('sync-sum-box').innerHTML = h;
  btn.textContent = tr('Айырманы түзету') + ' (' + r.list.length + ')';
}

function applySync(){
  var r = syncDiffs();
  if(!r.list.length){ toast('Айырма жоқ'); return; }
  if(!confirm(r.list.length + ' ' + tr('шотқа түзету операциясы қосылады. Жалғастырасыз ба?'))) return;
  r.list.forEach(function(x){
    var t = {
      id: newId(),
      type: x.diff > 0 ? 'in' : 'out',
      cat: 'Басқа',
      amt: Math.abs(x.diff) * ((x.cur === 'USD' && rateV() > 0) ? rateV() : 1),
      date: todayISO(),
      note: 'Түзету — банкпен салыстыру',
      acc: x.id, loan: null, to: null
    };
    stampTx(t);
    DB.tx.push(t);
  });
  SYNC = {};
  recalcBal();
  save(); render(); buzz([8, 40, 14]);
  toast(r.list.length + ' түзету жазылды');
}

/* ================= БАСТЫ БЕТТІ РЕТТЕУ ================= */
/* Басты беттегі карталардың реті мен көрінуі DB.home ішінде тұрады.
   Карта HTML-де бір рет жазылады, мұндағы код тек ретін ауыстырып, керексізін жасырады. */

var WIDGETS = [
  ['finance', 'Менің қаржым',              'brief'],
  ['quick',   'Жылдам сілтемелер',         'grid'],
  ['invest',  'Инвестиция',                'invest'],
  ['forecast','Ай соңына болжам',          'target'],
  ['goals',   'Мақсаттар',                 'flag'],
  ['debts',   'Қарыздар',                  'swap'],
  ['cats',    'Айдағы шығын',              'chart'],
  ['import',  'Банк үзіндісін жүктеу',     'inbox'],
  ['recent',  'Соңғы операциялар',         'receipt']
];
/* әдепкіде көрінетіндер — қалғаны жасырулы тұрады */
var HOME_ON_DEF = ['finance', 'quick', 'forecast', 'invest', 'import', 'recent'];

function widgetIdx(k){ for(var i = 0; i < WIDGETS.length; i++) if(WIDGETS[i][0] === k) return i; return -1; }
function widgetName(k){ var i = widgetIdx(k); return i < 0 ? k : WIDGETS[i][1]; }
function widgetIcon(k){ var i = widgetIdx(k); return i < 0 ? 'star' : WIDGETS[i][2]; }

function homeCfg(){
  var h = DB.home;
  if(!h || !h.order || !h.order.length){
    h = DB.home = { order: WIDGETS.map(function(w){ return w[0]; }), off: {} };
    WIDGETS.forEach(function(w){ if(HOME_ON_DEF.indexOf(w[0]) === -1) h.off[w[0]] = 1; });
  }
  if(!h.off) h.off = {};
  /* жаңа карта шықса — соңына, жасырулы күйде */
  WIDGETS.forEach(function(w){
    if(h.order.indexOf(w[0]) === -1){
      h.order.push(w[0]);
      if(HOME_ON_DEF.indexOf(w[0]) === -1) h.off[w[0]] = 1;
    }
  });
  /* енді жоқ картаны тізімнен алып тастаймыз */
  h.order = h.order.filter(function(k){ return widgetIdx(k) !== -1; });
  return h;
}
function widgetOn(k){ return !homeCfg().off[k]; }

function applyHome(){
  var box = document.getElementById('home-widgets');
  if(!box) return;
  var cfg = homeCfg(), now = [], i;
  for(i = 0; i < box.children.length; i++){
    var kk = box.children[i].getAttribute('data-w');
    if(kk) now.push(kk);
  }
  var want = [];
  cfg.order.forEach(function(k){ if(box.querySelector('[data-w="' + k + '"]')) want.push(k); });
  /* рет өзгермесе — DOM-ды қозғамаймыз (әйтпесе әр render-де анимация қайта басталады) */
  var same = now.join('|') === want.join('|');
  want.forEach(function(k){
    var el = box.querySelector('[data-w="' + k + '"]');
    var hide = !!cfg.off[k];
    if((el.style.display === 'none') !== hide) el.style.display = hide ? 'none' : '';
    if(!same) box.appendChild(el);
  });
}
function toggleWidget(k){
  var cfg = homeCfg();
  if(cfg.off[k]) delete cfg.off[k]; else cfg.off[k] = 1;
  save(); render();
}
function moveWidget(k, d){
  var cfg = homeCfg(), i = cfg.order.indexOf(k), j = i + d;
  if(i < 0 || j < 0 || j >= cfg.order.length) return;
  cfg.order[i] = cfg.order[j]; cfg.order[j] = k;
  save(); render();
}
function resetHome(){
  DB.home = null; homeCfg(); save(); render();
  toast('Әдепкі қалпына келтірілді');
}
function drawHomeSet(){
  var box = document.getElementById('hs-list');
  if(!box) return;
  var cfg = homeCfg();
  box.innerHTML = '';
  cfg.order.forEach(function(k, i){
    var off = !!cfg.off[k];
    var el = document.createElement('div');
    el.className = 'hs-row' + (off ? ' off' : '');
    el.innerHTML =
      '<div class="ic">' + svgIcon(widgetIcon(k)) + '</div>' +
      '<div class="nm">' + widgetName(k) + '</div>' +
      '<button class="hs-btn eye' + (off ? '' : ' on') + '">' + svgIcon(off ? 'eyeOff' : 'eye') + '</button>' +
      '<button class="hs-btn"' + (i === 0 ? ' disabled' : '') + '>\u2191</button>' +
      '<button class="hs-btn"' + (i === cfg.order.length - 1 ? ' disabled' : '') + '>\u2193</button>';
    var bs = el.querySelectorAll('button');
    bs[0].onclick = function(){ toggleWidget(k); };
    bs[1].onclick = function(){ moveWidget(k, -1); };
    bs[2].onclick = function(){ moveWidget(k, 1); };
    box.appendChild(el);
  });
}

/* ---- басты беттегі жаңа карталардың ішін толтыру ---- */
function renderHomeWidgets(){
  var cfg = homeCfg();

  if(!cfg.off.invest && document.getElementById('w-inv-val')){
    var IT = investTotals();
    document.getElementById('w-inv-count').textContent = IT.list.length + ' брокер';
    document.getElementById('w-inv-val').textContent = money(IT.valT);
    document.getElementById('w-inv-inv').textContent = money(IT.invT);
    var wp = document.getElementById('w-inv-pl');
    wp.textContent = (IT.pl >= 0 ? '+' : '\u2212') + nf(IT.pl) + ' \u20b8';
    wp.style.color = IT.pl >= 0 ? 'var(--pos)' : 'var(--neg)';
    var wl = document.getElementById('w-inv-list');
    wl.innerHTML = '';
    if(!IT.list.length){
      wl.innerHTML = '<div class="empty" style="padding:18px 8px">Брокерлік шот жоқ. Инвестицияңызды осында қосыңыз.</div>';
    } else {
      IT.list.slice().sort(function(x, y){ return y.bal - x.bal; }).slice(0, 3).forEach(function(a){
        var v = bVals(a), inv = kztOf(bInv(a.id)), pl = a.bal - inv;
        var row = document.createElement('div');
        row.className = 'row';
        row.style.cursor = 'inherit';
        row.innerHTML = accBadge(a, true) +
          '<div style="min-width:0;flex:1"><div class="name">' + esc(a.name) + '</div>' +
          '<div class="sub2" style="color:' + (pl >= 0 ? 'var(--pos)' : 'var(--neg)') + '">' +
            (pl >= 0 ? '+' : '\u2212') + nf(pl) + ' \u20b8' +
            (inv > 0 ? ' (' + (pl >= 0 ? '+' : '\u2212') + Math.abs(Math.round(pl / inv * 100)) + '%)' : '') +
          '</div></div>' +
          '<div class="amt">' + curPair(v, true) + '</div>';
        wl.appendChild(row);
      });
    }
  }

  if(!cfg.off.forecast && document.getElementById('w-fc-end')){
    var F = forecast();
    document.getElementById('w-fc-end').textContent = money(F.endBal);
    document.getElementById('w-fc-end').style.color = F.endBal >= 0 ? '' : 'var(--neg)';
    document.getElementById('w-fc-sub').textContent =
      F.rest ? F.rest + ' күн қалды' : 'ай аяқталды';
    document.getElementById('w-fc-box').innerHTML =
      '<div class="kv"><span>Қазір шоттарда</span><b>' + money(F.now) + '</b></div>' +
      '<div class="kv"><span>Күнделікті орташа шығын</span><b>' + money(F.avg) + '</b></div>' +
      (F.planOut ? '<div class="kv"><span>Күтіп тұрған тұрақты төлем</span><b style="color:var(--neg)">' + money(F.planOut) + '</b></div>' : '') +
      (F.planIn ? '<div class="kv"><span>Күтілетін кіріс</span><b style="color:var(--pos)">' + money(F.planIn) + '</b></div>' : '') +
      '<div class="kv"><span>Айдың болжамды шығыны</span><b>' + money(F.endOut) + '</b></div>';
  }

  if(!cfg.off.goals && document.getElementById('w-goals-box')){
    var gb = document.getElementById('w-goals-box');
    gb.innerHTML = '';
    if(!DB.goals.length){
      gb.innerHTML = '<div class="empty">Мақсат әлі жоқ. Жинайтын сомаңызды белгілеп қойыңыз.</div>';
    } else {
      DB.goals.slice(0, 4).forEach(function(g){
        var f = g.target > 0 ? g.saved / g.target : 0;
        gb.appendChild(barRow(
          svgIcon('flag', 'bar-ic') + '<span>' + esc(g.name) + '</span>',
          nf(g.saved) + ' / ' + nf(g.target) + ' \u20b8 \u00b7 ' + Math.min(100, Math.round(f * 100)) + '%',
          Math.min(1, f), 'pos'));
      });
    }
  }

  if(!cfg.off.debts && document.getElementById('w-debts-box')){
    var dt = debtTotals();
    document.getElementById('w-debts-box').innerHTML =
      '<div class="kv"><span>Маған қарыз</span><b style="color:var(--pos)">' + money(dt.lent) + '</b></div>' +
      '<div class="kv"><span>Мен қарызбын</span><b style="color:var(--neg)">' + money(dt.owed) + '</b></div>' +
      (dt.overdue ? '<div class="kv"><span>Мерзімі өткен</span><b style="color:var(--neg)">' + dt.overdue + '</b></div>' : '');
  }

  if(!cfg.off.cats && document.getElementById('w-cats-box')){
    var cb = document.getElementById('w-cats-box');
    cb.innerHTML = '';
    var sums = {}, tot = 0;
    DB.tx.forEach(function(t){
      if(t.type === 'out' && inMonth(t.date)){ sums[t.cat] = (sums[t.cat] || 0) + t.amt; tot += t.amt; }
    });
    var ks = Object.keys(sums).sort(function(x, y){ return sums[y] - sums[x]; }).slice(0, 5);
    if(!ks.length){
      cb.innerHTML = '<div class="empty">Бұл айда шығын жоқ.</div>';
    } else {
      ks.forEach(function(k){
        var f = tot ? sums[k] / tot : 0;
        cb.appendChild(barRow(
          catSvg('out', k, 'bar-ic') + '<span>' + k + '</span>',
          money(sums[k]) + ' \u00b7 ' + Math.round(f * 100) + '%', f, 'neg'));
      });
    }
  }
}

/* ================= ИНВЕСТИЦИЯ: БАРЛЫҚ БРОКЕР БІР БЕТТЕ ================= */
function investTotals(){
  var list = accsOf('broker');
  var val = { KZT: 0, USD: 0 }, inv = { KZT: 0, USD: 0 },
      dv  = { KZT: 0, USD: 0 }, fe  = { KZT: 0, USD: 0 };
  list.forEach(function(a){
    syncBroker(a);
    var v = bVals(a), i = bInv(a.id), d = bDivFee(a.id);
    val.KZT += v.KZT; val.USD += v.USD;
    inv.KZT += i.KZT; inv.USD += i.USD;
    dv.KZT  += d.KZT.div; dv.USD += d.USD.div;
    fe.KZT  += d.KZT.fee; fe.USD += d.USD.fee;
  });
  var valT = kztOf(val), invT = kztOf(inv);
  return { list: list, val: val, inv: inv, div: dv, fee: fe,
           valT: valT, invT: invT, pl: valT - invT,
           pct: invT > 0 ? (valT - invT) / invT * 100 : 0 };
}

function renderInvest(){
  if(!document.getElementById('iv-list')) return;
  var IT = investTotals();

  document.getElementById('iv-count').textContent = IT.list.length + ' брокер';
  animNum(document.getElementById('iv-val'), IT.valT);
  var pill = document.getElementById('iv-pill');
  pill.textContent = IT.invT > 0
    ? (IT.pl >= 0 ? '\u2191 +' : '\u2193 \u2212') + Math.abs(Math.round(IT.pct)) + '%'
    : '\u2014';
  pill.style.color = IT.pl >= 0 ? '#7CF2CE' : '#FFA8B3';
  document.getElementById('iv-inv').textContent = curPair(IT.inv, true);
  var ple = document.getElementById('iv-pl');
  ple.textContent = (IT.pl >= 0 ? '+' : '\u2212') + nf(IT.pl) + ' \u20b8';
  ple.style.color = IT.pl >= 0 ? '#7CF2CE' : '#FFA8B3';

  /* --- брокерлер тізімі --- */
  var box = document.getElementById('iv-list');
  box.innerHTML = '';
  if(!IT.list.length){
    box.innerHTML = '<div class="empty">Брокерлік шот жоқ.<br>Төмендегі түймемен қосыңыз.</div>';
  } else {
    IT.list.slice().sort(function(x, y){ return y.bal - x.bal; }).forEach(function(a, n){
      var v = bVals(a), i = bInv(a.id), invT = kztOf(i), pl = a.bal - invT;
      var share = IT.valT > 0 ? Math.max(0, a.bal / IT.valT) : 0;
      var el = document.createElement('div');
      el.style.padding = '4px 0 12px';
      if(n) el.style.borderTop = '1px solid var(--line)';
      el.innerHTML =
        '<div class="row">' + accBadge(a) +
          '<div style="min-width:0;flex:1"><div class="name">' + esc(a.name) + '</div>' +
          '<div class="sub2">Салынған ' + curPair(i, true) + ' \u00b7 ' +
            (pl >= 0 ? '+' : '\u2212') + nf(pl) + ' \u20b8' +
            (invT > 0 ? ' (' + (pl >= 0 ? '+' : '\u2212') + Math.abs(Math.round(pl / invT * 100)) + '%)' : '') +
          '</div></div>' +
          '<div class="amt">' + curPair(v, true) + '</div>' +
        '</div>' +
        '<div class="iv-share"><i style="width:' + Math.round(share * 100) + '%"></i></div>' +
        '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:7px;font-size:12.4px;color:var(--ink-2)">' +
          '<span>Портфельдің ' + Math.round(share * 100) + '%-ы</span>' +
          '<span class="lnk" data-bval="1">Құнын жаңарту</span>' +
        '</div>';
      el.onclick = function(){ openBroker(a.id); };
      el.querySelector('[data-bval]').onclick = function(e){ e.stopPropagation(); openBVal(a.id); };
      box.appendChild(el);
    });
  }

  /* --- валюта бойынша --- */
  var h = '';
  ['USD', 'KZT'].forEach(function(c){
    var sg = c === 'USD' ? '$' : '\u20b8';
    if(!IT.val[c] && !IT.inv[c]) return;
    var p = IT.val[c] - IT.inv[c];
    h += '<label class="f" style="margin-top:12px">' + (c === 'USD' ? 'Доллар' : 'Теңге') + '</label>' +
      '<div class="kv"><span>Портфель құны</span><b>' + nf(IT.val[c]) + ' ' + sg + '</b></div>' +
      '<div class="kv"><span>Салынған</span><b>' + nf(IT.inv[c]) + ' ' + sg + '</b></div>' +
      '<div class="kv"><span>Табыс</span><b style="color:' + (p >= 0 ? 'var(--pos)' : 'var(--neg)') + '">' +
        (p >= 0 ? '+' : '\u2212') + nf(p) + ' ' + sg +
        (IT.inv[c] > 0 ? ' (' + (p >= 0 ? '+' : '\u2212') + Math.abs(Math.round(p / IT.inv[c] * 100)) + '%)' : '') +
      '</b></div>';
  });
  document.getElementById('iv-cur').innerHTML = h || '<div class="empty">Дерек жоқ.</div>';

  /* --- жалпы есеп --- */
  var dvT = kztOf(IT.div), feT = kztOf(IT.fee);
  document.getElementById('iv-info').innerHTML =
    '<div class="kv"><span>Портфель құны</span><b>' + curPair(IT.val, true) + '</b></div>' +
    '<div class="kv"><span>Барлығы теңгемен</span><b>' + money(IT.valT) + '</b></div>' +
    '<div class="kv"><span>Салынған қаражат</span><b>' + money(IT.invT) + '</b></div>' +
    (dvT ? '<div class="kv"><span>Дивиденд · купон</span><b style="color:var(--pos)">+' + nf(dvT) + ' \u20b8</b></div>' : '') +
    (feT ? '<div class="kv"><span>Комиссия · салық</span><b style="color:var(--neg)">\u2212' + nf(feT) + ' \u20b8</b></div>' : '') +
    '<div class="kv"><span>Курс</span><b>' +
      (rateV() ? '1 $ = ' + rateV().toFixed(2).replace('.', ',') + ' \u20b8' : '\u2014') + '</b></div>';
}

/* ================= START ================= */
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
}
function boot(){
  BOOT_HASH = (location.hash || '').replace('#', '');
  initHistory();
  migrateBal();          /* ескі деректі есептелетін қалдық моделіне көшіру */
  autoSnapshot();
  loadSnaps();
  askPersist();
  refreshStorage();
  bindExitSave();
  applyTheme();
  watchSystemTheme();
  bindSheetDrag();
  LANG = DB.lang || 'kk';
  document.documentElement.lang = LANG;
  if(navigator.onLine !== false){
    var stale = !DB.rate || !DB.rate.at || (Date.now()-new Date(DB.rate.at).getTime()) > 12*3600000;
    if(stale && (!DB.rate || DB.rate.src!=='manual' || !DB.rate.v)) setTimeout(function(){ fetchRate(false); }, 800);
  }
  drawCats();
  drawAccs();
  setPeriod('month');
  setInvMode('income');
  setLoanMode('pay');
  render();
  restoreView();
  handleShortcut();
}

/* алдымен IndexedDB, ол бос болса — ескі localStorage деректі көшіріп аламыз */
idbGet('db').then(function(v){
  if(v && (v.tx || v.accounts)){
    applyDB(v);
  } else {
    load();
    if(DB.tx.length || DB.accounts.length) idbSet('db', JSON.parse(JSON.stringify(DB))).catch(function(){});
  }
  boot();
}).catch(function(){
  load();
  boot();
});
