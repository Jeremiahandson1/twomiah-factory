// crm-dispensary — T46 N8 and N9: marketing could not send, and counted the wrong audience.
//
// N8 (high)  POST /marketing/campaigns/:id/send answered 400 "marketing.sendCampaign is not a
//            function…" for every campaign. The function did not exist. The message also handed the
//            operator a piece of the server's internals.
// N9 (high)  The SMS audience counted every customer holding a phone number — 26 of them — while the
//            number who had opted in to SMS was nought. Once send worked, the shop's first campaign
//            would have texted 26 people who never agreed to it.
//
// Found while fixing them, and not in the report: the three public tracking routes beside send —
// the open pixel, the click redirect and the UNSUBSCRIBE LINK — all addressed a recipient id that
// was never written anywhere, and handleUnsubscribe took one argument where the route passed two.
// So the unsubscribe link in every marketing email did nothing at all, silently, and showed "You
// have been unsubscribed" either way.
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
  name: 'Twomiah Leaf', slug: 'leaf-mkt', email: 'mkt@test.local', state: 'OH',
  enabledFeatures: ['contacts', 'email_campaigns', 'sms_marketing', 'loyalty'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-mkt@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

// Four customers. All four have a phone; only one has agreed to be texted.
const mkCustomer = async (name: string, email: string | null, phone: string | null) =>
  (await db.insert(contact).values({ companyId: co.id, type: 'customer', name, email, phone } as any).returning())[0]

const opted = await mkCustomer('Ada Opted', 'ada@test.local', '555-0101')
const notOpted = await mkCustomer('Ben Notopted', 'ben@test.local', '555-0102')
const phoneOnly = await mkCustomer('Cy Phoneonly', null, '555-0103')
const emailOnly = await mkCustomer('Di Emailonly', 'di@test.local', null)

await db.insert(loyaltyMember).values([
  { companyId: co.id, contactId: opted.id, optedInSms: true, optedInEmail: true },
  { companyId: co.id, contactId: notOpted.id, optedInSms: false, optedInEmail: true },
  { companyId: co.id, contactId: phoneOnly.id, optedInSms: false, optedInEmail: false },
] as any)

const app = new Hono()
app.route('/api/marketing', (await import('./src/routes/marketing.ts')).default)

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ── N9: the audience a channel can lawfully reach ───────────────────────────────────────────────
{
  const email = await api('GET', '/api/marketing/audience-preview?audienceType=all&channel=email')
  check('N9: the email audience is everyone with an address', email.json?.reachable === 3, email.json)

  const sms = await api('GET', '/api/marketing/audience-preview?audienceType=all&channel=sms')
  check('N9: the SMS audience is only those who opted in — 1, not the 3 with a phone', sms.json?.reachable === 1, sms.json)
  check('N9: …while the raw "on file" count is still reported, so the shop can see the gap',
    sms.json?.withPhone === 3, sms.json)
  check('N9: …and the answer says which channel it answered for', sms.json?.channel === 'sms', sms.json)
}

// ── N8: a campaign can actually be sent ─────────────────────────────────────────────────────────
{
  const created = await api('POST', '/api/marketing/campaigns', {
    name: 'T46 Email Blast', type: 'email', subject: 'New drop', content: 'Hello {{name}}, we have a new drop.',
  })
  check('N8: a campaign is created', created.status === 200 || created.status === 201, { status: created.status, body: created.json })
  const id = created.json?.id

  const sent = await api('POST', `/api/marketing/campaigns/${id}/send`)
  check('N8: …and sending it works', sent.status === 200, { status: sent.status, body: sent.json })
  check('N8: …reaching the three customers with an email address', sent.json?.sent === 3, sent.json)
  check('N8: …and the answer never names a function that does not exist',
    !/is not a function/.test(JSON.stringify(sent.json)), sent.json)

  const [campaign] = await rows(sql`SELECT status, sent_at, recipient_count FROM marketing_campaigns WHERE id = ${id}`)
  check('N8: the campaign is recorded as sent', campaign?.status === 'sent' && !!campaign?.sent_at, campaign)
  check('N8: …with the number it reached', Number(campaign?.recipient_count) === 3, campaign)

  const recipients = await rows(sql`SELECT contact_id, channel, address, status FROM marketing_recipients WHERE campaign_id = ${id}`)
  check('N8: …and one row per person, so "who did we send to" can be answered', recipients.length === 3, recipients.length)
  check('N8: …each naming where it went', recipients.every((r) => r.address && r.channel === 'email'), recipients)

  const again = await api('POST', `/api/marketing/campaigns/${id}/send`)
  check('N8: sending the same campaign twice is refused', again.status === 400 && /already been sent/i.test(String(again.json?.error)), again.json)
}

// ── N9 + N8: an SMS campaign goes only to the opted-in ─────────────────────────────────────────
{
  const created = await api('POST', '/api/marketing/campaigns', {
    name: 'T46 Text Blast', type: 'sms', content: 'New drop at the shop today.',
  })
  const id = created.json?.id
  const sent = await api('POST', `/api/marketing/campaigns/${id}/send`)
  check('N9: the text campaign sends', sent.status === 200, { status: sent.status, body: sent.json })
  check('N9: …to the one customer who opted in, not the three with a number', sent.json?.sent === 1, sent.json)

  const recipients = await rows(sql`SELECT contact_id, channel FROM marketing_recipients WHERE campaign_id = ${id}`)
  check('N9: …and only that one is recorded as texted', recipients.length === 1 && recipients[0].contact_id === opted.id, recipients)
}

// ── a campaign that would reach nobody is refused, in words ─────────────────────────────────────
{
  await db.update(loyaltyMember).set({ optedInSms: false } as any).where(sql`contact_id = ${opted.id}`)
  const created = await api('POST', '/api/marketing/campaigns', { name: 'T46 Nobody', type: 'sms', content: 'Hello' })
  const sent = await api('POST', `/api/marketing/campaigns/${created.json?.id}/send`)
  check('N9: a text campaign with nobody opted in is refused', sent.status === 400, { status: sent.status, body: sent.json })
  check('N9: …and says so in the shop\'s own terms, not the server\'s',
    /opted in to text messages/i.test(String(sent.json?.error)) && !/is not a function|undefined/.test(String(sent.json?.error)), sent.json?.error)
  const [row] = await rows(sql`SELECT status FROM marketing_campaigns WHERE id = ${created.json?.id}`)
  check('N9: …and the campaign is NOT marked sent', row?.status === 'draft', row)
}

// ── the unsubscribe link actually unsubscribes ─────────────────────────────────────────────────
{
  const created = await api('POST', '/api/marketing/campaigns', {
    name: 'T46 Unsub', type: 'email', subject: 'Hello', content: 'Hi',
  })
  await api('POST', `/api/marketing/campaigns/${created.json?.id}/send`)
  const [rec] = await rows(sql`SELECT id, contact_id FROM marketing_recipients WHERE campaign_id = ${created.json?.id} AND contact_id = ${notOpted.id}`)
  check('unsub: the send left a recipient row to point at', !!rec?.id, rec)

  // The open pixel and the click redirect are public — no session, a mail client follows them.
  const pixel = await app.request(`/api/marketing/track/open/${rec.id}`)
  check('unsub: the open pixel answers with an image', pixel.status === 200 && (pixel.headers.get('content-type') || '').includes('image'), pixel.status)
  const [opened] = await rows(sql`SELECT opened_at FROM marketing_recipients WHERE id = ${rec.id}`)
  check('unsub: …and the open is recorded', !!opened?.opened_at, opened)

  const unsub = await app.request(`/api/marketing/unsubscribe/${rec.id}/${notOpted.id}`)
  const body = await unsub.text()
  check('unsub: the unsubscribe link answers', unsub.status === 200 && /unsubscribed/i.test(body), unsub.status)

  const [c] = await rows(sql`SELECT custom_fields FROM contact WHERE id = ${notOpted.id}`)
  const fields = typeof c?.custom_fields === 'string' ? JSON.parse(c.custom_fields) : (c?.custom_fields || {})
  check('unsub: …and the customer is ACTUALLY opted out — it used to do nothing at all', fields.emailOptOut === true, fields)
  const [m] = await rows(sql`SELECT opted_in_sms, opted_in_email FROM loyalty_members WHERE contact_id = ${notOpted.id}`)
  check('unsub: …off the text list too, since they asked to be left alone', m?.opted_in_sms === false && m?.opted_in_email === false, m)
  const [marked] = await rows(sql`SELECT unsubscribed_at FROM marketing_recipients WHERE id = ${rec.id}`)
  check('unsub: …and the message they unsubscribed from is marked', !!marked?.unsubscribed_at, marked)

  // …and they drop out of the next audience, which is the whole point.
  const after = await api('GET', '/api/marketing/audience-preview?audienceType=all&channel=email')
  check('unsub: …so the next campaign does not go to them', after.json?.reachable === 2, after.json)

  // A link naming a different customer than the message went to cannot unsubscribe them.
  const forged = await app.request(`/api/marketing/unsubscribe/${rec.id}/${emailOnly.id}`)
  const forgedBody = await forged.text()
  check('unsub: a link that does not match its message is refused', /Error|could not/i.test(forgedBody), forgedBody.slice(0, 80))
  const [safe] = await rows(sql`SELECT custom_fields FROM contact WHERE id = ${emailOnly.id}`)
  const safeFields = typeof safe?.custom_fields === 'string' ? JSON.parse(safe.custom_fields) : (safe?.custom_fields || {})
  check('unsub: …and that customer is untouched', safeFields.emailOptOut !== true, safeFields)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
