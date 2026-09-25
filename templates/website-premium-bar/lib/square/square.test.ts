import { describe, expect, test } from 'bun:test'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { buildCatalogPush, labelFromVariations, mapCatalog, variationsFromLabel } from './catalog'
import { verifySquareSignature } from './client'
import { orderableMenu, orderingWindow, paymentErrorMessage, prepDuration, resolveCart } from './orders'
import { SquareError } from './client'
import { firedText, readyText } from './texts'

const menuJson = JSON.parse(fs.readFileSync(path.join(import.meta.dir, '..', '..', 'content', 'menu.json'), 'utf8'))
const section = (slug: string) => menuJson.sections.find((s: any) => s.slug === slug)

describe('variationsFromLabel — the transcribed menu', () => {
  test('burger: sandwich / platter', () => {
    const s = section('burgers'); const hamburger = s.items.find((i: any) => i.slug === 'hamburger')
    expect(variationsFromLabel(hamburger.priceCents, hamburger.priceLabel, s.description)).toEqual([
      { id: null, name: 'Sandwich', priceCents: 579 }, { id: null, name: 'Platter', priceCents: 729 },
    ])
  })
  test('"Tuesdays · $7.49 / $9.09" ignores the day', () => {
    const s = section('burgers'); const pb = s.items.find((i: any) => i.slug === 'peanut-butter-bacon')
    expect(variationsFromLabel(pb.priceCents, pb.priceLabel, s.description).map(v => v.priceCents)).toEqual([749, 909])
  })
  test('daily specials say "Burger / platter"', () => {
    const s = section('daily-specials'); const mon = s.items[0]
    expect(variationsFromLabel(mon.priceCents, mon.priceLabel, s.description).map(v => v.name)).toEqual(['Burger', 'Platter'])
  })
  test('wings: counts become piece sizes', () => {
    const s = section('daily-specials'); const wings = s.items.find((i: any) => i.slug === 'wednesday-wings')
    expect(variationsFromLabel(wings.priceCents, wings.priceLabel, s.description)).toEqual([
      { id: null, name: '15 pieces', priceCents: 799 }, { id: null, name: '20 pieces', priceCents: 1039 },
    ])
  })
  test('single price and no price', () => {
    expect(variationsFromLabel(949, '$9.49', null)).toEqual([{ id: null, name: 'Regular', priceCents: 949 }])
    expect(variationsFromLabel(949, null, null)).toEqual([{ id: null, name: 'Regular', priceCents: 949 }])
    expect(variationsFromLabel(null, null, null)).toEqual([])
  })
  test('every item in the real menu parses without throwing, and priced items get prices', () => {
    for (const s of menuJson.sections) for (const i of s.items) {
      const vs = variationsFromLabel(i.priceCents, i.priceLabel, s.description)
      if (typeof i.priceCents === 'number') expect(vs.length).toBeGreaterThan(0)
      for (const v of vs) expect(v.priceCents).toBeGreaterThan(0)
    }
  })
})

describe('buildCatalogPush', () => {
  const rows = menuJson.sections.map((s: any) => ({ id: s.slug, slug: s.slug, name: s.name, description: s.description || null, items: s.items.map((i: any) => ({ ...i, id: i.slug, variations: [] })) }))
  const objects = buildCatalogPush(rows)
  test('one category per section, one item per menu item', () => {
    expect(objects.filter(o => o.type === 'CATEGORY').length).toBe(menuJson.sections.length)
    expect(objects.filter(o => o.type === 'ITEM').length).toBe(menuJson.sections.reduce((n: number, s: any) => n + s.items.length, 0))
  })
  test('temporary ids are unique (Square rejects duplicates)', () => {
    const ids = objects.flatMap(o => [o.id, ...(o.item_data?.variations || []).map((v: any) => v.id)])
    expect(new Set(ids).size).toBe(ids.length)
  })
  test('priced items are FIXED_PRICING in cents, unpriced are VARIABLE_PRICING', () => {
    const ham = objects.find(o => o.id === '#item-hamburger')
    expect(ham.item_data.variations.map((v: any) => v.item_variation_data)).toEqual([
      { name: 'Sandwich', pricing_type: 'FIXED_PRICING', price_money: { amount: 579, currency: 'USD' } },
      { name: 'Platter', pricing_type: 'FIXED_PRICING', price_money: { amount: 729, currency: 'USD' } },
    ])
    const club = objects.find(o => o.id === '#item-club')
    expect(club.item_data.variations[0].item_variation_data).toEqual({ name: 'Regular', pricing_type: 'VARIABLE_PRICING' })
    expect(ham.item_data.categories[0].id).toBe('#cat-burgers')
  })
})

