// What the first AI-built signup site reviewed got wrong (a lawn-care business, built 2026-10-30, read 2026-11-12), held
// here so it cannot come back:
//   · PROMISES the owner never made — "Free estimates" (three times), "no charge for a skipped visit", "you can cancel" —
//     none of them with a number in it, so the facts gate let them through. It now removes a sentence that makes one of
//     the common promises unless the owner's own answers make it; an FAQ answer that loses a sentence goes whole.
//   · SHOP PHOTOS on a lawn-care site — the shared generic set was offered beside the trade's own, and the builder used
//     the shop door and the aprons while three lawn photos went unused. A trade with photos of its own is offered only those.
//   · "STANDARD / BASIC / BASIC" printed over three different services, and "spring-fall" under each. A tier is kept only
//     when the cards are a ladder; the season is written as words; "In season now" is left off when every card is.
//   · the phone as ten bare digits. Shown as (715) 864-5052; the link and the stored number keep the digits.
// The page the owner's site is drawn with is the same one the editor and the preview use, so these are drawn through it.
import { describe, test, expect } from 'bun:test'
import { enforceIntakeFacts, unbackedPromises } from '../../../apps/api/src/services/composerFacts'
import { SECTION_SCHEMA, pageRecipesFor, type ComposerInput } from '../../../apps/api/src/services/sectionComposer'
import { composeInstant } from '../../../apps/api/src/services/instantComposer'
import { HERO_LIBRARY, getHeroLibrary, pickHeroGroup } from '../../../apps/api/src/config/heroLibrary'
import { renderSitePreview } from '../../../apps/unified/server/site/signupPreview'
import { shownPhone } from '../../../apps/unified/server/site/render'

const requiredOf = (type: string, variant: string) => (((SECTION_SCHEMA as any)[type]?.[variant]?.required) || []) as readonly string[]
const allowedFor = (bt: string) => new Set(Object.values(pageRecipesFor(bt)).flatMap((r) => [...r.allowed_types]))
const gate = (pages: Record<string, any[]>, input: ComposerInput) => enforceIntakeFacts(pages, input, { requiredOf, allowedTypes: allowedFor(input.businessType) })

// The answers that lawn-care owner gave, and the parts of the site the model wrote from them.
const LAWN: ComposerInput = {
  businessName: 'Northside Lawn Care', businessType: 'landscaping', city: 'Eau Claire', state: 'WI', phone: '7158645052',
  email: 'owner@northside.example', services: ['Lawn mowing', 'Spring cleanup', 'Leaf removal'], goals: [],
  description: 'Lawn care in Eau Claire.',
}
const AS_WRITTEN = (): Record<string, any[]> => ({
  home: [
    { type: 'hero', variant: 'full-bleed', data: { title: 'Mowed on schedule.', subtitle: 'Northside Lawn Care keeps Eau Claire yards tidy.', primaryCta: { label: 'Get a free estimate', href: 'contact' } } },
    { type: 'packages', variant: 'seasonal', data: { heading: 'Seasonal packages', items: [
      { title: 'Weekly mow', tier: 'standard', includes: ['Mow + trim'], seasonOnly: 'spring-fall' },
      { title: 'Spring cleanup', tier: 'basic', includes: ['Rake out the winter mess'], seasonOnly: 'spring-fall' },
      { title: 'Leaf removal', tier: 'basic', includes: ['Full-property leaf pickup'], seasonOnly: 'spring-fall' },
    ] } },
    { type: 'cta', variant: 'split', data: { heading: 'Want a number on your yard?', subtitle: 'Tell us the address.', phone: '7158645052', bullets: ['Serving Eau Claire', 'Free estimates', 'Call or email — whichever you prefer'], primaryCta: { label: 'Request an estimate', href: 'contact' } } },
  ],
  quote: [
    { type: 'hero', variant: 'centered-stats', data: { eyebrow: 'Estimator', title: 'How much does lawn care cost in Eau Claire?', subtitle: 'It depends on the size of the lot. We give written estimates, free, after we see the yard.' } },
    { type: 'faq', variant: 'accordion', data: { heading: 'How pricing works', items: [
      { question: 'Is the estimate free?', answer: 'Yes. We come look, we write it up, you decide.' },
      { question: 'Can I pause the weekly mow when I\'m on vacation?', answer: 'Yes. Give us a heads-up and we\'ll skip that week — no charge for a skipped visit.' },
      { question: 'Do I need to sign a long contract?', answer: 'No. Weekly mowing runs through the season and you can cancel if something changes.' },
      { question: 'How do I get a price?', answer: 'Call or email with the address. Feel free to send photos of the yard.' },
    ] } },
  ],
})
const words = (v: unknown) => JSON.stringify(v)

