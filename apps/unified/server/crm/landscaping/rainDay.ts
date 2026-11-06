// Rain day, on the Route Board's side: POST /api/recurring-routes/rain-day pushes a day's open jobs (or one route's) forward and
// can text the customers. Nothing is changed or sent unless `dryRun` is false; the screen previews first, then asks.
//
//   POST { date: YYYY-MM-DD, shift: 'day' | 'week' | 1–14 days, throughDate?, toDate?, routeId?, excludeJobIds?, notify?, message?,
//          dryRun?, background? }
//     · throughDate — a run of days, each pushed by the same shift ("this day through Friday"; Yardbook shift by week) — row 16;
//     · toDate — the day's visits go TO that date (Jobber's Move Visits: a source day and a target day), no Sunday rule — row 16;
//     · a push of more than BACKGROUND_FROM visits, or `background: true`, runs in the background and emails the person who
//       started it when it is done (Yardbook) — row 29.
//   GET  /runs              the recent rain days: what moved, whether each can be undone — row 29
//   POST /runs/:id/undo     put back every visit still where the push left it, cancel its texts not yet sent — row 29
//   GET  /forecast          the next seven days' weather against the route days, to push a rainy day from — row 17
//
// Gated as the dispatch board's bulk reschedule is (jobs:update and jobs:dispatch), and the texts need sms:send as well — a
// request that asks for texts without it is refused whole, before anything moves. Mounted by landscaping/index.ts.
import { Hono } from 'hono'
import { JOB_DISPATCH_PERMISSION, companyTimeZone, businessToday } from '@twomiah/tenant-backend'
import { and, eq } from 'drizzle-orm'
import { recurringRoute, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import {
  rainDay, rainDayTexts, queueRainDayTexts, RAIN_SHIFT_MAX, RAIN_RANGE_MAX, BACKGROUND_FROM, getRainDaySettings, setRainDaySkipSundays,
  noteRunTexts, rainDayRuns, undoRainDay, startRun, finishRun, openVisitsByDay, type RainDayOptions,
} from '../../data/routeRainDay.ts'
import { businessPoint, forecastAt } from '../../data/weatherForecast.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_TEXT = 1600
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(v))
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
const esc = (s: string) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
const dayWords = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

