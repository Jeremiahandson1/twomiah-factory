// The new hire's side of the onboarding packet (ported from CVHC routes/onboardingPacketsRoutes.js,
// public half). Mounted at /api/public/onboarding-packets; the token in the URL is the only
// credential, and index.ts rate-limits the mount.
//
//   GET  /:token          load the packet (marks it opened the first time)
//   PUT  /:token          save a draft (no consent, no SSN)
//   POST /:token/submit   sign the background-check consent and submit
//
// Wisconsin agencies: the submission also collects the SSN and submits the WORCS check in the
// background; the SSN is held encrypted only until WORCS accepts it, then nulled. Any other state:
// no SSN is asked for or stored — the consent is recorded and the office runs its own check.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { onboardingPackets, users } from '../../db/schema.ts'
import { encrypt, normalizeSSN, validateSSN } from '../utils/encryption.ts'
import { bgcDisclosure, logPacketEvent, submitPacketToWorcs, setLastWorcsSubmission } from '../services/onboardingPackets.ts'
import { getAgencyProfile, isWisconsin } from '../services/agencyProfile.ts'

const app = new Hono()

const clientIp = (c: any) => (c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || '').split(',')[0].trim() || null
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

async function findByToken(token: string) {
  const [r] = await db.select({ packet: onboardingPackets, firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(onboardingPackets).innerJoin(users, eq(users.id, onboardingPackets.caregiverId))
    .where(eq(onboardingPackets.token, token))
  return r || null
}

app.get('/:token', async (c) => {
  const r = await findByToken(c.req.param('token'))
  if (!r) return c.json({ error: 'Packet not found or already processed.' }, 404)
  const p = r.packet
  if (new Date(p.expiresAt) < new Date()) {
    if (p.status !== 'submitted') {
      await db.update(onboardingPackets).set({ status: 'expired', updatedAt: new Date() }).where(eq(onboardingPackets.id, p.id))
    }
    return c.json({ error: 'This link has expired. Please contact the office for a new one.' }, 410)
  }
  if (p.status === 'sent') {
    await db.update(onboardingPackets).set({ status: 'opened', openedAt: new Date(), updatedAt: new Date() }).where(eq(onboardingPackets.id, p.id))
    await logPacketEvent(p.id, 'opened', { ip: clientIp(c), userAgent: c.req.header('user-agent') || null })
  }
  const agency = await getAgencyProfile()
  const disclosure = bgcDisclosure(agency)
  // Only what the page needs — never the token's siblings (the encrypted SSN, the creator).
  return c.json({
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
  const body = await c.req.json().catch(() => ({})) as any
  const r = await findByToken(c.req.param('token'))
  if (!r) return c.json({ error: 'Packet not found.' }, 404)
  const p = r.packet
  if (new Date(p.expiresAt) < new Date()) return c.json({ error: 'This link has expired.' }, 410)
  if (p.status === 'submitted') return c.json({ error: 'This packet has already been submitted.' }, 409)
  await db.update(onboardingPackets).set({
    ...detailFields(body),
    status: p.status === 'opened' || p.status === 'sent' ? 'in_progress' : p.status,
    updatedAt: new Date(),
  }).where(eq(onboardingPackets.id, p.id))
  await logPacketEvent(p.id, 'saved_draft', { ip: clientIp(c), userAgent: c.req.header('user-agent') || null })
  return c.json({ success: true })
})

app.post('/:token/submit', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const agency = await getAgencyProfile()
  const runsWorcs = isWisconsin(agency)

  const signature = typeof body.bgcConsentSignature === 'string' ? body.bgcConsentSignature.trim() : ''
  if (!signature) return c.json({ error: 'Electronic signature is required to consent to the background check.' }, 400)
  if (!body.dateOfBirth) return c.json({ error: 'Date of birth is required to run the background check.' }, 400)
  if (!validDate(body.dateOfBirth)) return c.json({ error: 'Date of birth is not a valid date.' }, 400)
  if (runsWorcs && !validateSSN(body.ssn)) return c.json({ error: 'A valid 9-digit Social Security Number is required.' }, 400)
  const legalFirst = typeof body.legalFirstName === 'string' ? body.legalFirstName.trim() : ''
  const legalLast = typeof body.legalLastName === 'string' ? body.legalLastName.trim() : ''
  if (!legalFirst || !legalLast) return c.json({ error: 'Legal first and last name are required.' }, 400)

  const r = await findByToken(c.req.param('token'))
  if (!r) return c.json({ error: 'Packet not found.' }, 404)
  const p = r.packet
  if (new Date(p.expiresAt) < new Date()) return c.json({ error: 'This link has expired.' }, 410)
  if (p.status === 'submitted') return c.json({ error: 'This packet has already been submitted.' }, 409)

  const disclosure = bgcDisclosure(agency)
  const ssn = runsWorcs ? normalizeSSN(body.ssn) : null
  let encryptedSsn: string | null = null
  if (ssn) {
    try { encryptedSsn = encrypt(ssn) } catch (err: any) {
      console.error('[onboarding] SSN encryption unavailable:', err?.message)
      return c.json({ error: 'Submission failed. Please try again or contact the office.' }, 503)
    }
  }
  const ip = clientIp(c)
  const userAgent = c.req.header('user-agent') || null

  await db.update(onboardingPackets).set({
    ...detailFields(body),
    legalFirstName: legalFirst.slice(0, 120),
    legalLastName: legalLast.slice(0, 120),
    dateOfBirth: String(body.dateOfBirth),
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
  }).where(eq(onboardingPackets.id, p.id))

  await logPacketEvent(p.id, 'consent_signed', { ip, userAgent, metadata: { consent_version: disclosure.version } })
  await logPacketEvent(p.id, 'submitted', { ip, userAgent })

  // Fire and forget: never hold the new hire's response on an outside service. The 30-minute poll
  // picks the result up; if the submission itself fails the SSN stays encrypted and the office can
  // retry from the Onboarding queue (POST /api/onboarding-packets/:id/retry-worcs).
  if (runsWorcs && ssn) {
    setLastWorcsSubmission(submitPacketToWorcs(p.id, { ip, userAgent }).then(() => undefined).catch((err: any) => {
      console.error('[onboarding] WORCS submission failed (the office can retry):', err?.message)
    }))
  }

  return c.json({ success: true, message: 'Thank you — your onboarding packet has been submitted.' })
})

export default app
