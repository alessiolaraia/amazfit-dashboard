/* =====================================================================
   experiments.js — "Was wirkt?": Gewohnheit starten/beenden und prüfen,
   ob sie einen Wert wirklich verändert hat.

   Regeln (wie bei The Wire):
   - Vergleich: bis zu 28 Tage VOR dem Start gegen die Tage WÄHREND.
   - Unter 10 Tagen auf einer Seite: kein Urteil, nur "noch X Tage".
   - Effekt kleiner als 2 Standardfehler: "kein klarer Effekt".
   - "Alle Werte prüfen" nutzt eine strengere Hürde (3 Standardfehler),
     weil viele Werte gleichzeitig getestet werden.
   - Überschneiden sich zwei Experimente, wird das genannt statt geraten.
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  var KEY = 'experiments_v1';
  var BEFORE_DAYS = 28;
  var MIN_DAYS = 10;
  var BAR = 2;
  var SCAN_BAR = 3;
  var openScans = {};
  var editingId = null;

  function list() {
    var v = D.storeGet(KEY);
    return Array.isArray(v) ? v.filter(function (e) { return e && e.id && e.name && D.isValidYmd(e.start); }) : [];
  }
  function save(all) { D.storeSet(KEY, all); D.bump(); }
  D.experiments = list;

  function endOf(e) {
    var today = D.todayStr();
    return e.end && e.end < today ? e.end : today;
  }

  function analyze(e, key, bar) {
    var get = function (d) { return D.valueOn(key, d); };
    var end = endOf(e);
    var beforeDays = D.dateRange(D.shift(e.start, -BEFORE_DAYS), D.shift(e.start, -1));
    var duringDays = e.start <= end ? D.dateRange(e.start, end) : [];
    var B = beforeDays.map(get).filter(D.isNum);
    var Dv = duringDays.map(get).filter(D.isNum);
    var r = { key: key, nB: B.length, nD: Dv.length, mB: D.mean(B), mD: D.mean(Dv), needB: Math.max(0, MIN_DAYS - B.length), needD: Math.max(0, MIN_DAYS - Dv.length) };
    if (r.needB || r.needD) { r.status = 'wait'; return r; }
    r.eff = r.mD - r.mB;
    r.se = Math.sqrt(D.variance(B) / B.length + D.variance(Dv) / Dv.length);
    if (!(r.se > 0)) r.se = 1e-9;
    r.z = r.eff / r.se;
    var better = D.betterOf(key);
    if (Math.abs(r.eff) <= bar * r.se) r.status = 'none';
    else r.status = (better === 'higher' ? r.eff > 0 : r.eff < 0) ? 'better' : 'worse';
    return r;
  }

  function collisions(e) {
    var s = e.start, en = endOf(e);
    return list().filter(function (o) {
      if (o.id === e.id) return false;
      var os = o.start, oe = endOf(o);
      return os <= en && oe >= s;
    });
  }

  function fmtEff(key, v) {
    if (key === 'sleep') {
      var mins = Math.round(v * 60);
      return (mins > 0 ? '+' : mins < 0 ? '−' : '±') + Math.abs(mins) + ' Min';
    }
    var m = D.M[key];
    return D.signed(v, m.dec) + (m.unit ? (m.unit.charAt(0) === '/' || m.unit === '%' ? '' : ' ') + m.unit : '');
  }
  function verdictOf(r) {
    if (r.status === 'wait') {
      var need = [];
      if (r.needB) need.push(r.needB + ' Tage Werte vor dem Start');
      if (r.needD) need.push('noch ' + r.needD + ' Tage mit Werten');
      return { tone: 'warning', text: 'Sammelt Daten', explain: 'Für ein Urteil fehlen ' + need.join(' und ') + '. Unter 10 Tagen auf einer Seite rät das Dashboard nicht.' };
    }
    var m = D.M[r.key];
    var eff = fmtEff(r.key, r.eff);
    var range = fmtEff(r.key, Math.abs(BAR * r.se)).replace(/^[+−±]/, '±');
    if (r.status === 'none') {
      return { tone: '', text: 'Kein klarer Effekt', explain: m.label + ' hat sich um ' + eff + ' verändert — das liegt noch innerhalb deiner normalen Schwankung (' + range + '). Weiter beobachten.' };
    }
    if (r.status === 'better') {
      return { tone: 'success', text: 'Wirkt: besser', explain: m.label + ' ist während des Experiments im Schnitt ' + eff + ' — deutlich mehr als die normale Schwankung (' + range + '). Das ist ein Zusammenhang, kein Beweis für die Ursache.' };
    }
    return { tone: 'danger', text: 'Wirkt: schlechter', explain: m.label + ' ist während des Experiments im Schnitt ' + eff + ' — deutlich mehr als die normale Schwankung (' + range + '). Das ist ein Zusammenhang, kein Beweis für die Ursache.' };
  }

  function card(e) {
    var c = el('div', 'card exp-card');
    var r = analyze(e, e.metric, BAR);
    var v = verdictOf(r);
    var head = el('div', 'exp-head');
    var left = el('div');
    left.appendChild(el('h3', 'exp-name', e.name));
    var days = D.daysBetween(e.start, endOf(e)) + 1;
    var period = e.end
      ? D.fmtDayMonth(e.start) + ' – ' + D.fmtDate(e.end) + ' · ' + days + ' Tage · beendet'
      : 'seit ' + D.fmtDate(e.start) + ' · Tag ' + Math.max(0, days);
    if (e.start > D.todayStr()) period = 'startet am ' + D.fmtDate(e.start);
    left.appendChild(el('div', 'exp-period', period + ' · beobachtet: ' + D.M[e.metric].label));
    head.appendChild(left);
    var vd = el('span', 'exp-verdict', v.text);
    if (v.tone) vd.setAttribute('data-tone', v.tone);
    head.appendChild(vd);
    c.appendChild(head);
    if (e.note) c.appendChild(el('p', 'exp-note', e.note));

    var nums = el('div', 'exp-numbers');
    function num(label, value, sub, cls) {
      var d = el('div');
      d.appendChild(el('div', 'mini-label', label));
      d.appendChild(el('div', 'stat-num' + (cls ? ' ' + cls : ''), value));
      if (sub) d.appendChild(el('div', 'stat-sub muted small mono', sub));
      nums.appendChild(d);
    }
    num('Vorher Ø', r.nB ? D.fmtValue(e.metric, r.mB) : '—', r.nB + ' Tage');
    num('Während Ø', r.nD ? D.fmtValue(e.metric, r.mD) : '—', r.nD + ' Tage');
    num('Unterschied', r.status === 'wait' ? '—' : fmtEff(e.metric, r.eff), r.status === 'wait' ? '' : 'Hürde ±' + fmtEff(e.metric, BAR * r.se).replace(/^[+−±]/, ''),
      r.status === 'better' ? 'num-success' : (r.status === 'worse' ? 'num-danger' : ''));
    c.appendChild(nums);
    c.appendChild(el('p', 'exp-explain', v.explain));

    var col = collisions(e);
    if (col.length) {
      c.appendChild(el('p', 'exp-collision', '⚠ Überschneidet sich mit: ' + col.map(function (o) { return '„' + o.name + '“'; }).join(', ') + '. Ein Effekt lässt sich nicht eindeutig zuordnen.'));
    }

    var ch = el('div');
    c.appendChild(ch);
    var from = D.shift(e.start, -BEFORE_DAYS), to = endOf(e) < e.start ? e.start : endOf(e);
    requestAnimationFrame(function () {
      D.chart(ch, {
        from: from, to: to, key: e.metric, type: 'line', color: D.M[e.metric].color,
        get: function (d) { return D.valueOn(e.metric, d); }, avg: true, height: 150,
        shade: { from: e.start, to: to, label: 'Experiment' }, label: e.name
      });
    });

    var scan = el('div', 'exp-scan');
    scan.hidden = !openScans[e.id];
    c.appendChild(scan);
    if (openScans[e.id]) renderScan(scan, e);

    var acts = el('div', 'exp-actions');
    function act(label, fn, cls) {
      var b = el('button', 'text-btn' + (cls ? ' ' + cls : ''), label);
      b.type = 'button';
      b.addEventListener('click', fn);
      acts.appendChild(b);
    }
    act(openScans[e.id] ? 'Prüfung ausblenden' : 'Alle Werte prüfen', function () { openScans[e.id] = !openScans[e.id]; render(); });
    if (!e.end) act('Beenden', function () {
      var all = list();
      all.forEach(function (x) { if (x.id === e.id) x.end = D.todayStr(); });
      save(all);
      render();
      D.toast('„' + e.name + '“ beendet');
    });
    act('Bearbeiten', function () { openForm(e); });
    act('Löschen', function () {
      if (!window.confirm('Experiment „' + e.name + '“ löschen?')) return;
      var all = list();
      var idx = -1;
      all.forEach(function (x, i) { if (x.id === e.id) idx = i; });
      if (idx < 0) return;
      var removed = all.splice(idx, 1)[0];
      save(all);
      render();
      D.toast('Experiment gelöscht', { label: 'Rückgängig', fn: function () { var a = list(); a.splice(idx, 0, removed); save(a); render(); } });
    }, 'danger');
    c.appendChild(acts);
    return c;
  }

  function renderScan(wrap, e) {
    wrap.innerHTML = '';
    wrap.appendChild(el('div', 'mini-label', 'Alle Werte · strengere Hürde (3 Standardfehler)'));
    var t = el('table', 'data-table');
    t.style.marginTop = '10px';
    var head = el('tr');
    ['Wert', 'Vorher', 'Während', 'Δ', 'Ergebnis'].forEach(function (h, i) { head.appendChild(el('th', i ? 'num' : null, h)); });
    var thead = el('thead');
    thead.appendChild(head);
    t.appendChild(thead);
    var tb = el('tbody');
    D.METRICS.forEach(function (m) {
      if (!D.hasData(m.key)) return;
      var r = analyze(e, m.key, SCAN_BAR);
      var tr = el('tr');
      tr.appendChild(el('td', null, m.label));
      tr.appendChild(el('td', 'num', r.nB ? D.fmtValue(m.key, r.mB) : '—'));
      tr.appendChild(el('td', 'num', r.nD ? D.fmtValue(m.key, r.mD) : '—'));
      tr.appendChild(el('td', 'num', r.status === 'wait' ? '—' : fmtEff(m.key, r.eff)));
      var res = r.status === 'wait' ? 'zu wenig' : r.status === 'none' ? 'kein klarer' : r.status === 'better' ? 'besser' : 'schlechter';
      var td = el('td', 'num ' + (r.status === 'better' ? 'num-success' : r.status === 'worse' ? 'num-danger' : ''), res);
      tr.appendChild(td);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var tw = el('div', 'table-wrap');
    tw.appendChild(t);
    wrap.appendChild(tw);
  }

  function render() {
    var wrap = $('expList');
    if (!wrap || $('view-experimente').hidden) return;
    wrap.innerHTML = '';
    var all = list().slice().sort(function (a, b) {
      if (!a.end && b.end) return -1;
      if (a.end && !b.end) return 1;
      return a.start < b.start ? 1 : -1;
    });
    $('expEmpty').hidden = all.length > 0;
    all.forEach(function (e) { wrap.appendChild(card(e)); });
  }

  /* ---------------- Form ---------------- */
  function fillMetricSelect(sel, value) {
    sel.innerHTML = '';
    D.METRICS.forEach(function (m) {
      if (m.key === 'fitness') return;
      var o = el('option', null, m.label + (D.hasData(m.key) ? '' : ' (noch keine Daten)'));
      o.value = m.key;
      sel.appendChild(o);
    });
    sel.value = value || 'sleep';
  }
  function openForm(e) {
    editingId = e ? e.id : null;
    $('expFormTitle').textContent = e ? 'Experiment bearbeiten' : 'Neues Experiment';
    $('expName').value = e ? e.name : '';
    $('expStart').value = e ? e.start : D.todayStr();
    $('expEnd').value = e && e.end ? e.end : '';
    $('expNote').value = e && e.note ? e.note : '';
    fillMetricSelect($('expMetric'), e ? e.metric : 'sleep');
    $('expResult').textContent = '';
    D.openSheet('expSheet');
    if (!e) setTimeout(function () { $('expName').focus({ preventScroll: true }); }, 320);
  }
  function saveForm() {
    var res = $('expResult');
    var name = $('expName').value.replace(/\s+/g, ' ').trim();
    var start = $('expStart').value;
    var end = $('expEnd').value;
    var metric = $('expMetric').value;
    res.className = 'sheet-result is-error';
    if (!name) { res.textContent = 'Gib dem Experiment einen Namen.'; return; }
    if (!D.isValidYmd(start)) { res.textContent = 'Bitte ein gültiges Startdatum wählen.'; return; }
    if (end && (!D.isValidYmd(end) || end < start)) { res.textContent = 'Das Ende muss nach dem Start liegen.'; return; }
    if (!D.M[metric]) { res.textContent = 'Bitte einen Wert wählen.'; return; }
    var all = list();
    var item = { id: editingId || ('e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), name: name.slice(0, 80), start: start, end: end || null, metric: metric, note: $('expNote').value.trim().slice(0, 300) || null, createdAt: Date.now() };
    var found = false;
    all = all.map(function (x) { if (x.id === item.id) { found = true; item.createdAt = x.createdAt || item.createdAt; return item; } return x; });
    if (!found) all.push(item);
    save(all);
    D.closeSheet('expSheet');
    render();
    D.toast(found ? 'Experiment gespeichert' : 'Experiment gestartet 🧪');
  }

  D.Experiments = {
    boot: function () {
      $('expNewBtn').addEventListener('click', function () { openForm(null); });
      $('expEmptyBtn').addEventListener('click', function () { openForm(null); });
      $('expSave').addEventListener('click', saveForm);
      $('expCancel').addEventListener('click', function () { D.closeSheet('expSheet'); });
      document.querySelectorAll('[data-exp-idea]').forEach(function (b) {
        b.addEventListener('click', function () {
          openForm(null);
          $('expName').value = b.getAttribute('data-exp-idea');
          fillMetricSelect($('expMetric'), b.getAttribute('data-exp-metric'));
        });
      });
      D.on('data', render);
      D.on('checkins', render);
      D.on('settings', render);
      D.on('goals', render);
    },
    render: render,
    summaries: function () {
      return list().map(function (e) {
        var r = analyze(e, e.metric, BAR);
        return e.name + ' (' + D.fmtDate(e.start) + (e.end ? ' bis ' + D.fmtDate(e.end) : ', läuft') + ', beobachtet ' + D.M[e.metric].label + '): ' +
          (r.status === 'wait' ? 'noch zu wenig Daten' : 'vorher Ø ' + D.fmtValue(e.metric, r.mB) + ', während Ø ' + D.fmtValue(e.metric, r.mD) + ', Ergebnis: ' + verdictOf(r).text);
      });
    },
    seedDemo: function () {
      if (!D.DEMO || D.storeGet('demo_seeded_exp')) return;
      var t = D.todayStr();
      save([
        { id: 'demo1', name: 'Kein Koffein nach 14 Uhr', start: D.shift(t, -29), end: null, metric: 'sleep', note: 'Nachmittags nur Wasser oder Tee ohne Koffein.', createdAt: Date.now() },
        { id: 'demo2', name: '10 Min Dehnen vor dem Schlafen', start: D.shift(t, -80), end: D.shift(t, -45), metric: 'hrv', note: null, createdAt: Date.now() },
        { id: 'demo3', name: 'Handy ab 22 Uhr weg', start: D.shift(t, -4), end: null, metric: 'sleepScore', note: null, createdAt: Date.now() }
      ]);
      D.storeSet('demo_seeded_exp', true);
    }
  };
})();
