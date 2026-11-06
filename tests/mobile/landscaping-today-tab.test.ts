// Landscaping parity row 32 (LMN Crew, Jobber: the crew's day is the home tab): a landscaping crew seat opens on Today's route, in
// the Dashboard's slot; office seats keep their bar; with the Route Board off nothing changes. The "home" link asks the same rule.
// Fails without the change: Today's route was only a row in More, and a tab could not take another's slot.
//
//   bun run tests/mobile/landscaping-today-tab.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { VERTICAL_TABS, VERTICAL_INITIAL_TAB, visibleTabs, firstTab } from '../../apps/mobile/src/vertical/verticals.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const tabs = VERTICAL_TABS.landscaping
const crewCan = (p: string) => ['jobs:read', 'contacts:read', 'dashboard:read'].includes(p)
const officeCan = () => true
const on = (f: string) => f === 'recurring_routes'
const off = () => false
const names = (field: boolean, can: (p: string) => boolean, has: (f: string) => boolean) => visibleTabs(tabs, can, has, field).map((t) => t.name)

const crew = names(true, crewCan, on)
check('a crew seat with the Route Board on: Today first, in the Dashboard’s slot, five slots, More last', crew[0] === 'land-route' && !crew.includes('dashboard') && crew.length === 5 && crew[4] === 'more', crew)
check('…and the app opens on it', firstTab(tabs, VERTICAL_INITIAL_TAB.landscaping, crewCan, on, true) === 'land-route')
check('an office seat keeps its bar (Dashboard first, no Today tab)', JSON.stringify(names(false, officeCan, on)) === JSON.stringify(['dashboard', 'jobs', 'schedule', 'contacts', 'more']), names(false, officeCan, on))
check('with the Route Board off the crew seat keeps the Dashboard', names(true, crewCan, off)[0] === 'dashboard' && !names(true, crewCan, off).includes('land-route'))
check('a seat without jobs:read gets no Today tab and keeps the Dashboard', !names(true, (p) => p === 'dashboard:read', on).includes('land-route') && names(true, (p) => p === 'dashboard:read', on).includes('dashboard'))
check('other verticals are untouched (no tab replaces another)', Object.entries(VERTICAL_TABS).filter(([v]) => v !== 'landscaping').every(([, ts]) => ts.every((t) => !t.replaces)))

const app = path.resolve(import.meta.dir, '../../apps/mobile')
check('the tab is a file and is in the layout’s list', fs.existsSync(path.join(app, 'app/(tabs)/land-route.tsx')) && fs.readFileSync(path.join(app, 'app/(tabs)/_layout.tsx'), 'utf8').includes("'land-route'"))
const home = fs.readFileSync(path.join(app, 'src/vertical/useHomeHref.ts'), 'utf8')
check('the home link passes the seat kind, as the tab bar does', home.includes('isFieldRole(user?.role)'))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
