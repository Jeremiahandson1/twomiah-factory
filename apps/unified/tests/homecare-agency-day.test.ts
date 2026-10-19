// Home care counts days on the agency's clock (server/crm/homecare/core/agencyTime.ts: today, range, ymdIn). "Today"
// taken as the server's UTC date — `new Date().toISOString().slice(0, 10)` — is tomorrow every US evening: an 8 PM
// review, a WORCS result, a Sandata start date, a restriction, an export file were all stamped a day late that way
// (found in the move, 2026-10-19). This holds the rule over every home-care server file, so a new one can't bring it back.
//
// What it refuses: a line that makes an instant from now, or from a recorded instant (createdAt, …At, …_at), and cuts
// its ISO string to a date. What it allows: date arithmetic on a calendar day pinned at noon or midnight UTC
// (`new Date(`${ymd}T12:00:00Z`)`) or built with Date.UTC, which is how the calendar helpers count days and is zone-free.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..', 'server', 'crm', 'homecare')
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : [])

const TO_DAY = /\.toISOString\(\)\s*\.(slice\(0,\s*10\)|split\(['"]T['"]\)\[0\])/
const FROM_NOW_OR_INSTANT = /new Date\(\s*\)|new Date\([^)]*(createdAt|updatedAt|At\b|_at\b)/
const PINNED = /T12:00:00Z|T00:00:00Z|Date\.UTC\(/
const offends = (line: string) => TO_DAY.test(line) && FROM_NOW_OR_INSTANT.test(line) && !PINNED.test(line)

describe("home care's days are the agency's", () => {
  test('no server file turns now, or a recorded instant, into a day through UTC', () => {
    const offenders: string[] = []
    for (const f of files(ROOT)) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return
        if (offends(line)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  test('the guard catches the shapes it names (mutation check)', () => {
    expect(offends("ratingDate: reviewDate || new Date().toISOString().split('T')[0],")).toBe(true)
    expect(offends('const exportDay = () => new Date().toISOString().slice(0, 10)')).toBe(true)
    expect(offends('const ymd = new Date(r.plan.createdAt).toISOString().slice(0, 10)')).toBe(true)
    expect(offends('EffectiveStartDate: (c.createdAt ? new Date(c.createdAt) : new Date()).toISOString().slice(0, 10),')).toBe(true)
    // Calendar arithmetic stays allowed.
    expect(offends('return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)')).toBe(false)
    expect(offends('const d = new Date(`${ymd}T12:00:00Z`); return d.toISOString().slice(0, 10)')).toBe(false)
  })
})
