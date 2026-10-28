// A page for each of the business's own services (/services/<slug>, site/servicePages.ts): only its real services, only the
// facts the owner gave, a quote form that posts to the enquiry endpoint, links from the services sections, the sitemap and
// llms.txt — and nothing for the composer's stand-in card, a list of steps, or a card the owner linked elsewhere.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'
import { servicePagesOf, slugOf, linkServiceCards, isStepsList } from '../server/site/servicePages.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const html = async (p: string) => { const r = await t.call(p); return { status: r.status, body: await r.text() } }

const KITCHEN = { title: 'Kitchen remodels', description: 'Layouts and cabinets.\n\nWe take it down to the studs only when it needs it.', image: 'https://img.example/k.jpg', bullets: ['Design visit', 'Demolition'], subServices: [{ title: 'Cabinet refacing', description: 'New doors.' }, 'Countertops'] }
const HOME = [
  { type: 'hero', variant: 'centered-stats', data: { title: 'Built right' } },
  { type: 'services', variant: 'cards-grid', data: { heading: 'What we do', items: [KITCHEN, { title: 'Baths & showers', description: '' }, { title: 'Decks', href: 'decks-page' }, { title: 'Additions', href: 'contact' }, { title: 'Sheds', href: 'https://example.com/sheds' }] } },
  { type: 'services', variant: 'cards-grid', data: { heading: 'How it works', items: [{ title: 'Tell us what you need', description: 'A call.' }] } },
]

beforeAll(async () => {
  t = await bootTenant()
  const [co] = await t.db.insert(t.schema.company).values({ name: 'Westridge Builders', slug: 'westridge', email: 'owner@westridge.example', phone: '608-555-0142', address: '12 Main St', city: 'Verona', state: 'WI', zip: '53593', primaryColor: '#b45309' }).returning()
  await t.db.insert(t.schema.website).values({ companyId: co.id, design: 'foundry' })
  await t.db.insert(t.schema.page).values([
    { companyId: co.id, slug: 'home', title: 'Home', sections: HOME },
    { companyId: co.id, slug: 'decks-page', title: 'Decks', sections: [{ type: 'hero', variant: 'centered-stats', data: { title: 'Decks' } }] },
  ])
})

describe('which services get a page', () => {
  const pages = (sections: any[], services: any[] = [], trade = '') => servicePagesOf([{ slug: 'home', sections, isPublished: true }, { slug: 'decks-page', sections: [], isPublished: true }], services, trade)

  test('each real service, by its slug; a step list, a card with a page of its own, and the trade stand-in get none', () => {
    const list = pages(HOME)
    expect(list.map((p) => p.slug)).toEqual(['kitchen-remodels', 'baths-and-showers', 'additions', 'sheds'])
    expect(slugOf('Kitchen & Bath Remodels!')).toBe('kitchen-and-bath-remodels')
    expect(isStepsList({ heading: 'How it works', items: [] })).toBe(true)
    expect(isStepsList({ kind: 'steps' })).toBe(true)
    expect(isStepsList({ heading: 'What we do' })).toBe(false)
    // the composer's one-card stand-in for the trade is not a service
    expect(pages([{ type: 'services', variant: 'cards-grid', data: { items: [{ title: 'Roofing' }] } }], [], 'roofing')).toEqual([])
    // …and is replaced by the business's own list (the price book's), which does get pages
    expect(pages([{ type: 'services', variant: 'cards-grid', data: { items: [{ title: 'Roofing' }] } }], [{ title: 'Roof repair', description: 'Leaks.' }], 'roofing').map((p) => p.slug)).toEqual(['roof-repair'])
  })

  test('only what the owner gave is on a page; two cards with one name get two slugs', () => {
    const [kitchen, baths] = pages(HOME)
    expect(kitchen).toMatchObject({ title: 'Kitchen remodels', image: 'https://img.example/k.jpg', bullets: ['Design visit', 'Demolition'] })
    expect(kitchen.subServices.map((s) => [s.title, s.slug])).toEqual([['Cabinet refacing', 'cabinet-refacing'], ['Countertops', 'countertops']])
    expect(baths).toMatchObject({ description: '', image: '', bullets: [], subServices: [] })
    const twin = pages([{ type: 'services', variant: 'cards-grid', data: { items: [{ title: 'Deck' }, { title: 'Deck!' }] } }])
    expect(twin.map((p) => p.slug)).toEqual(['deck', 'deck-2'])
  })

  test('the cards link to their page; a card\'s own link to a live page or another site stays; "contact" is replaced', () => {
    const list = pages(HOME)
    const linked = linkServiceCards(HOME, list, new Set(['home', 'decks-page']))[1].data.items
    expect(linked.map((i: any) => i.servicePage ?? null)).toEqual(['/services/kitchen-remodels', '/services/baths-and-showers', null, '/services/additions', null])
    expect(linked[2].href).toBe('decks-page')
    expect(linked[3].href).toBe('')
    expect(linked[4].href).toBe('https://example.com/sheds')
  })
})

