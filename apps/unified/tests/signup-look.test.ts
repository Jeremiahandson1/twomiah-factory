// The look a visitor chose in the free preview reaches the site they sign up for, and the preview is drawn by the
// renderer the site uses (server/site/signupPreview.ts). Through the real server on an empty database.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootTenant } from './harness.ts'
import { loadVertical, SITE_DESIGNS, SITE_LOOKS, siteLookOf } from '../server/core/vertical.ts'
import { loadSiteContext } from '../server/site/context.ts'
import { renderSitePreview, PREVIEW_SETTINGS_KEYS } from '../server/site/signupPreview.ts'

const KEY = 'factory-key-for-look-test'
let t: Awaited<ReturnType<typeof bootTenant>>
let hash: string

const body = (site: Record<string, unknown>) => ({
  company: { name: 'Westridge Roofing', slug: 'westridge', email: 'o@westridge.example', primaryColor: '#9a3412', timezone: 'America/Chicago' },
  owner: { email: 'owner@westridge.example', passwordHash: hash, firstName: 'Jo', lastName: 'Lund' },
  features: ['contacts', 'jobs'], industry: 'Roofing',
  site: { pages: [{ slug: 'home', title: 'Home', sections: [{ type: 'hero', variant: 'split', data: { title: 'Roofs done right' } }] }], ...site },
})

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  hash = await Bun.password.hash('Owner-pass-1-long', 'bcrypt')
  process.env.FACTORY_SYNC_KEY = KEY
})

describe('the chosen look reaches the new site', () => {
  test('provisioning with a look writes it to the site row, and the live page wears it', async () => {
    const res = await t.call('/api/internal/provision', { method: 'POST', json: body({ design: 'heritage' }), headers: { 'X-Factory-Key': KEY } })
    expect(res.status).toBe(201)
    const [site] = await t.db.select().from(t.schema.website)
    expect(site.design).toBe('heritage')
    const home = await t.call('/')
    expect(await home.text()).toContain('Instrument+Serif')
  })

  test('only the looks a visitor may choose are choosable, and each is a known design', () => {
    expect([...SITE_LOOKS]).toEqual(['foundry', 'heritage', 'studio'])
    for (const d of SITE_LOOKS) expect(SITE_DESIGNS).toContain(d)
    expect(siteLookOf('bar')).toBeNull()
    expect(siteLookOf('classic')).toBeNull()
    expect(siteLookOf('nonsense')).toBeNull()
    expect(siteLookOf(undefined)).toBeNull()
  })
})

describe('the signup preview is the site renderer', () => {
  const sections = [{ type: 'hero', variant: 'split', data: { title: 'Roofs done right', ctaLabel: 'Get a quote' } }, { type: 'cta', variant: 'banner', data: { heading: 'Talk to us', primaryCta: { label: 'Call', href: 'contact' } } }]
  const draw = (design: string | null) => renderSitePreview({ vertical: 'roofing', design, company: { name: 'Westridge Roofing', primaryColor: '#FF3D00' }, settings: { nav: [{ label: 'Contact', href: 'contact' }] }, sections, features: [] })

  test('each look draws with its own type and stylesheet inline, links going nowhere', async () => {
    const fonts: Record<string, string> = { foundry: 'Barlow+Condensed', heritage: 'Instrument+Serif', studio: 'Plus+Jakarta' }
    for (const d of SITE_LOOKS) {
      const html = await draw(d)
      expect(html).toContain(fonts[d])
      expect(html).not.toContain('href="/styles/main.css')
      expect(html).toContain('<style>')
      expect(html).toContain('Westridge Roofing')
      expect(html).not.toMatch(/<a\s[^>]*href="(?!#)/)
    }
  })

  test('no look: the vertical’s own default', async () => {
    const html = await draw(null)
    for (const f of ['Barlow+Condensed', 'Instrument+Serif', 'Plus+Jakarta']) expect(html).not.toContain(f)
  })

  test('its settings carry every key a real request’s do, so no view reads a missing one', async () => {
    const real = await loadSiteContext(t.db, await loadVertical('roofing'))
    expect([...PREVIEW_SETTINGS_KEYS].sort()).toEqual(Object.keys(real!.settings).sort())
  })
})
