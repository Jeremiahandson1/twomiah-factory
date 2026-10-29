// The Web presence plan's trade table (apps/api/src/webPresence/sections.ts): for every trade the editor offers exactly its
// row, the composer emits only allowed sections, a change of trade keeps what is on the page — and the lookup is mutation-tested:
// the same checks must FAIL when the lookup is broken, or they prove nothing.
import { describe, test, expect } from 'bun:test'
import { verticalFor, type Vertical } from '../../../apps/api/src/config/industryRouting'
import {
  EVERYONE, EXTRAS_BY_VERTICAL, offeredFor, sectionAllowed, onlyAllowed, afterTradeChange, tradeOnlyTypes, tradeKey, FORMS,
} from '../../../apps/api/src/webPresence/sections'

// The owner's table, spelled out independently of the code (section types, as the renderer names them).
const EVERYONE_TYPES = ['hero', 'about', 'services', 'gallery', 'testimonials', 'hours', 'map', 'contact', 'social', 'banner', 'hiring']
const FOOD_TRUCK = ['spot', 'events', 'menu', 'cta']        // today's spot + saved places (both `spot`), events, menu, order-ahead link
const RESTAURANT = ['menu', 'events', 'cta']
const BAR = ['events', 'menu', 'deals']
const SALON = ['pricing', 'team']
const TRADES = ['before_after', 'service_area', 'partners']
const HOME_CARE = ['steps']
const SHOP = ['products']
const ROWS: Record<Vertical, string[]> = {
  foodtruck: FOOD_TRUCK, events: RESTAURANT, bar: BAR, salon: SALON,
  contractor: TRADES, roofing: TRADES, landscaping: TRADES, fieldservice: TRADES,
  homecare: HOME_CARE, store: SHOP,
  basic: [], showcase: [], dispensary: [], rv: [], veterinary: [],
}
const VERTICALS = Object.keys(ROWS) as Vertical[]
const typesOf = (v: Vertical) => [...new Set(offeredFor(v).map((c) => c.type))].sort()

/** Every way the table can be wrong, as a list of plain violations. Empty = the table is right. */
function violations(): string[] {
  const bad: string[] = []
  for (const v of VERTICALS) {
    const want = [...new Set([...EVERYONE_TYPES, ...ROWS[v]])].sort()
    if (JSON.stringify(typesOf(v)) !== JSON.stringify(want)) bad.push(`${v}: offers ${typesOf(v).join(',')} but its row is ${want.join(',')}`)
    for (const other of VERTICALS) {
      // a trade's extras exist ONLY for that trade
      for (const t of ROWS[other]) if (!ROWS[v].includes(t) && !EVERYONE_TYPES.includes(t) && sectionAllowed(v, t)) bad.push(`${v} is offered ${other}'s ${t}`)
    }
  }
  return bad
}

