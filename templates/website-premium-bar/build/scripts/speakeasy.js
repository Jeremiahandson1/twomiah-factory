/* speakeasy.js — the door in the leather.
 *
 * Knock → the slot opens → password (a riddle from the bar's own story) → the
 * door swings → a cellar of riddle rooms → the Back Room, where the bar's
 * password of the week is waiting (/api/speakeasy, set from the console).
 * The overlay's CSS loads on the first knock, so the home page pays nothing
 * until someone plays. Keyboard: Enter answers, Esc closes. Progress is
 * remembered in localStorage so the door stays lit for people who know. */
(function () {
  var section = document.getElementById('speakeasy');
  var cfgEl = document.getElementById('speak-config');
  if (!section || !cfgEl) return;
  var cfg; try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }
  var openBtn = section.querySelector('[data-speak-open]');
  var statusEl = section.querySelector('[data-speak-status]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var KEY = 'amber.speakeasy.v1';
  var saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} }
  if (saved.solved) { section.classList.add('is-known'); if (statusEl) statusEl.textContent = 'You know the way.'; }

  var cssLoaded = false;
  function loadCss() {
    if (cssLoaded) return Promise.resolve();
    return new Promise(function (res) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/styles/speakeasy.css';
      l.onload = function () { cssLoaded = true; res(); }; l.onerror = res; document.head.appendChild(l);
    });
  }
  function buzz(p) { try { if (navigator.vibrate && !reduce) navigator.vibrate(p); } catch (e) {} }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, reduce ? Math.min(ms, 120) : ms); }); }

  var overlay = null, stage, lastFocus;
  function build() {
    overlay = el('div', 'spk'); overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'The door in the leather');
    var close = el('button', 'spk__close', '&times;'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.addEventListener('click', hide);
    stage = el('div', 'spk__stage');
    overlay.appendChild(close); overlay.appendChild(stage);
    overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    document.body.appendChild(overlay);
  }
  function scene(cls) { var s = el('div', 'spk__scene ' + (cls || '')); Array.prototype.forEach.call(stage.children, function (c) { c.classList.remove('is-on'); }); stage.appendChild(s); requestAnimationFrame(function () { s.classList.add('is-on'); }); return s; }
  function clearStage() { while (stage.firstChild) stage.removeChild(stage.firstChild); }
  function hide() { if (!overlay) return; overlay.hidden = true; document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  function show() {
    lastFocus = document.activeElement;
    loadCss().then(function () {
      if (!overlay) build();
      overlay.hidden = false; document.body.style.overflow = 'hidden';
      clearStage();
      doorScene();
    });
  }

  /* ── 1. The door ──────────────────────────────────────────────────── */
  function doorScene() {
    var s = scene('spk__scene--door');
    var wrap = el('div', 'spk__doorwrap'); var tpl = document.getElementById('spk-door-tpl'); wrap.appendChild(tpl ? tpl.content.firstElementChild.cloneNode(true) : el('div'));
    var light = el('div', 'spk__doorlight');
    var say = el('p', 'spk__say', 'Knock.');
    var line = el('p', 'spk__line', 'A door in the leather, at the back of the cover. Nobody uses the front during a dry spell.');
    var knock = el('button', 'spk__btn', 'Knock'); knock.type = 'button';
    var box = el('div'); box.style.position = 'relative'; box.style.width = '100%'; box.style.display = 'grid'; box.style.justifyItems = 'center'; box.appendChild(wrap); box.appendChild(light);
    s.appendChild(box); s.appendChild(say); s.appendChild(line); s.appendChild(knock);
    knock.focus();
    var tries = 0;
    knock.addEventListener('click', function () {
      knock.disabled = true; buzz([40, 80, 40, 80, 40]);
      wrap.classList.add('is-knocking');
      wait(750).then(function () {
        wrap.classList.remove('is-knocking'); wrap.classList.add('is-slot-open');
        say.textContent = 'Password?';
        line.textContent = cfg.password.question || 'What did George Berg sell over the counter in 1920?';
        knock.remove();
        var form = el('form', 'spk__form');
        var input = el('input', 'spk__input'); input.type = 'text'; input.autocomplete = 'off'; input.setAttribute('aria-label', 'Password'); input.placeholder = 'say it quiet';
        var go = el('button', 'spk__btn', 'Say it'); go.type = 'submit';
        form.appendChild(input); form.appendChild(go); s.appendChild(form);
        var small = el('p', 'spk__small', 'It is in <a href="/story/1920" target="_blank" rel="noopener">the story</a>.'); small.hidden = true; s.appendChild(small);
        input.focus();
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var a = norm(input.value); if (!a) return;
          var ok = (cfg.password.answers || []).some(function (x) { return norm(x) === a || (a.length > 3 && norm(x).indexOf(a) === 0); });
          if (!ok) {
            tries++; buzz(120);
            wrap.classList.add('is-slam'); wrap.classList.remove('is-slot-open');
            say.textContent = ['Beat it.', 'Never heard of it.', 'Wrong door, pal.'][Math.min(tries - 1, 2)];
            input.value = '';
            wait(900).then(function () { wrap.classList.remove('is-slam'); wrap.classList.add('is-slot-open'); say.textContent = 'Password?'; if (tries >= 2) { small.hidden = false; if (cfg.password.hint) line.textContent = cfg.password.hint; } input.focus(); });
            return;
          }
          buzz(60);
          say.textContent = 'Come in.'; form.remove(); small.remove(); line.textContent = '';
          light.classList.add('is-on'); wrap.classList.add('is-opening');
          saved.door = true; save();
          wait(1150).then(cellarScene);
        });
      });
    });
  }

  /* ── 2. The cellar of riddles ─────────────────────────────────────── */
  var ROOMS = [ // map coordinates for up to 6 rooms on a 500x300 parchment; the last is the Back Room
    { x: 40, y: 200, w: 80, h: 60, label: 'Trapdoor' },
    { x: 160, y: 200, w: 80, h: 60, label: 'Cold room' },
    { x: 160, y: 60, w: 80, h: 60, label: 'Coal bin' },
    { x: 290, y: 60, w: 80, h: 60, label: 'Bottles' },
    { x: 290, y: 200, w: 80, h: 60, label: 'Barrels' },
    { x: 400, y: 130, w: 84, h: 60, label: 'Back Room' }
  ];
  function cellarScene() {
    var riddles = cfg.riddles.slice(0, 5);
    var s = scene('spk__scene--cellar');
    var map = el('div', 'spk__map'); map.setAttribute('aria-hidden', 'true');
    var svg = '<svg viewBox="0 0 500 300"><defs><radialGradient id="spk-glow2" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFD98A" stop-opacity=".8"/><stop offset="1" stop-color="#FFD98A" stop-opacity="0"/></radialGradient></defs>';
    svg += '<text x="250" y="24" class="lbl" style="font-size:11px">Cellar · 840 East Madison · 1920</text>';
    var n = Math.min(riddles.length + 1, ROOMS.length);
    for (var i = 0; i < n - 1; i++) { var a = ROOMS[i], b = ROOMS[i + 1]; svg += '<line class="hall" data-h="' + i + '" x1="' + (a.x + a.w / 2) + '" y1="' + (a.y + a.h / 2) + '" x2="' + (b.x + b.w / 2) + '" y2="' + (b.y + b.h / 2) + '"/>'; }
    for (var j = 0; j < n; j++) { var r = ROOMS[j === n - 1 ? ROOMS.length - 1 : j]; svg += '<rect class="rm" data-r="' + j + '" x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="3"/><text class="lbl" x="' + (r.x + r.w / 2) + '" y="' + (r.y + r.h + 14) + '">' + r.label + '</text>'; }
    svg += '<circle class="lantern-glow" r="46" cx="0" cy="0" style="fill:url(#spk-glow2)"/><circle class="lantern" r="6" cx="0" cy="0"/><rect class="flash" x="0" y="0" width="500" height="120" rx="60"/></svg>';
    map.innerHTML = svg;
    var card = el('div', 'spk__card');
    var running = el('div', 'spk__running'); var dots = el('div', 'spk__dots');
    var q = el('p', 'spk__q'); var doors = el('div', 'spk__doors'); var msg = el('p', 'spk__msg');
    card.appendChild(running); card.appendChild(q); card.appendChild(doors); card.appendChild(msg); card.appendChild(dots);
    s.appendChild(map); s.appendChild(card);
    var lantern = map.querySelector('.lantern'), glow = map.querySelector('.lantern-glow');
    function moveTo(i) {
      var r = ROOMS[i === n - 1 ? ROOMS.length - 1 : i]; var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      lantern.style.transform = 'translate(' + cx + 'px,' + cy + 'px)'; glow.style.transform = 'translate(' + cx + 'px,' + cy + 'px)';
      Array.prototype.forEach.call(map.querySelectorAll('.rm'), function (rm, k) { rm.classList.toggle('is-here', k === i); rm.classList.toggle('is-lit', k < i); });
      Array.prototype.forEach.call(map.querySelectorAll('.hall'), function (h, k) { h.classList.toggle('is-lit', k < i); });
    }
    var at = 0;
    function ask() {
      var rd = riddles[at];
      running.innerHTML = '<span>Room ' + (at + 1) + ' of ' + riddles.length + '</span><span>' + ROOMS[at].label + '</span>';
      q.textContent = rd.question; msg.textContent = ''; doors.innerHTML = '';
      dots.innerHTML = riddles.map(function (_, k) { return '<i class="' + (k < at ? 'is-done' : '') + '"></i>'; }).join('');
      rd.doors.forEach(function (label, k) {
        var b = el('button', 'spk__choice', label); b.type = 'button';
        b.addEventListener('click', function () {
          if (k === rd.answer) {
            buzz(50); b.classList.add('is-right'); msg.textContent = rd.right || 'The lock turns.';
            Array.prototype.forEach.call(doors.children, function (c) { c.disabled = true; });
            at++;
            wait(650).then(function () { moveTo(at); return wait(700); }).then(function () { if (at >= riddles.length) backRoom(s); else ask(); });
          } else {
            buzz([60, 40, 60]); b.classList.add('is-wrong'); map.classList.add('is-caught');
            msg.textContent = rd.wrong || 'Dead end. A flashlight sweeps the wall. Back the way you came.';
            wait(900).then(function () { map.classList.remove('is-caught'); b.classList.remove('is-wrong'); });
          }
        });
        doors.appendChild(b);
      });
      doors.firstChild && doors.firstChild.focus();
    }
    moveTo(0); ask();
  }

  /* ── 3. The Back Room ─────────────────────────────────────────────── */
  function backRoom(prev) {
    saved.solved = true; saved.at = Date.now(); save();
    section.classList.add('is-known'); if (statusEl) statusEl.textContent = 'You know the way.';
    var s = scene('spk__scene--back');
    var plaque = el('div', 'spk__plaque');
    var h = el('h3', null, cfg.reward.title || 'The Back Room');
    var lead = el('p', null, 'You found it. Nobody who matters saw you come down.');
    var pw = el('div', 'spk__pw', '…');
    var note = el('p', null, cfg.reward.fallback || 'Say it at the bar.');
    plaque.appendChild(h); plaque.appendChild(lead); plaque.appendChild(pw); plaque.appendChild(note);
    var row = el('div', 'spk__row');
    var copy = el('button', 'spk__btn spk__btn--ghost', 'Copy the password'); copy.type = 'button';
    var again = el('button', 'spk__btn spk__btn--ghost', 'Back to the cover'); again.type = 'button'; again.addEventListener('click', hide);
    row.appendChild(copy); row.appendChild(again);
    s.appendChild(plaque); s.appendChild(row);
    copy.addEventListener('click', function () { try { navigator.clipboard.writeText(pw.textContent); copy.textContent = 'Copied'; } catch (e) {} });
    fetch('/api/speakeasy', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.password) { pw.textContent = j.password; if (j.note) note.textContent = j.note; }
      else { pw.textContent = 'ROOT BEER, IMPROVED'; note.textContent = cfg.reward.fallback || 'Say it at the bar and see what happens.'; }
    }).catch(function () { pw.textContent = 'ROOT BEER, IMPROVED'; });
    again.focus();
  }

  openBtn.addEventListener('click', show);
  // Warm the CSS when the door scrolls into view, so the first knock is instant.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { loadCss(); io.disconnect(); } });
    io.observe(section);
  }
})();
