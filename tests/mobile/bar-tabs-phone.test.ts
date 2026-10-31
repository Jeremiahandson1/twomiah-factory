// Card tabs with Tap to Pay on the phone, and Tap to Pay offline (restaurant-bar parity row 14). Nothing here needs a device:
// the screens are held to the owner's rule that a card is taken only by Stripe Terminal's SDK through the server, the doors
// to them are where the specs say, and the offline tap is kept on the phone's queue under the invoice's key.
//
//   bun run tests/mobile/bar-tabs-phone.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { specFor } from '../../apps/mobile/src/trades/specs.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const ROOT = path.resolve(import.meta.dir, '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const tabs = read('apps/mobile/app/(details)/bar-tabs.tsx')
check('the tabs screen exists and is gated on bar_tab_preauth, tap_to_pay and bar:register', /hasFeature\('bar_tab_preauth'\)/.test(tabs) && /hasFeature\('tap_to_pay'\)/.test(tabs) && /can\('bar:register'\)/.test(tabs))
check('the card is collected only by the Terminal SDK (processPaymentIntent), never typed', /processPaymentIntent/.test(tabs) && !/cardNumber|card_number|cvc/i.test(tabs))
check('the hold is made by the server and read back before it counts', /\/api\/food\/terminal\/tab\/phone/.test(tabs) && /\/authorized/.test(tabs))
check('closing and releasing use the ordinary tab routes', /\/api\/food\/terminal\/tab\/\$\{c\.tab\.id\}\/close/.test(tabs) && /\/release/.test(tabs))
check('the connection token is the shared Tap to Pay one', /\/api\/stripe\/tap-to-pay\/connection-token/.test(tabs))

const tonight = specFor('bar-tonight')!
const door = tonight.detail!.sections.find((s) => s.links)!
check('Tonight opens the tabs screen behind bar_tab_preauth', !!door && door.feature === 'bar_tab_preauth' && door.links!({}).some((l) => l.route === '/(details)/bar-tabs'))

const tap = read('apps/mobile/app/(details)/invoice/tap.tsx')
check('offline: with no signal the SDK makes the PaymentIntent on the phone with the metadata the server checks', /createPaymentIntent\(\{/.test(tap) && /offlineBehavior: 'force_offline'/.test(tap) && /kind: 'tap_to_pay'/.test(tap) && /company_id/.test(tap) && /invoice_id/.test(tap))
check('offline: the record is queued under the invoice\'s key with offline: true, so the server answers 425 until Stripe has it', /queued\.post\(/.test(tap) && /\{ offline: true \}/.test(tap) && /recordKey: `tap:\$\{invoiceId\}`/.test(tap))
check('offline: the SDK\'s forwarding is shown in words', /onDidForwardPaymentIntent/.test(tap) && /onDidReportForwardingError/.test(tap) && /onDidChangeOfflineStatus/.test(tap))
const server = read('packages/tenant-backend/src/payments/stripe.ts')
check('the server: an offline tap not yet at Stripe is 425 (retried), a wrong id stays 404', /425, 'not_yet_forwarded'/.test(server) && /'That payment was not found.', 404/.test(server))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
