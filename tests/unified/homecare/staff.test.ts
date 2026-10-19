// ADAPTED COPY of tests/homecare/staff.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 14 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// crm-homecare — staff: hiring, onboarding packets, background checks, Gusto, payday verification,
// performance reviews, training/certification records, server-side logout.
//
// Ported from the CVHC CRM (b2456a2). Expected numbers are CVHC's own rules run by hand:
//   · Gusto overtime: payable hours over 40 per SUNDAY–SATURDAY week, OT at 1.5x, $15 when no rate
//   · payday period: the latest Sun–Sat period whose Friday pay date has arrived
//   · performance: excellent 5 / satisfactory 3 / needs improvement 1
//   · eligibility: worst match wins — permanent_bar > rehab_review > advisory
//
// Real routes on Hono, PGlite built from the real migrations. The auth stub makes the identity a
// header; requireAdmin is the template's own rule.
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { eq, and } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import {
  agencies, users, clients, schedules, applications, applicationStatusHistory, jobPostings,
  onboardingPackets, onboardingPacketEvents, backgroundChecks, backgroundCheckDocuments,
  caregiverDisqualifiers, gustoEmployeeMap, payrollShiftReviews, payrollPeriodVerifications,
  notifications, performanceRatings, trainingRecords, timeEntries,
} from './db/schema.ts'

process.env.ENCRYPTION_KEY = 'a'.repeat(64)
process.env.FRONTEND_URL = 'https://staff-test.example'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

await setupSchema()

