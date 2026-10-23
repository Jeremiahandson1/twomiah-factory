// CI guard: a whole list (every row, no paging on the server) answers through listAll (apps/unified/server/http/reply.ts),
// never a hand-made `{ page: 1, limit: rows.length }` (2026-10-22).
//
// The live retest found an empty list reporting `limit: 1`. 157 routes spelt the same reply by hand — most as
// `limit: rows.length` (0 for an empty list), some as `Math.max(rows.length, 1)` (1), one as `rows.length || 1` — so
// the number meant something different on every screen and none of them was the limit the caller asked for. listAll
// is the one rule: the limit asked for, or the number returned if that is more.
//   bun scripts/check-unified-whole-lists.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SRC = 'apps/unified/server'
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((name) => {
  const rel = dir + '/' + name
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [rel] : []
})

let files: string[] = []
try { files = walk(SRC) } catch { fail(SRC + ' is missing — fix this guard\'s walk') }
if (files.length < 100) fail(`only ${files.length} files under ${SRC} — fix this guard's walk`)

// A pagination limit made from a row count, in any of the spellings found: `limit: rows.length`, `limit: x.y.length || 1`,
// `limit: Math.max(rows.length, 1)`, `limit: Math.max(1, rows.length)`.
const HAND_MADE = /\blimit\s*:\s*(?:Math\.max\(\s*(?:1\s*,\s*)?[\w.]+\.length|[\w.]+\.length\b)/
let seen = 0
for (const rel of files) {
  if (rel.endsWith('/http/reply.ts')) continue
  readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    if (/\blistAll\(/.test(line)) seen++
    if (HAND_MADE.test(line)) fail(`${rel}:${i + 1} makes a whole list's limit from its row count — answer with listAll(c, rows): ${line.trim().slice(0, 100)}`)
  })
}
// The walk must actually reach the routes that answer whole lists.
if (seen < 100) fail(`only ${seen} listAll( calls found under ${SRC} — fix this guard's walk`)

if (failed) { console.error(`\nunified whole lists: ${failed} problem(s)`); process.exit(1) }
console.log(`unified whole lists: ${files.length} files, ${seen} whole lists, all through listAll`)
