/* =====================================================================
   app.js — Navigation, Tagesbalken, Einstellungen, Backup, Start
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  /* ---------------- Router ---------------- */
  var VIEWS = ['heute', 'ziele', 'gym', 'uni', 'verlauf'];
  var TITLES = { heute: 'Mein Dashboard', ziele: 'Ziele', gym: 'Gym', uni: 'Uni', verlauf: 'Verlauf' };
  var current = null;
  function viewFromHash() {
    var h = (window.location.hash || '').replace(/^#/, '');
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
    $('daybar').hidden = view !== 'heute';
    document.title = view === 'heute' ? 'Mein Dashboard' : TITLES[view] + ' · Mein Dashboard';
    if (view === 'verlauf') D.History.render();
    if (view === 'ziele') D.Goals.render();
    if (view === 'gym') D.Gym.render();
    if (view === 'uni') D.Uni.render();
  }
  D.go = function (view, opts) {
    if (view === 'verlauf' && opts && opts.metric) D.History.select(opts.metric);
    if (window.location.hash !== '#' + view) window.location.hash = view;
    else show(view);
    window.scrollTo(0, 0);
  };
  window.addEventListener('hashchange', function () { show(viewFromHash()); window.scrollTo(0, 0); });

  /* ---------------- Greeting + day bar ---------------- */
  var lastActive = null;
  function updateDay() {
    var s = D.getSettings();
    var now = new Date();
    var h = now.getHours();
    var greet = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
    $('greet').textContent = greet + ' · ' + D.fmtDayLong(D.todayStr());
    var hours = h + now.getMinutes() / 60;
    if (s.sleepHour > 24 && hours < s.sleepHour - 24) hours += 24;
    var pct, text;
    if (hours < s.wakeHour) { pct = 0; text = 'Noch ' + D.fmtHM(s.wakeHour - hours) + ' bis zum Aufstehen'; }
    else if (hours < s.sleepHour) {
      pct = (hours - s.wakeHour) / (s.sleepHour - s.wakeHour) * 100;
      text = 'Noch <b>' + D.fmtHM(s.sleepHour - hours) + '</b> wach';
    } else { pct = 100; text = 'Schon nach deiner Schlafenszeit 🌙'; }
    $('daybarText').innerHTML = '<span>' + text + '</span><span>' + Math.floor(pct) + ' % vom Tag</span>';
    $('daybarFill').style.width = pct + '%';

    var a = D.activeDate();
    if (lastActive && a !== lastActive) { D.Goals.dayChanged(); D.renderBody(); D.Gym.render(); D.Uni.render(); }
    lastActive = a;
  }
  function startDay() {
    updateDay();
    var now = new Date();
    setTimeout(function () { updateDay(); setInterval(updateDay, 60 * 1000); }, (60 - now.getSeconds()) * 1000 + 50);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') updateDay(); });
  }

  /* ---------------- Settings ---------------- */
  function hourLabel(h) { return D.pad2(h % 24) + ':00'; }
  function fillSelects() {
    var w = $('setWake'), s = $('setSleep'), g = $('setGymGoal');
    w.innerHTML = ''; s.innerHTML = ''; g.innerHTML = '';
    for (var h = 4; h <= 12; h++) { var o = el('option', null, hourLabel(h) + ' Uhr'); o.value = h; w.appendChild(o); }
    for (var k = 20; k <= 27; k++) { var o2 = el('option', null, hourLabel(k) + ' Uhr' + (k === 24 ? ' (Mitternacht)' : '')); o2.value = k; s.appendChild(o2); }
    for (var n = 1; n <= 7; n++) { var o3 = el('option', null, n + '× pro Woche'); o3.value = n; g.appendChild(o3); }
  }
  function openSettings() {
    var s = D.getSettings();
    $('setApiKey').value = s.apiKey;
    $('setApiKey').type = 'password';
    $('toggleApiKey').textContent = 'Zeigen';
    $('setAthleteId').value = s.athleteId;
    $('setAnthropicKey').value = s.anthropicKey;
    $('setStepGoal').value = s.stepGoal;
    $('setWeightGoal').value = s.weightGoal ? String(s.weightGoal).replace('.', ',') : '';
    $('setStudyGoal').value = s.studyGoalH ? String(s.studyGoalH).replace('.', ',') : '';
    fillSelects();
    $('setWake').value = s.wakeHour;
    $('setSleep').value = s.sleepHour;
    $('setGymGoal').value = s.gymGoal;
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
    var sg = D.parseNum($('setStudyGoal').value);
    var wake = Number($('setWake').value), sleep = Number($('setSleep').value);
    if (sleep - wake < 8) { res.className = 'sheet-result is-error'; res.textContent = 'Zwischen Aufstehen und Schlafenszeit sollten mindestens 8 Stunden liegen.'; return; }
    D.saveSettings({
      apiKey: apiKey,
      athleteId: athleteId,
      anthropicKey: $('setAnthropicKey').value.trim(),
      stepGoal: isFinite(goalNum) && goalNum > 0 ? goalNum : 10000,
      weightGoal: D.isNum(wg) && wg > 20 && wg < 350 ? Math.round(wg * 10) / 10 : null,
      studyGoalH: D.isNum(sg) && sg >= 0 && sg <= 80 ? Math.round(sg * 2) / 2 : 0,
      gymGoal: Number($('setGymGoal').value) || 3,
      wakeHour: wake,
      sleepHour: sleep
    });
    updateDay();
    var keyChanged = prev.apiKey !== apiKey || prev.athleteId !== athleteId;
    if (D.DEMO || !keyChanged) {
      res.className = 'sheet-result is-ok';
      res.textContent = '✓ Gespeichert';
      closeTimer = setTimeout(function () { D.closeSheet('settingsSheet'); }, 700);
      return;
    }
    D.resetBodyCache();
    if (!apiKey) {
      res.className = 'sheet-result is-muted';
      res.textContent = 'Gespeichert. Füge einen Intervals.icu-Schlüssel hinzu, um deine Uhr-Daten zu laden.';
      return;
    }
    var btn = $('settingsSave');
    btn.disabled = true;
    res.className = 'sheet-result is-muted';
    res.textContent = 'Teste Verbindung…';
    D.testConnection(apiKey, athleteId).then(function () {
      res.className = 'sheet-result is-ok';
      res.textContent = '✓ Verbunden — lade deine Daten…';
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
  var BACKUP_KEYS = ['goal_history_v1', 'goal_streak_v1', 'gym_v1', 'uni_exams_v1', 'uni_sessions_v1'];
  function backupKey(k) { return BACKUP_KEYS.indexOf(k) >= 0 || /^(goals|weekgoals):\d{4}-\d{2}-\d{2}$/.test(k); }
  function exportBackup() {
    var data = {};
    BACKUP_KEYS.forEach(function (k) { var v = D.storeGet(k); if (v != null) data[k] = v; });
    D.storeListKeys('goals:').concat(D.storeListKeys('weekgoals:')).forEach(function (k) { data[k] = D.storeGet(k); });
    var s = D.storeGet('body_settings_v1') || {};
    var safe = {};
    Object.keys(s).forEach(function (k) { if (k !== 'apiKey' && k !== 'anthropicKey') safe[k] = s[k]; });
    data.body_settings_v1 = safe;
    var blob = new Blob([JSON.stringify({ app: 'mein-dashboard', version: 2, exportedAt: new Date().toISOString(), data: data }, null, 2)], { type: 'application/json' });
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
      if (!window.confirm('Backup vom ' + label + ' importieren? Ziele, Gym-Tage, Uni-Termine und Lernzeiten aus dem Backup ersetzen die gleichen Einträge hier. API-Schlüssel bleiben unverändert.')) return;
      Object.keys(p.data).forEach(function (k) {
        if (k === 'body_settings_v1') {
          var cur = D.storeGet('body_settings_v1') || {};
          var inc = p.data[k] || {};
          Object.keys(inc).forEach(function (x) { if (x !== 'apiKey' && x !== 'anthropicKey') cur[x] = inc[x]; });
          D.storeSet('body_settings_v1', cur);
        } else if (backupKey(k)) D.storeSet(k, p.data[k]);
      });
      D.Goals.render();
      D.emit('settings');
      D.emit('gym');
      D.emit('uni');
      D.closeSheet('settingsSheet');
      D.toast('Backup importiert ✓');
    };
    r.readAsText(file);
  }

  /* ---------------- Boot ---------------- */
  function boot() {
    D.injectIcons();
    if (D.DEMO) $('demoBanner').hidden = false;
    D.Goals.seedDemo();
    D.Gym.seedDemo();
    D.Uni.seedDemo();

    D.Goals.boot();
    D.Body.boot();
    D.Gym.boot();
    D.Uni.boot();
    D.History.boot();
    D.Photos.boot();
    D.Ask.boot();

    document.querySelectorAll('[data-nav]').forEach(function (b) { b.addEventListener('click', function () { D.go(b.getAttribute('data-nav')); }); });
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
    $('exportBtn').addEventListener('click', exportBackup);
    $('importFile').addEventListener('change', function () { var f = this.files && this.files[0]; if (f) importBackup(f); this.value = ''; });
    $('sheetBackdrop').addEventListener('click', function () { D.closeSheet(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && D.topSheet()) D.closeSheet(); });
    $('goalTicker').addEventListener('click', function () { D.go('ziele'); });
    $('miniGoalsMore').addEventListener('click', function () { D.go('ziele'); });

    startDay();
    show(viewFromHash());
    if (/[?&]log=(gewicht|weight)(?:&|$)/.test(window.location.search)) setTimeout(D.openMeasure, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
