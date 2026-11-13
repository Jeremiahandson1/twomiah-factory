// The website's strict script policy (security review S4, 2026-11-13; server/http/guards.ts sitePolicy). Rolled out in the
// browsers' two steps: reported first, enforced when SITE_CSP_ENFORCE=1.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const scriptSrc = (policy: string) => policy.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) || ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'restaurant' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ name: 'Mabel\'s Truck', enabledFeatures: ['contacts', 'bar_menu'] }).where(eq(t.schema.company.id, s.company.id))
  // A published home page, so the site renders (tests/menu-photos-restaurant-site.test.ts).
  await t.db.insert(t.schema.website).values({ companyId: s.company.id, tagline: 'Street food', nav: [{ label: 'Contact', href: 'contact' }] })
  await t.db.insert(t.schema.page).values({ companyId: s.company.id, slug: 'home', title: 'Home', sections: [{ type: 'about', variant: 'story', data: { title: 'About us', paragraphs: ['Tacos since 2019.'] } }], isPublished: true, navOrder: 0 })
}, 120_000)

describe('a website page', () => {
  test('keeps today\'s policy, reports against the strict one, and every script it was built with carries the nonce', async () => {
    delete process.env.SITE_CSP_ENFORCE
    const res = await t.call('/')
    expect(res.status).toBe(200)
    const html = await res.text()
    const enforced = res.headers.get('Content-Security-Policy') || ''
    const reported = res.headers.get('Content-Security-Policy-Report-Only') || ''
    expect(scriptSrc(enforced)).toContain("'unsafe-inline'")
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(scriptSrc(reported))?.[1]
    expect(nonce).toBeTruthy()
    expect(scriptSrc(reported)).not.toContain("'unsafe-inline'")
    expect(reported).toContain("object-src 'none'")
    expect(reported).toContain('report-uri /api/csp-report')
    // Inline scripts carry it; a script from a file is allowed by its address, and JSON-LD is data.
    const inline = (html.match(/<script\b[^>]*>/gi) || []).filter((tag) => !/\ssrc=/.test(tag) && !/ld\+json/.test(tag))
    expect(inline.length).toBeGreaterThan(0)
    for (const tag of inline) expect(tag).toContain(`nonce="${nonce}"`)
    // No handler is written into an attribute by the layout: the strict policy would not run it.
    expect(html).not.toMatch(/\son(load|click|error)="/i)
    // A new nonce for each answer.
    const again = await t.call('/')
    expect(/'nonce-([A-Za-z0-9+/=]+)'/.exec(again.headers.get('Content-Security-Policy-Report-Only') || '')?.[1]).not.toBe(nonce)
  })

  test('with the switch on, the strict policy is the policy', async () => {
    process.env.SITE_CSP_ENFORCE = '1'
    try {
      const res = await t.call('/')
      const enforced = res.headers.get('Content-Security-Policy') || ''
      expect(scriptSrc(enforced)).toMatch(/'nonce-[A-Za-z0-9+/=]+'/)
      expect(scriptSrc(enforced)).not.toContain("'unsafe-inline'")
      expect(res.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
    } finally { delete process.env.SITE_CSP_ENFORCE }
  })

  test('a browser\'s report is taken and answered with nothing; the app\'s own pages keep their own policy', async () => {
    const r = await t.call('/api/csp-report', { method: 'POST', body: JSON.stringify({ 'csp-report': { 'document-uri': 'https://x.example/', 'violated-directive': 'script-src', 'blocked-uri': 'inline' } }), headers: { 'Content-Type': 'application/csp-report' } })
    expect(r.status).toBe(204)
    expect((await t.call('/api/csp-report', { method: 'POST', body: 'not json' })).status).toBe(204)
    const api = await t.call('/health')
    expect(api.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
  })
})
