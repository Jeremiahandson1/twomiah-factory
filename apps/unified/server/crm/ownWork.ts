// WHOSE WORK A SEAT WITHOUT jobs:read-all READS (Jobber's rule for a field seat; withheld per vertical in
// verticals/*/settings.ts): the jobs assigned to the login itself, the roofing jobs it is the sales rep on, and the jobs
// assigned to any crew it is on (crew_login: a roofing crew, or a roster crew on the Team page). One condition, used by
// every door that narrows to "own jobs" — the shared jobs routes, roofing's, the tech view and the contacts it reaches.
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { contact, crewLogin, job } from '../db/schema/index.ts'

/** A condition on `job`: the jobs this login reads as its own. */
export function ownJobsWhere(db: any, userId: string) {
  const crews = db.select({ id: crewLogin.crewId }).from(crewLogin).where(and(eq(crewLogin.userId, userId), isNotNull(crewLogin.crewId)))
  const members = db.select({ id: crewLogin.teamMemberId }).from(crewLogin).where(and(eq(crewLogin.userId, userId), isNotNull(crewLogin.teamMemberId)))
  return or(
    eq(job.assignedToId, userId),
    eq(job.assignedSalesRepId, userId),
    inArray(job.assignedCrewId, crews),
    inArray(job.assignedToMemberId, members),
  )!
}

/** A condition on `contact`: the customers on this login's own jobs. */
export function ownContactsWhere(db: any, userId: string) {
  return inArray(contact.id, db.select({ id: job.contactId }).from(job).where(and(ownJobsWhere(db, userId), isNotNull(job.contactId))))
}
