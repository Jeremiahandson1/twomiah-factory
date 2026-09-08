/* book.js — turns the story into a book you flip through. Progressive
 * enhancement: without this, every spread is stacked on the page. With it,
 * one spread shows at a time; arrows, ← → keys, the chapter ribbon and the
 * URL hash turn pages with a short 3D turn (none under reduced motion). */
(function () {
  var book = document.querySelector('[data-book]');
  if (!book) return;
  var spreads = Array.prototype.slice.call(book.querySelectorAll('[data-book-spread]'));
  if (spreads.length < 2) return;
  var prev = book.querySelector('[data-book-prev]'), next = book.querySelector('[data-book-next]');
  var tabs = Array.prototype.slice.call(book.querySelectorAll('[data-book-go]'));
  var hint = book.querySelector('[data-book-hint]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cur = 0, busy = false;

  book.classList.add('book--js');
  [prev, next, hint].forEach(function (el) { if (el) el.hidden = false; });

  function idx(hash) { var i = spreads.findIndex(function (s) { return s.id === hash; }); return i < 0 ? 0 : i; }
  function show(i, dir, silent) {
    if (i < 0 || i >= spreads.length || (i === cur && !silent)) return;
    var from = spreads[cur], to = spreads[i];
    if (!silent && !reduce) {
      busy = true;
      from.classList.add(dir > 0 ? 'is-turning-out' : 'is-turning-back');
      to.classList.add('is-active', dir > 0 ? 'is-turning-in' : 'is-turning-in-back');
      setTimeout(function () {
        from.classList.remove('is-active', 'is-turning-out', 'is-turning-back');
        to.classList.remove('is-turning-in', 'is-turning-in-back');
        busy = false;
      }, 620);
    } else {
      spreads.forEach(function (s) { s.classList.remove('is-active'); });
      to.classList.add('is-active');
    }
    cur = i;
    tabs.forEach(function (t, j) { t.classList.toggle('is-active', j === i); t.setAttribute('aria-current', j === i ? 'page' : 'false'); });
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === spreads.length - 1;
    if (!silent) history.replaceState(null, '', '#' + to.id);
  }

  prev && prev.addEventListener('click', function () { if (!busy) show(cur - 1, -1); });
  next && next.addEventListener('click', function () { if (!busy) show(cur + 1, 1); });
  tabs.forEach(function (t) { t.addEventListener('click', function (e) { e.preventDefault(); var i = Number(t.getAttribute('data-book-go')); if (!busy) show(i, i > cur ? 1 : -1); }); });
  document.addEventListener('keydown', function (e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { if (!busy) show(cur + 1, 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { if (!busy) show(cur - 1, -1); }
  });
  window.addEventListener('hashchange', function () { var i = idx(location.hash.slice(1)); if (i !== cur && !busy) show(i, i > cur ? 1 : -1); });

  // Swipe on touch
  var x0 = null;
  book.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  book.addEventListener('touchend', function (e) {
    if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) < 60 || busy) return;
    show(dx < 0 ? cur + 1 : cur - 1, dx < 0 ? 1 : -1);
  }, { passive: true });

  show(idx(location.hash.slice(1)), 1, true);
})();
