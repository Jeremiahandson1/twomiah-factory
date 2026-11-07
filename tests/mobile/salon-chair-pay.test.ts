// Checkout at the chair on the phone (salon parity row 26; chair_checkout + tap_to_pay, hidden): the phone takes the tap itself.
//   · its arithmetic and words (src/payments/chairPay.ts): typed amounts to cents, the tip choices worked on the services, the refusal words;
//   · the visit's screen offers "Take payment on this phone" only on a finished visit, with the switch on, to a seat that may take a card;
//   · the screen (app/(details)/salon-pay.tsx) records nothing on its own word: it asks the server for the PaymentIntent and for Stripe's
//     answer, sends a decline back, and never posts a payment — read as source for that.
//
//   bun run tests/mobile/salon-chair-pay.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { centsOf, dollars, tipChoices, chargeWords, newKey } from '../../apps/mobile/src/payments/chairPay.ts'
import { SALON } from '../../apps/mobile/src/trades/salon.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
}
const ROOT = path.resolve(import.meta.dir, '../..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, 'apps/mobile', f), 'utf8')

check('typed amounts are cents', centsOf('45.5') === 4550 && centsOf('$1,200') === 120000 && centsOf('0.05') === 5 && Number.isNaN(centsOf('12.345')) && Number.isNaN(centsOf('abc')) && Number.isNaN(centsOf('')))
check('cents read as dollars', dollars(4550) === '$45.50' && dollars(0) === '$0.00')
check('tip choices from the server, a zero one left out', JSON.stringify(tipChoices({ suggestions: [{ percent: 18, cents: 1440 }, { percent: 20, cents: 1600 }, { percent: 15, cents: 0 }] })) === JSON.stringify([{ percent: 18, cents: 1440 }, { percent: 20, cents: 1600 }]) && tipChoices(null).length === 0)
check("the server's words first, then the phone's", chargeWords({ status: 'failed', failure: 'Your card was declined.' }, 'x') === 'Your card was declined.' && chargeWords({ status: 'timed_out' }).includes('too long') && chargeWords(null, 'Card removed') === 'Card removed')
check('a new key each attempt', newKey() !== newKey())

// The visit's screen: the link, when and to whom
const today = SALON.find((s) => s.id === 'salon-today')!
const pay = today.detail!.sections.find((s) => s.feature === 'tap_to_pay')
check('a section behind tap_to_pay, for a seat that may take a card', !!pay && JSON.stringify(pay!.any) === JSON.stringify(['invoices:update', 'cardreader:use']))
const links = (status: string) => pay!.links!({ id: 'a 1', status })
check('only a finished visit offers it, opening the pay screen for that visit', links('completed').length === 1 && links('completed')[0].route === '/(details)/salon-pay?appointmentId=a%201' && links('in_chair').length === 0 && links('scheduled').length === 0)
const detail = read('src/trades/TradeDetail.tsx')
check('the detail screen hides a section from a seat without its permission', detail.includes('(!s.any || s.any.some((p) => can(p)))'))
check('the screen is registered', read('app/(details)/_layout.tsx').includes("'salon-pay'"))

// The screen: Stripe's word only, through the server
const screen = read('app/(details)/salon-pay.tsx')
check('gated on chair_checkout, tap_to_pay and a card-taking permission', screen.includes("hasFeature('chair_checkout') && hasFeature('tap_to_pay') && (can('invoices:update') || can('cardreader:use'))"))
check('the PaymentIntent comes from the server, with the attempt key', screen.includes("post('/api/chair-checkout/phone/charges', { invoiceId: sale.invoiceId, amountCents: cents, tipCents, key: attempt.current })"))
check('the outcome is read from the server (Stripe), never recorded by the phone', screen.includes('/api/chair-checkout/charges/') && !/\/payments['`]/.test(screen) && !screen.includes('/record'))
check('a decline goes back to the server', screen.includes('/declined'))
check('a gift card takes its part through the gift card door', screen.includes("post('/api/salon-gift-cards/redeem', { code: gift.trim(), invoiceId: sale.invoiceId })"))
check('the connection token is the salon’s, from the chair checkout', screen.includes("post('/api/chair-checkout/phone/connection-token')"))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
