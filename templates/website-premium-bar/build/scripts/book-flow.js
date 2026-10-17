// Twomiah Bookings — public booking flow.
// Three steps: pick date → pick slot → confirm details.
// No framework; vanilla DOM + fetch. Keeps the page under 5KB of JS.

(function () {
  // If we're inside an iframe (embed mode), post our height to parent
  // every time the DOM mutates so the iframe can resize without scroll.
  if (window.parent !== window) {
    var post = function () {
      try {
        var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        window.parent.postMessage({ type: 'twomiah-book-height', height: h }, '*');
      } catch (e) { /* ignore cross-origin */ }
    };
    var ro = new ResizeObserver(post);
    ro.observe(document.body);
    setTimeout(post, 50);
  }
  const root = document.getElementById('book-flow');
  if (!root) return;
  const slug = root.dataset.serviceSlug;
  const rescheduleToken = root.dataset.rescheduleToken || '';
  const duration = parseInt(root.dataset.duration, 10);
  const stepDate = root.querySelector('.book-step--date');
  const stepSlot = root.querySelector('.book-step--slot');
  const stepForm = root.querySelector('.book-step--form');
  const zipInput = document.getElementById('book-zip-input');
  const datesEl = document.getElementById('book-dates');
  const slotsEl = document.getElementById('book-slots');
  const form = document.getElementById('book-form');
  const startHidden = document.getElementById('book-start');
  const zipHidden = document.getElementById('book-zip-hidden');
  const errorEl = document.getElementById('book-error');
  const tField = document.getElementById('book-form-t');
  tField.value = String(Date.now());

  // Build 14-day strip
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    days.push(d);
  }
  function dateKey(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }
  function shortLabel(d) {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  let selectedDate = null;
  let selectedSlotIso = null;

  function renderDates() {
    datesEl.innerHTML = days.map((d, i) =>
      '<button type="button" class="book-date" data-iso="' + dateKey(d) + '">' +
      '<span class="book-date__dow">' + d.toLocaleDateString('en-US', { weekday: 'short' }) + '</span>' +
      '<span class="book-date__day">' + d.getDate() + '</span>' +
      '<span class="book-date__mon">' + d.toLocaleDateString('en-US', { month: 'short' }) + '</span>' +
      '</button>'
    ).join('');
    datesEl.querySelectorAll('.book-date').forEach(btn => btn.addEventListener('click', onDateClick));
  }

  function setStepActive(step) {
    document.querySelectorAll('.book-progress__step').forEach(el => {
      const s = el.dataset.step;
      const order = { date: 0, slot: 1, form: 2 };
      const cur = order[step];
      const my = order[s];
      el.classList.toggle('is-active', my === cur);
      el.classList.toggle('is-done', my < cur);
    });
  }

  function onDateClick(e) {
    const btn = e.currentTarget;
    selectedDate = btn.dataset.iso;
    datesEl.querySelectorAll('.book-date').forEach(b => b.classList.toggle('is-selected', b === btn));
    setStepActive('slot');
    loadSlots();
  }

  async function loadSlots() {
    if (!selectedDate) return;
    stepSlot.hidden = false;
    // Skeleton for perceived speed
    slotsEl.innerHTML = '<div class="book-slots-skeleton">' +
      Array.from({ length: 8 }).map(() => '<div class="book-slot-skel"></div>').join('') + '</div>';
    stepForm.hidden = true;
    const zip = (zipInput.value || '').trim();
    const url = '/book/' + encodeURIComponent(slug) + '/slots?date=' + selectedDate + (zip ? '&zip=' + encodeURIComponent(zip) : '');
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!data.slots || data.slots.length === 0) {
        slotsEl.innerHTML = '<p class="book-empty">No times available that day. Try another.</p>';
        return;
      }
      slotsEl.innerHTML = data.slots.map(s =>
        '<button type="button" class="book-slot" data-iso="' + s.startAtIso + '">' + s.label + '</button>'
      ).join('');
      slotsEl.querySelectorAll('.book-slot').forEach(b => b.addEventListener('click', onSlotClick));
    } catch (err) {
      slotsEl.innerHTML = '<p class="book-error">Could not load times. Refresh and try again.</p>';
    }
  }

  function onSlotClick(e) {
    const btn = e.currentTarget;
    selectedSlotIso = btn.dataset.iso;
    slotsEl.querySelectorAll('.book-slot').forEach(b => b.classList.toggle('is-selected', b === btn));
    startHidden.value = selectedSlotIso;
    zipHidden.value = (zipInput.value || '').trim();
    stepForm.hidden = false;
    setStepActive('form');
    stepForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Tip selector
  var tipRow = document.getElementById('book-tip-row');
  if (tipRow) {
    var base = parseInt(tipRow.dataset.base, 10) || 0;
    var tipCents = document.getElementById('book-tip-cents');
    tipRow.querySelectorAll('.book-tip-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var pct = parseInt(btn.dataset.tip, 10) || 0;
        tipCents.value = Math.round(base * pct / 100);
        tipRow.querySelectorAll('.book-tip-btn').forEach(function(b) { b.classList.toggle('is-active', b === btn); });
      });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    var originalLabel = submitBtn.textContent;
    submitBtn.textContent = rescheduleToken ? 'Rescheduling…' : 'Booking…';
    const formData = new FormData(form);
    // Attribution
    try {
      formData.append('sourcePath', document.referrer && new URL(document.referrer).origin === window.location.origin ? new URL(document.referrer).pathname : '/');
      formData.append('sourceReferrer', document.referrer || '');
      if (window.twomiahAb && window.twomiahAb.state && window.twomiahAb.state.variant) {
        formData.append('sourceVariant', window.twomiahAb.state.variant);
      }
    } catch (_) { /* ignore */ }
    try {
      var endpoint = rescheduleToken
        ? '/booking/' + encodeURIComponent(rescheduleToken) + '/reschedule'
        : '/book/' + encodeURIComponent(slug);
      const res = await fetch(endpoint, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || (rescheduleToken ? 'Reschedule failed' : 'Booking failed'));
      if (rescheduleToken) {
        window.location.href = '/booking/' + encodeURIComponent(rescheduleToken) + '?rescheduled=1';
      } else if (data.depositCheckoutUrl) {
        window.location.href = data.depositCheckoutUrl;
      } else {
        window.location.href = '/book/thanks?id=' + encodeURIComponent(data.booking.id);
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });

  renderDates();
})();
