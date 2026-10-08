// A returning customer is not a new person. (T59, RV website form + chat)
//
// Every website form and chat submission made a brand-new contact and a brand-new sales lead, so a
// customer who asked about a second unit, or pressed Submit twice, became a second person with a
// second open lead. The ADF import never did: it reuses the contact by email, or by an uncontradicted
// phone, under a lock. The website door now uses the same rule (services/leadContact.ts), and the lead
// still goes into the PIPELINE at `new` — the dealership's lead queue, the one the dashboard counts.
process.env.WEBHOOK_SECRET = 'whsec-t59-rv'
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, contact, salesLead, unit } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Lakeside RV', slug: 'lakeside-t59', email: 'rv59@test.local', settings: {},
  enabledFeatures: ['contacts', 'sales_leads'],
} as any).returning()

const app = new Hono()
app.route('/api/webhooks', (await import('./src/routes/webhooks.ts')).default)
app.onError(errorHandler)

const post = async (body: unknown, secret = 'whsec-t59-rv') => {
  const res = await app.request('/api/webhooks/leads', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const people = async () => (await db.select().from(contact).where(eq(contact.companyId, co.id))) as any[]
const leads = async () => (await db.select().from(salesLead).where(eq(salesLead.companyId, co.id))) as any[]

console.log('\n══════════ a first enquiry ══════════')
{
  check('a wrong secret is still refused', (await post({ name: 'X' }, 'nope')).status === 401)
  const r = await post({ name: 'Rita Rambler', email: 'Rita-T59@test.local', phone: '(608) 555-0181', service: 'Travel trailer', message: 'Is the 2024 Jayco still here?', source: 'website' })
  check('the enquiry is accepted', r.status === 201 && r.json?.success === true, { status: r.status, body: r.text?.slice(0, 300) })
  const ps = await people(), ls = await leads()
  check('one contact, type lead, from the website', ps.length === 1 && ps[0].type === 'lead' && ps[0].source === 'website' && ps[0].id === r.json?.id, ps)
  check('one sales lead at new, in the pipeline', ls.length === 1 && ls[0].stage === 'new' && ls[0].contactId === ps[0].id && ls[0].source === 'website', ls)
}

console.log('\n══════════ the same message sent again ══════════')
{
  const r = await post({ name: 'Rita Rambler', email: 'rita-t59@test.local', phone: '608-555-0181', service: 'Travel trailer', message: 'Is the 2024 Jayco still here?', source: 'website' })
  check('accepted, and flagged as the same enquiry', r.status === 200 && r.json?.duplicate === true, { status: r.status, body: r.text?.slice(0, 300) })
  check('…no second contact (the email matched, whatever its case)', (await people()).length === 1)
  check('…and no second lead', (await leads()).length === 1)
}

console.log('\n══════════ the same person asks about something else ══════════')
{
  const r = await post({ name: 'Rita Rambler', email: 'rita-t59@test.local', service: 'Fifth wheel', message: 'Any fifth wheels under 30ft?', source: 'website' })
  check('accepted as a new enquiry', r.status === 201 && !r.json?.duplicate, { status: r.status, body: r.text?.slice(0, 300) })
  const ps = await people(), ls = await leads()
  check('…on the SAME contact', ps.length === 1 && r.json?.id === ps[0].id, { contacts: ps.length })
  check('…as a second open lead', ls.length === 2 && ls.every((l) => l.contactId === ps[0].id), ls.map((l) => [l.contactId, l.notes]))
}

console.log('\n══════════ the website chat, phone only ══════════')
{
  // The shape website-rv/server-static.ts sends from the AI chat.
  const r = await post({ name: 'Rita Rambler', phone: '6085550181', email: '', service: 'Website Chat', leadType: 'chat', source: 'website_chat', unitOfInterest: 'Jayco', message: 'Captured by the AI chat assistant' })
  check('accepted', r.status === 201, { status: r.status, body: r.text?.slice(0, 300) })
  check('…matched to Rita by phone (same name, no contradicting email)', (await people()).length === 1 && r.json?.id === (await people())[0].id)
  check('…as a chat lead in the pipeline', (await leads()).some((l) => l.source === 'website_chat' && l.stage === 'new'))
}

console.log('\n══════════ the chat says which unit ══════════')
{
  const [u]: any[] = await db.insert(unit).values({ companyId: co.id, category: 'travel_trailer', stockNumber: 'J1042', year: 2024, make: 'Jayco', modelName: 'Jay Flight' } as any).returning()
  const r = await post({ name: 'Vic Viewer', email: 'vic-t59@test.local', service: 'Website Chat', leadType: 'chat', source: 'website_chat', unitOfInterest: '2024 Jayco Jay Flight (Stock #j1042)', message: 'Captured by the AI chat assistant' })
  check('accepted', r.status === 201, { status: r.status, body: r.text?.slice(0, 300) })
  const vic = (await leads()).find((l) => l.contactId === r.json?.id)
  check('the vehicle of interest is ON the lead', /Interested in: 2024 Jayco Jay Flight \(Stock #j1042\)/.test(vic?.notes || ''), { notes: vic?.notes })
  check('…and the stock number links the lead to that unit (case aside)', vic?.unitId === u.id, { unitId: vic?.unitId, expected: u.id })
  const r2 = await post({ name: 'Wes Wanderer', email: 'wes-t59@test.local', source: 'website_chat', unitOfInterest: 'something with bunks (Stock #NOPE9)', message: 'Captured by the AI chat assistant' })
  const wes = (await leads()).find((l) => l.contactId === r2.json?.id)
  check('a stock number that is not in stock links nothing — no guess', r2.status === 201 && wes && wes.unitId === null && /Interested in: something with bunks/.test(wes.notes || ''), wes)
}

console.log('\n══════════ a shared phone is not a shared identity ══════════')
{
  const r = await post({ name: 'Sam Rambler', phone: '608-555-0181', service: 'Toy hauler', message: 'Trade-in value?', source: 'website' })
  check('accepted', r.status === 201, { status: r.status, body: r.text?.slice(0, 300) })
  const ps = await people()
  const rita = ps.find((p) => p.name === 'Rita Rambler')
  check('…a DIFFERENT name on the same line is a second person', ps.filter((p) => p.name === 'Sam Rambler').length === 1 && r.json?.id !== rita?.id && ps.some((p) => p.name === 'Sam Rambler' && p.id === r.json?.id), ps.map((p) => p.name))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
