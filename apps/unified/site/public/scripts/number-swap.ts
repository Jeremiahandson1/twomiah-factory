/**
 * THE WEBSITE NUMBER SWAP (CallRail's dynamic number insertion; server crm/comms/numberSwap.ts). On the business's own Twomiah site
 * (views/base.ejs), or on any website it pastes this on:
 *   <script src="https://<the business's CRM address>/scripts/number-swap.js" data-slug="<its slug>" defer></script>
 * (data-replace="7155550100" names the number to swap where the site shows another than the one on file.)
 *
 * The visit is told to the CRM — where it landed (its utm tags and ad click ids) and where it came from — and the business's own
 * number on the page (each tel: link, and the number written in the text) becomes the tracking number for that source. Where the
 * visit landed is kept for the visit (sessionStorage), so every page of it shows the same number; a new ad click starts again. The
 * visitor's id is kept on this browser (localStorage) so a visitor pool keeps their number. Every page asks once, and again every
 * 5 minutes while the page stays open, so a pool number stays theirs while they read. Nothing here is personal: a random id.
 */
(function () {
  const me = document.currentScript as HTMLScriptElement | null
  if (!me || !me.dataset.slug) return
  const api = `${new URL(me.src, location.href).origin}/api/public/number-swap/${encodeURIComponent(me.dataset.slug)}/visit`
  const forced = (me.dataset.replace || '').replace(/\D/g, '').slice(-10)
  const get = (s: Storage | null, k: string) => { try { return s?.getItem(k) ?? null } catch { return null } }
  const put = (s: Storage | null, k: string, v: string) => { try { s?.setItem(k, v) } catch { /* not kept */ } }
  const local = (() => { try { return window.localStorage } catch { return null } })()
  const session = (() => { try { return window.sessionStorage } catch { return null } })()

  let visitor = get(local, 'twomiah_visitor')
  if (!visitor || !/^[A-Za-z0-9_-]{8,64}$/.test(visitor)) {
    const a = new Uint8Array(16); crypto.getRandomValues(a)
    visitor = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
    put(local, 'twomiah_visitor', visitor)
  }
  // Where the visit landed: the first page of this visit, or this one when it carries a new ad click or campaign tags.
  const tagged = /[?&](utm_[a-z]+|gclid|gbraid|wbraid|msclkid|fbclid)=/i.test(location.search)
  let landing: { page: string; referrer: string } | null = null
  try { landing = JSON.parse(get(session, 'twomiah_landing') || 'null') } catch { landing = null }
  if (!landing || tagged) {
    landing = { page: location.href, referrer: document.referrer || '' }
    put(session, 'twomiah_landing', JSON.stringify(landing))
  }

  const last10 = (s: string) => s.replace(/\D/g, '').slice(-10)
  let shown: { number: string; tel: string; target: string } | null = null

  /** The number written any common way: 715-555-0100, (715) 555-0100, 715.555.0100, +1 715 555 0100, 7155550100. */
  const writtenAs = (d: string) => new RegExp(`(?:\\+?1[\\s.-]?)?\\(?${d.slice(0, 3)}\\)?[\\s.-]?${d.slice(3, 6)}[\\s.-]?${d.slice(6)}(?!\\d)`, 'g')

  function swapIn(root: ParentNode) {
    if (!shown) return
    const { number, tel, target } = shown
    root.querySelectorAll?.('a[href^="tel:"]').forEach((a) => {
      if (last10(a.getAttribute('href') || '') === target) a.setAttribute('href', `tel:${tel}`)
    })
    const re = writtenAs(target)
    const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT)$/.test(n.parentElement.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    const hits: Text[] = []
    while (walker.nextNode()) { const n = walker.currentNode as Text; re.lastIndex = 0; if (re.test(n.data)) hits.push(n) }
    for (const n of hits) n.data = n.data.replace(writtenAs(target), number)
  }

  async function ask() {
    try {
      const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ visitor, page: landing!.page, referrer: landing!.referrer }), credentials: 'omit' })
      if (!r.ok) return
      const j = await r.json()
      const target = forced || (j && j.replace) || ''
      if (!j || !j.number || target.length !== 10) return
      shown = { number: j.number, tel: j.tel, target }
      swapIn(document.body)
    } catch { /* the page keeps the business's own number */ }
  }

  const start = () => {
    void ask()
    // Content drawn later (a cart, a form's thank-you) gets the number too.
    new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach((n) => { if (n.nodeType === 1) swapIn(n as Element) }) }).observe(document.body, { childList: true, subtree: true })
    setInterval(() => { if (document.visibilityState === 'visible') void ask() }, 5 * 60_000)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
