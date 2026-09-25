import { describe, expect, test } from 'bun:test'
import crypto from 'crypto'
import { SquareError, verifySquareSignature } from './client'
import { orderableMenu, orderingWindow, paymentErrorMessage, prepDuration, resolveCart, totals } from './orders'
import { firedText, readyText } from './texts'

describe('webhook signature', () => {
  const key = 'sig-key', url = 'https://amber-inn-site.onrender.com/api/square/webhook', body = '{"type":"refund.updated"}'
  const good = crypto.createHmac('sha256', key).update(url + body).digest('base64')
  test('accepts Square\'s HMAC over url + body', () => expect(verifySquareSignature(body, good, key, url)).toBe(true))
  test('rejects a changed body, wrong url, missing header', () => {
    expect(verifySquareSignature(body + ' ', good, key, url)).toBe(false)
    expect(verifySquareSignature(body, good, key, url.replace('onrender.com', 'example.com'))).toBe(false)
    expect(verifySquareSignature(body, undefined, key, url)).toBe(false)
  })
})

describe('ordering (our menu, our prices)', () => {
  const item = (o: any) => ({ id: 'i1', slug: 'hamburger', name: 'Hamburger', description: null, isActive: true, is86ed: false,
    priceCents: 599, priceLabel: '$5.99 / $7.49', variations: [], ...o })
  const menu = (items: any[], kind = 'food') => [{ id: 's', slug: 'burgers', name: 'Burgers', description: 'Sandwich / platter.', kind, items }] as any

  test('orderable: food only, not 86, priced sizes only; sizes come from the printed price', () => {
    expect(orderableMenu(menu([item({})]))[0].items[0].sizes).toEqual([{ id: 'sandwich', name: 'Sandwich', priceCents: 599 }, { id: 'platter', name: 'Platter', priceCents: 749 }])
    expect(orderableMenu(menu([item({ is86ed: true })]))).toEqual([])
    expect(orderableMenu(menu([item({})], 'drink'))).toEqual([])
    expect(orderableMenu(menu([item({ priceCents: null, priceLabel: null })]))).toEqual([])
    expect(orderableMenu(menu([item({ variations: [{ id: 'basket', name: 'Basket', priceCents: 500 }, { id: 'dinner', name: 'Dinner', priceCents: null }] })]))[0].items[0].sizes.map(v => v.id)).toEqual(['basket'])
  })
  test('resolveCart uses our prices, never the client\'s', () => {
    const m = orderableMenu(menu([item({})]))
    expect(resolveCart([{ itemId: 'i1', sizeId: 'platter', qty: 2, priceCents: 1, note: '  fries   please ' }], m)).toEqual({
      lines: [{ itemId: 'i1', sizeId: 'platter', qty: 2, note: 'fries please', name: 'Hamburger', size: 'Platter', priceCents: 749 }],
    })
  })
  test('resolveCart refuses 86\'d, unknown size, bad quantity, empty', () => {
    const m = orderableMenu(menu([item({})]))
    expect('error' in resolveCart([], m)).toBe(true)
    expect('error' in resolveCart([{ itemId: 'nope', sizeId: 'sandwich', qty: 1 }], m)).toBe(true)
    expect('error' in resolveCart([{ itemId: 'i1', sizeId: 'jumbo', qty: 1 }], m)).toBe(true)
    expect('error' in resolveCart([{ itemId: 'i1', sizeId: 'sandwich', qty: 0 }], m)).toBe(true)
    expect('error' in resolveCart([{ itemId: 'i1', sizeId: 'sandwich', qty: 21 }], m)).toBe(true)
    expect('error' in resolveCart([{ itemId: 'i1', sizeId: 'sandwich', qty: 1 }], orderableMenu(menu([item({ is86ed: true })])))).toBe(true)
  })
  test('totals: subtotal + 5.5% tax', () => {
    expect(totals([{ qty: 2, priceCents: 729 }, { qty: 1, priceCents: 949 }], 550)).toEqual({ subtotalCents: 2407, taxCents: 132, totalCents: 2539 })
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
