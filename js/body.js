/* =====================================================================
   body.js — Amazfit (Zepp) via Intervals.icu: laden, cachen, schreiben,
   Demo-Daten, Kacheln, Index-Karte, Training, Check-in, Messung
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
  var ACTIVITY_DAYS = 60;
  var KEEP = ['id', 'sleepSecs', 'sleepScore', 'sleepQuality', 'avgSleepingHR', 'hrv', 'restingHR', 'steps',
    'weight', 'bodyFat', 'readiness', 'spO2', 'respiration', 'ctl', 'atl'];
  var KEEP_ACT = ['name', 'type', 'start_date_local', 'moving_time', 'average_heartrate', 'icu_training_load'];

  function slim(r, keys) {
    var o = {};
    keys.forEach(function (k) { if (r[k] != null) o[k] = r[k]; });
    return o;
  }

  /* ---------------- Cache ---------------- */
  function loadCache() {
    var c = D.storeGet(CACHE_KEY);
    if (!c || typeof c !== 'object' || !c.w) return null;
    return c;
  }
  function applyModel(c) {
    D.model = { w: (c && c.w) || {}, a: (c && c.a) || [], fetchedAt: c ? c.fetchedAt : null };
    D.bump();
    D.emit('data');
  }

  /* ---------------- API ---------------- */
  function authHeader(apiKey) { return 'Basic ' + btoa('API_KEY:' + apiKey); }
  function request(method, url, apiKey, signal, body) {
    var headers;
    try {
      headers = { 'Authorization': authHeader(apiKey), 'Accept': 'application/json' };
    } catch (e) {
      var bad = new Error('Ungültiger Schlüssel'); bad.status = 401;
      return Promise.reject(bad);
    }
    var init = { method: method, headers: headers, signal: signal, cache: 'no-store' };
    if (body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(url, init).then(function (res) {
      if (!res.ok) { var err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
      return res.status === 204 ? null : res.json();
    });
  }
  function athletePath(id) { return API_BASE + '/athlete/' + encodeURIComponent(id); }
  D.intervalsGet = function (path, apiKey, athleteId, signal) {
    return request('GET', athletePath(athleteId) + path, apiKey, signal);
  };

  function classifyError(err) {
    if (err && (err.status === 401 || err.status === 403)) return { kind: 'auth', text: 'Intervals.icu hat den API-Schlüssel abgelehnt — prüf die ⚙ Einstellungen.' };
    if (err && err.status === 404) return { kind: 'http', text: 'Athlet nicht gefunden — prüf die Athleten-ID in den ⚙ Einstellungen.' };
    if (err && err.status) return { kind: 'http', text: 'Intervals.icu-Fehler ' + err.status + ' — zeige gespeicherte Daten.' };
    return { kind: 'offline', text: '' };
  }
  D.classifyIntervalsError = classifyError;

  var state = { error: null, loading: false, inflight: null, lastFetchStart: 0, trailingTimer: null, syncPending: false };

  function setLoading(on) {
    state.loading = on;
    $('bodyRefreshBtn').classList.toggle('is-spinning', on);
  }

  function fetchBody(opts) {
    opts = opts || {};
    if (D.DEMO) { return Promise.resolve(); }
    var s = D.getSettings();
    if (!s.apiKey) { renderBody(); return Promise.resolve(); }
    if (state.inflight) return state.inflight;
    var wait = MIN_FETCH_GAP_MS - (Date.now() - state.lastFetchStart);
    if (wait > 0 && !opts.force) {
      if (!state.trailingTimer) {
        state.trailingTimer = setTimeout(function () { state.trailingTimer = null; fetchBody(); }, wait + 50);
      }
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
    var oldestW = D.ymd(D.addDays(today, -(full ? FULL_DAYS : INCREMENTAL_DAYS)));
    var oldestA = D.ymd(D.addDays(today, -ACTIVITY_DAYS));
    var base = athletePath(s.athleteId);

    state.inflight = Promise.all([
      request('GET', base + '/wellness?oldest=' + oldestW + '&newest=' + newest, s.apiKey, signal),
      request('GET', base + '/activities?oldest=' + oldestA + '&newest=' + newest, s.apiKey, signal)
    ]).then(function (res) {
      var w = full ? {} : Object.assign({}, cache.w);
      (Array.isArray(res[0]) ? res[0] : []).forEach(function (r) {
        if (r && typeof r.id === 'string') w[r.id.slice(0, 10)] = slim(r, KEEP);
      });
      var cutoff = D.ymd(D.addDays(today, -(FULL_DAYS + 20)));
      Object.keys(w).forEach(function (d) { if (d < cutoff) delete w[d]; });
      var a = (Array.isArray(res[1]) ? res[1] : []).filter(function (x) { return x && typeof x.start_date_local === 'string'; }).map(function (x) { return slim(x, KEEP_ACT); });
      var data = { w: w, a: a, fetchedAt: Date.now(), fullAt: full ? Date.now() : cache.fullAt, athlete: s.athleteId };
      if (!D.storeSet(CACHE_KEY, data)) {
        D.storeSet(CACHE_KEY, { w: w, a: a.slice(0, 20), fetchedAt: data.fetchedAt, fullAt: data.fullAt, athlete: data.athlete });
      }
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

  /* Write a partial wellness record (e.g. weight) back to Intervals.icu. */
  D.putWellness = function (date, patch) {
    if (D.DEMO) {
      var rec = Object.assign({}, D.model.w[date] || { id: date }, patch);
      D.model.w[date] = rec;
      D.bump();
      D.emit('data');
      return Promise.resolve(rec);
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

  /* ---------------- Demo data (never written to the real cache) ---------------- */
  function makeDemo() {
    var today = new Date();
    var seed = 20240611;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    function gauss() { return (rnd() + rnd() + rnd() + rnd() - 2) / 0.8; }
    var w = {};
    var ctl = 30, atl = 32, weight = 82.4;
    var expStart = 30;
    for (var i = FULL_DAYS; i >= 0; i--) {
      var date = D.ymd(D.addDays(today, -i));
      var t = (FULL_DAYS - i) / FULL_DAYS;
      var wd = D.parseYmd(date).getDay();
      var weekend = wd === 0 || wd === 6;
      var caffeineEffect = i < expStart ? 0.35 : 0;
      var sleepH = 7.0 + 0.1 * t + (weekend ? 0.45 : 0) + caffeineEffect + gauss() * 0.55;
      var hrv = 46 + 5 * t + gauss() * 6 + (sleepH - 7.2) * 2.2;
      var rhr = 57 - 1.5 * t + gauss() * 1.8 - (sleepH - 7.2) * 0.6;
      var steps = 7000 + 1200 * t + (weekend ? 1500 : 0) + gauss() * 2300;
      var load = rnd() < 0.45 ? 30 + rnd() * 60 : 0;
      ctl = ctl + (load - ctl) / 42;
      atl = atl + (load - atl) / 7;
      weight += -0.012 + gauss() * 0.12;
      var rec = {
        id: date,
        sleepSecs: Math.round(Math.max(4.2, Math.min(9.8, sleepH)) * 3600),
        sleepScore: Math.round(Math.max(40, Math.min(98, 62 + (sleepH - 6.5) * 11 + gauss() * 5))),
        avgSleepingHR: Math.round(rhr - 4 + gauss()),
        hrv: Math.round(Math.max(20, hrv)),
        restingHR: Math.round(Math.max(40, rhr)),
        steps: Math.round(Math.max(1200, steps)),
        ctl: Math.round(ctl * 10) / 10,
        atl: Math.round(atl * 10) / 10
      };
      if (rnd() < 0.08) delete rec.hrv;
      if (i % 3 === 0 || rnd() < 0.2) rec.weight = Math.round(weight * 10) / 10;
      if (i === 0) {
        delete rec.hrv;
        delete rec.restingHR;
        delete rec.sleepSecs;
        delete rec.sleepScore;
        delete rec.avgSleepingHR;
        var h = today.getHours() + today.getMinutes() / 60;
        rec.steps = Math.round(Math.max(0, (h - 7) / 15) * 9500);
      }
      w[date] = rec;
    }
    var pool = [
      { type: 'Run', name: 'Lauf am Morgen', hr: [138, 156], min: [28, 55], load: [35, 70] },
      { type: 'WeightTraining', name: 'Krafttraining Oberkörper', hr: [102, 122], min: [40, 65], load: [20, 40] },
      { type: 'Ride', name: 'Radfahren', hr: [125, 145], min: [50, 95], load: [45, 90] },
      { type: 'Walk', name: 'Spaziergang', hr: [88, 102], min: [25, 45], load: [6, 14] }
    ];
    var a = [];
    for (var k = 0; k < 14; k++) {
      if (rnd() < 0.45) continue;
      var p = pool[Math.floor(rnd() * pool.length)];
      var hh = 6 + Math.floor(rnd() * 12);
      a.push({
        name: p.name,
        type: p.type,
        start_date_local: D.ymd(D.addDays(today, -k)) + 'T' + D.pad2(hh) + ':' + D.pad2(Math.floor(rnd() * 59)) + ':00',
        moving_time: Math.round((p.min[0] + rnd() * (p.min[1] - p.min[0])) * 60),
        average_heartrate: Math.round(p.hr[0] + rnd() * (p.hr[1] - p.hr[0])),
        icu_training_load: Math.round(p.load[0] + rnd() * (p.load[1] - p.load[0]))
      });
    }
    return { w: w, a: a, fetchedAt: Date.now() };
  }
  function seedDemoCheckins() {
    if (D.storeGet('demo_seeded_checkins')) return;
    var all = {};
    var seed = 99;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var notes = ['Gut geschlafen, viel geschafft.', 'Stressiger Tag an der Uni.', 'Training war hart, aber gut.', 'Etwas müde nach dem Abend.', ''];
    for (var i = 60; i >= 1; i--) {
      if (rnd() < 0.25) continue;
      var date = D.shift(D.todayStr(), -i);
      var sleep = D.valueOn('sleep', date) || 7;
      var mood = Math.max(1, Math.min(5, Math.round(2.6 + (sleep - 7) * 0.8 + (rnd() - 0.5) * 2)));
      all[date] = {
        mood: mood,
        energy: Math.max(1, Math.min(5, Math.round(mood + (rnd() - 0.5) * 1.6))),
        stress: Math.max(1, Math.min(5, Math.round(3.2 - (mood - 3) * 0.6 + (rnd() - 0.5) * 2))),
        at: Date.now()
      };
      var note = notes[Math.floor(rnd() * notes.length)];
      if (note && rnd() < 0.4) all[date].note = note;
    }
    D.storeSet('checkins_v1', all);
    D.storeSet('demo_seeded_checkins', true);
    D.bump();
  }

  /* ---------------- Rendering: body tiles ---------------- */
  function pickMetric(key, todayStr) {
    var v = D.valueOn(key, todayStr);
    if (D.isNum(v)) return { value: v, date: todayStr, fallback: false };
    for (var i = 1; i <= 2; i++) {
      var d = D.shift(todayStr, -i);
      var v2 = D.valueOn(key, d);
      if (D.isNum(v2)) return { value: v2, date: d, fallback: true };
    }
    return null;
  }
  function baseline7(key, date) {
    var xs = [];
    for (var i = 1; i <= 21 && xs.length < 7; i++) {
      var v = D.valueOn(key, D.shift(date, -i));
      if (D.isNum(v)) xs.push(v);
    }
    return xs.length >= 3 ? D.mean(xs) : null;
  }
  function sparkValues(key, endDate, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(D.valueOn(key, D.shift(endDate, -i)));
    return out;
  }

  function tile(key, o) {
    var m = D.M[key];
    var b = el('button', 'card body-tile');
    b.type = 'button';
    b.setAttribute('aria-label', m.label + ' — Verlauf öffnen');
    b.addEventListener('click', function () { D.go('verlauf', { metric: key }); });
    var label = el('div', 'tile-label');
    var dot = el('span', 'tile-dot');
    if (o.dot) dot.setAttribute('data-tone', o.dot);
    label.appendChild(dot);
    label.appendChild(el('span', null, m.label));
    b.appendChild(label);
    var val = el('div', 'tile-value');
    val.appendChild(el('span', null, o.num != null ? o.num : '—'));
    if (o.num != null && o.unit) val.appendChild(el('span', 'tile-unit', o.unit));
    b.appendChild(val);
    var sub = el('div', 'tile-sub');
    var parts = (o.sub || []).filter(Boolean);
    if (parts.length) sub.appendChild(document.createTextNode(parts.join(' · ')));
    if (o.tag) sub.appendChild(el('span', 'tag', (parts.length ? ' · ' : '') + o.tag));
    if (!parts.length && !o.tag) sub.textContent = ' ';
    b.appendChild(sub);
    var foot = el('div', 'tile-foot');
    if (o.bar) {
      var bw = el('div', 'tile-bar-wrap');
      var bar = el('div', 'step-bar');
      var fill = el('div', 'step-bar-fill' + (o.bar.pct >= 100 ? ' is-full' : ''));
      fill.style.width = Math.max(0, Math.min(100, o.bar.pct)) + '%';
      bar.appendChild(fill);
      bw.appendChild(bar);
      foot.appendChild(bw);
    } else if (o.chip) {
      var chip = el('span', 'chip', o.chip.text);
      chip.setAttribute('data-tone', o.chip.tone);
      foot.appendChild(chip);
    } else {
      foot.appendChild(el('span'));
    }
    var sp = el('div', 'tile-spark');
    sp.innerHTML = D.sparkSVG(sparkValues(key, D.todayStr(), 14), m.color, { w: 64, h: 22 });
    foot.appendChild(sp);
    b.appendChild(foot);
    return b;
  }

  function fromTag(p) { return p && p.fallback ? 'von ' + D.wdShort(p.date) : null; }

  function renderTiles() {
    var grid = $('bodyGrid');
    grid.innerHTML = '';
    var today = D.todayStr();
    var s = D.getSettings();

    var sl = pickMetric('sleep', today);
    if (sl) {
      var rec = D.model.w[sl.date] || {};
      grid.appendChild(tile('sleep', {
        dot: sl.value >= 7 ? 'success' : (sl.value >= 6 ? 'warning' : 'danger'),
        num: D.fmtHM(sl.value),
        sub: [D.positive(rec.sleepScore) ? 'Score ' + Math.round(rec.sleepScore) : null, D.positive(rec.avgSleepingHR) && !sl.fallback ? 'Ø HF ' + Math.round(rec.avgSleepingHR) : null],
        tag: fromTag(sl)
      }));
    } else grid.appendChild(tile('sleep', { num: null }));

    var hv = pickMetric('hrv', today);
    if (hv) {
      var hb = baseline7('hrv', hv.date), chip = null, tone = null;
      if (hb) {
        var pct = Math.round((hv.value - hb) / hb * 100);
        tone = pct >= -5 ? 'success' : (pct >= -15 ? 'warning' : 'danger');
        chip = { text: D.signed(pct) + '% ggü. 7T', tone: tone };
      }
      grid.appendChild(tile('hrv', { dot: tone, num: D.fmtNum(hv.value, 0), unit: 'ms', sub: [hb && !hv.fallback ? 'Ø 7T ' + Math.round(hb) + ' ms' : null], tag: fromTag(hv), chip: chip }));
    } else grid.appendChild(tile('hrv', { num: null }));

    var rh = pickMetric('rhr', today);
    if (rh) {
      var rb = baseline7('rhr', rh.date), rchip = null, rtone = null;
      if (rb) {
        var d = Math.round(rh.value - rb);
        rtone = d <= 2 ? 'success' : (d <= 5 ? 'warning' : 'danger');
        rchip = { text: D.signed(d) + ' ggü. 7T', tone: rtone };
      }
      grid.appendChild(tile('rhr', { dot: rtone, num: D.fmtNum(rh.value, 0), unit: 'bpm', sub: [rb && !rh.fallback ? 'Ø 7T ' + Math.round(rb) + ' bpm' : null], tag: fromTag(rh), chip: rchip }));
    } else grid.appendChild(tile('rhr', { num: null }));

    var st = pickMetric('steps', today);
    if (st) {
      var sp = st.value / s.stepGoal * 100;
      grid.appendChild(tile('steps', { dot: sp >= 100 ? 'success' : null, num: D.fmtNum(st.value, 0), sub: ['von ' + D.fmtNum(s.stepGoal, 0)], tag: fromTag(st), bar: { pct: sp } }));
    } else grid.appendChild(tile('steps', { num: null, sub: ['von ' + D.fmtNum(s.stepGoal, 0)], bar: { pct: 0 } }));

    // Weight: always offered (you can log it), latest value within 60 days.
    var wLatest = null;
    for (var i = 0; i < 60; i++) {
      var dd = D.shift(today, -i);
      var wv = D.valueOn('weight', dd);
      if (D.isNum(wv)) { wLatest = { value: wv, date: dd }; break; }
    }
    if (wLatest) {
      var prev = null;
      for (var j = 7; j < 60; j++) { var pv = D.valueOn('weight', D.shift(wLatest.date, -j)); if (D.isNum(pv)) { prev = pv; break; } }
      var wChip = prev != null ? { text: D.signed(wLatest.value - prev, 1) + ' kg', tone: 'neutral' } : null;
      grid.appendChild(tile('weight', {
        num: D.fmtNum(wLatest.value, 1), unit: 'kg',
        sub: [wLatest.date === today ? 'heute' : D.fmtDay(wLatest.date), s.weightGoal ? 'Ziel ' + D.fmtNum(s.weightGoal, 1) : null],
        chip: wChip
      }));
    } else {
      grid.appendChild(tile('weight', { num: null, sub: ['Tippe auf ⊕ Messung'] }));
    }

    // Optional extras if Zepp delivers them.
    ['readiness', 'sleepScore', 'spO2'].some(function (k) {
      var p = pickMetric(k, today);
      if (!p) return false;
      grid.appendChild(tile(k, { num: D.fmtNum(p.value, D.M[k].dec), unit: D.M[k].unit === '%' ? '%' : '', tag: fromTag(p) }));
      return true;
    });
  }

  /* ---------------- Index card ---------------- */
  function renderIndexCard() {
    var lc = D.latestComposite();
    var num = $('indexNum'), delta = $('indexDelta'), sub = $('indexSub'), partsEl = $('indexParts'), badge = $('indexBadge');
    partsEl.innerHTML = '';
    var spark = $('indexSpark');
    var members = D.indexMembers();
    if (!lc) {
      num.textContent = '—';
      num.classList.add('is-empty');
      delta.textContent = '';
      badge.hidden = true;
      spark.innerHTML = '';
      var forming = members.map(function (k) {
        var b = D.baseline(k);
        return D.M[k].label + ' ' + Math.min(b ? b.n : 0, D.BASE_MIN) + '/' + D.BASE_MIN;
      });
      sub.textContent = !D.DEMO && !D.getSettings().apiKey
        ? 'Sobald deine Amazfit verbunden ist, entsteht hier dein persönlicher Index — 100 ist dann dein eigener Normalzustand.'
        : members.length
        ? 'Deine Basis bildet sich noch (Tage mit Daten): ' + forming.join(' · ') + '. Ab 14 Tagen erscheint dein Index.'
        : 'Kein Wert zählt gerade zum Index — wähle in ⚙ Einstellungen, was für dich „besser“ heißt.';
      setSide(null);
      return;
    }
    num.classList.remove('is-empty');
    num.textContent = Math.round(lc.score);
    var prev = [];
    for (var i = 1; i <= 7; i++) { var v = D.indexValueOn(D.shift(lc.date, -i)); if (v != null) prev.push(v); }
    if (prev.length >= 3) {
      var dlt = lc.score - D.mean(prev);
      delta.textContent = D.signed(dlt) + ' ggü. letzter Woche';
      delta.className = 'index-delta ' + (dlt >= 2 ? 'num-success' : (dlt <= -2 ? 'num-warning' : 'muted'));
    } else { delta.textContent = ''; }
    var anyProvisional = lc.members.some(function (k) { var b = D.baseline(k); return b && !b.frozen; });
    badge.hidden = !anyProvisional;
    var vals = [];
    for (var j = 29; j >= 0; j--) vals.push(D.indexValueOn(D.shift(D.todayStr(), -j)));
    spark.innerHTML = D.sparkSVG(vals, '#FF9559', { w: 170, h: 54, ref: 100 });
    sub.textContent = (lc.date === D.todayStr() ? 'Heute' : 'Stand ' + D.fmtDay(lc.date)) +
      ' · 100 = deine Basis · 10 Punkte = eine normale Schwankung bei dir';
    lc.members.forEach(function (k) {
      var p = lc.parts.filter(function (x) { return x.key === k; })[0];
      var chip = el('span', 'index-part' + (p ? '' : ' is-missing'));
      chip.appendChild(document.createTextNode(D.M[k].label + ' '));
      chip.appendChild(el('b', null, p ? Math.round(p.idx) : '–'));
      chip.title = p ? D.M[k].label + ': ' + D.fmtValue(k, p.v) : D.M[k].label + ': kein Wert an diesem Tag';
      partsEl.appendChild(chip);
    });
    setSide(lc);
  }
  function setSide(lc) {
    var n = $('sideIndexNum'), s = $('sideIndexSub');
    if (!n) return;
    n.textContent = lc ? Math.round(lc.score) : '—';
    s.textContent = lc ? (lc.date === D.todayStr() ? 'heute' : D.fmtDay(lc.date)) + ' · 100 = Basis' : 'Basis bildet sich';
  }

  /* ---------------- Training ---------------- */
  function workoutEmoji(type) {
    switch (type) {
      case 'Run': case 'VirtualRun': case 'TrailRun': return '🏃';
      case 'Ride': case 'VirtualRide': case 'GravelRide': case 'MountainBikeRide': case 'EBikeRide': return '🚴';
      case 'Walk': case 'Hike': return '🚶';
      case 'WeightTraining': return '🏋️';
      case 'Swim': case 'OpenWaterSwim': return '🏊';
      default: return '⚡';
    }
  }
  function fmtDuration(secs) {
    var mins = Math.round(secs / 60);
    if (mins < 60) return mins + ' Min';
    return Math.floor(mins / 60) + 'h ' + D.pad2(mins % 60) + 'm';
  }
  function renderTraining() {
    var W = D.model.w, today = D.todayStr();
    var load = null;
    if (W[today] && D.isNum(W[today].ctl) && D.isNum(W[today].atl)) load = W[today];
    else {
      var ds = Object.keys(W).filter(function (d) { return D.isNum(W[d].ctl) && D.isNum(W[d].atl); }).sort();
      if (ds.length) load = W[ds[ds.length - 1]];
    }
    var fit = $('trFitness'), fat = $('trFatigue'), form = $('trForm');
    if (load) {
      fit.textContent = Math.round(load.ctl);
      fat.textContent = Math.round(load.atl);
      var f = Math.round(load.ctl - load.atl);
      form.textContent = D.signed(f);
      form.setAttribute('data-tone', f > 5 ? 'success' : (f >= -10 ? 'secondary' : (f >= -30 ? 'warning' : 'danger')));
    } else {
      fit.textContent = '—'; fat.textContent = '—'; form.textContent = '—';
      form.removeAttribute('data-tone');
    }
    var todayLoad = 0;
    D.model.a.forEach(function (a) {
      if (a.start_date_local.slice(0, 10) === today && D.isNum(a.icu_training_load)) todayLoad += a.icu_training_load;
    });
    $('trLoad').textContent = Math.round(todayLoad);
    renderSleepStrip(today);
    renderWorkouts();
  }
  function renderSleepStrip(today) {
    var VB_W = 280, BAR_TOP = 4, BAR_MAX = 70, BAR_BOTTOM = BAR_TOP + BAR_MAX, SLOT = VB_W / 7, BAR_W = 22;
    var parts = [], total = 0, count = 0;
    for (var i = 6; i >= 0; i--) {
      var date = D.shift(today, -i);
      var h = D.valueOn('sleep', date);
      var slot = 6 - i, cx = slot * SLOT + SLOT / 2, x = cx - BAR_W / 2;
      var label = D.wdShort(date) + ' · ' + (h ? D.fmtHM(h) : 'keine Daten');
      var shape;
      if (h) {
        total += h; count++;
        var bh = Math.max(4, Math.min(h, 10) / 10 * BAR_MAX), y = BAR_BOTTOM - bh, r = Math.min(6, bh, BAR_W / 2);
        var d = 'M' + x + ',' + BAR_BOTTOM + ' V' + (y + r) + ' A' + r + ',' + r + ' 0 0 1 ' + (x + r) + ',' + y +
          ' H' + (x + BAR_W - r) + ' A' + r + ',' + r + ' 0 0 1 ' + (x + BAR_W) + ',' + (y + r) + ' V' + BAR_BOTTOM + ' Z';
        shape = '<path d="' + d + '" fill="#9DB1FF" fill-opacity="' + (i === 0 ? '1' : '0.35') + '"/>';
      } else {
        shape = '<rect x="' + x + '" y="' + (BAR_BOTTOM - 2) + '" width="' + BAR_W + '" height="2" rx="1" fill="#76746E"/>';
      }
      parts.push('<g data-cap="' + D.esc(label) + '"><title>' + D.esc(label) + '</title>' + shape +
        '<rect class="hit" x="' + (slot * SLOT) + '" y="0" width="' + SLOT + '" height="96"/>' +
        '<text x="' + cx + '" y="90" text-anchor="middle"' + (i === 0 ? ' style="fill:#B8B6B0"' : '') + '>' + D.wdInitial(date) + '</text></g>');
    }
    var y8 = BAR_BOTTOM - 8 / 10 * BAR_MAX;
    var avg = count ? 'Ø ' + D.fmtHM(total / count) : '';
    $('sleepStrip').innerHTML = '<svg viewBox="0 0 280 96" role="img" aria-label="Schlaf der letzten 7 Tage">' +
      '<line x1="0" y1="' + (BAR_BOTTOM + 0.5) + '" x2="280" y2="' + (BAR_BOTTOM + 0.5) + '" stroke="rgba(255,255,255,0.06)"/>' +
      '<line x1="0" y1="' + y8 + '" x2="280" y2="' + y8 + '" stroke="rgba(255,255,255,0.12)" stroke-dasharray="2 4"/>' +
      parts.join('') + '</svg>';
    var cap = $('sleepCaption');
    cap.textContent = avg;
    cap.dataset.avg = avg;
  }
  function renderWorkouts() {
    var list = $('workoutList');
    list.innerHTML = '';
    var since = D.shift(D.todayStr(), -6);
    var sorted = D.model.a
      .filter(function (a) { return a.start_date_local.slice(0, 10) >= since; })
      .sort(function (a, b) { return a.start_date_local < b.start_date_local ? 1 : (a.start_date_local > b.start_date_local ? -1 : 0); })
      .slice(0, 3);
    if (!sorted.length) { list.appendChild(el('li', 'wo-empty', 'Keine Workouts in den letzten 7 Tagen.')); return; }
    sorted.forEach(function (a) {
      var li = el('li', 'workout');
      li.appendChild(el('span', 'wo-emoji', workoutEmoji(a.type)));
      var name = (typeof a.name === 'string' && a.name.trim()) ? a.name.trim() : (a.type || 'Workout');
      var nm = el('span', 'wo-name', name);
      nm.title = name + ' · ' + D.fmtDay(a.start_date_local.slice(0, 10));
      li.appendChild(nm);
      var meta = [];
      if (D.positive(a.moving_time)) meta.push(fmtDuration(a.moving_time));
      if (D.positive(a.average_heartrate)) meta.push(Math.round(a.average_heartrate) + ' bpm');
      if (D.isNum(a.icu_training_load)) meta.push(Math.round(a.icu_training_load) + ' Last');
      li.appendChild(el('span', 'wo-meta', meta.join(' · ')));
      list.appendChild(li);
    });
  }

  /* ---------------- Status / whole body render ---------------- */
  function renderStatus() {
    var upd = $('bodyUpdated'), errEl = $('bodyError');
    upd.classList.remove('is-warning');
    errEl.hidden = true;
    if (D.DEMO) { upd.textContent = 'Demo-Daten'; return; }
    var e = state.error;
    var at = D.model.fetchedAt ? D.fmtClock(new Date(D.model.fetchedAt)) : null;
    if (e && e.kind === 'offline') {
      upd.textContent = at ? 'Offline — Stand ' + at : 'Offline — keine Daten gespeichert';
      upd.classList.add('is-warning');
      return;
    }
    if (e) {
      upd.textContent = at ? 'Stand ' + at : '';
      errEl.textContent = e.text;
      errEl.hidden = false;
      return;
    }
    upd.textContent = at ? 'Aktualisiert ' + at : (state.loading ? 'Lädt…' : '');
  }

  function renderBody() {
    var s = D.getSettings();
    var hasKey = D.DEMO || !!s.apiKey;
    $('bodyOnboard').hidden = hasKey;
    $('bodyContent').hidden = !hasKey;
    $('bodyRefreshBtn').hidden = !hasKey;
    $('bodySyncBtn').hidden = !hasKey;
    renderIndexCard();
    if (!hasKey) {
      $('bodyHint').hidden = true;
      $('bodyError').hidden = true;
      $('bodyUpdated').textContent = '';
      return;
    }
    renderStatus();
    var dates = Object.keys(D.model.w);
    var ZEPP = ['sleepSecs', 'sleepScore', 'avgSleepingHR', 'hrv', 'restingHR', 'steps'];
    var anyZepp = dates.some(function (d) { var r = D.model.w[d]; return ZEPP.some(function (f) { return D.isNum(r[f]); }); });
    $('bodyNoData').hidden = !D.model.fetchedAt || anyZepp;
    var today = D.todayStr();
    var recentSleep = D.isNum(D.valueOn('sleep', today)) || D.isNum(D.valueOn('sleep', D.shift(today, -1)));
    $('bodyHint').hidden = !D.model.fetchedAt || recentSleep || !anyZepp;
    renderTiles();
    renderTraining();
  }
  D.renderBody = renderBody;

  /* ---------------- Check-in ---------------- */
  var MOODS = ['😣', '🙁', '😐', '🙂', '😄'];
  function renderCheckin() {
    var date = D.activeDate();
    var c = D.checkins()[date] || {};
    ['mood', 'energy', 'stress'].forEach(function (k) {
      var row = $('scale-' + k);
      row.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(Number(b.dataset.v) === c[k]));
      });
    });
    var note = $('checkinNote');
    if (document.activeElement !== note) note.value = c.note || '';
    $('checkinDate').textContent = D.fmtDay(date);
  }
  function buildScales() {
    ['mood', 'energy', 'stress'].forEach(function (k) {
      var row = $('scale-' + k);
      row.innerHTML = '';
      for (var i = 1; i <= 5; i++) {
        var b = el('button', k === 'mood' ? 'emoji' : '', k === 'mood' ? MOODS[i - 1] : String(i));
        b.type = 'button';
        b.dataset.v = String(i);
        b.setAttribute('aria-label', D.M[k].label + ' ' + i + ' von 5');
        b.addEventListener('click', function (e) {
          var v = Number(e.currentTarget.dataset.v);
          var date = D.activeDate();
          var cur = (D.checkins()[date] || {})[k];
          var patch = {};
          patch[k] = cur === v ? null : v;
          D.saveCheckin(date, patch);
          flashSaved();
        });
        row.appendChild(b);
      }
    });
    var t = null;
    $('checkinNote').addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        D.saveCheckin(D.activeDate(), { note: $('checkinNote').value.trim().slice(0, 500) });
        flashSaved();
      }, 700);
    });
  }
  var savedTimer = null;
  function flashSaved() {
    var s = $('checkinSaved');
    s.textContent = 'Gespeichert ✓';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(function () { s.textContent = ''; }, 1800);
  }

  /* ---------------- Measurement sheet (Gewicht / Körperfett) ---------------- */
  function openMeasure() {
    var today = D.todayStr();
    $('measureDate').value = today;
    $('measureDate').max = today;
    var latestW = D.series('weight').slice(-1)[0];
    var latestF = D.series('bodyFat').slice(-1)[0];
    $('measureWeight').value = '';
    $('measureWeight').placeholder = latestW ? D.fmtNum(latestW.v, 1) : 'z. B. 78,4';
    $('measureFat').value = '';
    $('measureFat').placeholder = latestF ? D.fmtNum(latestF.v, 1) : 'optional';
    $('measureResult').textContent = '';
    $('measureResult').className = 'sheet-result';
    $('measureNote').textContent = D.DEMO
      ? 'Demo-Modus: Der Wert wird nur hier angezeigt und nirgends gespeichert.'
      : 'Wird in deinem Intervals.icu-Konto gespeichert (Wellness → Gewicht) und erscheint dort und hier im Verlauf.';
    D.openSheet('measureSheet');
    setTimeout(function () { $('measureWeight').focus({ preventScroll: true }); }, 320);
  }
  D.openMeasure = openMeasure;
  function saveMeasure() {
    var res = $('measureResult');
    var date = $('measureDate').value;
    var w = D.parseNum($('measureWeight').value);
    var f = D.parseNum($('measureFat').value);
    if (!D.isValidYmd(date) || date > D.todayStr()) { res.className = 'sheet-result is-error'; res.textContent = 'Bitte ein gültiges Datum (nicht in der Zukunft) wählen.'; return; }
    var patch = {};
    if (D.isNum(w)) {
      if (w < 25 || w > 350) { res.className = 'sheet-result is-error'; res.textContent = 'Das Gewicht sieht nicht plausibel aus (25–350 kg).'; return; }
      patch.weight = Math.round(w * 10) / 10;
    }
    if (D.isNum(f)) {
      if (f < 2 || f > 70) { res.className = 'sheet-result is-error'; res.textContent = 'Körperfett muss zwischen 2 und 70 % liegen.'; return; }
      patch.bodyFat = Math.round(f * 10) / 10;
    }
    if (!Object.keys(patch).length) { res.className = 'sheet-result is-error'; res.textContent = 'Trag mindestens einen Wert ein.'; return; }
    if (!D.DEMO && !D.getSettings().apiKey) { res.className = 'sheet-result is-error'; res.textContent = 'Zum Speichern brauchst du zuerst den Intervals.icu-Schlüssel (⚙).'; return; }
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
      buildScales();
      if (D.DEMO) {
        applyModel(makeDemo());
        seedDemoCheckins();
      } else {
        var c = loadCache();
        if (c) applyModel(c); else renderBody();
      }
      renderCheckin();
      D.on('data', renderBody);
      D.on('settings', renderBody);
      D.on('checkins', function () { renderCheckin(); renderIndexCard(); });
      D.on('goals', function () { renderIndexCard(); });
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
      $('sleepStrip').addEventListener('click', function (e) {
        var g = e.target && e.target.closest ? e.target.closest('[data-cap]') : null;
        var cap = $('sleepCaption');
        if (!g) return;
        var t = g.getAttribute('data-cap');
        cap.textContent = cap.textContent === t ? (cap.dataset.avg || '') : t;
      });
      $('measureOpenBtn').addEventListener('click', openMeasure);
      $('measureSave').addEventListener('click', saveMeasure);
      $('measureCancel').addEventListener('click', function () { D.closeSheet('measureSheet'); });
      ['measureWeight', 'measureFat'].forEach(function (id) {
        $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveMeasure(); } });
      });
      $('indexCard').addEventListener('click', function () { D.go('verlauf', { metric: 'index' }); });

      fetchBody();
      setInterval(fetchBody, AUTO_REFRESH_MS);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible' || D.DEMO) return;
        if (state.syncPending) {
          state.syncPending = false;
          fetchBody();
          setTimeout(fetchBody, MIN_FETCH_GAP_MS + 1000);
          return;
        }
        if (Date.now() - state.lastFetchStart > STALE_ON_VISIBLE_MS) fetchBody();
      });
    },
    renderCheckin: renderCheckin,
    afterSettingsSaved: function () {
      state.lastFetchStart = 0;
      state.error = null;
      fetchBody({ force: true });
    }
  };
})();
