// Medications, the MAR (medication administration record) and vitals. Moved from
// templates/crm-homecare/backend/src/routes/medications.ts.
//
//   GET  /api/medications/client/:clientId            the client's list (?activeOnly=true)
//   POST /api/medications                             add (office)
//   PUT  /api/medications/:id                         edit — only the fields sent (office)
//   PUT|POST /api/medications/:id/discontinue         (office)
//   POST /api/medications/log                         record a dose given / refused / held / self-administered / missed
//   GET  /api/medications/logs/client/:clientId       ?startDate&endDate
//   GET  /api/medications/logs/time-entry/:timeEntryId
//   GET  /api/medications/due/:clientId               active medications for a visit
//   GET  /api/medications/reports/adherence/:clientId
//   POST /api/medications/vitals                      record a vitals snapshot
//   GET  /api/medications/vitals/client/:clientId     ?limit&startDate&endDate
//   GET  /api/medications/vitals/latest/:clientId
//
// A medication carries the names the screens read (medicationName, prescriber, isActive) beside the table's own (name,
// prescribedBy, status). Who records: a caregiver records as themselves, and only for a client they serve; the office
// may attribute a dose or a reading to the caregiver who gave / took it (back-entering a paper record).
//
// Permissions: reads are care-clients:read (a caregiver: the clients they serve); recording a dose or vitals is
// evv:create (the caregiver's visit work; the office holds it too); the office's list edits are care-clients:create /
// update. Replies: every list is { data, pagination } in camelCase (the template's were snake_case arrays:
// medication_name → medicationName, administered_time → administeredTime, caregiver_first → caregiverFirst …).
import { Hono } from 'hono'
import { and, asc, desc, eq, getTableColumns, gte, lt, lte } from 'drizzle-orm'
import { medications, medicationLogs, clientVitals, timeEntries, user as users } from '../../../db/schema/index.ts'
import { medicationAdherence, databaseToday } from '../../../data/homecareClients.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { body, who, whole, NOT_YOUR_CLIENT, type ClientAccess } from './shared.ts'

const YMD = /^\d{4}-\d{2}-\d{2}$/
export const MAR_STATUSES = ['given', 'refused', 'held', 'self_administered', 'missed']

// Plausible ranges — the same numbers the table's CHECK constraints hold.
export const VITALS = [
  { key: 'systolicBp', label: 'Systolic BP', int: true, min: 50, max: 260 },
  { key: 'diastolicBp', label: 'Diastolic BP', int: true, min: 25, max: 160 },
  { key: 'pulse', label: 'Pulse', int: true, min: 25, max: 220 },
  { key: 'respirations', label: 'Respirations', int: true, min: 4, max: 70 },
  { key: 'oxygenSaturation', label: 'O2 saturation', int: true, min: 50, max: 100 },
  { key: 'temperatureF', label: 'Temperature', int: false, min: 85, max: 112 },
  { key: 'bloodGlucose', label: 'Blood glucose', int: true, min: 20, max: 800 },
  { key: 'weightLbs', label: 'Weight', int: false, min: 30, max: 800 },
  { key: 'painScale', label: 'Pain scale', int: true, min: 0, max: 10 },
] as const

const pick = (b: any, ...keys: string[]) => {
  for (const k of keys) if (k in b) return { has: true, v: b[k] === '' ? null : b[k] }
  return { has: false, v: undefined }
}

/** Body → medication columns, taking either the screen's names or the table's. */
function medicationValues(b: any): { values: Record<string, unknown>; error?: string } {
  const values: Record<string, unknown> = {}
  const map: [string, string[]][] = [
    ['name', ['medicationName', 'name']], ['dosage', ['dosage']], ['frequency', ['frequency']], ['route', ['route']],
    ['indication', ['indication']], ['prescribedBy', ['prescriber', 'prescribedBy']], ['pharmacy', ['pharmacy']],
    ['rxNumber', ['rxNumber']], ['instructions', ['instructions']], ['sideEffects', ['sideEffects']],
    ['startDate', ['startDate']], ['endDate', ['endDate']], ['notes', ['notes']],
  ]
  for (const [col, keys] of map) {
    const p = pick(b, ...keys)
    if (!p.has) continue
    if ((col === 'startDate' || col === 'endDate') && p.v != null && !YMD.test(String(p.v))) return { values, error: `${col} must be a date (YYYY-MM-DD)` }
    values[col] = p.v
  }
  if ('isPrn' in b) values.isPrn = b.isPrn === true || b.isPrn === 'true'
  if ('isActive' in b) values.status = b.isActive === false || b.isActive === 'false' ? 'discontinued' : 'active'
  else if ('status' in b && b.status) values.status = String(b.status)
  return { values }
}

