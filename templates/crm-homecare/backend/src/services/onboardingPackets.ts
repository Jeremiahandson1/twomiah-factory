// Post-hire onboarding packets (ported from CVHC routes/onboardingPacketsRoutes.js + the packet
// half of POST /api/applications/:id/hire). The packet is a tokenized link: the token is the only
// credential needed to open it, so it is 96 random hex characters and expires after 14 days.
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { backgroundChecks, onboardingPacketEvents, onboardingPackets } from '../../db/schema.ts'
import { decrypt } from '../utils/encryption.ts'
import { submitBackgroundCheck } from './worcsService.ts'
import { getAgencyProfile, isWisconsin, type AgencyProfile } from './agencyProfile.ts'
import { sendOnboardingPacketInvite } from './staffEmails.ts'

export const PACKET_TTL_MS = 14 * 24 * 60 * 60 * 1000
export const newPacketToken = () => randomBytes(48).toString('hex') // 96 chars
export const packetUrl = (token: string) => `${(process.env.FRONTEND_URL || '').replace(/\/+$/, '')}/onboarding/${token}`

// Bump the version whenever the disclosure wording changes — the signed text is stored verbatim.
export const BGC_CONSENT_VERSION_WI = '2026-04-v1'
export const BGC_CONSENT_VERSION_GENERAL = '2026-10-general-v1'

/**
 * The background-check disclosure the new hire signs. Wisconsin agencies get the Wisconsin Caregiver
 * Law text (WORCS, the Misconduct Registry); every other state gets the FCRA disclosure with no
 * Wisconsin references. The agency's own legal name is named as the requester.
 */
export function bgcDisclosure(agency: Pick<AgencyProfile, 'name' | 'legalName' | 'state'>): { version: string; text: string } {
  const who = agency.legalName || agency.name
  if (isWisconsin(agency)) {
    return {
      version: BGC_CONSENT_VERSION_WI,
      text: `
BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION (Wisconsin Caregiver)

In connection with my application or continued engagement with ${who}, I understand
that ${who} will request a consumer report and/or investigative consumer report about
me in accordance with the federal Fair Credit Reporting Act (15 U.S.C. § 1681 et seq.)
and applicable Wisconsin law including the Wisconsin Caregiver Law (Wis. Stat. §§ 50.065
and 48.685).

The report may include information from the Wisconsin Department of Justice
Online Record Check System (WORCS), the Wisconsin Caregiver Program Misconduct
Registry, the Nurse Aide Registry, the federal OIG exclusion list, and the
sex-offender registry. The information may concern my character, general
reputation, criminal history, driving record, professional licensure,
education, and employment.

I hereby authorize ${who} and its authorized agents to obtain such reports. I
understand I have the right, upon written request within a reasonable time,
to request disclosure of the nature and scope of any investigative consumer
report. I understand that if adverse action is taken against me wholly or
partly on the basis of the report, I will receive a copy of the report and a
summary of my rights under the FCRA before final action is taken.

By signing below I certify that all information I have provided in this
packet is true and complete.
`.trim(),
    }
  }
  return {
    version: BGC_CONSENT_VERSION_GENERAL,
    text: `
BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION (Caregiver)

In connection with my application or continued engagement with ${who}, I understand
that ${who} will request a consumer report and/or investigative consumer report about
me in accordance with the federal Fair Credit Reporting Act (15 U.S.C. § 1681 et seq.)
and the caregiver background check laws of the state where I will work.

The report may include criminal history records, state caregiver and nurse aide
registries, the federal OIG exclusion list, and the sex-offender registry. The
information may concern my character, general reputation, criminal history, driving
record, professional licensure, education, and employment.

I hereby authorize ${who} and its authorized agents to obtain such reports. I
understand I have the right, upon written request within a reasonable time,
to request disclosure of the nature and scope of any investigative consumer
report. I understand that if adverse action is taken against me wholly or
partly on the basis of the report, I will receive a copy of the report and a
summary of my rights under the FCRA before final action is taken.

By signing below I certify that all information I have provided in this
packet is true and complete.
`.trim(),
  }
}

