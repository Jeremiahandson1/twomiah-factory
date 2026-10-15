// One job application, from the public careers form or typed in by the office (ported from CVHC
// routes/applicationsRoutes.js POST /). Both doors take the same shape and write the same row.
//
// Accepts the full application or the short "express interest" form (name, email/phone, city,
// availability, experience). Booleans arrive as 'yes' or true. Multi-selects arrive as arrays.
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { applications, jobPostings } from '../../db/schema.ts'

const yes = (v: unknown) => v === 'yes' || v === true
const str = (v: unknown, max = 2000) => {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}
const isoDate = (v: unknown) => {
  const s = str(v, 40)
  if (!s) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T12:00:00Z').getTime()) ? s : undefined
}
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : (v ? [String(v).trim()].filter(Boolean) : [])

export type IntakeResult = { ok: true; id: string; firstName: string; lastName: string; createdAt: Date } | { ok: false; status: 400; error: string }

export async function createApplication(body: any): Promise<IntakeResult> {
  const firstName = str(body.firstName, 200)
  const lastName = str(body.lastName, 200)
  if (!firstName || !lastName) return { ok: false, status: 400, error: 'Name is required.' }
  const email = str(body.email, 255)?.toLowerCase() || null
  const phone = str(body.phone, 40)
  if (!email && !phone) return { ok: false, status: 400, error: 'Email or phone is required so we can follow up.' }

  const dob = isoDate(body.dob ?? body.dateOfBirth)
  const startDate = isoDate(body.startDate ?? body.availableStartDate)
  if (dob === undefined) return { ok: false, status: 400, error: 'Date of birth is not a valid date.' }
  if (startDate === undefined) return { ok: false, status: 400, error: 'Start date is not a valid date.' }

  const yearsRaw = body.yearsExperience
  const years = yearsRaw === undefined || yearsRaw === null || yearsRaw === '' ? 0 : parseInt(String(yearsRaw), 10)
  if (!Number.isFinite(years) || years < 0 || years > 80) return { ok: false, status: 400, error: 'Years of experience must be a whole number.' }

  // Resolve the posting by slug when no id is given; only an open, published posting counts.
  let postingId: string | null = str(body.postingId, 100)
  if (postingId) {
    const [p] = await db.select({ id: jobPostings.id }).from(jobPostings).where(eq(jobPostings.id, postingId)).limit(1)
    if (!p) postingId = null
  } else if (body.postingSlug) {
    const [p] = await db.select({ id: jobPostings.id }).from(jobPostings).where(and(
      eq(jobPostings.slug, String(body.postingSlug)),
      eq(jobPostings.isPublished, true),
      or(isNull(jobPostings.closesAt), gt(jobPostings.closesAt, new Date())),
    )).limit(1)
    postingId = p?.id || null
  }

  const certifications = list(body.certifications)
  const certsLower = certifications.map((c) => c.toLowerCase())
  const references = [1, 2].map((n) => ({
    name: str(body[`ref${n}Name`], 255),
    relationship: str(body[`ref${n}Relationship`], 100),
    phone: str(body[`ref${n}Phone`], 40),
    email: str(body[`ref${n}Email`], 255),
  })).filter((r) => r.name || r.phone || r.email)

  const additionalInfo = str(body.additionalInfo, 5000)
  const [row] = await db.insert(applications).values({
    firstName, lastName, email, phone,
    address: str(body.address, 255), city: str(body.city, 120),
    state: str(body.state, 2)?.toUpperCase() || null, zip: str(body.zip, 10),
    dateOfBirth: dob,
    hasDriversLicense: yes(body.driversLicense),
    hasTransportation: yes(body.transportation),
    legalToWork: yes(body.legalToWork),
    willingBackgroundCheck: yes(body.backgroundCheck),
    felonyConviction: yes(body.felony),
    felonyExplanation: str(body.felonyExplanation, 5000),
    yearsExperience: years,
    cnaLicense: str(body.cnaLicense, 100),
    certifications,
    hasCna: certsLower.includes('cna') || !!str(body.cnaLicense, 100),
    hasLpn: certsLower.includes('lpn'),
    hasRn: certsLower.includes('rn'),
    hasCpr: certsLower.includes('cpr'),
    hasFirstAid: certsLower.includes('first aid'),
    previousEmployer: str(body.previousEmployer, 255),
    reasonForLeaving: str(body.reasonForLeaving, 2000),
    availabilityDays: list(body.availability).join(',') || null,
    availabilityShifts: list(body.shifts).join(',') || null,
    hoursDesired: str(body.hoursDesired, 100),
    availableStartDate: startDate,
    references,
    // The express-interest form puts its only free-text field in additionalInfo.
    whyInterested: str(body.whyInterested, 5000) || (body.source === 'express-interest' ? additionalInfo : null),
    notes: additionalInfo,
    status: 'new',
    postingId,
  }).returning({ id: applications.id, firstName: applications.firstName, lastName: applications.lastName, createdAt: applications.createdAt })

  // Best-effort counter bump; never fail the submission over it.
  if (postingId) {
    await db.update(jobPostings).set({ applicationsCount: sql`${jobPostings.applicationsCount} + 1` })
      .where(eq(jobPostings.id, postingId))
      .catch((err) => console.error('[applications] bump posting counter:', err?.message))
  }
  return { ok: true, ...row }
}
