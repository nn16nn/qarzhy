/* =========================================================
   Qarzhy Pro — жазылым / сатып алу
   Ережелер (сатып алу жоғалмауы үшін):
   1. Pro күйі DB-дан бөлек сақталады (localStorage + IndexedDB).
      Деректі өшірсе, көшірмеден ашса — Pro жоғалмайды, көшірмемен Pro-ны жасауға болмайды.
   2. Шешуші дерек көзі — Google Play (listPurchases). Телефон ауыстырса,
      қосымшаны қайта орнатса — сол Google аккаунтымен өзі қалпына келеді.
   3. Қате / интернет жоқ кезде Pro ешқашан алынбайды. Тек Google
      «сатып алу жоқ» десе ЖӘНЕ мерзімі өтсе ғана алынады.
   4. Төлем өткен сәтте токен бірден сақталады, растау сервері сәтсіз
      болса — келесі ашылғанда қайта жіберіледі (3 күн ішінде растамаса, Google ақшаны қайтарады).
   ========================================================= */
var PRO_CFG = {
  on: false,                       /* Play Market-ке шыққанда true */
  trialDays: 7,
  freeImports: 1,                  /* тегін нұсқада айына банк үзіндісі */
  graceDays: 7,                    /* сервер мерзімді айтпаса, офлайн қанша күн Pro қалады */
  pkg: 'io.github.nn16nn.qarzhy',
  api: '',                         /* растау сервері (2-қадам) */
  skus: { month: 'qarzhy_pro_month', year: 'qarzhy_pro_year', life: 'qarzhy_pro_life' },
  price: { month: '990 ₸', year: '5 990 ₸', life: '14 990 ₸' }
};
var PLAY_BILLING = 'https://play.google.com/billing';
var PRO_KEY = 'qarzhy_pro';
var PRO = {};
var PRO_SVC = null, PRO_SYNC_AT = 0;

(function(){
  try{ if(/[?&]pro=test/.test(location.search)) localStorage.setItem('qarzhy_pro_test', '1'); if(/[?&]pro=off/.test(location.search)) localStorage.removeItem('qarzhy_pro_test'); }catch(e){}
  try{ if(localStorage.getItem('qarzhy_pro_test') === '1') PRO_CFG.on = true; }catch(e){}
  try{ PRO = JSON.parse(localStorage.getItem(PRO_KEY) || '{}') || {}; }catch(e){ PRO = {}; }
})();

function proMerge(a, b){
  /* екі көзден ең «жақсы» күйді алу — ешнәрсе жоғалмасын */
  a = a || {}; b = b || {};
  var r = JSON.parse(JSON.stringify(a));
  if(b.trialStart && (!r.trialStart || b.trialStart < r.trialStart)) r.trialStart = b.trialStart;
  if(b.sku && (!r.sku || (b.checkedAt || 0) > (r.checkedAt || 0))){ ['sku', 'token', 'exp', 'life', 'checkedAt'].forEach(function(k){ r[k] = b[k]; }); }
  if(b.pending && !r.pending) r.pending = b.pending;
  if(b.imp && (!r.imp || b.imp.m > r.imp.m || (b.imp.m === r.imp.m && b.imp.n > r.imp.n))) r.imp = b.imp;
  return r;
}
function proSave(){
  try{ localStorage.setItem(PRO_KEY, JSON.stringify(PRO)); }catch(e){}
  if(typeof idbSet === 'function') idbSet('pro', JSON.parse(JSON.stringify(PRO))).catch(function(){});
}
function proLoad(){
  if(typeof idbGet !== 'function') return Promise.resolve();
  return idbGet('pro').then(function(x){ var m = proMerge(PRO, x); if(JSON.stringify(m) !== JSON.stringify(PRO)){ PRO = m; proSave(); } }).catch(function(){});
}

