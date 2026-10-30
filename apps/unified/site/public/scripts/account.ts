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
      '<p>Enter the email you ordered with. We will send you a link and a six-digit code. There is no password to remember.</p>' +
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
        if (!r.ok) return say(note, (r.json && r.json.error && r.json.error.message) || (r.json && r.json.message) || 'Enter a valid email address.', true);
        say(note, r.json.message || 'If that email belongs to a customer of this shop, we have sent a sign-in link and a code.');
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
      Promise.all([api('GET', '/orders'), api('GET', '/addresses')]).then(function (both) {
        draw(me.json, (both[0].json && both[0].json.data) || [], (both[1].json && both[1].json.data) || []);
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
      '<span class="account-note" data-again-note="' + esc(o.id) + '" role="status"></span>' +
      '</article>';
  }

  function addressHtml(a) {
    return '<div class="account-address" data-address="' + esc(a.id) + '">' +
      '<p><strong>' + esc(a.label || a.name) + '</strong>' + (a.isDefault ? ' <span class="account-status">Default</span>' : '') + '<br>' + addressLines(a.address) + '</p>' +
      (a.isDefault ? '' : '<button type="button" class="btn btn--secondary" data-default="' + esc(a.id) + '">Make default</button> ') +
      '<button type="button" class="btn btn--secondary" data-remove="' + esc(a.id) + '">Remove</button></div>';
  }

  function draw(me, orders, addresses) {
    var bits = [];
    if (me.group) bits.push('<span class="account-status">' + esc(me.group) + ' prices</span>');
    if (me.points != null) bits.push('<span class="account-muted">' + esc(me.points) + ' reward points</span>');
    root.innerHTML =
      '<div class="account-head"><div><h2>' + esc(me.name || 'Hello') + '</h2><p class="account-muted">' + esc(me.email) + '</p>' + bits.join(' ') + '</div>' +
      '<button type="button" class="btn btn--secondary" id="account-out">Sign out</button></div>' +
      '<section class="account-section"><h2>Your orders</h2>' +
      (orders.length ? orders.map(orderHtml).join('') : '<p class="store-empty">No orders yet. <a href="/shop">Start shopping</a></p>') + '</section>' +
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
        if (!r.ok) return say(note, (r.json && r.json.error && r.json.error.message) || 'That address could not be saved.', true);
        load();
      });
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
