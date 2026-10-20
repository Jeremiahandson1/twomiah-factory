// docs/TRACKING_STANDARD.md — the website tracks ads the way Google's own people set it up on a live customer's site:
// Tag Manager only, the one #form-success shown when a lead is saved, nothing in the policy blocking Google's tags.
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const CONTACT = { type: 'contact', variant: 'form-info', data: { heading: 'Get in touch', phone: '608-555-0142' } }
const site = (set: Record<string, unknown>) => t.db.update(t.schema.website).set(set as any).where(eq(t.schema.website.companyId, companyId))
const page = async (p = '/') => { const r = await t.call(p); return { body: await r.text(), csp: r.headers.get('content-security-policy') || '' } }
let ip = 10
const plainPost = async (fields: Record<string, string>): Promise<string> => (await t.call('/api/leads', {
  method: 'POST', body: new URLSearchParams(fields),
  headers: { Accept: 'text/html', 'X-Forwarded-For': `192.0.2.${ip++}`, 'content-type': 'application/x-www-form-urlencoded' },
})).text()

beforeAll(async () => {
  t = await bootTenant()
  const [co] = await t.db.insert(t.schema.company).values({ name: 'Westridge Builders', slug: 'westridge', email: 'owner@westridge.example', phone: '608-555-0142' }).returning()
  companyId = co.id
  await t.db.insert(t.schema.website).values({ companyId, googleTagManagerId: 'GTM-T7ABC12', googleAnalyticsId: 'G-ABCDEF1234', googleAdsId: 'AW-123456789' })
  await t.db.insert(t.schema.page).values([{ companyId, slug: 'home', title: 'Home', sections: [CONTACT] }])
})

describe('rule 1 — Tag Manager only', () => {
  test('with a container set: its head snippet and noscript, and no gtag beside it even with GA4 and Ads ids saved', async () => {
    const { body } = await page()
    expect(body).toContain("'dataLayer','GTM-T7ABC12'")
    expect(body).toContain('https://www.googletagmanager.com/ns.html?id=GTM-T7ABC12')
    expect(body).not.toContain('gtag/js')
    expect(body).not.toContain("gtag('config'")
  })

  test('without a container, the GA4/Ads snippet is printed as before', async () => {
    await site({ googleTagManagerId: null })
    const { body } = await page()
    expect(body).toContain('https://www.googletagmanager.com/gtag/js?id=G-ABCDEF1234')
    expect(body).toContain("gtag('config','AW-123456789')")
    await site({ googleTagManagerId: 'GTM-T7ABC12' })
  })
})

describe('rule 5 — the one #form-success', () => {
  test('every page carries exactly one, hidden from load, and the function that shows it', async () => {
    const { body } = await page()
    expect(body.match(/id="form-success"/g)?.length).toBe(1)
    expect(body).toMatch(/id="form-success"[^>]*style="display:none/)
    expect(body).toContain('window.twomiahLeadSent=function')
  })

  test('every website form that saves a lead by script shows it on success; no section has its own #form-success', () => {
    const dir = path.join(import.meta.dir, '../site/views/sections')
    const scripted: string[] = []
    for (const type of fs.readdirSync(dir)) for (const file of fs.readdirSync(path.join(dir, type))) {
      const src = fs.readFileSync(path.join(dir, type, file), 'utf8')
      expect({ file: `${type}/${file}`, own: /id=["']form-success["']/.test(src) }).toEqual({ file: `${type}/${file}`, own: false })
      // A section that sends a lead to /api/leads by script must announce the saved lead.
      if (/\/api\/leads/.test(src) && /fetch\(/.test(src)) { scripted.push(`${type}/${file}`); expect({ file: `${type}/${file}`, calls: src.includes('twomiahLeadSent') }).toEqual({ file: `${type}/${file}`, calls: true }) }
    }
    expect(scripted.sort()).toEqual(['care/finder.ejs', 'contact/form-info.ejs', 'inventory/unit.ejs'])
  })

  test('a plain post that saved a lead lands on a page with the container and a visible #form-success', async () => {
    const body = await plainPost({ name: 'No Script', email: 'ns@example.com', message: 'Plain form post' })
    expect(body).toContain('Thank you.')
    expect(body).toContain("'dataLayer','GTM-T7ABC12'")
    expect(body).toContain('<p id="form-success" role="status">')
  })

  test("a bot's quiet thanks (the honeypot) and a refused post never show it", async () => {
    const bot = await plainPost({ name: 'Bot Bot', email: 'b@example.com', message: 'spam spam', website: 'http://x' })
    expect(bot).toContain('Thank you.')
    expect(bot).not.toContain('form-success')
    const refused = await plainPost({ name: 'X', email: 'nope', message: 'hi' })
    expect(refused).not.toContain('form-success')
  })

  test('a container id that is not one is never written into the reply page', async () => {
    await site({ googleTagManagerId: "GTM-X');alert(1);//" })
    const body = await plainPost({ name: 'No Script', email: 'ns2@example.com', message: 'Plain form post' })
    expect(body).not.toContain('alert(1)')
    expect(body).not.toContain('googletagmanager')
    await site({ googleTagManagerId: 'GTM-T7ABC12' })
  })
})

describe("rule 6 — nothing blocks Google's tags", () => {
  test("the page's policy allows every host Google lists for Tag Manager, GA4 with Ads and Ads conversions", async () => {
    const { csp } = await page()
    const directive = (name: string) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) || '').split(/\s+/)
    const scripts = directive('script-src'), connect = directive('connect-src'), frames = directive('frame-src'), images = directive('img-src')
    for (const h of ['https://www.googletagmanager.com', 'https://www.googleadservices.com', 'https://www.google.com']) expect({ h, ok: scripts.includes(h) }).toEqual({ h, ok: true })
    for (const h of ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.google.com', 'https://www.google.com', 'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net', 'https://*.g.doubleclick.net', 'https://ad.doubleclick.net', 'https://pagead2.googlesyndication.com'])
      expect({ h, ok: connect.includes(h) }).toEqual({ h, ok: true })
    expect(frames).toContain('https://www.googletagmanager.com')
    expect(images).toContain('https:')
  })
})
