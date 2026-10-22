// The signup's "We take bookings" reaches the unified app's first setup (live test 2026-10-22): the provision body says
// so, from the signup's goals or the intake's, by the same rule that gives the site its booking sections.
import { test, expect, describe } from 'bun:test'
import { provisionBody, takesBookings } from '../../../apps/api/src/unified/factory'
import { provisionSchema } from '../../../apps/unified/server/modules/provision'

const HASH = '$2b$04$' + 'a'.repeat(53)
const tenant = (intake_data: unknown) => ({
  id: 't1', slug: 'hudson-plumbing', name: 'Hudson Plumbing', industry: 'Plumbing', email: 'office@hudson.example', admin_email: 'owner@hudson.example',
  state: 'NY', products: ['crm'], features: [], intake_data,
})

describe('takesBookings', () => {
  test('the signup checkbox (goals: bookings) and an intake that asks for appointments say yes', () => {
    expect(takesBookings(tenant({ signup: { goals: ['bookings'] } }))).toBe(true)
    expect(takesBookings(tenant({ intake: { goals: ['Online appointments'] } }))).toBe(true)
  })

  test('no answer, or another goal, says no', () => {
    expect(takesBookings(tenant(null))).toBe(false)
    expect(takesBookings(tenant({ signup: { goals: ['online_payments'] } }))).toBe(false)
  })

  test('the provision body carries it, and the app’s provision schema accepts it', () => {
    const yes: any = provisionBody(tenant({ signup: { goals: ['bookings'] } }), { company: { plan: 'starter' } }, HASH)
    const no: any = provisionBody(tenant({}), { company: { plan: 'starter' } }, HASH)
    expect(yes.takesBookings).toBe(true)
    expect(no.takesBookings).toBe(false)
    const parsed = provisionSchema.safeParse(yes)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.takesBookings).toBe(true)
  })
})
