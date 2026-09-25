import { describe, expect, test } from 'bun:test'
import { businessDayOf, dayWindow, summarizeDay, type DayCheck, type DayItem, type DayPayment } from './reports'

const TZ = 'America/Chicago'
const at = (iso: string) => new Date(iso)
const chk = (o: Partial<DayCheck>): DayCheck => ({ id: 'c', number: 1, kind: 'tab', label: 'x', status: 'paid', subtotalCents: 0, taxCents: 0, totalCents: 0, tipCents: 0, closedAt: at('2026-09-26T02:00:00Z'), closedBy: 'Jess', voidReason: null, ...o })

// Friday night, Sept 25 2026 (CDT, UTC-5)
const checks: DayCheck[] = [
  chk({ id: 'a', number: 11, kind: 'tab', label: 'Mike', subtotalCents: 879, taxCents: 48, totalCents: 927, tipCents: 200, closedAt: at('2026-09-26T01:10:00Z') }),      // 8:10 PM
  chk({ id: 'b', number: 12, kind: 'table', label: 'Booth 2', subtotalCents: 949, taxCents: 52, totalCents: 1001, tipCents: 0, closedAt: at('2026-09-26T01:40:00Z') }),  // 8:40 PM
  chk({ id: 'c', number: 13, kind: 'online', label: 'Web · Sam', subtotalCents: 1698, taxCents: 93, totalCents: 1791, tipCents: 0, closedAt: at('2026-09-26T06:20:00Z') }), // 1:20 AM
  chk({ id: 'd', number: 14, kind: 'walkup', label: 'Walk-up', status: 'void', voidReason: 'Walked out', closedBy: 'Dana' }),
]
const items: DayItem[] = [
  { checkId: 'a', name: 'Hamburger', size: 'Sandwich', qty: 1, unitPriceCents: 579, state: 'sent', voidReason: null, voidedBy: null },
  { checkId: 'a', name: 'Draft Root Beer', size: null, qty: 1, unitPriceCents: 300, state: 'sent', voidReason: null, voidedBy: null },
  { checkId: 'a', name: 'Hamburger', size: 'Platter', qty: 2, unitPriceCents: 729, state: 'void', voidReason: 'Rang in wrong', voidedBy: 'Jess' },
  { checkId: 'b', name: 'Fish Fry', size: null, qty: 1, unitPriceCents: 949, state: 'sent', voidReason: null, voidedBy: null },
  { checkId: 'c', name: 'Cheddarburger', size: 'Platter', qty: 2, unitPriceCents: 849, state: 'sent', voidReason: null, voidedBy: null },
]
const payments: DayPayment[] = [
  { checkId: 'a', tender: 'cash', amountCents: 500, tipCents: 0, takenBy: 'Jess', voidedAt: at('2026-09-26T01:05:00Z'), voidReason: 'wrong check (Jess)', takenAt: at('2026-09-26T01:00:00Z') },
  { checkId: 'a', tender: 'card_external', amountCents: 927, tipCents: 200, takenBy: 'Jess', voidedAt: null, voidReason: null, takenAt: at('2026-09-26T01:10:00Z') },
  { checkId: 'b', tender: 'cash', amountCents: 1001, tipCents: 150, takenBy: 'Dana', voidedAt: null, voidReason: null, takenAt: at('2026-09-26T01:40:00Z') },
  { checkId: 'c', tender: 'card_online', amountCents: 1791, tipCents: 0, takenBy: 'Website', voidedAt: null, voidReason: null, takenAt: at('2026-09-26T06:20:00Z') },
]
const s = summarizeDay('2026-09-25', TZ, checks, items, payments)