describe('a promise the owner did not make', () => {
  test('the reviewed site: the free estimate, the skipped-visit charge and the cancellation are gone; the rest stands', () => {
    const out = gate(AS_WRITTEN(), LAWN)
    const said = words(out.pages)
    for (const gone of ['Free estimates', 'estimates, free', 'Is the estimate free', 'no charge', 'can cancel', 'free estimate']) expect([gone, said.includes(gone)]).toEqual([gone, false])
    for (const kept of ['Mowed on schedule.', 'Serving Eau Claire', 'Call or email — whichever you prefer', 'It depends on the size of the lot.', 'How do I get a price?', 'Feel free to send photos']) {
      expect([kept, said.includes(kept)]).toEqual([kept, true])
    }
    // The button keeps its job without the promise.
    expect(out.pages.home[0].data.primaryCta.label).toBe('Get an estimate')
    // What was taken out is on the list staff read.
    expect(out.removedClaims.join(' | ')).toContain('Free estimates')
  })

  test('an FAQ answer that loses a sentence goes whole — "Yes." alone is still the invented policy', () => {
    const faq = gate(AS_WRITTEN(), LAWN).pages.quote.find((s) => s.type === 'faq')!
    expect(faq.data.items.map((q: any) => q.question)).toEqual(['How do I get a price?'])
  })

  test('the same words stand when the owner said them', () => {
    const free = words(gate(AS_WRITTEN(), { ...LAWN, facts: { freeEstimates: true } }).pages)
    expect(free).toContain('Free estimates')
    expect(free).toContain('Get a free estimate')
    expect(free).toContain('Is the estimate free?')
    const theirs = words(gate(AS_WRITTEN(), { ...LAWN, description: 'Lawn care in Eau Claire. No contracts — cancel any time. No charge for a skipped week.' }).pages)
    expect(theirs).toContain('no charge for a skipped visit')
    expect(theirs).toContain('you can cancel')
  })

  test('each kind, and what backs it', () => {
    const none = 'lawn care in eau claire'
    for (const [text, kind] of [
      ['Free estimates', 'free'], ['Your consultation is always free.', 'free'], ['We quote at no extra charge.', 'free'], ['A complimentary walkthrough', 'free'],
      ['Cancel anytime.', 'cancellation'], ['No long-term contracts.', 'cancellation'],
      ['Satisfaction guaranteed.', 'guarantee'], ['A two-year warranty on labor', 'guarantee'],
      ['Licensed and insured.', 'credential'], ['Family-owned since day one', 'ownership'],
      ['Financing available', 'financing'], ['We answer 24/7.', 'round the clock'], ['Award-winning service', 'ranking'],
    ] as const) expect([text, unbackedPromises(text, none)]).toEqual([text, [kind]])
    // Backed by the owner's own answers.
    expect(unbackedPromises('Licensed and insured.', 'licensed, insured and bonded in wisconsin')).toEqual([])
    expect(unbackedPromises('Fully insured.', 'we carry liability insurance')).toEqual([])
    expect(unbackedPromises('Family-owned since day one', 'a family business')).toEqual([])
    expect(unbackedPromises('Free estimates', 'free estimates free estimate')).toEqual([])
    // Not promises.
    for (const fine of ['Feel free to request an estimate.', 'Gluten-free and dairy-free options', 'Free up your weekends.', 'A dust-free estimate visit',
      'Emergency service', 'If you smell gas, call your utility or emergency services first.', 'We\'ll come look and send a written estimate.']) {
      expect([fine, unbackedPromises(fine, none)]).toEqual([fine, []])
    }
  })

  test('the template site of every trade is untouched by it (nothing of its own wording is a promise)', () => {
    for (const bt of ['roofing', 'plumbing', 'hvac', 'electrical', 'cleaning', 'landscaping', 'home_care', 'veterinary', 'salon', 'restaurant', 'bar', 'food_truck', 'store', 'fitness', 'dispensary', 'other']) {
      const site = composeInstant({ businessName: 'Acme Co', businessType: bt, city: 'Eau Claire', state: 'WI', email: 'o@acme.example', services: ['Signature service'], goals: [] })
      expect([bt, site.removedClaims]).toEqual([bt, []])
    }
  })
})

