// The mock-ups show what the map says: each home's tiles are the desktop dashboard's tiles for that trade and seat, the More menus
// list exactly the menu items that seat is given, and the design system's pieces keep the accessibility floors.
//
//   bun run tests/mobile/design-preview.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { TILES, CARE_ATTENTION } from '../../apps/mobile/src/design/preview/sample.ts'
import { MORE_OWNER, MORE_STAFF } from '../../apps/mobile/src/design/preview/moreData.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
}
const ROOT = path.resolve(import.meta.dir, '../..')
const md = fs.readFileSync(path.join(ROOT, 'docs/mobile/PARITY.md'), 'utf8')
const section = (trade: string) => md.split('\n## ').find((x) => x.split('\n')[0].includes(`(\`${trade}\``)) || ''
const cells = (l: string) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())

// Tiles per seat = the map's tiles per seat (labels, in order, before the arrow).
const mapTiles = (trade: string, seat: string): string[] => {
  const m = new RegExp(`- \\*\\*${seat}\\*\\* \\(\\d+\\): (.*)`).exec(section(trade))
  return m ? m[1].split('; ').map((t) => t.split(' → ')[0].trim()) : []
}
for (const [trade, seat, key] of [['contractor', 'owner', 'owner'], ['contractor', 'manager', 'manager'], ['contractor', 'staff', 'staff'], ['homecare', 'staff', 'staff']] as const) {
  const mine = TILES[trade][key].map((t) => t.label)
  check(`${trade} ${seat}: the home's tiles are the map's (${mine.length})`, JSON.stringify(mine) === JSON.stringify(mapTiles(trade, seat)), { mine, map: mapTiles(trade, seat) })
}
for (const seat of ['owner', 'manager'] as const) {
  const map = mapTiles('homecare', seat), tiles = TILES.homecare[seat].map((t) => t.label)
  const panels = CARE_ATTENTION.length
  check(`homecare ${seat}: stat tiles + the attention panel cover the map's ${map.length} items`, map.length === tiles.length + panels && tiles.every((t) => map.includes(t)), { tiles, map })
}
check('the three contractor seats have the counts the desktop gives them (6, 6, 2)', TILES.contractor.owner.length === 6 && TILES.contractor.manager.length === 6 && TILES.contractor.staff.length === 2)

// More menus: each entry is a map row, and the seat lists equal the map's Seats column.
const rows = section('contractor').split('\n').filter((l) => /^\| [^|]* \| [^|]* \| `\/crm\//.test(l)).map(cells)
const byPath = new Map(rows.map((c) => [c[2].replace(/`/g, ''), c]))
check('every More entry is a contractor menu row of the map', [...MORE_OWNER, ...MORE_STAFF].every((i) => byPath.has(i.path) && byPath.get(i.path)![1] === i.label), [...MORE_OWNER, ...MORE_STAFF].filter((i) => !byPath.has(i.path)))
const seatSet = (pred: (seats: string) => boolean) => rows.filter((c) => c[2] !== '`/crm/dashboard`' && pred(c[5])).map((c) => c[2].replace(/`/g, '')).sort()
check('owner More = every menu item the owner sees (but the dashboard)', JSON.stringify(MORE_OWNER.map((i) => i.path).sort()) === JSON.stringify(seatSet(() => true)))
check('field tech More = exactly the items "all" or "staff" see', JSON.stringify(MORE_STAFF.map((i) => i.path).sort()) === JSON.stringify(seatSet((s) => s === 'all' || s.includes('staff'))))
check('a field tech is not shown an item an owner-only permission guards (Quotes, Invoices, Reports, Team)', ['/crm/quotes', '/crm/invoices', '/crm/reports', '/crm/team'].every((p) => !MORE_STAFF.some((i) => i.path === p)))
check('every More item is a phone screen or a web page — none is missing', [...MORE_OWNER].every((i) => i.kind === 'native' || i.kind === 'web'))

// Design components keep the floors.
const comp = (n: string) => fs.readFileSync(path.join(ROOT, 'apps/mobile/src/design/components', n), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const all = fs.readdirSync(path.join(ROOT, 'apps/mobile/src/design/components')).filter((f) => f.endsWith('.tsx'))
check('no design component draws raw <Text> (only DText, which caps scaling at 130%)', all.filter((f) => f !== 'Text.tsx').every((f) => !/<Text[ >]/.test(strip(comp(f)))), all.filter((f) => f !== 'Text.tsx' && /<Text[ >]/.test(strip(comp(f)))))
check('DText caps font scaling at MAX_FONT_SCALE', /maxFontSizeMultiplier=\{MAX_FONT_SCALE\}/.test(comp('Text.tsx')))
check('no design component hard-codes a colour (roles only)', all.every((f) => !/['"]#[0-9a-f]{3,8}['"]/i.test(strip(comp(f)))), all.filter((f) => /['"]#[0-9a-f]{3,8}['"]/i.test(strip(comp(f)))))
for (const f of ['Button.tsx', 'Chip.tsx', 'ListRow.tsx', 'SearchField.tsx', 'Screen.tsx', 'SectionHeader.tsx', 'BottomBar.tsx', 'BottomSheet.tsx']) check(`${f} uses MIN_TARGET`, /MIN_TARGET/.test(comp(f)))
check('the tile is a button with a spoken label that says what it opens', /accessibilityRole="button"/.test(comp('StatTile.tsx')) && /Opens \$\{opens\}/.test(comp('StatTile.tsx')))
check('the tile shows a chevron and a pressed state', /chevron-forward/.test(comp('StatTile.tsx')) && /pressed &&/.test(comp('StatTile.tsx')))
check('an error is a sentence with an icon, not colour alone', /alert-circle/.test(comp('TextField.tsx')))
check('animations stop when the phone says so (reduce motion)', /useReduceMotion/.test(comp('Skeleton.tsx')) && /useReduceMotion/.test(comp('BottomSheet.tsx')))
check('home care screens use no medical wording or imagery', !/(patient|medical|nurs|medic|pulse|heart|stethoscope|medkit)/i.test(strip(fs.readFileSync(path.join(ROOT, 'apps/mobile/src/design/preview/homes.tsx'), 'utf8') + fs.readFileSync(path.join(ROOT, 'apps/mobile/src/design/preview/screensA.tsx'), 'utf8').split('export function CareVisit')[1])))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
