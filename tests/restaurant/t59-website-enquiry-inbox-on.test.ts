// A website enquiry reaches the venue's Lead Inbox. (T59, restaurant)
//
// The form wrote a Contact and nothing else, so enquiries from the venue's own site never reached the
// inbox the Knot, WeddingWire and Google leads sit in. It cannot be an event enquiry directly — an event
// needs a date and the form does not ask for one — so it lands in the inbox as `new`, and Convert makes
// the contact the coordinator then opens the event for. Twin: t59-website-enquiry-inbox-off.test.ts.
process.env.WEBHOOK_SECRET = 'whsec-t59-rest-on'
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, lead } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Venue On Co', slug: 'venue-on-t59', email: 'von59@test.local', settings: {},
  enabledFeatures: ['lead_inbox', 'contacts'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-von59@test.local', passwordHash: 'x', firstName: 'O', lastName: 'V',
  role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/webhooks', (await import('./src/routes/webhooks.ts')).default)
app.route('/api/leads', (await import('./src/routes/leads.ts')).default)
app.onError(errorHandler)

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

console.log('\n══════════ a website enquiry goes to the Lead Inbox ══════════')
{
  const res = await call('POST', '/api/webhooks/leads',
    { name: 'Priya Party', email: 'priya-t59@test.local', phone: '555-0144', service: 'Rehearsal dinner', message: '40 guests in June', source: 'website' },
    { 'x-webhook-secret': 'whsec-t59-rest-on' })
  check('the enquiry is accepted', res.status === 201 && res.json?.success === true, { status: res.status, body: res.text?.slice(0, 300) })
  const [row]: any[] = await db.select().from(lead).where(eq(lead.companyId, co.id))
  check('…as a Lead Inbox row at new', row?.id === res.json?.id && row?.status === 'new', row)
  check('…from the website', row?.sourcePlatform === 'website', { sourcePlatform: row?.sourcePlatform })
  check('…carrying what they asked about and the message', row?.jobType === 'Rehearsal dinner' && row?.description === '40 guests in June', row)
  const people: any[] = await db.select().from(contact).where(eq(contact.companyId, co.id))
  check('NO contact until somebody converts it', people.length === 0, { contacts: people.length })
  const cv = await call('POST', `/api/leads/${row?.id}/convert`, undefined, { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': owner.role })
  check('Convert makes the contact', cv.status === 200 && cv.json?.contact?.name === 'Priya Party', { status: cv.status, body: cv.text?.slice(0, 300) })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
