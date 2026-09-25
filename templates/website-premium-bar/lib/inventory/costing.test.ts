import { describe, expect, test } from 'bun:test'
import { costOf, costPct, engineerMenu, linesForSize, packsToOrder, theoreticalUse, unitCostCents, variance } from './costing'

const stock = new Map([
  ['beef', { name: 'Ground beef', packCostCents: 5200, packSize: '10' }],     // $5.20 / lb
  ['bun', { name: 'Buns', packCostCents: 480, packSize: '12' }],              // 40¢ each
  ['fries', { name: 'Fries', packCostCents: 3000, packSize: '30' }],          // $1 / lb
  ['keg', { name: 'Spaten ½ bbl', packCostCents: 19840, packSize: '1984' }],  // 10¢ / fl oz
  ['mystery', { name: 'Special sauce', packCostCents: null, packSize: '1' }],
])

describe('costing', () => {
  test('unit cost from the pack', () => {
    expect(unitCostCents({ packCostCents: 19840, packSize: '1984' })).toBe(10)
    expect(unitCostCents({ packCostCents: null, packSize: '1' })).toBeNull()
    expect(unitCostCents({ packCostCents: 500, packSize: '0' })).toBeNull()
  })
  test('a half-pound burger sandwich: ½ lb beef + a bun = $3.00', () => {
    expect(costOf([{ stockItemId: 'beef', qty: '0.5' }, { stockItemId: 'bun', qty: 1 }], stock)).toEqual({ costCents: 300, missing: [] })
  })
  test('an unpriced ingredient makes the cost unknown and says which', () => {
    expect(costOf([{ stockItemId: 'beef', qty: 0.5 }, { stockItemId: 'mystery', qty: 1 }], stock)).toEqual({ costCents: null, missing: ['Special sauce'] })
  })
  test('cost %: $3.00 on $5.79 = 51.8%', () => {
    expect(costPct(300, 579)).toBe(51.8)
    expect(costPct(null, 579)).toBeNull()
  })
  test('size lines win over every-size lines', () => {
    const lines = [{ sizeId: null, stockItemId: 'beef' }, { sizeId: null, stockItemId: 'bun' }, { sizeId: 'platter', stockItemId: 'fries' }]
    expect(linesForSize(lines, 'platter').map(l => l.stockItemId)).toEqual(['fries'])
    expect(linesForSize(lines, 'sandwich').map(l => l.stockItemId)).toEqual(['beef', 'bun'])
  })
})

describe('usage and variance', () => {
  const recipes = new Map([['ham', [{ sizeId: null, stockItemId: 'beef', qty: '0.5' }, { sizeId: null, stockItemId: 'bun', qty: '1' }]]])
  test('recipes × sold, plus tap pours as recorded', () => {
    const use = theoreticalUse([
      { menuItemId: 'ham', sizeId: 'sandwich', qty: 10 },
      { menuItemId: null, sizeId: 'regular', qty: 40, stockItemId: 'keg', stockQty: '16' },
      { menuItemId: 'unknown', sizeId: 'regular', qty: 3 },
    ], recipes)
    expect(use.get('beef')).toBe(5); expect(use.get('bun')).toBe(10); expect(use.get('keg')).toBe(640)
  })
  test('variance: 40 pints should be 640 oz, the keg lost 700 → 60 oz ($6) unaccounted', () => {
    const items = [{ id: 'keg', name: 'Spaten ½ bbl', category: 'beer', unit: 'floz', packCostCents: 19840, packSize: '1984' }]
    const rows = variance(items, new Map([['keg', 1984]]), new Map([['keg', 1284]]), new Map(), new Map([['keg', 640]]))
    expect(rows[0]).toMatchObject({ actual: 700, expected: 640, varianceUnits: 60, varianceCents: 600, actualCents: 7000 })
  })
  test('received between counts counts as stock; items not counted both times are left out', () => {
    const items = [
      { id: 'bun', name: 'Buns', category: 'food', unit: 'each', packCostCents: 480, packSize: '12' },
      { id: 'beef', name: 'Beef', category: 'food', unit: 'lb', packCostCents: 5200, packSize: '10' },
    ]
    const rows = variance(items, new Map([['bun', 10]]), new Map([['bun', 20]]), new Map([['bun', 24]]), new Map([['bun', 14]]))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actual: 14, varianceUnits: 0, varianceCents: 0 })
  })
})

describe('ordering', () => {
  test('back to par, whole packs', () => {
    expect(packsToOrder(18, '12', '3')).toBe(2)    // 1.5 cases on hand, par 3 → 2 cases
    expect(packsToOrder(36, '12', '3')).toBe(0)
    expect(packsToOrder(0, '1984', '2')).toBe(2)
    expect(packsToOrder(5, '12', null)).toBe(0)    // no par set → never suggested
  })
})

describe('menu engineering', () => {
  test('stars, plowhorses, puzzles, dogs', () => {
    const r = engineerMenu([
      { key: 'a', name: 'Hamburger', sold: 100, priceCents: 729, costCents: 300 },         // popular, margin 429
      { key: 'b', name: 'Fish Fry', sold: 60, priceCents: 949, costCents: 350 },           // popular, margin 599
      { key: 'c', name: 'Reuben Burger', sold: 5, priceCents: 939, costCents: 320 },       // unpopular, margin 619
      { key: 'd', name: 'Cheese Quesadilla', sold: 4, priceCents: 600, costCents: 350 },   // unpopular, margin 250
      { key: 'e', name: 'Soup', sold: 30, priceCents: 400, costCents: null },
    ])
    const cls = Object.fromEntries(r.rows.map(x => [x.name, x.class]))
    expect(r.avgMarginCents).toBe(Math.round((100 * 429 + 60 * 599 + 5 * 619 + 4 * 250) / 169))
    expect(cls).toEqual({ Hamburger: 'plowhorse', 'Fish Fry': 'star', 'Reuben Burger': 'puzzle', 'Cheese Quesadilla': 'dog', Soup: null })
    expect(r.popularAt).toBe(14)
  })
})
