import { Context } from 'hono'
import logger from '../services/logger.ts'

export const errorHandler = (err: Error, c: Context) => {
  const status = (err as any).status || (err as any).statusCode || 500
  const message = err.message || 'Internal server error'

  if (status >= 500) {
    logger.error('Unhandled error', { error: message, stack: err.stack, path: c.req.path })
  }

  // Include the actual error message in production to aid debugging.
  // Sensitive stack traces are still excluded.
  return c.json({
    error: message || 'Internal server error',
    ...(err.name === 'PostgresError' || (err as any).code ? { code: (err as any).code, detail: (err as any).detail } : {}),
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
