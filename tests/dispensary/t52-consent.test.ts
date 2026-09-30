// crm-dispensary — T51/T52 N1: ticking Email ON answered 500, saved anyway, and wrote no audit row.
//
// This is my own regression from the T49 H1 fix. H1 added "a fresh opt-in at the counter OVERRIDES
// an old unsubscribe", and wrote it in SQL:
//
//     SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) - 'emailOptOut' - 'emailOptOutDate'
//                       || jsonb_build_object('emailOptInAt', …)
//
// contact.custom_fields is a `json` column, not `jsonb`. Those operators do not exist for `json`, so
// the statement threw. Three consequences, and the third is why the tester called it a high:
//
//   1. the request answered 500;
//   2. the member UPDATE had already committed, so the consent WAS saved — the screen showed an
//      error and put the tick back while the record said the opposite;
//   3. the throw happened before audit.log, so an email opt-in was the one consent change in the
//      product that went unrecorded. Turning it OFF was audited normally. That is precisely the gap
//      T49 H1 existed to close, reopened by the fix for it.
//
// Pinned here: the 200, the stored state, the cleared opt-out, AND the audit row.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 340)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Consent Leaf', slug: 'leaf-n1', email: 'n1@test.local', state: 'OH',
  enabledFeatures: ['loyalty', 'contacts', 'email_marketing'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-n1@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/loyalty', (await import('./src/routes/loyalty.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// A customer who unsubscribed in the past — the case H1 was written for.
const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Unsubscribed', companyId: co.id, dateOfBirth: '1985-04-02',
  phone: '555-0101', email: 'ada@test.local',
  customFields: { emailOptOut: true, emailOptOutDate: '2026-03-01T00:00:00.000Z', keepMe: 'yes' },
} as any).returning()
const enrolled = await api('POST', '/api/loyalty/members', { contactId: cust.id })
const memberId = (enrolled.json?.data || enrolled.json)?.id
check('the customer is enrolled in loyalty', !!memberId, { status: enrolled.status, body: enrolled.json })

// ══════════ ticking Email ON ════════════════════════════════════════════════════════════════════
{
  const before = (await rows(sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE company_id = ${co.id}`))[0]?.n ?? 0

  const on = await api('PUT', `/api/loyalty/members/${memberId}/consent`, { optedInEmail: true, source: 'in_store' })
  check('ticking Email ON answers 200 — it used to answer 500', on.status === 200, { status: on.status, body: on.json })

  const [m] = await rows(sql`SELECT opted_in_email, opted_in_email_at, consent_source FROM loyalty_members WHERE id = ${memberId}`)
  check('…and the consent is stored', m?.opted_in_email === true, m)
  check('…with the moment it was given', !!m?.opted_in_email_at, m?.opted_in_email_at)
  check('…and where it came from', String(m?.consent_source) === 'in_store', m?.consent_source)

  // The whole point of H1: the old unsubscribe must stop suppressing them.
  const [c2] = await rows(sql`SELECT custom_fields FROM contact WHERE id = ${cust.id}`)
  const cf = typeof c2?.custom_fields === 'string' ? JSON.parse(c2.custom_fields) : c2?.custom_fields
  check('the old unsubscribe is cleared', cf?.emailOptOut === undefined, cf)
  check('…and its date with it', cf?.emailOptOutDate === undefined, cf)
  check('…the opt-in is recorded on the contact', !!cf?.emailOptInAt && cf?.emailOptInSource === 'in_store', cf)
  check('…and nothing else in customFields was trampled', cf?.keepMe === 'yes', cf)

  // The half that made this a HIGH rather than a 500.
  const after = await rows(sql`
    SELECT action, entity, changes FROM audit_log
    WHERE company_id = ${co.id} AND entity = 'loyalty_member'
    ORDER BY created_at DESC LIMIT 5
  `)
  check('an audit row is written for an email OPT-IN — there was none at all', after.length > 0, after.length)
  const changed = after.map((r) => (typeof r.changes === 'string' ? JSON.parse(r.changes) : r.changes))
  check('…and it records the consent that changed',
    changed.some((c3: any) => c3?.optedInEmail?.new === true), changed.slice(0, 2))
  const now = (await rows(sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE company_id = ${co.id}`))[0]?.n ?? 0
  check('…so the audit log actually grew', Number(now) > Number(before), { before, after: now })
}

// ══════════ turning it OFF still behaves, and SMS is untouched ══════════════════════════════════
{
  const off = await api('PUT', `/api/loyalty/members/${memberId}/consent`, { optedInEmail: false })
  check('turning Email OFF answers 200', off.status === 200, { status: off.status, body: off.json })
  const [m] = await rows(sql`SELECT opted_in_email, opted_in_email_at, opted_in_sms FROM loyalty_members WHERE id = ${memberId}`)
  check('…and clears the flag and its timestamp together', m?.opted_in_email === false && m?.opted_in_email_at === null, m)
  check('…and does NOT touch the SMS permission — they are two permissions (T49 H1)', m?.opted_in_sms !== true, m?.opted_in_sms)

  const sms = await api('PUT', `/api/loyalty/members/${memberId}/consent`, { optedInSms: true, source: 'in_store' })
  check('SMS consent still saves for a customer who has a phone', sms.status === 200, { status: sms.status, body: sms.json })
}

// ══════════ a second opt-in on a customer who never unsubscribed ════════════════════════════════
//
// The opt-out clear has to be a no-op rather than an error when there is nothing to clear — that is
// the ordinary case at the counter.
{
  const [fresh] = await db.insert(contact).values({
    type: 'customer', name: 'Ben Fresh', companyId: co.id, dateOfBirth: '1990-01-01', email: 'ben@test.local',
  } as any).returning()
  const e = await api('POST', '/api/loyalty/members', { contactId: fresh.id })
  const id2 = (e.json?.data || e.json)?.id
  const on = await api('PUT', `/api/loyalty/members/${id2}/consent`, { optedInEmail: true })
  check('a customer with no customFields at all can opt in', on.status === 200, { status: on.status, body: on.json })
  const [c3] = await rows(sql`SELECT custom_fields FROM contact WHERE id = ${fresh.id}`)
  const cf = typeof c3?.custom_fields === 'string' ? JSON.parse(c3.custom_fields) : c3?.custom_fields
  check('…and the opt-in is recorded', !!cf?.emailOptInAt, cf)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
