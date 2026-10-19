// The dealership modules' raw SQL (RULEBOOK §2): advisory locks, case-blind matches, the rental-clash and rental
// figures, the parts-catalogue upsert and the unit search. Moved from templates/crm-rv/backend/src/routes/
// {salesLeads,repairOrders,rentals,oemParts,webhooks}.ts and services/{leadContact,search}.ts.
import { and, count, desc, eq, ilike, isNull, ne, notInArray, or, sql } from 'drizzle-orm'
import { contact, salesLead, unit, rentalReservation, catalogPart } from '../db/schema/index.ts'

const CLOSED = ['closed_won', 'closed_lost']

/** Hold `key` for the rest of the caller's transaction, so two requests on the same thing go one after the other. */
export async function advisoryLock(tx: any, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)
}

// ── Who a dealership lead belongs to (templates/crm-rv services/leadContact.ts) ──────────────────────────────────
// ONE rule for every door into the pipeline: an existing contact is reused by email, or by phone when nothing
// contradicts the match, and two copies arriving together are serialised on the customer's identity.

export interface LeadIdentity { name: string; email: string; phoneDigits: string }

/** Normalise what a door received into the identity the rules below compare. */
export function leadIdentityOf(o: { name?: unknown; email?: unknown; phone?: unknown }): LeadIdentity {
  const emailRaw = String(o.email ?? '').trim().toLowerCase()
  return {
    name: String(o.name ?? '').trim(),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : '',
    phoneDigits: String(o.phone ?? '').replace(/\D/g, '').slice(-10),
  }
}

/** One import at a time per customer identity in this company, for the rest of the transaction. */
export async function lockLeadIdentity(tx: any, companyId: string, id: LeadIdentity): Promise<void> {
  const identity = id.email || (id.phoneDigits.length === 10 ? id.phoneDigits : '') || id.name.toLowerCase()
  await advisoryLock(tx, `lead-contact:${companyId}:${identity}`)
}

/**
 * The existing contact this lead belongs to, or null when it is somebody new. Email alone is sufficient; a phone match
 * stands unless the incoming lead CONTRADICTS it (a different email, or a different name) — a shared phone is not a
 * shared identity (T42 → T58d).
 */
export async function findLeadContact(tx: any, companyId: string, id: LeadIdentity): Promise<any | null> {
  const { name, email, phoneDigits } = id
  let found: any = null
  if (email) {
    ;[found] = await tx.select().from(contact)
      .where(and(eq(contact.companyId, companyId), sql`lower(${contact.email}) = ${email}`)).limit(1)
  }
  if (!found && phoneDigits.length === 10) {
    const [byPhone] = await tx.select().from(contact)
      .where(and(eq(contact.companyId, companyId), sql`right(regexp_replace(coalesce(${contact.phone}, ''), '\\D', '', 'g'), 10) = ${phoneDigits}`)).limit(1)
    if (byPhone) {
      const theirEmail = String(byPhone.email || '').trim().toLowerCase()
      const emailsDiffer = !!email && !!theirEmail && theirEmail !== email
      const plain = (s: unknown) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
      const namesDiffer = !!plain(name) && !!plain(byPhone.name) && plain(byPhone.name) !== plain(name)
      if (!emailsDiffer && !namesDiffer) found = byPhone
    }
  }
  return found || null
}

// ── The pipeline ─────────────────────────────────────────────────────────────────────────────────────────────

/** An open lead for this contact on this unit (or with no unit), other than `selfId`. */
export async function openLeadOnUnit(tx: any, q: { companyId: string; contactId: string; unitId: string | null; selfId?: string | null }): Promise<{ id: string } | null> {
  const [row] = await tx.select({ id: salesLead.id }).from(salesLead).where(and(
    eq(salesLead.companyId, q.companyId),
    eq(salesLead.contactId, q.contactId),
    q.unitId ? eq(salesLead.unitId, q.unitId) : isNull(salesLead.unitId),
    notInArray(salesLead.stage, CLOSED),
    q.selfId ? ne(salesLead.id, q.selfId) : undefined,
  )).limit(1)
  return row ?? null
}

/**
 * The same lead sent again: an open lead for this contact from this source, made in the last `days` days, matching on
 * the unit when there is one and otherwise on its notes (an ADF re-send; a website form submitted twice).
 */
export async function recentOpenLead(tx: any, q: { companyId: string; contactId: string; source: string; days: number; unitId?: string | null; notes?: string | null }): Promise<any | null> {
  const match = q.unitId ? eq(salesLead.unitId, q.unitId) : q.notes ? eq(salesLead.notes, q.notes) : isNull(salesLead.notes)
  const [row] = await tx.select().from(salesLead).where(and(
    eq(salesLead.companyId, q.companyId),
    eq(salesLead.contactId, q.contactId),
    eq(salesLead.source, q.source),
    notInArray(salesLead.stage, CLOSED),
    sql`${salesLead.createdAt} > now() - make_interval(days => ${q.days})`,
    match,
  )).limit(1)
  return row ?? null
}

