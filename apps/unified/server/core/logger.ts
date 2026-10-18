// The server's log. Moved from the CRM templates' services/logger.ts (identical in six of them); see
// docs/CUTOVER_LEDGER.md.
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
          }),
        ),
  ),
  transports: [new winston.transports.Console()],
})

export type Logger = Pick<typeof logger, 'info' | 'warn' | 'error'>
export default logger
