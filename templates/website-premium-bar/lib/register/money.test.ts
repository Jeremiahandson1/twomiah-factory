import { describe, expect, test } from 'bun:test'
import { changeDue, checkTotals, formatMoney, quickCash, splitEvenly } from './money'

describe('checkTotals', () => {
  const items = [
    { qty: 2, unitPriceCents: 729, state: 'sent' },   // 2 Hamburger platters
    { qty: 1, unitPriceCents: 949, state: 'held' },   // Fish fry
    { qty: 1, unitPriceCents: 500, state: 'void' },   // voided — not charged
  ]
  test('subtotal skips voids; tax 5.5% on the whole check', () => {
    expect(checkTotals(items, [], 550)).toEqual({ subtotalCents: 2407, taxCents: 132, totalCents: 2539, paidCents: 0, tipCents: 0, balanceCents: 2539 })
  })
  test('payments reduce the balance; tips are tracked apart; voided payments do not count', () => {
    const t = checkTotals(items, [{ amountCents: 1000, tipCents: 200 }, { amountCents: 500, tipCents: 0, voidedAt: new Date() }], 550)
    expect(t.paidCents).toBe(1000); expect(t.tipCents).toBe(200); expect(t.balanceCents).toBe(1539)
  })
})

describe('splitEvenly', () => {
  test('parts add up to the cent', () => {
    expect(splitEvenly(2539, 3)).toEqual([847, 846, 846])
    expect(splitEvenly(2539, 3).reduce((a, b) => a + b, 0)).toBe(2539)
    expect(splitEvenly(1000, 4)).toEqual([250, 250, 250, 250])
    expect(splitEvenly(5, 1)).toEqual([5])
  })
})

describe('cash', () => {
  test('change due, or null when short', () => {
    expect(changeDue(2539, 3000)).toBe(461)
    expect(changeDue(2539, 2539)).toBe(0)
    expect(changeDue(2539, 2000)).toBeNull()
  })
  test('quick cash buttons', () => {
    expect(quickCash(2539)).toEqual([2539, 2600, 3000, 4000, 5000])
    expect(quickCash(800)).toEqual([800, 1000, 2000, 5000, 10000])
  })
  test('formatMoney', () => {
    expect(formatMoney(2539)).toBe('$25.39'); expect(formatMoney(5)).toBe('$0.05'); expect(formatMoney(-461)).toBe('−$4.61')
  })
})
