// /api/tip-sources — TIPS FROM ANOTHER REGISTER (Toast, Square), behind bar_tip_import AND bar_tip_pooling, a manager's (bar:manage).
// The sign-in-free return from Square is a second mount (/api/tip-sources-return): Square sends the browser there, and the signed
// state is the proof it is ours. No reply here ever carries a token, a secret or the stored credentials.
//
//   GET    /                          what is connected, and whether Square can be connected on this account
//   GET    /square/auth-url           where to send the owner to allow Square (a signed state in it)
//   POST   /toast                     connect Toast with the venue's own read-only credentials (tried once, then kept encrypted)
//   PUT    /square/location           the Square location whose payments are read (blank: Square's main location)
//   DELETE /:provider                 disconnect (our copy of the keys is deleted; remove the app in Square / the credentials in Toast too)
//   POST   /:provider/import          read a night now: { day }
//   GET    /staff  ·  PUT /staff      the other register's staff beside ours, and a hand match
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { SourceError } from './barTipSources.ts'
import type { BarServices } from './services.ts'

type Ctx = any
const PROVIDER = /^(toast|square)$/

export function createBarTipSourceRoutes(d: CrmDeps, bar: BarServices) {
  const { audit, logger } = d
  const { requirePermission } = d.permissions
  const on = d.features.requireEnabledFeature('bar_tip_import')
  const pooling = d.features.requireEnabledFeature('bar_tip_pooling')
  const { actorOf } = bar.managers
  const src = bar.tipSources
  const app = new Hono<AppEnv>()

  async function run(c: Ctx, fn: () => Promise<unknown>) {
    try { c.header('Cache-Control', 'no-store'); return one(c, await fn() as object) }
    catch (e: any) {
      if (e instanceof SourceError) return fail(c, e.status as any, e.message)
      logger.error('[tip-sources]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not work. Try again.')
    }
  }
  const redirectUri = (c: Ctx) => `${process.env.API_URL || process.env.API_BASE_URL || new URL(c.req.url).origin}/api/tip-sources-return/square/callback`

  app.get('/', on, pooling, requirePermission('bar:manage'), async (c) => { const a = await actorOf(c); return run(c, async () => ({ ...(await src.list(a.companyId)), squareRedirectUri: redirectUri(c) })) })
  app.get('/square/auth-url', on, pooling, requirePermission('bar:manage'), async (c) => { const a = await actorOf(c); return run(c, async () => ({ url: src.squareAuthUrl(a.companyId, a.name) })) })
  app.post('/toast', on, pooling, requirePermission('bar:manage'), async (c) => {
    const a = await actorOf(c); const b = await c.req.json().catch(() => ({}))
    return run(c, async () => {
      const source = await src.connectToast(a.companyId, a.name, b)
      audit.log({ req: c, action: 'create', entity: 'bar_tip_source', entityId: source.id, entityName: 'Toast tips connection', changes: { provider: 'toast' } })
      return { source }
    })
  })
  app.put('/square/location', on, pooling, requirePermission('bar:manage'), async (c) => {
    const a = await actorOf(c); const b = await c.req.json().catch(() => ({}))
    return run(c, async () => ({ source: await src.setLocation(a.companyId, 'square', b?.locationId) }))
  })
  app.get('/staff', on, pooling, requirePermission('bar:manage'), async (c) => { const a = await actorOf(c); return run(c, () => src.staff(a.companyId)) })
  app.put('/staff', on, pooling, requirePermission('bar:manage'), async (c) => {
    const a = await actorOf(c); const b = await c.req.json().catch(() => ({}))
    return run(c, async () => {
      const r = await src.matchStaff(a.companyId, b)
      audit.log({ req: c, action: 'update', entity: 'bar_tip_staff_map', entityName: 'Tip staff match', changes: { externalStaffId: r.externalStaffId, userId: r.userId } })
      return r
    })
  })
  app.delete('/:provider', on, pooling, requirePermission('bar:manage'), async (c) => {
    const a = await actorOf(c); const p = c.req.param('provider')
    if (!PROVIDER.test(p)) return fail(c, 404, 'Not found')
    return run(c, async () => {
      const source = await src.disconnect(a.companyId, p)
      audit.log({ req: c, action: 'delete', entity: 'bar_tip_source', entityId: source.id, entityName: `${source.providerName} tips connection`, changes: { provider: p } })
      return { disconnected: true }
    })
  })
  app.post('/:provider/import', on, pooling, requirePermission('bar:manage'), async (c) => {
    const a = await actorOf(c); const p = c.req.param('provider'); const b = await c.req.json().catch(() => ({}))
    if (!PROVIDER.test(p)) return fail(c, 404, 'Not found')
    return run(c, async () => ({ notes: await src.importDay(a.companyId, String(b?.day ?? ''), p) }))
  })
  return app
}

/** Square's return: no session, the signed state is the proof; answers with a redirect back to the Tips page. */
export function createBarTipSourceReturnRoutes(d: CrmDeps, bar: BarServices) {
  const app = new Hono<AppEnv>()
  app.get('/square/callback', async (c) => {
    const q = c.req.query()
    const r = await bar.tipSources.squareReturn({ state: q.state, code: q.code, error: q.error })
    return c.redirect(`/crm/tips?register=${r.ok ? 'square-connected' : 'square-failed'}${r.ok ? '' : `&why=${encodeURIComponent(r.why || '')}`}`)
  })
  return app
}
