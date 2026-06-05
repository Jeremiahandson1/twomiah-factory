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

  function onDateClick(e) {
    const btn = e.currentTarget;
    selectedDate = btn.dataset.iso;
    datesEl.querySelectorAll('.book-date').forEach(b => b.classList.toggle('is-selected', b === btn));
    loadSlots();
  }

  async function loadSlots() {
    if (!selectedDate) return;
    stepSlot.hidden = false;
    slotsEl.innerHTML = '<p class="book-loading">Loading available times…</p>';
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
    stepForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Booking…';
    const formData = new FormData(form);
    try {
      const res = await fetch('/book/' + encodeURIComponent(slug), { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Booking failed');
      // If the service has a deposit, redirect to Stripe Checkout first
      if (data.depositCheckoutUrl) {
        window.location.href = data.depositCheckoutUrl;
      } else {
        window.location.href = '/book/thanks?id=' + encodeURIComponent(data.booking.id);
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm booking';
    }
  });

  renderDates();
})();
