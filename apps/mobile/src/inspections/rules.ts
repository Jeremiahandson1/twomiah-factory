/**
 * Inspections on the phone, as pure rules (no screen, no network). Tested by tests/mobile/inspections-phone.test.ts.
 *
 * The crew member on site opens the job, sees the project's inspections, answers the checklist line by line (Pass / Fail / N/A, a
 * note, photos) and has the customer sign what was answered. The server is the same one the office uses
 * (apps/unified/server/crm/siteRecords/inspectionChecklists.ts):
 *   GET  /api/inspections?projectId=…                      inspections:read        the project's visits (+ checklist counts)
 *   GET  /api/inspection-checklists/:id                    inspections:read        the visit, its lines and photos
 *   PUT  /api/inspection-checklists/:id/items/:itemId      inspections:answer|update   { result, note }
 *   POST /api/inspection-checklists/:id/photos             inspections:answer|update   multipart `photo`
 *   POST /api/inspection-checklists/:id/sign               inspections:answer|update   { signature, signedBy, consent }
 * Everything is behind the business's own switches — Inspections on the Phone (phone_inspections) for the card and the screen,
 * Inspection Sign-off (inspection_signature) for the customer's signature — and the same permission the server checks.
 */

export type Result = 'pending' | 'pass' | 'fail' | 'na'
export interface Line { id: string; label: string; result: Result; note: string | null }

export const FEATURE_PHONE = 'phone_inspections'
export const FEATURE_SIGN = 'inspection_signature'

/** The words on the three answers, in the order a person reads them. */
export const ANSWERS: Array<{ result: Exclude<Result, 'pending'>; label: string }> = [
  { result: 'pass', label: 'Pass' },
  { result: 'fail', label: 'Fail' },
  { result: 'na', label: 'Not applicable' },
]

/** The visits card on the job and the screen behind it: the switch is on and this seat may read inspections. */
export const showsInspections = (hasFeature: (f: string) => boolean, can: (p: string) => boolean) =>
  hasFeature(FEATURE_PHONE) && can('inspections:read')

/** Answering, adding a photo and signing: the crew right, or the office's own (the server accepts either). */
export const mayAnswer = (can: (p: string) => boolean) => can('inspections:answer') || can('inspections:update')

/** The signature box: the sign-off switch is on and this seat may answer. */
export const showsSignature = (hasFeature: (f: string) => boolean, can: (p: string) => boolean) =>
  hasFeature(FEATURE_SIGN) && mayAnswer(can)

/** A failed line has to say what is wrong (the server refuses it otherwise, and makes the punch-list item from these words). */
export const failNeedsWords = (note: string | null | undefined) => (note || '').trim().length < 3

/** What to send for one tap on an answer, or the sentence that says why not yet. */
export function answerRequest(inspectionId: string, line: Pick<Line, 'id'>, result: Exclude<Result, 'pending'>, note: string | null | undefined):
  { path: string; body: { result: string; note: string | null } } | { problem: string } {
  const words = (note || '').trim()
  if (result === 'fail' && failNeedsWords(words)) return { problem: 'Say what is wrong first, in the box under the line.' }
  return { path: `/api/inspection-checklists/${inspectionId}/items/${line.id}`, body: { result, note: words || null } }
}

export function progress(lines: Array<Pick<Line, 'result'>>) {
  const total = lines.length
  const answered = lines.filter((l) => l.result !== 'pending').length
  const failed = lines.filter((l) => l.result === 'fail').length
  return { total, answered, failed, left: total - answered }
}

/** The customer can sign when there is a checklist and every line has an answer. */
export const readyToSign = (lines: Array<Pick<Line, 'result'>>) => lines.length > 0 && lines.every((l) => l.result !== 'pending')

/** What the screen says about where the checklist stands. */
export function standing(lines: Array<Pick<Line, 'result'>>, signed: boolean): string {
  if (signed) return 'Signed'
  const p = progress(lines)
  if (!p.total) return 'No checklist yet'
  if (p.left) return `${p.answered} of ${p.total} answered`
  return p.failed ? `All answered — ${p.failed} failed` : 'All answered'
}

/** The send for the customer's signature, or the sentence that says what is missing. */
export function signRequest(inspectionId: string, e: { signature: string | null; signedBy: string; consent: boolean }):
  { path: string; body: { signature: string; signedBy: string; consent: true } } | { problem: string } {
  if (!e.signedBy.trim()) return { problem: 'Type the customer\'s full name.' }
  if (!e.consent) return { problem: 'The customer has to agree to sign electronically.' }
  if (!e.signature) return { problem: 'The customer has to sign in the box.' }
  return { path: `/api/inspection-checklists/${inspectionId}/sign`, body: { signature: e.signature, signedBy: e.signedBy.trim(), consent: true } }
}

/** A job's inspections are sent in order with the job's other moves, so a refusal leads back to the job. */
export const recordKeyFor = (jobId: string) => `job:${jobId}`

/** The line on the job's card for one visit. */
export function visitLine(v: { type?: string; number?: string; status?: string; signedBy?: string | null; checklist?: { total: number; answered: number; failed: number } | null }) {
  const c = v.checklist
  const where = c && c.total ? `${c.answered} of ${c.total} answered` : 'No checklist'
  return { title: `${v.type || 'Inspection'}${v.number ? ` · ${v.number}` : ''}`, detail: v.signedBy ? `Signed by ${v.signedBy}` : where }
}
