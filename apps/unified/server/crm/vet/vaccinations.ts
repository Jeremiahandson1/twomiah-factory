// Vaccinations: what was given, when, and when the next dose is due (which drives recall and the rabies certificate's
// expiry). Moved from templates/crm-vet/backend/src/routes/vaccinations.ts. The registry signs the person in and
// applies the 'patient_records' gate: the template mounted it ungated, and vaccinations are recorded on the patient's
// chart, whose menu item is 'patient_records'.
import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { companyTimeZone, storeDateString } from '@twomiah/tenant-backend'
import { vaccination } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, list, one } from '../../http/reply.ts'

const isDay = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

/**
 * A BOOSTER CANNOT BE DUE BEFORE THE SHOT THAT NEEDS IT (T41) — same day is allowed — and A SHOT CANNOT HAVE BEEN
 * GIVEN TOMORROW (T51), where today is the PRACTICE's today (the caller passes it, from the clinic's own zone).
 * Validated on create and on edit. The complaint, or null; ISO date strings compare correctly.
 */
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
  if (!isDay(givenDate)) return null
  if (dueDate < givenDate) {
    return `The next dose is due on ${dueDate}, which is before the ${givenDate} this one was given. `
      + 'Check the two dates — a booster cannot come due before the shot it follows.'
  }
  return null
}

export function createVaccinationRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const { emitToCompany, EVENTS } = d.realtime
  const app = new Hono<AppEnv>()
  const practiceToday = async (companyId: string) => storeDateString(new Date(), await companyTimeZone(db, companyId))

  // GET /vaccinations — ?patientId=. A list reply (the template: { data } alone).
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const patientId = c.req.query('patientId')
    const conditions = [eq(vaccination.companyId, currentUser.companyId)]
    if (patientId) conditions.push(eq(vaccination.patientId, patientId))
    const data = await db.select().from(vaccination).where(and(...conditions)).orderBy(desc(vaccination.givenDate))
    return list(c, data, { page: 1, limit: data.length, total: data.length })
  })

  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = await c.req.json()

    const dateError = vaccinationDateError(body.givenDate, body.dueDate, await practiceToday(currentUser.companyId))
    if (dateError) return fail(c, 400, dateError, 'vaccination_dates')

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
    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json()

    const [existing] = await db.select().from(vaccination)
      .where(and(eq(vaccination.id, id), eq(vaccination.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Vaccination not found')

    // Whitelist editable columns — never let companyId/id be reassigned from the body.
    const EDITABLE = ['patientId', 'visitId', 'providerId', 'vaccine', 'manufacturer', 'lotNumber', 'serialNumber', 'site', 'route', 'givenDate', 'dueDate', 'isRabies', 'rabiesTag', 'notes'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]

    // The pair is judged TOGETHER and against what the row already holds, so moving one date alone can't walk around
    // the rule.
    const dateError = vaccinationDateError(
      'givenDate' in updates ? updates.givenDate : existing.givenDate,
      'dueDate' in updates ? updates.dueDate : existing.dueDate,
      await practiceToday(currentUser.companyId),
    )
    if (dateError) return fail(c, 400, dateError, 'vaccination_dates')

    const [updated] = await db.update(vaccination).set(updates).where(eq(vaccination.id, id)).returning()
    await audit.log({ action: 'update', entity: 'vaccination', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'vaccination' })
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(vaccination)
      .where(and(eq(vaccination.id, id), eq(vaccination.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Vaccination not found')

    await db.delete(vaccination).where(eq(vaccination.id, id))
    await audit.log({ action: 'delete', entity: 'vaccination', entityId: id, metadata: existing, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'vaccination' })
    return done(c)
  })

  return app
}
