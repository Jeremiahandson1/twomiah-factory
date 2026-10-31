// /api/care-rewards — the pickup bonus log, the points scheme, the rewards and the requests to spend points (row 18, care_pickup_rewards;
// the mount carries the feature, so an agency without it answers 403/404 and nothing is shown).
//
//   caregiver (care-schedule:read, their own only)
//     GET  /me                     { balance, rules, history, rewards, requests } — their points brought up to date
//     POST /redeem { rewardId }    ask for a reward; the points are held; 409 when the balance does not cover it
//   office (care-schedule:update)
//     GET  /summary                { rules, waiting }          GET|PUT /rules            what earns points
//     GET  /board                  every caregiver with points    POST /adjust { caregiverId, points, note }
//     GET  /items                  POST /items · PUT /items/:id   the reward catalogue
//     GET  /requests?status=       PUT /requests/:id { action: 'fulfil' | 'decline', note? }
//   payroll (care-payroll:read)
//     GET  /pickups?startDate&endDate    the open shifts picked up, their bonus, and whether the visit was worked (so it is in the pay run)
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { pickupLog } from '../../../data/homecareRewards.ts'
import { personName } from '../../../data/homecareScheduling.ts'
import { PAYABLE_REVIEW_STATUSES } from '../core/payrollPay.ts'
import { isYmd } from '../core/agencyTime.ts'
import { who } from './shared.ts'

export function createPickupRewardsRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const rw = core.pickupRewards
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

  app.get('/me', perm('care-schedule:read'), async (c) => {
    const { companyId, me } = who(c)
    return one(c, await rw.mine(companyId, me))
  })

  app.post('/redeem', perm('care-schedule:read'), async (c) => {
    const { companyId, me } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    if (!b.rewardId) return fail(c, 400, 'Choose a reward')
    const r = await rw.ask(companyId, me, String(b.rewardId))
    if ('problem' in r) return fail(c, r.status, r.problem)
    const p = await personName(d.db, companyId, me)
    const person = `${p?.firstName || ''} ${p?.lastName || ''}`.trim()
    await core.notify.notifyAdmins(companyId, 'reward_requested', 'A caregiver asked for a reward', `${person || 'A caregiver'} asked for "${r.request.name}" (${r.request.points} points). Hand it over in Pickup bonus & rewards.`)
    return one(c, r.request, 201)
  })

  app.get('/summary', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    return one(c, { rules: await rw.rules(companyId), waiting: await rw.waiting(companyId) })
  })
  app.get('/rules', perm('care-schedule:update'), async (c) => one(c, await rw.rules(who(c).companyId)))
  app.put('/rules', perm('care-schedule:update'), async (c) => {
    const r = await rw.saveRules(who(c).companyId, await c.req.json().catch(() => ({})))
    if ('problem' in r) return fail(c, 400, r.problem)
    return one(c, r.rules)
  })
  app.get('/board', perm('care-schedule:update'), async (c) => listAll(c, await rw.board(who(c).companyId)))

  app.post('/adjust', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const r = await rw.adjust(companyId, String(b.caregiverId || ''), Number(b.points), text(b.note, 200), me)
    if ('problem' in r) return fail(c, r.status, r.problem)
    return one(c, { ok: true })
  })

  const itemBody = (b: any) => {
    const name = text(b.name, 80)
    const cost = typeof b.costPoints === 'string' && b.costPoints.trim() !== '' ? Number(b.costPoints) : b.costPoints
    if (!name) return { problem: 'Give the reward a name.', f: null }
    if (!Number.isInteger(cost) || cost < 1 || cost > 100000) return { problem: 'The cost must be a whole number of points, at least 1.', f: null }
    return { problem: null, f: { name, description: text(b.description, 300) || null, costPoints: cost as number, isActive: b.isActive !== false } }
  }
  app.get('/items', perm('care-schedule:update'), async (c) => listAll(c, await rw.items(who(c).companyId)))
  app.post('/items', perm('care-schedule:update'), async (c) => {
    const b = itemBody(await c.req.json().catch(() => ({})))
    if (b.problem || !b.f) return fail(c, 400, b.problem ?? 'Check the reward')
    return one(c, await rw.addItem(who(c).companyId, b.f), 201)
  })
  app.put('/items/:id', perm('care-schedule:update'), async (c) => {
    const b = itemBody(await c.req.json().catch(() => ({})))
    if (b.problem || !b.f) return fail(c, 400, b.problem ?? 'Check the reward')
    const row = await rw.saveItem(who(c).companyId, c.req.param('id')!, b.f)
    return row ? one(c, row) : fail(c, 404, 'Reward not found')
  })

  app.get('/requests', perm('care-schedule:update'), async (c) => listAll(c, await rw.requests(who(c).companyId, c.req.query('status') || undefined)))
  app.put('/requests/:id', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    if (b.action !== 'fulfil' && b.action !== 'decline') return fail(c, 400, 'Say whether you gave the reward or declined it')
    const done = await rw.settle(companyId, c.req.param('id')!, b.action === 'fulfil' ? 'fulfilled' : 'declined', me, text(b.note, 300) || null)
    if (!done) return fail(c, 409, 'That request was already handled, or does not exist')
    await core.notify.notifyUser(companyId, done.caregiverId, 'reward_handled', b.action === 'fulfil' ? 'Your reward is ready' : 'Your reward request was declined',
      b.action === 'fulfil' ? `"${done.name}" has been given to you.${b.note ? ` ${text(b.note, 300)}` : ''}` : `"${done.name}" was not given and ${done.points} points are back on your balance.${b.note ? ` ${text(b.note, 300)}` : ''}`)
    return one(c, done)
  })

  app.get('/pickups', perm('care-payroll:read'), async (c) => {
    const { companyId } = who(c)
    const start = c.req.query('startDate'), end = c.req.query('endDate')
    if (!isYmd(start) || !isYmd(end) || end < start) return fail(c, 400, 'startDate and endDate must be YYYY-MM-DD, start first')
    return listAll(c, await pickupLog(d.db, companyId, start, end, PAYABLE_REVIEW_STATUSES))
  })

  return app
}
