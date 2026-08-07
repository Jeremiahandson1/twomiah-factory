// The public status page's HTML.
//
// Served straight from the API rather than the platform SPA on purpose: this
// page has to work when the platform's host is the thing that is broken, so
// it has no build step, no bundle and no external requests — only a fetch of
// /api/v1/factory/public/status from the same origin.

export const STATUS_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Twomiah Status</title>
<style>
  :root {
    --bg: #f7f8fa; --card: #fff; --text: #111827; --muted: #6b7280; --line: #e5e7eb;
    --ok: #16a34a; --warn: #d97706; --bad: #dc2626; --unknown: #6b7280;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0b0f17; --card: #131a24; --text: #e5e7eb; --muted: #9ca3af; --line: #263041; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 40px 20px 64px; }
  h1 { font-size: 1.35rem; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: .875rem; margin-bottom: 28px; }
  .banner { display: flex; align-items: center; gap: 12px; background: var(--card);
            border: 1px solid var(--line); border-left-width: 5px; border-radius: 12px;
            padding: 18px 20px; margin-bottom: 24px; }
  .banner h2 { font-size: 1.05rem; margin: 0; }
  .dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
  .operational { color: var(--ok); } .degraded { color: var(--warn); }
  .down { color: var(--bad); } .unknown { color: var(--unknown); }
  .bg-operational { background: var(--ok); } .bg-degraded { background: var(--warn); }
  .bg-down { background: var(--bad); } .bg-unknown { background: var(--unknown); }
  .bd-operational { border-left-color: var(--ok); } .bd-degraded { border-left-color: var(--warn); }
  .bd-down { border-left-color: var(--bad); } .bd-unknown { border-left-color: var(--unknown); }
  .list { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 16px;
         padding: 14px 20px; border-top: 1px solid var(--line); }
  .row:first-child { border-top: 0; }
  .name { font-weight: 600; }
  .detail { color: var(--muted); font-size: .82rem; }
  .state { display: flex; align-items: center; gap: 8px; font-size: .85rem; font-weight: 600; white-space: nowrap; }
  h3 { font-size: .95rem; margin: 32px 0 10px; }
  .incident { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
              padding: 16px 20px; margin-bottom: 10px; }
  .incident .meta { color: var(--muted); font-size: .78rem; margin-top: 6px; }
  .incident p { margin: 8px 0 0; white-space: pre-wrap; }
  footer { color: var(--muted); font-size: .8rem; margin-top: 36px; }
  a { color: inherit; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Twomiah Status</h1>
    <div class="sub" id="checked">Checking…</div>

    <div class="banner bd-unknown" id="banner">
      <span class="dot bg-unknown" id="banner-dot"></span>
      <h2 id="summary">Checking…</h2>
    </div>

    <div class="list" id="components"></div>

    <div id="open-wrap" hidden>
      <h3>Open incidents</h3>
      <div id="open"></div>
    </div>

    <div id="recent-wrap" hidden>
      <h3>Recently resolved</h3>
      <div id="recent"></div>
    </div>

    <footer>
      Checks run when this page loads and every 60 seconds after.
      Something wrong that is not listed here? Email
      <a href="mailto:support@twomiah.com">support@twomiah.com</a>.
    </footer>
  </div>

<script>
  var LABEL = { operational: 'Operational', degraded: 'Degraded', down: 'Down', unknown: 'Not reporting' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function when(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
  }

  function incidentHtml(inc, resolved) {
    return '<div class="incident">' +
      '<strong>' + esc(inc.title) + '</strong>' +
      (inc.body ? '<p>' + esc(inc.body) + '</p>' : '') +
      '<div class="meta">' + esc(inc.component) + ' · ' + esc(inc.impact) +
      ' · started ' + esc(when(inc.started_at)) +
      (resolved ? ' · resolved ' + esc(when(inc.resolved_at)) : '') +
      '</div></div>';
  }

  function render(data) {
    document.getElementById('summary').textContent = data.summary;
    document.getElementById('checked').textContent = 'Last checked ' + when(data.checkedAt);

    var banner = document.getElementById('banner');
    banner.className = 'banner bd-' + data.overall;
    document.getElementById('banner-dot').className = 'dot bg-' + data.overall;

    document.getElementById('components').innerHTML = data.components.map(function (c) {
      return '<div class="row"><div><div class="name">' + esc(c.name) + '</div>' +
        '<div class="detail">' + esc(c.detail) + '</div></div>' +
        '<div class="state ' + c.state + '"><span class="dot bg-' + c.state + '"></span>' +
        (LABEL[c.state] || c.state) + '</div></div>';
    }).join('');

    var open = (data.incidents && data.incidents.open) || [];
    document.getElementById('open-wrap').hidden = open.length === 0;
    document.getElementById('open').innerHTML = open.map(function (i) { return incidentHtml(i, false); }).join('');

    var recent = (data.incidents && data.incidents.recent) || [];
    document.getElementById('recent-wrap').hidden = recent.length === 0;
    document.getElementById('recent').innerHTML = recent.map(function (i) { return incidentHtml(i, true); }).join('');
  }

  function load() {
    fetch('/api/v1/factory/public/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        // If even this fetch fails, say so — do not leave a stale green page up.
        document.getElementById('summary').textContent = 'Cannot reach the status service';
        document.getElementById('banner').className = 'banner bd-down';
        document.getElementById('banner-dot').className = 'dot bg-down';
        document.getElementById('checked').textContent = 'Last attempt ' + new Date().toLocaleString();
      });
  }

  load();
  setInterval(load, 60000);
</script>
</body>
</html>`
