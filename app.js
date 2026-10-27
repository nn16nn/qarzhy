/* Қаржы — қосымша логикасы
   index.html осы файлды жүктейді. Барлық есептеу осында. */
/* ================= STORAGE ================= */
var mem = {};
var store = {
  get: function(k){ try{ return localStorage.getItem(k); }catch(e){ return k in mem ? mem[k] : null; } },
  set: function(k,v){ try{ localStorage.setItem(k,v); }catch(e){ mem[k]=v; } }
};
var brId = null;
var DB = { tx:[], goals:[], accounts:[], btx:[], debts:[], limits:{}, split:null, recur:[], lastBackup:null, lang:'kk', theme:'auto', rate:null };

function load(){
  try{
    var raw = store.get('qarzhy_v1');
    if(raw){
      var d = JSON.parse(raw);
      DB.tx = d.tx||[]; DB.goals = d.goals||[]; DB.accounts = d.accounts||[]; DB.btx = d.btx||[]; DB.debts = d.debts||[];
      DB.limits = d.limits||{};
      DB.split = d.split||null; DB.recur = d.recur||[];
      DB.lang = d.lang||'kk'; DB.theme = d.theme||'auto'; DB.skin = d.skin||'coral'; DB.rules = d.rules||{}; DB.pref = d.pref||{};
      DB.lastBackup = d.lastBackup||null; DB.rate = d.rate||null;
      DB.updated = d.updated||null;
      if(!DB.accounts.length){
        DB.accounts = [{id:'a1',name:'Қолма-қол',kind:'asset',icon:'wallet',bal:d.start||0}];
      }
    }
  }catch(e){}
  if(!DB.accounts.length) DB.accounts = [{id:'a1',name:'Қолма-қол',kind:'asset',icon:'wallet',bal:0}];
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
/* v4.0 көшу: брокер шоттары алынды — оларға салынған ақша «Инвестиция» шығыны болып қалады */
function migrateBrokers(){
  var brIds = {};
  (DB.accounts || []).forEach(function(a){ if(a.kind === 'broker') brIds[a.id] = 1; });
  var changed = false;
  (DB.tx || []).forEach(function(t){
    if(t.type === 'tr' && t.to && brIds[t.to]){
      t.type = 'out'; t.cat = 'Инвестиция'; t.to = null; changed = true;
    }
  });
  if(Object.keys(brIds).length){
    DB.accounts = DB.accounts.filter(function(a){ return a.kind !== 'broker'; });
    changed = true;
  }
  if(DB.btx && DB.btx.length){ DB.btx = []; changed = true; }
  if(changed) save();
}

function applyDB(d){
  if(!d) return;
  DB.tx = d.tx || []; DB.goals = d.goals || []; DB.accounts = d.accounts || [];
  DB.btx = d.btx || []; DB.debts = d.debts || []; DB.limits = d.limits || {};
  DB.split = d.split || null; DB.recur = d.recur || [];
  SPLIT = null; if(splitTimer){ clearTimeout(splitTimer); splitTimer = null; }
  DB.lastBackup = d.lastBackup || null; DB.lang = d.lang || 'kk';
  DB.theme = d.theme || 'auto'; DB.skin = d.skin || DB.skin || 'coral'; DB.rate = d.rate || null;
  DB.rules = d.rules || DB.rules || {}; DB.pref = d.pref || DB.pref || {};
  DB.updated = d.updated || null;
  if(!DB.accounts.length) DB.accounts = [{id:'a1',name:'Қолма-қол',kind:'asset',icon:'wallet',bal:d.start||0,cur:'KZT'}];
}

var saveTimer = null;
function save(){
  DB.updated = new Date().toISOString();
  /* localStorage — жеделдігі үшін, сыймаса үнсіз өтеді */
  try { localStorage.setItem('qarzhy_v1', JSON.stringify(DB)); } catch(e){}
  /* IndexedDB — негізгі қойма, 300 мс кідіріспен */
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 300);
}
/* IndexedDB-ге кідіріссіз жазу: бет жабылар алдында, қайта жүктелер алдында */
var idbChecked = false, idbPending = false;
function flushSave(){
  if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
  /* IndexedDB-дегі деректі тексермей тұрып оның үстінен жазбаймыз */
  if(!idbChecked){ idbPending = true; return Promise.resolve(); }
  return idbSet('db', JSON.parse(JSON.stringify(DB))).catch(function(){});
}
/* localStorage-тағы көшірме */
function lsData(){
  try { var raw = store.get('qarzhy_v1'); return raw ? JSON.parse(raw) : null; } catch(e){ return null; }
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
    applyDB(d);
    save(); render(); toast('Қайтарылды');
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
  out:[["Тамақ","🍜"],["Ойын-сауық","🎬"],["Байланыс","📱"],["Әке-шешеме","🏠"],
       ["Көлік","🚌"],["Киім","👕"],["Тұрғын үй","🏢"],["Денсаулық","💊"],["Білім","📚"],["Сыйлық","🎁"],
       ["Инвестиция","📊"],["Несие төлемі","💳"],["Аударымдар","↗"],["Басқа","✦"]],
  in:[["Жалақы","💼"],["Бизнес","📈"],["Фриланс","💻"],["Инвестиция","📊"],["Кэшбэк","🪙"],["Несие алу","💳"],["Сыйлық","🎁"],["Басқа","✦"]]
};
var ACC_ICONS = ["card","bank","wallet","phone","invest","chart","coin","house"];
function accIconHtml(a, cls){
  var n = a && a.icon;
  if(n && SVGI[n]) return svgIcon(n, cls);
  return '<span style="font-size:19px;line-height:1">' + (n || '') + '</span>';
}
/* Банктер: ресми бренд түсі (Brandfetch), белгідегі әріп, атауын тану.
   Банктердің нақты логотиптері салынбайды — тек түсі мен бас әрпі. */
