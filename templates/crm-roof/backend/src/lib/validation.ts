// The shapes this product actually accepts, in one place.
//
// Roof T17 found the same fault in six routes at once: a schema that says `z.string()` where the
// product means "one of these eleven", or `z.string().optional()` where it means "an email address".
// The result is a 201 that stores nonsense — five junk job statuses accepted, an adjuster with the
// phone "abcdefghij", a canvassing stop with the outcome "banana". Nothing errors; the data is simply
// wrong from then on, and a report that groups by status quietly stops adding up (50 jobs, 44 in the
// breakdown).
//
// These are deliberately permissive about FORM and strict about MEANING: a phone number may be written
// however a person likes, but it has to be a phone number.
import { z } from 'zod'

/**
 * The job pipeline. The frontend declares this same list twice — PipelineBoard.STAGES and
 * JobsPage.STATUSES — and a status outside it renders as a blank column and drops out of the report
 * breakdown. check-roof-validation.ts cross-checks all three so they cannot drift.
 */
export const JOB_STATUSES = [
  'lead', 'inspection_scheduled', 'inspected', 'measurement_ordered', 'proposal_sent',
  'signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected',
] as const

export const MATERIAL_ORDER_STATUSES = ['not_ordered', 'ordered', 'partial', 'delivered', 'cancelled'] as const

export const CANVASSING_OUTCOMES = [
  'no_answer', 'not_interested', 'interested', 'appointment_set', 'already_has_contractor', 'vacant',
] as const

/** the photo tabs the job detail page offers, plus the default */
export const JOB_PHOTO_TYPES = ['general', 'before', 'during', 'after', 'damage'] as const

/**
 * What a file actually IS, read from its first bytes.
 *
 * `file.type` on an upload is a string the client chose. An HTML document announced as image/png was
 * stored and served as an image; so was an SVG, which is an image format that can carry script — and
 * serving one from the tenant's own origin is stored XSS. A .exe was refused only because it did not
 * bother to lie about its type. Magic numbers do not lie.
 *
 * SVG is deliberately absent: it is a document, not a bitmap, and nothing in this product needs it.
 */
export function sniffImage(b: Uint8Array): { mime: string; ext: string } | null {
  // (a Node Buffer IS a Uint8Array, so callers pass one directly and this file needs no node types)
  if (b.length < 12) return null
  const at = (i: number) => b[i]
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a)
    return { mime: 'image/png', ext: 'png' }
  // JPEG: FF D8 FF
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  // GIF: "GIF87a" / "GIF89a"
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return { mime: 'image/gif', ext: 'gif' }
  // WebP: "RIFF" .... "WEBP"
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50)
    return { mime: 'image/webp', ext: 'webp' }
  return null
}

export const jobStatus = z.enum(JOB_STATUSES)
export const materialOrderStatus = z.enum(MATERIAL_ORDER_STATUSES)
export const canvassingOutcome = z.enum(CANVASSING_OUTCOMES)

/** money: a real number, not negative, and not NaN smuggled in as a string */
export const money = z.number().finite().nonnegative()

/**
 * A phone number, written however the person writing it likes — (555) 123-4567, +1 555 123 4567,
 * 555.123.4567 all pass. What it may not be is letters: "abcdefghij" was accepted as an adjuster's
 * phone and as a crew foreman's. Ten digits is the North American minimum; fifteen is the E.164 max.
 */
export const phone = z.string().trim().refine(
  (v) => { const d = v.replace(/\D/g, ''); return d.length >= 10 && d.length <= 15 },
  { message: 'must be a phone number with 10 to 15 digits' },
)

/** an email address, or nothing — an empty string means "not given", not "the address is ''" */
export const email = z.string().trim().email({ message: 'must be an email address' })

/** optional-but-valid: absent and empty both mean absent, anything present must be well formed */
export const optional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), s.optional())

/**
 * A line item, in the shape the rest of the product already uses: qty / unit / unitPrice / total.
 *
 * The materials write-schema demanded `quantity` and `unitCost` while the seed, the list page and
 * every other module used `qty` and `unitPrice` — so a caller could satisfy one end or the other but
 * never both, and posting the documented shape silently stripped the prices and stored a line item
 * with no money on it. Both spellings are accepted and normalised here; `total` is always recomputed.
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

/** normalise to the canonical shape and compute the money — the client's arithmetic is never stored */
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