describe('package cards', () => {
  test('a tier on cards that are different services is dropped; a real ladder keeps it', () => {
    const out = gate(AS_WRITTEN(), LAWN)
    expect(out.pages.home[1].data.items.map((i: any) => i.tier)).toEqual([undefined, undefined, undefined])
    const ladder = { home: [{ type: 'packages', variant: 'seasonal', data: { heading: 'Lawn mowing', items: [{ title: 'Lawn mowing — basic', tier: 'basic' }, { title: 'Lawn mowing — standard', tier: 'standard' }, { title: 'Lawn mowing — premium', tier: 'premium' }] } }] }
    expect(gate(ladder, LAWN).pages.home[0].data.items.map((i: any) => i.tier)).toEqual(['basic', 'standard', 'premium'])
  })

  test('drawn: no tier where none is set, the season in words, and "In season now" only when it tells cards apart', async () => {
    const draw = (items: any[]) => renderSitePreview({ vertical: 'landscaping', design: 'heritage', company: { name: 'Northside Lawn Care', primaryColor: '#FF3D00' }, settings: {}, features: [],
      sections: [{ type: 'packages', variant: 'seasonal', data: { heading: 'Packages', currentSeason: 'summer', items } }] })
    const same = await draw([{ title: 'Weekly mow', seasonOnly: 'spring-fall' }, { title: 'Spring cleanup', seasonOnly: 'spring-fall' }])
    expect(same).not.toContain('class="package-card__tier"')
    expect(same).not.toContain('>Standard<')
    expect(same).toContain('>Spring to fall<')
    expect(same).not.toContain('>spring-fall<')
    expect(same).not.toContain('In season now')
    const mixed = await draw([{ title: 'Weekly mow', tier: 'premium', seasonOnly: 'spring-fall' }, { title: 'Snow contract', tier: 'basic', seasonOnly: 'winter' }, { title: 'Bed care', tier: 'standard', seasonOnly: 'year-round' }])
    expect(mixed.match(/In season now/g)?.length).toBe(2)
    expect(mixed).toContain('<div class="package-card__tier">premium</div>')
    expect(mixed).toContain('>Winter<')
    expect(mixed).toContain('>Year-round<')
  })
})

describe('the photos the AI builder is offered', () => {
  test('a trade with photos of its own is offered only those; the shared set is for a business with no trade', () => {
    const was = process.env.TWOMIAH_FACTORY_URL
    process.env.TWOMIAH_FACTORY_URL = 'https://factory.example'
    try {
      for (const bt of ['landscaping', 'roofing', 'painter', 'hvac', 'bar', 'food_truck', 'home_care', 'salon', 'restaurant', 'fitness']) {
        const group = pickHeroGroup(bt)
        const urls = getHeroLibrary(bt).map((p) => p.url)
        expect([bt, urls.length]).toEqual([bt, HERO_LIBRARY[group].length])
        expect([bt, urls.every((u) => u.includes('/hero-library/' + group + '/'))]).toEqual([bt, true])
      }
      const shop = getHeroLibrary('gift shop').map((p) => p.url)
      expect(shop.length).toBe(HERO_LIBRARY.generic.length)
      expect(shop.every((u) => u.includes('/hero-library/generic/'))).toBe(true)
    } finally {
      if (was === undefined) delete process.env.TWOMIAH_FACTORY_URL; else process.env.TWOMIAH_FACTORY_URL = was
    }
  })
})

describe('the phone number as a visitor reads it', () => {
  test('ten bare digits are written out; anything the owner formatted is theirs', () => {
    expect(shownPhone('7158645052')).toBe('(715) 864-5052')
    expect(shownPhone('17158645052')).toBe('(715) 864-5052')
    expect(shownPhone('+17158645052')).toBe('(715) 864-5052')
    for (const own of ['715-864-5052', '(715) 864-5052', '715.864.5052', '+44 20 7946 0958', '864-5052', '', '1-800-FLOWERS']) expect(shownPhone(own)).toBe(own)
  })

  test('drawn: the number reads (715) 864-5052 and the link dials the digits', async () => {
    const html = await renderSitePreview({ vertical: 'landscaping', design: 'heritage', company: { name: 'Northside Lawn Care', primaryColor: '#FF3D00' }, settings: {}, features: [],
      settingsExtra: { phone: '7158645052' },
      sections: [
        { type: 'cta', variant: 'split', data: { heading: 'Want a number on your yard?', phone: '7158645052', primaryCta: { label: 'Request an estimate', href: 'contact' } } },
        { type: 'contact', variant: 'form-info', data: { heading: 'Get in touch', phone: '7158645052', email: 'owner@northside.example' } },
      ] })
    expect(html).not.toContain('>7158645052<')
    expect(html.match(/>\(715\) 864-5052</g)?.length).toBeGreaterThanOrEqual(3) // the call to action, the contact block, the footer
    expect(html).not.toMatch(/href="tel:[^"]*[() ]/)
  })
})
