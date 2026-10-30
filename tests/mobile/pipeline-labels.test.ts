// The phone shows the company's own pipeline stage names (roofing depth, gap 8) — display names over the same stage keys.
//
//   bun run tests/mobile/pipeline-labels.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { parseNames, stageName, boardOf } from '../../apps/mobile/src/pipeline/labels.ts'
import { roofStages } from '../../apps/mobile/src/home/tiles.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
}

// What GET /api/roof-pipeline answers (server/crm/roof/pipeline.ts describePipeline).
const reply = {
  stageLabels: { invoiced: 'Billed', collected: 'Paid in full' },
  boards: [
    { id: 'retail', name: 'Retail', stageLabels: { invoiced: 'Billed', collected: 'Paid in full' } },
    { id: 'insurance', name: 'Claims', stageLabels: { invoiced: 'Billed', collected: 'Claim paid' } },
  ],
}
const names = parseNames(reply)
check('a good reply is read', !!names && names.boards.length === 2)
check('junk is not a reply (the screens keep the standard words)', parseNames(null) === null && parseNames({}) === null && parseNames('x') === null && parseNames({ stageLabels: {}, boards: 'no' }) === null)
check('a company name shows for a stage', stageName(names, 'invoiced') === 'Billed')
check('an insurance job uses the Claims board name', stageName(names, 'collected', 'insurance') === 'Claim paid')
check('a retail job uses the company name', stageName(names, 'collected', 'retail') === 'Paid in full' && stageName(names, 'collected', 'repair') === 'Paid in full')
check('a stage with no name gives nothing, so the screen keeps its own words', stageName(names, 'lead') === undefined && stageName(null, 'invoiced') === undefined)
check('only insurance jobs are on the Insurance board', boardOf('insurance') === 'insurance' && boardOf('retail') === 'retail' && boardOf(null) === 'retail')

// The home stage rows use the names, and keep the stage ids the taps filter on.
const stats = { jobs: { byStatus: { invoiced: 2, collected: 1 } } }
const stock = roofStages(stats, () => true)
const renamed = roofStages(stats, () => true, (s) => stageName(names, s))
check('home stage rows keep the same stage ids', JSON.stringify(stock.map((s) => s.id)) === JSON.stringify(renamed.map((s) => s.id)), { stock, renamed })
check('home stage rows show the renamed labels', renamed.find((s) => s.id === 'invoiced')?.label === 'Billed' && renamed.find((s) => s.id === 'invoiced')?.count === 2 &&stock.find((s) => s.id === 'invoiced')?.label !== 'Billed')

// The screens read the one hook and never decide anything by a name; nothing under src/offline is touched.
const root = path.resolve(import.meta.dir, '../../apps/mobile')
for (const f of ['app/(tabs)/pipeline.tsx', 'app/(tabs)/jobs.tsx', 'app/(tabs)/schedule.tsx', 'app/(details)/job/[id].tsx', 'app/(details)/contact/[id].tsx', 'src/home/HomeScreen.tsx']) {
  check(`${f} reads the company's stage names`, fs.readFileSync(path.join(root, f), 'utf8').includes('useStageName'))
}
check('the hook asks the desktop\'s own route', fs.readFileSync(path.join(root, 'src/pipeline/useStageName.ts'), 'utf8').includes("'/api/roof-pipeline'"))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
