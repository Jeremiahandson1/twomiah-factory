// The Factory's first call to a new tenant (server/modules/provision.ts), through the real server on an empty database:
// the business, its owner, features, starter content and website arrive in one go; the owner can sign in with the
// password the Factory hashed; a repeat changes nothing; another business is refused.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootTenant } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const KEY = 'factory-key-for-provision-test'
const PASSWORD = 'Owner-pass-1-long'
let hash: string

const provision = (json: unknown, key: string | null = KEY) =>
  t.call('/api/internal/provision', { method: 'POST', json, headers: key ? { 'X-Factory-Key': key } : {} })

const input = () => ({
  company: { name: "Mary's Roofing & Sons", slug: 'marys-roofing', email: 'office@marys.example', phone: '555-0100', city: 'Eau Claire', state: 'WI', primaryColor: '#1a2b3c', timezone: 'America/Chicago' },
  owner: { email: 'Mary@Marys.Example', passwordHash: hash, firstName: 'Mary', lastName: 'Lund' },
  features: ['contacts', 'jobs', 'quotes', 'invoices', 'lead_inbox'],
  industry: 'Roofing',
  site: {
    tagline: 'Roofs done right',
    nav: [{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }],
    pages: [
      { slug: 'home', title: 'Home', sections: [{ type: 'hero', variant: 'split', data: { title: 'Roofs done right in Eau Claire' } }] },
      { slug: 'about', title: 'About', sections: [], navOrder: 1 },
    ],
  },
})

beforeAll(async () => {
  t = await bootTenant()
  hash = await Bun.password.hash(PASSWORD, 'bcrypt')
})

describe('provision', () => {
  test('only the Factory: no key set is 503, a wrong key 401', async () => {
    delete process.env.FACTORY_SYNC_KEY
    expect((await provision(input(), null)).status).toBe(503)
    process.env.FACTORY_SYNC_KEY = KEY
    expect((await provision(input(), 'x'.repeat(KEY.length))).status).toBe(401)
  })

  test('a bad request names each wrong box and writes nothing', async () => {
    const bad = input() as any
    bad.owner.passwordHash = 'plain-text-password'
    bad.company.slug = 'Not A Slug'
    bad.site.pages[1].slug = 'home'
    const res = await provision(bad)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('validation_failed')
    expect(Object.keys(body.fields)).toEqual(expect.arrayContaining(['owner.passwordHash', 'company.slug', 'site.pages']))
    expect(await t.db.select().from(t.schema.company)).toEqual([])
  })

  test('the business, its owner, features, starter content and website, in one call', async () => {
    const res = await provision(input())
    expect(res.status).toBe(201)
    const { companyId, ownerId } = await res.json()

    const [co] = await t.db.select().from(t.schema.company)
    expect(co).toMatchObject({ id: companyId, name: "Mary's Roofing & Sons", slug: 'marys-roofing', primaryColor: '#1a2b3c', timezone: 'America/Chicago', enabledFeatures: input().features })
    const [owner] = await t.db.select().from(t.schema.user)
    expect(owner).toMatchObject({ id: ownerId, email: 'mary@marys.example', role: 'owner', companyId })

    const articles = await t.db.select().from(t.schema.supportKnowledgeBase)
    expect(articles.length).toBe(8)
    const cats = (await t.db.select().from(t.schema.pricebookCategory)).sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((c: any) => c.name)
    expect(cats[0]).toBe('Roof Replacement')

    const [site] = await t.db.select().from(t.schema.website)
    expect(site.tagline).toBe('Roofs done right')
    expect((await t.db.select().from(t.schema.page)).map((p: any) => p.slug).sort()).toEqual(['about', 'home'])
  })

  test('the owner signs in with the password the Factory hashed', async () => {
    const res = await t.call('/api/auth/login', { method: 'POST', json: { email: 'mary@marys.example', password: PASSWORD } })
    expect(res.status).toBe(200)
    expect((await res.json()).accessToken).toBeTruthy()
  })

  test('the website shows what was provisioned', async () => {
    const res = await t.call('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Roofs done right in Eau Claire')
  })

  test('the same business again changes nothing and says so', async () => {
    const again = input() as any
    again.company.name = 'Renamed'
    const res = await provision(again)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect((await t.db.select().from(t.schema.company)).map((c: any) => c.name)).toEqual(["Mary's Roofing & Sons"])
    expect((await t.db.select().from(t.schema.user)).length).toBe(1)
    expect((await t.db.select().from(t.schema.supportKnowledgeBase)).length).toBe(8)
  })

  test('another business is refused: this database is taken', async () => {
    const other = input() as any
    other.company.slug = 'someone-else'
    const res = await provision(other)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('provisioned_for_another')
  })

  test('health says which commit and version answer', async () => {
    const body = await (await t.call('/health')).json()
    expect(body).toHaveProperty('commit')
    expect(body).toHaveProperty('version')
  })
})

