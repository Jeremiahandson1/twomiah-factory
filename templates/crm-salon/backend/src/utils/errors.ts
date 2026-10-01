import { Context } from 'hono'
import logger from '../services/logger.ts'

export const errorHandler = (err: Error, c: Context) => {
  // Zod validation failures must be 400, not 500. Routes call schema.parse(),
  // which throws a ZodError with no .status — it fell through to a generic 500
  // with no usable message, so the UI showed a dead form and the real cause was
  // hidden in the logs. Map it to a 400 with the first field's message.
  const zx = err as any
  const issues = Array.isArray(zx?.issues) ? zx.issues : (zx?.name === 'ZodError' && Array.isArray(zx?.errors) ? zx.errors : null)
  if (issues) {
    const first = issues[0] || {}
    const where = Array.isArray(first.path) && first.path.length ? first.path.join('.') + ': ' : ''
    return c.json({ error: where + (first.message || 'Invalid input') }, 400)
  }
  // Postgres errors otherwise leak out as opaque 500s ("unvalidated input reaching
  // the DB"). Map the common ones to a clean, actionable 4xx. The pg driver may
  // wrap the code on the error or its cause, so check both.
  const pgCode = (err as any).code || (err as any)?.cause?.code
  if (typeof pgCode === 'string') {
    switch (pgCode) {
      // not_null_violation. Postgres tells us WHICH column and this was throwing it away, so a
      // module with no schema of its own — equipment, which has none — could only ever answer "A
      // required field is missing." on a form with a dozen boxes. snake_case becomes words, because
      // "serial_number" is a column name and "serial number" is what the person is looking at.
      // (T32 L3)
      case '23502': {
        const col = (err as any).column || (err as any)?.cause?.column
        return c.json({ error: col ? `${String(col).replace(/_/g, ' ')} is required.` : 'A required field is missing.' }, 400)
      }
      case '23503': return c.json({ error: 'A related record does not exist, or is still in use.' }, 409) // foreign_key_violation
      case '23505': return c.json({ error: 'That record already exists.' }, 409)                   // unique_violation
      case '23514': return c.json({ error: 'A value did not pass a validation rule.' }, 400)       // check_violation
      case '22003': return c.json({ error: 'A number is out of the allowed range.' }, 400)         // numeric_value_out_of_range
      case '22P02': case '22007': case '22008':
        return c.json({ error: 'One of the values is not in a valid format.' }, 400)               // invalid_text_representation / datetime
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
/**
 * A not-found a service can throw and a route can let bubble.
 *
 * errorHandler above maps `err.status`, so this comes out as a 404 carrying its own message. Before
 * this, services threw a bare Error for a missing row and every one of them reached the client as
 * "Internal server error" — a record that is not there reported as a server fault.
 */
export const notFound = (message = 'Not found') => Object.assign(new Error(message), { status: 404 })
