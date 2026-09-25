/* register.js — the bar tablet. Draws open checks, the menu and the open
   check; every action is one POST that returns the fresh check. Other
   register screens stay in step over /api/register/stream. Money is cents
   everywhere; inputs take dollars. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = JSON.parse($('r-state').textContent);          // { open, recent, menu, taxRateBps, serverNow }
  var offset = S.serverNow - Date.now();
  var current = null;                                      // the open check (full view) or null
  var guestCache = {};                                     // guestId → profile
  var tab = S.menu.length ? S.menu[0].id : null;
  var toastTimer = null;

  // ─── helpers ──────────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(c) { var n = c < 0; c = Math.abs(c); return (n ? '−' : '') + '$' + Math.floor(c / 100) + '.' + String(c % 100).padStart(2, '0'); }
  function toCents(v) { var s = String(v || '').replace(/[^\d.]/g, ''); if (!s) return null; var n = Math.round(parseFloat(s) * 100); return isFinite(n) ? n : null; }
  function dollars(c) { return (c / 100).toFixed(2); }
  function ago(iso) { var m = Math.floor((Date.now() + offset - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; }
  function toast(html, bad, ms) {
    var t = $('r-toast'); t.innerHTML = html; t.hidden = false; t.classList.toggle('is-bad', !!bad);
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3500);
  }
  function api(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        if (r.status === 401) { location.href = '/console/login?next=/register'; return Promise.reject(new Error('signed out')); }
        return r.json().catch(function () { return {}; }).then(function (j) {
          // A manager has to OK this one: ask for their PIN, then send it again with it.
          if (r.status === 403 && j.needsManager) return askManager(j.error).then(function (pin) { var b = Object.assign({}, body || {}, { managerPin: pin }); return api(method, url, b); });
          if (!r.ok) throw new Error(j.error || 'That did not save.');
          return j;
        });
      });
  }
  var mgrResolve = null, mgrReject = null;
  function askManager(msg) {
    return new Promise(function (resolve, reject) {
      mgrResolve = resolve; mgrReject = reject;
      $('d-mgr-msg').textContent = msg || 'A manager needs to OK that.';
      $('f-mgr-pin').value = '';
      $('d-mgr').showModal(); setTimeout(function () { $('f-mgr-pin').focus(); }, 30);
    });
  }
  function fail(e) { if (e && e.message !== 'signed out') toast(esc(e.message || 'No connection. Not saved.'), true, 5000); }
  function setCurrent(check) {
    current = check && check.status === 'open' ? check : null;
    renderOpen(); renderCheck();
  }

  // ─── open checks ─────────────────────────────────────────────────────────
  function renderOpen() {
    var ul = $('r-open');
    if (!S.open.length) { ul.innerHTML = '<li class="reg-empty">No open checks.</li>'; }
    else ul.innerHTML = S.open.map(function (c) {
      return '<li><button class="reg-open" type="button" data-open="' + esc(c.id) + '" aria-current="' + (current && current.id === c.id ? 'true' : 'false') + '">' +
        '<span class="reg-open__label">' + esc(c.label) + (c.spot && c.spot !== c.label ? ' · ' + esc(c.spot) : '') + '</span>' +
        '<span class="reg-open__total">' + money(c.balanceCents) + '</span>' +
        '<span class="reg-open__meta">#' + c.number + ' · ' + c.itemCount + ' item' + (c.itemCount === 1 ? '' : 's') + ' · ' + ago(c.openedAt) +
        (c.heldCount ? ' · <span class="reg-open__held">' + c.heldCount + ' not sent</span>' : '') + '</span></button></li>';
    }).join('');
    $('r-recent').innerHTML = S.recent.length ? S.recent.map(function (c) {
      return '<li><button class="reg-open" type="button" data-recent="' + esc(c.id) + '"><span class="reg-open__label">#' + c.number + ' ' + esc(c.label) + '</span>' +
        '<span class="reg-open__total">' + (c.status === 'void' ? 'void' : money(c.totalCents || 0)) + '</span></button></li>';
    }).join('') : '<li class="reg-empty">Nothing closed yet today.</li>';
  }

  // ─── menu ────────────────────────────────────────────────────────────────
  function renderMenu() {
    $('r-tabs').innerHTML = S.menu.map(function (s) {
      return '<button class="reg-tab" type="button" role="tab" data-tab="' + esc(s.id) + '" aria-selected="' + (s.id === tab ? 'true' : 'false') + '">' + esc(s.name) + '</button>';
    }).join('');
    var sec = S.menu.find(function (s) { return s.id === tab; }) || S.menu[0];
    if (!sec) { $('r-grid').innerHTML = '<p class="reg-empty">No menu yet.</p>'; return; }
    $('r-grid').innerHTML = sec.items.map(function (it) {
      return '<div class="reg-item"><span class="reg-item__name">' + esc(it.name) + '</span>' + (it.is86ed ? '<span class="reg-item__out">86\'d</span>' : '') +
        '<div class="reg-item__sizes">' + it.sizes.map(function (z) {
          var label = it.sizes.length > 1 ? esc(z.name) : 'Add';
          var price = z.priceCents == null ? '<span class="reg-size__price reg-size__price--open">enter price</span>' : '<span class="reg-size__price">' + money(z.priceCents) + '</span>';
          return '<button class="reg-size" type="button" data-add="' + esc(it.id) + '" data-size="' + esc(z.id) + '" data-open-price="' + (z.priceCents == null ? '1' : '0') + '" data-name="' + esc(it.name) + '"' + (it.is86ed ? ' disabled' : '') +
            ' aria-label="Add ' + esc(it.name) + (it.sizes.length > 1 ? ' ' + esc(z.name) : '') + '">' + '<span>' + label + '</span>' + price + '</button>';
        }).join('') + '</div></div>';
    }).join('');
  }

  // ─── the open check ──────────────────────────────────────────────────────
  function renderCheck() {
    var box = $('r-check');
    if (!current) {
      box.innerHTML = '<h2 class="reg-h" id="h-check">No check open</h2><p class="reg-muted">Start a tab, pick a table, or just tap food for a walk-up.</p>' +
        '<div class="reg-guest__row"><button class="reg-btn" type="button" id="a-gc">Sell a gift card</button><button class="reg-btn reg-btn--ghost" type="button" id="a-gc-bal">Gift card balance</button></div>';
      return;
    }
    var c = current, t = c.totals;
    var held = c.items.filter(function (i) { return i.state === 'held'; }).length;
    var lines = c.items.map(function (i) {
      var word = i.state === 'held' ? 'Not sent' : i.state === 'sent' ? (i.toKitchen ? 'On the grill' : 'Sent') : 'Void';
      if (i.kind === 'reward') word = 'Regulars reward · tap twice to take off';
      if (i.kind === 'giftcard') word = i.giftCardId ? 'Gift card ' + (i.note || '') : 'Gift card · works once paid · tap twice to take off';
      return '<li><button class="reg-line" type="button" data-line="' + esc(i.id) + '" data-kind="' + esc(i.kind || 'item') + '" data-state="' + esc(i.state) + '"' + (i.state === 'void' || i.giftCardId ? ' disabled' : '') + '>' +
        '<span class="reg-line__name">' + (i.qty > 1 ? i.qty + ' × ' : '') + esc(i.name) + (i.size ? ' <span class="reg-muted">(' + esc(i.size.toLowerCase()) + ')</span>' : '') + '</span>' +
        '<span class="reg-line__price">' + money(i.qty * i.unitPriceCents) + '</span>' +
        '<span class="reg-line__meta"><span class="reg-line__state">' + word + '</span>' + (i.seat ? '<span>seat ' + i.seat + '</span>' : '') +
        (i.note && !(i.kind === 'giftcard' && i.giftCardId) ? '<span>' + esc(i.note) + '</span>' : '') + (i.voidReason ? '<span>' + esc(i.voidReason) + '</span>' : '') + '</span></button></li>';
    }).join('');
    var pays = c.payments.map(function (p) {
      var what = (p.tender === 'cash' ? 'Cash' : p.tender === 'giftcard' ? 'Gift card' : 'Card') + ' ' + money(p.amountCents) + (p.tipCents ? ' + tip ' + money(p.tipCents) : '');
      return '<li class="reg-pay' + (p.voidedAt ? ' reg-pay--void' : '') + '"><span>' + what + '</span>' +
        (p.voidedAt ? '<span>void</span>' : '<button class="reg-btn reg-btn--ghost" type="button" data-voidpay="' + esc(p.id) + '">Void</button>') + '</li>';
    }).join('');
    box.innerHTML =
      '<div class="reg-check__head"><h2 class="reg-check__title" id="h-check">' + esc(c.label) + '</h2><span class="reg-check__num">#' + c.number + '</span></div>' +
      '<p class="reg-check__sub">' + (c.spot && c.spot !== c.label ? esc(c.spot) + ' · ' : '') + (c.kind === 'tab' ? 'Tab' : c.kind === 'table' ? 'Table' : 'Walk-up') + ' · opened ' + ago(c.openedAt) + '</p>' +
      guestBlock(c) +
      (c.items.length ? '<ul class="reg-lines">' + lines + '</ul>' : '<p class="reg-muted">Tap food on the menu to add it.</p>') +
      '<dl class="reg-totals"><div><dt>Food &amp; drink</dt><dd>' + money(t.subtotalCents) + '</dd></div><div><dt>Tax</dt><dd>' + money(t.taxCents) + '</dd></div>' +
      '<div class="reg-total"><dt>Total</dt><dd>' + money(t.totalCents) + '</dd></div>' +
      (t.paidCents ? '<div><dt>Paid</dt><dd>' + money(t.paidCents) + '</dd></div><div class="reg-balance"><dt>Balance</dt><dd>' + money(t.balanceCents) + '</dd></div>' : '') + '</dl>' +
      (pays ? '<ul class="reg-pays">' + pays + '</ul>' : '') +
      '<div class="reg-actions">' +
        '<button class="reg-btn reg-btn--send reg-btn--wide" type="button" id="a-send"' + (held ? '' : ' disabled') + '>' + (held ? 'Send ' + held + ' to the grill' : 'Nothing to send') + '</button>' +
        '<button class="reg-btn reg-btn--go reg-btn--wide" type="button" id="a-pay"' + (t.balanceCents > 0 ? '' : ' disabled') + '>Pay ' + money(Math.max(0, t.balanceCents)) + '</button>' +
        '<button class="reg-btn" type="button" id="a-split"' + (c.items.filter(function (i) { return i.state !== 'void'; }).length > 1 ? '' : ' disabled') + '>Split</button>' +
        '<button class="reg-btn" type="button" id="a-more">Rename · void</button>' +
        '<button class="reg-btn" type="button" id="a-gc">Gift card</button>' +
        '<button class="reg-btn reg-btn--ghost" type="button" id="a-close">Put it away</button>' +
      '</div>';
  }

  function guestBlock(c) {
    if (!c.guestId) return '<div class="reg-guest__row"><button class="reg-btn" type="button" id="a-guest">Add a regular</button></div>';
    var g = guestCache[c.guestId];
    if (!g) { loadGuest(c.guestId); return '<div class="reg-guest"><span class="reg-muted">Looking them up…</span></div>'; }
    var hasReward = c.items.some(function (i) { return i.kind === 'reward' && i.state !== 'void'; });
    var visits = g.visitCount === 0 ? 'First visit' : ordinal(g.visitCount + 1) + ' visit';
    return '<div class="reg-guest"><div class="reg-guest__top"><span class="reg-guest__name">' + esc(g.name) + '</span><span class="reg-muted">' + g.pointsBalance + ' pts</span></div>' +
      '<span class="reg-guest__meta">' + visits + (g.lastVisitAt ? ' · last here ' + (ago(g.lastVisitAt) === 'just now' ? 'just now' : ago(g.lastVisitAt) + ' ago') : '') + '</span>' +
      (g.usual.length ? '<span class="reg-guest__meta">Usual: ' + g.usual.map(function (u) { return esc(u.name); }).join(', ') + '</span>' : '') +
      (g.note ? '<span class="reg-guest__meta">' + esc(g.note) + '</span>' : '') +
      (g.birthdaySoon ? '<span class="reg-guest__flag">Birthday this week (' + esc(g.birthday) + ')</span>' : '') +
      '<div class="reg-guest__row">' +
        (g.rewardReady && !hasReward ? '<button class="reg-btn reg-btn--go" type="button" id="a-reward">Use reward: ' + money(g.rewardCents) + ' off</button>' : '') +
        '<button class="reg-btn reg-btn--ghost" type="button" id="a-guest">Change</button>' +
      '</div></div>';
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function loadGuest(id) { return api('GET', '/api/register/guest/' + id).then(function (j) { guestCache[id] = j.guest; renderCheck(); }).catch(function () {}); }
  function setGuest(guestId) {
    if (!current) return Promise.resolve();
    return api('POST', '/api/register/check/' + current.id + '/guest', { guestId: guestId }).then(function (j) { $('d-guest').close(); setCurrent(j.check); }).catch(fail);
  }
  var guestTimer = null;
  function searchGuests() {
    clearTimeout(guestTimer);
    var q = $('f-guest-q').value.trim();
    if (q.length < 2) { $('f-guest-results').innerHTML = ''; return; }
    guestTimer = setTimeout(function () {
      api('GET', '/api/register/guests?q=' + encodeURIComponent(q)).then(function (j) {
        $('f-guest-results').innerHTML = j.guests.length ? j.guests.map(function (g) {
          return '<li><button class="reg-pick" type="button" data-pick-guest="' + esc(g.id) + '"><span><strong>' + esc(g.name) + '</strong> ' + (g.phone ? '<span class="reg-muted">…' + esc(g.phone.slice(-4)) + '</span>' : '') + '</span><span class="reg-muted">' + g.visitCount + ' visit' + (g.visitCount === 1 ? '' : 's') + ' · ' + g.pointsBalance + ' pts</span></button></li>';
        }).join('') : '<li class="reg-empty">Nobody by that. Add them below.</li>';
      }).catch(function () {});
    }, 250);
  }
  function openGuest() {
    if (!current) return;
    ['f-guest-q', 'f-guest-name', 'f-guest-phone', 'f-guest-email', 'f-guest-note'].forEach(function (id) { $(id).value = ''; });
    $('f-guest-month').value = ''; $('f-guest-day').value = ''; $('f-guest-consent').checked = false;
    $('f-guest-consent-text').textContent = (S.regulars && S.regulars.emailConsentText) || '';
    $('f-guest-results').innerHTML = current.guestId ? '<li><button class="reg-pick" type="button" data-pick-guest="">Take the regular off this check</button></li>' : '';
    $('d-guest').showModal(); setTimeout(function () { $('f-guest-q').focus(); }, 30);
  }
  $('f-guest-q').addEventListener('input', function () {
    searchGuests();
    // Typing digits pre-fills the phone for a new sign-up; letters pre-fill the name.
    var v = this.value.trim();
    if (/^[\d\s()+.-]+$/.test(v)) $('f-guest-phone').value = v; else $('f-guest-name').value = v;
  });
  $('f-guest-results').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick-guest]'); if (!b) return;
    var id = b.getAttribute('data-pick-guest');
    setGuest(id || null);
  });
  $('f-guest-save').addEventListener('click', function () {
    var body = { name: $('f-guest-name').value, phone: $('f-guest-phone').value, email: $('f-guest-email').value, birthdayMonth: $('f-guest-month').value, birthdayDay: $('f-guest-day').value, note: $('f-guest-note').value, emailConsent: $('f-guest-consent').checked };
    api('POST', '/api/register/guests', body).then(function (j) { guestCache[j.guest.id] = j.guest; toast(esc(j.guest.name) + ' is on the list.'); return setGuest(j.guest.id); }).catch(fail);
  });

  function loadCheck(id) { return api('GET', '/api/register/check/' + id).then(function (j) { setCurrent(j.check); }).catch(fail); }
  function refreshOpen() { return api('GET', '/api/register/state').then(function (j) { S.open = j.open; S.recent = j.recent; S.menu = j.menu; renderOpen(); renderMenu(); }).catch(function () {}); }

  // ─── new check ───────────────────────────────────────────────────────────
  var newKind = 'tab', newSpot = '';
  var SPOTS = [];
  for (var b = 1; b <= 5; b++) SPOTS.push('Booth ' + b);
  for (var tb = 1; tb <= 5; tb++) SPOTS.push('Table ' + tb);
  for (var s = 1; s <= 10; s++) SPOTS.push('Bar seat ' + s);
  function openNew(kind) {
    if (kind === 'walkup') { api('POST', '/api/register/check', { kind: 'walkup', label: 'Walk-up' }).then(function (j) { S.open.push(j.check); setCurrent(j.check); }).catch(fail); return; }
    newKind = kind; newSpot = '';
    $('d-new-h').textContent = kind === 'tab' ? 'New tab' : 'Table';
    $('f-new-name').value = '';
    $('f-new-name').placeholder = kind === 'tab' ? 'Mike' : 'Name (optional)';
    $('f-new-spot-chips').innerHTML = SPOTS.filter(function (x) { return kind === 'table' ? !/^Bar/.test(x) : true; }).map(function (x) {
      return '<button class="reg-chip" type="button" data-spot="' + esc(x) + '" aria-pressed="false">' + esc(x) + '</button>';
    }).join('');
    $('d-new').showModal();
    setTimeout(function () { (kind === 'tab' ? $('f-new-name') : $('f-new-spot-chips').querySelector('button')).focus(); }, 30);
  }
  $('f-new-spot-chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-spot]'); if (!b) return;
    newSpot = b.getAttribute('aria-pressed') === 'true' ? '' : b.getAttribute('data-spot');
    this.querySelectorAll('[data-spot]').forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-spot') === newSpot ? 'true' : 'false'); });
  });
  $('f-new').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    var name = $('f-new-name').value.trim();
    if (newKind === 'tab' && !name) { toast('Whose tab is it?', true); return; }
    if (newKind === 'table' && !newSpot) { toast('Which table?', true); return; }
    api('POST', '/api/register/check', { kind: newKind, label: name || newSpot, spot: newSpot || null }).then(function (j) {
      $('d-new').close(); S.open.push(j.check); setCurrent(j.check);
    }).catch(fail);
  });

  // ─── adding items ────────────────────────────────────────────────────────
  var pendingAdd = null;
  function ensureCheck() {
    if (current) return Promise.resolve(current);
    return api('POST', '/api/register/check', { kind: 'walkup', label: 'Walk-up' }).then(function (j) { S.open.push(j.check); setCurrent(j.check); return j.check; });
  }
  function add(itemId, sizeId, priceCents) {
    return ensureCheck().then(function (c) {
      return api('POST', '/api/register/check/' + c.id + '/items', { menuItemId: itemId, sizeId: sizeId, qty: 1, priceCents: priceCents });
    }).then(function (j) { setCurrent(j.check); refreshOpen(); }).catch(fail);
  }
  $('r-grid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-add]'); if (!b || b.disabled) return;
    if (b.getAttribute('data-open-price') === '1') {
      pendingAdd = { itemId: b.getAttribute('data-add'), sizeId: b.getAttribute('data-size') };
      $('d-price-h').textContent = b.getAttribute('data-name');
      $('f-price-amount').value = '';
      $('d-price').showModal(); setTimeout(function () { $('f-price-amount').focus(); }, 30);
      return;
    }
    add(b.getAttribute('data-add'), b.getAttribute('data-size'));
  });
  $('f-price').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    var c = toCents($('f-price-amount').value);
    if (c === null) { toast('Enter a price.', true); return; }
    $('d-price').close();
    if (pendingAdd) add(pendingAdd.itemId, pendingAdd.sizeId, c);
    pendingAdd = null;
  });
  $('r-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (!b) return; tab = b.getAttribute('data-tab'); renderMenu(); });

  // ─── lines ───────────────────────────────────────────────────────────────
  var line = null, lineQty = 1, lineSeat = null, lineReason = '';
  var REASONS = ['Rang in wrong', 'Guest changed mind', 'Comp', 'Kitchen mistake'];
  function openLine(id) {
    line = current.items.find(function (i) { return i.id === id; }); if (!line) return;
    lineQty = line.qty; lineSeat = line.seat; lineReason = '';
    $('d-line-h').textContent = line.name + (line.size ? ' (' + line.size.toLowerCase() + ')' : '');
    var held = line.state === 'held';
    $('f-line-held').hidden = !held; $('f-line-sent').hidden = held;
    $('f-line-save').hidden = !held;
    $('f-line-remove').textContent = held ? 'Remove' : 'Void';
    $('f-line-qty').textContent = lineQty;
    $('f-line-note').value = line.note || '';
    $('f-line-reason').value = '';
    var seats = [null, 1, 2, 3, 4, 5, 6];
    $('f-line-seats').innerHTML = seats.map(function (n) { return '<button class="reg-chip" type="button" data-seat="' + (n || '') + '" aria-pressed="' + (n === lineSeat ? 'true' : 'false') + '">' + (n ? n : 'None') + '</button>'; }).join('');
    $('f-line-reasons').innerHTML = REASONS.map(function (r) { return '<button class="reg-chip" type="button" data-reason="' + esc(r) + '" aria-pressed="false">' + esc(r) + '</button>'; }).join('');
    $('d-line').showModal();
  }
  $('d-line').addEventListener('click', function (e) {
    var q = e.target.closest('[data-q]'); if (q) { lineQty = Math.max(1, Math.min(50, lineQty + Number(q.getAttribute('data-q')))); $('f-line-qty').textContent = lineQty; return; }
    var st = e.target.closest('[data-seat]'); if (st) { var v = st.getAttribute('data-seat'); lineSeat = v ? Number(v) : null; $('f-line-seats').querySelectorAll('[data-seat]').forEach(function (x) { x.setAttribute('aria-pressed', x === st ? 'true' : 'false'); }); return; }
    var r = e.target.closest('[data-reason]'); if (r) { lineReason = r.getAttribute('data-reason'); $('f-line-reasons').querySelectorAll('[data-reason]').forEach(function (x) { x.setAttribute('aria-pressed', x === r ? 'true' : 'false'); }); }
  });
  $('f-line').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault(); if (!line) return;
    api('PATCH', '/api/register/item/' + line.id, { qty: lineQty, note: $('f-line-note').value, seat: lineSeat }).then(function (j) { $('d-line').close(); setCurrent(j.check); refreshOpen(); }).catch(fail);
  });
  $('f-line-remove').addEventListener('click', function () {
    if (!line) return;
    var reason = $('f-line-reason').value.trim() || lineReason;
    if (line.state !== 'held' && !reason) { toast('Pick a reason for the void.', true); return; }
    api('POST', '/api/register/item/' + line.id + '/void', { reason: reason }).then(function (j) { $('d-line').close(); setCurrent(j.check); refreshOpen(); }).catch(fail);
  });

  // ─── pay ─────────────────────────────────────────────────────────────────
  var tendered = null;
  function payDue() { return (toCents($('f-pay-amount').value) || 0) + (toCents($('f-pay-tip').value) || 0); }
  function payTender() { var r = document.querySelector('input[name="tender"]:checked'); return r ? r.value : 'cash'; }
  function drawPay() {
    var t = payTender(), cash = t === 'cash', gc = t === 'giftcard';
    $('f-pay-cash').hidden = !cash; $('f-pay-cardnote').hidden = t !== 'card_external';
    $('f-pay-gc').hidden = !gc; $('f-pay-tipwrap').hidden = gc;   // no tips off a gift card
    if (gc) $('f-pay-tip').value = '';
    var due = payDue();
    var q = [due]; [100, 500, 1000, 2000].forEach(function (st) { var v = Math.ceil(due / st) * st; if (q.indexOf(v) < 0) q.push(v); });
    if (due < 5000 && q.indexOf(5000) < 0) q.push(5000);
    q = q.filter(function (v) { return v >= due && v - due <= 10000; }).sort(function (a, b) { return a - b; }).slice(0, 5);
    $('f-pay-quick').innerHTML = q.map(function (v, i) { return '<button class="reg-chip" type="button" data-tender="' + v + '" aria-pressed="' + (tendered === v ? 'true' : 'false') + '">' + (i === 0 ? 'Exact ' : '') + money(v) + '</button>'; }).join('');
    var typed = toCents($('f-pay-tendered').value);
    var given = typed !== null ? typed : tendered;
    $('f-pay-change').textContent = given === null ? '—' : given < due ? 'short ' + money(due - given) : money(given - due);
  }
  function openPay() {
    if (!current) return;
    tendered = null;
    $('f-pay-bal').textContent = money(current.totals.balanceCents);
    $('f-pay-amount').value = dollars(current.totals.balanceCents);
    $('f-pay-tip').value = ''; $('f-pay-tendered').value = ''; $('f-pay-gc-code').value = ''; $('f-pay-gc-bal').textContent = '—';
    document.querySelector('input[name="tender"][value="cash"]').checked = true;
    drawPay(); $('d-pay').showModal();
  }
  $('d-pay').addEventListener('click', function (e) {
    var sp = e.target.closest('[data-split]');
    // ÷ N divides the whole check, so the third of three still comes out right; the last share is whatever is left.
    if (sp && current) { var n = Number(sp.getAttribute('data-split')); var b = current.totals.balanceCents; $('f-pay-amount').value = dollars(n === 1 ? b : Math.min(b, Math.ceil(current.totals.totalCents / n))); tendered = null; drawPay(); return; }
    var td = e.target.closest('[data-tender]'); if (td) { tendered = Number(td.getAttribute('data-tender')); $('f-pay-tendered').value = ''; drawPay(); }
  });
  ['f-pay-amount', 'f-pay-tip', 'f-pay-tendered'].forEach(function (id) { $(id).addEventListener('input', function () { if (id !== 'f-pay-tendered') tendered = null; drawPay(); }); });
  document.querySelectorAll('input[name="tender"]').forEach(function (r) { r.addEventListener('change', function () { drawPay(); if (payTender() === 'giftcard') $('f-pay-gc-code').focus(); }); });
  // Look the card up as the number is typed, so the bartender sees what's on it before charging.
  var gcTimer = null;
  function gcLookup(code, out) {
    clearTimeout(gcTimer);
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 6) { out.textContent = '—'; return; }
    gcTimer = setTimeout(function () {
      api('GET', '/api/register/giftcard?code=' + encodeURIComponent(code)).then(function (j) {
        out.textContent = j.status === 'active' ? money(j.balanceCents) : 'voided';
      }).catch(function () { out.textContent = 'no such card'; });
    }, 300);
  }
  $('f-pay-gc-code').addEventListener('input', function () { gcLookup($('f-pay-gc-code').value, $('f-pay-gc-bal')); });
  $('f-pay').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault(); if (!current) return;
    var amount = toCents($('f-pay-amount').value), tip = toCents($('f-pay-tip').value) || 0, tender = payTender();
    if (!amount) { toast('Enter an amount.', true); return; }
    var typed = toCents($('f-pay-tendered').value);
    var body = { tender: tender, amountCents: amount, tipCents: tip };
    if (tender === 'cash') body.cashTenderedCents = typed !== null ? typed : tendered;
    if (tender === 'giftcard') { body.giftCardCode = $('f-pay-gc-code').value.trim(); body.tipCents = 0; if (!body.giftCardCode) { toast('Enter the gift card number.', true); return; } }
    $('f-pay-go').disabled = true;
    api('POST', '/api/register/check/' + current.id + '/pay', body).then(function (j) {
      $('d-pay').close();
      var closed = j.check.status !== 'open';
      if (closed && j.check.guestId) delete guestCache[j.check.guestId];   // visits and points just changed
      if (j.giftCard) toast('<strong>' + money(j.giftCard.balanceCents) + '</strong> left on the card.' + (closed ? ' Check closed.' : ' ' + money(j.check.totals.balanceCents) + ' still owed.'), false, 10000);
      else if (j.changeCents) toast('Change <strong>' + money(j.changeCents) + '</strong>' + (closed ? ' · check closed' : ''), false, 10000);
      else toast(closed ? 'Paid. Check closed.' : 'Payment taken. ' + money(j.check.totals.balanceCents) + ' left.');
      setCurrent(j.check); refreshOpen();
    }).catch(fail).then(function () { $('f-pay-go').disabled = false; });
  });

  // ─── gift cards ──────────────────────────────────────────────────────────
  function openGc() { $('f-gc-amount').value = ''; $('f-gc-code').value = ''; $('d-gc').showModal(); }
  $('d-gc').addEventListener('click', function (e) { var a = e.target.closest('[data-gc-amt]'); if (a) $('f-gc-amount').value = dollars(Number(a.getAttribute('data-gc-amt'))); });
  $('f-gc').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    var cents = toCents($('f-gc-amount').value);
    if (!cents || cents < 500 || cents > 50000) { toast('A gift card is $5 to $500.', true); return; }
    var code = $('f-gc-code').value.trim();
    ensureCheck().then(function (c) {
      return api('POST', '/api/register/check/' + c.id + '/giftcard', { amountCents: cents, code: code || null });
    }).then(function (j) { $('d-gc').close(); toast('Gift card on the check. It works once the check is paid.'); setCurrent(j.check); refreshOpen(); }).catch(fail);
  });
  function gcBalance() { $('f-gcb-code').value = ''; $('f-gcb-out').textContent = '—'; $('d-gcb').showModal(); }
  $('f-gcb-code').addEventListener('input', function () { gcLookup($('f-gcb-code').value, $('f-gcb-out')); });

  // ─── split, rename, void ─────────────────────────────────────────────────
  $('f-split').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault(); if (!current) return;
    var ids = Array.prototype.map.call(document.querySelectorAll('#f-split-items input:checked'), function (x) { return x.value; });
    if (!ids.length) { toast('Pick what goes on the new check.', true); return; }
    api('POST', '/api/register/check/' + current.id + '/split', { itemIds: ids, label: $('f-split-label').value }).then(function (j) {
      $('d-split').close(); toast('Split onto #' + j.to.number + ' ' + esc(j.to.label)); setCurrent(j.from); refreshOpen();
    }).catch(fail);
  });
  $('f-more').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault(); if (!current) return;
    api('PATCH', '/api/register/check/' + current.id, { label: $('f-more-label').value, spot: $('f-more-spot').value }).then(function (j) { $('d-more').close(); setCurrent(j.check); refreshOpen(); }).catch(fail);
  });
  $('f-more-void').addEventListener('click', function () {
    if (!current) return;
    api('POST', '/api/register/check/' + current.id + '/void', { reason: $('f-more-reason').value }).then(function () { $('d-more').close(); toast('Check voided.'); setCurrent(null); refreshOpen(); }).catch(fail);
  });

  $('f-mgr').addEventListener('submit', function (e) {
    var cancel = e.submitter && e.submitter.value === 'cancel';
    if (!cancel) e.preventDefault();
    var pin = $('f-mgr-pin').value.replace(/\D/g, '');
    $('d-mgr').close();
    if (cancel || !pin) { if (mgrReject) mgrReject(new Error('Not voided.')); }
    else if (mgrResolve) mgrResolve(pin);
    mgrResolve = mgrReject = null;
  });

  // ─── clicks on the check and lists ───────────────────────────────────────
  document.addEventListener('click', function (e) {
    var nb = e.target.closest('[data-new]'); if (nb) { openNew(nb.getAttribute('data-new')); return; }
    var ob = e.target.closest('[data-open]'); if (ob) { loadCheck(ob.getAttribute('data-open')); return; }
    var rb = e.target.closest('[data-recent]'); if (rb) { api('GET', '/api/register/check/' + rb.getAttribute('data-recent')).then(function (j) { var c = j.check; toast('#' + c.number + ' ' + esc(c.label) + ' · ' + (c.status === 'void' ? 'voided' : 'paid ' + money(c.totals.paidCents) + (c.totals.tipCents ? ' + tip ' + money(c.totals.tipCents) : '')), false, 6000); }).catch(fail); return; }
    var lb = e.target.closest('[data-line]');
    if (lb && !lb.disabled && (lb.getAttribute('data-kind') === 'reward' || lb.getAttribute('data-kind') === 'giftcard')) {
      // Taking a reward off gives the points back; two taps so it isn't an accident.
      if (lb.getAttribute('data-armed') !== '1') { lb.setAttribute('data-armed', '1'); var st = lb.querySelector('.reg-line__state'); if (st) st.textContent = 'Tap again to take it off'; setTimeout(function () { if (lb.isConnected) renderCheck(); }, 4000); return; }
      api('POST', '/api/register/item/' + lb.getAttribute('data-line') + '/void', {}).then(function (j) { if (current && current.guestId) delete guestCache[current.guestId]; setCurrent(j.check); refreshOpen(); }).catch(fail);
      return;
    }
    if (lb && !lb.disabled) { openLine(lb.getAttribute('data-line')); return; }
    if (e.target.closest('#a-guest')) { openGuest(); return; }
    if (e.target.closest('#a-reward') && current) { api('POST', '/api/register/check/' + current.id + '/reward').then(function (j) { delete guestCache[j.check.guestId]; toast('Reward on the check.'); setCurrent(j.check); refreshOpen(); }).catch(fail); return; }
    var vp = e.target.closest('[data-voidpay]');
    if (vp) {
      // Money moves: first tap arms it, a second tap within 4 seconds voids it.
      if (vp.getAttribute('data-armed') !== '1') {
        vp.setAttribute('data-armed', '1'); vp.textContent = 'Tap again to void';
        setTimeout(function () { if (vp.isConnected) { vp.removeAttribute('data-armed'); vp.textContent = 'Void'; } }, 4000);
        return;
      }
      api('POST', '/api/register/payment/' + vp.getAttribute('data-voidpay') + '/void', { reason: 'Voided at the register' }).then(function (j) { toast('Payment voided.'); setCurrent(j.check); refreshOpen(); }).catch(fail);
      return;
    }
    if (e.target.id === 'a-send' && current) { api('POST', '/api/register/check/' + current.id + '/send').then(function (j) { toast('On the grill screen.'); setCurrent(j.check); refreshOpen(); }).catch(fail); return; }
    if (e.target.id === 'a-pay') { openPay(); return; }
    if (e.target.id === 'a-gc') { openGc(); return; }
    if (e.target.id === 'a-gc-bal') { gcBalance(); return; }
    if (e.target.id === 'a-split' && current) {
      $('f-split-items').innerHTML = current.items.filter(function (i) { return i.state !== 'void'; }).map(function (i) {
        return '<li><label><input type="checkbox" value="' + esc(i.id) + '"> ' + (i.qty > 1 ? i.qty + ' × ' : '') + esc(i.name) + (i.seat ? ' · seat ' + i.seat : '') + ' <span class="reg-muted">' + money(i.qty * i.unitPriceCents) + '</span></label></li>';
      }).join('');
      $('f-split-label').value = ''; $('d-split').showModal(); return;
    }
    if (e.target.id === 'a-more' && current) { $('f-more-label').value = current.label; $('f-more-spot').value = current.spot || ''; $('f-more-reason').value = ''; $('d-more').showModal(); return; }
    if (e.target.id === 'a-close') { setCurrent(null); }
  });

  // ─── live ────────────────────────────────────────────────────────────────
  function conn(s, t) { var el = $('r-conn'); el.setAttribute('data-state', s); el.textContent = t; }
  function connect() {
    var es = new EventSource('/api/register/stream');
    es.addEventListener('checks', function (e) {
      conn('live', 'Live');
      var d = JSON.parse(e.data); offset = d.serverNow - Date.now(); S.open = d.open; S.recent = d.recent; renderOpen();
      // Another register changed the check we're looking at: pull it fresh.
      if (current) {
        var row = d.open.find(function (o) { return o.id === current.id; });
        if (!row) { setCurrent(null); return; }
        if (row.balanceCents !== current.totals.balanceCents || row.heldCount !== current.items.filter(function (i) { return i.state === 'held'; }).length) loadCheck(current.id);
      }
    });
    es.addEventListener('ping', function () { conn('live', 'Live'); });
    es.onerror = function () { conn('down', 'Reconnecting…'); };
  }
  function clock() { $('r-clock').textContent = new Date(Date.now() + offset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

  renderOpen(); renderMenu(); renderCheck(); clock();
  setInterval(clock, 15000);
  setInterval(renderOpen, 60000);
  connect();
})();
