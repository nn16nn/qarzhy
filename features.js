/* Qarzhy 2.5 — қаржылық мүмкіндіктер:
   жазылымдарды табу · байқаулар · валюта айырбасы · капитал тарихы · шығынды бөлу · несиені жабу жоспары ·
   шығын күнтізбесі · жылдық қорытынды · кэшбэк · төтенше қор · чек оқу · зейнетақы (ЕНПФ) · санат лимиттері */
'use strict';

/* ---------- ортақ ---------- */
function monthsBack(n){ var d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() - n, 1)); }
function median(a){ if(!a.length) return 0; var s = a.slice().sort(function(x, y){ return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function avgOut(key, n){
  var d = parseISO(key + '-01'), sum = 0, c = 0;
  for(var j = 1; j <= n; j++){ var s = monthSum(ym(new Date(d.getFullYear(), d.getMonth() - j, 1))); if(s.n){ sum += s.out; c++; } }
  return c ? sum / c : 0;
}
function catAvg(key, cat, n){
  var d = parseISO(key + '-01'), sum = 0, c = 0;
  for(var j = 1; j <= n; j++){
    var k = ym(new Date(d.getFullYear(), d.getMonth() - j, 1)), any = false, v = 0;
    DB.tx.forEach(function(x){ if((x.date || '').slice(0, 7) === k){ any = true; if(x.type === 'out' && x.cat === cat) v += x.amt; } });
    if(any){ sum += v; c++; }
  }
  return c ? sum / c : 0;
}
function card(title, body, more){ return '<div class="card"><h2>' + title + (more || '') + '</h2>' + body + '</div>'; }

/* =========================================================
   1. ЖАЗЫЛЫМДАРДЫ ӨЗІ ТАБУ
   ========================================================= */
function subKey(note){ var k = (typeof merchKey === 'function' && merchKey(note)) || ''; return k || String(note || '').toLowerCase().trim(); }
function detectSubs(){
  var since = monthsBack(7), groups = {};
  DB.tx.forEach(function(x){
    if(x.type !== 'out' || !x.note || !x.date || x.date < since) return;
    if(['Несие төлемі','Аударымдар','Тамақ','Киім','Көлік','Әке-шешеме','Инвестиция','Сыйлық'].indexOf(x.cat) >= 0) return;
    var k = subKey(x.note); if(!k || k.length < 3) return;
    (groups[k] = groups[k] || { key: k, name: x.note, cat: x.cat, acc: x.acc, items: [] }).items.push(x);
  });
  var ign = DB.pref.subIgnore || [], out = [];
  var have = DB.recur.map(function(r){ return subKey(r.name); });
  Object.keys(groups).forEach(function(k){
    var g = groups[k], months = {}, days = [], amts = [];
    g.items.forEach(function(x){ months[x.date.slice(0, 7)] = (months[x.date.slice(0, 7)] || 0) + 1; days.push(+x.date.slice(8)); amts.push(x.amt); });
    var mk = Object.keys(months);
    if(mk.length < 3) return;
    if(g.items.length > mk.length * 1.5) return;            /* айына бірнеше рет — жазылым емес (дүкен, такси) */
    var md = median(amts), close = amts.filter(function(a){ return Math.abs(a - md) <= md * 0.15; }).length;
    if(close < amts.length * 0.7 || md < 300) return;
    var dm = median(days); if(days.filter(function(d){ return Math.abs(d - dm) <= 6 || Math.abs(d - dm) >= 24; }).length < days.length * 0.7) return;
    if(ign.indexOf(k) >= 0 || have.indexOf(k) >= 0) return;
    var last = g.items.reduce(function(a, b){ return a.date > b.date ? a : b; });
    out.push({ key: k, name: last.note, cat: last.cat, acc: last.acc, amt: Math.round(md), day: Math.round(median(days)) || 1, n: mk.length });
  });
  return out.sort(function(a, b){ return b.amt - a.amt; });
}
function subsCard(){
  var list = detectSubs(); if(!list.length) return '';
  var tot = 0; list.forEach(function(s){ tot += s.amt; });
  return card(t('Табылған жазылымдар'), '<p class="muted" style="margin:-4px 0 6px;font-size:13px">' + t('Ай сайын қайталанатын төлемдер') + ' · ' + t('айына') + ' <b class="num" style="color:var(--ink)">' + money(tot) + '</b></p>' +
    list.slice(0, 6).map(function(s){
      return '<div class="row" style="padding:10px 0;background:none">' + catIc(s.cat) + '<span class="mid"><b>' + esc(s.name) + '</b><span>' + s.n + ' ' + t('ай қатарынан') + ' · ' + t('шамамен') + ' ' + s.day + '-' + t('күні') + '</span></span>' +
        '<b class="num" style="font-size:14px;margin-right:6px">' + money(s.amt) + '</b>' +
        '<button class="btn sm lime" onclick="addSub(\'' + esc(s.key) + '\')" aria-label="' + t('Қосу') + '">' + ic('plus') + '</button>' +
        '<button class="spl-x" onclick="ignoreSub(\'' + esc(s.key) + '\')" aria-label="' + t('Жасыру') + '">' + ic('x') + '</button></div>';
    }).join(''));
}
function addSub(k){
  var s = detectSubs().filter(function(x){ return x.key === k; })[0]; if(!s) return;
  DB.recur.push({ id: newId(), name: s.name, amt: s.amt, day: Math.min(28, s.day), cat: s.cat || 'Байланыс', acc: acc(s.acc) ? s.acc : (assets()[0] || {}).id, paid: ym(new Date()) });
  save(); render(); toast('Тұрақты төлемге қосылды'); buzz();
}
function ignoreSub(k){ (DB.pref.subIgnore = DB.pref.subIgnore || []).push(k); save(); render(); }
function recurExtra(){ return subsCard(); }

/* =========================================================
   2. АҚЫЛДЫ БАЙҚАУЛАР
   ========================================================= */
function insights(key, M){
  var out = [], now = new Date(), isCur = key === ym(now);
  /* санаттар: орташадан көп/аз */
  var cats = catTotals(key, 'out'), up = [], down = [];
  cats.forEach(function(c){
    var a = catAvg(key, c.cat, 3); if(a <= 0) return;
    var diff = c.v - a, pct = diff / a * 100;
    if(pct >= 30 && diff >= 5000) up.push({ c: c.cat, pct: pct, d: diff });
  });
  up.sort(function(a, b){ return b.d - a.d; }).slice(0, 2).forEach(function(u){
    out.push(['up', t(u.c) + ': ' + t('орташадан') + ' ' + Math.round(u.pct) + '% ' + t('көп') + ' (+' + moneyShort(u.d) + ')', u.c]);
  });
  /* санат лимиттері */
  cats.forEach(function(c){
    var lim = DB.limits[c.cat];
    if(lim > 0 && c.v > lim) out.push(['up', t(c.cat) + ': ' + t('лимиттен') + ' ' + moneyShort(c.v - lim) + ' ' + t('асты'), c.cat]);
  });
  /* әдеттен тыс шығын */
  var since = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90));
  var outs = DB.tx.filter(function(x){ return x.type === 'out' && x.date >= since; }).map(function(x){ return x.amt; });
  var md = median(outs), thr = Math.max(md * 4, 20000);
  var big = DB.tx.filter(function(x){ return x.type === 'out' && (x.date || '').slice(0, 7) === key && x.amt >= thr && x.cat !== 'Инвестиция' && x.cat !== 'Несие төлемі'; })
    .sort(function(a, b){ return b.amt - a.amt; })[0];
  if(big && outs.length >= 10) out.push(['warn', t('Әдеттен тыс шығын') + ': ' + (big.note || t(big.cat)) + ' — ' + money(big.amt) + ' (' + fullDate(big.date) + ')', null]);
  /* ай соңына болжам */
  if(isCur && M.out > 0){
    var dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), d = now.getDate();
    if(d >= 5 && d < dim){
      var proj = M.out / d * dim, a3 = avgOut(key, 3);
      out.push([a3 && proj > a3 * 1.1 ? 'warn' : 'info', t('Осы қарқынмен ай соңында шығын') + ' ≈ ' + moneyShort(proj) + (a3 ? ' (' + t('орташа') + ' ' + moneyShort(a3) + ')' : ''), null]);
    }
  }
  /* жақсы жаңалық */
  if(M.in > 0 && M.in - M.out > 0 && !isCur) out.push(['good', t('Бұл айда') + ' ' + moneyShort(M.in - M.out) + ' ' + t('жинадыңыз') + ' — ' + t('табыстың') + ' ' + Math.round((M.in - M.out) / M.in * 100) + '%', null]);
  /* жазылымдар */
  var subs = detectSubs();
  if(subs.length){ var st = 0; subs.forEach(function(x){ st += x.amt; }); out.push(['info', subs.length + ' ' + t('жазылым табылды') + ' · ' + t('айына') + ' ' + moneyShort(st) + ' →', '__subs']); }
  /* кэшбэк */
  var cb = cashbackYear(now.getFullYear());
  if(cb > 0 && isCur) out.push(['good', t('Биыл кэшбэк') + ': ' + money(cb), 'Кэшбэк']);
  return out.slice(0, 4);
}
function insightsCard(key, M){
  var list = insights(key, M); if(!list.length) return '';
  var col = { up: 'var(--neg)', warn: 'var(--warn)', info: 'var(--mute)', good: 'var(--pos)' };
  var icn = { up: 'invest', warn: 'bell', info: 'cal', good: 'check' };
  return card(t('Байқаулар'), list.map(function(x){
    var link = x[2] === '__subs' ? ' onclick="go(\'recur\')" style="cursor:pointer"' : '';
    return '<div class="ins"' + link + '><span class="ins-ic" style="color:' + col[x[0]] + '">' + ic(x[2] === '__subs' ? 'repeat' : icn[x[0]]) + '</span><span>' + esc(x[1]) + '</span></div>';
  }).join(''));
}

