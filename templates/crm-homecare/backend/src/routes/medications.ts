// Medications, the MAR (medication administration record) and vitals.
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
// A medication's list row carries the names the screens read (medication_name, prescriber,
// is_active) beside the table's own (name, prescribed_by, status).
//
// Who records: a caregiver records as themselves. The office may attribute a dose or a vitals
// reading to the caregiver who gave/took it (back-entering a paper record).
import { Hono } from 'hono'
import { sql, eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { medications, medicationLogs, clientVitals, clients, timeEntries, users } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { isOffice, userIdOf, writeCareAudit, rowsOf } from '../helpers/careAudit.ts'
import { listClientVitals } from '../services/vitals.ts'

const app = new Hono()
app.use('*', authenticate)

const YMD = /^\d{4}-\d{2}-\d{2}$/
export const MAR_STATUSES = ['given', 'refused', 'held', 'self_administered', 'missed']

const MED_COLUMNS = sql`m.*, m.name AS medication_name, m.prescribed_by AS prescriber, (m.status = 'active') AS is_active`

// A JS date as the UTC wall-clock timestamp the tables store.
const ts = (d: Date) => sql`${d.toISOString()}::timestamp`

/** The caregiver a record is attributed to: the office may name one, everyone else is themselves. */
async function attributedTo(user: any, requested: unknown): Promise<string | null> {
  if (!isOffice(user) || !requested) return userIdOf(user)
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, String(requested))).limit(1)
  return u ? u.id : null
}

const pick = (b: any, ...keys: string[]) => { for (const k of keys) if (k in b) return { has: true, v: b[k] === '' ? null : b[k] }; return { has: false, v: undefined } }

/** Body -> medication columns, taking either the screen's names or the table's. */
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

app.get('/client/:clientId', async (c) => {
  const activeOnly = c.req.query('activeOnly') === 'true'
  const rows = rowsOf(await db.execute(sql`
    SELECT ${MED_COLUMNS} FROM medications m
     WHERE m.client_id = ${c.req.param('clientId')} ${activeOnly ? sql`AND m.status = 'active'` : sql``}
     ORDER BY m.name`))
  return c.json(rows)
})

app.post('/', requireAdmin, async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const { values, error } = medicationValues(b)
  if (error) return c.json({ error }, 400)
  if (!b.clientId || !values.name || !String(values.name).trim()) return c.json({ error: 'clientId and medication name are required' }, 400)
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, b.clientId)).limit(1)
  if (!client) return c.json({ error: 'Client not found' }, 404)
  const [row] = await db.insert(medications).values({ status: 'active', ...values, clientId: b.clientId, name: String(values.name).trim() } as any).returning()
  await writeCareAudit(c.get('user' as any), 'CREATE', 'medications', row.id, row)
  return c.json({ ...row, medicationName: row.name, prescriber: row.prescribedBy, isActive: row.status === 'active' }, 201)
})

app.put('/:id', requireAdmin, async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const { values, error } = medicationValues(b)
  if (error) return c.json({ error }, 400)
  if ('name' in values && (!values.name || !String(values.name).trim())) return c.json({ error: 'Medication name cannot be blank' }, 400)
  const [row] = await db.update(medications).set({ ...values, updatedAt: new Date() } as any).where(eq(medications.id, c.req.param('id'))).returning()
  if (!row) return c.json({ error: 'Medication not found' }, 404)
  await writeCareAudit(c.get('user' as any), 'UPDATE', 'medications', row.id, row)
  return c.json({ ...row, medicationName: row.name, prescriber: row.prescribedBy, isActive: row.status === 'active' })
})

const discontinue = async (c: any) => {
  const [row] = await db.update(medications)
    .set({ status: 'discontinued', endDate: sql`CURRENT_DATE` as any, updatedAt: new Date() })
    .where(eq(medications.id, c.req.param('id'))).returning()
  if (!row) return c.json({ error: 'Medication not found' }, 404)
  await writeCareAudit(c.get('user' as any), 'UPDATE', 'medications', row.id, { discontinued: true })
  return c.json({ success: true, ...row })
}
app.put('/:id/discontinue', requireAdmin, discontinue)
app.post('/:id/discontinue', requireAdmin, discontinue)