describe('the table', () => {
  test('every Vertical has a row, and the row is exactly the owner\'s', () => {
    expect(Object.keys(EXTRAS_BY_VERTICAL).sort()).toEqual([...VERTICALS].sort())
    expect(violations()).toEqual([])
  })

  test('a roofer is never offered today\'s spot; a food truck is never offered before/after', () => {
    expect(sectionAllowed('roofing', 'spot')).toBe(false)
    expect(sectionAllowed('foodtruck', 'spot')).toBe(true)
    expect(sectionAllowed('foodtruck', 'before_after')).toBe(false)
    expect(sectionAllowed('homecare', 'menu')).toBe(false)
    expect(sectionAllowed('store', 'team')).toBe(false)
  })

  test('the trade-only types are offered to no trade outside their row', () => {
    for (const t of tradeOnlyTypes()) {
      const who = VERTICALS.filter((v) => sectionAllowed(v, t))
      expect(who.length).toBeGreaterThan(0)
      expect(who.every((v) => ROWS[v].includes(t))).toBe(true)
    }
  })

  test('industries reach their row through the same Vertical the full product uses', () => {
    expect(tradeKey('roofing')).toBe(verticalFor('roofing'))
    expect(tradeKey('food_truck')).toBe('foodtruck')
    expect(tradeKey('restaurant')).toBe('events')   // a restaurant/café runs as 'events' in verticalFor
    expect(sectionAllowed(tradeKey('cafe'), 'menu')).toBe(true)
    expect(sectionAllowed(tradeKey('cafe'), 'spot')).toBe(false)
    expect(sectionAllowed(tradeKey('salon'), 'pricing')).toBe(true)
  })

  test('every section is a type the renderer has a view for, and anchors are unique within a trade', async () => {
    const { existsSync } = await import('node:fs')
    for (const v of VERTICALS) {
      const caps = offeredFor(v)
      for (const c of caps) expect(existsSync(`apps/unified/site/views/sections/${c.type}/${c.variant}.ejs`)).toBe(true)
      expect(new Set(caps.map((c) => c.anchor)).size).toBe(caps.length)
      expect(new Set(caps.map((c) => c.id)).size).toBe(caps.length)
    }
  })

  test('hero/split-form is not in the table (the lead form is the contact section\'s, switched by the owner)', () => {
    expect(EVERYONE.some((c) => c.variant === 'split-form')).toBe(false)
  })

  test('there are exactly two forms', () => {
    expect([...FORMS]).toEqual(['lead', 'hiring'])
  })
})

describe('the composer\'s filter', () => {
  const draft = [{ type: 'hero' }, { type: 'spot' }, { type: 'services' }, { type: 'before_after' }, { type: 'menu' }, { type: 'contact' }, { type: 'products' }]
  test('emits only allowed sections, in order', () => {
    expect(onlyAllowed('roofing', draft).map((s) => s.type)).toEqual(['hero', 'services', 'before_after', 'contact'])
    expect(onlyAllowed('foodtruck', draft).map((s) => s.type)).toEqual(['hero', 'spot', 'services', 'menu', 'contact'])
    expect(onlyAllowed('store', draft).map((s) => s.type)).toEqual(['hero', 'services', 'contact', 'products'])
  })
})

describe('a change of trade', () => {
  test('keeps every section on the page and only reports the ones the new trade would not offer', () => {
    const page = [{ type: 'hero' }, { type: 'spot' }, { type: 'menu' }, { type: 'contact' }]
    const out = afterTradeChange('roofing', page)
    expect(out.sections).toEqual(page)
    expect(out.keptOutsideTrade.sort()).toEqual(['menu', 'spot'])
    // and what can be ADDED has changed to the new trade's row
    expect(sectionAllowed('roofing', 'before_after')).toBe(true)
    expect(sectionAllowed('roofing', 'spot')).toBe(false)
  })
})

describe('mutation: the same checks fail when the lookup is broken', () => {
  const mutants: Record<string, (orig: Record<string, any>) => Record<string, any>> = {
    'every trade gets nothing': (o) => Object.fromEntries(Object.keys(o).map((k) => [k, []])),
    'every trade gets the contractor row': (o) => Object.fromEntries(Object.keys(o).map((k) => [k, o.roofing])),
    'every trade gets the union of all rows': (o) => Object.fromEntries(Object.keys(o).map((k) => [k, Object.values(o).flat()])),
    'food truck and roofer swapped': (o) => ({ ...o, foodtruck: o.roofing, roofing: o.foodtruck }),
    'the last extra of each row dropped': (o) => Object.fromEntries(Object.keys(o).map((k) => [k, o[k].slice(0, -1)])),
    'home care also gets the shop row': (o) => ({ ...o, homecare: [...o.homecare, ...o.store] }),
  }
  for (const [name, mutate] of Object.entries(mutants)) {
    test(name, () => {
      const table = EXTRAS_BY_VERTICAL as Record<string, any>
      const orig = { ...table }
      try {
        Object.assign(table, mutate(orig))
        expect(violations().length).toBeGreaterThan(0)
      } finally {
        Object.assign(table, orig)
      }
      expect(violations()).toEqual([])   // restored
    })
  }
})
