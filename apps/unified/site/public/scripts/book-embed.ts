// Online booking on another website (the business's old site, a Wix or Squarespace page…): the premium site's
// book-embed.js, made to work — the booking pages may now be framed (http/guards.ts EMBED_CSP), and the frame sizes
// itself to the page inside (views/base.ejs, embed). Paste where the booking should appear:
//
//   <div class="twomiah-book" data-service="estimate"></div>
//   <script src="https://<the business's site>/scripts/book-embed.js" async></script>
//
// data-service (optional): one service's page; without it, the list of services. data-site (optional): the booking
// site, when the script is loaded from somewhere else. No framework, no dependencies.
;(function () {
  var script = document.currentScript as HTMLScriptElement | null
  var scriptOrigin = ''
  try { scriptOrigin = script && script.src ? new URL(script.src).origin : '' } catch (e) { scriptOrigin = '' }

  function init() {
    var holders = document.querySelectorAll('.twomiah-book, [id^="twomiah-book"]') as NodeListOf<HTMLElement>
    holders.forEach(function (holder) {
      if (holder.getAttribute('data-twomiah-ready')) return
      var origin = ''
      try { origin = new URL(holder.getAttribute('data-site') || scriptOrigin).origin } catch (e) { return }
      if (!/^https:\/\//.test(origin) && !/^http:\/\/localhost(:\d+)?$/.test(origin)) return
      holder.setAttribute('data-twomiah-ready', '1')
      var service = holder.getAttribute('data-service') || ''
      var frame = document.createElement('iframe')
      frame.src = origin + '/book' + (service ? '/' + encodeURIComponent(service) : '') + '?embed=1'
      frame.title = 'Book online'
      frame.style.cssText = 'width:100%;border:0;display:block;min-height:520px;'
      frame.setAttribute('loading', 'lazy')
      holder.appendChild(frame)
      window.addEventListener('message', function (ev) {
        // only this frame, from the booking site, saying its height
        if (ev.source !== frame.contentWindow || ev.origin !== origin) return
        var d = ev.data
        if (!d || typeof d !== 'object' || d.type !== 'twomiah-book-height') return
        var h = parseInt(d.height, 10)
        if (h > 0 && h < 20000) frame.style.height = h + 'px'
      })
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
