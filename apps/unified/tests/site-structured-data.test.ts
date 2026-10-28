// Structured data (site/structuredData.ts), checked on the RENDERED pages — not on the template: a roofing site, a home care
// agency and a store each get real pages served (home, a /services/<slug> page, an inner page, an FAQ page); the JSON-LD is
// pulled out of the HTML and compared with what the page shows, then checked against schema.org's own vocabulary
// (tests/fixtures/schemaorg: types, the properties each may carry, what each holds) — a valid parse alone proves nothing.
//
// Nothing here says a page will earn a rich result in any search engine. The markup is for accuracy; what a search engine
// does with it is its own business.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootTenant } from './harness.ts'
import { validateJsonLd, jsonLdOf } from './fixtures/schemaorg/validate.ts'
import { schemaTypeFor, openingHoursSpecification, socialLinksOf } from '../server/site/structuredData.ts'

const WEEK = { monday: { open: '08:00', close: '17:00' }, tuesday: { open: '08:00', close: '17:00' }, wednesday: { open: '08:00', close: '17:00' }, thursday: { open: '08:00', close: '17:00' }, friday: { open: '08:00', close: '16:00' }, saturday: { closed: true } }

interface Scenario {
  vertical: string
  name: string
  trade: string
  expectType: string | string[]
  /** Hours saved on the company, or none. */
  hours?: Record<string, any>
  services: Array<{ title: string; description: string; subServices?: any[] }>
  faq: Array<{ question: string; answer: string }>
  social?: { platform: string; handle: string }
}

const SCENARIOS: Scenario[] = [
  {
    vertical: 'roofing', name: 'Acme Roofing', trade: 'Roofing', expectType: 'RoofingContractor', hours: WEEK,
    services: [{ title: 'Roof repair', description: 'We find the leak and fix it.', subServices: [{ title: 'Flashing repair' }, { title: 'Shingle replacement', description: 'Matched to what is there.' }] }, { title: 'Gutter cleaning', description: 'Cleaned and flushed.' }],
    faq: [{ question: 'Do you give free estimates?', answer: 'Yes, on every job.' }, { question: 'Do you work on weekends?', answer: 'Saturday by appointment.' }],
    social: { platform: 'instagram', handle: '@acmeroofing' },
  },
  {
    vertical: 'homecare', name: 'Willow Home Care', trade: 'Home care', expectType: 'LocalBusiness',
    services: [{ title: 'Companion care', description: 'Company, errands and meals.' }, { title: 'Personal care', description: 'Help with bathing and dressing.' }],
    faq: [{ question: 'How do you screen caregivers?', answer: 'Background checks and references on every caregiver.' }],
  },
  {
    vertical: 'store', name: 'Fern & Fable', trade: 'Gifts', expectType: 'Store', hours: { monday: { open: '10:00', close: '18:00' }, sunday: { open: '12:00', close: '16:00' } },
    services: [{ title: 'Gift wrapping', description: 'Wrapped by hand.' }, { title: 'Custom orders', description: 'Made to your brief.' }],
    faq: [{ question: 'Do you ship?', answer: 'Yes, anywhere in the US.' }],
  },
]

