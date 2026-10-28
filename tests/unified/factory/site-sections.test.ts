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
