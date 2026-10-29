// The design system's pieces keep the accessibility floors. (The home screens, the More menu, Leads and Invoices are real screens now:
// tests/mobile/more-menu.test.ts, home-routes.test.ts and apps/unified/tests/mobile-home-tiles.test.ts hold them to the desktop.)
//
//   bun run tests/mobile/design-preview.test.ts
import fs from 'node:fs'
import path from 'node:path'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
}
const ROOT = path.resolve(import.meta.dir, '../..')
const md = fs.readFileSync(path.join(ROOT, 'docs/mobile/PARITY.md'), 'utf8').replace(/\r\n/g, '\n') // a Windows checkout has CRLF
const section = (trade: string) => md.split('\n## ').find((x) => x.split('\n')[0].includes(`(\`${trade}\``)) || ''
const cells = (l: string) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())

// Design components keep the floors.
const comp = (n: string) => fs.readFileSync(path.join(ROOT, 'apps/mobile/src/design/components', n), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const all = fs.readdirSync(path.join(ROOT, 'apps/mobile/src/design/components')).filter((f) => f.endsWith('.tsx'))
check('no design component draws raw <Text> (only DText, which caps scaling at 130%)', all.filter((f) => f !== 'Text.tsx').every((f) => !/<Text[ >]/.test(strip(comp(f)))), all.filter((f) => f !== 'Text.tsx' && /<Text[ >]/.test(strip(comp(f)))))
check('DText caps font scaling at MAX_FONT_SCALE', /maxFontSizeMultiplier=\{MAX_FONT_SCALE\}/.test(comp('Text.tsx')))
check('no design component hard-codes a colour (roles only)', all.every((f) => !/['"]#[0-9a-f]{3,8}['"]/i.test(strip(comp(f)))), all.filter((f) => /['"]#[0-9a-f]{3,8}['"]/i.test(strip(comp(f)))))
for (const f of ['Button.tsx', 'Chip.tsx', 'ListRow.tsx', 'SearchField.tsx', 'Screen.tsx', 'SectionHeader.tsx', 'BottomBar.tsx', 'BottomSheet.tsx']) check(`${f} uses MIN_TARGET`, /MIN_TARGET/.test(comp(f)))
check('the tile is a button with a spoken label that says what it opens', /accessibilityRole="button"/.test(comp('StatTile.tsx')) && /Opens \$\{opens\}/.test(comp('StatTile.tsx')))
// Owner 2026-10-29: the app wears the business's colour — no pink, yellow and blue tile per kind. A tile's tone is only its hint.
check("every tile's icon is the business's colour, whatever the tile's kind", /const t = c\.tones\.accent/.test(comp('StatTile.tsx')) && /<Icon name=\{icon\} size=\{20\} tone="accent" \/>/.test(comp('StatTile.tsx')) && !/c\.tones\[tone\]/.test(comp('StatTile.tsx')))
check('the tile shows a chevron and a pressed state', /chevron-forward/.test(comp('StatTile.tsx')) && /pressed &&/.test(comp('StatTile.tsx')))
check('an error is a sentence with an icon, not colour alone', /alert-circle/.test(comp('TextField.tsx')))
check('animations stop when the phone says so (reduce motion)', /useReduceMotion/.test(comp('Skeleton.tsx')) && /useReduceMotion/.test(comp('BottomSheet.tsx')))
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')
check('home care screens use no medical wording or imagery', !/(patient|medical|nurs|medic|pulse|heart|stethoscope|medkit)/i.test(strip(read('apps/mobile/src/home/HomeScreen.tsx') + read('apps/mobile/src/home/tiles.ts') + read('apps/mobile/app/(details)/rows.tsx') + read('apps/mobile/src/design/preview/screensA.tsx').split('export function CareVisit')[1])))

// ── round 2 mock-ups: salon, restaurant, bar, store, vet ───────────────────────────────────────────────────────────────────
const V = read('apps/mobile/src/design/preview/verticals.tsx')
const reg = read('apps/mobile/src/design/preview/registry.tsx')
const body = (name: string) => { const m = new RegExp(`export (?:const|function) ${name}\\b([\\s\\S]*?)(?=\\nexport |\\n// ──|$)`).exec(V); return m ? m[1] : '' }
const TRADES5 = ['salon', 'restaurant', 'bar', 'store', 'vet']
for (const t of TRADES5) {
  const ids = [...reg.matchAll(new RegExp(`id: '(${t}-[a-z0-9-]+)'`, 'g'))].map((m) => m[1])
  check(`${t}: mock-ups for both homes, both More menus and at least four Phase A screens`, ids.filter((i) => /-home-/.test(i)).length === 2 && ids.filter((i) => /-more/.test(i)).length === 2 && ids.filter((i) => !/-home-|-more/.test(i)).length >= 4, ids)
  const barM = new RegExp(`${t}: \\{ frontName: '[^']*', office: \\[([^\\n]*)\\], front: \\[([^\\n]*)\\] \\}`).exec(V)
  const slots = (x: string) => [...x.matchAll(/\bb\('|\bMORE\b/g)].length
  check(`${t}: five bottom-bar slots for each seat, More last`, !!barM && slots(barM[1]) === 5 && slots(barM[2]) === 5 && /MORE$/.test(barM[1].trim()) && /MORE$/.test(barM[2].trim()))
  const rows = md.split('\n## ').find((x) => x.split('\n')[0].includes(`(\`${t}\``)) || ''
  const labels = [...V.matchAll(new RegExp(`\\['([^']+)', '[a-z-]+', (?:true|false)\\]`, 'g'))].map((m) => m[1])
  void rows; void labels
}
// Every label in a trade's More mock-up is a real desktop menu item of that trade.
for (const t of TRADES5) {
  const sec = section(t)
  const labelsOf = [...new Set([...(new RegExp(`  ${t}: \\{\\n[\\s\\S]*?\\n  \\},`).exec(V)?.[0] || '').matchAll(/\['([^']+)', '[a-z-]+', (?:true|false)\]/g)].map((m) => m[1]))]
  const real = new Set(md.split('\n').filter(() => true).length ? sec.split('\n').map((l) => cells(l)[1]).filter(Boolean) : [])
  const alias: Record<string, string> = { 'Contacts': 'All Contacts' }
  const missing = labelsOf.filter((l) => !real.has(l) && !real.has(alias[l] || ''))
  check(`${t}: every More entry is a real desktop menu item`, labelsOf.length > 6 && missing.length === 0, missing)
}
const money = /\$\d|revenue|refund/i
check('front-line homes show no money: stylist, captain, bartender, packer, clinical staff', ['SalonHomeStylist', 'RestaurantHomeStaff', 'BarHomeStaff', 'StoreHomePacker', 'VetHomeTech'].every((n) => body(n).length > 200 && !money.test(body(n))), ['SalonHomeStylist', 'RestaurantHomeStaff', 'BarHomeStaff', 'StoreHomePacker', 'VetHomeTech'].filter((n) => money.test(body(n))))
check('the floor copy of the banquet order, the packer\'s order and the count have no prices', ['RestaurantBeo', 'StoreOrder', 'BarCount', 'SalonLogService'].every((n) => body(n).length > 100 && !/\$\d/.test(body(n))))
check('no screen takes a card: nothing says charge, pay now, tap to pay or card reader', !/(charge the card|pay now|tap to pay|card reader|take payment|\bring\b)/i.test(V.replace(/Nothing here charges a card|nothing takes a card|never "Charge"/gi, '')))
check('vet screens use no medical icons or clinical wording', !/(heart|pulse|medkit|stethoscope|medical-outline)/.test(strip(body('VetPatient') + body('VetToday') + body('VetRecall') + body('VetVaccine') + body('VetHomeOwner') + body('VetHomeTech'))) && !/\b(recommended|safe to|normal range|up to date|cleared)\b/i.test(body('VetPatient') + body('VetVaccine') + body('VetRecall') + body('VetToday')))
check('the vaccine screen asks for the due date and says the phone never fills one in', /Next due \(you choose\)/.test(body('VetVaccine')) && /never fills one in/.test(body('VetVaccine')))
check('salon: allergy and patch-test notes are the salon\'s own words, never "safe" or "cleared"', /Allergy and patch test/.test(body('SalonClient')) && !/\b(safe|cleared|ok to)\b/i.test(body('SalonClient')))
check('store: no cancel or refund on the phone (only the floor moves)', !/(Cancel order|Refund)/.test(body('StoreOrder').replace(/No cancel, no refund/, '')) && /Mark packed/.test(body('StoreOrder')))
check('restaurant: the banquet order puts the allergy alert first and has no prices', body('RestaurantBeo').indexOf('Allergy and dietary alert') < body('RestaurantBeo').indexOf('Run of show') && /No prices on this copy/.test(body('RestaurantBeo')))
check('bar: the count is blind', /system's number is not shown/.test(body('BarCount')))
check('the new mock-ups say they are made up (sample names only) and reach the stores nowhere', /Sample|Example|Placeholder/.test(V) && !/fetch\(|axios|SecureStore|useAuth/.test(V))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
