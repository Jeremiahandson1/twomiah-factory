import { Context } from 'hono'
import logger from '../services/logger.ts'

/**
 * A refusal a person can act on, from a Zod failure.
 *
 * T46 N27: most of this product names the field now, because an uncaught ZodError falls through to
 * errorHandler below, which does. The routes that catch their OWN parse failure answered
 * `{ error: 'Invalid request', details: [...] }` instead — a sentence that says nothing beside a
 * validator dump that means nothing to the person filling the form in. Six screens still did it:
 * order-ahead checkout, the wholesale buyer, a negative multiplier, a reward type, a negative
 * referral value and a licence with no type.
 *
 * The shape matches what errorHandler produces for the uncaught case, so a screen gets the same
 * answer whichever way the failure travelled. `details` is kept for anything already reading it.
 */
/**
 * A field path as a person would say it.
 *
 *   items.0.quantity  →  item 1 quantity
 *   deliveryAddress   →  delivery address
 *
 * Array indexes are one-based, because "item 0" means nothing to the customer holding the basket.
 */
function humanField(path: (string | number)[]): string {
  const words: string[] = []
  for (let i = 0; i < path.length; i++) {
    const part = path[i]
    if (typeof part === 'number') { words[words.length - 1] = `${singular(String(path[i - 1] ?? 'item'))} ${part + 1}`; continue }
    words.push(String(part).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase())
  }
  return words.join(' ')
}
const singular = (w: string) => {
  const word = String(w).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return word.endsWith('ies') ? word.slice(0, -3) + 'y' : word.endsWith('s') ? word.slice(0, -1) : word
}

/**
 * The validator's own sentence, rewritten as something a person can act on.
 *
 * T47 P12 found these at the PUBLIC CHECKOUT, where the reader is a customer with a basket:
 * "items.0.quantity: Expected number, received string" and "items: Array must contain at least 1
 * element(s)". That is a stack trace with the stack removed. A refusal has to say what is wrong in
 * the words of the thing the person was doing.
 */
/** "a, b or c" — the way a person reading an error would say the list back. (T48 Q17) */
function listOfChoices(options: string[]): string {
  const shown = options.slice(0, 8)
  const more = options.length - shown.length
  const tail = more > 0 ? `${shown.join(', ')} (and ${more} more)` : shown.length > 1
    ? `${shown.slice(0, -1).join(', ')} or ${shown[shown.length - 1]}`
    : shown[0]
  return tail
}

