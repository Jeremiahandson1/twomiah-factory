// CI guard: home care prints a time of day on the AGENCY's clock, never the browser's or the server's.
//
// Run 5: Caregiver A clocked in at 4:00 PM Central; Shift Approvals showed "Oct 16, 9:00 PM" — the
// tester's browser was on UTC, and the screen printed the punch with a bare toLocaleString(). About
// forty office and caregiver screens did the same, and the server (UTC on Render) stamped "today" on
// a client document from its own clock. The cure is one zone, named by the server:
//   frontend — utils/agencyClock.ts (formatAgencyDateTime / formatAgencyDate) and utils/datetime.ts
//              (formatDateTime / formatTime / formatDateTZ), whose zone AuthContext adopts at sign-in
//              from company.effectiveTimezone (and the portals from their own endpoints);
//   backend  — services/agencyTime.ts (agencyTimezone, agencyToday, ymdIn, dayStartUtc …).
//
// Rules, over every .ts/.tsx under templates/crm-homecare/{frontend/src,backend/src} (the helpers
// themselves excepted), comments stripped:
//   1. `.toLocaleTimeString(` with no `timeZone` in its arguments.
//   2. `.toLocaleString(` / `.toLocaleDateString(` whose arguments name `hour`/`minute` and no `timeZone`.
//   3. `.toLocaleString()` with no arguments on a Date — `new Date(…)` or a receiver named like one
//      (d, dt, date, …At, …_at, …Date, …Time, timestamp). Numbers (`n.toLocaleString()`) are fine.
//   4. backend: `new Date().toLocaleDateString(` — "today" on the server's (UTC) clock.
// Plus the wiring: sign-in's company summary and GET/PUT /api/company send effectiveTimezone, and
// AuthContext hands it to setAgencyTimezone before the screens mount.
// The rules are checked against planted samples (aliases included) first.
//   bun scripts/check-homecare-instants-on-agency-clock.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripSource as strip } from './lib/stripComments.ts'

const TPL = new URL('../templates/crm-homecare/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const EXEMPT = new Set(['frontend/src/utils/agencyClock.ts', 'frontend/src/utils/datetime.ts', 'backend/src/services/agencyTime.ts'])

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/** Every `.<method>(` call: the receiver text just before it and the argument list (balanced). */
function calls(src: string, method: string): { recv: string; args: string; at: number }[] {
  const out: { recv: string; args: string; at: number }[] = []
  const re = new RegExp(`\\.\\s*${method}\\s*\\(`, 'g')
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
    out.push({ recv: src.slice(Math.max(0, m.index - 80), m.index), args: src.slice(start, i - 1), at: m.index })
  }
  return out
}

const DATE_RECV = /(?:new\s+Date\s*\([^()]*(?:\([^()]*\)[^()]*)*\)|(?:^|[^\w.])(?:[\w$]+\??\.)*(?:d|dt|date|now|[A-Za-z_]*At|[A-Za-z_]*_at|[A-Za-z_]*Date|[A-Za-z_]*Time|timestamp))\s*\)?\s*$/
const HAS_TZ = /timeZone/
const NAMES_TIME = /\b(hour|minute)\b/

function verdict(method: string, recv: string, args: string, side: 'frontend' | 'backend'): string | null {
  if (HAS_TZ.test(args)) return null
  if (method === 'toLocaleTimeString') return 'prints a time of day on the viewer\'s clock'
  if (NAMES_TIME.test(args)) return 'prints a time of day on the viewer\'s clock'
  if (method === 'toLocaleString' && !args.trim() && DATE_RECV.test(recv)) return 'prints a date and time on the viewer\'s clock'
  if (side === 'backend' && method === 'toLocaleDateString' && /new\s+Date\s*\(\s*\)\s*$/.test(recv)) return 'stamps "today" from the server\'s UTC clock'
  return null
}

