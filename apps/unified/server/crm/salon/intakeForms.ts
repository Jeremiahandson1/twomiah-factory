// Intake and consent forms (salon gap #6 and row 18; feature `intake_forms`). The salon builds forms — questions of its own, or an agreement the
// client ticks and signs (by typing their name, or by drawing their signature) — and a client is asked the ones that apply:
//   · to the service they book, or to the membership they hold (a form can be for members whatever they book);
//   · again, when an answer has run out (the form's "valid for N days");
//   · before the booking is confirmed, when the form says so (the time is held while they fill it in — booking/engine.ts);
//   · by a link we send (one client, or a whole list at once, obeying each client's texting / email choices);
//   · at the desk or on the stylist's phone (staff fill it in with the client).
// Questions can ask for a photo or a file (a picture of the hair, a doctor's letter). Photos are re-encoded as every photo here is
// (turned upright, metadata and location dropped); a file may also be a PDF. A drawn signature is kept as a picture.
// The answers are kept as asked (so a later change to a form never rewrites what a client said) and show on the client's chart.
import { Hono } from 'hono'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import sharp from 'sharp'
import crypto from 'node:crypto'
import { companyTimeZone, publicApiBase } from '@twomiah/tenant-backend'
import { appointment, company, contact, intakeForm, intakeRequest, intakeResponse, membershipEnrollment, membershipPlan } from '../../db/schema/index.ts'
import { siteOrigin } from '../../booking/happenings.ts'
import { hasConsent, phoneE164 } from '../../site/smsConsent.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { uploadedForm } from '../office/upload.ts'
import { calendarDateIn, createSalonClock, shiftDays } from './days.ts'

export const QUESTION_TYPES = ['text', 'longtext', 'yesno', 'choice', 'consent', 'file', 'photo'] as const
export const FORM_KINDS = ['intake', 'consent'] as const
export const SIGNATURES = ['typed', 'drawn'] as const
type Q = { id: string; label: string; type: (typeof QUESTION_TYPES)[number]; required: boolean; options?: string[] }
type FormRow = typeof intakeForm.$inferSelect

/** The biggest file or photo a client may attach to one question. */
export const MAX_FORM_FILE_BYTES = 10 * 1024 * 1024
/** A drawn signature arrives as a data: URL; a real one is a few KB. */
const MAX_SIGNATURE_CHARS = 700_000
/** Do not send the same form to the same client again within this many days while their last request is still open. */
export const RESEND_AFTER_DAYS = 3
const MAX_SEND = 1000

/** The questions as saved, or the sentence saying what is wrong with them. */
export function questionsFrom(raw: unknown, kind: string): { questions: Q[] } | { problem: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { problem: 'A form needs at least one question.' }
  if (raw.length > 30) return { problem: 'A form can have at most 30 questions.' }
  const out: Q[] = []
  for (const [i, r] of raw.entries()) {
    const n = i + 1
    const label = String(r?.label || '').trim()
    if (!label) return { problem: `Question ${n} needs its words.` }
    if (label.length > 300) return { problem: `Question ${n} is too long (300 characters at most).` }
    const type = String(r?.type || 'text') as Q['type']
    if (!QUESTION_TYPES.includes(type)) return { problem: `Question ${n}: pick a kind of answer (${QUESTION_TYPES.join(', ')}).` }
    const q: Q = { id: /^[A-Za-z0-9_-]{1,40}$/.test(String(r?.id || '')) ? String(r.id) : `q${n}`, label, type, required: type === 'consent' ? true : !!r?.required }
    if (type === 'choice') {
      const options = (Array.isArray(r?.options) ? r.options : []).map((o: unknown) => String(o || '').trim()).filter(Boolean)
      if (options.length < 2 || options.length > 12) return { problem: `Question ${n}: give 2 to 12 choices.` }
      if (options.some((o: string) => o.length > 80)) return { problem: `Question ${n}: a choice is too long (80 characters at most).` }
      q.options = options
    }
    out.push(q)
  }
  if (new Set(out.map((q) => q.id)).size !== out.length) out.forEach((q, i) => { q.id = `q${i + 1}` })
  if (kind === 'consent' && !out.some((q) => q.type === 'consent')) return { problem: 'A consent form needs an agreement to tick.' }
  return { questions: out }
}

/** What came with the answers beyond text: the questions that have an acceptable file, and whether a signature was drawn. */
export interface Attached { files: Set<string>; drawn: boolean }

