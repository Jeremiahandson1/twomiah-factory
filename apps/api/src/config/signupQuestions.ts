// "A few quick questions" on the signup (twomiah.com/signup, Plan & Billing): which of them a business is asked, and
// which answers the Factory keeps. ONE rule, read from the feature registry by the CRM the industry is built on — a
// question is asked only where its feature exists:
//   · "We take bookings or appointments" → online_booking;
//   · "We want to take payments online"  → online_payments;
//   · "We want to text our customers"    → every system (texting is the business's own number, Settings › Texting).
// The signup pages hide a question by the same rule (their ASK_HIDDEN_FOR, written from this). Live test 2026-10-22: home
// care and roofing were not asked about bookings and nothing said why, while an RV dealer, a restaurant, a bar and a
// shop were asked about a booking system theirs does not have — and a "yes" started one anyway.
import { crmTemplateFor } from './industryRouting'
import { getFeaturesForTemplate } from './featureRegistry'

export interface SignupQuestions { bookings: boolean; online_payments: boolean; texting: boolean }

/** The questions this industry's signup asks. */
export function signupQuestionsFor(industry: string | null | undefined): SignupQuestions {
  const offered = new Set(getFeaturesForTemplate(crmTemplateFor(industry)).filter((f) => !f.hidden).map((f) => f.id))
  return { bookings: offered.has('online_booking'), online_payments: offered.has('online_payments'), texting: true }
}

const SIGNUP_GOALS = ['bookings', 'online_payments'] as const
const SIGNUP_ADDONS = ['texting'] as const

/**
 * What a signup asked for beyond the plan, kept to known values AND to the questions this industry is asked — an answer
 * to a question its system has no feature for is dropped, whoever sent it. Goals change setup ("bookings" → the app
 * starts with something bookable); add-ons are paid ("texting" → the $10/mo checkout after the plan).
 */
export function signupChoices(body: any): { goals: string[]; addons: string[] } {
  const asked = signupQuestionsFor(body?.industry)
  const pick = (v: unknown, allowed: readonly string[]) =>
    (Array.isArray(v) ? v : []).map((x) => String(x || '').trim().toLowerCase())
      .filter((x, i, a) => allowed.includes(x) && a.indexOf(x) === i && asked[x as keyof SignupQuestions] === true)
  return { goals: pick(body?.goals, SIGNUP_GOALS), addons: pick(body?.addons, SIGNUP_ADDONS) }
}
