/* kitchen.js — the grill screen, live. The server pushes a fresh state over
   server-sent events on every change; this file ticks the timers and cues
   every second with the same pacing code the server uses
   (/kitchen/pacing.js is lib/kitchen/pacing.ts, bundled). Bump is optimistic
   with an Undo; sound and keep-awake start on the first tap (browsers
   require one). */
import { paceTicket, cueFor, ageState, startNow, allDay } from '/kitchen/pacing.js';

var $ = function (id) { return document.getElementById(id); };
var state = JSON.parse($('k-state').textContent);
var offset = state.serverNow - Date.now();          // trust the server clock, not the tablet's
var known = new Set(state.open.map(function (t) { return t.id; }));
var hidden = new Set();                              // optimistically bumped, waiting for the server
var soundOn = false, audioCtx = null, wakeLock = null, toastTimer = null;
var AGE_WORD = { fresh: '', warn: ' · Waiting', late: ' · Late' };
var now = function () { return Date.now() + offset; };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function group(list) { return list.map(function (x) { return (x.qty > 1 ? x.qty + ' ' : '') + x.name; }).join(' · '); }
function itemLine(i) { return (i.qty > 1 ? i.qty + ' × ' : '') + i.name + (i.variation ? ' (' + String(i.variation).toLowerCase() + ')' : ''); }
function openTickets() { return state.open.filter(function (t) { return !hidden.has(t.id); }); }

// ─── Render ────────────────────────────────────────────────────────────────
function renderTickets(newIds) {
  var list = openTickets();
  $('k-tickets').innerHTML = list.map(function (t) {
    return '<article class="kds-ticket' + (newIds && newIds.has(t.id) ? ' is-new' : '') + '" data-id="' + esc(t.id) + '" data-source="' + esc(t.source) + '">' +
      '<header class="kds-ticket__head"><h2 class="kds-ticket__label">' + esc(t.label) + '</h2><span class="kds-ticket__age mono"></span></header>' +
      (t.recalled ? '<p class="kds-ticket__flag">Recalled</p>' : '') +
      '<ul class="kds-ticket__items">' + t.items.map(function (i) {
        return '<li><span class="kds-ticket__item">' + esc(itemLine(i)) + '</span>' +
          (i.seat ? '<span class="kds-ticket__seat">seat ' + esc(i.seat) + '</span>' : '') +
          (i.note ? '<span class="kds-ticket__note">' + esc(i.note) + '</span>' : '') + '</li>';
      }).join('') + '</ul>' +
      (t.note ? '<p class="kds-ticket__tnote">' + esc(t.note) + '</p>' : '') +
      '<p class="kds-ticket__cue"></p>' +
      '<form method="POST" action="/kitchen/bump/' + esc(t.id) + '" class="kds-ticket__bumpform"><button class="kds-bump" type="submit" data-bump="' + esc(t.id) + '">Bump</button></form>' +
      '</article>';
  }).join('');
  $('k-empty').hidden = list.length > 0;
  $('k-count').textContent = list.length + ' open';
  $('k-bumped').innerHTML = state.bumped.length
    ? state.bumped.map(function (b) { return '<li><span>' + esc(b.label) + '</span><button class="kds-btn" type="button" data-recall="' + esc(b.id) + '">Bring back</button></li>'; }).join('')
    : '<li class="kds-muted">Nothing bumped yet.</li>';
  tick();
}

