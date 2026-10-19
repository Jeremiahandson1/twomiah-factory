// No screen asks the server for a bigger page than it serves. The server refuses ?limit over 500 on every /api path
// (server/http/guards.ts pagingGuard); 22 of home care's screens asked for 1000 — the scheduler's, the Schedule Hub's,
// the billing screens' pickers, View As — so each of those requests was a 400 and the picker came up empty (found in
// the browser, 2026-10-19). A whole list is lib/http.ts listAll, which walks the pages.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

const WEB = path.resolve(import.meta.dir, '..', 'web', 'src')
const SERVER_MAX = 500
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(path.join(dir, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) ? [path.join(dir, e.name)] : [])

/** Every page size a line asks for: `limit: 1000`, `limit: '1000'`, `limit=1000`. */
const asked = (line: string): number[] => [...line.matchAll(/\blimit\s*[:=]\s*['"`]?(\d+)/g)].map((m) => Number(m[1]))
const offends = (line: string) => !/^\s*(\/\/|\*)/.test(line) && asked(line).some((n) => n > SERVER_MAX)

describe('screens ask for pages the server serves', () => {
  test(`no screen asks for more than ${SERVER_MAX} rows at once`, () => {
    const out: string[] = []
    for (const f of files(WEB)) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (offends(line)) out.push(`${path.relative(WEB, f)}:${i + 1}: ${line.trim()}`) })
    }
    expect(out).toEqual([])
  })

  test('the guard sees the shapes it names, and lets a page the server serves through (mutation check)', () => {
    expect(offends("api.get('/api/clients', { limit: 1000 })")).toBe(true)
    expect(offends("get('/api/clients?limit=1000')")).toBe(true)
    expect(offends("const ALL = { limit: '600' }")).toBe(true)
    expect(offends("api.get('/api/clients', { limit: 500 })")).toBe(false)
    expect(offends('// the template asked ?limit=1000')).toBe(false)
  })

  test('the server cap the guard holds to is the server\'s', () => {
    const guards = fs.readFileSync(path.resolve(import.meta.dir, '..', 'server', 'http', 'guards.ts'), 'utf8')
    expect(guards).toMatch(new RegExp(`MAX_PAGE_LIMIT = ${SERVER_MAX}\\b`))
    expect(fs.readFileSync(path.join(WEB, 'crm/pages/homecare/lib/http.ts'), 'utf8')).toMatch(new RegExp(`PAGE_LIMIT = ${SERVER_MAX}\\b`))
  })
})
