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

  // Postgres constraint violations are the user's bad input, not a server fault —
  // many routes don't pre-validate, so these used to surface as an opaque 500
  // ("Internal server error") that the UI showed as a crash (C-02). Map the common
  // codes to a 4xx with a usable message.
  const pgCode = (err as any).code as string | undefined
  if (typeof pgCode === 'string') {
    const col = (err as any).column ? `${(err as any).column}: ` : ''
    switch (pgCode) {
      case '23502': // not_null_violation
        return c.json({ error: `${col || ''}This field is required`.trim() }, 400)
      case '23505': // unique_violation
        return c.json({ error: 'That value is already in use' }, 409)
      case '22P02': // invalid_text_representation (bad number/uuid/enum)
      case '22003': // numeric_value_out_of_range
      case '22007': // invalid_datetime_format
      case '23514': // check_violation
        return c.json({ error: 'Invalid input — please check the values entered' }, 400)
      case '23503': // foreign_key_violation
        return c.json({ error: 'Referenced record does not exist' }, 400)
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
