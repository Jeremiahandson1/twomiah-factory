// Pictures of the demo for review: each trade's home and three key screens, wide (1440) and phone (390), light and dark, one PNG
// each, plus one contact sheet per trade. Written OUTSIDE the repo (default: ./demo-sheets under the system temp folder).
//
//   cd apps/unified && bun run build:demo && bun demo/sheets.ts [outDir] [trade …]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { serveDemo } from './serve.ts'
import { DEMO_TRADES } from './trades.ts'

/** The three screens a visitor opens first, per trade (the first of each pair that exists in that trade's menu). */
export const KEY_SCREENS: Record<string, string[][]> = {
  contractor: [['/crm/jobs'], ['/crm/quotes'], ['/crm/invoices']],
  roofing: [['/crm/jobs'], ['/crm/canvass', '/crm/storms'], ['/crm/quotes']],
  homecare: [['/crm/clients'], ['/crm/schedule', '/crm/scheduling'], ['/crm/payroll', '/crm/billing']],
  salon: [['/crm/book', '/crm/calendar', '/crm/appointments'], ['/crm/clients', '/crm/contacts'], ['/crm/services']],
  'restaurant-bar': [['/crm/tonight', '/crm/register'], ['/crm/menu'], ['/crm/parties', '/crm/events']],
  store: [['/crm/orders'], ['/crm/products'], ['/crm/customers', '/crm/contacts']],
}

const outDir = process.argv[2] && !DEMO_TRADES.some((t) => t.id === process.argv[2]) ? process.argv[2] : path.join(os.tmpdir(), 'demo-sheets')
const wanted = process.argv.slice(2).filter((a) => DEMO_TRADES.some((t) => t.id === a))
fs.mkdirSync(outDir, { recursive: true })

const server = serveDemo()
const base = `http://localhost:${server.port}`
const browser = await chromium.launch()
const shots: Record<string, string[]> = {}
for (const trade of DEMO_TRADES.filter((t) => !wanted.length || wanted.includes(t.id))) {
  shots[trade.id] = []
  for (const [vw, vh, size] of [[1440, 900, 'wide'], [390, 844, 'phone']] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ viewport: { width: vw, height: vh }, colorScheme: scheme, deviceScaleFactor: 1 })
      await context.addInitScript((s) => { try { localStorage.setItem('theme', s) } catch { /* private */ } }, scheme)
      const page = await context.newPage()
      await page.goto(`${base}/crm?trade=${trade.id}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(600)
      const menu = new Set(await page.$$eval('a[href^="/crm"]', (as) => as.map((a) => (a.getAttribute('href') || '').split('?')[0])))
      const wantedScreens = ['/crm', ...KEY_SCREENS[trade.id].map((opts) => opts.find((o) => menu.has(o)) ?? [...menu].filter((m) => m !== '/crm')[0])]
      let i = 0
      for (const screen of wantedScreens) {
        if (screen !== '/crm') { await page.goto(`${base}${screen}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500) }
        const file = path.join(outDir, `${trade.id}-${size}-${scheme}-${i++}-${screen.replace(/\W+/g, '_')}.png`)
        await page.screenshot({ path: file })
        shots[trade.id].push(file)
      }
      await context.close()
    }
  }
  console.log(`${trade.id}: ${shots[trade.id].length} pictures`)
}
await browser.close()
server.stop(true)
console.log(`written to ${outDir}`)