function humanMessage(issue: any, field: string): string {
  const raw = String(issue?.message || 'is not valid')
  const subject = field || 'that'

  if (issue?.code === 'invalid_type' && issue?.received === 'undefined') return `${subject} is required.`
  if (/^required$/i.test(raw)) return `${subject} is required.`

  const type = raw.match(/^Expected (\w+), received (\w+)$/i)
  if (type) {
    const want = type[1].toLowerCase()
    if (want === 'number') return `${subject} has to be a number.`
    if (want === 'string') return `${subject} has to be text.`
    if (want === 'boolean') return `${subject} has to be yes or no.`
    return `${subject} is the wrong kind of value.`
  }

  const arrayMin = raw.match(/Array must contain at least (\d+) element/i)
  if (arrayMin) {
    const n = Number(arrayMin[1])
    return n === 1 ? `Add at least one ${singular(subject)}.` : `${subject} needs at least ${n}.`
  }
  const strMin = raw.match(/String must contain at least (\d+) character/i)
  if (strMin) return Number(strMin[1]) === 1 ? `${subject} cannot be blank.` : `${subject} must be at least ${strMin[1]} characters.`
  const strMax = raw.match(/String must contain at most (\d+) character/i)
  if (strMax) return `${subject} must be ${strMax[1]} characters or fewer.`
  const numMin = raw.match(/Number must be greater than or equal to ([\d.]+)/i)
  if (numMin) return `${subject} must be ${numMin[1]} or more.`
  const numMax = raw.match(/Number must be less than or equal to ([\d.]+)/i)
  if (numMax) return `${subject} must be ${numMax[1]} or less.`
  // T48 Q17: both branches of this returned the same sentence — the options were matched and then
  // thrown away — so "source is not one of the choices" never said what the choices ARE. Someone
  // recording a consent had to read the source code to find out that 'in_store' was one of four
  // words. Zod hands us the list on the issue; use it, and fall back to the message only if a
  // future version stops doing so.
  if (/invalid enum value/i.test(raw)) {
    const fromIssue = Array.isArray(issue?.options) ? issue.options.map((o: any) => String(o)) : []
    const fromMessage = fromIssue.length ? [] : (raw.match(/Expected (.+?), received/i)?.[1] || '')
      .split('|').map((s: string) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
    const options = fromIssue.length ? fromIssue : fromMessage
    if (!options.length) return `${subject} is not one of the choices.`
    return `${subject} has to be ${listOfChoices(options)}.`
  }
  if (/invalid email/i.test(raw)) return `${subject} does not look like an email address.`
  if (/invalid url/i.test(raw)) return `${subject} does not look like a web address.`

  // Anything unrecognised keeps the validator's words, but still led by the field in plain English
  // — better a slightly technical tail than a lost message.
  return field ? `${subject}: ${raw}` : raw
}

export function zodRefusal(err: any): { error: string; field: string | null } {
  const issues = Array.isArray(err?.issues) ? err.issues : (Array.isArray(err?.errors) ? err.errors : [])
  const first = issues[0] || {}
  const path = Array.isArray(first.path) ? first.path.filter((p: any) => typeof p === 'string' || typeof p === 'number') : []
  // `field` keeps the machine-readable path, for a form that wants to highlight the input.
  const field = path.length ? path.join('.') : null
  return {
    error: humanMessage(first, humanField(path)),
    field,
    // `details` is gone. It shipped the validator's entire issue list on every refusal — the
    // schema's shape, its internal field names and its codes — to whoever asked, including a
    // customer at the public checkout. Nothing in the product ever read it. (T47 P12)
  }
}

export const errorHandler = (err: Error, c: Context) => {
  // Zod validation failures must be 400, not 500. Routes call schema.parse(),
  // which throws a ZodError with no .status — it fell through to a generic 500
  // with no usable message, so the UI showed a dead form and the real cause was
  // hidden in the logs. Map it to a 400 with the first field's message.
  const zx = err as any
  const issues = Array.isArray(zx?.issues) ? zx.issues : (zx?.name === 'ZodError' && Array.isArray(zx?.errors) ? zx.errors : null)
  if (issues) {
    // The same wording as a route that refuses deliberately. A schema that throws instead of being
    // caught is the same refusal to the person reading it, and it used to be the one place raw
    // validator text still reached the public checkout. (T47 P12)
    return c.json(zodRefusal(zx), 400)
  }
  // Postgres errors otherwise leak out as opaque 500s ("unvalidated input reaching
  // the DB"). Map the common ones to a clean, actionable 4xx. The pg driver may
  // wrap the code on the error or its cause, so check both.
  const pgError = err as any
  const pgCode = pgError.code || pgError?.cause?.code
  if (typeof pgCode === 'string') {
    // Postgres knows WHICH column it was, and saying so is the whole difference between a message
    // somebody can act on and one they can only stare at. T45 L1: "One of the values is not in a
    // valid format" told a person nothing about which of twelve fields to look at. The driver puts
    // it on `column`, or inside `detail` for a constraint.
    const cause = pgError?.cause || pgError
    const readable = (s: unknown) => String(s || '').replace(/_/g, ' ').trim()
    const column = readable(cause?.column)
    const constraint = readable(cause?.constraint)
    const detail = String(cause?.detail || '')
    // "Key (email)=(x) already exists." — the field is the part a person recognises.
    const keyField = readable((detail.match(/^Key \(([^)]+)\)/) || [])[1])
    const named = column || keyField || constraint
    const about = named ? ` (${named})` : ''

    switch (pgCode) {
      case '23502': return c.json({ error: `A required field is missing${about}.`, field: named || null }, 400)                 // not_null_violation
      case '23503': return c.json({ error: `A related record does not exist, or is still in use${about}.`, field: named || null }, 409) // foreign_key_violation
      case '23505': return c.json({ error: `That ${named || 'record'} is already in use.`, field: named || null }, 409)          // unique_violation
      case '23514': return c.json({ error: `A value did not pass a validation rule${about}.`, field: named || null }, 400)       // check_violation
      case '22003': return c.json({ error: `A number is out of the allowed range${about}.`, field: named || null }, 400)         // numeric_value_out_of_range
      case '22P02': case '22007': case '22008':
        return c.json({ error: `One of the values is not in a valid format${about}.`, field: named || null }, 400)               // invalid_text_representation / datetime
    }
  }

  const status = (err as any).status || (err as any).statusCode || 500
  const message = err.message || 'Internal server error'

  if (status >= 500) {
    logger.error('Unhandled error', { error: message, stack: err.stack, path: c.req.path })
  }

  return c.json({
    error: process.env.NODE_ENV === 'production' && status >= 500 ? 'Internal server error' : message,
  }, status)
}

export const handleUncaughtExceptions = () => {
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack })
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) })
  })
}