// ── MAR ──────────────────────────────────────────────────────────────────────
app.post('/log', async (c) => {
  const user = c.get('user' as any)
  const b = await c.req.json().catch(() => ({}))
  if (!b.medicationId || !b.clientId) return c.json({ error: 'medicationId and clientId are required' }, 400)
  // 'given' is the default; anything else outside the MAR list is 'given' too (the source CRM's rule).
  const status = MAR_STATUSES.includes(b.status) ? b.status : 'given'
  const when = b.administeredTime ?? b.administeredAt
  const administeredAt = when ? new Date(when) : new Date()
  if (isNaN(administeredAt.getTime())) return c.json({ error: 'The time given is not a valid date and time' }, 400)
  const scheduledTime = b.scheduledTime ? new Date(b.scheduledTime) : null
  if (scheduledTime && isNaN(scheduledTime.getTime())) return c.json({ error: 'The scheduled time is not a valid date and time' }, 400)

  const [med] = await db.select({ id: medications.id, clientId: medications.clientId }).from(medications).where(eq(medications.id, b.medicationId)).limit(1)
  if (!med || med.clientId !== b.clientId) return c.json({ error: 'Medication not found for this client' }, 404)
  const caregiverId = await attributedTo(user, b.caregiverId)
  if (!caregiverId) return c.json({ error: 'Caregiver not found' }, 404)
  if (b.timeEntryId) {
    const [te] = await db.select({ clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId }).from(timeEntries).where(eq(timeEntries.id, b.timeEntryId)).limit(1)
    if (!te || te.clientId !== b.clientId) return c.json({ error: 'That visit is not this client\'s' }, 400)
    if (!isOffice(user) && te.caregiverId !== userIdOf(user)) return c.json({ error: 'Not your shift' }, 403)
  }
  const [row] = await db.insert(medicationLogs).values({
    medicationId: med.id, clientId: b.clientId, caregiverId,
    timeEntryId: b.timeEntryId || null, scheduledTime, administeredAt,
    status, effectiveStatus: status, dosageGiven: b.dosageGiven || null,
    notes: b.notes || null, witnessedBy: b.witnessedBy ? String(b.witnessedBy).trim() || null : null,
  }).returning()
  return c.json(row, 201)
})

const LOG_SELECT = sql`ml.*, ml.administered_at AS administered_time,
  m.name AS medication_name, m.dosage, m.frequency,
  u.first_name AS caregiver_first, u.last_name AS caregiver_last`

app.get('/logs/client/:clientId', async (c) => {
  const { startDate, endDate } = c.req.query()
  const rows = rowsOf(await db.execute(sql`
    SELECT ${LOG_SELECT}
      FROM medication_logs ml
      JOIN medications m ON ml.medication_id = m.id
      LEFT JOIN users u ON ml.caregiver_id = u.id
     WHERE ml.client_id = ${c.req.param('clientId')}
       ${startDate && !isNaN(new Date(startDate).getTime()) ? sql`AND ml.administered_at >= ${ts(new Date(startDate))}` : sql``}
       ${endDate && !isNaN(new Date(endDate).getTime()) ? sql`AND ml.administered_at <= ${ts(new Date(YMD.test(endDate) ? endDate + 'T23:59:59.999Z' : endDate))}` : sql``}
     ORDER BY ml.administered_at DESC`))
  return c.json(rows)
})

app.get('/logs/time-entry/:timeEntryId', async (c) => {
  const rows = rowsOf(await db.execute(sql`
    SELECT ${LOG_SELECT}
      FROM medication_logs ml
      JOIN medications m ON ml.medication_id = m.id
      LEFT JOIN users u ON ml.caregiver_id = u.id
     WHERE ml.time_entry_id = ${c.req.param('timeEntryId')}
     ORDER BY ml.administered_at`))
  return c.json(rows)
})

app.get('/due/:clientId', async (c) => {
  const rows = rowsOf(await db.execute(sql`
    SELECT ${MED_COLUMNS} FROM medications m
     WHERE m.client_id = ${c.req.param('clientId')} AND m.status = 'active'
     ORDER BY m.name`))
  return c.json(rows)
})

