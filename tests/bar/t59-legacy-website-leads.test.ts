// Pre-T59 website enquiries get a Lead Inbox row — and nothing is moved or deleted. (T59)
//
// The form writes to the inbox now; the enquiries that arrived before were Contacts and never reached
// the inbox or its New leads count. moveLegacyWebsiteLeadsToInbox (run by db/prune-legacy.ts on boot)
// gives each UNTOUCHED one an inbox row pointing at its contact. Checked here against the real schema
// and every foreign key it declares:
//   · an untouched website lead gets one `new` inbox row, linked to the contact, which stays put
//   · a website lead somebody has already started on (a job / quote / anything referencing it) does not
//   · a contact that is not a website lead does not
//   · a second run inserts nothing
//   · Convert on the moved row links THAT contact — no second copy of the person
import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const schema: any = await import('./db/schema.ts')
const { company, user, contact, lead } = schema
const { moveLegacyWebsiteLeadsToInbox } = await import('./src/shared/leads/legacyWebsiteLeads.ts')

const [co] = await db.insert(company).values({ name: 'Legacy Co', slug: 'legacy-t59', email: 'l59@test.local', settings: {}, enabledFeatures: ['contacts', 'lead_inbox'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-l59@test.local', passwordHash: 'x', firstName: 'O', lastName: 'L', role: 'owner', companyId: co.id, isActive: true } as any).returning()

const [untouched] = await db.insert(contact).values({ name: 'Wanda Website', type: 'lead', source: 'Website', email: 'wanda-l59@test.local', address: '5 Ash St', city: 'Dayton', notes: 'Service: Gutters\nMessage: Before winter', companyId: co.id, createdAt: new Date('2026-09-01T10:00:00Z') } as any).returning()
const [noContactInfo] = await db.insert(contact).values({ name: 'Nameonly Nate', type: 'lead', source: 'website', companyId: co.id } as any).returning()
const [worked] = await db.insert(contact).values({ name: 'Quoted Quinn', type: 'lead', source: 'website', email: 'quinn-l59@test.local', companyId: co.id } as any).returning()
const [booker] = await db.insert(contact).values({ name: 'Booked Bea', type: 'client', source: 'online_booking', email: 'bea-l59@test.local', companyId: co.id } as any).returning()
const [manual] = await db.insert(contact).values({ name: 'Manual Mo', type: 'lead', source: 'referral', companyId: co.id } as any).returning()
// "Somebody has started on it": anything whose foreign key points at the contact. A job is the plainest.
const workTable = schema.job || schema.appointment || schema.project
const workCol = workTable?.contactId ? 'contactId' : 'ownerId'
let workedOn = false
if (workTable) {
  try { await db.insert(workTable).values({ title: 'Gutter quote visit', name: 'Gutter quote visit', number: 'JOB-L59', companyId: co.id, [workCol]: worked.id } as any); workedOn = true } catch (e: any) { console.log('  (could not attach work to the contact:', e?.message, ')') }
}

const inboxFor = async (contactId: string) => (await db.select().from(lead).where(eq(lead.convertedContactId, contactId))) as any[]

console.log('\n══════════ the heal ══════════')
{
  const n = await moveLegacyWebsiteLeadsToInbox(db, sql)
  const [w] = await inboxFor(untouched.id)
  check('an untouched website lead gets an inbox row', !!w, { n })
  check('…at new, from the website', w?.status === 'new' && w?.sourcePlatform === 'website', w)
  check('…carrying the name, email, address and the enquiry text', w?.homeownerName === 'Wanda Website' && w?.email === 'wanda-l59@test.local' && w?.location === '5 Ash St, Dayton' && /Before winter/.test(w?.description || ''), w)
  check('…received when the enquiry actually arrived', new Date(w?.receivedAt).toISOString() === '2026-09-01T10:00:00.000Z', { receivedAt: w?.receivedAt })
  check('the CONTACT is untouched — still there, still a lead', (await db.select().from(contact).where(eq(contact.id, untouched.id))).length === 1)
  check('a name-only website lead gets one too', (await inboxFor(noContactInfo.id)).length === 1)
  check('a website lead somebody is working on does NOT', workedOn && (await inboxFor(worked.id)).length === 0, { workedOn })
  check('a booker (client) does not', (await inboxFor(booker.id)).length === 0)
  check('a lead from another source does not', (await inboxFor(manual.id)).length === 0)
  check('exactly the two expected rows', n === 2, { n })
  const again = await moveLegacyWebsiteLeadsToInbox(db, sql)
  check('a second run inserts nothing', again === 0 && (await inboxFor(untouched.id)).length === 1, { again })
}

console.log('\n══════════ converting a moved row ══════════')
{
  const app = new Hono()
  app.route('/api/leads', (await import('./src/routes/leads.ts')).default)
  app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))
  const before = (await db.select().from(contact).where(eq(contact.companyId, co.id))).length
  const [nate] = await inboxFor(noContactInfo.id)
  const res = await app.request(`/api/leads/${nate.id}/convert`, { method: 'POST', headers: { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' } })
  const j: any = await res.json().catch(() => null)
  check('converting it succeeds', res.status === 200, { status: res.status, j })
  check('…linked to THAT contact (it has no email or phone to search by)', j?.contact?.id === noContactInfo.id && j?.matched === true, { contact: j?.contact?.id, expected: noContactInfo.id, matched: j?.matched })
  check('…and no second copy of the person is created', (await db.select().from(contact).where(eq(contact.companyId, co.id))).length === before)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
