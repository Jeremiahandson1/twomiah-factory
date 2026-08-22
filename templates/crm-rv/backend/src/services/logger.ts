import winston from 'winston'

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''
            return `${timestamp} [${level}] ${message}${metaStr}`
          })
        )
  ),
  transports: [new winston.transports.Console()],
})

// Compatibility helper: several routes call `logger.logError(err, req, meta)`.
// winston has no such method, so provide one that logs via `.error` with context
// (previously this threw, turning recoverable catch-and-continue paths into 500s).
;(logger as any).logError = (error: any, _req: any, meta: Record<string, any> = {}) =>
  logger.error(error?.message || String(error), { ...meta, stack: error?.stack })

// Same class of bug: documents.ts calls `logger.audit(event, userId, companyId,
// meta)`, which winston doesn't have either — every document upload/delete
// 500'd AFTER the file was already stored. Log it as info; the real audit
// trail is services/audit.ts, which those routes also call.
;(logger as any).audit = (event: string, userId: any, companyId: any, meta: Record<string, any> = {}) =>
  logger.info(`[audit] ${event}`, { userId, companyId, ...meta })

export default logger
