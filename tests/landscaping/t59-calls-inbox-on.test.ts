// A first-time caller is a lead to triage, not a contact. (T59, phone calls)
//
// Call tracking made a Contact for every new number that rang — wrong numbers and robocalls included —
// so Contacts filled with people nobody had qualified. With the Lead Inbox on, a first-time caller now
// lands in the inbox as a `phone` lead at `new`. The first call used to MAKE the contact that told the
// second call it was "not first", so the inbox is asked too: a second call from the same number is not a
// first call and files no second lead. Twin: t59-calls-inbox-off.test.ts.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, lead } from './db/schema.ts'
import { eq, sql } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Calls On Co', slug: 'calls-on-t59', email: 'con59@test.local', settings: {},
  enabledFeatures: ['lead_inbox', 'call_tracking', 'contacts'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-con59@test.local', passwordHash: 'x', firstName: 'O', lastName: 'C',
  role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/calltracking', (await import('./src/routes/calltracking.ts')).default)
app.route('/api/leads', (await import('./src/routes/leads.ts')).default)
app.onError(errorHandler)

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const api = (method: string, path: string, body?: unknown) =>
  call(method, path, body, { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': owner.role })
const ring = (sid: string, from = '+16085550123') =>
  call('POST', `/api/calltracking/webhook/twilio/${co.id}`, { From: from, To: '+16085559999', FromCity: 'MADISON', FromState: 'WI', Direction: 'inbound', CallStatus: 'completed', CallDuration: '42', CallSid: sid })
const calls = async () => {
  const r: any = await db.execute(sql`SELECT caller_number, first_time_caller, contact_id FROM call_log WHERE company_id = ${co.id} ORDER BY created_at, start_time`)
  return (Array.isArray(r) ? r : r?.rows || []) as any[]
}

console.log('\n══════════ a new number rings ══════════')
{
  const r = await ring('CA-t59-1')
  check('the provider webhook answers 200', r.status === 200, { status: r.status })
  const leads: any[] = await db.select().from(lead).where(eq(lead.companyId, co.id))
  check('ONE Lead Inbox row', leads.length === 1, { leads: leads.length })
  const l = leads[0] || {}
  check('…from the phone', l.sourcePlatform === 'phone', { sourcePlatform: l.sourcePlatform })
  check('…at status new', l.status === 'new', { status: l.status })
  check('…with the caller\'s number', l.phone === '+16085550123', { phone: l.phone })
  check('…named "Unknown Caller" when the provider sends no name', l.homeownerName === 'Unknown Caller', { name: l.homeownerName })
  check('…located by the caller\'s city and state', l.location === 'MADISON, WI', { location: l.location })
  const people: any[] = await db.select().from(contact).where(eq(contact.companyId, co.id))
  check('NO contact for a caller nobody has answered', people.length === 0, { contacts: people.length })
  const log = await calls()
  check('the call is logged as a first call', log.length === 1 && log[0].first_time_caller === true, log)
}

console.log('\n══════════ the same number rings again ══════════')
{
  await ring('CA-t59-2')
  const leads: any[] = await db.select().from(lead).where(eq(lead.companyId, co.id))
  check('still ONE inbox lead — a second call files no second lead', leads.length === 1, { leads: leads.length })
  const log = await calls()
  check('…and the second call is NOT a first call', log.length === 2 && log[1].first_time_caller === false, log)
}

console.log('\n══════════ a different number is a different first call ══════════')
{
  await ring('CA-t59-3', '+16085550777')
  const leads: any[] = await db.select().from(lead).where(eq(lead.companyId, co.id))
  check('a second caller is a second lead', leads.length === 2, { leads: leads.length })
}

console.log('\n══════════ converted, the caller is a contact the next call finds ══════════')
{
  const [first]: any[] = await db.select().from(lead).where(eq(lead.phone, '+16085550123'))
  const cv = await api('POST', `/api/leads/${first.id}/convert`)
  check('Convert makes the contact', cv.status === 200 && cv.json?.contact?.phone === '+16085550123', { status: cv.status, body: cv.text?.slice(0, 300) })
  await ring('CA-t59-4')
  const log = await calls()
  const last = log[log.length - 1] || {}
  check('the next call is matched to that contact', last.contact_id === cv.json?.contact?.id, { last, contactId: cv.json?.contact?.id })
  check('…and is not a first call', last.first_time_caller === false, last)
  const leads: any[] = await db.select().from(lead).where(eq(lead.companyId, co.id))
  check('…and files no new lead', leads.length === 2, { leads: leads.length })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
