/* =====================================================================
   core.js — gemeinsame Helfer: Speicher, Datum, Format, Einstellungen,
   Messwerte, "Tagesform", Diagramme, Sheets, Toast, Claude.
   Alles hängt an window.Dash (D).
   ===================================================================== */
(function () {
  'use strict';

  var D = window.Dash = {};
  D.DEMO = /[?&]demo=1(?:&|$)/.test(window.location.search);
  var NS = D.DEMO ? 'demo:' : '';

  /* ---------------- Events ---------------- */
  var handlers = {};
  var pendingEmits = {};
  D.on = function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); };
  D.emit = function (name, arg) {
    (handlers[name] || []).slice().forEach(function (fn) {
      try { fn(arg); } catch (e) { console.error(e); }
    });
  };
  D.emitSoon = function (name) {
    if (pendingEmits[name]) return;
    pendingEmits[name] = true;
    setTimeout(function () { pendingEmits[name] = false; D.emit(name); }, 0);
  };

  /* ---------------- DOM ---------------- */
  D.$ = function (id) { return document.getElementById(id); };
  D.el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  D.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  D.uid = function (p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  /* ---------------- Storage (separate namespace in demo mode) ---------------- */
  D.storeGet = function (key) {
    try {
      var raw = localStorage.getItem(NS + key);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) { return null; }
  };
  D.storeSet = function (key, value) {
    var ok = true;
    try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) { ok = false; }
    D.bump();
    if (key.indexOf('goals:') === 0 || key.indexOf('weekgoals:') === 0) D.emitSoon('goals');
    return ok;
  };
  D.storeDelete = function (key) {
    try { localStorage.removeItem(NS + key); } catch (e) {}
    D.bump();
    if (key.indexOf('goals:') === 0 || key.indexOf('weekgoals:') === 0) D.emitSoon('goals');
  };
  D.storeListKeys = function (prefix) {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (NS) {
          if (k.indexOf(NS) !== 0) continue;
          k = k.slice(NS.length);
        } else if (k.indexOf('demo:') === 0) {
          continue;
        }
        if (k.indexOf(prefix) === 0) out.push(k);
      }
    } catch (e) {}
    return out;
  };

  /* ---------------- Numbers ---------------- */
  D.isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  D.positive = function (v) { return D.isNum(v) && v > 0; };
  D.fmtNum = function (v, dec) {
    if (!D.isNum(v)) return '—';
    dec = dec || 0;
    return v.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };
  D.parseNum = function (s) {
    var t = String(s == null ? '' : s).trim().replace(/\s/g, '').replace(',', '.');
    if (!t) return NaN;
    return Number(t);
  };
  D.signed = function (n, dec) {
    if (!D.isNum(n)) return '—';
    var r = Number(n.toFixed(dec || 0));
    if (r > 0) return '+' + D.fmtNum(r, dec);
    if (r < 0) return '−' + D.fmtNum(Math.abs(r), dec);
    return '±' + D.fmtNum(0, dec);
  };
  D.fmtMins = function (mins) {
    if (!D.isNum(mins)) return '—';
    mins = Math.round(mins);
    if (mins < 60) return mins + ' Min';
    var h = Math.floor(mins / 60), m = mins % 60;
    return m ? h + 'h ' + D.pad2(m) + 'm' : h + ' Std';
  };

  /* ---------------- Dates (local parts, never toISOString) ---------------- */
  var WD_S = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var WD_L = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var MO_S = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  var MO_L = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  D.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  D.ymd = function (d) { return d.getFullYear() + '-' + D.pad2(d.getMonth() + 1) + '-' + D.pad2(d.getDate()); };
  D.parseYmd = function (s) {
    var p = String(s).slice(0, 10).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  };
  D.addDays = function (d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };
  D.shift = function (s, n) { return D.ymd(D.addDays(D.parseYmd(s), n)); };
  D.todayStr = function () { return D.ymd(new Date()); };
  D.daysBetween = function (a, b) { return Math.round((D.parseYmd(b) - D.parseYmd(a)) / 864e5); };
  D.dateRange = function (from, to) {
    var out = [];
    var d = D.parseYmd(from), end = D.parseYmd(to);
    var guard = 0;
    while (d <= end && guard++ < 4000) { out.push(D.ymd(d)); d = D.addDays(d, 1); }
    return out;
  };
  D.isValidYmd = function (s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
    return D.ymd(D.parseYmd(s)) === s;
  };
  D.activeDate = function () {
    var now = new Date();
    return now.getHours() < 6 ? D.ymd(D.addDays(now, -1)) : D.ymd(now);
  };
  D.tomorrowDate = function () {
    var now = new Date();
    return now.getHours() < 6 ? D.ymd(now) : D.ymd(D.addDays(now, 1));
  };
  D.fmtDay = function (s) { var d = D.parseYmd(s); return WD_S[d.getDay()] + ', ' + d.getDate() + '. ' + MO_S[d.getMonth()]; };
  D.fmtDayLong = function (s) { var d = D.parseYmd(s); return WD_L[d.getDay()] + ', ' + d.getDate() + '. ' + MO_L[d.getMonth()]; };
  D.fmtDate = function (s) { var d = D.parseYmd(s); return d.getDate() + '. ' + MO_S[d.getMonth()] + ' ' + d.getFullYear(); };
  D.fmtDayMonth = function (s) { var d = D.parseYmd(s); return d.getDate() + '. ' + MO_S[d.getMonth()]; };
  D.fmtMonth = function (s) { var d = D.parseYmd(s); return MO_S[d.getMonth()]; };
  D.wdShort = function (s) { return WD_S[D.parseYmd(s).getDay()]; };
  D.fmtClock = function (d) { return D.pad2(d.getHours()) + ':' + D.pad2(d.getMinutes()); };
  D.fmtHM = function (hours) {
    if (!D.isNum(hours)) return '—';
    var total = Math.max(0, Math.round(hours * 60));
    return Math.floor(total / 60) + 'h ' + D.pad2(total % 60) + 'm';
  };
  D.isoWeek = function (s) {
    var d = D.parseYmd(s);
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = (t.getDay() + 6) % 7;
    t.setDate(t.getDate() - day + 3);
    var firstThu = new Date(t.getFullYear(), 0, 4);
    return 1 + Math.round(((t - firstThu) / 864e5 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  };
  D.mondayOf = function (s) {
    var d = D.parseYmd(s);
    return D.ymd(D.addDays(d, -((d.getDay() + 6) % 7)));
  };
  D.weekDays = function (monday) { return D.dateRange(monday, D.shift(monday, 6)); };
  D.relDays = function (date) {
    var n = D.daysBetween(D.todayStr(), date);
    if (n === 0) return 'heute';
    if (n === 1) return 'morgen';
    if (n === 2) return 'übermorgen';
    if (n === -1) return 'gestern';
    if (n > 0) return 'in ' + n + ' Tagen';
    return 'vor ' + (-n) + ' Tagen';
  };

  /* ---------------- Settings ---------------- */
  var SETTINGS_KEY = 'body_settings_v1';
  D.getSettings = function () {
    var s = D.storeGet(SETTINGS_KEY) || {};
    var athlete = s.athleteId != null && String(s.athleteId).trim() !== '' ? String(s.athleteId).trim() : '0';
    var goal = Number(s.stepGoal), wake = Number(s.wakeHour), sleep = Number(s.sleepHour), wg = Number(s.weightGoal);
    var gym = Number(s.gymGoal), study = Number(s.studyGoalH);
    if (!isFinite(wake) || wake < 3 || wake > 12 || s.wakeHour == null) wake = 8;
    if (!isFinite(sleep) || sleep < 19 || sleep > 27 || s.sleepHour == null) sleep = 24;
    return {
      apiKey: typeof s.apiKey === 'string' ? s.apiKey.trim() : '',
      athleteId: athlete,
      stepGoal: isFinite(goal) && goal > 0 ? Math.round(goal) : 10000,
      anthropicKey: typeof s.anthropicKey === 'string' ? s.anthropicKey.trim() : '',
      wakeHour: Math.round(wake),
      sleepHour: Math.round(sleep),
      weightGoal: s.weightGoal != null && isFinite(wg) && wg > 0 ? wg : null,
      gymGoal: isFinite(gym) && gym >= 1 && gym <= 7 && s.gymGoal != null ? Math.round(gym) : 3,
      studyGoalH: isFinite(study) && study >= 0 && study <= 80 && s.studyGoalH != null ? study : 10
    };
  };
  D.saveSettings = function (patch) {
    var cur = D.storeGet(SETTINGS_KEY) || {};
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    D.storeSet(SETTINGS_KEY, cur);
    D.emit('settings');
  };

  /* ---------------- Data model ---------------- */
  D.model = { w: {}, a: [], fetchedAt: null };
  D.version = 0;
  var memo = {};
  D.bump = function () { D.version++; memo = {}; };
  D.memo = function (key, fn) {
    if (!(key in memo)) memo[key] = fn();
    return memo[key];
  };

  /* ---------------- Body metrics ---------------- */
  D.METRICS = [
    { key: 'sleep', label: 'Schlaf', field: 'sleepSecs', positive: true, map: function (v) { return v / 3600; },
      unit: 'h', dec: 1, chart: 'bar', better: 'higher', fmt: function (v) { return D.fmtHM(v); },
      axis: function (v) { return D.fmtNum(v, 0) + 'h'; },
      about: 'Wie lange du geschlafen hast. Die meisten Erwachsenen brauchen 7–9 Stunden.' },
    { key: 'hrv', label: 'HRV', field: 'hrv', positive: true, unit: 'ms', dec: 0, chart: 'line', better: 'higher',
      about: 'Herzratenvariabilität: wie flexibel dein Herz zwischen den Schlägen variiert. Höher als sonst heißt meist: gut erholt. Vergleiche sie nur mit dir selbst, nicht mit anderen.' },
    { key: 'rhr', label: 'Ruhepuls', field: 'restingHR', positive: true, unit: 'bpm', dec: 0, chart: 'line', better: 'lower',
      about: 'Dein Puls in völliger Ruhe. Niedriger als sonst ist meist gut; deutlich höher kann auf Stress, wenig Schlaf oder eine Erkältung hindeuten.' },
    { key: 'steps', label: 'Schritte', field: 'steps', unit: '', dec: 0, chart: 'bar', better: 'higher',
      axis: function (v) { return v >= 1000 ? D.fmtNum(v / 1000, v % 1000 ? 1 : 0) + 'k' : D.fmtNum(v, 0); },
      about: 'Deine Schritte pro Tag laut Uhr.' },
    { key: 'weight', label: 'Gewicht', field: 'weight', positive: true, unit: 'kg', dec: 1, chart: 'line', better: 'lower',
      about: 'Dein eingetragenes Gewicht. Tägliche Schwankungen von 1–2 kg sind normal — achte auf die Ø-Linie.' },
    { key: 'sleepScore', label: 'Schlafscore', field: 'sleepScore', positive: true, unit: '', dec: 0, chart: 'line', better: 'higher',
      about: 'Die Schlafbewertung von Zepp (0–100).' },
    { key: 'bodyFat', label: 'Körperfett', field: 'bodyFat', positive: true, unit: '%', dec: 1, chart: 'line', better: 'lower',
      about: 'Dein eingetragener Körperfettanteil.' },
    { key: 'spO2', label: 'Sauerstoff', field: 'spO2', positive: true, unit: '%', dec: 0, chart: 'line', better: 'higher',
      about: 'Sauerstoffsättigung im Blut (SpO₂).' },
    { key: 'readiness', label: 'Bereitschaft', field: 'readiness', positive: true, unit: '', dec: 0, chart: 'line', better: 'higher',
      about: 'Bereitschaftswert, falls Zepp ihn liefert.' }
  ];
  D.M = {};
  D.METRICS.forEach(function (m) { D.M[m.key] = m; });

  D.fmtValue = function (key, v, withUnit) {
    var m = D.M[key];
    if (!D.isNum(v)) return '—';
    if (m.fmt) return m.fmt(v);
    var s = D.fmtNum(v, m.dec);
    if (withUnit !== false && m.unit) s += (m.unit === '%' ? '' : ' ') + m.unit;
    return s;
  };
  D.fmtAxis = function (key, v) {
    var m = D.M[key];
    if (m && m.axis) return m.axis(v);
    return D.fmtNum(v, m && m.dec && Math.abs(v) < 20 ? 1 : 0);
  };
  D.fmtDelta = function (key, v) {
    if (!D.isNum(v)) return '—';
    if (key === 'sleep') {
      var mins = Math.round(v * 60);
      return (mins > 0 ? '+' : mins < 0 ? '−' : '±') + Math.abs(mins) + ' Min';
    }
    var m = D.M[key];
    return D.signed(v, m.dec) + (m.unit ? (m.unit === '%' ? '' : ' ') + m.unit : '');
  };

  D.valueOn = function (key, date) {
    var m = D.M[key];
    if (!m) return null;
    var r = D.model.w[date];
    if (!r) return null;
    var v = r[m.field];
    if (!D.isNum(v)) return null;
    if (m.positive && v <= 0) return null;
    return m.map ? m.map(v) : v;
  };
  D.series = function (key) {
    return D.memo('series:' + key, function () {
      var out = [];
      Object.keys(D.model.w).sort().forEach(function (d) {
        var v = D.valueOn(key, d);
        if (D.isNum(v)) out.push({ date: d, v: v });
      });
      return out;
    });
  };
  D.hasData = function (key) { return D.series(key).length > 0; };

  /* Latest value: today, else up to 2 days back (Zepp often files the night under the previous day). */
  D.latest = function (key, maxBack) {
    var today = D.todayStr();
    for (var i = 0; i <= (maxBack == null ? 2 : maxBack); i++) {
      var d = D.shift(today, -i);
      var v = D.valueOn(key, d);
      if (D.isNum(v)) return { value: v, date: d, fallback: i > 0 };
    }
    return null;
  };

  /* ---------------- Statistics ---------------- */
  D.mean = function (xs) { if (!xs.length) return null; var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i]; return s / xs.length; };
  D.sd = function (xs) {
    if (xs.length < 2) return 0;
    var m = D.mean(xs), s = 0;
    for (var i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m);
    return Math.sqrt(s / (xs.length - 1));
  };
  D.rollingAvg = function (get, date, span, minCount) {
    span = span || 7; minCount = minCount || 3;
    var xs = [];
    for (var i = 0; i < span; i++) {
      var v = get(D.shift(date, -i));
      if (D.isNum(v)) xs.push(v);
    }
    return xs.length >= minCount ? D.mean(xs) : null;
  };

  /* "Dein Normalwert": Durchschnitt der 30 Tage VOR einem Datum (mind. 7 Werte). */
  D.normalOf = function (key, date) {
    return D.memo('normal:' + key + ':' + date, function () {
      var xs = [];
      for (var i = 1; i <= 30; i++) {
        var v = D.valueOn(key, D.shift(date, -i));
        if (D.isNum(v)) xs.push(v);
      }
      if (xs.length < 7) return null;
      return { mean: D.mean(xs), sd: D.sd(xs), n: xs.length };
    });
  };

  /* ---------------- Tagesform ----------------
     Vergleicht Schlaf, HRV und Ruhepuls von letzter Nacht mit deinem
     eigenen Durchschnitt der 30 Tage davor. Mehr Schlaf, höhere HRV und
     ein niedrigerer Ruhepuls = besser erholt. */
  D.FORM_KEYS = ['sleep', 'hrv', 'rhr'];
  D.tagesform = function () {
    return D.memo('tagesform', function () {
      var parts = [];
      D.FORM_KEYS.forEach(function (k) {
        var l = D.latest(k);
        if (!l) return;
        var n = D.normalOf(k, l.date);
        var p = { key: k, value: l.value, date: l.date, fallback: l.fallback, normal: n ? n.mean : null, z: null, verdict: 'unknown' };
        if (n) {
          var sd = Math.max(n.sd, k === 'sleep' ? 0.25 : k === 'hrv' ? 2 : 1);
          var z = (l.value - n.mean) / sd * (D.M[k].better === 'lower' ? -1 : 1);
          p.z = z;
          p.verdict = z >= 0.5 ? 'better' : (z <= -0.5 ? 'worse' : 'normal');
        }
        parts.push(p);
      });
      var scored = parts.filter(function (p) { return p.z != null; });
      if (scored.length < 2) return { status: null, parts: parts };
      var avg = D.mean(scored.map(function (p) { return Math.max(-2.5, Math.min(2.5, p.z)); }));
      var status = avg >= 0.4 ? 'gut' : (avg <= -0.4 ? 'muede' : 'normal');
      return { status: status, score: avg, parts: parts };
    });
  };

  /* ---------------- Icons ---------------- */
  var ICONS = {
    home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>',
    chart: '<path d="M4 19h16"/><path d="m5 15 4.5-5 3.5 3 6-7"/>',
    check: '<circle cx="12" cy="12" r="8"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
    gym: '<path d="M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11"/>',
    book: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5z"/><path d="M5 18.5A1.5 1.5 0 0 0 6.5 20H19"/><path d="M9 8h6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
    refresh: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 5v4h-4"/>',
    sparkle: '<path d="M12 4.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>'
  };
  D.icon = function (name) {
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  };
  D.injectIcons = function (root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (n) {
      if (n.dataset.iconDone) return;
      n.insertAdjacentHTML('afterbegin', D.icon(n.getAttribute('data-icon')));
      n.dataset.iconDone = '1';
    });
  };

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  D.toast = function (msg, action) {
    var t = D.$('toast');
    if (!t) return;
    clearTimeout(toastTimer);
    t.innerHTML = '';
    t.appendChild(D.el('span', null, msg));
    if (action) {
      var b = D.el('button', null, action.label);
      b.type = 'button';
      b.addEventListener('click', function () { t.classList.remove('is-on'); action.fn(); });
      t.appendChild(b);
    } else {
      t.style.paddingRight = '18px';
    }
    if (action) t.style.paddingRight = '';
    t.classList.add('is-on');
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, action ? 6000 : 2600);
  };

  /* ---------------- Sheets ---------------- */
  var sheetStack = [];
  var lastFocus = [];
  D.openSheet = function (id) {
    var s = D.$(id);
    if (!s || s.classList.contains('is-open')) return;
    lastFocus.push(document.activeElement);
    sheetStack.push(id);
    s.classList.add('is-open');
    s.setAttribute('aria-hidden', 'false');
    D.$('sheetBackdrop').classList.add('is-open');
    document.body.classList.add('sheet-open');
    s.scrollTop = 0;
  };
  D.closeSheet = function (id) {
    id = id || sheetStack[sheetStack.length - 1];
    var s = D.$(id);
    if (!s) return;
    s.classList.remove('is-open');
    s.setAttribute('aria-hidden', 'true');
    var i = sheetStack.indexOf(id);
    if (i >= 0) sheetStack.splice(i, 1);
    var f = lastFocus.pop();
    if (!sheetStack.length) {
      D.$('sheetBackdrop').classList.remove('is-open');
      document.body.classList.remove('sheet-open');
    }
    if (f && f.focus) { try { f.focus({ preventScroll: true }); } catch (e) {} }
  };
  D.topSheet = function () { return sheetStack[sheetStack.length - 1] || null; };

  /* ---------------- Charts (light theme) ----------------
     D.chart(el, { from, to, get(date), key, type:'line'|'bar', baseline:{mean, sd},
       target:{value,label}, avg, height, onPick(date, v, avg), fmt, fmtAxis }) */
  var INK = '#1C1B1A';
  function niceStep(span, count) {
    var raw = span / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / mag;
    var nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return nf * mag;
  }
  D.chart = function (el, o) {
    var W = Math.max(260, Math.floor(el.clientWidth || el.getBoundingClientRect().width || 320));
    var H = o.height || 220;
    var padL = 40, padR = 8, padT = 14, padB = 26;
    var days = D.dateRange(o.from, o.to);
    var n = days.length;
    var vals = days.map(function (d) { var v = o.get(d); return D.isNum(v) ? v : null; });
    var present = vals.filter(function (v) { return v != null; });
    el.classList.add('chart');
    if (!present.length) {
      el.innerHTML = '<div class="chart-empty" style="min-height:' + Math.round(H * 0.8) + 'px">Keine Daten in diesem Zeitraum</div>';
      return;
    }
    var avgs = o.avg ? days.map(function (d) { return D.rollingAvg(o.get, d, 7, 3); }) : [];
    var fmtV = o.fmt || function (v) { return D.fmtValue(o.key, v); };
    var fmtA = o.fmtAxis || function (v) { return D.fmtAxis(o.key, v); };

    var lo = Math.min.apply(null, present), hi = Math.max.apply(null, present);
    avgs.forEach(function (v) { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    if (o.baseline) { lo = Math.min(lo, o.baseline.mean - o.baseline.sd); hi = Math.max(hi, o.baseline.mean + o.baseline.sd); }
    if (o.target && D.isNum(o.target.value)) { lo = Math.min(lo, o.target.value); hi = Math.max(hi, o.target.value); }
    var zero = o.type === 'bar';
    if (zero) lo = Math.min(lo, 0);
    if (hi - lo < 1e-9) { hi += 1; lo -= zero ? 0 : 1; }
    if (!zero) { var sp = hi - lo; lo -= sp * 0.1; hi += sp * 0.1; }
    var step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    if (zero && lo < 0 && Math.min.apply(null, present) >= 0) lo = 0;
    var ticks = [];
    for (var t = lo; t <= hi + step * 0.001; t += step) ticks.push(Number(t.toFixed(6)));

    var iw = W - padL - padR, ih = H - padT - padB, bw = iw / n;
    var X = function (i) { return padL + (i + 0.5) * bw; };
    var Y = function (v) { return padT + ih - (v - lo) / (hi - lo) * ih; };
    var parts = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + D.esc(o.label || 'Verlauf') + '">'];
    ticks.forEach(function (tv) {
      var y = Y(tv).toFixed(1);
      parts.push('<line class="grid-line" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>');
      parts.push('<text x="' + (padL - 8) + '" y="' + (Number(y) + 4) + '" text-anchor="end">' + D.esc(fmtA(tv)) + '</text>');
    });
    if (o.baseline) {
      var by1 = Y(o.baseline.mean + o.baseline.sd), by2 = Y(o.baseline.mean - o.baseline.sd);
      parts.push('<rect x="' + padL + '" y="' + by1.toFixed(1) + '" width="' + iw + '" height="' + Math.max(0, by2 - by1).toFixed(1) + '" fill="rgba(118,168,236,0.20)" rx="6"/>');
    }
    if (o.target && D.isNum(o.target.value)) {
      var ty = Y(o.target.value).toFixed(1);
      parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + ty + '" y2="' + ty + '" stroke="#E39A55" stroke-dasharray="5 4" stroke-width="1.6"/>');
      parts.push('<text x="' + (W - padR) + '" y="' + (Number(ty) - 6) + '" text-anchor="end" style="fill:#A65A17">' + D.esc(o.target.label || 'Ziel') + '</text>');
    }
    if (o.type === 'bar') {
      var bwid = Math.max(1.5, Math.min(28, bw * 0.62));
      var base = Y(Math.max(lo, 0));
      vals.forEach(function (v, i) {
        if (v == null) return;
        var y = Y(v), h = Math.max(1.5, base - y);
        parts.push('<rect x="' + (X(i) - bwid / 2).toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + bwid.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(4, bwid / 2).toFixed(1) + '" fill="' + INK + '" fill-opacity="' + (i === n - 1 ? 0.85 : (o.avg ? 0.16 : 0.32)) + '"/>');
      });
    } else {
      var solid = '', dashed = '', prevI = -1;
      vals.forEach(function (v, i) {
        if (v == null) return;
        var pt = X(i).toFixed(1) + ',' + Y(v).toFixed(1);
        if (prevI < 0) solid += 'M' + pt;
        else if (i - prevI > 1) { dashed += 'M' + X(prevI).toFixed(1) + ',' + Y(vals[prevI]).toFixed(1) + 'L' + pt; solid += 'M' + pt; }
        else solid += 'L' + pt;
        prevI = i;
      });
      if (dashed) parts.push('<path d="' + dashed + '" fill="none" stroke="' + INK + '" stroke-opacity="0.22" stroke-width="1.4" stroke-dasharray="3 4"/>');
      parts.push('<path d="' + solid + '" fill="none" stroke="' + INK + '" stroke-opacity="' + (o.avg ? 0.3 : 0.9) + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>');
      if (n <= 45) {
        vals.forEach(function (v, i) {
          if (v == null) return;
          parts.push('<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="' + (i === n - 1 ? 3.8 : 2.4) + '" fill="' + INK + '" fill-opacity="' + (i === n - 1 ? 1 : (o.avg ? 0.35 : 0.8)) + '"/>');
        });
      }
    }
    if (o.avg) {
      var ap = '', started = false;
      avgs.forEach(function (v, i) {
        if (v == null) { started = false; return; }
        ap += (started ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1);
        started = true;
      });
      if (ap) parts.push('<path d="' + ap + '" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>');
    }
    var labelCount = Math.min(n, W < 420 ? 4 : 6);
    var used = {};
    for (var li = 0; li < labelCount; li++) {
      var idx = labelCount === 1 ? n - 1 : Math.round(li * (n - 1) / (labelCount - 1));
      if (used[idx]) continue;
      used[idx] = true;
      var anchor = li === 0 ? 'start' : (li === labelCount - 1 ? 'end' : 'middle');
      var lx = li === 0 ? padL : (li === labelCount - 1 ? W - padR : X(idx));
      var txt = n > 200 ? D.fmtMonth(days[idx]) + ' ' + String(D.parseYmd(days[idx]).getFullYear()).slice(2) : D.fmtDayMonth(days[idx]);
      parts.push('<text x="' + lx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '">' + D.esc(txt) + '</text>');
    }
    parts.push('<g class="cross" style="display:none"><line class="cx" y1="' + padT + '" y2="' + (padT + ih) + '" stroke="rgba(28,27,26,0.3)"/><circle class="cd" r="5" fill="' + INK + '" stroke="#F7F5F2" stroke-width="2.5"/></g>');
    parts.push('<rect x="' + padL + '" y="0" width="' + iw + '" height="' + H + '" fill="transparent"/>');
    parts.push('</svg><div class="chart-tip"></div>');
    el.innerHTML = parts.join('');

    var svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip');
    var cross = svg.querySelector('.cross'), cx = cross.querySelector('.cx'), cd = cross.querySelector('.cd');
    function show(i) {
      var d = days[i], v = vals[i], a = avgs[i];
      var x = X(i);
      cross.style.display = '';
      cx.setAttribute('x1', x); cx.setAttribute('x2', x);
      if (v != null) { cd.style.display = ''; cd.setAttribute('cx', x); cd.setAttribute('cy', Y(v)); }
      else cd.style.display = 'none';
      var html = D.esc(D.fmtDay(d)) + ' · <b>' + D.esc(v != null ? fmtV(v) : 'keine Daten') + '</b>';
      if (a != null) html += ' <span class="muted">· Ø ' + D.esc(fmtV(a)) + '</span>';
      tip.innerHTML = html;
      tip.classList.add('is-on');
      var rect = svg.getBoundingClientRect();
      var tw = tip.offsetWidth;
      var left = Math.max(tw / 2, Math.min(rect.width - tw / 2, x * rect.width / W));
      tip.style.left = left + 'px';
      tip.style.top = '-34px';
      if (o.onPick) o.onPick(d, v, a);
    }
    function hide() { cross.style.display = 'none'; tip.classList.remove('is-on'); if (o.onPick) o.onPick(null); }
    function pick(e) {
      var rect = svg.getBoundingClientRect();
      var px = (e.clientX - rect.left) * (W / rect.width);
      show(Math.max(0, Math.min(n - 1, Math.floor((px - padL) / bw))));
    }
    svg.addEventListener('pointermove', pick);
    svg.addEventListener('pointerdown', pick);
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
  };

  /* Weekly bar chart: [{label, value, highlight, title}] with optional goal line. */
  D.weekBars = function (el, items, o) {
    o = o || {};
    var W = Math.max(260, Math.floor(el.clientWidth || 320)), H = o.height || 170;
    var padL = 28, padR = 6, padT = 16, padB = 24;
    var max = Math.max(o.goal || 0, Math.max.apply(null, items.map(function (x) { return x.value; })), o.minMax || 1);
    max = Math.ceil(max * 1.1);
    var iw = W - padL - padR, ih = H - padT - padB, bw = iw / items.length;
    var Y = function (v) { return padT + ih - v / max * ih; };
    var p = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + D.esc(o.label || 'Wochen') + '">'];
    [0, Math.round(max / 2), max].forEach(function (t) {
      p.push('<line class="grid-line" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '"/>');
      p.push('<text x="' + (padL - 6) + '" y="' + (Y(t) + 4).toFixed(1) + '" text-anchor="end">' + D.esc(o.fmtAxis ? o.fmtAxis(t) : t) + '</text>');
    });
    items.forEach(function (it, i) {
      var w = Math.min(30, bw * 0.62), x = padL + i * bw + (bw - w) / 2, h = Math.max(it.value > 0 ? 3 : 0, ih - (Y(it.value) - padT));
      var reached = o.goal && it.value >= o.goal;
      p.push('<g><title>' + D.esc(it.title || '') + '</title><rect x="' + x.toFixed(1) + '" y="' + (padT + ih - h).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(6, w / 2) + '" fill="' + INK + '" fill-opacity="' + (it.highlight ? 0.9 : reached ? 0.6 : 0.22) + '"/>');
      if (o.showValues && it.value > 0) p.push('<text x="' + (x + w / 2).toFixed(1) + '" y="' + (padT + ih - h - 5).toFixed(1) + '" text-anchor="middle" style="fill:#4A4743">' + D.esc(o.fmtValue ? o.fmtValue(it.value) : it.value) + '</text>');
      p.push('<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle"' + (it.highlight ? ' style="fill:#1C1B1A;font-weight:600"' : '') + '>' + D.esc(it.label) + '</text></g>');
    });
    if (o.goal) {
      var gy = Y(o.goal).toFixed(1);
      p.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy + '" y2="' + gy + '" stroke="#E39A55" stroke-dasharray="5 4" stroke-width="1.6"/>');
      p.push('<text x="' + (W - padR) + '" y="' + (Number(gy) - 6) + '" text-anchor="end" style="fill:#A65A17">Ziel</text>');
    }
    p.push('</svg>');
    el.classList.add('chart');
    el.innerHTML = p.join('');
  };

  /* ---------------- Claude (Anthropic API direkt aus dem Browser) ---------------- */
  D.callClaude = function (o) {
    var key = (D.getSettings().anthropicKey || '').trim();
    if (!key) {
      var e0 = new Error('Kein Anthropic-API-Schlüssel');
      e0.code = 'nokey';
      return Promise.reject(e0);
    }
    var body = { model: o.model, max_tokens: o.maxTokens || 16000, messages: o.messages, fallbacks: 'default' };
    if (o.system) body.system = o.system;
    if (o.effort) body.output_config = { effort: o.effort };
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.error && data.error.message) || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        if (data.stop_reason === 'refusal') {
          var r = new Error('Claude hat diese Anfrage abgelehnt.');
          r.code = 'refusal';
          throw r;
        }
        var text = (data.content || []).filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join('').trim();
        return { text: text, content: data.content || [], stop: data.stop_reason };
      });
    });
  };
})();
