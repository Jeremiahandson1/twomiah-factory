/**
 * A job checklist's answers on the phone — pure TypeScript, tested by tests/mobile/checklist-answers.test.ts.
 *
 * The server (apps/unified/server/crm/field/checklistRoutes.ts) is the judge of every answer; this is the same rule run
 * BEFORE sending, so a tech with no signal learns "Filter size is not answered" on the spot instead of finding a refused
 * save in Waiting to send later. It also builds the request, in one place: a photo question's pictures are never in the body,
 * only the camera's file addresses under `$photos` with `keys` saying which question each is for (src/offline/localPhotos.ts
 * uploads them just before the send and the server folds them back onto their questions).
 */
import type { NewItem } from '../offline/engine'

export type QuestionType = 'pass_fail' | 'yes_no' | 'text' | 'dropdown' | 'multi_select' | 'number' | 'date' | 'photo' | 'signature' | 'section'
export interface Question { id: string; label: string; type: QuestionType; required: boolean; options?: string[] }
/** What the tech has entered for one question so far. */
export interface Draft { value?: string; choices?: string[]; photoUris?: string[]; signature?: string | null }
export type Drafts = Record<string, Draft | undefined>

export const MAX_QUESTION_PHOTOS = 6

/** The fixed answers of the two tap-to-answer kinds. */
export const CHOICES: Partial<Record<QuestionType, Array<{ v: string; label: string }>>> = {
  pass_fail: [{ v: 'pass', label: 'Pass' }, { v: 'fail', label: 'Fail' }, { v: 'attention', label: 'Needs attention' }],
  yes_no: [{ v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }],
}

/** A heading: shown, never answered. */
export const isHeading = (q: Question) => q.type === 'section'

const isDay = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

/** Is this question answered? (Whether it may be left blank is `required`.) */
export function isAnswered(q: Question, d: Draft | undefined): boolean {
  if (!d) return false
  switch (q.type) {
    case 'section': return true
    case 'multi_select': return (d.choices ?? []).length > 0
    case 'photo': return (d.photoUris ?? []).length > 0
    case 'signature': return !!d.signature
    default: return !!(d.value ?? '').trim()
  }
}

/** What is wrong with one answer, in words for the tech — or null. A blank answer is not "wrong" here (see problemsFor). */
export function answerProblem(q: Question, d: Draft | undefined): string | null {
  if (!d) return null
  const v = (d.value ?? '').trim()
  switch (q.type) {
    case 'dropdown': return v && !(q.options ?? []).includes(v) ? 'Pick one of the choices' : null
    case 'multi_select': return (d.choices ?? []).some((c) => !(q.options ?? []).includes(c)) ? 'Pick from the choices' : null
    case 'number': return v && !/^-?\d{1,15}(\.\d{1,6})?$/.test(v) ? 'Type a number, such as 12 or 3.5' : null
    case 'date': return v && !isDay(v) ? 'Pick a date' : null
    case 'photo': return (d.photoUris ?? []).length > MAX_QUESTION_PHOTOS ? `At most ${MAX_QUESTION_PHOTOS} photos` : null
    default: return null
  }
}

/** Question id → what to tell the tech, for every question that cannot be sent as it is. Empty = ready. */
export function problemsFor(questions: Question[], drafts: Drafts): Record<string, string> {
  const out: Record<string, string> = {}
  for (const q of questions) {
    if (isHeading(q)) continue
    const bad = answerProblem(q, drafts[q.id])
    if (bad) out[q.id] = bad
    else if (q.required && !isAnswered(q, drafts[q.id])) out[q.id] = 'Required'
  }
  return out
}

/** Headings with the questions under them, in order (the screen draws one card per group). */
export function groupBySection(questions: Question[]): Array<{ heading: string | null; items: Question[] }> {
  const groups: Array<{ heading: string | null; items: Question[] }> = []
  for (const q of questions) {
    if (isHeading(q)) { groups.push({ heading: q.label, items: [] }); continue }
    if (!groups.length) groups.push({ heading: null, items: [] })
    groups[groups.length - 1].items.push(q)
  }
  return groups.filter((g) => g.items.length > 0)
}

export interface SubmitInput {
  jobId: string
  /** One id for this send, kept until sent (the server saves one copy however often it arrives). */
  sendId: string
  templateId: string
  label: string
  questions: Question[]
  drafts: Drafts
  notes?: string
  /** The whole-checklist signature when the checklist wants the customer's (a signature QUESTION is an answer, not this). */
  signature?: { signature: string; signedBy: string; consent: true }
  recordKey: string
}

/** The save the screen hands the offline queue. */
export function submitRequest(i: SubmitInput): NewItem {
  const uris: string[] = []
  const keys: string[] = []
  const answers = i.questions.filter((q) => !isHeading(q)).map((q) => {
    const d = i.drafts[q.id]
    switch (q.type) {
      case 'multi_select': return { id: q.id, choices: d?.choices ?? [] }
      case 'signature': return { id: q.id, ...(d?.signature ? { signature: d.signature } : {}) }
      case 'photo':
        for (const u of (d?.photoUris ?? []).slice(0, MAX_QUESTION_PHOTOS)) { uris.push(u); keys.push(q.id) }
        return { id: q.id }
      default: return { id: q.id, value: (d?.value ?? '').trim() }
    }
  })
  const body: Record<string, unknown> = {
    id: i.sendId, templateId: i.templateId, answers,
    ...(i.notes && i.notes.trim() ? { overallNotes: i.notes.trim() } : {}),
    ...(i.signature ? { signature: i.signature } : {}),
  }
  if (uris.length) body.$photos = { uploadTo: `/api/checklists/job/${encodeURIComponent(i.jobId)}/photos`, uris, keys }
  return { method: 'POST', path: `/api/checklists/job/${encodeURIComponent(i.jobId)}/submit`, body, recordKey: i.recordKey, label: i.label }
}

/** What a filled-in answer reads as on the signing screen and in lists: "Filter size: 20x25", a photo as its count. */
export function answerLine(item: { label: string; type?: string; value?: string; choices?: string[]; photos?: string[]; signed?: boolean; signature?: string }): string {
  if (item.type === 'section') return item.label.toUpperCase()
  if (item.type === 'photo') { const n = (item.photos ?? []).length; return `${item.label}: ${n ? `${n} photo${n === 1 ? '' : 's'}` : '—'}` }
  if (item.type === 'signature') return `${item.label}: ${item.signature || item.signed ? 'signed' : '—'}`
  if (item.type === 'multi_select') return `${item.label}: ${(item.choices ?? []).join(', ') || '—'}`
  return `${item.label}: ${item.value || '—'}`
}
