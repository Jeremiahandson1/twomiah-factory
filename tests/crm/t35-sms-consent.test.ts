// T35 N1 — withdrawing SMS consent, which the product acknowledged and then lost.
//
// The shared contact page has always offered "Opt Out SMS", and the shared SMS sender has always
// refused to text a contact whose row carries the flag:
//
//     if ((contactRow as any).optedOutSms) return null
//
// On this vertical the COLUMN did not exist. So the toggle answered 200 and stored nothing, the
// screen said "SMS opted out", and that guard read `undefined` and sent the message anyway. The
// tester found it by reading the row back after the toggle claimed success.
//
// Two reasons this suite exists rather than a single assertion that the field saves:
//
//   1. A SAVED FLAG NOBODY READS IS THE SAME BUG one layer along. crm-fieldservice, crm-landscaping
//      and crm-basic have carried this column for months and NO suite in any vertical asserted the
//      sender honours it — which is exactly why it rotted here unnoticed. So the central assertion
//      is about the SEND, not the save.
//
//   2. A refusal has to be told from the OTHER refusals. With no Twilio number and an empty usage
//      wallet the sender also declines, and a test that only checked "nothing was sent" would pass
//      on a tenant where texting was simply never set up. The consent refusal returns `null`; the
//      setup and wallet refusals return an object carrying `refused: true`. The opted-IN case here
//      must reach one of those, proving the send attempt got PAST the consent check.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Consent Co', slug: 'consent-co', email: 'c@test.local', state: 'OH',
  settings: { timezone: 'UTC' }, enabledFeatures: ['contacts', 'two_way_texting'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-consent@test.local', passwordHash: 'x', firstName: 'O', lastName: 'W',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
/** The stored row, read with raw SQL — the point is what is in the database, not what the route echoed. */
const stored = async (id: string) => {
  const r: any = await db.execute(sql`SELECT opted_out_sms, email_opt_out FROM contact WHERE id = ${id}`)
  return (r.rows || r)[0]
}

const [person] = await db.insert(contact).values({
  companyId: co.id, name: 'Dana Customer', type: 'customer', phone: '6085550166',
} as any).returning()

// ══════════ the toggle actually persists ══════════════════════════════════════════════════════
{
  check('a contact starts opted IN', (await stored(person.id))?.opted_out_sms === false, await stored(person.id))

  const out = await api('PUT', `/api/contacts/${person.id}`, { optedOutSms: true })
  check('the opt-out toggle answers 200', out.status === 200, { status: out.status, body: out.text.slice(0, 160) })
  check('…and the flag is in the DATABASE, not just the response', (await stored(person.id))?.opted_out_sms === true, await stored(person.id))
  check('…and the response says so too, so the screen can render it', out.json?.optedOutSms === true, out.json?.optedOutSms)

  const back = await api('PUT', `/api/contacts/${person.id}`, { optedOutSms: false })
  check('opting back in persists as well', back.status === 200 && (await stored(person.id))?.opted_out_sms === false, await stored(person.id))

  // An edit that says nothing about consent must not reset it. The screen PUTs whole-form bodies.
  await api('PUT', `/api/contacts/${person.id}`, { optedOutSms: true })
  const unrelated = await api('PUT', `/api/contacts/${person.id}`, { name: 'Dana Customer', city: 'Dayton' })
  check('an unrelated edit leaves the opt-out alone',
    unrelated.status === 200 && (await stored(person.id))?.opted_out_sms === true, await stored(person.id))
}

// ══════════ THE SENDER HONOURS IT — the half that was silently dead ═══════════════════════════
{
  const sms = (await import('./src/services/sms.ts')).default
  const [optedIn] = await db.insert(contact).values({
    companyId: co.id, name: 'Wants Texts', type: 'customer', phone: '6085550167',
  } as any).returning()

  // person is opted OUT from the block above.
  const refusedForConsent = await sms.sendSMS(co.id, { contactId: person.id, message: 'Your crew is on the way' })
  check('texting a contact who opted out is refused', refusedForConsent === null, refusedForConsent)

  const attempted = await sms.sendSMS(co.id, { contactId: optedIn.id, message: 'Your crew is on the way' })
    .catch((e: any) => ({ threw: String(e?.message || e) }))
  /*
   * Not a send — this sandbox has no Twilio number and no usage wallet. The POINT is that it is a
   * DIFFERENT refusal: an object carrying `refused`, or a throw. If this came back `null` too, the
   * assertion above would be passing for the wrong reason and the consent check could be deleted
   * without any test noticing.
   */
  check('…while texting a contact who did not opt out gets past the consent check',
    attempted !== null && typeof attempted === 'object' &&
    ((attempted as any).refused === true || typeof (attempted as any).threw === 'string' || !!(attempted as any).id),
    attempted)

  const msgs: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM sms_message`)
  check('…and no message row was written for the opted-out contact', Number((msgs.rows || msgs)[0].n) === 0, (msgs.rows || msgs)[0])
}

// ══════════ a job update is the other sender, and it reads the same flag ══════════════════════
{
  const { job } = await import('./db/schema.ts')
  const sms = (await import('./src/services/sms.ts')).default
  const [theJob] = await db.insert(job).values({
    companyId: co.id, number: 'JOB-CONSENT', title: 'Replace the panel', contactId: person.id,
  } as any).returning()
  const out = await sms.sendJobUpdate(co.id, theJob.id, 'on_the_way')
  check('an automatic job update will not text an opted-out customer either', out === null, out)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
