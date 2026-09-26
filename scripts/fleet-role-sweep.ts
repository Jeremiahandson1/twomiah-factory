// Fleet sweep: every ROLE, every vertical, every shared surface — the dimension the QA rounds kept
// listing as "not tested".
//
// WHY THIS EXISTS. Round after round the reports carried the same line: "Role separation for qa.manager
// and qa.staff — passwords cannot be entered, so only the owner session was exercised." Then Field
// Service T30 finally signed in as staff and manager, and EVERYTHING it found was authorisation — a jobs
// module that authenticated but never authorised, staff reading the company's money through the dashboard
// and global search, nav offering screens the API refuses. Almost none of it was field-service specific.
// Those holes had been sitting in verticals already marked CLOSED, because every test ran as the owner.
//
// A defect only one role can see is invisible to a one-role pass, however thorough that pass is. So this
// is not a guard over source — it is the missing DIMENSION, run against live tenants.
//
// IT NEEDS NO PERMISSION MATRIX, which is what makes it maintainable. The permission code is shared, so
// the same role hitting the same shared endpoint must get the same answer in every vertical that mounts
// it AND has the module switched on. A disagreement is either a missed gate or a deliberate per-vertical
// grant, and the deliberate ones are declared in one place per template (`extraRolePermissions`), so the
// script can tell them apart and report only the rest.
//
// THE DISTINCTION THAT MAKES IT CORRECT: a 403 is not one answer. The feature gate and the permission
// check both return 403, and conflating them made the first version of this script report EIGHT false
// findings — salon and restaurant are not sold jobs or quotes, and fstest has Documents switched off.
// They are told apart by the body:
//     {"code":"FEATURE_NOT_ENABLED","feature":"quotes"}                      → module off, says nothing about the role
//     {"error":"Permission denied","required":"invoices:read","yourRole":…}  → the role was refused
// Only the second is a permission answer, and only those are compared.
//
// STRICTLY READ-ONLY: GETs and the refusals they produce. Nothing is created, changed or deleted.
//
//   FLEET_OWNER_PW=… FLEET_QA_PW=… bun scripts/fleet-role-sweep.ts
//
// Credentials come from the environment on purpose — test-tenant passwords do not belong in the repo.
const OWNER_PW = process.env.FLEET_OWNER_PW
const QA_PW = process.env.FLEET_QA_PW
if (!OWNER_PW || !QA_PW) {
  console.error('Set FLEET_OWNER_PW and FLEET_QA_PW. This probe signs in to live tenants; the passwords are not stored here.')
  process.exit(2)
}

// The standing fleet. basictest is deliberately absent: it is a throwaway crm-basic tenant with its own
// generated owner password and no qa.manager / qa.staff accounts, so it would report three phantom
// sign-in failures every run.
const TENANTS: Array<[string, string]> = [
  ['ctrtest', 'https://ctrtest-6ea610-api.onrender.com'],
  ['fstest', 'https://fstest-6d5715-wrench-api.onrender.com'],
  ['lndtest', 'https://lndtest-f12f63-landscape-api.onrender.com'],
  ['vettest', 'https://vettest-b52599-vet-api.onrender.com'],
  ['saltest', 'https://saltest-db718f-salon-api.onrender.com'],
  ['evttest', 'https://evttest-7bc70d-events-api.onrender.com'],
  ['rvtest', 'https://rvtest-d50ae9-rv-api.onrender.com'],
]
const ROLES: Array<[string, string, string]> = [
  ['owner', 'twomiah14@gmail.com', OWNER_PW],
  ['manager', 'qa.manager@example.com', QA_PW],
  ['staff', 'qa.staff@example.com', QA_PW],
]
const PROBES = [
  '/api/contacts?limit=1', '/api/invoices?limit=1', '/api/quotes?limit=1', '/api/jobs?limit=1',
  '/api/documents?limit=1', '/api/expenses?limit=1', '/api/time?limit=1',
  '/api/team', '/api/team/assignable', '/api/company', '/api/company/users',
  '/api/reports/dashboard', '/api/dashboard/stats',
]

