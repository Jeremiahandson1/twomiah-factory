// Landscaping parity row 24 on the phone: a snow stop's before/after photos (a contract may require both before the visit is
// logged), and salt logged by amount — asked only where the business has snow_tools (a box the server reads only then).
// Fails without the change: the stop had no photos link, the log had no amount, and an input could not follow a switch.
//
//   bun run tests/mobile/landscaping-snow-phone.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { LANDSCAPING } from '../../apps/mobile/src/trades/landscaping.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const snow = LANDSCAPING.find((s) => s.id === 'landscaping-snow')!
const stop = { id: 's1', jobId: 'j1', status: 'open', siteName: 'Elm Lot', address: '1 Elm' }
const log = snow.detail!.actions!.find((a) => a.id === 'log')!

const photos = snow.detail!.sections.find((s) => s.feature === 'photo_capture')
check('a snow stop opens its before and after photos (its own job)', photos?.links?.(stop)[0]?.route === '/(details)/visit-photos?jobId=j1')
check('…not on a skipped stop, nor one with no job', (photos?.links?.({ ...stop, status: 'skipped' }) || []).length === 0 && (photos?.links?.({ ...stop, jobId: null }) || []).length === 0)
const qty = log.inputs!.find((i) => i.id === 'saltQuantity')
check('the log asks the salt amount only where snow_tools is on', qty?.feature === 'snow_tools' && qty?.kind === 'number')
const withQty = log.request(stop, { pushes: '1', snowfall: '3', salt: 'yes', saltQuantity: '1.5' })
check('the amount is sent with the visit', withQty.body.saltQuantity === 1.5 && withQty.body.saltApplied === true, withQty.body)
check('…and left out when not given', !('saltQuantity' in log.request(stop, { pushes: '1', snowfall: '3', salt: 'no', saltQuantity: '' }).body))
const sheet = fs.readFileSync(path.resolve(import.meta.dir, '../../apps/mobile/src/trades/ActionSheet.tsx'), 'utf8')
check('the sheet leaves out an input whose switch is off', sheet.includes('!inp.feature || hasFeature(inp.feature)'))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
