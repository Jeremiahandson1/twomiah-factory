// Which address the Factory calls for a tenant's site (apps/api/src/services/premiumSiteUrl.ts).
//   - ourPremiumSiteOrigin: the premium site's endpoints (the three booking crons). A unified tenant has none of them —
//     its app sends its own booking messages — so it is null, and those callers skip it.
//   - ourUnifiedOrigin: the unified service, from tenants.render_backend_url (the Factory's record).
//   - ourSiteOrigin: an endpoint both kinds answer (seed-photos, calendar tokens).
//   - mayReturnTo: where the calendar sign-in may send the browser back — an exact origin of the tenant's admin.
// A template tenant's answers are unchanged.
import { test, expect } from 'bun:test'
import { ourPremiumSiteOrigin, ourUnifiedOrigin, ourSiteOrigin, mayReturnTo } from '../../../apps/api/src/services/premiumSiteUrl'

const premium = { slug: 'acme', engine: null, website_url: 'https://acme-site.onrender.com/', domain: 'acme.com', render_backend_url: 'https://acme-api.onrender.com' }
const unified = { slug: 'acme', engine: 'unified', website_url: 'https://acme-app.onrender.com', domain: 'acme.com', render_backend_url: 'https://acme-app.onrender.com' }

test('template tenants: as before', () => {
  expect(ourPremiumSiteOrigin(premium)).toBe('https://acme-site.onrender.com')
  expect(ourPremiumSiteOrigin({ ...premium, engine: 'templates' })).toBe('https://acme-site.onrender.com')
  expect(ourPremiumSiteOrigin({ ...premium, website_url: 'https://www.acme.com/x' })).toBe('https://www.acme.com')
  expect(ourPremiumSiteOrigin({ ...premium, website_url: 'https://acme.twomiah.app' })).toBe('https://acme.twomiah.app')
  expect(ourPremiumSiteOrigin({ ...premium, website_url: 'https://old-site.example.com' })).toBeNull()
  expect(ourPremiumSiteOrigin({ ...premium, website_url: 'http://acme-site.onrender.com' })).toBeNull()
  expect(ourUnifiedOrigin(premium)).toBeNull()
  expect(ourSiteOrigin(premium)).toBe('https://acme-site.onrender.com')
})

test('a unified tenant has no premium site — even when website_url is its own domain', () => {
  expect(ourPremiumSiteOrigin(unified)).toBeNull()
  expect(ourPremiumSiteOrigin({ ...unified, website_url: 'https://acme.com' })).toBeNull()
  // Without its engine column, Higgs's row (website_url = its own domain) reads as a premium site's — which is why every
  // caller must select engine (the booking crons did not, 10/30; the next test holds them to it).
  const { engine: _e, ...noEngine } = { ...unified, website_url: 'https://acme.com' }
  expect(ourPremiumSiteOrigin(noEngine)).toBe('https://acme.com')
})

test('the three booking crons read engine with the row they pass on', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(import.meta.dir, '../../../apps/api/src/routes/factory/lifecycle.ts'), 'utf8').replace(/\r\n/g, '\n')
  for (const route of ['booking-review-requests', 'booking-rebook-reminders', 'booking-reminders']) {
    const at = src.indexOf(`factory.post('/internal/${route}'`)
    const head = src.slice(at, src.indexOf('ourPremiumSiteOrigin(t)', at))
    expect(head, route).toMatch(/\.select\('[^']*\bengine\b[^']*'\)/)
  }
})

test('a unified tenant\'s own service: the recorded https address only', () => {
  expect(ourUnifiedOrigin(unified)).toBe('https://acme-app.onrender.com')
  expect(ourUnifiedOrigin({ ...unified, render_backend_url: 'https://acme-app-x7k2.onrender.com/' })).toBe('https://acme-app-x7k2.onrender.com')
  expect(ourUnifiedOrigin({ ...unified, render_backend_url: 'http://acme-app.onrender.com' })).toBeNull()
  expect(ourUnifiedOrigin({ ...unified, render_backend_url: null })).toBeNull()
  expect(ourSiteOrigin(unified)).toBe('https://acme-app.onrender.com')
})

