/* =====================================================================
   photos.js — Fortschrittsfotos, privat auf diesem Gerät (IndexedDB).
   Ausblenden statt löschen (wie bei The Wire), endgültig löschen nur
   bewusst über "Ausgeblendete Fotos".
   ===================================================================== */
(function () {
  'use strict';
  var D = window.Dash;
  var $ = D.$, el = D.el;

  var DB_NAME = D.DEMO ? 'dash-photos-demo' : 'dash-photos';
  var STORE = 'photos';
  var MAX_SIDE = 1600;
  var dbp = null;
  var urls = [];
  var cache = [];
  var viewing = null;
  var pendingFile = null;
  var pendingUrl = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB nicht verfügbar')); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var out = fn(store);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }
  function all() { return tx('readonly', function (s) { return s.getAll(); }); }
  function put(rec) { return tx('readwrite', function (s) { s.put(rec); }); }
  function del(id) { return tx('readwrite', function (s) { s.delete(id); }); }

  function revokeAll() { urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = []; }
  function urlFor(rec) {
    var u = URL.createObjectURL(rec.blob);
    urls.push(u);
    return u;
  }

  /* Downscale to keep storage small; respects EXIF orientation in modern browsers. */
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var u = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(u);
        c.toBlob(function (b) { if (b) resolve({ blob: b, w: cw, h: ch }); else reject(new Error('Bild konnte nicht verarbeitet werden')); }, 'image/jpeg', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(u); reject(new Error('Dieses Bildformat wird nicht unterstützt (HEIC bitte als JPEG exportieren).')); };
      img.src = u;
    });
  }

  function render() {
    if ($('view-gym').hidden) return;
    all().then(function (rows) {
      cache = rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt - a.createdAt); });
      revokeAll();
      var visible = cache.filter(function (r) { return !r.hidden; });
      var hidden = cache.filter(function (r) { return r.hidden; });
      var grid = $('photoGrid');
      grid.innerHTML = '';
      $('photoEmpty').hidden = visible.length > 0;
      $('photoCount').textContent = visible.length ? visible.length + (visible.length === 1 ? ' Foto' : ' Fotos') : 'Optional';
      $('photoCompareBtn').hidden = visible.length < 2;
      visible.forEach(function (r) {
        var t = el('button', 'photo-tile');
        t.type = 'button';
        t.setAttribute('aria-label', 'Foto vom ' + D.fmtDate(r.date) + ' öffnen');
        var img = el('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = urlFor(r);
        t.appendChild(img);
        t.appendChild(el('span', 'ph-date', D.fmtDayMonth(r.date) + (r.date.slice(0, 4) !== D.todayStr().slice(0, 4) ? ' ' + r.date.slice(2, 4) : '')));
        t.addEventListener('click', function () { openViewer(r); });
        grid.appendChild(t);
      });
      var hl = $('hiddenPhotos');
      hl.hidden = hidden.length === 0;
      $('hiddenCount').textContent = 'Ausgeblendete Fotos (' + hidden.length + ')';
      var listEl = $('hiddenList');
      listEl.innerHTML = '';
      hidden.forEach(function (r) {
        var row = el('div', 'hidden-row');
        var img = el('img');
        img.alt = '';
        img.src = urlFor(r);
        row.appendChild(img);
        row.appendChild(el('span', 'grow', D.fmtDate(r.date)));
        var rs = el('button', 'text-btn', 'Wiederherstellen');
        rs.type = 'button';
        rs.addEventListener('click', function () { r.hidden = false; put(r).then(render); });
        var dl = el('button', 'text-btn danger', 'Endgültig löschen');
        dl.type = 'button';
        dl.addEventListener('click', function () {
          if (!window.confirm('Foto vom ' + D.fmtDate(r.date) + ' endgültig von diesem Gerät löschen? Das kann nicht rückgängig gemacht werden.')) return;
          del(r.id).then(render);
        });
        row.appendChild(rs);
        row.appendChild(dl);
        listEl.appendChild(row);
      });
    }).catch(function (e) {
      $('photoGrid').innerHTML = '';
      $('photoEmpty').hidden = false;
      $('photoEmpty').textContent = 'Fotos können in diesem Browser nicht gespeichert werden (' + e.message + ').';
    });
  }

  /* ---------------- Viewer ---------------- */
  function openViewer(r) {
    viewing = r;
    var img = $('viewerImg');
    img.src = urlFor(r);
    $('viewerTitle').textContent = D.fmtDayLong(r.date);
    $('viewerNote').textContent = r.note || '';
    $('viewerNote').hidden = !r.note;
    D.openSheet('viewerSheet');
  }

  /* ---------------- Add ---------------- */
  function openAdd() {
    pendingFile = null;
    if (pendingUrl) { URL.revokeObjectURL(pendingUrl); pendingUrl = null; }
    $('photoFile').value = '';
    $('photoPreview').innerHTML = D.icon('image') + '<span>Foto auswählen oder aufnehmen</span>';
    $('photoDate').value = D.todayStr();
    $('photoDate').max = D.todayStr();
    $('photoNoteInput').value = '';
    $('photoResult').textContent = '';
    D.openSheet('photoSheet');
  }
  function onFile() {
    var f = $('photoFile').files && $('photoFile').files[0];
    if (!f) return;
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) {
      $('photoResult').className = 'sheet-result is-error';
      $('photoResult').textContent = 'Bitte ein Bild auswählen (JPEG, PNG oder WebP).';
      return;
    }
    pendingFile = f;
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    pendingUrl = URL.createObjectURL(f);
    var p = $('photoPreview');
    p.innerHTML = '';
    var img = el('img');
    img.alt = 'Vorschau';
    img.src = pendingUrl;
    p.appendChild(img);
    $('photoResult').textContent = '';
  }
  function saveAdd() {
    var res = $('photoResult');
    var date = $('photoDate').value;
    if (!pendingFile) { res.className = 'sheet-result is-error'; res.textContent = 'Wähle zuerst ein Foto aus.'; return; }
    if (!D.isValidYmd(date) || date > D.todayStr()) { res.className = 'sheet-result is-error'; res.textContent = 'Bitte ein gültiges Datum wählen.'; return; }
    var btn = $('photoSave');
    btn.disabled = true;
    res.className = 'sheet-result is-muted';
    res.textContent = 'Speichere…';
    shrink(pendingFile).then(function (s) {
      return put({
        id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        date: date,
        blob: s.blob,
        w: s.w,
        h: s.h,
        note: $('photoNoteInput').value.trim().slice(0, 200) || null,
        hidden: false,
        createdAt: Date.now()
      });
    }).then(function () {
      if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) {} }
      D.closeSheet('photoSheet');
      render();
      D.toast('Foto gespeichert ✓');
    }).catch(function (e) {
      res.className = 'sheet-result is-error';
      res.textContent = e && e.message ? e.message : 'Speichern fehlgeschlagen.';
    }).then(function () { btn.disabled = false; });
  }

  /* ---------------- Compare ---------------- */
  function openCompare(firstId) {
    var visible = cache.filter(function (r) { return !r.hidden; });
    if (visible.length < 2) { D.toast('Für einen Vergleich brauchst du mindestens 2 Fotos.'); return; }
    var a = $('cmpA'), b = $('cmpB');
    [a, b].forEach(function (sel) {
      sel.innerHTML = '';
      visible.forEach(function (r) {
        var o = el('option', null, D.fmtDate(r.date) + (r.note ? ' · ' + r.note.slice(0, 24) : ''));
        o.value = r.id;
        sel.appendChild(o);
      });
    });
    a.value = visible[visible.length - 1].id;
    b.value = firstId && firstId !== a.value ? firstId : visible[0].id;
    $('cmpRange').value = 50;
    D.openSheet('compareSheet');
    drawCompare();
  }
  function drawCompare() {
    var ra = cache.filter(function (r) { return r.id === $('cmpA').value; })[0];
    var rb = cache.filter(function (r) { return r.id === $('cmpB').value; })[0];
    if (!ra || !rb) return;
    var ua = urlFor(ra), ub = urlFor(rb);
    $('cmpImgA').src = ua;
    $('cmpImgB').src = ub;
    $('cmpSideA').src = ua;
    $('cmpSideB').src = ub;
    $('cmpTagA').textContent = D.fmtDayMonth(ra.date) + ' ' + ra.date.slice(2, 4);
    $('cmpTagB').textContent = D.fmtDayMonth(rb.date) + ' ' + rb.date.slice(2, 4);
    $('cmpCapA').textContent = D.fmtDate(ra.date);
    $('cmpCapB').textContent = D.fmtDate(rb.date);
    var days = Math.abs(D.daysBetween(ra.date, rb.date));
    $('cmpDiff').textContent = days === 0 ? 'Gleicher Tag' : days + ' Tage dazwischen';
    setSplit($('cmpRange').value);
  }
  function setSplit(v) {
    $('cmpImgA').style.clipPath = 'inset(0 ' + (100 - v) + '% 0 0)';
    $('cmpLine').style.left = v + '%';
  }
  function setMode(mode) {
    $('cmpSlider').hidden = mode !== 'slider';
    $('cmpSide').hidden = mode !== 'side';
    $('cmpModeSlider').setAttribute('aria-pressed', String(mode === 'slider'));
    $('cmpModeSide').setAttribute('aria-pressed', String(mode === 'side'));
  }

  D.Photos = {
    boot: function () {
      $('photoAddBtn').addEventListener('click', openAdd);
      $('photoEmptyBtn').addEventListener('click', openAdd);
      $('photoFile').addEventListener('change', onFile);
      $('photoSave').addEventListener('click', saveAdd);
      $('photoCancel').addEventListener('click', function () { D.closeSheet('photoSheet'); });
      $('photoCompareBtn').addEventListener('click', function () { openCompare(null); });
      $('viewerClose').addEventListener('click', function () { D.closeSheet('viewerSheet'); });
      $('viewerHide').addEventListener('click', function () {
        if (!viewing) return;
        var r = viewing;
        r.hidden = true;
        put(r).then(function () {
          D.closeSheet('viewerSheet');
          render();
          D.toast('Foto ausgeblendet', { label: 'Rückgängig', fn: function () { r.hidden = false; put(r).then(render); } });
        });
      });
      $('viewerCompare').addEventListener('click', function () {
        var id = viewing && viewing.id;
        D.closeSheet('viewerSheet');
        setTimeout(function () { openCompare(id); }, 50);
      });
      $('cmpA').addEventListener('change', drawCompare);
      $('cmpB').addEventListener('change', drawCompare);
      $('cmpRange').addEventListener('input', function () { setSplit(this.value); });
      $('cmpSwap').addEventListener('click', function () {
        var a = $('cmpA').value;
        $('cmpA').value = $('cmpB').value;
        $('cmpB').value = a;
        drawCompare();
      });
      $('cmpModeSlider').addEventListener('click', function () { setMode('slider'); });
      $('cmpModeSide').addEventListener('click', function () { setMode('side'); });
      $('cmpClose').addEventListener('click', function () { D.closeSheet('compareSheet'); });
      setMode('slider');
    },
    render: render,
    count: function () { return all().then(function (r) { return r.filter(function (x) { return !x.hidden; }).length; }).catch(function () { return 0; }); }
  };
})();
