// Which address the Factory calls for a tenant's site (apps/api/src/services/premiumSiteUrl.ts).
//   - ourPremiumSiteOrigin: the premium site's endpoints (calendar tokens, the three booking crons). A unified tenant has
//     none of them — its app sends its own booking messages — so it is null, and those callers skip it.
//   - ourUnifiedOrigin: the unified service, from tenants.render_backend_url (the Factory's record).
//   - ourSiteOrigin: an endpoint both kinds answer (seed-photos).
// A template tenant's answers are unchanged.
import { test, expect } from 'bun:test'
import { ourPremiumSiteOrigin, ourUnifiedOrigin, ourSiteOrigin } from '../../../apps/api/src/services/premiumSiteUrl'

const premium = { slug: 'acme', website_url: 'https://acme-site.onrender.com/', domain: 'acme.com', render_backend_url: 'https://acme-api.onrender.com' }
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
  // Without the engine column selected, the unified address still is not a premium site's.
  const { engine: _e, ...noEngine } = unified
  expect(ourPremiumSiteOrigin(noEngine)).toBeNull()
})

test('a unified tenant\'s own service: the recorded https address only', () => {
  expect(ourUnifiedOrigin(unified)).toBe('https://acme-app.onrender.com')
  expect(ourUnifiedOrigin({ ...unified, render_backend_url: 'https://acme-app-x7k2.onrender.com/' })).toBe('https://acme-app-x7k2.onrender.com')
  expect(ourUnifiedOrigin({ ...unified, render_backend_url: 'http://acme-app.onrender.com' })).toBeNull()
  expect(ourUnifiedOrigin({ ...unified, render_backend_url: null })).toBeNull()
  expect(ourSiteOrigin(unified)).toBe('https://acme-app.onrender.com')
})
