// Caregivers: the agency's caregiver records — the list, one caregiver's file, creating and editing one, their
// certifications, training and background checks, availability and blackout dates, IVR PIN, password and the
// office-login list. Moved from templates/crm-homecare/backend/src/routes/caregivers.ts (mounted at /api/caregivers and,
// by the same router, /api/users).
//
// A caregiver is a row of the app's `user` table in the agency's company (RULEBOOK §4). The CRM's shared team module
// (/api/company/users) is the CRM's own and stays so; these are home care's caregiver screens.
//
// Changes from the template:
//   · every read and write is the signed-in person's company's; a caregiver created here carries the company and the
//     unified caregiver role, `field` (moved tenants keep `caregiver`; both are read as a caregiver);
//   · replies are camelCase (the template converted them to snake_case) and lists are { data, pagination };
//   · requireAdmin became the care-hr permission of the action; office logins (an admin seat, Make Admin, a password
//     reset) are the team permission, which only the owner can grant beyond admin, so a care-hr grant can't mint an
//     admin or take one over;
//   · the create and edit write only the caregiver's own columns: the template spread the body into the user row, so
//     a body could set its company, its permission grants, its refresh/reset token or its IVR PIN.
import { Hono } from 'hono'
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, notInArray, or } from 'drizzle-orm'
import {
  user, caregiverProfiles, caregiverAvailability, clientAssignments, clients, backgroundChecks,
  notificationPreferences, certificationRecords, trainingRecords, caregiverTimeOff, timeEntries, caregiverRates,
} from '../../../db/schema/index.ts'
import { CAREGIVER_ROLES, caregiverClientsServed, caregiverVisitTotals, descNullsLast } from '../../../data/homecareHrRoutes.ts'
import { caregiverPatterns, movedInShifts } from '../../../data/homecareScheduling.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one, done } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { requireAdminOrSelf } from '../core/selfService.ts'
import { DEFAULT_WORKING_DAY } from '../core/workingDay.ts'
import { all, body, companyOf, dayOrNull, holds, me, personInCompany, idOf, insertSeatedUser } from './shared.ts'

// Pay is the office's: default_pay_rate (and an assignment's pay_rate) go to whoever holds the payroll — a caregiver
// sees their own record's pay, never a colleague's.
const PAY_KEY = /(^|_)pay_?rate$|^payRate$|^defaultPayRate$/i
function stripPay(data: any): any {
  const strip = (v: any): any => Array.isArray(v) ? v.map(strip)
    : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).filter(([k]) => !PAY_KEY.test(k)).map(([k, x]) => [k, strip(x)]))
    : v
  return strip(data)
}

/** The caregiver's own columns on `user` that the office's caregiver form writes. Nothing else from a body reaches the row. */
const CAREGIVER_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'isActive', 'address', 'city', 'state', 'zip', 'latitude', 'longitude',
  'certifications', 'certificationsExpiry', 'defaultPayRate', 'hireDate', 'emergencyContactName', 'emergencyContactPhone',
] as const
const pickCaregiver = (b: any) => Object.fromEntries(CAREGIVER_FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]))
/** A related row's body without the keys that say whose and which row it is. */
const ownKeysOnly = (b: any) => {
  if (!b || typeof b !== 'object') return {}
  const { id: _i, companyId: _c, caregiverId: _g, createdAt: _ca, updatedAt: _ua, ...rest } = b
  return rest
}
/** A background check's body without its identity, its author or the encrypted columns. */
const checkFields = (b: any) => {
  const { ssnEncrypted: _s, driversLicenseEncrypted: _d, createdById: _cb, ...rest } = ownKeysOnly(b)
  return rest
}
const withoutSecrets = ({ ssnEncrypted: _, driversLicenseEncrypted: __, ...ch }: any) => ch

const certView = (r: typeof certificationRecords.$inferSelect) => ({
  ...r,
  certificationName: r.certificationType, issuer: r.issuingBody, issuedDate: r.issueDate, expirationDate: r.expiryDate,
})
const trainingView = (r: typeof trainingRecords.$inferSelect) => ({
  ...r,
  trainingType: r.trainingName, completionDate: r.completedDate, expirationDate: r.expiryDate,
})

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

