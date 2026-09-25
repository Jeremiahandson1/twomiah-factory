// Field Service T30 BLOCKER — the jobs module authenticated but never authorised.
//
// createJobRoutes took `authenticate` and no requirePermission at all, so every route under /api/jobs was
// open to any signed-in user of the company. A STAFF login created JOB-00569 and then deleted it. The
// permission matrix was right the whole time — `field` gets jobs:read and jobs:update, and neither
// jobs:create nor jobs:delete — it was simply never consulted.
//
// So the test is per ROLE and per VERB, because "staff cannot delete" alone would have passed on a fix
// that also took away the update a technician needs to do their job. The dangerous over-correction here
// is locking a field tech out of the work they are employed to do.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, job } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'T30 Perms Co', slug: 't30perm', email: 't30perm@test.local', settings: {}, enabledFeatures: ['jobs', 'contacts', 'scheduling'] } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}-t30perm@test.local`, passwordHash: 'x', firstName: tag, lastName: 'User', role, companyId: co.id } as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const staff = await mkUser('user', 'staff')          // stored as `user`, normalised to `field`
const [cust] = await db.insert(contact).values({ type: 'client', name: 'T30 Customer', email: 'cust-t30perm@test.local', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
app.onError(errorHandler)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const newJob = () => ({ title: 'T30 permission probe', contactId: cust.id, status: 'scheduled', scheduledDate: '2026-11-02T00:00:00.000Z', scheduledTime: '09:00' })
const seed = async () => (await db.insert(job).values({ number: `JOB-T30P-${Math.random().toString(36).slice(2, 8)}`, title: 'Seeded', status: 'scheduled', contactId: cust.id, companyId: co.id, scheduledDate: new Date('2026-11-02T00:00:00.000Z') } as any).returning())[0]

console.log('\n── STAFF: may see and update work, may not create or delete it ──')
{
  const call = as(staff)
  const list = await call('GET', '/api/jobs')
  check('staff can list service calls', list.status === 200, { status: list.status })

  const existing = await seed()
  const read = await call('GET', `/api/jobs/${existing.id}`)
  check('staff can open one', read.status === 200, { status: read.status })

  const upd = await call('PUT', `/api/jobs/${existing.id}`, { notes: 'on site, parts ordered' })
  check('staff can UPDATE it — this is the work a technician is employed to do', upd.status === 200, { status: upd.status, error: upd.json?.error })

  const made = await call('POST', '/api/jobs', newJob())
  check('staff CANNOT create a service call', made.status === 403, { status: made.status, body: made.json })

  const del = await call('DELETE', `/api/jobs/${existing.id}`)
  check('staff CANNOT delete one', del.status === 403, { status: del.status, body: del.json })

  const [still] = await db.select().from(job).where(eq(job.id, existing.id))
  check('…and the refusal did not delete it anyway', !!still, { gone: !still })
}

console.log('\n── MANAGER: full run of the work ──')
{
  const call = as(manager)
  const made = await call('POST', '/api/jobs', newJob())
  check('a manager can create', made.status === 201 || made.status === 200, { status: made.status, error: made.json?.error })
  const id = (made.json?.data ?? made.json)?.id
  const upd = await call('PUT', `/api/jobs/${id}`, { notes: 'rescheduled with the customer' })
  check('…update', upd.status === 200, { status: upd.status })
  const del = await call('DELETE', `/api/jobs/${id}`)
  check('…and delete', del.status === 200 || del.status === 204, { status: del.status })
}

console.log('\n── OWNER: unchanged ──')
{
  const call = as(owner)
  const made = await call('POST', '/api/jobs', newJob())
  check('an owner can create', made.status === 201 || made.status === 200, { status: made.status, error: made.json?.error })
  const id = (made.json?.data ?? made.json)?.id
  const del = await call('DELETE', `/api/jobs/${id}`)
  check('…and delete', del.status === 200 || del.status === 204, { status: del.status })
}

console.log('\n── the lifecycle buttons a tech uses are an UPDATE, not a create ──')
{
  const existing = await seed()
  const call = as(staff)
  const started = await call('POST', `/api/jobs/${existing.id}/start`)
  check('staff can start their job', started.status === 200, { status: started.status, error: started.json?.error })
  const done = await call('POST', `/api/jobs/${existing.id}/complete`)
  check('…and complete it', done.status === 200, { status: done.status, error: done.json?.error })
}

console.log(`\nfs-t30-jobs-permissions: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
