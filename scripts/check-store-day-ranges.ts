// CI guard: a report's date range is read on the STORE's clock, and its filter agrees with its grouping.
//
// The dispensary reports the same money on four surfaces — the dashboard tile, the analytics page, the
// end-of-day cash sheet and the state compliance report. T24 N1 moved the tile, the cash sheet and the
// analytics *bucketing* onto the store's zone. What it left behind was the RANGE:
//
//     const start = new Date(startDate + 'T00:00:00')        // ← no zone suffix
//     const end   = new Date(endDate   + 'T23:59:59.999')
//
// A bare datetime with no `Z` is parsed in the SERVER's zone, and Render runs UTC. Two consequences,
// both live until T27 H2:
//
//   * analytics answered for the UTC day while the dashboard beside it answered for the store's day,
//     so one screen said Saturday took $150 and the other said $100;
//   * the compliance report GROUPED by the store's day but FILTERED on the server's, so within one
//     query the two disagreed — asked for a single Saturday it lost that evening's trade and grew a
//     phantom row for a Friday nobody asked about, on the one figure a regulator reads.
//
// Neither was caught by the existing tests, because both ask for a multi-day window and a boundary
// fault only shows at the boundary. Hence a guard rather than another test.
//
// Three rules:
//   1. a reporting range is built from the store-day helpers, never from a bare datetime;
//   2. "today" in a reporting route is the store's date, never toISOString();
//   3. a range end is half-open (`< end`), matching the dashboard — an inclusive `<= 23:59:59.999`
//      both drops the final millisecond and invites the bare-datetime form back.
//
//   bun scripts/check-store-day-ranges.ts
import { readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const BACKEND = 'templates/crm-dispensary/backend/src'
// Every route that answers "what happened on day X". dashboard.ts is included because it is the
// reference implementation the others have to agree with.
const REPORTING = [
  `${BACKEND}/routes/analytics.ts`,
  `${BACKEND}/routes/compliance.ts`,
  `${BACKEND}/routes/dashboard.ts`,
  `${BACKEND}/routes/eod.ts`,
]

/** Source with comments removed — a rule about code must not be satisfied (or tripped) by prose. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const read = (rel: string) => {
  try { return readFileSync(ROOT + rel, 'utf8') } catch { fail(`${rel} is missing`); return '' }
}

// ── 1. no reporting range is built from a bare datetime ───────────────────────────────────────────
{
  // `'T00:00:00'` / `'T23:59:59'` with no trailing Z. The Z-suffixed form is an explicit UTC instant
  // and is a different (legitimate) thing, so it is not matched here.
  const BARE = /['"`]T(?:00:00:00|23:59:59)(?:\.\d+)?['"`]/
  for (const rel of REPORTING) {
    const src = code(read(rel))
    if (BARE.test(src))
      fail(`${rel} builds a date bound from a bare datetime — with no zone suffix that is the SERVER's midnight, and Render runs UTC. Use storeDayRange(tz, date).`)
  }
}

// ── 2. "today" in a reporting route is the store's date ───────────────────────────────────────────
{
  for (const rel of REPORTING) {
    const src = code(read(rel))
    // `new Date().toISOString()` sliced to a date names the UTC day. After 8pm in Ohio that is
    // TOMORROW, so an evening manager opened the page to a day that had barely begun.
    if (/new Date\(\)\.toISOString\(\)\s*\.\s*(?:slice\(0,\s*10\)|split\(['"]T['"]\)\[0\])/.test(src))
      fail(`${rel} defaults a reporting day to the UTC date — use storeDateString(new Date(), tz).`)
  }
}

// ── 3. range ends are half-open ───────────────────────────────────────────────────────────────────
{
  // A comparison of a TIMESTAMP column against an interpolated end bound must be `<`, not `<=`.
  //
  // `<= ${endDate}::date` is deliberately not matched: eod.ts lists past reports by filtering the
  // eod_reports.date DATE column, where an inclusive end is the correct and obvious meaning. This
  // rule is about instants, not calendar dates.
  const INCLUSIVE_END = /<=\s*\$\{\s*(?:end|endDate|dayEnd|tomorrow)\s*\}(?!\s*::\s*date)/
  for (const rel of REPORTING) {
    const src = read(rel)
    const m = src.match(INCLUSIVE_END)
    if (m)
      fail(`${rel} closes a timestamp range with an inclusive ${m[0]} — the dashboard is half-open (\`>= start AND < end\`) and the two have to agree. An inclusive 23:59:59.999 also drops the last millisecond of the day.`)
  }
}

// ── 4. the filter and the grouping are read on the same clock ─────────────────────────────────────
{
  // If a file decides which DAY a row belongs to by converting a timestamp into the store's zone, and
  // it ALSO filters that timestamp against an interpolated bound, then the bound must come from the
  // store-day helpers. That is the compliance fault exactly: the grouping had been migrated onto the
  // store's clock and the filter had been left on the server's, so the two disagreed inside one query.
  //
  // A route that instead compares `DATE(ts AT TIME ZONE …) = ${day}::date` has no instant-range to get
  // wrong — eod.ts does this, and is right to. The precondition below exempts it.
  const GROUPS_BY_STORE_DAY = /AT TIME ZONE 'UTC' AT TIME ZONE \$\{/
  const HAS_TIMESTAMP_RANGE = /\b(?:created_at|completed_at|transferred_at|refunded_at|updated_at)\b[^\n]*?(?:>=|<=?)\s*\$\{\s*(?:start|startDate|dayStart|today|end|endDate|dayEnd|tomorrow)\s*\}/
  const USES_STORE_RANGE = /storeDayRange\s*\(/
  for (const rel of REPORTING) {
    const src = code(read(rel))
    if (GROUPS_BY_STORE_DAY.test(src) && HAS_TIMESTAMP_RANGE.test(src) && !USES_STORE_RANGE.test(src))
      fail(`${rel} groups rows by the STORE's day but builds its timestamp range some other way — the filter and the grouping would disagree inside one query. Use storeDayRange.`)
  }
}

// ── 5. the helpers themselves still mean what the callers assume ──────────────────────────────────
{
  const iso = read(`${BACKEND}/utils/isoTime.ts`)
  if (!/export function storeDayRange/.test(iso))
    fail('utils/isoTime.ts must export storeDayRange — it is the single definition of "one store day"')
  // Half-open by construction: the end is the START of the next day, not 23:59:59.999 of this one.
  if (!/const end = storeDayStart\(next\.toISOString\(\)\.slice\(0, 10\), tz\)/.test(iso))
    fail('storeDayRange must end at the start of the NEXT day (half-open), or every caller\'s `< end` silently changes meaning')
  if (!/export function storeDateString/.test(iso))
    fail('utils/isoTime.ts must export storeDateString — it is how a route asks for the store\'s "today"')
}

// ── 6. the two routes that were fixed still route through their local helper ──────────────────────
{
  const analytics = code(read(`${BACKEND}/routes/analytics.ts`))
  if (!/const storeRange = \(tz: string/.test(analytics))
    fail('analytics.ts must keep its storeRange helper — five endpoints share it, and the defect was five copies of the same bad range')
  // Every endpoint must use it; counting is how a newly-added sixth endpoint gets caught. The
  // definition reads `const storeRange = (tz` and so is not itself a call site.
  const endpoints = (analytics.match(/^app\.get\(/gm) || []).length
  const uses = (analytics.match(/storeRange\(/g) || []).length
  if (uses < endpoints)
    fail(`analytics.ts has ${endpoints} endpoints but only ${uses} use storeRange — every one of them reports by day`)

  const compliance = code(read(`${BACKEND}/routes/compliance.ts`))
  if (!/const reportRange = \(start: string, end: string, tz: string\)/.test(compliance))
    fail('compliance.ts must keep its reportRange helper')
  if (!/reportRange\(data\.startDate, data\.endDate, tzDay\)/.test(compliance))
    fail('compliance.ts must build the report window with reportRange and the store zone')
}

console.log(failed ? `\n${failed} failure(s)` : 'ok: reporting ranges are read on the store\'s clock')
process.exit(failed ? 1 : 0)
