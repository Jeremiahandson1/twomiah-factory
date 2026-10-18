// The public website's routes, through the real server and database: pages, the 404s, the stylesheet's colours and
// design, service areas, the portfolio, the blog, the files for search engines, and every way an enquiry can go.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'
import { accentOnLight } from '../server/core/brandColour.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string

const HERO = { type: 'hero', variant: 'centered-stats', data: { title: 'Built right in Verona', subtitle: 'Kitchens, baths, additions.' } }
const SERVICES = { type: 'services', variant: 'cards-grid', data: { heading: 'What we do', items: [{ title: 'Kitchens', description: 'Full remodels.' }, { title: 'Baths', description: 'Tile to fixtures.' }] } }
const CONTACT = { type: 'contact', variant: 'form-info', data: { heading: 'Get in touch', phone: '608-555-0142', address: 'Verona, WI' } }

beforeAll(async () => {
  t = await bootTenant()
  const [co] = await t.db.insert(t.schema.company).values({
    name: 'Westridge Builders', slug: 'westridge', email: 'owner@westridge.example', phone: '608-555-0142',
    address: '12 Main St', city: 'Verona', state: 'WI', zip: '53593', primaryColor: '#b45309',
  }).returning()
  companyId = co.id
  await t.db.insert(t.schema.website).values({
    companyId, tagline: 'Custom homes', seoDescription: 'Custom homes and renovations in Verona.',
    nav: [{ label: 'About', href: 'about' }], serviceAreas: ['Verona', 'Madison', 'Fitchburg'], accentColor: '#0e7490',
  })
  await t.db.insert(t.schema.page).values([
    { companyId, slug: 'home', title: 'Home', sections: [HERO, SERVICES] },
    { companyId, slug: 'about', title: 'About us', sections: [HERO], metaDescription: 'Who we are.' },
    { companyId, slug: 'contact', title: 'Contact', sections: [CONTACT] },
    { companyId, slug: 'secret', title: 'Draft page', sections: [HERO], isPublished: false },
  ])
  await t.db.insert(t.schema.post).values([
    { companyId, slug: 'first', title: 'Our <script>alert(1)</script> news', excerpt: 'A & B', body: '# Hello\n\nWorld', status: 'published', publishedAt: new Date('2026-09-01T12:00:00Z') },
    { companyId, slug: 'draft', title: 'Not yet', status: 'draft' },
  ])
  await t.db.insert(t.schema.portfolioItem).values([
    { companyId, slug: 'oak-kitchen', title: 'Oak kitchen', location: 'Verona', summary: 'A full remodel.', status: 'published', photos: ['https://img.example/1.jpg'] },
    { companyId, slug: 'hidden-job', title: 'Hidden', status: 'draft' },
  ])
})

const html = async (path: string) => { const r = await t.call(path); return { status: r.status, type: r.headers.get('content-type') || '', body: await r.text() } }

describe('pages', () => {
  test('home renders the composed sections with the company and counts the visit', async () => {
    const r = await html('/')
    expect(r.status).toBe(200)
    expect(r.body).toContain('Built right in Verona')
    expect(r.body).toContain('Westridge Builders')
    expect(r.body).toContain('Kitchens')
    const views = await t.db.select().from(t.schema.pageView).where(eq(t.schema.pageView.path, '/'))
    await new Promise((r2) => setTimeout(r2, 20))
    const after = await t.db.select().from(t.schema.pageView).where(eq(t.schema.pageView.path, '/'))
    expect(after[0]?.count ?? views[0]?.count).toBeGreaterThanOrEqual(1)
  })

  test('a published page by its slug, and an unpublished one is not there', async () => {
    expect((await html('/about')).status).toBe(200)
    const secret = await html('/secret')
    expect(secret.status).toBe(404)
    expect(secret.type).toContain('text/html')
  })

  test('an unknown page is an HTML 404; an unknown API path a JSON one', async () => {
    const page = await html('/nowhere-at-all')
    expect(page.status).toBe(404)
    expect(page.body).toContain('That page isn')
    const api = await t.call('/api/nowhere')
    expect(api.status).toBe(404)
    expect((await api.json()).error).toContain('Route not found')
  })

  test('the contact page asks in the vertical\'s words and posts to the enquiry endpoint', async () => {
    const r = await html('/contact')
    expect(r.body).toContain('action="/api/leads"')
    expect(r.body).toContain('name="message"')
    expect(r.body).toContain('What you&#39;re working on')
    expect(r.body).toContain('>Office<')
  })
})

