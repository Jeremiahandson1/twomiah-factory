// A number typed into a box, read one way everywhere (live test 2026-10-22, the Route Board).
//
// A box the person left empty arrives as '' — not null, not undefined. `String(body.estimatedHours ?? '0')` kept the ''
// (?? only catches null and undefined), and `parseInt('' ?? '30')` is NaN, so both reached a numeric column and
// Postgres answered "invalid input syntax", which the error handler could only call "One of the values is not in a
// valid format." Nobody could tell which box. The rule: an empty box means the field's default (or "none"), anything
// else must be a number in range, and a refusal names the box in words.
export interface NumberRule {
  /** What the box is called on the screen, for the refusal: "Estimated hours". */
  label: string
  /** What an empty box means. `null`: no value. Absent: the box must be filled. */
  blank?: number | null
  min?: number
  max?: number
  integer?: boolean
  /** An example in the refusal: "for example 2.5". */
  example?: string
}

export type NumberRead = { value: number | null; error?: undefined } | { value?: undefined; error: string }

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/** Reads one box. `{ value }` (null only where the rule's blank is null) or `{ error }`, a sentence naming the box. */
export function readNumber(raw: unknown, rule: NumberRule): NumberRead {
  if (isBlank(raw)) {
    if (rule.blank === undefined) return { error: `${rule.label} is needed — enter a number${rule.example ? `, for example ${rule.example}` : ''}.` }
    return { value: rule.blank }
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  const kind = rule.integer ? 'a whole number' : 'a number'
  if (!Number.isFinite(n) || (rule.integer && !Number.isInteger(n))) {
    return { error: `${rule.label} must be ${kind}${rule.example ? ` — for example ${rule.example}` : ''}.` }
  }
  if (rule.min !== undefined && n < rule.min) return { error: rule.min === 0 ? `${rule.label} cannot be negative.` : `${rule.label} must be at least ${rule.min}.` }
  if (rule.max !== undefined && n > rule.max) return { error: `${rule.label} cannot be more than ${rule.max}.` }
  return { value: n }
}
