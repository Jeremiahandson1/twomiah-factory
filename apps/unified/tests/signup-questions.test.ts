// The signup's "few quick questions" follow the feature registry (apps/api config/signupQuestions.ts): "We take bookings"
// is asked — and kept — only where the industry's system has online booking; "take payments online" only where it has
// online invoice payments. Live test 2026-10-22: home care and roofing were not asked and nothing said why, while an RV
// dealer, a restaurant, a bar and a shop were asked about a booking system theirs does not have.
import { describe, test, expect } from 'bun:test'
import { signupQuestionsFor, signupChoices } from '../../api/src/config/signupQuestions.ts'
// The Factory's build module, loaded at run time: it reaches the whole Factory (its generator), which this app's
// type-check (scripts/check-unified-types.ts) would otherwise take in as the app's own files.
const FACTORY = '../../api/src/unified/factory.ts'
const { takesBookings } = (await import(FACTORY)) as { takesBookings: (tenant: any) => boolean }

// What the signup pages hide (twomiah-website signup.html ASK_HIDDEN_FOR), written from this rule — checked here so the
// two cannot drift without a failing test.
const SIGNUP_PAGE_HIDES = {
  bookings: ['home_care', 'roofing', 'dispensary', 'rv', 'restaurant', 'bar_and_grill', 'retail'],
  online_payments: ['roofing', 'dispensary', 'retail'],
}
const SIGNUP_INDUSTRIES = ['general_contractor', 'remodeler', 'roofing', 'hvac', 'plumbing', 'electrical', 'landscaping', 'painter', 'concrete', 'flooring',
  'home_care', 'veterinary', 'dispensary', 'rv', 'food_truck', 'restaurant', 'bar_and_grill', 'salon', 'fitness', 'retail', 'other']

describe('which signup questions a business is asked', () => {
  test('the signup page hides exactly the questions the registry says a trade has no feature for', () => {
    for (const ind of SIGNUP_INDUSTRIES) {
      const q = signupQuestionsFor(ind)
      expect([ind, q.bookings]).toEqual([ind, !SIGNUP_PAGE_HIDES.bookings.includes(ind)])
      expect([ind, q.online_payments]).toEqual([ind, !SIGNUP_PAGE_HIDES.online_payments.includes(ind)])
      expect(q.texting).toBe(true)
    }
  })

  test("an answer to a question the trade isn't asked is dropped, whoever sent it", () => {
    expect(signupChoices({ industry: 'roofing', goals: ['bookings', 'online_payments'], addons: ['texting'] })).toEqual({ goals: [], addons: ['texting'] })
    expect(signupChoices({ industry: 'home_care', goals: ['bookings', 'online_payments'] })).toEqual({ goals: ['online_payments'], addons: [] })
    expect(signupChoices({ industry: 'hvac', goals: ['BOOKINGS', 'bookings', 'nonsense'], addons: ['texting', 'free_money'] })).toEqual({ goals: ['bookings'], addons: ['texting'] })
  })

  test('the build starts something bookable only where the system books', () => {
    const asked = { intake_data: { signup: { goals: ['bookings'] } } }
    expect(takesBookings({ ...asked, industry: 'hvac' })).toBe(true)
    expect(takesBookings({ ...asked, industry: 'salon' })).toBe(true)
    expect(takesBookings({ ...asked, industry: 'roofing' })).toBe(false)
    expect(takesBookings({ ...asked, industry: 'rv' })).toBe(false)
    expect(takesBookings({ industry: 'hvac', intake_data: { signup: { goals: [] } } })).toBe(false)
  })
})
