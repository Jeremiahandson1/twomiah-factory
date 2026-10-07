// T58j — "check the vet invoice timezone after 8pm ET."
//
// That is the owner's own retest instruction, and it is one no round has ever managed to carry out:
// the defect only shows between 8pm and midnight Eastern, and every pass so far has run in the
// morning. The salon has had t28-evening-dates since T28 for exactly this reason — the finding it
// covers ("after 7 PM Central, today and invoice dates are a day ahead") went two rounds unretested
// until the clock was PINNED instead of waited for. Vet never got the equivalent, so the practice's
// own evening was still unasserted.
//
// The instant chosen is tomorrow at 01:30 UTC, which in America/New_York is 21:30 the PREVIOUS day —
// after 8pm ET, the window the owner named. Every question below therefore has two right-looking
// answers, the UTC day and the practice's day, and only one is correct. A test running at any other
// hour cannot tell them apart, which is precisely why this survived.
//
// Freezing the clock rather than stubbing the helpers means the real route, the real shared invoicing
// and the real date utilities all run; nothing is faked except what time it is.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact } = await import('./db/schema.ts')

const TZ = 'America/New_York'
const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

// ── the clock ────────────────────────────────────────────────────────────────────────────────────
// Tomorrow at 01:30 UTC — a real future instant, so nothing else in the app thinks time ran backwards.
const RealDate = Date
const frozen = new RealDate(RealDate.UTC(
  new RealDate().getUTCFullYear(), new RealDate().getUTCMonth(), new RealDate().getUTCDate() + 1, 1, 30, 0,
))
const utcDay = frozen.toISOString().slice(0, 10)
const practiceDay = dayIn(frozen, TZ)
console.log(`\nfrozen at ${frozen.toISOString()}  ·  UTC day ${utcDay}  ·  ${TZ} day ${practiceDay} (${dayIn(frozen, TZ) === utcDay ? 'SAME' : '21:30 the previous evening'})`)
if (utcDay === practiceDay) { console.log('FAIL the two days are the same — this test cannot discriminate'); process.exit(1) }

class FrozenDate extends RealDate {
  constructor(...args: any[]) {
    // @ts-expect-error — forwarding the real constructor's overloads
    if (args.length === 0) super(frozen.getTime()); else super(...args)
  }
  static now() { return frozen.getTime() }
}
;(globalThis as any).Date = FrozenDate

// ── the practice ─────────────────────────────────────────────────────────────────────────────────
const [co] = await db.insert(company).values({
  name: 'Evening Veterinary', slug: 'evening-vet-t58j', email: 'evening@vet.local', state: 'OH',
  settings: { timezone: TZ }, enabledFeatures: ['invoices'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner@evening-vet.local', passwordHash: 'x', firstName: 'Ona', lastName: 'Owner',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({
  companyId: co.id, name: 'Priya Raman', email: 'priya-t58j@vet.local', type: 'client',
} as any).returning()

const app = new Hono()
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ── the invoice's issue date ─────────────────────────────────────────────────────────────────────
console.log('\n── an invoice raised at 9:30 PM Eastern is dated TODAY, not tomorrow ──')
{
  const r = await call('POST', '/api/invoices', {
    contactId: client.id, lineItems: [{ description: 'Rabies booster', quantity: 1, unitPrice: 35 }],
  })
  check('the invoice is raised', r.status === 201, { status: r.status, body: r.json })
  const issued = String(r.json?.issueDate || '').slice(0, 10)
  check(`its issue date is the practice's day (${practiceDay})`, issued === practiceDay, { issueDate: issued, practiceDay, utcDay })
  check(`…and NOT the UTC day (${utcDay})`, issued !== utcDay, { issueDate: issued })
}

// An explicitly supplied date is still honoured — the business's clock decides only the DEFAULT.
console.log('\n── an issue date the user typed is not overridden ──')
{
  const chosen = '2026-03-04'
  const r = await call('POST', '/api/invoices', {
    contactId: client.id, issueDate: chosen,
    lineItems: [{ description: 'Dental', quantity: 1, unitPrice: 120 }],
  })
  check('the invoice is raised', r.status === 201, { status: r.status, body: r.json })
  check(`the typed issue date survives (${chosen})`, String(r.json?.issueDate || '').slice(0, 10) === chosen, { issueDate: r.json?.issueDate })
}

// ── the zone the owner's own tenants actually resolve by ─────────────────────────────────────────
//
// vettest carries state 'OH' and no settings.timezone, and companyRowTimeZone falls back to the state
// map. So the evening behaviour must hold for a practice that never set a timezone at all — which is
// the shape of every tenant in the fleet.
console.log('\n── a practice that never set a timezone, resolving by state ──')
{
  const [ohio] = await db.insert(company).values({
    name: 'Ohio Veterinary', slug: 'ohio-vet-t58j', email: 'ohio@vet.local', state: 'OH',
    settings: {}, enabledFeatures: ['invoices'],
  } as any).returning()
  const [ohioOwner] = await db.insert(user).values({
    email: 'owner@ohio-vet.local', passwordHash: 'x', firstName: 'Otto', lastName: 'Owner',
    role: 'owner', companyId: ohio.id, isActive: true,
  } as any).returning()
  const [ohioClient] = await db.insert(contact).values({
    companyId: ohio.id, name: 'Dale Finch', email: 'dale-t58j@vet.local', type: 'client',
  } as any).returning()
  const res = await app.request('/api/invoices', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': ohioOwner.id },
    body: JSON.stringify({ contactId: ohioClient.id, lineItems: [{ description: 'Exam', quantity: 1, unitPrice: 60 }] }),
  })
  const j: any = await res.json().catch(() => null)
  check('the invoice is raised', res.status === 201, { status: res.status, body: j })
  const issued = String(j?.issueDate || '').slice(0, 10)
  check(`state OH alone dates it ${practiceDay}, not ${utcDay}`, issued === practiceDay, { issueDate: issued, practiceDay, utcDay })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