describe('mapCatalog', () => {
  const LOC = 'LOC1'
  const objects = [
    { type: 'CATEGORY', id: 'C1', category_data: { name: 'Burgers' } },
    { type: 'CATEGORY', id: 'C2', category_data: { name: 'Empty' } },
    { type: 'IMAGE', id: 'IMG1', image_data: { url: 'https://img/burger.jpg' } },
    { type: 'ITEM', id: 'I1', item_data: { name: 'Hamburger', description: 'Half pound.', categories: [{ id: 'C1' }], image_ids: ['IMG1'], variations: [
      { type: 'ITEM_VARIATION', id: 'V1', item_variation_data: { name: 'Sandwich', pricing_type: 'FIXED_PRICING', price_money: { amount: 599, currency: 'USD' } } },
      { type: 'ITEM_VARIATION', id: 'V2', item_variation_data: { name: 'Platter', pricing_type: 'FIXED_PRICING', price_money: { amount: 749, currency: 'USD' }, location_overrides: [{ location_id: LOC, sold_out: true }] } },
    ] } },
    { type: 'ITEM', id: 'I2', is_deleted: true, item_data: { name: 'Gone', variations: [{ id: 'V3', item_variation_data: { name: 'R', price_money: { amount: 1 } } }] } },
    { type: 'ITEM', id: 'I3', present_at_all_locations: false, present_at_location_ids: ['OTHER'], item_data: { name: 'Other store', variations: [{ id: 'V4', item_variation_data: { name: 'R', price_money: { amount: 100 } } }] } },
    { type: 'ITEM', id: 'I4', item_data: { name: 'Archived', is_archived: true, variations: [{ id: 'V5', item_variation_data: { name: 'R', price_money: { amount: 100 } } }] } },
    { type: 'ITEM', id: 'I5', item_data: { name: 'Loose item', variations: [{ id: 'V6', item_variation_data: { name: 'Regular', pricing_type: 'VARIABLE_PRICING' } }] } },
  ]
  const { sections, items } = mapCatalog(objects, LOC)
  test('drops deleted, archived and other-location items', () => {
    expect(items.map(i => i.name).sort()).toEqual(['Hamburger', 'Loose item'])
  })
  test('only categories with items, plus "More" for uncategorized', () => {
    expect(sections.map(s => s.name)).toEqual(['Burgers', 'More'])
    expect(items.find(i => i.name === 'Loose item')!.categoryId).toBe('__uncategorized')
  })
  test('variations, per-location sold out, images, variable price', () => {
    const h = items.find(i => i.name === 'Hamburger')!
    expect(h.variations).toEqual([{ id: 'V1', name: 'Sandwich', priceCents: 599, soldOut: false }, { id: 'V2', name: 'Platter', priceCents: 749, soldOut: true }])
    expect(h.soldOut).toBe(false)
    expect(h.imageUrl).toBe('https://img/burger.jpg')
    expect(items.find(i => i.name === 'Loose item')!.variations[0].priceCents).toBeNull()
  })
  test('label from variations', () => {
    expect(labelFromVariations(items[0].variations)).toBe('$5.99 / $7.49')
    expect(labelFromVariations([{ id: 'a', name: '15 pieces', priceCents: 799 }, { id: 'b', name: '20 pieces', priceCents: 1039 }])).toBe('15 pieces $7.99 · 20 pieces $10.39')
    expect(labelFromVariations([{ id: 'x', name: 'Regular', priceCents: 949 }])).toBeNull()
  })
})

describe('webhook signature', () => {
  const key = 'sig-key', url = 'https://amber-inn-site.onrender.com/api/square/webhook', body = '{"type":"catalog.version.updated"}'
  const good = crypto.createHmac('sha256', key).update(url + body).digest('base64')
  test('accepts Square\'s HMAC over url + body', () => expect(verifySquareSignature(body, good, key, url)).toBe(true))
  test('rejects a changed body, wrong url, missing header', () => {
    expect(verifySquareSignature(body + ' ', good, key, url)).toBe(false)
    expect(verifySquareSignature(body, good, key, url.replace('onrender.com', 'example.com'))).toBe(false)
    expect(verifySquareSignature(body, undefined, key, url)).toBe(false)
  })
})

