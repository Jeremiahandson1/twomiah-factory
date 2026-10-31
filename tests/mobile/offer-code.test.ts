// An offer code at the sale on the phone (salon parity row 20): the rules the invoice screen follows (apps/mobile/src/forms/offerCode.ts) and
// the screen using them. The server's own checks (whose code, unspent, in date, how much) are apps/unified/tests/salon-offers.test.ts; nothing
// here needs a device.
//
//   bun run tests/mobile/offer-code.test.ts
import fs from 'node:fs'
import { canOfferCode, offerCodeTyped, offerQuestion } from '../../apps/mobile/src/forms/offerCode.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}

check('a typed code is upper case with no spaces', offerCodeTyped(' bday-7kq 2mx ') === 'BDAY-7KQ2MX')
check('nothing typed sends nothing', offerCodeTyped('   ') === null && offerCodeTyped('') === null)
check('two letters is not a code', offerCodeTyped('ab') === null)
check('the box is offered on an open sale to a seat that may change it, with the feature on', canOfferCode({ feature: true, mayUpdate: true, status: 'sent' }) === true)
check('not with the feature off', canOfferCode({ feature: false, mayUpdate: true, status: 'sent' }) === false)
check('not to a seat that may not change the sale', canOfferCode({ feature: true, mayUpdate: false, status: 'sent' }) === false)
for (const status of ['paid', 'void', 'refunded']) check(`not on a ${status} sale`, canOfferCode({ feature: true, mayUpdate: true, status }) === false)
check('the question says what it is and what it takes off', offerQuestion({ words: '$10 off', discount: 10 }) === '$10 off: $10.00 comes off this sale. A code can only be used once.')
check('and when the sale is smaller than the offer', offerQuestion({ words: '$50 off', discount: 8, cappedAtSale: true }).includes('(all that is left on it)'))

const screen = fs.readFileSync('apps/mobile/app/(details)/invoice/[id].tsx', 'utf8')
check('the invoice screen asks the server to preview, then to redeem', screen.includes("/api/retention-offers/redeem") && screen.includes('preview: true') && screen.includes('canOfferCode(') && screen.includes('offerQuestion('))
check('the box is salon-only and behind the feature', screen.includes("vertical === 'salon'") && screen.includes("hasFeature('retention_sends')"))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
