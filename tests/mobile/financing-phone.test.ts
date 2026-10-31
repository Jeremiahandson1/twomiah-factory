// Customer financing on the phone (consumer_financing, hidden; parity brief item 11): the phone ONLY opens the lender's page.
//   · it asks the server for the application on a quote or invoice and opens the https page the answer names — nothing else;
//   · it is offered only to a seat with financing:create, with the business's switch on, on a document still open;
//   · it shows no payment, APR or term (the lender's trigger terms: the desktop screens carry its disclosure), takes no card
//     and records nothing — the two screens that offer it, and its helper, are read as source for that.
//
//   bun run tests/mobile/financing-phone.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { financingPath, lenderPage, mayOfferFinancing } from '../../apps/mobile/src/payments/financingRules.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
}
const ROOT = path.resolve(import.meta.dir, '../..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, 'apps/mobile', f), 'utf8')

check('a quote and an invoice each have their door', financingPath('quote', 'q 1') === '/api/financing/quotes/q%201/applications' && financingPath('invoice', 'i9') === '/api/financing/invoices/i9/applications')

const can = (list: string[]) => (p: string) => list.includes(p)
const has = (list: string[]) => (f: string) => list.includes(f)
check('offered to a seat with financing:create, switch on, document open', mayOfferFinancing(can(['financing:create']), has(['consumer_financing']), true))
check('not without the permission', !mayOfferFinancing(can(['quotes:update']), has(['consumer_financing']), true))
check('not with the switch off', !mayOfferFinancing(can(['financing:create']), has([]), true))
check('not on a closed document', !mayOfferFinancing(can(['financing:create']), has(['consumer_financing']), false))

check('the lender page is the https address the server names', lenderPage({ applicationUrl: 'https://wisetack.us/#/abc/prequalify' }) === 'https://wisetack.us/#/abc/prequalify')
check('…or the partner link when that is what came back', lenderPage({ applyUrl: 'https://pay.example.test/apply/1' }) === 'https://pay.example.test/apply/1')
check('never http, a script, or nothing', lenderPage({ applicationUrl: 'http://wisetack.us/x' }) === null && lenderPage({ applicationUrl: 'javascript:alert(1)' }) === null && lenderPage({}) === null && lenderPage(null) === null)

const helper = read('src/payments/financing.ts') + read('src/payments/financingRules.ts')
const screens = [read('app/(details)/invoice/[id].tsx'), read('app/(details)/quote/[id].tsx')]
check('both screens offer it through the helper', screens.every((s) => s.includes('openLenderPage') && s.includes('mayOfferFinancing')))
check('the helper opens the page and does nothing else with the lender (no card, no payment recorded)', /Linking\.openURL/.test(helper) && !/\/payments|tipAmount|terminal|createPaymentIntent/i.test(helper))
const TRIGGER = /\/\s?mo\b|per month|\bAPR\b|monthly payment|asLowAs|termMonths/
check('no loan terms on the phone', !TRIGGER.test(helper) && screens.every((s) => !/financ/i.test(s) || !TRIGGER.test(s.split('\n').filter((l) => /financ/i.test(l)).join('\n'))))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
