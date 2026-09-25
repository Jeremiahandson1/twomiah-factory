// The documents module had no authorisation of any kind — nine write routes, not one guard, and it did
// not even take a guard dependency. Any signed-in user of the company could upload, rename, DELETE a
// document, and roll a version back.
//
// The permission matrix had the answer all along: admin and manager carry documents:*, a technician
// carries documents:read and documents:create, a viewer carries documents:read. So the mapping is the
// matrix, not a new opinion — create for a technician's own work, update for changing what is there,
// delete for losing it.
//
// The over-correction to guard against is a technician who can no longer file the photo of the job they
// just finished. That is most of what documents are for on a phone, and it stays.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, document } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 260)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'T30 Docs Co', slug: 't30doc', email: 't30doc@test.local', settings: {}, enabledFeatures: ['documents', 'contacts', 'jobs'] } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}-t30doc@test.local`, passwordHash: 'x', firstName: tag, lastName: 'User', role, companyId: co.id } as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const staff = await mkUser('user', 'staff')     // field: documents:read + documents:create
const viewer = await mkUser('viewer', 'viewer') // documents:read only

const app = new Hono()
app.route('/api/documents', (await import('./src/routes/documents.ts')).default)
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
let n = 0
const seedDoc = async () => (await db.insert(document).values({
  name: `T30 Doc ${++n}`, filename: `t30-${n}.pdf`, originalName: `t30-${n}.pdf`,
  path: `/tmp/t30-${n}.pdf`, url: `/files/t30-${n}.pdf`, companyId: co.id,
} as any).returning())[0]

/** Refused by the guard. Anything else means they got through to the handler. */
const refused = (r: { status: number }) => r.status === 403
const gotPast = (r: { status: number }) => r.status !== 403

console.log('\n── a technician files their own work, and that does not change ──')
{
  const call = as(staff)
  const list = await call('GET', '/api/documents')
  check('staff can see the documents', list.status === 200, { status: list.status })
  const up = await call('POST', '/api/documents', {})
  check('…and gets past the guard on upload (documents:create)', gotPast(up), { status: up.status, body: up.json })
  const bulk = await call('POST', '/api/documents/bulk', {})
  check('…and on a bulk upload', gotPast(bulk), { status: bulk.status })
  const doc = await seedDoc()
  const ver = await call('POST', `/api/documents/${doc.id}/versions`, {})
  check('…and on filing a new version of one', gotPast(ver), { status: ver.status })
}

console.log('\n── what a technician may NOT do ──')
{
  const call = as(staff)
  const doc = await seedDoc()
  const ren = await call('PUT', `/api/documents/${doc.id}`, { name: 'renamed by staff' })
  check('staff cannot rename or re-file a document', refused(ren), { status: ren.status, body: ren.json })
  check('…and is told it needs documents:update', ren.json?.required === 'documents:update', { body: ren.json })
  const del = await call('DELETE', `/api/documents/${doc.id}`)
  check('staff cannot DELETE one — this is the data loss', refused(del), { status: del.status, body: del.json })
  check('…and is told it needs documents:delete', del.json?.required === 'documents:delete', { body: del.json })
  const [still] = await db.select().from(document).where(eq(document.id, doc.id))
  check('…and the refusal did not delete it anyway', !!still, { gone: !still })
  const restore = await call('POST', `/api/documents/${doc.id}/versions/00000000-0000-0000-0000-000000000000/restore`)
  check('staff cannot roll a document back to an older version', refused(restore), { status: restore.status })
}

console.log('\n── a viewer may read and nothing else ──')
{
  const call = as(viewer)
  const list = await call('GET', '/api/documents')
  check('a viewer can still read the list', list.status === 200, { status: list.status })
  const up = await call('POST', '/api/documents', {})
  check('…but cannot upload', refused(up), { status: up.status })
  const doc = await seedDoc()
  check('…nor delete', refused(await call('DELETE', `/api/documents/${doc.id}`)))
}

console.log('\n── a manager and an owner run the filing cabinet ──')
{
  for (const [label, who] of [['a manager', manager], ['an owner', owner]] as const) {
    const call = as(who)
    const doc = await seedDoc()
    const ren = await call('PUT', `/api/documents/${doc.id}`, { name: `renamed by ${label}` })
    check(`${label} can rename a document`, gotPast(ren), { status: ren.status, body: ren.json })
    const del = await call('DELETE', `/api/documents/${doc.id}`)
    check(`…and delete one`, gotPast(del), { status: del.status })
  }
}

console.log(`\nfs-t30-documents-authorise: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
