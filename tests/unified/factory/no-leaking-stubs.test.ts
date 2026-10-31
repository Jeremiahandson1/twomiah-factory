// No Factory test file leaves a stand-in behind for the next one (stubs.ts says why: crm-addon's open sign-in module made
// web-presence-routes' "staff routes are not open to the public" fail whenever it ran after it, in CI's one process).
//   · the sign-in module is replaced only through stubs.ts (stubAuth, or installAuth with afterAll(restoreAuth)) — never
//     with mock.module directly, and never by spreading `await import(auth)`, which is whatever an earlier file left;
//   · a file that replaces fetch puts it back (stubFetch, or its own `globalThis.fetch = realFetch`).
import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

const DIR = import.meta.dir
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.test.ts') && f !== 'no-leaking-stubs.test.ts')
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8')

test('the sign-in module is replaced only through stubs.ts, and put back', () => {
  const bad: string[] = []
  for (const f of files) {
    const s = read(f)
    if (/mock\.module\([^)]*middleware\/auth/.test(s)) bad.push(`${f}: mock.module on the sign-in module (use stubAuth / installAuth from ./stubs.ts)`)
    if (/await import\([^)]*middleware\/auth/.test(s)) bad.push(`${f}: imports the sign-in module to spread it (stubs.ts has the real one: realAuth)`)
    if (/\binstallAuth\(/.test(s) && !/afterAll\(restoreAuth\)/.test(s)) bad.push(`${f}: installAuth with no afterAll(restoreAuth)`)
  }
  expect(bad).toEqual([])
})

test('a file that replaces fetch puts it back', () => {
  const bad = files.filter((f) => {
    const s = read(f)
    if (!/globalThis\.fetch\s*=(?!=)/.test(s) || /\bstubFetch\(|restoreFetch\(/.test(s)) return false
    // Saved first (const real = globalThis.fetch) and put back from that name (globalThis.fetch = real).
    const saved = [...s.matchAll(/(?:const|let)\s+(\w+)\s*=\s*globalThis\.fetch\b/g)].map((m) => m[1])
    return !saved.some((name) => new RegExp(String.raw`globalThis\.fetch\s*=\s*${name}\b`).test(s))
  })
  expect(bad).toEqual([])
})

test('the guard sees what it guards: a direct mock and an unrestored fetch are caught', () => {
  const direct = "mock.module(path.resolve(import.meta.dir, '../../../apps/api/src/middleware/auth.ts'), () => ({}))"
  expect(/mock\.module\([^)]*middleware\/auth/.test(direct)).toBe(true)
  expect(/globalThis\.fetch\s*=(?!=)/.test('globalThis.fetch = (async () => new Response()) as any')).toBe(true)
  expect(/globalThis\.fetch\s*=(?!=)/.test('if (globalThis.fetch === x) {}')).toBe(false)
})
