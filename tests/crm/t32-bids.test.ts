// T32 H6 (and L5) — "Bid → job does not exist, and bids have no state guards."
//
// The report created BID-0001, revised it to $16,900, submitted it and marked it Won. Then:
//   · No conversion anywhere. convert, convert-to-job and create-job all 404. So winning a bid meant
//     retyping the project name, the client and the value into the Projects screen by hand — at the
//     one moment in the whole flow when all of it is already on the screen in front of you.
//   · Won → Lost → Submitted all went through. Which also left `resultDate` holding the old win date
//     on a bid that was back in the pipeline (L5).
//   · The Pipeline tile used the estimate ($18,000) and the Won value used the bid ($16,900) — the
//     same bid as two different figures depending which tile you read.
//   · A −$500 bid amount was accepted.
//   · The client is free text with no contact link, so there was nothing to carry over anyway.
import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const cents = (n: unknown) => Math.round(Number(n || 0) * 100)
const isMoney = (a: unknown, e: number) => cents(a) === cents(e)

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, project, bid } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Bid Co', slug: 'bid-co', email: 'b@test.local', state: 'OH', settings: {},
  enabledFeatures: ['bid_management', 'projects'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-bid@test.local', passwordHash: 'x', firstName: 'Ray', lastName: 'Okafor',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Harborview Trust', type: 'customer' } as any).returning()

const app = new Hono()
app.route('/api/bids', (await import('./src/routes/bids.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const mkBid = (over: Record<string, unknown> = {}) => api('POST', '/api/bids', {
  projectName: 'Harborview fit-out', client: 'Harborview Trust', contactId: client.id,
  estimatedValue: 18_000, bidAmount: 16_900, ...over,
})
const statusOf = async (id: string) => (await db.select().from(bid).where(eq(bid.id, id)).limit(1))[0]

// ══════════ money cannot be negative ═══════════════════════════════════════════════════════════
{
  const neg = await mkBid({ bidAmount: -500 })
  check('a negative bid amount is refused', neg.status === 400, { status: neg.status, body: neg.text?.slice(0, 200) })
  const negEst = await mkBid({ estimatedValue: -500 })
  check('…and so is a negative estimate', negEst.status === 400, { status: negEst.status })
}

// ══════════ the lifecycle ══════════════════════════════════════════════════════════════════════
{
  const made = await mkBid()
  check('a bid is created as a draft', made.status === 201 && made.json?.status === 'draft', { status: made.status, bidStatus: made.json?.status })
  const id = made.json?.id

  const early = await api('POST', `/api/bids/${id}/won`)
  check('a DRAFT cannot be marked won — nobody has been given it to answer', early.status === 400, { status: early.status, body: early.text?.slice(0, 200) })

  const sub = await api('POST', `/api/bids/${id}/submit`)
  check('submitting a draft works', sub.status === 200 && sub.json?.status === 'submitted', { status: sub.status, bidStatus: sub.json?.status })
  const resub = await api('POST', `/api/bids/${id}/submit`)
  check('…and submitting it twice is refused', resub.status === 400, { status: resub.status })

  const won = await api('POST', `/api/bids/${id}/won`)
  check('marking a submitted bid won works', won.status === 200 && won.json?.status === 'won', { status: won.status, bidStatus: won.json?.status })
  const winDate = (await statusOf(id))?.resultDate

  const lost = await api('POST', `/api/bids/${id}/lost`)
  check('a WON bid cannot then be marked lost', lost.status === 400, { status: lost.status, body: lost.text?.slice(0, 220) })
  const back = await api('POST', `/api/bids/${id}/submit`)
  check('…nor put back to submitted, which is the Won → Lost → Submitted walk closed', back.status === 400, { status: back.status })
  const now = await statusOf(id)
  check('…it is still won', now?.status === 'won', now?.status)
  check('…and resultDate still holds the day it was won (T32 L5 cannot happen)',
    String(now?.resultDate) === String(winDate), { resultDate: now?.resultDate, winDate })

  const edit = await api('PUT', `/api/bids/${id}`, { bidAmount: 99_999 })
  check('a decided bid cannot be edited — its amount is what was submitted', edit.status === 400, { status: edit.status, body: edit.text?.slice(0, 220) })
  check('…and the amount did not move', isMoney((await statusOf(id))?.bidAmount, 16_900), (await statusOf(id))?.bidAmount)
}

// ══════════ one figure per bid ═════════════════════════════════════════════════════════════════
{
  // A clean tenant for the stats, so the bids above do not muddy the arithmetic.
  const [co2] = await db.insert(company).values({
    name: 'Stats Co', slug: 'stats-co', email: 's2@test.local', state: 'OH', settings: {},
    enabledFeatures: ['bid_management', 'projects'],
  } as any).returning()
  const [owner2] = await db.insert(user).values({
    email: 'owner-stats@test.local', passwordHash: 'x', firstName: 'Sal', lastName: 'Vine',
    role: 'owner', companyId: co2.id, isActive: true,
  } as any).returning()
  const as2 = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method, headers: { 'content-type': 'application/json', 'x-test-user': owner2.id },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j }
  }

  // In the pipeline: an estimate with no bid yet, and one with both.
  await as2('POST', '/api/bids', { projectName: 'Estimate only', estimatedValue: 5000 })
  const both = await as2('POST', '/api/bids', { projectName: 'Both figures', estimatedValue: 18_000, bidAmount: 16_900 })
  // And one won.
  const winner = await as2('POST', '/api/bids', { projectName: 'The winner', estimatedValue: 18_000, bidAmount: 16_900 })
  await as2('POST', `/api/bids/${winner.json.id}/submit`)
  await as2('POST', `/api/bids/${winner.json.id}/won`)

  const stats = await as2('GET', '/api/bids/stats')
  check('the pipeline uses the BID amount where there is one, and the estimate where there is not',
    isMoney(stats.json?.pipelineValue, 5000 + 16_900),
    { pipelineValue: stats.json?.pipelineValue, expected: 21_900, oldEstimateFirst: 5000 + 18_000 })
  check('…and the won value is the same figure, so the two tiles are comparable',
    isMoney(stats.json?.wonValue, 16_900), { wonValue: stats.json?.wonValue })
  check('…a won bid is out of the pipeline', !isMoney(stats.json?.pipelineValue, 5000 + 16_900 + 16_900), stats.json?.pipelineValue)
  check('…and the win rate is over DECIDED bids, not all of them', stats.json?.winRate === 100, { winRate: stats.json?.winRate })
  void both
}

