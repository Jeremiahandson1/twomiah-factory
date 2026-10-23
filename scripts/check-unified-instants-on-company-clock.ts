// CI guard: the admin screens print a stored MOMENT on the company's clock, never the reader's (2026-10-22) — and every
// "today", every hour read off a moment, every typed date-and-time and every due/expiry day is the company's too
// (2026-10-23).
//
// `new Date(createdAt).toLocaleString()` prints in whatever zone the browser is in: an owner travelling, or a tester's
// cloud browser on UTC, read a quote approved at 8:30 PM in Chicago as "1:30 AM on the 23rd". Every screen now prints
// moments through packages/tenant-ui/src/time/companyClock.ts (whenDate / whenDateTime / whenTime / momentDate), which
// uses the company's zone from the session. This fails on any `new Date(<value>).toLocale[Date|Time]String(...)` in
// the admin screens or the shared ones that names no timeZone — except a date BUILT from a day ('T12:00:00',
// 'T00:00:00', a template string, or several numbers), which is a calendar day, not a moment.
//
// The same sweep found the other halves of one rule, each its own bug on a screen or in a query:
//   · today as UTC's day — `new Date().toISOString().slice(0, 10)` (screens and server): tomorrow every evening
//   · today as the BROWSER's day — `toLocalYMD(new Date())`, `localDayKey(new Date())` (screens): use todayKey() /
//     companyTodayKey(), or the home care agency's agencyToday()
//   · an hour read off a moment with the browser's getters — `.getHours()` / `.getMinutes()` (screens): use
//     companyHHMM / companyMinutes / companyWall (agencyWall in home care)
//   · a typed day and time parsed on the browser's clock — new Date(`${day}T${time}`) (screens): companyMoment /
//     companyFromLocalInput (agencyMoment / agencyFromLocalInput in home care)
//   · a due / expiry / renewal / warranty DAY compared with the moment now (screens): isPastDay / daysUntilDay /
//     agencyDayHasBegun — the day is the company's, whole
//   · CURRENT_DATE in a query (server): the DATABASE's day, UTC — pass the company's (agencyClock / businessToday)
//
// Home care prints through its own agency clock (crm/pages/homecare/lib/agencyClock.ts); the toLocale rule does not
// walk it, the others do.
//
//   bun scripts/check-unified-instants-on-company-clock.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SCREENS = ['packages/tenant-ui/src', 'apps/unified/web/src'].map((d) => join(ROOT, d))
const SERVER = ['packages/tenant-backend/src', 'apps/unified/server'].map((d) => join(ROOT, d))
/** The clocks themselves are where the zone arithmetic lives. */
const CLOCKS = [/time[\\/]companyClock\.ts$/, /homecare[\\/]lib[\\/]agencyClock\.ts$/]
const HOMECARE = /[\\/]homecare[\\/]/

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  if (n === 'node_modules') return []
  return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
})
/** Comments out: prose about the rule is not a breach of it. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const CALL = /new Date\(((?:[^()]|\([^()]*\))*)\)\.toLocale(Date|Time)?String\(([^()]*(?:\([^()]*\))?[^()]*)\)/g

interface Rule { name: string; re: RegExp; fix: string; skip?: (file: string, match: RegExpMatchArray) => boolean }
const UTC_TODAY: Rule = {
  name: 'today as UTC\'s day',
  re: /new Date\(\)\.toISOString\(\)\.(?:slice\(0, ?10\)|split\('T'\)\[0\]|substring\(0, ?10\))/g,
  fix: 'today is the company\'s: todayKey() / companyTodayKey() on a screen, storeDateString(now, companyTimeZone) or businessToday on the server',
}
const SCREEN_RULES: Rule[] = [
  UTC_TODAY,
  {
    name: 'today as the browser\'s day',
    re: /\b(?:toLocalYMD|localDayKey|toYMD)\(new Date\(\)\)/g,
    fix: 'todayKey() / companyTodayKey(), or agencyToday() in home care',
  },
  {
    name: 'an hour read with the browser\'s getters',
    re: /\.get(?:Hours|Minutes)\(\)/g,
    fix: 'companyHHMM / companyMinutes / companyWall (agencyWall in home care)',
  },
  {
    name: 'a typed day and time parsed on the browser\'s clock',
    re: /new Date\(`\$\{[^`]*\}T\$\{[^`]*`\)/g,
    fix: 'companyMoment(day, time) / companyFromLocalInput (agencyMoment / agencyFromLocalInput in home care)',
  },
  {
    name: 'a due / expiry day compared with the moment now',
    re: /(?:new Date|parseLocalDate)\([^()]*(?:due|Due|expir|Expir|renew|Renew|warranty|Warranty)[^()]*\)\s*(?:<|<=|>|>=)\s*new Date\(\)/g,
    fix: 'the day is the company\'s, whole: isPastDay / daysUntilDay (agencyDayHasBegun in home care)',
    // A support SLA deadline is a moment (resolve within N hours), not a day: comparing it with now is the rule.
    skip: (_f, m) => /\bsla[A-Z]/.test(m[0]),
  },
]
const SERVER_RULES: Rule[] = [
  UTC_TODAY,
  {
    name: 'CURRENT_DATE (the database server\'s day, UTC)',
    re: /\bCURRENT_DATE\b/g,
    fix: 'compare with the company\'s today, passed in: agencyClock(q, companyId) in home care, businessToday(companyTimeZone) elsewhere',
  },
]

let found = 0
const report = (file: string, src: string, index: number, text: string, why: string, fix: string) => {
  const line = src.slice(0, index).split('\n').length
  console.error(`FAIL ${relative(ROOT, file).replace(/\\/g, '/')}:${line}  ${why}: ${text.slice(0, 100)}`)
  console.error(`     ${fix}`)
  found++
}
for (const dir of SCREENS) {
  for (const file of walk(dir)) {
    if (CLOCKS.some((r) => r.test(file))) continue
    const src = code(readFileSync(file, 'utf8'))
    if (!HOMECARE.test(file)) {
      for (const m of src.matchAll(CALL)) {
        const [all, arg, , opts] = m
        if (/timeZone/.test(opts)) continue
        if (!arg.trim()) continue // now
        if (/T12:00:00|T00:00:00|`/.test(arg) || /^[^(]*,/.test(arg)) continue // a day built from parts
        report(file, src, m.index!, all, 'a moment printed on the reader\'s clock', 'print it with whenDateTime / momentDate / whenTime (packages/tenant-ui/src/time/companyClock.ts)')
      }
    }
    for (const rule of SCREEN_RULES) for (const m of src.matchAll(rule.re)) if (!rule.skip?.(file, m)) report(file, src, m.index!, m[0], rule.name, rule.fix)
  }
}
for (const dir of SERVER) {
  for (const file of walk(dir)) {
    const src = code(readFileSync(file, 'utf8'))
    for (const rule of SERVER_RULES) for (const m of src.matchAll(rule.re)) report(file, src, m.index!, m[0], rule.name, rule.fix)
  }
}
if (found) { console.error(`\n${found} place(s) off the company's clock`); process.exit(1) }
console.log('on the company clock: no moment printed, no today, no hour, no typed time and no due day read off the reader\'s or the database\'s clock')
