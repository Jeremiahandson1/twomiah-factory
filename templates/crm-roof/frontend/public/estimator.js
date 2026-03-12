/**
 * Twomiah Roof Instant Estimator — Embeddable Widget
 *
 * Usage:
 *   <div id="twomiah-estimator" data-slug="your-company-slug"></div>
 *   <script src="https://your-crm.twomiah.com/estimator.js"></script>
 */
(function () {
  'use strict';

  const container = document.getElementById('twomiah-estimator');
  if (!container) return;

  const slug = container.getAttribute('data-slug');
  if (!slug) { console.error('[Twomiah Estimator] Missing data-slug attribute'); return; }

  // Determine API base from script src or same origin
  const scripts = document.getElementsByTagName('script');
  let apiBase = '';
  for (let i = 0; i < scripts.length; i++) {
    if (scripts[i].src && scripts[i].src.includes('estimator.js')) {
      const url = new URL(scripts[i].src);
      apiBase = url.origin;
      break;
    }
  }

  // Shadow DOM for style isolation
  const shadow = container.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .tw-est { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; }
    .tw-est-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    .tw-est-title { font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 4px; }
    .tw-est-sub { font-size: 13px; color: #6b7280; margin-bottom: 16px; }
    .tw-est-field { margin-bottom: 12px; }
    .tw-est-label { display: block; font-size: 12px; color: #6b7280; margin-bottom: 4px; font-weight: 500; }
    .tw-est-input { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; outline: none; transition: border-color .15s; }
    .tw-est-input:focus { border-color: var(--tw-color, #7c3aed); box-shadow: 0 0 0 3px rgba(124,58,237,.15); }
    .tw-est-row { display: flex; gap: 8px; }
    .tw-est-row > * { flex: 1; }
    .tw-est-btn { width: 100%; padding: 10px; background: var(--tw-color, #7c3aed); color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity .15s; margin-top: 4px; }
    .tw-est-btn:hover { opacity: .9; }
    .tw-est-btn:disabled { opacity: .5; cursor: not-allowed; }
    .tw-est-result { margin-top: 20px; padding: 16px; background: #f3f0ff; border-radius: 10px; text-align: center; }
    .tw-est-range { font-size: 28px; font-weight: 800; color: var(--tw-color, #7c3aed); }
    .tw-est-detail { font-size: 12px; color: #6b7280; margin-top: 4px; }
    .tw-est-disclaimer { font-size: 11px; color: #9ca3af; margin-top: 12px; line-height: 1.4; }
    .tw-est-error { margin-top: 12px; padding: 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b; font-size: 13px; }
    .tw-est-cta { display: block; margin-top: 12px; text-align: center; font-size: 13px; color: var(--tw-color, #7c3aed); font-weight: 600; text-decoration: none; }
    .tw-est-loader { display: inline-block; width: 16px; height: 16px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: tw-spin .6s linear infinite; vertical-align: middle; margin-right: 6px; }
    @keyframes tw-spin { to { transform: rotate(360deg); } }
    .tw-est-powered { text-align: center; margin-top: 12px; font-size: 10px; color: #d1d5db; }
  `;
  shadow.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.className = 'tw-est';
  shadow.appendChild(wrapper);

  // Load config
  fetch(apiBase + '/api/estimator/config/' + slug)
    .then(function (r) { return r.json(); })
    .then(function (config) {
      if (config.error) { wrapper.innerHTML = ''; return; }
      render(config);
    })
    .catch(function () { wrapper.innerHTML = ''; });

  function render(config) {
    const color = config.primaryColor || '#7c3aed';
    style.textContent = style.textContent.replace(/var\(--tw-color, #7c3aed\)/g, color);

    wrapper.innerHTML = '<div class="tw-est-card">' +
      '<div class="tw-est-title">' + esc(config.estimatorHeadline || 'Get Your Free Roof Estimate') + '</div>' +
      '<div class="tw-est-sub">Enter your address for an instant satellite-based estimate</div>' +
      '<div class="tw-est-field"><label class="tw-est-label">Street Address</label><input class="tw-est-input" id="tw-addr" placeholder="1234 Main St"></div>' +
      '<div class="tw-est-row">' +
        '<div class="tw-est-field"><label class="tw-est-label">City</label><input class="tw-est-input" id="tw-city"></div>' +
        '<div class="tw-est-field"><label class="tw-est-label">State</label><input class="tw-est-input" id="tw-state" maxlength="2"></div>' +
        '<div class="tw-est-field"><label class="tw-est-label">Zip</label><input class="tw-est-input" id="tw-zip" maxlength="10"></div>' +
      '</div>' +
      '<div class="tw-est-row">' +
        '<div class="tw-est-field"><label class="tw-est-label">Name (optional)</label><input class="tw-est-input" id="tw-name"></div>' +
        '<div class="tw-est-field"><label class="tw-est-label">Phone (optional)</label><input class="tw-est-input" id="tw-phone" type="tel"></div>' +
      '</div>' +
      '<div class="tw-est-field"><label class="tw-est-label">Email (optional)</label><input class="tw-est-input" id="tw-email" type="email"></div>' +
      '<button class="tw-est-btn" id="tw-submit">Get My Estimate</button>' +
      '<div id="tw-result"></div>' +
      '<div class="tw-est-powered">Powered by Twomiah Roof</div>' +
    '</div>';

    var btn = shadow.getElementById('tw-submit');
    btn.addEventListener('click', function () {
      var addr = shadow.getElementById('tw-addr').value.trim();
      var city = shadow.getElementById('tw-city').value.trim();
      var state = shadow.getElementById('tw-state').value.trim();
      var zip = shadow.getElementById('tw-zip').value.trim();
      var name = shadow.getElementById('tw-name').value.trim();
      var phone = shadow.getElementById('tw-phone').value.trim();
      var email = shadow.getElementById('tw-email').value.trim();

      if (!addr || !city || !state || !zip) {
        shadow.getElementById('tw-result').innerHTML = '<div class="tw-est-error">Please fill in all address fields.</div>';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="tw-est-loader"></span>Calculating...';

      fetch(apiBase + '/api/estimator/estimate/' + slug, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr, city: city, state: state, zip: zip, name: name, phone: phone, email: email }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          btn.disabled = false;
          btn.innerHTML = 'Get My Estimate';

          if (data.error) {
            shadow.getElementById('tw-result').innerHTML = '<div class="tw-est-error">' + esc(data.error) + '</div>';
            return;
          }

          var resultHtml = '<div class="tw-est-result">' +
            '<div class="tw-est-range">$' + num(data.estimateLow) + ' – $' + num(data.estimateHigh) + '</div>' +
            '<div class="tw-est-detail">' + data.totalSquares + ' squares (' + num(data.totalAreaSqft) + ' sqft)</div>' +
            '<div class="tw-est-disclaimer">' + esc(data.disclaimer || '') + '</div>';

          if (data.companyPhone) {
            resultHtml += '<a class="tw-est-cta" href="tel:' + esc(data.companyPhone) + '">Call us: ' + esc(data.companyPhone) + '</a>';
          }
          resultHtml += '</div>';
          shadow.getElementById('tw-result').innerHTML = resultHtml;
        })
        .catch(function () {
          btn.disabled = false;
          btn.innerHTML = 'Get My Estimate';
          shadow.getElementById('tw-result').innerHTML = '<div class="tw-est-error">Something went wrong. Please try again.</div>';
        });
    });
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function num(n) { return Number(n || 0).toLocaleString(); }
})();
