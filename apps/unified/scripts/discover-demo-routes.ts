// Walks the REAL CRM screens in a real browser, against a real server seeded as the demo's sample business, and writes down
// every read (GET /api/…) they make: demo/routes/<trade>.json. The recorder (demo/record.ts) asks the real server for exactly
// those, so the demo answers what the screens ask — nothing hand-listed.
//
//   cd apps/unified && bun run build:web                       (the real screens, web/dist)
//   cd apps/unified && bun scripts/discover-demo-routes.ts contractor [salon …]
//
// A page that throws, or a read that fails, is printed: those are the places to look at before trusting the manifest.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { DEMO_TRADES } from '../demo/trades.ts'
import { bootDemoTenant } from '../demo/seed/kit.ts'
import { ROUTES_DIR } from '../demo/record.ts'
import { looksLikeId, templateOf } from '../web/demo/keys.ts'
import { isPostRead } from '../demo/postReads.ts'

const DIST = path.resolve(import.meta.dir, '../web/dist')
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('Build the real screens first: bun run build:web'); process.exit(1) }

/** Pages that lock the screen or leave the app: never walked. */
const SKIP = [/\/crm\/kiosk/, /logout/i]
/** Reads that are files or live streams, not the screens' data. */
const NOT_DATA = [/^\/api\/auth\//, /^\/api\/live/, /\/(pdf|download|export|csv|file|photo|image|logo|thumbnail)(\/|$|\?)/]
const MAX_PAGES = 160

const wanted = process.argv.slice(2)
const trades = DEMO_TRADES.filter((t) => !wanted.length || wanted.includes(t.id))

for (const trade of trades) {
  const seed = (await import(`../demo/seed/${trade.id}.ts`)).default
  const kit = await bootDemoTenant(trade, DIST)
  await seed(kit)
  const server = Bun.serve({ port: 0, fetch: kit.t.app.fetch, websocket: kit.t.services.live.websocket })
  const base = `http://localhost:${server.port}`

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const signedIn = await context.request.post(`${base}/api/auth/login`, { headers: { 'X-Auth-Mode': 'cookie' }, data: kit.login })
  if (!signedIn.ok()) throw new Error(`${trade.id}: sign-in failed ${signedIn.status()}`)
  const page = await context.newPage()

  const reads = new Set<string>()
  const failed: string[] = []
  const problems: string[] = []
  let currentPath = ''
  const posts = new Map<string, unknown>()
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (r.method() === 'POST' && isPostRead(u.pathname) && !posts.has(u.pathname)) { try { posts.set(u.pathname, r.postDataJSON()) } catch { /* no body */ } }
    if (r.method() !== 'GET' || !u.pathname.startsWith('/api/') || NOT_DATA.some((re) => re.test(u.pathname))) return
    const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
    reads.add(templateOf(u.pathname) + (params.length ? '?' + params.map(([k, v]) => `${k}=${looksLikeId(v) ? ':id' : v}`).join('&') : ''))
  })
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith('/api/') && r.status() >= 400 && r.request().method() === 'GET' && ![401].includes(r.status())) failed.push(`${r.status()} ${u.pathname} (on ${currentPath})`)
  })
  page.on('pageerror', (e) => problems.push(`${currentPath}: ${e.message.slice(0, 160)}`))

  const links = async (p: Page) => [...new Set(await p.$$eval('a[href^="/crm"]', (as) => as.map((a) => (a.getAttribute('href') || '').split('#')[0])))].filter(Boolean)
  const visit = async (href: string) => {
    currentPath = href
    try {
      await page.goto(base + href, { waitUntil: 'networkidle', timeout: 30_000 })
      await page.waitForTimeout(400)
      // Tabs on the page: each one reads its own.
      const tabs = await page.$$('[role="tab"]')
      for (const tab of tabs.slice(0, 8)) { try { await tab.click({ timeout: 1500 }); await page.waitForTimeout(350) } catch { /* not clickable now */ } }
      // A list whose rows open on a click (not a link): the first row is opened once, so its screen's reads are written down.
      const before = page.url()
      try {
        await page.locator('tbody tr').first().click({ timeout: 1200 })
        await page.waitForTimeout(500)
        if (page.url() !== before) await page.goBack({ waitUntil: 'networkidle' })
        else await page.keyboard.press('Escape')
      } catch { /* no rows, or not clickable */ }
    } catch (e) { problems.push(`${href}: ${(e as Error).message.slice(0, 120)}`) }
  }

  await visit('/crm')
  if (process.env.DEBUG_DISCOVER) { console.log('url', page.url()); console.log((await page.innerText('body')).slice(0, 400)); await page.screenshot({ path: '/tmp/scratch/discover.png' }) }
  const nav = (await links(page)).filter((h) => !SKIP.some((re) => re.test(h)))
  const visited = new Set<string>(['/crm'])
  const perSection = new Map<string, number>()
  const queue = [...nav]
  while (queue.length && visited.size < MAX_PAGES) {
    const href = queue.shift()!
    if (visited.has(href)) continue
    visited.add(href)
    await visit(href)
    // Rows on a list page link to their own pages: two of each kind are walked.
    for (const found of await links(page)) {
      if (visited.has(found) || queue.includes(found) || SKIP.some((re) => re.test(found))) continue
      const section = found.split('/').slice(0, 3).join('/')
      if ((perSection.get(section) ?? 0) >= 2) continue
      perSection.set(section, (perSection.get(section) ?? 0) + 1)
      queue.push(found)
    }
  }

  await browser.close()
  server.stop(true)
  const routes = [...reads].sort()
  fs.mkdirSync(ROUTES_DIR, { recursive: true })
  fs.writeFileSync(path.join(ROUTES_DIR, `${trade.id}.json`), JSON.stringify({ discoveredOn: kit.today, routes, ...(posts.size ? { posts: [...posts].map(([path, body]) => ({ path, body })) } : {}) }, null, 1) + '\n')
  console.log(`${trade.id}: ${visited.size} pages walked, ${routes.length} reads`)
  for (const f of [...new Set(failed)]) console.log(`   read refused: ${f}`)
  for (const p of problems) console.log(`   problem: ${p}`)
}
process.exit(0)
