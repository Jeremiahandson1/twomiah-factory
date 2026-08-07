/**
 * Twomiah Bookings — embeddable widget for non-Twomiah sites.
 *
 * Usage:
 *   <div id="twomiah-book" data-site="https://acme.twomiah.app" data-service="deep-clean"></div>
 *   <script src="https://acme.twomiah.app/scripts/book-embed.js" async></script>
 *
 * Creates an auto-resizing iframe pointing at /book/<service>?embed=1
 * The host (twomiah site) sends a postMessage with the height every
 * time content changes so we can resize without scroll bars.
 */
(function () {
  function init() {
    var holders = document.querySelectorAll('[id^=twomiah-book]');
    holders.forEach(function (h) {
      if (h.dataset.twomiahReady) return;
      h.dataset.twomiahReady = '1';
      var site = h.dataset.site;
      var service = h.dataset.service;
      if (!site) return;
      var url = site.replace(/\/$/, '') + '/book' + (service ? '/' + encodeURIComponent(service) : '') + '?embed=1';
      var iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.style.cssText = 'width:100%;border:0;display:block;min-height:480px;';
      iframe.setAttribute('allow', 'payment');
      iframe.setAttribute('loading', 'lazy');
      h.appendChild(iframe);
      window.addEventListener('message', function (ev) {
        if (!ev.data || typeof ev.data !== 'object') return;
        if (ev.data.type !== 'twomiah-book-height') return;
        if (ev.source !== iframe.contentWindow) return;
        var h = parseInt(ev.data.height, 10);
        if (h > 0) iframe.style.height = h + 'px';
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
