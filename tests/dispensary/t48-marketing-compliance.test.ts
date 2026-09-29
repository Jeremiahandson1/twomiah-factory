// crm-dispensary — T48 Q1: a marketing email that breaks the law it is sent under.
//
// The campaign body went out exactly as typed and nothing else. No unsubscribe link, no postal
// address, no List-Unsubscribe header — so Gmail showed no unsubscribe control next to the sender
// either. CAN-SPAM requires a working opt-out and the sender's physical postal address in every
// commercial email, and neither has ever been in one of ours.
//
// The galling part is that the unsubscribe machinery already existed and worked: handleUnsubscribe,
// the public route, the recipient row that proves the link belongs to the person following it. T46
// N8 even fixed that handler after it was found doing nothing. Nothing ever put the LINK in the
// MESSAGE, and no test looked at what was actually sent — they asserted counts and database rows,
// which is why four QA rounds and two of my own fixes went past it.
//
// So this file reads the email. It replaces the sender with a recorder and asserts on the bytes.
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

// The sender, replaced by a recorder. marketing.ts calls `emailService.sendRaw(...)` — a property
// lookup at call time — so swapping the property on the shared object is enough, and nothing has to
// know it is being watched.
const emailMod: any = await import('./src/services/email.ts')
const emailService: any = emailMod.default ?? emailMod.emailService
const outbox: Array<{ to: string; subject: string; html: string; options: any }> = []
emailService.sendRaw = async (to: string, subject: string, html: string, options: any = {}) => {
  outbox.push({ to, subject, html, options })
  return { success: true, messageId: 'test' }
}

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t48c', email: 'c@test.local',
  address: '1 Main St', city: 'Columbus', state: 'OH', zip: '43004',
  enabledFeatures: ['contacts', 'email_campaigns', 'sms_marketing', 'loyalty'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t48c@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const [ada] = await db.insert(contact).values({
  companyId: co.id, type: 'customer', name: 'Ada Opted', email: 'ada@test.local', phone: '555-0101',
} as any).returning()
await db.insert(loyaltyMember).values({ companyId: co.id, contactId: ada.id, optedInEmail: true } as any)

const app = new Hono()
app.route('/api/marketing', (await import('./src/routes/marketing.ts')).default)

const api = async (method: string, path: string, body?: unknown, asUser = owner.id) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': asUser },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// A link has to be absolute or a mail client has nothing to resolve it against.
process.env.FRONTEND_URL = 'https://leaf.example.com'

// ── what actually leaves the building ───────────────────────────────────────────────────────────
let sentRecipientId = ''
{
  const created = await api('POST', '/api/marketing/campaigns', {
    name: 'T48 Compliance', type: 'email', subject: 'New drop', content: '<p>New drop at the shop today.</p>',
  })
  const id = created.json?.id
  outbox.length = 0
  const sent = await api('POST', `/api/marketing/campaigns/${id}/send`)
  check('Q1: the campaign sends', sent.status === 200, { status: sent.status, body: sent.json })
  check('Q1: …and exactly one email was handed to the sender', outbox.length === 1, outbox.length)

  const mail = outbox[0]
  const [rec] = await rows(sql`SELECT id, contact_id FROM marketing_recipients WHERE campaign_id = ${id}`)
  sentRecipientId = rec?.id
  const url = `https://leaf.example.com/api/marketing/unsubscribe/${rec?.id}/${rec?.contact_id}`

  check('Q1: the body the operator wrote is still there', /New drop at the shop today/.test(mail?.html || ''), (mail?.html || '').slice(0, 120))

  // The opt-out. Absolute, and naming THIS recipient row — which is what stops the link being an
  // open invitation to unsubscribe anyone whose id you can guess.
  check('Q1: the email carries an unsubscribe link', (mail?.html || '').includes(url), (mail?.html || '').slice(-400))
  check('Q1: …and it is absolute, so a mail client can follow it', /href="https:\/\//.test(mail?.html || ''), (mail?.html || '').slice(-400))
  check('Q1: …and the word a reader looks for is the link text', /<a [^>]*>Unsubscribe<\/a>/.test(mail?.html || ''), (mail?.html || '').slice(-400))

  // The postal address. The second thing CAN-SPAM names, and the one nobody remembers.
  check('Q1: the email carries the sender\'s postal address',
    /1 Main St, Columbus, OH 43004/.test(mail?.html || ''), (mail?.html || '').slice(-400))
  check('Q1: …under the sender\'s own name', /Twomiah Leaf, 1 Main St/.test(mail?.html || ''), (mail?.html || '').slice(-400))

  // The header is what puts an Unsubscribe control next to the sender in Gmail — the thing the
  // tester looked for and did not find.
  const h = mail?.options?.headers || {}
  check('Q1: List-Unsubscribe names the same URL', h['List-Unsubscribe'] === `<${url}>`, h)
  check('Q1: …and one-click is advertised', h['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', h)
}

// ── the header must not be a lie: one-click has to answer POST ──────────────────────────────────
{
  const [rec] = await rows(sql`SELECT id, contact_id FROM marketing_recipients WHERE id = ${sentRecipientId}`)
  const res = await app.request(`/api/marketing/unsubscribe/${rec.id}/${rec.contact_id}`, { method: 'POST' })
  check('Q1: a one-click POST is answered 2xx, with no page to click through', res.status === 200, res.status)

  const [c] = await rows(sql`SELECT custom_fields FROM contact WHERE id = ${rec.contact_id}`)
  const fields = typeof c?.custom_fields === 'string' ? JSON.parse(c.custom_fields) : (c?.custom_fields || {})
  check('Q1: …and it ACTUALLY unsubscribed them', fields.emailOptOut === true, fields)
  const [m] = await rows(sql`SELECT opted_in_email FROM loyalty_members WHERE contact_id = ${rec.contact_id}`)
  check('Q1: …including off the marketing list', m?.opted_in_email === false, m)

  const forged = await app.request(`/api/marketing/unsubscribe/${rec.id}/not-a-contact`, { method: 'POST' })
  check('Q1: a POST whose link does not match its message is refused', forged.status === 400, forged.status)
}

// ── no postal address, no send ──────────────────────────────────────────────────────────────────
//
// Refused once, for the whole campaign, before anything goes out — a marketing email without an
// address is unlawful to send at all, so sending some of them and failing the rest would be the
// worst of both.
{
  const [bare] = await db.insert(company).values({
    name: 'No Address Shop', slug: 'leaf-t48n', email: 'n@test.local', state: 'OH',
    enabledFeatures: ['contacts', 'email_campaigns', 'loyalty'],
  } as any).returning()
  const [bareOwner] = await db.insert(user).values({
    email: 'owner-t48n@test.local', passwordHash: 'x', firstName: 'N', lastName: 'U', role: 'owner', companyId: bare.id,
  } as any).returning()
  const [cust] = await db.insert(contact).values({
    companyId: bare.id, type: 'customer', name: 'Someone', email: 'someone@test.local',
  } as any).returning()

  const created = await api('POST', '/api/marketing/campaigns', {
    name: 'T48 No Address', type: 'email', subject: 'Hi', content: 'Hello',
  }, bareOwner.id)
  outbox.length = 0
  const sent = await api('POST', `/api/marketing/campaigns/${created.json?.id}/send`, undefined, bareOwner.id)

  check('Q1: a shop with no postal address cannot send marketing email', sent.status === 400, { status: sent.status, body: sent.json })
  check('Q1: …and is told what to add and why, in the shop\'s own terms',
    /street address/i.test(String(sent.json?.error)) && /anti-spam|law/i.test(String(sent.json?.error)), sent.json?.error)
  check('Q1: …with nothing handed to the sender', outbox.length === 0, outbox.length)
  const recs = await rows(sql`SELECT id FROM marketing_recipients WHERE campaign_id = ${created.json?.id}`)
  check('Q1: …and no half-sent campaign left behind', recs.length === 0, recs.length)
  const [camp] = await rows(sql`SELECT status FROM marketing_campaigns WHERE id = ${created.json?.id}`)
  check('Q1: …and the campaign is still a draft it can be fixed from', camp?.status === 'draft', camp)
  void cust
}

// ── a state on its own is not an address ────────────────────────────────────────────────────────
{
  const [partial] = await db.insert(company).values({
    name: 'State Only', slug: 'leaf-t48s', email: 's@test.local', state: 'OH',
    address: '', city: '', zip: '43004',
    enabledFeatures: ['contacts', 'email_campaigns', 'loyalty'],
  } as any).returning()
  const [o] = await db.insert(user).values({
    email: 'owner-t48s@test.local', passwordHash: 'x', firstName: 'S', lastName: 'U', role: 'owner', companyId: partial.id,
  } as any).returning()
  await db.insert(contact).values({ companyId: partial.id, type: 'customer', name: 'X', email: 'x@test.local' } as any)

  const created = await api('POST', '/api/marketing/campaigns', { name: 'T48 Partial', type: 'email', subject: 'Hi', content: 'Hello' }, o.id)
  const sent = await api('POST', `/api/marketing/campaigns/${created.json?.id}/send`, undefined, o.id)
  check('Q1: a zip with no street and no town is not a postal address', sent.status === 400, { status: sent.status, body: sent.json })
}

// ── the footer is ours, and a business name cannot break out of it ──────────────────────────────
{
  const [evil] = await db.insert(company).values({
    name: 'Bud & Co <script>alert(1)</script>', slug: 'leaf-t48x', email: 'x2@test.local',
    address: '2 High St', city: 'Columbus', state: 'OH', zip: '43004',
    enabledFeatures: ['contacts', 'email_campaigns', 'loyalty'],
  } as any).returning()
  const [o] = await db.insert(user).values({
    email: 'owner-t48x@test.local', passwordHash: 'x', firstName: 'X', lastName: 'U', role: 'owner', companyId: evil.id,
  } as any).returning()
  await db.insert(contact).values({ companyId: evil.id, type: 'customer', name: 'Y', email: 'y@test.local' } as any)

  const created = await api('POST', '/api/marketing/campaigns', { name: 'T48 Esc', type: 'email', subject: 'Hi', content: 'Hello' }, o.id)
  outbox.length = 0
  await api('POST', `/api/marketing/campaigns/${created.json?.id}/send`, undefined, o.id)
  const html = outbox[0]?.html || ''
  const footer = html.slice(html.indexOf('border-top'))
  check('Q1: a company name with markup in it is escaped in the footer', !/<script>/.test(footer), footer.slice(0, 200))
  check('Q1: …and still reads as the name the owner typed', /Bud &amp; Co/.test(footer), footer.slice(0, 200))
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
