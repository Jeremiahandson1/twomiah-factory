/**
 * The insurance claim on the phone (roofing parity, row 12; docs/parity/roof-insurance-extras.md "Still needed") — pure TypeScript,
 * tested by tests/mobile/insurance-claim.test.ts with the real offline queue, and replayed against the real server by
 * apps/unified/tests/roof-phone-claim.test.ts. The screen is app/(details)/job/claim.tsx.
 *
 * What the screen has: the claim (carrier, number, status, adjuster, the money if the seat sees it), its supplements, the
 * company's own statuses on them (insurance_extras), the mortgage-company checks, the held depreciation (certificate sent,
 * released), and the claim's trail. Every control asks what the route behind it asks (insurance:create / update / approve /
 * read), exactly as the desktop's claim page does — `claimSeat` is that rule in one place.
 *
 * Every write goes through the offline queue (src/offline), under ONE record per job's claim (`claim:<jobId>`), so a save made
 * with no signal is kept and sent in order. A save that names a record the server has not heard of yet cannot be made offline —
 * a supplement needs the claim's id — so the screen offers those only on a claim that is on the server. The days a save carries
 * (the day a check was sent, the certificate went out) are the phone's own day at the tap, so one sent hours later is dated when it
 * happened. Money is typed in dollars and sent as the digits typed (no float), as the server's boxes take it.
 */
import type { NewItem } from '../offline/engine'

/** One record per job's claim: its saves go one at a time, oldest first. */
export const claimKey = (jobId: string) => `claim:${jobId}`

// ── words ────────────────────────────────────────────────────────────────────────────────────────────────────────

const words = (code: string) => code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
export const CLAIM_STATUS_WORDS: Record<string, string> = {
  filed: 'Filed', adjuster_assigned: 'Adjuster assigned', inspection_scheduled: 'Inspection scheduled', inspected: 'Inspected',
  approved: 'Approved', supplemented: 'Supplemented', denied: 'Denied', closed: 'Closed',
}
export const SUPPLEMENT_STATUS_WORDS: Record<string, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', denied: 'Denied' }
export const MORTGAGE_STATUS_WORDS: Record<string, string> = {
  received: 'Received from the carrier', sent_to_mortgage: 'Sent to the mortgage company', endorsed: 'Endorsed', deposited: 'Deposited',
}
export const claimStatusWord = (s?: string | null) => (s ? CLAIM_STATUS_WORDS[s] ?? words(s) : '')
export const supplementStatusWord = (s?: string | null) => (s ? SUPPLEMENT_STATUS_WORDS[s] ?? words(s) : '')
export const mortgageStatusWord = (s?: string | null) => (s ? MORTGAGE_STATUS_WORDS[s] ?? words(s) : '')

// ── what the server sends (server/crm/roof/insurance/*.ts) ───────────────────────────────────────────────────────

export interface PhoneClaim {
  id: string; jobId: string; claimNumber: string; insuranceCompany: string; policyNumber?: string | null; claimStatus?: string
  adjusterName?: string | null; adjusterPhone?: string | null; adjusterEmail?: string | null
  deductible?: string | null; rcv?: string | null; acv?: string | null; depreciationHeld?: string | null; supplementAmount?: string | null; finalApprovedAmount?: string | null
  moneyWithheld?: boolean
}
export interface PhoneSupplement {
  id: string; supplementNumber: string; status: string; reason?: string | null; totalAmount?: string; approvedAmount?: string | null
  denialReason?: string | null; customStatusId?: string | null; moneyWithheld?: boolean
}
export interface PhoneStatusDef { id: string; name: string; baseStatus: string; archived: boolean }
export interface PhoneCheck {
  id: string; mortgageCompany: string; loanNumber?: string | null; checkNumber?: string | null; amount?: string; status: string
  sentAt?: string | null; trackingNumber?: string | null; endorsedAt?: string | null; depositedAt?: string | null; moneyWithheld?: boolean
}
export interface PhoneDepreciation {
  state: 'none_held' | 'job_not_done' | 'send_certificate' | 'waiting_on_carrier' | 'recovered'
  held?: number; recoveredAmount?: number | null; certificateSentAt?: string | null; recoveredAt?: string | null; insuranceCompany?: string; moneyWithheld?: boolean
}

// ── what a seat is offered ───────────────────────────────────────────────────────────────────────────────────────

