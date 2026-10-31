// /api/family-comms — the office's side of what the agency says to relatives and what they ask (care_family_comms, not ready):
//   GET  /summary                         { openRequests }                 the "Open requests" tile
//   GET  /requests?status=open|done|declined                               what relatives asked for
//   PUT  /requests/:id { status: 'done'|'declined', note? }                deal with one (its office task is closed with it)
//   GET  /texts?from&to&status&clientId   what went to relatives or was held back, and why (newest first, at most 92 days)
//   GET|PUT /text-wording { arrivalText, departureText }                   the arrival / finish text, in the agency's words
//   GET  /email-templates   PUT|DELETE /email-templates/:kind              the four portal emails (DELETE = back to our wording)
//   GET  /consent-wording                                                  the words a relative agrees to, as stored with their yes
// All of it is care-portal:update, like the relatives' own accounts; the feature gates the mount.
import { Hono } from 'hono'
import { familyTextLog } from '../../../data/homecareFamilyTexts.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { addDays, isYmd } from '../core/agencyTime.ts'
import { consentWording, emailConsentWording, REQUEST_KINDS } from '../core/familyComms.ts'

export const TEXT_STATUS_LABELS: Record<string, string> = {
  sent: 'Sent', failed: 'Not sent', pending: 'Waiting to send', skipped_quiet: 'Held (quiet hours)', skipped_late: 'Held (too late to be news)',
}
const EVENT_LABELS: Record<string, string> = { clock_in: 'Arrival', clock_out: 'Finish' }
const CHANNEL_LABELS: Record<string, string> = { sms: 'Text', email: 'Email' }
const MAX_DAYS = 92

export function createFamilyCommsRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const gate = requirePermission('care-portal:update')
  const cid = (c: any) => (c.get('user') as any).companyId as string

  app.get('/summary', gate, async (c) => one(c, { openRequests: await core.familyComms.openCount(cid(c)) }))

  app.get('/requests', gate, async (c) => {
    const status = c.req.query('status')
    if (status && !['open', 'done', 'declined'].includes(status)) return fail(c, 400, 'Status must be open, done or declined.', 'bad_status')
    return listAll(c, await core.familyComms.listRequests(cid(c), status || undefined))
  })
  app.put('/requests/:id', gate, async (c) => {
    const b = await c.req.json().catch(() => ({} as any))
    const r = await core.familyComms.handle(cid(c), c.req.param('id')!, (c.get('user') as any).id, String(b.status ?? ''), b.note)
    if (r === 'bad_status') return fail(c, 400, 'Mark it done or declined.', 'bad_status', { status: 'Done or declined' })
    if (r === 'missing') return fail(c, 404, 'Request not found')
    if (r === 'already') return fail(c, 409, 'That request has already been dealt with.', 'already_handled')
    return one(c, { id: c.req.param('id'), status: b.status, openRequests: await core.familyComms.openCount(cid(c)) })
  })

  app.get('/kinds', gate, async (c) => one(c, { kinds: REQUEST_KINDS }))

  app.get('/texts', gate, async (c) => {
    const companyId = cid(c)
    const today = await core.time.today(companyId)
    const from = c.req.query('from') || addDays(today, -13)
    const to = c.req.query('to') || today
    if (!isYmd(from) || !isYmd(to) || from > to) return fail(c, 400, 'Give the dates as day, month and year, with the start before the end.', 'bad_dates')
    if (addDays(from, MAX_DAYS - 1) < to) return fail(c, 400, `Pick at most ${MAX_DAYS} days at a time.`, 'range_too_long')
    const status = c.req.query('status')
    if (status && !TEXT_STATUS_LABELS[status]) return fail(c, 400, 'Pick one of the statuses on the list.', 'bad_status')
    const { from: f, before } = await core.time.range(companyId, from, to)
    const rows = await familyTextLog(d.db, companyId, { fromIso: f!.toISOString(), beforeIso: before!.toISOString(), status: status || undefined, clientId: c.req.query('clientId') || undefined, limit: 1000 })
    return listAll(c, rows.map((r: any) => ({
      ...r, statusLabel: TEXT_STATUS_LABELS[r.status] || r.status, eventLabel: EVENT_LABELS[r.event] || r.event, channelLabel: CHANNEL_LABELS[r.channel] || r.channel,
    })))
  })

  app.get('/text-wording', gate, async (c) => one(c, { ...(await core.familyComms.textWording(cid(c))), defaults: { arrivalText: '{caregiver} has arrived to help {client} ({time}).', departureText: '{caregiver} has finished the visit with {client} ({time}).' } }))
  app.put('/text-wording', gate, async (c) => {
    const b = await c.req.json().catch(() => ({} as any))
    const r = await core.familyComms.saveTextWording(cid(c), b)
    return 'problem' in r ? fail(c, 400, r.problem, 'bad_wording', { [r.field]: r.problem }) : one(c, r)
  })

  app.get('/email-templates', gate, async (c) => listAll(c, await core.familyComms.emailTemplates(cid(c))))
  app.put('/email-templates/:kind', gate, async (c) => {
    const b = await c.req.json().catch(() => ({} as any))
    const r = await core.familyComms.saveEmailTemplate(cid(c), c.req.param('kind')!, b)
    return 'problem' in r ? fail(c, 400, r.problem, 'bad_wording', { [r.field]: r.problem }) : one(c, r)
  })
  app.delete('/email-templates/:kind', gate, async (c) => (await core.familyComms.resetEmailTemplate(cid(c), c.req.param('kind')!)) ? done(c) : fail(c, 404, 'That is not one of the portal emails.'))

  app.get('/consent-wording', gate, async (c) => {
    const agency = await core.profile.agencyShortName(cid(c))
    return one(c, { text: consentWording(agency), email: emailConsentWording(agency) })
  })

  return app
}
