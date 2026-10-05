// A warranty claim could not be created AT ALL, on any template. (T43 owner pass — confirmed HIGH)
//
//   "Contractor and Field service: warranty claims can't be created at all, so the claim actions
//    can't be tested. This is brief item 7, now confirmed."
//
// Brief item 7 claimed this could not be behaviour-tested, because `warranty_claim.warrantyId` is a
// notNull FK to `warranty` while the detail query joins `project_warranty` on the same id — "so a row
// that exercises the join cannot be built without first deciding which table that column means".
//
// THE CODE HAD ALREADY DECIDED, unanimously, and I called it ambiguous instead of reading it. Every
// use in the shared module treats that column as a `project_warranty` id: createClaim looks the id up
// in project_warranty before inserting it, and getClaims, getClaim, scheduleClaim, claimsByCategory
// and the warranty list all LEFT JOIN project_warranty on it. The FOREIGN KEY was the only thing
// pointing elsewhere, so every insert violated it. Not a missing screen and not a permission — a
// constraint.
//
// This file is the test that was supposed to be impossible. It files a claim through the real route
// and then works it, which is exactly what "the claim actions can't be tested" was blocking.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, project, projectWarranty, warrantyClaim } = await import('./db/schema.ts')
const { errorHandler } = await import('./src/utils/errors.ts')

const [co] = await db.insert(company).values({
  name: 'Lindqvist Build', slug: 'lindqvist-t44', email: 'w44@test.local',
  settings: {}, enabledFeatures: ['projects', 'warranties', 'contacts'],
} as any).returning()

const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@lindqvist-t44.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const manager = await mk('manager', 'manager')
const crew = await mk('field', 'crew')

const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Søren Lindqvist', email: 'soren-t44@test.local',
} as any).returning()

const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: 'Lakeside house', number: 'PRJ-0144',
  status: 'completed', estimatedValue: '82000.00', budget: '80000.00',
} as any).returning()

// The warranty a homeowner actually holds — a project_warranty, which is what the claim points at.
const [pw] = await db.insert(projectWarranty).values({
  companyId: co.id, projectId: proj.id, contactId: client.id,
  name: 'Roof covering — 10 year', category: 'roofing', status: 'active',
  startsAt: new Date('2026-01-10'), expiresAt: new Date('2036-01-10'),
} as any).returning()

const app = new Hono()
app.route('/api/warranties', (await import('./src/routes/warranties.ts')).default)
app.onError(errorHandler)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asManager = as(manager), asCrew = as(crew)

// ══════════ filing one — the thing that could not be done ═══════════════════════════════════════
console.log('\n══════════ POST /api/warranties/claims ══════════')
let claimId = ''
{
  const bad = await asManager('POST', '/api/warranties/claims', { description: 'Tiles lifted in the storm' })
  check('a claim with no warranty is refused by name, not by a constraint',
    bad.status === 400 && /warranty is required/i.test(String(bad.json?.error)), bad.json)

  const noTitle = await asManager('POST', '/api/warranties/claims', { warrantyId: pw.id })
  check('…and one with no title is refused by name too', noTitle.status === 400 && /title is required/i.test(String(noTitle.json?.error)), noTitle.json)

  const r = await asManager('POST', '/api/warranties/claims', {
    warrantyId: pw.id,
    title: 'Ridge tiles lifted',
    description: 'Three ridge tiles lifted after the February gale; water staining on the landing ceiling.',
  })
  check('T43: a manager can FILE a claim against a project warranty — this failed on every template',
    r.status === 201 || r.status === 200, { status: r.status, body: r.text?.slice(0, 220) })
  claimId = r.json?.id || r.json?.claim?.id || ''
  check('…and it comes back with an id', !!claimId, r.json)

  const rows = await db.select().from(warrantyClaim)
  check('…and exactly one row exists, pointing at the project warranty',
    rows.length === 1 && String(rows[0].warrantyId) === String(pw.id), rows.map((x: any) => ({ id: x.id, warrantyId: x.warrantyId })))

  const crewTry = await asCrew('POST', '/api/warranties/claims', { warrantyId: pw.id, title: 'x', description: 'x' })
  check('the crew seat may not file one — warranties:create is manager and up', crewTry.status === 403, { status: crewTry.status })
}

// ══════════ …and then the claim ACTIONS the finding said could not be reached ═══════════════════
console.log('\n══════════ the claim actions ══════════')
{
  const list = await asOwner('GET', '/api/warranties/claims')
  const rows = Array.isArray(list.json) ? list.json : (list.json?.data ?? [])
  check('the claim appears in the list', list.status === 200 && rows.length === 1, { status: list.status, n: rows.length })
  check('…with the warranty it belongs to joined on — the join the FK used to contradict',
    /Roof covering/.test(JSON.stringify(rows[0] ?? {})), rows[0])

  const detail = await asOwner('GET', `/api/warranties/claims/${claimId}`)
  check('the detail opens', detail.status === 200, { status: detail.status, body: detail.text?.slice(0, 180) })
  check('…and carries the project and the customer', /Lakeside house/.test(detail.text) && /Lindqvist/.test(detail.text), detail.text?.slice(0, 220))

  // The service reads `scheduledDate`; sending the wrong name used to 500 rather than refuse, which
  // is how that was found — this endpoint had never run before, because no claim could exist.
  const noDate = await asManager('POST', `/api/warranties/claims/${claimId}/schedule`, {})
  check('T43: scheduling with no date is a 400, not a 500', noDate.status === 400 && /scheduledDate/i.test(String(noDate.json?.error)), noDate.json)
  const badDate = await asManager('POST', `/api/warranties/claims/${claimId}/schedule`, { scheduledDate: 'next tuesday-ish' })
  check('…and an unreadable date is a 400 too', badDate.status === 400, { status: badDate.status, body: badDate.text?.slice(0, 120) })

  const sched = await asManager('POST', `/api/warranties/claims/${claimId}/schedule`, { scheduledDate: '2026-11-02', notes: 'Scaffold needed on the north side' })
  check('a manager can schedule the repair, which raises the job', sched.status === 200 || sched.status === 201, { status: sched.status, body: sched.text?.slice(0, 180) })

  const status = await asManager('PUT', `/api/warranties/claims/${claimId}/status`, { status: 'in_progress' })
  check('…and move its status', status.status === 200, { status: status.status, body: status.text?.slice(0, 180) })

  const deny = await asManager('POST', `/api/warranties/claims/${claimId}/deny`, { reason: 'Storm damage is the insurer, not the warranty' })
  check('…and deny it with a reason', deny.status === 200, { status: deny.status, body: deny.text?.slice(0, 180) })

  const crewDeny = await asCrew('POST', `/api/warranties/claims/${claimId}/deny`, { reason: 'nope' })
  check('the crew seat may not deny one', crewDeny.status === 403, { status: crewDeny.status })
}

// ══════════ the constraint itself points where the queries look ═════════════════════════════════
console.log('\n══════════ the foreign key ══════════')
{
  const r: any = await db.execute(sql`
    SELECT ccu.table_name AS references_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'warranty_claim' AND kcu.column_name = 'warranty_id'
  `)
  const refs = ((r as any).rows || r).map((x: any) => x.references_table)
  check('warranty_claim.warranty_id references project_warranty, not warranty',
    refs.includes('project_warranty') && !refs.includes('warranty'), refs)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