/**
 * Splits already explained by a deliberate per-vertical grant. Every entry names the vertical, the role
 * and WHY, so a reader can tell a decision from an oversight without opening five middleware files.
 * Keep in step with each template's `extraRolePermissions`.
 */
const BY_DESIGN: Array<{ role: string; path: RegExp; tenants: string[]; why: string }> = [
  {
    role: 'staff', path: /^\/api\/invoices/, tenants: ['vettest'],
    why: "crm-vet grants field invoices:read/create/update — clinical staff record care and bill for it (R2-02); its permissions.ts says so",
  },
]

type Verdict = 'allow' | 'denied-by-role' | 'module-off' | 'not-mounted' | 'no-session' | string
const seen: Record<string, Record<string, Record<string, Verdict>>> = {}
let sessionProblems = 0

const classify = async (r: Response): Promise<Verdict> => {
  if (r.status === 200) return 'allow'
  if (r.status === 404) return 'not-mounted'
  if (r.status === 401) return 'no-session'
  if (r.status === 403) {
    const body = await r.text()
    if (/FEATURE_NOT_ENABLED/.test(body)) return 'module-off'
    if (/Permission denied/i.test(body)) return 'denied-by-role'
    return 'denied-other'
  }
  return `other(${r.status})`
}

for (const [role, email, password] of ROLES) {
  seen[role] = {}
  for (const [tenant, base] of TENANTS) {
    let token = ''
    try {
      const lr = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
      })
      const j: any = await lr.json().catch(() => ({}))
      token = j.accessToken || j.token || ''
      if (!token) { console.error(`  ${role} could not sign in to ${tenant} (${lr.status}) — that is itself a finding`); sessionProblems++; continue }
    } catch (e: any) { console.error(`  ${tenant} unreachable: ${e?.message || e}`); sessionProblems++; continue }
    seen[role][tenant] = {}
    for (const p of PROBES) {
      try { seen[role][tenant][p] = await classify(await fetch(base + p, { headers: { authorization: `Bearer ${token}` } })) }
      catch { seen[role][tenant][p] = 'unreachable' }
    }
  }
}

let findings = 0, explained = 0, compared = 0
for (const role of Object.keys(seen)) {
  for (const p of PROBES) {
    // Only verticals where the module is ON and mounted can say anything about the ROLE.
    const allow: string[] = [], denied: string[] = []
    for (const tenant of Object.keys(seen[role])) {
      const v = seen[role][tenant][p]
      if (v === 'allow') allow.push(tenant)
      else if (v === 'denied-by-role') denied.push(tenant)
    }
    if (!allow.length || !denied.length) continue
    compared++

    const odd = allow.length <= denied.length ? allow : denied
    const rule = BY_DESIGN.find((b) => b.role === role && b.path.test(p) && odd.every((t) => b.tenants.includes(t)))
    if (rule) { explained++; console.log(`  by design  ${role.padEnd(8)} ${p.padEnd(26)} ${odd.join(', ')} — ${rule.why}`); continue }

    findings++
    console.log(`\n  FINDING    ${role} · ${p}`)
    console.log(`               allowed         ${allow.join(', ')}`)
    console.log(`               denied by role  ${denied.join(', ')}`)
    console.log(`               Same shared permission code, same role, different answer — and the module`)
    console.log(`               is switched ON in all of them, so this is not feature gating. Either it is a`)
    console.log(`               deliberate grant (add it to BY_DESIGN with the reason) or a missed gate.`)
  }
}

const cells = Object.values(seen).reduce((n, byTenant) => n + Object.values(byTenant).reduce((m, byPath) => m + Object.keys(byPath).length, 0), 0)
console.log(`\nrole sweep: ${cells} live checks (${ROLES.length} roles x ${TENANTS.length} verticals x ${PROBES.length} surfaces)`)
console.log(`${compared} endpoint(s) where verticals genuinely disagree about a ROLE · ${explained} explained by a declared grant · ${findings} unexplained`)
if (sessionProblems) console.log(`${sessionProblems} session(s) could not be established — investigate before trusting a clean run`)
process.exit(findings || sessionProblems ? 1 : 0)
