// What a thrown error becomes. Moved from the CRM templates' utils/errors.ts (the eight newer templates' version,
// which names every invalid field), replying through reply.ts.
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import logger from '../core/logger.ts'
import { fail } from './reply.ts'

export const errorHandler = (err: Error, c: Context) => {
  // A Zod validation failure is a 400 naming every wrong field, not a 500. `error` is one sentence; `fields` lets
  // the form mark each box.
  const zx = err as any
  const issues = Array.isArray(zx?.issues) ? zx.issues : (zx?.name === 'ZodError' && Array.isArray(zx?.errors) ? zx.errors : null)
  if (issues) {
    const named = issues.map((i: any) => ({
      field: Array.isArray(i.path) && i.path.length ? i.path.join('.') : '',
      message: i.message || 'Invalid input',
    }))
    const fields: Record<string, string> = {}
    for (const n of named) if (n.field && !fields[n.field]) fields[n.field] = n.message
    const sentence = named.map((n: any) => (n.field ? `${n.field}: ${n.message}` : n.message)).join('; ')
    return fail(c, 400, sentence || 'Invalid input', 'validation_failed', fields)
  }

  // Common Postgres errors become a clear 4xx instead of an opaque 500. The driver may put the code on the error
  // or its cause.
  const pgCode = (err as any).code || (err as any)?.cause?.code
  if (typeof pgCode === 'string') {
    switch (pgCode) {
      case '23502': {
        const col = (err as any).column || (err as any)?.cause?.column
        return fail(c, 400, col ? `${String(col).replace(/_/g, ' ')} is required.` : 'A required field is missing.')
      }
      case '23503': return fail(c, 409, 'A related record does not exist, or is still in use.')
      case '23505': return fail(c, 409, 'That record already exists.')
      case '23514': return fail(c, 400, 'A value did not pass a validation rule.')
      case '22003': return fail(c, 400, 'A number is out of the allowed range.')
      case '22P02': case '22007': case '22008': {
        // What KIND of box it was, from the database's own words ("invalid input syntax for type numeric: """), so the
        // person knows what to look for; every route should refuse by name before this (http/numberInput.ts), and this
        // is the last line, not the answer (live test 2026-10-22: a blank hours box read "not in a valid format").
        const said = String((err as any).message || (err as any)?.cause?.message || '')
        const blank = /:\s*""\s*$/.test(said)
        if (/type (numeric|integer|bigint|smallint|real|double precision)/i.test(said)) {
          return fail(c, 400, blank ? 'A number box was left empty where a number is needed. Fill it in, or enter 0.' : 'A number box has something in it that is not a number. Check the numbers you entered.', 'invalid_number')
        }
        if (/type (date|timestamp)|date\/time/i.test(said) || pgCode !== '22P02') {
          return fail(c, 400, blank ? 'A date box was left empty where a date is needed.' : 'A date you entered is not a real date. Check the dates and try again.', 'invalid_date')
        }
        return fail(c, 400, 'Something you entered is not in a form we can save. Check what you typed and try again.')
      }
    }
  }

  const status = ((err as any).status || (err as any).statusCode || 500) as ContentfulStatusCode
  const message = err.message || 'Internal server error'
  if (status >= 500) logger.error('Unhandled error', { error: message, stack: err.stack, path: c.req.path })
  return fail(c, status, process.env.NODE_ENV === 'production' && status >= 500 ? 'Internal server error' : message)
}

/** A not-found a service can throw and a route can let bubble: the handler above makes it a 404 with its message. */
export const notFound = (message = 'Not found') => Object.assign(new Error(message), { status: 404 })

/** A failed zod parse as the rulebook's validation reply: one sentence, and `fields` naming each wrong box. */
export function invalid(c: Context, error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fields: Record<string, string> = {}
  for (const i of error.issues) { const k = i.path.join('.'); if (k && !fields[k]) fields[k] = i.message }
  const sentence = error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')
  return fail(c, 400, sentence || 'Invalid input', 'validation_failed', fields)
}