for (const sc of SCENARIOS) {
  describe(`${sc.vertical}: the pages' JSON-LD`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    const page = async (p: string) => {
      const r = await t.call(p)
      expect(r.status).toBe(200)
      const body = await r.text()
      const blocks = jsonLdOf(body)
      expect(blocks.length).toBe(1)
      return { body, ld: blocks[0], graph: blocks[0]['@graph'] as any[], text: body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ') }
    }
    const biz = (g: any[]) => g.find((n) => n['@id']?.endsWith('/#business'))

    beforeAll(async () => {
      t = await bootTenant({ vertical: sc.vertical })
      const [co] = await t.db.insert(t.schema.company).values({ name: sc.name, slug: 'acme', email: 'owner@acme.example', phone: '608-555-0142', address: '12 Main St', city: 'Verona', state: 'WI', zip: '53593', primaryColor: '#b45309', ...(sc.hours ? { settings: { businessHours: sc.hours } } : {}) } as any).returning()
      await t.db.insert(t.schema.website).values({ companyId: co.id, design: 'foundry', serviceAreas: [{ name: 'Verona' }, { name: 'Madison' }] } as any)
      const hero = { type: 'hero', variant: 'centered-stats', data: { eyebrow: sc.trade + ' · Verona, WI', title: sc.name + ' in Verona' } }
      await t.db.insert(t.schema.page).values([
        { companyId: co.id, slug: 'home', title: 'Home', isPublished: true, sections: [hero, { type: 'services', variant: 'cards-grid', data: { heading: 'What we do', items: sc.services } }, ...(sc.social ? [{ type: 'social', variant: 'feed', data: sc.social }] : [])] },
        { companyId: co.id, slug: 'faq', title: 'Questions', isPublished: true, sections: [hero, { type: 'faq', variant: 'accordion', data: { heading: 'Common questions', items: sc.faq } }] },
        { companyId: co.id, slug: 'about', title: 'About us', isPublished: true, sections: [hero, { type: 'about', variant: 'story', data: { title: 'About', paragraphs: ['We started in 2009.'] } }] },
      ] as any)
    })

    test('home: the business, typed for its trade, with the services the page lists and only the facts on file', async () => {
      const { graph, text } = await page('/')
      const b = biz(graph)!
      expect(b['@type']).toEqual(sc.expectType)
      expect(b.name).toBe(sc.name)
      expect(b.telephone).toBe('608-555-0142')
      expect(b.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Verona', addressRegion: 'WI' }) // the area, never the street
      expect(JSON.stringify(b)).not.toContain('12 Main')
      expect(b.areaServed.map((a: any) => a.name)).toEqual(['Verona', 'Madison'])
      const listed = b.hasOfferCatalog.itemListElement.map((o: any) => o.itemOffered.name)
      expect(listed).toEqual(sc.services.map((s) => s.title))
      for (const s of listed) expect(text).toContain(s) // each is a service the page shows
      expect(graph.some((n) => n['@type'] === 'BreadcrumbList')).toBe(false) // no trail on the home page
      expect(graph.some((n) => n['@type'] === 'FAQPage')).toBe(false)
    })

    test('hours: a specification from the saved week, or nothing; never the free-form openingHours', async () => {
      const { graph, body } = await page('/')
      const b = biz(graph)!
      expect('openingHours' in b).toBe(false)
      expect(body).not.toContain('"openingHours"')
      if (!sc.hours) { expect('openingHoursSpecification' in b).toBe(false); return }
      const spec = b.openingHoursSpecification as any[]
      const days = Object.entries(sc.hours).filter(([, h]: any) => !h.closed)
      expect(spec.flatMap((s) => s.dayOfWeek).sort()).toEqual(days.map(([d]) => 'https://schema.org/' + d[0].toUpperCase() + d.slice(1)).sort())
      for (const s of spec) for (const d of s.dayOfWeek) {
        const day = d.slice('https://schema.org/'.length).toLowerCase()
        expect([s.opens, s.closes]).toEqual([(sc.hours as any)[day].open, (sc.hours as any)[day].close])
      }
      expect(JSON.stringify(spec)).not.toContain('Saturday') // a closed day is not an entry
    })

    test('a service page: a Service from the business with its area, and the same name the page shows', async () => {
      const first = sc.services[0]
      const slug = first.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const { graph, text, body } = await page('/services/' + slug)
      const svc = graph.find((n) => n['@type'] === 'Service')!
      expect(svc.name).toBe(first.title)
      expect(body).toContain('<h1')
      expect(text).toContain(first.title)
      expect(svc.provider).toEqual({ '@id': biz(graph)['@id'] })
      expect(svc.areaServed.map((a: any) => a.name)).toEqual(['Verona', 'Madison'])
      expect(svc.description).toContain(first.description.replace(/\.$/, ''))
      const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList')!.itemListElement
      expect(crumbs.map((c: any) => c.name)).toEqual(['Home', first.title])
      expect(crumbs.at(-1).item['@id']).toBe(svc.url)
      for (const sub of first.subServices ?? []) {
        expect(svc.hasOfferCatalog.itemListElement.map((o: any) => o.itemOffered.name)).toContain(sub.title)
        expect(text).toContain(sub.title)
      }
      if (!first.subServices) expect('hasOfferCatalog' in svc).toBe(false)
    })

    test('an inner page: breadcrumbs matching its real path', async () => {
      const { graph } = await page('/about')
      const list = graph.find((n) => n['@type'] === 'BreadcrumbList')!
      expect(list.itemListElement.map((c: any) => [c.position, c.name, new URL(c.item['@id']).pathname])).toEqual([[1, 'Home', '/'], [2, 'About us', '/about']])
    })

    test('the FAQ page: FAQPage for exactly the questions and answers shown', async () => {
      const { graph, text } = await page('/faq')
      const faq = graph.find((n) => n['@type'] === 'FAQPage')!
      expect(faq.mainEntity.map((q: any) => [q.name, q.acceptedAnswer.text])).toEqual(sc.faq.map((f) => [f.question, f.answer]))
      for (const f of sc.faq) { expect(text).toContain(f.question); expect(text).toContain(f.answer) }
      expect(new URL(faq.url).pathname).toBe('/faq')
    })

    test('social links the owner linked are sameAs; none linked, none listed', async () => {
      const b = biz((await page('/')).graph)!
      if (sc.social) expect(b.sameAs).toEqual(['https://instagram.com/' + sc.social.handle.replace('@', '')])
      else expect('sameAs' in b).toBe(false)
    })

    test('every page validates against schema.org, and none claims a rating or a review', async () => {
      const slugs = ['/', '/about', '/faq', '/services/' + sc.services[0].title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), '/privacy']
      for (const p of slugs) {
        const { ld, body } = await page(p)
        expect([p, validateJsonLd(ld)]).toEqual([p, []])
        expect(body).not.toMatch(/aggregateRating|"review"|ratingValue|reviewCount/)
      }
    })
  })
}

