/* clock.js — the time clock keypad. The PIN is sent once and never kept. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = JSON.parse($('ck-state').textContent);   // { on: [{ name, startAt, forgotten }], serverNow }
  var offset = S.serverNow - Date.now(), busy = false, clearTimer = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function since(iso) {
    var m = Math.max(0, Math.round((Date.now() + offset - new Date(iso).getTime()) / 60000));
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  function clockTime(iso) { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function renderOn() {
    $('ck-on').innerHTML = S.on.length ? S.on.map(function (p) {
      return '<li data-forgot="' + (p.forgotten ? 1 : 0) + '"><span>' + esc(p.name) + '</span><span class="clk-since">in at ' + clockTime(p.startAt) + ' · ' + since(p.startAt) + (p.forgotten ? ' · forgot to clock out?' : '') + '</span></li>';
    }).join('') : '<li><span class="clk-since">Nobody is clocked in.</span></li>';
  }
  function say(t, kind) {
    var m = $('ck-msg'); m.textContent = t; m.setAttribute('data-kind', kind || '');
    clearTimeout(clearTimer); clearTimer = setTimeout(function () { m.textContent = ''; }, 8000);
  }
  document.querySelector('.clk-keys').addEventListener('click', function (e) {
    var b = e.target.closest('[data-k]'); if (!b) return;
    var k = b.getAttribute('data-k'), el = $('ck-pin');
    if (k === 'clear') el.value = ''; else if (el.value.length < 8) el.value += k;
  });
  $('ck-form').addEventListener('submit', function (e) {
    e.preventDefault(); if (busy) return;
    var pin = $('ck-pin').value.replace(/\D/g, '');
    if (pin.length < 4) { say('Type your PIN.', 'bad'); return; }
    busy = true; $('ck-pin').value = '';
    fetch('/api/register/clock', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pin }) }).then(function (r) {
      if (r.status === 401) { location.href = '/console/login?next=/register/clock'; return; }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { say(j.error || 'That did not go through.', 'bad'); return; }
        S.on = j.on; renderOn();
        if (j.action === 'in') say(j.name + ', you\'re clocked in at ' + clockTime(j.shift.startAt) + '.', 'in');
        else say(j.name + ', you\'re clocked out. ' + j.hours.toFixed(2) + ' hours.', 'out');
      });
    }).catch(function () { say('No connection. Try again.', 'bad'); }).then(function () { busy = false; });
  });
  renderOn(); setInterval(renderOn, 60000);
  $('ck-pin').focus();
})();
