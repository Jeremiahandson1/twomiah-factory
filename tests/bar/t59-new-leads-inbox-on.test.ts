// New leads: one place, one count. (T59, the owner: "you should have a leads, for new leads, and i
// dont need to count how many contacts we have")
//
// The home screen's first tile counted every contact — 23 on the showcase tenant, 21 of them "leads",
// and 20 of THOSE were people who had booked online and were already on the schedule. Leads came in
// through two doors that never met: the website form wrote a Contact, the marketplaces wrote the Lead
// Inbox. This file is the tenant WITH the Lead Inbox:
//
//   · a website enquiry lands in the inbox as `new`, and writes no contact until somebody converts it
//   · an online booker is a `client`, not a lead
//   · the dashboard sends `newLeads` = inbox rows at `new`, and keeps `contacts` (the mobile app reads it)
//   · triaging a lead takes it off the count; converting it makes the contact the usual way
//
// Its twin, t59-new-leads-inbox-off.test.ts, is the tenant WITHOUT the inbox — a separate file because
// the webhook serves the first company and the feature list is cached per process.
process.env.WEBHOOK_SECRET = 'whsec-t59-on'
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
  name: 'Leads On Co', slug: 'leads-on-t59', email: 'on59@test.local', settings: {},
  enabledFeatures: ['lead_inbox', 'online_booking', 'jobs', 'contacts'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-on59@test.local', passwordHash: 'x', firstName: 'O', lastName: 'N',
  role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/webhooks', (await import('./src/routes/webhooks.ts')).default)
app.route('/api/leads', (await import('./src/routes/leads.ts')).default)
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.route('/api/booking', (await import('./src/routes/booking.ts')).default)
app.onError(errorHandler)

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const api = (method: string, path: string, body?: unknown) =>
  call(method, path, body, { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': owner.role })
const hook = (body: unknown, secret = 'whsec-t59-on') => call('POST', '/api/webhooks/leads', body, { 'x-webhook-secret': secret })

// ══════════ the website form ════════════════════════════════════════════════════════════════════════
console.log('\n══════════ a website enquiry goes to the Lead Inbox ══════════')
let leadId = ''
{
  const bad = await hook({ name: 'Nobody' }, 'wrong-secret')
  check('a wrong secret is still refused', bad.status === 401, { status: bad.status })

  // The exact shape website-*/routes/admin.ts forwards.
  const res = await hook({ name: 'Wendy Web', email: 'wendy-t59@test.local', phone: '555-0199', service: 'Gutter clean', message: 'Before the winter, please', source: 'website', address: '3 Oak St, Dayton OH', smsConsent: true })
  check('the enquiry is accepted', res.status === 201 && res.json?.success === true, { status: res.status, body: res.text?.slice(0, 300) })
  leadId = res.json?.id

  const [row]: any[] = await db.select().from(lead).where(eq(lead.companyId, co.id))
  check('…and it IS a Lead Inbox row', !!row && row.id === leadId, { row, leadId })
  check('…at status new', row?.status === 'new', { status: row?.status })
  check('…from the website', row?.sourcePlatform === 'website', { sourcePlatform: row?.sourcePlatform })
  check('…with no lead source (the form is not a connected source)', row?.sourceId === null, { sourceId: row?.sourceId })
  check('…carrying the name, email and phone', row?.homeownerName === 'Wendy Web' && row?.email === 'wendy-t59@test.local' && row?.phone === '555-0199', row)
  check('…the service as the job type', row?.jobType === 'Gutter clean', { jobType: row?.jobType })
  check('…the address as the location', row?.location === '3 Oak St, Dayton OH', { location: row?.location })
  check('…and the message as the description', row?.description === 'Before the winter, please', { description: row?.description })
  check('…with the form as sent kept on the row (smsConsent included)', (row?.rawPayload as any)?.smsConsent === true, { rawPayload: row?.rawPayload })

  const people: any[] = await db.select().from(contact).where(eq(contact.companyId, co.id))
  check('NO contact is written for an enquiry nobody has answered', people.length === 0, { contacts: people.map((p) => [p.name, p.type]) })

  const list = await api('GET', '/api/leads')
  check('the inbox lists it', list.status === 200 && (list.json?.data || []).some((l: any) => l.id === leadId), { status: list.status, rows: (list.json?.data || []).length })
}

// ══════════ the dashboard ═══════════════════════════════════════════════════════════════════════════
console.log('\n══════════ the dashboard counts new leads ══════════')
{
  const s = await api('GET', '/api/dashboard/stats')
  check('the dashboard answers', s.status === 200, { status: s.status, body: s.text?.slice(0, 200) })
  check('newLeads is the inbox count at new: 1', s.json?.newLeads === 1, { newLeads: s.json?.newLeads })
  check('contacts is still sent (the mobile app reads it)', typeof s.json?.contacts === 'number', { contacts: s.json?.contacts })
}

// ══════════ an online booker ════════════════════════════════════════════════════════════════════════
console.log('\n══════════ somebody who books is a client ══════════')
{
  const set = await api('PUT', '/api/booking/settings', {
    enabled: true, leadTimeHours: 0, slotDurationMinutes: 60,
    workingHours: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      .map((d) => [d, { start: '08:00', end: '18:00', enabled: true }])),
  })
  check('booking is switched on', set.status === 200, { status: set.status, body: set.text?.slice(0, 260) })
  const date = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10)
  const res = await call('POST', `/api/booking/public/${co.slug}`, {
    date, time: '10:00', firstName: 'Bea', lastName: 'Booker', email: 'bea-t59@test.local', phone: '555-0102',
    address: '9 Elm Rd', city: 'Dayton', state: 'OH', zip: '45402',
  })
  check('the booking is taken', res.status === 200 || res.status === 201, { status: res.status, body: res.text?.slice(0, 400) })
  const [bea]: any[] = await db.select().from(contact).where(eq(contact.email, 'bea-t59@test.local'))
  check('the booker is on file', !!bea, { bea })
  check('…as a CLIENT, not a lead', bea?.type === 'client', { type: bea?.type })
  check('…and still marked as having come from online booking', bea?.source === 'online_booking', { source: bea?.source })

  const s = await api('GET', '/api/dashboard/stats')
  check('a booking is not a new lead: still 1', s.json?.newLeads === 1, { newLeads: s.json?.newLeads })
}

// ══════════ triage takes it off the count ═══════════════════════════════════════════════════════════
console.log('\n══════════ answering a lead takes it off the count ══════════')
{
  const st = await api('PUT', `/api/leads/${leadId}/status`, { status: 'contacted' })
  check('the lead is marked contacted', st.status === 200 && st.json?.status === 'contacted', { status: st.status, body: st.text?.slice(0, 200) })
  const s = await api('GET', '/api/dashboard/stats')
  check('…and newLeads drops to 0', s.json?.newLeads === 0, { newLeads: s.json?.newLeads })

  const cv = await api('POST', `/api/leads/${leadId}/convert`)
  check('converting it makes the contact', cv.status === 200 && cv.json?.contact?.name === 'Wendy Web', { status: cv.status, body: cv.text?.slice(0, 300) })
  check('…a new one, not a match (no contact existed)', cv.json?.matched === false, { matched: cv.json?.matched })
  const [wendy]: any[] = await db.select().from(contact).where(eq(contact.email, 'wendy-t59@test.local'))
  check('…on file once', !!wendy, { wendy })
  check('…filed the way every converted lead is in this vertical (lead)', wendy?.type === 'lead', { type: wendy?.type })
  check('…with the website as its source', wendy?.source === 'website', { source: wendy?.source })
  const [after]: any[] = await db.select().from(lead).where(eq(lead.id, leadId))
  check('…and the inbox row points at it', after?.status === 'converted' && after?.convertedContactId === wendy?.id, after)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
