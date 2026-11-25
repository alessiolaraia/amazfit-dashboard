/* =====================================================================
   history.js — Verlauf: Diagramm, Zusammenfassung in Worten,
   Wochenrückblick (inkl. Gym & Lernzeit), alle Werte
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  var UI_KEY = 'ui_history_v2';
  var RANGES = [{ d: 7, l: '7 Tage' }, { d: 30, l: '30 Tage' }, { d: 90, l: '3 Monate' }, { d: 365, l: '1 Jahr' }];
  var ui = (function () {
    var s = D.storeGet(UI_KEY) || {};
    return { metric: D.M[s.metric] ? s.metric : 'sleep', range: [7, 30, 90, 365].indexOf(s.range) >= 0 ? s.range : 30, rows: 10 };
  })();
  function saveUi() { D.storeSet(UI_KEY, { metric: ui.metric, range: ui.range }); }
  function get(d) { return D.valueOn(ui.metric, d); }

  function renderChips() {
    var wrap = $('historyChips');
    wrap.innerHTML = '';
    var keys = D.METRICS.filter(function (m) { return ['sleep', 'hrv', 'rhr', 'steps', 'weight'].indexOf(m.key) >= 0 || D.hasData(m.key); }).map(function (m) { return m.key; });
    keys.forEach(function (k) {
      var b = el('button', 'chip', D.M[k].label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(k === ui.metric));
      b.addEventListener('click', function () { ui.metric = k; ui.rows = 10; saveUi(); render(); });
      wrap.appendChild(b);
    });
    var r = $('historyRanges');
    r.innerHTML = '';
    RANGES.forEach(function (x) {
      var b = el('button', null, x.l);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(x.d === ui.range));
      b.addEventListener('click', function () { ui.range = x.d; ui.rows = 10; saveUi(); render(); });
      r.appendChild(b);
    });
  }

  function setReadout(date, v) {
    var m = D.M[ui.metric];
    var val = $('readoutValue');
    val.innerHTML = '';
    if (ui.metric === 'sleep' || !D.isNum(v)) val.textContent = D.isNum(v) ? D.fmtValue(ui.metric, v) : '—';
    else {
      val.appendChild(document.createTextNode(D.fmtNum(v, m.dec)));
      if (m.unit) val.appendChild(el('span', 'unit', m.unit));
    }
    $('readoutDate').textContent = date ? D.fmtDayLong(date) + (date.slice(0, 4) !== D.todayStr().slice(0, 4) ? ' ' + date.slice(0, 4) : '') : 'Keine Daten im Zeitraum';
  }

  function rangeName(d) { return d === 7 ? 'der letzten Woche' : d === 30 ? 'den letzten 30 Tagen' : d === 90 ? 'den letzten 3 Monaten' : 'dem letzten Jahr'; }

  function render() {
    if ($('view-verlauf').hidden) return;
    renderChips();
    var key = ui.metric, m = D.M[key];
    var to = D.todayStr(), from = D.shift(to, -(ui.range - 1));
    var days = D.dateRange(from, to);
    var pts = days.map(function (d) { return { date: d, v: get(d) }; }).filter(function (p) { return D.isNum(p.v); });
    var last = pts[pts.length - 1];
    $('readoutLabel').textContent = m.label;
    setReadout(last && last.date, last && last.v);
    $('metricAbout').textContent = m.about || '';

    var s = D.getSettings();
    var target = null;
    if (key === 'steps') target = { value: s.stepGoal, label: 'Ziel' };
    if (key === 'weight' && s.weightGoal) target = { value: s.weightGoal, label: 'Ziel ' + D.fmtNum(s.weightGoal, 1) + ' kg' };
    if (key === 'sleep') target = { value: 8, label: '8h' };
    var n = D.normalOf(key, to);
    var asBar = m.chart === 'bar' && ui.range <= 90;
    D.chart($('historyChart'), {
      from: from, to: to, get: get, key: key, type: asBar ? 'bar' : 'line',
      baseline: n && ui.range <= 90 ? { mean: n.mean, sd: n.sd } : null,
      target: target, avg: ui.range >= 14,
      height: window.innerWidth < 480 ? 210 : 250, label: m.label + ' Verlauf',
      onPick: function (d, v) { if (!d) setReadout(last && last.date, last && last.v); else setReadout(d, v); }
    });
    var lg = $('historyLegend');
    lg.innerHTML = '';
    function legend(cls, text) { var sp = el('span'); sp.appendChild(el('i', cls)); sp.appendChild(document.createTextNode(text)); lg.appendChild(sp); }
    legend('l-raw', 'Tageswert');
    if (ui.range >= 14) legend('l-avg', 'Durchschnitt (7 Tage)');
    if (n && ui.range <= 90) legend('l-band', 'dein normaler Bereich');
    if (target) legend('l-target', 'Ziel');

    // Plain-language summary
    var vals = pts.map(function (p) { return p.v; });
    var prevVals = D.dateRange(D.shift(from, -ui.range), D.shift(from, -1)).map(get).filter(D.isNum);
    var avg = D.mean(vals), pavg = D.mean(prevVals);
    var sum = $('historySummary');
    if (!vals.length) {
      sum.textContent = 'In ' + rangeName(ui.range) + ' gibt es keine Werte für ' + m.label + '.';
    } else {
      var html = 'In ' + rangeName(ui.range) + ' lag dein Durchschnitt bei <b>' + D.esc(D.fmtValue(key, avg)) + '</b>';
      if (prevVals.length >= 3) {
        var dlt = avg - pavg;
        var better = m.better === 'higher' ? dlt > 0 : dlt < 0;
        var tiny = Math.abs(dlt) < (key === 'sleep' ? 0.1 : key === 'steps' ? 300 : key === 'weight' ? 0.3 : 1);
        html += tiny ? ' — ungefähr gleich wie im Zeitraum davor.'
          : ' — <b>' + D.esc(D.fmtDelta(key, dlt)) + '</b> ' + (key === 'weight' ? 'im Vergleich' : (better ? 'besser als' : 'schlechter als')) + (key === 'weight' ? ' zum Zeitraum davor.' : ' im Zeitraum davor.');
      } else html += '.';
      sum.innerHTML = html;
    }
    var minP = null, maxP = null;
    pts.forEach(function (p) { if (!minP || p.v < minP.v) minP = p; if (!maxP || p.v > maxP.v) maxP = p; });
    $('statMin').textContent = minP ? D.fmtValue(key, minP.v) : '—';
    $('statMinDate').textContent = minP ? D.fmtDay(minP.date) : '';
    $('statMax').textContent = maxP ? D.fmtValue(key, maxP.v) : '—';
    $('statMaxDate').textContent = maxP ? D.fmtDay(maxP.date) : '';
    $('statDays').textContent = vals.length + ' / ' + days.length;

    renderWeekly();
    renderTable(key, from, to);
  }

  function renderWeekly() {
    var cols = [
      { l: 'Schlaf', f: function (days) { return avgOf('sleep', days); } },
      { l: 'Schritte', f: function (days) { return avgOf('steps', days); } },
      { l: 'Gym', f: function (days, mon) { return D.gymWeekCount ? D.gymWeekCount(mon) + '×' : '—'; } },
      { l: 'Lernen', f: function (days, mon) { return D.studyMinsWeek ? D.fmtMins(D.studyMinsWeek(mon)) : '—'; } },
      { l: 'Ziele', f: function (days, mon) { var s = D.Goals.weekSummary(mon); return s.total ? Math.round(s.done / s.total * 100) + ' %' : '—'; } }
    ];
    function avgOf(k, days) { var xs = days.map(function (d) { return D.valueOn(k, d); }).filter(D.isNum); return xs.length ? D.fmtValue(k, D.mean(xs)) : '—'; }
    var head = $('weeklyHead');
    head.innerHTML = '';
    var tr0 = el('tr');
    tr0.appendChild(el('th', null, 'Woche'));
    cols.forEach(function (c) { tr0.appendChild(el('th', 'r', c.l)); });
    head.appendChild(tr0);
    var body = $('weeklyBody');
    body.innerHTML = '';
    var monday = D.mondayOf(D.todayStr());
    for (var w = 0; w < 6; w++) {
      var mon = D.shift(monday, -7 * w);
      var days = D.weekDays(mon).filter(function (d) { return d <= D.todayStr(); });
      var tr = el('tr');
      tr.appendChild(el('td', null, w === 0 ? 'Diese Woche' : 'KW ' + D.isoWeek(mon)));
      cols.forEach(function (c) { tr.appendChild(el('td', 'r', c.f(days, mon))); });
      body.appendChild(tr);
    }
  }

  function renderTable(key, from, to) {
    var m = D.M[key];
    $('dataHead').innerHTML = '<tr><th>Tag</th><th class="r">' + D.esc(m.label) + '</th><th class="r">Ø 7 Tage</th></tr>';
    var body = $('dataBody');
    body.innerHTML = '';
    var days = D.dateRange(from, to).reverse().filter(function (d) { return D.isNum(get(d)); });
    days.slice(0, ui.rows).forEach(function (d) {
      var tr = el('tr');
      tr.appendChild(el('td', null, D.fmtDay(d)));
      tr.appendChild(el('td', 'r', D.fmtValue(key, get(d))));
      var a = D.rollingAvg(get, d, 7, 3);
      tr.appendChild(el('td', 'r', a == null ? '—' : D.fmtValue(key, a)));
      body.appendChild(tr);
    });
    if (!days.length) body.innerHTML = '<tr><td colspan="3">Keine Werte in diesem Zeitraum.</td></tr>';
    var more = $('dataMore');
    more.hidden = days.length <= ui.rows;
    more.textContent = 'Weitere ' + Math.min(30, days.length - ui.rows) + ' anzeigen';
  }

  D.History = {
    boot: function () {
      $('dataMore').addEventListener('click', function () { ui.rows += 30; render(); });
      var rt = null;
      window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(render, 160); });
      ['data', 'settings', 'goals', 'gym', 'uni'].forEach(function (e) { D.on(e, render); });
    },
    render: render,
    select: function (metric) { if (D.M[metric]) { ui.metric = metric; ui.rows = 10; saveUi(); } }
  };
})();
