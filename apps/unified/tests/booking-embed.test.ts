// Booking on another website (site/public/scripts/book-embed.ts): the script is served to any site; the booking pages
// with ?embed=1 may be framed by other https sites and are the page alone — no header, footer or tracking, kept out of
// search, telling the frame their height, keeping ?embed=1 between them and sending anything that leaves to the whole
// window. Without ?embed=1, and on every other page, framing stays the site's own (X-Frame-Options SAMEORIGIN).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let owner = '', token = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })

beforeAll(async () => {
  t = await bootTenant()
  const s = await seedOwner(t)
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  await t.db.insert(t.schema.website).values({ companyId: s.company.id, googleTagManagerId: 'GTM-TEST1' } as any)
  await as('/api/company/features', { method: 'PUT', json: { features: ['online_booking'] } })
  await as('/api/booking/services', { method: 'POST', json: { name: 'Estimate', durationMinutes: 60, slotStepMinutes: 60 } })
  const [b] = await t.db.insert(t.schema.booking).values({
    companyId: s.company.id, startAt: new Date(Date.now() + 5 * 86_400_000), endAt: new Date(Date.now() + 5 * 86_400_000 + 3600_000),
    customerName: 'Pat', customerEmail: 'pat@example.com', token: 'tok-embed-1', status: 'confirmed',
    serviceId: (await t.db.select().from(t.schema.bookingService).where(eq(t.schema.bookingService.companyId, s.company.id)))[0].id,
  }).returning()
  token = b.token
})

describe('the script', () => {
  test('served to any site, and it frames /book?embed=1 from the site it came from', async () => {
    const r = await t.call('/scripts/book-embed.js')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('javascript')
    expect(r.headers.get('access-control-allow-origin')).toBe('*')
    const js = await r.text()
    expect(js).toContain('?embed=1')
    expect(js).toContain('twomiah-book-height')
    expect(js).toContain('ev.origin !== origin')
  })
})

describe('framed', () => {
  test('/book?embed=1: other https sites may frame it; the page alone, no tracking, out of search, telling its height', async () => {
    const r = await t.call('/book?embed=1')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'self' https:")
    expect(r.headers.get('x-frame-options')).toBeNull()
    const html = await r.text()
    expect(html).not.toContain('class="site-header"')
    expect(html).not.toContain('class="site-footer"')
    expect(html).not.toContain('GTM-TEST1')
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).toContain("type: 'twomiah-book-height'")
    expect(html).toContain('href="/book/estimate?embed=1"')
  })

  test('a service page keeps the frame; the picker knows it is framed', async () => {
    const html = await (await t.call('/book/estimate?embed=1')).text()
    expect(html).toContain('data-embed="1"')
    expect(html).toContain('href="/book?embed=1"')
  })

  test("the customer's booking page, framed: changing or cancelling opens the whole window", async () => {
    const html = await (await t.call(`/booking/${token}?embed=1`)).text()
    expect(html).toMatch(/href="\/booking\/tok-embed-1\/reschedule" target="_top"/)
    expect(html).toMatch(/action="\/booking\/tok-embed-1\/cancel"[^>]*target="_top"/)
  })
})

describe('not framed', () => {
  test('/book itself, the site and the admin stay framed only by themselves', async () => {
    for (const p of ['/book', '/book/estimate', `/booking/${token}`, '/login']) {
      const r = await t.call(p)
      expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN')
      expect(r.headers.get('content-security-policy') || '').toContain("frame-ancestors 'self'")
      expect(r.headers.get('content-security-policy') || '').not.toContain("frame-ancestors 'self' https:")
    }
    const html = await (await t.call('/book')).text()
    expect(html).toContain('class="site-header"')
    expect(html).toContain('GTM-TEST1')
    expect(html).not.toContain('twomiah-book-height')
  })
})
