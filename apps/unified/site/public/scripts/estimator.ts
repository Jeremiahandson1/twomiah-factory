/**
 * Twomiah Roof Instant Estimator — Embeddable Widget
 *
 * Usage:
 *   <div id="twomiah-estimator" data-slug="your-company-slug"></div>
 *   <script src="https://<the business's own web address>/estimator.js"></script>
 */
// The instant roof estimator a roofer embeds on any website (templates/crm-roof frontend/public/estimator.js), served
// by the unified app at /estimator.js (server/site/routes.ts, from this file). It reads its API from its own script's origin.
(function () {
  'use strict';

  const container = document.getElementById('twomiah-estimator');
  if (!container) return;

  const slug = container.getAttribute('data-slug');
  if (!slug) { console.error('[Twomiah Estimator] Missing data-slug attribute'); return; }

  // Determine API base from script src or same origin
  const scripts = document.getElementsByTagName('script');
  let apiBase = '';
  // server/site/smsConsent.ts consentWording('estimate'), word for word (tests/sms-consent.test.ts holds them together).
  const SMS_CONSENT_WORDING = 'Text me about my estimate. Message frequency varies. Message and data rates may apply. Reply STOP to stop receiving texts, or HELP for help.';
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
    .tw-est-card { color-scheme: light; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    .tw-est-title { font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 4px; }
    .tw-est-sub { font-size: 13px; color: #6b7280; margin-bottom: 16px; }
    .tw-est-field { margin-bottom: 12px; }
    .tw-est-consent { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.45; color: #374151; margin: 0 0 12px; }
    .tw-est-consent input { margin-top: 2px; }
    .tw-est-consent a { color: inherit; text-decoration: underline; }
    .tw-est-label { display: block; font-size: 12px; color: #6b7280; margin-bottom: 4px; font-weight: 500; }
    .tw-est-input { width: 100%; padding: 8px 12px; background: #fff; color: #111827; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; outline: none; transition: border-color .15s; }
    .tw-est-input:focus { border-color: var(--tw-color, #7c3aed); box-shadow: 0 0 0 3px rgba(124,58,237,.15); }
    .tw-est-row { display: flex; gap: 8px; }
    .tw-est-row > * { flex: 1; }
    .tw-est-btn { width: 100%; padding: 10px; background: var(--tw-color, #7c3aed); color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity .15s; margin-top: 4px; }
    .tw-est-btn:hover { opacity: .9; }
    .tw-est-btn:disabled { opacity: .5; cursor: not-allowed; }
    .tw-est-result { margin-top: 20px; padding: 16px; background: #f3f0ff; border-radius: 10px; text-align: center; }
    .tw-est-range { font-size: 28px; font-weight: 800; color: var(--tw-color, #7c3aed); }
    .tw-est-detail { font-size: 12px; color: #4b5563; margin-top: 4px; }
    .tw-est-disclaimer { font-size: 11px; color: #4b5563; margin-top: 12px; line-height: 1.4; }
    .tw-est-error { margin-top: 12px; padding: 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b; font-size: 13px; }
    .tw-est-cta { display: block; margin-top: 12px; text-align: center; font-size: 13px; color: var(--tw-color, #7c3aed); font-weight: 600; text-decoration: none; }
    .tw-est-loader { display: inline-block; width: 16px; height: 16px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: tw-spin .6s linear infinite; vertical-align: middle; margin-right: 6px; }
    @keyframes tw-spin { to { transform: rotate(360deg); } }
    .tw-est-powered { text-align: center; margin-top: 12px; font-size: 10px; color: #6b7280; }
    .tw-est-options { display: grid; gap: 10px; margin-top: 12px; text-align: left; }
    .tw-est-option { display: flex; gap: 12px; align-items: flex-start; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
    .tw-est-option.tw-picked { border-color: var(--tw-color, #7c3aed); box-shadow: 0 0 0 2px rgba(124,58,237,.15); }
    .tw-est-option img { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; flex: none; }
    .tw-est-option-body { flex: 1; min-width: 0; }
    .tw-est-option-name { font-size: 14px; font-weight: 700; color: #111827; }
    .tw-est-option-desc { font-size: 12px; color: #6b7280; margin-top: 2px; line-height: 1.4; }
    .tw-est-option-range { font-size: 20px; font-weight: 800; color: var(--tw-color, #7c3aed); margin-top: 4px; }
    .tw-est-option-finance { font-size: 12px; color: #374151; margin-top: 2px; }
    .tw-est-pick { margin-top: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; border-radius: 8px; border: 1px solid var(--tw-color, #7c3aed); background: #fff; color: var(--tw-color, #7c3aed); cursor: pointer; }
    .tw-est-pick[disabled] { background: var(--tw-color, #7c3aed); color: #fff; cursor: default; }
    .tw-est-roof { margin-top: 16px; text-align: left; }
    .tw-est-roof-title { font-size: 14px; font-weight: 700; color: #111827; }
    .tw-est-roof-hint { font-size: 12px; color: #6b7280; margin: 2px 0 8px; line-height: 1.4; }
    .tw-est-canvas { display: block; width: 100%; border-radius: 10px; border: 1px solid #e5e7eb; touch-action: none; cursor: crosshair; background: #e5e7eb; }
    .tw-est-roof-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; align-items: center; }
    .tw-est-roof-actions .tw-est-btn { width: auto; margin-top: 0; padding: 8px 14px; font-size: 13px; }
    .tw-est-link { background: none; border: none; padding: 0; font-size: 12px; color: var(--tw-color, #7c3aed); font-weight: 600; cursor: pointer; text-decoration: underline; }
  `;
  shadow.appendChild(style);

  var brand = '#7c3aed';
  const wrapper = document.createElement('div');
  wrapper.className = 'tw-est';
  shadow.appendChild(wrapper);

  // Off — the roofer has switched it off, or has no roof reports left to measure with (the server answers both the
  // same): nothing is shown, and on the business's own site the section that holds it closes up, so no gap is left.
  function showNothing() {
    wrapper.innerHTML = '';
    var section = container.closest ? container.closest('.tool-estimator') : null;
    if (section) section.style.display = 'none';
  }

  // Load config
  fetch(apiBase + '/api/estimator/config/' + slug)
    .then(function (r) { return r.json(); })
    .then(function (config) {
      if (config.error) { showNothing(); return; }
      render(config);
    })
    .catch(showNothing);

  function render(config) {
    // Only a colour: it goes into the stylesheet, so anything else is the default.
    const color = /^#[0-9a-fA-F]{6}$/.test(String(config.primaryColor || '')) ? config.primaryColor : '#7c3aed';
    style.textContent = style.textContent.replace(/var\(--tw-color, #7c3aed\)/g, color);
    brand = color;

    wrapper.innerHTML = '<div class="tw-est-card">' +
      '<div class="tw-est-title">' + esc(config.estimatorHeadline || 'Get Your Free Roof Estimate') + '</div>' +
      '<div class="tw-est-sub">Enter your address for an instant estimate, measured from an aerial picture of your roof</div>' +
      '<div class="tw-est-field"><label class="tw-est-label">Street Address</label><input class="tw-est-input" id="tw-addr" placeholder="1234 Main St"></div>' +
      '<div class="tw-est-row">' +
        '<div class="tw-est-field"><label class="tw-est-label">City</label><input class="tw-est-input" id="tw-city"></div>' +
        '<div class="tw-est-field"><label class="tw-est-label">State</label><input class="tw-est-input" id="tw-state" maxlength="2"></div>' +
        '<div class="tw-est-field"><label class="tw-est-label">Zip</label><input class="tw-est-input" id="tw-zip" maxlength="10"></div>' +
      '</div>' +
      '<div class="tw-est-row">' +
        '<div class="tw-est-field"><label class="tw-est-label">Name</label><input class="tw-est-input" id="tw-name"></div>' +
        '<div class="tw-est-field"><label class="tw-est-label">Phone</label><input class="tw-est-input" id="tw-phone" type="tel"></div>' +
      '</div>' +
      // The "Text me" box (server/site/smsConsent.ts consentWording('estimate') — the same words, kept with the consent);
      // its privacy and terms are the business's own, on its own site, wherever the widget is shown.
      '<label class="tw-est-consent"><input type="checkbox" id="tw-sms"> <span>' + SMS_CONSENT_WORDING + ' <a href="' + apiBase + '/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="' + apiBase + '/terms" target="_blank" rel="noopener">Terms</a></span></label>' +
      '<div class="tw-est-field"><label class="tw-est-label">Email</label><input class="tw-est-input" id="tw-email" type="email"></div>' +
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
      var smsConsent = !!shadow.getElementById('tw-sms').checked;

      if (!addr || !city || !state || !zip) {
        shadow.getElementById('tw-result').innerHTML = '<div class="tw-est-error">Please fill in all address fields.</div>';
        return;
      }
      // The server asks the same (server/crm/roof/reports/estimator.ts): a name, and a phone number or an email.
      if (!name || (!phone && !email)) {
        shadow.getElementById('tw-result').innerHTML = '<div class="tw-est-error">Please add your name and a phone number or an email, so we can send your estimate.</div>';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="tw-est-loader"></span>Calculating...';

      fetch(apiBase + '/api/estimator/estimate/' + slug, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr, city: city, state: state, zip: zip, name: name, phone: phone, email: email, smsConsent: smsConsent }),
      })
        .then(function (r) {
          // Asked too many times in the hour (the estimator's limit a visitor): say how long, from the server's Retry-After
          // (live test 11/11: "Too many requests, please try again later" told the visitor nothing).
          if (r.status === 429) {
            var mins = Math.max(1, Math.ceil(Number(r.headers.get('Retry-After') || 3600) / 60));
            return { error: 'You have asked for a few estimates already. Please try again in ' + mins + (mins === 1 ? ' minute' : ' minutes') + ', or call us.' };
          }
          return r.json();
        })
        .then(function (data) {
          btn.disabled = false;
          btn.innerHTML = 'Get My Estimate';

          show(data);
        })
        .catch(function () {
          btn.disabled = false;
          btn.innerHTML = 'Get My Estimate';
          shadow.getElementById('tw-result').innerHTML = '<div class="tw-est-error">Something went wrong. Please try again.</div>';
        });
    });
  }

  // ── What came back ──
  // The estimate the page is showing (its id, for a correction or a choice), and the picture's state while it is open.
  var estimateId = '';
  var roof = null;   // { img, width, height, outlines: [{ points, chosen }], selected, original, view, changed, full }

  function show(data) {
    var box = shadow.getElementById('tw-result');
    if (data.error) {
      var firstField = data.fields ? data.fields[Object.keys(data.fields)[0]] : '';
      box.innerHTML = '<div class="tw-est-error">' + esc(firstField || data.error) + '</div>';
      return;
    }
    estimateId = data.estimateId || '';
    roof = null;
    box.innerHTML = '<div class="tw-est-result"><div id="tw-prices"></div><div id="tw-roof"></div><div id="tw-foot"></div></div>';
    prices(data);
    if (data.picture && data.picture.image && estimateId) openRoof(data.picture, data.quoted === false);
    var foot = '';
    if (data.quoted !== false) foot += '<div class="tw-est-disclaimer">' + esc(data.disclaimer || '') + '</div>';
    // The lender's disclosure (financing/lender.ts DISCLOSURE), under the prices whenever an option shows an "as low as" monthly figure:
    // the server sends it with every offer (crm/roof/reports/estimator.ts).
    if (data.financingDisclosure) foot += '<div class="tw-est-disclaimer">' + esc(data.financingDisclosure) + '</div>';
    if (data.companyPhone) foot += '<a class="tw-est-cta" href="tel:' + esc(data.companyPhone) + '">Call us: ' + esc(data.companyPhone) + '</a>';
    shadow.getElementById('tw-foot').innerHTML = foot;
  }

  // The price of each roof the business sells, for this roof. (Also redrawn after the outline is corrected.)
  function prices(data) {
    var at = shadow.getElementById('tw-prices');
    // Not priced: outside the service area, a roof that could not be measured (the business follows up — the lead is
    // kept), or one the visitor is asked to point out on the picture below.
    if (data.quoted === false) {
      at.innerHTML = '<div class="tw-est-detail" style="font-size:14px;color:#111827">' + esc(data.message || '') + '</div>';
      return;
    }
    var options = data.options && data.options.length ? data.options : [{ id: '', name: '', estimateLow: data.estimateLow, estimateHigh: data.estimateHigh }];
    var html = '';
    if (options.length === 1) {
      html += '<div class="tw-est-range">$' + num(options[0].estimateLow) + ' – $' + num(options[0].estimateHigh) + '</div>';
      if (options[0].financing) html += '<div class="tw-est-option-finance">As low as $' + num(options[0].financing.asLowAs) + ' a month with ' + esc(options[0].financing.lender) + '</div>';
    }
    html += '<div class="tw-est-detail">' + num(data.totalSquares) + ' squares (' + num(data.totalAreaSqft) + ' sqft)' + (data.adjusted ? ', from the outline you set' : '') + '</div>';
    if (options.length > 1) {
      html += '<div class="tw-est-options">';
      for (var i = 0; i < options.length; i++) {
        var o = options[i];
        html += '<div class="tw-est-option" data-option="' + attr(o.id) + '">' +
          (o.imageUrl ? '<img src="' + attr(o.imageUrl) + '" alt="" loading="lazy">' : '') +
          '<div class="tw-est-option-body">' +
            '<div class="tw-est-option-name">' + esc(o.name) + '</div>' +
            (o.description ? '<div class="tw-est-option-desc">' + esc(o.description) + '</div>' : '') +
            '<div class="tw-est-option-range">$' + num(o.estimateLow) + ' – $' + num(o.estimateHigh) + '</div>' +
            (o.financing ? '<div class="tw-est-option-finance">As low as $' + num(o.financing.asLowAs) + ' a month with ' + esc(o.financing.lender) + '</div>' : '') +
            (estimateId ? '<button type="button" class="tw-est-pick" data-pick="' + attr(o.id) + '">I\'m interested in this one</button>' : '') +
          '</div></div>';
      }
      html += '</div>';
    }
    at.innerHTML = html;
    var picks = at.querySelectorAll('[data-pick]');
    for (var k = 0; k < picks.length; k++) picks[k].addEventListener('click', choose);
  }

  // "I'm interested in this one": kept for whoever calls back.
  function choose(ev) {
    var button = ev.currentTarget, id = button.getAttribute('data-pick');
    var all = shadow.querySelectorAll('.tw-est-option');
    fetch(apiBase + '/api/estimator/choose/' + slug, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estimateId: estimateId, optionId: id }) })
      .then(function (r) { return r.json(); })
      .then(function (reply) {
        if (reply.error) return;
        for (var i = 0; i < all.length; i++) {
          var mine = all[i].getAttribute('data-option') === id, b = all[i].querySelector('.tw-est-pick');
          all[i].className = 'tw-est-option' + (mine ? ' tw-picked' : '');
          if (b) { b.disabled = mine; b.textContent = mine ? 'We\'ll be in touch about this one' : 'I\'m interested in this one'; }
        }
      })
      .catch(function () { /* the estimate still stands */ });
  }

  // ── The roof on the aerial picture: check it, drag a corner, or tap the right building ──
  var HANDLE = 7, GRAB = 16, MARGIN_M = 7;

  function openRoof(picture, mustPick) {
    var img = new Image();
    var chosen = -1;
    for (var i = 0; i < picture.outlines.length; i++) if (picture.outlines[i].chosen) chosen = i;
    roof = {
      img: img, width: picture.width, height: picture.height, mpp: picture.metresPerPixel || 0.25,
      outlines: picture.outlines.map(function (o) { return { points: o.points.map(function (q) { return [q[0], q[1]]; }) }; }),
      // A roof the engine could not vouch for is not pre-selected: the visitor says which is theirs.
      selected: mustPick ? -1 : chosen, changed: false, full: mustPick || chosen < 0, drag: -1, view: null,
    };
    roof.original = JSON.stringify(roof.outlines);
    roof.originalSelected = roof.selected;
    shadow.getElementById('tw-roof').innerHTML = '<div class="tw-est-roof">' +
      '<div class="tw-est-roof-title">' + (mustPick ? 'Which roof is yours?' : 'Is this your roof?') + '</div>' +
      '<div class="tw-est-roof-hint" id="tw-roof-hint"></div>' +
      '<canvas class="tw-est-canvas" id="tw-canvas"></canvas>' +
      '<div class="tw-est-roof-actions">' +
        '<button type="button" class="tw-est-btn" id="tw-roof-update" disabled>Update my estimate</button>' +
        '<button type="button" class="tw-est-link" id="tw-roof-zoom"></button>' +
        '<button type="button" class="tw-est-link" id="tw-roof-reset">Start over</button>' +
      '</div><div id="tw-roof-error"></div></div>';
    var canvas = shadow.getElementById('tw-canvas');
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('dblclick', removeCorner);
    shadow.getElementById('tw-roof-update').addEventListener('click', sendOutline);
    shadow.getElementById('tw-roof-zoom').addEventListener('click', function () { roof.full = !roof.full; fit(); draw(); });
    shadow.getElementById('tw-roof-reset').addEventListener('click', function () {
      roof.outlines = JSON.parse(roof.original); roof.selected = roof.originalSelected; roof.changed = false; roof.full = roof.selected < 0; fit(); draw();
    });
    img.onload = function () { fit(); draw(); };
    img.src = picture.image;
  }

  // The part of the picture shown: the whole of it, or the selected roof with some ground around it.
  function fit() {
    var v = { x: 0, y: 0, w: roof.width, h: roof.height };
    if (!roof.full && roof.selected >= 0) {
      var pts = roof.outlines[roof.selected].points, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (var i = 0; i < pts.length; i++) { x0 = Math.min(x0, pts[i][0]); y0 = Math.min(y0, pts[i][1]); x1 = Math.max(x1, pts[i][0]); y1 = Math.max(y1, pts[i][1]); }
      var m = MARGIN_M / roof.mpp, side = Math.max(x1 - x0, y1 - y0) + 2 * m;
      side = Math.min(side, roof.width, roof.height);
      v = { x: (x0 + x1) / 2 - side / 2, y: (y0 + y1) / 2 - side / 2, w: side, h: side };
      v.x = Math.max(0, Math.min(roof.width - side, v.x)); v.y = Math.max(0, Math.min(roof.height - side, v.y));
    }
    roof.view = v;
  }

  function draw() {
    var canvas = shadow.getElementById('tw-canvas');
    if (!canvas || !roof || !roof.view) return;
    var v = roof.view, css = canvas.clientWidth || 440, ratio = window.devicePixelRatio || 1;
    var cssH = css * (v.h / v.w);
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(css * ratio); canvas.height = Math.round(cssH * ratio);
    var g = canvas.getContext('2d'), k = canvas.width / v.w;
    g.drawImage(roof.img, v.x, v.y, v.w, v.h, 0, 0, canvas.width, canvas.height);
    var X = function (x) { return (x - v.x) * k; }, Y = function (y) { return (y - v.y) * k; };
    for (var i = 0; i < roof.outlines.length; i++) {
      var pts = roof.outlines[i].points, mine = i === roof.selected;
      g.beginPath();
      for (var j = 0; j < pts.length; j++) { if (j) g.lineTo(X(pts[j][0]), Y(pts[j][1])); else g.moveTo(X(pts[j][0]), Y(pts[j][1])); }
      g.closePath();
      g.lineWidth = (mine ? 3 : 1.5) * ratio;
      g.strokeStyle = mine ? brand : 'rgba(255,255,255,.85)';
      g.fillStyle = mine ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.08)';
      g.fill(); g.stroke();
      if (mine) for (var h = 0; h < pts.length; h++) {
        g.beginPath(); g.arc(X(pts[h][0]), Y(pts[h][1]), HANDLE * ratio, 0, Math.PI * 2);
        g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2 * ratio; g.strokeStyle = brand; g.stroke();
      }
    }
    shadow.getElementById('tw-roof-update').disabled = !(roof.changed && roof.selected >= 0);
    shadow.getElementById('tw-roof-zoom').textContent = roof.full ? (roof.selected >= 0 ? 'Zoom in on my roof' : '') : 'Not your roof? See the whole picture';
    shadow.getElementById('tw-roof-hint').textContent = roof.selected < 0
      ? 'Tap your roof in the picture.'
      : 'Drag a white dot to move a corner; drag the line between two dots to add one. If we outlined the wrong building, see the whole picture and tap yours.';
  }

  // A pointer's place in picture pixels.
  function at(ev) {
    var canvas = shadow.getElementById('tw-canvas'), r = canvas.getBoundingClientRect(), v = roof.view;
    return { x: v.x + ((ev.clientX - r.left) / r.width) * v.w, y: v.y + ((ev.clientY - r.top) / r.height) * v.h, perCss: v.w / r.width };
  }
  function inside(x, y, pts) {
    var hit = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if ((pts[i][1] > y) !== (pts[j][1] > y) && x < ((pts[j][0] - pts[i][0]) * (y - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) hit = !hit;
    }
    return hit;
  }
  function nearestCorner(q) {
    if (roof.selected < 0) return -1;
    var pts = roof.outlines[roof.selected].points, best = -1, bestD = GRAB * q.perCss;
    for (var i = 0; i < pts.length; i++) { var d = Math.hypot(pts[i][0] - q.x, pts[i][1] - q.y); if (d < bestD) { bestD = d; best = i; } }
    return best;
  }

  function down(ev) {
    if (!roof || !roof.view) return;
    var q = at(ev), canvas = shadow.getElementById('tw-canvas');
    var corner = nearestCorner(q);
    if (corner < 0 && roof.selected >= 0) {
      // On the line between two corners: a new corner there, already being dragged.
      var pts = roof.outlines[roof.selected].points, bestD = 10 * q.perCss, after = -1;
      for (var i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1;
        var t = Math.max(0, Math.min(1, ((q.x - a[0]) * dx + (q.y - a[1]) * dy) / len2));
        var d = Math.hypot(a[0] + t * dx - q.x, a[1] + t * dy - q.y);
        if (d < bestD) { bestD = d; after = i; }
      }
      if (after >= 0 && pts.length < 60) { pts.splice(after + 1, 0, [q.x, q.y]); corner = after + 1; roof.changed = true; }
    }
    if (corner >= 0) { roof.drag = corner; if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId); ev.preventDefault(); draw(); return; }
    // Another roof tapped: that one is theirs.
    for (var r = 0; r < roof.outlines.length; r++) {
      if (r !== roof.selected && inside(q.x, q.y, roof.outlines[r].points)) { roof.selected = r; roof.changed = true; roof.full = false; fit(); draw(); return; }
    }
  }
  function move(ev) {
    if (!roof || roof.drag < 0) return;
    var q = at(ev), pts = roof.outlines[roof.selected].points;
    pts[roof.drag] = [Math.max(0, Math.min(roof.width, q.x)), Math.max(0, Math.min(roof.height, q.y))];
    roof.changed = true;
    draw();
  }
  function up() { if (roof) roof.drag = -1; }
  function removeCorner(ev) {
    if (!roof || roof.selected < 0) return;
    var corner = nearestCorner(at(ev)), pts = roof.outlines[roof.selected].points;
    if (corner >= 0 && pts.length > 3) { pts.splice(corner, 1); roof.changed = true; draw(); }
  }

  // The corrected outline goes back; the estimate is worked out again from it.
  function sendOutline() {
    var button = shadow.getElementById('tw-roof-update'), err = shadow.getElementById('tw-roof-error');
    button.disabled = true; err.innerHTML = '';
    fetch(apiBase + '/api/estimator/adjust/' + slug, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estimateId: estimateId, outline: roof.outlines[roof.selected].points }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { err.innerHTML = '<div class="tw-est-error">' + esc(data.error) + '</div>'; button.disabled = false; return; }
        roof.changed = false;
        prices(data);
        shadow.querySelector('.tw-est-roof-title').textContent = 'Is this your roof?';
        var foot = shadow.getElementById('tw-foot');
        if (foot && foot.innerHTML.indexOf('tw-est-disclaimer') < 0 && data.disclaimer) foot.innerHTML = '<div class="tw-est-disclaimer">' + esc(data.disclaimer) + '</div>' + foot.innerHTML;
        draw();
      })
      .catch(function () { err.innerHTML = '<div class="tw-est-error">Something went wrong. Please try again.</div>'; button.disabled = false; });
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function attr(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function num(n) { return Number(n || 0).toLocaleString(); }
})();
