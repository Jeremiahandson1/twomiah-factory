// The free preview is filled with clearly marked SAMPLE content (apps/api/src/config/previewSamples.ts) — and a real
// site must never carry any of it: a real site states only what its owner gave (FACTS_POLICY, sectionComposer.ts).
// Proved three ways: by marker (every sample section is marked; none appears in what the build makes), by text (no
// sample sentence is in what the build or the template composer makes), and by import (only the preview reads the file).
// No live API is called: the renderer is local and nothing is fetched.
import { test, expect, describe } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { SAMPLE_BANNER, SAMPLE_MARK, isSampleSection, sampleSetFor, withPreviewSamples } from '../../../apps/api/src/config/previewSamples'
import { pickHeroGroup } from '../../../apps/api/src/config/heroLibrary'
import { lookForVertical } from '../../../apps/api/src/config/siteLooks'
import { nameSeed } from '../../../apps/api/src/services/instantComposer'
import { provisionSite } from '../../../apps/api/src/unified/factory'
import { renderUnifiedPreview } from '../../../apps/api/src/unified/preview'
import { composeInstant } from '../../../apps/api/src/services/instantComposer'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')
const BASE = 'https://factory.example'

const TRADES: Array<[vertical: string, industry: string]> = [
  ['contractor', 'General Contractor'], ['roofing', 'Roofing'], ['homecare', 'Home Care'], ['salon', 'Hair Salon'],
  ['restaurant', 'Restaurant'], ['foodtruck', 'Food Truck'], ['basic', 'Consulting'], ['painting', 'painter'], ['concrete', 'concrete'], ['flooring', 'flooring'],
  ['electrical', 'electrical'], ['hvac', 'hvac'], ['fitness', 'fitness'], ['store', 'Online Store'], ['fieldservice', 'Plumbing'], ['landscaping', 'Landscaping'],
]
const tenant = (industry: string) => ({ name: 'Acme Co', industry, city: 'Eau Claire', state: 'WI', primary_color: '#FF3D00', intake_data: {}, products: ['website'] })
const homeOf = (industry: string): any[] => (provisionSite(tenant(industry)) as any).pages.find((p: any) => p.slug === 'home').sections

/** Every string value in a structure. */
const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out))
  return out
}
const hasMark = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.some(hasMark)
  if (v && typeof v === 'object') return (v as any)[SAMPLE_MARK] === true || Object.values(v).some(hasMark)
  return false
}

