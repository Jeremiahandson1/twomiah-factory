// The phone design system's tokens: every colour role reads (4.5:1 text, 3:1 control edges) on light AND dark, for any
// colour a business might choose; the grounds are the theme's own; the type scale and touch targets hold their floors.
//
//   bun run tests/mobile/design-tokens.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { colorRoles, readablePairs, GROUNDS, contrastRatio } from '../../apps/mobile/src/design/colors.ts'
import { type, space, radius, MIN_TARGET, MAX_FONT_SCALE, elevationStyle, motion } from '../../apps/mobile/src/design/tokens.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
}
const root = path.resolve(import.meta.dir, '../../apps/mobile')
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// One theme, not two: the design grounds ARE ThemeContext's.
{
  const theme = noComments(fs.readFileSync(path.join(root, 'src/theme/ThemeContext.tsx'), 'utf8'))
  const pick = (key: string, dark: boolean) => new RegExp(`${key}:\\s*isDark\\s*\\?\\s*'(#[0-9a-f]{6})'\\s*:\\s*'(#[0-9a-f]{6})'`, 'i').exec(theme)?.[dark ? 1 : 2]
  for (const k of ['background', 'surface', 'surfaceAlt', 'text', 'border'] as const) {
    check(`dark ${k} is ThemeContext's (${pick(k, true)})`, pick(k, true) === GROUNDS.dark[k])
    check(`light ${k} is ThemeContext's (${pick(k, false)})`, pick(k, false) === GROUNDS.light[k])
  }
}

// Every role, both schemes, a spread of business colours (dark, light, mid, saturated, grey, the two real customers').
const BUSINESS = ['#b91c1c', '#1e40af', '#0d9488', '#facc15', '#7c3aed', '#f97316', '#111111', '#ffffff', '#166534', '#be185d', '#64748b', '#ff00ff', '#00ffff', '#808000']
let pairs = 0
for (const dark of [false, true]) {
  for (const c of BUSINESS) {
    const bad = readablePairs(colorRoles(c, dark)).filter((p) => { pairs++; return contrastRatio(p.fg, p.bg) < p.min })
    check(`${dark ? 'dark ' : 'light'} ${c}: every role reads`, bad.length === 0, bad.map((b) => `${b.name} ${b.fg}/${b.bg} ${contrastRatio(b.fg, b.bg).toFixed(2)} < ${b.min}`))
  }
}
check(`${pairs} role pairs were measured`, pairs > 1000, pairs)

// The roles keep the business's colour where it should stay exact.
for (const c of BUSINESS) for (const dark of [false, true]) {
  const r = colorRoles(c, dark)
  if (r.accent !== c) check(`accent is exactly the business colour ${c}`, false, r.accent)
}
check('the accent is the exact business colour in both schemes', BUSINESS.every((c) => colorRoles(c, true).accent === c && colorRoles(c, false).accent === c))
{
  // A button keeps the exact colour unless NO ink can read on it; then only the shade moves, same hue.
  const moved = BUSINESS.filter((c) => colorRoles(c, false).accentFill !== c)
  check('only colours no ink can read on get a darker button shade', moved.length === 1 && moved[0] === '#808000', moved)
  const r = colorRoles('#808000', false)
  check('the olive button is the same hue, darker, and reads with white', r.accentFill !== '#808000' && contrastRatio('#ffffff', r.accentFill) >= 4.5 && r.onAccent === '#ffffff', r)
}
check('the old muted grey was a real problem (so this test would have caught it)', contrastRatio('#94a3b8', '#ffffff') < 4.5)
check('the new quietest text reads on white', contrastRatio(colorRoles('#1e40af', false).textSubtle, '#ffffff') >= 4.5)

// Scales and floors.
check('touch target floor is 44', MIN_TARGET === 44)
check('text scales to 130% and no further', MAX_FONT_SCALE === 1.3)
check('no type style is smaller than 12 points', Object.values(type).every((t) => t.size >= 12))
check('body text is 16 points', type.body.size === 16 && type.bodyStrong.size === 16)
check('every line height is at least 1.25× its size', Object.entries(type).every(([, t]) => t.line / t.size >= 1.25), Object.entries(type).filter(([, t]) => t.line / t.size < 1.25))
check('spacing is on a 4-point grid', Object.values(space).every((v) => v % 4 === 0))
check('radii ascend', radius.sm < radius.md && radius.md < radius.lg && radius.lg < radius.xl)
check('dark screens draw no shadows (they cannot be seen), light ones do', elevationStyle(2, true).shadowOpacity === 0 && elevationStyle(2, false).shadowOpacity > 0)
check('motion is short', motion.fast < motion.base && motion.base < motion.slow && motion.slow <= 400)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
