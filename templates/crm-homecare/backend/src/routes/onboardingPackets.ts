// Onboarding packets — the office's queue (ported from CVHC routes/onboardingPacketsRoutes.js,
// admin half). The new hire's tokenized side is routes/onboardingPacketsPublic.ts.
//
// Gusto: Gusto offers no API for an agency to create employees, so the office downloads a prefilled
// Gusto import CSV, uploads it in Gusto, then marks the caregiver synced here. The sync is recorded on
// gusto_employee_map (the template's Gusto table), not on users.
import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { onboardingPackets, onboardingPacketEvents, users, gustoEmployeeMap } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { logPacketEvent, newPacketToken, packetUrl, PACKET_TTL_MS, submitPacketToWorcs } from '../services/onboardingPackets.ts'
import { sendOnboardingPacketInvite } from '../services/staffEmails.ts'
import { getAgencyProfile, isWisconsin } from '../services/agencyProfile.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

const clientIp = (c: any) => (c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || '').split(',')[0].trim() || null

// Never sent to anyone: the token is the new hire's credential, the SSN is WORCS-bound.
function adminView(p: typeof onboardingPackets.$inferSelect) {
  const { token: _t, ssnTransientEncrypted, ...safe } = p
  // Signed, but WORCS has not accepted it yet: the office sees a "Retry WORCS" button.
  return { ...safe, worcsSubmissionPending: !!ssnTransientEncrypted && p.status === 'submitted' }
}

// GET /api/onboarding-packets?status=
app.get('/', async (c) => {
  const status = c.req.query('status')
  const rows = await db.select({
    packet: onboardingPackets,
    firstName: users.firstName, lastName: users.lastName, email: users.email,
    gustoEmployeeId: gustoEmployeeMap.gustoEmployeeId, gustoSyncedAt: gustoEmployeeMap.lastSyncedAt,
  })
    .from(onboardingPackets)
    .innerJoin(users, eq(users.id, onboardingPackets.caregiverId))
    .leftJoin(gustoEmployeeMap, eq(gustoEmployeeMap.userId, onboardingPackets.caregiverId))
    .where(status ? eq(onboardingPackets.status, status) : undefined)
    .orderBy(desc(onboardingPackets.createdAt))
  return c.json(rows.map(({ packet, ...rest }) => ({
    id: packet.id, status: packet.status, expiresAt: packet.expiresAt, openedAt: packet.openedAt,
    submittedAt: packet.submittedAt, bgcConsentSignedAt: packet.bgcConsentSignedAt,
    preferredName: packet.preferredName, legalFirstName: packet.legalFirstName, legalLastName: packet.legalLastName,
    createdAt: packet.createdAt, updatedAt: packet.updatedAt, caregiverId: packet.caregiverId,
    ...rest,
  })))
})

// GET /api/onboarding-packets/:id — full detail + the audit trail
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [r] = await db.select({
    packet: onboardingPackets,
    firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone,
    gustoEmployeeId: gustoEmployeeMap.gustoEmployeeId, gustoSyncedAt: gustoEmployeeMap.lastSyncedAt,
  })
    .from(onboardingPackets)
    .innerJoin(users, eq(users.id, onboardingPackets.caregiverId))
    .leftJoin(gustoEmployeeMap, eq(gustoEmployeeMap.userId, onboardingPackets.caregiverId))
    .where(eq(onboardingPackets.id, id))
  if (!r) return c.json({ error: 'Not found' }, 404)
  const events = await db.select().from(onboardingPacketEvents)
    .where(eq(onboardingPacketEvents.packetId, id))
    .orderBy(desc(onboardingPacketEvents.createdAt))
  const { packet, ...person } = r
  return c.json({ ...adminView(packet), ...person, events })
})

// POST /api/onboarding-packets/:id/resend — a fresh token (the old link stops working) + email
app.post('/:id/resend', async (c) => {
  const id = c.req.param('id')
  const [r] = await db.select({ packet: onboardingPackets, email: users.email, firstName: users.firstName })
    .from(onboardingPackets).innerJoin(users, eq(users.id, onboardingPackets.caregiverId))
    .where(eq(onboardingPackets.id, id))
  if (!r) return c.json({ error: 'Not found' }, 404)
  if (r.packet.status === 'submitted') return c.json({ error: 'Already submitted' }, 409)

  const token = newPacketToken()
  const expiresAt = new Date(Date.now() + PACKET_TTL_MS)
  await db.update(onboardingPackets).set({ token, expiresAt, status: 'sent', updatedAt: new Date() }).where(eq(onboardingPackets.id, id))
  await logPacketEvent(id, 'resent', { ip: clientIp(c), userAgent: c.req.header('user-agent') || null })

  const agency = await getAgencyProfile()
  sendOnboardingPacketInvite({ to: r.email, firstName: r.firstName, packetUrl: packetUrl(token), expiresAt, runsWorcs: isWisconsin(agency) })
    .catch((err) => console.error('[onboarding resend] email error:', err?.message))
  return c.json({ success: true })
})

// POST /api/onboarding-packets/:id/retry-worcs — re-send a signed packet whose automatic WORCS
// submission failed (the SSN is kept, encrypted, until a submission succeeds). Wisconsin only.
app.post('/:id/retry-worcs', async (c) => {
  const id = c.req.param('id')
  const [p] = await db.select({ id: onboardingPackets.id }).from(onboardingPackets).where(eq(onboardingPackets.id, id))
  if (!p) return c.json({ error: 'Not found' }, 404)
  const agency = await getAgencyProfile()
  if (!isWisconsin(agency)) return c.json({ error: 'WORCS background checks are only available to Wisconsin agencies.' }, 400)
  try {
    const r = await submitPacketToWorcs(id, { ip: clientIp(c), userAgent: c.req.header('user-agent') || null })
    return c.json({ success: true, ...r })
  } catch (err: any) {
    return c.json({ error: err?.message || 'WORCS submission failed' }, 400)
  }
})

// POST /api/onboarding-packets/:id/mark-gusto-synced — after the office copied the caregiver into Gusto
app.post('/:id/mark-gusto-synced', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as any
  const [p] = await db.select({ caregiverId: onboardingPackets.caregiverId }).from(onboardingPackets).where(eq(onboardingPackets.id, id))
  if (!p) return c.json({ error: 'Not found' }, 404)
  const user = c.get('user') as any
  const gustoEmployeeId = typeof body.gustoEmployeeId === 'string' && body.gustoEmployeeId.trim() ? body.gustoEmployeeId.trim() : null
  const now = new Date()
  await db.insert(gustoEmployeeMap)
    .values({ userId: p.caregiverId, gustoEmployeeId, isSynced: true, lastSyncedAt: now, syncedById: user?.userId || null })
    .onConflictDoUpdate({
      target: gustoEmployeeMap.userId,
      set: { gustoEmployeeId, isSynced: true, lastSyncedAt: now, syncedById: user?.userId || null },
    })
  return c.json({ success: true })
})

// GET /api/onboarding-packets/:id/gusto-export.csv — Gusto's employee import, prefilled for this hire
app.get('/:id/gusto-export.csv', async (c) => {
  const id = c.req.param('id')
  const [r] = await db.select({
    packet: onboardingPackets,
    firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone,
    defaultPayRate: users.defaultPayRate, hireDate: users.hireDate,
  }).from(onboardingPackets).innerJoin(users, eq(users.id, onboardingPackets.caregiverId)).where(eq(onboardingPackets.id, id))
  if (!r) return c.json({ error: 'Not found' }, 404)
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

export default app
