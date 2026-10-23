// /api/qb-sync — QuickBooks' sync log and the syncs a person presses (./quickbooksAutoSync.ts): the Integrations card
// reads what each sync sent and what QuickBooks refused, runs a sync now, and retries a refused record.
//
// Who: the QuickBooks routes' own line (packages/tenant-backend integrations/quickbooks.ts touchesTheBooks):
// settings:update — the owner and admins, and anyone granted it by name. Behind the QuickBooks switch (the registry).
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import type { QuickBooksAutoSync } from './quickbooksAutoSync.ts'

export function createQuickBooksSyncRoutes(d: CrmDeps, sync: QuickBooksAutoSync) {
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const books = requirePermission('settings:update')

  app.get('/log', books, async (c) => one(c, await sync.log(c.get('user').companyId)))

  /** Sync now: what is due, recorded like an automatic run; answers when it has finished. */
  app.post('/run', books, async (c) => {
    const companyId = c.get('user').companyId
    if (!(await sync.log(companyId)).connected) return fail(c, 400, 'QuickBooks is not connected. Press Connect QuickBooks first.', 'not_connected')
    const run = await sync.syncCompany(companyId, 'manual')
    if (!run) return fail(c, 409, 'A sync is already running. It will be in the log when it finishes.', 'sync_running')
    return one(c, { run, log: await sync.log(companyId) })
  })

  /** Try a refused record again now, then sync. */
  app.post('/failures/:id/retry', books, async (c) => {
    const companyId = c.get('user').companyId
    if (!(await sync.retry(companyId, c.req.param('id')))) return fail(c, 404, 'That record is no longer waiting to be retried.')
    const run = await sync.syncCompany(companyId, 'manual')
    return one(c, { run, log: await sync.log(companyId) })
  })

  return app
}