// ══════════ won → a project, once ══════════════════════════════════════════════════════════════
{
  const made = await mkBid({ projectName: 'Pier replacement', bidAmount: 240_000, estimatedValue: 255_000 })
  const id = made.json?.id

  const tooSoon = await api('POST', `/api/bids/${id}/convert`)
  check('a draft bid cannot become a project — nobody has awarded it', tooSoon.status === 400, { status: tooSoon.status, body: tooSoon.text?.slice(0, 220) })

  await api('POST', `/api/bids/${id}/submit`)
  const stillNo = await api('POST', `/api/bids/${id}/convert`)
  check('…nor a submitted one', stillNo.status === 400, { status: stillNo.status })

  await api('POST', `/api/bids/${id}/won`)
  const conv = await api('POST', `/api/bids/${id}/convert`)
  check('a WON bid becomes a project', conv.status === 201 && !!conv.json?.project?.id, { status: conv.status, body: conv.text?.slice(0, 220) })
  check('…named from the bid', conv.json?.project?.name === 'Pier replacement', conv.json?.project?.name)
  check('…numbered in the project sequence', /^PRJ-\d{4}$/.test(String(conv.json?.project?.number || '')), conv.json?.project?.number)
  check('…worth the AWARDED amount, not the estimate it started from',
    isMoney(conv.json?.project?.estimatedValue, 240_000), { value: conv.json?.project?.estimatedValue, estimate: 255_000 })
  check('…with the contact carried over', conv.json?.project?.contactId === client.id, { contactId: conv.json?.project?.contactId })
  check('…and the API says the contact came with it', conv.json?.contactCarried === true, conv.json?.contactCarried)
  check('…the bid records what it became', (await statusOf(id))?.projectId === conv.json?.project?.id,
    { projectId: (await statusOf(id))?.projectId })

  // Idempotent — the fault T32 H3 found in selections, where one decision raised five change orders.
  const again = await api('POST', `/api/bids/${id}/convert`)
  check('converting twice does NOT make a second project', again.status === 200 && again.json?.created === false,
    { status: again.status, created: again.json?.created })
  check('…it returns the one that exists', again.json?.project?.id === conv.json?.project?.id, { id: again.json?.project?.id })
  const n: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM project WHERE name = 'Pier replacement'`)
  check('…and there is exactly one', Number((n.rows || n)[0]?.n) === 1, (n.rows || n)[0])
  check('…saying so, rather than pretending it made one', /already/i.test(String(again.json?.message || '')), again.json?.message)
}

// ══════════ a bid for somebody who is not a contact yet ════════════════════════════════════════
{
  // Normal: you bid work before the client is a customer. The free-text client stays usable, and the
  // conversion says the project has no contact rather than inventing one from a typed string.
  const made = await api('POST', '/api/bids', { projectName: 'Cold prospect', client: 'Someone New Ltd', bidAmount: 9000 })
  check('a bid with a free-text client and no contact is accepted', made.status === 201, { status: made.status, body: made.text?.slice(0, 200) })
  await api('POST', `/api/bids/${made.json.id}/submit`)
  await api('POST', `/api/bids/${made.json.id}/won`)
  const conv = await api('POST', `/api/bids/${made.json.id}/convert`)
  check('…and it still converts', conv.status === 201, { status: conv.status, body: conv.text?.slice(0, 220) })
  check('…with no contact, honestly reported', conv.json?.contactCarried === false && !conv.json?.project?.contactId,
    { contactCarried: conv.json?.contactCarried, contactId: conv.json?.project?.contactId })
  check('…and the message says to add the client', /add the client/i.test(String(conv.json?.message || '')), conv.json?.message)
  check('…the free-text client is kept on the project where somebody can see it',
    /Someone New Ltd/.test(String(conv.json?.project?.notes || '')), conv.json?.project?.notes)
}

// ══════════ scoping ═══════════════════════════════════════════════════════════════════════════
{
  const [other] = await db.insert(company).values({
    name: 'Other Bid Co', slug: 'other-bid', email: 'ob@test.local', state: 'OH', settings: {},
    enabledFeatures: ['bid_management'],
  } as any).returning()
  const [theirs] = await db.insert(bid).values({
    companyId: other.id, number: 'BID-9999', projectName: 'Theirs', status: 'won', bidAmount: '1000',
  } as any).returning()
  const r = await api('POST', `/api/bids/${theirs.id}/convert`)
  check("another tenant's bid cannot be converted", r.status === 404, { status: r.status })
  const p: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM project WHERE name = 'Theirs'`)
  check('…and no project was made', Number((p.rows || p)[0]?.n) === 0, (p.rows || p)[0])
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