// Per active medication over the window: doses given, refused, missed, held, and every entry.
app.get('/reports/adherence/:clientId', async (c) => {
  const { startDate, endDate } = c.req.query()
  const from = startDate && YMD.test(startDate) ? startDate : '1970-01-01'
  const to = endDate && YMD.test(endDate) ? endDate : '2099-12-31'
  const rows = rowsOf(await db.execute(sql`
    SELECT m.name AS medication_name,
           COUNT(ml.id) FILTER (WHERE COALESCE(ml.effective_status, ml.status) = 'given')::int AS administered_count,
           COUNT(ml.id) FILTER (WHERE COALESCE(ml.effective_status, ml.status) = 'refused')::int AS refused_count,
           COUNT(ml.id) FILTER (WHERE COALESCE(ml.effective_status, ml.status) = 'missed')::int AS missed_count,
           COUNT(ml.id) FILTER (WHERE COALESCE(ml.effective_status, ml.status) = 'held')::int AS held_count,
           COUNT(ml.id)::int AS total_entries
      FROM medications m
      LEFT JOIN medication_logs ml ON ml.medication_id = m.id
       AND ml.administered_at >= ${from}::date AND ml.administered_at < (${to}::date + 1)
     WHERE m.client_id = ${c.req.param('clientId')} AND m.status = 'active'
     GROUP BY m.id, m.name
     ORDER BY m.name`))
  return c.json(rows)
})

// ── vitals ───────────────────────────────────────────────────────────────────
// Plausible ranges — the same numbers the table's CHECK constraints hold.
export const VITALS = [
  { key: 'systolicBp', col: 'systolicBp', label: 'Systolic BP', int: true, min: 50, max: 260 },
  { key: 'diastolicBp', col: 'diastolicBp', label: 'Diastolic BP', int: true, min: 25, max: 160 },
  { key: 'pulse', col: 'pulse', label: 'Pulse', int: true, min: 25, max: 220 },
  { key: 'respirations', col: 'respirations', label: 'Respirations', int: true, min: 4, max: 70 },
  { key: 'oxygenSaturation', col: 'oxygenSaturation', label: 'O2 saturation', int: true, min: 50, max: 100 },
  { key: 'temperatureF', col: 'temperatureF', label: 'Temperature', int: false, min: 85, max: 112 },
  { key: 'bloodGlucose', col: 'bloodGlucose', label: 'Blood glucose', int: true, min: 20, max: 800 },
  { key: 'weightLbs', col: 'weightLbs', label: 'Weight', int: false, min: 30, max: 800 },
  { key: 'painScale', col: 'painScale', label: 'Pain scale', int: true, min: 0, max: 10 },
] as const

app.post('/vitals', async (c) => {
  const user = c.get('user' as any)
  const b = await c.req.json().catch(() => ({}))
  if (!b.clientId) return c.json({ error: 'clientId is required' }, 400)
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
    values[f.col] = f.int ? n : s
  }
  if (bad.length) return c.json({ error: `One or more values out of plausible range: ${bad.join('; ')}` }, 400)
  if (!Object.keys(values).length) return c.json({ error: 'At least one vital measurement is required' }, 400)

  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, b.clientId)).limit(1)
  if (!client) return c.json({ error: 'Client not found' }, 404)
  if (b.timeEntryId) {
    const [te] = await db.select({ clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId }).from(timeEntries).where(eq(timeEntries.id, b.timeEntryId)).limit(1)
    if (!te || te.clientId !== b.clientId) return c.json({ error: 'That visit is not this client\'s' }, 400)
    if (!isOffice(user) && te.caregiverId !== userIdOf(user)) return c.json({ error: 'Not your shift' }, 403)
  }
  const caregiverId = await attributedTo(user, b.caregiverId)
  if (!caregiverId) return c.json({ error: 'Caregiver not found' }, 404)
  let recordedAt = new Date()
  if (b.recordedAt) {
    recordedAt = new Date(b.recordedAt)
    if (isNaN(recordedAt.getTime())) return c.json({ error: 'The time taken is not a valid date and time' }, 400)
  }
  const [row] = await db.insert(clientVitals).values({
    ...values,
    clientId: b.clientId,
    caregiverId,
    timeEntryId: b.timeEntryId || null,
    recordedAt,
    painLocation: b.painLocation ? String(b.painLocation) : null,
    notes: b.notes ? String(b.notes) : null,
  } as any).returning()
  return c.json(row, 201)
})

app.get('/vitals/client/:clientId', async (c) => {
  const { limit = '50', startDate, endDate } = c.req.query()
  const from = startDate && !isNaN(new Date(startDate).getTime()) ? new Date(startDate) : undefined
  const to = endDate && !isNaN(new Date(endDate).getTime()) ? new Date(YMD.test(endDate) ? endDate + 'T23:59:59.999Z' : endDate) : undefined
  return c.json(await listClientVitals(c.req.param('clientId'), parseInt(limit) || 50, { from, to }))
})

app.get('/vitals/latest/:clientId', async (c) => {
  const [latest] = await listClientVitals(c.req.param('clientId'), 1)
  return c.json(latest || null)
})

export default app
