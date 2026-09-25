// The SMS module's writes were all open to any signed-in user of the company. They are three different
// kinds of thing and this covers the two with an answer:
//
//   CONFIGURATION  the canned messages and the automatic replies — what the company says when nobody is
//                  typing. marketing:update, so manager and above.
//   HOUSEKEEPING   archiving and linking a thread. Nothing leaves the building, so contacts:read.
//
// SENDING (/send, /conversations/:id/reply, /job-update/:jobId) is deliberately still open and still on
// the debt list. T30 raised it as a question — "staff can reach SMS send. Confirm these are intended" —
// and it is a real one: a technician texting "on my way" is the product working, while contacts:update
// would stop that in field service and allow it in salon and vet, which widen the field rung. The test
// asserts it is STILL OPEN, so that when somebody answers the question this file fails and has to be
// updated on purpose rather than drifting.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 260)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'T30 SMS Auth Co', slug: 't30smsa', email: 't30smsa@test.local', settings: {}, enabledFeatures: ['two_way_texting', 'contacts'] } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}-t30smsa@test.local`, passwordHash: 'x', firstName: tag, lastName: 'User', role, companyId: co.id } as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const staff = await mkUser('user', 'staff')
const viewer = await mkUser('viewer', 'viewer')

const app = new Hono()
app.route('/api/sms', (await import('./src/routes/sms.ts')).default)
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
const refused = (r: { status: number }) => r.status === 403
const gotPast = (r: { status: number }) => r.status !== 403

console.log('\n── the canned messages: what the company says when nobody is typing ──')
{
  const tpl = { name: 'T30 template', body: 'We are on the way' }
  for (const [label, who] of [['staff', staff], ['a viewer', viewer]] as const) {
    const call = as(who)
    check(`${label} cannot write a message template`, refused(await call('POST', '/api/sms/templates', tpl)))
    check(`${label} cannot change one`, refused(await call('PUT', '/api/sms/templates/00000000-0000-0000-0000-000000000000', tpl)))
    check(`${label} cannot delete one`, refused(await call('DELETE', '/api/sms/templates/00000000-0000-0000-0000-000000000000')))
    check(`${label} cannot set an auto-responder — it answers in the business's name`, refused(await call('POST', '/api/sms/auto-responders', { keyword: 'hours', response: 'x' })))
  }
  const m = await as(manager)('POST', '/api/sms/templates', tpl)
  check('a manager can write one', gotPast(m), { status: m.status, body: m.json })
  check('…and the refusal above named marketing:update', (await as(staff)('POST', '/api/sms/templates', tpl)).json?.required === 'marketing:update')
  const o = await as(owner)('POST', '/api/sms/auto-responders', { keyword: 'hours', response: 'We open at 8' })
  check('an owner can set an auto-responder', gotPast(o), { status: o.status })
}

console.log('\n── tidying a thread: nothing leaves the building ──')
{
  const id = '00000000-0000-0000-0000-000000000000'
  check('staff can archive a conversation', gotPast(await as(staff)('POST', `/api/sms/conversations/${id}/archive`)))
  check('…and link one to a customer', gotPast(await as(staff)('POST', `/api/sms/conversations/${id}/link`, { contactId: id })))
  check('a manager too', gotPast(await as(manager)('POST', `/api/sms/conversations/${id}/archive`)))
}

console.log('\n── sending: still open, still on the debt list, still a question ──')
{
  // Asserted as it IS, not as it should be. When the question is answered this fails and someone has to
  // change it deliberately — which is the point of writing an open item down as a test.
  const r = await as(staff)('POST', '/api/sms/send', { toPhone: '6085550166', message: 'on my way' })
  check('staff still reach the send path (T30 L-RB, undecided)', gotPast(r), { status: r.status, body: r.json })
  const reply = await as(staff)('POST', '/api/sms/conversations/00000000-0000-0000-0000-000000000000/reply', { message: 'on my way' })
  check('…and the reply path', gotPast(reply), { status: reply.status })
}

console.log(`\nfs-t30-sms-authorise: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
