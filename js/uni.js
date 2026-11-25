/* =====================================================================
   uni.js — Uni: Klausuren & Abgaben mit Countdown, Lernzeit mit Timer,
   Wochenziel, Fächer-Übersicht und Historie.
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  var EXAMS_KEY = 'uni_exams_v1';
  var SESS_KEY = 'uni_sessions_v1';
  var TIMER_KEY = 'uni_timer_v1';
  var TYPES = {
    klausur: { label: 'Klausur', emoji: '📝' },
    abgabe: { label: 'Abgabe', emoji: '📄' },
    vortrag: { label: 'Vortrag', emoji: '🎤' },
    sonstiges: { label: 'Termin', emoji: '📌' }
  };
  var editingExam = null;
  var tickTimer = null;

  function exams() {
    var v = D.storeGet(EXAMS_KEY);
    return Array.isArray(v) ? v.filter(function (e) { return e && e.id && e.title && D.isValidYmd(e.date); }) : [];
  }
  function sessions() {
    var v = D.storeGet(SESS_KEY);
    return Array.isArray(v) ? v.filter(function (s) { return s && s.id && D.isValidYmd(s.date) && D.isNum(s.mins) && s.mins > 0; }) : [];
  }
  function timer() {
    var t = D.storeGet(TIMER_KEY);
    return t && D.isNum(t.start) ? t : null;
  }
  function upcoming() {
    var today = D.todayStr();
    return exams().filter(function (e) { return e.date >= today; }).sort(function (a, b) { return (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1; });
  }
  function past() {
    var today = D.todayStr();
    return exams().filter(function (e) { return e.date < today; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }
  function minsOn(date) { return sessions().filter(function (s) { return s.date === date; }).reduce(function (a, s) { return a + s.mins; }, 0); }
  function minsWeek(monday) {
    var end = D.shift(monday, 6);
    return sessions().filter(function (s) { return s.date >= monday && s.date <= end; }).reduce(function (a, s) { return a + s.mins; }, 0);
  }
  D.studyMinsWeek = minsWeek;
  D.studyMinsDay = minsOn;
  function subjects() {
    var set = {};
    sessions().forEach(function (s) { if (s.subject) set[s.subject] = true; });
    exams().forEach(function (e) { if (e.type === 'klausur') set[e.title.replace(/^Klausur\s+/i, '')] = true; });
    return Object.keys(set).sort();
  }

  function addSession(date, mins, subject) {
    var all = sessions();
    all.push({ id: D.uid('s'), date: date, mins: Math.round(mins), subject: (subject || '').trim().slice(0, 60) || null, at: Date.now() });
    D.storeSet(SESS_KEY, all);
    D.emit('uni');
  }

  /* ---------------- Timer ---------------- */
  function fmtElapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return (h ? h + ':' + D.pad2(m) : m) + ':' + D.pad2(sec);
  }
  function startTimer(subjectInput) {
    var subj = (subjectInput.value || '').trim();
    D.storeSet(TIMER_KEY, { start: Date.now(), subject: subj || null });
    D.emit('uni');
  }
  function stopTimer() {
    var t = timer();
    if (!t) return;
    var mins = (Date.now() - t.start) / 60000;
    D.storeDelete(TIMER_KEY);
    if (mins < 1) { D.emit('uni'); D.toast('Unter 1 Minute — nicht gespeichert'); return; }
    if (mins > 12 * 60 && !window.confirm('Der Timer lief ' + D.fmtMins(mins) + '. Wirklich so speichern?')) { D.emit('uni'); return; }
    addSession(D.ymd(new Date(t.start)), mins, t.subject);
    D.toast(D.fmtMins(mins) + ' Lernzeit gespeichert ✓');
  }
  function renderTimers() {
    var t = timer();
    [['mini', 'miniStudy'], ['tab', 'study']].forEach(function (p) {
      var box = $(p[1] + 'TimerBox'), btn = $(p[1] + 'TimerBtn'), subj = $(p[1] + 'Subject');
      if (!box) return;
      if (t) {
        box.hidden = false;
        $(p[1] + 'TimerTime').textContent = fmtElapsed(Date.now() - t.start);
        $(p[1] + 'TimerSub').textContent = (t.subject || 'Lernen') + ' · seit ' + D.fmtClock(new Date(t.start));
        btn.innerHTML = D.icon('stop') + 'Stoppen & speichern';
        btn.className = 'btn btn-dark btn-block';
        if (subj) subj.parentNode.hidden = true;
      } else {
        box.hidden = true;
        btn.innerHTML = D.icon('play') + 'Lernen starten';
        btn.className = 'btn btn-dark btn-block';
        if (subj) subj.parentNode.hidden = false;
      }
    });
    clearInterval(tickTimer);
    if (t) {
      tickTimer = setInterval(function () {
        var tt = timer();
        if (!tt) { clearInterval(tickTimer); return; }
        ['miniStudy', 'study'].forEach(function (p) { var n = $(p + 'TimerTime'); if (n) n.textContent = fmtElapsed(Date.now() - tt.start); });
      }, 1000);
    }
  }

  /* ---------------- Exam rows ---------------- */
  function examRow(e, isPast) {
    var li = el('li', 'list-row tap' + (isPast ? ' past' : ''));
    li.setAttribute('role', 'button');
    li.tabIndex = 0;
    var ty = TYPES[e.type] || TYPES.sonstiges;
    li.appendChild(el('span', 'emoji', ty.emoji));
    var g = el('div', 'grow');
    g.appendChild(el('div', 't', e.title));
    g.appendChild(el('div', 's', ty.label + ' · ' + D.fmtDay(e.date) + (e.time ? ', ' + e.time + ' Uhr' : '') + (e.place ? ' · ' + e.place : '')));
    li.appendChild(g);
    var days = D.daysBetween(D.todayStr(), e.date);
    var b = el('span', 'badge' + (!isPast && days <= 7 ? ' attention' : ''), D.relDays(e.date));
    li.appendChild(b);
    function open() { openExam(e); }
    li.addEventListener('click', open);
    li.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') open(); });
    return li;
  }

  function nextExamBlock(prefix) {
    var next = upcoming()[0];
    $(prefix + 'ExamEmpty').hidden = !!next;
    $(prefix + 'ExamBox').hidden = !next;
    if (!next) return;
    var days = D.daysBetween(D.todayStr(), next.date);
    var ty = TYPES[next.type] || TYPES.sonstiges;
    $(prefix + 'ExamDays').innerHTML = (days === 0 ? 'Heute' : days === 1 ? 'Morgen' : days) + (days > 1 ? '<small>Tage</small>' : '');
    $(prefix + 'ExamTitle').textContent = ty.emoji + ' ' + next.title;
    $(prefix + 'ExamMeta').textContent = D.fmtDayLong(next.date) + (next.time ? ', ' + next.time + ' Uhr' : '') + (next.place ? ' · ' + next.place : '');
  }

  /* ---------------- Render ---------------- */
  function renderMini() {
    nextExamBlock('mini');
    var goalH = D.getSettings().studyGoalH;
    var mon = D.mondayOf(D.todayStr());
    var wk = minsWeek(mon), td = minsOn(D.todayStr());
    $('miniStudyLine').textContent = 'Heute ' + D.fmtMins(td) + ' · Woche ' + D.fmtMins(wk) + (goalH ? ' von ' + D.fmtNum(goalH, 0) + ' Std' : '');
    $('miniStudyFill').style.width = goalH ? Math.min(100, Math.round(wk / (goalH * 60) * 100)) + '%' : '0%';
    $('miniStudyTrack').hidden = !goalH;
  }

  function render() {
    renderMini();
    renderTimers();
    fillDatalist();
    if ($('view-uni').hidden) return;
    nextExamBlock('uni');
    var up = upcoming(), pa = past();
    var list = $('examList');
    list.innerHTML = '';
    up.forEach(function (e) { list.appendChild(examRow(e, false)); });
    $('examListEmpty').hidden = up.length > 0;
    var pl = $('examPast');
    pl.innerHTML = '';
    pa.slice(0, 20).forEach(function (e) { pl.appendChild(examRow(e, true)); });
    $('examPastWrap').hidden = !pa.length;
    $('examPastSum').textContent = 'Vergangene Termine (' + pa.length + ')';

    // Study week
    var goalH = D.getSettings().studyGoalH;
    var mon = D.mondayOf(D.todayStr());
    var wk = minsWeek(mon);
    $('studyWeek').innerHTML = D.fmtMins(wk).replace(/(\d+h \d+m|\d+ Std|\d+ Min)/, '$1') + (goalH ? '<small>von ' + D.fmtNum(goalH, 0) + ' Std</small>' : '');
    $('studyWeekFill').style.width = goalH ? Math.min(100, Math.round(wk / (goalH * 60) * 100)) + '%' : '0%';
    $('studyWeekTrack').hidden = !goalH;
    $('studyToday').textContent = 'Heute: ' + D.fmtMins(minsOn(D.todayStr())) +
      (goalH && wk < goalH * 60 ? ' · noch ' + D.fmtMins(goalH * 60 - wk) + ' bis zum Wochenziel' : (goalH ? ' · Wochenziel geschafft 🎉' : ''));

    // By subject (this week)
    var bySub = {};
    var end = D.shift(mon, 6);
    sessions().forEach(function (s) {
      if (s.date < mon || s.date > end) return;
      var k = s.subject || 'Ohne Fach';
      bySub[k] = (bySub[k] || 0) + s.mins;
    });
    var subs = Object.keys(bySub).sort(function (a, b) { return bySub[b] - bySub[a]; });
    var sw = $('studySubjects');
    sw.innerHTML = '';
    $('studySubjectsEmpty').hidden = subs.length > 0;
    var maxM = subs.length ? bySub[subs[0]] : 1;
    subs.forEach(function (k) {
      var r = el('div', 'subject-row');
      r.appendChild(el('span', null, k));
      r.appendChild(el('span', 'muted small num', D.fmtMins(bySub[k])));
      var tr = el('div', 'track');
      var f = el('div', 'track-fill');
      f.style.width = Math.round(bySub[k] / maxM * 100) + '%';
      tr.appendChild(f);
      r.appendChild(tr);
      sw.appendChild(r);
    });

    // 8-week history
    var items = [];
    for (var w = 7; w >= 0; w--) {
      var m = D.shift(mon, -7 * w);
      var h = minsWeek(m) / 60;
      items.push({ label: w === 0 ? 'jetzt' : String(D.isoWeek(m)), value: Math.round(h * 10) / 10, highlight: w === 0, title: 'KW ' + D.isoWeek(m) + ': ' + D.fmtMins(h * 60) });
    }
    D.weekBars($('studyChart'), items, { goal: goalH || null, showValues: true, height: 180, label: 'Lernstunden pro Woche', fmtValue: function (v) { return D.fmtNum(v, v < 10 ? 1 : 0); }, fmtAxis: function (v) { return v + 'h'; } });

    // Recent sessions
    var rl = $('studyLog');
    rl.innerHTML = '';
    var recent = sessions().sort(function (a, b) { return (b.date + b.at) > (a.date + a.at) ? 1 : -1; }).slice(0, 10);
    $('studyLogEmpty').hidden = recent.length > 0;
    recent.forEach(function (s) {
      var li = el('li', 'list-row');
      li.appendChild(el('span', 'emoji', '📚'));
      var g = el('div', 'grow');
      g.appendChild(el('div', 't', s.subject || 'Lernen'));
      g.appendChild(el('div', 's', D.fmtDay(s.date) + ' · ' + D.fmtMins(s.mins)));
      li.appendChild(g);
      var del = el('button', 'row-btn goal-delete', '×');
      del.type = 'button';
      del.setAttribute('aria-label', 'Eintrag löschen');
      del.addEventListener('click', function () {
        var all = sessions();
        var idx = -1;
        all.forEach(function (x, i) { if (x.id === s.id) idx = i; });
        if (idx < 0) return;
        var removed = all.splice(idx, 1)[0];
        D.storeSet(SESS_KEY, all);
        D.emit('uni');
        D.toast('Eintrag gelöscht', { label: 'Rückgängig', fn: function () { var a = sessions(); a.push(removed); D.storeSet(SESS_KEY, a); D.emit('uni'); } });
      });
      li.appendChild(del);
      rl.appendChild(li);
    });
  }
  function fillDatalist() {
    var dl = $('subjectList');
    dl.innerHTML = '';
    subjects().forEach(function (s) { var o = document.createElement('option'); o.value = s; dl.appendChild(o); });
  }

  /* ---------------- Exam sheet ---------------- */
  function openExam(e) {
    editingExam = e ? e.id : null;
    $('examFormTitle').textContent = e ? 'Termin bearbeiten' : 'Neuer Termin';
    $('examType').value = e ? e.type : 'klausur';
    $('examTitle').value = e ? e.title : '';
    $('examDate').value = e ? e.date : '';
    $('examTime').value = e && e.time ? e.time : '';
    $('examPlace').value = e && e.place ? e.place : '';
    $('examDelete').hidden = !e;
    $('examResult').textContent = '';
    D.openSheet('examSheet');
    if (!e) setTimeout(function () { $('examTitle').focus({ preventScroll: true }); }, 320);
  }
  function saveExam() {
    var res = $('examResult');
    res.className = 'sheet-result is-error';
    var title = $('examTitle').value.replace(/\s+/g, ' ').trim();
    var date = $('examDate').value;
    var time = $('examTime').value;
    if (!title) { res.textContent = 'Gib dem Termin einen Namen, z. B. „Mathe 2“.'; return; }
    if (!D.isValidYmd(date)) { res.textContent = 'Bitte ein Datum wählen.'; return; }
    if (time && !/^\d{2}:\d{2}$/.test(time)) time = '';
    var all = exams();
    var item = { id: editingExam || D.uid('e'), type: $('examType').value, title: title.slice(0, 80), date: date, time: time || null, place: $('examPlace').value.trim().slice(0, 80) || null };
    var found = false;
    all = all.map(function (x) { if (x.id === item.id) { found = true; return item; } return x; });
    if (!found) all.push(item);
    D.storeSet(EXAMS_KEY, all);
    D.closeSheet('examSheet');
    D.emit('uni');
    D.toast(found ? 'Termin gespeichert' : 'Termin eingetragen ✓');
  }
  function deleteExam() {
    if (!editingExam) return;
    var all = exams();
    var idx = -1;
    all.forEach(function (x, i) { if (x.id === editingExam) idx = i; });
    if (idx < 0) return;
    var removed = all.splice(idx, 1)[0];
    D.storeSet(EXAMS_KEY, all);
    D.closeSheet('examSheet');
    D.emit('uni');
    D.toast('Termin gelöscht', { label: 'Rückgängig', fn: function () { var a = exams(); a.push(removed); D.storeSet(EXAMS_KEY, a); D.emit('uni'); } });
  }

  /* ---------------- Manual study sheet ---------------- */
  function openManual() {
    $('manualDate').value = D.todayStr();
    $('manualDate').max = D.todayStr();
    $('manualMins').value = '';
    $('manualSubject').value = $('studySubject').value || '';
    $('manualResult').textContent = '';
    D.openSheet('studySheet');
  }
  function saveManual() {
    var res = $('manualResult');
    res.className = 'sheet-result is-error';
    var date = $('manualDate').value;
    var mins = D.parseNum($('manualMins').value);
    if (!D.isValidYmd(date) || date > D.todayStr()) { res.textContent = 'Bitte ein gültiges Datum wählen.'; return; }
    if (!D.isNum(mins) || mins < 1 || mins > 960) { res.textContent = 'Dauer in Minuten eingeben (1–960).'; return; }
    addSession(date, mins, $('manualSubject').value);
    D.closeSheet('studySheet');
    D.toast(D.fmtMins(mins) + ' eingetragen ✓');
  }

  D.Uni = {
    boot: function () {
      $('miniStudyTimerBtn').addEventListener('click', function () { if (timer()) stopTimer(); else startTimer($('miniStudySubject')); });
      $('studyTimerBtn').addEventListener('click', function () { if (timer()) stopTimer(); else startTimer($('studySubject')); });
      document.querySelectorAll('[data-quick-mins]').forEach(function (b) {
        b.addEventListener('click', function () {
          var m = Number(b.getAttribute('data-quick-mins'));
          addSession(D.todayStr(), m, $('studySubject').value);
          D.toast('+' + D.fmtMins(m) + ' eingetragen ✓');
        });
      });
      $('studyManualBtn').addEventListener('click', openManual);
      $('manualSave').addEventListener('click', saveManual);
      $('manualCancel').addEventListener('click', function () { D.closeSheet('studySheet'); });
      document.querySelectorAll('[data-add-exam]').forEach(function (b) { b.addEventListener('click', function () { openExam(null); }); });
      $('examSave').addEventListener('click', saveExam);
      $('examCancel').addEventListener('click', function () { D.closeSheet('examSheet'); });
      $('examDelete').addEventListener('click', deleteExam);
      $('miniUniMore').addEventListener('click', function () { D.go('uni'); });
      D.on('uni', render);
      D.on('settings', render);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') renderTimers(); });
      render();
    },
    render: render,
    summary: function () {
      var lines = [];
      var up = upcoming().slice(0, 6);
      if (up.length) lines.push('Anstehende Uni-Termine: ' + up.map(function (e) { return (TYPES[e.type] || TYPES.sonstiges).label + ' ' + e.title + ' am ' + e.date + ' (' + D.relDays(e.date) + ')'; }).join('; ') + '.');
      var mon = D.mondayOf(D.todayStr());
      var weeks = [];
      for (var w = 0; w < 6; w++) weeks.push('KW ' + D.isoWeek(D.shift(mon, -7 * w)) + ': ' + D.fmtMins(minsWeek(D.shift(mon, -7 * w))));
      lines.push('Lernzeit pro Woche (Ziel ' + D.getSettings().studyGoalH + ' Std): ' + weeks.join(', ') + '.');
      return lines.join('\n');
    },
    seedDemo: function () {
      if (!D.DEMO || D.storeGet('demo_seeded_uni')) return;
      var t = D.todayStr();
      D.storeSet(EXAMS_KEY, [
        { id: 'e1', type: 'klausur', title: 'Mathe 2', date: D.shift(t, 12), time: '09:00', place: 'Audimax' },
        { id: 'e2', type: 'abgabe', title: 'Hausarbeit BWL', date: D.shift(t, 5), time: '23:59', place: null },
        { id: 'e3', type: 'klausur', title: 'Statistik', date: D.shift(t, 26), time: '13:00', place: 'HS 2' },
        { id: 'e4', type: 'vortrag', title: 'Seminar Marketing', date: D.shift(t, -9), time: null, place: null }
      ]);
      var subs = ['Mathe 2', 'Statistik', 'BWL', 'Mathe 2'];
      var seed = 17;
      function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
      var all = [];
      for (var i = 55; i >= 0; i--) {
        if (rnd() < 0.35) continue;
        var n = 1 + Math.floor(rnd() * 2);
        for (var k = 0; k < n; k++) all.push({ id: D.uid('s'), date: D.shift(t, -i), mins: 25 + Math.round(rnd() * 95), subject: subs[Math.floor(rnd() * subs.length)], at: Date.now() - i * 864e5 });
      }
      D.storeSet(SESS_KEY, all);
      D.storeSet('demo_seeded_uni', true);
    }
  };
})();