describe('the page, through the real server', () => {
  test('/services/<slug>: hero, the rest of the description, what is included, sub-services, the quote form, other services', async () => {
    const r = await html('/services/kitchen-remodels')
    expect(r.status).toBe(200)
    expect(r.body).toContain('<h1 class="hero__title">Kitchen remodels</h1>')
    expect(r.body).toContain('Layouts and cabinets.')
    expect(r.body).toContain('We take it down to the studs only when it needs it.')
    expect(r.body).toContain('What&rsquo;s included')
    expect(r.body).toContain('Design visit')
    expect(r.body).toContain('id="cabinet-refacing"')
    expect(r.body).toContain('Request a quote for Kitchen remodels')
    expect(r.body).toContain('href="#quote"')
    expect(r.body).toContain('id="quote"')
    expect(r.body).toContain('Other services')
    expect(r.body).toContain('href="/services/baths-and-showers"')
    expect(r.body).not.toContain('href="/services/kitchen-remodels"')
  })

  test('a service the owner gave nothing for has no empty "included" or "covers" part, and no hero image', async () => {
    const r = await html('/services/baths-and-showers')
    expect(r.status).toBe(200)
    expect(r.body).not.toContain('What&rsquo;s included')
    expect(r.body).not.toContain('What this covers')
    expect(r.body).not.toContain('service-detail')
    expect(r.body).not.toContain('hero--split')
  })

  test('the quote form posts to the enquiry endpoint, naming the service', async () => {
    const r = await html('/services/kitchen-remodels')
    expect(r.body).toContain('action="/api/leads"')
    expect(r.body).toContain('name="service" value="Kitchen remodels"')
    expect(r.body).toContain('value="Service page: Kitchen remodels"')
    const post = await t.call('/api/leads', { method: 'POST', json: { name: 'Pat Q', email: 'pat@example.com', message: 'Our kitchen is 1970s.', service: 'Kitchen remodels', source: 'Service page: Kitchen remodels', t: '1' } })
    expect(post.status).toBe(200)
    // saved as a lead contact (the Lead Inbox is off here), from the service's page, with the service among its answers
    const [row] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'pat@example.com'))
    expect(row.source).toBe('Service page: Kitchen remodels')
    expect(row.notes).toContain('Our kitchen is 1970s.')
    expect(row.notes).toContain('Service: Kitchen remodels')
  })

  test('the home\'s service cards link to the pages; steps and stand-ins do not; unknown and non-services are 404', async () => {
    const home = (await html('/')).body
    expect(home).toContain('href="/services/kitchen-remodels"')
    expect(home).toContain('href="/decks-page"')
    expect(home).toContain('href="https://example.com/sheds"')
    expect(home).not.toContain('/services/tell-us-what-you-need')
    for (const bad of ['/services/tell-us-what-you-need', '/services/decks', '/services/nope']) expect((await html(bad)).status).toBe(404)
  })

  test('the sitemap and llms.txt list the service pages', async () => {
    const sitemap = (await html('/sitemap.xml')).body
    for (const s of ['kitchen-remodels', 'baths-and-showers', 'additions', 'sheds']) expect(sitemap).toContain('/services/' + s + '</loc>')
    const llms = (await html('/llms.txt')).body
    expect(llms).toContain('## Services')
    expect(llms).toContain('/services/kitchen-remodels): Layouts and cabinets.')
  })

  test('the blocks lay themselves out by their own width (container queries), in the base and no look overrides it with a screen query', async () => {
    const css = await (await t.call('/styles/main.css')).text()
    expect(css).toContain('@container service-detail')
    expect(css).toContain('container: service-detail / inline-size')
  })
})
