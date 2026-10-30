// A visitor's session, per trade, in a real (headless) browser: the /demo page, a card, the menu, a row, the primary "add" button,
// the theme switch, an action that would reach outside, and Reset. Prints what was clicked and what happened.
//   cd apps/unified && bun run build:demo && bun demo/clickthrough.ts [trade …]
import { chromium } from 'playwright-core'
import { serveDemo } from './serve.ts'
import { DEMO_TRADES } from './trades.ts'

const wanted = process.argv.slice(2)
const server = serveDemo()
const base = `http://localhost:${server.port}`
const browser = await chromium.launch()
let bad = 0
for (const trade of DEMO_TRADES.filter((t) => !wanted.length || wanted.includes(t.id))) {
  const log: string[] = []
  const problems: string[] = []
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`script error: ${e.message.slice(0, 120)}`))
  page.on('request', (r) => { if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) problems.push(`outside request: ${r.url()}`) })
  const text = () => page.evaluate(() => document.body.innerText)
  const settle = async () => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(400) }

  await page.goto(`${base}/demo`, { waitUntil: 'networkidle' })
  log.push(`opened /demo (${await page.locator('a[href*="trade="]').count()} trade cards)`)
  await page.locator(`a[href*="trade=${trade.id}"]`).first().click(); await settle()
  log.push(`clicked the "${trade.label}" card → ${new URL(page.url()).pathname}; banner "${(await page.locator('#demo-banner').innerText()).split('\n')[0]}"`)
  if (!(await text()).includes(trade.business)) problems.push(`the business name ${trade.business} is not on the screen`)

  const nav = (await page.$$eval('a[href^="/crm/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href') || ''))])).filter((h) => !/kiosk|logout/.test(h)).slice(1, 4)
  for (const href of nav) {
    await page.locator(`a[href="${href}"]`).first().click(); await settle()
    log.push(`clicked the menu item ${href} → ${/Something went wrong/.test(await text()) ? 'ERROR PAGE' : 'rendered'}`)
    if (/Something went wrong/.test(await text())) problems.push(`error page on ${href}`)
  }

  const row = page.locator('tbody tr').first()
  if (await row.count()) { await row.click({ timeout: 3000 }).catch(() => {}); await settle(); log.push(`opened the first row of the list → ${new URL(page.url()).pathname}${/Something went wrong/.test(await text()) ? ' ERROR PAGE' : ''}`); if (/Something went wrong/.test(await text())) problems.push('error page on a row'); await page.goBack().catch(() => {}); await settle() }

  const add = page.getByRole('button', { name: /^(\+\s*)?(Add|New)\b/i }).first()
  if (await add.count()) { const label = (await add.innerText()).trim(); await add.click().catch(() => {}); await page.waitForTimeout(600); log.push(`clicked "${label}" → a form ${(await page.locator('form, [role="dialog"]').count()) ? 'opened' : 'did not open'}`); await page.keyboard.press('Escape') }

  await page.getByRole('button', { name: /dark|light|theme/i }).first().click({ timeout: 2000 }).then(() => log.push('switched the theme')).catch(() => log.push('(theme switch not found by name)'))

  const sent = await page.evaluate(async () => (await fetch('/api/stripe/connect', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status)
  await page.waitForTimeout(300)
  log.push(`an outside-reaching action (connect Stripe) → answered ${sent}, notice on screen: ${(await text()).includes('In the demo this is not sent.')}`)

  await page.getByRole('button', { name: 'Reset demo' }).click(); await settle()
  log.push(`clicked Reset demo → back on ${new URL(page.url()).pathname}, signed in: ${(await text()).includes(trade.business)}`)
  await page.getByRole('link', { name: 'All demos' }).click(); await settle()
  log.push(`clicked All demos → ${new URL(page.url()).pathname}`)

  console.log(`\n${trade.label}\n  - ${log.join('\n  - ')}`)
  for (const p of problems) { console.log(`  ! ${p}`); bad++ }
  await context.close()
}
await browser.close(); server.stop(true)
process.exit(bad ? 1 : 0)
