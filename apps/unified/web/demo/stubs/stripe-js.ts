// The demo build's stand-in for @stripe/stripe-js. The real package loads Stripe's script from Stripe's own address; the demo
// takes no payments, so it loads nothing and the Stripe address is not in the build at all (tests/demo/outbound.test.ts).
export type Stripe = Record<string, never>
export const loadStripe = async (..._args: unknown[]): Promise<Stripe | null> => null
