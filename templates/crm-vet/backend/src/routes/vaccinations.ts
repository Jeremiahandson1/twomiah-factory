import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { vaccination } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'
// The practice's own clock decides what "today" is, so a shot entered at 4pm in Hawaii is not
// refused for being tomorrow in UTC — which is what Render runs on. (T51)
import { companyTimeZone, storeDateString } from '../shared/index.ts'

const app = new Hono()
app.use('*', authenticate)

/**
 * A BOOSTER CANNOT BE DUE BEFORE THE SHOT THAT NEEDS IT. (T41)
 *
 *   "A vaccination due date before the given date is accepted."
 *
 * Both columns are plain dates: `given_date` is notNull and `due_date` drives the reminder list and
 * the rabies certificate's expiry. A due date in front of the given date is not an unusual case, it
 * is a typo — a year mistyped, or the two fields filled in the wrong order — and the practice pays
 * for it twice: the reminder engine (routes/reminders.ts reads due_date) calls the owner in for a
 * booster that is not due, and a rabies certificate prints an expiry that has already passed, which
 * is the document a shelter or a groomer relies on.
 *
 * SAME DAY IS ALLOWED. A three-dose series can be written up with a due date of the same day for a
 * puppy brought back that afternoon, and refusing equality would block a real entry to catch a
 * typo. The rule is "not BEFORE", which is what the finding actually says.
 *
 * Validated on create AND on edit. (rule: any rule applied on create applies on edit — the edit
 * form is exactly where a date gets corrected, and where it gets mistyped again.)
 */
const isDay = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
/**
 * …AND A SHOT CANNOT HAVE BEEN GIVEN TOMORROW. (T51)
 *
 *   "A future-dated vaccination is accepted."
 *
 * `given_date` is a record that an animal was injected. A date in the future is not an unusual case
 * either — it is the same typo class as the one above, a year or a month mistyped — and it is worse
 * than a wrong due date because of what reads it: the rabies certificate prints "Date Administered"
 * as a legal assertion, and the reminder engine computes the next booster from it, so a shot dated
 * next year silences a reminder that is actually due now.
 *
 * TODAY IS THE PRACTICE'S TODAY, not the server's. Render runs UTC; a clinic in Hawaii entering a
 * shot at 4pm local is already tomorrow in UTC, and refusing that is refusing a correct record.
 * `today` is passed in, computed by the caller from the clinic's own zone with storeDateString.
 */
/** The complaint, or null. Compares the date strings, which sort correctly in ISO form. */
function vaccinationDateError(givenDate: unknown, dueDate: unknown, today?: string): string | null {
  if (givenDate !== undefined && givenDate !== null && givenDate !== '' && !isDay(givenDate)) {
    return 'The date given must be a date (YYYY-MM-DD).'
  }
  if (isDay(givenDate) && today && givenDate > today) {
    return `This says the shot was given on ${givenDate}, which is in the future. `
      + 'A vaccination record is a record of something that has happened — check the date, or book an appointment instead.'
  }
  if (dueDate === undefined || dueDate === null || dueDate === '') return null
  if (!isDay(dueDate)) return 'The next-due date must be a date (YYYY-MM-DD).'
  if (!isDay(givenDate)) return null  // nothing to compare against
  if (dueDate < givenDate) {
    return `The next dose is due on ${dueDate}, which is before the ${givenDate} this one was given. `
      + 'Check the two dates — a booster cannot come due before the shot it follows.'
  }
  return null
}

// GET /vaccinations — ?patientId=
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const patientId = c.req.query('patientId')

  const conditions = [eq(vaccination.companyId, currentUser.companyId)]
  if (patientId) conditions.push(eq(vaccination.patientId, patientId))

  const data = await db.select().from(vaccination)
    .where(and(...conditions))
    .orderBy(desc(vaccination.givenDate))

  return c.json({ data })
})

// POST /vaccinations
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const today = storeDateString(new Date(), await companyTimeZone(db, currentUser.companyId))
  const dateError = vaccinationDateError(body.givenDate, body.dueDate, today)
  if (dateError) return c.json({ error: dateError, code: 'vaccination_dates' }, 400)

  const [created] = await db.insert(vaccination).values({
    id: createId(),
    patientId: body.patientId,
    visitId: body.visitId || null,
    providerId: body.providerId || null,
    vaccine: body.vaccine,
    manufacturer: body.manufacturer || null,
    lotNumber: body.lotNumber || null,
    serialNumber: body.serialNumber || null,
    site: body.site || null,
    route: body.route || null,
    givenDate: body.givenDate,
    dueDate: body.dueDate || null,
    isRabies: body.isRabies ?? false,
    rabiesTag: body.rabiesTag || null,
    notes: body.notes || null,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'vaccination', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'vaccination' })
  return c.json(created, 201)
})

// PUT /vaccinations/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(vaccination)
    .where(and(eq(vaccination.id, id), eq(vaccination.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Vaccination not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['patientId', 'visitId', 'providerId', 'vaccine', 'manufacturer', 'lotNumber', 'serialNumber', 'site', 'route', 'givenDate', 'dueDate', 'isRabies', 'rabiesTag', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]

  // The pair has to be judged TOGETHER and against what the row already holds: an edit that sends
  // only `dueDate` must still be checked against the stored givenDate, or moving one date alone
  // walks straight around the rule. Same the other way.
  const dateError = vaccinationDateError(
    'givenDate' in updates ? updates.givenDate : existing.givenDate,
    'dueDate' in updates ? updates.dueDate : existing.dueDate,
    // Same rule on the edit — the edit form is exactly where a date gets corrected, and where it
    // gets mistyped again. Correcting an OLD record is unaffected: its given date is in the past.
    storeDateString(new Date(), await companyTimeZone(db, currentUser.companyId)),
  )
  if (dateError) return c.json({ error: dateError, code: 'vaccination_dates' }, 400)

  const [updated] = await db.update(vaccination).set(updates).where(eq(vaccination.id, id)).returning()
  await audit.log({ action: 'update', entity: 'vaccination', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'vaccination' })
  return c.json(updated)
})

// DELETE /vaccinations/:id
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(vaccination)
    .where(and(eq(vaccination.id, id), eq(vaccination.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Vaccination not found' }, 404)

  await db.delete(vaccination).where(eq(vaccination.id, id))
  await audit.log({ action: 'delete', entity: 'vaccination', entityId: id, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'vaccination' })
  return c.json({ success: true })
})

export default app
