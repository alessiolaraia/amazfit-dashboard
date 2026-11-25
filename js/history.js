/* =====================================================================
   history.js — Verlauf: Diagramm, Kennzahlen, Wochenrückblick, Tabelle
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  var UI_KEY = 'ui_history_v1';
  var RANGES = [{ d: 7, l: '7T' }, { d: 30, l: '30T' }, { d: 90, l: '90T' }, { d: 365, l: '1J' }];
  var ui = (function () {
    var s = D.storeGet(UI_KEY) || {};
    return { metric: s.metric || 'index', range: [7, 30, 90, 365].indexOf(s.range) >= 0 ? s.range : 30, rows: 14 };
  })();
  function saveUi() { D.storeSet(UI_KEY, { metric: ui.metric, range: ui.range }); }

  /* Index behaves like a metric for charts. */
  function meta(key) {
    if (key === 'index') return { key: 'index', label: 'Körper-Index', unit: '', dec: 0, color: '#FF9559', chart: 'line', better: 'higher' };
    return D.M[key];
  }
  function getter(key) {
    if (key === 'index') return D.indexValueOn;
    return function (d) { return D.valueOn(key, d); };
  }
  function available() {
    var keys = ['index'];
    D.METRICS.forEach(function (m) { if (D.hasData(m.key)) keys.push(m.key); });
    return keys;
  }
  function fmt(key, v) { return key === 'index' ? D.fmtNum(v, 0) : D.fmtValue(key, v); }
  function fmtDelta(key, v) {
    if (!D.isNum(v)) return '—';
    if (key === 'sleep') {
      var mins = Math.round(v * 60);
      return (mins > 0 ? '+' : mins < 0 ? '−' : '±') + Math.abs(mins) + ' Min';
    }
    var m = meta(key);
    return D.signed(v, key === 'index' ? 0 : m.dec) + (m.unit && key !== 'index' ? (m.unit.charAt(0) === '/' || m.unit === '%' ? '' : ' ') + m.unit : '');
  }
  function toneFor(key, delta) {
    if (!D.isNum(delta) || Math.abs(delta) < 1e-9) return '';
    var better = key === 'index' ? 'higher' : D.betterOf(key);
    var good = better === 'higher' ? delta > 0 : delta < 0;
    return good ? 'num-success' : 'num-warning';
  }

  function renderChips() {
    var wrap = $('historyChips');
    wrap.innerHTML = '';
    var keys = available();
    if (keys.indexOf(ui.metric) < 0) ui.metric = 'index';
    keys.forEach(function (k) {
      var m = meta(k);
      var b = el('button', 'chip-btn');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(k === ui.metric));
      var dot = el('span', 'dot');
      dot.style.color = m.color;
      b.appendChild(dot);
      b.appendChild(document.createTextNode(m.label));
      b.addEventListener('click', function () { ui.metric = k; ui.rows = 14; saveUi(); render(); });
      wrap.appendChild(b);
    });
  }
  function renderRanges() {
    var wrap = $('historyRanges');
    wrap.innerHTML = '';
    RANGES.forEach(function (r) {
      var b = el('button', null, r.l);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(r.d === ui.range));
      b.setAttribute('aria-label', r.d === 365 ? '1 Jahr' : r.d + ' Tage');
      b.addEventListener('click', function () { ui.range = r.d; ui.rows = 14; saveUi(); render(); });
      wrap.appendChild(b);
    });
  }

  function setReadout(key, date, v) {
    var m = meta(key);
    $('readoutLabel').textContent = m.label;
    var val = $('readoutValue');
    val.innerHTML = '';
    if (key === 'sleep' || !D.isNum(v)) {
      val.appendChild(document.createTextNode(D.isNum(v) ? fmt(key, v) : '—'));
    } else {
      val.appendChild(document.createTextNode(D.fmtNum(v, key === 'index' ? 0 : m.dec)));
      if (m.unit && key !== 'index') val.appendChild(el('span', 'unit', m.unit));
    }
    $('readoutDate').textContent = date
      ? D.fmtDayLong(date) + (date.slice(0, 4) !== D.todayStr().slice(0, 4) ? ' ' + date.slice(0, 4) : '')
      : 'Keine Daten im Zeitraum';
  }

  function render() {
    if (!$('view-verlauf') || $('view-verlauf').hidden) return;
    renderChips();
    renderRanges();
    var key = ui.metric, m = meta(key), get = getter(key);
    var to = D.todayStr(), from = D.shift(to, -(ui.range - 1));
    var days = D.dateRange(from, to);
    var pts = days.map(function (d) { return { date: d, v: get(d) }; }).filter(function (p) { return D.isNum(p.v); });
    var last = pts[pts.length - 1];
    setReadout(key, last && last.date, last && last.v);

    var baseline = null;
    if (key === 'index') baseline = { mean: 100, sd: 10 };
    else if (D.indexReady(key)) { var b = D.baseline(key); baseline = { mean: b.mean, sd: b.sd }; }
    var s = D.getSettings();
    var target = null;
    if (key === 'steps') target = { value: s.stepGoal, label: 'Ziel ' + D.fmtNum(s.stepGoal, 0) };
    if (key === 'weight' && s.weightGoal) target = { value: s.weightGoal, label: 'Ziel ' + D.fmtNum(s.weightGoal, 1) + ' kg' };
    if (key === 'sleep') target = { value: 8, label: '8h' };

    var chartEl = $('historyChart');
    D.chart(chartEl, {
      from: from, to: to, get: get, key: key, type: m.chart === 'bar' && ui.range <= 90 ? 'bar' : 'line', color: m.color,
      baseline: baseline, target: target, avg: ui.range >= 14,
      height: window.innerWidth < 480 ? 210 : 250, label: m.label + ' Verlauf',
      onPick: function (d, v) {
        if (!d) setReadout(key, last && last.date, last && last.v);
        else setReadout(key, d, v);
      }
    });
    var lg = $('historyLegend');
    lg.innerHTML = '';
    function legend(cls, text, style) {
      var s2 = el('span');
      var i = el('i', cls);
      if (style) i.setAttribute('style', style);
      s2.appendChild(i);
      s2.appendChild(document.createTextNode(text));
      lg.appendChild(s2);
    }
    var asBar = m.chart === 'bar' && ui.range <= 90;
    legend('l-raw', 'Tageswert', 'background:' + m.color);
    if (ui.range >= 14) legend('l-avg', 'Ø 7 Tage', 'background:' + (asBar ? '#FFFFFF' : m.color));
    if (baseline) legend('l-band', key === 'index' ? 'normaler Bereich (90–110)' : 'deine Basis ± normale Schwankung');
    if (target) legend('l-target', 'Ziel');

    // Stats
    var vals = pts.map(function (p) { return p.v; });
    var prevVals = D.dateRange(D.shift(from, -ui.range), D.shift(from, -1)).map(get).filter(D.isNum);
    var avg = D.mean(vals), pavg = D.mean(prevVals);
    var stats = $('historyStats');
    stats.innerHTML = '';
    function stat(label, value, sub, cls) {
      var c = el('div', 'card stat-card');
      c.appendChild(el('div', 'mini-label', label));
      var n = el('div', 'stat-num' + (cls ? ' ' + cls : ''), value);
      c.appendChild(n);
      if (sub) c.appendChild(el('div', 'stat-sub', sub));
      stats.appendChild(c);
    }
    var minP = null, maxP = null;
    pts.forEach(function (p) { if (!minP || p.v < minP.v) minP = p; if (!maxP || p.v > maxP.v) maxP = p; });
    stat('Durchschnitt', vals.length ? fmt(key, avg) : '—', ui.range === 365 ? 'letztes Jahr' : 'letzte ' + ui.range + ' Tage');
    var dlt = vals.length && prevVals.length >= 3 ? avg - pavg : null;
    stat('Trend', dlt != null ? fmtDelta(key, dlt) : '—', dlt != null ? 'ggü. Zeitraum davor' : 'zu wenig Daten davor', toneFor(key, dlt));
    stat('Minimum', minP ? fmt(key, minP.v) : '—', minP ? D.fmtDay(minP.date) : '');
    stat('Maximum', maxP ? fmt(key, maxP.v) : '—', maxP ? D.fmtDay(maxP.date) : '');
    stat('Tage mit Daten', vals.length + ' / ' + days.length, vals.length ? Math.round(vals.length / days.length * 100) + ' % abgedeckt' : '');

    renderWeekly();
    renderTable(key, from, to, get);
  }

  function renderWeekly() {
    var body = $('weeklyBody');
    body.innerHTML = '';
    var cols = [
      { k: 'index', l: 'Index' },
      { k: 'sleep', l: 'Schlaf' },
      { k: 'hrv', l: 'HRV' },
      { k: 'rhr', l: 'Ruhepuls' },
      { k: 'steps', l: 'Schritte' },
      { k: 'goals', l: 'Ziele' }
    ].filter(function (c) { return c.k === 'index' || D.hasData(c.k); });
    var head = $('weeklyHead');
    head.innerHTML = '';
    var tr0 = el('tr');
    tr0.appendChild(el('th', null, 'Woche'));
    cols.forEach(function (c) { tr0.appendChild(el('th', 'num', c.l)); });
    head.appendChild(tr0);
    var today = D.todayStr();
    var monday = D.mondayOf(today);
    for (var w = 0; w < 6; w++) {
      var start = D.shift(monday, -7 * w);
      var end = w === 0 ? today : D.shift(start, 6);
      var days = D.dateRange(start, end);
      var tr = el('tr');
      var label = 'KW ' + D.isoWeek(start) + (w === 0 ? ' (aktuell)' : '');
      var td0 = el('td', null, label);
      td0.title = D.fmtDayMonth(start) + ' – ' + D.fmtDayMonth(D.shift(start, 6));
      tr.appendChild(td0);
      cols.forEach(function (c) {
        var get = getter(c.k);
        var xs = days.map(get).filter(D.isNum);
        var v = xs.length ? D.mean(xs) : null;
        tr.appendChild(el('td', 'num', v == null ? '—' : fmt(c.k, v)));
      });
      body.appendChild(tr);
    }
  }

  function renderTable(key, from, to, get) {
    var m = meta(key);
    var head = $('dataHead'), body = $('dataBody');
    head.innerHTML = '';
    body.innerHTML = '';
    var tr0 = el('tr');
    tr0.appendChild(el('th', null, 'Tag'));
    tr0.appendChild(el('th', 'num', m.label));
    tr0.appendChild(el('th', 'num', 'Ø 7T'));
    var showIdx = key !== 'index' && D.indexReady(key) && D.getSettings().dirs[key] !== 'off';
    if (showIdx) tr0.appendChild(el('th', 'num', 'Index'));
    head.appendChild(tr0);
    var days = D.dateRange(from, to).reverse().filter(function (d) { return D.isNum(get(d)); });
    days.slice(0, ui.rows).forEach(function (d) {
      var v = get(d);
      var tr = el('tr');
      tr.appendChild(el('td', null, D.fmtDay(d)));
      tr.appendChild(el('td', 'num', fmt(key, v)));
      var a = D.rollingAvg(get, d, 7, 3);
      tr.appendChild(el('td', 'num', a == null ? '—' : fmt(key, a)));
      if (showIdx) { var ix = D.indexOf(key, v); tr.appendChild(el('td', 'num', ix == null ? '—' : D.fmtNum(ix, 0))); }
      body.appendChild(tr);
    });
    if (!days.length) {
      var tr = el('tr');
      var td = el('td', null, 'Keine Werte in diesem Zeitraum.');
      td.colSpan = 4;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    $('dataCount').textContent = days.length + (days.length === 1 ? ' Wert' : ' Werte');
    var moreBtn = $('dataMore');
    moreBtn.hidden = days.length <= ui.rows;
    moreBtn.textContent = 'Weitere ' + Math.min(30, days.length - ui.rows) + ' anzeigen';
    $('historyNote').textContent = key === 'index'
      ? 'Der Index vergleicht jeden Tag mit deiner eigenen Basis (deine ersten 30 Tage). 100 = so warst du da im Schnitt; +10 = eine normale Schwankung besser. Er zählt nur Tage, an denen mindestens die Hälfte deiner Index-Werte gemessen wurde.'
      : 'Jeder Punkt ist ein echter Messwert. Fehlende Tage werden nicht aufgefüllt; gestrichelte Linien überbrücken Lücken.';
  }

  D.History = {
    boot: function () {
      $('dataMore').addEventListener('click', function () { ui.rows += 30; render(); });
      var rt = null;
      window.addEventListener('resize', function () {
        clearTimeout(rt);
        rt = setTimeout(render, 160);
      });
      D.on('data', render);
      D.on('checkins', render);
      D.on('goals', render);
      D.on('settings', render);
    },
    render: render,
    select: function (metric) {
      if (metric) { ui.metric = metric; ui.rows = 14; saveUi(); }
    }
  };
})();
