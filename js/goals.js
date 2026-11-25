/* =====================================================================
   goals.js — Ziele: Wochenziele, heute, morgen, Ticker, Rückblick
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  var PREFIX = 'goals:';
  var WPREFIX = 'weekgoals:';
  var STREAK_KEY = 'goal_streak_v1';
  var HISTORY_KEY = 'goal_history_v1';
  var COLLAPSE_LIMIT = 6;

  function todayKey() { return PREFIX + D.activeDate(); }
  function tomorrowKey() { return PREFIX + D.tomorrowDate(); }
  function thisMonday() { return D.mondayOf(D.activeDate()); }

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

  /* ---------------- Daily history ---------------- */
  function history() {
    return D.memo('goalHistory', function () {
      var h = D.storeGet(HISTORY_KEY);
      return h && typeof h === 'object' ? h : {};
    });
  }
  function archiveDay(date, goals) {
    if (!goals.length) return;
    var h = D.storeGet(HISTORY_KEY) || {};
    h[date] = { t: goals.length, d: goals.filter(function (g) { return g.done; }).length, g: goals.map(function (g) { return [g.text, g.done ? 1 : 0]; }) };
    D.storeSet(HISTORY_KEY, h);
  }
  function daySummary(date) {
    var live = D.storeGet(PREFIX + date);
    if (Array.isArray(live)) {
      var goals = getGoals(PREFIX + date);
      if (!goals.length) return null;
      return { t: goals.length, d: goals.filter(function (g) { return g.done; }).length };
    }
    return history()[date] || null;
  }

  /* ---------------- Streak + rollover (unchanged rules) ---------------- */
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
  function streakCount() {
    var st = D.storeGet(STREAK_KEY) || {};
    return typeof st.count === 'number' && st.count > 0 ? st.count : 0;
  }

  /* ---------------- Weekly goals ---------------- */
  function getWeek(monday) {
    var v = D.storeGet(WPREFIX + monday);
    if (!Array.isArray(v)) return [];
    return v.filter(function (g) { return g && typeof g.text === 'string' && g.text.trim(); }).map(function (g) {
      var target = Math.max(1, Math.min(14, Math.round(Number(g.target) || 1)));
      return { id: g.id || D.uid('w'), text: g.text, target: target, count: Math.max(0, Math.min(target, Math.round(Number(g.count) || 0))) };
    });
  }
  function saveWeek(monday, list) { D.storeSet(WPREFIX + monday, list); }
  D.weekGoals = function (monday) { return getWeek(monday || thisMonday()); };

  function renderWeekly() {
    var monday = thisMonday();
    var list = getWeek(monday);
    var done = list.filter(function (g) { return g.count >= g.target; }).length;
    $('wgTitle').textContent = 'KW ' + D.isoWeek(monday) + ' · ' + D.fmtDayMonth(monday) + ' – ' + D.fmtDayMonth(D.shift(monday, 6));
    $('wgProgress').textContent = list.length ? done + ' von ' + list.length + ' geschafft' : 'Noch keine Wochenziele';
    var wrap = $('wgList');
    wrap.innerHTML = '';
    $('wgEmpty').hidden = list.length > 0;
    list.forEach(function (g, idx) {
      var row = el('li', 'wg-item' + (g.count >= g.target ? ' done' : ''));
      if (g.target === 1) {
        var c = makeCheck(g.count >= 1, false, '„' + g.text + '“ erledigt');
        c.input.addEventListener('change', function () { update(idx, c.input.checked ? 1 : 0); });
        row.appendChild(c.wrap);
      }
      var main = el('div', 'wg-main');
      main.appendChild(el('div', 'wg-text', g.text));
      if (g.target > 1) {
        var pips = el('div', 'wg-pips');
        for (var i = 0; i < g.target; i++) pips.appendChild(el('i', i < g.count ? 'on' : ''));
        pips.appendChild(el('span', 'wg-count', g.count + '/' + g.target));
        main.appendChild(pips);
      }
      row.appendChild(main);
      if (g.target > 1) {
        var st = el('div', 'stepper');
        var minus = el('button', 'icon-btn', '−');
        minus.type = 'button';
        minus.setAttribute('aria-label', 'Eins weniger');
        minus.disabled = g.count <= 0;
        minus.addEventListener('click', function () { update(idx, g.count - 1); });
        var plus = el('button', 'icon-btn dark', '+');
        plus.type = 'button';
        plus.setAttribute('aria-label', 'Eins mehr');
        plus.disabled = g.count >= g.target;
        plus.addEventListener('click', function () { update(idx, g.count + 1); });
        st.appendChild(minus);
        st.appendChild(plus);
        row.appendChild(st);
      }
      var del = el('button', 'row-btn goal-delete', '×');
      del.type = 'button';
      del.setAttribute('aria-label', '„' + g.text + '“ löschen');
      del.addEventListener('click', function () {
        var l = getWeek(monday);
        var removed = l.splice(idx, 1)[0];
        saveWeek(monday, l);
        renderWeekly();
        D.toast('Wochenziel gelöscht', { label: 'Rückgängig', fn: function () { var x = getWeek(monday); x.splice(idx, 0, removed); saveWeek(monday, x); renderWeekly(); } });
      });
      row.appendChild(del);
      wrap.appendChild(row);
    });
    function update(idx, count) {
      var l = getWeek(monday);
      if (!l[idx]) return;
      var wasDone = l[idx].count >= l[idx].target;
      l[idx].count = Math.max(0, Math.min(l[idx].target, count));
      saveWeek(monday, l);
      renderWeekly();
      if (!wasDone && l[idx].count >= l[idx].target) D.toast('Wochenziel geschafft 🎉');
    }
    var prev = getWeek(D.shift(monday, -7));
    var copyBtn = $('wgCopyBtn');
    copyBtn.hidden = list.length > 0 || prev.length === 0;
    copyBtn.textContent = 'Ziele von letzter Woche übernehmen (' + prev.length + ')';
    renderMini();
  }
  function addWeekly() {
    var input = $('wgInput');
    var text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) { input.focus(); return; }
    var monday = thisMonday();
    var l = getWeek(monday);
    l.push({ id: D.uid('w'), text: text.slice(0, 120), target: Number($('wgTarget').value) || 1, count: 0 });
    saveWeek(monday, l);
    input.value = '';
    renderWeekly();
  }

  /* ---------------- Daily lists ---------------- */
  var expanded = {};
  var justChecked = null;
  var dragState = null;
  var touchDrag = null;

  function renderTodayHeader() {
    var goals = getGoals(todayKey());
    var total = goals.length;
    var done = goals.filter(function (g) { return g.done; }).length;
    $('todayLabel').textContent = D.fmtDayLong(D.activeDate());
    $('gmProgressNum').textContent = done;
    $('gmProgressTotal').textContent = total;
    var allDone = total > 0 && done === total;
    $('gmProgressLabel').textContent = total === 0 ? 'Noch keine Ziele für heute' : (allDone ? 'Alles erledigt — starker Tag 🎉' : 'erledigt');
    var bar = $('gmBar');
    bar.innerHTML = '';
    goals.forEach(function (g) { bar.appendChild(el('i', g.done ? 'on' : '')); });
    var pending = total - done;
    var push = $('gmPushBtn');
    push.hidden = pending === 0;
    push.textContent = '→ ' + pending + ' offene' + (pending === 1 ? 's Ziel' : ' Ziele') + ' auf morgen verschieben';
    var s = streakCount();
    var sb = $('gmStreak');
    sb.textContent = '⚡ ' + s + (s === 1 ? ' Tag' : ' Tage') + ' in Folge';
    sb.classList.toggle('is-active', s > 0);
    sb.title = 'Tage in Folge, an denen du alle Tagesziele erledigt hast';
  }
  function renderTomorrowCount() {
    var n = getGoals(tomorrowKey()).length;
    $('tomorrowLabel').textContent = 'Morgen · ' + D.fmtDay(D.tomorrowDate());
    $('gmTomorrowCount').textContent = n ? n + ' geplant' : '';
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
      var more = el('li', 'gm-more', showAll ? 'Weniger anzeigen' : (goals.length - COLLAPSE_LIMIT) + ' weitere anzeigen');
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
    renderMini();
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
    q.title = readOnly ? 'Wird morgen um 6 Uhr aktiv' : 'Als wichtig markieren';
    q.setAttribute('aria-label', 'Als wichtig markieren');
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
      check.input.addEventListener('change', function () { setDone(key, idx, check.input.checked); reload(); });
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
      D.toast('„' + removed.text + '“ gelöscht', { label: 'Rückgängig', fn: function () { var g = getGoals(key); g.splice(Math.min(idx, g.length), 0, removed); saveGoals(key, g); reload(); } });
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
        } else textEl.textContent = original;
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
    listEl.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(function (n) { n.classList.remove('drag-over-top', 'drag-over-bottom'); });
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
  function markDropTarget(row, from) { row.classList.add(from < +row.dataset.idx ? 'drag-over-bottom' : 'drag-over-top'); }
  function wireDragReorder(li, handle, key, idx, reload, listEl) {
    handle.addEventListener('mousedown', function () { li.draggable = true; });
    handle.addEventListener('mouseup', function () { li.draggable = false; });
    li.addEventListener('dragstart', function (e) {
      if (!li.draggable) { e.preventDefault(); return; }
      dragState = { key: key, from: idx };
      li.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch (err) {}
    });
    li.addEventListener('dragend', function () { li.draggable = false; li.classList.remove('dragging'); clearDragIndicators(listEl); dragState = null; });
    li.addEventListener('dragover', function (e) {
      if (!dragState || dragState.key !== key) return;
      e.preventDefault();
      clearDragIndicators(listEl);
      if (dragState.from !== idx) markDropTarget(li, dragState.from);
    });
    li.addEventListener('dragleave', function (e) { if (!li.contains(e.relatedTarget)) li.classList.remove('drag-over-top', 'drag-over-bottom'); });
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
      touchDrag = { from: idx, over: null };
      li.classList.add('dragging');
    }, { passive: false });
    handle.addEventListener('touchmove', function (e) {
      if (!touchDrag) return;
      e.preventDefault();
      var t = e.touches[0];
      if (t.clientY < 70) window.scrollBy(0, -10);
      else if (t.clientY > window.innerHeight - 100) window.scrollBy(0, 10);
      var target = document.elementFromPoint(t.clientX, t.clientY);
      var row = target && target.closest ? target.closest('.goal-item') : null;
      clearDragIndicators(listEl);
      if (row && row.parentNode === listEl && row !== li) { touchDrag.over = +row.dataset.idx; markDropTarget(row, touchDrag.from); }
      else if (row === li) touchDrag.over = null;
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
    if (!window.confirm(pending.length + ' offene' + (pending.length === 1 ? 's Ziel' : ' Ziele') + ' auf morgen verschieben?')) return;
    var nk = tomorrowKey();
    var tomorrow = getGoals(nk);
    var seen = {};
    tomorrow.forEach(function (g) { seen[g.text] = true; });
    pending.forEach(function (g) {
      if (!seen[g.text]) { var item = { text: g.text, done: false }; if (g.queued) item.queued = true; tomorrow.push(item); seen[g.text] = true; }
    });
    saveGoals(nk, tomorrow);
    saveGoals(tk, goals.filter(function (g) { return g.done; }));
    loadToday();
    loadTomorrow();
  }

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
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addBtn.click(); } });
    if (!polishBtn) return;
    polishBtn.addEventListener('click', function () {
      var raw = input.value.replace(/\s+/g, ' ').trim();
      if (!raw) { input.focus(); return; }
      if (!D.getSettings().anthropicKey) {
        pushGoal(raw);
        flash('Polieren braucht einen Anthropic-Schlüssel (⚙ Einstellungen) — so übernommen.', false);
        return;
      }
      polishBtn.disabled = true;
      addBtn.disabled = true;
      statusEl.classList.remove('is-error');
      statusEl.textContent = 'Wird poliert…';
      var prompt =
        'Clean up exactly ONE to-do goal. Fix spelling and grammar, make it concise and action-oriented ' +
        '(start with a verb when natural), keep the original language and meaning, and do not add new details. ' +
        'Return ONLY a JSON array containing exactly one string — no preamble, no explanation, no code fences.\n\nGoal: ' + raw;
      D.callClaude({ model: 'claude-sonnet-5-5', maxTokens: 1000, effort: 'low', messages: [{ role: 'user', content: prompt }] })
        .then(function (res) {
          var txt = res.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          var arr = JSON.parse(txt);
          if (!Array.isArray(arr) || typeof arr[0] !== 'string' || !arr[0].trim()) throw new Error('bad shape');
          pushGoal(arr[0].replace(/\s+/g, ' ').trim());
          statusEl.textContent = '';
        })
        .catch(function () { pushGoal(raw); flash('Polieren fehlgeschlagen — so übernommen.', true); })
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
      var row = el('div', 'goal-ticker-row');
      var st = el('span', 'goal-ticker-status', glyph(item.status));
      st.setAttribute('data-status', item.status);
      row.appendChild(st);
      row.appendChild(el('span', 'goal-ticker-text', item.status === 'done' ? item.text.replace(/^✓\s*/, '') : item.text));
      var current = stage.querySelectorAll('.goal-ticker-row:not(.is-leaving)');
      if (first) { current.forEach(function (c) { c.remove(); }); first = false; }
      else {
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
    return {
      start: function () {
        tick(true);
        restart();
        D.on('goals', function () { cycleIdx = 0; tick(true); restart(); });
      }
    };
  })();

  /* ---------------- Compact card on "Heute" ---------------- */
  function renderMini() {
    var key = todayKey();
    var goals = getGoals(key);
    var done = goals.filter(function (g) { return g.done; }).length;
    $('miniGoalsNum').innerHTML = done + '<small>von ' + goals.length + '</small>';
    var list = $('miniGoalsList');
    list.innerHTML = '';
    var shown = goals.map(function (g, i) { return { g: g, i: i }; })
      .sort(function (a, b) { return (a.g.done - b.g.done) || ((b.g.queued ? 1 : 0) - (a.g.queued ? 1 : 0)) || (a.i - b.i); })
      .slice(0, 4);
    shown.forEach(function (x) {
      var li = el('li', 'goal-item' + (x.g.done ? ' done' : ''));
      var c = makeCheck(x.g.done, false, '„' + x.g.text + '“ als erledigt markieren');
      c.input.addEventListener('change', function () { setDone(key, x.i, c.input.checked); loadToday(); });
      li.appendChild(c.wrap);
      li.appendChild(el('span', 'goal-text', (x.g.queued && !x.g.done ? '⚡ ' : '') + x.g.text));
      list.appendChild(li);
    });
    $('miniGoalsEmpty').hidden = goals.length > 0;
    var more = goals.length - shown.length;
    $('miniGoalsMore').textContent = more > 0 ? '+' + more + ' weitere' : 'Alle Ziele';
    var wk = getWeek(thisMonday());
    var wkDone = wk.filter(function (g) { return g.count >= g.target; }).length;
    $('miniWeekLine').textContent = wk.length ? 'Wochenziele: ' + wkDone + ' von ' + wk.length + ' geschafft' : 'Noch keine Wochenziele — leg welche unter „Ziele“ an.';
  }

  /* ---------------- Weekly review ---------------- */
  function renderReview() {
    var wrap = $('reviewList');
    if (!wrap) return;
    wrap.innerHTML = '';
    var monday = thisMonday();
    for (var w = 0; w < 6; w++) {
      var mon = D.shift(monday, -7 * w);
      var days = D.weekDays(mon).filter(function (d) { return d <= D.activeDate(); });
      var t = 0, dn = 0;
      days.forEach(function (d) { var s = daySummary(d); if (s) { t += s.t; dn += s.d; } });
      var wk = getWeek(mon);
      var wkDone = wk.filter(function (g) { return g.count >= g.target; }).length;
      var row = el('div', 'review-row');
      var k = el('div', 'k', w === 0 ? 'Diese Woche' : 'KW ' + D.isoWeek(mon));
      k.appendChild(el('small', null, D.fmtDayMonth(mon) + ' – ' + D.fmtDayMonth(D.shift(mon, 6))));
      row.appendChild(k);
      var tr = el('div', 'track');
      var f = el('div', 'track-fill');
      f.style.width = (t ? Math.round(dn / t * 100) : 0) + '%';
      tr.appendChild(f);
      row.appendChild(tr);
      row.appendChild(el('div', 'v', (t ? dn + '/' + t + ' Tagesziele' : 'keine Tagesziele') + (wk.length ? ' · ' + wkDone + '/' + wk.length + ' Woche' : '')));
      wrap.appendChild(row);
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
      $('wgAddBtn').addEventListener('click', addWeekly);
      $('wgInput').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addWeekly(); } });
      $('wgCopyBtn').addEventListener('click', function () {
        var monday = thisMonday();
        var prev = getWeek(D.shift(monday, -7));
        saveWeek(monday, prev.map(function (g) { return { id: D.uid('w'), text: g.text, target: g.target, count: 0 }; }));
        renderWeekly();
      });
      loadToday();
      loadTomorrow();
      renderWeekly();
      renderReview();
      Ticker.start();
      D.on('goals', function () { renderMini(); renderReview(); });
    },
    render: function () { loadToday(); loadTomorrow(); renderWeekly(); renderReview(); },
    dayChanged: function () {
      runStreakCheck();
      runRollover();
      D.Goals.render();
    },
    weekSummary: function (monday) {
      var days = D.weekDays(monday);
      var t = 0, dn = 0;
      days.forEach(function (d) { var s = daySummary(d); if (s) { t += s.t; dn += s.d; } });
      return { total: t, done: dn };
    },
    seedDemo: function () {
      if (!D.DEMO || D.storeGet('demo_seeded_goals2')) return;
      var texts = ['30 Min lesen', 'Workout', 'Vorlesung nacharbeiten', 'E-Mails beantworten', 'Spaziergang', 'Bachelorarbeit 2 Std', 'Wasser 2 L', 'Zimmer aufräumen'];
      var h = {};
      var today = D.activeDate();
      var seed = 7;
      function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
      for (var i = 60; i >= 1; i--) {
        var d = D.shift(today, -i);
        if (rnd() < 0.15) continue;
        var t = 2 + Math.floor(rnd() * 4);
        var g = [];
        for (var j = 0; j < t; j++) g.push([texts[Math.floor(rnd() * texts.length)], rnd() < 0.72 ? 1 : 0]);
        h[d] = { t: t, d: g.filter(function (x) { return x[1]; }).length, g: g };
      }
      D.storeSet(HISTORY_KEY, h);
      D.storeSet(STREAK_KEY, { count: 2, lastProcessedDate: D.shift(today, -1) });
      saveGoals(PREFIX + today, [
        { text: 'Statistik-Übungsblatt 4 abgeben', done: true, doneAt: Date.now() },
        { text: 'Vorlesung BWL nacharbeiten', done: false, queued: true },
        { text: '30 Min lesen', done: false },
        { text: 'Mama anrufen', done: true, doneAt: Date.now() }
      ]);
      saveGoals(PREFIX + D.tomorrowDate(), [{ text: 'Morgens laufen gehen', done: false }]);
      var mon = thisMonday();
      saveWeek(mon, [
        { id: 'w1', text: 'Lernen für Mathe', target: 4, count: 2 },
        { id: 'w2', text: 'Wäsche waschen', target: 1, count: 1 },
        { id: 'w3', text: '2 Kapitel Bachelorarbeit', target: 2, count: 0 }
      ]);
      saveWeek(D.shift(mon, -7), [
        { id: 'w4', text: 'Lernen für Mathe', target: 4, count: 4 },
        { id: 'w5', text: 'Einkaufen', target: 1, count: 1 },
        { id: 'w6', text: '2 Kapitel Bachelorarbeit', target: 2, count: 1 }
      ]);
      D.storeSet('demo_seeded_goals2', true);
    }
  };
})();
