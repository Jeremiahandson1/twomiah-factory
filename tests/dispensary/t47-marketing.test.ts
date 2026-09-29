// crm-dispensary — T47 P1 and P2. Marketing that could not reach anybody, and said it had.
//
// P1 (high). A campaign to one person returned {"sent":1,"failed":0}, status "sent", and the email
//     never arrived. services/marketing.ts carried its OWN sendEmail, hardwired to SendGrid, which
//     this platform does not use — with no SENDGRID_API_KEY it logged "Email would be sent" and
//     RETURNED NORMALLY, so every recipient counted as sent and the campaign was stamped sent. Every
//     other email in the tenant went out fine through services/email.ts, which detects Resend. A
//     second implementation of something that already worked, sitting next to it, failing silently.
//     And nothing in the product could show otherwise: there was no recipients route at all.
//
// P2 (high). There was no way to opt anybody in to texts — not on the customer page, not on the
//     loyalty member, not through the API: create ignored the field and there was no update route,
//     so PUT answered 405. The SMS audience correctly counts opted-in members only, so it counted
//     zero for ever. A consent gate with no consent path is a feature that cannot be switched on.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t47m', email: 'm@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'email_campaigns', 'sms_marketing', 'loyalty', 'contacts'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t47m@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const budtender = await mkUser('budtender', 'bud')

const [withPhone] = await db.insert(contact).values({
  name: 'Tex Ter', type: 'customer', companyId: co.id, email: 'tex@test.local', phone: '+16085550111',
} as any).returning()
const [noPhone] = await db.insert(contact).values({
  name: 'Nell Nophone', type: 'customer', companyId: co.id, email: 'nell@test.local',
} as any).returning()

