/* book.js — turns the story into a book you page through.
 *
 * Progressive enhancement: without this, every chapter is stacked on the page
 * at its natural height. With it, every page is the SAME fixed size (set in
 * CSS as --book-h) and text that does not fit a chapter's first page flows
 * onto continuation spreads — verso then recto, as many as it takes — so no
 * page is ever stretched to fit the longest chapter and none is left mostly
 * blank. Arrows, ← → keys, the chapter ribbon, swipe and the URL hash turn
 * pages; the ribbon always lands on a chapter's first page. Re-paginates on
 * resize and once fonts have loaded (line heights change). */
(function () {
  var book = document.querySelector('[data-book]');
  if (!book) return;
  var list = book.querySelector('.book__spreads');
  var originals = Array.prototype.slice.call(book.querySelectorAll('[data-book-spread]'));
  if (originals.length < 2 || !list) return;
  var prev = book.querySelector('[data-book-prev]'), next = book.querySelector('[data-book-next]');
  var tabs = Array.prototype.slice.call(book.querySelectorAll('[data-book-go]'));
  var hint = book.querySelector('[data-book-hint]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var spreads = [], cur = 0, busy = false;
  var chapterOf = [];   // spreads index → chapter index (for the ribbon)

  book.classList.add('book--js');
  [prev, next, hint].forEach(function (el) { if (el) el.hidden = false; });

  // Keep pristine copies so re-pagination (resize / fonts) starts clean.
  var pristine = originals.map(function (li) { return li.cloneNode(true); });

  function fits(body) { return body.scrollHeight <= body.clientHeight + 1; }

  function chapterMeta(chapterLi) {
    var running = chapterLi.querySelector('.page--recto .page__running');
    var txt = running ? running.textContent.replace(/ · continued$/, '') : '';
    var parts = txt.split(' · ');
    return { head: txt, chapter: parts[0] || '', years: parts[1] || '' };
  }

  function makeContinuation(chapterLi) {
    // A spread with two text pages carrying the chapter's running head.
    var m = chapterMeta(chapterLi);
    var li = document.createElement('li');
    li.className = 'book__spread book__spread--cont';
    li.setAttribute('data-book-spread', '');
    li.innerHTML =
      '<article class="spread">' +
        '<div class="page page--verso page--text"><div class="page__running"></div><div class="page__body page__body--cont"></div><div class="page__folio"></div></div>' +
        '<div class="page page--recto"><div class="page__running"></div><div class="page__body page__body--cont"></div><div class="page__foot"><span class="page__permalink"></span><span class="page__folio"></span></div></div>' +
      '</article>';
    var heads = li.querySelectorAll('.page__running');
    heads[0].textContent = m.head + ' · continued'; heads[1].textContent = m.head + ' · continued';
    var link = chapterLi.querySelector('.page__permalink');
    if (link) li.querySelector('.page__foot').replaceChild(link.cloneNode(true), li.querySelector('.page__permalink'));
    return li;
  }

  function fillerPlate(chapterLi) {
    // A spare page at the end of a chapter: its year plate when it has years,
    // otherwise its own pull quote (or title) set large — never a blank page.
    var m = chapterMeta(chapterLi);
    var d = document.createElement('div');
    d.className = 'page__plate';
    var quote = chapterLi.querySelector('.page__body blockquote');
    var title = chapterLi.querySelector('.page__title');
    if (m.years) {
      d.innerHTML = '<div class="plate plate--year"><span class="plate__year"></span><span class="plate__rule"></span><span class="plate__chapter"></span></div>';
      d.querySelector('.plate__year').textContent = m.years;
      d.querySelector('.plate__chapter').textContent = m.chapter;
    } else {
      d.innerHTML = '<div class="plate plate--year plate--quote"><span class="plate__quote"></span><span class="plate__rule"></span><span class="plate__chapter"></span></div>';
      var q = quote ? quote.textContent.trim().replace(/^[\"“]+|[\"”]+$/g, '') : (title ? title.textContent.trim() : '');
      d.querySelector('.plate__quote').textContent = q ? '“' + q + '”' : '';
      d.querySelector('.plate__chapter').textContent = m.chapter;
    }
    return d;
  }

  function nodeHeight(n) {
    var r = n.getBoundingClientRect().height;
    var cs = getComputedStyle(n);
    return r + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
  }

  // Split a paragraph at a sentence boundary so the head fits `page` (and, when a budget is
  // given, stays within it). Returns [head, tail] or null. Only plain paragraphs are split.
  function splitP(node, page, budget) {
    if (!node || node.tagName !== 'P' || node.querySelector('a, img')) return null;
    var text = node.textContent.replace(/\s+/g, ' ').trim();
    var sentences = text.match(/[^.!?]+[.!?]+["”’)]?\s*|[^.!?]+$/g);
    if (!sentences || sentences.length < 2) return null;
    var head = document.createElement('p'), tail = document.createElement('p');
    tail.className = 'page__runover';
    for (var k = sentences.length - 1; k >= 1; k--) {
      head.textContent = sentences.slice(0, k).join('').trim();
      page.appendChild(head);
      var ok = fits(page) && (budget === null || nodeHeight(head) <= budget + 26);
      page.removeChild(head);
      if (ok) { tail.textContent = sentences.slice(k).join('').trim(); return [head, tail]; }
    }
    return null;
  }

  // Fill `page` from the front of `queue`: as much as fits, or up to `target` px when balancing.
  function fillPage(page, queue, target) {
    var used = 0;
    while (queue.length) {
      var node = queue[0];
      page.appendChild(node);
      var h = nodeHeight(node);
      var over = !fits(page);
      var past = target !== null && queue.length > 1 && used + h > target + 18;
      if (over || past) {
        page.removeChild(node);
        var parts = splitP(node, page, over ? null : target - used);
        if (parts) { page.appendChild(parts[0]); queue[0] = parts[1]; return used + nodeHeight(parts[0]); }
        if (over) {
          if (page.children.length === 0) { page.appendChild(node); queue.shift(); return used + h; }   // one oversize block stays
          return used;
        }
        if (used < target * 0.7) { page.appendChild(node); queue.shift(); used += h; continue }   // can't split: keep it rather than leave the page short
        return used;
      }
      queue.shift(); used += h;
      if (target !== null && queue.length && used >= target - 18) return used;
    }
    return used;
  }

  function paginate() {
    while (list.firstChild) list.removeChild(list.firstChild);
    var chapters = pristine.map(function (li) { return li.cloneNode(true); });
    chapters.forEach(function (li) { list.appendChild(li); });
    spreads = []; chapterOf = [];

    chapters.forEach(function (li, ci) {
      spreads.push(li); chapterOf.push(ci);
      var body = li.querySelector('.page--recto .page__body');
      if (!body) return;
      li.classList.add('is-measuring');
      if (fits(body)) {
        // Lots of room? Take the type up a notch (never above 18px) so a short chapter does not sit in a sea of cream.
        var grow = ['17px', '18px'];
        for (var g = 0; g < grow.length; g++) {
          var was = body.style.fontSize; body.style.fontSize = grow[g]; body.style.lineHeight = '1.65';
          if (!fits(body)) { body.style.fontSize = was; body.style.lineHeight = was ? '1.65' : ''; break; }
        }
        li.classList.remove('is-measuring'); return;
      }
      // Nearly fits? Take the type down a notch (never below 15px) before breaking the chapter across pages.
      var shrink = ['15.5px', '15px'];
      for (var k = 0; k < shrink.length; k++) {
        body.style.fontSize = shrink[k]; body.style.lineHeight = '1.55';
        if (fits(body)) { li.classList.remove('is-measuring'); return; }
      }
      body.style.fontSize = ''; body.style.lineHeight = '';

      // Measure every block, then decide how many text pages the chapter needs.
      var nodes = Array.prototype.slice.call(body.children);
      var heights = nodes.map(nodeHeight);
      var total = heights.reduce(function (a, b) { return a + b; }, 0);
      nodes.forEach(function (n) { body.removeChild(n); });
      var cap1 = body.clientHeight;
      var probe = makeContinuation(li);
      li.parentNode.insertBefore(probe, li.nextSibling); probe.classList.add('is-measuring');
      var capN = probe.querySelector('.page__body').clientHeight;
      var pages = 1, room = cap1;
      while (room < total && pages < 40) { pages++; room += capN; }
      var room2 = cap1 + capN * (pages - 1);
      var target1 = total * cap1 / room2, target = total * capN / room2;   // balanced: each page as full as the others, relative to its room

      // Page 1: the chapter's own recto.
      var queue = nodes.slice();
      li.classList.remove('is-measuring');
      body.parentNode.parentNode.parentNode.classList.add('is-measuring');
      fillPage(body, queue, pages > 1 ? target1 : null);
      li.classList.remove('is-measuring');
      probe.parentNode.removeChild(probe);

      // Continuations: verso then recto; a spare recto gets the year plate.
      var guard = 0;
      while (queue.length && guard++ < 40) {
        var cont = makeContinuation(li);
        var after = spreads[spreads.length - 1];
        after.parentNode.insertBefore(cont, after.nextSibling);
        spreads.push(cont); chapterOf.push(ci);
        cont.classList.add('is-measuring');
        var bodies = cont.querySelectorAll('.page__body');
        fillPage(bodies[0], queue, queue.length ? target : null);
        if (queue.length) fillPage(bodies[1], queue, null);
        if (!bodies[1].children.length) {
          var recto = bodies[1].parentNode;
          recto.replaceChild(fillerPlate(li), bodies[1]);
        }
        cont.classList.remove('is-measuring');
      }
    });

    spreads.forEach(function (li, i) {
      var f = li.querySelectorAll('.page__folio');
      if (f[0]) f[0].textContent = String(i * 2 + 1);
      if (f[1]) f[1].textContent = String(i * 2 + 2);
    });
  }

  function idx(hash) {
    for (var i = 0; i < spreads.length; i++) if (spreads[i].id && spreads[i].id === hash) return i;
    return 0;
  }
  function firstOfChapter(ci) { for (var i = 0; i < spreads.length; i++) if (chapterOf[i] === ci) return i; return 0; }

  function show(i, dir, silent) {
    if (i < 0 || i >= spreads.length || (i === cur && !silent)) return;
    var from = spreads[cur], to = spreads[i];
    if (!silent && !reduce && from !== to) {
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
    var ci = chapterOf[i];
    tabs.forEach(function (t, j) { t.classList.toggle('is-active', j === ci); t.setAttribute('aria-current', j === ci ? 'page' : 'false'); });
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === spreads.length - 1;
    if (!silent) { var first = spreads[firstOfChapter(ci)]; if (first.id) history.replaceState(null, '', '#' + first.id); }
  }

  prev && prev.addEventListener('click', function () { if (!busy) show(cur - 1, -1); });
  next && next.addEventListener('click', function () { if (!busy) show(cur + 1, 1); });
  tabs.forEach(function (t, ci) { t.addEventListener('click', function (e) { e.preventDefault(); var i = firstOfChapter(ci); if (!busy) show(i, i > cur ? 1 : -1); }); });
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

  function layout(keepChapter) {
    var ci = keepChapter ? chapterOf[cur] : null;
    paginate();
    var start = ci !== null && ci !== undefined ? firstOfChapter(ci) : idx(location.hash.slice(1));
    show(start, 1, true);
  }
  layout(false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { layout(true); });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { layout(true); }, 150); });
})();
