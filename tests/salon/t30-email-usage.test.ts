// A review request is counted exactly once, and a campaign is not counted twice.
//
// The emails were arriving all along — the counter simply never saw them, because sendRaw() records
// nothing (campaigns write their own rows with the contact and campaign attached) and review requests
// wrote none of their own. The obvious fix, recording inside sendRaw, would have double-counted every
// campaign; check-email-usage-log caught that. So the reviews service records its own sends.
//
// This pins BOTH halves, because they pull in opposite directions: one more row per review email, and
// not one extra row per campaign email.
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, emailLog } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'Counted Salon', slug: 'counted', email: 'c@t.local', settings: { timezone: 'UTC', googleReviewUrl: 'https://g.page/r/abc/review', reviewRequestEnabled: true, reviewChannel: 'email', reviewRequestDelay: 0 }, enabledFeatures: ['google_reviews'] } as any).returning()
await db.insert(user).values({ email: 'c@t.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Owner', role: 'owner', companyId: co.id } as any)
const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Counted Client', email: 'counted@t.local' } as any).returning()

const rows = async () => (await db.select().from(emailLog).where(eq(emailLog.companyId, co.id))).length

console.log('\n── a review request is recorded once ──')
{
  const before = await rows()
  const reviews = await import('./src/services/reviews.ts')
  await reviews.scheduleReviewRequestForVisit({ companyId: co.id, contactId: client.id })
  await new Promise((r) => setTimeout(r, 250))   // the send is fire-and-forget
  const after = await rows()
  check('the send is written to the email log', after === before + 1, { before, after })

  const [row] = await db.select().from(emailLog).where(eq(emailLog.companyId, co.id))
  check('…addressed to the client', row?.to === 'counted@t.local', { to: row?.to })
  check('…marked sent', row?.status === 'sent', { status: row?.status })
  check('…with a sent time', !!row?.sentAt, { sentAt: row?.sentAt })
}

console.log('\n── and sendRaw itself records nothing, or campaigns would count twice ──')
{
  const before = await rows()
  const email = (await import('./src/services/email.ts')).default
  await email.sendRaw({ to: 'campaign@t.local', subject: 'A campaign', html: '<p>x</p>' })
  const after = await rows()
  check('a bare sendRaw leaves no row — marketing writes its own', after === before, { before, after })
}

console.log(`\nt30-email-usage: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
