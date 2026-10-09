// A first-time caller, for a tenant WITHOUT the Lead Inbox. (T59 — twin of t59-calls-inbox-on.test.ts)
//
// With nowhere to triage a lead, call tracking keeps doing what it always did: a new number becomes a
// contact, and the next call from it is matched to that contact.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, contact, lead } from './db/schema.ts'
import { eq, sql } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Calls Off Co', slug: 'calls-off-t59', email: 'coff59@test.local', settings: {},
  enabledFeatures: ['call_tracking', 'contacts'],
} as any).returning()

const app = new Hono()
app.route('/api/calltracking', (await import('./src/routes/calltracking.ts')).default)
app.onError(errorHandler)

const ring = async (sid: string) => {
  const res = await app.request(`/api/calltracking/webhook/twilio/${co.id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ From: '+16085550456', To: '+16085559999', Direction: 'inbound', CallStatus: 'completed', CallDuration: '30', CallSid: sid }),
  })
  return res.status
}
const calls = async () => {
  const r: any = await db.execute(sql`SELECT caller_number, first_time_caller, contact_id FROM call_log WHERE company_id = ${co.id} ORDER BY created_at, start_time`)
  return (Array.isArray(r) ? r : r?.rows || []) as any[]
}

console.log('\n══════════ no inbox: a new caller is a contact, as before ══════════')
{
  check('the provider webhook answers 200', (await ring('CA-off-1')) === 200)
  const people: any[] = await db.select().from(contact).where(eq(contact.companyId, co.id))
  check('ONE contact for the new number', people.length === 1 && people[0].phone === '+16085550456', people.map((p) => [p.name, p.phone]))
  check('…named "Unknown Caller"', people[0]?.name === 'Unknown Caller', { name: people[0]?.name })
  const leads: any[] = await db.select().from(lead).where(eq(lead.companyId, co.id))
  check('…and nothing in an inbox this tenant cannot open', leads.length === 0, { leads: leads.length })
  await ring('CA-off-2')
  const log = await calls()
  check('the second call is matched to that contact, not a first call', log.length === 2 && log[1].first_time_caller === false && log[1].contact_id === people[0]?.id, log)
  const after: any[] = await db.select().from(contact).where(eq(contact.companyId, co.id))
  check('…and makes no second contact', after.length === 1, { contacts: after.length })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
