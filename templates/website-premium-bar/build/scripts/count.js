/* count.js — the count screen. Every stock item as a row: packs + loose,
   saved a moment after typing stops (and when the field is left). The
   finish button is two taps so it isn't hit by accident. Counts are blind:
   the screen never shows what the register expects, or it gets typed back in. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = JSON.parse($('ct-state').textContent);   // { stock, count, categories }
  var counted = {};                                 // stockItemId → units
  (S.count ? S.count.lines : []).forEach(function (l) { counted[l.stockItemId] = l.qty; });
  var cat = 'all', q = '', toastTimer = null, timers = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(v) { var n = Number(String(v).replace(/[^\d.]/g, '')); return isFinite(n) ? n : 0; }
  function fmt(n) { return (Math.round(n * 100) / 100).toString(); }
  function toast(t, bad) { var el = $('ct-toast'); el.textContent = t; el.hidden = false; el.classList.toggle('is-bad', !!bad); clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 3500); }
  function api(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      if (r.status === 401) { location.href = '/console/login?next=/register/count'; return Promise.reject(new Error('signed out')); }
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'That did not save.'); return j; });
    });
  }

  function status() {
    var n = Object.keys(counted).length;
    $('ct-status').textContent = n + ' of ' + S.stock.length + ' counted' + (S.count && S.count.startedBy ? ' · started by ' + S.count.startedBy : '');
    $('ct-finish').disabled = n === 0;
  }
  function renderCats() {
    var have = {}; S.stock.forEach(function (s) { have[s.category] = 1; });
    var cats = [{ id: 'all', label: 'All' }, { id: 'left', label: 'Not counted' }].concat(S.categories.filter(function (c) { return have[c.id]; }));
    $('ct-cats').innerHTML = cats.map(function (c) { return '<button class="reg-chip" type="button" data-cat="' + c.id + '" aria-pressed="' + (cat === c.id) + '">' + esc(c.label) + '</button>'; }).join('');
  }
  function render() {
    var rows = S.stock.filter(function (s) {
      if (cat === 'left' && counted[s.id] !== undefined) return false;
      if (cat !== 'all' && cat !== 'left' && s.category !== cat) return false;
      return !q || s.name.toLowerCase().indexOf(q) >= 0;
    });
    $('ct-empty').hidden = S.stock.length > 0;
    $('ct-list').innerHTML = rows.map(function (s) {
      var have = counted[s.id], packs = '', loose = '';
      if (have !== undefined) { var p = s.packSize > 0 ? Math.floor(have / s.packSize + 1e-9) : 0; packs = String(p); loose = fmt(have - p * s.packSize); if (loose === '0') loose = ''; }
      var single = s.packSize === 1;
      return '<li class="cnt-item" data-id="' + s.id + '" data-done="' + (have !== undefined ? 1 : 0) + '">' +
        '<div class="cnt-item__top"><span class="cnt-item__name">' + esc(s.name) + '</span><span class="cnt-item__saved" id="sv-' + s.id + '">' + (have !== undefined ? 'Counted ' + fmt(have) + ' ' + esc(s.unitLabel) : '') + '</span></div>' +
        '<span class="cnt-item__meta">' + esc(s.packName) + (single ? '' : ' · ' + fmt(s.packSize) + ' ' + esc(s.unitLabel)) + '</span>' +
        '<div class="cnt-item__in">' +
          '<label>' + (single ? esc(s.unitLabel) : 'Full: ' + esc(s.packName)) + '<input inputmode="decimal" data-f="packs" value="' + packs + '" aria-label="' + esc(s.name) + ': ' + (single ? esc(s.unitLabel) : 'full ' + esc(s.packName)) + '"></label>' +
          (single ? '' : '<label>Plus loose ' + esc(s.unitLabel) + '<input inputmode="decimal" data-f="units" value="' + loose + '" aria-label="' + esc(s.name) + ': loose ' + esc(s.unitLabel) + '"></label>') +
        '</div>' +
      '</li>';
    }).join('');
    status();
  }
  function save(li) {
    var id = li.getAttribute('data-id');
    var p = li.querySelector('[data-f="packs"]').value.trim(), uEl = li.querySelector('[data-f="units"]'), u = uEl ? uEl.value.trim() : '';
    var out = $('sv-' + id);
    var body = p === '' && u === '' ? { stockItemId: id, clear: true } : { stockItemId: id, packs: p, units: u };
    api('POST', '/api/register/count/item', body).then(function (j) {
      if (j.qty === null || j.qty === undefined) { delete counted[id]; out.textContent = ''; li.setAttribute('data-done', '0'); }
      else { counted[id] = j.qty; var s = S.stock.find(function (x) { return x.id === id; }); out.textContent = 'Counted ' + fmt(j.qty) + ' ' + s.unitLabel; li.setAttribute('data-done', '1'); }
      out.removeAttribute('data-bad'); status();
    }).catch(function (e) { out.textContent = 'Not saved'; out.setAttribute('data-bad', '1'); if (e.message !== 'signed out') toast(e.message, true); });
  }
  $('ct-list').addEventListener('input', function (e) {
    var li = e.target.closest('.cnt-item'); if (!li) return;
    var id = li.getAttribute('data-id'); clearTimeout(timers[id]);
    timers[id] = setTimeout(function () { save(li); }, 700);
  });
  $('ct-list').addEventListener('change', function (e) {
    var li = e.target.closest('.cnt-item'); if (!li) return;
    var id = li.getAttribute('data-id'); clearTimeout(timers[id]); save(li);
  });
  $('ct-cats').addEventListener('click', function (e) { var b = e.target.closest('[data-cat]'); if (!b) return; cat = b.getAttribute('data-cat'); renderCats(); render(); });
  $('ct-q').addEventListener('input', function () { q = $('ct-q').value.trim().toLowerCase(); render(); });
  var armed = false;
  $('ct-finish').addEventListener('click', function () {
    var left = S.stock.length - Object.keys(counted).length;
    if (!armed) { armed = true; $('ct-finish').textContent = left ? 'Tap again: finish with ' + left + ' not counted' : 'Tap again to finish'; setTimeout(function () { armed = false; $('ct-finish').textContent = 'Finish the count'; }, 5000); return; }
    api('POST', '/api/register/count/finish').then(function () {
      toast('Count finished. The owner sees it in the admin.');
      setTimeout(function () { location.href = '/register'; }, 1600);
    }).catch(function (e) { toast(e.message, true); });
  });
  renderCats(); render();
})();