describe('the pieces', () => {
  test('the type follows the trade, and is LocalBusiness whenever it is not certain', () => {
    const cases: Array<[string, string, string | string[]]> = [
      ['roofing', '', 'RoofingContractor'], ['contractor', '', 'GeneralContractor'], ['store', '', 'Store'], ['bar', '', 'BarOrPub'],
      ['fieldservice', 'HVAC', 'HVACBusiness'], ['fieldservice', 'Plumbing', 'Plumber'], ['fieldservice', 'Electrical', 'Electrician'], ['fieldservice', 'Painting', 'HousePainter'],
      ['fieldservice', 'Cleaning', 'LocalBusiness'], ['fieldservice', '', 'LocalBusiness'], ['homecare', 'Home care', 'LocalBusiness'], ['landscaping', '', 'LocalBusiness'],
      ['salon', 'Hair salon', 'HairSalon'], ['salon', 'Nail bar', 'NailSalon'], ['salon', '', 'HealthAndBeautyBusiness'],
      ['restaurant', '', 'Restaurant'], ['vet', '', ['LocalBusiness', 'VeterinaryCare']], ['rv', '', 'AutomotiveBusiness'], ['something-new', 'x', 'LocalBusiness'],
    ]
    for (const [v, trade, want] of cases) expect([v, trade, schemaTypeFor(v, trade)]).toEqual([v, trade, want])
  })

  test('hours: days with the same hours share an entry; closed and unsaid days have none; no hours, no entries', () => {
    expect(openingHoursSpecification(null)).toEqual([])
    expect(openingHoursSpecification({})).toEqual([])
    expect(openingHoursSpecification({ sunday: { closed: true } })).toEqual([])
    expect(openingHoursSpecification({ monday: { open: '09:00', close: '17:00' }, tuesday: { open: '09:00', close: '17:00' }, friday: { open: '09:00', close: '13:00' }, saturday: { closed: true } })).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['https://schema.org/Monday', 'https://schema.org/Tuesday'], opens: '09:00', closes: '17:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['https://schema.org/Friday'], opens: '09:00', closes: '13:00' },
    ])
  })

  test('social links come only from the owner\'s own "Follow us" sections', () => {
    expect(socialLinksOf([{ sections: [{ type: 'social', data: { platform: 'tiktok', handle: '@acme' } }, { type: 'social', data: { handle: '' } }, { type: 'hero', data: {} }] }, { sections: [{ type: 'social', data: { handle: 'acme' } }], isPublished: false }])).toEqual(['https://tiktok.com/@acme'])
  })

  test('the validator catches what a parse would not: an invented type, a property on the wrong type, a wrong value', () => {
    const bad = (n: any) => validateJsonLd({ '@context': 'https://schema.org', '@graph': [n] })
    expect(bad({ '@type': 'HomeHealthCareService', name: 'x' }).join('\n')).toContain('not a schema.org type')
    expect(bad({ '@type': 'VeterinaryCare', name: 'x', openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', opens: '09:00' }] }).join('\n')).toContain('does not belong on VeterinaryCare')
    expect(bad({ '@type': 'LocalBusiness', name: 'x', areaServed: { '@type': 'Banana', name: 'y' } }).join('\n')).toContain('Banana')
    expect(bad({ '@type': 'LocalBusiness', name: 'x', fooBar: 1 }).join('\n')).toContain('not a schema.org property')
    expect(bad({ '@type': 'LocalBusiness', name: 'x', hasOfferCatalog: { '@id': 'https://x/#missing' } }).join('\n')).toContain('not in the graph')
  })
})
