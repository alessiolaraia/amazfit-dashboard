/* =====================================================================
   body.js — Amazfit (Zepp) via Intervals.icu: laden, cachen, schreiben,
   Demo-Daten, "Tagesform"-Karte, Schritte, Gewicht
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  var CACHE_KEY = 'body_cache_v2';
  var API_BASE = 'https://intervals.icu/api/v1';
  var FETCH_TIMEOUT_MS = 20000;
  var MIN_FETCH_GAP_MS = 30000;
  var AUTO_REFRESH_MS = 15 * 60 * 1000;
  var STALE_ON_VISIBLE_MS = 2 * 60 * 1000;
  var FULL_DAYS = 400;
  var INCREMENTAL_DAYS = 21;
  var ACTIVITY_DAYS = 120;
  var KEEP = ['id', 'sleepSecs', 'sleepScore', 'avgSleepingHR', 'hrv', 'restingHR', 'steps', 'weight', 'bodyFat', 'readiness', 'spO2', 'ctl', 'atl', 'updated'];
  var KEEP_ACT = ['name', 'type', 'start_date_local', 'moving_time', 'average_heartrate', 'icu_training_load'];

  function slim(r, keys) { var o = {}; keys.forEach(function (k) { if (r[k] != null) o[k] = r[k]; }); return o; }
  function loadCache() { var c = D.storeGet(CACHE_KEY); return c && typeof c === 'object' && c.w ? c : null; }
  function applyModel(c) {
    D.model = { w: (c && c.w) || {}, a: (c && c.a) || [], fetchedAt: c ? c.fetchedAt : null };
    D.bump();
    D.emit('data');
  }

  /* ---------------- API ---------------- */
  function request(method, url, apiKey, signal, body) {
    var headers;
    try { headers = { 'Authorization': 'Basic ' + btoa('API_KEY:' + apiKey), 'Accept': 'application/json' }; }
    catch (e) { var bad = new Error('Ungültiger Schlüssel'); bad.status = 401; return Promise.reject(bad); }
    var init = { method: method, headers: headers, signal: signal, cache: 'no-store' };
    if (body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(url, init).then(function (res) {
      if (!res.ok) { var err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
      return res.status === 204 ? null : res.json();
    });
  }
  function athletePath(id) { return API_BASE + '/athlete/' + encodeURIComponent(id); }
  function classifyError(err) {
    if (err && (err.status === 401 || err.status === 403)) return { kind: 'auth', text: 'Intervals.icu hat den API-Schlüssel abgelehnt — prüf die Einstellungen (⚙).' };
    if (err && err.status === 404) return { kind: 'http', text: 'Athlet nicht gefunden — prüf die Athleten-ID in den Einstellungen.' };
    if (err && err.status) return { kind: 'http', text: 'Intervals.icu-Fehler ' + err.status + ' — zeige gespeicherte Daten.' };
    return { kind: 'offline', text: '' };
  }
  D.classifyIntervalsError = classifyError;

  var state = { error: null, loading: false, inflight: null, lastFetchStart: 0, trailingTimer: null, syncPending: false };
  function setLoading(on) { state.loading = on; $('bodyRefreshBtn').classList.toggle('is-spinning', on); }

  function fetchBody(opts) {
    opts = opts || {};
    if (D.DEMO) return Promise.resolve();
    var s = D.getSettings();
    if (!s.apiKey) { renderBody(); return Promise.resolve(); }
    if (state.inflight) return state.inflight;
    var wait = MIN_FETCH_GAP_MS - (Date.now() - state.lastFetchStart);
    if (wait > 0 && !opts.force) {
      if (!state.trailingTimer) state.trailingTimer = setTimeout(function () { state.trailingTimer = null; fetchBody(); }, wait + 50);
      return Promise.resolve();
    }
    if (state.trailingTimer) { clearTimeout(state.trailingTimer); state.trailingTimer = null; }
    state.lastFetchStart = Date.now();
    setLoading(true);
    var cache = loadCache();
    var full = !cache || cache.athlete !== s.athleteId || !cache.fullAt || Date.now() - cache.fullAt > 24 * 3600 * 1000;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = setTimeout(function () { if (ctrl) ctrl.abort(); }, FETCH_TIMEOUT_MS);
    var signal = ctrl ? ctrl.signal : undefined;
    var today = new Date();
    var newest = D.ymd(today);
    var base = athletePath(s.athleteId);
    state.inflight = Promise.all([
      request('GET', base + '/wellness?oldest=' + D.ymd(D.addDays(today, -(full ? FULL_DAYS : INCREMENTAL_DAYS))) + '&newest=' + newest, s.apiKey, signal),
      request('GET', base + '/activities?oldest=' + D.ymd(D.addDays(today, -ACTIVITY_DAYS)) + '&newest=' + newest, s.apiKey, signal)
    ]).then(function (res) {
      var w = full ? {} : Object.assign({}, cache.w);
      (Array.isArray(res[0]) ? res[0] : []).forEach(function (r) { if (r && typeof r.id === 'string') w[r.id.slice(0, 10)] = slim(r, KEEP); });
      var cutoff = D.ymd(D.addDays(today, -(FULL_DAYS + 20)));
      Object.keys(w).forEach(function (d) { if (d < cutoff) delete w[d]; });
      var a = (Array.isArray(res[1]) ? res[1] : []).filter(function (x) { return x && typeof x.start_date_local === 'string'; }).map(function (x) { return slim(x, KEEP_ACT); });
      var data = { w: w, a: a, fetchedAt: Date.now(), fullAt: full ? Date.now() : cache.fullAt, athlete: s.athleteId };
      if (!D.storeSet(CACHE_KEY, data)) D.storeSet(CACHE_KEY, { w: w, a: a.slice(0, 30), fetchedAt: data.fetchedAt, fullAt: data.fullAt, athlete: data.athlete });
      state.error = null;
      applyModel(data);
    }).catch(function (err) {
      state.error = classifyError(err);
      renderBody();
    }).then(function () {
      clearTimeout(timeout);
      state.inflight = null;
      setLoading(false);
    });
    return state.inflight;
  }
  D.fetchBody = fetchBody;

  D.testConnection = function (apiKey, athleteId) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = setTimeout(function () { if (ctrl) ctrl.abort(); }, FETCH_TIMEOUT_MS);
    var t = D.todayStr();
    return request('GET', athletePath(athleteId) + '/wellness?oldest=' + t + '&newest=' + t, apiKey, ctrl ? ctrl.signal : undefined)
      .then(function (r) { clearTimeout(timeout); return r; }, function (e) { clearTimeout(timeout); throw e; });
  };
  D.resetBodyCache = function () {
    D.storeDelete(CACHE_KEY);
    state.error = null;
    state.lastFetchStart = 0;
    applyModel(null);
  };
  D.putWellness = function (date, patch) {
    if (D.DEMO) {
      D.model.w[date] = Object.assign({}, D.model.w[date] || { id: date }, patch);
      D.bump();
      D.emit('data');
      return Promise.resolve(D.model.w[date]);
    }
    var s = D.getSettings();
    if (!s.apiKey) return Promise.reject(Object.assign(new Error('Kein API-Schlüssel'), { status: 401 }));
    var body = Object.assign({ id: date }, patch);
    return request('PUT', athletePath(s.athleteId) + '/wellness/' + date, s.apiKey, undefined, body).then(function (r) {
      var cache = loadCache() || { w: {}, a: [], fetchedAt: Date.now(), athlete: s.athleteId };
      var merged = Object.assign({}, cache.w[date] || {}, slim(r || body, KEEP));
      merged.id = date;
      cache.w[date] = merged;
      D.storeSet(CACHE_KEY, cache);
      applyModel(cache);
      return merged;
    });
  };

  /* ---------------- Demo data ---------------- */
  function makeDemo() {
    var today = new Date();
    var seed = 20240611;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    function gauss() { return (rnd() + rnd() + rnd() + rnd() - 2) / 0.8; }
    var w = {};
    var weight = 81.5;
    for (var i = FULL_DAYS; i >= 0; i--) {
      var date = D.ymd(D.addDays(today, -i));
      var t = (FULL_DAYS - i) / FULL_DAYS;
      var wd = D.parseYmd(date).getDay();
      var weekend = wd === 0 || wd === 6;
      var sleepH = 7.0 + 0.15 * t + (weekend ? 0.45 : 0) + gauss() * 0.55;
      if (i === 1) sleepH = 7.9;
      var hrv = 46 + 5 * t + gauss() * 6 + (sleepH - 7.2) * 2.2;
      var rhr = 57 - 1.5 * t + gauss() * 1.8 - (sleepH - 7.2) * 0.6;
      if (i === 1) { hrv = 58; rhr = 53; }
      weight += -0.01 + gauss() * 0.12;
      var rec = {
        id: date,
        sleepSecs: Math.round(Math.max(4.2, Math.min(9.8, sleepH)) * 3600),
        sleepScore: Math.round(Math.max(40, Math.min(98, 62 + (sleepH - 6.5) * 11 + gauss() * 5))),
        hrv: Math.round(Math.max(20, hrv)),
        restingHR: Math.round(Math.max(40, rhr)),
        steps: Math.round(Math.max(1200, 7000 + 1200 * t + (weekend ? 1500 : 0) + gauss() * 2300))
      };
      if (i % 3 === 0 || rnd() < 0.2) rec.weight = Math.round(weight * 10) / 10;
      if (i === 0) {
        delete rec.hrv; delete rec.restingHR; delete rec.sleepSecs; delete rec.sleepScore;
        var h = today.getHours() + today.getMinutes() / 60;
        rec.steps = Math.round(Math.max(0, (h - 7) / 15) * 9500);
      }
      w[date] = rec;
    }
    var a = [];
    var pool = [
      { type: 'WeightTraining', name: 'Krafttraining', min: [45, 75], hr: [105, 125] },
      { type: 'Run', name: 'Lauf am Morgen', min: [25, 50], hr: [140, 158] },
      { type: 'Walk', name: 'Spaziergang', min: [25, 45], hr: [88, 102] }
    ];
    for (var k = 0; k < 40; k++) {
      if (rnd() < 0.6) continue;
      var p = pool[Math.floor(rnd() * pool.length)];
      a.push({ name: p.name, type: p.type, start_date_local: D.ymd(D.addDays(today, -k)) + 'T' + D.pad2(7 + Math.floor(rnd() * 11)) + ':15:00',
        moving_time: Math.round((p.min[0] + rnd() * (p.min[1] - p.min[0])) * 60), average_heartrate: Math.round(p.hr[0] + rnd() * (p.hr[1] - p.hr[0])) });
    }
    return { w: w, a: a, fetchedAt: Date.now() };
  }

  /* ---------------- Tagesform card ---------------- */
  var FORM = {
    gut: { emoji: '💪', word: 'Gut erholt', text: 'Dein Körper ist heute fitter als sonst — guter Tag für ein hartes Training.' },
    normal: { emoji: '🙂', word: 'Normal', text: 'Alles im üblichen Bereich. Ganz normaler Tag — mach dein Programm.' },
    muede: { emoji: '😴', word: 'Eher müde', text: 'Mehrere Werte liegen unter deinem Normalwert. Heute lieber etwas lockerer machen und früh schlafen.' }
  };
  function compareText(p) {
    var m = D.M[p.key];
    if (p.normal == null) return { text: 'noch zu wenig Daten', cls: '' };
    var diff = p.value - p.normal;
    var amount = p.key === 'sleep' ? Math.abs(Math.round(diff * 60)) + ' Min' : D.fmtNum(Math.abs(diff), m.dec) + ' ' + m.unit;
    if (p.verdict === 'normal') return { text: 'wie sonst', cls: '' };
    var more = diff > 0;
    var word = p.key === 'sleep' ? (more ? 'länger' : 'kürzer') : (more ? 'höher' : 'niedriger');
    return { text: amount + ' ' + word + ' als sonst', cls: p.verdict === 'better' ? 'good' : 'attention' };
  }
  function renderForm() {
    var f = D.tagesform();
    var st = f.status ? FORM[f.status] : null;
    $('formEmoji').textContent = st ? st.emoji : '·';
    $('formWord').textContent = st ? st.word : (f.parts.length ? 'Noch unklar' : 'Keine Daten');
    $('formWord').className = 'form-word' + (f.status ? ' is-' + f.status : '');
    $('formText').textContent = st ? st.text : (f.parts.length
      ? 'Sobald es mindestens 7 Tage Werte gibt, vergleicht das Dashboard dich mit deinem eigenen Normalwert.'
      : 'Sobald deine Uhr Schlaf, HRV und Ruhepuls liefert, siehst du hier deine Tagesform.');
    var rows = $('formRows');
    rows.innerHTML = '';
    D.FORM_KEYS.forEach(function (k) {
      var p = f.parts.filter(function (x) { return x.key === k; })[0];
      var m = D.M[k];
      var b = el('button', 'metric-row');
      b.type = 'button';
      b.setAttribute('aria-label', m.label + ' — Verlauf öffnen');
      b.addEventListener('click', function () { D.go('verlauf', { metric: k }); });
      b.style.borderLeftColor = m.color;
      var left = el('div');
      var nm = el('div', 'mr-name');
      var dt = el('i');
      dt.style.background = m.color;
      nm.appendChild(dt);
      nm.appendChild(document.createTextNode(m.label));
      left.appendChild(nm);
      var val = el('div', 'mr-value');
      if (p) {
        if (k === 'sleep') val.textContent = D.fmtHM(p.value);
        else { val.textContent = D.fmtNum(p.value, 0); val.appendChild(el('small', null, m.unit)); }
      } else val.textContent = '—';
      left.appendChild(val);
      b.appendChild(left);
      var right = el('div', 'mr-compare');
      if (p) {
        var c = compareText(p);
        var arrow = c.cls ? (p.value > p.normal ? '↑ ' : '↓ ') : '';
        right.appendChild(el('span', 'badge ' + c.cls, arrow + c.text));
        right.appendChild(el('span', 'mr-tag', (p.normal != null ? 'normal: ' + D.fmtValue(k, p.normal) : '') + (p.fallback ? (p.normal != null ? ' · ' : '') + 'von ' + D.wdShort(p.date) : '')));
      } else {
        right.appendChild(el('span', 'mr-tag', 'kein Wert'));
      }
      b.appendChild(right);
      rows.appendChild(b);
    });
  }

  function renderSteps() {
    var s = D.getSettings();
    var st = D.latest('steps', 0);
    var v = st ? st.value : 0;
    $('stepsValue').textContent = st ? D.fmtNum(v, 0) : '—';
    var pct = Math.round(v / s.stepGoal * 100);
    var sub = st ? (pct >= 100 ? 'Ziel geschafft 🎉' : pct + ' % von ' + D.fmtNum(s.stepGoal, 0)) : 'heute noch keine';
    var rec = D.model && D.model.w && D.model.w[D.todayStr()];
    var up = rec && rec.updated ? new Date(rec.updated) : null;
    if (st && up && !isNaN(up)) sub += ' · Stand ' + String(up.getHours()).padStart(2, '0') + ':' + String(up.getMinutes()).padStart(2, '0');
    $('stepsSub').textContent = sub;
    $('stepsFill').style.width = Math.min(100, pct) + '%';
    $('stepsFill').classList.toggle('is-full', pct >= 100);
  }
  function renderWeight() {
    var s = D.getSettings();
    var latest = D.latest('weight', 60);
    if (!latest) {
      $('weightValue').innerHTML = '—';
      $('weightSub').textContent = 'noch nichts eingetragen';
      return;
    }
    $('weightValue').innerHTML = D.esc(D.fmtNum(latest.value, 1)) + '<small>kg</small>';
    var prev = null;
    for (var j = 7; j < 45; j++) { var pv = D.valueOn('weight', D.shift(latest.date, -j)); if (D.isNum(pv)) { prev = pv; break; } }
    var parts = [latest.date === D.todayStr() ? 'heute' : D.relDays(latest.date)];
    if (prev != null) parts.push(D.signed(latest.value - prev, 1) + ' kg ggü. Vorwoche');
    else if (s.weightGoal) parts.push('Ziel ' + D.fmtNum(s.weightGoal, 1) + ' kg');
    $('weightSub').textContent = parts.join(' · ');
  }

  function renderStatus() {
    var line = $('bodyStatus'), errEl = $('bodyError');
    line.classList.remove('is-warning');
    errEl.hidden = true;
    if (D.DEMO) { line.textContent = 'Demo-Daten'; return; }
    var e = state.error;
    var at = D.model.fetchedAt ? D.fmtClock(new Date(D.model.fetchedAt)) : null;
    if (e && e.kind === 'offline') { line.textContent = at ? 'Offline — Stand ' + at : 'Offline'; line.classList.add('is-warning'); return; }
    if (e) { line.textContent = at ? 'Stand ' + at : ''; errEl.textContent = e.text; errEl.hidden = false; return; }
    line.textContent = at ? 'Aktualisiert ' + at : (state.loading ? 'Lädt…' : '');
  }

  function renderBody() {
    var hasKey = D.DEMO || !!D.getSettings().apiKey;
    $('bodyOnboard').hidden = hasKey;
    $('formContent').hidden = !hasKey;
    $('bodyRefreshBtn').hidden = !hasKey;
    $('bodySyncBtn').hidden = !hasKey;
    $('bodyTiles').hidden = !hasKey;
    if (!hasKey) { $('bodyError').hidden = true; $('bodyStatus').textContent = ''; return; }
    renderStatus();
    renderForm();
    renderSteps();
    renderWeight();
  }
  D.renderBody = renderBody;

  /* ---------------- Measurement sheet ---------------- */
  function openMeasure() {
    var today = D.todayStr();
    $('measureDate').value = today;
    $('measureDate').max = today;
    var lw = D.series('weight').slice(-1)[0];
    $('measureWeight').value = '';
    $('measureWeight').placeholder = lw ? D.fmtNum(lw.v, 1) : 'z. B. 78,4';
    $('measureFat').value = '';
    $('measureResult').textContent = '';
    $('measureResult').className = 'sheet-result';
    $('measureNote').textContent = D.DEMO
      ? 'Demo-Modus: Der Wert wird nur hier angezeigt und nirgends gespeichert.'
      : 'Wird in deinem Intervals.icu-Konto gespeichert und erscheint hier im Verlauf.';
    D.openSheet('measureSheet');
    setTimeout(function () { $('measureWeight').focus({ preventScroll: true }); }, 320);
  }
  D.openMeasure = openMeasure;
  function saveMeasure() {
    var res = $('measureResult');
    var date = $('measureDate').value;
    var w = D.parseNum($('measureWeight').value);
    var f = D.parseNum($('measureFat').value);
    res.className = 'sheet-result is-error';
    if (!D.isValidYmd(date) || date > D.todayStr()) { res.textContent = 'Bitte ein gültiges Datum (nicht in der Zukunft) wählen.'; return; }
    var patch = {};
    if (D.isNum(w)) {
      if (w < 25 || w > 350) { res.textContent = 'Das Gewicht sieht nicht plausibel aus (25–350 kg).'; return; }
      patch.weight = Math.round(w * 10) / 10;
    }
    if (D.isNum(f)) {
      if (f < 2 || f > 70) { res.textContent = 'Körperfett muss zwischen 2 und 70 % liegen.'; return; }
      patch.bodyFat = Math.round(f * 10) / 10;
    }
    if (!Object.keys(patch).length) { res.textContent = 'Trag mindestens einen Wert ein.'; return; }
    if (!D.DEMO && !D.getSettings().apiKey) { res.textContent = 'Zum Speichern brauchst du zuerst den Intervals.icu-Schlüssel (⚙).'; return; }
    var btn = $('measureSave');
    btn.disabled = true;
    res.className = 'sheet-result is-muted';
    res.textContent = 'Speichere…';
    D.putWellness(date, patch).then(function () {
      D.closeSheet('measureSheet');
      D.toast((patch.weight ? D.fmtNum(patch.weight, 1) + ' kg' : D.fmtNum(patch.bodyFat, 1) + ' % Körperfett') + ' gespeichert ✓');
    }).catch(function (err) {
      var c = classifyError(err);
      res.className = 'sheet-result is-error';
      res.textContent = c.kind === 'offline' ? 'Keine Verbindung zu Intervals.icu — bitte später nochmal.' : c.text.replace(' — zeige gespeicherte Daten.', '.');
    }).then(function () { btn.disabled = false; });
  }

  /* ---------------- Boot ---------------- */
  D.Body = {
    boot: function () {
      try { localStorage.removeItem('body_cache_v1'); } catch (e) {}
      D.on('data', renderBody);
      D.on('settings', renderBody);
      if (D.DEMO) applyModel(makeDemo());
      else { var c = loadCache(); if (c) applyModel(c); }
      renderBody();
      $('bodyRefreshBtn').addEventListener('click', function () {
        if (D.DEMO) { D.toast('Demo-Daten — nichts zu aktualisieren'); return; }
        $('bodyRefreshBtn').classList.add('is-spinning');
        fetchBody({ force: true });
        setTimeout(function () { if (!state.loading) $('bodyRefreshBtn').classList.remove('is-spinning'); }, 800);
      });
      $('bodySyncBtn').addEventListener('click', function () {
        state.syncPending = true;
        window.open('https://intervals.icu/calendar', '_blank', 'noopener');
      });
      $('measureOpenBtn').addEventListener('click', openMeasure);
      $('measureSave').addEventListener('click', saveMeasure);
      $('measureCancel').addEventListener('click', function () { D.closeSheet('measureSheet'); });
      ['measureWeight', 'measureFat'].forEach(function (id) {
        $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveMeasure(); } });
      });
      $('stepsTile').addEventListener('click', function () { D.go('verlauf', { metric: 'steps' }); });
      fetchBody();
      setInterval(fetchBody, AUTO_REFRESH_MS);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible' || D.DEMO) return;
        if (state.syncPending) { state.syncPending = false; fetchBody(); setTimeout(fetchBody, MIN_FETCH_GAP_MS + 1000); return; }
        if (Date.now() - state.lastFetchStart > STALE_ON_VISIBLE_MS) fetchBody();
      });
    },
    afterSettingsSaved: function () { state.lastFetchStart = 0; state.error = null; fetchBody({ force: true }); }
  };
})();
