// The storefront's "This store is unavailable" page — website-store/routes/storeStatus.ts. (10/14)
//
// Owner: "what do the pros do? shopify?" — a frozen Shopify store is unavailable to shoppers. Ours kept selling after
// the subscription ended. The storefront now asks crm-store's GET /api/public/status (cached 30s) and, while closed,
// serves a plain page. The rule that matters most: a blip never takes a working shop down. Dependency-free.
const S = await import(new URL('../../templates/website-store/routes/storeStatus.ts', import.meta.url).href)
const { readFileSync } = await import('node:fs')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const reply = (body: unknown, status = 200) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

{
  const calls: string[] = []
  let t = 1000
  const status = S.createStoreStatus({ crmStoreApiUrl: 'https://shop-api.test/', fetchImpl: (async (u: string) => { calls.push(u); return new Response(JSON.stringify({ open: false, storeName: 'Test Shop Co' })) }) as any, now: () => t, ttlMs: 30_000 })
  const a = await status()
  check('closed: crm-store says { open: false } → closed, with the shop\'s name', a.open === false && a.storeName === 'Test Shop Co', a)
  check('…asked at /api/public/status (trailing slash on the base handled)', calls[0] === 'https://shop-api.test/api/public/status', calls)
  t += 10_000; await status()
  check('cached: a second page within 30s does not ask again', calls.length === 1, calls)
  t += 25_000; await status()
  check('…and after 30s it asks again, so a restart reopens the shop promptly', calls.length === 2, calls)
}
{
  const open = await S.createStoreStatus({ crmStoreApiUrl: 'https://x.test', fetchImpl: reply({ open: true, storeName: 'X' }) as any })()
  check('open: { open: true } → open', open.open === true)
}
for (const [label, impl] of [
  ['crm-store unreachable', (async () => { throw new Error('ECONNREFUSED') }) as any],
  ['a 500', reply({ error: 'boom' }, 500)],
  ['a 503 from something else', reply('Service Unavailable', 503)],
  ['a reply that is not JSON', reply('<html>gateway</html>')],
  ['a JSON reply without open:false', reply({ status: 'ok' })],
] as const) {
  const s = await S.createStoreStatus({ crmStoreApiUrl: 'https://x.test', fetchImpl: impl })()
  check(`a blip never takes a working shop down — ${label} → OPEN`, s.open === true, s)
}
check('no crm-store configured → open (never asks)', (await S.createStoreStatus({ crmStoreApiUrl: '', fetchImpl: (async () => { throw new Error('should not be called') }) as any })()).open === true)

{
  const shopper = ['/', '/shop', '/product/test-mug', '/cart', '/about', '/contact', '/blog', '/blog/a-post']
  const kept = ['/api/health', '/api/checkout', '/admin', '/admin/pages', '/uploads/x.jpg', '/build/app.css', '/robots.txt', '/sitemap.xml', '/checkout/success']
  check('every shopper page is closed', shopper.every((p) => !S.servesWhileClosed(p)), shopper.filter((p) => S.servesWhileClosed(p)))
  check('kept: health, the content admin, uploads, assets, robots — and the thank-you page for someone who just paid', kept.every((p) => S.servesWhileClosed(p)), kept.filter((p) => !S.servesWhileClosed(p)))
  check('a look-alike is not let through (/administer, /apix)', !S.servesWhileClosed('/administer') && !S.servesWhileClosed('/apix'))
}
{
  const html = S.unavailablePage('<b>Bad & Co</b>')
  check('the page names the shop, escaped', html.includes('&lt;b&gt;Bad &amp; Co&lt;/b&gt; is unavailable') && !html.includes('<b>Bad'), html.slice(0, 200))
  check('…with no name it still reads', S.unavailablePage(null).includes('This store is unavailable'))
  check('…readable in OS dark mode, and not indexed', /prefers-color-scheme: dark/.test(html) && /noindex/.test(html))
  check('…and says nothing about billing or why', !/subscription|billing|payment|cancel/i.test(html))
}
{
  // The gate sits in front of every page route: a middleware that ran after them would never be reached.
  const src = readFileSync(new URL('../../templates/website-store/server-static.ts', import.meta.url), 'utf8')
  const gate = src.indexOf('const storeStatus = createStoreStatus(')
  const firstPage = src.indexOf("app.get('/', ")
  const statics = src.indexOf("app.use('/*', serveStaticDir(")
  check('the storefront gate is registered before the shop pages and the static handler', gate > 0 && firstPage > gate && statics > gate, { gate, firstPage, statics })
  check('…answers 503 with the page, never cached', /c\.html\(unavailablePage\(s\.storeName\), 503, \{ 'Cache-Control': 'no-store'/.test(src))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
