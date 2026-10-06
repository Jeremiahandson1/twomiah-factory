// Warranty claims: "Reported Via" is stored, and scheduling one numbers its job like every other job.
//
// TWO OWNER FINDINGS, both the last step of a path that already existed.
//
//   "Reported Via on warranty claims isn't saved."  WarrantiesPage.tsx:605 has asked it since the
//   form was written — Phone / Email / Client Portal / In Person — :509 defaults it, :517 posts the
//   whole form, the route spreads ...body and adds reportedBy, and createClaim's signature declares
//   both. The INSERT listed neither. A field that cannot be wrong because nothing reads it.
//
//   "Scheduling a warranty claim creates a job numbered WC-… instead of JOB-xxxxx."  It was
//   `number: \`WC-${Date.now()}\``. agreements.ts:425 carries the identical comment about
//   `JOB-AGR-<timestamp>` — the same fault, found and fixed on the agreements path, and this one was
//   the sibling nobody went back for.
//
// Worth a test rather than a look, because both touch things that fail at RUNTIME and not at build:
// two new columns behind a migration, and a job insert moved inside a transaction that takes a
// per-company advisory lock. esbuild is happy with either even when the column is missing.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 340)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const schema: any = await import('./db/schema.ts')
const { company, user, contact, project, projectWarranty, warrantyClaim, job } = schema

check('the migration landed: warranty_claim can hold how it was reported, and by whom',
  !!warrantyClaim && 'reportedMethod' in warrantyClaim && 'reportedBy' in warrantyClaim,
  Object.keys(warrantyClaim || {}).filter((k) => /report/i.test(k)))

const [co] = await db.insert(company).values({
  name: 'Haverkamp Build', slug: 'haverkamp-t48', email: 'w48@test.local',
  settings: {}, enabledFeatures: ['projects', 'warranties', 'contacts', 'jobs'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t48@test.local', passwordHash: 'x', firstName: 'Olive', lastName: 'H',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Marit Haverkamp', email: 'marit-t48@test.local',
} as any).returning()
const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: 'Orchard barn', number: 'PRJ-0148', status: 'completed',
} as any).returning()
const [pw] = await db.insert(projectWarranty).values({
  companyId: co.id, projectId: proj.id, contactId: client.id,
  name: 'Roof covering — 10 year', category: 'roofing', status: 'active',
  startsAt: new Date('2026-01-10'), expiresAt: new Date('2036-01-10'),
} as any).returning()

/**
 * Jobs that already exist, so the number this test asserts is the NEXT one in the shop's sequence
 * rather than the first. A fix that produced JOB-00001 on a shop with 47 jobs would pass a test that
 * only checked the prefix.
 */
for (const n of ['JOB-00001', 'JOB-00002', 'JOB-00003']) {
  await db.insert(job).values({
    companyId: co.id, contactId: client.id, number: n, title: `Existing ${n}`, status: 'completed',
  } as any)
}

