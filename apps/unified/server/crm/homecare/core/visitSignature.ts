// The client's signature on every visit (row 5, care_visit_signature; not ready until the owner has tried it on a phone).
//
// The caregiver has the client sign on the phone — drawn with a finger, kept with the time the client signed. When the client cannot
// sign, the caregiver picks a reason from the agency's list instead (asleep, unable to hold a pen, refused, …) and the visit is still
// accounted for. When the agency switches "signature required" on, a LIVE clock-out waits until the visit has one or the other; a
// clock-out the phone saved while offline is already a fact, so it is recorded and flagged for the office (as for required tasks),
// and so is a clock-out by phone call (a caller cannot sign).
import { eq } from 'drizzle-orm'
import { company, visitSignature } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { OfflineSaves } from './offlineSaves.ts'

export const VISIT_SIGNATURE_FEATURE = 'care_visit_signature'

/** Why a client could not sign — the codes are stored, the labels are what every screen shows. */
export const NO_SIGNATURE_REASONS = [
  { code: 'asleep', label: 'Client was asleep' },
  { code: 'physical', label: 'Client cannot hold a pen (physical condition)' },
  { code: 'cognitive', label: 'Client cannot understand what they would be signing' },
  { code: 'refused', label: 'Client declined to sign' },
  { code: 'not_present', label: 'Client was out or not at home' },
  { code: 'ill', label: 'Client was unwell' },
  { code: 'other', label: 'Another reason (write it below)' },
] as const
export const reasonLabel = (code: string | null | undefined) => NO_SIGNATURE_REASONS.find((r) => r.code === code)?.label ?? (code || '')
/** The biggest drawing we keep: a finger scribble as an SVG data URI is a few KB; this stops a pasted photo. */
export const MAX_SIGNATURE_CHARS = 200_000

export interface SignatureSettings { required: boolean }
export interface SignatureState {
  signed: boolean; signedAt: Date | null; reasonCode: string | null; reasonLabel: string | null; reasonNote: string | null; signatureImage: string | null
}

export interface SignatureInput { signature?: unknown; reasonCode?: unknown; note?: unknown; savedAt?: unknown }
export type RecordResult = { ok: true; state: SignatureState | null } | { ok: false; message: string; code: string; fields?: Record<string, string> }

export function createVisitSignature(d: CrmDeps, deps: { offlineSaves: OfflineSaves }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, VISIT_SIGNATURE_FEATURE)

  async function settings(companyId: string): Promise<SignatureSettings> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return { required: ((row?.settings as any)?.clientSignature?.required) === true }
  }
  async function setSettings(companyId: string, patch: Partial<SignatureSettings>): Promise<SignatureSettings> {
    const now = await settings(companyId)
    const next = { required: patch.required !== undefined ? patch.required === true : now.required }
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await d.db.update(company).set({ settings: { ...((row?.settings as object) || {}), clientSignature: next } as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return next
  }

  /** What is recorded for this visit (null when nothing). */
  async function forVisit(companyId: string, timeEntryId: string): Promise<SignatureState | null> {
    const [r] = await d.db.select().from(visitSignature).where(eq(visitSignature.timeEntryId, timeEntryId)).limit(1)
    if (!r || r.companyId !== companyId) return null
    return { signed: !!r.signatureImage, signedAt: r.signedAt, reasonCode: r.reasonCode, reasonLabel: r.reasonCode ? reasonLabel(r.reasonCode) : null, reasonNote: r.reasonNote, signatureImage: r.signatureImage }
  }

  /** True when this visit still needs the client's signature (or a reason): the agency requires it and nothing is recorded. */
  async function missingFor(companyId: string, timeEntryId: string): Promise<boolean> {
    if (!(await enabled(companyId)) || !(await settings(companyId)).required) return false
    return !(await forVisit(companyId, timeEntryId))
  }

  /**
   * Record the signature (or the reason) for a visit, replacing an earlier one. Used by the signature route and by the clock-out
   * (which carries it, so a visit clocked out offline still has it). Checks the input and says what is wrong in plain words.
   */
  async function record(companyId: string, entry: { id: string; clientId: string }, by: string, input: SignatureInput): Promise<RecordResult> {
    const image = typeof input.signature === 'string' && input.signature.trim() ? input.signature.trim() : null
    const code = typeof input.reasonCode === 'string' && input.reasonCode.trim() ? input.reasonCode.trim() : null
    if (!image && !code) return { ok: false, message: 'Have the client sign, or say why they could not.', code: 'signature_or_reason' }
    if (image && code) return { ok: false, message: 'Record either the signature or the reason, not both.', code: 'signature_or_reason' }
    if (image && (!/^data:image\/(svg\+xml|png|jpeg);/.test(image) || image.length > MAX_SIGNATURE_CHARS)) return { ok: false, message: 'That signature could not be read. Ask the client to sign again.', code: 'bad_signature', fields: { signature: 'Sign again' } }
    const note = input.note && String(input.note).trim() ? String(input.note).trim().slice(0, 500) : null
    if (code && !NO_SIGNATURE_REASONS.some((r) => r.code === code)) return { ok: false, message: 'Pick one of the reasons on the list.', code: 'bad_reason', fields: { reasonCode: 'Pick a reason' } }
    if (code === 'other' && !note) return { ok: false, message: 'Write the reason in the note.', code: 'reason_note_required', fields: { note: 'Write the reason' } }
    // Signed on a phone without signal: the time is when the client signed, not when it arrived (care_offline_saves).
    let signedAt = new Date()
    if (input.savedAt !== undefined && await deps.offlineSaves.enabled(companyId)) {
      const t = deps.offlineSaves.savedTime(input.savedAt)
      if ('problem' in t) return { ok: false, message: t.problem, code: 'bad_saved_time' }
      if (t.at) signedAt = t.at
    }
    const values = { signatureImage: image, signedAt: image ? signedAt : null, reasonCode: code, reasonNote: code ? note : null, recordedById: by }
    await d.db.insert(visitSignature).values({ companyId, timeEntryId: entry.id, clientId: entry.clientId, ...values })
      .onConflictDoUpdate({ target: [visitSignature.timeEntryId], set: { ...values, updatedAt: new Date() } })
    return { ok: true, state: await forVisit(companyId, entry.id) }
  }

  return { enabled, settings, setSettings, forVisit, missingFor, record }
}
export type VisitSignatureCore = ReturnType<typeof createVisitSignature>
