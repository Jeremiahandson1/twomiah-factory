// The shell's feature gate for a typed URL (packages/tenant-ui/src/shell/routeGate.ts). One menu list serves every
// vertical, so an address can belong to several: home care's always-on Clients and the salon's client_profiles Clients
// are both /crm/clients, and the salon's entry — off for an agency — blocked the agency's own Clients page (and RV's
// Alerts blocked home care's), found in the browser, 2026-10-19.
import { describe, test, expect } from 'bun:test'
import { blockedRoute } from '@twomiah/tenant-ui/src/shell/routeGate'

const on = (...ids: string[]) => (f: string) => ids.includes(f)
const salonClients = { to: '/crm/clients', features: ['client_profiles'] }
const crmMarketing = { to: '/crm/marketing', features: ['email_marketing'] }
const rvFollowUp = { to: '/crm/marketing', features: ['follow_up_sequences'] }
const bookings = { to: '/crm/bookings', features: ['online_booking'] }

describe('the route gate', () => {
  test("a page some vertical has always on is not blocked by another vertical's gated entry at the same address", () => {
    expect(blockedRoute([salonClients], on(), new Set(['/crm/clients']))).toBe(null)
    expect(blockedRoute([salonClients], on(), new Set(['/crm/clients/:id']))).toEqual(salonClients)
  })

  test('without an always-on entry, a gated page with its feature off is blocked', () => {
    expect(blockedRoute([salonClients], on())).toEqual(salonClients)
    expect(blockedRoute([salonClients], on('client_profiles'))).toBe(null)
  })

  test('several gated entries at one address: any enabled feature opens it (RV T19 M6)', () => {
    expect(blockedRoute([crmMarketing, rvFollowUp], on('follow_up_sequences'))).toBe(null)
    expect(blockedRoute([crmMarketing, rvFollowUp], on())).toEqual(crmMarketing)
  })

  test('an always-on page under a switched-off module stays behind it (only the same address counts)', () => {
    // /crm/bookings/settings matched by the gated /crm/bookings; an always-on entry elsewhere does not open it.
    expect(blockedRoute([bookings], on(), new Set(['/crm/bookings/other']))).toEqual(bookings)
  })
})