/* ---------- күй ---------- */
function trialLeft(){
  if(!PRO.trialStart) return -1;
  var d = PRO_CFG.trialDays - Math.floor((Date.now() - PRO.trialStart) / 864e5);
  return d > 0 ? d : 0;
}
function proPaid(){
  if(!PRO.sku) return false;
  if(PRO.life) return true;
  if(PRO.exp) return PRO.exp > Date.now();
  return PRO.checkedAt && Date.now() - PRO.checkedAt < PRO_CFG.graceDays * 864e5;
}
function isPro(){ return !PRO_CFG.on || proPaid() || trialLeft() > 0; }
function proPlanName(){
  var k = Object.keys(PRO_CFG.skus).filter(function(x){ return PRO_CFG.skus[x] === PRO.sku; })[0];
  return { month: t('Айлық'), year: t('Жылдық'), life: t('Мәңгілік') }[k] || '';
}
function proGate(){
  if(isPro()) return true;
  openPaywall(); return false;
}

/* ---------- Google Play ---------- */
function billSvc(){
  if(PRO_SVC) return Promise.resolve(PRO_SVC);
  if(!('getDigitalGoodsService' in window)) return Promise.resolve(null);
  return window.getDigitalGoodsService(PLAY_BILLING).then(function(s){ PRO_SVC = s || null; return PRO_SVC; }).catch(function(){ return null; });
}
function proSkuList(){ return Object.keys(PRO_CFG.skus).map(function(k){ return PRO_CFG.skus[k]; }); }
function proPrices(){
  return billSvc().then(function(s){
    if(!s) return;
    return s.getDetails(proSkuList()).then(function(list){
      (list || []).forEach(function(d){
        var k = Object.keys(PRO_CFG.skus).filter(function(x){ return PRO_CFG.skus[x] === d.itemId; })[0];
        if(k && d.price) try{ PRO_CFG.price[k] = new Intl.NumberFormat(LANG === 'en' ? 'en' : 'ru', { style: 'currency', currency: d.price.currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(+d.price.value); }catch(e){}
      });
    });
  }).catch(function(){});
}
/* сервер: сатып алуды тексереді және Google-да растайды (acknowledge) */
function proVerify(sku, token){
  if(!PRO_CFG.api) return Promise.reject(new Error('noapi'));
  return fetch(PRO_CFG.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pkg: PRO_CFG.pkg, sku: sku, token: token }) })
    .then(function(r){ if(!r.ok) throw new Error('http ' + r.status); return r.json(); });
}
function proApply(sku, token, v){
  /* v = сервер жауабы {active, exp, life} немесе null (сервер жоқ/жетпеді) */
  if(v && v.active === false){
    if(PRO.token === token){ delete PRO.sku; delete PRO.token; delete PRO.exp; delete PRO.life; }
    return;
  }
  PRO.sku = sku; PRO.token = token; PRO.checkedAt = Date.now();
  PRO.life = sku === PRO_CFG.skus.life || !!(v && v.life);
  if(v && v.exp) PRO.exp = +v.exp; else if(!v) delete PRO.exp;
  if(PRO.pending && PRO.pending.token === token && v) delete PRO.pending;
}
function proSync(force){
  if(!force && Date.now() - PRO_SYNC_AT < 36e5) return Promise.resolve();
  PRO_SYNC_AT = Date.now();
  return billSvc().then(function(s){
    if(!s) return;
    return s.listPurchases().then(function(list){
      var mine = (list || []).filter(function(p){ return proSkuList().indexOf(p.itemId) >= 0; });
      var was = proPaid();
      if(!mine.length){
        /* Google «жоқ» деді: мерзімі өткен болса ғана алып тастаймыз */
        if(PRO.sku && !PRO.life && !(PRO.exp && PRO.exp > Date.now())){ delete PRO.sku; delete PRO.token; delete PRO.exp; }
        delete PRO.pending;
        proSave(); if(was !== proPaid()) render();
        return;
      }
      /* мәңгілік бар болса — соны таңдаймыз, әйтпесе біріншісі */
      mine.sort(function(a, b){ return (b.itemId === PRO_CFG.skus.life) - (a.itemId === PRO_CFG.skus.life); });
      return Promise.all(mine.map(function(p){
        return proVerify(p.itemId, p.purchaseToken).then(function(v){ return { p: p, v: v }; }, function(){ return { p: p, v: null }; });
      })).then(function(res){
        var act = res.filter(function(x){ return !x.v || x.v.active !== false; });
        if(act.length) proApply(act[0].p.itemId, act[0].p.purchaseToken, act[0].v);
        else res.forEach(function(x){ proApply(x.p.itemId, x.p.purchaseToken, x.v); });
        proSave(); if(was !== proPaid()) render();
      });
    });
  }).catch(function(){ /* қате — ештеңе өзгертпейміз */ });
}
function proBuy(key){
  var sku = PRO_CFG.skus[key];
  billSvc().then(function(s){
    if(!s){ toast('Сатып алу Play Market нұсқасында ғана'); return; }
    if(!PRO_CFG.api){ toast('Төлем әзірге қосылмаған'); return; }
    if(!window.PaymentRequest){ toast('Төлем бұл құрылғыда қолжетімсіз'); return; }
    var req = new PaymentRequest([{ supportedMethods: PLAY_BILLING, data: { sku: sku } }], { total: { label: 'Qarzhy Pro', amount: { currency: 'KZT', value: '0' } } });
    return req.show().then(function(resp){
      var token = resp.details && (resp.details.purchaseToken || resp.details.token);
      /* ЕҢ АЛДЫМЕН токенді сақтау — кейін не болса да жоғалмайды */
      PRO.pending = { sku: sku, token: token, at: Date.now() };
      proApply(sku, token, null); proSave();
      return proVerify(sku, token).then(function(v){
        resp.complete('success'); proApply(sku, token, v); proSave();
      }, function(){
        resp.complete('success'); /* Google ақшаны алды — Pro береміз, растау келесі ашылғанда қайталанады */
      }).then(function(){ closeSheet(); render(); toast('Qarzhy Pro қосылды'); proConfetti(); });
    }).catch(function(e){ if(e && e.name !== 'AbortError') toast(t('Төлем өтпеді') + (e.message ? ': ' + e.message : '')); });
  });
}
function proRestore(){
  billSvc().then(function(s){
    if(!s){ toast('Қалпына келтіру Play Market нұсқасында ғана'); return; }
    var was = proPaid();
    proSync(true).then(function(){ render(); toast(proPaid() ? (was ? 'Pro белсенді' : 'Pro қалпына келтірілді') : 'Бұл Google аккаунтында сатып алу табылмады'); if(sheetOn) openPaywall(); });
  });
}
function proManage(){
  var u = 'https://play.google.com/store/account/subscriptions?package=' + PRO_CFG.pkg + (PRO.sku && !PRO.life ? '&sku=' + PRO.sku : '');
  window.open(u, '_blank');
}
function startTrial(){
  if(PRO.trialStart){ toast('Сынақ мерзімі бұрын қолданылған'); return; }
  PRO.trialStart = Date.now(); proSave(); closeSheet(); render(); toast(t('7 күн тегін Pro басталды'));
}
function proConfetti(){ if(typeof confetti === 'function') try{ confetti(); }catch(e){} }