export async function logPacketEvent(packetId: string, eventType: string, meta: { ip?: string | null; userAgent?: string | null; metadata?: unknown } = {}) {
  try {
    await db.insert(onboardingPacketEvents).values({
      packetId, eventType,
      ipAddress: meta.ip || null,
      userAgent: meta.userAgent || null,
      metadata: meta.metadata ?? null,
    })
  } catch (err: any) {
    console.error('[onboarding] event log error:', err?.message)
  }
}

// The WORCS client, swappable for tests. Production always uses the real one.
let submitWorcs: typeof submitBackgroundCheck = submitBackgroundCheck
export function __setWorcsSubmitForTests(fn: typeof submitBackgroundCheck | null) { submitWorcs = fn || submitBackgroundCheck }
// The latest background submission, so a test can await it instead of racing it.
let lastWorcsSubmission: Promise<void> = Promise.resolve()
export const setLastWorcsSubmission = (p: Promise<void>) => { lastWorcsSubmission = p }
export const awaitLastWorcsSubmission = () => lastWorcsSubmission

/**
 * Submit a signed packet's background check to WORCS: decrypt the transient SSN, submit, record a
 * background_checks row (worcs_reference_number is what the poll reads), then scrub the SSN.
 * Throws when there is nothing to submit or WORCS refuses; the SSN is kept for a retry then.
 */
export async function submitPacketToWorcs(packetId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const [p] = await db.select().from(onboardingPackets).where(eq(onboardingPackets.id, packetId))
  if (!p) throw new Error('Packet not found')
  if (p.status !== 'submitted' || !p.bgcConsentSignedAt) throw new Error('The packet has not been signed yet')
  const ssn = decrypt(p.ssnTransientEncrypted)
  if (!ssn) throw new Error('No SSN is on file for this packet — it was already submitted to WORCS, or never collected')
  if (!p.legalFirstName || !p.legalLastName || !p.dateOfBirth) throw new Error('Legal name and date of birth are required')

  const worcs: any = await submitWorcs({
    firstName: p.legalFirstName, lastName: p.legalLastName, dateOfBirth: String(p.dateOfBirth), ssn,
    requestPurpose: 'Caregiver-General',
  })
  const [check] = await db.insert(backgroundChecks).values({
    caregiverId: p.caregiverId,
    checkType: 'worcs',
    provider: 'WI DOJ WORCS',
    status: worcs.mock ? 'pending' : (worcs.status || 'pending'),
    worcsReferenceNumber: worcs.referenceNumber || null,
    worcsStatus: 'submitted',
    notes: worcs.mock
      ? 'Mock submission — WORCS credentials not configured in this environment.'
      : 'Submitted automatically after caregiver signed BGC consent.',
  }).returning({ id: backgroundChecks.id })
  await logPacketEvent(p.id, 'bgc_requested', { ...meta, metadata: { reference_number: worcs.referenceNumber, mock: !!worcs.mock } })
  // WORCS has it now; we do not need it.
  await db.update(onboardingPackets).set({ ssnTransientEncrypted: null, updatedAt: new Date() }).where(eq(onboardingPackets.id, p.id))
  return { backgroundCheckId: check.id, referenceNumber: worcs.referenceNumber || null, mock: !!worcs.mock }
}

/** Create a packet for a new hire and email the link. Email is best effort. */
export async function createPacketForHire(opts: { caregiverId: string; applicationId: string | null; createdById: string | null; email: string; firstName: string }) {
  const token = newPacketToken()
  const expiresAt = new Date(Date.now() + PACKET_TTL_MS)
  const [packet] = await db.insert(onboardingPackets).values({
    caregiverId: opts.caregiverId,
    applicationId: opts.applicationId,
    token, expiresAt, status: 'sent',
    createdById: opts.createdById,
  }).returning({ id: onboardingPackets.id })
  await logPacketEvent(packet.id, 'created')
  const url = packetUrl(token)
  const agency = await getAgencyProfile()
  sendOnboardingPacketInvite({ to: opts.email, firstName: opts.firstName, packetUrl: url, expiresAt, runsWorcs: isWisconsin(agency) })
    .then(() => logPacketEvent(packet.id, 'emailed'))
    .catch((err) => console.error('[onboarding packet email error]', err?.message))
  return { id: packet.id, url, expiresAt }
}