export interface ClaimSeat {
  /** The claims module is on (`insurance_workflow`): the claim screen exists at all. */
  open: boolean
  /** Insurance follow-ups is on (`insurance_extras`) and the seat reads them (insurance:read): checks, depreciation, company statuses. */
  extras: boolean
  /** insurance:create — start the claim, add a supplement, submit it, log a note, file a check, say the certificate went. */
  file: boolean
  /** insurance:update — move a check along; put the company's status on a supplement. */
  edit: boolean
  /** insurance:approve — record the carrier's decision on a supplement, and the depreciation it released. */
  decide: boolean
}
export function claimSeat(can: (permission: string) => boolean, hasFeature: (feature: string) => boolean): ClaimSeat {
  const open = hasFeature('insurance_workflow')
  return { open, extras: open && hasFeature('insurance_extras') && can('insurance:read'), file: can('insurance:create'), edit: can('insurance:update'), decide: can('insurance:approve') }
}

export type SupplementActionId = 'submit' | 'approve' | 'deny' | 'status'
/**
 * The buttons on one supplement, in order, as the desktop's claim page offers them: a draft is submitted (a denied one sent
 * again); a submitted, approved or denied one has the carrier's answer recorded, worded for what it does from there; the company's
 * own status is chosen when the company has one that sits under the supplement's fixed status.
 */
export function supplementActions(sup: Pick<PhoneSupplement, 'status'>, seat: ClaimSeat, statuses: PhoneStatusDef[] = []): { id: SupplementActionId; label: string }[] {
  const out: { id: SupplementActionId; label: string }[] = []
  if (seat.file && (sup.status === 'draft' || sup.status === 'denied')) out.push({ id: 'submit', label: sup.status === 'draft' ? 'Submit to the carrier' : 'Send again' })
  if (seat.decide && ['submitted', 'approved', 'denied'].includes(sup.status)) {
    out.push({ id: 'approve', label: sup.status === 'approved' ? 'Change the approved amount' : sup.status === 'denied' ? 'Record an approval instead' : 'Record approval' })
    out.push({ id: 'deny', label: sup.status === 'approved' ? 'Record a denial instead' : sup.status === 'denied' ? 'Change the denial reason' : 'Record denial' })
  }
  if (seat.extras && seat.edit && statusesFor(sup.status, statuses).length) out.push({ id: 'status', label: 'Set your status' })
  return out
}
/** The company's statuses that can be put on a supplement in this fixed status (not archived). */
export const statusesFor = (fixed: string, statuses: PhoneStatusDef[]) => statuses.filter((s) => !s.archived && s.baseStatus === fixed)

/** The next step for a mortgage-company check, and the words on its button; none once deposited. */
export const NEXT_CHECK_STEP: Record<string, { status: string; label: string } | null> = {
  received: { status: 'sent_to_mortgage', label: 'Mark sent to the mortgage company' },
  sent_to_mortgage: { status: 'endorsed', label: 'Mark endorsed' },
  endorsed: { status: 'deposited', label: 'Mark deposited' },
  deposited: null,
}

/** What the held-depreciation card says, in a sentence. Never a figure the server withheld. */
export function depreciationSentence(dep: PhoneDepreciation, shownDay: (iso?: string | null) => string, shownMoney: (n: number) => string): string {
  const who = dep.insuranceCompany || 'The carrier'
  const held = dep.moneyWithheld || dep.held == null ? 'depreciation' : `${shownMoney(dep.held)} of depreciation`
  if (dep.state === 'recovered') return `${who} released ${dep.moneyWithheld || dep.recoveredAmount == null ? 'the held depreciation' : shownMoney(dep.recoveredAmount)} on ${shownDay(dep.recoveredAt)}.`
  const base = `${who} is holding ${held} until it has your certificate of completion.`
  if (dep.state === 'job_not_done') return `${base} The job is not finished yet; you are reminded when it is.`
  if (dep.state === 'send_certificate') return `${base} The job is done — send the certificate now.`
  if (dep.state === 'waiting_on_carrier') return `${base} Certificate sent ${shownDay(dep.certificateSentAt)}; waiting on the carrier.`
  return base
}

// ── typed text to what the server takes ──────────────────────────────────────────────────────────────────────────