/** An available unit of this year, make and model (make and model case aside), for an ADF lead's interest. */
export async function availableUnitByModel(tx: any, companyId: string, year: number, make: string, model: string): Promise<{ id: string } | null> {
  const [row] = await tx.select({ id: unit.id }).from(unit)
    .where(and(eq(unit.companyId, companyId), eq(unit.year, year), sql`lower(${unit.make}) = ${make.toLowerCase()}`, sql`lower(${unit.modelName}) = ${model.toLowerCase()}`, eq(unit.status, 'available')))
    .limit(1)
  return row ?? null
}

/** This dealer's unit with exactly this stock number, case aside — never a guess from the model name. */
export async function unitByStockNumber(tx: any, companyId: string, stockNumber: string): Promise<{ id: string } | null> {
  const [row] = await tx.select({ id: unit.id }).from(unit)
    .where(and(eq(unit.companyId, companyId), sql`lower(${unit.stockNumber}) = ${stockNumber.toLowerCase()}`)).limit(1)
  return row ?? null
}

// ── Rentals ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Reservations out, reserved, and the takings of every booking that wasn't cancelled. */
export async function rentalSummary(db: any, companyId: string): Promise<{ active: number; reserved: number; revenue: number }> {
  const [s] = await db.select({
    active: sql<number>`count(*) filter (where ${rentalReservation.status} = 'out')`,
    reserved: sql<number>`count(*) filter (where ${rentalReservation.status} = 'reserved')`,
    revenue: sql<string>`coalesce(sum(${rentalReservation.total}) filter (where ${rentalReservation.status} <> 'cancelled'), 0)`,
  }).from(rentalReservation).where(eq(rentalReservation.companyId, companyId))
  return { active: Number(s?.active || 0), reserved: Number(s?.reserved || 0), revenue: Number(s?.revenue || 0) }
}

/**
 * Another live reservation on this unit whose held days overlap [start, until). A booking holds [pick-up, return); a
 * same-day rental holds its day.
 */
export async function rentalClash(tx: any, q: { companyId: string; unitId: string; start: string; until: string }): Promise<any | null> {
  const [row] = await tx.select().from(rentalReservation).where(and(
    eq(rentalReservation.companyId, q.companyId),
    eq(rentalReservation.unitId, q.unitId),
    notInArray(rentalReservation.status, ['returned', 'cancelled']),
    sql`${rentalReservation.startDate} < ${q.until}`,
    sql`(case when ${rentalReservation.endDate} > ${rentalReservation.startDate} then ${rentalReservation.endDate} else ${rentalReservation.startDate} + 1 end) > ${q.start}`,
  )).limit(1)
  return row ?? null
}

// ── The parts catalogue ──────────────────────────────────────────────────────────────────────────────────────

/** How many parts this dealer has imported (0 when none, or the read failed). */
export async function catalogPartCount(db: any, companyId: string): Promise<number> {
  try {
    const [r] = await db.select({ n: count() }).from(catalogPart).where(eq(catalogPart.companyId, companyId))
    return Number(r?.n || 0)
  } catch { return 0 }
}

/** Insert a batch of parts, updating any already there (same company, part number and OEM). */
export async function upsertCatalogParts(db: any, batch: any[]): Promise<void> {
  await db.insert(catalogPart).values(batch).onConflictDoUpdate({
    target: [catalogPart.companyId, catalogPart.partNumber, catalogPart.oem],
    set: {
      name: sql`excluded.name`, category: sql`excluded.category`,
      price: sql`excluded.price`, cost: sql`excluded.cost`, msrp: sql`excluded.msrp`,
      availability: sql`excluded.availability`, fitment: sql`excluded.fitment`,
      source: sql`excluded.source`, updatedAt: new Date(),
    },
  })
}

// ── Search ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Units by stock number, VIN, make, model, trim or year — the records a dealership searches most (RV T19 M7). */
export async function searchUnits(db: any, companyId: string, pattern: string, limit: number) {
  return db.select({ id: unit.id, year: unit.year, make: unit.make, modelName: unit.modelName, trim: unit.trim, stockNumber: unit.stockNumber, vin: unit.vin, status: unit.status })
    .from(unit)
    .where(and(
      eq(unit.companyId, companyId),
      or(
        ilike(unit.stockNumber, pattern), ilike(unit.vin, pattern), ilike(unit.make, pattern), ilike(unit.modelName, pattern), ilike(unit.trim, pattern),
        sql`cast(${unit.year} as text) like ${pattern}`,
      ),
    ))
    .orderBy(desc(unit.updatedAt))
    .limit(limit) as Promise<{ id: string; year: number | null; make: string | null; modelName: string | null; trim: string | null; stockNumber: string | null; vin: string | null; status: string }[]>
}