const app = new Hono()
app.route('/api/marketing', (await import('./src/routes/marketing.ts')).default)
app.route('/api/loyalty', (await import('./src/routes/loyalty.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-company': co.id, 'x-test-role': u.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const api = as(owner)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ════════════════ P1 · marketing sends through the tenant's ONE sender ══════════════════════════
{
  const marketing = await import('./src/services/marketing.ts')
  const emailSvc = await import('./src/services/email.ts')

  check('P1: the shared email service offers a raw send, so marketing needs no sender of its own',
    typeof (emailSvc as any).sendRaw === 'function' || typeof (emailSvc as any).default?.sendRaw === 'function')

  const raw = await Bun.file(new URL('./src/services/marketing.ts', import.meta.url)).text().catch(() => '')
  // Comments in that file NAME the old client to explain why it is gone, so they are blanked before
  // the source is searched — otherwise the explanation fails the check it is explaining.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  if (src) {
    check('P1: marketing no longer carries a SendGrid client of its own', !/@sendgrid\/mail|sgMail/.test(src), src.match(/sgMail[^\n]*/)?.[0])
    check('P1: …and no longer decides for itself whether email is configured',
      !/SENDGRID_API_KEY/.test(src), src.match(/SENDGRID_API_KEY[^\n]*/)?.[0])
  }

  check('P1: and a campaign can report who it actually reached', typeof (marketing as any).getCampaignRecipients === 'function')
}

// ════════════════════════ P1 · a send is a receipt, not a claim ═════════════════════════════════
let campaignId = ''
{
  const made = await api('POST', '/api/marketing/campaigns', {
    name: 'T47 Email test', type: 'email', subject: 'Hello from the shop', content: 'Hi {{firstName}} — we are open late.',
  })
  check('P1: a campaign is created', made.status === 200 || made.status === 201, made.json)
  campaignId = (made.json?.id || made.json?.data?.id) as string

  const before = await api('GET', `/api/marketing/campaigns/${campaignId}/recipients`)
  check('P1: the recipients route EXISTS — there was none at all', before.status === 200, { status: before.status })
  check('P1: …and reports nobody before the send', before.json?.total === 0, before.json)

  const sent = await api('POST', `/api/marketing/campaigns/${campaignId}/send`, {})
  check('P1: the campaign sends', sent.status === 200, sent.json)

  const after = await api('GET', `/api/marketing/campaigns/${campaignId}/recipients`)
  check('P1: …and every recipient is on file afterwards', after.json?.total >= 1, after.json?.total)
  check('P1: …with the address it went to', !!after.json?.recipients?.[0]?.address, after.json?.recipients?.[0])
  check('P1: …and a per-recipient status, which is the thing the owner had no way to see',
    ['sent', 'failed'].includes(String(after.json?.recipients?.[0]?.status)), after.json?.recipients?.[0]?.status)
  check('P1: …summarised, because the question is "did it go out"',
    typeof after.json?.sent === 'number' && typeof after.json?.failed === 'number', after.json)

  const stranger = await api('GET', '/api/marketing/campaigns/not-a-campaign/recipients')
  check('P1: an unknown campaign is a 404', stranger.status === 404, stranger.status)
}

// ══════════════════ P1 · a campaign that reaches nobody is refused, not "sent" ═══════════════════
{
  const [lonely] = await db.insert(company).values({
    name: 'Empty Shop', slug: 'leaf-t47m2', email: 'e@test.local', state: 'OH', enabledFeatures: ['email_campaigns', 'sms_marketing'],
  } as any).returning()
  const lonelyOwner = (await db.insert(user).values({
    email: 'owner-t47m2@test.local', passwordHash: 'x', firstName: 'E', lastName: 'U', role: 'owner', companyId: lonely.id,
  } as any).returning())[0]
  const other = as(lonelyOwner)
  const made = await other('POST', '/api/marketing/campaigns', { name: 'To nobody', type: 'email', subject: 'Hi', content: 'Hi' })
  const id = made.json?.id || made.json?.data?.id
  const send = await app.request(`/api/marketing/campaigns/${id}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': lonelyOwner.id, 'x-test-company': lonely.id, 'x-test-role': 'owner' },
    body: '{}',
  })
  check('P1: a campaign with nobody to send to is refused, not marked sent', send.status >= 400, send.status)
  const [row] = await rows(sql`SELECT status FROM marketing_campaigns WHERE id = ${id}`)
  check('P1: …and the campaign is NOT left saying "sent"', row?.status !== 'sent', row?.status)
}

// ═══════════════════════════ P2 · a customer can be opted in ════════════════════════════════════
let memberId = ''
{
  const enrolled = await api('POST', '/api/loyalty/members', { contactId: withPhone.id })
  check('P2: a customer joins the programme', enrolled.status === 201, enrolled.json)
  memberId = enrolled.json?.id

  const [fresh] = await rows(sql`SELECT * FROM loyalty_members WHERE id = ${memberId}`)
  check('P2: …opted in to nothing by default, which is the right default', fresh?.opted_in_sms === false, fresh?.opted_in_sms)

  const optIn = await as(budtender)('PUT', `/api/loyalty/members/${memberId}/consent`, { optedInSms: true, source: 'in_store' })
  check('P2: a budtender at the counter can take consent — PUT used to be a 405', optIn.status === 200, { status: optIn.status, body: optIn.json })

  const [after] = await rows(sql`SELECT * FROM loyalty_members WHERE id = ${memberId}`)
  check('P2: …and it is recorded', after?.opted_in_sms === true, after?.opted_in_sms)
  check('P2: …with WHEN, because that is what "why did you text me" is asking', !!after?.opted_in_sms_at, after?.opted_in_sms_at)
  check('P2: …and where it came from', after?.consent_source === 'in_store', after?.consent_source)

  const audited = await rows(sql`SELECT * FROM audit_log WHERE entity_id = ${memberId}`)
  check('P2: …and the change is in the audit trail', audited.length >= 1, audited.length)
}

// ═══════════════ P2 · consent to be texted needs somewhere to text ══════════════════════════════
{
  const enrolled = await api('POST', '/api/loyalty/members', { contactId: noPhone.id })
  const id = enrolled.json?.id
  const optIn = await api('PUT', `/api/loyalty/members/${id}/consent`, { optedInSms: true })
  check('P2: a customer with no phone cannot be opted in to texts', optIn.status === 400, optIn.json)
  check('P2: …and is told to add a number', /phone number/i.test(String(optIn.json?.error)), optIn.json?.error)

  const email = await api('PUT', `/api/loyalty/members/${id}/consent`, { optedInEmail: true })
  check('P2: …but email consent is fine, because they have an address', email.status === 200, email.json)
}

// ═══════════════════ P2 · opting in at enrolment, and back out again ════════════════════════════
{
  const [walkIn] = await db.insert(contact).values({
    name: 'Wanda Walkin', type: 'customer', companyId: co.id, phone: '+16085550122',
  } as any).returning()
  const enrolled = await api('POST', '/api/loyalty/members', { contactId: walkIn.id, optedInSms: true, consentSource: 'in_store' })
  check('P2: consent can be taken at the moment of joining — it was silently dropped before', enrolled.status === 201, enrolled.json)
  const [row] = await rows(sql`SELECT * FROM loyalty_members WHERE id = ${enrolled.json?.id}`)
  check('P2: …and is on the record', row?.opted_in_sms === true && !!row?.opted_in_sms_at, { sms: row?.opted_in_sms, at: row?.opted_in_sms_at })

  const out = await api('PUT', `/api/loyalty/members/${enrolled.json?.id}/consent`, { optedInSms: false })
  check('P2: …and withdrawing works the same way', out.status === 200, out.json)
  const [gone] = await rows(sql`SELECT * FROM loyalty_members WHERE id = ${enrolled.json?.id}`)
  check('P2: …clearing both the flag and the date', gone?.opted_in_sms === false && !gone?.opted_in_sms_at, { sms: gone?.opted_in_sms, at: gone?.opted_in_sms_at })
}

// ══════════════════ P2 · and now an SMS campaign can actually reach someone ══════════════════════
{
  const preview = await api('GET', '/api/marketing/audience-preview?audienceType=all&channel=sms')
  check('P2: the SMS audience now counts somebody — it was 0 of 29, for ever',
    Number(preview.json?.reachable ?? preview.json?.count ?? 0) >= 1, preview.json)

  const made = await api('POST', '/api/marketing/campaigns', { name: 'T47 SMS test', type: 'sms', content: 'We are open late tonight.' })
  const id = made.json?.id || made.json?.data?.id
  const sent = await api('POST', `/api/marketing/campaigns/${id}/send`, {})
  check('P2: …so an SMS campaign is no longer refused for having nobody', !/nobody/i.test(String(sent.json?.error || '')), sent.json?.error)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