// Every second: ages, colors, cues, the strips, the clock. Text only, so a finger mid-tap never loses its button.
function tick() {
  var n = now();
  var list = openTickets();
  var paced = [];
  list.forEach(function (t) {
    var p = paceTicket(t.firedAt, t.items);
    paced.push(p);
    var el = document.querySelector('.kds-ticket[data-id="' + CSS.escape(t.id) + '"]');
    if (!el) return;
    var age = ageState(t.firedAt, n, state.warnSeconds, state.lateSeconds);
    el.setAttribute('data-age', age);
    el.querySelector('.kds-ticket__age').textContent = Math.floor((n - t.firedAt) / 60000) + ' min' + AGE_WORD[age];
    var cue = cueFor(p, n);
    var c = el.querySelector('.kds-ticket__cue');
    c.textContent = cue.text; c.setAttribute('data-state', cue.state);
  });
  var sn = startNow(paced, n);
  $('k-now').hidden = !sn.length; $('k-now-v').textContent = group(sn);
  var ad = allDay(list);
  $('k-allday').hidden = !ad.length; $('k-allday-v').textContent = group(ad);
  $('k-clock').textContent = new Date(n).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function setState(next) {
  offset = next.serverNow - Date.now();
  var fresh = new Set();
  next.open.forEach(function (t) { if (!known.has(t.id)) fresh.add(t.id); });
  known = new Set(next.open.map(function (t) { return t.id; }));
  hidden.forEach(function (id) { if (!known.has(id)) hidden.delete(id); });   // server agrees it's bumped
  state = next;
  renderTickets(fresh);
  if (fresh.size) chime();
}

// ─── Live updates ──────────────────────────────────────────────────────────
function conn(s, text) { var el = $('k-conn'); el.setAttribute('data-state', s); el.textContent = text; }
function connect() {
  var es = new EventSource('/api/kitchen/stream');
  es.addEventListener('state', function (e) { conn('live', 'Live'); setState(JSON.parse(e.data)); });
  es.addEventListener('ping', function () { conn('live', 'Live'); });
  es.onerror = function () {
    conn('down', 'Reconnecting…');
    // A dead session shows up as an error too; check, and send them to the PIN screen if so.
    fetch('/api/kitchen/state', { credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) location.href = '/console/login?next=/kitchen';
    }).catch(function () {});
  };
}

// ─── Bump / undo / recall ──────────────────────────────────────────────────
function post(url, body) {
  return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { if (r.status === 401) { location.href = '/console/login?next=/kitchen'; return null; } return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
}
function toast(html, bad) {
  var t = $('k-toast'); t.innerHTML = html; t.hidden = false; t.classList.toggle('is-bad', !!bad);
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 8000);
}
function bump(id) {
  var t = state.open.find(function (x) { return x.id === id; });
  hidden.add(id); renderTickets();
  post('/api/kitchen/bump', { id: id }).then(function (res) {
    if (!res) return;
    if (!res.ok && res.j && res.j.error !== 'Already bumped.') { hidden.delete(id); renderTickets(); toast(esc(res.j.error || 'Bump did not save.'), true); return; }
    toast('Bumped ' + esc(t ? t.label : '') + ' <button class="kds-btn" type="button" data-recall="' + esc(id) + '">Undo</button>');
  }).catch(function () { hidden.delete(id); renderTickets(); toast('No connection. Not bumped.', true); });
}
function recall(id) {
  post('/api/kitchen/recall', { id: id }).then(function (res) {
    if (!res) return;
    $('k-toast').hidden = true;
    if (!res.ok) toast(esc((res.j && res.j.error) || 'Could not bring it back.'), true);
    $('k-recall').open = false;
  }).catch(function () { toast('No connection.', true); });
}

document.addEventListener('submit', function (e) {
  var f = e.target.closest('.kds-ticket__bumpform'); if (!f) return;
  e.preventDefault();
  var b = f.querySelector('[data-bump]'); if (b) bump(b.getAttribute('data-bump'));
});
document.addEventListener('click', function (e) {
  var r = e.target.closest('[data-recall]'); if (r) { recall(r.getAttribute('data-recall')); return; }
});

// ─── Sound + keep-awake (need one tap to start; browsers insist) ──────────
function chime() {
  if (!soundOn || !audioCtx) return;
  [0, 0.18].forEach(function (d, i) {
    var o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = i ? 1175 : 880;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime + d);
    g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + d + 0.35);
    o.connect(g).connect(audioCtx.destination); o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + 0.4);
  });
}
var soundBtn = $('k-sound');
soundBtn.hidden = false;
soundBtn.addEventListener('click', function () {
  soundOn = !soundOn;
  if (soundOn && !audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (err) { soundOn = false; } }
  soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  soundBtn.textContent = soundOn ? 'Sound on' : 'Sound off';
  try { localStorage.setItem('kds-sound', soundOn ? '1' : '0'); } catch (err) {}
  if (soundOn) chime();
});
function keepAwake() {
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; l.addEventListener('release', function () { wakeLock = null; }); }).catch(function () {});
}
document.addEventListener('pointerdown', keepAwake, { once: false, passive: true });
document.addEventListener('visibilitychange', keepAwake);

renderTickets();
setInterval(tick, 1000);
conn('down', 'Connecting…');
connect();
keepAwake();
