/* Qarzhy 2 — есептегіштер және банк үзіндісін импорттау */
'use strict';

/* ================= ЕСЕПТЕГІШ ================= */
var CI = {
  loan: { amt: 2000000, rate: 24, months: 24, type: 'ann', extra: 0 },
  dep:  { amt: 1000000, rate: 14, months: 12, top: 0, cap: true },
  inv:  { amt: 500000, month: 50000, rate: 12, years: 10, re: true, cur: '', goal: 0 },
  tax:  { income: 3000000, rate: 4, months: 6, mzp: 85000, declared: 85000 }
};
var CALCS = [
  ['loan', 'card', 'Несие', 'Ай төлем · артық төлем · кесте'],
  ['dep', 'bank', 'Депозит', 'Капитализация · толықтыру'],
  ['inv', 'invest', 'Инвестиция', 'Күрделі пайыз · мақсатқа жету'],
  ['split', 'split', 'Жалақы бөлу', 'Айлықты пайызбен бөлу'],
  ['tax', 'percent', 'ЖК салығы', 'Оңайлатылған декларация · 910', 'KZT']
];
PAGES.calc = function(){
  var c = CALCS.filter(function(x){ return x[0] === sub; })[0];
  if(!c){
    var h = topBar(t('Есептегіш'), t('Қаржылық есептеулер'));
    h += '<div class="list">' + CALCS.filter(function(x){ return !x[4] || x[4] === BASE(); }).map(function(x){ return linkRow(x[1], t(x[2]), t(x[3]), "go('calc','" + x[0] + "')"); }).join('') + '</div>';
    return h;
  }
  setTimeout(function(){ calcRun(c[0]); }, 0);
  return topBar(t(c[2]), t(c[3])) + '<div class="card" style="margin-top:4px">' + CALC_FORM[c[0]]() + '</div><div id="calc-out"></div>';
};
function cIn(k, f, label, suffix, mode){
  var v = CI[k][f];
  return '<label class="f"><span>' + t(label) + (suffix ? ', ' + suffix : '') + '</span><input class="in" inputmode="' + (mode || 'decimal') + '" value="' + (v === 0 ? '' : v) + '" placeholder="0" oninput="CI.' + k + '.' + f + '=num(this.value);calcRun(\'' + k + '\')"></label>';
}
function cSeg(k, f, opts){
  return '<div class="seg" style="margin-top:12px">' + opts.map(function(o){
    return '<button class="' + (CI[k][f] === o[0] ? 'on' : '') + '" onclick="CI.' + k + '.' + f + '=' + JSON.stringify(o[0]).replace(/"/g, "'") + ';this.parentNode.querySelectorAll(\'button\').forEach(function(b){b.classList.remove(\'on\')});this.classList.add(\'on\');calcRun(\'' + k + '\')">' + t(o[1]) + '</button>';
  }).join('') + '</div>';
}
var CALC_FORM = {
  loan: function(){ return cSeg('loan', 'type', [['ann', 'Аннуитет'], ['diff', 'Дифференциал']]) + cIn('loan', 'amt', 'Несие сомасы', S()) +
    '<div class="two">' + cIn('loan', 'rate', 'Жылдық мөлшерлеме', '%') + cIn('loan', 'months', 'Мерзімі', t('ай'), 'numeric') + '</div>' + cIn('loan', 'extra', 'Айына қосымша төлем (ерте өтеу)', S()); },
  dep: function(){ return cIn('dep', 'amt', 'Салым сомасы', S()) + '<div class="two">' + cIn('dep', 'rate', 'Жылдық мөлшерлеме', '%') + cIn('dep', 'months', 'Мерзімі', t('ай'), 'numeric') + '</div>' +
    cIn('dep', 'top', 'Ай сайын толықтыру', S()) + cSeg('dep', 'cap', [[true, 'Капитализациямен'], [false, 'Капитализациясыз']]); },
  inv: function(){ if(!CI.inv.cur) CI.inv.cur = S(); return (BASE() === 'USD' ? '' : cSeg('inv', 'cur', [[S(), S() + ' ' + BASE()], ['$', '$ USD']])) + '<div class="two">' + cIn('inv', 'amt', 'Бастапқы сома') + cIn('inv', 'month', 'Ай сайын салу') + '</div>' +
    '<div class="two">' + cIn('inv', 'rate', 'Жылдық табыс', '%') + cIn('inv', 'years', 'Мерзімі', t('жыл'), 'numeric') + '</div>' + cIn('inv', 'goal', 'Мақсатты сома (міндетті емес)') +
    cSeg('inv', 're', [[true, 'Реинвестиция'], [false, 'Табысты алу']]); },
  tax: function(){ return cIn('tax', 'income', 'Кезеңдегі табыс', '₸') + '<div class="two">' + cIn('tax', 'rate', 'Салық мөлшерлемесі', '%') + cIn('tax', 'months', 'Ай саны', '', 'numeric') + '</div>' +
    '<div class="two">' + cIn('tax', 'declared', 'Өзіңізге айлық табыс', '₸') + cIn('tax', 'mzp', 'ЕТЖ (МЗП)', '₸') + '</div>' +
    '<p class="muted" style="font-size:12.5px;margin:10px 2px 0">' + t('2026 ж. базалық мөлшерлеме — 4%, маслихат оны өзгерте алады. Өз өңіріңіздің мөлшерлемесін тексеріңіз.') + '</p>'; },
  split: function(){ splitInit(); return '<label class="f" style="margin-top:0"><span>' + t('Айлық сомасы') + ', ' + S() + '</span><input class="in" inputmode="decimal" value="' + (SPL.sum || '') + '" placeholder="0" oninput="SPL.sum=num(this.value);splitSave();calcRun(\'split\')"></label>'; }
};
function calcRun(k){
  var box = $('calc-out'); if(!box) return;
  box.innerHTML = CALC_RUN[k]();
}
function resultBox(label, big, cells){
  return '<div class="result"><span>' + t(label) + '</span><b class="num">' + big + '</b><div class="stat3">' + cells.map(function(c){ return '<div><span>' + t(c[0]) + '</span><b class="num">' + c[1] + '</b></div>'; }).join('') + '</div></div>';
}
function loanSchedule(c){
  var P = c.amt, i = c.rate / 1200, n = Math.max(1, Math.round(c.months)), rows = [], bal = P, ann = i > 0 ? P * i / (1 - Math.pow(1 + i, -n)) : P / n;
  for(var m = 1; m <= 600 && bal > 0.5; m++){
    var int = bal * i, princ, pay;
    if(c.type === 'ann'){ pay = ann + (c.extra || 0); princ = pay - int; }
    else { princ = P / n + (c.extra || 0); pay = princ + int; }
    if(princ > bal){ princ = bal; pay = princ + int; }
    bal -= princ;
    rows.push([m, pay, int, princ, Math.max(0, bal)]);
    if(c.type === 'ann' && pay <= int) break;
  }
  return rows;
}
var CALC_RUN = {
  loan: function(){
    var c = CI.loan; if(c.amt <= 0 || c.months <= 0) return '';
    var rows = loanSchedule(c), base = loanSchedule({ amt: c.amt, rate: c.rate, months: c.months, type: c.type, extra: 0 });
    var tot = 0, ints = 0, bInt = 0; rows.forEach(function(r){ tot += r[1]; ints += r[2]; }); base.forEach(function(r){ bInt += r[2]; });
    var first = rows[0] ? rows[0][1] : 0, last = rows.length ? rows[rows.length - 1][1] : 0;
    var h = resultBox('Ай сайынғы төлем', c.type === 'ann' ? money(first) : money(first) + ' → ' + moneyShort(last),
      [['Артық төлем', moneyShort(ints)], ['Барлығы', moneyShort(tot)], ['Мерзім', rows.length + ' ' + t('ай')]]);
    if(c.extra > 0) h += '<div class="card"><b>' + t('Ерте өтеу әсері') + '</b><div class="muted" style="margin-top:4px;font-size:14px">' + (base.length - rows.length) + ' ' + t('ай ерте жабылады') + ' · ' + t('пайыз үнемі') + ' <b class="pos num">' + money(bInt - ints) + '</b></div></div>';
    h += '<div class="card"><h2>' + t('Төлем кестесі') + '</h2><div class="scrollx"><table class="t"><tr><th>' + t('Ай') + '</th><th>' + t('Төлем') + '</th><th>' + t('Пайыз') + '</th><th>' + t('Қалдық') + '</th></tr>' +
      rows.map(function(r){ return '<tr><td>' + r[0] + '</td><td>' + nf(r[1]) + '</td><td>' + nf(r[2]) + '</td><td>' + nf(r[4]) + '</td></tr>'; }).join('') + '</table></div></div>';
    return h;
  },
  dep: function(){
    var c = CI.dep; if(c.amt <= 0 && c.top <= 0) return '';
    var i = c.rate / 1200, bal = c.amt, paidOut = 0, put = c.amt;
    for(var m = 1; m <= Math.round(c.months); m++){
      var int = bal * i;
      if(c.cap) bal += int; else paidOut += int;
      if(m < Math.round(c.months) && c.top > 0){ bal += c.top; put += c.top; }
    }
    var fin = bal + paidOut, inc = fin - put;
    return resultBox('Мерзім соңында', money(fin), [['Салғаныңыз', moneyShort(put)], ['Табыс', '<span class="pos">+' + moneyShort(inc) + '</span>'], ['Айына орташа', moneyShort(inc / Math.max(1, c.months))]]) +
      '<p class="muted" style="font-size:12.5px;margin:10px 6px">' + t('Есеп шамамен: салық пен банк шарттары ескерілмеген.') + '</p>';
  },
  inv: function(){
    var c = CI.inv, s = c.cur, i = c.rate / 1200, bal = c.amt, put = c.amt, taken = 0, years = [], goalM = 0;
    for(var m = 1; m <= Math.round(c.years * 12); m++){
      var int = bal * i;
      if(c.re) bal += int; else taken += int;
      bal += c.month; put += c.month;
      if(c.goal > 0 && !goalM && bal + taken >= c.goal) goalM = m;
      if(m % 12 === 0) years.push([m / 12, put, bal + taken]);
    }
    if(c.goal > 0 && !goalM){ var b2 = bal, m2 = Math.round(c.years * 12); while(b2 < c.goal && m2 < 1200){ b2 = b2 * (1 + i) + c.month; m2++; } if(b2 >= c.goal) goalM = m2; }
    var fin = bal + taken, prof = fin - put;
    var h = resultBox('Мерзім соңында', money(fin, s), [['Салғаныңыз', moneyShort(put, s)], ['Табыс', '<span class="pos">+' + moneyShort(prof, s) + '</span>'], ['Өсім', put ? '×' + (fin / put).toFixed(2).replace('.', ',') : '—']]);
    if(c.goal > 0) h += '<div class="card"><b>' + t('Мақсатқа жету') + '</b><div class="muted" style="margin-top:4px;font-size:14px">' + (goalM ? Math.floor(goalM / 12) + ' ' + t('жыл') + ' ' + (goalM % 12) + ' ' + t('ай') : t('100 жылда да жетпейді')) + '</div></div>';
    if(years.length) h += '<div class="card"><h2>' + t('Жыл сайын') + '</h2><div class="scrollx"><table class="t"><tr><th>' + t('Жыл') + '</th><th>' + t('Салынды') + '</th><th>' + t('Барлығы') + '</th></tr>' +
      years.map(function(y){ return '<tr><td>' + y[0] + '</td><td>' + nf(y[1]) + '</td><td><b>' + nf(y[2]) + '</b></td></tr>'; }).join('') + '</table></div></div>';
    return h;
  },
  tax: function(){
    var c = CI.tax; if(c.income <= 0) return '';
    var mzp = c.mzp || 85000, dec = Math.max(c.declared || mzp, mzp), m = Math.round(c.months) || 6;
    var ipn = c.income * c.rate / 100, opv = dec * 0.10 * m, so = dec * 0.05 * m, vosms = 1.4 * mzp * 0.05 * m, sum = ipn + opv + so + vosms;
    return resultBox('Барлығы төлеу керек', money(sum), [['Табыс салығы', moneyShort(ipn)], ['Әлеуметтік', moneyShort(opv + so + vosms)], ['Қолда қалады', moneyShort(c.income - sum)]]) +
      '<div class="card">' + kv(t('Табыс салығы') + ' (' + c.rate + '%)', money(ipn)) + kv(t('ОПВ · 10%'), money(opv)) + kv(t('СО · 5%'), money(so)) + kv(t('ВОСМС · 5% × 1,4 ЕТЖ'), money(vosms)) + '</div>' +
      '<p class="muted" style="font-size:12.5px;margin:10px 6px">' + t('Есеп шамамен. Нақты сомасын КГД немесе бухгалтермен тексеріңіз.') + '</p>';
  },
  split: function(){
    var tot = 0; SPL.items.forEach(function(x){ tot += x.pct; });
    var h = '<div class="card"><h2>' + t('Бөлімдер') + '<span class="more ' + (Math.round(tot) === 100 ? 'pos' : 'neg') + '">' + Math.round(tot) + '%</span></h2>';
    h += SPL.items.map(function(x, i){
      var col = SPLIT_COL[i % SPLIT_COL.length];
      return '<div style="display:flex;gap:8px;align-items:center;margin-top:8px"><i class="dot" style="background:' + col + ';width:10px;height:10px"></i>' +
        '<input class="in" style="flex:1;padding:10px 12px" value="' + esc(x.name) + '" oninput="SPL.items[' + i + '].name=this.value;splitSave()">' +
        '<input class="in" style="width:70px;padding:10px;text-align:center" inputmode="decimal" value="' + x.pct + '" oninput="SPL.items[' + i + '].pct=num(this.value);splitSave();splitAmounts()">' +
        '<b class="num" id="spl-' + i + '" style="width:92px;text-align:right;font-size:14px">' + moneyShort(SPL.sum * x.pct / 100) + '</b>' +
        '<button class="ibtn" style="width:34px;height:34px;box-shadow:none;background:var(--sf2)" onclick="SPL.items.splice(' + i + ',1);splitSave();calcRun(\'split\')">' + ic('x') + '</button></div>';
    }).join('');
    h += '<div class="btns" style="margin-top:12px"><button class="btn line sm" style="flex:1" onclick="SPL.items.push({name:t(\'Жаңа бөлім\'),pct:0,to:\'\'});splitSave();calcRun(\'split\')">' + ic('plus') + t('Бөлім қосу') + '</button>' +
      '<button class="btn line sm" style="flex:1" onclick="SPL.items=SPLIT_DEF.map(function(x){return{name:t(x.name),pct:x.pct,to:\'\'}});splitSave();calcRun(\'split\')">' + t('Әдепкі 50/20/20/10') + '</button></div></div>';
    if(SPL.sum > 0){
      h += '<div class="card"><div style="display:flex;height:14px;border-radius:9px;overflow:hidden;gap:2px">' + SPL.items.map(function(x, i){ return x.pct > 0 ? '<i style="flex:' + x.pct + ';background:' + SPLIT_COL[i % SPLIT_COL.length] + '"></i>' : ''; }).join('') + '</div>' +
        '<p class="muted" style="font-size:13px;margin:10px 0 0">' + (Math.round(tot) === 100 ? t('Барлығы 100% — жоспар дайын.') : t('Пайыздардың жиыны 100% болуы керек.')) + '</p></div>';
    }
    return h;
  }
};
var SPLIT_DEF = [{ name: 'Қажеттілік', pct: 50 }, { name: 'Инвестиция', pct: 20 }, { name: 'Жинақ', pct: 20 }, { name: 'Өзіме', pct: 10 }];
var SPLIT_COL = ['#141412', '#169A55', '#C08A06', '#8B5CF6', '#E2474C', '#0A8FB0', '#E07A2F', '#7C776E'];
var SPL = null, splTm = null;
function splitInit(){
  if(SPL) return;
  var s = DB.split || {};
  SPL = { sum: s.sum || 0, src: s.src || null, applied: s.applied || null,
          items: (s.items && s.items.length ? s.items : SPLIT_DEF).map(function(x){ return { name: t(String(x.name || '')), pct: +x.pct || 0, to: x.to || '' }; }) };
}
function splitSave(){
  clearTimeout(splTm);
  splTm = setTimeout(function(){ DB.split = { sum: SPL.sum, src: SPL.src, applied: SPL.applied, items: SPL.items.map(function(x){ return { name: x.name, pct: x.pct, to: x.to || '' }; }) }; save(); }, 400);
}
function splitAmounts(){
  var tot = 0;
  SPL.items.forEach(function(x, i){ tot += x.pct; var e = $('spl-' + i); if(e) e.textContent = moneyShort(SPL.sum * x.pct / 100); });
  var hd = document.querySelector('#calc-out h2 .more'); if(hd){ hd.textContent = Math.round(tot) + '%'; hd.className = 'more ' + (Math.round(tot) === 100 ? 'pos' : 'neg'); }
}

/* ================= ИМПОРТ ================= */
var IMPV = { status: '', file: '' };
PAGES.import = function(){
  var h = topBar(t('Үзінді жүктеу'), 'PDF · Excel · CSV');
  if(IMPV.status === 'busy') return h + '<div class="card empty"><div class="spin"></div>' + t('Файл оқылып жатыр…') + '<br><b>' + esc(IMPV.file) + '</b></div>';
  if(!IMP.rows.length){
    h += '<label class="card drop" onclick="$(\'file-import\').click()">' + ic('upload') + '<b>' + t('Банк үзіндісін таңдаңыз') + '</b><span class="muted" style="font-size:13.5px">' +
      t('Kaspi, Freedom, Halyk, Forte — банк қосымшасынан айлық үзіндіні PDF немесе Excel түрінде жүктеп алыңыз. Операциялар өзі кіріс пен шығынға бөлініп, санаттары анықталады.') + '</span></label>';
    if(IMPV.status) h += '<div class="card empty">' + IMPV.status + '</div>';
    h += '<p class="muted" style="font-size:12.5px;margin:12px 6px">' + t('Файл тек телефонда оқылады, ешқайда жіберілмейді. Бірінші рет оқығанда интернет керек.') + '</p>';
    return h;
  }
  var on = IMP.rows.filter(function(r){ return r.on && !r.fx; }), sIn = 0, sOut = 0, dups = 0;
  on.forEach(function(r){ if(r.type === 'in') sIn += r.amt; else sOut += r.amt; });
  IMP.rows.forEach(function(r){ if(r.dup) dups++; });
  if(!acc(IMP.acc)) IMP.acc = (assets()[0] || {}).id;
  h += '<div class="card" style="margin-top:4px">' +
    (IMP.bank ? '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' + accBadge({ name: IMP.bank[0] }) + '<b>' + esc(IMP.fc && IMP.fc.title || IMP.bank[0]) + '</b></div>' : '') +
    '<label class="f" style="margin-top:6px"><span>' + t('Қай шотқа жазылады') + '</span><select class="in" onchange="IMP.acc=this.value;render()">' +
      assets().map(function(a){ return '<option value="' + a.id + '"' + (IMP.acc === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></label>';
  if(IMP.fc && IMP.fc.from){
    h += '<button class="toggle" style="width:100%;text-align:left" onclick="IMP.fc.replace=!IMP.fc.replace;render()"><span style="font-size:14px">' + t('Осы кезеңдегі ескі жазбаларды ауыстыру') + '<br><span class="muted" style="font-size:12.5px">' + fullDate(IMP.fc.from) + ' — ' + fullDate(IMP.fc.to) + '</span></span><i class="sw ' + (IMP.fc.replace ? 'on' : '') + '"></i></button>';
    if(IMP.fc.bal !== null && IMP.fc.bal !== undefined) h += '<button class="toggle" style="width:100%;text-align:left" onclick="IMP.fc.setBal=!IMP.fc.setBal;render()"><span style="font-size:14px">' + t('Шот қалдығын банктегімен теңестіру') + '<br><span class="muted num" style="font-size:12.5px">' + money(IMP.fc.bal) + '</span></span><i class="sw ' + (IMP.fc.setBal ? 'on' : '') + '"></i></button>';
  }
  h += '<div class="stat3" style="margin-top:10px"><div><span>' + t('Таңдалды') + '</span><b class="num">' + on.length + ' / ' + IMP.rows.length + '</b></div><div><span>' + t('Кіріс') + '</span><b class="num pos">' + moneyShort(sIn) + '</b></div><div><span>' + t('Шығын') + '</span><b class="num">' + moneyShort(sOut) + '</b></div></div>' +
    '<div class="btns" style="margin-top:10px"><button class="btn line sm" style="flex:1" onclick="impAll(true)">' + t('Барлығы') + '</button><button class="btn line sm" style="flex:1" onclick="impOnlyNew()">' + t('Тек жаңалары') + (dups ? ' (−' + dups + ')' : '') + '</button><button class="btn line sm" style="flex:1" onclick="impAll(false)">' + t('Ешқайсы') + '</button></div>' +
    '<button class="btn lime" onclick="importConfirm()">' + ic('check') + t('Қосу') + ' · ' + on.length + '</button>' +
    '<button class="btn line" onclick="IMP.rows=[];IMP.fc=null;IMPV.status=\'\';render()">' + t('Болдырмау') + '</button></div>';
  h += '<div class="list" style="margin-top:12px">' + IMP.rows.slice(0, 400).map(function(r, i){
    return '<label class="imp-row ' + (r.on ? '' : 'off') + '"><input type="checkbox" ' + (r.on ? 'checked' : '') + (r.fx ? ' disabled' : '') + ' onchange="IMP.rows[' + i + '].on=this.checked;render()">' +
      '<span class="mid"><b>' + esc(r.note || t(r.cat)) + '</b><span>' + fullDate(r.date) + ' · ' + esc(t(r.cat)) + (r.dup ? ' · <span class="tag">' + t('бар') + '</span>' : '') + (r.fx ? ' · <span class="tag">' + t('валюта') + '</span>' : '') + (r.pending ? ' · <span class="tag">' + t('расталмаған') + '</span>' : '') + '</span></span>' +
      '<b class="num ' + (r.type === 'in' ? 'pos' : '') + '" style="font-size:14px">' + signed(r.amt, r.type) + '</b></label>';
  }).join('') + '</div>';
  return h;
};
function impAll(v){ IMP.rows.forEach(function(r){ r.on = v && !r.fx; }); render(); }
function impOnlyNew(){ IMP.rows.forEach(function(r){ r.on = !r.dup && !r.fx && !r.pending; }); render(); }
function onImportFile(f){
  IMP.rows = []; IMP.fc = null; IMP.bank = null; IMP.mode = 'bank';
  IMPV.status = 'busy'; IMPV.file = f.name;
  if(page !== 'import') go('import'); else render();
  var name = f.name.toLowerCase(), task;
  if(/\.pdf$/.test(name)) task = readBuf(f).then(parsePDF);
  else if(/\.csv$/.test(name)) task = readText(f).then(parseCSV);
  else task = readBuf(f).then(parseXLSX);
  task.then(function(lines){
    var head = lines.slice(0, 40).join(' ') + ' ' + f.name;
    if(/(ЕНПФ|БЖЗҚ|enpf|Бірыңғай жинақтаушы зейнетақы|Единый накопительный пенсионный)/i.test(head)){
      IMPV.status = t('Бұл — ЕНПФ үзіндісі. Зейнетақы бөлімі жаңа нұсқаға кейін қосылады.'); render(); return;
    }
    var b = bankOf(head); IMP.bank = b ? [b[0]] : null;
    var rows;
    if(isFreedomCard(lines)){
      rows = parseFreedomCard(lines);
      var fi = freedomCardInfo(lines);
      IMP.bank = ['Freedom SuperApp'];
      rows.forEach(function(r){ r.dup = false; r.on = !r.fx && !r.pending; });
      rows.sort(function(a, b){ return a.date < b.date ? 1 : -1; });
      IMP.fc = { title: 'Freedom Bank', bal: fi.bal, from: fi.from, to: fi.to, replace: true, setBal: fi.bal !== null };
      DB.accounts.forEach(function(a){ if(a.kind === 'asset' && /freedom|фридом/i.test(a.name)) IMP.acc = a.id; });
    } else if(isKaspi(lines)){
      rows = parseKaspi(lines);
      var ki = kaspiInfo(lines);
      IMP.bank = ['Kaspi Bank'];
      rows.forEach(function(r){ r.dup = false; r.on = true; });
      IMP.fc = { title: 'Kaspi Gold', bal: ki.bal, from: ki.from, to: ki.to, replace: true, setBal: ki.bal !== null };
      DB.accounts.forEach(function(a){ if(a.kind === 'asset' && /kaspi|каспи/i.test(a.name)) IMP.acc = a.id; });
    } else {
      rows = extractRows(lines);
      if(IMP.bank) DB.accounts.forEach(function(a){ if(a.kind === 'asset' && bankOf(a.name) && bankOf(a.name)[0] === IMP.bank[0]) IMP.acc = a.id; });
    }
    applyRules(rows);
    IMPV.status = rows.length ? '' : t('Бұл файлдан операция табылмады. Excel (.xlsx) нұсқасын жүктеп көріңіз — ол әрқашан дәлірек оқылады.');
    IMP.rows = rows;
    render();
  }).catch(function(){
    IMPV.status = t('Файлды оқу мүмкін болмады. Бірінші рет оқығанда интернет қажет — интернетті қосып қайта көріңіз.');
    render();
  });
}
function importConfirm(){
  var sel = IMP.rows.filter(function(r){ return r.on && !r.fx; });
  if(!sel.length){ toast('Бірде-бір жазба белгіленбеген'); return; }
  if(!acc(IMP.acc)){ toast('Алдымен шот қосыңыз'); return; }
  var removed = 0;
  if(IMP.fc && IMP.fc.replace && IMP.fc.from){
    DB.tx = DB.tx.filter(function(x){
      if(x.acc === IMP.acc && x.date >= IMP.fc.from && x.date <= IMP.fc.to){ applyTx(x, -1); removed++; return false; }
      return true;
    });
  }
  sel.forEach(function(r){
    var x = { id: newId(), type: r.type, cat: r.cat, amt: r.amt, date: r.date, note: r.note === '—' ? '' : (r.note || ''), acc: IMP.acc, loan: null, to: null };
    DB.tx.push(x); applyTx(x, 1);
  });
  if(IMP.fc && IMP.fc.setBal && IMP.fc.bal !== null && IMP.fc.bal !== undefined){ var a = acc(IMP.acc); if(a) a.bal = IMP.fc.bal; }
  save();
  IMP.rows = []; IMP.fc = null; IMPV.status = '';
  toast(sel.length + ' ' + t('операция қосылды') + (removed ? ' · ' + removed + ' ' + t('ескі жазба ауыстырылды') : ''));
  opsF = { type: 'all', acc: '', q: '', cat: '', mon: '' };
  go('ops', '', true);
}
