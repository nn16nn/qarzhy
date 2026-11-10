/* Qarzhy 2 — банк үзіндісін оқу (ескі нұсқадан сол күйінде алынған, сыналған парсерлер) */
var CDN_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
var CDN_PDF  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var CDN_PDFW = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

var IMP = { rows: [], acc: null, mode: 'bank', brAcc: null };
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

/* ---- ЕНПФ үзіндісі (ескі нұсқадан) ---- */
var PN_KIND = { nb: 'ОПВ · Ұлттық банк', uip: 'ОПВ · ИПБ', opvr: 'ОПВР · жұмыс беруші' };
var PN_NUM = '\\d{1,3}(?: \\d{3})*\\.\\d{2}';
function pnNum(s){ return parseFloat(String(s).replace(/\s/g, '')); }
function isENPF(lines){
  var h = lines.slice(0, 80).join(' ');
  return /(ОПВ|МЗЖ)/.test(h) && /(ЕНПФ|БЖЗҚ|ИПС|ЖЗШ|УПС|пенсионн)/i.test(h) && /(достаточност|жеткіліктілік|Выписка с|үзінді)/i.test(lines.join(' '));
}
function parseENPF(lines){
  lines = lines.map(function(l){ return String(l).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim(); });
  var amtOnly = new RegExp('^(' + PN_NUM + ')(?:\\s*теңге\\*?)?$');
  function near(i, order){
    for(var k = 0; k < order.length; k++){
      var j = i + order[k]; if(j < 0 || j >= lines.length) continue;
      var m = lines[j].match(amtOnly); if(m) return pnNum(m[1]);
    }
    return null;
  }
  function isoD(s){ var m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : null; }
  var R = { asOf: null, by: null, bm: null, bd: null, thr: null, epv: null, accs: [], rows: [], emps: {} };
  var iin = null, empQ = {};
  for(var i = 0; i < Math.min(lines.length, 40); i++){
    var l = lines[i];
    if(!R.asOf){ var a = l.match(/по состоянию на (\d{2}\.\d{2}\.\d{4})/); if(a) R.asOf = isoD(a[1]); }
    var ii = l.match(/^(\d{12})\b/); if(ii && !iin) iin = ii[1];
    if(/Туған күні|Дата рождения/.test(l) && !R.by){
      for(var j = i; j <= i + 2 && j < lines.length; j++){
        var b = lines[j].match(/(?:^|\s)(\d{2})\.(\d{2})\.(\d{4})$/);
        if(b){ R.bd = +b[1]; R.bm = +b[2]; R.by = +b[3]; break; }
      }
    }
  }
  /* бөлімдер */
  var secs = [];
  lines.forEach(function(l, i){ if(/^Выписка с /.test(l)) secs.push(i); });
  var head = secs.length ? secs[0] : lines.length;
  /* жалпы ақпарат (бірінші бет) */
  var summ = {};
  for(i = 0; i < head; i++){
    var l2 = lines[i];
    var am = l2.match(new RegExp('^(\\d{18,24}) (\\d{2}\\.\\d{2}\\.\\d{4}) (' + PN_NUM + ')$'));
    if(am){
      var ctx = (lines[i + 1] || ''), ctx2 = (lines[i - 1] || '');
      var k = /ОПВР|Условный/.test(ctx) ? 'opvr' : /УИП/.test(ctx) ? 'uip' : /НБ РК/.test(ctx) ? 'nb'
            : /ЖМЗЖ|ОПВР/.test(ctx2) ? 'opvr' : /ИПБ/.test(ctx2) ? 'uip' : 'nb';
      summ[k] = { open: isoD(am[2]), bal: pnNum(am[3]) };
    }
    if(/Порог минимальной достаточности/.test(l2) && R.thr === null) R.thr = near(i, [-1, 1, -2, 2]);
    if(/доступные для\s*$|ЕПВ в целях/.test(l2) && R.epv === null) R.epv = near(i, [-1, -2, 1, 2]);
    if(/доступные для передачи/.test(l2) && R.toUip === undefined) R.toUip = near(i, [1, 2, -1, -2]);
  }
  var ROW = new RegExp('^(\\d{2})\\.(\\d{2})\\.(\\d{4}) (.*?) ?(' + PN_NUM + ') (?:(' + PN_NUM + ') )?(\\d{2}\\.\\d{2}\\.\\d{4}) (\\S+) (\\d{12}) ?(.*)$');
  secs.forEach(function(s, si){
    var end = si + 1 < secs.length ? secs[si + 1] : lines.length;
    var hd = lines.slice(s, s + 4).join(' ');
    var kind = /условного пенсионного|\(УПС\)/.test(hd) ? 'opvr' : /субсчета|УИП/.test(hd) ? 'uip' : 'nb';
    var acc = { k: kind, name: PN_KIND[kind], open: summ[kind] ? summ[kind].open : null, bal: summ[kind] ? summ[kind].bal : 0,
                inc: 0, inSum: 0, outSum: 0, y: null, ya: null, ia: null, hist: [] };
    if(kind === 'uip'){
      var mn = hd.match(/УИП\s+(?:АО\s+)?(.+?),?\s+за период/);
      if(mn) acc.name = 'ОПВ · ' + mn[1].replace(/["“”«»]/g, '').replace(/\s+/g, ' ').trim();
    }
    for(var r = s; r < end; r++){
      var L = lines[r];
      var m = L.match(ROW);
      if(m){
        var ctx = [lines[r - 1] || '', m[4], lines[r + 1] || ''].join(' ');
        var amt = pnNum(m[5]);
        var t = /Перевод|аударым/i.test(ctx) ? (kind === 'uip' ? 'tin' : 'tout')
              : /ЕПВ|БЗТ|выплат|Изъят|Возврат/i.test(ctx) ? 'out'
              : /Пеня|Өсімпұл/i.test(ctx) ? 'p' : 'c';
        var per = null;
        for(var q = r - 1; q <= r + 2; q++){
          var pm = (q === r ? '' : (lines[q] || '')).match(/\((\d{2})\.(\d{4})\)/);
          if(pm){ per = pm[2] + '-' + pm[1]; break; }
        }
        var bin = m[9], en = (m[10] || '').trim(), qy = en ? 3 : 0;
        var pv = lines[r - 1] || '', nx = lines[r + 1] || '';
        if(!en && /^OV-/.test(pv)){
          en = pv; qy = 2;
          if(nx && !/^(Жарналардың|түсуі|УИП|ФОНД)/.test(nx) && !/\(\d{2}\.\d{4}\)/.test(nx)) en += (/-$/.test(en) ? '' : ' ') + nx;
        }
        if(!en){
          [pv, nx].some(function(x){
            var em = x.match(/((?:ТОО|ТОВАРИЩЕСТВО|АО|ИП|Филиал|ГУ|КГУ|РГП|ЖШС)\b.*)$/);
            if(em){ en = em[1]; qy = 1; return true; } return false;
          });
        }
        en = en.replace(/^OV-[^\/]*\/\d+\//, '').replace(/\(\d{2}\.\d{4}\)/, '').replace(/\s+/g, ' ').trim();
        if(iin && bin === iin){ en = 'Өзіңіз'; qy = 9; }
        if((t === 'c' || t === 'p') && en){
          var oq = empQ[bin] || 0;
          if(!R.emps[bin] || qy > oq || (qy === oq && R.emps[bin].length < en.length)){ R.emps[bin] = en; empQ[bin] = qy; }
        }
        R.rows.push({ d: m[3] + '-' + m[2] + '-' + m[1], a: amt, k: kind, per: per, t: t, b: (t === 'c' || t === 'p') ? bin : null });
        continue;
      }
      if(/^Инвестиционный доход за период/.test(L)){ var v = near(r, [-1, -2, 1]); if(v !== null) acc.inc = v; }
      else if(/^Итого .*по состоянию/.test(L)){ var v2 = near(r, [-1, -2, 1]); if(v2 !== null) acc.bal = v2; }
      else if(/^ВСЕГО$/.test(L)){
        var tm = (lines[r - 1] || '').match(new RegExp('^(' + PN_NUM + ') (' + PN_NUM + ')$'));
        if(tm){ acc.inSum = pnNum(tm[1]); acc.outSum = pnNum(tm[2]); }
      }
      else if(/^Инфляция \(%\)/.test(L) && !acc.hist.length){
        var inf = (L.match(/-?\d+\.\d+/g) || []).map(Number), yl = null, yrs = null;
        for(var z = r - 1; z > r - 14 && z > s; z--){
          if(!yl && /^-?\d+\.\d+( -?\d+\.\d+)+$/.test(lines[z])) yl = lines[z].split(' ').map(Number);
          else if(yl && !yrs && /^(?:\S+ )?(\d{4})( \d{4})*$/.test(lines[z])) yrs = lines[z].match(/\d{4}/g);
        }
        if(yl){
          yrs = yrs || [];
          var extra = yl.length - yrs.length;
          yl.forEach(function(y, ix){
            acc.hist.push({ l: ix < yrs.length ? yrs[ix] : (ix === yrs.length ? '12 ай' : t('биыл')), y: y, i: inf[ix] !== undefined ? inf[ix] : null, full: ix < yrs.length });
          });
          acc.y = yl[yrs.length] !== undefined ? yl[yrs.length] : yl[yl.length - 1];
          var fy = acc.hist.filter(function(h){ return h.full; });
          if(fy.length){
            acc.ya = fy.reduce(function(x, h){ return x + h.y; }, 0) / fy.length;
            var fi = fy.filter(function(h){ return h.i !== null; });
            if(fi.length) acc.ia = fi.reduce(function(x, h){ return x + h.i; }, 0) / fi.length;
          }
          if(extra < 1) acc.y = yl[yl.length - 1];
        }
      }
    }
    R.accs.push(acc);
  });
  /* бөлімде жоқ, бірақ жалпы бетте бар шоттар */
  Object.keys(summ).forEach(function(k){
    if(!R.accs.some(function(a){ return a.k === k; }))
      R.accs.push({ k: k, name: PN_KIND[k], open: summ[k].open, bal: summ[k].bal, inc: 0, inSum: 0, outSum: 0, y: null, ya: null, ia: null, hist: [] });
  });
  R.accs.sort(function(a, b){ return b.bal - a.bal; });
  R.rows.sort(function(a, b){ return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
  R.bal = R.accs.reduce(function(x, a){ return x + a.bal; }, 0);
  R.opv = R.accs.filter(function(a){ return a.k !== 'opvr'; }).reduce(function(x, a){ return x + a.bal; }, 0);
  delete R.toUip;
  return R;
}
