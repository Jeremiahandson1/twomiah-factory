/**
 * Small caregiver-app rules that decide what a screen may do: the clock-in guard, the geofence
 * verdict, payday-verification snoozing, the signature image. Pure — no React Native imports —
 * so tests/mobile/care-app.test.ts runs them under plain `bun run`.
 */

// ─── Clock-in guard ────────────────────────────────────────────────────────────────────────

export interface OpenVisit { id: string; clientId?: string | null; clientName?: string | null; offline?: boolean }

/**
 * Why a clock-in must not be sent, or null. The server would auto-close an open visit when the
 * caregiver clocks into another client (and its note would land on the wrong client), so the
 * phone refuses a second open visit instead: clock out of the first one.
 */
export function clockInBlocker(o: { clientId: string | null | undefined; active: OpenVisit | null | undefined; busy?: boolean; activeClientName?: string | null }): string | null {
  if (o.busy) return 'Working on it — no need to tap again.'
  if (o.active) {
    const who = o.activeClientName || o.active.clientName || 'your current client'
    return `You're still clocked in with ${who}. Clock out of that visit first.`
  }
  if (!o.clientId) return 'Pick the client you are with.'
  return null
}

/** Why a clock-out note is required, or null. A visit saved offline lives only on this phone until
 * it syncs — its note is the only record if the office has to fix it. */
export function clockOutNoteBlocker(o: { offline: boolean; note: string | null | undefined }): string | null {
  if (o.offline && !String(o.note || '').trim()) return 'No signal — please add a short visit note so this visit can be saved on your phone.'
  return null
}

// ─── Geofence ──────────────────────────────────────────────────────────────────────────────

export function haversineFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231 // earth radius in feet
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export type GeofenceVerdict =
  | { status: 'unknown'; reason: 'no_fix' | 'no_client_location' }
  | { status: 'inside' | 'outside'; distanceFeet: number; radiusFeet: number }

/**
 * Is the phone at the client's home? Uses the agency's geofence radius for the client
 * (GET /api/time-entries/geofence/:clientId, default 300 ft) and gives the fix its accuracy:
 * a fix whose error circle reaches the radius counts as inside.
 */
export function geofenceVerdict(o: {
  fix: { latitude: number; longitude: number; accuracy?: number | null } | null | undefined
  clientLat: unknown; clientLng: unknown; radiusFeet?: number | null
}): GeofenceVerdict {
  if (!o.fix) return { status: 'unknown', reason: 'no_fix' }
  const lat = Number(o.clientLat), lng = Number(o.clientLng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0) || o.clientLat == null || o.clientLng == null) {
    return { status: 'unknown', reason: 'no_client_location' }
  }
  const radiusFeet = o.radiusFeet && o.radiusFeet > 0 ? o.radiusFeet : 300
  const distanceFeet = haversineFeet(o.fix.latitude, o.fix.longitude, lat, lng)
  const slack = o.fix.accuracy && o.fix.accuracy > 0 ? Math.min(o.fix.accuracy * 3.28084, 1000) : 0
  return { status: distanceFeet - slack <= radiusFeet ? 'inside' : 'outside', distanceFeet, radiusFeet }
}

