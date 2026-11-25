/* =====================================================================
   app.js — Navigation, Tagesring, Einstellungen, Backup, Start
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  /* ---------------- Router ---------------- */
  var VIEWS = ['heute', 'verlauf', 'ziele', 'experimente', 'fotos'];
  var TITLES = { heute: 'Mein Dashboard', verlauf: 'Verlauf', ziele: 'Ziele', experimente: 'Experimente', fotos: 'Fotos' };
  var current = null;

  function viewFromHash() {
    var h = (window.location.hash || '').replace(/^#/, '').split('?')[0];
    return VIEWS.indexOf(h) >= 0 ? h : 'heute';
  }
  function show(view) {
    current = view;
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('[data-nav]').forEach(function (b) {
      if (b.getAttribute('data-nav') === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('pageTitle').textContent = TITLES[view];
    document.title = view === 'heute' ? 'Mein Dashboard' : TITLES[view] + ' · Mein Dashboard';
    if (view === 'verlauf') D.History.render();
    if (view === 'ziele') D.Goals.renderHistory();
    if (view === 'experimente') D.Experiments.render();
    if (view === 'fotos') D.Photos.render();
  }
  D.go = function (view, opts) {
    if (view === 'verlauf' && opts && opts.metric) D.History.select(opts.metric);
    if (viewFromHash() !== view || current !== view) {
      if (window.location.hash !== '#' + view) window.location.hash = view;
      else show(view);
    } else {
      show(view);
    }
    window.scrollTo(0, 0);
  };
  window.addEventListener('hashchange', function () { show(viewFromHash()); window.scrollTo(0, 0); });

  /* ---------------- Greeting ---------------- */
  function renderGreeting() {
    var h = new Date().getHours();
    var g = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
    $('greet').textContent = g + ' · ' + D.fmtDayLong(D.todayStr());
  }

  /* ---------------- Day ring ---------------- */
  var SUN_STOPS = [
    [0, [255, 216, 158]], [12.5, [255, 205, 121]], [25, [255, 227, 143]], [37.5, [255, 183, 106]],
    [50, [255, 149, 89]], [62.5, [243, 111, 79]], [75, [226, 93, 122]], [87.5, [123, 91, 176]], [100, [47, 58, 102]]
  ];
  var RING_C = 2 * Math.PI * 52;
  function sunColor(pct) {
    var p = Math.max(0, Math.min(100, pct));
    for (var i = 0; i < SUN_STOPS.length - 1; i++) {
      var a = SUN_STOPS[i], b = SUN_STOPS[i + 1];
      if (p >= a[0] && p <= b[0]) {
        var t = (p - a[0]) / (b[0] - a[0]);
        return 'rgb(' + [0, 1, 2].map(function (k) { return Math.round(a[1][k] + (b[1][k] - a[1][k]) * t); }).join(', ') + ')';
      }
    }
    return 'rgb(47, 58, 102)';
  }
  function hourLabel(h) { return D.pad2(h % 24) + ':00'; }
  var lastActive = null;
  function updateDayRing() {
    var s = D.getSettings();
    var WAKE = s.wakeHour, SLEEP = s.sleepHour;
    var now = new Date();
    var hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    // After midnight but before a late bedtime (e.g. 01:00), count as the same evening.
    if (SLEEP > 24 && hours < SLEEP - 24) hours += 24;
    var fill = $('ringFill');
    fill.style.strokeDasharray = String(RING_C);
    var pct, color, pctHTML, phase, status, remaining;
    if (hours < WAKE) {
      pct = 0; color = '#4D4B47'; pctHTML = '—'; phase = 'SCHLAF'; status = '😴 Du schläfst noch';
      remaining = 'noch ' + D.fmtHM(WAKE - hours) + ' bis zum Aufstehen';
    } else if (hours < SLEEP) {
      pct = (hours - WAKE) / (SLEEP - WAKE) * 100;
      color = sunColor(pct);
      pctHTML = Math.floor(pct) + '<span class="pct-sign">%</span>';
      if (pct < 25) { phase = 'MORGEN'; status = '☀️ Morgen — frischer Start'; }
      else if (pct < 50) { phase = 'MITTAG'; status = '⚡ Mittag — dranbleiben'; }
      else if (pct < 75) { phase = 'NACHMITTAG'; status = '🔥 Nachmittag — Gas geben'; }
      else if (pct < 90) { phase = 'ABEND'; status = '⏳ Abend — Tag abschließen'; }
      else { phase = 'BETTZEIT'; status = '🌙 Bald Schlafenszeit'; }
      remaining = 'noch ' + D.fmtHM(SLEEP - hours) + ' wach';
    } else {
      pct = 100; color = '#E25D7A'; pctHTML = '100<span class="pct-sign">%</span>';
      phase = 'ZU SPÄT'; status = '⚠️ Schon nach deiner Schlafenszeit'; remaining = 'Ab ins Bett!';
    }
    fill.style.stroke = color;
    fill.style.strokeDashoffset = String(RING_C * (1 - pct / 100));
    fill.style.opacity = pct > 0 ? '1' : '0';
    $('ringPct').innerHTML = pctHTML;
    $('ringPhase').textContent = phase;
    $('ringClock').textContent = D.fmtClock(now);
    $('dayStatus').textContent = status;
    $('dayRemaining').textContent = remaining;
    $('dayHours').textContent = 'Wach-Fenster ' + hourLabel(WAKE) + ' – ' + hourLabel(SLEEP);
    $('dayRing').setAttribute('aria-label', 'Tag zu ' + Math.floor(pct) + ' % vorbei');
    renderGreeting();

    var a = D.activeDate();
    if (lastActive && a !== lastActive) {
      D.Goals.dayChanged();
      D.Body.renderCheckin();
      D.renderBody();
    }
    lastActive = a;
  }
  function startDayRing() {
    updateDayRing();
    var now = new Date();
    setTimeout(function () {
      updateDayRing();
      setInterval(updateDayRing, 60 * 1000);
    }, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') updateDayRing();
    });
  }

  /* ---------------- Settings sheet ---------------- */
  var DIR_KEYS = ['sleep', 'hrv', 'rhr', 'steps', 'sleepScore', 'weight', 'bodyFat', 'readiness', 'mood', 'energy', 'stress', 'goals'];
  function fillHours() {
    var w = $('setWake'), s = $('setSleep');
    w.innerHTML = ''; s.innerHTML = '';
    for (var h = 4; h <= 12; h++) { var o = el('option', null, hourLabel(h) + ' Uhr'); o.value = h; w.appendChild(o); }
    for (var k = 20; k <= 27; k++) { var o2 = el('option', null, hourLabel(k) + ' Uhr' + (k >= 24 ? (k === 24 ? ' (Mitternacht)' : ' (nachts)') : '')); o2.value = k; s.appendChild(o2); }
  }
  function renderDirs(dirs) {
    var wrap = $('dirList');
    wrap.innerHTML = '';
    DIR_KEYS.forEach(function (k) {
      var m = D.M[k];
      var row = el('div', 'dir-row');
      var lab = el('label', 'dir-row-label');
      lab.setAttribute('for', 'dir-' + k);
      lab.appendChild(document.createTextNode(m.label));
      var b = D.baseline(k);
      var info = !D.hasData(k) ? 'noch keine Daten' : (b && b.n >= D.BASE_MIN
        ? 'Basis ' + D.fmtValue(k, b.mean) + (b.frozen ? '' : ' · vorläufig (' + b.n + '/30 Tage)')
        : 'Basis bildet sich (' + (b ? b.n : 0) + '/14 Tage)');
      lab.appendChild(el('small', null, info));
      var sel = el('select', 'select-input');
      sel.id = 'dir-' + k;
      [['higher', 'Höher ist besser'], ['lower', 'Niedriger ist besser'], ['off', 'Nicht im Index']].forEach(function (p) {
        var o = el('option', null, p[1]);
        o.value = p[0];
        sel.appendChild(o);
      });
      sel.value = dirs[k] || 'off';
      row.appendChild(lab);
      row.appendChild(sel);
      wrap.appendChild(row);
    });
  }
  function openSettings() {
    var s = D.getSettings();
    $('setApiKey').value = s.apiKey;
    $('setApiKey').type = 'password';
    $('toggleApiKey').textContent = 'Zeigen';
    $('setAthleteId').value = s.athleteId;
    $('setStepGoal').value = s.stepGoal;
    $('setWeightGoal').value = s.weightGoal ? String(s.weightGoal).replace('.', ',') : '';
    $('setAnthropicKey').value = s.anthropicKey;
    fillHours();
    $('setWake').value = s.wakeHour;
    $('setSleep').value = s.sleepHour;
    renderDirs(s.dirs);
    $('settingsResult').textContent = '';
    $('settingsResult').className = 'sheet-result';
    $('demoNote').hidden = !D.DEMO;
    D.openSheet('settingsSheet');
  }
  D.openSettings = openSettings;
  var closeTimer = null;
  function saveSettings() {
    var res = $('settingsResult');
    var prev = D.getSettings();
    var apiKey = $('setApiKey').value.trim();
    var athleteId = $('setAthleteId').value.trim() || '0';
    var goalNum = Math.round(Number($('setStepGoal').value));
    var wg = D.parseNum($('setWeightGoal').value);
    var wake = Number($('setWake').value), sleep = Number($('setSleep').value);
    if (sleep - wake < 8) { res.className = 'sheet-result is-error'; res.textContent = 'Zwischen Aufstehen und Schlafenszeit sollten mindestens 8 Stunden liegen.'; return; }
    var dirs = {};
    DIR_KEYS.forEach(function (k) { dirs[k] = $('dir-' + k).value; });
    var dirsChanged = DIR_KEYS.some(function (k) { return dirs[k] !== prev.dirs[k]; });
    D.saveSettings({
      apiKey: apiKey,
      athleteId: athleteId,
      stepGoal: isFinite(goalNum) && goalNum > 0 ? goalNum : 10000,
      weightGoal: D.isNum(wg) && wg > 20 && wg < 350 ? Math.round(wg * 10) / 10 : null,
      anthropicKey: $('setAnthropicKey').value.trim(),
      wakeHour: wake,
      sleepHour: sleep,
      dirs: dirs
    });
    updateDayRing();
    if (dirsChanged) D.emit('data');
    var keyChanged = prev.apiKey !== apiKey || prev.athleteId !== athleteId;
    if (D.DEMO) {
      res.className = 'sheet-result is-ok';
      res.textContent = '✓ Gespeichert (Demo-Modus: Einstellungen gelten nur für die Demo)';
      closeTimer = setTimeout(function () { D.closeSheet('settingsSheet'); }, 1000);
      return;
    }
    if (!apiKey) {
      if (keyChanged) D.resetBodyCache();
      res.className = 'sheet-result is-muted';
      res.textContent = 'Gespeichert. Füge einen Intervals.icu-Schlüssel hinzu, um deine Daten zu laden.';
      D.renderBody();
      return;
    }
    if (!keyChanged) {
      res.className = 'sheet-result is-ok';
      res.textContent = '✓ Gespeichert';
      closeTimer = setTimeout(function () { D.closeSheet('settingsSheet'); }, 700);
      return;
    }
    D.resetBodyCache();
    var btn = $('settingsSave');
    btn.disabled = true;
    res.className = 'sheet-result is-muted';
    res.textContent = 'Teste Verbindung…';
    D.testConnection(apiKey, athleteId).then(function () {
      res.className = 'sheet-result is-ok';
      res.textContent = '✓ Verbunden — lade deine Historie…';
      D.Body.afterSettingsSaved();
      closeTimer = setTimeout(function () { D.closeSheet('settingsSheet'); }, 1200);
    }).catch(function (err) {
      var c = D.classifyIntervalsError(err);
      res.className = 'sheet-result is-error';
      res.textContent = c.kind === 'offline' ? 'Intervals.icu nicht erreichbar — prüf deine Verbindung.' : c.text.replace(' — zeige gespeicherte Daten.', '.');
      D.renderBody();
    }).then(function () { btn.disabled = false; });
  }

  /* ---------------- Backup ---------------- */
  var BACKUP_KEYS = ['goal_history_v1', 'goal_streak_v1', 'checkins_v1', 'experiments_v1', 'index_baselines_v1', 'ui_history_v1'];
  function exportBackup() {
    var data = {};
    BACKUP_KEYS.forEach(function (k) { var v = D.storeGet(k); if (v != null) data[k] = v; });
    D.storeListKeys('goals:').forEach(function (k) { data[k] = D.storeGet(k); });
    var s = D.storeGet('body_settings_v1') || {};
    var safe = {};
    Object.keys(s).forEach(function (k) { if (k !== 'apiKey' && k !== 'anthropicKey') safe[k] = s[k]; });
    data.body_settings_v1 = safe;
    var payload = { app: 'mein-dashboard', version: 1, exportedAt: new Date().toISOString(), data: data };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dashboard-backup-' + D.todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    D.toast('Backup erstellt');
  }
  function importBackup(file) {
    var r = new FileReader();
    r.onload = function () {
      var p;
      try { p = JSON.parse(r.result); } catch (e) { D.toast('Die Datei ist kein gültiges Backup.'); return; }
      if (!p || p.app !== 'mein-dashboard' || !p.data || typeof p.data !== 'object') { D.toast('Die Datei ist kein Backup dieses Dashboards.'); return; }
      var when = p.exportedAt ? new Date(p.exportedAt) : null;
      var label = when && !isNaN(when) ? D.fmtDate(D.ymd(when)) : 'unbekanntem Datum';
      if (!window.confirm('Backup vom ' + label + ' importieren? Ziele, Check-ins, Experimente und Historie aus dem Backup ersetzen die gleichen Einträge hier. API-Schlüssel bleiben unverändert.')) return;
      Object.keys(p.data).forEach(function (k) {
        if (k === 'body_settings_v1') {
          var cur = D.storeGet('body_settings_v1') || {};
          var inc = p.data[k] || {};
          Object.keys(inc).forEach(function (x) { if (x !== 'apiKey' && x !== 'anthropicKey') cur[x] = inc[x]; });
          D.storeSet('body_settings_v1', cur);
        } else if (BACKUP_KEYS.indexOf(k) >= 0 || /^goals:\d{4}-\d{2}-\d{2}$/.test(k)) {
          D.storeSet(k, p.data[k]);
        }
      });
      D.bump();
      D.Goals.renderAll();
      D.Body.renderCheckin();
      D.emit('data');
      D.emit('settings');
      D.closeSheet('settingsSheet');
      D.toast('Backup importiert ✓');
    };
    r.readAsText(file);
  }

  /* ---------------- Boot ---------------- */
  function boot() {
    D.injectIcons();
    if (D.DEMO) {
      document.documentElement.classList.add('is-demo');
      $('demoBanner').hidden = false;
    }
    D.Goals.seedDemo();
    D.Experiments.seedDemo();

    D.Goals.boot();
    D.Body.boot();
    D.History.boot();
    D.Experiments.boot();
    D.Photos.boot();
    D.Ask.boot();

    document.querySelectorAll('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () { D.go(b.getAttribute('data-nav')); });
    });
    document.querySelectorAll('[data-open-settings]').forEach(function (b) { b.addEventListener('click', openSettings); });
    $('bodyOnboardBtn').addEventListener('click', openSettings);
    $('settingsCancel').addEventListener('click', function () { clearTimeout(closeTimer); D.closeSheet('settingsSheet'); });
    $('settingsSave').addEventListener('click', saveSettings);
    $('toggleApiKey').addEventListener('click', function () {
      var inp = $('setApiKey');
      var showIt = inp.type === 'password';
      inp.type = showIt ? 'text' : 'password';
      this.textContent = showIt ? 'Verbergen' : 'Zeigen';
    });
    $('resetBaselines').addEventListener('click', function () {
      if (!window.confirm('Basis neu berechnen? Dein Index wird dann wieder aus deinen ersten 30 Tagen mit Daten berechnet, die gerade geladen sind.')) return;
      D.resetBaselines();
      renderDirs(D.getSettings().dirs);
      D.toast('Basis wird neu berechnet');
    });
    $('exportBtn').addEventListener('click', exportBackup);
    $('importFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (f) importBackup(f);
      this.value = '';
    });
    $('sheetBackdrop').addEventListener('click', function () { D.closeSheet(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && D.topSheet()) D.closeSheet(); });
    $('goalTicker').addEventListener('click', function () { D.go('ziele'); });
    $('miniGoalsMore').addEventListener('click', function () { D.go('ziele'); });

    startDayRing();
    show(viewFromHash());

    // iOS shortcut entry: ?log=gewicht opens the weight form directly.
    if (/[?&]log=(gewicht|weight)(?:&|$)/.test(window.location.search)) setTimeout(D.openMeasure, 400);
    if (/[?&]ask=1(?:&|$)/.test(window.location.search)) setTimeout(D.Ask.open, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
