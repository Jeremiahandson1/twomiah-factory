// The shopper's account page (/account), served by the unified app at /scripts/account.js (server/site/routes.ts, from
// this file) on a store whose owner has switched shopper accounts on. Dependency-free. It signs a shopper in with an
// emailed link or a six-digit code (no password), then shows their orders (with "order again"), their saved addresses
// and a sign-out. Every request goes to /api/public/account with the browser's own cookie; nothing here decides what a
// shopper may see — the server does.
(function () {
  'use strict';
  var root = document.getElementById('account-root');
  if (!root) return;
  var API = '/api/public/account';
  var CART_KEY = 'store-cart';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(cents) {
    var n = (Number(cents) || 0) / 100;
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); } catch (e) { return '$' + n.toFixed(2); }
  }
  function when(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  }
  function api(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
    return fetch(API + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) { return { ok: res.ok, status: res.status, json: json }; });
    });
  }
  // The server's errors are { error: "<sentence>", code?, fields? }; an older shape may carry { error: { message } } or { message }.
  function errText(json, fallback) {
    var e = json && json.error;
    if (typeof e === 'string' && e) return e;
    if (e && typeof e.message === 'string' && e.message) return e.message;
    if (json && typeof json.message === 'string' && json.message) return json.message;
    return fallback;
  }
  function say(el, text, bad) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'account-note' + (bad ? ' account-note--bad' : '');
  }
  var STATUS = { paid: 'Paid', processing: 'Being packed', shipped: 'Shipped', delivered: 'Delivered', fulfilled: 'Ready', picked_up: 'Picked up', refunded: 'Refunded', partially_refunded: 'Partly refunded', cancelled: 'Cancelled' };
  function statusWord(s) { return STATUS[s] || String(s || '').replace(/_/g, ' '); }

  // ── Signed out ─────────────────────────────────────────────────────────────────────────────────────────────────
  function showSignIn(message) {
    root.innerHTML =
      '<div class="account-card">' +
      '<h2>Sign in</h2>' +
      '<p>Enter your email. We will send you a link and a six-digit code. There is no password to remember. New here? Your account is made the first time you sign in.</p>' +
      '<form id="account-ask" novalidate>' +
      '<label for="account-email">Email</label>' +
      '<input id="account-email" type="email" autocomplete="email" required>' +
      '<button class="btn btn--primary" type="submit">Email me a sign-in link</button>' +
      '</form>' +
      '<p id="account-ask-note" class="account-note" role="status"></p>' +
      '<form id="account-code" hidden novalidate>' +
      '<label for="account-code-input">Or type the six-digit code from the email</label>' +
      '<input id="account-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*">' +
      '<button class="btn btn--primary" type="submit">Sign in</button>' +
      '<p id="account-code-note" class="account-note" role="status"></p>' +
      '</form>' +
      '</div>';
    var ask = document.getElementById('account-ask'), codeForm = document.getElementById('account-code');
    var email = document.getElementById('account-email');
    say(document.getElementById('account-ask-note'), message || '');
    ask.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = document.getElementById('account-ask-note');
      if (!email.value || email.value.indexOf('@') < 0) return say(note, 'Enter your email address.', true);
      say(note, 'Sending…');
      api('POST', '/sign-in', { email: email.value.trim() }).then(function (r) {
        if (!r.ok) return say(note, errText(r.json, 'Enter a valid email address.'), true);
        say(note, r.json.message || 'We have sent a sign-in link and a code to that address.');
        codeForm.hidden = false;
        document.getElementById('account-code-input').focus();
      });
    });
    codeForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = document.getElementById('account-code-note');
      var code = document.getElementById('account-code-input').value.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(code)) return say(note, 'The code is six digits.', true);
      api('POST', '/verify', { email: email.value.trim(), code: code }).then(function (r) {
        if (!r.ok) return say(note, 'That code did not work. It may have expired or been used. Ask for a new one.', true);
        load();
      });
    });
  }

  // The page the emailed link opens: a button, so that opening the link (a mail scanner does) uses nothing up.
  function showConfirm() {
    var token = '';
    try { token = new URLSearchParams(location.search).get('token') || ''; } catch (e) {}
    try { history.replaceState(null, '', '/account/confirm'); } catch (e) {}
    if (!token) return showSignIn('That link is incomplete. Ask for a new one.');
    root.innerHTML = '<div class="account-card"><h2>Sign in</h2><p>Press the button to sign in to your account.</p>' +
      '<button class="btn btn--primary" id="account-confirm" type="button">Sign in</button>' +
      '<p id="account-confirm-note" class="account-note" role="status"></p></div>';
    document.getElementById('account-confirm').addEventListener('click', function () {
      var note = document.getElementById('account-confirm-note');
      say(note, 'Signing in…');
      api('POST', '/verify', { token: token }).then(function (r) {
        if (!r.ok) return showSignIn('That link did not work. It may have expired or been used. Ask for a new one.');
        try { history.replaceState(null, '', '/account'); } catch (e) {}
        load();
      });
    });
  }

  // ── Signed in ──────────────────────────────────────────────────────────────────────────────────────────────────
  function load() {
    api('GET', '/me').then(function (me) {
      if (!me.ok) return showSignIn();
      // Returns are only asked for when the shop has them on (me.returns); else that page does not exist.
      var wanted = [api('GET', '/orders'), api('GET', '/addresses')];
      if (me.json && me.json.returns) wanted.push(api('GET', '/returns'));
      Promise.all(wanted).then(function (all) {
        draw(me.json, (all[0].json && all[0].json.data) || [], (all[1].json && all[1].json.data) || [], (all[2] && all[2].json && all[2].json.data) || []);
      });
    });
  }

  function addressLines(a) {
    var x = a || {};
    return [x.line1, x.line2, [x.city, x.state, x.postalCode].filter(Boolean).join(' '), x.country].filter(Boolean).map(esc).join('<br>');
  }

  function orderHtml(o) {
    var items = (o.items || []).map(function (i) {
      var name = i.variantName && i.variantName !== 'Default' ? i.productName + ' — ' + i.variantName : i.productName;
      return '<li>' + esc(i.quantity) + ' × ' + (i.slug ? '<a href="/product/' + esc(i.slug) + '">' + esc(name) + '</a>' : esc(name)) + ' <span class="account-muted">' + money(i.lineTotalCents) + '</span></li>';
    }).join('');
    var track = o.tracking ? '<p class="account-muted">Tracking: ' + esc(o.tracking.carrier || '') + ' ' + esc(o.tracking.number) + '</p>' : '';
    return '<article class="account-order" data-order="' + esc(o.id) + '">' +
      '<header><strong>Order ' + esc(o.orderNumber) + '</strong> <span class="account-muted">' + esc(when(o.placedAt)) + '</span>' +
      '<span class="account-status">' + esc(statusWord(o.status)) + '</span></header>' +
      '<ul>' + items + '</ul>' + track +
      '<p class="account-total">Total ' + money(o.totalCents) + (o.refundedCents ? ' <span class="account-muted">(' + money(o.refundedCents) + ' refunded)</span>' : '') + '</p>' +
      '<button type="button" class="btn btn--secondary" data-again="' + esc(o.id) + '">Order again</button>' +
      (keptCard && o.fulfillment !== 'digital' ? ' <button type="button" class="btn btn--primary" data-pay-again="' + esc(o.id) + '">Reorder and pay with ' + esc(cardName(keptCard)) + '</button>' : '') +
      '<span class="account-note" data-again-note="' + esc(o.id) + '" role="status"></span>' +
      returnFormHtml(o) +
      '</article>';
  }

  // ── Returns ───────────────────────────────────────────────────────────────────────────────────────────────────
  var REASONS = [['changed_mind', 'I changed my mind'], ['defective', 'It arrived damaged or does not work'], ['wrong_item', 'I was sent the wrong item'], ['not_as_described', 'It is not as described'], ['other', 'Something else']];
  var RETURN_STATUS = { requested: 'Waiting for the shop', approved: 'Approved. Send it back', received: 'Received. Your refund is next', refunded: 'Refunded', exchanged: 'Exchanged', declined: 'Not accepted', cancelled: 'Cancelled' };

  // The "Return items" form of one order: only when the shop has returns on (o.returnable is then present) and something is left to send back.
  function returnFormHtml(o) {
    var can = o.returnable;
    if (!can) return '';
    var left = {};
    (can.lines || []).forEach(function (l) { left[l.orderItemId] = l; });
    var rows = (o.items || []).filter(function (i) { return left[i.id] && left[i.id].left > 0; });
    if (!can.open || !rows.length) {
      var why = !can.open && can.why ? can.why : (!rows.length ? 'Everything on this order has already been returned or cannot be returned.' : '');
      return why ? '<p class="account-muted" data-return-why="' + esc(o.id) + '">' + esc(why) + '</p>' : '';
    }
    var lines = rows.map(function (i) {
      var name = i.variantName && i.variantName !== 'Default' ? i.productName + ' — ' + i.variantName : i.productName;
      var max = left[i.id].left;
      return '<label class="account-return-line"><span>' + esc(name) + ' <span class="account-muted">(up to ' + esc(max) + ')</span></span>' +
        '<input type="number" min="0" max="' + esc(max) + '" value="0" inputmode="numeric" data-return-qty="' + esc(i.id) + '" aria-label="How many of ' + esc(name) + ' to return"></label>';
    }).join('');
    var reasons = REASONS.map(function (r) { return '<option value="' + r[0] + '">' + esc(r[1]) + '</option>'; }).join('');
    return '<details class="account-return" data-return="' + esc(o.id) + '"><summary>Return items</summary>' +
      '<p class="account-muted">You can ask to return items until ' + esc(when(can.endsAt)) + '.</p>' +
      '<form data-return-form="' + esc(o.id) + '" novalidate>' + lines +
      '<label>Why are you returning it?<select name="reason">' + reasons + '</select></label>' +
      '<label>What would you like?<select name="resolution"><option value="refund">My money back</option><option value="exchange">An exchange</option></select></label>' +
      '<label class="account-check"><input type="checkbox" name="preferCredit"> Give me store credit instead of a refund to my card</label>' +
      '<label data-wanted-label hidden>What would you like instead? (size, colour…)<input name="wanted" maxlength="500"></label>' +
      '<label>Anything we should know? (optional)<textarea name="note" maxlength="1000" rows="2"></textarea></label>' +
      '<button class="btn btn--primary" type="submit">Ask to return</button>' +
      '<p class="account-note" data-return-note="' + esc(o.id) + '" role="status"></p></form></details>';
  }

  function returnHtml(r) {
    var lines = (r.lines || []).map(function (l) {
      var name = l.variantName && l.variantName !== 'Default' ? l.productName + ' — ' + l.variantName : l.productName;
      return '<li>' + esc(l.quantity) + ' × ' + esc(name) + '</li>';
    }).join('');
    var open = r.status === 'requested' || r.status === 'approved';
    var money2 = '';
    if (r.status === 'refunded' || r.status === 'exchanged') {
      var toCard = (Number(r.refundCents) || 0) - (Number(r.creditCents) || 0);
      var bits = [];
      if (toCard > 0) bits.push(money(toCard) + ' back to your card');
      if (r.creditCents > 0) bits.push(money(r.creditCents) + ' as store credit');
      if (r.exchangeOrderNumber) bits.push('exchange sent as order ' + esc(r.exchangeOrderNumber));
      money2 = bits.length ? '<p class="account-total">' + bits.join(', ') + '</p>' : '';
    }
    var fees = (Number(r.restockingFeeCents) || 0) + (Number(r.returnShippingFeeCents) || 0);
    return '<article class="account-order" data-return-id="' + esc(r.id) + '">' +
      '<header><strong>Return ' + esc(r.returnNumber) + '</strong> <span class="account-muted">order ' + esc(r.orderNumber || '') + ' · ' + esc(when(r.createdAt)) + '</span>' +
      '<span class="account-status">' + esc(RETURN_STATUS[r.status] || r.status) + '</span></header>' +
      '<ul>' + lines + '</ul>' +
      (r.status === 'approved' && fees > 0 ? '<p class="account-muted">The shop keeps ' + money(fees) + ' of the refund.</p>' : '') +
      (r.label && r.label.url ? '<p><a href="' + esc(r.label.url) + '" rel="noopener">Print your return label</a> <span class="account-muted">' + esc(r.label.carrier || '') + ' ' + esc(r.label.tracking || '') + '</span></p>' : '') +
      (r.status === 'declined' && r.declineReason ? '<p class="account-muted">' + esc(r.declineReason) + '</p>' : '') +
      money2 +
      (open ? '<button type="button" class="btn btn--secondary" data-return-cancel="' + esc(r.id) + '">Cancel this return</button><span class="account-note" data-return-cancel-note="' + esc(r.id) + '" role="status"></span>' : '') +
      '</article>';
  }

  function wireReturns() {
    root.querySelectorAll('[data-return-form]').forEach(function (form) {
      var resolution = form.elements.resolution, wanted = form.querySelector('[data-wanted-label]');
      resolution.addEventListener('change', function () { wanted.hidden = resolution.value !== 'exchange'; });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var id = form.getAttribute('data-return-form'), note = root.querySelector('[data-return-note="' + id + '"]');
        var items = [];
        form.querySelectorAll('[data-return-qty]').forEach(function (inp) {
          var q = Math.floor(Number(inp.value) || 0);
          if (q > 0) items.push({ orderItemId: inp.getAttribute('data-return-qty'), quantity: q });
        });
        if (!items.length) return say(note, 'Choose how many of at least one item.', true);
        var body = { orderId: id, items: items, reason: form.elements.reason.value, resolution: resolution.value, preferCredit: !!form.elements.preferCredit.checked };
        if ((form.elements.note.value || '').trim()) body.note = form.elements.note.value.trim();
        if (resolution.value === 'exchange' && (form.elements.wanted.value || '').trim()) body.wanted = form.elements.wanted.value.trim();
        say(note, 'Sending…');
        api('POST', '/returns', body).then(function (r) {
          if (!r.ok) return say(note, errText(r.json, 'That return could not be started.'), true);
          load();
        });
      });
    });
    root.querySelectorAll('[data-return-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-return-cancel'), note = root.querySelector('[data-return-cancel-note="' + id + '"]');
        api('POST', '/returns/' + id + '/cancel', {}).then(function (r) {
          if (!r.ok) return say(note, errText(r.json, 'That return could not be cancelled.'), true);
          load();
        });
      });
    });
  }

  function addressHtml(a) {
    return '<div class="account-address" data-address="' + esc(a.id) + '">' +
      '<p><strong>' + esc(a.label || a.name) + '</strong>' + (a.isDefault ? ' <span class="account-status">Default</span>' : '') + '<br>' + addressLines(a.address) + '</p>' +
      (a.isDefault ? '' : '<button type="button" class="btn btn--secondary" data-default="' + esc(a.id) + '">Make default</button> ') +
      '<button type="button" class="btn btn--secondary" data-remove="' + esc(a.id) + '">Remove</button></div>';
  }

  // The card kept for one-tap payment (store_fast_checkout): brand and last four only.
  var keptCard = null;
  function cardName(c) {
    var b = String(c.brand || 'card');
    b = b === 'amex' ? 'American Express' : b.charAt(0).toUpperCase() + b.slice(1);
    return b + ' ending ' + c.last4;
  }

  function draw(me, orders, addresses, returns) {
    keptCard = me.savedCard || null;
    var bits = [];
    if (me.group) bits.push('<span class="account-status">' + esc(me.group) + ' prices</span>');
    if (me.points != null) bits.push('<span class="account-muted">' + esc(me.points) + ' reward points</span>');
    var credit = (me.credit || []).map(function (c) { return '<p class="account-muted">Store credit: <strong>' + money(c.balanceCents) + '</strong> — use code <code>' + esc(c.code) + '</code> at checkout.</p>'; }).join('');
    // Gift cards they bought or were given: the balance and the code that spends it (beside the store credit above).
    var gifts = (me.giftCards || []).map(function (g) {
      var who = g.relation === 'given' ? 'Gift card given to you' : 'Gift card you bought';
      return '<p class="account-muted">' + who + ': ' + (g.balanceCents > 0 ? '<strong>' + money(g.balanceCents) + '</strong> left' : '<strong>used up</strong>') +
        (g.initialCents !== g.balanceCents ? ' of ' + money(g.initialCents) : '') + ' — code <code>' + esc(g.code) + '</code>' + (g.balanceCents > 0 ? ' at checkout.' : '.') + '</p>';
    }).join('');
    root.innerHTML =
      '<div class="account-head"><div><h2>' + esc(me.name || 'Hello') + '</h2><p class="account-muted">' + esc(me.email) + '</p>' + bits.join(' ') + credit + gifts + '</div>' +
      '<button type="button" class="btn btn--secondary" id="account-out">Sign out</button></div>' +
      (keptCard ? '<section class="account-section"><h2>Your saved card</h2><p>' + esc(cardName(keptCard)) + ', expires ' + esc(String(keptCard.expMonth).padStart(2, '0')) + '/' + esc(keptCard.expYear) + '. It is kept by Stripe, not by this shop, and used only when you choose to pay with it.</p>' +
        '<button type="button" class="btn btn--secondary" id="account-card-remove">Remove my card</button> <span class="account-note" id="account-card-note" role="status"></span></section>' : '') +
      '<section class="account-section"><h2>Your orders</h2>' +
      (orders.length ? orders.map(orderHtml).join('') : '<p class="store-empty">No orders yet. <a href="/shop">Start shopping</a></p>') + '</section>' +
      (me.returns && returns.length ? '<section class="account-section"><h2>Your returns</h2>' + returns.map(returnHtml).join('') + '</section>' : '') +
      '<section class="account-section"><h2>Saved addresses</h2><div id="account-addresses">' +
      (addresses.length ? addresses.map(addressHtml).join('') : '<p class="account-muted">No saved addresses yet.</p>') + '</div>' +
      '<details class="account-add"><summary>Add an address</summary>' +
      '<form id="account-add-form" novalidate>' +
      '<label>Name<input name="name" autocomplete="name" required></label>' +
      '<label>Address<input name="line1" autocomplete="address-line1" required></label>' +
      '<label>Apartment, suite (optional)<input name="line2" autocomplete="address-line2"></label>' +
      '<label>City<input name="city" autocomplete="address-level2" required></label>' +
      '<label>State<input name="state" autocomplete="address-level1"></label>' +
      '<label>ZIP or postal code<input name="postalCode" autocomplete="postal-code" required></label>' +
      '<label>Country (two letters)<input name="country" value="US" maxlength="2" autocomplete="country" required></label>' +
      '<label class="account-check"><input type="checkbox" name="isDefault"> Use as my default address</label>' +
      '<button class="btn btn--primary" type="submit">Save address</button>' +
      '<p id="account-add-note" class="account-note" role="status"></p></form></details></section>';

    document.getElementById('account-out').addEventListener('click', function () {
      api('POST', '/sign-out', {}).then(function () { showSignIn('You are signed out.'); });
    });
    wireReturns();
    var removeCard = document.getElementById('account-card-remove');
    if (removeCard) removeCard.addEventListener('click', function () {
      api('DELETE', '/card', {}).then(function (r) {
        if (!r.ok) return say(document.getElementById('account-card-note'), errText(r.json, 'Your card could not be removed.'), true);
        load();
      });
    });
    root.querySelectorAll('[data-pay-again]').forEach(function (btn) {
      btn.addEventListener('click', function () { payAgain(btn); });
    });
    root.querySelectorAll('[data-again]').forEach(function (btn) {
      btn.addEventListener('click', function () { orderAgain(btn.getAttribute('data-again')); });
    });
    root.querySelectorAll('[data-default]').forEach(function (btn) {
      btn.addEventListener('click', function () { api('PUT', '/addresses/' + btn.getAttribute('data-default'), { isDefault: true }).then(load); });
    });
    root.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () { api('DELETE', '/addresses/' + btn.getAttribute('data-remove'), {}).then(load); });
    });
    document.getElementById('account-add-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, note = document.getElementById('account-add-note');
      var v = function (n) { return (f.elements[n].value || '').trim(); };
      if (!v('name') || !v('line1') || !v('city') || !v('postalCode')) return say(note, 'Add a name, street address, city and postal code.', true);
      var address = { line1: v('line1'), city: v('city'), postalCode: v('postalCode'), country: (v('country') || 'US').toUpperCase() };
      if (v('line2')) address.line2 = v('line2');
      if (v('state')) address.state = v('state');
      api('POST', '/addresses', { name: v('name'), address: address, isDefault: !!f.elements.isDefault.checked }).then(function (r) {
        if (!r.ok) return say(note, errText(r.json, 'That address could not be saved.'), true);
        load();
      });
    });
  }

  // Reorder and pay in one tap: the same lines at today's prices, charged to the kept card, to the saved address. If anything about
  // the order changed (sold out, price group, address) the server says so and nothing is charged — the shopper orders it again by hand.
  function payAgain(btn) {
    var id = btn.getAttribute('data-pay-again'), note = root.querySelector('[data-again-note="' + id + '"]');
    btn.disabled = true;
    say(note, 'Paying…');
    api('POST', '/orders/' + id + '/pay-again', {}).then(function (r) {
      if (r.ok && r.json && r.json.url) { window.location.href = r.json.url; return; }
      btn.disabled = false;
      say(note, errText(r.json, 'That order could not be paid just now. Use Order again instead.'), true);
    });
  }

  // Order again: the lines as they can be bought today go into the saved cart (the cart page works out the rest).
  function orderAgain(id) {
    var note = root.querySelector('[data-again-note="' + id + '"]');
    api('POST', '/orders/' + id + '/reorder', {}).then(function (r) {
      if (!r.ok) return say(note, 'That order could not be found.', true);
      var cart = [];
      try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); if (!Array.isArray(cart)) cart = []; } catch (e) { cart = []; }
      (r.json.items || []).forEach(function (it) {
        var max = it.maxQty == null ? null : Number(it.maxQty);
        var found = null;
        for (var i = 0; i < cart.length; i++) if (cart[i].sku === it.sku) { found = cart[i]; break; }
        var qty = Math.max(1, Number(it.quantity) || 1);
        if (found) { found.qty = Math.min((Number(found.qty) || 0) + qty, max == null ? 9999 : max); found.unitPriceCents = it.priceCents; found.maxQty = max; }
        else cart.push({ sku: it.sku, name: it.name, variantName: it.variantName && it.variantName !== 'Default' ? it.variantName : '', unitPriceCents: it.priceCents, imageUrl: it.imageUrl || '', qty: qty, maxQty: max });
      });
      try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
      var skipped = (r.json.skipped || []).map(function (s) { return s.name + ' (' + s.reason.toLowerCase() + ')'; });
      var short = (r.json.items || []).filter(function (it) { return it.note; }).map(function (it) { return it.name + ': ' + it.note.toLowerCase(); });
      if (!(r.json.items || []).length) return say(note, 'None of these can be bought again' + (skipped.length ? ': ' + skipped.join(', ') : '') + '.', true);
      say(note, 'Added to your cart.' + (skipped.length ? ' Not added: ' + skipped.join(', ') + '.' : '') + (short.length ? ' ' + short.join('; ') + '.' : ''));
      var a = document.createElement('a'); a.href = '/cart'; a.textContent = ' Go to your cart'; note.appendChild(a);
      if (window.StoreCart && window.StoreCart.count) { var c = document.querySelectorAll('[data-cart-count]'); c.forEach(function (el) { el.textContent = String(window.StoreCart.count()); }); }
    });
  }

  if (root.getAttribute('data-confirm')) showConfirm(); else load();
})();
