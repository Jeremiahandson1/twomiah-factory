// The formulas a CLIENT is kept on.
//
// A formula used to live in exactly one place: on a service_record, which hangs off an appointment.
// That made a colourist's own work hostage to the status of a booking — cancelling a completed visit
// had to choose between destroying the formula and leaving a visit that never happened on the chart,
// driving a rebooking reminder. Mangomint does not have that problem because its colour formulas are
// pinned CLIENT notes: they belong to the person, and a visit only records when one was used.
//
// Under test here: the card itself. The cancel path and the legacy repair that now depend on it are
// covered in full0929.test.ts and salon-repair-legacy.test.ts.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, serviceRecord, clientProfile } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Formula Salon', slug: 'formulas', email: 'f@test.local', settings: {},
  enabledFeatures: ['contacts', 'client_profiles', 'service_menu'],
} as any).returning()
const mkUser = async (role: string, email: string) => (await db.insert(user).values({
  email, passwordHash: 'x', firstName: role, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner-f@test.local')
const viewer = await mkUser('viewer', 'viewer-f@test.local')

const [rita] = await db.insert(contact).values({ name: 'Rita Colour', type: 'client', companyId: co.id } as any).returning()
const [other] = await db.insert(contact).values({ name: 'Someone Else', type: 'client', companyId: co.id } as any).returning()
const [cut] = await db.insert(serviceMenu).values({ name: 'Colour', price: '90', durationMin: 90, companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
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
const MIX = [{ product: 'Colour 6N', parts: '1' }, { product: 'Colour 7N', parts: '1' }]

// ═══════════════════════════════ an empty card ══════════════════════════════════════════════════
{
  const r = await api('GET', `/api/clients/${rita.id}/formulas`)
  check('a client nobody has kept anything on has an empty card', r.status === 200 && Array.isArray(r.json?.formulas) && r.json.formulas.length === 0, r.json)
  check('an unknown client is a 404', (await api('GET', '/api/clients/nope/formulas')).status === 404)
}

// ═══════════════════════════════ keeping one by hand ════════════════════════════════════════════
let firstId = ''
{
  const empty = await api('POST', `/api/clients/${rita.id}/formulas`, { label: 'Nothing' })
  check('a formula with nothing in it is refused', empty.status === 400, empty.json)
  check('…naming what would make it worth keeping', /formula|developer|processing|note/i.test(String(empty.json?.error)), empty.json?.error)

  const kept = await api('POST', `/api/clients/${rita.id}/formulas`, {
    label: 'Root touch-up 6N', formula: MIX, developerVolume: '20 vol', processingMin: 35,
  })
  check('a stylist can keep a formula on their client', kept.status === 200, kept.json)
  check('…and it comes back on the card', kept.json?.formulas?.length === 1, kept.json?.formulas)
  firstId = kept.json?.formula?.id
  check('…with the mix', kept.json?.formula?.formula?.length === 2, kept.json?.formula)
  check('…the developer volume', kept.json?.formula?.developerVolume === '20 vol', kept.json?.formula)
  check('…and the processing time', kept.json?.formula?.processingMin === 35, kept.json?.formula)
  check('…dated, so a card can be read newest-first', !!kept.json?.formula?.savedAt, kept.json?.formula)

  // A client profile is created on demand — the same upsert the chart editor does, so a client
  // captured by the website lead form can be kept on a formula the first time they sit down.
  const [profile] = await db.select().from(clientProfile).where(eq(clientProfile.contactId, rita.id))
  check('…creating the client profile if this is the first thing ever kept on them', !!profile, profile)
}

// ═════════════════════ the same mix twice is one formula, re-dated ══════════════════════════════
{
  const again = await api('POST', `/api/clients/${rita.id}/formulas`, {
    label: 'Root touch-up 6N', formula: MIX, developerVolume: '20 vol', processingMin: 35,
  })
  check('keeping the same mix again does not add a second row', again.json?.formulas?.length === 1, again.json?.formulas)
  check('…it says so', again.json?.added === false, again.json?.added)
  check('…and re-dates the one that is there, because it was just used again',
    !!again.json?.formulas?.[0]?.lastUsedAt, again.json?.formulas?.[0])

  const different = await api('POST', `/api/clients/${rita.id}/formulas`, {
    label: 'Gloss', formula: [{ product: 'Gloss 9V', parts: '1' }], developerVolume: '10 vol',
  })
  check('a genuinely different mix IS a second formula', different.json?.formulas?.length === 2, different.json?.formulas)
  check('…newest first', different.json?.formulas?.[0]?.label === 'Gloss', different.json?.formulas?.map((f: any) => f.label))
}

// ═══════════════════════════════ lifting one off a visit ════════════════════════════════════════
{
  const [visit] = await db.insert(serviceRecord).values({
    companyId: co.id, contactId: rita.id, serviceId: cut.id, performedAt: new Date(),
    formula: [{ product: 'Balayage lift', parts: '2' }], developerVolume: '30 vol',
    notes: 'Went two shades lighter than last time; she loved it.',
  } as any).returning()

  const lifted = await api('POST', `/api/clients/${rita.id}/formulas`, { fromRecordId: visit.id, label: 'Balayage' })
  check('a formula can be lifted straight off a visit', lifted.status === 200, lifted.json)
  check('…with the mix', lifted.json?.formula?.formula?.[0]?.product === 'Balayage lift', lifted.json?.formula)
  check('…and the stylist\'s own words alongside it', /two shades lighter/.test(String(lifted.json?.formula?.note)), lifted.json?.formula?.note)
  check('…remembering which visit it came off, so the history is traceable',
    lifted.json?.formula?.savedFromRecordId === visit.id, lifted.json?.formula)

  // The visit record itself is untouched: the card is for reaching, the record is the history.
  const [still] = await db.select().from(serviceRecord).where(eq(serviceRecord.id, visit.id))
  check('…and the visit record is left exactly as it was', !!still && (still.formula as any)?.[0]?.product === 'Balayage lift', still?.formula)

  const wrongClient = await api('POST', `/api/clients/${other.id}/formulas`, { fromRecordId: visit.id })
  check('a visit cannot be lifted onto a DIFFERENT client\'s card', wrongClient.status === 400, wrongClient.json)
  check('…saying why', /different client/i.test(String(wrongClient.json?.error)), wrongClient.json?.error)

  const missing = await api('POST', `/api/clients/${rita.id}/formulas`, { fromRecordId: 'not-a-record' })
  check('an unknown visit is a 404', missing.status === 404, missing.json)

  const [blank] = await db.insert(serviceRecord).values({
    companyId: co.id, contactId: rita.id, serviceId: cut.id, performedAt: new Date(),
  } as any).returning()
  const nothing = await api('POST', `/api/clients/${rita.id}/formulas`, { fromRecordId: blank.id })
  check('a visit with nothing written on it has nothing to keep', nothing.status === 400, nothing.json)
}

// ═══════════════════════════════ forgetting one ═════════════════════════════════════════════════
{
  const before = (await api('GET', `/api/clients/${rita.id}/formulas`)).json?.formulas?.length
  const gone = await api('DELETE', `/api/clients/${rita.id}/formulas/${firstId}`)
  check('a formula can be taken off the card', gone.status === 200, gone.json)
  check('…and the rest stay', gone.json?.formulas?.length === before - 1, { before, after: gone.json?.formulas?.length })
  check('…forgetting it twice is a 404, not a silent success',
    (await api('DELETE', `/api/clients/${rita.id}/formulas/${firstId}`)).status === 404)
}

// ═══════════════════════════════ who may do what ════════════════════════════════════════════════
{
  const read = await as(viewer)('GET', `/api/clients/${rita.id}/formulas`)
  check('a viewer can READ the card — the formula is the point of the chart', read.status === 200, read.status)
  const write = await as(viewer)('POST', `/api/clients/${rita.id}/formulas`, { formula: MIX })
  check('…but cannot write to it', write.status === 403, write.status)
  const forget = await as(viewer)('DELETE', `/api/clients/${rita.id}/formulas/${firstId}`)
  check('…or take one off it', forget.status === 403, forget.status)
}

// ═══════════════════════════════ one salon's card is its own ════════════════════════════════════
{
  const [rival] = await db.insert(company).values({ name: 'Rival', slug: 'rival-f', email: 'r@test.local', settings: {}, enabledFeatures: ['contacts'] } as any).returning()
  const rivalOwner = (await db.insert(user).values({ email: 'r-owner@test.local', passwordHash: 'x', firstName: 'R', lastName: 'O', role: 'owner', companyId: rival.id } as any).returning())[0]
  const theirs = await as(rivalOwner)('GET', `/api/clients/${rita.id}/formulas`)
  check('another salon cannot read this client\'s card at all', theirs.status === 404, theirs.status)
  const write = await as(rivalOwner)('POST', `/api/clients/${rita.id}/formulas`, { formula: MIX })
  check('…nor write to it', write.status === 404, write.status)

  const [mine] = await db.select().from(clientProfile)
    .where(and(eq(clientProfile.contactId, rita.id), eq(clientProfile.companyId, co.id)))
  check('…and this salon\'s card is untouched by the attempt', (mine?.formulas as any)?.length >= 1, mine?.formulas)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
