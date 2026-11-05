// Fill levels depth (restaurant-bar parity row 15, Backbar): a bottle weighed on a scale. The arithmetic (pure), then the
// real server: the empty and full weights live on the stock item (both or neither, full heavier than empty), a count
// takes weights in grams beside fills and turns each into a fill by those weights, refuses weights for an item with none
// on file, and the quantity is the full ones plus the fills either way. Fails without the change: no bottle weights, no weightsGrams.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { bootFood } from './foodKit.ts'
import { fillFromWeight, fillsFromWeights } from '../server/crm/bar/barStock.ts'

describe('weight to fill', () => {
  test('between the empty bottle and a full one, clamped, in hundredths; nothing without weights', () => {
    expect(fillFromWeight(1000, 500, 1500)).toBe(0.5)
    expect(fillFromWeight(1200, 500, 1500)).toBe(0.7)
    expect(fillFromWeight(400, 500, 1500)).toBe(0)       // lighter than empty: empty
    expect(fillFromWeight(1700, 500, 1500)).toBe(1)      // heavier than full: full
    expect(fillFromWeight(1000, null, 1500)).toBeNull()
    expect(fillFromWeight(1000, 1500, 1500)).toBeNull()
    expect(fillsFromWeights([1000, 1500, 500], { bottleTareGrams: 500, bottleFullGrams: 1500, name: 'Vodka' })).toEqual([0.5, 1, 0])
    expect(() => fillsFromWeights([1000], { bottleTareGrams: null, bottleFullGrams: null, name: 'Vodka' })).toThrow('no bottle weights on file')
    expect(() => fillsFromWeights([-1], { bottleTareGrams: 500, bottleFullGrams: 1500, name: 'Vodka' })).toThrow('grams')
  })
})

let k: Awaited<ReturnType<typeof bootFood>>
const ON = ['contacts', 'bar_menu', 'bar_register', 'bar_stock', 'stock_fill_levels']

describe('on the real server', () => {
  beforeAll(async () => { k = await bootFood({ features: ON }) }, 120_000)
  afterAll(() => k?.restore())

  test('bottle weights on the stock item: both or neither, full heavier than empty; the count sheet carries them', async () => {
    const bad1 = await k.M('POST', '/api/stock/items', { name: 'Vodka', category: 'liquor', unit: 'each', packName: 'bottle', packSize: 1, bottleTareGrams: 500 })
    expect(bad1.status).toBe(400); expect(bad1.json.error).toContain('both')
    const bad2 = await k.M('POST', '/api/stock/items', { name: 'Vodka', category: 'liquor', unit: 'each', packName: 'bottle', packSize: 1, bottleTareGrams: 1500, bottleFullGrams: 500 })
    expect(bad2.json.error).toContain('weighs more')
    const ok = await k.M('POST', '/api/stock/items', { name: 'Vodka', category: 'liquor', unit: 'each', packName: 'bottle', packSize: 1, bottleTareGrams: 500, bottleFullGrams: 1500 })
    expect(ok.status).toBe(200); expect(ok.json.item).toMatchObject({ bottleTareGrams: 500, bottleFullGrams: 1500 })
    const gin = await k.M('POST', '/api/stock/items', { name: 'Gin', category: 'liquor', unit: 'each', packName: 'bottle', packSize: 1 })
    expect(gin.json.item.bottleTareGrams).toBeNull()
    const sheet = (await k.B('GET', '/api/stock/count')).json
    expect(sheet.stock.find((s: any) => s.name === 'Vodka')).toMatchObject({ bottleTareGrams: 500, bottleFullGrams: 1500 })
    expect((await k.M('GET', '/api/stock/items')).json.stock.find((s: any) => s.name === 'Vodka').bottleFullGrams).toBe(1500)
    // Cleared: both go.
    expect((await k.M('PATCH', `/api/stock/items/${ok.json.item.id}`, { name: 'Vodka', bottleTareGrams: null, bottleFullGrams: null })).json.item.bottleTareGrams).toBeNull()
    await k.M('PATCH', `/api/stock/items/${ok.json.item.id}`, { name: 'Vodka', bottleTareGrams: 500, bottleFullGrams: 1500 })
  })

  test('the count takes weights beside fills: 2 full bottles + one at 70% (slid) + two weighed (1000 g, 1500 g) = 4.2 bottles; an item with no weights refuses grams; off, grams are refused', async () => {
    const stock = (await k.B('GET', '/api/stock/count')).json.stock
    const vodka = stock.find((s: any) => s.name === 'Vodka'), gin = stock.find((s: any) => s.name === 'Gin')
    const r = await k.B('POST', '/api/stock/count/item', { stockItemId: vodka.id, packs: 2, fills: [0.7], weightsGrams: [1000, 1500] })
    expect(r.status).toBe(200)
    expect(r.json.qty).toBeCloseTo(2 + 0.7 + 0.5 + 1, 3)   // bottles counted by the bottle: fills add as fractions of one
    const line = (await k.B('GET', '/api/stock/count')).json.count.lines.find((l: any) => l.stockItemId === vodka.id)
    expect(line.fills).toEqual([0.7, 0.5, 1])
    const noWeights = await k.B('POST', '/api/stock/count/item', { stockItemId: gin.id, packs: 1, weightsGrams: [900] })
    expect(noWeights.status).toBe(400); expect(noWeights.json.error).toContain('no bottle weights on file')
    expect((await k.B('POST', '/api/stock/count/item', { stockItemId: vodka.id, packs: 1, weightsGrams: Array(25).fill(1000) })).json.error).toContain('at most 24')
    await k.features(ON.filter((f) => f !== 'stock_fill_levels'))
    expect((await k.B('POST', '/api/stock/count/item', { stockItemId: vodka.id, packs: 1, weightsGrams: [1000] })).json.error).toContain('not switched on')
    await k.features(ON)
  })
})
