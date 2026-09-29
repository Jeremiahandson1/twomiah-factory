import { db } from '../../db/index.ts'
import { clientProfile, serviceRecord } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

/**
 * The formulas a CLIENT is kept on.
 *
 * A formula used to exist in exactly one place: on a service_record, which hangs off an appointment.
 * That made a colourist's own work hostage to the status of a booking. Cancelling a completed visit
 * had to choose between two bad outcomes — delete the record, and destroy the formula written on it;
 * or keep it, and leave a visit that never happened on the client's chart, counted in their visits and
 * driving a "time to come back" reminder for an appointment the salon had agreed did not take place.
 *
 * Mangomint does not have that problem, because its colour formulas are PINNED CLIENT NOTES. They
 * belong to the person. A visit is only ever a record of when one was used.
 *
 * So the client keeps their own set here, and the per-visit record goes on logging what was actually
 * mixed on the day — which is real history and worth keeping. The two answer different questions:
 * "what do I mix for this client?" and "what did we do in March?".
 *
 * With that in place, cancelling a visit no longer has to choose. The formula is kept on the client
 * FIRST, then the record goes, and nothing clinical is lost.
 */

/**
 * The note onVisitCompleted puts on every record it writes.
 *
 * It lives HERE, not in the route that writes it, because this module is the one that has to decide
 * what counts as a stylist's own work — and that decision must be made once. The first version left
 * it to each caller: the repair stripped the line and the cancel path did not, so cancelling an
 * untouched visit put "Logged automatically when the appointment was completed" on a client's card
 * as if a colourist had typed it. Caught by a test, not by review.
 */
export const AUTO_VISIT_NOTE = 'Logged automatically when the appointment was completed.'

/** How a formula rescued from a cancelled visit is labelled on the client's card. */
export const CANCELLED_VISIT_LABEL = 'Kept from a cancelled appointment'

/** The line the OLDER repair stamped on records it kept back. Recognised so it is never kept as prose. */
export const REPAIR_MARK = 'The appointment this was recorded against was cancelled. Kept because it carries a formula or a note.'

export interface KeptFormula {
  id: string
  /** What a stylist would call it — "Root touch-up 6N". */
  label: string
  /** The mix itself, the same shape service_record.formula uses. */
  formula: any[]
  developerVolume?: string | null
  processingMin?: number | null
  /** A stylist's own words, kept alongside. A note with no formula is still worth keeping. */
  note?: string | null
  savedAt: string
  /** The visit it was lifted from, when it came off one. */
  savedFromRecordId?: string | null
  lastUsedAt?: string | null
}

/**
 * The mix, in the one shape everything downstream reads: a list of steps, each an object with
 * `product`, `shade` and `parts`.
 *
 * RR0929 N7: a formula sent as a plain STRING was saved with a 200 and arrived empty.
 * `hasSubstance` wrapped a non-array into `[input.formula]` and said yes; `keepFormula` then did
 * `Array.isArray(input.formula) ? input.formula : []` and threw it away. Two functions reading the
 * same field two different ways, so the request passed the check that decides whether there is
 * anything to keep and then had the thing itself deleted. The stylist got a formula card with
 * nothing on it.
 *
 * They now share this, which is the point — the disagreement was the bug, not either half of it.
 *
 * A string becomes one step rather than a refusal. The UI never sends one (it posts either
 * structured steps or `fromRecordId`), so nothing is being rescued from itself here; it is an API
 * caller writing what a stylist would write, and a 400 would lose what they typed for a shape
 * they had no way to know. `{ product: 'the string' }` is what the card already renders.
 */
export function normaliseFormula(raw: any): any[] {
  const one = (v: any): any | null => {
    if (typeof v === 'string') { const s = v.trim(); return s ? { product: s } : null }
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
    // A number or a boolean says nothing a step could be read from.
    return null
  }
  if (Array.isArray(raw)) return raw.map(one).filter(Boolean) as any[]
  const single = one(raw)
  return single ? [single] : []
}

/** Is there anything here worth keeping? An empty mix with no note is not a formula. */
export function hasSubstance(input: { formula?: any; note?: any; developerVolume?: any; processingMin?: any }): boolean {
  if (normaliseFormula(input.formula).length > 0) return true
  if (String(input.note || '').trim()) return true
  if (String(input.developerVolume || '').trim()) return true
  if (Number(input.processingMin) > 0) return true
  return false
}

const asList = (raw: any): KeptFormula[] => (Array.isArray(raw) ? raw : []).filter((f) => f && typeof f === 'object')

/** The same mix, saved twice, is one formula. Compared on the parts that define it, not on the label. */
function sameMix(a: KeptFormula, b: Partial<KeptFormula>): boolean {
  const norm = (v: any) => JSON.stringify(Array.isArray(v) ? v : []).toLowerCase()
  return norm(a.formula) === norm(b.formula)
    && String(a.developerVolume || '') === String(b.developerVolume || '')
    && String(a.note || '').trim() === String(b.note || '').trim()
}

export async function listFormulas(companyId: string, contactId: string): Promise<KeptFormula[]> {
  const [profile] = await db.select({ formulas: clientProfile.formulas }).from(clientProfile)
    .where(and(eq(clientProfile.contactId, contactId), eq(clientProfile.companyId, companyId))).limit(1)
  return asList(profile?.formulas)
}