/* =========================================================
   3. ВАЛЮТА АЙЫРБАСЫ + 5. ШЫҒЫНДЫ БӨЛУ (операция парағы)
   ========================================================= */
function fxPair(){
  if(!F || F.type !== 'tr') return null;
  var a = acc(F.acc), b = acc(F.to);
  if(!a || !b || (a.cur || BASE()) === (b.cur || BASE())) return null;
  return [a, b];
}
function txSheetExtra(){
  var h = '', p = fxPair();
  if(p){
    var r = num(F.amt) > 0 && num(F.amt2) > 0 ? num(F.amt) / num(F.amt2) : 0;
    h += '<label class="f"><span>' + t('Түскен сома') + ' (' + curSym(p[1]) + ')</span><input class="in" id="f-amt2" inputmode="decimal" value="' + (F.amt2 || '') + '" placeholder="0" oninput="F.amt2=this.value;fxHint()"></label>' +
      '<div class="muted" id="fx-hint" style="font-size:12.5px;margin:6px 2px 0">' + fxHintText() + '</div>';
  }
  if(F.type === 'out' && !F.id){
    h += '<button class="toggle" style="width:100%;text-align:left" onclick="F.split=!F.split;drawTxSheetKeep()"><span style="font-size:14.5px;font-weight:550">' + t('Достармен бөлу') +
      '<br><span class="muted" style="font-size:12.5px;font-weight:400">' + t('Сіздің үлесіңіз шығын болады, қалғаны — сізге қарыз') + '</span></span><i class="sw ' + (F.split ? 'on' : '') + '"></i></button>';
    if(F.split){
      h += '<label class="f" style="margin-top:4px"><span>' + t('Кіммен (үтірмен)') + '</span><input class="in" id="f-who" value="' + esc(F.who || '') + '" placeholder="' + t('Ерлан, Айгүл') + '" oninput="F.who=this.value;splitHint()"></label>' +
        '<div class="muted" id="split-hint" style="font-size:12.5px;margin:6px 2px 0">' + splitHintText() + '</div>';
    }
  }
  return h;
}
function fxHintText(){
  var p = fxPair(); if(!p) return '';
  var a = num(F.amt), b = num(F.amt2);
  if(!(a > 0 && b > 0)) return t('Банктегі нақты айырбас сомасын жазыңыз');
  var hi = a >= b ? [a / b, curSym(p[1]), curSym(p[0])] : [b / a, curSym(p[0]), curSym(p[1])];
  var mr = fxRate(p[1].cur || BASE()) / (fxRate(p[0].cur || BASE()) || 1);
  return t('Айырбас курсы') + ': 1 ' + hi[1] + ' = ' + nf(hi[0], true) + ' ' + hi[2] + (mr && p[0].cur !== p[1].cur ? ' · ' + t('нарық') + ' ' + nf(a >= b ? mr : 1 / mr, true) : '');
}
function fxHint(){ var e = $('fx-hint'); if(e) e.textContent = fxHintText(); }
function splitNames(){ return String(F.who || '').split(/[,;]+/).map(function(s){ return s.trim(); }).filter(Boolean); }
function splitHintText(){
  var n = splitNames().length, a = num(F.amt);
  if(!n || !(a > 0)) return t('Аттарын үтірмен жазыңыз');
  var share = a / (n + 1);
  return (n + 1) + ' ' + t('адам') + ' · ' + t('әрқайсысы') + ' ' + money(Math.round(share)) + ' · ' + t('сізге қайтарады') + ' ' + money(Math.round(share * n));
}
function splitHint(){ var e = $('split-hint'); if(e) e.textContent = splitHintText(); }
function txBeforeSave(x, amt){
  var p = fxPair();
  if(p){
    var a2 = num(F.amt2);
    if(!(a2 > 0)){ toast('Түскен соманы жазыңыз'); return false; }
    x.amtFrom = amt; x.amt2 = a2;
    var fromBase = (p[0].cur || BASE()) === BASE(), toBase = (p[1].cur || BASE()) === BASE();
    x.amt = fromBase ? amt : toBase ? a2 : (fxRate(p[0].cur) ? amt * fxRate(p[0].cur) : amt);
    x.amt = Math.round(x.amt * 100) / 100;
  }
  if(F.split && x.type === 'out' && !F.id){
    var names = splitNames();
    if(!names.length){ toast('Кіммен бөлетініңізді жазыңыз'); return false; }
    x._split = { names: names, total: x.amt };
    x.amt = Math.round(x.amt / (names.length + 1) * 100) / 100;
  }
}
function txAfterSave(x){
  if(!x._split) return;
  var sp = x._split; delete x._split;
  sp.names.forEach(function(nm){
    var d = { id: newId(), dir: 'out', who: nm, amt: x.amt, paid: 0, date: x.date, due: null, note: (x.note || t(x.cat)) + ' · ' + t('бөлінген'), acc: x.acc, hist: [] };
    var a = acc(d.acc); if(a) a.bal += toAcc(a, -d.amt);
    DB.debts.push(d);
  });
  setTimeout(function(){ toast(t('Бөлінді') + ': ' + sp.names.length + ' ' + t('адамға қарыз жазылды')); }, 900);
}