export function formatDistance(feet: number): string {
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`
  const mi = feet / 5280
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
}

// ─── Payday verification ───────────────────────────────────────────────────────────────────

export interface PaydayPending { payPeriodStart: string; payPeriodEnd: string; payDate?: string }
export interface PaydaySnooze { period: string; until: number }

export const PAYDAY_SNOOZE_MS = 4 * 60 * 60 * 1000
export const paydayPeriodKey = (p: PaydayPending) => `${p.payPeriodStart}..${p.payPeriodEnd}`

/**
 * Show the "please confirm your hours" card? Only when the agency has it on (the server returns
 * `pending: null` otherwise) and the caregiver hasn't put THIS period off. It is a card, never a
 * modal — it must never stand between a caregiver and the clock button.
 */
export function showPayday(pending: PaydayPending | null | undefined, snooze: PaydaySnooze | null | undefined, now: number): boolean {
  if (!pending) return false
  if (snooze && snooze.period === paydayPeriodKey(pending) && snooze.until > now) return false
  return true
}

export function snoozePayday(pending: PaydayPending, now: number): PaydaySnooze {
  return { period: paydayPeriodKey(pending), until: now + PAYDAY_SNOOZE_MS }
}

// ─── Signature image ───────────────────────────────────────────────────────────────────────

export type Stroke = { x: number; y: number }[]

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** UTF-8 → base64, without btoa (not on every Hermes build). */
export function base64Utf8(text: string): string {
  const bytes: number[] = []
  for (const ch of text) {
    let cp = ch.codePointAt(0)!
    if (cp < 0x80) bytes.push(cp)
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63))
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : B64[b2 & 63]
  }
  return out
}

export const hasInk = (strokes: Stroke[]) => strokes.some((s) => s.length > 1)

/**
 * The drawn signature as an SVG data URI (data:image/svg+xml;base64,…) — the document-sign
 * endpoint accepts any data:image URI and the office shows it in an <img>. Dark ink on a white
 * ground so it reads the same on paper and in either theme.
 */
export function signatureDataUri(strokes: Stroke[], width: number, height: number): string {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height))
  const r = (n: number) => Math.round(n * 10) / 10
  const paths = strokes.filter((s) => s.length > 1)
    .map((s) => `<path d="M${r(s[0].x)} ${r(s[0].y)}${s.slice(1).map((p) => ` L${r(p.x)} ${r(p.y)}`).join('')}"/>`)
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    `<g fill="none" stroke="#111827" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`
  return `data:image/svg+xml;base64,${base64Utf8(svg)}`
}

// ─── Readable ink ──────────────────────────────────────────────────────────────────────────
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const mix = (fg: string, to: string, a: number) => '#' + [1, 3, 5].map((i) =>
  Math.round(parseInt(fg.slice(i, i + 2), 16) * (1 - a) + parseInt(to.slice(i, i + 2), 16) * a).toString(16).padStart(2, '0')).join('')

/** `color` as text on `ground`, lightened (dark mode) or darkened until it reads at 4.5:1. */
export function readableOn(color: string, ground: string, dark: boolean): string {
  if (!/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(ground)) return dark ? '#f1f5f9' : '#0f172a'
  for (const a of [0, 0.2, 0.35, 0.5, 0.65, 0.8]) {
    const c = mix(color, dark ? '#ffffff' : '#000000', a)
    if (contrast(c, ground) >= 4.5) return c
  }
  return dark ? '#ffffff' : '#000000'
}

/**
 * The documents a caregiver is asked to sign, after a refresh: the server's list when it answered; none on a 403 — the
 * agency's Documents switch is off (or the seat may not read them), so a list loaded earlier must not stay on the Today
 * card; the list already shown on anything else (no signal, a server blip). (2026-10-22)
 */
export function docsToSign<T>(prev: T[], res: { ok: boolean; status: number }, list: () => T[]): T[] {
  if (res.ok) return list()
  if (res.status === 403) return []
  return prev
}


// ─── Clock-in / clock-out questions (care_visit_questions) ────────────────────────────────────────

/** A question the agency asks at a clock event (GET /api/visit-questions/active). */
export interface VisitQuestion { id: string; prompt: string; kind: 'yes_no' | 'text' | 'choice'; options?: string[] | null; required?: boolean }
export type VisitAnswers = Record<string, string>

/** The questions still blank that must be answered, in the agency's order. A live punch waits for these. */
export function unansweredRequired(questions: VisitQuestion[], answers: VisitAnswers): VisitQuestion[] {
  return questions.filter((q) => q.required && !String(answers[q.id] ?? '').trim())
}

/** The answers as the server takes them: [{ questionId, answer }] for what was filled in (blank ones are left out). */
export function answersBody(questions: VisitQuestion[], answers: VisitAnswers): { questionId: string; answer: string }[] {
  return questions.filter((q) => String(answers[q.id] ?? '').trim()).map((q) => ({ questionId: q.id, answer: String(answers[q.id]).trim() }))
}


// ─── In-visit forms, interventions and goals (care_visit_items) ───────────────────────────────────

/** A field of a form template (GET /api/forms/templates/:id). */
export interface FormField { id: string; type: string; label?: string; options?: string[]; required?: boolean }

/** The labels of the required fields still unanswered (a checkbox with options needs one pick; one without needs the box ticked). */
export function formMissing(fields: FormField[], data: Record<string, unknown>): string[] {
  const blank = (f: FormField) => {
    const v = data[f.id]
    if (f.type === 'checkbox') return Array.isArray(f.options) && f.options.length ? !(Array.isArray(v) && v.length) : !v
    return v === undefined || v === null || String(v).trim() === ''
  }
  return fields.filter((f) => f.required && f.type !== 'section' && blank(f)).map((f) => f.label || f.id)
}

export const GOAL_RATINGS: { value: 'progress' | 'no_change' | 'declined'; label: string }[] = [
  { value: 'progress', label: 'Progress' }, { value: 'no_change', label: 'No change' }, { value: 'declined', label: 'Declined' },
]

/** What a note must say before the phone sends a skip or a refusal: the reason is needed for a refusal and for a required item. */
export function reasonNeeded(status: 'skipped' | 'refused', required: boolean): boolean {
  return status === 'refused' || required
}


// ─── Required tasks, the client's signature, and the Clock out button (row 5) ────────────────────────

/** A care task on the visit checklist (GET /api/care-tasks/time-entry/:id), as far as the rules need. */
export interface ChecklistTask { taskId: string; taskName: string; isRequired?: boolean; status?: string | null; notes?: string | null; cadence?: string | null; doneThisWeek?: boolean; appliesToVisit?: boolean }

/** Does the task belong to this visit? The server says (a Tuesday task on a Wednesday visit is false); an older server says nothing: yes. */
export const taskAppliesHere = (t: { appliesToVisit?: boolean }) => t.appliesToVisit !== false

/**
 * The names of the REQUIRED tasks still open on this visit — the same rule the server holds the clock-out by: required, belongs to
 * this visit, and neither done, nor skipped / refused with a reason, nor a weekly task already done earlier this week.
 */
export function openRequiredTasks(tasks: ChecklistTask[]): string[] {
  return tasks.filter((t) => t.isRequired && taskAppliesHere(t)
    && !(t.status === 'completed' || ((t.status === 'skipped' || t.status === 'refused') && String(t.notes ?? '').trim()) || (t.cadence === 'weekly' && t.doneThisWeek)))
    .map((t) => t.taskName)
}

/** The names of required in-visit items (forms, interventions, goals, tasks) with nothing recorded yet. */
export function openRequiredItems(items: { name: string; required: boolean; status: string | null }[]): string[] {
  return items.filter((i) => i.required && !i.status).map((i) => i.name)
}

export interface SignatureConfig { required: boolean; reasons: { code: string; label: string }[] }
/** What the phone keeps for one visit's signature and sends with the clock-out (and as soon as it can). `savedAt` is when the client signed. */
export interface PendingSignature { signature?: string; reasonCode?: string; note?: string; savedAt: string }

/** Why a "could not sign" choice is not ready, in plain words — or null when it is. "Another reason" needs the reason written. */
export function reasonProblem(code: string | null | undefined, note: string | null | undefined): string | null {
  if (!code) return 'Pick why the client could not sign.'
  if (code === 'other' && !String(note ?? '').trim()) return 'Write the reason.'
  return null
}

/** The signature as the server takes it: the drawing, or the reason (with its note) — never both. */
export function signatureBody(p: PendingSignature): { signature?: string; reasonCode?: string; note?: string; savedAt: string } {
  return p.signature ? { signature: p.signature, savedAt: p.savedAt } : { reasonCode: p.reasonCode, ...(p.note?.trim() ? { note: p.note.trim() } : {}), savedAt: p.savedAt }
}

// ── Meals (care_family_content) ──
export interface MealOption { code: string; label: string }
export interface MealRecord { id?: string; meal: string; mealLabel?: string; description: string | null; amountEaten: string; amountLabel?: string; note?: string | null }

/** Why a meal is not ready to save, in plain words — or null when it is. */
export function mealProblem(meal: string | null | undefined, description: string | null | undefined, amount: string | null | undefined): string | null {
  if (!meal) return 'Pick the meal: breakfast, lunch, dinner or a snack.'
  if (!String(description ?? '').trim()) return 'Write what was served.'
  if (!amount) return 'Say how much was eaten.'
  return null
}

/** The meal as the server takes it; `savedAt` keeps the time it was served when it is sent later. */
export function mealBody(m: { description: string; amountEaten: string; note?: string }, savedAt: string): { description: string; amountEaten: string; note?: string; savedAt: string } {
  return { description: m.description.trim(), amountEaten: m.amountEaten, ...(m.note?.trim() ? { note: m.note.trim() } : {}), savedAt }
}

// ── Hours wanted, time off and rewards (care_pickup_rewards) ──
export const DAYS = [
  { key: 'monday', label: 'Monday' }, { key: 'tuesday', label: 'Tuesday' }, { key: 'wednesday', label: 'Wednesday' }, { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' }, { key: 'saturday', label: 'Saturday' }, { key: 'sunday', label: 'Sunday' },
] as const
export const TIME_OFF_TYPES = [
  { code: 'vacation', label: 'Vacation' }, { code: 'sick', label: 'Sick' }, { code: 'personal', label: 'Personal day' }, { code: 'unpaid', label: 'Unpaid time off' },
] as const
export const TIME_OFF_STATUS: Record<string, string> = { pending: 'Waiting for the office', approved: 'Approved', denied: 'Declined', rejected: 'Declined' }

const wholeHours = (text: string): number | null => (/^\d{1,3}$/.test(text.trim()) && Number(text) <= 168 ? Number(text) : null)
const clock = (t: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t.trim())
const mins = (t: string) => Number(t.trim().split(':')[0]) * 60 + Number(t.trim().split(':')[1])

export interface DayChoice { available: boolean; start: string; end: string }

/** Why the availability is not ready to save, in plain words — or null when it is. Blank hours wanted is allowed (clears it). */
export function availabilityProblem(hoursWanted: string, maxHours: string, days: Record<string, DayChoice>): string | null {
  if (hoursWanted.trim() && wholeHours(hoursWanted) === null) return 'Hours you want a week must be a whole number from 0 to 168.'
  if (maxHours.trim() && wholeHours(maxHours) === null) return 'The most hours a week must be a whole number from 0 to 168.'
  if (hoursWanted.trim() && maxHours.trim() && Number(hoursWanted) > Number(maxHours)) return 'You cannot want more hours than the most you will work.'
  for (const d of DAYS) {
    const c = days[d.key]
    if (!c?.available) continue
    if (!clock(c.start) || !clock(c.end)) return `${d.label}: enter the times as HH:MM, like 08:00 and 16:00.`
    if (mins(c.end) <= mins(c.start)) return `${d.label}: the end must be after the start.`
  }
  return null
}

/** The availability as the server takes it. A day that is off keeps its times out of the body. */
export function availabilityBody(hoursWanted: string, maxHours: string, days: Record<string, DayChoice>): Record<string, unknown> {
  const body: Record<string, unknown> = { hoursWanted: hoursWanted.trim() ? Number(hoursWanted) : null }
  if (maxHours.trim()) body.maxHoursPerWeek = Number(maxHours)
  for (const d of DAYS) {
    const c = days[d.key]
    if (!c) continue
    body[`${d.key}Available`] = !!c.available
    if (c.available) { body[`${d.key}StartTime`] = c.start.trim(); body[`${d.key}EndTime`] = c.end.trim() }
  }
  return body
}

/** Why a time-off request is not ready, in plain words — or null. `today` is the agency's day (YYYY-MM-DD). */
export function timeOffProblem(start: string, end: string, type: string | null, today: string): string | null {
  if (!type) return 'Pick what kind of time off it is.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return 'Pick the first and last day.'
  if (end < start) return 'The last day cannot be before the first.'
  if (end < today) return 'That is already in the past — tell the office instead.'
  return null
}

export function timeOffBody(start: string, end: string, type: string, reason: string): { startDate: string; endDate: string; type: string; reason?: string } {
  return { startDate: start, endDate: end, type, ...(reason.trim() ? { reason: reason.trim() } : {}) }
}

/** What a reward costs against what the caregiver has, in words. */
export function rewardAffordText(balance: number, cost: number): string {
  return balance >= cost ? `${cost} points` : `${cost} points — ${cost - balance} more to go`
}

// ── Open shifts: turning one down, the answer-by time, a series (row 17, care_open_shift_offers) ─────────────

/** Why a decline is not ready, in plain words — or null. "Another reason" needs the caregiver's own words. */
export function declineProblem(reason: string | null, note: string): string | null {
  if (!reason) return 'Pick why you are turning this shift down.'
  if (reason === 'other' && !note.trim()) return 'Write the reason.'
  return null
}
export function declineBody(reason: string, note: string): { reason: string; note?: string } {
  return { reason, ...(note.trim() ? { note: note.trim() } : {}) }
}
/** "Answer by Mon, Nov 2 at 5:00 PM" from the agency's wall time ('YYYY-MM-DDTHH:MM[:SS]'), or null when there is none. */
export function answerByText(respondBy: string | null | undefined, fmtDay: (ymd: string) => string, fmtTime: (hm: string) => string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(respondBy || ''))
  return m ? `Answer by ${fmtDay(m[1])} at ${fmtTime(m[2])}` : null
}
/** The words on the button and in the confirm for one shift or a series offered together. */
export function takeText(seriesVisits: number | null | undefined): { button: string; confirm: string } {
  const n = Number(seriesVisits) || 0
  return n > 1
    ? { button: `Take all ${n} visits`, confirm: `This offer is one of ${n} visits offered together. Taking it takes all ${n}.` }
    : { button: 'Take this shift', confirm: '' }
}