describe('sample sections carry a marker, and the preview has them', () => {
  for (const [vertical, industry] of TRADES) {
    test(vertical + ': samples are marked, the real hero and call to action are not, and it reads as a fuller page', () => {
      const real = homeOf(industry)
      const { sections } = withPreviewSamples(real, vertical, BASE)
      const sampled = sections.filter(isSampleSection)
      expect(sampled.length).toBeGreaterThan(0)
      expect(sections.filter((s) => s.type === 'hero').every((s) => !isSampleSection(s))).toBe(true)
      expect(sections.filter((s) => s.type === 'cta').every((s) => !isSampleSection(s))).toBe(true)
      // A shop's samples fill its existing shop section; every other page gains sections.
      if (vertical === 'store') expect(sampled.map((x) => x.type)).toEqual(['shop'])
      else expect(sections.length).toBeGreaterThan(real.length)
      if (vertical !== 'store') {
        const types = sampled.map((s) => s.type)
        for (const t of ['services', 'about', 'testimonials', 'faq']) expect(types).toContain(t)
      }
      // The call to action stays last.
      expect(sections.at(-1).type).toBe('cta')
    })
  }

  test('a review is attributed "Sample review", never a person; prices and projects say Sample', () => {
    const salon = withPreviewSamples(homeOf('Hair Salon'), 'salon', BASE).sections
    const reviews = salon.find((s) => s.type === 'testimonials').data.items
    expect(reviews.length).toBeGreaterThan(0)
    for (const r of reviews) expect(r.author).toBe('Sample review')
    for (const p of salon.find((s) => s.type === 'pricing').data.items) expect(p.priceLabel).toMatch(/^Sample/)
    const roof = withPreviewSamples(homeOf('Roofing'), 'roofing', BASE).sections
    for (const g of roof.find((s) => s.type === 'gallery').data.photos) expect(g.caption).toMatch(/^Sample/)
    const store = withPreviewSamples(homeOf('Online Store'), 'store', BASE).sections.find((s) => s.type === 'shop').data.products
    expect(store.length).toBeGreaterThanOrEqual(6)
    for (const p of store) expect(p.tagline).toMatch(/^Sample/)
  })

  test('real photos only: every image is the Factory\'s stock or an Unsplash photo — and none when no library address is set', () => {
    for (const [vertical, industry] of TRADES) {
      const { sections, imageUrls } = withPreviewSamples(homeOf(industry), vertical, BASE)
      for (const u of imageUrls) expect(u).toMatch(new RegExp('^(' + BASE.replace(/\./g, '\\.') + '/hero-library/[a-z]+/[a-z]+-\\d+\\.jpg|https://images\\.unsplash\\.com/photo-[\\w-]+\\?)'))
      // The SAMPLE sections' addresses — the business's own sections (its hero) are the build's, not the samples', and
      // read the Factory address from the environment, which another test file in the same run sets.
      for (const u of strings(sections.filter(isSampleSection)).filter((s) => /^https?:\/\//.test(s))) expect(imageUrls).toContain(u)
    }
    // No address: a section that needs library photos is left out, never drawn with a broken box.
    const none = withPreviewSamples(homeOf('Roofing'), 'roofing', '')
    expect(none.sections.some((s) => s.type === 'gallery')).toBe(false)
    expect(strings(none.sections.filter(isSampleSection)).some((s) => s.includes('/hero-library/'))).toBe(false)
  })

  test('a real service list is never replaced', () => {
    const real = [
      { type: 'hero', variant: 'centered-stats', data: { title: 'Acme' } },
      { type: 'services', variant: 'cards-grid', data: { items: [{ title: 'Gutter cleaning' }] } },
      { type: 'cta', variant: 'banner', data: { heading: 'Call' } },
    ]
    const out = withPreviewSamples(real, 'contractor', BASE).sections
    expect(out.filter((s) => s.type === 'services')).toEqual([real[1]])
  })
})

// 2026-11-12: a food truck's preview was a dining room's — "Private dining", "Tasting menus", "How many guests can you
// seat?" — under a photo of a shopkeeper. A food truck runs as a restaurant, but its preview is a food truck's.
describe('a food truck', () => {
  const truck = (industry: string) => renderUnifiedPreview({ businessName: 'Acme Eats', businessType: industry, city: 'Eau Claire', state: 'WI', vertical: 'restaurant', design: 'studio' })

  test('its preview shows a truck, a sample menu and a sample week — not a dining room — however the trade is spelled', async () => {
    // The hero is a library photo, whose address is the Factory's (TWOMIAH_FACTORY_URL): set here, so the test does not
    // lean on another file in the run having set it.
    const had = process.env.TWOMIAH_FACTORY_URL
    process.env.TWOMIAH_FACTORY_URL = BASE
    try {
    for (const industry of ['food_truck', 'Food Truck', 'food truck']) {
      const html = await truck(industry)
      expect(html).toContain('/hero-library/foodtruck/')
      expect(html).toContain('Menu (sample)')
      expect(html).toContain('Sample price')
      expect(html).toContain('This week (sample)')
      for (const dining of ['Private dining', 'Tasting menus', 'how many guests can you seat', 'Past events (sample)']) expect(html).not.toContain(dining)
      expect(html).not.toContain('/hero-library/generic/')
    }
    // A restaurant leads with what it serves too: a sample menu, its own questions — and no week of stops.
    const restaurant = await renderUnifiedPreview({ businessName: 'Acme Eats', businessType: 'restaurant', city: 'Eau Claire', state: 'WI', vertical: 'restaurant', design: 'studio' })
    expect(restaurant).toContain('Menu (sample)')
    expect(restaurant).toContain('do I need a reservation?')
    expect(restaurant).not.toContain('This week (sample)')
    for (const old of ['Tasting menus', 'how many guests can you seat', 'Past events (sample)']) expect(restaurant).not.toContain(old)
    } finally { if (had === undefined) delete process.env.TWOMIAH_FACTORY_URL; else process.env.TWOMIAH_FACTORY_URL = had }
  })

  test('the sample menu stands where the real site\'s live menu is, and states no price', () => {
    const real = homeOf('food_truck')
    const live = real.filter((s) => s.type === 'menu')
    // The build's menu is the live one: no item, no price — the menu entered in the CRM fills it.
    expect(live).toEqual([{ type: 'menu', variant: 'sections', data: { heading: 'Menu', hideWhenEmpty: true, showSignatureLinks: false } }])
    const { sections } = withPreviewSamples(real, 'foodtruck', BASE)
    const menus = sections.filter((s) => s.type === 'menu')
    expect(menus.length).toBe(1)
    expect(isSampleSection(menus[0])).toBe(true)
    expect(sections.findIndex((s) => s.type === 'menu')).toBe(real.findIndex((s) => s.type === 'menu'))
    const items = menus[0].data.sections.flatMap((s: any) => s.items)
    expect(items.length).toBeGreaterThanOrEqual(4)
    for (const it of items) { expect(it.priceLabel).toBe('Sample price'); expect(it.name).toMatch(/^Sample/); expect('priceCents' in it).toBe(false) }
    for (const d of sections.find((s) => s.type === 'schedule').data.days) expect(d.location).toMatch(/^Sample/)
  })

  test('the real home page draws no menu until there is one, then draws the menu that was entered', async () => {
    const { renderSitePreview } = await import('../../../apps/unified/server/site/signupPreview')
    const draw = (sections: any[]) => renderSitePreview({ vertical: 'restaurant', design: 'studio', company: { name: 'Acme Eats', primaryColor: '#FF3D00' }, settings: {}, sections, features: [] })
    const real = homeOf('food_truck')
    const empty = await draw(real)
    expect(empty).not.toContain('class="menu-full"')
    expect(empty).not.toContain('being typed up')
    expect(empty).not.toContain('(sample')
    // The same section with a menu behind it (the page's fallback list stands in for the CRM's here).
    const entered = real.map((s) => s.type === 'menu' ? { ...s, data: { ...s.data, sections: [{ slug: 'mains', name: 'Mains', items: [{ slug: 'pasty', name: 'Beef pasty', priceCents: 900 }] }] } } : s)
    const filled = await draw(entered)
    expect(filled).toContain('class="menu-full"')
    expect(filled).toContain('Beef pasty')
    expect(filled).toContain('$9')
    // A menu PAGE (no hideWhenEmpty) still says so when the menu is empty: the bar's, unchanged.
    expect(await draw([{ type: 'menu', variant: 'sections', data: { asHeading: true } }])).toContain('being typed up')
  })

  test('the one-page site (no CRM behind it) starts without the live menu, as before', async () => {
    const { composeOnePage } = await import('../../../apps/api/src/webPresence/compose')
    const pages = composeInstant({ businessName: 'Acme Eats', businessType: 'food_truck', city: 'Eau Claire', state: 'WI', email: 'o@acme.example' } as any).pages
    expect(pages.home.some((s: any) => s.type === 'menu')).toBe(true)
    expect(composeOnePage({ businessName: 'Acme Eats', businessType: 'food_truck', email: 'o@acme.example' } as any, { pages } as any, {}).model.sections.map((s) => s.type)).not.toContain('menu')
  })

  test('no other trade\'s home gains a menu', () => {
    // A restaurant's home carries it as a food truck's does (the best restaurant sites put the menu on the front page).
    for (const industry of ['restaurant', 'Restaurant']) expect([industry, homeOf(industry).filter((s) => s.type === 'menu')]).toEqual([industry, [{ type: 'menu', variant: 'sections', data: { heading: 'Menu', hideWhenEmpty: true, showSignatureLinks: false } }]])
    for (const industry of ['cafe', 'bakery', 'catering', 'roofing', 'home_care', 'salon', 'Consulting', 'retail', 'fitness', 'painter', 'bar_and_grill']) {
      expect([industry, homeOf(industry).some((s) => s.type === 'menu')]).toEqual([industry, false])
    }
  })
})

// The visual audit of 2026-11-12: a painter's preview showed plumbing, concrete and flooring showed kitchen remodels, a gym
// showed shop photos, a bar showed a wedding and opened on a bare line of text. Each trade's preview is its own trade's.
describe('each trade sees its own trade', () => {
  const page = (industry: string, vertical: string, name = 'Acme Co', design = 'studio') =>
    renderUnifiedPreview({ businessName: name, businessType: industry, city: 'Eau Claire', state: 'WI', vertical, design })
  const withBase = async <T>(run: () => Promise<T>): Promise<T> => {
    const had = process.env.TWOMIAH_FACTORY_URL
    process.env.TWOMIAH_FACTORY_URL = BASE
    try { return await run() } finally { if (had === undefined) delete process.env.TWOMIAH_FACTORY_URL; else process.env.TWOMIAH_FACTORY_URL = had }
  }

  test('the set is the trade\'s photo group when it has one, else the vertical\'s, else the catch-all', () => {
    const set = (industry: string, vertical: string) => sampleSetFor(pickHeroGroup(industry), vertical)
    for (const [industry, vertical, want] of [
      ['painter', 'fieldservice', 'painting'], ['concrete', 'contractor', 'concrete'], ['flooring', 'contractor', 'flooring'], ['hvac', 'fieldservice', 'hvac'],
      ['electrical', 'fieldservice', 'electrical'], ['plumbing', 'fieldservice', 'fieldservice'], ['general_contractor', 'contractor', 'contractor'],
      ['remodeler', 'contractor', 'contractor'], ['roofing', 'roofing', 'roofing'], ['landscaping', 'landscaping', 'landscaping'], ['home_care', 'homecare', 'homecare'],
      ['salon', 'salon', 'salon'], ['restaurant', 'restaurant', 'restaurant'], ['food_truck', 'restaurant', 'foodtruck'], ['bar_and_grill', 'bar', 'bar'],
      ['fitness', 'basic', 'fitness'], ['other', 'basic', 'basic'], ['retail', 'store', 'store'], ['hotel', 'basic', 'basic'], ['veterinary', 'vet', 'basic'],
    ] as const) expect([industry, set(industry, vertical)]).toEqual([industry, want])
  })

  test('a painter, concrete, flooring, an electrician, heating and a gym: their own words and photos, none of another trade\'s', async () => {
    await withBase(async () => {
      for (const [industry, vertical, group, has, hasNot] of [
        ['painter', 'fieldservice', 'painting', ['Interior painting', 'Recent paint jobs (sample)'], ['Sample project — plumbing', 'Installations']],
        ['concrete', 'contractor', 'concrete', ['Driveways & slabs', 'Recent pours (sample)'], ['Kitchen & bath remodels', 'Framing']],
        ['flooring', 'contractor', 'flooring', ['Hardwood', 'Recent floors (sample)'], ['Kitchen & bath remodels', 'Framing']],
        ['electrical', 'fieldservice', 'electrical', ['Lighting & fixtures', 'Panels & wiring'], ['Sample project — plumbing', 'Sample project — fittings']],
        ['hvac', 'fieldservice', 'hvac', ['Heating', 'Cooling'], ['Sample project — plumbing', 'Sample project — fittings']],
        ['fitness', 'basic', 'fitness', ['Personal training', 'This week’s classes (sample)'], ['Service one', '/hero-library/generic/']],
      ] as const) {
        const html = (await page(industry, vertical)).replace(/&amp;/g, '&')
        for (const t of has) expect([industry, t, html.includes(t)]).toEqual([industry, t, true])
        for (const t of hasNot) expect([industry, t, html.includes(t)]).toEqual([industry, t, false])
        // Every library photo on the page is the trade's own.
        const groups = [...new Set([...html.matchAll(/\/hero-library\/([a-z]+)\//g)].map((m) => m[1]))]
        expect([industry, groups]).toEqual([industry, [group]])
      }
    })
  })

  test('a business with no trade named shows what a services section is, with no shop photos on its cards, and credits only what is on the page', async () => {
    await withBase(async () => {
      const { sections, imageUrls } = withPreviewSamples(homeOf('other'), 'basic', BASE)
      const services = sections.filter((s) => s.type === 'services')
      expect(services.length).toBe(1)
      expect(isSampleSection(services[0])).toBe(true)
      expect(services[0].data.items.some((i: any) => i.image)).toBe(false)
      expect(imageUrls).toEqual([])
    })
  })

  test('a bar: drawn in a bar\'s look, its board filled with a sample night, bar photos — not a wedding, not a bare line', async () => {
    await withBase(async () => {
      // Each of the three looks is the bar look nearest it; nothing chosen stays the bar's own default.
      expect([lookForVertical('bar', 'foundry'), lookForVertical('bar', 'heritage'), lookForVertical('bar', 'studio'), lookForVertical('bar', null)]).toEqual(['gameday', 'tavern', 'taproom', null])
      for (const v of ['restaurant', 'roofing', 'basic', null]) expect(lookForVertical(v, 'studio')).toBe('studio')
      for (const [design, font] of [['foundry', 'Big+Shoulders+Display'], ['heritage', 'DM+Serif+Display'], ['studio', 'Space+Grotesk']] as const) {
        const html = (await page('bar_and_grill', 'bar', 'The Rusty Anchor', design)).replace(/&amp;/g, '&')
        expect([design, html.includes(font)]).toEqual([design, true])
        expect(html).toContain('class="board__rows"')
        expect(html).toContain('Sample hours')
        expect(html).toContain('Sample board')
        expect(html).toContain('Menu (sample)')
        expect(html).toContain('Inside the bar (sample)')
        expect(html).toContain('/hero-library/bar/')
        for (const old of ['Hours are being set up', 'Past events (sample)', 'how many guests can you seat', '/hero-library/events/']) expect([design, old, html.includes(old)]).toEqual([design, old, false])
      }
      // The build's own bar page has no sample in it: the board is the live one, with no photo of ours beside it.
      const real = homeOf('bar_and_grill')
      expect(real[0]).toEqual({ type: 'tonight', variant: 'board', data: { title: 'Acme Co' } })
      expect(JSON.stringify(real)).not.toContain('hero-library')
    })
  })

  test('a signup that chose a look in the preview is built in the look it was shown: a bar in the bar\'s', () => {
    const signup = (industry: string, design: string) => provisionSite({ ...tenant(industry), intake_data: { signup: { design } } }) as any
    expect(signup('bar_and_grill', 'studio').design).toBe('taproom')
    expect(signup('bar_and_grill', 'foundry').design).toBe('gameday')
    expect(signup('bar_and_grill', 'heritage').design).toBe('tavern')
    expect(signup('roofing', 'studio').design).toBe('studio')
    expect(signup('restaurant', 'heritage').design).toBe('heritage')
    expect('design' in (provisionSite(tenant('bar_and_grill')) as any)).toBe(false)
  })
})

// "They need to vary somehow so not every bar is identical" (the owner, 2026-11-12): the preview varies with the
// business's name the way its real page does — steady for one business, different between two.
describe('two businesses of one trade are not the same page', () => {
  const shape = (industry: string, set: string, name: string) => {
    const { sections } = withPreviewSamples(homeOf(industry), set, BASE, nameSeed(name))
    return JSON.stringify(sections.filter(isSampleSection).map((s) => [s.type, s.variant, s.data.items?.[0]?.title ?? s.data.photos?.[0]?.url ?? s.data.art ?? '']))
  }
  const NAMES = ['The Rusty Anchor', 'Northside Tap', 'The Copper Mule', 'Badger State', 'Summit', 'Maple Street', 'Hartwell', 'Lakeside', 'Iron Valley', 'Bluebird', 'Stonebridge', 'Green Acre']

  test('one business gets the same page every time; a dozen businesses get several different ones', () => {
    for (const [industry, set] of [['roofing', 'roofing'], ['bar_and_grill', 'bar'], ['restaurant', 'restaurant'], ['painter', 'painting'], ['fitness', 'fitness'], ['salon', 'salon']] as const) {
      expect(shape(industry, set, NAMES[0])).toBe(shape(industry, set, NAMES[0]))
      const kinds = new Set(NAMES.map((n) => shape(industry, set, n)))
      expect([industry, kinds.size >= 4]).toEqual([industry, true])
    }
  })

  test('whatever the name, every sample is still marked, the hero and the call to action are the build\'s, and the call to action is last', () => {
    for (const [industry, set] of [['roofing', 'roofing'], ['bar_and_grill', 'bar'], ['restaurant', 'restaurant'], ['other', 'basic'], ['home_care', 'homecare']] as const) for (const n of NAMES) {
      const real = homeOf(industry)
      const { sections } = withPreviewSamples(real, set, BASE, nameSeed(n))
      expect(sections.at(-1).type).toBe('cta')
      expect(sections.filter((s) => s.type === 'hero' || s.type === 'cta').every((s) => !isSampleSection(s))).toBe(true)
      // Nothing of the build's is dropped: every real section is there, or a marked sample stands in its place.
      expect(sections.length).toBeGreaterThan(real.length)
      for (const s of sections) if (!real.includes(s)) expect(isSampleSection(s)).toBe(true)
    }
  })

  test('no name: the plain order and layouts', () => {
    const { sections } = withPreviewSamples(homeOf('roofing'), 'roofing', BASE)
    expect(sections.filter(isSampleSection).map((s) => s.type + '/' + s.variant)).toEqual(['services/cards-grid', 'why_choose/grid', 'gallery/grid', 'about/story', 'testimonials/quotes', 'faq/accordion'])
    expect(sections.find((s) => s.type === 'services').data.items[0].title).toBe('Roof replacement')
  })
})

describe('the preview page', () => {
  test('carries the banner and the samples; the same page without them (a real render) carries neither', async () => {
    const html = await renderUnifiedPreview({ businessName: 'Acme Co', businessType: 'Roofing', city: 'Eau Claire', state: 'WI', vertical: 'roofing', design: 'foundry' })
    expect(html).toContain('id="twomiah-sample-banner"')
    expect(html).toContain(SAMPLE_BANNER)
    expect(html).toContain('Sample review')
    // The banner is the first thing in the body.
    expect(html.replace(/\s+/g, ' ')).toMatch(/<body[^>]*><style>#twomiah-sample-banner/)
    const { renderSitePreview } = await import('../../../apps/unified/server/site/signupPreview')
    const real = await renderSitePreview({ vertical: 'roofing', design: 'foundry', company: { name: 'Acme Co', primaryColor: '#FF3D00' }, settings: {}, sections: homeOf('Roofing'), features: [] })
    expect(real).not.toContain('twomiah-sample-banner')
    expect(real).not.toContain('Sample review')
    expect(real).not.toContain('(sample')
  })
})

describe('a real site cannot carry a sample', () => {
  const sampleText = (vertical: string, industry: string) =>
    strings(withPreviewSamples(homeOf(industry), vertical, BASE).sections.filter(isSampleSection)).filter((s) => s.length > 12 && /sample/i.test(s))

  for (const [vertical, industry] of TRADES) {
    test(vertical + ': provisionSite (the build) has no marker and none of the sample text', () => {
      const site: any = provisionSite(tenant(industry))
      expect(hasMark(site)).toBe(false)
      const built = JSON.stringify(site)
      for (const t of sampleText(vertical, industry)) expect(built.includes(JSON.stringify(t).slice(1, -1))).toBe(false)
      expect(built).not.toContain('Sample review')
      expect(built).not.toContain(SAMPLE_BANNER)
    })
    test(vertical + ': the signup\'s template composer has none of it', () => {
      const composed = JSON.stringify(composeInstant({ businessName: 'Acme Co', businessType: industry, city: 'Eau Claire', state: 'WI', email: 'o@acme.example', services: ['Signature service'], goals: [] }))
      expect(composed).not.toContain('Sample review')
      expect(composed).not.toContain('(sample')
      for (const t of sampleText(vertical, industry)) expect(composed.includes(JSON.stringify(t).slice(1, -1))).toBe(false)
    })
  }

  test('only unified/preview.ts imports the samples (the build, the composers, signupSite and the unified server never do)', () => {
    const readers: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        // Forward slashes, so the comparison below holds on Windows as on Linux.
        else if (/\.(ts|tsx|js|mjs|cjs|ejs)$/.test(e.name) && /previewSamples|SAMPLE_BANNER|withPreviewSamples/.test(fs.readFileSync(p, 'utf8'))) readers.push(path.relative(ROOT, p).split(path.sep).join('/'))
      }
    }
    for (const d of ['apps/api/src', 'apps/unified', 'packages']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d))
    const allowed = ['apps/api/src/config/previewSamples.ts', 'apps/api/src/unified/preview.ts']
    // unified's own tests may name them; nothing else may.
    expect(readers.filter((r) => !allowed.includes(r) && !r.startsWith('apps/unified/tests/'))).toEqual([])
  })
})
