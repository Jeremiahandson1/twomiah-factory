// CI guard: the home care frontend never parses a calendar day as UTC midnight.
//
// Run 3 HIGH 1: the caregiver's Open Shifts screen showed "Tue, Oct 20" for shift_date 2026-10-21
// (and "Sun, Oct 25" for Monday Oct 26). `new Date('2026-10-21')` is UTC midnight, which is the
// evening BEFORE everywhere in America/*. The office and the portal happened to parse it locally;
// the caregiver app did not. The cure is one helper, frontend/src/utils/date.ts:
//   parseLocalDate(v)  — a 'YYYY-MM-DD' (or a UTC-midnight DATE column) → local midnight of that day
//   formatDate(v, opts) / toLocalYMD(v) — built on it; instants still render as instants.
//
// Two rules, over every .ts/.tsx under templates/crm-homecare/frontend/src (utils/date.ts excepted):
//   1. `new Date(X)` where X is a value NAMED like a calendar day (…date, …Date, …_on, day, dob,
//      weekStart / week_start, weekOf, ymd, dateStr, dateKey) and not an explicit local parse
//      (X + 'T12:00:00', a template with T…, or new Date(y, m, d)). Use parseLocalDate(X).
//   2. `new Date(X).toLocaleDateString(` for any X not named as an instant (…_at, …At, …time,
//      …Time, timestamp, ts) and not an explicit local parse. A formatter's own `d` parameter is
//      exactly how the Open Shifts bug hid. Use formatDate(X, opts).
// The rules are checked against planted samples first, aliases included, so a guard that stops
// recognising the shape fails instead of passing.
//   bun scripts/check-homecare-local-dates.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripSource as strip } from './lib/stripComments.ts'

const ROOT = new URL('../templates/crm-homecare/frontend/src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const EXEMPT = new Set(['utils/date.ts'])

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const DAY_NAME = /(?:^|[._\s?!(])(?:[A-Za-z0-9_]*_date|[A-Za-z0-9_]*Date|date|[A-Za-z0-9_]*_on|day|dob|DOB|birthday|birth_date|week_start|weekStart|weekOf|week_of|ymd|YMD|dateStr|dateKey|date_str)\)?$/
const INSTANT_NAME = /(?:_at|At|time|Time|timestamp|Timestamp|ts|Ts|tapAt|now|Now|instant)\)?$/
const EXPLICIT_LOCAL = /\+\s*['"`]T\d|`[^`]*\$\{[^}]+\}T\d|T\d\d:\d\d(:\d\d)?['"`]?\s*$/

/** Every `new Date(` argument in the source, with its offset and what follows the closing paren. */
function dateCalls(src: string): { arg: string; at: number; after: string }[] {
  const out: { arg: string; at: number; after: string }[] = []
  const re = /new\s+Date\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1, i = m.index + m[0].length, quote: string | null = null
    const start = i
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i]
      if (quote) { if (ch === '\\') { i++; continue } if (ch === quote) quote = null; continue }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '(') depth++
      else if (ch === ')') depth--
    }
    out.push({ arg: src.slice(start, i - 1).trim(), at: m.index, after: src.slice(i, i + 40) })
  }
  return out
}

