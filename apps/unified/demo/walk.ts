// Walks the built demo in a real browser, the way a visitor would: every screen in the menu, two rows of each list, each tab.
// Reports what a visitor could hit: a call the demo could not answer, a screen that fell into the error page, a script error,
// and any request that left the demo's own host. Used by tests/demo/walk.test.ts and by hand:
//   cd apps/unified && bun run build:demo && bun demo/walk.ts contractor
import { chromium, type Page } from 'playwright-core'
import { serveDemo } from './serve.ts'
import { DEMO_TRADES } from './trades.ts'

export interface WalkReport {
  trade: string
  pages: string[]
  /** Calls the demo answered "not available", with the page they were made on. */
  unavailable: string[]
  /** Pages that showed the error page. */
  errorPages: string[]
  pageErrors: string[]
  /** Anything requested from another host than the demo's. */
  outside: string[]
  /** Pages whose own text says something is not available in the demo. */
  unavailableText: string[]
}

const SKIP = [/\/crm\/kiosk/, /logout/i]
const MAX_PAGES = 160

export async function walkDemo(opts: { base: string; trade: string; viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark'; maxPages?: number; page?: Page }): Promise<WalkReport> {
  const own = !opts.page
  const browser = own ? await chromium.launch() : null
  const context = own ? await browser!.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 }, colorScheme: opts.colorScheme ?? 'light' }) : null
  const page = opts.page ?? (await context!.newPage())
  // Every browser step has a limit, so a screen that stalls is reported by name instead of running out the test's 15 minutes
  // with nothing said (CI 10/30: the phone walks did, in every trade, and walked in 93 s on a desktop machine).
  page.setDefaultTimeout(15_000)
  page.setDefaultNavigationTimeout(30_000)
  const started = Date.now()
  const report: WalkReport = { trade: opts.trade, pages: [], unavailable: [], errorPages: [], pageErrors: [], outside: [], unavailableText: [] }
  let here = ''
  page.on('pageerror', (e) => report.pageErrors.push(`${here}: ${e.message.slice(0, 160)}`))
  page.on('request', (r) => {
    const u = r.url()
    if (!u.startsWith(opts.base) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:')) report.outside.push(`${here}: ${u}`)
  })

  const links = async () => [...new Set(await page.$$eval('a[href^="/crm"]', (as) => as.map((a) => (a.getAttribute('href') || '').split('#')[0])))].filter(Boolean)
  const drained = async () => page.evaluate(() => { const l = (window as any).__demo?.log; if (!l) return []; const out = l.unavailable.slice(); l.unavailable.length = 0; return out as string[] })
  const visit = async (href: string, first = false) => {
    here = href
    try {
      await page.goto(first ? `${opts.base}${href}?trade=${opts.trade}` : `${opts.base}${href}`, { waitUntil: 'networkidle', timeout: 30_000 })
      await page.waitForTimeout(350)
      for (const tab of (await page.$$('[role="tab"]')).slice(0, 8)) { try { await tab.click({ timeout: 1500 }); await page.waitForTimeout(300) } catch { /* not clickable now */ } }
      // A list whose rows open on a click: the first row is opened, as a visitor would.
      const here0 = page.url()
      try {
        await page.locator('tbody tr').first().click({ timeout: 1200 })
        await page.waitForTimeout(450)
        const opened = await page.innerText('body').catch(() => '')
        if (/Something went wrong/.test(opened)) report.errorPages.push(`${href} (first row)`)
        if (page.url() !== here0) await page.goBack({ waitUntil: 'networkidle' })
        else await page.keyboard.press('Escape')
      } catch { /* no rows, or not clickable */ }
      const text = await page.innerText('body').catch(() => '')
      if (/Something went wrong/.test(text)) report.errorPages.push(href)
      if (/not available in the demo/i.test(text)) report.unavailableText.push(href)
      for (const u of await drained()) report.unavailable.push(`${u}  (on ${href})`)
    } catch (e) { report.pageErrors.push(`${href}: ${(e as Error).message.slice(0, 120)}`) }
  }

  await visit('/crm', true)
  const nav = (await links()).filter((h) => !SKIP.some((re) => re.test(h)))
  const visited = new Set<string>(['/crm'])
  const perSection = new Map<string, number>()
  const queue = [...nav]
  while (queue.length && visited.size < (opts.maxPages ?? MAX_PAGES)) {
    const href = queue.shift()!
    if (visited.has(href)) continue
    visited.add(href)
    const t = Date.now()
    await visit(href)
    const took = (Date.now() - t) / 1000
    if (process.env.DEMO_WALK_LOG || took > 20) console.log(`  [walk ${opts.trade} ${opts.viewport?.width ?? 1440}px] ${href} ${took.toFixed(1)}s (${visited.size} screens, ${((Date.now() - started) / 1000).toFixed(0)}s in)`)
    for (const found of await links()) {
      if (visited.has(found) || queue.includes(found) || SKIP.some((re) => re.test(found))) continue
      const section = found.split('/').slice(0, 3).join('/')
      if ((perSection.get(section) ?? 0) >= 2) continue
      perSection.set(section, (perSection.get(section) ?? 0) + 1)
      queue.push(found)
    }
  }
  report.pages = [...visited]
  if (own) await browser!.close()
  return report
}

if (import.meta.main) {
  const wanted = process.argv.slice(2)
  const server = serveDemo()
  const base = `http://localhost:${server.port}`
  let bad = 0
  for (const trade of DEMO_TRADES.filter((t) => !wanted.length || wanted.includes(t.id))) {
    const r = await walkDemo({ base, trade: trade.id })
    console.log(`${trade.id}: ${r.pages.length} pages — ${r.unavailable.length} unanswered, ${r.errorPages.length} error pages, ${r.pageErrors.length} script errors, ${r.outside.length} outside requests`)
    for (const line of [...new Set(r.unavailable)]) console.log(`   unanswered: ${line}`)
    for (const line of r.errorPages) console.log(`   error page: ${line}`)
    for (const line of r.unavailableText) console.log(`   says unavailable: ${line}`)
    for (const line of r.pageErrors) console.log(`   script error: ${line}`)
    for (const line of r.outside) console.log(`   OUTSIDE: ${line}`)
    bad += r.unavailable.length + r.errorPages.length + r.pageErrors.length + r.outside.length
  }
  server.stop(true)
  process.exit(bad ? 1 : 0)
}
