// Onboarding packets: the office's queue (/api/onboarding-packets, care-hr) and the new hire's tokenized side
// (/api/public/onboarding-packets, public: the token in the URL is the only credential). Moved from
// templates/crm-homecare/backend/src/routes/{onboardingPackets,onboardingPacketsPublic}.ts; the packet service is
// core.onboarding.
//
// Gusto offers no API for an agency to create employees, so the office downloads a prefilled Gusto import CSV, uploads
// it in Gusto, then marks the caregiver synced here (gusto_employee_map).
//
// Wisconsin agencies: the submission also collects the SSN and submits the WORCS check in the background; the SSN is
// held encrypted only until WORCS accepts it, then nulled. Any other state: no SSN is asked for or stored.
//
// Changes: the office's queue is its company's; the public side finds the company from the packet itself; the public
// door is rate-limited inside its router (the template's index.ts limit: 60 requests per 15 minutes per address); the
// queue list is { data, pagination }.
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { onboardingPackets, onboardingPacketEvents, user, gustoEmployeeMap } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { createRateLimiter } from '../../../http/guards.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { encrypt, normalizeSSN, validateSSN } from '../core/encryption.ts'
import { isWisconsin } from '../core/agencyProfile.ts'
import { newPacketToken, packetUrl, PACKET_TTL_MS, bgcDisclosure } from '../core/onboardingPackets.ts'
import { all, body, clientIp, companyOf, me } from './shared.ts'

// Never sent to anyone: the token is the new hire's credential, the SSN is WORCS-bound.
function adminView(p: typeof onboardingPackets.$inferSelect) {
  const { token: _t, ssnTransientEncrypted, ...safe } = p
  // Signed, but WORCS has not accepted it yet: the office sees a "Retry WORCS" button.
  return { ...safe, worcsSubmissionPending: !!ssnTransientEncrypted && p.status === 'submitted' }
}

