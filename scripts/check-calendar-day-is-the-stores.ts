// CI guard: a calendar day means the STORE's day, everywhere — not the server's.
//
// created_at, completed_at, clock_in and their siblings are NAIVE UTC timestamps. Every one of
// these cuts the day at UTC midnight, which is 8pm in Ohio, 7pm Central, 5pm Pacific:
//
//     AND DATE(o.created_at) = CURRENT_DATE                         -- "today", in UTC
//     AND o.created_at >= ${startDate}::date                        -- a supplied date, in UTC
//     AND o.created_at <  (${endDate}::date + INTERVAL '1 day')     -- ditto
//     AND DATE(o.created_at) = ${reportDate}::date                  -- ditto, and unindexable
//     started_at::date = current_date                               -- ditto
//     created_at >= date_trunc('week', now())                       -- "this week", in UTC
//     new Date('2026-09-30')                                        -- UTC midnight, in JS
//
// So a shop lost the last four hours of EVERY day to tomorrow: the tax return declared that money in
// the wrong period, payroll paid the evening shift on the wrong day, and the curbside queue, the
// kiosk tiles and the ID-scan counters all reset to zero at 8pm while the shop was still trading.
//
// T24 N1 fixed this properly for the dashboard, the analytics series and cash reconciliation — and
// then the only correct implementation sat PRIVATE inside routes/analytics.ts, where no other route
// could reach it. Four files wrote their own copy of the company-to-zone lookup; a fifth never asked.
// A sweep in Sep 2026 found 61 sites across 12 route files still cutting the day in UTC, plus
// tax-filing.ts doing it in JavaScript. eod.ts — the route T24 N1 was written for — had converted
// SEVEN of its eleven day decisions and left four.
//
// That is the shape this guard exists to prevent: not the bug, which is easy to fix, but the
// PRIVATE HELPER, which is what let the bug reappear twelve times. The helpers now live in
// utils/isoTime.ts and this file refuses any route that decides a day for itself.
//
//   bun scripts/check-calendar-day-is-the-stores.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const BACKEND = 'templates/crm-dispensary/backend/src'
const read = (rel: string) => { try { return readFileSync(ROOT + rel, 'utf8') } catch { fail(`${rel} is missing`); return '' } }

/**
 * Source with comments removed — a rule about code must not be tripped by prose describing it.
 *
 * Including SQL `--` comments: the fixes in orders.ts explain in a SQL comment what
 * `date_trunc('year', NOW())` used to do wrong, and the first version of this guard flagged that
 * sentence as the defect. A guard that fails on its own fix's explanation trains people to delete
 * the explanation.
 */
const code = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/^\s*--[^\n]*$/gm, '')

