/**
 * Twomiah Ads — client-side A/B variant assignment + conversion tracking.
 *
 * Drops on every page via base.ejs. On page load:
 *  1. Gets or creates a visitor cookie (1 year, SameSite=Lax)
 *  2. POSTs current path + visitorId to the CRM's /api/public/ads-experiments/assign
 *  3. If a variant comes back, sets <html data-ab-variant="key"> for CSS/JS swaps
 *  4. Stores the experimentId+variantKey on window for later conversion calls
 *
 * Pages opt into rendering different content with CSS selectors like:
 *    html[data-ab-variant="b"] .hero-headline { display: none; }
 *    html[data-ab-variant="b"] .hero-headline-b { display: block; }
 *
 * Conversion tracking:
 *  - On form submit success, the form's parent script calls twomiahAb.convert('lead')
 *  - We also auto-track the /book POST success (booking conversion)
 */
(function () {
  if (!window.fetch) return;

  // CRM URL is injected into a meta tag by base.ejs from the CRM_API_URL
  // tenant env. Fall back to noop if missing.
  var meta = document.querySelector('meta[name="twomiah-crm-url"]');
  var CRM_URL = meta ? meta.getAttribute('content') : '';
  if (!CRM_URL) return;

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value, days) {
    var d = new Date(Date.now() + days * 86400000);
    document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; expires=' + d.toUTCString() + '; SameSite=Lax';
  }
  function randomId() {
    return 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  var visitorId = getCookie('twomiah_v');
  if (!visitorId) { visitorId = randomId(); setCookie('twomiah_v', visitorId, 365); }

  var state = { experimentId: null, variant: null };
  window.twomiahAb = {
    state: state,
    convert: function (eventType, targetId) {
      if (!state.experimentId) return;
      try {
        fetch(CRM_URL.replace(/\/$/, '') + '/api/public/ads-experiments/convert', {
          method: 'POST', mode: 'cors', credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            experimentId: state.experimentId,
            visitorId: visitorId,
            eventType: eventType || 'lead',
            targetId: targetId || null,
          }),
        });
      } catch (e) { /* swallow */ }
    },
  };

  function assign() {
    fetch(CRM_URL.replace(/\/$/, '') + '/api/public/ads-experiments/assign', {
      method: 'POST', mode: 'cors', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: window.location.pathname, visitorId: visitorId }),
    }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (data) {
      if (!data || !data.variant) return;
      state.experimentId = data.experimentId;
      state.variant = data.variant;
      document.documentElement.setAttribute('data-ab-variant', data.variant);
    }).catch(function () { /* swallow */ });
  }

  assign();

  // Auto-track lead form submits
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var action = form.getAttribute('action') || '';
    if (/\/api\/leads/i.test(action) || /\/book\//i.test(action)) {
      // Wait a tick so the form actually submits / the fetch fires first
      setTimeout(function () { window.twomiahAb.convert(action.includes('book') ? 'booking' : 'lead'); }, 0);
    }
  }, true);
})();