describe('summarizeDay', () => {
  test('sales from frozen check totals; voided checks excluded', () => {
    expect(s.checksPaid).toBe(3); expect(s.checksVoided).toBe(1)
    expect(s.subtotalCents).toBe(879 + 949 + 1698); expect(s.taxCents).toBe(48 + 52 + 93); expect(s.totalCents).toBe(927 + 1001 + 1791)
    expect(s.averageCheckCents).toBe(Math.round(3719 / 3))
  })
  test('by tender ignores voided payments', () => {
    expect(s.byTender).toEqual([
      { tender: 'card_online', label: 'Card (website)', count: 1, amountCents: 1791, tipsCents: 0 },
      { tender: 'cash', label: 'Cash', count: 1, amountCents: 1001, tipsCents: 150 },
      { tender: 'card_external', label: 'Card (Square reader)', count: 1, amountCents: 927, tipsCents: 200 },
    ])
  })
  test('tips per person, cash and card apart; the website earns none', () => {
    expect(s.tipsByStaff).toEqual([
      { who: 'Jess', count: 1, tipsCents: 200, cashTipsCents: 0, cardTipsCents: 200 },
      { who: 'Dana', count: 1, tipsCents: 150, cashTipsCents: 150, cardTipsCents: 0 },
    ])
  })
  test('channels, items, voids', () => {
    expect(s.byChannel.map(c => c.channel)).toEqual(['Website', 'Tables', 'Bar'])
    expect(s.items[0]).toEqual({ name: 'Cheddarburger (platter)', qty: 2, salesCents: 1698 })
    expect(s.items.some(i => i.name === 'Hamburger (platter)')).toBe(false)
    expect(s.voids.map(v => v.kind).sort()).toEqual(['check', 'item', 'payment'])
    expect(s.voids.find(v => v.kind === 'item')).toEqual({ kind: 'item', what: '2 × Hamburger (platter)', amountCents: 1458, reason: 'Rang in wrong', by: 'Jess', checkNumber: 11 })
  })
  test('cash in the drawer = cash sales + cash tips', () => {
    expect(s.cash).toEqual({ salesCents: 1001, tipsCents: 150, inCents: 1151 })
  })
  test('hours run the way the night does: 8 PM before 1 AM', () => {
    expect(s.byHour.map(h => h.label)).toEqual(['8 PM', '1 AM'])
    expect(s.byHour[0]).toEqual({ hour: 20, label: '8 PM', totalCents: 1928, checks: 2 })
  })
})

describe('business day', () => {
  test('1:20 AM belongs to the night before', () => {
    expect(businessDayOf(at('2026-09-26T06:20:00Z'), TZ)).toBe('2026-09-25')
    expect(businessDayOf(at('2026-09-26T11:30:00Z'), TZ)).toBe('2026-09-26')   // 6:30 AM
  })
  test('the window is 6 AM to 6 AM local', () => {
    const w = dayWindow('2026-09-25', TZ)
    expect(w.from.toISOString()).toBe('2026-09-25T11:00:00.000Z')
    expect(w.to.toISOString()).toBe('2026-09-26T11:00:00.000Z')
  })
})

describe('gift cards in the night', () => {
  // A $50 card and a $10 burger on one check; a second check paid partly off a card.
  const gcChecks: DayCheck[] = [
    chk({ id: 'g', number: 20, subtotalCents: 6000, taxCents: 55, totalCents: 6055, closedAt: at('2026-09-26T01:00:00Z') }),
    chk({ id: 'h', number: 21, subtotalCents: 1000, taxCents: 55, totalCents: 1055, closedAt: at('2026-09-26T01:30:00Z') }),
  ]
  const gcItems: DayItem[] = [
    { checkId: 'g', name: 'Gift card', size: null, qty: 1, unitPriceCents: 5000, state: 'sent', voidReason: null, voidedBy: null, kind: 'giftcard' },
    { checkId: 'g', name: 'Hamburger', size: null, qty: 1, unitPriceCents: 1000, state: 'sent', voidReason: null, voidedBy: null, kind: 'item' },
    { checkId: 'h', name: 'Hamburger', size: null, qty: 1, unitPriceCents: 1000, state: 'sent', voidReason: null, voidedBy: null, kind: 'item' },
  ]
  const gcPays: DayPayment[] = [
    { checkId: 'g', tender: 'cash', amountCents: 6055, tipCents: 0, takenBy: 'Jess', voidedAt: null, voidReason: null, takenAt: at('2026-09-26T01:00:00Z') },
    { checkId: 'h', tender: 'giftcard', amountCents: 1055, tipCents: 0, takenBy: 'Jess', voidedAt: null, voidReason: null, takenAt: at('2026-09-26T01:30:00Z') },
  ]
  const g = summarizeDay('2026-09-25', TZ, gcChecks, gcItems, gcPays)
  test('a card sold is not food and drink', () => {
    expect(g.subtotalCents).toBe(2000)
    expect(g.giftCardsSold).toEqual({ count: 1, cents: 5000 })
    expect(g.totalCents).toBe(7110)
    expect(g.items.find(i => i.name === 'Gift card')).toBeUndefined()
  })
  test('paying with a card shows as its own tender and is not cash', () => {
    expect(g.byTender.find(t => t.tender === 'giftcard')).toMatchObject({ label: 'Gift card', amountCents: 1055 })
    expect(g.cash.salesCents).toBe(6055)
  })
})