// ── 1. the helpers exist, and are the single definition of each question ──────────────────────────
{
  const iso = read(`${BACKEND}/utils/isoTime.ts`)
  const need: Array<[RegExp, string]> = [
    [/export function storeTimeZone\(/, 'storeTimeZone — which clock a company runs on'],
    [/export async function zoneFor\(/, 'zoneFor — that clock, from a company id (four routes each had their own copy of this query)'],
    [/export const storeDay = /, 'storeDay — which calendar day a timestamp falls on'],
    [/export function storeDayRange\(/, 'storeDayRange — one store day as a half-open UTC range'],
    [/export function storeRange\(/, 'storeRange — a from..to reporting window (this one was private to analytics.ts)'],
    [/export function storeToday\(/, 'storeToday — the store\'s date now'],
  ]
  for (const [re, what] of need) if (!re.test(iso)) fail(`utils/isoTime.ts must export ${what}`)

  // The range is half-open BY CONSTRUCTION: its end is the start of the next day, never
  // 23:59:59.999 of this one. Every caller writes `< end` and relies on it. (T27 H2)
  if (!/const end = storeDayStart\(next\.toISOString\(\)\.slice\(0, 10\), tz\)/.test(iso))
    fail('storeDayRange must end at the START of the next day — an inclusive end drops the last millisecond of the day and every caller\'s `< end` silently changes meaning')
  if (!/start: storeDayRange\(tz, from\)\.start, end: storeDayRange\(tz, to\)\.end/.test(iso))
    fail('storeRange must be built from storeDayRange, so a from..to window and a single day cannot disagree')
}

// ── 2. no ROUTE decides a day for itself ─────────────────────────────────────────────────────────
{
  const dir = `${BACKEND}/routes`
  const files = readdirSync(ROOT + dir).filter((f) => f.endsWith('.ts')).sort()
  if (files.length < 20) fail(`only ${files.length} route files found — the glob is wrong, so this guard is checking almost nothing`)

  // Naive-UTC timestamp columns. A real DATE column (shifts.date, eod_reports.date, issued_date,
  // date_of_birth) is a calendar date already and is correctly compared with ::date — those are
  // deliberately not in this list.
  const TS = '(?:created_at|completed_at|clock_in|clock_out|started_at|ended_at|opened_at|closed_at|refunded_at|transferred_at|performed_at|paid_at|sold_at|occurred_at|recorded_at)'

  const BANNED: Array<[RegExp, string]> = [
    [new RegExp(`DATE\\s*\\(\\s*\\w*\\.?${TS}\\s*\\)\\s*=\\s*CURRENT_DATE`, 'i'),
      '"today" read as the UTC day — use storeDayRange(tz) and a half-open range'],
    [new RegExp(`\\w*\\.?${TS}\\s*::\\s*date\\s*=\\s*current_date`, 'i'),
      '"today" read as the UTC day — use storeDayRange(tz) and a half-open range'],
    [new RegExp(`DATE\\s*\\(\\s*\\w*\\.?${TS}\\s*\\)\\s*(?:=|>=|<=|<|>)\\s*\\$\\{`, 'i'),
      'a supplied date compared against a UTC-cut timestamp — use storeDay(col, tz) or storeDayRange'],
    [new RegExp(`\\w*\\.?${TS}\\s*(?:>=|<=|<|>)\\s*\\(?\\s*\\$\\{[^}]*\\}\\s*::\\s*date`, 'i'),
      'a range bound built from a UTC-cut date — use storeDayRange(tz, date).start / .end'],
    [/date_trunc\(\s*'(?:week|month|year|day)'\s*,\s*now\(\)\s*\)/i,
      '"this week/month/year" read on the server clock — derive it from storeToday(tz)'],
    [/new Date\(\)\.toISOString\(\)\s*\.\s*(?:slice\(0,\s*10\)|split\(['"]T['"]\)\[0\])/,
      'a default date taken as the UTC date — use storeToday(tz)'],
  ]

  // Three places take the UTC date on purpose, and each is named with its reason rather than left
  // to a looser pattern. A NEW occurrence anywhere still fails; these do not.
  //
  //   audit.ts      — the date in a downloaded CSV's FILENAME. Not a query bound; a filename is
  //                   allowed to be the plain ISO date, and it is what the file's own metadata says.
  //   seo-pages.ts  — <lastmod> in the sitemap. The sitemap protocol specifies W3C datetime, which
  //                   is UTC-based; a search engine is not in the shop's timezone.
  //   tax-filing.ts — the "Superseded <date>:" stamp prefixed to a note, and the due dates computed
  //                   by month arithmetic. Neither decides which sales fall in a period.
  const UTC_DATE_IS_INTENDED: Record<string, RegExp> = {
    'audit.ts': /filename="audit-log-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}\.csv"/,
    'seo-pages.ts': /const lastmod = [^\n]*/,
    'tax-filing.ts': /const stamp = `Superseded \$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}/,
  }

  for (const f of files) {
    const rel = `${dir}/${f}`
    const raw = read(rel)
    let src = code(raw)
    // Blank out the one exempt expression in this file, if it has one, so the rest is still checked.
    const exempt = UTC_DATE_IS_INTENDED[f]
    if (exempt) {
      if (!exempt.test(raw)) fail(`${rel} carries an exemption in this guard that no longer matches anything — delete the exemption or restore what it described`)
      src = src.replace(exempt, '/* exempt: see UTC_DATE_IS_INTENDED */')
    }
    for (const [re, why] of BANNED) {
      const m = src.match(re)
      if (m) fail(`${rel}: ${why}\n        found: ${m[0].trim().slice(0, 100)}`)
    }
  }
}

// ── 3. a route that decides a day must get its zone from the one resolver ────────────────────────
{
  const dir = `${BACKEND}/routes`
  const files = readdirSync(ROOT + dir).filter((f) => f.endsWith('.ts')).sort()
  for (const f of files) {
    const rel = `${dir}/${f}`
    const src = code(read(rel))
    const decidesADay = /storeDay\(|storeDayRange\(|storeRange\(|inStoreZone\(|storeToday\(/.test(src)
    if (!decidesADay) continue
    if (!/\bzoneFor\b|\bstoreTimeZone\(/.test(src))
      fail(`${rel} decides which day a row belongs to but never resolves the store's zone — pass zoneFor(companyId)`)
    // …and must not have gone back to asking the question itself. The four copies of this lookup
    // are exactly why zoneFor exists.
    if (/select\(\{\s*settings: company\.settings, state: company\.state\s*\}\)/.test(src))
      fail(`${rel} re-implements the company→zone lookup — call zoneFor(companyId)`)
  }
}

// ── 4. the routes this was actually reported on stay fixed ───────────────────────────────────────
{
  // Named individually because each was a separate real defect, and a regression in any one of them
  // is a specific thing a shop would feel.
  const named: Array<[string, RegExp, string]> = [
    [`${BACKEND}/routes/scheduling.ts`, /AND te\.clock_in >= \$\{storeDayRange\(tz, startDate\)\.start\}/,
      'payroll: an evening shift must be paid on the day it was worked'],
    [`${BACKEND}/routes/scheduling.ts`, /\$\{storeDay\(sql`te\.clock_in`, tz\)\} as date/,
      'payroll: the work date on screen must be the day it was filtered into'],
    [`${BACKEND}/routes/tax-filing.ts`, /const rangeStart = DATE_ONLY\.test\(String\(startStr\)\) \? storeDayRange\(tz, String\(startStr\)\)\.start : periodStart/,
      'tax: a bare period date means the store\'s day, not UTC midnight'],
    [`${BACKEND}/routes/tax-filing.ts`, /AND o?\.?completed_at < \$\{rangeEnd\}/,
      'tax: the period end is half-open on the store\'s day'],
  ]
  for (const [rel, re, what] of named) {
    if (!re.test(read(rel))) fail(`${rel} — ${what}`)
  }
  // tax-filing has FOUR queries sharing one pair of bounds. Three of four fixed looks green unless
  // the count is checked; that is exactly what the first mutation run on this showed.
  const tax = read(`${BACKEND}/routes/tax-filing.ts`)
  const starts = (tax.match(/completed_at >= \$\{rangeStart\}/g) || []).length
  const ends = (tax.match(/completed_at < \$\{rangeEnd\}/g) || []).length
  if (starts !== 4 || ends !== 4)
    fail(`tax-filing.ts must bound all FOUR of its period queries on the store day — found ${starts} start(s) and ${ends} end(s), expected 4 and 4`)
}

console.log(failed ? `\n${failed} failure(s)` : 'ok: a calendar day is the store\'s day')
process.exit(failed ? 1 : 0)
