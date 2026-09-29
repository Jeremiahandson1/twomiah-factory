// crm-dispensary — T48 Q3 and Q17: consent had a route and no screen, and refused without saying how.
//
// Q3 (high)  PUT /loyalty/members/:id/consent was built in T47 P2 and works. The word "consent" then
//            appeared nowhere in the app. The budtender standing at the counter when the customer
//            says "yes, text me" could only record it through the API, so for any shop without a
//            developer the SMS audience stayed at zero — the same feature-that-cannot-be-switched-on
//            the route itself was filed for. The screen is the Loyalty → Members list; this file
//            proves the API it drives, and that the list hands the screen what it needs to draw.
//
// Q17 (low)  A bad `source` answered "source is not one of the choices" without ever saying what the
//            choices are. Both halves of that branch returned the same sentence: the options were
//            matched out of the validator message and then thrown away.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, loyaltyMember } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t48con', email: 'con@test.local', state: 'OH',
  enabledFeatures: ['contacts', 'loyalty', 'sms_marketing', 'email_campaigns'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t48con@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const budtender = await mkUser('budtender', 'bud')

const [withPhone] = await db.insert(contact).values({
  companyId: co.id, type: 'customer', name: 'Ada Phone', email: 'ada@test.local', phone: '555-0101',
} as any).returning()
const [noPhone] = await db.insert(contact).values({
  companyId: co.id, type: 'customer', name: 'Ben Nophone', email: 'ben@test.local',
} as any).returning()

const [mAda] = await db.insert(loyaltyMember).values({ companyId: co.id, contactId: withPhone.id } as any).returning()
const [mBen] = await db.insert(loyaltyMember).values({ companyId: co.id, contactId: noPhone.id } as any).returning()

const app = new Hono()
app.route('/api/loyalty', (await import('./src/routes/loyalty.ts')).default)

const api = async (method: string, path: string, body?: unknown, asUser = owner.id) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': asUser },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ── the list has to carry what the screen draws ─────────────────────────────────────────────────
//
// The toggles, the date and the source all come off this one response. If any of them stopped
// arriving the screen would silently draw every customer as opted out, which is the failure mode
// that matters: it looks like data, not like a bug.
{
  const list = await api('GET', '/api/loyalty/members')
  const row = (list.json?.data || []).find((m: any) => m.id === mAda.id)
  check('Q3: the members list answers', list.status === 200, list.status)
  check('Q3: …carrying the sms consent flag the screen ticks', row && 'optedInSms' in row, Object.keys(row || {}).slice(0, 30))
  check('Q3: …and the email one', row && 'optedInEmail' in row, Object.keys(row || {}).slice(0, 30))
  check('Q3: …and when it was given', row && 'optedInSmsAt' in row && 'optedInEmailAt' in row, Object.keys(row || {}).slice(0, 30))
  check('Q3: …and where it came from', row && 'consentSource' in row, Object.keys(row || {}).slice(0, 30))
  check('Q3: …and the customer\'s name, so the row can say who it is about', !!row?.customerName, row?.customerName)
  check('Q3: a customer who has never been asked reads as not consented', row?.optedInSms === false && row?.optedInEmail === false, row)
}

// ── the budtender at the counter can record it ──────────────────────────────────────────────────
{
  const res = await api('PUT', `/api/loyalty/members/${mAda.id}/consent`, { optedInSms: true, source: 'in_store' }, budtender.id)
  check('Q3: the budtender who is standing there can take consent', res.status === 200, { status: res.status, body: res.json })
  check('Q3: …and the answer hands the screen the new state back', res.json?.optedInSms === true, res.json)

  const [m] = await rows(sql`SELECT opted_in_sms, opted_in_sms_at, consent_source FROM loyalty_members WHERE id = ${mAda.id}`)
  check('Q3: …written down as opted in', m?.opted_in_sms === true, m)
  check('Q3: …with the date it happened', !!m?.opted_in_sms_at, m)
  check('Q3: …and where it came from, which is the screen it was taken on', m?.consent_source === 'in_store', m)
}

// ── taking it back is the same act, recorded the same way ───────────────────────────────────────
{
  const res = await api('PUT', `/api/loyalty/members/${mAda.id}/consent`, { optedInSms: false }, budtender.id)
  check('Q3: consent can be withdrawn from the same screen', res.status === 200, res.json)
  const [m] = await rows(sql`SELECT opted_in_sms, opted_in_sms_at FROM loyalty_members WHERE id = ${mAda.id}`)
  check('Q3: …and the flag goes back', m?.opted_in_sms === false, m)
  check('Q3: …and the date goes with it, not left behind to look like live consent', !m?.opted_in_sms_at, m)
}

// ── consent to be texted needs somewhere to text ────────────────────────────────────────────────
{
  const res = await api('PUT', `/api/loyalty/members/${mBen.id}/consent`, { optedInSms: true }, budtender.id)
  check('Q3: a customer with no number cannot be opted in to texts', res.status === 400, { status: res.status, body: res.json })
  check('Q3: …and the refusal tells the budtender what to do about it',
    /no phone number/i.test(String(res.json?.error)) && /add a mobile/i.test(String(res.json?.error)), res.json?.error)
  check('Q3: …and says which customer, because there is a queue behind them',
    /Ben Nophone/.test(String(res.json?.error)), res.json?.error)
}

// ── Q17: a refusal that names the choices ───────────────────────────────────────────────────────
{
  const res = await api('PUT', `/api/loyalty/members/${mAda.id}/consent`, { optedInEmail: true, source: 'carrier-pigeon' }, budtender.id)
  check('Q17: a source that is not a real one is refused', res.status === 400, { status: res.status, body: res.json })
  const msg = String(res.json?.error || '')
  check('Q17: …and the message LISTS the choices, instead of saying there are some', /in_store/.test(msg), msg)
  check('Q17: …all four of them', ['in_store', 'online', 'import', 'staff'].every(o => msg.includes(o)), msg)
  check('Q17: …read as a sentence, not a validator dump', / or /.test(msg) && !/ZodError|invalid_enum/i.test(msg), msg)
  check('Q17: …naming the field it is about', /^source/i.test(msg), msg)
}

// ── and nothing was written by the refused call ─────────────────────────────────────────────────
{
  const [m] = await rows(sql`SELECT opted_in_email FROM loyalty_members WHERE id = ${mAda.id}`)
  check('Q17: a refused consent writes nothing at all', m?.opted_in_email === false, m)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
