// Clients: the agency's people in care — the office's list and record, emergency contacts, onboarding, assignments,
// EVV units, the Medicaid-id import — and the caregiver's view of the clients they serve (their card and its notes).
// Moved from templates/crm-homecare/backend/src/routes/clients.ts.
//
// Permissions (the template's requireAdmin and its caregiver interceptor):
//   · reads: care-clients:read. A caregiver's GETs are narrowed as the template narrowed them — GET / is the clients
//     they serve in the phone's columns, GET /:id one of those, /:id/caregiver-view and /:id/visit-notes for a client
//     they serve; every other GET (the office's record, onboarding, the EVV week) is refused.
//   · the office's writes: care-clients:create / update / delete; assignments are the schedule's (care-schedule).
//   · a note on the client's card: evv:create (a caregiver records it, for a client they serve).
// Changes: every read and write is the signed-in person's company; replies are camelCase (the caregiver's list and
// card were snake_case) and lists are { data, pagination } (the office list was { clients, total, page, pages }).
import { Hono } from 'hono'
import { normaliseZip, ZIP_ERROR } from '@twomiah/tenant-backend'
import { optionalPointProblem } from '../../../core/geo.ts'
import { and, asc, count, desc, eq, ilike, inArray, or } from 'drizzle-orm'
import {
  clients, clientEmergencyContacts, clientOnboarding, clientAssignments, referralSources, geofenceSettings, authorizations,
  user as users,
} from '../../../db/schema/index.ts'
import {
  caregiverClientList, caregiverClientOne, evvWeekRows, clientCaregiverCard, clientVisitNoteFeed, insertClientCardNote,
} from '../../../data/homecareClients.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { UNIT_MINUTES } from '../core/evvWeekly.ts'
import { SYSTEM_NOTE_MARKERS } from '../core/visitRecord.ts'
import { freeTextLines } from '../core/medicationsOnFile.ts'
import { body, who, whole, NOT_YOUR_CLIENT, type ClientAccess } from './shared.ts'

// One-segment GET paths that are office reports, not a client id.
const OFFICE_ONLY_GETS = new Set(['evv-week'])
// Two-segment GETs a caregiver may make (/:id/<this>): the caregiver's client card. Each scopes itself.
const CAREGIVER_CLIENT_GETS = new Set(['caregiver-view', 'visit-notes'])

export const VISIT_NOTE_MAX = 5000

const CLIENT_FIELDS = [
  'firstName', 'lastName', 'dateOfBirth', 'gender', 'address', 'city', 'state', 'zip',
  'phone', 'email', 'referredById', 'referralDate', 'startDate', 'isActive', 'serviceType',
  'insuranceProvider', 'insuranceId', 'insuranceGroup', 'medicalConditions', 'allergies',
  'medications', 'preferredCaregivers', 'doNotUseCaregivers', 'notes',
  'evvClientId', 'mcoMemberId', 'primaryDiagnosisCode', 'secondaryDiagnosisCode',
  'careTypeId', 'isPrivatePay', 'privatePayRate', 'privatePayRateType',
  'weeklyAuthorizedUnits', 'serviceDaysPerWeek', 'serviceAllowedDays',
  'assistanceNeeds', 'billingNotes', 'latitude', 'longitude', 'medicaidId', 'ivrCode',
  'medicalNotes', 'carePreferences',
] as const
const DATE_FIELDS = new Set(['dateOfBirth', 'referralDate', 'startDate'])

/** The body's client fields ('' dates as null), with the screen's referralSourceId alias. */
function clientValues(b: any, keys: readonly string[]): Record<string, any> {
  const data: Record<string, any> = {}
  for (const key of keys) {
    if (b[key] !== undefined) data[key] = DATE_FIELDS.has(key) && b[key] === '' ? null : b[key]
  }
  if (b.referralSourceId !== undefined && data.referredById === undefined) data.referredById = b.referralSourceId || null
  return data
}

/** A client row without its secrets and without the card photos (megabytes each; /api/insurance-cards serves them). */
function safe(row: any) {
  const { ssnEncrypted: _s, portalPasswordHash: _ph, portalToken: _pt, insuranceCardFront: front, insuranceCardBack: back, ...rest } = row
  return { ...rest, hasInsuranceCardFront: !!front, hasInsuranceCardBack: !!back }
}

