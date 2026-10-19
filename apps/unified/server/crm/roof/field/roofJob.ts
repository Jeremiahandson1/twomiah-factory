// A roofing job made by the field group — a storm lead converted, a canvassing door that wants an inspection — and the
// homeowner it is for. Made the way roofing's job module makes one (server/crm/roof/jobs.ts, POST /): the number from
// the shared nextNumber with prefix ROOF, pad 4 (numeric, only forwards, locked against two creates at once), and the
// CRM's required `title` is the property address (docs/UNIFIED_ROOF_PLAN.md decision 2) — jobs.ts's insertRoofJob, the
// one way a roofing job is made, re-exported here for the field group.
//
// The template made the number two other ways, both wrong: storms took the text MAX of job_number (ROOF-10000 sorts
// below ROOF-9999, so 10000 was issued twice) and canvassing counted the company's jobs + 1 (a deleted job, or two
// doors logged at once, issued a number already on another job).
import { contact } from '../../../db/schema/index.ts'

/**
 * A homeowner's one `name` from what roofing wrote as first and last (decision 3): "first last", trimmed, and the
 * fallback when nothing was given.
 */
export const homeownerName = (given: unknown, fallback: string) => String(given ?? '').trim().replace(/\s+/g, ' ') || fallback

/** The contact a field module creates: roofing's lead_source is the CRM's `source`. */
export async function insertHomeowner(tx: any, companyId: string, v: {
  name: string; phone?: string | null; email?: string | null; address?: string | null; city?: string | null
  state?: string | null; zip?: string | null; source: string
}) {
  const [row] = await tx.insert(contact).values({
    companyId, name: v.name, phone: v.phone || null, email: v.email || null,
    address: v.address || null, city: v.city || null, state: v.state || null, zip: v.zip || null,
    source: v.source, propertyType: 'residential',
  } as any).returning()
  return row
}

/** A roofing job at `lead`: the one way a roofing job is made (../jobs.ts insertRoofJob). Run inside a transaction. */
export { insertRoofJob } from '../jobs.ts'
