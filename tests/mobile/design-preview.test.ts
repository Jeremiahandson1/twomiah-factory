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
const md = fs.readFileSync(path.join(ROOT, 'docs/mobile/PARITY.md'), 'utf8')
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
check('the tile shows a chevron and a pressed state', /chevron-forward/.test(comp('StatTile.tsx')) && /pressed &&/.test(comp('StatTile.tsx')))
check('an error is a sentence with an icon, not colour alone', /alert-circle/.test(comp('TextField.tsx')))
check('animations stop when the phone says so (reduce motion)', /useReduceMotion/.test(comp('Skeleton.tsx')) && /useReduceMotion/.test(comp('BottomSheet.tsx')))
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
check('home care screens use no medical wording or imagery', !/(patient|medical|nurs|medic|pulse|heart|stethoscope|medkit)/i.test(strip(read('apps/mobile/src/home/HomeScreen.tsx') + read('apps/mobile/src/home/tiles.ts') + read('apps/mobile/app/(details)/rows.tsx') + read('apps/mobile/src/design/preview/screensA.tsx').split('export function CareVisit')[1])))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
