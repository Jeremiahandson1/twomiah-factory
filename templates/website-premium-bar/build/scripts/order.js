/* order.js — the /order cart. Keeps the cart in localStorage, asks the server
   (which asks Square) for tax and total, loads Square's card form only once
   there is something to pay for, and posts the card token + cart to
   /api/order/pay. The server re-prices everything; nothing here is trusted. */
(function () {
  var root = document.querySelector('.order[data-app-id]');
  if (!root) return;
  var OPEN = root.getAttribute('data-open') === '1';
  var KEY = 'amber-order-v2';   // v2: sizes are ours (item + size id); v1 carts held Square ids
  var $ = function (id) { return document.getElementById(id); };
  var msg = $('order-msg'), payBtn = $('pay'), form = $('checkout');
  var cart = load();
  var totals = null, quoteTimer = null, card = null, sdkLoading = null, busy = false;
  var attemptKey = null;

  function load() { try { var c = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(c) ? c : []; } catch (e) { return []; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) {} }
  function money(c) { return c % 100 === 0 ? '$' + (c / 100) : '$' + (c / 100).toFixed(2); }
  function say(t) { msg.textContent = t || ''; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) { var r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  // Items still on the menu (the page is the truth for what can be added).
  var onMenu = {};
  document.querySelectorAll('.order-add').forEach(function (b) {
    onMenu[b.getAttribute('data-item') + '|' + b.getAttribute('data-var')] = true;
    if (OPEN) b.disabled = false;
  });
  cart = cart.filter(function (l) { return onMenu[l.itemId + '|' + l.sizeId]; });

  root.addEventListener('click', function (e) {
    var add = e.target.closest('.order-add');
    if (add && OPEN) {
      var v = add.getAttribute('data-var'), itemId = add.getAttribute('data-item');
      var line = cart.find(function (l) { return l.itemId === itemId && l.sizeId === v && !l.note; });
      if (line) line.qty = Math.min(20, line.qty + 1);
      else cart.push({ itemId: itemId, sizeId: v, qty: 1, note: '', name: add.getAttribute('data-name'), variation: add.getAttribute('data-vname'), priceCents: Number(add.getAttribute('data-price')) });
      changed();
      say(add.getAttribute('data-name') + ' added.');
      return;
    }
    var q = e.target.closest('[data-qty]');
    if (q) {
      var i = Number(q.getAttribute('data-i'));
      cart[i].qty += Number(q.getAttribute('data-qty'));
      if (cart[i].qty < 1) cart.splice(i, 1); else cart[i].qty = Math.min(20, cart[i].qty);
      changed();
    }
  });
  $('cart-lines').addEventListener('change', function (e) {
    var n = e.target.closest('[data-note]');
    if (!n) return;
    cart[Number(n.getAttribute('data-note'))].note = n.value.slice(0, 140);
    save(); requote();
  });

  function render() {
    var ul = $('cart-lines'); ul.innerHTML = '';
    var count = 0;
    cart.forEach(function (l, i) {
      count += l.qty;
      var li = document.createElement('li');
      li.className = 'order__line';
      var label = l.name + (l.variation && l.variation !== 'Regular' ? ' (' + l.variation.toLowerCase() + ')' : '');
      li.innerHTML =
        '<div class="order__line-top"><span class="order__line-name"></span><span class="mono">' + money(l.priceCents * l.qty) + '</span></div>' +
        '<div class="order__line-ctl">' +
          '<button type="button" class="order__qty" data-qty="-1" data-i="' + i + '" aria-label="One less">−</button>' +
          '<span class="mono" aria-label="Quantity">' + l.qty + '</span>' +
          '<button type="button" class="order__qty" data-qty="1" data-i="' + i + '" aria-label="One more">+</button>' +
          '<label class="visually-hidden" for="note-' + i + '">Note for this item</label>' +
          '<input class="order__note-in" id="note-' + i + '" data-note="' + i + '" maxlength="140" placeholder="Side, no onions…">' +
        '</div>';
      li.querySelector('.order__line-name').textContent = label;
      li.querySelector('input').value = l.note || '';
      ul.appendChild(li);
    });
    $('cart-count').textContent = count ? '(' + count + ')' : '';
    $('cart-empty').hidden = cart.length > 0;
    form.hidden = !cart.length || !OPEN;
    paintTotals();
  }

  function paintTotals() {
    var t = $('cart-totals');
    if (!cart.length) { t.hidden = true; return; }
    t.hidden = false;
    var est = cart.reduce(function (s, l) { return s + l.priceCents * l.qty; }, 0);
    $('t-sub').textContent = money(totals ? totals.subtotalCents : est);
    $('t-tax').textContent = totals ? money(totals.taxCents) : '…';
    $('t-total').textContent = totals ? money(totals.totalCents) : '…';
    payBtn.textContent = totals ? 'Pay ' + money(totals.totalCents) : 'Pay';
    payBtn.disabled = !totals || !card || busy;
  }

  function changed() { save(); attemptKey = null; render(); requote(); if (cart.length) loadCard(); }

  function lines() { return cart.map(function (l) { return { itemId: l.itemId, sizeId: l.sizeId, qty: l.qty, note: l.note }; }); }

  function requote() {
    totals = null; paintTotals();
    clearTimeout(quoteTimer);
    if (!cart.length || !OPEN) return;
    quoteTimer = setTimeout(function () {
      fetch('/api/order/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: lines() }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { if (res.ok) { totals = res.j; say(''); } else say(res.j.error || 'Could not price the order.'); paintTotals(); })
        .catch(function () { say('No connection. Try again.'); });
    }, 350);
  }

  function loadCard() {
    if (card || sdkLoading || !OPEN) return sdkLoading;
    sdkLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = root.getAttribute('data-sdk'); s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    }).then(function () {
      return window.Square.payments(root.getAttribute('data-app-id'), root.getAttribute('data-location-id'));
    }).then(function (payments) {
      return payments.card({ style: { input: { color: '#1A1714' } } });
    }).then(function (c) {
      return c.attach('#card').then(function () { card = c; paintTotals(); });
    }).catch(function () {
      sdkLoading = null;
      say('The card form did not load. Refresh, or call the bar.');
    });
    return sdkLoading;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy || !card || !totals) return;
    var name = $('o-name').value.trim(), phone = $('o-phone').value.trim();
    if (!name) { say('Put a name on the order.'); $('o-name').focus(); return; }
    if (phone.replace(/\D/g, '').length < 10) { say('We need a phone number.'); $('o-phone').focus(); return; }
    busy = true; paintTotals(); payBtn.textContent = 'Paying…'; say('');
    attemptKey = attemptKey || uuid();
    card.tokenize({
      amount: (totals.totalCents / 100).toFixed(2), currencyCode: 'USD', intent: 'CHARGE',
      billingContact: { givenName: name, phone: phone }, customerInitiated: true, sellerKeyedIn: false,
    }).then(function (result) {
      if (result.status !== 'OK') throw new Error((result.errors && result.errors[0] && result.errors[0].message) || 'Check the card details.');
      return fetch('/api/order/pay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: lines(), name: name, phone: phone, textUpdates: $('o-texts').checked, sourceId: result.token, idempotencyKey: attemptKey }),
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
    }).then(function (res) {
      if (!res.ok) { attemptKey = null; throw new Error(res.j.error || 'The payment did not go through.'); }
      cart = []; save();
      location.href = res.j.url;
    }).catch(function (err) {
      busy = false; paintTotals();
      say(err && err.message ? err.message : 'The payment did not go through. Nothing was charged.');
    });
  });

  render();
  if (cart.length && OPEN) { requote(); loadCard(); }
})();
