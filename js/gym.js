/* =====================================================================
   gym.js — Gym-Tracker: Wie oft warst du diese Woche im Gym?
   Tage per Tippen abhaken; Krafttrainings von der Uhr werden automatisch
   erkannt. Alles wird gespeichert und als Wochen-Historie gezeigt.
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  var KEY = 'gym_v1';
  /* Intervals.icu activity types that count as a gym visit. */
  var GYM_TYPES = { WeightTraining: 1, Crossfit: 1, Workout: 1, HIIT: 1, HighIntensityIntervalTraining: 1 };
  var WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  /* days[date] = 'm' (manuell), 'a' (von der Uhr), 'x' (Uhr-Tag bewusst entfernt) */
  function load() {
    var v = D.storeGet(KEY);
    return v && typeof v === 'object' && v.days && typeof v.days === 'object' ? v : { days: {} };
  }
  function save(v) { D.storeSet(KEY, v); D.emit('gym'); }
  function counts(state) { return state === 'm' || state === 'a'; }
  function isGymDay(date) { return counts(load().days[date]); }
  D.isGymDay = isGymDay;
  function weekCount(monday, data) {
    data = data || load();
    return D.weekDays(monday).filter(function (d) { return counts(data.days[d]); }).length;
  }
  D.gymWeekCount = function (monday) { return weekCount(monday); };

  /* Mark watch workouts as gym days (only once, never overriding a manual choice). */
  function syncFromWatch() {
    var data = load();
    var changed = false;
    (D.model.a || []).forEach(function (a) {
      if (!a || !GYM_TYPES[a.type] || typeof a.start_date_local !== 'string') return;
      var d = a.start_date_local.slice(0, 10);
      if (!data.days[d]) { data.days[d] = 'a'; changed = true; }
    });
    if (changed) save(data);
  }

  function toggle(date) {
    if (date > D.todayStr()) return;
    var data = load();
    var s = data.days[date];
    if (s === 'm') delete data.days[date];
    else if (s === 'a') data.days[date] = 'x';
    else data.days[date] = 'm';
    save(data);
    if (counts(data.days[date])) {
      var n = weekCount(D.mondayOf(date), data), goal = D.getSettings().gymGoal;
      D.toast(n >= goal && D.mondayOf(date) === D.mondayOf(D.todayStr()) ? 'Wochenziel geschafft 💪' : 'Gym eingetragen ✓');
    }
  }

  function streakWeeks() {
    var goal = D.getSettings().gymGoal, data = load();
    var mon = D.mondayOf(D.todayStr());
    var n = 0;
    if (weekCount(mon, data) >= goal) n++;
    for (var w = 1; w < 104; w++) {
      if (weekCount(D.shift(mon, -7 * w), data) >= goal) n++;
      else break;
    }
    return n;
  }

  function renderDots(wrap, large) {
    var data = load();
    var today = D.todayStr();
    var mon = D.mondayOf(today);
    wrap.innerHTML = '';
    wrap.className = 'week-dots' + (large ? ' large' : '');
    D.weekDays(mon).forEach(function (d, i) {
      var st = data.days[d];
      var on = counts(st);
      var b = el('button', 'week-dot' + (on ? ' is-on' : '') + (d === today ? ' is-today' : '') + (d > today ? ' is-future' : ''));
      b.type = 'button';
      b.disabled = d > today;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', D.fmtDayLong(d) + (on ? ': im Gym' + (st === 'a' ? ' (von der Uhr)' : '') : ': nicht im Gym'));
      var bubble = el('span', 'bubble', on ? (st === 'a' ? '⌚' : '✓') : '');
      b.appendChild(bubble);
      b.appendChild(el('span', 'wd', WD[i]));
      b.addEventListener('click', function () { toggle(d); });
      wrap.appendChild(b);
    });
  }

  function statusText(n, goal) {
    if (n >= goal) return n > goal ? 'Wochenziel übertroffen — stark! 🔥' : 'Wochenziel geschafft 💪';
    var left = goal - n;
    var daysLeft = 7 - ((D.parseYmd(D.todayStr()).getDay() + 6) % 7) - (isGymDay(D.todayStr()) ? 1 : 0);
    if (left > daysLeft) return 'Noch ' + left + '× bis zum Ziel — diese Woche wird knapp.';
    return 'Noch ' + left + '× bis zu deinem Wochenziel.';
  }

  /* ---------------- Heute card ---------------- */
  function renderMini() {
    var goal = D.getSettings().gymGoal;
    var mon = D.mondayOf(D.todayStr());
    var n = weekCount(mon);
    $('miniGymNum').innerHTML = n + '<small>von ' + goal + '</small>';
    $('miniGymText').textContent = statusText(n, goal);
    renderDots($('miniGymDots'), false);
    var todayOn = isGymDay(D.todayStr());
    var btn = $('miniGymBtn');
    btn.textContent = todayOn ? 'Heute im Gym ✓' : 'Ich war heute im Gym';
    btn.className = todayOn ? 'btn btn-light btn-block' : 'btn btn-dark btn-block';
  }

  /* ---------------- Gym tab ---------------- */
  function render() {
    renderMini();
    if ($('view-gym').hidden) return;
    var s = D.getSettings();
    var goal = s.gymGoal;
    var data = load();
    var today = D.todayStr();
    var mon = D.mondayOf(today);
    var n = weekCount(mon, data);
    $('gymWeekLabel').textContent = 'KW ' + D.isoWeek(mon) + ' · ' + D.fmtDayMonth(mon) + ' – ' + D.fmtDayMonth(D.shift(mon, 6));
    $('gymNum').innerHTML = n + '<small>von ' + goal + ' Mal</small>';
    $('gymStatus').textContent = statusText(n, goal);
    $('gymGoalVal').textContent = goal + '× pro Woche';
    $('gymGoalMinus').disabled = goal <= 1;
    $('gymGoalPlus').disabled = goal >= 7;
    renderDots($('gymDots'), true);

    // Stats
    var last8 = [];
    for (var w = 1; w <= 8; w++) last8.push(weekCount(D.shift(mon, -7 * w), data));
    var yearStart = today.slice(0, 4) + '-01-01';
    var yearTotal = Object.keys(data.days).filter(function (d) { return d >= yearStart && d <= today && counts(data.days[d]); }).length;
    $('gymStreak').textContent = streakWeeks();
    $('gymAvg').textContent = D.fmtNum(D.mean(last8), 1);
    $('gymYear').textContent = yearTotal;

    // 12-week history
    var items = [];
    for (var k = 11; k >= 0; k--) {
      var m = D.shift(mon, -7 * k);
      var c = weekCount(m, data);
      items.push({ label: k === 0 ? 'jetzt' : String(D.isoWeek(m)), value: c, highlight: k === 0, title: 'KW ' + D.isoWeek(m) + ': ' + c + '× im Gym' });
    }
    D.weekBars($('gymChart'), items, { goal: goal, showValues: true, minMax: goal, height: 180, label: 'Gym-Besuche pro Woche' });

    // Recent gym days
    var list = $('gymDays');
    list.innerHTML = '';
    var days = Object.keys(data.days).filter(function (d) { return counts(data.days[d]) && d <= today; }).sort().reverse().slice(0, 8);
    $('gymDaysEmpty').hidden = days.length > 0;
    days.forEach(function (d) {
      var li = el('li', 'list-row');
      li.appendChild(el('span', 'emoji', data.days[d] === 'a' ? '⌚' : '🏋️'));
      var g = el('div', 'grow');
      g.appendChild(el('div', 't', D.fmtDayLong(d)));
      var acts = (D.model.a || []).filter(function (a) { return a.start_date_local.slice(0, 10) === d && GYM_TYPES[a.type]; });
      var sub = data.days[d] === 'a' ? 'Von deiner Uhr erkannt' : 'Von dir eingetragen';
      if (acts.length && D.positive(acts[0].moving_time)) sub += ' · ' + D.fmtMins(acts[0].moving_time / 60);
      g.appendChild(el('div', 's', sub));
      li.appendChild(g);
      li.appendChild(el('span', 'badge', D.relDays(d)));
      list.appendChild(li);
    });

    // Watch workouts (all types)
    var wl = $('workoutList');
    wl.innerHTML = '';
    var acts = (D.model.a || []).slice().sort(function (a, b) { return a.start_date_local < b.start_date_local ? 1 : -1; }).slice(0, 5);
    $('workoutEmpty').hidden = acts.length > 0;
    acts.forEach(function (a) {
      var li = el('li', 'list-row');
      li.appendChild(el('span', 'emoji', emoji(a.type)));
      var g = el('div', 'grow');
      g.appendChild(el('div', 't', (a.name && a.name.trim()) || a.type || 'Workout'));
      var meta = [D.fmtDay(a.start_date_local.slice(0, 10))];
      if (D.positive(a.moving_time)) meta.push(D.fmtMins(a.moving_time / 60));
      if (D.positive(a.average_heartrate)) meta.push('Ø ' + Math.round(a.average_heartrate) + ' bpm');
      g.appendChild(el('div', 's', meta.join(' · ')));
      li.appendChild(g);
      wl.appendChild(li);
    });
    if (D.Photos) D.Photos.render();
  }
  function emoji(type) {
    switch (type) {
      case 'Run': case 'VirtualRun': case 'TrailRun': return '🏃';
      case 'Ride': case 'VirtualRide': case 'GravelRide': case 'MountainBikeRide': case 'EBikeRide': return '🚴';
      case 'Walk': case 'Hike': return '🚶';
      case 'Swim': case 'OpenWaterSwim': return '🏊';
      default: return GYM_TYPES[type] ? '🏋️' : '⚡';
    }
  }

  function setGoal(delta) {
    var g = Math.max(1, Math.min(7, D.getSettings().gymGoal + delta));
    D.saveSettings({ gymGoal: g });
  }

  D.Gym = {
    boot: function () {
      $('miniGymBtn').addEventListener('click', function () { toggle(D.todayStr()); });
      $('gymTodayBtn').addEventListener('click', function () { toggle(D.todayStr()); });
      $('gymGoalMinus').addEventListener('click', function () { setGoal(-1); });
      $('gymGoalPlus').addEventListener('click', function () { setGoal(1); });
      $('miniGymMore').addEventListener('click', function () { D.go('gym'); });
      D.on('gym', D.Gym.render);
      D.on('settings', D.Gym.render);
      D.on('data', function () { syncFromWatch(); D.Gym.render(); });
      var rt = null;
      window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (!$('view-gym').hidden) D.Gym.render(); }, 160); });
      syncFromWatch();
      D.Gym.render();
    },
    render: function () {
      render();
      var on = isGymDay(D.todayStr());
      $('gymTodayBtn').textContent = on ? 'Heute im Gym ✓ (tippen zum Entfernen)' : 'Ich war heute im Gym';
      $('gymTodayBtn').className = on ? 'btn btn-light btn-block' : 'btn btn-dark btn-block';
    },
    weekCount: weekCount,
    summary: function () {
      var mon = D.mondayOf(D.todayStr());
      var out = [];
      for (var w = 0; w < 8; w++) out.push('KW ' + D.isoWeek(D.shift(mon, -7 * w)) + ': ' + weekCount(D.shift(mon, -7 * w)) + '×');
      return 'Gym-Ziel ' + D.getSettings().gymGoal + '× pro Woche. ' + out.join(', ') + '. Wochen in Folge mit Ziel: ' + streakWeeks() + '.';
    },
    seedDemo: function () {
      if (!D.DEMO || D.storeGet('demo_seeded_gym')) return;
      var data = { days: {} };
      var seed = 31;
      function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
      var mon = D.mondayOf(D.todayStr());
      for (var w = 16; w >= 0; w--) {
        var m = D.shift(mon, -7 * w);
        var n = w === 0 ? 2 : 1 + Math.floor(rnd() * 4);
        var days = D.weekDays(m).filter(function (d) { return d < D.todayStr(); });
        for (var i = 0; i < n && days.length; i++) {
          var d = days.splice(Math.floor(rnd() * days.length), 1)[0];
          data.days[d] = 'm';
        }
      }
      D.storeSet(KEY, data);
      D.storeSet('demo_seeded_gym', true);
    }
  };
})();
