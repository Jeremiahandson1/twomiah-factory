// A submittal goes out, is reviewed, and keeps what the reviewer said. (Launch list, 10/17)
//
// The office routes wrote reviewNotes, approvedAt and submittedAt — names the table never had — so every review's
// notes and dates were dropped without an error. And a new submittal was stored 'pending', a status the page offered
// no button for, so from the office screen nothing could be submitted, approved or rejected at all. The list also
// printed a blank Subject and Type: the row says title, and type had no column.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S: any = await import('./db/schema.ts')
const { eq } = await import('drizzle-orm')
const [co] = await db.insert(S.company).values({ name: 'Sub Co', slug: 'sub-co', email: 'o@sub.test', settings: {}, enabledFeatures: ['submittals', 'projects'] } as any).returning()
const [other] = await db.insert(S.company).values({ name: 'Other Co', slug: 'other-co', email: 'o@oth.test', settings: {}, enabledFeatures: ['submittals'] } as any).returning()
const [pm] = await db.insert(S.user).values({ email: 'pm@sub.test', passwordHash: 'x', firstName: 'Dana', lastName: 'Reyes', role: 'manager', companyId: co.id, isActive: true } as any).returning()
const [outsider] = await db.insert(S.user).values({ email: 'x@oth.test', passwordHash: 'x', firstName: 'X', lastName: 'Y', role: 'owner', companyId: other.id, isActive: true } as any).returning()
const [ct] = await db.insert(S.contact).values({ type: 'client', name: 'Pat', companyId: co.id } as any).returning()
const [proj] = await db.insert(S.project).values({ number: 'PRJ-1', name: 'Library', status: 'active', contactId: ct.id, companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/submittals', (await import('./src/routes/submittals.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const call = async (who: any, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'x-test-user': who.id, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const row = async (id: string) => (await db.select().from(S.submittal).where(eq(S.submittal.id, id)))[0]

// ── created as the form asked
const made = await call(pm, 'POST', '/api/submittals', { projectId: proj.id, subject: 'HVAC shop drawings', specSection: '23 05 00', submittalType: 'shop_drawing', priority: 'high', assignedTo: 'Arch Co' })
check(`a new submittal is created (${made.status})`, made.status === 201, made.json)
const id = made.json?.id
check('…as a draft, which the page offers Submit for', made.json?.status === 'draft', made.json?.status)
check('…its type, priority and assignee kept in their own columns', made.json?.submittalType === 'shop_drawing' && made.json?.priority === 'high' && made.json?.assignedTo === 'Arch Co', made.json)
check('…not run together into its notes', !made.json?.notes, made.json?.notes)
const list = await call(pm, 'GET', '/api/submittals')
const listed = list.json?.data?.find((s: any) => s.id === id)
check('the list gives the page its Subject and Type', listed?.subject === 'HVAC shop drawings' && listed?.submittalType === 'shop_drawing', listed)

// ── the review
check('it cannot be approved before it is submitted', (await call(pm, 'POST', `/api/submittals/${id}/approve`, {})).status === 409)
const sent = await call(pm, 'POST', `/api/submittals/${id}/submit`, {})
check(`Submit sends it (${sent.status})`, sent.status === 200 && sent.json?.status === 'submitted', sent.json)
check('…and records when', !!(await row(id)).submittedDate)
const rev = await call(pm, 'POST', `/api/submittals/${id}/revise`, { notes: 'Show the duct sizes on sheet M-2.' })
check(`a revision request is accepted (${rev.status})`, rev.status === 200 && rev.json?.status === 'revise_resubmit', rev.json)
let r = await row(id)
check('…and the reviewer\'s notes are KEPT', r.reviewNotes === 'Show the duct sizes on sheet M-2.', r.reviewNotes)
check('…and added to its running notes with who and when', /\[Revision requested by Dana Reyes on \d{4}-\d{2}-\d{2}\] Show the duct sizes on sheet M-2\./.test(r.notes || ''), r.notes)
check('a revised submittal can be submitted again', (await call(pm, 'POST', `/api/submittals/${id}/submit`, {})).json?.status === 'submitted')
const ok = await call(pm, 'POST', `/api/submittals/${id}/approve`, { notes: 'Approved as noted.' })
r = await row(id)
check(`approval is recorded (${ok.status})`, ok.status === 200 && r.status === 'approved', ok.json)
check('…with its date and who approved it', !!r.approvedDate && r.approvedBy === 'Dana Reyes', { approvedDate: r.approvedDate, approvedBy: r.approvedBy })
check('…and its notes, after the earlier ones', r.reviewNotes === 'Approved as noted.' && r.notes.indexOf('Revision requested') < r.notes.indexOf('[Approved by Dana Reyes'), r.notes)
check('an approved submittal cannot be rejected', (await call(pm, 'POST', `/api/submittals/${id}/reject`, { notes: 'no' })).status === 409)

// ── a reject keeps its reason; a row from before 10/17 ('pending') can still be submitted
const [legacy] = await db.insert(S.submittal).values({ number: 'SUB-009', title: 'Old one', status: 'pending', projectId: proj.id, companyId: co.id } as any).returning()
check('a submittal stored "pending" before this fix can be submitted', (await call(pm, 'POST', `/api/submittals/${legacy.id}/submit`, {})).json?.status === 'submitted')
await call(pm, 'POST', `/api/submittals/${legacy.id}/reject`, { notes: 'Wrong product.' })
check('a rejection keeps its reason', (await row(legacy.id)).reviewNotes === 'Wrong product.')

// ── edits reach the row; another company cannot touch it
const ed = await call(pm, 'PUT', `/api/submittals/${id}`, { subject: 'HVAC shop drawings rev B', priority: 'low' })
r = await row(id)
check(`an edited subject reaches the title (${ed.status})`, r.title === 'HVAC shop drawings rev B' && r.priority === 'low' && ed.json?.subject === 'HVAC shop drawings rev B', { title: r.title, priority: r.priority })
check('another company cannot review it', (await call(outsider, 'POST', `/api/submittals/${id}/reject`, { notes: 'x' })).status === 404)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