describe('the stylesheet', () => {
  test('carries the company colours, and the page links it by a version that changes with them', async () => {
    const css = await html('/styles/main.css')
    expect(css.type).toContain('text/css')
    expect(css.body).toContain('--brand: #b45309')
    expect(css.body).toContain('--accent: #0e7490')
    expect(css.body).toContain('--accent-ink: ' + accentOnLight('#0e7490'))
    expect(css.body).not.toContain('{{')
    const before = (await html('/')).body.match(/main\.css\?v=([^"]+)/)![1]
    await t.db.update(t.schema.company).set({ primaryColor: '#1d4ed8' }).where(eq(t.schema.company.id, companyId))
    expect((await html('/styles/main.css')).body).toContain('--brand: #1d4ed8')
    const after = (await html('/')).body.match(/main\.css\?v=([^"]+)/)![1]
    expect(after).not.toBe(before)
  })

  test('the site\'s design adds its own look, and only its own', async () => {
    expect((await html('/styles/main.css')).body).not.toContain('Home care accessibility baseline')
    await t.db.update(t.schema.website).set({ design: 'homecare' }).where(eq(t.schema.website.companyId, companyId))
    expect((await html('/styles/main.css')).body).toContain('Home care accessibility baseline')
    await t.db.update(t.schema.website).set({ design: null }).where(eq(t.schema.website.companyId, companyId))
  })
})

describe('service areas', () => {
  test('the list and one area, built from the site\'s own services', async () => {
    const list = await html('/service-areas')
    expect(list.body).toContain('Westridge Builders serves Verona, Madison and Fitchburg.')
    const one = await html('/service-areas/madison')
    expect(one.status).toBe(200)
    expect(one.body).toContain('Kitchens and Baths in Madison.')
    expect((await html('/service-areas/nowhere')).status).toBe(404)
  })
})

describe('portfolio and blog', () => {
  test('/projects lists the published work and /projects/:slug tells one; drafts stay hidden', async () => {
    const list = await html('/projects')
    expect(list.body).toContain('Oak kitchen')
    expect(list.body).not.toContain('Hidden')
    expect((await html('/projects/oak-kitchen')).body).toContain('A full remodel.')
    expect((await html('/projects/hidden-job')).status).toBe(404)
  })

  test('the blog escapes what the owner typed, renders markdown, and hides drafts', async () => {
    const list = await html('/blog')
    expect(list.body).toContain('Our &lt;script&gt;alert(1)&lt;/script&gt; news')
    expect(list.body).not.toContain('<script>alert(1)</script>')
    expect(list.body).toContain('A &amp; B')
    expect(list.body).not.toContain('Not yet')
    const one = await html('/blog/first')
    expect(one.body).toContain('<h1>Hello</h1>')
    expect((await html('/blog/draft')).status).toBe(404)
  })
})

describe('for search engines and AI assistants', () => {
  test('the sitemap lists published pages, work, areas and posts — nothing unpublished', async () => {
    const xml = (await html('/sitemap.xml')).body
    for (const p of ['/about', '/contact', '/projects/oak-kitchen', '/service-areas/fitchburg', '/blog/first']) expect(xml).toContain(p + '</loc>')
    expect(xml).not.toContain('/secret')
    expect(xml).not.toContain('hidden-job')
    expect(xml).not.toContain('/blog/draft')
  })

  test("Google's business markup gets the city and the state, never the street or a ZIP in the state", async () => {
    const page = (await html('/')).body
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1])
    expect(ld.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Verona', addressRegion: 'WI' })
    expect(JSON.stringify(ld)).not.toContain('12 Main St')
  })

  test('robots.txt points at the sitemap; llms.txt gives the area, never the street', async () => {
    expect((await html('/robots.txt')).body).toContain('Sitemap: ')
    const llms = (await html('/llms.txt')).body
    expect(llms).toContain('# Westridge Builders')
    expect(llms).toContain('Area: Verona, WI')
    expect(llms).not.toContain('12 Main St')
  })

  test('/visualize is not there without a Visualizer', async () => {
    expect((await html('/visualize')).status).toBe(404)
  })
})

describe('enquiries', () => {
  const send = (body: Record<string, unknown>, headers: Record<string, string> = {}, ip = '203.0.113.' + Math.floor(Math.random() * 250)) =>
    t.call('/api/leads', { method: 'POST', json: body, headers: { 'X-Forwarded-For': ip, ...headers } })

  test('a complete enquiry is saved as a lead contact when the Lead Inbox is off', async () => {
    const r = await send({ name: 'Pat Jones', email: 'pat@example.com', phone: '608-555-0100', message: 'Kitchen remodel next spring', headcount: '4' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ success: true, message: "Got it — thanks. We'll be in touch soon." })
    const [row] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'pat@example.com'))
    expect(row.type).toBe('lead')
    expect(row.notes).toContain('Kitchen remodel next spring')
    expect(row.notes).toContain('Headcount: 4')
  })

  test('with the Lead Inbox on, it lands in the inbox as new', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['lead_inbox'] }).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    const r = await send({ name: 'Sam Lee', email: 'sam@example.com', message: 'New deck please' })
    expect(r.status).toBe(200)
    const [row] = await t.db.select().from(t.schema.lead).where(eq(t.schema.lead.email, 'sam@example.com'))
    expect(row.status).toBe('new')
    expect(row.sourcePlatform).toBe('website')
    expect(await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'sam@example.com'))).toEqual([])
    await t.db.update(t.schema.company).set({ enabledFeatures: [] }).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
  })

  test('the old contact form field name (project) is still read', async () => {
    expect((await send({ name: 'Old Form', email: 'old@example.com', project: 'Basement finish' })).status).toBe(200)
    const [row] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'old@example.com'))
    expect(row.notes).toContain('Basement finish')
  })

  test('an empty message is refused in the vertical\'s words; a bad email and a missing name too', async () => {
    const empty = await send({ name: 'Pat', email: 'p@example.com', message: '' })
    expect(empty.status).toBe(400)
    expect(await empty.json()).toEqual({ error: 'Tell us a bit about your project.' })
    expect((await send({ name: 'Pat', email: 'nope', message: 'Hello there' })).status).toBe(400)
    expect((await send({ email: 'p@example.com', message: 'Hello there' })).status).toBe(400)
  })

  test('a bot (honeypot filled, or too quick) is thanked and nothing is saved', async () => {
    expect((await send({ name: 'Bot', email: 'bot1@example.com', message: 'Buy now buy now', website: 'spam.example' })).status).toBe(200)
    expect((await send({ name: 'Bot', email: 'bot2@example.com', message: 'Buy now buy now', t: String(Date.now()) })).status).toBe(200)
    const rows = await t.db.select().from(t.schema.contact)
    expect(rows.some((r: any) => /^bot\d@/.test(r.email))).toBe(false)
  })

  test('the sixth enquiry from one address in ten minutes is refused with a wait', async () => {
    const ip = '198.51.100.7'
    for (let i = 0; i < 5; i++) expect((await send({ name: 'Rate ' + i, email: `rate${i}@example.com`, message: 'Testing the limit' }, {}, ip)).status).toBe(200)
    const sixth = await send({ name: 'Rate 6', email: 'rate6@example.com', message: 'Testing the limit' }, {}, ip)
    expect(sixth.status).toBe(429)
    expect(Number(sixth.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  test('a browser posting without script gets a page back, from /contact as from /api/leads', async () => {
    const r = await t.call('/contact', {
      method: 'POST', body: new URLSearchParams({ name: 'No Script', email: 'ns@example.com', message: 'Plain form post' }),
      headers: { Accept: 'text/html', 'X-Forwarded-For': '192.0.2.9', 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/html')
    expect(await r.text()).toContain('Thank you.')
  })
})
