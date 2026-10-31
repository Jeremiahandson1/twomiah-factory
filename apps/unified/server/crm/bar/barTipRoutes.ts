// /api/tips — TIP POOLING AND TIP-OUT, behind the bar_tip_pooling feature (barTips.ts; restaurant-bar-depth #9).
//
//   A manager's (bar:manage — who already sees every tip on the night's report):
//     GET  /rules  ·  PUT /rules                     the roles, the pool and the tip-outs
//     GET  /night?day=                               tonight's tips as they would settle (the close-out shows it)
//     GET  /report?from=&to=                         everyone's tips for the nights closed, by person and by night
//   Anyone who works the register (bar:register):
//     GET  /mine?from=&to=                           my own nights; never anyone else's
//   Declared cash tips (restaurant-bar parity #16, behind bar_declared_tips as well):
//     GET/POST /declared/mine  (bar:register)        my declared nights with the cash tips already on the register; declare tonight's
//     GET  /declared?from=&to=  ·  POST /declared  ·  PUT /declared/:id   (bar:manage)   see, add and correct anyone's
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { TipError } from './barTips.ts'
import type { BarServices } from './services.ts'

type Ctx = any

export function createBarTipRoutes(d: CrmDeps, bar: BarServices) {
  const { audit, logger } = d
  const { requirePermission } = d.permissions
  const on = d.features.requireEnabledFeature('bar_tip_pooling')
  const declaredOn = d.features.requireEnabledFeature('bar_declared_tips')
  const { actorOf } = bar.managers
  const { getRules, setRules, preview, report, mine, positions, declareMine, mineDeclared, listDeclared, declareFor, correctDeclared } = bar.tips
  const app = new Hono<AppEnv>()

  async function run(c: Ctx, fn: () => Promise<unknown>) {
    try { c.header('Cache-Control', 'no-store'); return one(c, await fn() as object) }
    catch (e: any) {
      if (e instanceof TipError) return fail(c, e.status as any, e.message)
      logger.error('[tips]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
  }

  app.get('/rules', on, requirePermission('bar:manage'), async (c) => { const a = await actorOf(c); return run(c, async () => ({ rules: await getRules(a.companyId), positions: await positions(a.companyId) })) })
  app.put('/rules', on, requirePermission('bar:manage'), async (c) => {
    const a = await actorOf(c); const b = await c.req.json().catch(() => ({}))
    return run(c, async () => {
      const r = await setRules(a.companyId, b)
      audit.log({ req: c, action: 'update', entity: 'bar_tip_rules', entityName: 'Tip rules', changes: audit.diff(r.before as any, r.rules as any) })
      return { rules: r.rules }
    })
  })
  app.get('/night', on, requirePermission('bar:manage'), async (c) => { const a = await actorOf(c); return run(c, () => preview(a.companyId, String(c.req.query('day') || ''))) })
  app.get('/report', on, requirePermission('bar:manage'), async (c) => { const a = await actorOf(c); return run(c, () => report(a.companyId, String(c.req.query('from') || ''), String(c.req.query('to') || ''))) })
  app.get('/mine', on, requirePermission('bar:register'), async (c) => { const a = await actorOf(c); return run(c, () => mine(a.companyId, a.id as string, String(c.req.query('from') || ''), String(c.req.query('to') || ''))) })
  // ── Declared cash tips ──
  app.get('/declared/mine', declaredOn, requirePermission('bar:register'), async (c) => { const a = await actorOf(c); return run(c, () => mineDeclared(a.companyId, a.id as string, String(c.req.query('from') || ''), String(c.req.query('to') || ''))) })
  app.post('/declared/mine', declaredOn, requirePermission('bar:register'), async (c) => {
    const a = await actorOf(c); const b = await c.req.json().catch(() => ({}))
    return run(c, async () => ({ entry: await declareMine(a.companyId, a.id as string, b, b.via === 'phone' ? 'phone' : 'web') }))
  })
  app.get('/declared', declaredOn, requirePermission('bar:manage'), async (c) => { const a = await actorOf(c); return run(c, () => listDeclared(a.companyId, String(c.req.query('from') || ''), String(c.req.query('to') || ''))) })
  app.post('/declared', declaredOn, requirePermission('bar:manage'), async (c) => {
    const a = await actorOf(c); const b = await c.req.json().catch(() => ({}))
    return run(c, async () => { const entry = await declareFor(a.name, a.companyId, b); audit.log({ req: c, action: 'update', entity: 'bar_declared_tip', entityId: entry.id, entityName: 'Declared cash tips', changes: { userId: entry.userId, day: entry.day, amountCents: entry.amountCents } }); return { entry } })
  })
  app.put('/declared/:id', declaredOn, requirePermission('bar:manage'), async (c) => {
    const a = await actorOf(c); const b = await c.req.json().catch(() => ({}))
    return run(c, async () => {
      const r = await correctDeclared(a.name, a.companyId, c.req.param('id'), b)
      audit.log({ req: c, action: 'update', entity: 'bar_declared_tip', entityId: r.entry.id, entityName: 'Declared cash tips', changes: { day: r.entry.day, fromCents: r.before.amountCents, toCents: r.entry.amountCents } })
      return r
    })
  })
  return app
}