/* ---------- экран ---------- */
var PRO_PERKS = [
  ['upload', 'Шексіз импорт', 'Kaspi, Freedom үзінділері, несие анықтамасы'],
  ['receipt', 'Чекті сканерлеу', 'Суретке түсір — сомасы өзі жазылады'],
  ['lock', 'Зейнетақы (ЕНПФ)', 'Жинақ, кіріс, жұмыс берушілер'],
  ['card', 'Несиені жабу жоспары', 'Қайсысын бірінші жабу тиімді'],
  ['pie', 'Терең талдау', 'Кеңестер, капитал тарихы, шығын картасы, жылдық қорытынды'],
  ['bell', 'Санат лимиттері', 'Шектен асса — ескертеді'],
  ['percent', 'Калькуляторлар', 'Депозит, инвестиция, ЖК салығы']
];
var PW_PLAN = 'year';
function openPaywall(){
  proPrices().then(drawPaywall); drawPaywall();
}
function drawPaywall(){
  var paid = proPaid(), tl = trialLeft();
  var h = sheetHead('Qarzhy Pro');
  if(paid){
    h += '<div class="card" style="background:var(--hero);color:var(--hero-ink);margin-top:0"><b style="font-size:17px">' + ic('check') + ' ' + t('Pro белсенді') + '</b><div style="font-size:13.5px;color:var(--hero-mute);margin-top:4px">' +
      proPlanName() + (PRO.life ? '' : PRO.exp ? ' · ' + t('келесі төлем') + ' ' + fullDate(iso(new Date(PRO.exp))) : '') + '</div></div>';
  } else if(tl > 0){
    h += '<p class="muted" style="margin:0 0 6px;font-size:14px">' + t('Тегін сынақ') + ': ' + tl + ' ' + t('күн қалды') + '</p>';
  } else {
    h += '<p class="muted" style="margin:0 0 6px;font-size:14px">' + t('Барлық мүмкіндікті ашыңыз. Деректеріңіз бұрынғыдай тек телефонда.') + '</p>';
  }
  h += '<div class="list" style="margin:8px 0 12px">' + PRO_PERKS.map(function(p){
    return '<div class="row" style="background:none"><span class="ci" style="background:var(--lime);color:#141412">' + ic(p[0]) + '</span><span class="mid"><b>' + t(p[1]) + '</b><span>' + t(p[2]) + '</span></span></div>';
  }).join('') + '</div>';
  if(!paid){
    h += '<div class="plans">' + [['month', 'Айлық', ''], ['year', 'Жылдық', '−50%'], ['life', 'Мәңгілік', t('бір рет')]].map(function(p){
      return '<button class="plan ' + (PW_PLAN === p[0] ? 'on' : '') + '" onclick="PW_PLAN=\'' + p[0] + '\';drawPaywall()"><span>' + t(p[1]) + '</span><b class="num">' + esc(PRO_CFG.price[p[0]]) + '</b>' + (p[2] ? '<i>' + p[2] + '</i>' : '') + '</button>';
    }).join('') + '</div>';
    h += '<button class="btn lime" onclick="proBuy(PW_PLAN)">' + ic('check') + t('Сатып алу') + '</button>';
    if(!PRO.trialStart) h += '<button class="btn line" onclick="startTrial()">' + t('7 күн тегін көру') + '</button>';
  } else if(!PRO.life){
    h += '<button class="btn line" onclick="proManage()">' + t('Жазылымды басқару') + '</button>';
  }
  h += '<button class="btn line sm" style="margin-top:6px" onclick="proRestore()">' + ic('repeat') + t('Сатып алуды қалпына келтіру') + '</button>';
  h += '<p class="muted" style="font-size:12px;margin:10px 0 0;line-height:1.45">' + t('Жазылым Google Play арқылы. Кез келген уақытта Google Play → Жазылымдар бөлімінен тоқтатуға болады. Телефон ауыстырсаңыз, сол Google аккаунтымен «Қалпына келтіру» басыңыз.') + '</p>';
  openSheet(h);
}
function proCard(){
  if(!PRO_CFG.on) return '';
  var paid = proPaid(), tl = trialLeft();
  return '<button class="card" onclick="openPaywall()" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;margin-top:12px;background:' + (paid ? 'var(--sf)' : 'var(--hero)') + ';color:' + (paid ? 'inherit' : 'var(--hero-ink)') + '">' +
    '<span style="width:40px;height:40px;border-radius:14px;display:grid;place-items:center;background:var(--lime);color:#141412;flex:none">' + ic(paid ? 'check' : 'gift') + '</span>' +
    '<span style="flex:1"><b style="font-size:15px;display:block">Qarzhy Pro' + (paid ? ' · ' + proPlanName() : '') + '</b><span style="font-size:12.5px;' + (paid ? '' : 'color:var(--hero-mute)') + '" class="' + (paid ? 'muted' : '') + '">' +
    (paid ? t('Белсенді') : tl > 0 ? t('Тегін сынақ') + ': ' + tl + ' ' + t('күн қалды') : t('Импорт, чек, талдау — барлығы шексіз')) + '</span></span>' + ic('right') + '</button>';
}
function lockedCard(title){
  return '<div class="card" style="text-align:center;padding:26px 20px"><span style="width:52px;height:52px;border-radius:18px;display:inline-grid;place-items:center;background:var(--lime);color:#141412">' + ic('lock') + '</span>' +
    '<b style="display:block;font-size:17px;margin-top:12px">' + t(title) + '</b><span class="muted" style="font-size:13.5px;display:block;margin:4px 0 14px">' + t('Бұл мүмкіндік Qarzhy Pro-да') + '</span>' +
    '<button class="btn lime" onclick="openPaywall()">' + t('Pro-ны ашу') + '</button></div>';
}

