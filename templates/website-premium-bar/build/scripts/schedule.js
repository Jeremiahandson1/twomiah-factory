/* schedule.js — asking for a day off (your own PIN), and Print. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var form = $('off-form'), msg = $('off-msg'), busy = false;
  function say(t, bad) { msg.textContent = t; if (bad) msg.setAttribute('data-bad', '1'); else msg.removeAttribute('data-bad'); }
  form.addEventListener('submit', function (e) {
    e.preventDefault(); if (busy) return;
    var day = $('off-day').value, pin = $('off-pin').value.replace(/\D/g, '');
    if (!day) { say('Pick the day.', true); return; }
    if (pin.length < 4) { say('Type your PIN.', true); return; }
    busy = true; $('off-pin').value = '';
    fetch('/api/register/time-off', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day: day, note: $('off-note').value, pin: pin }) }).then(function (r) {
      if (r.status === 401) { location.href = '/console/login?next=/register/schedule'; return; }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { say(j.error || 'That did not go through.', true); return; }
        var nice = new Date(j.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
        say(j.name + ', you asked for ' + nice + ' off. The owner will say yes or no.');
        $('off-day').value = ''; $('off-note').value = '';
      });
    }).catch(function () { say('No connection. Try again.', true); }).then(function () { busy = false; });
  });
  $('sch-print').addEventListener('click', function () { window.print(); });
})();