var BANKS = [
  ['Kaspi Bank',          'card',  /kaspi|каспи|каспий/i,                 'K',  '#F14635', '#FFFFFF', 'banks/kaspi.png'],
  ['Halyk Bank',          'bank',  /halyk|халык|халық|народный банк/i,    'H',  '#00815F', '#F1A400', 'banks/halyk.png'],
  ['Freedom SuperApp',    'bank',  /freedom|фридом|ffin/i,                'F',  '#02B140', '#FFFFFF', 'banks/freedom.png'],
  ['Jusan Bank',          'card',  /jusan|жусан|жусан/i,                  'J',  '#FF5A00', '#1E3F7A', 'banks/jusan.png'],
  ['ForteBank',           'card',  /forte|форте/i,                        'Fo', '#00B4C5', '#FFFFFF', 'banks/forte.png'],
  ['Bereke Bank',         'bank',  /bereke|береке/i,                      'B',  '#023DFF', '#FFFFFF', 'banks/bereke.png'],
  ['Bank CenterCredit',   'bank',  /centercredit|центркредит|\bbcc\b|бцк/i,'BCC','#00AB75', '#FFFFFF', 'banks/bcc.png'],
  ['Otbasy Bank',         'house', /otbasy|отбасы|жилстрой/i,             'O',  '#00A3A3', '#FFFFFF', 'banks/otbasy.png'],
  ['Home Credit Bank',    'card',  /home ?credit|хоум ?кредит/i,          'HC', '#E31E3A', '#FFFFFF', 'banks/homecredit.png'],
  ['Qazaq Bank',          'bank',  /qazaq|назарбанк/i,                    'Q',  '#2F6FB8', '#FFFFFF', 'banks/qazaq.png'],
  ['Қолма-қол',           'wallet',/^қолма-қол|^наличн|^cash/i,           '₸',  '#0B9F72', '#FFFFFF']
];
function bankOf(name){
  if(!name) return null;
  var k = String(name).trim();
  for(var i = 0; i < BANKS.length; i++){
    if(BANKS[i][0].toLowerCase() === k.toLowerCase()) return BANKS[i];
  }
  for(var j = 0; j < BANKS.length; j++){
    if(BANKS[j][2] && BANKS[j][2].test(k)) return BANKS[j];
  }
  return null;
}
/* ескі код үшін: [әріп, фон, мәтін түсі] */
function brandOf(name){
  var b = bankOf(name);
  return b ? [b[3], b[4], b[5], b[6] || null] : null;
}
function brandSm(br){
  if(!br) return '';
  if(br[3]) return '<span class="brand sm logo' + (/jusan|bcc|homecredit|otbasy/.test(br[3]) ? ' full' : '') + '" style="--bc:' + br[1] + '"><img src="' + br[3] + '" alt="" loading="lazy"></span>';
  return '<span class="brand sm' + (br[0].length > 1 ? ' w' : '') + '" style="background:' + br[1] + ';color:' + (br[2] || '#fff') + '">' + br[0] + '</span>';
}
function accBadge(a, small){
  var b = brandOf(a.name);
  if(!b) return '<div class="ico'+(small?' sm':'')+'">'+accIconHtml(a)+'</div>';
  if(b[3]) return '<div class="brand logo'+(small?' sm':'')+(/jusan|bcc|homecredit|otbasy/.test(b[3]) ? ' full' : '')+'" style="--bc:'+b[1]+'"><img src="'+b[3]+'" alt=""></div>';
  return '<div class="brand'+(small?' sm':'')+(b[0].length > 1 ? ' w' : '')+'" style="background:'+b[1]+';color:'+(b[2]||'#fff')+'">'+b[0]+'</div>';
}

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
/* тар ұяшықтарға арналған қысқа пішім: 1 384 546 ₸ → 1,38 млн ₸ */
function moneyShort(n,c){
  var sym=c||"₸", a=Math.abs(n), sg=(n<0?"−":"");
  function d(v){
    var s = v>=100 ? Math.round(v).toString()
          : v>=10  ? (Math.round(v*10)/10).toString()
                   : (Math.round(v*100)/100).toString();
    return s.replace(".", ",");
  }
  if(a>=1e9) return sg + d(a/1e9) + " млрд " + sym;
  if(a>=1e6) return sg + d(a/1e6) + " млн " + sym;
  return money(n, sym);
}
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
function esc(s){ return String(s).replace(/[<>&"']/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c];}); }
function toast(m){
  var t=document.getElementById('toast');
  t.textContent=(typeof tr==='function'?tr(m):m); t.classList.add('on');
  /* алдыңғы хабардың таймері жаңасын ерте жасырмасын */
  clearTimeout(t._tm);
  t._tm=setTimeout(function(){t.classList.remove('on');},1800);
}
function acc(id){ for(var i=0;i<DB.accounts.length;i++) if(DB.accounts[i].id===id) return DB.accounts[i]; return null; }
function newId(){ return Date.now().toString()+Math.floor(Math.random()*900+100); }

var cur = new Date(); cur.setDate(1);
function shiftMonth(d){ cur.setMonth(cur.getMonth()+d); render(); }
function inMonth(s){ return s.slice(0,7) === iso(cur).slice(0,7); }

function totals(){
  var b=0,br=0,inv=0,d=0;
  DB.accounts.forEach(function(x){
    if(x.kind==='debt'){ d+=toKZT(x); }
    else { b+=toKZT(x); }
  });
  inv = investedTotal();
  var dt = (typeof debtTotals === 'function') ? debtTotals() : {lent:0, owed:0};
  /* мақсаттарда жиналған ақша таза капиталға кірмейді — ол бөлек есептеледі */
  var g = 0; (DB.goals || []).forEach(function(x){ g += x.saved || 0; });
  return {banks:b, invested:inv, assets:b, debts:d, goals:g,
          lent:dt.lent, owed:dt.owed,
          net:b - d + dt.lent - dt.owed};
}
function investedTotal(){
  var s2 = 0;
  (DB.tx || []).forEach(function(t){ if(t.type === 'out' && t.cat === 'Инвестиция') s2 += t.amt; });
  return s2;
}
function accsOf(kind){ return DB.accounts.filter(function(a){ return a.kind===kind; }); }
function spendable(){ return accsOf('asset'); }

/* ================= NAV ================= */
var view = 'home';
function sheetOpen(){ return !!document.querySelector('.sheet.on'); }

function go(v, silent){
  var same = (v === view);
  view = v;
  var pages = document.querySelectorAll('.page');
  for(var i=0;i<pages.length;i++) pages[i].classList.remove('on');
  var el = document.getElementById('p-'+v);
  if(el) el.classList.add('on');
  var btns = document.querySelectorAll('.tabbar button');
  for(var j=0;j<btns.length;j++) btns[j].classList.toggle('on', btns[j].dataset.tab===v);
  window.scrollTo(0,0);
  render();
  if(v === 'calc-split') openSplit();

  saveView();
  /* Android-тың «артқа» түймесі қосымшадан шығармай, алдыңғы бетке қайтсын */
  if(!silent && history && history.pushState){
    var st = history.state || {};
    if(same && !st.sheet) history.replaceState({ v: v }, '', '#' + v);
    else history.pushState({ v: v }, '', '#' + v);
  }
}

/* ================= SHEETS ================= */
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
  for(var i=0;i<s.length;i++) s[i].classList.remove('on');
  document.body.classList.remove('locked');
  if(!fromPop && had && history && history.state && history.state.sheet){
    history.back();
  }
}

/* ---- transaction ---- */
var fType='out', fCat='Тамақ', fAcc=null, fLoan=null, fTo=null, fEdit=null;
function setType(t){
  fType=t;
  var moves = (t==='tr');
  document.getElementById('seg-out').classList.toggle('on', t==='out');
  document.getElementById('seg-in').classList.toggle('on', t==='in');
  document.getElementById('seg-tr').classList.toggle('on', t==='tr');
  document.getElementById('f-cat-box').classList.toggle('hide', moves);
  document.getElementById('f-to-box').classList.toggle('hide', !moves);
  document.getElementById('f-acc-lab').textContent =
    t==='tr' ? 'Қай шоттан' : (t==='in'?'Қай шотқа түсті':'Қай шоттан');
  if(!moves){
    var pc = DB.pref && DB.pref['cat_' + t];
    fCat = (pc && CATS[t].some(function(c){ return c[0] === pc; })) ? pc : CATS[t][0][0];
    drawCats();
  }
  if(!fEdit){ var tt=document.getElementById('tx-title'); if(tt) tt.textContent = tr(t==='in'?'Кіріс қосу':(t==='tr'?'Аударым':'Шығын қосу')); }
  drawAccs();
}
function drawCats(){
  var box=document.getElementById('f-cats'); box.innerHTML='';
  CATS[fType].forEach(function(c){
    var b=document.createElement('button');
    var on=(c[0]===fCat);
    b.type='button';
    b.className='ctile'+(on?' on':'');
    b.setAttribute('aria-pressed', on?'true':'false');
    b.style.setProperty('--cc', catColor(fType,c[0]));
    b.innerHTML='<span class="ct-i">'+catSvg(fType,c[0])+'</span><span class="ct-l">'+tr(c[0])+'</span>';
    b.onclick=function(){ fCat=c[0]; drawCats(); drawAccs(); };
    box.appendChild(b);
  });
}
function drawAccs(){
  var box=document.getElementById('f-accs'); box.innerHTML='';
  var src = accsOf('asset');
  if(!src.length){ box.innerHTML='<div class="muted">Алдымен шот қосыңыз</div>'; }
  var ok=false; src.forEach(function(a){ if(a.id===fAcc) ok=true; });
  if(!ok) fAcc = src.length? src[0].id : null;
  src.forEach(function(a){
    var b=document.createElement('button');
    b.className='chip'+(a.id===fAcc?' on':'');
    var br=brandOf(a.name);
    b.innerHTML=(br?brandSm(br)
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
  fAcc = t ? t.acc : (fAcc || (DB.pref && DB.pref.acc && acc(DB.pref.acc) ? DB.pref.acc : null));
  fTo  = t ? t.to : null;
  fLoan= t ? t.loan : null;
  setType(t ? t.type : 'out');
  /* setType әдепкі санатпен сызады да, несиені тастап жібереді — түзетілетін жазбаныкін қайтарамыз */
  if(t && t.type!=='tr'){ fCat = t.cat; fLoan = t.loan || null; drawCats(); drawAccs(); }
  fillNoteList();
  openSheet('sheet-tx');
  /* жаңа операцияда сома өрісі бірден ашылсын */
  if(!t) setTimeout(function(){ var a = document.getElementById('f-amt'); if(a){ try{ a.focus({ preventScroll: true }); }catch(e){ a.focus(); } } }, 320);
}
/* түсініктеме өрісіне бұрынғы жазбалардан ұсыныс */
function fillNoteList(){
  var dl = document.getElementById('note-list'); if(!dl) return;
  var seen = {}, out = [];
  DB.tx.slice().sort(function(a,b){ return a.date < b.date ? 1 : -1; }).forEach(function(t){
    var n = (t.note || '').trim();
    if(!n || n.length > 40 || seen[n.toLowerCase()] || out.length >= 40) return;
    seen[n.toLowerCase()] = 1; out.push(n);
  });
  dl.innerHTML = out.map(function(n){ return '<option value="' + esc(n) + '">'; }).join('');
}
function noteChanged(){
  if(fType === 'tr') return;
  var v = document.getElementById('f-note').value;
  var c = ruleCat(fType, v);
  if(!c){
    var last = null;
    DB.tx.forEach(function(t){ if(t.type === fType && t.note && t.note.trim().toLowerCase() === v.trim().toLowerCase()) last = t; });
    if(last) c = last.cat;
  }
  if(c && c !== fCat && CATS[fType].some(function(x){ return x[0] === c; })){ fCat = c; drawCats(); drawAccs(); }
}
function saveTx(){
  var amt=parseFloat(document.getElementById('f-amt').value);
  if(!amt || amt<=0){ toast('Соманы жазыңыз'); return; }
  if(!fAcc){ toast('Алдымен шот қосыңыз'); return; }
  var isMove = (fType==='tr');
  if(isMove && !fTo){ toast('Қай шотқа екенін таңдаңыз'); return; }
  var t={ id:newId(), type:fType,
    cat:(fType==='tr' ? 'Аударым' : fCat),
    amt:Math.abs(amt),
    date:document.getElementById('f-date').value||todayISO(),
    note:document.getElementById('f-note').value.trim(), acc:fAcc, loan:fLoan,
    to:(isMove?fTo:null) };

  if(fEdit){
    var old=null; DB.tx.forEach(function(x){ if(x.id===fEdit) old=x; });
    if(old){
      applyTx(old, -1);
      t.id = old.id;
      DB.tx = DB.tx.map(function(x){ return x.id===old.id ? t : x; });
      applyTx(t, 1);
      fEdit=null;
      var more = 0;
      if(t.type !== 'tr' && old.cat !== t.cat && t.note){
        learnCat(t.type, t.note, t.cat);
        var k = merchKey(t.note);
        if(k) DB.tx.forEach(function(x){
          if(x.id !== t.id && x.type === t.type && x.cat === 'Басқа' && merchKey(x.note) === k){ x.cat = t.cat; more++; }
        });
      }
      save(); closeSheets(); render();
      toast(more ? 'Өзгертілді · тағы ' + more + ' операция «' + tr(t.cat) + '» санатына' : 'Өзгертілді');
      return;
    }
    fEdit=null;
  }
  DB.tx.push(t);
  applyTx(t, 1);
  if(!DB.pref) DB.pref = {};
  DB.pref.acc = fAcc;
  if(fType !== 'tr'){ DB.pref['cat_' + fType] = fCat; if(t.note) learnCat(fType, t.note, fCat); }
  save(); closeSheets(); render(); buzz();
  toast(fType==='in'?'Кіріс қосылды':(fType==='tr'?'Аударым жасалды':'Шығын қосылды'));
}
function applyTx(t, sign){
  var a=acc(t.acc);
  if(t.type==='tr'){
    var to=acc(t.to);
    if(a) a.bal -= sign * toAcc(a, t.amt);
    if(to) to.bal += sign * toAcc(to, t.amt);
    return;
  }
  if(a) a.bal += sign * toAcc(a, (t.type==='in' ? t.amt : -t.amt));
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
  var t=null; DB.tx.forEach(function(x){ if(x.id===viewId) t=x; });
  closeSheets();
  if(t) deleteTxWithUndo(t);
}

/* ---- accounts ---- */
var accKind='asset', accIcon='💵', accEdit=null;
var KIND_TITLE={asset:'Банк шоты',debt:'Несие'};
function openAcc(kind, editId){
  accEdit = editId||null;
  accKind = kind;
  accIcon = kind==='asset'?'card':'bank';
  var a = accEdit ? acc(accEdit) : null;
  if(a){ accIcon=a.icon; }
  document.getElementById('acc-title').textContent = (a?'Түзету: ':'')+KIND_TITLE[kind]+(a?'':' қосу');
  document.getElementById('ac-bal-lab').textContent =
    kind==='asset'?'Қалдық, ₸':'Несие қалдығы, ₸';
  document.getElementById('ac-name').value = a?a.name:'';
  document.getElementById('ac-bal').value = a?a.bal:'';
  document.getElementById('ac-rate').value = a&&a.rate?a.rate:'';
  document.getElementById('ac-pay').value = a&&a.pay?a.pay:'';
  var apd=document.getElementById('ac-payday'); if(apd) apd.value = a&&a.payDay?a.payDay:'';
  document.getElementById('ac-loan-box').classList.toggle('hide', kind!=='debt');
  document.getElementById('ac-bal-box').classList.remove('hide');
  document.getElementById('ac-bank-box').classList.toggle('hide', kind!=='asset');
  document.getElementById('ac-back').textContent = accEdit ? '‹ Артқа' : '‹ Жабу';
  accCur = a && a.cur ? a.cur : 'KZT';
  if(kind==='asset') document.getElementById('ac-bal-lab').textContent = 'Қалдық, ' + (accCur==='USD'?'$':'₸');
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
      document.getElementById('ac-bal-lab').textContent = 'Қалдық, ' + (c[0]==='USD'?'$':'₸');
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
      ? brandSm(br)
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
  if(accKind==='debt'){
    a.rate=parseFloat(document.getElementById('ac-rate').value)||0;
    a.pay=parseFloat(document.getElementById('ac-pay').value)||0;
    a.payDay=Math.min(31,Math.max(0,parseInt((document.getElementById('ac-payday')||{}).value)||0))||null;
  }
  if(accKind==='asset') a.cur=accCur;
  if(accEdit){
    var old=acc(accEdit);
    if(old){
      old.name=a.name; old.icon=a.icon;
      old.bal=a.bal; old.cur=a.cur;
      if(accKind==='debt'){ old.rate=a.rate; old.pay=a.pay; old.payDay=a.payDay; }
    }
    accEdit=null;
    save(); closeSheets(); render(); toast('Сақталды'); return;
  }
  DB.accounts.push(a); save(); closeSheets(); render();
  toast(KIND_TITLE[accKind]+' қосылды');
}
function openAccView(id){
  var a=acc(id); if(!a) return;
  viewId=id;
  document.getElementById('v-title').textContent=a.name;
  var sym=accCurSym(a);
  var h='<div class="kv"><span>'+(a.kind==='asset'?'Қалдық':'Несие қалдығы')+'</span><b>'+
    money(a.bal,sym)+'</b></div>';
  if(a.cur==='USD') h+='<div class="kv"><span>Теңгемен</span><b>'+money(toKZT(a))+'</b></div>'+
    '<div class="kv"><span>Қолданылған курс</span><b>'+(rateV()?rateV().toFixed(2).replace('.',','):'—')+'</b></div>';
  if(a.kind==='debt'){
    h+='<div class="kv"><span>Мөлшерлеме</span><b>'+(a.rate||0)+'%</b></div>'+
       '<div class="kv"><span>Ай сайынғы төлем</span><b>'+money(a.pay||0)+'</b></div>';
    if(a.pay>0 && a.bal>0){
      var m=monthsLeft(a.bal,a.rate||0,a.pay);
      h+='<div class="kv"><span>Қалған мерзім</span><b>'+(m>0?m+' ай':'есептелмеді')+'</b></div>';
    }
    h+=loanPlanHtml(a);
  }
  var cnt=DB.tx.filter(function(t){return t.acc===id||t.loan===id;}).length;
  h+='<div class="kv"><span>Операция</span><b>'+cnt+'</b></div>';
  document.getElementById('v-body').innerHTML=h;
  var extraBtns='<button class="btn line" onclick="openAcc(\''+a.kind+'\',\''+a.id+'\')">Түзету</button>';
  document.getElementById('v-body').innerHTML=h;
  var slot=document.getElementById('v-extra');
  if(slot) slot.innerHTML=extraBtns;
  document.getElementById('v-del').textContent = 'Өшіру';
  document.getElementById('v-del').onclick=delAcc;
  openSheet('sheet-view');
}
function delAcc(){
  var a0=acc(viewId); if(!a0) return;
  if(!confirm(tr('Шот өшіріледі. Операциялары сақталады, бірақ шотсыз қалады. Жалғастырасыз ба?'))) return;
  DB.accounts=DB.accounts.filter(function(a){return a.id!==viewId;});
  DB.tx.forEach(function(t){ if(t.acc===viewId) t.acc=null; if(t.to===viewId) t.to=null; if(t.loan===viewId) t.loan=null; });
  save(); closeSheets(); render(); toast('Өшірілді');
}
function monthsLeft(bal, rate, pay){
  var i=rate/12/100, b=bal, n=0;
  while(b>0 && n<600){ b = b*(1+i) - pay; n++; if(pay <= bal*i) return -1; }
  return n;
}

/* ---- брокерлік операциялар ---- */
var BOP = [['dep','Салым'],['wd','Шығару'],['div','Дивиденд'],['fee','Комиссия · салық']];
function openGoal(){
  document.getElementById('g-name').value='';
  document.getElementById('g-target').value='';
  document.getElementById('g-saved').value='';
  document.getElementById('g-due').value='';
  openSheet('sheet-goal');
}
function saveGoal(){
  var n=document.getElementById('g-name').value.trim();
  var t=parseFloat(document.getElementById('g-target').value);
  if(!n){ toast('Атауын жазыңыз'); return; }
  if(!t||t<=0){ toast('Мақсат сомасын жазыңыз'); return; }
  DB.goals.push({id:newId(),name:n,target:t,
    saved:parseFloat(document.getElementById('g-saved').value)||0,
    due:document.getElementById('g-due').value||null});
  save(); closeSheets(); render(); toast('Мақсат қосылды');
}
var gvAcc=null;
/* мақсатқа жету қарқыны: қалған ай саны мен айына қажет сома */
function goalPace(g){
  var left = Math.max(0, (g.target||0) - (g.saved||0));
  if(!g.due) return { left: left, months: 0, need: 0, days: 0, late: false };
  /* new Date('YYYY-MM-DD') UTC бойынша оқиды — жергілікті күнмен салыстырамыз */
  var now = parseISO(todayISO()), d = parseISO(g.due);
  var days = Math.round((d - now) / 864e5);
  var months = Math.max(0, days / 30.44);
  return { left: left, months: months, days: days, late: days < 0 && left > 0,
           need: (months > 0.1 && left > 0) ? left / months : left };
}
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
    '<div class="kv"><span>Қалды</span><b>'+money(Math.max(0,g.target-g.saved))+'</b></div>'+
    (function(){
      var p=goalPace(g);
      if(!g.due || p.left<=0) return '';
      return '<div class="kv"><span>Мерзімі</span><b>'+fullDate(g.due)+'</b></div>'+
             '<div class="kv"><span>Айына салу керек</span><b style="color:'+
             (p.late?'var(--neg)':'var(--accent)')+'">'+
             (p.late ? 'мерзімі өтті' : money(Math.round(p.need)))+'</b></div>';
    })();
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
  if(gvAcc){
    var a=acc(gvAcc);
    if(a) a.bal -= toAcc(a, v);
  }
  g.saved += v;
  g.hist = g.hist || [];
  g.hist.push({ date: todayISO(), acc: gvAcc || null, amt: v });
  save(); closeSheets(); render();
  toast(gvAcc ? (acc(gvAcc).name+' шотынан алынды') : 'Салым қосылды');
}
function delGoal(){
  if(!confirm(tr('Мақсат өшіріледі. Жалғастырасыз ба?'))) return;
  DB.goals=DB.goals.filter(function(g){return g.id!==goalId;});
  save(); closeSheets(); render(); toast('Өшірілді');
}

/* ---- settings ---- */
function exportData(){
  var blob=new Blob([JSON.stringify(DB,null,2)],{type:'application/json'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='qarzhy-'+todayISO()+'.json'; a.click();
  DB.lastBackup=new Date().toISOString(); save(); render();
}
function importData(el){
  var f=el.files[0]; if(!f) return;
  var r=new FileReader();
  r.onload=function(){
    var d=null;
    try{ d=JSON.parse(r.result); }catch(e){}
    /* бөтен JSON файл бар деректі өшіріп жібермесін */
    if(!d || typeof d!=='object' || !Array.isArray(d.tx) || !Array.isArray(d.accounts)){
      toast('Бұл Қаржы көшірмесі емес'); return;
    }
    if(!confirm(tr('Қазіргі дерек файлдағымен толық ауыстырылады. Жалғастырасыз ба?'))) return;
    var langChanged = (d.lang||'kk') !== LANG;
    applyDB(d);
    migrateBrokers();
    save();
    flushSave().then(function(){
      if(langChanged){ location.reload(); return; }
      applyTheme(); render(); toast('Қалпына келтірілді');
    });
  };
  r.readAsText(f); el.value='';
}
function wipe(){
  if(!confirm(tr('Барлық дерек өшіріледі. Жалғастырасыз ба?'))) return;
  DB={tx:[],goals:[],accounts:[{id:'a1',name:'Қолма-қол',kind:'asset',icon:'wallet',bal:0,cur:'KZT'}],
      btx:[],debts:[],limits:{},split:null,recur:[],lastBackup:DB.lastBackup,lang:DB.lang,theme:DB.theme,skin:DB.skin,rate:DB.rate};
  SPLIT=null;
  SNAPS.forEach(function(x){ idbDel('snap:'+x.day); });
  SNAPS=[]; idbSet('snaps',[]).catch(function(){});
  save(); render(); toast('Өшірілді');
}

/* ================= FILTERS ================= */
var opsFilter='all', opsAcc='all', period='month';
var range={from:null,to:null};
function setOpsFilter(f){
  opsFilter=f;
  document.querySelectorAll('[data-of]').forEach(function(b){ b.classList.toggle('on', b.dataset.of===f); });
  render();
}
function setPeriod(p){
  period = p;
  statMon = (p === 'prev') ? -1 : 0;
  applyStatMon();
  render();
}
function customRange(){ render(); }
function inRange(d){ return (!range.from || d>=range.from) && (!range.to || d<=range.to); }

/* ---- басты бет: баланс графигі ---- */
function drawSpark(net){
  var svg=document.getElementById('h-spark'), pill=document.getElementById('h-pill');
  if(!svg) return;
  var now=new Date(), flows={};
  DB.tx.forEach(function(t){ if(t.type==='tr') return; var k=t.date.slice(0,7); flows[k]=(flows[k]||0)+(t.type==='in'?t.amt:-t.amt); });
  var pts=[net], bal=net;
  for(var i=0;i<6;i++){
    var d=new Date(now.getFullYear(), now.getMonth()-i, 1);
    var k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    bal-= (flows[k]||0); pts.unshift(bal);
  }
  var prev=pts[pts.length-2];
  if(pill){
    var ch=net-prev;
    if(!prev && !ch){ pill.textContent='—'; pill.className='bl-delta'; }
    else {
      var pc = prev>0 ? ch/prev*100 : null;
      pill.textContent=(ch>=0?'↑ +':'↓ −')+((pc===null||Math.abs(pc)>=300)
        ? moneyShort(Math.abs(ch)) : Math.abs(pc).toFixed(1).replace('.',',')+'%');
      pill.className='bl-delta '+(ch>=0?'up':'down');
    }
  }
  var mn=Math.min.apply(null,pts), mx=Math.max.apply(null,pts), W=300, H=70, pad=6;
  var rng=(mx-mn)||1;
  var xy=pts.map(function(v,i){ return [i*W/(pts.length-1), pad+(H-pad*2)*(1-(v-mn)/rng)]; });
  var dpath='M'+xy[0][0]+' '+xy[0][1];
  for(var j=1;j<xy.length;j++){
    var x0=xy[j-1][0], y0=xy[j-1][1], x1=xy[j][0], y1=xy[j][1], cx=(x0+x1)/2;
    dpath+=' C'+cx+' '+y0+' '+cx+' '+y1+' '+x1+' '+y1;
  }
  var last=xy[xy.length-1];
  svg.innerHTML='<defs><linearGradient id="spg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>'+
    '<path d="'+dpath+' L'+W+' '+H+' L0 '+H+' Z" fill="url(#spg)"/>'+
    '<path d="'+dpath+'" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'+
    '<circle cx="'+last[0]+'" cy="'+last[1]+'" r="3.6" fill="#fff"/>';
}
/* басты бет: шот карталары (сырғытып ауыстырылады) */
function shade(hex, k){
  var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  var f = function(c){ return Math.max(0, Math.min(255, Math.round(c * k))); };
  return '#' + [f(r), f(g), f(b)].map(function(c){ return c.toString(16).padStart(2, '0'); }).join('');
}
function drawAccCards(){
  var box = document.getElementById('h-cards'); if(!box) return;
  [].slice.call(box.querySelectorAll('.bcard')).forEach(function(e){ e.remove(); });
  accsOf('asset').forEach(function(a){
    var br = brandOf(a.name);
    var c = br ? br[1] : '#2A3350';
    var d = document.createElement('div');
    d.className = 'bcard hc';
    d.style.setProperty('--c1', shade(c, 1.08));
    d.style.setProperty('--c2', shade(c, 0.62));
    d.innerHTML = '<div class="bc-top">' + (br ? accBadge(a, true) : '<div class="ico">' + accIconHtml(a) + '</div>') +
      '<span>' + esc(a.name) + '</span></div><div class="bc-chip"></div>' +
      '<div class="bc-k">' + tr('Қалдық') + '</div><div class="bc-v">' + money(a.bal, accCurSym(a)) + '</div>';
    d.onclick = function(){ openAccView(a.id); };
    box.appendChild(d);
  });
  var dots = document.getElementById('h-dots'), n = box.querySelectorAll('.hc').length;
  if(dots){
    dots.innerHTML = n > 1 ? new Array(n + 1).join('<i></i>') : '';
    var upd = function(){
      var i = Math.round(box.scrollLeft / Math.max(1, box.clientWidth));
      [].forEach.call(dots.children, function(e, j){ e.classList.toggle('on', j === i); });
    };
    if(!box._b){ box._b = 1; box.addEventListener('scroll', function(){ upd(); }, { passive: true }); }
    upd();
  }
}
function buzz(){ try{ if(navigator.vibrate) navigator.vibrate(12); }catch(e){} }
function openTxType(t){ openTx(); setType(t); }

/* ================= RENDER ================= */
function render(){
  var T=totals();
  var mTx=DB.tx.filter(function(t){return inMonth(t.date) && t.type!=='tr';});
  var mIn=0,mOut=0; mTx.forEach(function(t){ if(t.type==='in') mIn+=t.amt; else mOut+=t.amt; });

  /* --- home --- */
  animNum(document.getElementById('h-net'), T.net);
  drawSpark(T.net);
  drawAccCards();
  var bell=document.getElementById('h-bell');
  if(bell){ var rw=0; try{ (DB.recur||[]).forEach(function(r){ var st=recurState(r); if(!st.paid && (st.late||st.soon)) rw++; }); }catch(e){} bell.classList.toggle('hide', !rw); }
  document.getElementById('h-month').textContent=MONTHS[cur.getMonth()]+' '+cur.getFullYear();
  document.getElementById('h-in').textContent=money(mIn);
  document.getElementById('h-out').textContent=money(mOut);
  var hbk=document.getElementById('h-banks'); if(hbk) hbk.textContent=money(T.banks);
  var gsum=0; (DB.goals||[]).forEach(function(g){ gsum+=g.saved||0; });
  var hi=document.getElementById('h-goals');
  if(hi) hi.textContent=money(gsum);
  var hdb=document.getElementById('h-debts'); if(hdb) hdb.textContent=money(T.debts);
  var hpd=document.getElementById('h-pdebt');
  if(hpd){
    if(T.lent && T.owed){
      hpd.innerHTML='<span style="color:var(--pos)">+'+nf(T.lent)+'</span>'+
                    ' <span style="opacity:.5">/</span> '+
                    '<span style="color:var(--neg)">−'+nf(T.owed)+'</span>';
    } else if(T.lent){ hpd.textContent='+'+money(T.lent); hpd.style.color='var(--pos)'; }
    else if(T.owed){ hpd.textContent='−'+money(T.owed); hpd.style.color='var(--neg)'; }
    else { hpd.textContent='0 ₸'; hpd.style.color=''; }
  }
  var openDebts = (DB.debts||[]).filter(function(d){ return debtLeft(d) > 0; }).length;
  var acn=document.getElementById('acc-count'); if(acn) acn.textContent=
    accsOf('asset').length+' банк'+
    (openDebts ? ' · '+openDebts+' қарыз' : '');
  document.getElementById('h-rate').textContent=rateText();
  document.getElementById('h-rate-at').textContent = rateV()? (rateAgo()+' · ↻') : '↻';
  var sri=document.getElementById('set-rate-info');
  if(sri) sri.textContent = rateV()
    ? rateText()+' · '+rateAgo()+(DB.rate.src==='manual'?' (қолмен)':'')
    : 'Курс әлі алынбаған. Интернет болса жаңартыңыз немесе қолмен жазыңыз.';

  var recent=DB.tx.slice().sort(function(a,b){return a.date<b.date?1:-1;}).slice(0,5);
  var hb=document.getElementById('home-tx'); hb.innerHTML='';
  if(!recent.length) hb.innerHTML='<div class="empty">Операция жоқ.<br>Жоғарыдағы <b>+</b> түймесімен қосыңыз.</div>';
  else recent.forEach(function(t){ hb.appendChild(txRow(t)); });

  /* --- accounts --- */
  document.getElementById('a-count').textContent=DB.accounts.length+' шот';
  var ac2=document.getElementById('a-count2'); if(ac2) ac2.textContent=DB.accounts.length+' шот';
  animNum(document.getElementById('a-net'), T.net);
  document.getElementById('a-banks').textContent=moneyShort(T.banks);
  var ai=document.getElementById('a-goals');
  if(ai) ai.textContent=moneyShort(gsum);
  document.getElementById('a-debts').textContent=moneyShort(T.debts);
  renderAccList('asset','a-list-asset','Банк шоты жоқ. Төмендегі түймемен қосыңыз.');
  renderAccList('debt','a-list-debt','Несие жоқ — тамаша.');

  /* --- ops --- */
  var q=(document.getElementById('ops-q').value||'').trim().toLowerCase();
  /* «15 000» деп жазса да сома табылсын */
  var qDigits=q.replace(/[\s ]/g,'');
  if(!/^\d+$/.test(qDigits)) qDigits='';
  var ops=DB.tx.filter(function(t){
    if(opsFilter!=='all' && t.type!==opsFilter) return false;
    if(opsAcc!=='all' && t.acc!==opsAcc && t.to!==opsAcc) return false;
    if(q){
      var a1=acc(t.acc), a2=acc(t.to);
      var hay=((t.cat||'')+' '+tr(t.cat||'')+' '+(t.note||'')+' '+Math.round(t.amt)+' '+
               (a1?a1.name:'')+' '+(a2?a2.name:'')).toLowerCase();
      if(hay.indexOf(q)===-1 && !(qDigits && String(Math.round(t.amt)).indexOf(qDigits)!==-1)) return false;
    }
    return true;
  }).sort(function(a,b){return a.date<b.date?1:-1;});

  var oIn=0,oOut=0;
  ops.forEach(function(t){ if(t.type==='in') oIn+=t.amt; else if(t.type==='out') oOut+=t.amt; });
  document.getElementById('o-count').textContent =
    (q||opsAcc!=='all'||opsFilter!=='all')
      ? ops.length+' табылды · +'+nf(oIn)+' / −'+nf(oOut)+' ₸'
      : DB.tx.length+' операция';

  var oab=document.getElementById('ops-accs'); oab.innerHTML='';
  var oaList=[{id:'all',name:'Барлық шот',icon:'◎'}].concat(DB.accounts);
  oaList.forEach(function(a){
    var b=document.createElement('button');
    b.className='chip'+(opsAcc===a.id?' on':'');
    var obr = a.id==='all' ? null : brandOf(a.name);
    b.innerHTML=(a.id==='all'
      ? svgIcon('grid','chip-ic')
      : (obr ? brandSm(obr)
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
      hd.innerHTML='<span>'+dayTitle(d)+'</span><span>'+(sum>0?'+':'')+money(sum)+'</span>';
      ol.appendChild(hd);
      byDay[d].forEach(function(t){ ol.appendChild(txRow(t)); });
    });
  }

  /* --- overview --- */

  var rate = mIn>0 ? Math.round((mIn-mOut)/mIn*100) : 0;
  /* соңғы 12 айдағы орташа шығын — «қауіпсіздік жастығы» үшін */
  var now12=new Date(), out12=0, mset={};
  for(var mi=0;mi<12;mi++){ var dq=new Date(now12.getFullYear(), now12.getMonth()-mi, 1);
    mset[dq.getFullYear()+'-'+String(dq.getMonth()+1).padStart(2,'0')]=1; }
  DB.tx.forEach(function(t){ if(t.type==='out' && mset[t.date.slice(0,7)]) out12+=t.amt; });
  var avgOut12 = out12/12;
  var cushion = avgOut12>0 ? (T.banks/avgOut12) : 0;
  drawFuture(T, rate, avgOut12, cushion);

  var debts=DB.accounts.filter(function(a){return a.kind==='debt';});
  var db=document.getElementById('ov-debts'); db.innerHTML='';
  var dcard=document.getElementById('ov-debt-card');
  if(dcard) dcard.classList.toggle('hide', !debts.length);
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

  /* --- жаңа бөлімдер --- */
  drawDebts();
  drawRecur();
  drawCashback();
  drawDaily();
  drawReport();
  drawSubs();
  drawTips();
  drawCalendar();
  drawWhatIf();
  drawYear();
  calcDep();
  calcTax();
  drawWarnings();
  drawSnaps();
  drawStorage();
  drawSelBar();
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

  /* --- stats --- */
  renderStats();
  fillIcons();
  drawLangChips();
  drawThemeChips();
  drawSkinChips();
  translateDom(document.body);

  /* --- goals --- */
  var gt=0; DB.goals.forEach(function(g){ gt+=g.saved; });
  animNum(document.getElementById('g-total'), gt);
  document.getElementById('g-count').textContent=DB.goals.length+' мақсат';
  var gl=document.getElementById('goal-list'); gl.innerHTML='';
  if(!DB.goals.length) gl.innerHTML='<div class="card"><div class="empty">Мақсат әлі жоқ.<br>Жинайтын сомаңызды белгілеп қойыңыз.</div></div>';
  else DB.goals.forEach(function(g){
    var pct=Math.min(100,Math.round(g.saved/g.target*100));
    var el=document.createElement('div'); el.className='card';
    el.onclick=function(){ openGview(g.id); };
    var C=2*Math.PI*26, off=C*(1-pct/100);
    el.className='card goal';
    el.innerHTML='<div class="g-top"><div class="g-l">'+
      '<div class="ico blue">'+svgIcon('flag')+'</div>'+
      '<div class="g-name">'+esc(g.name)+'</div>'+
      '<div class="g-amt">'+money(g.saved)+' / '+money(g.target)+'</div></div>'+
      '<div class="ring" role="img" aria-label="'+pct+'%"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" class="rt"/>'+
      '<circle cx="32" cy="32" r="26" class="rf" stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 32 32)"/></svg><b>'+pct+'%</b></div></div>'+
      '<div class="track"><div class="fill" style="width:'+pct+'%"></div></div>'+
      (function(){
        var p=goalPace(g), h='';
        if(g.due && p.left>0){
          h += '<div class="gpace'+(p.late?' late':'')+'">'+
               (p.late ? 'Мерзімі өтті · ' + fullDate(g.due)
                       : 'Айына ' + money(Math.round(p.need)) + ' салсаң, ' + fullDate(g.due) + '-ге жетесің')+
               '</div>';
        } else if(p.left<=0){
          h += '<div class="gpace done">Мақсат орындалды 🎉</div>';
        }
        if(g.hist && g.hist.length){
          var last=g.hist[g.hist.length-1], la=last.acc?acc(last.acc):null;
          h += '<div class="muted" style="margin-top:6px">Соңғы салым: '+fullDate(last.date)+
               ' · '+(la?esc(la.name)+' шотынан':'шотсыз')+'</div>';
        }
        return h;
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
    row.innerHTML=catBox('tr','Аударым').replace(catSvg('tr','Аударым'), svgIcon('swap'))+
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
    row.onclick = function(){ openAccView(a.id); };
    var sym=accCurSym(a);
    var sub='Банк шоты';
    if(kind==='debt') sub=(a.rate||0)+'% · айына '+nf(a.pay||0)+' ₸';
    var plHtml='';
    if(a.cur==='USD') sub += ' · ≈ '+nf(toKZT(a))+' ₸';
    row.innerHTML=((kind==='asset' || brandOf(a.name)) ? accBadge(a) :
      '<div class="ico'+(kind==='debt'?' red':' blue')+'">'+accIconHtml(a)+'</div>')+
      '<div style="min-width:0;flex:1"><div class="name">'+esc(a.name)+(a.cur==='USD'?' <span class="badge">$</span>':'')+
      '</div><div class="sub2">'+sub+'</div></div>'+
      '<div class="amt'+(plHtml?' col':'')+'" style="color:'+(kind==='debt'?'var(--neg)':'var(--ink)')+'">'+
        '<span>'+money(a.bal,sym)+'</span>'+plHtml+'</div>';
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

/* ================= НӘТИЖЕ (CoinKeeper үлгісінде) ================= */
var statMon = 0;            /* 0 — осы ай, теріс сан — өткен айлар */
var statKind = 'out';       /* out | in | inv */
var statMode = 'bubbles';   /* bubbles | donut | flow | budget */

function statMonStart(){ var n = new Date(); return new Date(n.getFullYear(), n.getMonth() + statMon, 1); }
var statPer = 'month';      /* week | month | year | all */
function applyStatMon(){
  var f = statMonStart(), t = new Date(f.getFullYear(), f.getMonth() + 1, 0), lbl = '';
  if(statPer === 'week'){
    var n = new Date(); t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    f = new Date(t); f.setDate(t.getDate() - 6);
    lbl = f.getDate() + ' ' + MONTHS[f.getMonth()].slice(0,3) + ' – ' + t.getDate() + ' ' + MONTHS[t.getMonth()].slice(0,3);
  } else if(statPer === 'year'){
    f = new Date(f.getFullYear(), 0, 1); t = new Date(f.getFullYear(), 11, 31);
    lbl = String(f.getFullYear());
  } else if(statPer === 'all'){
    lbl = tr('Барлығы');
  } else {
    lbl = MONTHS[f.getMonth()] + ' ' + f.getFullYear();
  }
  range.from = statPer === 'all' ? null : iso(f);
  range.to   = statPer === 'all' ? null : iso(t);
  var el = document.getElementById('s-month');
  if(el) el.textContent = lbl;
  var nx = document.getElementById('s-mon-next');
  var step = statPer === 'year' ? 12 : 1;
  if(nx) nx.classList.toggle('off', statPer === 'year' ? statMonStart().getFullYear() >= new Date().getFullYear() : statMon >= 0);
  var nav = document.getElementById('s-mnav');
  if(nav) nav.classList.toggle('fixed', statPer === 'week' || statPer === 'all');
  var bs = document.querySelectorAll('#s-per button');
  for(var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].dataset.p === statPer);
}
function setStatPer(p){ statPer = p; if(p !== 'year') statMon = Math.min(statMon, 0); applyStatMon(); render(); }
function shiftStatMon(d){
  if(statPer === 'week' || statPer === 'all') return;
  if(statPer === 'year'){
    var y = statMonStart().getFullYear() + d;
    if(y > new Date().getFullYear()) return;
    statMon += d * 12; applyStatMon(); render(); return;
  }
  if(statMon + d > 0) return;
  statMon += d; applyStatMon(); render();
}
function setStatKind(k){
  statKind = k;
  var bs = document.querySelectorAll('#s-kind button');
  for(var i = 0; i < bs.length; i++){
    var on = bs[i].dataset.k === k;
    bs[i].classList.toggle('on', on);
    bs[i].classList.toggle('danger', on && k === 'out');
  }
  renderStats();
}
function setStatMode(m){ statMode = m; renderStats(); }

/* кезеңдегі жазбалар мен олардың бөлінісі */
function statList(){
  return DB.tx.filter(function(t){ return inRange(t.date) && t.type === statKind; });
}
function statItems(list){ return catItems(list, statKind); }

function drawFuture(T, rate, avgOut12, cushion){
  var box = document.getElementById('ov-future'); if(!box) return;
  var now = new Date(), ym = todayISO().slice(0, 7);
  var dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), day = now.getDate();
  var spent = 0, prevOut = 0, pym = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
  var nets = {};
  DB.tx.forEach(function(t){
    if(t.type === 'tr') return;
    var m = t.date.slice(0, 7);
    if(t.type === 'out' && m === ym) spent += t.amt;
    if(t.type === 'out' && m === pym) prevOut += t.amt;
    nets[m] = (nets[m] || 0) + (t.type === 'in' ? t.amt : -t.amt);
  });
  var proj = day > 0 ? spent / day * dim : 0;
  var n3 = 0, c3 = 0;
  for(var i = 1; i <= 3; i++){ var k = iso(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7); if(nets[k] !== undefined){ n3 += nets[k]; c3++; } }
  var avgNet = c3 ? n3 / c3 : 0;
  var h = '';
  h += '<div class="kv"><span>' + tr('Ай соңына дейін шығын болжамы') + '</span><b>~' + money(Math.round(proj / 1000) * 1000) + '</b></div>';
  if(prevOut) h += '<div class="kv"><span>' + tr('Өткен айда') + '</span><b>' + money(prevOut) + '</b></div>';
  h += '<div class="kv"><span>' + tr('Айлық орташа нәтиже (3 ай)') + '</span><b style="color:' + (avgNet >= 0 ? 'var(--pos)' : 'var(--neg)') + '">' + (avgNet >= 0 ? '+' : '−') + money(Math.abs(Math.round(avgNet))) + '</b></div>';
  h += '<div class="kv"><span>' + tr('6 айдан кейін капитал') + '</span><b>~' + money(Math.round((T.net + avgNet * 6) / 1000) * 1000) + '</b></div>';
  h += '<div class="kv"><span>' + tr('12 айдан кейін капитал') + '</span><b>~' + money(Math.round((T.net + avgNet * 12) / 1000) * 1000) + '</b></div>';
  h += '<div class="kv"><span>' + tr('Жинақ үлесі (осы ай)') + '</span><b>' + (isFinite(rate) ? rate + '%' : '—') + '</b></div>';
  h += '<div class="kv"><span>' + tr('Қаражат неше айға жетеді') + '</span><b>' + (avgOut12 > 0 ? (cushion >= 12 ? '12+ ' + tr('ай') : (Math.round(cushion * 10) / 10).toString().replace('.', ',') + ' ' + tr('ай')) : '—') + '</b></div>';
  (DB.goals || []).forEach(function(g){
    var left = g.target - (g.saved || 0); if(left <= 0) return;
    var m = avgNet > 0 ? Math.ceil(left / avgNet) : null;
    h += '<div class="kv"><span>' + esc(g.name) + '</span><b>' + (m ? '~' + m + ' ' + tr('айда жетеді') : tr('қазіргі қарқынмен жетпейді')) + '</b></div>';
  });
  h += '<p class="muted" style="margin:10px 0 0">' + tr('Болжам соңғы 3 айдың кіріс-шығынына негізделген.') + '</p>';
  box.innerHTML = h;
}
var STAT_MODES = [
  { id: 'bubbles', name: 'Көпіршік' },
  { id: 'flow',    name: 'Кіріс/Шығын' },
  { id: 'budget',  name: 'Бюджет' }
];
function modeThumb(id){
  if(id === 'bubbles') return '<svg viewBox="0 0 48 40" width="48" height="40">' +
    '<circle cx="18" cy="21" r="12" fill="var(--g-mid)" opacity=".85"/>' +
    '<circle cx="34" cy="13" r="7" fill="var(--pos)" opacity=".8"/>' +
    '<circle cx="35" cy="29" r="5" fill="var(--red)" opacity=".7"/></svg>';
  if(id === 'donut') return '<svg viewBox="0 0 48 40" width="48" height="40">' +
    '<circle cx="24" cy="20" r="12" fill="none" stroke="var(--g-soft)" stroke-width="7"/>' +
    '<circle cx="24" cy="20" r="12" fill="none" stroke="var(--g-mid)" stroke-width="7"' +
    ' stroke-dasharray="46 76" stroke-linecap="round" transform="rotate(-90 24 20)"/></svg>';
  if(id === 'flow') return '<svg viewBox="0 0 48 40" width="48" height="40" fill="none" stroke-width="3" stroke-linecap="round">' +
    '<path d="M6 26c7 0 9-12 16-12s10 12 20 12" stroke="var(--pos)"/>' +
    '<path d="M6 14c7 0 9 12 16 12s10-12 20-12" stroke="var(--red)"/></svg>';
  return '<svg viewBox="0 0 48 40" width="48" height="40" stroke-linecap="round" stroke-width="4">' +
    '<path d="M10 13h28" stroke="var(--g-bright)"/>' +
    '<path d="M10 21h18" stroke="var(--red)" opacity=".55"/>' +
    '<path d="M10 29h10" stroke="var(--pos)" opacity=".7"/></svg>';
}
function drawModeStrip(){
  var box = document.getElementById('s-modes'); if(!box) return;
  box.innerHTML = '';
  STAT_MODES.forEach(function(m){
    var d = document.createElement('div');
    d.className = 'mcard' + (m.id === statMode ? ' on' : '');
    d.innerHTML = '<div class="mi">' + modeThumb(m.id) + '</div><div class="mt">' + tr(m.name) + '</div>';
    d.onclick = function(){ setStatMode(m.id); };
    box.appendChild(d);
  });
}

/* ----- көпіршіктер ----- */
function drawBubbles(items, total){
  var stage = document.getElementById('s-stage');
  stage.innerHTML = '';
  if(!items.length || !total){ stage.innerHTML = '<div class="empty">Бұл айда дерек жоқ.</div>'; return; }
  var wrap = document.createElement('div');
  wrap.className = 'bubbles';
  stage.appendChild(wrap);
  var W = wrap.clientWidth || 320, H = 266;
  var max = items[0].value;
  var maxR = Math.min(64, W * 0.215), minR = 22;
  var placed = [];
  items.slice(0, 9).forEach(function(it, idx){
    var r = Math.max(minR, maxR * Math.sqrt(it.value / max));
    if(idx === 0){ placed.push({ it: it, r: r, x: W / 2, y: H / 2 }); return; }
    var ok = false;
    for(var a = 1; a < 3000 && !ok; a++){
      var ang = a * 0.45, rad = 8 + a * 0.42;
      var x = W / 2 + Math.cos(ang) * rad, y = H / 2 + Math.sin(ang) * rad * 0.74;
      if(x - r < 3 || x + r > W - 3 || y - r < 3 || y + r > H - 3) continue;
      var hit = false;
      for(var k = 0; k < placed.length; k++){
        var o = placed[k], dx = x - o.x, dy = y - o.y;
        if(Math.sqrt(dx * dx + dy * dy) < r + o.r + 6){ hit = true; break; }
      }
      if(!hit){ placed.push({ it: it, r: r, x: x, y: y }); ok = true; }
    }
    if(!ok) placed.push({ it: it, r: minR, x: W / 2, y: H / 2 });
  });
  placed.forEach(function(b, i){
    var d = document.createElement('div');
    d.className = 'bub' + (b.r < 34 ? ' sm' : '');
    d.style.width = d.style.height = Math.round(b.r * 2) + 'px';
    d.style.left = Math.round(b.x - b.r) + 'px';
    d.style.top = Math.round(b.y - b.r) + 'px';
    d.style.background = 'radial-gradient(circle at 32% 26%, rgba(255,255,255,.32), rgba(255,255,255,0) 62%), ' + b.it.color;
    d.style.animationDelay = (i * 0.07) + 's, ' + (i * 0.31) + 's';
    d.innerHTML = '<div><div class="bv">' + moneyShort(b.it.value) + '</div>' +
                  '<div class="bl">' + esc(tr(b.it.label)) + '</div></div>';
    d.onclick = function(){
      toast(tr(b.it.label) + ' · ' + money(b.it.value) + ' · ' + Math.round(b.it.value / total * 100) + '%');
    };
    wrap.appendChild(d);
  });
  setTimeout(function(){ wrap.classList.add('live'); }, 900);
}

/* ----- ағын: 12 айлық кіріс/шығын ----- */
function drawFlow(){
  var stage = document.getElementById('s-stage');
  var base = statMonStart(), months = [];
  for(var i = 11; i >= 0; i--){
    var d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(),
      key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), in: 0, out: 0 });
  }
  var map = {}; months.forEach(function(x){ map[x.key] = x; });
  DB.tx.forEach(function(t){
    if(t.type === 'tr') return;
    var x = map[t.date.slice(0, 7)];
    if(x) x[t.type] += t.amt;
  });
  var peak = 1;
  months.forEach(function(x){ peak = Math.max(peak, x.in, x.out); });

  var step = 62, pad = 26, W = months.length * step + pad * 2, H = 208, mid = 100, maxH = 72;
  var sIn = '', sOut = '', lbl = '';
  months.forEach(function(x, i){
    var cx = pad + i * step + step / 2;
    var hi = Math.round(x.in / peak * maxH), ho = Math.round(x.out / peak * maxH);
    var cur = (i === 11);
    sIn += '<rect x="' + (cx - 11) + '" y="' + (mid - hi) + '" width="9" height="' + Math.max(hi, 2) +
      '" rx="4" fill="url(#fgIn)" opacity="' + (cur ? 1 : .55) + '"><animate attributeName="height" from="0" to="' +
      Math.max(hi, 2) + '" dur=".6s" fill="freeze"/><animate attributeName="y" from="' + mid + '" to="' +
      (mid - hi) + '" dur=".6s" fill="freeze"/></rect>';
    sOut += '<rect x="' + (cx + 2) + '" y="' + mid + '" width="9" height="' + Math.max(ho, 2) +
      '" rx="4" fill="url(#fgOut)" opacity="' + (cur ? 1 : .55) + '"><animate attributeName="height" from="0" to="' +
      Math.max(ho, 2) + '" dur=".6s" fill="freeze"/></rect>';
    lbl += '<text x="' + cx + '" y="' + (mid + 92) + '" text-anchor="middle" font-size="10.5" font-weight="' +
      (cur ? 800 : 600) + '" fill="' + (cur ? 'var(--accent)' : 'var(--ink-2)') + '">' +
      MONTHS[x.m].slice(0, 3) + '</text>';
    if(cur){
      lbl += '<text x="' + cx + '" y="' + (mid - hi - 7) + '" text-anchor="middle" font-size="10.5" font-weight="800" fill="var(--pos)">+' + nf(x.in) + '</text>';
      lbl += '<text x="' + cx + '" y="' + (mid + ho + 15) + '" text-anchor="middle" font-size="10.5" font-weight="800" fill="var(--neg)">−' + nf(x.out) + '</text>';
    }
  });
  stage.innerHTML = '<div class="flow"><div class="fl-scroll" id="fl-scroll">' +
    '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<defs>' +
      '<linearGradient id="fgIn" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#0B9F72"/><stop offset="1" stop-color="#7CF2CE"/></linearGradient>' +
      '<linearGradient id="fgOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E5384F"/><stop offset="1" stop-color="#FFA8B3"/></linearGradient>' +
    '</defs>' +
    '<line x1="8" y1="' + mid + '" x2="' + (W - 8) + '" y2="' + mid + '" stroke="var(--line)" stroke-width="1.5"/>' +
    sIn + sOut + lbl + '</svg></div></div>';
  var sc = document.getElementById('fl-scroll');
  if(sc) sc.scrollLeft = sc.scrollWidth;
}

/* ----- бюджет ----- */
var limCat = null;
function limits(){ if(!DB.limits) DB.limits = {}; return DB.limits; }
function drawBudget(){
  var stage = document.getElementById('s-stage');
  var spent = {};
  DB.tx.filter(function(t){ return inRange(t.date) && t.type === 'out'; })
       .forEach(function(t){ spent[t.cat] = (spent[t.cat] || 0) + t.amt; });
  var L = limits(), names = [];
  CATS.out.forEach(function(c){ names.push(c[0]); });
  Object.keys(spent).forEach(function(k){ if(names.indexOf(k) < 0) names.push(k); });
  names.sort(function(a, b){
    var la = L[a] ? 1 : 0, lb = L[b] ? 1 : 0;
    if(la !== lb) return lb - la;
    return (spent[b] || 0) - (spent[a] || 0);
  });
  var html = '<div style="width:100%">';
  names.forEach(function(n){
    var sp = spent[n] || 0, lim = L[n] || 0;
    if(!lim && !sp) return;
    var pct = lim ? Math.min(100, Math.round(sp / lim * 100)) : 0;
    var col = !lim ? 'var(--g-soft)' : (pct >= 100 ? 'var(--neg)' : (pct >= 80 ? '#F0913C' : 'var(--pos)'));
    html += '<div class="bud-row" role="button" tabindex="0" data-cat="' + esc(n) + '">' +
      '<div class="bud-top"><span>' + catSvg('out', n, 'chip-ic') + ' ' + esc(tr(n)) + '</span>' +
      (lim ? '<b>' + nf(sp) + ' / ' + nf(lim) + ' ₸</b>'
           : '<b class="nolim">' + nf(sp) + ' ₸ · шек жоқ</b>') + '</div>' +
      '<div class="track"><div class="fill" style="width:' + pct + '%;background:' + col + '"></div></div></div>';
  });
  html += '</div>';
  stage.innerHTML = (html === '<div style="width:100%"></div>')
    ? '<div class="empty">Бұл айда шығын жоқ. Санатқа шек қою үшін алдымен операция қосыңыз.</div>' : html;
  stage.querySelectorAll('.bud-row').forEach(function(r){
    r.onclick = function(){ openLimit(r.getAttribute('data-cat')); };
  });
}
function openLimit(cat){
  limCat = cat;
  document.getElementById('lim-title').textContent = tr(cat) + ' — айлық шек';
  document.getElementById('lim-amt').value = limits()[cat] || '';
  openSheet('sheet-lim');
}
function saveLimit(){
  var v = parseFloat(document.getElementById('lim-amt').value) || 0;
  if(v > 0) limits()[limCat] = Math.round(v); else delete limits()[limCat];
  save(); closeSheets(); render();
  toast(v > 0 ? 'Шек сақталды' : 'Шек алынды');
}

/* ----- бас рендер ----- */
function renderStats(){
  if(!document.getElementById('s-stage')) return;
  applyStatMon();
  var list = statList(), tot = 0;
  list.forEach(function(t){ tot += t.amt; });
  var items = statItems(list);

  document.getElementById('s-count').textContent = list.length + ' операция';
  var name = statKind === 'in' ? 'Кіріс' : 'Шығын';
  var col  = statKind === 'in' ? 'var(--pos)' : 'var(--neg)';
  var st = document.getElementById('s-stage-title'); st.textContent = tr(name);
  var sb = document.getElementById('s-stage-sub');
  sb.textContent = STAT_MODES.filter(function(m){ return m.id === statMode; })
                    .map(function(m){ return tr(m.name); })[0] || '';
  var tt = document.getElementById('s-stage-tot');
  tt.textContent = money(tot); tt.style.color = tot ? col : 'var(--ink-2)';

  drawModeStrip();
  if(statMode === 'donut') drawDonut('s-stage', items, tr(name), true);
  else if(statMode === 'flow') drawFlow();
  else if(statMode === 'budget') drawBudget();
  else drawBubbles(items, tot);

  document.getElementById('s-list-title').textContent = tr(statKind === 'in' ? 'Кіріс санаттары' : 'Шығын санаттары');
  drawCatList('s-cat-out', items, tot);
}
function drawCatList(elId, items, total){
  var box=document.getElementById(elId); if(!box) return;
  box.innerHTML='';
  if(!items.length || !total){ box.innerHTML='<div class="empty">Бұл кезеңде дерек жоқ.</div>'; return; }
  items.forEach(function(it){
    var pct=total?it.value/total:0;
    var el=document.createElement('div'); el.className='cat-row';
    el.innerHTML='<div class="cat-top"><span><i class="dotc" style="background:'+it.color+'"></i>'+
      esc(it.label)+'</span><b>'+money(it.value)+' · '+Math.round(pct*100)+'%</b></div>'+
      '<div class="track"><div class="fill" style="width:'+Math.max(2,Math.round(pct*100))+
      '%;background:'+it.color+'"></div></div>';
    box.appendChild(el);
  });
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
  [/(такси|taxi|bolt|яндекс|yandex|uber|indriver|автобус|метро|онай|onay|азс|заправ|бензин|petrol|helios|көлік|парков|каршер)/i, 'Көлік'],
  [/(коммунал|квартплат|аренда|жкх|тұрғын|электр|энерго|газ|водоканал|теплосеть|мусор|кск|опс)/i, 'Тұрғын үй'],
  [/(мобиль|интернет|beeline|activ|kcell|tele2|altel|izi|байланыс|связь|транстелеком|казахтелеком)/i, 'Байланыс'],
  [/(аптек|apteka|медиц|клиник|дәрі|денсаул|health|стоматол|анализ|invivo|olymp)/i, 'Денсаулық'],
  [/(кредит|несие|қарыз|займ|погашен|рассрочк|ипотек|микрозайм|loan)/i, 'Несие төлемі'],
  [/(одежд|киім|zara|waikiki|обувь|sport|adidas|nike|бутик|h&m)/i, 'Киім'],
  [/(кино|театр|игр|steam|netflix|spotify|youtube|olimpbet|1xbet|fonbet|melbet|parimatch|bet\b|ойын|развлеч|концерт|боулинг|фитнес|бассейн)/i, 'Ойын-сауық'],
  [/(школ|курс|оқу|білім|univer|educat|книг|кітап|детский сад|репетитор)/i, 'Білім'],
  [/(подарок|сыйлық|gift|цвет|букет)/i, 'Сыйлық']
];
var IN_KEYS = [
  [/(кэш\s?б[эе][кц]|кеш\s?б[эе][кц]|cash\s?back|қайтарым)/i, 'Кэшбэк'],
  [/(зарплат|жалақы|salary|аванс|оклад|payroll)/i, 'Жалақы'],
  [/(дивиденд|инвест|брокер|freedom|депозит|вклад|вознагражд|процент по)/i, 'Инвестиция'],
  [/(кредит выдан|несие алу|займ получ|кредит получ|транш)/i, 'Несие алу'],
  [/(бизнес|kaspi pay|оплата от|выручк|эквайринг|(^|[^а-яё])(ип|тоо|жк|жшс)([^а-яё]|$))/i, 'Бизнес'],
  [/(фриланс|freelance|upwork|услуг|гонорар)/i, 'Фриланс']
];
var IN_WORDS  = /(пополнен|поступлен|зачислен|перевод от|получен|возврат|refund|кіріс|түсім|қабылданд|салынды|income|credit|кэш\s?б[эе][кц]|кеш\s?б[эе][кц]|cash\s?back|бонус|қайтарым)/i;
/* кэшбэк: жол ішіндегі «Кэшбэк 50.00» бөлігі (сатып алу жолына қосылып тұрса) және жолдың өзі кэшбэк екенін анықтау */
var CB_WORD = /(кэш\s?б[эе][кц]|кеш\s?б[эе][кц]|cash\s?back|қайтарым)/i;
var CB_FRAG = /(кэш\s?б[эе][кц]\w*|кеш\s?б[эе][кц]\w*|cash\s?back|қайтарым)[^\d\n+\-−–]{0,30}[+\-−–]?\s*\d[\d   ]*(?:[.,]\d{1,2})?\s*(?:₸|тг|тнг|KZT|%)?/ig;
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
    var rows;
    IMP.fc = null;
    if(IMP.mode !== 'broker' && isFreedomCard(lines)){
      rows = parseFreedomCard(lines);
      var fci = freedomCardInfo(lines);
      IMP.bank = BANKS.filter(function(b){ return /freedom/i.test(b[0]); })[0] || IMP.bank;
      var haveF = {};
      DB.tx.forEach(function(t){ haveF[t.acc + '|' + t.date + '|' + Math.round(t.amt) + '|' + t.type] = 1; });
      rows.forEach(function(r){
        r.dup = false;
        r.on = !r.fx && !r.pending;
      });
      rows.sort(function(a,b){ return a.date < b.date ? 1 : -1; });
      IMP.fc = { bal: fci.bal, from: fci.from, to: fci.to, replace: true, setBal: fci.bal !== null, haveF: haveF };
      /* Freedom шоты бар болса — соны таңдаймыз */
      DB.accounts.forEach(function(a){ if(a.kind === 'asset' && /freedom|фридом/i.test(a.name)) IMP.acc = a.id; });
    } else if(IMP.mode !== 'broker' && isKaspi(lines)){
      rows = parseKaspi(lines);
      var kpi = kaspiInfo(lines);
      IMP.bank = BANKS.filter(function(b){ return /kaspi/i.test(b[0]); })[0] || IMP.bank;
      var haveK = {};
      DB.tx.forEach(function(t){ haveK[t.date + '|' + Math.round(t.amt) + '|' + t.type] = 1; });
      rows.forEach(function(r){ r.dup = !!haveK[r.date + '|' + Math.round(r.amt) + '|' + r.type]; r.on = !r.dup; });
      DB.accounts.forEach(function(a){ if(a.kind === 'asset' && /kaspi|каспи/i.test(a.name)) IMP.acc = a.id; });
      IMP.fc = { title: 'Kaspi Gold үзіндісі', bal: kpi.bal, from: kpi.from, to: kpi.to, replace: true, setBal: kpi.bal !== null };
      rows.forEach(function(r){ r.dup = false; r.on = true; });
    } else {
      rows = extractRows(lines);
    }
    applyRules(rows);
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

  // кэшбэк: сатып алу жолына қосылып тұрған «Кэшбэк 50.00» бөлігі негізгі соманы шатастырмасын,
  // ал жолдың өзі кэшбэк болса — оны кіріс ретінде аламыз
  var isCb = false, lineT = line;
  if(CB_WORD.test(line)){
    var rest2 = rest.replace(CB_FRAG, ' ');
    var b2 = pickAmount(rest2);
    if(b2 && b2.score > 0){ rest = rest2; lineT = line.replace(CB_FRAG, ' '); }
    else isCb = true;
  }

  // сомалар
  var best = pickAmount(rest);
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
  else if(isCb) type = 'in';
  else if(IN_WORDS.test(lineT) && !OUT_WORDS.test(lineT)) type = 'in';
  else if(OUT_WORDS.test(lineT)) type = 'out';

  /* кэшбэк кірісі — ақшаның қайтуы, оның шығынға ешқандай қатысы жоқ */
  if(isCb && type === 'in'){
    if(best.v < 1) return null;
    return { date: d, amt: best.v, type: 'in', note: note || 'Кэшбэк', cat: 'Кэшбэк' };
  }

  if(best.v < 1) return null;
  return { date: d, amt: best.v, type: type, note: note || '—',
           cat: (type === 'in' && CB_WORD.test(line)) ? 'Кэшбэк' : guessCat(type, lineT) };
}

/* жолдан ең ықтимал соманы таңдау: валюта белгісі, таңба, тиын бар болса — басымдық */
function pickAmount(rest){
  var re = /([+\-−–])?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2}|\d{3,})\s*(₸|тг|тнг|KZT|₽|\$|USD|EUR)?/g;
  var best = null, mm;
  while((mm = re.exec(rest)) !== null){
    var v = toNum(mm[2]);
    if(!isFinite(v) || v <= 0 || v > 999999999) continue;
    var score = (mm[3] ? 3 : 0) + (mm[1] ? 2 : 0) + (/[.,]\d{2}$/.test(mm[2]) ? 1 : 0);
    if(!best || score > best.score || (score === best.score && v > best.v)){
      best = { v: v, sign: mm[1], score: score, raw: mm[0] };
    }
  }
  return best;
}

function guessCat(type, text){
  var keys = type === 'in' ? IN_KEYS : OUT_KEYS;
  for(var i = 0; i < keys.length; i++) if(keys[i][0].test(text)) return keys[i][1];
  return type === 'in' ? 'Басқа' : 'Басқа';
}



/* ================= САНАТТЫ ҮЙРЕНУ (дүкен → санат) ================= */
/* Пайдаланушы санатты бір рет өзгертсе, сол дүкен/алушының келесі операциялары да сол санатқа түседі */
function merchKey(note){
  var s = String(note || '').toLowerCase()
    .replace(/^(сатып алу|төлем|аудару|толықтыру|покупка|оплата|перевод)\s*·\s*/i, '')
    .replace(/[0-9]+/g, ' ').replace(/[^a-zа-яёәғқңөұүһі\s]/gi, ' ')
    .replace(/\b(kz|kaz|g|kkz|too|тоо|ip|ип|ltd|llc)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  var w = s.split(' ').filter(function(x){ return x.length > 1; }).slice(0, 3);
  return w.length ? w.join(' ') : '';
}
function catRules(){ return DB.rules || (DB.rules = {}); }
function learnCat(type, note, cat){
  var k = merchKey(note);
  if(!k || !cat || cat === 'Басқа') return;
  catRules()[type + '|' + k] = cat;
}
function ruleCat(type, note){
  var k = merchKey(note);
  return k ? catRules()[type + '|' + k] || null : null;
}
function applyRules(rows){
  rows.forEach(function(r){
    var c = ruleCat(r.type, r.note);
    if(c) r.cat = c;
  });
  return rows;
}

/* ================= FREEDOM BANK (Super Card) ҮЗІНДІСІ ================= */
/* Жол: «24.10.2026 -5,100.00 ₸ KZT Төлем мәліметтер…». Сома үтірмен мыңдыққа бөлінген, нүктемен тиын. */
var FC_ROW = /^(\d{2})\.(\d{2})\.(\d{4})\s+([+\-−])\s?([\d,]+\.\d{2})\s*(₸|\$|€|₽|¥|₺|AED)?\s*(KZT|USD|EUR|RUB|CNY|TRY|AED)\s*(.*)$/;
var FC_ROW2 = /^(\d{2})\.(\d{2})\.(\d{4})\s+(KZT|USD|EUR|RUB|CNY|TRY|AED)\s+(.*)$/;
var FC_AMT = /^([+\-−])\s?([\d,]+\.\d{2})\s*(₸|\$|€|₽|¥|₺|AED)?$/;
var FC_OPS = ['Сатып алу','Төлем','Аудару','Толықтыру','Қолма-қол ақша алу','Несие бойынша төлем','Қарызды өтеу','Овердрафт','Басқа'];
function isFreedomCard(lines){
  var head = lines.slice(0, 60).join(' ');
  if(!/(Фридом Банк|Freedom Bank|bankffin|Super Card)/i.test(head)) return false;
  var n = 0;
  for(var i = 0; i < lines.length && n < 3; i++) if(FC_ROW.test(lines[i])) n++;
  return n >= 3;
}
function freedomCardInfo(lines){
  var info = { bal: null, from: null, to: null };
  lines.slice(0, 80).forEach(function(l){
    var m = l.match(/KZ\w+KZT\s+KZT\s+([\d,]+\.\d{2})/);
    if(m && info.bal === null) info.bal = toNum(m[1]);
    var p = l.match(/(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);
    if(p && !info.from){ info.from = p[3]+'-'+p[2]+'-'+p[1]; info.to = p[6]+'-'+p[5]+'-'+p[4]; }
  });
  return info;
}
/* мәлімет жолдары жазба жолының үстінде де, астында да тұрады:
   екі жазба арасындағы «жетім» жолдардың алғашқы жартысы — жоғарғы жазбанікі, қалғаны — төменгісінікі */
function fcIsRow(x){ return FC_ROW.test(x) || FC_ROW2.test(x); }
function fcOrphan(x){ return x && !fcIsRow(x) && !FC_AMT.test(x) && !/^(Күні|Анықтама|QR|https?:|Сома$|жатыр$)/i.test(x) && !/check-receipt|түпнұсқалығын|сканерлеңіз/i.test(x); }
function fcContext(lines, i){
  var up = [], dn = [], j;
  for(j = i - 1; j >= 0 && !fcIsRow(lines[j]) && !/^Күні Сома/i.test(lines[j]); j--) up.unshift(lines[j]);
  var upStart = j;
  for(j = i + 1; j < lines.length && !fcIsRow(lines[j]) && !/^Күні Сома/i.test(lines[j]); j++) dn.push(lines[j]);
  /* үстіндегілерден жоғарғы жазбаға тиесілі жартысын алып тастаймыз */
  if(upStart >= 0 && fcIsRow(lines[upStart])) up = up.slice(Math.floor(up.length / 2));
  /* астындағылардың тек өз жартысын аламыз (егер келесісі де жазба болса) */
  if(j < lines.length && fcIsRow(lines[j])) dn = dn.slice(0, Math.floor(dn.length / 2));
  return up.concat(dn).filter(fcOrphan).join(' ');
}
function parseFreedomCard(lines){
  var out = [];
  for(var i = 0; i < lines.length; i++){
    var m = lines[i].match(FC_ROW);
    if(!m){
      /* сома бөлек жолға түсіп кеткен жол: «25.08.2026 KZT Толықтыру …» + «+182,127.00 ₸» */
      var m2 = lines[i].match(FC_ROW2);
      if(!m2) continue;
      var a2 = (lines[i+1] || '').match(FC_AMT), a2i = i+1;
      if(!a2){ a2 = (lines[i-1] || '').match(FC_AMT); a2i = i-1; }
      if(!a2) continue;
      m = [lines[i], m2[1], m2[2], m2[3], a2[1], a2[2], a2[3], m2[4], m2[5]];
    }
    var date = m[3] + '-' + m[2] + '-' + m[1];
    var plus = m[4] === '+';
    var amt = toNum(m[5]);
    var cur = m[7];
    var rest = (m[8] || '').trim();
    var op = '';
    FC_OPS.forEach(function(o){ if(!op && rest.indexOf(o) === 0) op = o; });
    var pending = /қарастырылып/i.test(rest) || (/^Сома\b/i.test(lines[i-1] || '') && /жатыр/i.test(lines[i+1] || ''));
    if(pending) rest = rest.replace(/қарастырылып\s*(жатыр)?/i, '').trim();
    var detail = op ? rest.slice(op.length).trim() : rest;
    /* мәлімет бос болса — үстіндегі жолдан (күні жоқ жол) аламыз */
    if(!detail){
      var up = lines[i-1] || '';
      if(up && !FC_ROW.test(up) && !/^(Күні|Сома|Анықтама|QR|https?:)/i.test(up)) detail = up.trim();
    }
    if(!(amt > 0)) continue;
    /* санатты анықтау үшін көршілес мәлімет жолдарын да аламыз */
    var ctx = detail + ' ' + fcContext(lines, i);
    /* Freedom валютасы (кэшбэк токені) теңгеге/долларға айырбасталды — бұл кэшбэк кірісі */
    var frCb = plus && /валют[ыа]\s+Freedom/i.test((lines[i-2] || '') + ' ' + (lines[i-1] || '') + ' ' + detail);
    if(frCb){
      out.push({ date: date, amt: amt, type: 'in', cat: 'Кэшбэк', note: 'Кэшбэк · Freedom валютасы → ' + (cur === 'KZT' ? 'теңге' : cur),
                 cur: cur, pending: pending, fx: cur !== 'KZT' });
      continue;
    }
    var own = /(своими счетами|own funds|өз шоттар)/i.test(detail + ' ' + (lines[i+1] || ''));
    var type = plus ? 'in' : 'out';
    var cat;
    if(own) cat = 'Инвестиция';
    else if(type === 'in') cat = guessCat('in', ctx);
    else {
      cat = guessCat('out', ctx);
      if(cat === 'Басқа' && op === 'Аудару') cat = 'Аударымдар';
    }
    if(!/account=|requisites/i.test(detail) || !ctx) {} else {
      var pm = ctx.match(/Payment for ([^\s]+(?: [^\s]+)?) with/i);
      if(pm) detail = pm[1] + ' · ' + detail.replace(/account=/i, '');
    }
    var note = ((op && op !== 'Басқа' ? op + ' · ' : '') + detail).replace(/\s{2,}/g, ' ').trim();
    if(note.length > 70) note = note.slice(0, 70);
    out.push({ date: date, amt: amt, type: type, cat: cat, note: note || op || '—',
               cur: cur, pending: pending, fx: cur !== 'KZT' });
  }
  return out;
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
    if(r.fx || r.pending) return;
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
    b.innerHTML = (br2 ? brandSm(br2)
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
    mk.innerHTML = brandSm(brandOf(IMP.bank[0])) + ' ' + esc(IMP.bank[0]) + ' шотын құру';
    mk.onclick = function(){ IMP.bankUsed = true; addBank(IMP.bank[0], IMP.bank[1], true); };
    hint.appendChild(mk);
  }

  var addBox = head.querySelector('#imp-add');
  BANKS.forEach(function(bk){
    if(bankExists(bk[0])) return;
    var b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = '+ ' + brandSm(brandOf(bk[0])) + '<span>' + esc(bk[0]) + '</span>';
    b.onclick = function(){ addBank(bk[0], bk[1], true); };
    addBox.appendChild(b);
  });

  renderImportList(box);
}

function renderImportList(box){
  var isBr = IMP.mode === 'broker';
  var ba = isBr ? acc(IMP.brAcc) : null;
  var bsym = isBr ? accCurSym(ba) : '₸';

  if(!isBr && IMP.fc){
    var fcBox = document.createElement('div');
    fcBox.className = 'card';
    var accNow = acc(IMP.acc);
    var inPer = IMP.fc.from ? DB.tx.filter(function(t){ return t.acc === IMP.acc && t.date >= IMP.fc.from && t.date <= IMP.fc.to; }).length : 0;
    var kzt = IMP.rows.filter(function(r){ return !r.fx; });
    var sIn = 0, sOut = 0;
    kzt.forEach(function(r){ if(r.on){ if(r.type === 'in') sIn += r.amt; else sOut += r.amt; } });
    fcBox.innerHTML = '<h2>' + (IMP.fc.title || 'Freedom Bank үзіндісі') + '</h2>' +
      (IMP.fc.from ? '<div class="kv"><span>Кезең</span><b>' + fullDate(IMP.fc.from) + ' – ' + fullDate(IMP.fc.to) + '</b></div>' : '') +
      '<div class="kv"><span>Теңге операциялары</span><b>' + kzt.length + '</b></div>' +
      '<div class="kv"><span>Кіріс / шығын</span><b><span style="color:var(--pos)">+' + nf(sIn) + '</span> / <span style="color:var(--neg)">−' + nf(sOut) + '</span></b></div>' +
      (IMP.fc.bal !== null ? '<div class="kv"><span>Банктегі қалдық (KZT)</span><b>' + money(IMP.fc.bal) + '</b></div>' : '');
    function optRow(key, label){
      var t = document.createElement('div');
      t.className = 'toggle'; t.style.margin = '10px 0 0';
      t.innerHTML = '<div style="flex:1;font-size:13.5px;line-height:1.45">' + label + '</div><div class="sw' + (IMP.fc[key] ? ' on' : '') + '"><i></i></div>';
      t.onclick = function(){ IMP.fc[key] = !IMP.fc[key]; renderImport(); };
      fcBox.appendChild(t);
    }
    if(inPer) optRow('replace', '<b>Бұрынғы ' + inPer + ' операцияны ауыстыру</b><br><span class="muted">«' + esc(accNow ? accNow.name : '') + '» шотындағы осы кезеңнің ескі (қате) жазбалары өшіріліп, орнына осы үзінді қосылады</span>');
    if(IMP.fc.bal !== null) optRow('setBal', '<b>Шот қалдығын банкпен теңестіру</b><br><span class="muted">Импорттан кейін қалдық ' + money(IMP.fc.bal) + ' болады</span>');
    box.appendChild(fcBox);
  }

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
      var catList = CATS[r.type].slice();
      /* тізімде жоқ санат болса да, таңдалғаны көрінсін — әйтпесе экранда бірінші санат тұрып қалады */
      if(!catList.some(function(c){ return c[0] === r.cat; })) catList.unshift([r.cat, '']);
      catList.forEach(function(c){
        var op = document.createElement('option');
        op.value = c[0]; op.textContent = c[0];
        if(r.cat === c[0]) op.selected = true;
        sc.appendChild(op);
      });
      sc.onchange = function(){
        r.cat = sc.value;
        learnCat(r.type, r.note, r.cat);
        /* осы дүкеннің тізімдегі басқа «Басқа» жолдары да сол санатқа */
        var k = merchKey(r.note), n = 0;
        if(k) IMP.rows.forEach(function(x){
          if(x !== r && x.type === r.type && x.cat === 'Басқа' && merchKey(x.note) === k){ x.cat = r.cat; n++; }
        });
        if(n){ toast('Тағы ' + n + ' жол «' + tr(r.cat) + '» санатына ауысты'); renderImport(); }
      };
      meta.appendChild(st); meta.appendChild(sc);
    }
    if(r.dup){
      var bd = document.createElement('span');
      bd.className = 'badge'; bd.textContent = 'бұрын қосылған';
      meta.appendChild(bd);
    }
    if(r.pending){
      var bp = document.createElement('span');
      bp.className = 'badge'; bp.textContent = 'банк әлі растамаған';
      meta.appendChild(bp);
    }
    if(r.fx){
      var bx = document.createElement('span');
      bx.className = 'badge'; bx.textContent = r.cur + ' шоты — қосылмайды';
      meta.appendChild(bx);
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

function impAll(v){ IMP.rows.forEach(function(r){ r.on = v && !r.fx; }); renderImport(); }
function impOnlyNew(){ IMP.rows.forEach(function(r){ r.on = !r.dup && !r.fx && !r.pending; }); renderImport(); }

function importConfirm(){
  var sel = IMP.rows.filter(function(r){ return r.on; });
  if(!sel.length){ toast('Бірде-бір жазба белгіленбеген'); return; }

  if(!IMP.acc){ toast('Алдымен шот қосыңыз'); return; }
  sel = sel.filter(function(r){ return !r.fx; });
  var removed = 0;
  if(IMP.fc && IMP.fc.replace && IMP.fc.from){
    var keep = [];
    DB.tx.forEach(function(t){
      if(t.acc === IMP.acc && t.date >= IMP.fc.from && t.date <= IMP.fc.to){ applyTx(t, -1); removed++; }
      else keep.push(t);
    });
    DB.tx = keep;
  }
  sel.forEach(function(r){
    var t = { id: newId(), type: r.type, cat: r.cat, amt: r.amt, date: r.date,
              note: r.note === '—' ? '' : r.note, acc: IMP.acc, loan: null };
    DB.tx.push(t);
    applyTx(t, 1);
  });
  if(IMP.fc && IMP.fc.setBal && IMP.fc.bal !== null){
    var ta = acc(IMP.acc); if(ta) ta.bal = IMP.fc.bal;
  }
  save();
  IMP.rows = []; IMP.fc = null;
  document.getElementById('imp-result').innerHTML = '';
  toast(sel.length + ' операция қосылды' + (removed ? ' · ' + removed + ' ескі жазба ауыстырылды' : ''));
  go('ops');
}

/* ================= ТІЛ / ЯЗЫК / LANGUAGE ================= */
/* [қазақша, орысша, ағылшынша] */
var TR = [
/* --- навигация --- */
["Басты","Главная","Home"],["Қаржы","Финансы","Finance"],["Операция","Операции","Activity"],
["Нәтиже","Нәтиже","Stats"],["Статистика","Статистика","Statistics"],["Шоттар","Счета","Accounts"],["Профиль","Профиль","Profile"],["Дизайн стилі","Стиль оформления","Design style"],["Классик","Классика","Classic"],["Изумруд","Изумруд","Emerald"],["Күлгін","Фиолетовый","Violet"],["Мұхит","Океан","Ocean"],["Раушан","Роза","Rose"],["Неон","Неон","Neon"],["Шыны","Стекло","Glass"],["Күн батуы","Закат","Sunset"],["Минимал","Минимал","Minimal"],["Кіріс қосу","Добавить доход","Add income"],["Шығын қосу","Добавить расход","Add expense"],["Баптау","Настройки","Settings"],
["Шолу","Обзор","Overview"],["Операциялар","Операции","Transactions"],
["Мақсаттар","Цели","Goals"],["Есептегіш","Есептегіш","Calculator"],["Бюджет — санат лимиттері","Бюджет — лимиты по категориям","Budget — category limits"],

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
["Несиелер","Кредиты","Loans"],["Банктер","Банки","Banks"],["Брокер","Брокер","Broker"],
["Несие","Кредит","Loan"],["Банк шоты","Банковский счёт","Bank account"],["Брокерлік шот","Брокерский счёт","Brokerage account"],
["Жеке есептеледі — таза капиталға қосылмайды.","Считается отдельно — в чистый капитал не входит.","Counted separately — not part of net worth."],
["Банк шотын қосу","Добавить банковский счёт","Add bank account"],
["Брокерлік шот қосу","Добавить брокерский счёт","Add brokerage account"],
["Несие қосу","Добавить кредит","Add loan"],
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
["Кесте үшін дерек жоқ.","Нет данных для графика.","No data for the chart."],
["Бұл айда кіріс жазылмаған.","В этом месяце доходов нет.","No income this month."],
["Бұл айда шығын жазылмаған.","В этом месяце расходов нет.","No expenses this month."],

/* --- мақсаттар --- */
["Жиналған","Накоплено","Saved"],["Мақсат қосу","Добавить цель","Add goal"],
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
["Талдау","Аналитика","Insights"],
["Жылдық табыстылық","Годовая доходность","Annualized return"],
["Орташа ұстау мерзімі","Средний срок вложений","Average holding period"],
["Барлық инвестициядағы үлесі","Доля во всех инвестициях","Share of all investments"],
["Соңғы салым","Последнее пополнение","Last deposit"],
["әлі ерте","пока рано","too early"],
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
["Кэшбэк","Кэшбэк","Cashback"],

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

/* --- тұрақты операциялар --- */["Тұрақты операциялар","Регулярные операции","Recurring transactions"],["Ай сайынғы шығын","Расход в месяц","Monthly expense"],["Қай шот","Какой счёт","Account"],["келесі","следующая","next"],["тоқтатылған","остановлено","paused"],["Қосылды","Включено","Enabled"],

/* --- PDF есеп --- */
["PDF есеп жасау","Сформировать PDF-отчёт","Generate PDF report"],
["Excel-ге шығару","Выгрузить в Excel","Export to Excel"],
["PDF-ке шығару","Выгрузить в PDF","Export to PDF"],
["Excel дайындалуда…","Готовим Excel…","Preparing Excel…"],
["Excel жасалмады — интернетті тексеріңіз","Excel не создан — проверьте интернет","Could not create the Excel file — check your connection"],
["Бұл кезеңде дерек жоқ.","За этот период данных нет.","No data for this period."],
["Мәндерді толтырыңыз.","Заполните поля.","Fill in the fields."],
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
["Мен қарызға бердім","Я дал в долг","I lent money"],
["Мен қарызға алдым","Я взял в долг","I borrowed money"],
["мерзімі өтті","просрочен","overdue"],["жабылды","закрыт","closed"],["дейін","до","by"],
["Бердім","Дал","Lent"],["Алдым","Взял","Borrowed"],["Қайтарылды","Возвращено","Repaid"],
["Қарыз мерзімі өтті","Просроченные долги","Overdue debts"],["қарыз","долг","debt"],

["Депозит калькуляторы","Депозитный калькулятор","Deposit calculator"],
["Банк салымының табысы","Доход по вкладу","Deposit return"],
["Капитализация · Толықтыру","Капитализация · Пополнение","Compounding · Top-ups"],
["Салым сомасы, ₸","Сумма вклада, ₸","Deposit amount, ₸"],["Мерзімі, ай","Срок, мес.","Term, months"],
["Ай сайынғы толықтыру, ₸","Ежемесячное пополнение, ₸","Monthly top-up, ₸"],
["Капитализация","Капитализация","Compounding"],
["Ай сайын капитализация — пайызға пайыз","Ежемесячная капитализация — процент на процент","Monthly compounding — interest on interest"],
["Пайыз мерзім соңында бір рет төленеді","Проценты выплачиваются в конце срока","Interest paid at the end of the term"],
["Тиімді жылдық өсім","Эффективная годовая доходность","Effective annual return"],
["Айына орташа табыс","Средний доход в месяц","Average monthly return"],

["Жалақы бөлу","Распределение зарплаты","Salary split"],
["Айлықты пайызбен бөліп, жоспарды сақтап қою","Разделить зарплату по процентам и сохранить план","Split your salary by percentages and save the plan"],
["Айлық жалақы, ₸","Зарплата в месяц, ₸","Monthly salary, ₸"],
["Пайызбен бөлу · Жоспарды сақтау","Проценты · Сохранение плана","Percentages · Saved plan"],
["+ Бөлім қосу","+ Добавить раздел","+ Add a part"],["Бастапқы жоспар","План по умолчанию","Default plan"],
["Жоспарды сақтау","Сохранить план","Save plan"],["Жоспар сақталды.","План сохранён.","Plan saved."],
["Жалақыны жазыңыз.","Введите зарплату.","Enter your salary."],
["Пайыздың қосындысы 100% болуы керек.","Сумма процентов должна быть 100%.","Percentages must add up to 100%."],
["Кемінде бір бөлім қалуы керек.","Должен остаться хотя бы один раздел.","At least one part must remain."],
["Тек есеп — ешқайда жіберілмейді","Только расчёт — никуда не отправлять","Calculation only — don't send anywhere"],
["Мақсат","Цель","Goal"],["Инвестиция (шығын ретінде жазылады)","Инвестиции (запишется как расход)","Investment (recorded as expense)"],
["Аударым","Перевод","Transfer"],["Жалақы жоспары","План зарплаты","Salary plan"],["бөлім орындалды","разделов выполнено","parts done"],
["Жалақы жоспары бойынша ақша жіберіледі. Жалғастырасыз ба?","Деньги будут отправлены по плану зарплаты. Продолжить?","Money will be sent according to the salary plan. Continue?"],
["Бұл айда жоспар орындалған. Қайта орындасаңыз ақша екінші рет жіберіледі. Жалғастырасыз ба?","В этом месяце план уже выполнен. Повторно деньги отправятся ещё раз. Продолжить?","The plan was already applied this month. Applying again sends the money twice. Continue?"],
["Жоспарды орындау","Выполнить план","Apply plan"],["Қай шоттан бөлеміз","С какого счёта делим","Split from account"],
["Қайталанатын төлемдер","Регулярные платежи","Recurring payments"],["Ай сайынғы төлемдер мен еске салу","Ежемесячные платежи и напоминания","Monthly payments and reminders"],
["Жаңа төлем","Новый платёж","New payment"],["Төлемді түзету","Изменить платёж","Edit payment"],["Төлем жақындады","Платёж скоро","Payment due soon"],
["Төлем мерзімі өтті","Платёж просрочен","Payment overdue"],["Төледім","Оплатил","Paid"],["төленді","оплачено","paid"],
["бүгін","сегодня","today"],["күннен кейін","дн. осталось","days left"],["Төлем жазылды","Платёж записан","Payment recorded"],
["Төлем әлі жоқ.","Платежей пока нет.","No payments yet."],
["Айдың қай күні екенін жазыңыз (1–31)","Укажите день месяца (1–31)","Enter the day of month (1–31)"],
["Төлем тізімнен өшіріледі. Бұрын жазылған операциялар қалады. Жалғастырасыз ба?","Платёж удалится из списка. Прежние операции останутся. Продолжить?","The payment will be removed. Past transactions stay. Continue?"],
["Осы айда қайтты","Вернулось в этом месяце","Returned this month"],["Өткен айда","В прошлом месяце","Last month"],
["Осы айдағы кэшбэк саны","Начислений кэшбэка в месяце","Cashback entries this month"],
["Шығынның қанша пайызы қайтты","Какая доля расходов вернулась","Share of spending returned"],
["Барлық уақытта","За всё время","All time"],
["Салық калькуляторы","Налоговый калькулятор","Tax calculator"],
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
["12 айлық өзгеріс","Динамика за 12 месяцев","12-month trend"],
["Барлық шығын","Все расходы","All expenses"],["Барлық кіріс","Все доходы","All income"],
["Басқалары","Прочее","Other"],
["Әке-шешеме","Родителям","To parents"],
["Мақсаттар","Цели","Goals"],
["Мақсатқа жиналған","Накоплено на цели","Saved for goals"],
["Қашанға жинау керек (міндетті емес)","К какой дате накопить (необязательно)","Target date (optional)"],
["Мерзімі","Срок","Deadline"],
["Айына салу керек","Нужно в месяц","Needed per month"],
["мерзімі өтті","срок прошёл","overdue"],
["Мақсат орындалды 🎉","Цель достигнута 🎉","Goal reached 🎉"],
["Салынған инвестиция","Вложено в инвестиции","Total invested"],
["Салынған инвестиция (барлық уақыт)","Вложено в инвестиции (за всё время)","Total invested (all time)"],
["Шот бойынша","По счетам","By account"],
["Көпіршік","Пузыри","Bubbles"],
["Кіріс/Шығын","Доход/Расход","Income/Expense"],
["Санаттар бойынша","По категориям","By category"],
["Брокер бойынша","По брокерам","By broker"],
["Бұл айда дерек жоқ.","В этом месяце данных нет.","No data this month."],
["Айлық шек","Месячный лимит","Monthly limit"],
["Шек сомасы (₸)","Сумма лимита (₸)","Limit amount (₸)"],
["0 деп қойсаңыз — шек алынады.","0 — лимит снимается.","0 removes the limit."],
["Шек сақталды","Лимит сохранён","Limit saved"],
["Шек алынды","Лимит снят","Limit removed"],
["Бұл айда шығын жоқ. Санатқа шек қою үшін алдымен операция қосыңыз.","В этом месяце расходов нет. Чтобы задать лимит, добавьте операцию.","No expenses this month. Add a transaction to set a limit."],
["Қай брокер шотына","На какой брокерский счёт","To which brokerage account"],
["Қай шоттан саласыз","С какого счёта","From which account"],
["Брокер шотын таңдаңыз","Выберите брокерский счёт","Choose a brokerage account"],
["Инвестиция қосылды","Инвестиция добавлена","Investment added"],
["Алдымен брокерлік шот қосыңыз","Сначала добавьте брокерский счёт","Add a brokerage account first"],
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
["Дерек тек осы телефонда сақталады.","Данные хранятся только на этом телефоне.","Data is stored only on this phone."]
,
["Несие қалдығы","Остаток по кредитам","Loan balance"],
["Қарыз · маған / мен","Долги · мне / я","Debts · to me / mine"],
["Жинақ үлесі (осы ай)","Доля сбережений (этот месяц)","Savings rate (this month)"],
["Қаражат неше айға жетеді","На сколько месяцев хватит средств","Months of runway"],
["12+ ай","12+ мес.","12+ months"],
["Қосымша","Дополнительно","Details"],
/* --- 3.1: растау, импорт, қолжетімділік --- */
["Барлық дерек өшіріледі. Жалғастырасыз ба?","Все данные будут удалены. Продолжить?","All data will be deleted. Continue?"],
["Қазіргі дерек файлдағымен толық ауыстырылады. Жалғастырасыз ба?","Текущие данные будут полностью заменены данными из файла. Продолжить?","Current data will be fully replaced with the file. Continue?"],
["Бұл Қаржы көшірмесі емес","Это не резервная копия Қаржы","This is not a Qarzhy backup"],
["Шот өшіріледі. Операциялары сақталады, бірақ шотсыз қалады. Жалғастырасыз ба?","Счёт будет удалён. Операции останутся, но без счёта. Продолжить?","The account will be deleted. Its transactions stay, without an account. Continue?"],
["Мақсат өшіріледі. Жалғастырасыз ба?","Цель будет удалена. Продолжить?","The goal will be deleted. Continue?"],
["Жазба өшіріледі, шот қалдықтары бастапқы күйге қайтарылады. Жалғастырасыз ба?","Запись будет удалена, остатки счетов вернутся к прежним. Продолжить?","The record will be deleted and account balances restored. Continue?"],
["Қалдық, $","Остаток, $","Balance, $"],
["Артқа","Назад","Back"],["Алдыңғы ай","Предыдущий месяц","Previous month"],["Келесі ай","Следующий месяц","Next month"],
["Іздеу","Поиск","Search"],
["Мақсаттарда жиналған","Накоплено в целях","Saved in goals"]
];

var LANG = 'kk';
var DICT_RU = {}, DICT_EN = {};
TR.forEach(function(r){ DICT_RU[r[0]] = r[1]; DICT_EN[r[0]] = r[2]; });

var TR_RULES = [
  [/^(.+) млн ₸$/, "$1 млн ₸", "$1M ₸"],
  [/^(.+) млрд ₸$/, "$1 млрд ₸", "$1B ₸"],
  [/^(\d+) шот$/, "Счетов: $1", "$1 accounts"],
  [/^(\d+) банк$/, "Банков: $1", "$1 banks"],
  [/^(\d+) операция$/, "Операций: $1", "$1 transactions"],
  [/^(.+) — айлық шек$/, "$1 — месячный лимит", "$1 — monthly limit"],
  [/^([\d\s]+) ₸ · шек жоқ$/, "$1 ₸ · без лимита", "$1 ₸ · no limit"],
  [/^(\d+) жазба$/, "Записей: $1", "$1 records"],
  [/^(\d+) мақсат$/, "Целей: $1", "$1 goals"],
  [/^Айына (.+) салсаң, (.+)-ге жетесің$/, "По $1 в месяц — успеете к $2", "$1 per month gets you there by $2"],
  [/^Мерзімі өтті · (.+)$/, "Срок прошёл · $1", "Overdue · $1"],
  [/^(\d+) сағат бұрын$/, "$1 ч. назад", "$1 h ago"],
  [/^(\d+) күн бұрын$/, "$1 дн. назад", "$1 d ago"],
  [/^([\d,\.]+) ай$/, "$1 мес.", "$1 months"],
  [/^([\d,\.]+) жыл$/, "$1 г.", "$1 years"],
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
  [/^(\d+) ай \((\d+) ай қысқарды\)$/, "$1 мес. (короче на $2 мес.)", "$1 months ($2 fewer)"]
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
  var al = (root || document).querySelectorAll('[aria-label]');
  for(var j = 0; j < al.length; j++){
    var av = al[j].getAttribute('aria-label'), at = tr(av);
    if(at !== av) al[j].setAttribute('aria-label', at);
  }
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
  flushSave().then(function(){ location.reload(); });
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
    if(document.visibilityState === 'hidden'){ saveView(); flushSave(); autoSnapshot(); }
  });
  window.addEventListener('pagehide', function(){ saveView(); flushSave(); });
  var scrollTimer = null;
  window.addEventListener('scroll', function(){
    if(scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(saveView, 400);
  }, { passive: true });
  window.addEventListener('beforeunload', function(){ flushSave(); });
}

/* ================= ДИАГРАММАЛАР ================= */
var PIE_COLORS = ['#2338E6','#D9860B','#6D3FE8','#0AA5C2','#E5384F',
                  '#F0913C','#9B51E0','#2BB673','#7A8199','#C4CAE0'];

function drawDonut(elId, items, centerLabel, noLegend){
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

  var leg = '';
  if(!noLegend){
    leg = '<div class="legend2">';
    items.forEach(function(it){
      leg += '<div class="lg"><i style="background:' + it.color + '"></i>' +
        '<span>' + esc(it.label) + '</span><b>' + Math.round(it.value / total * 100) + '%</b></div>';
    });
    leg += '</div>';
  }
  box.innerHTML = '<div class="donut-wrap' + (noLegend ? ' solo' : '') + '">' + svg + leg + '</div>';
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
  /* «Басқа» санаты мен тізім құйрығы бір ұяшыққа біріктіріледі */
  var rest = sums['Басқа'] || 0;
  var keys = Object.keys(sums).filter(function(k){ return k !== 'Басқа'; })
                  .sort(function(a,b){ return sums[b] - sums[a]; });
  var out = [];
  keys.forEach(function(k, i){
    if(i < 6) out.push({ label: k, value: sums[k] });
    else rest += sums[k];
  });
  if(rest) out.push({ label: 'Басқа', value: rest });
  out.sort(function(a,b){ return b.value - a.value; });
  out.forEach(function(it, i){ it.color = PIE_COLORS[i % PIE_COLORS.length]; });
  return out;
}

/* ================= ТАҚЫРЫП (ашық / қараңғы) ================= */
function themeMode(){ return DB.theme || 'auto'; }
function isDark(){
  var m = themeMode();
  if(m === 'dark') return true;
  if(m === 'light') return false;
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
var SKINS = [
  ['coral','Qarzhy',['#141B2D','#F0453A','#FF8A70']],
  ['classic','Классик',['#1463FF','#0B2A7A','#FF6F61']],
  ['x-emerald','Изумруд',['#0F5C46','#10B981','#4ADE9F']],
  ['x-violet','Күлгін',['#4C2A9A','#8B5CF6','#C4A5FF']],
  ['x-ocean','Мұхит',['#0B4F75','#0EA5E9','#5ED0FF']],
  ['x-sunset','Күн батуы',['#9A2F1C','#F97316','#FFB37A']],
  ['x-rose','Раушан',['#8E1A55','#EC4899','#FF9CCB']]
];
function skinMode(){ var k = DB.skin || 'coral'; return /^(coral|classic|x-\w+)$/.test(k) ? k : 'coral'; }
function applyTheme(){
  var sk = skinMode();
  var dark = isDark();
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-skin', sk);
  var mt = document.querySelector('meta[name="theme-color"]');
  if(mt) mt.setAttribute('content', (dark ? (sk === 'coral' ? '#0E1220' : '#070F1F') : (sk === 'coral' ? '#F6F6F8' : '#F6F8FC')));
}
function setSkin(k){ DB.skin = k; save(); applyTheme(); render(); }
function drawSkinChips(){
  var box = document.getElementById('skin-chips');
  if(!box) return;
  box.innerHTML = '';
  SKINS.forEach(function(k){
    var b = document.createElement('button');
    var on = skinMode() === k[0];
    b.type = 'button';
    b.className = 'skin' + (on ? ' on' : '');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = '<span class="sk-sw" style="background:linear-gradient(135deg,' + k[2][0] + ',' + k[2][1] + ' 60%,' + k[2][2] + ')"></span><span>' + tr(k[1]) + '</span>';
    b.onclick = function(){ setSkin(k[0]); };
    box.appendChild(b);
  });
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
function animNum(el, val, sym, fmt){
  if(!el) return;
  sym = sym || '₸';
  fmt = fmt || money;
  var prev = parseFloat(el.getAttribute('data-v'));
  el.setAttribute('data-v', val);
  if(isNaN(prev) || Math.abs(val - prev) < 1 ||
     (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)){
    el.textContent = fmt(val, sym);
    return;
  }
  var t0 = performance.now(), dur = 520;
  function step(t){
    var k = Math.min(1, (t - t0) / dur);
    var e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(prev + (val - prev) * e, sym);
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
  applyTx(t, -1);
  DB.tx = DB.tx.filter(function(x){ return x.id !== t.id; });
  save(); render();
  toastUndo('Өшірілді', function(){
    DB.tx.push(copy);
    applyTx(copy, 1);
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
  user:   '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
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
  invest: '<path d="M4 19.4h16"/><path d="M7.4 16.4V12"/><path d="M11.8 16.4V7.4"/><path d="M16.2 16.4v-6.4"/><path d="M6.2 8.6 12 3.8l5.8 4.8"/>'
};

var CAT_ICON = {
  'Тамақ':'food','Көлік':'car','Тұрғын үй':'house','Байланыс':'phone','Киім':'shirt',
  'Денсаулық':'health','Несие төлемі':'card','Ойын-сауық':'fun','Білім':'book',
  'Сыйлық':'gift','Басқа':'star',
  'Жалақы':'salary','Бизнес':'biz','Фриланс':'laptop','Инвестиция':'invest','Кэшбэк':'coin','Несие алу':'card',
  'Аударым':'swap','Аударымдар':'swap'
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
var CAT_COL = {
  'Тамақ':'#F04452','Ойын-сауық':'#8B5CF6','Байланыс':'#0EA5E9','Әке-шешеме':'#F59E0B',
  'Көлік':'#2F6BFF','Киім':'#EC4899','Тұрғын үй':'#1D4ED8','Денсаулық':'#10B981','Білім':'#6366F1',
  'Сыйлық':'#F97316','Инвестиция':'#7C3AED','Несие төлемі':'#E11D48','Кэшбэк':'#14B8A6',
  'Аударымдар':'#0EA5E9','Жалақы':'#17B26A','Бизнес':'#0891B2','Фриланс':'#2563EB','Несие алу':'#64748B','Басқа':'#64748B'
};
function catColor(type, cat){
  if(type === 'tr') return '#2F6BFF';
  if(CAT_COL[cat]) return CAT_COL[cat];
  if(type === 'in') return '#17B26A';
  var h=0; String(cat||'').split('').forEach(function(c){ h=(h*31+c.charCodeAt(0))>>>0; });
  return ['#F04452','#8B5CF6','#0EA5E9','#F59E0B','#10B981','#EC4899','#6366F1','#F97316'][h%8];
}
function catBox(type, cat){
  return '<div class="ico cc" style="background:' + catColor(type, cat) + '">' + catSvg(type, cat) + '</div>';
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
    b.innerHTML = (br ? brandSm(br)
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
  var a = acc(dAcc);
  if(a) a.bal += toAcc(a, dDir === 'out' ? -amt : amt);
  debts().push(d);
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
  var a = acc(dPayAcc);
  if(a) a.bal += toAcc(a, d.dir === 'out' ? v : -v);
  d.paid = (d.paid || 0) + v;
  d.hist = d.hist || [];
  d.hist.push({ date: todayISO(), amt: v, acc: dPayAcc });
  save(); closeSheets(); render();
  toast(debtLeft(d) <= 0 ? 'Толық жабылды' : 'Төлем жазылды');
}
function delDebt(){
  var d = debtOf(dId); if(!d) return;
  if(!confirm(tr('Жазба өшіріледі, шот қалдықтары бастапқы күйге қайтарылады. Жалғастырасыз ба?'))) return;
  var a = acc(d.acc);
  if(a) a.bal += toAcc(a, d.dir === 'out' ? d.amt : -d.amt);
  (d.hist || []).forEach(function(x){
    var pa = acc(x.acc);
    if(pa) pa.bal += toAcc(pa, d.dir === 'out' ? -x.amt : x.amt);
  });
  DB.debts = debts().filter(function(x){ return x.id !== dId; });
  save(); closeSheets(); render(); toast('Өшірілді');
}

function drawDebts(){
  var T = debtTotals();
  var le = document.getElementById('d-lent'), oe = document.getElementById('d-owed');
  if(le) le.textContent = money(T.lent);
  if(oe) oe.textContent = money(T.owed);

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
function toggleDepCap(){
  depCap = !depCap;
  document.getElementById('dp-sw').classList.toggle('on', depCap);
  document.getElementById('dp-sw-txt').textContent = depCap
    ? 'Ай сайын капитализация — пайызға пайыз'
    : 'Пайыз мерзім соңында бір рет төленеді';
  calcDep();
}
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
      '<td style="padding:6px 0;border-bottom:1px solid #EEF1FA;text-align:right;color:#E5384F">' + nf(int_) + '</td>' +
      '<td style="padding:6px 0;border-bottom:1px solid #EEF1FA;text-align:right;color:#0B9F72">' + nf(pr) + '</td>' +
      '<td style="padding:6px 0;border-bottom:1px solid #EEF1FA;text-align:right">' + nf(Math.max(0, bal)) + '</td></tr>';
  }

  var html =
  '<div style="width:794px;padding:44px 46px;background:#fff;color:#0D1226;' +
       'font-family:Inter,-apple-system,Roboto,Arial,sans-serif;box-sizing:border-box">' +
    '<div style="display:flex;align-items:center;gap:16px;padding-bottom:22px;border-bottom:3px solid #2338E6">' +
      '<div style="width:54px;height:54px;border-radius:16px;background:#2338E6;color:#fff;' +
           'display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800">Қ</div>' +
      '<div style="flex:1"><div style="font-size:26px;font-weight:800">Несие төлем кестесі</div>' +
        '<div style="color:#5D6480;font-size:14px;margin-top:2px">' +
          (loanType === 'ann' ? 'Аннуитетті' : 'Дифференциалды') + ' · ' + rate + '% жылдық</div></div>' +
      '<div style="text-align:right;color:#5D6480;font-size:12px">' + fullDate(todayISO()) + '</div>' +
    '</div>' +

    '<div style="display:flex;gap:14px;margin:26px 0">' +
      '<div style="flex:1;background:#EBEEFF;border-radius:16px;padding:18px">' +
        '<div style="color:#5D6480;font-size:13px">Ай сайынғы төлем</div>' +
        '<div style="font-size:23px;font-weight:800;color:#2338E6;margin-top:4px">' + money(first, loanCur) + '</div></div>' +
      '<div style="flex:1;background:#FFEFF1;border-radius:16px;padding:18px">' +
        '<div style="color:#5D6480;font-size:13px">Артық төлем</div>' +
        '<div style="font-size:23px;font-weight:800;color:#E5384F;margin-top:4px">' + money(interest, loanCur) + '</div></div>' +
      '<div style="flex:1;background:#EAFBF4;border-radius:16px;padding:18px">' +
        '<div style="color:#5D6480;font-size:13px">Барлық төлем</div>' +
        '<div style="font-size:23px;font-weight:800;color:#0B9F72;margin-top:4px">' + money(total, loanCur) + '</div></div>' +
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

/* ================= КАЛЬКУЛЯТОР ЭКСПОРТЫ ================= */

/* --- Excel (SheetJS CDN) --- */
var CDN_XLSX = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

function exportXlsx(sheets, fname){
  toast('Excel дайындалуда…');
  loadScript(CDN_XLSX).then(function(){
    var XLSXlib = window.XLSX;
    var wb = XLSXlib.utils.book_new();
    sheets.forEach(function(sh){
      var ws = XLSXlib.utils.aoa_to_sheet(sh.rows);
      var wch = [];
      sh.rows.forEach(function(r){
        r.forEach(function(c, i){
          var len = String(c == null ? '' : c).length + 3;
          if(!wch[i] || wch[i] < len) wch[i] = Math.min(38, len);
        });
      });
      ws['!cols'] = wch.map(function(w){ return { wch: w || 12 }; });
      XLSXlib.utils.book_append_sheet(wb, ws, sh.name.slice(0, 30));
    });
    var out = XLSXlib.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    shareOrSave(blob, fname);
  }).catch(function(){ toast('Excel жасалмады — интернетті тексеріңіз'); });
}

function shareOrSave(blob, name){
  var file = null;
  try { file = new File([blob], name, { type: blob.type }); } catch(e){}
  if(file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share){
    navigator.share({ files: [file], title: name })
      .then(function(){ toast('Жіберілді'); })
      .catch(function(){ pdfDownload(blob, name); });
  } else {
    pdfDownload(blob, name);
  }
}

/* --- ортақ баптар --- */
function calcHead(title, sub){
  return '<div style="display:flex;align-items:center;gap:16px;padding-bottom:20px;border-bottom:3px solid #2338E6">' +
    '<div style="width:54px;height:54px;border-radius:16px;background:#2338E6;color:#fff;' +
         'display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800">Қ</div>' +
    '<div style="flex:1"><div style="font-size:25px;font-weight:800">' + title + '</div>' +
      '<div style="color:#5D6480;font-size:14px;margin-top:2px">' + sub + '</div></div>' +
    '<div style="text-align:right;color:#5D6480;font-size:12px">' + fullDate(todayISO()) + '</div></div>';
}
function calcCards(items){
  var h = '<div style="display:flex;gap:14px;margin:24px 0">';
  items.forEach(function(it){
    h += '<div style="flex:1;background:' + it.bg + ';border-radius:16px;padding:18px">' +
      '<div style="color:#5D6480;font-size:13px">' + it.label + '</div>' +
      '<div style="font-size:22px;font-weight:800;color:' + it.fg + ';margin-top:4px">' + it.value + '</div></div>';
  });
  return h + '</div>';
}
function calcWrap(inner){
  return '<div style="width:794px;padding:44px 46px;background:#fff;color:#0D1226;' +
    'font-family:Inter,-apple-system,Roboto,Arial,sans-serif;box-sizing:border-box">' + inner +
    '<div style="margin-top:26px;padding-top:16px;border-top:1px solid #E4E8F7;color:#5D6480;font-size:11.5px">' +
    'Qarzhy · есеп шамамен, банктің нақты шарттарын тексеріңіз</div></div>';
}

/* ================= ИНВЕСТИЦИЯ КАЛЬКУЛЯТОРЫ ================= */
function invRows(){
  var P = num('i-start'), M = num('i-month'), rate = num('i-rate'), i = rate / 100 / 12;
  var n = invUnit === 'year' ? Math.round(num('i-years') * 12) : Math.round(num('i-years'));
  var rows = [], bal = P, inv = P, simple = 0;
  for(var m = 1; m <= n; m++){
    if(invReinvest){ bal = bal * (1 + i) + M; }
    else { simple += (P + M * (m - 1)) * i; bal = P + M * m + simple; }
    inv = P + M * m;
    rows.push({ m: m, inv: inv, bal: bal });
  }
  return { rows: rows, P: P, M: M, rate: rate, n: n, bal: bal, inv: inv, cur: invCur };
}
function exportInvPdf(){
  var d = invRows();
  if(d.n <= 0 || (d.P <= 0 && d.M <= 0)){ toast('Мәндерді толтырыңыз.'); return; }
  var body = '';
  d.rows.forEach(function(x){
    if(x.m % 6 !== 0 && x.m !== d.n) return;
    body += '<tr>' +
      '<td style="padding:7px 0;border-bottom:1px solid #EEF1FA;color:#5D6480">' + x.m + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #EEF1FA;text-align:right">' + nf(x.inv) + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #EEF1FA;text-align:right;color:#0B9F72">' + nf(x.bal - x.inv) + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #EEF1FA;text-align:right;font-weight:700">' + nf(x.bal) + '</td></tr>';
  });
  var html = calcWrap(
    calcHead('Инвестиция есебі', d.n + ' ай · жылдық ' + d.rate + '%' + (invReinvest ? ' · реинвестициямен' : '')) +
    calcCards([
      { label: 'Соңғы сома', value: money(d.bal, d.cur), bg: '#EBEEFF', fg: '#2338E6' },
      { label: 'Салынған', value: money(d.inv, d.cur), bg: '#F4F6FF', fg: '#0D1226' },
      { label: 'Пайыздық табыс', value: money(d.bal - d.inv, d.cur), bg: '#EAFBF4', fg: '#0B9F72' }
    ]) +
    '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:24px">' +
      rpRow('Бастапқы салым', money(d.P, d.cur)) +
      rpRow('Ай сайынғы толықтыру', money(d.M, d.cur)) +
      rpRow('Мерзімі', d.n + ' ай (' + (d.n / 12).toFixed(1) + ' жыл)') +
      rpRow('Реинвестиция', invReinvest ? 'Иә' : 'Жоқ') +
    '</table>' +
    '<div style="font-size:17px;font-weight:800;margin:0 0 10px">Өсім (әр 6 айда)</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:12.5px">' +
      '<tr style="color:#5D6480;font-size:11.5px">' +
        '<th style="text-align:left;padding-bottom:6px">Ай</th>' +
        '<th style="text-align:right;padding-bottom:6px">Салынған</th>' +
        '<th style="text-align:right;padding-bottom:6px">Табыс</th>' +
        '<th style="text-align:right;padding-bottom:6px">Сома</th></tr>' + body +
    '</table>');
  exportPdf(html, 'qarzhy-investitsiya-' + todayISO() + '.pdf');
}
function exportInvXlsx(){
  var d = invRows();
  if(d.n <= 0 || (d.P <= 0 && d.M <= 0)){ toast('Мәндерді толтырыңыз.'); return; }
  var rows = [
    ['Инвестиция есебі'], ['Жасалған күні', fullDate(todayISO())], [],
    ['Бастапқы салым', d.P], ['Ай сайынғы толықтыру', d.M],
    ['Жылдық мөлшерлеме, %', d.rate], ['Мерзімі, ай', d.n],
    ['Реинвестиция', invReinvest ? 'Иә' : 'Жоқ'], ['Валюта', d.cur], [],
    ['Соңғы сома', Math.round(d.bal)], ['Салынған', Math.round(d.inv)],
    ['Пайыздық табыс', Math.round(d.bal - d.inv)], [],
    ['Ай', 'Салынған', 'Табыс', 'Сома']
  ];
  d.rows.forEach(function(x){
    rows.push([x.m, Math.round(x.inv), Math.round(x.bal - x.inv), Math.round(x.bal)]);
  });
  exportXlsx([{ name: 'Инвестиция', rows: rows }], 'qarzhy-investitsiya-' + todayISO() + '.xlsx');
}

/* ================= НЕСИЕ ================= */
function loanRows(){
  var S = num('l-sum');
  var n = loanUnit === 'year' ? Math.round(num('l-term') * 12) : Math.round(num('l-term'));
  var rate = num('l-rate'), i = rate / 12 / 100;
  var early = num('l-early'), earlyM = Math.round(num('l-early-m'));
  var basePay = loanType === 'ann' ? annuity(S, i, n) : 0;
  var principalPart = S / n;
  var bal = S, total = 0, interest = 0, first = 0, rows = [];
  for(var m = 1; m <= n * 2 && bal > 0.5; m++){
    var int_ = bal * i, pr, pay;
    if(loanType === 'ann'){ pay = Math.min(basePay, bal + int_); pr = pay - int_; }
    else { pr = Math.min(principalPart, bal); pay = pr + int_; }
    bal -= pr;
    if(early > 0 && earlyM === m){ var e = Math.min(early, bal); bal -= e; pay += e; }
    total += pay; interest += int_;
    if(m === 1) first = pay;
    rows.push({ m: m, pay: pay, int: int_, pr: pr, bal: Math.max(0, bal) });
  }
  return { rows: rows, S: S, n: n, rate: rate, total: total, interest: interest,
           first: first, months: rows.length, early: early, earlyM: earlyM };
}
function exportLoanXlsx(){
  var d = loanRows();
  if(d.S <= 0 || d.n <= 0){ toast('Мәндерді толтырыңыз.'); return; }
  var rows = [
    ['Несие төлем кестесі'], ['Жасалған күні', fullDate(todayISO())], [],
    ['Несие сомасы', d.S], ['Мерзімі, ай', d.n], ['Жылдық мөлшерлеме, %', d.rate],
    ['Түрі', loanType === 'ann' ? 'Аннуитетті' : 'Дифференциалды'], [],
    ['Ай сайынғы төлем', Math.round(d.first)],
    ['Барлық төлем', Math.round(d.total)],
    ['Артық төлем', Math.round(d.interest)], [],
    ['Ай', 'Төлем', 'Пайыз', 'Негізгі қарыз', 'Қалдық']
  ];
  d.rows.forEach(function(x){
    rows.push([x.m, Math.round(x.pay), Math.round(x.int), Math.round(x.pr), Math.round(x.bal)]);
  });
  exportXlsx([{ name: 'Несие', rows: rows }], 'qarzhy-nesie-' + todayISO() + '.xlsx');
}

/* ================= ДЕПОЗИТ ================= */
function depRows(){
  var P = num('dp-sum'), M = num('dp-add'), r = num('dp-rate') / 100, n = Math.round(num('dp-term'));
  var i = r / 12, bal = P, base = P, acc2 = 0, rows = [];
  for(var m = 1; m <= n; m++){
    if(depCap){ bal = bal * (1 + i) + M; }
    else { acc2 += base * i; base += M; bal = base + acc2; }
    rows.push({ m: m, inv: P + M * m, bal: bal });
  }
  return { rows: rows, P: P, M: M, n: n, rate: num('dp-rate'), bal: bal, inv: P + M * n };
}
function exportDepPdf(){
  var d = depRows();
  if(d.P <= 0 || d.n <= 0){ toast('Мәндерді толтырыңыз.'); return; }
  var body = '';
  d.rows.forEach(function(x){
    if(x.m % 3 !== 0 && x.m !== d.n) return;
    body += '<tr>' +
      '<td style="padding:7px 0;border-bottom:1px solid #EEF1FA;color:#5D6480">' + x.m + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #EEF1FA;text-align:right">' + nf(x.inv) + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #EEF1FA;text-align:right;color:#0B9F72">' + nf(x.bal - x.inv) + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #EEF1FA;text-align:right;font-weight:700">' + nf(x.bal) + '</td></tr>';
  });
  var html = calcWrap(
    calcHead('Депозит есебі', d.n + ' ай · жылдық ' + d.rate + '%' + (depCap ? ' · капитализациямен' : '')) +
    calcCards([
      { label: 'Мерзім соңында', value: money(d.bal), bg: '#EBEEFF', fg: '#2338E6' },
      { label: 'Салынған', value: money(d.inv), bg: '#F4F6FF', fg: '#0D1226' },
      { label: 'Пайыздық табыс', value: money(d.bal - d.inv), bg: '#EAFBF4', fg: '#0B9F72' }
    ]) +
    '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:24px">' +
      rpRow('Салым сомасы', money(d.P)) +
      rpRow('Ай сайынғы толықтыру', money(d.M)) +
      rpRow('Мерзімі', d.n + ' ай') +
      rpRow('Капитализация', depCap ? 'Ай сайын' : 'Жоқ') +
    '</table>' +
    '<div style="font-size:17px;font-weight:800;margin:0 0 10px">Өсім (әр 3 айда)</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:12.5px">' +
      '<tr style="color:#5D6480;font-size:11.5px">' +
        '<th style="text-align:left;padding-bottom:6px">Ай</th>' +
        '<th style="text-align:right;padding-bottom:6px">Салынған</th>' +
        '<th style="text-align:right;padding-bottom:6px">Табыс</th>' +
        '<th style="text-align:right;padding-bottom:6px">Сома</th></tr>' + body +
    '</table>');
  exportPdf(html, 'qarzhy-depozit-' + todayISO() + '.pdf');
}
function exportDepXlsx(){
  var d = depRows();
  if(d.P <= 0 || d.n <= 0){ toast('Мәндерді толтырыңыз.'); return; }
  var rows = [
    ['Депозит есебі'], ['Жасалған күні', fullDate(todayISO())], [],
    ['Салым сомасы', d.P], ['Ай сайынғы толықтыру', d.M],
    ['Жылдық мөлшерлеме, %', d.rate], ['Мерзімі, ай', d.n],
    ['Капитализация', depCap ? 'Ай сайын' : 'Жоқ'], [],
    ['Мерзім соңында', Math.round(d.bal)], ['Салынған', Math.round(d.inv)],
    ['Пайыздық табыс', Math.round(d.bal - d.inv)], [],
    ['Ай', 'Салынған', 'Табыс', 'Сома']
  ];
  d.rows.forEach(function(x){
    rows.push([x.m, Math.round(x.inv), Math.round(x.bal - x.inv), Math.round(x.bal)]);
  });
  exportXlsx([{ name: 'Депозит', rows: rows }], 'qarzhy-depozit-' + todayISO() + '.xlsx');
}

/* ================= САЛЫҚ ================= */
function taxCalc(){
  var income = num('tx-income'), rate = num('tx-rate');
  var mrp = num('tx-mrp') || 4325, mzp = num('tx-mzp') || 85000;
  var declared = num('tx-declared') || mzp;
  var months = Math.round(num('tx-months')) || 6;
  if(declared < mzp) declared = mzp;
  var total = income * rate / 100, ipn = total / 2, sn = total / 2;
  var opv = declared * 0.10 * months, so = declared * 0.035 * months;
  var vosms = 1.4 * mzp * 0.05 * months;
  var snPay = Math.max(0, sn - so);
  return { income: income, rate: rate, months: months, declared: declared, mrp: mrp, mzp: mzp,
           total: total, ipn: ipn, sn: sn, snPay: snPay, opv: opv, so: so, vosms: vosms,
           sum: ipn + snPay + opv + so + vosms };
}
function exportTaxPdf(){
  var d = taxCalc();
  if(d.income <= 0){ toast('Табысты жазыңыз.'); return; }
  var html = calcWrap(
    calcHead('Салық есебі', 'ЖК · оңайлатылған декларация · ' + d.months + ' ай') +
    calcCards([
      { label: 'Барлығы төлеу керек', value: money(d.sum), bg: '#FFEFF1', fg: '#E5384F' },
      { label: 'Табыс', value: money(d.income), bg: '#F4F6FF', fg: '#0D1226' },
      { label: 'Қолда қалады', value: money(d.income - d.sum), bg: '#EAFBF4', fg: '#0B9F72' }
    ]) +
    '<div style="font-size:17px;font-weight:800;margin:0 0 10px">Салық</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:22px">' +
      rpRow('Салық (' + d.rate + '%)', money(d.total)) +
      rpRow('ИПН', money(d.ipn)) +
      rpRow('Әлеуметтік салық', money(d.sn)) +
      rpRow('ӘС минус ӘА, төленеді', money(d.snPay)) +
    '</table>' +
    '<div style="font-size:17px;font-weight:800;margin:0 0 10px">Өз атыңызға аударымдар</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:22px">' +
      rpRow('ОПВ · 10%', money(d.opv)) +
      rpRow('ӘА · 3,5%', money(d.so)) +
      rpRow('ӘМСЖ · 1,4 МЗП × 5%', money(d.vosms)) +
      rpRow('Жарияланған табыс', money(d.declared) + ' × ' + d.months + ' ай') +
    '</table>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13.5px">' +
      rpRow('Салық жүктемесі', (d.sum / d.income * 100).toFixed(1) + '%') +
      rpRow('Айына бөлгенде', money(d.sum / d.months)) +
      rpRow('МРП / МЗП', nf(d.mrp) + ' ₸ / ' + nf(d.mzp) + ' ₸') +
    '</table>');
  exportPdf(html, 'qarzhy-salyq-' + todayISO() + '.pdf');
}
function exportTaxXlsx(){
  var d = taxCalc();
  if(d.income <= 0){ toast('Табысты жазыңыз.'); return; }
  var rows = [
    ['Салық есебі · ЖК оңайлатылған'], ['Жасалған күні', fullDate(todayISO())], [],
    ['Кезеңдегі табыс', d.income], ['Кезең, ай', d.months],
    ['Салық мөлшерлемесі, %', d.rate], ['Жарияланған айлық табыс', d.declared],
    ['МРП', d.mrp], ['МЗП', d.mzp], [],
    ['Салық барлығы', Math.round(d.total)],
    ['ИПН', Math.round(d.ipn)],
    ['Әлеуметтік салық', Math.round(d.sn)],
    ['ӘС төленетін', Math.round(d.snPay)],
    ['ОПВ', Math.round(d.opv)],
    ['ӘА', Math.round(d.so)],
    ['ӘМСЖ', Math.round(d.vosms)], [],
    ['БАРЛЫҒЫ ТӨЛЕУ КЕРЕК', Math.round(d.sum)],
    ['Қолда қалады', Math.round(d.income - d.sum)],
    ['Салық жүктемесі, %', +(d.sum / d.income * 100).toFixed(1)],
    ['Айына', Math.round(d.sum / d.months)]
  ];
  exportXlsx([{ name: 'Салық', rows: rows }], 'qarzhy-salyq-' + todayISO() + '.xlsx');
}

/* ================= ОПЕРАЦИЯЛАРДЫ EXCEL-ГЕ ================= */
function exportOpsXlsx(){
  var list = DB.tx.filter(function(t){ return inRange(t.date); })
    .sort(function(a, b){ return a.date < b.date ? 1 : -1; });
  if(!list.length){ toast('Бұл кезеңде дерек жоқ.'); return; }
  var rows = [['Күні', 'Түрі', 'Санат', 'Сома', 'Шот', 'Түсініктеме']];
  list.forEach(function(t){
    var a = acc(t.acc);
    rows.push([t.date, t.type === 'in' ? 'Кіріс' : (t.type === 'out' ? 'Шығын' : 'Аударым'),
      t.cat || '', Math.round(t.amt), a ? a.name : '', t.note || '']);
  });
  var sIn = 0, sOut = 0;
  list.forEach(function(t){ if(t.type === 'in') sIn += t.amt; else if(t.type === 'out') sOut += t.amt; });
  var sum = [['Қаржы есебі'], ['Кезең', fullDate(range.from) + ' — ' + fullDate(range.to)], [],
    ['Кіріс', Math.round(sIn)], ['Шығын', Math.round(sOut)], ['Нәтиже', Math.round(sIn - sOut)],
    ['Операция саны', list.length]];
  exportXlsx([{ name: 'Қорытынды', rows: sum }, { name: 'Операциялар', rows: rows }],
    'qarzhy-' + range.from + '_' + range.to + '.xlsx');
}

/* ================= САЛЫҚ КАЛЬКУЛЯТОРЫ (ЖК, оңайлатылған) ================= */
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

/* ================= ЖАЛАҚЫНЫ ПАЙЫЗБЕН БӨЛУ ================= */
/* Жоспар (жалақы мен бөлімдер) DB.split ішінде сақталады — қосымшаны жапқанда да қалады */
var SPLIT_DEF = [
  { name: 'Қажеттілік', pct: 50 },
  { name: 'Инвестиция', pct: 20 },
  { name: 'Жинақ',      pct: 20 },
  { name: 'Өзіме',      pct: 10 }
];
var SPLIT_COL = ['#2338E6', '#D9860B', '#0B9F72', '#6D3FE8', '#E5384F', '#0AA5C2', '#F0913C', '#7A8199'];
var SPLIT = null, splitTimer = null;

function splitInit(){
  if(SPLIT) return;
  var s = DB.split;
  var items = (s && s.items && s.items.length) ? s.items : SPLIT_DEF;
  SPLIT = {
    sum: (s && s.sum) || 0,
    src: (s && s.src) || null,
    applied: (s && s.applied) || null,
    items: items.map(function(x){ return { name: String(x.name || ''), pct: +x.pct || 0, to: x.to || '' }; })
  };
}
function splitCommit(){
  if(splitTimer){ clearTimeout(splitTimer); splitTimer = null; }
  if(!SPLIT) return;
  DB.split = {
    sum: SPLIT.sum, src: SPLIT.src, applied: SPLIT.applied,
    items: SPLIT.items.map(function(x){ return { name: x.name, pct: x.pct, to: x.to || '' }; })
  };
  save();
}
function splitSaveSoon(){
  if(splitTimer) clearTimeout(splitTimer);
  splitTimer = setTimeout(splitCommit, 500);
}
function splitTotal(){
  var t = 0;
  SPLIT.items.forEach(function(x){ t += x.pct; });
  return Math.round(t * 100) / 100;
}
/* әр бөлімнің сомасы; пайыз 100 болса, теңгеге дөңгелектеу айырмасын ең үлкен бөлімге қосамыз */
function splitAmounts(){
  var sum = Math.round(SPLIT.sum || 0), big = 0;
  var a = SPLIT.items.map(function(x, i){
    if(x.pct > SPLIT.items[big].pct) big = i;
    return Math.round(sum * x.pct / 100);
  });
  if(a.length && splitTotal() === 100){
    var got = 0;
    a.forEach(function(v){ got += v; });
    a[big] += sum - got;
  }
  return a;
}

function openSplit(){
  if(splitTimer) splitCommit();
  SPLIT = null;
  splitInit();
  var si = document.getElementById('sp-sum');
  if(si) si.value = SPLIT.sum ? SPLIT.sum : '';
  renderSplit();
}
function renderSplit(){
  var box = document.getElementById('sp-list');
  if(!box || !SPLIT) return;
  var h = '';
  SPLIT.items.forEach(function(x, i){
    h += '<div class="card" style="padding:14px">' +
      '<div style="display:flex;gap:8px;align-items:center">' +
        '<input class="inp soft" id="sp-n-' + i + '" value="' + esc(x.name) + '" placeholder="Атауы" ' +
          'oninput="splitName(' + i + ',this.value)" style="margin:0;flex:1;min-width:0">' +
        '<input class="inp soft" id="sp-p-' + i + '" type="number" inputmode="decimal" value="' + x.pct + '" ' +
          'oninput="splitPct(' + i + ',this.value)" style="margin:0;width:76px;text-align:right">' +
        '<b>%</b>' +
        '<button class="btn line" onclick="splitDel(' + i + ')" aria-label="Өшіру" ' +
          'style="margin:0;width:44px;height:44px;padding:0">✕</button>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">' +
        '<span class="muted">Сома</span><b id="sp-a-' + i + '" style="font-size:17px"></b></div>' +
      '<div style="height:8px;background:var(--line);border-radius:99px;margin-top:8px;overflow:hidden">' +
        '<div id="sp-b-' + i + '" style="height:8px;width:0;background:' + SPLIT_COL[i % SPLIT_COL.length] +
          ';border-radius:99px;transition:width .2s"></div></div>' +
      '<select class="inp soft" onchange="splitTo(' + i + ',this.value)" style="margin:12px 0 0;padding:11px 12px">' +
        splitTargets(x) + '</select>' +
    '</div>';
  });
  box.innerHTML = h;
  drawSplitSrc();
  updateSplit();
}
/* бөлім қайда жіберіледі: мақсат, инвестиция шығыны немесе басқа шотқа аударым */
function splitTargets(x){
  var cur = x.to || '', ok = false, h = '';
  function opt(v, label){
    var on = (v === cur); if(on) ok = true;
    h += '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>';
  }
  opt('', tr('Тек есеп — ешқайда жіберілмейді'));
  (DB.goals || []).forEach(function(g){ opt('goal:' + g.id, tr('Мақсат') + ': ' + g.name); });
  opt('inv', tr('Инвестиция (шығын ретінде жазылады)'));
  accsOf('asset').forEach(function(a){ opt('acc:' + a.id, tr('Аударым') + ': ' + a.name); });
  if(!ok) x.to = '';
  return h;
}
function drawSplitSrc(){
  var box = document.getElementById('sp-src');
  if(!box || !SPLIT) return;
  box.innerHTML = '';
  var list = accsOf('asset');
  if(!list.length){ box.innerHTML = '<div class="muted">Алдымен шот қосыңыз</div>'; return; }
  var ok = false; list.forEach(function(a){ if(a.id === SPLIT.src) ok = true; });
  if(!ok) SPLIT.src = list[0].id;
  list.forEach(function(a){
    var b = document.createElement('button');
    b.className = 'chip' + (a.id === SPLIT.src ? ' on' : '');
    b.innerHTML = accIconHtml(a, 'chip-ic') + '<span>' + esc(a.name) + '</span>';
    b.onclick = function(){ SPLIT.src = a.id; splitSaveSoon(); drawSplitSrc(); };
    box.appendChild(b);
  });
}
function splitTo(i, v){
  if(!SPLIT || !SPLIT.items[i]) return;
  SPLIT.items[i].to = v;
  splitSaveSoon();
}
/* жоспарды орындау: байланысқан бөлімдердің ақшасы мақсатқа / инвестицияға / шотқа жіберіледі */
function splitApply(){
  var a = splitReady();
  if(!a) return;
  var src = acc(SPLIT.src);
  if(!src){ toast('Алдымен шот қосыңыз'); return; }
  var jobs = [];
  SPLIT.items.forEach(function(x, i){
    if(x.to && a[i] > 0) jobs.push({ x: x, v: a[i] });
  });
  if(!jobs.length){ toast('Ешбір бөлім мақсатқа не шотқа байланбаған.'); return; }
  var ym = todayISO().slice(0, 7);
  var msg = tr('Жалақы жоспары бойынша ақша жіберіледі. Жалғастырасыз ба?');
  if(SPLIT.applied === ym) msg = tr('Бұл айда жоспар орындалған. Қайта орындасаңыз ақша екінші рет жіберіледі. Жалғастырасыз ба?');
  if(!confirm(msg)) return;
  var done = 0;
  jobs.forEach(function(j){
    var to = j.x.to, v = j.v, note = tr('Жалақы жоспары') + ': ' + j.x.name;
    if(to.indexOf('goal:') === 0){
      var g = goal(to.slice(5));
      if(!g) return;
      src.bal -= toAcc(src, v);
      g.saved = (g.saved || 0) + v;
      g.hist = g.hist || [];
      g.hist.push({ date: todayISO(), acc: src.id, amt: v });
      done++;
    } else if(to === 'inv'){
      var t = { id: newId(), type: 'out', cat: 'Инвестиция', amt: v, date: todayISO(),
                note: note, acc: src.id, loan: null, to: null };
      DB.tx.push(t); applyTx(t, 1); done++;
    } else if(to.indexOf('acc:') === 0){
      var dst = acc(to.slice(4));
      if(!dst || dst.id === src.id) return;
      var t2 = { id: newId(), type: 'tr', cat: 'Аударым', amt: v, date: todayISO(),
                 note: note, acc: src.id, loan: null, to: dst.id };
      DB.tx.push(t2); applyTx(t2, 1); done++;
    }
  });
  SPLIT.applied = ym;
  splitCommit();
  render();
  toast(done + ' ' + tr('бөлім орындалды'));
}
function updateSplit(){
  if(!SPLIT) return;
  var a = splitAmounts(), tot = splitTotal(), sum = Math.round(SPLIT.sum || 0);
  a.forEach(function(v, i){
    var el = document.getElementById('sp-a-' + i);
    if(el) el.textContent = money(v);
    var b = document.getElementById('sp-b-' + i);
    if(b) b.style.width = Math.max(0, Math.min(100, SPLIT.items[i].pct)) + '%';
  });
  var t = document.getElementById('sp-total');
  if(!t) return;
  var diff = Math.round((100 - tot) * 100) / 100, txt, col;
  if(diff === 0){ txt = 'Барлығы 100% · толық бөлінді'; col = 'var(--pos)'; }
  else if(diff > 0){ txt = 'Барлығы ' + tot + '% · әлі ' + diff + '% бөлінбеген'; col = 'var(--neg)'; }
  else { txt = 'Барлығы ' + tot + '% · ' + (-diff) + '% артық'; col = 'var(--neg)'; }
  t.innerHTML = '<div class="res"><div class="lab">Жалақы</div><div class="big">' + money(sum) + '</div>' +
    '<div style="margin-top:8px;font-weight:700;font-size:13.5px;color:' + col + '">' + txt + '</div></div>';
}
function splitSum(){
  splitInit();
  SPLIT.sum = num('sp-sum');
  updateSplit();
  splitSaveSoon();
}
function splitName(i, v){
  if(!SPLIT || !SPLIT.items[i]) return;
  SPLIT.items[i].name = v;
  splitSaveSoon();
}
function splitPct(i, v){
  if(!SPLIT || !SPLIT.items[i]) return;
  var n = parseFloat(v);
  SPLIT.items[i].pct = isNaN(n) ? 0 : Math.max(0, n);
  updateSplit();
  splitSaveSoon();
}
function splitAdd(){
  splitInit();
  var left = Math.max(0, Math.round((100 - splitTotal()) * 100) / 100);
  SPLIT.items.push({ name: 'Жаңа бөлім', pct: left, to: '' });
  splitCommit();
  renderSplit();
}
function splitDel(i){
  if(!SPLIT || SPLIT.items.length <= 1){ toast('Кемінде бір бөлім қалуы керек.'); return; }
  SPLIT.items.splice(i, 1);
  splitCommit();
  renderSplit();
}
function splitReset(){
  splitInit();
  SPLIT.items = SPLIT_DEF.map(function(x){ return { name: x.name, pct: x.pct, to: '' }; });
  splitCommit();
  renderSplit();
}
function splitSaveBtn(){
  splitInit();
  splitCommit();
  toast('Жоспар сақталды.');
}
/* PDF/Excel үшін: жалақы жазылған және пайыз дәл 100 болуы керек */
function splitReady(){
  splitInit();
  if(!(SPLIT.sum > 0)){ toast('Жалақыны жазыңыз.'); return null; }
  if(splitTotal() !== 100){ toast('Пайыздың қосындысы 100% болуы керек.'); return null; }
  return splitAmounts();
}
function exportSplitPdf(){
  var a = splitReady();
  if(!a) return;
  var sum = Math.round(SPLIT.sum), bars = '';
  SPLIT.items.forEach(function(x, i){
    bars += rpBar(x.name || '—', money(a[i]), x.pct, SPLIT_COL[i % SPLIT_COL.length]);
  });
  var html = calcWrap(
    calcHead('Жалақы бөлу', 'Пайыздық жоспар · ' + a.length + ' бөлім') +
    calcCards([
      { label: 'Жалақы', value: money(sum), bg: '#F4F6FF', fg: '#0D1226' },
      { label: 'Бөлім саны', value: String(a.length), bg: '#EAFBF4', fg: '#0B9F72' }
    ]) + bars);
  exportPdf(html, 'qarzhy-zhalaqy-' + todayISO() + '.pdf');
}
function exportSplitXlsx(){
  var a = splitReady();
  if(!a) return;
  var sum = Math.round(SPLIT.sum);
  var rows = [['Жалақы бөлу'], ['Жасалған күні', fullDate(todayISO())], [], ['Жалақы', sum], [],
              ['Бөлім', 'Пайыз, %', 'Сома']];
  SPLIT.items.forEach(function(x, i){ rows.push([x.name, x.pct, a[i]]); });
  rows.push([], ['Барлығы', 100, sum]);
  exportXlsx([{ name: 'Жалақы бөлу', rows: rows }], 'qarzhy-zhalaqy-' + todayISO() + '.xlsx');
}

/* ================= КЭШБЭК ҚОРЫТЫНДЫСЫ ================= */
function drawCashback(){
  var card = document.getElementById('ov-cb-card'), box = document.getElementById('ov-cb');
  if(!card || !box) return;
  var all = 0, cnt = 0, mSum = 0, mCnt = 0, mOut = 0, pSum = 0;
  var p = new Date(cur.getFullYear(), cur.getMonth() - 1, 1), pKey = iso(p).slice(0, 7);
  DB.tx.forEach(function(t){
    if(t.type === 'in' && t.cat === 'Кэшбэк'){
      all += t.amt; cnt++;
      if(inMonth(t.date)){ mSum += t.amt; mCnt++; }
      if(t.date.slice(0, 7) === pKey) pSum += t.amt;
    } else if(t.type === 'out' && inMonth(t.date)){ mOut += t.amt; }
  });
  card.classList.toggle('hide', cnt === 0);
  if(!cnt){ box.innerHTML = ''; return; }
  box.innerHTML =
    '<div class="kv"><span>Осы айда қайтты</span><b style="color:var(--pos)">' + money(mSum) + '</b></div>' +
    '<div class="kv"><span>Өткен айда</span><b>' + money(pSum) + '</b></div>' +
    '<div class="kv"><span>Осы айдағы кэшбэк саны</span><b>' + mCnt + '</b></div>' +
    '<div class="kv"><span>Шығынның қанша пайызы қайтты</span><b>' + (mOut > 0 ? (Math.round(mSum / mOut * 1000) / 10).toString().replace('.', ',') + '%' : '—') + '</b></div>' +
    '<div class="kv"><span>Барлық уақытта</span><b>' + money(all) + '</b></div>';
}

/* ================= ҚАЙТАЛАНАТЫН ТӨЛЕМДЕР ================= */
/* DB.recur: { id, name, amt, day, cat, acc, paid:'YYYY-MM' } — paid айы біткенде өзі «төленбеген» болады */
var rcEdit = null, rcCat = 'Тұрғын үй', rcAcc = null;

function recurState(r){
  var now = new Date(), ym = iso(now).slice(0, 7);
  var last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  var due = iso(new Date(now.getFullYear(), now.getMonth(), Math.min(Math.max(1, +r.day || 1), last)));
  var paid = (r.paid === ym);
  var days = Math.round((parseISO(due) - parseISO(todayISO())) / 864e5);
  return { due: due, paid: paid, days: days, late: !paid && days < 0, soon: !paid && days >= 0 && days <= 3 };
}
function recurOf(id){ var r = null; (DB.recur || []).forEach(function(x){ if(x.id === id) r = x; }); return r; }

function openRecur(id){
  rcEdit = id || null;
  var r = id ? recurOf(id) : null;
  document.getElementById('rc-name').value = r ? r.name : '';
  document.getElementById('rc-amt').value = r ? r.amt : '';
  document.getElementById('rc-day').value = r ? r.day : '';
  document.getElementById('rc-title').textContent = r ? 'Төлемді түзету' : 'Жаңа төлем';
  document.getElementById('rc-del').classList.toggle('hide', !r);
  rcCat = r ? r.cat : 'Тұрғын үй';
  rcAcc = r ? r.acc : null;
  drawRcCats(); drawRcAccs();
  openSheet('sheet-recur');
}
function drawRcCats(){
  var box = document.getElementById('rc-cats'); box.innerHTML = '';
  CATS.out.forEach(function(c){
    var b = document.createElement('button');
    b.className = 'chip' + (c[0] === rcCat ? ' on' : '');
    b.innerHTML = catSvg('out', c[0], 'chip-ic') + '<span>' + c[0] + '</span>';
    b.onclick = function(){ rcCat = c[0]; drawRcCats(); };
    box.appendChild(b);
  });
}
function drawRcAccs(){
  var box = document.getElementById('rc-accs'); box.innerHTML = '';
  var list = accsOf('asset');
  var ok = false; list.forEach(function(a){ if(a.id === rcAcc) ok = true; });
  if(!ok) rcAcc = list.length ? list[0].id : null;
  list.forEach(function(a){
    var b = document.createElement('button');
    b.className = 'chip' + (a.id === rcAcc ? ' on' : '');
    b.innerHTML = accIconHtml(a, 'chip-ic') + '<span>' + esc(a.name) + '</span>';
    b.onclick = function(){ rcAcc = a.id; drawRcAccs(); };
    box.appendChild(b);
  });
}
function saveRecur(){
  var name = document.getElementById('rc-name').value.trim();
  var amt = parseFloat(document.getElementById('rc-amt').value);
  var day = Math.round(parseFloat(document.getElementById('rc-day').value));
  if(!name){ toast('Атауын жазыңыз'); return; }
  if(!amt || amt <= 0){ toast('Соманы жазыңыз'); return; }
  if(!day || day < 1 || day > 31){ toast('Айдың қай күні екенін жазыңыз (1–31)'); return; }
  if(!DB.recur) DB.recur = [];
  var r = rcEdit ? recurOf(rcEdit) : null;
  if(r){ r.name = name; r.amt = amt; r.day = day; r.cat = rcCat; r.acc = rcAcc; }
  else DB.recur.push({ id: newId(), name: name, amt: amt, day: day, cat: rcCat, acc: rcAcc, paid: null });
  rcEdit = null;
  save(); closeSheets(); render(); toast('Сақталды');
}
function delRecur(){
  if(!rcEdit) return;
  if(!confirm(tr('Төлем тізімнен өшіріледі. Бұрын жазылған операциялар қалады. Жалғастырасыз ба?'))) return;
  DB.recur = (DB.recur || []).filter(function(x){ return x.id !== rcEdit; });
  rcEdit = null;
  save(); closeSheets(); render(); toast('Өшірілді');
}
function payRecur(id){
  var r = recurOf(id); if(!r) return;
  var a = acc(r.acc) || accsOf('asset')[0];
  if(!a){ toast('Алдымен шот қосыңыз'); return; }
  var t = { id: newId(), type: 'out', cat: r.cat, amt: r.amt, date: todayISO(),
            note: r.name, acc: a.id, loan: null, to: null };
  DB.tx.push(t); applyTx(t, 1);
  r.paid = todayISO().slice(0, 7);
  save(); render(); toast('Төлем жазылды');
}
function drawRecur(){
  var box = document.getElementById('rc-list');
  if(!box) return;
  var list = (DB.recur || []).slice().sort(function(a, b){
    var sa = recurState(a), sb = recurState(b);
    if(sa.paid !== sb.paid) return sa.paid ? 1 : -1;
    return sa.due < sb.due ? -1 : 1;
  });
  var total = 0, left = 0;
  list.forEach(function(r){ total += r.amt; if(!recurState(r).paid) left += r.amt; });
  var te = document.getElementById('rc-total'), le = document.getElementById('rc-left');
  if(te) te.textContent = money(total);
  if(le) le.textContent = money(left);
  box.innerHTML = '';
  if(!list.length){
    box.innerHTML = '<div class="empty">Төлем әлі жоқ.<br>Жалға алу, несие, жазылым сияқты ай сайынғы төлемдерді қосыңыз.</div>';
    return;
  }
  list.forEach(function(r){
    var st = recurState(r);
    var el = document.createElement('div');
    el.className = 'row';
    el.style.display = 'block';
    el.style.padding = '13px 2px';
    el.onclick = function(){ openRecur(r.id); };
    var badge = st.paid ? ' <span class="badge" style="background:var(--pos);color:#fff">' + tr('төленді') + '</span>'
              : st.late ? ' <span class="badge">' + tr('мерзімі өтті') + '</span>'
              : st.soon ? ' <span class="badge">' + (st.days === 0 ? tr('бүгін') : st.days + ' ' + tr('күннен кейін')) + '</span>' : '';
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:11px">' +
        '<div class="ico' + (st.paid ? ' pos' : (st.late ? ' red' : '')) + '">' + svgIcon(st.paid ? 'target' : 'clock') + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="name">' + esc(r.name) + badge + '</div>' +
          '<div class="sub2">' + fullDate(st.due) + ' · ' + esc(r.cat) + '</div>' +
        '</div>' +
        '<div class="amt">' + money(r.amt) + '</div>' +
      '</div>' +
      (st.paid ? '' : '<button class="btn line" style="margin:10px 0 0;padding:10px" ' +
        'onclick="event.stopPropagation();payRecur(\'' + r.id + '\')">' + tr('Төледім') + '</button>');
    box.appendChild(el);
  });
}
/* басты беттегі ескерту: мерзімі өткен немесе 3 күн ішінде келетін төлемдер */
function recurWarn(){
  var late = [], soon = [];
  (DB.recur || []).forEach(function(r){
    var st = recurState(r);
    if(st.late) late.push(r.name); else if(st.soon) soon.push(r.name + ' (' + (st.days === 0 ? tr('бүгін') : st.days + ' ' + tr('күннен кейін')) + ')');
  });
  var h = '';
  if(late.length) h += '<div class="warnbar danger" onclick="go(\'recur\')"><b>Төлем мерзімі өтті</b>' + esc(late.join(', ')) + '</div>';
  if(soon.length) h += '<div class="warnbar" onclick="go(\'recur\')"><b>Төлем жақындады</b>' + esc(soon.join(', ')) + '</div>';
  return h;
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
    '<div style="height:8px;background:#EBEEFF;border-radius:99px;overflow:hidden">' +
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
  accsOf('debt').forEach(function(a){
    accRows += rpRow(esc(a.name) + ' · несие', money(a.bal), '#E5384F');
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
        '<td style="padding:9px 0;border-bottom:1px solid #E4E8F7;text-align:right;font-weight:700;color:#E5384F">' +
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
        '<td style="padding:11px 0;text-align:right;font-weight:800;font-size:15px;color:#E5384F">' +
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
      money(left), d.dir === 'out' ? '#0B9F72' : '#E5384F');
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
        esc(t.cat) + (t.note ? ' <span style="color:#5D6480">· ' + esc(t.note.slice(0, 28)) + '</span>' : '') + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #E4E8F7;font-size:12px;color:#5D6480;white-space:nowrap">' +
        (a ? esc(a.name) : '—') + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #E4E8F7;text-align:right;font-weight:700;white-space:nowrap;' +
        'color:' + (t.type === 'in' ? '#0B9F72' : '#E5384F') + '">' +
        (t.type === 'in' ? '+' : '−') + nf(t.amt) + ' ₸</td></tr>';
  });

  var net = sIn - sOut;
  var rate = sIn > 0 ? Math.round(net / sIn * 100) : 0;

  return '' +
  '<div style="width:794px;padding:44px 46px;background:#fff;color:#0D1226;' +
       'font-family:Inter,-apple-system,Roboto,Arial,sans-serif;box-sizing:border-box">' +

    /* тақырып */
    '<div style="display:flex;align-items:center;gap:16px;padding-bottom:22px;border-bottom:3px solid #2338E6">' +
      '<div style="width:54px;height:54px;border-radius:16px;background:#2338E6;color:#fff;' +
           'display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800">Қ</div>' +
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
        '<div style="font-size:23px;font-weight:800;color:#0B9F72;margin-top:4px">' + money(sIn) + '</div></div>' +
      '<div style="flex:1;background:#FFEFF1;border-radius:16px;padding:18px">' +
        '<div style="color:#5D6480;font-size:13px">Шығын</div>' +
        '<div style="font-size:23px;font-weight:800;color:#E5384F;margin-top:4px">' + money(sOut) + '</div></div>' +
      '<div style="flex:1;background:#EBEEFF;border-radius:16px;padding:18px">' +
        '<div style="color:#5D6480;font-size:13px">Нәтиже</div>' +
        '<div style="font-size:23px;font-weight:800;color:#2338E6;margin-top:4px">' +
          (net >= 0 ? '+' : '') + money(net) + '</div></div>' +
    '</div>' +
    '<div style="color:#5D6480;font-size:13px;margin-bottom:26px">' +
      'Жинақ үлесі: <b style="color:#0D1226">' + (sIn > 0 ? rate + '%' : '—') + '</b> · ' +
      'операция саны: <b style="color:#0D1226">' + list.length + '</b></div>' +

    /* капитал */
    '<div style="font-size:17px;font-weight:800;margin:0 0 10px">Қаржылық жағдай</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:26px">' +
      rpRow('Банктердегі ақша', money(T.banks), '#0B9F72') +
      (T.goals ? rpRow('Мақсаттарда жиналған', money(T.goals), '#6D3FE8') : '') +
      rpRow('Міндеттемелер · несиелер', money(T.debts), '#E5384F') +
      (T.lent ? rpRow('Маған қарыз', money(T.lent), '#0B9F72') : '') +
      (T.owed ? rpRow('Мен қарызбын', money(T.owed), '#E5384F') : '') +
      rpRow('<b style="color:#0D1226">Таза капитал</b>', '<span style="font-size:15px">' + money(T.net) + '</span>') +
      (T.invested ? rpRow('Салынған инвестиция (барлық уақыт)', money(T.invested), '#6D3FE8') : '') +
    '</table>' +

    /* санаттар */
    '<div style="display:flex;gap:30px;margin-bottom:26px">' +
      '<div style="flex:1">' +
        '<div style="font-size:17px;font-weight:800;margin:0 0 12px">Шығын санаттары</div>' +
        cats('out', sOut, 'linear-gradient(90deg,#FFA8B3,#E5384F)') + '</div>' +
      '<div style="flex:1">' +
        '<div style="font-size:17px;font-weight:800;margin:0 0 12px">Кіріс көздері</div>' +
        cats('in', sIn, 'linear-gradient(90deg,#7CF2CE,#0B9F72)') + '</div>' +
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
    DB.tx.forEach(function(t){ if(SEL.ids[t.id]) applyTx(t, -1); });
    DB.tx = DB.tx.filter(function(t){ return !SEL.ids[t.id]; });
  } else if(SEL.kind === 'btx'){
    DB.btx = (DB.btx || []).filter(function(b){ return !SEL.ids[b.id]; });
  } else if(SEL.kind === 'debt'){
    (DB.debts || []).forEach(function(d){
      if(!SEL.ids[d.id]) return;
      var a = acc(d.acc);
      if(a) a.bal += toAcc(a, d.dir === 'out' ? d.amt : -d.amt);
      (d.hist || []).forEach(function(x){
        var pa = acc(x.acc);
        if(pa) pa.bal += toAcc(pa, d.dir === 'out' ? -x.amt : x.amt);
      });
    });
    DB.debts = (DB.debts || []).filter(function(d){ return !SEL.ids[d.id]; });
  }
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
  var scb = document.getElementById('sel-cat-btn');
  if(scb) scb.classList.toggle('hide', SEL.kind !== 'tx');
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

/* екі валютаны бір жолға жазу: «1 507 $ · 184 ₸» */
function curPair(m, skipZero){
  var out = [];
  if(m.USD || !skipZero) out.push(nf(m.USD) + ' $');
  if(m.KZT || !skipZero) out.push(nf(m.KZT) + ' ₸');
  return out.length ? out.join(' · ') : '0 ₸';
}

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
  if(!storageOK()){
    html+='<div class="warnbar danger"><b>Дерек сақталмайды</b>'+
      'Браузер жадына жазу мүмкін емес. Chrome-ды жеке (инкогнито) режимде ашпаңыз.</div>';
  }
  var d=daysSinceBackup();
  if(d===null && DB.tx.length>5){
    html+='<div class="warnbar"><b>Көшірме жасаңыз</b>Дерек тек осы браузерде тұр. '+
      'Баптау → Деректі сақтау арқылы сақтап қойыңыз.</div>';
  } else if(d!==null && d>=30){
    html+='<div class="warnbar"><b>Көшірме ескірді</b>Соңғы көшірмеден '+d+' күн өтті. Жаңартып қойыңыз.</div>';
  }
  var dt2 = debtTotals();
  if(dt2.overdue){
    html+='<div class="warnbar"><b>Қарыз мерзімі өтті</b>'+dt2.overdue+
      ' жазбаның қайтару мерзімі өтіп кетті. Қарыздар бөлімінен қараңыз.</div>';
  }
  html+=recurWarn();
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
  dups.forEach(function(t){ applyTx(t,-1); });
  var ids={}; dups.forEach(function(t){ ids[t.id]=1; });
  DB.tx=DB.tx.filter(function(t){ return !ids[t.id]; });
  save(); render(); toast(dups.length+' операция өшірілді');
}

/* ================= АРТҚА ҚАЙТУ ================= */
/* қай бетте тұрғанымызды есте сақтау — жаңартқанда сол жерде қаламыз */
function saveView(){
  try{
    localStorage.setItem('qarzhy_view', JSON.stringify({
      v: view, br: (typeof brId !== 'undefined' ? brId : null),
      y: Math.round(window.scrollY || 0)
    }));
  }catch(e){}
}
function restoreView(){
  var st = null;
  try{ st = JSON.parse(localStorage.getItem('qarzhy_view') || 'null'); }catch(e){}
  var h = (location.hash || '').replace('#','');
  var v = h || (st && st.v) || 'home';

  if(!document.getElementById('p-' + v)) v = 'home';

  if(v !== 'home') go(v, true);
  try{ history.replaceState({ v: v }, '', '#' + v); }catch(e){}

  if(st && st.y && st.v === v){
    setTimeout(function(){ window.scrollTo(0, st.y); }, 60);
  }
}

function initHistory(){
  if(!(history && history.replaceState)) return;
  /* бетті жаңартқанда ағымдағы бет сақталсын — хэшті «home»-ға ауыстырмаймыз */
  var h0 = (location.hash || '').replace('#','');
  if(!h0 || !document.getElementById('p-' + h0)){
    var st0 = null;
    try{ st0 = JSON.parse(localStorage.getItem('qarzhy_view') || 'null'); }catch(e){}
    h0 = (st0 && st0.v && document.getElementById('p-' + st0.v)) ? st0.v : 'home';
  }
  history.replaceState({ v: h0 }, '', '#' + h0);
  window.addEventListener('popstate', function(e){
    var st = e.state || { v: 'home' };
    if(!st.sheet && sheetOpen()) closeSheets(true);
    if(st.v && st.v !== view) go(st.v, true);
  });
}

/* ================= START ================= */
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
}
/* role="button" элементтері пернетақтамен де басылсын */
function bindKeyActivate(){
  document.addEventListener('keydown', function(e){
    var el = e.target;
    if((e.key === 'Enter' || e.key === ' ') && el && el.getAttribute && el.getAttribute('role') === 'button'){
      e.preventDefault(); el.click();
    }
  });
}
function boot(){
  if(!DB.pref) DB.pref = {};
  if(DB.pref.brandV !== 3){ DB.skin = 'coral'; DB.pref.brandV = 3; save(); }
  migrateBrokers();
  bindKeyActivate();
  initHistory();
  autoSnapshot();
  loadSnaps();
  askPersist();
  refreshStorage();
  bindExitSave();
  applyTheme();
  watchSystemTheme();
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

/* ================= 1. ТОПТАП САНАТ ӨЗГЕРТУ ================= */
function selCatOpen(){
  if(!selCount()){ toast('Ештеңе таңдалмаған'); return; }
  var box = document.getElementById('selcat-list'); if(!box) return;
  var types = {};
  DB.tx.forEach(function(t){ if(SEL.ids[t.id] && t.type !== 'tr') types[t.type] = 1; });
  box.innerHTML = '';
  ['out','in'].forEach(function(tp){
    if(!types[tp]) return;
    var h = document.createElement('label'); h.className = 'f';
    h.textContent = tp === 'out' ? 'Шығын санаттары' : 'Кіріс санаттары';
    box.appendChild(h);
    var g = document.createElement('div'); g.className = 'catgrid';
    CATS[tp].forEach(function(c){
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ctile';
      b.style.setProperty('--cc', catColor(tp, c[0]));
      b.innerHTML = '<span class="ct-i">' + catSvg(tp, c[0]) + '</span><span class="ct-l">' + tr(c[0]) + '</span>';
      b.onclick = function(){ selCatApply(tp, c[0]); };
      g.appendChild(b);
    });
    box.appendChild(g);
  });
  if(!box.children.length){ toast('Аударымдардың санаты болмайды'); return; }
  openSheet('sheet-selcat');
}
function selCatApply(tp, cat){
  var n = 0;
  DB.tx.forEach(function(t){
    if(SEL.ids[t.id] && t.type === tp){ t.cat = cat; n++; learnCat(t.type, t.note, cat); }
  });
  save(); closeSheets();
  SEL.on = false; SEL.ids = {};
  render();
  toast(n + ' операция «' + tr(cat) + '» санатына ауысты');
}

/* ================= 2. КҮНДІК ЛИМИТ ================= */
function dailyInfo(){
  var plan = DB.pref && DB.pref.monthPlan;
  if(!plan) return null;
  var n = new Date(), ym = todayISO().slice(0, 7), td = todayISO();
  var spent = 0, today = 0;
  DB.tx.forEach(function(t){
    if(t.type !== 'out' || t.date.slice(0, 7) !== ym) return;
    spent += t.amt; if(t.date === td) today += t.amt;
  });
  var dim = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
  var daysLeft = dim - n.getDate() + 1;
  var perDay = Math.max(0, (plan - (spent - today)) / daysLeft);
  return { plan: plan, spent: spent, today: today, perDay: perDay, leftToday: perDay - today,
           daysLeft: daysLeft, remain: plan - spent };
}
function drawDaily(){
  var box = document.getElementById('home-daily'); if(!box) return;
  var d = dailyInfo();
  if(!d){
    box.innerHTML = '<button class="tip" onclick="openPlan()">' + svgIcon('target') +
      '<span><b>Күндік лимитті қосыңыз</b><br>Айлық шығын жоспарын жазсаңыз, күнде қанша жұмсауға болатыны есептеледі</span><i>›</i></button>';
    return;
  }
  var pct = Math.min(100, Math.round(d.spent / d.plan * 100));
  var over = d.leftToday < 0;
  box.innerHTML = '<div class="card daily" role="button" tabindex="0" onclick="openPlan()">' +
    '<div class="dl-top"><span>' + tr('Бүгін жұмсауға болады') + '</span><small>' + d.daysLeft + ' ' + tr('күн қалды') + '</small></div>' +
    '<div class="dl-v" style="color:' + (over ? 'var(--neg)' : 'var(--pos)') + '">' + (over ? '−' : '') + money(Math.abs(Math.round(d.leftToday))) + '</div>' +
    '<div class="dl-sub">' + (over ? tr('Бүгінгі лимиттен асып кетті') : tr('Бүгін жұмсалды') + ': ' + money(d.today)) +
      ' · ' + tr('күніне') + ' ~' + money(Math.round(d.perDay)) + '</div>' +
    '<div class="track" style="margin-top:12px"><div class="fill' + (pct >= 100 ? ' neg' : '') + '" style="width:' + pct + '%"></div></div>' +
    '<div class="dl-foot"><span>' + tr('Айлық жоспар') + ' ' + money(d.plan) + '</span><span>' + tr('Қалды') + ' ' + money(Math.max(0, d.remain)) + '</span></div>' +
  '</div>';
}
function openPlan(){
  var v = DB.pref && DB.pref.monthPlan;
  document.getElementById('plan-amt').value = v || '';
  /* ұсыныс: соңғы 3 айдың орташа шығыны */
  var n = new Date(), sum = 0;
  for(var i = 1; i <= 3; i++){
    var d = new Date(n.getFullYear(), n.getMonth() - i, 1), ym = iso(d).slice(0, 7);
    DB.tx.forEach(function(t){ if(t.type === 'out' && t.date.slice(0, 7) === ym) sum += t.amt; });
  }
  var avg = Math.round(sum / 3 / 1000) * 1000;
  document.getElementById('plan-hint').textContent = avg ? tr('Соңғы 3 айдың орташа шығыны') + ': ' + money(avg) : '';
  document.getElementById('plan-del').classList.toggle('hide', !v);
  openSheet('sheet-plan');
}
function savePlan(){
  var v = parseFloat(document.getElementById('plan-amt').value);
  if(!v || v <= 0){ toast('Соманы жазыңыз'); return; }
  if(!DB.pref) DB.pref = {};
  DB.pref.monthPlan = Math.round(v);
  save(); closeSheets(); render(); toast('Сақталды');
}
function delPlan(){
  if(DB.pref) delete DB.pref.monthPlan;
  save(); closeSheets(); render(); toast('Күндік лимит өшірілді');
}

/* ================= 3. ЖАЗЫЛЫМДАРДЫ ТАБУ ================= */
function findSubs(){
  var n = new Date(), since = iso(new Date(n.getFullYear(), n.getMonth() - 6, 1));
  var recent = iso(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 45));
  var groups = {};
  DB.tx.forEach(function(t){
    if(t.type !== 'out' || t.date < since || !t.note) return;
    var k = merchKey(t.note); if(!k) return;
    (groups[k] = groups[k] || []).push(t);
  });
  var no = (DB.pref && DB.pref.subsNo) || {};
  var have = {};
  (DB.recur || []).forEach(function(r){ have[merchKey(r.name)] = 1; });
  var out = [];
  Object.keys(groups).forEach(function(k){
    if(no[k] || have[k]) return;
    var list = groups[k];
    var byM = {};
    list.forEach(function(t){ var m = t.date.slice(0, 7); (byM[m] = byM[m] || []).push(t); });
    var months = Object.keys(byM);
    if(months.length < 3) return;
    /* айына бір-екі рет қана — күнделікті дүкендер емес */
    if(list.length > months.length * 2) return;
    var amts = list.map(function(t){ return t.amt; }).sort(function(a, b){ return a - b; });
    var med = amts[Math.floor(amts.length / 2)];
    var close = months.filter(function(m){ return byM[m].some(function(t){ return Math.abs(t.amt - med) <= med * 0.2; }); });
    if(close.length < 3) return;
    var last = list.reduce(function(a, t){ return t.date > a ? t.date : a; }, '');
    if(last < recent) return;
    var days = {}, accs = {};
    list.forEach(function(t){ var d = +t.date.slice(8); days[d] = (days[d] || 0) + 1; accs[t.acc] = (accs[t.acc] || 0) + 1; });
    var day = +Object.keys(days).sort(function(a, b){ return days[b] - days[a]; })[0];
    var acc0 = Object.keys(accs).sort(function(a, b){ return accs[b] - accs[a]; })[0];
    var nm = list[list.length - 1].note.replace(/^(Сатып алу|Төлем|Аудару)\s*·\s*/i, '').slice(0, 32);
    out.push({ key: k, name: nm, amt: med, day: day, cat: list[0].cat, acc: acc0, months: months.length });
  });
  return out.sort(function(a, b){ return b.amt - a.amt; }).slice(0, 8);
}
function drawSubs(){
  var box = document.getElementById('rc-found'); if(!box) return;
  var subs = findSubs();
  if(!subs.length){ box.innerHTML = ''; return; }
  var h = '<div class="card"><h2>' + tr('Табылған тұрақты төлемдер') + ' <small>' + subs.length + '</small></h2>' +
    '<p class="muted" style="margin:-4px 0 6px">' + tr('Операциялардан ай сайын қайталанатын төлемдер табылды') + '</p>';
  subs.forEach(function(s, i){
    h += '<div class="sub-row"><div class="ico cc" style="background:' + catColor('out', s.cat) + '">' + catSvg('out', s.cat) + '</div>' +
      '<div style="flex:1;min-width:0"><div class="name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name) + '</div>' +
      '<div class="sub2">~' + money(Math.round(s.amt)) + ' · ' + tr('айына') + ' · ' + s.day + '-' + tr('күні') + '</div></div>' +
      '<button class="mini-btn" onclick="addSub(' + i + ')">' + tr('Қосу') + '</button>' +
      '<button class="mini-btn ghost" onclick="noSub(' + i + ')" aria-label="' + tr('Жоқ') + '">✕</button></div>';
  });
  box.innerHTML = h + '</div>';
  box._subs = subs;
}
function addSub(i){
  var box = document.getElementById('rc-found'), s = box && box._subs && box._subs[i]; if(!s) return;
  if(!DB.recur) DB.recur = [];
  DB.recur.push({ id: newId(), name: s.name, amt: Math.round(s.amt), day: Math.min(28, s.day), cat: s.cat, acc: s.acc, paid: null });
  save(); render(); toast('Қайталанатын төлемге қосылды');
}
function noSub(i){
  var box = document.getElementById('rc-found'), s = box && box._subs && box._subs[i]; if(!s) return;
  if(!DB.pref) DB.pref = {};
  if(!DB.pref.subsNo) DB.pref.subsNo = {};
  DB.pref.subsNo[s.key] = 1;
  save(); render();
}

/* ================= 4. АЙЛЫҚ ҚОРЫТЫНДЫ ================= */
function monthStats(ym){
  var inS = 0, outS = 0, cats = {};
  DB.tx.forEach(function(t){
    if(t.date.slice(0, 7) !== ym || t.type === 'tr') return;
    if(t.type === 'in') inS += t.amt; else { outS += t.amt; cats[t.cat] = (cats[t.cat] || 0) + t.amt; }
  });
  var top = Object.keys(cats).sort(function(a, b){ return cats[b] - cats[a]; }).slice(0, 3).map(function(c){ return [c, cats[c]]; });
  return { inS: inS, outS: outS, top: top };
}
function reportHtml(ym, closable){
  var p = ym.split('-'), pm = new Date(+p[0], +p[1] - 1, 1), ppm = new Date(+p[0], +p[1] - 2, 1);
  var a = monthStats(ym), b = monthStats(iso(ppm).slice(0, 7));
  if(!a.inS && !a.outS) return '';
  var diff = b.outS ? Math.round((a.outS - b.outS) / b.outS * 100) : null;
  var net = a.inS - a.outS;
  var top = a.top.map(function(c){
    var pc = a.outS ? Math.round(c[1] / a.outS * 100) : 0;
    return '<div class="kv"><span><i class="dotc" style="background:' + catColor('out', c[0]) + ';margin-right:8px"></i>' + esc(tr(c[0])) + ' · ' + pc + '%</span><b>' + money(c[1]) + '</b></div>';
  }).join('');
  return '<div class="card report' + (closable ? '' : ' inline') + '">' +
    (closable ? '<button class="rep-x" onclick="event.stopPropagation();closeReport(\'' + ym + '\')" aria-label="' + tr('Жабу') + '">✕</button>' : '') +
    '<h2>' + MONTHS[pm.getMonth()] + ' ' + tr('қорытындысы') + '</h2>' +
    '<div class="two" style="margin:0 0 10px">' +
      '<div class="rep-c"><span>' + tr('Кіріс') + '</span><b style="color:var(--pos)">+' + money(a.inS) + '</b></div>' +
      '<div class="rep-c"><span>' + tr('Шығын') + '</span><b style="color:var(--neg)">−' + money(a.outS) + '</b></div></div>' +
    '<div class="kv"><span>' + tr('Ай нәтижесі') + '</span><b style="color:' + (net >= 0 ? 'var(--pos)' : 'var(--neg)') + '">' + (net >= 0 ? '+' : '−') + money(Math.abs(net)) + '</b></div>' +
    (diff !== null ? '<div class="kv"><span>' + tr('Шығын алдыңғы аймен салыстырғанда') + '</span><b style="color:' + (diff > 0 ? 'var(--neg)' : 'var(--pos)') + '">' + (diff > 0 ? '+' : '') + diff + '%</b></div>' : '') +
    (top && closable ? '<div class="muted" style="font-weight:600;margin:10px 0 2px">' + tr('Ең көп жұмсалған') + '</div>' + top : '') +
    (closable ? '<button class="btn ghost sm" style="margin-top:12px;width:100%" onclick="reportOpenStats()">' + tr('Толығырақ') + '</button>' : '') +
  '</div>';
}
function drawReport(){
  var box = document.getElementById('home-report');
  if(box){
    var n = new Date(), ym = iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)).slice(0, 7);
    box.innerHTML = (n.getDate() > 10 || (DB.pref && DB.pref.repSeen === ym)) ? '' : reportHtml(ym, true);
  }
  /* статистика бетінде — таңдалған айдың қорытындысы әрқашан */
  var sb = document.getElementById('s-report');
  if(sb) sb.innerHTML = (statPer === 'month') ? reportHtml(iso(statMonStart()).slice(0, 7), false) : '';
}
function closeReport(ym){ if(!DB.pref) DB.pref = {}; DB.pref.repSeen = ym; save(); render(); }
function reportOpenStats(){ go('stat'); statPer = 'month'; statMon = -1; applyStatMon(); render(); }

/* ================= 5. KASPI GOLD ҮЗІНДІСІ ================= */
/* Kaspi Gold үзіндісі (қазақша және орысша):
   «24.10.26 - 2 500,00 ₸ Аударым Мерей Ш.» — күн, таңба, сома, операция түрі, толығырақ */
var KASPI_ROW = /^(\d{2})\.(\d{2})\.(\d{2,4})\s+([+\-−–])\s?([\d\s ]+,\d{2})\s?₸\s+(.*)$/;
var KASPI_OPS = [
  ['Зат сатып алу','buy'],['Покупки','buy'],['Покупка','buy'],
  ['Толықтыру','in'],['Пополнения','in'],['Пополнение','in'],
  ['Өз шотыңызға','own'],['Өз шоттарыңызға','own'],['На свои счета','own'],['Өз шоттарыңыздан','ownin'],
  ['Кредит сомасын','loanin'],['Кредиттер сомасын','loanin'],
  ['Аударым','tr'],['Переводы','tr'],['Перевод','tr'],
  ['Ақша алу','cash'],['Снятия','cash'],['Снятие','cash'],
  ['Əртүрлі','misc'],['Әртүрлі','misc'],['Разное','misc']
];
function isKaspi(lines){
  var head = lines.slice(0, 60).join(' ');
  if(!/kaspi|каспи/i.test(head)) return false;
  var n = 0;
  for(var i = 0; i < lines.length && n < 3; i++) if(KASPI_ROW.test(lines[i])) n++;
  return n >= 3;
}
function kDate(d, m, y){ return (y.length === 2 ? '20' + y : y) + '-' + m + '-' + d; }
function kaspiInfo(lines){
  var info = { bal: null, from: null, to: null, start: null };
  lines.slice(0, 80).forEach(function(l){
    var p = l.match(/(\d{2})\.(\d{2})\.(\d{2,4})\s*ж?\.?\s*бастап\s*(\d{2})\.(\d{2})\.(\d{2,4})/i) ||
            l.match(/с\s*(\d{2})\.(\d{2})\.(\d{2,4})\s*по\s*(\d{2})\.(\d{2})\.(\d{2,4})/i);
    if(p && !info.from){ info.from = kDate(p[1], p[2], p[3]); info.to = kDate(p[4], p[5], p[6]); }
    var q = l.match(/(\d{2})\.(\d{2})\.(\d{2,4})\s*ж?\.?\s*(?:қолжетімді|доступно)[^+\-−\d]*([+\-−]?)\s?([\d\s ]+,\d{2})/i) ||
            l.match(/(?:Доступно на|Қолжетімді)\s*(\d{2})\.(\d{2})\.(\d{2,4})\s*([+\-−]?)\s?([\d\s ]+,\d{2})/i);
    if(q){
      var v = (q[4] && q[4] !== '+' ? -1 : 1) * toNum(q[5]), d = kDate(q[1], q[2], q[3]);
      if(!info._d || d > info._d){ info._d = d; info.bal = v; }
      if(!info._s || d < info._s){ info._s = d; info.start = v; }
    }
  });
  return info;
}
function parseKaspi(lines){
  var out = [];
  lines.forEach(function(l){
    var m = l.match(KASPI_ROW); if(!m) return;
    var date = kDate(m[1], m[2], m[3]);
    var plus = m[4] === '+';
    var amt = toNum(m[5]); if(!(amt > 0)) return;
    var rest = (m[7] || m[6] || '').trim(), op = '', kind = '';
    for(var i = 0; i < KASPI_OPS.length; i++){
      if(rest.indexOf(KASPI_OPS[i][0]) === 0){ op = KASPI_OPS[i][0]; kind = KASPI_OPS[i][1]; break; }
    }
    var detail = op ? rest.slice(op.length).trim() : rest;
    var type = plus ? 'in' : 'out', cat;
    if(kind === 'own') cat = /несие|кредит/i.test(detail) ? 'Несие төлемі' : 'Инвестиция';
    else if(kind === 'loanin') cat = 'Несие алу';
    else if(kind === 'cash') cat = 'Басқа';
    else if(kind === 'misc') cat = 'Басқа';
    else if(/freedom|брокер|депозит/i.test(detail)) cat = 'Инвестиция';
    else if(kind === 'tr' && type === 'out') cat = 'Аударымдар';
    else cat = guessCat(type, detail);
    out.push({ date: date, amt: amt, type: type, cat: cat, note: ((op ? op + ' · ' : '') + detail).slice(0, 70) });
  });
  return out.sort(function(a, b){ return a.date < b.date ? 1 : -1; });
}

/* ================= 6. ЧЕКТІҢ СУРЕТІНЕН ҚОСУ ================= */
var CDN_OCR = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
function parseReceipt(text){
  var lines = String(text || '').split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean);
  var res = { amt: null, date: null, note: '' };
  var best = 0;
  var numsOf = function(l){
    var re = /(\d{1,3}(?:[ \u00A0]\d{3})+|\d+)(?:[.,](\d{2}))?(?![\d%])/g, m, out = [];
    while((m = re.exec(l)) !== null){
      var v = parseFloat(m[1].replace(/[ \u00A0]/g, '') + (m[2] ? '.' + m[2] : ''));
      if(v > 0 && v < 10000000) out.push(v);
    }
    return out;
  };
  /* басымдық: «Итого / Жиыны / К оплате» → «Всего» → «Сумма» */
  [/(итог|жиыны|к оплате|төлеуге|барлығы|total)/i, /(всего|төленді)/i, /(сумма)/i].some(function(re){
    for(var i = 0; i < lines.length; i++){
      if(!re.test(lines[i])) continue;
      var ns = numsOf(lines[i].replace(re, ' '));
      if(!ns.length) ns = numsOf(lines[i + 1] || '');
      if(ns.length){ best = ns[ns.length - 1]; return true; }
    }
    return false;
  });
  if(!best){
    lines.forEach(function(l){
      var re = /(\d{1,3}(?:[  ]\d{3})*|\d+)[.,](\d{2})\b/g, m;
      while((m = re.exec(l)) !== null){
        var v = parseFloat(m[1].replace(/[  ]/g, '') + '.' + m[2]);
        if(v > best && v < 10000000) best = v;
      }
    });
  }
  if(best) res.amt = best;
  for(var i = 0; i < lines.length && !res.date; i++){
    var d = lines[i].match(/\b(\d{2})[.\/-](\d{2})[.\/-](\d{2,4})\b/);
    if(d){
      var y = d[3].length === 2 ? '20' + d[3] : d[3];
      if(+d[2] >= 1 && +d[2] <= 12 && +d[1] >= 1 && +d[1] <= 31) res.date = y + '-' + d[2] + '-' + d[1];
    }
  }
  var shop = lines.filter(function(l){ return /(тоо|too|ип |ip |ao |ао |магазин|супермаркет|market|аптека|кафе|ресторан)/i.test(l + ' '); })[0];
  if(!shop) shop = lines.filter(function(l){ return /[A-Za-zА-Яа-яӘәҒғҚқҢңӨөҰұҮүІі]{4,}/.test(l); })[0];
  res.note = (shop || '').replace(/\s{2,}/g, ' ').slice(0, 50);
  return res;
}
function scanReceipt(input){
  var f = input.files && input.files[0]; input.value = '';
  if(!f) return;
  var st = document.getElementById('ocr-st');
  if(st){ st.classList.remove('hide'); st.textContent = tr('Чек оқылып жатыр… (бірінші рет интернет керек)'); }
  loadScript(CDN_OCR).then(function(){
    return window.Tesseract.recognize(f, 'rus+eng');
  }).then(function(r){
    var p = parseReceipt(r && r.data && r.data.text);
    if(p.amt) document.getElementById('f-amt').value = p.amt;
    if(p.date) document.getElementById('f-date').value = p.date;
    if(p.note){ document.getElementById('f-note').value = p.note; noteChanged(); }
    if(st) st.textContent = p.amt ? tr('Чектен алынды — тексеріп, сақтаңыз') : tr('Сома табылмады — қолмен жазыңыз');
    if(!p.amt && st) st.classList.add('warn');
  }).catch(function(){
    if(st) st.textContent = tr('Чекті оқу мүмкін болмады. Интернетті тексеріп, қайта көріңіз.');
  });
}

/* ================= ТӨЛЕМ КҮНТІЗБЕСІ ================= */
var calMon = 0;
function calEvents(y, m){
  var ev = {}, ym = y + '-' + String(m + 1).padStart(2, '0'), dim = new Date(y, m + 1, 0).getDate();
  function add(d, e){ d = Math.min(dim, Math.max(1, d)); (ev[d] = ev[d] || []).push(e); }
  (DB.recur || []).forEach(function(r){
    add(r.day, { kind: 'recur', name: r.name, amt: r.amt, done: r.paid === ym, id: r.id });
  });
  DB.accounts.forEach(function(a){
    if(a.kind !== 'debt' || !(a.pay > 0) || !(a.bal > 0)) return;
    add(a.payDay || 1, { kind: 'loan', name: a.name, amt: a.pay, done: false, id: a.id, guess: !a.payDay });
  });
  (DB.debts || []).forEach(function(d){
    var left = debtLeft(d);
    if(left <= 0 || !d.due || d.due.slice(0, 7) !== ym) return;
    add(+d.due.slice(8), { kind: d.dir === 'out' ? 'lent' : 'owe', name: d.who, amt: left, done: false, id: d.id });
  });
  return ev;
}
function drawCalendar(){
  var box = document.getElementById('cal-box'); if(!box) return;
  var now = new Date(), base = new Date(now.getFullYear(), now.getMonth() + calMon, 1);
  var y = base.getFullYear(), m = base.getMonth(), dim = new Date(y, m + 1, 0).getDate();
  var ev = calEvents(y, m), first = (base.getDay() + 6) % 7;
  var today = (calMon === 0) ? now.getDate() : -1;
  var tOut = 0, tIn = 0;
  Object.keys(ev).forEach(function(d){ ev[d].forEach(function(e){ if(e.kind === 'lent') tIn += e.amt; else tOut += e.amt; }); });
  var h = '<div class="cal-nav"><button class="mn" onclick="calMon--;drawCalendar()" aria-label="Алдыңғы ай">‹</button><b>' + MONTHS[m] + ' ' + y +
    '</b><button class="mn" onclick="calMon++;drawCalendar()" aria-label="Келесі ай">›</button></div>' +
    '<div class="cal-sum"><span>' + tr('Төленетіні') + ' <b style="color:var(--neg)">' + money(tOut) + '</b></span>' +
    (tIn ? '<span>' + tr('Қайтарылатыны') + ' <b style="color:var(--pos)">' + money(tIn) + '</b></span>' : '') + '</div>' +
    '<div class="cal-grid">' + ['Дс','Сс','Ср','Бс','Жм','Сб','Жс'].map(function(d){ return '<i>' + d + '</i>'; }).join('');
  for(var i = 0; i < first; i++) h += '<span></span>';
  for(var d = 1; d <= dim; d++){
    var e = ev[d] || [], dots = '';
    e.slice(0, 3).forEach(function(x){ dots += '<em class="cd ' + x.kind + (x.done ? ' done' : '') + '"></em>'; });
    h += '<button class="cal-d' + (d === today ? ' today' : '') + (e.length ? ' has' : '') + '" onclick="calPick(' + d + ')">' + d + '<div class="cdots">' + dots + '</div></button>';
  }
  h += '</div><div id="cal-list"></div>';
  box.innerHTML = h;
  box._ev = ev; box._ym = [y, m];
  calPick(today > 0 ? today : 0);
}
function calPick(day){
  var box = document.getElementById('cal-box'), list = document.getElementById('cal-list'); if(!box || !list) return;
  var ev = box._ev || {}, days = day ? [day] : Object.keys(ev).map(Number).sort(function(a, b){ return a - b; });
  if(day && !ev[day]) days = Object.keys(ev).map(Number).filter(function(d){ return d >= day; }).sort(function(a, b){ return a - b; });
  var L = { recur: 'Тұрақты төлем', loan: 'Несие төлемі', lent: 'Маған қайтарады', owe: 'Мен қайтарамын' };
  var h = '';
  days.forEach(function(d){
    (ev[d] || []).forEach(function(e){
      h += '<div class="cal-row' + (e.done ? ' done' : '') + '"><em class="cd ' + e.kind + '"></em><div style="flex:1;min-width:0"><div class="name">' + esc(e.name) + '</div>' +
        '<div class="sub2">' + d + ' ' + MONTHS[box._ym[1]].toLowerCase() + ' · ' + tr(L[e.kind]) + (e.guess ? ' · ' + tr('күні белгісіз') : '') + (e.done ? ' · ' + tr('төленді') : '') + '</div></div>' +
        '<b style="color:' + (e.kind === 'lent' ? 'var(--pos)' : 'var(--ink)') + '">' + (e.kind === 'lent' ? '+' : '−') + money(e.amt) + '</b></div>';
    });
  });
  list.innerHTML = h || '<div class="empty">' + tr('Бұл күннен кейін төлем жоқ.') + '</div>';
}

/* ================= НЕ БОЛСА? ================= */
var WI = { cut: 0, save: 0 };
function drawWhatIf(){
  var box = document.getElementById('wi-box'); if(!box) return;
  var now = new Date(), nets = {}, outs = {};
  DB.tx.forEach(function(t){ if(t.type === 'tr') return; var m = t.date.slice(0, 7);
    nets[m] = (nets[m] || 0) + (t.type === 'in' ? t.amt : -t.amt); if(t.type === 'out') outs[m] = (outs[m] || 0) + t.amt; });
  var n3 = 0, o3 = 0, c = 0;
  for(var i = 1; i <= 3; i++){ var k = iso(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7); if(nets[k] !== undefined){ n3 += nets[k]; o3 += outs[k] || 0; c++; } }
  var avgNet = c ? n3 / c : 0, avgOut = c ? o3 / c : 0;
  var extra = avgOut * WI.cut / 100 + WI.save, newNet = avgNet + extra, T = totals();
  var h = '<label class="f">' + tr('Шығынды азайту') + ': <b>' + WI.cut + '%</b> <span class="muted">(~' + money(Math.round(avgOut * WI.cut / 100)) + ' / ' + tr('ай') + ')</span></label>' +
    '<input type="range" min="0" max="50" step="5" value="' + WI.cut + '" oninput="WI.cut=+this.value;drawWhatIf()" class="wi-r">' +
    '<label class="f">' + tr('Қосымша жинау') + ': <b>' + money(WI.save) + '</b> / ' + tr('ай') + '</label>' +
    '<input type="range" min="0" max="300000" step="10000" value="' + WI.save + '" oninput="WI.save=+this.value;drawWhatIf()" class="wi-r">' +
    '<div class="kv"><span>' + tr('Айлық нәтиже') + '</span><b>' + money(Math.round(avgNet)) + ' → <span style="color:' + (newNet >= 0 ? 'var(--pos)' : 'var(--neg)') + '">' + money(Math.round(newNet)) + '</span></b></div>' +
    '<div class="kv"><span>' + tr('12 айдан кейін капитал') + '</span><b>~' + money(Math.round((T.net + newNet * 12) / 1000) * 1000) + '</b></div>' +
    '<div class="kv"><span>' + tr('Жылына қосымша') + '</span><b style="color:var(--pos)">+' + money(Math.round(extra * 12)) + '</b></div>';
  (DB.goals || []).forEach(function(g){
    var left = g.target - (g.saved || 0); if(left <= 0) return;
    var a = avgNet > 0 ? Math.ceil(left / avgNet) : null, b = newNet > 0 ? Math.ceil(left / newNet) : null;
    h += '<div class="kv"><span>' + esc(g.name) + '</span><b>' + (a ? a : '∞') + ' → ' + (b ? b + ' ' + tr('ай') : '∞') + '</b></div>';
  });
  box.innerHTML = h;
}

/* ================= АҚЫЛДЫ ЕСКЕРТУЛЕР ================= */
function smartTips(){
  var now = new Date(), ym = todayISO().slice(0, 7), day = now.getDate();
  var cur = {}, prev = {}, merch = {};
  var p1 = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
  var s3 = iso(new Date(now.getFullYear(), now.getMonth() - 3, 1)).slice(0, 7);
  DB.tx.forEach(function(t){
    if(t.type !== 'out') return; var m = t.date.slice(0, 7);
    if(m === ym) cur[t.cat] = (cur[t.cat] || 0) + t.amt;
    if(m === p1 && +t.date.slice(8) <= day) prev[t.cat] = (prev[t.cat] || 0) + t.amt;
    if(m >= s3 && m < ym){ var k = merchKey(t.note); if(k) merch[k] = (merch[k] || { s: 0, n: t.note }), merch[k].s += t.amt; }
  });
  var tips = [];
  Object.keys(cur).forEach(function(c){
    if(c === 'Аударымдар' || c === 'Басқа' || c === 'Инвестиция') return;
    var a = cur[c], b = prev[c] || 0;
    if(a > 15000 && b > 0 && a >= b * 1.5) tips.push({ t: tr(c) + ': ' + tr('өткен айдың осы күнімен салыстырғанда') + ' ' + (Math.round(a / b * 10) / 10).toString().replace('.', ',') + ' ' + tr('есе көп'), v: a - b, bad: 1 });
    else if(b > 15000 && a <= b * 0.6) tips.push({ t: tr(c) + ': ' + tr('өткен аймен салыстырғанда') + ' ' + Math.round((1 - a / b) * 100) + '% ' + tr('аз — жарайсыз'), v: b - a, bad: 0 });
  });
  Object.keys(merch).forEach(function(k){
    var avg = merch[k].s / 3;
    if(avg > 20000 && /bet|olimp|казино|casino|steam|игр/i.test(merch[k].n)) tips.push({ t: merch[k].n.replace(/^[^·]*·\s*/, '').slice(0, 26) + ': ' + tr('айына орташа') + ' ' + money(Math.round(avg)), v: avg, bad: 1 });
  });
  return tips.sort(function(a, b){ return b.v - a.v; }).slice(0, 3);
}
function drawTips(){
  var box = document.getElementById('home-tips'); if(!box) return;
  var t = smartTips();
  box.innerHTML = t.length ? '<div class="card tips"><h2>' + tr('Байқағандарым') + '</h2>' + t.map(function(x){
    return '<div class="tip-r"><em class="' + (x.bad ? 'bad' : 'good') + '">' + (x.bad ? '!' : '✓') + '</em><span>' + esc(x.t) + '</span></div>';
  }).join('') + '</div>' : '';
}

/* ================= ЖЫЛДЫҚ ЕСЕП ================= */
var yrSel = null;
function drawYear(){
  var box = document.getElementById('yr-box'); if(!box) return;
  var years = {}; DB.tx.forEach(function(t){ years[t.date.slice(0, 4)] = 1; });
  var ys = Object.keys(years).sort(); if(!ys.length){ box.innerHTML = '<div class="empty">' + tr('Дерек жоқ') + '</div>'; return; }
  if(!yrSel || !years[yrSel]) yrSel = ys[ys.length - 1];
  var inS = 0, outS = 0, cats = {}, months = {}, merch = {}, big = null;
  DB.tx.forEach(function(t){
    if(t.date.slice(0, 4) !== yrSel || t.type === 'tr') return;
    var m = t.date.slice(5, 7);
    months[m] = months[m] || { i: 0, o: 0 };
    if(t.type === 'in'){ inS += t.amt; months[m].i += t.amt; }
    else { outS += t.amt; months[m].o += t.amt; cats[t.cat] = (cats[t.cat] || 0) + t.amt;
      if(t.cat !== 'Аударымдар' && t.cat !== 'Инвестиция'){ var k = merchKey(t.note); if(k){ merch[k] = merch[k] || { s: 0, n: t.note }; merch[k].s += t.amt; } }
      if(!big || t.amt > big.amt) big = t; }
  });
  var ms = Object.keys(months), best = null, worst = null;
  ms.forEach(function(m){ var n = months[m].i - months[m].o; if(!best || n > best.n) best = { m: m, n: n }; if(!worst || n < worst.n) worst = { m: m, n: n }; });
  var topC = Object.keys(cats).sort(function(a, b){ return cats[b] - cats[a]; })[0];
  var topM = Object.keys(merch).sort(function(a, b){ return merch[b].s - merch[a].s; })[0];
  var h = '<div class="chips scroll" style="margin:0 0 10px">' + ys.map(function(y){ return '<button class="chip' + (y === yrSel ? ' on' : '') + '" onclick="yrSel=\'' + y + '\';drawYear()">' + y + '</button>'; }).join('') + '</div>' +
    '<div class="two" style="margin:0 0 10px"><div class="rep-c"><span>' + tr('Кіріс') + '</span><b style="color:var(--pos)">+' + money(inS) + '</b></div>' +
    '<div class="rep-c"><span>' + tr('Шығын') + '</span><b style="color:var(--neg)">−' + money(outS) + '</b></div></div>' +
    '<div class="kv"><span>' + tr('Жыл нәтижесі') + '</span><b style="color:' + (inS - outS >= 0 ? 'var(--pos)' : 'var(--neg)') + '">' + (inS - outS >= 0 ? '+' : '−') + money(Math.abs(inS - outS)) + '</b></div>' +
    (best ? '<div class="kv"><span>' + tr('Ең үнемді ай') + '</span><b>' + MONTHS[+best.m - 1] + '</b></div>' : '') +
    (worst && ms.length > 1 ? '<div class="kv"><span>' + tr('Ең шығынды ай') + '</span><b>' + MONTHS[+worst.m - 1] + '</b></div>' : '') +
    (topC ? '<div class="kv"><span>' + tr('Ең көп санат') + '</span><b>' + esc(tr(topC)) + ' · ' + money(cats[topC]) + '</b></div>' : '') +
    (topM ? '<div class="kv"><span>' + tr('Ең жиі дүкен') + '</span><b>' + esc(merch[topM].n.replace(/^[^·]*·\s*/, '').slice(0, 22)) + ' · ' + money(merch[topM].s) + '</b></div>' : '') +
    (big ? '<div class="kv"><span>' + tr('Ең ірі шығын') + '</span><b>' + money(big.amt) + '</b></div>' : '');
  box.innerHTML = h;
}

/* ================= НЕСИЕ ӨТЕУ ЖОСПАРЫ ================= */
var loanX = {};
function loanPlanHtml(a){
  if(!(a.pay > 0) || !(a.bal > 0)) return '';
  var x = loanX[a.id] || 0, base = monthsLeft(a.bal, a.rate || 0, a.pay), fast = monthsLeft(a.bal, a.rate || 0, a.pay + x);
  if(base <= 0) return '';
  var paidBase = base * a.pay, paidFast = fast > 0 ? fast * (a.pay + x) : paidBase;
  return '<div class="lp"><label class="f" style="margin-top:10px">' + tr('Айына қосымша төлесем') + ': <b>' + money(x) + '</b></label>' +
    '<input type="range" class="wi-r" min="0" max="' + Math.max(50000, Math.round(a.pay * 2 / 5000) * 5000) + '" step="5000" value="' + x + '" oninput="loanX[\'' + a.id + '\']=+this.value;openAccView(\'' + a.id + '\')">' +
    '<div class="kv"><span>' + tr('Жабылу мерзімі') + '</span><b>' + base + ' → ' + (fast > 0 ? fast : base) + ' ' + tr('ай') + '</b></div>' +
    (x ? '<div class="kv"><span>' + tr('Үнемделетін пайыз') + '</span><b style="color:var(--pos)">' + money(Math.max(0, Math.round(paidBase - paidFast))) + '</b></div>' : '') + '</div>';
}

/* IndexedDB мен localStorage-тің қайсысы жаңа болса, соны аламыз:
   IndexedDB-ге жазу кідіріспен жүреді, сондықтан бет жабылып қалса localStorage жаңарақ болуы мүмкін */
/* Бірінші сурет бірден шықсын: localStorage-те дерек болса, IndexedDB-ні күтпей іске қосамыз.
   Кейін IndexedDB жаңарақ болып шықса, соны алып қайта саламыз. */
var booted = false, ls0Updated = null;
(function(){
  var ls0 = lsData();
  if(ls0 && (ls0.tx || ls0.accounts)){ ls0Updated = ls0.updated || ''; load(); boot(); booted = true; }
})();
idbGet('db').then(function(v){
  var idbHas = !!(v && (v.tx || v.accounts));
  var ls = booted ? { updated: ls0Updated } : lsData();
  var lsNewer = !!(ls && (!idbHas || (ls.updated || '') > (v.updated || '')));
  idbChecked = true;
  if(idbHas && !lsNewer){
    applyDB(v);
    if(booted){ applyTheme(); drawAccs(); render(); try{ localStorage.setItem('qarzhy_v1', JSON.stringify(DB)); }catch(e){} }
    idbPending = false;
  } else {
    if(!booted) load();
    if(DB.tx.length || DB.accounts.length || idbPending){ idbPending = false; flushSave(); }
  }
  if(!booted){ boot(); booted = true; }
}).catch(function(){
  idbChecked = true;
  if(!booted){ load(); boot(); booted = true; }
});