export function createOnboardingPacketsRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const ours = (companyId: string, id: string) => and(eq(onboardingPackets.id, id), eq(onboardingPackets.companyId, companyId))
  const gustoJoin = (companyId: string) => and(eq(gustoEmployeeMap.userId, onboardingPackets.caregiverId), eq(gustoEmployeeMap.companyId, companyId))

  // GET /api/onboarding-packets?status=
  app.get('/', requirePermission('care-hr:read'), async (c) => {
    const companyId = companyOf(c)
    const status = c.req.query('status')
    const rows = await d.db.select({
      packet: onboardingPackets,
      firstName: user.firstName, lastName: user.lastName, email: user.email,
      gustoEmployeeId: gustoEmployeeMap.gustoEmployeeId, gustoSyncedAt: gustoEmployeeMap.lastSyncedAt,
    })
      .from(onboardingPackets)
      .innerJoin(user, eq(user.id, onboardingPackets.caregiverId))
      .leftJoin(gustoEmployeeMap, gustoJoin(companyId))
      .where(and(eq(onboardingPackets.companyId, companyId), status ? eq(onboardingPackets.status, status) : undefined))
      .orderBy(desc(onboardingPackets.createdAt))
    return all(c, rows.map(({ packet, ...rest }: any) => ({
      id: packet.id, status: packet.status, expiresAt: packet.expiresAt, openedAt: packet.openedAt,
      submittedAt: packet.submittedAt, bgcConsentSignedAt: packet.bgcConsentSignedAt,
      preferredName: packet.preferredName, legalFirstName: packet.legalFirstName, legalLastName: packet.legalLastName,
      createdAt: packet.createdAt, updatedAt: packet.updatedAt, caregiverId: packet.caregiverId,
      ...rest,
    })))
  })

  // GET /api/onboarding-packets/:id — full detail + the audit trail
  app.get('/:id', requirePermission('care-hr:read'), async (c) => {
    const companyId = companyOf(c)
    const id = c.req.param('id')
    const [r] = await d.db.select({
      packet: onboardingPackets,
      firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone,
      gustoEmployeeId: gustoEmployeeMap.gustoEmployeeId, gustoSyncedAt: gustoEmployeeMap.lastSyncedAt,
    })
      .from(onboardingPackets)
      .innerJoin(user, eq(user.id, onboardingPackets.caregiverId))
      .leftJoin(gustoEmployeeMap, gustoJoin(companyId))
      .where(ours(companyId, id))
    if (!r) return fail(c, 404, 'Not found')
    const events = await d.db.select().from(onboardingPacketEvents)
      .where(and(eq(onboardingPacketEvents.companyId, companyId), eq(onboardingPacketEvents.packetId, id)))
      .orderBy(desc(onboardingPacketEvents.createdAt))
    const { packet, ...person } = r
    return one(c, { ...adminView(packet), ...person, events })
  })

  // POST /api/onboarding-packets/:id/resend — a fresh token (the old link stops working) + email
  app.post('/:id/resend', requirePermission('care-hr:update'), async (c) => {
    const companyId = companyOf(c)
    const id = c.req.param('id')
    const [r] = await d.db.select({ packet: onboardingPackets, email: user.email, firstName: user.firstName })
      .from(onboardingPackets).innerJoin(user, eq(user.id, onboardingPackets.caregiverId))
      .where(ours(companyId, id))
    if (!r) return fail(c, 404, 'Not found')
    if (r.packet.status === 'submitted') return fail(c, 409, 'Already submitted')

    const token = newPacketToken()
    const expiresAt = new Date(Date.now() + PACKET_TTL_MS)
    await d.db.update(onboardingPackets).set({ token, expiresAt, status: 'sent', updatedAt: new Date() }).where(ours(companyId, id))
    await core.onboarding.logPacketEvent(companyId, id, 'resent', { ip: clientIp(c), userAgent: c.req.header('user-agent') || null })

    const agency = await core.profile.getAgencyProfile(companyId)
    core.staffEmails.sendOnboardingPacketInvite(companyId, { to: r.email, firstName: r.firstName, packetUrl: packetUrl(token), expiresAt, runsWorcs: isWisconsin(agency) })
      .catch((err: any) => d.logger.error('[onboarding resend] email error', { error: err?.message }))
    return done(c)
  })

  // POST /api/onboarding-packets/:id/retry-worcs — re-send a signed packet whose automatic WORCS submission failed (the
  // SSN is kept, encrypted, until a submission succeeds). Wisconsin only.
  app.post('/:id/retry-worcs', requirePermission('care-hr:update'), async (c) => {
    const companyId = companyOf(c)
    const id = c.req.param('id')
    const [p] = await d.db.select({ id: onboardingPackets.id }).from(onboardingPackets).where(ours(companyId, id))
    if (!p) return fail(c, 404, 'Not found')
    const agency = await core.profile.getAgencyProfile(companyId)
    if (!isWisconsin(agency)) return fail(c, 400, 'WORCS background checks are only available to Wisconsin agencies.')
    try {
      const r = await core.onboarding.submitPacketToWorcs(companyId, id, { ip: clientIp(c), userAgent: c.req.header('user-agent') || null })
      return one(c, { success: true, ...r })
    } catch (err: any) {
      return fail(c, 400, err?.message || 'WORCS submission failed')
    }
  })

  // POST /api/onboarding-packets/:id/mark-gusto-synced — after the office copied the caregiver into Gusto
  app.post('/:id/mark-gusto-synced', requirePermission('care-hr:update'), async (c) => {
    const companyId = companyOf(c)
    const b = await body(c)
    const [p] = await d.db.select({ caregiverId: onboardingPackets.caregiverId }).from(onboardingPackets).where(ours(companyId, c.req.param('id')))
    if (!p) return fail(c, 404, 'Not found')
    const syncedById = me(c)?.userId || null
    const gustoEmployeeId = typeof b.gustoEmployeeId === 'string' && b.gustoEmployeeId.trim() ? b.gustoEmployeeId.trim() : null
    const now = new Date()
    await d.db.insert(gustoEmployeeMap)
      .values({ companyId, userId: p.caregiverId, gustoEmployeeId, isSynced: true, lastSyncedAt: now, syncedById })
      .onConflictDoUpdate({
        target: gustoEmployeeMap.userId,
        set: { gustoEmployeeId, isSynced: true, lastSyncedAt: now, syncedById },
      })
    return done(c)
  })

  // GET /api/onboarding-packets/:id/gusto-export.csv — Gusto's employee import, prefilled for this hire
  app.get('/:id/gusto-export.csv', requirePermission('care-hr:read'), async (c) => {
    const [r] = await d.db.select({
      packet: onboardingPackets,
      firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone,
      defaultPayRate: user.defaultPayRate, hireDate: user.hireDate,
    }).from(onboardingPackets).innerJoin(user, eq(user.id, onboardingPackets.caregiverId)).where(ours(companyOf(c), c.req.param('id')))
    if (!r) return fail(c, 404, 'Not found')
    const p = r.packet
    const fld = (v: unknown) => {
      if (v === null || v === undefined) return ''
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = [
      'First Name', 'Middle Initial', 'Last Name', 'Email', 'Phone',
      'Street 1', 'City', 'State', 'Zip',
      'Date of Birth', 'Work Start Date', 'Employment Type',
      'Pay Type', 'Pay Rate', 'Compensation Currency',
    ]
    const row = [
      p.legalFirstName || r.firstName,
      (p.legalMiddleName || '').slice(0, 1),
      p.legalLastName || r.lastName,
      r.email, r.phone,
      p.address, p.city, p.state, p.zip,
      p.dateOfBirth, r.hireDate,
      'Employee', 'Hourly',
      r.defaultPayRate ?? '',
      'USD',
    ]
    const csv = headers.map(fld).join(',') + '\n' + row.map(fld).join(',') + '\n'
    const name = String(p.legalLastName || r.lastName || 'caregiver').toLowerCase().replace(/[^a-z0-9-]/g, '')
    return c.body(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gusto-import-${name || 'caregiver'}.csv"`,
    })
  })

  return app
}

