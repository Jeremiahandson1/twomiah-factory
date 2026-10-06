// crm-vet — the patient chart must not present a slice of the visit history as the whole of it.
//
//   "Vet: Visits tab stops at 20."
//
// GET /patients/:id carried a bare .limit(20) on `visits` while vaccinations, prescriptions and lab
// results on the same chart were all returned in full. Two things followed, and the second is worse:
//
//   - a patient with more than 20 visits lost its oldest, which on a medical record is exactly the
//     visit from before the problem started;
//   - the tab label was `count: visits.length`, so the chart printed "Visits 20" — ASSERTING a wrong
//     number rather than merely showing a short list. Nothing anywhere said it had been cut.
//
// What is asserted is that the chart tells the truth about the history: the count is the real count,
// the list is not silently truncated at twenty, and when a cap does apply the response says so. A test
// that only checked "more than 20 rows come back" would pass against a chart that still mislabels its
// own tab.
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
const { company, user, contact, patient, visit } = schema

const mk = async (slug: string) => {
  const [co] = await db.insert(company).values({
    name: slug, slug, email: `${slug}@test.local`,
    settings: {}, enabledFeatures: ['patients', 'visits', 'contacts'],
  } as any).returning()
  const [owner] = await db.insert(user).values({
    email: `owner-${slug}@test.local`, passwordHash: 'x', firstName: 'O', lastName: 'U',
    role: 'owner', companyId: co.id, isActive: true,
  } as any).returning()
  const [client] = await db.insert(contact).values({
    companyId: co.id, name: 'Marit Lindegaard', email: `marit-${slug}@test.local`,
  } as any).returning()
  const [pet] = await db.insert(patient).values({
    companyId: co.id, ownerId: client.id, name: 'Luna', species: 'dog', breed: 'Collie',
    dob: new Date('2010-04-01'), deceased: false,
  } as any).returning()
  return { co, owner, client, pet }
}

const mine = await mk('vet-visits-t58')
const other = await mk('vet-other-t58')

const app = new Hono()
app.route('/api/patients', (await import('./src/routes/patients.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const call = (who: string) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const api = call(mine.owner.id)

/** A long-lived patient: fifteen years of twice-yearly visits and then some. */
const HISTORY = 27
const dayBack = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d }
for (let i = 0; i < HISTORY; i++) {
  await db.insert(visit).values({
    companyId: mine.co.id, patientId: mine.pet.id,
    visitDate: dayBack(i * 60), reason: `Check-up ${HISTORY - i}`,
  } as any)
}
// Another practice's visits for the same-named pet, which must not be counted into this chart.
for (let i = 0; i < 5; i++) {
  await db.insert(visit).values({
    companyId: other.co.id, patientId: other.pet.id,
    visitDate: dayBack(i * 60), reason: 'Someone else’s patient',
  } as any)
}

console.log('\n══════════ the chart ══════════')
const chart = await api('GET', `/api/patients/${mine.pet.id}`)
check('the chart loads', chart.status === 200, { status: chart.status, body: chart.text?.slice(0, 220) })
const body = chart.json ?? {}
const visits: any[] = Array.isArray(body.visits) ? body.visits : []

// The finding, directly: twenty was the wall.
check(`all ${HISTORY} visits come back, not 20`, visits.length === HISTORY, { returned: visits.length, expected: HISTORY })
check('…so the history is not cut at twenty', visits.length > 20, { returned: visits.length })

// The worse half: the number the tab prints.
check('the chart reports the real total', Number(body.visitsTotal) === HISTORY, { visitsTotal: body.visitsTotal, expected: HISTORY })
check('…and the total matches the list when nothing is capped', Number(body.visitsTotal) === visits.length,
  { visitsTotal: body.visitsTotal, returned: visits.length })

// The cap is named, so a screen can say when it is showing a slice rather than guessing.
check('the cap is declared', Number(body.visitsCap) > 0, { visitsCap: body.visitsCap })
check('…and this history is inside it', visits.length <= Number(body.visitsCap), { returned: visits.length, cap: body.visitsCap })

console.log('\n══════════ ordering and scoping ══════════')
// Newest first — if a cap ever does bite, it must drop the OLDEST, not the most recent.
let descending = true
for (let i = 1; i < visits.length; i++) {
  if (new Date(visits[i - 1].visitDate).getTime() < new Date(visits[i].visitDate).getTime()) descending = false
}
check('visits are newest first, so a cap would drop the oldest', descending,
  visits.slice(0, 3).map((v) => v.visitDate))
check('the most recent visit is present', visits[0]?.reason === `Check-up ${HISTORY}`, { first: visits[0]?.reason })
// …and the oldest, which is the one the old cap was throwing away.
check('the OLDEST visit is present — the one the cap was dropping',
  visits.some((v) => v.reason === 'Check-up 1'), { reasons: visits.map((v) => v.reason).slice(-3) })

check('another practice’s visits are not in this chart',
  !visits.some((v) => String(v.reason || '').includes('Someone else')) && Number(body.visitsTotal) === HISTORY,
  { visitsTotal: body.visitsTotal })

console.log('\n══════════ the rest of the chart is untouched ══════════')
for (const key of ['vaccinations', 'prescriptions', 'labResults']) {
  check(`${key} is still returned`, Array.isArray((body as any)[key]), { value: typeof (body as any)[key] })
}
check('the patient and owner still come back', !!body.patient?.id && body.owner !== undefined,
  { patient: body.patient?.id, hasOwner: body.owner !== undefined })

console.log('\n══════════ a patient with no visits ══════════')
{
  const empty = await mk('vet-empty-t58')
  const r = await call(empty.owner.id)('GET', `/api/patients/${empty.pet.id}`)
  check('the chart loads', r.status === 200, { status: r.status })
  check('…with an empty list and a zero total, not a missing field',
    Array.isArray(r.json?.visits) && r.json.visits.length === 0 && Number(r.json?.visitsTotal) === 0,
    { visits: r.json?.visits?.length, visitsTotal: r.json?.visitsTotal })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