const [ag] = await db.insert(agencies).values({
  name: 'Lakeside Care', legalName: 'Lakeside Care Services LLC', slug: 'lakeside', state: 'WI', email: 'office@lakeside.test',
} as any).returning()
const mkUser = async (role: string, tag: string, extra: Record<string, unknown> = {}) => (await db.insert(users).values({
  email: `${tag}@staff.test`, passwordHash: 'x', firstName: tag[0].toUpperCase() + tag.slice(1), lastName: 'Tester', role, ...extra,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const caregiver = await mkUser('caregiver', 'carol', { defaultPayRate: '18.00' })
const other = await mkUser('caregiver', 'otto')
const [client] = await db.insert(clients).values({ firstName: 'Ruth', lastName: 'Client' } as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/applications', 'applications'],
  ['/api/job-postings', 'jobPostings'],
  ['/api/public/careers', 'careersPublic'],
  ['/api/onboarding-packets', 'onboardingPackets'],
  ['/api/public/onboarding-packets', 'onboardingPacketsPublic'],
  ['/api/background-checks', 'backgroundChecks'],
  ['/api/gusto', 'gusto'],
  ['/api/payroll-verification', 'payrollVerification'],
  ['/api/performance-reviews', 'performanceReviews'],
  ['/api/caregivers', 'caregivers'],
  ['/api/training-records', 'trainingRecords'],
  ['/api/certifications', 'certifications'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
const onboardingSvc = await import('./src/services/onboardingPackets.ts')
const worcsPoll = await import('./src/jobs/worcsPoll.ts')
const eligibility = await import('./src/services/eligibilityEngine.ts')
const payday = await import('./src/routes/payrollVerification.ts')
const revocation = await import('./src/services/tokenRevocation.ts')

const call = async (who: any, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const h: Record<string, string> = { 'content-type': 'application/json', ...headers }
  if (who) Object.assign(h, { 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role })
  const res = await app.request(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}; if (json && Array.isArray(json.data) && json.pagination) json = json.data /* unified: a list reply is { data, pagination } (RULEBOOK §3): this copy reads its rows, as the screens will */
  return { status: res.status, json, text, headers: res.headers }
}
const asAdmin = (m: string, p: string, b?: unknown) => call(admin, m, p, b)
const asCg = (m: string, p: string, b?: unknown) => call(caregiver, m, p, b)
const pub = (m: string, p: string, b?: unknown, h?: Record<string, string>) => call(null, m, p, b, h)

// ════════ the seed: Wisconsin's bar list, marked as Wisconsin's ═══════════════════════════════════
{
  const rows = (await import('../../server/crm/homecare/core/disqualifiers.ts')).DISQUALIFIERS as any[] /* unified: the bar list is code (core/disqualifiers.ts): a new agency's table was empty, so a disqualifying record read as review */
  check('the migration seeds the 28 Wisconsin disqualifiers', rows.length === 28, { n: rows.length })
  check('every seeded row is marked state WI', rows.every((r) => r.state === 'WI'))
  const perm = rows.filter((r) => r.severity === 'permanent_bar').length
  check('…15 permanent bars, 10 rehab-review, 3 advisory (CVHC v33)', perm === 15
    && rows.filter((r) => r.severity === 'rehab_review').length === 10
    && rows.filter((r) => r.severity === 'advisory').length === 3,
    { perm, rehab: rows.filter((r) => r.severity === 'rehab_review').length })
}

// ════════ job postings ════════════════════════════════════════════════════════════════════════════
let postingId = ''
let postingSlug = ''
{
  const cg = await asCg('POST', '/api/job-postings', { title: 'X', description: 'Y' })
  check('a caregiver cannot create a job posting', cg.status === 403, cg)
  const cgRead = await asCg('GET', '/api/job-postings')
  check('a caregiver cannot list the office postings', cgRead.status === 403, cgRead)

  const bad = await asAdmin('POST', '/api/job-postings', { title: 'Caregiver' })
  check('title AND description are required', bad.status === 400 && /Title and description/.test(bad.json?.error), bad.json)
  const badPay = await asAdmin('POST', '/api/job-postings', { title: 'A', description: 'B', payRangeMin: 'abc' })
  check('a non-numeric pay is refused, not saved', badPay.status === 400, badPay.json)
  const flipped = await asAdmin('POST', '/api/job-postings', { title: 'A', description: 'B', payRangeMin: 20, payRangeMax: 15 })
  check('pay max below pay min is refused', flipped.status === 400, flipped.json)

  const created = await asAdmin('POST', '/api/job-postings', {
    title: 'Caregiver — Lakeside Area!', description: 'Help clients at home.', payRangeMin: '16', payRangeMax: '19.5',
    employmentType: 'part_time', payRateUnit: 'hour',
  })
  check('the office creates a draft posting', created.status === 201 && created.json?.isPublished === false, created.json)
  check('slug is CVHC\'s slugify of the title', created.json?.slug === 'caregiver-lakeside-area', created.json?.slug)
  check('pay is stored as money', created.json?.payRangeMin === '16.00' && created.json?.payRangeMax === '19.50', created.json)
  check('publishedAt is empty on a draft', created.json?.publishedAt === null)
  postingId = created.json.id
  postingSlug = created.json.slug

  const dup = await asAdmin('POST', '/api/job-postings', { title: 'Caregiver — Lakeside Area!', description: 'Second' })
  check('a second posting with the same title gets a suffixed unique slug', dup.status === 201 && dup.json.slug.startsWith('caregiver-lakeside-area-') && dup.json.slug !== postingSlug, dup.json?.slug)

  let list = await pub('GET', '/api/public/careers/job-postings')
  check('a draft is not on the public careers list', list.status === 200 && Array.isArray(list.json) && list.json.length === 0, list.json)

  const pubd = await asAdmin('POST', `/api/job-postings/${postingId}/publish`)
  check('publish stamps publishedAt', pubd.status === 200 && pubd.json.isPublished && !!pubd.json.publishedAt, pubd.json)
  const firstPublishedAt = pubd.json.publishedAt
  list = await pub('GET', '/api/public/careers/job-postings')
  check('a published posting appears publicly', list.json.length === 1 && list.json[0].slug === postingSlug, list.json)
  check('…with no office-only fields (creator, counts)', !('createdById' in list.json[0]) && !('applicationsCount' in list.json[0]), Object.keys(list.json[0]))
  const one = await pub('GET', `/api/public/careers/job-postings/${postingSlug}`)
  check('the posting opens by slug', one.status === 200 && one.json.id === postingId, one.status)

  await asAdmin('POST', `/api/job-postings/${postingId}/unpublish`)
  const re = await asAdmin('POST', `/api/job-postings/${postingId}/publish`)
  check('re-publishing keeps the FIRST published date', re.json.publishedAt === firstPublishedAt, { a: firstPublishedAt, b: re.json.publishedAt })

  const edit = await asAdmin('PUT', `/api/job-postings/${postingId}`, { title: 'Caregiver — Lakeside Area!', description: 'Updated', payRangeMin: 17 })
  check('an edit with the same title keeps the slug', edit.json.slug === postingSlug, edit.json?.slug)

  const draftId = dup.json.id
  const closed = await asAdmin('POST', `/api/job-postings/${draftId}/close`)
  check('close sets closesAt and unpublishes', closed.status === 200 && !!closed.json.closesAt && closed.json.isPublished === false, closed.json)
  const closedPublic = await pub('GET', `/api/public/careers/job-postings/${dup.json.slug}`)
  check('a closed posting is not served publicly', closedPublic.status === 404, closedPublic.status)
  const closedTab = await asAdmin('GET', '/api/job-postings?status=closed')
  check('the Closed tab lists it', closedTab.json.some((p: any) => p.id === draftId), closedTab.json?.length)
}

// ════════ public apply ════════════════════════════════════════════════════════════════════════════
let appId = ''
{
  const bot = await pub('POST', '/api/public/careers/apply', { firstName: 'Bot', lastName: 'Net', email: 'b@x.test', botField: 'gotcha' })
  const botRows = await db.select().from(applications).where(eq(applications.firstName, 'Bot'))
  check('the honeypot answers success and stores nothing', bot.status === 200 && bot.json.success === true && botRows.length === 0, bot.json)
  const noName = await pub('POST', '/api/public/careers/apply', { email: 'a@x.test' })
  check('a nameless application is refused', noName.status === 400 && noName.json.error === 'Name is required.', noName.json)
  const noContact = await pub('POST', '/api/public/careers/apply', { firstName: 'A', lastName: 'B' })
  check('an application with neither email nor phone is refused', noContact.status === 400 && /Email or phone/.test(noContact.json.error), noContact.json)
  const badDob = await pub('POST', '/api/public/careers/apply', { firstName: 'A', lastName: 'B', phone: '555', dob: '13/45/1990' })
  check('a malformed date is refused, not a 500', badDob.status === 400, badDob.json)

  const full = await pub('POST', '/api/public/careers/apply', {
    firstName: 'Jamie', lastName: 'Applicant', email: 'Jamie.Applicant@Example.TEST', phone: '715-555-0100',
    address: '1 Main St', city: 'Lakeside', state: 'wi', zip: '54701', dob: '1990-05-01',
    driversLicense: 'yes', transportation: true, legalToWork: 'yes', backgroundCheck: 'yes', felony: 'no',
    yearsExperience: '3', cnaLicense: 'CNA-123', certifications: ['CNA', 'CPR'],
    previousEmployer: 'Old Agency', reasonForLeaving: 'Moved', availability: ['Mon', 'Tue'], shifts: ['Morning'],
    hoursDesired: '20-30', startDate: '2026-11-01',
    ref1Name: 'Pat Ref', ref1Relationship: 'Supervisor', ref1Phone: '555-1', ref1Email: 'pat@x.test',
    ref2Name: 'Sam Ref', ref2Relationship: 'Coworker', ref2Phone: '555-2',
    whyInterested: 'I love caregiving', additionalInfo: 'Available weekends', postingSlug,
  })
  check('a full application is accepted', full.status === 200 && full.json.success && !!full.json.applicationId, full.json)
  appId = full.json.applicationId
  const [row] = await db.select().from(applications).where(eq(applications.id, appId))
  check('email is stored lower-case', row.email === 'jamie.applicant@example.test', row.email)
  check('yes/true answers become booleans', row.hasDriversLicense && row.hasTransportation && row.legalToWork && row.willingBackgroundCheck && !row.felonyConviction)
  check('years of experience is a number', row.yearsExperience === 3, row.yearsExperience)
  check('certifications kept as a list, CNA/CPR flags set', JSON.stringify(row.certifications) === '["CNA","CPR"]' && row.hasCna && row.hasCpr && !row.hasRn, row.certifications)
  check('availability days and shifts joined with commas', row.availabilityDays === 'Mon,Tue' && row.availabilityShifts === 'Morning', row)
  check('start date lands in available_start_date', row.availableStartDate === '2026-11-01', row.availableStartDate)
  check('both references kept in `references`', Array.isArray(row.references) && (row.references as any[]).length === 2 && (row.references as any[])[0].name === 'Pat Ref', row.references)
  check('additional info lands in notes, why-interested in its column', row.notes === 'Available weekends' && row.whyInterested === 'I love caregiving', row)
  check('state is upper-cased', row.state === 'WI', row.state)
  check('the application is linked to the posting by slug', row.postingId === postingId, row.postingId)
  check('status starts as new', row.status === 'new', row.status)
  const [p] = await db.select().from(jobPostings).where(eq(jobPostings.id, postingId))
  check('the posting counter went to 1', p.applicationsCount === 1, p.applicationsCount)
  const listed = await asAdmin('GET', '/api/job-postings')
  check('the office list shows the live application count', listed.json.find((x: any) => x.id === postingId)?.applicationsCountLive === 1, listed.json)

  const express = await pub('POST', '/api/public/careers/apply', { firstName: 'Quick', lastName: 'Interest', phone: '555-9', source: 'express-interest', additionalInfo: 'Call me' })
  const [ex] = await db.select().from(applications).where(eq(applications.id, express.json.applicationId))
  check('express interest: the free text is also why-interested', ex.whyInterested === 'Call me' && ex.notes === 'Call me' && ex.postingId === null, ex)
}

// ════════ the office's application queue ══════════════════════════════════════════════════════════
{
  const cg = await asCg('GET', '/api/applications')
  check('a caregiver cannot read applications (DOB, felony answers)', cg.status === 403, cg.status)
  const cgOne = await asCg('GET', `/api/applications/${appId}`)
  check('…or one application', cgOne.status === 403, cgOne.status)
  const list = await asAdmin('GET', '/api/applications?status=new')
  check('the office lists new applications', list.status === 200 && list.json.length === 2, list.json?.length)
  const stats = await asAdmin('GET', '/api/applications/stats/summary')
  check('stats count totals by status', stats.json.total === 2 && stats.json.newCount === 2 && stats.json.last7Days === 2, stats.json)

  const hiredByStatus = await asAdmin('PUT', `/api/applications/${appId}/status`, { status: 'hired' })
  check('"hired" cannot be set as a status (only /hire creates the login)', hiredByStatus.status === 400 && /Hire as Caregiver/.test(hiredByStatus.json.error), hiredByStatus.json)
  const unknown = await asAdmin('PUT', `/api/applications/${appId}/status`, { status: 'applied' })
  check('an unknown status is refused', unknown.status === 400, unknown.json)
  const rev = await asAdmin('PUT', `/api/applications/${appId}/status`, { status: 'offered', notes: 'Strong interview' })
  check('the office moves an application along', rev.status === 200 && rev.json.application.status === 'offered', rev.json)
  const hist = await db.select().from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, appId))
  check('…and the change is in the status history with its note and who', hist.length === 1 && hist[0].notes === 'Strong interview' && hist[0].changedById === admin.id, hist)
  const [still] = await db.select().from(applications).where(eq(applications.id, appId))
  check('…without overwriting the applicant\'s own notes', still.notes === 'Available weekends', still.notes)

  await asAdmin('POST', `/api/applications/${appId}/notes`, { notes: 'First call went well' })
  const n2 = await asAdmin('POST', `/api/applications/${appId}/notes`, { notes: 'Second interview booked' })
  check('interview notes are appended, not replaced', /First call went well/.test(n2.json.application.interviewNotes) && /Second interview booked/.test(n2.json.application.interviewNotes), n2.json?.application?.interviewNotes)
  check('…each stamped with the date', /- \d{4}-\d{2}-\d{2}/.test(n2.json.application.interviewNotes))
  const emptyNote = await asAdmin('POST', `/api/applications/${appId}/notes`, { notes: '  ' })
  check('an empty note is refused', emptyNote.status === 400)

  const cgHire = await asCg('POST', `/api/applications/${appId}/hire`, {})
  check('a caregiver cannot hire', cgHire.status === 403)
  const badRate = await asAdmin('POST', `/api/applications/${appId}/hire`, { hourlyRate: 'lots' })
  check('a non-numeric rate is refused before anything is created', badRate.status === 400, badRate.json)
  const hire = await asAdmin('POST', `/api/applications/${appId}/hire`, { hourlyRate: 16.5 })
  check('hire creates the caregiver', hire.status === 200 && hire.json.success && !!hire.json.caregiverId, hire.json)
  // No email provider here (sendRaw's dev mode sends nothing), so the office is handed the password to pass on —
  // and told the email did not go. With a working provider it is not returned at all (hire-credentials.test.ts).
  check('…no email provider: the login was NOT emailed, so the temporary password comes back for the office', hire.json.credentialsEmailed === false && !!hire.json.tempPassword && /could not be sent/.test(hire.json.message), hire.json)
  check('…and reports the onboarding packet', hire.json.packetCreated === true && hire.json.packetUrl.startsWith('https://staff-test.example/onboarding/'), hire.json.packetUrl)
  const [u] = await db.select().from(users).where(eq(users.id, hire.json.caregiverId))
  check('the login is the lower-cased applicant email, role caregiver', u.email === 'jamie.applicant@example.test' && u.role === 'field', u) /* unified: a new caregiver's seat is the unified role field (moved tenants keep caregiver; both read as a caregiver) */
  check('the rate is the hire rate', u.defaultPayRate === '16.50', u.defaultPayRate)
  check('certifications carried to the caregiver', JSON.stringify(u.certifications) === '["CNA","CPR"]', u.certifications)
  check('the temp password is not CVHC-branded', !/CVHC/.test(hire.json.tempPassword), hire.json.tempPassword)
  const [after] = await db.select().from(applications).where(eq(applications.id, appId))
  check('the application is hired and points at the user', after.status === 'hired' && after.hiredUserId === u.id)
  const packets = await db.select().from(onboardingPackets).where(eq(onboardingPackets.caregiverId, u.id))
  check('one packet, sent, with a 96-character token, expiring in 14 days', packets.length === 1 && packets[0].status === 'sent' && packets[0].token.length === 96
    && Math.abs(new Date(packets[0].expiresAt).getTime() - Date.now() - 14 * 86400000) < 60000, packets[0])
  const again = await asAdmin('POST', `/api/applications/${appId}/hire`, {})
  check('the same applicant cannot be hired twice', again.status === 400, again.json)

  const dupApp = await pub('POST', '/api/public/careers/apply', { firstName: 'Jamie', lastName: 'Again', email: 'JAMIE.APPLICANT@example.test' })
  check('a re-application with the same email is allowed (CVHC v29)', dupApp.status === 200, dupApp.json)
  const dupHire = await asAdmin('POST', `/api/applications/${dupApp.json.applicationId}/hire`, {})
  check('…but hiring it is refused: that email already has a login, whatever its case', dupHire.status === 409, dupHire.json)
}

// ════════ the onboarding packet (Wisconsin agency) ════════════════════════════════════════════════
const [jamie] = await db.select().from(users).where(eq(users.email, 'jamie.applicant@example.test'))
let [packet] = await db.select().from(onboardingPackets).where(eq(onboardingPackets.caregiverId, jamie.id))
{
  const missing = await pub('GET', '/api/public/onboarding-packets/not-a-token')
  check('an unknown token is a 404', missing.status === 404)
  const open = await pub('GET', `/api/public/onboarding-packets/${packet.token}`, undefined, { 'x-forwarded-for': '203.0.113.9' })
  check('the new hire opens the packet', open.status === 200 && open.json.firstName === 'Jamie', open.json)
  check('Wisconsin: the page asks for the SSN (WORCS)', open.json.requiresSsn === true)
  check('the disclosure names the agency\'s legal name and the Wisconsin law', open.json.bgcDisclosureText.includes('Lakeside Care Services LLC') && /Wisconsin Caregiver Law/.test(open.json.bgcDisclosureText), open.json.bgcDisclosureText.slice(0, 200))
  check('no CVHC identity in the disclosure', !/Chippewa|CVHC/.test(open.json.bgcDisclosureText))
  check('the response never carries the encrypted SSN or the token', !('ssnTransientEncrypted' in open.json) && !('token' in open.json), Object.keys(open.json))
  ;[packet] = await db.select().from(onboardingPackets).where(eq(onboardingPackets.id, packet.id))
  check('first open: status opened, openedAt stamped', packet.status === 'opened' && !!packet.openedAt, packet.status)

  const draft = await pub('PUT', `/api/public/onboarding-packets/${packet.token}`, { legalFirstName: 'Jamie', legalLastName: 'Applicant', city: 'Lakeside', dateOfBirth: 'not-a-date' })
  ;[packet] = await db.select().from(onboardingPackets).where(eq(onboardingPackets.id, packet.id))
  check('a draft save moves it to in progress', draft.status === 200 && packet.status === 'in_progress' && packet.city === 'Lakeside', packet)
  check('…a malformed date in a draft is dropped, not a 500', packet.dateOfBirth === null)

  const noSig = await pub('POST', `/api/public/onboarding-packets/${packet.token}/submit`, { dateOfBirth: '1990-05-01', ssn: '123-45-6789', legalFirstName: 'Jamie', legalLastName: 'Applicant' })
  check('submit without a signature is refused', noSig.status === 400 && /signature/i.test(noSig.json.error), noSig.json)
  const badSsn = await pub('POST', `/api/public/onboarding-packets/${packet.token}/submit`, { bgcConsentSignature: 'Jamie Applicant', dateOfBirth: '1990-05-01', ssn: '123-45', legalFirstName: 'Jamie', legalLastName: 'Applicant' })
  check('Wisconsin: a short SSN is refused', badSsn.status === 400 && /9-digit/.test(badSsn.json.error), badSsn.json)
  const noLegal = await pub('POST', `/api/public/onboarding-packets/${packet.token}/submit`, { bgcConsentSignature: 'Jamie Applicant', dateOfBirth: '1990-05-01', ssn: '123456789' })
  check('legal first and last name are required', noLegal.status === 400, noLegal.json)

  // WORCS refuses the first time: the SSN must be KEPT (encrypted) for the office's retry.
  onboardingSvc.__setWorcsSubmitForTests(async () => { throw new Error('WORCS is down') })
  const submit = await pub('POST', `/api/public/onboarding-packets/${packet.token}/submit`, {
    bgcConsentSignature: '  Jamie Q Applicant ', dateOfBirth: '1990-05-01', ssn: '123-45-6789',
    legalFirstName: 'Jamie', legalLastName: 'Applicant', legalMiddleName: 'Quinn',
  }, { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'TestPhone/1.0' })
  await onboardingSvc.awaitLastWorcsSubmission()
  check('the signed packet is accepted even when WORCS is down', submit.status === 200 && submit.json.success, submit.json)
  ;[packet] = await db.select().from(onboardingPackets).where(eq(onboardingPackets.id, packet.id))
  check('consent is recorded: signature, IP, user agent, version, verbatim text', packet.status === 'submitted' && packet.bgcConsentSignature === 'Jamie Q Applicant'
    && packet.bgcConsentIp === '203.0.113.9' && packet.bgcConsentUserAgent === 'TestPhone/1.0' && packet.bgcConsentVersion === '2026-04-v1'
    && /WORCS/.test(packet.bgcConsentDisclosureText || ''), packet)
  check('…the SSN is held ENCRYPTED for the retry, never in plain text', !!packet.ssnTransientEncrypted && !packet.ssnTransientEncrypted.includes('123456789'))
  const noCheck = await db.select().from(backgroundChecks).where(eq(backgroundChecks.caregiverId, jamie.id))
  check('…and no background check row exists yet', noCheck.length === 0, noCheck.length)

  const resubmit = await pub('POST', `/api/public/onboarding-packets/${packet.token}/submit`, { bgcConsentSignature: 'J', dateOfBirth: '1990-05-01', ssn: '123456789', legalFirstName: 'J', legalLastName: 'A' })
  check('a submitted packet cannot be submitted again', resubmit.status === 409, resubmit.json)

  const detail = await asAdmin('GET', `/api/onboarding-packets/${packet.id}`)
  check('the office sees the packet, flagged for a WORCS retry', detail.status === 200 && detail.json.worcsSubmissionPending === true, detail.json?.worcsSubmissionPending)
  check('…without the token or the SSN', !('token' in detail.json) && !('ssnTransientEncrypted' in detail.json))
  check('…with its audit trail', Array.isArray(detail.json.events) && ['created', 'opened', 'saved_draft', 'consent_signed', 'submitted'].every((t) => detail.json.events.some((e: any) => e.eventType === t)), detail.json.events?.map((e: any) => e.eventType))

  const cgRetry = await asCg('POST', `/api/onboarding-packets/${packet.id}/retry-worcs`)
  check('a caregiver cannot retry WORCS', cgRetry.status === 403)
  let submitted: any = null
  onboardingSvc.__setWorcsSubmitForTests(async (data: any) => { submitted = data; return { success: true, referenceNumber: 'REF-1001', status: 'pending' } as any })
  const retry = await asAdmin('POST', `/api/onboarding-packets/${packet.id}/retry-worcs`)
  check('the office retries WORCS', retry.status === 200 && retry.json.referenceNumber === 'REF-1001', retry.json)
  check('WORCS got the decrypted SSN, the legal name and the DOB', submitted?.ssn === '123456789' && submitted?.firstName === 'Jamie' && submitted?.lastName === 'Applicant' && submitted?.dateOfBirth === '1990-05-01' && submitted?.requestPurpose === 'Caregiver-General', submitted)
  ;[packet] = await db.select().from(onboardingPackets).where(eq(onboardingPackets.id, packet.id))
  check('once WORCS accepted it, the SSN is scrubbed', packet.ssnTransientEncrypted === null)
  const [bc] = await db.select().from(backgroundChecks).where(eq(backgroundChecks.caregiverId, jamie.id))
  check('a pending WORCS check is recorded with its reference', bc?.checkType === 'worcs' && bc.status === 'pending' && bc.worcsReferenceNumber === 'REF-1001' && bc.provider === 'WI DOJ WORCS', bc)
  const ev = await db.select().from(onboardingPacketEvents).where(and(eq(onboardingPacketEvents.packetId, packet.id), eq(onboardingPacketEvents.eventType, 'bgc_requested')))
  check('…and logged as bgc_requested', ev.length === 1)
  const retry2 = await asAdmin('POST', `/api/onboarding-packets/${packet.id}/retry-worcs`)
  check('a second retry finds no SSN and says so', retry2.status === 400 && /No SSN/.test(retry2.json.error), retry2.json)
  onboardingSvc.__setWorcsSubmitForTests(null)

  // Expiry
  const [p2] = await db.insert(onboardingPackets).values({ caregiverId: other.id, token: 'e'.repeat(96), expiresAt: new Date(Date.now() - 1000), status: 'sent' }).returning()
  const exp = await pub('GET', `/api/public/onboarding-packets/${p2.token}`)
  const [p2after] = await db.select().from(onboardingPackets).where(eq(onboardingPackets.id, p2.id))
  check('an expired link answers 410 and marks the packet expired', exp.status === 410 && p2after.status === 'expired', { s: exp.status, st: p2after.status })

  // Resend issues a NEW token; the old link stops working.
  const oldToken = p2.token
  const cgResend = await asCg('POST', `/api/onboarding-packets/${p2.id}/resend`)
  check('a caregiver cannot resend a packet', cgResend.status === 403)
  const resend = await asAdmin('POST', `/api/onboarding-packets/${p2.id}/resend`)
  const [p2r] = await db.select().from(onboardingPackets).where(eq(onboardingPackets.id, p2.id))
  check('resend: fresh token, status sent, 14 more days', resend.status === 200 && p2r.token !== oldToken && p2r.status === 'sent' && new Date(p2r.expiresAt) > new Date(Date.now() + 13 * 86400000))
  check('…and the old link is dead', (await pub('GET', `/api/public/onboarding-packets/${oldToken}`)).status === 404)
  const resendSubmitted = await asAdmin('POST', `/api/onboarding-packets/${packet.id}/resend`)
  check('a submitted packet cannot be resent', resendSubmitted.status === 409)

  // Gusto handoff
  const csv = await asAdmin('GET', `/api/onboarding-packets/${packet.id}/gusto-export.csv`)
  const lines = csv.text.trim().split('\n')
  check('the Gusto import CSV has Gusto\'s headers', lines[0] === 'First Name,Middle Initial,Last Name,Email,Phone,Street 1,City,State,Zip,Date of Birth,Work Start Date,Employment Type,Pay Type,Pay Rate,Compensation Currency', lines[0])
  check('…prefilled from the legal name, middle initial, DOB and pay rate', lines[1].startsWith('Jamie,Q,Applicant,jamie.applicant@example.test,') && lines[1].includes(',1990-05-01,') && lines[1].endsWith(',Employee,Hourly,16.50,USD'), lines[1])
  check('…as a CSV attachment', /text\/csv/.test(csv.headers.get('content-type') || '') && /gusto-import-applicant\.csv/.test(csv.headers.get('content-disposition') || ''))
  const mark = await asAdmin('POST', `/api/onboarding-packets/${packet.id}/mark-gusto-synced`, { gustoEmployeeId: ' G-77 ' })
  const [map] = await db.select().from(gustoEmployeeMap).where(eq(gustoEmployeeMap.userId, jamie.id))
  check('mark synced records it on gusto_employee_map, with who did it', mark.status === 200 && map?.gustoEmployeeId === 'G-77' && map.isSynced && !!map.lastSyncedAt && map.syncedById === admin.id, map)
  const listQ = await asAdmin('GET', '/api/onboarding-packets?status=submitted')
  check('the queue shows the packet as Gusto-synced', listQ.json.length === 1 && listQ.json[0].gustoEmployeeId === 'G-77' && !!listQ.json[0].gustoSyncedAt, listQ.json)
  check('…and the queue never lists tokens', !JSON.stringify(listQ.json).includes(packet.token))
}

// ════════ another state: no WORCS, no SSN ════════════════════════════════════════════════════════
{
  await db.update(agencies).set({ state: 'MN' }).where(eq(agencies.id, ag.id))
  const [p3] = await db.insert(onboardingPackets).values({ caregiverId: other.id, token: 'm'.repeat(96), expiresAt: new Date(Date.now() + 86400000), status: 'sent' }).returning()
  const open = await pub('GET', `/api/public/onboarding-packets/${p3.token}`)
  check('outside Wisconsin the page does not ask for an SSN', open.json.requiresSsn === false, open.json.requiresSsn)
  check('…and the disclosure carries no Wisconsin law or WORCS', !/Wisconsin|WORCS/.test(open.json.bgcDisclosureText) && open.json.bgcConsentVersion === '2026-10-general-v1', open.json.bgcDisclosureText.slice(0, 120))
  const sub = await pub('POST', `/api/public/onboarding-packets/${p3.token}/submit`, { bgcConsentSignature: 'Otto Tester', dateOfBirth: '1985-01-02', legalFirstName: 'Otto', legalLastName: 'Tester' })
  await onboardingSvc.awaitLastWorcsSubmission()
  const [p3a] = await db.select().from(onboardingPackets).where(eq(onboardingPackets.id, p3.id))
  check('a non-Wisconsin packet submits without an SSN', sub.status === 200 && p3a.status === 'submitted' && p3a.ssnTransientEncrypted === null, sub.json)
  const checks = await db.select().from(backgroundChecks).where(eq(backgroundChecks.caregiverId, other.id))
  check('…and nothing is sent to WORCS', checks.length === 0, checks.length)
  const retry = await asAdmin('POST', `/api/onboarding-packets/${p3.id}/retry-worcs`)
  check('retry-worcs is refused outside Wisconsin', retry.status === 400 && /Wisconsin/.test(retry.json.error), retry.json)
  const ev = await eligibility.evaluateWorcsResult({ hasRecord: true, findings: 'theft 943.20' }, 'MN')
  check('the Wisconsin bar list is not applied to a Minnesota agency', ev.status === 'flagged_review' && ev.matches.length === 0, ev)
  await db.update(agencies).set({ state: 'WI' }).where(eq(agencies.id, ag.id))
}

// ════════ eligibility engine: same decisions as CVHC ═════════════════════════════════════════════
{
  const e = eligibility.evaluateWorcsResult
  check('no record → clear', (await e({ hasRecord: false }, 'WI')).status === 'clear')
  check('nothing to evaluate → flagged for review', (await e(null, 'WI')).status === 'flagged_review')
  const theft = await e({ hasRecord: true, findings: 'Misdemeanor THEFT, movable property' }, 'WI')
  check('theft → rehab review under § 943.20', theft.status === 'rehab_review' && theft.matches.some((m) => m.statute === 'Wis. Stat. § 943.20'), theft)
  const assault = await e({ hasRecord: true, findings: '2nd degree sexual assault' }, 'WI')
  check('sexual assault → disqualified', assault.status === 'disqualified' && /Do not hire\. Matched: Wis\. Stat\. § 940\.225/.test(assault.recommendation), assault)
  const both = await e({ hasRecord: true, findings: 'theft; first degree intentional homicide' }, 'WI')
  check('worst match wins: permanent bar over rehab review', both.status === 'disqualified' && both.matches.length >= 2 && /1 permanent caregiver bar /.test(both.summary), both.summary)
  const owi = await e({ hasRecord: true, findings: 'OWI 3rd offense' }, 'WI')
  check('OWI 3rd → advisory, flagged for review', owi.status === 'flagged_review' && owi.matches.length === 1 && owi.matches[0].severity === 'advisory', owi)
  const none = await e({ hasRecord: true, findings: 'speeding citation' }, 'WI')
  check('a record matching nothing → flagged for review, no matches', none.status === 'flagged_review' && none.matches.length === 0)
  const bystat = await e({ hasRecord: true, findings: 'Charge 948.02(2)' }, 'WI')
  check('a bare statute number matches its pattern (948.02)', bystat.status === 'disqualified' && bystat.matches.some((m) => m.statute === 'Wis. Stat. § 948.02'), bystat.matches)
  // (no switch: the bar list is code) /* unified: no statute can be switched off: the list is code */
   /* unified: no statute can be switched off: the list is code */
   /* unified: no statute can be switched off: the list is code */
   /* unified: no statute can be switched off: the list is code */

  const routeE = await asAdmin('GET', `/api/background-checks/caregiver/${jamie.id}/eligibility`)
  check('the eligibility route reads the latest WORCS check (pending → review)', routeE.status === 200 && routeE.json.status === 'flagged_review', routeE.json)
  const none2 = await asAdmin('GET', `/api/background-checks/caregiver/${owner.id}/eligibility`)
  check('…and says when no WORCS check was run', /No WORCS background check/.test(none2.json.summary), none2.json)
}

// ════════ WORCS poll ═════════════════════════════════════════════════════════════════════════════
{
  const cgPoll = await asCg('POST', '/api/background-checks/poll-now')
  check('a caregiver cannot trigger a WORCS poll', cgPoll.status === 403)

  worcsPoll.__setWorcsClientForTests(async () => ({ referenceNumber: 'REF-1001', status: 'pending', result: 'pending' }) as any)
  let s = await worcsPoll.runPollCycle()
  let [bc] = await db.select().from(backgroundChecks).where(eq(backgroundChecks.worcsReferenceNumber, 'REF-1001'))
  check('still pending at WORCS → in progress', s.polled === 1 && s.completed === 0 && bc.status === 'in_progress', { s, st: bc.status })

  worcsPoll.__setWorcsClientForTests(async () => ({ referenceNumber: 'REF-1001', status: 'completed', result: 'record_found', hasRecord: true, rawResult: 'Retail theft (943.50)' }) as any)
  const poll = await asAdmin('POST', '/api/background-checks/poll-now')
  ;[bc] = await db.select().from(backgroundChecks).where(eq(backgroundChecks.worcsReferenceNumber, 'REF-1001'))
  check('a finished check is saved: completed, record found, findings, completed date', poll.json.completed === 1 && bc.status === 'completed' && bc.result === 'record_found' && bc.findings === 'Retail theft (943.50)' && !!bc.completedDate, bc)
  const after = await asAdmin('GET', `/api/background-checks/caregiver/${jamie.id}/eligibility`)
  check('…and eligibility now reads the findings: theft → rehab review', after.json.status === 'rehab_review', after.json)
  s = await worcsPoll.runPollCycle()
  check('a completed check is not polled again', s.polled === 0, s)

  // The real client's mock path (no credentials): MOCK- references clear.
  worcsPoll.__setWorcsClientForTests(null)
  await db.insert(backgroundChecks).values({ caregiverId: other.id, checkType: 'worcs', status: 'pending', worcsReferenceNumber: 'MOCK-42' })
  await worcsPoll.runPollCycle()
  const [mock] = await db.select().from(backgroundChecks).where(eq(backgroundChecks.worcsReferenceNumber, 'MOCK-42'))
  check('a mock reference clears (no WORCS credentials in this environment)', mock.status === 'completed' && mock.result === 'clear', mock)

  // Never overlapping: a cycle started while one is running returns at once.
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  await db.insert(backgroundChecks).values({ caregiverId: other.id, checkType: 'worcs', status: 'pending', worcsReferenceNumber: 'REF-SLOW' })
  worcsPoll.__setWorcsClientForTests(async () => { await gate; return { status: 'pending' } as any })
  const first = worcsPoll.runPollCycle()
  await new Promise((r) => setTimeout(r, 50))
  const second = await worcsPoll.runPollCycle()
  release()
  await first
  check('a second cycle while one runs is skipped, not stacked', second.skipped === true && second.polled === 0, second)
  worcsPoll.__setWorcsClientForTests(null)
}

// ════════ background checks: the office's ════════════════════════════════════════════════════════
let checkId = ''
{
  const cgList = await asCg('GET', '/api/background-checks')
  check('a caregiver cannot read background checks', cgList.status === 403)
  const cgMine = await asCg('GET', `/api/background-checks/caregiver/${caregiver.id}`)
  check('…not even through the per-caregiver path', cgMine.status === 403)
  const cgAdd = await asCg('POST', '/api/background-checks', { caregiverId: caregiver.id, checkType: 'criminal' })
  check('a caregiver cannot add one', cgAdd.status === 403)

  const blankCost = await asAdmin('POST', '/api/background-checks', { caregiverId: caregiver.id, checkType: 'criminal', provider: '', cost: '', notes: '' })
  check('a blank cost saves (null), not a 500', blankCost.status === 201 && blankCost.json.cost === null && blankCost.json.status === 'pending', blankCost.json)
  checkId = blankCost.json.id
  const badCost = await asAdmin('POST', '/api/background-checks', { caregiverId: caregiver.id, checkType: 'criminal', cost: 'abc' })
  check('a non-numeric cost is refused', badCost.status === 400)
  const ghost = await asAdmin('POST', '/api/background-checks', { caregiverId: 'nobody', checkType: 'criminal' })
  check('an unknown caregiver is a 404, not an FK 500', ghost.status === 404)
  check('no route ever returns the encrypted SSN column', !JSON.stringify(blankCost.json).includes('ssnEncrypted'))

  const in10 = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
  const upd = await asAdmin('PUT', `/api/background-checks/${checkId}`, { status: 'completed', result: 'clear', completedDate: '2026-10-01', expirationDate: in10, referenceNumber: 'DOJ-9', findings: '' })
  check('update records result, dates and reference', upd.status === 200 && upd.json.result === 'clear' && upd.json.completedDate === '2026-10-01' && upd.json.referenceNumber === 'DOJ-9', upd.json)
  const keep = await asAdmin('PUT', `/api/background-checks/${checkId}`, { notes: 'Letter on file' })
  check('a blank field keeps its value (COALESCE update)', keep.json.result === 'clear' && keep.json.referenceNumber === 'DOJ-9' && keep.json.notes === 'Letter on file', keep.json)
  const exp30 = await asAdmin('GET', '/api/background-checks/reports/expiring?days=30')
  const exp5 = await asAdmin('GET', '/api/background-checks/reports/expiring?days=5')
  check('expiring report: a cleared check 10 days out is inside 30 days, outside 5', exp30.json.some((r: any) => r.id === checkId) && !exp5.json.some((r: any) => r.id === checkId), { a: exp30.json?.length, b: exp5.json?.length })
  const comp = await asAdmin('GET', '/api/background-checks/reports/compliance')
  const carolRow = comp.json.find((r: any) => r.id === caregiver.id)
  check('compliance report lists passed check types per caregiver', Array.isArray(carolRow?.passedChecks) && carolRow.passedChecks.includes('criminal') /* unified: the compliance report is camelCase (RULEBOOK §2): passedChecks */, carolRow)

  // Documents
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test letter').toString('base64')
  const cgDoc = await asCg('POST', `/api/background-checks/${checkId}/documents`, { fileName: 'x.pdf', dataUri: pdf })
  check('a caregiver cannot upload a result letter', cgDoc.status === 403)
  const txt = await asAdmin('POST', `/api/background-checks/${checkId}/documents`, { fileName: 'x.txt', dataUri: 'data:text/plain;base64,aGk=' })
  check('only PDF and images are accepted', txt.status === 400 && /PDF and image/.test(txt.json.error), txt.json)
  const big = await asAdmin('POST', `/api/background-checks/${checkId}/documents`, { fileName: 'big.pdf', dataUri: 'data:application/pdf;base64,' + 'A'.repeat(9_500_001) })
  check('over 7 MB is refused', big.status === 400 && /too large/.test(big.json.error), big.json)
  const up = await asAdmin('POST', `/api/background-checks/${checkId}/documents`, { fileName: 'DOJ letter (final).pdf', dataUri: pdf })
  check('the office uploads the result letter', up.status === 201 && up.json.mimeType === 'application/pdf' && up.json.fileName === 'DOJ letter _final_.pdf', up.json)
  check('…the upload response does not echo the file data', !('fileData' in up.json))
  const list = await asAdmin('GET', '/api/background-checks')
  check('the list counts documents per check', list.json.find((r: any) => r.id === checkId)?.documentCount === 1, list.json.find((r: any) => r.id === checkId))
  const dl = await call(admin, 'GET', `/api/background-checks/${checkId}/documents/${up.json.id}`)
  check('the letter downloads with its own type and bytes', dl.status === 200 && dl.headers.get('content-type') === 'application/pdf' && dl.text.startsWith('%PDF-1.4'), dl.headers.get('content-type'))
  const wrongCheck = await asAdmin('GET', `/api/background-checks/${blankCost.json.id}x/documents/${up.json.id}`)
  check('a document only opens under its own check', wrongCheck.status === 404)
  const del = await asAdmin('DELETE', `/api/background-checks/${checkId}/documents/${up.json.id}`)
  check('the office deletes a letter', del.status === 200 && (await db.select().from(backgroundCheckDocuments)).length === 0)
}

// ════════ Gusto: approved payable hours, OT per Sun–Sat week ══════════════════════════════════════
{
  // Week of Sun 2026-09-06 … Sat 09-12: 5 shifts × 9h = 45h → 40 regular + 5 OT.
  // Week of Sun 09-13: 1 shift × 6h (on Sunday → weekend). Rate $20.
  // gross = (40 + 6) × 20 + 5 × 20 × 1.5 = 920 + 150 = 1070
  await db.update(users).set({ defaultPayRate: '20.00' }).where(eq(users.id, caregiver.id))
  const rev = (shiftDate: string, minutes: number, status = 'approved') => ({
    payPeriodStart: '2026-09-06', payPeriodEnd: '2026-09-19', caregiverId: caregiver.id, clientId: client.id,
    shiftDate, scheduledMinutes: minutes, payableMinutes: minutes, status,
  })
  await db.insert(payrollShiftReviews).values([
    rev('2026-09-07', 540), rev('2026-09-08', 540), rev('2026-09-09', 540), rev('2026-09-10', 540), rev('2026-09-11', 540),
    rev('2026-09-13', 360),
    rev('2026-09-14', 240, 'pending'),
  ] as any)
  // A clock entry with no review row, inside the period.
  await db.insert(timeEntries).values({ caregiverId: caregiver.id, clientId: client.id, startTime: new Date('2026-09-15T15:00:00Z'), endTime: new Date('2026-09-15T17:00:00Z') } as any)

  const cg = await asCg('GET', '/api/gusto/preview?startDate=2026-09-06&endDate=2026-09-19')
  check('a caregiver cannot read the payroll export', cg.status === 403)
  const noDates = await asAdmin('GET', '/api/gusto/preview')
  check('the preview needs a date range', noDates.status === 400)
  const pv = await asAdmin('GET', '/api/gusto/preview?startDate=2026-09-06&endDate=2026-09-19')
  const row = pv.json.preview?.find((r: any) => r.id === caregiver.id)
  check('regular 46h, overtime 5h (over 40 in the Sun–Sat week)', row && Number(row.regularHours) === 46 && Number(row.overtimeHours) === 5 && Number(row.totalHours) === 51, row) /* unified: the Gusto preview's rows are camelCase (RULEBOOK §2) */
  check('weekend hours = the Sunday shift (6h)', Number(row?.weekendHours) === 6, row?.weekendHours) /* unified: the Gusto preview's rows are camelCase */
  check('gross = 46 × $20 + 5 × $20 × 1.5 = $1,070.00', Number(row?.grossPay) === 1070, row?.grossPay) /* unified: the Gusto preview's rows are camelCase */
  check('the pending review is not paid', Number(row?.shiftCount) === 6, row?.shiftCount) /* unified: the Gusto preview's rows are camelCase */
  check('warnings: 1 unresolved review, 1 clock entry with no review', pv.json.warnings?.unresolvedReviews === 1 && pv.json.warnings?.clockEntriesWithoutReview === 1 /* unified: the Gusto preview's warnings are camelCase */, pv.json.warnings)
  check('totals: one caregiver, 51h, $1,070.00, unmapped to Gusto', pv.json.totals.employees === 1 && pv.json.totals.totalHours === '51.00' && pv.json.totals.totalGross === '1070.00' && pv.json.totals.unmapped === 1, pv.json.totals)

  const csv = await call(admin, 'GET', '/api/gusto/export-csv?startDate=2026-09-06&endDate=2026-09-19')
  const lines = csv.text.split('\n')
  check('the hours CSV carries regular/overtime/total', lines[0] === 'First Name,Last Name,Email,Regular Hours,Overtime Hours,Total Hours' && lines[1] === '"Carol","Tester","carol@staff.test",46.00,5.00,51.00', lines)
  const push = await asAdmin('POST', '/api/gusto/export', {})
  check('the direct Gusto push is refused until rebuilt (501)', push.status === 501, push.status)

  // No rate: $15.
  await db.update(users).set({ defaultPayRate: null }).where(eq(users.id, caregiver.id))
  const pv15 = await asAdmin('GET', '/api/gusto/preview?startDate=2026-09-06&endDate=2026-09-12')
  const r15 = pv15.json.preview.find((r: any) => r.id === caregiver.id)
  check('no pay rate → $15: 40 × 15 + 5 × 15 × 1.5 = $712.50', Number(r15?.grossPay) === 712.5, r15) /* unified: the Gusto preview's rows are camelCase */
  await db.update(users).set({ defaultPayRate: '18.00' }).where(eq(users.id, caregiver.id))
}

// ════════ payday verification ═════════════════════════════════════════════════════════════════════
{
  const P = payday.getCurrentPayPeriod
  const thu = P('2026-10-15'), fri = P('2026-10-16'), sat = P('2026-10-17')
  check('Thu 10/15: this week is not paid until Fri → last period 9/27–10/3, paid 10/9', JSON.stringify(thu) === JSON.stringify({ start: '2026-09-27', end: '2026-10-03', payDate: '2026-10-09' }), thu)
  check('Fri 10/16 (pay day): period 10/4–10/10, paid 10/16', JSON.stringify(fri) === JSON.stringify({ start: '2026-10-04', end: '2026-10-10', payDate: '2026-10-16' }), fri)
  check('Sat 10/17: still 10/4–10/10', JSON.stringify(sat) === JSON.stringify({ start: '2026-10-04', end: '2026-10-10', payDate: '2026-10-16' }), sat)
  check('the calendar day is the agency\'s: 03:00Z on 10/16 is still 10/15 in Chicago', payday.todayIn('America/Chicago', new Date('2026-10-16T03:00:00Z')) === '2026-10-15')

  const [sch] = await db.insert(schedules).values({ clientId: client.id, caregiverId: caregiver.id } as any).returning()
  const r = (shiftDate: string, minutes: number, status = 'approved', scheduleId: string | null = sch.id) => ({
    payPeriodStart: '2026-09-27', payPeriodEnd: '2026-10-03', caregiverId: caregiver.id, clientId: client.id, scheduleId,
    shiftDate, scheduledStart: '09:00', scheduledEnd: '13:00', payableMinutes: minutes, status,
  })
  await db.insert(payrollShiftReviews).values([
    r('2026-09-28', 240), r('2026-09-30', 150, 'verified'),
    r('2026-10-01', 120, 'pending'),          // not payable yet
    r('2026-10-02', 90, 'approved', null),    // unscheduled — not in the prompt
  ] as any)
  const pend = await payday.pendingVerificationFor(caregiver.id, '2026-10-15')
  check('pending period: 240 + 150 payable minutes = 6.5h', pend?.totalHours === 6.5 && pend.shifts.length === 2, pend)
  check('gross = 6.5h × $18 = $117.00', pend?.hourlyRate === 18 && pend.grossPay === 117, pend)
  check('…pay date carried', pend?.payDate === '2026-10-09')

  const off = await asCg('GET', '/api/payroll-verification/me/pending')
  check('the prompt is OFF by default (CVHC switched it off: it blocked clock-in)', off.status === 200 && off.json.pending === null, off.json)
  const cgSet = await asCg('PUT', '/api/payroll-verification/settings', { paydayVerification: true })
  check('a caregiver cannot switch the prompt on', cgSet.status === 403)
  const badSet = await asAdmin('PUT', '/api/payroll-verification/settings', { paydayVerification: 'yes' })
  check('the setting must be true or false', badSet.status === 400)
  const on = await asAdmin('PUT', '/api/payroll-verification/settings', { paydayVerification: true })
  check('the office switches it on', on.status === 200 && on.json.paydayVerification === true)
  const [agRow] = await db.select().from(agencies).where(eq(agencies.id, ag.id))
  check('…without disturbing the other settings', (agRow.settings as any).paydayVerification === true && agRow.state === 'WI')
  const adminPending = await asAdmin('GET', '/api/payroll-verification/me/pending')
  check('an admin is never prompted', adminPending.json.pending === null)

  const adminVerify = await asAdmin('POST', '/api/payroll-verification/me/verify', { payPeriodStart: '2026-09-27', payPeriodEnd: '2026-10-03', confirmed: true })
  check('only caregivers verify their own hours', adminVerify.status === 403)
  const badDates = await asCg('POST', '/api/payroll-verification/me/verify', { payPeriodStart: '2026-10-03', payPeriodEnd: '2026-09-27', confirmed: true })
  check('a backwards period is refused', badDates.status === 400)
  const noReason = await asCg('POST', '/api/payroll-verification/me/verify', { payPeriodStart: '2026-09-27', payPeriodEnd: '2026-10-03', confirmed: false, disputeReason: ' ' })
  check('a dispute needs a reason', noReason.status === 400 && /disputeReason/.test(noReason.json.error))

  const ok = await asCg('POST', '/api/payroll-verification/me/verify', { payPeriodStart: '2026-09-27', payPeriodEnd: '2026-10-03', confirmed: true, reportedTotalHours: 6.5, reportedGrossPay: 117 })
  let [v] = await db.select().from(payrollPeriodVerifications).where(eq(payrollPeriodVerifications.caregiverId, caregiver.id))
  check('confirming stores verified_at and what the caregiver saw', ok.json.status === 'verified' && !!v.verifiedAt && v.reportedTotalHours === '6.50' && v.reportedGrossPay === '117.00', v)
  check('once confirmed, the period is no longer pending', (await payday.pendingVerificationFor(caregiver.id, '2026-10-15')) === null)

  const disp = await asCg('POST', '/api/payroll-verification/me/verify', { payPeriodStart: '2026-09-27', payPeriodEnd: '2026-10-03', confirmed: false, disputeReason: 'Tuesday shows 2.5h, I worked 4h' })
  ;[v] = await db.select().from(payrollPeriodVerifications).where(eq(payrollPeriodVerifications.caregiverId, caregiver.id))
  const rows = await db.select().from(payrollPeriodVerifications)
  check('a dispute replaces the confirmation on the SAME row', disp.json.status === 'disputed' && rows.length === 1 && v.verifiedAt === null && !!v.disputedAt && v.disputeReason === 'Tuesday shows 2.5h, I worked 4h', v)
  const notes = await db.select().from(notifications).where(eq(notifications.type, 'payroll_dispute'))
  check('the office (admin AND owner) is notified of the dispute', notes.length === 2 && notes.some((n) => n.userId === admin.id) && notes.some((n) => n.userId === owner.id)
    && notes[0].message === 'Carol Tester disputed 2026-09-27 to 2026-10-03: "Tuesday shows 2.5h, I worked 4h"', notes.map((n) => n.message))
  const officeList = await asAdmin('GET', '/api/payroll-verification?start=2026-09-27')
  check('the office lists confirmations and disputes', officeList.json.length === 1 && officeList.json[0].firstName === 'Carol', officeList.json)
  const cgList = await asCg('GET', '/api/payroll-verification')
  check('…a caregiver cannot', cgList.status === 403)
}

// ════════ performance reviews ═════════════════════════════════════════════════════════════════════
{
  const cg = await asCg('POST', '/api/performance-reviews', { caregiverId: caregiver.id, clientId: client.id })
  check('a caregiver cannot write a review', cg.status === 403)
  const cgRead = await asCg('GET', '/api/performance-reviews')
  check('…or read the reviews', cgRead.status === 403)
  const noClient = await asAdmin('POST', '/api/performance-reviews', { caregiverId: caregiver.id })
  check('caregiver and client are required', noClient.status === 400 && noClient.json.error === 'Caregiver and Client are required')
  const ex = await asAdmin('POST', '/api/performance-reviews', { caregiverId: caregiver.id, clientId: client.id, reviewDate: '2026-10-01', performanceNotes: 'Great', strengths: 'Kind', areasForImprovement: 'None', overallAssessment: 'excellent' })
  check('excellent → satisfaction 5', ex.status === 201 && ex.json.satisfactionScore === 5 && ex.json.reviewDate === '2026-10-01', ex.json)
  const ni = await asAdmin('POST', '/api/performance-reviews', { caregiverId: caregiver.id, clientId: client.id, overallAssessment: 'needs_improvement' })
  check('needs improvement → 1', ni.json.satisfactionScore === 1)
  const odd = await asAdmin('POST', '/api/performance-reviews', { caregiverId: caregiver.id, clientId: client.id, overallAssessment: 'toString' })
  check('an unknown assessment is satisfactory → 3', odd.json.satisfactionScore === 3 && odd.json.overallAssessment === 'satisfactory', odd.json)
  const list = await asAdmin('GET', '/api/performance-reviews')
  const got = list.json.find((x: any) => x.id === ex.json.id)
  check('the list unpacks the review fields the screen reads', got?.performanceNotes === 'Great' && got.strengths === 'Kind' && got.areasForImprovement === 'None' && got.overallAssessment === 'excellent' && got.caregiverFirstName === 'Carol' && got.clientFirstName === 'Ruth', got)
  const del = await asAdmin('DELETE', `/api/performance-reviews/${ni.json.id}`)
  check('the office deletes a review', del.status === 200 && (await db.select().from(performanceRatings)).length === 2)
}

// ════════ training records + certifications on the caregiver ═════════════════════════════════════
{
  const cgAdd = await asCg('POST', `/api/caregivers/${caregiver.id}/training-records`, { trainingType: 'cpr', completionDate: '2026-01-01' })
  check('a caregiver cannot record their own training', cgAdd.status === 403)
  const missing = await asAdmin('POST', `/api/caregivers/${caregiver.id}/training-records`, { trainingType: 'cpr' })
  check('training needs a completion date', missing.status === 400)
  const tr = await asAdmin('POST', `/api/caregivers/${caregiver.id}/training-records`, { trainingType: 'cpr', completionDate: '2026-01-01', expirationDate: '2028-01-01', certificationNumber: 'CPR-1', provider: 'Red Cross' })
  check('the office records training', tr.status === 201 && tr.json.trainingType === 'cpr' && tr.json.certificationNumber === 'CPR-1' && tr.json.recordedById === admin.id, tr.json)
  const mine = await asCg('GET', `/api/caregivers/${caregiver.id}/training-records`)
  check('a caregiver reads their own training, in the screen\'s field names', mine.status === 200 && mine.json[0]?.completionDate === '2026-01-01' && mine.json[0]?.expirationDate === '2028-01-01', mine.json)
  const theirs = await asCg('GET', `/api/caregivers/${other.id}/training-records`)
  check('…but not another caregiver\'s', theirs.status === 403)
  const cgDel = await asCg('DELETE', `/api/training-records/${tr.json.id}`)
  check('a caregiver cannot delete training', cgDel.status === 403)
  const del = await asAdmin('DELETE', `/api/training-records/${tr.json.id}`)
  check('the office deletes training', del.status === 200 && (await db.select().from(trainingRecords)).length === 0)

  const cert = await asAdmin('POST', `/api/caregivers/${caregiver.id}/certifications`, { certificationName: 'CNA', certificationNumber: 'N-55', issuer: 'State', issuedDate: '2025-01-01', expirationDate: '2027-01-01' })
  check('the office adds a certification', cert.status === 201 && cert.json.certificationName === 'CNA' && cert.json.certificationNumber === 'N-55' && cert.json.issuer === 'State', cert.json)
  const certs = await asCg('GET', `/api/caregivers/${caregiver.id}/certifications`)
  check('the caregiver sees it', certs.json.length === 1 && certs.json[0].expirationDate === '2027-01-01')
  const cgCertDel = await asCg('DELETE', `/api/certifications/${cert.json.id}`)
  check('a caregiver cannot delete a certification', cgCertDel.status === 403)

  const bgNone = await asCg('GET', `/api/caregivers/${owner.id}/background-check`)
  check('a caregiver cannot read someone else\'s background check', bgNone.status === 403)
  const bgAdd = await asAdmin('POST', `/api/caregivers/${other.id}/background-check`, { checkDate: '2026-09-01', status: 'completed', clearanceNumber: 'CL-1' })
  check('the compliance screen adds a check', bgAdd.status === 201 && bgAdd.json.referenceNumber === 'CL-1', bgAdd.json)
}

// ════════ server-side logout ══════════════════════════════════════════════════════════════════════
{
  revocation.clearRevocationCache()
  const iatBefore = Math.floor(Date.now() / 1000) - 60
  check('a token is valid before any logout', !(await revocation.isStaffTokenRevoked({ userId: caregiver.id, iat: iatBefore, role: 'caregiver' })))
  await db.update(users).set({ refreshToken: 'r-1' }).where(eq(users.id, caregiver.id))
  await revocation.markUserLoggedOut(caregiver.id)
  check('after logout, a token issued earlier is refused', await revocation.isStaffTokenRevoked({ userId: caregiver.id, iat: iatBefore, role: 'caregiver' }))
  check('a token issued after the logout second still works', !(await revocation.isStaffTokenRevoked({ userId: caregiver.id, iat: Math.floor(Date.now() / 1000) + 1, role: 'caregiver' })))
  check('a client-portal token is never checked', !(await revocation.isStaffTokenRevoked({ clientId: 'x', role: 'client', iat: 1 })))
  const [u] = await db.select().from(users).where(eq(users.id, caregiver.id))
  check('logout stamps last_logout_at and drops the refresh token', !!u.lastLogoutAt && u.refreshToken === null)
  revocation.clearRevocationCache()
  check('…and it survives a cold cache (read back from the database)', await revocation.isStaffTokenRevoked({ userId: caregiver.id, iat: iatBefore, role: 'caregiver' }))

  // The sandbox swaps middleware/auth.ts for a header stub, so the real middleware is read from source.
  const real = readFileSync(`${process.env.FACTORY_ROOT}templates/crm-homecare/backend/src/middleware/auth.ts`, 'utf8')
  const verifyAt = real.indexOf('jwt.verify(token')
  const revokeAt = real.indexOf('isStaffTokenRevoked(decoded)')
  const setAt = real.indexOf("c.set('user', decoded)")
  check('the real authenticate checks revocation after verifying and BEFORE setting the user', verifyAt > 0 && revokeAt > verifyAt && setAt > revokeAt, { verifyAt, revokeAt, setAt })
  const authRoutes = readFileSync(`${process.env.FACTORY_ROOT}templates/crm-homecare/backend/src/routes/auth.ts`, 'utf8')
  check('POST /api/auth/logout stamps the logout (markUserLoggedOut)', /app\.post\('\/logout'[\s\S]{0,600}markUserLoggedOut\(currentUser\.userId\)/.test(authRoutes))
}

console.log(`\nhomecare-staff: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