/** The client's answers checked against the form's questions: the record to keep, or the sentence saying what to fix. */
export function answersFor(form: Pick<FormRow, 'kind' | 'questions'> & { signature?: string }, given: Record<string, unknown>, signedName: string, attached: Attached = { files: new Set(), drawn: false }): { answers: Array<{ label: string; type: string; answer: string }>; signed: string | null } | { problem: string } {
  const answers: Array<{ label: string; type: string; answer: string }> = []
  for (const q of form.questions as Q[]) {
    if (q.type === 'file' || q.type === 'photo') {
      if (attached.files.has(q.id)) answers.push({ label: q.label, type: q.type, answer: q.type === 'photo' ? 'Photo attached' : 'File attached' })
      else if (q.required) return { problem: q.type === 'photo' ? `Please attach a photo for “${q.label}”.` : `Please attach a file for “${q.label}”.` }
      continue
    }
    const raw = given[q.id]
    let a = typeof raw === 'string' ? raw.trim().slice(0, q.type === 'longtext' ? 2000 : 300) : ''
    if (q.type === 'consent') a = raw === '1' || raw === 'on' || raw === 'yes' || raw === true ? 'Agreed' : ''
    if (q.type === 'yesno' && a && a !== 'yes' && a !== 'no') return { problem: `Please answer “${q.label}” with yes or no.` }
    if (q.type === 'choice' && a && !(q.options || []).includes(a)) return { problem: `Please pick one of the choices for “${q.label}”.` }
    if (q.required && !a) return { problem: q.type === 'consent' ? `Please tick “${q.label}” to continue.` : `Please answer “${q.label}”.` }
    if (a) answers.push({ label: q.label, type: q.type, answer: q.type === 'yesno' ? (a === 'yes' ? 'Yes' : 'No') : a })
  }
  const signed = String(signedName || '').trim().slice(0, 120)
  if (form.kind === 'consent') {
    if (form.signature === 'drawn' && !attached.drawn) return { problem: 'Please sign in the box with your finger or mouse.' }
    if (signed.length < 2) return { problem: form.signature === 'drawn' ? 'Please type your full name under your signature.' : 'Please type your full name to sign.' }
  }
  return { answers, signed: signed || null }
}

// ── What a client attaches ───────────────────────────────────────────────────────────────────────────────

export interface Prepared { questionId: string; label: string; name: string; contentType: string; ext: string; bytes: Buffer }