/* =========================================================
   4. КАПИТАЛ ТАРИХЫ
   ========================================================= */
function recordNW(){
  DB.nw = DB.nw || {};
  var k = ym(new Date()), v = Math.round(totals().net);
  if(DB.nw[k] !== v){ DB.nw[k] = v; return true; }
  return false;
}
function nwSeries(n){
  var now = new Date(), cur = totals().net, flows = {}, out = [];
  DB.tx.forEach(function(x){ if(x.type === 'tr' || !x.date) return; var k = x.date.slice(0, 7); flows[k] = (flows[k] || 0) + (x.type === 'in' ? x.amt : -x.amt); });
  var running = cur;
  for(var i = 0; i < n; i++){
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1), k = ym(d);
    var v = i === 0 ? cur : (DB.nw && DB.nw[k] !== undefined ? DB.nw[k] : running);
    out.unshift({ k: k, m: d.getMonth(), y: d.getFullYear(), v: v, real: i === 0 || (DB.nw && DB.nw[k] !== undefined) });
    running = (i === 0 ? cur : v) - (flows[k] || 0);
  }
  return out;
}
function nwCard(){
  var s = nwSeries(12); if(!DB.tx.length) return '';
  var vals = s.map(function(p){ return p.v; }), mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
  if(mx === mn){ mx += 1; mn -= 1; }
  var W = 320, H = 110, pad = 6;
  var pts = s.map(function(p, i){ return [pad + i * (W - pad * 2) / (s.length - 1), pad + (1 - (p.v - mn) / (mx - mn)) * (H - pad * 2)]; });
  var line = pts.map(function(p, i){ return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + H + ' L' + pts[0][0].toFixed(1) + ' ' + H + ' Z';
  var yStart = s.filter(function(p){ return p.y === new Date().getFullYear(); })[0] || s[0];
  var dYear = s[s.length - 1].v - (s.indexOf(yStart) > 0 ? s[s.indexOf(yStart) - 1].v : yStart.v);
  var d12 = s[s.length - 1].v - s[0].v;
  var head = '<span class="more num ' + (dYear >= 0 ? 'pos' : 'neg') + '">' + (dYear >= 0 ? '+' : '') + moneyShort(dYear) + ' ' + t('биыл') + '</span>';
  var body = '<svg class="nw" viewBox="0 0 ' + W + ' ' + (H + 18) + '" preserveAspectRatio="none">' +
    '<defs><linearGradient id="nwg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--lime)" stop-opacity=".55"/><stop offset="1" stop-color="var(--lime)" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + area + '" fill="url(#nwg)"/><path class="nw-line" d="' + line + '" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
    pts.map(function(p, i){ return (i % 2 === (s.length - 1) % 2 ? '<text x="' + p[0].toFixed(1) + '" y="' + (H + 14) + '" text-anchor="middle">' + monShort(s[i].m) + '</text>' : '') +
      (i === pts.length - 1 ? '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4.5" fill="var(--lime)" stroke="var(--ink)" stroke-width="2"/>' : ''); }).join('') + '</svg>' +
    '<div class="stat3" style="margin-top:8px"><div><span>' + t('Қазір') + '</span><b class="num">' + moneyShort(s[s.length - 1].v) + '</b></div>' +
    '<div><span>' + t('12 ай бұрын') + '</span><b class="num">' + moneyShort(s[0].v) + '</b></div>' +
    '<div><span>' + t('12 айда') + '</span><b class="num ' + (d12 >= 0 ? 'pos' : 'neg') + '">' + (d12 >= 0 ? '+' : '') + moneyShort(d12) + '</b></div></div>' +
    '<p class="muted" style="font-size:11.5px;margin:8px 0 0">' + t('Өткен айлар кіріс-шығыннан шамамен есептелген.') + '</p>';
  return card(t('Капитал тарихы'), body, head);
}

/* =========================================================
   7. ШЫҒЫН КҮНТІЗБЕСІ
   ========================================================= */
function heatCard(key){
  var d0 = parseISO(key + '-01'), y = d0.getFullYear(), m = d0.getMonth(), dim = new Date(y, m + 1, 0).getDate();
  var day = {}, mx = 0;
  DB.tx.forEach(function(x){ if(x.type === 'out' && (x.date || '').slice(0, 7) === key){ var d = +x.date.slice(8); day[d] = (day[d] || 0) + x.amt; } });
  Object.keys(day).forEach(function(k){ mx = Math.max(mx, day[k]); });
  if(!mx) return '';
  var first = (d0.getDay() + 6) % 7, td = todayISO();
  var h = '<div class="heat">' + ['Дс','Сс','Ср','Бс','Жм','Сб','Жс'].map(function(w){ return '<i>' + t(w) + '</i>'; }).join('');
  for(var i = 0; i < first; i++) h += '<span></span>';
  for(var d = 1; d <= dim; d++){
    var v = day[d] || 0, lv = v ? Math.min(4, 1 + Math.floor(v / mx * 3.999)) : 0, ds = key + '-' + String(d).padStart(2, '0');
    h += '<button class="hc l' + lv + (ds === td ? ' td' : '') + '" ' + (v ? 'onclick="opsF={type:\'out\',acc:\'\',q:\'\',cat:\'\',mon:\'\',day:\'' + ds + '\'};go(\'ops\')"' : 'disabled') + ' title="' + (v ? money(v) : '') + '">' + d + '</button>';
  }
  h += '</div><div class="legend" style="justify-content:flex-end"><span>' + t('Аз') + '</span>' + [1, 2, 3, 4].map(function(l){ return '<i class="hc l' + l + '" style="width:14px;height:14px;border-radius:4px"></i>'; }).join('') + '<span>' + t('Көп') + '</span></div>';
  var busiest = Object.keys(day).sort(function(a, b){ return day[b] - day[a]; })[0];
  return card(t('Шығын күнтізбесі'), h, '<span class="more num">' + t('ең көп') + ': ' + busiest + ' ' + monShort(m) + '</span>');
}

/* =========================================================
   НӘТИЖЕ бетіне қосымша карталар
   ========================================================= */
function statsExtra(key, M){
  var y = parseISO(key + '-01').getFullYear();
  return insightsCard(key, M) + heatCard(key) + nwCard() +
    '<button class="card" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:var(--hero);color:var(--hero-ink)" onclick="go(\'year\',\'' + y + '\')">' +
    '<span style="width:40px;height:40px;border-radius:14px;display:grid;place-items:center;background:var(--lime);color:#141412;flex:none">' + ic('gift') + '</span>' +
    '<span style="flex:1"><b style="font-size:15px;display:block">' + y + ' — ' + t('жылдық қорытынды') + '</b><span style="font-size:12.5px;color:var(--hero-mute)">' + t('Жыл қалай өтті — бір бетте') + '</span></span>' + ic('right') + '</button>';
}

/* =========================================================
   8. ЖЫЛДЫҚ ҚОРЫТЫНДЫ  +  9. КЭШБЭК
   ========================================================= */
function cashbackYear(y){
  var s = 0; DB.tx.forEach(function(x){ if(x.type === 'in' && x.cat === 'Кэшбэк' && (x.date || '').slice(0, 4) === String(y)) s += x.amt; }); return s;
}
function yearStats(y){
  var Y = String(y), r = { in: 0, out: 0, n: 0, cats: {}, months: {}, big: null, cb: cashbackYear(y), days: {} };
  DB.tx.forEach(function(x){
    if((x.date || '').slice(0, 4) !== Y || x.type === 'tr') return;
    r.n++; r[x.type] += x.amt;
    var mk = x.date.slice(5, 7); r.months[mk] = r.months[mk] || { in: 0, out: 0 }; r.months[mk][x.type] += x.amt;
    if(x.type === 'out'){
      r.cats[x.cat] = (r.cats[x.cat] || 0) + x.amt;
      if(!r.big || x.amt > r.big.amt) r.big = x;
      r.days[x.date] = 1;
    }
  });
  return r;
}
PAGES.year = function(){
  var years = {}; DB.tx.forEach(function(x){ if(x.date) years[x.date.slice(0, 4)] = 1; });
  var ys = Object.keys(years).sort(), y = +(sub || new Date().getFullYear());
  var R = yearStats(y), h = topBar(y + ' ' + t('жыл'), t('Жылдық қорытынды'), R.n ? '<button class="ibtn" onclick="shareYear(' + y + ')" aria-label="' + t('Бөлісу') + '">' + ic('upload') + '</button>' : '');
  if(ys.length > 1) h += '<div class="chips" style="margin-bottom:10px">' + ys.map(function(v){ return '<button class="chip ' + (+v === y ? 'on' : '') + '" onclick="go(\'year\',\'' + v + '\',true)">' + v + '</button>'; }).join('') + '</div>';
  if(!R.n) return h + '<div class="card empty">' + ic('cal') + t('Бұл жылы операция жоқ.') + '</div>';
  var saved = R.in - R.out, cats = Object.keys(R.cats).sort(function(a, b){ return R.cats[b] - R.cats[a]; });
  var mk = Object.keys(R.months).filter(function(k){ return R.months[k].out > 0; });
  var maxM = mk.slice().sort(function(a, b){ return R.months[b].out - R.months[a].out; })[0], minM = mk.slice().sort(function(a, b){ return R.months[a].out - R.months[b].out; })[0];
  h += '<div class="hero yr"><div class="lab">' + t('Жыл бойы жинадыңыз') + '</div><div class="big num" style="margin-bottom:10px">' + (saved < 0 ? '−' : '+') + nf(saved) + '<small>' + S() + '</small></div>' +
    '<div class="hrow"><div class="cell"><span>' + t('Табыс') + '</span><b class="num">' + moneyShort(R.in) + '</b></div><div class="cell"><span>' + t('Шығын') + '</span><b class="num">' + moneyShort(R.out) + '</b></div></div></div>';
  h += '<div class="grid2">' +
    yrTile('receipt', t('Операция'), R.n) +
    yrTile('percent', t('Жинақ үлесі'), R.in ? Math.round(saved / R.in * 100) + '%' : '—') +
    (maxM ? yrTile('invest', t('Ең қымбат ай'), monName(+maxM - 1) + '<small>' + moneyShort(R.months[maxM].out) + '</small>') : '') +
    (minM && minM !== maxM ? yrTile('check', t('Ең үнемді ай'), monName(+minM - 1) + '<small>' + moneyShort(R.months[minM].out) + '</small>') : '') + '</div>';
  if(cats.length) h += card(t('Ақша ең көп кеткен жер'), cats.slice(0, 5).map(function(c, i){
    var pct = R.cats[c] / R.out * 100;
    return '<div class="row" style="padding:9px 0;background:none"><b class="yr-n">' + (i + 1) + '</b>' + catIc(c) + '<span class="mid"><b>' + esc(t(c)) + '</b><div class="prog" style="height:4px;margin-top:6px"><i style="width:' + pct.toFixed(1) + '%;background:' + catMeta(c)[1] + '"></i></div></span><span class="amt num">' + moneyShort(R.cats[c]) + '<small>' + Math.round(pct) + '%</small></span></div>';
  }).join(''));
  var extra = '';
  if(R.big) extra += kv(t('Ең үлкен шығын'), esc(R.big.note || t(R.big.cat)) + ' · ' + money(R.big.amt));
  extra += kv(t('Шығын болған күн'), Object.keys(R.days).length);
  if(R.cb) extra += kv(t('Кэшбэк'), '<span class="pos">+' + money(R.cb) + '</span>');
  extra += kv(t('Айына орташа шығын'), money(R.out / Math.max(1, mk.length)));
  h += card(t('Қызықты деректер'), extra);
  return h;
};
function yrTile(icn, label, val){ return '<div class="tile" style="min-height:0"><span class="ti">' + ic(icn) + '</span><div><span>' + label + '</span><b class="num yr-v">' + val + '</b></div></div>'; }
function shareYear(y){
  var R = yearStats(y), saved = R.in - R.out, cats = Object.keys(R.cats).sort(function(a, b){ return R.cats[b] - R.cats[a]; }).slice(0, 3);
  var txt = 'Qarzhy · ' + y + '\n' + t('Табыс') + ': ' + money(R.in) + '\n' + t('Шығын') + ': ' + money(R.out) + '\n' + t('Жыл бойы жинадыңыз') + ': ' + money(saved) +
    (cats.length ? '\n' + t('Ақша ең көп кеткен жер') + ': ' + cats.map(function(c){ return t(c); }).join(', ') : '') + '\n\nnn16nn.github.io/qarzhy';
  if(navigator.share) navigator.share({ title: 'Qarzhy ' + y, text: txt }).catch(function(){});
  else if(navigator.clipboard) navigator.clipboard.writeText(txt).then(function(){ toast('Көшірілді'); });
}

/* =========================================================
   6. НЕСИЕЛЕРДІ ЖАБУ ЖОСПАРЫ (есептегіш)
   ========================================================= */
CI.payoff = { extra: 20000 };
function payoffSim(order, extra){
  var L = accsOf('debt').filter(function(a){ return a.bal > 0 && a.pay > 0; }).map(function(a){ return { id: a.id, name: a.name, bal: a.bal, r: (a.rate || 0) / 1200, pay: a.pay, done: 0 }; });
  if(!L.length) return null;
  if(order === 'aval') L.sort(function(a, b){ return b.r - a.r || a.bal - b.bal; });
  else if(order === 'snow') L.sort(function(a, b){ return a.bal - b.bal || b.r - a.r; });
  if(order === 'none' && L.some(function(l){ return l.pay <= l.bal * l.r; })) return { m: -1, interest: 0, L: L };
  var m = 0, interest = 0, roll = order !== 'none';
  while(L.some(function(l){ return l.bal > 0.5; }) && m < 600){
    m++;
    var pool = roll ? extra : 0;
    L.forEach(function(l){
      if(l.bal <= 0.5){ if(roll) pool += l.pay; return; }
      var i = l.bal * l.r; interest += i; l.bal += i;
      var p = Math.min(l.pay, l.bal); l.bal -= p;
      if(roll) pool += l.pay - p;
      if(l.bal <= 0.5){ l.bal = 0; l.done = l.done || m; }
    });
    if(roll) L.forEach(function(l){
      if(l.bal <= 0.5 || pool <= 0) return;
      var p = Math.min(pool, l.bal); l.bal -= p; pool -= p;
      if(l.bal <= 0.5){ l.bal = 0; l.done = l.done || m; }
    });
  }
  return { m: m, interest: interest, L: L };
}
CALC_FORM.payoff = function(){
  var ls = accsOf('debt').filter(function(a){ return a.bal > 0; });
  if(!ls.length) return '<div class="empty">' + t('Несие жоқ — тамаша.') + '</div>';
  var miss = ls.filter(function(a){ return !(a.pay > 0); });
  return cIn('payoff', 'extra', 'Айына қосымша сала аласыз', S()) +
    (miss.length ? '<p class="muted" style="font-size:12.5px;margin:10px 2px 0">' + t('Айлық төлемі жазылмаған несиелер есепке кірмейді') + ': ' + miss.map(function(a){ return esc(a.name); }).join(', ') + '</p>' : '');
};
CALC_RUN.payoff = function(){
  var base = payoffSim('none', 0), av = payoffSim('aval', CI.payoff.extra), sn = payoffSim('snow', CI.payoff.extra);
  if(!base || !av) return '';
  var best = av.interest <= sn.interest ? av : sn;
  var first = best.L.slice().sort(function(a, b){ return a.done - b.done; })[0];
  var h = resultBox('Барлық несие жабылады', best.m > 0 ? best.m + ' ' + t('айда') : '—',
    [['Үнемделетін пайыз', base.m > 0 ? moneyShort(Math.max(0, base.interest - best.interest)) : '—'], ['Ерте жабылады', base.m > 0 ? (base.m - best.m) + ' ' + t('ай') : '—'], ['Бірінші жабыңыз', esc(first.name)]]);
  if(Math.abs(av.interest - sn.interest) < 1) h += '<p class="muted" style="font-size:12.5px;margin:10px 6px 0">' + t('Сіздің несиелеріңізде екі тәсіл бірдей нәтиже береді.') + '</p>';
  h += '<div class="card"><h2>' + t('Екі тәсілді салыстыру') + '</h2>' +
    kv(t('Қымбатынан бастау') + ' <span class="tag">' + t('пайызы жоғары') + '</span>', av.m + ' ' + t('ай') + ' · ' + moneyShort(av.interest)) +
    kv(t('Кішісінен бастау') + ' <span class="tag">' + t('қалдығы аз') + '</span>', sn.m + ' ' + t('ай') + ' · ' + moneyShort(sn.interest)) +
    kv(t('Қосымшасыз'), base.m > 0 ? base.m + ' ' + t('ай') + ' · ' + moneyShort(base.interest) : t('айлық төлем пайызды жаппайды')) + '</div>';
  h += '<div class="card"><h2>' + t('Жабу реті') + '</h2>' + best.L.slice().sort(function(a, b){ return a.done - b.done; }).map(function(l, i){
    return '<div class="row" style="padding:9px 0;background:none"><b class="yr-n">' + (i + 1) + '</b><span class="mid"><b>' + esc(l.name) + '</b><span>' + (l.r * 1200).toFixed(1).replace('.', ',') + '% · ' + t('айына') + ' ' + moneyShort(l.pay) + '</span></span><span class="amt num">' + l.done + ' ' + t('айда') + '</span></div>';
  }).join('') + '<p class="muted" style="font-size:12.5px;margin:8px 0 0">' + t('Бір несие жабылғанда, оның айлық төлемі келесісіне қосылады.') + '</p></div>';
  return h;
};

/* =========================================================
   ШОТТАР бетіне: зейнетақы + несие жоспары
   ========================================================= */
function accountsExtra(){
  var h = '<div class="sec">' + t('Тағы') + '</div><div class="list">';
  var p = DB.pension;
  h += linkRow('lock', t('Зейнетақы (ЕНПФ)'), p && p.bal ? money(p.bal) + ' · ' + fullDate(p.asOf) : t('Үзінді жүктеп, жинағыңызды көріңіз'), "go('pension')");
  var ls = accsOf('debt').filter(function(a){ return a.bal > 0 && a.pay > 0; });
  if(ls.length) h += linkRow('card', t('Несиелерді жабу жоспары'), ls.length > 1 ? t('Қайсысын бірінші жабу тиімді') : t('Қосымша төлеп ерте жабу'), "go('calc','payoff')");
  return h + '</div>';
}

/* =========================================================
   10. ТӨТЕНШЕ ҚОР
   ========================================================= */
function goalsExtra(){
  if(DB.goals.some(function(g){ return g.kind === 'emergency'; }) || DB.pref.noEmerg) return '';
  var a = avgOut(ym(new Date()), 3); if(!(a > 0)) return '';
  var target = Math.ceil(a * 3 / 1000) * 1000;
  return '<div class="card" style="background:var(--hero);color:var(--hero-ink)"><div style="display:flex;gap:12px;align-items:flex-start">' +
    '<span style="width:40px;height:40px;border-radius:14px;display:grid;place-items:center;background:var(--lime);color:#141412;flex:none">' + ic('lock') + '</span>' +
    '<div style="flex:1"><b style="font-size:15px">' + t('Төтенше қор') + '</b><div style="font-size:13px;color:var(--hero-mute);margin-top:3px">' + t('3 айлық шығыныңыз') + ' — <b class="num" style="color:var(--hero-ink)">' + money(target) + '</b>. ' + t('Жұмыссыз қалсаңыз не ауырсаңыз, осы сома 3 ай жеткізеді.') + '</div></div></div>' +
    '<div class="btns" style="margin-top:12px"><button class="btn sm" style="flex:1;background:var(--lime);color:#141412" onclick="addEmergency(' + target + ')">' + t('Мақсат етіп қою') + '</button>' +
    '<button class="btn sm" style="flex:none;background:transparent;color:var(--hero-mute)" onclick="DB.pref.noEmerg=1;save();render()">' + t('Керек емес') + '</button></div></div>';
}
function addEmergency(target){
  DB.goals.unshift({ id: newId(), name: t('Төтенше қор'), target: target, saved: 0, due: null, kind: 'emergency', hist: [] });
  save(); render(); toast('Мақсат қосылды'); buzz();
}

/* =========================================================
   11. ЧЕКТЕН ОҚУ
   ========================================================= */
var CDN_OCR = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
function startScan(){
  var inp = $('file-scan');
  if(!inp){ inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment'); inp.id = 'file-scan'; inp.className = 'hide'; document.body.appendChild(inp);
    inp.onchange = function(){ var f = this.files[0]; this.value = ''; if(f) scanReceipt(f); }; }
  inp.click();
}
function scanReceipt(f){
  openTx('out');
  toast('Чек оқылып жатыр…');
  loadScript(CDN_OCR).then(function(){ return window.Tesseract.recognize(f, 'rus+eng'); }).then(function(r){
    var p = parseReceipt(r && r.data && r.data.text);
    F.note = p.note || '';
    if(p.amt) F.amt = p.amt;
    if(p.date && p.date <= todayISO()) F.date = p.date;
    if(F.note) noteHint();
    if(sheetOn) drawTxSheetKeep();
    toast(p.amt ? 'Чектен алынды — тексеріп, сақтаңыз' : 'Сома табылмады — қолмен жазыңыз');
  }).catch(function(){
    toast('Чекті оқу мүмкін болмады. Интернетті тексеріп, қайта көріңіз.');
  });
}

/* =========================================================
   12. ЗЕЙНЕТАҚЫ (ЕНПФ)
   ========================================================= */
function importENPF(lines){
  var R = parseENPF(lines);
  if(!R.accs.length || !R.bal) return false;
  var old = DB.pension || {};
  var p = { src: 'pdf', asOf: R.asOf || todayISO(), by: R.by || old.by || null, bm: R.bm || old.bm || null, bd: R.bd || null,
            bal: R.bal, opv: R.opv, thr: R.thr, epv: R.epv, accs: R.accs, rows: R.rows, emps: R.emps,
            sal: old.sal || null, yield: old.yield || null, noOpvr: !R.accs.some(function(a){ return a.k === 'opvr'; }),
            hist: (old.hist || []).filter(function(h){ return h.d !== (R.asOf || todayISO()); }) };
  p.hist.push({ d: p.asOf, v: p.bal });
  DB.pension = p; save();
  return true;
}
function pensionFile(){
  var inp = $('file-pension');
  if(!inp){ inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf,application/pdf'; inp.id = 'file-pension'; inp.className = 'hide'; document.body.appendChild(inp);
    inp.onchange = function(){
      var f = this.files[0]; this.value = ''; if(!f) return;
      toast('Үзінді оқылып жатыр…');
      readBuf(f).then(parsePDF).then(function(lines){
        if(!isENPF(lines)){ toast('Бұл ЕНПФ үзіндісі емес сияқты'); return; }
        if(importENPF(lines)){ render(); toast('ЕНПФ үзіндісі жүктелді'); } else toast('ЕНПФ үзіндісі танылмады');
      }).catch(function(){ toast('Файлды оқу мүмкін болмады. Интернетті тексеріңіз.'); });
    }; }
  inp.click();
}
PAGES.pension = function(){
  var p = DB.pension, h = topBar(t('Зейнетақы'), 'ЕНПФ · БЖЗҚ', p ? '<button class="ibtn" onclick="pensionFile()" aria-label="' + t('Жүктеу') + '">' + ic('upload') + '</button>' : '');
  if(!p || !p.bal){
    return h + '<div class="card drop" onclick="pensionFile()">' + ic('lock') + '<b>' + t('ЕНПФ үзіндісін жүктеңіз') + '</b><span class="muted" style="font-size:13.5px">' +
      t('enpf.kz немесе eGov қосымшасынан «Жеке шоттан үзінді» PDF файлын жүктеп алыңыз. Жинақ, табыс және жұмыс беруші аударымдары өзі шығады.') + '</span></div>';
  }
  var y12 = iso(new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1)), c12 = 0, inc = 0;
  (p.rows || []).forEach(function(r){ if((r.t === 'c' || r.t === 'p') && r.d >= y12) c12 += r.a; });
  (p.accs || []).forEach(function(a){ inc += a.inc || 0; });
  h += '<div class="hero"><div class="lab">' + t('Жалпы жинақ') + '<span class="pill" style="margin-left:auto">' + fullDate(p.asOf) + '</span></div><div class="big num">' + nf(p.bal) + '<small>₸</small></div>' +
    '<div class="hrow"><div class="cell"><span>' + t('12 айдағы жарна') + '</span><b class="num">' + moneyShort(c12) + '</b></div><div class="cell"><span>' + t('Инвест. табыс') + '</span><b class="num">' + (inc ? '+' : '') + moneyShort(inc) + '</b></div></div></div>';
  h += '<div class="sec">' + t('Шоттар') + '</div><div class="list">' + (p.accs || []).map(function(a){
    return '<div class="row"><span class="ci" style="background:var(--sf2)">' + ic(a.k === 'opvr' ? 'building' : 'lock') + '</span><span class="mid"><b>' + esc(a.name) + '</b><span>' +
      (a.y !== null && a.y !== undefined ? t('кірістілік') + ' ' + String(a.y).replace('.', ',') + '%' : '') + (a.inc ? ' · ' + t('табыс') + ' ' + moneyShort(a.inc) : '') + '</span></span><span class="amt num">' + money(a.bal) + '</span></div>';
  }).join('') + '</div>';
  var info = '';
  if(p.thr) info += kv(t('Жеткіліктілік шегі'), money(p.thr));
  if(p.epv) info += kv(t('Шектен асқан сома (алуға болады)'), '<span class="pos">' + money(p.epv) + '</span>');
  var emps = p.emps ? Object.keys(p.emps).map(function(k){ return p.emps[k]; }).filter(Boolean) : [];
  if(emps.length) info += kv(t('Жұмыс берушілер'), esc(emps.slice(0, 2).join(', ')));
  if(info) h += card(t('Мәлімет'), info);
  h += '<button class="btn red" onclick="ask(\'Зейнетақы деректері өшіріледі. Жалғастырасыз ба?\',function(){DB.pension=null;save();render();},\'Өшіру\')">' + ic('trash') + t('Өшіру') + '</button>';
  return h;
};

/* =========================================================
   13. САНАТ ЛИМИТТЕРІ
   ========================================================= */
function openCatLimits(){
  var list = CATS.out.filter(function(c){ return c !== 'Аударымдар' && c !== 'Несие төлемі'; });
  var key = ym(new Date()), cur = {}; catTotals(key, 'out').forEach(function(x){ cur[x.cat] = x.v; });
  openSheet(sheetHead(t('Санат лимиттері')) + '<p class="muted" style="margin:0 0 6px;font-size:13.5px">' + t('Айлық шек. Асып кетсе, басты бетте ескерту шығады. Бос қалдырсаңыз — шексіз.') + '</p>' +
    list.map(function(c){
      return '<div class="row" style="padding:8px 0;background:none">' + catIc(c) + '<span class="mid"><b>' + esc(t(c)) + '</b><span class="num">' + t('бұл айда') + ' ' + moneyShort(cur[c] || 0) + '</span></span>' +
        '<input class="in" data-cat="' + esc(c) + '" inputmode="decimal" style="width:120px;padding:10px 12px;text-align:right" placeholder="—" value="' + (DB.limits[c] || '') + '"></div>';
    }).join('') + '<button class="btn" onclick="saveCatLimits()">' + ic('check') + t('Сақтау') + '</button>');
}
function saveCatLimits(){
  document.querySelectorAll('#sheet input[data-cat]').forEach(function(e){ var v = num(e.value); if(v > 0) DB.limits[e.dataset.cat] = v; else delete DB.limits[e.dataset.cat]; });
  done('Сақталды');
}
function homeAlerts(){
  var key = ym(new Date()), h = '';
  catTotals(key, 'out').forEach(function(c){
    var lim = DB.limits[c.cat];
    if(lim > 0 && c.v > lim) h += alertRow('bell', t(c.cat) + ' — ' + t('лимит асты') + ': ' + moneyShort(c.v) + ' / ' + moneyShort(lim), "statsKind='out';statsMon=null;go('stats')");
  });
  return h;
}

/* ---------- іске қосу: капиталды ай сайын жазу ---------- */
document.addEventListener('DOMContentLoaded', function(){
  var tries = 0;
  (function wait(){
    if(window.idbChecked || tries++ > 40){ if(recordNW()) save(); return; }
    setTimeout(wait, 150);
  })();
});