/**
 * The office's READ-ONLY view of a client (care-office:read — the viewer seat; verticals/homecare/settings.ts): who they
 * are, how to reach them, where the visits are, whether they are active and the service. Not the clinical record (DOB,
 * diagnosis codes, conditions, allergies, medications, medical and care notes), not insurance or Medicaid ids, not
 * rates or billing notes. (Live role check, 2026-10-23)
 */
const DIRECTORY_FIELDS = ['id', 'firstName', 'lastName', 'phone', 'email', 'address', 'city', 'state', 'zip', 'isActive', 'status', 'serviceType', 'careTypeId', 'startDate'] as const
const directoryEntry = (row: any) => Object.fromEntries(DIRECTORY_FIELDS.map((k) => [k, row[k] ?? null]))
/** Who is assigned, without what they are paid for it. */
const assignmentForDirectory = ({ payRate: _pay, notes: _notes, ...a }: any) => a

/** The client's lists (conditions, allergies) are JSON arrays; the card prints text, one per line (null when empty). */
const listLines = (v: unknown): string | null => {
  const lines = freeTextLines(v)
  return lines.length ? lines.join('\n') : null
}

export function createClientRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d

  // Every read needs care-clients:read — except the list and one client's record, which the read-only office seat
  // (care-office:read) reads too, as its directory entry (DIRECTORY_FIELDS above).
  const read = requirePermission('care-clients:read')
  const directory = d.permissions.requireAnyPermission(['care-clients:read', 'care-office:read'])
  const isDirectoryRead = (path: string) => {
    const parts = path.replace(/\/+$/, '').split('/').filter(Boolean)
    const rest = parts.slice(parts.indexOf('clients') + 1)
    return rest.length === 0 || (rest.length === 1 && !OFFICE_ONLY_GETS.has(rest[0]))
  }
  app.use('*', async (c, next) => (c.req.method !== 'GET' ? next() : isDirectoryRead(c.req.path) ? directory(c, next) : read(c, next)))
  /** Does this seat read the full record (care-clients:read), or only the directory? */
  const canSee = canSeeWith(d.permissions)
  const readsRecord = async (c: any) => { const u = c.get('user'); return canSee(u.role, 'care-clients:read', u.userId) }

  // A CAREGIVER sees only the clients they serve, and never their identifiers.
  app.use('*', async (c, next) => {
    const { user, companyId, me } = who(c)
    if (!user || access.office(user) || c.req.method !== 'GET') return next()
    const parts = c.req.path.replace(/\/+$/, '').split('/').filter(Boolean) // ['api','clients', ...]
    const rest = parts.slice(parts.indexOf('clients') + 1)
    if (rest.length === 0) return whole(c, await caregiverClientList(db, companyId, me))
    if (rest.length === 1 && OFFICE_ONLY_GETS.has(rest[0])) return fail(c, 403, 'Admin access required')
    if (rest.length === 1) {
      const row = await caregiverClientOne(db, companyId, me, rest[0])
      return row ? one(c, row) : fail(c, 404, 'Client not found')
    }
    if (rest.length === 2 && CAREGIVER_CLIENT_GETS.has(rest[1])) return next()
    return fail(c, 403, 'Admin access required')
  })

  // GET /api/clients — the office's list, paged.
  app.get('/', async (c) => {
    const { companyId } = who(c)
    const { search, isActive, serviceType, page = '1', limit = '50' } = c.req.query()
    const pageN = Math.max(parseInt(page) || 1, 1)
    const limitN = Math.max(parseInt(limit) || 50, 1)
    const conditions: any[] = [eq(clients.companyId, companyId)]
    if (isActive !== undefined) conditions.push(eq(clients.isActive, isActive === 'true'))
    if (serviceType) conditions.push(eq(clients.serviceType, serviceType))
    if (search) {
      conditions.push(or(
        ilike(clients.firstName, '%' + search + '%'),
        ilike(clients.lastName, '%' + search + '%'),
        ilike(clients.phone, '%' + search + '%'),
        ilike(clients.email, '%' + search + '%'),
      ))
    }
    const where = and(...conditions)
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(clients).where(where).orderBy(desc(clients.isActive), asc(clients.lastName)).offset((pageN - 1) * limitN).limit(limitN),
      db.select({ value: count() }).from(clients).where(where),
    ])
    const ids = rows.map((r: any) => r.id)
    const contacts: Record<string, any[]> = {}
    const onboarding: Record<string, any> = {}
    const assignments: Record<string, any[]> = {}
    if (ids.length) {
      const [ecRows, obRows, asRows] = await Promise.all([
        db.select().from(clientEmergencyContacts).where(and(
          eq(clientEmergencyContacts.companyId, companyId), inArray(clientEmergencyContacts.clientId, ids), eq(clientEmergencyContacts.isPrimary, true))),
        db.select({ clientId: clientOnboarding.clientId, allCompleted: clientOnboarding.allCompleted }).from(clientOnboarding)
          .where(and(eq(clientOnboarding.companyId, companyId), inArray(clientOnboarding.clientId, ids))),
        db.select({
          id: clientAssignments.id, clientId: clientAssignments.clientId, caregiverId: clientAssignments.caregiverId,
          assignmentDate: clientAssignments.assignmentDate, hoursPerWeek: clientAssignments.hoursPerWeek, payRate: clientAssignments.payRate,
          status: clientAssignments.status, notes: clientAssignments.notes, createdAt: clientAssignments.createdAt, updatedAt: clientAssignments.updatedAt,
          caregiverFirstName: users.firstName, caregiverLastName: users.lastName,
        }).from(clientAssignments).leftJoin(users, eq(clientAssignments.caregiverId, users.id))
          .where(and(eq(clientAssignments.companyId, companyId), inArray(clientAssignments.clientId, ids), eq(clientAssignments.status, 'active'))),
      ])
      for (const ec of ecRows) (contacts[ec.clientId] ||= []).push(ec)
      for (const ob of obRows) onboarding[ob.clientId] = { allCompleted: ob.allCompleted }
      for (const a of asRows) {
        const { caregiverFirstName, caregiverLastName, ...rest } = a
        ;(assignments[a.clientId] ||= []).push({ ...rest, caregiver: { firstName: caregiverFirstName, lastName: caregiverLastName } })
      }
    }
    if (!(await readsRecord(c))) {
      return list(c, rows.map((r: any) => ({ ...directoryEntry(r), assignments: (assignments[r.id] || []).map(assignmentForDirectory) })), { page: pageN, limit: limitN, total: Number(total) })
    }
    const data = rows.map((r: any) => ({
      ...safe(r),
      emergencyContacts: contacts[r.id] || [],
      onboarding: onboarding[r.id] || null,
      assignments: assignments[r.id] || [],
    }))
    return list(c, data, { page: pageN, limit: limitN, total: Number(total) })
  })

  // GET /api/clients/evv-week[?clientId=] (above GET /:id) — this Sun–Sat week's Sandata minutes per Sandata client:
  // the weekly allowance, the minutes already sent and what is left. At 0 left the caregiver app stops sending that
  // client's visits to Sandata until Sunday.
  app.get('/evv-week', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const cfg = await core.sandata.getConfig(companyId)
    const rows = await evvWeekRows(db, companyId, c.req.query('clientId') || null, cfg.timezone)
    return whole(c, rows.map((row) => {
      const allowance = row.evvWeeklyUnits == null ? null : Number(row.evvWeeklyUnits) * UNIT_MINUTES
      return {
        ...row,
        allowanceMinutes: allowance,
        remainingMinutes: allowance == null ? null : Math.max(0, allowance - row.usedMinutes),
        // What the caregiver app does at the NEXT clock-in for this client.
        nextVisitToSandata: allowance == null ? true : row.usedMinutes < allowance,
      }
    }))
  })

  // PATCH /api/clients/:id/evv-units { units: whole number 0–672 | null } — null = not entered; 0 = no EVV hours.
  app.patch('/:id/evv-units', requirePermission('care-clients:update'), async (c) => {
    const { user, companyId } = who(c)
    const b = await body(c)
    const raw = b?.units
    const units = raw === null || raw === '' || raw === undefined ? null : Number(raw)
    if (units !== null && (!Number.isInteger(units) || units < 0 || units > 672)) {
      return fail(c, 400, 'EVV units per week must be a whole number from 0 to 672, or blank.')
    }
    const id = c.req.param('id')
    const scope = and(eq(clients.id, id), eq(clients.companyId, companyId))
    const [before] = await db.select({ evvWeeklyUnits: clients.evvWeeklyUnits }).from(clients).where(scope).limit(1)
    if (!before) return fail(c, 404, 'Client not found')
    const [row] = await db.update(clients).set({ evvWeeklyUnits: units, updatedAt: new Date() }).where(scope)
      .returning({ id: clients.id, evvWeeklyUnits: clients.evvWeeklyUnits })
    await core.careAudit.writeCareAudit(user, 'UPDATE', 'clients', id, { evv_weekly_units: units }, { evv_weekly_units: before.evvWeeklyUnits })
    return one(c, row)
  })

  // ── The caregiver's client card ─────────────────────────────────────────────────────────────
  // The office, or a caregiver who serves the client; care information only.
  app.get('/:id/caregiver-view', async (c) => {
    const { user, companyId } = who(c)
    const id = c.req.param('id')
    if (!(await access.maySeeClient(user, id))) return fail(c, 403, NOT_YOUR_CLIENT)
    const row = await clientCaregiverCard(db, companyId, id)
    if (!row) return fail(c, 404, 'Client not found')
    // ONE source for the medications on file (core/medicationsOnFile.ts): the Medications list, or — only for a
    // client with no rows — the client record's free-text note, labelled (medicationsSource 'client_record').
    const meds = await core.medications.medicationsOnFile(companyId, id, row.medications)
    return one(c, {
      ...row,
      medicalConditions: listLines(row.medicalConditions),
      medications: meds.lines.length ? meds.lines.join('\n') : null,
      medicationsSource: meds.source,
      allergies: listLines(row.allergies),
    })
  })

  // GET /api/clients/:id/visit-notes — card notes, visit-documentation notes and clock-out notes, newest first.
  app.get('/:id/visit-notes', async (c) => {
    const { user, companyId } = who(c)
    const id = c.req.param('id')
    if (!(await access.maySeeClient(user, id))) return fail(c, 403, NOT_YOUR_CLIENT)
    return whole(c, await clientVisitNoteFeed(db, companyId, id, SYSTEM_NOTE_MARKERS))
  })

  // POST /api/clients/:id/visit-notes { note } — a caregiver who serves the client, or the office.
  app.post('/:id/visit-notes', requirePermission('evv:create'), async (c) => {
    const { user, companyId, me } = who(c)
    const id = c.req.param('id')
    const refused = await access.careWriteRefusal(c, id)
    if (refused) return refused
    const b = await body(c)
    const note = typeof b?.note === 'string' ? b.note.trim() : ''
    if (!note) return fail(c, 400, 'Please write the note')
    if (note.length > VISIT_NOTE_MAX) return fail(c, 400, `A visit note can be at most ${VISIT_NOTE_MAX} characters`)

    // Clocked in here for a scheduled visit → the note is THAT visit's note, in the one visit-note store the office's
    // Visit Documentation, the care-notes PDF and the invoice read.
    const open = await core.visitRecord.visitOfOpenPunch(companyId, me, id)
    if (open) {
      const saved = await core.visitRecord.appendVisitNote(db, companyId, id, open.visit, me, note)
      await core.careAudit.writeCareAudit(user, 'APPEND_NOTE', 'visit_documentation', saved.id,
        { note, visitDate: open.visit.visitDate, startTime: open.visit.startTime, timeEntryId: open.timeEntryId })
      return one(c, { id: saved.id, clientId: id, caregiverId: me, note, createdAt: saved.updatedAt, source: 'visit', visitDate: open.visit.visitDate }, 201)
    }
    // Not on a visit: a general note on the client's card.
    const row = await insertClientCardNote(db, companyId, id, me, note)
    await core.careAudit.writeCareAudit(user, 'CREATE', 'client_visit_notes', row.id, row)
    return one(c, row, 201)
  })

  // GET /api/clients/:id/onboarding (above /:id). A client of the company with no record yet — one moved in from the
  // template, or made outside the add form — has a checklist not started: the six steps not done. It answered 404,
  // and Client Onboarding could neither show nor tick that client's steps (found in the browser, 2026-10-19).
  app.get('/:id/onboarding', async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const [row] = await db.select().from(clientOnboarding)
      .where(and(eq(clientOnboarding.clientId, id), eq(clientOnboarding.companyId, companyId))).limit(1)
    if (row) return one(c, row)
    if (!(await access.clientInCompany(companyId, id))) return fail(c, 404, 'Client not found')
    return one(c, {
      clientId: id, emergencyContactsCompleted: false, medicalHistoryCompleted: false, insuranceInfoCompleted: false,
      carePreferencesCompleted: false, familyCommunicationCompleted: false, initialAssessmentCompleted: false,
      allCompleted: false, completedAt: null,
    })
  })

  // GET /api/clients/:id — the office's record with its contacts, onboarding, assignments, referrer, geofence and
  // active authorizations.
  app.get('/:id', async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const [client] = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.companyId, companyId))).limit(1)
    if (!client) return fail(c, 404, 'Client not found')
    const [ecRows, obRows, asRows, refRows, geoRows, authRows] = await Promise.all([
      db.select().from(clientEmergencyContacts).where(and(eq(clientEmergencyContacts.clientId, id), eq(clientEmergencyContacts.companyId, companyId))),
      db.select().from(clientOnboarding).where(and(eq(clientOnboarding.clientId, id), eq(clientOnboarding.companyId, companyId))).limit(1),
      db.select({
        id: clientAssignments.id, clientId: clientAssignments.clientId, caregiverId: clientAssignments.caregiverId,
        assignmentDate: clientAssignments.assignmentDate, hoursPerWeek: clientAssignments.hoursPerWeek, payRate: clientAssignments.payRate,
        status: clientAssignments.status, notes: clientAssignments.notes, createdAt: clientAssignments.createdAt, updatedAt: clientAssignments.updatedAt,
        caregiverFirstName: users.firstName, caregiverLastName: users.lastName, caregiverPhone: users.phone, caregiverIdField: users.id,
      }).from(clientAssignments).leftJoin(users, eq(clientAssignments.caregiverId, users.id))
        .where(and(eq(clientAssignments.clientId, id), eq(clientAssignments.companyId, companyId))),
      client.referredById
        ? db.select({ id: referralSources.id, name: referralSources.name, type: referralSources.type }).from(referralSources)
          .where(and(eq(referralSources.id, client.referredById), eq(referralSources.companyId, companyId))).limit(1)
        : Promise.resolve([]),
      db.select().from(geofenceSettings).where(and(eq(geofenceSettings.clientId, id), eq(geofenceSettings.companyId, companyId))).limit(1),
      db.select().from(authorizations)
        .where(and(eq(authorizations.clientId, id), eq(authorizations.companyId, companyId), eq(authorizations.status, 'active')))
        .orderBy(asc(authorizations.endDate)),
    ])
    const withCaregiver = asRows.map(({ caregiverFirstName, caregiverLastName, caregiverPhone, caregiverIdField, ...a }: any) => ({
      ...a, caregiver: { id: caregiverIdField, firstName: caregiverFirstName, lastName: caregiverLastName, phone: caregiverPhone },
    }))
    if (!(await readsRecord(c))) return one(c, { ...directoryEntry(client), assignments: withCaregiver.map(assignmentForDirectory) })
    return one(c, {
      ...safe(client),
      emergencyContacts: ecRows,
      onboarding: obRows[0] || null,
      assignments: withCaregiver,
      referredBy: (refRows as any[])[0] || null,
      geofence: geoRows[0] || null,
      authorizations: authRows,
    })
  })

  // POST /api/clients — with its onboarding record and any emergency contacts (an array, or the form's flat fields).
  app.post('/', requirePermission('care-clients:create'), async (c) => {
    const { companyId } = who(c)
    const { emergencyContacts: ecInput, emergencyContactName, emergencyContactPhone, emergencyContactRelationship, ...b } = await body(c)
    let contacts = ecInput
    if (!contacts?.length && emergencyContactName) {
      contacts = [{ name: emergencyContactName, phone: emergencyContactPhone || null, relationship: emergencyContactRelationship || null, isPrimary: true }]
    }
    if (b.zip && normaliseZip(b.zip) === null) return fail(c, 400, ZIP_ERROR)
    const offEarth = optionalPointProblem(b)
    if (offEarth) return fail(c, 400, offEarth)
    const data = clientValues(b, CLIENT_FIELDS)
    const [client] = await db.insert(clients).values({ ...data, companyId } as any).returning()
    const [onboardingRecord] = await db.insert(clientOnboarding).values({ companyId, clientId: client.id }).returning()
    let ecRows: any[] = []
    // `phone` is NOT NULL: a name-only contact saves with '' (a null 500'd the whole create); no name, no contact.
    const named = Array.isArray(contacts) ? contacts.filter((ec: any) => ec?.name && String(ec.name).trim()) : []
    if (named.length) {
      ecRows = await db.insert(clientEmergencyContacts).values(named.map((ec: any) => ({
        companyId,
        clientId: client.id,
        name: ec.name,
        relationship: ec.relationship || '',
        phone: ec.phone || '',
        email: ec.email || null,
        isPrimary: ec.isPrimary ?? false,
      }))).returning()
    }
    return one(c, { ...safe(client), emergencyContacts: ecRows, onboarding: onboardingRecord }, 201)
  })

  // PUT /api/clients/:id — the fields sent (and the portal switches).
  app.put('/:id', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const { emergencyContacts: _ec, onboarding: _ob, ...b } = await body(c)
    if (b.zip && normaliseZip(b.zip) === null) return fail(c, 400, ZIP_ERROR)
    const offEarth = optionalPointProblem(b)
    if (offEarth) return fail(c, 400, offEarth)
    const data = clientValues(b, [...CLIENT_FIELDS, 'portalEnabled', 'portalEmail'])
    const [client] = await db.update(clients).set({ ...data, updatedAt: new Date() })
      .where(and(eq(clients.id, id), eq(clients.companyId, companyId))).returning()
    if (!client) return fail(c, 404, 'Client not found')
    const [ecRows, obRows] = await Promise.all([
      db.select().from(clientEmergencyContacts).where(and(eq(clientEmergencyContacts.clientId, id), eq(clientEmergencyContacts.companyId, companyId))),
      db.select().from(clientOnboarding).where(and(eq(clientOnboarding.clientId, id), eq(clientOnboarding.companyId, companyId))).limit(1),
    ])
    return one(c, { ...safe(client), emergencyContacts: ecRows, onboarding: obRows[0] || null })
  })

  // PATCH /api/clients/:id/onboarding — the steps sent, merged; all done → completed now.
  app.patch('/:id/onboarding', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const b = await body(c)
    const scope = and(eq(clientOnboarding.clientId, id), eq(clientOnboarding.companyId, companyId))
    let [existing] = await db.select().from(clientOnboarding).where(scope).limit(1)
    if (!existing) {
      // The first tick on a client with no record makes it (see the GET above).
      if (!(await access.clientInCompany(companyId, id))) return fail(c, 404, 'Client not found')
      ;[existing] = await db.insert(clientOnboarding).values({ companyId, clientId: id }).onConflictDoNothing().returning()
      if (!existing) [existing] = await db.select().from(clientOnboarding).where(scope).limit(1)
    }
    const STEPS = [
      'emergencyContactsCompleted', 'medicalHistoryCompleted', 'insuranceInfoCompleted',
      'carePreferencesCompleted', 'familyCommunicationCompleted', 'initialAssessmentCompleted',
    ] as const
    const data: Record<string, any> = {}
    for (const key of STEPS) if (b[key] !== undefined) data[key] = b[key]
    const merged: any = { ...existing, ...data }
    const allCompleted = STEPS.every((f) => merged[f] === true)
    data.allCompleted = allCompleted
    data.completedAt = allCompleted ? new Date() : null
    data.updatedAt = new Date()
    const [updated] = await db.update(clientOnboarding).set(data).where(scope).returning()
    return one(c, updated)
  })

  // POST /api/clients/:id/emergency-contacts
  app.post('/:id/emergency-contacts', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    if (!(await access.clientInCompany(companyId, id))) return fail(c, 404, 'Client not found')
    const b = await body(c)
    const [contact] = await db.insert(clientEmergencyContacts).values({
      // A contact's phone is NOT NULL: a contact saved without one is stored with none (''), as POST /api/clients does,
      // not refused with a 500 (the screen's name-only edit lost the contact that way).
      companyId, clientId: id, name: b.name, relationship: b.relationship, phone: typeof b.phone === 'string' ? b.phone : '', email: b.email, isPrimary: b.isPrimary ?? false,
    }).returning()
    return one(c, contact, 201)
  })

  // DELETE /api/clients/:id/emergency-contacts/:contactId
  app.delete('/:id/emergency-contacts/:contactId', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const [deleted] = await db.delete(clientEmergencyContacts).where(and(
      eq(clientEmergencyContacts.id, c.req.param('contactId')), eq(clientEmergencyContacts.clientId, c.req.param('id')),
      eq(clientEmergencyContacts.companyId, companyId),
    )).returning()
    return deleted ? done(c, 'Deleted') : fail(c, 404, 'Emergency contact not found')
  })

  // POST /api/clients/:id/assignments — a caregiver assigned to the client (the schedule's).
  app.post('/:id/assignments', requirePermission('care-schedule:create'), async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const b = await body(c)
    if (!(await access.clientInCompany(companyId, id))) return fail(c, 404, 'Client not found')
    const caregiver = b.caregiverId ? await access.personInCompany(companyId, String(b.caregiverId)) : null
    if (!caregiver) return fail(c, 404, 'Caregiver not found')
    const [assignment] = await db.insert(clientAssignments).values({
      companyId, clientId: id, caregiverId: caregiver.id, assignmentDate: b.assignmentDate, hoursPerWeek: b.hoursPerWeek,
      payRate: b.payRate, status: b.status || 'active', notes: b.notes,
    }).returning()
    return one(c, { ...assignment, caregiver }, 201)
  })

  // PATCH /api/clients/assignments/:assignmentId
  app.patch('/assignments/:assignmentId', requirePermission('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const updates: Record<string, any> = { updatedAt: new Date() }
    for (const key of ['caregiverId', 'assignmentDate', 'hoursPerWeek', 'payRate', 'status', 'notes']) if (b[key] !== undefined) updates[key] = b[key]
    if (updates.caregiverId && !(await access.personInCompany(companyId, String(updates.caregiverId)))) return fail(c, 404, 'Caregiver not found')
    const [assignment] = await db.update(clientAssignments).set(updates)
      .where(and(eq(clientAssignments.id, c.req.param('assignmentId')), eq(clientAssignments.companyId, companyId))).returning()
    return assignment ? one(c, assignment) : fail(c, 404, 'Assignment not found')
  })

  // POST /api/clients/bulk-assign-medicaid-ids { rows: [{ name: "Last, First" | "First Last", medicaidId }] } — fills a
  // Medicaid id only where the client has none; a different existing id is a conflict to review, never overwritten.
  app.post('/bulk-assign-medicaid-ids', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = who(c)
    const { rows: csvRows } = await body(c)
    if (!Array.isArray(csvRows) || csvRows.length === 0) return fail(c, 400, 'No rows provided')
    const all = await db.select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName, medicaidId: clients.medicaidId })
      .from(clients).where(and(eq(clients.companyId, companyId), eq(clients.isActive, true)))
    const results: any[] = []
    let matched = 0, updated = 0, skipped = 0, noMatch = 0
    for (const row of csvRows) {
      const csvName = String(row?.name || '').trim()
      const csvMedicaidId = String(row?.medicaidId || '').trim()
      if (!csvName || !csvMedicaidId) {
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'skipped', reason: 'Missing name or ID' }); skipped++; continue
      }
      let first = '', last = ''
      if (csvName.includes(',')) { const p = csvName.split(',').map((s: string) => s.trim()); last = p[0]; first = p[1] || '' }
      else { const p = csvName.split(/\s+/); first = p[0] || ''; last = p.slice(1).join(' ') }
      const matches = all.filter((cl: any) => cl.firstName.toLowerCase() === first.toLowerCase() && cl.lastName.toLowerCase() === last.toLowerCase())
      if (matches.length === 0) {
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'no_match', reason: 'No matching client found' }); noMatch++; continue
      }
      if (matches.length > 1) {
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'multiple_matches', reason: `${matches.length} clients with this name`, clientIds: matches.map((m: any) => m.id) })
        skipped++; continue
      }
      const match = matches[0]
      matched++
      if (match.medicaidId === csvMedicaidId) {
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'already_set', clientId: match.id }); skipped++
      } else if (match.medicaidId && match.medicaidId !== csvMedicaidId) {
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'conflict', reason: `Existing Medicaid ID: ${match.medicaidId}`, clientId: match.id, existingMedicaidId: match.medicaidId })
        skipped++
      } else {
        await db.update(clients).set({ medicaidId: csvMedicaidId, updatedAt: new Date() }).where(and(eq(clients.id, match.id), eq(clients.companyId, companyId)))
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'updated', clientId: match.id }); updated++
      }
    }
    return one(c, { total: csvRows.length, matched, updated, skipped, noMatch, results })
  })

  // DELETE /api/clients/:id — deactivates.
  app.delete('/:id', requirePermission('care-clients:delete'), async (c) => {
    const { companyId } = who(c)
    const [client] = await db.update(clients).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(clients.id, c.req.param('id')), eq(clients.companyId, companyId))).returning({ id: clients.id })
    return client ? done(c, 'Client deactivated') : fail(c, 404, 'Client not found')
  })

  return app
}
