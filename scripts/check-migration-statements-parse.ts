// CI guard: every statement a migration splits into is a statement, not the back half of a sentence.
//
//   vettest's log, on every boot since 2026-10-03:
//     [migrate] Attempt 1/20...
//     error: syntax error at or near "`"
//     [migrate] Connection failed, retrying in 10s...   ← it was not the connection
//     … twenty times …
//     [migrate] Failed after 20 attempts
//
// WHAT CAUSED IT. drizzle splits a migration file on the literal text `-->` + ` statement-breakpoint`
// wherever it appears. 0029_bill_once_constraints.sql ends with a comment explaining the convention,
// and that comment QUOTES the token:
//
//     -- `-->` + ` statement-breakpoint` between every statement is the Drizzle convention, and it is not
//     -- cosmetic: both drizzle-kit migrate and the test harness's setup.ts split the file on it.
//
// The splitter does not know it is inside a comment. It cuts there, and the fragment after the cut
// begins mid-sentence — with a backtick. Postgres is handed a backtick where a statement should be,
// the whole run is one transaction, and so the run dies. Not just that migration: EVERY migration
// after it, for ever, on every tenant that had not already applied them.
//
// On crm-vet that was 0029 through 0034 — the bill-once unique indexes, warranty_claim.job_id, and
// the duplicate-invoice heal. INV-00053 stayed two live drafts through three deploys that each
// shipped a fix for it, because the fix could not be applied. A comment about statement breakpoints
// broke the statement breakpoints.
//
// THE RULE. Split every migration exactly as drizzle does, and require each fragment to begin like a
// SQL statement. A fragment starting with a backtick, a quote, a lone word that is not a SQL verb —
// anything that cannot be the first token of a statement — fails. The second rule follows from the
// cause: the breakpoint token may not appear on a comment line at all, because a comment cannot
// contain it without being cut in half.
//
// WHY A GUARD AND NOT JUST THE FIX. Nothing else could see this. The suites replay migrations with
// the harness's own splitter and were green. The deploy went "live", because the server starts
// anyway. And migrate.ts calls every failure "Connection failed", so the log reads like a cold
// database. The only place the truth existed was a Render log line nobody was reading.
//
//   bun scripts/check-migration-statements-parse.ts
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (msg: string) => { console.error(`FAIL: ${msg}`); failed++ }

// The exact token drizzle cuts on, built in pieces so this file does not cut itself when it is read
// by anything that applies the same rule.
const BREAKPOINT = '--' + '> ' + 'statement-breakpoint'

// The first word of a statement in these migrations. Anything else is the tail of a sentence.
const SQL_VERBS = /^(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|WITH|SELECT|SET|COMMENT|GRANT|REVOKE|TRUNCATE|DO|BEGIN|COMMIT|ANALYZE|VACUUM|REINDEX|REFRESH)\b/i

const files: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 7) return
  let names: string[] = []
  try { names = readdirSync(dir) } catch { return }
  for (const n of names) {
    if (n === 'node_modules' || n === '.git' || n === 'dist') continue
    const p = join(dir, n)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, depth + 1)
    else if (n.endsWith('.sql') && /migrations/.test(p.replace(/\\/g, '/'))) files.push(p)
  }
}
for (const top of ['templates', 'packages', 'apps']) if (existsSync(join(ROOT, top))) walk(join(ROOT, top))

if (files.length < 100) fail(`only ${files.length} migration file(s) found — the walk is not reaching them, so this guard is proving nothing`)

/** Strip comments and whitespace to find what a fragment actually starts with. */
const firstCode = (sql: string): string => {
  const lines = sql.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('--')) continue
    out.push(trimmed)
    if (out.length > 2) break
  }
  return out.join(' ').trim()
}

let checked = 0
for (const f of files.sort()) {
  const rel = f.slice(ROOT.length).replace(/\\/g, '/')
  const src = readFileSync(f, 'utf8')

  // Rule 2 first, because it names the cause rather than the symptom.
  //
  // drizzle-kit itself writes the token immediately after a statement on the same line
  // (`CREATE INDEX …;` then the token), and that is correct — the split leaves a whole statement on
  // each side. What is never correct is the token appearing after a `--`, because then the text it
  // cuts in half is a comment, and the half that follows is prose.
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const at = line.indexOf(BREAKPOINT)
    if (at < 0) continue
    if (!line.slice(0, at).includes('--')) continue // after a statement, or on its own line: fine
    fail(`${rel}:${i + 1}: the statement-breakpoint token is quoted INSIDE A COMMENT —\n`
      + `      ${line.trim().slice(0, 120)}\n`
      + `      drizzle cuts the file wherever that token appears and does not know it is in a comment, so this\n`
      + `      cuts the sentence in half and hands Postgres the rest of it. Describe the token without writing it.`)
  }

  // Rule 1: every fragment must begin like a statement.
  const fragments = src.split(BREAKPOINT)
  for (let i = 0; i < fragments.length; i++) {
    const code = firstCode(fragments[i])
    if (!code) continue // comment-only or blank fragment: drizzle sends nothing worth refusing
    checked++
    if (!SQL_VERBS.test(code)) {
      fail(`${rel}: statement ${i + 1} of ${fragments.length} does not begin like SQL —\n`
        + `      starts: ${JSON.stringify(code.slice(0, 110))}\n`
        + `      Postgres would answer "syntax error at or near" the first token here.`)
    }
  }
}

console.log(`${files.length} migration file(s), ${checked} statement(s) checked.`)
if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1) }
console.log('Every statement begins like SQL, and no file reproduces the breakpoint token inside other text.')
