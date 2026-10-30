// Nothing the demo does can reach a Twomiah, Stripe, Twilio, Cloudflare or Factory server — or any server but its own host.
// Two proofs: (1) the built files contain no such address; (2) in a real browser, every way a page can reach out is tried
// against those hosts and not one request leaves — each is answered inside the page or refused.
//
//   cd apps/unified && bun test --timeout 240000 tests/demo/outbound.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { chromium, type Browser } from 'playwright-core'
import { builtFiles, startHost } from './helpers.ts'
import { OUTSIDE_URL } from '../../web/demo/outside.ts'

const HOSTS = ['https://api.twomiah.com', 'https://twomiah.com', 'https://js.stripe.com', 'https://api.stripe.com', 'https://api.twilio.com', 'https://api.cloudflare.com', 'https://twomiah-factory.onrender.com', 'wss://live.twomiah.com']
const ADDRESS = /(https?|wss?):\/\/[^\s"'`)<>\\]*(twomiah|stripe|twilio|cloudflare|onrender|netlify|factory|googleapis|gstatic|openstreetmap|mapbox|cartocdn)[^\s"'`)<>\\]*/gi

let host: ReturnType<typeof startHost>
let browser: Browser
beforeAll(async () => { host = startHost(); browser = await chromium.launch() })
afterAll(async () => { await browser?.close(); host?.server.stop(true) })

describe('the built demo', () => {
  test('contains no Twomiah, Stripe, Twilio, Cloudflare, Render, Netlify or Factory address', () => {
    const found: string[] = []
    let files = 0
    for (const [rel, bytes] of builtFiles()) {
      if (!/\.(js|css|html|json|svg|txt|map)$/.test(rel) && rel !== '_headers' && rel !== '_redirects') continue
      files++
      for (const m of bytes.toString('utf8').matchAll(ADDRESS)) found.push(`${rel}: ${m[0].slice(0, 100)}`)
    }
    expect(files).toBeGreaterThan(5)
    expect(found.slice(0, 10)).toEqual([])
  })
  test('the build plugin\'s own pattern catches each forbidden host', () => {
    for (const h of HOSTS) expect(new RegExp(OUTSIDE_URL.source, 'i').test(`"${h}/x"`), h).toBe(true)
  })
  test('the page carries a lock that allows only its own origin', async () => {
    const html = await (await fetch(`${host.base}/crm?trade=contractor`)).text()
    expect(html).toContain("connect-src 'self'")
    expect(html).toContain("default-src 'self'")
  })
})

describe('in a real browser, nothing leaves the page', () => {
  test('fetch, XHR, sockets, beacons, images, scripts, frames, forms, links and windows aimed at those hosts', async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    // "Left the page" = reached the network. The browser's own lock (the CSP) refuses a request before it gets that far; the
    // network layer is told of such a request but it fails as blocked by the policy and is never sent. Anything else that
    // goes out — answered, failed to connect, anything — is a leak.
    const isOutside = (u: string) => !u.startsWith(host.base) && !/^(data|blob|about):/.test(u)
    const left: string[] = []
    await context.route((u) => isOutside(u.toString()), async (route) => { left.push(`${route.request().method()} ${route.request().url()} (reached the network)`); await route.abort() })
    page.on('websocket', (w) => { if (!w.url().startsWith('ws://localhost')) left.push(`WS ${w.url()}`) })
    await page.goto(`${host.base}/crm?trade=contractor`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#demo-banner')

    const outcome = await page.evaluate(async (hosts: string[]) => {
      const results: string[] = []
      const violations: string[] = []
      document.addEventListener('securitypolicyviolation', (e) => violations.push(`${e.violatedDirective} ${e.blockedURI}`))
      ;(window as any).__violations = violations
      for (const h of hosts) {
        const url = `${h}/probe`
        const http = url.replace(/^wss?/, 'https')
        await fetch(http).then((r) => results.push(`fetch ${r.status}`), () => results.push('fetch refused'))
        await fetch(http, { method: 'POST', body: '{}', mode: 'no-cors' }).then((r) => results.push(`post ${r.status}`), () => results.push('post refused'))
        await new Promise<void>((done) => { try { const x = new XMLHttpRequest(); x.open('GET', http); x.onloadend = () => { results.push(`xhr ${x.status}`); done() }; x.send() } catch { results.push('xhr refused'); done() } })
        try { const w = new WebSocket(url.replace(/^http/, 'ws')); w.onerror = () => {}; w.onclose = () => {}; results.push(`ws ${w.readyState}`) } catch { results.push('ws refused') }
        try { const e = new EventSource(http); e.onerror = () => {}; results.push(`sse ${e.readyState}`) } catch { results.push('sse refused') }
        try { results.push(`beacon ${navigator.sendBeacon(http, 'x')}`) } catch { results.push('beacon refused') }
        try { const i = new Image(); i.src = `${http}/pixel.png`; document.body.appendChild(i) } catch { /* refused */ }
        try { const s = document.createElement('script'); s.src = `${http}/x.js`; document.head.appendChild(s) } catch { /* refused */ }
        try { const f = document.createElement('iframe'); f.src = `${http}/frame`; document.body.appendChild(f) } catch { /* refused */ }
        try { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `${http}/x.css`; document.head.appendChild(l) } catch { /* refused */ }
        try { const a = document.createElement('a'); a.href = `${http}/page`; a.textContent = 'x'; document.body.appendChild(a); a.click() } catch { /* refused */ }
        try { results.push(`open ${window.open(`${http}/page`) === null ? 'blocked' : 'opened'}`) } catch { results.push('open refused') }
        try { const f = document.createElement('form'); f.action = `${http}/post`; f.method = 'post'; document.body.appendChild(f); f.requestSubmit?.() } catch { /* refused */ }
      }
      return results
    }, HOSTS)
    await page.waitForTimeout(800)

    expect(left, `these requests left the page: ${left.join(', ')}`).toEqual([])
    const violations = await page.evaluate(() => (window as any).__violations as string[])
    expect(violations.some((v) => v.startsWith('img-src')), 'the lock should have refused the images').toBe(true)
    expect(violations.some((v) => v.startsWith('script-src')), 'the lock should have refused the scripts').toBe(true)
    expect(violations.some((v) => v.startsWith('frame-src')), 'the lock should have refused the frames').toBe(true)
    expect(page.url().startsWith(host.base), 'a link click navigated the page away').toBe(true)
    expect(outcome.length).toBeGreaterThan(HOSTS.length * 5)
    await context.close()
  })

  test('the demo\'s own /api calls are all answered inside the page', async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const asked: string[] = []
    page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) asked.push(r.url()) })
    await page.goto(`${host.base}/crm?trade=contractor`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#demo-banner')
    const answered = await page.evaluate(async () => {
      const r = await fetch('/api/contacts?limit=5')
      const lost = await fetch('/api/nothing-like-this')
      return { status: r.status, hasRows: Array.isArray((await r.json()).data), lost: lost.status }
    })
    expect(answered).toEqual({ status: 200, hasRows: true, lost: 404 })
    expect(asked, 'an /api call reached the network layer instead of being answered in the page').toEqual([])
    await context.close()
  })
})