// ── the rules, against planted samples ────────────────────────────────────────────────────────────
const MUST_FLAG: [string, string, string, 'frontend' | 'backend'][] = [
  ['toLocaleString', 'const s = new Date(t.clock_in)', '', 'frontend'],
  ['toLocaleString', 'const s = d', "'en-US', { month: 'short', hour: 'numeric', minute: '2-digit' }", 'frontend'],
  ['toLocaleTimeString', 'x = punchAt', "[], { hour: '2-digit' }", 'frontend'],
  ['toLocaleTimeString', 'lastSynced', '', 'frontend'],
  ['toLocaleString', '{row.created_at', '', 'frontend'],
  ['toLocaleString', '(viewDoc.signedAt', '', 'frontend'],
  ['toLocaleDateString', 'DATE: new Date()', '', 'backend'],
]
const MUST_PASS: [string, string, string, 'frontend' | 'backend'][] = [
  ['toLocaleString', 'const total = n', '', 'frontend'],
  ['toLocaleString', '(summary.impressions', '', 'frontend'],
  ['toLocaleTimeString', 'new Date(iso)', "'en-US', { hour: 'numeric', timeZone: data?.timezone || undefined }", 'frontend'],
  ['toLocaleString', 'currentDate', "'default', { month: 'long', year: 'numeric' }", 'frontend'],
  ['toLocaleDateString', 'new Date(s + \'T12:00:00\')', "'en-US', { weekday: 'short' }", 'frontend'],
]
for (const [m, r, a, side] of MUST_FLAG) if (!verdict(m, r, a, side)) fail(`self-test: the rule no longer catches ${r}.${m}(${a})`)
for (const [m, r, a, side] of MUST_PASS) if (verdict(m, r, a, side)) fail(`self-test: the rule wrongly flags ${r}.${m}(${a})`)

// ── the sweep ─────────────────────────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p, out) }
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p)
  }
  return out
}
let files = 0, seen = 0
for (const side of ['frontend', 'backend'] as const) {
  for (const file of walk(join(TPL, side === 'frontend' ? 'frontend/src' : 'backend/src'))) {
    const rel = relative(TPL, file).replace(/\\/g, '/')
    if (EXEMPT.has(rel)) continue
    files++
    const src = strip(readFileSync(file, 'utf8'))
    for (const method of ['toLocaleString', 'toLocaleTimeString', 'toLocaleDateString']) {
      for (const c of calls(src, method)) {
        seen++
        const why = verdict(method, c.recv, c.args, side)
        if (why) fail(`${rel}:${src.slice(0, c.at).split('\n').length}: .${method}(${c.args.slice(0, 50)}) ${why} — use the agency-clock helpers (utils/agencyClock.ts, utils/datetime.ts; backend services/agencyTime.ts)`)
      }
    }
  }
}

// ── the wiring ────────────────────────────────────────────────────────────────────────────────────
const read = (p: string) => readFileSync(join(TPL, p), 'utf8')
const auth = read('backend/src/routes/auth.ts')
if (!/function companySummary[\s\S]{0,900}?effectiveTimezone:\s*resolveTimezone\(/.test(auth)) fail('routes/auth.ts companySummary must send effectiveTimezone: resolveTimezone(agency) (sign-in and /me)')
const company = read('backend/src/routes/company.ts')
const companyEffective = (company.match(/effectiveTimezone:\s*resolveTimezone\(/g) || []).length
if (companyEffective < 2) fail(`routes/company.ts must send effectiveTimezone on GET / and PUT / (found ${companyEffective})`)
const ctx = read('frontend/src/contexts/AuthContext.tsx')
if (!/setAgencyTimezone\(\s*company\?\.effectiveTimezone\s*\)/.test(ctx)) fail('AuthContext must hand company.effectiveTimezone to setAgencyTimezone')
const adopts = (ctx.match(/adoptClock\(/g) || []).length
if (adopts < 4) fail(`AuthContext must adopt the clock on /me, on sign-in (summary first, then the company) — found ${adopts - 1} call(s)`)
const dt = read('frontend/src/utils/datetime.ts')
for (const fn of ['formatTime', 'formatDateTime', 'formatDateTZ']) {
  const body = dt.match(new RegExp(`export function ${fn}\\([\\s\\S]*?\\n}`))?.[0] || ''
  if (!/timeZone:\s*agencyTimezone\(\)/.test(body)) fail(`utils/datetime.ts ${fn} must print on timeZone: agencyTimezone()`)
}

if (failed) { console.error(`\nhome care agency clock: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`home care agency clock: ${seen} toLocale* calls in ${files} files; every time of day is on the agency's clock`)