// ── The new hire's side ─────────────────────────────────────────────────────────────────────
//   GET  /:token          load the packet (marks it opened the first time)
//   PUT  /:token          save a draft (no consent, no SSN)
//   POST /:token/submit   sign the background-check consent and submit

const opt = (v: unknown, max = 255) => {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}
const validDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v + 'T12:00:00Z').getTime())

// The fields both the draft save and the submit write.
function detailFields(b: any) {
  return {
    preferredName: opt(b.preferredName, 120),
    legalFirstName: opt(b.legalFirstName, 120),
    legalMiddleName: opt(b.legalMiddleName, 120),
    legalLastName: opt(b.legalLastName, 120),
    pronouns: opt(b.pronouns, 40),
    address: opt(b.address),
    city: opt(b.city, 120),
    state: opt(b.state, 2)?.toUpperCase() || null,
    zip: opt(b.zip, 10),
    dateOfBirth: validDate(b.dateOfBirth) ? String(b.dateOfBirth) : null,
    driversLicenseNumber: opt(b.driversLicenseNumber, 40),
    driversLicenseState: opt(b.driversLicenseState, 2)?.toUpperCase() || null,
    emergencyContactName: opt(b.emergencyContactName, 180),
    emergencyContactRelationship: opt(b.emergencyContactRelationship, 100),
    emergencyContactPhone: opt(b.emergencyContactPhone, 30),
    emergencyContactEmail: opt(b.emergencyContactEmail),
  }
}

export function createOnboardingPacketsPublicRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  // The tokenized packet: 60 requests per 15 minutes per address (the template's index.ts).
  app.use('*', createRateLimiter(15 * 60 * 1000, 60))

  /** The packet a token opens, with its new hire — and so its company. */
  async function findByToken(token: string) {
    const [r] = await d.db.select({ packet: onboardingPackets, firstName: user.firstName, lastName: user.lastName, email: user.email })
      .from(onboardingPackets)
      .innerJoin(user, and(eq(user.id, onboardingPackets.caregiverId), eq(user.companyId, onboardingPackets.companyId)))
      .where(eq(onboardingPackets.token, token))
    return r || null
  }
  const packetRow = (p: { id: string; companyId: string }) => and(eq(onboardingPackets.id, p.id), eq(onboardingPackets.companyId, p.companyId))

  app.get('/:token', async (c) => {
    const r = await findByToken(c.req.param('token'))
    if (!r) return fail(c, 404, 'Packet not found or already processed.')
    const p = r.packet
    if (new Date(p.expiresAt) < new Date()) {
      if (p.status !== 'submitted') {
        await d.db.update(onboardingPackets).set({ status: 'expired', updatedAt: new Date() }).where(packetRow(p))
      }
      return fail(c, 410, 'This link has expired. Please contact the office for a new one.')
    }
    if (p.status === 'sent') {
      await d.db.update(onboardingPackets).set({ status: 'opened', openedAt: new Date(), updatedAt: new Date() }).where(packetRow(p))
      await core.onboarding.logPacketEvent(p.companyId, p.id, 'opened', { ip: clientIp(c), userAgent: c.req.header('user-agent') || null })
    }
    const agency = await core.profile.getAgencyProfile(p.companyId)
    const disclosure = bgcDisclosure(agency)
    // Only what the page needs — never the token's siblings (the encrypted SSN, the creator).
    return one(c, {
      id: p.id,
      status: p.status === 'sent' ? 'opened' : p.status,
      firstName: r.firstName, lastName: r.lastName, email: r.email,
      expiresAt: p.expiresAt,
      preferredName: p.preferredName, legalFirstName: p.legalFirstName, legalMiddleName: p.legalMiddleName,
      legalLastName: p.legalLastName, pronouns: p.pronouns,
      address: p.address, city: p.city, state: p.state, zip: p.zip, dateOfBirth: p.dateOfBirth,
      driversLicenseNumber: p.driversLicenseNumber, driversLicenseState: p.driversLicenseState,
      emergencyContactName: p.emergencyContactName, emergencyContactRelationship: p.emergencyContactRelationship,
      emergencyContactPhone: p.emergencyContactPhone, emergencyContactEmail: p.emergencyContactEmail,
      bgcConsentSignedAt: p.bgcConsentSignedAt,
      bgcConsentVersion: disclosure.version,
      bgcDisclosureText: disclosure.text,
      submittedAt: p.submittedAt,
      // The page asks for the SSN only where it is used: the WORCS submission.
      requiresSsn: isWisconsin(agency),
      agencyName: agency.name,
      agencyPhone: agency.phone,
      agencyState: agency.state,
    })
  })

  app.put('/:token', async (c) => {
    const b = await body(c)
    const r = await findByToken(c.req.param('token'))
    if (!r) return fail(c, 404, 'Packet not found.')
    const p = r.packet
    if (new Date(p.expiresAt) < new Date()) return fail(c, 410, 'This link has expired.')
    if (p.status === 'submitted') return fail(c, 409, 'This packet has already been submitted.')
    await d.db.update(onboardingPackets).set({
      ...detailFields(b),
      status: p.status === 'opened' || p.status === 'sent' ? 'in_progress' : p.status,
      updatedAt: new Date(),
    }).where(packetRow(p))
    await core.onboarding.logPacketEvent(p.companyId, p.id, 'saved_draft', { ip: clientIp(c), userAgent: c.req.header('user-agent') || null })
    return done(c)
  })

  app.post('/:token/submit', async (c) => {
    const b = await body(c)
    const r = await findByToken(c.req.param('token'))
    // The checks below run in the template's order (signature, date of birth, SSN, legal name, then the packet), but
    // the agency — and so whether an SSN is asked for — is the packet's own company's, so the token is read first.
    const agency = r ? await core.profile.getAgencyProfile(r.packet.companyId) : null
    const runsWorcs = !!agency && isWisconsin(agency)

    const signature = typeof b.bgcConsentSignature === 'string' ? b.bgcConsentSignature.trim() : ''
    if (!signature) return fail(c, 400, 'Electronic signature is required to consent to the background check.')
    if (!b.dateOfBirth) return fail(c, 400, 'Date of birth is required to run the background check.')
    if (!validDate(b.dateOfBirth)) return fail(c, 400, 'Date of birth is not a valid date.')
    if (runsWorcs && !validateSSN(b.ssn)) return fail(c, 400, 'A valid 9-digit Social Security Number is required.')
    const legalFirst = typeof b.legalFirstName === 'string' ? b.legalFirstName.trim() : ''
    const legalLast = typeof b.legalLastName === 'string' ? b.legalLastName.trim() : ''
    if (!legalFirst || !legalLast) return fail(c, 400, 'Legal first and last name are required.')

    if (!r || !agency) return fail(c, 404, 'Packet not found.')
    const p = r.packet
    if (new Date(p.expiresAt) < new Date()) return fail(c, 410, 'This link has expired.')
    if (p.status === 'submitted') return fail(c, 409, 'This packet has already been submitted.')

    const disclosure = bgcDisclosure(agency)
    const ssn = runsWorcs ? normalizeSSN(b.ssn) : null
    let encryptedSsn: string | null = null
    if (ssn) {
      try { encryptedSsn = encrypt(ssn) } catch (err: any) {
        d.logger.error('[onboarding] SSN encryption unavailable', { error: err?.message })
        return fail(c, 503, 'Submission failed. Please try again or contact the office.')
      }
    }
    const ip = clientIp(c)
    const userAgent = c.req.header('user-agent') || null

    await d.db.update(onboardingPackets).set({
      ...detailFields(b),
      legalFirstName: legalFirst.slice(0, 120),
      legalLastName: legalLast.slice(0, 120),
      dateOfBirth: String(b.dateOfBirth),
      bgcConsentSignedAt: new Date(),
      bgcConsentSignature: signature.slice(0, 180),
      bgcConsentIp: ip,
      bgcConsentUserAgent: userAgent,
      bgcConsentVersion: disclosure.version,
      bgcConsentDisclosureText: disclosure.text,
      ssnTransientEncrypted: encryptedSsn,
      status: 'submitted',
      submittedAt: new Date(),
      updatedAt: new Date(),
    }).where(packetRow(p))

    await core.onboarding.logPacketEvent(p.companyId, p.id, 'consent_signed', { ip, userAgent, metadata: { consent_version: disclosure.version } })
    await core.onboarding.logPacketEvent(p.companyId, p.id, 'submitted', { ip, userAgent })

    // Fire and forget: never hold the new hire's response on an outside service. The 30-minute poll picks the result
    // up; if the submission itself fails the SSN stays encrypted and the office can retry from the Onboarding queue.
    if (runsWorcs && ssn) {
      core.onboarding.setLastWorcsSubmission(core.onboarding.submitPacketToWorcs(p.companyId, p.id, { ip, userAgent }).then(() => undefined).catch((err: any) => {
        d.logger.error('[onboarding] WORCS submission failed (the office can retry)', { error: err?.message })
      }))
    }

    return done(c, 'Thank you — your onboarding packet has been submitted.')
  })

  return app
}
