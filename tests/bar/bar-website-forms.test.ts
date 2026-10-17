// crm-bar — the bar website's two forms, as its server forwards them (website-premium-bar handleBarForm →
// POST /api/webhooks/leads with x-webhook-secret), through the real webhook on PGlite:
//   · the secret is checked (wrong → 401)
//   · a party enquiry WITH a date opens a party enquiry in the book (status enquiry — it holds no room) for the
//     guest it came from, typed from the occasion, with the head count and the visitor's note
//   · the same person again is the same guest (matched by email, or by phone)
//   · a party enquiry WITHOUT a date is an ordinary lead (the Lead Inbox, as crm-restaurant's site enquiry is)
//   · a Regulars sign-up tags the guest `regular`; the birthday and the consent EVIDENCE (words, source, IP,
//     time) are appended — never the consent without an email, and never a change to an existing guest's name
process.env.WEBHOOK_SECRET = 'whsec-bar-forms'
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 500)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, contact, event, lead } = await import('./db/schema.ts')
const [co] = await db.insert(company).values({ name: 'The Tap Room', slug: 'taproom-forms', email: 'f@test.local', settings: {}, enabledFeatures: ['contacts', 'event_bookings', 'lead_inbox', 'bar_menu', 'bar_tonight'] } as any).returning()

const app = new Hono()
app.route('/api/webhooks', (await import('./src/routes/webhooks.ts')).default)
const post = async (body: unknown, secret = 'whsec-bar-forms') => {
  const res = await app.request('/api/webhooks/leads', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

{
  const bad = await post({ name: 'Mallory', formType: 'party', requestedDate: future }, 'nope-nope-nope-nope')
  check(`a wrong secret is refused (${bad.status})`, bad.status === 401)
}

let patId = ''
{
  const r = await post({ name: 'Pat Kowalski', phone: '(715) 555-0142', email: 'Pat@Example.com', message: 'Back room if you have it', formType: 'party', partySize: 24, requestedDate: future, occasion: "Dad's 70th birthday", source: 'website' })
  check(`a party enquiry with a date opens one in the party book (${r.status})`, r.status === 201 && !!r.json.eventId, r.json)
  const [ev] = await db.select().from(event).where(eq(event.id, r.json.eventId))
  check('…as an enquiry (it holds no room), on that date, for that many', ev.status === 'enquiry' && String(ev.eventDate).slice(0, 10) === future && ev.guestCount === 24, ev)
  check(`…typed from the occasion ("${ev.eventType}") and named for it`, ev.eventType === 'birthday' && ev.name === "Dad's 70th birthday — Pat Kowalski", ev.name)
  check('…with the visitor\'s note, marked as from the website', ev.notes === 'Back room if you have it' && ev.source === 'website', ev)
  const [g] = await db.select().from(contact).where(eq(contact.id, ev.contactId!))
  check('…for a new guest, a lead, from the website', g.name === 'Pat Kowalski' && g.type === 'lead' && g.source === 'website', g)
  patId = g.id
  const again = await post({ name: 'P. Kowalski', phone: '715-555-0142', formType: 'party', partySize: 10, requestedDate: future, occasion: 'Packer game' })
  const [ev2] = await db.select().from(event).where(eq(event.id, again.json.eventId))
  check('the same phone number is the same guest (no duplicate)', ev2.contactId === patId, { ev2: ev2.contactId, patId })
  check('…and an occasion it does not recognise is "other"', ev2.eventType === 'other', ev2.eventType)
  const [still] = await db.select().from(contact).where(eq(contact.id, patId))
  check('…whose name the form did not change', still.name === 'Pat Kowalski', still.name)
}

{
  const before = (await db.select().from(event).where(eq(event.companyId, co.id))).length
  const r = await post({ name: 'Sam Lee', phone: '715-555-0199', formType: 'party', partySize: 8, occasion: 'retirement' })
  const after = (await db.select().from(event).where(eq(event.companyId, co.id))).length
  check(`no date: no party is opened (${before} → ${after})`, after === before, r.json)
  const inbox = await db.select().from(lead).where(eq(lead.companyId, co.id))
  check('…it is an ordinary lead in the Lead Inbox', r.status === 201 && inbox.some((l: any) => l.homeownerName === 'Sam Lee'), inbox.map((l: any) => l.homeownerName))
  const badDate = await post({ name: 'Una', phone: '715-555-0188', formType: 'party', requestedDate: '2026-02-31' })
  check('a date that is not a real day is never dropped: it goes to the inbox', badDate.status === 201 && !badDate.json.eventId, badDate.json)
}

{
  const r = await post({ name: 'Pat K', email: 'pat@example.com', formType: 'regulars', birthdayMonth: 6, birthdayDay: 14, consentText: 'Yes, email me now and then.', consentSource: 'website:/regulars', consentIp: '203.0.113.7' })
  check(`a Regulars sign-up from a known guest (${r.status}) is that guest`, r.status === 201 && r.json.id === patId, r.json)
  const [g] = await db.select().from(contact).where(eq(contact.id, patId))
  check('…tagged regular', (g.tags as string[]).includes('regular'), g.tags)
  const cf = g.customFields as any
  check('…with the birthday', cf.birthday?.month === 6 && cf.birthday?.day === 14, cf)
  check('…and the consent evidence: the words, where, from which address, when', cf.marketingConsent?.length === 1 && cf.marketingConsent[0].text === 'Yes, email me now and then.' && cf.marketingConsent[0].ip === '203.0.113.7' && !!cf.marketingConsent[0].at, cf.marketingConsent)
  check('…without touching the name or type', g.name === 'Pat Kowalski' && g.type === 'lead', g)
  await post({ name: 'Pat K', email: 'pat@example.com', formType: 'regulars', consentText: 'Yes again.', consentSource: 'website:/regulars' })
  const [g2] = await db.select().from(contact).where(eq(contact.id, patId))
  check('signing up twice appends a second consent record and does not duplicate the tag', (g2.customFields as any).marketingConsent.length === 2 && (g2.tags as string[]).filter((t) => t === 'regular').length === 1, g2)
  const noEmail = await post({ name: 'Joe Phone', phone: '715-555-0177', formType: 'regulars', consentText: 'Yes', consentSource: 'website:/regulars' })
  const [j] = await db.select().from(contact).where(eq(contact.id, noEmail.json.id))
  check('a new regular with no email: a guest, tagged, and no email consent recorded (nowhere to send it)', j.type === 'client' && (j.tags as string[]).includes('regular') && !(j.customFields as any).marketingConsent, j)
}

console.log(`\nbar-website-forms: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