const app = new Hono()
app.route('/api/warranties', (await import('./src/routes/warranties.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

console.log('\n══════════ Reported Via is stored ══════════')
let claimId = ''
{
  const r = await call('POST', '/api/warranties/claims', {
    warrantyId: pw.id,
    title: 'Ridge tiles lifted in the gale',
    location: 'North elevation, above the kitchen',
    priority: 'high',
    description: 'Three ridge tiles lifted. Water staining on the ceiling below.',
    reportedMethod: 'portal',
  })
  check('a claim is filed', r.status === 201, { status: r.status, body: r.text?.slice(0, 220) })
  claimId = r.json?.id || ''
  check('T48: the method the form sent is stored', r.json?.reportedMethod === 'portal', { reportedMethod: r.json?.reportedMethod })
  check('…and who filed it, which the route has been computing all along',
    r.json?.reportedBy === owner.id, { reportedBy: r.json?.reportedBy, expected: owner.id })
  // the three from T44, still held — a round that re-breaks its predecessor is not progress
  check('…alongside the title, location and priority', r.json?.title === 'Ridge tiles lifted in the gale'
    && r.json?.location === 'North elevation, above the kitchen' && r.json?.priority === 'high',
    { title: r.json?.title, location: r.json?.location, priority: r.json?.priority })
}
{
  const r = await call('GET', '/api/warranties/claims')
  const rows = Array.isArray(r.json) ? r.json : (r.json?.data ?? [])
  const mine = rows.find((x: any) => x.id === claimId)
  check('…and it comes back on the list the screen reads', mine?.reportedMethod === 'portal',
    { reportedMethod: mine?.reportedMethod, n: rows.length })
}
{
  // A value the select cannot produce is refused, so the column only ever holds one of the four.
  const r = await call('POST', '/api/warranties/claims', {
    warrantyId: pw.id, title: 'Carrier pigeon', description: 'x', reportedMethod: 'smoke-signal',
  })
  check('a method the form cannot produce is refused, and the message lists what is allowed',
    r.status === 400 && /phone/.test(String(r.json?.error ?? '')), { status: r.status, error: r.json?.error })
}
{
  // …and omitting it is fine: an old claim and a caller that does not care both still work.
  const r = await call('POST', '/api/warranties/claims', {
    warrantyId: pw.id, title: 'Gutter joint seeping', description: 'Slow drip at the downpipe.',
  })
  check('omitting it is allowed — it is not a required field', r.status === 201, { status: r.status, body: r.text?.slice(0, 160) })
  check('…and reads back as unknown rather than a guess', r.json?.reportedMethod == null, { reportedMethod: r.json?.reportedMethod })
}

console.log('\n══════════ scheduling it numbers the job properly ══════════')
{
  const r = await call('POST', `/api/warranties/claims/${claimId}/schedule`, { scheduledDate: '2026-11-18' })
  check('the claim schedules', r.status >= 200 && r.status < 300, { status: r.status, body: r.text?.slice(0, 220) })

  const jobs = await db.select().from(job).where((await import('drizzle-orm')).eq(job.companyId, co.id))
  const made = jobs.filter((j: any) => !String(j.number).startsWith('JOB-0000') || Number(String(j.number).replace('JOB-', '')) > 3)
  const numbers = jobs.map((j: any) => j.number).sort()
  check('T48: no job is numbered WC-<timestamp>',
    !jobs.some((j: any) => String(j.number).startsWith('WC-')), numbers)
  check('…it takes the next number in the shop\'s own sequence',
    made.length === 1 && made[0].number === 'JOB-00004', { got: made.map((j: any) => j.number), expected: 'JOB-00004', all: numbers })
  check('…and the job is named from the claim\'s TITLE, not the first 50 characters of its description',
    made.length === 1 && String(made[0].title).includes('Ridge tiles lifted in the gale'),
    { title: made[0]?.title })
  check('…carrying the claim\'s priority rather than a flat normal',
    made.length === 1 && made[0].priority === 'high', { priority: made[0]?.priority })
}

/**
 * T51 — "Completing a warranty claim leaves its job scheduled."
 *
 * The claim above has just put JOB-00004 on the board. Marking the claim completed resolved the
 * claim and stopped there, so the work order stayed `scheduled` for ever and the board showed
 * warranty work that had been finished. The link it needs — warranty_claim.job_id — did not exist
 * until this round; scheduleWarrantyWork created a job and forgot which one.
 */
console.log('\n══════════ completing the claim closes the job it raised ══════════')
const { eq, and } = await import('drizzle-orm')
check('the migration landed: a claim can point at its job',
  'jobId' in warrantyClaim, Object.keys(warrantyClaim || {}).filter((k) => /job/i.test(k)))
{
  const [c] = await db.select().from(warrantyClaim).where(eq(warrantyClaim.id, claimId))
  const [j] = await db.select().from(job).where(eq(job.number, 'JOB-00004'))
  check('T51: scheduling recorded WHICH job it made', c?.jobId === j?.id, { jobId: c?.jobId, job: j?.id })
  check('…and that job starts out scheduled, which is the state the finding is about',
    j?.status === 'scheduled', { status: j?.status })
}
{
  const r = await call('PUT', `/api/warranties/claims/${claimId}/status`, { status: 'completed' })
  check('the claim completes', r.status === 200, { status: r.status, body: r.text?.slice(0, 220) })

  const [c] = await db.select().from(warrantyClaim).where(eq(warrantyClaim.id, claimId))
  check('…the claim is completed and stamped', c?.status === 'completed' && !!c?.resolvedAt,
    { status: c?.status, resolvedAt: c?.resolvedAt })

  const [j] = await db.select().from(job).where(eq(job.number, 'JOB-00004'))
  check('T51: and its job is completed too, not left on the board',
    j?.status === 'completed', { status: j?.status })
  check('…with a completion time, so it reaches the completed counts and the costing report',
    !!j?.completedAt, { completedAt: j?.completedAt })
  check('…and the trail says the second write happened',
    /JOB-00004/.test(String(r.json?.job?.number ?? '')), { job: r.json?.job?.number })
}
{
  // A CANCELLED job is not quietly reopened as completed. This is the Jobs page's own rule
  // (JobsPage.tsx:176 hides Complete on completed and cancelled), not a new one.
  const r2 = await call('POST', '/api/warranties/claims', {
    warrantyId: pw.id, title: 'Flashing at the chimney', description: 'Seeping in driving rain.',
  })
  const second = r2.json?.id
  await call('POST', `/api/warranties/claims/${second}/schedule`, { scheduledDate: '2026-11-20' })
  const [c2] = await db.select().from(warrantyClaim).where(eq(warrantyClaim.id, second))
  await db.update(job).set({ status: 'cancelled' }).where(eq(job.id, c2.jobId))

  const r = await call('PUT', `/api/warranties/claims/${second}/status`, { status: 'completed' })
  check('a claim over a CANCELLED job still completes', r.status === 200, { status: r.status })
  const [j2] = await db.select().from(job).where(eq(job.id, c2.jobId))
  check('…and the cancelled job stays cancelled', j2?.status === 'cancelled', { status: j2?.status })
}
{
  const r = await call('PUT', `/api/warranties/claims/${claimId}/status`, { status: 'all-done' })
  check('T51: a status no screen draws is refused', r.status === 400, { status: r.status, body: r.text?.slice(0, 200) })
  check('…and the message lists the five that exist',
    /open/.test(String(r.json?.error ?? '')) && /denied/.test(String(r.json?.error ?? '')), { error: r.json?.error })
}
{
  // T51: the update matched on the claim id ALONE, so another tenant's claim could be driven from here.
  const [other] = await db.insert(company).values({
    name: 'Someone Else Ltd', slug: 'other-t51', email: 'other51@test.local', settings: {}, enabledFeatures: ['warranties'],
  } as any).returning()
  const [otherPw] = await db.insert(projectWarranty).values({
    companyId: other.id, name: 'Theirs', status: 'active',
    startsAt: new Date('2026-01-01'), expiresAt: new Date('2036-01-01'),
  } as any).returning()
  const [otherClaim] = await db.insert(warrantyClaim).values({
    companyId: other.id, warrantyId: otherPw.id, title: 'Not yours', description: 'Theirs.', status: 'open',
  } as any).returning()

  const r = await call('PUT', `/api/warranties/claims/${otherClaim.id}/status`, { status: 'denied' })
  check('T51: another tenant\'s claim is a 404, not a silent write', r.status === 404, { status: r.status, body: r.text?.slice(0, 200) })
  const [after] = await db.select().from(warrantyClaim).where(eq(warrantyClaim.id, otherClaim.id))
  check('…and it is untouched', after?.status === 'open', { status: after?.status })
}

/**
 * T51 follow-up — "warranty 'days left' shows no number."
 *
 * WarrantiesPage renders `{warranty.daysRemaining} days left` and colours the row from
 * `isExpiringSoon`. getProjectWarranties computed all three; getActiveWarranties — which is what
 * GET /api/warranties serves to that screen — returned the raw row, so the number was `undefined`,
 * the cell read " days left", and the expiring-soon highlight could never fire on the list a builder
 * actually looks at. Two readers of one fact, only one of which derived it.
 */
console.log('\n══════════ how long a warranty has left ══════════')
{
  const r = await call('GET', '/api/warranties')
  const rows = Array.isArray(r.json) ? r.json : (r.json?.data ?? [])
  check('the warranties list answers', r.status === 200 && rows.length > 0, { status: r.status, n: rows.length })
  const mine = rows.find((x: any) => x.id === pw.id)
  check('…and carries the warranty under test', !!mine, { ids: rows.map((x: any) => x.id).slice(0, 3) })
  if (mine) {
    check('T51: daysRemaining is a NUMBER, not undefined', typeof mine.daysRemaining === 'number',
      { daysRemaining: mine.daysRemaining, type: typeof mine.daysRemaining })
    // The fixture expires 2036-01-10, so it is years out: a big positive number, not expiring soon.
    check('…and it is the real distance to the expiry', mine.daysRemaining > 3000,
      { daysRemaining: mine.daysRemaining })
    check('…isExpired is false for a warranty running until 2036', mine.isExpired === false, { isExpired: mine.isExpired })
    check('…and isExpiringSoon is false too', mine.isExpiringSoon === false, { isExpiringSoon: mine.isExpiringSoon })
  }

  // A warranty that really is nearly up must come back as expiring soon — the colour on that row is
  // the only warning a builder gets before the cover lapses.
  const [soon] = await db.insert(projectWarranty).values({
    companyId: co.id, projectId: proj.id, contactId: client.id,
    name: 'Sealant — 1 year', category: 'other', status: 'active',
    startsAt: new Date(Date.now() - 350 * 86400000), expiresAt: new Date(Date.now() + 10 * 86400000),
  } as any).returning()
  const r2 = await call('GET', '/api/warranties')
  const rows2 = Array.isArray(r2.json) ? r2.json : (r2.json?.data ?? [])
  const near = rows2.find((x: any) => x.id === soon.id)
  check('T51: one with ten days left reports about ten', near && near.daysRemaining >= 9 && near.daysRemaining <= 11,
    { daysRemaining: near?.daysRemaining })
  check('…and is flagged as expiring soon', near?.isExpiringSoon === true, { isExpiringSoon: near?.isExpiringSoon })

  // …and an expired one does not report negative days.
  const [gone] = await db.insert(projectWarranty).values({
    companyId: co.id, projectId: proj.id, contactId: client.id,
    name: 'Paint — lapsed', category: 'other', status: 'active',
    startsAt: new Date(Date.now() - 800 * 86400000), expiresAt: new Date(Date.now() - 40 * 86400000),
  } as any).returning()
  const r3 = await call('GET', '/api/warranties')
  const rows3 = Array.isArray(r3.json) ? r3.json : (r3.json?.data ?? [])
  const dead = rows3.find((x: any) => x.id === gone.id)
  check('T51: a lapsed warranty reports 0 days, never a negative', dead?.daysRemaining === 0, { daysRemaining: dead?.daysRemaining })
  check('…and says so through isExpired instead', dead?.isExpired === true, { isExpired: dead?.isExpired })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