export function createCaregiversRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission, requireAnyPermission } = d.permissions
  // The caregiver list is read by the office's screens and the schedule's (a caregiver sees their colleagues' names, as
  // the template allowed any signed-in person); pay comes off unless the reader holds the payroll.
  const mayList = requireAnyPermission(['care-hr:read', 'care-schedule:read'])
  const seesPay = (c: any) => holds(d, c, 'care-payroll:read')
  const isCaregiver = (companyId: string) => and(eq(user.companyId, companyId), inArray(user.role, CAREGIVER_ROLES))

  /**
   * The account owner's login is the owner's (Run 4): it holds the subscription, so nobody else may reset its password,
   * deactivate it, demote it or rewrite it. An owner may change any login, their own included.
   */
  async function refuseOwnerTarget(c: any, targetId: string | null | undefined): Promise<Response | null> {
    const actor = me(c)
    if (d.permissions.normalizeRole(actor?.role) === 'owner' || !targetId) return null
    const [target] = await d.db.select({ role: user.role }).from(user)
      .where(and(eq(user.id, targetId), eq(user.companyId, actor.companyId))).limit(1)
    if (target?.role !== 'owner') return null
    return fail(c, 403, "The account owner's login can only be changed by the owner.", 'owner_only')
  }

  // GET /api/caregivers
  app.get('/', mayList, async (c) => {
    const companyId = companyOf(c)
    const { search, isActive = 'true', page = '1', limit = '50' } = c.req.query()
    const pageN = Math.max(1, parseInt(page) || 1)
    const limitN = Math.max(1, parseInt(limit) || 50)
    const conditions: any[] = [isCaregiver(companyId)]
    if (isActive !== 'all') conditions.push(eq(user.isActive, isActive === 'true'))
    if (search) {
      conditions.push(or(
        ilike(user.firstName, '%' + search + '%'),
        ilike(user.lastName, '%' + search + '%'),
        ilike(user.email, '%' + search + '%'),
        ilike(user.phone, '%' + search + '%'),
      ))
    }
    const whereClause = and(...conditions)
    const [userRows, [{ value: total }]] = await Promise.all([
      d.db.select({
        id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone,
        isActive: user.isActive, hireDate: user.hireDate, defaultPayRate: user.defaultPayRate,
        certifications: user.certifications, certificationsExpiry: user.certificationsExpiry,
        // Home address + coordinates: the route optimizer plans each day from the caregiver's home.
        address: user.address, city: user.city, state: user.state, zip: user.zip,
        latitude: user.latitude, longitude: user.longitude,
      }).from(user).where(whereClause)
        .orderBy(desc(user.isActive), asc(user.lastName))
        .offset((pageN - 1) * limitN).limit(limitN),
      d.db.select({ value: count() }).from(user).where(whereClause),
    ])

    const ids = userRows.map((u: any) => u.id)
    const profileMap: Record<string, any> = {}
    const availabilityMap: Record<string, any> = {}
    if (ids.length > 0) {
      const [profileRows, availabilityRows] = await Promise.all([
        d.db.select({
          caregiverId: caregiverProfiles.caregiverId, npiNumber: caregiverProfiles.npiNumber, evvWorkerId: caregiverProfiles.evvWorkerId,
          availableMon: caregiverProfiles.availableMon, availableTue: caregiverProfiles.availableTue,
          availableWed: caregiverProfiles.availableWed, availableThu: caregiverProfiles.availableThu,
          availableFri: caregiverProfiles.availableFri, availableSat: caregiverProfiles.availableSat,
          availableSun: caregiverProfiles.availableSun,
        }).from(caregiverProfiles)
          .where(and(eq(caregiverProfiles.companyId, companyId), inArray(caregiverProfiles.caregiverId, ids))),
        d.db.select({
          caregiverId: caregiverAvailability.caregiverId, status: caregiverAvailability.status,
          maxHoursPerWeek: caregiverAvailability.maxHoursPerWeek,
        }).from(caregiverAvailability)
          .where(and(eq(caregiverAvailability.companyId, companyId), inArray(caregiverAvailability.caregiverId, ids))),
      ])
      for (const p of profileRows) profileMap[p.caregiverId] = p
      for (const a of availabilityRows) availabilityMap[a.caregiverId] = a
    }
    const rows = userRows.map((u: any) => ({ ...u, profile: profileMap[u.id] || null, availability: availabilityMap[u.id] || null }))
    return list(c, (await seesPay(c)) ? rows : stripPay(rows), { page: pageN, limit: limitN, total: Number(total) })
  })

  // GET /api/users/caregivers — every caregiver, for pickers. Before /:id.
  app.get('/caregivers', mayList, async (c) => {
    const { search, isActive = 'true' } = c.req.query()
    const conditions: any[] = [isCaregiver(companyOf(c))]
    if (isActive !== 'all') conditions.push(eq(user.isActive, isActive === 'true'))
    if (search) {
      conditions.push(or(
        ilike(user.firstName, '%' + search + '%'),
        ilike(user.lastName, '%' + search + '%'),
        ilike(user.email, '%' + search + '%'),
      ))
    }
    const rows = await d.db.select({
      id: user.id, firstName: user.firstName, lastName: user.lastName,
      email: user.email, phone: user.phone, role: user.role, isActive: user.isActive,
    }).from(user).where(and(...conditions)).orderBy(asc(user.lastName))
    return all(c, rows)
  })

  // GET /api/users/caregivers/:id — one caregiver's summary for the profile page's header.
  app.get('/caregivers/:id', mayList, async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    const [row] = await d.db.select({
      id: user.id, firstName: user.firstName, lastName: user.lastName,
      email: user.email, phone: user.phone, isActive: user.isActive, role: user.role,
      address: user.address, city: user.city, state: user.state, zip: user.zip, createdAt: user.createdAt,
    }).from(user).where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
    if (!row) return fail(c, 404, 'Caregiver not found')
    const [{ value: activeClients }] = await d.db.select({ value: count() }).from(clientAssignments)
      .where(and(eq(clientAssignments.companyId, companyId), eq(clientAssignments.caregiverId, id), eq(clientAssignments.status, 'active')))
    return one(c, { ...row, activeClients: Number(activeClients) })
  })

  // GET /api/users/admins — the office's logins: everyone who isn't a caregiver. The template's office was admin and
  // owner; the unified app adds the manager (and viewer) rungs, which listed as neither office nor caregiver. Before /:id.
  app.get('/admins', mayList, async (c) => {
    const companyId = companyOf(c)
    const { page = '1', limit = '50' } = c.req.query()
    const pageN = Math.max(1, parseInt(page) || 1)
    const limitN = Math.max(1, parseInt(limit) || 50)
    const whereClause = and(eq(user.companyId, companyId), notInArray(user.role, CAREGIVER_ROLES))
    const [rows, [{ value: total }]] = await Promise.all([
      d.db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, isActive: user.isActive, role: user.role })
        .from(user).where(whereClause).orderBy(asc(user.lastName)).offset((pageN - 1) * limitN).limit(limitN),
      d.db.select({ value: count() }).from(user).where(whereClause),
    ])
    return list(c, rows, { page: pageN, limit: limitN, total: Number(total) })
  })

  // POST /api/users/admins — an office login (always an admin; the body's role is never honoured).
  app.post('/admins', requirePermission('team:create'), async (c) => {
    const companyId = companyOf(c)
    const { firstName, lastName, email, phone, password } = await body(c)
    if (!firstName || !lastName || !email) return fail(c, 400, 'firstName, lastName and email are required')
    if (!password || String(password).length < 8) return fail(c, 400, 'Password must be at least 8 characters')
    const normalizedEmail = String(email).toLowerCase().trim()
    const [existing] = await d.db.select({ id: user.id }).from(user)
      .where(and(eq(user.email, normalizedEmail), eq(user.companyId, companyId))).limit(1)
    if (existing) return fail(c, 409, 'A user with that email already exists')
    const passwordHash = await Bun.password.hash(String(password), 'bcrypt')
    const seated = await insertSeatedUser(d, companyId, {
      firstName, lastName, email: normalizedEmail, phone: phone || null, passwordHash, role: 'admin',
    }, {
      id: user.id, firstName: user.firstName, lastName: user.lastName,
      email: user.email, phone: user.phone, role: user.role, isActive: user.isActive,
    })
    if ('refusal' in seated) return fail(c, 403, seated.refusal, 'seat_limit')
    return one(c, seated.row, 201)
  })

  // POST /api/users/convert-to-admin — "Make Admin" on a caregiver.
  app.post('/convert-to-admin', requirePermission('team:update'), async (c) => {
    const companyId = companyOf(c)
    const { userId } = await body(c)
    if (!userId) return fail(c, 400, 'userId required')
    // On the owner it would be a demotion (and the agency would lose its owner).
    const [target] = await d.db.select({ role: user.role }).from(user)
      .where(and(eq(user.id, String(userId)), eq(user.companyId, companyId))).limit(1)
    if (!target) return fail(c, 404, 'User not found')
    if (target.role === 'owner') return fail(c, 403, 'The account owner is already in the office — they cannot be made an admin.', 'owner_only')
    const [updated] = await d.db.update(user).set({ role: 'admin', updatedAt: new Date() })
      .where(and(eq(user.id, String(userId)), eq(user.companyId, companyId))).returning({ id: user.id, role: user.role })
    return one(c, updated)
  })

  // GET /api/caregivers/:id/summary — the Full Profile's overview: hours this month and week and ever, the average
  // visit, the clients served, the last ten visits, the schedule from today on, and — for the person themself or a
  // holder of the payroll — this month's approved pay and the base-rate history. The template's screen read this route
  // but no server ever answered it, so the overview was always empty (built in the move, 2026-10-19).
  //
  // Hours are finished visits (time entries clocked out), counted from the agency's midnight. Pay is what payroll pays
  // (core/payrollPay.ts — approved shift reviews from the 1st of the month to today), never hours × a rate, so the
  // figure on this card is the figure on the paycheck.
  app.get('/:id/summary', requireAdminOrSelf(d, 'id', 'care-hr:read'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    const [person] = await d.db.select({ id: user.id }).from(user).where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
    if (!person) return fail(c, 404, 'Caregiver not found')

    const tz = await core.time.timezone(companyId)
    const today = await core.time.today(companyId, tz)
    const monthStart = `${today.slice(0, 8)}01`
    const [{ from: monthFrom }, { from: weekFrom }] = await Promise.all([
      core.time.range(companyId, monthStart), core.time.range(companyId, await core.time.weekStart(companyId)),
    ])
    const own = (me(c)?.userId || me(c)?.id) === id
    const pay = own || (await seesPay(c))

    const [totals, served, recent, patterns, moved, payLines, rateRows] = await Promise.all([
      caregiverVisitTotals(d.db, companyId, id, monthFrom!, weekFrom!),
      caregiverClientsServed(d.db, companyId, id, tz),
      d.db.select({
        id: timeEntries.id, startTime: timeEntries.startTime, endTime: timeEntries.endTime,
        durationMinutes: timeEntries.durationMinutes, isComplete: timeEntries.isComplete,
        clientFirst: clients.firstName, clientLast: clients.lastName,
      }).from(timeEntries).leftJoin(clients, eq(clients.id, timeEntries.clientId))
        .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.caregiverId, id)))
        .orderBy(desc(timeEntries.startTime)).limit(10),
      caregiverPatterns(d.db, companyId, id, today, true),
      movedInShifts(d.db, companyId, id, today),
      pay ? core.payroll.payrollForRange(companyId, monthStart, today, { caregiverId: id }) : Promise.resolve([]),
      pay ? d.db.select({ id: caregiverRates.id, rate: caregiverRates.hourlyRate, effectiveDate: caregiverRates.effectiveDate, notes: caregiverRates.notes })
        .from(caregiverRates)
        .where(and(eq(caregiverRates.companyId, companyId), eq(caregiverRates.caregiverId, id), eq(caregiverRates.rateType, 'base')))
        .orderBy(desc(caregiverRates.effectiveDate)) : Promise.resolve([]),
    ])

    const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100
    // From today on: a weekly pattern still running, a one-time visit not yet past, and days moved onto this caregiver.
    const schedule = [...patterns.filter((s: any) => s.dayOfWeek != null || (s.date && s.date >= today)), ...moved]
      .filter((s: any) => !s.suspendedFrom || s.suspendedFrom > today)
      .map((s: any) => {
        const [sh, sm] = String(s.startTime || '').split(':').map(Number)
        const [eh, em] = String(s.endTime || '').split(':').map(Number)
        const minutes = [sh, sm, eh, em].every(Number.isFinite) ? (eh * 60 + em) - (sh * 60 + sm) : null
        return {
          id: s.id, dayOfWeek: s.dayOfWeek ?? null, date: s.date ?? null, startTime: s.startTime, endTime: s.endTime,
          shiftHours: minutes != null && minutes > 0 ? hours(minutes) : null,
          clientFirst: s.clientFirstName, clientLast: s.clientLastName, clientAddress: s.clientAddress ?? null, clientCity: s.clientCity ?? null,
          notes: s.notes ?? null,
        }
      })

    return one(c, {
      earnings: {
        hoursThisMonth: hours(totals.monthMinutes),
        hoursThisWeek: hours(totals.weekMinutes),
        totalHours: hours(totals.totalMinutes),
        avgShiftHours: totals.visits ? hours(totals.totalMinutes / totals.visits) : 0,
        ...(pay ? { earningsThisMonth: payLines[0]?.grossPay ?? 0 } : {}),
      },
      clients: served.map((r: any) => ({ ...r, totalHours: hours(Number(r.totalMinutes) || 0) })),
      recentShifts: recent.map((e: any) => ({
        id: e.id, clientFirst: e.clientFirst, clientLast: e.clientLast, startTime: e.startTime, endTime: e.endTime,
        hours: e.durationMinutes != null ? hours(Number(e.durationMinutes)) : null, isComplete: e.isComplete,
      })),
      schedule,
      ...(pay ? { payRates: rateRows } : {}),
    })
  })

  // GET /api/caregivers/:id — the full file (assignments, background checks, pay): the office's, or the person's own.
  app.get('/:id', requireAdminOrSelf(d, 'id', 'care-hr:read'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    const [row] = await d.db.select({
      id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone,
      isActive: user.isActive, hireDate: user.hireDate, defaultPayRate: user.defaultPayRate,
      address: user.address, city: user.city, state: user.state, zip: user.zip,
      latitude: user.latitude, longitude: user.longitude,
      certifications: user.certifications, certificationsExpiry: user.certificationsExpiry,
      emergencyContactName: user.emergencyContactName, emergencyContactPhone: user.emergencyContactPhone,
      ivrPin: user.ivrPin,
    }).from(user).where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
    if (!row) return fail(c, 404, 'Caregiver not found')

    const [profileRows, availabilityRows, assignRows, bgRows] = await Promise.all([
      d.db.select().from(caregiverProfiles).where(and(eq(caregiverProfiles.companyId, companyId), eq(caregiverProfiles.caregiverId, id))).limit(1),
      d.db.select().from(caregiverAvailability).where(and(eq(caregiverAvailability.companyId, companyId), eq(caregiverAvailability.caregiverId, id))).limit(1),
      d.db.select({
        id: clientAssignments.id, clientId: clientAssignments.clientId, caregiverId: clientAssignments.caregiverId,
        assignmentDate: clientAssignments.assignmentDate, hoursPerWeek: clientAssignments.hoursPerWeek,
        payRate: clientAssignments.payRate, status: clientAssignments.status, notes: clientAssignments.notes,
        createdAt: clientAssignments.createdAt, updatedAt: clientAssignments.updatedAt,
        clientFirstName: clients.firstName, clientLastName: clients.lastName, clientAddress: clients.address, clientCity: clients.city,
      }).from(clientAssignments)
        .leftJoin(clients, eq(clientAssignments.clientId, clients.id))
        .where(and(eq(clientAssignments.companyId, companyId), eq(clientAssignments.caregiverId, id), eq(clientAssignments.status, 'active'))),
      d.db.select().from(backgroundChecks)
        .where(and(eq(backgroundChecks.companyId, companyId), eq(backgroundChecks.caregiverId, id)))
        .orderBy(desc(backgroundChecks.createdAt)).limit(5),
    ])
    const assignments = assignRows.map(({ clientFirstName, clientLastName, clientAddress, clientCity, ...a }: any) => ({
      ...a, client: { firstName: clientFirstName, lastName: clientLastName, address: clientAddress, city: clientCity },
    }))
    const record = {
      ...row,
      profile: profileRows[0] || null,
      availability: availabilityRows[0] || null,
      assignments,
      backgroundChecks: bgRows.map(withoutSecrets),
    }
    const own = (me(c)?.userId || me(c)?.id) === id
    return one(c, own || (await seesPay(c)) ? record : stripPay(record))
  })

  // POST /api/caregivers
  app.post('/', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const b = await body(c)
    const { password, profile } = b
    const data: any = pickCaregiver(b)
    // H-01: a login into a PHI system — a real password minimum, and no shared default.
    if (!password || String(password).length < 8) return fail(c, 400, 'Password must be at least 8 characters')
    // H-11: a usable 400/409 instead of a bare 500 on a missing/duplicate email.
    if (!data.firstName || !data.lastName || !data.email) return fail(c, 400, 'First name, last name and email are required')
    const email = String(data.email).toLowerCase().trim()
    const [dupe] = await d.db.select({ id: user.id }).from(user).where(and(eq(user.email, email), eq(user.companyId, companyId))).limit(1)
    if (dupe) return fail(c, 409, 'A user with that email already exists')
    const passwordHash = await Bun.password.hash(String(password), 'bcrypt')

    const seated = await insertSeatedUser(d, companyId, { ...data, email, passwordHash, role: 'field' })
    if ('refusal' in seated) return fail(c, 403, seated.refusal, 'seat_limit')
    const caregiver = seated.row
    const [profileRecord] = await d.db.insert(caregiverProfiles).values({ ...ownKeysOnly(profile), caregiverId: caregiver.id, companyId }).returning()
    const [availabilityRecord] = await d.db.insert(caregiverAvailability).values({ caregiverId: caregiver.id, companyId }).returning()
    await d.db.insert(notificationPreferences).values({ userId: caregiver.id, companyId })

    return one(c, {
      id: caregiver.id, email: caregiver.email, firstName: caregiver.firstName, lastName: caregiver.lastName,
      phone: caregiver.phone, isActive: caregiver.isActive, role: caregiver.role,
      defaultPayRate: String(profile?.defaultPayRate || data.defaultPayRate || '0'),
      profile: profileRecord, availability: availabilityRecord,
    }, 201)
  })

  // PUT /api/caregivers/:id
  app.put('/:id', requirePermission('care-hr:update'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    if (!(await personInCompany(d, companyId, id))) return fail(c, 404, 'Caregiver not found')
    const ownerOnly = await refuseOwnerTarget(c, id)
    if (ownerOnly) return ownerOnly
    // role, the password hash and the row's identity are never written from the body: a role change is
    // convert-to-admin's, a password is `password` below.
    const b = await body(c)
    const { profile, availability, password, payRate } = b
    const data: any = pickCaregiver(b)
    if (payRate !== undefined && data.defaultPayRate === undefined) data.defaultPayRate = String(payRate)
    if (data.email) data.email = String(data.email).toLowerCase().trim()

    const mine = (t: any) => and(eq(t.companyId, companyId), eq(t.caregiverId, id))
    const updates: Promise<any>[] = [
      d.db.update(user).set({ ...data, updatedAt: new Date() }).where(and(eq(user.id, id), eq(user.companyId, companyId))),
    ]
    if (profile) {
      updates.push((async () => {
        const [existing] = await d.db.select({ id: caregiverProfiles.id }).from(caregiverProfiles).where(mine(caregiverProfiles)).limit(1)
        if (existing) await d.db.update(caregiverProfiles).set({ ...ownKeysOnly(profile), updatedAt: new Date() }).where(mine(caregiverProfiles))
        else await d.db.insert(caregiverProfiles).values({ ...ownKeysOnly(profile), caregiverId: id, companyId })
      })())
    }
    if (availability) {
      updates.push((async () => {
        const [existing] = await d.db.select({ id: caregiverAvailability.id }).from(caregiverAvailability).where(mine(caregiverAvailability)).limit(1)
        if (existing) await d.db.update(caregiverAvailability).set({ ...ownKeysOnly(availability), updatedAt: new Date() }).where(mine(caregiverAvailability))
        else await d.db.insert(caregiverAvailability).values({ ...ownKeysOnly(availability), caregiverId: id, companyId })
      })())
    }
    if (password) {
      const passwordHash = await Bun.password.hash(String(password), 'bcrypt')
      updates.push(d.db.update(user).set({ passwordHash, updatedAt: new Date() }).where(and(eq(user.id, id), eq(user.companyId, companyId))))
    }
    await Promise.all(updates)

    const [updated] = await d.db.select({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, isActive: user.isActive })
      .from(user).where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
    const [profileRow] = await d.db.select().from(caregiverProfiles).where(mine(caregiverProfiles)).limit(1)
    const [availabilityRow] = await d.db.select().from(caregiverAvailability).where(mine(caregiverAvailability)).limit(1)
    return one(c, { ...updated, profile: profileRow || null, availability: availabilityRow || null })
  })

  // GET /api/caregivers/:id/background-checks
  app.get('/:id/background-checks', requirePermission('care-hr:read'), async (c) => {
    const checks = await d.db.select().from(backgroundChecks)
      .where(and(eq(backgroundChecks.companyId, companyOf(c)), eq(backgroundChecks.caregiverId, idOf(c))))
      .orderBy(desc(backgroundChecks.createdAt))
    return all(c, checks.map(withoutSecrets))
  })

  // POST /api/caregivers/:id/background-checks
  app.post('/:id/background-checks', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    if (!(await personInCompany(d, companyId, id))) return fail(c, 404, 'Caregiver not found')
    const [check] = await d.db.insert(backgroundChecks)
      .values({ ...checkFields(await body(c)), caregiverId: id, createdById: me(c).userId, companyId })
      .returning()
    return one(c, withoutSecrets(check), 201)
  })

  // ── Certifications, training records and the latest background check, per caregiver ──────────
  // The paths the caregiver profile and Compliance screens call, answered with the field names those screens read.
  // Reads: the office, or the caregiver themself. Writes: the office.
  app.get('/:id/certifications', requireAdminOrSelf(d, 'id', 'care-hr:read'), async (c) => {
    const rows = await d.db.select().from(certificationRecords)
      .where(and(eq(certificationRecords.companyId, companyOf(c)), eq(certificationRecords.caregiverId, idOf(c))))
      .orderBy(desc(certificationRecords.expiryDate))
    return all(c, rows.map(certView))
  })

  app.post('/:id/certifications', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    const b = await body(c)
    const name = typeof b.certificationName === 'string' ? b.certificationName.trim() : ''
    if (!name) return fail(c, 400, 'Certification name is required')
    for (const k of ['issuedDate', 'expirationDate']) {
      if (b[k] && !dayOrNull(b[k])) return fail(c, 400, 'One of the dates is not a valid date.')
    }
    if (!(await personInCompany(d, companyId, id))) return fail(c, 404, 'Caregiver not found')
    const [row] = await d.db.insert(certificationRecords).values({
      companyId,
      caregiverId: id,
      certificationType: name,
      certificationNumber: b.certificationNumber || null,
      issuingBody: b.issuer || null,
      issueDate: dayOrNull(b.issuedDate),
      expiryDate: dayOrNull(b.expirationDate),
    }).returning()
    return one(c, certView(row), 201)
  })

  app.get('/:id/training-records', requireAdminOrSelf(d, 'id', 'care-hr:read'), async (c) => {
    const rows = await d.db.select().from(trainingRecords)
      .where(and(eq(trainingRecords.companyId, companyOf(c)), eq(trainingRecords.caregiverId, idOf(c))))
      .orderBy(desc(trainingRecords.completedDate))
    return all(c, rows.map(trainingView))
  })

  app.post('/:id/training-records', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    const b = await body(c)
    const type = typeof b.trainingType === 'string' ? b.trainingType.trim() : ''
    if (!type || !b.completionDate) return fail(c, 400, 'Training type and completion date are required')
    if (!dayOrNull(b.completionDate) || (b.expirationDate && !dayOrNull(b.expirationDate))) {
      return fail(c, 400, 'One of the dates is not a valid date.')
    }
    if (!(await personInCompany(d, companyId, id))) return fail(c, 404, 'Caregiver not found')
    const [row] = await d.db.insert(trainingRecords).values({
      companyId,
      caregiverId: id,
      trainingName: type,
      completedDate: b.completionDate,
      expiryDate: dayOrNull(b.expirationDate),
      certificationNumber: b.certificationNumber || null,
      provider: b.provider || null,
      status: b.status || 'completed',
      recordedById: me(c)?.userId || null,
    }).returning()
    return one(c, trainingView(row), 201)
  })

  // GET /api/caregivers/:id/background-check — the latest check. None on file is a 404 (the template answered null).
  app.get('/:id/background-check', requireAdminOrSelf(d, 'id', 'care-hr:read'), async (c) => {
    const [row] = await d.db.select().from(backgroundChecks)
      .where(and(eq(backgroundChecks.companyId, companyOf(c)), eq(backgroundChecks.caregiverId, idOf(c))))
      .orderBy(descNullsLast(backgroundChecks.initiatedDate))
      .limit(1)
    if (!row) return fail(c, 404, 'No background check on file', 'none_on_file')
    const safe = withoutSecrets(row)
    return one(c, { ...safe, checkDate: safe.initiatedDate, clearanceNumber: safe.referenceNumber })
  })

  // POST /api/caregivers/:id/background-check { checkDate, expirationDate, status, clearanceNumber, notes }
  app.post('/:id/background-check', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    const b = await body(c)
    if (!b.checkDate || !b.status) return fail(c, 400, 'Check date and status are required')
    if (!dayOrNull(b.checkDate) || (b.expirationDate && !dayOrNull(b.expirationDate))) return fail(c, 400, 'One of the dates is not a valid date.')
    if (!(await personInCompany(d, companyId, id))) return fail(c, 404, 'Caregiver not found')
    const [row] = await d.db.insert(backgroundChecks).values({
      companyId,
      caregiverId: id,
      initiatedDate: b.checkDate,
      expirationDate: dayOrNull(b.expirationDate),
      status: String(b.status),
      referenceNumber: b.clearanceNumber || null,
      notes: b.notes || null,
      createdById: me(c)?.userId || null,
    }).returning()
    return one(c, withoutSecrets(row), 201)
  })

  // ── Availability and blackout dates (the office edits anyone's; a caregiver only their own) ──────────
  // Blackout dates live in caregiver_time_off (type 'blackout'), the table /api/blackout-dates reads and deletes from.
  const availabilityOf = async (companyId: string, id: string) => {
    const [row] = await d.db.select().from(caregiverAvailability)
      .where(and(eq(caregiverAvailability.companyId, companyId), eq(caregiverAvailability.caregiverId, id))).limit(1)
    return row
  }

  app.get('/:id/availability', requireAdminOrSelf(d, 'id', 'care-schedule:read'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    if (!(await personInCompany(d, companyId, id))) return fail(c, 404, 'Caregiver not found')
    // First read creates the default week (Mon–Fri on the working day, weekends off).
    await d.db.insert(caregiverAvailability).values({
      companyId, caregiverId: id, status: 'available', maxHoursPerWeek: 40,
      ...Object.fromEntries(DAYS.slice(0, 5).flatMap((day) => [[`${day}Available`, true], [`${day}StartTime`, DEFAULT_WORKING_DAY.start], [`${day}EndTime`, DEFAULT_WORKING_DAY.end]])),
      saturdayAvailable: false, sundayAvailable: false,
    } as any).onConflictDoNothing({ target: caregiverAvailability.caregiverId })
    return one(c, await availabilityOf(companyId, id))
  })

  app.put('/:id/availability', requireAdminOrSelf(d, 'id', 'care-schedule:update'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    const b = await body(c)
    if (!(await personInCompany(d, companyId, id))) return fail(c, 404, 'Caregiver not found')
    const set: Record<string, unknown> = {}
    if (b.status !== undefined && b.status !== null && b.status !== '') set.status = String(b.status)
    if (b.maxHoursPerWeek !== undefined && b.maxHoursPerWeek !== null && String(b.maxHoursPerWeek).trim() !== '') {
      const h = Number(b.maxHoursPerWeek)
      if (!Number.isFinite(h) || h < 0 || h > 168) return fail(c, 400, 'Max hours per week must be a number from 0 to 168')
      set.maxHoursPerWeek = Math.round(h)
    }
    for (const day of DAYS) {
      if (typeof b[`${day}Available`] === 'boolean') set[`${day}Available`] = b[`${day}Available`]
      for (const k of ['StartTime', 'EndTime', 'PreferredStart', 'PreferredEnd']) {
        const key = `${day}${k}`
        if (!(key in b)) continue
        const v = b[key] === null || b[key] === undefined ? '' : String(b[key]).trim()
        if (v === '') { if (k.startsWith('Preferred')) set[key] = null; continue }
        if (!HHMM_RE.test(v)) return fail(c, 400, `${day[0].toUpperCase()}${day.slice(1)} times must look like 08:00`)
        set[key] = v
      }
    }
    await d.db.insert(caregiverAvailability).values({ companyId, caregiverId: id } as any).onConflictDoNothing({ target: caregiverAvailability.caregiverId })
    if (Object.keys(set).length) {
      await d.db.update(caregiverAvailability).set({ ...set, updatedAt: new Date() } as any)
        .where(and(eq(caregiverAvailability.companyId, companyId), eq(caregiverAvailability.caregiverId, id)))
    }
    return one(c, await availabilityOf(companyId, id))
  })

  const blackoutColumns = {
    id: caregiverTimeOff.id, caregiverId: caregiverTimeOff.caregiverId, startDate: caregiverTimeOff.startDate,
    endDate: caregiverTimeOff.endDate, reason: caregiverTimeOff.reason, status: caregiverTimeOff.status, createdAt: caregiverTimeOff.createdAt,
  }

  app.get('/:id/blackout-dates', requireAdminOrSelf(d, 'id', 'care-schedule:read'), async (c) => {
    const rows = await d.db.select(blackoutColumns).from(caregiverTimeOff)
      .where(and(eq(caregiverTimeOff.companyId, companyOf(c)), eq(caregiverTimeOff.caregiverId, idOf(c)), eq(caregiverTimeOff.type, 'blackout')))
      .orderBy(desc(caregiverTimeOff.startDate))
    return all(c, rows)
  })

  app.post('/:id/blackout-dates', requireAdminOrSelf(d, 'id', 'care-schedule:create'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    const b = await body(c)
    if (!b.startDate || !b.endDate) return fail(c, 400, 'startDate and endDate are required')
    if (!dayOrNull(b.startDate) || !dayOrNull(b.endDate)) return fail(c, 400, 'Dates must be YYYY-MM-DD')
    if (b.endDate < b.startDate) return fail(c, 400, 'The end date is before the start date')
    if (!(await personInCompany(d, companyId, id))) return fail(c, 404, 'Caregiver not found')
    const [row] = await d.db.insert(caregiverTimeOff).values({
      companyId, caregiverId: id, startDate: b.startDate, endDate: b.endDate, type: 'blackout', reason: b.reason || null,
    }).returning(blackoutColumns)
    return one(c, row, 201)
  })

  // PUT/POST /:id/reset-password — the UI calls both shapes across screens. A login's password is the team's.
  const resetUserPassword = async (c: any) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    if (!(await personInCompany(d, companyId, id))) return fail(c, 404, 'User not found')
    const ownerOnly = await refuseOwnerTarget(c, id)
    if (ownerOnly) return ownerOnly
    const { password } = await body(c)
    if (!password || String(password).length < 8) return fail(c, 400, 'Password must be at least 8 characters')
    const passwordHash = await Bun.password.hash(String(password), 'bcrypt')
    await d.db.update(user).set({ passwordHash, updatedAt: new Date() }).where(and(eq(user.id, id), eq(user.companyId, companyId)))
    return done(c)
  }
  app.put('/:id/reset-password', requirePermission('team:update'), resetUserPassword)
  app.post('/:id/reset-password', requirePermission('team:update'), resetUserPassword)

  // PATCH /api/caregivers/:id/toggle-active
  app.patch('/:id/toggle-active', requirePermission('care-hr:update'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    const ownerOnly = await refuseOwnerTarget(c, id)
    if (ownerOnly) return ownerOnly
    const [row] = await d.db.select({ isActive: user.isActive }).from(user).where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
    if (!row) return fail(c, 404, 'Caregiver not found')
    const [updated] = await d.db.update(user).set({ isActive: !row.isActive, updatedAt: new Date() })
      .where(and(eq(user.id, id), eq(user.companyId, companyId))).returning({ isActive: user.isActive })
    return one(c, { isActive: updated.isActive })
  })

  // POST /api/caregivers/:id/generate-ivr-pin — a unique 4-digit PIN
  app.post('/:id/generate-ivr-pin', requirePermission('care-hr:update'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    if (!(await personInCompany(d, companyId, id))) return fail(c, 404, 'Caregiver not found')
    // Every PIN in this database: ivr_pin is unique across the whole user table (the IVR finds the caller by it alone),
    // so a collision is checked against all of them. Only the PINs are read; none leaves the server.
    const existingPins = await d.db.select({ ivrPin: user.ivrPin }).from(user).where(isNotNull(user.ivrPin))
    const pinSet = new Set(existingPins.map((u: any) => u.ivrPin))
    let pin: string
    let attempts = 0
    do {
      pin = String(Math.floor(Math.random() * 9000 + 1000))
      attempts++
      if (attempts > 100) return fail(c, 500, 'Unable to generate unique PIN')
    } while (pinSet.has(pin))
    const [updated] = await d.db.update(user).set({ ivrPin: pin, updatedAt: new Date() })
      .where(and(eq(user.id, id), eq(user.companyId, companyId))).returning({ ivrPin: user.ivrPin })
    return one(c, { ivrPin: updated.ivrPin })
  })

  // DELETE /api/caregivers/:id/ivr-pin
  app.delete('/:id/ivr-pin', requirePermission('care-hr:update'), async (c) => {
    const companyId = companyOf(c)
    const id = idOf(c)
    const [updated] = await d.db.update(user).set({ ivrPin: null, updatedAt: new Date() })
      .where(and(eq(user.id, id), eq(user.companyId, companyId))).returning({ id: user.id })
    if (!updated) return fail(c, 404, 'Caregiver not found')
    return done(c)
  })

  return app
}
