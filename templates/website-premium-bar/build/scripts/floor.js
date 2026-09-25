/* floor.js — the floor phone. Table map → the table's check. Items go on the
   seat that's picked; "Wait" keeps an item back when the rest is sent (apps
   now, mains later); pay or split by seat. "Food's up" buzzes when the grill
   bumps this table's food. Same /api/register endpoints as the bar tablet. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = JSON.parse($('fl-state').textContent);          // { open, recent, menu, floor, regulars, serverNow }
  var offset = S.serverNow - Date.now();
  var current = null, seat = 1, waitSet = {}, section = S.menu.length ? S.menu[0].id : null, toastTimer = null;
  var acked = {};
  try { acked = JSON.parse(localStorage.getItem('flr-acked') || '{}'); } catch (e) {}
  function saveAcked() { try { localStorage.setItem('flr-acked', JSON.stringify(acked)); } catch (e) {} }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(c) { var n = c < 0; c = Math.abs(c); return (n ? '−' : '') + '$' + Math.floor(c / 100) + '.' + String(c % 100).padStart(2, '0'); }
  function toCents(v) { var s = String(v || '').replace(/[^\d.]/g, ''); if (!s) return null; var n = Math.round(parseFloat(s) * 100); return isFinite(n) ? n : null; }
  function mins(iso) { var m = Math.floor((Date.now() + offset - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' m'; }
  function toast(t, bad, ms) { var el = $('fl-toast'); el.textContent = t; el.hidden = false; el.classList.toggle('is-bad', !!bad); clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, ms || 3500); }

  // ─── API (with the manager prompt, same as the register) ───────────────
  var mgr = null;
  function askManager(msg) { return new Promise(function (res, rej) { mgr = { res: res, rej: rej }; $('fd-mgr-msg').textContent = msg; $('ff-mgr-pin').value = ''; $('fd-mgr').showModal(); }); }
  $('ff-mgr').addEventListener('submit', function (e) {
    var cancel = e.submitter && e.submitter.value === 'cancel'; if (!cancel) e.preventDefault();
    var pin = $('ff-mgr-pin').value.replace(/\D/g, ''); $('fd-mgr').close();
    if (mgr) { if (cancel || !pin) mgr.rej(new Error('Not voided.')); else mgr.res(pin); } mgr = null;
  });
  function api(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      if (r.status === 401) { location.href = '/console/login?next=/register/floor'; return Promise.reject(new Error('signed out')); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 403 && j.needsManager) return askManager(j.error).then(function (pin) { return api(method, url, Object.assign({}, body || {}, { managerPin: pin })); });
        if (!r.ok) throw new Error(j.error || 'That did not save.');
        return j;
      });
    });
  }
  function fail(e) { if (e && e.message !== 'signed out') toast(e.message || 'No connection. Not saved.', true, 5000); }

  // ─── the map ───────────────────────────────────────────────────────────
  function checkFor(t) { return S.open.find(function (c) { return c.spot === t.name; }) || null; }
  function isUp(c) { return c && c.foodUpAt && acked[c.id] !== c.foodUpAt; }
  function tile(t) {
    var c = checkFor(t);
    var state = !c ? 'free' : isUp(c) ? 'up' : c.heldCount ? 'held' : 'open';
    var body = '<span class="flr-table__name">' + esc(t.name) + '</span>';
    if (!c) body += '<span class="flr-table__meta">Open · ' + t.seats + ' seat' + (t.seats === 1 ? '' : 's') + '</span>';
    else {
      body += (c.label !== t.name ? '<span class="flr-table__meta">' + esc(c.label) + '</span>' : '') +
        '<span class="flr-table__meta">' + mins(c.openedAt) + ' · <span class="flr-table__bal">' + money(c.balanceCents) + '</span></span>' +
        (state === 'up' ? '<span class="flr-badge flr-badge--up">Food\'s up</span>' : c.heldCount ? '<span class="flr-badge flr-badge--held">' + c.heldCount + ' not sent</span>' : c.onGrill ? '<span class="flr-badge flr-badge--grill">On the grill</span>' : '');
    }
    return '<button class="flr-table" type="button" data-table="' + esc(t.id) + '" data-state="' + state + '" aria-label="' + esc(t.name) + (c ? ', open check ' + money(c.balanceCents) + (state === 'up' ? ', food is up' : '') : ', free') + '">' + body + '</button>';
  }
  function renderMap() {
    var groups = [['booth', 'Booths'], ['table', 'Tables'], ['bar', 'Bar']];
    var html = groups.map(function (g) {
      var ts = S.floor.tables.filter(function (t) { return t.kind === g[0]; });
      if (!ts.length) return '';
      return '<div class="flr-group"><h2>' + g[1] + '</h2><div class="flr-tables' + (g[0] === 'bar' ? ' flr-tables--bar' : '') + '">' + ts.map(tile).join('') + '</div></div>';
    }).join('');
    var names = S.floor.tables.map(function (t) { return t.name; });
    var others = S.open.filter(function (c) { return names.indexOf(c.spot) < 0; });
    if (others.length) html += '<div class="flr-group"><h2>Other open checks</h2><div class="flr-tables">' + others.map(function (c) {
      return '<button class="flr-table" type="button" data-check="' + esc(c.id) + '" data-state="' + (isUp(c) ? 'up' : c.heldCount ? 'held' : 'open') + '"><span class="flr-table__name">' + esc(c.label) + '</span><span class="flr-table__meta">#' + c.number + ' · <span class="flr-table__bal">' + money(c.balanceCents) + '</span></span></button>';
    }).join('') + '</div></div>';
    $('fl-map').innerHTML = html;
  }

  // ─── the check ─────────────────────────────────────────────────────────
  function tableOf(c) { return S.floor.tables.find(function (t) { return t.name === c.spot; }) || { seats: 4 }; }
  function showMap() { current = null; $('fl-check').hidden = true; $('fl-map').hidden = false; $('fl-bar').hidden = true; $('fl-back').hidden = true; $('fl-title').hidden = false; renderMap(); }
  function showCheck(check) {
    current = check; if (!current || current.status !== 'open') { showMap(); return; }
    var row = S.open.find(function (o) { return o.id === current.id; });
    if (row && row.foodUpAt) { acked[row.id] = row.foodUpAt; saveAcked(); }
    $('fl-map').hidden = true; $('fl-check').hidden = false; $('fl-bar').hidden = false; $('fl-back').hidden = false; $('fl-title').hidden = true;
    renderCheck();
  }
  function openCheckId(id) { return api('GET', '/api/register/check/' + id).then(function (j) { waitSet = {}; seat = 1; showCheck(j.check); }).catch(fail); }

  function lineHtml(i) {
    var word = i.kind === 'reward' ? 'Reward' : i.state === 'held' ? (waitSet[i.id] ? 'Waiting' : 'Not sent') : i.state === 'sent' ? (i.toKitchen ? 'On the grill' : 'Sent') : 'Void';
    var btn = '<button class="reg-line" type="button" data-line="' + esc(i.id) + '" data-state="' + esc(i.state) + '"' + (i.state === 'void' || i.kind === 'reward' ? ' disabled' : '') + '>' +
      '<span class="reg-line__name">' + (i.qty > 1 ? i.qty + ' × ' : '') + esc(i.name) + (i.size ? ' <span class="reg-muted">(' + esc(i.size.toLowerCase()) + ')</span>' : '') + '</span>' +
      '<span class="reg-line__price">' + money(i.qty * i.unitPriceCents) + '</span>' +
      '<span class="reg-line__meta"><span class="reg-line__state">' + word + '</span>' + (i.note ? '<span>' + esc(i.note) + '</span>' : '') + '</span></button>';
    var wait = i.state === 'held' && i.toKitchen ? '<button class="flr-wait" type="button" data-wait="' + esc(i.id) + '" aria-pressed="' + (waitSet[i.id] ? 'true' : 'false') + '">Wait</button>' : '';
    return '<li class="flr-line">' + btn + wait + '</li>';
  }
  function renderCheck() {
    var c = current, t = c.totals, tbl = tableOf(c);
    var seats = [];
    for (var n = 1; n <= Math.max(tbl.seats, 1); n++) seats.push(n);
    c.items.forEach(function (i) { if (i.seat && seats.indexOf(i.seat) < 0) seats.push(i.seat); });
    var groups = {};
    c.items.forEach(function (i) { var k = i.seat || 0; (groups[k] = groups[k] || []).push(i); });
    var keys = Object.keys(groups).map(Number).sort(function (a, b) { return (a || 99) - (b || 99); });
    var sec = S.menu.find(function (s) { return s.id === section; }) || S.menu[0];
    $('fl-check').innerHTML =
      '<div class="flr-head"><h2>' + esc(c.label) + '</h2><span class="reg-muted">#' + c.number + ' · ' + mins(c.openedAt) + '</span></div>' +
      '<div class="flr-seats" role="group" aria-label="Seat for new items">' + seats.map(function (n) { return '<button class="reg-chip" type="button" data-seat="' + n + '" aria-pressed="' + (seat === n ? 'true' : 'false') + '">Seat ' + n + '</button>'; }).join('') +
        '<button class="reg-chip" type="button" data-seat="" aria-pressed="' + (seat === null ? 'true' : 'false') + '">Table</button></div>' +
      (c.items.length ? keys.map(function (k) { return '<div class="flr-seatgroup"><h3>' + (k ? 'Seat ' + k : 'For the table') + '</h3><ul class="reg-lines">' + groups[k].map(lineHtml).join('') + '</ul></div>'; }).join('') : '<p class="reg-muted">Pick a seat, then tap food below.</p>') +
      '<dl class="reg-totals"><div><dt>Food &amp; drink</dt><dd>' + money(t.subtotalCents) + '</dd></div><div><dt>Tax</dt><dd>' + money(t.taxCents) + '</dd></div><div class="reg-total"><dt>Total</dt><dd>' + money(t.totalCents) + '</dd></div>' +
        (t.paidCents ? '<div class="reg-balance"><dt>Balance</dt><dd>' + money(t.balanceCents) + '</dd></div>' : '') + '</dl>' +
      '<div class="flr-menu"><label class="reg-field">Menu<select class="reg-input" id="fl-sec">' + S.menu.map(function (s) { return '<option value="' + esc(s.id) + '"' + (sec && s.id === sec.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>' +
      '<div class="flr-items">' + (sec ? sec.items.map(function (it) {
        return '<div class="flr-item"><span class="flr-item__name">' + esc(it.name) + (it.is86ed ? ' <span class="reg-item__out">86\'d</span>' : '') + '</span><div class="flr-item__sizes">' + it.sizes.map(function (z) {
          return '<button class="reg-size" type="button" data-add="' + esc(it.id) + '" data-size="' + esc(z.id) + '" data-open-price="' + (z.priceCents == null ? '1' : '0') + '" data-name="' + esc(it.name) + '"' + (it.is86ed ? ' disabled' : '') + ' aria-label="Add ' + esc(it.name) + (it.sizes.length > 1 ? ' ' + esc(z.name) : '') + ' to ' + (seat ? 'seat ' + seat : 'the table') + '"><span>' + (it.sizes.length > 1 ? esc(z.name) : 'Add') + '</span><span class="reg-size__price' + (z.priceCents == null ? ' reg-size__price--open' : '') + '">' + (z.priceCents == null ? 'enter price' : money(z.priceCents)) + '</span></button>';
        }).join('') + '</div></div>';
      }).join('') : '') + '</div></div>';
    var sendable = c.items.filter(function (i) { return i.state === 'held' && !waitSet[i.id]; }).length;
    var seatsUsed = {};
    c.items.forEach(function (i) { if (i.state !== 'void' && i.kind === 'item' && i.seat) seatsUsed[i.seat] = 1; });
    $('fl-bar').innerHTML =
      '<button class="reg-btn reg-btn--send flr-bar__wide" type="button" id="fb-send"' + (sendable ? '' : ' disabled') + '>' + (sendable ? 'Send ' + sendable + (Object.keys(waitSet).length ? ' (the rest waits)' : '') : 'Nothing to send') + '</button>' +
      '<button class="reg-btn reg-btn--go" type="button" id="fb-pay"' + (t.balanceCents > 0 ? '' : ' disabled') + '>Pay ' + money(Math.max(0, t.balanceCents)) + '</button>' +
      '<button class="reg-btn" type="button" id="fb-split"' + (Object.keys(seatsUsed).length > 1 ? '' : ' disabled') + '>Split by seat</button>';
  }

  // ─── actions ───────────────────────────────────────────────────────────
  var pendingAdd = null;
  function add(itemId, sizeId, priceCents) {
    api('POST', '/api/register/check/' + current.id + '/items', { menuItemId: itemId, sizeId: sizeId, seat: seat, priceCents: priceCents }).then(function (j) { current = j.check; renderCheck(); if (navigator.vibrate) navigator.vibrate(15); }).catch(fail);
  }
  $('ff-price').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return; e.preventDefault();
    var c = toCents($('ff-price-amount').value); if (c === null) { toast('Enter a price.', true); return; }
    $('fd-price').close(); if (pendingAdd) add(pendingAdd.itemId, pendingAdd.sizeId, c); pendingAdd = null;
  });

  var line = null, lineQty = 1, lineSeat = null, lineReason = '';
  function openLine(id) {
    line = current.items.find(function (i) { return i.id === id; }); if (!line) return;
    lineQty = line.qty; lineSeat = line.seat; lineReason = '';
    var held = line.state === 'held';
    $('fd-line-h').textContent = line.name + (line.size ? ' (' + line.size.toLowerCase() + ')' : '');
    $('ff-line-held').hidden = !held; $('ff-line-sent').hidden = held; $('ff-line-save').hidden = !held;
    $('ff-line-remove').textContent = held ? 'Remove' : 'Void';
    $('ff-line-qty').textContent = lineQty; $('ff-line-note').value = line.note || '';
    var tbl = tableOf(current), seats = [null];
    for (var n = 1; n <= Math.max(tbl.seats, 1); n++) seats.push(n);
    $('ff-line-seats').innerHTML = seats.map(function (n) { return '<button class="reg-chip" type="button" data-lseat="' + (n || '') + '" aria-pressed="' + (n === lineSeat ? 'true' : 'false') + '">' + (n ? 'Seat ' + n : 'Table') + '</button>'; }).join('');
    $('ff-line-reasons').innerHTML = ['Rang in wrong', 'Guest changed mind', 'Comp', 'Kitchen mistake'].map(function (r) { return '<button class="reg-chip" type="button" data-reason="' + esc(r) + '" aria-pressed="false">' + esc(r) + '</button>'; }).join('');
    $('fd-line').showModal();
  }
  $('fd-line').addEventListener('click', function (e) {
    var q = e.target.closest('[data-q]'); if (q) { lineQty = Math.max(1, Math.min(50, lineQty + Number(q.getAttribute('data-q')))); $('ff-line-qty').textContent = lineQty; return; }
    var s = e.target.closest('[data-lseat]'); if (s) { var v = s.getAttribute('data-lseat'); lineSeat = v ? Number(v) : null; $('ff-line-seats').querySelectorAll('[data-lseat]').forEach(function (x) { x.setAttribute('aria-pressed', x === s ? 'true' : 'false'); }); return; }
    var r = e.target.closest('[data-reason]'); if (r) { lineReason = r.getAttribute('data-reason'); $('ff-line-reasons').querySelectorAll('[data-reason]').forEach(function (x) { x.setAttribute('aria-pressed', x === r ? 'true' : 'false'); }); }
  });
  $('ff-line').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return; e.preventDefault();
    api('PATCH', '/api/register/item/' + line.id, { qty: lineQty, note: $('ff-line-note').value, seat: lineSeat }).then(function (j) { $('fd-line').close(); current = j.check; renderCheck(); }).catch(fail);
  });
  $('ff-line-remove').addEventListener('click', function () {
    if (line.state !== 'held' && !lineReason) { toast('Pick a reason for the void.', true); return; }
    api('POST', '/api/register/item/' + line.id + '/void', { reason: lineReason }).then(function (j) { $('fd-line').close(); delete waitSet[line.id]; current = j.check; renderCheck(); }).catch(fail);
  });

  // Pay
  var tendered = null;
  function payTender() { var r = document.querySelector('input[name="ftender"]:checked'); return r ? r.value : 'cash'; }
  function drawPay() {
    var cash = payTender() === 'cash'; $('ff-pay-cash').hidden = !cash;
    var due = (toCents($('ff-pay-amount').value) || 0) + (toCents($('ff-pay-tip').value) || 0);
    var q = [due]; [100, 500, 1000, 2000].forEach(function (st) { var v = Math.ceil(due / st) * st; if (q.indexOf(v) < 0) q.push(v); });
    q = q.filter(function (v) { return v >= due && v - due <= 10000; }).sort(function (a, b) { return a - b; }).slice(0, 4);
    $('ff-pay-quick').innerHTML = q.map(function (v, i) { return '<button class="reg-chip" type="button" data-tender="' + v + '" aria-pressed="' + (tendered === v ? 'true' : 'false') + '">' + (i === 0 ? 'Exact ' : '') + money(v) + '</button>'; }).join('');
    $('ff-pay-change').textContent = tendered === null ? '—' : tendered < due ? 'short ' + money(due - tendered) : money(tendered - due);
  }
  function openPay() {
    tendered = null; $('ff-pay-bal').textContent = money(current.totals.balanceCents);
    $('ff-pay-amount').value = (current.totals.balanceCents / 100).toFixed(2); $('ff-pay-tip').value = '';
    document.querySelector('input[name="ftender"][value="cash"]').checked = true; drawPay(); $('fd-pay').showModal();
  }
  $('fd-pay').addEventListener('click', function (e) {
    var sp = e.target.closest('[data-split]'); if (sp) { var n = Number(sp.getAttribute('data-split')), b = current.totals.balanceCents; $('ff-pay-amount').value = ((n === 1 ? b : Math.min(b, Math.ceil(current.totals.totalCents / n))) / 100).toFixed(2); tendered = null; drawPay(); return; }
    var td = e.target.closest('[data-tender]'); if (td) { tendered = Number(td.getAttribute('data-tender')); drawPay(); }
  });
  ['ff-pay-amount', 'ff-pay-tip'].forEach(function (id) { $(id).addEventListener('input', function () { tendered = null; drawPay(); }); });
  document.querySelectorAll('input[name="ftender"]').forEach(function (r) { r.addEventListener('change', drawPay); });
  $('ff-pay').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return; e.preventDefault();
    var body = { tender: payTender(), amountCents: toCents($('ff-pay-amount').value), tipCents: toCents($('ff-pay-tip').value) || 0 };
    if (body.tender === 'cash' && tendered !== null) body.cashTenderedCents = tendered;
    api('POST', '/api/register/check/' + current.id + '/pay', body).then(function (j) {
      $('fd-pay').close();
      toast(j.changeCents ? 'Change ' + money(j.changeCents) + (j.check.status !== 'open' ? ' · closed' : '') : j.check.status !== 'open' ? 'Paid. Table is free.' : 'Payment taken. ' + money(j.check.totals.balanceCents) + ' left.', false, 8000);
      if (j.check.status !== 'open') showMap(); else { current = j.check; renderCheck(); }
    }).catch(fail);
  });

  // Clicks
  document.addEventListener('click', function (e) {
    var tb = e.target.closest('[data-table]');
    if (tb) {
      var t = S.floor.tables.find(function (x) { return x.id === tb.getAttribute('data-table'); });
      var c = checkFor(t);
      if (c) { openCheckId(c.id); return; }
      api('POST', '/api/register/check', { kind: t.kind === 'bar' ? 'tab' : 'table', label: t.name, spot: t.name }).then(function (j) { S.open.push(j.check); waitSet = {}; seat = t.seats > 1 ? 1 : null; showCheck(j.check); }).catch(fail);
      return;
    }
    var oc = e.target.closest('[data-check]'); if (oc) { openCheckId(oc.getAttribute('data-check')); return; }
    if (e.target.closest('#fl-back')) { showMap(); return; }
    if (!current) return;
    var sb = e.target.closest('[data-seat]'); if (sb) { var v = sb.getAttribute('data-seat'); seat = v ? Number(v) : null; renderCheck(); return; }
    var w = e.target.closest('[data-wait]'); if (w) { var id = w.getAttribute('data-wait'); if (waitSet[id]) delete waitSet[id]; else waitSet[id] = 1; renderCheck(); return; }
    var ad = e.target.closest('[data-add]');
    if (ad && !ad.disabled) {
      if (ad.getAttribute('data-open-price') === '1') { pendingAdd = { itemId: ad.getAttribute('data-add'), sizeId: ad.getAttribute('data-size') }; $('fd-price-h').textContent = ad.getAttribute('data-name'); $('ff-price-amount').value = ''; $('fd-price').showModal(); return; }
      add(ad.getAttribute('data-add'), ad.getAttribute('data-size')); return;
    }
    var ln = e.target.closest('[data-line]'); if (ln && !ln.disabled) { openLine(ln.getAttribute('data-line')); return; }
    if (e.target.closest('#fb-send')) {
      var ids = current.items.filter(function (i) { return i.state === 'held' && !waitSet[i.id]; }).map(function (i) { return i.id; });
      api('POST', '/api/register/check/' + current.id + '/send', { itemIds: ids }).then(function (j) { toast('On the grill.' + (Object.keys(waitSet).length ? ' The rest waits.' : '')); current = j.check; renderCheck(); }).catch(fail); return;
    }
    if (e.target.closest('#fb-pay')) { openPay(); return; }
    if (e.target.closest('#fb-split')) {
      api('POST', '/api/register/check/' + current.id + '/split-seats').then(function (j) { toast('Split into ' + (j.created.length + 1) + ' checks, one per seat.'); current = j.from; renderCheck(); }).catch(fail); return;
    }
  });
  document.addEventListener('change', function (e) { if (e.target.id === 'fl-sec') { section = e.target.value; renderCheck(); } });

  // ─── live ──────────────────────────────────────────────────────────────
  function conn(s, t) { var el = $('fl-conn'); el.setAttribute('data-state', s); el.textContent = t; }
  function connect() {
    var es = new EventSource('/api/register/stream');
    es.addEventListener('checks', function (e) {
      conn('live', 'Live');
      var d = JSON.parse(e.data); offset = d.serverNow - Date.now();
      var before = {}; S.open.forEach(function (o) { before[o.id] = o.foodUpAt; });
      S.open = d.open;
      // Food's up somewhere new: buzz and say where.
      d.open.forEach(function (o) {
        if (o.foodUpAt && before[o.id] !== o.foodUpAt && acked[o.id] !== o.foodUpAt && !(current && current.id === o.id)) {
          toast("Food's up: " + (o.spot || o.label), false, 8000);
          if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
        }
      });
      if (current) {
        var row = d.open.find(function (o) { return o.id === current.id; });
        if (!row) { showMap(); return; }
        if (row.foodUpAt && acked[row.id] !== row.foodUpAt) { acked[row.id] = row.foodUpAt; saveAcked(); toast("Food's up for this table.", false, 6000); }
        if (row.balanceCents !== current.totals.balanceCents || row.heldCount !== current.items.filter(function (i) { return i.state === 'held'; }).length) openCheckId(current.id);
      } else renderMap();
    });
    es.addEventListener('ping', function () { conn('live', 'Live'); });
    es.onerror = function () { conn('down', 'Reconnecting…'); };
  }

  renderMap();
  setInterval(function () { if (!current) renderMap(); }, 60000);
  connect();
})();
