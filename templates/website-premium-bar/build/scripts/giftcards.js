/* giftcards.js — buying a gift card online. Loads Square's card form, takes
   the token, and posts it with the amount and names to /api/gift-cards/buy.
   One idempotency key per attempt, so a double tap never charges twice. */
(function () {
  var root = document.querySelector('.giftcards');
  var form = document.getElementById('gc-buy');
  if (!root || !form || !root.getAttribute('data-sdk')) return;
  var $ = function (id) { return document.getElementById(id); };
  var payBtn = $('gc-pay'), out = $('gc-msg-out'), card = null, busy = false, attemptKey = null;

  function say(t) { out.textContent = t || ''; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function amountCents() {
    var picked = form.querySelector('input[name="amount"]:checked');
    if (!picked) return 0;
    if (picked.value !== 'other') return Number(picked.value);
    var d = Number(String($('gc-other').value).replace(/[^\d.]/g, ''));
    return isFinite(d) ? Math.round(d * 100) : 0;
  }
  function paint() {
    var c = amountCents();
    payBtn.disabled = busy || !card || c < 500 || c > 50000;
    payBtn.textContent = busy ? 'Paying…' : c >= 500 && c <= 50000 ? 'Buy a $' + (c / 100).toFixed(2) + ' card' : 'Buy';
  }
  form.addEventListener('change', function () {
    $('gc-other-wrap').hidden = !(form.querySelector('input[name="amount"]:checked') || {}).value || form.querySelector('input[name="amount"]:checked').value !== 'other';
    paint();
  });
  $('gc-other').addEventListener('input', paint);

  var s = document.createElement('script');
  s.src = root.getAttribute('data-sdk');
  s.onload = function () {
    Promise.resolve().then(function () {
      return window.Square.payments(root.getAttribute('data-app-id'), root.getAttribute('data-location-id'));
    }).then(function (payments) {
      return payments.card({ style: { input: { color: '#1A1714' } } });
    }).then(function (c) {
      return c.attach('#gc-card').then(function () { card = c; paint(); });
    }).catch(function () { say('The card form did not load. Refresh, or buy one at the bar.'); });
  };
  s.onerror = function () { say('The card form did not load. Refresh, or buy one at the bar.'); };
  document.head.appendChild(s);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy || !card) return;
    var cents = amountCents();
    var fromName = $('gc-from-name').value.trim(), fromEmail = $('gc-from-email').value.trim();
    var toEmail = $('gc-to-email').value.trim();
    if (cents < 500 || cents > 50000) { say('Pick an amount from $5 to $500.'); return; }
    if (!fromName) { say('Put your name on it.'); $('gc-from-name').focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fromEmail)) { say('We need your email to send you the card number.'); $('gc-from-email').focus(); return; }
    if (toEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(toEmail)) { say("Their email doesn't look right."); $('gc-to-email').focus(); return; }
    busy = true; paint(); say('');
    attemptKey = attemptKey || uuid();
    card.tokenize({
      amount: (cents / 100).toFixed(2), currencyCode: 'USD', intent: 'CHARGE',
      billingContact: { givenName: fromName, email: fromEmail }, customerInitiated: true, sellerKeyedIn: false,
    }).then(function (result) {
      if (result.status !== 'OK') throw new Error((result.errors && result.errors[0] && result.errors[0].message) || 'Check the card details.');
      return fetch('/api/gift-cards/buy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCents: cents, purchaserName: fromName, purchaserEmail: fromEmail,
          recipientName: $('gc-to-name').value.trim(), recipientEmail: toEmail, message: $('gc-msg').value.trim(),
          sourceId: result.token, idempotencyKey: attemptKey,
        }),
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); });
    }).then(function (res) {
      if (!res.ok) { if (res.status !== 500) attemptKey = null; throw new Error(res.j.error || 'The payment did not go through.'); }
      form.hidden = true;
      $('gc-code').textContent = res.j.code;
      $('gc-done-note').textContent = '$' + (res.j.balanceCents / 100).toFixed(2) + ' on it. ' + (res.j.emailed ? 'We emailed the number too. ' : 'Write it down or take a screenshot. ') + 'Give the number at the bar.';
      $('gc-done').hidden = false; $('gc-done').focus();
    }).catch(function (err) {
      busy = false; paint();
      say(err && err.message ? err.message : 'The payment did not go through. Nothing was charged.');
    });
  });
  paint();
})();