/** An amount typed in dollars → the digits the server's boxes take ("1,250.5" → "1250.50"); null when it is not an amount of 0 or more. */
export function amountText(typed: string): string | null {
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(typed).trim().replace(/^\$/, '').replace(/,/g, ''))
  return m ? `${m[1]}.${(m[2] ?? '').padEnd(2, '0')}` : null
}
/** A quantity typed: a number above zero, with up to 3 decimals. */
export function quantityText(typed: string): number | null {
  const t = String(typed).trim()
  return /^\d{1,6}(\.\d{1,3})?$/.test(t) && Number(t) > 0 ? Number(t) : null
}
/** The phone's own calendar day, as the server's day boxes take it. */
export const phoneDay = (at: Date): string => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

export interface LineInput { description: string; qty: string; unit: string; unitPrice: string }
export const blankLine = (): LineInput => ({ description: '', qty: '1', unit: 'EA', unitPrice: '' })
/**
 * The lines of a supplement as typed → what the server takes, or the sentence to show. A row left entirely blank is skipped;
 * a row with anything in it needs all its parts. The server works out the totals itself and ignores any the phone would send.
 */
export function supplementLines(rows: LineInput[]): { lines: { description: string; qty: number; unit: string; unitPrice: number }[]; totalCents: number } | { error: string } {
  const lines: { description: string; qty: number; unit: string; unitPrice: number }[] = []
  let totalCents = 0
  for (const [i, r] of rows.entries()) {
    if (!r.description.trim() && !r.unitPrice.trim()) continue
    const where = `Line ${i + 1}`
    if (!r.description.trim()) return { error: `${where}: say what it is.` }
    const qty = quantityText(r.qty)
    if (qty === null) return { error: `${where}: the quantity must be a number above zero.` }
    const price = amountText(r.unitPrice)
    if (price === null) return { error: `${where}: the price must be an amount of 0 or more, like 125.50.` }
    const unitPrice = Number(price)
    lines.push({ description: r.description.trim(), qty, unit: r.unit.trim() || 'EA', unitPrice })
    totalCents += Math.round(qty * Math.round(unitPrice * 100))
  }
  if (!lines.length) return { error: 'A supplement needs at least one line.' }
  if (totalCents <= 0) return { error: 'A supplement needs a total above zero.' }
  return { lines, totalCents }
}

// ── the saves, as the queue takes them ───────────────────────────────────────────────────────────────────────────

const text = (v?: string) => (v && v.trim() ? v.trim() : undefined)
const enc = encodeURIComponent
const item = (jobId: string, method: NewItem['method'], path: string, label: string, body?: unknown): NewItem => ({ method, path, body, recordKey: claimKey(jobId), label })

export interface NewClaimInput { claimNumber: string; insuranceCompany: string; policyNumber?: string; adjusterName?: string; adjusterPhone?: string; deductible?: string }
/** Start the claim on an insurance job. The deductible is an amount or left out. */
export function startClaim(jobId: string, f: NewClaimInput, jobNumber = 'Job'): NewItem | { error: string } {
  if (!f.claimNumber.trim()) return { error: 'Enter the claim number.' }
  if (!f.insuranceCompany.trim()) return { error: 'Enter the insurance company.' }
  const deductible = f.deductible?.trim() ? amountText(f.deductible) : undefined
  if (deductible === null) return { error: 'The deductible must be an amount, like 1,000.' }
  const body: Record<string, unknown> = { jobId, claimNumber: f.claimNumber.trim(), insuranceCompany: f.insuranceCompany.trim() }
  for (const [k, v] of [['policyNumber', f.policyNumber], ['adjusterName', f.adjusterName], ['adjusterPhone', f.adjusterPhone]] as const) if (text(v)) body[k] = text(v)
  if (deductible) body.deductible = deductible
  return item(jobId, 'POST', '/api/insurance/claims', `${jobNumber} · claim started`, body)
}

export function addNote(jobId: string, claimId: string, note: string): NewItem | { error: string } {
  if (!note.trim()) return { error: 'Write the note first.' }
  return item(jobId, 'POST', `/api/insurance/claims/${enc(claimId)}/activity`, 'Claim note', { activityType: 'note', body: note.trim() })
}

export function addSupplement(jobId: string, claimId: string, reason: string, rows: LineInput[], notes = ''): NewItem | { error: string } {
  if (!reason.trim()) return { error: 'Say why the supplement is needed.' }
  const made = supplementLines(rows)
  if ('error' in made) return made
  return item(jobId, 'POST', `/api/insurance/claims/${enc(claimId)}/supplements`, 'New supplement', { reason: reason.trim(), lineItems: made.lines, ...(text(notes) ? { notes: text(notes) } : {}) })
}
export const submitSupplement = (jobId: string, s: Pick<PhoneSupplement, 'id' | 'supplementNumber'>): NewItem =>
  item(jobId, 'POST', `/api/insurance/supplements/${enc(s.id)}/submit`, `${s.supplementNumber} · submitted`)

