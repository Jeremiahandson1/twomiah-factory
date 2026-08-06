/**
 * Twomiah online booking widget.
 *
 * The embed code has always pointed at /booking-widget.js; the file never
 * existed, so every embed was a 404. This is that file.
 *
 * Talks only to the public booking endpoints:
 *   GET  /api/booking/public/:slug            -> { company, settings, services }
 *   GET  /api/booking/public/:slug/dates      -> [{ date, dayOfWeek }]
 *   GET  /api/booking/public/:slug/slots      -> [{ time, available }]
 *   POST /api/booking/public/:slug            -> { confirmationCode, deposit }
 *
 * When the chosen service requires a deposit the booking is held as pending and
 * the response carries a Stripe client secret; the widget then collects the
 * card with Stripe.js and the slot confirms once payment succeeds.
 */
(function () {
  'use strict';

  var STYLE_ID = 'twomiah-booking-styles';

  function css(accent) {
    return [
      '.tw-bk{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:34rem;color:#111827}',
      '.tw-bk *{box-sizing:border-box}',
      '.tw-bk h2{font-size:1.25rem;margin:0 0 .25rem}',
      '.tw-bk p.tw-sub{color:#6b7280;font-size:.9rem;margin:0 0 1rem}',
      '.tw-bk label{display:block;font-size:.8rem;font-weight:600;color:#374151;margin:0 0 .25rem}',
      '.tw-bk input,.tw-bk select,.tw-bk textarea{width:100%;padding:.55rem .7rem;border:1px solid #d1d5db;border-radius:.5rem;font:inherit;margin-bottom:.75rem;background:#fff}',
      '.tw-bk .tw-row{display:flex;gap:.75rem}.tw-bk .tw-row>div{flex:1}',
      '.tw-bk button.tw-primary{background:' + accent + ';color:#fff;border:0;border-radius:.5rem;padding:.65rem 1.1rem;font:inherit;font-weight:600;cursor:pointer}',
      '.tw-bk button.tw-primary:disabled{opacity:.55;cursor:default}',
      '.tw-bk .tw-slots{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.9rem}',
      '.tw-bk .tw-slot{border:1px solid #d1d5db;background:#fff;border-radius:.4rem;padding:.4rem .6rem;font:inherit;font-size:.85rem;cursor:pointer}',
      '.tw-bk .tw-slot[aria-pressed="true"]{background:' + accent + ';color:#fff;border-color:' + accent + '}',
      '.tw-bk .tw-note{font-size:.8rem;color:#6b7280;margin:.25rem 0 .75rem}',
      '.tw-bk .tw-err{color:#b91c1c;font-size:.85rem;margin:.5rem 0}',
      '.tw-bk .tw-ok{border:1px solid #a7f3d0;background:#ecfdf5;border-radius:.6rem;padding:1rem}',
      '.tw-bk .tw-code{font-family:ui-monospace,monospace;font-size:1.1rem;font-weight:700}',
      '.tw-bk .tw-card{border:1px solid #d1d5db;border-radius:.5rem;padding:.7rem;margin-bottom:.75rem;background:#fff}',
    ].join('');
  }

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (html != null) node.innerHTML = html;
    return node;
  }

  function money(v) {
    return '$' + Number(v || 0).toFixed(2);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function init(options) {
    var opts = options || {};
    var container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) { console.error('[TwomiahBooking] container not found:', opts.container); return; }
    if (!opts.company) { console.error('[TwomiahBooking] company slug is required'); return; }

    var base = (opts.apiUrl || '').replace(/\/$/, '');
    var slug = opts.company;
    var api = function (path) { return base + '/api/booking/public/' + encodeURIComponent(slug) + path; };

    var state = { config: null, service: null, date: '', time: '', submitting: false };

    function request(url, init) {
      return fetch(url, init).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) throw new Error(body.error || 'Something went wrong');
          return body;
        });
      });
    }

    function mountStyles(accent) {
      if (document.getElementById(STYLE_ID)) return;
      var style = el('style', { id: STYLE_ID });
      style.textContent = css(accent || '#2563eb');
      document.head.appendChild(style);
    }

    function render() {
      var cfg = state.config;
      container.innerHTML = '';
      var root = el('div', { class: 'tw-bk' });

      root.appendChild(el('h2', null, (cfg.settings && cfg.settings.title) || ('Book with ' + cfg.company.name)));
      if (cfg.settings && cfg.settings.description) {
        root.appendChild(el('p', { class: 'tw-sub' }, cfg.settings.description));
      }

      var form = el('form');

      // service
      if (cfg.services && cfg.services.length) {
        form.appendChild(el('label', null, 'Service'));
        var sel = el('select', { name: 'serviceId' });
        cfg.services.forEach(function (s) {
          var dep = s.deposit_required && Number(s.deposit_amount) > 0
            ? ' - ' + money(s.deposit_amount) + ' deposit'
            : '';
          var opt = el('option', { value: s.id }, s.name + ' (' + (s.duration_minutes || 60) + ' min)' + dep);
          sel.appendChild(opt);
        });
        sel.onchange = function () {
          state.service = cfg.services.filter(function (s) { return s.id === sel.value; })[0] || null;
          renderDepositNote();
          loadSlots();
        };
        form.appendChild(sel);
      }

      var depositNote = el('p', { class: 'tw-note' });
      form.appendChild(depositNote);

      function renderDepositNote() {
        var s = state.service;
        if (s && s.deposit_required && Number(s.deposit_amount) > 0) {
          depositNote.textContent = 'A ' + money(s.deposit_amount) + ' deposit is required to hold this appointment. Your slot is confirmed once it is paid.';
        } else {
          depositNote.textContent = '';
        }
      }

      // date
      form.appendChild(el('label', null, 'Date'));
      var dateSel = el('select', { name: 'date' });
      dateSel.appendChild(el('option', { value: '' }, 'Choose a date'));
      (state.dates || []).forEach(function (d) {
        dateSel.appendChild(el('option', { value: d.date }, new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })));
      });
      dateSel.onchange = function () { state.date = dateSel.value; state.time = ''; loadSlots(); };
      form.appendChild(dateSel);

      // slots
      var slotWrap = el('div', { class: 'tw-slots' });
      form.appendChild(slotWrap);

      function loadSlots() {
        slotWrap.innerHTML = '';
        if (!state.date) return;
        slotWrap.textContent = 'Checking times...';
        var url = api('/slots?date=' + encodeURIComponent(state.date) + (state.service ? '&serviceId=' + encodeURIComponent(state.service.id) : ''));
        request(url).then(function (slots) {
          slotWrap.innerHTML = '';
          if (!slots.length) { slotWrap.textContent = 'No times left on that day.'; return; }
          slots.forEach(function (s) {
            var b = el('button', { type: 'button', class: 'tw-slot', 'aria-pressed': 'false' }, s.time);
            b.onclick = function () {
              state.time = s.time;
              Array.prototype.forEach.call(slotWrap.children, function (c) { c.setAttribute('aria-pressed', 'false'); });
              b.setAttribute('aria-pressed', 'true');
            };
            slotWrap.appendChild(b);
          });
        }).catch(function (e) { slotWrap.textContent = e.message; });
      }

      // details
      var row = el('div', { class: 'tw-row' });
      var first = el('div'); first.appendChild(el('label', null, 'First name')); first.appendChild(el('input', { name: 'firstName', required: 'required' }));
      var last = el('div'); last.appendChild(el('label', null, 'Last name')); last.appendChild(el('input', { name: 'lastName', required: 'required' }));
      row.appendChild(first); row.appendChild(last);
      form.appendChild(row);

      form.appendChild(el('label', null, 'Email'));
      form.appendChild(el('input', { name: 'email', type: 'email', required: 'required' }));

      if (cfg.settings && cfg.settings.requirePhone) {
        form.appendChild(el('label', null, 'Phone'));
        form.appendChild(el('input', { name: 'phone', required: 'required' }));
      } else {
        form.appendChild(el('label', null, 'Phone (optional)'));
        form.appendChild(el('input', { name: 'phone' }));
      }

      if (cfg.settings && cfg.settings.requireAddress) {
        form.appendChild(el('label', null, 'Service address'));
        form.appendChild(el('input', { name: 'address', required: 'required' }));
      }

      form.appendChild(el('label', null, 'Anything we should know?'));
      form.appendChild(el('textarea', { name: 'notes', rows: '3' }));

      var errBox = el('div', { class: 'tw-err' });
      form.appendChild(errBox);

      var submit = el('button', { type: 'submit', class: 'tw-primary' }, 'Request appointment');
      form.appendChild(submit);

      form.onsubmit = function (ev) {
        ev.preventDefault();
        if (state.submitting) return;
        errBox.textContent = '';
        if (!state.date || !state.time) { errBox.textContent = 'Pick a date and a time first.'; return; }

        var data = new FormData(form);
        var payload = {
          serviceId: state.service ? state.service.id : undefined,
          date: state.date,
          time: state.time,
          firstName: (data.get('firstName') || '').trim(),
          lastName: (data.get('lastName') || '').trim(),
          email: (data.get('email') || '').trim(),
          phone: (data.get('phone') || '').trim() || undefined,
          address: (data.get('address') || '').trim() || undefined,
          notes: (data.get('notes') || '').trim() || undefined,
        };

        state.submitting = true;
        submit.disabled = true;
        submit.textContent = 'Booking...';

        request(api(''), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(function (res) {
          if (res.deposit && res.deposit.required && res.deposit.clientSecret) {
            return collectDeposit(res);
          }
          showConfirmed(res, false);
        }).catch(function (e) {
          errBox.textContent = e.message;
        }).then(function () {
          state.submitting = false;
          submit.disabled = false;
          submit.textContent = 'Request appointment';
        });
      };

      root.appendChild(form);
      container.appendChild(root);
      state.dates && dateSel.value === '' && renderDepositNote();
      state.service = (cfg.services && cfg.services[0]) || null;
      renderDepositNote();
      if (state.service) loadSlots();
    }

    function collectDeposit(res) {
      var accent = (state.config.company && state.config.company.primaryColor) || '#2563eb';
      container.innerHTML = '';
      var root = el('div', { class: 'tw-bk' });
      root.appendChild(el('h2', null, 'Pay your deposit'));
      root.appendChild(el('p', { class: 'tw-sub' }, 'Your appointment is held until this ' + money(res.deposit.amount) + ' deposit is paid.'));
      var mount = el('div', { class: 'tw-card', id: 'tw-card-element' });
      root.appendChild(mount);
      var err = el('div', { class: 'tw-err' });
      root.appendChild(err);
      var pay = el('button', { class: 'tw-primary', type: 'button' }, 'Pay ' + money(res.deposit.amount));
      root.appendChild(pay);
      container.appendChild(root);

      if (!res.deposit.publishableKey) {
        err.textContent = 'Card payments are not set up yet — we will contact you to take the deposit.';
        pay.disabled = true;
        return;
      }

      return loadScript('https://js.stripe.com/v3/').then(function () {
        var stripe = window.Stripe(res.deposit.publishableKey);
        var elements = stripe.elements({ clientSecret: res.deposit.clientSecret });
        var payment = elements.create('payment');
        payment.mount('#tw-card-element');

        pay.onclick = function () {
          pay.disabled = true;
          pay.textContent = 'Processing...';
          err.textContent = '';
          stripe.confirmPayment({ elements: elements, redirect: 'if_required' }).then(function (result) {
            if (result.error) {
              err.textContent = result.error.message || 'That card was declined.';
              pay.disabled = false;
              pay.textContent = 'Pay ' + money(res.deposit.amount);
              return;
            }
            showConfirmed(res, true);
          });
        };
      }).catch(function (e) {
        err.textContent = e.message;
      });
    }

    function showConfirmed(res, paid) {
      container.innerHTML = '';
      var root = el('div', { class: 'tw-bk' });
      var box = el('div', { class: 'tw-ok' });
      box.appendChild(el('h2', null, paid ? 'You are booked' : 'Appointment requested'));
      box.appendChild(el('p', { class: 'tw-sub' },
        paid ? 'Your deposit is paid and your time is confirmed.' : 'We have your request and will confirm shortly.'));
      box.appendChild(el('p', null, 'Confirmation code: <span class="tw-code">' + (res.confirmationCode || '') + '</span>'));
      root.appendChild(box);
      container.appendChild(root);
    }

    // boot
    request(api('')).then(function (cfg) {
      state.config = cfg;
      mountStyles(cfg.company && cfg.company.primaryColor);
      return request(api('/dates'));
    }).then(function (dates) {
      state.dates = dates || [];
      render();
    }).catch(function (e) {
      container.innerHTML = '';
      container.appendChild(el('div', { class: 'tw-bk' }, '<p class="tw-err">' + (e.message || 'Booking is unavailable right now.') + '</p>'));
    });
  }

  window.TwomiahBooking = { init: init };
})();
