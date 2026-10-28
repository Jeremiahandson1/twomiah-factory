// The new site sections on the Factory's side: the AI builder accepts them (SECTION_SCHEMA / sanitizeSections), the page plans
// that should use them allow them, and the facts policy holds — a section whose facts the owner did not give is left out,
// never invented (composerFacts.ts enforceIntakeFacts).
import { describe, test, expect } from 'bun:test'
import { SECTION_SCHEMA, sanitizeSections, pageRecipesFor, type ComposerInput } from '../../../apps/api/src/services/sectionComposer'
import { enforceIntakeFacts } from '../../../apps/api/src/services/composerFacts'
import { composeInstant } from '../../../apps/api/src/services/instantComposer'

const requiredOf = (type: string, variant: string) => (((SECTION_SCHEMA as any)[type]?.[variant]?.required) || []) as readonly string[]
const allowedFor = (bt: string) => new Set(Object.values(pageRecipesFor(bt)).flatMap((r) => [...r.allowed_types]))
const input = (over: Partial<ComposerInput> = {}): ComposerInput => ({ businessName: 'Acme Roofing', businessType: 'roofing', city: 'Eau Claire', state: 'WI', services: ['Roof repair', 'Gutters'], description: 'We repair roofs and clean gutters around Eau Claire.', ...over })
const enforce = (pages: Record<string, any[]>, inp: ComposerInput) => enforceIntakeFacts(pages, inp, { requiredOf, allowedTypes: allowedFor(inp.businessType) })

describe('a service card (each becomes /services/<slug>)', () => {
  test('what is included and the sub-services stay only where the owner\'s words say so', () => {
    const inp = input({ description: 'We repair roofs and replace shingles. Leak repair, flashing repair and shingle replacement are what most calls are about.' })
    const card = { title: 'Roof repair', description: 'Fixing roofs.', bullets: ['Leak repair', 'Flashing repair', 'A lifetime of coverage and free gutters for life'], subServices: [{ title: 'Shingle replacement' }, { title: 'Solar panel install' }] }
    const out = enforce({ home: [{ type: 'hero', variant: 'centered-stats', data: { title: 'Acme' } }, { type: 'services', variant: 'cards-grid', data: { heading: 'What we do', items: [card] } }] }, inp)
    const got = out.pages.home.find((s) => s.type === 'services')!.data.items[0]
    expect(got.bullets).toEqual(['Leak repair', 'Flashing repair'])
    expect(got.subServices).toEqual([{ title: 'Shingle replacement' }])
    expect(out.removedClaims.join('\n')).toContain('lifetime of coverage')
    expect(out.removedClaims.join('\n')).toContain('Solar panel')
  })

  test('a card with no traceable detail loses the empty lists; its title and description stay', () => {
    const out = enforce({ home: [{ type: 'hero', variant: 'centered-stats', data: { title: 'Acme' } }, { type: 'services', variant: 'cards-grid', data: { items: [{ title: 'Gutters', description: 'Cleaning.', bullets: ['Free quotes in 24 hours'] }] } }] }, input())
    const got = out.pages.home.find((s) => s.type === 'services')!.data.items[0]
    expect(got).toEqual({ title: 'Gutters', description: 'Cleaning.' })
  })

  test('the AI builder keeps bullets and sub-services on a card through sanitizeSections', () => {
    const [s] = sanitizeSections([{ type: 'services', variant: 'cards-grid', data: { items: [{ title: 'A', bullets: ['x'], subServices: [{ title: 'B' }] }] } }])
    expect(s.data.items[0]).toMatchObject({ bullets: ['x'], subServices: [{ title: 'B' }] })
  })
})

describe('why choose us (owner facts only)', () => {
  const sec = (items: any[]) => ({ type: 'why_choose', variant: 'grid', data: { heading: 'Why us', items } })
  const home = (...s: any[]) => ({ home: [{ type: 'hero', variant: 'centered-stats', data: { title: 'Acme' } }, ...s] })
  const facts = input({ facts: { credentials: ['Licensed and insured'], freeEstimates: true, yearFounded: 2009 }, description: 'We answer the phone ourselves and finish what we start.' })

  test('the AI builder accepts it and the trades\' home plans allow it', () => {
    expect(sanitizeSections([sec([{ title: 'Licensed and insured' }])])).toHaveLength(1)
    for (const bt of ['roofing', 'general_contractor', 'hvac', 'landscaping', 'veterinary', 'rv', 'salon', 'other']) {
      expect([bt, pageRecipesFor(bt).home.allowed_types.includes('why_choose' as never)]).toEqual([bt, true])
    }
  })

  test('each reason must trace to what the owner said; an invented one is removed', () => {
    const out = enforce(home(sec([
      { title: 'Licensed and insured', description: 'Licensed and insured, with free estimates.' },
      { title: 'Free estimates' },
      { title: 'Fastest response in the county' },
      { title: 'Voted best roofer 2024' },
    ])), facts)
    expect(out.pages.home.find((s) => s.type === 'why_choose')!.data.items.map((i: any) => i.title)).toEqual(['Licensed and insured', 'Free estimates'])
    expect(out.removedClaims.join('\n')).toContain('Fastest response')
    expect(out.removedClaims.join('\n')).toContain('Voted best roofer')
  })

  test('a reason\'s untraceable sentence goes, the traceable title stays', () => {
    const out = enforce(home(sec([{ title: 'Free estimates', description: 'We cover every county in the state and never charge a trip fee.' }, { title: 'Licensed and insured' }])), facts)
    const items = out.pages.home.find((s) => s.type === 'why_choose')!.data.items
    expect(items[0]).toEqual({ title: 'Free estimates' })
  })

  test('no facts, no section: with fewer than two traceable reasons it is left out', () => {
    const none = enforce(home(sec([{ title: 'Honest pricing' }, { title: 'Quality workmanship' }])), input())
    expect(none.pages.home.some((s) => s.type === 'why_choose')).toBe(false)
    const one = enforce(home(sec([{ title: 'Free estimates' }, { title: 'Quality workmanship' }])), facts)
    expect(one.pages.home.some((s) => s.type === 'why_choose')).toBe(false)
    expect(one.removedClaims.join('\n')).toContain('fewer than two reasons')
  })
})