export function approveSupplement(jobId: string, s: Pick<PhoneSupplement, 'id' | 'supplementNumber'>, typed: string): NewItem | { error: string } {
  const amount = amountText(typed)
  if (amount === null) return { error: 'The approved amount must be 0 or more, like 850.00.' }
  return item(jobId, 'POST', `/api/insurance/supplements/${enc(s.id)}/approve`, `${s.supplementNumber} · approved`, { approvedAmount: amount })
}
export function denySupplement(jobId: string, s: Pick<PhoneSupplement, 'id' | 'supplementNumber'>, reason: string): NewItem | { error: string } {
  if (!reason.trim()) return { error: 'A denial needs a reason — it is what the claim record shows later.' }
  return item(jobId, 'POST', `/api/insurance/supplements/${enc(s.id)}/deny`, `${s.supplementNumber} · denied`, { denialReason: reason.trim() })
}
/** Put the company's status on a supplement, or take it off (statusId null). */
export const setSupplementStatus = (jobId: string, s: Pick<PhoneSupplement, 'id' | 'supplementNumber'>, statusId: string | null, name = ''): NewItem =>
  item(jobId, 'POST', `/api/insurance-extras/supplements/${enc(s.id)}/custom-status`, statusId ? `${s.supplementNumber} · ${name || 'status set'}` : `${s.supplementNumber} · status cleared`, { statusId })

export interface NewCheckInput { mortgageCompany: string; amount: string; loanNumber?: string; checkNumber?: string }
export function addMortgageCheck(jobId: string, claimId: string, f: NewCheckInput, at: Date): NewItem | { error: string } {
  if (!f.mortgageCompany.trim()) return { error: 'Enter the mortgage company.' }
  const amount = amountText(f.amount)
  if (amount === null) return { error: 'The check amount must be an amount, like 9,250.50.' }
  const body: Record<string, unknown> = { mortgageCompany: f.mortgageCompany.trim(), amount, receivedOn: phoneDay(at) }
  for (const [k, v] of [['loanNumber', f.loanNumber], ['checkNumber', f.checkNumber]] as const) if (text(v)) body[k] = text(v)
  return item(jobId, 'POST', `/api/insurance-extras/claims/${enc(claimId)}/mortgage-checks`, `Check · ${f.mortgageCompany.trim()}`, body)
}
export function moveMortgageCheck(jobId: string, c: Pick<PhoneCheck, 'id' | 'mortgageCompany'>, status: string, at: Date, trackingNumber = ''): NewItem {
  return item(jobId, 'POST', `/api/insurance-extras/mortgage-checks/${enc(c.id)}/status`, `Check · ${c.mortgageCompany} · ${mortgageStatusWord(status).toLowerCase()}`,
    { status, on: phoneDay(at), ...(status === 'sent_to_mortgage' && text(trackingNumber) ? { trackingNumber: text(trackingNumber) } : {}) })
}
export const certificateSent = (jobId: string, claimId: string, at: Date): NewItem =>
  item(jobId, 'POST', `/api/insurance-extras/claims/${enc(claimId)}/completion-certificate`, 'Certificate sent', { sentOn: phoneDay(at) })
export function depreciationReleased(jobId: string, claimId: string, typed: string, at: Date): NewItem | { error: string } {
  const amount = amountText(typed)
  if (amount === null) return { error: 'The amount the carrier released must be an amount, like 4,000.' }
  return item(jobId, 'POST', `/api/insurance-extras/claims/${enc(claimId)}/depreciation-recovered`, 'Depreciation released', { amount, receivedOn: phoneDay(at) })
}

/** A request the builders refused, with the sentence to show. */
export const isError = (x: NewItem | { error: string }): x is { error: string } => 'error' in x

/**
 * A stored day for the screen. A day the person named is stored as that day's midnight UTC ("2026-11-02T00:00:00.000Z") and
 * is the day it names, wherever the phone is; a real moment is shown on the phone's own clock.
 */
export function shownDay(iso?: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(iso)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}
/** Dollars as the screen shows them. */
export const shownMoney = (n: unknown): string => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
