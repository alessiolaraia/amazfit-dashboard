/* =====================================================================
   goals.js — Ziele: heute, morgen, Ticker, Rollover, Serie, Historie
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  var PREFIX = 'goals:';
  var STREAK_KEY = 'goal_streak_v1';
  var HISTORY_KEY = 'goal_history_v1';
  var COLLAPSE_LIMIT = 5;

  function todayKey() { return PREFIX + D.activeDate(); }
  function tomorrowKey() { return PREFIX + D.tomorrowDate(); }

  function getGoals(key) {
    var v = D.storeGet(key);
    if (!Array.isArray(v)) return [];
    var out = [];
    v.forEach(function (g) {
      if (g && typeof g.text === 'string' && g.text.trim()) {
        var item = { text: g.text, done: !!g.done };
        if (g.doneAt) item.doneAt = g.doneAt;
        if (g.queued) item.queued = true;
        out.push(item);
      }
    });
    return out;
  }
  function saveGoals(key, goals) { D.storeSet(key, goals); }
  D.getGoals = getGoals;
  D.todayGoalsKey = todayKey;

  /* ---------------- History (archived days) ---------------- */
  function history() {
    return D.memo('goalHistory', function () {
      var h = D.storeGet(HISTORY_KEY);
      return h && typeof h === 'object' ? h : {};
    });
  }
  function archiveDay(date, goals) {
    if (!goals.length) return;
    var h = D.storeGet(HISTORY_KEY) || {};
    h[date] = {
      t: goals.length,
      d: goals.filter(function (g) { return g.done; }).length,
      g: goals.map(function (g) { return [g.text, g.done ? 1 : 0]; })
    };
    D.storeSet(HISTORY_KEY, h);
    D.bump();
  }
  /* Day summary: archived history, or live data for today / un-rolled days. */
  function daySummary(date) {
    var live = D.storeGet(PREFIX + date);
    if (Array.isArray(live)) {
      var goals = getGoals(PREFIX + date);
      if (!goals.length) return null;
      return {
        t: goals.length,
        d: goals.filter(function (g) { return g.done; }).length,
        g: goals.map(function (g) { return [g.text, g.done ? 1 : 0]; }),
        live: true
      };
    }
    return history()[date] || null;
  }
  D.goalDaySummary = daySummary;
  D.goalRatioOn = function (date) {
    var s = daySummary(date);
    return s && s.t > 0 ? Math.round(s.d / s.t * 100) : null;
  };
  D.goalDates = function () {
    var set = {};
    Object.keys(history()).forEach(function (d) { set[d] = true; });
    D.storeListKeys(PREFIX).forEach(function (k) {
      var d = k.slice(PREFIX.length);
      if (d <= D.activeDate()) set[d] = true;
    });
    return Object.keys(set).sort();
  };

  /* ---------------- Streak + rollover ---------------- */
  function runStreakCheck() {
    var active = D.activeDate();
    var st = D.storeGet(STREAK_KEY) || {};
    var count = typeof st.count === 'number' && st.count >= 0 ? st.count : 0;
    var last = typeof st.lastProcessedDate === 'string' ? st.lastProcessedDate : null;
    var dates = D.storeListKeys(PREFIX)
      .map(function (k) { return k.slice(PREFIX.length); })
      .filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d) && d < active && (!last || d > last); })
      .sort();
    if (!dates.length) return;
    dates.forEach(function (d) {
      var goals = getGoals(PREFIX + d);
      if (goals.length) {
        if (goals.every(function (g) { return g.done; })) count += 1;
        else count = 0;
      }
      last = d;
    });
    D.storeSet(STREAK_KEY, { count: count, lastProcessedDate: last });
  }

  function runRollover() {
    var active = D.activeDate();
    var oldKeys = D.storeListKeys(PREFIX).filter(function (k) { return k.slice(PREFIX.length) < active; }).sort();
    if (!oldKeys.length) return;
    var tk = PREFIX + active;
    var today = getGoals(tk);
    var seen = {};
    today.forEach(function (g) { seen[g.text] = true; });
    var changed = false;
    oldKeys.forEach(function (k) {
      var goals = getGoals(k);
      archiveDay(k.slice(PREFIX.length), goals);
      goals.forEach(function (g) {
        if (!g.done && !seen[g.text]) {
          var item = { text: g.text, done: false };
          if (g.queued) item.queued = true;
          today.push(item);
          seen[g.text] = true;
          changed = true;
        }
      });
    });
    if (changed) saveGoals(tk, today);
    oldKeys.forEach(function (k) { D.storeDelete(k); });
  }

  function longestStreak() {
    var dates = D.goalDates();
    var best = 0, cur = 0;
    dates.forEach(function (d) {
      if (d >= D.activeDate()) return;
      var s = daySummary(d);
      if (!s || !s.t) return;
      if (s.d === s.t) { cur++; best = Math.max(best, cur); } else cur = 0;
    });
    return best;
  }

  /* ---------------- Rendering: today / tomorrow lists ---------------- */
  var expanded = {};
  var justChecked = null;
  var dragState = null;
  var touchDrag = null;

  function streakCount() {
    var st = D.storeGet(STREAK_KEY) || {};
    return typeof st.count === 'number' && st.count > 0 ? st.count : 0;
  }

  function renderTodayHeader() {
    var goals = getGoals(todayKey());
    var total = goals.length;
    var done = goals.filter(function (g) { return g.done; }).length;
    $('todayLabel').textContent = 'Heute — ' + D.fmtDay(D.activeDate());
    $('gmProgressNum').textContent = done;
    $('gmProgressTotal').textContent = '/ ' + total;
    var allDone = total > 0 && done === total;
    $('gmProgressLabel').textContent = total === 0 ? 'noch keine Ziele' : (allDone ? 'alles erledigt — starker Tag' : 'erledigt');
    var bar = $('gmBar');
    bar.innerHTML = '';
    goals.forEach(function (g) { bar.appendChild(el('div', 'gm-bar-seg' + (g.done ? ' gm-bar-seg-done' : ''))); });
    $('gmTodayCard').classList.toggle('gm-all-done', allDone);
    var pending = total - done;
    var push = $('gmPushBtn');
    push.hidden = pending === 0;
    push.textContent = '→ ' + pending + ' offene' + (pending === 1 ? 's Ziel' : ' Ziele') + ' auf morgen verschieben';
  }

  function renderStreak() {
    var count = streakCount();
    $('gmStreakNum').textContent = count;
    $('gmStreak').classList.toggle('gm-streak-active', count > 0);
    $('gmStreakLabel').textContent = count === 1 ? 'Tag Serie' : 'Tage Serie';
  }

  function renderTomorrowCount() {
    var n = getGoals(tomorrowKey()).length;
    $('tomorrowLabel').textContent = 'Morgen planen — ' + D.fmtDay(D.tomorrowDate());
    $('gmTomorrowCount').textContent = n + ' geplant';
  }

  function renderListInto(goals, listEl, emptyEl, key, readOnly) {
    var reload = readOnly ? loadTomorrow : loadToday;
    listEl.innerHTML = '';
    emptyEl.style.display = goals.length ? 'none' : '';
    var showAll = !!expanded[listEl.id] || goals.length <= COLLAPSE_LIMIT;
    for (var i = 0; i < goals.length; i++) {
      if (!showAll && i >= COLLAPSE_LIMIT) break;
      listEl.appendChild(buildGoalRow(goals[i], i, key, readOnly, listEl));
    }
    if (goals.length > COLLAPSE_LIMIT) {
      var more = el('li', 'gm-more', showAll ? 'Weniger anzeigen ▴' : (goals.length - COLLAPSE_LIMIT) + ' weitere anzeigen ▾');
      more.setAttribute('role', 'button');
      more.tabIndex = 0;
      var toggle = function () { expanded[listEl.id] = !showAll; reload(); };
      more.addEventListener('click', toggle);
      more.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      listEl.appendChild(more);
    }
    justChecked = null;
    if (readOnly) renderTomorrowCount(); else renderTodayHeader();
  }

  function loadToday() {
    var k = todayKey();
    renderListInto(getGoals(k), $('goalList'), $('emptyState'), k, false);
  }
  function loadTomorrow() {
    var k = tomorrowKey();
    renderListInto(getGoals(k), $('tomorrowList'), $('tomorrowEmpty'), k, true);
  }

  function makeCheck(checked, disabled, label) {
    var check = el('label', 'goal-check');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.setAttribute('aria-label', label);
    if (disabled) {
      cb.disabled = true;
      check.title = 'Wird morgen um 6 Uhr aktiv';
      cb.title = 'Wird morgen um 6 Uhr aktiv';
    }
    check.appendChild(cb);
    check.appendChild(el('span', 'goal-check-box'));
    return { wrap: check, input: cb };
  }

  function setDone(key, idx, on) {
    var goals = getGoals(key);
    if (!goals[idx]) return;
    goals[idx].done = on;
    if (on) { goals[idx].doneAt = Date.now(); justChecked = { key: key, idx: idx }; }
    else delete goals[idx].doneAt;
    saveGoals(key, goals);
  }

  function buildGoalRow(goal, idx, key, readOnly, listEl) {
    var reload = readOnly ? loadTomorrow : loadToday;
    var cls = 'goal-item';
    if (goal.done) cls += ' done';
    if (goal.queued && !readOnly && !goal.done) cls += ' queued';
    if (justChecked && justChecked.key === key && justChecked.idx === idx) cls += ' just-checked';
    var li = el('li', cls);
    li.dataset.idx = String(idx);

    var handle = el('span', 'goal-drag', '⋮⋮');
    handle.title = 'Ziehen zum Sortieren';
    handle.setAttribute('aria-hidden', 'true');

    var check = makeCheck(goal.done, readOnly, '„' + goal.text + '“ als erledigt markieren');
    var text = el('span', 'goal-text', goal.text);
    text.title = 'Tippen zum Bearbeiten';

    var q = el('button', 'row-btn gm-queue-btn' + (goal.queued && !readOnly ? ' is-active' : ''), '⚡');
    q.type = 'button';
    q.title = readOnly ? 'Wird morgen um 6 Uhr aktiv' : (goal.queued ? 'Priorität – für dein Fokusfenster vorgemerkt' : 'Als Priorität vormerken');
    q.setAttribute('aria-label', 'Als Priorität vormerken');
    q.setAttribute('aria-pressed', goal.queued && !readOnly ? 'true' : 'false');
    if (readOnly) q.disabled = true;

    var del = el('button', 'row-btn goal-delete', '×');
    del.type = 'button';
    del.title = 'Löschen';
    del.setAttribute('aria-label', '„' + goal.text + '“ löschen');

    li.appendChild(handle);
    li.appendChild(check.wrap);
    li.appendChild(text);
    li.appendChild(q);
    li.appendChild(del);

    if (!readOnly) {
      check.input.addEventListener('change', function () {
        setDone(key, idx, check.input.checked);
        reload();
      });
      q.addEventListener('click', function (e) {
        e.stopPropagation();
        var goals = getGoals(key);
        if (!goals[idx]) return;
        if (goals[idx].queued) delete goals[idx].queued; else goals[idx].queued = true;
        saveGoals(key, goals);
        li.classList.toggle('queued', !!goals[idx].queued && !goals[idx].done);
        q.classList.toggle('is-active', !!goals[idx].queued);
        li.classList.remove('is-queue-flashing');
        void li.offsetWidth;
        li.classList.add('is-queue-flashing');
        setTimeout(reload, 480);
      });
    }

    del.addEventListener('click', function (e) {
      e.stopPropagation();
      var goals = getGoals(key);
      if (!goals[idx]) return;
      var removed = goals.splice(idx, 1)[0];
      saveGoals(key, goals);
      reload();
      D.toast('„' + removed.text + '“ gelöscht', {
        label: 'Rückgängig',
        fn: function () {
          var g = getGoals(key);
          g.splice(Math.min(idx, g.length), 0, removed);
          saveGoals(key, g);
          reload();
        }
      });
    });

    makeInlineEdit(text, key, idx, reload);
    wireDragReorder(li, handle, key, idx, reload, listEl);
    return li;
  }

  function placeCaretAtEnd(node) {
    try {
      var range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }

  function makeInlineEdit(textEl, key, idx, reload) {
    textEl.addEventListener('click', function () {
      if (textEl.isContentEditable) return;
      var original = textEl.textContent;
      var finished = false;
      textEl.contentEditable = 'true';
      textEl.classList.add('editing');
      textEl.focus();
      placeCaretAtEnd(textEl);
      function finish(commit) {
        if (finished) return;
        finished = true;
        textEl.removeEventListener('keydown', onKey);
        textEl.removeEventListener('blur', onBlur);
        textEl.contentEditable = 'false';
        textEl.classList.remove('editing');
        var next = textEl.textContent.replace(/\s+/g, ' ').trim();
        if (commit && next && next !== original) {
          var goals = getGoals(key);
          if (goals[idx]) { goals[idx].text = next.slice(0, 200); saveGoals(key, goals); }
          reload();
        } else {
          textEl.textContent = original;
        }
      }
      function onKey(e) {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      }
      function onBlur() { finish(true); }
      textEl.addEventListener('keydown', onKey);
      textEl.addEventListener('blur', onBlur);
    });
  }

  function clearDragIndicators(listEl) {
    listEl.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(function (n) {
      n.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  }
  function moveGoal(key, from, to) {
    if (from === to || from == null || to == null) return false;
    var goals = getGoals(key);
    if (from < 0 || from >= goals.length || to < 0 || to >= goals.length) return false;
    var item = goals.splice(from, 1)[0];
    goals.splice(to, 0, item);
    saveGoals(key, goals);
    return true;
  }
  function markDropTarget(row, from) {
    var to = +row.dataset.idx;
    row.classList.add(from < to ? 'drag-over-bottom' : 'drag-over-top');
  }

  function wireDragReorder(li, handle, key, idx, reload, listEl) {
    handle.addEventListener('mousedown', function () { li.draggable = true; });
    handle.addEventListener('mouseup', function () { li.draggable = false; });
    li.addEventListener('dragstart', function (e) {
      if (!li.draggable) { e.preventDefault(); return; }
      dragState = { key: key, from: idx };
      li.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch (err) {}
    });
    li.addEventListener('dragend', function () {
      li.draggable = false;
      li.classList.remove('dragging');
      clearDragIndicators(listEl);
      dragState = null;
    });
    li.addEventListener('dragover', function (e) {
      if (!dragState || dragState.key !== key) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
      clearDragIndicators(listEl);
      if (dragState.from !== idx) markDropTarget(li, dragState.from);
    });
    li.addEventListener('dragleave', function (e) {
      if (!li.contains(e.relatedTarget)) li.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    li.addEventListener('drop', function (e) {
      if (!dragState || dragState.key !== key) return;
      e.preventDefault();
      var from = dragState.from;
      dragState = null;
      clearDragIndicators(listEl);
      if (moveGoal(key, from, idx)) reload();
    });

    handle.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      touchDrag = { key: key, from: idx, over: null };
      li.classList.add('dragging');
    }, { passive: false });
    handle.addEventListener('touchmove', function (e) {
      if (!touchDrag) return;
      e.preventDefault();
      var t = e.touches[0];
      if (t.clientY < 70) window.scrollBy(0, -10);
      else if (t.clientY > window.innerHeight - 90) window.scrollBy(0, 10);
      var target = document.elementFromPoint(t.clientX, t.clientY);
      var row = target && target.closest ? target.closest('.goal-item') : null;
      clearDragIndicators(listEl);
      if (row && row.parentNode === listEl && row !== li) {
        touchDrag.over = +row.dataset.idx;
        markDropTarget(row, touchDrag.from);
      } else if (row === li) {
        touchDrag.over = null;
      }
    }, { passive: false });
    function endTouch(commit) {
      if (!touchDrag) return;
      var st = touchDrag;
      touchDrag = null;
      li.classList.remove('dragging');
      clearDragIndicators(listEl);
      if (commit && st.over != null && moveGoal(key, st.from, st.over)) reload();
    }
    handle.addEventListener('touchend', function () { endTouch(true); });
    handle.addEventListener('touchcancel', function () { endTouch(false); });
  }

  function pushRemaining() {
    var tk = todayKey();
    var goals = getGoals(tk);
    var pending = goals.filter(function (g) { return !g.done; });
    if (!pending.length) return;
    var msg = pending.length + ' offene' + (pending.length === 1 ? 's Ziel' : ' Ziele') + ' auf morgen verschieben?';
    if (!window.confirm(msg)) return;
    var nk = tomorrowKey();
    var tomorrow = getGoals(nk);
    var seen = {};
    tomorrow.forEach(function (g) { seen[g.text] = true; });
    pending.forEach(function (g) {
      if (!seen[g.text]) {
        var item = { text: g.text, done: false };
        if (g.queued) item.queued = true;
        tomorrow.push(item);
        seen[g.text] = true;
      }
    });
    saveGoals(nk, tomorrow);
    saveGoals(tk, goals.filter(function (g) { return g.done; }));
    loadToday();
    loadTomorrow();
  }

  /* Add + Polish (Polieren) */
  function makeAddHandlers(input, addBtn, polishBtn, keyFn, statusEl, reload) {
    var timer = null;
    function flash(msg, isError) {
      clearTimeout(timer);
      statusEl.textContent = msg;
      statusEl.classList.toggle('is-error', !!isError);
      timer = setTimeout(function () { statusEl.textContent = ''; statusEl.classList.remove('is-error'); }, 3500);
    }
    function pushGoal(text) {
      var k = keyFn();
      var goals = getGoals(k);
      goals.push({ text: text.slice(0, 200), done: false });
      saveGoals(k, goals);
      input.value = '';
      reload();
    }
    addBtn.addEventListener('click', function () {
      var t = input.value.replace(/\s+/g, ' ').trim();
      if (!t) { input.focus(); return; }
      pushGoal(t);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addBtn.click(); }
    });
    if (!polishBtn) return;
    polishBtn.addEventListener('click', function () {
      var raw = input.value.replace(/\s+/g, ' ').trim();
      if (!raw) { input.focus(); return; }
      if (!D.getSettings().anthropicKey) {
        pushGoal(raw);
        flash('Polieren braucht einen Anthropic-API-Schlüssel (⚙ Einstellungen) — so übernommen.', false);
        return;
      }
      polishBtn.disabled = true;
      addBtn.disabled = true;
      clearTimeout(timer);
      statusEl.classList.remove('is-error');
      statusEl.textContent = 'Wird poliert…';
      var prompt =
        'Clean up exactly ONE to-do goal. Fix spelling and grammar, make it concise and action-oriented ' +
        '(start with a verb when natural), keep the original language and meaning, and do not add new details. ' +
        'Return ONLY a JSON array containing exactly one string — no preamble, no explanation, no code fences.\n\n' +
        'Goal: ' + raw;
      D.callClaude({ model: 'claude-sonnet-5-5', maxTokens: 1000, effort: 'low', messages: [{ role: 'user', content: prompt }] })
        .then(function (res) {
          var txt = res.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          var arr = JSON.parse(txt);
          if (!Array.isArray(arr) || typeof arr[0] !== 'string' || !arr[0].trim()) throw new Error('bad shape');
          pushGoal(arr[0].replace(/\s+/g, ' ').trim());
          statusEl.textContent = '';
        })
        .catch(function () {
          pushGoal(raw);
          flash('Polieren fehlgeschlagen — so übernommen.', true);
        })
        .then(function () { polishBtn.disabled = false; addBtn.disabled = false; });
    });
  }

  /* ---------------- Ticker ---------------- */
  var Ticker = (function () {
    var cycleIdx = 0, first = true, timer = null, lastSig = '';
    function buildItems() {
      var goals = getGoals(todayKey());
      var total = goals.length;
      var done = goals.filter(function (g) { return g.done; }).length;
      var items;
      if (total === 0) items = [{ status: 'empty', text: 'Keine Ziele für heute — leg eins an.' }];
      else if (done === total) items = [{ status: 'done', text: '✓ Alle Ziele erledigt — starker Tag.' }];
      else items = goals.filter(function (g) { return !g.done; }).map(function (g) { return { status: 'pending', text: g.text }; });
      return { items: items, done: done, total: total };
    }
    function glyph(s) { return s === 'done' ? '✓' : (s === 'pending' ? '○' : '·'); }
    function makeRow(item) {
      var row = el('div', 'goal-ticker-row');
      var st = el('span', 'goal-ticker-status', glyph(item.status));
      st.setAttribute('data-status', item.status);
      var text = item.text;
      if (item.status === 'done') text = text.replace(/^✓\s*/, '');
      row.appendChild(st);
      row.appendChild(el('span', 'goal-ticker-text', text));
      return row;
    }
    function tick(force) {
      var stage = $('goalTickerStage');
      var data = buildItems();
      var items = data.items;
      if (cycleIdx >= items.length) cycleIdx = 0;
      var item = items[cycleIdx];
      cycleIdx = (cycleIdx + 1) % items.length;
      $('goalTickerMeta').textContent = data.done + '/' + data.total;
      var sig = item.status + '|' + item.text;
      if (!force && !first && items.length === 1 && sig === lastSig) return;
      lastSig = sig;
      var row = makeRow(item);
      var current = stage.querySelectorAll('.goal-ticker-row:not(.is-leaving)');
      if (first) {
        current.forEach(function (c) { c.remove(); });
        first = false;
      } else {
        current.forEach(function (old) {
          old.classList.remove('is-entering');
          old.classList.add('is-leaving');
          setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 460);
        });
        row.classList.add('is-entering');
      }
      stage.appendChild(row);
    }
    function restart() { clearInterval(timer); timer = setInterval(function () { tick(false); }, 5000); }
    function start() {
      tick(true);
      restart();
      D.on('goals', function () { cycleIdx = 0; tick(true); restart(); });
    }
    return { start: start };
  })();

  /* ---------------- Compact card on "Heute" ---------------- */
  function renderMini() {
    var key = todayKey();
    var goals = getGoals(key);
    var done = goals.filter(function (g) { return g.done; }).length;
    $('miniGoalsNum').innerHTML = done + '<span>/ ' + goals.length + '</span>';
    var streak = streakCount();
    $('miniGoalsStreak').textContent = streak > 0 ? '⚡ ' + streak + (streak === 1 ? ' Tag Serie' : ' Tage Serie') : '';
    var list = $('miniGoalsList');
    list.innerHTML = '';
    var shown = goals.map(function (g, i) { return { g: g, i: i }; })
      .sort(function (a, b) { return (a.g.done - b.g.done) || ((b.g.queued ? 1 : 0) - (a.g.queued ? 1 : 0)) || (a.i - b.i); })
      .slice(0, 5);
    shown.forEach(function (x) {
      var li = el('li', x.g.done ? 'done' : '');
      var c = makeCheck(x.g.done, false, '„' + x.g.text + '“ als erledigt markieren');
      c.input.addEventListener('change', function () {
        setDone(key, x.i, c.input.checked);
        loadToday();
      });
      li.appendChild(c.wrap);
      li.appendChild(el('span', 't', (x.g.queued && !x.g.done ? '⚡ ' : '') + x.g.text));
      list.appendChild(li);
    });
    $('miniGoalsEmpty').hidden = goals.length > 0;
    var more = goals.length - shown.length;
    $('miniGoalsMore').textContent = more > 0 ? '+' + more + ' weitere · Alle Ziele →' : 'Alle Ziele →';
  }

  /* ---------------- Heatmap + stats ---------------- */
  var selectedDay = null;
  function cellColor(s) {
    if (!s || !s.t) return 'rgba(255,255,255,0.04)';
    var r = s.d / s.t;
    if (r >= 1) return '#6BE3A4';
    if (r === 0) return 'rgba(255,107,107,0.30)';
    return 'rgba(107,227,164,' + (0.18 + r * 0.45).toFixed(2) + ')';
  }
  function renderHistory() {
    var wrap = $('goalHeatmap');
    if (!wrap) return;
    var today = D.activeDate();
    var weeks = window.innerWidth >= 720 ? 26 : 16;
    var start = D.shift(D.mondayOf(today), -7 * (weeks - 1));
    var days = D.dateRange(start, D.shift(D.mondayOf(today), 6));
    wrap.innerHTML = '';
    days.forEach(function (d) {
      var s = d <= today ? daySummary(d) : null;
      var c = el('button', 'hm-cell');
      c.type = 'button';
      c.style.background = cellColor(s);
      if (d > today) { c.classList.add('is-future'); c.disabled = true; }
      if (d === today) c.classList.add('is-today');
      if (d === selectedDay) c.classList.add('is-selected');
      c.title = D.fmtDay(d) + (s ? ' · ' + s.d + '/' + s.t + ' erledigt' : ' · keine Ziele');
      c.setAttribute('aria-label', c.title);
      c.addEventListener('click', function () { selectedDay = selectedDay === d ? null : d; renderHistory(); });
      wrap.appendChild(c);
    });
    var wrapEl = wrap.parentNode;
    if (!wrapEl._scrolled) { wrapEl.scrollLeft = wrapEl.scrollWidth; wrapEl._scrolled = true; }

    // Stats
    var last30 = D.dateRange(D.shift(today, -29), today);
    var tot = 0, dn = 0, daysWith = 0, perfect = 0;
    last30.forEach(function (d) {
      var s = daySummary(d);
      if (s && s.t) { tot += s.t; dn += s.d; daysWith++; if (s.d === s.t) perfect++; }
    });
    $('ghRate').innerHTML = tot ? Math.round(dn / tot * 100) + '<small>%</small>' : '—';
    $('ghPerfect').innerHTML = perfect + '<small>/ ' + daysWith + '</small>';
    $('ghStreak').textContent = streakCount();
    $('ghBest').textContent = Math.max(longestStreak(), streakCount());

    var det = $('goalDayDetail');
    if (selectedDay) {
      var s = daySummary(selectedDay);
      det.hidden = false;
      det.innerHTML = '';
      det.appendChild(el('strong', null, D.fmtDayLong(selectedDay)));
      if (!s) { det.appendChild(el('div', 'muted small', 'An diesem Tag waren keine Ziele eingetragen.')); return; }
      det.appendChild(el('span', 'muted', ' · ' + s.d + ' von ' + s.t + ' erledigt'));
      var ul = el('ul');
      (s.g || []).forEach(function (g) { ul.appendChild(el('li', g[1] ? 'done' : '', g[0])); });
      det.appendChild(ul);
    } else {
      det.hidden = true;
    }
  }

  /* ---------------- Public API ---------------- */
  D.Goals = {
    boot: function () {
      runStreakCheck();
      runRollover();
      makeAddHandlers($('goalInput'), $('goalAddBtn'), $('goalPolishBtn'), todayKey, $('polishStatus'), loadToday);
      makeAddHandlers($('tomorrowInput'), $('tomorrowAddBtn'), $('tomorrowPolishBtn'), tomorrowKey, $('tomorrowStatus'), loadTomorrow);
      makeAddHandlers($('miniGoalInput'), $('miniGoalAddBtn'), null, todayKey, $('miniGoalStatus'), loadToday);
      $('gmPushBtn').addEventListener('click', pushRemaining);
      loadToday();
      loadTomorrow();
      renderStreak();
      renderMini();
      Ticker.start();
      D.on('goals', function () { renderMini(); renderHistory(); });
    },
    renderHistory: renderHistory,
    renderAll: function () { loadToday(); loadTomorrow(); renderStreak(); renderMini(); renderHistory(); },
    dayChanged: function () {
      runStreakCheck();
      runRollover();
      D.bump();
      loadToday();
      loadTomorrow();
      renderStreak();
      renderMini();
      renderHistory();
    },
    seedDemo: function () {
      if (!D.DEMO || D.storeGet('demo_seeded_goals')) return;
      var texts = ['30 Min lesen', 'Workout', 'Ernährungsplan', 'E-Mails beantworten', 'Spaziergang', 'Bachelorarbeit 2 Std', 'Wasser 2 L', 'Meditieren', 'Zimmer aufräumen'];
      var h = {};
      var today = D.activeDate();
      var seed = 7;
      function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
      for (var i = 150; i >= 1; i--) {
        var d = D.shift(today, -i);
        if (rnd() < 0.12) continue;
        var t = 2 + Math.floor(rnd() * 4);
        var skill = 0.55 + (150 - i) / 150 * 0.35;
        var g = [];
        for (var j = 0; j < t; j++) g.push([texts[Math.floor(rnd() * texts.length)], rnd() < skill ? 1 : 0]);
        h[d] = { t: t, d: g.filter(function (x) { return x[1]; }).length, g: g };
      }
      D.storeSet(HISTORY_KEY, h);
      var streak = 0;
      for (var k = 1; k < 150; k++) {
        var s = h[D.shift(today, -k)];
        if (!s) continue;
        if (s.d === s.t) streak++; else break;
      }
      D.storeSet(STREAK_KEY, { count: streak, lastProcessedDate: D.shift(today, -1) });
      saveGoals(PREFIX + today, [
        { text: 'Bachelorarbeit: Kapitel 3 überarbeiten', done: true, doneAt: Date.now() },
        { text: 'Workout – Beine', done: false, queued: true },
        { text: '30 Min lesen', done: false },
        { text: 'Mama anrufen', done: true, doneAt: Date.now() }
      ]);
      saveGoals(PREFIX + D.tomorrowDate(), [{ text: 'Morgens laufen gehen', done: false }]);
      D.storeSet('demo_seeded_goals', true);
      D.bump();
    }
  };
})();
