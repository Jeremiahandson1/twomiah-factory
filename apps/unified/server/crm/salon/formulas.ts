// The formulas a CLIENT is kept on. Moved from templates/crm-salon/backend/src/services/clientFormulas.ts.
//
// A formula used to exist only on a service_record, which hangs off an appointment, so a colourist's own work was
// hostage to the status of a booking. The client keeps their own set here (as pinned client notes), and the per-visit
// record goes on logging what was mixed on the day. The two answer different questions: "what do I mix for this
// client?" and "what did we do in March?". Cancelling a visit then lifts its formula onto the client FIRST, and the
// record goes.
import { and, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { clientProfile, serviceRecord } from '../../db/schema/index.ts'

/** The note a completed appointment's automatic visit record carries. Decided here, once (FULL0929 F1). */
export const AUTO_VISIT_NOTE = 'Logged automatically when the appointment was completed.'

/** How a formula rescued from a cancelled visit is labelled on the client's card. */
export const CANCELLED_VISIT_LABEL = 'Kept from a cancelled appointment'

/** The line the OLDER repair stamped on records it kept back. Recognised so it is never kept as prose. */
export const REPAIR_MARK = 'The appointment this was recorded against was cancelled. Kept because it carries a formula or a note.'

/** One step of a mix: a product, a shade and its parts — whatever the stylist wrote. */
export type FormulaStep = Record<string, unknown>

export interface KeptFormula {
  id: string
  /** What a stylist would call it — "Root touch-up 6N". */
  label: string
  /** The mix itself, the same shape service_record.formula uses. */
  formula: FormulaStep[]
  developerVolume?: string | null
  processingMin?: number | null
  /** A stylist's own words, kept alongside. */
  note?: string | null
  savedAt: string
  savedFromRecordId?: string | null
  lastUsedAt?: string | null
}

/**
 * The mix, in the one shape everything downstream reads: a list of step objects (RR0929 N7). A string becomes one step
 * rather than a refusal; a number or a boolean says nothing a step could be read from.
 */
export function normaliseFormula(raw: unknown): FormulaStep[] {
  const one = (v: unknown): FormulaStep | null => {
    if (typeof v === 'string') { const s = v.trim(); return s ? { product: s } : null }
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as FormulaStep
    return null
  }
  if (Array.isArray(raw)) return raw.map(one).filter((x): x is FormulaStep => !!x)
  const single = one(raw)
  return single ? [single] : []
}

/** Is there anything here worth keeping? An empty mix with no note is not a formula. */
export function hasSubstance(input: { formula?: unknown; note?: unknown; developerVolume?: unknown; processingMin?: unknown }): boolean {
  if (normaliseFormula(input.formula).length > 0) return true
  if (String(input.note || '').trim()) return true
  if (String(input.developerVolume || '').trim()) return true
  if (Number(input.processingMin) > 0) return true
  return false
}

const asList = (raw: unknown): KeptFormula[] => (Array.isArray(raw) ? raw : []).filter((f) => f && typeof f === 'object')

/** The same mix, saved twice, is one formula — compared on what defines it, not on the label. */
function sameMix(a: KeptFormula, b: Partial<KeptFormula>): boolean {
  const norm = (v: unknown) => JSON.stringify(Array.isArray(v) ? v : []).toLowerCase()
  return norm(a.formula) === norm(b.formula)
    && String(a.developerVolume || '') === String(b.developerVolume || '')
    && String(a.note || '').trim() === String(b.note || '').trim()
}

/** A visit record, as far as keeping its formula goes. */
export interface VisitForKeeping {
  id: string
  contactId: string | null
  formula?: unknown
  developerVolume?: string | null
  processingMin?: number | null
  notes?: string | null
  performedAt?: unknown
}

export type FormulaInput = Partial<Omit<KeptFormula, 'formula'>> & { label?: string; formula?: unknown }

export function createClientFormulas(db: any) {
  async function listFormulas(companyId: string, contactId: string): Promise<KeptFormula[]> {
    const [profile] = await db.select({ formulas: clientProfile.formulas }).from(clientProfile)
      .where(and(eq(clientProfile.contactId, contactId), eq(clientProfile.companyId, companyId))).limit(1)
    return asList(profile?.formulas)
  }

  /**
   * Keep a formula on the client, creating their profile row if this is the first thing ever kept on them. Idempotent
   * by mix: keeping the same formula twice re-dates it rather than filling the card with duplicates.
   */
  async function keepFormula(companyId: string, contactId: string, input: FormulaInput): Promise<{ kept: KeptFormula; created: boolean } | null> {
    if (!hasSubstance(input)) return null

    const entry: KeptFormula = {
      id: createId(),
      label: String(input.label || '').trim().slice(0, 120) || 'Formula',
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
      await db.update(clientProfile).set({ formulas: next, updatedAt: new Date() } as any).where(eq(clientProfile.id, profile.id))
      return { kept: { ...already, lastUsedAt: entry.lastUsedAt }, created: false }
    }

    // Newest first, and capped: a client card is for reaching, not for archiving.
    const next = [entry, ...existing].slice(0, 50)
    if (profile) {
      await db.update(clientProfile).set({ formulas: next, updatedAt: new Date() } as any).where(eq(clientProfile.id, profile.id))
    } else {
      await db.insert(clientProfile).values({ id: createId(), contactId, companyId, formulas: next } as any)
    }
    return { kept: entry, created: true }
  }

  /** Forget one. The visit records it was ever used on are untouched. */
  async function forgetFormula(companyId: string, contactId: string, formulaId: string): Promise<boolean> {
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
   * Lift a visit's formula onto the client's card, reporting whether the card gained a row or re-dated one it already
   * had (RR0929 N6). Only a person's words are kept: the system's own line and the old repair's are stripped.
   */
  async function keepFromRecord(companyId: string, record: VisitForKeeping | null, why: string): Promise<{ kept: KeptFormula; created: boolean } | null> {
    if (!record || !record.contactId) return null
    let note = String(record.notes || '').trim()
    if (note.endsWith(REPAIR_MARK)) note = note.slice(0, -REPAIR_MARK.length).trim()
    if (note === AUTO_VISIT_NOTE) note = ''
    return keepFormula(companyId, record.contactId, {
      label: why,
      formula: record.formula,
      developerVolume: record.developerVolume,
      processingMin: record.processingMin,
      note: note || null,
      savedFromRecordId: record.id,
      lastUsedAt: record.performedAt ? new Date(record.performedAt as string).toISOString() : undefined,
    })
  }

  /** A visit record by id, scoped to the company — the shape keepFromRecord wants. */
  async function recordForKeeping(companyId: string, recordId: string) {
    const [row] = await db.select().from(serviceRecord)
      .where(and(eq(serviceRecord.id, recordId), eq(serviceRecord.companyId, companyId))).limit(1)
    return (row || null) as (typeof serviceRecord.$inferSelect) | null
  }

  return { listFormulas, keepFormula, forgetFormula, keepFromRecord, recordForKeeping }
}

export type ClientFormulas = ReturnType<typeof createClientFormulas>
