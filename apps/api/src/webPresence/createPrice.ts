/**
 * Makes the $19/month "Web presence" price in Stripe and prints the env line the Factory reads (STRIPE_PRICE_WEB_PRESENCE).
 *
 *   STRIPE_SECRET_KEY=sk_test_… bun run src/webPresence/createPrice.ts
 *
 * It uses whatever key it is given and says which mode that is. A live key (sk_live_…) is refused unless --live is passed: the
 * live price is the owner's to create. Running it twice makes a second product, so it first looks for one it made (metadata
 * twomiah_plan=webpresence) and reuses its active $19 monthly price.
 */
import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY || ''
if (!key) { console.error('Set STRIPE_SECRET_KEY.'); process.exit(1) }
const live = key.startsWith('sk_live_') || key.startsWith('rk_live_')
if (live && !process.argv.includes('--live')) { console.error('That is a LIVE key. The live price is the owner\'s to create; pass --live to do it on purpose.'); process.exit(1) }
const stripe = new Stripe(key)

const found = await stripe.products.search({ query: "metadata['twomiah_plan']:'webpresence' AND active:'true'" })
const product = found.data[0] ?? await stripe.products.create({ name: 'Web presence', description: 'A one-page website with lead capture.', metadata: { twomiah_plan: 'webpresence' } })
const prices = await stripe.prices.list({ product: product.id, active: true, limit: 20 })
const price = prices.data.find((p) => p.unit_amount === 1900 && p.currency === 'usd' && p.recurring?.interval === 'month')
  ?? await stripe.prices.create({ product: product.id, unit_amount: 1900, currency: 'usd', recurring: { interval: 'month' }, metadata: { twomiah_plan: 'webpresence' } })
console.log('Stripe mode: ' + (live ? 'LIVE' : 'TEST'))
console.log('STRIPE_PRICE_WEB_PRESENCE=' + price.id)
