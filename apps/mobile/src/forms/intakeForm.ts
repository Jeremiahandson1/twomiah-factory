/**
 * Filling a salon intake or consent form in with the client, on the phone (apps/unified server/crm/salon/intakeForms.ts, POST /api/intake-forms/:id/fill).
 * Pure rules — no React, no native modules — so tests/mobile/intake-form.test.ts holds them to the server's own:
 *   · what is still missing before it can be sent (the server asks the same and says the same words);
 *   · what is sent: JSON the offline queue can keep (src/offline), or — when a photo or file is attached, which is too big to wait in the
 *     phone's list — a multipart upload that needs signal.
 */
export type QuestionType = 'text' | 'longtext' | 'yesno' | 'choice' | 'consent' | 'file' | 'photo'
export interface Question { id: string; label: string; type: QuestionType; required: boolean; options?: string[] }
export interface PhoneForm { id: string; name: string; kind: 'intake' | 'consent'; intro: string | null; questions: Question[]; signature: 'typed' | 'drawn'; active: boolean }
export interface Filled {
  /** question id → text answer ('yes' / 'no' for yes-no, '1' for an agreement ticked, the picked choice) */
  answers: Record<string, string>
  /** question id → the picture's address on the phone (photo and file questions) */
  photos: Record<string, string>
  signedName: string
  /** the pad's drawing (an image data URI), when the form is signed by drawing */
  signature: string | null
}

export const isPictureQuestion = (q: Question) => q.type === 'photo' || q.type === 'file'
const drawn = (f: Pick<PhoneForm, 'kind' | 'signature'>) => f.kind === 'consent' && f.signature === 'drawn'

/** The first thing still missing, in the server's words, or null when it can be sent. */
export function missing(form: PhoneForm, v: Filled): string | null {
  for (const q of form.questions) {
    if (isPictureQuestion(q)) {
      if (q.required && !v.photos[q.id]) return q.type === 'photo' ? `Please attach a photo for “${q.label}”.` : `Please attach a file for “${q.label}”.`
      continue
    }
    const a = String(v.answers[q.id] ?? '').trim()
    if (q.required && !a) return q.type === 'consent' ? `Please tick “${q.label}” to continue.` : `Please answer “${q.label}”.`
  }
  if (form.kind === 'consent') {
    if (drawn(form) && !v.signature) return 'Please sign in the box with your finger or mouse.'
    if (v.signedName.trim().length < 2) return drawn(form) ? 'Please type your full name under your signature.' : 'Please type your full name to sign.'
  }
  return null
}

/** True when anything attached has to travel as a file (so it cannot wait in the offline list). */
export const needsUpload = (form: PhoneForm, v: Filled) => form.questions.some((q) => isPictureQuestion(q) && !!v.photos[q.id])

/** The JSON body the offline queue keeps (no pictures). */
export function jsonBody(form: PhoneForm, contactId: string, v: Filled) {
  const answers: Record<string, string> = {}
  for (const q of form.questions) if (!isPictureQuestion(q) && String(v.answers[q.id] ?? '').trim()) answers[q.id] = String(v.answers[q.id]).trim()
  return { contactId, answers, signedName: v.signedName.trim(), ...(drawn(form) && v.signature ? { signature: v.signature } : {}) }
}

/** The multipart fields (everything but the files, which are appended as `f_<question id>`). */
export function uploadFields(form: PhoneForm, contactId: string, v: Filled): Record<string, string> {
  const body = jsonBody(form, contactId, v)
  return { contactId, answers: JSON.stringify(body.answers), signedName: body.signedName, ...('signature' in body ? { signature: body.signature as string } : {}) }
}

/** The words for where a client stands with a form (the chart's Forms section). */
export function standingWords(s: { state: string; expiresOn?: string | null; requested?: boolean }, day: (d: string) => string = (d) => d): string {
  const base = s.state === 'valid' ? (s.expiresOn ? `Filled in — good until ${day(s.expiresOn)}` : 'Filled in') : s.state === 'expired' ? 'Answers have run out' : 'Not filled in'
  return s.requested && s.state !== 'valid' ? `${base} · link sent` : base
}
