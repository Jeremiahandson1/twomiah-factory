// crm-bar — menu sizes and prices from a price label (services/barMenuSizes.ts), moved with the code from
// website-premium-bar lib/menu/sizes.ts.
import { labelFromSizes, sizesFromLabel, sizesOf, taxOn } from './src/services/barMenuSizes.ts'

// A self-contained stand-in for bun:test's describe/test/expect: the suite runner launches each file with
// `bun <file>`, not `bun test`, and copies only *.test.ts into its sandbox, so the helpers live here.
let failed = 0, passed = 0
const describe = (_name: string, fn: () => void) => { fn() }
const eq = (a: any, b: any): boolean => JSON.stringify(a) === JSON.stringify(b)
const sub = (o: any, p: any): boolean => p && typeof p === 'object' ? Object.keys(p).every((k) => sub(o?.[k], p[k])) : eq(o, p)
function expect(got: any) {
  const m = (ok: boolean, what: string, want?: any) => { if (!ok) throw new Error(`expected ${JSON.stringify(got)} ${what} ${want === undefined ? '' : JSON.stringify(want)}`) }
  const api = {
    toBe: (w: any) => m(Object.is(got, w), 'to be', w),
    toEqual: (w: any) => m(eq(got, w), 'to equal', w),
    toMatchObject: (w: any) => m(sub(got, w), 'to match', w),
    toBeGreaterThan: (w: number) => m(got > w, 'to be >', w),
    toBeLessThan: (w: number) => m(got < w, 'to be <', w),
    toBeNull: () => m(got === null, 'to be null'),
    toHaveLength: (n: number) => m(got?.length === n, 'to have length', n),
  }
  return { ...api, not: { toBe: (w: any) => m(!Object.is(got, w), 'not to be', w), toEqual: (w: any) => m(!eq(got, w), 'not to equal', w), toBeNull: () => m(got !== null, 'not to be null') } }
}
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok   ${name}`) } catch (e: any) { failed++; console.log(`  FAIL ${name}  ${e?.message || e}`) }
}


// The labels these cases were written against: two sections of a real bar's transcribed menu (prices as
// printed), inlined so the Factory repo carries no customer file.
const menuJson = {"sections":[{"slug":"burgers","description":"All of our burgers are charbroiled. Half-pound beef, on your choice of a white or wheat toasted bun. Platters include a choice of one side item. Onions are no charge. Cheese: real cheddar, real Swiss, real pepper jack. Sandwich / platter.","items":[{"slug":"hamburger","priceCents":579,"priceLabel":"$5.79 / $7.29"},{"slug":"peanut-butter-bacon","priceCents":749,"priceLabel":"Tuesdays · $7.49 / $9.09"}]},{"slug":"daily-specials","description":"Burger / platter with a choice of one side. Happy hour Monday through Friday, 4 to 6 PM.","items":[{"slug":"monday-jalapeno-burger","priceCents":749,"priceLabel":"$7.49 / $9.09"},{"slug":"tuesday-peanut-butter-burger","priceCents":749,"priceLabel":"$7.49 / $9.09"},{"slug":"wednesday-wings","priceCents":799,"priceLabel":"15 / $7.99 · 20 / $10.39"},{"slug":"thursday-hawaiian-burger","priceCents":759,"priceLabel":"$7.59 / $9.19"},{"slug":"friday-fish-fry-special","priceCents":949,"priceLabel":"$9.49"}]}]}
const section = (slug: string) => menuJson.sections.find((s: any) => s.slug === slug)

describe('sizesFromLabel — the transcribed menu', () => {
  test('burger: sandwich / platter, with our own stable ids', () => {
    const s = section('burgers'); const h = s.items.find((i: any) => i.slug === 'hamburger')
    expect(sizesFromLabel(h.priceCents, h.priceLabel, s.description)).toEqual([
      { id: 'sandwich', name: 'Sandwich', priceCents: 579 }, { id: 'platter', name: 'Platter', priceCents: 729 },
    ])
  })
  test('"Tuesdays · $7.49 / $9.09" ignores the day', () => {
    const s = section('burgers'); const pb = s.items.find((i: any) => i.slug === 'peanut-butter-bacon')
    expect(sizesFromLabel(pb.priceCents, pb.priceLabel, s.description).map(v => v.priceCents)).toEqual([749, 909])
  })
  test('daily specials say "Burger / platter"', () => {
    const s = section('daily-specials')
    expect(sizesFromLabel(s.items[0].priceCents, s.items[0].priceLabel, s.description).map(v => v.id)).toEqual(['burger', 'platter'])
  })
  test('wings: counts become piece sizes', () => {
    const s = section('daily-specials'); const w = s.items.find((i: any) => i.slug === 'wednesday-wings')
    expect(sizesFromLabel(w.priceCents, w.priceLabel, s.description)).toEqual([
      { id: '15-pieces', name: '15 pieces', priceCents: 799 }, { id: '20-pieces', name: '20 pieces', priceCents: 1039 },
    ])
  })
  test('single price, and no price at all (the register asks)', () => {
    expect(sizesFromLabel(949, '$9.49', null)).toEqual([{ id: 'regular', name: 'Regular', priceCents: 949 }])
    expect(sizesFromLabel(949, null, null)).toEqual([{ id: 'regular', name: 'Regular', priceCents: 949 }])
    expect(sizesFromLabel(null, null, null)).toEqual([{ id: 'regular', name: 'Regular', priceCents: null }])
  })
  test('every item in the transcribed sections gets at least one size; priced items get prices', () => {
    for (const s of menuJson.sections) for (const i of s.items) {
      const vs = sizesFromLabel(i.priceCents, i.priceLabel, s.description)
      expect(vs.length).toBeGreaterThan(0)
      if (typeof i.priceCents === 'number') for (const v of vs) expect(v.priceCents).toBeGreaterThan(0)
      expect(new Set(vs.map(v => v.id)).size).toBe(vs.length)
    }
  })
})

describe('sizesOf', () => {
  test('stored sizes win over the label', () => {
    expect(sizesOf({ variations: [{ id: 'basket', name: 'Basket', priceCents: 500 }], priceCents: 1, priceLabel: '$9 / $10' })).toEqual([{ id: 'basket', name: 'Basket', priceCents: 500 }])
  })
  test('falls back to the label', () => {
    expect(sizesOf({ variations: [], priceCents: 579, priceLabel: '$5.79 / $7.29' }, 'Sandwich / platter.').map(v => v.id)).toEqual(['sandwich', 'platter'])
  })
})

describe('labelFromSizes', () => {
  test('short for plain sizes, named otherwise, null for one price', () => {
    expect(labelFromSizes([{ id: 'a', name: 'Sandwich', priceCents: 599 }, { id: 'b', name: 'Platter', priceCents: 749 }])).toBe('$5.99 / $7.49')
    expect(labelFromSizes([{ id: 'a', name: '15 pieces', priceCents: 799 }, { id: 'b', name: '20 pieces', priceCents: 1039 }])).toBe('15 pieces $7.99 · 20 pieces $10.39')
    expect(labelFromSizes([{ id: 'x', name: 'Regular', priceCents: 949 }])).toBeNull()
  })
})

describe('taxOn — 5.5% Wisconsin + Eau Claire County', () => {
  test('rounds half-up to the cent with integer math', () => {
    expect(taxOn(2407, 550)).toBe(132)     // 132.385
    expect(taxOn(1000, 550)).toBe(55)
    expect(taxOn(100, 550)).toBe(6)        // 5.5 → 6
    expect(taxOn(0, 550)).toBe(0)
    expect(taxOn(579, 550)).toBe(32)       // 31.845 → 32
  })
})

console.log(`
bar-menu-sizes: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
