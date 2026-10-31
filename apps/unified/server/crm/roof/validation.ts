// The shapes roofing accepts, in one place (templates/crm-roof/backend/src/lib/validation.ts). Roof T17 found the same
// fault in six routes at once: a schema that says `z.string()` where the product means "one of these eleven", or
// "an email address" — five junk job statuses accepted, an adjuster with the phone "abcdefghij", a canvassing stop with
// the outcome "banana". Permissive about FORM, strict about MEANING.
//
// Not moved: sniffImage — a photo's type is read from its bytes by the shared sniffType (packages/tenant-backend
// files/storage.ts), the one rule every upload uses.
import { z } from 'zod'
import { zonedWallTimeToUtc } from '@twomiah/tenant-backend'

/**
 * The forward pipeline: the stages a job walks through on its way to being paid. Ordered — Advance steps along this
 * list, so nothing may be appended that is not the next stage. The screens' stage lists are this list.
 */
export const PIPELINE_STATUSES = [
  'lead', 'inspection_scheduled', 'inspected', 'measurement_ordered', 'proposal_sent',
  'signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected',
] as const

/**
 * Where a job ends when it is NOT paid: `lost` (never signed — a sales loss) and `cancelled` (signed, then collapsed —
 * a worse one), each with a reason, because the reason is what the business is run on. Deliberately not in the
 * pipeline, or Advance would walk a collected job into `lost`.
 */
export const TERMINAL_STATUSES = ['lost', 'cancelled'] as const

/**
 * The pipeline THIS business walks. `measurement_ordered` is the satellite measurement report's stage, and Measurement
 * Reports is a not-ready feature (featureRegistry hidden): while it is off, no job is advanced, created, moved or
 * reopened into that stage, and the screens leave it off the board (web/src/crm/pages/roof/jobs/model.ts pipelineFor).
 * A job already standing there advances to the stage after it.
 */
export const MEASUREMENT_STAGE = 'measurement_ordered'
export function pipelineFor(features: readonly string[]): string[] {
  return PIPELINE_STATUSES.filter((s) => s !== MEASUREMENT_STAGE || features.includes('measurement_reports'))
}

/** Every status a roofing job may hold. */
export const JOB_STATUSES = [...PIPELINE_STATUSES, ...TERMINAL_STATUSES] as const

/**
 * A material order's status. Roofr's are draft, ready, sent, rejected and delivered; ours keep what a roofer who orders by phone
 * already used (ordered, partly delivered) and add the ones sending needs. `not_ordered` is the stored word for a draft (rows
 * already hold it); the screens say "Draft". `sent` is set only by sending the order (a hand-set Sent would have no send behind it).
 */
export const MATERIAL_ORDER_STATUSES = ['not_ordered', 'ready_to_send', 'sent', 'rejected', 'ordered', 'partial', 'delivered', 'cancelled'] as const

export const CANVASSING_OUTCOMES = [
  'no_answer', 'not_interested', 'interested', 'appointment_set', 'already_has_contractor', 'vacant',
] as const

/** The photo tabs a job offers, plus the default. */
export const JOB_PHOTO_TYPES = ['general', 'before', 'during', 'after', 'damage'] as const

export const jobStatus = z.enum(JOB_STATUSES)
export const materialOrderStatus = z.enum(MATERIAL_ORDER_STATUSES)
export const canvassingOutcome = z.enum(CANVASSING_OUTCOMES)

/** Money: a real number, not negative, and not NaN smuggled in as a string. */
export const money = z.number().finite().nonnegative()

/**
 * A phone number written however the person likes — (555) 123-4567, +1 555 123 4567 — but a phone number: 10 to 15
 * digits ("abcdefghij" was accepted as an adjuster's phone and a crew foreman's).
 */
export const phone = z.string().trim().refine(
  (v) => { const d = v.replace(/\D/g, ''); return d.length >= 10 && d.length <= 15 },
  { message: 'must be a phone number with 10 to 15 digits' },
)

/** An email address, or nothing. */
export const email = z.string().trim().email({ message: 'must be an email address' })

/** Optional-but-valid: absent and empty both mean absent; anything present must be well formed. */
export const optional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), s.optional())

/**
 * A line item (materials): qty / unit / unitPrice / total. Both spellings (qty | quantity, unitPrice | unitCost) are
 * accepted and normalised; `total` is always recomputed — the client's arithmetic is never stored.
 */
export const lineItemInput = z.object({
  description: z.string().min(1),
  qty: money.optional(),
  quantity: money.optional(),
  unit: z.string().optional(),
  unitPrice: money.optional(),
  unitCost: money.optional(),
  total: z.number().optional(),
  code: z.string().optional(),
}).refine((li) => li.qty !== undefined || li.quantity !== undefined, { message: 'needs qty' })

export type LineItemInput = z.infer<typeof lineItemInput>

export function normaliseLineItems(items: LineItemInput[]) {
  const lineItems = items.map((li) => {
    const qty = Number(li.qty ?? li.quantity ?? 0)
    const unitPrice = Number(li.unitPrice ?? li.unitCost ?? 0)
    return {
      ...(li.code ? { code: li.code } : {}),
      description: li.description,
      qty,
      unit: li.unit ?? 'ea',
      unitPrice,
      total: Number((qty * unitPrice).toFixed(2)),
    }
  })
  const total = Number(lineItems.reduce((s, li) => s + li.total, 0).toFixed(2))
  return { lineItems, total }
}

/** A homeowner's first name for a text: the first word of the contact's name (the CRM keeps one `name`). */
export const firstNameOf = (name: string | null | undefined) => String(name || '').trim().split(/\s+/)[0] || 'there'

/**
 * An appointment time from a form, on the COMPANY's clock (a roofing job's inspection and install times, a canvassing
 * appointment). A browser's datetime-local box sends "2026-10-21T10:00" with no zone; read on the server's own clock
 * (UTC on the host) a 10:00 Chicago inspection was stored as 05:00 Chicago — and the dashboard, which counts "today" on
 * the company's clock, then missed jobs whose day only matched in UTC (found moving roofing, 2026-10-19; the template did
 * the same). So: a wall-clock time is that time where the company is; a bare day is the start of that day there; a
 * value that carries its own zone ("…Z", "+02:00") is that instant. '' and null clear; undefined is "not sent".
 */
export function onCompanyClock(v: unknown, tz: string): { value?: Date | null; error?: string } {
  if (v === undefined) return {}
  if (v === null || v === '') return { value: null }
  const s = String(v).trim()
  const wall = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(s)
  if (wall) {
    const [y, m, d] = wall[1].split('-').map(Number)
    const day = new Date(Date.UTC(y, m - 1, d))
    if (day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) return { error: `${wall[1]} is not a real calendar date.` }
    const at = zonedWallTimeToUtc(wall[1], wall[2] ? `${wall[2]}:${wall[3]}` : '00:00', tz)
    return Number.isNaN(at.getTime()) ? { error: 'Enter a valid date and time.' } : { value: at }
  }
  const at = new Date(s)
  return Number.isNaN(at.getTime()) ? { error: 'Enter a valid date and time.' } : { value: at }
}
