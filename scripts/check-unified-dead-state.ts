// CI guard: a button that sets state nobody reads does nothing (live test 2026-10-22, contractor: Equipment's "Add Service
// Record" set showAddForm, and no line of the page ever read it — there was no form).
//
// For every `const [x, setX] = useState(…)` in the unified admin and the shared screens: if setX is called and x is never
// read, the click changes nothing on screen. Fails on each one.
//   bun scripts/check-unified-dead-state.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const DIRS = ['apps/unified/web/src', 'packages/tenant-ui/src']
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((name) => {
  if (name === 'node_modules' || name === 'dist') return []
  const rel = dir + '/' + name
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.tsx$/.test(name) && !/\.test\./.test(name) ? [rel] : []
})

let files: string[] = []
for (const d of DIRS) { try { files.push(...walk(d)) } catch { fail(d + ' is missing — fix this guard\'s walk') } }
if (files.length < 200) fail(`only ${files.length} screens under ${DIRS.join(', ')} — fix this guard's walk`)

let pairs = 0
for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  for (const m of src.matchAll(/const \[(\w+), (set\w+)\] = useState\b/g)) {
    pairs++
    const [, value, setter] = m
    const reads = (src.match(new RegExp(`\\b${value}\\b`, 'g')) || []).length - 1
    const sets = (src.match(new RegExp(`\\b${setter}\\(`, 'g')) || []).length
    if (sets > 0 && reads === 0) fail(`${rel}: ${setter}() is called and \`${value}\` is never read — whatever sets it changes nothing on screen`)
  }
}
if (pairs < 500) fail(`only ${pairs} useState pairs found — fix this guard's pattern`)

if (failed) { console.error(`\n${failed} problem(s).`); process.exit(1) }
console.log(`OK — ${files.length} screens, ${pairs} state pairs: every state that is set is read.`)
