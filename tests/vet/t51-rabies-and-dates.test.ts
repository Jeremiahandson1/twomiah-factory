// A rabies certificate is only a rabies certificate, and a shot cannot have been given tomorrow.
//
// TWO FINDINGS, both on records that leave the building as documents.
//
//   "The rabies certificate still prints for DHPP through the API."  GET /reminders/rabies/:id looked
//   the vaccination up by id and printed. Nothing checked what it WAS, so handing it a DHPP record
//   returned a page headed "Rabies Vaccination Certificate" carrying DHPP's lot number and dates — a
//   legal record asserting a rabies administration that never happened. It is the document a licence,
//   a boarding kennel and a bite investigation are settled with.
//
//   "A future-dated vaccination is accepted."  given_date is a record that an animal was injected.
//   The rabies certificate prints it as "Date Administered" and the reminder engine computes the next
//   booster from it, so a shot dated next year silences a reminder that is due now.
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
const { company, user, contact, patient, vaccination } = schema

const [co] = await db.insert(company).values({
  name: 'Lindegaard Veterinary', slug: 'lindegaard-t51', email: 'v51@test.local',
  settings: {}, enabledFeatures: ['patients', 'vaccinations', 'reminders', 'contacts'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t51@test.local', passwordHash: 'x', firstName: 'Olive', lastName: 'L',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({
  companyId: co.id, name: 'Marit Lindegaard', email: 'marit-t51@test.local',
} as any).returning()
const [pet] = await db.insert(patient).values({
  companyId: co.id, ownerId: client.id, name: 'Luna', species: 'dog', breed: 'Collie',
  dob: new Date('2022-04-01'), rabiesTag: 'OH-4417', deceased: false,
} as any).returning()

const day = (offset: number) => {
  const d = new Date(); d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

// one real rabies shot, and one DHPP — the pair the finding is about
const [rabies] = await db.insert(vaccination).values({
  companyId: co.id, patientId: pet.id, vaccine: 'Rabies', isRabies: true,
  givenDate: day(-30), dueDate: day(335), lotNumber: 'RB-99', manufacturer: 'Zoetis',
} as any).returning()
const [dhpp] = await db.insert(vaccination).values({
  companyId: co.id, patientId: pet.id, vaccine: 'DHPP', isRabies: false,
  givenDate: day(-30), dueDate: day(335), lotNumber: 'DH-12',
} as any).returning()
// …and one rabies shot whose flag was never set, which an import or an older row looks like
const [rabiesNoFlag] = await db.insert(vaccination).values({
  companyId: co.id, patientId: pet.id, vaccine: 'Rabies 3-Year', isRabies: false,
  givenDate: day(-60), dueDate: day(1035), lotNumber: 'RB-3Y',
} as any).returning()

const app = new Hono()
app.route('/api/reminders', (await import('./src/routes/reminders.ts')).default)
app.route('/api/vaccinations', (await import('./src/routes/vaccinations.ts')).default)
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

console.log('\n══════════ the certificate ══════════')
{
  const r = await call('GET', `/api/reminders/rabies/${rabies.id}`)
  check('a real rabies shot still prints', r.status === 200, { status: r.status, body: r.text?.slice(0, 200) })
  check('…and the page is the certificate', /Rabies Vaccination Certificate/.test(r.text), r.text?.slice(0, 160))
  check('…carrying the tag a licence is checked against', /OH-4417/.test(r.text))
}
{
  const r = await call('GET', `/api/reminders/rabies/${dhpp.id}`)
  check('T51: DHPP is REFUSED — it is not a rabies vaccination',
    r.status === 400, { status: r.status, body: r.text?.slice(0, 220) })
  check('…and the refusal names the vaccine, so the mistake is obvious',
    /DHPP/.test(String(r.json?.error ?? '')), { error: r.json?.error })
  check('…and no certificate text is returned at all',
    !/Rabies Vaccination Certificate/.test(r.text), r.text?.slice(0, 160))
}
{
  // A genuine rabies record whose flag was never set must NOT be refused on a bookkeeping technicality.
  const r = await call('GET', `/api/reminders/rabies/${rabiesNoFlag.id}`)
  check('a rabies shot with the flag unset still prints — the vaccine name says what it is',
    r.status === 200 && /Rabies Vaccination Certificate/.test(r.text), { status: r.status })
}
{
  const r = await call('GET', '/api/reminders/rabies/does-not-exist')
  check('an unknown id is still a 404, not a 400', r.status === 404, { status: r.status })
}

console.log('\n══════════ a shot cannot have been given tomorrow ══════════')
{
  const r = await call('POST', '/api/vaccinations', {
    patientId: pet.id, vaccine: 'Bordetella', givenDate: day(30), dueDate: day(395),
  })
  check('T51: a future given-date is refused', r.status === 400, { status: r.status, body: r.text?.slice(0, 200) })
  check('…and says what is wrong rather than "invalid"',
    /future/i.test(String(r.json?.error ?? '')), { error: r.json?.error })
}
{
  const r = await call('POST', '/api/vaccinations', {
    patientId: pet.id, vaccine: 'Bordetella', givenDate: day(0), dueDate: day(365),
  })
  check('TODAY is allowed — that is when most shots are entered', r.status === 201, { status: r.status, body: r.text?.slice(0, 200) })
}
{
  const r = await call('POST', '/api/vaccinations', {
    patientId: pet.id, vaccine: 'Lepto', givenDate: day(-400), dueDate: day(-35),
  })
  check('…and so is a historical record with a due date long past', r.status === 201, { status: r.status })
}
{
  // The rule applies on the EDIT too — the edit form is where a date gets corrected and re-mistyped.
  const r = await call('PUT', `/api/vaccinations/${dhpp.id}`, { givenDate: day(45) })
  check('T51: the same refusal on an edit', r.status === 400, { status: r.status, body: r.text?.slice(0, 200) })
}
{
  // …and the booster rule it sits beside still holds.
  const r = await call('POST', '/api/vaccinations', {
    patientId: pet.id, vaccine: 'Lyme', givenDate: day(-10), dueDate: day(-20),
  })
  check('a booster still cannot come due before the shot it follows', r.status === 400, { status: r.status })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
