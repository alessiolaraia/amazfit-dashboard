/* =====================================================================
   core.js — shared helpers: storage, dates, formatting, settings,
   metrics, statistics, personal index, charts, sheets, toast.
   Everything hangs off window.Dash (D).
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
  /* Coalesce bursts of the same event into one, on the next tick. */
  D.emitSoon = function (name) {
    if (pendingEmits[name]) return;
    pendingEmits[name] = true;
    setTimeout(function () { pendingEmits[name] = false; D.emit(name); }, 0);
  };

  /* ---------------- DOM helpers ---------------- */
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

  /* ---------------- Storage (namespaced in demo mode) ---------------- */
  D.storeGet = function (key) {
    try {
      var raw = localStorage.getItem(NS + key);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) { return null; }
  };
  D.storeSet = function (key, value) {
    var ok = true;
    try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) { ok = false; }
    if (key.indexOf('goals:') === 0) { D.bump(); D.emitSoon('goals'); }
    return ok;
  };
  D.storeDelete = function (key) {
    try { localStorage.removeItem(NS + key); } catch (e) {}
    if (key.indexOf('goals:') === 0) { D.bump(); D.emitSoon('goals'); }
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

  /* ---------------- Dates (always local parts, never toISOString) ---------------- */
  var WD_S = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var WD_L = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var WD_I = ['S', 'M', 'D', 'M', 'D', 'F', 'S'];
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
  D.wdInitial = function (s) { return WD_I[D.parseYmd(s).getDay()]; };
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

  /* ---------------- Settings ---------------- */
  var SETTINGS_KEY = 'body_settings_v1';
  D.DEFAULT_DIRS = {
    sleep: 'higher', hrv: 'higher', rhr: 'lower', steps: 'higher',
    sleepScore: 'off', weight: 'off', bodyFat: 'off', readiness: 'off',
    spO2: 'off', respiration: 'off', fitness: 'off',
    mood: 'off', energy: 'off', stress: 'off', goals: 'off'
  };
  D.getSettings = function () {
    var s = D.storeGet(SETTINGS_KEY) || {};
    var athlete = s.athleteId != null && String(s.athleteId).trim() !== '' ? String(s.athleteId).trim() : '0';
    var goal = Number(s.stepGoal);
    var wake = Number(s.wakeHour);
    var sleep = Number(s.sleepHour);
    var wg = Number(s.weightGoal);
    var dirs = {};
    Object.keys(D.DEFAULT_DIRS).forEach(function (k) {
      var v = s.dirs && s.dirs[k];
      dirs[k] = v === 'higher' || v === 'lower' || v === 'off' ? v : D.DEFAULT_DIRS[k];
    });
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
      dirs: dirs
    };
  };
  D.saveSettings = function (patch) {
    var cur = D.storeGet(SETTINGS_KEY) || {};
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    D.storeSet(SETTINGS_KEY, cur);
    D.bump();
    D.emit('settings');
  };

  /* ---------------- Data model ---------------- */
  /* w: wellness records by date, a: activities, fetchedAt */
  D.model = { w: {}, a: [], fetchedAt: null };
  D.version = 0;
  var memo = {};
  D.bump = function () { D.version++; memo = {}; };
  D.memo = function (key, fn) {
    if (!(key in memo)) memo[key] = fn();
    return memo[key];
  };

  /* Check-ins (mood, energy, stress, note) live only on this device. */
  var CHECKIN_KEY = 'checkins_v1';
  D.checkins = function () {
    return D.memo('checkins', function () {
      var c = D.storeGet(CHECKIN_KEY);
      return c && typeof c === 'object' ? c : {};
    });
  };
  D.saveCheckin = function (date, patch) {
    var all = D.storeGet(CHECKIN_KEY) || {};
    var cur = all[date] || {};
    Object.keys(patch).forEach(function (k) {
      if (patch[k] == null || patch[k] === '') delete cur[k];
      else cur[k] = patch[k];
    });
    cur.at = Date.now();
    var keys = Object.keys(cur).filter(function (k) { return k !== 'at'; });
    if (keys.length) all[date] = cur; else delete all[date];
    D.storeSet(CHECKIN_KEY, all);
    D.bump();
    D.emit('checkins');
  };

  /* ---------------- Metrics registry ---------------- */
  function hoursFmt(v) { return D.fmtHM(v); }
  D.METRICS = [
    { key: 'sleep', label: 'Schlaf', kind: 'w', field: 'sleepSecs', positive: true, map: function (v) { return v / 3600; },
      unit: 'h', dec: 1, color: '#9DB1FF', chart: 'bar', better: 'higher', fmt: hoursFmt, axis: function (v) { return D.fmtNum(v, 0) + 'h'; } },
    { key: 'hrv', label: 'HRV', kind: 'w', field: 'hrv', positive: true, unit: 'ms', dec: 0, color: '#6BE3A4', chart: 'line', better: 'higher' },
    { key: 'rhr', label: 'Ruhepuls', kind: 'w', field: 'restingHR', positive: true, unit: 'bpm', dec: 0, color: '#FF8F7E', chart: 'line', better: 'lower' },
    { key: 'steps', label: 'Schritte', kind: 'w', field: 'steps', unit: '', dec: 0, color: '#F2C063', chart: 'bar', better: 'higher',
      axis: function (v) { return v >= 1000 ? D.fmtNum(v / 1000, v % 1000 ? 1 : 0) + 'k' : D.fmtNum(v, 0); } },
    { key: 'sleepScore', label: 'Schlafscore', kind: 'w', field: 'sleepScore', positive: true, unit: '', dec: 0, color: '#7FD1FF', chart: 'line', better: 'higher' },
    { key: 'weight', label: 'Gewicht', kind: 'w', field: 'weight', positive: true, unit: 'kg', dec: 1, color: '#C9A7FF', chart: 'line', better: 'lower' },
    { key: 'bodyFat', label: 'Körperfett', kind: 'w', field: 'bodyFat', positive: true, unit: '%', dec: 1, color: '#E7A6D8', chart: 'line', better: 'lower' },
    { key: 'readiness', label: 'Bereitschaft', kind: 'w', field: 'readiness', positive: true, unit: '', dec: 0, color: '#8FE3D6', chart: 'line', better: 'higher' },
    { key: 'spO2', label: 'SpO₂', kind: 'w', field: 'spO2', positive: true, unit: '%', dec: 0, color: '#9FC8FF', chart: 'line', better: 'higher' },
    { key: 'respiration', label: 'Atemfrequenz', kind: 'w', field: 'respiration', positive: true, unit: '/min', dec: 1, color: '#B7C4D6', chart: 'line', better: 'lower' },
    { key: 'fitness', label: 'Fitness', kind: 'w', field: 'ctl', unit: '', dec: 0, color: '#FFB86B', chart: 'line', better: 'higher' },
    { key: 'mood', label: 'Stimmung', kind: 'c', unit: '/5', dec: 1, color: '#FFB86B', chart: 'bar', better: 'higher', min: 1, max: 5 },
    { key: 'energy', label: 'Energie', kind: 'c', unit: '/5', dec: 1, color: '#F2C063', chart: 'bar', better: 'higher', min: 1, max: 5 },
    { key: 'stress', label: 'Stress', kind: 'c', unit: '/5', dec: 1, color: '#FF8A8A', chart: 'bar', better: 'lower', min: 1, max: 5 },
    { key: 'goals', label: 'Ziele erledigt', kind: 'g', unit: '%', dec: 0, color: '#6BE3A4', chart: 'bar', better: 'higher', min: 0, max: 100 }
  ];
  D.M = {};
  D.METRICS.forEach(function (m) { D.M[m.key] = m; });

  D.fmtValue = function (key, v, withUnit) {
    var m = D.M[key];
    if (!D.isNum(v)) return '—';
    if (key === 'index') return D.fmtNum(v, 0);
    if (m.fmt) return m.fmt(v);
    var s = D.fmtNum(v, m.dec);
    if (withUnit !== false && m.unit) s += (m.unit.charAt(0) === '/' || m.unit === '%' ? '' : ' ') + m.unit;
    return s;
  };
  D.fmtAxis = function (key, v) {
    var m = D.M[key];
    if (m && m.axis) return m.axis(v);
    return D.fmtNum(v, m && m.dec && Math.abs(v) < 20 ? 1 : 0);
  };
  D.betterOf = function (key) {
    var dirs = D.getSettings().dirs;
    var d = dirs[key];
    if (d === 'higher' || d === 'lower') return d;
    return D.M[key] ? D.M[key].better : 'higher';
  };

  /* Goal ratio is provided by goals.js; defaults to nothing. */
  D.goalRatioOn = function () { return null; };
  D.goalDates = function () { return []; };

  D.valueOn = function (key, date) {
    var m = D.M[key];
    if (!m) return null;
    if (m.kind === 'w') {
      var r = D.model.w[date];
      if (!r) return null;
      var v = r[m.field];
      if (!D.isNum(v)) return null;
      if (m.positive && v <= 0) return null;
      return m.map ? m.map(v) : v;
    }
    if (m.kind === 'c') {
      var c = D.checkins()[date];
      return c && D.isNum(c[key]) ? c[key] : null;
    }
    if (m.kind === 'g') return D.goalRatioOn(date);
    return null;
  };

  /* Full ascending series of {date, v} for a metric. */
  D.series = function (key) {
    return D.memo('series:' + key, function () {
      var m = D.M[key];
      var dates;
      if (m.kind === 'w') dates = Object.keys(D.model.w);
      else if (m.kind === 'c') dates = Object.keys(D.checkins());
      else dates = D.goalDates();
      dates.sort();
      var out = [];
      dates.forEach(function (d) {
        var v = D.valueOn(key, d);
        if (D.isNum(v)) out.push({ date: d, v: v });
      });
      return out;
    });
  };
  D.hasData = function (key) { return D.series(key).length > 0; };
  D.seriesIn = function (key, from, to) {
    return D.series(key).filter(function (p) { return p.date >= from && p.date <= to; });
  };

  /* ---------------- Statistics ---------------- */
  D.mean = function (xs) { if (!xs.length) return null; var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i]; return s / xs.length; };
  D.sd = function (xs) {
    if (xs.length < 2) return 0;
    var m = D.mean(xs), s = 0;
    for (var i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m);
    return Math.sqrt(s / (xs.length - 1));
  };
  D.variance = function (xs) { var s = D.sd(xs); return s * s; };
  /* Mean of the values in the 7 days ending at `date`, if at least 3 exist. */
  D.rollingAvg = function (get, date, span, minCount) {
    span = span || 7;
    minCount = minCount || 3;
    var xs = [];
    for (var i = 0; i < span; i++) {
      var v = get(D.shift(date, -i));
      if (D.isNum(v)) xs.push(v);
    }
    return xs.length >= minCount ? D.mean(xs) : null;
  };

  /* ---------------- Personal index ----------------
     100 = your baseline (your first 30 days with data). Ten points is one
     standard deviation of your own ordinary variation, not ten percent.
     You choose per metric whether higher or lower is better, or leave it out.
     Under 14 days of data there is no index; until 30 it is provisional. */
  var BASE_KEY = 'index_baselines_v1';
  D.BASE_N = 30;
  D.BASE_MIN = 14;
  D.baseline = function (key) {
    return D.memo('base:' + key, function () {
      var stored = (D.storeGet(BASE_KEY) || {})[key];
      if (stored && stored.n >= D.BASE_N && stored.sd > 0) {
        return { mean: stored.mean, sd: stored.sd, n: stored.n, from: stored.from, to: stored.to, frozen: true };
      }
      var s = D.series(key);
      if (!s.length) return null;
      var first = s.slice(0, D.BASE_N);
      var vals = first.map(function (p) { return p.v; });
      var b = { mean: D.mean(vals), sd: D.sd(vals), n: vals.length, from: first[0].date, to: first[first.length - 1].date, frozen: false };
      if (b.n >= D.BASE_N && b.sd > 0 && !D.DEMO_NO_FREEZE) {
        var all = D.storeGet(BASE_KEY) || {};
        all[key] = { mean: b.mean, sd: b.sd, n: b.n, from: b.from, to: b.to };
        try { localStorage.setItem((D.DEMO ? 'demo:' : '') + BASE_KEY, JSON.stringify(all)); } catch (e) {}
        b.frozen = true;
      }
      return b;
    });
  };
  D.resetBaselines = function () { D.storeDelete(BASE_KEY); D.bump(); D.emit('data'); };
  D.indexMembers = function () {
    var dirs = D.getSettings().dirs;
    return D.METRICS.filter(function (m) { return dirs[m.key] && dirs[m.key] !== 'off'; }).map(function (m) { return m.key; });
  };
  D.indexOf = function (key, v) {
    if (!D.isNum(v)) return null;
    var dir = D.getSettings().dirs[key];
    if (!dir || dir === 'off') return null;
    var b = D.baseline(key);
    if (!b || b.n < D.BASE_MIN || !(b.sd > 1e-9)) return null;
    return 100 + 10 * (dir === 'lower' ? -1 : 1) * (v - b.mean) / b.sd;
  };
  D.indexReady = function (key) {
    var b = D.baseline(key);
    return !!(b && b.n >= D.BASE_MIN && b.sd > 1e-9);
  };
  /* Composite index for one day: mean of available member indices.
     Needs at least half of the eligible members to report that day. */
  D.compositeOn = function (date) {
    return D.memo('comp:' + date, function () {
      var members = D.indexMembers().filter(D.indexReady);
      if (!members.length) return null;
      var parts = [], missing = [];
      members.forEach(function (k) {
        var v = D.valueOn(k, date);
        var idx = D.indexOf(k, v);
        if (idx == null) missing.push(k);
        else parts.push({ key: k, v: v, idx: idx });
      });
      if (!parts.length || parts.length < Math.ceil(members.length / 2)) return null;
      return {
        date: date,
        score: D.mean(parts.map(function (p) { return p.idx; })),
        parts: parts,
        missing: missing,
        members: members
      };
    });
  };
  D.latestComposite = function () {
    var today = D.todayStr();
    for (var i = 0; i < 7; i++) {
      var c = D.compositeOn(D.shift(today, -i));
      if (c) return c;
    }
    return null;
  };
  D.indexValueOn = function (date) {
    var c = D.compositeOn(date);
    return c ? c.score : null;
  };

  /* ---------------- Icons ---------------- */
  var ICONS = {
    home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>',
    chart: '<path d="M4 19h16"/><path d="m5 15 4.5-5 3.5 3 6-7"/>',
    check: '<circle cx="12" cy="12" r="8"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
    flask: '<path d="M9.5 4h5M10.5 4v5.2L5.6 17.4A1.8 1.8 0 0 0 7.2 20h9.6a1.8 1.8 0 0 0 1.6-2.6l-4.9-8.2V4"/><path d="M8 14.5h8"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="9.2" cy="10" r="1.6"/><path d="m5 17 4.6-4.4 3.2 3 2.6-2.3L20 17"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
    refresh: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 5v4h-4"/>',
    sparkle: '<path d="M12 4.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z"/><path d="M18.5 3.5v3M17 5h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    scale: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9.5a4 4 0 0 1 6 0l-2 2.3"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
  };
  D.icon = function (name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
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
    }
    t.classList.add('is-on');
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, action ? 6000 : 2800);
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
    D.emit('sheet-closed', id);
  };
  D.topSheet = function () { return sheetStack[sheetStack.length - 1] || null; };

  /* ---------------- Charts ----------------
     D.chart(el, {
       from, to          date strings, inclusive
       get(date)         value or null
       key               metric key (for formatting), or 'index'
       type              'line' | 'bar'
       color, baseline:{mean, sd}, target:{value, label}, avg:true,
       shade:{from, to, label}, height, onPick(date, v, avg)
     }) */
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
    var padL = 42, padR = 10, padT = 14, padB = 24;
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
    var fmtV = function (v) { return o.key === 'index' ? D.fmtNum(v, 0) : D.fmtValue(o.key, v); };
    var fmtA = function (v) { return o.key === 'index' ? D.fmtNum(v, 0) : D.fmtAxis(o.key, v); };

    var lo = Math.min.apply(null, present), hi = Math.max.apply(null, present);
    avgs.forEach(function (v) { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    if (o.baseline) { lo = Math.min(lo, o.baseline.mean - o.baseline.sd); hi = Math.max(hi, o.baseline.mean + o.baseline.sd); }
    if (o.target && D.isNum(o.target.value)) { lo = Math.min(lo, o.target.value); hi = Math.max(hi, o.target.value); }
    var zero = o.type === 'bar';
    if (zero) lo = Math.min(lo, 0);
    if (hi - lo < 1e-9) { hi += 1; lo -= zero ? 0 : 1; }
    if (!zero) { var span0 = hi - lo; lo -= span0 * 0.1; hi += span0 * 0.1; }
    var step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    if (zero && lo < 0 && Math.min.apply(null, present) >= 0) lo = 0;
    var ticks = [];
    for (var t = lo; t <= hi + step * 0.001; t += step) ticks.push(Number(t.toFixed(6)));

    var iw = W - padL - padR, ih = H - padT - padB, bw = iw / n;
    var X = function (i) { return padL + (i + 0.5) * bw; };
    var Y = function (v) { return padT + ih - (v - lo) / (hi - lo) * ih; };
    var color = o.color || '#FAFAFA';
    var parts = [];
    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + D.esc(o.label || 'Verlauf') + '">');

    ticks.forEach(function (tv) {
      var y = Y(tv).toFixed(1);
      parts.push('<line class="grid-line" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>');
      parts.push('<text x="' + (padL - 7) + '" y="' + (Number(y) + 3.5) + '" text-anchor="end">' + D.esc(fmtA(tv)) + '</text>');
    });

    if (o.shade) {
      var si = days.indexOf(o.shade.from < o.from ? o.from : o.shade.from);
      var ei = days.indexOf(o.shade.to > o.to ? o.to : o.shade.to);
      if (si >= 0 && ei >= si) {
        var sx = padL + si * bw, ex = padL + (ei + 1) * bw;
        parts.push('<rect x="' + sx.toFixed(1) + '" y="' + padT + '" width="' + (ex - sx).toFixed(1) + '" height="' + ih + '" fill="rgba(255,149,89,0.08)"/>');
        parts.push('<line x1="' + sx.toFixed(1) + '" x2="' + sx.toFixed(1) + '" y1="' + padT + '" y2="' + (padT + ih) + '" stroke="rgba(255,149,89,0.55)" stroke-dasharray="3 3"/>');
        if (o.shade.label) parts.push('<text x="' + (sx + 5).toFixed(1) + '" y="' + (padT + 10) + '" style="fill:#FF9559">' + D.esc(o.shade.label) + '</text>');
      }
    }

    if (o.baseline) {
      var by1 = Y(o.baseline.mean + o.baseline.sd), by2 = Y(o.baseline.mean - o.baseline.sd);
      parts.push('<rect x="' + padL + '" y="' + by1.toFixed(1) + '" width="' + iw + '" height="' + Math.max(0, by2 - by1).toFixed(1) + '" fill="rgba(255,255,255,0.045)" rx="3"/>');
      var bm = Y(o.baseline.mean).toFixed(1);
      parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + bm + '" y2="' + bm + '" stroke="rgba(255,255,255,0.22)" stroke-dasharray="2 4"/>');
    }
    if (o.target && D.isNum(o.target.value)) {
      var ty = Y(o.target.value).toFixed(1);
      parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + ty + '" y2="' + ty + '" stroke="#FF9559" stroke-opacity="0.75" stroke-dasharray="5 4" stroke-width="1.5"/>');
      parts.push('<text x="' + (W - padR) + '" y="' + (Number(ty) - 5) + '" text-anchor="end" style="fill:#FF9559">' + D.esc(o.target.label || 'Ziel') + '</text>');
    }

    if (o.type === 'bar') {
      var bwid = Math.max(1.5, Math.min(26, bw * 0.64));
      var base = Y(Math.max(lo, 0));
      vals.forEach(function (v, i) {
        if (v == null) return;
        var y = Y(v), h = Math.max(1.5, base - y);
        parts.push('<rect x="' + (X(i) - bwid / 2).toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + bwid.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(3, bwid / 2).toFixed(1) + '" fill="' + color + '" fill-opacity="' + (i === n - 1 ? 0.85 : 0.42) + '"/>');
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
      var rawOpacity = o.avg ? 0.5 : 0.95;
      if (dashed) parts.push('<path d="' + dashed + '" fill="none" stroke="' + color + '" stroke-opacity="0.35" stroke-width="1.4" stroke-dasharray="3 4"/>');
      parts.push('<path d="' + solid + '" fill="none" stroke="' + color + '" stroke-opacity="' + rawOpacity + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>');
      if (n <= 45) {
        vals.forEach(function (v, i) {
          if (v == null) return;
          parts.push('<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="' + (i === n - 1 ? 3.6 : 2.4) + '" fill="' + color + '" fill-opacity="' + (i === n - 1 ? 1 : 0.75) + '"/>');
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
      if (ap) parts.push('<path d="' + ap + '" fill="none" stroke="' + (o.type === 'bar' ? '#FFFFFF' : color) + '" stroke-opacity="' + (o.type === 'bar' ? 0.85 : 1) + '" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>');
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

    parts.push('<g class="cross" style="display:none"><line class="cx" y1="' + padT + '" y2="' + (padT + ih) + '" stroke="rgba(255,255,255,0.35)"/><circle class="cd" r="4.5" fill="' + color + '" stroke="#050506" stroke-width="2"/></g>');
    parts.push('<rect class="hit-area" x="' + padL + '" y="0" width="' + iw + '" height="' + H + '" fill="transparent"/>');
    parts.push('</svg><div class="chart-tip"></div>');
    el.innerHTML = parts.join('');

    var svg = el.querySelector('svg');
    var tip = el.querySelector('.chart-tip');
    var cross = svg.querySelector('.cross');
    var cx = cross.querySelector('.cx');
    var cd = cross.querySelector('.cd');
    function show(i) {
      var d = days[i], v = vals[i], a = avgs[i];
      var x = X(i);
      cross.style.display = '';
      cx.setAttribute('x1', x); cx.setAttribute('x2', x);
      if (v != null) { cd.style.display = ''; cd.setAttribute('cx', x); cd.setAttribute('cy', Y(v)); }
      else cd.style.display = 'none';
      var html = D.esc(D.fmtDay(d)) + ' · <b>' + D.esc(v != null ? fmtV(v) : 'keine Daten') + '</b>';
      if (a != null) html += ' <span class="muted">· Ø7 ' + D.esc(fmtV(a)) + '</span>';
      tip.innerHTML = html;
      tip.classList.add('is-on');
      var rect = svg.getBoundingClientRect();
      var scale = rect.width / W;
      var tw = tip.offsetWidth;
      var left = x * scale;
      left = Math.max(tw / 2, Math.min(rect.width - tw / 2, left));
      tip.style.left = left + 'px';
      tip.style.top = '-30px';
      if (o.onPick) o.onPick(d, v, a);
    }
    function hide() {
      cross.style.display = 'none';
      tip.classList.remove('is-on');
      if (o.onPick) o.onPick(null);
    }
    function pick(e) {
      var rect = svg.getBoundingClientRect();
      var px = (e.clientX - rect.left) * (W / rect.width);
      var i = Math.floor((px - padL) / bw);
      i = Math.max(0, Math.min(n - 1, i));
      show(i);
    }
    svg.addEventListener('pointermove', pick);
    svg.addEventListener('pointerdown', pick);
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    el._chartHide = hide;
  };

  /* Small sparkline as an SVG string. values: array with nulls allowed. */
  D.sparkSVG = function (values, color, opts) {
    opts = opts || {};
    var w = opts.w || 100, h = opts.h || 30;
    var pts = [];
    values.forEach(function (v, i) { if (D.isNum(v)) pts.push([i, v]); });
    if (pts.length < 2) return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"></svg>';
    var lo = Math.min.apply(null, pts.map(function (p) { return p[1]; }));
    var hi = Math.max.apply(null, pts.map(function (p) { return p[1]; }));
    if (opts.ref != null) { lo = Math.min(lo, opts.ref); hi = Math.max(hi, opts.ref); }
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    var n = Math.max(2, values.length);
    var X = function (i) { return (i / (n - 1)) * (w - 4) + 2; };
    var Y = function (v) { return h - 3 - (v - lo) / (hi - lo) * (h - 6); };
    var d = '';
    pts.forEach(function (p, i) {
      d += (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1);
    });
    var last = pts[pts.length - 1];
    var ref = opts.ref != null ? '<line x1="0" x2="' + w + '" y1="' + Y(opts.ref).toFixed(1) + '" y2="' + Y(opts.ref).toFixed(1) + '" stroke="rgba(255,255,255,0.18)" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>' : '';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + ref +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + X(last[0]).toFixed(1) + '" cy="' + Y(last[1]).toFixed(1) + '" r="2.2" fill="' + color + '"/></svg>';
  };

  /* ---------------- Claude (Anthropic API, direct from the browser) ---------------- */
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
        var text = (data.content || [])
          .filter(function (b) { return b && b.type === 'text'; })
          .map(function (b) { return b.text; })
          .join('')
          .trim();
        return { text: text, content: data.content || [], stop: data.stop_reason };
      });
    });
  };
})();
