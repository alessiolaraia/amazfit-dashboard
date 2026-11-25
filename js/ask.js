/* =====================================================================
   ask.js — "Frag Claude": Fragen zu deinen eigenen Daten.
   Mit Anthropic-Schlüssel antwortet Claude direkt hier; ohne Schlüssel
   wird ein fertiger Prompt mit deinen Daten kopiert (für claude.ai).
   "Was Claude sieht" zeigt genau, was gesendet wird.
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  var MODEL = 'claude-opus-5-5';
  var thread = [];
  var busy = false;
  var lastError = null;

  var SYSTEM =
    'Du bist ein persönlicher Daten-Coach in einem privaten Gesundheits- und Gewohnheits-Dashboard. ' +
    'Die Daten stammen von einer Amazfit-Uhr (über Zepp und Intervals.icu), aus täglichen Check-ins und einer To-do-Liste. ' +
    'Antworte immer auf Deutsch, per du, kurz und konkret (meist unter 200 Wörtern). ' +
    'Beziehe dich auf konkrete Zahlen und Daten aus dem Kontext. Wenn die Daten für eine Aussage nicht reichen, sag das offen statt zu raten. ' +
    'Unterscheide Zusammenhang von Ursache. Stelle keine medizinischen Diagnosen; empfiehl bei auffälligen Werten oder Beschwerden ärztlichen Rat. ' +
    'Nutze einfache Formatierung: kurze Absätze, Aufzählungen mit "- ", Hervorhebungen mit **fett**.';

  function v(key, d) {
    var x = D.valueOn(key, d);
    return D.isNum(x) ? x : null;
  }
  function cell(key, d) {
    var x = v(key, d);
    if (x == null) return '';
    if (key === 'sleep') return D.fmtNum(x, 2);
    return D.fmtNum(x, D.M[key].dec);
  }

  function buildContext() {
    var today = D.todayStr();
    var s = D.getSettings();
    var lines = [];
    lines.push('Heute ist ' + D.fmtDayLong(today) + ' ' + today.slice(0, 4) + '.');
    lines.push('Schrittziel: ' + s.stepGoal + '.' + (s.weightGoal ? ' Zielgewicht: ' + D.fmtNum(s.weightGoal, 1) + ' kg.' : ''));
    var lc = D.latestComposite();
    if (lc) {
      lines.push('Körper-Index (100 = eigene Basis aus den ersten 30 Tagen, 10 Punkte = eine Standardabweichung): ' + Math.round(lc.score) +
        ' am ' + lc.date + ' (Teile: ' + lc.parts.map(function (p) { return D.M[p.key].label + ' ' + Math.round(p.idx); }).join(', ') + ').');
    }
    var basis = D.indexMembers().filter(D.indexReady).map(function (k) {
      var b = D.baseline(k);
      return D.M[k].label + ' Ø ' + D.fmtValue(k, b.mean) + ' ± ' + D.fmtNum(b.sd, D.M[k].dec || (k === 'sleep' ? 2 : 0));
    });
    if (basis.length) lines.push('Basiswerte: ' + basis.join('; ') + '.');
    lines.push('');
    var cols = ['sleep', 'sleepScore', 'hrv', 'rhr', 'steps', 'weight', 'mood', 'energy', 'stress', 'goals'].filter(D.hasData);
    var labels = { sleep: 'Schlaf_h', sleepScore: 'Schlafscore', hrv: 'HRV_ms', rhr: 'Ruhepuls', steps: 'Schritte', weight: 'Gewicht_kg', mood: 'Stimmung_1-5', energy: 'Energie_1-5', stress: 'Stress_1-5', goals: 'Ziele_%' };
    lines.push('Tageswerte der letzten 30 Tage (leer = nicht gemessen):');
    lines.push(['Datum'].concat(cols.map(function (c) { return labels[c]; })).join(' | '));
    for (var i = 29; i >= 0; i--) {
      var d = D.shift(today, -i);
      var row = cols.map(function (c) { return cell(c, d); });
      if (row.every(function (x) { return x === ''; })) continue;
      lines.push([d + ' ' + D.wdShort(d)].concat(row).join(' | '));
    }
    var monthly = ['sleep', 'hrv', 'rhr', 'steps', 'weight'].filter(D.hasData).map(function (k) {
      var parts = [];
      for (var mth = 0; mth < 6; mth++) {
        var end = D.shift(today, -30 * mth), start = D.shift(end, -29);
        var xs = D.dateRange(start, end).map(function (d) { return v(k, d); }).filter(D.isNum);
        parts.push(xs.length ? D.fmtValue(k, D.mean(xs)) : '–');
      }
      return D.M[k].label + ': ' + parts.join(' ← ');
    });
    if (monthly.length) {
      lines.push('');
      lines.push('30-Tage-Durchschnitte, neuester zuerst (bis 6 Monate zurück):');
      monthly.forEach(function (l) { lines.push(l); });
    }
    var ex = D.Experiments ? D.Experiments.summaries() : [];
    if (ex.length) {
      lines.push('');
      lines.push('Experimente (Vergleich 28 Tage davor vs. während, Urteil erst ab 10 Tagen je Seite und 2 Standardfehlern):');
      ex.forEach(function (l) { lines.push('- ' + l); });
    }
    var notes = [];
    var ck = D.checkins();
    for (var j = 13; j >= 0; j--) {
      var dd = D.shift(today, -j);
      if (ck[dd] && ck[dd].note) notes.push(dd + ': ' + ck[dd].note);
    }
    if (notes.length) {
      lines.push('');
      lines.push('Notizen aus den Check-ins (letzte 14 Tage):');
      notes.forEach(function (n) { lines.push('- ' + n); });
    }
    var goals = D.getGoals(D.todayGoalsKey());
    if (goals.length) {
      lines.push('');
      lines.push('Ziele heute: ' + goals.map(function (g) { return (g.done ? '[x] ' : '[ ] ') + g.text; }).join('; '));
    }
    var acts = D.model.a.slice().sort(function (a, b) { return a.start_date_local < b.start_date_local ? 1 : -1; }).slice(0, 8);
    if (acts.length) {
      lines.push('');
      lines.push('Letzte Workouts: ' + acts.map(function (a) {
        return a.start_date_local.slice(0, 10) + ' ' + (a.name || a.type) + (D.positive(a.moving_time) ? ' ' + Math.round(a.moving_time / 60) + ' Min' : '') + (D.isNum(a.icu_training_load) ? ' Last ' + Math.round(a.icu_training_load) : '');
      }).join('; '));
    }
    return lines.join('\n');
  }
  D.buildAskContext = buildContext;

  /* Minimal, safe markdown: escape first, then **bold**, lists, headings. */
  function renderMarkdown(text) {
    var out = [];
    var inList = false;
    String(text || '').split(/\n/).forEach(function (line) {
      var t = line.trim();
      var item = /^([-*•]|\d+\.)\s+(.*)$/.exec(t);
      if (item) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(item[2]) + '</li>');
        return;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      if (!t) return;
      var h = /^#{1,4}\s+(.*)$/.exec(t);
      if (h) { out.push('<h4>' + inline(h[1]) + '</h4>'); return; }
      out.push('<p>' + inline(t) + '</p>');
    });
    if (inList) out.push('</ul>');
    return out.join('');
    function inline(s) {
      return D.esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }
  }

  function renderThread() {
    var wrap = $('askThread');
    wrap.innerHTML = '';
    thread.forEach(function (m) {
      if (m.role === 'user') wrap.appendChild(el('div', 'ask-msg user', m.display));
      else { var b = el('div', 'ask-msg bot'); b.innerHTML = renderMarkdown(m.text); wrap.appendChild(b); }
    });
    if (busy) wrap.appendChild(el('div', 'ask-thinking', 'Claude denkt nach…'));
    if (lastError) wrap.appendChild(el('div', 'ask-msg error', lastError));
    $('askReset').hidden = !thread.length;
    $('askChips').hidden = thread.length > 0;
  }

  function hasKey() { return !!D.getSettings().anthropicKey; }

  function updateMode() {
    var k = hasKey();
    $('askSend').textContent = k ? 'Fragen' : 'Prompt kopieren';
    $('askNoKey').hidden = k;
    $('askContextPre').textContent = buildContext();
  }

  function apiMessages() {
    var msgs = [];
    thread.forEach(function (m) {
      if (m.role === 'user') msgs.push({ role: 'user', content: m.content });
      else msgs.push({ role: 'assistant', content: m.blocks && m.blocks.length ? m.blocks : m.text });
    });
    return msgs;
  }

  function send(q) {
    q = (q || $('askInput').value).trim();
    if (!q || busy) return;
    if (!hasKey()) {
      var prompt = SYSTEM + '\n\n---\nMeine Daten:\n' + buildContext() + '\n---\n\nMeine Frage: ' + q;
      copy(prompt).then(function (ok) {
        D.toast(ok ? 'Prompt kopiert — jetzt in Claude einfügen' : 'Kopieren nicht möglich — markiere den Text unter „Was Claude sieht“.');
      });
      return;
    }
    var content = thread.length ? q : 'Meine Daten:\n' + buildContext() + '\n\nMeine Frage: ' + q;
    thread.push({ role: 'user', content: content, display: q });
    $('askInput').value = '';
    busy = true;
    renderThread();
    // Drop any earlier failed turn so roles keep alternating.
    var msgs = apiMessages();
    D.callClaude({ model: MODEL, system: SYSTEM, maxTokens: 16000, messages: msgs })
      .then(function (res) {
        thread.push({ role: 'assistant', text: res.text || '(keine Antwort)', blocks: res.content });
      })
      .catch(function (e) {
        thread.pop();
        $('askInput').value = q;
        lastError = e.status === 401 ? 'Der Anthropic-Schlüssel wurde abgelehnt — prüf ihn in ⚙ Einstellungen.'
          : e.status === 429 ? 'Zu viele Anfragen gerade — versuch es in einer Minute nochmal.'
          : e.code === 'refusal' ? e.message
          : 'Claude ist gerade nicht erreichbar (' + (e.message || 'Fehler') + ').';
      })
      .then(function () {
        busy = false;
        renderThread();
        lastError = null;
        var sh = $('askSheet');
        sh.scrollTop = sh.scrollHeight;
      });
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }

  D.Ask = {
    boot: function () {
      document.querySelectorAll('[data-open-ask]').forEach(function (b) {
        b.addEventListener('click', function () { D.Ask.open(); });
      });
      $('askSend').addEventListener('click', function () { send(); });
      $('askInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      });
      $('askClose').addEventListener('click', function () { D.closeSheet('askSheet'); });
      $('askReset').addEventListener('click', function () { thread = []; renderThread(); });
      $('askChips').querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          if (hasKey()) send(b.textContent);
          else { $('askInput').value = b.textContent; send(b.textContent); }
        });
      });
      $('askCopyCtx').addEventListener('click', function () {
        copy(buildContext()).then(function (ok) { D.toast(ok ? 'Daten kopiert' : 'Kopieren nicht möglich'); });
      });
    },
    open: function () {
      updateMode();
      renderThread();
      D.openSheet('askSheet');
      setTimeout(function () { if (window.innerWidth > 640) $('askInput').focus({ preventScroll: true }); }, 320);
    }
  };
})();
