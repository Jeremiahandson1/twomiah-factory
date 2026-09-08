/* console.js — wires the console's buttons and forms to /api/console/*.
 * Every response carries the fresh live state; we repaint the summary and
 * the row that changed. No framework; works on a cracked phone. */
(function () {
  var root = document.querySelector('main.con');
  if (!root) return;
  var toast = document.getElementById('toast');
  var tz = root.getAttribute('data-tz') || undefined;

  function say(msg, bad) {
    if (!toast) return;
    toast.textContent = msg; toast.hidden = false; toast.classList.toggle('is-bad', !!bad);
    clearTimeout(say._t); say._t = setTimeout(function () { toast.hidden = true; }, 2600);
  }
  function busy(el, on) { if (!el) return; el.disabled = !!on; el.classList.toggle('is-busy', !!on); }

  function paint(L) {
    if (!L) return;
    var set = function (k, v) { var el = root.querySelector('[data-live="' + k + '"]'); if (el) el.textContent = v; };
    set('kitchen.line', L.kitchen.line); set('bar.line', L.bar.line);
    var k = document.getElementById('lv-kitchen'); if (k) k.setAttribute('data-state', L.kitchen.isOpen ? 'open' : 'closed');
    var b = document.getElementById('lv-bar'); if (b) b.setAttribute('data-state', L.bar.isOpen ? 'open' : 'closed');
    set('room.label', L.room.label);
    set('special.text', L.special ? L.special.title + (L.special.price ? ', ' + L.special.price : '') : '—');
    set('game.text', L.game ? L.game.away + ' @ ' + L.game.home + ', ' + L.game.startsAtLabel : '—');
    set('taps.count', L.taps.count + ' pouring');
    root.querySelectorAll('[data-seg="room"]').forEach(function (btn) { btn.classList.toggle('is-on', btn.getAttribute('data-val') === L.room.status); });
  }

  function post(url, body, el) {
    busy(el, true);
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body || {}), credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (res) {
        busy(el, false);
        if (res.status === 401) { location.href = '/console/login?next=' + encodeURIComponent(location.pathname); return null; }
        if (!res.ok || !res.j || res.j.error) { say((res.j && res.j.error) || 'That did not save.', true); return null; }
        if (res.j.live) paint(res.j.live);
        say('Saved');
        return res.j;
      })
      .catch(function () { busy(el, false); say('No connection — not saved.', true); return null; });
  }

  // Plain buttons with data-post + data-body
  root.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-post]');
    if (!btn || btn.tagName === 'A') return;
    e.preventDefault();
    var body = {};
    try { body = JSON.parse(btn.getAttribute('data-body') || '{}'); } catch (err) {}
    var confirmMsg = btn.getAttribute('data-confirm');
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    post(btn.getAttribute('data-post'), body, btn).then(function (j) {
      if (!j) return;
      // 86 toggle: flip the row in place
      var id86 = btn.getAttribute('data-toggle86');
      if (id86) {
        var on = body.on === true;
        btn.classList.toggle('is-off', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        var st = btn.querySelector('.con-row__state'); if (st) st.textContent = on ? 'OUT' : 'on';
        btn.setAttribute('data-body', JSON.stringify({ id: id86, on: !on }));
      }
      // Tap rows: reload the list on any tap change
      if (j.taps) location.reload();
      // Inquiry: remove the row
      var inq = btn.getAttribute('data-inq');
      if (inq) { var li = root.querySelector('.con-inq[data-id="' + inq + '"]'); if (li) li.remove(); var c = document.getElementById('inq-count'); if (c) c.textContent = String(root.querySelectorAll('.con-inq').length); }
    });
  });

  // Forms with data-form
  root.addEventListener('submit', function (e) {
    var form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    var body = {};
    new FormData(form).forEach(function (v, k) { body[k] = v; });
    var submit = form.querySelector('[type="submit"]');
    post(form.getAttribute('data-form'), body, submit).then(function (j) {
      if (!j) return;
      if (j.taps || form.getAttribute('data-form').indexOf('/event') > -1 || form.getAttribute('data-form').indexOf('/tap') > -1) { setTimeout(function () { location.reload(); }, 400); }
    });
  });

  // Keep the summary honest while the phone sits on the bar.
  setInterval(function () {
    if (document.hidden) return;
    fetch('/api/console/state', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.live) paint(j.live); }).catch(function () {});
  }, 60000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/console/sw.js', { scope: '/console/' }).catch(function () {});
})();
