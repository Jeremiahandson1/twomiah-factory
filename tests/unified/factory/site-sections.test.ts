// The new site sections on the Factory's side: the AI builder accepts them (SECTION_SCHEMA / sanitizeSections), the page plans
// that should use them allow them, and the facts policy holds — a section whose facts the owner did not give is left out,
// never invented (composerFacts.ts enforceIntakeFacts).
import { describe, test, expect } from 'bun:test'
import { SECTION_SCHEMA, sanitizeSections, pageRecipesFor, type ComposerInput } from '../../../apps/api/src/services/sectionComposer'
import { enforceIntakeFacts } from '../../../apps/api/src/services/composerFacts'

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
