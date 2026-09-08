/* live.js — keeps the Tonight Board honest after first paint.
 * ~1.5 KB, no dependencies. Polls /api/live every 60 s (paused when the tab
 * is hidden), swaps values with a short fade, and re-derives the countdown
 * every 30 s from the ISO timestamps the server sent so the clock keeps
 * moving between polls. Everything degrades to the server-rendered state. */
(function () {
  var root = document.querySelector('[data-live-root]');
  if (!root || !window.fetch) return;
  var tz = root.getAttribute('data-live-tz') || undefined;
  var POLL = 60000, TICK = 30000, timer = null;

  function q(name) { return root.querySelector('[data-live="' + name + '"]'); }
  function row(name) { return root.querySelector('[data-live-row="' + name + '"]'); }
  function setText(name, text) {
    var el = q(name); if (!el) return;
    if (el.textContent === text) return;
    el.classList.add('is-updating');
    setTimeout(function () { el.textContent = text; el.classList.remove('is-updating'); }, 180);
  }
  function show(name, on) { var el = row(name); if (el) { if (on) el.removeAttribute('hidden'); else el.setAttribute('hidden', ''); } }
  function fmtCountdown(ms) {
    if (ms < 60000) return 'under a minute';
    var mins = Math.floor(ms / 60000), h = Math.floor(mins / 60), m = mins % 60;
    if (h === 0) return m + 'm';
    return m === 0 ? h + 'h' : h + 'h ' + m + 'm';
  }
  function fmtTime(iso) {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); } catch (e) { return ''; }
  }

  function tick() {
    ['kitchen', 'bar'].forEach(function (d) {
      var el = q(d + '.countdown'); if (!el) return;
      var target = el.getAttribute('data-closes-at') || el.getAttribute('data-opens-at');
      if (!target) { el.textContent = ''; return; }
      var ms = new Date(target).getTime() - Date.now();
      if (ms <= 0) { refresh(); return; }
      el.textContent = '(' + fmtCountdown(ms) + ')';
    });
  }

  function apply(L) {
    ['kitchen', 'bar'].forEach(function (d) {
      var s = L[d]; if (!s) return;
      var r = row(d); if (r) r.setAttribute('data-state', s.isOpen ? 'open' : 'closed');
      setText(d + '.state', s.isOpen ? 'Open' : 'Closed');
      setText(d + '.short', s.short || '');
      var c = q(d + '.countdown');
      if (c) { c.setAttribute('data-closes-at', s.closesAt || ''); c.setAttribute('data-opens-at', s.opensAt || ''); }
    });
    if (L.taps) {
      show('taps', L.taps.count > 0);
      setText('taps.count', String(L.taps.count));
      setText('taps.noun', L.taps.count === 1 ? 'line' : 'lines');
      var names = (L.taps.featured || []).map(function (t) { return t.name; }).filter(Boolean);
      setText('taps.names', names.length ? '— ' + names.join(', ') : '');
    }
    show('game', !!L.game);
    if (L.game) {
      setText('game.label', L.game.isToday ? 'Tonight' : 'Game');
      setText('game.text', L.game.away + ' @ ' + L.game.home + ', ' + L.game.startsAtLabel);
      setText('game.note', L.game.note ? '— ' + L.game.note : '');
    }
    show('special', !!L.special);
    if (L.special) {
      setText('special.text', L.special.title + (L.special.price ? ', ' + L.special.price : ''));
      setText('special.description', L.special.description ? '— ' + L.special.description : '');
    }
    if (L.room) { var rr = row('room'); if (rr) rr.setAttribute('data-state', L.room.status); setText('room.label', L.room.label); }
    show('note', !!L.note);
    setText('note', L.note || '');
    var t = q('generatedAt');
    if (t && L.generatedAt) { t.setAttribute('datetime', L.generatedAt); t.textContent = fmtTime(L.generatedAt); }
    tick();
  }

  function refresh() {
    fetch('/api/live', { cache: 'no-store', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (L) { if (L) apply(L); })
      .catch(function () { /* keep the server-rendered state */ });
  }

  function start() { if (timer) return; refresh(); timer = setInterval(refresh, POLL); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
  setInterval(tick, TICK);
  tick();
  start();
})();
