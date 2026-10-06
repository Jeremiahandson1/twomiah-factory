// CI guard: a CLOCK TIME deliberately converted into another timezone must say which one.
//
//   "Events: the two-factor timestamp has no timezone."
//
// Three screens converted a timestamp into the company's zone and then printed no name for it: the
// shared audit log, the shared bookings list, and the dispensary's kiosk last-seen column. Each
// conversion exists for a good reason — an audit entry has to line up with the record it belongs to
// (T41), a booking is the shop's two o'clock not the reader's, a kiosk was last seen on store time
// (T43 N11) — and each then threw away the one fact that makes the converted time readable. An owner
// checking from another state cannot tell whose clock they are looking at, which is the exact problem
// the conversion was added to solve.
//
// THE RULE: if a format options object sets `timeZone`, renders an HOUR, and its result is SHOWN to a
// person, it must also set `timeZoneName`.
//
// The two exclusions are not conveniences, they are the difference between display and arithmetic, and
// the first draft of this guard got it wrong: it flagged eleven correct call sites.
//
//   - `.formatToParts(` is how this codebase reads a wall clock in a zone to compute an offset
//     (isoTime.ts, salonDate.ts, businessDay.ts, booking/time.ts tzParts). Nobody reads that output;
//     adding a zone name to it would put a junk part into the arithmetic.
//   - a result immediately `.split()` apart is also arithmetic, not a sentence — aiReceptionist formats
//     "HH:MM" and splits it to compare against business hours, in eight templates.
//
// A date-only format ("which calendar day, in the store's zone") shows no clock and is not caught: that
// is a different question, and a correct one to ask.
//
// Shorthand counts. `{ timeZone, hour: 'numeric' }` is the same instruction as `{ timeZone: tz, … }`,
// and the first draft matched only the colon form — so it missed formatWhen(), which is the time that
// goes into a booking confirmation email and the realest instance of the whole finding.
//   bun scripts/check-converted-time-names-its-zone.ts
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
// Parked templates may not be modified, so a rule nobody is allowed to satisfy would fail for ever.
const PARKED = ['crm-automotive', 'crm-homecare']

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === 'shared' || name === '.git') continue
    if (PARKED.includes(name)) continue
    const p = join(dir, name)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const files: string[] = []
let templatesWalked = 0
for (const t of readdirSync(join(ROOT, 'templates'))) {
  if (!/^crm(-|$)/.test(t) || PARKED.includes(t)) continue
  templatesWalked++
  walk(join(ROOT, 'templates', t), files)
}
if (templatesWalked < 10) fail(`only ${templatesWalked} CRM template(s) were walked — this guard is looking in the wrong place`)
walk(join(ROOT, 'packages'), files)

/**
 * The options object a `timeZone:` sits in.
 *
 * Read by brace-matching outward from the key rather than by a regex over one line: these objects are
 * written inline across one or several lines, and a line-wise check would miss a multi-line one and
 * mis-read a nested one. The scan walks back to the opening brace and forward to its match.
 */
function enclosingBraces(src: string, at: number): { start: number; end: number } | null {
  let depth = 0
  let start = -1
  for (let i = at; i >= 0; i--) {
    if (src[i] === '}') depth++
    else if (src[i] === '{') {
      if (depth === 0) { start = i; break }
      depth--
    }
  }
  if (start < 0) return null
  depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return { start, end: i + 1 }
    }
  }
  return null
}

/**
 * THE WHOLE CALL the timeZone sits in, plus its name.
 *
 * Earlier drafts tried to isolate the options OBJECT, and the options object is not a reliable target:
 *
 *   `{ timeZoneName: 'short', ...(tz ? { timeZone: tz } : {}) }`   the timeZone is in a nested object
 *                                                                   with no clock key in it
 *   `toLocaleString(undefined, tz ? { timeZone: tz } : undefined)`  the object is a ternary branch, not
 *                                                                   an argument
 *
 * Each of those is a site fixed this round, and each was invisible to a brace-walking version — the
 * first of them on the very screen this guard was written for. So it takes the enclosing CALL instead:
 * everything between the unmatched `(` and its match. Spreads, ternaries and nesting are all inside it
 * by construction, and the call's NAME comes out of the same scan — which matters, because
 * toLocaleString shows a clock with no options at all while Intl.DateTimeFormat shows one only if asked.
 */