describe('ordering', () => {
  const item = (o: any) => ({ id: 'i1', slug: 'hamburger', name: 'Hamburger', description: null, isActive: true, is86ed: false, squareSoldOut: false,
    variations: [{ id: 'V1', name: 'Sandwich', priceCents: 599 }, { id: 'V2', name: 'Platter', priceCents: 749 }], ...o })
  const menu = (items: any[], kind = 'food') => [{ id: 's', slug: 'burgers', name: 'Burgers', description: null, kind, items }] as any

  test('orderable: food only, not 86, not sold out, priced Square variations only', () => {
    expect(orderableMenu(menu([item({})]))[0].items[0].variations.length).toBe(2)
    expect(orderableMenu(menu([item({ is86ed: true })]))).toEqual([])
    expect(orderableMenu(menu([item({ squareSoldOut: true })]))).toEqual([])
    expect(orderableMenu(menu([item({})], 'drink'))).toEqual([])
    expect(orderableMenu(menu([item({ variations: [{ id: null, name: 'Regular', priceCents: 599 }] })]))).toEqual([])
    expect(orderableMenu(menu([item({ variations: [{ id: 'V9', name: 'Regular', priceCents: null }] })]))).toEqual([])
    expect(orderableMenu(menu([item({ variations: [{ id: 'V1', name: 'S', priceCents: 599, soldOut: true }, { id: 'V2', name: 'P', priceCents: 749 }] })]))[0].items[0].variations.map(v => v.id)).toEqual(['V2'])
  })
  test('resolveCart uses our prices, never the client\'s', () => {
    const m = orderableMenu(menu([item({})]))
    const r = resolveCart([{ itemId: 'i1', variationId: 'V2', qty: 2, priceCents: 1, note: '  fries   please ' }], m)
    expect(r).toEqual({ lines: [{ itemId: 'i1', variationId: 'V2', qty: 2, note: 'fries please', name: 'Hamburger', variation: 'Platter', priceCents: 749 }] })
  })
  test('resolveCart refuses 86\'d, unknown variation, bad quantity, empty', () => {
    const m = orderableMenu(menu([item({})]))
    expect('error' in resolveCart([], m)).toBe(true)
    expect('error' in resolveCart([{ itemId: 'nope', variationId: 'V1', qty: 1 }], m)).toBe(true)
    expect('error' in resolveCart([{ itemId: 'i1', variationId: 'V9', qty: 1 }], m)).toBe(true)
    expect('error' in resolveCart([{ itemId: 'i1', variationId: 'V1', qty: 0 }], m)).toBe(true)
    expect('error' in resolveCart([{ itemId: 'i1', variationId: 'V1', qty: 21 }], m)).toBe(true)
    expect('error' in resolveCart([{ itemId: 'i1', variationId: 'V1', qty: 1 }], orderableMenu(menu([item({ is86ed: true })])))).toBe(true)
  })

  const now = new Date('2026-09-25T23:00:00Z')
  const kitchen = (closesInMin: number | null, isOpen = true) => ({ isOpen, closesAt: closesInMin === null ? null : new Date(now.getTime() + closesInMin * 60000).toISOString() })
  const w = (o: any) => orderingWindow({ enabled: true, kitchen: kitchen(120), paused: false, pausedUntil: null, prepMinutes: 20, now, ...o })
  test('window: open while the kitchen is', () => expect(w({}).available).toBe(true))
  test('window: off switch, kitchen closed, paused', () => {
    expect(w({ enabled: false }).available).toBe(false)
    expect(w({ kitchen: kitchen(null, false) }).available).toBe(false)
    expect(w({ paused: true }).available).toBe(false)
  })
  test('window: a pause past its expiry no longer applies', () => {
    expect(w({ paused: true, pausedUntil: new Date(now.getTime() - 1000) }).available).toBe(true)
  })
  test('window: last call is prep + 10 minutes before the kitchen closes', () => {
    expect(w({ kitchen: kitchen(31) }).available).toBe(true)
    expect(w({ kitchen: kitchen(30) }).available).toBe(false)
    expect(w({ kitchen: kitchen(55), prepMinutes: 45 }).available).toBe(false)
  })
  test('prep duration and card errors', () => {
    expect(prepDuration(20)).toBe('PT20M')
    expect(paymentErrorMessage(new SquareError('x', 402, [{ code: 'CVV_FAILURE' }]))).toMatch(/security code/)
    expect(paymentErrorMessage(new SquareError('x', 402, [{ code: 'GENERIC_DECLINE' }]))).toMatch(/declined/)
    expect(paymentErrorMessage(new Error('network'))).toMatch(/Nothing was charged/)
  })
})

describe('order texts', () => {
  test('dry, short, no exclamation marks', () => {
    const t = firedText('Amber Inn', new Date('2026-09-26T00:40:00Z'), 'America/Chicago')
    expect(t).toBe("Amber Inn: your order's on the grill. Ready around 7:40 PM.")
    expect(readyText('Amber Inn')).toBe('Amber Inn: your order is up. Pick it up at the bar.')
    expect(t + readyText('x')).not.toContain('!')
  })
})