// Each vertical's own day-one help (VerticalSettings.starter): every agency was given the contractor CRM's articles
// ("Creating and Sending Quotes") until home care's guides were written (verticals/homecare/settings.ts, 2026-10-19).
describe('a home-care agency gets its own guides', () => {
  test('provisioned with home care\'s articles, none of the contractor CRM\'s', async () => {
    const hc = await bootTenant({ vertical: 'homecare' })
    process.env.FACTORY_SYNC_KEY = KEY
    const body = { ...input(), company: { ...input().company, name: 'Sunrise Care', slug: 'sunrise-care' }, features: ['dashboard'], industry: 'Home Care' }
    const res = await hc.call('/api/internal/provision', { method: 'POST', json: body, headers: { 'X-Factory-Key': KEY } })
    expect(res.status).toBe(201)
    const titles = (await hc.db.select().from(hc.schema.supportKnowledgeBase)).map((a: any) => a.title)
    expect(titles).toContain('Running payroll')
    expect(titles).toContain('Finding coverage fast')
    expect(titles.some((x: string) => /quote|job/i.test(x))).toBe(false)
    expect((await hc.db.select().from(hc.schema.pricebookCategory)).length).toBe(0)
  })
})

// Roofing's day one (verticals/roof/settings.ts; templates/crm-roof seed.template.ts): the default canvassing script —
// no screen creates the first one — ten free roof reports and the estimator's roofing headline; the roofing price-book
// categories. None of the seed's invented roofing company (T44).
describe('a roofer starts with a canvassing script and free reports', () => {
  test('provisioned with the script, ten report credits, the roofing headline and categories — and no records', async () => {
    const rf = await bootTenant({ vertical: 'roofing' })
    process.env.FACTORY_SYNC_KEY = KEY
    const res = await rf.call('/api/internal/provision', { method: 'POST', json: { ...input(), features: ['dashboard', 'canvassing_tool'] }, headers: { 'X-Factory-Key': KEY } })
    expect(res.status).toBe(201)
    const [co] = await rf.db.select().from(rf.schema.company)
    expect({ credits: co.reportCredits, headline: co.estimatorHeadline, low: co.pricePerSquareLow }).toEqual({ credits: 10, headline: 'Get Your Free Roof Estimate', low: '350.00' })
    const scripts = await rf.db.select().from(rf.schema.canvassingScript)
    expect(scripts.map((s: any) => ({ name: s.name, isDefault: s.isDefault, steps: s.steps.length, companyId: s.companyId })))
      .toEqual([{ name: 'Hail Damage — Standard Script', isDefault: true, steps: 4, companyId: co.id }])
    // A pitch for no real storm date: the canvasser makes it specific.
    expect(JSON.stringify(scripts[0].steps)).not.toMatch(/March 10/)
    expect((await rf.db.select().from(rf.schema.pricebookCategory)).map((c: any) => c.name)).toContain('Storm Damage Assessment')
    for (const table of ['contact', 'job', 'crew', 'insuranceClaim', 'stormEvent'] as const) {
      expect({ table, rows: (await rf.db.select().from((rf.schema as any)[table])).length }).toEqual({ table, rows: 0 })
    }
  }, 60_000)
})
