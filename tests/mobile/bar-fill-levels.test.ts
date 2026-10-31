// Fill levels on the phone (restaurant-bar parity row 15, Backbar): any number of open bottles on a real slider, and weights for
// the scale, from the count action in apps/mobile/src/trades/bar.ts. Pure: the spec's request and the sheet's value helpers.
//
//   bun run tests/mobile/bar-fill-levels.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { specFor } from '../../apps/mobile/src/trades/specs.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const ROOT = path.resolve(import.meta.dir, '../..')

const count = specFor('bar-count')!
const save = count.detail!.actions!.find((a) => a.id === 'save-count')!
const fills = save.inputs!.find((i) => i.id === 'fills')!
check('the count offers any number of open bottles (kind levels), not three fixed fields', fills.kind === 'levels' && !save.inputs!.some((i) => i.id === 'fill1'))
check('and a weights field for the scale', save.inputs!.some((i) => i.id === 'weights'))
const r1 = save.request({ id: 's1' }, { packs: '2', units: '', fills: '[70, 100, 35]', weights: '' })
check('five bottles slid become fills as fractions', JSON.stringify(r1.body.fills) === '[0.7,1,0.35]' && r1.body.packs === 2 && r1.body.weightsGrams === undefined, r1.body)
const r2 = save.request({ id: 's1' }, { packs: '1', units: '0', fills: '[]', weights: '1000, 1500 480' })
check('weights typed with commas or spaces go as grams, one per bottle', JSON.stringify(r2.body.weightsGrams) === '[1000,1500,480]' && r2.body.fills === undefined, r2.body)
const r3 = save.request({ id: 's1' }, { packs: '1', units: '0', fills: 'garbage', weights: 'none' })
check('garbage sends neither fills nor weights', r3.body.fills === undefined && r3.body.weightsGrams === undefined, r3.body)
check('the save goes to the one count route', r1.path === '/api/stock/count/item' && r1.method === 'POST')

const sheet = fs.readFileSync(path.join(ROOT, 'apps/mobile/src/trades/ActionSheet.tsx'), 'utf8')
check('the sheet draws kind levels with a draggable slider per bottle (PanResponder), add and remove', /inp\.kind === 'levels'/.test(sheet) && /PanResponder\.create/.test(sheet) && /Add an open bottle/.test(sheet) && /onRemove/.test(sheet))
check('the slider is adjustable to a screen reader', /accessibilityRole="adjustable"/.test(sheet) && /accessibilityActions/.test(sheet))
check('no native slider module was added', !fs.existsSync(path.join(ROOT, 'apps/mobile/node_modules/@react-native-community/slider')) || !/@react-native-community\/slider/.test(fs.readFileSync(path.join(ROOT, 'apps/mobile/package.json'), 'utf8')))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