/** Top-level comma → the (y, m, d) form, which is local by construction. */
function hasTopLevelComma(arg: string): boolean {
  let depth = 0, quote: string | null = null
  for (let i = 0; i < arg.length; i++) {
    const ch = arg[i]
    if (quote) { if (ch === '\\') { i++; continue } if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (ch === ',' && depth === 0) return true
  }
  return false
}

/** The names an argument reads: `r.startDate || r.start_date` → both ends. */
function operands(arg: string): string[] {
  return arg.split(/\|\||\?\?|&&|\?|:/).map((s) => s.trim()).filter(Boolean)
}

function classify(arg: string, after: string): string | null {
  if (!arg || hasTopLevelComma(arg) || EXPLICIT_LOCAL.test(arg)) return null
  if (/^(Date\.now\(\)|\d|-?\d)/.test(arg) || /^Date\.now\(\)/.test(arg)) return null
  const ops = operands(arg)
  if (ops.some((o) => DAY_NAME.test(o) && !INSTANT_NAME.test(o))) return 'a calendar-day value parsed as UTC midnight — use parseLocalDate()'
  if (/^\s*\.\s*toLocaleDateString\s*\(/.test(after) && !ops.every((o) => INSTANT_NAME.test(o))) {
    return 'new Date(x).toLocaleDateString() on a value not named as an instant — use formatDate(x, opts)'
  }
  return null
}

// ── the rules, against planted samples (an alias and a fallback included) ───────────────────────────
const MUST_FLAG: [string, string][] = [
  ['shift.date', ''], ['shift.shift_date', ''], ['r.startDate || r.start_date', ''], ['dateStr', ''], ['weekStart', ''],
  ['s?.end_date', ''], ['d', ').toLocaleDateString(\'en-US\')'.slice(1)], ['value', '.toLocaleDateString()'],
  ['report.date', '.toLocaleDateString(\'en-US\', {})'],
]
const MUST_PASS: [string, string][] = [
  ['x.created_at', '.toLocaleDateString()'], ['ymd + \'T12:00:00\'', '.toLocaleDateString()'], ['`${d}T12:00:00`', '.toLocaleDateString()'],
  ['y, m - 1, d', '.toLocaleDateString()'], ['Date.now() - 7 * 86400000', ''], ['activeSession.start_time', ''], ['ts', '.toLocaleDateString()'],
  ['dateStr + \'T00:00:00\'', ''],
]
for (const [arg, after] of MUST_FLAG) if (!classify(arg, after)) fail(`self-test: the rule no longer catches new Date(${arg})${after}`)
for (const [arg, after] of MUST_PASS) if (classify(arg, after)) fail(`self-test: the rule wrongly flags new Date(${arg})${after}`)

const UTC_DAY = /\.toISOString\(\)\s*\.\s*(?:split\(\s*['"]T['"]\s*\)|slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)|substr\(\s*0\s*,\s*10\s*\))/g
for (const bad of [`d.toISOString().split('T')[0]`, `new Date().toISOString().slice(0, 10)`, `x.toISOString().substring(0,10)`]) {
  UTC_DAY.lastIndex = 0
  if (!UTC_DAY.test(bad)) fail(`self-test: rule 3 no longer catches ${bad}`)
}
UTC_DAY.lastIndex = 0

// ── the sweep ─────────────────────────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}
let files = 0, calls = 0
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  if (EXEMPT.has(rel)) continue
  files++
  const src = strip(readFileSync(file, 'utf8'))
  for (const c of dateCalls(src)) {
    calls++
    const why = classify(c.arg, c.after)
    if (why) {
      const line = src.slice(0, c.at).split('\n').length
      fail(`${rel}:${line}: new Date(${c.arg.slice(0, 60)}) — ${why}`)
    }
  }
  // 3. The other direction: a Date turned into a calendar day through toISOString() is UTC's day —
  //    "today" after 7pm Central is tomorrow. Use toLocalYMD(d).
  for (const m of src.matchAll(UTC_DAY)) {
    fail(`${rel}:${src.slice(0, m.index).split('\n').length}: derives a calendar day from toISOString() (UTC) — use toLocalYMD()`)
  }
}

// ── the helper itself parses the day locally ──────────────────────────────────────────────────────
const helper = readFileSync(join(ROOT, 'utils/date.ts'), 'utf8')
if (!/export function parseLocalDate[\s\S]*?new Date\(y, m - 1, d\)/.test(helper)) fail('utils/date.ts must export parseLocalDate() building the day with new Date(y, m - 1, d)')

if (failed) { console.error(`\nhome care local dates: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`home care local dates: ${calls} new Date() calls in ${files} files; none parses a calendar day as UTC`)
