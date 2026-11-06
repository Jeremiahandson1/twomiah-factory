// Roofing parity row 23 on the phone: the canvass screen tells a rep knocking outside their own territory (Spotio), from
// GET /api/territories/locate, only where territory_tools is on — never blocking the door.
//
//   bun run tests/mobile/roof-territory-notice.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { territoryNotice } from '../../apps/mobile/src/canvass/territoryNotice.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
check('inside their own: nothing said', territoryNotice({ inside: [{ name: 'North' }], inMine: true, hasTerritory: true }) === null)
check('no territory of their own: nothing said', territoryNotice({ inside: [], inMine: false, hasTerritory: false }) === null)
check('in another’s: named', territoryNotice({ inside: [{ name: 'East' }], inMine: false, hasTerritory: true }) === 'You are outside your territory — this is East.')
check('in none: said plainly', territoryNotice({ inside: [], inMine: false, hasTerritory: true }) === 'You are outside your territory.')
check('no answer: nothing said', territoryNotice(null) === null)
const screen = fs.readFileSync(path.resolve(import.meta.dir, '../../apps/mobile/app/(tabs)/canvass.tsx'), 'utf8')
check('the screen asks /locate after each location, behind the switch', screen.includes('/api/territories/locate?lat=') && screen.includes("hasFeature('territory_tools')") && (screen.match(/void checkTerritory\(loc\)/g) || []).length === 2)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
