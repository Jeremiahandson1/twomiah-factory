// Home care's migrations own its schema, and the boot never lets drizzle-kit push undo them. (10/15)
//
// Found while preparing the 547 Eau Claire update. Every boot ends with `drizzle-kit push --force`, which makes the
// database match db/schema.ts — dropping whatever schema.ts does not declare. crm-homecare's schema is built by SQL
// migrations ported from CVHC, and schema.ts had fallen behind them: seven tables with rows (scheduled_visits,
// client_visit_notes, client_services, subscription, addon_purchase, usage_record, billing_invoice) and 23 columns
// (clients' emergency contacts, users.status …) were migrated but undeclared. Replayed into a scratch database, the
// real push CLI offered every one of those tables as a rename-or-drop, and once they were declared it still went on
// to drop CHECK constraints (invoice_line_items billed basis, the visit-photo size cap), partial indexes and foreign
// keys the migrations had made. It never did on a live agency only by accident: schema.ts referenced an undefined
// `company`, so push crashed before it diffed anything — one typo fix away from deleting a client's visit history.
//
// The rule: a template whose migrations own its schema carries db/NO_DRIZZLE_PUSH and the boot skips push there;
// db/reconcile.ts (additive only) still runs — home care was the one CRM without it, so tables declared only in
// schema.ts (audit_log, which background checks and leads write) never existed on a real agency, while the harness,
// which reconciles every template, built them and every test passed. schema.ts must still declare every migrated
// table and column, and may only reference tables it defines.
const { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, chmodSync } = await import('node:fs')
const { spawnSync } = await import('node:child_process')
const { join } = await import('node:path')
const { tmpdir } = await import('node:os')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PARKED = new Set(['crm-automotive'])
const HC = ROOT + 'templates/crm-homecare/backend/'

// ── 1. the boot step, run for real in a shell with bun/bunx stubbed: the marker skips push, its absence runs it
// Windows checkouts carry CRLF; CI's carry LF. Every regex below is written for LF.
const read = (p: string) => readFileSync(p, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
const deploySrc = read(ROOT + 'apps/api/src/services/deploy.ts')
const fnBody = deploySrc.match(/function dbReconcileStep\(\): string \{\s*return \(([\s\S]*?)\n  \)\n\}/)?.[1]
check('found dbReconcileStep in deploy.ts', !!fnBody)
const step: string | null = fnBody ? new Function('return (' + fnBody.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n') + ')')() : null
check('the push step is behind a db/NO_DRIZZLE_PUSH check', !!step && /if \[ -f db\/NO_DRIZZLE_PUSH \]; then .*; else .*bunx drizzle-kit push --force.*; fi$/.test(step), step)
if (step) {
  const boot = (withMarker: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'nopush-'))
    mkdirSync(join(dir, 'db')); mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'db', 'reconcile.ts'), '')
    if (withMarker) writeFileSync(join(dir, 'db', 'NO_DRIZZLE_PUSH'), 'migrations own this schema\n')
    // bun and bunx stand in for themselves as markers, so the shell logic is what is tested — not bun or drizzle.
    writeFileSync(join(dir, 'bin', 'bun'), '#!/bin/sh\necho "RAN-BUN $*"\n')
    writeFileSync(join(dir, 'bin', 'bunx'), '#!/bin/sh\necho "RAN-PUSH $*"; echo "No changes detected"\n')
    chmodSync(join(dir, 'bin', 'bun'), 0o755); chmodSync(join(dir, 'bin', 'bunx'), 0o755)
    // A PATH entry is colon-separated, so a Windows `C:/…` has to become Git Bash's `/c/…`.
    const binDir = dir.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_: string, d: string) => '/' + d.toLowerCase()) + '/bin'
    const r = spawnSync('bash', ['-c', `export PATH="${binDir}:$PATH"; ` + step + ' && echo NEXT-STEP'], { cwd: dir, encoding: 'utf8' })
    return { out: (r.stdout || '') + (r.stderr || ''), status: r.status }
  }
  const marked = boot(true), plain = boot(false)
  check('with db/NO_DRIZZLE_PUSH: push never runs, reconcile still does, and boot carries on',
    !/RAN-PUSH/.test(marked.out) && /drizzle push skipped/.test(marked.out) && /RAN-BUN db\/reconcile\.ts/.test(marked.out) && /NEXT-STEP/.test(marked.out), marked)
  check('without it: push runs as before and boot carries on',
    /RAN-PUSH drizzle-kit push --force/.test(plain.out) && /schema reconciled to drizzle schema/.test(plain.out) && !/push skipped/.test(plain.out) && /NEXT-STEP/.test(plain.out), plain)
}