/**
 * Keep a formula on the client, creating their profile row if this is the first thing ever kept on
 * them — the same on-demand upsert the profile editor uses, so a client captured by the website lead
 * form can be kept on a formula the first time they sit down.
 *
 * Idempotent by mix: keeping the same formula twice updates `lastUsedAt` rather than filling the card
 * with duplicates. A salon repeats a formula every six weeks; a list that grows a row each time is a
 * list nobody reads.
 */
export async function keepFormula(
  companyId: string,
  contactId: string,
  input: Partial<KeptFormula> & { label?: string },
): Promise<{ kept: KeptFormula; created: boolean } | null> {
  if (!hasSubstance(input)) return null

  const entry: KeptFormula = {
    id: createId(),
    label: String(input.label || '').trim().slice(0, 120) || 'Formula',
    // The same normaliser hasSubstance used to decide there was something here. (RR0929 N7)
    formula: normaliseFormula(input.formula),
    developerVolume: input.developerVolume ? String(input.developerVolume).slice(0, 60) : null,
    processingMin: Number.isFinite(Number(input.processingMin)) && Number(input.processingMin) > 0 ? Math.round(Number(input.processingMin)) : null,
    note: input.note ? String(input.note).slice(0, 2000) : null,
    savedAt: new Date().toISOString(),
    savedFromRecordId: input.savedFromRecordId || null,
    lastUsedAt: input.lastUsedAt || new Date().toISOString(),
  }

  const [profile] = await db.select().from(clientProfile)
    .where(and(eq(clientProfile.contactId, contactId), eq(clientProfile.companyId, companyId))).limit(1)

  const existing = asList(profile?.formulas)
  const already = existing.find((f) => sameMix(f, entry))
  if (already) {
    const next = existing.map((f) => (f.id === already.id ? { ...f, lastUsedAt: entry.lastUsedAt, label: f.label || entry.label } : f))
    await db.update(clientProfile).set({ formulas: next, updatedAt: new Date() } as any).where(eq(clientProfile.id, profile!.id))
    return { kept: { ...already, lastUsedAt: entry.lastUsedAt! }, created: false }
  }

  // Newest first, and capped: a client card is for reaching, not for archiving. The per-visit records
  // remain the full history.
  const next = [entry, ...existing].slice(0, 50)
  if (profile) {
    await db.update(clientProfile).set({ formulas: next, updatedAt: new Date() } as any).where(eq(clientProfile.id, profile.id))
  } else {
    await db.insert(clientProfile).values({ id: createId(), contactId, companyId, formulas: next } as any)
  }
  return { kept: entry, created: true }
}

/** Forget one. The visit records it was ever used on are untouched. */
export async function forgetFormula(companyId: string, contactId: string, formulaId: string): Promise<boolean> {
  const [profile] = await db.select().from(clientProfile)
    .where(and(eq(clientProfile.contactId, contactId), eq(clientProfile.companyId, companyId))).limit(1)
  if (!profile) return false
  const existing = asList(profile.formulas)
  const next = existing.filter((f) => f.id !== formulaId)
  if (next.length === existing.length) return false
  await db.update(clientProfile).set({ formulas: next, updatedAt: new Date() } as any).where(eq(clientProfile.id, profile.id))
  return true
}

/**
 * Lift whatever a visit record is carrying onto the client, before the record goes.
 *
 * This is what lets the cancel path stop compromising: it no longer has to keep a phantom visit in
 * order to keep a stylist's work. Returns null when the record held nothing worth keeping, which is
 * the ordinary case for a visit the system logged and nobody touched.
 */
/**
 * Lift a visit's formula onto the client's card.
 *
 * RR0929 N6: this returned `kept?.kept ?? null` — throwing away the `created` flag keepFormula had
 * just worked out — and the route then hardcoded `created: true`. So keeping the same visit twice
 * said "Kept on the card" both times, while the card correctly re-dated the one row it already
 * had. The screen was already written to say "Already on the card — re-dated as used again" when
 * told; it was never told.
 */
export async function keepFromRecord(companyId: string, record: any, why: string): Promise<{ kept: KeptFormula; created: boolean } | null> {
  if (!record) return null
  // Only a person's words are kept. The system's own line, and the line an older build's repair
  // stamped on top of it, are both stripped — a card is for what a stylist wrote, not for the
  // product's housekeeping.
  let note = String(record.notes || '').trim()
  if (note.endsWith(REPAIR_MARK)) note = note.slice(0, -REPAIR_MARK.length).trim()
  if (note === AUTO_VISIT_NOTE) note = ''
  const kept = await keepFormula(companyId, record.contactId, {
    label: why,
    formula: record.formula,
    developerVolume: record.developerVolume,
    processingMin: record.processingMin,
    note: note || null,
    savedFromRecordId: record.id,
    lastUsedAt: record.performedAt ? new Date(record.performedAt).toISOString() : undefined,
  })
  return kept
}

/** Read a visit record by id, scoped to the company — the shape keepFromRecord wants. */
export async function recordForKeeping(companyId: string, recordId: string) {
  const [row] = await db.select().from(serviceRecord)
    .where(and(eq(serviceRecord.id, recordId), eq(serviceRecord.companyId, companyId))).limit(1)
  return row || null
}
