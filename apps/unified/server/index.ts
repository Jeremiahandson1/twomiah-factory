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
// The subscription from the Factory, in case a push was missed while the server was down. (The CRMs also filled an
// empty feature list from the plan at boot; not here: the Factory sets every tenant's features when it builds it,
// and a fill from a CRM plan would switch the CRM on for a website-only business.)
void services.refreshSubscription()
// A feature withdrawn from this industry goes from the business's list (modules/company.ts dropUnofferedFeatures): what
// the Factory, Settings › Features and the menu read is what the industry still offers.
void services.dropUnofferedFeatures().then((changed) => {
  for (const c of changed) logger.info('Features this industry no longer offers were switched off', { companyId: c.companyId, dropped: c.dropped })
})
const port = Number(process.env.PORT) || 3001

// websocket: the live-updates socket (http/live.ts) — Bun hands each request's server to the app, which upgrades it.
Bun.serve({ port, fetch: app.fetch, websocket: services.live.websocket })
logger.info(`Server running on port ${port}`, { vertical: vertical.id, env: process.env.NODE_ENV || 'development' })

const shutdown = (signal: string) => { logger.info(`${signal} received, shutting down`); process.exit(0) }
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
