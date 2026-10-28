// The business's colour is readable as TEXT on the phone's dark and light screens (4.5:1), and buttons keep the exact colour.
//
//   bun run tests/mobile/theme-contrast.test.ts
//
// Higgs Heritage Builders' crimson (#b91c1c) is 2.6:1 on the dark surface: the active tab's label and every coloured word
// (a contact's name, a price) were hard to read on the owner's phone. readableAccent() (src/theme/contrast.ts) lightens a colour
// on a dark screen / darkens it on a light one just far enough; ThemeContext exposes it as `primaryText`.
// A button, chip or icon background keeps the EXACT business colour, with the ink from inkOn().
import fs from 'node:fs'
import path from 'node:path'
import { readableAccent, contrastRatio, inkOn } from '../../apps/mobile/src/theme/contrast.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail)) }
}
const root = path.resolve(import.meta.dir, '../../apps/mobile')
const src = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// The grounds in ThemeContext.tsx — read from the file so a changed background is checked, not a copy of it.
const theme = src('src/theme/ThemeContext.tsx')
const pick = (key: string, dark: boolean) => new RegExp(`${key}:\\s*isDark\\s*\\?\\s*'(#[0-9a-f]{6})'\\s*:\\s*'(#[0-9a-f]{6})'`, 'i').exec(theme)?.[dark ? 1 : 2] as string
const DARK = ['background', 'surface', 'surfaceAlt'].map((k) => pick(k, true))
const LIGHT = ['background', 'surface', 'surfaceAlt'].map((k) => pick(k, false))
check('the theme\'s backgrounds were read', [...DARK, ...LIGHT].every((c) => /^#[0-9a-f]{6}$/i.test(c || '')), { DARK, LIGHT })

const worst = (c: string, bgs: string[]) => Math.min(...bgs.map((b) => contrastRatio(c, b)))
const COLOURS = ['#b91c1c', '#1e40af', '#0d9488', '#facc15', '#7c3aed', '#f97316', '#111111', '#ffffff', '#166534', '#be185d']
for (const c of COLOURS) {
  const d = readableAccent(c, DARK), l = readableAccent(c, LIGHT)
  check(`${c} as text on the dark screen is ${worst(d, DARK).toFixed(2)}:1 (≥ 4.5)`, worst(d, DARK) >= 4.5, { d })
  check(`${c} as text on the light screen is ${worst(l, LIGHT).toFixed(2)}:1 (≥ 4.5)`, worst(l, LIGHT) >= 4.5, { l })
}
check('the crimson really was a problem (so this test would have caught it)', worst('#b91c1c', DARK) < 4.5, worst('#b91c1c', DARK))
check('a colour that already reads is left exactly as the business chose it', readableAccent('#facc15', DARK) === '#facc15' && readableAccent('#1e40af', LIGHT) === '#1e40af')
check('the hue is kept: the lightened crimson is still red-dominant', (() => { const h = readableAccent('#b91c1c', DARK); const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16); return r > g })())

// Wiring: the theme exposes it, the tab labels use it, and the filled controls keep the real colour with inkOn() ink.
check('ThemeContext exposes primaryText from readableAccent over the scheme\'s grounds', /primaryText:\s*readableAccent\(\s*primary\s*,/.test(theme))
check('the active tab label uses primaryText', /tabBarActiveTintColor:\s*t\.primaryText/.test(src('app/(tabs)/_layout.tsx')))
check('the filter chips and the floating button take their ink from inkOn(primary)', /inkOn\(t\.primary\)/.test(src('src/components/FilterChips.tsx')) && /inkOn\(t\.primary\)/.test(src('src/components/FAB.tsx')))
check('inkOn still picks white on crimson and near-black on yellow', inkOn('#b91c1c') === '#ffffff' && inkOn('#facc15') === '#0f172a')

// No Text style anywhere writes the raw business colour as its text colour any more (icons and spinners may).
const files: string[] = []
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx$/.test(e.name)) files.push(p) } }
walk(path.join(root, 'app')); walk(path.join(root, 'src'))
const raw = files.filter((f) => /(?<![A-Za-z])color:\s*t\.primary(?![A-Za-z])/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f))
check('no text style uses the raw business colour (use t.primaryText)', raw.length === 0, raw)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
