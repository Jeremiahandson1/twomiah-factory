// Every screen address the phone app navigates to is a real screen.
//
//   bun tests/mobile/routes-resolve.test.ts
//
// The owner's Android (2026-10-28) showed Expo's "Unmatched Route" twice: "/" had no screen, then '/(tabs)' named none.
// Neither fails a type check — Expo Router resolves an address only on the phone. This reads every address written in the
// app's code (router.push / replace, <Redirect href>, pathname:, the alert-tap map, the home care menu's `to:`), turns
// each `${id}` into one segment and a map prefix ending in '/' into "prefix + an id", and checks it against the screen files
// under app/ with Expo Router's rules: a (group) is kept as written, [param] matches one segment, index is its folder.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '../../apps/mobile')
let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail ?? '') }
}

const files: string[] = []
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p) } }
walk(path.join(root, 'app')); walk(path.join(root, 'src'))

// The screens: every file under app/ but the layouts, as segments ('index' is its folder).
const screens = files.filter((f) => f.startsWith(path.join(root, 'app')) && !/[\\/]_layout\.tsx?$/.test(f))
  .map((f) => path.relative(path.join(root, 'app'), f).replace(/\.tsx?$/, '').split(path.sep).filter((s) => s !== 'index'))
const matches = (addr: string[]) => screens.some((s) => s.length === addr.length && s.every((seg, i) => /^\[.+\]$/.test(seg) || seg === addr[i]))

// The addresses: string and template literals that start with a (group), comments removed.
const targets = new Map<string, string[]>()
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const m of src.matchAll(/(['"`])(\/\([a-z]+\)[^'"`]*)\1/g)) {
    let a = m[2].split('?')[0].replace(/\$\{[^}]*\}/g, 'X')
    if (a.endsWith('/')) a += 'X' // a prefix an id is appended to (usePushNotifications' map)
    const where = path.relative(root, f)
    targets.set(a, [...(targets.get(a) || []), where])
  }
}

console.log(`${screens.length} screens, ${targets.size} addresses`)
check('the app has addresses to check (the scan is not empty)', targets.size >= 30, targets.size)
check('the start address "/" has a screen (app/index.tsx)', matches([]))
// useHomeHref builds '/(tabs)/<first tab>' from a tab NAME: every name a trade can show, and the fallback, must be a tab screen.
const { VERTICAL_TABS, VERTICAL_INITIAL_TAB } = await import('../../apps/mobile/src/vertical/verticals.ts')
const tabNames = new Set<string>(['notifications', ...Object.values(VERTICAL_TABS).flat().map((t: any) => t.name), ...Object.values(VERTICAL_INITIAL_TAB).filter(Boolean) as string[]])
for (const name of [...tabNames].sort()) check(`the tab "${name}" (a trade's tab, its first tab, or the fallback) is a screen`, matches(['(tabs)', name]))
for (const [addr, where] of [...targets].sort()) {
  if (addr === '/(tabs)/X' && where.every((w) => /useHomeHref/.test(w))) continue // checked name by name above
  check(`${addr} is a screen`, matches(addr.split('/').filter(Boolean)), [...new Set(where)])
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