/** A medication with the screens' names beside the table's. */
const asScreen = (m: any) => ({ ...m, medicationName: m.name, prescriber: m.prescribedBy, isActive: m.status === 'active' })

export function createMedicationRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d
  const read = requirePermission('care-clients:read')

  /** The caregiver a record is attributed to: the office may name one of the company's people; everyone else is themselves. */
  async function attributedTo(user: any, companyId: string, me: string, requested: unknown): Promise<string | null> {
    if (!access.office(user) || !requested) return me
    return (await access.personInCompany(companyId, String(requested)))?.id ?? null
  }

  /** The visit a record names: it must be this client's, and a caregiver's own. null when fine, else the refusal. */
  async function visitRefusal(c: any, user: any, companyId: string, me: string, clientId: string, timeEntryId: unknown): Promise<Response | null> {
    if (!timeEntryId) return null
    const [te] = await db.select({ clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId }).from(timeEntries)
      .where(and(eq(timeEntries.id, String(timeEntryId)), eq(timeEntries.companyId, companyId))).limit(1)
    if (!te || te.clientId !== clientId) return fail(c, 400, 'That visit is not this client\'s')
    if (!access.office(user) && te.caregiverId !== me) return fail(c, 403, 'Not your shift')
    return null
  }

  const activeList = async (companyId: string, clientId: string, activeOnly: boolean) =>
    (await db.select().from(medications).where(and(
      eq(medications.companyId, companyId), eq(medications.clientId, clientId), activeOnly ? eq(medications.status, 'active') : undefined,
    )).orderBy(asc(medications.name))).map(asScreen)

  app.get('/client/:clientId', read, access.requireClientAccess(), async (c) => {
    const { companyId } = who(c)
    return whole(c, await activeList(companyId, c.req.param('clientId')!, c.req.query('activeOnly') === 'true'))
  })

  app.post('/', requirePermission('care-clients:create'), async (c) => {
    const { user, companyId } = who(c)
    const b = await body(c)
    const { values, error } = medicationValues(b)
    if (error) return fail(c, 400, error)
    if (!b.clientId || !values.name || !String(values.name).trim()) return fail(c, 400, 'clientId and medication name are required')
    if (!(await access.clientInCompany(companyId, b.clientId))) return fail(c, 404, 'Client not found')
    const [row] = await db.insert(medications).values({ status: 'active', ...values, companyId, clientId: b.clientId, name: String(values.name).trim() } as any).returning()
    await core.careAudit.writeCareAudit(user, 'CREATE', 'medications', row.id, row)
    return one(c, asScreen(row), 201)
  })

  app.put('/:id', requirePermission('care-clients:update'), async (c) => {
    const { user, companyId } = who(c)
    const { values, error } = medicationValues(await body(c))
    if (error) return fail(c, 400, error)
    if ('name' in values && (!values.name || !String(values.name).trim())) return fail(c, 400, 'Medication name cannot be blank')
    const [row] = await db.update(medications).set({ ...values, updatedAt: new Date() } as any)
      .where(and(eq(medications.id, c.req.param('id')), eq(medications.companyId, companyId))).returning()
    if (!row) return fail(c, 404, 'Medication not found')
    await core.careAudit.writeCareAudit(user, 'UPDATE', 'medications', row.id, row)
    return one(c, asScreen(row))
  })

  const discontinue = async (c: any) => {
    const { user, companyId } = who(c)
    const [row] = await db.update(medications)
      .set({ status: 'discontinued', endDate: await databaseToday(db, companyId), updatedAt: new Date() })
      .where(and(eq(medications.id, c.req.param('id')), eq(medications.companyId, companyId))).returning()
    if (!row) return fail(c, 404, 'Medication not found')
    await core.careAudit.writeCareAudit(user, 'UPDATE', 'medications', row.id, { discontinued: true })
    return one(c, { success: true, ...row })
  }
  app.put('/:id/discontinue', requirePermission('care-clients:update'), discontinue)
  app.post('/:id/discontinue', requirePermission('care-clients:update'), discontinue)

  // ── MAR ──
  // Item 4 (care_offline_saves): a dose saved on the phone without signal is recorded once (Idempotency-Key), at the time it was
  // given, refused if someone already recorded it, and flagged to the office if the medicine had been stopped. Off: as ever.
  app.post('/log', requirePermission('evv:create'), core.offlineSaves.savedOnce, async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    if (!b.medicationId || !b.clientId) return fail(c, 400, 'medicationId and clientId are required')
    const refused = await access.careWriteRefusal(c, b.clientId)
    if (refused) return refused
    // 'given' is the default; anything else outside the MAR list is 'given' too (the source CRM's rule).
    const status = MAR_STATUSES.includes(b.status) ? b.status : 'given'
    const offline = await core.offlineSaves.enabled(companyId)
    const when = b.administeredTime ?? b.administeredAt ?? (offline ? b.savedAt : undefined)
    const administeredAt = when ? new Date(when) : new Date()
    if (isNaN(administeredAt.getTime())) return fail(c, 400, 'The time given is not a valid date and time')
    if (offline && when) {
      const t = core.offlineSaves.savedTime(administeredAt)
      if ('problem' in t) return fail(c, 400, t.problem, 'bad_saved_time')
    }
    const scheduledTime = b.scheduledTime ? new Date(b.scheduledTime) : null
    if (scheduledTime && isNaN(scheduledTime.getTime())) return fail(c, 400, 'The scheduled time is not a valid date and time')
    const [med] = await db.select({ id: medications.id, clientId: medications.clientId, name: medications.name, status: medications.status, endDate: medications.endDate }).from(medications)
      .where(and(eq(medications.id, b.medicationId), eq(medications.companyId, companyId))).limit(1)
    if (!med || med.clientId !== b.clientId) return fail(c, 404, 'Medication not found for this client')
    const caregiverId = await attributedTo(user, companyId, me, b.caregiverId)
    if (!caregiverId) return fail(c, 404, 'Caregiver not found')
    const visit = await visitRefusal(c, user, companyId, me, b.clientId, b.timeEntryId)
    if (visit) return visit
    const oneDose = offline && (status === 'given' || status === 'self_administered') && scheduledTime
    if (oneDose) {
      const dup = await core.offlineSaves.doseAlreadyRecorded(companyId, med.id, b.clientId, scheduledTime)
      if (dup) return fail(c, 409, dup.sentence, 'dose_already_recorded')
    }
    let row: any
    try {
      // The read above is the friendly answer; the unique dose_key is the guard: two saves landing together cannot both be kept.
      ;[row] = await db.insert(medicationLogs).values({
        companyId, medicationId: med.id, clientId: b.clientId, caregiverId,
        timeEntryId: b.timeEntryId || null, scheduledTime, administeredAt,
        status, effectiveStatus: status, dosageGiven: b.dosageGiven || null,
        notes: b.notes || null, witnessedBy: b.witnessedBy ? String(b.witnessedBy).trim() || null : null,
        doseKey: oneDose ? core.offlineSaves.doseKey(companyId, med.id, scheduledTime) : null,
      }).returning()
    } catch (e: any) {
      if (!oneDose || !core.offlineSaves.isDoseKeyClash(e)) throw e
      const dup = await core.offlineSaves.doseAlreadyRecorded(companyId, med.id, b.clientId, scheduledTime)
      return fail(c, 409, dup?.sentence ?? 'Someone already recorded this dose as given. If you gave it too, tell the office before giving anything more.', 'dose_already_recorded')
    }
    // A dose of a stopped medicine is recorded (it happened) and the office is told.
    const stopped = offline && status !== 'refused' && status !== 'missed' && status !== 'held' && await core.offlineSaves.tellOfficeIfStopped(companyId, med, administeredAt)
    return one(c, stopped ? { ...row, warning: 'This medicine was marked as stopped. The office has been told.' } : row, 201)
  })

  // The MAR rows with the medication and who gave it (administeredTime is administeredAt, the screens' name).
  const logRows = (where: any, newestFirst: boolean) => db.select({
    ...getTableColumns(medicationLogs),
    administeredTime: medicationLogs.administeredAt,
    medicationName: medications.name, dosage: medications.dosage, frequency: medications.frequency,
    caregiverFirst: users.firstName, caregiverLast: users.lastName,
  }).from(medicationLogs)
    .innerJoin(medications, eq(medicationLogs.medicationId, medications.id))
    .leftJoin(users, eq(medicationLogs.caregiverId, users.id))
    .where(where)
    .orderBy(newestFirst ? desc(medicationLogs.administeredAt) : asc(medicationLogs.administeredAt))

  app.get('/logs/client/:clientId', read, access.requireClientAccess(), async (c) => {
    const { companyId } = who(c)
    const { startDate, endDate } = c.req.query()
    // Days on the agency's clock (core/agencyTime.ts range), not UTC's.
    const { from, before } = await core.time.range(companyId, startDate, endDate)
    return whole(c, await logRows(and(
      eq(medicationLogs.companyId, companyId), eq(medicationLogs.clientId, c.req.param('clientId')!),
      from ? gte(medicationLogs.administeredAt, from) : undefined,
      before ? lt(medicationLogs.administeredAt, before) : undefined,
    ), true))
  })

  app.get('/logs/time-entry/:timeEntryId', read, async (c) => {
    // A caregiver reads the MAR of their own visit, or of a visit for a client they care for.
    const { user, companyId, me } = who(c)
    const id = c.req.param('timeEntryId')!
    if (!access.office(user)) {
      const [te] = await db.select({ clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId }).from(timeEntries)
        .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId))).limit(1)
      if (!te) return fail(c, 404, 'Visit not found')
      if (te.caregiverId !== me && !(await access.maySeeClient(user, te.clientId))) return fail(c, 403, NOT_YOUR_CLIENT)
    }
    return whole(c, await logRows(and(eq(medicationLogs.companyId, companyId), eq(medicationLogs.timeEntryId, id)), false))
  })

  app.get('/due/:clientId', read, access.requireClientAccess(), async (c) => {
    const { companyId } = who(c)
    return whole(c, await activeList(companyId, c.req.param('clientId')!, true))
  })

  // Per active medication over the window: doses given, refused, missed, held, and every entry.
  app.get('/reports/adherence/:clientId', read, access.requireClientAccess(), async (c) => {
    const { companyId } = who(c)
    const { startDate, endDate } = c.req.query()
    const from = startDate && YMD.test(startDate) ? startDate : '1970-01-01'
    const to = endDate && YMD.test(endDate) ? endDate : '2099-12-31'
    return whole(c, await medicationAdherence(db, companyId, c.req.param('clientId')!, from, to))
  })

  // ── vitals ──
  app.post('/vitals', requirePermission('evv:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    if (!b.clientId) return fail(c, 400, 'clientId is required')
    const refused = await access.careWriteRefusal(c, b.clientId)
    if (refused) return refused
    const values: Record<string, unknown> = {}
    const bad: string[] = []
    for (const f of VITALS) {
      const raw = b[f.key]
      if (raw === undefined || raw === null || String(raw).trim() === '') continue
      const s = String(raw).trim()
      const n = Number(s)
      if (!Number.isFinite(n) || (f.int && !/^-?\d+$/.test(s)) || (!f.int && !/^-?\d+(\.\d)?$/.test(s)) || n < f.min || n > f.max) {
        bad.push(`${f.label} ${s} (allowed ${f.min}–${f.max}${f.int ? ', whole number' : ', one decimal place'})`)
        continue
      }
      values[f.key] = f.int ? n : s
    }
    if (bad.length) return fail(c, 400, `One or more values out of plausible range: ${bad.join('; ')}`)
    if (!Object.keys(values).length) return fail(c, 400, 'At least one vital measurement is required')
    if (!(await access.clientInCompany(companyId, b.clientId))) return fail(c, 404, 'Client not found')
    const visit = await visitRefusal(c, user, companyId, me, b.clientId, b.timeEntryId)
    if (visit) return visit
    const caregiverId = await attributedTo(user, companyId, me, b.caregiverId)
    if (!caregiverId) return fail(c, 404, 'Caregiver not found')
    let recordedAt = new Date()
    if (b.recordedAt) {
      recordedAt = new Date(b.recordedAt)
      if (isNaN(recordedAt.getTime())) return fail(c, 400, 'The time taken is not a valid date and time')
    }
    const [row] = await db.insert(clientVitals).values({
      ...values,
      companyId,
      clientId: b.clientId,
      caregiverId,
      timeEntryId: b.timeEntryId || null,
      recordedAt,
      painLocation: b.painLocation ? String(b.painLocation) : null,
      notes: b.notes ? String(b.notes) : null,
    } as any).returning()
    return one(c, row, 201)
  })

  app.get('/vitals/client/:clientId', read, access.requireClientAccess(), async (c) => {
    const { companyId } = who(c)
    const { limit = '50', startDate, endDate } = c.req.query()
    const { from, before } = await core.time.range(companyId, startDate, endDate)
    const to = before ? new Date(before.getTime() - 1) : undefined
    return whole(c, await core.vitals.listClientVitals(companyId, c.req.param('clientId')!, parseInt(limit) || 50, { from, to }))
  })

  // The latest reading, or {} when there is none (a reply is an object; the template answered a bare null).
  app.get('/vitals/latest/:clientId', read, access.requireClientAccess(), async (c) => {
    const { companyId } = who(c)
    const [latest] = await core.vitals.listClientVitals(companyId, c.req.param('clientId')!, 1)
    return one(c, latest || {})
  })

  return app
}
