// Which of the company's customers are inside an area — a storm's path, or a canvass territory — from what the business
// already holds (field/geo.ts says how a point is tested and what is NOT used: no geocoder).
//
// Where a customer is: the pin of their newest job that has one (the roof is at the job's address, which may not be the
// billing address), else the contact's own pin. A customer with neither is "not on the map": it can only be matched by
// its zip, and the reply says so.
//
// "Past customer": a contact with a job that reached the work being done — final inspection, invoiced or collected.
import { eq } from 'drizzle-orm'
import { contact, job } from '../../../db/schema/index.ts'
import { coordOf, matchArea, zip5, type MatchedBy, type StormPath } from './geo.ts'

/** A job at one of these stages is work that was done: the customer is a past customer. */
export const WORK_DONE_STATUSES = ['final_inspection', 'invoiced', 'collected'] as const

export interface CustomerInArea {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  lat: number | null
  lng: number | null
  /** 'path': inside the drawn shape by coordinates. 'zip': placed by its zip only. */
  by: MatchedBy
  /** True when the customer has a pin; false when they could only be matched by zip. */
  located: boolean
  pastCustomer: boolean
  /** The job the pin / the past work is from. */
  job: { id: string; number: string | null; status: string; completedAt: Date | null; address: string | null } | null
}

export interface CustomersInArea {
  customers: CustomerInArea[]
  /** Every contact looked at, how many had a pin, and how many had none (they can match by zip only). */
  considered: number
  located: number
  unlocated: number
}

export async function customersInArea(
  db: any,
  companyId: string,
  area: { path: StormPath | null; zips: Set<string> },
  opts: { scope?: 'past' | 'all'; zipAlso?: boolean } = {},
): Promise<CustomersInArea> {
  const scope = opts.scope ?? 'past'
  const contacts: any[] = await db.select({
    id: contact.id, name: contact.name, phone: contact.phone, mobile: contact.mobile, email: contact.email, address: contact.address,
    city: contact.city, state: contact.state, zip: contact.zip, lat: contact.lat, lng: contact.lng,
  }).from(contact).where(eq(contact.companyId, companyId))
  const jobs: any[] = await db.select({
    id: job.id, number: job.number, status: job.status, contactId: job.contactId, lat: job.lat, lng: job.lng, zip: job.zip,
    address: job.address, completedAt: job.completedAt, createdAt: job.createdAt,
  }).from(job).where(eq(job.companyId, companyId))

  const byContact = new Map<string, any[]>()
  for (const j of jobs) if (j.contactId) (byContact.get(j.contactId) ?? byContact.set(j.contactId, []).get(j.contactId)!).push(j)
  const newest = (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()

  const out: CustomerInArea[] = []
  let considered = 0, located = 0
  for (const ct of contacts) {
    const theirs = (byContact.get(ct.id) ?? []).sort(newest)
    const done = theirs.filter((j) => (WORK_DONE_STATUSES as readonly string[]).includes(j.status))
    const pastCustomer = done.length > 0
    if (scope === 'past' && !pastCustomer) continue
    considered++
    // The pin: the job that was done, then any job, then the contact's own.
    const pinJob = [...done, ...theirs].find((j) => coordOf(j.lat) !== null && coordOf(j.lng) !== null) ?? null
    const lat = pinJob ? coordOf(pinJob.lat) : coordOf(ct.lat)
    const lng = pinJob ? coordOf(pinJob.lng) : coordOf(ct.lng)
    const hasPin = lat !== null && lng !== null
    if (hasPin) located++
    const zip = zip5(ct.zip) ?? zip5(done[0]?.zip) ?? zip5(theirs[0]?.zip)
    const by = matchArea({ lat, lng, zip }, area, { zipAlso: opts.zipAlso })
    if (!by) continue
    const shown = done[0] ?? pinJob ?? theirs[0] ?? null
    out.push({
      contactId: ct.id, name: ct.name, phone: ct.mobile || ct.phone || null, email: ct.email || null,
      address: ct.address || shown?.address || null, city: ct.city || null, state: ct.state || null, zip: ct.zip || shown?.zip || null,
      lat, lng, by, located: hasPin, pastCustomer,
      job: shown ? { id: shown.id, number: shown.number ?? null, status: shown.status, completedAt: shown.completedAt ?? null, address: shown.address ?? null } : null,
    })
  }
  // Inside the shape first, then by name.
  out.sort((a, b) => (a.by === b.by ? a.name.localeCompare(b.name) : a.by === 'path' ? -1 : 1))
  return { customers: out, considered, located, unlocated: considered - located }
}
