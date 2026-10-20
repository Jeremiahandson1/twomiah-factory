// Twomiah Bookings — the booking pages' script (server/booking/pages.ts). Pick a day, a time, then your details;
// or, with a booking's token, a new time for it. No framework. Every answer comes from /api/book: which days are
// open, which times are free, and the refusal in the business's words when a time can't be had.
//
// From the premium site's build/scripts/book-flow.js, with: days from the server (the site drew 14 from the
// visitor's own clock, full days included); a reschedule page that runs (it stopped on a field only the new-booking
// form has); the waitlist reachable; and a taken time reloading the day instead of leaving it on screen.
(function () {
  'use strict'

  // Inside an iframe (the embed), tell the parent page our height so it can size the frame.
  if (window.parent !== window && 'ResizeObserver' in window) {
    var post = function () {
      try { window.parent.postMessage({ type: 'twomiah-book-height', height: document.documentElement.scrollHeight }, '*') } catch (e) { /* cross-origin */ }
    }
    new ResizeObserver(post).observe(document.body)
    setTimeout(post, 50)
  }

  // A form that asks first (the manage page's cancel).
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) { if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault() })
  })

  var root = document.getElementById('book-flow')
  if (!root) return
  var slug = root.getAttribute('data-service')
  var token = root.getAttribute('data-token') || ''
  // Framed on another website (?embed=1): its pages stay in the frame; paying a deposit is a click on the booking's page
  // there, which opens Stripe in the whole window (Stripe's page can't be framed, and the frame can't send the window there by itself).
  var embed = root.getAttribute('data-embed') === '1'
  var $ = function (sel) { return root.querySelector(sel) }
  var stepDate = $('.book-step--date'), stepSlot = $('.book-step--slot'), stepForm = $('.book-step--form'), stepWait = $('.book-step--waitlist')
  var datesEl = document.getElementById('book-dates'), slotsEl = document.getElementById('book-slots')
  var zipInput = document.getElementById('book-zip'), chosen = document.getElementById('book-chosen')
  var form = document.getElementById('book-form'), errorEl = document.getElementById('book-error')
  var api = '/api/book/services/' + encodeURIComponent(slug)
  var picked = { date: null, time: null, label: '' }
  var loadedAt = String(Date.now())
  root.querySelectorAll('input[name="t"]').forEach(function (i) { i.value = loadedAt })

  var zip = function () { return zipInput ? zipInput.value.trim() : '' }
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] }) }
  // A YYYY-MM-DD is a calendar day, not an instant: format it as the day itself, whatever the visitor's zone.
  var day = function (iso, opts) { var p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, opts)) }

  function step(name) {
    var order = { date: 0, slot: 1, form: 2 }
    root.querySelectorAll('.book-progress__step').forEach(function (el) {
      var mine = order[el.getAttribute('data-step')]
      el.classList.toggle('is-active', mine === order[name])
      el.classList.toggle('is-done', mine < order[name])
    })
  }
  function getJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (body) { if (!r.ok) throw new Error(body.error || 'Something went wrong.'); return body })
    })
  }
  function postJson(url, data) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) }).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (body) { if (!r.ok) { var e = new Error(body.error || 'Something went wrong.'); e.code = body.code; throw e } return body })
    })
  }
  function showError(el, msg) { if (!el) return; el.textContent = msg; el.hidden = !msg }

  function loadDates() {
    stepSlot.hidden = true; stepForm.hidden = true; step('date')
    datesEl.innerHTML = '<p class="book-loading">Finding open days…</p>'
    getJson(api + '/dates' + (zip() ? '?zip=' + encodeURIComponent(zip()) : '')).then(function (body) {
      var dates = body.data || []
      if (!dates.length) {
        datesEl.innerHTML = '<p class="book-empty">No open days right now.</p>'
        if (stepWait) stepWait.hidden = false
        return
      }
      datesEl.innerHTML = dates.map(function (d) {
        return '<button type="button" class="book-date" data-date="' + d + '" aria-label="' + esc(day(d, { weekday: 'long', month: 'long', day: 'numeric' })) + '">' +
          '<span class="book-date__dow">' + day(d, { weekday: 'short' }) + '</span><span class="book-date__day">' + day(d, { day: 'numeric' }) + '</span><span class="book-date__mon">' + day(d, { month: 'short' }) + '</span></button>'
      }).join('')
    }).catch(function (e) { datesEl.innerHTML = '<p class="book-error">' + esc(e.message) + '</p>' })
  }

  function loadTimes() {
    stepSlot.hidden = false; stepForm.hidden = true; step('slot')
    slotsEl.innerHTML = '<div class="book-slots-skeleton">' + new Array(9).join('<div class="book-slot-skel"></div>') + '</div>'
    var q = '?date=' + picked.date + (zip() ? '&zip=' + encodeURIComponent(zip()) : '') + (token ? '&token=' + encodeURIComponent(token) : '')
    getJson(api + '/times' + q).then(function (body) {
      var times = body.data || []
      slotsEl.innerHTML = times.length
        ? times.map(function (t) { return '<button type="button" class="book-slot" data-time="' + t.time + '">' + esc(t.label) + '</button>' }).join('')
        : '<p class="book-empty">No times left that day — try another.</p>'
    }).catch(function (e) { slotsEl.innerHTML = '<p class="book-error">' + esc(e.message) + '</p>' })
  }

  datesEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.book-date'); if (!btn) return
    datesEl.querySelectorAll('.book-date').forEach(function (b) { b.classList.toggle('is-selected', b === btn); b.setAttribute('aria-pressed', String(b === btn)) })
    picked.date = btn.getAttribute('data-date')
    loadTimes()
  })
  slotsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.book-slot'); if (!btn) return
    slotsEl.querySelectorAll('.book-slot').forEach(function (b) { b.classList.toggle('is-selected', b === btn); b.setAttribute('aria-pressed', String(b === btn)) })
    picked.time = btn.getAttribute('data-time')
    picked.label = day(picked.date, { weekday: 'long', month: 'long', day: 'numeric' }) + ' at ' + btn.textContent
    if (chosen) chosen.textContent = picked.label
    stepForm.hidden = false; step('form'); showError(errorEl, '')
    stepForm.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  if (zipInput) zipInput.addEventListener('change', loadDates)

  var tipRow = root.querySelector('.book-tip-row')
  if (tipRow) tipRow.addEventListener('click', function (e) {
    var btn = e.target.closest('.book-tip-btn'); if (!btn) return
    tipRow.querySelectorAll('.book-tip-btn').forEach(function (b) { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-pressed', String(b === btn)) })
    form.querySelector('input[name="tipPercent"]').value = btn.getAttribute('data-tip')
  })

  form.addEventListener('submit', function (e) {
    e.preventDefault()
    if (!picked.date || !picked.time) return
    var submit = form.querySelector('button[type="submit"]'), label = submit.textContent
    submit.disabled = true; submit.textContent = token ? 'Moving…' : 'Booking…'; showError(errorEl, '')
    var data = { date: picked.date, time: picked.time }
    var request
    if (token) {
      request = postJson('/api/book/bookings/' + encodeURIComponent(token) + '/reschedule', data).then(function () {
        window.location.href = '/booking/' + encodeURIComponent(token) + '?moved=1'
      })
    } else {
      new FormData(form).forEach(function (v, k) { data[k] = v })
      data.zip = zip()
      try {
        var ref = document.referrer ? new URL(document.referrer) : null
        data.sourcePath = ref && ref.origin === window.location.origin ? ref.pathname : ''
        data.sourceReferrer = ref && ref.origin !== window.location.origin ? document.referrer : ''
      } catch (x) { /* no referrer */ }
      request = postJson(api, data).then(function (body) {
        // A deposit is owed: on to Stripe's own payment page (it comes back to the booking's page); otherwise booked.
        var pay = body.deposit && body.deposit.url
        if (embed) window.location.href = (pay ? '/booking/' : '/book/done?token=') + encodeURIComponent(body.token) + (pay ? '?embed=1' : '&embed=1')
        else window.location.href = typeof pay === 'string' && pay.indexOf('https://checkout.stripe.com/') === 0 ? pay : '/book/done?token=' + encodeURIComponent(body.token)
      })
    }
    request.catch(function (err) {
      showError(errorEl, err.message)
      submit.disabled = false; submit.textContent = label
      // The time went while they were typing: show the day as it is now.
      if (err.code === 'taken' || err.code === 'notice') loadTimes()
    })
  })

  var waitOpen = document.getElementById('book-waitlist-open')
  if (waitOpen && stepWait) waitOpen.addEventListener('click', function () { stepWait.hidden = false; stepWait.scrollIntoView({ behavior: 'smooth', block: 'start' }) })
  var waitForm = document.getElementById('book-waitlist')
  if (waitForm) waitForm.addEventListener('submit', function (e) {
    e.preventDefault()
    var data = {}; new FormData(waitForm).forEach(function (v, k) { data[k] = v }); data.zip = zip()
    var err = waitForm.querySelector('.book-error'), ok = waitForm.querySelector('.book-ok'), btn = waitForm.querySelector('button[type="submit"]')
    btn.disabled = true; showError(err, '')
    postJson(api + '/waitlist', data).then(function (body) {
      ok.textContent = body.message || "You're on the list."; ok.hidden = false; waitForm.querySelectorAll('input,button').forEach(function (i) { i.disabled = true })
    }).catch(function (x) { showError(err, x.message); btn.disabled = false })
  })

  loadDates()
})()