function callAndOptions(src: string, at: number): { call: string; opts: string } | null {
  let probe = at
  // Not every `(` is a call. `...(tz ? { timeZone: tz } : {})` wraps the timeZone in a SPREAD's own
  // parentheses, and stopping there reads a group with no clock key in it — which is how the audit log
  // slipped through a version of this that looked right. So: climb until the parentheses belong to
  // something NAMED.
  for (let level = 0; level < 6; level++) {
    let depth = 0
    let open = -1
    for (let i = probe; i >= 0 && probe - i < 4000; i--) {
      if (src[i] === ')') depth++
      else if (src[i] === '(') {
        if (depth === 0) { open = i; break }
        depth--
      }
    }
    if (open < 0) return null
    const before = src.slice(Math.max(0, open - 200), open)
    const m = before.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*$/)
    if (!m) { probe = open - 1; continue }

    depth = 0
    let close = -1
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') {
        depth--
        if (depth === 0) { close = i; break }
      }
    }
    if (close < 0) return null
    return { call: m[1], opts: src.slice(open, close + 1) }
  }
  return null
}

let checked = 0
let named = 0
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  const src = readFileSync(file, 'utf8')
  if (!src.includes('timeZone:')) continue
  const lines = src.split(/\r?\n/)

  // Both forms: `timeZone: tz` and the shorthand `timeZone` (followed by , or }).
  for (const m of src.matchAll(/\btimeZone\s*(?::|,|\})/g)) {
    const at = m.index!
    const lineNo = src.slice(0, at).split(/\r?\n/).length
    const line = lines[lineNo - 1] || ''
    // A comment explaining the rule is not an instance of it.
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue
    // The option NAME, not a variable called timeZone being declared or passed.
    if (/\b(?:const|let|var|function)\s+timeZone\b/.test(line)) continue

    const found = callAndOptions(src, at)
    if (!found) continue
    const { call, opts } = found

    /**
     * Does this format show a CLOCK? Only then does the zone need naming.
     *
     * toLocaleDateString is a calendar day and never does. toLocaleString and toLocaleTimeString show
     * a time by DEFAULT, with no options at all — which is the dispensary kiosk column, and the second
     * site the first draft of this guard could not see. Intl.DateTimeFormat shows one only if asked.
     */
    const dateOnlyCall = /toLocaleDateString$/.test(call)
    const timeByDefault = /toLocaleString$|toLocaleTimeString$/.test(call)
    const asksForClock = /\bhour\s*:/.test(opts) || /\btimeStyle\s*:/.test(opts)
    const showsClock = !dateOnlyCall && (asksForClock || (timeByDefault && !/\bdateStyle\s*:/.test(opts)))
    if (!showsClock) continue

    // ARITHMETIC, not display — see the exclusions in the header. The tail after the options object is
    // where the formatter says what it is for.
    const tail = src.slice(at, at + 600)
    if (/\.formatToParts\s*\(/.test(tail)) continue
    if (/\.split\s*\(/.test(tail)) continue

    checked++
    if (/\btimeZoneName\s*:/.test(opts)) { named++; continue }
    fail(
      `${rel}:${lineNo} converts a time into another zone and never says which — the reader cannot tell whose clock it is.\n`
      + `       Add timeZoneName: 'short' to the same options object.\n`
      + `       ${line.trim().slice(0, 140)}`,
    )
  }
}

if (checked === 0) fail('no timezone-converted clock times were found at all — this guard is no longer looking at anything')

if (failed) { console.error(`\nconverted time names its zone: ${failed} problem(s)`); process.exit(1) }
console.log(`converted time names its zone: all ${named} timezone-converted clock time(s) across ${templatesWalked} CRM templates and the shared packages name the zone they are shown in`)