export function createRainDayRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  const may = async (c: any, perm: string): Promise<boolean> => {
    const u = c.get('user')
    try { return hasPermission(u?.role, perm, await getExtraPermissions(u?.userId)) } catch { return false }
  }
  const sendRaw = (m: { to: string; subject: string; html: string }) => (d.services as any).emailService?.sendRaw?.(m)

  // The business's rain day switch: "Skip Sundays when moving visits" (default on). Read by anyone who sees jobs; changed by the
  // seats that may run a rain day (the same two asks).
  app.get('/settings', requirePermission('jobs:read'), async (c) => one(c, await getRainDaySettings(db, c.get('user').companyId)))
  app.put('/settings', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const u = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    if (typeof b?.skipSundays !== 'boolean') return fail(c, 400, 'Say whether to skip Sundays (on or off).', undefined, { skipSundays: 'Required' })
    const saved = await setRainDaySkipSundays(db, u.companyId, b.skipSundays)
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'landscaping_setting', entityId: u.companyId, entityName: `Rain day: skip Sundays ${saved.skipSundays ? 'on' : 'off'}`, userId: u.userId, companyId: u.companyId })
    return one(c, saved)
  })

  /** Push for real: move, queue the texts, keep them on the run for its undo, tell the board. */
  const apply = async (companyId: string, userId: string, opts: RainDayOptions, notify: boolean, message: string | null, tz: string) => {
    const plan = await rainDay(db, companyId, opts, true, userId)
    const text = notify ? await rainDayTexts(db, companyId, plan.moves.map((m: any) => ({ contactId: m.contactId, title: m.title, from: m.from, to: m.to })), message, new Date(), tz) : null
    const ids = text ? await queueRainDayTexts(db, companyId, userId, text.texts) : []
    if (plan.runId && ids.length) await noteRunTexts(db, companyId, plan.runId, ids)
    for (const m of plan.moves) d.realtime.emitToCompany(companyId, d.realtime.EVENTS.JOB_UPDATED, { id: m.id, scheduledDate: m.to })
    return { plan, text, queued: ids.length }
  }

  app.post('/', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const u = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    const date = String(b?.date || '')
    if (!isDay(date)) return fail(c, 400, 'Pick the day the rain stops work (YYYY-MM-DD).', undefined, { date: 'Required' })
    const tz = await companyTimeZone(db, u.companyId)
    const today = businessToday(tz).toISOString().slice(0, 10)
    if (date < today) return fail(c, 400, 'Pick today or a day coming up — a day that has passed has nothing left to push.', undefined, { date: 'In the past' })
    const throughDate = b?.throughDate ? String(b.throughDate) : null
    if (throughDate && (!isDay(throughDate) || throughDate < date)) return fail(c, 400, 'The last day must be on or after the first.', undefined, { throughDate: 'Invalid' })
    if (throughDate && daysBetween(date, throughDate) >= RAIN_RANGE_MAX) return fail(c, 400, `Push at most ${RAIN_RANGE_MAX} days at once.`, undefined, { throughDate: 'Too long' })
    const toDate = b?.toDate ? String(b.toDate) : null
    if (toDate && !isDay(toDate)) return fail(c, 400, 'Pick the day to move the visits to.', undefined, { toDate: 'Invalid' })
    if (toDate && toDate <= date) return fail(c, 400, 'Move the visits to a day after the rained-out one.', undefined, { toDate: 'Not after' })
    if (toDate && throughDate) return fail(c, 400, 'Move one day to a chosen date, or a run of days by a number of days — not both.', undefined, { toDate: 'With a run of days' })
    const shift = toDate ? daysBetween(date, toDate) : b?.shift === 'day' || b?.shift == null || b?.shift === '' ? 1 : b.shift === 'week' ? 7 : Number(b.shift)
    if (!toDate && (!Number.isInteger(shift) || shift < 1 || shift > RAIN_SHIFT_MAX)) return fail(c, 400, `Push forward a day, a week, or 1 to ${RAIN_SHIFT_MAX} days.`, undefined, { shift: 'Invalid' })
    const notify = b?.notify === true
    if (notify && !(await may(c, 'sms:send'))) return fail(c, 403, 'Texting customers is for a seat that may send texts. Push the jobs without texts, or ask an owner or manager.', undefined, { notify: 'Not allowed' })
    const message = typeof b?.message === 'string' && b.message.trim() ? b.message.trim() : null
    if (message && message.length > MAX_TEXT) return fail(c, 400, `A text is at most ${MAX_TEXT} characters.`, undefined, { message: 'Too long' })
    const routeId = b?.routeId ? String(b.routeId) : null
    if (routeId) {
      const [found] = await db.select({ id: recurringRoute.id }).from(recurringRoute).where(and(eq(recurringRoute.id, routeId), eq(recurringRoute.companyId, u.companyId))).limit(1)
      if (!found) return fail(c, 404, 'Route not found')
    }
    const excludeJobIds: string[] = Array.isArray(b?.excludeJobIds) ? b.excludeJobIds.map(String) : []
    const dryRun = b?.dryRun !== false
    const opts: RainDayOptions = { date, shiftDays: shift, throughDate, toDate, routeId, excludeJobIds, skipSundays: (await getRainDaySettings(db, u.companyId)).skipSundays }

    // The preview always runs (nothing is written); a real push decides from its size whether to run in the background.
    const preview = await rainDay(db, u.companyId, opts, false)
    const background = !dryRun && (b?.background === true || preview.moves.length > BACKGROUND_FROM)
    if (background) {
      const run = await startRun(db, u.companyId, String(u.userId), opts)
      const [me] = await db.select({ email: user.email, firstName: user.firstName }).from(user).where(eq(user.id, u.userId)).limit(1)
      // Answered at once; the push runs after, and the person is emailed how it went (Yardbook's background run).
      setTimeout(async () => {
        try {
          const done = await apply(u.companyId, String(u.userId), opts, notify, message, tz)
          await finishRun(db, u.companyId, run.id, { madeRun: done.plan.runId })
          audit.log({ action: audit.ACTIONS.UPDATE, entity: 'rain_day', entityId: run.id, entityName: `Rain day ${date}`, userId: u.userId, companyId: u.companyId, metadata: { background: true, moved: done.plan.moved, blocked: done.plan.blocked.length, texts: done.queued } })
          if (me?.email) await sendRaw({ to: me.email, subject: `Rain day done: ${done.plan.moved} visit${done.plan.moved === 1 ? '' : 's'} moved`, html: `<p>Hi ${esc(me.firstName || 'there')},</p><p>The rain day from ${esc(dayWords(date))}${throughDate ? ` through ${esc(dayWords(throughDate))}` : ''} is done: <strong>${done.plan.moved}</strong> visit${done.plan.moved === 1 ? '' : 's'} moved${done.plan.blocked.length ? `, ${done.plan.blocked.length} left where ${done.plan.blocked.length === 1 ? 'it was' : 'they were'} (already a visit that day)` : ''}${done.queued ? `, ${done.queued} customer text${done.queued === 1 ? '' : 's'} queued` : ''}.</p><p>You can undo it from the Route Board's rain day panel.</p>` })
        } catch (err) {
          await finishRun(db, u.companyId, run.id, { error: (err as Error)?.message || 'The rain day did not finish.' }).catch(() => {})
          if (me?.email) await sendRaw({ to: me.email, subject: 'Rain day did not finish', html: `<p>The rain day from ${esc(dayWords(date))} did not finish, and no visits were moved. Try it again from the Route Board.</p>` }).catch(() => {})
          d.logger.error('[rain-day] background run failed', { error: (err as Error)?.message })
        }
      }, 0)
      return one(c, { dryRun: false, background: true, runId: run.id, date, throughDate, toDate: preview.toDate, wouldMove: preview.moves.length, moved: 0 }, 202)
    }

    const out = dryRun ? { plan: preview, text: notify ? await rainDayTexts(db, u.companyId, preview.moves.map((m: any) => ({ contactId: m.contactId, title: m.title, from: m.from, to: m.to })), message, new Date(), tz) : null, queued: 0 }
      : await apply(u.companyId, String(u.userId), opts, notify, message, tz)
    const plan = out.plan
    if (!dryRun) {
      audit.log({
        req: c, action: audit.ACTIONS.UPDATE, entity: 'rain_day', entityId: plan.runId || routeId || date, entityName: `Rain day ${date}`,
        userId: u.userId, companyId: u.companyId, metadata: { date, throughDate, to: plan.toDate, moved: plan.moved, blocked: plan.blocked.length, texts: out.queued },
      })
    }
    return one(c, {
      dryRun, background: false, runId: plan.runId ?? null, date, throughDate, toDate: plan.toDate, shiftDays: toDate ? null : shift, skippedSunday: !!plan.skippedSunday,
      moved: dryRun ? 0 : plan.moved,
      wouldMove: plan.moves.length,
      jobs: plan.moves.map((m: any) => ({ id: m.id, number: m.number, title: m.title, scheduledTime: m.scheduledTime, from: m.from, to: m.to })),
      blocked: plan.blocked, overlaps: plan.overlaps,
      texts: out.text ? {
        queued: out.queued, willText: out.text.texts.length, sendAt: out.text.texts[0]?.sendAt ?? null,
        preview: out.text.texts.slice(0, 3).map((t) => ({ name: t.name, body: t.body })),
        skipped: out.text.skipped, jobsWithoutCustomer: out.text.noContact,
      } : null,
    })
  })

  // ── Row 29: the recent rain days, and undo ──
  app.get('/runs', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const rows: any[] = await rainDayRuns(db, c.get('user').companyId)
    return listAll(c, rows.map((r) => ({ id: r.id, status: r.status, fromDate: r.fromDate, throughDate: r.throughDate, toDate: r.toDate, shiftDays: r.shiftDays, moved: r.moved, error: r.error, createdAt: r.createdAt, undoneAt: r.undoneAt, canUndo: r.status === 'done' && r.moved > 0 })))
  })

  app.post('/runs/:id/undo', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const u = c.get('user')
    const r: any = await undoRainDay(db, u.companyId, c.req.param('id'), String(u.userId))
    if (r.error) return fail(c, r.error, r.why)
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'rain_day', entityId: c.req.param('id'), entityName: 'Rain day undone', userId: u.userId, companyId: u.companyId, metadata: { back: r.back, stayed: r.stayed.length, textsCancelled: r.textsCancelled } })
    return one(c, r)
  })

  // ── Row 17: the week's forecast against the route days ──
  app.get('/forecast', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const tz = await companyTimeZone(db, u.companyId)
    const point = await businessPoint(db, u.companyId)
    if (!point) return fail(c, 409, 'Add the business address in Settings (or an address on a job) to see the forecast.', 'NO_LOCATION')
    const f = await forecastAt(point, tz, 7)
    if ('error' in f) return fail(c, 502, f.error, 'FORECAST_UNAVAILABLE')
    // How many open visits each day holds — what a rain-out would move.
    const first = f.days[0]?.date, last = f.days[f.days.length - 1]?.date
    const counts = first && last ? await openVisitsByDay(db, u.companyId, first, last) : new Map<string, number>()
    return listAll(c, f.days.map((x) => ({ ...x, visits: counts.get(x.date) ?? 0 })))
  })

  return app
}
