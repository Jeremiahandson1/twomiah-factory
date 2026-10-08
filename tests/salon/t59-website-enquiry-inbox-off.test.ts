// A website enquiry, for a business WITHOUT the Lead Inbox. (T59, salon — twin of t59-website-enquiry-inbox-on)
// With nowhere to see an inbox lead, the form keeps writing the Contact it always wrote.
process.env.WEBHOOK_SECRET = 'whsec-t59-rest-off'
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, contact, lead } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Venue Off Co', slug: 'venue-off-t59', email: 'voff59@test.local', settings: {},
  enabledFeatures: ['contacts'],
} as any).returning()

const app = new Hono()
app.route('/api/webhooks', (await import('./src/routes/webhooks.ts')).default)
app.onError(errorHandler)

console.log('\n══════════ no inbox: the enquiry stays a contact ══════════')
{
  const res = await app.request('/api/webhooks/leads', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'whsec-t59-rest-off' },
    body: JSON.stringify({ name: 'Omar Office', email: 'omar-t59@test.local', service: 'Holiday party', message: 'December', source: 'website' }),
  })
  const j: any = await res.json().catch(() => null)
  check('the enquiry is accepted', res.status === 201 && j?.success === true, { status: res.status, j })
  const [omar]: any[] = await db.select().from(contact).where(eq(contact.email, 'omar-t59@test.local'))
  check('…as a contact of type lead, exactly as before', omar?.id === j?.id && omar?.type === 'lead' && omar?.source === 'website', omar)
  check('…with the service and message in its notes', /Service: Holiday party/.test(omar?.notes || '') && /Message: December/.test(omar?.notes || ''), { notes: omar?.notes })
  const rows: any[] = await db.select().from(lead).where(eq(lead.companyId, co.id))
  check('…and nothing in an inbox the venue cannot open', rows.length === 0, { leads: rows.length })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