/* ---------- тегін импорт квотасы ---------- */
function impQuotaLeft(){
  var m = todayISO().slice(0, 7);
  var n = PRO.imp && PRO.imp.m === m ? PRO.imp.n : 0;
  return Math.max(0, PRO_CFG.freeImports - n);
}
function impQuotaUse(){
  var m = todayISO().slice(0, 7);
  if(!PRO.imp || PRO.imp.m !== m) PRO.imp = { m: m, n: 0 };
  PRO.imp.n++; proSave();
}

/* ---------- мүмкіндіктерді құлыптау ---------- */
(function(){
  function wrap(name, fn){ var o = window[name]; if(typeof o === 'function') window[name] = fn(o); }
  ['startScan', 'openCatLimits', 'showKaspiDebt'].forEach(function(n){
    wrap(n, function(o){ return function(){ if(!proGate()) return; return o.apply(this, arguments); }; });
  });
  wrap('importENPF', function(o){ return function(){ if(!isPro()){ setTimeout(openPaywall, 50); return 'locked'; } return o.apply(this, arguments); }; });
  wrap('importConfirm', function(o){ return function(){
    if(isPro()) return o.apply(this, arguments);
    if(impQuotaLeft() <= 0){ openPaywall(); toast(t('Тегін нұсқада айына') + ' ' + PRO_CFG.freeImports + ' ' + t('үзінді')); return; }
    var r = o.apply(this, arguments); impQuotaUse(); return r;
  }; });
  wrap('statsExtra', function(o){ return function(){
    if(isPro()) return o.apply(this, arguments);
    return '<button class="card" onclick="openPaywall()" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left"><span style="width:40px;height:40px;border-radius:14px;display:grid;place-items:center;background:var(--lime);color:#141412;flex:none">' + ic('lock') + '</span>' +
      '<span style="flex:1"><b style="font-size:15px;display:block">' + t('Терең талдау') + '</b><span class="muted" style="font-size:12.5px">' + t('Кеңестер, капитал тарихы, шығын картасы, жылдық қорытынды') + '</span></span>' + ic('right') + '</button>';
  }; });
  var PRO_CALCS = ['dep', 'inv', 'payoff', 'tax'];
  if(PAGES.calc){ var oc = PAGES.calc; PAGES.calc = function(){
    if(PRO_CALCS.indexOf(sub) >= 0 && !isPro()){ var c = CALCS.filter(function(x){ return x[0] === sub; })[0]; return topBar(t(c[2]), t(c[3])) + lockedCard(c[2]); }
    var h = oc.apply(this, arguments);
    if(!sub && !isPro()) PRO_CALCS.forEach(function(k){ var c = CALCS.filter(function(x){ return x[0] === k; })[0]; if(c) h = h.replace('<b>' + t(c[2]) + '</b>', '<b>' + t(c[2]) + ' <i class="pro-tag">Pro</i></b>'); });
    return h;
  }; }
  if(PAGES.year){ var oy = PAGES.year; PAGES.year = function(){ return isPro() ? oy.apply(this, arguments) : topBar(t('Жылдық қорытынды')) + lockedCard('Жылдық қорытынды'); }; }
  if(PAGES.pension){ var op = PAGES.pension; PAGES.pension = function(){ return isPro() ? op.apply(this, arguments) : topBar(t('Зейнетақы (ЕНПФ)')) + lockedCard('Зейнетақы (ЕНПФ)'); }; }
  if(PAGES.more){ var om = PAGES.more; PAGES.more = function(){
    var h = om.apply(this, arguments), i = h.indexOf('<div class="sec">');
    return i > 0 ? h.slice(0, i) + proCard() + h.slice(i) : h + proCard();
  }; }
})();

/* ---------- іске қосу ---------- */
proLoad().then(function(){ if(PRO_CFG.on){ if(typeof render === 'function') render(); proSync(true); } });
document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible' && PRO_CFG.on) proSync(); });
