// A visitor's changes live in the page's memory and nowhere else: they show across screens, "Reset demo" takes all of them away,
// and a second tab never had them.
//
//   cd apps/unified && bun test --timeout 240000 tests/demo/reset.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { chromium, type Browser } from 'playwright-core'
import { startHost } from './helpers.ts'

let host: ReturnType<typeof startHost>
let browser: Browser
beforeAll(async () => { host = startHost(); browser = await chromium.launch() })
afterAll(async () => { await browser?.close(); host?.server.stop(true) })

const ADDED = 'Zed Addedinthedemo'

describe('changes and reset', () => {
  test('an added contact shows on its screen, stays through moving around, is gone on Reset; a second tab never saw it', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    await page.goto(`${host.base}/crm/contacts?trade=contractor`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#demo-banner')
    expect(await page.evaluate((t) => document.body.innerText.includes(t), ADDED)).toBe(false)

    // The same call the screen's own "add" makes.
    const made = await page.evaluate(async (name) => {
      const r = await fetch('/api/contacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client', name }) })
      return { status: r.status, id: (await r.json()).id as string }
    }, ADDED)
    expect(made.status).toBe(201)

    // Moving around inside the app (no reload) keeps it.
    await page.getByRole('link', { name: /^Jobs$/ }).first().click()
    await page.waitForLoadState('networkidle')
    await page.getByRole('link', { name: /^Contacts$/ }).first().click()
    await page.waitForLoadState('networkidle')
    await page.waitForFunction((t) => document.body.innerText.includes(t), ADDED, { timeout: 10_000 })

    // Another tab is a fresh demo.
    const other = await context.newPage()
    await other.goto(`${host.base}/crm/contacts?trade=contractor`, { waitUntil: 'networkidle' })
    await other.waitForSelector('#demo-banner')
    expect(await other.evaluate((t) => document.body.innerText.includes(t), ADDED)).toBe(false)
    await other.close()

    // Reset: back to the recorded business.
    await page.getByRole('button', { name: 'Reset demo' }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('#demo-banner')
    const after = await page.evaluate(async () => (await (await fetch('/api/contacts?limit=100')).json()).data.map((c: { name: string }) => c.name))
    expect(after).not.toContain('Zed Addedinthedemo')
    expect(after.length).toBeGreaterThan(5)
    // …and it is still the same trade, signed in.
    expect(await page.evaluate(() => (window as any).__demo.trade)).toBe('contractor')
    expect(await page.evaluate(() => document.body.innerText)).toContain('Sample Ridge Remodeling')
    await context.close()
  })

  test('a job added through the real form appears in the list and is gone after Reset', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const TITLE = 'Gutter cleaning added in the demo'
    const here = () => page.evaluate(() => document.body.innerText)
    await page.goto(`${host.base}/crm/jobs?trade=contractor`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#demo-banner')
    await page.getByRole('button', { name: /Add Job/ }).click()
    const titleLabel = page.getByText('Title *', { exact: true })
    await titleLabel.locator('xpath=following::input[1]').fill(TITLE)
    // Whoever the job is for: the first real choice in the customer list (a contractor's job needs one, PR #173). Found by its
    // "Pick a customer..." line: the first list after the title is now the status.
    const pick = page.locator('select', { has: page.locator('option', { hasText: /^Pick a / }) })
    const options = await pick.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    if (options.length) await pick.selectOption(options[0])
    await page.getByRole('button', { name: /^Create$/ }).click()
    await page.waitForFunction((t) => document.body.innerText.includes(t), TITLE, { timeout: 10_000 })
    expect(await here()).toContain(TITLE)
    await page.getByRole('button', { name: 'Reset demo' }).click()
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('#demo-banner')
    await page.waitForTimeout(500)
    expect(await here()).not.toContain(TITLE)
    await context.close()
  })

  test('nothing the visitor does is written to a place that outlives the tab but the trade and the theme', async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${host.base}/crm?trade=salon`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#demo-banner')
    await page.evaluate(() => fetch('/api/contacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Persisted? No.' }) }))
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie)
    expect(stored).not.toContain('Persisted? No.')
    expect((await context.cookies()).length).toBe(0)
    await context.close()
  })

  test('an action that would reach the outside says so and changes nothing else', async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${host.base}/crm?trade=contractor`, { waitUntil: 'networkidle' })
    await page.waitForSelector('#demo-banner')
    const r = await page.evaluate(async () => {
      const res = await fetch('/api/stripe/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      return { status: res.status, body: await res.json() }
    })
    expect(r.status).toBe(200)
    expect(r.body.message).toBe('In the demo this is not sent.')
    await page.waitForFunction(() => document.body.innerText.includes('In the demo this is not sent.'), null, { timeout: 5_000 })
    await context.close()
  })
})