/** One attached file for a photo or file question: a picture re-encoded, or (file questions only) a PDF; else the sentence saying why not. */
export async function preparedFile(q: Q, file: { name: string; bytes: Uint8Array }): Promise<Prepared | { problem: string }> {
  if (!file.bytes.length) return { problem: `The file for “${q.label}” is empty.` }
  if (file.bytes.length > MAX_FORM_FILE_BYTES) return { problem: `The file for “${q.label}” is too big (${MAX_FORM_FILE_BYTES / 1024 / 1024} MB at most).` }
  const bytes = Buffer.from(file.bytes)
  const name = String(file.name || (q.type === 'photo' ? 'photo.jpg' : 'file')).slice(0, 200)
  if (q.type === 'file' && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return { questionId: q.id, label: q.label, name, contentType: 'application/pdf', ext: 'pdf', bytes }
  try {
    const jpeg = await sharp(bytes).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
    return { questionId: q.id, label: q.label, name, contentType: 'image/jpeg', ext: 'jpg', bytes: jpeg }
  } catch {
    return { problem: q.type === 'photo' ? `“${q.label}” needs a photo we can read (JPEG, PNG, WebP, GIF or HEIC).` : `“${q.label}” needs a picture or a PDF we can read.` }
  }
}

/** The shape of a signature the phone's pad draws (apps/mobile care/rules.ts signatureDataUri): nothing else is ever drawn from SVG. */
const PAD_SVG = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d{1,4}" height="\d{1,4}" viewBox="0 0 \d{1,4} \d{1,4}"><rect width="100%" height="100%" fill="#ffffff"\/><g fill="none" stroke="#111827" stroke-width="2\.5" stroke-linecap="round" stroke-linejoin="round">((?:<path d="M-?[\d.]+ -?[\d.]+(?: L-?[\d.]+ -?[\d.]+)*"\/>)+)<\/g><\/svg>$/

/**
 * A drawn signature as a picture to keep (PNG, white ground), or the sentence saying why not. Two kinds are taken: a PNG from the browser's
 * drawing box, and the phone pad's strokes (SVG of one fixed shape — anything else is refused, so a "signature" can never carry a script).
 * A box with nothing drawn in it is not a signature.
 */
export async function signatureImage(dataUrl: string | null | undefined): Promise<{ png: Buffer } | { problem: string }> {
  const none = { problem: 'Please sign in the box with your finger or mouse.' }
  if (!dataUrl || typeof dataUrl !== 'string') return none
  if (dataUrl.length > MAX_SIGNATURE_CHARS) return { problem: 'That signature is too large. Please sign again.' }
  const m = /^data:(image\/png|image\/svg\+xml)(?:;charset=[\w-]+)?;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!m) return { problem: 'That signature could not be read. Please sign again.' }
  const raw = Buffer.from(m[2], 'base64')
  try {
    let img = sharp(raw)
    if (m[1] === 'image/svg+xml') {
      if (!PAD_SVG.test(raw.toString('utf8'))) return { problem: 'That signature could not be read. Please sign again.' }
      img = sharp(raw, { density: 144 })
    }
    const meta = await img.metadata()
    if (!meta.width || !meta.height || meta.width > 3000 || meta.height > 3000 || meta.width < 20 || meta.height < 20) return { problem: 'That signature could not be read. Please sign again.' }
    const flat = await img.flatten({ background: '#ffffff' }).resize(900, 450, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    // Ink: some pixel clearly darker than the ground.
    const { data } = await sharp(flat).greyscale().raw().toBuffer({ resolveWithObject: true })
    let ink = 0
    for (let i = 0; i < data.length; i++) if (data[i] < 140) ink++
    if (ink < 30) return none
    return { png: flat }
  } catch {
    return { problem: 'That signature could not be read. Please sign again.' }
  }
}

// ── Which forms a client is asked, and what they have answered ───────────────────────────────────────────────

export interface IntakeStore { put(key: string, body: Buffer | Uint8Array, contentType: string): unknown; getObject(key: string): Promise<any>; deleteFile(key: string): unknown; storageConfigured?: () => boolean }

/** The storage keys of every file and signature a client's answers hold — for the files to go when the client does. */
export async function intakeFilesOf(db: any, companyId: string, contactIds: string[]): Promise<string[]> {
  if (!contactIds.length) return []
  const rows: Array<{ files: any[]; signatureKey: string | null }> = await db.select({ files: intakeResponse.files, signatureKey: intakeResponse.signatureKey }).from(intakeResponse)
    .where(and(eq(intakeResponse.companyId, companyId), inArray(intakeResponse.contactId, contactIds)))
  return rows.flatMap((r) => [...(r.files || []).map((f: any) => f.key as string), r.signatureKey].filter((k): k is string => !!k))
}

/** A form applies to a client when it names no service or plan at all, or names the service they book, or a plan they hold. */
function applies(f: FormRow, serviceMenuId: string | null, planIds: Set<string>) {
  const services = (f.serviceIds as string[]) || [], plans = (f.membershipPlanIds as string[]) || []
  if (!services.length && !plans.length) return true
  return (!!serviceMenuId && services.includes(serviceMenuId)) || plans.some((p) => planIds.has(p))
}

export interface FormFacts {
  db: any
  /** The file store: photos, files and drawn signatures live here. Without it a form that asks for them cannot be answered. */
  storage?: IntakeStore
  /** Told after a form is answered by a way other than the client's booking page (a link, the desk, the phone), so a booking held for it moves on. */
  released?: (companyId: string, contactId: string) => Promise<unknown>
}

export function createIntakeForms(d: FormFacts) {
  const { db } = d
  const clock = createSalonClock(db)

  /** Today on the salon's calendar, asked through `exec` — inside the booking's transaction the one connection is that transaction's, so nothing may go round it. */
  const todayOn = async (exec: any, companyId: string) => calendarDateIn(new Date(), await companyTimeZone(exec, companyId))

  async function plansHeld(exec: any, contactId: string): Promise<Set<string>> {
    const rows: Array<{ planId: string }> = await exec.select({ planId: membershipEnrollment.planId }).from(membershipEnrollment)
      .where(and(eq(membershipEnrollment.contactId, contactId), eq(membershipEnrollment.status, 'active')))
    return new Set(rows.map((r) => r.planId))
  }

  /** Per form id: the last day an answer stands (null = for good), or absent when the client never answered. The latest standing one wins. */
  async function standing(exec: any, companyId: string, contactId: string, today: string): Promise<{ valid: Map<string, string | null>; ever: Set<string> }> {
    const rows: Array<{ formId: string | null; expiresOn: string | null }> = await exec.select({ formId: intakeResponse.formId, expiresOn: intakeResponse.expiresOn }).from(intakeResponse)
      .where(and(eq(intakeResponse.companyId, companyId), eq(intakeResponse.contactId, contactId), isNotNull(intakeResponse.formId)))
    const valid = new Map<string, string | null>(), ever = new Set<string>()
    for (const r of rows) {
      ever.add(r.formId as string)
      if (r.expiresOn !== null && r.expiresOn < today) continue
      const had = valid.get(r.formId as string)
      if (had === undefined) valid.set(r.formId as string, r.expiresOn)
      else if (had !== null && (r.expiresOn === null || r.expiresOn > had)) valid.set(r.formId as string, r.expiresOn)
    }
    return { valid, ever }
  }

  /** What applies to this client for this booking and has no standing answer (never answered, or run out). */
  async function pending(companyId: string, contactId: string, serviceMenuId: string | null, exec: any = db) {
    const forms: FormRow[] = await exec.select().from(intakeForm).where(and(eq(intakeForm.companyId, companyId), eq(intakeForm.active, true))).orderBy(asc(intakeForm.createdAt))
    if (!forms.length) return []
    const planIds = await plansHeld(exec, contactId)
    const mine = forms.filter((f) => applies(f, serviceMenuId, planIds))
    if (!mine.length) return []
    const { valid, ever } = await standing(exec, companyId, contactId, await todayOn(exec, companyId))
    return mine.filter((f) => !valid.has(f.id)).map((f) => ({ ...f, expired: ever.has(f.id) }))
  }

  /** How many of those must be done before an online booking is confirmed. */
  async function blocking(companyId: string, contactId: string, serviceMenuId: string | null, exec: any = db): Promise<number> {
    return (await pending(companyId, contactId, serviceMenuId, exec)).filter((f) => f.beforeConfirm).length
  }

  /** The files and drawn signature that came with the answers, checked and ready to keep; or the sentence to show. */
  async function prepare(form: FormRow, extra?: { signature?: string | null; files?: Record<string, { name: string; type?: string; bytes: Uint8Array }> }): Promise<{ problem: string } | { files: Prepared[]; signature: Buffer | null }> {
    const files: Prepared[] = []
    for (const q of form.questions as Q[]) {
      if (q.type !== 'file' && q.type !== 'photo') continue
      const given = extra?.files?.[q.id]
      if (!given || !given.bytes?.length) continue
      const got = await preparedFile(q, given)
      if ('problem' in got) return got
      files.push(got)
    }
    let signature: Buffer | null = null
    if (form.kind === 'consent' && form.signature === 'drawn') {
      if (extra?.signature) {
        const got = await signatureImage(extra.signature)
        if ('problem' in got) return got
        signature = got.png
      }
    }
    if ((files.length || signature) && d.storage?.storageConfigured && !d.storage.storageConfigured()) return { problem: 'Photo and file storage is not set up yet, so this form cannot take photos, files or a drawn signature right now.' }
    if ((files.length || signature) && !d.storage) return { problem: 'Photo and file storage is not set up yet, so this form cannot take photos, files or a drawn signature right now.' }
    return { files, signature }
  }

  /** Keep one filled-in form: the answers, their files and signature. Returns the sentence to show when it cannot be kept. */
  async function keep(a: { companyId: string; contactId: string; bookingToken: string | null; via: 'booking' | 'link' | 'desk'; requestId?: string }, form: FormRow, given: Record<string, unknown>, signedName: string, extra?: { signature?: string | null; files?: Record<string, { name: string; type?: string; bytes: Uint8Array }> }): Promise<string | null> {
    const ready = await prepare(form, extra)
    if ('problem' in ready) return ready.problem
    const got = answersFor(form as any, given, signedName, { files: new Set(ready.files.map((f) => f.questionId)), drawn: !!ready.signature })
    if ('problem' in got) return got.problem
    const id = createId()
    const folder = `${a.companyId}/intake/${id}/`
    const kept: Array<{ questionId: string; label: string; name: string; contentType: string; key: string }> = []
    const written: string[] = []
    try {
      for (const f of ready.files) {
        const key = `${folder}${crypto.randomUUID()}.${f.ext}`
        await d.storage!.put(key, f.bytes, f.contentType)
        written.push(key)
        kept.push({ questionId: f.questionId, label: f.label, name: f.name, contentType: f.contentType, key })
      }
      let signatureKey: string | null = null
      if (ready.signature) {
        signatureKey = `${folder}signature-${crypto.randomUUID()}.png`
        await d.storage!.put(signatureKey, ready.signature, 'image/png')
        written.push(signatureKey)
      }
      const today = await clock.salonToday(a.companyId)
      await db.insert(intakeResponse).values({
        id, companyId: a.companyId, formId: form.id, formName: form.name, formKind: form.kind, contactId: a.contactId, bookingToken: a.bookingToken,
        answers: got.answers, signedName: got.signed, files: kept, signatureKey, signatureType: signatureKey ? 'image/png' : null,
        expiresOn: form.validForDays ? shiftDays(today, form.validForDays) : null, via: a.via,
      } as any)
    } catch (e: any) {
      // Take back the files this try wrote. Answered twice at once: the first stands. Anything else (the store failed) is told, not swallowed.
      for (const k of written) { try { await d.storage!.deleteFile(k) } catch { /* nothing points at it */ } }
      if (/unique|duplicate|23505/i.test(`${e?.message ?? ''} ${e?.code ?? ''} ${e?.cause?.code ?? ''} ${e?.cause?.message ?? ''}`)) return null
      throw e
    }
    // Every open request for this form from this client is done now, whichever way they answered.
    await db.update(intakeRequest).set({ completedAt: new Date() }).where(and(eq(intakeRequest.companyId, a.companyId), eq(intakeRequest.formId, form.id), eq(intakeRequest.contactId, a.contactId), inArray(intakeRequest.status, ['sent', 'queued']), isNull(intakeRequest.completedAt)))
    if (a.via !== 'booking') await d.released?.(a.companyId, a.contactId)
    return null
  }

  async function submit(a: { companyId: string; contactId: string; serviceMenuId: string | null; token: string }, formId: string, given: Record<string, unknown>, signedName: string, extra?: { signature?: string | null; files?: Record<string, { name: string; type?: string; bytes: Uint8Array }> }): Promise<string | null> {
    const form = (await pending(a.companyId, a.contactId, a.serviceMenuId)).find((f) => f.id === formId)
    if (!form) return 'This form is not needed for this booking, or you have already filled it in.'
    return keep({ companyId: a.companyId, contactId: a.contactId, bookingToken: a.token, via: 'booking' }, form, given, signedName, extra)
  }

  /** A form sent by link: what it shows, or null when the link is not one of ours. */
  async function request(a: { companyId: string; token: string }) {
    if (!a.token) return null
    const [row] = await db.select().from(intakeRequest).where(and(eq(intakeRequest.companyId, a.companyId), eq(intakeRequest.token, a.token))).limit(1)
    if (!row) return null
    const [form]: FormRow[] = await db.select().from(intakeForm).where(and(eq(intakeForm.id, row.formId), eq(intakeForm.companyId, a.companyId))).limit(1)
    const [ct] = await db.select({ name: contact.name }).from(contact).where(eq(contact.id, row.contactId)).limit(1)
    if (!form || !ct) return null
    const { valid } = await standing(db, a.companyId, row.contactId, await clock.salonToday(a.companyId))
    const done = !!row.completedAt || valid.has(form.id)
    return { form: { id: form.id, name: form.name, kind: form.kind, intro: form.intro, questions: form.questions as any[], signature: form.signature as 'typed' | 'drawn', beforeConfirm: form.beforeConfirm, expired: false }, clientName: ct.name as string, state: (done || !form.active ? 'done' : 'open') as 'open' | 'done' }
  }

  async function answerRequest(a: { companyId: string; token: string }, given: Record<string, unknown>, signedName: string, extra?: { signature?: string | null; files?: Record<string, { name: string; type?: string; bytes: Uint8Array }> }): Promise<string | null> {
    const [row] = await db.select().from(intakeRequest).where(and(eq(intakeRequest.companyId, a.companyId), eq(intakeRequest.token, a.token))).limit(1)
    if (!row) return 'This link is not one we sent.'
    const [form]: FormRow[] = await db.select().from(intakeForm).where(and(eq(intakeForm.id, row.formId), eq(intakeForm.companyId, a.companyId), eq(intakeForm.active, true))).limit(1)
    if (!form) return 'This form is no longer needed.'
    const { valid } = await standing(db, a.companyId, row.contactId, await clock.salonToday(a.companyId))
    if (row.completedAt || valid.has(form.id)) return 'You have already filled in this form. Thank you.'
    return keep({ companyId: a.companyId, contactId: row.contactId, bookingToken: null, via: 'link', requestId: row.id }, form, given, signedName, extra)
  }

  /** Staff fill the form in with the client (at the desk, or on the stylist's phone). */
  async function fill(a: { companyId: string; contactId: string }, formId: string, given: Record<string, unknown>, signedName: string, extra?: { signature?: string | null; files?: Record<string, { name: string; type?: string; bytes: Uint8Array }> }): Promise<string | null> {
    const [form]: FormRow[] = await db.select().from(intakeForm).where(and(eq(intakeForm.id, formId), eq(intakeForm.companyId, a.companyId), eq(intakeForm.active, true))).limit(1)
    if (!form) return 'That form is not available.'
    return keep({ companyId: a.companyId, contactId: a.contactId, bookingToken: null, via: 'desk' }, form, given, signedName, extra)
  }

  /** Every active form, and where this client stands with it (their chart; the phone). */
  async function standingFor(companyId: string, contactId: string) {
    const today = await clock.salonToday(companyId)
    const forms: FormRow[] = await db.select().from(intakeForm).where(and(eq(intakeForm.companyId, companyId), eq(intakeForm.active, true))).orderBy(asc(intakeForm.createdAt))
    const planIds = await plansHeld(db, contactId)
    const { valid, ever } = await standing(db, companyId, contactId, today)
    const open: Array<{ formId: string }> = await db.select({ formId: intakeRequest.formId }).from(intakeRequest)
      .where(and(eq(intakeRequest.companyId, companyId), eq(intakeRequest.contactId, contactId), inArray(intakeRequest.status, ['sent', 'queued']), isNull(intakeRequest.completedAt)))
    const asked = new Set(open.map((o) => o.formId))
    return forms
      .filter((f) => ever.has(f.id) || applies(f, null, planIds))
      .map((f) => ({
        formId: f.id, name: f.name, kind: f.kind, signature: f.signature, validForDays: f.validForDays,
        state: valid.has(f.id) ? 'valid' as const : ever.has(f.id) ? 'expired' as const : 'missing' as const,
        expiresOn: valid.get(f.id) ?? null, requested: asked.has(f.id),
      }))
  }

  return { pending, blocking: (a: { companyId: string; contactId: string; serviceMenuId: string | null }, exec?: any) => blocking(a.companyId, a.contactId, a.serviceMenuId, exec ?? db), submit, request, answerRequest, fill, standingFor, standing: (companyId: string, contactId: string) => clock.salonToday(companyId).then((t) => standing(db, companyId, contactId, t)) }
}
export type IntakeForms = ReturnType<typeof createIntakeForms>

// ── The salon's side ──────────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

export function createIntakeFormRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const forms = createIntakeForms({ db, storage: d.services.storage as any, released: (co, ct) => d.services.bookingForms?.released?.(co, ct) ?? Promise.resolve() })
  const clock = createSalonClock(db)

  const parse = async (companyId: string, body: any, existing?: FormRow) => {
    const name = String(body.name ?? existing?.name ?? '').trim()
    if (!name) return { problem: 'Give the form a name.', field: 'name' }
    if (name.length > 120) return { problem: 'The name is too long (120 characters at most).', field: 'name' }
    const kind = String(body.kind ?? existing?.kind ?? 'intake')
    if (!FORM_KINDS.includes(kind as any)) return { problem: 'A form is an intake form or a consent form.', field: 'kind' }
    const qs = questionsFrom(body.questions ?? existing?.questions, kind)
    if ('problem' in qs) return { problem: qs.problem, field: 'questions' }
    const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds.map(String) : (existing?.serviceIds as string[] | undefined) ?? []
    const planIds = Array.isArray(body.membershipPlanIds) ? [...new Set<string>(body.membershipPlanIds.map(String))] : (existing?.membershipPlanIds as string[] | undefined) ?? []
    if (planIds.length) {
      const have: Array<{ id: string }> = await db.select({ id: membershipPlan.id }).from(membershipPlan).where(and(eq(membershipPlan.companyId, companyId), inArray(membershipPlan.id, planIds)))
      if (have.length !== planIds.length) return { problem: 'One of the membership plans is not one of yours.', field: 'membershipPlanIds' }
    }
    let validForDays: number | null = existing?.validForDays ?? null
    if (body.validForDays !== undefined) {
      if (body.validForDays === null || body.validForDays === '') validForDays = null
      else {
        const n = Number(body.validForDays)
        if (!Number.isInteger(n) || n < 1 || n > 3650) return { problem: 'Answers can stand for 1 to 3650 days; leave it empty for never.', field: 'validForDays' }
        validForDays = n
      }
    }
    const signature = String(body.signature ?? existing?.signature ?? 'typed')
    if (!SIGNATURES.includes(signature as any)) return { problem: 'A signature is typed or drawn.', field: 'signature' }
    return { value: {
      name, kind, intro: String(body.intro ?? existing?.intro ?? '').trim().slice(0, 1000) || null, questions: qs.questions, serviceIds, membershipPlanIds: planIds, validForDays,
      beforeConfirm: body.beforeConfirm === undefined ? existing?.beforeConfirm ?? false : !!body.beforeConfirm,
      signature: kind === 'consent' ? signature : 'typed',
      active: body.active === undefined ? existing?.active ?? true : !!body.active,
    } }
  }

  app.get('/', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    return listAll(c, await db.select().from(intakeForm).where(eq(intakeForm.companyId, u.companyId)).orderBy(asc(intakeForm.createdAt)))
  })
  app.post('/', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const got = await parse(u.companyId, (await c.req.json().catch(() => null)) ?? {})
    if ('problem' in got) return fail(c, 400, got.problem as string, 'BAD_FORM', { [got.field ?? 'name']: got.problem as string })
    const [row] = await db.insert(intakeForm).values({ ...got.value, companyId: u.companyId } as any).returning()
    await audit.log({ action: 'create', entity: 'intake_form', entityId: row.id, entityName: row.name, req: { user: u } })
    return one(c, row, 201)
  })
  app.put('/:id', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const [row] = await db.select().from(intakeForm).where(and(eq(intakeForm.id, c.req.param('id')), eq(intakeForm.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'Form not found')
    const got = await parse(u.companyId, (await c.req.json().catch(() => null)) ?? {}, row)
    if ('problem' in got) return fail(c, 400, got.problem as string, 'BAD_FORM', { [got.field ?? 'name']: got.problem as string })
    const [updated] = await db.update(intakeForm).set({ ...got.value, updatedAt: new Date() } as any).where(eq(intakeForm.id, row.id)).returning()
    await audit.log({ action: 'update', entity: 'intake_form', entityId: row.id, changes: audit.diff(row, updated), req: { user: u } })
    return one(c, updated)
  })
  app.delete('/:id', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const [row] = await db.select().from(intakeForm).where(and(eq(intakeForm.id, c.req.param('id')), eq(intakeForm.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'Form not found')
    await db.delete(intakeForm).where(eq(intakeForm.id, row.id))      // answers already given stay on the chart, as asked
    await audit.log({ action: 'delete', entity: 'intake_form', entityId: row.id, entityName: row.name, req: { user: u } })
    return one(c, { success: true })
  })

  /** A response as the chart shows it: its files and signature as addresses (never the storage keys), and whether it has run out. */
  const out = (r: typeof intakeResponse.$inferSelect, today: string) => {
    const { files, signatureKey, signatureType, ...rest } = r
    return {
      ...rest,
      files: (files || []).map((f: any, i: number) => ({ questionId: f.questionId, label: f.label, name: f.name, contentType: f.contentType, url: `/api/intake-forms/responses/${r.id}/files/${i}` })),
      signatureUrl: signatureKey ? `/api/intake-forms/responses/${r.id}/signature` : null,
      expired: r.expiresOn !== null && r.expiresOn < today,
    }
  }

  // A client's answers, newest first (their chart).
  app.get('/responses', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const contactId = c.req.query('contactId')
    if (!contactId) return fail(c, 400, 'Say which client.', 'BAD_REQUEST')
    const today = await clock.salonToday(u.companyId)
    const rows = await db.select().from(intakeResponse).where(and(eq(intakeResponse.companyId, u.companyId), eq(intakeResponse.contactId, contactId))).orderBy(desc(intakeResponse.createdAt))
    return listAll(c, rows.map((r: any) => out(r, today)))
  })
  // Where a client stands with each form: standing, run out, or not yet answered; and whether we have asked.
  app.get('/for-client', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const contactId = c.req.query('contactId')
    if (!contactId) return fail(c, 400, 'Say which client.', 'BAD_REQUEST')
    const [ct] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, u.companyId))).limit(1)
    if (!ct) return fail(c, 404, 'Client not found')
    return listAll(c, await forms.standingFor(u.companyId, contactId))
  })

  const noStore = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', Pragma: 'no-cache' }
  const sendKept = async (c: any, key: string | null | undefined, type: string, name?: string) => {
    if (!key) return fail(c, 404, 'File not found')
    const obj = await d.services.storage.getObject(key)
    if (!obj) return fail(c, 404, 'File not found')
    return new Response(obj.body, { headers: { 'Content-Type': type, ...noStore, 'Content-Disposition': `inline; filename="${(name || 'file').replace(/[^\w.\- ]/g, '_')}"` } })
  }
  app.get('/responses/:id/files/:n', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const [r] = await db.select().from(intakeResponse).where(and(eq(intakeResponse.id, c.req.param('id')), eq(intakeResponse.companyId, u.companyId))).limit(1)
    const f = r?.files?.[Number(c.req.param('n'))]
    if (!r || !f) return fail(c, 404, 'File not found')
    return sendKept(c, f.key, f.contentType === 'application/pdf' ? 'application/pdf' : 'image/jpeg', f.name)
  })
  app.get('/responses/:id/signature', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const [r] = await db.select().from(intakeResponse).where(and(eq(intakeResponse.id, c.req.param('id')), eq(intakeResponse.companyId, u.companyId))).limit(1)
    if (!r?.signatureKey) return fail(c, 404, 'File not found')
    return sendKept(c, r.signatureKey, 'image/png', 'signature.png')
  })

  /**
   * Staff fill a form in with the client — at the desk, or on the stylist's phone. JSON (so the phone's offline queue can carry it; a photo or file as
   * base64) or a multipart form (the phone's camera upload: `contactId`, `answers` as JSON, `signedName`, `signature`, and the files as `f_<question id>`).
   */
  app.post('/:id/fill', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const files: Record<string, { name: string; type?: string; bytes: Uint8Array }> = {}
    let b: any = {}
    if ((c.req.header('content-type') || '').includes('multipart/form-data')) {
      const form = await uploadedForm(c)
      let answers: unknown = {}
      try { answers = JSON.parse(String(form.get('answers') || '{}')) } catch { return fail(c, 400, 'The answers could not be read.', 'BAD_ANSWERS') }
      b = { contactId: form.get('contactId'), signedName: form.get('signedName'), signature: form.get('signature'), answers }
      for (const [k, v] of form.entries() as Iterable<[string, any]>) if (k.startsWith('f_') && typeof v !== 'string' && v.size > 0) files[k.slice(2)] = { name: v.name, type: v.type, bytes: new Uint8Array(await v.arrayBuffer()) }
    } else {
      b = (await c.req.json().catch(() => null)) ?? {}
      for (const [qid, f] of Object.entries((b.files && typeof b.files === 'object' ? b.files : {}) as Record<string, any>)) {
        if (f && typeof f.data === 'string') files[qid] = { name: String(f.name || ''), type: String(f.type || ''), bytes: new Uint8Array(Buffer.from(f.data.replace(/^data:[^,]*,/, ''), 'base64')) }
      }
    }
    const contactId = String(b.contactId || '')
    const [ct] = contactId ? await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, u.companyId))).limit(1) : []
    if (!ct) return fail(c, 404, 'Client not found')
    const problem = await forms.fill({ companyId: u.companyId, contactId }, c.req.param('id'), (b.answers && typeof b.answers === 'object' ? b.answers : {}) as Record<string, unknown>, String(b.signedName || ''), { signature: typeof b.signature === 'string' && b.signature ? b.signature : null, files })
    if (problem) return fail(c, 400, problem, 'BAD_ANSWERS')
    await audit.log({ action: 'create', entity: 'intake_response', entityId: c.req.param('id'), metadata: { contactId, via: 'desk' }, req: { user: u } })
    return one(c, { success: true }, 201)
  })

  // ── Sending a form to clients ──
  /**
   * How a client is reached, or why not — the same rules as every automatic message (crm/salon/retention.ts): a text only to a number that agreed
   * to be texted and has not replied STOP; otherwise an email, never to an unsubscribed address, with the unsubscribe link.
   */
  async function reach(companyId: string, ct: typeof contact.$inferSelect): Promise<{ via: 'sms' | 'email'; to: string } | { why: string }> {
    const phone = ct.mobile || ct.phone
    if (phone && phoneE164(phone) && !ct.optedOutSms && (await hasConsent(db, companyId, phone))) return { via: 'sms', to: phone }
    if (ct.email && !ct.emailOptOut && publicApiBase()) return { via: 'email', to: ct.email }
    if (ct.email && ct.emailOptOut) return { why: 'They unsubscribed from email and have not agreed to texts.' }
    if (phone && ct.optedOutSms) return { why: 'They replied STOP to texts and have no email.' }
    return { why: phone ? 'They have not agreed to be texted and have no email on file.' : 'No mobile number or email on file.' }
  }

  app.post('/:id/send', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const companyId: string = u.companyId
    const [form]: FormRow[] = await db.select().from(intakeForm).where(and(eq(intakeForm.id, c.req.param('id')), eq(intakeForm.companyId, companyId))).limit(1)
    if (!form) return fail(c, 404, 'Form not found')
    if (!form.active) return fail(c, 400, 'This form is paused. Switch it on before sending it.', 'FORM_PAUSED')
    const b: any = (await c.req.json().catch(() => null)) ?? {}
    const audience = String(b.audience || '')
    if (!['all', 'members', 'upcoming', 'ids'].includes(audience)) return fail(c, 400, 'Say who to send it to: everyone, members, clients with a visit coming up, or chosen clients.', 'BAD_AUDIENCE')
    const now = new Date()
    let ids: string[] = []
    if (audience === 'ids') {
      ids = [...new Set<string>((Array.isArray(b.contactIds) ? b.contactIds : []).map(String))]
      if (!ids.length) return fail(c, 400, 'Choose at least one client.', 'BAD_AUDIENCE')
    } else if (audience === 'all') {
      ids = (await db.select({ id: contact.id }).from(contact).where(and(eq(contact.companyId, companyId), eq(contact.type, 'client')))).map((r: any) => r.id)
    } else if (audience === 'members') {
      const plans = (form.membershipPlanIds as string[]) || []
      const rows = await db.select({ id: membershipEnrollment.contactId }).from(membershipEnrollment).innerJoin(membershipPlan, eq(membershipPlan.id, membershipEnrollment.planId))
        .where(and(eq(membershipPlan.companyId, companyId), eq(membershipEnrollment.status, 'active'), ...(plans.length ? [inArray(membershipEnrollment.planId, plans)] : [])))
      ids = [...new Set<string>(rows.map((r: any) => r.id))]
    } else {
      const days = Math.min(60, Math.max(1, Math.round(Number(b.days) || 7)))
      const rows = await db.select({ id: appointment.contactId }).from(appointment).where(and(
        eq(appointment.companyId, companyId), isNotNull(appointment.contactId), gt(appointment.startTime, now), lte(appointment.startTime, new Date(now.getTime() + days * DAY)),
        inArray(appointment.status, ['scheduled', 'confirmed']),
      ))
      ids = [...new Set<string>(rows.map((r: any) => r.id as string))]
    }
    if (ids.length > MAX_SEND) return fail(c, 400, `That is ${ids.length} clients. Send to ${MAX_SEND} or fewer at a time.`, 'TOO_MANY')
    const people: Array<typeof contact.$inferSelect> = ids.length ? await db.select().from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.id, ids))) : []
    const today = await clock.salonToday(companyId)
    const recent = new Date(now.getTime() - RESEND_AFTER_DAYS * DAY)
    const asked: Array<{ contactId: string; createdAt: Date }> = ids.length ? await db.select({ contactId: intakeRequest.contactId, createdAt: intakeRequest.createdAt }).from(intakeRequest)
      .where(and(eq(intakeRequest.companyId, companyId), eq(intakeRequest.formId, form.id), inArray(intakeRequest.contactId, ids), inArray(intakeRequest.status, ['sent', 'queued']), isNull(intakeRequest.completedAt))) : []
    const recentlyAsked = new Set(asked.filter((r) => r.createdAt >= recent).map((r) => r.contactId))
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const salonName = co?.name || 'Your salon'

    const skipped: Array<{ contactId: string; name: string; reason: string }> = []
    const queued: Array<{ requestId: string; token: string; ct: typeof contact.$inferSelect; way: { via: 'sms' | 'email'; to: string } }> = []
    const missing = ids.filter((i) => !people.some((p) => p.id === i))
    for (const m of missing) skipped.push({ contactId: m, name: '', reason: 'Not one of your clients.' })
    for (const ct of people) {
      const { valid } = await forms.standing(companyId, ct.id)
      if (valid.has(form.id)) { skipped.push({ contactId: ct.id, name: ct.name, reason: 'Already has a standing answer.' }); continue }
      if (recentlyAsked.has(ct.id)) { skipped.push({ contactId: ct.id, name: ct.name, reason: `Asked in the last ${RESEND_AFTER_DAYS} days and has not answered yet.` }); continue }
      const way = await reach(companyId, ct)
      const token = crypto.randomBytes(24).toString('base64url')
      if ('why' in way) {
        await db.insert(intakeRequest).values({ companyId, formId: form.id, contactId: ct.id, token, status: 'skipped', reason: way.why } as any)
        skipped.push({ contactId: ct.id, name: ct.name, reason: way.why })
        continue
      }
      const [req] = await db.insert(intakeRequest).values({ companyId, formId: form.id, contactId: ct.id, token, status: 'queued', channel: way.via } as any).returning({ id: intakeRequest.id })
      queued.push({ requestId: req.id, token, ct, way })
    }
    await audit.log({ action: 'create', entity: 'intake_request', entityId: form.id, entityName: form.name, metadata: { audience, queued: queued.length, skipped: skipped.length }, req: { user: u } })

    // The messages go after the answer (a long list is not the browser's wait); each request records how it went.
    void (async () => {
      for (const q of queued) {
        const link = `${siteOrigin()}/forms/${q.token}`
        const first = (q.ct.name || '').split(' ')[0] || 'there'
        let status = 'sent', reason: string | null = null
        try {
          if (q.way.via === 'sms') {
            const sms: any = await d.services.sms.sendSMS(companyId, { contactId: q.ct.id, toPhone: q.way.to, message: `Hi ${first}, ${salonName} asks you to fill in "${form.name}" before your visit: ${link} Reply STOP to opt out.` })
            if (sms === null) { status = 'skipped'; reason = 'They replied STOP to texts.' }
            else if (sms?.refused || sms?.status === 'failed' || sms?.status === 'refused') { status = 'failed'; reason = sms?.errorMessage || 'The text could not be sent.' }
          } else {
            const unsub = `${publicApiBase()}/api/marketing/unsubscribe/none/${q.ct.id}`
            await d.services.emailService.sendRaw({
              to: q.way.to, subject: `${salonName}: please fill in “${form.name}”`, fromName: salonName,
              html: `<div style="font-family:sans-serif;max-width:520px;margin:auto"><p>Hi ${esc(first)},</p><p>${esc(salonName)} asks you to fill in <strong>${esc(form.name)}</strong>${form.intro ? ` — ${esc(form.intro)}` : ''}. It takes a minute and saves time at your visit.</p><p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;background:#0f766e;color:#fff;border-radius:6px;text-decoration:none">Fill it in</a></p><p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">You are receiving this because you are a client of ${esc(salonName)}. <a href="${esc(unsub)}" style="color:#6b7280">Unsubscribe</a></p></div>`,
            })
          }
        } catch (e: any) { status = 'failed'; reason = e?.message || 'Could not send.' }
        await db.update(intakeRequest).set({ status, reason }).where(eq(intakeRequest.id, q.requestId)).catch(() => {})
      }
    })()

    return one(c, { total: ids.length, queued: queued.length, skipped }, 201)
  })

  // What has been sent, and what came of it.
  app.get('/requests', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const formId = c.req.query('formId')
    const rows = await db.select({
      id: intakeRequest.id, formId: intakeRequest.formId, contactId: intakeRequest.contactId, clientName: contact.name, status: intakeRequest.status, channel: intakeRequest.channel,
      reason: intakeRequest.reason, completedAt: intakeRequest.completedAt, createdAt: intakeRequest.createdAt,
    }).from(intakeRequest).innerJoin(contact, eq(contact.id, intakeRequest.contactId))
      .where(and(eq(intakeRequest.companyId, u.companyId), ...(formId ? [eq(intakeRequest.formId, formId)] : []))).orderBy(desc(intakeRequest.createdAt)).limit(500)
    return listAll(c, rows)
  })

  return app
}