// ── 2. crm-homecare opts out, and has the same additive reconcile as the rest of the fleet
check('crm-homecare carries db/NO_DRIZZLE_PUSH', existsSync(HC + 'db/NO_DRIZZLE_PUSH'))
const fleetReconcile = read(ROOT + 'templates/crm/backend/db/reconcile.ts')
check('crm-homecare has db/reconcile.ts, identical to the base CRM\'s', existsSync(HC + 'db/reconcile.ts') && read(HC + 'db/reconcile.ts') === fleetReconcile)

// ── 3. home care's schema.ts declares every table and column its migrations create (the push-drop list)
const hcSchema = read(HC + 'db/schema.ts')
const declared = new Map<string, Set<string>>()
for (const m of hcSchema.matchAll(/pgTable\('([a-z_0-9]+)'/g)) {
  const rest = hcSchema.slice(m.index!)
  const end = rest.search(/\n\}(\)|, )/)
  declared.set(m[1], new Set([...rest.slice(0, end).matchAll(/^\s+\w+: \w+\('([a-z_0-9]+)'/gm)].map((c) => c[1])))
}
const journal = JSON.parse(readFileSync(HC + 'db/migrations/meta/_journal.json', 'utf8'))
const sqlOf = (tag: string) => read(HC + `db/migrations/${tag}.sql`).replace(/--.*$/gm, '')
const droppedLater = new Set<string>()
for (const e of journal.entries) for (const d of sqlOf(e.tag).matchAll(/drop table (?:if exists )?"?([a-z_0-9]+)"?/gi)) droppedLater.add(d[1])
const undeclared: string[] = []
let createdTables = 0, addedColumns = 0
for (const e of journal.entries) {
  const text = sqlOf(e.tag)
  for (const t of text.matchAll(/create table (?:if not exists )?"?([a-z_0-9]+)"?/gi)) {
    createdTables++
    if (!declared.has(t[1]) && !droppedLater.has(t[1])) undeclared.push(`${e.tag}: table ${t[1]}`)
  }
  for (const a of text.matchAll(/alter table (?:if exists )?(?:only )?"?([a-z_0-9]+)"?\s+([\s\S]*?);/gi)) {
    for (const c of a[2].matchAll(/add column (?:if not exists )?"?([a-z_0-9]+)"?/gi)) {
      addedColumns++
      const cols = declared.get(a[1])
      if (cols && !cols.has(c[1])) undeclared.push(`${e.tag}: column ${a[1]}.${c[1]}`)
    }
  }
}
check(`the walk saw the migrations (${journal.entries.length} files, ${createdTables} CREATE TABLEs, ${addedColumns} ADD COLUMNs)`, journal.entries.length >= 23 && createdTables > 100 && addedColumns > 100)
check('crm-homecare schema.ts declares every migrated table and column', undeclared.length === 0, undeclared)
for (const name of ['scheduled_visits', 'client_visit_notes', 'client_services', 'subscription', 'addon_purchase', 'usage_record', 'billing_invoice'])
  check(`schema.ts declares ${name} (it was the push-drop list)`, declared.has(name))
for (const [t, c] of [['clients', 'emergency_contact_name'], ['clients', 'status'], ['users', 'status'], ['notifications', 'recipient_id']])
  check(`schema.ts declares ${t}.${c}`, !!declared.get(t)?.has(c))
// The unique constraint 0007 created is Postgres-named; drizzle's default name made push offer to truncate the table.
check('denial_code_lookup.code\'s unique constraint carries the migration\'s name', /code: text\('code'\)\.notNull\(\)\.unique\('denial_code_lookup_code_key'\)/.test(hcSchema))

// ── 4. every CRM schema.ts only references tables it defines (the `company.id` typo that kept push crashing)
const crms = readdirSync(ROOT + 'templates').filter((d: string) => /^crm(-|$)/.test(d) && !PARKED.has(d) && existsSync(ROOT + `templates/${d}/backend/db/schema.ts`))
check('found every CRM schema', crms.length >= 12, crms)
for (const t of crms) {
  const src = read(ROOT + `templates/${t}/backend/db/schema.ts`)
  const defined = new Set([...src.matchAll(/export const (\w+)\s*(?::[^=]+)?=\s*pgTable\(/g)].map((m) => m[1]))
  const bad = [...new Set([...src.matchAll(/references\(\s*\(\)\s*(?::\s*\w+\s*)?=>\s*(\w+)\.\w+/g)].map((m) => m[1]))].filter((n) => !defined.has(n))
  check(`${t}: every .references() names a table this schema defines`, bad.length === 0, bad)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
