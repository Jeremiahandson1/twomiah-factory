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