describe('testimonials carousel (real reviews only)', () => {
  const carousel = (items: any[]) => ({ type: 'testimonials', variant: 'carousel', data: { heading: 'Reviews', items } })
  const home = (...s: any[]) => ({ home: [{ type: 'hero', variant: 'centered-stats', data: { title: 'Acme' } }, ...s] })
  const withReviews = input({ facts: { testimonials: [{ quote: 'Rebuilt our deck in a week.', author: 'Pat K.' }, { quote: 'Fair price and a clean site.', author: 'Dana R.' }] } })

  test('the AI builder accepts the variant', () => {
    expect(sanitizeSections([carousel([{ quote: 'x', author: 'y' }])])).toHaveLength(1)
    expect((SECTION_SCHEMA as any).testimonials.carousel.required).toEqual(['items'])
  })
  test('only the owner\'s own reviews survive, with the owner\'s attribution; an invented review or name is dropped', () => {
    const out = enforce(home(carousel([
      { quote: 'Rebuilt our deck in a week.', author: 'Someone Else' },
      { quote: 'Fair price and a clean site.', author: 'Dana R.' },
      { quote: 'The best contractor in the whole state, five stars.', author: 'Jo M.' },
    ])), withReviews)
    const items = out.pages.home.find((s) => s.type === 'testimonials')!.data.items
    expect(items).toEqual([{ quote: 'Rebuilt our deck in a week.', author: 'Pat K.' }, { quote: 'Fair price and a clean site.', author: 'Dana R.' }])
  })
  test('with no reviews from the owner the section is left out', () => {
    const out = enforce(home(carousel([{ quote: 'Wonderful team.', author: 'A. B.' }])), input())
    expect(out.pages.home.some((s) => s.type === 'testimonials')).toBe(false)
  })
})

describe('map: where to find us (framing only; the site supplies the address)', () => {
  const sec = (data: any) => ({ type: 'map', variant: 'area', data })
  const contact = (...s: any[]) => ({ contact: [{ type: 'contact', variant: 'form-info', data: {} }, ...s] })

  test('the AI builder accepts it, and the contact pages of the trades allow it', () => {
    expect(sanitizeSections([sec({ heading: 'Find us' })])).toHaveLength(1)
    for (const bt of ['roofing', 'general_contractor', 'hvac', 'landscaping', 'veterinary', 'salon', 'other']) expect([bt, pageRecipesFor(bt).contact.allowed_types.includes('map' as never)]).toEqual([bt, true])
  })
  test('whatever address or places the model wrote are removed — only the heading and intro survive', () => {
    const out = enforce(contact(sec({ heading: 'Find us', intro: 'Come by.', address: '1 Fake Ln, Nowhere', serviceAreas: ['Atlantis'], lat: 1, lng: 2, embed: 'https://maps.example/x' })), input())
    expect(out.pages.contact.find((s) => s.type === 'map')!.data).toEqual({ heading: 'Find us', intro: 'Come by.' })
  })
  test('with no town in the intake there is nothing to find: the section is left out', () => {
    const out = enforce(contact(sec({ heading: 'Find us' })), input({ city: '', state: '', nearbyCities: [] }))
    expect(out.pages.contact.some((s) => s.type === 'map')).toBe(false)
    expect(out.removedClaims.join('\n')).toContain('names no town')
  })
})

describe('latest blog posts (the site fills them; the composer writes framing only)', () => {
  const sec = (data: any) => ({ type: 'blog_preview', variant: 'latest', data })
  test('the AI builder and the template composer both place it on the trades\' homes', () => {
    expect(sanitizeSections([sec({ heading: 'From the blog' })])).toHaveLength(1)
    for (const bt of ['roofing', 'general_contractor', 'hvac', 'landscaping', 'veterinary', 'rv', 'salon', 'other']) expect([bt, pageRecipesFor(bt).home.allowed_types.includes('blog_preview' as never)]).toEqual([bt, true])
    const site = composeInstant(input())
    expect(site.pages.home.some((s) => s.type === 'blog_preview')).toBe(true)
  })
  test('a post title, excerpt or date the model wrote is removed; the heading stays', () => {
    const out = enforce({ home: [{ type: 'hero', variant: 'centered-stats', data: { title: 'Acme' } }, sec({ heading: 'From the blog', posts: [{ slug: 'x', title: 'Invented post' }], count: 3, items: [{ title: 'x' }] })] }, input())
    expect(out.pages.home.find((s) => s.type === 'blog_preview')!.data).toEqual({ heading: 'From the blog', count: 3 })
  })
})
