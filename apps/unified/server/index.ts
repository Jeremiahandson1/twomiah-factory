// Starts the tenant's server. The start command runs db/migrate.ts first, so the schema is current before this.
import { createDb } from './db/client.ts'
import { loadVertical } from './core/vertical.ts'
import { createApp } from './app.ts'
import logger from './core/logger.ts'

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack })
  process.exit(1)
})
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', { reason: String(reason) }))

const { db } = createDb()
const vertical = await loadVertical()
const { app, services } = createApp({ db, vertical })
// The CRM's timed work: review requests, campaigns, agreement billing, recurring invoices, commissions.
services.crm.startJobs()
const port = Number(process.env.PORT) || 3001

Bun.serve({ port, fetch: app.fetch })
logger.info(`Server running on port ${port}`, { vertical: vertical.id, env: process.env.NODE_ENV || 'development' })

const shutdown = (signal: string) => { logger.info(`${signal} received, shutting down`); process.exit(0) }
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
