// PR #173 follow-up, fix 1: the care sign-up page says exactly what the signup does. The code (routes/factory/intake.ts,
// services/factoryStripe.ts): signup sends the customer to Stripe Checkout, which takes the card and charges the first month — no
// trial is passed — and nothing is built until that payment. The offer is a 30-day money-back guarantee, not a free trial.
// NOTE: the code-path half reads the source (like signup-site.test.ts does); Stripe itself is never called from a test.
import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')
const offer = await import('../../../apps/platform/src/pages/careSignupOffer.ts')
const intake = read('apps/api/src/routes/factory/intake.ts')
const stripeSrc = read('apps/api/src/services/factoryStripe.ts')
const signupRoute = intake.slice(intake.indexOf("factory.post('/public/signup'"), intake.indexOf("factory.get('/public/signup/:id/next'"))

describe('what the signup does', () => {
  const call = signupRoute.slice(signupRoute.indexOf('factoryStripe.createSubscriptionCheckout('))
  const args = call.slice(0, call.indexOf('checkoutUrl = checkout.url'))

  test('it sends the customer to a Stripe subscription checkout, and passes no trial', () => {
    expect(signupRoute.includes('factoryStripe.createSubscriptionCheckout(')).toBe(true)
    expect(args).not.toMatch(/trialDays/)
    expect(args).not.toMatch(/trial_period_days/)
  })

  test('the checkout adds a trial only when one is passed in', () => {
    expect(stripeSrc).toMatch(/\.\.\.\(trialDays > 0 \? \{ trial_period_days: trialDays \} : \{\}\)/)
    expect(stripeSrc).toMatch(/const \{ planId = 'starter', billingCycle = 'monthly', trialDays = 0 \} = options/)
  })

  test('nothing is built before payment: deploy is started by the payment webhook, not the signup request', () => {
    expect(signupRoute.includes('NOTHING is deployed until Stripe checkout completes')).toBe(true)
    // the only deploy in the signup request is the race case where the customer had ALREADY paid
    const calls = signupRoute.split('triggerAutoDeploy(').length - 1
    expect(calls).toBe(1)
    const before = signupRoute.slice(0, signupRoute.indexOf('triggerAutoDeploy('))
    expect(before.slice(before.lastIndexOf('if (')).startsWith('if (alreadyPaid && !fresh?.render_frontend_url)')).toBe(true)
  })

  test('the page promise mirrors it: no trial, card at checkout, a 30-day guarantee', () => {
    expect(offer.CARE_OFFER).toEqual({ guaranteeDays: 30, trial: false, cardAtCheckout: true })
  })
})

describe('what the care page says', () => {
  const page = read('apps/platform/src/pages/CareSignupPage.tsx')
  const careFiles = readdirSync(path.join(ROOT, 'apps/platform/src/pages')).filter((f) => /^Care.*\.(tsx|ts)$/.test(f))
  const words = Object.values(offer).filter((v) => typeof v === 'string').join(' | ')

  test('no care sign-up file promises a free trial, free days, "no credit card" or $0 due today', () => {
    for (const f of careFiles) {
      const src = read('apps/platform/src/pages/' + f)
      expect(src.toLowerCase()).not.toContain('free trial')
      expect(src.toLowerCase()).not.toContain('credit card')
      expect(src).not.toMatch(/\d+ days free/i)
      expect(src).not.toMatch(/After trial/)
      expect(src).not.toMatch(/Due today/)
      expect(src).not.toContain('$0.00')
    }
  })

  test('it says the money-back guarantee, at the plan step, on the review step and in the trust bar', () => {
    expect(offer.TRUST_BAR_OFFER).toBe('30-day money-back guarantee')
    expect(offer.PLAN_STEP_NOTE).toContain('30-day money-back guarantee')
    expect(offer.REVIEW_NOTE).toContain('30-day money-back guarantee')
    expect(offer.REVIEW_NOTE).toContain('enter your card')
    for (const name of ['TRUST_BAR_OFFER', 'PLAN_STEP_NOTE', 'REVIEW_NOTE', 'FOOTER_OFFER', 'REVIEW_TITLE', 'DUE_LABEL', 'SUBMIT_LABEL']) expect(page).toContain(`{${name}}`)
  })

  test('none of its words promise a trial', () => {
    expect(words.toLowerCase()).not.toContain('trial')
    expect(offer.SUBMIT_LABEL).toBe('Continue to payment')
  })

  test('what is charged at checkout is the plan price, not $0', () => {
    expect(page).toMatch(/\{DUE_LABEL\}<\/span>\s*<span[^>]*>\$\{price\}<\/span>/)
  })
})
