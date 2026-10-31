// Photo variety, steps 2 and 3 (10/31): where live stock photos are used, and that every photo a site shows is credited.
//   · live Pexels photos only for a trade whose checked library is thin (fewer than LIVE_STOCK_BELOW), never home care
//     (daily living, no medical imagery), never a trade with a full library;
//   · the quick preview's hero is chosen by the business's name among the shots that suit the trade — steady for one
//     business, different between two — and, for a thin trade, among live hero shots too; home care never;
//   · the $19 page credits the library photos it shows (the Pexels API guidelines make crediting a condition of use);
//   · the signup's AI site saves its photo credits when it is composed (the live registry is warm then), and the build
//     reads them back with the ones its pages work out — a live photo is credited on another instance, after a restart;
//   · credit lists merge one line per photographer, never the same photo twice.
// No Pexels call is made: the key is unset in tests, and live photos are registered by hand.
import { describe, test, expect } from 'bun:test'
import { HERO_LIBRARY, LIVE_STOCK_BELOW, liveStockFor, pickHeroGroup, registerLiveImage, heroCreditsForUrls, mergeCredits } from '../../../apps/api/src/config/heroLibrary'
import { composeInstant } from '../../../apps/api/src/services/instantComposer'
import { composeSignupSite, signupComposition, type SignupSiteDeps } from '../../../apps/api/src/services/signupSite'
import { provisionSite } from '../../../apps/api/src/unified/factory'
import { renderOnePage } from '../../../apps/unified/server/site/onePage'
import { composeOnePage } from '../../../apps/api/src/webPresence/compose'
import { buildSpec, canonicalise } from '../../../apps/api/src/webPresence/spec'
import { unifiedVerticalOf } from '../../../apps/api/src/webPresence/service'
import { signupComposerInput } from '../../../apps/api/src/services/signupSite'
import { fakeStore } from './fakeStore'

process.env.TWOMIAH_FACTORY_URL ||= 'https://factory.example'
delete process.env.PEXELS_API_KEY

const heroOf = (site: any): string => (site.pages.home || []).find((s: any) => s.type === 'hero')?.data?.image || ''
const answers = (businessType: string, businessName: string, stockPhotos?: Array<{ url: string; tag?: string }>) =>
  ({ businessName, businessType, city: 'Eau Claire', state: 'WI', ...(stockPhotos ? { stockPhotos } : {}) }) as any

describe('where live stock photos are used', () => {
  test('a thin library and stores take live photos; a full library and home care do not', () => {
    expect(pickHeroGroup('dispensary')).toBe('dispensary')
    expect((HERO_LIBRARY.dispensary || []).length).toBeLessThan(LIVE_STOCK_BELOW)
    expect(liveStockFor('dispensary')).toBe(true)
    expect(pickHeroGroup('dropship store')).toBe('generic')
    expect(liveStockFor('dropship store')).toBe(true)
    // The library grown 10/31: every trade group has its six checked photos.
    for (const [type, group] of [['salon', 'salon'], ['restaurant', 'restaurant'], ['cafe', 'cafe'], ['gym', 'fitness'], ['hotel', 'hotel'], ['wedding planner', 'events'], ['food truck', 'foodtruck'], ['landscaping', 'landscaping'], ['plumbing', 'fieldservice'], ['general contractor', 'contractor'], ['roofing', 'roofing']] as const) {
      expect(pickHeroGroup(type)).toBe(group)
      expect((HERO_LIBRARY[group] || []).length).toBeGreaterThanOrEqual(LIVE_STOCK_BELOW)
      expect(liveStockFor(type)).toBe(false)
    }
    expect(liveStockFor('home care')).toBe(false)
    expect(liveStockFor('senior caregivers')).toBe(false)
  })

  test('every library photo is on disk and credited', async () => {
    for (const [group, list] of Object.entries(HERO_LIBRARY)) for (const p of list) {
      expect(await Bun.file(`apps/api/assets/hero-library/${group}/${p.file}`).exists()).toBe(true)
      expect([p.source, !!p.photographer, !!p.photographerUrl, !!p.sourceUrl]).toEqual(['pexels', true, true, true])
    }
  })
})