test("the calendar sign-in comes back only to the tenant's own admin, by exact origin", () => {
  // template: its site, as before — but a look-alike host that merely starts with it is refused now
  expect(mayReturnTo(premium, 'https://acme-site.onrender.com/admin/booking-settings')).toBe(true)
  expect(mayReturnTo(premium, 'https://acme-site.onrender.com.evil.example/admin')).toBe(false)
  expect(mayReturnTo(premium, 'https://acme.com/admin/booking-settings')).toBe(false)
  // unified: its service, and its domain's apex, www and app. names
  for (const ok of ['https://acme-app.onrender.com/crm/bookings/settings', 'https://acme.com/crm/bookings/settings', 'https://www.acme.com/crm/bookings/settings', 'https://app.acme.com/crm/bookings/settings']) expect(mayReturnTo(unified, ok)).toBe(true)
  for (const no of ['https://evil.example/crm', 'https://app.acme.com.evil.example/crm', 'http://app.acme.com/crm', 'https://other-app.onrender.com/crm', 'not a url']) expect(mayReturnTo(unified, no)).toBe(false)
  expect(mayReturnTo({ ...unified, domain: null }, 'https://app.acme.com/crm')).toBe(false)
  // local development, as before
  expect(mayReturnTo(premium, 'http://localhost:5173/admin')).toBe(true)
  // a template tenant's CRM is its own app (its Business Profile sign-in starts there) — by exact origin too
  expect(mayReturnTo(premium, 'https://acme-api.onrender.com/settings/integrations')).toBe(true)
  expect(mayReturnTo(premium, 'https://acme-api.onrender.com.evil.example/settings')).toBe(false)
})

test('every Google sign-in checks the return address with the one rule — the Business Profile one included', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(import.meta.dir, '../../../apps/api/src/routes/factory/lifecycle.ts'), 'utf8')
  const gbp = src.slice(src.indexOf("factory.get('/gbp/google/auth'"), src.indexOf("factory.get('/gbp/google/callback'"))
  expect(gbp).toContain('mayReturnTo(tenant, returnUrl)')
  expect(gbp).toContain('domain, engine, render_backend_url')
  expect(gbp).not.toContain('startsWith(')
  // the account's address comes back with each link, so the CRM can tell one Google account's links from another's
  expect(gbp).toContain("scope: 'openid email https://www.googleapis.com/auth/business.manage'")
  const cal = src.slice(src.indexOf("factory.get('/calendar/google/auth'"), src.indexOf("factory.get('/calendar/google/callback'"))
  expect(cal).toContain("scope: 'openid email https://www.googleapis.com/auth/calendar.events.owned'")
  // a unified tenant on its own domain: the address the CRM sent on 10/22 (app.twomiahtest.site)
  expect(mayReturnTo({ engine: 'unified', domain: 'twomiahtest.site', render_backend_url: 'https://twomiah-test-live-app.onrender.com' }, 'https://app.twomiahtest.site/crm/settings/integrations')).toBe(true)
})

test("the calendar callbacks post a person's tokens to either kind of site, and check the return address with mayReturnTo", () => {
  const src = require('node:fs').readFileSync(require('node:path').join(import.meta.dir, '../../../apps/api/src/routes/factory/lifecycle.ts'), 'utf8')
  for (const p of ['google', 'outlook']) {
    const auth = src.slice(src.indexOf(`factory.get('/calendar/${p}/auth'`), src.indexOf(`factory.get('/calendar/${p}/callback'`))
    expect(auth).toContain('mayReturnTo(tenant, returnUrl)')
    expect(auth).not.toContain('startsWith(tenant.website_url')
    const cb = src.slice(src.indexOf(`factory.get('/calendar/${p}/callback'`))
    const head = cb.slice(0, cb.indexOf('/api/internal/calendar/store-tokens'))
    expect(head).toContain('ourSiteOrigin(tenant)')
    expect(head).toContain('engine, render_backend_url')
  }
})
