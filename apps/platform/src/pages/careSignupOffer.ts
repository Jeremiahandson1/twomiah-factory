// What the care sign-up page promises about paying, in one place so the words and the code path can be checked against each other
// (tests/unified/factory/care-signup-offer.test.ts). The truth, from the Factory (routes/factory/intake.ts, services/factoryStripe.ts):
//   · signup creates the account "awaiting payment" and sends the customer to Stripe Checkout — the card is taken THERE;
//   · that checkout is created with no trial (no trialDays), so the first month is charged at checkout;
//   · nothing is built until the payment goes through; the offer is a 30-day money-back guarantee (a refund), not a free trial.
export const CARE_OFFER = {
  guaranteeDays: 30,
  /** No free trial: the first payment is taken at checkout. */
  trial: false,
  /** The card is entered (on Stripe) before anything is built. */
  cardAtCheckout: true,
} as const

export const GUARANTEE = `${CARE_OFFER.guaranteeDays}-day money-back guarantee`
export const TRUST_BAR_OFFER = GUARANTEE
export const PLAN_STEP_NOTE = `Every plan includes every standard feature. You pay when you check out, and every plan has a ${GUARANTEE}.`
export const REVIEW_TITLE = 'Review & start your subscription'
export const REVIEW_NOTE = `Next you enter your card on our payment page and the first month is charged then. ${GUARANTEE[0].toUpperCase()}${GUARANTEE.slice(1)}. Cancel anytime.`
export const TOTAL_LABEL = 'Monthly total'
export const DUE_LABEL = 'Charged at checkout'
export const SUBMIT_LABEL = 'Continue to payment'
export const FOOTER_OFFER = GUARANTEE[0].toUpperCase() + GUARANTEE.slice(1)