describe("the quick preview's hero", () => {
  const LIVE = ['https://images.pexels.com/photos/1/shop-a.jpeg', 'https://images.pexels.com/photos/2/shop-b.jpeg', 'https://images.pexels.com/photos/3/shop-c.jpeg']
  const live = LIVE.map((url) => ({ url, tag: 'hero' }))
  const names = ['Shear Joy', 'Mane Street', 'The Curl Up', 'Velvet Chair', 'Blush & Brush', 'Cut Above', 'Studio Nine', 'Glow Room']

  test('steady for one business, different between two salons, always a checked salon photo', () => {
    const heroes = names.map((n) => heroOf(composeInstant(answers('salon', n, live))))
    expect(heroOf(composeInstant(answers('salon', names[0], live)))).toBe(heroes[0])
    expect(new Set(heroes).size).toBeGreaterThan(1)
    expect(heroes.every((h) => h.includes('/hero-library/salon/'))).toBe(true)
  })

  test('a thin trade chooses among live shots too', () => {
    const heroes = names.map((n) => heroOf(composeInstant(answers('dispensary', n + ' Cannabis', live))))
    expect(heroes.some((h) => LIVE.includes(h))).toBe(true)
    expect(heroes.every((h) => h)).toBe(true)
  })

  test('home care never takes a live shot, whatever it is given; a full library ignores live shots too', () => {
    for (const n of ['Comfort Keepers Co', 'Hearth Home Care', 'Gentle Hands', 'Sunrise Companions', 'Kind Neighbors', 'Evergreen Care']) {
      expect(heroOf(composeInstant(answers('home care', n, live)))).toContain('/hero-library/homecare/')
      expect(heroOf(composeInstant(answers('roofing', n + ' Roofing', live)))).toContain('/hero-library/')
    }
  })

  test('with no live shots, the hero is a checked library photo', () => {
    expect(heroOf(composeInstant(answers('salon', 'Shear Joy')))).toContain('/hero-library/')
  })
})

describe('credits', () => {
  test('merging: one line per photographer, the same photo once, counts added', () => {
    const a = [{ photographer: 'Ana', source: 'Pexels', count: 1, sourceUrl: 'https://p/1' }]
    const b = [{ photographer: 'Ana', source: 'Pexels', count: 1, sourceUrl: 'https://p/1' }, { photographer: 'Ana', source: 'Pexels', count: 1, sourceUrl: 'https://p/2' }, { photographer: 'Bo', source: 'Pexels', count: 2 }]
    const m = mergeCredits(a, b, null, undefined)
    expect(m.find((c) => c.photographer === 'Ana')).toMatchObject({ count: 2, sourceUrl: undefined })
    expect(m.find((c) => c.photographer === 'Bo')?.count).toBe(2)
  })

  test("the $19 page credits the library photo it shows", async () => {
    const input = signupComposerInput({ name: 'Acme Roofing', industry: 'roofing', city: 'Madison', state: 'WI', phone: '6085551234', email: 'o@acme.test' }, { services: ['Roof repair'], goals: [] })
    const comp = signupComposition(input, { ai: false }) as any
    const pages = Object.fromEntries(Object.entries(comp.pages).map(([k, p]: [string, any]) => [k, p.sections ?? p]))
    const model = canonicalise(composeOnePage(input as any, { pages } as any, {}).model, buildSpec('roofing'), null).model
    const caps = Object.fromEntries(Object.entries(buildSpec('roofing').caps).map(([k, v]: [string, any]) => [k, { anchor: v.anchor, ...(v.nav ? { nav: v.nav } : {}) }]))
    const out: any = await renderOnePage({ model, vertical: unifiedVerticalOf('roofing'), caps, origin: 'https://acme.netlify.app' } as any)
    const html = String(out.files['index.html'])
    const lib = html.match(/\/hero-library\/roofing\/([a-z0-9-]+\.jpg)/)
    expect(lib).toBeTruthy()
    const photo = HERO_LIBRARY.roofing.find((p) => p.file === lib![1])!
    expect(html).toContain(photo.photographer!)
    expect(html).toContain('Pexels')
  })

  test("the AI site saves its live photos' credits when composed; the build credits them after the registry is gone", async () => {
    const url = 'https://images.pexels.com/photos/777/bar-hero.jpeg'
    registerLiveImage(url, { file: url, tag: 'hero', source: 'pexels', photographer: 'Lena Live', photographerUrl: 'https://www.pexels.com/@lena', sourceUrl: 'https://www.pexels.com/photo/777/', license: 'Pexels License' })
    const input = { businessName: 'Taproom Nine', businessType: 'bar', city: 'Eau Claire', state: 'WI', services: ['Craft beer'] } as any
    const stored = signupComposition(input, { ai: true })
    const store = fakeStore({ tenants: [{ id: 't-1', slug: 'taproom-nine', status: 'pending', created_at: new Date().toISOString(), preview_premium_pages: stored }] })
    const deps: SignupSiteDeps = {
      db: store, bootedAt: Date.now() - 60_000,
      compose: async () => ({ pages: { home: { sections: [{ type: 'hero', variant: 'split-image', data: { title: 'Taproom Nine', image: url } }] } }, heldPages: [], contentGaps: [], removedClaims: [] } as any),
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))),
    }
    await composeSignupSite('t-1', deps)
    const c = store.tables.tenants[0].preview_premium_pages
    expect(c._photoCredits).toEqual([expect.objectContaining({ photographer: 'Lena Live', source: 'Pexels' })])
    // Another instance: its registry never saw the photo. The saved credits still reach the site's footer.
    expect(heroCreditsForUrls([url.replace('777', '778')])).toEqual([])
    const tenant = { ...store.tables.tenants[0], name: 'Taproom Nine', industry: 'bar' }
    const credits = (provisionSite(tenant) as any).photoCredits
    expect(credits.filter((x: any) => x.photographer === 'Lena Live').length).toBe(1)
  })
})
