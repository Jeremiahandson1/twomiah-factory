// What a no-show or late-cancel fee comes to (server/crm/salon/cardFees.ts; salon parity row 4): a service's own fee over the salon's,
// the new-client fee over the regular one, and no fee under the minimum booking value. Whole cents; no server.
import { describe, test, expect } from 'bun:test'
import { resolveFee, NO_FEE, type FeeInput } from '../server/crm/salon/cardFees.ts'

const salon = { cents: 2000, percent: null }
const base = (over: Partial<FeeInput> = {}): FeeInput => ({ salon, salonNew: NO_FEE, isNewClient: false, minValueCents: null, lines: [{ priceCents: 5000, own: null }], ...over })

describe('card policy fees', () => {
  test("the salon's flat fee, or its percent of the price", () => {
    expect(resolveFee(base(), 'no-show')).toEqual({ cents: 2000, basis: 'salon' })
    expect(resolveFee(base({ salon: { cents: null, percent: 50 } }), 'no-show').cents).toBe(2500)
    expect(resolveFee(base({ salon: { cents: null, percent: 33 }, lines: [{ priceCents: 4999, own: null }] }), 'no-show').cents).toBe(1650)   // 1649.67 → 1650
  })

  test('a percent of nothing is refused in words, and so is no fee at all', () => {
    const r = resolveFee(base({ salon: { cents: null, percent: 50 }, lines: [{ priceCents: 0, own: null }] }), 'no-show')
    expect([r.cents, r.why]).toEqual([null, 'This appointment has no price to take a percent of.'])
    expect(resolveFee(base({ salon: NO_FEE }), 'late-cancel').why).toBe('No late-cancel fee is set. Set it under Settings › Card on file.')
  })

  test("a service's own fee beats the salon's, flat or percent", () => {
    expect(resolveFee(base({ lines: [{ priceCents: 12000, own: { cents: 5000, percent: null } }] }), 'no-show')).toEqual({ cents: 5000, basis: 'service' })
    expect(resolveFee(base({ lines: [{ priceCents: 12000, own: { cents: null, percent: 25 } }] }), 'no-show').cents).toBe(3000)
    // a service with an own fee works even when the salon set none
    expect(resolveFee(base({ salon: NO_FEE, lines: [{ priceCents: 12000, own: { cents: 4000, percent: null } }] }), 'no-show').cents).toBe(4000)
  })

  test('a new client pays the new-client fee when the salon set one; a returning client the regular fee', () => {
    const salonNew = { cents: 4000, percent: null }
    expect(resolveFee(base({ salonNew, isNewClient: true }), 'no-show')).toEqual({ cents: 4000, basis: 'new_client' })
    expect(resolveFee(base({ salonNew, isNewClient: false }), 'no-show').cents).toBe(2000)
    // no new-client fee set: a new client pays the regular one
    expect(resolveFee(base({ isNewClient: true }), 'no-show').cents).toBe(2000)
    // the service's own fee is the same for new and returning
    expect(resolveFee(base({ salonNew, isNewClient: true, lines: [{ priceCents: 9000, own: { cents: 1500, percent: null } }] }), 'no-show').cents).toBe(1500)
    // a new-client fee alone (no regular fee) still applies to new clients only
    expect(resolveFee(base({ salon: NO_FEE, salonNew, isNewClient: true }), 'no-show').cents).toBe(4000)
    expect(resolveFee(base({ salon: NO_FEE, salonNew, isNewClient: false }), 'no-show').why).toContain('No no-show fee is set')
  })

  test('a booking under the minimum value owes nothing; at the minimum it owes the fee', () => {
    const under = resolveFee(base({ minValueCents: 6000 }), 'no-show')
    expect([under.cents, under.why]).toEqual([null, 'This booking is worth $50, under the $60 minimum, so no no-show fee applies.'])
    expect(resolveFee(base({ minValueCents: 5000 }), 'no-show').cents).toBe(2000)
    // the minimum looks at the whole visit
    expect(resolveFee(base({ minValueCents: 6000, lines: [{ priceCents: 3000, own: null }, { priceCents: 3000, own: null }] }), 'no-show').cents).toBe(2000)
  })

  test('a visit of several services: own fees add, the salon flat fee counts once, the salon percent is taken of the rest', () => {
    const lines = [{ priceCents: 8000, own: { cents: 3000, percent: null } }, { priceCents: 4000, own: null }, { priceCents: 2000, own: null }]
    expect(resolveFee(base({ lines }), 'no-show')).toEqual({ cents: 5000, basis: 'mixed' })   // 3000 + 2000 once
    expect(resolveFee(base({ salon: { cents: null, percent: 50 }, lines }), 'no-show').cents).toBe(6000)   // 3000 + 50% of 6000
    expect(resolveFee(base({ lines: [{ priceCents: 4000, own: null }, { priceCents: 2000, own: null }] }), 'no-show').cents).toBe(2000)
  })
})
